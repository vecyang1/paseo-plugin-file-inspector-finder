import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROJECT_PICKER_SHORTCUT_PREFS,
  PROJECT_PICKER_ADD_TESTID,
  PROJECT_PICKER_OPTION_PREFIX,
  PROJECT_PICKER_SEARCH_PLACEHOLDER,
  PROJECT_PICKER_TRIGGER_TESTID,
  captureKeyboardEventAsShortcut,
  findOpenProjectPicker,
  findProjectPickerTriggers,
  formatAriaKeyShortcut,
  formatProjectPickerShortcutDisplay,
  getProjectPickerShortcutStatus,
  installProjectPickerShortcut,
  isMacPlatform,
  isProjectPickerShortcutEvent,
  matchesParsedShortcutChord,
  normalizeProjectPickerShortcutPrefs,
  openProjectPickerFromShortcut,
  parseProjectPickerShortcutChord,
  pickProjectPickerTrigger,
  readProjectPickerShortcutPrefs,
  readProjectPickerShortcutReceipts,
  resolveActiveShortcutChord,
  resolveShortcutSpecForPrefs,
  runProjectPickerShortcutSelfTest,
  syncProjectPickerShortcutPrefs,
} from "../client/project-picker-shortcut-web";
import {
  ProjectPickerShortcutPresetSchema,
  pluginSettings,
} from "../shared/contracts";

// Prefs and receipts live in localStorage; provide an in-memory one for node:test.
const memory = new Map<string, string>();
(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  },
  dispatchEvent: () => true,
  setTimeout: (fn: () => void) => {
    fn();
    return 1;
  },
  clearTimeout: () => {},
  requestAnimationFrame: (fn: () => void) => {
    fn();
    return 1;
  },
  cancelAnimationFrame: () => {},
};

// --- Tiny fake DOM mirroring Paseo's web view
type FakeNode = {
  attrs: Map<string, string>;
  children: FakeNode[];
  parentElement: FakeNode | null;
  textContent: string;
  value?: string;
  clicks: number;
  focusCalls: number;
  isConnected: boolean;
  tagName?: string;
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
  contains(o: unknown): boolean;
  closest(sel: string): FakeNode | null;
  querySelectorAll(sel: string): FakeNode[];
  querySelector(sel: string): FakeNode | null;
  click(): void;
  focus(): void;
  getClientRects(): { length: number };
  onClick?: () => void;
  dispatchEvent?: (ev: unknown) => boolean;
};

function matchesSelector(node: FakeNode, selector: string): boolean {
  return selector.split(",").some((part) => {
    const trimmed = part.trim();
    if (trimmed.startsWith(".")) {
      const cls = (node.attrs.get("class") ?? "").split(" ");
      return cls.includes(trimmed.slice(1));
    }
    const tagMatch = /^([a-zA-Z]+)(.*)$/.exec(trimmed);
    if (tagMatch && tagMatch[2]) {
      const tag = tagMatch[1]!.toUpperCase();
      if ((node.tagName ?? "").toUpperCase() !== tag) return false;
      return matchesSelector(node, tagMatch[2]!);
    }
    if (/^[a-zA-Z]+$/.test(trimmed)) {
      return (node.tagName ?? "").toUpperCase() === trimmed.toUpperCase();
    }
    const attrMatch = /^\[([\w-]+)(?:(\^?=)"([^"]*)")?\]$/.exec(trimmed);
    if (attrMatch) {
      const attrName = attrMatch[1]!;
      const value = node.attrs.get(attrName);
      if (value === undefined) return false;
      if (!attrMatch[2]) return true;
      return attrMatch[2] === "=" ? value === attrMatch[3] : value.startsWith(attrMatch[3]!);
    }
    return false;
  });
}

function descendants(node: FakeNode): FakeNode[] {
  return node.children.flatMap((c) => [c, ...descendants(c)]);
}

