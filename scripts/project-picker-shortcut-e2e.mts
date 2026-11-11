/**
 * End-to-end check of Project Picker Shortcut in the real Paseo web app, against the plugin the daemon
 * has loaded right now:
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/project-picker-shortcut-e2e.mts [--port 6798] [--shots <dir>]
 *
 * Checks:
 * 1. Navigate to New Workspace (/new), verify trigger & aria-keyshortcuts="Alt+P".
 * 2. Focus composer textarea, type prompt text, press Alt+P:
 *    - Combobox opens, Search projects input focused, no 'π' leaked into composer.
 * 3. Select a different project from the open Combobox:
 *    - Combobox closes, trigger label changes, composer prompt intact, focus returns to composer.
 * 4. Close picker via Escape & toggle re-press:
 *    - Combobox closes, focus returns cleanly to composer textarea.
 * 5. Navigate to real plugin Settings screen (/settings/hosts/<serverId>/plugins/file-inspector-finder/finder-settings):
 *    - Verify Settings controls & 'Choose the project shortcut' diagnostic panel.
 *    - Click 'Run self-test' and verify [OK] receipt renders.
 *    - Switch preset to Custom, click 'Record keys', press Control+Shift+Y, verify saved to finder-settings.json.
 *    - Return to /new, verify aria-keyshortcuts updated & Control+Shift+Y opens picker while typing.
 *    - Return to Settings, click 'Reset default' to restore Alt+P cleanly.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6798) || 6798;
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-project-picker-shortcut-e2e");
const PASEO_HOME = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
const SETTINGS_FILE = path.join(PASEO_HOME, "plugin-settings/file-inspector-finder/finder-settings.json");

const TRIGGER = '[data-testid="new-workspace-project-picker-trigger"]';
const OPTION_SELECTOR = '[data-testid^="new-workspace-project-picker-option-"]';
const COMBOBOX = '[data-testid="combobox-desktop-container"]';
const SEARCH_INPUT = 'input[placeholder="Search projects"]';
const COMPOSER = 'textarea[data-composer-input]';

type Page = any;
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

function readStoredSettings(): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return raw?.values && typeof raw.values === "object" ? (raw.values as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function waitForStored(predicate: (v: Record<string, unknown> | null) => boolean): Promise<boolean> {
  for (let i = 0; i < 40; i += 1) {
    if (predicate(readStoredSettings())) return true;
    await sleep(150);
  }
  return false;
}

async function findByTexts(page: Page, texts: string[]) {
  for (const label of texts) {
    const loc = page.locator(`[aria-label="${label}"]`).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  for (const label of texts) {
    const loc = page.getByText(label, { exact: true }).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

async function openPresetSelectorToCustom(page: Page): Promise<boolean> {
  // Paseo SettingsSelect renders a row whose label is "Project picker shortcut combination" / "快捷键组合"
  // with a clickable control (<select> or Combobox trigger) in the same container.
  const opened = await page.evaluate(() => {
    const labels = ["Project picker shortcut combination", "快捷键组合"];
    const labelEl = Array.from(document.querySelectorAll("*")).find(
      (el) => el.children.length === 0 && labels.includes((el.textContent ?? "").trim()),
    );
    if (!labelEl) return "no-label";
    let row: Element | null = labelEl;
    for (let d = 0; d < 6 && row; d += 1, row = row.parentElement) {
      const sel = row.querySelector("select") as HTMLSelectElement | null;
      if (sel) {
        sel.value = "custom";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return "native-select";
      }
      const btn = row.querySelector('[role="button"], button') as HTMLElement | null;
      if (btn) {
        btn.scrollIntoView({ block: "center" });
        btn.click();
        return "clicked-trigger";
      }
    }
    return "no-control";
  });
  if (opened === "native-select") return true;
  if (opened !== "clicked-trigger") return false;
  await sleep(300);
  const opt = await findByTexts(page, ["Custom shortcut", "自定义快捷键"]);
  if (!opt) return false;
  await opt.click();
  await sleep(300);
  return true;
}

async function main() {
  const setup = resolveHarnessSetup();
  if (!setup) process.exit(3);
  const serverId = argValue("--server") ?? fs.readFileSync(path.join(PASEO_HOME, "server-id"), "utf8").trim();

  fs.mkdirSync(SHOTS, { recursive: true });
  const harness = await ensureHarness(PORT);

  const require = createRequire(import.meta.url);
  const { chromium } = require(setup.playwrightCore) as { chromium: any };
  const browser = await chromium.launch({
    executablePath: setup.chrome,
    headless: true,
  });

  let switchedCustom = false;
  let page: Page = null;

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
    await page.waitForSelector(TRIGGER, { timeout: 20_000 });
    await page.waitForSelector(COMPOSER, { timeout: 20_000 });
    await sleep(450);

    // 1. Initial trigger state
    const triggerInfo = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      return el
        ? {
            text: (el.textContent || "").trim(),
            ariaShortcuts: el.getAttribute("aria-keyshortcuts"),
          }
        : null;
    }, TRIGGER);

    check("1. Project picker trigger is visible on /new", Boolean(triggerInfo), `current="${triggerInfo?.text}"`);
    check(
      "2. aria-keyshortcuts attribute is annotated on trigger",
      Boolean(triggerInfo?.ariaShortcuts),
      `aria-keyshortcuts="${triggerInfo?.ariaShortcuts}"`,
    );

    // 2. Focus composer textarea and type sample text
    const composer = page.locator(COMPOSER).first();
    await composer.focus();
    await composer.fill("Draft prompt in composer");
    await sleep(200);

    const composerTextBefore = await composer.inputValue();
    check("3. Composer textarea focused with initial prompt", composerTextBefore === "Draft prompt in composer");

    // 3. Press Alt+P while typing in composer
    console.log("Pressing Alt+p while focused in composer...");
    await page.keyboard.press("Alt+p");
    await page.waitForSelector(COMBOBOX, { timeout: 6_000 });
    await sleep(300);

    const afterShortcut = await page.evaluate(
      ({ comboboxSel, searchSel, composerSel }: { comboboxSel: string; searchSel: string; composerSel: string }) => {
        const combobox = document.querySelector(comboboxSel);
        const search = document.querySelector(searchSel);
        const comp = document.querySelector(composerSel) as HTMLTextAreaElement | null;
        return {
          comboboxVisible: Boolean(combobox),
          searchPresent: Boolean(search),
          searchIsActive: document.activeElement === search,
          composerValue: comp?.value ?? "",
        };
      },
      { comboboxSel: COMBOBOX, searchSel: SEARCH_INPUT, composerSel: COMPOSER },
    );

    check("4. Combobox desktop container opened via Alt+P", afterShortcut.comboboxVisible);
    check("5. Search projects input is focused", afterShortcut.searchIsActive);
    check(
      "6. No Option-key character (π) leaked into composer text",
      afterShortcut.composerValue === "Draft prompt in composer",
      `got="${afterShortcut.composerValue}"`,
    );

    const shot1 = path.join(SHOTS, "01-project-picker-open.png");
    await page.screenshot({ path: shot1 });

    // 4. Select a DIFFERENT project option inside Combobox and confirm composer focus restores
    const initialProjectName = triggerInfo?.text ?? "";
    const otherOptionCount = await page.locator(OPTION_SELECTOR).count();
    let pickedLabel = "";
    if (otherOptionCount > 1) {
      for (let i = 0; i < Math.min(otherOptionCount, 12); i += 1) {
        const opt = page.locator(OPTION_SELECTOR).nth(i);
        const rawText = ((await opt.innerText().catch(() => "")) || "").trim();
        const lines = rawText
          .split(/\r?\n/)
          .map((s: string) => s.trim())
          .filter(Boolean);
        // Option text contains monogram + project name + path; compare lines against current trigger label.
        const projectNameLine = lines.length >= 2 ? lines[1]! : lines[0] ?? "";
        const isCurrent =
          !projectNameLine ||
          initialProjectName === projectNameLine ||
          initialProjectName.endsWith(projectNameLine);
        if (!isCurrent) {
          pickedLabel = projectNameLine;
          await opt.click();
          break;
        }
      }
    }
    await sleep(450);

    const afterPick = await page.evaluate(
      ({ triggerSel, comboboxSel, composerSel }: { triggerSel: string; comboboxSel: string; composerSel: string }) => {
        const trigger = document.querySelector(triggerSel);
        const combobox = document.querySelector(comboboxSel);
        const comp = document.querySelector(composerSel) as HTMLTextAreaElement | null;
        return {
          comboboxClosed: !combobox,
          newProject: (trigger?.textContent ?? "").trim(),
          composerValue: comp?.value ?? "",
          composerIsActive: document.activeElement === comp,
        };
      },
      { triggerSel: TRIGGER, comboboxSel: COMBOBOX, composerSel: COMPOSER },
    );
    check(
      "7. Selecting project option updates project & returns focus to composer",
      pickedLabel
        ? afterPick.comboboxClosed &&
            afterPick.newProject !== initialProjectName &&
            afterPick.composerValue === "Draft prompt in composer" &&
            afterPick.composerIsActive
        : afterPick.comboboxClosed,
      `picked="${pickedLabel}" -> trigger="${afterPick.newProject}" focused=${afterPick.composerIsActive}`,
    );

    // 5. Press Alt+P then Escape to close combobox and verify focus returns to composer
    await page.keyboard.press("Alt+p");
    await page.waitForSelector(COMBOBOX, { timeout: 6_000 });
    await sleep(250);
    await page.keyboard.press("Escape");
    await sleep(400);

    const afterClose = await page.evaluate(
      ({ comboboxSel, composerSel }: { comboboxSel: string; composerSel: string }) => {
        const combobox = document.querySelector(comboboxSel);
        const comp = document.querySelector(composerSel);
        return {
          comboboxClosed: !combobox,
          composerIsActive: document.activeElement === comp,
        };
      },
      { comboboxSel: COMBOBOX, composerSel: COMPOSER },
    );

    check("8. Picker closed via Escape and focus returned to composer", afterClose.comboboxClosed && afterClose.composerIsActive);

    // 6. Re-open via Alt+P and close via re-pressing Alt+P
    await page.keyboard.press("Alt+p");
    await page.waitForSelector(COMBOBOX, { timeout: 6_000 });
    await sleep(200);
    await page.keyboard.press("Alt+p");
    await sleep(400);

    const afterToggle = await page.evaluate(
      ({ comboboxSel, composerSel }: { comboboxSel: string; composerSel: string }) => {
        const combobox = document.querySelector(comboboxSel);
        const comp = document.querySelector(composerSel);
        return {
          comboboxClosed: !combobox,
          composerIsActive: document.activeElement === comp,
        };
      },
      { comboboxSel: COMBOBOX, composerSel: COMPOSER },
    );

    check("9. Picker closed via toggle re-press and focus returned to composer", afterToggle.comboboxClosed && afterToggle.composerIsActive);

    // 7. Navigate to REAL plugin Settings page
    const settingsUrl = `http://127.0.0.1:${PORT}/settings/hosts/${serverId}/plugins/file-inspector-finder/finder-settings`;
    console.log(`Navigating to real Settings page: ${settingsUrl}`);
    await page.goto(settingsUrl, { waitUntil: "domcontentloaded" });
    const diagHeading = await page
      .waitForFunction(
        (titles: string[]) =>
          Array.from(document.querySelectorAll("*")).some(
            (el) => el.children.length === 0 && titles.includes((el.textContent ?? "").trim()),
          ),
        ["Choose the project shortcut", "选择项目快捷键"],
        { timeout: 25_000 },
      )
      .then(() => true, () => false);
    check("10. Plugin Settings section 'Choose the project shortcut' rendered", diagHeading);

    if (diagHeading) {
      await sleep(500);
      const selfTestBtn = await findByTexts(page, ["Run self-test", "运行自检"]);
      if (selfTestBtn) {
        await selfTestBtn.scrollIntoViewIfNeeded();
        await selfTestBtn.click();
        await sleep(300);
      }
      const diagAfterSelfTest = await page.evaluate(() => document.body.innerText);
      const hasOkReceipt = diagAfterSelfTest.includes("[OK]") && diagAfterSelfTest.includes("[self-test]");
      check("11. Clicking Run self-test renders [OK] receipt", hasOkReceipt);

      await page.screenshot({ path: path.join(SHOTS, "02-settings-screen.png") });

      // 8. Test configurability: switch to Custom -> Record keys -> Ctrl+Shift+Y -> verify in /new -> Reset default
      const customSelected = await openPresetSelectorToCustom(page);
      check("12. Switched preset selector to Custom shortcut", customSelected);
      if (customSelected) {
        const recordBtn = await findByTexts(page, ["Record keys", "录制按键"]);
        if (recordBtn) {
          await recordBtn.scrollIntoViewIfNeeded();
          await recordBtn.click();
          await sleep(150);
          await page.keyboard.press("Control+Shift+Y");
          await sleep(450);
          switchedCustom = true;
          const storedCustom = await waitForStored(
            (v) => v?.projectPickerShortcutPreset === "custom" && v?.projectPickerCustomShortcut === "Ctrl+Shift+Y",
          );
          check(
            "13. Live Record keys captured Ctrl+Shift+Y and saved to finder-settings.json",
            storedCustom,
            JSON.stringify({
              preset: readStoredSettings()?.projectPickerShortcutPreset,
              custom: readStoredSettings()?.projectPickerCustomShortcut,
            }),
          );
          await page.screenshot({ path: path.join(SHOTS, "03-settings-custom-recorded.png") });

          // Verify configured shortcut works live on /new
          await page.goto(`http://127.0.0.1:${PORT}/new`, { waitUntil: "domcontentloaded" });
          await page.waitForSelector(TRIGGER, { timeout: 20_000 });
          await page.waitForSelector(COMPOSER, { timeout: 20_000 });
          await sleep(400);

          const customAria = await page.evaluate((sel: string) => document.querySelector(sel)?.getAttribute("aria-keyshortcuts"), TRIGGER);
          await page.locator(COMPOSER).first().focus();
          await page.keyboard.press("Control+Shift+Y");
          const openedWithCustom = await page
            .waitForSelector(COMBOBOX, { timeout: 4_000 })
            .then(() => true, () => false);
          check(
            "14. Newly configured Ctrl+Shift+Y shortcut opens project picker on /new",
            customAria === "Control+Shift+Y" && openedWithCustom,
            `aria="${customAria}" opened=${openedWithCustom}`,
          );
          if (openedWithCustom) {
            await page.keyboard.press("Escape");
            await sleep(250);
          }

          // Restore default via Settings Reset default button
          await page.goto(settingsUrl, { waitUntil: "domcontentloaded" });
          await sleep(1200);
          const resetBtn = await findByTexts(page, ["Reset default", "恢复默认"]);
          if (resetBtn) {
            await resetBtn.scrollIntoViewIfNeeded();
            await resetBtn.click();
            switchedCustom = false;
          }
          const restored = await waitForStored((v) => v?.projectPickerShortcutPreset === "alt_p");
          check("15. Reset default restored alt_p preset cleanly", restored);
        }
      }
    }

    check("16. Zero fatal console errors during execution", consoleErrors.length === 0, `${consoleErrors.length} errors`);
  } finally {
    // Defensive reset if interrupted mid-test while on custom shortcut
    if (switchedCustom && page) {
      try {
        const settingsUrl = `http://127.0.0.1:${PORT}/settings/hosts/${serverId}/plugins/file-inspector-finder/finder-settings`;
        await page.goto(settingsUrl, { waitUntil: "domcontentloaded" });
        await sleep(800);
        const resetBtn = await findByTexts(page, ["Reset default", "恢复默认"]);
        if (resetBtn) {
          await resetBtn.click();
          await waitForStored((v) => v?.projectPickerShortcutPreset === "alt_p");
        }
      } catch {
        // Best-effort cleanup
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
