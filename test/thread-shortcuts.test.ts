import assert from "node:assert/strict";
import test from "node:test";
import {
  isPreviousThreadKeyboardEvent,
  isNextThreadKeyboardEvent,
  isPinWorkspaceKeyboardEvent,
  isEditableInput,
  navigateSidebarThreadRelative,
  toggleActiveWorkspacePin,
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
