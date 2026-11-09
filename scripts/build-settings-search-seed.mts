/**
 * Builds `shared/settings-search-seed.ts`: every settings page Paseo renders, read off the real
 * screen, so Settings Search works on a page you have never opened.
 *
 *   node --experimental-strip-types --import ./test/register-ts.mjs \
 *     scripts/build-settings-search-seed.mts [--port 6797] [--check]
 *
 * How: serves the installed app bundle through the read-only web harness
 * (`scripts/paseo_web_harness.mjs` from the `paseo` skill, located by `paseo-harness.mts`; live daemon, no app
 * changes), visits each settings URL in headless Chromium and runs the same
 * `harvestSettingsDetailPane` the plugin runs in the app.
 *
 * Privacy: the harness shows this machine's real data (host name, projects, paths). A string is
 * kept only if it appears literally in the app bundle or in this plugin's source, so only UI copy
 * reaches the committed seed. The run prints counts, never dropped text.
 *
 * Not crawled: `host:usage` (opening it fetches provider usage, which can spend the shared Claude
 * usage quota). Pages the web build cannot render (the desktop Daemon card) are filled in from the
 * app itself the first time they are opened.
 *
 * `--check` compares a fresh crawl with the committed seed and exits 1 when they differ.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  harvestSettingsDetailPane,
  type HarvestedSettingsPage,
} from "../client/settings-search-harvest.ts";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";
import {
  cleanSettingsEntries,
  normalizeSettingsText,
  type SettingsSearchPage,
  type SettingsSearchSeed,
} from "../shared/settings-search.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APP_DIST = "/Applications/Paseo.app/Contents/Resources/app-dist";
const SEED_PATH = path.join(ROOT, "shared/settings-search-seed.ts");
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf("--port") + 1] || 6797) || 6797;
const CHECK = args.includes("--check");

/** Upstream `SIDEBAR_SECTION_ITEMS` order (`packages/app/src/screens/settings-screen.tsx`). */
const APP_SECTIONS = [
  "general",
  "appearance",
  "sidebar",
  "chat",
  "terminal",
  "browser",
  "editor",
  "files",
  "shortcuts",
  "integrations",
  "notifications",
  "permissions",
  "diagnostics",
  "about",
];
/** Host pages are discovered from the sidebar's `settings-host-section-*` test ids. */
const SKIP_HOST_SECTIONS = new Set(["usage"]);
/** Per-record lists (this machine's projects): the page is searchable, its rows are not seeded. */
const PAGE_ONLY = new Set(["host:projects"]);
const PLUGIN_SCREENS = ["file-inspector-finder/finder-settings"];
const LOAD_MS = 9000;
const SETTLE_MS = 1800;

function readTree(dir: string, test: (file: string) => boolean): string {
  if (!fs.existsSync(dir)) return "";
  let text = "";
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      text += readTree(full, test);
    } else if (test(full)) {
      text += fs.readFileSync(full, "utf8");
    }
  }
  return text;
}

/** Every string literal the UI could have rendered: the app bundle plus this plugin's source. */
function loadUiCorpus(): string {
  const bundle = readTree(APP_DIST, (file) => file.endsWith(".js"));
  const plugin = ["client", "shared", "server"]
    .map((dir) => readTree(path.join(ROOT, dir), (file) => /\.(ts|tsx)$/.test(file) && !file.endsWith("settings-search-seed.ts")))
    .join("\n");
  const entry = ["index.client.tsx", "index.server.ts"]
    .map((file) => fs.readFileSync(path.join(ROOT, file), "utf8"))
    .join("\n");
  return `${bundle}\n${plugin}\n${entry}`;
}

/**
 * True when `text` is a whole string literal somewhere in the corpus (`"Restart daemon"`), not
 * merely a substring of one: a project called `1password` must not pass because some unrelated
 * literal happens to contain it.
 */
function inCorpus(corpus: string, text: string | undefined): boolean {
  if (!text) return false;
  const escaped = JSON.stringify(text).slice(1, -1);
  for (const body of new Set([text, escaped])) {
    for (const quote of ['"', "'", "`", ">"]) {
      const close = quote === ">" ? "<" : quote;
      if (corpus.includes(`${quote}${body}${close}`)) return true;
    }
  }
  return false;
}

