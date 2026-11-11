// Cmd+K listed one session twice: once under Workspaces, once under Agents (2026-11-11).
// Paseo builds both sections from one query; a workspace holding a single agent shares that
// agent's title, so both rows hit and both open the same place. These tests pin the rule that
// hides the agent row only when nothing becomes unreachable, and the wiring that applies it.
import assert from "node:assert/strict";
import test from "node:test";
import {
  dropAgentRowsCoveredByWorkspaceRows,
  recordShownWorkspaceRows,
  resetCommandCenterDedupeForTests,
  shownWorkspaceKeysForQuery,
} from "../client/command-center-dedupe";
import { patchCommandCenterSearch } from "../client/session-lineage-web";
import { type MinimalStorage, readQuickJumpPreferences, syncQuickJumpPreferences } from "../client/web";

const QUICK_JUMP_KEY = "paseo:finder-plugin:quick-jump-config";
const RECENTS_LIMIT = 3;

interface Row {
  kind: "workspace" | "agent";
  id: string;
  title: string;
  subtitle: string;
  activityAt: number;
  serverId?: string;
  workspaceId?: string;
  agent?: { id: string; serverId: string; workspaceId: string | null; cwd: string };
  run: () => void;
}

const workspaceRow = (workspaceId: string, title: string, activityAt = 0, serverId = "srv_a"): Row => ({
  kind: "workspace",
  id: `workspace:${serverId}:${workspaceId}`,
  title,
  subtitle: "Project · main",
  activityAt,
  serverId,
  workspaceId,
  run: () => {},
});

const agentRow = (
  agentId: string,
  workspaceId: string | null,
  title: string,
  workspaceTitle: string,
  activityAt = 0,
  serverId = "srv_a",
): Row => ({
  kind: "agent",
  id: `agent:${serverId}:${agentId}`,
  title,
  subtitle: workspaceTitle,
  activityAt,
  agent: { id: agentId, serverId, workspaceId, cwd: "/work/project" },
  run: () => {},
});

const agentFields = (row: Row) => ({ visible: [row.title, row.subtitle], hidden: [row.agent?.cwd ?? ""] });
const titles = (rows: Row[]) => rows.map((row) => row.title);

function fakeStorage(initial: Record<string, string> = {}): MinimalStorage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

/**
 * Stand-in for Paseo's two search modules, shaped like the 0.15.4 bundle: a blank query returns
 * the most recent rows capped at a limit, and the workspace search reaches the shared ranking
 * function through the exports object, which is how the plugin's patch sees that call too.
 */
function fakePaseoSearch(storage = fakeStorage()) {
  const exports: Record<string, any> = {
    filterAndRankBuiltInResults(items: Row[], query: string, getFields: (row: Row) => { visible: string[]; hidden: string[] }) {
      const needle = query.trim().toLowerCase();
      if (!needle) return [...items].sort((a, b) => b.activityAt - a.activityAt).slice(0, RECENTS_LIMIT);
      return items.filter((row) => {
        const fields = getFields(row);
        return [...fields.visible, ...fields.hidden].join(" ").toLowerCase().includes(needle);
      });
    },
    filterAndRankWorkspaces(workspaces: Row[], query: string) {
      const fields = (row: Row) => ({ visible: [row.title, row.subtitle], hidden: [] });
      return exports.filterAndRankBuiltInResults(workspaces, query, fields);
    },
  };
  const win = {
    __c: new Map([[4355, { isInitialized: true, publicModule: { exports } }]]),
    localStorage: storage,
  } as unknown as Window;
  assert.equal(patchCommandCenterSearch(win), true, "patch must find the search functions");
  const search = (workspaces: Row[], agents: Row[], query: string) => ({
    workspaces: exports.filterAndRankWorkspaces(workspaces, query) as Row[],
    agents: exports.filterAndRankBuiltInResults(agents, query, agentFields) as Row[],
  });
  return { exports, win, search };
}

test("rule: an agent row is hidden only when its workspace row is shown and it is that workspace's only agent", () => {
  const rows = [
    agentRow("a1", "wks_solo", "Deploy desktop", "Deploy desktop"),
    agentRow("a2", "wks_pair", "Review plan", "Planning"),
    agentRow("a3", "wks_pair", "Write tests", "Planning"),
    agentRow("a4", "wks_hidden", "Deploy again", "Renamed workspace"),
    agentRow("a5", null, "Detached agent", "/work/project"),
  ];
  const shown = new Set(["srv_a:wks_solo", "srv_a:wks_pair"]);

  const result = dropAgentRowsCoveredByWorkspaceRows(rows, shown);

  assert.deepEqual(titles(result.kept), ["Review plan", "Write tests", "Deploy again", "Detached agent"]);
  assert.equal(result.hidden, 1);
});

test("rule: with no workspace rows on record nothing is hidden", () => {
  const rows = [agentRow("a1", "wks_solo", "Deploy desktop", "Deploy desktop")];

  assert.equal(dropAgentRowsCoveredByWorkspaceRows(rows, null).hidden, 0);
  assert.equal(dropAgentRowsCoveredByWorkspaceRows(rows, undefined).kept.length, 1);
  assert.equal(dropAgentRowsCoveredByWorkspaceRows(rows, new Set()).kept.length, 1);
});

