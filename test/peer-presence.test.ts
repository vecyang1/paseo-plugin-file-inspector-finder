// Peer presence (T-098): the shared-files list and the recording check in Settings -> Peer Agents.
//
// Fixtures follow the shape `antigravity-ops peers touching --json` and `--verify --json` printed
// on 2026-11-12 (pretty-printed, trailing newline). Ids and paths are invented at the real shape;
// none names a real session.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SHARED_FILES_CAP,
  TOUCHING_ARGS,
  VERIFY_ARGS,
  collectPeerPresence,
  parsePresenceVerify,
  parseSharedFiles,
  runPeerCli,
  type PeerCliExec,
} from "../server/peer-presence.ts";
import {
  formatPeerAge,
  formatPeerSessionRow,
  formatPresenceSummary,
  formatPresenceVerdict,
  peerSessionShortId,
} from "../shared/peer-presence-format.ts";
import { managePeerAgentsRpc } from "../shared/contracts.ts";
import { searchSettingsIndex } from "../shared/settings-search.ts";
import { SETTINGS_SEARCH_SEED } from "../shared/settings-search-seed.ts";

const HOME = "/Users/example";
const AGENT = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const SESSION_A = "11112222-3333-4444-5555-666677778888";
const SESSION_B = "outside-session-without-agent";

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    last: 1794425408.279,
    count: 2,
    harness: "claude",
    session: SESSION_A,
    agent: AGENT,
    provider: "claude",
    model: "claude-example-1",
    status: "running",
    title: "example title",
    scheduled: false,
    ...overrides,
  };
}

function touchingPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    window_minutes: 30,
    source: "hook ledger",
    edits: 32,
    sessions: 8,
    files: 20,
    warnings: [],
    self: { session: "", agent: "" },
    paths: [
      {
        path: `${HOME}/project/src/shared.ts`,
        sessions: [
          session(),
          session({
            last: 1794425404.82,
            count: 1,
            session: SESSION_B,
            agent: "",
            model: "",
            status: "outside-paseo",
            title: "",
          }),
        ],
      },
    ],
    ...overrides,
  };
}

function verifyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    since: 1794423757.897,
    warnings: [],
    graded: { claude: 5, antigravity: 14 },
    harness: {
      claude: {
        edited_pairs: 1,
        in_ledger: 1,
        before_hook: 0,
        missing_sessions: [],
        hook_ran_but_edit_unread: [],
        no_hook_run: [],
        missing_examples: [],
      },
      antigravity: {
        edited_pairs: 14,
        in_ledger: 14,
        before_hook: 0,
        missing_sessions: [],
        hook_ran_but_edit_unread: [],
        no_hook_run: [],
        missing_examples: [],
      },
    },
    ok: true,
    ...overrides,
  };
}

const asStdout = (payload: unknown) => `${JSON.stringify(payload, null, 2)}\n`;
const exited = (exitCode: number | null, stdout: string) => ({ exitCode, stdout });

/** What `execFile` rejects with: the exit code and whatever reached stdout before it. */
function execFailure(code: number | string | null, stdout = ""): Error {
  return Object.assign(new Error(`Command failed with ${String(code)}`), { code, stdout, stderr: "" });
}

/** A fake `execCommand` that records every argument list it was given. */
function fakeExec(reply: (args: string[]) => string | Error) {
  const calls: string[][] = [];
  const exec: PeerCliExec = async (args) => {
    calls.push([...args]);
    const result = reply(args);
    if (result instanceof Error) throw result;
    return { stdout: result };
  };
  return { exec, calls };
}

// ---------------------------------------------------------------------------
// Shared files
// ---------------------------------------------------------------------------

test("shared files: a healthy payload lists each file with its sessions", () => {
  const read = parseSharedFiles(exited(0, asStdout(touchingPayload())), { home: HOME });

  assert.equal(read.sharedFiles?.length, 1);
  const file = read.sharedFiles![0];
  assert.equal(file.path, `${HOME}/project/src/shared.ts`);
  assert.equal(file.shortPath, "~/project/src/shared.ts");
  assert.deepEqual(file.sessions[0], {
    agent: AGENT,
    session: SESSION_A,
    provider: "claude",
    harness: "claude",
    model: "claude-example-1",
    status: "running",
    title: "example title",
    scheduled: false,
    last: 1794425408.279,
    count: 2,
  });
  assert.equal(file.sessions[1].agent, "");
  assert.equal(file.sessions[1].status, "outside-paseo");
  assert.deepEqual(read.presence, {
    windowMinutes: 30,
    edits: 32,
    sessions: 8,
    files: 20,
    sharedTotal: 1,
    truncated: false,
    warnings: [],
  });
});

