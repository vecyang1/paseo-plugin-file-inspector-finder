import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_NUMBERED_LABEL_CHIPS,
  labelHintTextFor,
  resolveLabelDigitAction,
} from "../client/label-quick-pick";
import {
  dismissNativeMenu,
  installDesktopRevealHelpers,
  readInlineRenamePreferences,
  syncInlineRenamePreferences,
  triggerQuickThreadMetadataBar,
  type MinimalDocument,
  type MinimalElement,
  type MinimalWindow,
} from "../client/web";
import { pluginSettings, type WorkspaceLabelColor } from "../shared/contracts";

function createFakeDom() {
  const winListeners = new Map<string, Array<(ev: unknown) => void>>();
  const docListeners = new Map<string, Array<(ev: unknown) => void>>();
  const storageMap = new Map<string, string>();
  let activeEl: MockEl | null = null;

  type MockEl = MinimalElement & {
    attrs: Map<string, string>;
    listeners: Map<string, Array<(ev: unknown) => void>>;
    children: MockEl[];
    blur?: () => void;
    dispatch: (type: string, ev?: Record<string, unknown>) => void;
  };

  function makeEl(tagName: string): MockEl {
    const attrs = new Map<string, string>();
    const listeners = new Map<string, Array<(ev: unknown) => void>>();
    const children: MockEl[] = [];
    let explicitText = "";
    const el: MockEl = {
      tagName: tagName.toUpperCase(),
      attrs,
      listeners,
      children,
      value: "",
      get textContent() {
        if (explicitText) return explicitText;
        return children.map((c) => c.textContent ?? "").join(" ").trim();
      },
      set textContent(v: string | null | undefined) {
        explicitText = v ?? "";
      },
      innerHTML: "",
      style: {},
      parentElement: null,
      get previousElementSibling(): MinimalElement | null {
        const p = el.parentElement as MockEl | null;
        if (!p) return null;
        const idx = p.children.indexOf(el);
        return idx > 0 ? p.children[idx - 1]! : null;
      },
      click: () => {
        el.dispatch("click");
      },
      getAttribute: (k: string) => attrs.get(k) ?? null,
      setAttribute: (k: string, v: string) => {
        attrs.set(k, v);
      },
      removeAttribute: (k: string) => {
        attrs.delete(k);
      },
      appendChild: (child: MinimalElement) => {
        const c = child as MockEl;
        c.parentElement = el;
        children.push(c);
      },
      replaceChildren: (...nodes: unknown[]) => {
        children.length = 0;
        for (const n of nodes) {
          const c = n as MockEl;
          c.parentElement = el;
          children.push(c);
        }
      },
      remove: () => {
        const parent = el.parentElement as MockEl | null;
        if (parent) {
          const idx = parent.children.indexOf(el);
          if (idx !== -1) parent.children.splice(idx, 1);
          el.parentElement = null;
        }
        if (activeEl === el) activeEl = null;
      },
      contains: (other: MinimalElement | null) => {
        let cur = other as MockEl | null;
        while (cur) {
          if (cur === el) return true;
          cur = cur.parentElement as MockEl | null;
        }
        return false;
      },
      focus: () => {
        activeEl = el;
        el.dispatch("focus");
      },
      blur: () => {
        if (activeEl === el) activeEl = null;
        el.dispatch("blur");
      },
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type)!.push(fn);
      },
      removeEventListener: (type: string, fn: (ev: unknown) => void) => {
        const arr = listeners.get(type);
        if (arr) {
          const idx = arr.indexOf(fn);
          if (idx !== -1) arr.splice(idx, 1);
        }
      },
      querySelectorAll: (selector: string) => {
        const out: MockEl[] = [];
        const visit = (node: MockEl) => {
          for (const child of node.children) {
            if (matchesSelector(child, selector)) out.push(child);
            visit(child);
          }
        };
        visit(el);
        return out;
      },
      querySelector: (selector: string) => {
        const all = el.querySelectorAll?.(selector) ?? [];
        return (all[0] as MockEl | undefined) ?? null;
      },
      dispatch: (type: string, ev: Record<string, unknown> = {}) => {
        for (const fn of listeners.get(type) ?? []) {
          fn({ target: el, preventDefault: () => {}, stopPropagation: () => {}, ...ev });
        }
      },
    };
    return el;
  }

  function matchesSingleSelector(el: MockEl, rawSelector: string): boolean {
    let selector = rawSelector.trim();
    const notMatch = /:not\(([^)]+)\)/.exec(selector);
    if (notMatch) {
      selector = selector.replace(notMatch[0], "").trim();
      if (matchesSingleSelector(el, notMatch[1]!)) return false;
    }
    const lastSpaceIdx = selector.lastIndexOf(" ");
    if (lastSpaceIdx !== -1) {
      selector = selector.slice(lastSpaceIdx + 1).trim();
    }
    const attrExact = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector);
    if (attrExact) {
      return el.getAttribute?.(attrExact[1]!) === attrExact[2]!;
    }
    const attrPrefix = /^\[([\w-]+)\^="([^"]*)"\]$/.exec(selector);
    if (attrPrefix) {
      const val = el.getAttribute?.(attrPrefix[1]!) ?? "";
      return val.startsWith(attrPrefix[2]!);
    }
    const attrSuffix = /^\[([\w-]+)\$="([^"]*)"\]$/.exec(selector);
    if (attrSuffix) {
      const val = el.getAttribute?.(attrSuffix[1]!) ?? "";
      return val.endsWith(attrSuffix[2]!);
    }
    const attrPresence = /^\[([\w-]+)\]$/.exec(selector);
    if (attrPresence) {
      return el.getAttribute?.(attrPresence[1]!) !== null;
    }
    return el.tagName?.toLowerCase() === selector.toLowerCase();
  }

  function matchesSelector(el: MockEl, selector: string): boolean {
    return selector.split(",").some((part) => matchesSingleSelector(el, part));
  }

  const body = makeEl("body");
  const doc = {
    body,
    get activeElement() {
      return activeEl;
    },
    createElement: (tag: string) => makeEl(tag),
    querySelector: (sel: string) => body.querySelector?.(sel) ?? null,
    querySelectorAll: (sel: string) => body.querySelectorAll?.(sel) ?? [],
    addEventListener: (t: string, fn: (ev: unknown) => void) => {
      if (!docListeners.has(t)) docListeners.set(t, []);
      docListeners.get(t)!.push(fn);
    },
    removeEventListener: (t: string, fn: (ev: unknown) => void) => {
      const arr = docListeners.get(t);
      if (arr) {
        const idx = arr.indexOf(fn);
        if (idx !== -1) arr.splice(idx, 1);
      }
    },
  } as unknown as MinimalDocument;

  const win = {
    navigator: { platform: "MacIntel", userAgent: "Macintosh", language: "en" },
    innerWidth: 1280,
    innerHeight: 800,
    localStorage: {
      get length() {
        return storageMap.size;
      },
      key: (i: number) => Array.from(storageMap.keys())[i] ?? null,
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => void storageMap.set(k, v),
    },
    addEventListener: (t: string, fn: (ev: unknown) => void) => {
      if (!winListeners.has(t)) winListeners.set(t, []);
      winListeners.get(t)!.push(fn);
    },
    removeEventListener: (t: string, fn: (ev: unknown) => void) => {
      const arr = winListeners.get(t);
      if (arr) {
        const idx = arr.indexOf(fn);
        if (idx !== -1) arr.splice(idx, 1);
      }
    },
    requestAnimationFrame: (cb: () => void) => {
      cb();
      return 1;
    },
    cancelAnimationFrame: () => {},
  } as unknown as MinimalWindow;

  function fireWinKeyDown(ev: Record<string, unknown>) {
    let defaultPrevented = false;
    let stopped = false;
    let immediateStopped = false;
    const eventObj = {
      key: "",
      preventDefault: () => {
        defaultPrevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
      stopImmediatePropagation: () => {
        immediateStopped = true;
      },
      ...ev,
    };
    for (const fn of [...(winListeners.get("keydown") ?? [])]) {
      fn(eventObj);
      if (immediateStopped) break;
    }
    return { defaultPrevented, stopped, immediateStopped };
  }

  return { body, doc, win, winListeners, fireWinKeyDown, setActiveElement: (e: MockEl | null) => { activeEl = e; } };
}

