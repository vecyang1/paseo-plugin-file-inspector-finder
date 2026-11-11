/**
 * Live end-to-end verification for Paseo Multi-Document Preview (`doc-inspector`):
 *   - Opens a PDF file tab in Paseo's side pane (verifying zero "Binary preview unavailable")
 *   - Exercises Zoom In + real Pointer-Capture Grab-to-Pan dragging (verifying scrollTop/panDragCount)
 *   - Exercises Multi-Doc Side-by-Side Compare with a second document (e.g. DOCX) + Sync Scroll
 *   - Exercises Settings -> Plugins -> File Inspector & Finder -> Multi-document preview diagnostics
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/doc-preview-e2e.mts --workspace <wks_id> --doc1 <rel_or_abs_pdf> [--doc2 <rel_or_abs_docx>] [--shots <dir>]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

const PORT = Number(argValue("--port") || 6798) || 6798;
const WORKSPACE = argValue("--workspace");
const DOC1 = argValue("--doc1");
const DOC2 = argValue("--doc2");
const SERVER = argValue("--server");
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-doc-preview-e2e");

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

async function main() {
  const setup = resolveHarnessSetup();
  if (!setup) process.exit(3);
  if (!WORKSPACE || !DOC1) {
    console.error("Usage: scripts/doc-preview-e2e.mts --workspace <wks_id> --doc1 <pdf_path> [--doc2 <docx_path>]");
    process.exit(3);
  }

  fs.mkdirSync(SHOTS, { recursive: true });
  const harnessChild = await ensureHarness(PORT);
  const req = createRequire(path.join(setup.playwrightCore, "package.json"));
  const { chromium } = req("playwright-core") as any;

  let browser: any = null;
  try {
    browser = await chromium.launch({
      executablePath: setup.chrome,
      headless: true,
    });
    const context = await browser.newContext({
      viewport: { width: 1560, height: 960 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (err: Error) => pageErrors.push(err.message));

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="sidebar-footer"]', { timeout: 45_000 });

    let serverId = SERVER;
    if (!serverId) {
      serverId = await page.evaluate(() => {
        try {
          const raw = localStorage.getItem("@paseo:daemon-registry");
          if (raw) {
            const parsed = JSON.parse(raw);
            const entries = parsed?.daemons || parsed?.hosts || parsed?.entries || [];
            for (const item of Array.isArray(entries) ? entries : Object.values(entries)) {
              const sid = (item as any)?.serverId || (item as any)?.id;
              if (typeof sid === "string" && sid.startsWith("srv_")) return sid;
            }
          }
        } catch {
          // ignore
        }
        return null;
      });
    }
    if (!serverId) {
      const serverIdFile = path.join(os.homedir(), ".paseo", "server-id");
      if (fs.existsSync(serverIdFile)) {
        serverId = fs.readFileSync(serverIdFile, "utf8").trim();
      }
    }
    check("resolved Paseo serverId", Boolean(serverId), serverId ?? "missing");
    if (!serverId) process.exit(1);

    await page.goto(`http://localhost:${PORT}/h/${serverId}/workspace/${WORKSPACE}`, {
      waitUntil: "domcontentloaded",
    });
    await sleep(3000);

    // Ensure doc-inspector association is active and open DOC1 in side preview pane
    const openedCount = await page.evaluate(
      ({ wsId, docPath }: { wsId: string; docPath: string }) => {
        const api = (globalThis as any).__paseoFinderDocPreview;
        if (!api) return -1;
        api.setPrefs({ autoAssociateDocumentPanels: true, defaultInteractionMode: "pan", defaultPdfMode: "canvas" });
        return api.openFileTabs(wsId, [docPath]);
      },
      { wsId: WORKSPACE, docPath: DOC1 },
    );
    check("opened primary document tab via runtime store", openedCount >= 1, `opened=${openedCount}`);

    await page.waitForSelector('[data-testid="paseo-doc-inspector-root"]', { timeout: 25_000 });
    await page.waitForFunction(
      () => {
        const root = document.querySelector('[data-testid="paseo-doc-inspector-root"]');
        if (!root) return false;
        const img = root.querySelector("img") as HTMLImageElement | null;
        return Boolean(img && img.complete && img.naturalWidth > 300);
      },
      undefined,
      { timeout: 25_000 },
    );

    const hasBinaryUnavailable = await page.evaluate(() =>
      document.body.innerText.includes("Binary preview unavailable"),
    );
    check("eliminated Binary preview unavailable placeholder", !hasBinaryUnavailable);

    // Zoom in twice (100% -> 125% -> 150%) so 2D scroll & grab-pan has generous travel
    await page.click('[data-testid="paseo-doc-zoom-in"]');
    await sleep(150);
    await page.click('[data-testid="paseo-doc-zoom-in"]');
    await sleep(350);

    const scrollSelector = '[data-testid^="paseo-doc-scroll-"][data-testid$="-primary"]';
    const box = await page.locator(scrollSelector).first().boundingBox();
    check("primary document scroll viewport measured", Boolean(box && box.width > 250 && box.height > 250));

    if (box) {
      const startX = Math.round(box.x + box.width * 0.5);
      const startY = Math.round(box.y + box.height * 0.6);
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 40, startY - 180, { steps: 10 });
      await page.mouse.up();
      await sleep(250);
    }

    const afterDrag = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      const status = (globalThis as any).__paseoFinderDocPreview?.status?.();
      return {
        scrollTop: el?.scrollTop ?? 0,
        scrollHeight: el?.scrollHeight ?? 0,
        clientHeight: el?.clientHeight ?? 0,
        panDragCount: status?.panDragCount ?? 0,
      };
    }, scrollSelector);
    check(
      "pointer-capture grab-to-pan scrolled PDF canvas",
      afterDrag.panDragCount >= 1 && afterDrag.scrollTop > 20,
      `panDragCount=${afterDrag.panDragCount}, scrollTop=${afterDrag.scrollTop}/${afterDrag.scrollHeight}`,
    );

    await page.screenshot({ path: path.join(SHOTS, "01-single-pdf-zoomed-panned.png") });

    // Exercise Multi-Doc Side-by-Side Compare (PDF + DOCX)
    if (DOC2) {
      await page.click('[data-testid="paseo-doc-zoom-reset"]');
      await sleep(200);
      await page.evaluate(
        ({ wsId, doc2 }: { wsId: string; doc2: string }) => {
          window.dispatchEvent(
            new CustomEvent("paseo:finder-doc-compare-drop", {
              detail: { workspaceId: wsId, paths: [doc2] },
            }),
          );
        },
        { wsId: WORKSPACE, doc2: DOC2 },
      );

      await page.waitForSelector('[data-testid*="-cmp-0"]', { timeout: 20_000 });
      await sleep(2200);

      const compareState = await page.evaluate(() => {
        const slots = Array.from(document.querySelectorAll('[data-testid^="paseo-doc-slot-"]')) as HTMLElement[];
        const rects = slots.map((s) => {
          const r = s.getBoundingClientRect();
          return { left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) };
        });
        const htmlHost = document.querySelector('[data-testid^="paseo-doc-html-"]') as HTMLElement | null;
        const shadowTextLen = (htmlHost?.shadowRoot?.textContent ?? "").trim().length;
        return { slotCount: slots.length, rects, shadowTextLen };
      });

      check(
        "multi-doc split compare rendered PDF + DOCX side-by-side",
        compareState.slotCount === 2 &&
          compareState.rects[0].width > 180 &&
          compareState.rects[1].width > 180 &&
          compareState.rects[1].left > compareState.rects[0].left &&
          compareState.shadowTextLen > 100,
        JSON.stringify(compareState),
      );

      // Test proportional synchronized scroll across the two documents
      const syncCheck = await page.evaluate((sel: string) => {
        const primaryEl = document.querySelector(sel) as HTMLElement | null;
        const cmpEl = document.querySelector('[data-testid^="paseo-doc-scroll-"][data-testid*="-cmp-0"]') as HTMLElement | null;
        if (!primaryEl || !cmpEl) return { ok: false, pTop: 0, cTop: 0 };
        primaryEl.scrollTop = Math.min(240, Math.max(80, Math.floor((primaryEl.scrollHeight - primaryEl.clientHeight) * 0.5)));
        primaryEl.dispatchEvent(new Event("scroll"));
        return {
          ok: cmpEl.scrollTop > 0 || cmpEl.scrollHeight <= cmpEl.clientHeight,
          pTop: primaryEl.scrollTop,
          cTop: cmpEl.scrollTop,
          cMax: cmpEl.scrollHeight - cmpEl.clientHeight,
        };
      }, scrollSelector);
      check("proportional sync-scroll linked compared documents", syncCheck.ok, JSON.stringify(syncCheck));

      await sleep(300);
      await page.screenshot({ path: path.join(SHOTS, "02-multi-doc-split-pdf-and-docx.png") });
    }

    // Verify Settings UI Observability (Read / Test / Tune)
    await page.goto(
      `http://localhost:${PORT}/settings/hosts/${serverId}/plugins/file-inspector-finder/finder-settings`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForSelector('[data-testid="paseo-doc-preview-diagnostics"]', { timeout: 25_000 });
    await sleep(1200);
    await page.locator('[data-testid="paseo-doc-preview-diagnostics"]').scrollIntoViewIfNeeded();
    await page.click('[data-testid="paseo-doc-preview-probe-btn"]');
    await sleep(600);

    const diagText = await page
      .locator('[data-testid="paseo-doc-preview-diagnostics"]')
      .innerText();
    check(
      "settings diagnostics reconciler reports active engines & self-test pass",
      diagText.includes("pymupdf: ready") && diagText.includes("4/4"),
      diagText.replace(/\s+/g, " ").slice(0, 180),
    );

    await page.screenshot({ path: path.join(SHOTS, "03-settings-doc-preview-observability.png") });
    check("zero uncaught page errors", pageErrors.length === 0, pageErrors.join("; "));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (harnessChild) harnessChild.kill("SIGTERM");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed · screenshots: ${SHOTS}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
