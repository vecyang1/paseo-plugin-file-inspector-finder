/**
 * Live end-to-end check for the Quota-Aware Message Queue Guard against the real
 * Paseo web bundle + live :6767 daemon + loaded `file-inspector-finder` plugin:
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/quota-queue-guard-e2e.mts [--port 6817] [--shots <dir>]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6817) || 6817;
const SHOTS = argValue("--shots") ?? "/tmp/paseo-quota-queue-e2e";
const ROW = '[data-testid^="sidebar-workspace-row-"]';

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

async function main() {
  const setup = resolveHarnessSetup();
  if (!setup) process.exit(3);
  fs.mkdirSync(SHOTS, { recursive: true });
  const harness = await ensureHarness(PORT);
  const require = createRequire(import.meta.url);
  const { chromium } = require(setup.playwrightCore) as { chromium: any };
  const browser = await chromium.launch({ executablePath: setup.chrome, headless: true });

  const consoleErrors: string[] = [];
  let page: any = null;
  let cleanupAgentInfo: { serverId: string; agentId: string } | null = null;

  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    page.on("console", (msg: any) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err: Error) => consoleErrors.push(err.message));

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(ROW, { timeout: 30_000 });
    await sleep(2200);

    // 1. Verify global bridge & HostRuntimeStore hook in the live Paseo web bundle
    const initStatus = await page.evaluate(() => {
      const api = (window as any).__paseoFinderQuotaQueue;
      return api ? api.status() : null;
    });
    check(
      "HostRuntimeStore.drainQueuedAgentMessage hook installed in live bundle",
      initStatus?.installed === true && initStatus?.storeAvailable === true,
      JSON.stringify({ installed: initStatus?.installed, storeAvailable: initStatus?.storeAvailable, prefs: initStatus?.prefs }),
    );

    // 2. Navigate into a real workspace row so the composer & agent route are mounted
    await page.click(ROW);
    await sleep(1400);

    // 3. Test real HostRuntimeStore + useSessionStore hold behavior on 429/503 in-page (and clean up)
    const liveHoldCheck = await page.evaluate(() => {
      const w = window as any;
      // Find useSessionStore & HostRuntimeStore from Metro registry without calling __c()
      let foundMap: Map<number, any> | null = null;
      if (w.__c instanceof Map) {
        foundMap = w.__c;
      } else if (typeof w.__r === "function") {
        const origGet = Map.prototype.get;
        try {
          Map.prototype.get = function (k: unknown) {
            if (k === 0 && !foundMap && this.size > 50) foundMap = this as Map<number, any>;
            return origGet.call(this, k);
          };
          try { w.__r(0); } catch {}
        } finally {
          Map.prototype.get = origGet;
        }
      }
      if (!foundMap) return { ok: false, reason: "no-metro-map" };

      let sessionStore: any = null;
      let getHostRuntimeStore: any = null;
      for (const rec of foundMap.values()) {
        const exp = rec?.isInitialized ? rec.publicModule?.exports : null;
        if (exp?.useSessionStore?.getState) sessionStore = exp.useSessionStore;
        if (typeof exp?.getHostRuntimeStore === "function") getHostRuntimeStore = exp.getHostRuntimeStore;
      }
      if (!sessionStore || !getHostRuntimeStore) return { ok: false, reason: "missing-stores" };

      const runtime = getHostRuntimeStore();
      const state = sessionStore.getState();
      const serverIds = Object.keys(state.sessions || {});
      const serverId = serverIds[0];
      const slice = state.sessions[serverId];
      if (!slice) return { ok: false, reason: "no-session-slice" };

      const urlMatch = /\/agents?\/([a-zA-Z0-9_-]{6,})/.exec(window.location.pathname + window.location.hash);
      const rawFirst = urlMatch?.[1] ?? Array.from(slice.agents?.keys?.() ?? [])[0];
      const firstAgentId = typeof rawFirst === "string" ? rawFirst : "";
      if (!firstAgentId) return { ok: false, reason: "no-agent" };

      const origAgent = slice.agents.get(firstAgentId);
      const origQueue = slice.queuedMessages?.get(firstAgentId) ?? [];
      const origTail = slice.agentStreamTail?.get(firstAgentId) ?? [];

      // Temporarily mark agent in 503 quota error + add 2 queued messages to real useSessionStore
      const nextAgents = new Map(slice.agents);
      nextAgents.set(firstAgentId, {
        ...origAgent,
        status: "error",
        lastError: "Error 503, Message: Token error: All accounts rate-limited. Cooldown wait 6343s.",
        turn: { phase: "idle", cancellationRequestId: null },
      });
      state.setAgents(serverId, nextAgents);
      state.setQueuedMessages(serverId, (prev: Map<string, any[]>) => {
        const m = new Map(prev);
        m.set(firstAgentId, [
          { id: "e2e_q1", text: "E2E Queued Step 1 (should stay held)", attachments: [] },
          { id: "e2e_q2", text: "E2E Queued Step 2 (should stay held)", attachments: [] },
        ]);
        return m;
      });

      // Trigger real HostRuntimeStore.drainQueuedAgentMessage -> MUST HOLD BOTH!
      runtime.drainQueuedAgentMessage(serverId, firstAgentId);
      const afterQueue = sessionStore.getState().sessions[serverId]?.queuedMessages?.get(firstAgentId) ?? [];
      const bannerEl = document.getElementById("paseo-finder-quota-queue-banner");

      return {
        ok: afterQueue.length === 2,
        serverId,
        agentId: firstAgentId,
        afterQueueLen: afterQueue.length,
        bannerText: bannerEl?.textContent ?? null,
        origAgent,
        origQueue,
        origTailCount: origTail.length,
      };
    });

    if (liveHoldCheck.serverId && liveHoldCheck.agentId) {
      cleanupAgentInfo = { serverId: liveHoldCheck.serverId, agentId: liveHoldCheck.agentId };
    }
    await sleep(350);
    await page.screenshot({ path: path.join(SHOTS, "01-quota-queue-held-in-composer.png") });
    check(
      "drainQueuedAgentMessage holds both queued items on 503 quota error and shows native hold banner",
      liveHoldCheck.ok === true && liveHoldCheck.afterQueueLen === 2 && Boolean(liveHoldCheck.bannerText),
      `len=${liveHoldCheck.afterQueueLen} banner=${JSON.stringify(liveHoldCheck.bannerText)}`,
    );

    // Restore original agent & clear synthetic queue via page + server RPC
    await page.evaluate(async (info: any) => {
      const w = window as any;
      if (info && w.__c instanceof Map) {
        for (const rec of w.__c.values()) {
          const exp = rec?.isInitialized ? rec.publicModule?.exports : null;
          if (exp?.useSessionStore?.getState) {
            const st = exp.useSessionStore.getState();
            const sl = st.sessions[info.serverId];
            if (sl) {
              if (info.origAgent) {
                const next = new Map(sl.agents);
                next.set(info.agentId, info.origAgent);
                st.setAgents(info.serverId, next);
              }
              st.setQueuedMessages(info.serverId, (prev: Map<string, any[]>) => {
                const m = new Map(prev);
                m.delete(info.agentId);
                return m;
              });
            }
          }
        }
      }
    }, liveHoldCheck);

    // 4. Open Settings -> Plugins -> File Inspector & Finder and verify 能读/能试/能调 controls
    const settingsServerId = liveHoldCheck.serverId || "local";
    await page.goto(`http://127.0.0.1:${PORT}/settings/hosts/${settingsServerId}/plugins/file-inspector-finder/finder-settings`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="settings-sidebar"]', { timeout: 20_000 });
    await sleep(1800);
    const inspectBtn = page.locator('button:has-text("Inspect Quota Queue"), [role="button"]:has-text("Inspect Quota Queue"), [role="button"]:has-text("检查排队与配额")').first();
    await inspectBtn.scrollIntoViewIfNeeded();
    await inspectBtn.click();
    await sleep(900);
    const settingsUi = await page.evaluate(() => {
      const txt = document.body.innerText || "";
      return {
        hasHoldToggle:
          txt.includes("Hold queued messages on 429 quota wait") ||
          txt.includes("429 配额冷却期间暂缓排队消息并逐条恢复"),
        hasInspectBtn:
          txt.includes("Inspect Quota Queue") || txt.includes("检查排队与配额"),
        hasDrainBtn:
          txt.includes("Check & Drain 1") || txt.includes("探测并发送 1 条"),
        hasLedgerSummary:
          txt.includes("Held agents:") || txt.includes("暂缓会话:"),
      };
    });
    await page.screenshot({ path: path.join(SHOTS, "02-settings-quota-queue-reconciler.png") });
    check(
      "Settings plugin screen renders Quota Queue Guard controls (Read/Test/Tune)",
      settingsUi.hasHoldToggle && settingsUi.hasInspectBtn && settingsUi.hasDrainBtn && settingsUi.hasLedgerSummary,
      JSON.stringify(settingsUi),
    );
    check("zero console/page errors during E2E", consoleErrors.length === 0, consoleErrors.slice(0, 3).join("; "));
  } finally {
    if (cleanupAgentInfo) {
      // Clear synthetic e2e entry from persisted server ledger if created
      const ledgerPath = path.join(os.homedir(), ".paseo/vec-patches/quota-queued-messages.json");
      try {
        if (fs.existsSync(ledgerPath)) {
          const d = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
          if (d?.agents?.[cleanupAgentInfo.agentId]) {
            delete d.agents[cleanupAgentInfo.agentId];
            fs.writeFileSync(ledgerPath, JSON.stringify(d, null, 2) + "\n", "utf8");
          }
        }
      } catch {
        // Ignore cleanup failure
      }
    }
    await browser.close().catch(() => {});
    if (harness) harness.kill();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nSummary: ${results.length - failed}/${results.length} passed`);
    if (failed > 0) process.exit(1);
  }
}

void main();
