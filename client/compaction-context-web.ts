/**
 * Claude-parity ContextWindowMeter hydrator and compaction marker token enhancer for Antigravity
 * and Claude sessions in Paseo.
 *
 * 1. Hooks `getCompactionMarkerLabel` via `requireMetroExport` (never calling `window.__c`) so
 *    completed manual and automatic compactions display their compacted token volume instead of
 *    dropping `preTokens`. Auto-retires if upstream already formats the token count.
 * 2. Hydrates `agent.lastUsage.{contextWindowMaxTokens, contextWindowUsedTokens}` in Paseo's
 *    `useSessionStore` for Antigravity sessions so `<ContextWindowMeter>` renders live and updates
 *    after `/compact`, surviving Paseo Desktop auto-updates without touching `Paseo.app`.
 */
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  type AntigravityContextSnapshot,
  formatEnhancedCompactionLabel,
  inspectAntigravityContextRpc,
} from "../shared/compaction-context-contracts";
import { type MetroWindow, getMetroModuleMap, requireMetroExport } from "./metro-registry";

export interface CompactionContextPrefs {
  enrichCompactionTokens: boolean;
  hydrateContextWindowMeter: boolean;
}

export const DEFAULT_COMPACTION_CONTEXT_PREFS: CompactionContextPrefs = {
  enrichCompactionTokens: true,
  hydrateContextWindowMeter: true,
};

export interface CompactionContextStatus {
  labelHook: { installed: boolean; moduleId: number | null };
  hydratedAgentsCount: number;
  lastHydratedAt: string | null;
  prefs: CompactionContextPrefs;
}

export type SessionStoreStateShape = {
  sessions?: Record<
    string,
    {
      agents?: Map<string, Record<string, unknown>>;
    }
  >;
  [key: string]: unknown;
};

export type SessionStoreShape = {
  getState: () => SessionStoreStateShape;
  setState?: (
    updater: (prev: SessionStoreStateShape) => SessionStoreStateShape,
  ) => void;
  subscribe?: (listener: () => void) => () => void;
};

const PREFS_KEY = "paseo:finder-plugin:compaction-context-prefs";

const runtimeState: {
  prefs: CompactionContextPrefs;
  labelHook: { installed: boolean; moduleId: number | null };
  hydratedAgentsCount: number;
  lastHydratedAt: string | null;
  getLocale: () => string;
} = {
  prefs: { ...DEFAULT_COMPACTION_CONTEXT_PREFS },
  labelHook: { installed: false, moduleId: null },
  hydratedAgentsCount: 0,
  lastHydratedAt: null,
  getLocale: () => "en",
};

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadCompactionContextPrefs(): CompactionContextPrefs {
  const raw = storage()?.getItem(PREFS_KEY);
  if (!raw) return { ...DEFAULT_COMPACTION_CONTEXT_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<CompactionContextPrefs>;
    return {
      enrichCompactionTokens: parsed.enrichCompactionTokens !== false,
      hydrateContextWindowMeter: parsed.hydrateContextWindowMeter !== false,
    };
  } catch {
    return { ...DEFAULT_COMPACTION_CONTEXT_PREFS };
  }
}

export function syncCompactionContextPrefs(
  next: Partial<CompactionContextPrefs>,
): CompactionContextPrefs {
  runtimeState.prefs = { ...runtimeState.prefs, ...next };
  storage()?.setItem(PREFS_KEY, JSON.stringify(runtimeState.prefs));
  return { ...runtimeState.prefs };
}

export function getCompactionContextStatus(): CompactionContextStatus {
  return {
    labelHook: { ...runtimeState.labelHook },
    hydratedAgentsCount: runtimeState.hydratedAgentsCount,
    lastHydratedAt: runtimeState.lastHydratedAt,
    prefs: { ...runtimeState.prefs },
  };
}

