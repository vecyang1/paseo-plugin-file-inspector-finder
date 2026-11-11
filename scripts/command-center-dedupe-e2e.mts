/**
 * End-to-end check that Cmd+K shows each session once, in the real Paseo web app, against the
 * plugin the daemon has loaded right now. Run after `paseo plugin reload file-inspector-finder`
 * and after every Paseo update (the hook finds `filterAndRankWorkspaces` and
 * `filterAndRankBuiltInResults` by export name):
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/command-center-dedupe-e2e.mts --query <text> [--server srv_x] [--port 6797] [--shots <dir>] [--skip-settings]
 *
 * --query is text that matches a few of your own sessions; it is never stored. The run searches
 * twice in a private browser profile, with the rule off and on, and compares the rows against
 * the daemon's own agent records. It then flips the Settings switch off and on again and reads
 * the stored value after each click (skipped with --skip-settings); the value it started with is
 * restored. Screenshots show this machine's real sessions, so they go to a temp dir, never the
 * repo. Exit 0 = every check passed, 1 = a check failed, 3 = setup missing.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6797) || 6797;
const QUERY = argValue("--query") ?? "";
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-command-center-dedupe-e2e");
const SKIP_SETTINGS = args.includes("--skip-settings");
const PASEO_HOME = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
const PREFS_KEY = "paseo:finder-plugin:quick-jump-config";
const SETTINGS_FILE = path.join(PASEO_HOME, "plugin-settings/file-inspector-finder/finder-settings.json");
const SWITCH_LABELS = ["Show each session once in Cmd+K", "Cmd+K 中每个会话只显示一次"];

type Page = any;
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

/** Agent id -> workspace id, and how many agent records each workspace has, from the daemon's files. */
function readAgentRecords(): { workspaceOf: Map<string, string>; recordsPerWorkspace: Map<string, number> } {
  const workspaceOf = new Map<string, string>();
  const recordsPerWorkspace = new Map<string, number>();
  const root = path.join(PASEO_HOME, "agents");
  for (const dir of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const full = path.join(root, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full).filter((name) => name.endsWith(".json"))) {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(full, file), "utf8"));
        if (typeof record?.id !== "string" || typeof record?.workspaceId !== "string") continue;
        workspaceOf.set(record.id, record.workspaceId);
        recordsPerWorkspace.set(record.workspaceId, (recordsPerWorkspace.get(record.workspaceId) ?? 0) + 1);
      } catch {
        // A record being written right now; the next run reads it.
      }
    }
  }
  return { workspaceOf, recordsPerWorkspace };
}

function readStoredSetting(): boolean | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))?.values?.dedupeCommandCenterAgentRows;
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}

interface PaletteRead {
  workspaces: string[];
  agents: string[];
  status: { enabled: boolean; lastQuery: string | null; hiddenAgentRows: number; keptAgentRows: number } | null;
}

