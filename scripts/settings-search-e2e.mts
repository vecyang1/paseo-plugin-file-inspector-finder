/**
 * End-to-end check of Settings Search in the real Paseo web app, against the plugin the daemon
 * has loaded right now. Run it after `paseo plugin reload file-inspector-finder` and after every
 * Paseo update (Settings Search reads Paseo's own settings DOM, which is what breaks first):
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/settings-search-e2e.mts [--port 6797] [--shots <dir>]
 *
 * Read-only: it types into the search field and presses keys; it never clicks a setting.
 * Screenshots show this machine's real host page, so they go to a temp dir, never the repo.
 * Exit 0 = every check passed, 1 = a check failed, 3 = setup missing (see paseo-harness.mts).
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6797) || 6797;
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-settings-search-e2e");

// Marker names from client/settings-search-web.ts.
const INPUT = '[data-testid="settings-search-input"]';
const RESULT = '[data-testid="settings-search-result"]';
const HIT = '[data-finder-settings-hit="1"]';
const SHORTCUT = process.platform === "darwin" ? "Meta+f" : "Control+f";

type Page = any;
interface Row {
  title: string;
  text: string;
  selected: boolean;
}

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, "").replace(/srv_[A-Za-z0-9]+/, "<server>");

async function readHit(page: Page) {
  return page.evaluate((selector: string) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      text: (el.textContent || "").trim().slice(0, 80),
      offset: Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2) / window.innerHeight,
      visible: rect.bottom > 0 && rect.top < window.innerHeight,
    };
  }, HIT);
}

async function search(page: Page, query: string): Promise<Row[]> {
  const input = page.locator(INPUT);
  await input.fill("");
  await input.type(query, { delay: 30 });
  await page.waitForSelector(RESULT, { timeout: 15_000 });
  await sleep(300);
  return page.$$eval(RESULT, (rows: Element[]) =>
    rows.map((row) => ({
      title: (row.querySelector(".pfss-title")?.textContent || "").trim(),
      text: (row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90),
      selected: row.getAttribute("aria-selected") === "true",
    })),
  );
}

const selectedIndex = (page: Page): Promise<number> =>
  page.$$eval(RESULT, (rows: Element[]) => rows.findIndex((row) => row.getAttribute("aria-selected") === "true"));

/** Enter on the selected result: the page must change to `wantPath` and `wantTitle` must flash mid-screen. */
async function enterAndExpect(page: Page, label: string, wantTitle: string, wantPath: string): Promise<string> {
  const before = page.url();
  await page.keyboard.press("Enter");
  let hit = null;
  for (let i = 0; i < 40 && !hit; i += 1) {
    await sleep(150);
    hit = await readHit(page);
  }
  check(`${label}: navigated to ${wantPath}`, page.url().includes(wantPath), `${pathOf(before)} -> ${pathOf(page.url())}`);
  check(
    `${label}: target row flashed`,
    hit?.text.toLowerCase().includes(wantTitle.toLowerCase()),
    hit ? `hit="${hit.text}"` : "no element carries data-finder-settings-hit",
  );
  if (hit) {
    await sleep(700); // smooth scroll
    hit = (await readHit(page)) ?? hit;
    check(`${label}: row scrolled near the middle`, hit.visible && hit.offset < 0.25, `center offset ${(hit.offset * 100).toFixed(0)}% of viewport`);
  }
  const shot = path.join(SHOTS, `${label}.png`);
  await page.screenshot({ path: shot });
  return shot;
}

