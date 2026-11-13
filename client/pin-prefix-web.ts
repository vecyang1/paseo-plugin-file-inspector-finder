/// <reference lib="dom" />
import {
  DEFAULT_PIN_PREFIX,
  computePinSyncedTitle,
  hasPinPrefix,
  normalizePinPrefix,
} from "../shared/pin-prefix";
import { getMetroModuleMap, requireMetroExport, type MetroWindow } from "./metro-registry";

export interface PinPrefixPrefs {
  enabled: boolean;
  prefix: string;
}

export interface PinPrefixStateEntry {
  pinned: boolean;
  reconciled: boolean;
  updatedAt: string;
}

export interface PinPrefixReceipt {
  at: string;
  serverId: string;
  workspaceId: string;
  action: "added" | "removed" | "error";
  previousTitle: string;
  nextTitle: string | null;
  reason: "pin-transition" | "initial-backfill" | "manual-sync" | "unpin-transition";
  ok: boolean;
  detail?: string;
}

export interface PinPrefixInspectedItem {
  serverId: string;
  workspaceId: string;
  title: string;
  pinned: boolean;
  hasPrefix: boolean;
  proposedTitle: string | null;
}

export interface PinPrefixStatusSnapshot {
  prefs: PinPrefixPrefs;
  installed: boolean;
  storeAvailable: boolean;
  pinnedCount: number;
  withPrefixCount: number;
  missingPrefixCount: number;
  lastReconciledAt: string | null;
  receipts: PinPrefixReceipt[];
}

export interface SessionStoreWorkspaceLike {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  pinnedAt?: unknown;
  archivedAt?: unknown;
}

export interface SessionStoreAgentLike {
  id?: unknown;
  workspaceId?: unknown;
  title?: unknown;
  parentAgentId?: unknown;
}

export interface SessionStoreLike {
  getState(): {
    sessions?: Record<
      string,
      {
        workspaces?: Map<string, SessionStoreWorkspaceLike> | Record<string, SessionStoreWorkspaceLike>;
        agents?: Map<string, SessionStoreAgentLike> | Record<string, SessionStoreAgentLike>;
      }
    >;
  };
  subscribe?(listener: () => void): () => void;
}

export interface PinPrefixStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface PinTitleApplyContext {
  serverId: string;
  workspaceId: string;
  pinned: boolean;
  previousTitle: string;
  nextTitle: string | null;
  reason: PinPrefixReceipt["reason"];
}

export const PIN_PREFIX_PREFS_STORAGE_KEY = "paseo:finder-plugin:pin-prefix-prefs";
export const PIN_PREFIX_STATE_STORAGE_KEY = "paseo:finder-plugin:pin-prefix-state";
export const PIN_PREFIX_RECEIPTS_STORAGE_KEY = "paseo:finder-plugin:pin-prefix-receipts";
export const PIN_PREFIX_EVENT = "paseo-finder:pin-prefix-updated";
export const DEFAULT_PIN_PREFIX_PREFS: PinPrefixPrefs = {
  enabled: true,
  prefix: DEFAULT_PIN_PREFIX,
};

const MAX_RECEIPTS = 15;
const IN_FLIGHT_TTL_MS = 8000;
const RECONCILE_THROTTLE_MS = 80;
const GLOBAL_BRIDGE_KEY = "__paseoFinderPinPrefix";

let activeBridgeHandle: {
  reconcileNow: (forceBackfill?: boolean) => Promise<{ updated: number; checked: number }>;
  inspect: () => {
    pinnedCount: number;
    withPrefixCount: number;
    missingPrefixCount: number;
    items: PinPrefixInspectedItem[];
  };
  getStatus: () => PinPrefixStatusSnapshot;
  dispose: () => void;
} | null = null;

function getSafeStorage(storage?: PinPrefixStorageLike | null): PinPrefixStorageLike | null {
  if (storage) return storage;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore storage access errors
  }
  return null;
}

function dispatchPinPrefixEvent(win?: Window | null): void {
  const target = win ?? (typeof window !== "undefined" ? window : null);
  if (!target || typeof target.dispatchEvent !== "function" || typeof CustomEvent === "undefined") {
    return;
  }
  try {
    target.dispatchEvent(new CustomEvent(PIN_PREFIX_EVENT));
  } catch {
    // Ignore dispatch errors
  }
}

