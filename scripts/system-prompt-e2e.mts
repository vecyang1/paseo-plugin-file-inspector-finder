/**
 * End-to-end verification of System Starter Prompt & Instructions Inspector in the real Paseo web app,
 * against the plugin loaded live in the daemon on :6767.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/system-prompt-e2e.mts [--port 6798] [--shots <dir>]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6798) || 6798;
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-system-prompt-e2e");

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

async function run(page: any): Promise<void> {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  const wsSelector = '[data-testid^="sidebar-workspace-row-"]';
  const hasWs = await page.waitForSelector(wsSelector, { timeout: 45_000 }).then(() => true, () => false);
  check("sidebar workspace rows loaded", hasWs);
  if (!hasWs) return;

  await page.locator(wsSelector).first().click();
  await sleep(800);

  const btnSelector = '[data-testid="paseo-finder-lineage-system-prompt-btn"]';
  const hasBtn = await page.waitForSelector(btnSelector, { timeout: 25_000 }).then(() => true, () => false);
  check("System Prompt button mounted in Session Lineage Bar", hasBtn);
  if (!hasBtn) return;

  await page.locator(btnSelector).first().click();
  const modalSelector = '[data-testid="paseo-finder-system-prompt-modal"]';
  const hasModal = await page.waitForSelector(modalSelector, { timeout: 10_000 }).then(() => true, () => false);
  check("System Prompt inspector modal opened", hasModal);
  if (!hasModal) return;

  // Wait for RPC resolution (loading text replaced by <pre>)
  const hasPre = await page
    .waitForSelector(`${modalSelector} pre`, { timeout: 10_000 })
    .then(() => true, () => false);
  check("System Prompt <pre> content rendered from live daemon RPC", hasPre);

  if (hasPre) {
    const modalText = await page.locator(modalSelector).innerText();
    check("modal contains config.json metadata", modalText.includes("config.json") && modalText.includes("chars"));
    check("modal renders real system starter prompt", modalText.includes("system starter prompt") || modalText.length > 100);
    await page.screenshot({ path: path.join(SHOTS, "system-prompt-modal.png") });
  }

  const closeBtn = page.locator('[data-testid="paseo-finder-system-prompt-close"]');
  await closeBtn.click();
  await sleep(300);
  const modalGone = await page.locator(modalSelector).count().then((c: number) => c === 0);
  check("System Prompt modal closed cleanly", modalGone);

  // Navigate to Settings -> Plugins -> File Inspector & Finder
  const match = page.url().match(/\/h\/(srv_[A-Za-z0-9]+)/);
  let serverId = match ? match[1] : "";
  if (!serverId) {
    await page.goto(`http://localhost:${PORT}/settings/general`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="settings-host-section-host"]', { timeout: 45_000 });
    await page.click('[data-testid="settings-host-section-host"]');
    serverId = String(page.url()).split("/settings/hosts/")[1]?.split("/")[0] ?? "";
  }

  await page.goto(
    `http://localhost:${PORT}/settings/hosts/${serverId}/plugins/file-inspector-finder/finder-settings`,
    { waitUntil: "domcontentloaded" },
  );
  const settingsRendered = await page
    .waitForSelector('[data-testid="system-prompt-settings-status"]', { timeout: 30_000 })
    .then(() => true, () => false);
  check("Settings section renders System Starter Prompt & Instructions", settingsRendered);

  if (settingsRendered) {
    await page.locator('[data-testid="system-prompt-settings-status"]').scrollIntoViewIfNeeded();
    // Test interactive dry-run sanitization button
    await page.click('[data-testid="system-prompt-test-clean-button"]');
    await sleep(800);
    const resultText = await page
      .locator('[data-testid="system-prompt-test-clean-result"]')
      .innerText()
      .catch(() => "");
    check(
      "Sanitization dry-run returned STRIPPED result",
      resultText.includes("STRIPPED"),
      resultText,
    );
  }
  await page.screenshot({ path: path.join(SHOTS, "system-prompt-settings.png") });
}

async function main(): Promise<number> {
  const setup = resolveHarnessSetup();
  if (!setup) {
    console.error("Playwright or Chrome setup missing.");
    return 3;
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  const harness = await ensureHarness(PORT);
  const { chromium } = createRequire(import.meta.url)(setup.playwrightCore);
  const browser = await chromium.launch({ executablePath: setup.chrome, headless: true });
  try {
    await run(await browser.newPage({ viewport: { width: 1440, height: 900 } }));
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
