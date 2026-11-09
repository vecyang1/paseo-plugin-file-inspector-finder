/// <reference lib="dom" />
/**
 * Sidebar Default Collapse — a project that shows up in the left sidebar for the first time
 * (usually because a schedule ran an agent in a new folder) starts collapsed.
 *
 * Paseo v0.15.3 stores collapse state in its `sidebar-collapsed-sections` store, where a key
 * that is absent means "expanded", so every new project opens expanded. The plugin SDK cannot
 * reach that store, so this module presses the native project header row, the same way a
 * person would, through upstream test ids (`components/sidebar-workspace-list.tsx`):
 *   header    `sidebar-project-row-<viewKey>`
 *   expanded  `sidebar-workspace-list-<viewKey>` | `sidebar-project-new-workspace-row-<viewKey>`
 *   active    `sidebar-workspace-row-*[aria-selected="true"]` inside that list
 *
 * Paseo's own store stays the truth for collapse state. This module only remembers which
 * project keys it has already seen, so a project you expand by hand is never touched again,
 * and a new project that holds the workspace you are on stays open.
 *
 * The first run (nothing remembered yet) waits for the sidebar to settle, then collapses only
 * the projects that are open with no workspaces in them (just the "New workspace" row). Every
 * action writes a receipt (能读 / 能试 / 能调 in Settings -> Plugins -> File Inspector & Finder).
 */

export interface SidebarDefaultCollapsePrefs {
  enabled: boolean;
}

export interface SidebarProjectInfo {
  viewKey: string;
  name: string;
  expanded: boolean;
  /** Expanded, and the only child is the "New workspace" row. */
  empty: boolean;
  /** Holds the selected workspace row. */
  active: boolean;
}

export type SidebarCollapseReason = "new-project" | "first-run-empty" | "manual-empty";

export interface SidebarCollapsePlan {
  firstRun: boolean;
  collapse: Array<{ viewKey: string; name: string; reason: SidebarCollapseReason }>;
  keptOpen: Array<{ viewKey: string; name: string; why: "active" | "has-workspaces" | "disabled" }>;
  remember: string[];
}

export type SidebarCollapseTrigger = "seed" | "collapse" | "kept-open" | "self-test" | "manual";

export interface SidebarCollapseReceipt {
  at: string;
  trigger: SidebarCollapseTrigger;
  ok: boolean;
  outcome: string;
}

export interface SidebarDefaultCollapseStatus {
  prefs: SidebarDefaultCollapsePrefs;
  installed: boolean;
  knownCount: number | null;
  projects: SidebarProjectInfo[];
  pending: SidebarCollapsePlan | null;
  receipts: SidebarCollapseReceipt[];
}

export const PROJECT_ROW_PREFIX = "sidebar-project-row-";
export const WORKSPACE_LIST_PREFIX = "sidebar-workspace-list-";
export const NEW_WORKSPACE_ROW_PREFIX = "sidebar-project-new-workspace-row-";
export const SIDEBAR_DEFAULT_COLLAPSE_EVENT = "paseo-finder:sidebar-default-collapse";

const PREFS_STORAGE_KEY = "paseo:finder-plugin:sidebar-default-collapse";
const KNOWN_STORAGE_KEY = "paseo:finder-plugin:sidebar-known-projects";
const RECEIPTS_STORAGE_KEY = "paseo:finder-plugin:sidebar-default-collapse-receipts";
/** Set when "Collapse empty projects now" is pressed where the sidebar is not on screen (Settings). */
const PENDING_TIDY_STORAGE_KEY = "paseo:finder-plugin:sidebar-collapse-pending-tidy";
const MAX_RECEIPTS = 20;
const MAX_KNOWN_KEYS = 3000;
/** Sidebar mutations are bursty (status dots, timers); one scan per quiet period. */
const SCAN_DEBOUNCE_MS = 400;
/** A first run needs two identical scans this far apart, so a half-rendered sidebar is not seeded. */
const SETTLE_MS = 1500;
const READ_BACK_DELAY_MS = 350;

