import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  formatEnhancedCompactionLabel,
  resolveAntigravityModelContextMaxTokens,
} from "../shared/compaction-context-contracts";
import {
  parseAntigravityTranscriptContext,
  handleInspectAntigravityContext,
} from "../server/compaction-context-handlers";
import {
  type SessionStoreShape,
  type SessionStoreStateShape,
  hydrateAntigravityContextWindowInStore,
  patchMetroCompactionMarkerLabel,
  syncCompactionContextPrefs,
} from "../client/compaction-context-web";

test("formatEnhancedCompactionLabel preserves loading state and enriches manual/auto preTokens in single language", () => {
  assert.equal(
    formatEnhancedCompactionLabel({
      status: "loading",
      trigger: "manual",
      preTokens: 169465,
      baseLabel: "Compacting...",
      locale: "en",
    }),
    "Compacting...",
  );

  assert.equal(
    formatEnhancedCompactionLabel({
      status: "completed",
      trigger: "manual",
      preTokens: 169465,
      baseLabel: "Context manually compacted",
      locale: "en-US",
    }),
    "Context manually compacted · 169K tokens",
  );

  assert.equal(
    formatEnhancedCompactionLabel({
      status: "completed",
      trigger: "auto",
      preTokens: 262910,
      baseLabel: "Context automatically compacted",
      locale: "en",
    }),
    "Context automatically compacted · 263K tokens",
  );

  assert.equal(
    formatEnhancedCompactionLabel({
      status: "completed",
      trigger: "manual",
      preTokens: 169465,
      baseLabel: "Context manually compacted",
      locale: "zh-CN",
    }),
    "已手动压缩上下文 · 169K 词元",
  );

  // Auto-retires if upstream Paseo already formatted tokens into baseLabel
  assert.equal(
    formatEnhancedCompactionLabel({
      status: "completed",
      trigger: "manual",
      preTokens: 169465,
      baseLabel: "Context manually compacted (169K tokens)",
      locale: "en",
    }),
    "Context manually compacted (169K tokens)",
  );
});

test("resolveAntigravityModelContextMaxTokens maps 1M, 200K, and 128K models accurately", () => {
  assert.equal(resolveAntigravityModelContextMaxTokens("gemini-4-argon-high"), 1_000_000);
  assert.equal(resolveAntigravityModelContextMaxTokens("gemini-3.8-flash-high"), 1_000_000);
  assert.equal(resolveAntigravityModelContextMaxTokens("claude-opus-5-5-high"), 1_000_000);
  assert.equal(resolveAntigravityModelContextMaxTokens("claude-opus-4-6-thinking"), 200_000);
  assert.equal(resolveAntigravityModelContextMaxTokens("gpt-oss-120b-medium"), 128_000);
});

test("patchMetroCompactionMarkerLabel hooks Metro module 5288 export without calling window.__c", () => {
  const exportsObj: Record<string, unknown> = {
    getCompactionMarkerLabel({
      status,
      trigger,
      preTokens,
    }: {
      status: "loading" | "completed";
      trigger?: "auto" | "manual";
      preTokens?: number;
    }) {
      if (status === "loading") return "Compacting...";
      if (trigger === "auto") return "Context automatically compacted";
      if (trigger === "manual") return "Context manually compacted";
      if (preTokens) return `Context compacted (${Math.round(preTokens / 1000)}K tokens)`;
      return "Context compacted";
    },
  };

  let clearCalled = false;
  const moduleMap = new Map<number, { isInitialized: boolean; publicModule: { exports: Record<string, unknown> } }>();
  for (let i = 0; i < 60; i++) {
    moduleMap.set(i, { isInitialized: true, publicModule: { exports: {} } });
  }
  moduleMap.set(5288, { isInitialized: true, publicModule: { exports: exportsObj } });

  const fakeWin = {
    __c() {
      clearCalled = true;
      return new Map();
    },
    __r(id: number) {
      return moduleMap.get(id)?.publicModule.exports;
    },
  };

  syncCompactionContextPrefs({ enrichCompactionTokens: true });
  const hooked = patchMetroCompactionMarkerLabel(fakeWin, () => "en");
  assert.equal(hooked.installed, true);
  assert.equal(hooked.moduleId, 5288);
  assert.equal(clearCalled, false);

  const fn = exportsObj.getCompactionMarkerLabel as (arg: {
    status: "loading" | "completed";
    trigger?: "auto" | "manual";
    preTokens?: number;
  }) => string;
  assert.equal(fn({ status: "loading", trigger: "manual", preTokens: 127132 }), "Compacting...");
  assert.equal(
    fn({ status: "completed", trigger: "manual", preTokens: 127132 }),
    "Context manually compacted · 127K tokens",
  );

  syncCompactionContextPrefs({ enrichCompactionTokens: false });
  assert.equal(fn({ status: "completed", trigger: "manual", preTokens: 127132 }), "Context manually compacted");
  syncCompactionContextPrefs({ enrichCompactionTokens: true });
});

