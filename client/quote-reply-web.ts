/// <reference lib="dom" />
/**
 * Quote Reply — select text, one click to quote it as context for the next message.
 *
 * Mirrors the Claude / Antigravity app pattern inside Paseo without touching the app bundle:
 *   1. Select text in a chat message, a sub-agent panel, or a file preview. A small native-looking
 *      toolbar appears next to the selection: "Quote" (add silently) and "Comment" (add and focus a
 *      per-quote comment field).
 *   2. Quotes collect in a tray at the top of the composer card. Each one keeps its own optional
 *      comment, so "comment 1 for selection 1, selection 2 without comment" is one message.
 *   3. On send (Enter / Cmd+Enter / the send button) the tray is folded into the message text as
 *      Markdown blockquotes, each followed by its comment, then the typed message. The result is
 *      visible in the sent bubble, so what the agent received is always auditable.
 *   4. Quotes and comments can be sent with no typed message. Paseo renders its send button only
 *      when the composer has text, so the tray shows its own "Send" while that button is absent;
 *      Cmd/Ctrl+Enter inside a comment field sends too. Both fold the tray and press Paseo's own
 *      send button, so queue / interrupt behaviour is whatever the user configured.
 *
 * Send safety: the composition is written into the composer synchronously in the capture phase, so
 * Paseo's own submit handler reads the composed text. A verifier then checks the outcome:
 *   - composer still holds the text and is editable: the key did not send (for example the send
 *     shortcut is Cmd+Enter). The text is restored and the tray kept.
 *   - composer still holds the text but is read-only: a new session keeps it locked while the agent
 *     is created. That send is in flight; the verifier waits instead of pulling the text back.
 *   - composer cleared: sent. The tray is emptied, then the sent bubble is looked for.
 *
 * The bubble check reads only this composer's own chat list. Paseo keeps every session opened in
 * this window mounted and hidden, so "the last user message in the document" is usually another
 * session's; reading it made a successful send look like a dropped one and put the quotes back
 * (fixed 2026-11-13). The tray is restored only on positive evidence: a new bubble in this pane
 * that is exactly the typed text with the quotes missing. No bubble, or an unrelated one, proves
 * nothing and changes nothing. Every outcome is a receipt shown in Settings -> Plugins -> File
 * Inspector & Finder (read / test / tune).
 */

import { syncPaseoThemeCssVariables } from "./theme-web";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuoteSourceKind = "assistant" | "user" | "file" | "subagent" | "other";

export interface QuoteSource {
  kind: QuoteSourceKind;
  /** File name for file previews; omitted for chat messages. */
  label?: string;
}

export interface QuoteItem {
  id: string;
  text: string;
  comment: string;
  source: QuoteSource;
  createdAt: string;
  truncated?: boolean;
}

export interface QuoteReplyPreferences {
  enabled: boolean;
  maxQuoteChars: number;
}

export type QuoteReplyTrigger =
  | "add"
  | "remove"
  | "clear"
  | "flush"
  | "send"
  | "send-reverted"
  | "send-restored"
  | "self-test";

export interface QuoteReplyReceipt {
  at: string;
  trigger: QuoteReplyTrigger;
  sessionKey: string;
  quoteCount: number;
  chars: number;
  ok: boolean;
  outcome: string;
}

export interface QuoteReplyStatus {
  installed: boolean;
  preferences: QuoteReplyPreferences;
  sessionKey: string;
  quotes: QuoteItem[];
  composerFound: boolean;
  trayMounted: boolean;
  /** Chat lists in the document right now, hidden sessions included. */
  mountedChatPanes: number;
  /** Whether the after-send check can find this composer's own chat list among them. */
  paneResolved: boolean;
  receipts: QuoteReplyReceipt[];
}

