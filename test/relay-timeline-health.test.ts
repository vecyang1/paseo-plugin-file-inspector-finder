import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PaseoRecoveryAgentItemSchema,
  manageRelayHealthRpc,
  reconcilePaseoRecoveryRpc,
} from "../shared/contracts";
import {
  installTimelineWireSanitizer,
  sanitizeFailedToolCallWireObject,
} from "../client/web";

describe("timeline wire sanitizer & mixed-provider recovery contracts", () => {
  it("repairs failed tool_call items with null error while keeping completed items untouched", () => {
    const wireFrame = {
      type: "session_message",
      message: {
        type: "fetch_agent_timeline_response",
        requestId: "req-1",
        payload: {
          entries: [
            {
              provider: "antigravity",
              item: {
                type: "tool_call",
                callId: "tc-ok",
                name: "run_command",
                detail: { type: "shell", command: "echo ok" },
                status: "completed",
                error: null,
              },
            },
            {
              provider: "antigravity",
              item: {
                type: "tool_call",
                callId: "tc-bad",
                name: "invoke_subagent",
                detail: {
                  type: "sub_agent",
                  subAgentType: "DeepCoder",
                  description: "L1 DeepCoder [Failed]",
                  childSessionId: "child-1",
                  log: "file:///work/project/transcript.jsonl",
                },
                status: "failed",
                error: null,
              },
            },
          ],
        },
      },
    };

    const repaired = sanitizeFailedToolCallWireObject(wireFrame);
    assert.equal(repaired, 1);
    const entries = wireFrame.message.payload.entries;
    assert.equal(entries[0]?.item.error, null);
    assert.deepEqual(entries[1]?.item.error, { message: "Tool call failed" });
  });

  it("hooks JSON.parse idempotently and repairs inbound fetch_agent_timeline_response and agent_stream frames", () => {
    const fakeWin: { JSON: { parse: typeof JSON.parse } } = {
      JSON: { parse: JSON.parse },
    };
    const h1 = installTimelineWireSanitizer(fakeWin);
    const h2 = installTimelineWireSanitizer(fakeWin);
    assert.equal(h1.installed, true);
    assert.equal(h1, h2);

    const rawStream = JSON.stringify({
      type: "session_message",
      message: {
        type: "agent_stream",
        payload: {
          item: {
            type: "tool_call",
            callId: "tc-stream-1",
            name: "invoke_subagent",
            status: "failed",
            error: null,
          },
        },
      },
    });
    const parsed = fakeWin.JSON.parse(rawStream) as {
      message: { payload: { item: { error: unknown } } };
    };
    assert.deepEqual(parsed.message.payload.item.error, { message: "Tool call failed" });
    assert.equal(h1.getRepairedCount(), 1);
  });

  it("accepts Claude recovery items that omit Antigravity step counters and carry nullable waitSecs", () => {
    const claudeItem = {
      agentId: "aa9d6752-12c3-4c5b-b586-cf525529b872",
      provider: "claude",
      workspaceId: "wks_sample",
      title: "sample session",
      cwd: "/work/project",
      status: "idle",
      persistedStatus: "idle",
      conversationId: "df21c775-e0b1-47be-927c-b63de3788720",
      turnState: "api_error",
      toolSummary: "Ran 0 tool calls this turn",
      wasStartupRecoveryFailed: false,
      lastErrorText: "Monthly spend limit reached",
      ageHours: 0.2,
      classification: "NEEDS_HUMAN",
      needsPullUp: false,
      reason: "Monthly spend limit reached",
      attemptsAtCurrentStep: 0,
      healed: false,
      quotaCooldown: {
        waitSecs: null,
        remainingSecs: 300,
        resumeAt: "2026-11-11T12:00:00Z",
        deferred: true,
      },
    };
    const parsed = PaseoRecoveryAgentItemSchema.parse(claudeItem);
    assert.equal(parsed.provider, "claude");
    assert.equal(parsed.epochs, 1);
    assert.equal(parsed.totalSteps, 0);
    assert.equal(parsed.quotaCooldown?.waitSecs, null);

    const fullOut = reconcilePaseoRecoveryRpc.output.parse({
      ok: true,
      action: "status",
      resumeOnStartup: true,
      versionCacheOk: true,
      catalogSingleflightOk: true,
      proxyHealthy: true,
      daemonRunning: true,
      daemonStartupFailedCount: 0,
      interruptedCount: 0,
      healedCount: 0,
      unhealedCount: 0,
      circuitBreakerCount: 0,
      totalScanned: 1,
      agents: [parsed],
      interruptedAgents: [],
      healedAgents: [],
      actions: [],
      issues: [],
      message: "ok",
      durationMs: 12,
    });
    assert.equal(fullOut.agents.length, 1);
  });

  it("validates manageRelayHealthRpc output schema", () => {
    const out = manageRelayHealthRpc.output.parse({
      ok: true,
      action: "probe",
      relayOk: true,
      relayEnabled: true,
      controlState: "connected",
      clashRoute: "DIRECT",
      lastMobileClientId: "cid_mobile",
      lastMobileHelloAt: "2026-11-11 19:22:58",
      recentRelayErrors15m: 0,
      recentLeaseDrops15m: 0,
      checkedTimelines: 18,
      badTimelines: [],
      e2eeOk: true,
      e2eeConnectMs: 2800,
      e2eeStatusMs: 850,
      e2eeError: null,
      actions: [],
      issues: [],
      details: "ok",
      message: "ok",
      durationMs: 3650,
    });
    assert.equal(out.clashRoute, "DIRECT");
    assert.equal(out.e2eeOk, true);
  });
});
