/**
 * End-to-end check of Settings -> Peer Agents -> Shared files (T-098) in the real Paseo web app,
 * against the plugin the daemon has loaded right now. Run it after
 * `paseo plugin reload file-inspector-finder` and after every Paseo update:
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/peer-shared-files-e2e.mts [--port 6797] [--shots <dir>]
 *
 * What it writes: two lines in the peer-presence ledger, through the real Claude edit-hook adapter,
 * for one scratch file and two made-up sessions. That gives the list a row whose content is known.
 * The lines age out of the 30-minute window by themselves. Everything else is read-only: the two
 * buttons it presses (`Re-check`, `Check recording`) only read.
 *
 * Every figure on the page is compared with the CLI's own answer in the same minute
 * (`antigravity-ops peers touching --json` and `--verify --json`).
 * Exit 0 = every check passed, 1 = a check failed, 3 = setup missing (see paseo-harness.mts).
 */
import { execFile, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6797) || 6797;
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-peer-shared-files-e2e");

const BLOCK = '[data-testid="peer-shared-files"]';
const COUNT = '[data-testid="peer-shared-files-count"]';
const RECHECK = '[data-testid="peer-shared-files-recheck"]';
const VERIFY = '[data-testid="peer-presence-verify"]';
const VERDICT = '[data-testid="peer-presence-verdict"]';
const BUSY = /checking|loading|检查中|加载中/;

const ADAPTER = path.join(os.homedir(), ".gemini/antigravity/scripts/hooks/peer_presence_claude_pre.py");
const SCRATCH = path.join(os.homedir(), ".local/share/paseo-peer-eval/e2e/shared-files-panel.md");
const SEEDED_SESSIONS = ["e2ea-shared-files-panel", "e2eb-shared-files-panel"];
const run = promisify(execFile);

type Page = any;
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

/** The CLI's JSON, whatever the exit code: `--verify` exits 1 with its report on stdout. */
async function cli(extra: string[]): Promise<any | null> {
  const out = await run("antigravity-ops", ["peers", "touching", ...extra, "--json"], { timeout: 60_000 }).then(
    (r) => r.stdout,
    (e) => String(e?.stdout ?? ""),
  );
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** Two sessions "edit" the scratch file, recorded by the same adapter process a real edit runs. */
function seedSharedFile(): boolean {
  fs.mkdirSync(path.dirname(SCRATCH), { recursive: true });
  fs.appendFileSync(SCRATCH, "");
  // The adapter keys a session on its own id; the caller's Paseo and Claude ids must not leak in.
  const env = { ...process.env };
  delete env.PASEO_AGENT_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  return SEEDED_SESSIONS.every((session) => {
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      session_id: session,
      tool_input: { file_path: SCRATCH },
    });
    return spawnSync("python3", [ADAPTER], { input: payload, env, encoding: "utf8" }).status === 0;
  });
}

async function settled(page: Page, selector: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = "";
  while (Date.now() < deadline) {
    text = await page.locator(selector).innerText().catch(() => "");
    if (text && !BUSY.test(text)) return text;
    await sleep(250);
  }
  return text;
}

const verdictWord = (ok: unknown) => (ok === true ? /ok|正常/ : ok === false ? /gap|缺口/ : /unknown|未知/);

