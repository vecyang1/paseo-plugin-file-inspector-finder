import assert from "node:assert/strict";
import test from "node:test";
import {
  collapseEmptySidebarProjectsNow,
  forgetKnownProjectKeys,
  getSidebarDefaultCollapseStatus,
  installSidebarDefaultCollapse,
  planSidebarCollapse,
  readKnownProjectKeys,
  readSidebarCollapseReceipts,
  readSidebarProjects,
  syncSidebarDefaultCollapsePrefs,
  writeKnownProjectKeys,
  type SidebarProjectInfo,
} from "../client/sidebar-default-collapse-web";
import { pluginSettings } from "../shared/contracts";

// Prefs, known keys and receipts live in localStorage; give this process an in-memory one.
const memory = new Map<string, string>();
(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  },
  dispatchEvent: () => true,
};

function resetStorage() {
  memory.clear();
}

// --- Fake sidebar. Each project renders like upstream `sidebar-workspace-list.tsx`:
// a header row, then (only when expanded) a workspace list or the "New workspace" ghost row.
// Pressing the header toggles collapse, as the native row does.

interface FakeProject {
  viewKey: string;
  name: string;
  collapsed: boolean;
  workspaces: number;
  active: boolean;
}

type FakeEl = {
  testId: string;
  getAttribute(n: string): string | null;
  querySelector(sel: string): FakeEl | null;
  closest(sel: string): FakeEl | null;
  textContent: string;
  click(): void;
};

function makeSidebar(initial: FakeProject[]) {
  const projects = initial.map((p) => ({ ...p }));
  const presses: string[] = [];
  const group = (p: FakeProject): FakeEl => ({
    testId: "",
    getAttribute: (n) => (n === "aria-label" ? p.name : n === "role" ? "group" : null),
    querySelector: () => null,
    closest: () => null,
    textContent: p.name,
    click: () => {},
  });
  const nodesFor = (p: FakeProject): FakeEl[] => {
    const header: FakeEl = {
      testId: `sidebar-project-row-${p.viewKey}`,
      getAttribute: (n) => (n === "data-testid" ? header.testId : null),
      querySelector: () => null,
      closest: (sel) => (sel === '[role="group"]' ? group(p) : null),
      textContent: `${p.name.slice(0, 1)}${p.name}`,
      click: () => {
        presses.push(p.viewKey);
        p.collapsed = !p.collapsed;
      },
    };
    const out = [header];
    if (!p.collapsed && p.workspaces > 0) {
      const selected: FakeEl = {
        testId: "sidebar-workspace-row-x",
        getAttribute: (n) => (n === "aria-selected" ? "true" : null),
        querySelector: () => null,
        closest: () => null,
        textContent: "",
        click: () => {},
      };
      const list: FakeEl = {
        testId: `sidebar-workspace-list-${p.viewKey}`,
        getAttribute: (n) => (n === "data-testid" ? list.testId : null),
        querySelector: (sel) =>
          sel.includes('aria-selected="true"') && p.active ? selected : null,
        closest: () => null,
        textContent: "",
        click: () => {},
      };
      out.push(list);
    } else if (!p.collapsed) {
      const ghost: FakeEl = {
        testId: `sidebar-project-new-workspace-row-${p.viewKey}`,
        getAttribute: (n) => (n === "data-testid" ? ghost.testId : null),
        querySelector: () => null,
        closest: () => null,
        textContent: "New workspace",
        click: () => {},
      };
      out.push(ghost);
    }
    return out;
  };
  const state = { overlay: false };
  const doc = {
    querySelectorAll(selector: string): FakeEl[] {
      if (selector.includes("command-center-panel")) {
        return state.overlay ? [{ testId: "command-center-panel" } as FakeEl] : [];
      }
      const m = /^\[data-testid\^="([^"]+)"\]$/.exec(selector);
      if (!m) return [];
      return projects.flatMap(nodesFor).filter((n) => n.testId.startsWith(m[1]!));
    },
  };
  return { projects, presses, doc, state };
}

// --- Fake window: manual clock, MutationObserver that the test fires by hand.

function makeWindow() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const observers: Array<() => void> = [];
  const win = {
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: number) => void timers.delete(id),
    MutationObserver: class {
      constructor(cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
  };
  const mutate = () => observers.forEach((cb) => cb());
  return { win, advance, mutate };
}

function install(sidebar: ReturnType<typeof makeSidebar>) {
  const w = makeWindow();
  const docLike = Object.assign(Object.create(null), sidebar.doc, {
    body: {},
    defaultView: w.win,
  });
  const cleanup = installSidebarDefaultCollapse(docLike as unknown as Document);
  return { ...w, cleanup };
}

const P = (viewKey: string, extra: Partial<FakeProject> = {}): FakeProject => ({
  viewKey,
  name: viewKey.split(":").pop()!,
  collapsed: false,
  workspaces: 0,
  active: false,
  ...extra,
});

// ---------------------------------------------------------------------------