export interface QuoteReplySelfTestResult {
  ok: boolean;
  testedAt: string;
  sampleOutput: string;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  summary: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREFS_KEY = "paseo:finder-plugin:quote-reply-prefs";
const TRAYS_KEY = "paseo:finder-plugin:quote-reply-trays";
const RECEIPTS_KEY = "paseo:finder-plugin:quote-reply-receipts";
const MAX_RECEIPTS = 20;
const MAX_TRAY_SESSIONS = 40;
export const QUOTE_REPLY_EVENT = "paseo-finder:quote-reply";

export const DEFAULT_QUOTE_REPLY_PREFERENCES: QuoteReplyPreferences = {
  enabled: true,
  maxQuoteChars: 4000,
};

const TOOLBAR_ID = "paseo-finder-quote-toolbar";
const TRAY_ID = "paseo-finder-quote-tray";
const STYLE_ID = "paseo-finder-quote-style";
const COMPOSER_SELECTOR = "textarea[data-composer-input]";
const COMPOSER_ROOT_SELECTOR = '[data-testid="message-input-root"]';
const ATTACH_BUTTON_SELECTOR = '[data-testid="message-input-attach-button"]';
const AUTOCOMPLETE_SELECTOR = '[data-testid="composer-autocomplete-popover"]';
const USER_MESSAGE_SELECTOR = '[data-testid="user-message"]';
const USER_MESSAGE_TRAILING_SELECTOR = '[data-testid="user-message-trailing-row"]';
const CHAT_SCROLL_SELECTOR = '[data-testid="agent-chat-scroll"]';

/** First look at the composer after a key / press that may have sent. */
const FOLD_CHECK_MS = 650;
/** A new session keeps the text read-only while its agent is created; poll that long before giving up. */
const LOCKED_POLL_MS = 400;
const LOCKED_WAIT_MS = 90_000;
/** Looking for the sent bubble: poll, and only call it dropped once the list has settled. */
const CONFIRM_POLL_MS = 400;
const CONFIRM_SETTLE_MS = 3000;
const CONFIRM_WINDOW_MS = 10_000;

/** Regions where a selection may be quoted. Anything editable is always excluded. */
const QUOTABLE_REGION_SELECTOR = [
  '[data-testid="agent-chat-scroll"]',
  '[data-testid="assistant-message"]',
  '[data-testid="user-message"]',
  '[data-testid="workspace-file-pane"]',
  '[data-testid="file-mode-preview"]',
  '[data-testid="file-mode-source"]',
  '[data-testid="provider-subagent-panel"]',
].join(",");

/**
 * Paseo v0.15.3 submit button labels (`message.send*` / `message.queue*`) across shipped locales.
 * Harvested from the app bundle; a press on any of these folds the tray into the message.
 */
export const QUOTE_REPLY_SEND_LABELS: readonly string[] = [
  "Send message",
  "Queue message",
  "Send and interrupt",
  "Send and steer",
  "发送消息",
  "消息排队",
  "发送并中断",
  "发送并引导",
  "メッセージを送信",
  "メッセージをキューに追加",
  "送信して中断",
  "送信して指示を追加",
  "메시지 보내기",
  "메시지 대기열에 추가",
  "보내고 중단",
  "보내고 지시 추가",
  "enviar mensaje",
  "mensaje de cola",
  "Enviar e interrumpir",
  "Enviar y orientar",
  "Enviar mensagem",
  "Enfileirar mensagem",
  "Enviar e interromper",
  "Enviar e orientar",
  "Envoyer le message",
  "Mettre le message en file d’attente",
  "Envoyer et interrompre",
  "Envoyer et réorienter",
  "Отправить сообщение",
  "Поставить сообщение в очередь",
  "Сообщение в очередь",
  "Отправить и прервать",
  "Отправить и направить",
  "أرسل رسالة",
  "رسالة قائمة الانتظار",
  "إرسال ومقاطعة",
  "إرسال وتوجيه",
];

const SEND_LABEL_SET = new Set(QUOTE_REPLY_SEND_LABELS.map((l) => l.toLowerCase()));

export function isQuoteReplySendLabel(label: string | null | undefined): boolean {
  return Boolean(label) && SEND_LABEL_SET.has(String(label).trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Copy (zh / en). Plain wording, no decoration.
// ---------------------------------------------------------------------------

interface QuoteCopy {
  quote: string;
  comment: string;
  trayTitle: (n: number) => string;
  commentPlaceholder: string;
  send: string;
  sendHint: (modKey: string) => string;
  insert: string;
  insertHint: string;
  clear: string;
  remove: string;
  fromFile: (name: string) => string;
  restoredToast: string;
  revertedToast: string;
}

const COPY_ZH: QuoteCopy = {
  quote: "引用",
  comment: "评论",
  trayTitle: (n) => `引用 ${n}`,
  commentPlaceholder: "添加评论（可选）",
  send: "发送",
  sendHint: (modKey) => `直接发送引用和评论，无需输入正文（评论框内按 ${modKey}）`,
  insert: "展开到输入框",
  insertHint: "把引用写进输入框正文，便于直接编辑",
  clear: "清空",
  remove: "移除引用",
  fromFile: (name) => `来自 ${name}`,
  restoredToast: "引用未随消息发出，已恢复到引用栏",
  revertedToast: "本次按键未发送，引用保留在引用栏",
};

const COPY_EN: QuoteCopy = {
  quote: "Quote",
  comment: "Comment",
  trayTitle: (n) => (n === 1 ? "1 quote" : `${n} quotes`),
  commentPlaceholder: "Add a comment (optional)",
  send: "Send",
  sendHint: (modKey) => `Send the quotes and comments as they are, no message needed (${modKey} in a comment)`,
  insert: "Expand into message",
  insertHint: "Write the quotes into the message text so you can edit them directly",
  clear: "Clear",
  remove: "Remove quote",
  fromFile: (name) => `From ${name}`,
  restoredToast: "Quotes were not in the sent message; restored to the tray",
  revertedToast: "That key did not send; quotes kept in the tray",
};

function copyFor(locale: string | null | undefined): QuoteCopy {
  return String(locale ?? "").toLowerCase().startsWith("zh") ? COPY_ZH : COPY_EN;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // quota or private mode: the tray still works in memory for this page
  }
}

function emitChange(): void {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(QUOTE_REPLY_EVENT));
  } catch {
    // ignore
  }
}

export function readQuoteReplyPreferences(): QuoteReplyPreferences {
  const stored = readJson<Partial<QuoteReplyPreferences>>(PREFS_KEY, {});
  const maxQuoteChars = Number(stored.maxQuoteChars);
  return {
    enabled: stored.enabled !== false,
    maxQuoteChars:
      Number.isFinite(maxQuoteChars) && maxQuoteChars >= 200
        ? Math.min(Math.floor(maxQuoteChars), 20000)
        : DEFAULT_QUOTE_REPLY_PREFERENCES.maxQuoteChars,
  };
}

export function syncQuoteReplyPreferences(
  patch: Partial<QuoteReplyPreferences>,
): QuoteReplyPreferences {
  const next = { ...readQuoteReplyPreferences(), ...patch };
  writeJson(PREFS_KEY, next);
  emitChange();
  return readQuoteReplyPreferences();
}

export function resetQuoteReplyPreferences(): QuoteReplyPreferences {
  try {
    storage()?.removeItem(PREFS_KEY);
  } catch {
    // ignore
  }
  emitChange();
  return readQuoteReplyPreferences();
}

type TrayStore = Record<string, { updatedAt: string; quotes: QuoteItem[] }>;

function readTrays(): TrayStore {
  const store = readJson<TrayStore>(TRAYS_KEY, {});
  return store && typeof store === "object" ? store : {};
}

export function readQuoteTray(sessionKey: string): QuoteItem[] {
  const entry = readTrays()[sessionKey];
  return Array.isArray(entry?.quotes) ? entry.quotes : [];
}

export function writeQuoteTray(sessionKey: string, quotes: QuoteItem[]): void {
  const store = readTrays();
  if (quotes.length === 0) {
    delete store[sessionKey];
  } else {
    store[sessionKey] = { updatedAt: new Date().toISOString(), quotes };
  }
  const keys = Object.keys(store);
  if (keys.length > MAX_TRAY_SESSIONS) {
    keys
      .sort((a, b) => (store[a].updatedAt < store[b].updatedAt ? -1 : 1))
      .slice(0, keys.length - MAX_TRAY_SESSIONS)
      .forEach((k) => delete store[k]);
  }
  writeJson(TRAYS_KEY, store);
  emitChange();
}