export function patchMetroCompactionMarkerLabel(
  win?: MetroWindow | null,
  getLocale?: () => string,
): { installed: boolean; moduleId: number | null } {
  if (getLocale) runtimeState.getLocale = getLocale;
  const hit = requireMetroExport("getCompactionMarkerLabel", win);
  if (!hit || typeof hit.exports.getCompactionMarkerLabel !== "function") {
    return runtimeState.labelHook;
  }
  const exp = hit.exports as Record<string, unknown>;
  if (!exp.__paseoFinderCompactionLabelPatched) {
    const origFn = exp.getCompactionMarkerLabel as (input: {
      status: "loading" | "completed";
      trigger?: "auto" | "manual";
      preTokens?: number;
    }) => string;

    Object.defineProperty(exp, "__paseoFinderCompactionLabelPatched", {
      value: true,
      configurable: true,
    });

    exp.getCompactionMarkerLabel = function patchedGetCompactionMarkerLabel(input: {
      status: "loading" | "completed";
      trigger?: "auto" | "manual";
      preTokens?: number;
    }): string {
      const baseLabel = origFn(input);
      if (!runtimeState.prefs.enrichCompactionTokens) return baseLabel;
      return formatEnhancedCompactionLabel({
        status: input.status,
        trigger: input.trigger,
        preTokens: input.preTokens,
        baseLabel,
        locale: runtimeState.getLocale(),
      });
    };
  }

  runtimeState.labelHook = { installed: true, moduleId: hit.id };
  return { ...runtimeState.labelHook };
}

function resolveLiveSessionStore(win?: MetroWindow | null): SessionStoreShape | null {
  try {
    const map = getMetroModuleMap(win);
    if (map) {
      for (const m of map.values()) {
        const candidate = m?.isInitialized ? m.publicModule?.exports?.useSessionStore : null;
        if (
          candidate &&
          typeof (candidate as { getState?: unknown }).getState === "function" &&
          typeof (candidate as { setState?: unknown }).setState === "function"
        ) {
          return candidate as SessionStoreShape;
        }
      }
    }
    const hit = requireMetroExport("useSessionStore", win);
    const candidate = hit?.exports?.useSessionStore;
    if (
      candidate &&
      typeof (candidate as { getState?: unknown }).getState === "function" &&
      typeof (candidate as { setState?: unknown }).setState === "function"
    ) {
      return candidate as SessionStoreShape;
    }
  } catch {
    return null;
  }
  return null;
}

