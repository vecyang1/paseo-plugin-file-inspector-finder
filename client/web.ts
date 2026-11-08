import { Platform } from "react-native";
import {
  type InlineRenameSource,
  type OpenerTarget,
  type SidebarDropBehavior,
  SUPPORTED_IMAGE_EXTENSIONS,
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
} from "../shared/contracts";
import { getCatalogForLocale } from "./i18n";

export const LABEL_COLOR_HEX: Record<WorkspaceLabelColor, string> = {
  violet: "#8b5cf6",
  sky: "#0ea5e9",
  emerald: "#10b981",
  orange: "#f97316",
  pink: "#ec4899",
  indigo: "#6366f1",
  teal: "#14b8a6",
  red: "#ef4444",
  amber: "#f59e0b",
  blue: "#3b82f6",
};

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
  setSelectionRange?(start: number, end: number): void;
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
  };
  KeyboardEvent?: new (type: string, init?: Record<string, unknown>) => unknown;
  PopStateEvent?: new (type: string, init?: Record<string, unknown>) => unknown;
  requestAnimationFrame?(cb: () => void): number;
  addEventListener(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  removeEventListener(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  dispatchEvent?(event: unknown): boolean;
}

function getWebWindow(): MinimalWindow | null {
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

export interface InlineRenamePreferences {
  enableInlineDoubleClickRename: boolean;
  enableQuickRenameAndLabelShortcuts: boolean;
  enableDesktopContextMenuHelper: boolean;
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
    const merged: InlineRenamePreferences = {
      enableInlineDoubleClickRename:
        prefs.enableInlineDoubleClickRename ?? existing.enableInlineDoubleClickRename,
      enableQuickRenameAndLabelShortcuts:
        prefs.enableQuickRenameAndLabelShortcuts ??
        existing.enableQuickRenameAndLabelShortcuts,
      enableDesktopContextMenuHelper:
        prefs.enableDesktopContextMenuHelper ?? existing.enableDesktopContextMenuHelper,
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
    enableQuickRenameAndLabelShortcuts: true,
    enableDesktopContextMenuHelper: true,
  };
  if (!storage) return defaults;
  try {
    const raw = storage.getItem(INLINE_RENAME_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<keyof InlineRenamePreferences, unknown>>;
    return {
      enableInlineDoubleClickRename: parsed.enableInlineDoubleClickRename !== false,
      enableQuickRenameAndLabelShortcuts:
        parsed.enableQuickRenameAndLabelShortcuts !== false,
      enableDesktopContextMenuHelper: parsed.enableDesktopContextMenuHelper !== false,
    };
  } catch {
    return defaults;
  }
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

const FILE_PATH_TOKEN_REGEX =
  /(?:\/(?:Users|home|var|tmp|opt|etc)\/[^\s"'`<>()]+|[A-Za-z]:\\[^\s"'`<>()]+|~\/[^\s"'`<>()]+|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,8}|[A-Za-z0-9_-]{3,}\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico|avif|heic|tif|tiff|pdf|md|json|ts|tsx|py|html|css|mp4|mov))/i;

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

function ensureInlineRenameStyleTag(doc: MinimalDocument): void {
  const existing = doc.querySelector('style[data-paseo-finder-inline-rename-style="true"]');
  if (existing) return;
  const host = doc.head ?? doc.documentElement ?? doc.body;
  if (!host?.appendChild) return;
  const styleEl = doc.createElement("style");
  styleEl.setAttribute?.("data-paseo-finder-inline-rename-style", "true");
  styleEl.textContent = `
[data-paseo-inline-rename-hidden="true"] {
  display: none !important;
}
input[data-testid="paseo-finder-inline-rename-input"] {
  box-sizing: border-box;
  margin: 0 0 0 -3px;
  padding: 0 4px;
  border-radius: 4px;
  border: 1px solid rgba(59, 130, 246, 0.72);
  background-color: rgba(59, 130, 246, 0.10);
  outline: none;
  min-width: 56px;
  width: 100%;
  flex: 1 1 auto;
}
input[data-testid="paseo-finder-inline-rename-input"]::selection {
  background-color: rgba(37, 99, 235, 0.40);
}
[data-paseo-inline-rename-row="true"] [data-testid="sidebar-workspace-trailing-scrim"],
[data-paseo-inline-rename-row="true"] [data-testid^="sidebar-workspace-kebab-"],
[data-paseo-inline-rename-row="true"] [data-testid^="sidebar-workspace-archive-"] {
  opacity: 0 !important;
  pointer-events: none !important;
}
`;
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
): ActiveInlineRenameSession | null {
  const parent = target.titleEl.parentElement;
  if (!parent || (!parent.insertBefore && !parent.appendChild)) {
    return null;
  }

  ensureInlineRenameStyleTag(doc);

  const computed = win?.getComputedStyle?.(target.titleEl) ?? null;
  const inputEl = doc.createElement("input");
  inputEl.type = "text";
  inputEl.value = target.initialTitle;
  inputEl.placeholder = target.initialTitle || "Workspace title";
  inputEl.setAttribute?.("data-testid", "paseo-finder-inline-rename-input");
  inputEl.setAttribute?.("data-rename-surface", target.surface);
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
    inputEl.addEventListener?.(evtName, stopBubble);
  }

  inputEl.addEventListener?.("keydown", (ev) => {
    const ke = ev as MinimalKeyboardEvent;
    ke.stopPropagation?.();
    if (ke.isComposing || ke.keyCode === 229) {
      return;
    }
    if (ke.key === "Enter") {
      ke.preventDefault();
      void commitFromTrigger("enter");
    } else if (ke.key === "Escape") {
      ke.preventDefault();
      cancel();
    }
  });

  inputEl.addEventListener?.("blur", () => {
    if (settled) return;
    // Shield against Paseo's WorkspaceScreen composer auto-focus stealing focus ~30-220ms
    // after Click 1 of a double-click navigates to an unselected sidebar workspace row!
    if (!outsidePointerDown && Date.now() - mountedAt < 260) {
      inputEl.focus?.();
      inputEl.select?.();
      return;
    }
    void commitFromTrigger("blur");
  });

  win?.getSelection?.()?.removeAllRanges?.();
  inputEl.focus?.();
  inputEl.select?.();
  inputEl.setSelectionRange?.(0, target.initialTitle.length);
  win?.requestAnimationFrame?.(() => {
    if (!settled) {
      inputEl.focus?.();
      inputEl.select?.();
      inputEl.setSelectionRange?.(0, (inputEl.value ?? "").length);
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

    const href = curr.getAttribute?.("href") ?? "";
    if (href && !href.startsWith("http://") && !href.startsWith("https://")) {
      return href;
    }

    const text = (curr.textContent ?? "").trim();
    if (text && text.length < 260) {
      const match = text.match(FILE_PATH_TOKEN_REGEX);
      if (match) {
        const tooltips = doc.querySelectorAll('[data-testid*="tooltip"]');
        for (let i = 0; i < tooltips.length; i += 1) {
          const tipText = (tooltips[i]?.textContent ?? "").trim();
          if (tipText && tipText.includes(match[0]) && tipText.includes("/")) {
            const tipMatch = tipText.match(FILE_PATH_TOKEN_REGEX);
            if (tipMatch) return tipMatch[0];
          }
        }
        return match[0];
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

export interface DesktopRevealHelperCallbacks {
  isEnabled(): boolean;
  getLocale?(): string;
  getFallbackWorkspaceId?(): string | undefined;
  onOpenTarget(path: string, target: OpenerTarget): Promise<void>;
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

export function focusWorkspaceInApp(
  workspaceId: string,
  projectId?: string | null,
  docOverride?: MinimalDocument | null,
  winOverride?: MinimalWindow | null,
): boolean {
  const cleanId = workspaceId.trim();
  if (!cleanId) return false;
  const win = winOverride ?? getWebWindow();
  const doc = docOverride ?? win?.document ?? null;
  if (!doc) return false;

  const tryClickRowOnce = (allowExpandCollapsedProject: boolean): boolean => {
    const rows = doc.querySelectorAll('[data-testid^="sidebar-workspace-row-"]');
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const tid = row?.getAttribute?.("data-testid") ?? "";
      if (tid.endsWith(`:${cleanId}`) || tid === `sidebar-workspace-row-${cleanId}`) {
        row?.click?.();
        return true;
      }
    }
    if (allowExpandCollapsedProject && projectId) {
      const lists = doc.querySelectorAll('[data-testid^="sidebar-workspace-list-"]');
      let isExpanded = false;
      for (let i = 0; i < lists.length; i += 1) {
        const ltid = lists[i]?.getAttribute?.("data-testid") ?? "";
        if (ltid.endsWith(`:${projectId}`)) {
          isExpanded = true;
          break;
        }
      }
      if (!isExpanded) {
        const projRows = doc.querySelectorAll('[data-testid^="sidebar-project-row-"]');
        for (let i = 0; i < projRows.length; i += 1) {
          const prow = projRows[i];
          const ptid = prow?.getAttribute?.("data-testid") ?? "";
          if (ptid.endsWith(`:${projectId}`)) {
            prow?.click?.();
            break;
          }
        }
      }
    }
    return false;
  };

  if (tryClickRowOnce(false)) {
    return true;
  }

  let expandedTried = false;
  const retryDelays = [70, 160, 300, 520, 820];
  for (const delay of retryDelays) {
    setTimeout(() => {
      const currentPath = win?.location?.pathname ?? "";
      if (currentPath.endsWith(`/workspace/${encodeURIComponent(cleanId)}`)) {
        return;
      }
      const allowExpand = delay >= 160 && !expandedTried;
      if (allowExpand) expandedTried = true;
      const clicked = tryClickRowOnce(allowExpand);
      if (!clicked && delay >= 520 && win?.history?.pushState) {
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

export function installDesktopRevealHelpers(
  callbacks: DesktopRevealHelperCallbacks,
  docOverride?: MinimalDocument | null,
  winOverride?: MinimalWindow | null,
): () => void {
  if (!docOverride && !winOverride && Platform.OS !== "web") return () => {};
  const win = winOverride ?? getWebWindow();
  const doc = docOverride ?? win?.document ?? null;
  if (!win || !doc) return () => {};

  let activeMenuEl: MinimalElement | null = null;
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
  };

  const showChatLinkContextMenu = (x: number, y: number, filePath: string) => {
    removeMenu();
    if (!doc.body) return;

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
      container.style.backgroundColor = "#1b1f1e";
      container.style.border = "1px solid #2e3432";
      container.style.borderRadius = "8px";
      container.style.padding = "4px";
      container.style.boxShadow = "0 10px 24px rgba(0, 0, 0, 0.48)";
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.gap = "2px";
      container.style.minWidth = "210px";
      container.style.fontFamily =
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
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
          sep.style.backgroundColor = "#2e3432";
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
        item.style.color = "#e5e7eb";
        item.style.padding = "6px 8px";
        item.style.borderRadius = "6px";
        item.style.cursor = "pointer";
        item.style.userSelect = "none";
      }

      const iconWrap = doc.createElement("span");
      iconWrap.innerHTML = LUCIDE_SVGS[act.icon];
      if (iconWrap.style) {
        iconWrap.style.display = " inline-flex";
        iconWrap.style.alignItems = "center";
        iconWrap.style.justifyContent = "center";
        iconWrap.style.width = "16px";
        iconWrap.style.height = "16px";
        iconWrap.style.color = "#9ca3af";
        iconWrap.style.flexShrink = "0";
      }
      item.appendChild?.(iconWrap);

      const labelSpan = doc.createElement("span");
      labelSpan.textContent = act.label;
      item.appendChild?.(labelSpan);

      item.addEventListener?.("mouseenter", () => {
        if (item.style) item.style.backgroundColor = "rgba(255, 255, 255, 0.06)";
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
      container.style.backgroundColor = "#161918";
      container.style.border = "1px solid #2e3432";
      container.style.borderRadius = "10px";
      container.style.padding = "12px";
      container.style.boxShadow = "0 14px 32px rgba(0, 0, 0, 0.56)";
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.gap = "10px";
      container.style.fontFamily =
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    }

    const headerTitle = doc.createElement("div");
    headerTitle.textContent = catalog.browser.threadMetaTitle;
    if (headerTitle.style) {
      headerTitle.style.fontSize = "12px";
      headerTitle.style.fontWeight = "600";
      headerTitle.style.color = "#e5e7eb";
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
      titleInput.style.backgroundColor = "#0f1211";
      titleInput.style.border = "1px solid #2e3432";
      titleInput.style.borderRadius = "6px";
      titleInput.style.padding = "6px 10px";
      titleInput.style.color = "#f3f4f6";
      titleInput.style.fontSize = "13px";
      titleInput.style.outline = "none";
    }

    const saveBtn = doc.createElement("div");
    saveBtn.textContent = catalog.actions.saveTitle;
    if (saveBtn.style) {
      saveBtn.style.backgroundColor = "#10b981";
      saveBtn.style.color = "#052e16";
      saveBtn.style.fontWeight = "600";
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
          chip.style.backgroundColor = isAssigned ? "rgba(16, 185, 129, 0.16)" : "#222725";
          chip.style.border = isAssigned ? `1px solid ${dotColor}` : "1px solid #2e3432";
          chip.style.color = "#f3f4f6";
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
      labelInput.style.backgroundColor = "#0f1211";
      labelInput.style.border = "1px solid #2e3432";
      labelInput.style.borderRadius = "6px";
      labelInput.style.padding = "5px 10px";
      labelInput.style.color = "#f3f4f6";
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
          dotBtn.style.border = selectedColor === c ? "2px solid #ffffff" : "1px solid transparent";
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
      addLabelBtn.style.backgroundColor = "#222725";
      addLabelBtn.style.border = "1px solid #2e3432";
      addLabelBtn.style.color = "#e5e7eb";
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
        titleInput.focus?.();
        titleInput.select?.();
      }
    }, 10);
  };

  const startInlineRename = (target: InlineRenameTarget) => {
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
    );
  };

  const scheduleNativeTabMenuExtension = () => {
    injectIntoNativeTabMenus(doc, callbacks, lastRightClickedTabPath, win);
    win.requestAnimationFrame?.(() => {
      injectIntoNativeTabMenus(doc, callbacks, lastRightClickedTabPath, win);
    });
    setTimeout(() => {
      injectIntoNativeTabMenus(doc, callbacks, lastRightClickedTabPath, win);
    }, 20);
  };

  const observer =
    win.MutationObserver && doc.body
      ? new win.MutationObserver(() => {
          injectIntoNativeTabMenus(doc, callbacks, lastRightClickedTabPath, win);
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
        startInlineRename(target);
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
    // Cmd+Shift+L opens Quick Workspace Rename & Labels Bar (focused on labels)
    if (
      prefs.enableQuickRenameAndLabelShortcuts &&
      (ke.metaKey || ke.ctrlKey) &&
      ke.shiftKey &&
      ke.key.toLowerCase() === "l"
    ) {
      ke.preventDefault();
      void showQuickThreadMetadataBar("labels");
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
      toastEl.style.backgroundColor = isError ? "#2c1518" : "#13221c";
      toastEl.style.border = isError ? "1px solid #ef4444" : "1px solid #10b981";
      toastEl.style.color = "#f3f4f6";
      toastEl.style.fontSize = "12.5px";
      toastEl.style.fontWeight = "500";
      toastEl.style.boxShadow = "0 10px 28px rgba(0, 0, 0, 0.45)";
      toastEl.style.pointerEvents = "none";
      toastEl.style.fontFamily =
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif";
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

    const accentHex = forceNew ? "#f59e0b" : "#10b981";
    const bgTint = forceNew
      ? "rgba(245, 158, 11, 0.10)"
      : "rgba(16, 185, 129, 0.10)";
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
        overlay.style.borderRadius = "12px";
        overlay.style.display = "flex";
        overlay.style.flexDirection = "column";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.padding = "16px";
        overlay.style.boxSizing = "border-box";
        overlay.style.backdropFilter = "blur(3px)";
        overlay.style.fontFamily =
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif";
      }

      const card = doc.createElement("div");
      if (card.style) {
        card.style.backgroundColor = "rgba(17, 20, 19, 0.94)";
        card.style.border = `1px solid ${accentHex}`;
        card.style.borderRadius = "10px";
        card.style.padding = "12px 14px";
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.alignItems = "center";
        card.style.gap = "6px";
        card.style.textAlign = "center";
        card.style.maxWidth = "230px";
        card.style.boxShadow = "0 12px 30px rgba(0, 0, 0, 0.45)";
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
        titleNode.style.color = "#f9fafb";
        titleNode.style.fontSize = "12.5px";
        titleNode.style.fontWeight = "600";
        titleNode.style.lineHeight = "1.35";
      }

      const hintNode = doc.createElement("div");
      hintNode.setAttribute?.("data-role", "drop-hint");
      if (hintNode.style) {
        hintNode.style.color = "#9ca3af";
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
  win.addEventListener("blur", hideSidebarDropOverlay, false);

  return () => {
    activeInlineSession?.cancel();
    removeMenu();
    hideSidebarDropOverlay();
    if (activeDropToastTimer) clearTimeout(activeDropToastTimer);
    activeDropToastEl?.remove?.();
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
    win.removeEventListener("blur", hideSidebarDropOverlay, false);
  };
}