export function readQuoteReplyReceipts(): QuoteReplyReceipt[] {
  const list = readJson<QuoteReplyReceipt[]>(RECEIPTS_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function recordQuoteReplyReceipt(receipt: Omit<QuoteReplyReceipt, "at">): void {
  const list = [{ at: new Date().toISOString(), ...receipt }, ...readQuoteReplyReceipts()];
  writeJson(RECEIPTS_KEY, list.slice(0, MAX_RECEIPTS));
  emitChange();
}

// ---------------------------------------------------------------------------
// Pure logic (unit tested)
// ---------------------------------------------------------------------------

/** Trims, normalises line endings, drops trailing spaces, collapses 3+ blank lines, caps length. */
export function normalizeQuoteText(
  raw: string,
  maxChars: number = DEFAULT_QUOTE_REPLY_PREFERENCES.maxQuoteChars,
): { text: string; truncated: boolean } {
  let text = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  let truncated = false;
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars).trimEnd()}…`;
    truncated = true;
  }
  return { text, truncated };
}

/** One quote as a Markdown blockquote, followed by its comment paragraph when present. */
export function formatQuoteBlock(quote: Pick<QuoteItem, "text" | "comment" | "source">): string {
  const lines: string[] = [];
  if (quote.source?.kind === "file" && quote.source.label) {
    lines.push(`> [${quote.source.label}]`);
  }
  for (const line of quote.text.split("\n")) {
    lines.push(line.length ? `> ${line}` : ">");
  }
  const comment = (quote.comment ?? "").trim();
  return comment ? `${lines.join("\n")}\n\n${comment}` : lines.join("\n");
}

/** The prefix written ahead of the typed message: every quote block, blank-line separated. */
export function formatQuotePrefix(quotes: ReadonlyArray<Pick<QuoteItem, "text" | "comment" | "source">>): string {
  return quotes
    .filter((q) => q.text.trim().length > 0)
    .map(formatQuoteBlock)
    .join("\n\n");
}

/** Final message text: quote prefix, then the typed message (if any). */
export function composeQuotedMessage(
  quotes: ReadonlyArray<Pick<QuoteItem, "text" | "comment" | "source">>,
  typed: string,
): { text: string; prefix: string } {
  const prefix = formatQuotePrefix(quotes);
  if (!prefix) return { text: typed, prefix: "" };
  const body = typed.replace(/^\s+/, "");
  const fullPrefix = body ? `${prefix}\n\n` : prefix;
  return { text: `${fullPrefix}${body}`, prefix: fullPrefix };
}

/** Undo `composeQuotedMessage` when a key press turned out not to send. */
export function stripQuotedPrefix(value: string, prefix: string): string | null {
  if (!prefix || !value.startsWith(prefix)) return null;
  return value.slice(prefix.length);
}

/** Session key for the tray: agent id from `/agent/<id>` (or `/ag/<id>`), else workspace id, else a shared draft key. */
export function resolveQuoteSessionKey(pathname: string | null | undefined): string {
  const raw = String(pathname ?? "");
  const agent = raw.match(/\/(?:ag|agent)\/([A-Za-z0-9-]{8,})/);
  if (agent) return `ag:${agent[1]}`;
  const ws = raw.match(/\/workspace\/([A-Za-z0-9_-]+)/);
  if (ws) return `ws:${ws[1]}`;
  return "draft";
}

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Short probe used to confirm the quote actually reached the sent bubble. Taken from the first
 * non-empty line only: the bubble shows every quoted line behind "> ", so a probe that spans a
 * line break is never found there.
 */
export function quoteFingerprint(text: string): string {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? "";
  return collapseWhitespace(firstLine).slice(0, 24);
}

export function messageContainsQuote(messageText: string, quotes: ReadonlyArray<Pick<QuoteItem, "text">>): boolean {
  const hay = messageText.replace(/\s+/g, " ");
  return quotes.every((q) => {
    const probe = quoteFingerprint(q.text);
    return !probe || hay.includes(probe);
  });
}

export type QuoteFoldOutcome = "sent" | "in-flight" | "not-sent";

/**
 * What the composer says after a key / press folded the tray into it. `locked` is the textarea
 * being read-only or disabled: Paseo does that while a new session's agent is being created and
 * keeps the text on screen meanwhile, so text that is still there is not proof that nothing was sent.
 */
export function judgeFoldedComposer(input: {
  connected: boolean;
  value: string;
  prefix: string;
  locked: boolean;
}): QuoteFoldOutcome {
  if (!input.connected) return "sent"; // the screen moved on; the text went with the send or into the draft
  if (!input.prefix || !input.value.startsWith(input.prefix)) return "sent";
  return input.locked ? "in-flight" : "not-sent";
}

export type QuoteSendVerdict = "confirmed" | "dropped" | "pending";

/**
 * Reads the user bubbles of ONE chat pane and decides whether the folded quotes reached the message.
 *   confirmed: a bubble that appeared after the send carries every quote.
 *   dropped:   the list has settled and the newest such bubble is exactly the typed text, so the
 *              message went out without its quotes.
 *   pending:   anything else. An unrelated bubble, or none at all (a queued send, a row that is not
 *              mounted), is not evidence either way.
 */
export function judgeQuoteSend(input: {
  bubbles: ReadonlyArray<{ text: string; isNew: boolean }>;
  quotes: ReadonlyArray<Pick<QuoteItem, "text">>;
  typed: string;
  settled: boolean;
}): QuoteSendVerdict {
  const fresh = input.bubbles.filter((b) => b.isNew);
  if (fresh.some((b) => messageContainsQuote(b.text, input.quotes))) return "confirmed";
  const typed = collapseWhitespace(input.typed);
  const newest = fresh[fresh.length - 1];
  if (input.settled && typed && newest && collapseWhitespace(newest.text) === typed) return "dropped";
  return "pending";
}

/** A bubble's own message text: its full text minus the timestamp / actions row that follows it. */
export function userBubbleMessageText(full: string, trailing: string): string {
  return trailing && full.endsWith(trailing) ? full.slice(0, full.length - trailing.length) : full;
}

function newQuoteId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function appendQuote(
  quotes: QuoteItem[],
  rawText: string,
  source: QuoteSource,
  maxChars: number,
): { quotes: QuoteItem[]; item: QuoteItem | null; duplicate: boolean } {
  const { text, truncated } = normalizeQuoteText(rawText, maxChars);
  if (!text) return { quotes, item: null, duplicate: false };
  const existing = quotes.find((q) => q.text === text);
  if (existing) return { quotes, item: existing, duplicate: true };
  const item: QuoteItem = {
    id: newQuoteId(),
    text,
    comment: "",
    source,
    createdAt: new Date().toISOString(),
    ...(truncated ? { truncated: true } : {}),
  };
  return { quotes: [...quotes, item], item, duplicate: false };
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const textareaValueSetter = (() => {
  try {
    return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set ?? null;
  } catch {
    return null;
  }
})();

/** Writes into Paseo's React-Native-Web composer the way typing would, so React state follows. */
export function setComposerText(textarea: HTMLTextAreaElement, value: string, caret?: number): void {
  if (textareaValueSetter) textareaValueSetter.call(textarea, value);
  else textarea.value = value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  const pos = typeof caret === "number" ? caret : value.length;
  try {
    textarea.setSelectionRange(pos, pos);
  } catch {
    // ignore
  }
}

function isVisible(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isEditable(node: Node | null): boolean {
  const el = (node && (node.nodeType === 1 ? (node as Element) : node.parentElement)) as HTMLElement | null;
  if (!el) return false;
  return Boolean(el.closest("textarea, input, [contenteditable=''], [contenteditable='true']"));
}

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

/** The composer a quote should go to: the focused one, else the last one used, else the first visible. */
function findComposer(doc: Document, lastUsed: HTMLTextAreaElement | null): HTMLTextAreaElement | null {
  const active = doc.activeElement;
  if (active instanceof HTMLTextAreaElement && active.matches(COMPOSER_SELECTOR)) return active;
  if (lastUsed && lastUsed.isConnected && isVisible(lastUsed)) return lastUsed;
  const all = Array.from(doc.querySelectorAll<HTMLTextAreaElement>(COMPOSER_SELECTOR));
  return all.find((t) => isVisible(t)) ?? null;
}

/** The composer card: the smallest ancestor holding both the textarea and the attach button. */
function findComposerCard(textarea: HTMLTextAreaElement): HTMLElement | null {
  const root = textarea.closest<HTMLElement>(COMPOSER_ROOT_SELECTOR);
  const attach = root?.querySelector(ATTACH_BUTTON_SELECTOR) ?? null;
  if (!root) return null;
  if (!attach) return root;
  let el: HTMLElement | null = textarea.parentElement;
  while (el && el !== root) {
    if (el.contains(attach)) return el;
    el = el.parentElement;
  }
  return root;
}

/**
 * The chat list that belongs to this composer: the one inside its nearest ancestor that has any.
 * Paseo keeps other sessions mounted and hidden in sibling subtrees, so a document-wide query finds
 * theirs too. A composer with no list of its own (the new-session screen) climbs up to one of those
 * hidden lists; that is not its pane, so the answer is null.
 */
export function findChatPaneFor(composer: Element): Element | null {
  let el: Element | null = composer.parentElement;
  while (el) {
    const scroll = el.querySelector(CHAT_SCROLL_SELECTOR);
    if (scroll) return isVisible(scroll) ? scroll : null;
    el = el.parentElement;
  }
  return null;
}

/** Paseo's own send button for this composer, when it is rendered and enabled. */
function findNativeSendButton(composer: HTMLTextAreaElement): HTMLElement | null {
  const root = composer.closest(COMPOSER_ROOT_SELECTOR);
  if (!root) return null;
  for (const btn of Array.from(root.querySelectorAll<HTMLElement>("button, [role='button']"))) {
    if (!isQuoteReplySendLabel(btn.getAttribute("aria-label"))) continue;
    if (btn.getAttribute("aria-disabled") === "true" || (btn as HTMLButtonElement).disabled) continue;
    return btn;
  }
  return null;
}

function describeSource(anchor: Element): QuoteSource {
  if (anchor.closest('[data-testid="assistant-message"]')) return { kind: "assistant" };
  if (anchor.closest('[data-testid="user-message"]')) return { kind: "user" };
  if (anchor.closest('[data-testid="provider-subagent-panel"]')) return { kind: "subagent" };
  const pane = anchor.closest('[data-testid="workspace-file-pane"], [data-testid="file-mode-preview"], [data-testid="file-mode-source"]');
  if (pane) {
    return { kind: "file", label: resolveFileLabel(pane) };
  }
  return { kind: "other" };
}

function resolveFileLabel(pane: Element): string | undefined {
  // Walk up to the pane that owns a selected tab and read its title.
  let el: Element | null = pane;
  for (let depth = 0; el && depth < 12; depth += 1) {
    const tab = el.querySelector('[role="tab"][aria-selected="true"]');
    if (tab) {
      const text = (tab.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) return text.slice(0, 80);
    }
    el = el.parentElement;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Styles (theme tokens from theme-web, so all 7 Paseo themes match)
// ---------------------------------------------------------------------------

const STYLE_TEXT = `
#${TOOLBAR_ID} {
  position: fixed; z-index: 2147483000; display: flex; gap: 2px; padding: 3px;
  background: var(--paseo-finder-surface-0, #fff);
  border: 1px solid var(--paseo-finder-border, rgba(0,0,0,.12));
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0,0,0,.10), 0 1px 3px rgba(0,0,0,.06);
  font: 500 12.5px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  user-select: none; -webkit-user-select: none;
}
#${TOOLBAR_ID} button {
  all: unset; display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
  padding: 5px 8px; border-radius: 5px; color: var(--paseo-finder-fg, #1a1a1e);
}
#${TOOLBAR_ID} button:hover { background: var(--paseo-finder-surface-2, rgba(0,0,0,.06)); }
#${TOOLBAR_ID} svg { width: 13px; height: 13px; flex: none; color: var(--paseo-finder-fg-muted, #71717a); }

