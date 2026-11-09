/// <reference lib="dom" />
/**
 * Smart Clipboard Copy & Markdown/Plain-Text Reconciler for Paseo.
 *
 * Root Cause Solved:
 * Paseo v0.15.x `AssistantSelectionCopySurface` (module 5342/5343) and
 * `writeMarkdownToRichClipboard` (module 5209) convert selected/copied assistant
 * messages via Turndown into raw Markdown (`**bold**`, `### heading`, `- list`)
 * and write that raw Markdown into `text/plain` alongside rich HTML in `text/html`.
 *
 * Consequently:
 * - Pasting (`Cmd+V`) into Notion / Google Docs reads `text/html` and renders bold/lists.
 * - Pasting (`Cmd+V` or even `Cmd+Shift+V`) into Beeper Desktop (which drops HTML formatting
 *   and reads `text/plain`), LinkedIn DMs, WeChat, WhatsApp, or browser `<textarea>` inputs
 *   pastes literal `**...**` asterisks and `###` hashes.
 *
 * How Smart Copy Works:
 * - `smart` mode (Default):
 *   - `text/plain` -> Clean Human-Readable Plain Text (zero `**` asterisks, zero `###` hashes,
 *     clean `• ` bullets, while preserving code blocks verbatim) for Beeper / WeChat / LinkedIn /
 *     browser inputs and `Cmd+Shift+V`.
 *   - `text/html`  -> Rich HTML (`<strong>`, `<ul><li>`, `<h1>`, `<pre><code>`) for Notion /
 *     Google Docs / Feishu / Apple Notes `Cmd+V`.
 * - `plain` mode (`Cmd+Shift+C`, `Shift+Click` Copy icon, or `/copy-clean`):
 *   - Writes Clean Plain Text ONLY (omits `text/html`), so even `Cmd+V` in Notion pastes unformatted.
 * - `markdown` mode (`Option+Cmd+C`, `Option+Click` Copy icon, or `/copy-md`):
 *   - Writes Raw Markdown (`**bold**`, `### heading`) into `text/plain` for Markdown editors.
 */

import { syncPaseoThemeCssVariables } from "./theme-web";

export type SmartCopyMode = "smart" | "markdown" | "plain";
export type SmartCopyBulletMarker = "bullet" | "dash";
export type SmartCopyLinkFormat = "label-only" | "label-with-url" | "markdown";

export interface SmartCopyPreferences {
  enabled: boolean;
  defaultMode: SmartCopyMode;
  bulletMarker: SmartCopyBulletMarker;
  linkFormat: SmartCopyLinkFormat;
}

export type SmartCopyTrigger =
  | "selection-copy"
  | "copy-button"
  | "shortcut-clean"
  | "shortcut-markdown"
  | "slash-command"
  | "command-center"
  | "self-test";

export interface SmartCopyReceipt {
  at: string;
  trigger: SmartCopyTrigger;
  modeUsed: SmartCopyMode | "code-passthrough";
  plainChars: number;
  htmlChars: number;
  strippedTokens: number;
  preview: string;
}

export interface SmartCopySelfTestResult {
  ok: boolean;
  testedAt: string;
  smartPlainOutput: string;
  smartHtmlOutput: string;
  markdownOutput: string;
  plainOnlyHasHtml: boolean;
  smartStrippedTokens: number;
  codeBlockPreserved: boolean;
  summary: string;
}

export interface SmartCopyStatus {
  installed: boolean;
  preferences: SmartCopyPreferences;
  receipts: SmartCopyReceipt[];
}

const PREFS_STORAGE_KEY = "paseo:finder-plugin:smart-copy-prefs";
const RECEIPTS_STORAGE_KEY = "paseo:finder-plugin:smart-copy-receipts";
const MAX_RECEIPTS = 15;
export const SMART_COPY_EVENT = "paseo-finder:smart-copy";

export const DEFAULT_SMART_COPY_SAMPLE = `**"Sure, Alex! Great to connect with you.**

To summarize my profile: I'm a bilingual Growth Marketing Leader and AI Systems Architect with over 6 years of full-funnel experience, managing more than $30M in multi-market paid media. My career sits at the intersection of **DTC unit-economics growth**, **large-scale enterprise media governance**, and **AI engineering**.

• **First, on the DTC growth side**: At **Bokksu**—a $30M/year US multi-brand DTC group—I led full-funnel performance marketing across 4 brands and 10+ global markets. We cut flagship retail CAC by 40%, doubled ROAS to ~4.0x, scaled Australia from scratch into our #3 profitable market, and delivered a ~700% revenue surge during BFCM while keeping tight MER controls.
• **Second, on the enterprise & brand side**: At **WPP / EssenceMediacom** in Tokyo, I managed $20M+ in annual media planning and performance governance for the **Google Android and Pixel** ecosystem in Japan.
• **Recently**: I've been building autonomous growth pipelines, AI marketing workflows, and full-stack software—including iOS/macOS apps and Chrome extensions that streamline attribution and ad ops.

What I'm looking for next is an **in-house growth marketing leadership role** where I can drive high-impact international or APAC expansion with a strong degree of location and operational autonomy. Excited to hear what opportunities you have on your radar!"`;

