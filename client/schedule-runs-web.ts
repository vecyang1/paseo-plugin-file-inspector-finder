/// <reference lib="dom" />
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  type ScheduleRunEntry,
  type ScheduleRunsSummary,
  inspectScheduleRunsRpc,
  openScheduleRunSessionRpc,
} from "../shared/schedule-runs-contracts";
import { isChineseLocale } from "./i18n";
import { formatRelativeWithLocalTime } from "./session-time-web";
import { type PaseoThemeTokens } from "../shared/paseo-theme";
import { syncPaseoThemeCssVariables } from "./theme-web";
import {
  findSidebarRowTitleElement,
  parseSidebarWorkspaceRowTestId,
  type MinimalElement,
} from "./web";
import {
  getMetroModuleMap,
  requireMetroExport,
  type MetroWindow,
} from "./metro-registry";

const sessionStoreCache = new WeakMap<
  object,
  { getState?: () => { sessions?: Record<string, unknown> } }
>();

function findSessionStore(
  win?: Window | null,
): { getState?: () => { sessions?: Record<string, unknown> } } | null {
  const w = win ?? (typeof window !== "undefined" ? window : null);
  if (!w) return null;
  const cached = sessionStoreCache.get(w as object);
  if (cached) return cached;

  // 1. Live Metro module registry in Paseo production Electron window
  try {
    const metroMap = getMetroModuleMap(w as unknown as MetroWindow);
    if (metroMap && typeof metroMap.values === "function") {
      for (const m of metroMap.values()) {
        const store = m?.isInitialized ? m.publicModule?.exports?.useSessionStore : null;
        if (store && typeof (store as { getState?: unknown }).getState === "function") {
          const typedStore = store as { getState: () => { sessions?: Record<string, unknown> } };
          sessionStoreCache.set(w as object, typedStore);
          return typedStore;
        }
      }
    }
  } catch {
    // Fallback if metro-registry lookup throws
  }

  // 2. Safe requireMetroExport factory lookup (supports uninitialized modules)
  try {
    const hit = requireMetroExport("useSessionStore", w as unknown as MetroWindow);
    const store = hit?.exports?.useSessionStore;
    if (store && typeof (store as { getState?: unknown }).getState === "function") {
      const typedStore = store as { getState: () => { sessions?: Record<string, unknown> } };
      sessionStoreCache.set(w as object, typedStore);
      return typedStore;
    }
  } catch {
    // Ignore require error
  }

  // 2. Fallback to __r.getModules or __metroModules (mocked / dev environments)
  const anyW = w as unknown as {
    __r?: {
      getModules?: () => Record<
        string,
        {
          isInitialized?: boolean;
          publicModule?: { exports?: { useSessionStore?: unknown } };
        }
      >;
    };
    __metroModules?: Record<
      string,
      {
        isInitialized?: boolean;
        publicModule?: { exports?: { useSessionStore?: unknown } };
      }
    >;
  };
  const mods = anyW.__r?.getModules?.() ?? anyW.__metroModules;
  if (!mods) return null;
  for (const m of Object.values(mods)) {
    const store = m?.isInitialized ? m.publicModule?.exports?.useSessionStore : null;
    if (store && typeof (store as { getState?: unknown }).getState === "function") {
      return store as { getState: () => { sessions?: Record<string, unknown> } };
    }
  }
  return null;
}

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
  drawerBreadcrumbRoot: "定时任务",
  drawerTitleAllRuns: "定时任务运行历史与会话巡检器",
  drawerSubtitleAllRuns:
    "对标 Antigravity Automations：查看所有任务历史运行次数、执行耗时与输出摘要，一键唤醒并进入任意历史运行对话。",
  runNowBtn: "立即运行",
  runningNowToast: "已触发 Paseo 立即执行该定时任务",
  keepOpenToggleOn: "完成后自动归档: 开启",
  keepOpenToggleOff: "常驻侧边栏: 开启",
  settingsHeading: "调度配置",
  scheduleLabel: "执行周期",
  workspaceLabel: "工作目录",
  modelLabel: "执行模型",
  archivePolicyLabel: "会话保留策略",
  archivePolicyTrue: "完成后归档，点击进入对话时自动恢复",
  archivePolicyFalse: "完成后保留在左侧边栏",
  instructionsHeading: "任务指令",
  showAllPrompt: "展开全部",
  collapsePrompt: "收起指令",
  runsHeading: "历史运行记录",
  noRunsYet: "该定时任务尚无历史运行记录，可点击右上角「立即运行」触发。",
  openConversationBtn: "进入对话",
  openingConversationToast: "正在恢复并打开该次运行的工作区会话...",
  previewTimelineBtn: "预览对话与输出",
  hideTimelineBtn: "收起预览",
  filterOnlyWithRuns: "仅看有运行记录",
  filterAllSchedules: "全部定时任务",
  searchPlaceholder: "搜索任务名称、模型或运行输出内容...",
  statusActive: "运行中",
  statusPaused: "已暂停",
  standbyBadge: "AG 灾备孪生",
  archivedBadge: "已归档，点击自动恢复",
  activeWorkspaceBadge: "侧边栏活跃",
  closeBtn: "关闭",
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
  const formatted = formatRelativeWithLocalTime(iso, { compact: false });
  if (formatted.label) return formatted.label;
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

const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const ZH_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;
const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatAntigravityRunTimestamp(
  iso: string | null | undefined,
  options?: { nowMs?: number; isZh?: boolean; emptyLabel?: string },
): string {
  const isZh = options?.isZh ?? false;
  const empty = options?.emptyLabel ?? (isZh ? "—" : "—");
  if (!iso) return empty;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date(options?.nowMs ?? Date.now());

  const startOfTarget = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime();
  const startOfNow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const diffDays = Math.round((startOfTarget - startOfNow) / 86_400_000);

  const rawHours = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, "0");
  const timePart = isZh
    ? `${String(rawHours).padStart(2, "0")}:${mins}`
    : `${rawHours % 12 || 12}:${mins} ${rawHours >= 12 ? "PM" : "AM"}`;

  if (diffDays === 0) {
    return isZh ? `今天 ${timePart}` : `Today ${timePart}`;
  }
  if (diffDays === 1) {
    return isZh ? `明天 ${timePart}` : `Tomorrow ${timePart}`;
  }
  if (diffDays === -1) {
    return isZh ? `昨天 ${timePart}` : `Yesterday ${timePart}`;
  }
  if (Math.abs(diffDays) <= 6) {
    const wd = d.getDay();
    return isZh
      ? `${ZH_WEEKDAYS[wd]} ${timePart}`
      : `${EN_WEEKDAYS[wd]} ${timePart}`;
  }
  return isZh
    ? `${d.getMonth() + 1}月${d.getDate()}日 ${timePart}`
    : `${EN_MONTHS[d.getMonth()]} ${d.getDate()}, ${timePart}`;
}

export function formatCompactSidebarAge(
  iso: string | null | undefined,
  nowMs?: number,
): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const diffSec = Math.max(0, Math.floor(((nowMs ?? Date.now()) - ts) / 1000));
  if (diffSec < 60) return "now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 14) return `${diffDays}d`;
  return `${Math.floor(diffDays / 7)}w`;
}

export function findRunningCadenceElapsedSec(
  sched:
    | {
        runs?: Array<{
          status?: string | null;
          workspaceId?: string | null;
          startedAt?: string | null;
        } | null> | null;
      }
    | null
    | undefined,
  cleanWorkspaceId?: string | null,
  nowMs?: number,
): number | null {
  if (!sched || !Array.isArray(sched.runs)) return null;
  const currentMs = nowMs ?? Date.now();
  if (cleanWorkspaceId) {
    for (let i = 0; i < sched.runs.length; i += 1) {
      const r = sched.runs[i];
      if (!r) continue;
      const rWsId = r.workspaceId
        ? r.workspaceId.replace(/^(?:local|srv_[^:]+):/, "").trim()
        : "";
      if (r.status === "running" && rWsId === cleanWorkspaceId && r.startedAt) {
        const ts = Date.parse(r.startedAt);
        if (Number.isFinite(ts) && ts <= currentMs) {
          return Math.max(0, Math.floor((currentMs - ts) / 1000));
        }
      }
    }
  }
  for (let i = 0; i < sched.runs.length; i += 1) {
    const r = sched.runs[i];
    if (r && r.status === "running" && r.startedAt) {
      const ts = Date.parse(r.startedAt);
      if (Number.isFinite(ts) && ts <= currentMs) {
        return Math.max(0, Math.floor((currentMs - ts) / 1000));
      }
    }
  }
  return null;
}

