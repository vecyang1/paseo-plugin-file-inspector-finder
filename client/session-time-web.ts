/// <reference lib="dom" />
import { isChineseLocale } from "./i18n";

export type SessionTimeClockFormat = "24h" | "12h";

export interface SessionTimePreferences {
  enabled: boolean;
  clockFormat: SessionTimeClockFormat;
  showFinishedTimeInSidebar: boolean;
  showRelativeAgeInTurnFooter: boolean;
  sourceBadge: "plugin-settings" | "localStorage" | "default";
}

export interface UserTimezoneInfo {
  timeZone: string;
  offsetMinutes: number;
  offsetLabel: string;
}

export interface SessionTimeHealthSnapshot {
  enabled: boolean;
  clockFormat: SessionTimeClockFormat;
  showFinishedTimeInSidebar: boolean;
  showRelativeAgeInTurnFooter: boolean;
  sourceBadge: "plugin-settings" | "localStorage" | "default";
  timeZone: string;
  offsetLabel: string;
  metroHookInstalled: boolean;
  hookedModules: string[];
  trackedTurnTimingsCount: number;
  turnFootersDecorated: number;
  sidebarTimestampsDecorated: number;
  commandCenterTimestampsDecorated: number;
  agentRowsDecorated: number;
  lastPassIso: string | null;
}

export interface SessionTimeSelfTestResult {
  ok: boolean;
  timeZone: string;
  offsetLabel: string;
  sameDaySample: string;
  crossDaySample: string;
  turnFooterSample: string;
  sidebarCompactSample: string;
  proseRelativeSample: string;
  durationMs: number;
  summary: string;
}

export const SESSION_TIME_STORAGE_KEY = "paseo:finder-plugin:session-time-config";
export const SESSION_TIME_EVENT = "paseo-finder:session-time-updated";
const STYLE_ELEMENT_ID = "paseo-finder-session-time-styles";

const EN_SHORT_MONTHS = [
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

let activePrefs: SessionTimePreferences = {
  enabled: true,
  clockFormat: "24h",
  showFinishedTimeInSidebar: true,
  showRelativeAgeInTurnFooter: true,
  sourceBadge: "default",
};

const durationMsToCompletedAt = new Map<number, Date>();
const compactLabelToDate = new Map<string, Date>();
let lastCompactInputDate: Date | null = null;
let lastFormattedMessageDate: Date | null = null;
let activeTurnFooterRenderContext: {
  durationMs?: number | null;
  completedAt?: Date | null;
  lastDurationLabel?: string;
} | null = null;

const healthState = {
  metroHookInstalled: false,
  hookedModules: new Set<string>(),
  turnFootersDecorated: 0,
  sidebarTimestampsDecorated: 0,
  commandCenterTimestampsDecorated: 0,
  agentRowsDecorated: 0,
  lastPassIso: null as string | null,
};

let globalRefreshDomFn: (() => void) | null = null;

function dispatchSessionTimeEvent(): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_TIME_EVENT));
  } catch {
    // ignore
  }
}

export function getUserTimezoneInfo(now: Date = new Date()): UserTimezoneInfo {
  let timeZone = "Local";
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved && typeof resolved === "string") {
      timeZone = resolved;
    }
  } catch {
    timeZone = "Local";
  }
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMins = Math.abs(offsetMinutes);
  const hours = Math.floor(absMins / 60);
  const mins = absMins % 60;
  const offsetLabel =
    mins === 0
      ? `GMT${sign}${hours}`
      : `GMT${sign}${hours}:${String(mins).padStart(2, "0")}`;

  return {
    timeZone,
    offsetMinutes,
    offsetLabel,
  };
}

export function coerceToValidDate(
  input: Date | string | number | null | undefined,
): Date | null {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input <= 0) return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatClockPart(
  date: Date,
  clockFormat: SessionTimeClockFormat = activePrefs.clockFormat,
): string {
  const hours = date.getHours();
  const mins = String(date.getMinutes()).padStart(2, "0");
  if (clockFormat === "12h") {
    const h12 = hours % 12 || 12;
    const ampm = hours >= 12 ? "PM" : "AM";
    return `${h12}:${mins} ${ampm}`;
  }
  return `${String(hours).padStart(2, "0")}:${mins}`;
}

/**
 * Formats a finished timestamp concisely in the user's local timezone:
 * - Same local calendar day: `HH:mm` (e.g. `01:38`, or `1:38 AM` in 12h mode)
 * - Different day in the same year: `MM/DD HH:mm` (e.g. `11/09 23:48`)
 * - Different calendar year: `YY/MM/DD HH:mm` (e.g. `25/12/31 23:48`)
 */
export function formatConciseLocalFinishedTime(
  input: Date | string | number | null | undefined,
  options?: {
    nowMs?: number;
    clockFormat?: SessionTimeClockFormat;
    alwaysIncludeDate?: boolean;
  },
): string {
  const d = coerceToValidDate(input);
  if (!d) return "";
  const now = new Date(options?.nowMs ?? Date.now());
  const clockFormat = options?.clockFormat ?? activePrefs.clockFormat;
  const clock = formatClockPart(d, clockFormat);

  const sameYear = d.getFullYear() === now.getFullYear();
  const sameMonth = sameYear && d.getMonth() === now.getMonth();
  const sameDay = sameMonth && d.getDate() === now.getDate();

  if (sameDay && !options?.alwaysIncludeDate) {
    return clock;
  }

  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  if (sameYear) {
    return `${mm}/${dd} ${clock}`;
  }
  const yy = String(d.getFullYear()).slice(-2);
  return `${yy}/${mm}/${dd} ${clock}`;
}

/**
 * Compact timestamp with seconds and UTC offset for hover overlays and native tooltips.
 * Kept concise (~20 chars: `11/10 01:38:24 GMT+8`) so AssistantTurnFooter's labelSizer
 * never adds trailing blank space before the Copy/Fork buttons.
 */
export function formatCompactHoverTimestamp(
  input: Date | string | number | null | undefined,
  options?: {
    nowMs?: number;
    clockFormat?: SessionTimeClockFormat;
  },
): string {
  const d = coerceToValidDate(input);
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const tz = getUserTimezoneInfo(d);
  return `${mm}/${dd} ${hh}:${mi}:${ss} ${tz.offsetLabel}`;
}

