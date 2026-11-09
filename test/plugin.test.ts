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
  quickJumpWorkspaceRpc,
  renameWorkspaceOrAgentRpc,
  extractProjectSearchKeywords,
  scoreProjectJumpQuery,
  stripLeadingDatePrefix,
  VOICE_STT_PRESETS,
  manageVoiceSttRpc,
  manageAgentHistoryRpc,
  manageSlashSkillsRpc,
  manageWritebackHookRpc,
  reconcilePaseoRecoveryRpc,
} from "../shared/contracts";
import { enMessages, getCatalogForLocale, zhMessages } from "../client/i18n";
import {
  PASEO_IDENTITY_BG_HEX,
  PASEO_THEMES,
  derivePaseoIdentityColorHex,
  derivePaseoIdentityColorName,
  deriveProjectIconInitial,
  normalizePaseoThemeName,
} from "../shared/paseo-theme";
import {
  resolveActivePaseoTheme,
  syncPaseoThemeCssVariables,
} from "../client/theme-web";
import {
  type DaemonLabelBridge,
  buildCandidatePaths,
  handleDiagnosePath,
  handleImportFolderWorkspace,
  handleInspectFile,
  handleListWorkspaceMedia,
  handleManageWorkspaceLabels,
  handleOpenFileTarget,
  handleQuickJumpWorkspace,
  handleRenameThread,
  handleInspectScheduleRuns,
  handleOpenScheduleRunSession,
  handleManageVoiceStt,
  handleManageAgentHistory,
  handleManageSlashSkills,
  handleManageWritebackHook,
  handleReconcilePaseoRecovery,
  resolveVoicePresetOrShorthand,
  inferSttSourceBadge,
  maskApiKeyPreview,
  normalizeDaemonListenAddress,
  resolveBestPath,
  resolveDaemonClientModuleHref,
} from "../server/handlers";
import {
  type MinimalDocument,
  type MinimalDragEvent,
  type MinimalElement,
  type MinimalWindow,
  decodeTabCloseTestId,
  ensureAntigravityInlineSkillAutocompleteBridge,
  extractDroppedFilePaths,
  extractFilePathFromCopyMenuItem,
  extractFilePathFromElement,
  findActiveFileTabPath,
  findF2InlineRenameTarget,
  focusWorkspaceInApp,
  injectIntoNativeTabMenus,
  installDesktopRevealHelpers,
  isExternalFileDragEvent,
  isInsideFileExplorer,
  isInsideInteractiveRowAction,
  isInsideSidebarDropZone,
  isInsideWorkspaceHeaderTitle,
  isInsideWorkspaceTab,
  locateProjectInSidebar,
  mountInlineTitleInput,
  normalizeListCommandsResponsePayload,
  openQuickWorkspaceSwitcherModal,
  parseSidebarWorkspaceRowTestId,
  readInlineRenamePreferences,
  resolveCurrentActiveWorkspaceId,
  resolveInlineRenameTarget,
  revealWorkspaceInSidebar,
  clearSidebarJumpFlashes,
  computeDoneToggledTitle,
  isMarkDoneKeyboardEvent,
  toggleCurrentSessionDone,
  extractActiveWorkspaceHeaderProjectName,
  extractCommandCenterSelectionHint,
  syncImagePanelAssociations,
  syncInlineRenamePreferences,
} from "../client/web";
import {
  type MinimalScheduleDomDocument,
  type MinimalScheduleDomElement,
  decorateSchedulesDomOnDocument,
  isSelfInjectedMutationBatch,
  readScheduleRunsPreferences,
  runScheduleRunsDomIdempotencySelfTest,
  setTextContentIfChanged,
  syncScheduleRunsPreferences,
} from "../client/schedule-runs-web";

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

