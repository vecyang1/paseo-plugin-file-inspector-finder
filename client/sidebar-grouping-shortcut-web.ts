/// <reference lib="dom" />
/**
 * Sidebar Grouping Shortcuts — configurable keyboard shortcuts to switch Paseo's
 * left sidebar grouping between "By Project" (`groupMode: "project"`) and
 * "By Status" (`groupMode: "status"`).
 *
 * Defaults:
 *   - Group by Project: `Cmd+Ctrl+P` (`⌃⌘P` on macOS)
 *   - Group by Status:  `Cmd+Ctrl+S` (`⌃⌘S` on macOS)
 *
 * All preferences and receipts live in localStorage (mirrored from host-scoped
 * plugin settings) for full Settings UI observability (`能读 / 能试 / 能调`).
 */

import type { SidebarGroupingPreset } from "../shared/contracts";
import { requireMetroExport } from "./metro-registry";
import {
  captureKeyboardEventAsShortcut,
  formatAriaKeyShortcut,
  formatProjectPickerShortcutDisplay,
  isMacPlatform,
  matchesParsedShortcutChord,
  parseProjectPickerShortcutChord,
  type CapturedShortcutResult,
  type KeyLike,
  type ParsedShortcutChord,
} from "./project-picker-shortcut-web";
import { syncPaseoThemeCssVariables } from "./theme-web";

export type SidebarGroupingMode = "project" | "status";

export interface SidebarGroupingShortcutPrefs {
  enabled: boolean;
  preset: SidebarGroupingPreset;
  projectShortcut: string;
  statusShortcut: string;
  toggleOnRePress: boolean;
}

export type SidebarGroupingTrigger = "project" | "status" | "toggle" | "self-test";

export interface SidebarGroupingReceipt {
  at: string;
  trigger: SidebarGroupingTrigger;
  prevMode: SidebarGroupingMode | "unknown";
  nextMode: SidebarGroupingMode | "unknown";
  ok: boolean;
  outcome: string;
}

export interface SidebarGroupingShortcutStatus {
  prefs: SidebarGroupingShortcutPrefs;
  currentMode: SidebarGroupingMode | "unknown";
  projectSpec: string;
  statusSpec: string;
  projectChord: ParsedShortcutChord | null;
  statusChord: ParsedShortcutChord | null;
  displayProjectShortcut: string;
  displayStatusShortcut: string;
  installed: boolean;
  storeAvailable: boolean;
  receipts: SidebarGroupingReceipt[];
}

export const SIDEBAR_GROUPING_SHORTCUT_EVENT = "paseo-finder:sidebar-grouping-shortcut";
export const SIDEBAR_GROUPING_PROJECT_TESTID = "sidebar-grouping-project";
export const SIDEBAR_GROUPING_STATUS_TESTID = "sidebar-grouping-status";
export const SIDEBAR_GROUPING_TOAST_ID = "paseo-finder-sidebar-grouping-toast";

const PREFS_STORAGE_KEY = "paseo:finder-plugin:sidebar-grouping-shortcut";
const RECEIPTS_STORAGE_KEY = "paseo:finder-plugin:sidebar-grouping-receipts";
const PASEO_SIDEBAR_VIEW_STORAGE_KEY = "sidebar-view";
const MAX_RECEIPTS = 15;
const FOREIGN_OWNERS = [".cm-editor", ".monaco-editor", ".xterm"];
const GLOBAL_BRIDGE_KEY = "__paseoFinderSidebarGrouping";

export const DEFAULT_SIDEBAR_GROUPING_SHORTCUT_PREFS: SidebarGroupingShortcutPrefs = {
  enabled: true,
  preset: "cmd_ctrl_p_s",
  projectShortcut: "Cmd+Ctrl+P",
  statusShortcut: "Cmd+Ctrl+S",
  toggleOnRePress: false,
};

const PRESET_TO_SPECS: Record<
  Exclude<SidebarGroupingPreset, "custom">,
  { project: string; status: string }