let currentPrefs: SmartCopyPreferences = {
  enabled: true,
  defaultMode: "smart",
  bulletMarker: "bullet",
  linkFormat: "label-only",
};

let smartCopyInstalled = false;
let pendingModifierOverride: { mode: SmartCopyMode; expiresAt: number } | null = null;

export function normalizeSmartCopyMode(value: unknown): SmartCopyMode {
  if (value === "markdown" || value === "plain" || value === "smart") {
    return value;
  }
  return "smart";
}

export function normalizeSmartCopyBulletMarker(value: unknown): SmartCopyBulletMarker {
  return value === "dash" ? "dash" : "bullet";
}

export function normalizeSmartCopyLinkFormat(value: unknown): SmartCopyLinkFormat {
  if (value === "label-with-url" || value === "markdown" || value === "label-only") {
    return value;
  }
  return "label-only";
}

export function readSmartCopyPreferences(): SmartCopyPreferences {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SmartCopyPreferences>;
        currentPrefs = {
          enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : currentPrefs.enabled,
          defaultMode: normalizeSmartCopyMode(parsed.defaultMode ?? currentPrefs.defaultMode),
          bulletMarker: normalizeSmartCopyBulletMarker(
            parsed.bulletMarker ?? currentPrefs.bulletMarker,
          ),
          linkFormat: normalizeSmartCopyLinkFormat(parsed.linkFormat ?? currentPrefs.linkFormat),
        };
      }
    } catch {
      // Ignore storage read errors
    }
  }
  return { ...currentPrefs };
}

export function syncSmartCopyPreferences(patch: Partial<SmartCopyPreferences>): SmartCopyPreferences {
  const prev = readSmartCopyPreferences();
  currentPrefs = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : prev.enabled,
    defaultMode:
      patch.defaultMode !== undefined ? normalizeSmartCopyMode(patch.defaultMode) : prev.defaultMode,
    bulletMarker:
      patch.bulletMarker !== undefined
        ? normalizeSmartCopyBulletMarker(patch.bulletMarker)
        : prev.bulletMarker,
    linkFormat:
      patch.linkFormat !== undefined
        ? normalizeSmartCopyLinkFormat(patch.linkFormat)
        : prev.linkFormat,
  };
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(currentPrefs));
    } catch {
      // Ignore storage write errors
    }
  }
  dispatchSmartCopyEvent();
  return { ...currentPrefs };
}

export function readSmartCopyReceipts(): SmartCopyReceipt[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(RECEIPTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as SmartCopyReceipt[]).slice(0, MAX_RECEIPTS) : [];
  } catch {
    return [];
  }
}

function dispatchSmartCopyEvent(detail?: unknown): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent(SMART_COPY_EVENT, { detail }));
    } catch {
      // Ignore in non-DOM test environments
    }
  }
}

export function recordSmartCopyReceipt(
  trigger: SmartCopyTrigger,
  modeUsed: SmartCopyMode | "code-passthrough",
  plainText: string,
  htmlText: string | undefined,
  strippedTokens: number,
): SmartCopyReceipt {
  const compactPreview = plainText.replace(/\s+/g, " ").trim().slice(0, 90);
  const receipt: SmartCopyReceipt = {
    at: new Date().toISOString(),
    trigger,
    modeUsed,
    plainChars: plainText.length,
    htmlChars: htmlText ? htmlText.length : 0,
    strippedTokens,
    preview: compactPreview,
  };
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const next = [receipt, ...readSmartCopyReceipts()].slice(0, MAX_RECEIPTS);
      window.localStorage.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  }
  dispatchSmartCopyEvent(receipt);
  return receipt;
}

export function getSmartCopyStatus(): SmartCopyStatus {
  return {
    installed: smartCopyInstalled,
    preferences: readSmartCopyPreferences(),
    receipts: readSmartCopyReceipts(),
  };
}

// ---------------------------------------------------------------------------
// Pure Markdown -> Clean Plain Text & Rich HTML Enhancer
// ---------------------------------------------------------------------------

