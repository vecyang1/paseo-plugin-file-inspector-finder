/**
 * End-to-end check of Quick Label Number Shortcuts (Cmd+L -> 1..9 / Cmd+1..9)
 * in the real Paseo web app:
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/label-quick-pick-e2e.mts [--port 6798] [--shots <dir>]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6798) || 6798;
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-label-quick-pick-e2e");
const PASEO_HOME = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
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

  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 860 },
    });

    const consoleErrors: string[] = [];
    page.on("console", (msg: any) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(`http://127.0.0.1:${PORT}/new`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid^="sidebar-workspace-row-"]', {
      timeout: 20_000,
    });
    await sleep(600);

    // Select the first visible workspace row
    const firstRow = page.locator('[data-testid^="sidebar-workspace-row-"]').first();
    await firstRow.click();
    await sleep(900);

    // 0. Instrument Escape event counters on window & document to prove Cmd+L emits ZERO Escape events
    await page.evaluate(() => {
      (window as any).__paseoTestEscapeCount = 0;
      const countEsc = (ev: Event) => {
        if ((ev as KeyboardEvent).key === "Escape") {
          (window as any).__paseoTestEscapeCount += 1;
        }
      };
      window.addEventListener("keydown", countEsc, true);
      document.addEventListener("keydown", countEsc, true);
    });

    // 1. Open quick labels bar via Cmd+L DOM event (in Electron Paseo, Cmd+L reaches DOM;
    // headless Chrome for Testing reserves raw CDP Meta+l at the Cocoa omnibox layer).
    await page.evaluate(() => {
      const target = document.activeElement instanceof Element ? document.activeElement : document.body;
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "l",
          code: "KeyL",
          keyCode: 76,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await page.waitForSelector('[data-testid="paseo-finder-quick-thread-bar"]', {
      timeout: 10_000,
    });
    await sleep(250);

    const escapeCountAfterCmdL = await page.evaluate(() => ({
      escapes: (window as any).__paseoTestEscapeCount as number,
      popoverMatched:
        document.querySelector(':popover-open')?.getAttribute("data-testid") ===
        "paseo-finder-quick-thread-bar",
    }));
    check(
      "Cmd+L emits 0 Escape events and opens labels bar as :popover-open",
      escapeCountAfterCmdL.escapes === 0 && escapeCountAfterCmdL.popoverMatched,
      `escapes=${escapeCountAfterCmdL.escapes}, popoverMatched=${escapeCountAfterCmdL.popoverMatched}`,
    );

    // Close via Escape, then also verify real Playwright Meta+Shift+l keyboard chord reopens it
    await page.keyboard.press("Escape");
    await sleep(250);
    await page.keyboard.press("Meta+Shift+l");
    await page.waitForSelector('[data-testid="paseo-finder-quick-thread-bar"]', {
      timeout: 10_000,
    });
    await sleep(250);

    const openSnap = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="paseo-finder-quick-thread-bar"]');
      if (!bar) return null;
      const inputs = Array.from(bar.querySelectorAll("input")) as HTMLInputElement[];
      const labelInput = inputs[1] ?? null;
      const chips = Array.from(bar.querySelectorAll('[data-testid^="quick-label-chip-"]')).map(
        (el) => ({
          testId: el.getAttribute("data-testid") ?? "",
          index: el.getAttribute("data-label-index") ?? "",
          text: (el.textContent ?? "").trim(),
          hint: el.querySelector('[data-testid^="label-shortcut-hint-"]')?.textContent ?? null,
        }),
      );
      return {
        labelFocused: document.activeElement === labelInput,
        labelValue: labelInput?.value ?? null,
        chips,
      };
    });

    check(
      "Cmd+L opens quick labels bar with label input focused and 1..N hints",
      Boolean(openSnap && openSnap.labelFocused && openSnap.chips.length > 0 && openSnap.chips[0]?.hint === "1"),
      `chips=${openSnap?.chips.length ?? 0}, firstHint=${openSnap?.chips[0]?.hint}, focused=${openSnap?.labelFocused}`,
    );
    await page.screenshot({ path: path.join(SHOTS, "01-labels-bar-numbered.png") });

    if (openSnap && openSnap.chips.length > 0) {
      const wasFirstAssigned = openSnap.chips[0]!.text.includes("✓");
      const firstChipSelector = `[data-testid="${openSnap.chips[0]!.testId}"]`;
      const waitChipSettled = async (selector: string) => {
        await page.waitForFunction(
          (sel: string) => {
            const el = document.querySelector(sel);
            return Boolean(el) && el!.getAttribute("aria-busy") !== "true";
          },
          selector,
          { timeout: 10_000 },
        );
      };

      // 2. Press '1' to toggle first tag (and verify label input stays empty)
      await page.keyboard.press("1");
      await waitChipSettled(firstChipSelector);
      await sleep(100);
      const afterPress1 = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="paseo-finder-quick-thread-bar"]');
        if (!bar) return null;
        const labelInput = bar.querySelectorAll("input")[1] as HTMLInputElement | undefined;
        const firstChip = bar.querySelector('[data-testid^="quick-label-chip-"]');
        return {
          labelValue: labelInput?.value ?? null,
          firstText: (firstChip?.textContent ?? "").trim(),
        };
      });
      const isNowAssigned = afterPress1?.firstText.includes("✓") ?? wasFirstAssigned;
      check(
        "Pressing '1' toggles tag #1 without typing into label input",
        afterPress1?.labelValue === "" && isNowAssigned !== wasFirstAssigned,
        `was=${wasFirstAssigned}, now=${isNowAssigned}, labelValue="${afterPress1?.labelValue}"`,
      );
      await page.screenshot({ path: path.join(SHOTS, "02-after-press-1.png") });

      // Restore tag #1 with '1' again
      await page.keyboard.press("1");
      await waitChipSettled(firstChipSelector);
      await sleep(100);
      const afterRestore1 = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="paseo-finder-quick-thread-bar"]');
        const firstChip = bar?.querySelector('[data-testid^="quick-label-chip-"]');
        return (firstChip?.textContent ?? "").trim().includes("✓");
      });
      check(
        "Pressing '1' again restores tag #1 cleanly",
        afterRestore1 === wasFirstAssigned,
        `restored=${afterRestore1}`,
      );

      // 3. Test Meta+2 (Cmd+2) if at least 2 tags exist (use DOM keydown fallback if Chrome reserves Meta+2)
      if (openSnap.chips.length >= 2) {
        const secondChipSelector = `[data-testid="${openSnap.chips[1]!.testId}"]`;
        const wasSecondAssigned = openSnap.chips[1]!.text.includes("✓");
        await page.evaluate(() => {
          const target = document.activeElement instanceof Element ? document.activeElement : document.body;
          target.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "2",
              code: "Digit2",
              keyCode: 50,
              metaKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        });
        await waitChipSettled(secondChipSelector);
        await sleep(100);
        const afterCmd2 = await page.evaluate(() => {
          const bar = document.querySelector('[data-testid="paseo-finder-quick-thread-bar"]');
          const chips = bar?.querySelectorAll('[data-testid^="quick-label-chip-"]');
          return (chips?.[1]?.textContent ?? "").trim().includes("✓");
        });
        check(
          "Pressing Cmd+2 toggles tag #2",
          afterCmd2 !== wasSecondAssigned,
          `was=${wasSecondAssigned}, now=${afterCmd2}`,
        );
        // Restore tag #2
        await page.evaluate(() => {
          const target = document.activeElement instanceof Element ? document.activeElement : document.body;
          target.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "2",
              code: "Digit2",
              keyCode: 50,
              metaKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        });
        await waitChipSettled(secondChipSelector);
        await sleep(100);
      }

      // 4. Typing in labelInput switches hints to ⌘1..⌘N and allows plain digits
      await page.keyboard.type("z2");
      await sleep(150);
      const whileTyping = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="paseo-finder-quick-thread-bar"]');
        const labelInput = bar?.querySelectorAll("input")[1] as HTMLInputElement | undefined;
        const firstHint = bar?.querySelector('[data-testid^="label-shortcut-hint-"]')?.textContent;
        return { value: labelInput?.value ?? "", firstHint };
      });
      check(
        "Typing into label input switches hints to ⌘1 and allows digits in label name",
        whileTyping.value === "z2" && whileTyping.firstHint === "⌘1",
        `value="${whileTyping.value}", hint="${whileTyping.firstHint}"`,
      );

      // Clear input back to empty -> hint flips back to '1'
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      await sleep(150);
      const afterClear = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="paseo-finder-quick-thread-bar"]');
        return bar?.querySelector('[data-testid^="label-shortcut-hint-"]')?.textContent ?? null;
      });
      check("Clearing label input switches hints back to '1'", afterClear === "1", `hint="${afterClear}"`);

      // 5. Focusing titleInput switches hints to ⌘1 and allows typing numbers in title
      const titleInputLoc = page.locator('[data-testid="paseo-finder-quick-thread-bar"] input').first();
      await titleInputLoc.click();
      await sleep(150);
      const titleHint = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="paseo-finder-quick-thread-bar"]');
        return bar?.querySelector('[data-testid^="label-shortcut-hint-"]')?.textContent ?? null;
      });
      check("Focusing title input switches hints to ⌘1", titleHint === "⌘1", `hint="${titleHint}"`);
    }

    // 6. Escape closes bar
    await page.keyboard.press("Escape");
    await sleep(200);
    const barAfterEsc = await page.locator('[data-testid="paseo-finder-quick-thread-bar"]').count();
    check("Escape closes quick labels bar", barAfterEsc === 0);

    // 7. Settings screen shows the new 1-9 controls
    const settingsUrl = `http://127.0.0.1:${PORT}/settings/hosts/${serverId}/plugins/file-inspector-finder/finder-settings`;
    await page.goto(settingsUrl, { waitUntil: "domcontentloaded" });
    const settingsTarget = page
      .locator("text=/Select labels with 1–9 in labels bar|在标签栏中按 1–9 一键切换标签/")
      .first();
    await settingsTarget.waitFor({ state: "visible", timeout: 10_000 });
    const hasSettingsRows = await page.evaluate(() => {
      const txt = document.body.innerText ?? "";
      return (
        (txt.includes("Select labels with 1–9 in labels bar") || txt.includes("在标签栏中按 1–9 一键切换标签")) &&
        (txt.includes("Plain 1–9 toggles when label input is empty") || txt.includes("标签输入框为空时直接按 1–9 切换"))
      );
    });
    check("Settings screen renders 1-9 label shortcut controls", hasSettingsRows);
    await settingsTarget.scrollIntoViewIfNeeded();
    await sleep(200);
    await page.screenshot({ path: path.join(SHOTS, "03-settings-label-numbers.png") });

    check("Zero console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  } finally {
    await browser.close();
    harness?.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