function el(
  attrs: Record<string, string> = {},
  children: FakeNode[] = [],
  text = "",
  tagName = "DIV",
): FakeNode {
  const node: FakeNode = {
    attrs: new Map(Object.entries(attrs)),
    children,
    parentElement: null,
    textContent: text,
    clicks: 0,
    focusCalls: 0,
    isConnected: true,
    tagName,
    getAttribute: (n) => node.attrs.get(n) ?? null,
    setAttribute: (n, v) => void node.attrs.set(n, v),
    removeAttribute: (n) => void node.attrs.delete(n),
    contains: (o) => o === node || descendants(node).includes(o as FakeNode),
    closest: (sel) => {
      for (let n: FakeNode | null = node; n; n = n.parentElement) {
        if (matchesSelector(n, sel)) return n;
      }
      return null;
    },
    querySelectorAll: (sel) => descendants(node).filter((d) => matchesSelector(d, sel)),
    querySelector: (sel) => descendants(node).find((d) => matchesSelector(d, sel)) ?? null,
    click: () => {
      node.clicks += 1;
      node.onClick?.();
    },
    focus: () => {
      node.focusCalls += 1;
    },
    getClientRects: () => ({ length: 1 }),
    dispatchEvent: () => true,
  };
  for (const child of children) child.parentElement = node;
  if (!text) node.textContent = children.map((c) => c.textContent).join("");
  return node;
}

