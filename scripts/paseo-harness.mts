/**
 * Shared setup for scripts that drive the real Paseo web app headlessly:
 * `build-settings-search-seed.mts` (reads every settings page) and
 * `settings-search-e2e.mts` (types into the search field and checks the jump).
 *
 * The web app comes from the read-only web harness
 * (`scripts/paseo_web_harness.mjs` from the `paseo` skill in the home directory's Antigravity skills
 * folder; `PASEO_WEB_HARNESS` overrides it): it serves the installed
 * app bundle against the live daemon on :6767, so plugins run as the daemon has loaded them.
 *
 * Overrides: PASEO_WEB_HARNESS (harness script), PLAYWRIGHT_CORE (playwright-core dir),
 * PASEO_PROBE_CHROME (Chromium executable).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

export const HARNESS_SCRIPT =
  process.env.PASEO_WEB_HARNESS ??
  path.join(HOME, ".gemini/antigravity/skills/paseo/scripts/paseo_web_harness.mjs");

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const portOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });

/** PLAYWRIGHT_CORE, else the newest playwright-core in a sibling coding project's node_modules (`base` below). */
export function findPlaywrightCore(): string | null {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
  const base = path.join(HOME, "Documents/A-coding");
  const hits: Array<{ dir: string; version: string }> = [];
  for (const dir of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const pkg = path.join(base, dir, "node_modules/playwright-core/package.json");
    if (fs.existsSync(pkg)) {
      hits.push({ dir: path.dirname(pkg), version: JSON.parse(fs.readFileSync(pkg, "utf8")).version });
    }
  }
  hits.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  return hits[0]?.dir ?? null;
}

/** Newest Chromium from the Playwright browser cache. */
export function findChrome(): string | null {
  if (process.env.PASEO_PROBE_CHROME) return process.env.PASEO_PROBE_CHROME;
  const cache = path.join(HOME, "Library/Caches/ms-playwright");
  const dirs = fs.existsSync(cache)
    ? fs.readdirSync(cache).filter((dir) => /^chromium-\d+$/.test(dir))
    : [];
  dirs.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const dir of dirs) {
    const exe = path.join(
      cache,
      dir,
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    );
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

export interface HarnessSetup {
  playwrightCore: string;
  chrome: string;
}

/** Resolves the three prerequisites, or prints which one is missing and how to point at it. */
export function resolveHarnessSetup(): HarnessSetup | null {
  const playwrightCore = findPlaywrightCore();
  const chrome = findChrome();
  const harnessOk = fs.existsSync(HARNESS_SCRIPT);
  if (playwrightCore && chrome && harnessOk) return { playwrightCore, chrome };
  console.error(
    `setup: playwright-core=${playwrightCore ?? "missing (set PLAYWRIGHT_CORE)"} chrome=${chrome ?? "missing (set PASEO_PROBE_CHROME)"} harness=${harnessOk ? "ok" : `missing (${HARNESS_SCRIPT}; set PASEO_WEB_HARNESS)`}`,
  );
  return null;
}

/** Starts the harness on `port` unless something already serves it; returns the child to kill. */
export async function ensureHarness(port: number): Promise<ChildProcess | null> {
  if (await portOpen(port)) return null;
  const harness = spawn(process.execPath, [HARNESS_SCRIPT, String(port)], { stdio: "ignore" });
  for (let i = 0; i < 40 && !(await portOpen(port)); i += 1) await sleep(250);
  return harness;
}