test("rule: the same workspace id on another host is a different workspace", () => {
  const rows = [
    agentRow("a1", "wks_same", "On host A", "Shared name", 0, "srv_a"),
    agentRow("a2", "wks_same", "On host B", "Shared name", 0, "srv_b"),
  ];

  const result = dropAgentRowsCoveredByWorkspaceRows(rows, new Set(["srv_a:wks_same"]));

  assert.deepEqual(titles(result.kept), ["On host B"]);
});

test("rule: workspace rows pass through untouched and the input array is not mutated", () => {
  const rows = [workspaceRow("wks_solo", "Deploy desktop"), agentRow("a1", "wks_solo", "Deploy desktop", "Deploy desktop")];
  const before = [...rows];

  const result = dropAgentRowsCoveredByWorkspaceRows(rows, new Set(["srv_a:wks_solo"]));

  assert.deepEqual(titles(result.kept), ["Deploy desktop"]);
  assert.equal(result.kept[0].kind, "workspace");
  assert.deepEqual(rows, before);
});

test("record: workspace rows are remembered for their exact query only", () => {
  resetCommandCenterDedupeForTests();
  recordShownWorkspaceRows("deploy", [workspaceRow("wks_solo", "Deploy desktop"), { kind: "agent" }, null]);

  assert.deepEqual([...(shownWorkspaceKeysForQuery("deploy") ?? [])], ["srv_a:wks_solo"]);
  assert.equal(shownWorkspaceKeysForQuery("deplo"), null);
  assert.equal(shownWorkspaceKeysForQuery("deploy "), null);
});

test("Cmd+K query: a single-agent session shows once, and sessions with their own destination stay", () => {
  resetCommandCenterDedupeForTests();
  const { search, win } = fakePaseoSearch();
  const workspaces = [
    workspaceRow("wks_1", "Deploy desktop"),
    workspaceRow("wks_2", "Intake: deploy remote desktop"),
    workspaceRow("wks_3", "Remove marked section"),
    workspaceRow("wks_4", "Deploy pipeline"),
  ];
  const agents = [
    agentRow("a1", "wks_1", "Deploy desktop", "Deploy desktop"),
    agentRow("a2", "wks_2", "Intake: deploy remote desktop", "Intake: deploy remote desktop"),
    // Its workspace was renamed, so the workspace row does not match "deploy": the agent row is the only hit.
    agentRow("a3", "wks_3", "Delete the struck part and deploy", "Remove marked section"),
    // Two agents in one workspace are two tabs: both stay next to the workspace row.
    agentRow("a4", "wks_4", "Deploy pipeline", "Deploy pipeline"),
    agentRow("a5", "wks_4", "Deploy pipeline reviewer", "Deploy pipeline"),
  ];

  const result = search(workspaces, agents, "deploy");

  assert.deepEqual(titles(result.workspaces), ["Deploy desktop", "Intake: deploy remote desktop", "Deploy pipeline"]);
  assert.deepEqual(titles(result.agents), [
    "Delete the struck part and deploy",
    "Deploy pipeline",
    "Deploy pipeline reviewer",
  ]);
  const everySessionReachable = ["wks_1", "wks_2", "wks_3", "wks_4"].every(
    (id) =>
      result.workspaces.some((row) => row.workspaceId === id) ||
      result.agents.some((row) => row.agent?.workspaceId === id),
  );
  assert.equal(everySessionReachable, true);

  const status = (win as any).__paseoFinderCommandCenterDedupe.status();
  assert.equal(status.enabled, true);
  assert.equal(status.lastQuery, "deploy");
  assert.equal(status.hiddenAgentRows, 2);
  assert.equal(status.keptAgentRows, 3);
  assert.equal(status.shownWorkspaceRows, 3);
});

test("Cmd+K query: an agent pass for a query with no workspace pass on record hides nothing", () => {
  resetCommandCenterDedupeForTests();
  const { exports, win } = fakePaseoSearch();
  const workspaces = [workspaceRow("wks_1", "Deploy desktop")];
  const agents = [agentRow("a1", "wks_1", "Deploy desktop", "Deploy desktop")];

  exports.filterAndRankWorkspaces(workspaces, "deploy");
  const stale = exports.filterAndRankBuiltInResults(agents, "deploy d", agentFields) as Row[];

  assert.deepEqual(titles(stale), ["Deploy desktop"]);
  assert.equal((win as any).__paseoFinderCommandCenterDedupe.status().hiddenAgentRows, 0);
});

