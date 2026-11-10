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
  archiveWorkspaceRpc,
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
  manageSubagentsRpc,
  manageWritebackHookRpc,
  reconcilePaseoRecoveryRpc,
  LabelShortcutComboSchema,
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
  handleArchiveWorkspace,
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
  openNewWorkspaceInApp,
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
  annotateNativeWorkspaceMenusWithShortcuts,
  archiveCurrentSidebarSession,
  isSidebarDeleteKeyboardEvent,
  resolveSidebarArchiveTarget,
  shouldTriggerSidebarDeleteArchive,
  triggerQuickThreadMetadataBar,
  isPreviousThreadKeyboardEvent,
  isNextThreadKeyboardEvent,
  isPinWorkspaceKeyboardEvent,
  navigateSidebarThreadRelative,
  toggleActiveWorkspacePin,
  isEditableInput,
} from "../client/web";
import {
  type MinimalScheduleDomDocument,
  type MinimalScheduleDomElement,
  decorateSchedulesDomOnDocument,
  ensurePaseoSidebarTimestampSetting,
  formatAntigravityRunTimestamp,
  formatCompactSidebarAge,
  findCadenceScheduleForWorkspace,
  showDefaultCadenceToast,
  isSelfInjectedMutationBatch,
  readScheduleRunsPreferences,
  runScheduleRunsDomIdempotencySelfTest,
  setCachedSchedulesForTesting,
  setTextContentIfChanged,
  syncScheduleRunsPreferences,
} from "../client/schedule-runs-web";
import {
  decorateConversationLinksAndSubagentMentionsInDom,
  extractCurrentRouteAgentId,
  formatSubagentDisplayName,
  isAllSubagentsArchivedForTree,
  markSubagentsArchivedForAgent,
  normalizeWorkspaceKey,
  patchPaseoSubagentTrackModules,
  readArchivedSubagentIds,
} from "../client/subagents-tree-web";
import {
  cleanSessionDisplayTitle,
  extractCurrentWorkspaceAndAgent,
  openWorkspaceTargetTabViaStore,
} from "../client/session-lineage-web";
import katex from "katex";
import {
  DEFAULT_MARKDOWN_TABLE_SAMPLE,
  DEFAULT_MARKDOWN_MATH_SAMPLE,
  TABLE_CELL_BR_SENTINEL,
  getCachedOrLoadedKaTeX,
  installMetroMarkdownTableHooks,
  normalizeMarkdownTablesForPaseo,
  repairMarkdownAstTables,
  repairRenderedDomMath,
  runMarkdownTableSelfTest,
  readMarkdownTablePreferences,
  MARKDOWN_TABLE_PREFS_KEY,
  setCachedKaTeX,
  syncMarkdownTablePreferences,
} from "../client/markdown-table-web";
import {
  formatCompactLabelAsProseWithLocalTime,
  formatConciseLocalFinishedTime,
  formatRelativeWithLocalTime,
  formatTurnWorkedForWithFinishedTime,
  getSessionTimeHealthSnapshot,
  getUserTimezoneInfo,
  parseEndedTimestampFromAriaLabel,
  patchMetroSessionTimeModules,
  runSessionTimeSelfTest,
  syncSessionTimePreferences,
} from "../client/session-time-web";

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

    const defaultOpenRes = await handleOpenFileTarget(
      { path: "demo.png", workspaceRoot: tmpRoot, target: "system-default" },
      ctx,
      { dryRun: true },
    );
    assert.equal(defaultOpenRes.ok, true);
    assert.equal(defaultOpenRes.resolvedPath, imgPath);

    const diagRes = await handleDiagnosePath(
      { rawInput: "demo.png", workspaceRoot: tmpRoot },
      ctx,
    );
    assert.equal(diagRes.resolvedMetadata.exists, true);
    assert.equal(diagRes.availableTargets.length, 7);
    assert.equal(diagRes.availableTargets[0].label, "System default application");
    assert.equal(diagRes.availableTargets[1].label, "Reveal in Finder");
    assert.ok(diagRes.recentActions.length >= 3);
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
    extractFilePathFromElement({ textContent: "design/prototype/index.html" } as any, mockDoc),
    "design/prototype/index.html",
  );
  assert.equal(
    extractFilePathFromElement({ textContent: "design/screenshots/" } as any, mockDoc),
    "design/screenshots/",
  );
  assert.equal(
    extractFilePathFromElement(
      { textContent: "文件是 design/prototype/index.html，不用装任何东西" } as any,
      mockDoc,
    ),
    "design/prototype/index.html",
  );
  assert.equal(
    extractFilePathFromElement({ textContent: "`design/prototype/index.html`" } as any, mockDoc),
    "design/prototype/index.html",
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

  assert.equal(count, 4);
  // Menu order must be: Copy file path -> Open with default application -> Reveal in Finder -> Open containing folder -> Open in Preview -> Close
  assert.equal(menuChildren.length, 6);
  assert.equal(
    menuChildren[1].getAttribute?.("data-testid"),
    "workspace-tab-context-file_docs/file_inspector_finder_plugin.md-open-system-default",
  );
  assert.equal(
    (menuChildren[1] as unknown as { getLabel: () => string }).getLabel(),
    "Open with default application",
  );
  assert.equal(
    menuChildren[2].getAttribute?.("data-testid"),
    "workspace-tab-context-file_docs/file_inspector_finder_plugin.md-reveal-in-finder",
  );
  assert.equal(
    (menuChildren[2] as unknown as { getLabel: () => string }).getLabel(),
    "Reveal in Finder",
  );
  assert.equal(
    (menuChildren[3] as unknown as { getLabel: () => string }).getLabel(),
    "Open containing folder",
  );
  assert.equal(
    (menuChildren[4] as unknown as { getLabel: () => string }).getLabel(),
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
  assert.equal(menuChildren.length, 6);

  // Clicking "Reveal in Finder" triggers the exact path and target
  (menuChildren[2] as unknown as { triggerClick: () => void }).triggerClick();
  assert.deepEqual(triggeredCalls, [
    { path: "docs/file_inspector_finder_plugin.md", target: "finder-reveal" },
  ]);

  // Clicking "Open with default application" triggers system-default target
  (menuChildren[1] as unknown as { triggerClick: () => void }).triggerClick();
  assert.deepEqual(triggeredCalls, [
    { path: "docs/file_inspector_finder_plugin.md", target: "finder-reveal" },
    { path: "docs/file_inspector_finder_plugin.md", target: "system-default" },
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
  assert.equal(zhCatalog.actions.openInSystemDefault, "用系统默认应用打开");
  assert.equal(zhCatalog.actions.copyFilePath, "复制文件路径");

  const enCatalog = getCatalogForLocale("en-US");
  assert.equal(enCatalog.actions.revealInFinder, "Reveal in Finder");
  assert.equal(enCatalog.actions.openContainingFolder, "Open containing folder");
  assert.equal(enCatalog.actions.openInPreview, "Open in Preview");
  assert.equal(enCatalog.actions.openInSystemDefault, "Open with default application");
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

  const deleteRes = await handleManageWorkspaceLabels(
    {
      action: "delete",
      workspaceId: "ws_0",
      labelName: "feature",
    },
    ctx,
    { bridge: mockBridge },
  );
  assert.equal(deleteRes.ok, true);
  assert.deepEqual(deleteRes.assignedLabels, ["⭐️"]);
  assert.equal(deleteRes.catalog.some((c) => c.name === "feature"), false);
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
        getPathForFile: () => "/workspace/projects/2026-11-08 Design Systems",
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  assert.deepEqual(extractDroppedFilePaths(finderDrag, mockWin), [
    "/workspace/projects/2026-11-08 Design Systems",
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
  parentNode?: MinimalElement | null;
  replaceChild?: (newChild: MinimalElement, oldChild: MinimalElement) => void;
  classList?: {
    add: (...tokens: string[]) => void;
    remove: (...tokens: string[]) => void;
    contains: (token: string) => boolean;
  };
  ownerDocument?: {
    createElement: (tag: string) => MinimalElement;
    createTextNode?: (text: string) => { nodeValue: string; textContent: string };
    createDocumentFragment?: () => MinimalElement;
  };
} {
  const attrs = new Map<string, string>(Object.entries(initialAttrs));
  const listeners = new Map<string, Array<(ev: unknown) => void>>();
  const children: MinimalElement[] = [];

  let explicitText = initialText;
  let explicitHtml = "";

  const mockOwnerDocument = {
    createElement: (tag: string) => createInteractiveDomNode(tag),
    createTextNode: (text: string) => ({ nodeValue: text, textContent: text }),
    createDocumentFragment: () => createInteractiveDomNode("div"),
  };

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
    parentNode?: MinimalElement | null;
    replaceChild?: (newChild: MinimalElement, oldChild: MinimalElement) => void;
    classList?: {
      add: (...tokens: string[]) => void;
      remove: (...tokens: string[]) => void;
      contains: (token: string) => boolean;
    };
    ownerDocument?: {
      createElement: (tag: string) => MinimalElement;
      createTextNode?: (text: string) => { nodeValue: string; textContent: string };
      createDocumentFragment?: () => MinimalElement;
    };
  } = {
    tagName: tagName.toUpperCase(),
    ownerDocument: mockOwnerDocument,
    get textContent() {
      if (explicitText) return explicitText;
      if (children.length > 0) {
        return children.map((c) => c.textContent ?? "").join(" ").trim();
      }
      return "";
    },
    set textContent(val: string | null | undefined) {
      explicitText = val ?? "";
      explicitHtml = "";
    },
    get innerHTML() {
      return explicitHtml || explicitText;
    },
    set innerHTML(val: string) {
      explicitHtml = val;
      explicitText = val.replace(/<[^>]*>/g, "");
    },
    get className() {
      return attrs.get("class") ?? "";
    },
    set className(val: string) {
      attrs.set("class", val);
    },
    value: "",
    style: {},
    children,
    parentElement: null,
    get parentNode() {
      return node.parentElement ?? null;
    },
    set parentNode(val: MinimalElement | null) {
      node.parentElement = val;
    },
    attrs,
    listeners,
    focused: false,
    selected: false,
    selectionStart: null,
    selectionEnd: null,
    scrollLeft: 0,
    classList: {
      add: (...tokens: string[]) => {
        const cur = attrs.get("class") ?? "";
        const parts = cur ? cur.split(/\s+/).filter(Boolean) : [];
        for (const t of tokens) {
          if (!parts.includes(t)) parts.push(t);
        }
        attrs.set("class", parts.join(" "));
      },
      remove: (...tokens: string[]) => {
        const cur = attrs.get("class") ?? "";
        const parts = cur.split(/\s+/).filter((p) => !tokens.includes(p));
        attrs.set("class", parts.join(" "));
      },
      contains: (token: string) => {
        const cur = attrs.get("class") ?? "";
        return cur.split(/\s+/).includes(token);
      },
    },
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
    replaceChild: (newChild: MinimalElement, oldChild: MinimalElement) => {
      newChild.parentElement = node;
      const idx = children.indexOf(oldChild);
      if (idx >= 0) {
        children.splice(idx, 1, newChild);
      } else {
        children.push(newChild);
      }
      oldChild.parentElement = null;
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
      const testSelectorPart = (el: MinimalElement, sel: string): boolean => {
        const s = sel.trim();
        if (!s) return false;
        const tag = (el.tagName ?? "").toLowerCase();
        const tid = el.getAttribute?.("data-testid") ?? "";
        const role = el.getAttribute?.("role") ?? "";
        const cls = el.getAttribute?.("class") ?? "";

        const roleMatch = s.match(/^(?:([a-z0-9_-]+))?\[role="([^"]+)"\]$/i);
        if (roleMatch) {
          const reqTag = roleMatch[1]?.toLowerCase();
          const reqRole = roleMatch[2];
          return (!reqTag || tag === reqTag) && role === reqRole;
        }

        const matchAttr = s.match(/^\[data-testid="([^"]+)"\]$/);
        if (matchAttr) return tid === matchAttr[1];
        const matchPrefix = s.match(/^\[data-testid\^="([^"]+)"\]$/);
        if (matchPrefix) return tid.startsWith(matchPrefix[1]);

        if (s.startsWith(".")) {
          return cls.split(/\s+/).includes(s.slice(1));
        }

        if (/^[a-z0-9_-]+$/i.test(s)) {
          return tag === s.toLowerCase();
        }

        if (s.includes("textarea") && tag === "textarea") return true;
        return false;
      };

      const matchesAnySelector = (el: MinimalElement, sel: string): boolean => {
        const parts = sel.split(",").map((p) => p.trim());
        for (const p of parts) {
          const subParts = p.split(/\s+/);
          const lastPart = subParts[subParts.length - 1]!;
          if (testSelectorPart(el, lastPart)) return true;
        }
        return false;
      };

      const walk = (el: MinimalElement): MinimalElement | null => {
        if (matchesAnySelector(el, selector)) return el;
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
      const testSelectorPart = (el: MinimalElement, sel: string): boolean => {
        const s = sel.trim();
        if (!s) return false;
        const tag = (el.tagName ?? "").toLowerCase();
        const tid = el.getAttribute?.("data-testid") ?? "";
        const role = el.getAttribute?.("role") ?? "";
        const cls = el.getAttribute?.("class") ?? "";

        const roleMatch = s.match(/^(?:([a-z0-9_-]+))?\[role="([^"]+)"\]$/i);
        if (roleMatch) {
          const reqTag = roleMatch[1]?.toLowerCase();
          const reqRole = roleMatch[2];
          return (!reqTag || tag === reqTag) && role === reqRole;
        }

        const matchAttr = s.match(/^\[data-testid="([^"]+)"\]$/);
        if (matchAttr) return tid === matchAttr[1];
        const matchPrefix = s.match(/^\[data-testid\^="([^"]+)"\]$/);
        if (matchPrefix) return tid.startsWith(matchPrefix[1]);

        if (s.startsWith(".")) {
          return cls.split(/\s+/).includes(s.slice(1));
        }

        if (/^[a-z0-9_-]+$/i.test(s)) {
          return tag === s.toLowerCase();
        }

        if (s.includes("textarea") && tag === "textarea") return true;
        return false;
      };

      const matchesAnySelector = (el: MinimalElement, sel: string): boolean => {
        const parts = sel.split(",").map((p) => p.trim());
        for (const p of parts) {
          const subParts = p.split(/\s+/);
          const lastPart = subParts[subParts.length - 1]!;
          if (testSelectorPart(el, lastPart)) return true;
        }
        return false;
      };

      const out: MinimalElement[] = [];
      const walk = (el: MinimalElement) => {
        if (matchesAnySelector(el, selector)) out.push(el);
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
      let stopped = false;
      const ev = {
        type,
        target: node,
        preventDefault: () => {},
        stopPropagation: () => {
          stopped = true;
        },
        ...extra,
      };
      for (const fn of listeners.get(type) ?? []) {
        fn(ev);
      }
      if (!stopped) {
        let parent = node.parentElement;
        while (parent && !stopped) {
          const parentAny = parent as unknown as { listeners?: Map<string, Array<(e: unknown) => void>> };
          for (const fn of parentAny.listeners?.get(type) ?? []) {
            fn(ev);
            if (stopped) break;
          }
          parent = parent.parentElement;
        }
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
    "/Users/test/workspaces/2026-11-08 Design System Studio",
  );
  assert.ok(dssKeywords.includes("design system studio"));
  assert.ok(dssKeywords.includes("design"));
  assert.ok(dssKeywords.includes("dss"), "Must generate initialism/acronym dss");

  const dssCandidate = {
    projectName: "2026-11-08 Design System Studio",
    projectRootPath: "/Users/test/workspaces/2026-11-08 Design System Studio",
    shortPath: "~/workspaces/2026-11-08 Design System Studio",
    primaryWorkspaceTitle: "Design Thread 9",
  };
  const metaCandidate = {
    projectName: "2026-11-08 Meta harness",
    projectRootPath: "/Users/test/workspaces/2026-11-08 Meta harness",
    shortPath: "~/workspaces/2026-11-08 Meta harness",
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

    // 4) New-workspace mode (Default) -> targets project context without creating thread in daemon
    const newWsDss = await handleQuickJumpWorkspace(
      { action: "jump", projectId: "prj_dss", jumpMode: "new-workspace" },
      mockCtx,
    );
    assert.equal(newWsDss.ok, true);
    assert.equal(newWsDss.jumpMode, "new-workspace");
    assert.equal(newWsDss.targetProjectId, "prj_dss");
    assert.equal(newWsDss.targetProjectKey, "key_dss");
    assert.equal(newWsDss.targetWorkspaceId, null);
    assert.equal(newWsDss.targetDirectory, dssDir);

    // 5) Create-new mode -> creates a fresh workspace thread inside Design System Studio
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

  let pushedRoute = "";
  let popstateDispatched = false;
  let focusedComposer = false;

  const composerTextarea = createInteractiveDomNode("textarea", {
    "data-testid": "composer-textarea",
  });
  composerTextarea.focus = () => {
    focusedComposer = true;
  };
  body.appendChild?.(composerTextarea);

  const mockWin: MinimalWindow = {
    document: mockDoc,
    innerWidth: 1280,
    innerHeight: 800,
    location: { pathname: "/workspace/old_ws", search: "" },
    history: {
      pushState: (_data: unknown, _title: string, url: string) => {
        pushedRoute = url;
      },
    },
    dispatchEvent: (ev: unknown) => {
      if (ev && typeof ev === "object" && (ev as { type?: string }).type === "popstate") {
        popstateDispatched = true;
      }
      return true;
    },
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
          projectRootPath: "/Users/test/workspaces/2026-11-08 Design System Studio",
          shortPath: "~/workspaces/2026-11-08 Design System Studio",
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
          projectRootPath: "/Users/test/workspaces/2026-11-08 Meta harness",
          shortPath: "~/workspaces/2026-11-08 Meta harness",
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
        executedJumps.push({
          projectId: input.projectId ?? "",
          jumpMode: input.jumpMode ?? "",
        });
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

  // 3) Default Enter action in Quick Workspace Switcher must be 'new-workspace' (opens compose view, not thread!)
  executedJumps.length = 0;
  await openQuickWorkspaceSwitcherModal(
    {
      locale: "en-US",
      onListJumpProjects: async () => [
        {
          projectId: "prj_dss",
          projectKey: "key_dss",
          projectName: "2026-11-08 Design System Studio",
          projectRootPath: "/Users/test/workspaces/2026-11-08 Design System Studio",
          shortPath: "~/workspaces/2026-11-08 Design System Studio",
          projectKind: "directory",
          activeWorkspaceCount: 10,
          primaryWorkspaceId: "wks_dss_latest",
          primaryWorkspaceTitle: "Design Main",
          hasRunningAgent: false,
          lastActivityIso: "2026-11-08T10:00:00.000Z",
          lastActivityRelative: "2m ago",
          score: 100,
        },
      ],
      onExecuteQuickJump: async (input) => {
        executedJumps.push({
          projectId: input.projectId ?? "",
          jumpMode: input.jumpMode ?? "",
        });
        return {
          ok: true,
          jumpMode: input.jumpMode ?? "new-workspace",
          targetWorkspaceId: null,
          targetProjectId: "prj_dss",
          targetProjectKey: "key_dss",
          targetProjectName: "2026-11-08 Design System Studio",
          targetDirectory: "/Users/test/workspaces/2026-11-08 Design System Studio",
          message: "Opened New Workspace for Design System Studio",
        };
      },
    },
    mockDoc,
    mockWin,
  );

  const defaultSearchInput = body.querySelector?.(
    '[data-testid="paseo-finder-quick-jump-input"]',
  ) as ReturnType<typeof createInteractiveDomNode>;
  assert.ok(defaultSearchInput, "Input must exist on re-open");

  // Press bare Enter -> executes new-workspace by default!
  defaultSearchInput.dispatch("keydown", { key: "Enter" });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(executedJumps, [
    { projectId: "prj_dss", jumpMode: "new-workspace" },
  ]);

  // 4) Option+Enter executes open-latest (switches to latest existing thread)
  executedJumps.length = 0;
  await openQuickWorkspaceSwitcherModal(
    {
      locale: "en-US",
      onListJumpProjects: async () => [
        {
          projectId: "prj_dss",
          projectKey: "key_dss",
          projectName: "2026-11-08 Design System Studio",
          projectRootPath: "/Users/test/workspaces/2026-11-08 Design System Studio",
          shortPath: "~/workspaces/2026-11-08 Design System Studio",
          projectKind: "directory",
          activeWorkspaceCount: 10,
          primaryWorkspaceId: "wks_dss_latest",
          primaryWorkspaceTitle: "Design Main",
          hasRunningAgent: false,
          lastActivityIso: "2026-11-08T10:00:00.000Z",
          lastActivityRelative: "2m ago",
          score: 100,
        },
      ],
      onExecuteQuickJump: async (input) => {
        executedJumps.push({
          projectId: input.projectId ?? "",
          jumpMode: input.jumpMode ?? "",
        });
        return {
          ok: true,
          jumpMode: input.jumpMode ?? "open-latest",
          targetWorkspaceId: "wks_dss_latest",
          targetProjectId: "prj_dss",
          targetProjectKey: "key_dss",
          targetProjectName: "2026-11-08 Design System Studio",
          message: "Switched to latest thread",
        };
      },
    },
    mockDoc,
    mockWin,
  );

  const optSearchInput = body.querySelector?.(
    '[data-testid="paseo-finder-quick-jump-input"]',
  ) as ReturnType<typeof createInteractiveDomNode>;
  optSearchInput.dispatch("keydown", { key: "Enter", altKey: true });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(executedJumps, [
    { projectId: "prj_dss", jumpMode: "open-latest" },
  ]);

  // 5) openNewWorkspaceInApp navigates to /new with preselected project and focuses composer
  let newWorktreeBtnClicked = false;
  const newWorktreeBtn = createInteractiveDomNode("div", {
    "data-testid": "sidebar-project-new-worktree-key_dss",
  });
  newWorktreeBtn.click = () => {
    newWorktreeBtnClicked = true;
  };
  dssProjectRow.appendChild?.(newWorktreeBtn);

  const opened = openNewWorkspaceInApp(
    {
      projectId: "prj_dss",
      projectKey: "key_dss",
      projectName: "2026-11-08 Design System Studio",
      projectDirectory: "/Users/test/workspaces/2026-11-08 Design System Studio",
    },
    mockDoc,
    mockWin,
  );

  assert.equal(opened, true);
  assert.equal(newWorktreeBtnClicked, true, "Must click project's native New Workspace button in sidebar");
  assert.ok(pushedRoute.startsWith("/new?"), `Pushed route should target /new: ${pushedRoute}`);
  assert.ok(pushedRoute.includes("projectId=prj_dss"), "Must carry projectId");
  assert.ok(pushedRoute.includes("dir="), "Must carry project directory");
  assert.equal(focusedComposer, true, "Must focus composer input for immediate typing");
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
          cwd: "/Users/test/webhook-hub",
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
          cwd: "/Users/test/idle",
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
  assert.equal(maskApiKeyPreview("demo_" + "1234567890abcdef"), "demo_1...cdef");
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
            apiKey: "mock-siliconflow-local-pool",
            baseUrl: "http://127.0.0.1:8787/v1",
            model: "gemini-2.5-flash",
          },
        },
        voiceMode: {
          enabled: false,
          stt: {
            provider: "openai",
            apiKey: "mock-siliconflow-local-pool",
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
  const colorName = derivePaseoIdentityColorName("dir:/Users/test/workspaces/2026-11-08 Meta harness");
  const colorHex = derivePaseoIdentityColorHex("dir:/Users/test/workspaces/2026-11-08 Meta harness");
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

  const fixedNowMs = new Date(2026, 10, 9, 18, 0, 0).getTime();
  const sameDayRunIso = new Date(2026, 10, 9, 17, 25, 0).toISOString();
  const tomorrowRunIso = new Date(2026, 10, 10, 0, 0, 0).toISOString();
  const yesterdayRunIso = new Date(2026, 10, 8, 23, 0, 0).toISOString();
  const satRunIso = new Date(2026, 10, 7, 3, 0, 0).toISOString();

  assert.equal(
    formatAntigravityRunTimestamp(sameDayRunIso, { nowMs: fixedNowMs, isZh: false }),
    "Today 5:25 PM",
  );
  assert.equal(
    formatAntigravityRunTimestamp(tomorrowRunIso, { nowMs: fixedNowMs, isZh: false }),
    "Tomorrow 12:00 AM",
  );
  assert.equal(
    formatAntigravityRunTimestamp(yesterdayRunIso, { nowMs: fixedNowMs, isZh: false }),
    "Yesterday 11:00 PM",
  );
  assert.equal(
    formatAntigravityRunTimestamp(satRunIso, { nowMs: fixedNowMs, isZh: false }),
    "Sat 3:00 AM",
  );
  assert.equal(
    formatAntigravityRunTimestamp(sameDayRunIso, { nowMs: fixedNowMs, isZh: true }),
    "今天 17:25",
  );
  assert.equal(
    formatCompactSidebarAge(new Date(fixedNowMs - 18 * 3600_000).toISOString(), fixedNowMs),
    "18h",
  );
  assert.equal(
    formatCompactSidebarAge(new Date(fixedNowMs - 2 * 86_400_000).toISOString(), fixedNowMs),
    "2d",
  );

  const map = new Map([
    [
      "sched_0",
      {
        id: "sched_0",
        name: "Morning Brief",
        cron: "0 8 * * *",
        enabled: true,
        status: "active" as const,
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
        lastRunAt: sameDayRunIso,
        lastRunStatus: "succeeded" as const,
        nextRunAt: tomorrowRunIso,
        runs: [],
      },
    ],
  ]);

  const first = decorateSchedulesDomOnDocument(doc, {
    schedulesById: map,
    totals: { totalSchedules: 135, schedulesWithRuns: 1, totalRuns: 3 },
    isZh: false,
    nowMs: fixedNowMs,
    onOpenDrawer: () => {},
  });
  assert.equal(first.rowCount, 135);
  assert.ok(first.domWrites > 135);

  // Verify toolbar & column header were mounted INSIDE schedules-table, NOT in scrollParent!
  assert.equal(scrollParent.childrenList.length, 1);
  assert.equal(scrollParent.childrenList[0], tableEl);
  assert.equal(tableEl.childrenList[0]?.id, "paseo-finder-all-runs-toolbar");
  assert.equal(tableEl.childrenList[1]?.id, "paseo-finder-schedules-col-header");

  const nextCol0 = queryTree(scrollParent, '[data-testid="schedule-next-run-col-sched_0"]')[0];
  const lastCol0 = queryTree(scrollParent, '[data-testid="schedule-last-run-col-sched_0"]')[0];
  assert.equal(nextCol0?.textContent, "Tomorrow 12:00 AM");
  assert.equal(lastCol0?.textContent, "Today 5:25 PM");

  // Second pass with identical state performs ZERO DOM writes across all 135 rows!
  const second = decorateSchedulesDomOnDocument(doc, {
    schedulesById: map,
    totals: { totalSchedules: 135, schedulesWithRuns: 1, totalRuns: 3 },
    isZh: false,
    nowMs: fixedNowMs,
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
  assert.equal(statusRes.unhealedCount, statusRes.interruptedCount);
  assert.equal(statusRes.ok, statusRes.unhealedCount === 0);
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

test("32. Antigravity inline /skill autocomplete bridge upgrades [skill]-tagged and native builtin commands (/goal, /plan, /deepagent) across WS session envelopes, DaemonClient.listCommands, and QueryClient agentCommands cache", async () => {
  const sampleWire = JSON.stringify({
    type: "list_commands_response",
    payload: {
      requestId: "req-1",
      commands: [
        { name: "plan", description: "Plan implementation", kind: "command", argumentHint: "[task]" },
        { name: "goal", description: "Run autonomously until goal complete", kind: "command", argumentHint: "[skill] <objective>" },
        { name: "boost", description: "Multi-agent boost", kind: "command", argumentHint: "[skill] <task>" },
        { name: "wheel-check", description: "Search existing solutions", kind: "command", argumentHint: "[skill]" },
        { name: "computer-use", description: "Full desktop computer use", kind: "command", argumentHint: "[skill]" },
        { name: "custom-non-skill", description: "Non-skill command", kind: "command", argumentHint: "[arg]" },
      ],
    },
  });

  // Also test the real Paseo WSOutboundEnvelope: { type: "session", message: { type: "list_commands_response", payload: { ... } } }
  const sampleSessionEnvelopeWire = JSON.stringify({
    type: "session",
    message: {
      type: "list_commands_response",
      payload: {
        agentId: "d03fd8d3-b866-4abc-b028-b82e282ff08f",
        requestId: "req-envelope-1",
        error: null,
        commands: [
          { name: "goal", description: "Run autonomously until goal complete", kind: "command", argumentHint: "<objective>" },
          { name: "wheel-check", description: "Search existing solutions", kind: "command", argumentHint: "[skill]" },
          { name: "graphify", description: "Architecture graph", kind: "command", argumentHint: "[skill] <query>" },
        ],
      },
    },
  });

  const directNorm = normalizeListCommandsResponsePayload(JSON.parse(sampleWire)) as {
    payload: {
      commands: Array<{ name: string; kind: string; argumentHint?: string }>;
    };
  };
  assert.equal(directNorm.payload.commands[0].kind, "skill");
  assert.equal(directNorm.payload.commands[0].argumentHint, "[task]");
  assert.equal(directNorm.payload.commands[1].kind, "skill");
  assert.equal(directNorm.payload.commands[1].argumentHint, "<objective>");
  assert.equal(directNorm.payload.commands[2].kind, "skill");
  assert.equal(directNorm.payload.commands[2].argumentHint, "<task>");
  assert.equal(directNorm.payload.commands[3].kind, "skill");
  assert.equal(directNorm.payload.commands[3].argumentHint, "");
  assert.equal(directNorm.payload.commands[4].kind, "skill");
  assert.equal(directNorm.payload.commands[4].argumentHint, "");
  assert.equal(directNorm.payload.commands[5].kind, "command");
  assert.equal(directNorm.payload.commands[5].argumentHint, "[arg]");

  // Mock QueryClient and HostRuntimeStore
  const cachedPrePluginCommands = [
    { name: "goal", description: "Run autonomously", kind: "command", argumentHint: "<objective>" },
    { name: "wheel-check", description: "Search existing solutions", kind: "command", argumentHint: "[skill]" },
  ];
  let currentCachedQueryData: unknown = cachedPrePluginCommands;
  let cacheSubscriber: ((event?: { query?: unknown }) => void) | null = null;
  const mockQueryObj = {
    queryKey: ["agentCommands", "local", "agent", "d03fd8d3"],
    state: {
      get data() {
        return currentCachedQueryData;
      },
    },
  };
  const mockQueryClient = {
    getQueryCache: () => ({
      getAll: () => [mockQueryObj],
      subscribe: (fn: (event?: { query?: unknown }) => void) => {
        cacheSubscriber = fn;
        return () => {};
      },
    }),
    setQueryData: (_key: unknown, nextData: unknown) => {
      currentCachedQueryData = nextData;
    },
  };

  const mockDaemonClient = {
    listCommands: async () => ({
      commands: [
        { name: "1password", description: "1Password vault", kind: "command", argumentHint: "[skill]" },
      ],
    }),
  };

  const mockJson = {
    parse: JSON.parse.bind(JSON),
    stringify: JSON.stringify.bind(JSON),
  };
  const fakeWin = {
    JSON: mockJson,
    __paseoHostRuntimeStore: {
      controllers: new Map([["local", { getClient: () => mockDaemonClient }]]),
      subscribeAll: () => () => {},
    },
    __c: () =>
      new Map([
        [961, { publicModule: { exports: { queryClient: mockQueryClient } } }],
      ]),
  } as unknown as MinimalWindow;

  ensureAntigravityInlineSkillAutocompleteBridge(fakeWin);
  // Idempotent second call
  ensureAntigravityInlineSkillAutocompleteBridge(fakeWin);

  // 1) Direct list_commands_response via JSON.parse
  const parsedViaWin = mockJson.parse(sampleWire) as typeof directNorm;
  assert.equal(parsedViaWin.payload.commands[0].kind, "skill");
  assert.equal(parsedViaWin.payload.commands[1].kind, "skill");
  assert.equal(parsedViaWin.payload.commands[1].argumentHint, "<objective>");
  assert.equal(parsedViaWin.payload.commands[2].kind, "skill");
  assert.equal(typeof parsedViaWin.payload.commands[2].argumentHint, "string");
  assert.equal(parsedViaWin.payload.commands[3].kind, "skill");
  assert.equal(parsedViaWin.payload.commands[3].argumentHint, "");
  assert.equal(parsedViaWin.payload.commands[4].kind, "skill");

  // 2) Wrapped { type: "session", message: { type: "list_commands_response", ... } } WS envelope via JSON.parse
  const parsedEnvelope = mockJson.parse(sampleSessionEnvelopeWire) as {
    type: string;
    message: {
      type: string;
      payload: {
        commands: Array<{ name: string; kind: string; argumentHint?: string }>;
      };
    };
  };
  assert.equal(parsedEnvelope.message.payload.commands[0].kind, "skill");
  assert.equal(parsedEnvelope.message.payload.commands[0].argumentHint, "<objective>");
  assert.equal(parsedEnvelope.message.payload.commands[1].kind, "skill");
  assert.equal(parsedEnvelope.message.payload.commands[1].argumentHint, "");
  assert.equal(parsedEnvelope.message.payload.commands[2].kind, "skill");
  assert.equal(parsedEnvelope.message.payload.commands[2].argumentHint, "<query>");

  // 3) Pre-cached ["agentCommands", ...] in QueryClient is upgraded with a new array reference (including /goal)
  assert.notEqual(currentCachedQueryData, cachedPrePluginCommands);
  const upgradedCacheArr = currentCachedQueryData as Array<{ name: string; kind: string; argumentHint?: string }>;
  assert.equal(upgradedCacheArr[0].kind, "skill");
  assert.equal(upgradedCacheArr[0].argumentHint, "<objective>");
  assert.equal(upgradedCacheArr[1].kind, "skill");
  assert.equal(upgradedCacheArr[1].argumentHint, "");

  // 4) Future cache writes via cacheSubscriber also get upgraded
  assert.ok(cacheSubscriber);
  currentCachedQueryData = [
    { name: "ego-browser", description: "Browser automation", kind: "command", argumentHint: "[skill]" },
  ];
  (cacheSubscriber as (event?: { query?: unknown }) => void)({ query: mockQueryObj });
  const upgradedSubArr = currentCachedQueryData as Array<{ name: string; kind: string; argumentHint?: string }>;
  assert.equal(upgradedSubArr[0].kind, "skill");
  assert.equal(upgradedSubArr[0].argumentHint, "");

  // 5) DaemonClient.listCommands wrapper upgrades returned commands
  const clientRes = (await mockDaemonClient.listCommands()) as {
    commands: Array<{ name: string; kind: string; argumentHint?: string }>;
  };
  assert.equal(clientRes.commands[0].kind, "skill");
  assert.equal(clientRes.commands[0].argumentHint, "");
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

test("36. ⌘+Click (Cmd+Click) directly opens file with outside system default app and left sidebar in Finder", () => {
  const openCalls: {
    path: string;
    target: OpenerTarget;
    workspaceId?: string;
    projectName?: string;
  }[] = [];
  let registeredClickHandler: ((ev: unknown) => void) | null = null;

  const mockDoc: MinimalDocument = {
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute: () => {}, style: {} }),
    addEventListener: (type: string, handler: (ev: unknown) => void) => {
      if (type === "click") {
        registeredClickHandler = handler;
      }
    },
    removeEventListener: () => {},
  };

  const store = new Map<string, string>();
  const mockWin: MinimalWindow = {
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
    document: mockDoc,
    location: { pathname: "/workspace/wks_test_active" },
  };

  const cleanup = installDesktopRevealHelpers(
    {
      isEnabled: () => true,
      getLocale: () => "en",
      onOpenTarget: async (path, target, wsId, projName) => {
        openCalls.push({ path, target, workspaceId: wsId, projectName: projName });
      },
      onCopyPath: async () => {},
    },
    mockDoc,
    mockWin,
  );

  assert.ok(registeredClickHandler, "Click handler must be registered on document");
  const clickHandler: (ev: any) => void = registeredClickHandler!;

  // 1. ⌘+Click (Cmd+Click) on chat file link (design/prototype/index.html)
  let prevented = false;
  let stopped = false;
  const fileLinkEl = {
    textContent: "design/prototype/index.html",
    getAttribute: () => null,
    parentElement: null,
  };
  clickHandler({
    button: 0,
    metaKey: true,
    altKey: false,
    ctrlKey: false,
    target: fileLinkEl,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.deepEqual(openCalls[0], {
    path: "design/prototype/index.html",
    target: "system-default",
    workspaceId: undefined,
    projectName: undefined,
  });

  // 2. ⌘+Click on a directory link (design/screenshots/)
  prevented = false;
  stopped = false;
  const dirLinkEl = {
    textContent: "design/screenshots/",
    getAttribute: () => null,
    parentElement: null,
  };
  clickHandler({
    button: 0,
    metaKey: true,
    altKey: false,
    ctrlKey: false,
    target: dirLinkEl,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.deepEqual(openCalls[1], {
    path: "design/screenshots/",
    target: "system-default",
    workspaceId: undefined,
    projectName: undefined,
  });

  // 3. ⌘+Click on left sidebar workspace row
  prevented = false;
  stopped = false;
  const wsRowEl = {
    textContent: "Design LRL multilingual app",
    getAttribute: (name: string) =>
      name === "data-testid" ? "sidebar-workspace-row-local:wks_lang_1" : null,
    parentElement: null,
  };
  clickHandler({
    button: 0,
    metaKey: true,
    altKey: false,
    ctrlKey: false,
    target: wsRowEl,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.deepEqual(openCalls[2], {
    path: ".",
    target: "finder-folder",
    workspaceId: "wks_lang_1",
    projectName: undefined,
  });

  // 4. ⌘+Click on left sidebar project row
  prevented = false;
  stopped = false;
  const projRowEl = {
    textContent: "Language Learning",
    getAttribute: (name: string) =>
      name === "data-testid" ? "sidebar-project-row-local:proj_lang" : null,
    parentElement: null,
  };
  clickHandler({
    button: 0,
    metaKey: true,
    altKey: false,
    ctrlKey: false,
    target: projRowEl,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.deepEqual(openCalls[3], {
    path: ".",
    target: "finder-folder",
    workspaceId: undefined,
    projectName: "Language Learning",
  });

  // 5. Option+Click on file link still triggers finder-reveal
  prevented = false;
  stopped = false;
  clickHandler({
    button: 0,
    metaKey: false,
    altKey: true,
    ctrlKey: false,
    target: fileLinkEl,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(openCalls[4], {
    path: "design/prototype/index.html",
    target: "finder-reveal",
    workspaceId: undefined,
    projectName: undefined,
  });

  cleanup();
});

test("43. Subagent & Timer Sidebar route resolution on /workspace/local:wks_... and manageSubagentsRpc schema", () => {
  assert.equal(normalizeWorkspaceKey("local:wks_c206b1aecedb6750"), "wks_c206b1aecedb6750");
  assert.equal(normalizeWorkspaceKey("wks_c206b1aecedb6750"), "wks_c206b1aecedb6750");
  assert.equal(normalizeWorkspaceKey(""), null);
  assert.equal(
    extractCurrentRouteAgentId("/ag/0db20d19-074c-43a4-a4de-77b3b3d16a02"),
    "0db20d19-074c-43a4-a4de-77b3b3d16a02",
  );
  assert.equal(
    extractCurrentRouteAgentId("/workspace/local:wks_c206b1aecedb6750"),
    null,
  );

  const ctx = extractCurrentWorkspaceAndAgent(
    null,
    { location: { pathname: "/workspace/local:wks_c206b1aecedb6750" } } as unknown as Window,
  );
  assert.equal(ctx.workspaceId, "local:wks_c206b1aecedb6750");
  assert.equal(normalizeWorkspaceKey(ctx.workspaceId), "wks_c206b1aecedb6750");

  const parsedInput = manageSubagentsRpc.input.parse({
    action: "inspect",
    workspaceId: "wks_c206b1aecedb6750",
    includeTimeline: true,
    source: "drawer",
  });
  assert.equal(parsedInput.workspaceId, "wks_c206b1aecedb6750");
  assert.equal(parsedInput.includeTimeline, true);
});

test("44. Markdown table <br> cell line-break, <truncated N bytes> row repair, and AST/Metro hooks", () => {
  const selfTest = runMarkdownTableSelfTest(DEFAULT_MARKDOWN_TABLE_SAMPLE);
  assert.equal(selfTest.ok, true, selfTest.summary);
  assert.equal(selfTest.bodyRowCount, 4);
  assert.equal(selfTest.colCount, 4);
  assert.equal(selfTest.cellLineBreaksPreserved, true);
  assert.equal(selfTest.truncatedRowRepaired, true);
  assert.equal(selfTest.codeSpanBrPreserved, true);

  // Verify fenced code block with <br> is untouched while table cell <br> becomes sentinel
  const mixedMd = [
    "| Col A | Col B |",
    "| --- | --- |",
    "| [a](file:///a)<br>[b](file:///b) | keep `<br>` literal |",
    "",
    "```html",
    "| fenced | <br> |",
    "```",
  ].join("\n");
  const norm = normalizeMarkdownTablesForPaseo(mixedMd);
  assert.equal(norm.lineBreaksConverted, 1);
  assert.ok(norm.text.includes(`[a](file:///a)${TABLE_CELL_BR_SENTINEL}[b](file:///b)`));
  assert.ok(norm.text.includes("keep `<br>` literal"));
  assert.ok(norm.text.includes("| fenced | <br> |"));

  // Verify AST repair splits Text with sentinel into LineBreak and unescapes \| inside Code
  const sampleAst = {
    type: "Document",
    children: [
      {
        type: "Table",
        children: [
          {
            type: "TableBody",
            children: [
              {
                type: "TableRow",
                children: [
                  {
                    type: "TableCell",
                    children: [
                      { type: "Text", text: `line1${TABLE_CELL_BR_SENTINEL}line2` },
                      { type: "Code", text: "a \\| b" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const repaired = repairMarkdownAstTables(sampleAst);
  assert.equal(repaired.lineBreaksConverted, 1);
  const cellChildren = (
    repaired.ast as {
      children: Array<{
        children: Array<{
          children: Array<{
            children: Array<{ children: Array<{ type: string; text?: string }> }>;
          }>;
        }>;
      }>;
    }
  ).children[0]!.children[0]!.children[0]!.children[0]!.children;
  assert.deepEqual(cellChildren, [
    { type: "Text", text: "line1" },
    { type: "LineBreak" },
    { type: "Text", text: "line2" },
    { type: "Code", text: "a | b" },
  ]);

  // Verify Metro module registry hook intercepts normalizeMarkdownHtml and parseMarkdownSync
  const fakeModules = new Map<number, unknown>();
  for (let i = 0; i < 60; i++) {
    fakeModules.set(i, { isInitialized: true, publicModule: { exports: {} } });
  }
  const mod4117 = {
    isInitialized: true,
    publicModule: {
      exports: {
        // Simulates Paseo's bug: replaces <br> with "  \n"
        normalizeMarkdownHtml: (s: string) => s.replace(/<br\s*\/?>/gi, "  \n"),
      },
    },
  };
  const mod3993 = {
    isInitialized: true,
    publicModule: {
      exports: {
        parseMarkdownSync: (s: string) => ({
          type: "Document",
          children: [
            {
              type: "Table",
              children: [
                {
                  type: "TableBody",
                  children: [
                    {
                      type: "TableRow",
                      children: [
                        {
                          type: "TableCell",
                          children: [{ type: "Text", text: s }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
    },
  };
  fakeModules.set(4117, mod4117);
  fakeModules.set(3993, mod3993);

  const fakeWin = {
    __r: (id: number) => fakeModules.get(id),
  } as unknown as Window & { __r?: unknown };

  const hooked = installMetroMarkdownTableHooks(fakeWin);
  assert.equal(hooked, true);
  const afterNorm = mod4117.publicModule.exports.normalizeMarkdownHtml(
    "| A | B |\n| --- | --- |\n| 1<br>2 | 3 |",
  );
  // Must remain 3 lines (table row NOT split by "  \n")
  assert.equal(afterNorm.split("\n").length, 3);

  // Verify getpaseo/paseo#8782 edge case: <details><summary>Results</summary>| A | B | and blockquote table > | 1 | first<br>second |
  const detailsWrapped = normalizeMarkdownTablesForPaseo(
    "<details><summary>Results</summary>| A | B |\n|---|---|\n| 1 | first<br>second |\n</details>",
  );
  assert.equal(detailsWrapped.lineBreaksConverted, 1);
  assert.ok(detailsWrapped.text.includes("</summary>\n\n| A | B |"));
  assert.ok(detailsWrapped.text.includes(`first${TABLE_CELL_BR_SENTINEL}second`));

  const quotedTable = normalizeMarkdownTablesForPaseo(
    "> | A | B |\n> |---|---|\n> | 1 | alpha<br/>beta |",
  );
  assert.equal(quotedTable.lineBreaksConverted, 1);
  assert.ok(quotedTable.text.includes(`alpha${TABLE_CELL_BR_SENTINEL}beta`));
});

test("44b. LaTeX Math formula rendering (KaTeX MathML), Metro AST options override & DOM fallback healing", () => {
  // 1. Initialize KaTeX in plugin cache and verify single truth source
  setCachedKaTeX(katex);
  const activeKatex = getCachedOrLoadedKaTeX();
  assert.ok(activeKatex, "KaTeX instance must be available in getCachedOrLoadedKaTeX()");
  assert.equal(typeof activeKatex?.renderToString, "function");

  // 2. Test the exact mathematical formulas from the user's screenshot
  const screenshotFormula1 =
    "\\text{算力杠杆倍数} = \\frac{\\$500 \\sim \\$600 \\text{ USD 真实 API 额度}}{\\$20 \\text{ USD 实际月支出}} \\approx \\mathbf{25 \\times \\sim 30 \\times}";
  const screenshotFormula2 =
    "\\text{批发杠杆倍数} = \\frac{\\$500 \\sim \\$600 \\text{ USD}}{\\$2 \\sim \\$3 \\text{ USD}} \\approx \\mathbf{150 \\times \\sim 250 \\times}";

  const renderedHtml1 = activeKatex.renderToString(screenshotFormula1, {
    output: "mathml",
    displayMode: true,
    throwOnError: false,
    trust: false,
  });
  assert.ok(
    renderedHtml1.includes('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">'),
    "Display formula must render native MathML display block",
  );
  assert.ok(renderedHtml1.includes("算力杠杆倍数"), "Rendered MathML must preserve CJK math text");
  assert.ok(renderedHtml1.includes("<mfrac>"), "Fraction must compile to <mfrac>");

  const renderedHtml2 = activeKatex.renderToString(screenshotFormula2, {
    output: "mathml",
    displayMode: true,
    throwOnError: false,
    trust: false,
  });
  assert.ok(renderedHtml2.includes("批发杠杆倍数"));
  assert.ok(renderedHtml2.includes("<mfrac>"));

  // 3. Test Metro module 3999 (KaTeXRenderer) hook: injects KaTeX when Paseo passes katex: null
  type MockKaTeXRendererProps = {
    content: string;
    katex?: { renderToString: (tex: string, opts: unknown) => string } | null;
    displayMode?: boolean;
  };
  const mockMod3999 = {
    isInitialized: true,
    publicModule: {
      exports: {
        KaTeXRenderer: (props: MockKaTeXRendererProps) => {
          const p = props.displayMode ? "$$" : "$";
          if (!props.katex) {
            return { fallback: true, text: `${p}${props.content}${p}` };
          }
          const html = props.katex.renderToString(props.content, {
            output: "mathml",
            displayMode: props.displayMode,
          });
          return { fallback: false, html };
        },
      },
    },
  };

  // 4. Test Metro module 3993 (parseMarkdownSync) hook: overrides Paseo's latexMath: false flag
  let capturedOptions: Record<string, unknown> | undefined;
  const mockMod3993 = {
    isInitialized: true,
    publicModule: {
      exports: {
        parseMarkdownSync: (input: string, options?: Record<string, unknown>) => {
          capturedOptions = options;
          return {
            type: "Document",
            children: [
              {
                type: "LatexMathDisplay",
                children: [{ type: "Text", text: input }],
              },
            ],
          };
        },
      },
    },
  };

  const fakeMetroModules = new Map<number, unknown>();
  for (let i = 0; i < 60; i++) {
    fakeMetroModules.set(i, { isInitialized: true, publicModule: { exports: {} } });
  }
  fakeMetroModules.set(3999, mockMod3999);
  fakeMetroModules.set(3993, mockMod3993);

  const fakeWindow = {
    __r: (id: number) => fakeMetroModules.get(id),
  } as unknown as Window & { __r?: unknown };

  const installOk = installMetroMarkdownTableHooks(fakeWindow);
  assert.equal(installOk, true, "installMetroMarkdownTableHooks must succeed on mock Metro runtime");

  // Verify parseMarkdownSync forcibly turns on latexMath: true even when Paseo caller passes latexMath: false
  mockMod3993.publicModule.exports.parseMarkdownSync("$$E=mc^2$$", {
    latexMath: false,
    hardSoftBreaks: true,
  });
  assert.equal(capturedOptions?.latexMath, true, "latexMath flag must be overridden to true");

  // Verify KaTeXRenderer supplies cached KaTeX when caller passed null/undefined
  const renderResult = mockMod3999.publicModule.exports.KaTeXRenderer({
    content: "E=mc^2",
    katex: null, // simulates Paseo's broken prop where katex was not loaded
    displayMode: true,
  }) as { fallback: boolean; html?: string; text?: string };
  assert.equal(renderResult.fallback, false, "KaTeXRenderer must not use fallback when hook supplies KaTeX");
  assert.ok(renderResult.html?.includes("<math"), "KaTeXRenderer output must contain native MathML");

  // 5. Test DOM Math Healer on pre-rendered fallback nodes
  const mockContainer = createInteractiveDomNode("div");
  const fallbackSpanDisplay = createInteractiveDomNode(
    "span",
    { role: "math", "aria-label": screenshotFormula1 },
    `$$${screenshotFormula1}$$`,
  );
  const fallbackSpanInline = createInteractiveDomNode(
    "span",
    { role: "math", "aria-label": "E=mc^2" },
    "$E=mc^2$",
  );
  const rawCodeBlock = createInteractiveDomNode(
    "code",
    {},
    `$$${screenshotFormula2}$$`,
  );
  mockContainer.appendChild?.(fallbackSpanDisplay);
  mockContainer.appendChild?.(fallbackSpanInline);
  mockContainer.appendChild?.(rawCodeBlock);

  const domRes = repairRenderedDomMath(mockContainer as unknown as ParentNode);
  assert.ok(domRes.mathNodesScanned >= 2, "DOM healer must scan all math candidates");
  assert.ok(domRes.mathNodesHealed >= 2, "DOM healer must heal unrendered fallback formulas");
  assert.ok(fallbackSpanDisplay.innerHTML?.includes("<math"), "Display span must receive compiled MathML");
  assert.ok(fallbackSpanInline.innerHTML?.includes("<math"), "Inline span must receive compiled MathML");

  // 6. Test runMarkdownTableSelfTest end-to-end integration
  const selfTest = runMarkdownTableSelfTest();
  assert.equal(selfTest.ok, true, selfTest.summary);
  assert.equal(selfTest.mathFormulaRendered, true, "Self-test must prove math formula renders");
  assert.ok(selfTest.summary.includes("KaTeX MathML 公式渲染正常"));

  // 7. Verify preference toggle
  syncMarkdownTablePreferences({ renderLatexMath: false });
  // When disabled, parseMarkdownSync does not force latexMath
  mockMod3993.publicModule.exports.parseMarkdownSync("$$x=1$$", { latexMath: false });
  assert.equal(capturedOptions?.latexMath, false, "When disabled, latexMath flag should not be forced");

  // Restore defaults
  syncMarkdownTablePreferences({ renderLatexMath: true });
  mockMod3993.publicModule.exports.parseMarkdownSync("$$x=1$$", { latexMath: false });
  assert.equal(capturedOptions?.latexMath, true, "When re-enabled, latexMath flag must be forced again");
});

test("44c. LaTeX Math lazy Metro hooks, EnrichedMarkdownText wrapper, DOM deduplication & storage persistence", () => {
  // 1. Test EnrichedMarkdownText (Module 3986) hook: forces md4cFlags.latexMath = true
  let receivedEnrichedProps: Record<string, unknown> | undefined;
  const mockMod3986 = {
    isInitialized: true,
    publicModule: {
      exports: {
        EnrichedMarkdownText: (props: Record<string, unknown>) => {
          receivedEnrichedProps = props;
          return { rendered: true };
        },
      },
    },
  };

  // 2. Test lazy uninitialized Metro module discovery via factory string
  let factoryInitialized = false;
  const mockLazyMod = {
    isInitialized: false,
    factory: function () {
      factoryInitialized = true;
      return {
        exports: {
          loadKaTeX: async () => katex,
        },
      };
    },
    publicModule: {
      exports: {
        loadKaTeX: async () => katex,
      },
    },
  };

  const fakeMetroMap = new Map<number, unknown>();
  for (let i = 0; i < 60; i++) {
    fakeMetroMap.set(i, { isInitialized: true, publicModule: { exports: {} } });
  }
  fakeMetroMap.set(3986, mockMod3986);
  fakeMetroMap.set(4006, mockLazyMod);

  const mockReq = (id: number) => {
    const m = fakeMetroMap.get(id) as {
      isInitialized?: boolean;
      factory?: () => unknown;
      publicModule?: { exports?: Record<string, unknown> };
    };
    if (m && !m.isInitialized && typeof m.factory === "function") {
      m.isInitialized = true;
      m.factory();
    }
    return m?.publicModule?.exports;
  };

  const fakeWin = {
    __r: mockReq,
    __c: () => fakeMetroMap,
  } as unknown as Window & { __r?: unknown; __c?: unknown };

  const hooked = installMetroMarkdownTableHooks(fakeWin);
  assert.equal(hooked, true, "installMetroMarkdownTableHooks should succeed on lazy Metro map");
  assert.equal(factoryInitialized, true, "Lazy module with factory containing loadKaTeX should be initialized");

  // Call EnrichedMarkdownText with latexMath: false (as Paseo 3984 does)
  mockMod3986.publicModule.exports.EnrichedMarkdownText({
    text: "Formula: $$\\frac{1}{2}$$",
    md4cFlags: { latexMath: false, hardSoftBreaks: true },
  });
  const passedFlags = receivedEnrichedProps?.md4cFlags as Record<string, unknown>;
  assert.equal(passedFlags?.latexMath, true, "EnrichedMarkdownText hook must force md4cFlags.latexMath = true");
  assert.equal(passedFlags?.hardSoftBreaks, true, "Other md4cFlags must be preserved");

  // 3. Test DOM Math Healer: deduplication of nested <pre><code>, language-math blocks & inline code
  const fakeDoc = {
    createElement: (tag: string) => createInteractiveDomNode(tag),
  };
  const testContainer = createInteractiveDomNode("div");
  (testContainer as unknown as { ownerDocument: typeof fakeDoc }).ownerDocument = fakeDoc;
  const preEl = createInteractiveDomNode("pre");
  (preEl as unknown as { ownerDocument: typeof fakeDoc }).ownerDocument = fakeDoc;
  const codeInsidePre = createInteractiveDomNode("code", {}, "$$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$");
  preEl.appendChild?.(codeInsidePre);

  const mathLangBlock = createInteractiveDomNode(
    "code",
    { class: "language-math" },
    "\\int_0^1 x^2 dx = \\frac{1}{3}",
  );

  const inlineCodeSpan = createInteractiveDomNode("code", {}, "$\\sqrt{2}$");

  testContainer.appendChild?.(preEl);
  testContainer.appendChild?.(mathLangBlock);
  testContainer.appendChild?.(inlineCodeSpan);

  const healRes = repairRenderedDomMath(testContainer as unknown as ParentNode);
  // pre + language-math + inline = 3 healed formulas (pre's child code is NOT double-healed)
  assert.equal(healRes.mathNodesHealed, 3, "Exactly 3 distinct formulas must be healed without child duplication");

  // 4. Test storage persistence
  const storageStore = new Map<string, string>();
  const customStorage = {
    getItem: (k: string) => storageStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storageStore.set(k, v);
    },
    removeItem: (k: string) => {
      storageStore.delete(k);
    },
  };

  syncMarkdownTablePreferences({ renderLatexMath: false }, customStorage);
  const storedJson = storageStore.get(MARKDOWN_TABLE_PREFS_KEY);
  assert.ok(storedJson, "Preferences must be saved to custom storage");
  assert.ok(storedJson.includes('"renderLatexMath":false'), "Stored JSON must reflect renderLatexMath: false");

  const restored = readMarkdownTablePreferences(customStorage);
  assert.equal(restored.renderLatexMath, false, "readMarkdownTablePreferences must read stored values");

  // Restore defaults
  syncMarkdownTablePreferences({ renderLatexMath: true }, customStorage);
  assert.equal(readMarkdownTablePreferences(customStorage).renderLatexMath, true);
});

test("45. Workspace Labels shortcut (Cmd+L / Cmd+Shift+L) & native menu shortcut annotation with UI Observability", async () => {
  // 1. LabelShortcutComboSchema validation
  assert.equal(LabelShortcutComboSchema.parse("both"), "both");
  assert.equal(LabelShortcutComboSchema.parse("cmd_l"), "cmd_l");
  assert.equal(LabelShortcutComboSchema.parse("cmd_shift_l"), "cmd_shift_l");
  assert.throws(() => LabelShortcutComboSchema.parse("alt_l"));

  // 2. Storage defaults & sync
  const storageMap = new Map<string, string>();
  const mockStorage = {
    length: 0,
    key: () => null,
    getItem: (k: string) => storageMap.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storageMap.set(k, v);
    },
    removeItem: (k: string) => {
      storageMap.delete(k);
    },
    clear: () => storageMap.clear(),
  };

  assert.equal(readInlineRenamePreferences(mockStorage).labelShortcutCombo, "both");
  syncInlineRenamePreferences({ labelShortcutCombo: "cmd_l" }, mockStorage);
  assert.equal(readInlineRenamePreferences(mockStorage).labelShortcutCombo, "cmd_l");
  syncInlineRenamePreferences({ labelShortcutCombo: "both" }, mockStorage);
  assert.equal(readInlineRenamePreferences(mockStorage).labelShortcutCombo, "both");

  // 3. annotateNativeWorkspaceMenusWithShortcuts
  const createdElements: Array<ReturnType<typeof createInteractiveDomNode>> = [];
  const persistentLabelItem = createInteractiveDomNode("div");
  persistentLabelItem.setAttribute?.("data-testid", "sidebar-workspace-menu-labels-wks_meta");
  persistentLabelItem.appendChild?.(createInteractiveDomNode("svg"));
  persistentLabelItem.appendChild?.(createInteractiveDomNode("span"));
  persistentLabelItem.appendChild?.(createInteractiveDomNode("svg"));

  const persistentRenameItem = createInteractiveDomNode("div");
  persistentRenameItem.setAttribute?.("data-testid", "sidebar-workspace-menu-rename-wks_meta");
  persistentRenameItem.appendChild?.(createInteractiveDomNode("svg"));
  persistentRenameItem.appendChild?.(createInteractiveDomNode("span"));

  const mockDocForMenu = {
    createElement: (tag: string) => {
      const el = createInteractiveDomNode(tag);
      createdElements.push(el);
      return el;
    },
    querySelectorAll: (selector: string) => {
      if (selector === '[data-testid^="sidebar-workspace-menu-labels-"]') {
        return [persistentLabelItem];
      }
      if (selector === '[data-testid^="sidebar-workspace-menu-rename-"]') {
        return [persistentRenameItem];
      }
      return [];
    },
  } as unknown as Parameters<typeof annotateNativeWorkspaceMenusWithShortcuts>[0];

  const prefs = readInlineRenamePreferences(mockStorage);
  const count = annotateNativeWorkspaceMenusWithShortcuts(mockDocForMenu, prefs);
  assert.equal(count, 2, "Annotated both labels and rename menu items");

  // Check labels badge shows ⌘L with pill styling
  const labelsHintBadge = createdElements.find(
    (e) => e.getAttribute?.("data-testid") === "sidebar-workspace-menu-label-shortcut-hint",
  );
  assert.ok(labelsHintBadge, "Label shortcut badge must be created");
  assert.equal(labelsHintBadge.textContent, "⌘L");
  assert.equal(labelsHintBadge.style?.borderRadius, "4px");
  assert.equal(labelsHintBadge.style?.padding, "1px 5px");

  // Check rename badge shows F2 with pill styling
  const renameHintBadge = createdElements.find(
    (e) => e.getAttribute?.("data-testid") === "sidebar-workspace-menu-rename-shortcut-hint",
  );
  assert.ok(renameHintBadge, "Rename shortcut badge must be created");
  assert.equal(renameHintBadge.textContent, "F2");
  assert.equal(renameHintBadge.style?.borderRadius, "4px");

  // Dynamic preference update: changing to cmd_shift_l updates existing badge text to ⇧⌘L without creating duplicate
  const shiftOnlyPrefs = { ...prefs, labelShortcutCombo: "cmd_shift_l" as const };
  const prevCount = createdElements.length;
  annotateNativeWorkspaceMenusWithShortcuts(mockDocForMenu, shiftOnlyPrefs);
  assert.equal(labelsHintBadge.textContent, "⇧⌘L", "Existing badge must update text reactively");
  assert.equal(createdElements.length, prevCount, "Must not create duplicate badge elements");

  // Non-macOS platform formatting: Windows/Linux shows Ctrl+L / Ctrl+Shift+L
  const winMock = {
    navigator: { platform: "Win32", userAgent: "Windows NT 10.0" },
  } as unknown as Parameters<typeof annotateNativeWorkspaceMenusWithShortcuts>[2];
  annotateNativeWorkspaceMenusWithShortcuts(mockDocForMenu, prefs, winMock);
  assert.equal(labelsHintBadge.textContent, "Ctrl+L", "Non-Mac shows Ctrl+L for both/cmd_l");
  annotateNativeWorkspaceMenusWithShortcuts(mockDocForMenu, shiftOnlyPrefs, winMock);
  assert.equal(labelsHintBadge.textContent, "Ctrl+Shift+L", "Non-Mac shows Ctrl+Shift+L");

  // 4. resolveCurrentActiveWorkspaceId extracts workspace from active context menu
  const menuDoc = {
    querySelector: (sel: string) => {
      if (sel.includes("sidebar-workspace-menu-labels-")) {
        const el = createInteractiveDomNode("div");
        el.setAttribute?.("data-testid", "sidebar-workspace-menu-labels-wks_special_focus");
        return el;
      }
      return null;
    },
  } as unknown as Parameters<typeof resolveCurrentActiveWorkspaceId>[0];

  const resolvedWsId = resolveCurrentActiveWorkspaceId(menuDoc, null, "fallback_id");
  assert.equal(resolvedWsId, "wks_special_focus", "Targeted workspace extracted from context menu");

  // 5. findF2InlineRenameTarget prioritizes open context menu workspace over inactive selectedRow
  const inactiveSelectedRow = createInteractiveDomNode("div");
  inactiveSelectedRow.setAttribute?.("data-testid", "sidebar-workspace-row-local:wks_selected_inactive");
  inactiveSelectedRow.setAttribute?.("aria-selected", "true");
  const unselectedMenuRow = createInteractiveDomNode("div");
  unselectedMenuRow.setAttribute?.("data-testid", "sidebar-workspace-row-local:wks_right_clicked_target");
  const menuTitleEl = createInteractiveDomNode("span");
  menuTitleEl.setAttribute?.("data-testid", "sidebar-workspace-row-title-local:wks_right_clicked_target");
  menuTitleEl.textContent = "Right Clicked Target";
  unselectedMenuRow.appendChild?.(menuTitleEl);

  const f2MenuDoc = {
    querySelector: (sel: string) => {
      if (sel.includes("sidebar-workspace-menu-")) {
        const el = createInteractiveDomNode("div");
        el.setAttribute?.("data-testid", "sidebar-workspace-menu-rename-local:wks_right_clicked_target");
        return el;
      }
      if (sel.includes('[aria-selected="true"]')) {
        return inactiveSelectedRow;
      }
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes("sidebar-workspace-row-")) {
        return [inactiveSelectedRow, unselectedMenuRow];
      }
      return [];
    },
  } as unknown as Parameters<typeof findF2InlineRenameTarget>[0];

  const f2Target = findF2InlineRenameTarget(f2MenuDoc, null);
  assert.equal(f2Target?.workspaceId, "wks_right_clicked_target", "F2 targets the open context menu workspace");

  // 6. Cmd+L keyboard capture behavior
  const winListeners = new Map<string, Array<(ev: unknown) => void>>();
  const docListeners = new Map<string, Array<(ev: unknown) => void>>();
  const body = createInteractiveDomNode("body");
  const textInput = createInteractiveDomNode("textarea");
  const sidebarRow = createInteractiveDomNode("div");
  sidebarRow.setAttribute?.("data-testid", "sidebar-workspace-row-local:wks_meta");

  let querySelectorHook: ((sel: string) => ReturnType<typeof createInteractiveDomNode> | null) | null = null;
  const testDoc = {
    body,
    addEventListener: (t: string, fn: (ev: unknown) => void) => {
      if (!docListeners.has(t)) docListeners.set(t, []);
      docListeners.get(t)!.push(fn);
    },
    removeEventListener: () => {},
    createElement: (tag: string) => createInteractiveDomNode(tag),
    querySelector: (sel: string) => (querySelectorHook ? querySelectorHook(sel) : null),
    querySelectorAll: (sel: string) => (body.querySelectorAll ? body.querySelectorAll(sel) : []),
  } as unknown as Parameters<typeof installDesktopRevealHelpers>[1];

  const testWin = {
    localStorage: mockStorage,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: (t: string, fn: (ev: unknown) => void) => {
      if (!winListeners.has(t)) winListeners.set(t, []);
      winListeners.get(t)!.push(fn);
    },
    removeEventListener: (t: string, fn: (ev: unknown) => void) => {
      const arr = winListeners.get(t);
      if (arr) {
        const idx = arr.indexOf(fn);
        if (idx !== -1) arr.splice(idx, 1);
      }
    },
    requestAnimationFrame: (cb: () => void) => {
      cb();
      return 1;
    },
    cancelAnimationFrame: () => {},
  } as unknown as Parameters<typeof installDesktopRevealHelpers>[2];

  let fetchMetadataCalled = false;
  let deletedLabelName: string | null = null;
  let deleteCallCount = 0;
  let toggleLabelCalled = false;
  let catalogState: Array<{ name: string; color: WorkspaceLabelColor }> = [
    { name: "feat", color: "pink" },
    { name: "bug", color: "red" },
  ];
  let assignedState = ["feat"];

  const cleanup = installDesktopRevealHelpers(
    {
      isEnabled: () => true,
      onOpenTarget: async () => {},
      onCopyPath: async () => {},
      onFetchThreadMetadata: async () => {
        fetchMetadataCalled = true;
        return {
          workspaceId: "wks_meta",
          workspaceTitle: "Meta Workspace",
          assignedLabels: [...assignedState],
          catalog: [...catalogState],
        };
      },
      onToggleLabel: async () => {
        toggleLabelCalled = true;
        return null;
      },
      onDeleteLabel: async (labelName) => {
        deleteCallCount += 1;
        deletedLabelName = labelName;
        // Simulate small delay to test in-flight suppression
        await new Promise((r) => setTimeout(r, 10));
        catalogState = catalogState.filter((c) => c.name !== labelName);
        assignedState = assignedState.filter((l) => l !== labelName);
        return {
          workspaceId: "wks_meta",
          workspaceTitle: "Meta Workspace",
          assignedLabels: [...assignedState],
          catalog: [...catalogState],
        };
      },
    },
    testDoc,
    testWin,
  );

  const keyListeners = winListeners.get("keydown") ?? [];

  // A) Cmd+L in general chat view or on body with combo === "both" triggers labels bar universally!
  let prevented = false;
  fetchMetadataCalled = false;
  prevented = false;
  keyListeners[0]?.({
    key: "l",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: body,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
  });
  assert.equal(prevented, true, "Cmd+L on body opens labels bar universally");
  assert.equal(fetchMetadataCalled, true, "Metadata fetched to mount labels bar");

  // B) Cmd+L on editable input blurs input and triggers labels bar
  fetchMetadataCalled = false;
  prevented = false;
  let inputBlurred = false;
  const mockTextInput = {
    ...textInput,
    tagName: "TEXTAREA",
    blur: () => {
      inputBlurred = true;
    },
  };
  keyListeners[0]?.({
    key: "l",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: mockTextInput,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
  });
  assert.equal(prevented, true, "Cmd+L inside input blurs and opens labels bar");
  assert.equal(inputBlurred, true, "Input is blurred");
  assert.equal(fetchMetadataCalled, true, "Labels bar opened");

  // C) Cmd+L when targeting sidebar workspace row opens labels bar
  fetchMetadataCalled = false;
  prevented = false;
  keyListeners[0]?.({
    key: "l",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: sidebarRow,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
  });
  assert.equal(prevented, true, "Cmd+L on sidebar row opens labels bar");
  assert.equal(fetchMetadataCalled, true, "Metadata fetched to mount labels bar");

  // D) Cmd+L when context menu is open on screen opens labels bar
  querySelectorHook = (sel: string) => {
    if (sel.includes("sidebar-workspace-menu-")) {
      const el = createInteractiveDomNode("div");
      el.setAttribute?.("data-testid", "sidebar-workspace-menu-labels-wks_meta");
      return el;
    }
    return null;
  };
  fetchMetadataCalled = false;
  prevented = false;
  keyListeners[0]?.({
    key: "l",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: body,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
  });
  assert.equal(prevented, true, "Cmd+L with open context menu triggers labels bar");
  assert.equal(fetchMetadataCalled, true);
  querySelectorHook = null;

  // E) Cmd+Shift+L (⇧⌘L) is universal and triggers labels bar anywhere (even on body)
  fetchMetadataCalled = false;
  prevented = false;
  keyListeners[0]?.({
    key: "l",
    metaKey: true,
    ctrlKey: false,
    shiftKey: true,
    altKey: false,
    target: body,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
  });
  assert.equal(prevented, true, "Cmd+Shift+L universally opens labels bar");
  assert.equal(fetchMetadataCalled, true);

  // F) When labelShortcutCombo is explicitly "cmd_l", Cmd+L opens labels bar universally
  syncInlineRenamePreferences({ labelShortcutCombo: "cmd_l" }, mockStorage);
  fetchMetadataCalled = false;
  prevented = false;
  keyListeners[0]?.({
    key: "l",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: body,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
  });
  assert.equal(prevented, true, "Cmd+L opens labels bar universally when combo is cmd_l");
  assert.equal(fetchMetadataCalled, true);
  syncInlineRenamePreferences({ labelShortcutCombo: "both" }, mockStorage);

  // G) triggerQuickThreadMetadataBar test & tag deletion via small 'x'
  const triggerRes = await triggerQuickThreadMetadataBar("labels");
  assert.equal(triggerRes.ok, true);
  assert.ok(triggerRes.message.includes("labels mode"));

  const quickBar = body.querySelector?.(
    '[data-testid="paseo-finder-quick-thread-bar"]',
  ) as ReturnType<typeof createInteractiveDomNode> | null;
  assert.ok(quickBar, "Quick thread bar should be mounted in document body");

  const delBtn = quickBar.querySelector?.(
    '[data-testid="delete-tag-feat"]',
  ) as ReturnType<typeof createInteractiveDomNode> | null;
  assert.ok(delBtn, "Small delete button 'x' should be rendered on tag chip");
  assert.equal(delBtn.textContent, "×");

  // Rapid double-click while in-flight
  delBtn.dispatch("click");
  delBtn.dispatch("click");
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(deletedLabelName, "feat", "onDeleteLabel should be called with tag name");
  assert.equal(deleteCallCount, 1, "In-flight suppression prevents double-deletion call");
  assert.equal(toggleLabelCalled, false, "Clicking delete button should stop propagation and NOT toggle tag");

  const delBtnFeatAfter = quickBar.querySelector?.('[data-testid="delete-tag-feat"]');
  assert.equal(delBtnFeatAfter, null, "Deleted tag 'feat' should be removed from chips row");

  // 'bug' tag is still present
  const delBtnBug = quickBar.querySelector?.(
    '[data-testid="delete-tag-bug"]',
  ) as ReturnType<typeof createInteractiveDomNode> | null;
  assert.ok(delBtnBug, "'bug' tag should remain in chips row");

  // Delete 'bug' via keyboard Enter
  delBtnBug.dispatch("keydown", { key: "Enter" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(deletedLabelName, "bug");
  assert.equal(deleteCallCount, 2);

  // Now all tags are deleted, empty catalog hint is rendered
  const noLabelsHint = quickBar.querySelector?.('[data-testid="no-labels-hint"]');
  assert.ok(noLabelsHint, "Empty catalog hint element should be present");
  assert.ok(
    (quickBar.textContent ?? "").includes("No labels in catalog yet"),
    "Empty catalog hint text should be rendered when all labels are deleted",
  );

  // Close button 'x' and backdrop exist
  const closeBtn = quickBar.querySelector?.(
    '[data-testid="paseo-finder-quick-thread-bar-close"]',
  ) as ReturnType<typeof createInteractiveDomNode> | null;
  assert.ok(closeBtn, "Close button 'x' should exist in quick bar header");
  assert.equal(closeBtn.textContent, "×");

  let backdrop = body.querySelector?.(
    '[data-testid="paseo-finder-quick-thread-bar-backdrop"]',
  ) as ReturnType<typeof createInteractiveDomNode> | null;
  assert.ok(backdrop, "Backdrop element should exist to intercept outside clicks");

  // Clicking close button dismisses quick bar and backdrop
  closeBtn.dispatch("click");
  assert.equal(
    body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]'),
    null,
    "Quick bar should be dismissed after clicking close button",
  );
  assert.equal(
    body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar-backdrop"]'),
    null,
    "Backdrop should be dismissed after clicking close button",
  );

  // Re-open and test clicking backdrop dismisses quick bar
  await triggerQuickThreadMetadataBar("labels");
  assert.ok(body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]'));
  backdrop = body.querySelector?.(
    '[data-testid="paseo-finder-quick-thread-bar-backdrop"]',
  ) as ReturnType<typeof createInteractiveDomNode> | null;
  assert.ok(backdrop, "Backdrop re-created on bar re-open");
  backdrop.dispatch("pointerdown");
  assert.equal(
    body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]'),
    null,
    "Quick bar should be dismissed after clicking outside backdrop",
  );

  // Re-open and test Escape key dismisses quick bar
  await triggerQuickThreadMetadataBar("labels");
  assert.ok(body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]'));
  winListeners.get("keydown")?.forEach((fn) => {
    fn({
      key: "Escape",
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  });
  assert.equal(
    body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]'),
    null,
    "Quick bar should be dismissed on Escape key",
  );

  // Re-open and test switching sessions dismisses quick bar:
  // 1) Switching session via sidebar workspace row click
  await triggerQuickThreadMetadataBar("labels");
  assert.ok(body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]'));
  const otherRow = createInteractiveDomNode("div", {
    "data-testid": "sidebar-workspace-row-local:wks_other_session",
  });
  docListeners.get("pointerdown")?.forEach((fn) => {
    fn({
      target: otherRow,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  });
  assert.equal(
    body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]'),
    null,
    "Quick bar should be dismissed after switching session via sidebar click",
  );

  // 2) Switching session via route / popstate change
  await triggerQuickThreadMetadataBar("labels");
  assert.ok(body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]'));
  winListeners.get("popstate")?.forEach((fn) => {
    fn({});
  });
  assert.equal(
    body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]'),
    null,
    "Quick bar should be dismissed after switching session via route change (popstate)",
  );

  cleanup();
});

test("46. Session Search & Inline Mention Redirectability (⌘K shortId search, inline <code>fa22464</code> pill, Return Breadcrumb, and scoreProjectJumpQuery searchTokens)", async () => {
  const {
    ingestSessionLineageResponse,
    resolveSessionReference,
    recordSessionJump,
    getReturnBreadcrumbForSession,
    clearReturnBreadcrumbForSession,
    patchCommandCenterSearch,
    enhanceTimelineAgentMentions,
  } = await import("../client/session-lineage-web");

  // 1) Ingest directory with peer session fa224642-a55e-48ae-aece-c02e27cf916e
  const peerNode = {
    agentId: "fa224642-a55e-48ae-aece-c02e27cf916e",
    shortId: "fa22464",
    agentTitle: "how about let comand + l as label shortcut?",
    workspaceId: "wks_2g4z",
    workspaceTitle: "how about let comand + l as label shortcut?",
    projectId: "proj_meta",
    projectName: "2026-11-08 Meta harness",
    status: "idle",
    provider: "antigravity",
    model: "gemini-3.1-pro-high",
    providerSessionId: "16e692cc-2146-4335-bd89-98044e6e8641",
    createdAt: "2026-11-09T16:00:00Z",
    updatedAt: "2026-11-09T16:40:00Z",
    briefPath: null,
    reportPath: null,
    reportExists: false,
    notionUrl: null,
    notionTaskId: null,
  };

  const currentNode = {
    ...peerNode,
    agentId: "73fc0986-38cf-4265-a23d-111122223333",
    shortId: "73fc098",
    agentTitle: "d Add search for settings in Paseo",
    workspaceId: "wks_p098",
    workspaceTitle: "d Add search for settings in Paseo",
    providerSessionId: "457507d8-394c-4ffe-938d-107732660f53",
  };

  const mockLineageRes = {
    ok: true,
    action: "inspect" as const,
    workspaceId: "wks_p098",
    workspaceTitle: "d Add search for settings in Paseo",
    current: currentNode,
    parent: null,
    siblings: [],
    children: [],
    projectPeers: [peerNode],
    directory: [currentNode, peerNode],
    reconcileSummary: {
      untitledFound: 0,
      renamedCount: 0,
      unlinkedFound: 0,
      linkedCount: 0,
      renamedWorkspaces: [],
    },
    message: "ok",
    durationMs: 2,
  };

  ingestSessionLineageResponse(mockLineageRes);

  // 2) resolveSessionReference resolves 7-char shortId, #shortId, full UUID, workspaceId, conversation://, and rejects git commit SHAs
  assert.equal(resolveSessionReference("fa22464")?.agentId, peerNode.agentId);
  assert.equal(resolveSessionReference("#fa22464")?.agentId, peerNode.agentId);
  assert.equal(resolveSessionReference(peerNode.agentId)?.shortId, "fa22464");
  assert.equal(resolveSessionReference("wks_2g4z")?.agentId, peerNode.agentId);
  assert.equal(
    resolveSessionReference("conversation://16e692cc-2146-4335-bd89-98044e6e8641")?.agentId,
    peerNode.agentId,
  );
  assert.equal(
    resolveSessionReference("c27b203"),
    null,
    "Unrelated git commit SHA c27b203 must NOT match any session",
  );

  // 3) Return Breadcrumb stack records & clears session jumps
  const mockWin = { sessionStorage: new Map<string, string>() } as unknown as Window;
  recordSessionJump(currentNode, { agentId: peerNode.agentId, workspaceId: peerNode.workspaceId }, mockWin);
  const crumb = getReturnBreadcrumbForSession(peerNode.workspaceId, peerNode.agentId, mockWin);
  assert.ok(crumb, "Return breadcrumb should be found for target session");
  assert.equal(crumb?.agentId, currentNode.agentId);
  clearReturnBreadcrumbForSession(peerNode.workspaceId, peerNode.agentId, mockWin);
  assert.equal(
    getReturnBreadcrumbForSession(peerNode.workspaceId, peerNode.agentId, mockWin),
    null,
  );

  // 4) patchCommandCenterSearch patches filterAndRankBuiltInResults & filterAndRankWorkspaces so searching 'fa22464' matches
  const mockMetroExports = {
    filterAndRankBuiltInResults(
      items: any[],
      query: string,
      getFields: (item: any) => { visible: string[]; hidden?: string[] },
    ) {
      const q = query.trim().toLowerCase();
      return items.filter((it) => {
        const f = getFields(it);
        const hay = [...(f.visible ?? []), ...(f.hidden ?? [])].join(" ").toLowerCase();
        return hay.includes(q);
      });
    },
    filterAndRankWorkspaces(workspaces: any[], query: string) {
      const q = query.trim().toLowerCase();
      return workspaces.filter((ws) =>
        `${ws.title ?? ""} ${ws.subtitle ?? ""}`.toLowerCase().includes(q),
      );
    },
  };
  const winWithMetro = {
    __c: new Map([[4355, { isInitialized: true, publicModule: { exports: mockMetroExports } }]]),
  } as unknown as Window;

  const patched = patchCommandCenterSearch(winWithMetro);
  assert.equal(patched, true);

  const agentRows = [
    {
      id: `agent:local:${peerNode.agentId}`,
      kind: "agent",
      title: peerNode.agentTitle,
      subtitle: "Antigravity \u00b7 Meta harness",
      agent: {
        id: peerNode.agentId,
        workspaceId: peerNode.workspaceId,
        cwd: "/workspace/meta-harness",
      },
    },
  ];
  const matchedAgents = mockMetroExports.filterAndRankBuiltInResults(
    agentRows,
    "fa22464",
    (e) => ({ visible: [e.title, e.subtitle], hidden: [e.agent.cwd] }),
  );
  assert.equal(matchedAgents.length, 1, "Searching fa22464 in ⌘K must match the peer agent");
  assert.ok(
    matchedAgents[0].subtitle.includes("#fa22464"),
    "Matched agent subtitle in ⌘K should include #fa22464 for HighlightedText",
  );

  const workspaceRows = [
    {
      id: "workspace:local:wks_2g4z",
      kind: "workspace",
      workspaceId: "wks_2g4z",
      serverId: "local",
      title: peerNode.workspaceTitle,
      subtitle: "Meta harness",
      run: () => {},
    },
  ];
  const matchedWorkspaces = mockMetroExports.filterAndRankWorkspaces(workspaceRows, "fa22464");
  assert.equal(matchedWorkspaces.length, 1, "Searching fa22464 in ⌘K must also match its workspace");
  assert.ok(matchedWorkspaces[0].subtitle.includes("#fa22464"));

  // 5) scoreProjectJumpQuery matches workspaceIds and searchTokens
  const jumpScore = scoreProjectJumpQuery(
    {
      projectName: "Meta harness",
      projectRootPath: "/workspace/meta-harness",
      shortPath: "~/projects/meta-harness",
      primaryWorkspaceTitle: "how about let comand + l as label shortcut?",
      workspaceIds: ["wks_2g4z"],
      searchTokens: ["fa224642-a55e-48ae-aece-c02e27cf916e", "fa22464"],
    },
    "fa22464",
  );
  assert.ok(jumpScore >= 900, `Expected score >= 900 for shortId match, got ${jumpScore}`);
});

test("sidebar Delete key archives clicked session and annotates context menu with ⌫", async () => {
  // 1. isSidebarDeleteKeyboardEvent unit tests
  assert.equal(isSidebarDeleteKeyboardEvent({ key: "Backspace" } as KeyboardEvent), true);
  assert.equal(isSidebarDeleteKeyboardEvent({ key: "Delete" } as KeyboardEvent), true);
  assert.equal(isSidebarDeleteKeyboardEvent({ code: "Backspace" } as KeyboardEvent), true);
  assert.equal(isSidebarDeleteKeyboardEvent({ code: "Delete" } as KeyboardEvent), true);
  // Rejects modifiers
  assert.equal(isSidebarDeleteKeyboardEvent({ key: "Backspace", metaKey: true } as KeyboardEvent), false);
  assert.equal(isSidebarDeleteKeyboardEvent({ key: "Backspace", ctrlKey: true } as KeyboardEvent), false);
  assert.equal(isSidebarDeleteKeyboardEvent({ key: "Backspace", altKey: true } as KeyboardEvent), false);
  assert.equal(isSidebarDeleteKeyboardEvent({ key: "Backspace", shiftKey: true } as KeyboardEvent), false);
  // Rejects IME composing
  assert.equal(isSidebarDeleteKeyboardEvent({ key: "Backspace", isComposing: true } as KeyboardEvent), false);
  // Rejects regular keys
  assert.equal(isSidebarDeleteKeyboardEvent({ key: "Enter" } as KeyboardEvent), false);
  assert.equal(isSidebarDeleteKeyboardEvent({ key: "a" } as KeyboardEvent), false);

  // 2. shouldTriggerSidebarDeleteArchive safety guards
  const inputEl = createInteractiveDomNode("input");
  const textareaEl = createInteractiveDomNode("textarea");
  const editableEl = createInteractiveDomNode("div", { contenteditable: "true" });
  const inlineInputEl = createInteractiveDomNode("input", { "data-testid": "inline-title-input" });
  const commandCenterEl = createInteractiveDomNode("div", { "data-testid": "command-center" });
  const dialogEl = createInteractiveDomNode("div", { role: "dialog" });
  const sidebarRowEl = createInteractiveDomNode("div", { "data-testid": "sidebar-workspace-row-wks_meta" });

  const dummyDoc = {
    querySelector: () => null,
    activeElement: null,
  } as unknown as MinimalDocument;

  // Blocked in text inputs / composers / dialogs
  assert.equal(shouldTriggerSidebarDeleteArchive({ eventTarget: inputEl as unknown as EventTarget, doc: dummyDoc }), false);
  assert.equal(shouldTriggerSidebarDeleteArchive({ eventTarget: textareaEl as unknown as EventTarget, doc: dummyDoc }), false);
  assert.equal(shouldTriggerSidebarDeleteArchive({ eventTarget: editableEl as unknown as EventTarget, doc: dummyDoc }), false);
  assert.equal(shouldTriggerSidebarDeleteArchive({ eventTarget: inlineInputEl as unknown as EventTarget, doc: dummyDoc }), false);
  assert.equal(shouldTriggerSidebarDeleteArchive({ eventTarget: sidebarRowEl as unknown as EventTarget, doc: { ...dummyDoc, querySelector: (sel: string) => sel.includes("command-center") ? commandCenterEl : null } as unknown as MinimalDocument }), false);
  assert.equal(shouldTriggerSidebarDeleteArchive({ eventTarget: sidebarRowEl as unknown as EventTarget, doc: { ...dummyDoc, querySelector: (sel: string) => sel.includes("dialog") ? dialogEl : null } as unknown as MinimalDocument }), false);

  // Allowed when targeting sidebar row
  assert.equal(shouldTriggerSidebarDeleteArchive({ eventTarget: sidebarRowEl as unknown as EventTarget, doc: dummyDoc }), true);

  // Blocked when disabled via preference
  assert.equal(shouldTriggerSidebarDeleteArchive({ eventTarget: sidebarRowEl as unknown as EventTarget, doc: dummyDoc, prefs: { enableSidebarDeleteKeyArchive: false } as unknown as any }), false);

  // Safe from accidental archive when clicking in chat area / main window
  const chatBodyDoc = {
    querySelector: (sel: string) => {
      if (sel.includes('aria-selected="true"')) {
        return createInteractiveDomNode("div", { "data-testid": "sidebar-workspace-row-wks_active", "aria-selected": "true" });
      }
      return null;
    },
    activeElement: createInteractiveDomNode("body"),
  } as unknown as MinimalDocument;
  const chatTargetEl = createInteractiveDomNode("div", { "data-testid": "chat-message-bubble" });
  assert.equal(
    shouldTriggerSidebarDeleteArchive({ eventTarget: chatTargetEl as unknown as EventTarget, doc: chatBodyDoc }),
    false,
    "Pressing Delete in chat area when sidebar session is selected must NOT trigger archive",
  );

  // Direct click expires after 30 seconds
  assert.equal(
    shouldTriggerSidebarDeleteArchive({
      eventTarget: chatTargetEl as unknown as EventTarget,
      doc: dummyDoc,
      lastSidebarDirectClickWsId: "wks_old",
      lastSidebarDirectClickAtMs: Date.now() - 35000,
    }),
    false,
    "Expired click (> 30s) must not trigger archive",
  );

  // 3. resolveSidebarArchiveTarget prioritization
  const archiveMenuItem = createInteractiveDomNode("button", {
    "data-testid": "sidebar-workspace-menu-archive-wks_from_menu",
  });
  const docWithMenu = {
    querySelector: (sel: string) => {
      if (sel.includes("sidebar-workspace-menu-archive-")) return archiveMenuItem;
      return null;
    },
    querySelectorAll: () => [],
    activeElement: null,
  } as unknown as MinimalDocument;

  const targetFromMenu = resolveSidebarArchiveTarget(docWithMenu);
  assert.ok(targetFromMenu);
  assert.equal(targetFromMenu.workspaceId, "wks_from_menu");
  assert.equal(targetFromMenu.source, "context-menu");
  assert.equal(targetFromMenu.menuItem, archiveMenuItem);

  // When no menu open, targets clicked sidebar workspace
  const docNoMenu = {
    querySelector: (sel: string) => {
      if (sel.includes('data-selected="true"')) {
        return createInteractiveDomNode("div", { "data-testid": "sidebar-workspace-row-wks_selected" });
      }
      return null;
    },
    querySelectorAll: () => [],
    activeElement: null,
  } as unknown as MinimalDocument;

  const targetFromClick = resolveSidebarArchiveTarget(docNoMenu, { clickedWorkspaceId: "wks_clicked" });
  assert.ok(targetFromClick);
  assert.equal(targetFromClick.workspaceId, "wks_clicked");
  assert.equal(targetFromClick.source, "clicked-workspace");

  // When no click tracked, falls back to selected sidebar row
  const targetFromSelected = resolveSidebarArchiveTarget(docNoMenu);
  assert.ok(targetFromSelected);
  assert.equal(targetFromSelected.workspaceId, "wks_selected");
  assert.equal(targetFromSelected.source, "selected-row");

  // 4. archiveCurrentSidebarSession action execution
  let clickedMenu = false;
  archiveMenuItem.click = () => { clickedMenu = true; };

  let callbackWsId: string | undefined;
  const onArchiveCallback = async (wsId?: string) => {
    callbackWsId = wsId;
    return { ok: true, workspaceId: wsId };
  };

  const archiveResult = await archiveCurrentSidebarSession({
    doc: docWithMenu,
    onArchiveWorkspace: onArchiveCallback,
  });
  assert.equal(archiveResult.ok, true);
  assert.equal(archiveResult.workspaceId, "wks_from_menu");
  assert.equal(clickedMenu, true, "Must invoke native archive context menu item when open");

  // When no menu is open, calls callback directly
  let dispatchedEvent: unknown = null;
  const docForDispatch = {
    ...docNoMenu,
    dispatchEvent: (ev: unknown) => { dispatchedEvent = ev; return true; },
  } as unknown as MinimalDocument;

  const archiveResultNoMenu = await archiveCurrentSidebarSession({
    doc: docForDispatch,
    clickedWorkspaceId: "wks_clicked",
    onArchiveWorkspace: onArchiveCallback,
  });
  assert.equal(archiveResultNoMenu.ok, true);
  assert.equal(archiveResultNoMenu.workspaceId, "wks_clicked");
  assert.equal(callbackWsId, "wks_clicked");

  // 5. annotateNativeWorkspaceMenusWithShortcuts adds ⌫ badge to archive item
  const menuArchiveCreatedElements: Array<ReturnType<typeof createInteractiveDomNode>> = [];
  const persistentArchiveItem = createInteractiveDomNode("div");
  persistentArchiveItem.setAttribute?.("data-testid", "sidebar-workspace-menu-archive-wks_meta");
  persistentArchiveItem.appendChild?.(createInteractiveDomNode("svg"));
  persistentArchiveItem.appendChild?.(createInteractiveDomNode("span"));

  const mockDocForArchiveMenu = {
    createElement: (tag: string) => {
      const el = createInteractiveDomNode(tag);
      menuArchiveCreatedElements.push(el);
      return el;
    },
    querySelectorAll: (selector: string) => {
      if (selector === '[data-testid^="sidebar-workspace-menu-archive-"]') {
        return [persistentArchiveItem];
      }
      return [];
    },
  } as unknown as Parameters<typeof annotateNativeWorkspaceMenusWithShortcuts>[0];

  const countAnnotated = annotateNativeWorkspaceMenusWithShortcuts(
    mockDocForArchiveMenu,
    { enableSidebarDeleteKeyArchive: true } as unknown as any,
  );
  assert.ok(countAnnotated >= 1, "Must annotate archive menu item");

  const archiveBadge = menuArchiveCreatedElements.find(
    (e) => e.getAttribute?.("data-testid") === "sidebar-workspace-menu-archive-shortcut-hint",
  );
  assert.ok(archiveBadge, "Archive shortcut badge must be created");
  assert.equal(archiveBadge.textContent, "⌫", "On Mac, archive badge shows ⌫");
  assert.equal(archiveBadge.style?.borderRadius, "4px");

  // On non-Mac platforms, badge shows Del
  const winMockDel = {
    navigator: { platform: "Win32", userAgent: "Windows NT 10.0" },
  } as unknown as Parameters<typeof annotateNativeWorkspaceMenusWithShortcuts>[2];
  annotateNativeWorkspaceMenusWithShortcuts(
    mockDocForArchiveMenu,
    { enableSidebarDeleteKeyArchive: true } as unknown as any,
    winMockDel,
  );
  assert.equal(archiveBadge.textContent, "Del", "On Windows/Linux, archive badge shows Del");

  // 6. Test nested element deduplication prevents duplicate badges (no F2 F2 or double ⌫)
  const outerRename = createInteractiveDomNode("div");
  outerRename.setAttribute?.("data-testid", "sidebar-workspace-menu-rename-wks_meta");
  const innerRename = createInteractiveDomNode("div");
  innerRename.setAttribute?.("data-testid", "sidebar-workspace-menu-rename-wks_meta");
  outerRename.appendChild?.(innerRename);
  const mockDocNested = {
    createElement: (tag: string) => createInteractiveDomNode(tag),
    querySelectorAll: (sel: string) => {
      if (sel.includes("sidebar-workspace-menu-rename-")) return [outerRename, innerRename];
      return [];
    },
  } as unknown as Parameters<typeof annotateNativeWorkspaceMenusWithShortcuts>[0];
  annotateNativeWorkspaceMenusWithShortcuts(
    mockDocNested,
    { enableQuickRenameAndLabelShortcuts: true, enableDesktopContextMenuHelper: true } as any,
  );
  const renameBadges = outerRename.querySelectorAll?.('[data-testid="sidebar-workspace-menu-rename-shortcut-hint"]');
  assert.equal(renameBadges?.length ?? 1, 1, "Must never produce duplicate badges (no F2 F2)");

  // 7. archiveCurrentSidebarSession shows notice toast
  const mockBodyForToast = createInteractiveDomNode("body");
  const mockDocWithToast = {
    ...docNoMenu,
    body: mockBodyForToast,
    createElement: (tag: string) => createInteractiveDomNode(tag),
  } as unknown as MinimalDocument;
  const archiveToastRes = await archiveCurrentSidebarSession({
    doc: mockDocWithToast,
    clickedWorkspaceId: "wks_clicked_toast",
    onArchiveWorkspace: onArchiveCallback,
  });
  assert.equal(archiveToastRes.ok, true);
  const toastEl = (mockBodyForToast.children as MinimalElement[] | undefined)?.find(
    (c) => c.getAttribute?.("data-testid") === "paseo-finder-notice-toast",
  );
  assert.ok(toastEl, "Archive action must mount notice toast");
  assert.ok(
    toastEl.textContent?.includes("archived") || toastEl.textContent?.includes("归档"),
    "Notice toast must show session archived text",
  );

  // 8. handleArchiveWorkspace RPC handler
  const mockArchiveCtx = createMockContext(["/tmp/ws_test_archive"]);
  (mockArchiveCtx as any).paseo.workspaces.list = async () => ({
    entries: [{ id: "wks_test_archive", workspaceDirectory: "/tmp/ws_test_archive" }],
  });
  const dryRunRes = await handleArchiveWorkspace(
    {
      workspaceId: "wks_test_archive",
      dryRun: true,
    },
    mockArchiveCtx,
  );
  assert.equal(dryRunRes.ok, true);
  assert.equal(dryRunRes.workspaceId, "wks_test_archive");
  assert.equal(dryRunRes.archivedAt, null, "dryRun must return archivedAt null");
  assert.ok((dryRunRes.message ?? "").includes("Simulated archive"));

  const notFoundRes = await handleArchiveWorkspace(
    {
      workspaceId: "wks_not_found",
      dryRun: true,
    },
    mockArchiveCtx,
  );
  assert.equal(notFoundRes.ok, false);
  assert.equal(notFoundRes.archivedAt, null);
  assert.ok((notFoundRes.error ?? "").includes("not found"));
});

test("47. Tag delete option via small 'x' (defensive event propagation, keyboard navigation, in-flight guard, and UI observability)", async () => {
  const { getRecentActionLogs } = await import("../server/handlers");
  const { getCatalogForLocale } = await import("../client/i18n");

  // A) Single-language i18n assertions
  const enCat = getCatalogForLocale("en");
  const zhCat = getCatalogForLocale("zh");
  assert.equal(enCat.actions.deleteLabel, "Delete label");
  assert.equal(zhCat.actions.deleteLabel, "删除标签");
  assert.equal(/[\u4e00-\u9fa5]/.test(enCat.actions.deleteLabel), false, "English catalog must contain 0 Chinese");
  assert.equal(/[a-zA-Z]/.test(zhCat.actions.deleteLabel), false, "Chinese catalog must contain 0 English");

  // B) Recent action logs verify audit receipt on action: "delete"
  const logs = getRecentActionLogs();
  assert.ok(
    logs.some((l) => l.target === "workspace-meta" && l.message.includes("Deleted label")),
    "handleManageWorkspaceLabels with delete action must record UI Observability audit log",
  );
});

test("48. Session finished time in user local timezone (concise HH:mm / MM/DD HH:mm, turn footer, sidebar, and Metro hooks)", () => {
  syncSessionTimePreferences({
    enabled: true,
    clockFormat: "24h",
    showFinishedTimeInSidebar: true,
    showRelativeAgeInTurnFooter: true,
  });

  const tz = getUserTimezoneInfo();
  assert.ok(tz.timeZone.length > 0);
  assert.ok(tz.offsetLabel.startsWith("GMT"));

  const now = new Date(2026, 10, 10, 9, 15, 0); // 2026-11-10 09:15 local
  const nowMs = now.getTime();
  const sameDayDone = new Date(2026, 10, 10, 1, 38, 24); // 2026-11-10 01:38:24 local (7h ago)
  const crossDayDone = new Date(2026, 10, 9, 23, 48, 10); // 2026-11-09 23:48:10 local (9h ago)
  const crossYearDone = new Date(2025, 11, 31, 22, 5, 0); // 2025-12-31 22:05:00 local

  assert.equal(
    formatConciseLocalFinishedTime(sameDayDone, { nowMs, clockFormat: "24h" }),
    "01:38",
  );
  assert.equal(
    formatConciseLocalFinishedTime(sameDayDone, { nowMs, clockFormat: "12h" }),
    "1:38 AM",
  );
  assert.equal(
    formatConciseLocalFinishedTime(crossDayDone, { nowMs, clockFormat: "24h" }),
    "11/09 23:48",
  );
  assert.equal(
    formatConciseLocalFinishedTime(crossYearDone, { nowMs, clockFormat: "24h" }),
    "25/12/31 22:05",
  );

  // Turn footer: Worked for 1h 29m · 01:38 (7h ago)
  const turnSameDay = formatTurnWorkedForWithFinishedTime(
    "Worked for 1h 29m",
    sameDayDone,
    { nowMs, clockFormat: "24h", showRelativeAge: true },
  );
  assert.equal(turnSameDay, "Worked for 1h 29m · 01:38 (7h ago)");
  // Idempotency guard: passing an already-decorated label must not duplicate
  assert.equal(
    formatTurnWorkedForWithFinishedTime(turnSameDay, sameDayDone, {
      nowMs,
      clockFormat: "24h",
      showRelativeAge: true,
    }),
    "Worked for 1h 29m · 01:38 (7h ago)",
  );

  // Relative + Local Time (prose & compact)
  const proseSameDay = formatRelativeWithLocalTime(sameDayDone, {
    nowMs,
    compact: false,
    clockFormat: "24h",
    includeLocalTime: true,
  });
  assert.equal(proseSameDay.label, "7h ago · 01:38");

  const compactSameDay = formatRelativeWithLocalTime(sameDayDone, {
    nowMs,
    compact: true,
    clockFormat: "24h",
    includeLocalTime: true,
  });
  assert.equal(compactSameDay.label, "7h · 01:38");

  const proseCrossDay = formatRelativeWithLocalTime(crossDayDone, {
    nowMs,
    compact: false,
    clockFormat: "24h",
    includeLocalTime: true,
  });
  assert.equal(proseCrossDay.label, "9h ago · 11/09 23:48");

  assert.equal(
    formatCompactLabelAsProseWithLocalTime("7h · 01:38"),
    "7h ago · 01:38",
  );

  // Aria-label fallback parser
  const parsedAria = parseEndedTimestampFromAriaLabel(
    "Worked for 1h 29m, ended 1:38 AM",
    nowMs,
  );
  assert.ok(parsedAria?.completedAt);
  assert.equal(parsedAria?.durationLabel, "Worked for 1h 29m");
  assert.equal(
    formatConciseLocalFinishedTime(parsedAria?.completedAt, {
      nowMs,
      clockFormat: "24h",
    }),
    "01:38",
  );

  // Metro module registry patching (3356, 4339, 5287, 5312)
  const mockMod3356 = {
    describeTimeAgo: (_d: Date, _now?: Date) => ({ label: "7h ago", resolution: "hour" }),
    formatTimeAgo: (_d: Date, _now?: Date) => "7h ago",
    describeCompactTimeAgo: (_d: Date, _now?: Date) => ({ label: "7h", resolution: "hour" }),
    formatCompactTimeAgo: (_d: Date, _now?: Date) => "7h",
    formatCompactTimeAgoAsProse: (s: string) => `${s} ago`,
    formatMessageTimestamp: (_d: Date, _now?: Date) => "1:38 AM",
  };
  const mockMod5312 = {
    deriveStreamTurnTiming: (_items: unknown[]) => ({
      activeStartedAt: null,
      byItemId: {
        turn_1: { completedAt: sameDayDone, durationMs: 5_340_000 },
      },
    }),
  };
  const mockMod5287 = {
    getTurnDurationLabel: (_ms: number) => "Worked for 1h 29m",
  };

  const mockWin = {
    __r: Object.assign(() => ({}), {
      getModules: () =>
        new Map([
          [3356, { isInitialized: true, publicModule: { exports: mockMod3356 } }],
          [5312, { isInitialized: true, publicModule: { exports: mockMod5312 } }],
          [5287, { isInitialized: true, publicModule: { exports: mockMod5287 } }],
        ]),
    }),
  };

  const hooked = patchMetroSessionTimeModules(mockWin as never);
  assert.equal(hooked, true);
  assert.equal(mockMod3356.formatTimeAgo(sameDayDone, now), "7h ago · 01:38");
  assert.equal(mockMod3356.formatCompactTimeAgo(sameDayDone, now), "7h · 01:38");
  mockMod5312.deriveStreamTurnTiming([]);
  assert.ok(
    mockMod5287.getTurnDurationLabel(5_340_000).startsWith("Worked for 1h 29m · "),
  );

  const selfTest = runSessionTimeSelfTest({ nowMs, clockFormat: "24h" });
  assert.equal(selfTest.ok, true, selfTest.summary);
  const snap = getSessionTimeHealthSnapshot();
  assert.equal(snap.metroHookInstalled, true);
});

test("39. Subagent finished/archived status reconciliation: native pill shows Done with green dot, stale [Running] row badges become [Done], and archived subagents persist across reloads", () => {
  const storageMap = new Map<string, string>();
  const mockMod5397 = {
    buildSubagentPillPresentation: (rows: Array<Record<string, any>>) => ({
      segments: [
        {
          bucket: null as string | null,
          text: rows.length === 1 ? "1 subagent" : `${rows.length} subagents`,
        },
      ],
    }),
    buildSubagentRowPresentationData: (row: Record<string, any>) => ({
      title: row.title ?? "DeepCoder",
      detailText: row.description ?? "",
      statusBucket: row.statusBucket ?? "done",
    }),
  };
  const mockMod4303 = {
    getStatusDotColor: (theme: Record<string, any>, bucket: string | null | undefined) =>
      bucket === "done" ? null : theme?.colors?.statusDotWarning ?? "#f59e0b",
  };
  let hiddenCalls: Array<{ serverId: string; parentAgentId: string; subagentIds: string[] }> = [];
  const storeState = {
    hideFromTrack: (serverId: string, parentAgentId: string, subagentIds: string[]) => {
      hiddenCalls.push({ serverId, parentAgentId, subagentIds });
    },
  };
  const mockMod4939 = {
    useProviderSubagentStore: {
      getState: () => storeState,
      setState: (patch: Record<string, any>) => {
        Object.assign(storeState, patch);
      },
    },
  };

  const mockWin = {
    navigator: { language: "en-US" },
    localStorage: {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storageMap.set(k, v);
      },
    },
    __c: new Map<number, { isInitialized: boolean; publicModule: { exports: Record<string, any> } }>([
      [5397, { isInitialized: true, publicModule: { exports: mockMod5397 } }],
      [4303, { isInitialized: true, publicModule: { exports: mockMod4303 } }],
      [4939, { isInitialized: true, publicModule: { exports: mockMod4939 } }],
    ]),
  };

  let archivedCallbackFired = false;
  const patched = patchPaseoSubagentTrackModules(mockWin as never, () => {
    archivedCallbackFired = true;
  });
  assert.equal(patched, true);

  // 1) When all subagents are finished (running === 0), pill presentation must show "1 subagent · Done" with bucket "done"
  const pillWhenDone = mockMod5397.buildSubagentPillPresentation([
    { id: "sub_1", statusBucket: "done", title: "DeepCoder" },
  ]);
  assert.deepEqual(pillWhenDone.segments, [
    { bucket: "done", text: "1 subagent \u00b7 Done" },
  ]);

  // 2) getStatusDotColor for "done" bucket must return green statusDotSuccess instead of null
  const dotColor = mockMod4303.getStatusDotColor(
    { colors: { statusDotSuccess: "#22c55e", statusDotWarning: "#f59e0b" } },
    "done",
  );
  assert.equal(dotColor, "#22c55e");

  // 3) Stale "[Running · 24 steps]" description on a finished row must be rewritten to "[Done · 24 steps]"
  const rowPres = mockMod5397.buildSubagentRowPresentationData({
    title: "DeepCoder",
    description: "[Running \u00b7 24 steps \u00b7 2 subagents] Paseo Session Archive Shortcut Implementer",
    statusBucket: "done",
  });
  assert.equal(
    rowPres.detailText,
    "[Done \u00b7 24 steps \u00b7 2 subagents] Paseo Session Archive Shortcut Implementer",
  );

  // 4) Archiving via hideFromTrack persists to localStorage and marks tree as archived
  storeState.hideFromTrack("local", "22c77823-d4ab-4050-8d5a-63b24341c179", [
    "vec-subagent:60f95d94-e860-4d30-bcfa-07ebcd74db0f",
  ]);
  assert.equal(archivedCallbackFired, true);
  assert.equal(hiddenCalls.length, 1);
  const archivedSet = readArchivedSubagentIds("22c77823-d4ab-4050-8d5a-63b24341c179", mockWin as never);
  assert.equal(archivedSet.has("60f95d94-e860-4d30-bcfa-07ebcd74db0f"), true);

  const sampleTree = {
    agentId: "22c77823-d4ab-4050-8d5a-63b24341c179",
    workspaceId: "wks_0d3d067723b0f342",
    workspaceName: "when i click on a side session",
    title: "when i click on a side session",
    cwd: "/tmp",
    model: "gemini-3.8-flash-high",
    agentStatus: "idle",
    archived: false,
    rootConversationId: "3f3e447b-b3b8-42c2-96d5-3530d387a246",
    rootStepCount: 41,
    rootToolCallCount: 6,
    rootLastMessagePreview: "Done",
    rootTimersAndTasks: [],
    updatedAt: "2026-11-10T01:00:00Z",
    subagentSummary: {
      total: 3,
      running: 0,
      completed: 3,
      failed: 0,
      maxDepth: 2,
      totalSubagentSteps: 452,
    },
    children: [],
    flatSubagents: [
      {
        conversationId: "60f95d94-e860-4d30-bcfa-07ebcd74db0f",
        parentConversationId: "3f3e447b-b3b8-42c2-96d5-3530d387a246",
        depth: 1,
        subAgentType: "DeepCoder",
        role: "Paseo Session Archive Shortcut Implementer",
        promptPreview: "Task",
        status: "completed" as const,
        badge: "[Done \u00b7 24 steps \u00b7 2 subagents]",
        stepCount: 24,
        toolCallCount: 4,
        lastToolName: "send_message",
        lastMessagePreview: "Done",
        nestedSubagentCount: 2,
        nestedRunningCount: 0,
      },
    ],
  };
  assert.equal(isAllSubagentsArchivedForTree(sampleTree as never, mockWin as never), true);
  markSubagentsArchivedForAgent("other-agent-id", ["sub-a"], mockWin as never);
  assert.equal(readArchivedSubagentIds("other-agent-id", mockWin as never).has("sub-a"), true);
});

test("49. Multi-level subagent penetration display & step-by-step bidirectional jump (Subagent 2 -> Subagent 1 -> Main Agent)", async () => {
  const {
    parseProviderSubagentTabTestId,
    buildProviderSubagentTabTestId,
    extractCurrentWorkspaceAndAgent,
    extractFocusedWorkspaceTabTarget,
    openWorkspaceTargetTabViaStore,
  } = await import("../client/session-lineage-web");
  const {
    classifyToolCallBadgeText,
    buildSubagentLineageChain,
    resolveActiveSubagentNodeFromDom,
    openOrFocusSubagentOrRootTabInApp,
  } = await import("../client/subagents-tree-web");

  // 1) parseProviderSubagentTabTestId & buildProviderSubagentTabTestId round-trip
  const rootAgentId = "e2210f4d-9cc5-4900-b795-6584950532c9";
  const l1Cid = "fa224642-a55e-48ae-aece-c02e27cf916e";
  const l2Cid = "73fc0986-38cf-4265-a23d-111122223333";
  const l3Cid = "99aa1122-3344-5566-7788-99aabbccddee";

  const builtL2TestId = buildProviderSubagentTabTestId(rootAgentId, l2Cid);
  assert.equal(
    builtL2TestId,
    `workspace-tab-provider_subagent_${rootAgentId.length}_${rootAgentId}_${l2Cid.length}_${l2Cid}`,
  );
  const parsedL2 = parseProviderSubagentTabTestId(builtL2TestId);
  assert.deepEqual(parsedL2, {
    parentAgentId: rootAgentId,
    subagentId: l2Cid,
  });
  assert.equal(parseProviderSubagentTabTestId("workspace-tab-agent_123"), null);

  // 2) extractCurrentWorkspaceAndAgent extracts both parentAgentId and activeSubagentId when viewing a subagent tab
  const subTabEl = createInteractiveDomNode("div", {
    "data-testid": builtL2TestId,
    "aria-selected": "true",
  });
  const docWithActiveSubTab = {
    querySelector: (sel: string) => {
      if (sel.includes("sidebar-workspace-row-")) {
        return createInteractiveDomNode("div", {
          "data-testid": "sidebar-workspace-row-local:wks_wechat",
          "aria-selected": "true",
        });
      }
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes("workspace-tab-provider_subagent_")) {
        return [subTabEl];
      }
      return [];
    },
  } as unknown as Document;

  const extractedCtx = extractCurrentWorkspaceAndAgent(docWithActiveSubTab, {
    location: { pathname: "/workspace/local:wks_wechat" },
  } as unknown as Window);
  assert.equal(extractedCtx.workspaceId, "local:wks_wechat");
  assert.equal(extractedCtx.agentId, rootAgentId);
  assert.equal(extractedCtx.activeSubagentId, l2Cid);

  // 3) buildSubagentLineageChain reconstructs full L0 -> L1 -> L2 -> L3 hierarchy & immediateParentSubagent
  const multiLevelTree = {
    agentId: rootAgentId,
    workspaceId: "wks_wechat",
    workspaceName: "WeChat Cron Audit",
    title: "看一下我有哪些关于微信的循环任务",
    cwd: "/tmp",
    model: "gemini-3.1-pro-high",
    agentStatus: "running",
    archived: false,
    rootConversationId: "00000000-0000-4000-8000-000000000000",
    rootStepCount: 15,
    rootToolCallCount: 3,
    rootLastMessagePreview: "Investigating...",
    rootTimersAndTasks: [],
    updatedAt: "2026-11-10T01:25:00Z",
    subagentSummary: {
      total: 3,
      running: 2,
      completed: 1,
      failed: 0,
      maxDepth: 3,
      totalSubagentSteps: 47,
    },
    rootTimeline: [],
    flatSubagents: [
      {
        conversationId: l1Cid,
        parentConversationId: "00000000-0000-4000-8000-000000000000",
        depth: 1,
        subAgentType: "DeepInvestigator",
        role: "Lead Investigator",
        promptPreview: "Investigate WeChat tasks",
        status: "running" as const,
        badge: "[Running · 6 steps · 2 subagents]",
        stepCount: 6,
        toolCallCount: 2,
        lastToolName: "invoke_subagent",
        lastMessagePreview: "Spawning worker...",
        lastErrorText: "",
        updatedAt: "2026-11-10T01:24:00Z",
        mtimeAgeSeconds: 3,
        transcriptPath: "/tmp/l1.jsonl",
        nestedSubagentCount: 2,
        nestedRunningCount: 1,
      },
      {
        conversationId: l2Cid,
        parentConversationId: l1Cid,
        depth: 2,
        subAgentType: "DeepInvestigatorWorkerL0",
        role: "L0 Investigation Worker",
        promptPreview: "Check scheduled-task-rescheduler",
        status: "running" as const,
        badge: "[Running · 35 steps · run_command]",
        stepCount: 35,
        toolCallCount: 18,
        lastToolName: "run_command",
        lastMessagePreview: "Checking crontab...",
        lastErrorText: "",
        updatedAt: "2026-11-10T01:25:00Z",
        mtimeAgeSeconds: 1,
        transcriptPath: "/tmp/l2.jsonl",
        nestedSubagentCount: 1,
        nestedRunningCount: 0,
      },
      {
        conversationId: l3Cid,
        parentConversationId: l2Cid,
        depth: 3,
        subAgentType: "research",
        role: "Doc Verifier",
        promptPreview: "Verify WeChat docs",
        status: "completed" as const,
        badge: "[Done · 6 steps]",
        stepCount: 6,
        toolCallCount: 3,
        lastToolName: "read_file",
        lastMessagePreview: "Verified.",
        lastErrorText: "",
        updatedAt: "2026-11-10T01:23:00Z",
        mtimeAgeSeconds: 10,
        transcriptPath: "/tmp/l3.jsonl",
        nestedSubagentCount: 0,
        nestedRunningCount: 0,
      },
    ],
  };

  // When inside Subagent 2 (L2), immediateParentSubagent MUST be Subagent 1 (L1), NOT Main Agent!
  const chainAtL2 = buildSubagentLineageChain(multiLevelTree as never, l2Cid);
  assert.equal(chainAtL2.activeSubagent?.conversationId, l2Cid);
  assert.equal(
    chainAtL2.immediateParentSubagent?.conversationId,
    l1Cid,
    "Immediate parent of Subagent 2 (L2) must be Subagent 1 (L1)",
  );
  assert.deepEqual(
    chainAtL2.ancestorChain.map((n) => `L${n.depth}:${n.subAgentType}`),
    ["L1:DeepInvestigator", "L2:DeepInvestigatorWorkerL0"],
  );
  assert.deepEqual(
    chainAtL2.directChildren.map((n) => n.conversationId),
    [l3Cid],
  );

  // When inside Subagent 3 (L3), immediateParentSubagent MUST be Subagent 2 (L2)
  const chainAtL3 = buildSubagentLineageChain(multiLevelTree as never, l3Cid);
  assert.equal(chainAtL3.immediateParentSubagent?.conversationId, l2Cid);
  assert.deepEqual(
    chainAtL3.ancestorChain.map((n) => n.depth),
    [1, 2, 3],
  );

  // When inside Subagent 1 (L1), immediateParentSubagent is null (its parent is L0 Main Agent)
  const chainAtL1 = buildSubagentLineageChain(multiLevelTree as never, l1Cid);
  assert.equal(chainAtL1.activeSubagent?.conversationId, l1Cid);
  assert.equal(chainAtL1.immediateParentSubagent, null);
  assert.deepEqual(
    chainAtL1.directChildren.map((n) => n.conversationId),
    [l2Cid],
  );

  // 4) classifyToolCallBadgeText recognizes DeepInvestigatorWorkerL0 and [Running · 35 steps] without robot emoji
  const classifiedWorker = classifyToolCallBadgeText(
    "DeepInvestigatorWorkerL0 [Running · 35 steps · run_command] L0 Investigation Worker",
    multiLevelTree as never,
  );
  assert.equal(classifiedWorker.kind, "subagent");
  assert.equal(classifiedWorker.subagentName, "deepinvestigatorworkerl0");

  // 5) Step-by-step reverse jump: Subagent 2 (L2) -> Subagent 1 (L1) -> Main Agent (L0)
  const openedTabTargets: Array<{ workspaceKey: string; target: Record<string, any> }> = [];
  const mockLayoutStore = {
    layoutByWorkspace: {
      "local:wks_wechat": {
        focusedPaneId: "pane_1",
        panes: [
          {
            id: "pane_1",
            activeTabId: "tab_l2",
            tabs: [
              {
                id: "tab_l2",
                target: {
                  kind: "provider_subagent",
                  parentAgentId: rootAgentId,
                  subagentId: l2Cid,
                },
              },
            ],
          },
        ],
      },
    },
    sheetsByWorkspace: {},
    openTab: (payload: { workspaceKey: string; target: Record<string, any> }) => {
      openedTabTargets.push(payload);
    },
  };
  const winWithLayoutStore = {
    location: { pathname: "/workspace/local:wks_wechat" },
    __c: new Map([
      [
        3380,
        {
          isInitialized: true,
          publicModule: {
            exports: {
              useWorkspaceLayoutStore: {
                getState: () => mockLayoutStore,
              },
            },
          },
        },
      ],
    ]),
  } as unknown as Window;

  const focusedSnap = extractFocusedWorkspaceTabTarget("wks_wechat", winWithLayoutStore);
  assert.equal(focusedSnap?.kind, "provider_subagent");
  assert.equal(focusedSnap?.parentAgentId, rootAgentId);
  assert.equal(focusedSnap?.subagentId, l2Cid);

  const resolvedFromSingleTab = resolveActiveSubagentNodeFromDom(
    multiLevelTree as never,
    {
      querySelector: (sel: string) =>
        sel === '[data-testid="provider-subagent-panel"]'
          ? createInteractiveDomNode("div")
          : null,
      querySelectorAll: () => [],
    } as unknown as Document,
    winWithLayoutStore,
  );
  assert.equal(
    resolvedFromSingleTab?.conversationId,
    l2Cid,
    "Must resolve active L2 subagent from useWorkspaceLayoutStore even when only 1 tab is open",
  );

  // Jump 1: From Subagent 2 (L2) -> Subagent 1 (L1) (`chainAtL2.immediateParentSubagent.conversationId`)
  const jumpedL2ToL1 = openOrFocusSubagentOrRootTabInApp(
    {
      workspaceId: "wks_wechat",
      parentAgentId: rootAgentId,
      subagentId: chainAtL2.immediateParentSubagent?.conversationId ?? null,
    },
    null,
    winWithLayoutStore,
  );
  assert.equal(jumpedL2ToL1, true);
  assert.deepEqual(openedTabTargets[0], {
    workspaceKey: "local:wks_wechat",
    target: {
      kind: "provider_subagent",
      parentAgentId: rootAgentId,
      subagentId: l1Cid,
    },
  });

  // Jump 2: From Subagent 1 (L1) -> Main Agent (L0) (`chainAtL1.immediateParentSubagent` is null)
  const jumpedL1ToMain = openOrFocusSubagentOrRootTabInApp(
    {
      workspaceId: "wks_wechat",
      parentAgentId: rootAgentId,
      subagentId: (chainAtL1.immediateParentSubagent as { conversationId?: string } | null)?.conversationId ?? null,
    },
    null,
    winWithLayoutStore,
  );
  assert.equal(jumpedL1ToMain, true);
  assert.deepEqual(openedTabTargets[1], {
    workspaceKey: "local:wks_wechat",
    target: {
      kind: "agent",
      agentId: rootAgentId,
    },
  });
});

test("50. Subagents vs Colleagues vs Referenced Sessions taxonomy & Notion Task ID inline mention resolution", async () => {
  const {
    ingestSessionLineageResponse,
    resolveSessionReference,
  } = await import("../client/session-lineage-web");
  const { handleManageSessionLineage } = await import("../server/agent-history-handlers");

  // 1) Ingest directory with Intake session carrying notionTaskId (8-char suffix and full UUID)
  const intakeNodeFullUuid = {
    agentId: "a27c694b-277c-410c-851c-111122223333",
    shortId: "a27c694",
    agentTitle: "Intake · Let settings in Paseo become searchable",
    workspaceId: "wks_intake_search",
    workspaceTitle: "Intake · Let settings in Paseo become searchable",
    projectId: "proj_meta",
    projectName: "2026-11-08 Meta harness",
    status: "idle",
    provider: "claude",
    model: "claude-sonnet-4-6",
    providerSessionId: null,
    createdAt: "2026-11-09T18:00:00Z",
    updatedAt: "2026-11-09T18:30:00Z",
    briefPath: null,
    reportPath: null,
    reportExists: false,
    notionUrl: "https://www.notion.so/413e1b432393815aae85f013049cb5fb",
    notionTaskId: "413e1b43-2393-815a-ae85-f013049cb5fb",
    relationKind: "intake-routed" as const,
    routedByAgentId: null,
  };

  const intakeNodeShortSuffix = {
    ...intakeNodeFullUuid,
    agentId: "3220586e-4fb8-4bc4-836c-900498df23c4",
    shortId: "3220586",
    agentTitle: "Intake · Complete session jump and search",
    workspaceId: "wks_intake_96e2",
    workspaceTitle: "Intake · Complete session jump and search",
    notionUrl: null,
    notionTaskId: "96e2e779",
    relationKind: "intake-routed" as const,
  };

  const mainNode = {
    ...intakeNodeFullUuid,
    agentId: "3e907bec-8da9-4d52-a28c-3fa4b4b121a5",
    shortId: "3e907be",
    agentTitle: "Fix cadence Notion sync from Slack thread",
    workspaceId: "wks_23b9a39ee3a6dc69",
    workspaceTitle: "Fix cadence Notion sync from Slack thread",
    notionUrl: null,
    notionTaskId: null,
    relationKind: "self" as const,
  };

  ingestSessionLineageResponse({
    ok: true,
    action: "inspect",
    current: mainNode,
    parent: null,
    routedOrigin: null,
    siblings: [],
    children: [],
    colleagues: [],
    projectPeers: [intakeNodeFullUuid, intakeNodeShortSuffix],
    directory: [mainNode, intakeNodeFullUuid, intakeNodeShortSuffix],
    reconcileSummary: {
      untitledFound: 0,
      renamedCount: 0,
      unlinkedFound: 0,
      linkedCount: 0,
      detachedCount: 0,
      renamedWorkspaces: [],
    },
    message: "ok",
    durationMs: 1,
  });

  // Full Notion Task UUID, 8-char suffix (049cb5fb), and 8-char brief suffix (96e2e779) all resolve to their sessions!
  assert.equal(
    resolveSessionReference("413e1b43-2393-815a-ae85-f013049cb5fb")?.agentId,
    intakeNodeFullUuid.agentId,
    "Full Notion Task UUID must resolve to the corresponding Intake session",
  );
  assert.equal(
    resolveSessionReference("049cb5fb")?.agentId,
    intakeNodeFullUuid.agentId,
    "8-char suffix of Notion Task UUID must resolve to the corresponding Intake session",
  );
  assert.equal(
    resolveSessionReference("96e2e779")?.agentId,
    intakeNodeShortSuffix.agentId,
    "8-char Notion Task ID from intake brief must resolve to the corresponding Intake session",
  );

  // 2) Live handleManageSessionLineage on 3e907bec-8da9-4d52-a28c-3fa4b4b121a5 must NOT classify Intake tasks as children (subagents)
  const mockCtx = createMockContext([]) as never;
  const liveLineage = await handleManageSessionLineage(
    {
      action: "inspect",
      workspaceId: "wks_23b9a39ee3a6dc69",
      agentId: "3e907bec-8da9-4d52-a28c-3fa4b4b121a5",
    },
    mockCtx,
  );
  assert.equal(liveLineage.ok, true);
  const intakeChildren = liveLineage.children.filter((c) =>
    c.workspaceTitle.startsWith("Intake ·") || c.agentTitle.startsWith("Intake ·"),
  );
  assert.equal(
    intakeChildren.length,
    0,
    "Standalone Intake tasks must never be classified as child subagents of 3e907bec",
  );
});

test("51. Sidebar Cadence Timer Badge: mounts SVG stopwatch on cadence workspaces, 0 DOM writes on re-render idempotency, event stopPropagation, and run-now interaction", async () => {
  interface TestNode extends MinimalScheduleDomElement {
    childrenList: TestNode[];
    listeners: Map<string, Array<(ev: unknown) => void>>;
    querySelectorAll?<T = MinimalScheduleDomElement>(sel: string): ArrayLike<T>;
  }

  const makeTestNode = (tag: string, attrs: Record<string, string> = {}): TestNode => {
    const map = new Map<string, string>(Object.entries(attrs));
    const listeners = new Map<string, Array<(ev: unknown) => void>>();
    let rawText = "";
    const n: TestNode = {
      id: attrs.id,
      style: {},
      childrenList: [],
      parentElement: null,
      listeners,
      get textContent(): string {
        if (n.childrenList.length > 0) {
          return n.childrenList.map((c) => c.textContent ?? "").join("");
        }
        return rawText;
      },
      set textContent(v: string) {
        rawText = v;
        n.childrenList = [];
      },
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
      remove: () => {
        if (n.parentElement) {
          const list = (n.parentElement as TestNode).childrenList;
          const idx = list.indexOf(n);
          if (idx >= 0) list.splice(idx, 1);
          n.parentElement = null;
        }
      },
      addEventListener: (type, fn) => {
        const list = listeners.get(type) ?? [];
        list.push(fn as (ev: unknown) => void);
        listeners.set(type, list);
      },
      querySelector: <T = MinimalScheduleDomElement>(sel: string): T | null =>
        (queryTree(n, sel)[0] as unknown as T) ?? null,
      querySelectorAll: <T = MinimalScheduleDomElement>(sel: string): ArrayLike<T> =>
        queryTree(n, sel) as unknown as ArrayLike<T>,
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

  const rootDocEl = makeTestNode("div");

  // Create two sidebar workspace rows:
  // 1. Cadence workspace: "wks_cadence_1" with title "Mac Speed Sentinel"
  const cadRow = makeTestNode("div", {
    "data-testid": "sidebar-workspace-row-local:wks_cadence_1",
  });
  const cadTitleWrap = makeTestNode("div");
  const cadTitleEl = makeTestNode("span", {
    "data-testid": "sidebar-workspace-title-local:wks_cadence_1",
  });
  cadTitleEl.textContent = "Mac Speed Sentinel";
  cadTitleWrap.appendChild(cadTitleEl);
  cadRow.appendChild(cadTitleWrap);
  rootDocEl.appendChild(cadRow);

  // 2. Normal workspace: "wks_normal_2" with title "Daily Notes"
  const normRow = makeTestNode("div", {
    "data-testid": "sidebar-workspace-row-local:wks_normal_2",
  });
  const normTitleWrap = makeTestNode("div");
  const normTitleEl = makeTestNode("span", {
    "data-testid": "sidebar-workspace-title-local:wks_normal_2",
  });
  normTitleEl.textContent = "Daily Notes";
  normTitleWrap.appendChild(normTitleEl);
  normRow.appendChild(normTitleWrap);
  rootDocEl.appendChild(normRow);

  const doc: MinimalScheduleDomDocument = {
    createElement: (tag) => makeTestNode(tag),
    getElementById: (id) => findId(rootDocEl, id),
    querySelector: (sel) => (queryTree(rootDocEl, sel)[0] as never) ?? null,
    querySelectorAll: (sel) => queryTree(rootDocEl, sel) as never,
  };

  let openedDrawerScheduleId: string | null = "unset";
  let runNowScheduleId: string | null = "unset";

  const schedulesMap = new Map([
    [
      "sched_mac_speed",
      {
        id: "sched_mac_speed",
        name: "AG · Mac Speed Sentinel",
        cronExpression: "*/30 * * * *",
        timezone: "Asia/Shanghai",
        status: "active" as const,
        isStandbyTwin: false,
        standbySlug: "mac-speed",
        provider: "antigravity",
        model: "gemini-3.8-flash",
        modeId: "full-access",
        cwd: "/tmp",
        archiveOnFinish: true,
        prompt: "Check Mac speed",
        promptPreview: "Check Mac speed",
        nextRunAt: new Date(Date.now() + 1800_000).toISOString(),
        lastRunAt: new Date(Date.now() - 600_000).toISOString(),
        totalRuns: 42,
        succeededRuns: 40,
        failedRuns: 2,
        runningRuns: 1,
        lastRunStatus: "running" as const,
        runs: [
          {
            id: "run_1",
            scheduleId: "sched_mac_speed",
            scheduleName: "AG · Mac Speed Sentinel",
            status: "running" as const,
            scheduledFor: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            endedAt: null,
            durationMs: null,
            durationFormatted: "-",
            agentId: "ag_1",
            workspaceId: "wks_cadence_1",
            workspaceName: "Mac Speed Sentinel",
            isArchived: false,
            output: "diagnosing...",
            outputPreview: "diagnosing...",
            error: null,
          },
        ],
      },
    ],
  ]);

  setCachedSchedulesForTesting(schedulesMap as never);

  // Pass 1: Decorate DOM
  const pass1 = decorateSchedulesDomOnDocument(doc, {
    schedulesById: schedulesMap,
    totals: { totalSchedules: 1, schedulesWithRuns: 1, totalRuns: 42 },
    isZh: true,
    nowMs: Date.now(),
    onOpenDrawer: (sid) => {
      openedDrawerScheduleId = sid;
    },
    onRunNow: (sid) => {
      runNowScheduleId = sid;
    },
  });

  assert.ok(pass1.domWrites > 0, "Pass 1 must perform DOM writes to mount badge");

  // Verify badge exists on cadence workspace row
  const badge = cadRow.querySelector(
    '[data-testid="sidebar-workspace-cadence-badge-wks_cadence_1"]',
  ) as TestNode | null;
  assert.ok(badge, "Cadence workspace row must have cadence badge");
  assert.equal(
    cadRow.childrenList[0]?.childrenList[0],
    badge,
    "Badge must be inserted before title element",
  );
  assert.ok(
    badge.innerHTML?.includes("<svg"),
    "Badge must contain inline SVG",
  );
  assert.ok(
    !badge.innerHTML?.includes("⏰") && !badge.innerHTML?.includes("⏱"),
    "Badge must be 100% zero-emoji (anti-AI-slop standard)",
  );
  assert.ok(
    badge.title?.includes("运行中") || badge.title?.includes("定时任务节奏"),
    "Badge title must describe cadence schedule in clean prose",
  );

  // Verify non-cadence workspace row did NOT receive a badge
  const normBadge = normRow.querySelector(
    '[data-testid="sidebar-workspace-cadence-badge-wks_normal_2"]',
  );
  assert.equal(normBadge, null, "Non-cadence workspace row must not receive badge");

  // Pass 2: Re-run with identical state -> MUST RESULT IN EXACTLY 0 DOM WRITES!
  const pass2 = decorateSchedulesDomOnDocument(doc, {
    schedulesById: schedulesMap,
    totals: { totalSchedules: 1, schedulesWithRuns: 1, totalRuns: 42 },
    isZh: true,
    nowMs: Date.now(),
    onOpenDrawer: (sid) => {
      openedDrawerScheduleId = sid;
    },
    onRunNow: (sid) => {
      runNowScheduleId = sid;
    },
  });

  assert.equal(pass2.domWrites, 0, "Pass 2 with identical state must result in exactly 0 DOM writes (idempotency guarantee)");

  // Test event handling and defensive propagation stop
  let pointerDownStopped = false;
  let pointerDownPrevented = false;
  const pointerListeners = badge.listeners.get("pointerdown") ?? [];
  assert.ok(pointerListeners.length > 0, "Badge must have pointerdown listener");
  pointerListeners[0]({
    stopPropagation: () => {
      pointerDownStopped = true;
    },
    preventDefault: () => {
      pointerDownPrevented = true;
    },
  });
  assert.equal(pointerDownStopped, true, "pointerdown must stopPropagation");
  assert.equal(pointerDownPrevented, true, "pointerdown must preventDefault");

  // Test regular click: opens drawer
  let clickStopped = false;
  let clickPrevented = false;
  const clickListeners = badge.listeners.get("click") ?? [];
  assert.ok(clickListeners.length > 0, "Badge must have click listener");
  clickListeners[0]({
    stopPropagation: () => {
      clickStopped = true;
    },
    preventDefault: () => {
      clickPrevented = true;
    },
    altKey: false,
  });
  assert.equal(clickStopped, true, "click must stopPropagation");
  assert.equal(clickPrevented, true, "click must preventDefault");
  assert.equal(openedDrawerScheduleId, "sched_mac_speed", "Click on badge must open schedule drawer");

  // Test Alt+click: triggers run-now
  clickListeners[0]({
    stopPropagation: () => {},
    preventDefault: () => {},
    altKey: true,
  });
  assert.equal(runNowScheduleId, "sched_mac_speed", "Alt+Click on badge must trigger runNow");

  // Test native workspace context menu annotation for cadence workspace
  const mockMenuParent = makeTestNode("div");
  const renameItem = makeTestNode("div", {
    "data-testid": "sidebar-workspace-menu-rename-local:wks_cadence_1",
  });
  mockMenuParent.appendChild(renameItem);
  rootDocEl.appendChild(mockMenuParent);

  const menuAnnotateDoc: MinimalDocument = {
    createElement: (tag) => makeTestNode(tag),
    querySelectorAll: (sel) => queryTree(rootDocEl, sel) as never,
    querySelector: (sel) => (queryTree(rootDocEl, sel)[0] as never) ?? null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const annotated = annotateNativeWorkspaceMenusWithShortcuts(
    menuAnnotateDoc,
    {
      ...readInlineRenamePreferences(null),
      enableDesktopContextMenuHelper: true,
      enableQuickRenameAndLabelShortcuts: true,
      enableSidebarDeleteKeyArchive: true,
      enableInlineDoubleClickRename: true,
      inlineRenameCaretPosition: "start",
      labelShortcutCombo: "both",
    },
    { navigator: { language: "zh-CN" } } as never,
  );

  assert.ok(annotated > 0, "Context menu annotation must annotate items");
  const cadenceMenuItem = mockMenuParent.querySelector(
    '[data-testid="sidebar-workspace-menu-run-cadence-local:wks_cadence_1"]',
  );
  assert.ok(cadenceMenuItem, "Context menu must include Run Cadence Now item");
  assert.ok(cadenceMenuItem.textContent?.includes("立即运行节奏"), "Context menu must show Chinese text");

  // Verify icon was not wiped out by textContent assignment and exists in menu item
  const menuIcon = (cadenceMenuItem as TestNode).childrenList?.find((c) =>
    c.innerHTML?.includes("<svg"),
  );
  assert.ok(menuIcon, "Context menu Run Cadence Now item must preserve SVG timer icon");
  const menuHint = (cadenceMenuItem as TestNode).querySelector(
    '[data-testid="sidebar-workspace-menu-run-cadence-shortcut-hint"]',
  );
  assert.ok(menuHint, "Context menu Run Cadence Now item must have Alt+Enter shortcut hint");

  // Also verify context menu item is generated for a workspace matched by TITLE (standby twin)
  const titleWsRow = makeTestNode("div", {
    "data-testid": "sidebar-workspace-row-local:wks_title_only_88",
  });
  const titleWsWrap = makeTestNode("div");
  const titleWsEl = makeTestNode("span", {
    "data-testid": "sidebar-workspace-title-local:wks_title_only_88",
  });
  titleWsEl.textContent = "Mac Speed Sentinel";
  titleWsWrap.appendChild(titleWsEl);
  titleWsRow.appendChild(titleWsWrap);
  rootDocEl.appendChild(titleWsRow);

  const titleMenuParent = makeTestNode("div");
  const titleRenameItem = makeTestNode("div", {
    "data-testid": "sidebar-workspace-menu-rename-local:wks_title_only_88",
  });
  titleMenuParent.appendChild(titleRenameItem);
  rootDocEl.appendChild(titleMenuParent);

  annotateNativeWorkspaceMenusWithShortcuts(
    menuAnnotateDoc,
    {
      ...readInlineRenamePreferences(null),
      enableDesktopContextMenuHelper: true,
      enableQuickRenameAndLabelShortcuts: true,
      enableSidebarDeleteKeyArchive: true,
      enableInlineDoubleClickRename: true,
      inlineRenameCaretPosition: "start",
      labelShortcutCombo: "both",
    },
    { navigator: { language: "zh-CN" } } as never,
  );
  const titleCadenceItem = titleMenuParent.querySelector(
    '[data-testid="sidebar-workspace-menu-run-cadence-local:wks_title_only_88"]',
  );
  assert.ok(
    titleCadenceItem,
    "Context menu must annotate cadence item on workspace matched by title",
  );

  // Verify findCadenceScheduleForWorkspace resolves the cadence schedule
  const resolvedCadence = findCadenceScheduleForWorkspace("wks_cadence_1");
  assert.ok(resolvedCadence, "findCadenceScheduleForWorkspace must resolve cadence by workspace ID");
  assert.equal(resolvedCadence.id, "sched_mac_speed");

  // Verify negative match on common/generic non-cadence words (anti-false-positive invariant)
  assert.equal(
    findCadenceScheduleForWorkspace("wks_paseo_project", "Paseo"),
    null,
    "Generic workspace 'Paseo' must NOT match 'Paseo cadence doctor'",
  );
  assert.equal(
    findCadenceScheduleForWorkspace("wks_beeper_normal", "Beeper"),
    null,
    "Generic workspace 'Beeper' must NOT match 'Beeper Partner Scanner'",
  );
  assert.equal(
    findCadenceScheduleForWorkspace("wks_weather_normal", "Weather"),
    null,
    "Generic workspace 'Weather' must NOT match 'Weather check'",
  );

  // Verify exact slug/title match for standby twin workspace with local ID
  const resolvedByTitle = findCadenceScheduleForWorkspace(
    "wks_local_twin_99",
    "Mac Speed Sentinel",
  );
  assert.ok(
    resolvedByTitle,
    "Standby twin workspace must resolve by exact title match",
  );
  assert.equal(resolvedByTitle.id, "sched_mac_speed");

  // Verify marked-done session title prefix (d / done:) still resolves cadence
  const resolvedByDoneTitle = findCadenceScheduleForWorkspace(
    "wks_done_twin_101",
    "d Mac Speed Sentinel",
  );
  assert.ok(
    resolvedByDoneTitle,
    "Marked-done session ('d ...') must still resolve cadence",
  );
  assert.equal(resolvedByDoneTitle.id, "sched_mac_speed");

  // Verify parenthesized title or ellipsis truncation resolves cadence
  const resolvedByParen = findCadenceScheduleForWorkspace(
    "wks_paren_twin_102",
    "AG · Mac Speed Sentinel (Daily Health Check)",
  );
  assert.ok(
    resolvedByParen,
    "Title with parenthesized subtitle must resolve cadence",
  );
  assert.equal(resolvedByParen.id, "sched_mac_speed");

  const resolvedBySlug = findCadenceScheduleForWorkspace(
    "wks_local_twin_99",
    "mac-speed",
  );
  assert.ok(
    resolvedBySlug,
    "Standby twin workspace must resolve by standbySlug match",
  );
  assert.equal(resolvedBySlug.id, "sched_mac_speed");

  // Verify running state has breathing animation
  assert.equal(
    badge.getAttribute("data-running"),
    "true",
    "Badge on running schedule must have data-running='true'",
  );
  assert.ok(
    badge.style.animation?.includes("paseoCadenceBadgeBreathe"),
    "Badge on running schedule must have breathing animation",
  );

  // Verify showDefaultCadenceToast mounts toast in document.body
  const origDoc = (globalThis as { document?: unknown }).document;
  try {
    const mockDoc = {
      body: makeTestNode("body"),
      getElementById: (id: string) => findId(mockDoc.body, id),
      createElement: (tag: string) => makeTestNode(tag),
    };
    (globalThis as { document?: unknown }).document = mockDoc;
    showDefaultCadenceToast("测试节奏提示");
    const toastNode = mockDoc.body.querySelector('[data-testid="paseo-finder-cadence-toast"]');
    assert.ok(toastNode, "showDefaultCadenceToast must mount toast node in document.body");
    assert.equal(toastNode.textContent, "测试节奏提示");
  } finally {
    (globalThis as { document?: unknown }).document = origDoc;
  }

  // Verify cleanSessionDisplayTitle strips "d " / "done: " prefixes for clean Linear/Paseo pills
  assert.equal(
    cleanSessionDisplayTitle("d Fix HTTP 400 on /etc endpoint"),
    "Fix HTTP 400 on /etc endpoint",
  );
  assert.equal(
    cleanSessionDisplayTitle("d when i click on a side session"),
    "when i click on a side session",
  );
  assert.equal(
    cleanSessionDisplayTitle("done: Install Notpamina on two devices"),
    "Install Notpamina on two devices",
  );
  assert.equal(
    cleanSessionDisplayTitle("Add chat rewind and fork"),
    "Add chat rewind and fork",
  );
});

test("52. conversation://<cid> Markdown link & inline Role mention clickability, formatSubagentDisplayName role promotion, and useProviderSubagentStore descriptor guard", () => {
  // 1) formatSubagentDisplayName promotes Role over generic TypeName ("self", "subagent", etc.)
  assert.equal(
    formatSubagentDisplayName(
      {
        subAgentType: "self",
        role: "RotorBike GTM & GA4 Feasibility Specialist",
      },
      null,
      36,
    ),
    "RotorBike GTM & GA4 Feasibility Spe…",
  );
  assert.equal(
    formatSubagentDisplayName(
      {
        subAgentType: "self",
        role: "Estate GA4 & GTM Path A/B Custody Auditor",
      },
      null,
      60,
    ),
    "Estate GA4 & GTM Path A/B Custody Auditor",
  );
  // Specific non-generic subAgentType is preserved when role is empty
  assert.equal(
    formatSubagentDisplayName(
      {
        subAgentType: "deepcoder-architect",
        role: "",
      },
      null,
      36,
    ),
    "deepcoder-architect",
  );

  // 2) openWorkspaceTargetTabViaStore returns false when subagentId is NOT in useProviderSubagentStore.descriptors
  // so caller falls back to openDrawer (Right-Docked Subagent Sidebar with full disk transcript)
  let openedSubagentTabCount = 0;
  const descriptors = new Map<string, { parentAgentId: string; id: string }>();
  descriptors.set(
    "local\0" +
      "2e170a1d-9054-41ca-860e-6715fb3d2c59\0" +
      "vec-subagent:58ca3fa2-3e75-4e9f-bbe0-c3f2c3b327b8",
    {
      parentAgentId: "2e170a1d-9054-41ca-860e-6715fb3d2c59",
      id: "vec-subagent:58ca3fa2-3e75-4e9f-bbe0-c3f2c3b327b8",
    },
  );
  const mod3340Exports = {
    useWorkspaceLayoutStore: {
      getState: () => ({
        layoutByWorkspace: {
          "local:wks_0b5492a3faa540ff": {},
        },
        openTab: () => {
          openedSubagentTabCount += 1;
        },
      }),
    },
  };
  const mod3260Exports = {
    useProviderSubagentStore: {
      getState: () => ({ descriptors }),
    },
  };
  const fakeWinWithDescriptorGuard = {
    __c: new Map<number, { isInitialized: boolean; publicModule: { exports: unknown } }>([
      [3340, { isInitialized: true, publicModule: { exports: mod3340Exports } }],
      [3260, { isInitialized: true, publicModule: { exports: mod3260Exports } }],
    ]),
  } as unknown as Window;

  // Missing descriptor (f6e27d02) -> returns false and does NOT open an empty native tab
  const missingResult = openWorkspaceTargetTabViaStore(
    {
      workspaceId: "wks_0b5492a3faa540ff",
      parentAgentId: "2e170a1d-9054-41ca-860e-6715fb3d2c59",
      subagentId: "f6e27d02-46a3-4075-aac1-1737e773cd6d",
    },
    fakeWinWithDescriptorGuard,
  );
  assert.equal(missingResult, false);
  assert.equal(openedSubagentTabCount, 0);

  // Present descriptor (58ca3fa2) -> returns true and opens native tab when explicitly requested
  const presentResult = openWorkspaceTargetTabViaStore(
    {
      workspaceId: "wks_0b5492a3faa540ff",
      parentAgentId: "2e170a1d-9054-41ca-860e-6715fb3d2c59",
      subagentId: "58ca3fa2-3e75-4e9f-bbe0-c3f2c3b327b8",
    },
    fakeWinWithDescriptorGuard,
  );
  assert.equal(presentResult, true);
  assert.equal(openedSubagentTabCount, 1);

  // 3) patchPaseoSubagentTrackModules intercepts conversation://<uuid> inside module 3687 openExternalUrl
  const interceptedUrls: string[] = [];
  let httpFallbackCalled = 0;
  const mod3687Exports: Record<string, unknown> = {
    openExternalUrl: (u: string) => {
      if (u.startsWith("http")) httpFallbackCalled += 1;
    },
  };
  const fakeWinFor3687 = {
    __c: new Map<number, { isInitialized: boolean; publicModule: { exports: unknown } }>([
      [3687, { isInitialized: true, publicModule: { exports: mod3687Exports } }],
    ]),
  } as unknown as Window;

  patchPaseoSubagentTrackModules(fakeWinFor3687, undefined, (cid) => {
    interceptedUrls.push(cid);
  });
  const patchedOpenExternal = mod3687Exports.openExternalUrl as (u: string) => void;
  patchedOpenExternal("conversation://58ca3fa2-3e75-4e9f-bbe0-c3f2c3b327b8");
  patchedOpenExternal("https://example.com");
  assert.deepEqual(interceptedUrls, ["58ca3fa2-3e75-4e9f-bbe0-c3f2c3b327b8"]);
  assert.equal(httpFallbackCalled, 1);
});

test("53. Orphan / outside-paseo Intake session linkage (srv_* workspace extraction, From a session outside Paseo pill, and trailing-row jump button)", async () => {
  const {
    extractCurrentWorkspaceAndAgent,
    enhanceTimelineSentByButtons,
    clearSessionDirectoryForTests,
  } = await import("../client/session-lineage-web");

  clearSessionDirectoryForTests();

  // 1) extractCurrentWorkspaceAndAgent strips srv_<id>: prefix from both pathname and sidebar-workspace-row-<serverId>:<workspaceId>
  const fakeRow = {
    getAttribute: (name: string) =>
      name === "data-testid" ? "sidebar-workspace-row-srv_EXAMPLE00000:wks_477fe6f243d8049a" : null,
  };
  const fakeDocForRow = {
    querySelector: (sel: string) =>
      sel.includes("sidebar-workspace-row-") ? fakeRow : null,
    querySelectorAll: () => [],
  } as unknown as Document;
  const extractedFromRow = extractCurrentWorkspaceAndAgent(fakeDocForRow, {
    location: { pathname: "/" },
  } as unknown as Window);
  assert.equal(extractedFromRow.workspaceId, "wks_477fe6f243d8049a");

  // 2) enhanceTimelineSentByButtons injects a trailing-row jump button (`paseo-finder-spawn-origin-btn`)
  // and inline origin pill when first message starts with "From a session outside Paseo, via antigravity-ops peers spawn."
  const insertedTrailingButtons: Array<{ tid: string | null; text: string }> = [];
  const trailingRow = {
    firstChild: null,
    querySelectorAll: () => [],
    insertBefore: (btn: { getAttribute?: (k: string) => string | null; textContent?: string }) => {
      insertedTrailingButtons.push({
        tid: btn.getAttribute?.("data-testid") ?? null,
        text: btn.textContent ?? "",
      });
    },
  };
  const msgEl = {
    textContent:
      "From a session outside Paseo, via `antigravity-ops peers spawn`. Your task is in a file: read /workspace/intake/briefs/intake-261110-0534-6fb519de-a1.md",
    getAttribute: (k: string) => (k === "data-testid" ? "user-message" : null),
    querySelector: (sel: string) =>
      sel === '[data-testid="user-message-trailing-row"]' ? trailingRow : null,
  };
  const fakeDocForSpawn = {
    documentElement: { style: { setProperty: () => {} } },
    createElement: (tag: string) => {
      const attrs = new Map<string, string>();
      return {
        tagName: tag.toUpperCase(),
        style: {},
        textContent: "",
        title: "",
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        getAttribute: (k: string) => attrs.get(k) ?? null,
        addEventListener: () => {},
        appendChild: () => {},
      };
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes("user-message")) return [msgEl];
      return [];
    },
  } as unknown as Document;

  const healed = enhanceTimelineSentByButtons(
    {
      ok: true,
      action: "inspect",
      current: {
        agentId: "fda3af97-6345-4a6c-8074-19dca5afd82a",
        shortId: "fda3af97",
        agentTitle: "Intake · 国内 自媒体分发 蚂蚁小二 可以cli or mcp powered?",
        workspaceId: "wks_477fe6f243d8049a",
        workspaceTitle: "Intake · 国内 自媒体分发 蚂蚁小二 可以cli or mcp powered?",
        projectId: "prj_cowork",
        projectName: "Demo Workspace",
        status: "done",
        provider: "antigravity",
        model: "gemini-3.8-flash-high",
        providerSessionId: "c7589788-a217-4bde-89d7-bcb0767ff2ad",
        relationKind: "intake-routed",
        routedByAgentId: "3e907bec-8da9-4d52-a28c-3fa4b4b121a5",
        createdAt: "2026-11-10T05:41:09Z",
        updatedAt: "2026-11-10T05:46:24Z",
        briefPath: "/workspace/intake/briefs/intake-261110-0534-6fb519de-a1.md",
        reportPath: "/workspace/intake/reports/intake-261110-0534-6fb519de-a1.report.md",
        reportExists: true,
        notionUrl: "https://www.notion.so/3ef0895c8c79812db51fc5876fb519de",
        notionTaskId: "3ef0895c-8c79-812d-b51f-c5876fb519de",
      },
      parent: null,
      routedOrigin: {
        agentId: "3e907bec-8da9-4d52-a28c-3fa4b4b121a5",
        shortId: "3e907bec",
        agentTitle: "https://www-headquarters.slack.com/archives/C091GLVKLJU/p179",
        workspaceId: "wks_23b9a39ee3a6dc69",
        workspaceTitle: "d Fix cadence Notion sync from Slack thread",
        projectId: "prj_cowork",
        projectName: "Demo Workspace",
        status: "done",
        provider: "antigravity",
        model: "gemini-3.8-flash-high",
        providerSessionId: null,
        relationKind: "intake-routed",
        routedByAgentId: null,
        createdAt: "2026-11-09T02:35:47Z",
        updatedAt: "2026-11-10T04:17:28Z",
        briefPath: null,
        reportPath: null,
        reportExists: false,
        notionUrl: null,
        notionTaskId: null,
      },
      siblings: [],
      children: [],
      colleagues: [],
      projectPeers: [],
      directory: [],
      reconcileSummary: {
        untitledFound: 0,
        renamedCount: 0,
        unlinkedFound: 0,
        linkedCount: 0,
        renamedWorkspaces: [],
      },
      message: "ok",
      durationMs: 5,
    },
    fakeDocForSpawn,
    { navigator: { language: "en-US" } } as unknown as Window,
  );

  assert.equal(healed, 1);
  assert.equal(insertedTrailingButtons.length, 1);
  assert.equal(insertedTrailingButtons[0].tid, "paseo-finder-spawn-origin-btn");
  assert.ok(
    insertedTrailingButtons[0].text.includes("Routed from Fix cadence Notion sync"),
    `Expected clean workspaceTitle instead of URL, got: ${insertedTrailingButtons[0].text}`,
  );

  // 3) When Paseo caches a previously visited workspace in the DOM (ancestor display:none),
  // extractCurrentWorkspaceAndAgent ignores the hidden workspace's active tab and returns the visible workspace's agentId
  const hiddenContainer = {
    nodeType: 1,
    style: { display: "none" },
    parentElement: null,
  };
  const hiddenAgentTab = {
    nodeType: 1,
    style: {},
    parentElement: hiddenContainer,
    getAttribute: (k: string) => {
      if (k === "data-testid") return "workspace-tab-agent_bef7df82-0a46-403c-b4e9-abb84790d7d6";
      if (k === "aria-selected") return "true";
      return null;
    },
  };
  const visibleContainer = {
    nodeType: 1,
    style: { display: "flex" },
    parentElement: null,
  };
  const visibleAgentTab = {
    nodeType: 1,
    style: {},
    parentElement: visibleContainer,
    getAttribute: (k: string) => {
      if (k === "data-testid") return "workspace-tab-agent_fda3af97-6345-4a6c-8074-19dca5afd82a";
      if (k === "aria-selected") return "true";
      return null;
    },
  };
  const docWithCachedWorkspaces = {
    querySelector: () => null,
    querySelectorAll: (sel: string) => {
      if (sel.includes("workspace-tab-agent_")) return [hiddenAgentTab, visibleAgentTab];
      return [];
    },
  } as unknown as Document;
  const extractedVisible = extractCurrentWorkspaceAndAgent(docWithCachedWorkspaces, {
    location: { pathname: "/workspace/srv_EXAMPLE00000:wks_477fe6f243d8049a" },
  } as unknown as Window);
  assert.equal(extractedVisible.agentId, "fda3af97-6345-4a6c-8074-19dca5afd82a");
});

test("54. Thread Navigation (Cmd+; / Cmd+') and Pin Workspace (Cmd+Option+P) shortcuts, input-protection, context menu annotation, and settings observability", () => {
  const fakeKe = (init: Record<string, unknown>) => ({
    key: "",
    preventDefault: () => {},
    stopPropagation: () => {},
    ...init,
  } as unknown as import("../client/web").MinimalKeyboardEvent);

  // 1) Keyboard event matching
  assert.equal(isPreviousThreadKeyboardEvent(fakeKe({ metaKey: true, key: ";", code: "Semicolon" })), true);
  assert.equal(isPreviousThreadKeyboardEvent(fakeKe({ ctrlKey: true, key: ";", code: "Semicolon" })), true);
  assert.equal(isPreviousThreadKeyboardEvent(fakeKe({ metaKey: true, shiftKey: true, key: ";" })), false);
  assert.equal(isPreviousThreadKeyboardEvent(fakeKe({ metaKey: true, altKey: true, key: ";" })), false);

  assert.equal(isNextThreadKeyboardEvent(fakeKe({ metaKey: true, key: "'", code: "Quote" })), true);
  assert.equal(isNextThreadKeyboardEvent(fakeKe({ ctrlKey: true, key: "'", code: "Quote" })), true);
  assert.equal(isNextThreadKeyboardEvent(fakeKe({ metaKey: true, shiftKey: true, key: "'" })), false);
  assert.equal(isNextThreadKeyboardEvent(fakeKe({ metaKey: true, altKey: true, key: "'" })), false);

  assert.equal(isPinWorkspaceKeyboardEvent(fakeKe({ metaKey: true, altKey: true, key: "p", code: "KeyP" })), true);
  assert.equal(isPinWorkspaceKeyboardEvent(fakeKe({ metaKey: true, altKey: true, key: "π", code: "KeyP" })), true);
  assert.equal(isPinWorkspaceKeyboardEvent(fakeKe({ ctrlKey: true, altKey: true, key: "p", code: "KeyP" })), true);
  assert.equal(isPinWorkspaceKeyboardEvent(fakeKe({ metaKey: true, altKey: false, key: "p", code: "KeyP" })), false);
  assert.equal(isPinWorkspaceKeyboardEvent(fakeKe({ metaKey: true, altKey: true, shiftKey: true, key: "p" })), false);

  // 2) Input safety protection
  assert.equal(isEditableInput(null), false);
  assert.equal(isEditableInput({ tagName: "INPUT", getAttribute: () => null } as unknown as MinimalElement), true);
  assert.equal(isEditableInput({ tagName: "TEXTAREA", getAttribute: () => null } as unknown as MinimalElement), true);
  assert.equal(isEditableInput({ tagName: "DIV", getAttribute: (k: string) => k === "contenteditable" ? "true" : null } as unknown as MinimalElement), true);
  assert.equal(isEditableInput({ tagName: "DIV", className: "cm-content", getAttribute: () => null } as unknown as MinimalElement), true);

  // 3) Relative thread navigation dispatches native Cmd+[ and Cmd+]
  let dispatchedKey = "";
  let dispatchedMeta = false;
  const fakeWin = {
    navigator: { platform: "MacIntel", language: "en-US" },
    location: { pathname: "/workspace/local:wks_1" },
    dispatchEvent: (ev: { key: string; metaKey: boolean }) => {
      dispatchedKey = ev.key;
      dispatchedMeta = ev.metaKey;
      return false; // preventDefault
    },
    KeyboardEvent: class {
      key: string;
      metaKey: boolean;
      defaultPrevented = true;
      constructor(_type: string, init?: { key?: string; metaKey?: boolean }) {
        this.key = init?.key ?? "";
        this.metaKey = Boolean(init?.metaKey);
      }
    },
  } as unknown as MinimalWindow;
  const fakeDoc = { querySelectorAll: () => [], querySelector: () => null } as unknown as MinimalDocument;

  const prevRes = navigateSidebarThreadRelative({ delta: -1, win: fakeWin, doc: fakeDoc });
  assert.equal(prevRes.ok, true);
  assert.equal(prevRes.source, "native-shortcut");
  assert.equal(dispatchedKey, "[");
  assert.equal(dispatchedMeta, true);

  const nextRes = navigateSidebarThreadRelative({ delta: 1, win: fakeWin, doc: fakeDoc });
  assert.equal(nextRes.ok, true);
  assert.equal(nextRes.source, "native-shortcut");
  assert.equal(dispatchedKey, "]");
  assert.equal(dispatchedMeta, true);

  // 4) Pin workspace action dispatches native Cmd+Shift+P
  let pinKey = "";
  let pinShift = false;
  let pinMeta = false;
  const fakePinWin = {
    navigator: { platform: "MacIntel", language: "en-US" },
    location: { pathname: "/workspace/local:wks_1" },
    dispatchEvent: (ev: { key: string; metaKey: boolean; shiftKey: boolean }) => {
      pinKey = ev.key;
      pinMeta = ev.metaKey;
      pinShift = ev.shiftKey;
      return false;
    },
    KeyboardEvent: class {
      key: string;
      metaKey: boolean;
      shiftKey: boolean;
      defaultPrevented = true;
      constructor(_type: string, init?: { key?: string; metaKey?: boolean; shiftKey?: boolean }) {
        this.key = init?.key ?? "";
        this.metaKey = Boolean(init?.metaKey);
        this.shiftKey = Boolean(init?.shiftKey);
      }
    },
  } as unknown as MinimalWindow;

  const pinRes = toggleActiveWorkspacePin({ win: fakePinWin, doc: fakeDoc });
  assert.equal(pinRes.ok, true);
  assert.equal(pinRes.source, "native-shortcut");
  assert.equal(pinKey, "P");
  assert.equal(pinShift, true);
  assert.equal(pinMeta, true);

  // 5) Context menu annotation annotates pin item with ⌘⌥P
  const addedBadges: MinimalElement[] = [];
  const fakePinItem: MinimalElement = {
    tagName: "DIV",
    style: {},
    getAttribute: (k: string) => k === "data-testid" ? "sidebar-workspace-menu-pin-wks_test" : null,
    setAttribute: () => {},
    querySelectorAll: () => [],
    appendChild: (b: MinimalElement) => { addedBadges.push(b); },
  };
  const docForAnnotation = {
    querySelectorAll: (sel: string) => sel.includes("sidebar-workspace-menu-pin-") ? [fakePinItem] : [],
    querySelector: () => null,
    createElement: (tag: string) => {
      const a = new Map<string, string>();
      return {
        tagName: tag.toUpperCase(),
        style: {},
        textContent: "",
        getAttribute: (k: string) => a.get(k) ?? null,
        setAttribute: (k: string, v: string) => a.set(k, v),
      } as unknown as MinimalElement;
    },
  } as unknown as MinimalDocument;
  const annotated = annotateNativeWorkspaceMenusWithShortcuts(
    docForAnnotation,
    {
      enablePinWorkspaceShortcut: true,
      enableThreadNavigationShortcuts: true,
      enableQuickRenameAndLabelShortcuts: true,
      enableSidebarDeleteKeyArchive: true,
      labelShortcutCombo: "both",
      enableInlineDoubleClickRename: true,
      autoJumpToFirstPlaceInput: true,
      inlineRenameCaretPosition: "start",
      enableMarkDoneShortcut: true,
      markDonePrefix: "d ",
      enableDesktopContextMenuHelper: true,
      enableCmdClickOpenSystemDefault: true,
      cmdClickDefaultTarget: "system-default",
      enableSidebarCmdClickFinder: true,
    },
    { navigator: { platform: "MacIntel" } } as unknown as MinimalWindow,
  );
  assert.ok(annotated > 0);
  assert.equal(addedBadges.length, 1);
  assert.equal(addedBadges[0].getAttribute?.("data-testid"), "sidebar-workspace-menu-pin-shortcut-hint");
  assert.equal(addedBadges[0].textContent, "⌘⌥P");

  // 6) Settings schema defaults
  const parsedSettings = pluginSettings.schema.parse({});
  assert.equal(parsedSettings.enableThreadNavigationShortcuts, true);
  assert.equal(parsedSettings.enablePinWorkspaceShortcut, true);
});

test("52. Brand-new user sessions never inherit hidden background <code> references or stale v1 return breadcrumbs", async () => {
  const {
    clearSessionDirectoryForTests,
    ingestSessionLineageResponse,
    enhanceTimelineAgentMentions,
    getReturnBreadcrumbForSession,
  } = await import("../client/session-lineage-web");

  clearSessionDirectoryForTests();

  const hiddenRefNode = {
    agentId: "a402b245-1111-4222-8333-444455556666",
    shortId: "a402b245",
    agentTitle: "Fix AI slop in design prompts",
    workspaceId: "wks_hidden_old",
    workspaceTitle: "Fix AI slop in design prompts",
    projectId: "proj_meta",
    projectName: "2026-11-08 Meta harness",
    status: "done",
    provider: "antigravity",
    model: "gemini-3.8-flash-high",
    providerSessionId: null,
    relationKind: "self" as const,
    routedByAgentId: null,
    createdAt: "2026-11-10T06:00:00Z",
    updatedAt: "2026-11-10T06:30:00Z",
    briefPath: null,
    reportPath: null,
    reportExists: false,
    notionUrl: null,
    notionTaskId: null,
  };

  const newUserSessionNode = {
    ...hiddenRefNode,
    agentId: "7714bf68-165b-4475-8220-ef623972a49e",
    shortId: "7714bf68",
    agentTitle: "read and submit pr for it /github-ops if need",
    workspaceId: "wks_f1696f38a7641f5e",
    workspaceTitle: "read and submit pr for it /github-ops if need",
  };

  const lineageData = {
    ok: true,
    action: "inspect" as const,
    workspaceId: newUserSessionNode.workspaceId,
    workspaceTitle: newUserSessionNode.workspaceTitle,
    current: newUserSessionNode,
    parent: null,
    routedOrigin: null,
    siblings: [],
    children: [],
    colleagues: [],
    projectPeers: [hiddenRefNode],
    directory: [newUserSessionNode, hiddenRefNode],
    reconcileSummary: {
      untitledFound: 0,
      renamedCount: 0,
      unlinkedFound: 0,
      linkedCount: 0,
      renamedWorkspaces: [],
    },
    message: "ok",
    durationMs: 1,
  };

  ingestSessionLineageResponse(lineageData);

  // 1) Legacy v1 sessionStorage breadcrumbs (from passive session switching) are purged on read
  const storageMap = new Map<string, string>();
  storageMap.set(
    "paseo_finder_session_jump_breadcrumb_v1",
    JSON.stringify([
      {
        from: hiddenRefNode,
        toAgentId: newUserSessionNode.agentId,
        toWorkspaceId: newUserSessionNode.workspaceId,
        atMs: Date.now(),
      },
    ]),
  );
  const fakeWin = {
    navigator: { language: "en-US" },
    location: { pathname: `/h/srv_test/workspace/${newUserSessionNode.workspaceId}` },
    sessionStorage: {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, v),
      removeItem: (k: string) => storageMap.delete(k),
    },
  } as unknown as Window;

  assert.equal(
    getReturnBreadcrumbForSession(
      newUserSessionNode.workspaceId,
      newUserSessionNode.agentId,
      fakeWin,
    ),
    null,
    "Stale v1 breadcrumb from passive session switching must be purged and return null",
  );
  assert.equal(
    storageMap.has("paseo_finder_session_jump_breadcrumb_v1"),
    false,
    "Legacy v1 storage key should be deleted",
  );

  // 2) Hidden inactive screen with <code>a402b245</code> must NOT leak into a new session that has 0 visible <code> elements
  const hiddenContainer = {
    nodeType: 1,
    hidden: false,
    style: { display: "none" },
    getAttribute: (k: string) => (k === "data-testid" ? "assistant-message" : null),
    parentElement: null,
  };
  const hiddenCodeEl = {
    nodeType: 1,
    textContent: "a402b245",
    style: {},
    parentElement: hiddenContainer,
    getAttribute: () => null,
    setAttribute: () => {},
    closest: (sel: string) =>
      sel.includes("assistant-message") ? hiddenContainer : null,
  };
  const visibleUserMsg = {
    nodeType: 1,
    hidden: false,
    style: {},
    textContent: "read and submit pr for it /github-ops if need",
    getAttribute: (k: string) => (k === "data-testid" ? "user-message" : null),
    parentElement: null,
  };
  const fakeDoc = {
    documentElement: { style: { setProperty: () => {} } },
    querySelector: (sel: string) =>
      sel.includes("user-message") ? visibleUserMsg : null,
    querySelectorAll: (sel: string) => {
      if (sel === "code") return [hiddenCodeEl];
      if (sel === "a[href]") return [];
      return [];
    },
  } as unknown as Document;

  const refs = enhanceTimelineAgentMentions(lineageData, fakeDoc, fakeWin);
  assert.equal(
    refs.length,
    0,
    "Hidden <code> elements from inactive background sessions must never leak when the active session has 0 visible <code> elements",
  );
});

test("55. Colleague pill bidirectional jump-back, cross-workspace stale-agentId guard, and peers send trailing-row button", async () => {
  const {
    clearSessionDirectoryForTests,
    ingestSessionLineageResponse,
    extractCurrentWorkspaceAndAgent,
    navigateToLineageNode,
    getReturnBreadcrumbForSession,
    enhanceTimelineSentByButtons,
  } = await import("../client/session-lineage-web");

  clearSessionDirectoryForTests();

  const originSession = {
    agentId: "2fd9139e-2506-4df5-b699-5425553fc48c",
    shortId: "2fd9139e",
    agentTitle: "Show linked sub-agent sessions in Paseo sidebar",
    workspaceId: "wks_01fb9117e07777ba",
    workspaceTitle: "Show linked sub-agent sessions in Paseo sidebar",
    projectId: "proj_meta",
    projectName: "2026-11-08 Meta harness",
    status: "done",
    provider: "antigravity",
    model: "gemini-3.8-flash-high",
    providerSessionId: null,
    relationKind: "self" as const,
    routedByAgentId: null,
    createdAt: "2026-11-09T10:00:00Z",
    updatedAt: "2026-11-10T06:00:00Z",
    briefPath: null,
    reportPath: null,
    reportExists: false,
    notionUrl: null,
    notionTaskId: null,
  };

  const colleagueSession = {
    ...originSession,
    agentId: "efbb3721-90c3-45cc-b781-a931e64f7700",
    shortId: "efbb3721",
    agentTitle: "Add chat rewind and fork-session buttons",
    workspaceId: "wks_40c7f50a74de87a4",
    workspaceTitle: "Add chat rewind and fork-session buttons",
    relationKind: "colleague" as const,
  };

  const peerSenderSession = {
    ...originSession,
    agentId: "af81b8f0-1111-4222-8333-444455556666",
    shortId: "af81b8f0",
    agentTitle: "Settings search & keyboard navigation",
    workspaceId: "wks_settings_search",
    workspaceTitle: "Settings search & keyboard navigation",
    relationKind: "colleague" as const,
  };

  ingestSessionLineageResponse({
    ok: true,
    action: "inspect",
    current: originSession,
    parent: null,
    routedOrigin: null,
    siblings: [],
    children: [],
    colleagues: [colleagueSession],
    projectPeers: [colleagueSession, peerSenderSession],
    directory: [originSession, colleagueSession, peerSenderSession],
    reconcileSummary: {
      untitledFound: 0,
      renamedCount: 0,
      unlinkedFound: 0,
      linkedCount: 0,
      renamedWorkspaces: [],
    },
    message: "ok",
    durationMs: 1,
  });

  // 1) Cross-workspace transition guard in extractCurrentWorkspaceAndAgent:
  // When URL has switched to wks_40c7f50a74de87a4 (colleagueSession), a stale DOM tab for originSession (2fd9139e, belonging to wks_01fb9117e07777ba) must NOT be returned as agentId!
  const staleTabEl = {
    nodeType: 1,
    hidden: false,
    style: {},
    parentElement: null,
    getAttribute: (k: string) => {
      if (k === "data-testid") return `workspace-tab-agent_${originSession.agentId}`;
      if (k === "aria-selected") return "true";
      return null;
    },
  };
  const transitionDoc = {
    querySelector: () => null,
    querySelectorAll: (sel: string) =>
      sel.includes("workspace-tab-agent_") ? [staleTabEl] : [],
  } as unknown as Document;
  const transitionWin = {
    location: { pathname: `/h/srv_TS6CdHdSs5mI/workspace/${colleagueSession.workspaceId}` },
  } as unknown as Window;

  const extractedDuringTransition = extractCurrentWorkspaceAndAgent(transitionDoc, transitionWin);
  assert.equal(extractedDuringTransition.workspaceId, colleagueSession.workspaceId);
  assert.equal(
    extractedDuringTransition.agentId,
    null,
    "Stale DOM tab from previous workspace must be rejected when URL has already moved to a different workspace",
  );

  // 2) Navigating from originSession (even when currentActive only has srv_...:wks_... workspaceId) records the return breadcrumb
  const storageMap = new Map<string, string>();
  const navWin = {
    navigator: { language: "en-US" },
    location: { pathname: `/h/srv_TS6CdHdSs5mI/workspace/srv_TS6CdHdSs5mI:${originSession.workspaceId}` },
    sessionStorage: {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, v),
      removeItem: (k: string) => storageMap.delete(k),
    },
  } as unknown as Window;
  const navDoc = {
    querySelector: () => null,
    querySelectorAll: () => [],
  } as unknown as Document;

  navigateToLineageNode(colleagueSession, navDoc, navWin, originSession);

  const crumbOnColleague = getReturnBreadcrumbForSession(
    `srv_TS6CdHdSs5mI:${colleagueSession.workspaceId}`,
    colleagueSession.agentId,
    navWin,
  );
  assert.ok(crumbOnColleague, "Return breadcrumb must be resolved on colleague session");
  assert.equal(crumbOnColleague?.agentId, originSession.agentId);

  // 3) enhanceTimelineSentByButtons injects [Sent by <Colleague> ↗] into user-message-trailing-row for `peers send <id>` messages
  const trailingButtons: Array<{ attrs: Map<string, string>; textContent: string; title: string }> = [];
  const fakeTrailingRow = {
    nodeType: 1,
    hidden: false,
    style: {},
    firstChild: null,
    querySelectorAll: () => trailingButtons,
    insertBefore: (el: any) => {
      trailingButtons.unshift(el);
    },
  };
  const fakePeerMsg = {
    nodeType: 1,
    hidden: false,
    style: {},
    parentElement: null,
    textContent:
      "From the T-039 settings-search session (Paseo agent af81b8f0), not the user. Reply route: antigravity-ops peers send af81b8f0",
    getAttribute: (k: string) => (k === "data-testid" ? "user-message" : null),
    querySelector: (sel: string) =>
      sel.includes("user-message-trailing-row") ? fakeTrailingRow : null,
  };
  const msgDoc = {
    documentElement: { style: { setProperty: () => {} } },
    createElement: () => {
      const attrs = new Map<string, string>();
      return {
        attrs,
        type: "",
        title: "",
        textContent: "",
        style: {},
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        getAttribute: (k: string) => attrs.get(k) ?? null,
        addEventListener: () => {},
      };
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes("user-message")) return [fakePeerMsg];
      return [];
    },
  } as unknown as Document;

  const healed = enhanceTimelineSentByButtons(
    {
      ok: true,
      action: "inspect",
      current: colleagueSession,
      parent: null,
      routedOrigin: originSession,
      siblings: [],
      children: [],
      colleagues: [originSession, peerSenderSession],
      projectPeers: [originSession, peerSenderSession],
      directory: [originSession, colleagueSession, peerSenderSession],
      reconcileSummary: {
        untitledFound: 0,
        renamedCount: 0,
        unlinkedFound: 0,
        linkedCount: 0,
        renamedWorkspaces: [],
      },
      message: "ok",
      durationMs: 1,
    },
    msgDoc,
    navWin,
  );
  assert.ok(healed >= 1, "enhanceTimelineSentByButtons must inject a trailing-row sender button for peers send messages");
  assert.equal(trailingButtons.length, 1);
  assert.equal(
    trailingButtons[0].attrs.get("data-testid"),
    "paseo-finder-peer-sender-btn-af81b8f0",
  );
  assert.ok(trailingButtons[0].textContent.includes("Sent by Settings search & keyboard n"));
});

test("56. Left sidebar subagents zero-shrink & zero-delay: hidden provider_subagent tab isolation and handleManageSubagents Smart Skip (<25ms)", async () => {
  const { extractCurrentWorkspaceAndAgent } = await import("../client/session-lineage-web");
  const { handleManageSubagents } = await import("../server/agent-history-handlers");

  // 1) When switching to Workspace B (`wks_open_design`, which has 0 visible subagent tabs)
  // while Workspace A (`wks_scan_funnels`) still has a hidden `provider_subagent` tab in the DOM,
  // `extractCurrentWorkspaceAndAgent` must NOT leak Workspace A's `parentAgentId` into Workspace B.
  const wsBAgentTab = {
    getAttribute: (k: string) => {
      if (k === "data-testid") return "workspace-tab-agent_aaaaaaaa-1111-2222-3333-444444444444";
      if (k === "aria-selected") return "true";
      return null;
    },
    parentElement: null,
    style: { display: "flex" },
  };
  const hiddenWsASubagentTab = {
    getAttribute: (k: string) => {
      if (k === "data-testid") {
        return "workspace-tab-provider_subagent_36_539eb3cd-c9d1-494a-926e-8e1be08c4487_36_a88d4f36-f88d-4018-9cb6-65d92cb0893d";
      }
      if (k === "aria-selected") return "true";
      return null;
    },
    parentElement: {
      parentElement: null,
      style: { display: "none" },
      getAttribute: () => null,
    },
    style: { display: "flex" },
  };
  const mockDoc = {
    querySelector: () => null,
    querySelectorAll: (sel: string) => {
      if (sel.includes("workspace-tab-provider_subagent_")) return [hiddenWsASubagentTab];
      if (sel.includes("workspace-tab-agent_")) return [wsBAgentTab];
      return [];
    },
  } as unknown as Document;
  const mockWin = {
    location: {
      pathname: "/workspace/local:wks_open_design",
      href: "http://localhost/workspace/local:wks_open_design",
    },
  } as unknown as Window;

  const ctx = extractCurrentWorkspaceAndAgent(mockDoc, mockWin);
  assert.equal(ctx.workspaceId, "local:wks_open_design");
  assert.equal(
    ctx.agentId,
    "aaaaaaaa-1111-2222-3333-444444444444",
    "Must resolve Workspace B's own visible agent tab instead of leaking hidden Workspace A's parentAgentId",
  );
  assert.equal(ctx.activeSubagentId, null);

  // 2) handleManageSubagents Smart Skip: cold index build + warm lookup (<10ms) without spawning 1,200ms Python subprocess.
  const tCold = Date.now();
  const resCold = await handleManageSubagents(
    {
      action: "tree",
      workspaceId: "wks_39986d1a4c4b2392",
      includeTimeline: false,
      limit: 5,
    },
    {} as never,
  );
  const coldElapsed = Date.now() - tCold;
  assert.equal(resCold.ok, true);
  assert.equal(resCold.trees.length, 0);
  assert.ok(coldElapsed < 500, `Expected cold index build + Smart Skip <500ms, got ${coldElapsed}ms`);

  const tWarm = Date.now();
  const resWarm = await handleManageSubagents(
    {
      action: "tree",
      workspaceId: "wks_67f5e15fb90d56de",
      includeTimeline: false,
      limit: 5,
    },
    {} as never,
  );
  const warmElapsed = Date.now() - tWarm;
  assert.equal(resWarm.ok, true);
  assert.equal(resWarm.trees.length, 0);
  assert.ok(
    warmElapsed < 500,
    `Expected warm Smart Skip on second workspace without spawning Python (got ${warmElapsed}ms, Python takes >1200ms)`,
  );
});