test("shared files: an empty list from a healthy run is empty, not unknown", () => {
  const read = parseSharedFiles(exited(0, asStdout(touchingPayload({ paths: [] }))), { home: HOME });
  assert.deepEqual(read.sharedFiles, []);
  assert.equal(read.presence?.sharedTotal, 0);
});

test("shared files: a failing command is unknown (null), never an empty list", () => {
  for (const run of [
    exited(2, ""),
    exited(null, ""),
    // Non-zero exit with a complete payload is still a failed run for this command.
    exited(1, asStdout(touchingPayload())),
  ]) {
    assert.deepEqual(parseSharedFiles(run, { home: HOME }), { sharedFiles: null, presence: null });
  }
});

test("shared files: unparseable output is unknown (null)", () => {
  for (const stdout of [
    "",
    "Traceback (most recent call last):\n  File \"x.py\", line 1\n",
    '{"paths": [',
    "[]",
    "null",
    "42",
  ]) {
    assert.deepEqual(
      parseSharedFiles(exited(0, stdout), { home: HOME }),
      { sharedFiles: null, presence: null },
      `stdout ${JSON.stringify(stdout)}`,
    );
  }
});

test("shared files: a payload without `paths` is unknown, and the counts it does state are kept", () => {
  const payload = touchingPayload();
  delete payload.paths;
  delete payload.edits;
  const read = parseSharedFiles(exited(0, asStdout(payload)), { home: HOME });

  assert.equal(read.sharedFiles, null);
  assert.equal(read.presence?.sharedTotal, null);
  assert.equal(read.presence?.edits, null, "a missing count is unknown, not 0");
  assert.equal(read.presence?.sessions, 8);
  assert.equal(read.presence?.files, 20);
});

test("shared files: a session row without `last` or `count` keeps the row and marks both unknown", () => {
  const bare = session();
  delete bare.last;
  delete bare.count;
  delete bare.scheduled;
  delete bare.status;
  const payload = touchingPayload({
    paths: [{ path: `${HOME}/a.ts`, sessions: [bare, session({ session: SESSION_B, agent: "" })] }],
  });
  const read = parseSharedFiles(exited(0, asStdout(payload)), { home: HOME });

  const row = read.sharedFiles![0].sessions[0];
  assert.equal(row.last, null);
  assert.equal(row.count, null);
  assert.equal(row.scheduled, null);
  assert.equal(row.status, "unknown");
  assert.equal(row.agent, AGENT);
  assert.equal(read.sharedFiles![0].sessions.length, 2);
});

test("shared files: an entry that cannot be read is skipped with a warning, the rest are kept", () => {
  const payload = touchingPayload({
    warnings: ["ledger line 7 is not JSON"],
    paths: [
      { sessions: [session()] },
      { path: `${HOME}/b.ts` },
      "not an object",
      { path: `${HOME}/ok.ts`, sessions: [session(), "not a session", session({ session: SESSION_B })] },
    ],
  });
  const read = parseSharedFiles(exited(0, asStdout(payload)), { home: HOME });

  assert.deepEqual(read.sharedFiles?.map((f) => f.shortPath), ["~/ok.ts"]);
  assert.equal(read.sharedFiles![0].sessions.length, 2);
  assert.equal(read.presence?.sharedTotal, 1);
  assert.deepEqual(read.presence?.warnings, [
    "ledger line 7 is not JSON",
    "3 shared-file entries could not be read",
    "1 session row could not be read",
  ]);
});