/** Opens Cmd+K with the rule on or off, types the query, and reads every row (the list is windowed, so it scrolls). */
async function readPalette(page: Page, enabled: boolean, shot: string): Promise<PaletteRead> {
  await page.evaluate(
    ([key, on]: [string, boolean]) => {
      const current = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({ ...current, dedupeCommandCenterAgentRows: on }));
    },
    [PREFS_KEY, enabled],
  );
  await page.keyboard.press("Meta+k");
  await page.waitForSelector('[data-testid="command-center-panel"]', { timeout: 15_000 });
  if (QUERY) await page.keyboard.type(QUERY, { delay: 25 });
  await sleep(1200);
  await page.screenshot({ path: shot });
  const rows = await page.evaluate(async () => {
    const seen = new Set<string>();
    const collect = () => {
      for (const el of Array.from(document.querySelectorAll('[data-testid^="command-center-"]'))) {
        const id = el.getAttribute("data-testid") ?? "";
        if (/^command-center-(workspace|agent)-[^:]+:.+/.test(id) && !/-subtitle$/.test(id)) seen.add(id);
      }
    };
    const results = document.querySelector('[data-testid="command-center-results"]');
    const scroller =
      [results, ...Array.from(results?.querySelectorAll("*") ?? [])].find(
        (el) => el && (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 4,
      ) ?? null;
    collect();
    if (scroller) {
      const box = scroller as HTMLElement;
      for (let guard = 0; guard < 400 && box.scrollTop + box.clientHeight < box.scrollHeight - 2; guard += 1) {
        box.scrollTop += Math.max(60, Math.floor(box.clientHeight * 0.7));
        await new Promise((resolve) => setTimeout(resolve, 60));
        collect();
      }
    }
    return Array.from(seen);
  });
  const status = await page.evaluate(() => (globalThis as any).__paseoFinderCommandCenterDedupe?.status?.() ?? null);
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="command-center-panel"]', { state: "detached", timeout: 10_000 }).catch(() => {});
  return {
    workspaces: rows.filter((id: string) => id.startsWith("command-center-workspace-")).map((id: string) => id.slice("command-center-workspace-".length)),
    agents: rows.filter((id: string) => id.startsWith("command-center-agent-")).map((id: string) => id.slice("command-center-agent-".length)),
    status,
  };
}

/** Flips the Settings switch by its label and returns what it found, for the failure message. */
async function clickSettingsSwitch(page: Page): Promise<string> {
  return page.evaluate((labels: string[]) => {
    const label = Array.from(document.querySelectorAll("*")).find(
      (el) => el.children.length === 0 && labels.includes((el.textContent ?? "").trim()),
    );
    if (!label) return "label not found";
    for (let node: Element | null = label, depth = 0; node && depth < 8; node = node.parentElement, depth += 1) {
      const control = node.querySelector('[role="switch"], input[type="checkbox"]') as HTMLElement | null;
      if (control) {
        control.scrollIntoView({ block: "center" });
        control.click();
        return "clicked";
      }
    }
    return "switch control not found next to the label";
  }, SWITCH_LABELS);
}

async function waitForStored(expected: boolean): Promise<boolean> {
  for (let i = 0; i < 40; i += 1) {
    if (readStoredSetting() === expected) return true;
    await sleep(150);
  }
  return false;
}