#${TRAY_ID} {
  display: flex; flex-direction: column; gap: 2px; padding: 8px 10px 2px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  max-height: 200px; overflow-y: auto;
}
#${TRAY_ID} .qr-head {
  display: flex; align-items: center; gap: 10px; font-size: 11.5px;
  color: var(--paseo-finder-fg-muted, #71717a); padding: 0 2px 2px;
}
#${TRAY_ID} .qr-head .qr-spacer { flex: 1; }
#${TRAY_ID} .qr-head button {
  all: unset; cursor: pointer; font-size: 11.5px; color: var(--paseo-finder-fg-muted, #71717a);
}
#${TRAY_ID} .qr-head button:hover { color: var(--paseo-finder-fg, #1a1a1e); }
#${TRAY_ID} .qr-head button[data-act="send"] { color: var(--paseo-finder-fg, #1a1a1e); font-weight: 600; }
/* Paseo's own send button is on screen: one send control is enough. */
#${TRAY_ID}[data-native-send] .qr-head button[data-act="send"] { display: none; }
#${TRAY_ID} .qr-item {
  display: flex; align-items: flex-start; gap: 8px; padding: 4px 2px 4px 9px;
  border-left: 2px solid var(--paseo-finder-border-accent, var(--paseo-finder-border, #d4d4d8));
  border-radius: 1px;
}
#${TRAY_ID} .qr-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
#${TRAY_ID} .qr-src { font-size: 11px; color: var(--paseo-finder-fg-extra-muted, #a1a1aa); }
#${TRAY_ID} .qr-quote {
  font-size: 12.5px; line-height: 1.45; color: var(--paseo-finder-fg-muted, #52525b);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  white-space: pre-wrap; word-break: break-word;
}
#${TRAY_ID} .qr-comment {
  all: unset; display: block; width: 100%; box-sizing: border-box; font-size: 13px; line-height: 1.4;
  color: var(--paseo-finder-fg, #1a1a1e); padding: 1px 0; cursor: text;
}
#${TRAY_ID} .qr-comment::placeholder { color: var(--paseo-finder-fg-extra-muted, #a1a1aa); }
#${TRAY_ID} .qr-x {
  all: unset; cursor: pointer; flex: none; width: 18px; height: 18px; border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--paseo-finder-fg-extra-muted, #a1a1aa);
}
#${TRAY_ID} .qr-x:hover { color: var(--paseo-finder-fg, #1a1a1e); background: var(--paseo-finder-surface-2, rgba(0,0,0,.06)); }
#${TRAY_ID} .qr-x svg { width: 12px; height: 12px; }
`;

const ICON_QUOTE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/><path d="M3 12v6"/></svg>';
const ICON_COMMENT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
const ICON_X =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

// ---------------------------------------------------------------------------
// Runtime state shared with Settings
// ---------------------------------------------------------------------------

let installed = false;
let runtime: {
  doc: Document;
  getSessionKey: () => string;
  findComposer: () => HTMLTextAreaElement | null;
  addFromSelection: (focusComment: boolean) => boolean;
} | null = null;

export function getQuoteReplyStatus(): QuoteReplyStatus {
  const sessionKey = runtime?.getSessionKey() ?? "draft";
  const doc = runtime?.doc ?? (typeof document !== "undefined" ? document : null);
  const composer = runtime?.findComposer() ?? null;
  return {
    installed,
    preferences: readQuoteReplyPreferences(),
    sessionKey,
    quotes: readQuoteTray(sessionKey),
    composerFound: Boolean(composer),
    trayMounted: Boolean(doc?.getElementById(TRAY_ID)),
    mountedChatPanes: doc?.querySelectorAll(CHAT_SCROLL_SELECTOR).length ?? 0,
    paneResolved: Boolean(composer && findChatPaneFor(composer)),
    receipts: readQuoteReplyReceipts(),
  };
}

/** Adds the current page selection to the tray (used by the Command Center item). */
export function quoteCurrentSelection(focusComment = false): boolean {
  return runtime?.addFromSelection(focusComment) ?? false;
}

export function clearQuoteTray(sessionKey?: string): void {
  const key = sessionKey ?? runtime?.getSessionKey() ?? "draft";
  const count = readQuoteTray(key).length;
  writeQuoteTray(key, []);
  if (count) {
    recordQuoteReplyReceipt({ trigger: "clear", sessionKey: key, quoteCount: count, chars: 0, ok: true, outcome: "Tray cleared" });
  }
}

/** Pure + DOM locator self-test, safe to run any time (never sends or edits the composer). */
export function runQuoteReplySelfTest(): QuoteReplySelfTestResult {
  const sample: QuoteItem[] = [
    { id: "a", text: "First selected line\nsecond line", comment: "comment for selection 1", source: { kind: "assistant" }, createdAt: "" },
    { id: "b", text: "Selection two, no comment", comment: "", source: { kind: "file", label: "notes.md" }, createdAt: "" },
  ];
  const composed = composeQuotedMessage(sample, "Typed message");
  const expected =
    "> First selected line\n> second line\n\ncomment for selection 1\n\n> [notes.md]\n> Selection two, no comment\n\nTyped message";
  const checks: QuoteReplySelfTestResult["checks"] = [
    { name: "format", ok: composed.text === expected },
    { name: "revert", ok: stripQuotedPrefix(composed.text, composed.prefix) === "Typed message" },
    { name: "fingerprint", ok: messageContainsQuote(composed.text, sample) },
    {
      // A foreign bubble must not read as a dropped send; the sent one must confirm it.
      name: "verify",
      ok:
        judgeQuoteSend({ bubbles: [{ text: "another session", isNew: true }], quotes: sample, typed: "Typed message", settled: true }) === "pending" &&
        judgeQuoteSend({ bubbles: [{ text: composed.text, isNew: true }], quotes: sample, typed: "Typed message", settled: true }) === "confirmed",
    },
  ];
  const status = getQuoteReplyStatus();
  checks.push({ name: "installed", ok: status.installed });
  checks.push({
    name: "composer",
    ok: status.composerFound,
    detail: status.composerFound ? undefined : "open a chat so the composer is on screen, then re-run",
  });
  // On a chat screen the composer's own list must be found; a new-session screen has none.
  const onChat = status.composerFound && status.sessionKey.startsWith("ag:");
  checks.push({
    name: "pane",
    ok: !onChat || status.paneResolved,
    detail: `${status.mountedChatPanes} chat list(s) mounted; this composer's own ${status.paneResolved ? "found" : "not found"}`,
  });
  const ok = checks.every((c) => c.ok || c.name === "composer");
  const summary =
    checks.map((c) => `${c.name}=${c.ok ? "ok" : "fail"}`).join(" · ") + ` · panes=${status.mountedChatPanes}`;
  recordQuoteReplyReceipt({
    trigger: "self-test",
    sessionKey: status.sessionKey,
    quoteCount: status.quotes.length,
    chars: composed.text.length,
    ok,
    outcome: summary,
  });
  return { ok, testedAt: new Date().toISOString(), sampleOutput: composed.text, checks, summary };
}

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------

