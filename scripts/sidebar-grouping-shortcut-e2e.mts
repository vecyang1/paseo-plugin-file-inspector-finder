/**
 * End-to-end check of Sidebar Grouping Shortcuts in the real Paseo web app:
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/sidebar-grouping-shortcut-e2e.mts [--port 6798] [--shots <dir>]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6798) || 6798;
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-sidebar-grouping-shortcut-e2e");
const PASEO_HOME = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
const SETTINGS_FILE = path.join(
  PASEO_HOME,
  "plugin-settings/file-inspector-finder/finder-settings.json",
);

type Page = any;
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

function readStoredSettings(): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return raw?.values && typeof raw.values === "object"
      ? (raw.values as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function waitForStored(
  predicate: (v: Record<string, unknown> | null) => boolean,
): Promise<boolean> {
  for (let i = 0; i < 40; i += 1) {
    if (predicate(readStoredSettings())) return true;
    await sleep(150);
  }
  return false;
}

async function main() {
  const setup = resolveHarnessSetup();
  if (!setup) process.exit(3);
  const serverId =
    argValue("--server") ?? fs.readFileSync(path.join(PASEO_HOME, "server-id"), "utf8").trim();

  fs.mkdirSync(SHOTS, { recursive: true });
  const harness = await ensureHarness(PORT);

  const require = createRequire(import.meta.url);
  const { chromium } = require(setup.playwrightCore) as { chromium: any };
  const browser = await chromium.launch({
    executablePath: setup.chrome,
    headless: true,
  });

  let page: Page = null;
  let switchedCustom = false;

  try {
    page = await browser.newPage({
      viewport: { width: 1280, height: 860 },
    });

    const consoleErrors: string[] = [];
    page.on("console", (msg: any) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    console.log(`Navigating to http://127.0.0.1:${PORT}/new ...`);
    await page.goto(`http://127.0.0.1:${PORT}/new`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="sidebar-display-preferences-menu"]', {
      timeout: 20_000,
    });
    await sleep(800);

    // 1. Check plugin bridge & initial status
    const initStatus = await page.evaluate(() => {
      const b = (window as any).__paseoFinderSidebarGrouping;
      return b ? b.status() : null;
    });
    check(
      "Plugin sidebar grouping bridge installed & store available",
      Boolean(initStatus?.installed && initStatus?.storeAvailable),
      `mode=${initStatus?.currentMode} project=${initStatus?.displayProjectShortcut} status=${initStatus?.displayStatusShortcut}`,
    );

    // 2. Press Ctrl+Cmd+S to switch to Status grouping
    await page.keyboard.press("Control+Meta+s");
    await sleep(450);
    const afterStatus = await page.evaluate(() => {
      const b = (window as any).__paseoFinderSidebarGrouping;
      const toast = document.getElementById("paseo-finder-sidebar-grouping-toast");
      return {
        mode: b?.status()?.currentMode,
        toastText: toast?.textContent ?? null,
      };
    });
    check(
      "Ctrl+Cmd+S switches sidebar grouping to 'status'",
      afterStatus.mode === "status",
      `mode=${afterStatus.mode}, toast="${afterStatus.toastText}"`,
    );

    // 3. Press Ctrl+Cmd+P to switch to Project grouping
    await page.keyboard.press("Control+Meta+p");
    await sleep(450);
    const afterProject = await page.evaluate(() => {
      const b = (window as any).__paseoFinderSidebarGrouping;
      const toast = document.getElementById("paseo-finder-sidebar-grouping-toast");
      const projRows = document.querySelectorAll('[data-testid^="sidebar-project-row-"]').length;
      return {
        mode: b?.status()?.currentMode,
        toastText: toast?.textContent ?? null,
        projRows,
      };
    });
    check(
      "Ctrl+Cmd+P switches sidebar grouping to 'project'",
      afterProject.mode === "project",
      `mode=${afterProject.mode}, projRows=${afterProject.projRows}, toast="${afterProject.toastText}"`,
    );

    // 4. Open sidebar display menu -> Grouping submenu and verify shortcut badges
    await page.click('[data-testid="sidebar-display-preferences-menu"]');
    await sleep(300);
    const groupingTrigger = page.locator('[data-testid="sidebar-display-grouping"]').first();
    await groupingTrigger.hover();
    await sleep(250);
    if ((await page.locator('[data-testid="sidebar-grouping-project"]').count()) === 0) {
      await groupingTrigger.click();
      await sleep(250);
    }

    const menuBadges = await page.evaluate(() => {
      const pHint = document.querySelector(
        '[data-testid="sidebar-grouping-project-shortcut-hint"]',
      )?.textContent;
      const sHint = document.querySelector(
        '[data-testid="sidebar-grouping-status-shortcut-hint"]',
      )?.textContent;
      return { pHint, sHint };
    });
    check(
      "Native Grouping menu items annotated with ⌃⌘P and ⌃⌘S badges",
      menuBadges.pHint === "⌃⌘P" && menuBadges.sHint === "⌃⌘S",
      `project="${menuBadges.pHint}", status="${menuBadges.sHint}"`,
    );
    await page.screenshot({ path: path.join(SHOTS, "01-grouping-menu-annotated.png") });
    await page.keyboard.press("Escape");
    await sleep(200);

    // 5. Navigate to Plugin Settings screen and verify 能读 / 能试 / 能调
    const settingsUrl = `http://127.0.0.1:${PORT}/settings/hosts/${serverId}/plugins/file-inspector-finder/finder-settings`;
    console.log(`Navigating to ${settingsUrl} ...`);
    await page.goto(settingsUrl, { waitUntil: "domcontentloaded" });
    await sleep(1000);

    const statusBtn = page
      .locator('[aria-label="Switch to Status"], [aria-label="切至按状态"]')
      .first();
    await statusBtn.scrollIntoViewIfNeeded();
    await statusBtn.click();
    await sleep(300);

    const modeAfterSettingsStatus = await page.evaluate(() => {
      return (window as any).__paseoFinderSidebarGrouping?.status()?.currentMode;
    });
    check(
      "Settings 'Switch to Status' button switches live mode",
      modeAfterSettingsStatus === "status",
      `mode=${modeAfterSettingsStatus}`,
    );

    const selfTestBtn = page
      .locator('[aria-label="Run self-test"], [aria-label="运行自检"]')
      .last();
    await selfTestBtn.scrollIntoViewIfNeeded();
    await selfTestBtn.click();
    await sleep(300);

    const hasOkReceipt = await page.evaluate(() => {
      return (document.body.innerText ?? "").includes("[self-test]");
    });
    check("Settings 'Run self-test' records visible [self-test] receipt", hasOkReceipt);

    await page.screenshot({ path: path.join(SHOTS, "02-settings-observability.png") });

    // 6. Test switching preset to Custom and recording/applying custom shortcut
    const presetUpdated = await page.evaluate(() => {
      const labels = ["Grouping shortcut preset", "分组快捷键组合"];
      const labelEl = Array.from(document.querySelectorAll("*")).find(
        (el) => el.children.length === 0 && labels.includes((el.textContent ?? "").trim()),
      );
      if (!labelEl) return false;
      let row: Element | null = labelEl;
      for (let d = 0; d < 6 && row; d += 1, row = row.parentElement) {
        const sel = row.querySelector("select") as HTMLSelectElement | null;
        if (sel) {
          sel.value = "custom";
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      return false;
    });
    if (presetUpdated) {
      switchedCustom = true;
      await sleep(300);
      const savedCustom = await waitForStored(
        (v) => v?.sidebarGroupingPreset === "custom",
      );
      check("Custom preset persists to finder-settings.json", savedCustom);
    }

    // 7. Reset back to default cleanly
    const projectBtn = page
      .locator('[aria-label="Switch to Project"], [aria-label="切至按项目"]')
      .first();
    await projectBtn.click();
    await sleep(200);

    if (switchedCustom) {
      const resetBtns = page.locator(
        '[aria-label="Reset default"], [aria-label="恢复默认"]',
      );
      const count = await resetBtns.count();
      if (count > 0) {
        await resetBtns.last().scrollIntoViewIfNeeded();
        await resetBtns.last().click();
        await sleep(400);
        const restored = await waitForStored(
          (v) => v?.sidebarGroupingPreset === "cmd_ctrl_p_s",
        );
        check("Reset default restores cmd_ctrl_p_s cleanly", restored);
      }
    }

    check("Zero console errors during E2E", consoleErrors.length === 0, consoleErrors.join(" | "));
  } finally {
    await browser.close().catch(() => {});
    harness?.kill("SIGTERM");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