test("shared files: more than the cap lists the first 20 and says how many exist", () => {
  const many = (n: number) =>
    touchingPayload({
      paths: Array.from({ length: n }, (_, i) => ({
        path: `${HOME}/file-${String(i).padStart(2, "0")}.ts`,
        sessions: [session(), session({ session: SESSION_B, agent: "" })],
      })),
    });
  assert.equal(SHARED_FILES_CAP, 20);

  const over = parseSharedFiles(exited(0, asStdout(many(23))), { home: HOME });
  assert.equal(over.sharedFiles?.length, 20);
  assert.equal(over.sharedFiles?.[0].shortPath, "~/file-00.ts");
  assert.equal(over.sharedFiles?.[19].shortPath, "~/file-19.ts");
  assert.equal(over.presence?.sharedTotal, 23);
  assert.equal(over.presence?.truncated, true);

  const exact = parseSharedFiles(exited(0, asStdout(many(20))), { home: HOME });
  assert.equal(exact.sharedFiles?.length, 20);
  assert.equal(exact.presence?.truncated, false);
});

test("shared files: only a path under the home directory is shortened", () => {
  const payload = touchingPayload({
    paths: [
      { path: "/Users/example-other/x.ts", sessions: [session()] },
      { path: "/tmp/y.ts", sessions: [session()] },
    ],
  });
  const read = parseSharedFiles(exited(0, asStdout(payload)), { home: HOME });
  assert.deepEqual(read.sharedFiles?.map((f) => f.shortPath), ["/Users/example-other/x.ts", "/tmp/y.ts"]);
});

// ---------------------------------------------------------------------------
// Recording check (`--verify`)
// ---------------------------------------------------------------------------

test("verify: exit 0 with ok true is ok", () => {
  const verify = parsePresenceVerify(exited(0, asStdout(verifyPayload())));
  assert.equal(verify?.ok, true);
  assert.equal(verify?.reason, null);
  assert.deepEqual(verify?.gapSessions, []);
  assert.deepEqual(
    verify?.harness.map((h) => [h.harness, h.gradedSessions, h.editedPairs, h.inLedger, h.beforeHook]),
    [
      ["claude", 5, 1, 1, 0],
      ["antigravity", 14, 14, 14, 0],
    ],
  );
});

test("verify: exit 1 with valid JSON is a gap, not a failed run", () => {
  const payload = verifyPayload({ ok: false });
  const harness = payload.harness as Record<string, Record<string, unknown>>;
  harness.claude.missing_sessions = ["5e6f7a8b", "1a2b3c4d"];
  harness.claude.no_hook_run = ["1a2b3c4d"];
  harness.claude.hook_ran_but_edit_unread = ["5e6f7a8b"];
  harness.claude.missing_examples = ["1a2b3c4d ~/project/a.ts"];
  harness.antigravity.missing_sessions = ["1a2b3c4d", "9c0d1e2f"];

  const verify = parsePresenceVerify(exited(1, asStdout(payload)));

  assert.equal(verify?.ok, false);
  assert.deepEqual(verify?.gapSessions, ["1a2b3c4d", "5e6f7a8b", "9c0d1e2f"]);
  assert.deepEqual(verify?.harness[0].noHookRun, ["1a2b3c4d"]);
  assert.deepEqual(verify?.harness[0].hookRanButEditUnread, ["5e6f7a8b"]);
  assert.deepEqual(verify?.harness[0].missingExamples, ["1a2b3c4d ~/project/a.ts"]);
});

test("verify: edits made before the hook first ran are counted apart and are never a gap", () => {
  const payload = verifyPayload();
  const harness = payload.harness as Record<string, Record<string, unknown>>;
  harness.claude.edited_pairs = 4;
  harness.claude.in_ledger = 1;
  harness.claude.before_hook = 3;

  const verify = parsePresenceVerify(exited(0, asStdout(payload)));

  assert.equal(verify?.ok, true);
  assert.deepEqual(verify?.gapSessions, []);
  assert.equal(verify?.harness[0].beforeHook, 3);
  assert.deepEqual(verify?.harness[0].missingSessions, []);
  assert.equal(formatPresenceVerdict(verify, false), "ok");

  // Every edit predates the hook: the CLI grades nothing and says why. Still not a gap.
  harness.claude.in_ledger = 0;
  harness.claude.edited_pairs = 3;
  harness.antigravity.edited_pairs = 0;
  harness.antigravity.in_ledger = 0;
  const reason = "no edit since each session's hook first ran, so nothing could be compared";
  const ungraded = parsePresenceVerify(exited(0, asStdout({ ...payload, ok: null, reason })));
  assert.equal(ungraded?.ok, null);
  assert.deepEqual(ungraded?.gapSessions, []);
  assert.equal(formatPresenceVerdict(ungraded, false), `unknown (${reason})`);
});

