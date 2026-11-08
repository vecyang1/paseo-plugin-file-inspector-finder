/// <reference lib="dom" />
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  type ScheduleRunEntry,
  type ScheduleRunsSummary,
  inspectScheduleRunsRpc,
  openScheduleRunSessionRpc,
} from "../shared/schedule-runs-contracts";
import { isChineseLocale } from "./i18n";
import { type PaseoThemeTokens } from "../shared/paseo-theme";
import { syncPaseoThemeCssVariables } from "./theme-web";

export interface ScheduleRunsWebClient {
  call<TDef extends typeof inspectScheduleRunsRpc | typeof openScheduleRunSessionRpc>(
    def: TDef,
    input: RpcInput<TDef>,
  ): Promise<RpcOutput<TDef>>;
}

interface ScheduleRunsCopy {
  allRunsBtn: string;
  runsPillPrefix: string;
  viewRunsMenu: string;
  drawerBreadcrumbRoot: string;
  drawerTitleAllRuns: string;
  drawerSubtitleAllRuns: string;
  runNowBtn: string;
  runningNowToast: string;
  keepOpenToggleOn: string;
  keepOpenToggleOff: string;
  settingsHeading: string;
  scheduleLabel: string;
  workspaceLabel: string;
  modelLabel: string;
  archivePolicyLabel: string;
  archivePolicyTrue: string;
  archivePolicyFalse: string;
  instructionsHeading: string;
  showAllPrompt: string;
  collapsePrompt: string;
  runsHeading: string;
  noRunsYet: string;
  openConversationBtn: string;
  openingConversationToast: string;
  previewTimelineBtn: string;
  hideTimelineBtn: string;
  filterOnlyWithRuns: string;
  filterAllSchedules: string;
  searchPlaceholder: string;
  statusActive: string;
  statusPaused: string;
  standbyBadge: string;
  archivedBadge: string;
  activeWorkspaceBadge: string;
  closeBtn: string;
}

const COPY_EN: ScheduleRunsCopy = {
  allRunsBtn: "All Runs",
  runsPillPrefix: "Runs",
  viewRunsMenu: "View runs & conversation history",
  drawerBreadcrumbRoot: "Schedules",
  drawerTitleAllRuns: "Schedule Runs & Execution History",
  drawerSubtitleAllRuns:
    "Inspect all schedule runs across Paseo & Antigravity standby twins, preview outputs, or click into any run conversation.",
  runNowBtn: "▶ Run Now",
  runningNowToast: "Triggered schedule run in Paseo",
  keepOpenToggleOn: "Archive on finish: ON",
  keepOpenToggleOff: "Keep workspace open: ON",
  settingsHeading: "Settings",
  scheduleLabel: "Schedule",
  workspaceLabel: "Workspace",
  modelLabel: "Model",
  archivePolicyLabel: "Workspace retention",
  archivePolicyTrue: "Archive on finish (auto-unarchives on click)",
  archivePolicyFalse: "Keep open in sidebar",
  instructionsHeading: "Instructions",
  showAllPrompt: "Show all",
  collapsePrompt: "Show less",
  runsHeading: "Runs",
  noRunsYet: "No recorded runs for this schedule yet. Click 'Run Now' to trigger one.",
  openConversationBtn: "Open Conversation ↗",
  openingConversationToast: "Restoring & opening run workspace...",
  previewTimelineBtn: "Preview Chat & Output",
  hideTimelineBtn: "Hide Preview",
  filterOnlyWithRuns: "With Runs",
  filterAllSchedules: "All Schedules",
  searchPlaceholder: "Search schedules, models, or run outputs...",
  statusActive: "Active",
  statusPaused: "Paused",
  standbyBadge: "AG Standby Twin",
  archivedBadge: "Archived (Auto-Restores)",
  activeWorkspaceBadge: "Active in Sidebar",
  closeBtn: "Close (Esc)",
};

const COPY_ZH: ScheduleRunsCopy = {
  allRunsBtn: "全部运行记录",
  runsPillPrefix: "运行",
  viewRunsMenu: "查看运行历史与会话详情",
  drawerBreadcrumbRoot: "定时任务 (Schedules)",
  drawerTitleAllRuns: "定时任务运行历史与会话巡检器",
  drawerSubtitleAllRuns:
    "对标 Antigravity Automations：查看所有任务历史运行次数、执行耗时与输出摘要，一键唤醒并进入任意历史运行对话。",
  runNowBtn: "▶ 立即运行",
  runningNowToast: "已触发 Paseo 立即执行该定时任务",
  keepOpenToggleOn: "完成后自动归档: 开启",
  keepOpenToggleOff: "常驻侧边栏: 开启",
  settingsHeading: "调度配置",
  scheduleLabel: "执行周期",
  workspaceLabel: "工作目录",
  modelLabel: "执行模型",
  archivePolicyLabel: "会话保留策略",
  archivePolicyTrue: "完成后归档（点击进入对话时自动恢复）",
  archivePolicyFalse: "完成后保留在左侧边栏",
  instructionsHeading: "任务指令 (Prompt)",
  showAllPrompt: "展开全部",
  collapsePrompt: "收起指令",
  runsHeading: "历史运行记录 (Runs)",
  noRunsYet: "该定时任务尚无历史运行记录，可点击右上角「立即运行」触发。",
  openConversationBtn: "进入对话 ↗",
  openingConversationToast: "正在恢复并打开该次运行的工作区会话...",
  previewTimelineBtn: "预览对话与输出",
  hideTimelineBtn: "收起预览",
  filterOnlyWithRuns: "仅看有运行记录",
  filterAllSchedules: "全部定时任务",
  searchPlaceholder: "搜索任务名称、模型或运行输出内容...",
  statusActive: "运行中 (Active)",
  statusPaused: "已暂停 (Standby)",
  standbyBadge: "AG 灾备孪生",
  archivedBadge: "已归档 (点击自动恢复)",
  activeWorkspaceBadge: "侧边栏活跃",
  closeBtn: "关闭 (Esc)",
};

function isZhLocale(): boolean {
  if (typeof navigator !== "undefined" && navigator.language) {
    return isChineseLocale(navigator.language);
  }
  return false;
}

function getCopy(): ScheduleRunsCopy {
  return isZhLocale() ? COPY_ZH : COPY_EN;
}

