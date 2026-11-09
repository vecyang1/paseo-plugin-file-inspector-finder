// Regression: picking a workspace in ⌘K froze Paseo (2026-11-09, T-028).
// revealWorkspaceInSidebar expands a collapsed project with a synthetic `.click()`. In a real
// browser that click is dispatched through document capture listeners, including the plugin's
// own onClickCapture, while the ⌘K panel is still mounted. The old fake in test 28 replaced
// `.click` with a function that dispatched nothing, which is why the suite never saw the loop.
// This fake dispatches like a browser (isTrusted=false) and applies React state on a later tick.
import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCommandCenterSelectionHint,
  installDesktopRevealHelpers,
  revealWorkspaceInSidebar,
  type MinimalDocument,
  type MinimalElement,
  type MinimalWindow,
} from "../client/web";

const RUNAWAY_CAP = 60;
const settle = (ms = 40) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type FakeNode = MinimalElement & { children: FakeNode[]; attrs: Map<string, string> };
type ClickListener = (ev: unknown) => void;

function matches(el: FakeNode, selector: string): boolean {
  const tid = el.attrs.get("data-testid") ?? "";
  const exact = selector.match(/^\[data-testid="([^"]+)"\]$/);
  if (exact) return tid === exact[1];
  const prefix = selector.match(/^\[data-testid\^="([^"]+)"\](?:\[aria-selected="true"\])?$/);
  if (prefix) {
    if (!tid.startsWith(prefix[1])) return false;
    return !selector.includes("aria-selected") || el.attrs.get("aria-selected") === "true";
  }
  const role = selector.match(/^\[role="([^"]+)"\]$/);
  if (role) return el.attrs.get("role") === role[1];
  return false;
}

function makeNode(tag: string, attrs: Record<string, string> = {}, text = ""): FakeNode {
  const node: FakeNode = {
    tagName: tag.toUpperCase(),
    attrs: new Map(Object.entries(attrs)),
    children: [],
    parentElement: null,
    style: {},
    get textContent() {
      return text + node.children.map((c) => c.textContent ?? "").join("");
    },
    set textContent(v) {
      text = v ?? "";
    },
    getAttribute: (n) => node.attrs.get(n) ?? null,
    setAttribute: (n, v) => void node.attrs.set(n, v),
    removeAttribute: (n) => void node.attrs.delete(n),
    appendChild: (child) => {
      const c = child as FakeNode;
      c.parentElement = node;
      node.children.push(c);
    },
    remove: () => {
      const parent = node.parentElement as FakeNode | null;
      if (parent) parent.children.splice(parent.children.indexOf(node), 1);
      node.parentElement = null;
    },
    contains: (other) => {
      for (let cur = other as FakeNode | null; cur; cur = cur.parentElement as FakeNode | null) {
        if (cur === node) return true;
      }
      return false;
    },
    closest: (selector) => {
      for (let cur: FakeNode | null = node; cur; cur = cur.parentElement as FakeNode | null) {
        if (matches(cur, selector)) return cur;
      }
      return null;
    },
    querySelectorAll: (selector) => {
      const out: FakeNode[] = [];
      const walk = (el: FakeNode) => {
        for (const ch of el.children) {
          if (matches(ch, selector)) out.push(ch);
          walk(ch);
        }
      };
      walk(node);
      return out;
    },
    querySelector: (selector) => node.querySelectorAll!(selector)[0] ?? null,
    scrollIntoView: () => {},
  };
  return node;
}