function buildFakePaseoWorkspace(options: { twoPanes?: boolean; pickerOpen?: boolean } = {}) {
  const textareaA = el(
    { "data-composer-input": "true", placeholder: "Ask anything..." },
    [],
    "",
    "TEXTAREA",
  );
  const triggerA = el(
    {
      "data-testid": PROJECT_PICKER_TRIGGER_TESTID,
      "aria-label": "Workspace project",
    },
    [],
    "alpha-project",
    "BUTTON",
  );
  const paneA = el({}, [textareaA, triggerA]);

  const textareaB = el(
    { "data-composer-input": "true", placeholder: "Ask anything..." },
    [],
    "",
    "TEXTAREA",
  );
  const triggerB = el(
    {
      "data-testid": PROJECT_PICKER_TRIGGER_TESTID,
      "aria-label": "Workspace project",
    },
    [],
    "beta-project",
    "BUTTON",
  );
  const paneB = el({}, [textareaB, triggerB]);

  const searchInput = el(
    { placeholder: PROJECT_PICKER_SEARCH_PLACEHOLDER },
    [],
    "",
    "INPUT",
  );
  const opt1 = el({ "data-testid": `${PROJECT_PICKER_OPTION_PREFIX}p1` }, [], "alpha-project");
  const opt2 = el({ "data-testid": `${PROJECT_PICKER_OPTION_PREFIX}p2` }, [], "beta-project");
  const addBtn = el({ "data-testid": PROJECT_PICKER_ADD_TESTID }, [], "+ Add project");
  const comboboxDialog = el(
    { role: "dialog", "data-testid": "combobox-desktop-container" },
    [searchInput, opt1, opt2, addBtn],
  );

  const panes = el({}, options.twoPanes ? [paneA, paneB] : [paneA]);
  const body = el({}, options.pickerOpen ? [panes, comboboxDialog] : [panes], "", "BODY");

  const doc = {
    body,
    defaultView: (globalThis as Record<string, unknown>).window as Window,
    activeElement: textareaA as FakeNode | null,
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
    querySelector: (sel: string) => body.querySelector(sel),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  return {
    doc,
    body,
    panes,
    paneA,
    paneB,
    textareaA,
    textareaB,
    triggerA,
    triggerB,
    comboboxDialog,
    searchInput,
    opt1,
    opt2,
    addBtn,
  };
}

test("project picker shortcut: schema shape and defaults", () => {
  const shape = (pluginSettings as unknown as { schema: { shape: Record<string, unknown> } }).schema.shape;
  assert.ok("enableProjectPickerShortcut" in shape);
  assert.ok("projectPickerShortcutPreset" in shape);
  assert.ok("projectPickerCustomShortcut" in shape);

  assert.equal(ProjectPickerShortcutPresetSchema.parse("alt_p"), "alt_p");
  assert.equal(ProjectPickerShortcutPresetSchema.parse("cmd_shift_j"), "cmd_shift_j");
  assert.equal(ProjectPickerShortcutPresetSchema.parse("cmd_alt_o"), "cmd_alt_o");
  assert.equal(ProjectPickerShortcutPresetSchema.parse("cmd_p"), "cmd_p");
  assert.equal(ProjectPickerShortcutPresetSchema.parse("custom"), "custom");
  assert.throws(() => ProjectPickerShortcutPresetSchema.parse("invalid_chord"));

  const normalizedDefault = normalizeProjectPickerShortcutPrefs(undefined);
  assert.deepEqual(normalizedDefault, DEFAULT_PROJECT_PICKER_SHORTCUT_PREFS);

  const customPrefs = normalizeProjectPickerShortcutPrefs({
    enabled: true,
    preset: "custom",
    customShortcut: "Mod+Shift+P",
  });
  assert.equal(customPrefs.preset, "custom");
  assert.equal(customPrefs.customShortcut, "Mod+Shift+P");

  const invalidPreset = normalizeProjectPickerShortcutPrefs({ preset: "unknown" });
  assert.equal(invalidPreset.preset, "alt_p");
});

test("project picker shortcut: chord parser and formatter", () => {
  // Preset specs
  const altP = parseProjectPickerShortcutChord("Alt+P");
  assert.ok(altP);
  assert.equal(altP.alt, true);
  assert.equal(altP.code, "KeyP");
  assert.equal(altP.key, "p");

  const modShiftJ = parseProjectPickerShortcutChord("Mod+Shift+J");
  assert.ok(modShiftJ);
  assert.equal(modShiftJ.mod, true);
  assert.equal(modShiftJ.shift, true);
  assert.equal(modShiftJ.code, "KeyJ");

  const modAltO = parseProjectPickerShortcutChord("⌘⌥O");
  assert.ok(modAltO);
  assert.equal(modAltO.meta, true);
  assert.equal(modAltO.alt, true);
  assert.equal(modAltO.code, "KeyO");

  const fnKey = parseProjectPickerShortcutChord("F4");
  assert.ok(fnKey);
  assert.equal(fnKey.code, "F4");

  // Bare letters without primary modifiers must be rejected to prevent hijacking normal typing
  assert.equal(parseProjectPickerShortcutChord("p"), null);
  assert.equal(parseProjectPickerShortcutChord("P"), null);
  assert.equal(parseProjectPickerShortcutChord("Shift+P"), null);
  assert.equal(parseProjectPickerShortcutChord(""), null);

  // Formatting displays
  assert.equal(formatProjectPickerShortcutDisplay(altP, true), "⌥P");
  assert.equal(formatProjectPickerShortcutDisplay(altP, false), "Alt+P");
  assert.equal(formatProjectPickerShortcutDisplay(modShiftJ, true), "⇧⌘J");
  assert.equal(formatProjectPickerShortcutDisplay(modShiftJ, false), "Ctrl+Shift+J");

  assert.equal(formatAriaKeyShortcut(altP, true), "Alt+P");
  assert.equal(formatAriaKeyShortcut(modShiftJ, true), "Shift+Meta+J");
  assert.equal(formatAriaKeyShortcut(modShiftJ, false), "Control+Shift+J");
});

test("project picker shortcut: event matching and macOS Option key translation", () => {
  const prefs = { enabled: true, preset: "alt_p" as const, customShortcut: "Alt+P" };
  const chord = resolveActiveShortcutChord(prefs)!;

  // On macOS Electron/Chromium, physical Alt+P sends code: "KeyP", key: "π"
  assert.equal(
    matchesParsedShortcutChord(
      { code: "KeyP", key: "π", altKey: true, metaKey: false, ctrlKey: false, shiftKey: false },
      chord,
      true,
    ),
    true,
  );

  // Fallback when code is missing but key is π
  assert.equal(
    matchesParsedShortcutChord(
      { key: "π", altKey: true, metaKey: false, ctrlKey: false, shiftKey: false },
      chord,
      true,
    ),
    true,
  );

  // Standard Alt+p on Linux / Windows
  assert.equal(
    matchesParsedShortcutChord(
      { code: "KeyP", key: "p", altKey: true, metaKey: false, ctrlKey: false, shiftKey: false },
      chord,
      false,
    ),
    true,
  );

  // Mismatched modifiers
  assert.equal(
    matchesParsedShortcutChord(
      { code: "KeyP", key: "P", altKey: true, shiftKey: true },
      chord,
      true,
    ),
    false,
  );

  // IME composition protection
  assert.equal(
    matchesParsedShortcutChord(
      { code: "KeyP", key: "π", altKey: true, isComposing: true },
      chord,
      true,
    ),
    false,
  );
  assert.equal(
    matchesParsedShortcutChord(
      { code: "KeyP", key: "π", altKey: true, keyCode: 229 },
      chord,
      true,
    ),
    false,
  );

  // When disabled
  assert.equal(
    isProjectPickerShortcutEvent(
      { code: "KeyP", key: "π", altKey: true },
      { ...prefs, enabled: false },
      true,
    ),
    false,
  );
});

test("project picker shortcut: live keyboard event capture in Settings", () => {
  // Capture Option+P on macOS
  const capturedAltP = captureKeyboardEventAsShortcut(
    { code: "KeyP", key: "π", altKey: true },
    true,
  );
  assert.ok(capturedAltP.ok);
  assert.equal(capturedAltP.spec, "Alt+P");
  assert.equal(capturedAltP.display, "⌥P");

  // Capture Cmd+Shift+J on macOS
  const capturedCmdShiftJ = captureKeyboardEventAsShortcut(
    { code: "KeyJ", key: "J", metaKey: true, shiftKey: true },
    true,
  );
  assert.ok(capturedCmdShiftJ.ok);
  assert.equal(capturedCmdShiftJ.spec, "Mod+Shift+J");
  assert.equal(capturedCmdShiftJ.display, "⇧⌘J");

  // Modifier-only events must not finalize
  const modifierOnly = captureKeyboardEventAsShortcut({ code: "AltLeft", key: "Alt", altKey: true }, true);
  assert.equal(modifierOnly.ok, false);
  assert.equal(modifierOnly.reason, "modifier-only");

  // Escape cancels
  const esc = captureKeyboardEventAsShortcut({ code: "Escape", key: "Escape" }, true);
  assert.equal(esc.ok, false);
  assert.equal(esc.reason, "cancelled");

  // Bare letter without modifier must be rejected
  const bareP = captureKeyboardEventAsShortcut({ code: "KeyP", key: "p" }, true);
  assert.equal(bareP.ok, false);
  assert.equal(bareP.reason, "requires-modifier");
});

test("project picker shortcut: DOM discovery and trigger picking", () => {
  const { doc, triggerA, triggerB, textareaB } = buildFakePaseoWorkspace({ twoPanes: true });
  const triggers = findProjectPickerTriggers(doc as never);
  assert.equal(triggers.length, 2);

  // First trigger picked by default
  assert.equal(pickProjectPickerTrigger(doc as never), triggerA);

  // Focus in second pane selects second pane's trigger
  doc.activeElement = textareaB;
  assert.equal(pickProjectPickerTrigger(doc as never), triggerB);
});

test("project picker shortcut: full installer lifecycle with toggle, search focus & composer restoration", () => {
  memory.clear();
  syncProjectPickerShortcutPrefs({ enabled: true, preset: "alt_p" });

  const screen = buildFakePaseoWorkspace();
  const { doc, body, panes, comboboxDialog, triggerA, textareaA, searchInput, opt1 } = screen;

  // Simulate Paseo native FieldTrigger (`onPress: W.open`) + Escape closing Combobox
  const setOpen = (open: boolean) => {
    body.children = open ? [panes, comboboxDialog] : [panes];
    comboboxDialog.parentElement = open ? body : null;
    comboboxDialog.isConnected = open;
  };
  triggerA.onClick = () => setOpen(true);
  opt1.onClick = () => setOpen(false);
  const onEsc = (ev: unknown) => {
    if ((ev as { key?: string })?.key === "Escape") {
      setOpen(false);
      return true;
    }
    return false;
  };
  searchInput.dispatchEvent = onEsc;
  comboboxDialog.dispatchEvent = onEsc;

  const listeners = new Map<string, (ev: unknown) => void>();
  const fakeWin = {
    navigator: { platform: "MacIntel", userAgent: "Macintosh" },
    localStorage: (globalThis as Record<string, unknown>).window as Window["localStorage"],
    addEventListener: (t: string, fn: (ev: unknown) => void) => void listeners.set(`win:${t}`, fn),
    removeEventListener: (t: string) => void listeners.delete(`win:${t}`),
    setTimeout: (fn: () => void) => {
      fn();
      return 1;
    },
    clearTimeout: () => {},
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 1;
    },
    cancelAnimationFrame: () => {},
  };

  const docWithWin = {
    ...doc,
    defaultView: fakeWin,
    addEventListener: (t: string, fn: (ev: unknown) => void) => void listeners.set(`doc:${t}`, fn),
    removeEventListener: (t: string) => void listeners.delete(`doc:${t}`),
  };

  const cleanup = installProjectPickerShortcut(docWithWin as never);
  const statusAfterInstall = getProjectPickerShortcutStatus(docWithWin as never);
  assert.equal(statusAfterInstall.installed, true);
  assert.equal(statusAfterInstall.currentProject, "alpha-project");
  assert.equal(triggerA.getAttribute("aria-keyshortcuts"), "Alt+P");

  // 1. Press shortcut while typing in composer textarea
  docWithWin.activeElement = textareaA;
  let prevented = false;
  listeners.get("win:keydown")?.({
    code: "KeyP",
    key: "π",
    altKey: true,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
    target: textareaA,
  });

  assert.equal(prevented, true, "shortcut must suppress default so π is not typed");
  assert.equal(triggerA.clicks, 1, "trigger must be clicked once");
  assert.ok(findOpenProjectPicker(docWithWin as never), "combobox picker must be open");
  assert.ok(searchInput.focusCalls > 0, "search input inside Combobox must receive focus");

  // 2. Select a project option through native click -> closes picker and restores focus to composer
  opt1.click();
  // In real Paseo, selecting an option closes the Combobox and leaves activeElement on the trigger
  docWithWin.activeElement = triggerA;
  assert.equal(findOpenProjectPicker(docWithWin as never), null, "picker closed");

  // Reconcile checks focus restoration
  cleanup.reconcileNow?.();
  assert.ok(textareaA.focusCalls > 0, "focus must return to composer textarea after selection");

  // 3. Test openProjectPickerFromShortcut() helper
  const openViaHelper = openProjectPickerFromShortcut();
  assert.equal(openViaHelper, true);
  assert.ok(findOpenProjectPicker(docWithWin as never));

  // 4. Pressing shortcut again while open toggles it closed
  listeners.get("win:keydown")?.({
    code: "KeyP",
    key: "π",
    altKey: true,
    preventDefault: () => {},
    stopPropagation: () => {},
    target: searchInput,
  });
  assert.equal(findOpenProjectPicker(docWithWin as never), null, "second press closed picker");

  // 5. Run self test
  const selfTestStatus = runProjectPickerShortcutSelfTest(docWithWin as never);
  assert.ok(selfTestStatus.receipts.length > 0);
  assert.equal(selfTestStatus.receipts[0]!.ok, true);

  // 5b. Cross-tab storage sync updates aria-keyshortcuts without reload
  memory.set(
    "paseo:finder-plugin:project-picker-shortcut",
    JSON.stringify({ enabled: true, preset: "cmd_shift_j", customShortcut: "Alt+P" }),
  );
  listeners.get("win:storage")?.({ key: "paseo:finder-plugin:project-picker-shortcut" });
  assert.equal(triggerA.getAttribute("aria-keyshortcuts"), "Shift+Meta+J");

  // 6. Cleanup removes listeners and clears activeOpen
  cleanup();
  assert.equal(openProjectPickerFromShortcut(), false);
  assert.equal(getProjectPickerShortcutStatus(docWithWin as never).installed, false);
});

