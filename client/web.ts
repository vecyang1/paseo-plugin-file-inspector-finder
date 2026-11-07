import { Platform } from "react-native";
import { type OpenerTarget, SUPPORTED_IMAGE_EXTENSIONS } from "../shared/contracts";

interface MinimalStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface MinimalElement {
  tagName?: string;
  textContent?: string | null;
  parentElement?: MinimalElement | null;
  style?: Record<string, string>;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  closest?(selector: string): MinimalElement | null;
  querySelector?(selector: string): MinimalElement | null;
  querySelectorAll?(selector: string): ArrayLike<MinimalElement>;
  appendChild?(child: MinimalElement): void;
  remove?(): void;
  addEventListener?(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  removeEventListener?(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  contains?(other: MinimalElement | null): boolean;
}

interface MinimalMouseEvent {
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

interface MinimalKeyboardEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  preventDefault(): void;
}

interface MinimalDocument {
  body?: MinimalElement | null;
  createElement(tag: string): MinimalElement;
  querySelector(selector: string): MinimalElement | null;
  querySelectorAll(selector: string): ArrayLike<MinimalElement>;
  addEventListener(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  removeEventListener(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
}

interface MinimalWindow {
  localStorage?: MinimalStorage;
  document?: MinimalDocument;
  innerWidth?: number;
  innerHeight?: number;
  addEventListener(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
  removeEventListener(type: string, listener: (ev: unknown) => void, useCapture?: boolean): void;
}

function getWebWindow(): MinimalWindow | null {
  if (Platform.OS !== "web") return null;
  const g = globalThis as unknown as { window?: MinimalWindow };
  return g.window ?? null;
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

export function extractFilePathFromElement(
  el: MinimalElement | null,
  doc: MinimalDocument,
): string | null {
  let curr: MinimalElement | null = el;
  for (let depth = 0; curr && depth < 8; depth += 1) {
    const testId = curr.getAttribute?.("data-testid") ?? "";
    const fromClose = decodeTabCloseTestId(testId);
    if (fromClose) return fromClose;

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
        // Also check if a tooltip is currently visible in the DOM with a fuller relative path
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

export interface DesktopRevealHelperCallbacks {
  isEnabled(): boolean;
  onOpenTarget(path: string, target: OpenerTarget): Promise<void>;
  onCopyPath(path: string): Promise<void>;
}

export function installDesktopRevealHelpers(callbacks: DesktopRevealHelperCallbacks): () => void {
  if (Platform.OS !== "web") return () => {};
  const win = getWebWindow();
  const doc = win?.document;
  if (!win || !doc) return () => {};

  let activeMenuEl: MinimalElement | null = null;

  const removeMenu = () => {
    if (activeMenuEl) {
      activeMenuEl.remove?.();
      activeMenuEl = null;
    }
  };

  const showFloatingQuickMenu = (x: number, y: number, filePath: string) => {
    removeMenu();
    if (!doc.body) return;

    const container = doc.createElement("div");
    container.setAttribute?.("data-testid", "paseo-finder-quick-menu");
    const maxX = Math.max(16, Math.min(x, (win.innerWidth ?? 1200) - 340));
    const maxY = Math.max(16, Math.min(y + 8, (win.innerHeight ?? 800) - 200));

    if (container.style) {
      container.style.position = "fixed";
      container.style.left = `${maxX}px`;
      container.style.top = `${maxY}px`;
      container.style.zIndex = "2147483647";
      container.style.backgroundColor = "#18181b";
      container.style.border = "1px solid #3f3f46";
      container.style.borderRadius = "10px";
      container.style.padding = "6px";
      container.style.boxShadow = "0 12px 28px rgba(0, 0, 0, 0.55)";
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.gap = "4px";
      container.style.minWidth = "270px";
      container.style.fontFamily = "-apple-system, BlinkMacSystemFont, sans-serif";
    }

    const header = doc.createElement("div");
    header.textContent = `📍 ${filePath.split("/").pop() ?? filePath}`;
    if (header.style) {
      header.style.fontSize = "11px";
      header.style.color = "#a1a1aa";
      header.style.padding = "4px 8px";
      header.style.borderBottom = "1px solid #27272a";
      header.style.whiteSpace = "nowrap";
      header.style.overflow = "hidden";
      header.style.textOverflow = "ellipsis";
      header.style.maxWidth = "310px";
    }
    container.appendChild?.(header);

    const actions: { label: string; target?: OpenerTarget; copy?: boolean }[] = [
      { label: "📂 在 Finder 中显示 (Reveal in Finder)", target: "finder-reveal" },
      { label: "📁 打开所在文件夹 (Open Folder)", target: "finder-folder" },
      { label: "🖼️ 系统预览打开 (Open in Preview)", target: "system-preview" },
      { label: "💻 在 Antigravity 中打开", target: "antigravity" },
      { label: "📋 复制路径 (Copy Path)", copy: true },
    ];

    for (const act of actions) {
      const item = doc.createElement("div");
      item.textContent = act.label;
      if (item.style) {
        item.style.fontSize = "12.5px";
        item.style.color = "#f4f4f5";
        item.style.padding = "6px 10px";
        item.style.borderRadius = "6px";
        item.style.cursor = "pointer";
      }
      item.addEventListener?.("mouseenter", () => {
        if (item.style) item.style.backgroundColor = "#27272a";
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
    const detected = extractFilePathFromElement(me.target, doc);
    if (!detected) {
      removeMenu();
      return;
    }
    showFloatingQuickMenu(me.clientX, me.clientY, detected);
  };

  const onKeyDownCapture = (ev: unknown) => {
    if (!callbacks.isEnabled()) return;
    const ke = ev as MinimalKeyboardEvent;
    if (ke.key === "Escape") {
      removeMenu();
      return;
    }
    // Cmd+Shift+R or Cmd+Alt+R reveals active file tab in Finder
    if ((ke.metaKey || ke.ctrlKey) && ke.shiftKey && ke.key.toLowerCase() === "r") {
      const activeFile = findActiveFileTabPath(doc);
      if (activeFile) {
        ke.preventDefault();
        void callbacks.onOpenTarget(activeFile, "finder-reveal");
      }
    }
  };

  doc.addEventListener("click", onClickCapture, true);
  doc.addEventListener("contextmenu", onContextMenuCapture, true);
  win.addEventListener("keydown", onKeyDownCapture, true);

  return () => {
    removeMenu();
    doc.removeEventListener("click", onClickCapture, true);
    doc.removeEventListener("contextmenu", onContextMenuCapture, true);
    win.removeEventListener("keydown", onKeyDownCapture, true);
  };
}
