import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pluginSettings } from "../shared/contracts";
import {
  evaluateQuotaQueueDrainGate,
  extractLatestTurnQuotaSignal,
  isQuotaOrRateLimitErrorText,
  parseQuotaCooldownMs,
} from "../shared/quota-queue-contracts";
import { handleManageQuotaQueue, readQuotaQueueStore } from "../server/quota-queue-handlers";
import { installQuotaQueueGuard } from "../client/quota-queue-guard-web";

function createMemStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (k: string) => {
      data.delete(k);
    },
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

class FakeElement {
  id = "";
  tagName: string;
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  style: Record<string, string> & { cssText?: string } = { setProperty: (() => {}) as unknown as string };
  textContent: string | null = null;
  title = "";
  type = "";
  onclick: ((ev: { preventDefault: () => void; stopPropagation: () => void }) => void) | null = null;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }
  setAttribute(k: string, v: string) {
    this.attributes.set(k, v);
    if (k === "id") this.id = v;
  }
  getAttribute(k: string) {
    return this.attributes.get(k) ?? null;
  }
  append(...nodes: FakeElement[]) {
    for (const n of nodes) {
      n.parentElement = this;
      this.children.push(n);
    }
  }
  insertBefore(node: FakeElement, ref: FakeElement | null) {
    if (node.parentElement) {
      node.parentElement.children = node.parentElement.children.filter((c) => c !== node);
    }
    node.parentElement = this;
    const idx = ref ? this.children.indexOf(ref) : -1;
    if (idx >= 0) this.children.splice(idx, 0, node);
    else this.children.push(node);
    return node;
  }
  replaceChildren(...nodes: FakeElement[]) {
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
      this.parentElement = null;
    }
  }
  querySelector<T = FakeElement>(selector: string): T | null {
    const walk = (el: FakeElement): FakeElement | null => {
      if (selector === '[data-role="status"]' && el.attributes.get("data-role") === "status") return el;
      if (selector === '[data-role="check"]' && el.attributes.get("data-role") === "check") return el;
      for (const c of el.children) {
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this) as T | null;
  }
}

