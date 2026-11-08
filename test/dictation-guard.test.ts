import assert from "node:assert/strict";
import test from "node:test";
import {
  DICTATION_INSERT_LABELS,
  DICTATION_SEND_LABELS,
  classifyDictationStopKey,
  findAutoSendRefInHooks,
  installDictationSendGuard,
  normalizeDictationSendBehavior,
  resolveAutoSendRef,
} from "../client/dictation-guard-web";
import { pluginSettings } from "../shared/contracts";

// Shapes mimic the minified Paseo v0.15.3 MessageInput callbacks (only stable tokens matter).
function transcriptCallback() {
  return (e: string, t: unknown) => {
    const n = { applyDictationTranscript: true, autoSend: true };
    return [e, t, n];
  };
}
function serverInfoSelector() {
  return (e: { sessions: Record<string, { serverInfo?: unknown }> }) =>
    e.sessions.a?.serverInfo ?? null;
}

function buildHookChain(autoSendRef: { current: boolean }) {
  const hooks = [
    { memoizedState: { current: false } }, // unrelated boolean ref
    { memoizedState: [() => "focus", []] },
    { memoizedState: autoSendRef }, // Zt = useRef(false)
    { memoizedState: [serverInfoSelector(), ["ws"]] }, // useCallback(serverInfo selector)
    { memoizedState: [transcriptCallback(), []] }, // Jt -> applyDictationTranscript
  ].map((h) => ({ ...h, next: null as unknown }));
  for (let i = 0; i < hooks.length - 1; i += 1) hooks[i]!.next = hooks[i + 1];
  return hooks[0] as never;
}

function fakeButton(label: string, fiber?: unknown) {
  const attrs = new Map<string, string>([["aria-label", label]]);
  const btn: Record<string, unknown> = {
    clicks: 0,
    style: {} as Record<string, string>,
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => attrs.set(n, v),
    removeAttribute: (n: string) => attrs.delete(n),
    contains: (other: unknown) => other === btn,
    closest: () => null,
    click: () => {
      btn.clicks = (btn.clicks as number) + 1;
    },
  };
  if (fiber) btn["__reactFiber$test"] = fiber;
  return btn;
}

test("dictation guard: policy default, settings schema, labels, and key classification", () => {
  assert.equal(normalizeDictationSendBehavior(undefined), "insert-only");
  assert.equal(normalizeDictationSendBehavior("native"), "native");
  assert.equal(normalizeDictationSendBehavior("bogus"), "insert-only");
  assert.ok(DICTATION_INSERT_LABELS.includes("Insert transcription"));
  assert.ok(DICTATION_SEND_LABELS.includes("Insert transcription and send"));
  assert.ok(DICTATION_INSERT_LABELS.includes("插入转写"));
  const shape = (pluginSettings as unknown as { schema: { shape: Record<string, unknown> } }).schema
    .shape;
  assert.ok("dictationSendBehavior" in shape);

  assert.equal(classifyDictationStopKey({ key: "Enter" }), "enter");
  assert.equal(classifyDictationStopKey({ key: "Enter", shiftKey: true }), null);
  assert.equal(classifyDictationStopKey({ key: "Enter", isComposing: true }), null);
  assert.equal(classifyDictationStopKey({ key: "d", code: "KeyD", metaKey: true }), "cmd-d");
  assert.equal(classifyDictationStopKey({ key: "d", code: "KeyD", ctrlKey: true }), "cmd-d");
  assert.equal(classifyDictationStopKey({ key: "d", code: "KeyD" }), null);
});

test("dictation guard: binds MessageInput autoSend ref by hook signature", () => {
  const ref = { current: true };
  const firstHook = buildHookChain(ref);
  assert.equal(findAutoSendRefInHooks(firstHook), ref);

  // A component without the transcript callback must never be matched.
  const unrelated = { memoizedState: { current: true }, next: null };
  assert.equal(findAutoSendRefInHooks(unrelated as never), null);

  const fiber = { memoizedState: null, return: { memoizedState: firstHook, return: null } };
  assert.equal(resolveAutoSendRef({ __reactFiber$abc: fiber }), ref);
});

test("dictation guard: Enter/Cmd+D reroute to insert-only, send arrow hidden, late native flag cleared", () => {
  const ref = { current: false };
  const fiber = { memoizedState: buildHookChain(ref), return: null };
  const overlayRoot = { isConnected: true };
  const insertBtn = fakeButton("Insert transcription", fiber);
  const sendBtn = fakeButton("Insert transcription and send");
  insertBtn.parentElement = { parentElement: overlayRoot };

  let overlayButtons: unknown[] = [insertBtn, sendBtn];
  const listeners = new Map<string, (e: unknown) => void>();
  const win = {
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const doc = {
    body: {},
    defaultView: win,
    activeElement: null,
    querySelectorAll: (sel: string) =>
      sel === "[aria-label]" ? overlayButtons : [],
  };

  const cleanup = installDictationSendGuard(doc as never);
  assert.equal((sendBtn.style as Record<string, string>).display, "none");

  // Native listener already marked auto-send; our Enter handler must clear it and insert only.
  ref.current = true;
  let stopped = false;
  listeners.get("keydown")?.({
    key: "Enter",
    preventDefault: () => {},
    stopPropagation: () => {},
    stopImmediatePropagation: () => {
      stopped = true;
    },
  });
  assert.equal(stopped, true);
  assert.equal(insertBtn.clicks, 1);
  assert.equal(ref.current, false);

  // Path where Paseo's own capture listener won the race: overlay goes to processing with flag=true.
  cleanup.reconcileNow?.();
  ref.current = true;
  overlayButtons = [];
  cleanup.reconcileNow?.();
  assert.equal(ref.current, false, "processing transition must clear the native autoSend flag");

  cleanup();
  assert.equal(listeners.size, 0);
});
