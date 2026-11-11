/**
 * End-to-end check that Option+D (mark session done) leaves the left sidebar where it was,
 * against the plugin the daemon has loaded right now:
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/mark-done-no-scroll-e2e.mts [--port 6811] [--shots <dir>]
 *
 * Checks:
 * 1. Open a real session from the sidebar, then park the sidebar so that session's row sits
 *    near the bottom edge (visible, far from center). Centering would have to move it.
 * 2. Press Option+D: the title gains the "d " prefix, the row flashes, and neither the
 *    sidebar scrollTop nor the row's on-screen position changes.
 * 3. Independent read-back: the daemon's workspace store (~/.paseo/projects/workspaces.json)
 *    holds the new title, not just the DOM.
 * 4. Press Option+D again: the original title comes back (DOM and store), still no scroll, and it
 *    is still there after late RPC writes settle.
 * 5. Press Option+D twice within 150ms: once both presses' writes land, the original title is stored.
 *
 * Write path: the session title is renamed twice. The finally block restores the original
 * title with `paseo workspace rename` if the run stops halfway, and prints LEAKED otherwise.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6811) || 6811;
const SHOTS = argValue("--shots") ?? path.join(os.homedir(), ".local/share/paseo-e2e/mark-done-no-scroll");
const PASEO_HOME = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
const WORKSPACES_FILE = path.join(PASEO_HOME, "projects/workspaces.json");
const ROW = '[data-testid^="sidebar-workspace-row-"]';
const SCROLL_TOLERANCE_PX = 2;
// Each rename is a native write plus a plugin RPC write; a late RPC from an earlier press has been
// measured landing 3s after the next press. Re-read the store after this long before trusting it.
const SETTLE_MS = 6000;

type Page = any;
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

function storedTitle(workspaceId: string): string | null {
  try {
    const rows = JSON.parse(fs.readFileSync(WORKSPACES_FILE, "utf8")) as Array<Record<string, unknown>>;
    const hit = rows.find((r) => String(r.workspaceId ?? "") === workspaceId);
    return hit && typeof hit.title === "string" ? hit.title : null;
  } catch {
    return null;
  }
}

async function waitForStoredTitle(workspaceId: string, expected: string): Promise<string | null> {
  let last: string | null = null;
  for (let i = 0; i < 40; i += 1) {
    last = storedTitle(workspaceId);
    if (last === expected) return last;
    await sleep(150);
  }
  return last;
}

/** Sidebar geometry for one workspace row: its scroll container's scrollTop and the row's top on screen. */
async function measure(page: Page, testId: string) {
  return page.evaluate((tid: string) => {
    const row = document.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null;
    if (!row) return null;
    let scroller: HTMLElement | null = row.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
      scroller = scroller.parentElement;
    }
    const rr = row.getBoundingClientRect();
    const sr = scroller?.getBoundingClientRect();
    return {
      scrollTop: scroller?.scrollTop ?? null,
      rowTop: rr.top,
      viewTop: sr?.top ?? 0,
      viewBottom: sr?.bottom ?? window.innerHeight,
      // Rows carry no title test id; the visible text is the title followed by badges and the timestamp.
      text: (row.textContent ?? "").trim(),
      flash: row.getAttribute("data-paseo-workspace-jump-flash"),
    };
  }, testId);
}