> = {
  cmd_ctrl_p_s: { project: "Cmd+Ctrl+P", status: "Cmd+Ctrl+S" },
  cmd_alt_p_s: { project: "Cmd+Alt+P", status: "Cmd+Alt+S" },
  ctrl_shift_p_s: { project: "Ctrl+Shift+P", status: "Ctrl+Shift+S" },
};

const VALID_PRESETS = new Set<string>([
  "cmd_ctrl_p_s",
  "cmd_alt_p_s",
  "ctrl_shift_p_s",
  "custom",
]);

let installedOwner: object | null = null;

interface ElementLike {
  id?: string;
  tagName?: string;
  textContent?: string | null;
  children?: ArrayLike<ElementLike>;
  parentElement?: ElementLike | null;
  style?: Record<string, string>;
  getAttribute(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  closest?(selector: string): unknown;
  querySelector?(selector: string): ElementLike | null;
  querySelectorAll?(selector: string): ArrayLike<ElementLike>;
  appendChild?(child: ElementLike): void;
  insertBefore?(newChild: ElementLike, refChild: ElementLike | null): void;
  remove?(): void;
  click?(): void;
  getClientRects?(): { length: number };
  isConnected?: boolean;
}

interface DocLike {
  body?: ElementLike | null;
  documentElement?: ElementLike | null;
  getElementById?(id: string): ElementLike | null;
  createElement?(tag: string): ElementLike;
  querySelector?(selector: string): ElementLike | null;
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
  addEventListener?(type: string, listener: (ev: Event) => void, options?: boolean): void;
  removeEventListener?(type: string, listener: (ev: Event) => void, options?: boolean): void;
}

interface SidebarViewStoreState {
  groupMode?: string;
  setGroupMode?: (mode: string) => void;
}

interface SidebarViewStoreLike {
  getState?: () => SidebarViewStoreState;
  setState?: (partial: Partial<SidebarViewStoreState>) => void;
}

// ---------------------------------------------------------------------------
// Re-exported chord utilities for settings & tests
// ---------------------------------------------------------------------------

export {
  captureKeyboardEventAsShortcut,
  formatAriaKeyShortcut,
  formatProjectPickerShortcutDisplay,
  isMacPlatform,
  matchesParsedShortcutChord,
  parseProjectPickerShortcutChord,
  type CapturedShortcutResult,
  type KeyLike,
  type ParsedShortcutChord,
};

// ---------------------------------------------------------------------------
// Preferences + receipts
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function normalizeShortcutInput(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "none" || trimmed.toLowerCase() === "off") return "";
  return trimmed;
}

export function normalizeSidebarGroupingShortcutPrefs(
  raw: unknown,
): SidebarGroupingShortcutPrefs {
  const value =
    raw && typeof raw === "object" ? (raw as Partial<SidebarGroupingShortcutPrefs>) : {};
  const preset: SidebarGroupingPreset =
    typeof value.preset === "string" && VALID_PRESETS.has(value.preset)
      ? (value.preset as SidebarGroupingPreset)
      : DEFAULT_SIDEBAR_GROUPING_SHORTCUT_PREFS.preset;

  const projectShortcut =
    value.projectShortcut === undefined
      ? DEFAULT_SIDEBAR_GROUPING_SHORTCUT_PREFS.projectShortcut
      : normalizeShortcutInput(
          value.projectShortcut,
          DEFAULT_SIDEBAR_GROUPING_SHORTCUT_PREFS.projectShortcut,
        );

  const statusShortcut =
    value.statusShortcut === undefined
      ? DEFAULT_SIDEBAR_GROUPING_SHORTCUT_PREFS.statusShortcut
      : normalizeShortcutInput(
          value.statusShortcut,
          DEFAULT_SIDEBAR_GROUPING_SHORTCUT_PREFS.statusShortcut,
        );

  return {
    enabled: value.enabled !== false,
    preset,
    projectShortcut,
    statusShortcut,
    toggleOnRePress: value.toggleOnRePress === true,
  };
}