function normalizeUrlComparison(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Clean a single non-code prose line of Markdown formatting syntax (`**`, `__`,
 * `###`, `[label](url)`, `- ` bullets, `> ` blockquotes) while protecting inline
 * `` `code` `` spans from having internal `*` or `_` stripped.
 */
function cleanMarkdownProseLine(
  line: string,
  prefs: Pick<SmartCopyPreferences, "bulletMarker" | "linkFormat">,
): { text: string; stripped: number } {
  let stripped = 0;
  let working = line;

  // 1. Protect inline code spans (`...`) with temporary placeholders
  const codeSpans: string[] = [];
  working = working.replace(/(`+)([^`\n]+?)\1/g, (_match, _ticks: string, inner: string) => {
    const idx = codeSpans.length;
    codeSpans.push(inner);
    stripped += 1;
    return `\u0000CODE_${idx}\u0000`;
  });

  // 2. Strip leading blockquote markers (`> `)
  working = working.replace(/^(\s*)(?:>\s?)+/, (_m, indent: string) => {
    stripped += 1;
    return indent;
  });

  // 3. Strip ATX heading hashes (`# `, `## `, `### `, etc.)
  working = working.replace(/^(\s*)#{1,6}\s+/, (_m, indent: string) => {
    stripped += 1;
    return indent;
  });

  // 4. Normalize unordered list bullets (`- `, `* `, `+ `) at line start
  const bulletChar = prefs.bulletMarker === "dash" ? "- " : "• ";
  working = working.replace(/^(\s*)[-*+]\s+/, (_m, indent: string) => {
    stripped += 1;
    return `${indent}${bulletChar}`;
  });
  if (prefs.bulletMarker === "dash") {
    working = working.replace(/^(\s*)•\s+/, "$1- ");
  }

  // 5. Convert Markdown images `![alt](url)` -> `alt`
  working = working.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string) => {
    stripped += 1;
    return alt.trim();
  });

  // 6. Convert Markdown links `[label](url)`
  if (prefs.linkFormat !== "markdown") {
    working = working.replace(
      /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (_m, label: string, url: string) => {
        stripped += 1;
        const cleanLabel = label.trim();
        const cleanUrl = url.trim();
        if (!cleanLabel) return cleanUrl;
        if (
          prefs.linkFormat === "label-only" ||
          normalizeUrlComparison(cleanLabel) === normalizeUrlComparison(cleanUrl) ||
          cleanLabel.includes(cleanUrl)
        ) {
          return cleanLabel;
        }
        return `${cleanLabel} (${cleanUrl})`;
      },
    );
  }

  // 7. Strip bold `**...**` and `__...__` (handles multi-span, CJK, and quotes like `**"Sure, Alex!**`)
  let prev = "";
  while (prev !== working) {
    prev = working;
    working = working.replace(/\*\*([^*\n]+?)\*\*/g, (_m, inner: string) => {
      stripped += 1;
      return inner;
    });
    working = working.replace(/__([^_\n]+?)__/g, (_m, inner: string) => {
      stripped += 1;
      return inner;
    });
  }

  // 8. Strip strikethrough `~~...~~`
  working = working.replace(/~~([^~\n]+?)~~/g, (_m, inner: string) => {
    stripped += 1;
    return inner;
  });

  // 9. Strip italic `*...*` and `_..._` when used as emphasis (avoiding `4 * 5` or `snake_case`)
  working = working.replace(
    /(^|[\s([{'"“‘—–•:：])\*([^*\s][^*\n]*?)\*(?=$|[\s)\]}.,!?;:'"”’—–，。！？；：])/g,
    (_m, prefix: string, inner: string) => {
      stripped += 1;
      return `${prefix}${inner}`;
    },
  );
  working = working.replace(
    /(^|[\s([{'"“‘—–•:：])_([^_\s][^_\n]*?)_(?=$|[\s)\]}.,!?;:'"”’—–，。！？；：])/g,
    (_m, prefix: string, inner: string) => {
      stripped += 1;
      return `${prefix}${inner}`;
    },
  );

  // 10. Unescape Turndown backslash-escaped punctuation (`\*`, `\_`, `\[`, `\]`, `\#`, `\-`, `\+`, `\&`)
  working = working.replace(/\\([*_[\]#\-+&~`>\\])/g, (_m, ch: string) => {
    stripped += 1;
    return ch;
  });

  // 11. Restore inline code spans (unwrapped of backticks, with inner characters untouched)
  working = working.replace(/\u0000CODE_(\d+)\u0000/g, (_m, idxStr: string) => {
    const idx = Number(idxStr);
    return codeSpans[idx] ?? "";
  });

  return { text: working, stripped };
}

/**
 * Convert raw Markdown (such as Turndown output from Paseo's selection/message copy)
 * into clean human-readable plain text free of `**` asterisks and `###` hashes,
 * while preserving fenced code blocks (` ``` `) verbatim.
 */
export function markdownToCleanPlainText(
  input: string,
  options?: Partial<Pick<SmartCopyPreferences, "bulletMarker" | "linkFormat">>,
): { plainText: string; strippedTokens: number } {
  if (!input) return { plainText: "", strippedTokens: 0 };
  const prefs = {
    bulletMarker: options?.bulletMarker ?? currentPrefs.bulletMarker,
    linkFormat: options?.linkFormat ?? currentPrefs.linkFormat,
  };

  const normalized = input.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const outLines: string[] = [];
  let strippedTokens = 0;
  let inFence = false;
  let fenceMarker = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0];
        strippedTokens += 1;
        continue;
      } else if (marker[0] === fenceMarker && marker.length >= 3) {
        inFence = false;
        fenceMarker = "";
        strippedTokens += 1;
        continue;
      }
    }

    if (inFence) {
      // Inside a fenced code block: preserve every character (`*`, `#`, `**kwargs`) verbatim
      outLines.push(line);
      continue;
    }

    // Horizontal rule line (`---`, `***`, `___`)
    if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/.test(line)) {
      strippedTokens += 1;
      outLines.push("────────────────");
      continue;
    }

    // Markdown table separator row (`| --- | --- |`)
    if (/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line)) {
      strippedTokens += 1;
      continue;
    }

    // Markdown table data row (`| cell1 | cell2 |`)
    if (/^\s*\|.*\|\s*$/.test(line) && line.includes("|")) {
      const rawCells = line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => {
          const cleanedCell = cleanMarkdownProseLine(cell.trim(), prefs);
          strippedTokens += cleanedCell.stripped;
          return cleanedCell.text;
        });
      outLines.push(rawCells.join("\t"));
      continue;
    }

    const cleaned = cleanMarkdownProseLine(line, prefs);
    strippedTokens += cleaned.stripped;
    outLines.push(cleaned.text);
  }

  return {
    plainText: outLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    strippedTokens,
  };
}

/**
 * Upgrade any residual unparsed `**...**` inside non-code HTML text segments into
 * `<strong>...</strong>` so CJK + fullwidth colon patterns (`**体量与角色：**管理`)
 * paste as true bold in Notion / Google Docs instead of showing literal `**`.
 */
export function enhanceRichClipboardHtml(html: string): string {
  if (!html || !html.includes("**")) return html;
  // Protect <pre>...</pre> and <code>...</code> blocks first
  const protectedBlocks: string[] = [];
  const masked = html.replace(
    /<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (block) => {
      const idx = protectedBlocks.length;
      protectedBlocks.push(block);
      return `\u0000HTML_CODE_${idx}\u0000`;
    },
  );
  // Replace **text** outside HTML tags
  const upgraded = masked.replace(
    /(^|>|[^*])(\*\*([^<>🌟*\n]+?)\*\*)(?=<|[^*]|$)/g,
    (_m, prefix: string, _full: string, inner: string) => `${prefix}<strong>${inner}</strong>`,
  );
  return upgraded.replace(/\u0000HTML_CODE_(\d+)\u0000/g, (_m, idxStr: string) => {
    return protectedBlocks[Number(idxStr)] ?? "";
  });
}

/**
 * Detect whether a clipboard payload or DOM selection is purely a code snippet
 * (`<pre><code>...</code></pre>` or inline `<code>`), which should never have
 * syntax characters stripped.
 */
export function isCodeOnlyClipboardPayload(html?: string, selection?: Selection | null): boolean {
  if (html) {
    const body = html.replace(/^<meta[^>]*>/i, "").trim();
    if (/^<pre\b[^>]*>\s*<code\b[^>]*>[\s\S]*<\/code>\s*<\/pre>$/i.test(body)) {
      return true;
    }
    if (
      body.length > 0 &&
      !body.includes("<p") &&
      !body.includes("<ul") &&
      !body.includes("<ol") &&
      !body.includes("<li") &&
      !body.includes("<strong") &&
      !body.includes("<em") &&
      !body.includes("<blockquote") &&
      !body.includes("<h1") &&
      !body.includes("<h2") &&
      !body.includes("<h3") &&
      !body.includes("<h4") &&
      !body.includes("**")
    ) {
      return true;
    }
  }
  if (selection && selection.rangeCount === 1 && !selection.isCollapsed) {
    try {
      const range = selection.getRangeAt(0);
      const startEl =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      const endEl =
        range.endContainer instanceof Element
          ? range.endContainer
          : range.endContainer.parentElement;
      const startCode = startEl?.closest(
        'pre, code, [data-markdown-copy-tag="pre"], [data-markdown-copy-tag="code"]',
      );
      const endCode = endEl?.closest(
        'pre, code, [data-markdown-copy-tag="pre"], [data-markdown-copy-tag="code"]',
      );
      if (startCode && startCode === endCode) {
        return true;
      }
    } catch {
      // Ignore DOM range errors in synthetic tests
    }
  }
  return false;
}

export function transformClipboardPayload(
  payload: { plainText: string; html?: string; isCodeOnly?: boolean },
  prefs?: Partial<SmartCopyPreferences>,
  modeOverride?: SmartCopyMode,
): {
  plainText: string;
  html: string | undefined;
  modeUsed: SmartCopyMode | "code-passthrough";
  strippedTokens: number;
} {
  const effectivePrefs: SmartCopyPreferences = {
    ...readSmartCopyPreferences(),
    ...prefs,
  };
  const mode = modeOverride ?? effectivePrefs.defaultMode;

  if (payload.isCodeOnly) {
    return {
      plainText: payload.plainText,
      html: payload.html,
      modeUsed: "code-passthrough",
      strippedTokens: 0,
    };
  }

  if (mode === "markdown") {
    return {
      plainText: payload.plainText,
      html: payload.html ? enhanceRichClipboardHtml(payload.html) : undefined,
      modeUsed: "markdown",
      strippedTokens: 0,
    };
  }

  const cleaned = markdownToCleanPlainText(payload.plainText, effectivePrefs);

  if (mode === "plain") {
    return {
      plainText: cleaned.plainText,
      html: undefined,
      modeUsed: "plain",
      strippedTokens: cleaned.strippedTokens,
    };
  }

  // "smart" mode (Default): Clean Plain Text in `text/plain` + Rich HTML in `text/html`
  return {
    plainText: cleaned.plainText,
    html: payload.html ? enhanceRichClipboardHtml(payload.html) : undefined,
    modeUsed: "smart",
    strippedTokens: cleaned.strippedTokens,
  };
}

// ---------------------------------------------------------------------------
// Subtle Host-Native Toast Helper (7-Theme Chameleon Compliant)
// ---------------------------------------------------------------------------

function showSmartCopyToast(doc: Document, message: string): void {
  try {
    const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
    if (win) {
      syncPaseoThemeCssVariables(doc, win);
    }
    const existing = doc.getElementById("paseo-finder-smart-copy-toast");
    if (existing) existing.remove();

    const toast = doc.createElement("div");
    toast.id = "paseo-finder-smart-copy-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    toast.style.cssText = [
      "position: fixed",
      "bottom: 20px",
      "right: 20px",
      "z-index: 99999",
      "padding: 7px 12px",
      "border-radius: 8px",
      "font-size: 12px",
      "line-height: 16px",
      "font-weight: 500",
      "background: var(--paseo-finder-surface1, #27272a)",
      "color: var(--paseo-finder-fg, #f4f4f5)",
      "border: 1px solid var(--paseo-finder-border, rgba(128,128,128,0.24))",
      "box-shadow: 0 4px 12px rgba(0, 0, 0, 0.14)",
      "pointer-events: none",
      "transition: opacity 150ms ease",
    ].join(";");
    doc.body?.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 160);
    }, 1500);
  } catch {
    // Ignore DOM toast errors
  }
}

