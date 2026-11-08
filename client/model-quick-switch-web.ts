/// <reference lib="dom" />
/**
 * Model Quick Switch — `⌘/` (`Ctrl+/`) opens the composer's native "Change model"
 * selector, then `1`–`9` picks the Nth row.
 *
 * Paseo v0.15.3 has no keyboard path into `CombinedModelSelector` and the plugin SDK
 * has no shortcut API, so this drives the native selector through its stable test ids
 * (upstream `components/combined-model-selector.tsx` + `components/model-browser.tsx`):
 *   trigger  `combined-model-selector`
 *   search   `model-search-all-input` (all providers) | `model-search-input` (one provider)
 *   rows     `model-profile-row-<id>` | `model-row-<provider>-<model>` | `model-provider-<id>`
 * Numbers follow the rows in the order the selector renders them, so `1`–`4` are the
 * profiles in the order shown, and a provider row drills in (then `1`–`9` again).
 *
 * Selection always goes through the native row press, so Paseo applies the model or
 * profile with its own logic. Every action writes a receipt; a pick is confirmed by
 * reading the trigger label back afterwards (能读 / 能试 / 能调 in Settings).
 */

export type ModelQuickSwitchDigitMode = "empty-search" | "modifier-only";

export interface ModelQuickSwitchPrefs {
  enabled: boolean;
  digitMode: ModelQuickSwitchDigitMode;
}

export type ModelQuickSwitchTrigger = "open" | "close" | "pick" | "no-trigger" | "self-test";

export interface ModelQuickSwitchReceipt {
  at: string;
  trigger: ModelQuickSwitchTrigger;
  ok: boolean;
  outcome: string;
}

export type ModelPickerRowKind = "profile" | "model" | "provider";

export interface ModelPickerRowInfo {
  index: number;
  kind: ModelPickerRowKind;
  id: string;
  label: string;
}

export interface ModelQuickSwitchStatus {
  prefs: ModelQuickSwitchPrefs;
  installed: boolean;
  triggersVisible: number;
  currentModel: string | null;
  pickerOpen: boolean;
  rows: ModelPickerRowInfo[];
  receipts: ModelQuickSwitchReceipt[];
}

export const MODEL_SELECTOR_TRIGGER_TESTID = "combined-model-selector";
export const MODEL_SEARCH_TESTIDS: readonly string[] = ["model-search-all-input", "model-search-input"];
export const MODEL_ROW_PREFIXES: ReadonlyArray<readonly [string, ModelPickerRowKind]> = [
  ["model-profile-row-", "profile"],
  ["model-row-", "model"],
  ["model-provider-", "provider"],
];
export const MAX_NUMBERED_ROWS = 9;
export const MODEL_QUICK_SWITCH_EVENT = "paseo-finder:model-quick-switch";

const PREFS_STORAGE_KEY = "paseo:finder-plugin:model-quick-switch";
const RECEIPTS_STORAGE_KEY = "paseo:finder-plugin:model-quick-switch-receipts";
const MAX_RECEIPTS = 15;
const INDEX_ATTR = "data-paseo-finder-model-index";
const STYLE_ID = "paseo-finder-model-quick-switch-style";
/** Code editors and terminals keep their own `⌘/` (toggle comment). */
const FOREIGN_SLASH_OWNERS = [".cm-editor", ".monaco-editor", ".xterm"];
const READ_BACK_DELAY_MS = 450;
const OPEN_CHECK_DELAY_MS = 250;

const DEFAULT_PREFS: ModelQuickSwitchPrefs = { enabled: true, digitMode: "empty-search" };

let installedOwner: object | null = null;
let activeOpen: (() => boolean) | null = null;

// ---------------------------------------------------------------------------
// Preferences + receipts (localStorage mirror of host-scoped plugin settings)
// ---------------------------------------------------------------------------