export function readSidebarGroupingShortcutPrefs(): SidebarGroupingShortcutPrefs {
  const store = storage();
  if (!store) return { ...DEFAULT_SIDEBAR_GROUPING_SHORTCUT_PREFS };
  try {
    const raw = store.getItem(PREFS_STORAGE_KEY);
    return normalizeSidebarGroupingShortcutPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SIDEBAR_GROUPING_SHORTCUT_PREFS };
  }
}

export function syncSidebarGroupingShortcutPrefs(
  prefs: Partial<SidebarGroupingShortcutPrefs>,
): SidebarGroupingShortcutPrefs {
  const next = normalizeSidebarGroupingShortcutPrefs({
    ...readSidebarGroupingShortcutPrefs(),
    ...prefs,
  });
  try {
    storage()?.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(
        new CustomEvent(SIDEBAR_GROUPING_SHORTCUT_EVENT, {
          detail: { type: "prefs", prefs: next },
        }),
      );
    }
  } catch {
    // CustomEvent unavailable in some environments
  }
  return next;
}

export function resolveGroupingShortcutSpecs(prefs: SidebarGroupingShortcutPrefs): {
  projectSpec: string;
  statusSpec: string;
} {
  if (prefs.preset !== "custom") {
    const mapped = PRESET_TO_SPECS[prefs.preset] ?? PRESET_TO_SPECS.cmd_ctrl_p_s;
    return { projectSpec: mapped.project, statusSpec: mapped.status };
  }
  return {
    projectSpec: prefs.projectShortcut,
    statusSpec: prefs.statusShortcut,
  };
}

export function resolveGroupingShortcutChords(prefs: SidebarGroupingShortcutPrefs): {
  projectChord: ParsedShortcutChord | null;
  statusChord: ParsedShortcutChord | null;
} {
  const { projectSpec, statusSpec } = resolveGroupingShortcutSpecs(prefs);
  return {
    projectChord: projectSpec ? parseProjectPickerShortcutChord(projectSpec) : null,
    statusChord: statusSpec ? parseProjectPickerShortcutChord(statusSpec) : null,
  };
}

export function readSidebarGroupingReceipts(): SidebarGroupingReceipt[] {
  try {
    const raw = storage()?.getItem(RECEIPTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? (parsed as SidebarGroupingReceipt[]).slice(0, MAX_RECEIPTS)
      : [];
  } catch {
    return [];
  }
}

export function recordSidebarGroupingReceipt(
  trigger: SidebarGroupingTrigger,
  prevMode: SidebarGroupingMode | "unknown",
  nextMode: SidebarGroupingMode | "unknown",
  ok: boolean,
  outcome: string,
): SidebarGroupingReceipt {
  const receipt: SidebarGroupingReceipt = {
    at: new Date().toISOString(),
    trigger,
    prevMode,
    nextMode,
    ok,
    outcome,
  };
  try {
    const next = [receipt, ...readSidebarGroupingReceipts()].slice(0, MAX_RECEIPTS);
    storage()?.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(
        new CustomEvent(SIDEBAR_GROUPING_SHORTCUT_EVENT, {
          detail: { type: "receipt", receipt },
        }),
      );
    }
  } catch {
    // CustomEvent unavailable
  }
  return receipt;
}

// ---------------------------------------------------------------------------
// Store resolution & grouping execution
// ---------------------------------------------------------------------------

export function resolveSidebarViewStore(winOverride?: unknown): SidebarViewStoreLike | null {
  const win = (winOverride ?? (typeof window !== "undefined" ? window : null)) as Record<
    string,
    unknown
  > | null;
  if (!win) return null;
  if (win.__paseoSidebarViewStore && typeof win.__paseoSidebarViewStore === "function") {
    return win.__paseoSidebarViewStore as SidebarViewStoreLike;
  }
  if (win.__paseoSidebarViewStore && typeof win.__paseoSidebarViewStore === "object") {
    return win.__paseoSidebarViewStore as SidebarViewStoreLike;
  }
  try {
    const hit = requireMetroExport("useSidebarViewStore", win as never);
    const store = hit?.exports?.useSidebarViewStore;
    if (store && (typeof store === "function" || typeof store === "object")) {
      return store as SidebarViewStoreLike;
    }
  } catch {
    // Ignore registry error
  }
  return null;
}

