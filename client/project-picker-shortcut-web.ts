/// <reference lib="dom" />
/**
 * Choose the Project Shortcut — configurable keyboard shortcut (default `⌥P` / `Alt+P`)
 * that opens Paseo's native "Choose the project" selector (`new-workspace-project-picker-trigger`)
 * directly while typing in the composer (`textarea[data-composer-input]`) or anywhere on the
 * New Workspace screen.
 *
 * When triggered from a composer input, focus moves into the searchable project Combobox
 * (`input[placeholder="Search projects"]`), and once a project is selected (or the picker
 * is dismissed via Escape / re-pressing the shortcut), focus returns cleanly to the composer
 * input so continuous keyboard authoring is never interrupted.
 *
 * All selection happens through Paseo's native trigger and Combobox. Every action records a
 * receipt in localStorage for Settings observability (`能读 / 能试 / 能调`).
 */

import type { ProjectPickerShortcutPreset } from "../shared/contracts";

export interface ProjectPickerShortcutPrefs {
  enabled: boolean;
  preset: ProjectPickerShortcutPreset;
  customShortcut: string;
}

export interface ParsedShortcutChord {
  mod: boolean;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  code: string;
  key: string;
  keyCode?: number;
  isNumpadDigit?: boolean;
  label: string;
}

export type ProjectPickerShortcutTrigger = "open" | "close" | "no-trigger" | "self-test";

export interface ProjectPickerShortcutReceipt {
  at: string;
  trigger: ProjectPickerShortcutTrigger;
  ok: boolean;
  outcome: string;
}

export interface OpenProjectPicker {
  container: ElementLike;
  searchInput: ElementLike | null;
}

export interface ProjectPickerShortcutStatus {
  prefs: ProjectPickerShortcutPrefs;
  activeSpec: string;
  activeChord: ParsedShortcutChord | null;
  displayShortcut: string;
  installed: boolean;
  triggersVisible: number;
  currentProject: string | null;
  pickerOpen: boolean;
  receipts: ProjectPickerShortcutReceipt[];
}

export const PROJECT_PICKER_TRIGGER_TESTID = "new-workspace-project-picker-trigger";
export const PROJECT_PICKER_OPTION_PREFIX = "new-workspace-project-picker-option-";
export const PROJECT_PICKER_ADD_TESTID = "new-workspace-project-picker-add-project";
export const PROJECT_PICKER_SEARCH_PLACEHOLDER = "Search projects";
export const PROJECT_PICKER_SHORTCUT_EVENT = "paseo-finder:project-picker-shortcut";

const PREFS_STORAGE_KEY = "paseo:finder-plugin:project-picker-shortcut";
const RECEIPTS_STORAGE_KEY = "paseo:finder-plugin:project-picker-shortcut-receipts";
const MAX_RECEIPTS = 15;
/** Code editors and terminals own their keybindings; composer inputs are explicitly allowed. */
const FOREIGN_OWNERS = [".cm-editor", ".monaco-editor", ".xterm"];
const OPEN_CHECK_DELAY_MS = 200;
const FOCUS_CHECK_DELAYS_MS = [35, 110, 210, 320];
const RESTORE_DELAY_MS = 35;

export const DEFAULT_PROJECT_PICKER_SHORTCUT_PREFS: ProjectPickerShortcutPrefs = {
  enabled: true,
  preset: "alt_p",
  customShortcut: "Alt+P",
};

const PRESET_TO_SPEC: Record<Exclude<ProjectPickerShortcutPreset, "custom">, string> = {
  alt_p: "Alt+P",
  cmd_shift_j: "Mod+Shift+J",
  cmd_alt_o: "Mod+Alt+O",
  cmd_p: "Mod+P",
};

const VALID_PRESETS = new Set<string>(["alt_p", "cmd_shift_j", "cmd_alt_o", "cmd_p", "custom"]);
const GLOBAL_PROJECT_PICKER_BRIDGE_KEY = "__paseoFinderProjectPickerShortcut";

let installedOwner: object | null = null;
let activeOpen: ((options?: { silentNoTrigger?: boolean }) => boolean) | null = null;

// ---------------------------------------------------------------------------
// Preferences + receipts (localStorage mirror of host-scoped plugin settings)
// ---------------------------------------------------------------------------

export function normalizeProjectPickerShortcutPrefs(raw: unknown): ProjectPickerShortcutPrefs {
  const value = raw && typeof raw === "object" ? (raw as Partial<ProjectPickerShortcutPrefs>) : {};
  const preset: ProjectPickerShortcutPreset =
    typeof value.preset === "string" && VALID_PRESETS.has(value.preset)
      ? (value.preset as ProjectPickerShortcutPreset)
      : DEFAULT_PROJECT_PICKER_SHORTCUT_PREFS.preset;
  const customShortcut =
    typeof value.customShortcut === "string" && value.customShortcut.trim().length > 0
      ? value.customShortcut.trim()
      : DEFAULT_PROJECT_PICKER_SHORTCUT_PREFS.customShortcut;
  return {
    enabled: value.enabled !== false,
    preset,
    customShortcut,
  };
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readProjectPickerShortcutPrefs(): ProjectPickerShortcutPrefs {
  const store = storage();
  if (!store) return { ...DEFAULT_PROJECT_PICKER_SHORTCUT_PREFS };
  try {
    const raw = store.getItem(PREFS_STORAGE_KEY);
    return normalizeProjectPickerShortcutPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PROJECT_PICKER_SHORTCUT_PREFS };
  }
}