test("readSidebarProjects tells open, empty, active and collapsed projects apart", () => {
  const s = makeSidebar([
    P("h:empty"),
    P("h:busy", { workspaces: 2 }),
    P("h:here", { workspaces: 1, active: true }),
    P("h:shut", { collapsed: true, workspaces: 3 }),
  ]);
  const byKey = new Map(readSidebarProjects(s.doc).map((p) => [p.viewKey, p]));
  assert.equal(byKey.size, 4);
  assert.deepEqual(
    { ...byKey.get("h:empty")!, name: "" },
    { viewKey: "h:empty", name: "", expanded: true, empty: true, active: false },
  );
  assert.equal(byKey.get("h:busy")!.empty, false);
  assert.equal(byKey.get("h:here")!.active, true);
  assert.equal(byKey.get("h:shut")!.expanded, false);
  // The name comes from the group's aria-label, not the row text (which carries the icon letter).
  assert.equal(byKey.get("h:busy")!.name, "busy");
});

test("first run collapses only open empty projects and remembers every project", () => {
  const projects: SidebarProjectInfo[] = [
    { viewKey: "a", name: "a", expanded: true, empty: true, active: false },
    { viewKey: "b", name: "b", expanded: true, empty: false, active: false },
    { viewKey: "c", name: "c", expanded: true, empty: true, active: true },
    { viewKey: "d", name: "d", expanded: false, empty: false, active: false },
  ];
  const plan = planSidebarCollapse({ projects, known: null, enabled: true });
  assert.equal(plan.firstRun, true);
  assert.deepEqual(plan.collapse.map((c) => c.viewKey), ["a"]);
  assert.deepEqual(
    plan.keptOpen.map((k) => `${k.viewKey}:${k.why}`),
    ["b:has-workspaces", "c:active"],
  );
  assert.deepEqual(plan.remember, ["a", "b", "c", "d"]);
});

test("later runs collapse any new open project, never a known one", () => {
  const projects: SidebarProjectInfo[] = [
    { viewKey: "old-open", name: "o", expanded: true, empty: true, active: false },
    { viewKey: "new-busy", name: "n", expanded: true, empty: false, active: false },
    { viewKey: "new-here", name: "h", expanded: true, empty: false, active: true },
  ];
  const plan = planSidebarCollapse({ projects, known: new Set(["old-open"]), enabled: true });
  assert.equal(plan.firstRun, false);
  assert.deepEqual(plan.collapse.map((c) => `${c.viewKey}:${c.reason}`), ["new-busy:new-project"]);
  assert.deepEqual(plan.keptOpen.map((k) => `${k.viewKey}:${k.why}`), ["new-here:active"]);
  assert.deepEqual(plan.remember, ["new-busy", "new-here"]);
});

test("switched off: nothing is collapsed, but new projects are still remembered", () => {
  const projects: SidebarProjectInfo[] = [
    { viewKey: "x", name: "x", expanded: true, empty: true, active: false },
  ];
  const plan = planSidebarCollapse({ projects, known: new Set(), enabled: false });
  assert.deepEqual(plan.collapse, []);
  assert.deepEqual(plan.keptOpen.map((k) => k.why), ["disabled"]);
  assert.deepEqual(plan.remember, ["x"]);
});

test("an absent memory is a first run; a stored empty list is not", () => {
  resetStorage();
  assert.equal(readKnownProjectKeys(), null);
  writeKnownProjectKeys([]);
  assert.deepEqual(readKnownProjectKeys(), new Set());
  memory.set("paseo:finder-plugin:sidebar-known-projects", "{not json");
  assert.equal(readKnownProjectKeys(), null);
  forgetKnownProjectKeys();
  assert.equal(readKnownProjectKeys(), null);
});

test("install: first run waits for the list to settle, then collapses empty projects only", () => {
  resetStorage();
  const s = makeSidebar([P("h:a"), P("h:b", { workspaces: 2 }), P("h:c", { collapsed: true })]);
  const w = install(s);
  w.advance(400); // first scan only records a candidate
  assert.deepEqual(s.presses, []);
  assert.equal(readKnownProjectKeys(), null);
  w.advance(2000); // second identical scan acts
  assert.deepEqual(s.presses, ["h:a"]);
  assert.deepEqual([...readKnownProjectKeys()!].sort(), ["h:a", "h:b", "h:c"]);
  w.advance(400); // read-back receipt
  const r = readSidebarCollapseReceipts()[0]!;
  assert.equal(r.trigger, "seed");
  assert.equal(r.ok, true);
  assert.match(r.outcome, /remembered 3 projects, collapsed 1 empty: a/);
  w.cleanup();
});

test("install: a project that appears later is collapsed once, then left to the user", () => {
  resetStorage();
  writeKnownProjectKeys(["h:a"]);
  const s = makeSidebar([P("h:a")]);
  const w = install(s);
  w.advance(500);
  assert.deepEqual(s.presses, [], "known projects are never pressed");

  s.projects.push(P("h:cadence", { workspaces: 1 }));
  w.mutate();
  w.advance(500);
  assert.deepEqual(s.presses, ["h:cadence"]);
  assert.equal(s.projects[1]!.collapsed, true);
  w.advance(400);
  assert.match(readSidebarCollapseReceipts()[0]!.outcome, /collapsed 1 new project\(s\): cadence/);

  // The user opens it again: it is known now, so it stays open.
  s.projects[1]!.collapsed = false;
  w.mutate();
  w.advance(2000);
  assert.deepEqual(s.presses, ["h:cadence"]);
  w.cleanup();
});