test("verify: ok null keeps the CLI's reason and is not read as ok or as a gap", () => {
  const reason = "ledger has no touches in the window, so hook coverage cannot be graded";
  const verify = parsePresenceVerify(exited(0, asStdout({ ok: null, reason, warnings: ["w"] })));
  assert.equal(verify?.ok, null);
  assert.equal(verify?.reason, reason);
  assert.deepEqual(verify?.gapSessions, []);
  assert.deepEqual(verify?.harness, []);
  assert.deepEqual(verify?.warnings, ["w"]);
});

test("verify: a failed, unparseable or verdict-less run is unknown (null)", () => {
  const noVerdict = verifyPayload();
  delete noVerdict.ok;
  for (const [label, run] of [
    ["usage error", exited(2, "")],
    ["killed", exited(null, asStdout(verifyPayload()))],
    ["exit 1 without output", exited(1, "")],
    ["traceback", exited(1, "Traceback (most recent call last):\n")],
    ["truncated json", exited(0, '{"ok": tr')],
    ["missing ok", exited(0, asStdout(noVerdict))],
    ["ok is a string", exited(0, asStdout(verifyPayload({ ok: "true" })))],
    ["array", exited(0, "[]")],
  ] as const) {
    assert.equal(parsePresenceVerify(run), null, label);
  }
});

// ---------------------------------------------------------------------------
// Running the CLI
// ---------------------------------------------------------------------------

test("runPeerCli: a rejected exec becomes an exit code and the stdout it carried", async () => {
  const ok = fakeExec(() => "out");
  assert.deepEqual(await runPeerCli(ok.exec, ["a", "b"]), { exitCode: 0, stdout: "out" });
  assert.deepEqual(ok.calls, [["a", "b"]]);

  const exitOne = fakeExec(() => execFailure(1, '{"ok": false}'));
  assert.deepEqual(await runPeerCli(exitOne.exec, ["x"]), { exitCode: 1, stdout: '{"ok": false}' });

  for (const code of ["ENOENT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", null]) {
    const failed = fakeExec(() => execFailure(code, "partial"));
    assert.deepEqual(await runPeerCli(failed.exec, ["x"]), { exitCode: null, stdout: "partial" });
  }

  const thrown: PeerCliExec = async () => {
    throw "not an error object";
  };
  assert.deepEqual(await runPeerCli(thrown, ["x"]), { exitCode: null, stdout: "" });
});

test("collect: status runs `peers touching --json` and returns the list", async () => {
  const cli = fakeExec(() => asStdout(touchingPayload()));
  const fields = await collectPeerPresence("status", cli.exec, { home: HOME });

  assert.deepEqual(cli.calls, [["peers", "touching", "--json"]]);
  assert.deepEqual(cli.calls[0], [...TOUCHING_ARGS]);
  assert.equal(fields.sharedFiles?.length, 1);
  assert.equal(fields.presence?.edits, 32);
  assert.equal("presenceVerify" in fields, false);
});

test("collect: status with a failing CLI sets sharedFiles to null", async () => {
  for (const reply of [
    () => execFailure(1, ""),
    () => execFailure("ENOENT"),
    () => "not json",
  ]) {
    const cli = fakeExec(reply);
    const fields = await collectPeerPresence("status", cli.exec, { home: HOME });
    assert.equal(cli.calls.length, 1);
    assert.equal("sharedFiles" in fields, true);
    assert.equal(fields.sharedFiles, null);
    assert.equal(fields.presence, null);
  }
});

test("collect: verify_presence runs `--verify` and reads exit 1 with JSON as a gap", async () => {
  const gap = verifyPayload({ ok: false });
  (gap.harness as Record<string, Record<string, unknown>>).claude.missing_sessions = ["1a2b3c4d"];
  const cli = fakeExec(() => execFailure(1, asStdout(gap)));
  const fields = await collectPeerPresence("verify_presence", cli.exec, { home: HOME });

  assert.deepEqual(cli.calls, [["peers", "touching", "--verify", "--json"]]);
  assert.deepEqual(cli.calls[0], [...VERIFY_ARGS]);
  assert.equal(fields.presenceVerify?.ok, false);
  assert.deepEqual(fields.presenceVerify?.gapSessions, ["1a2b3c4d"]);
  assert.equal("sharedFiles" in fields, false);

  const dead = fakeExec(() => execFailure(127, ""));
  const unknown = await collectPeerPresence("verify_presence", dead.exec, { home: HOME });
  assert.equal("presenceVerify" in unknown, true);
  assert.equal(unknown.presenceVerify, null);
});