test("parseAntigravityTranscriptContext & handleInspectAntigravityContext compute live and post-compact context tokens", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "finder-compact-ctx-"));
  try {
    const cid = "1e4748bf-56ac-4c93-b86b-6f9c7d39325e";
    const logDir = path.join(tmpRoot, ".gemini", "antigravity-cli", "brain", cid, ".system_generated", "logs");
    const agentsDir = path.join(tmpRoot, ".paseo", "agents", "wks_demo");
    await fs.mkdir(logDir, { recursive: true });
    await fs.mkdir(agentsDir, { recursive: true });

    const rows = [
      { step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", content: "Build feature X" },
      {
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        input_tokens: 18500,
        cache_read_tokens: 92000,
        output_tokens: 1200,
        content: "Implemented feature X.",
      },
      { step_index: 2, source: "USER_EXPLICIT", type: "USER_INPUT", content: "/compact" },
      {
        step_index: 3,
        source: "SYSTEM",
        type: "CHECKPOINT",
        status: "DONE",
        created_at: "2026-11-11T08:00:00Z",
        input_tokens: 127132,
        cache_read_tokens: 40000,
        output_tokens: 2333,
        content: "# Resuming from a compaction\n\nSummary of feature X architecture and verification state.",
      },
    ];
    await fs.writeFile(
      path.join(logDir, "transcript_full.jsonl"),
      rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
      "utf8",
    );

    const parsed = parseAntigravityTranscriptContext(
      rows.map((r) => JSON.stringify(r)).join("\n"),
      "gemini-4-argon-high",
    );
    assert.equal(parsed.contextWindowMaxTokens, 1_000_000);
    assert.equal(parsed.compactionCount, 1);
    assert.equal(parsed.lastCompaction?.trigger, "manual");
    assert.equal(parsed.lastCompaction?.preTokens, 169465);
    assert.ok(parsed.contextWindowUsedTokens > 0 && parsed.contextWindowUsedTokens < 169465);

    await fs.writeFile(
      path.join(agentsDir, "ag_demo1.json"),
      JSON.stringify({
        id: "ag_demo1",
        workspaceId: "wks_demo",
        provider: "antigravity",
        model: "gemini-4-argon-high",
        persistence: {
          sessionId: `plugin:${JSON.stringify({ version: 1, data: { conversationId: cid } })}`,
        },
      }),
      "utf8",
    );

    const rpcRes = await handleInspectAntigravityContext(
      { workspaceId: "wks_demo", includeCompactionHistory: true },
      { homeDir: tmpRoot },
    );
    assert.equal(rpcRes.ok, true);
    assert.equal(rpcRes.items.length, 1);
    assert.equal(rpcRes.items[0]?.agentId, "ag_demo1");
    assert.equal(rpcRes.items[0]?.contextWindowMaxTokens, 1_000_000);
    assert.equal(rpcRes.items[0]?.lastCompaction?.preTokens, 169465);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("hydrateAntigravityContextWindowInStore updates Antigravity lastUsage immutably without touching Claude or unchanged rows", () => {
  const agents = new Map<string, Record<string, unknown>>([
    [
      "ag_1",
      {
        id: "ag_1",
        provider: "antigravity",
        model: "gemini-3.8-flash-high",
        lastUsage: { inputTokens: 100, outputTokens: 20 },
      },
    ],
    [
      "cl_1",
      {
        id: "cl_1",
        provider: "claude",
        model: "claude-fable-5-2",
        lastUsage: { contextWindowMaxTokens: 1_000_000, contextWindowUsedTokens: 55_000 },
      },
    ],
  ]);

  let state: SessionStoreStateShape = {
    sessions: { srv_local: { agents } },
  };
  let setStateCalls = 0;

  const fakeStore: SessionStoreShape = {
    getState: () => state,
    setState: (updater) => {
      const next = updater(state);
      if (next !== state) {
        setStateCalls += 1;
        state = next;
      }
    },
  };

  const updated = hydrateAntigravityContextWindowInStore(fakeStore, [
    {
      agentId: "ag_1",
      workspaceId: "wks_1",
      conversationId: "cid_1",
      model: "gemini-3.8-flash-high",
      contextWindowMaxTokens: 1_000_000,
      contextWindowUsedTokens: 42_540,
      inputTokens: 127_132,
      outputTokens: 2_333,
      cachedInputTokens: 40_000,
      stepCount: 12,
      compactionCount: 1,
      lastCompaction: null,
    },
  ]);

  assert.equal(updated, 1);
  assert.equal(setStateCalls, 1);
  assert.deepEqual(state.sessions?.srv_local?.agents?.get("ag_1")?.lastUsage, {
    inputTokens: 127_132,
    outputTokens: 2_333,
    cachedInputTokens: 40_000,
    contextWindowMaxTokens: 1_000_000,
    contextWindowUsedTokens: 42_540,
  });
  assert.deepEqual(state.sessions?.srv_local?.agents?.get("cl_1")?.lastUsage, {
    contextWindowMaxTokens: 1_000_000,
    contextWindowUsedTokens: 55_000,
  });

  // Second call with identical numbers must be a zero-write no-op
  const repeat = hydrateAntigravityContextWindowInStore(fakeStore, [
    {
      agentId: "ag_1",
      workspaceId: "wks_1",
      conversationId: "cid_1",
      model: "gemini-3.8-flash-high",
      contextWindowMaxTokens: 1_000_000,
      contextWindowUsedTokens: 42_540,
      inputTokens: 127_132,
      outputTokens: 2_333,
      cachedInputTokens: 40_000,
      stepCount: 12,
      compactionCount: 1,
      lastCompaction: null,
    },
  ]);
  assert.equal(repeat, 0);
  assert.equal(setStateCalls, 1);
});
