import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRowHints,
  describeModelPickerRow,
  digitFromKeyEvent,
  expectedTriggerLabel,
  findOpenModelPicker,
  installModelQuickSwitch,
  isModelQuickSwitchChord,
  judgePick,
  listModelPickerRows,
  normalizeModelQuickSwitchPrefs,
  pickModelSelectorTrigger,
  readModelQuickSwitchReceipts,
  resolveDigitAction,
  syncModelQuickSwitchPrefs,
} from "../client/model-quick-switch-web";
import { pluginSettings } from "../shared/contracts";

// Prefs and receipts live in localStorage; give this process an in-memory one.
const memory = new Map<string, string>();
(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  },
  dispatchEvent: () => true,
};

// --- Tiny fake DOM: a tree of nodes plus a selector matcher for `[attr]`, `[attr="v"]`,
// `[attr^="v"]` and comma lists, which is all the module queries.

type FakeNode = {
  attrs: Map<string, string>;
  children: FakeNode[];
  parentElement: FakeNode | null;
  textContent: string;
  value?: string;
  clicks: number;
  isConnected: boolean;
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
  contains(o: unknown): boolean;
  closest(sel: string): FakeNode | null;
  querySelectorAll(sel: string): FakeNode[];
  querySelector(sel: string): FakeNode | null;
  click(): void;
  onClick?: () => void;
  getBoundingClientRect?: () => { left: number; top: number; width: number; height: number };
};

function matches(node: FakeNode, selector: string): boolean {
  return selector.split(",").some((part) => {
    const m = /^\[([\w-]+)(?:(\^?=)"([^"]*)")?\]$/.exec(part.trim());
    if (!m) {
      // class selectors used by the foreign-owner check
      return part.trim().startsWith(".") && (node.attrs.get("class") ?? "").split(" ").includes(part.trim().slice(1));
    }
    const value = node.attrs.get(m[1]!);
    if (value === undefined) return false;
    if (!m[2]) return true;
    return m[2] === "=" ? value === m[3] : value.startsWith(m[3]!);
  });
}