test("Cmd+K query: turning the setting off restores Paseo's own lists", () => {
  resetCommandCenterDedupeForTests();
  const storage = fakeStorage({ [QUICK_JUMP_KEY]: JSON.stringify({ dedupeCommandCenterAgentRows: false }) });
  const { search, win } = fakePaseoSearch(storage);
  const workspaces = [workspaceRow("wks_1", "Deploy desktop")];
  const agents = [agentRow("a1", "wks_1", "Deploy desktop", "Deploy desktop")];

  const off = search(workspaces, agents, "deploy");
  assert.deepEqual(titles(off.agents), ["Deploy desktop"]);
  assert.equal((win as any).__paseoFinderCommandCenterDedupe.status().enabled, false);

  syncQuickJumpPreferences({ dedupeCommandCenterAgentRows: true }, storage);
  const on = search(workspaces, agents, "deploy");
  assert.deepEqual(titles(on.agents), []);
});

test("Cmd+K blank query: covered agents are dropped before the recents cap, so the section fills with other sessions", () => {
  resetCommandCenterDedupeForTests();
  const { search } = fakePaseoSearch();
  const workspaces = [1, 2, 3, 4, 5].map((n) => workspaceRow(`wks_${n}`, `Session ${n}`, 100 - n));
  const agents = [1, 2, 3, 4, 5].map((n) => agentRow(`a${n}`, `wks_${n}`, `Session ${n}`, `Session ${n}`, 100 - n));

  const result = search(workspaces, agents, "");

  assert.deepEqual(titles(result.workspaces), ["Session 1", "Session 2", "Session 3"]);
  assert.deepEqual(titles(result.agents), ["Session 4", "Session 5"]);
});

test("preference: defaults on, reads an explicit off, and a partial sync keeps the other fields", () => {
  assert.equal(readQuickJumpPreferences(null).dedupeCommandCenterAgentRows, true);
  assert.equal(readQuickJumpPreferences(fakeStorage()).dedupeCommandCenterAgentRows, true);

  const storage = fakeStorage({
    [QUICK_JUMP_KEY]: JSON.stringify({ enableWorkspaceQuickJump: false, quickJumpDefaultAction: "open-latest" }),
  });
  syncQuickJumpPreferences({ dedupeCommandCenterAgentRows: false }, storage);

  const prefs = readQuickJumpPreferences(storage);
  assert.equal(prefs.dedupeCommandCenterAgentRows, false);
  assert.equal(prefs.enableWorkspaceQuickJump, false);
  assert.equal(prefs.quickJumpDefaultAction, "open-latest");
  assert.equal(prefs.enableCommandCenterProjectItems, true);
});

test("reload: a hook left by an earlier plugin copy is replaced, and patching again in one copy does not stack", () => {
  resetCommandCenterDedupeForTests();
  const workspaces = [workspaceRow("wks_1", "Deploy desktop")];
  const agents = [agentRow("a1", "wks_1", "Deploy desktop", "Deploy desktop")];

  // A copy from before this change marked its hooks with `true` and kept no original.
  const nativeCalls = { builtIn: 0 };
  const native = (items: Row[], query: string, getFields: (row: Row) => { visible: string[]; hidden: string[] }) => {
    nativeCalls.builtIn += 1;
    const needle = query.trim().toLowerCase();
    return items.filter((row) => getFields(row).visible.join(" ").toLowerCase().includes(needle));
  };
  const exports: Record<string, any> = {
    filterAndRankBuiltInResults: (items: Row[], query: string, getFields: any) => native(items, query, getFields),
    filterAndRankWorkspaces: (rows: Row[], query: string) =>
      rows.filter((row) => row.title.toLowerCase().includes(query.trim().toLowerCase())),
    __paseoSessionIdSearchPatched: true,
    __paseoWorkspaceIdSearchPatched: true,
  };
  const win = {
    __c: new Map([[4355, { isInitialized: true, publicModule: { exports } }]]),
    localStorage: fakeStorage(),
  } as unknown as Window;

  assert.equal(patchCommandCenterSearch(win), true, "the earlier copy's hooks must be replaced");
  const hooked = exports.filterAndRankBuiltInResults;
  assert.equal(patchCommandCenterSearch(win), false, "a second call in the same copy changes nothing");
  assert.equal(exports.filterAndRankBuiltInResults, hooked);

  exports.filterAndRankWorkspaces(workspaces, "deploy");
  assert.deepEqual(titles(exports.filterAndRankBuiltInResults(agents, "deploy", agentFields)), []);

  // A later copy finds this copy's stamp: it must wrap the kept original, not this copy's hook.
  // Stacked hooks would run the rule twice, and the inner pass would report nothing hidden.
  exports.__paseoSessionIdSearchPatched = "another-copy";
  exports.__paseoWorkspaceIdSearchPatched = "another-copy";
  assert.equal(patchCommandCenterSearch(win), true);
  nativeCalls.builtIn = 0;
  exports.filterAndRankWorkspaces(workspaces, "deploy");
  const mixed = [...agents, agentRow("a9", "wks_9", "Deploy other", "Other")];
  assert.deepEqual(titles(exports.filterAndRankBuiltInResults(mixed, "deploy", agentFields)), ["Deploy other"]);
  assert.equal(nativeCalls.builtIn, 1, "one search must reach Paseo's function once");
  assert.equal((win as any).__paseoFinderCommandCenterDedupe.status().hiddenAgentRows, 1);
});
