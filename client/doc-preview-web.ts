/// <reference lib="dom" />
import { Platform } from "react-native";
import {
  type DocCompareLayout,
  type DocDropBehavior,
  type DocInteractionMode,
  type DocPdfRenderMode,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  clampPanScroll,
  computeNextZoomStep,
  computeSyncedScrollOffset,
  isSupportedCompareExtension,
  sanitizePreviewHtml,
} from "../shared/doc-preview-contracts";
import { requireMetroExport } from "./metro-registry";
import { syncPaseoThemeCssVariables } from "./theme-web";
import { cleanExtractedFilePath, getWebWindow } from "./web";

export const DOC_PREVIEW_PREFS_STORAGE_KEY = "paseo:finder-plugin:doc-preview-prefs";
export const DOC_PREVIEW_STATUS_EVENT = "paseo:finder-doc-preview-status";
export const DOC_PREVIEW_COMPARE_DROP_EVENT = "paseo:finder-doc-compare-drop";

export function subscribeDocPreviewStatus(listener: () => void): () => void {
  if (Platform.OS !== "web" || typeof window === "undefined") return () => {};
  window.addEventListener(DOC_PREVIEW_STATUS_EVENT, listener);
  return () => window.removeEventListener(DOC_PREVIEW_STATUS_EVENT, listener);
}

export function subscribeCompareDrop(
  workspaceId: string | undefined,
  onPathsDropped: (paths: string[]) => void,
): () => void {
  if (Platform.OS !== "web" || typeof window === "undefined") return () => {};
  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent<{ workspaceId?: string; paths?: string[] }>).detail;
    if (!detail?.paths || detail.paths.length === 0) return;
    if (detail.workspaceId && workspaceId && detail.workspaceId !== workspaceId) return;
    onPathsDropped(detail.paths);
  };
  window.addEventListener(DOC_PREVIEW_COMPARE_DROP_EVENT, handler);
  return () => window.removeEventListener(DOC_PREVIEW_COMPARE_DROP_EVENT, handler);
}

export interface DocPreviewPrefs {
  autoAssociateDocumentPanels: boolean;
  defaultInteractionMode: DocInteractionMode;
  defaultPdfMode: DocPdfRenderMode;
  defaultCompareLayout: DocCompareLayout;
  defaultDropBehavior: DocDropBehavior;
  enableSyncScrollInCompare: boolean;
  enablePaneFileDrop: boolean;
}

export const DEFAULT_DOC_PREVIEW_PREFS: DocPreviewPrefs = {
  autoAssociateDocumentPanels: true,
  defaultInteractionMode: "pan",
  defaultPdfMode: "canvas",
  defaultCompareLayout: "split",
  defaultDropBehavior: "compare",
  enableSyncScrollInCompare: true,
  enablePaneFileDrop: true,
};

export interface DocPreviewRuntimeStatus {
  prefs: DocPreviewPrefs;
  associatedCount: number;
  activeViewports: number;
  panDragCount: number;
  wheelZoomCount: number;
  multiDocDropsCount: number;
  lastDropPaths: string[];
}

const runtimeCounters = {
  activeViewports: 0,
  panDragCount: 0,
  wheelZoomCount: 0,
  multiDocDropsCount: 0,
  lastDropPaths: [] as string[],
};

let spaceKeyHeldGlobal = false;

function emitStatusChanged(): void {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(DOC_PREVIEW_STATUS_EVENT));
  } catch {
    // Ignore
  }
}

export function readDocPreviewPrefs(storage?: Storage | null): DocPreviewPrefs {
  const targetStorage =
    storage ?? (Platform.OS === "web" && typeof window !== "undefined" ? window.localStorage : null);
  if (!targetStorage) return { ...DEFAULT_DOC_PREVIEW_PREFS };
  try {
    const raw = targetStorage.getItem(DOC_PREVIEW_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DOC_PREVIEW_PREFS };
    const parsed = JSON.parse(raw) as Partial<DocPreviewPrefs>;
    return {
      autoAssociateDocumentPanels: parsed.autoAssociateDocumentPanels !== false,
      defaultInteractionMode: parsed.defaultInteractionMode === "select" ? "select" : "pan",
      defaultPdfMode:
        parsed.defaultPdfMode === "native" || parsed.defaultPdfMode === "text"
          ? parsed.defaultPdfMode
          : "canvas",
      defaultCompareLayout:
        parsed.defaultCompareLayout === "stack" || parsed.defaultCompareLayout === "single"
          ? parsed.defaultCompareLayout
          : "split",
      defaultDropBehavior: parsed.defaultDropBehavior === "tabs" ? "tabs" : "compare",
      enableSyncScrollInCompare: parsed.enableSyncScrollInCompare !== false,
      enablePaneFileDrop: parsed.enablePaneFileDrop !== false,
    };
  } catch {
    return { ...DEFAULT_DOC_PREVIEW_PREFS };
  }
}

