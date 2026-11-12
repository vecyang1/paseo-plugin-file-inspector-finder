import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SIDEBAR_GROUPING_SHORTCUT_PREFS,
  SIDEBAR_GROUPING_PROJECT_TESTID,
  SIDEBAR_GROUPING_STATUS_TESTID,
  SIDEBAR_GROUPING_TOAST_ID,
  annotateSidebarGroupingMenu,
  getSidebarGroupingShortcutStatus,
  installSidebarGroupingShortcut,
  normalizeSidebarGroupingShortcutPrefs,
  readCurrentSidebarGroupingMode,
  readSidebarGroupingReceipts,
  readSidebarGroupingShortcutPrefs,
  resolveGroupingShortcutChords,
  resolveGroupingShortcutSpecs,
  runSidebarGroupingShortcutSelfTest,
  switchSidebarGrouping,
  syncSidebarGroupingShortcutPrefs,
} from "../client/sidebar-grouping-shortcut-web";
import { SidebarGroupingPresetSchema, pluginSettings } from "../shared/contracts";

// LocalStorage mock for hermetic tests
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

type FakeNode = {
  id?: string;
  tagName?: string;
  attrs: Map<string, string>;
  children: FakeNode[];
  parentElement: FakeNode | null;
  textContent: string | null;
  style: Record<string, string>;
  isConnected: boolean;
  clicks: number;
  onClick?: () => void;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  appendChild(child: FakeNode): void;
  insertBefore(newChild: FakeNode, refChild: FakeNode | null): void;
  remove(): void;
  closest(selector: string): FakeNode | null;
  querySelector(selector: string): FakeNode | null;
  querySelectorAll(selector: string): FakeNode[];
  click(): void;
  getClientRects(): { length: number };
};

function matchesSelector(node: FakeNode, selector: string): boolean {
  return selector.split(",").some((part) => {
    const trimmed = part.trim();
    if (trimmed.startsWith(".")) {
      const cls = (node.attrs.get("class") ?? "").split(/\s+/);
      return cls.includes(trimmed.slice(1));
    }
    const attrMatch = /^\[([\w-]+)(?:(\^?=)"([^"]*)")?\]$/.exec(trimmed);
    if (attrMatch) {
      const attrName = attrMatch[1]!;
      const value = node.attrs.get(attrName);
      if (value === undefined) return false;
      if (!attrMatch[2]) return true;
      return attrMatch[2] === "=" ? value === attrMatch[3] : value.startsWith(attrMatch[3]!);
    }
    if (/^[a-zA-Z]+$/.test(trimmed)) {
      return (node.tagName ?? "").toUpperCase() === trimmed.toUpperCase();
    }
    return false;
  });
}

function descendants(node: FakeNode): FakeNode[] {
  return node.children.flatMap((c) => [c, ...descendants(c)]);
}

function el(
  tagName = "DIV",
  attrs: Record<string, string> = {},
  children: FakeNode[] = [],
  text = "",
): FakeNode {
  const node: FakeNode = {
    tagName,
    attrs: new Map(Object.entries(attrs)),
    children,
    parentElement: null,
    textContent: text,
    style: {},
    isConnected: true,
    clicks: 0,
    getAttribute: (n) => node.attrs.get(n) ?? null,
    setAttribute: (n, v) => void node.attrs.set(n, v),
    removeAttribute: (n) => void node.attrs.delete(n),
    appendChild: (child) => {
      child.parentElement = node;
      node.children.push(child);
    },
    insertBefore: (newChild, refChild) => {
      newChild.parentElement = node;
      const idx = refChild ? node.children.indexOf(refChild) : -1;
      if (idx === -1) node.children.push(newChild);
      else node.children.splice(idx, 0, newChild);
    },
    remove: () => {
      if (!node.parentElement) return;
      const idx = node.parentElement.children.indexOf(node);
      if (idx !== -1) node.parentElement.children.splice(idx, 1);
      node.parentElement = null;
    },
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
    getClientRects: () => ({ length: 1 }),
  };
  for (const child of children) {
    child.parentElement = node;
  }
  return node;
}

