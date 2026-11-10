import assert from "node:assert/strict";
import test from "node:test";
import {
  appendQuote,
  composeQuotedMessage,
  formatQuoteBlock,
  isQuoteReplySendLabel,
  messageContainsQuote,
  normalizeQuoteText,
  resolveQuoteSessionKey,
  stripQuotedPrefix,
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
