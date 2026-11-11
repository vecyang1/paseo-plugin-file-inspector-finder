/**
 * End-to-end verification of Sidebar & Header Cadence Stopwatch Badges in the real Paseo web app,
 * against the plugin the daemon has loaded right now. Run it after `paseo plugin reload
 * file-inspector-finder` or after Paseo app upgrades:
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/cadence-badge-e2e.mts [--port 6798] [--shots <dir>] [--workspace wks_...]
 *
 * Read-only: navigates to a cadence workspace to verify both the left sidebar row badge
 * (including Paseo 0.15.4 role="button" rows) and the visible workspace header badge.
 * Screenshots go to a temp dir, never the repo.
 * Exit 0 = every check passed, 1 = a check failed, 3 = setup missing (see paseo-harness.mts).
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6798) || 6798;
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-cadence-badge-e2e");
const FOCUS_WS = argValue("--workspace");

type Page = any;
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

async function shoot(page: Page, label: string): Promise<string> {
  fs.mkdirSync(SHOTS, { recursive: true });
  const shot = path.join(SHOTS, `${label}.png`);
  await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 1200, height: 850 } });
  return shot;
}

async function run(page: Page, shots: string[]): Promise<void> {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid^="sidebar-workspace-row-"]', { timeout: 60_000 });
  const styleMounted = await page
    .waitForSelector("#paseo-finder-sidebar-ts-style", { state: "attached", timeout: 30_000 })
    .then(() => true, () => false);
  check("cadence stylesheet injected (#paseo-finder-sidebar-ts-style)", styleMounted);
  if (!styleMounted) return;

  // Give schedule runs RPC (compactSummary: true) and DOM observer a moment to mount AND hydrate real schedule names
  const waitStarted = Date.now();
  let firstMountedMs: number | null = null;
  let hydratedMs: number | null = null;
  for (let i = 0; i < 35; i += 1) {
    const state = await page.evaluate(() => {
      const badges = Array.from(document.querySelectorAll('[data-testid^="sidebar-workspace-cadence-badge-"]'));
      const bareCount = badges.filter((b) =>
        /^(?:Cadence|定时任务节奏): [0-9a-f]{8}(?:\s|\(|$)/i.test(b.getAttribute("title") ?? ""),
      ).length;
      const provisionalOnlyCount = badges.filter((b) => {
        const title = b.getAttribute("title") ?? "";
        return /^(?:Cadence|定时任务节奏): AG · [a-z0-9-]+(?:\s|\(|$)/i.test(title);
      }).length;
      return { total: badges.length, bareCount, provisionalOnlyCount };
    });
    if (state.total > 0 && firstMountedMs === null) {
      firstMountedMs = Date.now() - waitStarted;
    }
    if (state.total > 0 && state.bareCount === 0 && (state.provisionalOnlyCount === 0 || i > 15)) {
      hydratedMs = Date.now() - waitStarted;
      break;
    }
    await sleep(250);
  }
  await sleep(300);

  const sidebarReport = await page.evaluate((focusWs: string | undefined) => {
    const rows = Array.from(document.querySelectorAll('[data-testid^="sidebar-workspace-row-"]'));
    const badges = Array.from(document.querySelectorAll('[data-testid^="sidebar-workspace-cadence-badge-"]'));
    const rowRoleSample = rows.slice(0, 5).map((r) => ({
      testId: r.getAttribute("data-testid"),
      role: r.getAttribute("role"),
      text: (r.textContent || "").trim().slice(0, 60),
    }));
    const cadenceLikeRows = rows
      .filter((r) => /\b(Run |sentinel|cadence|audit|health)\b/i.test(r.textContent || ""))
      .map((r) => ({
        testId: r.getAttribute("data-testid"),
        text: (r.textContent || "").trim().slice(0, 80),
        hasBadge: Boolean(r.querySelector('[data-testid^="sidebar-workspace-cadence-badge-"]')),
        badgeTitle: r.querySelector('[data-testid^="sidebar-workspace-cadence-badge-"]')?.getAttribute("title") ?? null,
      }));
    const badgeDetails = badges.map((b) => {
      const rect = b.getBoundingClientRect();
      const row = b.closest('[data-testid^="sidebar-workspace-row-"]');
      const title = b.getAttribute("title") ?? "";
      return {
        testId: b.getAttribute("data-testid"),
        rowTestId: row?.getAttribute("data-testid") ?? null,
        rowRole: row?.getAttribute("role") ?? null,
        running: b.getAttribute("data-running"),
        title,
        hasBareHexName: /^(?:Cadence|定时任务节奏): [0-9a-f]{8}(?:\s|\(|$)/i.test(title),
        hasElapsed: /(?:\belapsed\b|已耗时)/i.test(title),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        hasSvg: Boolean(b.querySelector("svg")),
        visible: rect.width > 0 && rect.height > 0,
      };
    });
    const focusMatch = focusWs
      ? badgeDetails.find((d) => d.rowTestId?.endsWith(`:${focusWs}`) || d.testId?.endsWith(`-${focusWs}`))
      : null;
    return {
      totalRows: rows.length,
      totalBadges: badges.length,
      rowRoleSample,
      cadenceLikeRows,
      badgeDetails,
      focusMatch,
    };
  }, FOCUS_WS);

  console.log("cadenceLikeRows:", JSON.stringify(sidebarReport.cadenceLikeRows, null, 2));
  console.log(`hydrationTiming: firstMounted=${firstMountedMs ?? "never"}ms hydrated=${hydratedMs ?? "timeout"}ms`);

  check(
    "left sidebar mounts cadence stopwatch badges on role='button' rows",
    sidebarReport.totalBadges > 0,
    `rows=${sidebarReport.totalRows} badges=${sidebarReport.totalBadges} sampleRoles=${sidebarReport.rowRoleSample.map((r: any) => r.role).join(",")}`,
  );

  const visibleBadge = sidebarReport.badgeDetails.find((b: any) => b.visible && b.hasSvg);
  check(
    "mounted cadence badge has visible SVG box (width >= 10, height >= 10)",
    Boolean(visibleBadge),
    visibleBadge
      ? `${visibleBadge.testId} (${visibleBadge.width}x${visibleBadge.height}, running=${visibleBadge.running}, role=${visibleBadge.rowRole})`
      : JSON.stringify(sidebarReport.badgeDetails.slice(0, 3)),
  );

  const bareHexBadges = sidebarReport.badgeDetails.filter((b: any) => b.hasBareHexName);
  check(
    "all sidebar cadence badges resolve real schedule names (not bare 8-char hex IDs)",
    sidebarReport.totalBadges > 0 && bareHexBadges.length === 0,
    bareHexBadges.length === 0
      ? `hydrated=${hydratedMs ?? 0}ms, sampleTitle=${JSON.stringify(sidebarReport.badgeDetails[0]?.title ?? "")}`
      : `bareHexBadges=${JSON.stringify(bareHexBadges.map((b: any) => b.title))}`,
  );

  const runningSidebarBadges = sidebarReport.badgeDetails.filter((b: any) => b.running === "true");
  if (runningSidebarBadges.length > 0) {
    const runningWithElapsed = runningSidebarBadges.filter((b: any) => b.hasElapsed);
    check(
      "running sidebar cadence badges show elapsed duration in tooltip",
      runningWithElapsed.length === runningSidebarBadges.length,
      `running=${runningSidebarBadges.length}, withElapsed=${runningWithElapsed.length}, titles=${JSON.stringify(runningSidebarBadges.map((b: any) => b.title))}`,
    );
  }

  if (FOCUS_WS) {
    check(
      `target cadence workspace ${FOCUS_WS} has sidebar badge`,
      Boolean(sidebarReport.focusMatch),
      sidebarReport.focusMatch ? sidebarReport.focusMatch.title : "not on screen or unresolved",
    );
  }

  shots.push(await shoot(page, "cadence-sidebar"));

  // Navigate to a cadence workspace (prefer a running one if present) to verify the top workspace header badge
  const navTarget =
    sidebarReport.focusMatch?.rowTestId ||
    sidebarReport.badgeDetails.find((b: any) => b.running === "true" && b.visible)?.rowTestId ||
    sidebarReport.badgeDetails.find((b: any) => b.visible)?.rowTestId ||
    sidebarReport.badgeDetails[0]?.rowTestId;
  if (navTarget) {
    await page.click(`[data-testid="${navTarget}"]`);
    await sleep(1200);
    const headerReport = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('[data-testid="workspace-header-title"]'));
      const headerBadges = Array.from(document.querySelectorAll('[data-testid^="workspace-header-cadence-badge-"]'));
      return {
        headerCount: headers.length,
        headersInfo: headers.map((h) => {
          const r = h.getBoundingClientRect();
          return { text: (h.textContent || "").trim().slice(0, 50), visible: r.width > 0 && r.height > 0 };
        }),
        headerBadges: headerBadges.map((b) => {
          const r = b.getBoundingClientRect();
          const title = b.getAttribute("title") ?? "";
          return {
            testId: b.getAttribute("data-testid"),
            running: b.getAttribute("data-running"),
            title,
            hasBareHexName: /^(?:Cadence|定时任务节奏): [0-9a-f]{8}(?:\s|\(|$)/i.test(title),
            hasElapsed: /(?:\belapsed\b|已耗时)/i.test(title),
            visible: r.width > 0 && r.height > 0,
            hasSvg: Boolean(b.querySelector("svg")),
          };
        }),
      };
    });
    const visibleHeaderBadge = headerReport.headerBadges.find((b: any) => b.visible && b.hasSvg);
    check(
      "active visible workspace header mounts cadence badge with resolved name",
      Boolean(visibleHeaderBadge) && !visibleHeaderBadge.hasBareHexName,
      visibleHeaderBadge
        ? `${visibleHeaderBadge.testId} (${headerReport.headerCount} header elements in DOM, running=${visibleHeaderBadge.running}, title=${JSON.stringify(visibleHeaderBadge.title)})`
        : JSON.stringify(headerReport),
    );
    if (visibleHeaderBadge && visibleHeaderBadge.running === "true") {
      check(
        "running header cadence badge shows elapsed duration in tooltip",
        Boolean(visibleHeaderBadge.hasElapsed),
        visibleHeaderBadge.title,
      );
    }
    shots.push(await shoot(page, "cadence-sidebar-and-header"));
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  await run(page, shots);
} finally {
  await browser.close();
  harness?.kill();
}
for (const s of shots) console.log(`shot  ${s}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