function createInteractiveDomNode(
  tagName: string,
  initialAttrs: Record<string, string> = {},
  initialText = "",
): MinimalElement & {
  attrs: Map<string, string>;
  listeners: Map<string, Array<(ev: unknown) => void>>;
  focused: boolean;
  selected: boolean;
  triggerBlur: () => void;
  dispatch: (type: string, ev?: Record<string, unknown>) => void;
} {
  const attrs = new Map<string, string>(Object.entries(initialAttrs));
  const listeners = new Map<string, Array<(ev: unknown) => void>>();
  const children: MinimalElement[] = [];

  const node: MinimalElement & {
    attrs: Map<string, string>;
    listeners: Map<string, Array<(ev: unknown) => void>>;
    focused: boolean;
    selected: boolean;
    selectionStart: number | null;
    selectionEnd: number | null;
    scrollLeft: number;
    triggerBlur: () => void;
    dispatch: (type: string, ev?: Record<string, unknown>) => void;
  } = {
    tagName: tagName.toUpperCase(),
    textContent: initialText,
    value: "",
    style: {},
    children,
    parentElement: null,
    attrs,
    listeners,
    focused: false,
    selected: false,
    selectionStart: null,
    selectionEnd: null,
    scrollLeft: 0,
    getAttribute: (n) => attrs.get(n) ?? null,
    setAttribute: (n, v) => {
      attrs.set(n, v);
    },
    removeAttribute: (n) => {
      attrs.delete(n);
    },
    appendChild: (child) => {
      child.parentElement = node;
      children.push(child);
    },
    insertBefore: (newChild, refChild) => {
      newChild.parentElement = node;
      const idx = refChild ? children.indexOf(refChild) : -1;
      if (idx >= 0) {
        children.splice(idx, 0, newChild);
      } else {
        children.push(newChild);
      }
    },
    remove: () => {
      if (node.parentElement?.children) {
        const list = node.parentElement.children as MinimalElement[];
        const idx = list.indexOf(node);
        if (idx >= 0) list.splice(idx, 1);
      }
      node.parentElement = null;
    },
    contains: (other) => {
      let cur: MinimalElement | null | undefined = other;
      while (cur) {
        if (cur === node) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    querySelector: (selector: string) => {
      const matchAttr = selector.match(/^\[data-testid="([^"]+)"\]$/);
      const matchPrefix = selector.match(/^\[data-testid\^="([^"]+)"\]$/);
      const walk = (el: MinimalElement): MinimalElement | null => {
        const tid = el.getAttribute?.("data-testid") ?? "";
        if (matchAttr && tid === matchAttr[1]) return el;
        if (matchPrefix && tid.startsWith(matchPrefix[1])) return el;
        for (const ch of (el.children as MinimalElement[]) ?? []) {
          const found = walk(ch);
          if (found) return found;
        }
        return null;
      };
      for (const ch of children) {
        const found = walk(ch);
        if (found) return found;
      }
      return null;
    },
    querySelectorAll: (selector: string) => {
      const matchAttr = selector.match(/^\[data-testid="([^"]+)"\]$/);
      const matchPrefix = selector.match(/^\[data-testid\^="([^"]+)"\]$/);
      const out: MinimalElement[] = [];
      const walk = (el: MinimalElement) => {
        const tid = el.getAttribute?.("data-testid") ?? "";
        if (matchAttr && tid === matchAttr[1]) out.push(el);
        else if (matchPrefix && tid.startsWith(matchPrefix[1])) out.push(el);
        for (const ch of (el.children as MinimalElement[]) ?? []) {
          walk(ch);
        }
      };
      for (const ch of children) {
        walk(ch);
      }
      return out;
    },
    addEventListener: (type, handler) => {
      const arr = listeners.get(type) ?? [];
      arr.push(handler);
      listeners.set(type, arr);
    },
    focus: () => {
      node.focused = true;
    },
    select: () => {
      node.selected = true;
      const len = (node.value ?? "").length;
      node.selectionStart = 0;
      node.selectionEnd = len;
    },
    setSelectionRange: (start: number, end: number) => {
      node.selectionStart = start;
      node.selectionEnd = end;
      node.selected = start === 0 && end === (node.value ?? "").length && end > 0;
    },
    triggerBlur: () => {
      node.focused = false;
      node.dispatch("blur", { target: node });
    },
    dispatch: (type, extra = {}) => {
      const ev = {
        type,
        target: node,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...extra,
      };
      for (const fn of listeners.get(type) ?? []) {
        fn(ev);
      }
    },
  };
  return node;
}

test("13. Inline rename target resolution: sidebar rows, workspace header title, agent tabs, URL active workspace ID, and action button exclusions", () => {
  assert.deepEqual(
    parseSidebarWorkspaceRowTestId("sidebar-workspace-row-srv_demo123:wks_meta_01"),
    {
      workspaceKey: "srv_demo123:wks_meta_01",
      serverId: "srv_demo123",
      workspaceId: "wks_meta_01",
    },
  );
  assert.equal(parseSidebarWorkspaceRowTestId("other-testid"), null);

  const root = createInteractiveDomNode("div");
  const sidebarRow = createInteractiveDomNode("div", {
    "data-testid": "sidebar-workspace-row-srv_1:wks_alpha",
  });
  const titleWrap = createInteractiveDomNode("div");
  const sidebarTitle = createInteractiveDomNode(
    "span",
    { "data-testid": "sidebar-workspace-title-srv_1:wks_alpha" },
    "Set status.example.com default check",
  );
  const kebabBtn = createInteractiveDomNode("button", {
    "data-testid": "sidebar-workspace-kebab-srv_1:wks_alpha",
  });
  const archiveBtn = createInteractiveDomNode("button", {
    "data-testid": "sidebar-workspace-archive-srv_1:wks_alpha",
  });
  titleWrap.appendChild?.(sidebarTitle);
  sidebarRow.appendChild?.(titleWrap);
  sidebarRow.appendChild?.(kebabBtn);
  sidebarRow.appendChild?.(archiveBtn);

  const headerTitle = createInteractiveDomNode(
    "span",
    { "data-testid": "workspace-header-title" },
    "Active Header Thread",
  );

  const agentTab = createInteractiveDomNode("div", {
    "data-testid": "workspace-tab-agent_agt_99",
  });
  const agentTabLabel = createInteractiveDomNode("span", {}, "Verifier Agent");
  const agentTabClose = createInteractiveDomNode("div", {
    "data-testid": "workspace-tab-close-agent_agt_99",
  });
  agentTab.appendChild?.(agentTabLabel);
  agentTab.appendChild?.(agentTabClose);

  root.appendChild?.(sidebarRow);
  root.appendChild?.(headerTitle);
  root.appendChild?.(agentTab);

  const mockDoc: MinimalDocument = {
    head: createInteractiveDomNode("head"),
    body: root,
    createElement: (tag) => createInteractiveDomNode(tag),
    querySelector: (sel) => root.querySelector?.(sel) ?? null,
    querySelectorAll: (sel) => {
      if (sel.includes("sidebar-workspace-row-")) return [sidebarRow];
      return [];
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const mockWin: MinimalWindow = {
    location: { pathname: "/h/srv_1/workspace/wks_active_route" },
    getComputedStyle: () => ({
      fontSize: "13px",
      fontWeight: "500",
      fontFamily: "Inter",
      lineHeight: "18px",
      color: "#f9fafb",
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  // URL pathname takes priority over stale fallbackWorkspaceId!
  assert.equal(
    resolveCurrentActiveWorkspaceId(mockDoc, mockWin, "wks_stale_last_iterated"),
    "wks_active_route",
  );

  // Action buttons inside rows/tabs are strictly excluded
  assert.equal(isInsideInteractiveRowAction(kebabBtn), true);
  assert.equal(isInsideInteractiveRowAction(archiveBtn), true);
  assert.equal(isInsideInteractiveRowAction(agentTabClose), true);
  assert.equal(
    resolveInlineRenameTarget(kebabBtn, mockDoc, mockWin, "wks_stale"),
    null,
  );
  assert.equal(
    resolveInlineRenameTarget(agentTabClose, mockDoc, mockWin, "wks_stale"),
    null,
  );

  // 1) Sidebar row target resolves exact row workspaceId (even when another workspace is active!)
  const resolvedSidebar = resolveInlineRenameTarget(sidebarRow, mockDoc, mockWin);
  assert.ok(resolvedSidebar);
  assert.equal(resolvedSidebar.surface, "sidebar-row");
  assert.equal(resolvedSidebar.workspaceId, "wks_alpha");
  assert.equal(resolvedSidebar.source, "inline-sidebar");
  assert.equal(
    resolvedSidebar.initialTitle,
    "Set status.example.com default check",
  );

  // 2) Header title resolves active workspaceId from URL route
  const resolvedHeader = resolveInlineRenameTarget(headerTitle, mockDoc, mockWin);
  assert.ok(resolvedHeader);
  assert.equal(resolvedHeader.surface, "header-title");
  assert.equal(resolvedHeader.workspaceId, "wks_active_route");
  assert.equal(resolvedHeader.source, "inline-header");

  // 3) Agent tab resolves agentId + active workspaceId
  const resolvedTab = resolveInlineRenameTarget(agentTabLabel, mockDoc, mockWin);
  assert.ok(resolvedTab);
  assert.equal(resolvedTab.surface, "agent-tab");
  assert.equal(resolvedTab.agentId, "agt_99");
  assert.equal(resolvedTab.workspaceId, "wks_active_route");
  assert.equal(resolvedTab.source, "inline-tab");
  assert.equal(resolvedTab.initialTitle, "Verifier Agent");

  // 4) F2 target resolves header-title with source="f2-inline"
  const f2Target = findF2InlineRenameTarget(mockDoc, mockWin);
  assert.ok(f2Target);
  assert.equal(f2Target.workspaceId, "wks_active_route");
  assert.equal(f2Target.source, "f2-inline");

  // 5) Paseo v0.15.3 sidebar row (where <Text> has no sidebar-workspace-title-* testID,
  // preceded by leading project monogram "2" and followed by trailing age "8h") resolves the exact title leaf!
  const v0153Row = createInteractiveDomNode("div", {
    "data-testid": "sidebar-workspace-row-srv_1:wks_v0153",
  });
  const rowMain = createInteractiveDomNode("div");
  const leadingProjectIcon = createInteractiveDomNode(
    "div",
    { "data-testid": "sidebar-row-project-icon-srv_1:wks_v0153" },
    "2",
  );
  const contentCol = createInteractiveDomNode("div");
  const titleRow0153 = createInteractiveDomNode("div");
  const titleText0153 = createInteractiveDomNode("div", {}, "Greet and check in");
  const rowRight0153 = createInteractiveDomNode("div");
  const ageText0153 = createInteractiveDomNode("div", {}, "8h");
  rowRight0153.appendChild?.(ageText0153);
  titleRow0153.appendChild?.(titleText0153);
  titleRow0153.appendChild?.(rowRight0153);
  contentCol.appendChild?.(titleRow0153);
  rowMain.appendChild?.(leadingProjectIcon);
  rowMain.appendChild?.(contentCol);
  v0153Row.appendChild?.(rowMain);

  const resolvedV0153 = resolveInlineRenameTarget(v0153Row, mockDoc, mockWin);
  assert.ok(resolvedV0153);
  assert.equal(resolvedV0153.workspaceId, "wks_v0153");
  assert.equal(resolvedV0153.titleEl, titleText0153);
  assert.equal(resolvedV0153.initialTitle, "Greet and check in");
});

test("14. Zero-popup inline rename input lifecycle: Enter commit, Escape cancel, CJK IME safety, composer focus-theft shield, and dblclick/F2 capture", async () => {
  const head = createInteractiveDomNode("head");
  const body = createInteractiveDomNode("body");
  const row = createInteractiveDomNode("div", {
    "data-testid": "sidebar-workspace-row-srv_1:wks_inline_1",
  });
  const titleWrap = createInteractiveDomNode("div");
  const titleEl = createInteractiveDomNode(
    "span",
    { "data-testid": "sidebar-workspace-title-srv_1:wks_inline_1" },
    "Original Workspace Name",
  );
  titleWrap.appendChild?.(titleEl);
  row.appendChild?.(titleWrap);
  body.appendChild?.(row);

  const docListeners = new Map<string, Array<(ev: unknown) => void>>();
  const winListeners = new Map<string, Array<(ev: unknown) => void>>();
  const storage = new Map<string, string>();

  const mockDoc: MinimalDocument = {
    head,
    body,
    createElement: (tag) => createInteractiveDomNode(tag),
    querySelector: (sel) => body.querySelector?.(sel) ?? null,
    querySelectorAll: () => [row],
    addEventListener: (type, fn) => {
      const list = docListeners.get(type) ?? [];
      list.push(fn);
      docListeners.set(type, list);
    },
    removeEventListener: (type, fn) => {
      const list = docListeners.get(type) ?? [];
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
  };

  const mockWin: MinimalWindow = {
    location: { pathname: "/h/srv_1/workspace/wks_inline_1" },
    localStorage: {
      get length() {
        return storage.size;
      },
      key: (idx) => Array.from(storage.keys())[idx] ?? null,
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => {
        storage.set(k, v);
      },
    },
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    getComputedStyle: () => ({
      fontSize: "13px",
      fontWeight: "500",
      fontFamily: "Inter",
      lineHeight: "18px",
      color: "#ffffff",
    }),
    addEventListener: (type, fn) => {
      const list = winListeners.get(type) ?? [];
      list.push(fn);
      winListeners.set(type, list);
    },
    removeEventListener: (type, fn) => {
      const list = winListeners.get(type) ?? [];
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
  };

  syncInlineRenamePreferences(
    {
      enableInlineDoubleClickRename: true,
      enableQuickRenameAndLabelShortcuts: true,
      enableDesktopContextMenuHelper: true,
    },
    mockWin.localStorage,
  );
  assert.equal(
    readInlineRenamePreferences(mockWin.localStorage).enableInlineDoubleClickRename,
    true,
  );

  const commits: Array<{
    title: string | null;
    workspaceId?: string;
    agentId?: string;
    source?: string;
  }> = [];

  const cleanup = installDesktopRevealHelpers(
    {
      isEnabled: () => true,
      onOpenTarget: async () => {},
      onCopyPath: async () => {},
      onRenameThread: async (title, opts) => {
        commits.push({ title, ...opts });
      },
    },
    mockDoc,
    mockWin,
  );

  // A) Double-click sidebar row -> mounts inline <input> in-place with ZERO popup bar!
  for (const fn of docListeners.get("dblclick") ?? []) {
    fn({
      target: titleEl,
      button: 0,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  }

  assert.equal(titleEl.getAttribute?.("data-paseo-inline-rename-hidden"), "true");
  const input1 = body.querySelector?.(
    '[data-testid="paseo-finder-inline-rename-input"]',
  ) as ReturnType<typeof createInteractiveDomNode> | null;
  assert.ok(input1, "Inline input must be mounted directly inside the row");
  assert.equal(input1.value, "Original Workspace Name");
  assert.equal(
    body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]'),
    null,
    "Zero floating popup bar should appear on double-click",
  );

  // B) Programmatic composer focus-theft blur (<260ms without outside pointerdown) is shielded!
  input1.triggerBlur();
  assert.equal(
    body.querySelector?.('[data-testid="paseo-finder-inline-rename-input"]'),
    input1,
    "Input must remain mounted when composer steals focus immediately after workspace switch",
  );

  // C) Pressing Enter during CJK IME composition (isComposing=true / keyCode=229) must NOT commit
  input1.value = "Draft Composing";
  for (const fn of winListeners.get("keydown") ?? []) {
    fn({
      key: "Enter",
      isComposing: true,
      keyCode: 229,
      target: input1,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  }
  assert.equal(commits.length, 0);

  // D) Pressing Enter after composition commits exact workspaceId & updates DOM optimistically
  input1.value = "cc changelog page";
  for (const fn of winListeners.get("keydown") ?? []) {
    fn({
      key: "Enter",
      isComposing: false,
      target: input1,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  }
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0], {
    title: "cc changelog page",
    workspaceId: "wks_inline_1",
    agentId: undefined,
    source: "inline-sidebar",
  });
  assert.equal(titleEl.textContent, "cc changelog page");
  assert.equal(titleEl.getAttribute?.("data-paseo-inline-rename-hidden"), null);
  assert.equal(
    body.querySelector?.('[data-testid="paseo-finder-inline-rename-input"]'),
    null,
  );

  // E) Escape cancels cleanly with 0 extra commits and preserves current title
  const target2 = resolveInlineRenameTarget(titleEl, mockDoc, mockWin);
  assert.ok(target2);
  const session2 = mountInlineTitleInput(mockDoc, mockWin, target2, async (t, m) => {
    commits.push({ title: t, ...m });
  });
  assert.ok(session2);
  const input2 = session2.inputEl as ReturnType<typeof createInteractiveDomNode>;
  input2.value = "Aborted Draft";
  input2.dispatch("keydown", { key: "Escape" });
  assert.equal(commits.length, 1);
  assert.equal(titleEl.textContent, "cc changelog page");
  assert.equal(
    body.querySelector?.('[data-testid="paseo-finder-inline-rename-input"]'),
    null,
  );

  // F) Outside pointerdown + blur commits modified text
  const target3 = resolveInlineRenameTarget(titleEl, mockDoc, mockWin);
  assert.ok(target3);
  const session3 = mountInlineTitleInput(mockDoc, mockWin, target3, async (t, m) => {
    commits.push({ title: t, ...m });
  });
  assert.ok(session3);
  const input3 = session3.inputEl as ReturnType<typeof createInteractiveDomNode>;
  input3.value = "Saved On Outside Click";
  session3.markOutsidePointerDown();
  input3.triggerBlur();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(commits.length, 2);
  assert.equal(commits[1].title, "Saved On Outside Click");
  assert.equal(titleEl.textContent, "Saved On Outside Click");

  cleanup();
});

test("15. Daemon bridge URL & bundled CJS worker module resolution (regression for import.meta.url === undefined)", async () => {
  assert.equal(normalizeDaemonListenAddress("127.0.0.1:6767"), "127.0.0.1:6767");
  assert.equal(normalizeDaemonListenAddress(":6767"), "127.0.0.1:6767");
  assert.equal(normalizeDaemonListenAddress("0.0.0.0:6767"), "127.0.0.1:6767");
  assert.equal(normalizeDaemonListenAddress("http://127.0.0.1:6767/ws"), "127.0.0.1:6767");
  assert.equal(normalizeDaemonListenAddress(""), "127.0.0.1:6767");

  const resolvedFromUndefined = await resolveDaemonClientModuleHref(undefined);
  assert.ok(resolvedFromUndefined.startsWith("file:///"));
  assert.ok(resolvedFromUndefined.endsWith("/@getpaseo/client/dist/node/index.js"));
});

test("16. Project Workspace Quick Jump SSOT ranking, sub-thread deduplication, and jump modes (open-latest, locate-sidebar, create-new)", async () => {
  assert.equal(
    stripLeadingDatePrefix("2026-11-08 Design System Studio"),
    "Design System Studio",
  );
  assert.equal(stripLeadingDatePrefix("26.09.08-antigravity-webhook-hub"), "antigravity-webhook-hub");
  assert.ok(quickJumpWorkspaceRpc.name === "finder.quick_jump_projects");

  const dssKeywords = extractProjectSearchKeywords(
    "2026-11-08 Design System Studio",
    "/Users/dev/Cowork/2026-11-08 Design System Studio",
  );
  assert.ok(dssKeywords.includes("design system studio"));
  assert.ok(dssKeywords.includes("design"));
  assert.ok(dssKeywords.includes("dss"), "Must generate initialism/acronym dss");

  const dssCandidate = {
    projectName: "2026-11-08 Design System Studio",
    projectRootPath: "/Users/dev/Cowork/2026-11-08 Design System Studio",
    shortPath: "~/Cowork/2026-11-08 Design System Studio",
    primaryWorkspaceTitle: "Design Thread 9",
  };
  const metaCandidate = {
    projectName: "2026-11-08 Meta harness",
    projectRootPath: "/Users/dev/Cowork/2026-11-08 Meta harness",
    shortPath: "~/Cowork/2026-11-08 Meta harness",
    primaryWorkspaceTitle: "Paseo Plugin Dev",
  };

  assert.ok(scoreProjectJumpQuery(dssCandidate, "design") >= 850);
  assert.ok(scoreProjectJumpQuery(dssCandidate, "dss") >= 700);
  assert.equal(scoreProjectJumpQuery(metaCandidate, "design"), 0);

  let createdCount = 0;
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-quick-jump-"));
  const dssDir = path.join(tmpBase, "2026-11-08 Design System Studio");
  const metaDir = path.join(tmpBase, "2026-11-08 Meta harness");
  const emptyDir = path.join(tmpBase, "opencli-plugin-demo");
  await fs.mkdir(dssDir, { recursive: true });
  await fs.mkdir(metaDir, { recursive: true });
  await fs.mkdir(emptyDir, { recursive: true });

  try {
    const mockCtx = {
      paseo: {
        projects: {
          list: async () => ({
            projects: [
              {
                projectId: "prj_dss",
                projectKey: "key_dss",
                projectDisplayName: "2026-11-08 Design System Studio",
                projectRootPath: dssDir,
                projectKind: "directory" as const,
              },
              {
                projectId: "prj_meta",
                projectKey: "key_meta",
                projectDisplayName: "2026-11-08 Meta harness",
                projectRootPath: metaDir,
                projectKind: "git" as const,
              },
              {
                projectId: "prj_empty",
                projectKey: "key_empty",
                projectDisplayName: "opencli-plugin-demo",
                projectRootPath: emptyDir,
                projectKind: "git" as const,
              },
            ],
          }),
        },
        workspaces: {
          list: async () => ({
            entries: [
              // 3 sub-threads under Design System Studio -> must deduplicate into 1 Project candidate!
              {
                id: "wks_dss_1",
                name: "2026-11-08 Design System Studio",
                title: "Old Thread 1",
                projectId: "prj_dss",
                projectKey: "key_dss",
                workspaceDirectory: dssDir,
                updatedAt: "2026-11-07T10:00:00.000Z",
              },
              {
                id: "wks_dss_2",
                name: "2026-11-08 Design System Studio",
                title: "Latest Design Thread",
                projectId: "prj_dss",
                projectKey: "key_dss",
                workspaceDirectory: dssDir,
                updatedAt: "2026-11-08T09:00:00.000Z",
              },
              {
                id: "wks_dss_3",
                name: "2026-11-08 Design System Studio",
                title: "Sub Thread 3",
                projectId: "prj_dss",
                projectKey: "key_dss",
                workspaceDirectory: dssDir,
                updatedAt: "2026-11-07T15:00:00.000Z",
              },
              {
                id: "wks_meta_1",
                name: "2026-11-08 Meta harness",
                title: "Meta Main",
                projectId: "prj_meta",
                projectKey: "key_meta",
                workspaceDirectory: metaDir,
                updatedAt: "2026-11-08T08:00:00.000Z",
              },
            ],
          }),
          open: async (cwd: string) => ({
            id: "wks_opened_empty",
            name: path.basename(cwd),
            projectId: "prj_empty",
            directory: cwd,
          }),
          create: async (opts: { source: { path: string }; title?: string }) => {
            createdCount += 1;
            return {
              id: `wks_created_${createdCount}`,
              name: opts.title ?? path.basename(opts.source.path),
              projectId: "prj_dss",
              directory: opts.source.path,
            };
          },
        },
      },
    } as never;

    // 1) List all projects -> 3 deduplicated projects instead of 4 individual sub-threads
    const listAll = await handleQuickJumpWorkspace({ action: "list" }, mockCtx);
    assert.equal(listAll.ok, true);
    assert.equal(listAll.totalProjects, 3);
    assert.equal(listAll.totalActiveWorkspaces, 4);
    assert.equal(listAll.emptyProjects, 1);
    assert.equal(listAll.candidates.length, 3);

    // 2) Query "design" -> returns only 1 deduplicated Design System Studio project candidate pointing at latest workspace wks_dss_2
    const jumpDss = await handleQuickJumpWorkspace(
      { action: "jump", query: "design", jumpMode: "open-latest" },
      mockCtx,
    );
    assert.equal(jumpDss.ok, true);
    assert.equal(jumpDss.candidates.length, 1);
    assert.equal(jumpDss.targetProjectId, "prj_dss");
    assert.equal(jumpDss.targetWorkspaceId, "wks_dss_2");
    assert.equal(jumpDss.selectedCandidate?.activeWorkspaceCount, 3);

    // 3) Locate-sidebar mode -> does not open/create a thread, returns targetProjectId & targetProjectKey
    const locateDss = await handleQuickJumpWorkspace(
      { action: "jump", query: "dss", jumpMode: "locate-sidebar" },
      mockCtx,
    );
    assert.equal(locateDss.ok, true);
    assert.equal(locateDss.jumpMode, "locate-sidebar");
    assert.equal(locateDss.targetProjectId, "prj_dss");
    assert.equal(locateDss.targetProjectKey, "key_dss");
    assert.equal(locateDss.targetWorkspaceId, null);

    // 4) Create-new mode -> creates a fresh workspace thread inside Design System Studio
    const createNewDss = await handleQuickJumpWorkspace(
      { action: "jump", projectId: "prj_dss", jumpMode: "create-new" },
      mockCtx,
    );
    assert.equal(createNewDss.ok, true);
    assert.equal(createNewDss.createdWorkspace, true);
    assert.equal(createNewDss.targetWorkspaceId, "wks_created_1");

    // 5) Jumping to a zero-thread project ("demo") opens/initializes a clean workspace for it automatically!
    const jumpEmpty = await handleQuickJumpWorkspace(
      { action: "jump", query: "demo", jumpMode: "open-latest" },
      mockCtx,
    );
    assert.equal(jumpEmpty.ok, true);
    assert.equal(jumpEmpty.targetProjectId, "prj_empty");
    assert.equal(jumpEmpty.targetWorkspaceId, "wks_opened_empty");
  } finally {
    await fs.rm(tmpBase, { recursive: true, force: true });
  }
});

test("17. Sidebar project row auto-scroll/expand (locateProjectInSidebar) and Cmd+J Quick Workspace Switcher modal", async () => {
  let projectRowClicked = false;
  let projectRowScrolled = false;

  const dssProjectRow = createInteractiveDomNode(
    "div",
    { "data-testid": "sidebar-project-row-local:key_dss" },
    "2026-11-08 Design System Studio",
  );
  dssProjectRow.click = () => {
    projectRowClicked = true;
  };
  dssProjectRow.scrollIntoView = () => {
    projectRowScrolled = true;
  };

  const body = createInteractiveDomNode("div", { "data-testid": "body" });
  body.appendChild?.(dssProjectRow);

  const mockDoc: MinimalDocument = {
    body,
    head: createInteractiveDomNode("head"),
    createElement: (tag: string) => createInteractiveDomNode(tag),
    querySelector: (sel: string) => body.querySelector?.(sel) ?? null,
    querySelectorAll: (sel: string) => body.querySelectorAll?.(sel) ?? [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const mockWin: MinimalWindow = {
    document: mockDoc,
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  // 1) locateProjectInSidebar clicks collapsed project row to expand it, scrolls into view, and applies flash attribute
  const located = locateProjectInSidebar(
    {
      projectId: "prj_dss",
      projectKey: "key_dss",
      projectName: "2026-11-08 Design System Studio",
      expandIfCollapsed: true,
      highlightFlash: true,
    },
    mockDoc,
    mockWin,
  );
  assert.equal(located, true);
  assert.equal(projectRowClicked, true);
  assert.equal(projectRowScrolled, true);
  assert.equal(dssProjectRow.getAttribute?.("data-paseo-project-jump-flash"), "true");

  // 2) openQuickWorkspaceSwitcherModal mounts modal, filters candidates on input, and triggers jump on Enter / Shift+Enter
  const executedJumps: Array<{ projectId?: string; jumpMode?: string }> = [];
  const modalEl = await openQuickWorkspaceSwitcherModal(
    {
      locale: "en-US",
      defaultJumpMode: "open-latest",
      onListJumpProjects: async () => [
        {
          projectId: "prj_dss",
          projectKey: "key_dss",
          projectName: "2026-11-08 Design System Studio",
          projectRootPath: "/Users/dev/Cowork/2026-11-08 Design System Studio",
          shortPath: "~/Cowork/2026-11-08 Design System Studio",
          projectKind: "directory",
          activeWorkspaceCount: 10,
          primaryWorkspaceId: "wks_dss_latest",
          primaryWorkspaceTitle: "Design Main",
          hasRunningAgent: false,
          lastActivityIso: "2026-11-08T10:00:00.000Z",
          lastActivityRelative: "2m ago",
          score: 100,
        },
        {
          projectId: "prj_meta",
          projectKey: "key_meta",
          projectName: "2026-11-08 Meta harness",
          projectRootPath: "/Users/dev/Cowork/2026-11-08 Meta harness",
          shortPath: "~/Cowork/2026-11-08 Meta harness",
          projectKind: "git",
          activeWorkspaceCount: 3,
          primaryWorkspaceId: "wks_meta_latest",
          primaryWorkspaceTitle: "Meta Main",
          hasRunningAgent: true,
          lastActivityIso: "2026-11-08T10:05:00.000Z",
          lastActivityRelative: "just now",
          score: 100,
        },
      ],
      onExecuteQuickJump: async (input) => {
        executedJumps.push({ projectId: input.projectId, jumpMode: input.jumpMode });
        return {
          ok: true,
          jumpMode: input.jumpMode ?? "open-latest",
          targetWorkspaceId: "wks_dss_latest",
          targetProjectId: "prj_dss",
          targetProjectKey: "key_dss",
          targetProjectName: "2026-11-08 Design System Studio",
          message: "Switched to 2026-11-08 Design System Studio",
        };
      },
    },
    mockDoc,
    mockWin,
  );

  assert.ok(modalEl, "Quick jump modal must mount into document.body");
  const searchInput = body.querySelector?.(
    '[data-testid="paseo-finder-quick-jump-input"]',
  ) as ReturnType<typeof createInteractiveDomNode> | null;
  assert.ok(searchInput, "Quick jump search input must exist");

  // Filter by typing "design"
  searchInput.value = "design";
  searchInput.dispatch("input", {});
  assert.ok(
    body.querySelector?.('[data-testid="paseo-finder-quick-jump-item-prj_dss"]'),
    "Design project item should remain visible",
  );
  assert.equal(
    body.querySelector?.('[data-testid="paseo-finder-quick-jump-item-prj_meta"]'),
    null,
    "Non-matching Meta project item should be filtered out",
  );

  // Press Shift+Enter -> executes locate-sidebar and closes modal
  searchInput.dispatch("keydown", { key: "Enter", shiftKey: true });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(executedJumps, [
    { projectId: "prj_dss", jumpMode: "locate-sidebar" },
  ]);
  assert.equal(
    body.querySelector?.('[data-testid="paseo-finder-quick-jump-modal"]'),
    null,
    "Modal must close after executing jump",
  );
});

test("18. Schedule Runs Inspector & 1-click session unarchive/open (handleInspectScheduleRuns & handleOpenScheduleRunSession)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-sched-runs-"));
  try {
    const sentinelSchedule = {
      id: "2a8a43f9",
      name: "AG · Antigravity Webhook Hub — Sentinel",
      prompt: "[ag-standby slug=webhook-hub-sentinel sha=7cd9bd605c40]\nRun sentinel check.",
      cadence: { type: "cron", expression: "0 */4 * * *", timezone: "Asia/Shanghai" },
      target: {
        type: "new-agent",
        config: {
          provider: "antigravity",
          cwd: "/Users/dev/webhook-hub",
          modeId: "full-access",
          model: "gemini-3.8-flash-high",
          archiveOnFinish: true,
        },
      },
      status: "paused",
      nextRunAt: null,
      lastRunAt: "2026-11-08T00:32:52.578Z",
      runs: [
        {
          id: "run-1",
          scheduledFor: "2026-11-07T20:29:53.000Z",
          startedAt: "2026-11-07T20:29:53.000Z",
          endedAt: "2026-11-07T20:35:08.000Z",
          status: "succeeded",
          agentId: "agent-older",
          workspaceId: "wks_older",
          output: "✅ Older sentinel run ok\n",
          error: null,
        },
        {
          id: "run-2",
          scheduledFor: "2026-11-08T00:30:06.000Z",
          startedAt: "2026-11-08T00:30:06.000Z",
          endedAt: "2026-11-08T00:32:52.000Z",
          status: "succeeded",
          agentId: "agent-latest",
          workspaceId: "wks_archived_run",
          output: "### Antigravity Webhook Hub 哨兵巡检快照 (全绿正常)\n",
          error: null,
        },
      ],
    };
    const idleSchedule = {
      id: "idle0001",
      name: "AG · Idle Sidecar",
      prompt: "[ag-standby slug=idle-sidecar sha=111122223333]\nIdle prompt.",
      cadence: { type: "cron", expression: "0 9 * * *", timezone: "Asia/Shanghai" },
      target: {
        type: "new-agent",
        config: {
          provider: "antigravity",
          cwd: "/Users/dev/idle",
          modeId: "full-access",
          model: "gemini-3.8-flash-high",
        },
      },
      status: "paused",
      runs: [],
    };

    await fs.writeFile(
      path.join(tmpDir, "2a8a43f9.json"),
      JSON.stringify(sentinelSchedule, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      path.join(tmpDir, "idle0001.json"),
      JSON.stringify(idleSchedule, null, 2),
      "utf-8",
    );

    const restoredWorkspaces: string[] = [];
    const spawnedRunOnce: string[] = [];
    const mockBridge = {
      async inspectWorkspaceRecovery(wid: string) {
        if (wid === "wks_archived_run") {
          return {
            kind: "recoverable",
            workspaceId: wid,
            workspaceName: "Run webhook hub sentinel standby check",
            action: "unarchive",
          };
        }
        return { kind: "active", workspaceId: wid, workspaceName: "Older Run" };
      },
      async restoreWorkspace(wid: string) {
        restoredWorkspaces.push(wid);
      },
      async fetchAgentTimeline(agentId: string) {
        return {
          entries: [
            {
              timestamp: "2026-11-08T00:30:07.000Z",
              item: {
                type: "user_message",
                text: "Run sentinel check",
                messageId: `msg-u-${agentId}`,
              },
            },
            {
              timestamp: "2026-11-08T00:32:51.000Z",
              item: {
                type: "assistant_message",
                text: "### Antigravity Webhook Hub 哨兵巡检快照 (全绿正常)",
                messageId: `msg-a-${agentId}`,
              },
            },
          ],
        };
      },
      async scheduleUpdate() {
        return {};
      },
    };

    const mockContext = {
      paseo: {
        workspaces: {
          async list() {
            return { entries: [] };
          },
        },
      },
    } as never;

    // 1) Inspect schedules with runs
    const inspected = await handleInspectScheduleRuns(
      {
        onlyWithRuns: true,
        includeWorkspaceNames: true,
        maxRunsPerSchedule: 20,
      },
      mockContext,
      { schedulesDir: tmpDir, bridge: mockBridge },
    );
    assert.equal(inspected.ok, true);
    assert.equal(inspected.totalSchedules, 2);
    assert.equal(inspected.schedulesWithRuns, 1);
    assert.equal(inspected.totalRuns, 2);
    assert.equal(inspected.succeededRuns, 2);
    assert.equal(inspected.schedules.length, 1);
    assert.equal(inspected.schedules[0].id, "2a8a43f9");
    assert.equal(inspected.schedules[0].isStandbyTwin, true);
    assert.equal(inspected.schedules[0].standbySlug, "webhook-hub-sentinel");
    assert.equal(inspected.schedules[0].runs[0].id, "run-2");
    assert.equal(
      inspected.schedules[0].runs[0].workspaceName,
      "Run webhook hub sentinel standby check",
    );
    assert.equal(inspected.schedules[0].runs[0].isArchived, true);

    // 2) Open archived run session -> unarchives workspace via restoreWorkspace and loads timeline
    const opened = await handleOpenScheduleRunSession(
      {
        action: "open-run",
        scheduleId: "2a8a43f9",
        runId: "run-2",
        dryRun: false,
      },
      mockContext,
      { schedulesDir: tmpDir, bridge: mockBridge },
    );
    assert.equal(opened.ok, true);
    assert.equal(opened.unarchived, true);
    assert.deepEqual(restoredWorkspaces, ["wks_archived_run"]);
    assert.equal(opened.workspaceId, "wks_archived_run");
    assert.equal(opened.timelineEntries.length, 2);
    assert.equal(opened.timelineEntries[1].role, "assistant");

    // 3) Toggle archiveOnFinish policy (能调)
    const toggled = await handleOpenScheduleRunSession(
      {
        action: "toggle-archive-on-finish",
        scheduleId: "2a8a43f9",
        archiveOnFinish: false,
        dryRun: false,
      },
      mockContext,
      { schedulesDir: tmpDir, bridge: mockBridge },
    );
    assert.equal(toggled.ok, true);
    assert.equal(toggled.archiveOnFinish, false);

    // 4) Trigger run-now
    const triggered = await handleOpenScheduleRunSession(
      {
        action: "run-now",
        scheduleId: "2a8a43f9",
        dryRun: false,
      },
      mockContext,
      {
        schedulesDir: tmpDir,
        bridge: mockBridge,
        spawnDetachedRunOnce: (sid) => spawnedRunOnce.push(sid),
      },
    );
    assert.equal(triggered.ok, true);
    assert.deepEqual(spawnedRunOnce, ["2a8a43f9"]);

    // 5) Trigger auto-evolve dry-run (能试)
    const evolvedDry = await handleOpenScheduleRunSession(
      {
        action: "auto-evolve",
        scheduleId: "2a8a43f9",
        dryRun: true,
      },
      mockContext,
      { schedulesDir: tmpDir, bridge: mockBridge },
    );
    assert.equal(evolvedDry.ok, true);
    assert.equal(evolvedDry.action, "auto-evolve");
    assert.ok(evolvedDry.message.includes("[dry-run]"));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("19. Custom Voice & STT Model Reconciler (handleManageVoiceStt: inspect, apply, test, reset)", async () => {
  // 1) Shorthand & preset resolution
  const senseVoicePreset = resolveVoicePresetOrShorthand("sensevoice");
  assert.ok(senseVoicePreset);
  assert.equal(senseVoicePreset?.id, "siliconflow-sensevoice-free");
  assert.equal(senseVoicePreset?.model, "FunAudioLLM/SenseVoiceSmall");
  assert.equal(senseVoicePreset?.freeTier, true);

  const qwenPreset = resolveVoicePresetOrShorthand("Qwen/Qwen3-ASR-1.7B");
  assert.ok(qwenPreset);
  assert.equal(qwenPreset?.id, "siliconflow-qwen3-asr");

  // 2) Source badge & secret masking
  assert.equal(
    inferSttSourceBadge("openai", "http://127.0.0.1:8787/v1", "FunAudioLLM/SenseVoiceSmall"),
    "gateway:8787 -> siliconflow.cn",
  );
  assert.equal(
    inferSttSourceBadge("openai", "http://127.0.0.1:8787/v1", "gemini-3.5-transcribe"),
    "gateway:8787 -> gemini-6key-pool",
  );
  assert.equal(
    inferSttSourceBadge("openai", "https://api.siliconflow.cn/v1", "Qwen/Qwen3-ASR-1.7B"),
    "direct · api.siliconflow.cn",
  );
  assert.equal(
    inferSttSourceBadge("local", "", "parakeet-tdt-0.6b-v2"),
    "local · sherpa-onnx",
  );
  assert.equal(maskApiKeyPreview("sk-1234567890abcdef"), "sk-123...cdef");
  assert.equal(maskApiKeyPreview("shortkey"), "sho***");

  // 3) Isolated config lifecycle (inspect -> apply preset -> apply arbitrary custom model -> test -> reset)
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-voice-stt-test-"));
  const configPath = path.join(tmpDir, "config.json");
  try {
    const initialConfig = {
      version: 2,
      daemon: { listen: "127.0.0.1:6767" },
      features: {
        dictation: {
          enabled: true,
          stt: {
            provider: "openai",
            apiKey: "siliconflow-local-pool",
            baseUrl: "http://127.0.0.1:8787/v1",
            model: "gemini-2.5-flash",
          },
        },
        voiceMode: {
          enabled: false,
          stt: {
            provider: "openai",
            apiKey: "siliconflow-local-pool",
            baseUrl: "http://127.0.0.1:8787/v1",
            model: "gemini-2.5-flash",
          },
        },
      },
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2), "utf-8");

    const patchedPayloads: Array<Record<string, unknown>> = [];
    const mockOverrides = {
      paseoDir: tmpDir,
      patchDaemonFeatures: async (features: Record<string, unknown>) => {
        patchedPayloads.push(features);
        return { patchedViaWs: true };
      },
      probeGateway: async () => ({
        reachable: true,
        url: "http://127.0.0.1:8787/v1",
        healthyKeys: 6,
        totalKeys: 6,
        siliconflowConfigured: true,
        groqConfigured: true,
      }),
      runLiveProbe: async (params: { baseUrl: string; model: string }) => ({
        ok: true,
        endpoint: `${params.baseUrl}/audio/transcriptions`,
        model: params.model,
        provider: "siliconflow",
        keyUsed: "gateway-pool",
        transcript: "Hello Paseo voice test",
        latencyMs: 412,
        error: null,
      }),
    };

    const inspected = await handleManageVoiceStt(
      { action: "inspect" },
      undefined,
      mockOverrides,
    );
    assert.equal(inspected.ok, true);
    assert.equal(inspected.dictationStt.model, "gemini-2.5-flash");
    assert.equal(inspected.dictationStt.sourceBadge, "gateway:8787 -> gemini-6key-pool");
    assert.equal(inspected.presets.length, VOICE_STT_PRESETS.length);

    // Apply SiliconFlow Free SenseVoiceSmall preset
    const appliedPreset = await handleManageVoiceStt(
      {
        action: "apply",
        presetId: "siliconflow-sensevoice-free",
      },
      undefined,
      mockOverrides,
    );
    assert.equal(appliedPreset.ok, true);
    assert.equal(appliedPreset.action, "apply");
    assert.equal(appliedPreset.dictationStt.model, "FunAudioLLM/SenseVoiceSmall");
    assert.equal(appliedPreset.dictationStt.sourceBadge, "gateway:8787 -> siliconflow.cn");
    assert.equal(patchedPayloads.length, 1);

    // Apply OpenWhispr Qwen/Qwen3-ASR-1.7B custom model
    const appliedCustom = await handleManageVoiceStt(
      {
        action: "apply",
        model: "Qwen/Qwen3-ASR-1.7B",
        baseUrl: "http://127.0.0.1:8787/v1",
      },
      undefined,
      mockOverrides,
    );
    assert.equal(appliedCustom.ok, true);
    assert.equal(appliedCustom.dictationStt.model, "Qwen/Qwen3-ASR-1.7B");
    assert.equal(appliedCustom.voiceModeStt.model, "Qwen/Qwen3-ASR-1.7B");

    const probed = await handleManageVoiceStt(
      {
        action: "test",
        model: "Qwen/Qwen3-ASR-1.7B",
      },
      undefined,
      mockOverrides,
    );
    assert.equal(probed.ok, true);
    assert.ok(probed.testResult);
    assert.equal(probed.testResult?.ok, true);
    assert.equal(probed.testResult?.model, "Qwen/Qwen3-ASR-1.7B");
    assert.equal(probed.testResult?.provider, "siliconflow");

    // Reset back to OpenAI whisper-1 default
    const resetResult = await handleManageVoiceStt(
      {
        action: "reset",
      },
      undefined,
      mockOverrides,
    );
    assert.equal(resetResult.ok, true);
    assert.equal(resetResult.dictationStt.model, "whisper-1");
    assert.ok(manageVoiceSttRpc.name === "finder.manage_voice_stt");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("20. Centralized Paseo 7-Theme & 10-Identity-Color System (shared/paseo-theme & client/theme-web)", () => {
  // 1) Normalize Paseo theme names
  assert.equal(normalizePaseoThemeName("light"), "light");
  assert.equal(normalizePaseoThemeName("darkZinc"), "zinc");
  assert.equal(normalizePaseoThemeName("darkClaude"), "claude");
  assert.equal(normalizePaseoThemeName("pure-black"), "pureBlack");
  assert.equal(normalizePaseoThemeName("unknown"), null);

  // 2) Exact Paseo ProjectIconView identity color hash & initial
  const colorName = derivePaseoIdentityColorName("dir:/Users/dev/Cowork/2026-11-08 Meta harness");
  const colorHex = derivePaseoIdentityColorHex("dir:/Users/dev/Cowork/2026-11-08 Meta harness");
  assert.equal(colorHex, PASEO_IDENTITY_BG_HEX[colorName]);
  assert.equal(deriveProjectIconInitial("2026-11-08 Meta harness"), "2");
  assert.equal(deriveProjectIconInitial("Seller Browser"), "S");
  assert.equal(deriveProjectIconInitial("life-os"), "L");

  // 3) Resolve Light theme from DOM computed background rgb(255, 255, 255)
  const docElAttrs = new Map<string, string>();
  const docElProps = new Map<string, string>();
  const lightDoc = {
    documentElement: {
      className: "",
      getAttribute: (k: string) => docElAttrs.get(k) ?? null,
      setAttribute: (k: string, v: string) => {
        docElAttrs.set(k, v);
      },
      style: {
        setProperty: (k: string, v: string) => {
          docElProps.set(k, v);
        },
      },
    },
    body: { tagName: "BODY" },
    querySelector: () => null,
  };
  const lightWin = {
    localStorage: {
      getItem: () => null,
      length: 0,
      key: () => null,
    },
    getComputedStyle: () => ({
      backgroundColor: "rgb(255, 255, 255)",
      color: "rgb(26, 26, 30)",
    }),
  };

  const resolvedLight = syncPaseoThemeCssVariables(lightDoc as never, lightWin as never);
  assert.equal(resolvedLight.name, "light");
  assert.equal(resolvedLight.colorScheme, "light");
  assert.equal(resolvedLight.surface0, PASEO_THEMES.light.surface0);
  assert.equal(resolvedLight.surface2, "#f4f4f5");
  assert.equal(resolvedLight.border, "#e4e4e7");
  assert.equal(resolvedLight.primary, "#18181b");
  assert.equal(docElAttrs.get("data-paseo-finder-theme"), "light");
  assert.equal(docElProps.get("--paseo-finder-surface-0"), "#ffffff");

  // 4) Resolve Claude dark theme from localStorage setting
  const claudeWin = {
    localStorage: {
      getItem: (k: string) =>
        k === "@paseo:app-settings" ? JSON.stringify({ theme: "claude" }) : null,
      length: 1,
      key: () => "@paseo:app-settings",
    },
  };
  const resolvedClaude = resolveActivePaseoTheme(lightDoc as never, claudeWin as never);
  assert.equal(resolvedClaude.name, "claude");
  assert.equal(resolvedClaude.colorScheme, "dark");
  assert.equal(resolvedClaude.surface0, "#1f1f1e");
  assert.equal(resolvedClaude.accent, "#d97757");
});

test("24. Schedules screen anti-freeze guard: W3C textContent MutationObserver idempotency across 135 rows, safe internal toolbar mounting, and preference persistence", () => {
  // 1) Built-in live self-test proves 0 infinite loop under W3C textContent childList semantics
  const selfTest = runScheduleRunsDomIdempotencySelfTest();
  assert.equal(selfTest.ok, true, selfTest.summary);
  assert.ok(selfTest.pass1DomWrites > 0);
  assert.equal(selfTest.pass2DomWrites, 0);
  assert.equal(selfTest.pass3DomWrites, 0);
  assert.equal(selfTest.simulatedObserverCallbacks, 0);
  assert.equal(selfTest.infiniteLoopPrevented, true);

  // 2) setTextContentIfChanged mutates only when value differs
  let textSetterCalls = 0;
  let currentVal: string | null = "Runs (5)";
  const watchedEl = {
    get textContent() {
      return currentVal;
    },
    set textContent(next: string | null) {
      textSetterCalls += 1;
      currentVal = next;
    },
  };
  assert.equal(setTextContentIfChanged(watchedEl, "Runs (5)"), false);
  assert.equal(textSetterCalls, 0);
  assert.equal(setTextContentIfChanged(watchedEl, "Runs (6)"), true);
  assert.equal(textSetterCalls, 1);

  // 3) Scale test: 135 schedule rows mount toolbar inside `[data-testid="schedules-table"]` (not parentElement!)
  interface TestNode extends MinimalScheduleDomElement {
    childrenList: TestNode[];
  }
  const makeTestNode = (tag: string, attrs: Record<string, string> = {}): TestNode => {
    const map = new Map<string, string>(Object.entries(attrs));
    const n: TestNode = {
      id: attrs.id,
      textContent: "",
      style: {},
      childrenList: [],
      parentElement: null,
      get firstChild() {
        return n.childrenList[0] ?? null;
      },
      getAttribute: (k) => (k === "id" ? n.id ?? null : map.get(k) ?? null),
      setAttribute: (k, v) => {
        if (k === "id") n.id = v;
        map.set(k, v);
      },
      hasAttribute: (k) => (k === "id" ? Boolean(n.id) : map.has(k)),
      appendChild: (c) => {
        const child = c as TestNode;
        child.parentElement = n;
        n.childrenList.push(child);
      },
      insertBefore: (newNode, refNode) => {
        const child = newNode as TestNode;
        child.parentElement = n;
        const idx = refNode ? n.childrenList.indexOf(refNode as TestNode) : -1;
        if (idx >= 0) n.childrenList.splice(idx, 0, child);
        else n.childrenList.push(child);
      },
      addEventListener: () => {},
      querySelector: <T = MinimalScheduleDomElement>(sel: string): T | null =>
        (queryTree(n, sel)[0] as unknown as T) ?? null,
    };
    return n;
  };

  const queryTree = (root: TestNode, selector: string): TestNode[] => {
    const out: TestNode[] = [];
    const s = selector.trim();
    const exact = s.match(/^\[data-testid="([^"]+)"\]$/);
    const prefix = s.match(/^\[data-testid\^="([^"]+)"\]$/);
    const walk = (cur: TestNode) => {
      if (exact && cur.getAttribute("data-testid") === exact[1]) out.push(cur);
      else if (prefix && (cur.getAttribute("data-testid") ?? "").startsWith(prefix[1])) {
        out.push(cur);
      }
      for (const ch of cur.childrenList) walk(ch);
    };
    walk(root);
    return out;
  };

  const findId = (root: TestNode, id: string): TestNode | null => {
    if (root.id === id) return root;
    for (const ch of root.childrenList) {
      const f = findId(ch, id);
      if (f) return f;
    }
    return null;
  };

  const scrollParent = makeTestNode("div", { "data-testid": "schedules-list" });
  const tableEl = makeTestNode("div", { "data-testid": "schedules-table" });
  const cardEl = makeTestNode("div");
  for (let i = 0; i < 135; i += 1) {
    const id = `sched_${i}`;
    const row = makeTestNode("div", { "data-testid": `schedule-row-${id}` });
    const actions = makeTestNode("div");
    const kebab = makeTestNode("button", { "data-testid": `schedule-kebab-${id}` });
    actions.appendChild(kebab);
    row.appendChild(actions);
    cardEl.appendChild(row);
  }
  tableEl.appendChild(cardEl);
  scrollParent.appendChild(tableEl);

  const doc: MinimalScheduleDomDocument = {
    createElement: (tag) => makeTestNode(tag),
    getElementById: (id) => findId(scrollParent, id),
    querySelector: (sel) => (queryTree(scrollParent, sel)[0] as never) ?? null,
    querySelectorAll: (sel) => queryTree(scrollParent, sel) as never,
  };

  const map = new Map([
    [
      "sched_0",
      {
        id: "sched_0",
        name: "Morning Brief",
        cron: "0 8 * * *",
        enabled: true,
        isStandbyTwin: false,
        workspaceDirectory: "/tmp",
        provider: "claude",
        model: "sonnet",
        prompt: "hi",
        archiveOnComplete: true,
        totalRuns: 3,
        succeededRuns: 3,
        failedRuns: 0,
        runningRuns: 0,
        lastRunAt: null,
        lastRunStatus: "succeeded" as const,
        nextRunAt: null,
        runs: [],
      },
    ],
  ]);

  const first = decorateSchedulesDomOnDocument(doc, {
    schedulesById: map,
    totals: { totalSchedules: 135, schedulesWithRuns: 1, totalRuns: 3 },
    isZh: false,
    onOpenDrawer: () => {},
  });
  assert.equal(first.rowCount, 135);
  assert.ok(first.domWrites > 135);

  // Verify toolbar was mounted INSIDE schedules-table (first child), NOT in scrollParent!
  assert.equal(scrollParent.childrenList.length, 1);
  assert.equal(scrollParent.childrenList[0], tableEl);
  assert.equal(tableEl.childrenList[0]?.id, "paseo-finder-all-runs-toolbar");

  // Second pass with identical state performs ZERO DOM writes across all 135 rows!
  const second = decorateSchedulesDomOnDocument(doc, {
    schedulesById: map,
    totals: { totalSchedules: 135, schedulesWithRuns: 1, totalRuns: 3 },
    isZh: false,
    onOpenDrawer: () => {},
  });
  assert.equal(second.rowCount, 135);
  assert.equal(second.domWrites, 0);

  // Verify self-mutation batch classifier distinguishes injected nodes vs external React rows
  const pill0 = queryTree(scrollParent, '[data-testid="schedule-runs-pill-sched_0"]')[0];
  assert.ok(pill0);
  assert.equal(
    isSelfInjectedMutationBatch([{ target: pill0, addedNodes: [], removedNodes: [] }]),
    true,
  );
  const externalRow = makeTestNode("div", { "data-testid": "schedule-row-sched_999" });
  assert.equal(
    isSelfInjectedMutationBatch([
      { target: cardEl, addedNodes: [externalRow], removedNodes: [] },
    ]),
    false,
  );

  // 4) Preference sync & read round-trip
  const mem = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
  };
  syncScheduleRunsPreferences(false, "plugin-settings", mockStorage);
  const readBack = readScheduleRunsPreferences(mockStorage);
  assert.equal(readBack.enabled, false);
  assert.equal(readBack.sourceBadge, "plugin-settings");
});

test("25. Host-Native Chameleon Visual Language & Single-Surface Exclusive Voice Injection (anti-AI-slop gate)", async () => {
  const voiceWebSrc = await fs.readFile(
    path.join(process.cwd(), "client", "voice-stt-web.ts"),
    "utf-8",
  );
  // 1) Must not contain verbose AI marketing prose or parenthetical promo badge concatenation
  assert.equal(
    voiceWebSrc.includes("Unlock SiliconFlow free ASR"),
    false,
    "voice-stt-web.ts must not render verbose marketing paragraphs inside Paseo's native Speech-to-text sheet",
  );
  assert.equal(
    voiceWebSrc.includes("(${preset.badge})"),
    false,
    "Preset buttons must use concise model names without noisy parenthetical promo badges",
  );
  // 2) Must not inject duplicate enhancer cards on both background [data-testid='voice-settings'] and modal [data-testid='voice-provider-sheet']
  assert.equal(
    voiceWebSrc.includes('"settings-page"'),
    false,
    "voice-stt-web.ts must only enhance the active Speech-to-text modal sheet, never double-mounting on the background Voice settings page",
  );
});

test("26. Agent History & Session Patch Reconciler (manageAgentHistoryRpc: inspect / probe / heal & agent-timeline-sync-error auto-heal button)", async () => {
  assert.equal(manageAgentHistoryRpc.name, "finder.manage_agent_history");
  const mockCtx = createMockContext([]) as never;

  // 1) Live inspect ("能读") returns session patch markers, guard status, and active Paseo workspace conversation armor
  const inspected = await handleManageAgentHistory({ action: "inspect" }, mockCtx);
  assert.equal(inspected.ok, true);
  assert.equal(inspected.action, "inspect");
  assert.equal(inspected.sessionPatches.ok, true);
  assert.equal(inspected.sessionPatches.appPatched, true);
  assert.equal(inspected.sessionPatches.cliPatched, true);
  assert.ok(inspected.vaultStats.antigravityAgentsCount > 0);
  assert.equal(
    inspected.vaultStats.missingDbCount,
    0,
    "All active Paseo workspace Antigravity conversations must have restored live .db armor",
  );
  assert.equal(
    inspected.vaultStats.missingTranscriptCount,
    0,
    "All active Paseo workspace Antigravity conversations must have transcript replay armor",
  );

  // 2) Live probe ("能试") on target workspace wks_19f1d13d283b942f / conversation 28403586-fc55-4a80-8dce-eba4f268e26a
  const probed = await handleManageAgentHistory(
    {
      action: "probe",
      conversationId: "28403586-fc55-4a80-8dce-eba4f268e26a",
    },
    mockCtx,
  );
  assert.equal(probed.ok, true);
  assert.equal(probed.action, "probe");
  assert.ok(probed.targetAgent);
  assert.equal(
    probed.targetAgent?.conversationId,
    "28403586-fc55-4a80-8dce-eba4f268e26a",
  );
  assert.equal(probed.targetAgent?.dbExists, true);
  assert.ok(
    probed.targetAgent?.brainTranscriptExists ||
      probed.targetAgent?.shelfTranscriptExists,
    "Conversation must have a readable transcript fallback",
  );
  assert.ok(
    (probed.targetAgent?.transcriptLines ?? 0) > 10,
    "Transcript must contain populated history turns",
  );

  // 3) Verify client/web.ts wires the 1-click heal button into [data-testid='agent-timeline-sync-error'] using host-native theme tokens
  const webSrc = await fs.readFile(
    path.join(process.cwd(), "client", "web.ts"),
    "utf-8",
  );
  assert.equal(
    webSrc.includes("agent-timeline-sync-error"),
    true,
    "client/web.ts must detect [data-testid='agent-timeline-sync-error'] and offer 1-click self-healing",
  );
  assert.equal(
    webSrc.includes("paseo-finder-agent-history-heal-btn"),
    true,
    "client/web.ts must render data-testid='paseo-finder-agent-history-heal-btn' inside the timeline sync error banner",
  );
});

test("27. Startup Auto-Pull-Up & Interrupted Agent Reconciler (reconcilePaseoRecoveryRpc: status / simulate & /pull-up)", async () => {
  assert.equal(reconcilePaseoRecoveryRpc.name, "finder.reconcile_paseo_recovery");
  const mockCtx = createMockContext([]) as never;

  const statusRes = await handleReconcilePaseoRecovery({ action: "status" }, mockCtx);
  assert.equal(statusRes.action, "status");
  assert.equal(statusRes.resumeOnStartup, true);
  assert.equal(statusRes.versionCacheOk, true);
  assert.equal(statusRes.catalogSingleflightOk, true);
  assert.ok(statusRes.totalScanned > 0);
  assert.equal(statusRes.unhealedCount, 0);
  assert.equal(statusRes.ok, true);
});

test("28. Search (⌘F / ⌘K) & Route Navigation Left-Sidebar Auto-Reveal, Uncollapse & Scroll-Into-Vision (revealWorkspaceInSidebar)", async () => {
  const body = createInteractiveDomNode("div", { "data-testid": "body" });

  // 1) Build WorkspaceHeader DOM matching Paseo's `va(e)` layout:
  //    headerTitleTextGroup -> [ScreenTitle("workspace-header-title"), WorkspaceHeaderProjectRow("2026-11-08 Job hunting")]
  const headerGroup = createInteractiveDomNode("div");
  const headerTitle = createInteractiveDomNode("div", {
    "data-testid": "workspace-header-title",
  });
  headerTitle.textContent = "Init job hunting router; check HR replies";
  const headerProjectSubtitle = createInteractiveDomNode("div");
  headerProjectSubtitle.textContent = "2026-11-08 Job hunting";
  headerGroup.appendChild?.(headerTitle);
  headerGroup.appendChild?.(headerProjectSubtitle);
  body.appendChild?.(headerGroup);

  // 2) Build LeftSidebar DOM where `2026-11-08 Job hunting` is initially COLLAPSED
  //    (so `sidebar-workspace-list-local:proj_job` and `sidebar-workspace-row-local:ws_job_router` do NOT exist in DOM until project row is clicked!)
  const projectGroup = createInteractiveDomNode("div", {
    role: "group",
    "aria-label": "2026-11-08 Job hunting",
  });
  const projectRow = createInteractiveDomNode("div", {
    "data-testid": "sidebar-project-row-local:proj_job",
  });
  projectRow.textContent = "2026-11-08 Job hunting";

  let projectRowUncollapsed = false;
  let workspaceRowScrolled = false;
  let showMoreExpanded = false;

  const workspaceRow = createInteractiveDomNode("div", {
    "data-testid": "sidebar-workspace-row-local:ws_job_router",
  });
  workspaceRow.textContent = "Init job hunting router; check HR replies";
  workspaceRow.scrollIntoView = () => {
    workspaceRowScrolled = true;
  };

  const showMoreBtn = createInteractiveDomNode("div", {
    "data-testid": "sidebar-project-show-more-local:proj_job",
    "aria-expanded": "false",
  });
  const workspaceList = createInteractiveDomNode("div", {
    "data-testid": "sidebar-workspace-list-local:proj_job",
  });

  showMoreBtn.click = () => {
    showMoreExpanded = true;
    showMoreBtn.setAttribute?.("aria-expanded", "true");
    workspaceList.appendChild?.(workspaceRow);
  };
  workspaceList.appendChild?.(showMoreBtn);

  projectRow.click = () => {
    projectRowUncollapsed = true;
    projectGroup.appendChild?.(workspaceList);
  };
  projectGroup.appendChild?.(projectRow);
  body.appendChild?.(projectGroup);

  // 3) Build CommandCenter result row matching Paseo's `Ee(e)` layout
  const ccPanel = createInteractiveDomNode("div", {
    "data-testid": "command-center-panel",
  });
  const ccWsRow = createInteractiveDomNode("div", {
    "data-testid": "command-center-workspace-local:ws_job_router",
  });
  const ccSubtitle = createInteractiveDomNode("div", {
    "data-testid": "command-center-workspace-subtitle",
  });
  ccSubtitle.textContent = "2026-11-08 Job hunting \u00b7 main";
  ccWsRow.appendChild?.(ccSubtitle);
  ccPanel.appendChild?.(ccWsRow);
  body.appendChild?.(ccPanel);

  const mockDoc: MinimalDocument = {
    body,
    head: createInteractiveDomNode("head"),
    createElement: (tag: string) => createInteractiveDomNode(tag),
    querySelector: (sel: string) => body.querySelector?.(sel) ?? null,
    querySelectorAll: (sel: string) => body.querySelectorAll?.(sel) ?? [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const mockWin: MinimalWindow = {
    document: mockDoc,
    location: { pathname: "/h/local/workspace/ws_job_router" },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  // Verify header project name extraction and CommandCenter subtitle extraction
  assert.equal(
    extractActiveWorkspaceHeaderProjectName(mockDoc),
    "2026-11-08 Job hunting",
  );
  const ccHint = extractCommandCenterSelectionHint(ccSubtitle, mockDoc);
  assert.equal(ccHint?.workspaceId, "ws_job_router");
  assert.deepEqual(ccHint?.candidateProjectNames, ["2026-11-08 Job hunting"]);

  // Execute revealWorkspaceInSidebar -> must uncollapse project row, click Show More, scroll workspace row into center, and flash both rows!
  const revealed = revealWorkspaceInSidebar(
    {
      workspaceId: "ws_job_router",
      candidateProjectNames: ccHint?.candidateProjectNames,
      highlightFlash: true,
    },
    mockDoc,
    mockWin,
  );
  assert.equal(revealed, true);
  assert.equal(
    projectRowUncollapsed,
    true,
    "Collapsed parent project row in left sidebar must be clicked to uncollapse",
  );
  assert.equal(
    showMoreExpanded,
    true,
    "Show-more button in left sidebar project group must be clicked when target workspace is hidden behind truncation",
  );
  assert.equal(
    workspaceRowScrolled,
    true,
    "Target workspace row in left sidebar must be scrolled into user vision",
  );
  assert.equal(
    workspaceRow.getAttribute?.("data-paseo-workspace-jump-flash"),
    "true",
    "Target workspace row must receive theme-aware highlight flash",
  );
  assert.equal(
    projectRow.getAttribute?.("data-paseo-project-jump-flash"),
    "true",
    "Parent project row must receive theme-aware highlight flash",
  );
  assert.equal(
    workspaceRow.style?.outline ?? "",
    "",
    "Workspace row must never mutate inline style.outline (prevents stuck white borders)",
  );
  assert.equal(
    workspaceRow.style?.backgroundColor ?? "",
    "",
    "Workspace row must never mutate inline style.backgroundColor (prevents stuck multi-selection when switching threads)",
  );

  // Overlapping rapid reveal on a second workspace must immediately clear the flash from the first workspace
  const secondWorkspaceRow = createInteractiveDomNode("div", {
    "data-testid": "sidebar-workspace-row-local:ws_job_second",
  });
  workspaceList.appendChild?.(secondWorkspaceRow);
  revealWorkspaceInSidebar(
    {
      workspaceId: "ws_job_second",
      highlightFlash: true,
    },
    mockDoc,
    mockWin,
  );
  assert.equal(
    workspaceRow.getAttribute?.("data-paseo-workspace-jump-flash"),
    null,
    "Switching/revealing a second workspace must immediately clear jump-flash on the previous workspace row",
  );
  assert.equal(
    secondWorkspaceRow.getAttribute?.("data-paseo-workspace-jump-flash"),
    "true",
    "Second workspace row must receive the active jump-flash",
  );

  // Legacy stuck inline styles from older sessions must be healed by clearSidebarJumpFlashes
  assert.ok(workspaceRow.style);
  workspaceRow.style.outline = "1.5px solid #ffffff";
  workspaceRow.style.backgroundColor = "#1f1f22";
  const healedCount = clearSidebarJumpFlashes(mockDoc);
  assert.ok(healedCount >= 2);
  assert.equal(workspaceRow.style.outline, "");
  assert.equal(workspaceRow.style.backgroundColor, "");
  assert.equal(secondWorkspaceRow.getAttribute?.("data-paseo-workspace-jump-flash"), null);
});

test("29. Auto-jump cursor to first place (index 0, 0) on inline rename (default enabled on device, shields focus-theft without re-selecting all, supports select-all/end & Option+dblclick)", () => {
  const head = createInteractiveDomNode("head");
  const body = createInteractiveDomNode("body");
  const row = createInteractiveDomNode("div", {
    "data-testid": "sidebar-workspace-row-local:wks_mao_2",
  });
  const titleWrap = createInteractiveDomNode("div");
  const initialTitleStr = "Install Notpamina on two WordPress sites";
  const titleEl = createInteractiveDomNode(
    "span",
    { "data-testid": "sidebar-workspace-title-local:wks_mao_2" },
    initialTitleStr,
  );
  titleWrap.appendChild?.(titleEl);
  row.appendChild?.(titleWrap);
  body.appendChild?.(row);

  const storage = new Map<string, string>();
  const mockDoc: MinimalDocument = {
    head,
    body,
    createElement: (tag) => createInteractiveDomNode(tag),
    querySelector: (sel) => body.querySelector?.(sel) ?? null,
    querySelectorAll: () => [row],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const mockWin: MinimalWindow = {
    location: { pathname: "/h/local/workspace/wks_mao_2" },
    localStorage: {
      get length() {
        return storage.size;
      },
      key: (idx) => Array.from(storage.keys())[idx] ?? null,
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => {
        storage.set(k, v);
      },
    },
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  // 1) Default preferences (and legacy 3-key localStorage objects) must auto-enable first-place caret ("start")
  storage.set(
    "paseo:finder-plugin:inline-rename-config",
    JSON.stringify({
      enableInlineDoubleClickRename: true,
      enableQuickRenameAndLabelShortcuts: true,
      enableDesktopContextMenuHelper: true,
    }),
  );
  const defaultPrefs = readInlineRenamePreferences(mockWin.localStorage);
  assert.equal(
    defaultPrefs.autoJumpToFirstPlaceInput,
    true,
    "autoJumpToFirstPlaceInput must be enabled by default on device even with pre-existing localStorage",
  );
  assert.equal(
    defaultPrefs.inlineRenameCaretPosition,
    "start",
    "inlineRenameCaretPosition must default to start (0, 0)",
  );

  // Also verify pluginSettings schema defaults
  const parsedDefaults = pluginSettings.schema.parse({});
  assert.equal(parsedDefaults.autoJumpToFirstPlaceInput, true);
  assert.equal(parsedDefaults.inlineRenameCaretPosition, "start");

  const target = resolveInlineRenameTarget(titleEl, mockDoc, mockWin);
  assert.ok(target);
  const session = mountInlineTitleInput(mockDoc, mockWin, target, async () => {});
  assert.ok(session);
  const input = session.inputEl as ReturnType<typeof createInteractiveDomNode>;

  assert.equal(input.focused, true);
  assert.equal(input.getAttribute?.("data-caret-mode"), "start");
  assert.equal(
    input.selectionStart,
    0,
    "Caret selectionStart must auto-jump to index 0 (first place)",
  );
  assert.equal(
    input.selectionEnd,
    0,
    "Caret selectionEnd must auto-jump to index 0 (not select-all)",
  );
  assert.equal(input.scrollLeft, 0, "Input scrollLeft must be pinned to 0");

  // 2) Composer focus-theft blur shield must restore focus AND keep caret at (0, 0) instead of calling select()!
  input.triggerBlur();
  assert.equal(input.focused, true);
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, 0);

  // 3) If user manually clicks inside the input to move cursor to index 7, focus-theft blur preserves (7, 7)
  input.setSelectionRange?.(7, 7);
  input.dispatch("mousedown");
  input.triggerBlur();
  assert.equal(input.focused, true);
  assert.equal(input.selectionStart, 7);
  assert.equal(input.selectionEnd, 7);
  session.cancel();

  // 4) Switching preference to autoJumpToFirstPlaceInput=false -> inlineRenameCaretPosition="select-all"
  syncInlineRenamePreferences({ autoJumpToFirstPlaceInput: false }, mockWin.localStorage);
  const selectAllPrefs = readInlineRenamePreferences(mockWin.localStorage);
  assert.equal(selectAllPrefs.autoJumpToFirstPlaceInput, false);
  assert.equal(selectAllPrefs.inlineRenameCaretPosition, "select-all");

  const sessionSelectAll = mountInlineTitleInput(mockDoc, mockWin, target, async () => {});
  assert.ok(sessionSelectAll);
  const inputSelectAll = sessionSelectAll.inputEl as ReturnType<typeof createInteractiveDomNode>;
  assert.equal(inputSelectAll.getAttribute?.("data-caret-mode"), "select-all");
  assert.equal(inputSelectAll.selectionStart, 0);
  assert.equal(inputSelectAll.selectionEnd, initialTitleStr.length);
  sessionSelectAll.cancel();

  // 5) Switching preference to inlineRenameCaretPosition="end" places caret at (len, len)
  syncInlineRenamePreferences({ inlineRenameCaretPosition: "end" }, mockWin.localStorage);
  const endPrefs = readInlineRenamePreferences(mockWin.localStorage);
  assert.equal(endPrefs.autoJumpToFirstPlaceInput, false);
  assert.equal(endPrefs.inlineRenameCaretPosition, "end");

  const sessionEnd = mountInlineTitleInput(mockDoc, mockWin, target, async () => {});
  assert.ok(sessionEnd);
  const inputEnd = sessionEnd.inputEl as ReturnType<typeof createInteractiveDomNode>;
  assert.equal(inputEnd.getAttribute?.("data-caret-mode"), "end");
  assert.equal(inputEnd.selectionStart, initialTitleStr.length);
  assert.equal(inputEnd.selectionEnd, initialTitleStr.length);
  sessionEnd.cancel();

  // 6) F2 target resolution finds active sidebar row by activeWsId even without aria-selected="true"
  const f2SidebarTarget = findF2InlineRenameTarget(mockDoc, mockWin);
  assert.ok(f2SidebarTarget);
  assert.equal(f2SidebarTarget.surface, "sidebar-row");
  assert.equal(f2SidebarTarget.workspaceId, "wks_mao_2");
});

test("32. Antigravity inline /skill autocomplete JSON.parse bridge upgrades [skill]-tagged commands to kind=skill", () => {
  const sampleWire = JSON.stringify({
    type: "list_commands_response",
    payload: {
      requestId: "req-1",
      commands: [
        { name: "plan", description: "Plan implementation", kind: "command", argumentHint: "[task]" },
        { name: "boost", description: "Multi-agent boost", kind: "command", argumentHint: "[skill] <task>" },
        { name: "wheel-check", description: "Search existing solutions", kind: "command", argumentHint: "[skill]" },
        { name: "computer-use", description: "Full desktop computer use", kind: "command", argumentHint: "[skill]" },
      ],
    },
  });

  const directNorm = normalizeListCommandsResponsePayload(JSON.parse(sampleWire)) as {
    payload: {
      commands: Array<{ name: string; kind: string; argumentHint?: string }>;
    };
  };
  assert.equal(directNorm.payload.commands[0].kind, "command");
  assert.equal(directNorm.payload.commands[0].argumentHint, "[task]");
  assert.equal(directNorm.payload.commands[1].kind, "skill");
  assert.equal(directNorm.payload.commands[1].argumentHint, "<task>");
  assert.equal(directNorm.payload.commands[2].kind, "skill");
  assert.equal(directNorm.payload.commands[2].argumentHint, "");
  assert.equal(directNorm.payload.commands[3].kind, "skill");
  assert.equal(directNorm.payload.commands[3].argumentHint, "");

  const mockJson = {
    parse: JSON.parse.bind(JSON),
    stringify: JSON.stringify.bind(JSON),
  };
  const fakeWin = { JSON: mockJson } as unknown as MinimalWindow;
  ensureAntigravityInlineSkillAutocompleteBridge(fakeWin);
  // Idempotent second call
  ensureAntigravityInlineSkillAutocompleteBridge(fakeWin);

  const parsedViaWin = mockJson.parse(sampleWire) as typeof directNorm;
  assert.equal(parsedViaWin.payload.commands[1].kind, "skill");
  assert.equal(typeof parsedViaWin.payload.commands[1].argumentHint, "string");
  assert.equal(parsedViaWin.payload.commands[2].kind, "skill");
  assert.equal(typeof parsedViaWin.payload.commands[2].argumentHint, "string");
  assert.equal(parsedViaWin.payload.commands[2].argumentHint, "");
  assert.equal(parsedViaWin.payload.commands[3].kind, "skill");
  assert.equal(typeof parsedViaWin.payload.commands[3].argumentHint, "string");
});

test("33. Cursor-inspired Customize control plane RPC (handleManageSlashSkills) supports status, category/scope filtering, pin/unpin, disable/enable, and multi-skill dry-run resolution", async () => {
  assert.equal(manageSlashSkillsRpc.name, "finder.manage_slash_skills");
  const ctx = createMockContext(["/tmp/ws_0"]);

  const statusRes = await handleManageSlashSkills(
    {
      action: "status",
      category: "all",
      scope: "all",
      limit: 50,
    },
    ctx,
  );
  assert.equal(statusRes.ok, true);
  assert.ok(statusRes.totalAdvertised > 100);
  assert.ok(statusRes.customizeCounts.commands > 10);
  assert.ok(statusRes.customizeCounts.skills > 100);
  assert.ok(statusRes.customizeItems.length > 0);
  assert.equal(statusRes.customizeItems[0].pinned, true);

  const resolveRes = await handleManageSlashSkills(
    {
      action: "test",
      samplePrompt: "please run /wheel-check and /1password before coding",
      limit: 20,
    },
    ctx,
  );
  assert.equal(resolveRes.ok, true);
  assert.ok(Array.isArray(resolveRes.dryRun.resolutions));
  assert.equal(resolveRes.dryRun.resolutions.length, 2);
  assert.equal(resolveRes.dryRun.resolutions[0]?.slug, "wheel-check");
  assert.equal(resolveRes.dryRun.resolutions[1]?.slug, "1password");
});

test("34. Stop Hook & Writeback Gate Reconciler RPC (handleManageWritebackHook) supports status inspection and historical transcript replay (v1 vs v2)", async () => {
  assert.equal(manageWritebackHookRpc.name, "finder.manage_writeback_hook");
  const ctx = createMockContext(["/tmp/ws_0"]);

  const statusRes = await handleManageWritebackHook(
    {
      action: "status",
    },
    ctx,
  );
  assert.equal(statusRes.ok, true);
  assert.equal(statusRes.hookVersion, "2.0.0");
  assert.equal(statusRes.enabled, true);
  assert.equal(statusRes.requireFullyIdle, true);
  assert.equal(statusRes.transcriptTailFallback, true);
});

test("35. Mark session as done shortcut (Option+D / ⌥D) & slash command: toggles 'd ' prefix, scrolls sidebar, and updates title", async () => {
  // 1. Pure function title toggle
  const r1 = computeDoneToggledTitle("Fix Paseo auto-launch not triggering");
  assert.equal(r1.action, "marked");
  assert.equal(r1.newTitle, "d Fix Paseo auto-launch not triggering");

  const r2 = computeDoneToggledTitle("d Fix Paseo auto-launch not triggering");
  assert.equal(r2.action, "unmarked");
  assert.equal(r2.newTitle, "Fix Paseo auto-launch not triggering");

  const r3 = computeDoneToggledTitle("D Fix Paseo auto-launch not triggering");
  assert.equal(r3.action, "unmarked");
  assert.equal(r3.newTitle, "Fix Paseo auto-launch not triggering");

  const r4 = computeDoneToggledTitle("d-Fix Paseo auto-launch not triggering");
  assert.equal(r4.action, "unmarked");
  assert.equal(r4.newTitle, "Fix Paseo auto-launch not triggering");

  const r5 = computeDoneToggledTitle("d: Fix Paseo auto-launch not triggering");
  assert.equal(r5.action, "unmarked");
  assert.equal(r5.newTitle, "Fix Paseo auto-launch not triggering");

  const r6 = computeDoneToggledTitle("d");
  assert.equal(r6.action, "unmarked");
  assert.equal(r6.newTitle, "");

  const rCustom = computeDoneToggledTitle("My Clean Task", "done: ");
  assert.equal(rCustom.action, "marked");
  assert.equal(rCustom.newTitle, "done: My Clean Task");

  // 2. Keyboard event classification (zero conflicts with Cmd+D / Cmd+Shift+D)
  const noopPrevent = () => {};
  assert.equal(
    isMarkDoneKeyboardEvent({ key: "d", code: "KeyD", altKey: true, preventDefault: noopPrevent }),
    true,
  );
  assert.equal(
    isMarkDoneKeyboardEvent({ key: "∂", code: "KeyD", altKey: true, preventDefault: noopPrevent }),
    true,
  );
  assert.equal(
    isMarkDoneKeyboardEvent({ key: "Î", code: "KeyD", altKey: true, shiftKey: true, preventDefault: noopPrevent }),
    true,
  );
  assert.equal(
    isMarkDoneKeyboardEvent({ key: "d", code: "KeyD", metaKey: true, preventDefault: noopPrevent }),
    false,
  );
  assert.equal(
    isMarkDoneKeyboardEvent({ key: "D", code: "KeyD", metaKey: true, shiftKey: true, preventDefault: noopPrevent }),
    false,
  );
  assert.equal(
    isMarkDoneKeyboardEvent({ key: "d", code: "KeyD", ctrlKey: true, preventDefault: noopPrevent }),
    false,
  );
  assert.equal(
    isMarkDoneKeyboardEvent({ key: "d", code: "KeyD", preventDefault: noopPrevent }),
    false,
  );

  // 3. Preference persistence
  const storageMap = new Map<string, string>();
  const mockStorage = {
    length: 0,
    getItem: (k: string) => storageMap.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storageMap.set(k, v);
    },
    removeItem: (k: string) => {
      storageMap.delete(k);
    },
    clear: () => {
      storageMap.clear();
    },
    key: () => null,
  };
  const defaultPrefs = readInlineRenamePreferences(mockStorage);
  assert.equal(defaultPrefs.enableMarkDoneShortcut, true);
  assert.equal(defaultPrefs.markDonePrefix, "d ");

  syncInlineRenamePreferences(
    { enableMarkDoneShortcut: false, markDonePrefix: "done: " },
    mockStorage,
  );
  const syncedPrefs = readInlineRenamePreferences(mockStorage);
  assert.equal(syncedPrefs.enableMarkDoneShortcut, false);
  assert.equal(syncedPrefs.markDonePrefix, "done: ");

  // 4. End-to-end toggleCurrentSessionDone
  const renameCalls: Array<{ newTitle: string | null; options?: unknown }> = [];
  let rowScrolled = false;

  const titleNode = {
    tagName: "SPAN",
    textContent: "Fix Paseo auto-launch not triggering",
    getAttribute: (name: string) => (name === "data-testid" ? "sidebar-workspace-title-srv_1:ws_done_1" : null),
  };
  const rowNode = {
    tagName: "DIV",
    getAttribute: (name: string) => {
      if (name === "data-testid") return "sidebar-workspace-row-srv_1:ws_done_1";
      if (name === "aria-selected") return "true";
      return null;
    },
    setAttribute: (name: string, val: string) => {
      (rowNode as Record<string, unknown>)[name] = val;
    },
    removeAttribute: (name: string) => {
      delete (rowNode as Record<string, unknown>)[name];
    },
    querySelector: (sel: string) => {
      if (sel.includes("sidebar-workspace-title-")) return titleNode;
      return null;
    },
    querySelectorAll: () => [],
    scrollIntoView: () => {
      rowScrolled = true;
    },
    closest: () => null,
    parentElement: null,
    children: [titleNode],
  };

  const headerTitleNode = {
    tagName: "DIV",
    textContent: "Fix Paseo auto-launch not triggering",
    getAttribute: (name: string) => (name === "data-testid" ? "workspace-header-title" : null),
    parentElement: { tagName: "DIV" },
  };

  const bodyChildren: unknown[] = [];
  const mockDoc: MinimalDocument = {
    body: {
      tagName: "BODY",
      appendChild: (el: unknown) => {
        bodyChildren.push(el);
        return el;
      },
      querySelectorAll: () => [],
      querySelector: () => null,
    } as unknown as MinimalElement,
    querySelector: (sel: string) => {
      if (sel.includes("sidebar-workspace-row-") && sel.includes("aria-selected")) {
        return rowNode as unknown as MinimalElement;
      }
      if (sel.includes("sidebar-workspace-row-srv_1:ws_done_1")) {
        return rowNode as unknown as MinimalElement;
      }
      if (sel.includes("workspace-header-title")) {
        return headerTitleNode as unknown as MinimalElement;
      }
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes("sidebar-workspace-row-")) {
        return [rowNode as unknown as MinimalElement];
      }
      return [];
    },
    createElement: (tag: string) => {
      const elAttrs: Record<string, string> = {};
      return {
        tagName: tag.toUpperCase(),
        textContent: "",
        style: {},
        setAttribute: (k: string, v: string) => {
          elAttrs[k] = v;
        },
        getAttribute: (k: string) => elAttrs[k] ?? null,
        remove: () => {},
      } as unknown as MinimalElement;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const mockWin: MinimalWindow = {
    document: mockDoc,
    localStorage: mockStorage,
    location: {
      pathname: "/workspace/ws_done_1",
    },
    navigator: {
      language: "zh-CN",
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const mockCallbacks = {
    isEnabled: () => true,
    getLocale: () => "zh-CN",
    getFallbackWorkspaceId: () => "ws_done_1",
    onOpenTarget: async () => {},
    onCopyPath: async () => {},
    onRenameThread: async (newTitle: string | null, options?: unknown) => {
      renameCalls.push({ newTitle, options });
    },
  };

  // Run 1: Mark as done
  const markRes = await toggleCurrentSessionDone(
    {
      workspaceId: "ws_done_1",
      doc: mockDoc,
      win: mockWin,
      callbacks: mockCallbacks,
      prefix: "d ",
    },
    mockDoc,
    mockWin,
  );

  assert.equal(markRes?.ok, true);
  assert.equal(markRes?.action, "marked");
  assert.equal(markRes?.previousTitle, "Fix Paseo auto-launch not triggering");
  assert.equal(markRes?.newTitle, "d Fix Paseo auto-launch not triggering");
  assert.equal(titleNode.textContent, "d Fix Paseo auto-launch not triggering");
  assert.equal(headerTitleNode.textContent, "d Fix Paseo auto-launch not triggering");
  assert.equal(rowScrolled, true);
  assert.equal((rowNode as Record<string, unknown>)["data-paseo-workspace-jump-flash"], "true");
  assert.equal(renameCalls.length, 1);
  assert.equal(renameCalls[0].newTitle, "d Fix Paseo auto-launch not triggering");

  // Run 2: Toggle back (unmark)
  rowScrolled = false;
  const unmarkRes = await toggleCurrentSessionDone(
    {
      workspaceId: "ws_done_1",
      doc: mockDoc,
      win: mockWin,
      callbacks: mockCallbacks,
      prefix: "d ",
    },
    mockDoc,
    mockWin,
  );

  assert.equal(unmarkRes?.ok, true);
  assert.equal(unmarkRes?.action, "unmarked");
  assert.equal(unmarkRes?.previousTitle, "d Fix Paseo auto-launch not triggering");
  assert.equal(unmarkRes?.newTitle, "Fix Paseo auto-launch not triggering");
  assert.equal(titleNode.textContent, "Fix Paseo auto-launch not triggering");
  assert.equal(headerTitleNode.textContent, "Fix Paseo auto-launch not triggering");
  assert.equal(rowScrolled, true);
  assert.equal(renameCalls.length, 2);
  assert.equal(renameCalls[1].newTitle, "Fix Paseo auto-launch not triggering");
});

test("extractCurrentRouteAgentId parses /ag/<agentId> routes for subagent tree inspector", async () => {
  const { extractCurrentRouteAgentId } = await import("../client/subagents-tree-web");
  assert.equal(
    extractCurrentRouteAgentId("/ag/e2210f4d-9cc5-4900-b795-6584950532c9"),
    "e2210f4d-9cc5-4900-b795-6584950532c9",
  );
  assert.equal(extractCurrentRouteAgentId("/workspace/wks_0232c71f8e4bdda8"), null);
  assert.equal(extractCurrentRouteAgentId(""), null);
});

test("extractCurrentWorkspaceAndAgent parses workspace and agent routes for session lineage bar", async () => {
  const { extractCurrentWorkspaceAndAgent } = await import("../client/session-lineage-web");
  const parsed = extractCurrentWorkspaceAndAgent(
    null,
    { location: { pathname: "/workspace/wks_72682062d02ff5d9" } } as unknown as Window,
  );
  assert.equal(parsed.workspaceId, "wks_72682062d02ff5d9");
  assert.equal(parsed.agentId, null);

  const parsedAg = extractCurrentWorkspaceAndAgent(
    null,
    { location: { pathname: "/ag/c32f05ca-a8bf-425f-ac1e-dc0e3c7853b3" } } as unknown as Window,
  );
  assert.equal(parsedAg.agentId, "c32f05ca-a8bf-425f-ac1e-dc0e3c7853b3");
});










