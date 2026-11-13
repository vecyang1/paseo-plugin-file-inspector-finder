import assert from "node:assert/strict";
import test from "node:test";
import {
  isPreviousThreadKeyboardEvent,
  isNextThreadKeyboardEvent,
  isPinWorkspaceKeyboardEvent,
  isEditableInput,
  isBlockedFromThreadNavigation,
  healWorkspaceBubblesAfterShift,
  resetThreadNavigationStateForTests,
  matchesWorkspaceRowTestId,
  simulateReactNativePress,
  navigateSidebarThreadRelative,
  toggleActiveWorkspacePin,
  shouldTriggerPinWorkspaceShortcut,
  annotateNativeWorkspaceMenusWithShortcuts,
  syncInlineRenamePreferences,
  readInlineRenamePreferences,
  type MinimalElement,
  type MinimalDocument,
  type MinimalWindow,
  type MinimalKeyboardEvent,
  type MinimalStorage,
} from "../client/web";
import { pluginSettings } from "../shared/contracts";

function fakeKe(init: Record<string, unknown>): MinimalKeyboardEvent {
  return {
    key: (init.key as string) ?? "",
    preventDefault: () => {},
    stopPropagation: () => {},
    ...init,
  } as unknown as MinimalKeyboardEvent;
}

test("Thread Shortcuts 1: Keyboard event classification for Previous Thread (Cmd+; / Ctrl+;)", () => {
  // Mac: Cmd+;
  assert.equal(
    isPreviousThreadKeyboardEvent(
      fakeKe({
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        key: ";",
        code: "Semicolon",
        keyCode: 186,
      }),
    ),
    true,
  );

  // Non-Mac: Ctrl+;
  assert.equal(
    isPreviousThreadKeyboardEvent(
      fakeKe({
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: ";",
        code: "Semicolon",
        keyCode: 59,
      }),
    ),
    true,
  );

  // Negative checks
  assert.equal(isPreviousThreadKeyboardEvent(null), false);
  assert.equal(isPreviousThreadKeyboardEvent(undefined), false);

  // No modifier
  assert.equal(
    isPreviousThreadKeyboardEvent(
      fakeKe({
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        key: ";",
        code: "Semicolon",
      }),
    ),
    false,
  );

  // Shift modifier pressed (Cmd+Shift+;)
  assert.equal(
    isPreviousThreadKeyboardEvent(
      fakeKe({
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
        key: ";",
        code: "Semicolon",
      }),
    ),
    false,
  );

  // Alt modifier pressed (Cmd+Option+;)
  assert.equal(
    isPreviousThreadKeyboardEvent(
      fakeKe({
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        key: ";",
        code: "Semicolon",
      }),
    ),
    false,
  );

  // IME composition in progress
  assert.equal(
    isPreviousThreadKeyboardEvent(
      fakeKe({
        metaKey: true,
        key: ";",
        code: "Semicolon",
        isComposing: true,
      }),
    ),
    false,
  );
  assert.equal(
    isPreviousThreadKeyboardEvent(
      fakeKe({
        metaKey: true,
        key: ";",
        code: "Semicolon",
        keyCode: 229,
      }),
    ),
    false,
  );
});

test("Thread Shortcuts 2: Keyboard event classification for Next Thread (Cmd+' / Ctrl+')", () => {
  // Mac: Cmd+'
  assert.equal(
    isNextThreadKeyboardEvent(
      fakeKe({
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        key: "'",
        code: "Quote",
        keyCode: 222,
      }),
    ),
    true,
  );

  // Non-Mac: Ctrl+'
  assert.equal(
    isNextThreadKeyboardEvent(
      fakeKe({
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: "'",
        code: "Quote",
        keyCode: 222,
      }),
    ),
    true,
  );

  // Double quote key or code Quote
  assert.equal(
    isNextThreadKeyboardEvent(
      fakeKe({
        metaKey: true,
        key: '"',
        code: "Quote",
      }),
    ),
    true,
  );

  // Negative checks
  assert.equal(isNextThreadKeyboardEvent(null), false);

  // No modifier
  assert.equal(
    isNextThreadKeyboardEvent(
      fakeKe({
        metaKey: false,
        ctrlKey: false,
        key: "'",
        code: "Quote",
      }),
    ),
    false,
  );

  // Shift modifier (Cmd+Shift+')
  assert.equal(
    isNextThreadKeyboardEvent(
      fakeKe({
        metaKey: true,
        shiftKey: true,
        key: "'",
        code: "Quote",
      }),
    ),
    false,
  );

  // Alt modifier (Cmd+Option+')
  assert.equal(
    isNextThreadKeyboardEvent(
      fakeKe({
        metaKey: true,
        altKey: true,
        key: "'",
        code: "Quote",
      }),
    ),
    false,
  );

  // IME composition
  assert.equal(
    isNextThreadKeyboardEvent(
      fakeKe({
        metaKey: true,
        key: "'",
        isComposing: true,
      }),
    ),
    false,
  );
});