test("project picker shortcut: compact bottom-sheet modal detection and closing", () => {
  memory.clear();
  const searchInput = el(
    { placeholder: PROJECT_PICKER_SEARCH_PLACEHOLDER },
    [],
    "",
    "INPUT",
  );
  const bottomSheet = el(
    { role: "slider", "aria-label": "Bottom Sheet" },
    [searchInput],
  );
  const root = el({ id: "root" }, [bottomSheet]);
  const doc = el({}, [root]);
  (doc as unknown as { body?: FakeNode }).body = root;

  let closedViaFiber = false;
  (searchInput as unknown as Record<string, unknown>).__reactFiber$fake = {
    memoizedProps: {
      onClose: () => {
        closedViaFiber = true;
      },
    },
    return: null,
  };

  const detected = findOpenProjectPicker(doc as never);
  assert.ok(detected, "must detect compact bottom-sheet project picker");
  assert.equal(detected?.searchInput, searchInput);

  const listeners = new Map<string, (ev: unknown) => void>();
  const fakeWin = {
    navigator: { platform: "MacIntel", userAgent: "Macintosh" },
    localStorage: (globalThis as Record<string, unknown>).window as Window["localStorage"],
    addEventListener: (t: string, fn: (ev: unknown) => void) => void listeners.set(`win:${t}`, fn),
    removeEventListener: (t: string) => void listeners.delete(`win:${t}`),
    setTimeout: (fn: () => void) => {
      fn();
      return 1;
    },
    clearTimeout: () => {},
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 1;
    },
    cancelAnimationFrame: () => {},
  };
  const docWithWin = {
    ...doc,
    body: root,
    defaultView: fakeWin,
    addEventListener: (t: string, fn: (ev: unknown) => void) => void listeners.set(`doc:${t}`, fn),
    removeEventListener: (t: string) => void listeners.delete(`doc:${t}`),
    activeElement: searchInput,
  };

  const cleanup = installProjectPickerShortcut(docWithWin as never);
  // Reconcile establishes wasPickerOpen
  cleanup.reconcileNow?.();

  // Press shortcut while picker is open -> must close via fiber onClose
  listeners.get("win:keydown")?.({
    code: "KeyP",
    key: "π",
    altKey: true,
    preventDefault: () => {},
    stopPropagation: () => {},
    target: searchInput,
  });

  assert.equal(closedViaFiber, true, "compact bottom-sheet must be closed via React Fiber onClose");
  cleanup();
});