function isZhLocale(): boolean {
  if (typeof navigator === "undefined") return false;
  return String(navigator.language || "")
    .toLowerCase()
    .startsWith("zh");
}

// ---------------------------------------------------------------------------
// Explicit Copy Action (for ⌘⇧C / ⌥⌘C / Slash Commands / Command Center)
// ---------------------------------------------------------------------------

/**
 * Extract Markdown-like text and HTML from the active selection or the latest
 * `[data-testid="assistant-message"]` in the current chat view.
 */
export function extractSelectionOrLatestAssistantMessage(
  doc: Document,
  win: Window,
): { plainText: string; html: string } | null {
  const sel = win.getSelection?.();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const container = doc.createElement("div");
    container.appendChild(range.cloneContents());
    const html = `<meta charset="utf-8">${container.innerHTML}`;
    const text = domElementToMarkdownApprox(container) || sel.toString();
    if (text.trim()) {
      return { plainText: text.trim(), html };
    }
  }

  const messages = Array.from(doc.querySelectorAll('[data-testid="assistant-message"]'));
  const latest = messages[messages.length - 1];
  if (!latest) return null;
  const clone = latest.cloneNode(true) as HTMLElement;
  for (const ignored of Array.from(clone.querySelectorAll("[data-markdown-copy-ignore]"))) {
    ignored.remove();
  }
  const html = `<meta charset="utf-8">${clone.innerHTML}`;
  const text = domElementToMarkdownApprox(clone) || (clone.textContent ?? "");
  if (!text.trim()) return null;
  return { plainText: text.trim(), html };
}