export function readCurrentSidebarGroupingMode(
  winOverride?: unknown,
  docOverride?: DocLike | null,
): SidebarGroupingMode | "unknown" {
  const store = resolveSidebarViewStore(winOverride);
  const storeMode = store?.getState?.()?.groupMode;
  if (storeMode === "project" || storeMode === "status") {
    return storeMode;
  }

  const doc =
    docOverride ?? (typeof document !== "undefined" ? (document as unknown as DocLike) : null);
  if (doc) {
    const projMenu = doc.querySelector?.(`[data-testid="${SIDEBAR_GROUPING_PROJECT_TESTID}"]`);
    const statMenu = doc.querySelector?.(`[data-testid="${SIDEBAR_GROUPING_STATUS_TESTID}"]`);
    if (projMenu?.getAttribute("aria-checked") === "true") return "project";
    if (statMenu?.getAttribute("aria-checked") === "true") return "status";
  }

  try {
    const raw = storage()?.getItem(PASEO_SIDEBAR_VIEW_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { groupMode?: unknown } };
      if (parsed?.state?.groupMode === "project") return "project";
      if (parsed?.state?.groupMode === "status") return "status";
    }
  } catch {
    // Ignore storage parse error
  }

  return "unknown";
}

function showGroupingToast(
  doc: DocLike | null | undefined,
  win: Record<string, unknown> | null | undefined,
  mode: SidebarGroupingMode,
  alreadyActive: boolean,
): void {
  if (!doc?.body || typeof doc.createElement !== "function") return;
  try {
    syncPaseoThemeCssVariables(doc as never, win as never);
  } catch {
    // Ignore theme sync error in minimal test DOM
  }

  const nav = (win?.navigator as { language?: string } | undefined) ??
    (typeof navigator !== "undefined" ? navigator : undefined);
  const isZh = /^zh/i.test(nav?.language ?? "");
  const label =
    mode === "project"
      ? isZh
        ? "侧边栏：按项目分组"
        : "Sidebar: Group by project"
      : isZh
        ? "侧边栏：按状态分组"
        : "Sidebar: Group by status";
  const text = alreadyActive ? (isZh ? `${label}（当前）` : `${label} (active)`) : label;

  let toastEl = doc.getElementById?.(SIDEBAR_GROUPING_TOAST_ID) ?? null;
  if (!toastEl) {
    toastEl = doc.createElement("div");
    toastEl.id = SIDEBAR_GROUPING_TOAST_ID;
    toastEl.setAttribute?.("data-testid", SIDEBAR_GROUPING_TOAST_ID);
    if (toastEl.style) {
      Object.assign(toastEl.style, {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: "9999",
        padding: "7px 13px",
        borderRadius: "8px",
        fontSize: "12px",
        fontWeight: "500",
        backgroundColor: "var(--paseo-finder-surface-2, var(--surface-2))",
        color: "var(--paseo-finder-fg, var(--foreground))",
        border: "1px solid var(--paseo-finder-border, var(--border))",
        boxShadow: "0 8px 20px -4px rgba(0, 0, 0, 0.22)",
        pointerEvents: "none",
        transition: "opacity 160ms ease, transform 160ms ease",
        opacity: "0",
        transform: "translateY(6px)",
      });
    }
    doc.body.appendChild?.(toastEl);
  }

  toastEl.textContent = text;
  if (toastEl.style) {
    toastEl.style.opacity = "1";
    toastEl.style.transform = "translateY(0)";
  }

  const setTimer =
    typeof win?.setTimeout === "function"
      ? (win.setTimeout as typeof setTimeout)
      : typeof setTimeout === "function"
        ? setTimeout
        : null;
  const clearTimer =
    typeof win?.clearTimeout === "function"
      ? (win.clearTimeout as typeof clearTimeout)
      : typeof clearTimeout === "function"
        ? clearTimeout
        : null;

  const holder = toastEl as unknown as Record<string, ReturnType<typeof setTimeout> | undefined>;
  if (holder.__toastTimer && clearTimer) clearTimer(holder.__toastTimer);
  if (setTimer) {
    holder.__toastTimer = setTimer(() => {
      if (toastEl?.style) {
        toastEl.style.opacity = "0";
        toastEl.style.transform = "translateY(6px)";
      }
    }, 1500);
  }
}