export function hydrateAntigravityContextWindowInStore(
  store: SessionStoreShape | null,
  snapshots: readonly AntigravityContextSnapshot[],
): number {
  if (!store || typeof store.setState !== "function" || snapshots.length === 0) return 0;
  const byAgentId = new Map<string, AntigravityContextSnapshot>();
  for (const snap of snapshots) {
    if (snap.agentId && snap.contextWindowMaxTokens > 0) {
      byAgentId.set(snap.agentId, snap);
    }
  }
  if (byAgentId.size === 0) return 0;

  let updatedCount = 0;
  store.setState((prev) => {
    const rawSessions = prev.sessions as
      | Record<string, { agents?: Map<string, Record<string, unknown>> }>
      | undefined;
    if (!rawSessions || typeof rawSessions !== "object") return prev;

    let nextSessions: NonNullable<SessionStoreStateShape["sessions"]> | null = null;
    for (const [serverId, hostSession] of Object.entries(rawSessions)) {
      if (!hostSession || !(hostSession.agents instanceof Map)) continue;
      let nextAgents: Map<string, Record<string, unknown>> | null = null;
      for (const [agentId, agent] of hostSession.agents.entries()) {
        const snap = byAgentId.get(agentId);
        if (!snap || agent.provider !== "antigravity") continue;
        const prevUsage = (agent.lastUsage ?? {}) as Record<string, unknown>;
        const nextMax = snap.contextWindowMaxTokens;
        const nextUsed =
          snap.contextWindowUsedTokens > 0
            ? snap.contextWindowUsedTokens
            : typeof prevUsage.contextWindowUsedTokens === "number"
              ? prevUsage.contextWindowUsedTokens
              : 0;
        const nextIn = snap.inputTokens > 0 ? snap.inputTokens : (prevUsage.inputTokens as number | undefined);
        const nextOut = snap.outputTokens > 0 ? snap.outputTokens : (prevUsage.outputTokens as number | undefined);
        const nextCache =
          snap.cachedInputTokens > 0
            ? snap.cachedInputTokens
            : (prevUsage.cachedInputTokens as number | undefined);

        if (
          prevUsage.contextWindowMaxTokens === nextMax &&
          (prevUsage.contextWindowUsedTokens ?? 0) === nextUsed &&
          prevUsage.inputTokens === nextIn &&
          prevUsage.outputTokens === nextOut &&
          prevUsage.cachedInputTokens === nextCache
        ) {
          continue;
        }

        if (!nextAgents) nextAgents = new Map(hostSession.agents);
        const mergedUsage: Record<string, unknown> = {
          ...prevUsage,
          contextWindowMaxTokens: nextMax,
          contextWindowUsedTokens: nextUsed,
        };
        if (typeof nextIn === "number") mergedUsage.inputTokens = nextIn;
        if (typeof nextOut === "number") mergedUsage.outputTokens = nextOut;
        if (typeof nextCache === "number") mergedUsage.cachedInputTokens = nextCache;
        nextAgents.set(agentId, { ...agent, lastUsage: mergedUsage });
        updatedCount += 1;
      }
      if (nextAgents) {
        if (!nextSessions) nextSessions = { ...rawSessions };
        nextSessions[serverId] = { ...hostSession, agents: nextAgents };
      }
    }
    return nextSessions ? { ...prev, sessions: nextSessions } : prev;
  });

  if (updatedCount > 0) {
    runtimeState.hydratedAgentsCount += updatedCount;
    runtimeState.lastHydratedAt = new Date().toISOString();
  }
  return updatedCount;
}