test("project picker shortcut: Cmd+P race condition on /new keeps open and toggle-closes", () => {
  memory.clear();
  syncProjectPickerShortcutPrefs({
    enabled: true,
    preset: "cmd_p",
    customShortcut: "Mod+P",
  });

  const { doc, body, panes, triggerA, textareaA, searchInput, comboboxDialog } = buildFakePaseoWorkspace({
    pickerOpen: false,
  });

  let pickerMounted = false;
  const setPickerMounted = (open: boolean) => {
    pickerMounted = open;
    body.children = open ? [panes, comboboxDialog] : [panes];
    comboboxDialog.parentElement = open ? body : null;
    comboboxDialog.isConnected = open;
  };

  triggerA.onClick = () => {
    setPickerMounted(!pickerMounted);
  };

  const handleEscape = (ev: unknown) => {
    if ((ev as { key?: string })?.key === "Escape") {
      setPickerMounted(false);
      return true;
    }
    return false;
  };
  searchInput.dispatchEvent = handleEscape;
  comboboxDialog.dispatchEvent = handleEscape;

  const listeners = new Map<string, (ev: unknown) => void>();
  const fakeWin = {
    navigator: { platform: "MacIntel", userAgent: "Macintosh" },
    localStorage: (globalThis as Record<string, unknown>).window as Window["localStorage"],
    addEventListener: (t: string, fn: (ev: unknown) => void) => void listeners.set(`win:${t}`, fn),
    removeEventListener: (t: string) => void listeners.delete(`win:${t}`),
    setTimeout: (fn: () => void) => {
      fn();
      return 1;
    },
    clearTimeout: () => {},
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 1;
    },
    cancelAnimationFrame: () => {},
  };

  const docWithWin = {
    ...doc,
    defaultView: fakeWin,
    addEventListener: (t: string, fn: (ev: unknown) => void) => void listeners.set(`doc:${t}`, fn),
    removeEventListener: (t: string) => void listeners.delete(`doc:${t}`),
  };

  const cleanup = installProjectPickerShortcut(docWithWin as never);

  // Initial state: picker is NOT open
  assert.equal(findOpenProjectPicker(docWithWin as never), null);

  // Press 1: Simulate Paseo core's `useKeyboardShortcuts` running first on keydown
  // Paseo core dispatches workspace.project.pick synchronously, opening the picker and preventing default!
  setPickerMounted(true);
  assert.ok(findOpenProjectPicker(docWithWin as never), "Paseo opened picker");

  // Now plugin's keydown listener runs on the same keydown event
  let prevented = false;
  listeners.get("win:keydown")?.({
    code: "KeyP",
    key: "p",
    metaKey: true,
    defaultPrevented: true,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
    target: textareaA,
  });

  // CRITICAL INVARIANT: Plugin must NOT immediately slam the picker shut!
  assert.ok(findOpenProjectPicker(docWithWin as never), "first Cmd+P press must KEEP the picker open");
  assert.ok(searchInput.focusCalls > 0, "must ensure search input is focused");

  // Press 2: User presses Cmd+P again while looking at the open picker -> TOGGLE-CLOSE!
  listeners.get("win:keydown")?.({
    code: "KeyP",
    key: "p",
    metaKey: true,
    defaultPrevented: true,
    preventDefault: () => {},
    stopPropagation: () => {},
    target: searchInput,
  });

  // Now picker must be closed!
  assert.equal(findOpenProjectPicker(docWithWin as never), null, "second Cmd+P press must toggle-close the picker");

  cleanup();
});