test("collect: the other actions run nothing and add no field", async () => {
  for (const action of ["test_resolve", "enable_all", "heal_outbox"]) {
    const cli = fakeExec(() => {
      throw new Error("must not run");
    });
    assert.deepEqual(await collectPeerPresence(action, cli.exec, { home: HOME }), {});
    assert.deepEqual(cli.calls, []);
  }
});

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

test("contract: the new output fields are optional and the new action parses", () => {
  const base = {
    ok: true,
    action: "status",
    blockVersion: 6,
    antigravityChannel: "cli-fallback",
    surfaces: [],
    profiles: [],
    activePeersCount: 0,
    closedPeersCount: 0,
    outboxSummary: "outbox: ok",
    message: "m",
    durationMs: 1,
  };
  const older = managePeerAgentsRpc.output.parse(base);
  assert.equal(older.sharedFiles, undefined);
  assert.equal(older.presenceVerify, undefined);

  const read = parseSharedFiles(exited(0, asStdout(touchingPayload())), { home: HOME });
  const verify = parsePresenceVerify(exited(0, asStdout(verifyPayload())));
  const full = managePeerAgentsRpc.output.parse({ ...base, ...read, presenceVerify: verify });
  assert.equal(full.sharedFiles?.[0].sessions.length, 2);
  assert.equal(full.presenceVerify?.ok, true);

  const unknown = managePeerAgentsRpc.output.parse({ ...base, sharedFiles: null, presence: null, presenceVerify: null });
  assert.equal(unknown.sharedFiles, null);

  assert.equal(managePeerAgentsRpc.input.parse({ action: "verify_presence" }).action, "verify_presence");
  assert.equal(managePeerAgentsRpc.input.parse({}).action, "status");
});

// ---------------------------------------------------------------------------
// What the settings screen prints
// ---------------------------------------------------------------------------

test("row: agent id is 7 characters, a session without an agent shows 8 of its session id", () => {
  assert.equal(peerSessionShortId({ agent: AGENT, session: SESSION_A }), "0a1b2c3");
  assert.equal(peerSessionShortId({ agent: "", session: SESSION_B }), "outside-");
  assert.equal(peerSessionShortId({ agent: "", session: "" }), "?");
});

test("row: id · model · status · age · ×count", () => {
  const now = 1794425408.279 + 8 * 60;
  const read = parseSharedFiles(exited(0, asStdout(touchingPayload())), { home: HOME });
  const [inPaseo, outside] = read.sharedFiles![0].sessions;

  assert.equal(formatPeerSessionRow(inPaseo, now, false), "0a1b2c3 · claude-example-1 · running · 8 min ago · ×2");
  assert.equal(formatPeerSessionRow(inPaseo, now, true), "0a1b2c3 · claude-example-1 · running · 8 分钟前 · ×2");
  // No model stated: the provider stands in, as in the CLI's own listing.
  assert.equal(formatPeerSessionRow(outside, now, false), "outside- · claude · outside-paseo · 8 min ago · ×1");
  assert.equal(
    formatPeerSessionRow({ ...outside, provider: "", harness: "" }, now, false),
    "outside- · ? · outside-paseo · 8 min ago · ×1",
  );
});

test("row: an unread time or count prints `?`, never 0", () => {
  const read = parseSharedFiles(exited(0, asStdout(touchingPayload())), { home: HOME });
  const row = { ...read.sharedFiles![0].sessions[0], last: null, count: null };
  assert.equal(formatPeerSessionRow(row, 1794425408, false), "0a1b2c3 · claude-example-1 · running · ? · ×?");
});

