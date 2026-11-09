/// <reference lib="dom" />
/**
 * Settings Search — a search field at the top of Paseo's settings sidebar.
 *
 * Type to find any setting by its title, hint, group or page ("keep daemon", "log file",
 * "dameon" with a typo). Enter or click opens the page, scrolls the row into the middle of the
 * view and flashes it. ⌘F (Ctrl+F) focuses the field while Settings is open. Esc clears.
 *
 * Index = the seed shipped with the plugin (`shared/settings-search-seed.ts`, read off the
 * rendered screen by `scripts/build-settings-search-seed.mts`) + every page this app has shown
 * since (`live`, in the app's own language). A page read live replaces its seed copy, so an app
 * update or a plugin row shows up the first time its page is opened. `Rebuild index` (Settings ->
 * Plugins -> File Inspector & Finder) reads every page now, skipping Usage.
 *
 * DOM contract (upstream `packages/app/src/screens/settings-screen.tsx`, v0.15.3):
 *   `settings-sidebar` > ... > `settings-sidebar-scroll-body`   the field goes right above it
 *   `settings-host-section-<slug>`                             native host page buttons
 *   `settings-detail-pane`                                     the page being read / revealed
 * Nothing React renders is restyled: the scroll body is hidden through a data attribute while a
 * query is typed, and the row flash is a data attribute too, so a re-render cannot fight it.
 */
import {
  buildSettingsPath,
  cleanSettingsEntries,
  countSettingsEntries,
  mergeSettingsIndex,
  normalizeSettingsText,
  parseSettingsRoute,
  searchSettingsIndex,
  settingsPageKind,
  settingsResultBreadcrumb,
  type MatchRange,
  type SettingsSearchPage,
  type SettingsSearchResult,
} from "../shared/settings-search";
import { SETTINGS_SEARCH_SEED } from "../shared/settings-search-seed";
import { getCatalogForLocale } from "./i18n";
import { harvestSettingsDetailPane } from "./settings-search-harvest";
import { syncPaseoThemeCssVariables } from "./theme-web";

export interface SettingsSearchPrefs {
  enabled: boolean;
  /** ⌘F / Ctrl+F focuses the field while Settings is open. */
  shortcut: boolean;
}

export type SettingsSearchTrigger = "open" | "learn" | "rebuild" | "self-test" | "reset";

export interface SettingsSearchReceipt {
  at: string;
  trigger: SettingsSearchTrigger;
  ok: boolean;
  outcome: string;
}

export interface SettingsSearchTestRow {
  title: string;
  where: string;
  field: number;
  source: "seed" | "live";
}

export interface SettingsSearchStatus {
  prefs: SettingsSearchPrefs;
  installed: boolean;
  /** The field is on screen right now (only while Settings is open). */
  mounted: boolean;
  rebuilding: { done: number; total: number } | null;
  seed: { paseoVersion: string; generatedAt: string; pages: number; rows: number };
  live: { pages: number; rows: number; newest: string | null };
  merged: { pages: number; rows: number; emptyPages: string[]; seedOnlyPages: string[] };
  lastTest: { at: string; query: string; count: number; top: SettingsSearchTestRow[] } | null;
  receipts: SettingsSearchReceipt[];
}

export const SETTINGS_SEARCH_EVENT = "paseo-finder:settings-search";

const PREFS_KEY = "paseo:finder-plugin:settings-search";
const LIVE_KEY = "paseo:finder-plugin:settings-search-live";
const RECEIPTS_KEY = "paseo:finder-plugin:settings-search-receipts";
const SERVER_KEY = "paseo:finder-plugin:settings-search-server";
const MAX_RECEIPTS = 20;
const MAX_LIVE_PAGES = 120;
const RESULT_LIMIT = 40;
const MOUNT_DEBOUNCE_MS = 120;
const LEARN_DEBOUNCE_MS = 700;
const REVEAL_TIMEOUT_MS = 4000;
const REBUILD_SETTLE_MS = 900;
const FLASH_MS = 1800;
/** Opening Usage fetches provider usage (shared Claude quota); it is never visited for indexing. */
const REBUILD_SKIP = new Set(["host:usage"]);

const SEL = {
  sidebar: '[data-testid="settings-sidebar"]',
  scroll: '[data-testid="settings-sidebar-scroll-body"]',
  pane: '[data-testid="settings-detail-pane"]',
};
const HIDDEN_ATTR = "data-finder-settings-hidden";
const HIT_ATTR = "data-finder-settings-hit";
const STYLE_ID = "paseo-finder-settings-search-style";
const DEFAULT_PREFS: SettingsSearchPrefs = { enabled: true, shortcut: true };