test("project picker shortcut: recovers focus after delayed compact Keyboard.dismiss without stealing option focus", () => {
  memory.clear();
  syncProjectPickerShortcutPrefs({ enabled: true, preset: "alt_p" });

  const { doc, body, panes, triggerA, textareaA, searchInput, comboboxDialog, opt1 } = buildFakePaseoWorkspace({
    pickerOpen: false,
  });

  triggerA.onClick = () => {
    body.children = [panes, comboboxDialog];
    comboboxDialog.parentElement = body;
    comboboxDialog.isConnected = true;
    // Simulate Paseo useDismissKeyboardOnOpen immediate dismiss to body
    doc.activeElement = body;
  };

  const listeners = new Map<string, (ev: unknown) => void>();
  const scheduled: Array<{ delay: number; fn: () => void; cancelled: boolean }> = [];
  const fakeWin = {
    navigator: { platform: "MacIntel", userAgent: "Macintosh" },
    localStorage: (globalThis as Record<string, unknown>).window as Window["localStorage"],
    addEventListener: (t: string, fn: (ev: unknown) => void) => void listeners.set(`win:${t}`, fn),
    removeEventListener: (t: string) => void listeners.delete(`win:${t}`),
    setTimeout: (fn: () => void, ms = 0) => {
      const entry = { delay: ms, fn, cancelled: false };
      scheduled.push(entry);
      return scheduled.length;
    },
    clearTimeout: (id: number) => {
      const entry = scheduled[id - 1];
      if (entry) entry.cancelled = true;
    },
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 1;
    },
    cancelAnimationFrame: () => {},
  };

  const docWithWin = {
    ...doc,
    get activeElement() {
      return doc.activeElement;
    },
    set activeElement(v) {
      doc.activeElement = v;
    },
    defaultView: fakeWin,
    addEventListener: (t: string, fn: (ev: unknown) => void) => void listeners.set(`doc:${t}`, fn),
    removeEventListener: (t: string) => void listeners.delete(`doc:${t}`),
  };

  searchInput.focus = () => {
    searchInput.focusCalls += 1;
    doc.activeElement = searchInput;
  };

  const cleanup = installProjectPickerShortcut(docWithWin as never);
  doc.activeElement = textareaA;

  listeners.get("win:keydown")?.({
    code: "KeyP",
    key: "π",
    altKey: true,
    preventDefault: () => {},
    stopPropagation: () => {},
    target: textareaA,
  });

  // Run early timers (< 150ms)
  for (const t of scheduled.filter((e) => !e.cancelled && e.delay < 150)) {
    t.fn();
  }
  assert.equal(doc.activeElement, searchInput, "initial focus moves to Search projects");

  // Simulate Paseo BottomSheet's setTimeout(Keyboard.dismiss, 150) blurring back to body
  doc.activeElement = body;

  // Run post-150ms recovery timers (>= 150ms)
  for (const t of scheduled.filter((e) => !e.cancelled && e.delay >= 150 && e.delay < 300)) {
    t.fn();
  }
  assert.equal(doc.activeElement, searchInput, "post-150ms recovery restores focus to Search projects");

  // If user subsequently moves focus onto an option inside the picker, late check (>= 300ms) must NOT yank focus away
  doc.activeElement = opt1;
  const focusCallsBeforeLate = searchInput.focusCalls;
  for (const t of scheduled.filter((e) => !e.cancelled && e.delay >= 300)) {
    t.fn();
  }
  assert.equal(doc.activeElement, opt1, "does not yank focus away from option inside picker");
  assert.equal(searchInput.focusCalls, focusCallsBeforeLate, "no redundant focus() when inside picker");

  cleanup();
});

