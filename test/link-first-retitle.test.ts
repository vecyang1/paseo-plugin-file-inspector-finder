import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRetitlePrompt,
  hostTokens,
  isLinkOnlyPrompt,
  isLinkShapedTitle,
  normalizeGeneratedTitle,
  runLinkFirstRetitle,
  type LinkRetitleConfig,
} from "../server/link-first-retitle.ts";

const SLACK = "https://www-headquarters.slack.com/archives/C091GLVKLJU/p1794271923669529";
const CONFIG: LinkRetitleConfig = {
  enabled: true, baseUrl: "http://x/v1", model: "m", maxUserMessages: 2, timeoutMs: 1000, source: "default",
};
const LONG_REPLY = "The linked request asks how the new Paseo cadence should stay coherent with dash.wi. ".repeat(4);

test("link-only prompt detection", () => {
  assert.equal(isLinkOnlyPrompt(SLACK), true);
  assert.equal(isLinkOnlyPrompt(`${SLACK}\n`), true);
  assert.equal(isLinkOnlyPrompt(`check ${SLACK}`), true);
  assert.equal(isLinkOnlyPrompt(`看看 ${SLACK}`), true);
  assert.equal(isLinkOnlyPrompt(`fix https://app.notion.com/p/abc`), true);
  assert.equal(isLinkOnlyPrompt(`${SLACK} please summarize the discussion and draft a reply to the client`), false);
  assert.equal(isLinkOnlyPrompt("no link here"), false);
  assert.equal(isLinkOnlyPrompt(""), false);
});

test("host tokens drop generic labels", () => {
  assert.deepEqual(hostTokens([SLACK]).sort(), ["slack", "www-headquarters"]);
  assert.deepEqual(hostTokens(["https://app.notion.com/p/x"]), ["notion"]);
});

test("real sidebar titles from 2026-11-10 scan", () => {
  const linkShaped = [
    "Triage Slack thread p1794186693896139",
    "Review Slack thread in headquarters channel",
    "Investigate Slack thread from headquarters channel",
    "Triage Slack thread from www-headquarters",
    "d Review Slack thread request in C091GLVKLJU",
    "Review Slack thread C091GLVKLJU message",
    "Review Slack thread linked message",
    "d u need this ? https://github.com/vercel-labs/agent-desktop /",
  ];
  const specific = [
    "Collect email leads into FluentCRM from Slack",
    "Fix cadence Notion sync from Slack thread",
    "Fix image-gen skill API key routing for a6api",
    "Review Notion Claude Code OpenAI Cursor plan",
    "Merge Google Doc with today's Letterly note",
    "d Check ProStandard push-button upgrade ad traffic sources",
    "Sidebar shows Slack agenda threads",
    "部署 Antigravity 到 VPS 远程桌面",
  ];
  for (const t of linkShaped) assert.equal(isLinkShapedTitle(t, SLACK), true, t);
  for (const t of specific) assert.equal(isLinkShapedTitle(t, SLACK), false, t);
});

test("link-shaped titles vs agenda titles", () => {
  assert.equal(isLinkShapedTitle("Investigate Slack thread in www-hea...", SLACK), true);
  assert.equal(isLinkShapedTitle("Review www-headquarters message", SLACK), true);
  assert.equal(isLinkShapedTitle(SLACK.slice(0, 60), SLACK), true);
  assert.equal(isLinkShapedTitle(null, SLACK), true);
  assert.equal(isLinkShapedTitle("main", SLACK), true);
  assert.equal(isLinkShapedTitle("Align Paseo cadence with dash.wi", SLACK), false);
  assert.equal(isLinkShapedTitle("Mr Mao funnel analysis", SLACK), false);
});

test("generated title normalization", () => {
  assert.equal(normalizeGeneratedTitle('Title: "Align Paseo cadence with dash.wi."'), "Align Paseo cadence with dash.wi");
  assert.equal(normalizeGeneratedTitle("```\nFix intake router\n```"), "Fix intake router");
  assert.equal(normalizeGeneratedTitle("Ship the release \u{1F680}"), "Ship the release");
  assert.equal(normalizeGeneratedTitle("https://example.com"), null);
  assert.equal(normalizeGeneratedTitle("x".repeat(90))?.length, 60);
  assert.equal(normalizeGeneratedTitle(""), null);
});

test("done prefix is preserved on rename", async () => {
  const { deps } = fakeDeps({ userMessages: [SLACK], reply: LONG_REPLY, wsTitle: "d Review Slack thread C091GLVKLJU message" });
  const entry = await runLinkFirstRetitle({ agentId: "a-done", workspaceId: "ws1", dryRun: true }, deps as never);
  assert.equal(entry.to, "d Align Paseo cadence with dash.wi");
});

test("prompt keeps answer bounded", () => {
  const p = buildRetitlePrompt(SLACK, "a".repeat(20_000));
  assert.ok(p.length < 7_500);
  assert.ok(p.includes("real agenda"));
});