function formatRelativeIso(iso: string | null): string {
  if (!iso) return "-";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function formatShortTimestamp(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const SCHEDULE_RUNS_STORAGE_KEY = "paseo:finder-plugin:schedule-runs-config";
const CIRCUIT_BREAKER_WINDOW_MS = 1000;
const CIRCUIT_BREAKER_MAX_WRITE_PASSES = 25;
const FETCH_RETRY_COOLDOWN_MS = 5000;

export interface ScheduleRunsPreferences {
  enabled: boolean;
  sourceBadge: "plugin-settings" | "localStorage" | "default";
}

export interface ScheduleRunsDomHealthSnapshot {
  enabled: boolean;
  sourceBadge: "plugin-settings" | "localStorage" | "default";
  observerConnected: boolean;
  circuitBreakerTripped: boolean;
  circuitBreakerReason: string | null;
  circuitBreakerTrippedAtIso: string | null;
  totalPasses: number;
  writePasses: number;
  skippedNoOpPasses: number;
  totalDomWrites: number;
  ignoredSelfMutationBatches: number;
  lastPassDurationMs: number;
  lastDecoratedRowCount: number;
  cachedScheduleCount: number;
  cachedTotalRuns: number;
  lastFetchIso: string | null;
}

export interface ScheduleRunsDomSelfTestResult {
  ok: boolean;
  pass1DomWrites: number;
  pass2DomWrites: number;
  pass3DomWrites: number;
  simulatedObserverCallbacks: number;
  infiniteLoopPrevented: boolean;
  durationMs: number;
  summary: string;
}

let cachedSchedulesById = new Map<string, ScheduleRunsSummary>();
let cachedTotals = {
  totalSchedules: 0,
  schedulesWithRuns: 0,
  totalRuns: 0,
  succeededRuns: 0,
  failedRuns: 0,
  runningRuns: 0,
};
let lastFetchMs = 0;
let lastFetchAttemptMs = 0;
let inflightFetch: Promise<void> | null = null;
let activeDrawerCleanup: (() => void) | null = null;
let globalOpenScheduleRunsDrawer:
  | ((scheduleId?: string | null) => Promise<void>)
  | null = null;
let globalReconnectAndRefreshEnhancer: (() => void) | null = null;
let globalCleanupInjectedScheduleNodes: (() => void) | null = null;

let activePrefsSourceBadge: "plugin-settings" | "localStorage" | "default" =
  "default";
const domHealthState = {
  observerConnected: false,
  circuitBreakerTripped: false,
  circuitBreakerReason: null as string | null,
  circuitBreakerTrippedAtIso: null as string | null,
  totalPasses: 0,
  writePasses: 0,
  skippedNoOpPasses: 0,
  totalDomWrites: 0,
  ignoredSelfMutationBatches: 0,
  lastPassDurationMs: 0,
  lastDecoratedRowCount: 0,
  recentWriteTimestampsMs: [] as number[],
};

export function readScheduleRunsPreferences(
  storageOverride?: Pick<Storage, "getItem"> | null,
): ScheduleRunsPreferences {
  const storage =
    storageOverride ??
    (typeof window !== "undefined" ? window.localStorage : null);
  if (!storage) {
    return { enabled: true, sourceBadge: activePrefsSourceBadge };
  }
  try {
    const raw = storage.getItem(SCHEDULE_RUNS_STORAGE_KEY);
    if (!raw) {
      return { enabled: true, sourceBadge: activePrefsSourceBadge };
    }
    const parsed = JSON.parse(raw) as {
      enabled?: boolean;
      sourceBadge?: "plugin-settings" | "localStorage";
    };
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
      sourceBadge: parsed.sourceBadge ?? "localStorage",
    };
  } catch {
    return { enabled: true, sourceBadge: activePrefsSourceBadge };
  }
}

export function syncScheduleRunsPreferences(
  enabled: boolean,
  sourceBadge: "plugin-settings" | "localStorage" = "plugin-settings",
  storageOverride?: Pick<Storage, "setItem" | "getItem"> | null,
): void {
  activePrefsSourceBadge = sourceBadge;
  const storage =
    storageOverride ??
    (typeof window !== "undefined" ? window.localStorage : null);
  if (storage) {
    try {
      storage.setItem(
        SCHEDULE_RUNS_STORAGE_KEY,
        JSON.stringify({ enabled, sourceBadge }),
      );
    } catch {
      // Ignore storage quota errors
    }
  }
  if (!enabled) {
    globalCleanupInjectedScheduleNodes?.();
  } else {
    globalReconnectAndRefreshEnhancer?.();
  }
}

export function getScheduleRunsDomHealthSnapshot(): ScheduleRunsDomHealthSnapshot {
  const prefs = readScheduleRunsPreferences();
  return {
    enabled: prefs.enabled,
    sourceBadge: prefs.sourceBadge,
    observerConnected: domHealthState.observerConnected,
    circuitBreakerTripped: domHealthState.circuitBreakerTripped,
    circuitBreakerReason: domHealthState.circuitBreakerReason,
    circuitBreakerTrippedAtIso: domHealthState.circuitBreakerTrippedAtIso,
    totalPasses: domHealthState.totalPasses,
    writePasses: domHealthState.writePasses,
    skippedNoOpPasses: domHealthState.skippedNoOpPasses,
    totalDomWrites: domHealthState.totalDomWrites,
    ignoredSelfMutationBatches: domHealthState.ignoredSelfMutationBatches,
    lastPassDurationMs: domHealthState.lastPassDurationMs,
    lastDecoratedRowCount: domHealthState.lastDecoratedRowCount,
    cachedScheduleCount: cachedSchedulesById.size,
    cachedTotalRuns: cachedTotals.totalRuns,
    lastFetchIso: lastFetchMs > 0 ? new Date(lastFetchMs).toISOString() : null,
  };
}

export function resetScheduleRunsDomCircuitBreaker(): ScheduleRunsDomHealthSnapshot {
  domHealthState.circuitBreakerTripped = false;
  domHealthState.circuitBreakerReason = null;
  domHealthState.circuitBreakerTrippedAtIso = null;
  domHealthState.recentWriteTimestampsMs = [];
  globalReconnectAndRefreshEnhancer?.();
  return getScheduleRunsDomHealthSnapshot();
}

export function setTextContentIfChanged(
  el: { textContent: string | null },
  nextText: string,
): boolean {
  if (el.textContent === nextText) {
    return false;
  }
  el.textContent = nextText;
  return true;
}

function isInjectedScheduleRunsNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const current = node as {
    id?: string;
    parentNode?: unknown;
    parentElement?: unknown;
    getAttribute?: (name: string) => string | null;
  };
  let cursor: typeof current | null = current;
  let depth = 0;
  while (cursor && depth < 10) {
    if (
      cursor.id === "paseo-finder-all-runs-toolbar" ||
      cursor.id === "paseo-finder-all-runs-summary" ||
      cursor.id === "paseo-finder-schedule-runs-drawer"
    ) {
      return true;
    }
    if (typeof cursor.getAttribute === "function") {
      if (cursor.getAttribute("data-finder-runs-injected") === "true") {
        return true;
      }
      const tid = cursor.getAttribute("data-testid") ?? "";
      if (
        tid === "schedules-all-runs-btn" ||
        tid === "schedule-runs-drawer" ||
        tid.startsWith("schedule-runs-pill-") ||
        tid.startsWith("schedule-menu-runs-")
      ) {
        return true;
      }
    }
    cursor = (cursor.parentElement ?? cursor.parentNode ?? null) as
      | typeof current
      | null;
    depth += 1;
  }
  return false;
}

export function isSelfInjectedMutationBatch(
  records: ArrayLike<{
    target?: unknown;
    addedNodes?: ArrayLike<unknown>;
    removedNodes?: ArrayLike<unknown>;
  }>,
): boolean {
  if (!records || records.length === 0) return true;
  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i];
    if (!rec) continue;
    if (isInjectedScheduleRunsNode(rec.target)) {
      continue;
    }
    const addedLen = rec.addedNodes?.length ?? 0;
    const removedLen = rec.removedNodes?.length ?? 0;
    if (addedLen === 0 && removedLen === 0) {
      return false;
    }
    for (let a = 0; a < addedLen; a += 1) {
      if (!isInjectedScheduleRunsNode(rec.addedNodes?.[a])) {
        return false;
      }
    }
    for (let r = 0; r < removedLen; r += 1) {
      if (!isInjectedScheduleRunsNode(rec.removedNodes?.[r])) {
        return false;
      }
    }
  }
  return true;
}

export interface MinimalScheduleDomElement {
  id?: string;
  type?: string;
  title?: string;
  textContent: string | null;
  style: Record<string, string>;
  firstChild?: MinimalScheduleDomElement | null;
  parentElement?: MinimalScheduleDomElement | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  querySelector<T = MinimalScheduleDomElement>(selector: string): T | null;
  appendChild(child: MinimalScheduleDomElement): void;
  insertBefore(
    newNode: MinimalScheduleDomElement,
    refNode: MinimalScheduleDomElement | null,
  ): void;
  remove?(): void;
  addEventListener(
    type: string,
    listener: (ev: {
      altKey?: boolean;
      preventDefault(): void;
      stopPropagation(): void;
    }) => void,
    useCapture?: boolean,
  ): void;
}

export interface MinimalScheduleDomDocument {
  createElement(tag: string): MinimalScheduleDomElement;
  getElementById(id: string): MinimalScheduleDomElement | null;
  querySelector<T = MinimalScheduleDomElement>(selector: string): T | null;
  querySelectorAll<T = MinimalScheduleDomElement>(
    selector: string,
  ): ArrayLike<T>;
}

export interface DecorateSchedulesDomOptions {
  schedulesById: ReadonlyMap<
    string,
    Pick<ScheduleRunsSummary, "totalRuns" | "lastRunStatus">
  >;
  totals: {
    totalSchedules: number;
    schedulesWithRuns: number;
    totalRuns: number;
  };
  isZh: boolean;
  theme?: PaseoThemeTokens;
  onOpenDrawer: (scheduleId: string | null) => void;
}