async function probe(page: Page): Promise<void> {
  await page.goto(`http://localhost:${PORT}/settings/general`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="settings-host-section-host"]', { timeout: 45_000 });
  await page.click('[data-testid="settings-host-section-host"]');
  const serverId = String(page.url()).split("/settings/hosts/")[1]?.split("/")[0] ?? "";
  check("host settings page resolved", serverId.startsWith("srv_"));
  await page.goto(
    `http://localhost:${PORT}/settings/hosts/${serverId}/plugins/file-inspector-finder/finder-settings`,
    { waitUntil: "domcontentloaded" },
  );
  const rendered = await page.waitForSelector(BLOCK, { timeout: 45_000 }).then(() => true, () => false);
  check("Shared files block renders under Peer Agents", rendered);
  if (!rendered) return;
  await page.locator(BLOCK).scrollIntoViewIfNeeded();

  // 1. The first answer: the count and the seeded file's two rows match the CLI.
  const firstCount = await settled(page, COUNT, 45_000);
  const before = await cli([]);
  const scratchShort = SCRATCH.replace(os.homedir(), "~");
  const expected = Array.isArray(before?.paths) ? before.paths.length : null;
  check("the CLI answered, so the page has something to be compared with", expected !== null);
  check(
    "count on the page is the CLI's shared-file count",
    expected !== null && firstCount.trim().startsWith(String(expected)),
    `page "${firstCount}" vs cli ${expected}`,
  );
  const blockText = await page.locator(BLOCK).innerText();
  check("the seeded file is listed by its short path", blockText.includes(scratchShort));
  const rowsFor = (text: string) => SEEDED_SESSIONS.map((s) => s.slice(0, 8)).filter((id) => text.includes(`${id} ·`));
  check("both sessions on the seeded file have a row", rowsFor(blockText).length === 2, rowsFor(blockText).join(", "));
  check("a row carries status, age and count", /outside-paseo · \d+ ?(s|min|秒|分钟)[^·]* · ×1/.test(blockText));
  check("the empty state is not shown beside a list", !/No file is shared right now|当前没有共享文件/.test(blockText));
  await page.locator(BLOCK).screenshot({ path: path.join(SHOTS, "peer-shared-files.png") });

  // 2. Re-check reads again: the list survives and the age moves on.
  const ageBefore = (blockText.match(/e2ea-sha[^\n]*/) ?? [""])[0];
  await sleep(2_000);
  await page.click(RECHECK);
  const secondCount = await settled(page, COUNT, 45_000);
  const after = await cli([]);
  const afterText = await page.locator(BLOCK).innerText();
  check(
    "Re-check shows the CLI's count again",
    Array.isArray(after?.paths) && secondCount.trim().startsWith(String(after.paths.length)),
    `page "${secondCount}" vs cli ${after?.paths?.length}`,
  );
  check("Re-check keeps the seeded file", afterText.includes(scratchShort));
  const ageAfter = (afterText.match(/e2ea-sha[^\n]*/) ?? [""])[0];
  check("Re-check moves the age forward", ageAfter !== "" && ageAfter !== ageBefore, `"${ageBefore}" -> "${ageAfter}"`);

  // 3. Check recording gives the verdict the CLI gives in the same minute.
  await page.click(VERIFY);
  const verdict = await settled(page, VERDICT, 90_000);
  const verify = await cli(["--verify"]);
  check("the CLI gave a verify report to compare with", verify !== null && "ok" in (verify ?? {}));
  check(
    "Check recording shows the CLI's verdict",
    verify !== null && verdictWord(verify.ok).test(verdict),
    `page "${verdict}" vs cli ok=${String(verify?.ok)}`,
  );
  if (verify?.ok === false) {
    const missing = Object.values(verify.harness ?? {}).flatMap((h: any) => h.missing_sessions ?? []);
    check("a gap names the same sessions as the CLI", missing.every((id: string) => verdict.includes(id)), missing.join(", "));
  }
  const listAfterVerify = await page.locator(BLOCK).innerText();
  check("the verdict did not replace the list", listAfterVerify.includes(scratchShort));
  await page.locator(BLOCK).scrollIntoViewIfNeeded();
  await page.locator(BLOCK).screenshot({ path: path.join(SHOTS, "peer-shared-files-verified.png") });
}

async function main(): Promise<number> {
  const setup = resolveHarnessSetup();
  if (!setup) {
    console.error("Playwright or Chrome setup missing.");
    return 3;
  }
  if (!fs.existsSync(ADAPTER)) {
    console.error(`setup: the edit-hook adapter is missing (${ADAPTER})`);
    return 3;
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  check("two sessions recorded an edit to the scratch file through the real adapter", seedSharedFile());
  const harness = await ensureHarness(PORT);
  const { chromium } = createRequire(import.meta.url)(setup.playwrightCore);
  const browser = await chromium.launch({ executablePath: setup.chrome, headless: true });
  try {
    await probe(await browser.newPage({ viewport: { width: 1440, height: 900 } }));
  } catch (err) {
    check("run completed", false, err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
    harness?.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed; screenshots in ${SHOTS}`);
  return failed ? 1 : 0;
}

process.exitCode = await main();