function createFakeEnv(initialMode: "project" | "status" = "project", isMac = true) {
  let groupMode: "project" | "status" = initialMode;
  const setCalls: string[] = [];
  const listeners = new Map<string, Array<(ev: unknown) => void>>();

  const store = {
    getState: () => ({
      groupMode,
      setGroupMode: (next: "project" | "status") => {
        groupMode = next;
        setCalls.push(next);
      },
    }),
  };

  const body = el("BODY");
  const documentElement = el("HTML");

  const doc = {
    body,
    documentElement,
    getElementById: (id: string) =>
      descendants(body).find((d) => d.id === id || d.getAttribute("id") === id) ?? null,
    createElement: (tag: string) => el(tag.toUpperCase()),
    querySelector: (sel: string) => body.querySelector(sel),
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
    defaultView: null as unknown,
  };

  const win = {
    navigator: {
      platform: isMac ? "MacIntel" : "Win32",
      userAgent: isMac ? "Mozilla/5.0 (Macintosh)" : "Mozilla/5.0 (Windows NT 10.0)",
      language: "en-US",
    },
    localStorage: ((globalThis as unknown as Record<string, { localStorage: Storage }>).window?.localStorage),
    __paseoSidebarViewStore: store,
    addEventListener: (type: string, fn: (ev: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener: (type: string, fn: (ev: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      listeners.set(
        type,
        list.filter((f) => f !== fn),
      );
    },
    dispatchEvent: (ev: { type?: string }) => {
      const type = ev?.type ?? "";
      for (const fn of listeners.get(type) ?? []) fn(ev);
      return true;
    },
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

  doc.defaultView = win;

  const fireKeyDown = (init: Record<string, unknown>) => {
    let prevented = false;
    let stopped = false;
    const ev = {
      type: "keydown",
      key: "",
      code: "",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: false,
      repeat: false,
      target: body,
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
      stopImmediatePropagation: () => {
        stopped = true;
      },
      ...init,
    };
    for (const fn of listeners.get("keydown") ?? []) fn(ev);
    return { prevented, stopped };
  };

  return {
    doc,
    win,
    body,
    documentElement,
    getGroupMode: () => groupMode,
    setCalls,
    fireKeyDown,
  };
}

test("Sidebar Grouping 1: defaults and schema support cmd_ctrl_p_s (⌃⌘P / ⌃⌘S)", () => {
  memory.clear();
  const parsedDefaults = pluginSettings.schema.parse({});
  assert.equal(parsedDefaults.enableSidebarGroupingShortcuts, true);
  assert.equal(parsedDefaults.sidebarGroupingPreset, "cmd_ctrl_p_s");
  assert.equal(parsedDefaults.sidebarGroupingProjectShortcut, "Cmd+Ctrl+P");
  assert.equal(parsedDefaults.sidebarGroupingStatusShortcut, "Cmd+Ctrl+S");
  assert.equal(parsedDefaults.sidebarGroupingToggleOnRePress, false);

  assert.equal(SidebarGroupingPresetSchema.safeParse("cmd_ctrl_p_s").success, true);
  assert.equal(SidebarGroupingPresetSchema.safeParse("cmd_alt_p_s").success, true);
  assert.equal(SidebarGroupingPresetSchema.safeParse("ctrl_shift_p_s").success, true);
  assert.equal(SidebarGroupingPresetSchema.safeParse("custom").success, true);

  const prefs = readSidebarGroupingShortcutPrefs();
  assert.deepEqual(prefs, DEFAULT_SIDEBAR_GROUPING_SHORTCUT_PREFS);
  const { projectSpec, statusSpec } = resolveGroupingShortcutSpecs(prefs);
  assert.equal(projectSpec, "Cmd+Ctrl+P");
  assert.equal(statusSpec, "Cmd+Ctrl+S");

  const { projectChord, statusChord } = resolveGroupingShortcutChords(prefs);
  assert.equal(projectChord?.meta, true);
  assert.equal(projectChord?.ctrl, true);
  assert.equal(projectChord?.key, "p");
  assert.equal(statusChord?.meta, true);
  assert.equal(statusChord?.ctrl, true);
  assert.equal(statusChord?.key, "s");
});

test("Sidebar Grouping 2: Cmd+Ctrl+P and Cmd+Ctrl+S switch grouping mode via store and record receipts", () => {
  memory.clear();
  const env = createFakeEnv("status", true);
  const cleanup = installSidebarGroupingShortcut(env.doc as unknown as Document);

  try {
    // Press Cmd+Ctrl+P -> switches status -> project
    const r1 = env.fireKeyDown({
      metaKey: true,
      ctrlKey: true,
      code: "KeyP",
      key: "p",
    });
    assert.equal(r1.prevented, true);
    assert.equal(r1.stopped, true);
    assert.equal(env.getGroupMode(), "project");

    // Re-pressing Cmd+Ctrl+P with toggleOnRePress=false stays on project
    env.fireKeyDown({
      metaKey: true,
      ctrlKey: true,
      code: "KeyP",
      key: "p",
    });
    assert.equal(env.getGroupMode(), "project");

    // Press Cmd+Ctrl+S -> switches project -> status
    const r2 = env.fireKeyDown({
      metaKey: true,
      ctrlKey: true,
      code: "KeyS",
      key: "s",
    });
    assert.equal(r2.prevented, true);
    assert.equal(env.getGroupMode(), "status");

    const receipts = readSidebarGroupingReceipts();
    assert.ok(receipts.length >= 3);
    assert.equal(receipts[0]?.trigger, "status");
    assert.equal(receipts[0]?.prevMode, "project");
    assert.equal(receipts[0]?.nextMode, "status");
    assert.equal(receipts[0]?.ok, true);

    // Toast was rendered cleanly
    const toast = env.doc.getElementById(SIDEBAR_GROUPING_TOAST_ID);
    assert.ok(toast);
    assert.equal(toast.textContent, "Sidebar: Group by status");
  } finally {
    cleanup();
  }
});

test("Sidebar Grouping 3: toggleOnRePress=true and identical custom shortcuts toggle smoothly", () => {
  memory.clear();
  const env = createFakeEnv("project", true);
  syncSidebarGroupingShortcutPrefs({
    preset: "cmd_ctrl_p_s",
    toggleOnRePress: true,
  });
  const cleanup = installSidebarGroupingShortcut(env.doc as unknown as Document);

  try {
    // Re-press Cmd+Ctrl+P while already on project -> toggles to status
    env.fireKeyDown({ metaKey: true, ctrlKey: true, code: "KeyP", key: "p" });
    assert.equal(env.getGroupMode(), "status");

    // Re-press Cmd+Ctrl+S while already on status -> toggles back to project
    env.fireKeyDown({ metaKey: true, ctrlKey: true, code: "KeyS", key: "s" });
    assert.equal(env.getGroupMode(), "project");

    // Custom identical shortcut for both acts as a 1-key toggle
    syncSidebarGroupingShortcutPrefs({
      preset: "custom",
      projectShortcut: "Alt+G",
      statusShortcut: "Alt+G",
      toggleOnRePress: false,
    });
    env.fireKeyDown({ altKey: true, code: "KeyG", key: "g" });
    assert.equal(env.getGroupMode(), "status");
    env.fireKeyDown({ altKey: true, code: "KeyG", key: "g" });
    assert.equal(env.getGroupMode(), "project");
  } finally {
    cleanup();
  }
});

test("Sidebar Grouping 4: custom shortcuts support disabling one side ('none') and Metro store lookup", () => {
  memory.clear();
  const env = createFakeEnv("project", true);
  // Remove direct bridge and expose via Metro __c Map
  delete (env.win as Record<string, unknown>).__paseoSidebarViewStore;
  let metroGroupMode: "project" | "status" = "project";
  (env.win as Record<string, unknown>).__c = new Map([
    [
      4394,
      {
        isInitialized: true,
        publicModule: {
          exports: {
            useSidebarViewStore: {
              getState: () => ({
                groupMode: metroGroupMode,
                setGroupMode: (next: "project" | "status") => {
                  metroGroupMode = next;
                },
              }),
            },
          },
        },
      },
    ],
  ]);

  syncSidebarGroupingShortcutPrefs({
    preset: "custom",
    projectShortcut: "none",
    statusShortcut: "Ctrl+Shift+S",
  });

  const cleanup = installSidebarGroupingShortcut(env.doc as unknown as Document);
  try {
    assert.equal(readCurrentSidebarGroupingMode(env.win, env.doc), "project");

    // Default Cmd+Ctrl+P should not fire when preset is custom with projectShortcut='none'
    const rIgnored = env.fireKeyDown({ metaKey: true, ctrlKey: true, code: "KeyP", key: "p" });
    assert.equal(rIgnored.prevented, false);
    assert.equal(metroGroupMode, "project");

    // Ctrl+Shift+S fires and switches via Metro export
    const rStatus = env.fireKeyDown({ ctrlKey: true, shiftKey: true, code: "KeyS", key: "s" });
    assert.equal(rStatus.prevented, true);
    assert.equal(metroGroupMode, "status");
  } finally {
    cleanup();
  }
});

test("Sidebar Grouping 5: input safety blocks foreign editors/terminals and active shortcut recording", () => {
  memory.clear();
  const env = createFakeEnv("project", true);
  const monaco = el("DIV", { class: "monaco-editor" });
  const monacoInput = el("TEXTAREA");
  monaco.appendChild(monacoInput);
  const xterm = el("DIV", { class: "xterm" });
  const composer = el("TEXTAREA", { "data-composer-input": "true" });
  env.body.appendChild(monaco);
  env.body.appendChild(xterm);
  env.body.appendChild(composer);

  const cleanup = installSidebarGroupingShortcut(env.doc as unknown as Document);
  try {
    // Inside Monaco -> ignored
    const rMonaco = env.fireKeyDown({
      metaKey: true,
      ctrlKey: true,
      code: "KeyS",
      key: "s",
      target: monacoInput,
    });
    assert.equal(rMonaco.prevented, false);
    assert.equal(env.getGroupMode(), "project");

    // Inside xterm -> ignored
    const rXterm = env.fireKeyDown({
      metaKey: true,
      ctrlKey: true,
      code: "KeyS",
      key: "s",
      target: xterm,
    });
    assert.equal(rXterm.prevented, false);
    assert.equal(env.getGroupMode(), "project");

    // While recording shortcut in Settings -> ignored
    env.documentElement.setAttribute("data-paseo-recording-shortcut", "true");
    const rRecording = env.fireKeyDown({
      metaKey: true,
      ctrlKey: true,
      code: "KeyS",
      key: "s",
      target: composer,
    });
    assert.equal(rRecording.prevented, false);
    env.documentElement.removeAttribute("data-paseo-recording-shortcut");

    // Inside normal chat composer -> allowed!
    const rComposer = env.fireKeyDown({
      metaKey: true,
      ctrlKey: true,
      code: "KeyS",
      key: "s",
      target: composer,
    });
    assert.equal(rComposer.prevented, true);
    assert.equal(env.getGroupMode(), "status");
  } finally {
    cleanup();
  }
});

test("Sidebar Grouping 6: annotates native Grouping menu items with shortcut badges and updates on preset change", () => {
  memory.clear();
  const env = createFakeEnv("status", true);
  const projItem = el(
    "DIV",
    { "data-testid": SIDEBAR_GROUPING_PROJECT_TESTID, role: "menuitem" },
    [el("SVG"), el("SPAN", {}, [], "Project")],
  );
  const statusItem = el(
    "DIV",
    { "data-testid": SIDEBAR_GROUPING_STATUS_TESTID, role: "menuitem", "aria-checked": "true" },
    [el("SVG"), el("SPAN", {}, [], "Status"), el("SVG")],
  );
  env.body.appendChild(projItem);
  env.body.appendChild(statusItem);

  const count = annotateSidebarGroupingMenu(env.doc, env.win);
  assert.equal(count, 2);

  const projBadge = projItem.querySelector('[data-testid="sidebar-grouping-project-shortcut-hint"]');
  const statusBadge = statusItem.querySelector('[data-testid="sidebar-grouping-status-shortcut-hint"]');
  assert.equal(projBadge?.textContent, "⌃⌘P");
  assert.equal(statusBadge?.textContent, "⌃⌘S");
  assert.equal(projItem.getAttribute("aria-keyshortcuts"), "Control+Meta+P");
  assert.equal(statusItem.getAttribute("aria-keyshortcuts"), "Control+Meta+S");
  // Status item placed badge before trailing checkmark SVG
  assert.equal(statusItem.children[2], statusBadge);
  assert.equal(statusItem.children[3]?.tagName, "SVG");

  // Update preset to Option+Cmd -> badges update in-place without duplication
  syncSidebarGroupingShortcutPrefs({ preset: "cmd_alt_p_s" });
  annotateSidebarGroupingMenu(env.doc, env.win);
  assert.equal(
    projItem.querySelectorAll('[data-testid="sidebar-grouping-project-shortcut-hint"]').length,
    1,
  );
  assert.equal(
    projItem.querySelector('[data-testid="sidebar-grouping-project-shortcut-hint"]')?.textContent,
    "⌥⌘P",
  );
  assert.equal(
    statusItem.querySelector('[data-testid="sidebar-grouping-status-shortcut-hint"]')?.textContent,
    "⌥⌘S",
  );

  // Disabled -> badges removed
  syncSidebarGroupingShortcutPrefs({ enabled: false });
  annotateSidebarGroupingMenu(env.doc, env.win);
  assert.equal(
    projItem.querySelector('[data-testid="sidebar-grouping-project-shortcut-hint"]'),
    null,
  );
  assert.equal(projItem.getAttribute("aria-keyshortcuts"), null);
});

test("Sidebar Grouping 7: self-test, status, DOM click fallback, and normalization invariants", () => {
  memory.clear();
  const env = createFakeEnv("project", true);
  const cleanup = installSidebarGroupingShortcut(env.doc as unknown as Document);

  try {
    const status = getSidebarGroupingShortcutStatus(env.doc, env.win);
    assert.equal(status.installed, true);
    assert.equal(status.storeAvailable, true);
    assert.equal(status.currentMode, "project");
    assert.equal(status.displayProjectShortcut, "⌃⌘P");
    assert.equal(status.displayStatusShortcut, "⌃⌘S");

    const selfTest = runSidebarGroupingShortcutSelfTest(env.doc, env.win);
    assert.equal(selfTest.receipts[0]?.trigger, "self-test");
    assert.equal(selfTest.receipts[0]?.ok, true);

    // Fallback: without store, clicking DOM menu item works
    delete (env.win as Record<string, unknown>).__paseoSidebarViewStore;
    const statusMenu = el("DIV", { "data-testid": SIDEBAR_GROUPING_STATUS_TESTID });
    let clicked = false;
    statusMenu.onClick = () => {
      clicked = true;
    };
    env.body.appendChild(statusMenu);
    const res = switchSidebarGrouping("status", { win: env.win, doc: env.doc, silentToast: true });
    assert.equal(res.ok, true);
    assert.equal(clicked, true);

    const normalized = normalizeSidebarGroupingShortcutPrefs({
      enabled: false,
      preset: "invalid_preset" as never,
      projectShortcut: "  ",
      statusShortcut: "OFF",
      toggleOnRePress: true,
    });
    assert.equal(normalized.enabled, false);
    assert.equal(normalized.preset, "cmd_ctrl_p_s");
    assert.equal(normalized.projectShortcut, "");
    assert.equal(normalized.statusShortcut, "");
    assert.equal(normalized.toggleOnRePress, true);
  } finally {
    cleanup();
  }
});