test("1. resolveLabelDigitAction & labelHintTextFor pure classification", () => {
  assert.equal(MAX_NUMBERED_LABEL_CHIPS, 9);

  // Plain digit when label input is empty
  assert.deepEqual(
    resolveLabelDigitAction({
      event: { key: "1", code: "Digit1" },
      digitMode: "empty-input",
      isTitleInputFocused: false,
      isLabelInputFocused: true,
      labelInputValue: "",
      catalogLength: 5,
      isMac: true,
    }),
    { index: 1, swallowOnly: false },
  );

  // Numpad digit works too
  assert.deepEqual(
    resolveLabelDigitAction({
      event: { key: "4", code: "Numpad4" },
      digitMode: "empty-input",
      isTitleInputFocused: false,
      isLabelInputFocused: true,
      labelInputValue: "",
      catalogLength: 5,
      isMac: true,
    }),
    { index: 4, swallowOnly: false },
  );

  // Plain digit out of range while typing in label input passes through (e.g. creating "8045")
  assert.equal(
    resolveLabelDigitAction({
      event: { key: "8", code: "Digit8" },
      digitMode: "empty-input",
      isTitleInputFocused: false,
      isLabelInputFocused: true,
      labelInputValue: "",
      catalogLength: 5,
      isMac: true,
    }),
    null,
  );

  // Cmd+8 out of range swallows so Paseo behind the dialog does not switch workspaces
  assert.deepEqual(
    resolveLabelDigitAction({
      event: { key: "8", code: "Digit8", metaKey: true },
      digitMode: "empty-input",
      isTitleInputFocused: false,
      isLabelInputFocused: true,
      labelInputValue: "",
      catalogLength: 5,
      isMac: true,
    }),
    { index: 8, swallowOnly: true },
  );

  // Plain digit while label input already has text passes through ("v2")
  assert.equal(
    resolveLabelDigitAction({
      event: { key: "2", code: "Digit2" },
      digitMode: "empty-input",
      isTitleInputFocused: false,
      isLabelInputFocused: true,
      labelInputValue: "v",
      catalogLength: 5,
      isMac: true,
    }),
    null,
  );

  // Cmd+2 while label input has text still toggles label #2
  assert.deepEqual(
    resolveLabelDigitAction({
      event: { key: "2", code: "Digit2", metaKey: true },
      digitMode: "empty-input",
      isTitleInputFocused: false,
      isLabelInputFocused: true,
      labelInputValue: "v",
      catalogLength: 5,
      isMac: true,
    }),
    { index: 2, swallowOnly: false },
  );

  // Plain digit while title input is focused passes through ("Phase 2")
  assert.equal(
    resolveLabelDigitAction({
      event: { key: "2", code: "Digit2" },
      digitMode: "empty-input",
      isTitleInputFocused: true,
      isLabelInputFocused: false,
      labelInputValue: "",
      catalogLength: 5,
      isMac: true,
    }),
    null,
  );

  // Ctrl+3 on Windows/Linux toggles label #3 even when title input is focused
  assert.deepEqual(
    resolveLabelDigitAction({
      event: { key: "3", code: "Digit3", ctrlKey: true },
      digitMode: "modifier-only",
      isTitleInputFocused: true,
      isLabelInputFocused: false,
      labelInputValue: "",
      catalogLength: 5,
      isMac: false,
    }),
    { index: 3, swallowOnly: false },
  );

  // IME composition, Shift+1 (!), Alt+1 never intercepted
  assert.equal(
    resolveLabelDigitAction({
      event: { key: "1", code: "Digit1", isComposing: true },
      digitMode: "empty-input",
      isTitleInputFocused: false,
      isLabelInputFocused: true,
      labelInputValue: "",
      catalogLength: 5,
      isMac: true,
    }),
    null,
  );
  assert.equal(
    resolveLabelDigitAction({
      event: { key: "!", code: "Digit1", shiftKey: true },
      digitMode: "empty-input",
      isTitleInputFocused: false,
      isLabelInputFocused: true,
      labelInputValue: "",
      catalogLength: 5,
      isMac: true,
    }),
    null,
  );
  assert.equal(
    resolveLabelDigitAction({
      event: { key: "¡", code: "Digit1", altKey: true },
      digitMode: "empty-input",
      isTitleInputFocused: false,
      isLabelInputFocused: true,
      labelInputValue: "",
      catalogLength: 5,
      isMac: true,
    }),
    null,
  );

  // Dynamic hint label formatting
  assert.equal(
    labelHintTextFor({
      index: 3,
      digitMode: "empty-input",
      isTitleInputFocused: false,
      labelInputValue: "",
      isMac: true,
    }),
    "3",
  );
  assert.equal(
    labelHintTextFor({
      index: 3,
      digitMode: "empty-input",
      isTitleInputFocused: false,
      labelInputValue: "v",
      isMac: true,
    }),
    "⌘3",
  );
  assert.equal(
    labelHintTextFor({
      index: 3,
      digitMode: "empty-input",
      isTitleInputFocused: true,
      labelInputValue: "",
      isMac: false,
    }),
    "Ctrl 3",
  );
});