test("Thread Shortcuts 3: Keyboard event classification for Pin Workspace (Cmd+Option+P / Ctrl+Alt+P)", () => {
  // Mac: Cmd+Option+P with KeyP
  assert.equal(
    isPinWorkspaceKeyboardEvent(
      fakeKe({
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        key: "p",
        code: "KeyP",
        keyCode: 80,
      }),
    ),
    true,
  );

  // Mac: Option+P outputs 'π' on macOS Chromium
  assert.equal(
    isPinWorkspaceKeyboardEvent(
      fakeKe({
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        key: "π",
        code: "KeyP",
      }),
    ),
    true,
  );

  // Non-Mac: Ctrl+Alt+P
  assert.equal(
    isPinWorkspaceKeyboardEvent(
      fakeKe({
        metaKey: false,
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        key: "p",
        code: "KeyP",
        keyCode: 80,
      }),
    ),
    true,
  );

  // Negative checks
  assert.equal(isPinWorkspaceKeyboardEvent(null), false);

  // Missing Option / Alt (Cmd+P without Alt is print / palette)
  assert.equal(
    isPinWorkspaceKeyboardEvent(
      fakeKe({
        metaKey: true,
        altKey: false,
        key: "p",
        code: "KeyP",
      }),
    ),
    false,
  );

  // Missing Cmd / Ctrl
  assert.equal(
    isPinWorkspaceKeyboardEvent(
      fakeKe({
        metaKey: false,
        ctrlKey: false,
        altKey: true,
        key: "p",
        code: "KeyP",
      }),
    ),
    false,
  );

  // Shift modifier pressed (Cmd+Option+Shift+P)
  assert.equal(
    isPinWorkspaceKeyboardEvent(
      fakeKe({
        metaKey: true,
        altKey: true,
        shiftKey: true,
        key: "p",
        code: "KeyP",
      }),
    ),
    false,
  );

  // IME composition
  assert.equal(
    isPinWorkspaceKeyboardEvent(
      fakeKe({
        metaKey: true,
        altKey: true,
        key: "p",
        isComposing: true,
      }),
    ),
    false,
  );
});

test("Thread Shortcuts 4: Input safety protection (isEditableInput)", () => {
  function makeEl(options: {
    tagName: string;
    attrs?: Record<string, string>;
    className?: string;
    parent?: MinimalElement | null;
  }): MinimalElement {
    const attrs = new Map<string, string>(Object.entries(options.attrs ?? {}));
    const el: MinimalElement = {
      tagName: options.tagName,
      className: options.className ?? "",
      parentElement: options.parent ?? null,
      getAttribute: (n: string) => attrs.get(n) ?? null,
      setAttribute: (n: string, v: string) => attrs.set(n, v),
      closest: (sel: string) => {
        let cur: MinimalElement | null = el;
        while (cur) {
          const tag = (cur.tagName ?? "").toLowerCase();
          const cls = (typeof cur.className === "string" ? cur.className : "") || "";
          const role = cur.getAttribute?.("role") ?? "";
          const ce = cur.getAttribute?.("contenteditable") ?? "";
          if (sel.includes("input") && tag === "input") return cur;
          if (sel.includes("textarea") && tag === "textarea") return cur;
          if (sel.includes('[contenteditable="true"]') && ce === "true") return cur;
          if (sel.includes('[contenteditable="plaintext-only"]') && ce === "plaintext-only") return cur;
          if (sel.includes('[role="textbox"]') && role === "textbox") return cur;
          if (sel.includes(".cm-editor") && cls.includes("cm-editor")) return cur;
          if (sel.includes(".cm-content") && cls.includes("cm-content")) return cur;
          cur = cur.parentElement ?? null;
        }
        return null;
      },
    };
    return el;
  }

  // <input>
  assert.equal(isEditableInput(makeEl({ tagName: "INPUT" })), true);

  // <textarea>
  assert.equal(isEditableInput(makeEl({ tagName: "TEXTAREA" })), true);

  // [contenteditable="true"]
  assert.equal(
    isEditableInput(makeEl({ tagName: "DIV", attrs: { contenteditable: "true" } })),
    true,
  );

  // [contenteditable="plaintext-only"]
  assert.equal(
    isEditableInput(makeEl({ tagName: "DIV", attrs: { contenteditable: "plaintext-only" } })),
    true,
  );

  // [role="textbox"]
  assert.equal(
    isEditableInput(makeEl({ tagName: "DIV", attrs: { role: "textbox" } })),
    true,
  );

  // CodeMirror child: .cm-content inside .cm-editor
  const cmEditor = makeEl({ tagName: "DIV", className: "cm-editor" });
  const cmContent = makeEl({ tagName: "DIV", className: "cm-content", parent: cmEditor });
  const cmLine = makeEl({ tagName: "DIV", className: "cm-line", parent: cmContent });
  const textSpan = makeEl({ tagName: "SPAN", parent: cmLine });
  assert.equal(isEditableInput(textSpan), true);

  // Non-editable regular elements
  assert.equal(isEditableInput(null), false);
  assert.equal(isEditableInput(makeEl({ tagName: "BUTTON" })), false);
  assert.equal(isEditableInput(makeEl({ tagName: "DIV", attrs: { "data-testid": "sidebar-workspace-row-1" } })), false);
  assert.equal(isEditableInput(makeEl({ tagName: "BODY" })), false);
});