test("install: a new project holding the open workspace stays open", () => {
  resetStorage();
  writeKnownProjectKeys(["h:a"]);
  const s = makeSidebar([P("h:a"), P("h:mine", { workspaces: 1, active: true })]);
  const w = install(s);
  w.advance(500);
  assert.deepEqual(s.presses, []);
  assert.ok(readKnownProjectKeys()!.has("h:mine"));
  assert.match(readSidebarCollapseReceipts()[0]!.outcome, /holds the open workspace/);
  w.cleanup();
});

test("install: a press that does not take is reported, not hidden", () => {
  resetStorage();
  writeKnownProjectKeys([]);
  const s = makeSidebar([P("h:stuck")]);
  // Simulate a row whose press is swallowed (e.g. a drag in progress).
  const original = s.doc.querySelectorAll.bind(s.doc);
  s.doc.querySelectorAll = (sel: string) =>
    original(sel).map((n) => ({ ...n, click: () => void s.presses.push("swallowed") }));
  const w = install(s);
  w.advance(1000);
  const r = readSidebarCollapseReceipts()[0]!;
  assert.equal(r.ok, false);
  assert.match(r.outcome, /still open after press: stuck/);
  w.cleanup();
});

test("switched off in settings: new projects stay open", () => {
  resetStorage();
  writeKnownProjectKeys([]);
  syncSidebarDefaultCollapsePrefs({ enabled: false });
  const s = makeSidebar([P("h:new")]);
  const w = install(s);
  w.advance(1000);
  assert.deepEqual(s.presses, []);
  assert.ok(readKnownProjectKeys()!.has("h:new"));
  w.cleanup();
  syncSidebarDefaultCollapsePrefs({ enabled: true });
});

test("manual tidy collapses open empty projects, including known ones", () => {
  resetStorage();
  writeKnownProjectKeys(["h:a", "h:b", "h:c"]);
  const s = makeSidebar([P("h:a"), P("h:b", { workspaces: 1 }), P("h:c", { active: true, workspaces: 1 })]);
  const w = install(s);
  w.advance(500);
  assert.equal(collapseEmptySidebarProjectsNow(), 1);
  assert.deepEqual(s.presses, ["h:a"]);
  w.cleanup();
  assert.equal(collapseEmptySidebarProjectsNow(), 0, "no installed sidebar, nothing to press");
});

test("manual tidy pressed in Settings (no sidebar on screen) runs once the sidebar is back", () => {
  resetStorage();
  writeKnownProjectKeys(["h:a", "h:b"]);
  const s = makeSidebar([]);
  const w = install(s);
  w.advance(500);
  assert.equal(collapseEmptySidebarProjectsNow(), 0);
  assert.match(readSidebarCollapseReceipts()[0]!.outcome, /^queued/);

  s.projects.push(P("h:a"), P("h:b", { workspaces: 1 }));
  w.mutate();
  w.advance(500);
  assert.deepEqual(s.presses, ["h:a"]);
  s.projects[0]!.collapsed = false; // the user opens it again
  w.mutate();
  w.advance(2000);
  assert.deepEqual(s.presses, ["h:a"], "the queued tidy runs once");
  w.cleanup();
});

test("install: nothing is pressed while ⌘K or a modal is open; it runs after it closes", () => {
  resetStorage();
  writeKnownProjectKeys(["h:a"]);
  const s = makeSidebar([P("h:a", { workspaces: 1 })]);
  const w = install(s);
  w.advance(500);
  s.state.overlay = true; // ⌘K panel mounted
  s.projects.push(P("h:new"));
  w.mutate();
  w.advance(3000);
  assert.deepEqual(s.presses, [], "a synthetic press under ⌘K can start the reveal loop");
  assert.equal(collapseEmptySidebarProjectsNow(), 0, "manual tidy queues instead of pressing");
  s.state.overlay = false; // panel closes; the sidebar itself does not change
  w.advance(1000);
  assert.deepEqual(s.presses, ["h:new"], "pressed once, by whichever of the two paths ran first");
  w.cleanup();
});

test("status reports what would happen without pressing anything", () => {
  resetStorage();
  writeKnownProjectKeys(["h:a"]);
  const s = makeSidebar([P("h:a"), P("h:new")]);
  const status = getSidebarDefaultCollapseStatus(s.doc);
  assert.equal(status.knownCount, 1);
  assert.equal(status.projects.length, 2);
  assert.deepEqual(status.pending!.collapse.map((c) => c.viewKey), ["h:new"]);
  assert.deepEqual(s.presses, []);
});

test("settings schema turns the behaviour on by default", () => {
  const parsed = pluginSettings.schema.parse({});
  assert.equal(parsed.startNewProjectsCollapsed, true);
});