test("cross-evaluation handoff keeps openProjectPickerFromShortcut working and supports silentNoTrigger", () => {
  const attachWin = (doc: ReturnType<typeof buildFakePaseoWorkspace>["doc"]) => {
    const fakeWin = {
      navigator: { platform: "MacIntel", userAgent: "Macintosh" },
      localStorage: ((globalThis as Record<string, unknown>).window as Window).localStorage,
      addEventListener: () => {},
      removeEventListener: () => {},
      setTimeout: (fn: () => void) => {
        fn();
        return 1;
      },
      clearTimeout: () => {},
      requestAnimationFrame: (fn: () => void) => {
        fn();
        return 1;
      },
      cancelAnimationFrame: () => {},
    };
    return {
      ...doc,
      get activeElement() {
        return doc.activeElement;
      },
      set activeElement(v) {
        doc.activeElement = v;
      },
      defaultView: fakeWin,
    };
  };

  const { doc: rawDoc1 } = buildFakePaseoWorkspace();
  const cleanup1 = installProjectPickerShortcut(attachWin(rawDoc1) as never);

  // Silent check on a screen without triggers should return false and emit zero error receipts
  const { doc: rawEmptyDoc } = buildFakePaseoWorkspace();
  rawEmptyDoc.querySelectorAll = () => [];
  cleanup1();
  const cleanupEmpty = installProjectPickerShortcut(attachWin(rawEmptyDoc) as never);
  const receiptsBeforeSilent = readProjectPickerShortcutReceipts().length;
  assert.equal(openProjectPickerFromShortcut({ silentNoTrigger: true }), false);
  assert.equal(readProjectPickerShortcutReceipts().length, receiptsBeforeSilent, "silentNoTrigger skips error receipt");
  cleanupEmpty();

  // Simulate old evaluation cleaned up while a new evaluation mounts after route navigation
  const cleanupStale = installProjectPickerShortcut(attachWin(rawEmptyDoc) as never);
  cleanupStale();
  assert.equal(openProjectPickerFromShortcut({ silentNoTrigger: true }), false);

  const { doc: rawDoc2, triggerA, body, panes, comboboxDialog } = buildFakePaseoWorkspace();
  triggerA.onClick = () => {
    body.children = [panes, comboboxDialog];
    comboboxDialog.parentElement = body;
    comboboxDialog.isConnected = true;
  };
  const cleanupNew = installProjectPickerShortcut(attachWin(rawDoc2) as never);
  assert.equal(openProjectPickerFromShortcut(), true, "new instance opens picker cleanly");
  assert.equal(Boolean(findOpenProjectPicker(rawDoc2 as never)), true);

  cleanupNew();
});