export function formatRunningCadenceElapsed(
  sec: number | null | undefined,
  isZh: boolean = false,
): string {
  if (sec == null || sec < 0) return "";
  if (sec < 60) {
    return isZh ? `${sec}秒` : `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) {
    if (remSec === 0) {
      return isZh ? `${min}分钟` : `${min}m`;
    }
    return isZh ? `${min}分${remSec}秒` : `${min}m ${remSec}s`;
  }
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (remMin === 0) {
    return isZh ? `${hr}小时` : `${hr}h`;
  }
  return isZh ? `${hr}小时${remMin}分` : `${hr}h ${remMin}m`;
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
let cachedWorkspaceScheduleMap: Record<
  string,
  { scheduleId: string; scheduleName: string; isRunning: boolean; runStatus: string }
> = {};
let cachedProjectLastActiveByKey: Record<string, string> = {};
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

let activeScheduleRunsClient: ScheduleRunsWebClient | null = null;
let activeShowToast: ((msg: string) => void) | null = null;

export const GENERIC_CHAT_TITLES = new Set([
  "untitled",
  "new workspace",
  "new session",
  "new chat",
  "general discussion",
  "chat",
  "conversation",
  "main",
  "scratch",
  "notes",
]);

export const CADENCE_TIMER_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="8" cy="9.5" r="5.5"/>' +
  '<path d="M8 7v2.5l1.8 1.2"/>' +
  '<path d="M6.5 1.5h3"/>' +
  '<path d="M8 1.5v2"/>' +
  "</svg>";

export function matchScheduleTitleOrSlug(
  cleanTitle: string,
  scheduleName?: string | null,
  standbySlug?: string | null,
  prompt?: string | null,
): boolean {
  if (!cleanTitle) return false;
  const rawT = cleanTitle.trim().toLowerCase();
  if (!rawT) return false;

  // Immediately reject user intake / chat sessions unless explicit CAD/standby
  const hasExplicitCadenceMarker = /\[ag-standby\s+slug=|CAD-\d{8}/i.test(cleanTitle);
  if (!hasExplicitCadenceMarker) {
    const strippedPrefix = rawT.replace(/^(?:d|done:?|✓)\s+/i, "");
    if (
      strippedPrefix.startsWith("intake ·") ||
      strippedPrefix.startsWith("intake:") ||
      strippedPrefix.startsWith("intake ")
    ) {
      return false;
    }
  }

  // 1. Normalize workspace title: strip status / action prefixes
  // e.g. "d ", "done: ", "✓ ", "Run ", "Running ", "Execute ", "AG · ", "AG: "
  const t = rawT
    .replace(/^(?:d|done:?|✓)\s+/i, "")
    .replace(/^[\s★⭐️✨⚡️🔥📌🏷️✓•·-]+\s*/i, "")
    .replace(/^(?:run(?:ning)?|execute)\s+/i, "")
    .replace(/^ag\s*[·•:-]\s*/i, "")
    .trim();
  if (!t) return false;

  if (GENERIC_CHAT_TITLES.has(t) || GENERIC_CHAT_TITLES.has(rawT)) {
    return false;
  }

  const tClean = t.replace(/\.{3}$|…$/, "").trim();
  const promptSlugMatch =
    !standbySlug && prompt ? /\[ag-standby\s+slug=([^\s\]]+)/i.exec(prompt) : null;
  const effectiveStandbySlug = standbySlug || promptSlugMatch?.[1] || null;

  // 2. Extract Cadence Card ID if present (e.g. "CAD-20260925-mac-morning-speed-watch" or "CAD-20260925")
  const cadIdMatch = /(?:CAD-\d{8}-[a-z0-9-]+|CAD-\d{8})/i.exec(cleanTitle);
  if (cadIdMatch && (effectiveStandbySlug || scheduleName)) {
    const cadId = cadIdMatch[0].toLowerCase();
    if (
      (effectiveStandbySlug &&
        (cadId.includes(effectiveStandbySlug.toLowerCase()) ||
          effectiveStandbySlug.toLowerCase().includes(cadId))) ||
      (scheduleName && scheduleName.toLowerCase().includes(cadId))
    ) {
      return true;
    }
  }

  // 3. Standby slug explicit in title: [ag-standby slug=xxx] or space-normalized slug
  if (effectiveStandbySlug) {
    const slug = effectiveStandbySlug.trim().toLowerCase();
    const explicitStandbyMatch = /\[ag-standby\s+slug=([^\s\]]+)/i.exec(cleanTitle);
    if (explicitStandbyMatch && explicitStandbyMatch[1]?.toLowerCase() === slug) {
      return true;
    }
    if (t === slug || rawT === slug || tClean === slug) {
      return true;
    }
    const slugWords = slug.replace(/[-_]+/g, " ").trim();
    if (slugWords.length >= 4) {
      if (
        tClean === slugWords ||
        tClean.startsWith(`${slugWords} `) ||
        tClean.startsWith(`${slugWords}…`) ||
        ((t.endsWith("…") || t.endsWith("...")) &&
          slugWords.startsWith(tClean) &&
          tClean.length >= 8)
      ) {
        return true;
      }
    }
  }

  // 4. Normalize schedule name
  if (scheduleName) {
    const rawS = scheduleName.trim().toLowerCase();
    const s = rawS
      .replace(/^(?:d|done:?|✓)\s+/i, "")
      .replace(/^[\s★⭐️✨⚡️🔥📌🏷️✓•·-]+\s*/i, "")
      .replace(/^ag\s*[·•:-]\s*/i, "")
      .replace(/^[\s★⭐️✨⚡️🔥📌🏷️✓•·-]+\s*/i, "")
      .replace(/^(?:run(?:ning)?|execute)\s+/i, "")
      .replace(/^(?:antigravity|agy)\s+/i, "")
      .trim();

    // Exact matches
    if (t === s || rawT === rawS || tClean === s) return true;

    // Strip trailing parentheticals: e.g. "(Every 30 Minutes)", "(CAD-...)", "(Asia/Shanghai)"
    const sBeforeParen = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const tBeforeParen = t.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const tCleanBeforeParen = tClean.replace(/\s*\([^)]*\)\s*$/, "").trim();

    if (
      sBeforeParen.length >= 5 &&
      (t === sBeforeParen ||
        rawT === sBeforeParen ||
        tBeforeParen === sBeforeParen ||
        tCleanBeforeParen === sBeforeParen ||
        tBeforeParen === s)
    ) {
      return true;
    }

    // Stem matching with ellipsis
    if (t.endsWith("…") || t.endsWith("...")) {
      const stem = tCleanBeforeParen;
      if (stem.length >= 8 && (s.startsWith(stem) || sBeforeParen.startsWith(stem))) {
        return true;
      }
    }

    // Explicit "Run <ScheduleName> [scheduled|cadence|health] check"
    if (rawT.startsWith("run ") || rawT.startsWith("running ") || rawT.startsWith("execute ")) {
      const normalizeJoiners = (val: string) =>
        val
          .replace(/[&/+—–-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const tCheck = normalizeJoiners(
        tBeforeParen
          .replace(/\s+mac-speed$/, "")
          .replace(
            /[\s—–-]+(?:scheduled\s+check|cadence\s+check|health\s+check|standby\s+check|scheduled\s+health\s+check|diagnosis(?:\s+and\s+(?:clean(?:up)?|self-heal))?|check)\b.*$/i,
            "",
          )
          .replace(/\s+mac-speed$/, ""),
      );
      const tCore = normalizeJoiners(
        tCheck
          .replace(/\.{3}$|…$/, "")
          .replace(
            /[\s—–-]+(?:sentinel|monitor|watch|audit|cadence|sync|scanner|digest)\b.*$/i,
            "",
          ),
      );
      const sCheck = normalizeJoiners(
        sBeforeParen.replace(
          /[\s—–-]+(?:sentinel|monitor|watch|audit|cadence|sync|scanner|digest)\b.*$/i,
          "",
        ),
      );
      if (tCore.length >= 6 && sCheck.length >= 6) {
        if (
          tCheck === sCheck ||
          tCore === sCheck ||
          (sCheck.startsWith(tCore) && tCore.length >= 6) ||
          (tCheck.startsWith(sCheck) && sCheck.length >= 6)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

export function matchesWorkspaceNameWithStem(a: string, b: string): boolean {
  if (!a || !b) return false;
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (GENERIC_CHAT_TITLES.has(normA) || GENERIC_CHAT_TITLES.has(normB)) return false;

  const hasEllipsisA = /[. …]{2,}$|[…]/.test(normA);
  const hasEllipsisB = /[. …]{2,}$|[…]/.test(normB);
  const stemA = normA.replace(/[. …]+$/, "").trim();
  const stemB = normB.replace(/[. …]+$/, "").trim();
  if (GENERIC_CHAT_TITLES.has(stemA) || GENERIC_CHAT_TITLES.has(stemB)) return false;
  if (normA === normB) return true;

  if (hasEllipsisA && stemA.length >= 6) {
    if (normB.startsWith(stemA) || stemB.startsWith(stemA)) return true;
  }
  if (hasEllipsisB && stemB.length >= 6) {
    if (normA.startsWith(stemB) || stemA.startsWith(stemB)) return true;
  }

  if (stemA.length >= 10 && stemA.includes(" ") && normB.startsWith(stemA + " ")) {
    return true;
  }
  if (stemB.length >= 10 && stemB.includes(" ") && normA.startsWith(stemB + " ")) {
    return true;
  }

  return false;
}

interface StoreAgentMeta {
  scheduleId: string | null;
  scheduleNameLabel: string | null;
  standbySlug: string | null;
  agentId: string | null;
  isRunning: boolean;
  agentStartedAt: string | null;
  explicitStatus: string | null;
  isExplicitNonCadence: boolean;
}

function findStoreAgentMeta(
  win: Window | null,
  cleanId: string,
): StoreAgentMeta | null {
  if (!cleanId) return null;
  const sessionStore = findSessionStore(win);
  if (!sessionStore || typeof sessionStore.getState !== "function") return null;
  try {
    const sessions = sessionStore.getState()?.sessions ?? {};
    let scheduleId: string | null = null;
    let scheduleNameLabel: string | null = null;
    let standbySlug: string | null = null;
    let agentId: string | null = null;
    let isRunning = false;
    let turnStartedAt: string | null = null;
    let createdAt: string | null = null;
    let explicitStatus: string | null = null;
    let sawMatchingAgent = false;
    let sawExplicitNonCadence = false;

    for (const session of Object.values(sessions)) {
      const rawAgents = (session as Record<string, unknown> | undefined)?.agents;
      const rawDetails = (session as Record<string, unknown> | undefined)?.agentDetails;
      const agents: Array<Record<string, unknown>> = [];
      if (rawAgents) {
        if (rawAgents instanceof Map) {
          agents.push(...(rawAgents.values() as Iterable<Record<string, unknown>>));
        } else if (typeof rawAgents === "object") {
          agents.push(...(Object.values(rawAgents) as Array<Record<string, unknown>>));
        }
      }
      if (rawDetails) {
        if (rawDetails instanceof Map) {
          agents.push(...(rawDetails.values() as Iterable<Record<string, unknown>>));
        } else if (typeof rawDetails === "object") {
          agents.push(...(Object.values(rawDetails) as Array<Record<string, unknown>>));
        }
      }
      for (const a of agents) {
        if (!a) continue;
        const aWid = String(a.workspaceId ?? "")
          .replace(/^(?:local|srv_[^:]+):/, "")
          .trim();
        if (aWid !== cleanId) continue;
        sawMatchingAgent = true;
        if (!agentId && typeof a.id === "string" && a.id.trim()) {
          agentId = a.id.trim();
        }
        const labels = a.labels as Record<string, string> | undefined;
        const sid = labels?.["paseo.schedule-id"]?.trim();
        if (sid && !scheduleId) {
          scheduleId = sid;
        }
        const sName = labels?.["paseo.schedule-name"]?.trim();
        if (sName && !scheduleNameLabel) {
          scheduleNameLabel = sName;
        }
        const aTitle = String(a.title ?? "");
        const sm = /\[ag-standby\s+slug=(?<slug>[^\s\]]+)/i.exec(aTitle);
        if (sm?.groups?.slug && !standbySlug) {
          standbySlug = sm.groups.slug;
        }
        const turnObj = (a.turn ?? a.activeTurn) as
          | { phase?: unknown; startedAt?: unknown }
          | undefined;
        const statusStr = typeof a.status === "string" ? a.status.trim() : "";
        if (statusStr) explicitStatus = statusStr;
        const agentRunning =
          turnObj?.phase === "open" ||
          statusStr === "running" ||
          statusStr === "busy" ||
          statusStr === "initializing";
        if (agentRunning) {
          isRunning = true;
          if (typeof turnObj?.startedAt === "string" && turnObj.startedAt.trim()) {
            turnStartedAt = turnObj.startedAt.trim();
          }
        }
        if (!createdAt && typeof a.createdAt === "string" && a.createdAt.trim()) {
          createdAt = a.createdAt.trim();
        }
        if (labels?.["relation-kind"] === "intake-routed" || (!sid && !sm)) {
          sawExplicitNonCadence = true;
        }
      }
    }

    if (!sawMatchingAgent) return null;
    const isCadence = Boolean(scheduleId || standbySlug);
    return {
      scheduleId,
      scheduleNameLabel,
      standbySlug,
      agentId,
      isRunning,
      agentStartedAt: isRunning ? (turnStartedAt ?? createdAt) : null,
      explicitStatus,
      isExplicitNonCadence: !isCadence && sawExplicitNonCadence,
    };
  } catch {
    return null;
  }
}

function enrichScheduleWithRunningState<T extends ResolvedCadenceSchedule>(
  sched: T,
  cleanId: string,
  forceRunning: boolean,
  storeMeta: StoreAgentMeta | null,
): T {
  const isRunning = forceRunning || Boolean(storeMeta?.isRunning);
  if (!isRunning) return sched;
  const existingRuns = Array.isArray(sched.runs) ? sched.runs : [];
  const hasRunningWithStartedAt = existingRuns.some(
    (r) =>
      r &&
      r.status === "running" &&
      Boolean(r.startedAt) &&
      (!cleanId ||
        !r.workspaceId ||
        r.workspaceId.replace(/^(?:local|srv_[^:]+):/, "").trim() === cleanId),
  );
  let nextRuns = existingRuns;
  if (!hasRunningWithStartedAt && storeMeta?.agentStartedAt) {
    const syntheticRun: ScheduleRunEntry = {
      id: `store-${storeMeta.agentId ?? sched.id}`,
      scheduleId: sched.id,
      scheduleName: sched.name || sched.id,
      status: "running",
      scheduledFor: storeMeta.agentStartedAt,
      startedAt: storeMeta.agentStartedAt,
      endedAt: null,
      durationMs: null,
      durationFormatted: "running…",
      agentId: storeMeta.agentId ?? null,
      workspaceId: cleanId || null,
      workspaceName: null,
      isArchived: false,
      output: "",
      outputPreview: "",
      error: null,
    };
    nextRuns = [syntheticRun, ...existingRuns];
  }
  return {
    ...sched,
    runningRuns: Math.max(1, sched.runningRuns ?? 0),
    lastRunStatus: "running",
    runs: nextRuns,
  };
}

export function findCadenceScheduleForWorkspace(
  workspaceId?: string | null,
  workspaceTitle?: string | null,
  winOverride?: Window | null,
): ScheduleRunsSummary | null {
  if (!workspaceId && !workspaceTitle) return null;
  const cleanId = (workspaceId ?? "").replace(/^(?:local|srv_[^:]+):/, "").trim();
  const cleanTitle = (workspaceTitle ?? "").trim().toLowerCase();
  const win = winOverride ?? (typeof window !== "undefined" ? window : null);
  const storeMeta = cleanId ? findStoreAgentMeta(win, cleanId) : null;

  // 1. Direct O(1) workspaceScheduleMap lookup (cached from server RPC)
  const meta =
    (cleanId && cachedWorkspaceScheduleMap[cleanId]) ||
    (workspaceId && cachedWorkspaceScheduleMap[workspaceId]) ||
    null;
  if (meta) {
    const full = cachedSchedulesById.get(meta.scheduleId);
    if (full) {
      return enrichScheduleWithRunningState(full, cleanId, meta.isRunning, storeMeta);
    }
    const baseMeta = {
      id: meta.scheduleId,
      name: meta.scheduleName,
      status: "active",
      runningRuns: meta.isRunning ? 1 : 0,
      lastRunStatus: meta.isRunning ? "running" : meta.runStatus,
      runs: [],
    } as unknown as ScheduleRunsSummary;
    return enrichScheduleWithRunningState(baseMeta, cleanId, meta.isRunning, storeMeta);
  }

  // 2. Real-time in-memory store lookup via useSessionStore (Paseo Metro store)
  if (storeMeta) {
    if (storeMeta.scheduleId) {
      const full = cachedSchedulesById.get(storeMeta.scheduleId);
      if (full) {
        return enrichScheduleWithRunningState(full, cleanId, false, storeMeta);
      }
      const provisionalName =
        storeMeta.scheduleNameLabel ||
        (storeMeta.standbySlug ? `AG · ${storeMeta.standbySlug}` : storeMeta.scheduleId);
      const provisional = {
        id: storeMeta.scheduleId,
        name: provisionalName,
        standbySlug: storeMeta.standbySlug,
        status: "active",
        runningRuns: storeMeta.isRunning ? 1 : 0,
        lastRunStatus: storeMeta.isRunning ? "running" : "succeeded",
        runs: [],
      } as unknown as ScheduleRunsSummary;
      return enrichScheduleWithRunningState(provisional, cleanId, false, storeMeta);
    }
    if (storeMeta.standbySlug) {
      const slug = storeMeta.standbySlug;
      for (const s of cachedSchedulesById.values()) {
        if (s.standbySlug === slug || s.prompt?.includes(`slug=${slug}`)) {
          return enrichScheduleWithRunningState(s, cleanId, false, storeMeta);
        }
      }
      const provisional = {
        id: slug,
        name: storeMeta.scheduleNameLabel || `AG · ${slug}`,
        standbySlug: slug,
        status: "active",
        runningRuns: storeMeta.isRunning ? 1 : 0,
        lastRunStatus: storeMeta.isRunning ? "running" : "succeeded",
        runs: [],
      } as unknown as ScheduleRunsSummary;
      return enrichScheduleWithRunningState(provisional, cleanId, false, storeMeta);
    }
    if (storeMeta.isExplicitNonCadence) {
      return null;
    }
  }

  // 3. Scan cached schedules by id, run.workspaceId, or run.workspaceName
  for (const sched of cachedSchedulesById.values()) {
    if (cleanId && (sched.id === cleanId || sched.id.replace(/^sched_/, "") === cleanId)) {
      return sched;
    }
    if (sched.runs) {
      for (let i = 0; i < sched.runs.length; i += 1) {
        const r = sched.runs[i];
        if (cleanId && r?.workspaceId && r.workspaceId.replace(/^(?:local|srv_[^:]+):/, "").trim() === cleanId) {
          return sched;
        }
        if (
          cleanTitle &&
          cleanTitle.length >= 6 &&
          !GENERIC_CHAT_TITLES.has(cleanTitle) &&
          r?.workspaceName &&
          matchesWorkspaceNameWithStem(cleanTitle, r.workspaceName)
        ) {
          return sched;
        }
      }
    }
    if (cleanTitle && matchScheduleTitleOrSlug(cleanTitle, sched.name, sched.standbySlug, sched.prompt)) {
      return sched;
    }
  }
  return null;
}

export function showDefaultCadenceToast(msg: string): void {
  if (typeof document === "undefined" || !document.body) return;
  const setTimer =
    typeof globalThis.setTimeout === "function"
      ? globalThis.setTimeout
      : typeof window !== "undefined" && typeof window.setTimeout === "function"
        ? window.setTimeout
        : null;
  const clearTimer =
    typeof globalThis.clearTimeout === "function"
      ? globalThis.clearTimeout
      : typeof window !== "undefined" && typeof window.clearTimeout === "function"
        ? window.clearTimeout
        : null;

  let toastEl = document.getElementById("paseo-finder-cadence-toast");
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.id = "paseo-finder-cadence-toast";
    toastEl.setAttribute("data-testid", "paseo-finder-cadence-toast");
    Object.assign(toastEl.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: "9999",
      padding: "8px 14px",
      borderRadius: "8px",
      fontSize: "12px",
      fontWeight: "500",
      backgroundColor: "var(--surface-2, #1e293b)",
      color: "var(--foreground, #f8fafc)",
      border: "1px solid var(--border-accent, rgba(16, 185, 129, 0.3))",
      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.3)",
      pointerEvents: "none",
      transition: "opacity 180ms ease, transform 180ms ease",
      opacity: "0",
      transform: "translateY(8px)",
    });
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.style.opacity = "1";
  toastEl.style.transform = "translateY(0)";
  const timerKey = "__toast_timer";
  const holder = toastEl as unknown as Record<string, ReturnType<typeof setTimeout> | undefined>;
  if (holder[timerKey] && clearTimer) clearTimer(holder[timerKey] as never);
  if (setTimer) {
    holder[timerKey] = setTimer(() => {
      if (toastEl) {
        toastEl.style.opacity = "0";
        toastEl.style.transform = "translateY(8px)";
      }
    }, 2600);
  }
}

export async function triggerRunScheduleNow(
  scheduleId: string,
  clientOverride?: ScheduleRunsWebClient,
  showToastOverride?: (msg: string) => void,
): Promise<{ ok: boolean; message: string }> {
  const activeClient = clientOverride ?? activeScheduleRunsClient;
  if (!activeClient) {
    return { ok: false, message: "Schedule client is not initialized" };
  }
  const isZh = isChineseLocale();
  try {
    const res = await activeClient.call(openScheduleRunSessionRpc, {
      action: "run-now",
      scheduleId,
      dryRun: false,
    });
    const toast = showToastOverride ?? activeShowToast ?? showDefaultCadenceToast;
    const msg = isZh
      ? `已触发节奏 "${res.scheduleName || scheduleId}" 立即运行`
      : (res.message || `Triggered run for schedule ${scheduleId}`);
    toast(msg);
    setTimeout(() => {
      void refreshScheduleCache(activeClient, true);
    }, 1500);
    return { ok: res.ok, message: msg };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const toast = showToastOverride ?? activeShowToast ?? showDefaultCadenceToast;
    const errText = isZh ? `触发节奏运行失败: ${errMsg}` : `Run failed: ${errMsg}`;
    toast(errText);
    return { ok: false, message: errMsg };
  }
}

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
      cursor.id === "paseo-finder-schedules-col-header" ||
      cursor.id === "paseo-finder-schedule-runs-drawer" ||
      cursor.id === "paseo-finder-sidebar-ts-style" ||
      cursor.id === "paseo-finder-cadence-toast"
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
        tid === "schedules-col-header" ||
        tid === "schedule-runs-drawer" ||
        tid === "paseo-finder-cadence-toast" ||
        tid.startsWith("schedule-runs-pill-") ||
        tid.startsWith("schedule-time-cols-") ||
        tid.startsWith("schedule-next-run-col-") ||
        tid.startsWith("schedule-last-run-col-") ||
        tid.startsWith("sidebar-project-timestamp-") ||
        tid.startsWith("sidebar-workspace-cadence-badge-") ||
        tid.startsWith("workspace-header-cadence-badge-") ||
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
  innerHTML?: string;
  textContent: string | null;
  style: Record<string, string>;
  firstChild?: MinimalScheduleDomElement | null;
  parentElement?: MinimalScheduleDomElement | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  querySelector<T = MinimalScheduleDomElement>(selector: string): T | null;
  closest?<T = MinimalScheduleDomElement>(selector: string): T | null;
  appendChild(child: MinimalScheduleDomElement): void;
  insertBefore(
    newNode: MinimalScheduleDomElement,
    refNode: MinimalScheduleDomElement | null,
  ): void;
  remove?(): void;
  addEventListener(
    type: string,
    listener: (ev: {
      key?: string;
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

export function isHeaderElementVisible(
  el: MinimalScheduleDomElement | null | undefined,
  win?: Window | null,
): boolean {
  if (!el) return false;
  const rectFn = (el as unknown as {
    getBoundingClientRect?: () => { width: number; height: number } | null;
  }).getBoundingClientRect;
  if (typeof rectFn === "function") {
    try {
      const rect = rectFn.call(el);
      if (rect && rect.width === 0 && rect.height === 0) {
        return false;
      }
    } catch {
      // Ignore in synthetic test DOMs
    }
  }
  let cur: MinimalScheduleDomElement | null | undefined = el;
  let depth = 0;
  // Walk up to 28 levels because Expo Router / React Navigation NativeScreen wraps
  // CompactHeader -> ScreenTitle 12-18 levels deep inside `<div hidden style="display: none">`.
  while (cur && depth < 28) {
    depth += 1;
    const style = cur.style;
    if (
      style &&
      (style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0")
    ) {
      return false;
    }
    const ariaHidden = cur.getAttribute?.("aria-hidden");
    if (ariaHidden === "true") return false;
    if (cur.hasAttribute?.("hidden")) return false;
    if (typeof cur.getAttribute === "function" && cur.getAttribute("hidden") !== null) {
      return false;
    }
    if ((cur as unknown as { hidden?: boolean }).hidden === true) return false;

    const htmlEl = cur as unknown as HTMLElement;
    if (
      typeof win?.getComputedStyle === "function" &&
      htmlEl &&
      (htmlEl as unknown as { nodeType?: number }).nodeType === 1
    ) {
      try {
        const cs = win.getComputedStyle(htmlEl);
        if (cs && (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0")) {
          return false;
        }
      } catch {
        // Ignore in synthetic test DOMs
      }
    }
    cur = cur.parentElement;
  }
  return true;
}

export function findVisibleHeaderTitleElement(
  doc: MinimalScheduleDomDocument,
  win?: Window | null,
): MinimalScheduleDomElement | null {
  if (typeof doc.querySelectorAll === "function") {
    const all = doc.querySelectorAll<MinimalScheduleDomElement>(
      '[data-testid="workspace-header-title"]',
    );
    if (all && all.length > 0) {
      // Iterate from last to first so in React Navigation stack transitions,
      // the newly pushed active screen (last in DOM order) wins over outgoing kept-alive screens.
      for (let i = all.length - 1; i >= 0; i -= 1) {
        const el = all[i];
        if (el && isHeaderElementVisible(el, win)) {
          return el;
        }
      }
      return null;
    }
  }
  const fallback = doc.querySelector<MinimalScheduleDomElement>(
    '[data-testid="workspace-header-title"]',
  );
  if (fallback && isHeaderElementVisible(fallback, win)) {
    return fallback;
  }
  return null;
}

export type ScheduleRowSummarySlice = Pick<
  ScheduleRunsSummary,
  "id" | "name" | "totalRuns" | "lastRunStatus"
> &
  Partial<
    Pick<
      ScheduleRunsSummary,
      "lastRunAt" | "nextRunAt" | "status" | "runs" | "runningRuns" | "standbySlug"
    >
  >;

export type ResolvedCadenceSchedule = {
  id: string;
  name?: string;
  status?: string;
  lastRunStatus?: string | null;
  runningRuns?: number;
  runs?: Array<Partial<ScheduleRunEntry>>;
};

export interface DecorateSchedulesDomOptions {
  schedulesById: ReadonlyMap<string, ScheduleRowSummarySlice | ScheduleRunsSummary>;
  totals: {
    totalSchedules: number;
    schedulesWithRuns: number;
    totalRuns: number;
  };
  isZh: boolean;
  theme?: PaseoThemeTokens;
  nowMs?: number;
  projectLastActiveByKey?: Record<string, string>;
  onOpenDrawer: (scheduleId: string | null) => void;
  onRunNow?: (scheduleId: string) => Promise<unknown> | void;
  findCadenceForWorkspace?: (
    workspaceId?: string | null,
    workspaceTitle?: string | null,
  ) => ResolvedCadenceSchedule | null;
}

function resolveCadenceSchedule(
  cleanWorkspaceId: string,
  rowTitle: string,
  options: DecorateSchedulesDomOptions,
): ResolvedCadenceSchedule | null {
  const normWsId = (cleanWorkspaceId ?? "").replace(/^(?:local|srv_[^:]+):/, "").trim();
  if (options.findCadenceForWorkspace) {
    const custom = options.findCadenceForWorkspace(normWsId, rowTitle);
    if (custom) return custom;
  }
  const fromCacheOrStore = findCadenceScheduleForWorkspace(normWsId, rowTitle);
  if (fromCacheOrStore) {
    const richer = options.schedulesById.get(fromCacheOrStore.id);
    if (richer) {
      const storeMeta = normWsId
        ? findStoreAgentMeta(typeof window !== "undefined" ? window : null, normWsId)
        : null;
      const hasRunningStart = (runs?: Array<Partial<ScheduleRunEntry>>) =>
        Boolean(runs?.some((r) => r?.status === "running" && Boolean(r?.startedAt)));
      const mergedRuns = hasRunningStart(richer.runs)
        ? richer.runs
        : hasRunningStart(fromCacheOrStore.runs)
          ? [...(fromCacheOrStore.runs ?? []), ...(richer.runs ?? [])]
          : Array.isArray(richer.runs) && richer.runs.length > 0
            ? richer.runs
            : fromCacheOrStore.runs;
      const mergedBase: ResolvedCadenceSchedule = {
        id: richer.id ?? fromCacheOrStore.id,
        name: richer.name || fromCacheOrStore.name,
        status: richer.status ?? fromCacheOrStore.status,
        lastRunStatus: fromCacheOrStore.lastRunStatus ?? richer.lastRunStatus,
        runningRuns: Math.max(
          fromCacheOrStore.runningRuns ?? 0,
          richer.runningRuns ?? 0,
        ),
        runs: mergedRuns,
      };
      const isRunningNow =
        Boolean(mergedBase.runningRuns && mergedBase.runningRuns > 0) ||
        mergedBase.lastRunStatus === "running";
      return isRunningNow
        ? enrichScheduleWithRunningState(mergedBase, normWsId, isRunningNow, storeMeta)
        : mergedBase;
    }
    return fromCacheOrStore;
  }

  const cleanTitle = rowTitle.trim().toLowerCase();
  for (const [id, sched] of options.schedulesById.entries()) {
    const fullSched = sched as Partial<ScheduleRunsSummary>;
    if (
      normWsId &&
      (id === normWsId ||
        fullSched.id === normWsId ||
        id.replace(/^sched_/, "") === normWsId)
    ) {
      return { id: fullSched.id ?? id, name: fullSched.name ?? id, ...fullSched };
    }
    if (Array.isArray(fullSched.runs)) {
      for (let i = 0; i < fullSched.runs.length; i += 1) {
        const r = fullSched.runs[i];
        if (normWsId && r?.workspaceId && r.workspaceId.replace(/^(?:local|srv_[^:]+):/, "").trim() === normWsId) {
          return { id: fullSched.id ?? id, name: fullSched.name ?? id, ...fullSched };
        }
        if (
          cleanTitle &&
          cleanTitle.length >= 6 &&
          !GENERIC_CHAT_TITLES.has(cleanTitle) &&
          r?.workspaceName &&
          matchesWorkspaceNameWithStem(cleanTitle, r.workspaceName)
        ) {
          return { id: fullSched.id ?? id, name: fullSched.name ?? id, ...fullSched };
        }
      }
    }
    if (cleanTitle && matchScheduleTitleOrSlug(cleanTitle, fullSched.name, fullSched.standbySlug, fullSched.prompt)) {
      return { id: fullSched.id ?? id, name: fullSched.name ?? id, ...fullSched };
    }
  }
  return null;
}

export function ensurePaseoSidebarTimestampSetting(
  storageOverride?: Pick<Storage, "getItem" | "setItem"> | null,
): boolean {
  const storage =
    storageOverride ??
    (typeof window !== "undefined" ? window.localStorage : null);
  if (!storage) return false;
  const HEALED_KEY = "paseo:finder-plugin:healed-sidebar-trailing-v1";
  try {
    if (storage.getItem(HEALED_KEY) === "1") return false;
    const raw = storage.getItem("paseo:app-settings");
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && parsed.sidebarWorkspaceTrailing === "diff") {
      parsed.sidebarWorkspaceTrailing = "timestamp";
      storage.setItem("paseo:app-settings", JSON.stringify(parsed));
      storage.setItem(HEALED_KEY, "1");
      return true;
    }
    storage.setItem(HEALED_KEY, "1");
    return false;
  } catch {
    return false;
  }
}

export function setCachedSchedulesForTesting(
  map: Map<string, ScheduleRunsSummary>,
  workspaceScheduleMap?: Record<
    string,
    { scheduleId: string; scheduleName: string; isRunning: boolean; runStatus: string }
  >,
): void {
  cachedSchedulesById = map;
  if (workspaceScheduleMap) {
    cachedWorkspaceScheduleMap = workspaceScheduleMap;
  }
}

export function resetScheduleRunsCacheForTesting(): void {
  cachedSchedulesById = new Map();
  cachedWorkspaceScheduleMap = {};
  cachedProjectLastActiveByKey = {};
  cachedTotals = {
    totalSchedules: 0,
    schedulesWithRuns: 0,
    totalRuns: 0,
    succeededRuns: 0,
    failedRuns: 0,
    runningRuns: 0,
  };
  lastFetchMs = 0;
  lastFetchAttemptMs = 0;
}

function ensurePaseoCadenceStyles(doc: MinimalScheduleDomDocument): boolean {
  const hoverStyle = doc.getElementById("paseo-finder-sidebar-ts-style");
  if (!hoverStyle && typeof document !== "undefined" && doc === (document as unknown)) {
    const headEl = document.head ?? document.body;
    if (headEl) {
      const styleEl = document.createElement("style");
      styleEl.id = "paseo-finder-sidebar-ts-style";
      styleEl.setAttribute("data-finder-runs-injected", "true");
      styleEl.textContent = `
[data-testid^="sidebar-project-row-"]:hover [data-testid^="sidebar-project-timestamp-"] {
  opacity: 0 !important;
}
@keyframes paseoCadenceBadgeBreathe {
  0%, 100% {
    opacity: 0.65;
    transform: scale(0.96);
  }
  50% {
    opacity: 1;
    transform: scale(1.06);
  }
}
[data-testid^="sidebar-workspace-cadence-badge-"][data-running="true"],
[data-testid^="workspace-header-cadence-badge-"][data-running="true"] {
  animation: paseoCadenceBadgeBreathe 2s ease-in-out infinite;
}
`;
      headEl.appendChild(styleEl);
      return true;
    }
  }
  return false;
}

export function decorateSchedulesDomOnDocument(
  doc: MinimalScheduleDomDocument,
  options: DecorateSchedulesDomOptions,
): { rowCount: number; domWrites: number } {
  if (options.schedulesById && options.schedulesById.size > 0) {
    for (const [id, s] of options.schedulesById.entries()) {
      cachedSchedulesById.set(id, s as ScheduleRunsSummary);
    }
  }
  const copy = options.isZh ? COPY_ZH : COPY_EN;
  const theme = options.theme;
  const themeKey = theme?.name ?? "default";
  const nowMs = options.nowMs ?? Date.now();
  const minuteBucket = Math.floor(nowMs / 60_000);
  const elapsedBucket = Math.floor(nowMs / 15_000);
  let domWrites = 0;

  if (ensurePaseoCadenceStyles(doc)) {
    domWrites += 1;
  }

  // Decorate left-sidebar project folder rows (`sidebar-project-row-<viewKey>`) with compact relative age (`18h`, `2d`)
  const projMap = options.projectLastActiveByKey;
  if (projMap && Object.keys(projMap).length > 0) {
    const projectRows = doc.querySelectorAll<MinimalScheduleDomElement>(
      '[data-testid^="sidebar-project-row-"]',
    );
    if (projectRows && projectRows.length > 0) {
      for (let p = 0; p < projectRows.length; p += 1) {
        const projRow = projectRows[p];
        if (!projRow) continue;
        const projTestId = projRow.getAttribute("data-testid") ?? "";
        const viewKey = projTestId.replace(/^sidebar-project-row-/, "").trim();
        if (!viewKey) continue;
        const iso = projMap[viewKey] ?? null;
        const ageText = formatCompactSidebarAge(iso, nowMs);
        if (!ageText) continue;

        let tsBadge = projRow.querySelector<MinimalScheduleDomElement>(
          `[data-testid="sidebar-project-timestamp-${viewKey}"]`,
        );
        if (!tsBadge) {
          tsBadge = doc.createElement("span");
          tsBadge.setAttribute(
            "data-testid",
            `sidebar-project-timestamp-${viewKey}`,
          );
          tsBadge.setAttribute("data-finder-runs-injected", "true");
          if (!projRow.style.position) {
            projRow.style.position = "relative";
          }
          projRow.appendChild(tsBadge);
          domWrites += 1;
        }
        const projSig = `${themeKey}:${minuteBucket}:${ageText}`;
        if (tsBadge.getAttribute("data-finder-proj-ts-sig") !== projSig) {
          tsBadge.setAttribute("data-finder-proj-ts-sig", projSig);
          if (setTextContentIfChanged(tsBadge, ageText)) {
            domWrites += 1;
          }
          tsBadge.title = iso
            ? `${formatAntigravityRunTimestamp(iso, { nowMs, isZh: options.isZh })} (${iso})`
            : ageText;
          Object.assign(tsBadge.style, {
            position: "absolute",
            right: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: "12px",
            lineHeight: "20px",
            fontWeight: "400",
            color: theme ? theme.foregroundMuted : "#9ca3af",
            opacity: "0.75",
            pointerEvents: "none",
            userSelect: "none",
            transition: "opacity 120ms ease",
          });
        }
      }
    }
  }

  // Decorate left-sidebar workspace rows with small stopwatch/clock cadence badge
  const workspaceRows = doc.querySelectorAll<MinimalScheduleDomElement>(
    '[data-testid^="sidebar-workspace-row-"]',
  );
  if (workspaceRows && workspaceRows.length > 0) {
    for (let w = 0; w < workspaceRows.length; w += 1) {
      const rowEl = workspaceRows[w];
      if (!rowEl) continue;
      const testId = rowEl.getAttribute("data-testid") ?? "";
      const parsed = parseSidebarWorkspaceRowTestId(testId);
      if (!parsed?.workspaceId) continue;
      const cleanWorkspaceId = parsed.workspaceId;
      const titleEl = findSidebarRowTitleElement(
        rowEl as unknown as MinimalElement,
        parsed.workspaceKey,
      ) as MinimalScheduleDomElement | null;
      const rowTitleText = (titleEl?.textContent ?? "").trim();

      const sched = resolveCadenceSchedule(
        cleanWorkspaceId,
        rowTitleText,
        options,
      );

      const existingBadge = rowEl.querySelector<MinimalScheduleDomElement>(
        `[data-testid="sidebar-workspace-cadence-badge-${cleanWorkspaceId}"]`,
      );

      if (!sched) {
        if (existingBadge) {
          existingBadge.remove?.();
          domWrites += 1;
        }
        continue;
      }

      const isInWorkingGroup = Boolean(
        rowEl.closest?.('[data-testid*="working"]') ||
        rowEl.closest?.('[data-testid^="sidebar-status-group-rows-working"]') ||
        rowEl.closest?.('[data-testid*="running"]') ||
        rowEl.closest?.('[data-testid^="sidebar-status-group-rows-running"]') ||
        (rowEl.parentElement &&
          ((rowEl.parentElement.getAttribute("data-testid") ?? "").includes("working") ||
           (rowEl.parentElement.getAttribute("data-testid") ?? "").includes("running"))) ||
        rowEl.querySelector?.('[data-testid*="status-indicator-running"]') ||
        rowEl.querySelector?.('[data-testid="project-status-badge"][aria-label*="Working" i]') ||
        rowEl.querySelector?.('[data-testid="project-status-badge"][aria-label*="Running" i]') ||
        rowEl.querySelector?.('[data-testid="project-status-badge"][aria-label*="工作中"]') ||
        rowEl.querySelector?.('[data-testid="project-status-badge"][aria-label*="进行中"]') ||
        rowEl.querySelector?.('[role="status"][aria-label*="Working" i]') ||
        rowEl.querySelector?.('[role="status"][aria-label*="Running" i]') ||
        rowEl.querySelector?.('[role="status"][aria-label*="工作中"]') ||
        rowEl.querySelector?.('[role="status"][aria-label*="进行中"]'),
      );

      const metaForWs =
        (cleanWorkspaceId && cachedWorkspaceScheduleMap[cleanWorkspaceId]) ||
        (testId && cachedWorkspaceScheduleMap[testId]) ||
        null;
      const isWorkspaceExplicitlyFinished =
        metaForWs &&
        !metaForWs.isRunning &&
        metaForWs.runStatus &&
        metaForWs.runStatus !== "running" &&
        !isInWorkingGroup;

      const isRunning = isWorkspaceExplicitlyFinished
        ? false
        : Boolean(
            isInWorkingGroup ||
            (metaForWs && metaForWs.isRunning) ||
            (sched.runningRuns && sched.runningRuns > 0) ||
            sched.lastRunStatus === "running",
          );
      const runningElapsedSec = isRunning
        ? findRunningCadenceElapsedSec(sched, cleanWorkspaceId, nowMs)
        : null;
      const runningElapsedText = formatRunningCadenceElapsed(
        runningElapsedSec,
        options.isZh,
      );
      const schedStatus = sched.status ?? "active";
      const lastStatus = sched.lastRunStatus ?? "none";
      const schedDisplayName = (sched.name ?? "").trim();
      const cadenceSig = `${cleanWorkspaceId}:${sched.id}:${schedDisplayName}:${themeKey}:${schedStatus}:${lastStatus}:${isRunning ? 1 : 0}:${options.isZh ? "zh" : "en"}:${runningElapsedText ? `${elapsedBucket}:${runningElapsedText}` : "no-elapsed"}`;

      let badge = existingBadge;
      if (!badge) {
        badge = doc.createElement("span");
        badge.setAttribute(
          "data-testid",
          `sidebar-workspace-cadence-badge-${cleanWorkspaceId}`,
        );
        badge.setAttribute("data-finder-runs-injected", "true");
        badge.setAttribute("role", "button");
        badge.setAttribute("tabindex", "0");
        if (titleEl && titleEl.parentElement) {
          titleEl.parentElement.insertBefore(badge, titleEl);
        } else {
          rowEl.appendChild(badge);
        }
        domWrites += 1;
      }

      if (badge.getAttribute("data-finder-cadence-sig") !== cadenceSig) {
        badge.setAttribute("data-finder-cadence-sig", cadenceSig);
        if (!badge.hasAttribute("data-finder-svg-mounted")) {
          badge.innerHTML = CADENCE_TIMER_SVG;
          badge.setAttribute("data-finder-svg-mounted", "1");
        }
        const schedName = schedDisplayName || sched.id || "Cadence";
        badge.title = options.isZh
          ? (isRunning
              ? `定时任务节奏: ${schedName} (运行中${runningElapsedText ? ` · 已耗时 ${runningElapsedText}` : ""}) · 单击查看运行记录，Alt+单击立即运行`
              : `定时任务节奏: ${schedName} · 单击查看运行记录，Alt+单击立即运行`)
          : (isRunning
              ? `Cadence: ${schedName} (Running${runningElapsedText ? ` · ${runningElapsedText} elapsed` : ""}) · Click to view history, Alt+Click to run now`
              : `Cadence: ${schedName} · Click to view history, Alt+Click to run now`);
        badge.setAttribute("data-running", isRunning ? "true" : "false");
        Object.assign(badge.style, {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "13px",
          height: "13px",
          marginRight: "4px",
          flexShrink: "0",
          alignSelf: "center",
          verticalAlign: "middle",
          cursor: "pointer",
          userSelect: "none",
          transformOrigin: "center",
          color: isRunning
            ? ((theme?.colorScheme ?? "light") === "light" ? "#059669" : "#10b981")
            : (theme?.foregroundMuted ?? "#9ca3af"),
          opacity: isRunning ? "1" : "0.75",
          animation: isRunning
            ? "paseoCadenceBadgeBreathe 2s ease-in-out infinite"
            : "none",
          transition: "opacity 120ms ease, color 120ms ease, transform 120ms ease",
        });
        domWrites += 1;
      }

      if (!badge.hasAttribute("data-finder-cadence-bound")) {
        badge.setAttribute("data-finder-cadence-bound", "1");
        badge.addEventListener("mouseenter", () => {
          badge.style.opacity = "1";
        });
        badge.addEventListener("mouseleave", () => {
          const currentlyRunning = badge.getAttribute("data-running") === "true";
          badge.style.opacity = currentlyRunning ? "1" : "0.75";
        });
        const stopEv = (e: unknown) => {
          const me = e as {
            stopPropagation?: () => void;
            preventDefault?: () => void;
          };
          me.stopPropagation?.();
          me.preventDefault?.();
        };
        badge.addEventListener("pointerdown", stopEv);
        badge.addEventListener("mousedown", stopEv);
        badge.addEventListener("click", (e) => {
          const me = e as {
            stopPropagation?: () => void;
            preventDefault?: () => void;
            altKey?: boolean;
          };
          me.stopPropagation?.();
          me.preventDefault?.();
          if (me.altKey) {
            if (options.onRunNow) {
              void options.onRunNow(sched.id);
            }
          } else {
            options.onOpenDrawer(sched.id);
          }
        });
        badge.addEventListener("keydown", (e) => {
          const ke = e as {
            key?: string;
            stopPropagation?: () => void;
            preventDefault?: () => void;
            altKey?: boolean;
          };
          if (ke.key === "Enter" || ke.key === " ") {
            ke.stopPropagation?.();
            ke.preventDefault?.();
            if (ke.altKey) {
              if (options.onRunNow) {
                void options.onRunNow(sched.id);
              }
            } else {
              options.onOpenDrawer(sched.id);
            }
          }
        });
        domWrites += 1;
      }
    }
  }

  // Also decorate top active workspace header title (`workspace-header-title`) with cadence badge
  const headerTitleEl = findVisibleHeaderTitleElement(doc);
  if (headerTitleEl && headerTitleEl.parentElement) {
    const rawHeaderTitle = (headerTitleEl.textContent ?? "").trim();
    let activeWsId = "";
    if (typeof window !== "undefined") {
      const match = (window.location?.pathname ?? "").match(/\/workspace\/([^/?#]+)/);
      if (match?.[1]) {
        try {
          activeWsId = decodeURIComponent(match[1]).replace(/^(?:local|srv_[^:]+):/, "").trim();
        } catch {
          activeWsId = match[1].replace(/^(?:local|srv_[^:]+):/, "").trim();
        }
      }
    }
    if (!activeWsId) {
      const selectedRow = doc.querySelector<MinimalScheduleDomElement>(
        '[data-testid^="sidebar-workspace-row-"][aria-selected="true"]',
      );
      if (selectedRow) {
        const selTid = selectedRow.getAttribute("data-testid") ?? "";
        const parsed = parseSidebarWorkspaceRowTestId(selTid);
        if (parsed?.workspaceId) {
          activeWsId = parsed.workspaceId.replace(/^(?:local|srv_[^:]+):/, "").trim();
        }
      }
    }

    const sched = resolveCadenceSchedule(activeWsId, rawHeaderTitle, options);
    const existingHeaderBadge = headerTitleEl.parentElement.querySelector<MinimalScheduleDomElement>(
      '[data-testid^="workspace-header-cadence-badge-"]',
    );

    if (!sched) {
      if (existingHeaderBadge) {
        existingHeaderBadge.remove?.();
        domWrites += 1;
      }
    } else {
      const isHeaderActiveTurnRunning = Boolean(
        doc.querySelector?.('[data-testid="agent-turn-stop"]') ||
        doc.querySelector?.('button[aria-label*="Stop" i]') ||
        doc.querySelector?.('[role="button"][aria-label*="Stop" i]') ||
        doc.querySelector?.('[role="button"][aria-label*="Canceling" i]') ||
        doc.querySelector?.('[role="button"][aria-label*="停止"]') ||
        doc.querySelector?.('[data-testid="turn-status-running"]') ||
        (doc.querySelector?.('[data-testid^="sidebar-workspace-row-"][aria-selected="true"]')?.closest?.('[data-testid*="working"]')) ||
        (doc.querySelector?.('[data-testid^="sidebar-workspace-row-"][aria-selected="true"]')?.closest?.('[data-testid*="running"]')) ||
        (doc.querySelector?.('[data-testid^="sidebar-workspace-row-"][aria-selected="true"]')?.querySelector?.('[data-testid*="status-indicator-running"]')) ||
        (doc.querySelector?.('[data-testid^="sidebar-workspace-row-"][aria-selected="true"]')?.querySelector?.('[data-testid="project-status-badge"][aria-label*="Working" i]')) ||
        (doc.querySelector?.('[data-testid^="sidebar-workspace-row-"][aria-selected="true"]')?.querySelector?.('[data-testid="project-status-badge"][aria-label*="Running" i]')) ||
        (doc.querySelector?.('[data-testid^="sidebar-workspace-row-"][aria-selected="true"]')?.querySelector?.('[data-testid="project-status-badge"][aria-label*="工作中"]')) ||
        (doc.querySelector?.('[data-testid^="sidebar-workspace-row-"][aria-selected="true"]')?.querySelector?.('[data-testid="project-status-badge"][aria-label*="进行中"]')),
      );

      const metaForHeaderWs =
        (activeWsId && cachedWorkspaceScheduleMap[activeWsId]) || null;
      const isHeaderWsExplicitlyFinished =
        metaForHeaderWs &&
        !metaForHeaderWs.isRunning &&
        metaForHeaderWs.runStatus &&
        metaForHeaderWs.runStatus !== "running" &&
        !isHeaderActiveTurnRunning;

      const isRunning = isHeaderWsExplicitlyFinished
        ? false
        : Boolean(
            isHeaderActiveTurnRunning ||
            (metaForHeaderWs && metaForHeaderWs.isRunning) ||
            (sched.runningRuns && sched.runningRuns > 0) ||
            sched.lastRunStatus === "running",
          );
      const headerRunningElapsedSec = isRunning
        ? findRunningCadenceElapsedSec(sched, activeWsId, nowMs)
        : null;
      const headerRunningElapsedText = formatRunningCadenceElapsed(
        headerRunningElapsedSec,
        options.isZh,
      );
      const schedStatus = sched.status ?? "active";
      const lastStatus = sched.lastRunStatus ?? "none";
      const schedDisplayName = (sched.name ?? "").trim();
      const badgeTestId = `workspace-header-cadence-badge-${sched.id}`;
      const headerCadenceSig = `${sched.id}:${schedDisplayName}:${themeKey}:${schedStatus}:${lastStatus}:${isRunning ? 1 : 0}:${options.isZh ? "zh" : "en"}:${headerRunningElapsedText ? `${elapsedBucket}:${headerRunningElapsedText}` : "no-elapsed"}`;

      let badge = existingHeaderBadge;
      if (!badge || badge.getAttribute("data-testid") !== badgeTestId) {
        if (badge) {
          badge.remove?.();
          domWrites += 1;
        }
        badge = doc.createElement("span");
        badge.setAttribute("data-testid", badgeTestId);
        badge.setAttribute("data-finder-runs-injected", "true");
        badge.setAttribute("role", "button");
        badge.setAttribute("tabindex", "0");
        headerTitleEl.parentElement.insertBefore(badge, headerTitleEl);
        domWrites += 1;
      }

      if (badge.getAttribute("data-finder-header-cadence-sig") !== headerCadenceSig) {
        badge.setAttribute("data-finder-header-cadence-sig", headerCadenceSig);
        if (!badge.hasAttribute("data-finder-svg-mounted")) {
          badge.innerHTML = CADENCE_TIMER_SVG;
          badge.setAttribute("data-finder-svg-mounted", "1");
        }
        const schedName = schedDisplayName || sched.id || "Cadence";
        badge.title = options.isZh
          ? (isRunning
              ? `定时任务节奏: ${schedName} (运行中${headerRunningElapsedText ? ` · 已耗时 ${headerRunningElapsedText}` : ""}) · 单击查看运行记录，Alt+单击立即运行`
              : `定时任务节奏: ${schedName} · 单击查看运行记录，Alt+单击立即运行`)
          : (isRunning
              ? `Cadence: ${schedName} (Running${headerRunningElapsedText ? ` · ${headerRunningElapsedText} elapsed` : ""}) · Click to view history, Alt+Click to run now`
              : `Cadence: ${schedName} · Click to view history, Alt+Click to run now`);
        badge.setAttribute("data-running", isRunning ? "true" : "false");
        Object.assign(badge.style, {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "15px",
          height: "15px",
          marginRight: "6px",
          flexShrink: "0",
          verticalAlign: "middle",
          cursor: "pointer",
          userSelect: "none",
          transformOrigin: "center",
          color: isRunning
            ? ((theme?.colorScheme ?? "light") === "light" ? "#059669" : "#10b981")
            : (theme?.foregroundMuted ?? "#9ca3af"),
          opacity: isRunning ? "1" : "0.85",
          animation: isRunning
            ? "paseoCadenceBadgeBreathe 2s ease-in-out infinite"
            : "none",
          transition: "opacity 120ms ease, color 120ms ease, transform 120ms ease",
        });
        domWrites += 1;
      }

      if (!badge.hasAttribute("data-finder-cadence-bound")) {
        badge.setAttribute("data-finder-cadence-bound", "1");
        badge.addEventListener("mouseenter", () => {
          badge.style.opacity = "1";
        });
        badge.addEventListener("mouseleave", () => {
          const currentlyRunning = badge.getAttribute("data-running") === "true";
          badge.style.opacity = currentlyRunning ? "1" : "0.85";
        });
        const stopEv = (e: unknown) => {
          const me = e as {
            stopPropagation?: () => void;
            preventDefault?: () => void;
          };
          me.stopPropagation?.();
          me.preventDefault?.();
        };
        badge.addEventListener("pointerdown", stopEv);
        badge.addEventListener("mousedown", stopEv);
        badge.addEventListener("click", (e) => {
          const me = e as {
            stopPropagation?: () => void;
            preventDefault?: () => void;
            altKey?: boolean;
          };
          me.stopPropagation?.();
          me.preventDefault?.();
          if (me.altKey) {
            if (options.onRunNow) {
              void options.onRunNow(sched.id);
            }
          } else {
            options.onOpenDrawer(sched.id);
          }
        });
        badge.addEventListener("keydown", (e) => {
          const ke = e as {
            key?: string;
            stopPropagation?: () => void;
            preventDefault?: () => void;
            altKey?: boolean;
          };
          if (ke.key === "Enter" || ke.key === " ") {
            ke.stopPropagation?.();
            ke.preventDefault?.();
            if (ke.altKey) {
              if (options.onRunNow) {
                void options.onRunNow(sched.id);
              }
            } else {
              options.onOpenDrawer(sched.id);
            }
          }
        });
        domWrites += 1;
      }
    }
  }

  const rows = doc.querySelectorAll<MinimalScheduleDomElement>(
    '[data-testid^="schedule-row-"]',
  );
  if (!rows || rows.length === 0) {
    return { rowCount: 0, domWrites };
  }

  // Mount `#paseo-finder-all-runs-toolbar` safely inside `[data-testid="schedules-table"]`
  // (never via `tableEl.parentElement.insertBefore`, which collides with host sibling reconciliation
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
          ? `共 ${options.totals.totalSchedules} 个定时任务 · ${options.totals.schedulesWithRuns} 个有运行记录，累计 ${options.totals.totalRuns} 次运行，点击行内运行徽章查看详情与对话`
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

  // Mount Antigravity-style column header (`Scheduled` | `Next run` | `Last run` | `Status & Runs`)
  let colHeader = doc.getElementById("paseo-finder-schedules-col-header");
  if (tableEl && !colHeader) {
    colHeader = doc.createElement("div");
    colHeader.id = "paseo-finder-schedules-col-header";
    colHeader.setAttribute("data-testid", "schedules-col-header");
    colHeader.setAttribute("data-finder-runs-injected", "true");
    Object.assign(colHeader.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "6px 14px",
      marginBottom: "4px",
      fontSize: "11px",
      fontWeight: "600",
      letterSpacing: "0.02em",
      color: theme ? theme.foregroundMuted : "#9ca3af",
      borderBottom: theme
        ? `1px solid ${theme.border}`
        : "1px solid rgba(156, 163, 175, 0.16)",
      userSelect: "none",
    });

    const leftColLabel = doc.createElement("span");
    leftColLabel.id = "paseo-finder-col-header-scheduled";
    leftColLabel.setAttribute("data-finder-runs-injected", "true");
    Object.assign(leftColLabel.style, {
      flex: "1",
      minWidth: "0",
    });
    colHeader.appendChild(leftColLabel);

    const rightColsGroup = doc.createElement("div");
    rightColsGroup.setAttribute("data-finder-runs-injected", "true");
    Object.assign(rightColsGroup.style, {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      flexShrink: "0",
    });

    const nextColLabel = doc.createElement("span");
    nextColLabel.id = "paseo-finder-col-header-next";
    nextColLabel.setAttribute("data-finder-runs-injected", "true");
    Object.assign(nextColLabel.style, {
      width: "140px",
      textAlign: "left",
    });
    rightColsGroup.appendChild(nextColLabel);

    const lastColLabel = doc.createElement("span");
    lastColLabel.id = "paseo-finder-col-header-last";
    lastColLabel.setAttribute("data-finder-runs-injected", "true");
    Object.assign(lastColLabel.style, {
      width: "140px",
      textAlign: "left",
    });
    rightColsGroup.appendChild(lastColLabel);

    const statusColLabel = doc.createElement("span");
    statusColLabel.id = "paseo-finder-col-header-status";
    statusColLabel.setAttribute("data-finder-runs-injected", "true");
    Object.assign(statusColLabel.style, {
      width: "184px",
      textAlign: "right",
      paddingRight: "4px",
    });
    rightColsGroup.appendChild(statusColLabel);

    colHeader.appendChild(rightColsGroup);
    // Insert right after `#paseo-finder-all-runs-toolbar` (or as first child if no toolbar)
    const rowsCardEl = rows[0]?.parentElement ?? null;
    if (rowsCardEl && rowsCardEl.parentElement === tableEl) {
      tableEl.insertBefore(colHeader, rowsCardEl);
    } else {
      tableEl.appendChild(colHeader);
    }
    domWrites += 1;
  }

  if (colHeader) {
    const colHeaderSig = `${options.isZh ? "zh" : "en"}:${themeKey}`;
    if (colHeader.getAttribute("data-finder-col-header-sig") !== colHeaderSig) {
      colHeader.setAttribute("data-finder-col-header-sig", colHeaderSig);
      if (theme) {
        colHeader.style.color = theme.foregroundMuted;
        colHeader.style.borderBottom = `1px solid ${theme.border}`;
      }
      const schedLbl = doc.getElementById("paseo-finder-col-header-scheduled");
      const nextLbl = doc.getElementById("paseo-finder-col-header-next");
      const lastLbl = doc.getElementById("paseo-finder-col-header-last");
      const statusLbl = doc.getElementById("paseo-finder-col-header-status");
      if (
        schedLbl &&
        setTextContentIfChanged(
          schedLbl,
          options.isZh ? "定时任务" : "Scheduled",
        )
      ) {
        domWrites += 1;
      }
      if (
        nextLbl &&
        setTextContentIfChanged(nextLbl, options.isZh ? "下次运行" : "Next run")
      ) {
        domWrites += 1;
      }
      if (
        lastLbl &&
        setTextContentIfChanged(lastLbl, options.isZh ? "上次运行" : "Last run")
      ) {
        domWrites += 1;
      }
      if (
        statusLbl &&
        setTextContentIfChanged(
          statusLbl,
          options.isZh ? "状态与历史" : "Status & Runs",
        )
      ) {
        domWrites += 1;
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
    const nextRunIso = summary?.nextRunAt ?? null;
    const lastRunIso = summary?.lastRunAt ?? null;
    const schedStatus = summary?.status ?? "active";

    const kebab = row.querySelector<MinimalScheduleDomElement>(
      `[data-testid="schedule-kebab-${scheduleId}"]`,
    );
    const trailingGroup =
      kebab && kebab.parentElement && kebab.parentElement !== row
        ? kebab.parentElement
        : null;

    let timeCols = row.querySelector<MinimalScheduleDomElement>(
      `[data-testid="schedule-time-cols-${scheduleId}"]`,
    );
    if (!timeCols) {
      timeCols = doc.createElement("div");
      timeCols.setAttribute("data-testid", `schedule-time-cols-${scheduleId}`);
      timeCols.setAttribute("data-finder-runs-injected", "true");
      Object.assign(timeCols.style, {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        flexShrink: "0",
        marginRight: "4px",
      });

      const nextCol = doc.createElement("span");
      nextCol.setAttribute(
        "data-testid",
        `schedule-next-run-col-${scheduleId}`,
      );
      nextCol.setAttribute("data-finder-runs-injected", "true");
      Object.assign(nextCol.style, {
        width: "140px",
        fontSize: "13px",
        lineHeight: "18px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textAlign: "left",
      });
      timeCols.appendChild(nextCol);

      const lastCol = doc.createElement("span");
      lastCol.setAttribute(
        "data-testid",
        `schedule-last-run-col-${scheduleId}`,
      );
      lastCol.setAttribute("data-finder-runs-injected", "true");
      Object.assign(lastCol.style, {
        width: "140px",
        fontSize: "13px",
        lineHeight: "18px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textAlign: "left",
        cursor: "pointer",
      });
      lastCol.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        options.onOpenDrawer(scheduleId);
      });
      timeCols.appendChild(lastCol);

      if (trailingGroup) {
        trailingGroup.style.minWidth = "184px";
        trailingGroup.style.justifyContent = "flex-end";
        row.insertBefore(timeCols, trailingGroup);
      } else if (kebab && kebab.parentElement === row) {
        row.insertBefore(timeCols, kebab);
      } else {
        row.appendChild(timeCols);
      }
      domWrites += 1;
    }

    const timeColsSig = `${options.isZh ? "zh" : "en"}:${themeKey}:${minuteBucket}:${schedStatus}:${nextRunIso ?? ""}:${lastRunIso ?? ""}`;
    if (timeCols.getAttribute("data-finder-time-cols-sig") !== timeColsSig) {
      timeCols.setAttribute("data-finder-time-cols-sig", timeColsSig);
      const nextColEl = timeCols.querySelector<MinimalScheduleDomElement>(
        `[data-testid="schedule-next-run-col-${scheduleId}"]`,
      );
      const lastColEl = timeCols.querySelector<MinimalScheduleDomElement>(
        `[data-testid="schedule-last-run-col-${scheduleId}"]`,
      );
      if (nextColEl) {
        const nextText =
          schedStatus === "paused" && !nextRunIso
            ? options.isZh
              ? "已暂停"
              : "Paused"
            : formatAntigravityRunTimestamp(nextRunIso, {
                nowMs,
                isZh: options.isZh,
                emptyLabel: "—",
              });
        if (setTextContentIfChanged(nextColEl, nextText)) {
          domWrites += 1;
        }
        nextColEl.title = nextRunIso
          ? `Next run: ${nextText} (${nextRunIso})`
          : nextText;
        nextColEl.style.color = theme ? theme.foregroundMuted : "#9ca3af";
      }
      if (lastColEl) {
        const lastText = formatAntigravityRunTimestamp(lastRunIso, {
          nowMs,
          isZh: options.isZh,
          emptyLabel: options.isZh ? "从未运行" : "Never run",
        });
        if (setTextContentIfChanged(lastColEl, lastText)) {
          domWrites += 1;
        }
        lastColEl.title = lastRunIso
          ? `Last run: ${lastText} (${formatRelativeIso(lastRunIso)} · ${lastRunIso})`
          : lastText;
        lastColEl.style.color = theme
          ? lastRunIso
            ? theme.foreground
            : theme.foregroundMuted
          : lastRunIso
            ? "#e5e7eb"
            : "#9ca3af";
      }
    }

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
      const nextPillText = `${copy.runsPillPrefix} (${runCount})`;
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
  const sidebarProj = makeNode("div", {
    "data-testid": "sidebar-project-row-proj_alpha",
  });
  body.appendChild(sidebarProj);
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
        lastRunAt: new Date(started - 3600_000).toISOString(),
        lastRunStatus: "succeeded",
        nextRunAt: new Date(started + 3600_000).toISOString(),
        runs: [],
      },
    ],
  ]);

  const opts: DecorateSchedulesDomOptions = {
    schedulesById: schedulesMap,
    projectLastActiveByKey: {
      proj_alpha: new Date(started - 7200_000).toISOString(),
    },
    totals: { totalSchedules: 3, schedulesWithRuns: 1, totalRuns: 5 },
    isZh: false,
    nowMs: started,
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
        maxRunsPerSchedule: 12,
        compactSummary: true,
      });
      if (res.ok) {
        const nextMap = new Map<string, ScheduleRunsSummary>();
        for (const item of res.schedules) {
          nextMap.set(item.id, item);
        }
        cachedSchedulesById = nextMap;
        cachedWorkspaceScheduleMap = res.workspaceScheduleMap ?? {};
        cachedProjectLastActiveByKey = res.projectLastActiveByKey ?? {};
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
      closeBtn.textContent = "×";
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
      closeBtn.textContent = "×";
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
  activeScheduleRunsClient = client;
  activeShowToast = showToast ?? null;

  let observer: MutationObserver | null = null;
  let rafId: number | null = null;
  let fallbackTimerId: number | null = null;
  let isDecorating = false;

  const removeInjectedScheduleNodes = () => {
    document
      .querySelectorAll(
        '#paseo-finder-all-runs-toolbar, #paseo-finder-schedules-col-header, #paseo-finder-sidebar-ts-style, #paseo-finder-cadence-toast, [data-testid^="schedule-runs-pill-"], [data-testid^="schedule-time-cols-"], [data-testid^="sidebar-project-timestamp-"], [data-testid^="sidebar-workspace-cadence-badge-"], [data-testid^="workspace-header-cadence-badge-"], [data-testid^="schedule-menu-runs-"]',
      )
      .forEach((el) => el.remove());
    observer?.takeRecords();
  };

  ensurePaseoSidebarTimestampSetting();

  // Coalesced, idempotent, circuit-breaker-guarded Schedules DOM decoration.
  // Never mutates `.textContent` unconditionally inside a synchronous MutationObserver microtask!
  const decorateSchedulesDom = () => {
    if (isDecorating) return;
    const prefs = readScheduleRunsPreferences();
    if (!prefs.enabled || domHealthState.circuitBreakerTripped) {
      return;
    }

    const rowsProbe = document.querySelector('[data-testid^="schedule-row-"]');
    const sidebarProbe = document.querySelector(
      '[data-testid^="sidebar-project-row-"]',
    );
    const workspaceProbe = document.querySelector(
      '[data-testid^="sidebar-workspace-row-"]',
    );
    const headerProbe = document.querySelector(
      '[data-testid="workspace-header-title"]',
    );
    if (!rowsProbe && !sidebarProbe && !workspaceProbe && !headerProbe) {
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
          projectLastActiveByKey: cachedProjectLastActiveByKey,
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
          onRunNow: (scheduleId) => {
            void triggerRunScheduleNow(scheduleId, client, showToast);
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
  scheduleDecoratePass();
  const interval = window.setInterval(() => {
    if (readScheduleRunsPreferences().enabled && !domHealthState.circuitBreakerTripped) {
      decorateSchedulesDom();
    }
  }, 3000);
  const cachePollInterval = window.setInterval(() => {
    if (readScheduleRunsPreferences().enabled && !domHealthState.circuitBreakerTripped) {
      void refreshScheduleCache(client, false).then(() => scheduleDecoratePass());
    }
  }, 12_000);
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
    window.clearInterval(cachePollInterval);
    if (activeDrawerCleanup) activeDrawerCleanup();
    globalOpenScheduleRunsDrawer = null;
    globalReconnectAndRefreshEnhancer = null;
    globalCleanupInjectedScheduleNodes = null;
    activeScheduleRunsClient = null;
    activeShowToast = null;
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
  statusBadge.textContent = isOk ? "•" : isFail ? "!" : "·";
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
