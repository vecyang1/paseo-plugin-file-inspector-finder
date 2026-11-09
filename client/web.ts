import { Platform } from "react-native";
import {
  type InlineRenameCaretPosition,
  type InlineRenameSource,
  type OpenerTarget,
  type ProjectJumpCandidate,
  type QuickJumpAction,
  type SidebarDropBehavior,
  SUPPORTED_IMAGE_EXTENSIONS,
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
  scoreProjectJumpQuery,
} from "../shared/contracts";
import { PASEO_IDENTITY_BG_HEX } from "../shared/paseo-theme";
import { getCatalogForLocale, isChineseLocale } from "./i18n";
import {
  resolveSidebarProjectVisual,
  syncPaseoThemeCssVariables,
} from "./theme-web";

export const LABEL_COLOR_HEX: Record<WorkspaceLabelColor, string> = PASEO_IDENTITY_BG_HEX;

interface MinimalStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface MinimalElement {
  tagName?: string;
  textContent?: string | null;
  innerHTML?: string;
  className?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  scrollLeft?: number;
  parentElement?: MinimalElement | null;
  nextSibling?: MinimalElement | null;
  children?: ArrayLike<MinimalElement>;
  style?: Record<string, string>;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  closest?(selector: string): MinimalElement | null;
  querySelector?(selector: string): MinimalElement | null;
  querySelectorAll?(selector: string): ArrayLike<MinimalElement>;
  appendChild?(child: MinimalElement): void;
  insertBefore?(newNode: MinimalElement, referenceNode: MinimalElement | null): void;
  cloneNode?(deep?: boolean): MinimalElement;
  remove?(): void;
  click?(): void;
  focus?(): void;
  select?(): void;
  setSelectionRange?(
    start: number,
    end: number,
    direction?: "forward" | "backward" | "none",
  ): void;
  scrollIntoView?(
    arg?:
      | boolean
      | {
          behavior?: "auto" | "instant" | "smooth" | string;
          block?: "start" | "center" | "end" | "nearest" | string;
          inline?: "start" | "center" | "end" | "nearest" | string;
        },
  ): void;
  getBoundingClientRect?(): {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  addEventListener?(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  removeEventListener?(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  contains?(other: MinimalElement | null): boolean;
}

export interface MinimalDataTransfer {
  types?: ArrayLike<string>;
  files?: ArrayLike<{ path?: string; name?: string }>;
  dropEffect?: string;
  effectAllowed?: string;
  getData?(format: string): string;
}

export interface MinimalDragEvent {
  clientX?: number;
  clientY?: number;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target: MinimalElement | null;
  relatedTarget?: MinimalElement | null;
  dataTransfer?: MinimalDataTransfer | null;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface MinimalMouseEvent {
  clientX: number;
  clientY: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  button?: number;
  target: MinimalElement | null;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface MinimalKeyboardEvent {
  key: string;
  code?: string;
  keyCode?: number;
  isComposing?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: MinimalElement | null;
  preventDefault(): void;
  stopPropagation?(): void;
}

export interface MinimalDocument {
  head?: MinimalElement | null;
  body?: MinimalElement | null;
  documentElement?: MinimalElement | null;
  activeElement?: MinimalElement | null;
  createElement(tag: string): MinimalElement;
  querySelector(selector: string): MinimalElement | null;
  querySelectorAll(selector: string): ArrayLike<MinimalElement>;
  addEventListener(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  removeEventListener(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  dispatchEvent?(event: unknown): boolean;
}

export interface MinimalWindow {
  localStorage?: MinimalStorage;
  document?: MinimalDocument;
  navigator?: { language?: string };
  location?: { pathname?: string };
  history?: {
    pushState?(data: unknown, unused: string, url?: string | null): void;
  };
  paseoDesktop?: {
    webUtils?: {
      getPathForFile?(file: unknown): string;
    };
  };
  innerWidth?: number;
  innerHeight?: number;
  getComputedStyle?(el: MinimalElement): {
    color?: string;
    fontSize?: string;
    fontWeight?: string;
    fontFamily?: string;
    lineHeight?: string;
    letterSpacing?: string;
  } | null;
  getSelection?(): {
    removeAllRanges?(): void;
  } | null;
  MutationObserver?: new (callback: () => void) => {
    observe(target: unknown, options: Record<string, boolean>): void;
    disconnect(): void;
    takeRecords?(): unknown[];
  };
  KeyboardEvent?: new (type: string, init?: Record<string, unknown>) => unknown;
  PopStateEvent?: new (type: string, init?: Record<string, unknown>) => unknown;
  requestAnimationFrame?(cb: () => void): number;
  cancelAnimationFrame?(id: number): void;
  addEventListener(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  removeEventListener(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  dispatchEvent?(event: unknown): boolean;
}

export function getWebWindow(): MinimalWindow | null {
  if (Platform.OS !== "web") return null;
  const g = globalThis as unknown as { window?: MinimalWindow };
  return g.window ?? null;
}

const LUCIDE_SVGS: Record<
  "FolderOpen" | "Folder" | "FolderPlus" | "ExternalLink" | "Copy",
  string
> = {
  FolderOpen:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>',
  Folder:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  FolderPlus:
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  ExternalLink:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  Copy:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
};

const SIDEBAR_DROP_STORAGE_KEY = "paseo:finder-plugin:sidebar-drop-config";
const INLINE_RENAME_STORAGE_KEY = "paseo:finder-plugin:inline-rename-config";
const QUICK_JUMP_STORAGE_KEY = "paseo:finder-plugin:quick-jump-config";

export interface QuickJumpPreferences {
  enableWorkspaceQuickJump: boolean;
  enableCommandCenterProjectItems: boolean;
  autoRevealActiveWorkspaceInSidebar: boolean;
  quickJumpDefaultAction: QuickJumpAction;
}

export function syncQuickJumpPreferences(
  prefs: Partial<QuickJumpPreferences>,
  storageOverride?: MinimalStorage | null,
): void {
  const storage =
    storageOverride ?? (Platform.OS === "web" ? getWebWindow()?.localStorage : null);
  if (!storage) return;
  try {
    const existing = readQuickJumpPreferences(storage);
    const merged: QuickJumpPreferences = {
      enableWorkspaceQuickJump:
        prefs.enableWorkspaceQuickJump ?? existing.enableWorkspaceQuickJump,
      enableCommandCenterProjectItems:
        prefs.enableCommandCenterProjectItems ?? existing.enableCommandCenterProjectItems,
      autoRevealActiveWorkspaceInSidebar:
        prefs.autoRevealActiveWorkspaceInSidebar ??
        existing.autoRevealActiveWorkspaceInSidebar,
      quickJumpDefaultAction:
        prefs.quickJumpDefaultAction ?? existing.quickJumpDefaultAction,
    };
    storage.setItem(QUICK_JUMP_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Ignore storage write errors
  }
}

export function readQuickJumpPreferences(
  storage?: MinimalStorage | null,
): QuickJumpPreferences {
  const defaults: QuickJumpPreferences = {
    enableWorkspaceQuickJump: true,
    enableCommandCenterProjectItems: true,
    autoRevealActiveWorkspaceInSidebar: true,
    quickJumpDefaultAction: "open-latest",
  };
  if (!storage) return defaults;
  try {
    const raw = storage.getItem(QUICK_JUMP_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<keyof QuickJumpPreferences, unknown>>;
    const action = parsed.quickJumpDefaultAction;
    return {
      enableWorkspaceQuickJump: parsed.enableWorkspaceQuickJump !== false,
      enableCommandCenterProjectItems: parsed.enableCommandCenterProjectItems !== false,
      autoRevealActiveWorkspaceInSidebar:
        parsed.autoRevealActiveWorkspaceInSidebar !== false,
      quickJumpDefaultAction:
        action === "locate-sidebar" || action === "create-new" ? action : "open-latest",
    };
  } catch {
    return defaults;
  }
}

export interface InlineRenamePreferences {
  enableInlineDoubleClickRename: boolean;
  autoJumpToFirstPlaceInput: boolean;
  inlineRenameCaretPosition: InlineRenameCaretPosition;
  enableQuickRenameAndLabelShortcuts: boolean;
  enableMarkDoneShortcut: boolean;
  markDonePrefix: string;
  enableDesktopContextMenuHelper: boolean;
  enableCmdClickOpenSystemDefault: boolean;
  cmdClickDefaultTarget: OpenerTarget;
  enableSidebarCmdClickFinder: boolean;
}

export function syncInlineRenamePreferences(
  prefs: Partial<InlineRenamePreferences>,
  storageOverride?: MinimalStorage | null,
): void {
  const storage =
    storageOverride ?? (Platform.OS === "web" ? getWebWindow()?.localStorage : null);
  if (!storage) return;
  try {
    const existing = readInlineRenamePreferences(storage);
    let nextCaret: InlineRenameCaretPosition = existing.inlineRenameCaretPosition;
    let nextAutoJump: boolean = existing.autoJumpToFirstPlaceInput;

    if (prefs.inlineRenameCaretPosition !== undefined) {
      nextCaret = prefs.inlineRenameCaretPosition;
      nextAutoJump =
        prefs.autoJumpToFirstPlaceInput !== undefined
          ? prefs.autoJumpToFirstPlaceInput
          : nextCaret === "start";
    } else if (prefs.autoJumpToFirstPlaceInput !== undefined) {
      nextAutoJump = prefs.autoJumpToFirstPlaceInput;
      nextCaret = nextAutoJump
        ? "start"
        : existing.inlineRenameCaretPosition === "end"
          ? "end"
          : "select-all";
    }

    const merged: InlineRenamePreferences = {
      enableInlineDoubleClickRename:
        prefs.enableInlineDoubleClickRename ?? existing.enableInlineDoubleClickRename,
      autoJumpToFirstPlaceInput: nextAutoJump,
      inlineRenameCaretPosition: nextCaret,
      enableQuickRenameAndLabelShortcuts:
        prefs.enableQuickRenameAndLabelShortcuts ??
        existing.enableQuickRenameAndLabelShortcuts,
      enableMarkDoneShortcut:
        prefs.enableMarkDoneShortcut ?? existing.enableMarkDoneShortcut,
      markDonePrefix: prefs.markDonePrefix ?? existing.markDonePrefix ?? "d ",
      enableDesktopContextMenuHelper:
        prefs.enableDesktopContextMenuHelper ?? existing.enableDesktopContextMenuHelper,
      enableCmdClickOpenSystemDefault:
        prefs.enableCmdClickOpenSystemDefault ?? existing.enableCmdClickOpenSystemDefault,
      cmdClickDefaultTarget:
        prefs.cmdClickDefaultTarget ?? existing.cmdClickDefaultTarget ?? "system-default",
      enableSidebarCmdClickFinder:
        prefs.enableSidebarCmdClickFinder ?? existing.enableSidebarCmdClickFinder,
    };
    storage.setItem(INLINE_RENAME_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Ignore storage write errors
  }
}

export function readInlineRenamePreferences(
  storage?: MinimalStorage | null,
): InlineRenamePreferences {
  const defaults: InlineRenamePreferences = {
    enableInlineDoubleClickRename: true,
    autoJumpToFirstPlaceInput: true,
    inlineRenameCaretPosition: "start",
    enableQuickRenameAndLabelShortcuts: true,
    enableMarkDoneShortcut: true,
    markDonePrefix: "d ",
    enableDesktopContextMenuHelper: true,
    enableCmdClickOpenSystemDefault: true,
    cmdClickDefaultTarget: "system-default",
    enableSidebarCmdClickFinder: true,
  };
  if (!storage) return defaults;
  try {
    const raw = storage.getItem(INLINE_RENAME_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<keyof InlineRenamePreferences, unknown>>;
    const rawCaret = parsed.inlineRenameCaretPosition;
    const hasExplicitAutoJump = typeof parsed.autoJumpToFirstPlaceInput === "boolean";
    const autoJump = hasExplicitAutoJump
      ? Boolean(parsed.autoJumpToFirstPlaceInput)
      : rawCaret === "select-all" || rawCaret === "end"
        ? false
        : true;
    const caretPosition: InlineRenameCaretPosition =
      rawCaret === "select-all" || rawCaret === "end" || rawCaret === "start"
        ? autoJump && rawCaret !== "start" && hasExplicitAutoJump
          ? "start"
          : rawCaret
        : autoJump
          ? "start"
          : "select-all";

    const target = parsed.cmdClickDefaultTarget;
    const validTarget: OpenerTarget =
      target === "finder-reveal" ||
      target === "finder-folder" ||
      target === "system-preview" ||
      target === "system-default" ||
      target === "quicklook" ||
      target === "antigravity" ||
      target === "cursor" ||
      target === "vscode" ||
      target === "terminal"
        ? target
        : "system-default";

    return {
      enableInlineDoubleClickRename: parsed.enableInlineDoubleClickRename !== false,
      autoJumpToFirstPlaceInput: caretPosition === "start",
      inlineRenameCaretPosition: caretPosition,
      enableQuickRenameAndLabelShortcuts:
        parsed.enableQuickRenameAndLabelShortcuts !== false,
      enableMarkDoneShortcut: parsed.enableMarkDoneShortcut !== false,
      markDonePrefix:
        typeof parsed.markDonePrefix === "string" && parsed.markDonePrefix.length > 0
          ? parsed.markDonePrefix
          : "d ",
      enableDesktopContextMenuHelper: parsed.enableDesktopContextMenuHelper !== false,
      enableCmdClickOpenSystemDefault: parsed.enableCmdClickOpenSystemDefault !== false,
      cmdClickDefaultTarget: validTarget,
      enableSidebarCmdClickFinder: parsed.enableSidebarCmdClickFinder !== false,
    };
  } catch {
    return defaults;
  }
}

export function applyInlineInputCaret(
  inputEl: MinimalElement,
  caretPosition: InlineRenameCaretPosition = "start",
): { selectionStart: number; selectionEnd: number; scrollLeft: number } {
  const len = (inputEl.value ?? "").length;
  inputEl.focus?.();
  if (caretPosition === "start") {
    inputEl.setSelectionRange?.(0, 0, "none");
    inputEl.selectionStart = 0;
    inputEl.selectionEnd = 0;
    inputEl.scrollLeft = 0;
    return { selectionStart: 0, selectionEnd: 0, scrollLeft: 0 };
  }
  if (caretPosition === "end") {
    inputEl.setSelectionRange?.(len, len, "none");
    inputEl.selectionStart = len;
    inputEl.selectionEnd = len;
    return { selectionStart: len, selectionEnd: len, scrollLeft: len };
  }
  inputEl.select?.();
  inputEl.setSelectionRange?.(0, len, "forward");
  inputEl.selectionStart = 0;
  inputEl.selectionEnd = len;
  return { selectionStart: 0, selectionEnd: len, scrollLeft: 0 };
}

export function syncSidebarDropPreferences(
  enabled: boolean,
  defaultBehavior: SidebarDropBehavior = "open-or-create",
): void {
  if (Platform.OS !== "web") return;
  const storage = getWebWindow()?.localStorage;
  if (!storage) return;
  try {
    storage.setItem(
      SIDEBAR_DROP_STORAGE_KEY,
      JSON.stringify({ enabled, defaultBehavior }),
    );
  } catch {
    // Ignore storage write errors
  }
}

export function readSidebarDropPreferences(storage?: MinimalStorage | null): {
  enabled: boolean;
  defaultBehavior: SidebarDropBehavior;
} {
  if (!storage) {
    return { enabled: true, defaultBehavior: "open-or-create" };
  }
  try {
    const raw = storage.getItem(SIDEBAR_DROP_STORAGE_KEY);
    if (!raw) return { enabled: true, defaultBehavior: "open-or-create" };
    const parsed = JSON.parse(raw) as {
      enabled?: unknown;
      defaultBehavior?: unknown;
    };
    return {
      enabled: parsed.enabled !== false,
      defaultBehavior:
        parsed.defaultBehavior === "always-create" ? "always-create" : "open-or-create",
    };
  } catch {
    return { enabled: true, defaultBehavior: "open-or-create" };
  }
}

export function syncImagePanelAssociations(
  pluginId: string,
  panelId: string,
  enabled: boolean,
): void {
  if (Platform.OS !== "web" || !enabled) return;
  const win = getWebWindow();
  const storage = win?.localStorage;
  if (!storage) return;

  const targetId = `plugin:${pluginId}/${panelId}`;
  const candidateKeys = ["@paseo:app-settings", "@paseo:settings", "paseo:app-settings"];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.includes("settings") && !candidateKeys.includes(k)) {
        candidateKeys.push(k);
      }
    }
    for (const key of candidateKeys) {
      const raw = storage.getItem(key);
      if (!raw) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;
      const assoc =
        parsed.filePanelAssociations && typeof parsed.filePanelAssociations === "object"
          ? { ...(parsed.filePanelAssociations as Record<string, string>) }
          : {};
      let changed = false;
      for (const ext of SUPPORTED_IMAGE_EXTENSIONS) {
        const selectorKey = `ext:${ext}`;
        if (!assoc[selectorKey]) {
          assoc[selectorKey] = targetId;
          changed = true;
        }
      }
      if (changed) {
        parsed.filePanelAssociations = assoc;
        storage.setItem(key, JSON.stringify(parsed));
      }
    }
  } catch {
    // Non-fatal if storage is locked
  }
}

export const FILE_PATH_TOKEN_REGEX =
  /(?:\/(?:Users|home|var|tmp|opt|etc)\/[^\s"'`<>()]+|[A-Za-z]:\\[^\s"'`<>()]+|~\/[^\s"'`<>()]+|(?:\.?\.)?\/[^\s"'`<>()]+|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?:\.[A-Za-z0-9]{1,8}|\/)?|[A-Za-z0-9_-]{2,}\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico|avif|heic|tif|tiff|pdf|md|json|ts|tsx|py|html|css|mp4|mov|jsx|mjs|cjs|sh|zsh|yaml|yml|toml|sql))/i;

export function cleanExtractedFilePath(raw: string): string {
  let val = raw.trim();
  val = val.replace(/^[`"'\s(\[]+/, "").replace(/[`"'\s)\]]+$/, "");
  val = val.replace(/[,:;!?\u3002\uff0c\u3001\uff1b\uff1a]+$/, "");
  return val.trim();
}

export function decodeTabCloseTestId(testId: string): string | null {
  const prefix = "workspace-file-close-";
  if (!testId.startsWith(prefix)) return null;
  const encoded = testId.slice(prefix.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export function isInsideWorkspaceTab(el: MinimalElement | null): boolean {
  let curr: MinimalElement | null = el;
  for (let depth = 0; curr && depth < 10; depth += 1) {
    const testId = curr.getAttribute?.("data-testid") ?? "";
    if (
      (testId.startsWith("workspace-tab-") && !testId.startsWith("workspace-tab-context-")) ||
      testId.startsWith("workspace-file-close-")
    ) {
      return true;
    }
    curr = curr.parentElement ?? null;
  }
  return false;
}

export function isInsideFileExplorer(el: MinimalElement | null): boolean {
  let curr: MinimalElement | null = el;
  for (let depth = 0; curr && depth < 10; depth += 1) {
    const testId = curr.getAttribute?.("data-testid") ?? "";
    if (testId.startsWith("file-explorer-") || testId.startsWith("workspace-tab-context-")) {
      return true;
    }
    curr = curr.parentElement ?? null;
  }
  return false;
}

export function isEditableInput(el: MinimalElement | null): boolean {
  let curr: MinimalElement | null = el;
  for (let depth = 0; curr && depth < 6; depth += 1) {
    const tag = (curr.tagName ?? "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    if (curr.getAttribute?.("contenteditable") === "true") return true;
    curr = curr.parentElement ?? null;
  }
  return false;
}

export function isInsideWorkspaceHeaderTitle(el: MinimalElement | null): boolean {
  let curr: MinimalElement | null = el;
  for (let depth = 0; curr && depth < 8; depth += 1) {
    const testId = curr.getAttribute?.("data-testid") ?? "";
    if (testId === "workspace-header-title") {
      return true;
    }
    curr = curr.parentElement ?? null;
  }
  return false;
}

export function parseSidebarWorkspaceRowTestId(testId: string): {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
} | null {
  const prefix = "sidebar-workspace-row-";
  if (!testId.startsWith(prefix)) return null;
  const workspaceKey = testId.slice(prefix.length).trim();
  if (!workspaceKey) return null;
  const colonIdx = workspaceKey.lastIndexOf(":");
  if (colonIdx > 0) {
    const serverId = workspaceKey.slice(0, colonIdx);
    const workspaceId = workspaceKey.slice(colonIdx + 1);
    if (!workspaceId) return null;
    return { workspaceKey, serverId, workspaceId };
  }
  return { workspaceKey, serverId: "local", workspaceId: workspaceKey };
}

export function resolveCurrentActiveWorkspaceId(
  doc: MinimalDocument,
  win?: MinimalWindow | null,
  fallbackWorkspaceId?: string,
): string | undefined {
  const pathname = win?.location?.pathname ?? "";
  const routeMatch = pathname.match(/\/workspace\/([^/?#]+)/);
  if (routeMatch?.[1]) {
    try {
      return decodeURIComponent(routeMatch[1]);
    } catch {
      return routeMatch[1];
    }
  }
  const selectedRow = doc.querySelector(
    '[data-testid^="sidebar-workspace-row-"][aria-selected="true"]',
  );
  const selectedTid = selectedRow?.getAttribute?.("data-testid") ?? "";
  const parsed = parseSidebarWorkspaceRowTestId(selectedTid);
  if (parsed?.workspaceId) {
    return parsed.workspaceId;
  }
  return fallbackWorkspaceId;
}

export function isInsideInteractiveRowAction(el: MinimalElement | null): boolean {
  let curr: MinimalElement | null = el;
  for (let depth = 0; curr && depth < 8; depth += 1) {
    const testId = curr.getAttribute?.("data-testid") ?? "";
    if (
      testId.startsWith("sidebar-workspace-kebab-") ||
      testId.startsWith("sidebar-workspace-archive-") ||
      testId.startsWith("sidebar-workspace-menu-") ||
      testId.startsWith("workspace-tab-close-") ||
      testId.startsWith("workspace-file-close-") ||
      testId.startsWith("workspace-header-menu") ||
      testId === "paseo-finder-inline-rename-input"
    ) {
      return true;
    }
    const role = curr.getAttribute?.("role") ?? "";
    if (role === "menuitem" || role === "link") {
      return true;
    }
    if (
      curr.getAttribute?.("aria-haspopup") === "menu" &&
      !testId.startsWith("sidebar-workspace-row-") &&
      !testId.startsWith("workspace-tab-")
    ) {
      return true;
    }
    curr = curr.parentElement ?? null;
  }
  return false;
}

export interface InlineRenameTarget {
  targetKey: string;
  surface: "sidebar-row" | "header-title" | "agent-tab";
  source: InlineRenameSource;
  workspaceId?: string;
  agentId?: string;
  serverId?: string;
  titleEl: MinimalElement;
  rowEl?: MinimalElement;
  initialTitle: string;
}

function findFirstTextLeafElement(root: MinimalElement): MinimalElement | null {
  const children = root.children;
  if (!children || children.length === 0) {
    return (root.textContent ?? "").trim().length > 0 ? root : null;
  }
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (!child) continue;
    const tag = (child.tagName ?? "").toUpperCase();
    if (tag === "SVG" || tag === "PATH" || tag === "IMG" || tag === "INPUT") {
      continue;
    }
    const tid = child.getAttribute?.("data-testid") ?? "";
    if (
      tid.startsWith("workspace-tab-modified-") ||
      tid.startsWith("workspace-tab-close-") ||
      tid.startsWith("workspace-status-indicator-") ||
      tid.startsWith("sidebar-row-project-icon-") ||
      tid.startsWith("sidebar-workspace-kebab-") ||
      tid.startsWith("sidebar-workspace-archive-") ||
      tid === "sidebar-workspace-trailing-scrim"
    ) {
      continue;
    }
    if (child.getAttribute?.("pointer-events") === "none") {
      continue;
    }
    const subChildren = child.children;
    if ((!subChildren || subChildren.length === 0) && (child.textContent ?? "").trim().length > 0) {
      return child;
    }
    const nested = findFirstTextLeafElement(child);
    if (nested) return nested;
  }
  return null;
}

export function findSidebarRowTitleElement(
  rowEl: MinimalElement,
  workspaceKey: string,
): MinimalElement | null {
  const explicit =
    rowEl.querySelector?.(`[data-testid="sidebar-workspace-title-${workspaceKey}"]`) ??
    rowEl.querySelector?.('[data-testid^="sidebar-workspace-title-"]');
  if (explicit) {
    return explicit;
  }
  return findFirstTextLeafElement(rowEl);
}

export function resolveInlineRenameTarget(
  el: MinimalElement | null,
  doc: MinimalDocument,
  win?: MinimalWindow | null,
  fallbackWorkspaceId?: string,
): InlineRenameTarget | null {
  if (!el || isEditableInput(el) || isInsideInteractiveRowAction(el)) {
    return null;
  }

  let curr: MinimalElement | null = el;
  for (let depth = 0; curr && depth < 12; depth += 1) {
    const testId = curr.getAttribute?.("data-testid") ?? "";

    // 1. Left Sidebar Workspace Row (`sidebar-workspace-row-${serverId}:${workspaceId}`)
    if (testId.startsWith("sidebar-workspace-row-")) {
      const parsed = parseSidebarWorkspaceRowTestId(testId);
      if (!parsed) return null;
      const titleEl = findSidebarRowTitleElement(curr, parsed.workspaceKey);
      if (!titleEl || !titleEl.parentElement) return null;
      return {
        targetKey: `sidebar-row:${parsed.workspaceKey}`,
        surface: "sidebar-row",
        source: "inline-sidebar",
        workspaceId: parsed.workspaceId,
        serverId: parsed.serverId,
        titleEl,
        rowEl: curr,
        initialTitle: (titleEl.textContent ?? "").trim(),
      };
    }

    // 2. Top Workspace Header Title (`workspace-header-title`)
    if (testId === "workspace-header-title") {
      if (!curr.parentElement) return null;
      const workspaceId = resolveCurrentActiveWorkspaceId(doc, win, fallbackWorkspaceId);
      if (!workspaceId) return null;
      return {
        targetKey: `header-title:${workspaceId}`,
        surface: "header-title",
        source: "inline-header",
        workspaceId,
        titleEl: curr,
        initialTitle: (curr.textContent ?? "").trim(),
      };
    }

    // 3. Workspace Agent Tab (`workspace-tab-agent_${agentId}`)
    if (
      testId.startsWith("workspace-tab-agent_") &&
      !testId.startsWith("workspace-tab-context-") &&
      !testId.startsWith("workspace-tab-menu-") &&
      !testId.startsWith("workspace-tab-tooltip-") &&
      !testId.startsWith("workspace-tab-modified-") &&
      !testId.startsWith("workspace-tab-close-")
    ) {
      const agentId = testId.slice("workspace-tab-agent_".length).trim();
      if (!agentId) return null;
      const titleEl = findFirstTextLeafElement(curr);
      if (!titleEl || !titleEl.parentElement) return null;
      return {
        targetKey: `agent-tab:${agentId}`,
        surface: "agent-tab",
        source: "inline-tab",
        workspaceId: resolveCurrentActiveWorkspaceId(doc, win, fallbackWorkspaceId),
        agentId,
        titleEl,
        rowEl: curr,
        initialTitle: (titleEl.textContent ?? "").trim(),
      };
    }

    curr = curr.parentElement ?? null;
  }

  return null;
}

export function resolveLiveInlineRenameTargetByKey(
  targetKey: string,
  doc: MinimalDocument,
  win?: MinimalWindow | null,
  fallbackWorkspaceId?: string,
): InlineRenameTarget | null {
  if (targetKey.startsWith("sidebar-row:")) {
    const workspaceKey = targetKey.slice("sidebar-row:".length);
    const rowEl = doc.querySelector(`[data-testid="sidebar-workspace-row-${workspaceKey}"]`);
    return resolveInlineRenameTarget(rowEl, doc, win, fallbackWorkspaceId);
  }
  if (targetKey.startsWith("header-title:")) {
    const headerEl = doc.querySelector('[data-testid="workspace-header-title"]');
    return resolveInlineRenameTarget(headerEl, doc, win, fallbackWorkspaceId);
  }
  if (targetKey.startsWith("agent-tab:")) {
    const agentId = targetKey.slice("agent-tab:".length);
    const tabEl = doc.querySelector(`[data-testid="workspace-tab-agent_${agentId}"]`);
    return resolveInlineRenameTarget(tabEl, doc, win, fallbackWorkspaceId);
  }
  return null;
}

export function findF2InlineRenameTarget(
  doc: MinimalDocument,
  win?: MinimalWindow | null,
  fallbackWorkspaceId?: string,
): InlineRenameTarget | null {
  const selectedRow = doc.querySelector(
    '[data-testid^="sidebar-workspace-row-"][aria-selected="true"]',
  );
  if (selectedRow) {
    const rect = selectedRow.getBoundingClientRect?.();
    if (!rect || (rect.width > 20 && rect.height > 10)) {
      const resolved = resolveInlineRenameTarget(selectedRow, doc, win, fallbackWorkspaceId);
      if (resolved) {
        return { ...resolved, source: "f2-inline" };
      }
    }
  }

  const activeWsId = resolveCurrentActiveWorkspaceId(doc, win, fallbackWorkspaceId);
  if (activeWsId) {
    const rows = doc.querySelectorAll('[data-testid^="sidebar-workspace-row-"]');
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row) continue;
      const tid = row.getAttribute?.("data-testid") ?? "";
      const parsed = parseSidebarWorkspaceRowTestId(tid);
      if (parsed?.workspaceId === activeWsId) {
        const rect = row.getBoundingClientRect?.();
        if (!rect || (rect.width > 20 && rect.height > 10)) {
          const resolved = resolveInlineRenameTarget(row, doc, win, fallbackWorkspaceId);
          if (resolved) {
            return { ...resolved, source: "f2-inline" };
          }
        }
      }
    }
  }

  const headerTitle = doc.querySelector('[data-testid="workspace-header-title"]');
  if (headerTitle) {
    const rect = headerTitle.getBoundingClientRect?.();
    if (!rect || (rect.width > 20 && rect.height > 10)) {
      const resolved = resolveInlineRenameTarget(headerTitle, doc, win, fallbackWorkspaceId);
      if (resolved) {
        return { ...resolved, source: "f2-inline" };
      }
    }
  }

  return null;
}

export interface ActiveInlineRenameSession {
  inputEl: MinimalElement;
  target: InlineRenameTarget;
  commit(): Promise<void>;
  cancel(): void;
  markOutsidePointerDown(): void;
}

function ensureInlineRenameStyleTag(doc: MinimalDocument, win?: MinimalWindow | null): void {
  syncPaseoThemeCssVariables(doc, win);
  const cssContent = `
[data-paseo-inline-rename-hidden="true"] {
  display: none !important;
}
input[data-testid="paseo-finder-inline-rename-input"] {
  box-sizing: border-box;
  margin: 0 0 0 -3px;
  padding: 0 4px;
  border-radius: 4px;
  border: 1px solid var(--paseo-finder-running, #268ae0);
  background-color: var(--paseo-finder-surface-0, #ffffff);
  color: var(--paseo-finder-fg, inherit);
  outline: none;
  min-width: 56px;
  width: 100%;
  flex: 1 1 auto;
}
input[data-testid="paseo-finder-inline-rename-input"]::selection {
  background-color: rgba(38, 138, 224, 0.24);
}
[data-paseo-inline-rename-row="true"] [data-testid="sidebar-workspace-trailing-scrim"],
[data-paseo-inline-rename-row="true"] [data-testid^="sidebar-workspace-kebab-"],
[data-paseo-inline-rename-row="true"] [data-testid^="sidebar-workspace-archive-"] {
  opacity: 0 !important;
  pointer-events: none !important;
}
input[data-testid="paseo-finder-quick-jump-input"]::placeholder {
  color: var(--paseo-finder-fg-muted, #71717a);
}
@keyframes paseoFinderSidebarArrivalPulse {
  0% {
    box-shadow: inset 2px 0 0 0 var(--paseo-finder-running, #268ae0);
  }
  100% {
    box-shadow: inset 2px 0 0 0 transparent;
  }
}
[data-paseo-workspace-jump-flash="true"],
[data-paseo-project-jump-flash="true"] {
  animation: paseoFinderSidebarArrivalPulse 1.1s ease-out forwards;
  outline: none !important;
}
[data-testid^="sidebar-workspace-row-"]:focus,
[data-testid^="sidebar-workspace-row-"]:focus-visible,
[data-testid^="sidebar-project-row-"]:focus,
[data-testid^="sidebar-project-row-"]:focus-visible {
  outline: none !important;
}
`;
  const existing = doc.querySelector('style[data-paseo-finder-inline-rename-style="true"]');
  if (existing) {
    if (!(existing.textContent ?? "").includes("paseoFinderSidebarArrivalPulse")) {
      existing.textContent = cssContent;
    }
    return;
  }
  const host = doc.head ?? doc.documentElement ?? doc.body;
  if (!host?.appendChild) return;
  const styleEl = doc.createElement("style");
  styleEl.setAttribute?.("data-paseo-finder-inline-rename-style", "true");
  styleEl.textContent = cssContent;
  host.appendChild(styleEl);
}

export function mountInlineTitleInput(
  doc: MinimalDocument,
  win: MinimalWindow | null,
  target: InlineRenameTarget,
  onCommit: (
    nextTitle: string | null,
    meta: { workspaceId?: string; agentId?: string; source: InlineRenameSource },
  ) => Promise<void>,
  onDisposed?: () => void,
  options?: { caretPosition?: InlineRenameCaretPosition },
): ActiveInlineRenameSession | null {
  const parent = target.titleEl.parentElement;
  if (!parent || (!parent.insertBefore && !parent.appendChild)) {
    return null;
  }

  ensureInlineRenameStyleTag(doc, win);

  const effectiveCaretPosition: InlineRenameCaretPosition =
    options?.caretPosition ??
    readInlineRenamePreferences(win?.localStorage).inlineRenameCaretPosition;

  const computed = win?.getComputedStyle?.(target.titleEl) ?? null;
  const inputEl = doc.createElement("input");
  inputEl.type = "text";
  inputEl.value = target.initialTitle;
  inputEl.placeholder = target.initialTitle || "Workspace title";
  inputEl.setAttribute?.("data-testid", "paseo-finder-inline-rename-input");
  inputEl.setAttribute?.("data-rename-surface", target.surface);
  inputEl.setAttribute?.("data-caret-mode", effectiveCaretPosition);
  if (target.workspaceId) {
    inputEl.setAttribute?.("data-workspace-id", target.workspaceId);
  }
  if (target.agentId) {
    inputEl.setAttribute?.("data-agent-id", target.agentId);
  }
  inputEl.setAttribute?.("aria-label", "Rename inline");

  if (inputEl.style) {
    inputEl.style.color = computed?.color || "inherit";
    inputEl.style.fontSize = computed?.fontSize || (target.surface === "header-title" ? "15px" : "14px");
    inputEl.style.fontWeight = computed?.fontWeight || "500";
    inputEl.style.fontFamily =
      computed?.fontFamily ||
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    inputEl.style.lineHeight = computed?.lineHeight || "20px";
    if (computed?.letterSpacing) {
      inputEl.style.letterSpacing = computed.letterSpacing;
    }
    inputEl.style.height = computed?.lineHeight && computed.lineHeight.endsWith("px")
      ? computed.lineHeight
      : target.surface === "header-title"
        ? "24px"
        : "20px";
  }

  target.titleEl.setAttribute?.("data-paseo-inline-rename-hidden", "true");
  if (target.rowEl) {
    target.rowEl.setAttribute?.("data-paseo-inline-rename-row", "true");
  }

  if (parent.insertBefore) {
    parent.insertBefore(inputEl, target.titleEl.nextSibling ?? null);
  } else {
    parent.appendChild?.(inputEl);
  }

  const mountedAt = Date.now();
  let settled = false;
  let outsidePointerDown = false;
  let userAdjustedSelection = false;
  let lastKnownSelStart =
    effectiveCaretPosition === "end" ? target.initialTitle.length : 0;
  let lastKnownSelEnd =
    effectiveCaretPosition === "select-all"
      ? target.initialTitle.length
      : effectiveCaretPosition === "end"
        ? target.initialTitle.length
        : 0;

  const cleanupDom = () => {
    if (target.titleEl.removeAttribute) {
      target.titleEl.removeAttribute("data-paseo-inline-rename-hidden");
    } else {
      target.titleEl.setAttribute?.("data-paseo-inline-rename-hidden", "false");
    }
    if (target.rowEl) {
      if (target.rowEl.removeAttribute) {
        target.rowEl.removeAttribute("data-paseo-inline-rename-row");
      } else {
        target.rowEl.setAttribute?.("data-paseo-inline-rename-row", "false");
      }
    }
    inputEl.remove?.();
    onDisposed?.();
  };

  const cancel = () => {
    if (settled) return;
    settled = true;
    cleanupDom();
  };

  const commitFromTrigger = async (trigger: "enter" | "blur") => {
    if (settled) return;
    const rawVal = (inputEl.value ?? "").trim();

    // Unchanged value or accidental empty blur -> cancel cleanly with 0 network RPCs
    if (rawVal === target.initialTitle || (trigger === "blur" && rawVal.length === 0)) {
      settled = true;
      cleanupDom();
      return;
    }

    // On explicit Enter with empty string (or 'clear'/'reset') for a workspace, reset custom title (null).
    // For an agent tab, empty Enter cancels since agents always keep a display name.
    const normalizedNext: string | null =
      rawVal.length === 0 ||
      rawVal.toLowerCase() === "clear" ||
      rawVal.toLowerCase() === "reset"
        ? null
        : rawVal;

    if (normalizedNext === null && target.agentId && target.surface === "agent-tab") {
      settled = true;
      cleanupDom();
      return;
    }

    settled = true;
    inputEl.readOnly = true;
    if (inputEl.style) {
      inputEl.style.opacity = "0.85";
    }
    if (normalizedNext) {
      target.titleEl.textContent = normalizedNext;
    }

    try {
      await Promise.race([
        onCommit(normalizedNext, {
          workspaceId: target.workspaceId,
          agentId: target.surface === "agent-tab" ? target.agentId : undefined,
          source: target.source,
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 400)),
      ]);
    } finally {
      if (win?.requestAnimationFrame) {
        win.requestAnimationFrame(() => cleanupDom());
      } else {
        cleanupDom();
      }
    }
  };

  const stopBubble = (ev: unknown) => {
    const e = ev as { stopPropagation?: () => void };
    e.stopPropagation?.();
  };

  for (const evtName of [
    "click",
    "dblclick",
    "mousedown",
    "mouseup",
    "pointerdown",
    "pointerup",
  ]) {
    inputEl.addEventListener?.(evtName, (ev) => {
      stopBubble(ev);
      if (evtName === "mousedown" || evtName === "pointerdown" || evtName === "mouseup") {
        userAdjustedSelection = true;
        if (typeof inputEl.selectionStart === "number") {
          lastKnownSelStart = inputEl.selectionStart;
        }
        if (typeof inputEl.selectionEnd === "number") {
          lastKnownSelEnd = inputEl.selectionEnd;
        }
      }
    });
  }

  inputEl.addEventListener?.("keydown", (ev) => {
    const ke = ev as MinimalKeyboardEvent;
    ke.stopPropagation?.();
    if (ke.isComposing || ke.keyCode === 229) {
      userAdjustedSelection = true;
      return;
    }
    if (ke.key === "Enter") {
      ke.preventDefault();
      void commitFromTrigger("enter");
    } else if (ke.key === "Escape") {
      ke.preventDefault();
      cancel();
    } else {
      userAdjustedSelection = true;
    }
  });

  inputEl.addEventListener?.("blur", () => {
    if (settled) return;
    // Shield against Paseo's WorkspaceScreen composer auto-focus stealing focus (~30-1200ms
    // after Click 1 of a double-click navigates to an unselected sidebar workspace row),
    // while strictly preserving the first-place (0, 0) caret or any user manual selection!
    if (!outsidePointerDown && Date.now() - mountedAt < 1200) {
      if (userAdjustedSelection) {
        const s = typeof inputEl.selectionStart === "number" ? inputEl.selectionStart : lastKnownSelStart;
        const e = typeof inputEl.selectionEnd === "number" ? inputEl.selectionEnd : lastKnownSelEnd;
        inputEl.focus?.();
        inputEl.setSelectionRange?.(s, e);
      } else {
        applyInlineInputCaret(inputEl, effectiveCaretPosition);
      }
      return;
    }
    void commitFromTrigger("blur");
  });

  win?.getSelection?.()?.removeAllRanges?.();
  applyInlineInputCaret(inputEl, effectiveCaretPosition);
  win?.requestAnimationFrame?.(() => {
    if (!settled && !userAdjustedSelection) {
      applyInlineInputCaret(inputEl, effectiveCaretPosition);
    }
  });

  return {
    inputEl,
    target,
    commit: () => commitFromTrigger("enter"),
    cancel,
    markOutsidePointerDown: () => {
      outsidePointerDown = true;
    },
  };
}

export function extractFilePathFromElement(
  el: MinimalElement | null,
  doc: MinimalDocument,
): string | null {
  let curr: MinimalElement | null = el;
  for (let depth = 0; curr && depth < 8; depth += 1) {
    const testId = curr.getAttribute?.("data-testid") ?? "";
    const fromClose = decodeTabCloseTestId(testId);
    if (fromClose) return fromClose;

    if (testId.startsWith("workspace-tab-file_")) {
      const fromTabId = testId.slice("workspace-tab-file_".length);
      if (fromTabId) return fromTabId;
    }

    const childClose = curr.querySelector?.('[data-testid^="workspace-file-close-"]');
    if (childClose) {
      const childId = childClose.getAttribute?.("data-testid") ?? "";
      const decoded = decodeTabCloseTestId(childId);
      if (decoded) return decoded;
    }

    const dataPath =
      curr.getAttribute?.("data-path") ?? curr.getAttribute?.("data-file-path") ?? "";
    if (dataPath) {
      return cleanExtractedFilePath(dataPath);
    }

    const href = curr.getAttribute?.("href") ?? "";
    if (href && !href.startsWith("http://") && !href.startsWith("https://")) {
      return cleanExtractedFilePath(href);
    }

    const text = (curr.textContent ?? "").trim();
    if (text && text.length < 260) {
      const match = text.match(FILE_PATH_TOKEN_REGEX);
      if (match) {
        const cleaned = cleanExtractedFilePath(match[0]);
        const tooltips = doc.querySelectorAll('[data-testid*="tooltip"]');
        for (let i = 0; i < tooltips.length; i += 1) {
          const tipText = (tooltips[i]?.textContent ?? "").trim();
          if (tipText && tipText.includes(cleaned) && tipText.includes("/")) {
            const tipMatch = tipText.match(FILE_PATH_TOKEN_REGEX);
            if (tipMatch) return cleanExtractedFilePath(tipMatch[0]);
          }
        }
        return cleaned;
      }
    }
    curr = curr.parentElement ?? null;
  }
  return null;
}

export function extractFilePathFromCopyMenuItem(
  copyItem: MinimalElement,
  doc: MinimalDocument,
  fallbackPath?: string | null,
): string | null {
  const testId = copyItem.getAttribute?.("data-testid") ?? "";
  const prefix = "workspace-tab-context-";
  const suffix = "-copy-file-path";
  if (testId.startsWith(prefix) && testId.endsWith(suffix)) {
    const tabId = testId.slice(prefix.length, testId.length - suffix.length);
    if (tabId.startsWith("file_")) {
      const directPath = tabId.slice("file_".length);
      if (directPath) return directPath;
    }
    const tabEl = doc.querySelector(`[data-testid="workspace-tab-${tabId}"]`);
    if (tabEl) {
      const closeBtn = tabEl.querySelector?.('[data-testid^="workspace-file-close-"]');
      if (closeBtn) {
        const closeId = closeBtn.getAttribute?.("data-testid") ?? "";
        const decoded = decodeTabCloseTestId(closeId);
        if (decoded) return decoded;
      }
    }
  }
  return fallbackPath ?? findActiveFileTabPath(doc);
}

export function findActiveFileTabPath(doc: MinimalDocument): string | null {
  const closeBtns = doc.querySelectorAll('[data-testid^="workspace-file-close-"]');
  for (let i = 0; i < closeBtns.length; i += 1) {
    const btn = closeBtns[i];
    const tabContainer = btn?.closest?.('[aria-selected="true"]');
    if (tabContainer) {
      const id = btn?.getAttribute?.("data-testid") ?? "";
      const decoded = decodeTabCloseTestId(id);
      if (decoded) return decoded;
    }
  }
  if (closeBtns.length > 0) {
    const id = closeBtns[0]?.getAttribute?.("data-testid") ?? "";
    return decodeTabCloseTestId(id);
  }
  return null;
}

export interface ThreadMetadataSnapshot {
  workspaceId: string;
  workspaceTitle: string;
  assignedLabels: string[];
  catalog: Array<{ name: string; color: WorkspaceLabelColor }>;
}

export interface FolderDropResultSummary {
  ok: boolean;
  primaryWorkspaceId: string;
  primaryProjectId: string | null;
  primaryWorkspaceName: string;
  createdCount: number;
  reusedCount: number;
  message: string;
}

export interface RenameThreadOptions {
  workspaceId?: string;
  agentId?: string;
  source?: InlineRenameSource;
}

export interface QuickJumpExecutionSummary {
  ok: boolean;
  jumpMode: QuickJumpAction;
  targetWorkspaceId: string | null;
  targetProjectId: string | null;
  targetProjectKey: string | null;
  targetProjectName: string | null;
  message: string;
}

export interface DesktopRevealHelperCallbacks {
  isEnabled(): boolean;
  getLocale?(): string;
  getFallbackWorkspaceId?(): string | undefined;
  onOpenTarget(
    path: string,
    target: OpenerTarget,
    explicitWorkspaceId?: string,
    projectNameHint?: string,
  ): Promise<void>;
  onCopyPath(path: string): Promise<void>;
  onFetchThreadMetadata?(workspaceId?: string): Promise<ThreadMetadataSnapshot | null>;
  onRenameThread?(newTitle: string | null, options?: RenameThreadOptions): Promise<void>;
  onToggleLabel?(
    labelName: string,
    color?: WorkspaceLabelColor,
    workspaceId?: string,
  ): Promise<ThreadMetadataSnapshot | null>;
  onDropFolders?(
    paths: string[],
    options: { forceNew: boolean },
  ): Promise<FolderDropResultSummary | null>;
  onListJumpProjects?(query?: string): Promise<ProjectJumpCandidate[]>;
  onResolveWorkspaceProject?(
    workspaceId: string,
  ):
    | {
        projectId?: string | null;
        projectKey?: string | null;
        projectName?: string | null;
      }
    | null
    | Promise<{
        projectId?: string | null;
        projectKey?: string | null;
        projectName?: string | null;
      } | null>;
  onExecuteQuickJump?(input: {
    projectId?: string;
    query?: string;
    jumpMode?: QuickJumpAction;
    source?: "quick-switcher";
  }): Promise<QuickJumpExecutionSummary | null>;
  onHealAgentHistory?(workspaceId?: string): Promise<{ ok: boolean; message: string } | null>;
}

const PASEO_INTERNAL_FILE_DRAG_MIME = "application/x-paseo-workspace-file";

export function findLeftSidebarContainer(
  doc: MinimalDocument,
  target?: MinimalElement | null,
): MinimalElement | null {
  let curr: MinimalElement | null = target ?? null;
  for (let depth = 0; curr && depth < 12; depth += 1) {
    const testId = curr.getAttribute?.("data-testid") ?? "";
    if (testId === "open-project-submit") {
      return curr;
    }
    curr = curr.parentElement ?? null;
  }
  const footer = doc.querySelector('[data-testid="sidebar-footer"]');
  if (footer?.parentElement) {
    return footer.parentElement;
  }
  return doc.querySelector('[data-testid="sidebar-project-list"]');
}

export function isInsideComposerOrTerminal(el: MinimalElement | null): boolean {
  let curr: MinimalElement | null = el;
  for (let depth = 0; curr && depth < 14; depth += 1) {
    const testId = (curr.getAttribute?.("data-testid") ?? "").toLowerCase();
    const cls = (curr.className ?? "").toLowerCase();
    if (
      testId.includes("composer") ||
      testId.includes("terminal") ||
      cls.includes("xterm")
    ) {
      return true;
    }
    curr = curr.parentElement ?? null;
  }
  return false;
}

export function isInsideSidebarDropZone(
  el: MinimalElement | null,
  doc: MinimalDocument,
): boolean {
  if (!el) return false;
  if (
    isInsideWorkspaceTab(el) ||
    isInsideFileExplorer(el) ||
    isInsideComposerOrTerminal(el)
  ) {
    return false;
  }

  let curr: MinimalElement | null = el;
  for (let depth = 0; curr && depth < 16; depth += 1) {
    const testId = curr.getAttribute?.("data-testid") ?? "";
    if (
      testId.startsWith("sidebar-") ||
      testId === "left-sidebar-resize-handle" ||
      testId === "open-project-submit" ||
      testId.startsWith("open-project-")
    ) {
      return true;
    }
    curr = curr.parentElement ?? null;
  }

  const sidebarRoot = findLeftSidebarContainer(doc);
  if (sidebarRoot?.contains?.(el)) {
    return true;
  }
  return false;
}

export function isExternalFileDragEvent(ev: MinimalDragEvent): boolean {
  const rawTypes = ev.dataTransfer?.types;
  if (!rawTypes) return false;
  let hasFiles = false;
  let hasFileUri = false;
  for (let i = 0; i < rawTypes.length; i += 1) {
    const t = rawTypes[i];
    if (t === PASEO_INTERNAL_FILE_DRAG_MIME) {
      return false;
    }
    if (t === "Files") {
      hasFiles = true;
    }
    if (t === "text/uri-list") {
      hasFileUri = true;
    }
  }
  return hasFiles || hasFileUri;
}

function parseFileUriLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (trimmed.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return trimmed.slice("file://".length);
    }
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("~/")) {
    return trimmed;
  }
  return null;
}

export function extractDroppedFilePaths(
  ev: MinimalDragEvent,
  win?: MinimalWindow | null,
): string[] {
  const results: string[] = [];
  const pushUnique = (p?: string | null) => {
    const cleaned = (p ?? "").trim();
    if (cleaned && !results.includes(cleaned)) {
      results.push(cleaned);
    }
  };

  const files = ev.dataTransfer?.files;
  if (files) {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (!file) continue;
      let resolved = "";
      try {
        resolved = win?.paseoDesktop?.webUtils?.getPathForFile?.(file) ?? "";
      } catch {
        resolved = "";
      }
      if (!resolved && typeof file.path === "string") {
        resolved = file.path;
      }
      pushUnique(resolved);
    }
  }

  if (results.length === 0 && ev.dataTransfer?.getData) {
    for (const mime of ["text/uri-list", "text/plain"]) {
      let raw = "";
      try {
        raw = ev.dataTransfer.getData(mime) ?? "";
      } catch {
        raw = "";
      }
      if (!raw) continue;
      for (const line of raw.split(/\r?\n/)) {
        pushUnique(parseFileUriLine(line));
      }
      if (results.length > 0) break;
    }
  }

  return results;
}

function inferActiveServerId(doc: MinimalDocument, win?: MinimalWindow | null): string {
  const pathname = win?.location?.pathname ?? "";
  const routeMatch = pathname.match(/^\/h\/([^/]+)(?:\/|$)/);
  if (routeMatch?.[1]) {
    try {
      return decodeURIComponent(routeMatch[1]);
    } catch {
      return routeMatch[1];
    }
  }
  const sampleRow =
    doc.querySelector('[data-testid^="sidebar-workspace-row-"]') ??
    doc.querySelector('[data-testid^="sidebar-project-row-"]');
  const testId = sampleRow?.getAttribute?.("data-testid") ?? "";
  const rawKey = testId
    .replace(/^sidebar-workspace-row-/, "")
    .replace(/^sidebar-project-row-/, "");
  const colonIdx = rawKey.indexOf(":");
  if (colonIdx > 0) {
    return rawKey.slice(0, colonIdx);
  }
  return "local";
}

const activeSidebarFlashTimers = new Set<ReturnType<typeof setTimeout>>();

export function clearSidebarJumpFlashes(doc?: MinimalDocument | null): number {
  for (const timer of activeSidebarFlashTimers) {
    clearTimeout(timer);
  }
  activeSidebarFlashTimers.clear();
  if (!doc) return 0;

  let clearedCount = 0;
  const cleanupRows = (rows: MinimalElement[] | ArrayLike<MinimalElement>) => {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row) continue;
      const hadWsFlash = row.getAttribute?.("data-paseo-workspace-jump-flash") === "true";
      const hadProjFlash = row.getAttribute?.("data-paseo-project-jump-flash") === "true";
      const hadInlineStyle = Boolean(
        row.style &&
          (row.style.backgroundColor || row.style.outline || row.style.boxShadow),
      );
      if (hadWsFlash) {
        row.removeAttribute?.("data-paseo-workspace-jump-flash");
      }
      if (hadProjFlash) {
        row.removeAttribute?.("data-paseo-project-jump-flash");
      }
      if (row.style) {
        if (row.style.backgroundColor) row.style.backgroundColor = "";
        if (row.style.outline) row.style.outline = "";
        if (row.style.boxShadow) row.style.boxShadow = "";
      }
      if (hadWsFlash || hadProjFlash || hadInlineStyle) {
        clearedCount += 1;
      }
    }
  };

  cleanupRows(doc.querySelectorAll('[data-testid^="sidebar-workspace-row-"]'));
  cleanupRows(doc.querySelectorAll('[data-testid^="sidebar-project-row-"]'));
  return clearedCount;
}

export interface LocateProjectSidebarOptions {
  projectId?: string | null;
  projectKey?: string | null;
  projectName?: string | null;
  expandIfCollapsed?: boolean;
  highlightFlash?: boolean;
}

// Our own presses on a collapsed project row or a "Show more" button. React applies the toggle
// on a later frame, so a second press before then (the resolved-project `.then` reveal, a staged
// retry) would collapse it again. One press per element per settle window (T-028).
const EXPAND_PRESS_SETTLE_MS = 900;
const recentExpandPresses = new WeakMap<object, number>();

function pressSidebarExpander(el: MinimalElement): boolean {
  const now = Date.now();
  const last = recentExpandPresses.get(el);
  if (last !== undefined && now - last < EXPAND_PRESS_SETTLE_MS) return false;
  recentExpandPresses.set(el, now);
  el.click?.();
  return true;
}

// > 0 while a reveal is pressing sidebar rows. A reveal started from inside that press (any
// listener reacting to the synthetic click) must not nest another one (T-028 freeze).
let sidebarRevealDepth = 0;

export function locateProjectInSidebar(
  options: LocateProjectSidebarOptions,
  docOverride?: MinimalDocument | null,
  winOverride?: MinimalWindow | null,
): boolean {
  const win = winOverride ?? getWebWindow();
  const doc = docOverride ?? win?.document ?? null;
  if (!doc) return false;

  const cleanProjectId = (options.projectId ?? "").trim();
  const cleanProjectKey = (options.projectKey ?? "").trim();
  const cleanProjectName = (options.projectName ?? "").trim().toLowerCase();
  if (!cleanProjectId && !cleanProjectKey && !cleanProjectName) {
    return false;
  }

  const projRows = doc.querySelectorAll('[data-testid^="sidebar-project-row-"]');
  let matchedRow: MinimalElement | null = null;
  let matchedViewKey = "";

  for (let i = 0; i < projRows.length; i += 1) {
    const prow = projRows[i];
    if (!prow) continue;
    const ptid = prow.getAttribute?.("data-testid") ?? "";
    const viewKey = ptid.replace(/^sidebar-project-row-/, "");
    if (
      (cleanProjectKey &&
        (ptid.endsWith(`:${cleanProjectKey}`) || viewKey === cleanProjectKey)) ||
      (cleanProjectId &&
        (ptid.endsWith(`:${cleanProjectId}`) || viewKey === cleanProjectId))
    ) {
      matchedRow = prow;
      matchedViewKey = viewKey;
      break;
    }
    if (cleanProjectName) {
      const text = (prow.textContent ?? "").trim().toLowerCase();
      if (text === cleanProjectName) {
        matchedRow = prow;
        matchedViewKey = viewKey;
        break;
      }
    }
  }

  if (!matchedRow) {
    return false;
  }

  if (options.expandIfCollapsed !== false) {
    const lists = doc.querySelectorAll('[data-testid^="sidebar-workspace-list-"]');
    let isExpanded = false;
    for (let i = 0; i < lists.length; i += 1) {
      const ltid = lists[i]?.getAttribute?.("data-testid") ?? "";
      const listViewKey = ltid.replace(/^sidebar-workspace-list-/, "");
      if (
        (matchedViewKey && listViewKey === matchedViewKey) ||
        (cleanProjectKey && ltid.endsWith(`:${cleanProjectKey}`)) ||
        (cleanProjectId && ltid.endsWith(`:${cleanProjectId}`))
      ) {
        isExpanded = true;
        break;
      }
    }
    if (!isExpanded) {
      pressSidebarExpander(matchedRow);
    }
  }

  try {
    matchedRow.scrollIntoView?.({ block: "center", behavior: "smooth" });
  } catch {
    try {
      matchedRow.scrollIntoView?.(true);
    } catch {
      // Ignore if scrollIntoView is unsupported in mock DOM
    }
  }

  if (options.highlightFlash !== false) {
    ensureInlineRenameStyleTag(doc, win);
    clearSidebarJumpFlashes(doc);
    matchedRow.setAttribute?.("data-paseo-project-jump-flash", "true");
    const timer = setTimeout(() => {
      activeSidebarFlashTimers.delete(timer);
      matchedRow?.removeAttribute?.("data-paseo-project-jump-flash");
    }, 1100);
    activeSidebarFlashTimers.add(timer);
  }

  return true;
}

export function extractActiveWorkspaceHeaderProjectName(
  doc: MinimalDocument,
): string | null {
  const headerTitle = doc.querySelector('[data-testid="workspace-header-title"]');
  if (!headerTitle) return null;
  const sibling = headerTitle.nextSibling ?? null;
  const siblingText = (sibling?.textContent ?? "").trim();
  if (siblingText) {
    return siblingText;
  }
  const parent = headerTitle.parentElement;
  const children = parent?.children;
  if (children && children.length >= 2) {
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!child || child === headerTitle) continue;
      if (child.getAttribute?.("data-testid") === "workspace-header-title") continue;
      const txt = (child.textContent ?? "").trim();
      if (txt) {
        return txt;
      }
    }
  }
  const titleText = (headerTitle.textContent ?? "").trim();
  return titleText || null;
}

export function extractCommandCenterSelectionHint(
  target: MinimalElement | null,
  doc: MinimalDocument,
): {
  workspaceId?: string;
  candidateProjectNames: string[];
} | null {
  let rowEl: MinimalElement | null = null;
  let curr: MinimalElement | null = target;
  for (let depth = 0; curr && depth < 12; depth += 1) {
    const tid = curr.getAttribute?.("data-testid") ?? "";
    if (
      tid.startsWith("command-center-workspace-") &&
      tid !== "command-center-workspace-subtitle"
    ) {
      rowEl = curr;
      break;
    }
    if (
      tid.startsWith("command-center-agent-") &&
      tid !== "command-center-agent-subtitle"
    ) {
      rowEl = curr;
      break;
    }
    curr = curr.parentElement ?? null;
  }

  // Only a click that lands inside a ⌘K row is a pick. Never borrow the panel's first row for
  // a click elsewhere: the reveal's own synthetic sidebar clicks arrive while the panel is still
  // mounted, and borrowing turned each of them into another reveal (T-028 freeze).
  if (!rowEl) return null;

  const rowTid = rowEl.getAttribute?.("data-testid") ?? "";
  let workspaceId: string | undefined;
  if (rowTid.startsWith("command-center-workspace-")) {
    const rawKey = rowTid.slice("command-center-workspace-".length);
    const colonIdx = rawKey.lastIndexOf(":");
    workspaceId = colonIdx > 0 ? rawKey.slice(colonIdx + 1) : rawKey;
  }

  const subtitleEl =
    rowEl.querySelector?.('[data-testid="command-center-workspace-subtitle"]') ??
    rowEl.querySelector?.('[data-testid="command-center-agent-subtitle"]') ??
    null;
  const rawSubtitle = (subtitleEl?.textContent ?? "").trim();
  const candidateProjectNames: string[] = [];
  if (rawSubtitle) {
    const parts = rawSubtitle
      .split(/\s*\u00b7\s*/)
      .map((s) => s.replace(/\u00a0/g, " ").trim())
      .filter(Boolean);
    for (const part of parts) {
      if (
        part &&
        part !== "main" &&
        part !== "master" &&
        !/^(?:just now|\d+\s*(?:s|m|h|d|w|mo|y)|yesterday)/i.test(part) &&
        !candidateProjectNames.includes(part)
      ) {
        candidateProjectNames.push(part);
      }
    }
  }

  return {
    workspaceId,
    candidateProjectNames,
  };
}

export interface RevealWorkspaceSidebarOptions {
  workspaceId?: string | null;
  projectId?: string | null;
  projectKey?: string | null;
  projectName?: string | null;
  candidateProjectNames?: string[];
  highlightFlash?: boolean;
}

function findSidebarWorkspaceRow(
  doc: MinimalDocument,
  cleanWorkspaceId: string,
): MinimalElement | null {
  if (!cleanWorkspaceId) {
    return doc.querySelector(
      '[data-testid^="sidebar-workspace-row-"][aria-selected="true"]',
    );
  }
  const rows = doc.querySelectorAll('[data-testid^="sidebar-workspace-row-"]');
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const tid = row.getAttribute?.("data-testid") ?? "";
    if (
      tid.endsWith(`:${cleanWorkspaceId}`) ||
      tid === `sidebar-workspace-row-${cleanWorkspaceId}`
    ) {
      return row;
    }
  }
  return null;
}

function flashAndScrollWorkspaceRow(
  row: MinimalElement,
  doc: MinimalDocument,
  win: MinimalWindow | null,
  highlightFlash = true,
): void {
  try {
    row.scrollIntoView?.({ block: "center", behavior: "smooth" });
  } catch {
    try {
      row.scrollIntoView?.(true);
    } catch {
      // Ignore if scrollIntoView is unsupported in mock DOM
    }
  }

  if (!highlightFlash) return;

  ensureInlineRenameStyleTag(doc, win);
  clearSidebarJumpFlashes(doc);
  row.setAttribute?.("data-paseo-workspace-jump-flash", "true");

  const groupEl = row.closest?.('[role="group"]') ?? row.parentElement?.parentElement ?? null;
  const parentProjRow =
    groupEl?.querySelector?.('[data-testid^="sidebar-project-row-"]') ?? null;
  if (parentProjRow) {
    parentProjRow.setAttribute?.("data-paseo-project-jump-flash", "true");
  }

  const timer = setTimeout(() => {
    activeSidebarFlashTimers.delete(timer);
    row.removeAttribute?.("data-paseo-workspace-jump-flash");
    parentProjRow?.removeAttribute?.("data-paseo-project-jump-flash");
  }, 1100);
  activeSidebarFlashTimers.add(timer);
}

export function revealWorkspaceInSidebar(
  options: RevealWorkspaceSidebarOptions,
  docOverride?: MinimalDocument | null,
  winOverride?: MinimalWindow | null,
): boolean {
  const win = winOverride ?? getWebWindow();
  const doc = docOverride ?? win?.document ?? null;
  if (!doc) return false;
  if (sidebarRevealDepth > 0) return false;

  const cleanWorkspaceId = (
    options.workspaceId ??
    resolveCurrentActiveWorkspaceId(doc, win) ??
    ""
  ).trim();
  const highlightFlash = options.highlightFlash !== false;

  const tryExpandParentProjectAndShowMore = (): boolean => {
    const candidateNames: string[] = [];
    const pushName = (n?: string | null) => {
      const trimmed = (n ?? "").trim();
      if (trimmed && !candidateNames.includes(trimmed)) {
        candidateNames.push(trimmed);
      }
    };
    pushName(options.projectName);
    for (const extra of options.candidateProjectNames ?? []) {
      pushName(extra);
    }
    pushName(extractActiveWorkspaceHeaderProjectName(doc));

    let projectLocated = false;
    if (options.projectId || options.projectKey || options.projectName) {
      projectLocated = locateProjectInSidebar(
        {
          projectId: options.projectId,
          projectKey: options.projectKey,
          projectName: options.projectName,
          expandIfCollapsed: true,
          highlightFlash,
        },
        doc,
        win,
      );
    }
    if (!projectLocated) {
      for (const candidateName of candidateNames) {
        if (
          locateProjectInSidebar(
            {
              projectName: candidateName,
              expandIfCollapsed: true,
              highlightFlash,
            },
            doc,
            win,
          )
        ) {
          projectLocated = true;
          break;
        }
      }
    }

    // If the workspace row is still hidden because the project has >5 workspaces behind "Show more", click it
    if (cleanWorkspaceId && !findSidebarWorkspaceRow(doc, cleanWorkspaceId)) {
      const showMoreBtns = doc.querySelectorAll(
        '[data-testid^="sidebar-project-show-more-"]',
      );
      for (let i = 0; i < showMoreBtns.length; i += 1) {
        const btn = showMoreBtns[i];
        if (!btn) continue;
        if (btn.getAttribute?.("aria-expanded") === "true") continue;
        const btid = btn.getAttribute?.("data-testid") ?? "";
        const viewKey = btid.replace(/^sidebar-project-show-more-/, "");
        const cleanKey = (options.projectKey ?? "").trim();
        const cleanId = (options.projectId ?? "").trim();
        const groupEl = btn.closest?.('[role="group"]');
        const projRowForKey = viewKey
          ? doc.querySelector(`[data-testid="sidebar-project-row-${viewKey}"]`)
          : null;
        const projRowText = (projRowForKey?.textContent ?? "").trim().toLowerCase();
        const groupLabel =
          (groupEl?.getAttribute?.("aria-label") ?? "").trim().toLowerCase() ||
          projRowText;
        const matchesProject =
          (cleanKey && (btid.endsWith(`:${cleanKey}`) || viewKey === cleanKey)) ||
          (cleanId && (btid.endsWith(`:${cleanId}`) || viewKey === cleanId)) ||
          (groupLabel &&
            candidateNames.some((n) => n.toLowerCase() === groupLabel));
        if (matchesProject || (!options.projectId && !options.projectKey && candidateNames.length === 0)) {
          pressSidebarExpander(btn);
        }
      }
    }

    return projectLocated;
  };

  const expandWhileHoldingRevealGuard = (): boolean => {
    sidebarRevealDepth += 1;
    try {
      return tryExpandParentProjectAndShowMore();
    } finally {
      sidebarRevealDepth -= 1;
    }
  };

  // Fast path: if the workspace row is already rendered in the left sidebar, scroll and flash immediately
  const existingRow = findSidebarWorkspaceRow(doc, cleanWorkspaceId);
  if (existingRow) {
    flashAndScrollWorkspaceRow(existingRow, doc, win, highlightFlash);
    return true;
  }

  // Otherwise, uncollapse the parent project (and "Show more" if truncated)
  const projectExpanded = expandWhileHoldingRevealGuard();

  // Check synchronously in case `.click()` mounted the workspace list immediately
  const rowAfterSyncExpand = findSidebarWorkspaceRow(doc, cleanWorkspaceId);
  if (rowAfterSyncExpand) {
    flashAndScrollWorkspaceRow(rowAfterSyncExpand, doc, win, highlightFlash);
    return true;
  }

  // Schedule staged retries for asynchronous React sidebar expansion / route header hydration
  let revealed = false;
  for (const delayMs of [45, 120, 240, 420, 700]) {
    setTimeout(() => {
      if (revealed) return;
      const targetWsId =
        cleanWorkspaceId || (resolveCurrentActiveWorkspaceId(doc, win) ?? "").trim();
      const row = findSidebarWorkspaceRow(doc, targetWsId);
      if (row) {
        revealed = true;
        flashAndScrollWorkspaceRow(row, doc, win, highlightFlash);
        return;
      }
      expandWhileHoldingRevealGuard();
      const rowAfterRetry = findSidebarWorkspaceRow(doc, targetWsId);
      if (rowAfterRetry) {
        revealed = true;
        flashAndScrollWorkspaceRow(rowAfterRetry, doc, win, highlightFlash);
      }
    }, delayMs);
  }

  return projectExpanded;
}

export function computeDoneToggledTitle(
  currentTitle: string,
  prefix = "d ",
): {
  newTitle: string;
  action: "marked" | "unmarked";
} {
  const trimmed = (currentTitle ?? "").trim();
  if (/^d\s+/i.test(trimmed)) {
    return {
      newTitle: trimmed.replace(/^d\s+/i, ""),
      action: "unmarked",
    };
  }
  if (/^d[-_:]\s*/i.test(trimmed)) {
    return {
      newTitle: trimmed.replace(/^d[-_:]\s*/i, ""),
      action: "unmarked",
    };
  }
  if (trimmed.toLowerCase() === "d") {
    return {
      newTitle: "",
      action: "unmarked",
    };
  }
  return {
    newTitle: `${prefix}${trimmed}`,
    action: "marked",
  };
}

export function isMarkDoneKeyboardEvent(ke: MinimalKeyboardEvent): boolean {
  if (ke.metaKey || ke.ctrlKey) return false;
  if (!ke.altKey) return false;
  const key = (ke.key ?? "").toLowerCase();
  const code = ke.code ?? "";
  // On macOS Chromium, Option+D produces '∂' (and Option+Shift+D produces 'Î')
  return code === "KeyD" || key === "d" || ke.key === "∂" || ke.key === "Î";
}

let activeNoticeToastTimer: ReturnType<typeof setTimeout> | null = null;
let activeNoticeToastEl: MinimalElement | null = null;

export function showFinderNoticeToast(
  doc: MinimalDocument,
  win: MinimalWindow | null,
  text: string,
  isError = false,
): void {
  if (!doc.body) return;
  if (activeNoticeToastTimer) {
    clearTimeout(activeNoticeToastTimer);
    activeNoticeToastTimer = null;
  }
  if (activeNoticeToastEl) {
    activeNoticeToastEl.remove?.();
    activeNoticeToastEl = null;
  }
  const tokens = syncPaseoThemeCssVariables(doc, win);
  const toastEl = doc.createElement("div");
  toastEl.setAttribute?.("data-testid", "paseo-finder-notice-toast");
  toastEl.textContent = text;
  if (toastEl.style) {
    toastEl.style.position = "fixed";
    toastEl.style.left = "16px";
    toastEl.style.bottom = "16px";
    toastEl.style.zIndex = "10000";
    toastEl.style.maxWidth = "420px";
    toastEl.style.padding = "8px 14px";
    toastEl.style.borderRadius = "8px";
    toastEl.style.backgroundColor = tokens.surface0;
    toastEl.style.border = `1px solid ${isError ? tokens.destructive : tokens.border}`;
    toastEl.style.color = isError ? tokens.destructive : tokens.foreground;
    toastEl.style.fontSize = "12.5px";
    toastEl.style.fontWeight = "500";
    toastEl.style.boxShadow = tokens.shadowLg;
    toastEl.style.pointerEvents = "none";
    toastEl.style.fontFamily =
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif";
  }
  doc.body.appendChild?.(toastEl);
  activeNoticeToastEl = toastEl;
  activeNoticeToastTimer = setTimeout(() => {
    toastEl.remove?.();
    if (activeNoticeToastEl === toastEl) {
      activeNoticeToastEl = null;
    }
  }, 3200);
}

let activeDesktopRevealCallbacks: DesktopRevealHelperCallbacks | null = null;

export interface ToggleSessionDoneResult {
  ok: boolean;
  workspaceId: string;
  previousTitle: string;
  newTitle: string;
  action: "marked" | "unmarked";
  message: string;
}

export async function toggleCurrentSessionDone(
  options?: {
    workspaceId?: string;
    doc?: MinimalDocument | null;
    win?: MinimalWindow | null;
    callbacks?: Partial<DesktopRevealHelperCallbacks>;
    prefix?: string;
  },
  docOverride?: MinimalDocument | null,
  winOverride?: MinimalWindow | null,
): Promise<ToggleSessionDoneResult | null> {
  const win = winOverride ?? options?.win ?? getWebWindow();
  const doc = docOverride ?? options?.doc ?? win?.document ?? null;
  if (!doc) return null;

  const callbacks = options?.callbacks ?? activeDesktopRevealCallbacks;
  const fallbackId = callbacks?.getFallbackWorkspaceId?.();
  const targetWsId = (
    options?.workspaceId ??
    resolveCurrentActiveWorkspaceId(doc, win, fallbackId) ??
    ""
  ).trim();

  const f2Target = findF2InlineRenameTarget(doc, win, targetWsId || undefined);
  const effectiveWsId = targetWsId || f2Target?.workspaceId || "";
  if (!effectiveWsId && !f2Target) {
    return null;
  }

  const sidebarRow = effectiveWsId ? findSidebarWorkspaceRow(doc, effectiveWsId) : null;
  const sidebarTitleEl = sidebarRow
    ? findSidebarRowTitleElement(sidebarRow, effectiveWsId)
    : null;
  const headerTitleEl = doc.querySelector?.('[data-testid="workspace-header-title"]') ?? null;

  let currentTitle = (
    f2Target?.initialTitle ||
    sidebarTitleEl?.textContent ||
    headerTitleEl?.textContent ||
    ""
  ).trim();

  if (!currentTitle && callbacks?.onFetchThreadMetadata && effectiveWsId) {
    try {
      const snap = await callbacks.onFetchThreadMetadata(effectiveWsId);
      if (snap?.workspaceTitle) {
        currentTitle = snap.workspaceTitle.trim();
      }
    } catch {
      // Fallback to empty
    }
  }

  if (!currentTitle && effectiveWsId) {
    currentTitle = effectiveWsId;
  }

  const prefix = options?.prefix ?? "d ";
  const { newTitle, action } = computeDoneToggledTitle(currentTitle, prefix);

  // Immediate optimistic DOM updates
  if (f2Target?.titleEl) {
    f2Target.titleEl.textContent = newTitle;
  }
  if (sidebarTitleEl && sidebarTitleEl !== f2Target?.titleEl) {
    sidebarTitleEl.textContent = newTitle;
  }
  if (headerTitleEl && headerTitleEl !== f2Target?.titleEl) {
    headerTitleEl.textContent = newTitle;
  }

  // Left sidebar jump & flash highlight (the core user requirement!)
  if (effectiveWsId) {
    revealWorkspaceInSidebar({ workspaceId: effectiveWsId, highlightFlash: true }, doc, win);
  }

  // Server persistence
  if (callbacks?.onRenameThread) {
    try {
      await callbacks.onRenameThread(newTitle, {
        workspaceId: effectiveWsId,
        agentId: f2Target?.surface === "agent-tab" ? f2Target.agentId : undefined,
        source: "mark-done-shortcut",
      });
    } catch {
      // Ignore background RPC error
    }
  }

  const locale = callbacks?.getLocale?.() ?? (win?.navigator?.language ?? "en");
  const isZh = isChineseLocale(locale);
  const msg = isZh
    ? action === "marked"
      ? `已标记会话为完成: "${newTitle}"`
      : `已取消会话完成标记: "${newTitle}"`
    : action === "marked"
      ? `Marked session as done: "${newTitle}"`
      : `Unmarked session: "${newTitle}"`;

  showFinderNoticeToast(doc, win, msg, false);

  return {
    ok: true,
    workspaceId: effectiveWsId,
    previousTitle: currentTitle,
    newTitle,
    action,
    message: msg,
  };
}

export function focusWorkspaceInApp(
  workspaceId: string,
  projectId?: string | null,
  docOverride?: MinimalDocument | null,
  winOverride?: MinimalWindow | null,
  projectMeta?: {
    projectKey?: string | null;
    projectName?: string | null;
  },
): boolean {
  const cleanId = workspaceId.trim();
  const win = winOverride ?? getWebWindow();
  const doc = docOverride ?? win?.document ?? null;
  if (!doc) return false;

  if (projectId || projectMeta?.projectKey || projectMeta?.projectName) {
    locateProjectInSidebar(
      {
        projectId,
        projectKey: projectMeta?.projectKey,
        projectName: projectMeta?.projectName,
        expandIfCollapsed: true,
        highlightFlash: true,
      },
      doc,
      win,
    );
  }

  if (!cleanId) {
    return Boolean(projectId || projectMeta?.projectKey || projectMeta?.projectName);
  }

  const isAlreadyOnTargetRoute = (): boolean => {
    const currentPath = win?.location?.pathname ?? "";
    return currentPath.endsWith(`/workspace/${encodeURIComponent(cleanId)}`);
  };

  const tryFocusAndRevealOnce = (allowExpandCollapsedProject: boolean): boolean => {
    const row = findSidebarWorkspaceRow(doc, cleanId);
    if (row) {
      flashAndScrollWorkspaceRow(row, doc, win, true);
      if (!isAlreadyOnTargetRoute()) {
        row.click?.();
      }
      return true;
    }
    if (
      allowExpandCollapsedProject &&
      (projectId || projectMeta?.projectKey || projectMeta?.projectName)
    ) {
      locateProjectInSidebar(
        {
          projectId,
          projectKey: projectMeta?.projectKey,
          projectName: projectMeta?.projectName,
          expandIfCollapsed: true,
          highlightFlash: false,
        },
        doc,
        win,
      );
      const rowAfterSyncExpand = findSidebarWorkspaceRow(doc, cleanId);
      if (rowAfterSyncExpand) {
        flashAndScrollWorkspaceRow(rowAfterSyncExpand, doc, win, true);
        if (!isAlreadyOnTargetRoute()) {
          rowAfterSyncExpand.click?.();
        }
        return true;
      }
    }
    return false;
  };

  if (tryFocusAndRevealOnce(true)) {
    return true;
  }

  let expandedTried = false;
  let completed = false;
  const retryDelays = [60, 150, 280, 500, 800];
  for (const delay of retryDelays) {
    setTimeout(() => {
      if (completed) return;
      const allowExpand = delay >= 150 && !expandedTried;
      if (allowExpand) expandedTried = true;
      if (tryFocusAndRevealOnce(allowExpand)) {
        completed = true;
        return;
      }
      revealWorkspaceInSidebar(
        {
          workspaceId: cleanId,
          projectId,
          projectKey: projectMeta?.projectKey,
          projectName: projectMeta?.projectName,
          highlightFlash: true,
        },
        doc,
        win,
      );
      if (!isAlreadyOnTargetRoute() && delay >= 500 && win?.history?.pushState) {
        const serverId = inferActiveServerId(doc, win);
        const route = `/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(cleanId)}`;
        try {
          win.history.pushState({}, "", route);
          if (win.PopStateEvent) {
            win.dispatchEvent?.(new win.PopStateEvent("popstate"));
          }
        } catch {
          // Non-fatal fallback
        }
      }
    }, delay);
  }

  return false;
}

function dismissNativeMenu(win: MinimalWindow | null, doc: MinimalDocument): void {
  try {
    if (win?.KeyboardEvent) {
      const escDown = new win.KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        bubbles: true,
        cancelable: true,
      });
      doc.dispatchEvent?.(escDown);
      win.dispatchEvent?.(escDown);
    }
  } catch {
    // Ignore if synthetic KeyboardEvent is unsupported
  }
}

function createNativeStyledMenuItem(
  doc: MinimalDocument,
  templateItem: MinimalElement,
  testId: string,
  label: string,
  iconKey: keyof typeof LUCIDE_SVGS,
  onSelect: () => void,
): MinimalElement {
  const row = templateItem.cloneNode ? templateItem.cloneNode(true) : doc.createElement("div");
  row.setAttribute?.("data-testid", testId);
  row.setAttribute?.("data-paseo-finder-injected", "true");
  row.setAttribute?.("role", "menuitem");

  // Update leading icon slot and label text if cloned from Paseo's native MenuItem
  const children = row.children;
  if (children && children.length >= 2) {
    const leadingSlot = children[0];
    const contentSlot = children[1];
    if (leadingSlot) {
      leadingSlot.innerHTML = LUCIDE_SVGS[iconKey];
    }
    const textLeaf = contentSlot?.children?.[0] ?? contentSlot;
    if (textLeaf) {
      textLeaf.textContent = label;
    }
  } else {
    // Fallback construction if template had no deep child structure
    row.textContent = label;
  }

  if (row.style) {
    row.style.cursor = "pointer";
  }

  row.addEventListener?.("mouseenter", () => {
    if (row.style) row.style.backgroundColor = "rgba(255, 255, 255, 0.06)";
  });
  row.addEventListener?.("mouseleave", () => {
    if (row.style) row.style.backgroundColor = "";
  });
  row.addEventListener?.("click", (ev) => {
    const me = ev as MinimalMouseEvent;
    me.preventDefault?.();
    me.stopPropagation?.();
    onSelect();
  });

  return row;
}

export function injectIntoNativeTabMenus(
  doc: MinimalDocument,
  callbacks: DesktopRevealHelperCallbacks,
  fallbackPath?: string | null,
  win: MinimalWindow | null = null,
): number {
  if (!callbacks.isEnabled()) return 0;
  const copyItems = doc.querySelectorAll(
    '[data-testid^="workspace-tab-context-"][data-testid$="-copy-file-path"]',
  );
  if (!copyItems || copyItems.length === 0) return 0;

  const catalog = getCatalogForLocale(callbacks.getLocale?.());
  let injectedCount = 0;

  for (let i = 0; i < copyItems.length; i += 1) {
    const copyItem = copyItems[i];
    if (!copyItem) continue;
    if (copyItem.getAttribute?.("data-paseo-finder-extended") === "true") continue;
    const parent = copyItem.parentElement;
    if (!parent) continue;

    const filePath = extractFilePathFromCopyMenuItem(copyItem, doc, fallbackPath);
    if (!filePath) continue;

    copyItem.setAttribute?.("data-paseo-finder-extended", "true");
    const copyTestId = copyItem.getAttribute?.("data-testid") ?? "workspace-tab-context-file";
    const baseTestId = copyTestId.replace(/-copy-file-path$/, "");

    const itemsToInject: {
      key: string;
      label: string;
      icon: keyof typeof LUCIDE_SVGS;
      target: OpenerTarget;
    }[] = [
      {
        key: "open-system-default",
        label: catalog.actions.openInSystemDefault,
        icon: "ExternalLink",
        target: "system-default",
      },
      {
        key: "reveal-in-finder",
        label: catalog.actions.revealInFinder,
        icon: "FolderOpen",
        target: "finder-reveal",
      },
      {
        key: "open-containing-folder",
        label: catalog.actions.openContainingFolder,
        icon: "Folder",
        target: "finder-folder",
      },
      {
        key: "open-in-preview",
        label: catalog.actions.openInPreview,
        icon: "ExternalLink",
        target: "system-preview",
      },
    ];

    let anchor: MinimalElement | null = copyItem.nextSibling ?? null;
    for (const spec of itemsToInject) {
      const itemEl = createNativeStyledMenuItem(
        doc,
        copyItem,
        `${baseTestId}-${spec.key}`,
        spec.label,
        spec.icon,
        () => {
          dismissNativeMenu(win, doc);
          void callbacks.onOpenTarget(filePath, spec.target);
        },
      );
      if (parent.insertBefore) {
        parent.insertBefore(itemEl, anchor);
      } else {
        parent.appendChild?.(itemEl);
      }
      injectedCount += 1;
    }
  }

  return injectedCount;
}

export interface OpenQuickWorkspaceSwitcherOptions {
  initialQuery?: string;
  locale?: string;
  defaultJumpMode?: QuickJumpAction;
  onListJumpProjects: (query?: string) => Promise<ProjectJumpCandidate[]>;
  onExecuteQuickJump: (input: {
    projectId?: string;
    query?: string;
    jumpMode?: QuickJumpAction;
    source?: "quick-switcher";
  }) => Promise<QuickJumpExecutionSummary | null>;
  onAfterJump?: (summary: QuickJumpExecutionSummary) => void;
  onDisposed?: () => void;
}

export async function openQuickWorkspaceSwitcherModal(
  options: OpenQuickWorkspaceSwitcherOptions,
  docOverride?: MinimalDocument | null,
  winOverride?: MinimalWindow | null,
): Promise<MinimalElement | null> {
  const win = winOverride ?? getWebWindow();
  const doc = docOverride ?? win?.document ?? null;
  if (!doc || !doc.body) return null;

  const existing = doc.querySelector('[data-testid="paseo-finder-quick-jump-modal"]');
  existing?.remove?.();

  const catalog = getCatalogForLocale(options.locale ?? win?.navigator?.language);
  const jumpPrefs = readQuickJumpPreferences(win?.localStorage);
  const defaultAction: QuickJumpAction =
    options.defaultJumpMode ?? jumpPrefs.quickJumpDefaultAction;

  const allCandidates = await options.onListJumpProjects("").catch(() => []);
  if (!doc.body) return null;

  ensureInlineRenameStyleTag(doc, win);
  const tokens = syncPaseoThemeCssVariables(doc, win);
  const isLight = tokens.colorScheme === "light";

  const backdrop = doc.createElement("div");
  backdrop.setAttribute?.("data-testid", "paseo-finder-quick-jump-modal");
  backdrop.setAttribute?.("data-paseo-theme", tokens.name);
  backdrop.setAttribute?.("role", "dialog");
  if (backdrop.style) {
    backdrop.style.position = "fixed";
    backdrop.style.left = "0";
    backdrop.style.top = "0";
    backdrop.style.width = "100vw";
    backdrop.style.height = "100vh";
    backdrop.style.zIndex = "2147483647";
    backdrop.style.backgroundColor = tokens.backdrop;
    backdrop.style.display = "flex";
    backdrop.style.flexDirection = "column";
    backdrop.style.alignItems = "center";
    backdrop.style.paddingTop = "48px";
    backdrop.style.boxSizing = "border-box";
    backdrop.style.fontFamily =
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  }

  const card = doc.createElement("div");
  card.setAttribute?.("data-testid", "paseo-finder-quick-jump-card");
  if (card.style) {
    card.style.width = "min(640px, calc(100vw - 32px))";
    card.style.maxHeight = "min(560px, calc(100vh - 96px))";
    card.style.backgroundColor = tokens.surface0;
    card.style.border = `1px solid ${tokens.border}`;
    card.style.borderRadius = "8px";
    card.style.boxShadow = tokens.shadowLg;
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.overflow = "hidden";
  }

  let closed = false;
  const closeModal = () => {
    if (closed) return;
    closed = true;
    backdrop.remove?.();
    options.onDisposed?.();
  };

  backdrop.addEventListener?.("click", (ev) => {
    const me = ev as MinimalMouseEvent;
    if (me.target === backdrop) {
      me.preventDefault?.();
      me.stopPropagation?.();
      closeModal();
    }
  });

  // Top Header + Search Input (matching Paseo CommandCenter `Me.header` & `Me.searchRow`)
  const headerBox = doc.createElement("div");
  if (headerBox.style) {
    headerBox.style.padding = "12px 16px";
    headerBox.style.borderBottom = `1px solid ${tokens.border}`;
    headerBox.style.display = "flex";
    headerBox.style.flexDirection = "row";
    headerBox.style.alignItems = "center";
    headerBox.style.gap = "8px";
    headerBox.style.backgroundColor = tokens.surface0;
  }

  const titleLabel = doc.createElement("div");
  titleLabel.textContent = catalog.actions.quickJumpTitle;
  if (titleLabel.style) {
    titleLabel.style.display = "inline-flex";
    titleLabel.style.alignItems = "center";
    titleLabel.style.gap = "6px";
    titleLabel.style.fontSize = "12px";
    titleLabel.style.fontWeight = "500";
    titleLabel.style.color = tokens.foreground;
    titleLabel.style.backgroundColor = tokens.surface2;
    titleLabel.style.border = `1px solid ${tokens.borderAccent}`;
    titleLabel.style.borderRadius = "6px";
    titleLabel.style.padding = "3px 8px";
    titleLabel.style.flexShrink = "0";
  }

  const searchInput = doc.createElement("input");
  searchInput.type = "text";
  searchInput.value = options.initialQuery ?? "";
  searchInput.placeholder = catalog.actions.quickJumpPlaceholder;
  searchInput.setAttribute?.("data-testid", "paseo-finder-quick-jump-input");
  if (searchInput.style) {
    searchInput.style.flex = "1";
    searchInput.style.minWidth = "0";
    searchInput.style.boxSizing = "border-box";
    searchInput.style.backgroundColor = "transparent";
    searchInput.style.border = "none";
    searchInput.style.padding = "4px 2px";
    searchInput.style.color = tokens.foreground;
    searchInput.style.fontSize = "14px";
    searchInput.style.outline = "none";
  }

  const subtitleBadge = doc.createElement("div");
  subtitleBadge.textContent = `${allCandidates.length}`;
  if (subtitleBadge.style) {
    subtitleBadge.style.fontSize = "12px";
    subtitleBadge.style.color = tokens.foregroundMuted;
    subtitleBadge.style.backgroundColor = tokens.surface1;
    subtitleBadge.style.border = `1px solid ${tokens.border}`;
    subtitleBadge.style.borderRadius = "999px";
    subtitleBadge.style.padding = "1px 8px";
    subtitleBadge.style.flexShrink = "0";
  }

  headerBox.appendChild?.(titleLabel);
  headerBox.appendChild?.(searchInput);
  headerBox.appendChild?.(subtitleBadge);
  card.appendChild?.(headerBox);

  // Results List Container
  const listContainer = doc.createElement("div");
  listContainer.setAttribute?.("data-testid", "paseo-finder-quick-jump-list");
  if (listContainer.style) {
    listContainer.style.display = "flex";
    listContainer.style.flexDirection = "column";
    listContainer.style.padding = "4px 0";
    listContainer.style.overflowY = "auto";
    listContainer.style.maxHeight = "420px";
    listContainer.style.backgroundColor = tokens.surface0;
  }
  card.appendChild?.(listContainer);

  // Footer Keyboard Hints
  const footerBox = doc.createElement("div");
  footerBox.textContent = catalog.actions.quickJumpFooterHint;
  if (footerBox.style) {
    footerBox.style.padding = "8px 16px";
    footerBox.style.borderTop = `1px solid ${tokens.border}`;
    footerBox.style.backgroundColor = tokens.surface1;
    footerBox.style.color = tokens.foregroundMuted;
    footerBox.style.fontSize = "11px";
  }
  card.appendChild?.(footerBox);

  let filtered: ProjectJumpCandidate[] = [...allCandidates];
  let selectedIndex = 0;

  const computeFiltered = (rawQuery: string): ProjectJumpCandidate[] => {
    const q = rawQuery.trim();
    if (!q) {
      return [...allCandidates];
    }
    const scored: ProjectJumpCandidate[] = [];
    for (const item of allCandidates) {
      const score = scoreProjectJumpQuery(
        {
          projectName: item.projectName,
          projectRootPath: item.projectRootPath,
          shortPath: item.shortPath,
          primaryWorkspaceTitle: item.primaryWorkspaceTitle,
        },
        q,
      );
      if (score > 0) {
        scored.push({
          ...item,
          score: score + Math.min(25, item.activeWorkspaceCount * 2),
        });
      }
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.projectName.localeCompare(b.projectName);
    });
    return scored;
  };

  const triggerJump = async (
    candidate: ProjectJumpCandidate | undefined,
    jumpMode: QuickJumpAction,
  ) => {
    if (!candidate) return;
    closeModal();
    if (jumpMode === "locate-sidebar") {
      locateProjectInSidebar(
        {
          projectId: candidate.projectId,
          projectKey: candidate.projectKey,
          projectName: candidate.projectName,
          expandIfCollapsed: true,
          highlightFlash: true,
        },
        doc,
        win,
      );
    }
    const summary = await options
      .onExecuteQuickJump({
        projectId: candidate.projectId,
        query: searchInput.value ?? "",
        jumpMode,
        source: "quick-switcher",
      })
      .catch(() => null);
    if (!summary) return;
    if (summary.ok) {
      if (summary.jumpMode === "locate-sidebar") {
        locateProjectInSidebar(
          {
            projectId: summary.targetProjectId ?? candidate.projectId,
            projectKey: summary.targetProjectKey ?? candidate.projectKey,
            projectName: summary.targetProjectName ?? candidate.projectName,
            expandIfCollapsed: true,
            highlightFlash: true,
          },
          doc,
          win,
        );
      } else if (summary.targetWorkspaceId) {
        focusWorkspaceInApp(
          summary.targetWorkspaceId,
          summary.targetProjectId ?? candidate.projectId,
          doc,
          win,
          {
            projectKey: summary.targetProjectKey ?? candidate.projectKey,
            projectName: summary.targetProjectName ?? candidate.projectName,
          },
        );
      }
    }
    options.onAfterJump?.(summary);
  };

  const renderList = () => {
    while (listContainer.children && listContainer.children.length > 0) {
      const first = listContainer.children[0];
      if (!first?.remove) break;
      first.remove();
    }
    if (listContainer.innerHTML !== undefined) {
      listContainer.innerHTML = "";
    }
    subtitleBadge.textContent = `${filtered.length} / ${allCandidates.length}`;
    if (filtered.length === 0) {
      const emptyEl = doc.createElement("div");
      emptyEl.setAttribute?.("data-testid", "paseo-finder-quick-jump-empty");
      emptyEl.textContent = catalog.actions.quickJumpEmpty;
      if (emptyEl.style) {
        emptyEl.style.padding = "24px 16px";
        emptyEl.style.textAlign = "center";
        emptyEl.style.color = tokens.foregroundMuted;
        emptyEl.style.fontSize = "13px";
      }
      listContainer.appendChild?.(emptyEl);
      return;
    }

    if (selectedIndex >= filtered.length) {
      selectedIndex = Math.max(0, filtered.length - 1);
    }

    for (let idx = 0; idx < filtered.length; idx += 1) {
      const item = filtered[idx];
      if (!item) continue;
      const isSelected = idx === selectedIndex;

      const row = doc.createElement("div");
      row.setAttribute?.(
        "data-testid",
        `paseo-finder-quick-jump-item-${item.projectId}`,
      );
      row.setAttribute?.("data-selected", isSelected ? "true" : "false");
      if (row.style) {
        row.style.display = "flex";
        row.style.flexDirection = "row";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.gap = "12px";
        row.style.padding = "8px 16px";
        row.style.cursor = "pointer";
        row.style.backgroundColor = isSelected
          ? isLight
            ? tokens.surface2
            : tokens.surface1
          : "transparent";
      }

      // Paseo-native `ProjectIconView` leading square badge matching left sidebar
      const visual = resolveSidebarProjectVisual(doc, win, {
        projectId: item.projectId,
        projectKey: item.projectKey,
        projectName: item.projectName,
      });

      const iconBadge = doc.createElement("div");
      iconBadge.setAttribute?.("data-testid", `paseo-finder-quick-jump-icon-${item.projectId}`);
      if (iconBadge.style) {
        iconBadge.style.width = "18px";
        iconBadge.style.height = "18px";
        iconBadge.style.borderRadius = "4.5px";
        iconBadge.style.backgroundColor = visual.backgroundColor;
        iconBadge.style.color = "#ffffff";
        iconBadge.style.fontSize = "11px";
        iconBadge.style.fontWeight = "600";
        iconBadge.style.display = "inline-flex";
        iconBadge.style.alignItems = "center";
        iconBadge.style.justifyContent = "center";
        iconBadge.style.flexShrink = "0";
        iconBadge.style.overflow = "hidden";
      }
      if (visual.iconDataUri) {
        const img = doc.createElement("img");
        img.setAttribute?.("src", visual.iconDataUri);
        if (img.style) {
          img.style.width = "18px";
          img.style.height = "18px";
          img.style.objectFit = "cover";
        }
        iconBadge.appendChild?.(img);
      } else {
        iconBadge.textContent = visual.initial;
      }

      const mainWrap = doc.createElement("div");
      if (mainWrap.style) {
        mainWrap.style.display = "flex";
        mainWrap.style.flexDirection = "row";
        mainWrap.style.alignItems = "center";
        mainWrap.style.gap = "12px";
        mainWrap.style.minWidth = "0";
        mainWrap.style.flex = "1";
      }

      const leftCol = doc.createElement("div");
      if (leftCol.style) {
        leftCol.style.display = "flex";
        leftCol.style.flexDirection = "column";
        leftCol.style.gap = "2px";
        leftCol.style.minWidth = "0";
        leftCol.style.flex = "1";
      }

      const topLine = doc.createElement("div");
      if (topLine.style) {
        topLine.style.display = "flex";
        topLine.style.flexDirection = "row";
        topLine.style.alignItems = "center";
        topLine.style.gap = "7px";
      }

      const nameEl = doc.createElement("span");
      nameEl.textContent = item.projectName;
      if (nameEl.style) {
        nameEl.style.color = tokens.foreground;
        nameEl.style.fontSize = "14px";
        nameEl.style.fontWeight = "500";
        nameEl.style.whiteSpace = "nowrap";
        nameEl.style.overflow = "hidden";
        nameEl.style.textOverflow = "ellipsis";
      }

      const threadsBadge = doc.createElement("span");
      threadsBadge.textContent =
        item.activeWorkspaceCount === 0
          ? catalog.actions.quickJumpEmptyBadge
          : item.activeWorkspaceCount === 1
            ? catalog.actions.quickJumpSingleThreadBadge
            : `${item.activeWorkspaceCount} ${catalog.actions.quickJumpThreadsBadge}`;
      if (threadsBadge.style) {
        threadsBadge.style.fontSize = "11px";
        threadsBadge.style.color =
          item.activeWorkspaceCount > 0
            ? tokens.foregroundMuted
            : tokens.foregroundExtraMuted;
        threadsBadge.style.backgroundColor = isSelected ? tokens.surface0 : tokens.surface2;
        threadsBadge.style.border = `1px solid ${tokens.border}`;
        threadsBadge.style.padding = "0px 6px";
        threadsBadge.style.borderRadius = "999px";
        threadsBadge.style.flexShrink = "0";
      }

      topLine.appendChild?.(nameEl);
      topLine.appendChild?.(threadsBadge);

      const bottomLine = doc.createElement("div");
      const activeSub = item.primaryWorkspaceTitle
        ? ` · ${item.primaryWorkspaceTitle}`
        : "";
      bottomLine.textContent = `${item.shortPath}${activeSub}`;
      if (bottomLine.style) {
        bottomLine.style.color = tokens.foregroundMuted;
        bottomLine.style.fontSize = "12px";
        bottomLine.style.whiteSpace = "nowrap";
        bottomLine.style.overflow = "hidden";
        bottomLine.style.textOverflow = "ellipsis";
      }

      leftCol.appendChild?.(topLine);
      leftCol.appendChild?.(bottomLine);
      mainWrap.appendChild?.(iconBadge);
      mainWrap.appendChild?.(leftCol);

      const actionsCol = doc.createElement("div");
      if (actionsCol.style) {
        actionsCol.style.display = "flex";
        actionsCol.style.flexDirection = "row";
        actionsCol.style.alignItems = "center";
        actionsCol.style.gap = "5px";
        actionsCol.style.flexShrink = "0";
      }

      const makeBtn = (
        btnKey: string,
        label: string,
        mode: QuickJumpAction,
        isPrimary: boolean,
      ) => {
        const btn = doc.createElement("div");
        btn.setAttribute?.(
          "data-testid",
          `paseo-finder-quick-jump-${btnKey}-${item.projectId}`,
        );
        btn.textContent = label;
        if (btn.style) {
          btn.style.fontSize = "11.5px";
          btn.style.fontWeight = isPrimary ? "500" : "400";
          btn.style.padding = "3px 7px";
          btn.style.borderRadius = "6px";
          btn.style.cursor = "pointer";
          btn.style.userSelect = "none";
          if (isPrimary && isSelected) {
            btn.style.backgroundColor = tokens.primary;
            btn.style.color = tokens.primaryForeground;
            btn.style.border = `1px solid ${tokens.primary}`;
          } else if (isPrimary) {
            btn.style.backgroundColor = tokens.surface2;
            btn.style.color = tokens.foreground;
            btn.style.border = `1px solid ${tokens.border}`;
          } else {
            btn.style.backgroundColor = isSelected ? tokens.surface0 : tokens.surface1;
            btn.style.color = tokens.foregroundMuted;
            btn.style.border = `1px solid ${tokens.border}`;
          }
        }
        btn.addEventListener?.("click", (ev) => {
          const me = ev as MinimalMouseEvent;
          me.preventDefault?.();
          me.stopPropagation?.();
          void triggerJump(item, mode);
        });
        return btn;
      };

      actionsCol.appendChild?.(
        makeBtn(
          "open",
          catalog.actions.quickJumpBtnOpen,
          "open-latest",
          defaultAction === "open-latest",
        ),
      );
      actionsCol.appendChild?.(
        makeBtn(
          "locate",
          catalog.actions.quickJumpBtnSidebar,
          "locate-sidebar",
          defaultAction === "locate-sidebar",
        ),
      );
      actionsCol.appendChild?.(
        makeBtn(
          "new",
          catalog.actions.quickJumpBtnNew,
          "create-new",
          defaultAction === "create-new",
        ),
      );

      row.appendChild?.(mainWrap);
      row.appendChild?.(actionsCol);

      row.addEventListener?.("mouseenter", () => {
        if (selectedIndex !== idx) {
          selectedIndex = idx;
          renderList();
        }
      });

      row.addEventListener?.("click", (ev) => {
        const me = ev as MinimalMouseEvent;
        me.preventDefault?.();
        me.stopPropagation?.();
        const mode: QuickJumpAction = me.altKey
          ? "create-new"
          : me.shiftKey
            ? "locate-sidebar"
            : defaultAction;
        void triggerJump(item, mode);
      });

      listContainer.appendChild?.(row);
    }
  };

  if (options.initialQuery) {
    filtered = computeFiltered(options.initialQuery);
  }
  renderList();

  searchInput.addEventListener?.("input", () => {
    filtered = computeFiltered(searchInput.value ?? "");
    selectedIndex = 0;
    renderList();
  });

  searchInput.addEventListener?.("keydown", (ev) => {
    const ke = ev as MinimalKeyboardEvent;
    if (ke.key === "Escape") {
      ke.preventDefault?.();
      ke.stopPropagation?.();
      closeModal();
      return;
    }
    if (ke.key === "ArrowDown") {
      ke.preventDefault?.();
      ke.stopPropagation?.();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex + 1) % filtered.length;
        renderList();
      }
      return;
    }
    if (ke.key === "ArrowUp") {
      ke.preventDefault?.();
      ke.stopPropagation?.();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
        renderList();
      }
      return;
    }
    if (ke.key === "Enter") {
      if (ke.isComposing || ke.keyCode === 229) return;
      ke.preventDefault?.();
      ke.stopPropagation?.();
      const targetCandidate = filtered[selectedIndex] ?? filtered[0];
      const mode: QuickJumpAction = ke.altKey
        ? "create-new"
        : ke.shiftKey
          ? "locate-sidebar"
          : defaultAction;
      void triggerJump(targetCandidate, mode);
    }
  });

  backdrop.appendChild?.(card);
  doc.body.appendChild?.(backdrop);

  setTimeout(() => {
    searchInput.focus?.();
    if (options.initialQuery) {
      searchInput.select?.();
    }
  }, 10);

  return backdrop;
}