function fakeDeps(opts: { userMessages: string[]; reply: string; wsTitle: string | null; workspaceId?: string }) {
  const renames: unknown[] = [];
  return {
    renames,
    deps: {
      config: CONFIG,
      paseo: {
        agents: {
          ref: () => ({
            timeline: {
              refetch: async () => ({
                agent: { title: opts.userMessages[0]?.slice(0, 60) ?? null, workspaceId: opts.workspaceId ?? "ws1" },
                entries: [
                  ...opts.userMessages.map((text) => ({ item: { type: "user_message", text } })),
                  { item: { type: "assistant_message", text: opts.reply } },
                ],
              }),
            },
          }),
        },
        workspaces: { list: async () => ({ entries: [{ id: "ws1", title: opts.wsTitle }] }) },
      },
      rename: async (input: unknown) => {
        renames.push(input);
        return { ok: true };
      },
      generate: async () => "Align Paseo cadence with dash.wi",
    },
  };
}

test("dry run proposes a title without renaming", async () => {
  const { deps, renames } = fakeDeps({ userMessages: [SLACK], reply: LONG_REPLY, wsTitle: "Investigate Slack thread in www-hea..." });
  const entry = await runLinkFirstRetitle({ agentId: "a-dry", workspaceId: "ws1", dryRun: true }, deps as never);
  assert.equal(entry.ok, true);
  assert.equal(entry.to, "Align Paseo cadence with dash.wi");
  assert.equal(renames.length, 0);
});

test("guards: specific title, non-link prompt, subagent, late session, short answer", async () => {
  const specific = fakeDeps({ userMessages: [SLACK], reply: LONG_REPLY, wsTitle: "Mr Mao funnel analysis" });
  assert.equal((await runLinkFirstRetitle({ agentId: "g1", workspaceId: "ws1", dryRun: true }, specific.deps as never)).reason, "title_already_specific");

  const prose = fakeDeps({ userMessages: [`${SLACK} summarize this and draft a client reply today`], reply: LONG_REPLY, wsTitle: null });
  assert.equal((await runLinkFirstRetitle({ agentId: "g2", workspaceId: "ws1", dryRun: true }, prose.deps as never)).reason, "not_link_only");

  const sub = fakeDeps({ userMessages: [SLACK], reply: LONG_REPLY, wsTitle: null });
  assert.equal((await runLinkFirstRetitle({ agentId: "g3", workspaceId: "ws1", parentAgentId: "p", dryRun: true }, sub.deps as never)).reason, "subagent");

  const late = fakeDeps({ userMessages: [SLACK, "more", "again"], reply: LONG_REPLY, wsTitle: null });
  assert.equal((await runLinkFirstRetitle({ agentId: "g4", workspaceId: "ws1", dryRun: true }, late.deps as never)).reason, "session_too_far_along");

  const short = fakeDeps({ userMessages: [SLACK], reply: "ok", wsTitle: null });
  assert.equal((await runLinkFirstRetitle({ agentId: "g5", workspaceId: "ws1", dryRun: true }, short.deps as never)).reason, "answer_too_short");
});

test("never renames without a workspace id", async () => {
  const { deps, renames } = fakeDeps({ userMessages: [SLACK], reply: LONG_REPLY, wsTitle: null, workspaceId: "" });
  const entry = await runLinkFirstRetitle({ agentId: "g6", workspaceId: null, dryRun: true }, deps as never);
  assert.equal(entry.reason, "no_workspace");
  assert.equal(renames.length, 0);
});

test("disabled config is a no-op", async () => {
  const { deps } = fakeDeps({ userMessages: [SLACK], reply: LONG_REPLY, wsTitle: null });
  const entry = await runLinkFirstRetitle({ agentId: "g7", workspaceId: "ws1" }, { ...deps, config: { ...CONFIG, enabled: false } } as never);
  assert.equal(entry.reason, "disabled");
});

test("backfill scan finds link-titled workspaces and skips specific or spawned ones", async () => {
  const { findBackfillCandidates } = await import("../server/link-first-retitle.ts");
  const paseo = {
    agents: { ref: () => ({ timeline: { refetch: async () => ({ entries: [] }) } }) },
    workspaces: {
      list: async () => ({
        entries: [
          { id: "w1", title: "Triage Slack thread in www-headquarters" },
          { id: "w2", title: "Align Paseo cadence with dash.wi" },
          { id: "w3", title: "Review Slack thread linked message" },
          { id: "w4", title: "Fix build" },
        ],
      }),
    },
  };
  const records = [
    { id: "a1", workspaceId: "w1", title: SLACK.slice(0, 60), createdAt: "2026-11-09T01:00:00Z" },
    { id: "a1b", workspaceId: "w1", title: "later agent", createdAt: "2026-11-09T02:00:00Z" },
    { id: "a2", workspaceId: "w2", title: SLACK.slice(0, 60), createdAt: "2026-11-09T01:00:00Z" },
    { id: "a3", workspaceId: "w3", title: SLACK.slice(0, 60), createdAt: "2026-11-09T01:00:00Z", labels: { "paseo.parent-agent-id": "p" } },
    { id: "a4", workspaceId: "w4", title: "fix the build please", createdAt: "2026-11-09T01:00:00Z" },
  ];
  const found = await findBackfillCandidates(paseo as never, records);
  assert.deepEqual(found.map((c) => c.workspaceId), ["w1"]);
  assert.equal(found[0].agentId, "a1");
});