export function decorateSchedulesDomOnDocument(
  doc: MinimalScheduleDomDocument,
  options: DecorateSchedulesDomOptions,
): { rowCount: number; domWrites: number } {
  const copy = options.isZh ? COPY_ZH : COPY_EN;
  const theme = options.theme;
  const themeKey = theme?.name ?? "default";
  const rows = doc.querySelectorAll<MinimalScheduleDomElement>(
    '[data-testid^="schedule-row-"]',
  );
  if (!rows || rows.length === 0) {
    return { rowCount: 0, domWrites: 0 };
  }

  let domWrites = 0;

  // Mount `#paseo-finder-all-runs-toolbar` safely inside `[data-testid="schedules-table"]`
  // (never via `tableEl.parentElement.insertBefore`, which collides with React sibling reconciliation
  // when toggling Active <-> Ended filter tabs).
  const tableEl = doc.querySelector<MinimalScheduleDomElement>(
    '[data-testid="schedules-table"]',
  );
  let toolbar = doc.getElementById("paseo-finder-all-runs-toolbar");
  if (tableEl && !toolbar) {
    toolbar = doc.createElement("div");
    toolbar.id = "paseo-finder-all-runs-toolbar";
    toolbar.setAttribute("data-finder-runs-injected", "true");
    Object.assign(toolbar.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "8px 14px",
      marginBottom: "8px",
      backgroundColor: theme ? theme.surface1 : "rgba(16, 185, 129, 0.07)",
      border: theme
        ? `1px solid ${theme.border}`
        : "1px solid rgba(16, 185, 129, 0.24)",
      borderRadius: "8px",
    });
    const summaryText = doc.createElement("span");
    summaryText.id = "paseo-finder-all-runs-summary";
    summaryText.setAttribute("data-finder-runs-injected", "true");
    Object.assign(summaryText.style, {
      fontSize: "12px",
      color: theme ? theme.foregroundMuted : "#d1d5db",
    });
    toolbar.appendChild(summaryText);

    const allBtn = doc.createElement("button");
    allBtn.type = "button";
    allBtn.setAttribute("data-testid", "schedules-all-runs-btn");
    allBtn.setAttribute("data-finder-runs-injected", "true");
    allBtn.textContent = `${copy.allRunsBtn} (${options.totals.totalRuns}) ⌘⇧H`;
    Object.assign(allBtn.style, {
      background: theme ? theme.primary : "rgba(16, 185, 129, 0.18)",
      border: theme
        ? `1px solid ${theme.primary}`
        : "1px solid rgba(16, 185, 129, 0.45)",
      color: theme ? theme.primaryForeground : "#6ee7b7",
      borderRadius: "6px",
      padding: "4px 10px",
      fontSize: "12px",
      fontWeight: "600",
      cursor: "pointer",
    });
    allBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      options.onOpenDrawer(null);
    });
    toolbar.appendChild(allBtn);
    tableEl.insertBefore(toolbar, tableEl.firstChild ?? null);
    domWrites += 1;
  }

  if (toolbar) {
    const toolbarSig = `${options.isZh ? "zh" : "en"}:${themeKey}:${options.totals.totalSchedules}:${options.totals.schedulesWithRuns}:${options.totals.totalRuns}`;
    if (toolbar.getAttribute("data-finder-toolbar-sig") !== toolbarSig) {
      toolbar.setAttribute("data-finder-toolbar-sig", toolbarSig);
      if (theme) {
        toolbar.style.backgroundColor = theme.surface1;
        toolbar.style.border = `1px solid ${theme.border}`;
      }
      const summaryEl = doc.getElementById("paseo-finder-all-runs-summary");
      if (summaryEl) {
        if (theme) {
          summaryEl.style.color = theme.foregroundMuted;
        }
        const nextSummary = options.isZh
          ? `共 ${options.totals.totalSchedules} 个定时任务 · ${options.totals.schedulesWithRuns} 个有运行记录（累计 ${options.totals.totalRuns} 次运行，点击行内「运行 (N)」查看详情与对话）`
          : `${options.totals.totalSchedules} schedules · ${options.totals.schedulesWithRuns} with recorded runs (${options.totals.totalRuns} total runs — click any 'Runs (N)' pill to inspect or open conversation)`;
        if (setTextContentIfChanged(summaryEl, nextSummary)) {
          domWrites += 1;
        }
      }
      const allBtnEl = doc.querySelector<MinimalScheduleDomElement>(
        '[data-testid="schedules-all-runs-btn"]',
      );
      if (allBtnEl) {
        if (theme) {
          allBtnEl.style.background = theme.primary;
          allBtnEl.style.border = `1px solid ${theme.primary}`;
          allBtnEl.style.color = theme.primaryForeground;
        }
        const nextBtnText = `${copy.allRunsBtn} (${options.totals.totalRuns}) ⌘⇧H`;
        if (setTextContentIfChanged(allBtnEl, nextBtnText)) {
          domWrites += 1;
        }
      }
    }
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const testId = row.getAttribute("data-testid") ?? "";
    const scheduleId = testId.replace(/^schedule-row-/, "").trim();
    if (!scheduleId) continue;

    if (!row.hasAttribute("data-finder-runs-bound")) {
      row.setAttribute("data-finder-runs-bound", "1");
      row.addEventListener(
        "click",
        (e) => {
          if (e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            options.onOpenDrawer(scheduleId);
          }
        },
        true,
      );
      domWrites += 1;
    }

    const summary = options.schedulesById.get(scheduleId);
    const runCount = summary?.totalRuns ?? 0;
    const lastStatus = summary?.lastRunStatus ?? "none";

    let pill = row.querySelector<MinimalScheduleDomElement>(
      `[data-testid="schedule-runs-pill-${scheduleId}"]`,
    );
    if (!pill) {
      pill = doc.createElement("button");
      pill.type = "button";
      pill.setAttribute("data-testid", `schedule-runs-pill-${scheduleId}`);
      pill.setAttribute("data-finder-runs-injected", "true");
      pill.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        options.onOpenDrawer(scheduleId);
      });

      const kebab = row.querySelector<MinimalScheduleDomElement>(
        `[data-testid="schedule-kebab-${scheduleId}"]`,
      );
      if (kebab && kebab.parentElement) {
        kebab.parentElement.insertBefore(pill, kebab);
      } else {
        row.appendChild(pill);
      }
      domWrites += 1;
    }

    const pillSig = `${options.isZh ? "zh" : "en"}:${themeKey}:${runCount}:${lastStatus}`;
    if (pill.getAttribute("data-finder-pill-sig") !== pillSig) {
      pill.setAttribute("data-finder-pill-sig", pillSig);
      const hasRuns = runCount > 0;
      const isFailed = lastStatus === "failed";
      const icon = isFailed ? "✕ " : hasRuns ? "✓ " : "";
      const nextPillText = `${icon}${copy.runsPillPrefix} (${runCount})`;
      if (setTextContentIfChanged(pill, nextPillText)) {
        domWrites += 1;
      }
      pill.title = hasRuns
        ? `Click to inspect ${runCount} run(s) and open conversation`
        : "Click to inspect schedule & run history";
      Object.assign(pill.style, {
        marginRight: "8px",
        padding: "3px 9px",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: hasRuns ? "600" : "500",
        cursor: "pointer",
        flexShrink: "0",
        border: theme
          ? `1px solid ${isFailed ? theme.statusDanger : theme.border}`
          : isFailed
            ? "1px solid rgba(239, 68, 68, 0.5)"
            : hasRuns
              ? "1px solid rgba(16, 185, 129, 0.45)"
              : "1px solid rgba(156, 163, 175, 0.22)",
        backgroundColor: theme
          ? theme.surface2
          : isFailed
            ? "rgba(239, 68, 68, 0.14)"
            : hasRuns
              ? "rgba(16, 185, 129, 0.14)"
              : "rgba(31, 36, 34, 0.7)",
        color: theme
          ? isFailed
            ? theme.statusDanger
            : hasRuns
              ? theme.foreground
              : theme.foregroundMuted
          : isFailed
            ? "#fca5a5"
            : hasRuns
              ? "#6ee7b7"
              : "#9ca3af",
      });
    }
  }

  // Inject "View runs (N)" into any open schedule kebab menu (`schedule-menu-edit-<id>`)
  const editMenuItem = doc.querySelector<MinimalScheduleDomElement>(
    '[data-testid^="schedule-menu-edit-"]',
  );
  if (editMenuItem && editMenuItem.parentElement) {
    const editTestId = editMenuItem.getAttribute("data-testid") ?? "";
    const scheduleId = editTestId.replace(/^schedule-menu-edit-/, "").trim();
    const menuContainer = editMenuItem.parentElement;
    if (scheduleId) {
      let runsItem = menuContainer.querySelector<MinimalScheduleDomElement>(
        `[data-testid="schedule-menu-runs-${scheduleId}"]`,
      );
      const summary = options.schedulesById.get(scheduleId);
      const count = summary?.totalRuns ?? 0;
      const expectedText = `${copy.viewRunsMenu} (${count})`;
      if (!runsItem) {
        runsItem = doc.createElement("div");
        runsItem.setAttribute("data-testid", `schedule-menu-runs-${scheduleId}`);
        runsItem.setAttribute("data-finder-runs-injected", "true");
        runsItem.textContent = expectedText;
        Object.assign(runsItem.style, {
          padding: "8px 12px",
          fontSize: "13px",
          color: theme ? theme.foreground : "#6ee7b7",
          fontWeight: "500",
          cursor: "pointer",
          borderBottom: `1px solid ${theme ? theme.borderAccent : "rgba(255,255,255,0.06)"}`,
        });
        runsItem.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          options.onOpenDrawer(scheduleId);
        });
        menuContainer.insertBefore(runsItem, editMenuItem);
        domWrites += 1;
      } else if (setTextContentIfChanged(runsItem, expectedText)) {
        domWrites += 1;
      }
    }
  }

  return { rowCount: rows.length, domWrites };
}

