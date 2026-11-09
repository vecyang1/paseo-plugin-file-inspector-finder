/**
 * Settings Search — the pure half (index shape, route mapping, ranking).
 *
 * Shared by the DOM enhancer (`client/settings-search-web.ts`), the agent tool
 * (`search_paseo_settings` in `index.server.ts`), the seed crawler
 * (`scripts/build-settings-search-seed.mts`) and the tests. Nothing here touches the DOM.
 *
 * Ranking reuses Paseo's own matcher (`@getpaseo/protocol/search/text-match`, the one behind
 * the pickers and history search), so a query ranks the same way here as it does in ⌘K.
 */
import {
  compareMatchScores,
  fuzzyPolicyForToken,
  matchRanges,
  scoreMatch,
  scoreTextFields,
  tokenizeQuery,
  type MatchRange,
  type MatchScore,
} from "@getpaseo/protocol/search/text-match";

export type { MatchRange, MatchScore };

/** `section` = App pages, `host` = per-host pages, `plugin` = a plugin's settings screen. */
export type SettingsPageKind = "section" | "host" | "plugin";

export interface SettingsSearchEntry {
  /** Row title as rendered ("Keep daemon running after quit"). */
  title: string;
  /** Row hint under the title, if any. */
  hint?: string;
  /** Group heading above the card ("Daemon"). */
  group?: string;
}

export interface SettingsSearchPage {
  /** `section:<slug>` | `host:<slug>` | `plugin:<pluginId>/<screenId>` */
  key: string;
  /** Page title as rendered ("Overview"). */
  label: string;
  entries: SettingsSearchEntry[];
  /** `seed` = shipped with the plugin; `live` = read from this app's own screen. */
  source: "seed" | "live";
  harvestedAt?: string;
}

export interface SettingsSearchSeed {
  version: 1;
  paseoVersion: string;
  locale: string;
  generatedAt: string;
  pages: SettingsSearchPage[];
}

export interface SettingsRoute {
  key: string;
  kind: SettingsPageKind;
  /** Section slug, host section slug, or `<pluginId>/<screenId>`. */
  slug: string;
  serverId?: string;
}

const MAX_TEXT_LENGTH = 160;

// ---------------------------------------------------------------------------
// Routes (upstream `packages/app/src/app/settings/**` + `utils/host-routes.ts`)
// ---------------------------------------------------------------------------

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Maps a settings pathname to a page key. Project pages (`/settings/hosts/<id>/projects/<p>`)
 * and the bare host route return null: they are per-record, not settings pages.
 */