export function normalizeListCommandsResponsePayload(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed;
  const msg = parsed as Record<string, unknown>;
  if (msg.type !== "list_commands_response") return parsed;
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.commands)) {
    return parsed;
  }
  for (const item of payload.commands) {
    if (!item || typeof item !== "object") continue;
    const cmd = item as Record<string, unknown>;
    const hint = typeof cmd.argumentHint === "string" ? cmd.argumentHint : "";
    if (hint === "[skill]" || hint.startsWith("[skill] ")) {
      cmd.kind = "skill";
      const restHint = hint.slice(7).trim();
      cmd.argumentHint = restHint || "";
    }
  }
  return parsed;
}

export function ensureAntigravityInlineSkillAutocompleteBridge(
  win?: MinimalWindow | null,
): void {
  const targetObj = (win ?? globalThis) as unknown as {
    JSON?: typeof JSON;
    __paseoInlineSkillBridgeInstalled?: boolean;
  };
  const jsonObj = targetObj.JSON ?? JSON;
  if (!jsonObj || typeof jsonObj.parse !== "function" || targetObj.__paseoInlineSkillBridgeInstalled) {
    return;
  }
  const origParse = jsonObj.parse;
  jsonObj.parse = function patchedJsonParse(
    text: string,
    reviver?: (this: unknown, key: string, value: unknown) => unknown,
  ): unknown {
    const parsed = origParse.call(this, text, reviver);
    if (
      typeof text === "string" &&
      text.includes('"list_commands_response"') &&
      text.includes('"[skill]')
    ) {
      return normalizeListCommandsResponsePayload(parsed);
    }
    return parsed;
  };
  targetObj.__paseoInlineSkillBridgeInstalled = true;
}