export function syncProjectPickerShortcutPrefs(
  prefs: Partial<ProjectPickerShortcutPrefs>,
): ProjectPickerShortcutPrefs {
  const next = normalizeProjectPickerShortcutPrefs({
    ...readProjectPickerShortcutPrefs(),
    ...prefs,
  });
  try {
    storage()?.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(PROJECT_PICKER_SHORTCUT_EVENT, { detail: { type: "prefs", prefs: next } }));
    }
  } catch {
    // CustomEvent unavailable in some environments
  }
  return next;
}

export function readProjectPickerShortcutReceipts(): ProjectPickerShortcutReceipt[] {
  try {
    const raw = storage()?.getItem(RECEIPTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? (parsed as ProjectPickerShortcutReceipt[]).slice(0, MAX_RECEIPTS)
      : [];
  } catch {
    return [];
  }
}

export function recordProjectPickerShortcutReceipt(
  trigger: ProjectPickerShortcutTrigger,
  ok: boolean,
  outcome: string,
): ProjectPickerShortcutReceipt {
  const receipt: ProjectPickerShortcutReceipt = {
    at: new Date().toISOString(),
    trigger,
    ok,
    outcome,
  };
  try {
    const next = [receipt, ...readProjectPickerShortcutReceipts()].slice(0, MAX_RECEIPTS);
    storage()?.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(PROJECT_PICKER_SHORTCUT_EVENT, { detail: receipt }));
    }
  } catch {
    // CustomEvent unavailable in some test environments
  }
  return receipt;
}

// ---------------------------------------------------------------------------
// Shortcut parsing, formatting & capture
// ---------------------------------------------------------------------------

export interface KeyLike {
  key?: string;
  code?: string;
  keyCode?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
}

export function isMacPlatform(nav?: { platform?: string; userAgent?: string } | null): boolean {
  const source = nav ?? (typeof navigator !== "undefined" ? navigator : null);
  if (!source) return true;
  return /mac|iphone|ipad/i.test(`${source.platform ?? ""} ${source.userAgent ?? ""}`);
}

const SPECIAL_KEY_MAP: Record<string, { code: string; key: string; keyCode?: number; label: string }> = {
  "/": { code: "Slash", key: "/", keyCode: 191, label: "/" },
  slash: { code: "Slash", key: "/", keyCode: 191, label: "/" },
  ".": { code: "Period", key: ".", keyCode: 190, label: "." },
  period: { code: "Period", key: ".", keyCode: 190, label: "." },
  ",": { code: "Comma", key: ",", keyCode: 188, label: "," },
  comma: { code: "Comma", key: ",", keyCode: 188, label: "," },
  ";": { code: "Semicolon", key: ";", keyCode: 186, label: ";" },
  semicolon: { code: "Semicolon", key: ";", keyCode: 186, label: ";" },
  "'": { code: "Quote", key: "'", keyCode: 222, label: "'" },
  quote: { code: "Quote", key: "'", keyCode: 222, label: "'" },
  "`": { code: "Backquote", key: "`", keyCode: 192, label: "`" },
  backquote: { code: "Backquote", key: "`", keyCode: 192, label: "`" },
  "[": { code: "BracketLeft", key: "[", keyCode: 219, label: "[" },
  bracketleft: { code: "BracketLeft", key: "[", keyCode: 219, label: "[" },
  "]": { code: "BracketRight", key: "]", keyCode: 221, label: "]" },
  bracketright: { code: "BracketRight", key: "]", keyCode: 221, label: "]" },
  "\\": { code: "Backslash", key: "\\", keyCode: 220, label: "\\" },
  backslash: { code: "Backslash", key: "\\", keyCode: 220, label: "\\" },
  "-": { code: "Minus", key: "-", keyCode: 189, label: "-" },
  minus: { code: "Minus", key: "-", keyCode: 189, label: "-" },
  "=": { code: "Equal", key: "=", keyCode: 187, label: "=" },
  equal: { code: "Equal", key: "=", keyCode: 187, label: "=" },
  space: { code: "Space", key: " ", keyCode: 32, label: "Space" },
  " ": { code: "Space", key: " ", keyCode: 32, label: "Space" },
  enter: { code: "Enter", key: "enter", keyCode: 13, label: "Enter" },
  return: { code: "Enter", key: "enter", keyCode: 13, label: "Enter" },
  tab: { code: "Tab", key: "tab", keyCode: 9, label: "Tab" },
  backspace: { code: "Backspace", key: "backspace", keyCode: 8, label: "Backspace" },
};

const CODE_TO_CANONICAL_KEY: Record<string, string> = {
  Slash: "/",
  Period: ".",
  Comma: ",",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
};

/** Common macOS Option+<letter> characters produced in `event.key` on US layouts. */
const MAC_OPTION_KEY_TO_ASCII: Record<string, string> = {
  "å": "a",
  "∫": "b",
  "ç": "c",
  "∂": "d",
  "´": "e",
  "ƒ": "f",
  "©": "g",
  "˙": "h",
  "ˆ": "i",
  "∆": "j",
  "˚": "k",
  "¬": "l",
  "µ": "m",
  "˜": "n",
  "ø": "o",
  "π": "p",
  "œ": "q",
  "®": "r",
  "ß": "s",
  "†": "t",
  "¨": "u",
  "√": "v",
  "∑": "w",
  "≈": "x",
  "¥": "y",
  "Ω": "z",
  "∏": "p",
  "Ø": "o",
};