export function syncDocPreviewPrefs(
  updates: Partial<DocPreviewPrefs>,
  storage?: Storage | null,
): DocPreviewPrefs {
  const targetStorage =
    storage ?? (Platform.OS === "web" && typeof window !== "undefined" ? window.localStorage : null);
  const current = readDocPreviewPrefs(targetStorage);
  const next: DocPreviewPrefs = {
    ...current,
    ...updates,
  };
  if (targetStorage) {
    try {
      targetStorage.setItem(DOC_PREVIEW_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota/lock errors
    }
  }
  if (updates.autoAssociateDocumentPanels !== undefined) {
    syncDocumentPanelAssociations(
      "file-inspector-finder",
      "doc-inspector",
      next.autoAssociateDocumentPanels,
      targetStorage,
    );
  }
  emitStatusChanged();
  return next;
}

export function resetDocPreviewPrefs(storage?: Storage | null): DocPreviewPrefs {
  return syncDocPreviewPrefs({ ...DEFAULT_DOC_PREVIEW_PREFS }, storage);
}

export function syncDocumentPanelAssociations(
  pluginId: string,
  panelId: string,
  enabled: boolean,
  explicitStorage?: Storage | null,
): number {
  const storage =
    explicitStorage ??
    (Platform.OS === "web" ? (getWebWindow()?.localStorage as Storage | undefined) ?? null : null);
  if (!storage) return 0;

  const targetId = `plugin:${pluginId}/${panelId}`;
  const candidateKeys = ["@paseo:app-settings", "@paseo:settings", "paseo:app-settings"];
  let associatedCount = 0;

  try {
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.includes("settings") && !candidateKeys.includes(k)) {
        candidateKeys.push(k);
      }
    }
    let matchedAnySettingsKey = false;
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
      matchedAnySettingsKey = true;
      const assoc =
        parsed.filePanelAssociations && typeof parsed.filePanelAssociations === "object"
          ? { ...(parsed.filePanelAssociations as Record<string, string>) }
          : {};
      let changed = false;
      for (const ext of SUPPORTED_DOCUMENT_EXTENSIONS) {
        const selectorKey = `ext:${ext}`;
        if (enabled) {
          if (!assoc[selectorKey] || assoc[selectorKey] === targetId) {
            if (assoc[selectorKey] !== targetId) {
              assoc[selectorKey] = targetId;
              changed = true;
            }
          }
        } else if (assoc[selectorKey] === targetId) {
          delete assoc[selectorKey];
          changed = true;
        }
      }
      if (changed) {
        parsed.filePanelAssociations = assoc;
        storage.setItem(key, JSON.stringify(parsed));
      }
    }

    if (!matchedAnySettingsKey && enabled) {
      const assoc: Record<string, string> = {};
      for (const ext of SUPPORTED_DOCUMENT_EXTENSIONS) {
        assoc[`ext:${ext}`] = targetId;
      }
      storage.setItem("@paseo:app-settings", JSON.stringify({ filePanelAssociations: assoc }));
    }

    const primaryRaw = storage.getItem("@paseo:app-settings");
    if (primaryRaw) {
      const parsed = JSON.parse(primaryRaw) as { filePanelAssociations?: Record<string, string> };
      const map = parsed.filePanelAssociations ?? {};
      for (const ext of SUPPORTED_DOCUMENT_EXTENSIONS) {
        if (map[`ext:${ext}`] === targetId) associatedCount += 1;
      }
    }
  } catch {
    // Non-fatal
  }
  return associatedCount;
}