export interface QuoteReplyInstallOptions {
  getLocale?: () => string | null | undefined;
  doc?: Document;
  /** Optional toast hook so outcomes are visible without opening Settings. */
  notify?: (message: string) => void;
}

export function installQuoteReply(options: QuoteReplyInstallOptions = {}): () => void {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  const win = doc?.defaultView ?? (typeof window !== "undefined" ? window : null);
  if (!doc || !win || !doc.body) return () => {};
  if (installed) return () => {};

  const copy = () => copyFor(options.getLocale?.());
  const getSessionKey = () => resolveQuoteSessionKey(win.location?.pathname);
  const modEnterLabel = /Mac|iPhone|iPad|iPod/i.test(win.navigator?.platform ?? "")
    ? "⌘+Enter"
    : "Ctrl+Enter";
  let lastComposer: HTMLTextAreaElement | null = null;
  let pendingSelection: { text: string; source: QuoteSource } | null = null;
  let focusCommentId: string | null = null;
  let rafToolbar = 0;
  let rafTray = 0;
  /** True between folding the tray into a send and verifying it, so the tray stays hidden. */
  let folding = false;

  try {
    syncPaseoThemeCssVariables(doc, win);
  } catch {
    // theme sync is cosmetic
  }
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE_TEXT;
    doc.head.appendChild(style);
  }

  // ---- selection toolbar --------------------------------------------------

  const hideToolbar = () => {
    doc.getElementById(TOOLBAR_ID)?.remove();
    pendingSelection = null;
  };

  const readSelection = (): { text: string; source: QuoteSource; rect: DOMRect } | null => {
    const sel = win.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const range = sel.getRangeAt(0);
    const anchor = elementOf(range.commonAncestorContainer);
    if (!anchor || isEditable(anchor) || isEditable(sel.anchorNode) || isEditable(sel.focusNode)) return null;
    if (anchor.closest(`#${TRAY_ID}, #${TOOLBAR_ID}`)) return null;
    const region = anchor.closest(QUOTABLE_REGION_SELECTOR)
      ?? elementOf(sel.anchorNode)?.closest(QUOTABLE_REGION_SELECTOR)
      ?? null;
    if (!region) return null;
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    const sourceEl = elementOf(sel.anchorNode) ?? anchor;
    return { text, source: describeSource(sourceEl), rect };
  };

  const showToolbar = () => {
    rafToolbar = 0;
    if (!readQuoteReplyPreferences().enabled) {
      hideToolbar();
      return;
    }
    const picked = readSelection();
    if (!picked) {
      hideToolbar();
      return;
    }
    pendingSelection = { text: picked.text, source: picked.source };
    let bar = doc.getElementById(TOOLBAR_ID);
    if (!bar) {
      bar = doc.createElement("div");
      bar.id = TOOLBAR_ID;
      bar.setAttribute("data-testid", "quote-reply-toolbar");
      bar.setAttribute("role", "toolbar");
      const c = copy();
      bar.innerHTML =
        `<button type="button" data-act="quote" data-testid="quote-reply-quote">${ICON_QUOTE}<span>${c.quote}</span></button>` +
        `<button type="button" data-act="comment" data-testid="quote-reply-comment">${ICON_COMMENT}<span>${c.comment}</span></button>`;
      // Keep the page selection alive while pressing the toolbar.
      bar.addEventListener("mousedown", (e) => e.preventDefault());
      bar.addEventListener("pointerdown", (e) => e.preventDefault());
      bar.addEventListener("click", (e) => {
        const btn = (e.target as Element).closest("button");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        addPending(btn.getAttribute("data-act") === "comment");
      });
      doc.body.appendChild(bar);
    }
    const width = bar.offsetWidth || 130;
    const height = bar.offsetHeight || 30;
    const r = picked.rect;
    let top = r.top - height - 8;
    if (top < 8) top = r.bottom + 8;
    let left = r.right - width / 2;
    left = Math.max(8, Math.min(left, win.innerWidth - width - 8));
    top = Math.max(8, Math.min(top, win.innerHeight - height - 8));
    bar.style.top = `${Math.round(top)}px`;
    bar.style.left = `${Math.round(left)}px`;
  };

  const scheduleToolbar = () => {
    if (rafToolbar) return;
    rafToolbar = win.requestAnimationFrame(showToolbar);
  };

  const addQuoteText = (text: string, source: QuoteSource, focusComment: boolean): boolean => {
    const key = getSessionKey();
    const prefs = readQuoteReplyPreferences();
    const result = appendQuote(readQuoteTray(key), text, source, prefs.maxQuoteChars);
    if (!result.item) return false;
    if (!result.duplicate) {
      writeQuoteTray(key, result.quotes);
      recordQuoteReplyReceipt({
        trigger: "add",
        sessionKey: key,
        quoteCount: result.quotes.length,
        chars: result.item.text.length,
        ok: true,
        outcome: `${source.kind}${source.label ? ` (${source.label})` : ""}${result.item.truncated ? ", truncated" : ""}`,
      });
    }
    focusCommentId = focusComment ? result.item.id : null;
    renderTray();
    if (!focusComment) {
      const composer = findComposer(doc, lastComposer);
      composer?.focus();
    }
    return true;
  };

  const addPending = (focusComment: boolean) => {
    const pending = pendingSelection;
    hideToolbar();
    if (!pending) return;
    win.getSelection()?.removeAllRanges();
    addQuoteText(pending.text, pending.source, focusComment);
  };

  const addFromSelection = (focusComment: boolean): boolean => {
    const picked = readSelection();
    if (!picked) return false;
    hideToolbar();
    win.getSelection()?.removeAllRanges();
    return addQuoteText(picked.text, picked.source, focusComment);
  };

  // ---- tray ---------------------------------------------------------------

  const updateQuote = (id: string, patch: Partial<QuoteItem>) => {
    const key = getSessionKey();
    writeQuoteTray(
      key,
      readQuoteTray(key).map((q) => (q.id === id ? { ...q, ...patch } : q)),
    );
  };

  const renderTray = () => {
    rafTray = 0;
    const key = getSessionKey();
    const quotes = readQuoteTray(key);
    const existing = doc.getElementById(TRAY_ID);
    const composer = findComposer(doc, lastComposer);
    const card = composer ? findComposerCard(composer) : null;
    if (folding || !quotes.length || !card || !readQuoteReplyPreferences().enabled) {
      existing?.remove();
      return;
    }
    let tray = existing;
    if (!tray || !card.contains(tray)) {
      tray?.remove();
      tray = doc.createElement("div");
      tray.id = TRAY_ID;
      tray.setAttribute("data-testid", "quote-reply-tray");
      tray.addEventListener("click", onTrayClick);
      tray.addEventListener("input", onTrayInput);
      tray.addEventListener("keydown", onTrayKeyDown);
      card.insertBefore(tray, card.firstChild);
    }
    // Rebuild only when the set of quotes changes, so typing in a comment never loses focus.
    const signature = `${key}|${quotes.map((q) => q.id).join(",")}`;
    if (tray.getAttribute("data-signature") !== signature) {
      tray.setAttribute("data-signature", signature);
      tray.setAttribute("data-session", key);
      const c = copy();
      tray.innerHTML = "";
      const head = doc.createElement("div");
      head.className = "qr-head";
      head.innerHTML =
        `<span data-testid="quote-reply-count"></span><span class="qr-spacer"></span>` +
        `<button type="button" data-act="send" data-testid="quote-reply-send"></button>` +
        `<button type="button" data-act="flush" data-testid="quote-reply-flush"></button>` +
        `<button type="button" data-act="clear" data-testid="quote-reply-clear"></button>`;
      (head.children[0] as HTMLElement).textContent = c.trayTitle(quotes.length);
      const send = head.querySelector<HTMLElement>('[data-act="send"]')!;
      send.textContent = c.send;
      send.title = c.sendHint(modEnterLabel);
      const flush = head.querySelector<HTMLElement>('[data-act="flush"]')!;
      flush.textContent = c.insert;
      flush.title = c.insertHint;
      head.querySelector<HTMLElement>('[data-act="clear"]')!.textContent = c.clear;
      tray.appendChild(head);
      for (const q of quotes) {
        const item = doc.createElement("div");
        item.className = "qr-item";
        item.setAttribute("data-id", q.id);
        item.setAttribute("data-testid", "quote-reply-item");
        const body = doc.createElement("div");
        body.className = "qr-body";
        if (q.source.kind === "file" && q.source.label) {
          const src = doc.createElement("div");
          src.className = "qr-src";
          src.textContent = c.fromFile(q.source.label);
          body.appendChild(src);
        }
        const quoteEl = doc.createElement("div");
        quoteEl.className = "qr-quote";
        quoteEl.textContent = q.text;
        quoteEl.title = q.text.slice(0, 1200);
        const input = doc.createElement("input");
        input.className = "qr-comment";
        input.type = "text";
        input.placeholder = c.commentPlaceholder;
        input.value = q.comment;
        input.setAttribute("data-testid", "quote-reply-comment-input");
        body.append(quoteEl, input);
        const x = doc.createElement("button");
        x.type = "button";
        x.className = "qr-x";
        x.setAttribute("data-act", "remove");
        x.setAttribute("aria-label", c.remove);
        x.title = c.remove;
        x.innerHTML = ICON_X;
        item.append(body, x);
        tray.appendChild(item);
      }
    }
    // The tray's own Send shows only while Paseo's send button is absent (empty composer).
    tray.toggleAttribute("data-native-send", Boolean(composer && findNativeSendButton(composer)));
    if (focusCommentId) {
      const input = tray.querySelector<HTMLInputElement>(`.qr-item[data-id="${focusCommentId}"] .qr-comment`);
      focusCommentId = null;
      input?.focus();
    }
  };

  const scheduleTray = () => {
    if (rafTray) return;
    rafTray = win.requestAnimationFrame(renderTray);
  };

  const flushIntoComposer = () => {
    const key = getSessionKey();
    const quotes = readQuoteTray(key);
    const composer = findComposer(doc, lastComposer);
    if (!quotes.length || !composer) return;
    const composed = composeQuotedMessage(quotes, composer.value);
    setComposerText(composer, composed.text);
    writeQuoteTray(key, []);
    recordQuoteReplyReceipt({
      trigger: "flush",
      sessionKey: key,
      quoteCount: quotes.length,
      chars: composed.text.length,
      ok: true,
      outcome: "Quotes written into the message text for editing",
    });
    composer.focus();
    renderTray();
  };

  const onTrayClick = (event: Event) => {
    const btn = (event.target as Element).closest("button");
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const act = btn.getAttribute("data-act");
    const key = getSessionKey();
    if (act === "remove") {
      const id = btn.closest(".qr-item")?.getAttribute("data-id");
      const next = readQuoteTray(key).filter((q) => q.id !== id);
      writeQuoteTray(key, next);
      recordQuoteReplyReceipt({ trigger: "remove", sessionKey: key, quoteCount: next.length, chars: 0, ok: true, outcome: "Quote removed" });
      renderTray();
      findComposer(doc, lastComposer)?.focus();
    } else if (act === "clear") {
      clearQuoteTray(key);
      renderTray();
      findComposer(doc, lastComposer)?.focus();
    } else if (act === "flush") {
      flushIntoComposer();
    } else if (act === "send") {
      sendFromTray("tray-send");
    }
  };

  const onTrayInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.classList?.contains("qr-comment")) return;
    const id = input.closest(".qr-item")?.getAttribute("data-id");
    if (id) updateQuote(id, { comment: input.value });
  };

  const onTrayKeyDown = (event: KeyboardEvent) => {
    const input = event.target as HTMLElement;
    if (!input.classList?.contains("qr-comment")) return;
    const composing = event.isComposing || event.keyCode === 229;
    // Cmd/Ctrl+Enter in a comment sends the quotes and comments as they are.
    if (event.key === "Enter" && !composing && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      sendFromTray("comment-mod-enter");
      return;
    }
    // Plain Enter or Escape returns to the message; it never sends by itself.
    if ((event.key === "Enter" && !composing) || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      findComposer(doc, lastComposer)?.focus();
    }
    event.stopPropagation();
  };

  // ---- send folding -------------------------------------------------------

  let verifyTimer: ReturnType<typeof setTimeout> | null = null;

  const sendFromTray = (via: string) => {
    const composer = findComposer(doc, lastComposer);
    if (!composer || !readQuoteTray(getSessionKey()).length) return;
    lastComposer = composer;
    foldTrayIntoComposer(composer, via);
    const clickSend = (attempt: number) => {
      const btn = findNativeSendButton(composer);
      if (btn) {
        btn.click();
        return;
      }
      if (attempt < 5) setTimeout(() => clickSend(attempt + 1), 16);
    };
    setTimeout(() => clickSend(0), 0);
  };

  const foldTrayIntoComposer = (composer: HTMLTextAreaElement, via: string) => {
    const key = getSessionKey();
    const quotes = readQuoteTray(key);
    if (!quotes.length) return;
    const typed = composer.value;
    const leading = typed.length - typed.replace(/^\s+/, "").length;
    const caret = Math.max(0, (composer.selectionStart ?? typed.length) - leading);
    const composed = composeQuotedMessage(quotes, typed);
    setComposerText(composer, composed.text, composed.prefix.length + caret);
    folding = true;
    const sentAt = Date.now();
    const userCountBefore = doc.querySelectorAll(USER_MESSAGE_SELECTOR).length;
    if (verifyTimer) clearTimeout(verifyTimer);
    // Hide the tray right away so the UI reads as "sent"; storage is cleared once verified.
    doc.getElementById(TRAY_ID)?.remove();
    verifyTimer = setTimeout(() => {
      verifyTimer = null;
      folding = false;
      const value = composer.isConnected ? composer.value : "";
      const stillComposed = value.startsWith(composed.prefix) && value.length >= composed.prefix.length;
      if (stillComposed) {
        // The key / press did not send (send shortcut differs, button disabled, etc.).
        const restored = stripQuotedPrefix(value, composed.prefix);
        if (restored !== null) setComposerText(composer, restored);
        recordQuoteReplyReceipt({ trigger: "send-reverted", sessionKey: key, quoteCount: quotes.length, chars: 0, ok: true, outcome: `${via}: did not send, message text restored, tray kept` });
        options.notify?.(copy().revertedToast);
        renderTray();
        return;
      }
      writeQuoteTray(key, []);
      recordQuoteReplyReceipt({ trigger: "send", sessionKey: key, quoteCount: quotes.length, chars: composed.text.length, ok: true, outcome: `${via}: folded ${quotes.length} quote(s) into the message` });
      renderTray();
      // Second check: the newest user bubble should carry the quote text.
      const confirm = (attempt: number) => {
        const bubbles = doc.querySelectorAll(USER_MESSAGE_SELECTOR);
        const newest = bubbles[bubbles.length - 1];
        if (bubbles.length > userCountBefore && newest) {
          if (!messageContainsQuote(newest.textContent ?? "", quotes)) {
            const current = readQuoteTray(key);
            writeQuoteTray(key, [...quotes, ...current.filter((q) => !quotes.some((o) => o.id === q.id))]);
            recordQuoteReplyReceipt({ trigger: "send-restored", sessionKey: key, quoteCount: quotes.length, chars: 0, ok: false, outcome: `${via}: quote text not found in the sent bubble, tray restored` });
            options.notify?.(copy().restoredToast);
            renderTray();
          }
          return;
        }
        // Queued sends or a different pane may not add a bubble here; stop after ~6s.
        if (attempt < 12 && Date.now() - sentAt < 8000) setTimeout(() => confirm(attempt + 1), 500);
      };
      setTimeout(() => confirm(0), 400);
    }, 650);
  };

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing || event.keyCode === 229) return;
    const target = event.target as Element | null;
    if (!(target instanceof HTMLTextAreaElement) || !target.matches(COMPOSER_SELECTOR)) return;
    if (!readQuoteReplyPreferences().enabled) return;
    if (!readQuoteTray(getSessionKey()).length) return;
    if (doc.querySelector(AUTOCOMPLETE_SELECTOR)) return; // Enter picks a slash / @ suggestion
    lastComposer = target;
    foldTrayIntoComposer(target, event.metaKey || event.ctrlKey ? "mod-enter" : "enter");
  };

  const onPointerDownCapture = (event: Event) => {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== "function") return;
    const btn = target.closest("button, [role='button']");
    if (!btn || !btn.closest(COMPOSER_ROOT_SELECTOR)) return;
    if (!isQuoteReplySendLabel(btn.getAttribute("aria-label"))) return;
    if (!readQuoteReplyPreferences().enabled || !readQuoteTray(getSessionKey()).length) return;
    const composer = btn.closest(COMPOSER_ROOT_SELECTOR)?.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR);
    if (!composer) return;
    lastComposer = composer;
    foldTrayIntoComposer(composer, "send-button");
  };

  // ---- wiring -------------------------------------------------------------

  const onMouseUp = (event: MouseEvent) => {
    const t = event.target as Element | null;
    if (t && typeof t.closest === "function" && t.closest(`#${TOOLBAR_ID}`)) return;
    scheduleToolbar();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.shiftKey || event.key === "Shift" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a")) {
      scheduleToolbar();
    }
  };
  const onSelectionChange = () => {
    const sel = win.getSelection();
    if (!sel || sel.isCollapsed) hideToolbar();
  };
  const onScroll = () => {
    if (doc.getElementById(TOOLBAR_ID)) scheduleToolbar();
  };
  const onFocusIn = (event: FocusEvent) => {
    const t = event.target;
    if (t instanceof HTMLTextAreaElement && t.matches(COMPOSER_SELECTOR)) {
      if (lastComposer !== t) {
        lastComposer = t;
        scheduleTray();
      }
    }
  };
  const onKeyDownEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && doc.getElementById(TOOLBAR_ID)) hideToolbar();
  };

  win.addEventListener("keydown", onKeyDownCapture, true);
  win.addEventListener("pointerdown", onPointerDownCapture, true);
  win.addEventListener("keydown", onKeyDownEscape);
  doc.addEventListener("mouseup", onMouseUp);
  doc.addEventListener("keyup", onKeyUp);
  doc.addEventListener("selectionchange", onSelectionChange);
  doc.addEventListener("scroll", onScroll, true);
  doc.addEventListener("focusin", onFocusIn);
  win.addEventListener(QUOTE_REPLY_EVENT, scheduleTray);
  win.addEventListener("popstate", scheduleTray);

  const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(() => scheduleTray()) : null;
  observer?.observe(doc.body, { childList: true, subtree: true });
  // Route changes in the SPA do not always mutate the composer; poll the key cheaply.
  let lastKey = getSessionKey();
  const routeTimer = setInterval(() => {
    const key = getSessionKey();
    if (key !== lastKey) {
      lastKey = key;
      scheduleTray();
    }
  }, 800);

  installed = true;
  runtime = {
    doc,
    getSessionKey,
    findComposer: () => findComposer(doc, lastComposer),
    addFromSelection,
  };
  scheduleTray();

  return () => {
    installed = false;
    runtime = null;
    win.removeEventListener("keydown", onKeyDownCapture, true);
    win.removeEventListener("pointerdown", onPointerDownCapture, true);
    win.removeEventListener("keydown", onKeyDownEscape);
    doc.removeEventListener("mouseup", onMouseUp);
    doc.removeEventListener("keyup", onKeyUp);
    doc.removeEventListener("selectionchange", onSelectionChange);
    doc.removeEventListener("scroll", onScroll, true);
    doc.removeEventListener("focusin", onFocusIn);
    win.removeEventListener(QUOTE_REPLY_EVENT, scheduleTray);
    win.removeEventListener("popstate", scheduleTray);
    observer?.disconnect();
    clearInterval(routeTimer);
    if (verifyTimer) clearTimeout(verifyTimer);
    folding = false;
    if (rafToolbar) win.cancelAnimationFrame(rafToolbar);
    if (rafTray) win.cancelAnimationFrame(rafTray);
    doc.getElementById(TOOLBAR_ID)?.remove();
    doc.getElementById(TRAY_ID)?.remove();
    doc.getElementById(STYLE_ID)?.remove();
  };
}