test("2. Settings schema & localStorage preference defaults", () => {
  const defaults = pluginSettings.schema.parse({});
  assert.equal(defaults.enableLabelNumberShortcuts, true);
  assert.equal(defaults.labelNumberShortcutMode, "empty-input");

  const { win } = createFakeDom();
  assert.equal(readInlineRenamePreferences(win.localStorage).enableLabelNumberShortcuts, true);
  assert.equal(readInlineRenamePreferences(win.localStorage).labelNumberShortcutMode, "empty-input");

  syncInlineRenamePreferences(
    { enableLabelNumberShortcuts: false, labelNumberShortcutMode: "modifier-only" },
    win.localStorage,
  );
  const updated = readInlineRenamePreferences(win.localStorage);
  assert.equal(updated.enableLabelNumberShortcuts, false);
  assert.equal(updated.labelNumberShortcutMode, "modifier-only");
});

test("3. Cmd+L followed by 1..4 toggles numbered chips, serializes rapid presses, and respects title/label typing", async () => {
  const { body, doc, win, fireWinKeyDown } = createFakeDom();

  const catalog: Array<{ name: string; color: WorkspaceLabelColor }> = [
    { name: "star", color: "amber" },
    { name: "think", color: "violet" },
    { name: "feat", color: "red" },
    { name: "build", color: "violet" },
    { name: "calm", color: "violet" },
    { name: "six", color: "blue" },
    { name: "seven", color: "sky" },
    { name: "eight", color: "emerald" },
    { name: "nine", color: "orange" },
    { name: "ten", color: "pink" },
  ];
  const assigned = new Set<string>(["think"]);
  const toggleOrder: string[] = [];

  const cleanup = installDesktopRevealHelpers(
    {
      isEnabled: () => true,
      onOpenTarget: async () => {},
      onCopyPath: async () => {},
      onFetchThreadMetadata: async () => ({
        workspaceId: "wks_test",
        workspaceTitle: "Test Thread",
        assignedLabels: [...assigned],
        catalog: [...catalog],
      }),
      onToggleLabel: async (labelName) => {
        toggleOrder.push(labelName);
        await new Promise((r) => setTimeout(r, labelName === "star" ? 25 : 5));
        if (assigned.has(labelName)) assigned.delete(labelName);
        else assigned.add(labelName);
        return {
          workspaceId: "wks_test",
          workspaceTitle: "Test Thread",
          assignedLabels: [...assigned],
          catalog: [...catalog],
        };
      },
    },
    doc,
    win,
  );

  // Open via Cmd+L
  const openRes = fireWinKeyDown({ key: "l", code: "KeyL", metaKey: true });
  assert.equal(openRes.defaultPrevented, true);
  await new Promise((r) => setTimeout(r, 30));

  const bar = body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]') as
    | (MinimalElement & { children?: MinimalElement[] })
    | null;
  assert.ok(bar, "Labels bar should open on Cmd+L");

  // Badges 1..9 exist, 10th chip has no badge
  assert.equal(
    bar.querySelector?.('[data-testid="label-shortcut-hint-star"]')?.textContent,
    "1",
  );
  assert.equal(
    bar.querySelector?.('[data-testid="label-shortcut-hint-nine"]')?.textContent,
    "9",
  );
  assert.equal(bar.querySelector?.('[data-testid="label-shortcut-hint-ten"]'), null);

  // Rapidly press 1 then 3 while RPC is slower for #1 -> both must apply in order!
  const k1 = fireWinKeyDown({ key: "1", code: "Digit1" });
  const k3 = fireWinKeyDown({ key: "3", code: "Digit3" });
  assert.equal(k1.defaultPrevented, true);
  assert.equal(k3.defaultPrevented, true);

  // Repeat keydown must not toggle again
  const k1Repeat = fireWinKeyDown({ key: "1", code: "Digit1", repeat: true });
  assert.equal(k1Repeat.defaultPrevented, true);

  await new Promise((r) => setTimeout(r, 70));
  assert.deepEqual(toggleOrder, ["star", "feat"]);
  assert.equal(assigned.has("star"), true);
  assert.equal(assigned.has("feat"), true);

  const chipStar = bar.querySelector?.('[data-testid="quick-label-chip-star"]');
  assert.ok((chipStar?.textContent ?? "").includes("star ✓"));

  // Typing into labelInput switches hints to ⌘1..⌘9 and allows plain digits
  const inputs = Array.from(bar.querySelectorAll?.("input") ?? []);
  const titleInput = inputs[0] as MinimalElement & { dispatch?: (t: string) => void };
  const labelInput = inputs[1] as MinimalElement & { dispatch?: (t: string) => void };
  assert.ok(titleInput && labelInput);

  labelInput.focus?.();
  labelInput.value = "v";
  labelInput.dispatch?.("input");
  assert.equal(
    bar.querySelector?.('[data-testid="label-shortcut-hint-star"]')?.textContent,
    "⌘1",
  );
  const plainDigitWhileTyping = fireWinKeyDown({ key: "2", code: "Digit2", target: labelInput });
  assert.equal(plainDigitWhileTyping.defaultPrevented, false);

  // Cmd+2 still toggles even while labelInput has text
  const cmdDigitWhileTyping = fireWinKeyDown({
    key: "2",
    code: "Digit2",
    metaKey: true,
    target: labelInput,
  });
  assert.equal(cmdDigitWhileTyping.defaultPrevented, true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(assigned.has("think"), false);

  // Clearing labelInput restores 1..9 hints
  labelInput.value = "";
  labelInput.dispatch?.("input");
  assert.equal(
    bar.querySelector?.('[data-testid="label-shortcut-hint-star"]')?.textContent,
    "1",
  );

  // Focusing titleInput switches hints to ⌘1..⌘9 and lets plain digits into title
  titleInput.focus?.();
  assert.equal(
    bar.querySelector?.('[data-testid="label-shortcut-hint-star"]')?.textContent,
    "⌘1",
  );
  const plainInTitle = fireWinKeyDown({ key: "4", code: "Digit4", target: titleInput });
  assert.equal(plainInTitle.defaultPrevented, false);

  // Escape closes bar and removes listener so pressing 1 no longer toggles
  fireWinKeyDown({ key: "Escape" });
  const prevCount = toggleOrder.length;
  const afterClose = fireWinKeyDown({ key: "1", code: "Digit1" });
  assert.equal(afterClose.defaultPrevented, false);
  assert.equal(toggleOrder.length, prevCount);

  // Test modifier-only preference
  syncInlineRenamePreferences({ labelNumberShortcutMode: "modifier-only" }, win.localStorage);
  await triggerQuickThreadMetadataBar("labels");
  const barMod = body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]');
  assert.equal(
    barMod?.querySelector?.('[data-testid="label-shortcut-hint-star"]')?.textContent,
    "⌘1",
  );
  const plainInModOnly = fireWinKeyDown({ key: "1", code: "Digit1" });
  assert.equal(plainInModOnly.defaultPrevented, false);
  const cmdInModOnly = fireWinKeyDown({ key: "1", code: "Digit1", metaKey: true });
  assert.equal(cmdInModOnly.defaultPrevented, true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(assigned.has("star"), false);

  cleanup();
});