export function normalizeModelQuickSwitchPrefs(raw: unknown): ModelQuickSwitchPrefs {
  const value = raw && typeof raw === "object" ? (raw as Partial<ModelQuickSwitchPrefs>) : {};
  return {
    enabled: value.enabled !== false,
    digitMode: value.digitMode === "modifier-only" ? "modifier-only" : "empty-search",
  };
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readModelQuickSwitchPrefs(): ModelQuickSwitchPrefs {
  const store = storage();
  if (!store) return { ...DEFAULT_PREFS };
  try {
    const raw = store.getItem(PREFS_STORAGE_KEY);
    return normalizeModelQuickSwitchPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function syncModelQuickSwitchPrefs(prefs: Partial<ModelQuickSwitchPrefs>): ModelQuickSwitchPrefs {
  const next = normalizeModelQuickSwitchPrefs({ ...readModelQuickSwitchPrefs(), ...prefs });
  try {
    storage()?.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  return next;
}

export function readModelQuickSwitchReceipts(): ModelQuickSwitchReceipt[] {
  try {
    const raw = storage()?.getItem(RECEIPTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as ModelQuickSwitchReceipt[]).slice(0, MAX_RECEIPTS) : [];
  } catch {
    return [];
  }
}

export function recordModelQuickSwitchReceipt(
  trigger: ModelQuickSwitchTrigger,
  ok: boolean,
  outcome: string,
): ModelQuickSwitchReceipt {
  const receipt: ModelQuickSwitchReceipt = { at: new Date().toISOString(), trigger, ok, outcome };
  try {
    const next = [receipt, ...readModelQuickSwitchReceipts()].slice(0, MAX_RECEIPTS);
    storage()?.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(MODEL_QUICK_SWITCH_EVENT, { detail: receipt }));
    }
  } catch {
    // CustomEvent unavailable in some test environments
  }
  return receipt;
}

// ---------------------------------------------------------------------------
// Keyboard classification
// ---------------------------------------------------------------------------

interface KeyLike {
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}

export function isMacPlatform(nav?: { platform?: string; userAgent?: string } | null): boolean {
  const source = nav ?? (typeof navigator !== "undefined" ? navigator : null);
  if (!source) return true;
  return /mac|iphone|ipad/i.test(`${source.platform ?? ""} ${source.userAgent ?? ""}`);
}

/** `⌘/` on macOS, `Ctrl+/` elsewhere. Matched on the physical key so layouts agree. */
export function isModelQuickSwitchChord(event: KeyLike, isMac: boolean): boolean {
  if (event.isComposing || event.altKey || event.shiftKey) return false;
  const primary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!primary) return false;
  return event.code === "Slash" || event.code === "NumpadDivide" || (!event.code && event.key === "/");
}

/** 1–9 from the digit row or the numpad; null for anything else. */
export function digitFromKeyEvent(event: KeyLike): number | null {
  if (event.isComposing) return null;
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code ?? "");
  if (match) return Number(match[1]);
  if (!event.code && event.key && /^[1-9]$/.test(event.key)) return Number(event.key);
  return null;
}

export function resolveDigitAction(input: {
  event: KeyLike;
  digitMode: ModelQuickSwitchDigitMode;
  searchValue: string;
  isMac: boolean;
}): number | null {
  const { event, digitMode, searchValue, isMac } = input;
  if (event.altKey || event.shiftKey) return null;
  const digit = digitFromKeyEvent(event);
  if (digit === null) return null;
  const withModifier = isMac ? Boolean(event.metaKey) : Boolean(event.ctrlKey);
  if (withModifier) return digit;
  if (event.metaKey || event.ctrlKey) return null;
  if (digitMode === "modifier-only") return null;
  return searchValue.length === 0 ? digit : null;
}

// ---------------------------------------------------------------------------
// DOM discovery (attribute selectors only, so tests can use flat fakes)
// ---------------------------------------------------------------------------