export function getDocPreviewRuntimeStatus(storage?: Storage | null): DocPreviewRuntimeStatus {
  const prefs = readDocPreviewPrefs(storage);
  let associatedCount = 0;
  const targetStorage =
    storage ?? (Platform.OS === "web" && typeof window !== "undefined" ? window.localStorage : null);
  if (targetStorage) {
    try {
      const raw = targetStorage.getItem("@paseo:app-settings");
      if (raw) {
        const parsed = JSON.parse(raw) as { filePanelAssociations?: Record<string, string> };
        const assoc = parsed.filePanelAssociations ?? {};
        for (const ext of SUPPORTED_DOCUMENT_EXTENSIONS) {
          if (assoc[`ext:${ext}`] === "plugin:file-inspector-finder/doc-inspector") {
            associatedCount += 1;
          }
        }
      }
    } catch {
      // Ignore
    }
  }
  return {
    prefs,
    associatedCount,
    activeViewports: runtimeCounters.activeViewports,
    panDragCount: runtimeCounters.panDragCount,
    wheelZoomCount: runtimeCounters.wheelZoomCount,
    multiDocDropsCount: runtimeCounters.multiDocDropsCount,
    lastDropPaths: [...runtimeCounters.lastDropPaths],
  };
}

export function runDocPreviewWebSelfTest(): {
  ok: boolean;
  summary: string;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
} {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  const panRes = clampPanScroll({
    startScrollLeft: 100,
    startScrollTop: 200,
    deltaX: 40,
    deltaY: -80,
    maxScrollLeft: 500,
    maxScrollTop: 1200,
  });
  checks.push({
    name: "pan-clamp",
    ok: panRes.scrollLeft === 60 && panRes.scrollTop === 280,
    detail: `scrollLeft=${panRes.scrollLeft}, scrollTop=${panRes.scrollTop}`,
  });

  const syncOffset = computeSyncedScrollOffset({
    sourceScrollTop: 450,
    sourceScrollHeight: 1300,
    sourceClientHeight: 400,
    targetScrollHeight: 2400,
    targetClientHeight: 400,
  });
  checks.push({
    name: "sync-scroll-ratio",
    ok: syncOffset === 1000,
    detail: `50% ratio -> targetScrollTop=${syncOffset}`,
  });

  const zoomIn = computeNextZoomStep(1, "in");
  const zoomOut = computeNextZoomStep(1, "out");
  checks.push({
    name: "zoom-steps",
    ok: zoomIn === 1.25 && zoomOut === 0.9,
    detail: `100% -> in=${Math.round(zoomIn * 100)}%, out=${Math.round(zoomOut * 100)}%`,
  });

  const dirtyHtml = `<div onclick="alert(1)"><script>evil()</script><a href="javascript:bad()">Doc</a></div>`;
  const cleanHtml = sanitizePreviewHtml(dirtyHtml);
  checks.push({
    name: "html-sanitizer",
    ok:
      !cleanHtml.includes("<script") &&
      !cleanHtml.includes("onclick") &&
      !cleanHtml.includes("javascript:"),
    detail: cleanHtml,
  });

  const ok = checks.every((c) => c.ok);
  return {
    ok,
    summary: `${checks.filter((c) => c.ok).length}/${checks.length} interactive checks passed`,
    checks,
  };
}

interface SyncGroupEntry {
  scrollEl: HTMLElement;
}

const syncGroups = new Map<string, Map<string, SyncGroupEntry>>();
let activeSyncSourceId: string | null = null;
let activeSyncReleaseTimer: ReturnType<typeof setTimeout> | null = null;

export interface BindDocViewportOptions {
  scrollTestId: string;
  interactionMode: DocInteractionMode;
  zoom: number;
  syncGroupId?: string | null;
  slotId: string;
  syncScrollEnabled: boolean;
  onZoomChange: (nextZoom: number) => void;
  onViewportWidthChange?: (widthPx: number) => void;
  onVisiblePageChange?: (page: number) => void;
  onReachNearBottom?: () => void;
}