test("project picker shortcut: restores composer focus even when closed sheet leaves detached or hidden active element", () => {
  memory.clear();
  syncProjectPickerShortcutPrefs({ enabled: true, preset: "alt_p" });

  const { doc, body, panes, triggerA, textareaA, searchInput, comboboxDialog } = buildFakePaseoWorkspace({
    pickerOpen: false,
  });

  textareaA.focus = () => {
    textareaA.focusCalls += 1;
    doc.activeElement = textareaA;
  };

  triggerA.onClick = () => {
    body.children = [panes, comboboxDialog];
    comboboxDialog.parentElement = body;
    comboboxDialog.isConnected = true;
    doc.activeElement = searchInput;
  };

  const listeners = new Map<string, (ev: unknown) => void>();
  const fakeWin = {
    navigator: { platform: "MacIntel", userAgent: "Macintosh" },
    localStorage: ((globalThis as Record<string, unknown>).window as Window).localStorage,
    addEventListener: (t: string, fn: (ev: unknown) => void) => void listeners.set(`win:${t}`, fn),
    removeEventListener: (t: string) => void listeners.delete(`win:${t}`),
    setTimeout: (fn: () => void) => {
      fn();
      return 1;
    },
    clearTimeout: () => {},
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 1;
    },
    cancelAnimationFrame: () => {},
  };

  const docWithWin = {
    ...doc,
    get activeElement() {
      return doc.activeElement;
    },
    set activeElement(v) {
      doc.activeElement = v;
    },
    defaultView: fakeWin,
    addEventListener: (t: string, fn: (ev: unknown) => void) => void listeners.set(`doc:${t}`, fn),
    removeEventListener: (t: string) => void listeners.delete(`doc:${t}`),
  };

  const cleanup = installProjectPickerShortcut(docWithWin as never);
  doc.activeElement = textareaA;
  const focusBefore = textareaA.focusCalls;

  listeners.get("win:keydown")?.({
    code: "KeyP",
    key: "π",
    altKey: true,
    preventDefault: () => {},
    stopPropagation: () => {},
    target: textareaA,
  });
  assert.equal(doc.activeElement, searchInput);

  // Simulate animated compact BottomSheet hiding / detaching searchInput without synchronously blurring to body
  body.children = [panes];
  comboboxDialog.parentElement = null;
  comboboxDialog.isConnected = false;
  searchInput.isConnected = false;
  doc.activeElement = searchInput;

  cleanup.reconcileNow?.();

  assert.equal(doc.activeElement, textareaA, "focus must return to composer when closing sheet leaves detached active element");
  assert.ok(textareaA.focusCalls > focusBefore);
  cleanup();
});