function descendants(node: FakeNode): FakeNode[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function el(attrs: Record<string, string> = {}, children: FakeNode[] = [], text = ""): FakeNode {
  const node: FakeNode = {
    attrs: new Map(Object.entries(attrs)),
    children,
    parentElement: null,
    textContent: text,
    clicks: 0,
    isConnected: true,
    getAttribute: (n) => node.attrs.get(n) ?? null,
    setAttribute: (n, v) => void node.attrs.set(n, v),
    removeAttribute: (n) => void node.attrs.delete(n),
    contains: (o) => o === node || descendants(node).includes(o as FakeNode),
    closest: (sel) => {
      for (let n: FakeNode | null = node; n; n = n.parentElement) if (matches(n, sel)) return n;
      return null;
    },
    querySelectorAll: (sel) => descendants(node).filter((d) => matches(d, sel)),
    querySelector: (sel) => descendants(node).find((d) => matches(d, sel)) ?? null,
    click: () => {
      node.clicks += 1;
      node.onClick?.();
    },
  };
  for (const child of children) child.parentElement = node;
  if (!text) node.textContent = children.map((c) => c.textContent).join("");
  return node;
}

const txt = (s: string) => el({ dir: "auto" }, [], s);
const profileRow = (id: string, name: string, desc: string) =>
  el({ "data-testid": `model-profile-row-${id}` }, [el({}, [txt(name), txt(desc)])]);
const modelRow = (provider: string, model: string, label: string) =>
  el({ "data-testid": `model-row-${provider}-${model}` }, [el({}, [txt(label), txt(model)])]);
const providerRow = (id: string, label: string) =>
  el({ "data-testid": `model-provider-${id}` }, [txt(label)]);

function buildScreen(options: { twoComposers?: boolean; pickerOpen?: boolean } = {}) {
  const textareaA = el({ "data-testid": "composer-a-input" });
  const triggerA = el({ "data-testid": "combined-model-selector" }, [], "Gemini 3.8 Flash (High)");
  const composerA = el({}, [textareaA, triggerA]);
  const textareaB = el({ "data-testid": "composer-b-input" });
  const triggerB = el({ "data-testid": "combined-model-selector" }, [], "Opus 5.5");
  const composerB = el({}, [textareaB, triggerB]);
  const search = el({ "data-testid": "model-search-all-input" });
  search.value = "";
  const rows = [
    profileRow("p1", "Gemini 3.8 Flash (High)", "Antigravity · Gemini 3.8 Flash (High) · Full access"),
    profileRow("p2", "Gemini 4 Argon - High", "Antigravity · Gemini 4 Argon (High) · Full access"),
    profileRow("p3", "Opus 5.5", "Claude · Opus 5.5 · Bypass · Extra high"),
    providerRow("claude", "Claude"),
    providerRow("codex", "Codex"),
  ];
  const dialog = el({ role: "dialog", "data-testid": "combobox-desktop-container" }, [
    el({}, [search]),
    el({}, rows),
  ]);
  const panes = el({}, options.twoComposers ? [composerA, composerB] : [composerA]);
  const body = el({}, options.pickerOpen ? [panes, dialog] : [panes]);
  const doc = {
    body,
    activeElement: textareaA as FakeNode | null,
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
    querySelector: (sel: string) => body.querySelector(sel),
  };
  return { doc, body, panes, dialog, search, rows, triggerA, triggerB, textareaA, textareaB };
}

test("model quick switch: settings schema, prefs default, chord and digit classification", () => {
  const shape = (pluginSettings as unknown as { schema: { shape: Record<string, unknown> } }).schema.shape;
  assert.ok("enableModelQuickSwitch" in shape);
  assert.ok("modelQuickSwitchDigits" in shape);
  assert.deepEqual(normalizeModelQuickSwitchPrefs(undefined), { enabled: true, digitMode: "empty-search" });
  assert.deepEqual(normalizeModelQuickSwitchPrefs({ enabled: false, digitMode: "modifier-only" }), {
    enabled: false,
    digitMode: "modifier-only",
  });
  assert.equal(normalizeModelQuickSwitchPrefs({ digitMode: "bogus" }).digitMode, "empty-search");

  // ⌘/ on mac, Ctrl+/ elsewhere; never with Shift (that is ⌘? / help) or Alt.
  assert.equal(isModelQuickSwitchChord({ code: "Slash", key: "/", metaKey: true }, true), true);
  assert.equal(isModelQuickSwitchChord({ code: "NumpadDivide", key: "/", metaKey: true }, true), true);
  assert.equal(isModelQuickSwitchChord({ code: "Slash", key: "/", ctrlKey: true }, true), false);
  assert.equal(isModelQuickSwitchChord({ code: "Slash", key: "/", ctrlKey: true }, false), true);
  assert.equal(isModelQuickSwitchChord({ code: "Slash", key: "?", metaKey: true, shiftKey: true }, true), false);
  assert.equal(isModelQuickSwitchChord({ code: "Slash", key: "/" }, true), false);
  assert.equal(isModelQuickSwitchChord({ code: "Slash", metaKey: true, isComposing: true }, true), false);
  assert.equal(isModelQuickSwitchChord({ code: "KeyK", key: "k", metaKey: true }, true), false);

  assert.equal(digitFromKeyEvent({ code: "Digit3", key: "3" }), 3);
  assert.equal(digitFromKeyEvent({ code: "Numpad9", key: "9" }), 9);
  assert.equal(digitFromKeyEvent({ code: "Digit0", key: "0" }), null);
  assert.equal(digitFromKeyEvent({ code: "KeyA", key: "a" }), null);

  const ev = (extra: Record<string, unknown>) => ({ code: "Digit2", key: "2", ...extra });
  const base = { digitMode: "empty-search" as const, isMac: true };
  assert.equal(resolveDigitAction({ ...base, event: ev({}), searchValue: "" }), 2);
  assert.equal(resolveDigitAction({ ...base, event: ev({}), searchValue: "gem" }), null, "digits type while searching");
  assert.equal(resolveDigitAction({ ...base, event: ev({ metaKey: true }), searchValue: "gem" }), 2);
  assert.equal(resolveDigitAction({ ...base, event: ev({ ctrlKey: true }), searchValue: "" }), null);
  assert.equal(resolveDigitAction({ ...base, event: ev({ shiftKey: true }), searchValue: "" }), null);
  assert.equal(
    resolveDigitAction({ event: ev({}), searchValue: "", digitMode: "modifier-only", isMac: true }),
    null,
  );
});

test("model quick switch: finds the open picker, numbers rows in render order, reads expected labels", () => {
  const { doc, rows } = buildScreen({ pickerOpen: true });
  const picker = findOpenModelPicker(doc as never);
  assert.ok(picker, "picker should be found from the search input");
  const listed = listModelPickerRows(picker!);
  assert.equal(listed.length, 5, "3 profiles + 2 providers");
  const infos = listed.map((row, i) => describeModelPickerRow(row as never, i + 1));
  assert.deepEqual(
    infos.map((i) => [i.index, i.kind, i.id, i.label]),
    [
      [1, "profile", "p1", "Gemini 3.8 Flash (High)"],
      [2, "profile", "p2", "Gemini 4 Argon - High"],
      [3, "profile", "p3", "Opus 5.5"],
      [4, "provider", "claude", "Claude"],
      [5, "provider", "codex", "Codex"],
    ],
  );
  assert.equal(expectedTriggerLabel(rows[1] as never, infos[1]!), "Gemini 4 Argon (High)");
  assert.equal(expectedTriggerLabel(rows[3] as never, infos[3]!), null);
  const model = modelRow("antigravity", "gemini-4-argon-low", "Gemini 4 Argon (Low)");
  assert.equal(
    expectedTriggerLabel(model as never, describeModelPickerRow(model as never, 1)),
    "Gemini 4 Argon (Low)",
  );

  assert.equal(findOpenModelPicker(buildScreen().doc as never), null, "closed picker is not found");
});

test("model quick switch: number hints write once, follow search state, and clear on close", () => {
  const { doc, rows, search } = buildScreen({ pickerOpen: true });
  const prefs = { enabled: true, digitMode: "empty-search" as const };
  const picker = findOpenModelPicker(doc as never)!;
  assert.equal(applyRowHints(doc as never, picker, prefs, true), 5);
  assert.deepEqual(
    rows.map((r) => r.getAttribute("data-paseo-finder-model-index")),
    ["1", "2", "3", "4", "5"],
  );
  search.value = "opus";
  applyRowHints(doc as never, picker, prefs, true);
  assert.equal(rows[0]!.getAttribute("data-paseo-finder-model-index"), "⌘1", "while searching only ⌘N picks");
  applyRowHints(doc as never, null, prefs, true);
  assert.ok(rows.every((r) => r.getAttribute("data-paseo-finder-model-index") === null));
});

test("model quick switch: trigger choice follows the focused pane, not the first on screen", () => {
  const { doc, triggerA, triggerB, textareaB } = buildScreen({ twoComposers: true });
  assert.equal(pickModelSelectorTrigger(doc as never), triggerA);
  doc.activeElement = textareaB;
  assert.equal(pickModelSelectorTrigger(doc as never), triggerB);
});

test("model quick switch: ⌘/ opens, digit picks through the native row, ⌘/ closes; typing is untouched", () => {
  const screen = buildScreen();
  const { body, panes, dialog, triggerA, rows } = screen;
  // Native behaviour: the trigger toggles the picker; a profile press applies and closes it.
  triggerA.onClick = () => {
    const open = body.children.includes(dialog);
    body.children = open ? [panes] : [panes, dialog];
    dialog.parentElement = open ? null : body;
    dialog.isConnected = !open;
  };
  rows[1]!.onClick = () => {
    triggerA.textContent = "Gemini 4 Argon (High)";
    triggerA.onClick?.();
  };

  const listeners = new Map<string, (e: unknown) => void>();
  const timers: Array<() => void> = [];
  const win = {
    navigator: { platform: "MacIntel", userAgent: "Mac" },
    addEventListener: (t: string, fn: (e: unknown) => void) => listeners.set(`win:${t}`, fn),
    removeEventListener: (t: string) => listeners.delete(`win:${t}`),
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {},
  };
  const doc = {
    ...screen.doc,
    defaultView: win,
    head: null,
    addEventListener: (t: string, fn: (e: unknown) => void) => listeners.set(`doc:${t}`, fn),
    removeEventListener: (t: string) => listeners.delete(`doc:${t}`),
    getElementById: () => null,
  };
  syncModelQuickSwitchPrefs({ enabled: true, digitMode: "empty-search" });
  const cleanup = installModelQuickSwitch(doc as never);
  const keydown = listeners.get("win:keydown")!;
  const press = (init: Record<string, unknown>) => {
    let stopped = false;
    keydown({
      target: screen.doc.activeElement,
      preventDefault: () => {},
      stopPropagation: () => {},
      stopImmediatePropagation: () => {
        stopped = true;
      },
      ...init,
    });
    return stopped;
  };

  // Plain typing in the composer is never intercepted, and digits pass while closed.
  assert.equal(press({ code: "KeyA", key: "a" }), false);
  assert.equal(press({ code: "Digit2", key: "2" }), false);

  assert.equal(press({ code: "Slash", key: "/", metaKey: true }), true);
  assert.equal(triggerA.clicks, 1);
  assert.ok(findOpenModelPicker(screen.doc as never), "⌘/ opened the native picker");

  // Holding the key (auto-repeat) never acts; a digit from outside the picker is not ours.
  assert.equal(press({ code: "Digit2", key: "2", target: screen.search, repeat: true }), true);
  assert.equal(rows[1]!.clicks, 0, "auto-repeat is swallowed, not acted on");
  assert.equal(press({ code: "Digit2", key: "2", target: screen.textareaA }), false);
  assert.equal(press({ code: "Digit2", key: "2", target: screen.search }), true);
  assert.equal(rows[1]!.clicks, 1, "digit 2 pressed the second row");
  assert.equal(findOpenModelPicker(screen.doc as never), null);
  for (const fn of timers.splice(0)) fn();
  const pickReceipt = readModelQuickSwitchReceipts().find((r) => r.trigger === "pick");
  assert.ok(pickReceipt?.ok, `pick receipt should confirm by read-back: ${pickReceipt?.outcome}`);
  assert.match(pickReceipt!.outcome, /→ "Gemini 4 Argon \(High\)"/);

  // A pick Paseo does not apply is reported as failed by the read-back, not trusted.
  press({ code: "Slash", key: "/", metaKey: true });
  rows[2]!.onClick = () => triggerA.onClick?.(); // closes, label unchanged
  assert.equal(press({ code: "Digit3", key: "3", target: screen.search }), true);
  for (const fn of timers.splice(0)) fn();
  const failed = readModelQuickSwitchReceipts().find((r) => r.trigger === "pick");
  assert.equal(failed?.ok, false, `unapplied pick must not read as success: ${failed?.outcome}`);
  assert.match(failed!.outcome, /expected "Opus 5\.5"/);

  // ⌘/ toggles closed again, through the close path.
  press({ code: "Slash", key: "/", metaKey: true });
  assert.ok(findOpenModelPicker(screen.doc as never));
  press({ code: "Slash", key: "/", metaKey: true });
  assert.equal(findOpenModelPicker(screen.doc as never), null);
  assert.equal(readModelQuickSwitchReceipts()[0]?.trigger, "close");

  // ⌘/ inside a code editor stays the editor's comment toggle.
  const editor = el({ class: "cm-editor" }, [el({ "data-testid": "editor-line" })]);
  assert.equal(press({ code: "Slash", key: "/", metaKey: true, target: editor.children[0] }), false);

  // Another modal (e.g. Command Center) owns ⌘/ while it is open.
  const modal = el({ "aria-modal": "true" });
  body.children = [...body.children, modal];
  modal.parentElement = body;
  assert.equal(press({ code: "Slash", key: "/", metaKey: true }), false);
  body.children = body.children.filter((c) => c !== modal);

  // Disabled: nothing is intercepted.
  syncModelQuickSwitchPrefs({ enabled: false });
  assert.equal(press({ code: "Slash", key: "/", metaKey: true }), false);
  syncModelQuickSwitchPrefs({ enabled: true });

  cleanup();
  assert.equal(listeners.size, 0);
});

test("model quick switch: pick verdict trusts only the label read back", () => {
  assert.deepEqual(judgePick({ expected: "Gemini 4 Argon (High)", before: "Select model", after: "Gemini 4 Argon (High)" }), {
    ok: true,
    note: "",
  });
  assert.equal(judgePick({ expected: "Opus 5.5", before: "Opus 5.5", after: "Opus 5.5" }).note, " (already selected)");
  assert.equal(judgePick({ expected: "Opus 5.5", before: "Gemini", after: "Gemini" }).ok, false);
  // No expectation: only a visible change counts.
  assert.equal(judgePick({ expected: null, before: "A", after: "B" }).ok, true);
  assert.equal(judgePick({ expected: null, before: "A", after: "A" }).ok, false);
  assert.equal(judgePick({ expected: "Auto", before: "x", after: null }).ok, false);
});

test("model quick switch: a stale trigger from an earlier ⌘/ never closes another pane's picker", () => {
  const screen = buildScreen({ twoComposers: true });
  const { body, panes, dialog, triggerA, triggerB } = screen;
  const toggle = (trigger: FakeNode) => () => {
    const open = body.children.includes(dialog);
    body.children = open ? [panes] : [panes, dialog];
    dialog.parentElement = open ? null : body;
    dialog.isConnected = !open;
    dialog.attrs.set("data-anchor", trigger === triggerA ? "A" : "B");
  };
  triggerA.onClick = toggle(triggerA);
  triggerB.onClick = toggle(triggerB);
  // Picker sits right above pane B's trigger.
  triggerA.getBoundingClientRect = () => ({ left: 0, top: 500, width: 100, height: 20 });
  triggerB.getBoundingClientRect = () => ({ left: 800, top: 500, width: 100, height: 20 });
  dialog.getBoundingClientRect = () => ({ left: 800, top: 100, width: 300, height: 390 });
  const listeners = new Map<string, (e: unknown) => void>();
  const win = {
    navigator: { platform: "MacIntel" },
    addEventListener: (t: string, fn: (e: unknown) => void) => listeners.set(`win:${t}`, fn),
    removeEventListener: (t: string) => listeners.delete(`win:${t}`),
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  const doc = {
    ...screen.doc,
    defaultView: win,
    head: null,
    addEventListener: (t: string, fn: (e: unknown) => void) => listeners.set(`doc:${t}`, fn),
    removeEventListener: (t: string) => listeners.delete(`doc:${t}`),
    getElementById: () => null,
  };
  const cleanup = installModelQuickSwitch(doc as never);
  const press = (target: unknown) =>
    listeners.get("win:keydown")!({
      code: "Slash",
      key: "/",
      metaKey: true,
      target,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    });
  press(screen.textareaA); // open A with ⌘/
  triggerA.click(); // closed natively (Escape / click outside), not by ⌘/
  cleanup.reconcileNow?.();
  assert.equal(triggerA.clicks, 2);
  triggerB.click(); // user opens B with the mouse; focus moves into the picker
  (doc as { activeElement: unknown }).activeElement = screen.search;
  cleanup.reconcileNow?.();
  press(screen.search); // ⌘/ must close B, not reopen A
  assert.equal(triggerA.clicks, 2, "pane A's trigger was not touched");
  assert.equal(triggerB.clicks, 2);
  assert.equal(findOpenModelPicker(screen.doc as never), null);
  cleanup();
});
