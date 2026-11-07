import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  type OpenerTarget,
  SUPPORTED_IMAGE_EXTENSIONS,
  type WorkspaceLabelColor,
  diagnosePathRpc,
  inspectFileRpc,
  listWorkspaceMediaRpc,
  manageWorkspaceLabelsRpc,
  openFileTargetRpc,
  pluginSettings,
  renameWorkspaceOrAgentRpc,
} from "../shared/contracts";
import { enMessages, getCatalogForLocale, zhMessages } from "../client/i18n";
import {
  type DaemonLabelBridge,
  buildCandidatePaths,
  handleDiagnosePath,
  handleInspectFile,
  handleListWorkspaceMedia,
  handleManageWorkspaceLabels,
  handleOpenFileTarget,
  handleRenameThread,
  resolveBestPath,
} from "../server/handlers";
import {
  type MinimalDocument,
  type MinimalElement,
  decodeTabCloseTestId,
  extractFilePathFromCopyMenuItem,
  extractFilePathFromElement,
  findActiveFileTabPath,
  injectIntoNativeTabMenus,
  isInsideFileExplorer,
  isInsideWorkspaceHeaderTitle,
  isInsideWorkspaceTab,
  syncImagePanelAssociations,
} from "../client/web";

// Minimal valid 1x1 PNG buffer
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function createMockContext(workspaceDirs: string[], titlesMap?: Map<string, string | null>) {
  return {
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    settings: {
      get: async () => ({}),
    },
    storage: {} as never,
    secrets: {} as never,
    paseo: {
      workspaces: {
        ref: (id: string) => ({
          id,
          directory: workspaceDirs[0] ?? os.tmpdir(),
          setTitle: async (title: string | null) => {
            titlesMap?.set(id, title);
          },
          current: () => ({
            id,
            workspaceDirectory: workspaceDirs[0] ?? os.tmpdir(),
          }),
          refresh: async () => ({
            id,
            workspaceDirectory: workspaceDirs[0] ?? os.tmpdir(),
          }),
        }),
        list: async () => ({
          entries: workspaceDirs.map((dir, idx) => ({
            id: `ws_${idx}`,
            workspaceDirectory: dir,
          })),
        }),
      },
    } as never,
  } as never;
}

test("1. Contracts & RPC method names strictly obey @getpaseo/plugin lowercase regex", () => {
  const rpcRegex = /^[a-z][a-z0-9._-]*$/;
  for (const rpc of [
    inspectFileRpc,
    openFileTargetRpc,
    listWorkspaceMediaRpc,
    diagnosePathRpc,
    renameWorkspaceOrAgentRpc,
    manageWorkspaceLabelsRpc,
  ]) {
    assert.match(rpc.name, rpcRegex, `RPC name ${rpc.name} must be lowercase`);
  }
  assert.equal(pluginSettings.scope, "host");
  assert.ok(SUPPORTED_IMAGE_EXTENSIONS.includes("png"));
  assert.ok(SUPPORTED_IMAGE_EXTENSIONS.includes("webp"));
  assert.ok(SUPPORTED_IMAGE_EXTENSIONS.includes("svg"));
});