test("Thread Shortcuts 5: Relative thread navigation with synthetic KeyboardEvent and DOM fallback", () => {
  let dispatchedEvent: unknown = null;
  const fakeWin = {
    navigator: { platform: "MacIntel", language: "en-US" },
    location: { pathname: "/workspace/local:wks_1" },
    dispatchEvent: (ev: unknown) => {
      dispatchedEvent = ev;
      (ev as Record<string, unknown>).defaultPrevented = true;
      return false;
    },
    KeyboardEvent: class {
      type: string;
      key: string;
      code: string;
      metaKey: boolean;
      ctrlKey: boolean;
      defaultPrevented = false;
      constructor(type: string, init?: Record<string, unknown>) {
        this.type = type;
        this.key = (init?.key as string) ?? "";
        this.code = (init?.code as string) ?? "";
        this.metaKey = Boolean(init?.metaKey);
        this.ctrlKey = Boolean(init?.ctrlKey);
      }
      preventDefault() {
        this.defaultPrevented = true;
      }
    } as unknown as typeof KeyboardEvent,
  } as unknown as MinimalWindow;

  const fakeDoc = {
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag: string) => ({ tagName: tag.toUpperCase() } as unknown as MinimalElement),
  } as unknown as MinimalDocument;

  // Navigating Previous Thread (delta: -1) dispatches native Cmd+[
  const prevResult = navigateSidebarThreadRelative({
    delta: -1,
    win: fakeWin,
    doc: fakeDoc,
  });
  assert.equal(prevResult.ok, true);
  assert.equal(prevResult.source, "native-shortcut");
  assert.equal((dispatchedEvent as Record<string, unknown>)?.key, "[");
  assert.equal((dispatchedEvent as Record<string, unknown>)?.metaKey, true);

  // Navigating Next Thread (delta: 1) dispatches native Cmd+]
  const nextResult = navigateSidebarThreadRelative({
    delta: 1,
    win: fakeWin,
    doc: fakeDoc,
  });
  assert.equal(nextResult.ok, true);
  assert.equal(nextResult.source, "native-shortcut");
  assert.equal((dispatchedEvent as Record<string, unknown>)?.key, "]");
  assert.equal((dispatchedEvent as Record<string, unknown>)?.metaKey, true);

  // DOM fallback when native event is not canceled / handled
  let clickedIndex = -1;
  const rowElements = [
    {
      getAttribute: (k: string) => (k === "data-testid" ? "sidebar-workspace-row-local:wks_alpha" : null),
      textContent: "Alpha Workspace",
      click: () => { clickedIndex = 0; },
      querySelector: () => null,
    },
    {
      getAttribute: (k: string) => {
        if (k === "data-testid") return "sidebar-workspace-row-local:wks_beta";
        if (k === "aria-selected") return "true";
        return null;
      },
      textContent: "Beta Workspace",
      click: () => { clickedIndex = 1; },
      querySelector: () => null,
    },
    {
      getAttribute: (k: string) => (k === "data-testid" ? "sidebar-workspace-row-local:wks_gamma" : null),
      textContent: "Gamma Workspace",
      click: () => { clickedIndex = 2; },
      querySelector: () => null,
    },
  ];

  const docWithRows = {
    querySelectorAll: (sel: string) => (sel.includes("sidebar-workspace-row") ? (rowElements as unknown as MinimalElement[]) : []),
    querySelector: (sel: string) => {
      if (sel.includes('[aria-selected="true"]')) return rowElements[1] as unknown as MinimalElement;
      return null;
    },
    createElement: (tag: string) => ({ tagName: tag.toUpperCase() } as unknown as MinimalElement),
  } as unknown as MinimalDocument;

  const winWithoutEventDispatch = {
    navigator: { platform: "MacIntel", language: "en-US" },
    location: { pathname: "/workspace/local:wks_beta" },
    dispatchEvent: () => true, // unhandled
  } as unknown as MinimalWindow;

  // From active row 1 (Beta), next thread (+1) should click row 2 (Gamma)
  const domNextResult = navigateSidebarThreadRelative({
    delta: 1,
    win: winWithoutEventDispatch,
    doc: docWithRows,
  });
  assert.equal(domNextResult.ok, true);
  assert.equal(domNextResult.source, "dom-click");
  assert.equal(clickedIndex, 2);
  assert.equal(domNextResult.targetTitle, "Gamma Workspace");

  // From active row 1 (Beta), prev thread (-1) should click row 0 (Alpha)
  const domPrevResult = navigateSidebarThreadRelative({
    delta: -1,
    win: winWithoutEventDispatch,
    doc: docWithRows,
  });
  assert.equal(domPrevResult.ok, true);
  assert.equal(domPrevResult.source, "dom-click");
  assert.equal(clickedIndex, 0);
  assert.equal(domPrevResult.targetTitle, "Alpha Workspace");
});

test("Thread Shortcuts 6: Pin workspace action (toggleActiveWorkspacePin) with native event and context menu fallback", () => {
  let pinDispatchedEvent: unknown = null;
  const fakeWin = {
    navigator: { platform: "MacIntel", language: "en-US" },
    location: { pathname: "/workspace/local:wks_1" },
    dispatchEvent: (ev: unknown) => {
      pinDispatchedEvent = ev;
      (ev as Record<string, unknown>).defaultPrevented = true;
      return false;
    },
    KeyboardEvent: class {
      type: string;
      key: string;
      code: string;
      keyCode: number;
      metaKey: boolean;
      shiftKey: boolean;
      defaultPrevented = false;
      constructor(type: string, init?: Record<string, unknown>) {
        this.type = type;
        this.key = (init?.key as string) ?? "";
        this.code = (init?.code as string) ?? "";
        this.keyCode = (init?.keyCode as number) ?? 0;
        this.metaKey = Boolean(init?.metaKey);
        this.shiftKey = Boolean(init?.shiftKey);
      }
      preventDefault() {
        this.defaultPrevented = true;
      }
    } as unknown as typeof KeyboardEvent,
  } as unknown as MinimalWindow;

  const fakeDoc = {
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag: string) => ({ tagName: tag.toUpperCase() } as unknown as MinimalElement),
  } as unknown as MinimalDocument;

  const pinResult = toggleActiveWorkspacePin({
    win: fakeWin,
    doc: fakeDoc,
  });
  assert.equal(pinResult.ok, true);
  assert.equal(pinResult.source, "native-shortcut");
  assert.equal((pinDispatchedEvent as Record<string, unknown>)?.key, "P");
  assert.equal((pinDispatchedEvent as Record<string, unknown>)?.shiftKey, true);
  assert.equal((pinDispatchedEvent as Record<string, unknown>)?.metaKey, true);

  // Context menu fallback
  let menuClicked = false;
  const pinMenuItem = {
    getAttribute: (k: string) => (k === "data-testid" ? "sidebar-workspace-menu-pin-local:wks_1" : null),
    click: () => { menuClicked = true; },
  };

  const docWithMenu = {
    querySelectorAll: () => [],
    querySelector: (sel: string) => {
      if (sel.includes("sidebar-workspace-menu-pin-")) {
        return pinMenuItem as unknown as MinimalElement;
      }
      return null;
    },
    createElement: (tag: string) => ({ tagName: tag.toUpperCase() } as unknown as MinimalElement),
  } as unknown as MinimalDocument;

  const winWithoutEventDispatch = {
    navigator: { platform: "MacIntel", language: "en-US" },
    location: { pathname: "/workspace/local:wks_1" },
    dispatchEvent: () => true, // unhandled
  } as unknown as MinimalWindow;

  const menuResult = toggleActiveWorkspacePin({
    win: winWithoutEventDispatch,
    doc: docWithMenu,
  });
  assert.equal(menuResult.ok, true);
  assert.equal(menuResult.source, "context-menu");
  assert.equal(menuClicked, true);
});