export function formatFullLocalFinishedTooltip(
  input: Date | string | number | null | undefined,
): string {
  const d = coerceToValidDate(input);
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const tz = getUserTimezoneInfo(d);
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} ${tz.offsetLabel} (${tz.timeZone})`;
}

/**
 * Formats relative age (`7h ago` or compact `7h`) combined with the concise
 * local finished clock time (`01:38` or `11/09 23:48`).
 */
export function formatRelativeWithLocalTime(
  input: Date | string | number | null | undefined,
  options?: {
    nowMs?: number;
    compact?: boolean;
    clockFormat?: SessionTimeClockFormat;
    includeLocalTime?: boolean;
  },
): {
  label: string;
  relativeOnly: string;
  localTime: string;
  resolution: "minute" | "hour" | "day" | "static";
} {
  const d = coerceToValidDate(input);
  if (!d) {
    return {
      label: "",
      relativeOnly: "",
      localTime: "",
      resolution: "static",
    };
  }
  const nowMs = options?.nowMs ?? Date.now();
  const compact = Boolean(options?.compact);
  const clockFormat = options?.clockFormat ?? activePrefs.clockFormat;
  const includeLocalTime = options?.includeLocalTime ?? activePrefs.enabled;
  const localTime = formatConciseLocalFinishedTime(d, {
    nowMs,
    clockFormat,
  });

  const diffMs = Math.max(0, nowMs - d.getTime());
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  let relativeOnly = "";
  let resolution: "minute" | "hour" | "day" | "static" = "minute";

  if (compact) {
    if (diffMin < 1) {
      relativeOnly = "now";
      resolution = "minute";
    } else if (diffMin < 60) {
      relativeOnly = `${diffMin}m`;
      resolution = "minute";
    } else if (diffHr < 24) {
      relativeOnly = `${diffHr}h`;
      resolution = "hour";
    } else if (diffDays < 7) {
      relativeOnly = `${diffDays}d`;
      resolution = "day";
    } else {
      const now = new Date(nowMs);
      const mon = EN_SHORT_MONTHS[d.getMonth()] ?? "Jan";
      relativeOnly =
        d.getFullYear() === now.getFullYear()
          ? `${mon} ${d.getDate()}`
          : `${mon} ${d.getDate()}, ${d.getFullYear()}`;
      resolution = "static";
    }
  } else {
    if (diffMin < 1) {
      relativeOnly = "just now";
      resolution = "minute";
    } else if (diffMin < 60) {
      relativeOnly = `${diffMin}m ago`;
      resolution = "minute";
    } else if (diffHr < 24) {
      relativeOnly = `${diffHr}h ago`;
      resolution = "hour";
    } else if (diffDays < 7) {
      relativeOnly = `${diffDays}d ago`;
      resolution = "day";
    } else {
      const now = new Date(nowMs);
      const mon = EN_SHORT_MONTHS[d.getMonth()] ?? "Jan";
      relativeOnly =
        d.getFullYear() === now.getFullYear()
          ? `${mon} ${d.getDate()}`
          : `${mon} ${d.getDate()}, ${d.getFullYear()}`;
      resolution = "static";
    }
  }

  if (!includeLocalTime || !localTime) {
    return {
      label: relativeOnly,
      relativeOnly,
      localTime,
      resolution,
    };
  }

  // When resolution is static (>= 7 days), localTime (`11/02 14:20`) already contains the date + clock
  if (resolution === "static") {
    const clockOnly = formatClockPart(d, clockFormat);
    return {
      label: `${relativeOnly} · ${clockOnly}`,
      relativeOnly,
      localTime,
      resolution,
    };
  }

  return {
    label: `${relativeOnly} · ${localTime}`,
    relativeOnly,
    localTime,
    resolution,
  };
}

export function stripExistingTurnTimeSuffix(rawDurationLabel: string): string {
  const idx = rawDurationLabel.indexOf(" · ");
  if (idx > 0) {
    return rawDurationLabel.slice(0, idx).trim();
  }
  return rawDurationLabel.trim();
}

/**
 * Formats a duration in milliseconds using the exact same rules as Paseo's
 * Module 3356 `formatDuration(ms)` (`45s`, `53m 42s`, `1h 29m`).
 */
export function formatTurnDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0s";
  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) return `${Math.floor(totalSeconds)}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const secs = Math.floor(totalSeconds) % 60;
    return secs === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${secs}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

/**
 * Formats an assistant turn footer (`Worked for 1h 29m`) to include the concise
 * finished time in the user's local timezone (`Worked for 1h 29m · 01:38 (7h ago)`).
 */
export function formatTurnWorkedForWithFinishedTime(
  rawDurationLabel: string,
  completedAt: Date | string | number | null | undefined,
  options?: {
    nowMs?: number;
    clockFormat?: SessionTimeClockFormat;
    showRelativeAge?: boolean;
  },
): string {
  const baseLabel = stripExistingTurnTimeSuffix(rawDurationLabel);
  if (!baseLabel) return "";
  if (!activePrefs.enabled) return baseLabel;

  const d = coerceToValidDate(completedAt);
  if (!d) return baseLabel;

  const nowMs = options?.nowMs ?? Date.now();
  const clockFormat = options?.clockFormat ?? activePrefs.clockFormat;
  const showRelativeAge =
    options?.showRelativeAge ?? activePrefs.showRelativeAgeInTurnFooter;

  const localTime = formatConciseLocalFinishedTime(d, {
    nowMs,
    clockFormat,
  });
  if (!localTime) return baseLabel;

  if (!showRelativeAge) {
    return `${baseLabel} · ${localTime}`;
  }

  const diffMin = Math.floor(Math.max(0, nowMs - d.getTime()) / 60_000);
  if (diffMin < 1) {
    return `${baseLabel} · ${localTime}`;
  }
  const rel = formatRelativeWithLocalTime(d, {
    nowMs,
    compact: false,
    clockFormat,
    includeLocalTime: false,
  }).relativeOnly;

  return rel ? `${baseLabel} · ${localTime} (${rel})` : `${baseLabel} · ${localTime}`;
}

/**
 * Converts a compact label (`7h · 01:38` or `7h`) into prose for Agent Tab hover tooltips
 * (`7h ago · 01:38`).
 */
export function formatCompactLabelAsProseWithLocalTime(compactLabel: string): string {
  const trimmed = (compactLabel ?? "").trim();
  if (!trimmed) return "";
  if (!activePrefs.enabled) {
    if (trimmed === "now") return "just now";
    return /^\d/.test(trimmed) ? `${trimmed} ago` : trimmed;
  }

  if (trimmed.includes(" · ")) {
    const [leftPart, rightPart] = trimmed.split(" · ", 2);
    const left = (leftPart ?? "").trim();
    const right = (rightPart ?? "").trim();
    const proseLeft =
      left === "now"
        ? "just now"
        : /^\d+[mhdw]$/.test(left)
          ? `${left} ago`
          : left;
    return right ? `${proseLeft} · ${right}` : proseLeft;
  }

  const trackedDate = compactLabelToDate.get(trimmed) ?? lastCompactInputDate;
  if (trackedDate) {
    return formatRelativeWithLocalTime(trackedDate, {
      compact: false,
      clockFormat: activePrefs.clockFormat,
    }).label;
  }

  if (trimmed === "now") return "just now";
  return /^\d/.test(trimmed) ? `${trimmed} ago` : trimmed;
}

