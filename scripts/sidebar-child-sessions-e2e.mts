/**
 * End-to-end check of "sub-sessions in the sidebar" (T-055) in the real Paseo web app, against
 * the plugin the daemon has loaded right now. Run it after `paseo plugin reload
 * file-inspector-finder` and after every Paseo update (it reads Paseo's sidebar DOM and session
 * store, which is what breaks first):
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/sidebar-child-sessions-e2e.mts [--port 6797] [--shots <dir>] [--workspace wks_...]
 *
 * Read-only apart from navigation: it clicks one tab sub-session row (which opens a tab) and
 * never archives, renames or sends. `--workspace` makes sure that child workspace is checked
 * (its project is expanded first by scrolling it into view; a collapsed project is reported).
 * Screenshots show this machine's real sidebar, so they go to a temp dir, never the repo.
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
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-sidebar-child-sessions-e2e");
const FOCUS_WS = argValue("--workspace");

// Marker names from client/sidebar-child-sessions-web.ts.
const STYLE = "#paseo-finder-sidebar-child-sessions-style";
const TAB_ROW = '[data-testid="paseo-finder-sidebar-child-row"][data-agent-id]';

type Page = any;
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

async function shoot(page: Page, label: string, nearSelector?: string): Promise<string> {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (nearSelector) {
    await page.evaluate((sel: string) => document.querySelector(sel)?.scrollIntoView({ block: "center" }), nearSelector);
    await sleep(300);
  }
  const shot = path.join(SHOTS, `${label}.png`);
  await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 420, height: 900 } });
  return shot;
}

async function run(page: Page, shots: string[]): Promise<void> {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid^="sidebar-workspace-row-"]', { timeout: 60_000 });
  const mounted = await page.waitForSelector(STYLE, { state: "attached", timeout: 30_000 }).then(() => true, () => false);
  check("module mounted (stylesheet present)", mounted, mounted ? "" : "plugin not loaded, or the feature is off in plugin settings");
  if (!mounted) return;
  await sleep(1500); // first store subscription + throttled render

  let status = await page.evaluate(() => (window as any).__paseoFinderSidebarChildSessions?.status());
  check("status readable from window hook", Boolean(status), status ? `nested=${status.nested.length} tabParents=${status.tabRows.length} skipped=${status.skipped.length} renderMs=${status.renderMs}` : "hook missing");
  if (!status) return;
  check("Paseo session store found", status.storeFound);

  if (FOCUS_WS) {
    const n = status.nested.find((x: any) => x.workspaceId === FOCUS_WS);
    check(`--workspace ${FOCUS_WS} is planned as nested`, Boolean(n), n ? `under "${n.parentTitle}"` : "not in plan (see Settings card for the skip reason)");
  }

  // A parent row can sit behind its project's "Show more". Expanding it is a native list change,
  // which is exactly when stale `order` rules would show: sample every frame while it happens.
  const hidden = status.nested.find((n: any) => !n.onScreen && (!FOCUS_WS || n.workspaceId === FOCUS_WS));
  if (hidden) {
    const sampled = await page.evaluate(async (n: any) => {
      const rowOf = (ws: string) => document.querySelector<HTMLElement>(`[data-testid^="sidebar-workspace-row-"][data-testid$=":${ws}"]`);
      const anchor = rowOf(n.workspaceId) ?? rowOf(n.parentWorkspaceId);
      const listId = anchor?.closest('[data-testid^="sidebar-workspace-list-"]')?.getAttribute("data-testid") ?? "";
      const more = listId ? document.querySelector<HTMLElement>(`[data-testid="sidebar-project-show-more-${listId.slice("sidebar-workspace-list-".length)}"]`) : null;
      if (!more) return { clicked: false, frames: 0, bad: 0, both: 0 };
      let frames = 0, bad = 0, both = 0;
      const done = new Promise<void>((resolve) => {
        const tick = () => {
          const c = rowOf(n.workspaceId), p = rowOf(n.parentWorkspaceId);
          if (c && p) {
            both += 1;
            const gap = c.getBoundingClientRect().top - p.getBoundingClientRect().bottom;
            if (gap < -1 || gap > 6) bad += 1;
          }
          frames += 1;
          if (frames < 90) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
      more.click();
      await done;
      return { clicked: true, frames, bad, both };
    }, hidden);
    if (sampled.clicked) {
      check(`list change ("Show more"): 0 frames with "${hidden.title}" out of place`, sampled.bad === 0 && sampled.both > 0, JSON.stringify(sampled));
      await sleep(400);
      status = await page.evaluate(() => (window as any).__paseoFinderSidebarChildSessions.status());
    } else {
      console.log(`SKIP  "${hidden.title}" is not on screen and its project has no "Show more" (project collapsed?)`);
    }
  }

  const selfTest: Array<{ name: string; ok: boolean; detail: string }> = await page.evaluate(() =>
    (window as any).__paseoFinderSidebarChildSessions.selfTest(),
  );
  for (const c of selfTest) check(`self-test: ${c.name}`, c.ok, c.detail);

  // Independent geometry check for nested rows on screen: directly below the parent, or below
  // its earlier siblings, and indented further right than the parent.
  const geometry = await page.evaluate((nested: any[]) => {
    const rowOf = (ws: string) => document.querySelector<HTMLElement>(`[data-testid^="sidebar-workspace-row-"][data-testid$=":${ws}"]`);
    return nested.filter((n) => n.onScreen).map((n) => {
      const child = rowOf(n.workspaceId)!.getBoundingClientRect();
      const parent = rowOf(n.parentWorkspaceId)!.getBoundingClientRect();
      return { title: n.title, below: child.top >= parent.bottom - 1, indent: Math.round(child.left - parent.left), gap: Math.round(child.top - parent.bottom) };
    });
  }, status.nested);
  for (const g of geometry) {
    check(`nested row "${g.title}" sits below and right of its parent`, g.below && g.indent > 0, `indent=${g.indent}px gap=${g.gap}px`);
  }
  const firstNested = status.nested.find((n: any) => n.onScreen);
  if (firstNested) {
    shots.push(await shoot(page, "nested-workspace", `[data-testid^="sidebar-workspace-row-"][data-testid$=":${firstNested.workspaceId}"]`));
  }

  // The off switch (Settings toggle writes the same prefs): rows go back to native places.
  if (firstNested) {
    const gapOf = () => page.evaluate((n: any) => {
      const rowOf = (ws: string) => document.querySelector<HTMLElement>(`[data-testid^="sidebar-workspace-row-"][data-testid$=":${ws}"]`)!.getBoundingClientRect();
      const tabRows = document.querySelectorAll('[data-testid="paseo-finder-sidebar-child-row"]').length;
      return { gap: Math.round(rowOf(n.workspaceId).top - rowOf(n.parentWorkspaceId).bottom), indent: Math.round(rowOf(n.workspaceId).left - rowOf(n.parentWorkspaceId).left), tabRows };
    }, firstNested);
    await page.evaluate(() => (window as any).__paseoFinderSidebarChildSessions.setPrefs({ enabled: false }));
    await sleep(600);
    const off = await gapOf();
    check("turned off: nested row back at its native place, no tab rows", off.indent === 0 && off.tabRows === 0 && Math.abs(off.gap) > 4, JSON.stringify(off));
    await page.evaluate(() => (window as any).__paseoFinderSidebarChildSessions.setPrefs({ enabled: true }));
    await sleep(600);
    const on = await gapOf();
    check("turned back on: nested again", on.indent > 0 && on.gap >= 0 && on.gap <= 4, JSON.stringify(on));
  }

  // Drag safety. dnd-kit starts a mouse drag past 6 px. A click with 3 px of jitter must stay
  // nested; at exactly 6 px (not yet a drag) this list's order rules must be off. Release restores
  // them, and Paseo's own row order must read back unchanged.
  const pressTarget = status.nested.find((n: any) => n.onScreen);
  if (pressTarget) {
    const rowSel = `[data-testid^="sidebar-workspace-row-"][data-testid$=":${pressTarget.parentWorkspaceId}"]`;
    const readList = () => page.evaluate((args: any) => {
      const p = document.querySelector<HTMLElement>(args.rowSel)!;
      const list = p.closest('[data-testid^="sidebar-workspace-list-"]')!;
      const c = document.querySelector<HTMLElement>(`[data-testid^="sidebar-workspace-row-"][data-testid$=":${args.ws}"]`)!;
      return {
        domOrder: Array.from(list.querySelectorAll('[data-testid^="sidebar-workspace-row-"]')).map((r) => r.getAttribute("data-testid")!.slice(-8)).join(","),
        indent: Math.round(c.getBoundingClientRect().left - p.getBoundingClientRect().left),
        suspended: (window as any).__paseoFinderSidebarChildSessions.status().suspendedList,
      };
    }, { rowSel, ws: pressTarget.workspaceId });
    await page.evaluate((sel: string) => document.querySelector(sel)?.scrollIntoView({ block: "center" }), rowSel);
    await sleep(300);
    const before = await readList();
    const box = await (await page.$(rowSel)).boundingBox();
    const x = box.x + 60;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 3, { steps: 3 });
    await sleep(120);
    const jitter = await readList();
    check("press + 3 px (click jitter) keeps the list nested", !jitter.suspended && jitter.indent > 0, JSON.stringify({ suspended: Boolean(jitter.suspended), indent: jitter.indent }));
    await page.mouse.move(x, y + 6, { steps: 3 });
    await sleep(120);
    const atStart = await readList();
    check("press + 6 px (dnd-kit's threshold, not yet a drag) suspends the list's order rules", Boolean(atStart.suspended) && atStart.indent === 0, JSON.stringify({ suspended: Boolean(atStart.suspended), indent: atStart.indent }));
    await page.mouse.up();
    await sleep(500);
    const after = await readList();
    check("release restores nesting", !after.suspended && after.indent > 0, `indent=${after.indent}`);
    check("Paseo's own row order unchanged by the press", after.domOrder === before.domOrder, after.domOrder === before.domOrder ? "" : `${before.domOrder} -> ${after.domOrder}`);
  }

  // Tab sub-session rows: click one and expect Paseo to focus that agent.
  const tabRow = await page.$(TAB_ROW);
  if (!tabRow) {
    console.log("SKIP  no tab sub-session row on screen (no workspace with a same-workspace child is expanded)");
  } else {
    const agentId: string = await tabRow.getAttribute("data-agent-id");
    shots.push(await shoot(page, "tab-rows-before-click", `${TAB_ROW}[data-agent-id="${agentId}"]`));
    await tabRow.click();
    let focused = false;
    for (let i = 0; i < 20 && !focused; i += 1) {
      await sleep(250);
      focused = await page.evaluate((id: string) => {
        const tab = document.querySelector(`[data-testid="workspace-tab-agent_${id}"]`);
        return location.pathname.includes(id) || tab?.getAttribute("aria-selected") === "true";
      }, agentId);
    }
    check(`clicking a tab sub-session row opens agent ${agentId.slice(0, 8)}`, focused);
    await sleep(800);
    const current = await page.evaluate((id: string) =>
      document.querySelector(`[data-testid="paseo-finder-sidebar-child-row"][data-agent-id="${id}"]`)?.getAttribute("aria-current"), agentId);
    check("the clicked row is marked current", current === "true", `aria-current=${current}`);
    shots.push(await shoot(page, "tab-row-after-click", `${TAB_ROW}[data-agent-id="${agentId}"]`));
  }
}

const setup = resolveHarnessSetup();
if (!setup) process.exit(3);
const harness = await ensureHarness(PORT);
const require = createRequire(import.meta.url);
const { chromium } = require(setup.playwrightCore);
const browser = await chromium.launch({ executablePath: setup.chrome, headless: true });
const shots: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await run(page, shots);
} finally {
  await browser.close();
  harness?.kill();
}
for (const s of shots) console.log(`shot  ${s}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