test("Thread Shortcuts 7: Context menu annotation for Pin (sidebar-workspace-menu-pin- annotated with ⌘⌥P)", () => {
  const appendedBadges: MinimalElement[] = [];
  const attrs = new Map<string, string>([["data-testid", "sidebar-workspace-menu-pin-wks_123"]]);
  const pinItem: MinimalElement = {
    tagName: "DIV",
    style: {},
    getAttribute: (k: string) => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    querySelectorAll: () => [],
    appendChild: (child: MinimalElement) => {
      appendedBadges.push(child);
    },
  };

  const fakeDoc = {
    querySelectorAll: (sel: string) => {
      if (sel.includes("sidebar-workspace-menu-pin-")) return [pinItem];
      return [];
    },
    querySelector: () => null,
    createElement: (tag: string) => {
      const bAttrs = new Map<string, string>();
      return {
        tagName: tag.toUpperCase(),
        style: {},
        textContent: "",
        getAttribute: (k: string) => bAttrs.get(k) ?? null,
        setAttribute: (k: string, v: string) => bAttrs.set(k, v),
      } as unknown as MinimalElement;
    },
  } as unknown as MinimalDocument;

  const count = annotateNativeWorkspaceMenusWithShortcuts(
    fakeDoc,
    {
      enablePinWorkspaceShortcut: true,
      enableQuickRenameAndLabelShortcuts: true,
      enableLabelNumberShortcuts: true,
      labelNumberShortcutMode: "empty-input",
      enableSidebarDeleteKeyArchive: true,
      labelShortcutCombo: "both",
      enableInlineDoubleClickRename: true,
      autoJumpToFirstPlaceInput: true,
      inlineRenameCaretPosition: "start",
      enableThreadNavigationShortcuts: true,
      enableMarkDoneShortcut: true,
      markDonePrefix: "d ",
      enableDesktopContextMenuHelper: true,
      enableCmdClickOpenSystemDefault: true,
      cmdClickDefaultTarget: "system-default",
      enableSidebarCmdClickFinder: true,
    },
    { navigator: { platform: "MacIntel" } } as unknown as MinimalWindow,
  );

  assert.ok(count > 0);
  assert.equal(appendedBadges.length, 1);
  assert.equal(appendedBadges[0].getAttribute?.("data-testid"), "sidebar-workspace-menu-pin-shortcut-hint");
  assert.equal(appendedBadges[0].textContent, "⌘⌥P");
});

test("Thread Shortcuts 8: Settings schema and preference synchronization", () => {
  // Schema defaults
  const parsedDefaults = pluginSettings.schema.parse({});
  assert.equal(parsedDefaults.enableThreadNavigationShortcuts, true);
  assert.equal(parsedDefaults.enablePinWorkspaceShortcut, true);

  // Preference read/write
  const memStore = new Map<string, string>();
  const fakeStorage = {
    getItem: (k: string) => memStore.get(k) ?? null,
    setItem: (k: string, v: string) => void memStore.set(k, v),
    removeItem: (k: string) => void memStore.delete(k),
  } as unknown as MinimalStorage;

  const initialPrefs = readInlineRenamePreferences(fakeStorage);
  assert.equal(initialPrefs.enableThreadNavigationShortcuts, true);
  assert.equal(initialPrefs.enablePinWorkspaceShortcut, true);

  // Toggle off
  syncInlineRenamePreferences(
    {
      enableThreadNavigationShortcuts: false,
      enablePinWorkspaceShortcut: false,
    },
    fakeStorage,
  );

  const updatedPrefs = readInlineRenamePreferences(fakeStorage);
  assert.equal(updatedPrefs.enableThreadNavigationShortcuts, false);
  assert.equal(updatedPrefs.enablePinWorkspaceShortcut, false);

  // Toggle back on
  syncInlineRenamePreferences(
    {
      enableThreadNavigationShortcuts: true,
      enablePinWorkspaceShortcut: true,
    },
    fakeStorage,
  );

  const restoredPrefs = readInlineRenamePreferences(fakeStorage);
  assert.equal(restoredPrefs.enableThreadNavigationShortcuts, true);
  assert.equal(restoredPrefs.enablePinWorkspaceShortcut, true);
});

test("Thread Shortcuts 9: CJK semicolon, macOS smart curly quotes, Dead keys and which code coverage", () => {
  // Previous thread: CJK fullwidth semicolon '；' (U+FF1B)
  assert.equal(
    isPreviousThreadKeyboardEvent(fakeKe({ metaKey: true, key: "；" })),
    true,
  );
  // Previous thread: keyCode / which 186 or 59
  assert.equal(
    isPreviousThreadKeyboardEvent(fakeKe({ metaKey: true, keyCode: 186 })),
    true,
  );
  assert.equal(
    isPreviousThreadKeyboardEvent(fakeKe({ metaKey: true, which: 186 })),
    true,
  );
  assert.equal(
    isPreviousThreadKeyboardEvent(fakeKe({ metaKey: true, keyCode: 59 })),
    true,
  );
  assert.equal(
    isPreviousThreadKeyboardEvent(fakeKe({ metaKey: true, which: 59 })),
    true,
  );

  // Next thread: macOS typographic curly apostrophe '’' (U+2019)
  assert.equal(
    isNextThreadKeyboardEvent(fakeKe({ metaKey: true, key: "’" })),
    true,
  );
  // Next thread: left curly apostrophe '‘' (U+2018)
  assert.equal(
    isNextThreadKeyboardEvent(fakeKe({ metaKey: true, key: "‘" })),
    true,
  );
  // Next thread: modifier letters turned comma 'ʻ' (U+02BB) and apostrophe 'ʼ' (U+02BC)
  assert.equal(
    isNextThreadKeyboardEvent(fakeKe({ metaKey: true, key: "ʻ" })),
    true,
  );
  assert.equal(
    isNextThreadKeyboardEvent(fakeKe({ metaKey: true, key: "ʼ" })),
    true,
  );
  // Next thread: prime '′' (U+2032) and acute accent '´' (U+00B4)
  assert.equal(
    isNextThreadKeyboardEvent(fakeKe({ metaKey: true, key: "′" })),
    true,
  );
  assert.equal(
    isNextThreadKeyboardEvent(fakeKe({ metaKey: true, key: "´" })),
    true,
  );
  // Next thread: Dead key on international/European layouts
  assert.equal(
    isNextThreadKeyboardEvent(fakeKe({ metaKey: true, key: "Dead", code: "Quote" })),
    true,
  );
  assert.equal(
    isNextThreadKeyboardEvent(fakeKe({ metaKey: true, key: "Dead", keyCode: 222 })),
    true,
  );
  assert.equal(
    isNextThreadKeyboardEvent(fakeKe({ metaKey: true, key: "Dead", which: 222 })),
    true,
  );
  // Next thread: which 222
  assert.equal(
    isNextThreadKeyboardEvent(fakeKe({ metaKey: true, which: 222 })),
    true,
  );
  // Next thread: curly double quotes
  assert.equal(
    isNextThreadKeyboardEvent(fakeKe({ metaKey: true, key: "”" })),
    true,
  );
  assert.equal(
    isNextThreadKeyboardEvent(fakeKe({ metaKey: true, key: "“" })),
    true,
  );
});