test("4. Cmd+L never dispatches synthetic Escape when no native menu is open (prevents interrupting running agent)", async () => {
  const { body, doc, win, fireWinKeyDown } = createFakeDom();
  const dispatchedEscapes: Array<{ target: string; key: string }> = [];

  (doc as unknown as { dispatchEvent?: (ev: unknown) => boolean }).dispatchEvent = (
    ev: unknown,
  ) => {
    const e = ev as { key?: string };
    if (e?.key === "Escape") {
      dispatchedEscapes.push({ target: "doc", key: e.key });
    }
    return true;
  };
  (win as unknown as { dispatchEvent?: (ev: unknown) => boolean }).dispatchEvent = (
    ev: unknown,
  ) => {
    const e = ev as { key?: string };
    if (e?.key === "Escape") {
      dispatchedEscapes.push({ target: "win", key: e.key });
    }
    return true;
  };
  (win as unknown as { KeyboardEvent?: unknown }).KeyboardEvent = class FakeKeyboardEvent {
    key: string;
    code: string;
    constructor(_type: string, init: { key?: string; code?: string } = {}) {
      this.key = init.key ?? "";
      this.code = init.code ?? "";
    }
  };

  let composerBlurCount = 0;
  const composerInput = doc.createElement("textarea") as MinimalElement & { blur?: () => void };
  composerInput.blur = () => {
    composerBlurCount += 1;
  };
  body.appendChild?.(composerInput);

  // Track showPopover / hidePopover calls when opening & closing the bar
  let showPopoverCalls = 0;
  let hidePopoverCalls = 0;
  const origCreate = doc.createElement.bind(doc);
  doc.createElement = (tag: string) => {
    const el = origCreate(tag) as MinimalElement & {
      showPopover?: () => void;
      hidePopover?: () => void;
    };
    el.showPopover = () => {
      showPopoverCalls += 1;
    };
    el.hidePopover = () => {
      hidePopoverCalls += 1;
    };
    return el;
  };

  const cleanup = installDesktopRevealHelpers(
    {
      isEnabled: () => true,
      onOpenTarget: async () => {},
      onCopyPath: async () => {},
      onFetchThreadMetadata: async () => ({
        workspaceId: "wks_running",
        workspaceTitle: "Running Thread",
        assignedLabels: [],
        catalog: [{ name: "star", color: "amber" }],
      }),
    },
    doc,
    win,
  );

  // Simulate Paseo's Cmd+L focus-message-input having just moved doc.activeElement to composerInput
  // even when the keyboard event target was still document.body:
  composerInput.focus?.();
  const openRes = fireWinKeyDown({
    key: "l",
    code: "KeyL",
    metaKey: true,
    target: body,
  });
  assert.equal(openRes.defaultPrevented, true);
  assert.equal(openRes.immediateStopped, true);
  assert.equal(composerBlurCount, 1, "Cmd+L blurs doc.activeElement composer even when target is body");
  await new Promise((r) => setTimeout(r, 30));

  // Must NEVER emit Escape into document/window (which would trigger Paseo agent.interrupt)
  assert.equal(
    dispatchedEscapes.length,
    0,
    "Cmd+L with no open native menu must dispatch zero Escape events",
  );

  const mountedBar = body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]');
  assert.ok(mountedBar);
  assert.equal(mountedBar.getAttribute?.("popover"), "manual");
  assert.equal(showPopoverCalls, 1, "Quick labels bar opens as DOM popover so Paseo skips Escape interrupt");

  // Also test Escape closing the labels bar hides popover and blocks propagation to agent.interrupt
  const escRes = fireWinKeyDown({ key: "Escape" });
  assert.equal(escRes.defaultPrevented, true);
  assert.equal(escRes.immediateStopped, true);
  assert.equal(hidePopoverCalls, 1);
  assert.equal(body.querySelector?.('[data-testid="paseo-finder-quick-thread-bar"]'), null);

  cleanup();
});