export function runScheduleRunsDomIdempotencySelfTest(): ScheduleRunsDomSelfTestResult {
  const started = Date.now();
  let observerTriggerCount = 0;

  // Build a W3C-accurate synthetic DOM where setting `.textContent = x` ALWAYS triggers a
  // `childList` mutation (the exact browser behavior that previously caused an infinite loop).
  interface SimNode extends MinimalScheduleDomElement {
    childrenList: SimNode[];
  }
  const pendingMutations: Array<{
    target: SimNode;
    addedNodes: SimNode[];
    removedNodes: SimNode[];
  }> = [];

  const makeNode = (
    tag: string,
    attrs: Record<string, string> = {},
  ): SimNode => {
    const attrMap = new Map<string, string>(Object.entries(attrs));
    let rawText: string | null = "";
    const node: SimNode = {
      id: attrs.id,
      style: {},
      childrenList: [],
      parentElement: null,
      get firstChild() {
        return node.childrenList[0] ?? null;
      },
      get textContent() {
        return rawText;
      },
      set textContent(val: string | null) {
        rawText = val;
        // W3C spec: assigning textContent replaces child Text nodes -> emits childList mutation!
        const syntheticTextChild = {
          getAttribute: () => null,
          parentElement: node,
        } as unknown as SimNode;
        pendingMutations.push({
          target: node,
          addedNodes: [syntheticTextChild],
          removedNodes: [],
        });
      },
      getAttribute: (n) => (n === "id" ? node.id ?? null : attrMap.get(n) ?? null),
      setAttribute: (n, v) => {
        if (n === "id") node.id = v;
        attrMap.set(n, v);
      },
      hasAttribute: (n) => (n === "id" ? Boolean(node.id) : attrMap.has(n)),
      appendChild: (c) => {
        const simChild = c as SimNode;
        simChild.parentElement = node;
        node.childrenList.push(simChild);
        pendingMutations.push({
          target: node,
          addedNodes: [simChild],
          removedNodes: [],
        });
      },
      insertBefore: (newNode, refNode) => {
        const simNew = newNode as SimNode;
        simNew.parentElement = node;
        const idx = refNode ? node.childrenList.indexOf(refNode as SimNode) : -1;
        if (idx >= 0) {
          node.childrenList.splice(idx, 0, simNew);
        } else {
          node.childrenList.push(simNew);
        }
        pendingMutations.push({
          target: node,
          addedNodes: [simNew],
          removedNodes: [],
        });
      },
      addEventListener: () => {},
      querySelector: <T = MinimalScheduleDomElement>(sel: string): T | null => {
        const all = queryAll(node, sel);
        return (all[0] as unknown as T) ?? null;
      },
    };
    return node;
  };

  const matchesSelector = (el: SimNode, selector: string): boolean => {
    const s = selector.trim();
    const exact = s.match(/^\[data-testid="([^"]+)"\]$/);
    if (exact) return el.getAttribute("data-testid") === exact[1];
    const prefix = s.match(/^\[data-testid\^="([^"]+)"\]$/);
    if (prefix) return (el.getAttribute("data-testid") ?? "").startsWith(prefix[1]);
    return false;
  };

  const queryAll = (root: SimNode, selector: string): SimNode[] => {
    const parts = selector.split(",");
    const out: SimNode[] = [];
    const visit = (cur: SimNode) => {
      for (const p of parts) {
        if (matchesSelector(cur, p)) {
          out.push(cur);
          break;
        }
      }
      for (const ch of cur.childrenList) visit(ch);
    };
    visit(root);
    return out;
  };

  const findById = (root: SimNode, id: string): SimNode | null => {
    if (root.id === id) return root;
    for (const ch of root.childrenList) {
      const hit = findById(ch, id);
      if (hit) return hit;
    }
    return null;
  };

  const body = makeNode("body");
  const table = makeNode("div", { "data-testid": "schedules-table" });
  const card = makeNode("div");
  for (const id of ["sched_alpha", "sched_beta", "sched_gamma"]) {
    const row = makeNode("div", { "data-testid": `schedule-row-${id}` });
    const actions = makeNode("div");
    const kebab = makeNode("button", { "data-testid": `schedule-kebab-${id}` });
    actions.appendChild(kebab);
    row.appendChild(actions);
    card.appendChild(row);
  }
  table.appendChild(card);
  body.appendChild(table);
  pendingMutations.length = 0;

  const simDoc: MinimalScheduleDomDocument = {
    createElement: (tag) => makeNode(tag),
    getElementById: (id) => findById(body, id),
    querySelector: (sel) => (queryAll(body, sel)[0] as never) ?? null,
    querySelectorAll: (sel) => queryAll(body, sel) as never,
  };

  const schedulesMap = new Map<string, ScheduleRunsSummary>([
    [
      "sched_alpha",
      {
        id: "sched_alpha",
        name: "Alpha Cadence",
        status: "active",
        isStandbyTwin: false,
        standbySlug: null,
        cronExpression: "0 9 * * *",
        timezone: "Asia/Shanghai",
        cwd: "/tmp",
        provider: "claude",
        model: "sonnet",
        modeId: "full-access",
        archiveOnFinish: true,
        prompt: "run alpha",
        promptPreview: "run alpha",
        totalRuns: 5,
        succeededRuns: 5,
        failedRuns: 0,
        runningRuns: 0,
        lastRunAt: new Date().toISOString(),
        lastRunStatus: "succeeded",
        nextRunAt: null,
        runs: [],
      },
    ],
  ]);

  const opts: DecorateSchedulesDomOptions = {
    schedulesById: schedulesMap,
    totals: { totalSchedules: 3, schedulesWithRuns: 1, totalRuns: 5 },
    isZh: false,
    onOpenDrawer: () => {},
  };

  const pass1 = decorateSchedulesDomOnDocument(simDoc, opts);
  const firstBatchSelfOnly = isSelfInjectedMutationBatch(pendingMutations);
  // Drain via simulated takeRecords()
  pendingMutations.length = 0;

  // Simulate observer loop up to 20 iterations if non-self mutations keep appearing
  let pass2Writes = -1;
  let pass3Writes = -1;
  for (let step = 0; step < 20; step += 1) {
    const res = decorateSchedulesDomOnDocument(simDoc, opts);
    if (step === 0) pass2Writes = res.domWrites;
    if (step === 1) pass3Writes = res.domWrites;
    if (pendingMutations.length > 0 && !isSelfInjectedMutationBatch(pendingMutations)) {
      observerTriggerCount += 1;
      pendingMutations.length = 0;
    } else {
      pendingMutations.length = 0;
      if (step >= 1) break;
    }
  }

  const ok =
    pass1.rowCount === 3 &&
    pass1.domWrites > 0 &&
    pass2Writes === 0 &&
    pass3Writes === 0 &&
    observerTriggerCount === 0 &&
    Boolean(firstBatchSelfOnly || pass2Writes === 0);

  const durationMs = Date.now() - started;
  return {
    ok,
    pass1DomWrites: pass1.domWrites,
    pass2DomWrites: pass2Writes,
    pass3DomWrites: pass3Writes,
    simulatedObserverCallbacks: observerTriggerCount,
    infiniteLoopPrevented: observerTriggerCount === 0 && pass2Writes === 0,
    durationMs,
    summary: ok
      ? `PASS (${durationMs}ms): pass1=${pass1.domWrites} writes -> pass2=${pass2Writes} writes -> pass3=${pass3Writes} writes · 0 self-loop callbacks`
      : `FAIL: pass1=${pass1.domWrites}, pass2=${pass2Writes}, pass3=${pass3Writes}, observerLoops=${observerTriggerCount}`,
  };
}

export function triggerScheduleRunsDrawer(scheduleId?: string | null): void {
  if (globalOpenScheduleRunsDrawer) {
    void globalOpenScheduleRunsDrawer(scheduleId);
  }
}

