import assert from "node:assert/strict";
import test from "node:test";
import {
  appendQuote,
  composeQuotedMessage,
  findChatPaneFor,
  formatQuoteBlock,
  isQuoteReplySendLabel,
  judgeFoldedComposer,
  judgeQuoteSend,
  messageContainsQuote,
  normalizeQuoteText,
  resolveQuoteSessionKey,
  stripQuotedPrefix,
  userBubbleMessageText,
  type QuoteItem,
} from "../client/quote-reply-web";

const q = (text: string, comment = "", source: QuoteItem["source"] = { kind: "assistant" }): QuoteItem => ({
  id: text.slice(0, 6),
  text,
  comment,
  source,
  createdAt: "",
});

test("Quote Reply 1: one quote with a comment becomes a blockquote, then the comment, then the message", () => {
  const out = composeQuotedMessage([q("line one\nline two", "why this?")], "Please fix");
  assert.equal(out.text, "> line one\n> line two\n\nwhy this?\n\nPlease fix");
  assert.equal(out.prefix, "> line one\n> line two\n\nwhy this?\n\n");
});

test("Quote Reply 2: multiple quotes keep their own comments; a quote without comment stays bare", () => {
  const out = composeQuotedMessage([q("first", "comment 1"), q("second")], "");
  assert.equal(out.text, "> first\n\ncomment 1\n\n> second");
});

test("Quote Reply 3: quote-only send works with an empty message", () => {
  const out = composeQuotedMessage([q("just this")], "   ");
  assert.equal(out.text, "> just this");
});

test("Quote Reply 4: file quotes carry the file name; blank lines inside a quote stay quoted", () => {
  assert.equal(
    formatQuoteBlock(q("a\n\nb", "", { kind: "file", label: "notes.md" })),
    "> [notes.md]\n> a\n>\n> b",
  );
});

test("Quote Reply 5: a key press that did not send can be reverted exactly", () => {
  const out = composeQuotedMessage([q("x", "c")], "typed text");
  assert.equal(stripQuotedPrefix(out.text, out.prefix), "typed text");
  assert.equal(stripQuotedPrefix("user edited", out.prefix), null);
});

test("Quote Reply 6: normalisation trims, collapses blank runs, strips NBSP / ZWSP, caps length", () => {
  assert.deepEqual(normalizeQuoteText("  a\u00a0b  \r\n\r\n\r\n\r\nc\u200b  "), { text: "a b\n\nc", truncated: false });
  const long = normalizeQuoteText("x".repeat(500), 200);
  assert.equal(long.truncated, true);
  assert.equal(long.text.length, 201);
  assert.ok(long.text.endsWith("…"));
});

test("Quote Reply 7: appending dedupes identical text and ignores whitespace-only selections", () => {
  let r = appendQuote([], "hello", { kind: "assistant" }, 4000);
  assert.equal(r.quotes.length, 1);
  r = appendQuote(r.quotes, " hello ", { kind: "user" }, 4000);
  assert.equal(r.duplicate, true);
  assert.equal(r.quotes.length, 1);
  const blank = appendQuote(r.quotes, "  \n ", { kind: "user" }, 4000);
  assert.equal(blank.item, null);
});

test("Quote Reply 8: session key follows agent route, then workspace route, then a draft key", () => {
  assert.equal(resolveQuoteSessionKey("/h/srv_x/ag/df500645-245f-44d6"), "ag:df500645-245f-44d6");
  assert.equal(resolveQuoteSessionKey("/h/srv_x/agent/29fdc69a-58ba-45e4"), "ag:29fdc69a-58ba-45e4");
  assert.equal(resolveQuoteSessionKey("/h/srv_x/workspace/wks_491d5585"), "ws:wks_491d5585");
  assert.equal(resolveQuoteSessionKey("/open-project"), "draft");
});

test("Quote Reply 9: sent-bubble verification matches on a whitespace-insensitive fingerprint", () => {
  const quotes = [q("Alpha   beta\ngamma delta epsilon zeta eta")];
  assert.equal(messageContainsQuote("> Alpha beta gamma delta epsilon zeta eta\n\nok", quotes), true);
  assert.equal(messageContainsQuote("only the typed message", quotes), false);
});

test("Quote Reply 10: send labels cover Paseo's shipped locales and reject other buttons", () => {
  for (const label of ["Send message", "发送消息", "消息排队", "Send and steer", "メッセージを送信"]) {
    assert.equal(isQuoteReplySendLabel(label), true, label);
  }
  for (const label of ["Add attachment", "Start dictation", "", null]) {
    assert.equal(isQuoteReplySendLabel(label), false, String(label));
  }
});

// ---------------------------------------------------------------------------
// After-send verification. Paseo keeps every session you have opened mounted (hidden), so the
// document holds many chat lists at once; the checks below must only ever read this composer's own.
// ---------------------------------------------------------------------------

test("Quote Reply 11: a multi-line quote with a short first line is still found in its sent bubble", () => {
  // The bubble shows every quoted line behind "> ", so a probe spanning the line break never matches.
  const quotes = [q("Next steps:\nsend the summary to the whole team this week")];
  const bubble = "> Next steps:\n> send the summary to the whole team this week\n\nmy comment\n\ngo";
  assert.equal(messageContainsQuote(bubble, quotes), true);
});