function tokenizeShortcutSpec(raw: string): string[] {
  const expanded = raw
    .trim()
    .replace(/⌘/g, "Cmd+")
    .replace(/⌃/g, "Ctrl+")
    .replace(/⌥/g, "Alt+")
    .replace(/⇧/g, "Shift+");
  return expanded
    .split(/[+\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Parses a human shortcut string (e.g. `"Alt+P"`, `"Mod+Shift+J"`, `"⌘⌥O"`, `"F4"`)
 * into a structured chord. Returns `null` if invalid or if a non-function key has no
 * primary modifier (`Cmd`, `Ctrl`, `Alt`, or `Mod`) so plain typing is never hijacked.
 */
export function parseProjectPickerShortcutChord(raw: string): ParsedShortcutChord | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const tokens = tokenizeShortcutSpec(raw);
  if (tokens.length === 0) return null;

  let mod = false;
  let meta = false;
  let ctrl = false;
  let alt = false;
  let shift = false;
  let keyToken: string | null = null;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "mod" || lower === "cmdorctrl" || lower === "primary") {
      mod = true;
    } else if (lower === "cmd" || lower === "command" || lower === "meta" || lower === "super") {
      meta = true;
    } else if (lower === "ctrl" || lower === "control") {
      ctrl = true;
    } else if (lower === "alt" || lower === "option" || lower === "opt") {
      alt = true;
    } else if (lower === "shift") {
      shift = true;
    } else if (keyToken === null) {
      keyToken = token;
    } else {
      // Multiple non-modifier keys are unsupported
      return null;
    }
  }

  if (!keyToken) return null;
  const lowerKey = keyToken.toLowerCase();

  let code = "";
  let key = lowerKey;
  let keyCode: number | undefined;
  let isNumpadDigit = false;
  let label = keyToken.toUpperCase();
  let isFunctionKey = false;

  if (/^[a-z]$/i.test(keyToken)) {
    const upper = keyToken.toUpperCase();
    code = `Key${upper}`;
    key = lowerKey;
    keyCode = upper.charCodeAt(0);
    label = upper;
  } else if (/^[0-9]$/.test(keyToken)) {
    code = `Digit${keyToken}`;
    key = keyToken;
    keyCode = keyToken.charCodeAt(0);
    isNumpadDigit = true;
    label = keyToken;
  } else if (/^f([1-9]|1[0-2])$/i.test(keyToken)) {
    const num = Number(keyToken.slice(1));
    code = `F${num}`;
    key = `f${num}`;
    keyCode = 111 + num;
    label = `F${num}`;
    isFunctionKey = true;
  } else if (SPECIAL_KEY_MAP[lowerKey]) {
    const mapped = SPECIAL_KEY_MAP[lowerKey]!;
    code = mapped.code;
    key = mapped.key;
    keyCode = mapped.keyCode;
    label = mapped.label;
  } else {
    return null;
  }

  if (!isFunctionKey && !mod && !meta && !ctrl && !alt) {
    return null;
  }

  return { mod, meta, ctrl, alt, shift, code, key, keyCode, isNumpadDigit, label };
}

export function resolveShortcutSpecForPrefs(prefs: ProjectPickerShortcutPrefs): string {
  if (prefs.preset !== "custom") {
    return PRESET_TO_SPEC[prefs.preset] ?? PRESET_TO_SPEC.alt_p;
  }
  return prefs.customShortcut;
}

export function resolveActiveShortcutChord(prefs: ProjectPickerShortcutPrefs): ParsedShortcutChord | null {
  return parseProjectPickerShortcutChord(resolveShortcutSpecForPrefs(prefs));
}

export function formatProjectPickerShortcutDisplay(
  chord: ParsedShortcutChord | null,
  isMac: boolean,
): string {
  if (!chord) return "";
  if (isMac) {
    const parts: string[] = [];
    if (chord.ctrl) parts.push("⌃");
    if (chord.alt) parts.push("⌥");
    if (chord.shift) parts.push("⇧");
    if (chord.meta || chord.mod) parts.push("⌘");
    parts.push(chord.label);
    return parts.join("");
  }
  const parts: string[] = [];
  if (chord.ctrl || chord.mod) parts.push("Ctrl");
  if (chord.alt) parts.push("Alt");
  if (chord.shift) parts.push("Shift");
  if (chord.meta) parts.push("Meta");
  parts.push(chord.label);
  return parts.join("+");
}

export function formatAriaKeyShortcut(chord: ParsedShortcutChord | null, isMac: boolean): string {
  if (!chord) return "";
  const parts: string[] = [];
  if (chord.ctrl || (chord.mod && !isMac)) parts.push("Control");
  if (chord.alt) parts.push("Alt");
  if (chord.shift) parts.push("Shift");
  if (chord.meta || (chord.mod && isMac)) parts.push("Meta");
  parts.push(chord.label.length === 1 ? chord.label.toUpperCase() : chord.label);
  return parts.join("+");
}

export function matchesParsedShortcutChord(
  event: KeyLike,
  chord: ParsedShortcutChord,
  isMac: boolean,
): boolean {
  if (event.isComposing || event.keyCode === 229) return false;
  const wantMeta = chord.meta || (chord.mod && isMac);
  const wantCtrl = chord.ctrl || (chord.mod && !isMac);
  if (Boolean(event.metaKey) !== wantMeta) return false;
  if (Boolean(event.ctrlKey) !== wantCtrl) return false;
  if (Boolean(event.altKey) !== chord.alt) return false;
  if (Boolean(event.shiftKey) !== chord.shift) return false;

  if (event.code) {
    if (event.code === chord.code) return true;
    if (chord.isNumpadDigit && event.code === `Numpad${chord.label}`) return true;
    return false;
  }

  const rawKey = (event.key ?? "").toLowerCase();
  if (rawKey === chord.key) return true;
  if (chord.alt && MAC_OPTION_KEY_TO_ASCII[rawKey] === chord.key) return true;
  if (typeof chord.keyCode === "number" && event.keyCode === chord.keyCode) return true;
  return false;
}