export function navigateToPaseoWorkspace(
  workspaceId: string,
  agentId?: string | null,
): void {
  if (typeof window === "undefined") return;
  const targetPath = `/workspace/${encodeURIComponent(workspaceId)}`;
  try {
    window.history.pushState({}, "", targetPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    window.location.pathname = targetPath;
  }

  // Also attempt to click the matching sidebar item or agent tab once mounted
  setTimeout(() => {
    const wsItem = document.querySelector<HTMLElement>(
      `[data-testid="workspace-item-${workspaceId}"]`,
    );
    if (wsItem && window.location.pathname !== targetPath) {
      wsItem.click();
    }
    if (agentId) {
      setTimeout(() => {
        const tabEl = document.querySelector<HTMLElement>(
          `[data-testid="workspace-tab-agent_${agentId}"]`,
        );
        if (tabEl) tabEl.click();
      }, 260);
    }
  }, 120);
}

async function refreshScheduleCache(
  client: ScheduleRunsWebClient,
  force = false,
): Promise<void> {
  const now = Date.now();
  if (!force) {
    if (now - lastFetchMs < 4000 && cachedSchedulesById.size > 0) {
      return;
    }
    if (now - lastFetchAttemptMs < FETCH_RETRY_COOLDOWN_MS) {
      return;
    }
  }
  if (inflightFetch) {
    return inflightFetch;
  }
  lastFetchAttemptMs = now;
  inflightFetch = (async () => {
    try {
      const res = await client.call(inspectScheduleRunsRpc, {
        onlyWithRuns: false,
        includeWorkspaceNames: false,
        maxRunsPerSchedule: 30,
      });
      if (res.ok) {
        const nextMap = new Map<string, ScheduleRunsSummary>();
        for (const item of res.schedules) {
          nextMap.set(item.id, item);
        }
        cachedSchedulesById = nextMap;
        cachedTotals = {
          totalSchedules: res.totalSchedules,
          schedulesWithRuns: res.schedulesWithRuns,
          totalRuns: res.totalRuns,
          succeededRuns: res.succeededRuns,
          failedRuns: res.failedRuns,
          runningRuns: res.runningRuns,
        };
        lastFetchMs = Date.now();
      }
    } catch {
      // Ignore transient RPC error; cooldown guards against retry storm
    } finally {
      inflightFetch = null;
    }
  })();
  return inflightFetch;
}

export function installDesktopScheduleRunsEnhancer(
  client: ScheduleRunsWebClient,
  showToast?: (msg: string) => void,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const openDrawer = async (initialScheduleId?: string | null) => {
    if (activeDrawerCleanup) {
      activeDrawerCleanup();
      activeDrawerCleanup = null;
    }

    const copy = getCopy();
    const theme = syncPaseoThemeCssVariables(document, window);
    let currentScheduleId: string | null = initialScheduleId?.trim() || null;
    let onlyWithRuns = !currentScheduleId;
    let searchQuery = "";
    let promptExpanded = false;
    const expandedRunTimelines = new Map<
      string,
      Array<{ role: string; text: string; timestamp: string | null }>
    >();

    const backdrop = document.createElement("div");
    backdrop.id = "paseo-finder-schedule-runs-drawer";
    backdrop.setAttribute("data-testid", "schedule-runs-drawer");
    backdrop.setAttribute("data-finder-runs-injected", "true");
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      zIndex: "99998",
      backgroundColor: theme.backdrop,
      backdropFilter: "blur(4px)",
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "stretch",
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif",
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      width: "min(760px, 92vw)",
      height: "100%",
      backgroundColor: theme.surface0,
      borderLeft: `1px solid ${theme.border}`,
      display: "flex",
      flexDirection: "column",
      color: theme.foreground,
      boxShadow: theme.shadowLg,
      overflow: "hidden",
    });
    backdrop.appendChild(panel);

    const headerBar = document.createElement("div");
    Object.assign(headerBar.style, {
      padding: "14px 20px",
      borderBottom: `1px solid ${theme.borderAccent}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      backgroundColor: theme.surface1,
    });
    panel.appendChild(headerBar);

    const bodyScroll = document.createElement("div");
    Object.assign(bodyScroll.style, {
      flex: "1",
      overflowY: "auto",
      padding: "18px 20px 28px",
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      backgroundColor: theme.surface0,
    });
    panel.appendChild(bodyScroll);

    const closeDrawer = () => {
      window.removeEventListener("keydown", onKeyDown, true);
      backdrop.remove();
      if (activeDrawerCleanup === closeDrawer) {
        activeDrawerCleanup = null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeDrawer();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeDrawer();
    });
    activeDrawerCleanup = closeDrawer;
    document.body.appendChild(backdrop);

    const renderSingleScheduleView = async (scheduleId: string) => {
      headerBar.innerHTML = "";
      bodyScroll.innerHTML = "";

      const leftNav = document.createElement("div");
      Object.assign(leftNav.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: "0",
        flex: "1",
      });

      const backLink = document.createElement("button");
      backLink.type = "button";
      backLink.textContent = copy.drawerBreadcrumbRoot;
      Object.assign(backLink.style, {
        background: "transparent",
        border: "none",
        color: theme.foregroundMuted,
        fontSize: "13px",
        cursor: "pointer",
        padding: "4px 6px",
        borderRadius: "6px",
      });
      backLink.addEventListener("click", () => {
        currentScheduleId = null;
        void renderOverview();
      });
      leftNav.appendChild(backLink);

      const sep = document.createElement("span");
      sep.textContent = "›";
      sep.style.color = theme.foregroundExtraMuted;
      leftNav.appendChild(sep);

      const titleSpan = document.createElement("span");
      titleSpan.textContent = scheduleId;
      Object.assign(titleSpan.style, {
        fontSize: "15px",
        fontWeight: "600",
        color: theme.foreground,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      leftNav.appendChild(titleSpan);
      headerBar.appendChild(leftNav);

      const rightControls = document.createElement("div");
      Object.assign(rightControls.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
      });

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "✕";
      closeBtn.title = copy.closeBtn;
      Object.assign(closeBtn.style, {
        background: theme.surface2,
        border: `1px solid ${theme.border}`,
        color: theme.foregroundMuted,
        borderRadius: "6px",
        padding: "5px 10px",
        fontSize: "12px",
        cursor: "pointer",
      });
      closeBtn.addEventListener("click", closeDrawer);
      rightControls.appendChild(closeBtn);
      headerBar.appendChild(rightControls);

      const res = await client.call(inspectScheduleRunsRpc, {
        scheduleId,
        onlyWithRuns: false,
        includeWorkspaceNames: true,
        maxRunsPerSchedule: 100,
      });
      const sched = res.schedules[0] ?? cachedSchedulesById.get(scheduleId);
      if (!sched) {
        const empty = document.createElement("div");
        empty.textContent = `Schedule ${scheduleId} not found.`;
        empty.style.color = theme.foregroundMuted;
        bodyScroll.appendChild(empty);
        return;
      }
      cachedSchedulesById.set(sched.id, sched);
      titleSpan.textContent = sched.name;

      // Action buttons in header: Keep Open toggle + Run Now
      const archiveBtn = document.createElement("button");
      archiveBtn.type = "button";
      archiveBtn.setAttribute("data-testid", `schedule-runs-archive-toggle-${sched.id}`);
      const updateArchiveBtnLabel = (archiveOnFinish: boolean) => {
        archiveBtn.textContent = archiveOnFinish
          ? copy.keepOpenToggleOn
          : copy.keepOpenToggleOff;
        archiveBtn.style.borderColor = archiveOnFinish ? theme.border : theme.statusSuccess;
        archiveBtn.style.color = archiveOnFinish ? theme.foregroundMuted : theme.statusSuccess;
      };
      Object.assign(archiveBtn.style, {
        background: theme.surface2,
        border: `1px solid ${theme.border}`,
        borderRadius: "6px",
        padding: "5px 10px",
        fontSize: "11px",
        cursor: "pointer",
      });
      updateArchiveBtnLabel(sched.archiveOnFinish);
      archiveBtn.addEventListener("click", async () => {
        const nextVal = !sched.archiveOnFinish;
        const toggled = await client.call(openScheduleRunSessionRpc, {
          action: "toggle-archive-on-finish",
          scheduleId: sched.id,
          archiveOnFinish: nextVal,
          dryRun: false,
        });
        if (toggled.ok && typeof toggled.archiveOnFinish === "boolean") {
          sched.archiveOnFinish = toggled.archiveOnFinish;
          updateArchiveBtnLabel(sched.archiveOnFinish);
          showToast?.(toggled.message);
          void renderSingleScheduleView(sched.id);
        }
      });
      rightControls.insertBefore(archiveBtn, closeBtn);

      const runNowBtn = document.createElement("button");
      runNowBtn.type = "button";
      runNowBtn.setAttribute("data-testid", `schedule-runs-run-now-${sched.id}`);
      runNowBtn.textContent = copy.runNowBtn;
      Object.assign(runNowBtn.style, {
        background: theme.primary,
        border: `1px solid ${theme.primary}`,
        color: theme.primaryForeground,
        borderRadius: "6px",
        padding: "5px 11px",
        fontSize: "12px",
        fontWeight: "600",
        cursor: "pointer",
      });
      runNowBtn.addEventListener("click", async () => {
        runNowBtn.disabled = true;
        runNowBtn.style.opacity = "0.6";
        try {
          const triggered = await client.call(openScheduleRunSessionRpc, {
            action: "run-now",
            scheduleId: sched.id,
            dryRun: false,
          });
          showToast?.(triggered.message || copy.runningNowToast);
          setTimeout(() => {
            void refreshScheduleCache(client, true).then(() =>
              renderSingleScheduleView(sched.id),
            );
          }, 1500);
        } finally {
          runNowBtn.disabled = false;
          runNowBtn.style.opacity = "1";
        }
      });
      rightControls.insertBefore(runNowBtn, closeBtn);

      // Settings Card (Paseo native card style)
      const settingsCard = document.createElement("div");
      Object.assign(settingsCard.style, {
        background: theme.surface1,
        border: `1px solid ${theme.border}`,
        borderRadius: "8px",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      });

      const settingsHeader = document.createElement("div");
      Object.assign(settingsHeader.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      });
      const settingsTitle = document.createElement("span");
      settingsTitle.textContent = copy.settingsHeading;
      Object.assign(settingsTitle.style, {
        fontSize: "11px",
        fontWeight: "600",
        color: theme.foregroundMuted,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
      });
      settingsHeader.appendChild(settingsTitle);

      const statusBadge = document.createElement("span");
      statusBadge.textContent =
        sched.status === "active"
          ? copy.statusActive
          : sched.isStandbyTwin
            ? `${copy.statusPaused} · ${copy.standbyBadge}`
            : copy.statusPaused;
      Object.assign(statusBadge.style, {
        fontSize: "11px",
        fontWeight: "600",
        padding: "2px 8px",
        borderRadius: "999px",
        backgroundColor: theme.surface2,
        border: `1px solid ${theme.border}`,
        color: sched.status === "active" ? theme.statusSuccess : theme.foregroundMuted,
      });
      settingsHeader.appendChild(statusBadge);
      settingsCard.appendChild(settingsHeader);

      const addSettingRow = (label: string, val: string) => {
        const row = document.createElement("div");
        Object.assign(row.style, {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "16px",
          fontSize: "13px",
        });
        const l = document.createElement("span");
        l.textContent = label;
        l.style.color = theme.foregroundMuted;
        l.style.flexShrink = "0";
        const v = document.createElement("span");
        v.textContent = val;
        Object.assign(v.style, {
          color: theme.foreground,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "12px",
          textAlign: "right",
          wordBreak: "break-all",
        });
        row.appendChild(l);
        row.appendChild(v);
        settingsCard.appendChild(row);
      };

      addSettingRow(
        copy.scheduleLabel,
        `${sched.cronExpression} (${sched.timezone})`,
      );
      addSettingRow(copy.workspaceLabel, sched.cwd || "-");
      addSettingRow(copy.modelLabel, `${sched.provider}/${sched.model}`);
      addSettingRow(
        copy.archivePolicyLabel,
        sched.archiveOnFinish ? copy.archivePolicyTrue : copy.archivePolicyFalse,
      );
      bodyScroll.appendChild(settingsCard);

      // Instructions Card
      const instCard = document.createElement("div");
      Object.assign(instCard.style, {
        background: theme.surface1,
        border: `1px solid ${theme.border}`,
        borderRadius: "8px",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      });
      const instHeader = document.createElement("div");
      Object.assign(instHeader.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      });
      const instTitle = document.createElement("span");
      instTitle.textContent = copy.instructionsHeading;
      Object.assign(instTitle.style, {
        fontSize: "11px",
        fontWeight: "600",
        color: theme.foregroundMuted,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
      });
      instHeader.appendChild(instTitle);

      const togglePromptBtn = document.createElement("button");
      togglePromptBtn.type = "button";
      togglePromptBtn.textContent = promptExpanded
        ? copy.collapsePrompt
        : copy.showAllPrompt;
      Object.assign(togglePromptBtn.style, {
        background: "transparent",
        border: "none",
        color: theme.foreground,
        fontSize: "12px",
        fontWeight: "500",
        cursor: "pointer",
      });
      instHeader.appendChild(togglePromptBtn);
      instCard.appendChild(instHeader);

      const promptBox = document.createElement("pre");
      promptBox.textContent = promptExpanded ? sched.prompt : sched.promptPreview;
      Object.assign(promptBox.style, {
        margin: "0",
        fontSize: "12px",
        lineHeight: "1.5",
        color: theme.foregroundMuted,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxHeight: promptExpanded ? "320px" : "76px",
        overflowY: "auto",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      });
      togglePromptBtn.addEventListener("click", () => {
        promptExpanded = !promptExpanded;
        promptBox.textContent = promptExpanded
          ? sched.prompt
          : sched.promptPreview;
        promptBox.style.maxHeight = promptExpanded ? "320px" : "76px";
        togglePromptBtn.textContent = promptExpanded
          ? copy.collapsePrompt
          : copy.showAllPrompt;
      });
      instCard.appendChild(promptBox);
      bodyScroll.appendChild(instCard);

      // Runs Section
      const runsTitle = document.createElement("div");
      runsTitle.textContent = `${copy.runsHeading} (${sched.totalRuns})`;
      Object.assign(runsTitle.style, {
        fontSize: "13px",
        fontWeight: "600",
        color: theme.foreground,
        marginTop: "4px",
      });
      bodyScroll.appendChild(runsTitle);

      if (sched.runs.length === 0) {
        const emptyRuns = document.createElement("div");
        emptyRuns.textContent = copy.noRunsYet;
        Object.assign(emptyRuns.style, {
          padding: "24px 16px",
          background: theme.surface1,
          border: `1px dashed ${theme.border}`,
          borderRadius: "8px",
          color: theme.foregroundMuted,
          fontSize: "13px",
          textAlign: "center",
        });
        bodyScroll.appendChild(emptyRuns);
        return;
      }

      const runsList = document.createElement("div");
      Object.assign(runsList.style, {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      });

      for (const run of sched.runs) {
        runsList.appendChild(
          buildRunCardElement(
            run,
            copy,
            client,
            theme,
            expandedRunTimelines,
            showToast,
            closeDrawer,
            () => void renderSingleScheduleView(sched.id),
          ),
        );
      }
      bodyScroll.appendChild(runsList);
    };

    const renderOverview = async () => {
      headerBar.innerHTML = "";
      bodyScroll.innerHTML = "";

      const titleCol = document.createElement("div");
      Object.assign(titleCol.style, {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
      });
      const hTitle = document.createElement("div");
      hTitle.textContent = copy.drawerTitleAllRuns;
      Object.assign(hTitle.style, {
        fontSize: "15px",
        fontWeight: "600",
        color: theme.foreground,
      });
      const hSub = document.createElement("div");
      hSub.textContent = copy.drawerSubtitleAllRuns;
      Object.assign(hSub.style, {
        fontSize: "12px",
        color: theme.foregroundMuted,
      });
      titleCol.appendChild(hTitle);
      titleCol.appendChild(hSub);
      headerBar.appendChild(titleCol);

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "✕";
      closeBtn.title = copy.closeBtn;
      Object.assign(closeBtn.style, {
        background: theme.surface2,
        border: `1px solid ${theme.border}`,
        color: theme.foregroundMuted,
        borderRadius: "6px",
        padding: "5px 10px",
        fontSize: "12px",
        cursor: "pointer",
      });
      closeBtn.addEventListener("click", closeDrawer);
      headerBar.appendChild(closeBtn);

      await refreshScheduleCache(client, true);

      // Filter bar
      const filterRow = document.createElement("div");
      Object.assign(filterRow.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
      });

      const searchInput = document.createElement("input");
      searchInput.type = "search";
      searchInput.placeholder = copy.searchPlaceholder;
      searchInput.value = searchQuery;
      Object.assign(searchInput.style, {
        flex: "1",
        minWidth: "220px",
        background: theme.surface1,
        border: `1px solid ${theme.border}`,
        borderRadius: "6px",
        padding: "7px 12px",
        color: theme.foreground,
        fontSize: "13px",
      });
      filterRow.appendChild(searchInput);

      const withRunsBtn = document.createElement("button");
      withRunsBtn.type = "button";
      withRunsBtn.textContent = `${copy.filterOnlyWithRuns} (${cachedTotals.schedulesWithRuns})`;
      Object.assign(withRunsBtn.style, {
        background: onlyWithRuns ? theme.primary : theme.surface1,
        border: `1px solid ${onlyWithRuns ? theme.primary : theme.border}`,
        color: onlyWithRuns ? theme.primaryForeground : theme.foregroundMuted,
        borderRadius: "6px",
        padding: "6px 12px",
        fontSize: "12px",
        fontWeight: onlyWithRuns ? "600" : "500",
        cursor: "pointer",
      });
      withRunsBtn.addEventListener("click", () => {
        onlyWithRuns = true;
        void renderOverview();
      });
      filterRow.appendChild(withRunsBtn);

      const allSchedBtn = document.createElement("button");
      allSchedBtn.type = "button";
      allSchedBtn.textContent = `${copy.filterAllSchedules} (${cachedTotals.totalSchedules})`;
      Object.assign(allSchedBtn.style, {
        background: !onlyWithRuns ? theme.primary : theme.surface1,
        border: `1px solid ${!onlyWithRuns ? theme.primary : theme.border}`,
        color: !onlyWithRuns ? theme.primaryForeground : theme.foregroundMuted,
        borderRadius: "6px",
        padding: "6px 12px",
        fontSize: "12px",
        fontWeight: !onlyWithRuns ? "600" : "500",
        cursor: "pointer",
      });
      allSchedBtn.addEventListener("click", () => {
        onlyWithRuns = false;
        void renderOverview();
      });
      filterRow.appendChild(allSchedBtn);
      bodyScroll.appendChild(filterRow);

      const listContainer = document.createElement("div");
      Object.assign(listContainer.style, {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      });
      bodyScroll.appendChild(listContainer);

      const renderFilteredList = () => {
        listContainer.innerHTML = "";
        const q = searchQuery.trim().toLowerCase();
        const items = Array.from(cachedSchedulesById.values()).filter((s) => {
          if (onlyWithRuns && s.totalRuns === 0) return false;
          if (!q) return true;
          const hay = `${s.id} ${s.name} ${s.provider} ${s.model} ${s.cwd} ${s.runs
            .map((r) => r.outputPreview)
            .join(" ")}`.toLowerCase();
          return hay.includes(q);
        });

        for (const s of items) {
          const card = document.createElement("div");
          card.setAttribute("data-testid", `schedule-runs-overview-item-${s.id}`);
          Object.assign(card.style, {
            background: theme.surface1,
            border: `1px solid ${theme.border}`,
            borderRadius: "8px",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            cursor: "pointer",
          });
          card.addEventListener("click", () => {
            currentScheduleId = s.id;
            void renderSingleScheduleView(s.id);
          });

          const top = document.createElement("div");
          Object.assign(top.style, {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "10px",
          });
          const nameEl = document.createElement("span");
          nameEl.textContent = s.name;
          Object.assign(nameEl.style, {
            fontSize: "13px",
            fontWeight: "600",
            color: theme.foreground,
          });
          top.appendChild(nameEl);

          const countBadge = document.createElement("span");
          countBadge.textContent = `${copy.runsPillPrefix} (${s.totalRuns}) ›`;
          Object.assign(countBadge.style, {
            fontSize: "11px",
            fontWeight: "600",
            padding: "2px 8px",
            borderRadius: "999px",
            backgroundColor: theme.surface2,
            border: `1px solid ${theme.borderAccent}`,
            color: s.totalRuns > 0 ? theme.foreground : theme.foregroundMuted,
          });
          top.appendChild(countBadge);
          card.appendChild(top);

          const meta = document.createElement("div");
          meta.textContent = `${s.cronExpression} · ${s.provider}/${s.model} · ${
            s.lastRunAt ? `Last: ${formatRelativeIso(s.lastRunAt)}` : "Never run"
          }`;
          Object.assign(meta.style, {
            fontSize: "11px",
            color: theme.foregroundMuted,
          });
          card.appendChild(meta);

          if (s.runs[0]) {
            const latestPreview = document.createElement("div");
            latestPreview.textContent = s.runs[0].outputPreview;
            Object.assign(latestPreview.style, {
              fontSize: "12px",
              color: theme.foregroundMuted,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            });
            card.appendChild(latestPreview);
          }

          listContainer.appendChild(card);
        }
      };

      searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value;
        renderFilteredList();
      });

      renderFilteredList();
    };

    if (currentScheduleId) {
      await renderSingleScheduleView(currentScheduleId);
    } else {
      await renderOverview();
    }
  };

  globalOpenScheduleRunsDrawer = openDrawer;

  let observer: MutationObserver | null = null;
  let rafId: number | null = null;
  let fallbackTimerId: number | null = null;
  let isDecorating = false;

  const removeInjectedScheduleNodes = () => {
    document
      .querySelectorAll(
        '#paseo-finder-all-runs-toolbar, [data-testid^="schedule-runs-pill-"], [data-testid^="schedule-menu-runs-"]',
      )
      .forEach((el) => el.remove());
    observer?.takeRecords();
  };

  // Coalesced, idempotent, circuit-breaker-guarded Schedules DOM decoration.
  // Never mutates `.textContent` unconditionally inside a synchronous MutationObserver microtask!
  const decorateSchedulesDom = () => {
    if (isDecorating) return;
    const prefs = readScheduleRunsPreferences();
    if (!prefs.enabled || domHealthState.circuitBreakerTripped) {
      return;
    }

    const rowsProbe = document.querySelector('[data-testid^="schedule-row-"]');
    if (!rowsProbe) {
      domHealthState.lastDecoratedRowCount = 0;
      return;
    }

    const startedMs =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    isDecorating = true;
    try {
      const theme = syncPaseoThemeCssVariables(document, window);
      const { rowCount, domWrites } = decorateSchedulesDomOnDocument(
        document as unknown as MinimalScheduleDomDocument,
        {
          schedulesById: cachedSchedulesById,
          totals: {
            totalSchedules: cachedTotals.totalSchedules,
            schedulesWithRuns: cachedTotals.schedulesWithRuns,
            totalRuns: cachedTotals.totalRuns,
          },
          isZh: isZhLocale(),
          theme,
          onOpenDrawer: (scheduleId) => {
            void openDrawer(scheduleId);
          },
        },
      );

      const elapsedMs =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        startedMs;
      domHealthState.totalPasses += 1;
      domHealthState.lastPassDurationMs = Math.round(elapsedMs * 100) / 100;
      domHealthState.lastDecoratedRowCount = rowCount;

      if (domWrites > 0) {
        domHealthState.writePasses += 1;
        domHealthState.totalDomWrites += domWrites;
        const now = Date.now();
        domHealthState.recentWriteTimestampsMs.push(now);
        domHealthState.recentWriteTimestampsMs =
          domHealthState.recentWriteTimestampsMs.filter(
            (ts) => now - ts <= CIRCUIT_BREAKER_WINDOW_MS,
          );
        if (
          domHealthState.recentWriteTimestampsMs.length >
          CIRCUIT_BREAKER_MAX_WRITE_PASSES
        ) {
          domHealthState.circuitBreakerTripped = true;
          domHealthState.circuitBreakerTrippedAtIso = new Date(
            now,
          ).toISOString();
          domHealthState.circuitBreakerReason = `Exceeded ${CIRCUIT_BREAKER_MAX_WRITE_PASSES} DOM write passes within ${CIRCUIT_BREAKER_WINDOW_MS}ms; auto-disconnected observer to prevent UI freeze.`;
          observer?.disconnect();
          domHealthState.observerConnected = false;
          console.warn(
            "[file-inspector-finder] Schedule Runs DOM circuit breaker tripped:",
            domHealthState.circuitBreakerReason,
          );
          return;
        }
      } else {
        domHealthState.skippedNoOpPasses += 1;
      }

      if (
        cachedSchedulesById.size === 0 &&
        !inflightFetch &&
        Date.now() - lastFetchAttemptMs >= FETCH_RETRY_COOLDOWN_MS
      ) {
        void refreshScheduleCache(client, false).then(() => {
          scheduleDecoratePass();
        });
      }
    } finally {
      // Drain any MutationRecords produced by our own DOM injections so we never re-trigger ourselves
      observer?.takeRecords();
      isDecorating = false;
    }
  };

  const scheduleDecoratePass = () => {
    if (rafId !== null || fallbackTimerId !== null) return;
    if (domHealthState.circuitBreakerTripped) return;
    if (!readScheduleRunsPreferences().enabled) return;

    if (typeof window.requestAnimationFrame === "function") {
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        decorateSchedulesDom();
      });
    } else {
      fallbackTimerId = window.setTimeout(() => {
        fallbackTimerId = null;
        decorateSchedulesDom();
      }, 16);
    }
  };

  const connectObserverIfEnabled = () => {
    if (!document.body) return;
    if (!readScheduleRunsPreferences().enabled) {
      observer?.disconnect();
      domHealthState.observerConnected = false;
      return;
    }
    if (domHealthState.circuitBreakerTripped) {
      return;
    }
    if (!observer && typeof MutationObserver !== "undefined") {
      observer = new MutationObserver((records) => {
        if (isDecorating) return;
        if (isSelfInjectedMutationBatch(records)) {
          domHealthState.ignoredSelfMutationBatches += 1;
          return;
        }
        scheduleDecoratePass();
      });
    }
    if (observer && !domHealthState.observerConnected) {
      observer.observe(document.body, { childList: true, subtree: true });
      domHealthState.observerConnected = true;
    }
  };

  globalCleanupInjectedScheduleNodes = () => {
    if (rafId !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (fallbackTimerId !== null) {
      window.clearTimeout(fallbackTimerId);
      fallbackTimerId = null;
    }
    observer?.disconnect();
    domHealthState.observerConnected = false;
    removeInjectedScheduleNodes();
  };

  globalReconnectAndRefreshEnhancer = () => {
    connectObserverIfEnabled();
    void refreshScheduleCache(client, true).then(() => {
      scheduleDecoratePass();
    });
    scheduleDecoratePass();
  };

  const onGlobalShortcut = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      e.stopPropagation();
      void openDrawer(null);
    }
  };
  window.addEventListener("keydown", onGlobalShortcut, true);

  connectObserverIfEnabled();
  const interval = window.setInterval(() => {
    if (readScheduleRunsPreferences().enabled && !domHealthState.circuitBreakerTripped) {
      decorateSchedulesDom();
    }
  }, 3000);
  void refreshScheduleCache(client, true).then(() => scheduleDecoratePass());

  return () => {
    window.removeEventListener("keydown", onGlobalShortcut, true);
    if (rafId !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (fallbackTimerId !== null) {
      window.clearTimeout(fallbackTimerId);
      fallbackTimerId = null;
    }
    observer?.disconnect();
    domHealthState.observerConnected = false;
    window.clearInterval(interval);
    if (activeDrawerCleanup) activeDrawerCleanup();
    globalOpenScheduleRunsDrawer = null;
    globalReconnectAndRefreshEnhancer = null;
    globalCleanupInjectedScheduleNodes = null;
  };
}

function buildRunCardElement(
  run: ScheduleRunEntry,
  copy: ScheduleRunsCopy,
  client: ScheduleRunsWebClient,
  theme: PaseoThemeTokens,
  expandedRunTimelines: Map<
    string,
    Array<{ role: string; text: string; timestamp: string | null }>
  >,
  showToast?: (msg: string) => void,
  closeDrawer?: () => void,
  rerender?: () => void,
): HTMLElement {
  const card = document.createElement("div");
  card.setAttribute("data-testid", `schedule-run-card-${run.id}`);
  Object.assign(card.style, {
    background: theme.surface1,
    border: `1px solid ${theme.border}`,
    borderRadius: "8px",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  });

  const topRow = document.createElement("div");
  Object.assign(topRow.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  });

  const leftInfo = document.createElement("div");
  Object.assign(leftInfo.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: "0",
    flex: "1",
  });

  const statusBadge = document.createElement("span");
  const isOk = run.status === "succeeded";
  const isFail = run.status === "failed";
  statusBadge.textContent = isOk ? "✓" : isFail ? "✕" : "⟳";
  Object.assign(statusBadge.style, {
    width: "20px",
    height: "20px",
    borderRadius: "999px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px",
    fontWeight: "700",
    backgroundColor: theme.surface2,
    border: `1px solid ${theme.borderAccent}`,
    color: isOk ? theme.statusSuccess : isFail ? theme.statusDanger : theme.statusDotRunning,
    flexShrink: "0",
  });
  leftInfo.appendChild(statusBadge);

  const runTitle = document.createElement("span");
  runTitle.textContent =
    run.workspaceName || `${run.scheduleName} · #${run.id.slice(0, 8)}`;
  Object.assign(runTitle.style, {
    fontSize: "13px",
    fontWeight: "600",
    color: theme.foreground,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });
  leftInfo.appendChild(runTitle);
  topRow.appendChild(leftInfo);

  const rightBtns = document.createElement("div");
  Object.assign(rightBtns.style, {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  });

  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.setAttribute("data-testid", `schedule-run-preview-${run.id}`);
  const isExpanded = expandedRunTimelines.has(run.id);
  previewBtn.textContent = isExpanded
    ? copy.hideTimelineBtn
    : copy.previewTimelineBtn;
  Object.assign(previewBtn.style, {
    background: theme.surface2,
    border: `1px solid ${theme.border}`,
    color: theme.foregroundMuted,
    borderRadius: "6px",
    padding: "4px 9px",
    fontSize: "11px",
    cursor: "pointer",
  });
  previewBtn.addEventListener("click", async () => {
    if (expandedRunTimelines.has(run.id)) {
      expandedRunTimelines.delete(run.id);
      rerender?.();
      return;
    }
    previewBtn.disabled = true;
    try {
      const res = await client.call(openScheduleRunSessionRpc, {
        action: "preview-timeline",
        scheduleId: run.scheduleId,
        runId: run.id,
        workspaceId: run.workspaceId ?? undefined,
        agentId: run.agentId ?? undefined,
        dryRun: true,
      });
      expandedRunTimelines.set(
        run.id,
        res.timelineEntries.length > 0
          ? res.timelineEntries
          : [
              {
                role: "assistant",
                text: res.error || res.output || run.output || "(No output)",
                timestamp: run.endedAt ?? run.startedAt,
              },
            ],
      );
      rerender?.();
    } finally {
      previewBtn.disabled = false;
    }
  });
  rightBtns.appendChild(previewBtn);

  if (run.workspaceId) {
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.setAttribute("data-testid", `schedule-run-open-${run.id}`);
    openBtn.textContent = copy.openConversationBtn;
    Object.assign(openBtn.style, {
      background: theme.primary,
      border: `1px solid ${theme.primary}`,
      color: theme.primaryForeground,
      borderRadius: "6px",
      padding: "4px 10px",
      fontSize: "11px",
      fontWeight: "600",
      cursor: "pointer",
    });
    openBtn.addEventListener("click", async () => {
      openBtn.disabled = true;
      showToast?.(copy.openingConversationToast);
      try {
        const res = await client.call(openScheduleRunSessionRpc, {
          action: "open-run",
          scheduleId: run.scheduleId,
          runId: run.id,
          workspaceId: run.workspaceId ?? undefined,
          agentId: run.agentId ?? undefined,
          dryRun: false,
        });
        const targetWs = res.workspaceId ?? run.workspaceId;
        if (targetWs) {
          closeDrawer?.();
          navigateToPaseoWorkspace(targetWs, res.agentId ?? run.agentId);
        }
      } finally {
        openBtn.disabled = false;
      }
    });
    rightBtns.appendChild(openBtn);
  }

  topRow.appendChild(rightBtns);
  card.appendChild(topRow);

  // Sub-metadata line
  const subRow = document.createElement("div");
  Object.assign(subRow.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    fontSize: "11px",
    color: theme.foregroundMuted,
  });
  subRow.textContent = `${formatShortTimestamp(run.startedAt)} (${formatRelativeIso(
    run.startedAt,
  )}) · ${run.durationFormatted} · ${run.workspaceId ?? "-"} · ${
    run.isArchived ? copy.archivedBadge : copy.activeWorkspaceBadge
  }`;
  card.appendChild(subRow);

  // Output snippet
  if (run.output || run.error) {
    const outBox = document.createElement("div");
    outBox.textContent = isExpanded
      ? run.error || run.output
      : run.outputPreview;
    Object.assign(outBox.style, {
      fontSize: "12px",
      lineHeight: "1.5",
      color: run.error ? theme.statusDanger : theme.foregroundMuted,
      backgroundColor: theme.surface0,
      border: `1px solid ${theme.borderAccent}`,
      borderRadius: "6px",
      padding: "8px 10px",
      whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    card.appendChild(outBox);
  }

  // Expanded full conversation timeline if toggled
  const timeline = expandedRunTimelines.get(run.id);
  if (timeline && timeline.length > 0) {
    const tlContainer = document.createElement("div");
    Object.assign(tlContainer.style, {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      marginTop: "4px",
      paddingTop: "8px",
      borderTop: `1px solid ${theme.borderAccent}`,
    });
    for (const msg of timeline) {
      const bubble = document.createElement("div");
      Object.assign(bubble.style, {
        backgroundColor: theme.surface0,
        border: `1px solid ${theme.borderAccent}`,
        borderRadius: "6px",
        padding: "8px 10px",
        fontSize: "12px",
        lineHeight: "1.5",
        color: theme.foreground,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxHeight: "260px",
        overflowY: "auto",
      });
      const roleHeader = document.createElement("div");
      roleHeader.textContent = `${msg.role.toUpperCase()}${
        msg.timestamp ? ` · ${formatShortTimestamp(msg.timestamp)}` : ""
      }`;
      Object.assign(roleHeader.style, {
        fontSize: "10px",
        fontWeight: "700",
        color: msg.role === "user" ? theme.statusDotRunning : theme.statusSuccess,
        marginBottom: "4px",
      });
      bubble.appendChild(roleHeader);
      const body = document.createElement("div");
      body.textContent = msg.text;
      bubble.appendChild(body);
      tlContainer.appendChild(bubble);
    }
    card.appendChild(tlContainer);
  }

  return card;
}