test("Quote Reply 12: a new bubble carrying the quotes confirms the send, wherever it sits", () => {
  const quotes = [q("Alpha line one about foxes and dogs"), q("Bravo line two about boxes")];
  const sent = "> Alpha line one about foxes and dogs\n\nc1\n\n> Bravo line two about boxes\n\ngo";
  const verdict = judgeQuoteSend({
    bubbles: [
      { text: "an older message", isNew: false },
      { text: sent, isNew: true },
      { text: "a peer agent's message that arrived right after", isNew: true },
    ],
    quotes,
    typed: "go",
    settled: true,
  });
  assert.equal(verdict, "confirmed");
});

test("Quote Reply 13: unrelated bubbles never count as proof that the quotes were dropped", () => {
  const quotes = [q("Alpha line one about foxes and dogs")];
  // The regression: the last user bubble in the document belonged to another session.
  const foreign = [{ text: "some other session's last message", isNew: true }];
  assert.equal(judgeQuoteSend({ bubbles: foreign, quotes, typed: "go", settled: true }), "pending");
  // Nothing new on screen (queued send, or the row is not mounted): still no verdict.
  assert.equal(judgeQuoteSend({ bubbles: [{ text: "go", isNew: false }], quotes, typed: "go", settled: true }), "pending");
  assert.equal(judgeQuoteSend({ bubbles: [], quotes, typed: "", settled: true }), "pending");
});

test("Quote Reply 14: dropped needs positive evidence, and only once the list has settled", () => {
  const quotes = [q("Alpha line one about foxes and dogs")];
  const onlyTyped = [{ text: "an older message", isNew: false }, { text: "  go \n", isNew: true }];
  assert.equal(judgeQuoteSend({ bubbles: onlyTyped, quotes, typed: "go", settled: false }), "pending");
  assert.equal(judgeQuoteSend({ bubbles: onlyTyped, quotes, typed: "go", settled: true }), "dropped");
  // A quote-only send has no typed text to recognise a stripped message by.
  assert.equal(judgeQuoteSend({ bubbles: [{ text: "", isNew: true }], quotes, typed: "  ", settled: true }), "pending");
});

test("Quote Reply 15: a composer that still holds the text is 'not sent' only when it is unlocked", () => {
  const prefix = "> quoted\n\n";
  assert.equal(judgeFoldedComposer({ connected: true, value: "", prefix, locked: false }), "sent");
  assert.equal(judgeFoldedComposer({ connected: false, value: "", prefix, locked: false }), "sent");
  assert.equal(judgeFoldedComposer({ connected: true, value: `${prefix}go`, prefix, locked: false }), "not-sent");
  // A new session keeps the text read-only while the agent is being created: that send is in flight.
  assert.equal(judgeFoldedComposer({ connected: true, value: `${prefix}go`, prefix, locked: true }), "in-flight");
});

test("Quote Reply 16: the message text of a bubble excludes its timestamp row", () => {
  assert.equal(userBubbleMessageText("go11:00 PM", "11:00 PM"), "go");
  assert.equal(userBubbleMessageText("go", ""), "go");
  assert.equal(userBubbleMessageText("hello 11:00 PM world", "11:00 PM"), "hello 11:00 PM world");
});

// A minimal element tree: enough for the pane lookup, which only walks parents and queries test ids.
class FakeEl {
  parentElement: FakeEl | null = null;
  children: FakeEl[] = [];
  testid: string;
  visible: boolean;
  constructor(
    testid: string,
    visible = true,
  ) {
    this.testid = testid;
    this.visible = visible;
  }
  add(...kids: FakeEl[]): this {
    for (const k of kids) {
      k.parentElement = this;
      this.children.push(k);
    }
    return this;
  }
  querySelectorAll(selector: string): FakeEl[] {
    const id = /data-testid="([^"]+)"/.exec(selector)?.[1];
    const out: FakeEl[] = [];
    const walk = (el: FakeEl) => {
      for (const k of el.children) {
        if (k.testid === id) out.push(k);
        walk(k);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  getBoundingClientRect() {
    return this.visible ? { width: 800, height: 600 } : { width: 0, height: 0 };
  }
}

function screen(visible: boolean, withChat = true) {
  const composer = new FakeEl("composer", visible);
  const chat = new FakeEl("agent-chat-scroll", visible).add(new FakeEl("user-message", visible));
  const root = new FakeEl("screen", visible).add(...(withChat ? [chat] : []), new FakeEl("input-area", visible).add(composer));
  return { root, chat, composer };
}

test("Quote Reply 17: the pane is the composer's own chat list, never another mounted session's", () => {
  const hiddenA = screen(false);
  const active = screen(true);
  const hiddenB = screen(false); // later in the document than the active one: the old code read this
  new FakeEl("app").add(hiddenA.root, active.root, hiddenB.root);
  assert.equal(findChatPaneFor(active.composer as unknown as Element), active.chat as unknown as Element);
});

test("Quote Reply 18: a composer with no chat list of its own resolves to no pane, not to a hidden one", () => {
  const hidden = screen(false);
  const draft = screen(true, false); // new-session screen: composer only
  new FakeEl("app").add(hidden.root, draft.root);
  assert.equal(findChatPaneFor(draft.composer as unknown as Element), null);
});