export function readPinPrefixPrefs(storage?: PinPrefixStorageLike | null): PinPrefixPrefs {
  const store = getSafeStorage(storage);
  if (!store) return { ...DEFAULT_PIN_PREFIX_PREFS };
  try {
    const raw = store.getItem(PIN_PREFIX_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PIN_PREFIX_PREFS };
    const parsed = JSON.parse(raw) as Partial<PinPrefixPrefs>;
    return {
      enabled: parsed.enabled !== false,
      prefix: normalizePinPrefix(typeof parsed.prefix === "string" ? parsed.prefix : DEFAULT_PIN_PREFIX),
    };
  } catch {
    return { ...DEFAULT_PIN_PREFIX_PREFS };
  }
}

export function syncPinPrefixPrefs(
  partial: Partial<PinPrefixPrefs>,
  storage?: PinPrefixStorageLike | null,
  win?: Window | null,
): PinPrefixPrefs {
  const store = getSafeStorage(storage);
  const existing = readPinPrefixPrefs(store);
  const next: PinPrefixPrefs = {
    enabled: partial.enabled ?? existing.enabled,
    prefix:
      partial.prefix !== undefined
        ? normalizePinPrefix(partial.prefix)
        : existing.prefix,
  };
  if (store) {
    try {
      store.setItem(PIN_PREFIX_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage write errors
    }
  }
  dispatchPinPrefixEvent(win);
  if (activeBridgeHandle && next.enabled) {
    void activeBridgeHandle.reconcileNow(false);
  }
  return next;
}

export function readPinPrefixState(
  storage?: PinPrefixStorageLike | null,
): Record<string, PinPrefixStateEntry> {
  const store = getSafeStorage(storage);
  if (!store) return {};
  try {
    const raw = store.getItem(PIN_PREFIX_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PinPrefixStateEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writePinPrefixState(
  state: Record<string, PinPrefixStateEntry>,
  storage?: PinPrefixStorageLike | null,
): void {
  const store = getSafeStorage(storage);
  if (!store) return;
  try {
    store.setItem(PIN_PREFIX_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage write errors
  }
}

export function readPinPrefixReceipts(storage?: PinPrefixStorageLike | null): PinPrefixReceipt[] {
  const store = getSafeStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(PIN_PREFIX_RECEIPTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PinPrefixReceipt[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECEIPTS) : [];
  } catch {
    return [];
  }
}

export function recordPinPrefixReceipt(
  receipt: PinPrefixReceipt,
  storage?: PinPrefixStorageLike | null,
  win?: Window | null,
): PinPrefixReceipt[] {
  const store = getSafeStorage(storage);
  const next = [receipt, ...readPinPrefixReceipts(store)].slice(0, MAX_RECEIPTS);
  if (store) {
    try {
      store.setItem(PIN_PREFIX_RECEIPTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage write errors
    }
  }
  dispatchPinPrefixEvent(win);
  return next;
}

export function findPaseoSessionStore(win?: MetroWindow | null): SessionStoreLike | null {
  const targetWin = (win ?? (typeof window !== "undefined" ? window : null)) as MetroWindow | null;
  if (!targetWin) return null;

  const map = getMetroModuleMap(targetWin);
  if (map) {
    for (const mod of map.values()) {
      const candidate = mod?.isInitialized ? mod.publicModule?.exports?.useSessionStore : null;
      if (candidate && typeof (candidate as SessionStoreLike).getState === "function") {
        return candidate as SessionStoreLike;
      }
    }
  }

  const hit = requireMetroExport("useSessionStore", targetWin);
  const candidate = hit?.exports?.useSessionStore;
  if (candidate && typeof (candidate as SessionStoreLike).getState === "function") {
    return candidate as SessionStoreLike;
  }
  return null;
}

function mapValues<T>(value: unknown): T[] {
  if (value instanceof Map) return Array.from(value.values()) as T[];
  if (value && typeof value === "object") return Object.values(value) as T[];
  return [];
}

function resolveWorkspaceDisplayTitle(
  ws: SessionStoreWorkspaceLike,
  agents: SessionStoreAgentLike[],
): string {
  const explicitTitle = typeof ws.title === "string" ? ws.title.trim() : "";
  if (explicitTitle) return explicitTitle;
  const wsName = typeof ws.name === "string" ? ws.name.trim() : "";
  if (wsName && wsName !== "main") return wsName;
  const wsId = String(ws.id ?? "").trim();
  if (wsId) {
    const primaryAgent =
      agents.find((a) => String(a.workspaceId ?? "").trim() === wsId && !a.parentAgentId && typeof a.title === "string" && a.title.trim()) ??
      agents.find((a) => String(a.workspaceId ?? "").trim() === wsId && typeof a.title === "string" && a.title.trim());
    if (primaryAgent && typeof primaryAgent.title === "string") {
      return primaryAgent.title.trim();
    }
  }
  return "";
}

export function inspectSessionStorePinnedWorkspaces(
  store: SessionStoreLike | null,
  prefix: string = DEFAULT_PIN_PREFIX,
): {
  pinnedCount: number;
  withPrefixCount: number;
  missingPrefixCount: number;
  items: PinPrefixInspectedItem[];
} {
  const norm = normalizePinPrefix(prefix);
  const items: PinPrefixInspectedItem[] = [];
  if (!store) {
    return { pinnedCount: 0, withPrefixCount: 0, missingPrefixCount: 0, items };
  }
  const sessions = store.getState()?.sessions ?? {};
  let withPrefixCount = 0;
  let missingPrefixCount = 0;
  for (const [serverId, session] of Object.entries(sessions)) {
    const workspaces = mapValues<SessionStoreWorkspaceLike>(session?.workspaces);
    const agents = mapValues<SessionStoreAgentLike>(session?.agents);
    for (const ws of workspaces) {
      const wsId = String(ws.id ?? "").trim();
      if (!wsId) continue;
      if (!ws.pinnedAt) continue;
      const title = resolveWorkspaceDisplayTitle(ws, agents);
      const has = hasPinPrefix(title, norm);
      if (has) withPrefixCount += 1;
      else missingPrefixCount += 1;
      const sync = computePinSyncedTitle(title, true, norm);
      items.push({
        serverId,
        workspaceId: wsId,
        title,
        pinned: true,
        hasPrefix: has,
        proposedTitle: sync.changed ? sync.nextTitle : title,
      });
    }
  }
  return {
    pinnedCount: items.length,
    withPrefixCount,
    missingPrefixCount,
    items,
  };
}

export interface ReconcilePinOptions {
  store: SessionStoreLike | null;
  storage?: PinPrefixStorageLike | null;
  win?: Window | null;
  prefs?: PinPrefixPrefs;
  forceBackfill?: boolean;
  inFlightWrites?: Map<string, { nextTitle: string | null; pinned?: boolean; atMs: number }>;
  onApplyTitle: (ctx: PinTitleApplyContext) => Promise<void> | void;
}

export async function reconcilePinTitlePrefixes(
  options: ReconcilePinOptions,
): Promise<{ updated: number; checked: number }> {
  const { store, storage, win, forceBackfill = false, onApplyTitle } = options;
  if (!store) return { updated: 0, checked: 0 };

  const prefs = options.prefs ?? readPinPrefixPrefs(storage);
  if (!prefs.enabled && !forceBackfill) {
    return { updated: 0, checked: 0 };
  }

  const inFlight =
    options.inFlightWrites ??
    new Map<string, { nextTitle: string | null; pinned?: boolean; atMs: number }>();
  const prevState = readPinPrefixState(storage);
  const nextState: Record<string, PinPrefixStateEntry> = { ...prevState };
  let stateChanged = false;

  const sessions = store.getState()?.sessions ?? {};
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const pendingOps: Array<() => Promise<void>> = [];
  let checked = 0;

  for (const [serverId, session] of Object.entries(sessions)) {
    const workspaces = mapValues<SessionStoreWorkspaceLike>(session?.workspaces);
    const agents = mapValues<SessionStoreAgentLike>(session?.agents);

    for (const ws of workspaces) {
      const wsId = String(ws.id ?? "").trim();
      if (!wsId) continue;
      checked += 1;

      const key = `${serverId}:${wsId}`;
      const isPinned = Boolean(ws.pinnedAt);
      const prev = prevState[key];
      const currentTitle = resolveWorkspaceDisplayTitle(ws, agents);
      const inflightEntry = inFlight.get(key);

      if (inflightEntry && nowMs - inflightEntry.atMs < IN_FLIGHT_TTL_MS) {
        if ((currentTitle || null) === (inflightEntry.nextTitle || null)) {
          inFlight.delete(key);
        } else if (!forceBackfill && (inflightEntry.pinned === undefined || inflightEntry.pinned === isPinned)) {
          continue;
        }
      } else if (inflightEntry) {
        inFlight.delete(key);
      }

      if (isPinned) {
        const shouldApply =
          forceBackfill ||
          !prev ||
          !prev.pinned ||
          !prev.reconciled;

        if (!prev || !prev.pinned || !prev.reconciled) {
          nextState[key] = {
            pinned: true,
            reconciled: true,
            updatedAt: nowIso,
          };
          stateChanged = true;
        }

        if (shouldApply && !hasPinPrefix(currentTitle, prefs.prefix)) {
          const sync = computePinSyncedTitle(currentTitle, true, prefs.prefix);
          if (sync.changed) {
            const reason: PinPrefixReceipt["reason"] = forceBackfill
              ? "manual-sync"
              : prev && !prev.pinned
                ? "pin-transition"
                : "initial-backfill";
            inFlight.set(key, { nextTitle: sync.nextTitle, pinned: true, atMs: nowMs });
            pendingOps.push(async () => {
              try {
                await onApplyTitle({
                  serverId,
                  workspaceId: wsId,
                  pinned: true,
                  previousTitle: currentTitle,
                  nextTitle: sync.nextTitle,
                  reason,
                });
                recordPinPrefixReceipt(
                  {
                    at: new Date().toISOString(),
                    serverId,
                    workspaceId: wsId,
                    action: "added",
                    previousTitle: currentTitle,
                    nextTitle: sync.nextTitle,
                    reason,
                    ok: true,
                  },
                  storage,
                  win,
                );
              } catch (err) {
                inFlight.delete(key);
                recordPinPrefixReceipt(
                  {
                    at: new Date().toISOString(),
                    serverId,
                    workspaceId: wsId,
                    action: "error",
                    previousTitle: currentTitle,
                    nextTitle: sync.nextTitle,
                    reason,
                    ok: false,
                    detail: err instanceof Error ? err.message : String(err),
                  },
                  storage,
                  win,
                );
              }
            });
          }
        }
      } else if (prev?.pinned) {
        delete nextState[key];
        stateChanged = true;

        if (hasPinPrefix(currentTitle, prefs.prefix)) {
          const sync = computePinSyncedTitle(currentTitle, false, prefs.prefix);
          if (sync.changed) {
            inFlight.set(key, { nextTitle: sync.nextTitle, pinned: false, atMs: nowMs });
            pendingOps.push(async () => {
              try {
                await onApplyTitle({
                  serverId,
                  workspaceId: wsId,
                  pinned: false,
                  previousTitle: currentTitle,
                  nextTitle: sync.nextTitle,
                  reason: "unpin-transition",
                });
                recordPinPrefixReceipt(
                  {
                    at: new Date().toISOString(),
                    serverId,
                    workspaceId: wsId,
                    action: "removed",
                    previousTitle: currentTitle,
                    nextTitle: sync.nextTitle,
                    reason: "unpin-transition",
                    ok: true,
                  },
                  storage,
                  win,
                );
              } catch (err) {
                inFlight.delete(key);
                recordPinPrefixReceipt(
                  {
                    at: new Date().toISOString(),
                    serverId,
                    workspaceId: wsId,
                    action: "error",
                    previousTitle: currentTitle,
                    nextTitle: sync.nextTitle,
                    reason: "unpin-transition",
                    ok: false,
                    detail: err instanceof Error ? err.message : String(err),
                  },
                  storage,
                  win,
                );
              }
            });
          }
        }
      }
    }
  }

  if (stateChanged) {
    writePinPrefixState(nextState, storage);
  }

  for (const op of pendingOps) {
    await op();
  }

  return { updated: pendingOps.length, checked };
}

export function getPinPrefixStatus(
  winOverride?: Window | null,
  storageOverride?: PinPrefixStorageLike | null,
): PinPrefixStatusSnapshot {
  const win = winOverride ?? (typeof window !== "undefined" ? window : null);
  const storage = getSafeStorage(storageOverride ?? win?.localStorage ?? null);
  const prefs = readPinPrefixPrefs(storage);
  const store = findPaseoSessionStore(win as unknown as MetroWindow | null);
  const inspected = inspectSessionStorePinnedWorkspaces(store, prefs.prefix);
  const receipts = readPinPrefixReceipts(storage);
  return {
    prefs,
    installed: Boolean(activeBridgeHandle),
    storeAvailable: Boolean(store),
    pinnedCount: inspected.pinnedCount,
    withPrefixCount: inspected.withPrefixCount,
    missingPrefixCount: inspected.missingPrefixCount,
    lastReconciledAt: receipts[0]?.at ?? null,
    receipts,
  };
}

export function inspectPinnedWorkspacesNow(
  winOverride?: Window | null,
  storageOverride?: PinPrefixStorageLike | null,
) {
  const win = winOverride ?? (typeof window !== "undefined" ? window : null);
  const storage = getSafeStorage(storageOverride ?? win?.localStorage ?? null);
  const prefs = readPinPrefixPrefs(storage);
  const store = findPaseoSessionStore(win as unknown as MetroWindow | null);
  return inspectSessionStorePinnedWorkspaces(store, prefs.prefix);
}

export async function reconcileAllPinnedNow(): Promise<{ updated: number; checked: number }> {
  if (activeBridgeHandle) {
    return activeBridgeHandle.reconcileNow(true);
  }
  return { updated: 0, checked: 0 };
}

export function installPinTitlePrefixSync(options: {
  win?: Window | null;
  storage?: PinPrefixStorageLike | null;
  onApplyTitle: (ctx: PinTitleApplyContext) => Promise<void> | void;
}): () => void {
  const win = options.win ?? (typeof window !== "undefined" ? window : null);
  if (!win) return () => {};
  const storage = getSafeStorage(options.storage ?? win.localStorage ?? null);

  if (activeBridgeHandle) {
    activeBridgeHandle.dispose();
  }

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeStore: (() => void) | null = null;
  let boundStore: SessionStoreLike | null = null;
  const inFlightWrites = new Map<string, { nextTitle: string | null; atMs: number }>();

  const runReconcile = async (forceBackfill = false) => {
    if (disposed) return { updated: 0, checked: 0 };
    const store = boundStore ?? findPaseoSessionStore(win as unknown as MetroWindow);
    if (!store) return { updated: 0, checked: 0 };
    if (!boundStore) {
      boundStore = store;
      if (typeof store.subscribe === "function") {
        unsubscribeStore = store.subscribe(() => {
          scheduleReconcile();
        });
      }
    }
    return reconcilePinTitlePrefixes({
      store,
      storage,
      win,
      forceBackfill,
      inFlightWrites,
      onApplyTitle: options.onApplyTitle,
    });
  };

  const scheduleReconcile = () => {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void runReconcile(false);
    }, RECONCILE_THROTTLE_MS);
  };

  const tryBindStore = () => {
    if (disposed) return;
    const store = findPaseoSessionStore(win as unknown as MetroWindow);
    if (!store) return;
    boundStore = store;
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (typeof store.subscribe === "function") {
      unsubscribeStore = store.subscribe(() => {
        scheduleReconcile();
      });
    }
    void runReconcile(false);
  };

  tryBindStore();
  if (!boundStore) {
    let attempts = 0;
    pollTimer = setInterval(() => {
      attempts += 1;
      tryBindStore();
      if (boundStore || attempts >= 40) {
        if (pollTimer !== null) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }
    }, 250);
  }

  const dispose = () => {
    disposed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (unsubscribeStore) {
      unsubscribeStore();
      unsubscribeStore = null;
    }
    if (activeBridgeHandle?.dispose === dispose) {
      activeBridgeHandle = null;
    }
  };

  activeBridgeHandle = {
    reconcileNow: runReconcile,
    inspect: () => inspectPinnedWorkspacesNow(win, storage),
    getStatus: () => getPinPrefixStatus(win, storage),
    dispose,
  };

  (win as unknown as Record<string, unknown>)[GLOBAL_BRIDGE_KEY] = {
    status: () => getPinPrefixStatus(win, storage),
    inspect: () => inspectPinnedWorkspacesNow(win, storage),
    syncAll: () => runReconcile(true),
    reconcileNow: (force?: boolean) => runReconcile(Boolean(force)),
    setPrefs: (partial: Partial<PinPrefixPrefs>) => syncPinPrefixPrefs(partial, storage, win),
  };

  return dispose;
}