export function installDesktopRevealHelpers(
  callbacks: DesktopRevealHelperCallbacks,
  docOverride?: MinimalDocument | null,
  winOverride?: MinimalWindow | null,
): () => void {
  if (!docOverride && !winOverride && Platform.OS !== "web") return () => {};
  const win = winOverride ?? getWebWindow();
  const doc = docOverride ?? win?.document ?? null;
  if (!win || !doc) return () => {};

  activeDesktopRevealCallbacks = callbacks;

  let activeMenuEl: MinimalElement | null = null;
  let activeQuickJumpModalEl: MinimalElement | null = null;
  let activeInlineSession: ActiveInlineRenameSession | null = null;
  let lastClickTracker: {
    targetKey: string;
    atMs: number;
    x: number;
    y: number;
  } | null = null;
  let lastRightClickedTabPath: string | null = null;

  const resolveLocale = (): string => {
    const fromCallback = callbacks.getLocale?.();
    if (fromCallback) return fromCallback;
    return win.navigator?.language ?? "en";
  };

  const removeMenu = () => {
    if (activeMenuEl) {
      activeMenuEl.remove?.();
      activeMenuEl = null;
    }
    if (activeQuickJumpModalEl) {
      activeQuickJumpModalEl.remove?.();
      activeQuickJumpModalEl = null;
    }
  };

  const showChatLinkContextMenu = (x: number, y: number, filePath: string) => {
    removeMenu();
    if (!doc.body) return;

    const tokens = syncPaseoThemeCssVariables(doc, win);
    const catalog = getCatalogForLocale(resolveLocale());
    const container = doc.createElement("div");
    container.setAttribute?.("data-testid", "paseo-finder-quick-menu");
    container.setAttribute?.("role", "menu");
    const maxX = Math.max(12, Math.min(x, (win.innerWidth ?? 1200) - 240));
    const maxY = Math.max(12, Math.min(y + 4, (win.innerHeight ?? 800) - 180));

    if (container.style) {
      container.style.position = "fixed";
      container.style.left = `${maxX}px`;
      container.style.top = `${maxY}px`;
      container.style.zIndex = "2147483647";
      container.style.backgroundColor = tokens.surface0;
      container.style.border = `1px solid ${tokens.border}`;
      container.style.borderRadius = "8px";
      container.style.padding = "4px";
      container.style.boxShadow = tokens.shadowLg;
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.gap = "2px";
      container.style.minWidth = "210px";
      container.style.fontFamily =
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    }

    const actions: {
      key: string;
      label: string;
      icon: keyof typeof LUCIDE_SVGS;
      target?: OpenerTarget;
      copy?: boolean;
      separatorBefore?: boolean;
    }[] = [
      {
        key: "open-system-default",
        label: catalog.actions.openInSystemDefault,
        icon: "ExternalLink",
        target: "system-default",
      },
      {
        key: "reveal-in-finder",
        label: catalog.actions.revealInFinder,
        icon: "FolderOpen",
        target: "finder-reveal",
      },
      {
        key: "open-containing-folder",
        label: catalog.actions.openContainingFolder,
        icon: "Folder",
        target: "finder-folder",
      },
      {
        key: "open-in-preview",
        label: catalog.actions.openInPreview,
        icon: "ExternalLink",
        target: "system-preview",
      },
      {
        key: "copy-file-path",
        label: catalog.actions.copyFilePath,
        icon: "Copy",
        copy: true,
        separatorBefore: true,
      },
    ];

    for (const act of actions) {
      if (act.separatorBefore) {
        const sep = doc.createElement("div");
        if (sep.style) {
          sep.style.height = "1px";
          sep.style.backgroundColor = tokens.border;
          sep.style.margin = "3px 4px";
        }
        container.appendChild?.(sep);
      }

      const item = doc.createElement("div");
      item.setAttribute?.("data-testid", `paseo-finder-quick-menu-${act.key}`);
      item.setAttribute?.("role", "menuitem");
      if (item.style) {
        item.style.display = "flex";
        item.style.flexDirection = "row";
        item.style.alignItems = "center";
        item.style.gap = "8px";
        item.style.fontSize = "13px";
        item.style.lineHeight = "18px";
        item.style.color = tokens.foreground;
        item.style.padding = "6px 8px";
        item.style.borderRadius = "6px";
        item.style.cursor = "pointer";
        item.style.userSelect = "none";
      }

      const iconWrap = doc.createElement("span");
      iconWrap.innerHTML = LUCIDE_SVGS[act.icon];
      if (iconWrap.style) {
        iconWrap.style.display = "inline-flex";
        iconWrap.style.alignItems = "center";
        iconWrap.style.justifyContent = "center";
        iconWrap.style.width = "16px";
        iconWrap.style.height = "16px";
        iconWrap.style.color = tokens.foregroundMuted;
        iconWrap.style.flexShrink = "0";
      }
      item.appendChild?.(iconWrap);

      const labelSpan = doc.createElement("span");
      labelSpan.textContent = act.label;
      item.appendChild?.(labelSpan);

      item.addEventListener?.("mouseenter", () => {
        if (item.style) item.style.backgroundColor = tokens.surface2;
      });
      item.addEventListener?.("mouseleave", () => {
        if (item.style) item.style.backgroundColor = "transparent";
      });
      item.addEventListener?.("click", (ev) => {
        const me = ev as MinimalMouseEvent;
        me.preventDefault?.();
        me.stopPropagation?.();
        removeMenu();
        if (act.copy) {
          void callbacks.onCopyPath(filePath);
        } else if (act.target) {
          void callbacks.onOpenTarget(filePath, act.target);
        }
      });
      container.appendChild?.(item);
    }

    doc.body.appendChild?.(container);
    activeMenuEl = container;
  };

  const showQuickThreadMetadataBar = async (mode: "rename" | "labels") => {
    removeMenu();
    if (!doc.body || !callbacks.onFetchThreadMetadata) return;

    const tokens = syncPaseoThemeCssVariables(doc, win);
    const catalog = getCatalogForLocale(resolveLocale());
    const activeWsId = resolveCurrentActiveWorkspaceId(
      doc,
      win,
      callbacks.getFallbackWorkspaceId?.(),
    );
    const snap = await callbacks.onFetchThreadMetadata(activeWsId).catch(() => null);
    if (!snap || !doc.body) return;

    const container = doc.createElement("div");
    container.setAttribute?.("data-testid", "paseo-finder-quick-thread-bar");
    container.setAttribute?.("role", "dialog");
    const winW = win.innerWidth ?? 1200;
    const leftPx = Math.max(16, Math.floor((winW - 440) / 2));

    if (container.style) {
      container.style.position = "fixed";
      container.style.left = `${leftPx}px`;
      container.style.top = "56px";
      container.style.width = "440px";
      container.style.zIndex = "2147483647";
      container.style.backgroundColor = tokens.surface0;
      container.style.border = `1px solid ${tokens.border}`;
      container.style.borderRadius = "8px";
      container.style.padding = "12px";
      container.style.boxShadow = tokens.shadowLg;
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.gap = "10px";
      container.style.fontFamily =
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    }

    const headerTitle = doc.createElement("div");
    headerTitle.textContent = catalog.browser.threadMetaTitle;
    if (headerTitle.style) {
      headerTitle.style.fontSize = "12px";
      headerTitle.style.fontWeight = "600";
      headerTitle.style.color = tokens.foreground;
    }
    container.appendChild?.(headerTitle);

    // 1. Rename Row
    const renameRow = doc.createElement("div");
    if (renameRow.style) {
      renameRow.style.display = "flex";
      renameRow.style.flexDirection = "row";
      renameRow.style.gap = "6px";
      renameRow.style.alignItems = "center";
    }

    const titleInput = doc.createElement("input");
    titleInput.value = snap.workspaceTitle;
    titleInput.placeholder = catalog.browser.threadNamePlaceholder;
    if (titleInput.style) {
      titleInput.style.flex = "1";
      titleInput.style.backgroundColor = tokens.surface1;
      titleInput.style.border = `1px solid ${tokens.border}`;
      titleInput.style.borderRadius = "6px";
      titleInput.style.padding = "6px 10px";
      titleInput.style.color = tokens.foreground;
      titleInput.style.fontSize = "13px";
      titleInput.style.outline = "none";
    }

    const saveBtn = doc.createElement("div");
    saveBtn.textContent = catalog.actions.saveTitle;
    if (saveBtn.style) {
      saveBtn.style.backgroundColor = tokens.primary;
      saveBtn.style.color = tokens.primaryForeground;
      saveBtn.style.fontWeight = "500";
      saveBtn.style.fontSize = "12px";
      saveBtn.style.padding = "6px 10px";
      saveBtn.style.borderRadius = "6px";
      saveBtn.style.cursor = "pointer";
      saveBtn.style.userSelect = "none";
    }

    const triggerSaveTitle = () => {
      const nextVal = (titleInput.value ?? "").trim();
      removeMenu();
      void callbacks.onRenameThread?.(nextVal || null, {
        workspaceId: snap.workspaceId,
        source: "ui",
      });
    };

    saveBtn.addEventListener?.("click", (ev) => {
      const me = ev as MinimalMouseEvent;
      me.preventDefault?.();
      me.stopPropagation?.();
      triggerSaveTitle();
    });

    titleInput.addEventListener?.("keydown", (ev) => {
      const ke = ev as MinimalKeyboardEvent;
      if (ke.key === "Enter") {
        ke.preventDefault?.();
        triggerSaveTitle();
      } else if (ke.key === "Escape") {
        ke.preventDefault?.();
        removeMenu();
      }
    });

    renameRow.appendChild?.(titleInput);
    renameRow.appendChild?.(saveBtn);
    container.appendChild?.(renameRow);

    // 2. Existing Label Chips Row
    const chipsWrap = doc.createElement("div");
    if (chipsWrap.style) {
      chipsWrap.style.display = "flex";
      chipsWrap.style.flexDirection = "row";
      chipsWrap.style.flexWrap = "wrap";
      chipsWrap.style.gap = "6px";
    }

    let currentAssigned = new Set<string>(snap.assignedLabels);
    let currentCatalog = [...snap.catalog];

    const renderChips = () => {
      if (chipsWrap.innerHTML !== undefined) {
        chipsWrap.innerHTML = "";
      }
      for (const entry of currentCatalog) {
        const isAssigned = currentAssigned.has(entry.name);
        const chip = doc.createElement("div");
        const dotColor = LABEL_COLOR_HEX[entry.color] ?? LABEL_COLOR_HEX.violet;
        if (chip.style) {
          chip.style.display = "flex";
          chip.style.flexDirection = "row";
          chip.style.alignItems = "center";
          chip.style.gap = "5px";
          chip.style.padding = "4px 8px";
          chip.style.borderRadius = "999px";
          chip.style.fontSize = "12px";
          chip.style.cursor = "pointer";
          chip.style.userSelect = "none";
          chip.style.backgroundColor = isAssigned ? `${dotColor}1f` : tokens.surface2;
          chip.style.border = isAssigned ? `1px solid ${dotColor}` : `1px solid ${tokens.border}`;
          chip.style.color = tokens.foreground;
        }
        const dot = doc.createElement("span");
        if (dot.style) {
          dot.style.width = "8px";
          dot.style.height = "8px";
          dot.style.borderRadius = "999px";
          dot.style.backgroundColor = dotColor;
          dot.style.display = "inline-block";
        }
        const txt = doc.createElement("span");
        txt.textContent = isAssigned ? `${entry.name} ✓` : entry.name;
        chip.appendChild?.(dot);
        chip.appendChild?.(txt);

        chip.addEventListener?.("click", (ev) => {
          const me = ev as MinimalMouseEvent;
          me.preventDefault?.();
          me.stopPropagation?.();
          void callbacks
            .onToggleLabel?.(entry.name, entry.color, snap.workspaceId)
            .then((updated) => {
            if (updated) {
              currentAssigned = new Set(updated.assignedLabels);
              currentCatalog = [...updated.catalog];
              renderChips();
            }
          });
        });
        chipsWrap.appendChild?.(chip);
      }
    };

    renderChips();
    container.appendChild?.(chipsWrap);

    // 3. New Label Row
    const newLabelRow = doc.createElement("div");
    if (newLabelRow.style) {
      newLabelRow.style.display = "flex";
      newLabelRow.style.flexDirection = "row";
      newLabelRow.style.gap = "6px";
      newLabelRow.style.alignItems = "center";
    }

    const labelInput = doc.createElement("input");
    labelInput.placeholder = catalog.browser.newLabelPlaceholder;
    if (labelInput.style) {
      labelInput.style.flex = "1";
      labelInput.style.backgroundColor = tokens.surface1;
      labelInput.style.border = `1px solid ${tokens.border}`;
      labelInput.style.borderRadius = "6px";
      labelInput.style.padding = "5px 10px";
      labelInput.style.color = tokens.foreground;
      labelInput.style.fontSize = "12px";
      labelInput.style.outline = "none";
    }

    let selectedColor: WorkspaceLabelColor = "amber";
    const colorDotsWrap = doc.createElement("div");
    if (colorDotsWrap.style) {
      colorDotsWrap.style.display = "flex";
      colorDotsWrap.style.flexDirection = "row";
      colorDotsWrap.style.gap = "4px";
      colorDotsWrap.style.alignItems = "center";
    }

    const renderColorDots = () => {
      if (colorDotsWrap.innerHTML !== undefined) {
        colorDotsWrap.innerHTML = "";
      }
      for (const c of WORKSPACE_LABEL_COLORS.slice(0, 6)) {
        const dotBtn = doc.createElement("div");
        if (dotBtn.style) {
          dotBtn.style.width = "14px";
          dotBtn.style.height = "14px";
          dotBtn.style.borderRadius = "999px";
          dotBtn.style.backgroundColor = LABEL_COLOR_HEX[c];
          dotBtn.style.cursor = "pointer";
          dotBtn.style.border =
            selectedColor === c ? `2px solid ${tokens.foreground}` : "1px solid transparent";
        }
        dotBtn.addEventListener?.("click", (ev) => {
          const me = ev as MinimalMouseEvent;
          me.preventDefault?.();
          me.stopPropagation?.();
          selectedColor = c;
          renderColorDots();
        });
        colorDotsWrap.appendChild?.(dotBtn);
      }
    };
    renderColorDots();

    const addLabelBtn = doc.createElement("div");
    addLabelBtn.textContent = catalog.actions.addLabel;
    if (addLabelBtn.style) {
      addLabelBtn.style.backgroundColor = tokens.surface2;
      addLabelBtn.style.border = `1px solid ${tokens.border}`;
      addLabelBtn.style.color = tokens.foreground;
      addLabelBtn.style.fontSize = "12px";
      addLabelBtn.style.padding = "5px 8px";
      addLabelBtn.style.borderRadius = "6px";
      addLabelBtn.style.cursor = "pointer";
      addLabelBtn.style.userSelect = "none";
    }

    const triggerAddLabel = () => {
      const nameVal = (labelInput.value ?? "").trim();
      if (!nameVal) return;
      labelInput.value = "";
      void callbacks
        .onToggleLabel?.(nameVal, selectedColor, snap.workspaceId)
        .then((updated) => {
        if (updated) {
          currentAssigned = new Set(updated.assignedLabels);
          currentCatalog = [...updated.catalog];
          renderChips();
        }
      });
    };

    addLabelBtn.addEventListener?.("click", (ev) => {
      const me = ev as MinimalMouseEvent;
      me.preventDefault?.();
      me.stopPropagation?.();
      triggerAddLabel();
    });

    labelInput.addEventListener?.("keydown", (ev) => {
      const ke = ev as MinimalKeyboardEvent;
      if (ke.key === "Enter") {
        ke.preventDefault?.();
        triggerAddLabel();
      } else if (ke.key === "Escape") {
        ke.preventDefault?.();
        removeMenu();
      }
    });

    newLabelRow.appendChild?.(labelInput);
    newLabelRow.appendChild?.(colorDotsWrap);
    newLabelRow.appendChild?.(addLabelBtn);
    container.appendChild?.(newLabelRow);

    doc.body.appendChild?.(container);
    activeMenuEl = container;

    setTimeout(() => {
      if (mode === "labels") {
        labelInput.focus?.();
      } else {
        const renamePrefs = readInlineRenamePreferences(win.localStorage);
        applyInlineInputCaret(titleInput, renamePrefs.inlineRenameCaretPosition);
      }
    }, 10);
  };

  const startInlineRename = (
    target: InlineRenameTarget,
    options?: { caretPosition?: InlineRenameCaretPosition },
  ) => {
    activeInlineSession?.cancel();
    removeMenu();
    activeInlineSession = mountInlineTitleInput(
      doc,
      win,
      target,
      async (nextTitle, meta) => {
        await callbacks.onRenameThread?.(nextTitle, meta);
      },
      () => {
        activeInlineSession = null;
      },
      options,
    );
  };

  let tabMenuRafId: number | null = null;
  let observer: InstanceType<NonNullable<MinimalWindow["MutationObserver"]>> | null = null;
  const autoHealedBannerByWs = new Map<string, number>();
  let lastObservedWorkspaceId: string | undefined = resolveCurrentActiveWorkspaceId(
    doc,
    win,
  );
  let lastSidebarDirectClickWsId: string | null = null;
  let lastSidebarDirectClickAtMs = 0;
  let pendingCommandCenterHint: {
    workspaceId?: string;
    candidateProjectNames: string[];
    atMs: number;
  } | null = null;

  // Ensure CSS variables, inline /skill autocomplete bridge, and arrival-pulse styles are active
  ensureInlineRenameStyleTag(doc, win);
  ensureAntigravityInlineSkillAutocompleteBridge(win);
  clearSidebarJumpFlashes(doc);

  const triggerAutoRevealForWorkspace = (
    workspaceId: string,
    candidateProjectNames?: string[],
  ) => {
    const cleanWsId = workspaceId.trim();
    if (!cleanWsId) return;
    const jumpPrefs = readQuickJumpPreferences(win.localStorage);
    if (!jumpPrefs.autoRevealActiveWorkspaceInSidebar) return;

    revealWorkspaceInSidebar(
      {
        workspaceId: cleanWsId,
        candidateProjectNames,
        highlightFlash: true,
      },
      doc,
      win,
    );

    if (
      callbacks.onResolveWorkspaceProject &&
      !findSidebarWorkspaceRow(doc, cleanWsId)
    ) {
      void Promise.resolve(callbacks.onResolveWorkspaceProject(cleanWsId))
        .then((meta) => {
          if (!meta) return;
          if (findSidebarWorkspaceRow(doc, cleanWsId)) return;
          revealWorkspaceInSidebar(
            {
              workspaceId: cleanWsId,
              projectId: meta.projectId,
              projectKey: meta.projectKey,
              projectName: meta.projectName,
              candidateProjectNames,
              highlightFlash: true,
            },
            doc,
            win,
          );
        })
        .catch(() => {});
    }
  };

  const checkActiveWorkspaceRouteSync = () => {
    const currentWsId = resolveCurrentActiveWorkspaceId(doc, win);
    if (!currentWsId || currentWsId === lastObservedWorkspaceId) {
      return;
    }
    lastObservedWorkspaceId = currentWsId;
    if (
      lastSidebarDirectClickWsId === currentWsId &&
      Date.now() - lastSidebarDirectClickAtMs < 650
    ) {
      return;
    }
    const hintNames =
      pendingCommandCenterHint && Date.now() - pendingCommandCenterHint.atMs < 3000
        ? pendingCommandCenterHint.candidateProjectNames
        : undefined;
    triggerAutoRevealForWorkspace(currentWsId, hintNames);
  };

  const decorateTimelineSyncErrorBanner = (): number => {
    if (!callbacks.onHealAgentHistory) return 0;
    const banners = doc.querySelectorAll('[data-testid="agent-timeline-sync-error"]');
    if (!banners || banners.length === 0) return 0;
    let decorated = 0;
    const isZh = (resolveLocale() ?? "").toLowerCase().startsWith("zh");
    for (let i = 0; i < banners.length; i += 1) {
      const banner = banners[i];
      if (!banner) continue;
      if (banner.getAttribute?.("data-paseo-finder-history-heal") === "true") continue;
      banner.setAttribute?.("data-paseo-finder-history-heal", "true");
      const retryBtn = banner.querySelector?.('[data-testid="agent-timeline-sync-retry"]');
      const parent = retryBtn?.parentElement ?? banner;
      const tokens = syncPaseoThemeCssVariables(doc, win);
      const healBtn = doc.createElement("div");
      healBtn.setAttribute?.("data-testid", "paseo-finder-agent-history-heal-btn");
      healBtn.setAttribute?.("role", "button");
      healBtn.textContent = isZh ? "恢复记录" : "Heal History";
      if (healBtn.style) {
        healBtn.style.display = "inline-flex";
        healBtn.style.alignItems = "center";
        healBtn.style.padding = "4px 9px";
        healBtn.style.marginLeft = "6px";
        healBtn.style.borderRadius = "6px";
        healBtn.style.fontSize = "11.5px";
        healBtn.style.fontWeight = "600";
        healBtn.style.cursor = "pointer";
        healBtn.style.userSelect = "none";
        healBtn.style.backgroundColor = tokens.surface2;
        healBtn.style.border = `1px solid ${tokens.border}`;
        healBtn.style.color = tokens.foreground;
      }
      const triggerHeal = (autoTriggered: boolean) => {
        const wsId =
          resolveCurrentActiveWorkspaceId(doc, win) ?? callbacks.getFallbackWorkspaceId?.();
        healBtn.textContent = isZh ? "正在恢复..." : "Healing...";
        void callbacks
          .onHealAgentHistory?.(wsId)
          .then((res) => {
            healBtn.textContent = isZh ? "已恢复 · 重试中" : "Healed · Retrying";
            const liveRetry = doc.querySelector('[data-testid="agent-timeline-sync-retry"]');
            liveRetry?.click?.();
            if (res?.message && !autoTriggered) {
              showDropReceiptToast(res.message, !res.ok);
            }
          })
          .catch(() => {
            healBtn.textContent = isZh ? "恢复记录" : "Heal History";
          });
      };
      healBtn.addEventListener?.("click", (ev) => {
        const me = ev as MinimalMouseEvent;
        me.preventDefault?.();
        me.stopPropagation?.();
        triggerHeal(false);
      });
      parent.appendChild?.(healBtn);
      decorated += 1;

      const wsKey =
        resolveCurrentActiveWorkspaceId(doc, win) ??
        callbacks.getFallbackWorkspaceId?.() ??
        "default";
      const lastAt = autoHealedBannerByWs.get(wsKey) ?? 0;
      if (Date.now() - lastAt > 45_000) {
        autoHealedBannerByWs.set(wsKey, Date.now());
        setTimeout(() => {
          triggerHeal(true);
        }, 120);
      }
    }
    return decorated;
  };

  const runTabMenuInjectPass = () => {
    checkActiveWorkspaceRouteSync();
    const count =
      injectIntoNativeTabMenus(doc, callbacks, lastRightClickedTabPath, win) +
      decorateTimelineSyncErrorBanner();
    if (count > 0) {
      observer?.takeRecords?.();
    }
  };

  const scheduleNativeTabMenuExtension = () => {
    runTabMenuInjectPass();
    win.requestAnimationFrame?.(() => {
      runTabMenuInjectPass();
    });
    setTimeout(() => {
      runTabMenuInjectPass();
    }, 20);
  };

  observer =
    win.MutationObserver && doc.body
      ? new win.MutationObserver(() => {
          if (win.requestAnimationFrame) {
            if (tabMenuRafId !== null) return;
            tabMenuRafId = win.requestAnimationFrame(() => {
              tabMenuRafId = null;
              runTabMenuInjectPass();
            });
          } else {
            runTabMenuInjectPass();
          }
        })
      : null;

  if (observer && doc.body) {
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  const onPointerDownCapture = (ev: unknown) => {
    if (!activeInlineSession) return;
    const me = ev as MinimalMouseEvent;
    if (
      me.target !== activeInlineSession.inputEl &&
      !activeInlineSession.inputEl.contains?.(me.target)
    ) {
      activeInlineSession.markOutsidePointerDown();
    }
  };

  const onClickCapture = (ev: unknown) => {
    if (!callbacks.isEnabled()) return;
    const me = ev as MinimalMouseEvent;
    const prefs = readInlineRenamePreferences(win.localStorage);
    if (!prefs.enableDesktopContextMenuHelper) return;

    if (activeMenuEl && (!me.target || !activeMenuEl.contains?.(me.target))) {
      removeMenu();
    }

    // Programmatic `.click()` (our own reveal/expand presses, other plugins) is not a user
    // choice. Treating it as one re-entered the reveal and froze the window (T-028).
    const isUserClick = (ev as { isTrusted?: boolean }).isTrusted !== false;

    // Track direct clicks on left sidebar workspace rows so we don't re-scroll what's already under the cursor,
    // and immediately clear any active jump-flash or lingering inline selection styles on other rows.
    let currClickEl: MinimalElement | null = isUserClick ? me.target : null;
    for (let depth = 0; currClickEl && depth < 8; depth += 1) {
      const tid = currClickEl.getAttribute?.("data-testid") ?? "";
      if (tid.startsWith("sidebar-workspace-row-")) {
        clearSidebarJumpFlashes(doc);
        const parsed = parseSidebarWorkspaceRowTestId(tid);
        if (parsed?.workspaceId) {
          lastSidebarDirectClickWsId = parsed.workspaceId;
          lastSidebarDirectClickAtMs = Date.now();
        }
        break;
      }
      if (tid.startsWith("sidebar-project-row-")) {
        clearSidebarJumpFlashes(doc);
        break;
      }
      currClickEl = currClickEl.parentElement ?? null;
    }

    // Detect clicks on Workspace or Agent rows inside Paseo's native Search / CommandCenter (⌘K / ⌘F)
    const ccHint = isUserClick ? extractCommandCenterSelectionHint(me.target, doc) : null;
    if (ccHint) {
      pendingCommandCenterHint = {
        ...ccHint,
        atMs: Date.now(),
      };
      if (ccHint.workspaceId) {
        lastObservedWorkspaceId = ccHint.workspaceId;
        triggerAutoRevealForWorkspace(
          ccHint.workspaceId,
          ccHint.candidateProjectNames,
        );
      } else {
        for (const delayMs of [35, 130, 280]) {
          setTimeout(() => {
            checkActiveWorkspaceRouteSync();
          }, delayMs);
        }
      }
    }

    // Option+Click (Alt+Click) on any file link or file tab immediately reveals in Finder
    if (me.altKey && me.button === 0) {
      const detected = extractFilePathFromElement(me.target, doc);
      if (detected) {
        me.preventDefault();
        me.stopPropagation();
        void callbacks.onOpenTarget(detected, "finder-reveal");
        return;
      }
    }

    // ⌘+Click (Cmd+Click / Ctrl+Click) on file links, pills, tabs, or left sidebar rows directly opens in system default app / Finder
    if (
      prefs.enableCmdClickOpenSystemDefault &&
      (me.metaKey || me.ctrlKey) &&
      !me.altKey &&
      me.button === 0
    ) {
      // 1. Check if left sidebar workspace or project row was clicked
      if (prefs.enableSidebarCmdClickFinder) {
        let sidebarTargetEl: MinimalElement | null = isUserClick ? me.target : null;
        for (let depth = 0; sidebarTargetEl && depth < 8; depth += 1) {
          const tid = sidebarTargetEl.getAttribute?.("data-testid") ?? "";
          if (tid.startsWith("sidebar-workspace-row-")) {
            const parsed = parseSidebarWorkspaceRowTestId(tid);
            if (parsed?.workspaceId) {
              me.preventDefault();
              me.stopPropagation();
              void callbacks.onOpenTarget(".", "finder-folder", parsed.workspaceId);
              return;
            }
            break;
          }
          if (tid.startsWith("sidebar-project-row-")) {
            const projName = (sidebarTargetEl.textContent ?? "").trim();
            me.preventDefault();
            me.stopPropagation();
            void callbacks.onOpenTarget(".", "finder-folder", undefined, projName);
            return;
          }
          sidebarTargetEl = sidebarTargetEl.parentElement ?? null;
        }
      }

      // 2. Check if a file link, tool-call pill, code block, or file tab was clicked
      const detected = extractFilePathFromElement(me.target, doc);
      if (detected) {
        me.preventDefault();
        me.stopPropagation();
        const targetOpener = prefs.cmdClickDefaultTarget ?? "system-default";
        void callbacks.onOpenTarget(detected, targetOpener);
        return;
      }
    }

    // Rapid 2nd-click fallback across row remounts: if Click 1 selected a workspace row
    // and remounted its DOM node before native `dblclick` fired, a second click within 360ms
    // on the same target key triggers inline rename seamlessly.
    if (
      prefs.enableInlineDoubleClickRename &&
      !activeInlineSession &&
      me.button === 0 &&
      !me.altKey &&
      !me.ctrlKey &&
      !me.metaKey
    ) {
      const inlineTarget = resolveInlineRenameTarget(
        me.target,
        doc,
        win,
        callbacks.getFallbackWorkspaceId?.(),
      );
      if (inlineTarget) {
        const now = Date.now();
        const prev = lastClickTracker;
        if (
          prev &&
          prev.targetKey === inlineTarget.targetKey &&
          now - prev.atMs <= 360 &&
          Math.hypot((me.clientX || 0) - prev.x, (me.clientY || 0) - prev.y) <= 12
        ) {
          lastClickTracker = null;
          me.preventDefault();
          me.stopPropagation();
          const liveTarget =
            resolveLiveInlineRenameTargetByKey(
              inlineTarget.targetKey,
              doc,
              win,
              callbacks.getFallbackWorkspaceId?.(),
            ) ?? inlineTarget;
          startInlineRename(liveTarget);
          return;
        }
        lastClickTracker = {
          targetKey: inlineTarget.targetKey,
          atMs: now,
          x: me.clientX || 0,
          y: me.clientY || 0,
        };
      } else {
        lastClickTracker = null;
      }
    }
  };

  const onContextMenuCapture = (ev: unknown) => {
    if (!callbacks.isEnabled()) return;
    const prefs = readInlineRenamePreferences(win.localStorage);
    if (!prefs.enableDesktopContextMenuHelper) return;
    const me = ev as MinimalMouseEvent;

    // 1. Inside Paseo's File Explorer or existing context menu: let Paseo's native menu handle it
    if (isInsideFileExplorer(me.target) || isEditableInput(me.target)) {
      removeMenu();
      return;
    }

    // 2. Inside a Paseo Workspace Tab: DO NOT pop up a second floating menu!
    // Instead, extend Paseo's official native tab context menu in-place right below "Copy file path".
    if (isInsideWorkspaceTab(me.target)) {
      removeMenu();
      lastRightClickedTabPath = extractFilePathFromElement(me.target, doc);
      scheduleNativeTabMenuExtension();
      return;
    }

    // 3. Inline file path in chat / markdown / tool output (where Paseo has no native context menu):
    const detected = extractFilePathFromElement(me.target, doc);
    if (!detected) {
      removeMenu();
      return;
    }

    // Prevent Electron's fallback "Copy / Paste / Select All" OS menu from overlapping!
    me.preventDefault();
    me.stopPropagation();
    showChatLinkContextMenu(me.clientX, me.clientY, detected);
  };

  const onDblClickCapture = (ev: unknown) => {
    if (!callbacks.isEnabled()) return;
    const prefs = readInlineRenamePreferences(win.localStorage);
    if (!prefs.enableDesktopContextMenuHelper) return;
    const me = ev as MinimalMouseEvent;

    if (prefs.enableInlineDoubleClickRename) {
      const target = resolveInlineRenameTarget(
        me.target,
        doc,
        win,
        callbacks.getFallbackWorkspaceId?.(),
      );
      if (target) {
        me.preventDefault();
        me.stopPropagation();
        lastClickTracker = null;
        // If rapid 2nd-click in onClickCapture already mounted the inline session on this exact target,
        // do NOT tear down and re-mount it on the trailing dblclick event (unless Option/Alt was held to invert caret mode).
        if (activeInlineSession?.target.targetKey === target.targetKey && !me.altKey) {
          return;
        }
        const overrideCaret: InlineRenameCaretPosition | undefined = me.altKey
          ? prefs.inlineRenameCaretPosition === "start"
            ? "select-all"
            : "start"
          : undefined;
        startInlineRename(target, overrideCaret ? { caretPosition: overrideCaret } : undefined);
        return;
      }
    } else if (
      prefs.enableQuickRenameAndLabelShortcuts &&
      isInsideWorkspaceHeaderTitle(me.target)
    ) {
      me.preventDefault();
      me.stopPropagation();
      void showQuickThreadMetadataBar("rename");
    }
  };

  const onKeyDownCapture = (ev: unknown) => {
    if (!callbacks.isEnabled()) return;
    const ke = ev as MinimalKeyboardEvent;

    if (activeInlineSession && ke.target === activeInlineSession.inputEl) {
      if (ke.key === "Escape") {
        ke.preventDefault();
        ke.stopPropagation?.();
        activeInlineSession.cancel();
        return;
      }
      if (ke.key === "Enter") {
        if (ke.isComposing || ke.keyCode === 229) {
          return;
        }
        ke.preventDefault();
        ke.stopPropagation?.();
        void activeInlineSession.commit();
        return;
      }
      return;
    }

    const prefs = readInlineRenamePreferences(win.localStorage);
    if (!prefs.enableDesktopContextMenuHelper) return;

    if (ke.key === "Escape") {
      removeMenu();
      return;
    }
    // When pressing Enter inside Paseo's native Search / CommandCenter (⌘K / ⌘F), auto-reveal the selected workspace in the left sidebar
    if (
      ke.key === "Enter" &&
      !ke.isComposing &&
      ke.keyCode !== 229 &&
      doc.querySelector('[data-testid="command-center-panel"]')
    ) {
      const ccHint = extractCommandCenterSelectionHint(ke.target ?? null, doc);
      if (ccHint) {
        pendingCommandCenterHint = {
          ...ccHint,
          atMs: Date.now(),
        };
      }
      for (const delayMs of [30, 110, 240]) {
        setTimeout(() => {
          checkActiveWorkspaceRouteSync();
        }, delayMs);
      }
    }
    // Cmd+Shift+R reveals active file tab in Finder
    if ((ke.metaKey || ke.ctrlKey) && ke.shiftKey && ke.key.toLowerCase() === "r") {
      const activeFile = findActiveFileTabPath(doc);
      if (activeFile) {
        ke.preventDefault();
        void callbacks.onOpenTarget(activeFile, "finder-reveal");
      }
      return;
    }
    // F2 or Cmd+Shift+E triggers zero-popup inline rename (or falls back to Quick Bar if inline is disabled)
    if (
      prefs.enableQuickRenameAndLabelShortcuts &&
      ((ke.key === "F2" && !isEditableInput(ke.target ?? null)) ||
        ((ke.metaKey || ke.ctrlKey) && ke.shiftKey && ke.key.toLowerCase() === "e"))
    ) {
      ke.preventDefault();
      if (prefs.enableInlineDoubleClickRename) {
        const target = findF2InlineRenameTarget(
          doc,
          win,
          callbacks.getFallbackWorkspaceId?.(),
        );
        if (target) {
          startInlineRename(target);
          return;
        }
      }
      void showQuickThreadMetadataBar("rename");
      return;
    }
    // Option+D (Alt+D) or Option+Shift+D: Mark/unmark current session as done ("d " prefix)
    // and automatically jump/scroll left sidebar to its position with highlight flash
    if (
      prefs.enableMarkDoneShortcut &&
      isMarkDoneKeyboardEvent(ke) &&
      !activeInlineSession
    ) {
      ke.preventDefault();
      ke.stopPropagation?.();
      void toggleCurrentSessionDone({
        doc,
        win,
        callbacks,
        prefix: prefs.markDonePrefix ?? "d ",
      });
      return;
    }
    // Cmd+Shift+L opens Quick Workspace Rename & Labels Bar (focused on labels)
    if (
      prefs.enableQuickRenameAndLabelShortcuts &&
      (ke.metaKey || ke.ctrlKey) &&
      ke.shiftKey &&
      ke.key.toLowerCase() === "l"
    ) {
      ke.preventDefault();
      void showQuickThreadMetadataBar("labels");
      return;
    }
    // Cmd+J (Ctrl+J) or Cmd+Shift+O (Ctrl+Shift+O) opens Quick Project Workspace Switcher
    const jumpPrefs = readQuickJumpPreferences(win.localStorage);
    if (
      jumpPrefs.enableWorkspaceQuickJump &&
      callbacks.onListJumpProjects &&
      callbacks.onExecuteQuickJump &&
      (ke.metaKey || ke.ctrlKey) &&
      !ke.altKey &&
      ((!ke.shiftKey && ke.key.toLowerCase() === "j") ||
        (ke.shiftKey && ke.key.toLowerCase() === "o"))
    ) {
      ke.preventDefault();
      ke.stopPropagation?.();
      if (activeQuickJumpModalEl) {
        activeQuickJumpModalEl.remove?.();
        activeQuickJumpModalEl = null;
        return;
      }
      removeMenu();
      void openQuickWorkspaceSwitcherModal(
        {
          locale: resolveLocale(),
          defaultJumpMode: jumpPrefs.quickJumpDefaultAction,
          onListJumpProjects: (q) => callbacks.onListJumpProjects!(q),
          onExecuteQuickJump: (input) => callbacks.onExecuteQuickJump!(input),
          onAfterJump: (summary) => {
            showDropReceiptToast(summary.message, !summary.ok);
          },
          onDisposed: () => {
            activeQuickJumpModalEl = null;
          },
        },
        doc,
        win,
      ).then((el) => {
        activeQuickJumpModalEl = el;
      });
    }
  };

  let activeDropOverlayEl: MinimalElement | null = null;
  let activeDropWatchdog: ReturnType<typeof setTimeout> | null = null;
  let activeDropToastEl: MinimalElement | null = null;
  let activeDropToastTimer: ReturnType<typeof setTimeout> | null = null;

  const hideSidebarDropOverlay = () => {
    if (activeDropWatchdog) {
      clearTimeout(activeDropWatchdog);
      activeDropWatchdog = null;
    }
    if (activeDropOverlayEl) {
      activeDropOverlayEl.remove?.();
      activeDropOverlayEl = null;
    }
  };

  const showDropReceiptToast = (text: string, isError = false) => {
    if (!doc.body) return;
    if (activeDropToastTimer) {
      clearTimeout(activeDropToastTimer);
      activeDropToastTimer = null;
    }
    if (activeDropToastEl) {
      activeDropToastEl.remove?.();
      activeDropToastEl = null;
    }
    const tokens = syncPaseoThemeCssVariables(doc, win);
    const toastEl = doc.createElement("div");
    toastEl.setAttribute?.("data-testid", "paseo-finder-folder-drop-toast");
    toastEl.textContent = text;
    if (toastEl.style) {
      toastEl.style.position = "fixed";
      toastEl.style.left = "16px";
      toastEl.style.bottom = "16px";
      toastEl.style.zIndex = "10000";
      toastEl.style.maxWidth = "420px";
      toastEl.style.padding = "8px 14px";
      toastEl.style.borderRadius = "8px";
      toastEl.style.backgroundColor = tokens.surface0;
      toastEl.style.border = `1px solid ${isError ? tokens.destructive : tokens.border}`;
      toastEl.style.color = isError ? tokens.destructive : tokens.foreground;
      toastEl.style.fontSize = "12.5px";
      toastEl.style.fontWeight = "500";
      toastEl.style.boxShadow = tokens.shadowLg;
      toastEl.style.pointerEvents = "none";
      toastEl.style.fontFamily =
        "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif";
    }
    doc.body.appendChild?.(toastEl);
    activeDropToastEl = toastEl;
    activeDropToastTimer = setTimeout(() => {
      toastEl.remove?.();
      if (activeDropToastEl === toastEl) {
        activeDropToastEl = null;
      }
    }, 3200);
  };

  const showSidebarDropOverlay = (
    target: MinimalElement | null,
    forceNew: boolean,
  ) => {
    if (!doc.body) return;
    const tokens = syncPaseoThemeCssVariables(doc, win);
    const catalog = getCatalogForLocale(callbacks.getLocale?.() ?? win.navigator?.language);
    const container = findLeftSidebarContainer(doc, target);
    const rect = container?.getBoundingClientRect?.();

    const left = rect && rect.width > 40 ? Math.max(4, Math.round(rect.left) + 6) : 8;
    const top = rect && rect.height > 40 ? Math.max(4, Math.round(rect.top) + 6) : 38;
    const width =
      rect && rect.width > 40 ? Math.max(160, Math.round(rect.width) - 12) : 248;
    const height =
      rect && rect.height > 40
        ? Math.max(80, Math.round(rect.height) - 12)
        : Math.max(240, (win.innerHeight ?? 760) - 48);

    const accentHex = forceNew ? tokens.statusWarning : tokens.accent;
    const bgTint = forceNew ? tokens.statusWarningTint : tokens.statusSuccessTint;
    const titleText = forceNew
      ? catalog.actions.dropOverlayForceNewTitle
      : catalog.actions.dropOverlayTitle;
    const hintText = forceNew
      ? catalog.actions.dropOverlayForceNewHint
      : catalog.actions.dropOverlayHint;

    if (!activeDropOverlayEl) {
      const overlay = doc.createElement("div");
      overlay.setAttribute?.("data-testid", "paseo-finder-sidebar-drop-overlay");
      if (overlay.style) {
        overlay.style.position = "fixed";
        overlay.style.zIndex = "9998";
        overlay.style.pointerEvents = "none";
        overlay.style.borderRadius = "10px";
        overlay.style.display = "flex";
        overlay.style.flexDirection = "column";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.padding = "16px";
        overlay.style.boxSizing = "border-box";
        overlay.style.backdropFilter = "blur(2px)";
        overlay.style.fontFamily =
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif";
      }

      const card = doc.createElement("div");
      if (card.style) {
        card.style.backgroundColor = tokens.surface0;
        card.style.border = `1px solid ${tokens.border}`;
        card.style.borderRadius = "8px";
        card.style.padding = "12px 14px";
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.alignItems = "center";
        card.style.gap = "6px";
        card.style.textAlign = "center";
        card.style.maxWidth = "230px";
        card.style.boxShadow = tokens.shadowLg;
      }

      const iconWrap = doc.createElement("div");
      iconWrap.innerHTML = LUCIDE_SVGS.FolderPlus;
      if (iconWrap.style) {
        iconWrap.style.color = accentHex;
        iconWrap.style.display = "flex";
        iconWrap.style.alignItems = "center";
        iconWrap.style.justifyContent = "center";
      }

      const titleNode = doc.createElement("div");
      titleNode.setAttribute?.("data-role", "drop-title");
      if (titleNode.style) {
        titleNode.style.color = tokens.foreground;
        titleNode.style.fontSize = "12.5px";
        titleNode.style.fontWeight = "600";
        titleNode.style.lineHeight = "1.35";
      }

      const hintNode = doc.createElement("div");
      hintNode.setAttribute?.("data-role", "drop-hint");
      if (hintNode.style) {
        hintNode.style.color = tokens.foregroundMuted;
        hintNode.style.fontSize = "11px";
        hintNode.style.lineHeight = "1.35";
      }

      card.appendChild?.(iconWrap);
      card.appendChild?.(titleNode);
      card.appendChild?.(hintNode);
      overlay.appendChild?.(card);
      doc.body.appendChild?.(overlay);
      activeDropOverlayEl = overlay;
    }

    if (activeDropOverlayEl.style) {
      activeDropOverlayEl.style.left = `${left}px`;
      activeDropOverlayEl.style.top = `${top}px`;
      activeDropOverlayEl.style.width = `${width}px`;
      activeDropOverlayEl.style.height = `${height}px`;
      activeDropOverlayEl.style.border = `2px dashed ${accentHex}`;
      activeDropOverlayEl.style.backgroundColor = bgTint;
    }

    const titleEl = activeDropOverlayEl.querySelector?.('[data-role="drop-title"]');
    if (titleEl) titleEl.textContent = titleText;
    const hintEl = activeDropOverlayEl.querySelector?.('[data-role="drop-hint"]');
    if (hintEl) hintEl.textContent = hintText;

    if (activeDropWatchdog) {
      clearTimeout(activeDropWatchdog);
    }
    activeDropWatchdog = setTimeout(() => {
      hideSidebarDropOverlay();
    }, 240);
  };

  const canHandleSidebarFolderDrop = (de: MinimalDragEvent): boolean => {
    if (!callbacks.isEnabled() || !callbacks.onDropFolders) return false;
    const prefs = readSidebarDropPreferences(win.localStorage);
    if (!prefs.enabled) return false;
    if (!isExternalFileDragEvent(de)) return false;
    return isInsideSidebarDropZone(de.target, doc);
  };

  const onDragEnterOrOver = (ev: unknown) => {
    const de = ev as MinimalDragEvent;
    if (!canHandleSidebarFolderDrop(de)) {
      hideSidebarDropOverlay();
      return;
    }
    de.preventDefault();
    de.stopPropagation();
    if (de.dataTransfer) {
      de.dataTransfer.dropEffect = "copy";
    }
    const prefs = readSidebarDropPreferences(win.localStorage);
    const forceNew = Boolean(de.altKey) || prefs.defaultBehavior === "always-create";
    showSidebarDropOverlay(de.target, forceNew);
  };

  const onDragLeave = (ev: unknown) => {
    const de = ev as MinimalDragEvent;
    if (!de.relatedTarget || !isInsideSidebarDropZone(de.relatedTarget, doc)) {
      hideSidebarDropOverlay();
    }
  };

  const onDropCapture = (ev: unknown) => {
    const de = ev as MinimalDragEvent;
    if (!canHandleSidebarFolderDrop(de)) {
      hideSidebarDropOverlay();
      return;
    }
    de.preventDefault();
    de.stopPropagation();
    hideSidebarDropOverlay();

    const droppedPaths = extractDroppedFilePaths(de, win);
    if (droppedPaths.length === 0 || !callbacks.onDropFolders) {
      return;
    }

    const prefs = readSidebarDropPreferences(win.localStorage);
    const forceNew = Boolean(de.altKey) || prefs.defaultBehavior === "always-create";
    const catalog = getCatalogForLocale(callbacks.getLocale?.() ?? win.navigator?.language);

    void callbacks
      .onDropFolders(droppedPaths, { forceNew })
      .then((res) => {
        if (!res) return;
        if (!res.ok) {
          showDropReceiptToast(res.message, true);
          return;
        }
        if (res.primaryWorkspaceId) {
          focusWorkspaceInApp(res.primaryWorkspaceId, res.primaryProjectId, doc, win);
        }
        if (res.createdCount + res.reusedCount > 1) {
          showDropReceiptToast(
            `${catalog.actions.workspaceImportedBatchToast}: ${res.primaryWorkspaceName} (+${res.createdCount + res.reusedCount - 1})`,
          );
        } else if (res.createdCount > 0) {
          showDropReceiptToast(
            `${catalog.actions.workspaceCreatedToast}: ${res.primaryWorkspaceName}`,
          );
        } else {
          showDropReceiptToast(
            `${catalog.actions.workspaceReusedToast}: ${res.primaryWorkspaceName}`,
          );
        }
      })
      .catch((err) => {
        showDropReceiptToast(err instanceof Error ? err.message : String(err), true);
      });
  };

  const onPopState = () => {
    checkActiveWorkspaceRouteSync();
  };

  doc.addEventListener("pointerdown", onPointerDownCapture, true);
  doc.addEventListener("mousedown", onPointerDownCapture, true);
  doc.addEventListener("click", onClickCapture, true);
  doc.addEventListener("dblclick", onDblClickCapture, true);
  doc.addEventListener("contextmenu", onContextMenuCapture, true);
  doc.addEventListener("dragenter", onDragEnterOrOver, true);
  doc.addEventListener("dragover", onDragEnterOrOver, true);
  doc.addEventListener("dragleave", onDragLeave, true);
  doc.addEventListener("dragend", hideSidebarDropOverlay, true);
  doc.addEventListener("drop", onDropCapture, true);
  win.addEventListener("keydown", onKeyDownCapture, true);
  win.addEventListener("popstate", onPopState, false);
  win.addEventListener("blur", hideSidebarDropOverlay, false);

  return () => {
    if (activeDesktopRevealCallbacks === callbacks) {
      activeDesktopRevealCallbacks = null;
    }
    activeInlineSession?.cancel();
    removeMenu();
    hideSidebarDropOverlay();
    if (activeDropToastTimer) clearTimeout(activeDropToastTimer);
    activeDropToastEl?.remove?.();
    if (tabMenuRafId !== null) {
      win.cancelAnimationFrame?.(tabMenuRafId);
      tabMenuRafId = null;
    }
    observer?.disconnect();
    doc.removeEventListener("pointerdown", onPointerDownCapture, true);
    doc.removeEventListener("mousedown", onPointerDownCapture, true);
    doc.removeEventListener("click", onClickCapture, true);
    doc.removeEventListener("dblclick", onDblClickCapture, true);
    doc.removeEventListener("contextmenu", onContextMenuCapture, true);
    doc.removeEventListener("dragenter", onDragEnterOrOver, true);
    doc.removeEventListener("dragover", onDragEnterOrOver, true);
    doc.removeEventListener("dragleave", onDragLeave, true);
    doc.removeEventListener("dragend", hideSidebarDropOverlay, true);
    doc.removeEventListener("drop", onDropCapture, true);
    win.removeEventListener("keydown", onKeyDownCapture, true);
    win.removeEventListener("popstate", onPopState, false);
    win.removeEventListener("blur", hideSidebarDropOverlay, false);
  };
}