const DEFAULT_PREFS: SidebarDefaultCollapsePrefs = { enabled: true };

let installedOwner: object | null = null;

// ---------------------------------------------------------------------------
// Storage: prefs (mirror of host-scoped plugin settings), known keys, receipts
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function normalizeSidebarDefaultCollapsePrefs(raw: unknown): SidebarDefaultCollapsePrefs {
  const value = raw && typeof raw === "object" ? (raw as Partial<SidebarDefaultCollapsePrefs>) : {};
  return { enabled: value.enabled !== false };
}

export function readSidebarDefaultCollapsePrefs(): SidebarDefaultCollapsePrefs {
  try {
    const raw = storage()?.getItem(PREFS_STORAGE_KEY);
    return normalizeSidebarDefaultCollapsePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function syncSidebarDefaultCollapsePrefs(
  prefs: Partial<SidebarDefaultCollapsePrefs>,
): SidebarDefaultCollapsePrefs {
  const next = normalizeSidebarDefaultCollapsePrefs({ ...readSidebarDefaultCollapsePrefs(), ...prefs });
  try {
    storage()?.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  return next;
}

/** `null` means nothing has been remembered yet (first run), which is not the same as "none". */
export function readKnownProjectKeys(): Set<string> | null {
  try {
    const raw = storage()?.getItem(KNOWN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { keys?: unknown };
    if (!parsed || !Array.isArray(parsed.keys)) return null;
    return new Set(parsed.keys.filter((k): k is string => typeof k === "string"));
  } catch {
    return null;
  }
}

export function writeKnownProjectKeys(keys: Iterable<string>): void {
  const list = Array.from(new Set(keys));
  try {
    storage()?.setItem(
      KNOWN_STORAGE_KEY,
      JSON.stringify({ v: 1, keys: list.slice(Math.max(0, list.length - MAX_KNOWN_KEYS)) }),
    );
  } catch {
    // Ignore storage errors
  }
}

export function forgetKnownProjectKeys(): void {
  try {
    storage()?.removeItem(KNOWN_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function readSidebarCollapseReceipts(): SidebarCollapseReceipt[] {
  try {
    const raw = storage()?.getItem(RECEIPTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as SidebarCollapseReceipt[]).slice(0, MAX_RECEIPTS) : [];
  } catch {
    return [];
  }
}

export function recordSidebarCollapseReceipt(
  trigger: SidebarCollapseTrigger,
  ok: boolean,
  outcome: string,
): SidebarCollapseReceipt {
  const receipt: SidebarCollapseReceipt = { at: new Date().toISOString(), trigger, ok, outcome };
  try {
    const next = [receipt, ...readSidebarCollapseReceipts()].slice(0, MAX_RECEIPTS);
    storage()?.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(SIDEBAR_DEFAULT_COLLAPSE_EVENT, { detail: receipt }));
    }
  } catch {
    // CustomEvent unavailable in some test environments
  }
  return receipt;
}

// ---------------------------------------------------------------------------
// Reading the sidebar
// ---------------------------------------------------------------------------

interface ElementLike {
  getAttribute?(name: string): string | null;
  querySelector?(selector: string): ElementLike | null;
  closest?(selector: string): ElementLike | null;
  textContent?: string | null;
  click?(): void;
}

interface DocLike {
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
}

function testIdsWithPrefix(doc: DocLike, prefix: string): Map<string, ElementLike> {
  const found = new Map<string, ElementLike>();
  const nodes = doc.querySelectorAll(`[data-testid^="${prefix}"]`);
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const testId = node?.getAttribute?.("data-testid") ?? "";
    if (node && testId.startsWith(prefix)) found.set(testId.slice(prefix.length), node);
  }
  return found;
}

function projectName(row: ElementLike): string {
  const group = row.closest?.('[role="group"]');
  const label = group?.getAttribute?.("aria-label") ?? row.getAttribute?.("aria-label") ?? "";
  return (label || row.textContent || "").trim().slice(0, 80);
}

export function readSidebarProjects(doc: DocLike): SidebarProjectInfo[] {
  const rows = testIdsWithPrefix(doc, PROJECT_ROW_PREFIX);
  const lists = testIdsWithPrefix(doc, WORKSPACE_LIST_PREFIX);
  const ghosts = testIdsWithPrefix(doc, NEW_WORKSPACE_ROW_PREFIX);
  const projects: SidebarProjectInfo[] = [];
  for (const [viewKey, row] of rows) {
    const list = lists.get(viewKey) ?? null;
    const expanded = Boolean(list) || ghosts.has(viewKey);
    const active = Boolean(
      list?.querySelector?.('[data-testid^="sidebar-workspace-row-"][aria-selected="true"]'),
    );
    projects.push({
      viewKey,
      name: projectName(row),
      expanded,
      empty: expanded && !list,
      active,
    });
  }
  return projects;
}

export function isSidebarProjectExpanded(doc: DocLike, viewKey: string): boolean {
  return readSidebarProjects(doc).some((p) => p.viewKey === viewKey && p.expanded);
}

// ---------------------------------------------------------------------------
// Deciding (pure)
// ---------------------------------------------------------------------------

export function planSidebarCollapse(input: {
  projects: SidebarProjectInfo[];
  known: Set<string> | null;
  enabled: boolean;
}): SidebarCollapsePlan {
  const firstRun = input.known === null;
  const plan: SidebarCollapsePlan = { firstRun, collapse: [], keptOpen: [], remember: [] };
  for (const p of input.projects) {
    const isNew = firstRun || !input.known!.has(p.viewKey);
    if (!isNew) continue;
    plan.remember.push(p.viewKey);
    if (!p.expanded) continue;
    const ref = { viewKey: p.viewKey, name: p.name };
    if (!input.enabled) {
      plan.keptOpen.push({ ...ref, why: "disabled" });
    } else if (p.active) {
      plan.keptOpen.push({ ...ref, why: "active" });
    } else if (firstRun && !p.empty) {
      // First run only tidies the auto-added clutter; projects with workspaces keep their layout.
      plan.keptOpen.push({ ...ref, why: "has-workspaces" });
    } else {
      plan.collapse.push({ ...ref, reason: firstRun ? "first-run-empty" : "new-project" });
    }
  }
  return plan;
}

export function planCollapseEmptyProjects(projects: SidebarProjectInfo[]): SidebarCollapsePlan {
  return {
    firstRun: false,
    collapse: projects
      .filter((p) => p.expanded && p.empty && !p.active)
      .map((p) => ({ viewKey: p.viewKey, name: p.name, reason: "manual-empty" as const })),
    keptOpen: [],
    remember: projects.map((p) => p.viewKey),
  };
}

/**
 * ⌘K and modal sheets stay mounted for a frame after a click. A synthetic row press in that window
 * reaches the auto-reveal capture listener, which reads the open panel's first row as a navigation
 * hint (vault/research/2026-11-09-paseo-cmdk-reveal-freeze.md). So nothing is pressed while one is open;
 * the scan runs again when it closes.
 */
export const OVERLAY_SELECTOR = '[data-testid="command-center-panel"],[aria-modal="true"]';

export function overlayOpen(doc: DocLike): boolean {
  return doc.querySelectorAll(OVERLAY_SELECTOR).length > 0;
}

function sameKeys(a: SidebarProjectInfo[], b: SidebarProjectInfo[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map((p) => p.viewKey));
  return b.every((p) => keys.has(p.viewKey));
}

// ---------------------------------------------------------------------------
// Acting
// ---------------------------------------------------------------------------

/** Presses the native header row for each planned project; returns how many were pressed. */
export function pressProjectRows(doc: DocLike, plan: SidebarCollapsePlan): number {
  if (plan.collapse.length === 0) return 0;
  const rows = testIdsWithPrefix(doc, PROJECT_ROW_PREFIX);
  let pressed = 0;
  for (const item of plan.collapse) {
    const row = rows.get(item.viewKey);
    if (!row?.click) continue;
    row.click();
    pressed += 1;
  }
  return pressed;
}

/** Reads the sidebar again and reports which planned collapses did not take. */
export function judgeCollapse(doc: DocLike, plan: SidebarCollapsePlan): { collapsed: string[]; stillOpen: string[] } {
  const now = new Map(readSidebarProjects(doc).map((p) => [p.viewKey, p]));
  const collapsed: string[] = [];
  const stillOpen: string[] = [];
  for (const item of plan.collapse) {
    if (now.get(item.viewKey)?.expanded) stillOpen.push(item.name || item.viewKey);
    else collapsed.push(item.name || item.viewKey);
  }
  return { collapsed, stillOpen };
}

function summarize(names: string[], max = 4): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max} more`;
}

export interface SidebarDefaultCollapseHandle {
  (): void;
}

export function installSidebarDefaultCollapse(docOverride?: Document | null): SidebarDefaultCollapseHandle {
  const doc = docOverride ?? (typeof document !== "undefined" ? document : null);
  const win = doc?.defaultView ?? (typeof window !== "undefined" ? window : null);
  if (!doc || !doc.body || !win) return () => {};
  const dom = doc as unknown as DocLike;
  const owner = {};
  installedOwner = owner;

  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const id = win.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  let scanTimer = 0;
  let settleCandidate: SidebarProjectInfo[] | null = null;
  let acting = false;

  const apply = (plan: SidebarCollapsePlan, trigger: SidebarCollapseTrigger) => {
    const known = readKnownProjectKeys() ?? new Set<string>();
    writeKnownProjectKeys([...known, ...plan.remember]);
    for (const kept of plan.keptOpen) {
      if (kept.why === "active") {
        recordSidebarCollapseReceipt("kept-open", true, `${kept.name || kept.viewKey}: new, but it holds the open workspace`);
      }
    }
    if (plan.collapse.length === 0) {
      if (plan.firstRun) {
        recordSidebarCollapseReceipt("seed", true, `remembered ${plan.remember.length} projects; none needed collapsing`);
      }
      return;
    }
    acting = true;
    const pressed = pressProjectRows(dom, plan);
    later(() => {
      acting = false;
      const { collapsed, stillOpen } = judgeCollapse(dom, plan);
      const lead = plan.firstRun
        ? `first run: remembered ${plan.remember.length} projects, collapsed ${collapsed.length} empty`
        : trigger === "manual"
          ? `collapsed ${collapsed.length} empty project(s)`
          : `collapsed ${collapsed.length} new project(s)`;
      recordSidebarCollapseReceipt(
        plan.firstRun ? "seed" : trigger,
        stillOpen.length === 0 && pressed === plan.collapse.length,
        `${lead}${collapsed.length ? `: ${summarize(collapsed)}` : ""}${
          stillOpen.length ? ` · still open after press: ${summarize(stillOpen)}` : ""
        }`,
      );
    }, READ_BACK_DELAY_MS);
  };

  const scan = () => {
    scanTimer = 0;
    if (installedOwner !== owner || acting) return;
    if (overlayOpen(dom)) {
      later(schedule, SCAN_DEBOUNCE_MS); // closing an overlay may not mutate the sidebar
      return;
    }
    const projects = readSidebarProjects(dom);
    if (projects.length === 0) return; // sidebar hidden or still loading
    if (storage()?.getItem(PENDING_TIDY_STORAGE_KEY) && readKnownProjectKeys() !== null) {
      runManualTidy(projects);
      return;
    }
    const known = readKnownProjectKeys();
    if (known === null) {
      // First run: wait until two scans agree, so a half-rendered list is not taken as "all".
      if (!settleCandidate || !sameKeys(settleCandidate, projects)) {
        settleCandidate = projects;
        later(schedule, SETTLE_MS);
        return;
      }
      settleCandidate = null;
    }
    if (known && projects.every((p) => known.has(p.viewKey))) return;
    const plan = planSidebarCollapse({ projects, known, enabled: readSidebarDefaultCollapsePrefs().enabled });
    apply(plan, "collapse");
  };

  function schedule() {
    if (scanTimer || installedOwner !== owner) return;
    scanTimer = win!.setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  const runManualTidy = (projects: SidebarProjectInfo[]): number => {
    try {
      storage()?.removeItem(PENDING_TIDY_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    const plan = planCollapseEmptyProjects(projects);
    if (plan.collapse.length === 0) {
      recordSidebarCollapseReceipt("manual", true, "no open empty projects to collapse");
      writeKnownProjectKeys([...(readKnownProjectKeys() ?? []), ...plan.remember]);
      return 0;
    }
    apply(plan, "manual");
    return plan.collapse.length;
  };

  activeManualCollapse = () => {
    const projects = readSidebarProjects(dom);
    if (projects.length > 0 && !overlayOpen(dom)) return runManualTidy(projects);
    try {
      storage()?.setItem(PENDING_TIDY_STORAGE_KEY, new Date().toISOString());
    } catch {
      // Ignore storage errors
    }
    recordSidebarCollapseReceipt("manual", true, "queued: empty projects collapse when the sidebar is back on screen");
    return 0;
  };

  const observer =
    typeof win.MutationObserver === "function" ? new win.MutationObserver(schedule) : null;
  observer?.observe(doc.body, { childList: true, subtree: true });
  schedule();

  return () => {
    observer?.disconnect();
    if (scanTimer) win.clearTimeout(scanTimer);
    for (const id of timers) win.clearTimeout(id);
    timers.clear();
    if (installedOwner === owner) {
      installedOwner = null;
      activeManualCollapse = null;
    }
  };
}

let activeManualCollapse: (() => number) | null = null;

/** 能调: collapse every open project that has no workspaces, now. Returns how many were pressed. */
export function collapseEmptySidebarProjectsNow(): number {
  return activeManualCollapse ? activeManualCollapse() : 0;
}

/** 能读 / 能试: what the module sees and would do right now, without pressing anything. */
export function getSidebarDefaultCollapseStatus(docOverride?: DocLike | null): SidebarDefaultCollapseStatus {
  const doc = docOverride ?? (typeof document !== "undefined" ? (document as unknown as DocLike) : null);
  const prefs = readSidebarDefaultCollapsePrefs();
  const known = readKnownProjectKeys();
  const projects = doc ? readSidebarProjects(doc) : [];
  const pending = projects.length ? planSidebarCollapse({ projects, known, enabled: prefs.enabled }) : null;
  return {
    prefs,
    installed: installedOwner !== null,
    knownCount: known ? known.size : null,
    projects,
    pending,
    receipts: readSidebarCollapseReceipts(),
  };
}

export function runSidebarDefaultCollapseSelfTest(docOverride?: DocLike | null): SidebarDefaultCollapseStatus {
  const status = getSidebarDefaultCollapseStatus(docOverride);
  const open = status.projects.filter((p) => p.expanded);
  const pendingCollapse = status.pending?.collapse.length ?? 0;
  const ok = status.installed && status.projects.length > 0;
  recordSidebarCollapseReceipt(
    "self-test",
    ok,
    `${status.prefs.enabled ? "on" : "off"} · installed=${status.installed} · ${status.projects.length} projects visible, ${open.length} open (${open.filter((p) => p.empty).length} empty) · remembered=${status.knownCount ?? "none yet"} · would collapse now: ${pendingCollapse}`,
  );
  return getSidebarDefaultCollapseStatus(docOverride);
}