export function isProjectPickerShortcutEvent(
  event: KeyLike,
  prefs: ProjectPickerShortcutPrefs,
  isMac: boolean,
): boolean {
  if (!prefs.enabled) return false;
  const chord = resolveActiveShortcutChord(prefs);
  if (!chord) return false;
  return matchesParsedShortcutChord(event, chord, isMac);
}

const MODIFIER_ONLY_KEYS = new Set([
  "Meta",
  "Control",
  "Alt",
  "Shift",
  "CapsLock",
  "OS",
  "AltGraph",
]);

export type CapturedShortcutResult =
  | { ok: true; spec: string; display: string }
  | { ok: false; reason: "modifier-only" | "composing" | "cancelled" | "requires-modifier" | "unsupported" };

/**
 * Converts a live KeyboardEvent (e.g. inside Settings "Record Shortcut") into a canonical
 * configurable shortcut string like `"Alt+P"` or `"Mod+Shift+J"`.
 */
export function captureKeyboardEventAsShortcut(
  event: KeyLike,
  isMac: boolean,
): CapturedShortcutResult {
  if (event.isComposing || event.keyCode === 229) {
    return { ok: false, reason: "composing" };
  }
  const key = event.key ?? "";
  if (MODIFIER_ONLY_KEYS.has(key) || /^(?:Meta|Control|Alt|Shift)(?:Left|Right)?$/.test(event.code ?? "")) {
    return { ok: false, reason: "modifier-only" };
  }
  if ((key === "Escape" || event.code === "Escape") && !event.metaKey && !event.ctrlKey && !event.altKey) {
    return { ok: false, reason: "cancelled" };
  }

  let keyPart = "";
  const code = event.code ?? "";
  const keyMatch = /^Key([A-Z])$/.exec(code);
  const digitMatch = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  const fnMatch = /^F([1-9]|1[0-2])$/.exec(code);
  if (keyMatch) {
    keyPart = keyMatch[1]!;
  } else if (digitMatch) {
    keyPart = digitMatch[1]!;
  } else if (fnMatch) {
    keyPart = `F${fnMatch[1]}`;
  } else if (CODE_TO_CANONICAL_KEY[code]) {
    keyPart = CODE_TO_CANONICAL_KEY[code]!;
  } else if (/^[a-z0-9]$/i.test(key)) {
    keyPart = key.toUpperCase();
  } else if (/^F([1-9]|1[0-2])$/i.test(key)) {
    keyPart = key.toUpperCase();
  } else if (SPECIAL_KEY_MAP[key.toLowerCase()]) {
    keyPart = SPECIAL_KEY_MAP[key.toLowerCase()]!.label;
  } else {
    return { ok: false, reason: "unsupported" };
  }

  const mods: string[] = [];
  if (isMac) {
    if (event.metaKey && !event.ctrlKey) mods.push("Mod");
    else {
      if (event.ctrlKey) mods.push("Ctrl");
      if (event.metaKey) mods.push("Cmd");
    }
  } else {
    if (event.ctrlKey && !event.metaKey) mods.push("Mod");
    else {
      if (event.ctrlKey) mods.push("Ctrl");
      if (event.metaKey) mods.push("Cmd");
    }
  }
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");

  const spec = [...mods, keyPart].join("+");
  const parsed = parseProjectPickerShortcutChord(spec);
  if (!parsed) {
    return { ok: false, reason: mods.length === 0 ? "requires-modifier" : "unsupported" };
  }
  return {
    ok: true,
    spec,
    display: formatProjectPickerShortcutDisplay(parsed, isMac),
  };
}

// ---------------------------------------------------------------------------
// DOM discovery (attribute selectors only, so unit tests can use flat fakes)
// ---------------------------------------------------------------------------

