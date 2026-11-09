import assert from "node:assert/strict";
import test from "node:test";
import { resolveForkTargetAgentId } from "../client/fork-session-target";
import { buildForkArgs, parseForkOutput } from "../server/fork-session-handlers";

// Invented ids at the real shape; nothing here names a real agent.
const AGENT = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

test("fork target: host agent context wins over the route", () => {
  assert.equal(resolveForkTargetAgentId({ context: "agent", agentId: AGENT }, "/ag/11111111-x", null), AGENT);
});

test("fork target: falls back to the /ag/<id> route, then the selected agent tab", () => {
  assert.equal(resolveForkTargetAgentId({ context: "workspace" }, `/h/x/ag/${AGENT}`, null), AGENT);
  assert.equal(resolveForkTargetAgentId({ context: "workspace" }, "/h/x/w/y", `workspace-tab-agent_${AGENT}`), AGENT);
});

test("fork target: no agent anywhere is null, not a guess", () => {
  assert.equal(resolveForkTargetAgentId({ context: "workspace" }, "/h/x/w/y", "workspace-tab-file_abc"), null);
  assert.equal(resolveForkTargetAgentId({}, null, "workspace-tab-agent_short"), null);
});

test("fork args: open by default, dry-run never opens, title is passed through", () => {
  assert.deepEqual(buildForkArgs({ agentId: ` ${AGENT} `, open: true, dryRun: false }), [
    "conversation", "fork-agent", AGENT, "--json", "--open",
  ]);
  assert.deepEqual(buildForkArgs({ agentId: AGENT, open: true, dryRun: true, title: "x" }), [
    "conversation", "fork-agent", AGENT, "--json", "--title", "x", "--dry-run",
  ]);
  assert.deepEqual(buildForkArgs({ agentId: AGENT, open: false, dryRun: false }), [
    "conversation", "fork-agent", AGENT, "--json",
  ]);
});

test("fork output: reads the last JSON line and turns garbage into an error", () => {
  assert.equal(parseForkOutput('noise\n{"agent_id":"5e6f7a8b"}').agent_id, "5e6f7a8b");
  assert.equal(parseForkOutput('{"error":"Fork this session clones Antigravity conversations only"}').error,
    "Fork this session clones Antigravity conversations only");
  assert.match(String(parseForkOutput("Traceback ...").error), /Unreadable fork output/);
});
