/**
 * End-to-end check for automatic [pin] title prefix on Paseo pin/unpin transitions
 * against the plugin loaded in the live Paseo daemon:
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/pin-prefix-e2e.mts [--port 6815] [--shots <dir>]
 *
 * Checks:
 * 1. Picks an unpinned active sidebar workspace, opens it, and reads its original header & stored title.
 * 2. Pins it via the real UI context menu ("Pin to top") or Cmd+Option+P fallback:
 *    verifies workspace-header-title, sidebar Pinned row, and ~/.paseo/projects/workspaces.json
 *    all gain the "[pin] " prefix.
 * 3. Unpins it: verifies header, sidebar, and workspaces.json cleanly restore the original title.
 * 4. Opens Settings -> Plugins -> File Inspector & Finder and verifies the [pin] prefix controls
 *    (Read / Inspect / Sync) render and respond with 0 console errors.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6815) || 6815;
const SHOTS = argValue("--shots") ?? path.join(os.homedir(), ".local/share/paseo-e2e/pin-prefix");
const PASEO_HOME = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
const WORKSPACES_FILE = path.join(PASEO_HOME, "projects/workspaces.json");
const ROW = '[data-testid^="sidebar-workspace-row-"]';

type Page = any;
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

function readWorkspaceRecord(workspaceId: string): Record<string, unknown> | null {
  try {
    const rows = JSON.parse(fs.readFileSync(WORKSPACES_FILE, "utf8")) as Array<Record<string, unknown>>;
    return rows.find((r) => String(r.workspaceId ?? "") === workspaceId) ?? null;
  } catch {
    return null;
  }
}

async function waitForStoreState(
  workspaceId: string,
  predicate: (row: Record<string, unknown> | null) => boolean,
  timeoutMs = 8000,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    last = readWorkspaceRecord(workspaceId);
    if (predicate(last)) return last;
    await sleep(150);
  }
  return last;
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
  let targetWsId = "";
  let originalTitle: string | null = null;
  let needsCleanup = false;
  const consoleErrors: string[] = [];

  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    page.on("console", (msg: any) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err: Error) => consoleErrors.push(err.message));

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(ROW, { timeout: 30_000 });
    await sleep(2000);

    // 1. Pick an unpinned, non-archived workspace row whose stored title is known and doesn't start with [pin]
    const candidates: string[] = await page.$$eval(ROW, (els: Element[]) =>
      els.map((el) => el.getAttribute("data-testid") ?? "").filter(Boolean),
    );
    let targetTestId = "";
    for (const tid of candidates) {
      const wsId = tid.replace(/^sidebar-workspace-row-[^:]*:/, "");
      const rec = readWorkspaceRecord(wsId);
      const t = typeof rec?.title === "string" ? rec.title.trim() : "";
      if (rec && !rec.pinnedAt && !rec.archivedAt && t && !t.startsWith("[pin]")) {
        targetTestId = tid;
        targetWsId = wsId;
        originalTitle = t;
        break;
      }
    }

    check("found an unpinned workspace candidate", targetTestId && originalTitle, `${targetWsId}: ${originalTitle ?? "none"}`);
    if (!targetTestId || !originalTitle) return;

    await page.click(`[data-testid="${targetTestId}"]`);
    await sleep(1200);

    const initialHeaderText = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[data-testid="workspace-header-title"]')) as HTMLElement[];
      const visible = els.find((el) => el.offsetParent !== null || el.getBoundingClientRect().width > 0);
      return (visible?.textContent ?? "").trim();
    });
    check("header shows original unpinned title", initialHeaderText === originalTitle, `header="${initialHeaderText}"`);

    // 2. Pin the workspace via right-click context menu ("Pin to top")
    needsCleanup = true;
    await page.click(`[data-testid="${targetTestId}"]`, { button: "right" });
    await sleep(450);
    const pinMenuSel = `[data-testid^="sidebar-workspace-menu-pin-"][data-testid$="${targetWsId}"], [data-testid^="sidebar-workspace-menu-pin-"]`;
    const menuPin = await page.$(pinMenuSel);
    if (menuPin) {
      await menuPin.click();
    } else {
      // Fallback: keyboard shortcut Cmd+Option+P
      await page.keyboard.press("Alt+Meta+KeyP");
    }

    const expectedPinnedTitle = `[pin] ${originalTitle}`;
    const pinnedRow = await waitForStoreState(
      targetWsId,
      (r) => Boolean(r?.pinnedAt) && r?.title === expectedPinnedTitle,
      9000,
    );
    await sleep(600);

    const pinnedHeaderText = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[data-testid="workspace-header-title"]')) as HTMLElement[];
      const visible = els.find((el) => el.offsetParent !== null || el.getBoundingClientRect().width > 0);
      return (visible?.textContent ?? "").trim();
    });
    const pinnedSidebarText = await page.evaluate((wsId: string) => {
      const pinnedList = document.querySelector('[data-testid="sidebar-pinned-list"], [data-testid="sidebar-pinned-section"]');
      const row = pinnedList?.querySelector(`[data-testid^="sidebar-workspace-row-"][data-testid$=":${wsId}"]`) as HTMLElement | null;
      return (row?.textContent ?? "").trim();
    }, targetWsId);

    await page.screenshot({ path: path.join(SHOTS, "01-pinned-header-and-sidebar.png") });
    check("workspaces.json persisted pinnedAt and [pin] title", pinnedRow?.title === expectedPinnedTitle && Boolean(pinnedRow?.pinnedAt), `stored="${String(pinnedRow?.title ?? "")}"`);
    check("header title displays [pin] prefix directly", pinnedHeaderText === expectedPinnedTitle, `header="${pinnedHeaderText}"`);
    check("sidebar Pinned section displays [pin] prefix", pinnedSidebarText.includes("[pin]"), `sidebar="${pinnedSidebarText.slice(0, 60)}"`);

    // 3. Unpin the workspace via right-click menu or runtime store
    await page.click(`[data-testid="sidebar-pinned-section"] [data-testid^="sidebar-workspace-row-"][data-testid$=":${targetWsId}"]`, { button: "right" }).catch(async () => {
      await page.click(`[data-testid="${targetTestId}"]`, { button: "right" });
    });
    await sleep(450);
    const unpinMenu = await page.$('[data-testid^="sidebar-workspace-menu-pin-"]');
    if (unpinMenu) {
      await unpinMenu.click();
    } else {
      await page.keyboard.press("Alt+Meta+KeyP");
    }

    const unpinnedRow = await waitForStoreState(
      targetWsId,
      (r) => !r?.pinnedAt && r?.title === originalTitle,
      9000,
    );
    await sleep(600);
    const unpinnedHeaderText = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[data-testid="workspace-header-title"]')) as HTMLElement[];
      const visible = els.find((el) => el.offsetParent !== null || el.getBoundingClientRect().width > 0);
      return (visible?.textContent ?? "").trim();
    });

    await page.screenshot({ path: path.join(SHOTS, "02-unpinned-restored.png") });
    check("workspaces.json cleared pinnedAt and restored original title", unpinnedRow?.title === originalTitle && !unpinnedRow?.pinnedAt, `stored="${String(unpinnedRow?.title ?? "")}"`);
    check("header title cleanly restored original title", unpinnedHeaderText === originalTitle, `header="${unpinnedHeaderText}"`);
    if (unpinnedRow?.title === originalTitle && !unpinnedRow?.pinnedAt) {
      needsCleanup = false;
    }

    // 4. Open Plugin Settings and verify Read / Test / Tune controls for [pin] prefix
    const serverId = targetTestId.replace(/^sidebar-workspace-row-/, "").split(":")[0] || "local";
    const settingsUrl = `http://127.0.0.1:${PORT}/settings/hosts/${serverId}/plugins/file-inspector-finder/finder-settings`;
    await page.goto(settingsUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="settings-sidebar"]', { timeout: 20_000 });
    await sleep(1500);
    const inspectBtn = page.locator('[aria-label="Inspect pinned"], [aria-label="检查已置顶"]').first();
    await inspectBtn.scrollIntoViewIfNeeded();
    await inspectBtn.click();
    await sleep(600);
    const settingsHasPinUi = await page.evaluate(() => {
      const txt = document.body.innerText ?? "";
      return (txt.includes("Pin title prefix") || txt.includes("置顶标题前缀")) && (txt.includes("Pinned:") || txt.includes("当前置顶会话:")) && txt.includes("[ok]");
    });
    await page.screenshot({ path: path.join(SHOTS, "03-settings-pin-prefix.png") });
    check("Settings exposes Read/Test/Tune controls for [pin] prefix", settingsHasPinUi);
    check("zero console/page errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join("; "));
  } finally {
    if (needsCleanup && targetWsId && originalTitle) {
      try {
        await page?.evaluate(async ({ wsId, title }: { wsId: string; title: string }) => {
          const bridge = (window as any).__paseoHostRuntimeStore;
          const ctrls = bridge?.controllers instanceof Map ? Array.from(bridge.controllers.values()) : [];
          for (const c of ctrls as any[]) {
            const cl = c?.activeClient ?? c?.getClient?.();
            if (cl?.setWorkspacePinned) await cl.setWorkspacePinned(wsId, false).catch(() => {});
          }
          void title;
        }, { wsId: targetWsId, title: originalTitle });
        execFileSync("paseo", ["workspace", "rename", targetWsId, originalTitle], { stdio: "ignore" });
      } catch {
        // Ignore best-effort cleanup
      }
    }
    await browser.close().catch(() => {});
    if (harness) harness.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