function domElementToMarkdownApprox(root: HTMLElement): string {
  function walk(node: Node): string {
    if (node.nodeType === 3) {
      return node.nodeValue ?? "";
    }
    if (node.nodeType !== 1) return "";
    const el = node as HTMLElement;
    if (el.hasAttribute("data-markdown-copy-ignore")) return "";
    const tag = (
      el.getAttribute("data-markdown-copy-tag") ?? el.tagName
    ).toLowerCase();

    if (tag === "br") return "\n";
    if (tag === "hr") return "\n\n---\n\n";
    if (tag === "pre") {
      const codeEl = el.querySelector("code");
      const lang =
        el.getAttribute("data-markdown-copy-language") ??
        codeEl?.className?.replace(/^language-/, "") ??
        "";
      const codeText = (codeEl ?? el).textContent ?? "";
      return `\n\n\`\`\`${lang}\n${codeText.replace(/\n$/, "")}\n\`\`\`\n\n`;
    }
    if (tag === "code") {
      const inner = el.textContent ?? "";
      return `\`${inner}\``;
    }

    const childrenText = Array.from(el.childNodes).map(walk).join("");
    if (tag === "strong" || tag === "b") {
      return childrenText.trim() ? `**${childrenText}**` : childrenText;
    }
    if (tag === "em" || tag === "i") {
      return childrenText.trim() ? `_${childrenText}_` : childrenText;
    }
    if (tag === "del" || tag === "s" || tag === "strike") {
      return childrenText.trim() ? `~~${childrenText}~~` : childrenText;
    }
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.charAt(1));
      return `\n\n${"#".repeat(level)} ${childrenText.trim()}\n\n`;
    }
    if (tag === "li") {
      const parentTag = (
        el.parentElement?.getAttribute("data-markdown-copy-tag") ??
        el.parentElement?.tagName ??
        "ul"
      ).toLowerCase();
      if (parentTag === "ol") {
        const siblings = Array.from(el.parentElement?.children ?? []).filter(
          (c) =>
            (c.getAttribute("data-markdown-copy-tag") ?? c.tagName).toLowerCase() === "li",
        );
        const idx = siblings.indexOf(el);
        const start = Number(
          el.parentElement?.getAttribute("data-markdown-copy-list-start") ??
            el.parentElement?.getAttribute("start") ??
            1,
        );
        return `${start + Math.max(0, idx)}. ${childrenText.trim()}\n`;
      }
      return `- ${childrenText.trim()}\n`;
    }
    if (tag === "ul" || tag === "ol") {
      return `\n\n${childrenText.trim()}\n\n`;
    }
    if (tag === "blockquote") {
      const quoted = childrenText
        .trim()
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      return `\n\n${quoted}\n\n`;
    }
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      return href ? `[${childrenText.trim()}](${href})` : childrenText;
    }
    if (tag === "p") {
      return `\n\n${childrenText.trim()}\n\n`;
    }
    return childrenText;
  }

  return walk(root).replace(/\n{3,}/g, "\n\n").trim();
}