export function readSessionTimePreferences(): SessionTimePreferences {
  if (typeof window === "undefined") {
    return { ...activePrefs };
  }
  try {
    const raw = window.localStorage?.getItem(SESSION_TIME_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SessionTimePreferences>;
      activePrefs = {
        enabled: parsed.enabled ?? activePrefs.enabled,
        clockFormat: parsed.clockFormat === "12h" ? "12h" : "24h",
        showFinishedTimeInSidebar:
          parsed.showFinishedTimeInSidebar ?? activePrefs.showFinishedTimeInSidebar,
        showRelativeAgeInTurnFooter:
          parsed.showRelativeAgeInTurnFooter ?? activePrefs.showRelativeAgeInTurnFooter,
        sourceBadge: parsed.sourceBadge ?? "localStorage",
      };
    }
  } catch {
    // ignore storage errors
  }
  return { ...activePrefs };
}

export function syncSessionTimePreferences(
  next: Partial<Omit<SessionTimePreferences, "sourceBadge">>,
  sourceBadge: "plugin-settings" | "localStorage" | "default" = "plugin-settings",
): SessionTimePreferences {
  activePrefs = {
    enabled: next.enabled ?? activePrefs.enabled,
    clockFormat:
      next.clockFormat === "12h" || next.clockFormat === "24h"
        ? next.clockFormat
        : activePrefs.clockFormat,
    showFinishedTimeInSidebar:
      next.showFinishedTimeInSidebar ?? activePrefs.showFinishedTimeInSidebar,
    showRelativeAgeInTurnFooter:
      next.showRelativeAgeInTurnFooter ?? activePrefs.showRelativeAgeInTurnFooter,
    sourceBadge,
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage?.setItem(
        SESSION_TIME_STORAGE_KEY,
        JSON.stringify(activePrefs),
      );
    } catch {
      // ignore
    }
  }
  globalRefreshDomFn?.();
  dispatchSessionTimeEvent();
  return { ...activePrefs };
}

export function registerTurnTimingCompletedAt(
  durationMs: number | null | undefined,
  completedAt: Date | string | number | null | undefined,
): void {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return;
  const d = coerceToValidDate(completedAt);
  if (!d) return;
  durationMsToCompletedAt.set(durationMs, d);
}

/**
 * Extracts `completedAt` / `enteredAt` / `activityAt` / `lastActivityAt` from a DOM node's
 * attached React Fiber (`__reactFiber$...`) when available.
 */
export function extractTimestampFromReactFiber(
  el: Element | null,
): {
  completedAt?: Date;
  durationMs?: number;
  enteredAt?: Date;
  activityAt?: Date;
} {
  if (!el) return {};
  const rec = el as unknown as Record<string, unknown>;
  const fiberKey = Object.keys(rec).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  );
  if (!fiberKey) return {};

  let cur = rec[fiberKey] as
    | {
        memoizedProps?: Record<string, unknown> | null;
        pendingProps?: Record<string, unknown> | null;
        updateQueue?: {
          memoCache?: {
            data?: Array<Array<unknown>>;
          } | null;
        } | null;
        alternate?: {
          updateQueue?: {
            memoCache?: {
              data?: Array<Array<unknown>>;
            } | null;
          } | null;
        } | null;
        return?: unknown;
      }
    | undefined
    | null;

  const out: {
    completedAt?: Date;
    durationMs?: number;
    enteredAt?: Date;
    activityAt?: Date;
  } = {};

  for (let depth = 0; cur && depth < 16; depth += 1) {
    const props = cur.memoizedProps ?? cur.pendingProps;
    if (props && typeof props === "object") {
      if (!out.completedAt && props.completedAt) {
        const d = coerceToValidDate(props.completedAt as Date | string | number);
        if (d) out.completedAt = d;
      }
      if (out.durationMs === undefined && typeof props.durationMs === "number") {
        out.durationMs = props.durationMs;
      }
      if (!out.enteredAt && props.enteredAt) {
        const d = coerceToValidDate(props.enteredAt as Date | string | number);
        if (d) out.enteredAt = d;
      }
      if (!out.enteredAt && props.workspace && typeof props.workspace === "object") {
        const ws = props.workspace as Record<string, unknown>;
        const d = coerceToValidDate(
          (ws.statusEnteredAt ?? ws.updatedAt ?? ws.lastActivityAt) as
            | Date
            | string
            | number,
        );
        if (d) out.enteredAt = d;
      }
      if (!out.activityAt && props.activityAt) {
        const d = coerceToValidDate(props.activityAt as Date | string | number);
        if (d) out.activityAt = d;
      }
      if (!out.activityAt && props.item && typeof props.item === "object") {
        const item = props.item as Record<string, unknown>;
        const d = coerceToValidDate(
          (item.lastActivityAt ?? item.updatedAt) as Date | string | number,
        );
        if (d) out.activityAt = d;
      }
    }

    const caches = [
      cur.updateQueue?.memoCache?.data,
      cur.alternate?.updateQueue?.memoCache?.data,
    ];
    for (const data of caches) {
      if (!Array.isArray(data)) continue;
      for (const slots of data) {
        if (!Array.isArray(slots) || slots.length < 7) continue;
        if (out.durationMs === undefined && typeof slots[2] === "number") {
          out.durationMs = slots[2];
        }
        if (!out.completedAt && slots[5]) {
          const d = coerceToValidDate(slots[5] as Date | string | number);
          if (d) out.completedAt = d;
        }
      }
    }

    cur = cur.return as typeof cur;
  }
  return out;
}

/**
 * Synchronizes React Compiler's `useMemoCache(29)` slots on Paseo's `AssistantTurnFooter`
 * fiber (`l[4]` = `C` duration label, `l[6]` = `k` hover label) so hovering (`onHoverIn`)
 * and moving the mouse away (`onHoverOut`) never revert the DOM text to an unformatted
 * or shrunk string.
 */