async function run(page: Page, shots: string): Promise<void> {
  const server = argValue("--server") ?? fs.readFileSync(path.join(PASEO_HOME, "server-id"), "utf8").trim();
  check("server id resolved", /^srv_/.test(server), server || "pass --server");
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="sidebar-footer"]', { timeout: 60_000 });
  await sleep(2500); // sessions load after the shell

  const off = await readPalette(page, false, path.join(shots, "1-rule-off.png"));
  const on = await readPalette(page, true, path.join(shots, "2-rule-on.png"));
  const { workspaceOf, recordsPerWorkspace } = readAgentRecords();

  // A row pair is a repeat when the agent's workspace row is shown too and the daemon holds
  // exactly one agent record for that workspace, so both rows can only open the same place.
  const repeats = (read: PaletteRead) =>
    read.agents.filter((agentKey) => {
      const [serverId, agentId] = [agentKey.slice(0, agentKey.indexOf(":")), agentKey.slice(agentKey.indexOf(":") + 1)];
      const workspaceId = workspaceOf.get(agentId);
      return (
        Boolean(workspaceId) &&
        recordsPerWorkspace.get(workspaceId!) === 1 &&
        read.workspaces.includes(`${serverId}:${workspaceId}`)
      );
    });
  const repeatsOff = repeats(off);
  const repeatsOn = repeats(on);
  console.log(
    `rows  off: ${off.workspaces.length} workspaces + ${off.agents.length} agents (${repeatsOff.length} repeats)  ` +
      `on: ${on.workspaces.length} workspaces + ${on.agents.length} agents (${repeatsOn.length} repeats)  ` +
      `agent records: ${workspaceOf.size}`,
  );

  check("hook reports its state", on.status && off.status, JSON.stringify(on.status));
  check("rule off: status says off", off.status?.enabled === false);
  check("rule on: status says on, for this query", on.status?.enabled === true && on.status?.lastQuery === QUERY);
  check(
    "rule off: this query shows Paseo's repeats (otherwise the run proves nothing)",
    repeatsOff.length > 0,
    repeatsOff.length ? "" : "pass a --query that matches a single-agent session title",
  );
  check("rule on: no session is listed under both sections", repeatsOn.length === 0, `${repeatsOn.length} left`);
  check(
    "rule on: workspace rows are the same as with the rule off",
    JSON.stringify([...on.workspaces].sort()) === JSON.stringify([...off.workspaces].sort()),
  );
  const unreachable = off.agents.filter((agentKey) => {
    if (on.agents.includes(agentKey)) return false;
    const serverId = agentKey.slice(0, agentKey.indexOf(":"));
    const workspaceId = workspaceOf.get(agentKey.slice(agentKey.indexOf(":") + 1));
    return !workspaceId || !on.workspaces.includes(`${serverId}:${workspaceId}`);
  });
  check("rule on: every session listed with the rule off still has a row", unreachable.length === 0, `${unreachable.length} lost`);
  if (QUERY) {
    check(
      "rule on: rows hidden equals the count the hook reports",
      off.agents.length - on.agents.length === on.status?.hiddenAgentRows,
      `${off.agents.length} - ${on.agents.length} vs ${on.status?.hiddenAgentRows}`,
    );
  }

  if (SKIP_SETTINGS) return;
  const before = readStoredSetting();
  await page.goto(`http://localhost:${PORT}/settings/hosts/${server}/plugins/file-inspector-finder/finder-settings`, {
    waitUntil: "domcontentloaded",
  });
  const labelShown = await page
    .waitForFunction(
      (labels: string[]) =>
        Array.from(document.querySelectorAll("*")).some(
          (el) => el.children.length === 0 && labels.includes((el.textContent ?? "").trim()),
        ),
      SWITCH_LABELS,
      { timeout: 60_000 },
    )
    .then(() => true, () => false);
  check("settings: the switch is on the plugin settings page", labelShown);
  if (!labelShown) return;
  await sleep(800);
  try {
    const first = await clickSettingsSwitch(page);
    const expectedAfterFirst = !(before ?? true);
    check("settings: first click is stored", first === "clicked" && (await waitForStored(expectedAfterFirst)), `${first}; stored=${readStoredSetting()}`);
    const localAfterFirst = await page.evaluate((key: string) => JSON.parse(localStorage.getItem(key) ?? "{}").dedupeCommandCenterAgentRows, PREFS_KEY);
    check("settings: first click reaches the search hook's preference", localAfterFirst === expectedAfterFirst, String(localAfterFirst));
    await page.screenshot({ path: path.join(shots, "3-settings.png") });
    const second = await clickSettingsSwitch(page);
    check("settings: second click is stored", second === "clicked" && (await waitForStored(!expectedAfterFirst)), `${second}; stored=${readStoredSetting()}`);
  } finally {
    const target = before ?? true;
    if (readStoredSetting() !== target) {
      await clickSettingsSwitch(page);
      const restored = await waitForStored(target);
      check("settings: starting value restored", restored, `stored=${readStoredSetting()} wanted=${target}`);
    } else {
      check("settings: starting value restored", true, `stored=${readStoredSetting()}`);
    }
  }
}

const setup = resolveHarnessSetup();
if (!setup) process.exit(3);
fs.mkdirSync(SHOTS, { recursive: true });
const harness = await ensureHarness(PORT);
const { chromium } = createRequire(import.meta.url)(setup.playwrightCore);
const browser = await chromium.launch({ executablePath: setup.chrome, headless: true });
try {
  await run(await browser.newPage({ viewport: { width: 1440, height: 900 } }), SHOTS);
} catch (error) {
  check("run without exception", false, String(error).slice(0, 300));
} finally {
  await browser.close();
  harness?.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
