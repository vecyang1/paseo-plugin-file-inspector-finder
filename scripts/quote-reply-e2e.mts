/**
 * End-to-end check of Quote Reply in the real Paseo web app, against the plugin the daemon has
 * loaded right now. Run it after `paseo plugin reload file-inspector-finder` and after every Paseo
 * update (Quote Reply reads Paseo's composer and message DOM, which is what breaks first):
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/quote-reply-e2e.mts --agent <agentId> [--server srv_x] [--port 6796] [--shots <dir>] [--no-send]
 *
 * --agent must be a disposable session: unless --no-send is given, the script sends one real
 * message ("quote reply e2e, reply OK") with two quotes folded in, then checks the sent bubble.
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
const PORT = Number(argValue("--port") || 6796) || 6796;
const AGENT = argValue("--agent");
const SERVER = argValue("--server");
const SEND = !args.includes("--no-send");
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-quote-reply-e2e");

// Marker names from client/quote-reply-web.ts.
const TOOLBAR = '[data-testid="quote-reply-toolbar"]';
const TRAY = '[data-testid="quote-reply-tray"]';
const ITEM = '[data-testid="quote-reply-item"]';
const COMPOSER = "textarea[data-composer-input]";

type Page = any;
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

/** Selects `chars` characters of the first long-enough text node inside `selector` (index from end). */
async function selectIn(page: Page, selector: string, fromEnd: number, chars: number): Promise<string> {
  return page.evaluate(
    ({ selector, fromEnd, chars }: { selector: string; fromEnd: number; chars: number }) => {
      const all = Array.from(document.querySelectorAll(selector));
      const host = all[all.length - 1 - fromEnd];
      if (!host) return "";
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? "";
        if (text.trim().length >= 4) {
          const range = document.createRange();
          const start = text.length - text.trimStart().length;
          range.setStart(node, start);
          range.setEnd(node, Math.min(text.length, start + chars));
          const sel = window.getSelection()!;
          sel.removeAllRanges();
          sel.addRange(range);
          document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return sel.toString();
        }
      }
      return "";
    },
    { selector, fromEnd, chars },
  );
}

async function run(page: Page, shots: string): Promise<void> {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="sidebar-footer"]', { timeout: 60_000 });
  let server = SERVER;
  if (!server) {
    await page.locator('[data-testid="sidebar-project-workspace-list-scroll"] [role="button"]').nth(1).click().catch(() => {});
    await sleep(1500);
    server = (page.url().match(/\/h\/(srv_[A-Za-z0-9]+)/) ?? [])[1];
  }
  check("server id resolved", server, server ?? "pass --server");
  if (!server || !AGENT) return;
  await page.goto(`http://localhost:${PORT}/h/${server}/agent/${AGENT}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(COMPOSER, { timeout: 60_000 });
  await page.waitForSelector('[data-testid="assistant-message"]', { timeout: 30_000 });
  await sleep(1500);
  console.log(`route: ${page.url().replace(/srv_[A-Za-z0-9]+/, "<server>")}`);

  // Clean slate for this session.
  await page.evaluate(() => {
    localStorage.removeItem("paseo:finder-plugin:quote-reply-trays");
  });

  // 1. Selecting assistant text shows the toolbar.
  const sel1 = await selectIn(page, '[data-testid="assistant-message"]', 0, 40);
  const bar = await page.waitForSelector(TOOLBAR, { timeout: 3000 }).then(() => true, () => false);
  check("toolbar appears on assistant selection", bar && sel1.length > 0, JSON.stringify(sel1));
  await page.screenshot({ path: path.join(shots, "1-toolbar.png") });

  // 2. Quote adds a tray item without a comment.
  await page.click('[data-testid="quote-reply-quote"]');
  await page.waitForSelector(TRAY, { timeout: 3000 }).catch(() => {});
  check("quote adds one tray item", (await page.locator(ITEM).count()) === 1);
  check("toolbar hides after quoting", (await page.locator(TOOLBAR).count()) === 0);

  // 3. Comment on a second selection focuses that quote's comment field.
  const sel2 = await selectIn(page, '[data-testid="user-message"]', 0, 30);
  await page.waitForSelector(TOOLBAR, { timeout: 3000 }).catch(() => {});
  await page.click('[data-testid="quote-reply-comment"]');
  await sleep(200);
  check("comment adds a second item", (await page.locator(ITEM).count()) === 2, JSON.stringify(sel2));
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  check("comment field focused", focused === "quote-reply-comment-input", String(focused));
  await page.keyboard.type("comment for selection 2");
  await page.keyboard.press("Enter"); // returns to the composer, must not send
  await sleep(200);
  const backInComposer = await page.evaluate(
    (c: string) => document.activeElement?.matches(c) ?? false,
    COMPOSER,
  );
  check("Enter in comment returns to composer", backInComposer);

  // 4. Selections inside the composer never show the toolbar.
  await page.locator(COMPOSER).fill("draft text");
  await page.locator(COMPOSER).selectText();
  await page.evaluate(() => document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })));
  await sleep(150);
  check("no toolbar for composer selection", (await page.locator(TOOLBAR).count()) === 0);
  await page.locator(COMPOSER).fill("");
  await page.screenshot({ path: path.join(shots, "2-tray.png") });

  const stored = await page.evaluate(() => localStorage.getItem("paseo:finder-plugin:quote-reply-trays") ?? "");
  check("tray persisted with comment", stored.includes("comment for selection 2"));

  if (!SEND) return;

  // 5. Real send: Enter folds both quotes ahead of the typed message.
  const userBefore = await page.locator('[data-testid="user-message"]').count();
  await page.locator(COMPOSER).click();
  await page.keyboard.type("quote reply e2e, reply OK");
  await page.keyboard.press("Enter");
  await page
    .waitForFunction((n: number) => document.querySelectorAll('[data-testid="user-message"]').length > n, userBefore, { timeout: 15_000 })
    .catch(() => {});
  await sleep(1500);
  const bubble = await page.evaluate(() => {
    const all = document.querySelectorAll('[data-testid="user-message"]');
    return (all[all.length - 1]?.textContent ?? "").replace(/\s+/g, " ");
  });
  const probe1 = sel1.replace(/\s+/g, " ").trim().slice(0, 20);
  const probe2 = sel2.replace(/\s+/g, " ").trim().slice(0, 15);
  check("sent bubble has quote 1", bubble.includes(probe1), probe1);
  check("sent bubble has quote 2 + comment", bubble.includes(probe2) && bubble.includes("comment for selection 2"));
  check("sent bubble has typed message", bubble.includes("quote reply e2e, reply OK"));
  check("tray cleared after send", (await page.locator(TRAY).count()) === 0);
  const receipt = await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem("paseo:finder-plugin:quote-reply-receipts") ?? "[]");
    return list[0]?.trigger ?? "";
  });
  check("send receipt recorded", receipt === "send", receipt);
  await page.screenshot({ path: path.join(shots, "3-sent.png") });
}

const setup = resolveHarnessSetup();
if (!setup) process.exit(3);
if (!AGENT) {
  console.error("pass --agent <disposable agent id>");
  process.exit(3);
}
fs.mkdirSync(SHOTS, { recursive: true });
const harness = await ensureHarness(PORT);
const { chromium } = createRequire(import.meta.url)(setup.playwrightCore);
const browser = await chromium.launch({ executablePath: setup.chrome, headless: true });
try {
  await run(await browser.newPage({ viewport: { width: 1440, height: 900 } }), SHOTS);
} catch (error) {
  check("run without exception", false, String(error).slice(0, 300));
} finally {
  await browser.close();
  harness?.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