function buildPaseo() {
  const body = makeNode("body");
  const clickListeners: ClickListener[] = [];
  const counters = { syntheticDispatches: 0, projectRowClicks: 0, reactToggles: 0 };

  // A browser `.click()`: capture listeners see an untrusted event, then the element's own
  // React handler runs. React commits the state change on a later tick, not synchronously.
  const browserClick = (target: FakeNode, onPress: () => void) => {
    counters.syntheticDispatches += 1;
    if (counters.syntheticDispatches > RUNAWAY_CAP) return; // keep a RED run from hanging
    const ev = {
      type: "click",
      target,
      isTrusted: false,
      button: 0,
      clientX: 0,
      clientY: 0,
      preventDefault: () => {},
      stopPropagation: () => {},
    };
    for (const fn of [...clickListeners]) fn(ev);
    onPress();
  };

  // Header of the workspace the user is in (a different project).
  const headerGroup = makeNode("div");
  headerGroup.appendChild!(makeNode("div", { "data-testid": "workspace-header-title" }, "Fix auto-launch"));
  headerGroup.appendChild!(makeNode("div", {}, "Proj Current"));
  body.appendChild!(headerGroup);

  // Sidebar: the target project is COLLAPSED, so the target workspace row is not rendered.
  const projectGroup = makeNode("div", { role: "group", "aria-label": "Proj A" });
  const projectRow = makeNode("div", { "data-testid": "sidebar-project-row-local:proj_a" }, "Proj A");
  const workspaceList = makeNode("div", { "data-testid": "sidebar-workspace-list-local:proj_a" });
  const workspaceRow = makeNode("div", { "data-testid": "sidebar-workspace-row-local:ws_target" }, "Add rename");
  workspaceList.appendChild!(workspaceRow);
  let expanded = false;
  projectRow.click = () => {
    counters.projectRowClicks += 1;
    browserClick(projectRow, () => {
      setTimeout(() => {
        counters.reactToggles += 1;
        expanded = !expanded; // the native row toggles collapse on every press
        if (expanded) projectGroup.appendChild!(workspaceList);
        else workspaceList.remove!();
      }, 0);
    });
  };
  projectGroup.appendChild!(projectRow);
  body.appendChild!(projectGroup);

  // ⌘K panel with two workspace rows; the user clicks the first one's subtitle.
  const panel = makeNode("div", { "data-testid": "command-center-panel" });
  const ccRow = makeNode("div", { "data-testid": "command-center-workspace-local:ws_target" });
  const ccSubtitle = makeNode("div", { "data-testid": "command-center-workspace-subtitle" }, "Proj A · main · 22h ago");
  ccRow.appendChild!(ccSubtitle);
  panel.appendChild!(ccRow);
  const ccRow2 = makeNode("div", { "data-testid": "command-center-workspace-local:ws_other" });
  ccRow2.appendChild!(makeNode("div", { "data-testid": "command-center-workspace-subtitle" }, "Proj B · main · 1d ago"));
  panel.appendChild!(ccRow2);
  body.appendChild!(panel);

  const doc: MinimalDocument = {
    body,
    head: makeNode("head"),
    createElement: (tag) => makeNode(tag),
    querySelector: (sel) => body.querySelector!(sel),
    querySelectorAll: (sel) => body.querySelectorAll!(sel),
    addEventListener: (type, fn) => {
      if (type === "click") clickListeners.push(fn);
    },
    removeEventListener: (type, fn) => {
      if (type !== "click") return;
      const i = clickListeners.indexOf(fn);
      if (i >= 0) clickListeners.splice(i, 1);
    },
  };
  const location = { pathname: "/h/local/workspace/ws_current" };
  const win: MinimalWindow = {
    document: doc,
    location,
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  // A trusted user click on a palette row; Paseo closes the panel and navigates on a later tick.
  const userPicksPaletteRow = () => {
    const ev = {
      type: "click",
      target: ccSubtitle,
      isTrusted: true,
      button: 0,
      clientX: 10,
      clientY: 10,
      preventDefault: () => {},
      stopPropagation: () => {},
    };
    for (const fn of [...clickListeners]) fn(ev);
    setTimeout(() => {
      panel.remove!();
      location.pathname = "/h/local/workspace/ws_target";
    }, 0);
  };

  const syntheticClickOn = (target: FakeNode) => {
    const ev = { type: "click", target, isTrusted: false, button: 0, clientX: 0, clientY: 0, preventDefault: () => {}, stopPropagation: () => {} };
    for (const fn of [...clickListeners]) fn(ev);
  };

  return {
    doc,
    win,
    counters,
    panel,
    ccSubtitle,
    projectRow,
    workspaceRow,
    workspaceList,
    userPicksPaletteRow,
    syntheticClickOn,
    isExpanded: () => expanded,
  };
}

test("⌘K workspace pick with a collapsed sidebar project expands it once and never re-enters (T-028)", async () => {
  const p = buildPaseo();
  let resolves = 0;
  const cleanup = installDesktopRevealHelpers(
    {
      isEnabled: () => true,
      onOpenTarget: async () => {},
      onCopyPath: async () => {},
      onResolveWorkspaceProject: async () => {
        resolves += 1;
        return { projectId: "proj_a", projectKey: "local:proj_a", projectName: "Proj A" };
      },
    },
    p.doc,
    p.win,
  );
  try {
    p.userPicksPaletteRow();
    await settle(900); // past every staged retry (45..700 ms)

    assert.ok(
      p.counters.syntheticDispatches <= 3,
      `reveal must not re-enter through its own synthetic clicks (dispatched ${p.counters.syntheticDispatches}, cap ${RUNAWAY_CAP})`,
    );
    assert.equal(p.counters.projectRowClicks, 1, "the collapsed project row is pressed exactly once");
    assert.equal(p.isExpanded(), true, "the target project ends expanded, not toggled back closed");
    assert.equal(p.workspaceList.parentElement !== null, true, "the workspace list is mounted");
    assert.equal(
      p.workspaceRow.getAttribute!("data-paseo-workspace-jump-flash"),
      "true",
      "the picked workspace row is revealed and flashed",
    );
    assert.ok(resolves <= 2, `project resolution must not loop (resolved ${resolves} times)`);
  } finally {
    cleanup?.();
  }
});

test("a click outside any ⌘K row is not read as a palette pick, even while the panel is open (T-028)", () => {
  const p = buildPaseo();
  assert.equal(
    extractCommandCenterSelectionHint(p.projectRow, p.doc),
    null,
    "a sidebar click must not borrow the panel's first workspace row",
  );
  const subtitle = p.panel.querySelector!('[data-testid="command-center-workspace-subtitle"]');
  assert.equal(extractCommandCenterSelectionHint(subtitle, p.doc)?.workspaceId, "ws_target");
});

test("a programmatic click on a ⌘K row is not a user pick (T-028)", async () => {
  const p = buildPaseo();
  const cleanup = installDesktopRevealHelpers(
    { isEnabled: () => true, onOpenTarget: async () => {}, onCopyPath: async () => {} },
    p.doc,
    p.win,
  );
  try {
    p.syntheticClickOn(p.ccSubtitle);
    await settle(80);
    assert.equal(p.counters.projectRowClicks, 0, "an untrusted click must not start a reveal");
  } finally {
    cleanup?.();
  }
});

test("a reveal requested from inside a reveal's own expand press does not nest (T-028)", () => {
  const p = buildPaseo();
  const nested: boolean[] = [];
  // Any listener reacting to the synthetic press (another module, another plugin) asks for a reveal.
  p.doc.addEventListener("click", () => {
    nested.push(revealWorkspaceInSidebar({ workspaceId: "ws_other", candidateProjectNames: ["Proj A"] }, p.doc, p.win));
  });
  revealWorkspaceInSidebar(
    { workspaceId: "ws_target", projectId: "proj_a", projectKey: "local:proj_a", projectName: "Proj A" },
    p.doc,
    p.win,
  );
  assert.equal(p.counters.projectRowClicks, 1, "the outer reveal presses the project row once");
  assert.deepEqual(nested, [false], "the nested reveal is refused while the outer one is pressing");
});