export function parseSettingsRoute(pathname: string): SettingsRoute | null {
  const parts = pathname.split(/[?#]/)[0].split("/").filter(Boolean).map(decodeSegment);
  if (parts[0] !== "settings") return null;
  if (parts.length === 2 && parts[1] !== "hosts") {
    return { key: `section:${parts[1]}`, kind: "section", slug: parts[1] };
  }
  if (parts[1] !== "hosts" || parts.length < 4) return null;
  const serverId = parts[2];
  if (parts.length === 4) {
    return { key: `host:${parts[3]}`, kind: "host", slug: parts[3], serverId };
  }
  if (parts[3] === "plugins" && parts.length === 6) {
    const slug = `${parts[4]}/${parts[5]}`;
    return { key: `plugin:${slug}`, kind: "plugin", slug, serverId };
  }
  return null;
}

/** The inverse of `parseSettingsRoute`. Host and plugin pages need a server id. */
export function buildSettingsPath(key: string, serverId?: string | null): string | null {
  const colon = key.indexOf(":");
  if (colon <= 0) return null;
  const kind = key.slice(0, colon);
  const slug = key.slice(colon + 1);
  if (!slug) return null;
  if (kind === "section") return `/settings/${encodeURIComponent(slug)}`;
  if (!serverId) return null;
  const host = `/settings/hosts/${encodeURIComponent(serverId)}`;
  if (kind === "host") return `${host}/${encodeURIComponent(slug)}`;
  if (kind === "plugin") {
    const [pluginId, screenId] = slug.split("/");
    if (!pluginId || !screenId) return null;
    return `${host}/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(screenId)}`;
  }
  return null;
}

export function settingsPageKind(key: string): SettingsPageKind | null {
  const kind = key.slice(0, key.indexOf(":"));
  return kind === "section" || kind === "host" || kind === "plugin" ? kind : null;
}

// ---------------------------------------------------------------------------
// Text hygiene
// ---------------------------------------------------------------------------

// Zero-width space/joiners and BOM, built from code points so this file holds no invisible text.
const INVISIBLE = new RegExp(
  `[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200d)}${String.fromCharCode(0xfeff)}]`,
  "g",
);

export function normalizeSettingsText(text: string | null | undefined): string {
  return (text ?? "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/**
 * Whether a rendered string is worth indexing. Values, not labels, are dropped: paths, URLs,
 * versions, host:port, ids and bare numbers change per machine and never name a setting.
 */
export function isIndexableSettingsText(raw: string | null | undefined): boolean {
  const text = normalizeSettingsText(raw);
  if (text.length < 2 || text.length > MAX_TEXT_LENGTH) return false;
  if (!/\p{L}/u.test(text)) return false;
  if (/^[~/]/.test(text) || /^[A-Za-z]:\\/.test(text)) return false;
  if (/:\/\//.test(text)) return false;
  if (/^v?\d+(\.\d+)+\S*$/i.test(text)) return false;
  if (/^[\w.-]+:\d+$/.test(text)) return false;
  if (/^(pid|id)\s*[:#]?\s*\d+$/i.test(text)) return false;
  if (!/\s/.test(text) && /[/\\]/.test(text)) return false;
  if (!/\s/.test(text) && text.length > 24 && /\d/.test(text)) return false;
  return true;
}

/** Keeps the first copy of each title in a page, drops noise, caps the page. */
export function cleanSettingsEntries(
  entries: readonly SettingsSearchEntry[],
  max = 200,
): SettingsSearchEntry[] {
  const seen = new Set<string>();
  const out: SettingsSearchEntry[] = [];
  for (const entry of entries) {
    const title = normalizeSettingsText(entry.title);
    if (!isIndexableSettingsText(title)) continue;
    const id = title.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const hint = normalizeSettingsText(entry.hint);
    const group = normalizeSettingsText(entry.group);
    out.push({
      title,
      ...(hint && hint !== title && isIndexableSettingsText(hint) ? { hint } : {}),
      ...(group && group !== title ? { group } : {}),
    });
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/**
 * A page read from the live screen replaces the shipped copy of that page; pages only the
 * seed knows stay. Order: seed order (which follows the sidebar), then live-only pages.
 */
export function mergeSettingsIndex(
  seedPages: readonly SettingsSearchPage[],
  livePages: readonly SettingsSearchPage[],
): SettingsSearchPage[] {
  const live = new Map(livePages.map((page) => [page.key, page]));
  const merged = seedPages.map((page) => live.get(page.key) ?? page);
  const seedKeys = new Set(seedPages.map((page) => page.key));
  for (const page of livePages) {
    if (!seedKeys.has(page.key)) merged.push(page);
  }
  return merged;
}

export function countSettingsEntries(pages: readonly SettingsSearchPage[]): number {
  return pages.reduce((sum, page) => sum + page.entries.length, 0);
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface SettingsSearchResult {
  /** Stable id within one index: `<pageKey>#<title>` (`<pageKey>` alone for a page). */
  id: string;
  kind: "page" | "setting";
  pageKey: string;
  pageLabel: string;
  title: string;
  hint?: string;
  group?: string;
  /**
   * Where every query token was found. 0 = the title alone, 1 = title plus its page and group,
   * 2 = the hint was needed. Lower ranks first, before the match score.
   */
  field: 0 | 1 | 2;
  score: MatchScore;
  typo: boolean;
  source: "seed" | "live";
  titleRanges: MatchRange[];
  hintRanges: MatchRange[];
}

export interface SettingsSearchOptions {
  limit?: number;
  /** Forgive typos. Default: only when the exact pass finds nothing. */
  typoTolerant?: boolean | "fallback";
}

function rankEntry(
  query: string,
  title: string,
  context: string[],
  hint: string | undefined,
  typoTolerant: boolean,
): { field: 0 | 1 | 2; score: MatchScore } | null {
  const options = { typoTolerant };
  const inTitle = scoreTextFields(query, [title], options);
  if (inTitle) return { field: 0, score: inTitle };
  const inContext = scoreTextFields(query, [title, ...context], options);
  if (inContext) return { field: 1, score: inContext };
  if (!hint) return null;
  const inHint = scoreTextFields(query, [title, hint, ...context], options);
  return inHint ? { field: 2, score: inHint } : null;
}

/** Marked spans for each query token in `text`, merged and sorted. */
export function settingsHighlightRanges(
  query: string,
  text: string,
  typoTolerant = false,
): MatchRange[] {
  const ranges: MatchRange[] = [];
  for (const token of tokenizeQuery(query)) {
    const score = scoreMatch(token, text, {
      fuzzy: typoTolerant ? fuzzyPolicyForToken(token) : null,
    });
    if (score) ranges.push(...matchRanges(token, text, score));
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: MatchRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.start + last.length) {
      const end = Math.max(last.start + last.length, range.start + range.length);
      last.length = end - last.start;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function runSearch(
  pages: readonly SettingsSearchPage[],
  query: string,
  typoTolerant: boolean,
): SettingsSearchResult[] {
  const results: Array<SettingsSearchResult & { order: number }> = [];
  const seen = new Set<string>();
  let order = 0;
  for (const page of pages) {
    const pageRank = rankEntry(query, page.label, [], undefined, typoTolerant);
    if (pageRank) {
      seen.add(page.key);
      results.push({
        id: page.key,
        kind: "page",
        pageKey: page.key,
        pageLabel: page.label,
        title: page.label,
        field: pageRank.field,
        score: pageRank.score,
        typo: typoTolerant,
        source: page.source,
        titleRanges: [],
        hintRanges: [],
        order: order++,
      });
    }
    for (const entry of page.entries) {
      const id = `${page.key}#${entry.title}`;
      if (seen.has(id)) continue;
      const context = [entry.group ?? "", page.label].filter(Boolean);
      const rank = rankEntry(query, entry.title, context, entry.hint, typoTolerant);
      if (!rank) continue;
      seen.add(id);
      results.push({
        id,
        kind: "setting",
        pageKey: page.key,
        pageLabel: page.label,
        title: entry.title,
        ...(entry.hint ? { hint: entry.hint } : {}),
        ...(entry.group ? { group: entry.group } : {}),
        field: rank.field,
        score: rank.score,
        typo: typoTolerant,
        source: page.source,
        titleRanges: [],
        hintRanges: [],
        order: order++,
      });
    }
  }
  results.sort(
    (a, b) =>
      a.field - b.field ||
      compareMatchScores(a.score, b.score) ||
      (a.kind === b.kind ? 0 : a.kind === "page" ? -1 : 1) ||
      a.order - b.order,
  );
  return results.map(({ order: _order, ...result }) => result);
}

export function searchSettingsIndex(
  pages: readonly SettingsSearchPage[],
  rawQuery: string,
  options: SettingsSearchOptions = {},
): SettingsSearchResult[] {
  const query = normalizeSettingsText(rawQuery);
  if (tokenizeQuery(query).length === 0) return [];
  const limit = options.limit ?? 40;
  const mode = options.typoTolerant ?? "fallback";
  let results = runSearch(pages, query, mode === true);
  if (results.length === 0 && mode === "fallback" && query.replace(/\s/g, "").length >= 3) {
    results = runSearch(pages, query, true);
  }
  return results.slice(0, limit).map((result) => ({
    ...result,
    titleRanges: settingsHighlightRanges(query, result.title, result.typo),
    hintRanges: result.hint ? settingsHighlightRanges(query, result.hint, result.typo) : [],
  }));
}

/** "Overview › Daemon" — where a result lives, for a result row's second line. */
export function settingsResultBreadcrumb(result: SettingsSearchResult): string {
  if (result.kind === "page") return "";
  return result.group ? `${result.pageLabel} › ${result.group}` : result.pageLabel;
}