test("age: seconds under 90, minutes under 90 min, then hours (the CLI's own steps)", () => {
  const t = 1_000_000;
  assert.equal(formatPeerAge(t + 5, t, false), "5s ago");
  assert.equal(formatPeerAge(t + 89, t, false), "89s ago");
  assert.equal(formatPeerAge(t + 90, t, false), "1 min ago");
  assert.equal(formatPeerAge(t + 5399, t, false), "89 min ago");
  assert.equal(formatPeerAge(t + 5400, t, false), "1 h ago");
  assert.equal(formatPeerAge(t - 30, t, false), "0s ago", "a clock that runs behind is not a negative age");
  assert.equal(formatPeerAge(t + 5, t, true), "5 秒前");
  assert.equal(formatPeerAge(t + 5400, t, true), "1 小时前");
  assert.equal(formatPeerAge(t, null, false), "?");
  assert.equal(formatPeerAge(Number.NaN, t, false), "?");
});

test("summary: counts print only when all three were read", () => {
  const read = parseSharedFiles(exited(0, asStdout(touchingPayload())), { home: HOME });
  assert.equal(formatPresenceSummary(read.presence, false), "32 edits by 8 sessions on 20 files");
  assert.equal(formatPresenceSummary(read.presence, true), "8 个会话在 20 个文件上有 32 次编辑");
  assert.equal(formatPresenceSummary({ ...read.presence!, edits: null }, false), "");
  assert.equal(formatPresenceSummary(null, false), "");
  assert.equal(formatPresenceSummary(undefined, false), "");
});

test("verdict: ok, gap with session ids, or unknown, plus the CLI's reason", () => {
  const ok = parsePresenceVerify(exited(0, asStdout(verifyPayload())));
  assert.equal(formatPresenceVerdict(ok, false), "ok");
  assert.equal(formatPresenceVerdict(ok, true), "正常");

  const gapPayload = verifyPayload({ ok: false });
  (gapPayload.harness as Record<string, Record<string, unknown>>).claude.missing_sessions = ["5e6f7a8b", "1a2b3c4d"];
  const gap = parsePresenceVerify(exited(1, asStdout(gapPayload)));
  assert.equal(formatPresenceVerdict(gap, false), "gap: 1a2b3c4d, 5e6f7a8b");
  assert.equal(formatPresenceVerdict(gap, true), "缺口: 1a2b3c4d, 5e6f7a8b");
  assert.equal(formatPresenceVerdict({ ...gap!, gapSessions: [] }, false), "gap");

  const reason = "no edit since each session's hook first ran, so nothing could be compared";
  const graded = parsePresenceVerify(exited(0, asStdout(verifyPayload({ ok: null, reason }))));
  assert.equal(formatPresenceVerdict(graded, false), `unknown (${reason})`);
  assert.equal(formatPresenceVerdict(graded, true), `未知 (${reason})`);

  assert.equal(formatPresenceVerdict(null, false), "unknown");
  assert.equal(formatPresenceVerdict(null, true), "未知");
  assert.equal(formatPresenceVerdict(undefined, false), "unknown");
});

// ---------------------------------------------------------------------------
// Settings Search
// ---------------------------------------------------------------------------

const SEARCH_ROW = "Shared files are edited by two or more sessions. Each line shows who is editing.";
const PLUGIN_PAGE = "plugin:file-inspector-finder/finder-settings";

test("search: `shared files` and `who is editing` both find the Peer Agents row", () => {
  for (const query of ["shared files", "who is editing"]) {
    const hits = searchSettingsIndex(SETTINGS_SEARCH_SEED.pages, query);
    const hit = hits.find((result) => result.title === SEARCH_ROW);
    assert.ok(hit, `"${query}" finds the row (${hits.length} results)`);
    assert.equal(hit.pageKey, PLUGIN_PAGE);
    assert.equal(hit.field, 0, "matched on the row's own text, not on its page name");
  }
});

test("search: the seeded row is the text the settings screen renders", () => {
  // The seed crawler keeps a row only when it is a whole string literal in the plugin source.
  // The same rule here, so rewording the line without re-running the crawler fails.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const screen = fs.readFileSync(path.join(root, "client/settings-screen.tsx"), "utf8");
  assert.ok(screen.includes(`"${SEARCH_ROW}"`), "client/settings-screen.tsx renders the seeded row");

  const page = SETTINGS_SEARCH_SEED.pages.find((entry) => entry.key === PLUGIN_PAGE);
  const titles = (page?.entries ?? []).map((entry) => entry.title);
  const at = titles.indexOf(SEARCH_ROW);
  assert.ok(at > 0, "the plugin page seeds the row");
  assert.match(titles[at - 1], /^Peer Agents/, "it sits under the Peer Agents section, as rendered");
});