export function syncTurnFooterFiberMemoCache(
  el: Element | null,
  desiredText: string,
  hoverText: string,
): boolean {
  if (!el || !desiredText) return false;
  const rec = el as unknown as Record<string, unknown>;
  const fiberKey = Object.keys(rec).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  );
  if (!fiberKey) return false;

  type FiberNode = {
    updateQueue?: {
      memoCache?: {
        data?: Array<Array<unknown>>;
      } | null;
    } | null;
    alternate?: FiberNode | null;
    return?: FiberNode | null;
  };

  let cur = rec[fiberKey] as FiberNode | undefined | null;
  let updated = false;

  for (let depth = 0; cur && depth < 16; depth += 1) {
    const fibers = [cur, cur.alternate];
    for (const f of fibers) {
      const data = f?.updateQueue?.memoCache?.data;
      if (!Array.isArray(data)) continue;
      for (const slots of data) {
        if (
          Array.isArray(slots) &&
          slots.length === 29 &&
          typeof slots[4] === "string" &&
          typeof slots[6] === "string"
        ) {
          if (slots[4] !== desiredText || slots[6] !== hoverText) {
            slots[4] = desiredText;
            slots[6] = hoverText;
            // Invalidate slot 19 (`C` dependency of Pressable JSX at slot 24) so next hover/unhover rebuilds VDOM
            slots[19] = null;
            updated = true;
          }
        }
      }
    }
    cur = cur.return;
  }
  return updated;
}

/**
 * Fallback parser for AssistantTurnFooter's `aria-label="Worked for 1h 29m, ended 1:38 AM"`
 * or `ended Yesterday, 11:48 PM` when React Fiber props are not attached (e.g. unit test DOM).
 */
export function parseEndedTimestampFromAriaLabel(
  ariaLabel: string,
  nowMs: number = Date.now(),
): { durationLabel: string; completedAt: Date | null } | null {
  const raw = (ariaLabel ?? "").trim();
  const endedIdx = raw.lastIndexOf(", ended ");
  if (endedIdx <= 0) return null;
  const durationLabel = stripExistingTurnTimeSuffix(raw.slice(0, endedIdx).trim());
  const rawEndedStr = raw.slice(endedIdx + ", ended ".length).trim();
  const endedStr = rawEndedStr
    .replace(/^.*?\s·\s/, "")
    .replace(/\s*\([^)]*\)$/, "")
    .trim();
  if (!durationLabel || !endedStr) return null;

  // Case 1: Already formatted by our `formatCompactHoverTimestamp` (`11/10 01:38:24 GMT+8`)
  const hoverMatch = endedStr.match(
    /^(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (hoverMatch) {
    const now = new Date(nowMs);
    const month = Number.parseInt(hoverMatch[1], 10) - 1;
    const day = Number.parseInt(hoverMatch[2], 10);
    const hour = Number.parseInt(hoverMatch[3], 10);
    const min = Number.parseInt(hoverMatch[4], 10);
    const sec = hoverMatch[5] ? Number.parseInt(hoverMatch[5], 10) : 0;
    const candidate = new Date(now.getFullYear(), month, day, hour, min, sec);
    if (candidate.getTime() - nowMs > 86_400_000) {
      candidate.setFullYear(candidate.getFullYear() - 1);
    }
    return { durationLabel, completedAt: candidate };
  }

  // Case 2: Standard `1:38 AM` / `01:38` / `Yesterday, 11:48 PM` / `Nov 9, 11:48 PM`
  const now = new Date(nowMs);
  const timeMatch = endedStr.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!timeMatch) {
    const direct = coerceToValidDate(endedStr);
    return { durationLabel, completedAt: direct };
  }

  let hour = Number.parseInt(timeMatch[1], 10);
  const min = Number.parseInt(timeMatch[2], 10);
  const ampm = timeMatch[3]?.toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  const prefix = endedStr.slice(0, timeMatch.index).replace(/,\s*$/, "").trim();
  if (!prefix) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, min, 0);
    return { durationLabel, completedAt: d };
  }
  if (/^yesterday$/i.test(prefix)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, hour, min, 0);
    return { durationLabel, completedAt: d };
  }
  const monthDayMatch = prefix.match(/^([A-Za-z]{3})\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (monthDayMatch) {
    const mIdx = EN_SHORT_MONTHS.findIndex(
      (m) => m.toLowerCase() === monthDayMatch[1].toLowerCase(),
    );
    if (mIdx >= 0) {
      const day = Number.parseInt(monthDayMatch[2], 10);
      const yr = monthDayMatch[3]
        ? Number.parseInt(monthDayMatch[3], 10)
        : now.getFullYear();
      const d = new Date(yr, mIdx, day, hour, min, 0);
      return { durationLabel, completedAt: d };
    }
  }
  const weekdayIdx = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(
    prefix.slice(0, 3).toLowerCase(),
  );
  if (weekdayIdx >= 0) {
    const curDay = now.getDay();
    let diff = curDay - weekdayIdx;
    if (diff <= 0) diff += 7;
    const d = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - diff,
      hour,
      min,
      0,
    );
    return { durationLabel, completedAt: d };
  }

  return { durationLabel, completedAt: null };
}

type MetroModuleRecord = {
  isInitialized?: boolean;
  publicModule?: { exports?: Record<string, unknown> };
};

type MetroWindow = Window & {
  __r?: ((moduleId: number) => unknown) & {
    getModules?: () => Map<number, MetroModuleRecord> | Record<string, MetroModuleRecord>;
  };
};