async function main(): Promise<number> {
  const setup = resolveHarnessSetup();
  if (!setup) return 3;
  const paseoVersion = JSON.parse(
    fs.readFileSync(path.join(ROOT, "node_modules/@getpaseo/plugin/package.json"), "utf8"),
  ).version as string;
  const corpus = loadUiCorpus();
  if (corpus.length < 100_000) {
    console.error(`setup: app bundle corpus is ${corpus.length} chars; is ${APP_DIST} installed?`);
    return 3;
  }

  const harness = await ensureHarness(PORT);
  const require = createRequire(import.meta.url);
  const { chromium } = require(setup.playwrightCore);
  const browser = await chromium.launch({ executablePath: setup.chrome, headless: true });
  const pages: SettingsSearchPage[] = [];
  let dropped = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://localhost:${PORT}/settings/general`, { waitUntil: "domcontentloaded" });
    await page
      .waitForSelector('[data-testid="settings-host-section-host"]', { timeout: 45_000 })
      .catch(async () => {
        throw new Error(
          `settings sidebar never rendered (url ${page.url()}); is the daemon on :6767 up?`,
        );
      });
    await sleep(LOAD_MS / 3);
    const hostSlugs: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="settings-host-section-"]')).map((el) =>
        (el.getAttribute("data-testid") ?? "").replace("settings-host-section-", ""),
      ),
    );
    await page.click('[data-testid="settings-host-section-host"]');
    await sleep(SETTLE_MS);
    const serverId = String(page.url()).split("/settings/hosts/")[1]?.split("/")[0] ?? "";
    if (!serverId) throw new Error("could not read the host id from the Overview URL");

    const targets = [
      ...APP_SECTIONS.map((slug) => ({ key: `section:${slug}`, url: `/settings/${slug}` })),
      ...hostSlugs
        .filter((slug) => !SKIP_HOST_SECTIONS.has(slug))
        .map((slug) => ({ key: `host:${slug}`, url: `/settings/hosts/${serverId}/${slug}` })),
      ...PLUGIN_SCREENS.map((slug) => ({
        key: `plugin:${slug}`,
        url: `/settings/hosts/${serverId}/plugins/${slug}`,
      })),
    ];
    for (const target of targets) {
      await page.evaluate((url: string) => {
        history.pushState({}, "", url);
        dispatchEvent(new PopStateEvent("popstate"));
      }, target.url);
      await sleep(SETTLE_MS);
      const harvested: HarvestedSettingsPage | null = await page.evaluate(harvestSettingsDetailPane, await page.$('[data-testid="settings-detail-pane"]'));
      if (!harvested) {
        console.log(`  ${target.key.padEnd(44)} no page title rendered, skipped`);
        continue;
      }
      const label = normalizeSettingsText(harvested.label);
      if (!inCorpus(corpus, label)) {
        console.log(`  ${target.key.padEnd(44)} page title is not UI copy, skipped`);
        continue;
      }
      const kept = (PAGE_ONLY.has(target.key) ? [] : harvested.entries)
        .filter((entry) => inCorpus(corpus, normalizeSettingsText(entry.title)))
        .map((entry) => ({
          title: entry.title,
          ...(inCorpus(corpus, normalizeSettingsText(entry.hint)) ? { hint: entry.hint } : {}),
          ...(inCorpus(corpus, normalizeSettingsText(entry.group)) ? { group: entry.group } : {}),
        }));
      const entries = cleanSettingsEntries(kept);
      dropped += harvested.entries.length - kept.length;
      pages.push({ key: target.key, label, entries, source: "seed" });
      console.log(
        `  ${target.key.padEnd(44)} ${String(entries.length).padStart(3)} rows  (${harvested.entries.length - kept.length} non-UI strings dropped)`,
      );
    }
  } finally {
    await browser.close();
    harness?.kill();
  }

  const totalRows = pages.reduce((sum, page) => sum + page.entries.length, 0);
  console.log(`graded ${pages.length} pages, ${totalRows} rows kept, ${dropped} non-UI strings dropped`);
  if (pages.length < 10 || totalRows < 40) {
    console.error("refusing to write: the crawl looks degenerate (fewer than 10 pages or 40 rows)");
    return 2;
  }
  const seed: SettingsSearchSeed = {
    version: 1,
    paseoVersion,
    locale: "en",
    generatedAt: new Date().toISOString().slice(0, 10),
    pages,
  };
  const body = JSON.stringify(seed, null, 2);
  for (const ch of body) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code < 0x20 && ch !== "\n") || code === 0x7f || (code >= 0x200b && code <= 0x200f) || code === 0xfeff) {
      console.error(`refusing to write: invisible code point U+${code.toString(16).padStart(4, "0")} in seed`);
      return 2;
    }
  }
  const source =
    "// GENERATED by scripts/build-settings-search-seed.mts from the rendered Paseo settings screen.\n" +
    "// Do not edit by hand: re-run the script after a Paseo update (it prints what changed).\n" +
    'import type { SettingsSearchSeed } from "./settings-search";\n\n' +
    `export const SETTINGS_SEARCH_SEED: SettingsSearchSeed = ${body};\n`;
  if (CHECK) {
    const current = fs.existsSync(SEED_PATH) ? fs.readFileSync(SEED_PATH, "utf8") : "";
    const strip = (text: string) => text.replace(/"generatedAt": "[^"]*"/, "");
    if (strip(current) === strip(source)) {
      console.log("seed is current");
      return 0;
    }
    console.log("seed differs from the rendered screen: re-run without --check to update it");
    return 1;
  }
  fs.writeFileSync(SEED_PATH, source);
  console.log(`wrote ${path.relative(ROOT, SEED_PATH)}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
