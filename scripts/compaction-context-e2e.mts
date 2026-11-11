/**
 * Live headless E2E verification of Claude-parity ContextWindowMeter hydration & Compaction Marker
 * token enrichment in the real Paseo 0.15.4 web app against the live daemon on :6767.
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/compaction-context-e2e.mts [--port 6798] [--workspace wks_...]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6798) || 6798;
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-compaction-context-e2e");
const EXPLICIT_WS = argValue("--workspace");
const SERVER_ID_FILE = path.join(os.homedir(), ".paseo", "server-id");
const SERVER_ID = fs.existsSync(SERVER_ID_FILE) ? fs.readFileSync(SERVER_ID_FILE, "utf8").trim() : "local";

type Page = any;
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

async function shoot(page: Page, label: string): Promise<string> {
  fs.mkdirSync(SHOTS, { recursive: true });
  const shot = path.join(SHOTS, `${label}.png`);
  await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 1280, height: 850 } });
  return shot;
}

async function run(page: Page, shots: string[]): Promise<void> {
  const pageErrors: string[] = [];
  page.on("pageerror", (err: Error) => pageErrors.push(err.message));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid^="sidebar-workspace-row-"]', { timeout: 60_000 });

  let selfTest: any = null;
  for (let i = 0; i < 30; i += 1) {
    selfTest = await page.evaluate(() => {
      const api = (window as any).__paseoFinderCompactionContext;
      return api?.selfTest ? api.selfTest() : null;
    });
    if (selfTest?.ok && selfTest?.hydratedAgentsCount > 0) break;
    await sleep(300);
  }

  check(
    "plugin compaction-context hook & store selfTest ok",
    Boolean(selfTest?.ok && selfTest?.labelHook?.installed && selfTest?.storeAvailable),
    JSON.stringify(selfTest),
  );
  check(
    "live Antigravity sessions hydrated with ContextWindowMeter usage",
    Number(selfTest?.hydratedAgentsCount ?? 0) > 0,
    `hydratedAgentsCount=${selfTest?.hydratedAgentsCount}`,
  );

  // Pick explicit workspace or first hydrated Antigravity workspace in useSessionStore
  const targetWs =
    EXPLICIT_WS ||
    (await page.evaluate(() => {
      const api = (window as any).__paseoFinderCompactionContext;
      if (!api) return null;
      const req = (window as any).__r;
      if (typeof req !== "function") return null;
      let store: any = null;
      const origGet = Map.prototype.get;
      let modMap: Map<number, any> | null = null;
      try {
        Map.prototype.get = function (k: unknown) {
          if (k === 0 && !modMap && this.size > 50) modMap = this as any;
          return origGet.call(this, k);
        };
        try {
          req(0);
        } catch {}
      } finally {
        Map.prototype.get = origGet;
      }
      if (modMap) {
        for (const m of (modMap as Map<number, any>).values()) {
          if (m?.isInitialized && m.publicModule?.exports?.useSessionStore?.getState) {
            store = m.publicModule.exports.useSessionStore;
            break;
          }
        }
      }
      if (!store) return null;
      const sessions = store.getState()?.sessions ?? {};
      for (const s of Object.values(sessions) as any[]) {
        if (!(s?.agents instanceof Map)) continue;
        for (const ag of s.agents.values()) {
          if (
            ag?.provider === "antigravity" &&
            ag?.workspaceId &&
            ag?.lastUsage?.contextWindowMaxTokens > 0 &&
            ag?.lastUsage?.contextWindowUsedTokens > 0
          ) {
            return ag.workspaceId as string;
          }
        }
      }
      return null;
    }));

  check("resolved an active Antigravity workspace for visual E2E", Boolean(targetWs), String(targetWs));
  if (!targetWs) return;

  await page.goto(`http://localhost:${PORT}/h/${SERVER_ID}/workspace/${targetWs}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector('textarea[data-composer-input], [data-testid="context-window-meter"]', {
    timeout: 45_000,
  });

  // Trigger an explicit refreshNow on arrival so the active workspace meter settles immediately
  await page.evaluate(async () => {
    const api = (window as any).__paseoFinderCompactionContext;
    if (api?.refreshNow) await api.refreshNow();
  });
  await sleep(600);

  const meterInfo = await page.evaluate(() => {
    const meters = Array.from(document.querySelectorAll('[data-testid="context-window-meter"]'));
    const visibleMeters = meters
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          ariaLabel: el.getAttribute("aria-label") || "",
          visible: r.width > 0 && r.height > 0,
          width: Math.round(r.width),
          height: Math.round(r.height),
          hasSvg: Boolean(el.querySelector("svg")),
        };
      })
      .filter((m) => m.visible);
    return { total: meters.length, visibleMeters };
  });

  const activeMeter = meterInfo.visibleMeters[0];
  check(
    "composer mounts visible ContextWindowMeter SVG ring with live percentage (not 'No context data')",
    Boolean(
      activeMeter &&
        activeMeter.hasSvg &&
        /%/.test(activeMeter.ariaLabel) &&
        !/no context/i.test(activeMeter.ariaLabel),
    ),
    JSON.stringify(meterInfo),
  );

  // Verify Metro getCompactionMarkerLabel hook formats manual + preTokens directly inside the live bundle
  const liveLabelProbe = await page.evaluate(() => {
    const req = (window as any).__r;
    let modMap: Map<number, any> | null = null;
    const origGet = Map.prototype.get;
    try {
      Map.prototype.get = function (k: unknown) {
        if (k === 0 && !modMap && this.size > 50) modMap = this as any;
        return origGet.call(this, k);
      };
      try {
        req(0);
      } catch {}
    } finally {
      Map.prototype.get = origGet;
    }
    if (!modMap) return null;
    for (const m of (modMap as Map<number, any>).values()) {
      const fn = m?.isInitialized ? m.publicModule?.exports?.getCompactionMarkerLabel : null;
      if (typeof fn === "function") {
        return {
          loading: fn({ status: "loading", trigger: "manual", preTokens: 169465 }),
          manualCompleted: fn({ status: "completed", trigger: "manual", preTokens: 169465 }),
          autoCompleted: fn({ status: "completed", trigger: "auto", preTokens: 262910 }),
        };
      }
    }
    return null;
  });

  check(
    "live bundle getCompactionMarkerLabel formats 'Compacting...' and completed '169K' / '263K' labels",
    Boolean(
      liveLabelProbe &&
        /compact/i.test(liveLabelProbe.loading) &&
        liveLabelProbe.manualCompleted.includes("169K") &&
        liveLabelProbe.autoCompleted.includes("263K"),
    ),
    JSON.stringify(liveLabelProbe),
  );

  shots.push(await shoot(page, "antigravity-composer-context-meter"));

  // Hover ContextWindowMeter to open ContextWindowDetails hover card and screenshot it!
  const meterLocator = page.locator('[data-testid="context-window-meter"]:visible').first();
  if ((await meterLocator.count()) > 0) {
    await meterLocator.hover();
    await sleep(450);
    shots.push(await shoot(page, "antigravity-context-meter-hover-details"));
  }

  check("zero uncaught page errors during live E2E", pageErrors.length === 0, pageErrors.join("; "));
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