interface Ui {
  wrap: HTMLElement;
  input: HTMLInputElement;
  clear: HTMLElement;
  kbd: HTMLElement;
  results: HTMLElement;
  scroll: Element;
}

let installedOwner: object | null = null;
let ui: Ui | null = null;
let currentResults: SettingsSearchResult[] = [];
let activeIndex = 0;
let lastQuery = "";
let focusRequestedUntil = 0;
let liveCache: SettingsSearchPage[] | null = null;
let rebuilding: { done: number; total: number } | null = null;
let lastTest: SettingsSearchStatus["lastTest"] = null;
let localeGetter: () => string | undefined = () => undefined;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function emit(): void {
  try {
    window.dispatchEvent(new CustomEvent(SETTINGS_SEARCH_EVENT));
  } catch {
    // No window (tests)
  }
}

export function normalizeSettingsSearchPrefs(raw: unknown): SettingsSearchPrefs {
  const value = raw && typeof raw === "object" ? (raw as Partial<SettingsSearchPrefs>) : {};
  return { enabled: value.enabled !== false, shortcut: value.shortcut !== false };
}

export function readSettingsSearchPrefs(): SettingsSearchPrefs {
  try {
    const raw = storage()?.getItem(PREFS_KEY);
    return normalizeSettingsSearchPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function syncSettingsSearchPrefs(prefs: Partial<SettingsSearchPrefs>): SettingsSearchPrefs {
  const next = normalizeSettingsSearchPrefs({ ...readSettingsSearchPrefs(), ...prefs });
  try {
    storage()?.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  if (typeof document !== "undefined" && installedOwner) {
    ensureUi(document, window);
  }
  emit();
  return next;
}

function isPage(value: unknown): value is SettingsSearchPage {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<SettingsSearchPage>;
  return (
    typeof page.key === "string" &&
    settingsPageKind(page.key) !== null &&
    typeof page.label === "string" &&
    Array.isArray(page.entries) &&
    page.entries.every((entry) => entry && typeof entry.title === "string")
  );
}

export function readLiveSettingsPages(): SettingsSearchPage[] {
  if (liveCache) return liveCache;
  try {
    const raw = storage()?.getItem(LIVE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { pages?: unknown }) : null;
    const pages = Array.isArray(parsed?.pages) ? parsed.pages.filter(isPage) : [];
    liveCache = pages.map((page) => ({ ...page, source: "live" as const }));
  } catch {
    liveCache = [];
  }
  return liveCache;
}

function writeLiveSettingsPages(pages: SettingsSearchPage[]): void {
  liveCache = pages.slice(-MAX_LIVE_PAGES);
  try {
    storage()?.setItem(LIVE_KEY, JSON.stringify({ version: 1, pages: liveCache }));
  } catch {
    // Quota or private mode: the in-memory copy still serves this session
  }
}

function readReceipts(): SettingsSearchReceipt[] {
  try {
    const raw = storage()?.getItem(RECEIPTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as SettingsSearchReceipt[]).slice(0, MAX_RECEIPTS) : [];
  } catch {
    return [];
  }
}

function pushReceipt(trigger: SettingsSearchTrigger, ok: boolean, outcome: string): void {
  const next = [{ at: new Date().toISOString(), trigger, ok, outcome }, ...readReceipts()].slice(
    0,
    MAX_RECEIPTS,
  );
  try {
    storage()?.setItem(RECEIPTS_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  emit();
}

function rememberServerId(serverId: string | undefined): void {
  if (!serverId) return;
  try {
    storage()?.setItem(SERVER_KEY, serverId);
  } catch {
    // Ignore storage errors
  }
}

function readServerId(win: Window): string | null {
  const fromRoute = parseSettingsRoute(win.location.pathname)?.serverId;
  if (fromRoute) return fromRoute;
  try {
    return storage()?.getItem(SERVER_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Seed pages, with every page this app has shown replacing its seed copy. */
export function currentSettingsIndex(): SettingsSearchPage[] {
  return mergeSettingsIndex(SETTINGS_SEARCH_SEED.pages, readLiveSettingsPages());
}

export function querySettingsIndex(query: string, limit = RESULT_LIMIT): SettingsSearchResult[] {
  return searchSettingsIndex(currentSettingsIndex(), query, { limit });
}

// ---------------------------------------------------------------------------
// Learning the page on screen
// ---------------------------------------------------------------------------

/** Reads the settings page on screen into the live index. Returns the stored page, if any. */
export function learnCurrentSettingsPage(
  doc: Document = document,
  win: Window = window,
): SettingsSearchPage | null {
  const route = parseSettingsRoute(win.location.pathname);
  if (!route) return null;
  rememberServerId(route.serverId);
  const harvested = harvestSettingsDetailPane(doc.querySelector(SEL.pane));
  const label = normalizeSettingsText(harvested?.label);
  if (!harvested || !label) return null;
  const entries = cleanSettingsEntries(harvested.entries);
  const live = readLiveSettingsPages();
  const previous = live.find((page) => page.key === route.key);
  const known =
    previous ?? SETTINGS_SEARCH_SEED.pages.find((page) => page.key === route.key) ?? null;
  // A page still loading shows its title and nothing else; never trade known rows for that.
  if (entries.length === 0 && known && known.entries.length > 0) return previous ?? null;
  if (
    previous &&
    previous.label === label &&
    JSON.stringify(previous.entries) === JSON.stringify(entries)
  ) {
    return previous;
  }
  const page: SettingsSearchPage = {
    key: route.key,
    label,
    entries,
    source: "live",
    harvestedAt: new Date().toISOString(),
  };
  writeLiveSettingsPages([...live.filter((p) => p.key !== route.key), page]);
  if (!previous || previous.entries.length !== entries.length) {
    pushReceipt("learn", true, `${label}: ${entries.length} rows read from the screen`);
  } else {
    emit();
  }
  return page;
}

export function resetLearnedSettingsPages(): SettingsSearchStatus {
  const count = readLiveSettingsPages().length;
  writeLiveSettingsPages([]);
  try {
    storage()?.removeItem(LIVE_KEY);
  } catch {
    // Ignore storage errors
  }
  pushReceipt("reset", true, `forgot ${count} learned pages; the shipped seed is in use`);
  return getSettingsSearchStatus();
}

// ---------------------------------------------------------------------------
// Status (能读) and self-test (能试)
// ---------------------------------------------------------------------------

function testRows(results: SettingsSearchResult[]): SettingsSearchTestRow[] {
  return results.slice(0, 6).map((result) => ({
    title: result.title,
    where: settingsResultBreadcrumb(result) || result.pageLabel,
    field: result.field,
    source: result.source,
  }));
}

export function getSettingsSearchStatus(): SettingsSearchStatus {
  const live = readLiveSettingsPages();
  const merged = currentSettingsIndex();
  const liveKeys = new Set(live.map((page) => page.key));
  const newest = live.reduce<string | null>(
    (latest, page) => (page.harvestedAt && (!latest || page.harvestedAt > latest) ? page.harvestedAt : latest),
    null,
  );
  return {
    prefs: readSettingsSearchPrefs(),
    installed: installedOwner !== null,
    mounted: Boolean(ui?.wrap.isConnected),
    rebuilding,
    seed: {
      paseoVersion: SETTINGS_SEARCH_SEED.paseoVersion,
      generatedAt: SETTINGS_SEARCH_SEED.generatedAt,
      pages: SETTINGS_SEARCH_SEED.pages.length,
      rows: countSettingsEntries(SETTINGS_SEARCH_SEED.pages),
    },
    live: { pages: live.length, rows: countSettingsEntries(live), newest },
    merged: {
      pages: merged.length,
      rows: countSettingsEntries(merged),
      emptyPages: merged.filter((page) => page.entries.length === 0).map((page) => page.label),
      seedOnlyPages: merged.filter((page) => !liveKeys.has(page.key)).map((page) => page.label),
    },
    lastTest,
    receipts: readReceipts(),
  };
}

/** Runs a real query against the same index the field uses. */
export function runSettingsSearchSelfTest(query = "restart daemon"): SettingsSearchStatus {
  const results = querySettingsIndex(query);
  lastTest = {
    at: new Date().toISOString(),
    query,
    count: results.length,
    top: testRows(results),
  };
  const top = results[0];
  pushReceipt(
    "self-test",
    results.length > 0,
    top
      ? `"${query}" -> ${results.length} results, top: ${settingsResultBreadcrumb(top) || top.pageLabel} › ${top.title}`
      : `"${query}" -> no results`,
  );
  return getSettingsSearchStatus();
}

// ---------------------------------------------------------------------------
// Navigation + reveal
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function cssEscape(win: Window, value: string): string {
  const css = (win as unknown as { CSS?: { escape?: (v: string) => string } }).CSS;
  return css?.escape ? css.escape(value) : value.replace(/[^\w-]/g, "\\$&");
}

function pushRoute(win: Window, path: string): void {
  win.history.pushState({}, "", path);
  const Ctor = (win as unknown as { PopStateEvent?: typeof PopStateEvent }).PopStateEvent ?? PopStateEvent;
  win.dispatchEvent(new Ctor("popstate"));
}

/**
 * Host pages go through their native sidebar button (the app picks the active host); App and
 * plugin pages go through the router by URL, which expo-router follows on `popstate`.
 */
async function navigateToSettingsPage(key: string, doc: Document, win: Window): Promise<boolean> {
  if (parseSettingsRoute(win.location.pathname)?.key === key) return true;
  const kind = settingsPageKind(key);
  const slug = key.slice(key.indexOf(":") + 1);
  if (kind === "host") {
    const button = doc.querySelector<HTMLElement>(
      `[data-testid="settings-host-section-${cssEscape(win, slug)}"]`,
    );
    if (button) {
      button.click();
      return true;
    }
  }
  let serverId = readServerId(win);
  if (!serverId && kind !== "section") {
    // No host id seen yet: open the host's Plugins page natively, then read the id off the URL.
    doc.querySelector<HTMLElement>('[data-testid="settings-host-section-plugins"]')?.click();
    for (let i = 0; i < 20 && !serverId; i += 1) {
      await sleep(100);
      serverId = parseSettingsRoute(win.location.pathname)?.serverId ?? null;
    }
  }
  const path = buildSettingsPath(key, serverId);
  if (!path) return false;
  pushRoute(win, path);
  return true;
}

function textLeaves(root: Element): Element[] {
  return Array.from(root.querySelectorAll('[dir="auto"]')).filter(
    (el) => !el.querySelector('[dir="auto"]'),
  );
}

function paneTitle(pane: Element | null, win: Window): Element | null {
  if (!pane) return null;
  return (
    textLeaves(pane).find((el) => (parseFloat(win.getComputedStyle(el).fontSize) || 0) >= 20) ??
    null
  );
}

/** The row around a title: the largest ancestor that still holds no other row title. */
export function findSettingsRowElement(pane: Element | null, title: string, win: Window): Element | null {
  if (!pane) return null;
  const wanted = normalizeSettingsText(title);
  const leaves = textLeaves(pane);
  const leaf = leaves.find((el) => normalizeSettingsText(el.textContent) === wanted);
  if (!leaf) return null;
  const leafStyle = win.getComputedStyle(leaf);
  const siblingTitles = (scope: Element) =>
    textLeaves(scope).filter((el) => {
      if (el === leaf) return false;
      const cs = win.getComputedStyle(el);
      return cs.fontSize === leafStyle.fontSize && cs.color === leafStyle.color;
    }).length;
  let row: Element = leaf;
  while (row.parentElement && row.parentElement !== pane) {
    const parent = row.parentElement;
    if (parent.getBoundingClientRect().height > 160 || siblingTitles(parent) > 0) break;
    row = parent;
  }
  return row;
}

function flash(target: Element, win: Window): void {
  const reduced = win.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  try {
    target.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  } catch {
    target.scrollIntoView();
  }
  target.removeAttribute(HIT_ATTR);
  void (target as HTMLElement).offsetWidth;
  target.setAttribute(HIT_ATTR, "1");
  win.setTimeout(() => target.removeAttribute(HIT_ATTR), FLASH_MS);
}

async function revealWhenReady(
  result: SettingsSearchResult,
  doc: Document,
  win: Window,
): Promise<"row" | "page" | null> {
  const deadline = Date.now() + REVEAL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (parseSettingsRoute(win.location.pathname)?.key === result.pageKey) {
      const pane = doc.querySelector(SEL.pane);
      const title = paneTitle(pane, win);
      if (title && result.kind === "page") {
        flash(title, win);
        return "page";
      }
      const row = title ? findSettingsRowElement(pane, result.title, win) : null;
      if (row) {
        flash(row, win);
        return "row";
      }
    }
    await sleep(100);
  }
  // The page opened but the row never appeared (it moved, or is behind a toggle).
  return parseSettingsRoute(win.location.pathname)?.key === result.pageKey ? "page" : null;
}

export async function openSettingsSearchResult(
  result: SettingsSearchResult,
  doc: Document = document,
  win: Window = window,
): Promise<boolean> {
  const label = `${settingsResultBreadcrumb(result) || result.pageLabel}${result.kind === "setting" ? ` › ${result.title}` : ""}`;
  const navigated = await navigateToSettingsPage(result.pageKey, doc, win);
  if (!navigated) {
    pushReceipt("open", false, `${label}: no host id known yet, open any Host page once`);
    return false;
  }
  const revealed = await revealWhenReady(result, doc, win);
  const ok = result.kind === "page" ? revealed !== null : revealed === "row";
  pushReceipt(
    "open",
    ok,
    revealed === "row"
      ? `${label}: row revealed`
      : revealed === "page"
        ? result.kind === "page"
          ? `${label}: page opened`
          : `${label}: page opened, row not on screen (moved or hidden)`
        : `${label}: page did not open within ${REVEAL_TIMEOUT_MS / 1000}s`,
  );
  return ok;
}

/**
 * Reads every settings page now (能调): opens each in turn, learns it, returns to where you
 * were. Skips Usage, which fetches provider usage when opened.
 */
export async function rebuildSettingsIndex(
  doc: Document = document,
  win: Window = window,
): Promise<SettingsSearchStatus> {
  if (rebuilding) return getSettingsSearchStatus();
  if (!doc.querySelector(SEL.sidebar)) {
    pushReceipt("rebuild", false, "Settings is not open; nothing to read");
    return getSettingsSearchStatus();
  }
  const start = `${win.location.pathname}${win.location.search}`;
  const keys = currentSettingsIndex()
    .map((page) => page.key)
    .filter((key) => !REBUILD_SKIP.has(key));
  rebuilding = { done: 0, total: keys.length };
  emit();
  let read = 0;
  try {
    for (const key of keys) {
      if (await navigateToSettingsPage(key, doc, win)) {
        const deadline = Date.now() + REVEAL_TIMEOUT_MS;
        while (
          Date.now() < deadline &&
          !(parseSettingsRoute(win.location.pathname)?.key === key && paneTitle(doc.querySelector(SEL.pane), win))
        ) {
          await sleep(100);
        }
        await sleep(REBUILD_SETTLE_MS);
        if (learnCurrentSettingsPage(doc, win)) read += 1;
      }
      rebuilding = { done: rebuilding.done + 1, total: keys.length };
      emit();
    }
  } finally {
    rebuilding = null;
    if (`${win.location.pathname}${win.location.search}` !== start) pushRoute(win, start);
  }
  const live = readLiveSettingsPages();
  pushReceipt(
    "rebuild",
    read > 0,
    `read ${read} of ${keys.length} pages (${countSettingsEntries(live)} rows); skipped Usage`,
  );
  return getSettingsSearchStatus();
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

function svgIcon(doc: Document, paths: string[]): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  })) {
    svg.setAttribute(k, v);
  }
  for (const d of paths) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

// lucide `search` and `x`, the icons Paseo's own SearchField draws.
const SEARCH_ICON = ["m21 21-4.34-4.34", "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z"];
const CLEAR_ICON = ["M18 6 6 18", "m6 6 12 12"];

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
[${HIDDEN_ATTR}="1"] { display: none !important; }
.pfss-wrap { flex: 0 0 auto; padding: 4px 12px 10px; }
.pfss-field { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px;
  background: var(--paseo-finder-surface-1); border: 1px solid var(--paseo-finder-border);
  color: var(--paseo-finder-fg-muted); transition: border-color 120ms ease, background-color 120ms ease; }
.pfss-field:focus-within { border-color: var(--paseo-finder-border-accent); background: var(--paseo-finder-surface-2); }
.pfss-field svg { flex: 0 0 auto; }
.pfss-input { flex: 1 1 auto; min-width: 0; border: 0; outline: 0; background: transparent; padding: 0;
  font: inherit; font-size: 14px; line-height: 20px; color: var(--paseo-finder-fg); }
.pfss-input::placeholder { color: var(--paseo-finder-fg-muted); opacity: 1; }
.pfss-kbd { flex: 0 0 auto; font-size: 11px; line-height: 16px; padding: 0 5px; border-radius: 4px;
  border: 1px solid var(--paseo-finder-border); color: var(--paseo-finder-fg-muted); }
.pfss-clear { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px; background: transparent;
  color: var(--paseo-finder-fg-muted); cursor: default; }
.pfss-clear:hover { color: var(--paseo-finder-fg); background: var(--paseo-finder-surface-3); }
.pfss-clear:focus-visible { outline: 2px solid var(--paseo-finder-border-accent); outline-offset: 1px; }
.pfss-results { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 8px 16px; }
.pfss-results[hidden] { display: none; }
.pfss-row { display: flex; align-items: flex-start; gap: 10px; padding: 7px 10px; border-radius: 8px;
  color: var(--paseo-finder-fg); cursor: default; user-select: none; }
.pfss-row[aria-selected="true"] { background: var(--pfss-active-bg, var(--paseo-finder-surface-2)); }
.pfss-icon { flex: 0 0 16px; height: 20px; display: inline-flex; align-items: center; color: var(--paseo-finder-fg-muted); }
.pfss-icon svg { width: 16px; height: 16px; }
.pfss-text { display: flex; flex-direction: column; min-width: 0; }
.pfss-title, .pfss-crumb, .pfss-hint { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pfss-title { font-size: 14px; line-height: 20px; }
.pfss-crumb, .pfss-hint { font-size: 12px; line-height: 16px; color: var(--paseo-finder-fg-muted); }
.pfss-hit { font-weight: 600; color: var(--paseo-finder-fg); }
.pfss-empty { padding: 8px 10px; font-size: 13px; line-height: 18px; color: var(--paseo-finder-fg-muted); }
[${HIT_ATTR}="1"] { border-radius: 8px; animation: pfss-flash ${FLASH_MS}ms ease-out; }
@keyframes pfss-flash {
  0%, 35% { background-color: color-mix(in srgb, var(--paseo-finder-accent) 16%, transparent);
    box-shadow: inset 0 0 0 1.5px var(--paseo-finder-border-accent); }
  100% { background-color: transparent; box-shadow: inset 0 0 0 1.5px transparent; }
}
@media (prefers-reduced-motion: reduce) {
  [${HIT_ATTR}="1"] { animation: none; box-shadow: inset 0 0 0 1.5px var(--paseo-finder-border-accent); }
  .pfss-field { transition: none; }
}`;
  doc.head.appendChild(style);
}

function strings() {
  return getCatalogForLocale(localeGetter()).settingsSearch;
}

function isMac(win: Window): boolean {
  return /Mac|iPhone|iPad/.test(win.navigator?.platform ?? "") || /Mac OS/.test(win.navigator?.userAgent ?? "");
}

function appendMarked(doc: Document, parent: HTMLElement, text: string, ranges: MatchRange[]): void {
  let cursor = 0;
  for (const range of ranges) {
    const start = Math.max(range.start, cursor);
    const end = Math.min(range.start + range.length, text.length);
    if (end <= start) continue;
    if (start > cursor) parent.appendChild(doc.createTextNode(text.slice(cursor, start)));
    const mark = doc.createElement("span");
    mark.className = "pfss-hit";
    mark.textContent = text.slice(start, end);
    parent.appendChild(mark);
    cursor = end;
  }
  if (cursor < text.length) parent.appendChild(doc.createTextNode(text.slice(cursor)));
}

/** The page's own icon, cloned from its native sidebar button, so results read as sidebar rows. */
function pageIcon(result: SettingsSearchResult, scroll: Element, doc: Document, win: Window): Element | null {
  const kind = settingsPageKind(result.pageKey);
  const slug = result.pageKey.slice(result.pageKey.indexOf(":") + 1);
  let button: Element | null = null;
  if (kind === "host") {
    button = doc.querySelector(`[data-testid="settings-host-section-${cssEscape(win, slug)}"]`);
  } else if (kind === "plugin") {
    button = doc.querySelector('[data-testid="settings-host-section-plugins"]');
  } else {
    button =
      Array.from(scroll.querySelectorAll('[role="button"],button')).find(
        (el) => normalizeSettingsText(el.textContent) === result.pageLabel,
      ) ?? null;
  }
  const svg = button?.querySelector("svg");
  return svg ? svg.cloneNode(true) as Element : null;
}

function scopeLabel(result: SettingsSearchResult): string {
  const s = strings();
  const kind = settingsPageKind(result.pageKey);
  return kind === "host" ? s.scopeHost : kind === "plugin" ? s.scopePlugin : s.scopeApp;
}

function setActive(index: number): void {
  if (!ui) return;
  activeIndex = index;
  const rows = Array.from(ui.results.querySelectorAll<HTMLElement>(".pfss-row"));
  rows.forEach((row, i) => row.setAttribute("aria-selected", i === index ? "true" : "false"));
  const row = rows[index];
  if (row) {
    ui.input.setAttribute("aria-activedescendant", row.id);
    row.scrollIntoView({ block: "nearest" });
  } else {
    ui.input.removeAttribute("aria-activedescendant");
  }
}

function render(doc: Document, win: Window): void {
  if (!ui) return;
  const query = ui.input.value;
  const has = normalizeSettingsText(query).length > 0;
  ui.clear.hidden = !has;
  ui.kbd.hidden = has || !readSettingsSearchPrefs().shortcut;
  ui.input.setAttribute("aria-expanded", has ? "true" : "false");
  if (!has) {
    currentResults = [];
    ui.results.hidden = true;
    ui.results.replaceChildren();
    ui.scroll.removeAttribute(HIDDEN_ATTR);
    return;
  }
  ui.scroll.setAttribute(HIDDEN_ATTR, "1");
  ui.results.hidden = false;
  currentResults = querySettingsIndex(query);
  activeIndex = Math.min(activeIndex, Math.max(0, currentResults.length - 1));
  const rows: Element[] = [];
  if (currentResults.length === 0) {
    const empty = doc.createElement("div");
    empty.className = "pfss-empty";
    empty.textContent = strings().noResults.replace("{query}", normalizeSettingsText(query));
    rows.push(empty);
  }
  currentResults.forEach((result, index) => {
    const row = doc.createElement("div");
    row.className = "pfss-row";
    row.id = `pfss-opt-${index}`;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", index === activeIndex ? "true" : "false");
    row.setAttribute("data-testid", "settings-search-result");
    const icon = doc.createElement("span");
    icon.className = "pfss-icon";
    const svg = pageIcon(result, ui!.scroll, doc, win);
    if (svg) icon.appendChild(svg);
    const text = doc.createElement("span");
    text.className = "pfss-text";
    const title = doc.createElement("span");
    title.className = "pfss-title";
    appendMarked(doc, title, result.title, result.titleRanges);
    const crumb = doc.createElement("span");
    crumb.className = "pfss-crumb";
    crumb.textContent = settingsResultBreadcrumb(result) || scopeLabel(result);
    text.append(title, crumb);
    if (result.field === 2 && result.hint) {
      const hint = doc.createElement("span");
      hint.className = "pfss-hint";
      appendMarked(doc, hint, result.hint, result.hintRanges);
      text.appendChild(hint);
    }
    row.append(icon, text);
    row.addEventListener("mousedown", (event) => event.preventDefault());
    row.addEventListener("mousemove", () => {
      if (activeIndex !== index) setActive(index);
    });
    row.addEventListener("click", () => {
      setActive(index);
      void openSettingsSearchResult(result, doc, win);
    });
    rows.push(row);
  });
  ui.results.replaceChildren(...rows);
  setActive(activeIndex);
}

function buildUi(doc: Document, win: Window, scroll: Element): Ui {
  const s = strings();
  const wrap = doc.createElement("div");
  wrap.className = "pfss-wrap";
  wrap.setAttribute("data-finder-settings-search", "1");
  const field = doc.createElement("label");
  field.className = "pfss-field";
  const input = doc.createElement("input");
  input.className = "pfss-input";
  input.type = "text";
  input.placeholder = s.placeholder;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", s.placeholder);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "pfss-results");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("data-testid", "settings-search-input");
  const kbd = doc.createElement("span");
  kbd.className = "pfss-kbd";
  kbd.setAttribute("aria-hidden", "true");
  kbd.textContent = isMac(win) ? "⌘F" : "Ctrl F";
  const clear = doc.createElement("button");
  clear.type = "button";
  clear.className = "pfss-clear";
  clear.hidden = true;
  clear.setAttribute("aria-label", s.clear);
  clear.appendChild(svgIcon(doc, CLEAR_ICON));
  field.append(svgIcon(doc, SEARCH_ICON), input, kbd, clear);
  wrap.appendChild(field);

  const results = doc.createElement("div");
  results.className = "pfss-results";
  results.id = "pfss-results";
  results.hidden = true;
  results.setAttribute("role", "listbox");
  results.setAttribute("aria-label", s.resultsLabel);
  results.setAttribute("data-testid", "settings-search-results");

  // The active result uses the native selected-row colour, read off the selected sidebar row.
  const selected = scroll.querySelector('[aria-selected="true"]');
  const selectedBg = selected ? win.getComputedStyle(selected).backgroundColor : "";
  if (selectedBg && selectedBg !== "rgba(0, 0, 0, 0)" && selectedBg !== "transparent") {
    results.style.setProperty("--pfss-active-bg", selectedBg);
  }

  const clearQuery = () => {
    input.value = "";
    lastQuery = "";
    activeIndex = 0;
    render(doc, win);
  };
  input.addEventListener("input", () => {
    lastQuery = input.value;
    activeIndex = 0;
    render(doc, win);
  });
  input.addEventListener("keydown", (event) => {
    const count = currentResults.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!count) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + count) % count);
    } else if (event.key === "Enter") {
      const result = currentResults[activeIndex];
      if (!result || event.isComposing) return;
      event.preventDefault();
      void openSettingsSearchResult(result, doc, win);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (input.value) clearQuery();
      else input.blur();
    }
  });
  clear.addEventListener("click", () => {
    clearQuery();
    input.focus();
  });
  return { wrap, input, clear, kbd, results, scroll };
}

function teardownUi(): void {
  if (!ui) return;
  ui.scroll.removeAttribute(HIDDEN_ATTR);
  ui.wrap.remove();
  ui.results.remove();
  ui = null;
  currentResults = [];
}

/** The field sits right above the scroll body of the sidebar that is on screen now. */
function fieldInPlace(): boolean {
  return Boolean(
    ui &&
      ui.wrap.isConnected &&
      ui.scroll.isConnected &&
      ui.wrap.nextElementSibling === ui.results &&
      ui.results.nextElementSibling === ui.scroll,
  );
}

function ensureUi(doc: Document, win: Window): void {
  const prefs = readSettingsSearchPrefs();
  const scroll = doc.querySelector(SEL.sidebar)?.querySelector(SEL.scroll) ?? null;
  const parent = scroll?.parentElement ?? null;
  if (!prefs.enabled) {
    teardownUi();
    return;
  }
  // No sidebar for a moment (a route swap in progress): keep the detached field for the next one.
  if (!scroll || !parent) return;
  if (ui && ui.scroll === scroll && fieldInPlace()) return;
  if (ui) {
    // Paseo re-mounts the whole settings sidebar on every navigation. Move the same field into the
    // new sidebar instead of rebuilding it: query, results and selection stay as they were.
    if (ui.scroll !== scroll) ui.scroll.removeAttribute(HIDDEN_ATTR);
    ui.scroll = scroll;
    parent.insertBefore(ui.wrap, scroll);
    parent.insertBefore(ui.results, scroll);
    render(doc, win);
    return;
  }
  syncPaseoThemeCssVariables(doc, win);
  ui = buildUi(doc, win, scroll);
  parent.insertBefore(ui.wrap, scroll);
  parent.insertBefore(ui.results, scroll);
  if (lastQuery) ui.input.value = lastQuery;
  render(doc, win);
  if (focusRequestedUntil > Date.now()) {
    focusRequestedUntil = 0;
    ui.input.focus();
  }
}

/** ⌘K "Search settings": opens Settings (if needed) and focuses the field. */
export function openSettingsSearch(win: Window = window): void {
  if (ui?.wrap.isConnected) {
    ui.input.focus();
    ui.input.select();
    return;
  }
  focusRequestedUntil = Date.now() + 5000;
  if (!win.location.pathname.startsWith("/settings")) pushRoute(win, "/settings/general");
}

export function installSettingsSearch(
  options: { getLocale?: () => string | undefined } = {},
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  if (installedOwner) return () => {};
  const owner = {};
  installedOwner = owner;
  if (options.getLocale) localeGetter = options.getLocale;
  const doc = document;
  const win = window;
  injectStyle(doc);

  let mountTimer: number | null = null;
  let learnTimer: number | null = null;
  const onSettings = () => win.location.pathname.startsWith("/settings");
  const ownNode = (node: Node) =>
    Boolean(ui && (ui.wrap.contains(node) || ui.results.contains(node)));

  const tick = () => {
    mountTimer = null;
    if (!onSettings()) {
      lastQuery = "";
      if (ui) teardownUi();
      return;
    }
    ensureUi(doc, win);
  };
  const learn = () => {
    learnTimer = null;
    if (onSettings() && readSettingsSearchPrefs().enabled && !rebuilding) {
      learnCurrentSettingsPage(doc, win);
    }
  };
  const observer = new MutationObserver((records) => {
    if (!onSettings()) {
      if (ui && mountTimer === null) mountTimer = win.setTimeout(tick, MOUNT_DEBOUNCE_MS);
      return;
    }
    if (records.every((record) => ownNode(record.target))) return;
    // Mount in this callback, which runs after React's commit and before the browser paints, so
    // the re-mounted sidebar is never shown without the field (the list would jump 48px up and back).
    // The debounced tick stays as the backstop.
    if (!fieldInPlace()) ensureUi(doc, win);
    if (mountTimer === null) mountTimer = win.setTimeout(tick, MOUNT_DEBOUNCE_MS);
    if (learnTimer !== null) win.clearTimeout(learnTimer);
    learnTimer = win.setTimeout(learn, LEARN_DEBOUNCE_MS);
  });
  observer.observe(doc.body, { childList: true, subtree: true });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "f" || event.altKey || event.shiftKey) return;
    if (!(isMac(win) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;
    if (!ui?.wrap.isConnected || !readSettingsSearchPrefs().shortcut) return;
    event.preventDefault();
    event.stopPropagation();
    ui.input.focus();
    ui.input.select();
  };
  win.addEventListener("keydown", onKeyDown, true);
  tick();
  if (onSettings()) learnTimer = win.setTimeout(learn, LEARN_DEBOUNCE_MS);

  return () => {
    if (installedOwner !== owner) return;
    observer.disconnect();
    win.removeEventListener("keydown", onKeyDown, true);
    if (mountTimer !== null) win.clearTimeout(mountTimer);
    if (learnTimer !== null) win.clearTimeout(learnTimer);
    teardownUi();
    installedOwner = null;
  };
}