async function run(page: Page, shots: string[]): Promise<void> {
  await page.goto(`http://localhost:${PORT}/settings/general`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="settings-sidebar"]', { timeout: 60_000 });
  const mounted = await page.waitForSelector(INPUT, { timeout: 30_000 }).then(() => true, () => false);
  check("search field mounted in Settings", mounted, mounted ? "" : "plugin not loaded, or Search Settings is off in the plugin settings");
  if (!mounted) return;

  const placement = await page.evaluate((selector: string) => {
    const input = document.querySelector(selector)!.getBoundingClientRect();
    const list = (document.querySelector('[data-testid="settings-sidebar-scroll-body"]') ??
      document.querySelector('[data-testid="settings-sidebar"]'))!.getBoundingClientRect();
    return { inputBottom: input.bottom, listTop: list.top, inputLeft: input.left, sidebarLeft: list.left, sidebarRight: list.right };
  }, INPUT);
  check(
    "field sits above the sidebar list",
    placement.inputBottom <= placement.listTop + 2 && placement.inputLeft >= placement.sidebarLeft - 2 && placement.inputLeft < placement.sidebarRight,
    JSON.stringify(placement),
  );

  await page.mouse.click(1000, 450); // focus the detail pane, away from the field
  await page.keyboard.press(SHORTCUT);
  await sleep(200);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  check("Cmd+F focuses the field", focused === "settings-search-input", `activeElement=${focused}`);

  // 1. A typo finds a host-page row, and Enter follows the host route.
  let rows = await search(page, "dameon");
  const daemon = rows.findIndex((row) => /restart daemon/i.test(row.title));
  check("typo 'dameon' finds Restart daemon", daemon >= 0, rows.slice(0, 4).map((row) => row.title).join(" | "));
  for (let i = Math.max(await selectedIndex(page), 0); i < daemon; i += 1) await page.keyboard.press("ArrowDown");
  shots.push(await enterAndExpect(page, "typo-host-route", "Restart daemon", "/host"));

  // 2. A plain app section page.
  await page.keyboard.press(SHORTCUT); // the shortcut must also work on the page we just jumped to
  rows = await search(page, "code font");
  check("'code font' ranks Code font first", /code font/i.test(rows[0]?.title ?? ""), rows.slice(0, 3).map((row) => row.title).join(" | "));
  shots.push(await enterAndExpect(page, "section-route", "Code font", "/settings/appearance"));

  // 3. Arrow keys move the selection and Enter opens the SELECTED row, not the first one.
  await page.keyboard.press(SHORTCUT); // the shortcut must also work on the page we just jumped to
  rows = await search(page, "font");
  check("'font' returns several results (precondition for the arrow checks)", rows.length > 1, rows.map((row) => row.title).join(" | "));
  const first = await selectedIndex(page);
  await page.keyboard.press("ArrowDown");
  await sleep(150);
  const down = await selectedIndex(page);
  check("ArrowDown moves the selection", down === first + 1, `selected ${first} -> ${down} of ${rows.length}`);
  await page.keyboard.press("ArrowUp");
  await sleep(150);
  const up = await selectedIndex(page);
  check("ArrowUp moves it back", up === first && down !== first, `selected ${down} -> ${up}`);
  await page.keyboard.press("ArrowDown");
  await sleep(150);
  const second = rows[await selectedIndex(page)];
  check("second result differs from the first", second && second.title !== rows[0].title, `first="${rows[0]?.title}" second="${second?.title}"`);
  shots.push(await enterAndExpect(page, "arrow-selected-row", second?.title || "?", "/settings/"));

  // 4. Esc clears the query and the result list.
  await page.keyboard.press(SHORTCUT); // the shortcut must also work on the page we just jumped to
  await search(page, "font");
  await page.keyboard.press("Escape");
  await sleep(200);
  const cleared = await page.evaluate(
    ([input, result]: string[]) => ({
      value: (document.querySelector(input) as HTMLInputElement).value,
      results: document.querySelectorAll(result).length,
    }),
    [INPUT, RESULT],
  );
  check("Esc clears the query and the results", cleared.value === "" && cleared.results === 0, JSON.stringify(cleared));
}

async function main(): Promise<number> {
  const setup = resolveHarnessSetup();
  if (!setup) return 3;
  fs.mkdirSync(SHOTS, { recursive: true });
  const harness = await ensureHarness(PORT);
  const { chromium } = createRequire(import.meta.url)(setup.playwrightCore);
  const browser = await chromium.launch({ executablePath: setup.chrome, headless: true });
  const shots: string[] = [];
  try {
    await run(await browser.newPage({ viewport: { width: 1440, height: 900 } }), shots);
  } catch (error) {
    check("run completed", false, error instanceof Error ? error.message : String(error));
  } finally {
    await browser.close();
    harness?.kill();
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed; screenshots in ${SHOTS}`);
  if (results.length < 10) {
    console.log("fewer than 10 checks ran, so this run is not evidence the feature works");
    return 1;
  }
  return failed ? 1 : 0;
}

process.exitCode = await main();