export function patchMetroSessionTimeModules(win: MetroWindow): boolean {
  const req = win?.__r;
  if (typeof req !== "function" || typeof req.getModules !== "function") {
    return false;
  }

  const modules = req.getModules();
  const entries: Array<[number, MetroModuleRecord]> =
    modules instanceof Map
      ? Array.from(modules.entries())
      : Object.entries(modules ?? {}).map(([k, v]) => [Number(k), v]);

  let hookedAny = false;

  for (const [modId, mod] of entries) {
    if (!mod?.isInitialized) continue;
    const exp = mod.publicModule?.exports;
    if (!exp || typeof exp !== "object") continue;

    // 1. Time Formatter Module (Module 3356 signature)
    if (
      typeof exp.describeTimeAgo === "function" &&
      typeof exp.formatTimeAgo === "function" &&
      typeof exp.describeCompactTimeAgo === "function" &&
      typeof exp.formatCompactTimeAgo === "function"
    ) {
      if (!exp.__paseoFinderSessionTimePatched) {
        const origDescribeTimeAgo = exp.describeTimeAgo as (
          date: Date,
          now?: Date,
        ) => { label: string; resolution: string };
        const origDescribeCompactTimeAgo = exp.describeCompactTimeAgo as (
          date: Date,
          now?: Date,
        ) => { label: string; resolution: string };
        const origFormatCompactTimeAgoAsProse =
          typeof exp.formatCompactTimeAgoAsProse === "function"
            ? (exp.formatCompactTimeAgoAsProse as (s: string) => string)
            : null;
        const origFormatMessageTimestamp =
          typeof exp.formatMessageTimestamp === "function"
            ? (exp.formatMessageTimestamp as (date: Date, now?: Date) => string)
            : null;

        Object.defineProperty(exp, "__paseoFinderSessionTimePatched", {
          value: true,
          configurable: true,
        });

        exp.describeTimeAgo = function patchedDescribeTimeAgo(
          date: Date,
          now: Date = new Date(),
        ) {
          const base = origDescribeTimeAgo(date, now);
          if (!activePrefs.enabled) return base;
          const d = coerceToValidDate(date);
          if (!d) return base;
          const formatted = formatRelativeWithLocalTime(d, {
            nowMs: now.getTime(),
            compact: false,
            clockFormat: activePrefs.clockFormat,
          });
          return {
            ...base,
            label: formatted.label || base.label,
          };
        };

        exp.formatTimeAgo = function patchedFormatTimeAgo(
          date: Date,
          now: Date = new Date(),
        ) {
          return (
            exp.describeTimeAgo as (
              d: Date,
              n?: Date,
            ) => { label: string; resolution: string }
          )(date, now).label;
        };

        exp.describeCompactTimeAgo = function patchedDescribeCompactTimeAgo(
          date: Date,
          now: Date = new Date(),
        ) {
          const base = origDescribeCompactTimeAgo(date, now);
          const d = coerceToValidDate(date);
          if (d) {
            lastCompactInputDate = d;
            compactLabelToDate.set(base.label, d);
          }
          if (!activePrefs.enabled || !activePrefs.showFinishedTimeInSidebar || !d) {
            return base;
          }
          const formatted = formatRelativeWithLocalTime(d, {
            nowMs: now.getTime(),
            compact: true,
            clockFormat: activePrefs.clockFormat,
          });
          const label = formatted.label || base.label;
          compactLabelToDate.set(label, d);
          return {
            ...base,
            label,
          };
        };

        exp.formatCompactTimeAgo = function patchedFormatCompactTimeAgo(
          date: Date,
          now: Date = new Date(),
        ) {
          return (
            exp.describeCompactTimeAgo as (
              d: Date,
              n?: Date,
            ) => { label: string; resolution: string }
          )(date, now).label;
        };

        if (origFormatCompactTimeAgoAsProse) {
          exp.formatCompactTimeAgoAsProse = function patchedFormatCompactTimeAgoAsProse(
            compactStr: string,
          ) {
            if (!activePrefs.enabled) {
              return origFormatCompactTimeAgoAsProse(compactStr);
            }
            return formatCompactLabelAsProseWithLocalTime(compactStr);
          };
        }

        if (origFormatMessageTimestamp) {
          exp.formatMessageTimestamp = function patchedFormatMessageTimestamp(
            date: Date,
            now: Date = new Date(),
          ) {
            const d = coerceToValidDate(date);
            if (d) {
              lastFormattedMessageDate = d;
            }
            if (!activePrefs.enabled || !d) {
              return origFormatMessageTimestamp(date, now);
            }
            if (activeTurnFooterRenderContext?.lastDurationLabel) {
              return activeTurnFooterRenderContext.lastDurationLabel;
            }
            return formatCompactHoverTimestamp(d, {
              nowMs: now.getTime(),
              clockFormat: activePrefs.clockFormat,
            });
          };
        }
      }
      healthState.hookedModules.add(`time:${modId}`);
      hookedAny = true;
    }

    // 2. React Hook Module (Module 4339 signature: useTimeAgo + useCompactTimeAgo)
    if (
      typeof exp.useTimeAgo === "function" &&
      typeof exp.useCompactTimeAgo === "function"
    ) {
      if (!exp.__paseoFinderUseTimeAgoPatched) {
        const origUseTimeAgo = exp.useTimeAgo as (
          date: Date | null | undefined,
        ) => string;
        const origUseCompactTimeAgo = exp.useCompactTimeAgo as (
          date: Date | null | undefined,
        ) => string;
        Object.defineProperty(exp, "__paseoFinderUseTimeAgoPatched", {
          value: true,
          configurable: true,
        });
        exp.useTimeAgo = function patchedUseTimeAgo(
          date: Date | null | undefined,
        ): string {
          const d = coerceToValidDate(date);
          const out = origUseTimeAgo(date);
          if (!activePrefs.enabled || !d) {
            return out;
          }
          const formatted = formatRelativeWithLocalTime(d, {
            compact: false,
            clockFormat: activePrefs.clockFormat,
          });
          return formatted.label || out;
        };
        exp.useCompactTimeAgo = function patchedUseCompactTimeAgo(
          date: Date | null | undefined,
        ): string {
          const d = coerceToValidDate(date);
          if (d) {
            lastCompactInputDate = d;
          }
          const out = origUseCompactTimeAgo(date);
          if (d && out) {
            compactLabelToDate.set(out, d);
          }
          if (!activePrefs.enabled || !activePrefs.showFinishedTimeInSidebar || !d) {
            return out;
          }
          const formatted = formatRelativeWithLocalTime(d, {
            compact: true,
            clockFormat: activePrefs.clockFormat,
          });
          const label = formatted.label || out;
          compactLabelToDate.set(label, d);
          return label;
        };
      }
      healthState.hookedModules.add(`useTimeAgo:${modId}`);
      hookedAny = true;
    }

    // 3. Stream Turn Timing Module (Module 5312 signature: deriveStreamTurnTiming)
    if (typeof exp.deriveStreamTurnTiming === "function") {
      if (!exp.__paseoFinderTurnTimingPatched) {
        const origDeriveStreamTurnTiming = exp.deriveStreamTurnTiming as (
          items: unknown,
        ) => {
          activeStartedAt?: Date | null;
          byItemId?:
            | Map<string, { completedAt?: Date | null; durationMs?: number | null }>
            | Record<
                string,
                { completedAt?: Date | null; durationMs?: number | null }
              >;
        };
        Object.defineProperty(exp, "__paseoFinderTurnTimingPatched", {
          value: true,
          configurable: true,
        });
        exp.deriveStreamTurnTiming = function patchedDeriveStreamTurnTiming(
          items: unknown,
        ) {
          const res = origDeriveStreamTurnTiming(items);
          if (res?.byItemId && typeof res.byItemId === "object") {
            const entries =
              res.byItemId instanceof Map
                ? res.byItemId.values()
                : Object.values(res.byItemId);
            for (const entry of entries) {
              if (entry && typeof entry.durationMs === "number" && entry.completedAt) {
                registerTurnTimingCompletedAt(entry.durationMs, entry.completedAt);
              }
            }
          }
          return res;
        };
      }
      healthState.hookedModules.add(`turnTiming:${modId}`);
      hookedAny = true;
    }

    // 4. Turn Duration Label Module (Module 5287 signature: getTurnDurationLabel)
    if (typeof exp.getTurnDurationLabel === "function") {
      if (!exp.__paseoFinderTurnDurationPatched) {
        const origGetTurnDurationLabel = exp.getTurnDurationLabel as (
          durationMs: number,
          t: (key: string, vars?: Record<string, unknown>) => string,
        ) => string;
        Object.defineProperty(exp, "__paseoFinderTurnDurationPatched", {
          value: true,
          configurable: true,
        });
        exp.getTurnDurationLabel = function patchedGetTurnDurationLabel(
          durationMs: number,
          t: (key: string, vars?: Record<string, unknown>) => string,
        ): string {
          const base = origGetTurnDurationLabel(durationMs, t);
          if (!activePrefs.enabled || !base) return base;
          const completedAt =
            activeTurnFooterRenderContext?.completedAt ??
            durationMsToCompletedAt.get(durationMs);
          if (!completedAt) return base;
          const formatted = formatTurnWorkedForWithFinishedTime(base, completedAt);
          if (activeTurnFooterRenderContext) {
            activeTurnFooterRenderContext.lastDurationLabel = formatted;
          }
          return formatted;
        };
      }
      healthState.hookedModules.add(`turnDuration:${modId}`);
      hookedAny = true;
    }

    // 5. AssistantTurnFooter Memo Component (Module 5187 signature: AssistantTurnFooter.type)
    const turnFooterExport = exp.AssistantTurnFooter as
      | {
          type?: (props: Record<string, unknown>) => unknown;
          __paseoFinderTurnFooterPatched?: boolean;
        }
      | undefined;
    if (
      turnFooterExport &&
      typeof turnFooterExport === "object" &&
      typeof turnFooterExport.type === "function"
    ) {
      if (!turnFooterExport.__paseoFinderTurnFooterPatched) {
        const origTurnFooterType = turnFooterExport.type;
        Object.defineProperty(turnFooterExport, "__paseoFinderTurnFooterPatched", {
          value: true,
          configurable: true,
        });
        turnFooterExport.type = function patchedAssistantTurnFooterType(
          props: Record<string, unknown>,
        ) {
          const durationMs =
            typeof props?.durationMs === "number" ? props.durationMs : null;
          const completedAt = coerceToValidDate(
            props?.completedAt as Date | string | number | null | undefined,
          );
          if (durationMs !== null && completedAt) {
            registerTurnTimingCompletedAt(durationMs, completedAt);
          }
          const prevCtx = activeTurnFooterRenderContext;
          activeTurnFooterRenderContext = {
            durationMs,
            completedAt,
            lastDurationLabel: "",
          };
          try {
            return origTurnFooterType(props);
          } finally {
            activeTurnFooterRenderContext = prevCtx;
          }
        };
      }
      healthState.hookedModules.add(`turnFooter:${modId}`);
      hookedAny = true;
    }
  }

  if (hookedAny) {
    healthState.metroHookInstalled = true;
  }
  return hookedAny;
}