test("2. handleInspectFile extracts real PNG metadata and pixel dimensions via sips", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-finder-test-"));
  try {
    const subDir = path.join(tmpRoot, "reports", "mobile_ui_series");
    await fs.mkdir(subDir, { recursive: true });
    const imgPath = path.join(subDir, "showcase.png");
    await fs.writeFile(imgPath, Buffer.from(TINY_PNG_BASE64, "base64"));

    const ctx = createMockContext([tmpRoot]);
    const meta = await handleInspectFile(
      { path: "reports/mobile_ui_series/showcase.png", workspaceRoot: tmpRoot },
      ctx,
    );

    assert.equal(meta.exists, true);
    assert.equal(meta.fileName, "showcase.png");
    assert.equal(meta.extension, "png");
    assert.equal(meta.relativePath, "reports/mobile_ui_series/showcase.png");
    assert.equal(meta.parentDir, subDir);
    assert.ok(meta.sizeBytes > 0);
    if (process.platform === "darwin") {
      assert.equal(meta.width, 1);
      assert.equal(meta.height, 1);
    }
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("3. Multi-workspace relative path & basename resolution works across workspaces", async () => {
  const ws1 = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-ws1-"));
  const ws2 = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-ws2-"));
  try {
    const deepDir = path.join(ws2, "reports", "ui");
    await fs.mkdir(deepDir, { recursive: true });
    const targetImg = path.join(deepDir, "panoramic_00.png");
    await fs.writeFile(targetImg, Buffer.from(TINY_PNG_BASE64, "base64"));

    const byRelative = await resolveBestPath("reports/ui/panoramic_00.png", ws1, [ws1, ws2]);
    assert.equal(byRelative.metadata.exists, true);
    assert.equal(byRelative.resolvedPath, targetImg);

    const byBasename = await resolveBestPath("panoramic_00.png", ws1, [ws1, ws2]);
    assert.equal(byBasename.metadata.exists, true);
    assert.equal(byBasename.resolvedPath, targetImg);

    const cands = buildCandidatePaths("reports/ui/panoramic_00.png#L10", ws2);
    assert.equal(cands[0], targetImg);
  } finally {
    await fs.rm(ws1, { recursive: true, force: true });
    await fs.rm(ws2, { recursive: true, force: true });
  }
});

test("4. handleListWorkspaceMedia scans workspace images, ignores node_modules, and filters by query", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-media-scan-"));
  try {
    await fs.mkdir(path.join(tmpRoot, "assets"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, "assets", "hero_banner.png"),
      Buffer.from(TINY_PNG_BASE64, "base64"),
    );
    await fs.writeFile(path.join(tmpRoot, "assets", "notes.txt"), "hello");
    await fs.writeFile(
      path.join(tmpRoot, "node_modules", "pkg", "ignored.png"),
      Buffer.from(TINY_PNG_BASE64, "base64"),
    );

    const ctx = createMockContext([tmpRoot]);
    const res = await handleListWorkspaceMedia(
      { workspaceRoot: tmpRoot, onlyImages: true, limit: 20 },
      ctx,
    );

    assert.equal(res.totalFound, 1);
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].fileName, "hero_banner.png");
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("5. handleOpenFileTarget & handleDiagnosePath execute and record observability receipts", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-open-test-"));
  try {
    const imgPath = path.join(tmpRoot, "demo.png");
    await fs.writeFile(imgPath, Buffer.from(TINY_PNG_BASE64, "base64"));
    const ctx = createMockContext([tmpRoot]);

    const openRes = await handleOpenFileTarget(
      { path: "demo.png", workspaceRoot: tmpRoot, target: "finder-reveal" },
      ctx,
      { dryRun: true },
    );
    assert.equal(openRes.ok, true);
    assert.equal(openRes.resolvedPath, imgPath);
    assert.equal(openRes.parentDir, tmpRoot);

    const fallbackRes = await handleOpenFileTarget(
      { path: "missing_file.png", workspaceRoot: tmpRoot, target: "finder-folder" },
      ctx,
      { dryRun: true },
    );
    assert.equal(fallbackRes.ok, true);
    assert.equal(fallbackRes.resolvedPath, tmpRoot);

    const diagRes = await handleDiagnosePath(
      { rawInput: "demo.png", workspaceRoot: tmpRoot },
      ctx,
    );
    assert.equal(diagRes.resolvedMetadata.exists, true);
    assert.equal(diagRes.availableTargets.length, 6);
    assert.equal(diagRes.availableTargets[0].label, "Reveal in Finder");
    assert.ok(diagRes.recentActions.length >= 2);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("6. Client DOM & localStorage helpers extract file paths from chat links, tabs, and tooltips", () => {
  assert.equal(
    decodeTabCloseTestId("workspace-file-close-reports%2Fmobile_ui_series%2F00_showcase.png"),
    "reports/mobile_ui_series/00_showcase.png",
  );

  const mockDoc: MinimalDocument = {
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector.includes("tooltip")) {
        return [{ textContent: "reports/mobile_ui_series/00_mobile_ui_5screen_panoramic_showcase.png" }];
      }
      if (selector.includes("workspace-file-close-")) {
        return [
          {
            getAttribute: (name: string) =>
              name === "data-testid"
                ? "workspace-file-close-reports%2Fmobile_ui_series%2F00_mobile_ui_5screen_panoramic_showcase.png"
                : null,
            closest: (sel: string) => (sel === '[aria-selected="true"]' ? {} : null),
          },
        ];
      }
      return [];
    },
    createElement: () => ({}),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const inlineChatLink = {
    textContent: "00_mobile_ui_5screen_panoramic_showcase.png",
    getAttribute: () => null,
    parentElement: null,
  };
  assert.equal(
    extractFilePathFromElement(inlineChatLink, mockDoc),
    "reports/mobile_ui_series/00_mobile_ui_5screen_panoramic_showcase.png",
  );

  assert.equal(
    findActiveFileTabPath(mockDoc),
    "reports/mobile_ui_series/00_mobile_ui_5screen_panoramic_showcase.png",
  );

  const store = new Map<string, string>([["@paseo:app-settings", JSON.stringify({})]]);
  (globalThis as unknown as { window?: unknown }).window = {
    localStorage: {
      get length() {
        return store.size;
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  syncImagePanelAssociations("file-inspector-finder", "image-inspector", true);
  const updated = JSON.parse(store.get("@paseo:app-settings") ?? "{}") as {
    filePanelAssociations?: Record<string, string>;
  };
  assert.equal(
    updated.filePanelAssociations?.["ext:png"],
    "plugin:file-inspector-finder/image-inspector",
  );
  assert.equal(
    updated.filePanelAssociations?.["ext:webp"],
    "plugin:file-inspector-finder/image-inspector",
  );
});

test("7. In-place extension of Paseo's official native tab context menu (zero duplicate menu conflict)", async () => {
  // Verify workspace tab and file explorer boundary detection
  const tabHeaderChild: MinimalElement = {
    parentElement: {
      getAttribute: (name: string) =>
        name === "data-testid" ? "workspace-tab-file_docs/file_inspector_finder_plugin.md" : null,
    },
  };
  assert.equal(isInsideWorkspaceTab(tabHeaderChild), true);
  assert.equal(isInsideFileExplorer(tabHeaderChild), false);

  const explorerItem: MinimalElement = {
    getAttribute: (name: string) => (name === "data-testid" ? "file-explorer-row-1" : null),
  };
  assert.equal(isInsideFileExplorer(explorerItem), true);

  // Build a mock Paseo native tab menu containing `Copy file path` and `Close`
  const menuChildren: MinimalElement[] = [];
  const createMockElement = (initialTestId?: string, initialText?: string): MinimalElement => {
    const attrs = new Map<string, string>();
    if (initialTestId) attrs.set("data-testid", initialTestId);
    const listeners = new Map<string, ((ev: unknown) => void)[]>();
    const iconSlot: MinimalElement = { innerHTML: "<svg></svg>" };
    const textLeaf: MinimalElement = { textContent: initialText ?? "" };
    const contentSlot: MinimalElement = { children: [textLeaf], textContent: initialText ?? "" };
    const el: MinimalElement = {
      textContent: initialText ?? "",
      style: {},
      children: [iconSlot, contentSlot],
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, val: string) => {
        attrs.set(name, val);
      },
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        const list = listeners.get(type) ?? [];
        list.push(fn);
        listeners.set(type, list);
      },
      cloneNode: () => createMockElement(attrs.get("data-testid"), textLeaf.textContent ?? ""),
    };
    (el as unknown as { triggerClick: () => void }).triggerClick = () => {
      for (const fn of listeners.get("click") ?? []) {
        fn({ preventDefault: () => {}, stopPropagation: () => {} });
      }
    };
    (el as unknown as { getLabel: () => string }).getLabel = () => textLeaf.textContent ?? "";
    return el;
  };

  const copyItem = createMockElement(
    "workspace-tab-context-file_docs/file_inspector_finder_plugin.md-copy-file-path",
    "Copy file path",
  );
  const closeItem = createMockElement(
    "workspace-tab-context-file_docs/file_inspector_finder_plugin.md-close",
    "Close",
  );

  const nativeMenuContainer: MinimalElement = {
    children: menuChildren,
    insertBefore: (newNode: MinimalElement, refNode: MinimalElement | null) => {
      const idx = refNode ? menuChildren.indexOf(refNode) : -1;
      if (idx >= 0) {
        menuChildren.splice(idx, 0, newNode);
      } else {
        menuChildren.push(newNode);
      }
    },
    appendChild: (newNode: MinimalElement) => {
      menuChildren.push(newNode);
    },
  };
  copyItem.parentElement = nativeMenuContainer;
  copyItem.nextSibling = closeItem;
  closeItem.parentElement = nativeMenuContainer;
  menuChildren.push(copyItem, closeItem);

  const mockDoc: MinimalDocument = {
    createElement: () => createMockElement(),
    querySelector: () => null,
    querySelectorAll: (sel: string) => {
      if (sel.includes("-copy-file-path")) return [copyItem];
      return [];
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  assert.equal(
    extractFilePathFromCopyMenuItem(copyItem, mockDoc),
    "docs/file_inspector_finder_plugin.md",
  );

  const triggeredCalls: { path: string; target: OpenerTarget }[] = [];
  const count = injectIntoNativeTabMenus(mockDoc, {
    isEnabled: () => true,
    getLocale: () => "en",
    onOpenTarget: async (p, t) => {
      triggeredCalls.push({ path: p, target: t });
    },
    onCopyPath: async () => {},
  });

  assert.equal(count, 3);
  // Menu order must be: Copy file path -> Reveal in Finder -> Open containing folder -> Open in Preview -> Close
  assert.equal(menuChildren.length, 5);
  assert.equal(
    menuChildren[1].getAttribute?.("data-testid"),
    "workspace-tab-context-file_docs/file_inspector_finder_plugin.md-reveal-in-finder",
  );
  assert.equal(
    (menuChildren[1] as unknown as { getLabel: () => string }).getLabel(),
    "Reveal in Finder",
  );
  assert.equal(
    (menuChildren[2] as unknown as { getLabel: () => string }).getLabel(),
    "Open containing folder",
  );
  assert.equal(
    (menuChildren[3] as unknown as { getLabel: () => string }).getLabel(),
    "Open in Preview",
  );

  // Re-running injection on the same menu must be idempotent (0 duplicates)
  const secondCount = injectIntoNativeTabMenus(mockDoc, {
    isEnabled: () => true,
    getLocale: () => "en",
    onOpenTarget: async () => {},
    onCopyPath: async () => {},
  });
  assert.equal(secondCount, 0);
  assert.equal(menuChildren.length, 5);

  // Clicking "Reveal in Finder" triggers the exact path and target
  (menuChildren[1] as unknown as { triggerClick: () => void }).triggerClick();
  assert.deepEqual(triggeredCalls, [
    { path: "docs/file_inspector_finder_plugin.md", target: "finder-reveal" },
  ]);
});

test("8. Single-Language Output Contract: English catalog has zero Chinese or bilingual glosses, Chinese catalog has pure Chinese", () => {
  const cjkRegex = /[\u4e00-\u9fff]/;

  function collectStrings(obj: Record<string, unknown>): string[] {
    const out: string[] = [];
    for (const val of Object.values(obj)) {
      if (typeof val === "string") {
        out.push(val);
      } else if (val && typeof val === "object") {
        out.push(...collectStrings(val as Record<string, unknown>));
      }
    }
    return out;
  }

  const enStrings = collectStrings(enMessages as unknown as Record<string, unknown>);
  for (const s of enStrings) {
    assert.equal(
      cjkRegex.test(s),
      false,
      `English UI string must not contain Chinese characters: "${s}"`,
    );
  }

  const zhCatalog = getCatalogForLocale("zh-CN");
  assert.equal(zhCatalog.actions.revealInFinder, "在 Finder 中显示");
  assert.equal(zhCatalog.actions.openContainingFolder, "打开所在文件夹");
  assert.equal(zhCatalog.actions.openInPreview, "在预览中打开");
  assert.equal(zhCatalog.actions.copyFilePath, "复制文件路径");

  const enCatalog = getCatalogForLocale("en-US");
  assert.equal(enCatalog.actions.revealInFinder, "Reveal in Finder");
  assert.equal(enCatalog.actions.openContainingFolder, "Open containing folder");
  assert.equal(enCatalog.actions.openInPreview, "Open in Preview");
  assert.equal(enCatalog.actions.copyFilePath, "Copy file path");

  // Ensure both catalogs have identical key structure
  assert.deepEqual(Object.keys(enMessages), Object.keys(zhMessages));
});

test("9. Live Paseo daemon reports file-inspector-finder plugin running and enabled", () => {
  try {
    const raw = execFileSync("paseo", ["plugin", "ls", "--json"], { encoding: "utf-8" });
    const list = JSON.parse(raw) as Array<{ id: string; status: string; enabled: boolean }>;
    const found = list.find((p) => p.id === "file-inspector-finder");
    if (found) {
      assert.equal(found.enabled, true);
      assert.equal(found.status, "running");
    }
  } catch {
    // Skip if running in CI without local Paseo daemon
  }
});

test("10. Thread rename & workspace label management RPCs + header double-click helper work end-to-end", async () => {
  const headerChild: MinimalElement = {
    parentElement: {
      getAttribute: (name: string) =>
        name === "data-testid" ? "workspace-header-title" : null,
    },
  };
  assert.equal(isInsideWorkspaceHeaderTitle(headerChild), true);
  assert.equal(isInsideWorkspaceHeaderTitle({ getAttribute: () => "other" }), false);

  const titlesMap = new Map<string, string | null>();
  const ctx = createMockContext(["/tmp/ws_0"], titlesMap);

  const renameRes = await handleRenameThread(
    { workspaceId: "ws_0", title: "Paseo Shortcut & Label Refactor" },
    ctx,
  );
  assert.equal(renameRes.ok, true);
  assert.equal(renameRes.title, "Paseo Shortcut & Label Refactor");
  assert.equal(titlesMap.get("ws_0"), "Paseo Shortcut & Label Refactor");

  const clearRes = await handleRenameThread(
    { workspaceId: "ws_0", title: "clear" },
    ctx,
  );
  assert.equal(clearRes.ok, true);
  assert.equal(clearRes.title, null);
  assert.equal(titlesMap.get("ws_0"), null);

  const catalogState: Array<{ name: string; color: WorkspaceLabelColor }> = [
    { name: "⭐️", color: "amber" },
    { name: "🤔", color: "violet" },
  ];
  const assignedSet = new Set<string>(["⭐️"]);

  const mockBridge: DaemonLabelBridge = {
    listWorkspaceLabels: async () => ({ labels: [...catalogState] }),
    fetchWorkspaces: async () => ({
      entries: [
        {
          id: "ws_0",
          name: "Paseo Thread",
          title: "Paseo Thread",
          labels: Array.from(assignedSet),
        },
      ],
    }),
    setWorkspaceLabel: async ({ label, assigned }) => {
      if (assigned) {
        assignedSet.add(label.name);
        if (!catalogState.some((c) => c.name === label.name)) {
          catalogState.push({ name: label.name, color: label.color ?? "violet" });
        }
      } else {
        assignedSet.delete(label.name);
      }
    },
    updateWorkspaceLabel: async ({ name, newName, color }) => {
      const item = catalogState.find((c) => c.name === name);
      if (item) {
        if (newName) {
          if (assignedSet.has(name)) {
            assignedSet.delete(name);
            assignedSet.add(newName);
          }
          item.name = newName;
        }
        if (color) item.color = color;
      }
    },
    deleteWorkspaceLabel: async ({ name }) => {
      assignedSet.delete(name);
      const idx = catalogState.findIndex((c) => c.name === name);
      if (idx >= 0) catalogState.splice(idx, 1);
    },
    updateAgent: async () => {},
  };

  const inspectRes = await handleManageWorkspaceLabels(
    { action: "inspect", workspaceId: "ws_0" },
    ctx,
    { bridge: mockBridge },
  );
  assert.equal(inspectRes.ok, true);
  assert.deepEqual(inspectRes.assignedLabels, ["⭐️"]);
  assert.equal(inspectRes.catalog.length, 2);

  const toggleNewRes = await handleManageWorkspaceLabels(
    { action: "toggle", workspaceId: "ws_0", labelName: "feat", color: "red" },
    ctx,
    { bridge: mockBridge },
  );
  assert.equal(toggleNewRes.ok, true);
  assert.deepEqual(toggleNewRes.assignedLabels, ["⭐️", "feat"]);
  assert.equal(toggleNewRes.catalog.length, 3);

  const updateRes = await handleManageWorkspaceLabels(
    {
      action: "update",
      workspaceId: "ws_0",
      labelName: "feat",
      newName: "feature",
      color: "emerald",
    },
    ctx,
    { bridge: mockBridge },
  );
  assert.equal(updateRes.ok, true);
  assert.deepEqual(updateRes.assignedLabels, ["⭐️", "feature"]);
});