export async function copyCurrentSelectionOrMessageWithMode(
  mode: SmartCopyMode,
  trigger: SmartCopyTrigger = "command-center",
  doc?: Document,
  win?: Window,
): Promise<{ ok: boolean; modeUsed: SmartCopyMode; plainText: string; strippedTokens: number }> {
  const targetDoc = doc ?? (typeof document !== "undefined" ? document : undefined);
  const targetWin = win ?? (typeof window !== "undefined" ? window : undefined);
  if (!targetDoc || !targetWin) {
    return { ok: false, modeUsed: mode, plainText: "", strippedTokens: 0 };
  }

  const extracted = extractSelectionOrLatestAssistantMessage(targetDoc, targetWin);
  if (!extracted) {
    return { ok: false, modeUsed: mode, plainText: "", strippedTokens: 0 };
  }

  const transformed = transformClipboardPayload(
    extracted,
    readSmartCopyPreferences(),
    mode,
  );

  let wrote = false;
  const nav = targetWin.navigator;
  if (
    mode !== "plain" &&
    transformed.html &&
    typeof nav?.clipboard?.write === "function" &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      pendingModifierOverride = { mode, expiresAt: Date.now() + 1000 };
      await nav.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([transformed.plainText], { type: "text/plain" }),
          "text/html": new Blob([transformed.html], { type: "text/html" }),
        }),
      ]);
      wrote = true;
    } catch {
      wrote = false;
    }
  }

  if (!wrote && typeof nav?.clipboard?.writeText === "function") {
    try {
      await nav.clipboard.writeText(transformed.plainText);
      wrote = true;
    } catch {
      wrote = false;
    }
  }

  recordSmartCopyReceipt(
    trigger,
    mode,
    transformed.plainText,
    transformed.html,
    transformed.strippedTokens,
  );

  const zh = isZhLocale();
  const label =
    mode === "plain"
      ? zh
        ? "已复制纯文本（无 ** 星号）"
        : "Copied clean plain text (no **)"
      : mode === "markdown"
        ? zh
          ? "已复制原始 Markdown"
          : "Copied raw Markdown"
        : zh
          ? "已智能复制（纯文本无星号 + Notion 富文本）"
          : "Copied smart format (Clean text + Rich HTML)";
  showSmartCopyToast(targetDoc, label);

  return {
    ok: wrote,
    modeUsed: mode,
    plainText: transformed.plainText,
    strippedTokens: transformed.strippedTokens,
  };
}

// ---------------------------------------------------------------------------
// Self-Test Reconciler (能试)
// ---------------------------------------------------------------------------

export function runSmartCopySelfTest(customSample?: string): SmartCopySelfTestResult {
  const sample = (customSample && customSample.trim()) || DEFAULT_SMART_COPY_SAMPLE;
  const sampleHtml = `<meta charset="utf-8"><p><strong>"Sure, Alex! Great to connect with you.</strong></p><p>My career sits at the intersection of <strong>DTC unit-economics growth</strong>, <strong>large-scale enterprise media governance</strong>, and <strong>AI engineering</strong>.</p><p>• <strong>First, on the DTC growth side</strong>: At <strong>Bokksu</strong></p><p>**体量与角色：**管理 4 个品牌</p>`;

  const smartRes = transformClipboardPayload(
    { plainText: sample, html: sampleHtml },
    readSmartCopyPreferences(),
    "smart",
  );
  const plainRes = transformClipboardPayload(
    { plainText: sample, html: sampleHtml },
    readSmartCopyPreferences(),
    "plain",
  );
  const mdRes = transformClipboardPayload(
    { plainText: sample, html: sampleHtml },
    readSmartCopyPreferences(),
    "markdown",
  );

  const codeSample = "```python\ndef fn(**kwargs):\n    # keep * and ** in code\n    return 2 * 3\n```";
  const codeClean = markdownToCleanPlainText(codeSample);
  const codeBlockPreserved =
    codeClean.plainText.includes("def fn(**kwargs):") &&
    codeClean.plainText.includes("# keep * and ** in code") &&
    !codeClean.plainText.includes("```");

  const smartHasNoDoubleAsterisks = !smartRes.plainText.includes("**");
  const smartHtmlHasStrong =
    Boolean(smartRes.html?.includes("<strong>")) &&
    Boolean(smartRes.html?.includes("<strong>体量与角色：</strong>"));
  const mdPreservesAsterisks = mdRes.plainText.includes("**");
  const plainOmitsHtml = plainRes.html === undefined && !plainRes.plainText.includes("**");

  const ok =
    smartHasNoDoubleAsterisks &&
    smartHtmlHasStrong &&
    mdPreservesAsterisks &&
    plainOmitsHtml &&
    codeBlockPreserved;

  recordSmartCopyReceipt(
    "self-test",
    "smart",
    smartRes.plainText,
    smartRes.html,
    smartRes.strippedTokens,
  );

  return {
    ok,
    testedAt: new Date().toISOString(),
    smartPlainOutput: smartRes.plainText,
    smartHtmlOutput: smartRes.html ?? "",
    markdownOutput: mdRes.plainText,
    plainOnlyHasHtml: plainRes.html !== undefined,
    smartStrippedTokens: smartRes.strippedTokens,
    codeBlockPreserved,
    summary: ok
      ? `PASS · stripped ${smartRes.strippedTokens} Markdown markers in text/plain while preserving <strong> rich HTML for Notion & keeping code blocks intact`
      : "FAIL · check Smart Copy conversion invariants",
  };
}