export function bindInteractiveDocViewport(options: BindDocViewportOptions): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return () => {};
  }

  let disposed = false;
  let cleanupInner: (() => void) | null = null;
  let rafId = 0;

  const tryAttach = (attempt = 0) => {
    if (disposed) return;
    const el = document.querySelector(`[data-testid="${options.scrollTestId}"]`) as HTMLElement | null;
    if (!el) {
      if (attempt < 15) {
        rafId = window.requestAnimationFrame(() => tryAttach(attempt + 1));
      }
      return;
    }

    runtimeCounters.activeViewports += 1;
    el.style.overflow = "auto";
    (el.style as unknown as Record<string, string>).overscrollBehavior = "contain";

    let resizeObs: ResizeObserver | null = null;
    if (options.onViewportWidthChange) {
      const reportW = () => {
        const cw = Math.round(el.clientWidth);
        if (cw > 80) options.onViewportWidthChange?.(cw);
      };
      reportW();
      if (typeof ResizeObserver !== "undefined") {
        resizeObs = new ResizeObserver(() => reportW());
        resizeObs.observe(el);
      }
    }

    const isPanReady = () => options.interactionMode === "pan" || spaceKeyHeldGlobal;
    const applyIdleCursor = () => {
      el.style.cursor = isPanReady() ? "grab" : "";
    };
    applyIdleCursor();

    // Register in sync group for side-by-side / stacked multi-doc comparison
    const groupKey = options.syncGroupId ?? "";
    if (groupKey) {
      let group = syncGroups.get(groupKey);
      if (!group) {
        group = new Map();
        syncGroups.set(groupKey, group);
      }
      group.set(options.slotId, { scrollEl: el });
    }

    let pointerId: number | null = null;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;

    const isInteractiveControlTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return Boolean(target.closest("button, input, textarea, select, [data-doc-no-pan='true']"));
    };

    const onPointerDown = (ev: PointerEvent) => {
      const middleMouse = ev.button === 1;
      const primaryPan = ev.button === 0 && isPanReady();
      if (!middleMouse && !primaryPan) return;
      if (isInteractiveControlTarget(ev.target)) return;

      pointerId = ev.pointerId;
      dragging = false;
      startX = ev.clientX;
      startY = ev.clientY;
      startScrollLeft = el.scrollLeft;
      startScrollTop = el.scrollTop;
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (pointerId === null || ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 5) return;
        dragging = true;
        runtimeCounters.panDragCount += 1;
        try {
          el.setPointerCapture(ev.pointerId);
        } catch {
          // Ignore synthetic events without capture support
        }
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
      }
      ev.preventDefault();
      const maxL = Math.max(0, el.scrollWidth - el.clientWidth);
      const maxT = Math.max(0, el.scrollHeight - el.clientHeight);
      const clamped = clampPanScroll({
        startScrollLeft,
        startScrollTop,
        deltaX: dx,
        deltaY: dy,
        maxScrollLeft: maxL,
        maxScrollTop: maxT,
      });
      el.scrollLeft = clamped.scrollLeft;
      el.scrollTop = clamped.scrollTop;
    };

    const finishDrag = (ev: PointerEvent) => {
      if (pointerId === null || ev.pointerId !== pointerId) return;
      if (dragging) {
        try {
          if (el.hasPointerCapture(ev.pointerId)) {
            el.releasePointerCapture(ev.pointerId);
          }
        } catch {
          // Ignore
        }
        el.style.userSelect = "";
        emitStatusChanged();
      }
      pointerId = null;
      dragging = false;
      applyIdleCursor();
    };

    const onDragStart = (ev: DragEvent) => {
      if (isPanReady() || dragging) {
        ev.preventDefault();
      }
    };

    let lastWheelZoomAt = 0;
    const onWheel = (ev: WheelEvent) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      const now = Date.now();
      if (now - lastWheelZoomAt < 85) return;
      lastWheelZoomAt = now;
      runtimeCounters.wheelZoomCount += 1;
      const dir = ev.deltaY < 0 ? "in" : "out";
      options.onZoomChange(computeNextZoomStep(options.zoom, dir));
      emitStatusChanged();
    };

    const onScroll = () => {
      // 1. Update visible page badge
      if (options.onVisiblePageChange) {
        const pageNodes = el.querySelectorAll<HTMLElement>("[data-doc-page]");
        if (pageNodes.length > 0) {
          const viewportMid = el.getBoundingClientRect().top + el.clientHeight * 0.35;
          let bestPage = 1;
          let bestDist = Number.POSITIVE_INFINITY;
          pageNodes.forEach((node) => {
            const pno = Number.parseInt(node.getAttribute("data-doc-page") ?? "1", 10);
            if (!Number.isFinite(pno)) return;
            const rect = node.getBoundingClientRect();
            if (rect.top <= viewportMid && rect.bottom >= viewportMid) {
              bestPage = pno;
              bestDist = 0;
            } else {
              const dist = Math.min(Math.abs(rect.top - viewportMid), Math.abs(rect.bottom - viewportMid));
              if (dist < bestDist) {
                bestDist = dist;
                bestPage = pno;
              }
            }
          });
          options.onVisiblePageChange(bestPage);
        }
      }

      // 2. Progressive infinite-scroll lookahead (1400px before bottom)
      if (options.onReachNearBottom) {
        const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight);
        if (remaining <= 1400) {
          options.onReachNearBottom();
        }
      }

      // 3. Proportional Sync Scroll across compared documents
      if (options.syncScrollEnabled && groupKey) {
        if (activeSyncSourceId && activeSyncSourceId !== options.slotId) {
          return;
        }
        activeSyncSourceId = options.slotId;
        if (activeSyncReleaseTimer) clearTimeout(activeSyncReleaseTimer);
        activeSyncReleaseTimer = setTimeout(() => {
          activeSyncSourceId = null;
        }, 120);

        const peers = syncGroups.get(groupKey);
        if (peers) {
          for (const [peerSlotId, peer] of peers.entries()) {
            if (peerSlotId === options.slotId) continue;
            const nextTop = computeSyncedScrollOffset({
              sourceScrollTop: el.scrollTop,
              sourceScrollHeight: el.scrollHeight,
              sourceClientHeight: el.clientHeight,
              targetScrollHeight: peer.scrollEl.scrollHeight,
              targetClientHeight: peer.scrollEl.clientHeight,
            });
            if (Math.abs(peer.scrollEl.scrollTop - nextTop) > 2) {
              peer.scrollEl.scrollTop = nextTop;
            }
          }
        }
      }
    };

    const onKeyChange = () => applyIdleCursor();

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", finishDrag);
    el.addEventListener("pointercancel", finishDrag);
    el.addEventListener("dragstart", onDragStart);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("paseo:finder-doc-space-key", onKeyChange);

    cleanupInner = () => {
      runtimeCounters.activeViewports = Math.max(0, runtimeCounters.activeViewports - 1);
      resizeObs?.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", finishDrag);
      el.removeEventListener("pointercancel", finishDrag);
      el.removeEventListener("dragstart", onDragStart);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("paseo:finder-doc-space-key", onKeyChange);
      el.style.cursor = "";
      el.style.userSelect = "";
      if (groupKey) {
        const group = syncGroups.get(groupKey);
        if (group) {
          group.delete(options.slotId);
          if (group.size === 0) syncGroups.delete(groupKey);
        }
      }
    };
  };

  tryAttach();

  return () => {
    disposed = true;
    if (rafId && typeof window !== "undefined") {
      window.cancelAnimationFrame(rafId);
    }
    cleanupInner?.();
  };
}

