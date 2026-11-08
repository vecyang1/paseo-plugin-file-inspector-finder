/// <reference lib="dom" />
/**
 * Dictation Send Guard — keep finished dictation in the composer for review.
 *
 * Paseo v0.15.x `MessageInput` ends dictation through three paths, two of which
 * auto-send the transcript without letting the user audit it:
 *   - Pencil button  (`message.dictation.insert`)        -> insert only
 *   - ArrowUp button (`message.dictation.insertAndSend`) -> insert + send
 *   - `Enter` / `Cmd+D` / `Ctrl+D` while recording        -> insert + send
 *     (`runMessageInputKeyboardAction` calls `markTranscriptForSend()`)
 *
 * The native decision is a private React ref (`autoSend` flag) read only when the
 * transcript arrives, seconds after the user stops recording. This guard, when the
 * policy is `insert-only` (default):
 *   1. hides the ArrowUp "insert and send" button while recording,
 *   2. reroutes Enter / Cmd+D / Ctrl+D (and any send-button press) to the Pencil
 *      "insert only" button,
 *   3. as a belt-and-braces layer, clears the native autoSend ref the moment the
 *      overlay switches to its processing spinner, so any path that set it is
 *      neutralised before the transcript lands.
 *
 * Update-proof: no `Paseo.app` bundle edits. Every action writes a receipt so the
 * Settings screen can show what happened (能读 / 能试 / 能调).
 */

export type DictationSendBehavior = "insert-only" | "native";

export type DictationGuardTrigger =
  | "enter"
  | "cmd-d"
  | "send-button"
  | "processing-flag-reset"
  | "self-test";

export interface DictationGuardReceipt {
  at: string;
  trigger: DictationGuardTrigger;
  ok: boolean;
  outcome: string;
}

export type DictationOverlayState = "idle" | "recording" | "processing";

export interface DictationGuardStatus {
  policy: DictationSendBehavior;
  installed: boolean;
  overlayState: DictationOverlayState;
  /** Whether the native autoSend ref inside MessageInput could be located. */
  autoSendRefBound: boolean;
  autoSendRefValue: boolean | null;
  receipts: DictationGuardReceipt[];
}

const POLICY_STORAGE_KEY = "paseo:finder-plugin:dictation-send-behavior";
const RECEIPTS_STORAGE_KEY = "paseo:finder-plugin:dictation-guard-receipts";
const MAX_RECEIPTS = 15;
export const DICTATION_GUARD_EVENT = "paseo-finder:dictation-guard";
const HIDDEN_ATTR = "data-paseo-finder-dictation-hidden";

/** `message.dictation.insert` across every locale shipped in Paseo v0.15.3. */
export const DICTATION_INSERT_LABELS: readonly string[] = [
  "Insert transcription",
  "插入转写",
  "文字起こしを挿入",
  "전사 삽입",
  "Insertar transcripción",
  "Insérer la transcription",
  "Inserir transcrição",
  "Вставить транскрипцию",
  "إدراج النسخ",
];

/** `message.dictation.insertAndSend` across every locale shipped in Paseo v0.15.3. */
export const DICTATION_SEND_LABELS: readonly string[] = [
  "Insert transcription and send",
  "插入转写并发送",
  "文字起こしを挿入して送信",
  "전사 삽입 후 보내기",
  "Insertar transcripción y enviar",
  "Insérer la transcription et envoyer",
  "Inserir transcrição e enviar",
  "Вставить транскрипцию и отправить",
  "أدخل النسخ وأرسل",
];

let guardInstalled = false;

// ---------------------------------------------------------------------------
// Policy + receipts (localStorage mirror of host-scoped plugin settings)
// ---------------------------------------------------------------------------

export function normalizeDictationSendBehavior(value: unknown): DictationSendBehavior {
  return value === "native" ? "native" : "insert-only";
}

export function syncDictationSendBehavior(value: DictationSendBehavior): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(POLICY_STORAGE_KEY, normalizeDictationSendBehavior(value));
  } catch {
    // Ignore storage errors
  }
  if (typeof document !== "undefined") {
    applySendButtonVisibility(document, normalizeDictationSendBehavior(value));
  }
}

export function readDictationSendBehavior(): DictationSendBehavior {
  if (typeof window === "undefined" || !window.localStorage) return "insert-only";
  try {
    return normalizeDictationSendBehavior(window.localStorage.getItem(POLICY_STORAGE_KEY));
  } catch {
    return "insert-only";
  }
}

export function readDictationGuardReceipts(): DictationGuardReceipt[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(RECEIPTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as DictationGuardReceipt[]).slice(0, MAX_RECEIPTS) : [];
  } catch {
    return [];
  }
}

export function recordDictationGuardReceipt(
  trigger: DictationGuardTrigger,
  ok: boolean,
  outcome: string,
): DictationGuardReceipt {
  const receipt: DictationGuardReceipt = {
    at: new Date().toISOString(),
    trigger,
    ok,
    outcome,
  };
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const next = [receipt, ...readDictationGuardReceipts()].slice(0, MAX_RECEIPTS);
      window.localStorage.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent(DICTATION_GUARD_EVENT, { detail: receipt }));
    } catch {
      // CustomEvent unavailable in some test environments
    }
  }
  return receipt;
}