interface ElementLike {
  tagName?: string;
  getAttribute(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  contains?(other: unknown): boolean;
  closest?(selector: string): unknown;
  parentElement?: ElementLike | null;
  getClientRects?(): { length: number };
  getBoundingClientRect?(): { left: number; top: number; width: number; height: number };
  click?(): void;
  focus?(): void;
  textContent?: string | null;
  value?: string;
  isConnected?: boolean;
  querySelector?(selector: string): ElementLike | null;
  querySelectorAll?(selector: string): ArrayLike<ElementLike>;
}

interface DocLike {
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
  querySelector?(selector: string): ElementLike | null;
  activeElement?: ElementLike | null;
  body?: ElementLike | null;
}

const TRIGGER_SELECTOR = `[data-testid="${PROJECT_PICKER_TRIGGER_TESTID}"],[aria-label="Workspace project"]`;
const COMPOSER_SELECTOR = 'textarea[data-composer-input],textarea,[contenteditable="true"],[contenteditable="plaintext-only"]';

function isVisible(el: ElementLike): boolean {
  if (el.isConnected === false) return false;
  return typeof el.getClientRects === "function" ? el.getClientRects().length > 0 : true;
}

function all(
  scope: { querySelectorAll?: (selector: string) => ArrayLike<ElementLike> } | null | undefined,
  selector: string,
): ElementLike[] {
  return typeof scope?.querySelectorAll === "function"
    ? Array.from(scope.querySelectorAll(selector))
    : [];
}

function isDisabled(el: ElementLike): boolean {
  return el.getAttribute("aria-disabled") === "true" || el.getAttribute("disabled") !== null;
}

function triggerLabel(trigger: ElementLike | null): string | null {
  const text = (trigger?.textContent ?? "").trim();
  return text.length > 0 ? text : null;
}

function insideForeignOwner(target: unknown): boolean {
  const el = target as ElementLike | null;
  if (!el || typeof el.closest !== "function") return false;
  return FOREIGN_OWNERS.some((selector) => Boolean(el.closest?.(selector)));
}

function isEditableComposerTarget(target: unknown, openPicker: OpenProjectPicker | null): boolean {
  const el = target as ElementLike | null;
  if (!el) return false;
  if (openPicker?.searchInput === el) return false;
  if (openPicker?.container.contains?.(el)) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  if (el.getAttribute("data-composer-input") !== null) return true;
  if (tag === "TEXTAREA" || tag === "INPUT") return true;
  if (typeof el.closest === "function") {
    return Boolean(
      el.closest('textarea[data-composer-input],textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"]'),
    );
  }
  const ce = el.getAttribute("contenteditable");
  return ce === "true" || ce === "plaintext-only" || ce === "";
}

export function findProjectPickerTriggers(doc: DocLike): ElementLike[] {
  const seen = new Set<ElementLike>();
  const out: ElementLike[] = [];
  for (const el of all(doc, TRIGGER_SELECTOR)) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (isVisible(el)) out.push(el);
  }
  return out;
}

/**
 * Picks the "Choose the project" trigger in the pane holding focus, falling back to the
 * most recently focused pane, or the first visible trigger on screen.
 */
export function pickProjectPickerTrigger(
  doc: DocLike,
  lastFocused?: ElementLike | null,
): ElementLike | null {
  const triggers = findProjectPickerTriggers(doc);
  if (triggers.length <= 1) return triggers[0] ?? null;
  for (const start of [doc.activeElement ?? null, lastFocused ?? null]) {
    for (let node = start; node; node = node.parentElement ?? null) {
      const hits = triggers.filter((trigger) => node?.contains?.(trigger));
      if (hits.length === 1) return hits[0] ?? null;
      if (hits.length > 1) break;
    }
  }
  return triggers[0] ?? null;
}

function isProjectPickerContainer(container: ElementLike): boolean {
  if (!isVisible(container)) return false;
  if (container.querySelector?.(`input[placeholder="${PROJECT_PICKER_SEARCH_PLACEHOLDER}"]`)) return true;
  if (container.querySelector?.(`[data-testid^="${PROJECT_PICKER_OPTION_PREFIX}"]`)) return true;
  if (container.querySelector?.(`[data-testid="${PROJECT_PICKER_ADD_TESTID}"]`)) return true;
  return false;
}

export function findOpenProjectPicker(doc: DocLike): OpenProjectPicker | null {
  // 1. Desktop Combobox or role="dialog" container
  const containers = [
    ...all(doc, '[data-testid="combobox-desktop-container"]'),
    ...all(doc, '[role="dialog"]'),
  ];
  const seen = new Set<ElementLike>();
  for (const container of containers) {
    if (seen.has(container)) continue;
    seen.add(container);
    if (!isProjectPickerContainer(container)) continue;
    const searchInput =
      container.querySelector?.(`input[placeholder="${PROJECT_PICKER_SEARCH_PLACEHOLDER}"]`) ??
      container.querySelector?.("input") ??
      null;
    return { container, searchInput };
  }

  // 2. Compact / bottom sheet mode: find visible search input with project placeholder
  const visibleInputs = all(doc, `input[placeholder="${PROJECT_PICKER_SEARCH_PLACEHOLDER}"]`).filter(isVisible);
  for (const searchInput of visibleInputs) {
    let container: ElementLike | null = searchInput.parentElement ?? null;
    let foundContainer: ElementLike | null = null;
    for (let depth = 0; container && depth < 20; depth += 1) {
      if (
        container.getAttribute?.("role") === "slider" ||
        container.getAttribute?.("aria-label") === "Bottom Sheet" ||
        container.getAttribute?.("data-testid") === "compact-shell" ||
        (container.parentElement === doc.body || (container as unknown as { id?: string }).id === "root")
      ) {
        foundContainer = container;
        break;
      }
      container = container.parentElement ?? null;
    }
    return {
      container: foundContainer ?? (searchInput.parentElement ?? searchInput),
      searchInput,
    };
  }

  // 3. Fallback: project picker options visible without search input
  const visibleOptions = all(doc, `[data-testid^="${PROJECT_PICKER_OPTION_PREFIX}"]`).filter(isVisible);
  if (visibleOptions.length > 0) {
    let container: ElementLike | null = visibleOptions[0]?.parentElement ?? null;
    for (let depth = 0; container && depth < 16; depth += 1) {
      const box = container;
      if (isProjectPickerContainer(box)) {
        const searchInput =
          box.querySelector?.(`input[placeholder="${PROJECT_PICKER_SEARCH_PLACEHOLDER}"]`) ??
          box.querySelector?.("input") ??
          null;
        return { container: box, searchInput };
      }
      container = box.parentElement ?? null;
    }
  }

  return null;
}

function otherModalOpen(doc: DocLike, openProjectPicker: OpenProjectPicker | null): boolean {
  const cc = all(doc, '[data-testid="command-center-panel"]').some(isVisible);
  if (cc) return true;
  return all(doc, '[aria-modal="true"]').some(
    (el) => isVisible(el) && el !== openProjectPicker?.container,
  );
}

