import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSettingsPath,
  cleanSettingsEntries,
  isIndexableSettingsText,
  mergeSettingsIndex,
  normalizeSettingsText,
  parseSettingsRoute,
  searchSettingsIndex,
  settingsResultBreadcrumb,
  type SettingsSearchPage,
} from "../shared/settings-search";
import { SETTINGS_SEARCH_SEED } from "../shared/settings-search-seed";
import { harvestSettingsDetailPane } from "../client/settings-search-harvest";
import {
  getSettingsSearchStatus,
  learnCurrentSettingsPage,
  querySettingsIndex,
  readLiveSettingsPages,
  resetLearnedSettingsPages,
  runSettingsSearchSelfTest,
} from "../client/settings-search-web";
import { pluginSettings } from "../shared/contracts";

// Live pages and receipts live in localStorage; give this process an in-memory one.
const memory = new Map<string, string>();
const fakeWindow = {
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  },
  dispatchEvent: () => true,
  location: { pathname: "/settings/general", search: "" },
};
(globalThis as Record<string, unknown>).window = fakeWindow;

// ---------------------------------------------------------------------------
// A tiny DOM: enough of Element for the harvester (measured shapes from v0.15.3).
// ---------------------------------------------------------------------------

type Style = { fontSize: number; color: string };
const FG = "rgb(26, 26, 30)";
const MUTED = "rgb(113, 113, 122)";