export function switchSidebarGrouping(
  target: "project" | "status" | "toggle",
  options?: {
    win?: unknown;
    doc?: DocLike | null;
    trigger?: SidebarGroupingTrigger;
    silentToast?: boolean;
  },
): {
  ok: boolean;
  prevMode: SidebarGroupingMode | "unknown";
  nextMode: SidebarGroupingMode;
  message: string;
} {
  const win = (options?.win ?? (typeof window !== "undefined" ? window : null)) as Record<
    string,
    unknown
  > | null;
  const doc =
    options?.doc ?? (typeof document !== "undefined" ? (document as unknown as DocLike) : null);

  const prevMode = readCurrentSidebarGroupingMode(win, doc);
  const nextMode: SidebarGroupingMode =
    target === "toggle" ? (prevMode === "project" ? "status" : "project") : target;

  let applied = false;
  const store = resolveSidebarViewStore(win);
  const state = store?.getState?.();
  if (state && typeof state.setGroupMode === "function") {
    state.setGroupMode(nextMode);
    applied = true;
  } else if (store && typeof store.setState === "function") {
    store.setState({ groupMode: nextMode });
    applied = true;
  }

  if (!applied && doc) {
    const testId =
      nextMode === "project"
        ? SIDEBAR_GROUPING_PROJECT_TESTID
        : SIDEBAR_GROUPING_STATUS_TESTID;
    const menuItem = doc.querySelector?.(`[data-testid="${testId}"]`);
    if (menuItem && typeof menuItem.click === "function") {
      menuItem.click();
      applied = true;
    }
  }

  // Keep persisted localStorage consistent when available
  try {
    const storeStorage = storage();
    if (storeStorage) {
      const raw = storeStorage.getItem(PASEO_SIDEBAR_VIEW_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: Record<string, unknown>; version?: number };
        if (parsed && typeof parsed === "object" && parsed.state) {
          parsed.state.groupMode = nextMode;
          storeStorage.setItem(PASEO_SIDEBAR_VIEW_STORAGE_KEY, JSON.stringify(parsed));
          if (!applied) applied = true;
        }
      }
    }
  } catch {
    // Ignore storage update error
  }

  const trigger: SidebarGroupingTrigger =
    options?.trigger ?? (target === "toggle" ? "toggle" : target);
  const alreadyActive = prevMode === nextMode;
  const message = alreadyActive
    ? `Already grouped by ${nextMode}.`
    : applied
      ? `Switched sidebar grouping from ${prevMode} to ${nextMode}.`
      : `Could not locate Paseo sidebar store to switch to ${nextMode}.`;

  recordSidebarGroupingReceipt(trigger, prevMode, nextMode, applied, message);

  if (applied && !options?.silentToast) {
    showGroupingToast(doc, win, nextMode, alreadyActive);
  }

  try {
    if (win && typeof (win as unknown as Window).dispatchEvent === "function") {
      (win as unknown as Window).dispatchEvent(
        new CustomEvent(SIDEBAR_GROUPING_SHORTCUT_EVENT, {
          detail: { type: "switch", prevMode, nextMode, ok: applied },
        }),
      );
    }
  } catch {
    // Ignore event error
  }

  return { ok: applied, prevMode, nextMode, message };
}

// ---------------------------------------------------------------------------
// DOM annotation & input safety
// ---------------------------------------------------------------------------

function isVisible(el: ElementLike): boolean {
  if (el.isConnected === false) return false;
  return typeof el.getClientRects === "function" ? el.getClientRects().length > 0 : true;
}