test("5. dismissNativeMenu clicks MenuOverlay backdrop when open and cmd_shift_l preserves composer focus on Cmd+L", () => {
  const { body, doc, win, fireWinKeyDown } = createFakeDom();
  const dispatchedEscapes: string[] = [];
  (win as unknown as { dispatchEvent?: (ev: unknown) => boolean }).dispatchEvent = (
    ev: unknown,
  ) => {
    const e = ev as { key?: string };
    if (e?.key === "Escape") dispatchedEscapes.push("win");
    return true;
  };
  (doc as unknown as { dispatchEvent?: (ev: unknown) => boolean }).dispatchEvent = (
    ev: unknown,
  ) => {
    const e = ev as { key?: string };
    if (e?.key === "Escape") dispatchedEscapes.push("doc");
    return true;
  };
  (win as unknown as { KeyboardEvent?: unknown }).KeyboardEvent = class FakeKeyboardEvent {
    key: string;
    constructor(_type: string, init: { key?: string } = {}) {
      this.key = init.key ?? "";
    }
  };

  // A) When Paseo MenuOverlay with backdrop is open, dismissNativeMenu clicks backdrop with 0 Escapes
  const overlayWrapper = doc.createElement("div");
  const backdropEl = doc.createElement("div");
  backdropEl.setAttribute?.("data-testid", "ctx-menu-backdrop");
  let backdropClicked = false;
  backdropEl.addEventListener?.("click", () => {
    backdropClicked = true;
    overlayWrapper.remove?.();
  });
  const menuSurface = doc.createElement("div");
  menuSurface.setAttribute?.("data-menu-surface", "true");
  overlayWrapper.appendChild?.(backdropEl);
  overlayWrapper.appendChild?.(menuSurface);
  body.appendChild?.(overlayWrapper);

  dismissNativeMenu(win, doc);
  assert.equal(backdropClicked, true, "Backdrop click should close Paseo MenuOverlay");
  assert.equal(dispatchedEscapes.length, 0, "Zero Escape events emitted when backdrop closes menu");

  // B) Fallback: when data-menu-surface="true" has no backdrop, emit at most 1 Escape on win only
  const menuNoBackdrop = doc.createElement("div");
  menuNoBackdrop.setAttribute?.("data-menu-surface", "true");
  body.appendChild?.(menuNoBackdrop);
  dismissNativeMenu(win, doc);
  assert.deepEqual(dispatchedEscapes, ["win"]);
  menuNoBackdrop.remove?.();

  // C) When labelShortcutCombo is "cmd_shift_l", pressing Cmd+L must NOT blur the focused composer
  let composerBlurred = false;
  const composerInput = doc.createElement("textarea") as MinimalElement & { blur?: () => void };
  composerInput.blur = () => {
    composerBlurred = true;
  };
  body.appendChild?.(composerInput);

  syncInlineRenamePreferences({ labelShortcutCombo: "cmd_shift_l" }, win.localStorage);
  let fetchCalled = false;
  const cleanup = installDesktopRevealHelpers(
    {
      isEnabled: () => true,
      onOpenTarget: async () => {},
      onCopyPath: async () => {},
      onFetchThreadMetadata: async () => {
        fetchCalled = true;
        return null;
      },
    },
    doc,
    win,
  );

  const cmdLRes = fireWinKeyDown({
    key: "l",
    code: "KeyL",
    metaKey: true,
    shiftKey: false,
    target: composerInput,
  });
  assert.equal(cmdLRes.defaultPrevented, false, "Cmd+L passes through when combo is cmd_shift_l");
  assert.equal(composerBlurred, false, "Cmd+L must not blur composer when combo is cmd_shift_l");
  assert.equal(fetchCalled, false);

  cleanup();
});
