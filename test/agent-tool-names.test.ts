// Agent tool names must never reuse a Paseo built-in tool name.
//
// Paseo 0.15.3 `registerPluginTools` (agent/tools/plugin-tools.js) throws
// "Agent tool <name> from plugin <id> collides with Paseo tool <name>" while it
// builds an agent's tool catalog. That call sits inside
// AgentManager.buildLaunchContext, so one colliding name fails every agent
// create AND every resume on the machine, not only this plugin's tools.
// Measured 2026-11-10: `archive_workspace` did exactly that for ~5 minutes.
//
// Built-in names come from the installed Paseo.app bundle, so a tool Paseo adds
// in a later release is caught without editing this file. app.asar stores
// files uncompressed, so a byte scan for `registerTool("<name>"` finds every
// built-in in ~0.3 s with no extra dependency. When the bundle is absent
// (CI, another OS) the pinned list below is used and the test says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_APP_ASAR = "/Applications/Paseo.app/Contents/Resources/app.asar";
const MIN_PLAUSIBLE_BUILTINS = 20;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_TOOL_NAME_LENGTH = 64;

// Captured 2026-11-10 from Paseo 0.15.3 app.asar. Fallback only.
const PINNED_BUILTIN_TOOL_NAMES = [
  "archive_agent", "archive_workspace", "browser_click", "browser_close_tab",
  "browser_drag", "browser_evaluate", "browser_fill", "browser_keypress",
  "browser_list_tabs", "browser_logs", "browser_navigate", "browser_new_tab",
  "browser_resize", "browser_screenshot", "browser_scroll", "browser_select",
  "browser_snapshot", "browser_type", "browser_upload", "browser_wait",
  "cancel_agent", "capture_terminal", "create_agent", "create_heartbeat",
  "create_schedule", "create_terminal", "create_workspace", "delete_heartbeat",
  "delete_schedule", "get_agent_activity", "get_agent_status",
  "inspect_provider", "inspect_schedule", "kill_agent", "kill_terminal",
  "list_agents", "list_hosts", "list_models", "list_pending_permissions",
  "list_profiles", "list_providers", "list_schedules", "list_terminals",
  "list_workspace_scripts", "list_workspaces", "pause_schedule",
  "rename_workspace", "respond_to_permission", "resume_schedule",
  "run_schedule_once", "schedule_logs", "send_agent_prompt",
  "send_terminal_keys", "set_agent_mode", "speak", "start_workspace_script",
  "stop_workspace_script", "update_agent", "update_schedule",
];

type BuiltinSource = { names: Set<string>; source: string };

export function scanBuiltinToolNames(bundleText: string): Set<string> {
  return new Set(
    [...bundleText.matchAll(/registerTool\("([a-z0-9_]+)"/g)].map((m) => m[1]),
  );
}

export function findToolNameProblems(
  pluginToolNames: string[],
  builtinNames: Set<string>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const name of pluginToolNames) {
    // Paseo's documented rule (public-docs/plugins/hooks.md, "Attach tools to
    // agents"): a bad name, a built-in clash or a duplicate fails the session open.
    if (!TOOL_NAME_PATTERN.test(name) || name.length > MAX_TOOL_NAME_LENGTH) {
      problems.push(`${name}: must match ${TOOL_NAME_PATTERN} and be at most ${MAX_TOOL_NAME_LENGTH} characters`);
    }
    if (builtinNames.has(name)) {
      problems.push(`${name}: collides with Paseo built-in tool ${name}`);
    }
    if (seen.has(name)) problems.push(`${name}: registered twice by this plugin`);
    seen.add(name);
  }
  return problems;
}

function loadBuiltinNames(): BuiltinSource {
  const asarPath = process.env.PASEO_APP_ASAR || DEFAULT_APP_ASAR;
  if (!fs.existsSync(asarPath)) {
    return { names: new Set(PINNED_BUILTIN_TOOL_NAMES), source: "pinned 0.15.3 list" };
  }
  const names = scanBuiltinToolNames(fs.readFileSync(asarPath).toString("latin1"));
  return { names, source: asarPath };
}

async function loadPluginToolNames(): Promise<string[]> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const mod = await import(path.join(root, "index.server.ts"));
  let sessionOpen: ((arg: { request: { tools: unknown[] } }) => { tools: Array<{ name: string }> }) | null =
    null;
  const fakeServer = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === "before"
          ? (hook: string, fn: typeof sessionOpen) => {
              if (hook === "agent.session_open") sessionOpen = fn;
            }
          : () => {},
    },
  );
  const dispose = mod.default(fakeServer);
  try {
    if (!sessionOpen) {
      throw new Error("index.server.ts registered no agent.session_open hook");
    }
    const res = (sessionOpen as (arg: { request: { tools: unknown[] } }) => { tools: Array<{ name: string }> })({
      request: { tools: [] },
    });
    return res.tools.map((tool) => tool.name);
  } finally {
    if (typeof dispose === "function") dispose();
  }
}

test("checker reports a built-in collision and a duplicate (it can say no)", () => {
  const builtins = scanBuiltinToolNames('x registerTool("archive_workspace", {}) registerTool("list_agents", {})');
  assert.deepEqual([...builtins].sort(), ["archive_workspace", "list_agents"]);
  assert.deepEqual(findToolNameProblems(["reveal_in_finder", "archive_workspace", "reveal_in_finder"], builtins), [
    "archive_workspace: collides with Paseo built-in tool archive_workspace",
    "reveal_in_finder: registered twice by this plugin",
  ]);
  assert.deepEqual(findToolNameProblems(["reveal_in_finder"], builtins), []);
  assert.equal(findToolNameProblems(["finder.reveal", "Reveal", `a${"b".repeat(64)}`], builtins).length, 3);
});

test("no plugin agent tool reuses a Paseo built-in tool name", async () => {
  const { names: builtins, source } = loadBuiltinNames();
  assert.ok(
    builtins.size >= MIN_PLAUSIBLE_BUILTINS,
    `found only ${builtins.size} built-in tool names in ${source}; the registerTool scan no longer matches this Paseo build`,
  );
  const pluginTools = await loadPluginToolNames();
  assert.ok(pluginTools.length > 0, "plugin exposed no agent tools; the fake host no longer reaches them");
  console.log(
    `graded ${pluginTools.length} plugin agent tools against ${builtins.size} Paseo built-ins (${source})`,
  );
  assert.deepEqual(findToolNameProblems(pluginTools, builtins), []);
});