function findPaneRoot(
  doc: DocLike,
  trigger: ElementLike | null,
  composer: ElementLike | null,
): ElementLike | null {
  if (!trigger || !composer) return null;
  const allTriggers = findProjectPickerTriggers(doc);
  for (let node: ElementLike | null = composer; node; node = node.parentElement ?? null) {
    if (node.contains?.(trigger)) {
      if (allTriggers.length <= 1) return node;
      const count = allTriggers.filter((t) => node?.contains?.(t)).length;
      if (count === 1) return node;
      break;
    }
  }
  return null;
}

function findComposerInPane(
  doc: DocLike,
  paneRoot: ElementLike | null,
): ElementLike | null {
  const scope =
    paneRoot && paneRoot.isConnected !== false && typeof paneRoot.querySelectorAll === "function"
      ? paneRoot
      : doc;
  const candidates = all(scope, COMPOSER_SELECTOR).filter(isVisible);
  const preferred = candidates.find((el) => el.getAttribute("data-composer-input") !== null);
  if (preferred) return preferred;
  return (
    candidates.find((el) => (el.tagName ?? "").toUpperCase() === "TEXTAREA" || el.getAttribute("placeholder")) ??
    candidates[0] ??
    null
  );
}

// ---------------------------------------------------------------------------
// Status + self-test (能读 / 能试)
// ---------------------------------------------------------------------------

export function getProjectPickerShortcutStatus(
  docOverride?: DocLike | null,
): ProjectPickerShortcutStatus {
  const doc =
    docOverride ?? (typeof document !== "undefined" ? (document as unknown as DocLike) : null);
  const prefs = readProjectPickerShortcutPrefs();
  const activeSpec = resolveShortcutSpecForPrefs(prefs);
  const activeChord = parseProjectPickerShortcutChord(activeSpec);
  const isMac = isMacPlatform();
  const displayShortcut = formatProjectPickerShortcutDisplay(activeChord, isMac);
  const picker = doc ? findOpenProjectPicker(doc) : null;
  const trigger = doc ? pickProjectPickerTrigger(doc) : null;
  return {
    prefs,
    activeSpec,
    activeChord,
    displayShortcut,
    installed: installedOwner !== null,
    triggersVisible: doc ? findProjectPickerTriggers(doc).length : 0,
    currentProject: triggerLabel(trigger),
    pickerOpen: Boolean(picker),
    receipts: readProjectPickerShortcutReceipts(),
  };
}

export function runProjectPickerShortcutSelfTest(
  docOverride?: DocLike | null,
): ProjectPickerShortcutStatus {
  const status = getProjectPickerShortcutStatus(docOverride);
  const shortcutLabel = status.displayShortcut || status.activeSpec || "unset";
  const parts = [
    `enabled=${status.prefs.enabled}`,
    `shortcut=${shortcutLabel}`,
    `installed=${status.installed}`,
    `triggers on screen=${status.triggersVisible}`,
  ];
  const ok = status.installed && status.prefs.enabled && status.activeChord !== null;
  recordProjectPickerShortcutReceipt(
    "self-test",
    ok,
    status.triggersVisible > 0
      ? `${parts.join(" · ")} · ${shortcutLabel} opens "${status.currentProject ?? "?"}"`
      : `${parts.join(" · ")} (open New Workspace, then press ${shortcutLabel})`,
  );
  return { ...status, receipts: readProjectPickerShortcutReceipts() };
}

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------

export interface ProjectPickerShortcutHandle {
  (): void;
  reconcileNow?: () => void;
  openNow?: () => boolean;
}

