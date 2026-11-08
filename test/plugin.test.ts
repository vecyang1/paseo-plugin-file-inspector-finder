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
  importFolderWorkspaceRpc,
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
  handleImportFolderWorkspace,
  handleInspectFile,
  handleListWorkspaceMedia,
  handleManageWorkspaceLabels,
  handleOpenFileTarget,
  handleRenameThread,
  resolveBestPath,
} from "../server/handlers";
import {
  type MinimalDocument,
  type MinimalDragEvent,
  type MinimalElement,
  type MinimalWindow,
  decodeTabCloseTestId,
  extractDroppedFilePaths,
  extractFilePathFromCopyMenuItem,
  extractFilePathFromElement,
  findActiveFileTabPath,
  focusWorkspaceInApp,
  injectIntoNativeTabMenus,
  isExternalFileDragEvent,
  isInsideFileExplorer,
  isInsideSidebarDropZone,
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
    importFolderWorkspaceRpc,
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

test("11. Sidebar folder drag & drop workspace import: creates if not yet existed, reuses if already existed, resolves file parent, and supports Option+Drop force-new & dry-run", async () => {
  const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-folder-drop-"));
  const folderA = path.join(tmpParent, "2026-11-08 Design Systems");
  const folderB = path.join(tmpParent, "2026-11-08 Meta harness");
  await fs.mkdir(folderA, { recursive: true });
  await fs.mkdir(folderB, { recursive: true });
  const fileInA = path.join(folderA, "README.md");
  await fs.writeFile(fileInA, "# Design Systems\n");

  try {
    const activeWorkspaces: Array<{
      id: string;
      name: string;
      title?: string | null;
      projectId: string;
      workspaceDirectory: string;
    }> = [];
    let counter = 1;

    const mockCtx = {
      paseo: {
        workspaces: {
          list: async () => ({
            entries: [...activeWorkspaces],
          }),
          open: async (cwd: string) => {
            const norm = path.resolve(cwd);
            const found = activeWorkspaces.find(
              (w) => path.resolve(w.workspaceDirectory) === norm,
            );
            if (found) {
              return {
                id: found.id,
                name: found.name,
                projectId: found.projectId,
                directory: found.workspaceDirectory,
                setTitle: async (t: string | null) => {
                  found.title = t;
                  return { title: t };
                },
              };
            }
            const id = `wks_new_${counter++}`;
            const entry = {
              id,
              name: path.basename(norm),
              title: null as string | null,
              projectId: `prj_${counter}`,
              workspaceDirectory: norm,
            };
            activeWorkspaces.push(entry);
            return {
              id: entry.id,
              name: entry.name,
              projectId: entry.projectId,
              directory: entry.workspaceDirectory,
              setTitle: async (t: string | null) => {
                entry.title = t;
                return { title: t };
              },
            };
          },
          create: async (opts: { source: { path: string }; title?: string }) => {
            const norm = path.resolve(opts.source.path);
            const id = `wks_forced_${counter++}`;
            const entry = {
              id,
              name: opts.title ?? path.basename(norm),
              title: opts.title ?? null,
              projectId: `prj_${counter}`,
              workspaceDirectory: norm,
            };
            activeWorkspaces.push(entry);
            return {
              id: entry.id,
              name: entry.name,
              projectId: entry.projectId,
              directory: entry.workspaceDirectory,
              setTitle: async (t: string | null) => {
                entry.title = t;
                return { title: t };
              },
            };
          },
        },
      },
    } as never;

    // 1) Dry-run before folderA exists -> predicts creation without mutating state
    const preCheck = await handleImportFolderWorkspace(
      { paths: [folderA], dryRun: true, source: "ui" },
      mockCtx,
    );
    assert.equal(preCheck.ok, true);
    assert.equal(preCheck.dryRun, true);
    assert.equal(preCheck.createdCount, 1);
    assert.equal(preCheck.reusedCount, 0);
    assert.equal(activeWorkspaces.length, 0);

    // 2) First drop of folderA -> creates workspace ("if not yet existed")
    const firstDrop = await handleImportFolderWorkspace(
      { paths: [folderA], source: "sidebar-drop" },
      mockCtx,
    );
    assert.equal(firstDrop.ok, true);
    assert.equal(firstDrop.createdCount, 1);
    assert.equal(firstDrop.reusedCount, 0);
    assert.equal(firstDrop.items[0].created, true);
    assert.equal(firstDrop.items[0].alreadyExisted, false);
    assert.equal(firstDrop.primaryWorkspaceName, "2026-11-08 Design Systems");
    assert.equal(activeWorkspaces.length, 1);

    // 3) Second drop of folderA -> reuses existing workspace without duplicating!
    const secondDrop = await handleImportFolderWorkspace(
      { paths: [folderA], source: "sidebar-drop" },
      mockCtx,
    );
    assert.equal(secondDrop.ok, true);
    assert.equal(secondDrop.createdCount, 0);
    assert.equal(secondDrop.reusedCount, 1);
    assert.equal(secondDrop.items[0].created, false);
    assert.equal(secondDrop.items[0].alreadyExisted, true);
    assert.equal(secondDrop.primaryWorkspaceId, firstDrop.primaryWorkspaceId);
    assert.equal(activeWorkspaces.length, 1);

    // 4) Dropping a file inside folderA -> resolves parent directory & reuses folderA's workspace
    const fileDrop = await handleImportFolderWorkspace(
      { paths: [fileInA], source: "sidebar-drop" },
      mockCtx,
    );
    assert.equal(fileDrop.ok, true);
    assert.equal(fileDrop.items[0].fromFileParent, true);
    assert.equal(fileDrop.reusedCount, 1);
    assert.equal(fileDrop.primaryWorkspaceId, firstDrop.primaryWorkspaceId);

    // 5) Option+Drop (mode: "always-create") -> forces a second fresh workspace thread
    const forceNewDrop = await handleImportFolderWorkspace(
      { paths: [folderA], mode: "always-create", source: "sidebar-drop" },
      mockCtx,
    );
    assert.equal(forceNewDrop.ok, true);
    assert.equal(forceNewDrop.createdCount, 1);
    assert.notEqual(forceNewDrop.primaryWorkspaceId, firstDrop.primaryWorkspaceId);
    assert.equal(activeWorkspaces.length, 2);

    // 6) Respects enableSidebarFolderDrop=false in settings
    const disabledDrop = await handleImportFolderWorkspace(
      { paths: [folderB], source: "sidebar-drop" },
      mockCtx,
      {
        readSettings: async () => ({
          status: "ready",
          values: {
            enableSidebarFolderDrop: false,
            sidebarDropDefaultBehavior: "open-or-create",
          },
        }),
      },
    );
    assert.equal(disabledDrop.ok, false);
    assert.equal(disabledDrop.disabled, true);
    assert.equal(activeWorkspaces.length, 2);
  } finally {
    await fs.rm(tmpParent, { recursive: true, force: true });
  }
});

test("12. Sidebar drop zone boundaries, Electron webUtils path extraction, and workspace row focus", () => {
  let clickedRowId = "";
  const sidebarWsRow: MinimalElement = {
    getAttribute: (n) => (n === "data-testid" ? "sidebar-workspace-row-local:wks_design" : null),
    click: () => {
      clickedRowId = "wks_design";
    },
  };
  const composerNode: MinimalElement = {
    getAttribute: (n) => (n === "data-testid" ? "chat-composer-dropzone" : null),
  };
  const mockDoc: MinimalDocument = {
    createElement: () => ({}),
    querySelector: () => null,
    querySelectorAll: (sel) =>
      sel.includes("sidebar-workspace-row-") ? [sidebarWsRow] : [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  assert.equal(isInsideSidebarDropZone(sidebarWsRow, mockDoc), true);
  assert.equal(isInsideSidebarDropZone(composerNode, mockDoc), false);

  const finderDrag: MinimalDragEvent = {
    target: sidebarWsRow,
    dataTransfer: {
      types: ["Files"],
      files: [{ name: "2026-11-08 Design Systems" }],
    },
    preventDefault: () => {},
    stopPropagation: () => {},
  };
  assert.equal(isExternalFileDragEvent(finderDrag), true);

  const internalDrag: MinimalDragEvent = {
    target: sidebarWsRow,
    dataTransfer: {
      types: ["application/x-paseo-workspace-file", "Files"],
    },
    preventDefault: () => {},
    stopPropagation: () => {},
  };
  assert.equal(isExternalFileDragEvent(internalDrag), false);

  const mockWin: MinimalWindow = {
    paseoDesktop: {
      webUtils: {
        getPathForFile: () => "/Users/dev/Projects/2026-11-08 Design Systems",
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  assert.deepEqual(extractDroppedFilePaths(finderDrag, mockWin), [
    "/Users/dev/Projects/2026-11-08 Design Systems",
  ]);

  assert.equal(focusWorkspaceInApp("wks_design", null, mockDoc, mockWin), true);
  assert.equal(clickedRowId, "wks_design");
});