test("Thread Shortcuts 10: isBlockedFromThreadNavigation allows chat composer textarea while blocking code editors, dialogs, command center, and single-line inputs", () => {
  function makeMockEl(opts: {
    tagName: string;
    attrs?: Record<string, string>;
    className?: string;
    parent?: MinimalElement | null;
  }): MinimalElement {
    const attrs = new Map<string, string>(Object.entries(opts.attrs ?? {}));
    const el: MinimalElement = {
      tagName: opts.tagName,
      className: opts.className ?? "",
      parentElement: opts.parent ?? null,
      getAttribute: (n: string) => attrs.get(n) ?? null,
      setAttribute: (n: string, v: string) => attrs.set(n, v),
      closest: (sel: string) => {
        let cur: MinimalElement | null = el;
        while (cur) {
          const tag = (cur.tagName ?? "").toLowerCase();
          const cls = (typeof cur.className === "string" ? cur.className : "") || "";
          const ce = cur.getAttribute?.("contenteditable") ?? "";
          const dt = cur.getAttribute?.("data-testid") ?? "";
          if (sel.includes(".cm-editor") && cls.includes("cm-editor")) return cur;
          if (sel.includes(".cm-content") && cls.includes("cm-content")) return cur;
          if (sel.includes(".cm-line") && cls.includes("cm-line")) return cur;
          if (sel.includes(".monaco-editor") && cls.includes("monaco-editor")) return cur;
          if (sel.includes('[contenteditable="true"]') && ce === "true") return cur;
          if (sel.includes('[contenteditable="plaintext-only"]') && ce === "plaintext-only") return cur;
          if (sel.includes("[data-composer-input]") && cur.getAttribute?.("data-composer-input") === "true") return cur;
          if (sel.includes('[data-testid="message-input-root"]') && dt === "message-input-root") return cur;
          if ((sel === "input" || sel.split(",").map((s) => s.trim()).includes("input")) && tag === "input") return cur;
          if ((sel === "textarea" || sel.split(",").map((s) => s.trim()).includes("textarea")) && tag === "textarea") return cur;
          cur = cur.parentElement ?? null;
        }
        return null;
      },
    };
    return el;
  }

  const dummyDoc = {
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag: string) => ({ tagName: tag.toUpperCase() } as unknown as MinimalElement),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MinimalDocument;

  // 1. Chat composer textarea: NOT blocked
  const chatTextarea = makeMockEl({
    tagName: "TEXTAREA",
    attrs: { "data-composer-input": "true" },
  });
  assert.equal(isBlockedFromThreadNavigation(chatTextarea, chatTextarea, dummyDoc), false);

  // 2. CodeMirror / Monaco editor: BLOCKED
  const cmEditor = makeMockEl({ tagName: "DIV", className: "cm-editor" });
  const cmContent = makeMockEl({ tagName: "DIV", className: "cm-content", parent: cmEditor });
  assert.equal(isBlockedFromThreadNavigation(cmContent, cmContent, dummyDoc), true);

  const monacoEditor = makeMockEl({ tagName: "DIV", className: "monaco-editor" });
  const monacoSpan = makeMockEl({ tagName: "SPAN", parent: monacoEditor });
  assert.equal(isBlockedFromThreadNavigation(monacoSpan, monacoSpan, dummyDoc), true);

  // 3. Single-line text inputs (search bar, rename field): BLOCKED
  const textInput = makeMockEl({ tagName: "INPUT", attrs: { type: "text" } });
  assert.equal(isBlockedFromThreadNavigation(textInput, textInput, dummyDoc), true);

  const searchInput = makeMockEl({ tagName: "INPUT", attrs: { type: "search" } });
  assert.equal(isBlockedFromThreadNavigation(searchInput, searchInput, dummyDoc), true);

  // Button input: NOT blocked
  const buttonInput = makeMockEl({ tagName: "INPUT", attrs: { type: "button" } });
  assert.equal(isBlockedFromThreadNavigation(buttonInput, buttonInput, dummyDoc), false);

  // 4. Command center open in doc: BLOCKED
  const docWithCC: MinimalDocument = {
    ...dummyDoc,
    querySelector: (sel: string) =>
      sel.includes("command-center") ? makeMockEl({ tagName: "DIV" }) : null,
  };
  assert.equal(isBlockedFromThreadNavigation(chatTextarea, chatTextarea, docWithCC), true);

  // 5. Inline rename open in doc: BLOCKED
  const docWithRename: MinimalDocument = {
    ...dummyDoc,
    querySelector: (sel: string) =>
      sel.includes("paseo-finder-inline-rename-input") ? makeMockEl({ tagName: "INPUT" }) : null,
  };
  assert.equal(isBlockedFromThreadNavigation(chatTextarea, chatTextarea, docWithRename), true);

  // 6. Dialog / modal open in doc: BLOCKED
  const docWithDialog: MinimalDocument = {
    ...dummyDoc,
    querySelector: (sel: string) =>
      sel.includes('[role="dialog"]') ? makeMockEl({ tagName: "DIV" }) : null,
  };
  assert.equal(isBlockedFromThreadNavigation(chatTextarea, chatTextarea, docWithDialog), true);

  // 6b. Passive non-modal hovercard (token counter) or sheet tab without aria-modal="true": NOT blocked
  const docWithPassiveDialog: MinimalDocument = {
    ...dummyDoc,
    querySelector: (sel: string) => {
      if (sel.includes('[aria-modal="true"]')) return null;
      if (sel.includes('[role="dialog"]')) {
        return makeMockEl({ tagName: "DIV", attrs: { role: "dialog", testID: "context-window-details" } });
      }
      return null;
    },
  };
  assert.equal(isBlockedFromThreadNavigation(chatTextarea, chatTextarea, docWithPassiveDialog), false);
});