function createFakeBrowserEnv() {
  const root = new FakeElement("div");
  root.id = "root";
  const composerParent = new FakeElement("div");
  const anchorRoot = new FakeElement("div");
  const textarea = new FakeElement("textarea");
  const queueBtn = new FakeElement("button");
  queueBtn.setAttribute("aria-label", "Edit queued message");
  const p1 = new FakeElement("div");
  const p2 = new FakeElement("div");
  const p3 = new FakeElement("div");
  p1.append(queueBtn);
  p2.append(p1);
  p3.append(p2);
  anchorRoot.append(p3, textarea);
  composerParent.append(anchorRoot);
  root.append(composerParent);

  const doc = {
    documentElement: new FakeElement("html"),
    body: root,
    createElement: (tag: string) => new FakeElement(tag),
    getElementById: (id: string): FakeElement | null => {
      const walk = (el: FakeElement): FakeElement | null => {
        if (el.id === id) return el;
        for (const c of el.children) {
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      return walk(root);
    },
    querySelector: (sel: string): FakeElement | null => {
      if (sel.includes("queued message")) return queueBtn;
      if (sel === "textarea") return textarea;
      return null;
    },
  };

  const listeners = new Map<string, Set<() => void>>();
  const storage = createMemStorage();
  const win: Record<string, unknown> = {
    document: doc,
    localStorage: storage,
    location: { pathname: "/workspace/local:wks_1/agents/agent-12345678", hash: "" },
    addEventListener: (ev: string, fn: () => void) => {
      const set = listeners.get(ev) ?? new Set();
      set.add(fn);
      listeners.set(ev, set);
    },
    removeEventListener: (ev: string, fn: () => void) => {
      listeners.get(ev)?.delete(fn);
    },
    dispatchEvent: () => true,
    CustomEvent: class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
  };
  return { doc, win, storage };
}

test("settings defaults + quota error pattern & cooldown parsing", () => {
  const parsed = pluginSettings.schema.parse({});
  assert.equal(parsed.enableQuotaQueueGuard, true);
  assert.equal(parsed.quotaQueueAutoDrain, true);

  assert.equal(
    isQuotaOrRateLimitErrorText(
      "[System Error] agent executor error: generating and executing: Error 429, Message: Individual quota reached. Resets in 3h33m47s., Status: RESOURCE_EXHAUSTED",
    ),
    true,
  );
  assert.equal(
    isQuotaOrRateLimitErrorText(
      "[System Error] agent executor error: pre-invocation hook: context summarization: Error 503, Message: Token error: All accounts rate-limited. Cooldown wait 6343s.",
    ),
    true,
  );
  assert.equal(isQuotaOrRateLimitErrorText("You've hit your 5-hour limit · resets 8pm"), true);
  assert.equal(isQuotaOrRateLimitErrorText("apiError: usage_limit_reached"), true);
  assert.equal(isQuotaOrRateLimitErrorText("ENOENT: no such file or directory"), false);

  assert.equal(parseQuotaCooldownMs("Cooldown wait 6343s."), 6343 * 1000);
  assert.equal(parseQuotaCooldownMs("Resets in 3h33m47s."), ((3 * 3600) + (33 * 60) + 47) * 1000);
});

test("extractLatestTurnQuotaSignal catches Paseo notification error items and clears after completed reply", () => {
  const sigBlocked = extractLatestTurnQuotaSignal(
    { id: "a1", status: "error", lastError: "" },
    [
      { kind: "user_message", text: "/compact", timestamp: 1000 },
      {
        kind: "notification",
        sourceType: "error",
        level: "error",
        message: "Error 503, Message: Token error: All accounts rate-limited. Cooldown wait 6343s.",
        timestamp: 2000,
      },
    ],
    3000,
  );
  assert.equal(sigBlocked.hasQuotaError, true);
  assert.equal(sigBlocked.previousTurnIncomplete, true);
  assert.equal(sigBlocked.cooldownMs, 6343 * 1000);

  const sigRecovered = extractLatestTurnQuotaSignal(
    { id: "a1", status: "idle", lastError: null },
    [
      { kind: "user_message", text: "/compact", timestamp: 1000 },
      {
        kind: "notification",
        sourceType: "error",
        level: "error",
        message: "Error 503, Message: Token error: All accounts rate-limited. Cooldown wait 6343s.",
        timestamp: 2000,
      },
      { kind: "compaction", status: "completed", timestamp: 5000 },
      { kind: "user_message", text: "continue", timestamp: 6000 },
      { kind: "assistant_message", text: "Done.", timestamp: 7000 },
    ],
    8000,
  );
  assert.equal(sigRecovered.hasQuotaError, false);
  assert.equal(sigRecovered.previousTurnIncomplete, false);
});

test("evaluateQuotaQueueDrainGate holds on 429/incomplete turn and releases one-by-one after recovery", () => {
  const turnSignal = extractLatestTurnQuotaSignal(
    { id: "a1", status: "error", lastError: "Error 429: Too Many Requests" },
    [{ kind: "user_message", text: "step 1" }],
    10_000,
  );
  const held = evaluateQuotaQueueDrainGate({
    enabled: true,
    queuedCount: 2,
    initializing: false,
    agentRunning: false,
    hasPendingPermission: false,
    turnSignal,
    nowMs: 10_000,
  });
  assert.equal(held.allow, false);
  assert.equal(held.reasonCode, "quota_error_hold");

  const waitPrev = evaluateQuotaQueueDrainGate({
    enabled: true,
    queuedCount: 2,
    initializing: false,
    agentRunning: false,
    hasPendingPermission: false,
    turnSignal,
    serverReadyToDrain: true,
    serverPreviousTurnCompleted: false,
    nowMs: 15_000,
  });
  assert.equal(waitPrev.allow, false);
  assert.equal(waitPrev.reasonCode, "previous_turn_incomplete");

  const allowOne = evaluateQuotaQueueDrainGate({
    enabled: true,
    queuedCount: 2,
    initializing: false,
    agentRunning: false,
    hasPendingPermission: false,
    turnSignal,
    serverReadyToDrain: true,
    serverPreviousTurnCompleted: true,
    nowMs: 20_000,
  });
  assert.equal(allowOne.allow, true);
  assert.equal(allowOne.reasonCode, "ok");

  const serialGap = evaluateQuotaQueueDrainGate({
    enabled: true,
    queuedCount: 1,
    initializing: false,
    agentRunning: false,
    hasPendingPermission: false,
    turnSignal: extractLatestTurnQuotaSignal({ id: "a1", status: "idle" }, [], 20_200),
    serverReadyToDrain: true,
    serverPreviousTurnCompleted: true,
    lastDispatchedAtMs: 20_000,
    nowMs: 20_200,
  });
  assert.equal(serialGap.allow, false);
  assert.equal(serialGap.reasonCode, "drain_cooldown");
});

test("handleManageQuotaQueue persists held messages, triggers recovery before drain, and drains strictly one item", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-quota-queue-"));
  const stateFile = path.join(tmpDir, "quota-queued-messages.json");
  try {
    let phase: "deferred" | "recovering" | "completed" = "deferred";
    const sentPrompts: string[] = [];

    const fakeExec = async (cmd: string, args: string[]) => {
      if (cmd.endsWith("antigravity-ops") && args[0] === "paseo-recovery") {
        const sub = args[1];
        if (phase === "deferred") {
          return {
            stdout: JSON.stringify({
              ok: true,
              proxyHealthy: true,
              agents: [
                {
                  agentId: "agent-12345678",
                  status: "error",
                  classification: "QUOTA_COOLDOWN_DEFERRED",
                  reason: "Cooldown wait 6343s",
                  quotaCooldown: { deferred: true, remainingSecs: 6000, resumeAt: "2026-11-13T12:00:00Z" },
                },
              ],
            }),
          };
        }
        if (phase === "recovering") {
          if (sub === "heal") {
            return {
              stdout: JSON.stringify({
                ok: true,
                proxyHealthy: true,
                agents: [
                  {
                    agentId: "agent-12345678",
                    status: "running",
                    classification: "INTERRUPTED_NEEDS_PULLUP",
                    healed: true,
                    reason: "Pull-up started for Turn 0",
                  },
                ],
              }),
            };
          }
          return {
            stdout: JSON.stringify({
              ok: true,
              proxyHealthy: true,
              agents: [
                {
                  agentId: "agent-12345678",
                  status: "error",
                  classification: "INTERRUPTED_NEEDS_PULLUP",
                  reason: "Turn 0 needs pull-up",
                },
              ],
            }),
          };
        }
        return {
          stdout: JSON.stringify({
            ok: true,
            proxyHealthy: true,
            agents: [
              {
                agentId: "agent-12345678",
                status: "idle",
                classification: "HEALTHY_COMPLETED",
                reason: "Turn completed",
              },
            ],
          }),
        };
      }
      if (cmd.endsWith("paseo") && args[0] === "send") {
        sentPrompts.push(args[args.length - 1]);
        return { stdout: JSON.stringify({ ok: true }), exitCode: 0 };
      }
      return { stdout: "{}" };
    };

    const syncRes = await handleManageQuotaQueue(
      {
        action: "sync",
        agentId: "agent-12345678",
        serverId: "local",
        provider: "antigravity",
        model: "gemini-4-hydrogen-high",
        held: true,
        reasonCode: "quota_error_hold",
        holdReason: "Cooldown wait 6343s",
        queuedMessages: [
          { id: "m1", text: "First queued task", attachments: [] },
          { id: "m2", text: "Second queued task", attachments: [] },
        ],
      },
      undefined,
      { stateFile, execFn: fakeExec },
    );
    assert.equal(syncRes.heldCount, 1);
    assert.equal(syncRes.totalQueuedMessages, 2);

    const checkDeferred = await handleManageQuotaQueue(
      { action: "check", agentId: "agent-12345678", triggerRecoveryIfReady: true, source: "settings-ui" },
      undefined,
      { stateFile, execFn: fakeExec },
    );
    assert.equal(checkDeferred.readyToDrain, false);
    assert.equal(checkDeferred.quotaRefreshed, false);

    phase = "recovering";
    const checkRecovering = await handleManageQuotaQueue(
      { action: "check", agentId: "agent-12345678", triggerRecoveryIfReady: true, source: "settings-ui" },
      undefined,
      { stateFile, execFn: fakeExec },
    );
    assert.equal(checkRecovering.readyToDrain, false);
    assert.equal(checkRecovering.previousTurnCompleted, false);

    phase = "completed";
    const drain1 = await handleManageQuotaQueue(
      { action: "drain_one", agentId: "agent-12345678", source: "settings-ui" },
      undefined,
      { stateFile, execFn: fakeExec },
    );
    assert.deepEqual(sentPrompts, ["First queued task"]);
    assert.equal(drain1.totalQueuedMessages, 1);
    const persistedAfter1 = await readQuotaQueueStore(stateFile);
    assert.equal(persistedAfter1.agents["agent-12345678"].queuedMessages.length, 1);
    assert.equal(persistedAfter1.agents["agent-12345678"].queuedMessages[0].id, "m2");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("installQuotaQueueGuard intercepts HostRuntimeStore.drainQueuedAgentMessage on 429 and drains serially after refresh + Turn 0 completion", async () => {
  const { doc, win, storage } = createFakeBrowserEnv();
  const bridgeRef = () =>
    win.__paseoFinderQuotaQueue as {
      status: () => { installed: boolean; heldAgents: unknown[] };
      checkNow: (aid: string) => Promise<{ allow: boolean } | null>;
    };

  type QueueItem = { id: string; text: string; attachments: unknown[] };
  const queuedMap = new Map<string, QueueItem[]>([
    [
      "agent-12345678",
      [
        { id: "m1", text: "First queued msg", attachments: [] },
        { id: "m2", text: "Second queued msg", attachments: [] },
      ],
    ],
  ]);
  const agentsMap = new Map<string, Record<string, unknown>>([
    [
      "agent-12345678",
      {
        id: "agent-12345678",
        provider: "antigravity",
        model: "gemini-4-hydrogen-high",
        status: "error",
        lastError: "All accounts rate-limited. Cooldown wait 6343s.",
        turn: { phase: "idle" },
      },
    ],
  ]);
  const tailMap = new Map<string, unknown[]>([
    [
      "agent-12345678",
      [
        { kind: "user_message", text: "/compact", timestamp: 1000 },
        {
          kind: "notification",
          sourceType: "error",
          level: "error",
          message: "Error 503, Message: Token error: All accounts rate-limited. Cooldown wait 6343s.",
          timestamp: 2000,
        },
      ],
    ],
  ]);

  const storeListeners = new Set<() => void>();
  const fakeSessionStore = {
    getState: () => ({
      sessions: {
        local: {
          agents: agentsMap,
          queuedMessages: queuedMap,
          initializingAgents: new Map<string, boolean>(),
          pendingPermissions: new Map(),
          agentStreamTail: tailMap,
          agentStreamHead: new Map(),
          client: {},
        },
      },
      setQueuedMessages: (
        _sid: string,
        updater: Map<string, QueueItem[]> | ((p: Map<string, QueueItem[]>) => Map<string, QueueItem[]>),
      ) => {
        const next = typeof updater === "function" ? updater(queuedMap) : updater;
        queuedMap.clear();
        for (const [k, v] of next.entries()) queuedMap.set(k, v);
      },
    }),
    subscribe: (fn: () => void) => {
      storeListeners.add(fn);
      return () => storeListeners.delete(fn);
    },
  };

  const drainedIds: string[] = [];
  class FakeHostRuntimeStore {
    drainQueuedAgentMessage(_serverId: string, agentId: string) {
      const list = queuedMap.get(agentId) ?? [];
      if (list.length === 0) return;
      const head = list[0];
      drainedIds.push(head.id);
      queuedMap.set(agentId, list.slice(1));
    }
  }
  const runtimeInstance = new FakeHostRuntimeStore();

  const moduleMap = new Map<number, { isInitialized: boolean; publicModule: { exports: Record<string, unknown> } }>([
    [1, { isInitialized: true, publicModule: { exports: { useSessionStore: fakeSessionStore } } }],
    [
      2,
      {
        isInitialized: true,
        publicModule: {
          exports: {
            HostRuntimeStore: FakeHostRuntimeStore,
            getHostRuntimeStore: () => runtimeInstance,
          },
        },
      },
    ],
  ]);
  win.__c = moduleMap;

  let serverReady = false;
  let serverPrevDone = false;
  let nowClock = 10_000;

  const dispose = installQuotaQueueGuard({
    win: win as unknown as Window,
    storage,
    nowFn: () => nowClock,
    rpcCall: async (input) => {
      if (input.action === "status") {
        return {
          ok: true,
          readyToDrain: false,
          quotaRefreshed: null,
          previousTurnCompleted: null,
          resumeAtIso: null,
          holdReason: "",
          entries: [],
        };
      }
      if (input.action === "check") {
        return {
          ok: true,
          readyToDrain: serverReady && serverPrevDone,
          quotaRefreshed: serverReady,
          previousTurnCompleted: serverPrevDone,
          resumeAtIso: null,
          holdReason: serverReady ? (serverPrevDone ? "" : "Waiting for previous turn") : "Still cooling down",
        };
      }
      return {
        ok: true,
        readyToDrain: false,
        quotaRefreshed: null,
        previousTurnCompleted: null,
        resumeAtIso: null,
        holdReason: "",
      };
    },
  });

  try {
    assert.equal(bridgeRef().status().installed, true);

    // 1. Agent stops running on 503 quota error -> Paseo calls drainQueuedAgentMessage -> MUST HOLD BOTH m1 and m2!
    runtimeInstance.drainQueuedAgentMessage("local", "agent-12345678");
    assert.deepEqual(drainedIds, []);
    assert.equal(queuedMap.get("agent-12345678")?.length, 2);
    assert.ok(doc.getElementById("paseo-finder-quota-queue-banner"));

    // 2. Quota refreshes, but Turn 0 is still unfinished -> MUST STILL HOLD!
    serverReady = true;
    serverPrevDone = false;
    await bridgeRef().checkNow("agent-12345678");
    assert.deepEqual(drainedIds, []);
    assert.equal(queuedMap.get("agent-12345678")?.length, 2);

    // 3. Turn 0 finishes cleanly -> drains STRICTLY m1 (not m2!)
    serverPrevDone = true;
    agentsMap.set("agent-12345678", {
      id: "agent-12345678",
      provider: "antigravity",
      model: "gemini-4-hydrogen-high",
      status: "idle",
      lastError: null,
      turn: { phase: "idle" },
    });
    tailMap.set("agent-12345678", [
      { kind: "user_message", text: "/compact", timestamp: 1000 },
      { kind: "compaction", status: "completed", timestamp: 5000 },
    ]);
    await bridgeRef().checkNow("agent-12345678");
    assert.deepEqual(drainedIds, ["m1"]);
    assert.equal(queuedMap.get("agent-12345678")?.length, 1);
    assert.equal(queuedMap.get("agent-12345678")?.[0].id, "m2");
    assert.equal(doc.getElementById("paseo-finder-quota-queue-banner"), null);

    // 4. Now suppose m1 runs and completes cleanly -> onAgentStoppedRunning fires -> drains m2 after settle window!
    nowClock += 2_000;
    runtimeInstance.drainQueuedAgentMessage("local", "agent-12345678");
    assert.deepEqual(drainedIds, ["m1", "m2"]);
    assert.equal(queuedMap.get("agent-12345678")?.length, 0);
  } finally {
    dispose();
  }
});