interface ElementLike {
  getAttribute(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  contains?(other: unknown): boolean;
  closest?(selector: string): unknown;
  parentElement?: ElementLike | null;
  getClientRects?(): { length: number };
  getBoundingClientRect?(): { left: number; top: number; width: number; height: number };
  click?(): void;
  textContent?: string | null;
  value?: string;
  isConnected?: boolean;
  querySelector?(selector: string): ElementLike | null;
}

interface DocLike {
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
  querySelector?(selector: string): ElementLike | null;
  activeElement?: ElementLike | null;
}

interface ScopeLike {
  querySelectorAll?(selector: string): ArrayLike<ElementLike>;
  querySelector?(selector: string): ElementLike | null;
}

export interface OpenModelPicker {
  container: ElementLike;
  searchInput: ElementLike;
}

const TRIGGER_SELECTOR = `[data-testid="${MODEL_SELECTOR_TRIGGER_TESTID}"]`;
const SEARCH_SELECTOR = MODEL_SEARCH_TESTIDS.map((id) => `[data-testid="${id}"]`).join(",");
const ROW_SELECTOR = MODEL_ROW_PREFIXES.map(([prefix]) => `[data-testid^="${prefix}"]`).join(",");

function isVisible(el: ElementLike): boolean {
  if (el.isConnected === false) return false;
  return typeof el.getClientRects === "function" ? el.getClientRects().length > 0 : true;
}

function all(scope: ScopeLike | DocLike, selector: string): ElementLike[] {
  return typeof scope.querySelectorAll === "function" ? Array.from(scope.querySelectorAll(selector)) : [];
}

function rowKindFor(testId: string): ModelPickerRowKind | null {
  for (const [prefix, kind] of MODEL_ROW_PREFIXES) {
    if (testId.startsWith(prefix)) return kind;
  }
  return null;
}

export function findModelSelectorTriggers(doc: DocLike): ElementLike[] {
  return all(doc, TRIGGER_SELECTOR).filter(isVisible);
}

export function findOpenModelPicker(doc: DocLike): OpenModelPicker | null {
  const searchInput = all(doc, SEARCH_SELECTOR).find(isVisible);
  if (!searchInput) return null;
  let container: ElementLike | null = searchInput.parentElement ?? null;
  for (let depth = 0; container && depth < 16; depth += 1) {
    const box = container;
    if (box.getAttribute("role") === "dialog" || all(box as ScopeLike, ROW_SELECTOR).length > 0) {
      return { container: box, searchInput };
    }
    container = box.parentElement ?? null;
  }
  return null;
}

/** Rows in the order the selector renders them: profiles, then models or providers. */
export function listModelPickerRows(picker: OpenModelPicker): ElementLike[] {
  return all(picker.container as ScopeLike, ROW_SELECTOR).filter(isVisible);
}

function rowTexts(row: ElementLike): string[] {
  return all(row as ScopeLike, '[dir="auto"]')
    .map((el) => (el.textContent ?? "").trim())
    .filter((text) => text.length > 0);
}

export function describeModelPickerRow(row: ElementLike, index: number): ModelPickerRowInfo {
  const testId = row.getAttribute("data-testid") ?? "";
  const kind = rowKindFor(testId) ?? "model";
  const prefix = MODEL_ROW_PREFIXES.find(([, k]) => k === kind)?.[0] ?? "";
  const label = rowTexts(row)[0] ?? (row.textContent ?? "").trim();
  return { index, kind, id: testId.slice(prefix.length), label };
}

/** Model label a pick should leave on the trigger, when it can be known in advance. */
export function expectedTriggerLabel(row: ElementLike, info: ModelPickerRowInfo): string | null {
  if (info.kind === "model") return info.label || null;
  if (info.kind !== "profile") return null;
  // Profile description reads "<Provider> · <Model label> · <Mode> ...".
  const description = rowTexts(row)[1] ?? "";
  const parts = description.split(" · ").map((part) => part.trim());
  return parts.length >= 2 && parts[1] ? parts[1] : null;
}

/**
 * Verdict for a pick from the trigger label read back afterwards. An unknown expectation is
 * only a success when the label visibly changed; re-picking the current model says so.
 */
export function judgePick(input: {
  expected: string | null;
  before: string | null;
  after: string | null;
}): { ok: boolean; note: string } {
  const { expected, before, after } = input;
  if (!after) return { ok: false, note: " (selector label unreadable)" };
  if (expected) {
    if (after !== expected && !after.startsWith(expected) && !after.endsWith(expected)) {
      return { ok: false, note: ` (expected "${expected}")` };
    }
    return { ok: true, note: before === after ? " (already selected)" : "" };
  }
  return before !== after
    ? { ok: true, note: "" }
    : { ok: false, note: " (unverified: label unchanged)" };
}

/**
 * The trigger in the pane that holds focus; else the one the picker hangs from; else the
 * first. An ancestor that holds several triggers is a shared layout node, so the walk stops.
 */
export function pickModelSelectorTrigger(
  doc: DocLike,
  anchor?: ElementLike | null,
  lastFocused?: ElementLike | null,
): ElementLike | null {
  const triggers = findModelSelectorTriggers(doc);
  if (triggers.length <= 1) return triggers[0] ?? null;
  // An open picker names its own trigger; focus inside it says nothing about panes.
  const starts = anchor ? [] : [doc.activeElement ?? null, lastFocused ?? null];
  for (const start of starts) {
    for (let node = start; node; node = node.parentElement ?? null) {
      const hits = triggers.filter((trigger) => node?.contains?.(trigger));
      if (hits.length === 1) return hits[0] ?? null;
      if (hits.length > 1) break;
    }
  }
  const rect = anchor?.getBoundingClientRect?.();
  if (rect) {
    const distance = (el: ElementLike) => {
      const r = el.getBoundingClientRect?.();
      if (!r) return Number.POSITIVE_INFINITY;
      return Math.hypot(r.left - rect.left, r.top - (rect.top + rect.height));
    };
    return [...triggers].sort((a, b) => distance(a) - distance(b))[0] ?? null;
  }
  return triggers[0] ?? null;
}

function triggerLabel(trigger: ElementLike | null): string | null {
  const text = (trigger?.textContent ?? "").trim();
  return text.length > 0 ? text : null;
}

function isDisabled(el: ElementLike): boolean {
  return el.getAttribute("aria-disabled") === "true" || el.getAttribute("disabled") !== null;
}

/** A modal other than the model picker (Command Center, settings sheets, confirms) owns the keys. */
function otherModalOpen(doc: DocLike): boolean {
  return all(doc, '[aria-modal="true"]').some(isVisible);
}

function insideForeignSlashOwner(target: unknown): boolean {
  const el = target as ElementLike | null;
  if (!el || typeof el.closest !== "function") return false;
  return FOREIGN_SLASH_OWNERS.some((selector) => Boolean(el.closest?.(selector)));
}

// ---------------------------------------------------------------------------
// Number hints (attribute + one stylesheet; no nodes inserted into React trees)
// ---------------------------------------------------------------------------

function ensureHintStyle(doc: Document): void {
  if (doc.getElementById?.(STYLE_ID) || !doc.head) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
[${INDEX_ATTR}] { padding-right: 36px !important; }
[${INDEX_ATTR}]::after {
  content: attr(${INDEX_ATTR});
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 500; line-height: 1; font-variant-numeric: tabular-nums;
  color: var(--paseo-finder-fg-muted, currentColor);
  border: 1px solid var(--paseo-finder-border, rgba(127,127,127,0.35));
  border-radius: 5px; pointer-events: none;
}`;
  doc.head.appendChild(style);
}

export function hintLabelFor(index: number, searchValue: string, prefs: ModelQuickSwitchPrefs, isMac: boolean): string {
  const plain = prefs.digitMode === "empty-search" && searchValue.length === 0;
  if (plain) return String(index);
  return isMac ? `⌘${index}` : `Ctrl ${index}`;
}

/** Writes only when a hint changes; returns how many rows carry a hint. */
export function applyRowHints(
  doc: DocLike,
  picker: OpenModelPicker | null,
  prefs: ModelQuickSwitchPrefs,
  isMac: boolean,
): number {
  const rows = picker && prefs.enabled ? listModelPickerRows(picker).slice(0, MAX_NUMBERED_ROWS) : [];
  const wanted = new Map<ElementLike, string>();
  const searchValue = picker?.searchInput.value ?? "";
  rows.forEach((row, i) => wanted.set(row, hintLabelFor(i + 1, searchValue, prefs, isMac)));
  for (const el of Array.from(doc.querySelectorAll(`[${INDEX_ATTR}]`))) {
    if (!wanted.has(el)) el.removeAttribute?.(INDEX_ATTR);
  }
  for (const [row, label] of wanted) {
    if (row.getAttribute(INDEX_ATTR) !== label) row.setAttribute?.(INDEX_ATTR, label);
  }
  return wanted.size;
}

// ---------------------------------------------------------------------------
// Status + self-test (能读 / 能试)
// ---------------------------------------------------------------------------

export function getModelQuickSwitchStatus(docOverride?: DocLike | null): ModelQuickSwitchStatus {
  const doc = docOverride ?? (typeof document !== "undefined" ? (document as unknown as DocLike) : null);
  const picker = doc ? findOpenModelPicker(doc) : null;
  const rows = picker ? listModelPickerRows(picker).slice(0, MAX_NUMBERED_ROWS) : [];
  return {
    prefs: readModelQuickSwitchPrefs(),
    installed: installedOwner !== null,
    triggersVisible: doc ? findModelSelectorTriggers(doc).length : 0,
    currentModel: doc ? triggerLabel(pickModelSelectorTrigger(doc)) : null,
    pickerOpen: Boolean(picker),
    rows: rows.map((row, i) => describeModelPickerRow(row, i + 1)),
    receipts: readModelQuickSwitchReceipts(),
  };
}

export function runModelQuickSwitchSelfTest(docOverride?: DocLike | null): ModelQuickSwitchStatus {
  const status = getModelQuickSwitchStatus(docOverride);
  const shortcut = isMacPlatform() ? "⌘/" : "Ctrl+/";
  const parts = [
    `enabled=${status.prefs.enabled}`,
    `digits=${status.prefs.digitMode}`,
    `installed=${status.installed}`,
    `selectors on screen=${status.triggersVisible}`,
  ];
  const ok = status.installed && status.prefs.enabled;
  recordModelQuickSwitchReceipt(
    "self-test",
    ok,
    status.triggersVisible > 0
      ? `${parts.join(" · ")} · ${shortcut} opens "${status.currentModel ?? "?"}"`
      : `${parts.join(" · ")} (open a chat, then press ${shortcut})`,
  );
  return { ...status, receipts: readModelQuickSwitchReceipts() };
}

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------

export interface ModelQuickSwitchHandle {
  (): void;
  reconcileNow?: () => void;
  openNow?: () => boolean;
}

export function installModelQuickSwitch(docOverride?: Document | null): ModelQuickSwitchHandle {
  const doc = docOverride ?? (typeof document !== "undefined" ? document : null);
  const win = doc?.defaultView ?? (typeof window !== "undefined" ? window : null);
  if (!doc || !doc.body || !win) return () => {};
  const dom = doc as unknown as DocLike;
  const isMac = isMacPlatform(win.navigator);
  let lastTrigger: ElementLike | null = null;
  let lastFocused: ElementLike | null = null;
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const id = win.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  let pickerObserver: MutationObserver | null = null;
  let observedContainer: ElementLike | null = null;
  let frame = 0;

  const reconcile = () => {
    frame = 0;
    const prefs = readModelQuickSwitchPrefs();
    const picker = findOpenModelPicker(dom);
    if (picker) ensureHintStyle(doc);
    else lastTrigger = null; // a later mouse-opened picker must not inherit it
    applyRowHints(dom, picker, prefs, isMac);
    if (picker?.container !== observedContainer) {
      pickerObserver?.disconnect();
      observedContainer = picker?.container ?? null;
      if (picker && typeof MutationObserver !== "undefined") {
        pickerObserver = new MutationObserver(schedule);
        pickerObserver.observe(picker.container as unknown as Node, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["data-testid"],
        });
      }
    }
  };
  function schedule() {
    if (frame) return;
    frame = typeof win!.requestAnimationFrame === "function" ? win!.requestAnimationFrame(reconcile) : 0;
    if (!frame) reconcile();
  }

  const liveTrigger = (picker: OpenModelPicker | null): ElementLike | null =>
    lastTrigger && lastTrigger.isConnected !== false
      ? lastTrigger
      : pickModelSelectorTrigger(dom, picker?.container ?? null, lastFocused);

  const open = (): boolean => {
    const trigger = pickModelSelectorTrigger(dom, null, lastFocused);
    if (!trigger || isDisabled(trigger)) {
      recordModelQuickSwitchReceipt(
        "no-trigger",
        false,
        trigger ? "Model selector is disabled here." : "No model selector on this screen.",
      );
      return false;
    }
    lastTrigger = trigger;
    const label = triggerLabel(trigger) ?? "?";
    trigger.click?.();
    schedule();
    later(() => {
      const opened = Boolean(findOpenModelPicker(dom));
      recordModelQuickSwitchReceipt(
        "open",
        opened,
        opened ? `Opened selector on "${label}".` : `Selector on "${label}" did not open (disabled?).`,
      );
    }, OPEN_CHECK_DELAY_MS);
    return true;
  };

  const close = (picker: OpenModelPicker) => {
    const trigger = liveTrigger(picker);
    trigger?.click?.();
    lastTrigger = null;
    recordModelQuickSwitchReceipt("close", Boolean(trigger), trigger ? "Closed selector." : "No trigger to close.");
  };

  const pick = (picker: OpenModelPicker, index: number): boolean => {
    const rows = listModelPickerRows(picker);
    const row = rows[index - 1];
    if (!row) return false;
    const info = describeModelPickerRow(row, index);
    const trigger = liveTrigger(picker);
    const before = triggerLabel(trigger);
    const expected = expectedTriggerLabel(row, info);
    row.click?.();
    if (info.kind === "provider") {
      recordModelQuickSwitchReceipt("pick", true, `#${index} opened provider "${info.label}".`);
      schedule();
      return true;
    }
    lastTrigger = null;
    later(() => {
      // Independent read-back: the trigger label Paseo renders after applying the pick.
      const after = triggerLabel(trigger?.isConnected === false ? pickModelSelectorTrigger(dom) : trigger);
      const verdict = judgePick({ expected, before, after });
      recordModelQuickSwitchReceipt(
        "pick",
        verdict.ok,
        `#${index} ${info.kind} "${info.label}": "${before ?? "?"}" → "${after ?? "?"}"${verdict.note}`,
      );
    }, READ_BACK_DELAY_MS);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const isChord = isModelQuickSwitchChord(event, isMac);
    // Cheap key test first: typing never pays for a DOM query.
    if (!isChord && digitFromKeyEvent(event) === null) return;
    const prefs = readModelQuickSwitchPrefs();
    if (!prefs.enabled) return;
    const picker = findOpenModelPicker(dom);
    if (isChord) {
      if (!picker) {
        if (insideForeignSlashOwner(event.target) || otherModalOpen(dom)) return;
        if (findModelSelectorTriggers(dom).length === 0) return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.repeat) return; // holding ⌘/ must not flap the picker
      if (picker) close(picker);
      else open();
      return;
    }
    if (!picker) return;
    // Digits count only while focus is inside the picker, not in a sheet opened from it.
    if (picker.container.contains?.(event.target) !== true) return;
    const index = resolveDigitAction({
      event,
      digitMode: prefs.digitMode,
      searchValue: picker.searchInput.value ?? "",
      isMac,
    });
    if (index === null) return;
    // Swallow ⌘1–⌘9 even without a row, so it never jumps workspaces behind the picker.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.repeat) return; // holding a digit must not drill in and pick in one go
    pick(picker, index);
  };

  const onFocusOrInput = (event: Event) => {
    const target = event.target as ElementLike | null;
    const testId = target?.getAttribute?.("data-testid") ?? "";
    if (MODEL_SEARCH_TESTIDS.includes(testId) || observedContainer) {
      schedule();
      return;
    }
    // Typing elsewhere costs nothing; focus is remembered to pick the right pane later.
    if (event.type === "focusin" && target) lastFocused = target;
  };

  win.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("focusin", onFocusOrInput, true);
  doc.addEventListener("input", onFocusOrInput, true);
  const owner = {};
  installedOwner = owner;
  activeOpen = open;
  schedule();

  const cleanup = () => {
    if (installedOwner === owner) installedOwner = null;
    if (activeOpen === open) activeOpen = null;
    for (const id of timers) win.clearTimeout(id);
    timers.clear();
    win.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("focusin", onFocusOrInput, true);
    doc.removeEventListener("input", onFocusOrInput, true);
    pickerObserver?.disconnect();
    if (frame && typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(frame);
    applyRowHints(dom, null, readModelQuickSwitchPrefs(), isMac);
    doc.getElementById?.(STYLE_ID)?.remove();
  };
  return Object.assign(cleanup, { reconcileNow: reconcile, openNow: open });
}

/** Open the focused composer's selector from outside a key event (Command Center item). */
export function openModelQuickSwitch(): boolean {
  return activeOpen ? activeOpen() : false;
}