// ---------------------------------------------------------------------------
// DOM & Clipboard Hook Installation
// ---------------------------------------------------------------------------

export function installSmartClipboardCopy(doc?: Document, win?: Window): () => void {
  const targetDoc = doc ?? (typeof document !== "undefined" ? document : undefined);
  const targetWin = win ?? (typeof window !== "undefined" ? window : undefined);
  if (!targetDoc || !targetWin) return () => {};

  readSmartCopyPreferences();

  // 1. Track Option+Click (`markdown`) and Shift+Click (`plain`) on Paseo's message Copy buttons
  const onPointerDownCapture = (event: MouseEvent) => {
    const prefs = readSmartCopyPreferences();
    if (!prefs.enabled) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const button = target.closest('button, [role="button"]');
    if (!button) return;
    const label = (
      button.getAttribute("aria-label") ??
      button.getAttribute("title") ??
      ""
    ).toLowerCase();
    const isCopyBtn =
      label.includes("copy") ||
      label.includes("复制") ||
      Boolean(button.closest('[data-testid="assistant-message"]'));
    if (!isCopyBtn) return;

    if (event.altKey) {
      pendingModifierOverride = { mode: "markdown", expiresAt: Date.now() + 1500 };
    } else if (event.shiftKey) {
      pendingModifierOverride = { mode: "plain", expiresAt: Date.now() + 1500 };
    } else {
      pendingModifierOverride = null;
    }
  };

  // 2. Bubble-phase `copy` listener on `window` (runs immediately after React's `onCopy` on `#root`)
  const onWindowCopyBubble = (event: ClipboardEvent) => {
    const prefs = readSmartCopyPreferences();
    if (!prefs.enabled) return;
    const cd = event.clipboardData;
    if (!cd) return;

    let rawPlain = "";
    let rawHtml = "";
    try {
      rawPlain = cd.getData("text/plain") || "";
      rawHtml = cd.getData("text/html") || "";
    } catch {
      // Ignore getData errors
    }

    const sel = targetWin.getSelection?.() ?? null;
    if (!rawPlain && sel && !sel.isCollapsed) {
      const anchorEl =
        sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
      if (anchorEl?.closest('[data-testid="assistant-message"]')) {
        const extracted = extractSelectionOrLatestAssistantMessage(targetDoc, targetWin);
        if (extracted) {
          rawPlain = extracted.plainText;
          rawHtml = extracted.html;
        }
      }
    }

    if (!rawPlain) return;

    const isCodeOnly = isCodeOnlyClipboardPayload(rawHtml, sel);
    const transformed = transformClipboardPayload(
      { plainText: rawPlain, html: rawHtml || undefined, isCodeOnly },
      prefs,
    );

    if (transformed.modeUsed === "code-passthrough") {
      return;
    }

    try {
      event.preventDefault();
      if (transformed.modeUsed === "plain") {
        try {
          cd.clearData();
        } catch {
          // Ignore clearData errors
        }
        cd.setData("text/plain", transformed.plainText);
      } else {
        cd.setData("text/plain", transformed.plainText);
        if (transformed.html) {
          cd.setData("text/html", transformed.html);
        }
      }
      recordSmartCopyReceipt(
        "selection-copy",
        transformed.modeUsed,
        transformed.plainText,
        transformed.html,
        transformed.strippedTokens,
      );
    } catch {
      // Ignore setData errors
    }
  };

  // 3. Keyboard shortcuts:
  //    - Cmd+Shift+C (⌘⇧C): Copy as Clean Plain Text Only (no `**`, no `text/html`)
  //    - Option+Cmd+C (⌥⌘C): Copy as Raw Markdown (`**bold**`, `### heading`)
  const onKeyDownCapture = (event: KeyboardEvent) => {
    const prefs = readSmartCopyPreferences();
    if (!prefs.enabled) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.code !== "KeyC" && event.key?.toLowerCase() !== "c") return;
    if (!event.shiftKey && !event.altKey) return;

    // Do not hijack Cmd+Option+C / Cmd+Shift+C if user is inside an input/textarea with no chat messages
    const active = targetDoc.activeElement;
    const isInput =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable);
    const sel = targetWin.getSelection?.();
    const hasChatSelection = Boolean(sel && !sel.isCollapsed);
    if (isInput && !hasChatSelection) return;

    if (event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      void copyCurrentSelectionOrMessageWithMode("plain", "shortcut-clean", targetDoc, targetWin);
    } else if (event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      void copyCurrentSelectionOrMessageWithMode(
        "markdown",
        "shortcut-markdown",
        targetDoc,
        targetWin,
      );
    }
  };

  // 4. Wrap `navigator.clipboard.write` so clicking Paseo's message Copy button
  //    (`writeMarkdownToRichClipboard`) also writes Clean Plain Text in `text/plain` + Rich HTML in `text/html`
  const clip = targetWin.navigator?.clipboard as
    | (Clipboard & { __paseoSmartCopyWrapped?: boolean; __paseoOrigWrite?: Clipboard["write"] })
    | undefined;
  let restoreClipboardWrite: (() => void) | null = null;

  if (clip && typeof clip.write === "function" && !clip.__paseoSmartCopyWrapped) {
    const origWrite = clip.write.bind(clip);
    clip.__paseoOrigWrite = origWrite;
    clip.__paseoSmartCopyWrapped = true;

    const wrappedWrite: Clipboard["write"] = async (data: ClipboardItems) => {
      const prefs = readSmartCopyPreferences();
      if (!prefs.enabled || !Array.isArray(data) || data.length === 0) {
        return origWrite(data);
      }

      const override =
        pendingModifierOverride && pendingModifierOverride.expiresAt > Date.now()
          ? pendingModifierOverride.mode
          : undefined;
      pendingModifierOverride = null;

      try {
        const transformedItems: ClipboardItem[] = [];
        let modifiedAny = false;

        for (const item of data) {
          const types = item?.types ?? [];
          if (types.includes("text/plain") && types.includes("text/html")) {
            const plainBlob = await item.getType("text/plain");
            const htmlBlob = await item.getType("text/html");
            const rawPlain = await plainBlob.text();
            const rawHtml = await htmlBlob.text();
            const isCodeOnly = isCodeOnlyClipboardPayload(rawHtml, null);
            const transformed = transformClipboardPayload(
              { plainText: rawPlain, html: rawHtml, isCodeOnly },
              prefs,
              override,
            );

            recordSmartCopyReceipt(
              "copy-button",
              transformed.modeUsed,
              transformed.plainText,
              transformed.html,
              transformed.strippedTokens,
            );

            if (override) {
              const zh = isZhLocale();
              showSmartCopyToast(
                targetDoc,
                override === "markdown"
                  ? zh
                    ? "已复制原始 Markdown (⌥+点击)"
                    : "Copied raw Markdown (⌥+Click)"
                  : zh
                    ? "已复制纯文本 (⇧+点击)"
                    : "Copied clean plain text (⇧+Click)",
              );
            }

            if (transformed.modeUsed === "plain") {
              transformedItems.push(
                new ClipboardItem({
                  "text/plain": new Blob([transformed.plainText], { type: "text/plain" }),
                }),
              );
              modifiedAny = true;
            } else if (transformed.modeUsed === "smart") {
              transformedItems.push(
                new ClipboardItem({
                  "text/plain": new Blob([transformed.plainText], { type: "text/plain" }),
                  "text/html": new Blob([transformed.html ?? rawHtml], { type: "text/html" }),
                }),
              );
              modifiedAny = true;
            } else {
              transformedItems.push(item);
            }
          } else {
            transformedItems.push(item);
          }
        }

        return await origWrite(modifiedAny ? transformedItems : data);
      } catch {
        return origWrite(data);
      }
    };

    try {
      Object.defineProperty(clip, "write", {
        value: wrappedWrite,
        configurable: true,
        writable: true,
      });
      restoreClipboardWrite = () => {
        try {
          Object.defineProperty(clip, "write", {
            value: origWrite,
            configurable: true,
            writable: true,
          });
          delete clip.__paseoSmartCopyWrapped;
        } catch {
          // Ignore restore errors
        }
      };
    } catch {
      try {
        clip.write = wrappedWrite;
        restoreClipboardWrite = () => {
          clip.write = origWrite;
          delete clip.__paseoSmartCopyWrapped;
        };
      } catch {
        // Ignore if navigator.clipboard.write is non-configurable
      }
    }
  }

  targetDoc.addEventListener("pointerdown", onPointerDownCapture, true);
  targetWin.addEventListener("copy", onWindowCopyBubble, false);
  targetWin.addEventListener("keydown", onKeyDownCapture, true);
  smartCopyInstalled = true;
  dispatchSmartCopyEvent();

  return () => {
    targetDoc.removeEventListener("pointerdown", onPointerDownCapture, true);
    targetWin.removeEventListener("copy", onWindowCopyBubble, false);
    targetWin.removeEventListener("keydown", onKeyDownCapture, true);
    restoreClipboardWrite?.();
    smartCopyInstalled = false;
  };
}
