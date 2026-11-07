import { Platform } from "react-native";
import {
  type OpenerTarget,
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
  value?: string;
  placeholder?: string;
  parentElement?: MinimalElement | null;
  nextSibling?: MinimalElement | null;
  children?: ArrayLike<MinimalElement>;
  style?: Record<string, string>;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  closest?(selector: string): MinimalElement | null;
  querySelector?(selector: string): MinimalElement | null;
  querySelectorAll?(selector: string): ArrayLike<MinimalElement>;
  appendChild?(child: MinimalElement): void;
  insertBefore?(newNode: MinimalElement, referenceNode: MinimalElement | null): void;
  cloneNode?(deep?: boolean): MinimalElement;
  remove?(): void;
  focus?(): void;
  select?(): void;
  addEventListener?(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  removeEventListener?(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  contains?(other: MinimalElement | null): boolean;
}

export interface MinimalMouseEvent {
  clientX: number;
  clientY: number;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  button?: number;
  target: MinimalElement | null;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface MinimalKeyboardEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: MinimalElement | null;
  preventDefault(): void;
}

export interface MinimalDocument {
  body?: MinimalElement | null;
  documentElement?: MinimalElement | null;
  createElement(tag: string): MinimalElement;
  querySelector(selector: string): MinimalElement | null;
  querySelectorAll(selector: string): ArrayLike<MinimalElement>;
  addEventListener(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  removeEventListener(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  dispatchEvent?(event: unknown): boolean;
}

interface MinimalWindow {
  localStorage?: MinimalStorage;
  document?: MinimalDocument;
  navigator?: { language?: string };
  innerWidth?: number;
  innerHeight?: number;
  MutationObserver?: new (callback: () => void) => {
    observe(target: unknown, options: Record<string, boolean>): void;
    disconnect(): void;
  };
  KeyboardEvent?: new (type: string, init?: Record<string, unknown>) => unknown;
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

const LUCIDE_SVGS: Record<"FolderOpen" | "Folder" | "ExternalLink" | "Copy", string> = {
  FolderOpen:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>',
  Folder:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  ExternalLink:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  Copy:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
};

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

export interface DesktopRevealHelperCallbacks {
  isEnabled(): boolean;
  getLocale?(): string;
  onOpenTarget(path: string, target: OpenerTarget): Promise<void>;
  onCopyPath(path: string): Promise<void>;
  onFetchThreadMetadata?(): Promise<ThreadMetadataSnapshot | null>;
  onRenameThread?(newTitle: string | null): Promise<void>;
  onToggleLabel?(
    labelName: string,
    color?: WorkspaceLabelColor,
  ): Promise<ThreadMetadataSnapshot | null>;
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

export function installDesktopRevealHelpers(callbacks: DesktopRevealHelperCallbacks): () => void {
  if (Platform.OS !== "web") return () => {};
  const win = getWebWindow();
  const doc = win?.document;
  if (!win || !doc) return () => {};

  let activeMenuEl: MinimalElement | null = null;
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
    const snap = await callbacks.onFetchThreadMetadata().catch(() => null);
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
      void callbacks.onRenameThread?.(nextVal || null);
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
          void callbacks.onToggleLabel?.(entry.name, entry.color).then((updated) => {
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
      void callbacks.onToggleLabel?.(nameVal, selectedColor).then((updated) => {
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

  const onClickCapture = (ev: unknown) => {
    if (!callbacks.isEnabled()) return;
    const me = ev as MinimalMouseEvent;
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
      }
    }
  };

  const onContextMenuCapture = (ev: unknown) => {
    if (!callbacks.isEnabled()) return;
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
    const me = ev as MinimalMouseEvent;
    if (isInsideWorkspaceHeaderTitle(me.target)) {
      me.preventDefault();
      me.stopPropagation();
      void showQuickThreadMetadataBar("rename");
    }
  };

  const onKeyDownCapture = (ev: unknown) => {
    if (!callbacks.isEnabled()) return;
    const ke = ev as MinimalKeyboardEvent;
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
    // F2 or Cmd+Shift+E opens Quick Workspace Rename & Labels Bar (focused on title)
    if (
      (ke.key === "F2" && !isEditableInput(ke.target ?? null)) ||
      ((ke.metaKey || ke.ctrlKey) && ke.shiftKey && ke.key.toLowerCase() === "e")
    ) {
      ke.preventDefault();
      void showQuickThreadMetadataBar("rename");
      return;
    }
    // Cmd+Shift+L opens Quick Workspace Rename & Labels Bar (focused on labels)
    if ((ke.metaKey || ke.ctrlKey) && ke.shiftKey && ke.key.toLowerCase() === "l") {
      ke.preventDefault();
      void showQuickThreadMetadataBar("labels");
    }
  };

  doc.addEventListener("click", onClickCapture, true);
  doc.addEventListener("dblclick", onDblClickCapture, true);
  doc.addEventListener("contextmenu", onContextMenuCapture, true);
  win.addEventListener("keydown", onKeyDownCapture, true);

  return () => {
    removeMenu();
    observer?.disconnect();
    doc.removeEventListener("click", onClickCapture, true);
    doc.removeEventListener("dblclick", onDblClickCapture, true);
    doc.removeEventListener("contextmenu", onContextMenuCapture, true);
    win.removeEventListener("keydown", onKeyDownCapture, true);
  };
}
