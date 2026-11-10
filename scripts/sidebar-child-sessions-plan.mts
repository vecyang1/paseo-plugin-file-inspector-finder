/**
 * Agent-side read of "sub-sessions in the sidebar" (T-055): runs the same planner the sidebar
 * uses (`shared/sidebar-child-sessions.ts`) over the daemon's files, so an agent can answer
 * "will this session nest under its parent, and if not, why?" without opening the app.
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/sidebar-child-sessions-plan.mts [--agent <id or prefix>] [--json]
 *
 * Reads `~/.paseo/agents/<bucket>/*.json` and `~/.paseo/projects/workspaces.json` (PASEO_HOME
 * overrides `~/.paseo`). Read-only. The app reads the live session store instead, which can be
 * a few seconds ahead of these files; Settings -> Plugins -> File Inspector & Finder ->
 * "Sub-sessions in the sidebar" shows the app's own answer.
 * Exit 0 = printed, 2 = `--agent` matched nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planChildSessions, readParentAgentId, type ChildSessionAgent } from "../shared/sidebar-child-sessions.ts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const AGENT = argValue("--agent")?.replace(/^#/, "");
const JSON_OUT = args.includes("--json");
const HOME = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const agents: Array<ChildSessionAgent & { serverHint?: string }> = [];
const agentsDir = path.join(HOME, "agents");
for (const bucket of fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir) : []) {
  const dir = path.join(agentsDir, bucket);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const rec = readJson(path.join(dir, f));
    if (!rec?.id || rec.internal || rec.labels?.["paseo.internal"] === "true") continue;
    agents.push({
      id: rec.id,
      workspaceId: rec.workspaceId ?? null,
      labels: rec.labels ?? null,
      archivedAt: rec.archivedAt ?? (bucket === "archived" ? rec.updatedAt ?? "archived" : null),
      title: rec.title ?? null,
      status: rec.lastStatus ?? null,
      requiresAttention: Boolean(rec.requiresAttention),
      createdAt: rec.createdAt ?? null,
      lastActivityAt: rec.lastActivityAt ?? rec.updatedAt ?? null,
    });
  }
}
const workspaces: any[] = readJson(path.join(HOME, "projects", "workspaces.json")) ?? [];
const wsTitle = new Map<string, string>();
const archivedWs: string[] = [];
for (const ws of Array.isArray(workspaces) ? workspaces : []) {
  const id = String(ws.workspaceId ?? ws.id ?? "");
  if (!id) continue;
  const title = String(ws.title ?? "").trim() || (ws.displayName && ws.displayName !== "main" ? String(ws.displayName) : "");
  if (title) wsTitle.set(id, title);
  if (ws.archivedAt && !ws.pinnedAt) archivedWs.push(id);
}

// The files carry no server id of their own; a parent-server label is compared only when the
// whole store agrees on one, which is the single-host case this script is for.
const plan = planChildSessions(agents, { archivedWorkspaceIds: archivedWs });
const byId = new Map(agents.map((a) => [a.id, a]));
const titleOf = (id: string) => byId.get(id)?.title || id.slice(0, 8);
const wsName = (id: string) => wsTitle.get(id) ?? id;

const nested = [...plan.childWorkspaces.values()].map((l) => ({
  workspaceId: l.workspaceId,
  workspace: wsName(l.workspaceId),
  parentWorkspaceId: l.parentWorkspaceId,
  parentWorkspace: wsName(l.parentWorkspaceId),
  sessions: l.links.map((x) => ({ agentId: x.agentId, title: titleOf(x.agentId), parentAgentId: x.parentAgentId })),
}));
const tabs = [...plan.tabChildren.entries()].map(([ws, rows]) => ({
  workspaceId: ws,
  workspace: wsName(ws),
  rows: rows.map((r) => ({ agentId: r.agentId, title: r.title, depth: r.depth, parentAgentId: r.parentAgentId })),
}));
const skipped = plan.skipped.map((s) => ({ ...s, title: titleOf(s.agentId) }));

if (AGENT) {
  const match = agents.find((a) => a.id === AGENT || a.id.startsWith(AGENT));
  if (!match) {
    console.error(`no agent matches ${AGENT}`);
    process.exit(2);
  }
  const parentId = readParentAgentId(match);
  const asNested = nested.find((n) => n.sessions.some((s) => s.agentId === match.id));
  const asTab = tabs.find((t) => t.rows.some((r) => r.agentId === match.id));
  const skip = skipped.find((s) => s.agentId === match.id);
  const verdict = asNested
    ? { placement: "nested-workspace", under: asNested.parentWorkspace, parentWorkspaceId: asNested.parentWorkspaceId }
    : asTab
      ? { placement: "tab-row", under: asTab.workspace, workspaceId: asTab.workspaceId }
      : skip
        ? { placement: "top-level", reason: skip.reason }
        : { placement: "top-level", reason: parentId ? "archived or hidden" : "no parent label (started by a person)" };
  const out = { agentId: match.id, title: match.title, workspaceId: match.workspaceId, parentAgentId: parentId || null, ...verdict };
  console.log(JSON_OUT ? JSON.stringify(out, null, 2) : Object.entries(out).map(([k, v]) => `${k}: ${v}`).join("\n"));
  process.exit(0);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ nested, tabs, skipped }, null, 2));
} else {
  console.log(`Nested workspaces (${nested.length})`);
  for (const n of nested) console.log(`  ${n.workspace}  <-  ${n.parentWorkspace}  [${n.sessions.map((s) => s.agentId.slice(0, 8)).join(", ")}]`);
  console.log(`Tab sub-sessions (${tabs.reduce((a, t) => a + t.rows.length, 0)} in ${tabs.length} workspaces)`);
  for (const t of tabs) for (const r of t.rows) console.log(`  ${t.workspace}  ${"  ".repeat(r.depth - 1)}└ ${r.title} #${r.agentId.slice(0, 8)}`);
  console.log(`Started by a session but kept at top level (${skipped.length})`);
  for (const s of skipped) console.log(`  ${s.title} #${s.agentId.slice(0, 8)}: ${s.reason}`);
}