// ---------------------------------------------------------------------------
// Overlay discovery
// ---------------------------------------------------------------------------

interface OverlayElements {
  insertButton: HTMLElement | null;
  sendButton: HTMLElement | null;
}

function findButtonByLabels(root: ParentNode, labels: readonly string[]): HTMLElement | null {
  const nodes = root.querySelectorAll<HTMLElement>("[aria-label]");
  for (const node of Array.from(nodes)) {
    const label = node.getAttribute("aria-label");
    if (label && labels.includes(label)) return node;
  }
  return null;
}

export function findDictationOverlayButtons(doc: ParentNode): OverlayElements {
  return {
    insertButton: findButtonByLabels(doc, DICTATION_INSERT_LABELS),
    sendButton: findButtonByLabels(doc, DICTATION_SEND_LABELS),
  };
}

function applySendButtonVisibility(doc: ParentNode, policy: DictationSendBehavior): void {
  const { sendButton } = findDictationOverlayButtons(doc);
  if (policy === "insert-only") {
    if (sendButton) {
      // Re-assert on every pass: React Native Web may rewrite inline styles on re-render.
      if (sendButton.getAttribute(HIDDEN_ATTR) !== "1") sendButton.setAttribute(HIDDEN_ATTR, "1");
      if (sendButton.style.display !== "none") sendButton.style.display = "none";
    }
  } else {
    doc.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}="1"]`).forEach((el) => {
      el.removeAttribute(HIDDEN_ATTR);
      el.style.display = "";
    });
  }
}

// ---------------------------------------------------------------------------
// Native autoSend ref binding (React fiber signature lookup)
// ---------------------------------------------------------------------------

interface HookNode {
  memoizedState: unknown;
  next: HookNode | null;
}

interface FiberNode {
  memoizedState: unknown;
  return: FiberNode | null;
}

export interface BooleanRef {
  current: boolean;
}

function getReactFiber(node: unknown): FiberNode | null {
  if (!node || typeof node !== "object") return null;
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactFiber$")) {
      return (node as Record<string, FiberNode>)[key] ?? null;
    }
  }
  return null;
}

function callbackSource(state: unknown): string {
  if (!Array.isArray(state) || typeof state[0] !== "function") return "";
  try {
    return Function.prototype.toString.call(state[0]);
  } catch {
    return "";
  }
}

function isBooleanRef(state: unknown): state is BooleanRef {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const keys = Object.keys(state);
  return keys.length === 1 && keys[0] === "current" && typeof (state as BooleanRef).current === "boolean";
}

/**
 * Locate MessageInput's private `autoSend` ref by hook signature:
 *   - the component owns a useCallback that calls `applyDictationTranscript(..., { autoSend })`
 *   - the ref is the boolean `useRef(false)` declared right before the
 *     `serverInfo` session-store selector callback.
 * Signatures rely on stable property names, not minified identifiers.
 */
export function findAutoSendRefInHooks(firstHook: HookNode | null): BooleanRef | null {
  let ownsTranscriptCallback = false;
  for (let h = firstHook; h; h = h.next) {
    const src = callbackSource(h.memoizedState);
    if (src.includes("applyDictationTranscript") && src.includes("autoSend")) {
      ownsTranscriptCallback = true;
      break;
    }
  }
  if (!ownsTranscriptCallback) return null;
  for (let h = firstHook; h; h = h.next) {
    if (!isBooleanRef(h.memoizedState)) continue;
    const nextSrc = callbackSource(h.next?.memoizedState);
    if (nextSrc.includes("serverInfo") && nextSrc.includes("sessions")) {
      return h.memoizedState;
    }
  }
  return null;
}

export function resolveAutoSendRef(fromNode: unknown): BooleanRef | null {
  let fiber = getReactFiber(fromNode);
  let depth = 0;
  while (fiber && depth < 200) {
    const state = fiber.memoizedState as HookNode | null;
    if (state && typeof state === "object" && "next" in state) {
      const ref = findAutoSendRefInHooks(state);
      if (ref) return ref;
    }
    fiber = fiber.return;
    depth += 1;
  }
  return null;
}

function resolveAutoSendRefFromDocument(doc: Document): BooleanRef | null {
  const { insertButton } = findDictationOverlayButtons(doc);
  if (insertButton) {
    const ref = resolveAutoSendRef(insertButton);
    if (ref) return ref;
  }
  const candidates: unknown[] = [];
  if (doc.activeElement) candidates.push(doc.activeElement);
  doc.querySelectorAll("textarea, [contenteditable='true']").forEach((el) => candidates.push(el));
  for (const el of candidates) {
    const ref = resolveAutoSendRef(el);
    if (ref) return ref;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Keyboard classification
// ---------------------------------------------------------------------------

export function classifyDictationStopKey(event: {
  key?: string;
  code?: string;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  isComposing?: boolean;
}): "enter" | "cmd-d" | null {
  if (event.isComposing) return null;
  const isEnter = event.key === "Enter";
  if (isEnter && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
    return "enter";
  }
  const isD = event.code === "KeyD" || (event.key ?? "").toLowerCase() === "d";
  if (isD && !event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey)) {
    return "cmd-d";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Status + self-test (能读 / 能试)
// ---------------------------------------------------------------------------

let lastKnownOverlayRoot: HTMLElement | null = null;

function computeOverlayState(doc: Document): DictationOverlayState {
  const { insertButton } = findDictationOverlayButtons(doc);
  if (insertButton) return "recording";
  if (lastKnownOverlayRoot && lastKnownOverlayRoot.isConnected) return "processing";
  return "idle";
}

export function getDictationGuardStatus(docOverride?: Document | null): DictationGuardStatus {
  const doc = docOverride ?? (typeof document !== "undefined" ? document : null);
  const ref = doc ? resolveAutoSendRefFromDocument(doc) : null;
  return {
    policy: readDictationSendBehavior(),
    installed: guardInstalled,
    overlayState: doc ? computeOverlayState(doc) : "idle",
    autoSendRefBound: Boolean(ref),
    autoSendRefValue: ref ? ref.current : null,
    receipts: readDictationGuardReceipts(),
  };
}

export function runDictationGuardSelfTest(docOverride?: Document | null): DictationGuardStatus {
  const status = getDictationGuardStatus(docOverride);
  const parts = [
    `policy=${status.policy}`,
    `installed=${status.installed}`,
    `overlay=${status.overlayState}`,
    `autoSendRef=${status.autoSendRefBound ? "bound" : "not-found"}`,
  ];
  const ok = status.installed && (status.policy === "native" || status.autoSendRefBound);
  recordDictationGuardReceipt(
    "self-test",
    ok,
    status.autoSendRefBound
      ? parts.join(" · ")
      : `${parts.join(" · ")} (open a chat composer, then re-run; key/button rerouting still works without the ref)`,
  );
  return { ...status, receipts: readDictationGuardReceipts() };
}

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------

export function installDictationSendGuard(
  docOverride?: Document | null,
): (() => void) & { reconcileNow?: () => void } {
  const doc = docOverride ?? (typeof document !== "undefined" ? document : null);
  const win = doc?.defaultView ?? (typeof window !== "undefined" ? window : null);
  if (!doc || !doc.body || !win) return () => {};

  let cachedRef: BooleanRef | null = null;
  let lastState: DictationOverlayState = "idle";

  const rerouteToInsert = (trigger: DictationGuardTrigger, insertButton: HTMLElement) => {
    // Clear the native flag first in case a native listener already marked it.
    if (cachedRef) cachedRef.current = false;
    insertButton.click();
    recordDictationGuardReceipt(
      trigger,
      true,
      "Transcript kept in composer for review (auto-send blocked).",
    );
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (readDictationSendBehavior() !== "insert-only") return;
    const kind = classifyDictationStopKey(event);
    if (!kind) return;
    const { insertButton } = findDictationOverlayButtons(doc);
    if (!insertButton) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    rerouteToInsert(kind, insertButton);
  };

  const swallowSendPress = (event: Event) => {
    if (readDictationSendBehavior() !== "insert-only") return;
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== "function") return;
    const { insertButton, sendButton } = findDictationOverlayButtons(doc);
    if (!sendButton || !insertButton || !sendButton.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.type === "click") rerouteToInsert("send-button", insertButton);
  };

  const reconcile = () => {
    const policy = readDictationSendBehavior();
    const { insertButton } = findDictationOverlayButtons(doc);
    if (insertButton) {
      lastKnownOverlayRoot =
        insertButton.parentElement?.parentElement ?? insertButton.parentElement ?? null;
      cachedRef = resolveAutoSendRef(insertButton) ?? cachedRef;
      applySendButtonVisibility(doc, policy);
    }
    const state = computeOverlayState(doc);
    if (state === "processing" && lastState === "recording" && policy === "insert-only") {
      const ref = cachedRef ?? resolveAutoSendRefFromDocument(doc);
      if (ref && ref.current) {
        ref.current = false;
        recordDictationGuardReceipt(
          "processing-flag-reset",
          true,
          "Native auto-send flag cleared before the transcript arrived.",
        );
      }
    }
    if (state === "idle") {
      lastKnownOverlayRoot = null;
    }
    lastState = state;
  };

  win.addEventListener("keydown", onKeyDown, true);
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
    win.addEventListener(type, swallowSendPress, true);
  }
  const observer =
    typeof MutationObserver !== "undefined" ? new MutationObserver(() => reconcile()) : null;
  observer?.observe(doc.body, { childList: true, subtree: true });
  reconcile();
  guardInstalled = true;

  const cleanup = () => {
    guardInstalled = false;
    win.removeEventListener("keydown", onKeyDown, true);
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
      win.removeEventListener(type, swallowSendPress, true);
    }
    observer?.disconnect();
    applySendButtonVisibility(doc, "native");
  };
  // Exposed for deterministic tests and manual diagnostics.
  return Object.assign(cleanup, { reconcileNow: reconcile });
}