export function scrollDocViewportToPage(scrollTestId: string, pageNumber: number): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined") return false;
  const scrollEl = document.querySelector(`[data-testid="${scrollTestId}"]`) as HTMLElement | null;
  if (!scrollEl) return false;
  const target = scrollEl.querySelector(`[data-doc-page="${pageNumber}"]`) as HTMLElement | null;
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

export function mountScopedHtmlPreview(options: {
  hostTestId: string;
  html: string;
  zoom: number;
  containerWidth?: number;
  searchQuery?: string;
}): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return () => {};
  }

  let disposed = false;
  let rafId = 0;

  const renderIntoHost = (attempt = 0) => {
    if (disposed) return;
    const host = document.querySelector(`[data-testid="${options.hostTestId}"]`) as HTMLElement | null;
    if (!host) {
      if (attempt < 15) {
        rafId = window.requestAnimationFrame(() => renderIntoHost(attempt + 1));
      }
      return;
    }

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const safeHtml = sanitizePreviewHtml(options.html);
    const measuredWidth = options.containerWidth && options.containerWidth > 80
      ? options.containerWidth
      : host.clientWidth || 640;
    const fitRatio = Math.min(1, Math.max(0.28, (measuredWidth - 20) / 860));
    const zoomScale = Number((fitRatio * Math.max(0.5, Math.min(3, options.zoom))).toFixed(3));

    shadow.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          min-height: 100%;
        }
        .paseo-doc-zoom-shell {
          zoom: ${zoomScale};
          padding: 4px;
          min-width: fit-content;
        }
        .paseo-doc-zoom-shell body {
          padding: 8px !important;
        }
        img {
          -webkit-user-drag: none;
          max-width: 100%;
        }
        mark.paseo-doc-hit {
          background: rgba(250, 204, 21, 0.55);
          color: inherit;
          border-radius: 2px;
          padding: 0 1px;
        }
      </style>
      <div class="paseo-doc-zoom-shell" part="zoom-shell">${safeHtml}</div>
    `;

    const q = (options.searchQuery ?? "").trim();
    if (q.length >= 2) {
      highlightTextInShadow(shadow, q);
    }
  };

  renderIntoHost();

  return () => {
    disposed = true;
    if (rafId && typeof window !== "undefined") {
      window.cancelAnimationFrame(rafId);
    }
  };
}

function highlightTextInShadow(shadow: ShadowRoot, query: string): void {
  const root = shadow.querySelector(".paseo-doc-zoom-shell");
  if (!root) return;
  const lower = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current && textNodes.length < 250) {
    if (
      current.nodeValue &&
      current.nodeValue.toLowerCase().includes(lower) &&
      current.parentElement &&
      !["STYLE", "SCRIPT"].includes(current.parentElement.tagName)
    ) {
      textNodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  let scrolledFirst = false;
  for (const node of textNodes) {
    const val = node.nodeValue ?? "";
    const idx = val.toLowerCase().indexOf(lower);
    if (idx < 0 || !node.parentNode) continue;
    const frag = document.createDocumentFragment();
    if (idx > 0) frag.appendChild(document.createTextNode(val.slice(0, idx)));
    const mark = document.createElement("mark");
    mark.className = "paseo-doc-hit";
    mark.textContent = val.slice(idx, idx + query.length);
    frag.appendChild(mark);
    if (idx + query.length < val.length) {
      frag.appendChild(document.createTextNode(val.slice(idx + query.length)));
    }
    node.parentNode.replaceChild(frag, node);
    if (!scrolledFirst) {
      scrolledFirst = true;
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}

export function openWorkspaceFileTabsInSidePane(
  workspaceId: string | undefined,
  filePaths: string[],
): number {
  if (Platform.OS !== "web" || filePaths.length === 0) return 0;
  const win = getWebWindow();
  const hit = requireMetroExport("useWorkspaceLayoutStore", win as never);
  const useStore = hit?.exports?.useWorkspaceLayoutStore as
    | {
        getState?: () => {
          layoutByWorkspace?: Record<string, unknown>;
          ensureSidePane?: (workspaceKey: string) => string | null;
          openTab?: (input: {
            workspaceKey: string;
            target: { kind: "file"; path: string };
            intent?: string;
            placement?: { mode: "pane"; paneId: string };
          }) => string | null;
        };
      }
    | undefined;
  const st = useStore?.getState?.();
  if (!st || typeof st.openTab !== "function") return 0;

  const layoutByWs = st.layoutByWorkspace ?? {};
  const cleanWs = (workspaceId ?? "").replace(/^[^:]+:/, "").trim();
  const workspaceKey =
    (cleanWs
      ? Object.keys(layoutByWs).find((k) => k === cleanWs || k.endsWith(`:${cleanWs}`))
      : null) ??
    Object.keys(layoutByWs)[0] ??
    null;
  if (!workspaceKey) return 0;

  const sidePaneId = typeof st.ensureSidePane === "function" ? st.ensureSidePane(workspaceKey) : null;
  let opened = 0;
  for (const rawPath of filePaths) {
    const cleaned = cleanExtractedFilePath(rawPath);
    if (!cleaned) continue;
    try {
      st.openTab({
        workspaceKey,
        target: { kind: "file", path: cleaned },
        intent: "reveal",
        placement: sidePaneId ? { mode: "pane", paneId: sidePaneId } : undefined,
      });
      opened += 1;
    } catch {
      // Ignore individual failure
    }
  }
  return opened;
}

function extractDroppedFilePaths(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  const out: string[] = [];
  const win = getWebWindow() as unknown as {
    paseoDesktop?: { webUtils?: { getPathForFile?: (file: File) => string } };
  } | null;
  const getPathForFile = win?.paseoDesktop?.webUtils?.getPathForFile;

  if (dt.files && dt.files.length > 0 && typeof getPathForFile === "function") {
    for (let i = 0; i < dt.files.length; i += 1) {
      const f = dt.files[i];
      if (!f) continue;
      try {
        const p = cleanExtractedFilePath(getPathForFile(f) ?? "");
        if (p && isSupportedCompareExtension(p) && !out.includes(p)) {
          out.push(p);
        }
      } catch {
        // Ignore
      }
    }
  }

  if (out.length === 0) {
    const rawText = dt.getData("text/plain") || dt.getData("text/uri-list") || "";
    for (const line of rawText.split(/\r?\n/)) {
      const cleaned = cleanExtractedFilePath(line);
      if (cleaned && isSupportedCompareExtension(cleaned) && !out.includes(cleaned)) {
        out.push(cleaned);
      }
    }
  }

  return out;
}

export function installDesktopDocPreviewEnhancer(options: {
  getLocale: () => string;
}): () => void {
  if (Platform.OS !== "web" || typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const prefs = readDocPreviewPrefs();
  if (prefs.autoAssociateDocumentPanels) {
    syncDocumentPanelAssociations("file-inspector-finder", "doc-inspector", true);
  }

  // Spacebar temporary Hand-Tool pan (like Preview / Figma / Acrobat)
  const isTypingElement = (el: Element | null): boolean => {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if ((el as HTMLElement).isContentEditable) return true;
    return Boolean(el.closest(".cm-editor, .xterm"));
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.code === "Space" && !ev.repeat && !isTypingElement(document.activeElement)) {
      if (document.querySelector('[data-testid="paseo-doc-inspector-root"]')) {
        spaceKeyHeldGlobal = true;
        window.dispatchEvent(new CustomEvent("paseo:finder-doc-space-key"));
      }
    }
  };

  const onKeyUp = (ev: KeyboardEvent) => {
    if (ev.code === "Space" && spaceKeyHeldGlobal) {
      spaceKeyHeldGlobal = false;
      window.dispatchEvent(new CustomEvent("paseo:finder-doc-space-key"));
    }
  };

  const onBlur = () => {
    if (spaceKeyHeldGlobal) {
      spaceKeyHeldGlobal = false;
      window.dispatchEvent(new CustomEvent("paseo:finder-doc-space-key"));
    }
  };

  // Multi-Doc Drag & Drop onto File Preview Pane
  let overlayEl: HTMLDivElement | null = null;

  const removeOverlay = () => {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  };

  const findPreviewPaneHost = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    if (target.closest('[data-composer-input], .xterm, [data-testid^="sidebar-"]')) {
      return null;
    }
    return (
      (target.closest('[data-testid="paseo-doc-inspector-root"]') as HTMLElement | null) ??
      (target.closest('[data-testid="workspace-file-pane"]') as HTMLElement | null)
    );
  };

  const ensureOverlay = (paneHost: HTMLElement, openAsTabs: boolean) => {
    syncPaseoThemeCssVariables(document, window);
    const isZh = options.getLocale().toLowerCase().startsWith("zh");
    const label = openAsTabs
      ? isZh
        ? "松开在右侧分栏打开多个文档标签页"
        : "Drop to open documents in side tabs"
      : isZh
        ? "松开并排对比预览多个文档（按住 Option 打开独立标签页）"
        : "Drop to compare documents side-by-side (Hold Option for separate tabs)";

    if (!overlayEl) {
      overlayEl = document.createElement("div");
      overlayEl.setAttribute("data-testid", "paseo-doc-drop-overlay");
      overlayEl.style.position = "fixed";
      overlayEl.style.pointerEvents = "none";
      overlayEl.style.zIndex = "9999";
      overlayEl.style.display = "flex";
      overlayEl.style.alignItems = "center";
      overlayEl.style.justifyContent = "center";
      overlayEl.style.borderRadius = "10px";
      overlayEl.style.border = "1.5px dashed var(--paseo-finder-accent, #71717a)";
      overlayEl.style.background = "color-mix(in srgb, var(--paseo-finder-surface0, #ffffff) 88%, transparent)";
      overlayEl.style.color = "var(--paseo-finder-fg, #18181b)";
      overlayEl.style.fontSize = "13px";
      overlayEl.style.fontWeight = "600";
      overlayEl.style.padding = "16px 20px";
      document.body.appendChild(overlayEl);
    }
    const rect = paneHost.getBoundingClientRect();
    overlayEl.style.left = `${Math.round(rect.left + 8)}px`;
    overlayEl.style.top = `${Math.round(rect.top + 8)}px`;
    overlayEl.style.width = `${Math.max(120, Math.round(rect.width - 16))}px`;
    overlayEl.style.height = `${Math.max(80, Math.round(rect.height - 16))}px`;
    if (overlayEl.textContent !== label) {
      overlayEl.textContent = label;
    }
  };

  const onDragOver = (ev: DragEvent) => {
    const livePrefs = readDocPreviewPrefs();
    if (!livePrefs.enablePaneFileDrop) return;
    const paneHost = findPreviewPaneHost(ev.target);
    if (!paneHost) {
      removeOverlay();
      return;
    }
    const types = Array.from(ev.dataTransfer?.types ?? []);
    if (!types.includes("Files") && !types.includes("text/plain") && !types.includes("text/uri-list")) {
      return;
    }
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    const hasActiveDocInspector = Boolean(
      paneHost.matches('[data-testid="paseo-doc-inspector-root"]') ||
        paneHost.querySelector('[data-testid="paseo-doc-inspector-root"]'),
    );
    const openAsTabs = !hasActiveDocInspector || ev.altKey || livePrefs.defaultDropBehavior === "tabs";
    ensureOverlay(paneHost, openAsTabs);
  };

  const onDragLeave = (ev: DragEvent) => {
    if (!ev.relatedTarget || !(ev.relatedTarget instanceof Node)) {
      removeOverlay();
    }
  };

  const onDrop = (ev: DragEvent) => {
    const livePrefs = readDocPreviewPrefs();
    if (!livePrefs.enablePaneFileDrop) return;
    const paneHost = findPreviewPaneHost(ev.target);
    removeOverlay();
    if (!paneHost) return;

    const droppedPaths = extractDroppedFilePaths(ev.dataTransfer);
    if (droppedPaths.length === 0) return;

    ev.preventDefault();
    ev.stopPropagation();

    runtimeCounters.multiDocDropsCount += 1;
    runtimeCounters.lastDropPaths = droppedPaths;

    const docInspectorRoot = paneHost.matches('[data-testid="paseo-doc-inspector-root"]')
      ? paneHost
      : (paneHost.querySelector('[data-testid="paseo-doc-inspector-root"]') as HTMLElement | null);

    const workspaceId = docInspectorRoot?.getAttribute("data-workspace-id") ?? undefined;
    const openAsTabs = !docInspectorRoot || ev.altKey || livePrefs.defaultDropBehavior === "tabs";

    if (!openAsTabs && docInspectorRoot) {
      window.dispatchEvent(
        new CustomEvent(DOC_PREVIEW_COMPARE_DROP_EVENT, {
          detail: {
            workspaceId,
            paths: droppedPaths,
          },
        }),
      );
    } else {
      openWorkspaceFileTabsInSidePane(workspaceId, droppedPaths);
    }
    emitStatusChanged();
  };

  // Make inline chat file links draggable into the right preview pane
  const onChatDragStart = (ev: DragEvent) => {
    if (!(ev.target instanceof Element)) return;
    const linkEl = ev.target.closest('[data-testid="assistant-message"] a, [data-testid="assistant-message"] code, [data-testid="assistant-message"] [role="link"]');
    if (!linkEl || !ev.dataTransfer) return;
    const raw = cleanExtractedFilePath(linkEl.getAttribute("href") || linkEl.textContent || "");
    if (raw && isSupportedCompareExtension(raw)) {
      ev.dataTransfer.setData("text/plain", raw);
      ev.dataTransfer.effectAllowed = "copyMove";
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop, true);
  document.addEventListener("dragstart", onChatDragStart);

  (globalThis as Record<string, unknown>).__paseoFinderDocPreview = {
    status: () => getDocPreviewRuntimeStatus(),
    selfTest: () => runDocPreviewWebSelfTest(),
    setPrefs: (next: Partial<DocPreviewPrefs>) => syncDocPreviewPrefs(next),
    openFileTabs: (workspaceId: string | undefined, paths: string[]) =>
      openWorkspaceFileTabsInSidePane(workspaceId, paths),
  };

  return () => {
    removeOverlay();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("dragleave", onDragLeave);
    window.removeEventListener("drop", onDrop, true);
    document.removeEventListener("dragstart", onChatDragStart);
  };
}