export function installProjectPickerShortcut(
  docOverride?: Document | null,
): ProjectPickerShortcutHandle {
  const doc = docOverride ?? (typeof document !== "undefined" ? document : null);
  const win = doc?.defaultView ?? (typeof window !== "undefined" ? window : null);
  if (!doc || !doc.body || !win) return () => {};
  const dom = doc as unknown as DocLike;
  const isMac = isMacPlatform(win.navigator);

  let lastTrigger: ElementLike | null = null;
  let lastFocused: ElementLike | null = null;
  let pendingRestoreComposer: ElementLike | null = null;
  let pendingRestorePane: ElementLike | null = null;
  let userClickedOutsideWhileOpen = false;
  let wasPickerOpen = false;
  let focusEpoch = 0;
  let observer: MutationObserver | null = null;
  let frame = 0;

  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    let id: number | undefined;
    id = win.setTimeout(() => {
      if (typeof id === "number") timers.delete(id);
      fn();
    }, ms);
    if (typeof id === "number") timers.add(id);
  };

  const maybeRestoreComposerFocus = () => {
    const composer = pendingRestoreComposer;
    const pane = pendingRestorePane;
    const triggerRef = lastTrigger;
    const clickedOutside = userClickedOutsideWhileOpen;
    pendingRestoreComposer = null;
    pendingRestorePane = null;
    userClickedOutsideWhileOpen = false;

    if (!composer || clickedOutside) return;
    if (findOpenProjectPicker(dom) || otherModalOpen(dom, null)) return;

    const active = dom.activeElement ?? null;
    const activeIsNeutralOrTrigger =
      !active ||
      active === dom.body ||
      active === (dom as unknown as { documentElement?: ElementLike | null }).documentElement ||
      active === triggerRef ||
      Boolean(triggerRef?.contains?.(active)) ||
      active.getAttribute?.("data-testid") === PROJECT_PICKER_TRIGGER_TESTID ||
      (active.tagName === "DIV" && !active.getAttribute?.("role") && !active.getAttribute?.("tabindex"));

    if (!activeIsNeutralOrTrigger) return;

    const target =
      composer.isConnected !== false ? composer : findComposerInPane(dom, pane);
    if (target && isVisible(target)) {
      target.focus?.();
    }
  };

  const reconcile = () => {
    frame = 0;
    const prefs = readProjectPickerShortcutPrefs();
    const chord = prefs.enabled ? resolveActiveShortcutChord(prefs) : null;
    const ariaShortcut = chord ? formatAriaKeyShortcut(chord, isMac) : "";
    for (const trigger of findProjectPickerTriggers(dom)) {
      if (ariaShortcut) {
        if (trigger.getAttribute("aria-keyshortcuts") !== ariaShortcut) {
          trigger.setAttribute?.("aria-keyshortcuts", ariaShortcut);
        }
      } else if (trigger.getAttribute("aria-keyshortcuts") !== null) {
        trigger.removeAttribute?.("aria-keyshortcuts");
      }
    }

    const picker = findOpenProjectPicker(dom);
    if (picker) {
      wasPickerOpen = true;
    } else if (wasPickerOpen) {
      wasPickerOpen = false;
      later(maybeRestoreComposerFocus, RESTORE_DELAY_MS);
    }
  };

  function schedule() {
    if (frame) return;
    if (typeof win!.requestAnimationFrame === "function") {
      let ran = false;
      const id = win!.requestAnimationFrame(() => {
        ran = true;
        reconcile();
      });
      frame = ran ? 0 : id;
      return;
    }
    reconcile();
  }

  const ensureSearchFocused = () => {
    const epoch = ++focusEpoch;
    for (const ms of FOCUS_CHECK_DELAYS_MS) {
      later(() => {
        if (epoch !== focusEpoch || userClickedOutsideWhileOpen) return;
        const picker = findOpenProjectPicker(dom);
        if (!picker?.searchInput) return;
        const active = dom.activeElement ?? null;
        if (active === picker.searchInput || picker.container.contains?.(active)) return;
        const activeCanTransition =
          !active ||
          active === dom.body ||
          active === (dom as unknown as { documentElement?: ElementLike | null }).documentElement ||
          active === lastTrigger ||
          Boolean(lastTrigger?.contains?.(active)) ||
          active === pendingRestoreComposer;
        if (activeCanTransition) {
          picker.searchInput.focus?.();
        }
      }, ms);
    }
  };

  const open = (
    restoreTarget?: ElementLike | null,
    options?: { silentNoTrigger?: boolean },
  ): boolean => {
    const trigger = pickProjectPickerTrigger(dom, lastFocused);
    if (!trigger || isDisabled(trigger)) {
      if (!options?.silentNoTrigger) {
        recordProjectPickerShortcutReceipt(
          "no-trigger",
          false,
          trigger
            ? "Project picker ('Choose the project') is disabled here."
            : "No 'Choose the project' picker on this screen (open New Workspace).",
        );
      }
      return false;
    }

    lastTrigger = trigger;
    const composer =
      restoreTarget && isEditableComposerTarget(restoreTarget, null)
        ? restoreTarget
        : isEditableComposerTarget(dom.activeElement ?? null, null)
          ? (dom.activeElement ?? null)
          : null;
    pendingRestoreComposer = composer;
    pendingRestorePane = composer ? findPaneRoot(dom, trigger, composer) : null;
    userClickedOutsideWhileOpen = false;

    const label = triggerLabel(trigger) ?? "?";
    trigger.click?.();
    wasPickerOpen = true;
    schedule();
    ensureSearchFocused();

    later(() => {
      const opened = Boolean(findOpenProjectPicker(dom));
      if (!opened) {
        wasPickerOpen = false;
      }
      recordProjectPickerShortcutReceipt(
        "open",
        opened,
        opened
          ? `Opened project picker (current: "${label}").`
          : `Project picker on "${label}" did not open.`,
      );
    }, OPEN_CHECK_DELAY_MS);
    return true;
  };

  const close = (picker: OpenProjectPicker): boolean => {
    // Paseo's FieldTrigger has `onPress: W.open` (not toggle).
    // 1. Try component fiber onClose / onDismiss / handleClose first (especially for compact BottomSheet modal).
    try {
      const el = (picker.searchInput ?? picker.container) as unknown as Record<string, unknown> | null;
      if (el) {
        const k = Object.keys(el).find((key) => key.startsWith("__reactFiber"));
        let cur = k ? (el[k] as Record<string, unknown> | null) : null;
        while (cur) {
          const p = cur.memoizedProps as Record<string, unknown> | null;
          if (p && typeof p === "object") {
            if (typeof p.onClose === "function") {
              (p.onClose as () => void)();
              break;
            }
            if (typeof p.onDismiss === "function") {
              (p.onDismiss as () => void)();
              break;
            }
            if (typeof p.handleClose === "function") {
              (p.handleClose as () => void)();
              break;
            }
          }
          cur = (cur.return as Record<string, unknown> | null) ?? null;
        }
      }
    } catch {
      // Fall through to Escape dispatch
    }

    // 2. Dispatch Escape to focused search input, picker container, active element, and body.
    const targets = [
      picker.searchInput,
      picker.container,
      dom.activeElement,
      dom.body,
    ].filter(Boolean) as Array<{ dispatchEvent?: (ev: Event) => boolean }>;

    const esc =
      typeof KeyboardEvent === "function"
        ? new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true,
          })
        : ({
            key: "Escape",
            code: "Escape",
            keyCode: 27,
            which: 27,
            type: "keydown",
          } as unknown as Event);

    for (const target of targets) {
      if (typeof target.dispatchEvent === "function") {
        target.dispatchEvent(esc);
      }
    }

    focusEpoch += 1;
    wasPickerOpen = false;
    later(maybeRestoreComposerFocus, RESTORE_DELAY_MS);
    recordProjectPickerShortcutReceipt(
      "close",
      true,
      "Closed project picker.",
    );
    return true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const prefs = readProjectPickerShortcutPrefs();
    if (!prefs.enabled) return;
    if (!isProjectPickerShortcutEvent(event, prefs, isMac)) return;

    const wasOpenBefore = wasPickerOpen;
    const picker = findOpenProjectPicker(dom);
    if (!picker) {
      if (insideForeignOwner(event.target) || otherModalOpen(dom, null)) return;
      if (findProjectPickerTriggers(dom).length === 0) return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (event.repeat) return;

    const justOpenedByCore =
      Boolean(event.defaultPrevented) && !wasOpenBefore && Boolean(picker);

    if (picker) {
      if (justOpenedByCore) {
        // Picker was opened during this event (e.g. by Paseo core's `workspace.project.pick` for Cmd+P):
        // Keep it open, record composer restore, focus search input, and record receipt.
        wasPickerOpen = true;
        const composer =
          event.target && isEditableComposerTarget(event.target, picker)
            ? (event.target as unknown as ElementLike)
            : isEditableComposerTarget(dom.activeElement ?? null, picker)
              ? (dom.activeElement ?? null)
              : null;
        pendingRestoreComposer = composer;
        const trigger = pickProjectPickerTrigger(dom, lastFocused);
        pendingRestorePane = composer && trigger ? findPaneRoot(dom, trigger, composer) : null;
        userClickedOutsideWhileOpen = false;
        ensureSearchFocused();
        const label = triggerLabel(trigger) ?? "?";
        recordProjectPickerShortcutReceipt(
          "open",
          true,
          `Opened project picker (current: "${label}").`,
        );
      } else {
        close(picker);
      }
    } else {
      open((event.target as ElementLike | null) ?? dom.activeElement ?? null);
    }
  };

  const onPointerDown = (event: Event) => {
    const picker = findOpenProjectPicker(dom);
    if (!picker) return;
    const target = event.target as ElementLike | null;
    if (!target) return;
    const insidePicker = Boolean(picker.container.contains?.(target));
    const insideTrigger = Boolean(
      lastTrigger && (target === lastTrigger || lastTrigger.contains?.(target)),
    );
    if (!insidePicker && !insideTrigger) {
      userClickedOutsideWhileOpen = true;
    }
  };

  const onFocusIn = (event: Event) => {
    const target = event.target as ElementLike | null;
    if (target) lastFocused = target;
  };

  const onPrefsSync = () => {
    schedule();
  };

  const onStorageSync = (ev: Event) => {
    const key = (ev as { key?: string | null }).key;
    if (key === null || key === PREFS_STORAGE_KEY) {
      schedule();
    }
  };

  win.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("focusin", onFocusIn, true);
  win.addEventListener(PROJECT_PICKER_SHORTCUT_EVENT, onPrefsSync);
  win.addEventListener("storage", onStorageSync);

  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => {
      schedule();
    });
    observer.observe(doc.body, {
      childList: true,
      subtree: true,
    });
  }

  const owner = {};
  const openFn = (options?: { silentNoTrigger?: boolean }) => open(null, options);
  const bridge = { openNow: openFn };
  installedOwner = owner;
  activeOpen = openFn;
  if (typeof globalThis !== "undefined") {
    (globalThis as Record<string, unknown>)[GLOBAL_PROJECT_PICKER_BRIDGE_KEY] = bridge;
  }
  reconcile();

  const cleanup = (() => {
    if (installedOwner === owner) installedOwner = null;
    if (activeOpen === openFn) activeOpen = null;
    if (typeof globalThis !== "undefined") {
      const g = globalThis as Record<string, unknown>;
      if (g[GLOBAL_PROJECT_PICKER_BRIDGE_KEY] === bridge) {
        delete g[GLOBAL_PROJECT_PICKER_BRIDGE_KEY];
      }
    }
    for (const id of timers) win.clearTimeout(id);
    timers.clear();
    win.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("focusin", onFocusIn, true);
    win.removeEventListener(PROJECT_PICKER_SHORTCUT_EVENT, onPrefsSync);
    win.removeEventListener("storage", onStorageSync);
    observer?.disconnect();
    if (frame && typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(frame);
  }) as ProjectPickerShortcutHandle;

  cleanup.reconcileNow = reconcile;
  cleanup.openNow = () => open();
  return cleanup;
}

/** Triggers the live installed project picker helper (for Command Center / Settings tests). */
export function openProjectPickerFromShortcut(
  options?: { silentNoTrigger?: boolean },
): boolean {
  if (activeOpen) return activeOpen(options);
  if (typeof globalThis !== "undefined") {
    const bridge = (globalThis as Record<string, unknown>)[GLOBAL_PROJECT_PICKER_BRIDGE_KEY] as
      | { openNow?: (opts?: { silentNoTrigger?: boolean }) => boolean }
      | undefined;
    if (typeof bridge?.openNow === "function") return bridge.openNow(options);
  }
  return false;
}