function resolveActiveRouteWorkspaceId(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const pathname = window.location?.pathname ?? "";
    const match = /\/workspace\/(wks_[A-Za-z0-9_-]+)/.exec(pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function collectAntigravityAgentIdsNeedingContext(
  store: SessionStoreShape | null,
  seenStampByAgent: Map<string, string>,
  activeWorkspaceId?: string | null,
): { agentIds: string[]; hasMore: boolean } {
  if (!store) return { agentIds: [], hasMore: false };
  const state = store.getState();
  const sessions = state?.sessions ?? {};
  const priority: string[] = [];
  const background: string[] = [];
  for (const hostSession of Object.values(sessions)) {
    if (!hostSession || !(hostSession.agents instanceof Map)) continue;
    for (const [agentId, agent] of hostSession.agents.entries()) {
      if (agent.provider !== "antigravity") continue;
      const usage = (agent.lastUsage ?? {}) as Record<string, unknown>;
      const status = String(agent.status ?? "");
      const updatedRaw = agent.updatedAt;
      const updatedKey =
        updatedRaw instanceof Date
          ? String(updatedRaw.getTime())
          : typeof updatedRaw === "string" || typeof updatedRaw === "number"
            ? String(updatedRaw)
            : "";
      const stamp = `${status}:${updatedKey}`;
      const missingMeter =
        typeof usage.contextWindowMaxTokens !== "number" ||
        typeof usage.contextWindowUsedTokens !== "number";
      if (missingMeter || seenStampByAgent.get(agentId) !== stamp) {
        if (activeWorkspaceId && agent.workspaceId === activeWorkspaceId) {
          priority.push(agentId);
        } else {
          background.push(agentId);
        }
      }
    }
  }
  const allCandidates = [...priority, ...background];
  const selected = allCandidates.slice(0, 60);
  for (const agentId of selected) {
    for (const hostSession of Object.values(sessions)) {
      const agent = hostSession?.agents instanceof Map ? hostSession.agents.get(agentId) : undefined;
      if (!agent) continue;
      const status = String(agent.status ?? "");
      const updatedRaw = agent.updatedAt;
      const updatedKey =
        updatedRaw instanceof Date
          ? String(updatedRaw.getTime())
          : typeof updatedRaw === "string" || typeof updatedRaw === "number"
            ? String(updatedRaw)
            : "";
      seenStampByAgent.set(agentId, `${status}:${updatedKey}`);
      break;
    }
  }
  return { agentIds: selected, hasMore: allCandidates.length > selected.length };
}

export function installCompactionAndContextEnhancer(options: {
  call: (
    def: typeof inspectAntigravityContextRpc,
    input: RpcInput<typeof inspectAntigravityContextRpc>,
  ) => Promise<RpcOutput<typeof inspectAntigravityContextRpc>>;
  getLocale?: () => string;
}): () => void {
  runtimeState.prefs = loadCompactionContextPrefs();
  if (options.getLocale) runtimeState.getLocale = options.getLocale;

  const win = (typeof window !== "undefined" ? window : null) as unknown as MetroWindow | null;
  if (!win) return () => {};

  patchMetroCompactionMarkerLabel(win, options.getLocale);

  const seenStampByAgent = new Map<string, string>();
  let inflight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let storeUnsubscribe: (() => void) | null = null;
  let disposed = false;

  const schedulePass = (delayMs = 240): void => {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void runHydrationPass();
    }, delayMs);
  };

  const runHydrationPass = async (forceAgentIds?: string[]): Promise<number> => {
    if (disposed || inflight || !runtimeState.prefs.hydrateContextWindowMeter) return 0;
    patchMetroCompactionMarkerLabel(win, options.getLocale);
    const store = resolveLiveSessionStore(win);
    if (!store) return 0;
    const activeWsId = resolveActiveRouteWorkspaceId();
    let agentIds: string[];
    let hasMore = false;
    if (forceAgentIds && forceAgentIds.length > 0) {
      agentIds = forceAgentIds.slice(0, 80);
    } else {
      const picked = collectAntigravityAgentIdsNeedingContext(store, seenStampByAgent, activeWsId);
      agentIds = picked.agentIds;
      hasMore = picked.hasMore;
    }
    if (agentIds.length === 0) return 0;
    inflight = true;
    try {
      const res = await options.call(inspectAntigravityContextRpc, {
        agentIds,
        includeCompactionHistory: false,
      });
      if (!res?.ok || !Array.isArray(res.items)) return 0;
      const count = hydrateAntigravityContextWindowInStore(store, res.items);
      if (hasMore) schedulePass(140);
      return count;
    } catch {
      return 0;
    } finally {
      inflight = false;
    }
  };

  const tryBindStore = (): void => {
    if (disposed || storeUnsubscribe) return;
    const store = resolveLiveSessionStore(win);
    if (store && typeof store.subscribe === "function") {
      storeUnsubscribe = store.subscribe(() => schedulePass(350));
      schedulePass(60);
    }
  };

  tryBindStore();
  const bootInterval = setInterval(() => {
    patchMetroCompactionMarkerLabel(win, options.getLocale);
    tryBindStore();
  }, 2500);

  (globalThis as Record<string, unknown>).__paseoFinderCompactionContext = {
    status: getCompactionContextStatus,
    setPrefs: syncCompactionContextPrefs,
    refreshNow: (agentIds?: string[]) => runHydrationPass(agentIds),
    selfTest: () => ({
      ok: runtimeState.labelHook.installed && Boolean(resolveLiveSessionStore(win)),
      ...getCompactionContextStatus(),
      storeAvailable: Boolean(resolveLiveSessionStore(win)),
    }),
  };

  return () => {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    clearInterval(bootInterval);
    storeUnsubscribe?.();
  };
}