function insideForeignOwner(target: unknown): boolean {
  const el = target as ElementLike | null;
  if (!el || typeof el.closest !== "function") return false;
  return FOREIGN_OWNERS.some((selector) => Boolean(el.closest?.(selector)));
}

function isShortcutRecordingActive(doc: DocLike): boolean {
  try {
    if (doc.documentElement?.getAttribute?.("data-paseo-recording-shortcut") === "true") {
      return true;
    }
    if (doc.body?.getAttribute?.("data-paseo-recording-shortcut") === "true") {
      return true;
    }
    const nodes = doc.querySelectorAll('[data-paseo-recording-shortcut="true"]');
    return nodes.length > 0;
  } catch {
    return false;
  }
}

export function annotateSidebarGroupingMenu(
  docOverride?: DocLike | null,
  winOverride?: unknown,
): number {
  const doc =
    docOverride ?? (typeof document !== "undefined" ? (document as unknown as DocLike) : null);
  const win = (winOverride ?? (typeof window !== "undefined" ? window : null)) as {
    navigator?: { platform?: string; userAgent?: string };
  } | null;
  if (!doc) return 0;

  const prefs = readSidebarGroupingShortcutPrefs();
  const isMac = isMacPlatform(win?.navigator);
  const { projectChord, statusChord } = resolveGroupingShortcutChords(prefs);

  const pairs: Array<{
    testId: string;
    badgeTestId: string;
    chord: ParsedShortcutChord | null;
  }> = [
    {
      testId: SIDEBAR_GROUPING_PROJECT_TESTID,
      badgeTestId: "sidebar-grouping-project-shortcut-hint",
      chord: prefs.enabled ? projectChord : null,
    },
    {
      testId: SIDEBAR_GROUPING_STATUS_TESTID,
      badgeTestId: "sidebar-grouping-status-shortcut-hint",
      chord: prefs.enabled ? statusChord : null,
    },
  ];

  let updated = 0;
  for (const pair of pairs) {
    const items = Array.from(doc.querySelectorAll(`[data-testid="${pair.testId}"]`));
    for (const item of items) {
      if (!item || !isVisible(item)) continue;
      const display = pair.chord ? formatProjectPickerShortcutDisplay(pair.chord, isMac) : "";
      const aria = pair.chord ? formatAriaKeyShortcut(pair.chord, isMac) : "";

      if (aria) {
        if (item.getAttribute("aria-keyshortcuts") !== aria) {
          item.setAttribute?.("aria-keyshortcuts", aria);
        }
      } else if (item.getAttribute("aria-keyshortcuts") !== null) {
        item.removeAttribute?.("aria-keyshortcuts");
      }

      const existingBadges = Array.from(
        item.querySelectorAll?.(`[data-testid="${pair.badgeTestId}"]`) ?? [],
      );
      if (!display) {
        for (const b of existingBadges) b.remove?.();
        continue;
      }

      if (existingBadges.length > 0) {
        for (let i = 1; i < existingBadges.length; i += 1) {
          existingBadges[i]?.remove?.();
        }
        const first = existingBadges[0];
        if (first && first.textContent !== display) {
          first.textContent = display;
          updated += 1;
        }
        continue;
      }

      if (typeof doc.createElement !== "function") continue;
      const badge = doc.createElement("span");
      badge.textContent = display;
      badge.setAttribute?.("data-testid", pair.badgeTestId);
      if (badge.style) {
        Object.assign(badge.style, {
          marginLeft: "auto",
          marginRight: "6px",
          fontSize: "11px",
          lineHeight: "14px",
          padding: "1px 5px",
          borderRadius: "4px",
          backgroundColor: "rgba(128, 128, 128, 0.14)",
          color: "currentColor",
          opacity: "0.68",
          pointerEvents: "none",
          userSelect: "none",
          fontWeight: "400",
          letterSpacing: "0.02em",
          display: "inline-flex",
          alignItems: "center",
        });
      }

      // If the item has a trailing checkmark svg, place badge neatly before it
      const children = item.children ? Array.from(item.children) : [];
      const trailingCheck = children.find((c) => {
        const tag = (c.tagName ?? "").toUpperCase();
        return tag === "SVG" || Boolean(c.querySelector?.("svg"));
      });
      // Only treat the last child as trailing checkmark (first svg is the leading icon)
      const lastChild = children.length > 1 ? children[children.length - 1] : null;
      const hasTrailingCheck =
        lastChild &&
        lastChild !== children[0] &&
        ((lastChild.tagName ?? "").toUpperCase() === "SVG" ||
          Boolean(lastChild.querySelector?.("svg")));
      if (hasTrailingCheck && lastChild && typeof item.insertBefore === "function") {
        item.insertBefore(badge, lastChild);
      } else if (trailingCheck && children.length > 1 && lastChild && typeof item.insertBefore === "function") {
        item.appendChild?.(badge);
      } else {
        item.appendChild?.(badge);
      }
      updated += 1;
    }
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Status + self-test (能读 / 能试)
// ---------------------------------------------------------------------------

export function getSidebarGroupingShortcutStatus(
  docOverride?: DocLike | null,
  winOverride?: unknown,
): SidebarGroupingShortcutStatus {
  const win = winOverride ?? (typeof window !== "undefined" ? window : null);
  const doc =
    docOverride ?? (typeof document !== "undefined" ? (document as unknown as DocLike) : null);
  const prefs = readSidebarGroupingShortcutPrefs();
  const { projectSpec, statusSpec } = resolveGroupingShortcutSpecs(prefs);
  const { projectChord, statusChord } = resolveGroupingShortcutChords(prefs);
  const isMac = isMacPlatform((win as { navigator?: { platform?: string; userAgent?: string } } | null)?.navigator);

  return {
    prefs,
    currentMode: readCurrentSidebarGroupingMode(win, doc),
    projectSpec,
    statusSpec,
    projectChord,
    statusChord,
    displayProjectShortcut: formatProjectPickerShortcutDisplay(projectChord, isMac) || "unset",
    displayStatusShortcut: formatProjectPickerShortcutDisplay(statusChord, isMac) || "unset",
    installed: installedOwner !== null,
    storeAvailable: resolveSidebarViewStore(win) !== null,
    receipts: readSidebarGroupingReceipts(),
  };
}

export function runSidebarGroupingShortcutSelfTest(
  docOverride?: DocLike | null,
  winOverride?: unknown,
): SidebarGroupingShortcutStatus {
  const status = getSidebarGroupingShortcutStatus(docOverride, winOverride);
  const hasAnyChord = status.projectChord !== null || status.statusChord !== null;
  const ok = status.installed && status.prefs.enabled && hasAnyChord;
  const summary = [
    `enabled=${status.prefs.enabled}`,
    `mode=${status.currentMode}`,
    `project=${status.displayProjectShortcut}`,
    `status=${status.displayStatusShortcut}`,
    `store=${status.storeAvailable}`,
    `installed=${status.installed}`,
  ].join(" · ");
  recordSidebarGroupingReceipt("self-test", status.currentMode, status.currentMode, ok, summary);
  return { ...status, receipts: readSidebarGroupingReceipts() };
}

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------

export interface SidebarGroupingShortcutHandle {
  (): void;
  reconcileNow?: () => void;
  switchTo?: (target: "project" | "status" | "toggle") => boolean;
}

export function installSidebarGroupingShortcut(
  docOverride?: Document | null,
): SidebarGroupingShortcutHandle {
  const doc = docOverride ?? (typeof document !== "undefined" ? document : null);
  const win = doc?.defaultView ?? (typeof window !== "undefined" ? window : null);
  if (!doc || !doc.body || !win) return () => {};
  const dom = doc as unknown as DocLike;
  const isMac = isMacPlatform(win.navigator);

  let observer: MutationObserver | null = null;
  let frame = 0;

  const reconcile = () => {
    frame = 0;
    annotateSidebarGroupingMenu(dom, win);
  };

  const schedule = () => {
    if (frame) return;
    if (typeof win.requestAnimationFrame === "function") {
      let ran = false;
      const id = win.requestAnimationFrame(() => {
        ran = true;
        reconcile();
      });
      frame = ran ? 0 : id;
      return;
    }
    reconcile();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    const prefs = readSidebarGroupingShortcutPrefs();
    if (!prefs.enabled) return;

    if (isShortcutRecordingActive(dom)) return;
    if (insideForeignOwner(event.target)) return;

    const { projectChord, statusChord } = resolveGroupingShortcutChords(prefs);
    const matchesProject = projectChord
      ? matchesParsedShortcutChord(event, projectChord, isMac)
      : false;
    const matchesStatus = statusChord
      ? matchesParsedShortcutChord(event, statusChord, isMac)
      : false;

    if (!matchesProject && !matchesStatus) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (event.repeat) return;

    const currentMode = readCurrentSidebarGroupingMode(win, dom);

    // If both shortcuts resolve to the exact same chord, always toggle
    if (matchesProject && matchesStatus) {
      switchSidebarGrouping("toggle", { win, doc: dom, trigger: "toggle" });
      return;
    }

    if (matchesProject) {
      if (prefs.toggleOnRePress && currentMode === "project") {
        switchSidebarGrouping("toggle", { win, doc: dom, trigger: "toggle" });
      } else {
        switchSidebarGrouping("project", { win, doc: dom, trigger: "project" });
      }
      return;
    }

    if (matchesStatus) {
      if (prefs.toggleOnRePress && currentMode === "status") {
        switchSidebarGrouping("toggle", { win, doc: dom, trigger: "toggle" });
      } else {
        switchSidebarGrouping("status", { win, doc: dom, trigger: "status" });
      }
    }
  };

  const onPrefsSync = () => {
    schedule();
  };

  const onStorageSync = (ev: Event) => {
    const key = (ev as { key?: string | null }).key;
    if (key === null || key === PREFS_STORAGE_KEY) {
      schedule();
    }
  };

  win.addEventListener("keydown", onKeyDown, true);
  win.addEventListener(SIDEBAR_GROUPING_SHORTCUT_EVENT, onPrefsSync);
  win.addEventListener("storage", onStorageSync);

  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => {
      schedule();
    });
    observer.observe(doc.body, {
      childList: true,
      subtree: true,
    });
  }

  const owner = {};
  installedOwner = owner;
  const switchFn = (target: "project" | "status" | "toggle") =>
    switchSidebarGrouping(target, { win, doc: dom }).ok;

  const bridge = {
    status: () => getSidebarGroupingShortcutStatus(dom, win),
    selfTest: () => runSidebarGroupingShortcutSelfTest(dom, win),
    switchTo: switchFn,
    toggle: () => switchFn("toggle"),
    setPrefs: (partial: Partial<SidebarGroupingShortcutPrefs>) =>
      syncSidebarGroupingShortcutPrefs(partial),
  };

  if (typeof globalThis !== "undefined") {
    (globalThis as Record<string, unknown>)[GLOBAL_BRIDGE_KEY] = bridge;
  }

  reconcile();

  const cleanup = (() => {
    if (installedOwner === owner) installedOwner = null;
    if (typeof globalThis !== "undefined") {
      const g = globalThis as Record<string, unknown>;
      if (g[GLOBAL_BRIDGE_KEY] === bridge) {
        delete g[GLOBAL_BRIDGE_KEY];
      }
    }
    win.removeEventListener("keydown", onKeyDown, true);
    win.removeEventListener(SIDEBAR_GROUPING_SHORTCUT_EVENT, onPrefsSync);
    win.removeEventListener("storage", onStorageSync);
    observer?.disconnect();
    if (frame && typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(frame);
  }) as SidebarGroupingShortcutHandle;

  cleanup.reconcileNow = reconcile;
  cleanup.switchTo = switchFn;
  return cleanup;
}

export function triggerSidebarGroupingFromShortcut(
  target: "project" | "status" | "toggle",
): boolean {
  return switchSidebarGrouping(target).ok;
}