class FakeEl {
  parentElement: FakeEl | null = null;
  children: FakeEl[] = [];
  ownerDocument = fakeDocument;
  tag: string;
  attrs: Record<string, string>;
  rect: { left: number; width: number; height: number };
  style: Style;
  text?: string;
  constructor(
    tag: string,
    attrs: Record<string, string>,
    rect: { left: number; width: number; height: number },
    style: Style = { fontSize: 14, color: FG },
    text?: string,
  ) {
    this.tag = tag;
    this.attrs = attrs;
    this.rect = rect;
    this.style = style;
    this.text = text;
  }
  append(...kids: FakeEl[]): this {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
    return this;
  }
  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const sel = part.trim();
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
      if (attr) return attr[2] === undefined ? attr[1] in this.attrs : this.attrs[attr[1]] === attr[2];
      return this.tag === sel;
    });
  }
  private descendants(): FakeEl[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  querySelectorAll(selector: string): FakeEl[] {
    return this.descendants().filter((el) => el.matches(selector));
  }
  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  closest(selector: string): FakeEl | null {
    for (let el: FakeEl | null = this; el; el = el.parentElement) if (el.matches(selector)) return el;
    return null;
  }
  get nextElementSibling(): FakeEl | null {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get previousElementSibling(): FakeEl | null {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }
  get textContent(): string {
    return this.text ?? this.children.map((child) => child.textContent).join("");
  }
  getBoundingClientRect() {
    return { left: this.rect.left, width: this.rect.width, height: this.rect.height, top: 0 };
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
}

const fakeDocument = {
  defaultView: {
    getComputedStyle: (el: FakeEl) => ({
      fontSize: `${el.style.fontSize}px`,
      color: el.style.color,
      visibility: "visible",
    }),
  },
};

const text = (value: string, fontSize: number, color: string, left: number, width = 300) =>
  new FakeEl("div", { dir: "auto" }, { left, width, height: 20 }, { fontSize, color }, value);
const box = (width = 980, height = 60) => new FakeEl("div", {}, { left: 540, width, height });
const button = (width: number, role = "button") =>
  new FakeEl("button", { role }, { left: 1500, width, height: 36 });

/** The host Overview page as v0.15.3 renders it (desktop), trimmed to the shapes that matter. */
function overviewPane(): FakeEl {
  const pane = new FakeEl("div", { "data-testid": "settings-detail-pane" }, { left: 520, width: 1100, height: 1400 });
  const daemonCard = box(980, 300).append(
    box().append(
      box(600).append(
        text("Keep daemon running after quit", 14, FG, 553),
        text("Daemon keeps running when you quit Paseo", 12, MUTED, 553),
      ),
      button(48, "switch"),
    ),
    box().append(
      box(600).append(
        text("Log file", 14, FG, 553),
        text("/Users/example/.paseo/daemon.log", 12, MUTED, 553),
      ),
      button(150).append(text("Copy path", 14, FG, 1520, 90)),
    ),
  );
  const dangerCard = box(980, 200).append(
    box().append(
      box(600).append(text("Restart and also close every terminal running on this host.", 12, MUTED, 553)),
      button(240).append(text("Restart and close terminals", 14, FG, 1380, 200)),
    ),
    // A whole-row pressable (Pair device): its title still names a setting.
    new FakeEl("div", { role: "button" }, { left: 540, width: 980, height: 60 }).append(
      box(600).append(
        text("Pair a device", 14, FG, 553),
        text("Use the mobile app to scan a QR code", 12, MUTED, 553),
      ),
    ),
  );
  // A small left-aligned button (a chip / segmented option) is a control, not a row title.
  const chipRow = box().append(button(90).append(text("Restart", 14, FG, 553, 60)));
  pane.append(
    text("Overview", 26, FG, 540, 160),
    chipRow,
    text("Name", 14, FG, 553),
    text("someone's MacBook Pro", 14, MUTED, 1047, 200),
    text("Daemon", 12, MUTED, 540, 60),
    daemonCard,
    text("Danger zone", 12, MUTED, 540, 90),
    dangerCard,
  );
  return pane;
}

function resetStorage() {
  memory.clear();
  resetLearnedSettingsPages();
  memory.clear();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

test("settings routes map to page keys and back", () => {
  assert.deepEqual(parseSettingsRoute("/settings/appearance"), {
    key: "section:appearance",
    kind: "section",
    slug: "appearance",
  });
  assert.deepEqual(parseSettingsRoute("/settings/hosts/srv_A/host?x=1"), {
    key: "host:host",
    kind: "host",
    slug: "host",
    serverId: "srv_A",
  });
  assert.equal(
    parseSettingsRoute("/settings/hosts/srv_A/plugins/file-inspector-finder/finder-settings")?.key,
    "plugin:file-inspector-finder/finder-settings",
  );
  // Per-record pages and non-settings routes are not settings pages.
  assert.equal(parseSettingsRoute("/settings/hosts/srv_A/projects/p1"), null);
  assert.equal(parseSettingsRoute("/settings/hosts/srv_A"), null);
  assert.equal(parseSettingsRoute("/h/srv_A/workspace/w1"), null);

  assert.equal(buildSettingsPath("section:chat"), "/settings/chat");
  assert.equal(buildSettingsPath("host:voice", "srv_A"), "/settings/hosts/srv_A/voice");
  assert.equal(buildSettingsPath("host:voice"), null, "host pages need a server id");
  assert.equal(
    buildSettingsPath("plugin:file-inspector-finder/finder-settings", "srv_A"),
    "/settings/hosts/srv_A/plugins/file-inspector-finder/finder-settings",
  );
  for (const page of SETTINGS_SEARCH_SEED.pages) {
    const path = buildSettingsPath(page.key, "srv_A");
    assert.ok(path, `seed key ${page.key} builds a route`);
    assert.equal(parseSettingsRoute(path!)?.key, page.key, `${page.key} round-trips`);
  }
});

// ---------------------------------------------------------------------------
// Text hygiene
// ---------------------------------------------------------------------------

test("values are not indexed, labels are", () => {
  for (const value of [
    "/Users/example/.paseo/daemon.log",
    "/Users/example/Library/Application Support/Paseo/daemon.log",
    "~/x",
    "https://paseo.sh",
    "v0.15.3",
    "0.15.3",
    "localhost:6767",
    "PID 42100",
    "42100",
    "srv_EXAMPLE00000/abc",
    "x",
    "a".repeat(200),
  ]) {
    assert.equal(isIndexableSettingsText(value), false, value);
  }
  for (const label of ["Log file", "Keep daemon running after quit", "Vim keybindings", ".png", "语言"]) {
    assert.equal(isIndexableSettingsText(label), true, label);
  }
  const zeroWidth = String.fromCharCode(0x200b);
  assert.equal(normalizeSettingsText(`  Log${zeroWidth}  file \n`), "Log file");
});

test("cleanSettingsEntries drops noise, value hints and duplicates", () => {
  const cleaned = cleanSettingsEntries([
    { title: "Log file", hint: "/Users/example/daemon.log", group: "Daemon" },
    { title: "Log  file", hint: "dup" },
    { title: "v0.15.3" },
    { title: "Name", hint: "Name", group: "Name" },
  ]);
  assert.deepEqual(cleaned, [{ title: "Log file", group: "Daemon" }, { title: "Name" }]);
});

// ---------------------------------------------------------------------------
// Index + ranking
// ---------------------------------------------------------------------------

const PAGES: SettingsSearchPage[] = [
  {
    key: "host:host",
    label: "Overview",
    source: "seed",
    entries: [
      { title: "Keep daemon running after quit", hint: "Daemon keeps running when you quit Paseo", group: "Daemon" },
      { title: "Log file", group: "Daemon" },
      { title: "Restart daemon", hint: "Restarts the daemon process", group: "Danger zone" },
    ],
  },
  {
    key: "section:general",
    label: "General",
    source: "seed",
    entries: [{ title: "Send shortcut", hint: "Which key sends a message", group: "Sending" }],
  },
  { key: "section:notifications", label: "Notifications", source: "seed", entries: [] },
];

test("live pages replace their seed copy; live-only pages are appended", () => {
  const live: SettingsSearchPage = { key: "host:host", label: "Overview", source: "live", entries: [{ title: "Name" }] };
  const plugin: SettingsSearchPage = { key: "plugin:a/b", label: "A", source: "live", entries: [] };
  const merged = mergeSettingsIndex(PAGES, [plugin, live]);
  assert.deepEqual(merged.map((p) => `${p.key}:${p.source}`), [
    "host:host:live",
    "section:general:seed",
    "section:notifications:seed",
    "plugin:a/b:live",
  ]);
});

test("ranking: title hits before page/group hits before hint hits", () => {
  const daemon = searchSettingsIndex(PAGES, "daemon");
  assert.deepEqual(
    daemon.map((r) => `${r.field}:${r.title}`),
    ["0:Keep daemon running after quit", "0:Restart daemon", "1:Log file"],
  );
  assert.equal(settingsResultBreadcrumb(daemon[0]), "Overview › Daemon");
  assert.deepEqual(daemon[0].titleRanges, [{ start: 5, length: 6 }]);

  const quit = searchSettingsIndex(PAGES, "keeps running quit");
  assert.equal(quit[0].title, "Keep daemon running after quit");

  const hint = searchSettingsIndex(PAGES, "which key");
  assert.equal(hint[0].title, "Send shortcut");
  assert.equal(hint[0].field, 2);
  assert.ok(hint[0].hintRanges.length > 0, "the hint carries the marks when it matched");

  const page = searchSettingsIndex(PAGES, "notif");
  assert.equal(page[0].kind, "page");
  assert.equal(page[0].title, "Notifications");

  assert.deepEqual(searchSettingsIndex(PAGES, "   "), []);
});

test("typos are forgiven only when nothing matches exactly", () => {
  const typo = searchSettingsIndex(PAGES, "dameon");
  assert.ok(typo.length > 0, "dameon finds daemon rows");
  assert.ok(typo.every((r) => r.typo));
  const exact = searchSettingsIndex(PAGES, "daemon");
  assert.ok(exact.every((r) => !r.typo));
  assert.deepEqual(searchSettingsIndex(PAGES, "dameon", { typoTolerant: false }), []);
});

// ---------------------------------------------------------------------------
// Harvest (what the plugin reads off the real screen)
// ---------------------------------------------------------------------------

test("harvest reads rows, hints and groups, not values or buttons", () => {
  const harvested = harvestSettingsDetailPane(overviewPane() as unknown as Element);
  assert.ok(harvested);
  assert.equal(harvested.label, "Overview");
  assert.deepEqual(harvested.entries, [
    { title: "Name" },
    { title: "Keep daemon running after quit", hint: "Daemon keeps running when you quit Paseo", group: "Daemon" },
    { title: "Log file", hint: "/Users/example/.paseo/daemon.log", group: "Daemon" },
    { title: "Restart and also close every terminal running on this host.", group: "Danger zone" },
    { title: "Pair a device", hint: "Use the mobile app to scan a QR code", group: "Danger zone" },
  ]);
  assert.equal(harvestSettingsDetailPane(null), null);
});

test("learning a page stores it live; a still-loading page never erases known rows", () => {
  resetStorage();
  fakeWindow.location.pathname = "/settings/hosts/srv_A/host";
  let pane = overviewPane();
  const doc = { querySelector: (sel: string) => (sel.includes("settings-detail-pane") ? pane : null) };
  const learned = learnCurrentSettingsPage(doc as unknown as Document, fakeWindow as unknown as Window);
  assert.ok(learned);
  assert.equal(learned.source, "live");
  assert.equal(learned.entries.length, 5);
  assert.equal(
    learned.entries.find((e) => e.title === "Log file")?.hint,
    undefined,
    "a path hint is a value, not copy",
  );
  const hit = querySettingsIndex("keep daemon")[0];
  assert.equal(hit.title, "Keep daemon running after quit");
  assert.equal(hit.source, "live");

  // Same page while loading: title only.
  pane = new FakeEl("div", {}, { left: 520, width: 1100, height: 400 }).append(text("Overview", 26, FG, 540));
  learnCurrentSettingsPage(doc as unknown as Document, fakeWindow as unknown as Window);
  assert.equal(readLiveSettingsPages().find((p) => p.key === "host:host")?.entries.length, 5);

  const status = getSettingsSearchStatus();
  assert.equal(status.live.pages, 1);
  assert.ok(status.receipts.some((r) => r.trigger === "learn" && r.outcome.includes("Overview: 5 rows")));
  assert.ok(!status.merged.seedOnlyPages.includes("Overview"));
  resetStorage();
});

test("self-test runs the real index and records a receipt", () => {
  resetStorage();
  const status = runSettingsSearchSelfTest("restart daemon");
  assert.ok(status.lastTest && status.lastTest.count > 0);
  assert.equal(status.lastTest.top[0].title, "Restart daemon");
  assert.ok(status.receipts[0].ok);
  const none = runSettingsSearchSelfTest("zzzz qqqq");
  assert.equal(none.lastTest?.count, 0);
  assert.equal(none.receipts[0].ok, false);
});

// ---------------------------------------------------------------------------
// The shipped seed
// ---------------------------------------------------------------------------

test("the shipped seed covers the settings screen and holds only UI copy", () => {
  const pages = SETTINGS_SEARCH_SEED.pages;
  const rows = pages.reduce((n, p) => n + p.entries.length, 0);
  console.log(`graded seed: ${pages.length} pages, ${rows} rows (Paseo ${SETTINGS_SEARCH_SEED.paseoVersion})`);
  assert.ok(pages.length >= 20, "a degenerate crawl must not ship");
  assert.ok(rows >= 60);
  const keys = new Set<string>();
  for (const page of pages) {
    assert.ok(!keys.has(page.key), `duplicate ${page.key}`);
    keys.add(page.key);
    assert.ok(page.label.trim(), `${page.key} has a label`);
    assert.equal(page.source, "seed");
    for (const entry of page.entries) {
      assert.ok(isIndexableSettingsText(entry.title), `${page.key}: ${entry.title}`);
      for (const value of [entry.title, entry.hint ?? "", entry.group ?? ""]) {
        for (const ch of value) {
          const code = ch.codePointAt(0) ?? 0;
          assert.ok(code >= 0x20 && !(code >= 0x200b && code <= 0x200f) && code !== 0xfeff, `invisible code point in ${page.key}`);
        }
      }
    }
  }
  // Per-record pages are searchable by name only: this machine's projects never ship.
  assert.deepEqual(pages.find((p) => p.key === "host:projects")?.entries, []);
  // The two pages the feature was asked for by name.
  assert.ok(keys.has("host:host") && keys.has("section:general"));
  assert.ok(searchSettingsIndex(pages, "restart daemon")[0]?.pageKey === "host:host");
});

test("plugin settings expose both switches, on by default", () => {
  const defaults = pluginSettings.schema.parse({});
  assert.equal(defaults.enableSettingsSearch, true);
  assert.equal(defaults.settingsSearchShortcut, true);
});