export function ensureSessionTimeStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    /* Prevent Sessions/Archive AgentList timestamp column from truncating "7h ago · 01:38" */
    [data-testid^="agent-row-"] > div:last-child {
      width: auto !important;
      min-width: 72px !important;
      flex-shrink: 0 !important;
    }
    [data-testid="sidebar-workspace-timestamp"],
    [data-testid^="sidebar-project-timestamp-"],
    [data-testid="command-center-result-timestamp"] {
      font-variant-numeric: tabular-nums;
    }
  `;
  (doc.head ?? doc.documentElement)?.appendChild(style);
}

/**
 * Enhances already-mounted DOM nodes in place (AssistantTurnFooter `Worked for ...`,
 * Left Sidebar workspace timestamps, Command Center timestamps, and AgentList rows)
 * so existing open chats and cached React Compiler components reflect the user timezone
 * finished time immediately without waiting for a manual remount.
 */
export function decorateSessionTimestampsDom(
  doc: Document,
  nowMs: number = Date.now(),
): {
  turnFootersUpdated: number;
  sidebarUpdated: number;
  commandCenterUpdated: number;
  agentRowsUpdated: number;
} {
  ensureSessionTimeStyles(doc);

  let turnFootersUpdated = 0;
  let sidebarUpdated = 0;
  let commandCenterUpdated = 0;
  let agentRowsUpdated = 0;

  // 1. AssistantTurnFooter (`[role="button"][aria-label*=", ended "]` or `[data-paseo-turn-base-duration]`)
  const turnButtons = doc.querySelectorAll<HTMLElement>(
    '[data-testid="agent-timeline"] [role="button"][aria-label*=", ended "], [role="button"][aria-label^="Worked for "][aria-label*=", ended "], [role="button"][data-paseo-turn-base-duration]',
  );

  for (let i = 0; i < turnButtons.length; i += 1) {
    const btn = turnButtons[i];
    if (!btn) continue;

    const fiberInfo = extractTimestampFromReactFiber(btn);
    if (typeof fiberInfo.durationMs === "number" && fiberInfo.completedAt) {
      registerTurnTimingCompletedAt(fiberInfo.durationMs, fiberInfo.completedAt);
    }

    const aria = btn.getAttribute("aria-label") ?? "";
    const parsed = parseEndedTimestampFromAriaLabel(aria, nowMs);
    const completedAt =
      fiberInfo.completedAt ??
      coerceToValidDate(btn.getAttribute("data-paseo-completed-at")) ??
      parsed?.completedAt ??
      null;
    if (!completedAt) continue;

    const completedIso = completedAt.toISOString();
    if (btn.getAttribute("data-paseo-completed-at") !== completedIso) {
      btn.setAttribute("data-paseo-completed-at", completedIso);
    }

    const storedBase = btn.getAttribute("data-paseo-turn-base-duration");
    const fiberDurationLabel =
      typeof fiberInfo.durationMs === "number" &&
      Number.isFinite(fiberInfo.durationMs) &&
      fiberInfo.durationMs >= 0
        ? `Worked for ${formatTurnDurationMs(fiberInfo.durationMs)}`
        : "";
    const currentTextTrimmed = (btn.textContent ?? "").trim();
    const currentTextBase = currentTextTrimmed.startsWith("Worked for ")
      ? stripExistingTurnTimeSuffix(currentTextTrimmed)
      : "";
    // Always prioritize live React Fiber `durationMs` and `aria-label` over `storedBase`
    // so mid-turn snapshots (e.g. `44m 20s` before turn completion at `53m 42s`) never stick.
    const baseDuration =
      fiberDurationLabel ||
      parsed?.durationLabel ||
      currentTextBase ||
      storedBase ||
      "";
    if (!baseDuration) continue;

    if (storedBase !== baseDuration) {
      btn.setAttribute("data-paseo-turn-base-duration", baseDuration);
    }

    const desiredText = activePrefs.enabled
      ? formatTurnWorkedForWithFinishedTime(baseDuration, completedAt, { nowMs })
      : baseDuration;
    const hoverText = activePrefs.enabled
      ? desiredText
      : formatClockPart(completedAt, "12h");
    const fullTooltip = formatFullLocalFinishedTooltip(completedAt);

    if (btn.getAttribute("title") !== fullTooltip) {
      btn.setAttribute("title", fullTooltip);
    }
    if (btn.getAttribute("data-paseo-turn-desired-text") !== desiredText) {
      btn.setAttribute("data-paseo-turn-desired-text", desiredText);
    }

    // Keep React Compiler's `useMemoCache(29)` slots (`l[4]` and `l[6]`) in sync so
    // `onHoverIn` and `onHoverOut` never shrink or revert the label.
    syncTurnFooterFiberMemoCache(btn, desiredText, hoverText);

    const applyTurnButtonDomText = (targetBtn: HTMLElement) => {
      const targetText =
        targetBtn.getAttribute("data-paseo-turn-desired-text") ?? desiredText;
      if (!targetText) return false;
      const textSpans = targetBtn.querySelectorAll<HTMLElement>('[dir="auto"]');
      let changed = false;
      if (textSpans.length >= 2) {
        const sizer = textSpans[0];
        const overlay = textSpans[1];
        if (sizer && sizer.textContent !== targetText) {
          sizer.textContent = targetText;
          changed = true;
        }
        if (overlay && overlay.textContent !== targetText) {
          overlay.textContent = targetText;
          changed = true;
        }
      } else if (targetBtn.textContent !== targetText) {
        targetBtn.textContent = targetText;
        changed = true;
      }
      return changed;
    };

    if (applyTurnButtonDomText(btn)) {
      turnFootersUpdated += 1;
    }

    if (btn.getAttribute("data-paseo-turn-hover-bound") !== "1") {
      btn.setAttribute("data-paseo-turn-hover-bound", "1");
      const syncOnPointer = () => {
        applyTurnButtonDomText(btn);
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => {
            applyTurnButtonDomText(btn);
          });
        }
      };
      btn.addEventListener("pointerenter", syncOnPointer);
      btn.addEventListener("pointerleave", syncOnPointer);
      btn.addEventListener("mouseenter", syncOnPointer);
      btn.addEventListener("mouseleave", syncOnPointer);
    }
  }

  // 2. Left Sidebar workspace timestamps (`[data-testid="sidebar-workspace-timestamp"]`)
  const sidebarTimestamps = doc.querySelectorAll<HTMLElement>(
    '[data-testid="sidebar-workspace-timestamp"]',
  );
  for (let i = 0; i < sidebarTimestamps.length; i += 1) {
    const el = sidebarTimestamps[i];
    if (!el) continue;
    const fiberInfo = extractTimestampFromReactFiber(el);
    const enteredAt =
      fiberInfo.enteredAt ??
      coerceToValidDate(el.getAttribute("data-paseo-entered-at"));
    if (!enteredAt) continue;

    const iso = enteredAt.toISOString();
    if (el.getAttribute("data-paseo-entered-at") !== iso) {
      el.setAttribute("data-paseo-entered-at", iso);
    }

    const formatted = formatRelativeWithLocalTime(enteredAt, {
      nowMs,
      compact: true,
      clockFormat: activePrefs.clockFormat,
      includeLocalTime:
        activePrefs.enabled && activePrefs.showFinishedTimeInSidebar,
    });
    if (formatted.label && el.textContent !== formatted.label) {
      el.textContent = formatted.label;
      sidebarUpdated += 1;
    }
    const fullTooltip = formatFullLocalFinishedTooltip(enteredAt);
    if (el.getAttribute("title") !== fullTooltip) {
      el.setAttribute("title", fullTooltip);
    }
  }

  // 3. Command Center (`⌘K`) timestamps (`[data-testid="command-center-result-timestamp"]`)
  const cmdTimestamps = doc.querySelectorAll<HTMLElement>(
    '[data-testid="command-center-result-timestamp"]',
  );
  for (let i = 0; i < cmdTimestamps.length; i += 1) {
    const el = cmdTimestamps[i];
    if (!el) continue;
    const fiberInfo = extractTimestampFromReactFiber(el);
    const activityAt =
      fiberInfo.activityAt ??
      coerceToValidDate(el.getAttribute("data-paseo-activity-at"));
    if (!activityAt) continue;

    const iso = activityAt.toISOString();
    if (el.getAttribute("data-paseo-activity-at") !== iso) {
      el.setAttribute("data-paseo-activity-at", iso);
    }

    const formatted = formatRelativeWithLocalTime(activityAt, {
      nowMs,
      compact: false,
      clockFormat: activePrefs.clockFormat,
      includeLocalTime: activePrefs.enabled,
    });
    const rawCurrent = el.textContent ?? "";
    const hasLeadingDot = rawCurrent.startsWith("\u00a0\u00b7 ") || rawCurrent.startsWith(" · ");
    const desired = hasLeadingDot
      ? `\u00a0\u00b7 ${formatted.label}`
      : formatted.label;
    if (desired && el.textContent !== desired) {
      el.textContent = desired;
      commandCenterUpdated += 1;
    }
    const fullTooltip = formatFullLocalFinishedTooltip(activityAt);
    if (el.getAttribute("title") !== fullTooltip) {
      el.setAttribute("title", fullTooltip);
    }
  }

  // 4. Sessions / Archive `AgentList` rows (`[data-testid^="agent-row-"]`)
  const agentRows = doc.querySelectorAll<HTMLElement>(
    '[data-testid^="agent-row-"]:not([data-testid^="agent-row-title-"]):not([data-testid^="agent-row-workspace-"])',
  );
  for (let i = 0; i < agentRows.length; i += 1) {
    const row = agentRows[i];
    if (!row) continue;
    const fiberInfo = extractTimestampFromReactFiber(row);
    const activityAt =
      fiberInfo.activityAt ??
      coerceToValidDate(row.getAttribute("data-paseo-activity-at"));
    if (!activityAt) continue;

    const iso = activityAt.toISOString();
    if (row.getAttribute("data-paseo-activity-at") !== iso) {
      row.setAttribute("data-paseo-activity-at", iso);
    }

    const lastCol = row.lastElementChild as HTMLElement | null;
    const textEl =
      lastCol?.querySelector<HTMLElement>('[dir="auto"]') ?? lastCol;
    if (!textEl) continue;

    const formatted = formatRelativeWithLocalTime(activityAt, {
      nowMs,
      compact: false,
      clockFormat: activePrefs.clockFormat,
      includeLocalTime: activePrefs.enabled,
    });
    if (formatted.label && textEl.textContent !== formatted.label) {
      textEl.textContent = formatted.label;
      agentRowsUpdated += 1;
    }
    const fullTooltip = formatFullLocalFinishedTooltip(activityAt);
    if (textEl.getAttribute("title") !== fullTooltip) {
      textEl.setAttribute("title", fullTooltip);
    }
  }

  healthState.turnFootersDecorated += turnFootersUpdated;
  healthState.sidebarTimestampsDecorated += sidebarUpdated;
  healthState.commandCenterTimestampsDecorated += commandCenterUpdated;
  healthState.agentRowsDecorated += agentRowsUpdated;
  healthState.lastPassIso = new Date(nowMs).toISOString();

  return {
    turnFootersUpdated,
    sidebarUpdated,
    commandCenterUpdated,
    agentRowsUpdated,
  };
}

export function getSessionTimeHealthSnapshot(): SessionTimeHealthSnapshot {
  const tz = getUserTimezoneInfo();
  return {
    enabled: activePrefs.enabled,
    clockFormat: activePrefs.clockFormat,
    showFinishedTimeInSidebar: activePrefs.showFinishedTimeInSidebar,
    showRelativeAgeInTurnFooter: activePrefs.showRelativeAgeInTurnFooter,
    sourceBadge: activePrefs.sourceBadge,
    timeZone: tz.timeZone,
    offsetLabel: tz.offsetLabel,
    metroHookInstalled: healthState.metroHookInstalled,
    hookedModules: Array.from(healthState.hookedModules),
    trackedTurnTimingsCount: durationMsToCompletedAt.size,
    turnFootersDecorated: healthState.turnFootersDecorated,
    sidebarTimestampsDecorated: healthState.sidebarTimestampsDecorated,
    commandCenterTimestampsDecorated: healthState.commandCenterTimestampsDecorated,
    agentRowsDecorated: healthState.agentRowsDecorated,
    lastPassIso: healthState.lastPassIso,
  };
}

export function runSessionTimeSelfTest(options?: {
  nowMs?: number;
  clockFormat?: SessionTimeClockFormat;
}): SessionTimeSelfTestResult {
  const t0 = Date.now();
  const nowMs = options?.nowMs ?? t0;
  const clockFormat = options?.clockFormat ?? activePrefs.clockFormat;
  const now = new Date(nowMs);
  const tz = getUserTimezoneInfo(now);

  // Sample 1: Finished 2 hours ago on the same local day (or 15m ago if near midnight)
  const sameDayTarget = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Math.max(0, now.getHours() - 2),
    Math.max(0, (now.getMinutes() + 38) % 60),
    0,
  );
  if (sameDayTarget.getTime() > nowMs) {
    sameDayTarget.setTime(nowMs - 15 * 60_000);
  }

  // Sample 2: Finished yesterday at 23:48 local time
  const crossDayTarget = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    23,
    48,
    0,
  );

  const sameDaySample = formatConciseLocalFinishedTime(sameDayTarget, {
    nowMs,
    clockFormat,
  });
  const crossDaySample = formatConciseLocalFinishedTime(crossDayTarget, {
    nowMs,
    clockFormat,
  });
  const turnFooterSample = formatTurnWorkedForWithFinishedTime(
    "Worked for 1h 29m",
    sameDayTarget,
    {
      nowMs,
      clockFormat,
      showRelativeAge: true,
    },
  );
  const sidebarCompactSample = formatRelativeWithLocalTime(sameDayTarget, {
    nowMs,
    compact: true,
    clockFormat,
    includeLocalTime: true,
  }).label;
  const proseRelativeSample = formatRelativeWithLocalTime(crossDayTarget, {
    nowMs,
    compact: false,
    clockFormat,
    includeLocalTime: true,
  }).label;

  if (typeof document !== "undefined" && typeof window !== "undefined") {
    patchMetroSessionTimeModules(window as unknown as MetroWindow);
    decorateSessionTimestampsDom(document, nowMs);
  }

  const ok = Boolean(
    sameDaySample &&
      crossDaySample.includes("/") &&
      turnFooterSample.includes("Worked for 1h 29m · ") &&
      sidebarCompactSample.includes(" · ") &&
      proseRelativeSample.includes(" · "),
  );

  const durationMs = Math.max(0, Date.now() - t0);
  const isZh =
    typeof navigator !== "undefined" && isChineseLocale(navigator.language);
  const summary = isZh
    ? `时区 ${tz.timeZone} (${tz.offsetLabel}) 验算通过：今日=${sameDaySample} · 跨日=${crossDaySample} · 回合底部="${turnFooterSample}" · 侧边栏="${sidebarCompactSample}"`
    : `Timezone ${tz.timeZone} (${tz.offsetLabel}) verified: Today=${sameDaySample} · Cross-day=${crossDaySample} · Turn="${turnFooterSample}" · Sidebar="${sidebarCompactSample}"`;

  dispatchSessionTimeEvent();
  return {
    ok,
    timeZone: tz.timeZone,
    offsetLabel: tz.offsetLabel,
    sameDaySample,
    crossDaySample,
    turnFooterSample,
    sidebarCompactSample,
    proseRelativeSample,
    durationMs,
    summary,
  };
}

export function installDesktopSessionTimeEnhancer(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  readSessionTimePreferences();
  const metroWin = window as unknown as MetroWindow;
  patchMetroSessionTimeModules(metroWin);
  decorateSessionTimestampsDom(document);

  let rafId: number | null = null;
  let isMutatingDom = false;

  const runPass = () => {
    if (isMutatingDom) return;
    isMutatingDom = true;
    try {
      if (!healthState.metroHookInstalled) {
        patchMetroSessionTimeModules(metroWin);
      }
      decorateSessionTimestampsDom(document);
    } finally {
      isMutatingDom = false;
    }
  };

  globalRefreshDomFn = runPass;

  const observer = new MutationObserver(() => {
    if (isMutatingDom || rafId !== null) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      runPass();
    });
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Periodic 30-second refresh so relative age ("7h ago · 01:38") stays fresh alongside clock time
  const intervalId = window.setInterval(runPass, 30_000);

  return () => {
    observer.disconnect();
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    window.clearInterval(intervalId);
    if (globalRefreshDomFn === runPass) {
      globalRefreshDomFn = null;
    }
  };
}