async function main() {
  const setup = resolveHarnessSetup();
  if (!setup) process.exit(3);
  fs.mkdirSync(SHOTS, { recursive: true });
  const harness = await ensureHarness(PORT);
  const require = createRequire(import.meta.url);
  const { chromium } = require(setup.playwrightCore) as { chromium: any };
  const browser = await chromium.launch({ executablePath: setup.chrome, headless: true });

  let page: Page = null;
  let workspaceId = "";
  let originalTitle: string | null = null;

  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(ROW, { timeout: 30_000 });
    await sleep(1500);

    // 1. Pick a mounted session row whose stored title is known, open it, let route reveal settle.
    const candidates: string[] = await page.$$eval(ROW, (els: Element[]) =>
      els.map((el) => el.getAttribute("data-testid") ?? "").filter(Boolean),
    );
    // Start from the middle of the list: a row near the top cannot be centered (scrollTop clamps
    // at 0), so it would pass this check even with the old jump-to-center behaviour.
    const middleFirst = [
      ...candidates.slice(Math.floor(candidates.length / 2)),
      ...candidates.slice(0, Math.floor(candidates.length / 2)),
    ];
    let testId = "";
    for (const tid of middleFirst) {
      const wsId = tid.replace(/^sidebar-workspace-row-[^:]*:/, "");
      if (storedTitle(wsId)) {
        testId = tid;
        workspaceId = wsId;
        break;
      }
    }
    check("found a sidebar session with a stored title", testId, `${candidates.length} rows mounted`);
    if (!testId) return;
    originalTitle = storedTitle(workspaceId);

    await page.click(`[data-testid="${testId}"]`);
    await sleep(1800);

    // Park the row near the bottom edge: visible, far from center.
    const parked = await page.evaluate((tid: string) => {
      const row = document.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null;
      if (!row) return false;
      let scroller: HTMLElement | null = row.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
        scroller = scroller.parentElement;
      }
      if (!scroller) return false;
      const sr = scroller.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      scroller.scrollTop += rr.bottom - (sr.bottom - 8);
      return true;
    }, testId);
    await sleep(400);
    const before = await measure(page, testId);
    const nearEdge =
      before && before.scrollTop !== null && before.viewBottom - before.rowTop < (before.viewBottom - before.viewTop) / 3;
    check(
      "row parked visible and off-center (centering would move it)",
      parked && nearEdge && (before?.scrollTop ?? 0) > 0,
      `scrollTop=${before?.scrollTop} rowTop=${before?.rowTop?.toFixed(0)} view=${before?.viewTop?.toFixed(0)}..${before?.viewBottom?.toFixed(0)}`,
    );
    await page.screenshot({ path: path.join(SHOTS, "1-before.png") });

    // 2. Option+D marks done without moving the sidebar.
    const marked = originalTitle?.startsWith("d ") ? originalTitle.slice(2) : `d ${originalTitle}`;
    await page.keyboard.press("Alt+KeyD");
    await sleep(250);
    const flashNow = await measure(page, testId);
    await sleep(1000);
    const after = await measure(page, testId);
    await page.screenshot({ path: path.join(SHOTS, "2-after-mark.png") });
    check("title toggled in sidebar", Boolean(after?.text.startsWith(marked)), `"${after?.text.slice(0, 60)}"`);
    check("row flashed in place", flashNow?.flash === "true");
    const dScroll = Math.abs((after?.scrollTop ?? 0) - (before?.scrollTop ?? 0));
    const dRow = Math.abs((after?.rowTop ?? 0) - (before?.rowTop ?? 0));
    // The gate is the row's position on screen. scrollTop alone can shift when a row above is
    // inserted (scroll anchoring keeps the row still), so it is reported, not graded.
    check(
      "row did not move on screen (no scroll, no centering)",
      dRow <= SCROLL_TOLERANCE_PX,
      `rowTop ${before?.rowTop?.toFixed(0)} -> ${after?.rowTop?.toFixed(0)}; scrollTop ${before?.scrollTop} -> ${after?.scrollTop} (Δ${dScroll})`,
    );

    // 3. Independent read-back from the daemon's store.
    const storedAfterMark = await waitForStoredTitle(workspaceId, marked);
    check("daemon store holds the toggled title", storedAfterMark === marked, `"${storedAfterMark}"`);

    // 4. Option+D again restores the original title, still without scrolling.
    await page.keyboard.press("Alt+KeyD");
    await sleep(1200);
    const restored = await measure(page, testId);
    await page.screenshot({ path: path.join(SHOTS, "3-after-unmark.png") });
    check(
      "title restored in sidebar",
      Boolean(originalTitle && restored?.text.startsWith(originalTitle)),
      `"${restored?.text.slice(0, 60)}"`,
    );
    check(
      "row still did not move on screen after unmark",
      Math.abs((restored?.rowTop ?? 0) - (before?.rowTop ?? 0)) <= SCROLL_TOLERANCE_PX,
      `rowTop ${before?.rowTop?.toFixed(0)} -> ${restored?.rowTop?.toFixed(0)}; scrollTop ${before?.scrollTop} -> ${restored?.scrollTop}`,
    );
    const storedAfterRestore = await waitForStoredTitle(workspaceId, originalTitle ?? "");
    check("daemon store holds the original title", storedAfterRestore === originalTitle, `"${storedAfterRestore}"`);
    await sleep(SETTLE_MS);
    const settled = storedTitle(workspaceId);
    check("original title still stored after late writes settle", settled === originalTitle, `"${settled}"`);

    // 5. Double press inside one RPC round trip: the last press must win once everything lands.
    await page.keyboard.press("Alt+KeyD");
    await sleep(150);
    await page.keyboard.press("Alt+KeyD");
    await sleep(SETTLE_MS);
    const afterDouble = storedTitle(workspaceId);
    check("quick double press ends on the original title", afterDouble === originalTitle, `"${afterDouble}"`);
  } finally {
    if (workspaceId && originalTitle !== null && storedTitle(workspaceId) !== originalTitle) {
      // Restore through a different path than the one under test.
      try {
        execFileSync("paseo", ["workspace", "rename", workspaceId, originalTitle], { stdio: "ignore" });
        await waitForStoredTitle(workspaceId, originalTitle);
      } catch {
        // reported below
      }
      if (storedTitle(workspaceId) !== originalTitle) {
        console.error(`LEAKED title change on ${workspaceId}: expected "${originalTitle}", now "${storedTitle(workspaceId)}"`);
      }
    }
    await browser.close();
    harness?.kill("SIGTERM");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nResults: ${results.length - failed.length}/${results.length} passed · shots=${SHOTS}`);
  if (failed.length > 0) {
    console.error("Failures:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("E2E test error:", err);
  process.exit(1);
});