test("Thread Shortcuts 11: Bidirectional roundtrip navigation (Cmd+; followed by Cmd+') preserves active workspace key across async react re-renders", () => {
  resetThreadNavigationStateForTests();

  let activePathname = "/workspace/local:wks_beta";
  let activeSelectedRow = "sidebar-workspace-row-local:wks_beta";

  const rows = [
    {
      getAttribute: (k: string) => {
        if (k === "data-testid") return "sidebar-workspace-row-local:wks_alpha";
        if (k === "aria-selected") return activeSelectedRow === "sidebar-workspace-row-local:wks_alpha" ? "true" : null;
        return null;
      },
      textContent: "Alpha Thread",
      click: () => {},
    },
    {
      getAttribute: (k: string) => {
        if (k === "data-testid") return "sidebar-workspace-row-local:wks_beta";
        if (k === "aria-selected") return activeSelectedRow === "sidebar-workspace-row-local:wks_beta" ? "true" : null;
        return null;
      },
      textContent: "Beta Thread",
      click: () => {},
    },
    {
      getAttribute: (k: string) => {
        if (k === "data-testid") return "sidebar-workspace-row-local:wks_gamma";
        if (k === "aria-selected") return activeSelectedRow === "sidebar-workspace-row-local:wks_gamma" ? "true" : null;
        return null;
      },
      textContent: "Gamma Thread",
      click: () => {},
    },
  ];

  const mockDoc = {
    querySelectorAll: (sel: string) => (sel.includes("sidebar-workspace-row-") ? (rows as unknown as MinimalElement[]) : []),
    querySelector: () => null,
    createElement: (tag: string) => ({ tagName: tag.toUpperCase() } as unknown as MinimalElement),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MinimalDocument;

  const mockWin: MinimalWindow = {
    navigator: { platform: "MacIntel", language: "en-US" },
    location: {
      get pathname() {
        return activePathname;
      },
      set pathname(val: string) {
        activePathname = val;
      },
    },
    history: {
      pushState: (_state: unknown, _title: string, url: string) => {
        activePathname = url;
      },
    },
    dispatchEvent: () => true, // unhandled natively -> falls back to DOM navigation
  } as unknown as MinimalWindow;

  // 1. Starting at Beta (index 1), press Cmd+; (delta -1) to jump to Alpha (index 0)
  const jump1 = navigateSidebarThreadRelative({
    delta: -1,
    doc: mockDoc,
    win: mockWin,
  });
  assert.equal(jump1.ok, true);
  assert.equal(jump1.targetTitle, "Alpha Thread");
  assert.equal(jump1.targetWorkspaceId, "local:wks_alpha");
  // Route was synchronized
  assert.equal(activePathname, "/h/local/workspace/wks_alpha");

  // Even if React has NOT yet updated aria-selected="true" in the DOM (it still points to Beta):
  assert.equal(activeSelectedRow, "sidebar-workspace-row-local:wks_beta");

  // 2. Press Cmd+' (delta +1) to jump back to Beta (index 1)
  const jump2 = navigateSidebarThreadRelative({
    delta: 1,
    doc: mockDoc,
    win: mockWin,
  });
  assert.equal(jump2.ok, true);
  assert.equal(jump2.targetTitle, "Beta Thread");
  assert.equal(jump2.targetWorkspaceId, "local:wks_beta");
  assert.equal(activePathname, "/h/local/workspace/wks_beta");
});

test("Thread Shortcuts 12: healWorkspaceBubblesAfterShift activates unselected agent tabs and restores bubbles", () => {
  let clickedTabId: string | null = null;
  const dispatchedEvents: string[] = [];

  const tab1: MinimalElement = {
    tagName: "DIV",
    getAttribute: (k: string) => {
      if (k === "data-testid") return "workspace-tab-agent_agent_123";
      if (k === "aria-selected") return "false";
      return null;
    },
    click: () => {
      clickedTabId = "agent_123";
    },
    dispatchEvent: (ev: unknown) => {
      dispatchedEvents.push((ev as { type: string }).type);
      return true;
    },
  };

  const mockDoc = {
    querySelectorAll: (sel: string) => {
      if (sel.includes("workspace-tab-agent_")) {
        return [tab1];
      }
      return [];
    },
    querySelector: () => null,
    createElement: (tag: string) => ({ tagName: tag.toUpperCase() } as unknown as MinimalElement),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MinimalDocument;

  const mockWin: MinimalWindow = {
    MouseEvent: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    } as unknown as typeof MouseEvent,
  } as unknown as MinimalWindow;

  healWorkspaceBubblesAfterShift("wks_test", mockDoc, mockWin);

  assert.equal(clickedTabId, "agent_123");
  assert.ok(dispatchedEvents.includes("pointerdown") || dispatchedEvents.includes("click") || clickedTabId === "agent_123");
});

test("Thread Shortcuts 13: matchesWorkspaceRowTestId handles all testId variations and serverId prefixes", () => {
  assert.equal(
    matchesWorkspaceRowTestId("sidebar-workspace-row-local:wks_alpha", "local:wks_alpha"),
    true,
  );
  assert.equal(
    matchesWorkspaceRowTestId("sidebar-workspace-row-local:wks_alpha", "wks_alpha"),
    true,
  );
  assert.equal(
    matchesWorkspaceRowTestId("sidebar-workspace-row-srv_123:wks_alpha", "wks_alpha"),
    true,
  );
  assert.equal(
    matchesWorkspaceRowTestId("sidebar-workspace-row-wks_alpha", "wks_alpha"),
    true,
  );
  assert.equal(
    matchesWorkspaceRowTestId("sidebar-workspace-row-local:wks_alpha", "wks_beta"),
    false,
  );
});

test("Thread Shortcuts 14: shouldTriggerPinWorkspaceShortcut allows ⌘⌥P when cursor is on sidebar even if chat composer is focused, allows when composer is focused, and blocks only in true modal/search overlays", () => {
  function makeMockNode(opts: {
    tagName: string;
    attrs?: Record<string, string>;
    className?: string;
    parent?: MinimalElement | null;
  }): MinimalElement {
    const attrs = new Map<string, string>(Object.entries(opts.attrs ?? {}));
    const el: MinimalElement = {
      tagName: opts.tagName,
      className: opts.className ?? "",
      parentElement: opts.parent ?? null,
      getAttribute: (n: string) => attrs.get(n) ?? null,
      setAttribute: (n: string, v: string) => attrs.set(n, v),
      closest: (sel: string) => {
        let cur: MinimalElement | null = el;
        while (cur) {
          const tag = (cur.tagName ?? "").toLowerCase();
          const cls = (typeof cur.className === "string" ? cur.className : "") || "";
          const ce = cur.getAttribute?.("contenteditable") ?? "";
          const dt = cur.getAttribute?.("data-testid") ?? "";
          if (sel.includes(".cm-editor") && cls.includes("cm-editor")) return cur;
          if (sel.includes(".cm-content") && cls.includes("cm-content")) return cur;
          if (sel.includes(".cm-line") && cls.includes("cm-line")) return cur;
          if (sel.includes(".monaco-editor") && cls.includes("monaco-editor")) return cur;
          if (sel.includes('[contenteditable="true"]') && ce === "true") return cur;
          if (sel.includes('[contenteditable="plaintext-only"]') && ce === "plaintext-only") return cur;
          if (sel.includes("[data-composer-input]") && cur.getAttribute?.("data-composer-input") === "true") return cur;
          if (sel.includes('[data-testid="message-input-root"]') && dt === "message-input-root") return cur;
          if (sel.includes("sidebar-workspace-") && dt.startsWith("sidebar-workspace-")) return cur;
          if (sel.includes("sidebar") && (dt.startsWith("sidebar") || dt === "sidebar")) return cur;
          if ((sel === "input" || sel.split(",").map((s) => s.trim()).includes("input")) && tag === "input") return cur;
          if ((sel === "textarea" || sel.split(",").map((s) => s.trim()).includes("textarea")) && tag === "textarea") return cur;
          cur = cur.parentElement ?? null;
        }
        return null;
      },
    };
    return el;
  }

  const pinKe: MinimalKeyboardEvent = {
    key: "p",
    code: "KeyP",
    keyCode: 80,
    metaKey: true,
    altKey: true,
    ctrlKey: false,
    shiftKey: false,
    preventDefault: () => {},
  };

  const chatTextarea = makeMockNode({
    tagName: "TEXTAREA",
    attrs: { "data-composer-input": "true", "data-testid": "message-input-root" },
  });

  const sidebarRow = makeMockNode({
    tagName: "DIV",
    attrs: { "data-testid": "sidebar-workspace-row-local:wks_alpha" },
  });

  const baseDoc: MinimalDocument = {
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag: string) => makeMockNode({ tagName: tag }),
    activeElement: chatTextarea,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  // Case 1: Cursor on sidebar (isMouseInsideSidebar: true) even though chatTextarea has focus!
  assert.equal(
    shouldTriggerPinWorkspaceShortcut({
      event: pinKe,
      doc: baseDoc,
      isMouseInsideSidebar: true,
      hoveredElement: sidebarRow,
    }),
    true,
    "⌘⌥P triggers when cursor is on the sidebar even if chat composer has focus",
  );

  // Case 2: Cursor hovering directly over a sidebar workspace row
  assert.equal(
    shouldTriggerPinWorkspaceShortcut({
      event: pinKe,
      doc: baseDoc,
      hoveredElement: sidebarRow,
    }),
    true,
    "⌘⌥P triggers when hovering over a sidebar workspace row",
  );

  // Case 3: User recently clicked a sidebar workspace row
  assert.equal(
    shouldTriggerPinWorkspaceShortcut({
      event: pinKe,
      doc: baseDoc,
      lastSidebarDirectClickWsId: "wks_alpha",
      lastSidebarDirectClickAtMs: Date.now() - 5000,
    }),
    true,
    "⌘⌥P triggers when user recently clicked a sidebar row",
  );

  // Case 4: Inside chat composer textarea in main session: ALWAYS allowed!
  assert.equal(
    shouldTriggerPinWorkspaceShortcut({
      event: pinKe,
      doc: baseDoc,
    }),
    true,
    "⌘⌥P triggers even when focused inside the chat composer textarea",
  );

  // Case 5: When activeElement is body or a non-input element: allowed!
  const docWithBodyActive: MinimalDocument = {
    ...baseDoc,
    activeElement: makeMockNode({ tagName: "DIV" }),
  };
  assert.equal(
    shouldTriggerPinWorkspaceShortcut({
      event: pinKe,
      doc: docWithBodyActive,
    }),
    true,
    "⌘⌥P triggers when non-input element has focus",
  );

  // Case 6: Blocked when inline rename is actively mounted
  const docWithInlineRename: MinimalDocument = {
    ...baseDoc,
    querySelector: (sel: string) =>
      sel.includes("paseo-finder-inline-rename-input")
        ? makeMockNode({ tagName: "INPUT" })
        : null,
  };
  assert.equal(
    shouldTriggerPinWorkspaceShortcut({
      event: pinKe,
      doc: docWithInlineRename,
    }),
    false,
    "⌘⌥P is blocked when inline rename is active",
  );

  // Case 7: Blocked when Command Center is open
  const docWithCommandCenter: MinimalDocument = {
    ...baseDoc,
    querySelector: (sel: string) =>
      sel.includes("command-center") ? makeMockNode({ tagName: "DIV" }) : null,
  };
  assert.equal(
    shouldTriggerPinWorkspaceShortcut({
      event: pinKe,
      doc: docWithCommandCenter,
    }),
    false,
    "⌘⌥P is blocked when command center is open",
  );

  // Case 8: Blocked when true modal dialog is open
  const docWithModal: MinimalDocument = {
    ...baseDoc,
    querySelector: (sel: string) =>
      sel.includes('[role="dialog"][aria-modal="true"]')
        ? makeMockNode({ tagName: "DIV" })
        : null,
  };
  assert.equal(
    shouldTriggerPinWorkspaceShortcut({
      event: pinKe,
      doc: docWithModal,
    }),
    false,
    "⌘⌥P is blocked when modal dialog is open",
  );

  // Case 9: Blocked when typing in single-line text input outside sidebar
  const singleLineInput = makeMockNode({
    tagName: "INPUT",
    attrs: { type: "text" },
  });
  const docWithSingleLineInput: MinimalDocument = {
    ...baseDoc,
    activeElement: singleLineInput,
  };
  assert.equal(
    shouldTriggerPinWorkspaceShortcut({
      event: { ...pinKe, target: singleLineInput },
      doc: docWithSingleLineInput,
    }),
    false,
    "⌘⌥P is blocked when typing in single-line text input outside sidebar",
  );

  // Case 10: Blocked when editing code in CodeMirror or Monaco
  const codeEditorEl = makeMockNode({
    tagName: "DIV",
    className: "cm-content",
  });
  const docWithCodeEditor: MinimalDocument = {
    ...baseDoc,
    activeElement: codeEditorEl,
  };
  assert.equal(
    shouldTriggerPinWorkspaceShortcut({
      event: { ...pinKe, target: codeEditorEl },
      doc: docWithCodeEditor,
    }),
    false,
    "⌘⌥P is blocked when editing in code editor",
  );

  // Case 11: Respects enablePinWorkspaceShortcut: false
  assert.equal(
    shouldTriggerPinWorkspaceShortcut({
      event: pinKe,
      doc: baseDoc,
      enablePinWorkspaceShortcut: false,
    }),
    false,
    "⌘⌥P is disabled when enablePinWorkspaceShortcut is false",
  );
});

test("Thread Shortcuts 15: toggleActiveWorkspacePin handles hoveredRowEl direct pin click and dispatches synthetic Cmd+Shift+P cleanly", () => {
  let clickedRowPin = false;
  const mockRowPinItem: MinimalElement = {
    tagName: "DIV",
    getAttribute: (n: string) => (n === "data-testid" ? "sidebar-workspace-menu-pin-local:wks_alpha" : null),
    click: () => {
      clickedRowPin = true;
    },
  };

  const mockHoveredRow: MinimalElement = {
    tagName: "DIV",
    getAttribute: (n: string) => (n === "data-testid" ? "sidebar-workspace-row-local:wks_alpha" : null),
    querySelector: (sel: string) => (sel.includes("sidebar-workspace-menu-pin-") ? mockRowPinItem : null),
  };

  const fakeDoc: MinimalDocument = {
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag: string) => ({ tagName: tag.toUpperCase() } as unknown as MinimalElement),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const rowResult = toggleActiveWorkspacePin({
    doc: fakeDoc,
    targetWorkspaceId: "wks_alpha",
    hoveredRowEl: mockHoveredRow,
  });
  assert.equal(rowResult.ok, true);
  assert.equal(rowResult.source, "hovered-row");
  assert.equal(clickedRowPin, true);

  // Test Paseo runtime client delegation
  let clientPinnedArg: boolean | null = null;
  let clientTargetId: string | null = null;
  const mockWin: MinimalWindow = {
    document: fakeDoc,
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    __paseoHostRuntimeStore: {
      controllers: new Map([
        [
          "srv_primary",
          {
            activeClient: {
              setWorkspacePinned: async (id: string, pinned: boolean) => {
                clientTargetId = id;
                clientPinnedArg = pinned;
                return { pinnedAt: pinned ? Date.now() : null };
              },
            },
          },
        ],
      ]),
    },
  };

  const runtimeResult = toggleActiveWorkspacePin({
    doc: fakeDoc,
    win: mockWin,
    targetWorkspaceId: "wks_beta",
  });
  assert.equal(runtimeResult.ok, true);
  assert.equal(runtimeResult.source, "runtime-client");
  assert.equal(clientTargetId, "wks_beta");
  assert.equal(clientPinnedArg, true);

  // Test callback / RPC delegation
  let callbackTargetId: string | null = null;
  let callbackPinnedArg: boolean | null = null;
  const rpcResult = toggleActiveWorkspacePin({
    doc: fakeDoc,
    targetWorkspaceId: "wks_gamma",
    callbacks: {
      onToggleWorkspacePin: async (wsId?: string, pinned?: boolean) => {
        callbackTargetId = wsId ?? null;
        callbackPinnedArg = pinned ?? null;
        return { ok: true, workspaceId: wsId, pinned, message: "pinned" };
      },
    },
  });
  assert.equal(rpcResult.ok, true);
  assert.equal(rpcResult.source, "rpc");
  assert.equal(callbackTargetId, "wks_gamma");
  assert.equal(callbackPinnedArg, true);
});
