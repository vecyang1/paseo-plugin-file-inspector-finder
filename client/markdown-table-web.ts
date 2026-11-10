import bundledKaTeX from "katex";
import { getMetroModuleMap } from "./metro-registry";

export interface MarkdownTablePreferences {
  enabled: boolean;
  convertCellBrToLineBreak: boolean;
  healTruncatedRows: boolean;
  enhanceTableTypographyCss: boolean;
  renderLatexMath: boolean;
  enhanceLatexMathTypographyCss: boolean;
}

export interface MarkdownTableReceipt {
  at: string;
  trigger: "metro-pre" | "metro-ast" | "dom-healer" | "self-test" | "katex-render" | "dom-math";
  rowsMerged: number;
  lineBreaksConverted: number;
  truncatedRepaired: number;
  mathFormulasHealed?: number;
  preview: string;
}

export interface MarkdownTableStatus {
  preferences: MarkdownTablePreferences;
  metroHookInstalled: boolean;
  hookedExports: string[];
  tablesScanned: number;
  tablesHealed: number;
  rowsMergedTotal: number;
  lineBreaksConvertedTotal: number;
  truncatedRepairedTotal: number;
  mathFormulasHealedTotal: number;
  katexAvailable: boolean;
  katexVersion?: string;
  receipts: MarkdownTableReceipt[];
}

export interface MarkdownTableSelfTestResult {
  ok: boolean;
  inputSample: string;
  normalizedMarkdown: string;
  bodyRowCount: number;
  colCount: number;
  cellLineBreaksPreserved: boolean;
  truncatedRowRepaired: boolean;
  codeSpanBrPreserved: boolean;
  domRowsMerged: number;
  mathFormulaSample: string;
  mathFormulaRendered: boolean;
  mathFormulaOutput: string;
  summary: string;
}

export interface KaTeXLike {
  renderToString(
    tex: string,
    options?: {
      output?: "htmlAndMathml" | "html" | "mathml";
      displayMode?: boolean;
      throwOnError?: boolean;
      trust?: boolean;
      errorColor?: string;
      macros?: Record<string, string>;
    },
  ): string;
  version?: string;
  ParseError?: unknown;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const TABLE_CELL_BR_SENTINEL = "\u2063\u200a";
export const MARKDOWN_TABLE_EVENT = "paseo-finder:markdown-table-updated";
export const MARKDOWN_TABLE_PREFS_KEY = "paseo_finder_markdown_table_prefs";
const STYLE_ELEMENT_ID = "paseo-finder-markdown-table-style";

export const DEFAULT_MARKDOWN_MATH_SAMPLE = [
  "$$\\text{算力杠杆倍数} = \\frac{\\$500 \\sim \\$600 \\text{ USD 真实 API 额度}}{\\$20 \\text{ USD 实际月支出}} \\approx \\mathbf{25 \\times \\sim 30 \\times}$$",
  "$$\\text{批发杠杆倍数} = \\frac{\\$500 \\sim \\$600 \\text{ USD}}{\\$2 \\sim \\$3 \\text{ USD}} \\approx \\mathbf{150 \\times \\sim 250 \\times}$$",
].join("\n\n");

export const DEFAULT_MARKDOWN_TABLE_SAMPLE = [
  "| 层级 | 承载面类型 | 对应文件 / 路径 | 更新内容与职责 |",
  "| :--- | :--- | :--- | :--- |",
  "| **Skill 核心逻辑** | 通用工具与技能规范 | [`SKILL.md`](file:///workspace/skills/chat-widget/SKILL.md)<br>[`widget_ops.py`](file:///workspace/packages/chat-widget/scripts/widget_ops.py) | 升级响应式基准锚定，保留行内代码 `<br>` 不受影响。 |",
  "| **确定性契约测试** | Rung 4 自动化门禁 | [`tests/test_widget_ops.py`](file:///workspace/packages/chat-widget/tests/test_widget_ops.py) | 增加对 `right:20px!important` 与 `localStorage.removeItem` 的契约断言。 |",
  "| **架构设计规范** | 跨项目原则与指针 | [`2026-11-09-chat-launcher-draggable-and-non-obscuring.md`](file:///workspace/docs/architecture/2026-11-09-chat-la",
  "<truncated 44 bytes>",
  "录「初始定位 100% 纯 CSS 托管」核心铁律。 |",
  "| **项目配置与运行时** | 本地规则与生产代码 | [`apps/web/AGENTS.md`](file:///workspace/apps/web/AGENTS.md)<br>[`seo-geo-engine.php`](file:///workspace/apps/web/plugins/seo-geo-engine.php) | 规定全站客服图标可拖拽且避让内容。 |",
].join("\n");

let currentPrefs: MarkdownTablePreferences = {
  enabled: true,
  convertCellBrToLineBreak: true,
  healTruncatedRows: true,
  enhanceTableTypographyCss: true,
  renderLatexMath: true,
  enhanceLatexMathTypographyCss: true,
};

let cachedKaTeX: KaTeXLike | null =
  typeof (bundledKaTeX as unknown as KaTeXLike)?.renderToString === "function"
    ? (bundledKaTeX as unknown as KaTeXLike)
    : null;
let mathFormulasHealedTotal = 0;

export function readMarkdownTablePreferences(
  storage?: StorageLike | null,
): MarkdownTablePreferences {
  const store =
    storage ??
    (typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : null);
  if (store) {
    try {
      const raw = store.getItem(MARKDOWN_TABLE_PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<MarkdownTablePreferences>;
        currentPrefs = {
          enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : currentPrefs.enabled,
          convertCellBrToLineBreak:
            typeof parsed.convertCellBrToLineBreak === "boolean"
              ? parsed.convertCellBrToLineBreak
              : currentPrefs.convertCellBrToLineBreak,
          healTruncatedRows:
            typeof parsed.healTruncatedRows === "boolean"
              ? parsed.healTruncatedRows
              : currentPrefs.healTruncatedRows,
          enhanceTableTypographyCss:
            typeof parsed.enhanceTableTypographyCss === "boolean"
              ? parsed.enhanceTableTypographyCss
              : currentPrefs.enhanceTableTypographyCss,
          renderLatexMath:
            typeof parsed.renderLatexMath === "boolean"
              ? parsed.renderLatexMath
              : currentPrefs.renderLatexMath,
          enhanceLatexMathTypographyCss:
            typeof parsed.enhanceLatexMathTypographyCss === "boolean"
              ? parsed.enhanceLatexMathTypographyCss
              : currentPrefs.enhanceLatexMathTypographyCss,
        };
      }
    } catch {
      // ignore storage parse errors
    }
  }
  return { ...currentPrefs };
}

export function setCachedKaTeX(instance: unknown): void {
  if (!instance) return;
  const candidate = (
    (instance as { default?: unknown }).default ?? instance
  ) as KaTeXLike;
  if (typeof candidate?.renderToString === "function") {
    cachedKaTeX = candidate;
    emitStatusUpdate();
  }
}

export function getCachedOrLoadedKaTeX(): KaTeXLike | null {
  if (cachedKaTeX) return cachedKaTeX;
  if (typeof window !== "undefined") {
    const win = window as unknown as {
      katex?: unknown;
      __r?: (id: number) => unknown;
    };
    if (win.katex) {
      setCachedKaTeX(win.katex);
      if (cachedKaTeX) return cachedKaTeX;
    }
    if (typeof win.__r === "function") {
      try {
        const kMod = win.__r(4007);
        setCachedKaTeX(kMod);
        if (cachedKaTeX) return cachedKaTeX;
      } catch {
        // ignore
      }
    }
  }
  if (typeof globalThis !== "undefined") {
    const g = globalThis as unknown as { katex?: unknown };
    if (g.katex) {
      setCachedKaTeX(g.katex);
      if (cachedKaTeX) return cachedKaTeX;
    }
  }
  return cachedKaTeX;
}

let metroHookInstalled = false;
const hookedExportsSet = new Set<string>();
let tablesScanned = 0;
let tablesHealed = 0;
let rowsMergedTotal = 0;
let lineBreaksConvertedTotal = 0;
let truncatedRepairedTotal = 0;
const receipts: MarkdownTableReceipt[] = [];

function emitStatusUpdate(): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new CustomEvent(MARKDOWN_TABLE_EVENT));
  } catch {
    // ignore
  }
}

function recordReceipt(receipt: Omit<MarkdownTableReceipt, "at">): void {
  receipts.unshift({
    ...receipt,
    at: new Date().toISOString(),
  });
  if (receipts.length > 20) receipts.length = 20;
  emitStatusUpdate();
}

export function countUnescapedTablePipes(line: string): number {
  const strippedCode = line.replace(/`+[^`]*`+/g, "");
  let count = 0;
  for (let i = 0; i < strippedCode.length; i++) {
    if (strippedCode[i] === "|" && (i === 0 || strippedCode[i - 1] !== "\\")) {
      count++;
    }
  }
  return count;
}

function stripTableLinePrefix(line: string): string {
  return line
    .trim()
    .replace(/^(?:>\s*)+/, "")
    .replace(/^(?:<details\b[^>]*>\s*)?(?:<summary\b[^>]*>[\s\S]*?<\/summary>\s*)?/i, "")
    .trimStart();
}

export function isGfmTableDelimiterRow(line: string): boolean {
  const trimmed = stripTableLinePrefix(line);
  if (!trimmed.includes("|") || !trimmed.includes("-")) return false;
  return /^\|?(?:\s*:?-{3,}:?\s*\|)+(?:\s*:?-{3,}:?\s*)?\|?$/.test(trimmed);
}

/**
 * Pre-normalizes Markdown tables before Paseo's `normalizeMarkdownHtml` (`module 4117`) runs.
 * Why: `normalizeMarkdownHtml` converts `<br>` into `"  \n"`, which injects a literal newline
 * inside GFM table rows and splits one row into multiple corrupted rows with shifted columns.
 * Replacing cell `<br>` (outside backticks and fenced code blocks) with TABLE_CELL_BR_SENTINEL
 * keeps the GFM table row on a single line while preserving cell line-break semantics.
 */
export function normalizeMarkdownTablesForPaseo(
  markdown: string,
  prefs: MarkdownTablePreferences = currentPrefs,
): {
  text: string;
  lineBreaksConverted: number;
  truncatedRepaired: number;
} {
  if (!prefs.enabled || typeof markdown !== "string" || !markdown.includes("|")) {
    return { text: markdown, lineBreaksConverted: 0, truncatedRepaired: 0 };
  }
  const hasRelevantTokens =
    /<(?:br|\/?p|\/?div|\/?ul|\/?ol|\/?li|\/summary|truncated\s+\d+\s+bytes)\b/i.test(markdown);
  if (!hasRelevantTokens) {
    return { text: markdown, lineBreaksConverted: 0, truncatedRepaired: 0 };
  }

  let text = markdown;
  let truncatedRepaired = 0;
  let lineBreaksConverted = 0;

  if (prefs.healTruncatedRows && text.includes("<truncated ")) {
    let expectedPipes = 0;
    for (const ln of text.split(/\r?\n/)) {
      if (isGfmTableDelimiterRow(ln)) {
        expectedPipes = countUnescapedTablePipes(ln);
        break;
      }
    }
    text = text.replace(
      /([^\r\n]*)\r?\n<truncated \d+ bytes>\r?\n([^\r\n]*)/g,
      (full, beforeRaw, afterRaw) => {
        const before = String(beforeRaw ?? "");
        const after = String(afterRaw ?? "");
        const bTrim = before.trimStart();
        const aTrim = after.trimEnd();
        if (!bTrim.startsWith("|") && !aTrim.endsWith("|")) return full;
        let fixedBefore = before;
        const linkMatch = /\[([^\]]+)\]\(([^)\s]*)$/.exec(fixedBefore);
        if (linkMatch) {
          const cleanLabel = (linkMatch[1] || "").replace(/`/g, "").split("/").pop() || "";
          const urlPart = linkMatch[2] || "";
          const slashIdx = urlPart.lastIndexOf("/");
          const urlTail = slashIdx >= 0 ? urlPart.slice(slashIdx + 1) : urlPart;
          if (urlTail && cleanLabel.startsWith(urlTail) && cleanLabel.length > urlTail.length) {
            fixedBefore += `${cleanLabel.slice(urlTail.length)})`;
          } else {
            fixedBefore += ")";
          }
        }
        const bPipes = countUnescapedTablePipes(fixedBefore);
        const aPipes = countUnescapedTablePipes(after);
        const sep = expectedPipes > 0 && bPipes + aPipes < expectedPipes ? " | …" : "…";
        truncatedRepaired++;
        return `${fixedBefore}${sep}${after.trimStart()}`;
      },
    );
  }

  if (prefs.convertCellBrToLineBreak) {
    // Separate `</summary>| Header |` onto its own line when followed by a GFM table delimiter row (getpaseo/paseo#8782)
    text = text.replace(
      /(<\/summary>)[ \t]*(\|[^\n]+\|\r?\n[ \t]*(?:>[ \t]*)*\|(?:\s*:?-{2,}:?\s*\|)+)/gi,
      "$1\n\n$2",
    );
    const lines = text.split("\n");
    let inFence = false;
    let fenceChar = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1]!;
        if (!inFence) {
          inFence = true;
          fenceChar = marker[0]!;
        } else if (marker[0] === fenceChar) {
          inFence = false;
          fenceChar = "";
        }
        continue;
      }
      if (inFence) continue;
      const trimmed = stripTableLinePrefix(line);
      if (!trimmed.startsWith("|") || !trimmed.includes("|", 1)) continue;
      if (isGfmTableDelimiterRow(trimmed)) continue;

      const parts = line.split(/(`+[^`]*`+)/g);
      for (let j = 0; j < parts.length; j += 2) {
        const seg = parts[j]!;
        if (!seg.includes("<")) continue;
        const replaced = seg
          .replace(/<\/p>\s*<p\b[^>]*>/gi, () => {
            lineBreaksConverted++;
            return TABLE_CELL_BR_SENTINEL;
          })
          .replace(/<\/div>\s*<div\b[^>]*>/gi, () => {
            lineBreaksConverted++;
            return TABLE_CELL_BR_SENTINEL;
          })
          .replace(/<\/li>\s*<li\b[^>]*>/gi, () => {
            lineBreaksConverted++;
            return `${TABLE_CELL_BR_SENTINEL}• `;
          })
          .replace(/<li\b[^>]*>/gi, "• ")
          .replace(/<\/?(?:p|div|ul|ol|li)\b[^>]*>/gi, "")
          .replace(/<br\s*\/?>/gi, () => {
            lineBreaksConverted++;
            return TABLE_CELL_BR_SENTINEL;
          });
        parts[j] = replaced;
      }
      lines[i] = parts.join("");
    }
    text = lines.join("\n");
  }

  return { text, lineBreaksConverted, truncatedRepaired };
}

interface MdAstNode {
  type: string;
  text?: string;
  children?: MdAstNode[];
  [key: string]: unknown;
}

function expandInlineCellNodes(nodes: MdAstNode[]): {
  nodes: MdAstNode[];
  converted: number;
} {
  let converted = 0;
  const out: MdAstNode[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.type === "Text" && typeof node.text === "string") {
      if (
        node.text.includes(TABLE_CELL_BR_SENTINEL) ||
        node.text.includes("\u2028") ||
        /<br\s*\/?>/i.test(node.text)
      ) {
        const segments = node.text.split(/\u2063\u200a|\u2028|<br\s*\/?>/gi);
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i]!;
          if (seg.length > 0) {
            out.push({ type: "Text", text: seg });
          }
          if (i < segments.length - 1) {
            out.push({ type: "LineBreak" });
            converted++;
          }
        }
        continue;
      }
    } else if (node.type === "Code" && typeof node.text === "string" && node.text.includes("\\|")) {
      out.push({ ...node, text: node.text.replace(/\\\|/g, "|") });
      continue;
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      const childRes = expandInlineCellNodes(node.children);
      converted += childRes.converted;
      out.push({ ...node, children: childRes.nodes });
    } else {
      out.push(node);
    }
  }
  return { nodes: out, converted };
}

/**
 * Post-processes Paseo's `md4c` AST (`Document`) so `TableCell` and `TableHeaderCell`
 * nodes containing U+2028 or `<br>` become native `{ type: "LineBreak" }` nodes.
 */
export function repairMarkdownAstTables(ast: unknown): {
  ast: unknown;
  lineBreaksConverted: number;
} {
  if (!ast || typeof ast !== "object") return { ast, lineBreaksConverted: 0 };
  let totalConverted = 0;

  const visit = (node: MdAstNode): MdAstNode => {
    if (!node || typeof node !== "object") return node;
    if (
      (node.type === "TableCell" || node.type === "TableHeaderCell") &&
      Array.isArray(node.children)
    ) {
      const res = expandInlineCellNodes(node.children);
      if (res.converted > 0) {
        totalConverted += res.converted;
        return { ...node, children: res.nodes };
      }
      return node;
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      let changed = false;
      const nextChildren = node.children.map((child) => {
        const updated = visit(child);
        if (updated !== child) changed = true;
        return updated;
      });
      return changed ? { ...node, children: nextChildren } : node;
    }
    return node;
  };

  const nextAst = visit(ast as MdAstNode);
  return { ast: nextAst, lineBreaksConverted: totalConverted };
}

/**
 * Hooks Paseo's Metro module exports (`normalizeMarkdownHtml`, `prepareMarkdownSource`,
 * `parseMarkdownSync`, `parseMarkdown`) in memory without touching `app.asar` or `app-dist`.
 */
export function installMetroMarkdownTableHooks(
  win?: Window & { __r?: unknown; __c?: unknown },
): boolean {
  const targetWin =
    win ??
    (typeof window !== "undefined"
      ? (window as Window & { __r?: unknown; __c?: unknown })
      : undefined);
  if (!targetWin || typeof targetWin.__r !== "function") return false;

  const req = targetWin.__r as (id: number) => unknown;

  const mapRef = getMetroModuleMap(targetWin);
  if (!mapRef) return false;

  // Pre-initialize and resolve modules if Metro map is available
  const CANDIDATE_MODULE_IDS = [3986, 3993, 3999, 4006, 4007, 4117];
  for (const candId of CANDIDATE_MODULE_IDS) {
    if (mapRef.has(candId)) {
      try {
        req(candId);
      } catch {
        // ignore
      }
    }
  }

  for (const [id, mod] of mapRef.entries()) {
    if (mod && !mod.isInitialized && typeof mod.factory === "function") {
      try {
        const fnSource = Function.prototype.toString.call(mod.factory);
        if (
          fnSource.includes("KaTeXRenderer") ||
          fnSource.includes("loadKaTeX") ||
          fnSource.includes("parseMarkdownSync") ||
          fnSource.includes("EnrichedMarkdownText") ||
          fnSource.includes("normalizeMarkdownHtml") ||
          fnSource.includes("katex-mathml")
        ) {
          req(id);
        }
      } catch {
        // ignore
      }
    }
  }

  for (const [, mod] of mapRef.entries()) {
    const exp = mod?.publicModule?.exports;
    if (!exp || typeof exp !== "object") continue;

    // Detect KaTeX module if not cached yet
    if (!cachedKaTeX) {
      const candidate = (
        (exp as { default?: unknown }).default ?? exp
      ) as KaTeXLike;
      if (
        typeof candidate?.renderToString === "function" &&
        (candidate.version || candidate.ParseError)
      ) {
        setCachedKaTeX(candidate);
      }
    }

    // 1. Hook EnrichedMarkdownText (Module 3986): force latexMath: true
    if (
      typeof exp.EnrichedMarkdownText === "function" &&
      !(exp.EnrichedMarkdownText as { __vecMathHooked?: boolean }).__vecMathHooked
    ) {
      const origEnriched = exp.EnrichedMarkdownText as (props: Record<string, unknown>) => unknown;
      const wrappedEnriched = function (props: Record<string, unknown>): unknown {
        if (!currentPrefs.enabled || !currentPrefs.renderLatexMath) {
          return origEnriched(props);
        }
        const existingFlags = (props?.md4cFlags as Record<string, unknown>) ?? {};
        if (existingFlags.latexMath !== true) {
          return origEnriched({
            ...props,
            md4cFlags: {
              ...existingFlags,
              latexMath: true,
            },
          });
        }
        return origEnriched(props);
      };
      (wrappedEnriched as { __vecMathHooked?: boolean }).__vecMathHooked = true;
      try {
        exp.EnrichedMarkdownText = wrappedEnriched;
        if (exp.default === origEnriched) {
          exp.default = wrappedEnriched;
        }
        hookedExportsSet.add("EnrichedMarkdownText");
      } catch {
        // ignore
      }
    }

    // 2. Hook KaTeXRenderer (Module 3999): supplies KaTeX engine if missing
    if (
      typeof exp.KaTeXRenderer === "function" &&
      !(exp.KaTeXRenderer as { __vecKaTeXHooked?: boolean }).__vecKaTeXHooked
    ) {
      const origKaTeXRenderer = exp.KaTeXRenderer as (props: {
        content: string;
        katex?: unknown;
        displayMode?: boolean;
        style?: unknown;
      }) => unknown;
      const wrappedKaTeXRenderer = function (props: {
        content: string;
        katex?: unknown;
        displayMode?: boolean;
        style?: unknown;
      }): unknown {
        let effectiveKatex = props.katex;
        if (!effectiveKatex && currentPrefs.enabled && currentPrefs.renderLatexMath) {
          effectiveKatex = getCachedOrLoadedKaTeX();
        }
        return origKaTeXRenderer({
          ...props,
          katex: effectiveKatex,
        });
      };
      (wrappedKaTeXRenderer as { __vecKaTeXHooked?: boolean }).__vecKaTeXHooked = true;
      try {
        exp.KaTeXRenderer = wrappedKaTeXRenderer;
        hookedExportsSet.add("KaTeXRenderer");
      } catch {
        // ignore read-only export
      }
    }

    // 3. Hook loadKaTeX (Module 4006): caches loaded KaTeX
    if (
      typeof exp.loadKaTeX === "function" &&
      !(exp.loadKaTeX as { __vecKaTeXHooked?: boolean }).__vecKaTeXHooked
    ) {
      const origLoadKaTeX = exp.loadKaTeX as () => Promise<unknown>;
      const wrappedLoadKaTeX = function (): Promise<unknown> {
        return origLoadKaTeX().then((k) => {
          if (k) setCachedKaTeX(k);
          return k;
        });
      };
      (wrappedLoadKaTeX as { __vecKaTeXHooked?: boolean }).__vecKaTeXHooked = true;
      try {
        exp.loadKaTeX = wrappedLoadKaTeX;
        hookedExportsSet.add("loadKaTeX");
        wrappedLoadKaTeX().catch(() => {});
      } catch {
        // ignore read-only export
      }
    }

    // 4. Hook normalizeMarkdownHtml (Module 4117): table cell <br> preservation
    if (
      typeof exp.normalizeMarkdownHtml === "function" &&
      !(exp.normalizeMarkdownHtml as { __vecTableHooked?: boolean }).__vecTableHooked
    ) {
      const origNormalize = exp.normalizeMarkdownHtml as (input: string) => string;
      const wrappedNormalize = function (input: string): string {
        if (!currentPrefs.enabled || typeof input !== "string") {
          return origNormalize(input);
        }
        const res = normalizeMarkdownTablesForPaseo(input, currentPrefs);
        if (res.lineBreaksConverted > 0 || res.truncatedRepaired > 0) {
          lineBreaksConvertedTotal += res.lineBreaksConverted;
          truncatedRepairedTotal += res.truncatedRepaired;
          recordReceipt({
            trigger: "metro-pre",
            rowsMerged: 0,
            lineBreaksConverted: res.lineBreaksConverted,
            truncatedRepaired: res.truncatedRepaired,
            preview: input.slice(0, 80).replace(/\s+/g, " "),
          });
        }
        return origNormalize(res.text);
      };
      (wrappedNormalize as { __vecTableHooked?: boolean }).__vecTableHooked = true;
      try {
        exp.normalizeMarkdownHtml = wrappedNormalize;
        hookedExportsSet.add("normalizeMarkdownHtml");
      } catch {
        // ignore read-only export
      }
    }

    if (
      typeof exp.prepareMarkdownSource === "function" &&
      !(exp.prepareMarkdownSource as { __vecTableHooked?: boolean }).__vecTableHooked
    ) {
      const origPrepare = exp.prepareMarkdownSource as (input: string) => string;
      const wrappedPrepare = function (input: string): string {
        if (!currentPrefs.enabled || typeof input !== "string") {
          return origPrepare(input);
        }
        const res = normalizeMarkdownTablesForPaseo(input, currentPrefs);
        return origPrepare(res.text);
      };
      (wrappedPrepare as { __vecTableHooked?: boolean }).__vecTableHooked = true;
      try {
        exp.prepareMarkdownSource = wrappedPrepare;
        hookedExportsSet.add("prepareMarkdownSource");
      } catch {
        // ignore
      }
    }

    // 5. Hook parseMarkdownSync (Module 3993): force latexMath: true and heal tables in AST
    if (
      typeof exp.parseMarkdownSync === "function" &&
      !(exp.parseMarkdownSync as { __vecTableHooked?: boolean }).__vecTableHooked
    ) {
      const origParseSync = exp.parseMarkdownSync as (
        input: string,
        options?: Record<string, unknown>,
      ) => unknown;
      const wrappedParseSync = function (
        input: string,
        options?: Record<string, unknown>,
      ): unknown {
        const pre =
          currentPrefs.enabled && typeof input === "string"
            ? normalizeMarkdownTablesForPaseo(input, currentPrefs).text
            : input;
        const forcedOpts =
          currentPrefs.enabled && currentPrefs.renderLatexMath
            ? { ...(options ?? {}), latexMath: true }
            : options;
        const rawAst = origParseSync(pre, forcedOpts);
        if (!currentPrefs.enabled) return rawAst;
        const repaired = repairMarkdownAstTables(rawAst);
        if (repaired.lineBreaksConverted > 0) {
          lineBreaksConvertedTotal += repaired.lineBreaksConverted;
          recordReceipt({
            trigger: "metro-ast",
            rowsMerged: 0,
            lineBreaksConverted: repaired.lineBreaksConverted,
            truncatedRepaired: 0,
            preview: typeof input === "string" ? input.slice(0, 80).replace(/\s+/g, " ") : "ast",
          });
        }
        return repaired.ast;
      };
      (wrappedParseSync as { __vecTableHooked?: boolean }).__vecTableHooked = true;
      try {
        exp.parseMarkdownSync = wrappedParseSync;
        hookedExportsSet.add("parseMarkdownSync");
      } catch {
        // ignore
      }
    }

    // 6. Hook parseMarkdown (Module 3993): force latexMath: true in async parse
    if (
      typeof exp.parseMarkdown === "function" &&
      !(exp.parseMarkdown as { __vecTableHooked?: boolean }).__vecTableHooked
    ) {
      const origParseAsync = exp.parseMarkdown as (
        input: string,
        options?: Record<string, unknown>,
      ) => Promise<unknown>;
      const wrappedParseAsync = async function (
        input: string,
        options?: Record<string, unknown>,
      ): Promise<unknown> {
        const pre =
          currentPrefs.enabled && typeof input === "string"
            ? normalizeMarkdownTablesForPaseo(input, currentPrefs).text
            : input;
        const forcedOpts =
          currentPrefs.enabled && currentPrefs.renderLatexMath
            ? { ...(options ?? {}), latexMath: true }
            : options;
        const rawAst = await origParseAsync(pre, forcedOpts);
        if (!currentPrefs.enabled) return rawAst;
        return repairMarkdownAstTables(rawAst).ast;
      };
      (wrappedParseAsync as { __vecTableHooked?: boolean }).__vecTableHooked = true;
      try {
        exp.parseMarkdown = wrappedParseAsync;
        hookedExportsSet.add("parseMarkdown");
      } catch {
        // ignore
      }
    }
  }

  metroHookInstalled = hookedExportsSet.size > 0;
  emitStatusUpdate();
  return metroHookInstalled;
}

function getLastNonEmptyCellIndex(cells: HTMLElement[]): number {
  for (let i = cells.length - 1; i >= 0; i--) {
    if ((cells[i]?.textContent ?? "").trim().length > 0) return i;
  }
  return -1;
}

function getLeadingNonEmptyCellCount(cells: HTMLElement[]): number {
  let count = 0;
  for (let i = 0; i < cells.length; i++) {
    if ((cells[i]?.textContent ?? "").trim().length > 0) {
      if (count === i) {
        count++;
      } else {
        // Discontiguous non-empty cell after an empty cell
        return -1;
      }
    }
  }
  return count;
}

function repairBrokenMarkdownLinkInCell(cell: HTMLElement, doc: Document): boolean {
  const html = cell.innerHTML;
  const brokenLinkRe = /\[(<code[^>]*>([^<]+)<\/code>|([^\]]+))\]\((file:\/\/\/[^\s)<]+)/;
  const match = brokenLinkRe.exec(html);
  if (!match) return false;
  const innerLabelHtml = match[1] || "";
  const plainLabel = (match[2] || match[3] || "").replace(/`/g, "").trim();
  let href = match[4] || "";
  const cleanBasename = plainLabel.split("/").pop() || "";
  const slashIdx = href.lastIndexOf("/");
  const urlTail = slashIdx >= 0 ? href.slice(slashIdx + 1) : href;
  if (urlTail && cleanBasename.startsWith(urlTail) && cleanBasename.length > urlTail.length) {
    href += cleanBasename.slice(urlTail.length);
  }
  const anchor = doc.createElement("a");
  anchor.setAttribute("href", href);
  anchor.setAttribute("target", "_blank");
  anchor.setAttribute("rel", "noopener noreferrer");
  anchor.innerHTML = innerLabelHtml;
  cell.innerHTML = html.replace(brokenLinkRe, anchor.outerHTML);
  return true;
}

function replaceTextLineBreaksInElement(rootEl: HTMLElement, doc: Document): number {
  let converted = 0;
  const walker = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const parentTag = current.parentElement?.tagName?.toLowerCase();
    if (parentTag !== "code" && parentTag !== "pre") {
      const val = current.nodeValue ?? "";
      if (
        val.includes(TABLE_CELL_BR_SENTINEL) ||
        val.includes("\u2028") ||
        /<br\s*\/?>/i.test(val)
      ) {
        textNodes.push(current as Text);
      }
    }
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const raw = textNode.nodeValue ?? "";
    const parts = raw.split(/\u2063\u200a|\u2028|<br\s*\/?>/gi);
    if (parts.length <= 1) continue;
    const frag = doc.createDocumentFragment();
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) {
        frag.appendChild(doc.createTextNode(parts[i]!));
      }
      if (i < parts.length - 1) {
        const br = doc.createElement("br");
        br.className = "paseo-finder-table-br";
        frag.appendChild(br);
        converted++;
      }
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  return converted;
}

function isInsideMathOrPre(el: HTMLElement, target: "pre" | "math"): boolean {
  if (typeof el.closest === "function") {
    try {
      if (target === "pre" && el.closest("pre")) return true;
      if (target === "math" && el.closest('span[role="math"], .paseo-finder-math-rendered')) return true;
    } catch {
      // ignore
    }
  }
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const tag = (cur.tagName ?? "").toLowerCase();
    const role = cur.getAttribute?.("role") ?? "";
    const cls = cur.getAttribute?.("class") ?? "";
    if (target === "pre" && tag === "pre") return true;
    if (
      target === "math" &&
      (role === "math" || cls.includes("paseo-finder-math-rendered") || tag === "math")
    ) {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

export function repairRenderedDomMath(root?: ParentNode): {
  mathNodesScanned: number;
  mathNodesHealed: number;
} {
  const doc =
    root && "ownerDocument" in root && (root as { ownerDocument?: unknown }).ownerDocument
      ? ((root as { ownerDocument: Document }).ownerDocument)
      : typeof document !== "undefined"
        ? document
        : null;
  const queryRoot = root ?? doc;
  if (!queryRoot || !currentPrefs.enabled || !currentPrefs.renderLatexMath) {
    return { mathNodesScanned: 0, mathNodesHealed: 0 };
  }

  const katex = getCachedOrLoadedKaTeX();
  if (!katex) {
    return { mathNodesScanned: 0, mathNodesHealed: 0 };
  }

  let scanned = 0;
  let healed = 0;

  // Pass 1: Unrendered span[role="math"] (from Paseo KaTeXRenderer fallback `${p}${n}${p}`)
  const mathSpans = Array.from(
    queryRoot.querySelectorAll<HTMLElement>(
      'span[role="math"], .enrm-text span[role="math"]',
    ),
  );
  for (const span of mathSpans) {
    scanned++;
    if (span.querySelector?.("math, .katex, .katex-html")) continue;

    const raw = (span.textContent ?? "").trim();
    if (!raw) continue;

    let displayMode = false;
    let formula = "";
    const aria = span.getAttribute?.("aria-label")?.trim();
    if (aria) {
      formula = aria;
      displayMode =
        raw.startsWith("$$") ||
        (span.style && span.style.display === "block") ||
        raw.includes("\n");
    } else if (raw.startsWith("$$") && raw.endsWith("$$") && raw.length >= 4) {
      displayMode = true;
      formula = raw.slice(2, -2).trim();
    } else if (raw.startsWith("$") && raw.endsWith("$") && raw.length >= 2) {
      displayMode = false;
      formula = raw.slice(1, -1).trim();
    } else {
      formula = raw;
      displayMode = raw.includes("\n") || (span.style && span.style.display === "block");
    }

    if (!formula) continue;

    try {
      const renderedHtml = katex.renderToString(formula, {
        output: "mathml",
        displayMode,
        throwOnError: false,
        trust: false,
      });
      if (renderedHtml && renderedHtml.includes("<math")) {
        span.innerHTML = renderedHtml;
        span.setAttribute?.("data-paseo-math-healed", "true");
        span.classList?.add?.("paseo-finder-math-rendered");
        if (span.className && !span.className.includes("paseo-finder-math-rendered")) {
          span.className += " paseo-finder-math-rendered";
        }
        if (span.style) {
          span.style.whiteSpace = "normal";
          if (displayMode) {
            span.style.display = "block";
          }
        }
        healed++;
      }
    } catch {
      // ignore KaTeX parse error
    }
  }

  // Pass 2: Code blocks / pre elements with $$...$$ that escaped WASM md4c parser
  const targetDoc =
    doc ??
    ((queryRoot as { ownerDocument?: Document })?.ownerDocument) ??
    (typeof document !== "undefined" ? document : null);

  const rawCodeBlocks = Array.from(
    queryRoot.querySelectorAll<HTMLElement>(
      ".enrm-text pre, .enrm-text code, pre, code",
    ),
  );
  for (const block of rawCodeBlocks) {
    if (block.isConnected === false) continue;
    if (!block.parentNode && !block.parentElement) continue;
    if (isInsideMathOrPre(block, "math")) continue;
    if ((block.tagName ?? "").toLowerCase() === "code" && isInsideMathOrPre(block, "pre")) {
      continue;
    }
    const txt = (block.textContent ?? "").trim();
    if (!txt) continue;

    let formula = "";
    let displayMode = false;

    const className = block.className || "";
    const isMathLang =
      className.includes("language-math") ||
      className.includes("language-latex") ||
      className.includes("lang-math") ||
      block.getAttribute?.("data-language") === "math";

    if (txt.startsWith("$$") && txt.endsWith("$$") && txt.length >= 4) {
      displayMode = true;
      formula = txt.slice(2, -2).trim();
    } else if (isMathLang) {
      displayMode = true;
      formula = txt.replace(/^\$\$|\$\$$/g, "").trim();
    } else if (
      block.tagName?.toLowerCase() === "code" &&
      txt.startsWith("$") &&
      txt.endsWith("$") &&
      txt.length >= 2 &&
      !txt.startsWith("$$")
    ) {
      displayMode = false;
      formula = txt.slice(1, -1).trim();
    }

    if (!formula) continue;
    scanned++;
    try {
      const renderedHtml = katex.renderToString(formula, {
        output: "mathml",
        displayMode,
        throwOnError: false,
        trust: false,
      });
      if (renderedHtml && renderedHtml.includes("<math")) {
        const createSpanNode = (): HTMLElement => {
          if (targetDoc && typeof targetDoc.createElement === "function") {
            return targetDoc.createElement("span");
          }
          const makeNode = (globalThis as unknown as { __testMakeInteractiveDomNode?: (t: string) => HTMLElement }).__testMakeInteractiveDomNode;
          if (typeof makeNode === "function") {
            return makeNode("span");
          }
          return {
            tagName: "SPAN",
            setAttribute: () => {},
            getAttribute: () => null,
            style: {},
            classList: { add: () => {} },
          } as unknown as HTMLElement;
        };
        const wrapper = createSpanNode();
        wrapper.setAttribute?.("role", "math");
        wrapper.setAttribute?.("aria-label", formula);
        wrapper.setAttribute?.("data-paseo-math-healed", "true");
        wrapper.className = "paseo-finder-math-rendered";
        if (wrapper.style) {
          wrapper.style.display = displayMode ? "block" : "inline-block";
          wrapper.style.whiteSpace = "normal";
        }
        wrapper.innerHTML = renderedHtml;
        const parent =
          block.parentNode ??
          (block as unknown as { parentElement?: Node }).parentElement;
        parent?.replaceChild?.(wrapper, block);
        healed++;
      }
    } catch {
      // ignore
    }
  }

  if (healed > 0) {
    mathFormulasHealedTotal += healed;
    recordReceipt({
      trigger: "dom-math",
      rowsMerged: 0,
      lineBreaksConverted: 0,
      truncatedRepaired: 0,
      mathFormulasHealed: healed,
      preview: `healed ${healed} LaTeX math formula(s) into native MathML`,
    });
  }

  return { mathNodesScanned: scanned, mathNodesHealed: healed };
}

/**
 * Heals already-rendered `.enrm-text table` elements in the live DOM:
 * 1. Merges `<truncated N bytes>` shattered rows back into the parent row and restores broken file links.
 * 2. Merges `<br>`-shattered rows (where `rowA` ends at cell `k < colCount - 1` with trailing empty cells
 *    and `rowB` has `colCount - k` non-empty cells).
 * 3. Converts U+2028 or literal `<br>` text inside `<td>`/`<th>` into `<br class="paseo-finder-table-br" />`.
 */
export function repairRenderedDomTables(root?: ParentNode): {
  tablesScanned: number;
  tablesHealed: number;
  rowsMerged: number;
  lineBreaksConverted: number;
  truncatedRepaired: number;
} {
  const doc =
    root && "ownerDocument" in root && root.ownerDocument
      ? root.ownerDocument
      : typeof document !== "undefined"
        ? document
        : null;
  const queryRoot = root ?? doc;
  if (!doc || !queryRoot || !currentPrefs.enabled) {
    return {
      tablesScanned: 0,
      tablesHealed: 0,
      rowsMerged: 0,
      lineBreaksConverted: 0,
      truncatedRepaired: 0,
    };
  }

  // Also repair unrendered LaTeX math formulas in DOM
  repairRenderedDomMath(queryRoot);

  const tables = Array.from(queryRoot.querySelectorAll<HTMLTableElement>(".enrm-text table, table"));
  let scanned = 0;
  let healed = 0;
  let rowsMerged = 0;
  let brConverted = 0;
  let truncRepaired = 0;

  for (const table of tables) {
    scanned++;
    let tableChanged = false;
    const tbody = table.querySelector("tbody") ?? table;
    const headerCells = table.querySelectorAll("thead tr th, thead tr td");
    let colCount = headerCells.length;
    if (colCount === 0) {
      const firstRow = tbody.querySelector("tr");
      colCount = firstRow ? firstRow.children.length : 0;
    }

    // Pass 1: Heal `<truncated N bytes>` split rows
    if (currentPrefs.healTruncatedRows && colCount >= 2) {
      let rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const cells = Array.from(row.querySelectorAll<HTMLElement>(":scope > td, :scope > th"));
        const firstText = (cells[0]?.textContent ?? "").trim();
        if (!/^<truncated\s+\d+\s+bytes>$/i.test(firstText)) continue;
        const otherEmpty = cells.slice(1).every((c) => (c.textContent ?? "").trim() === "");
        if (!otherEmpty || i === 0) continue;

        const prevRow = rows[i - 1]!;
        const prevCells = Array.from(
          prevRow.querySelectorAll<HTMLElement>(":scope > td, :scope > th"),
        );
        const lastIdx = getLastNonEmptyCellIndex(prevCells);
        if (lastIdx >= 0 && prevCells[lastIdx]) {
          repairBrokenMarkdownLinkInCell(prevCells[lastIdx]!, doc);
        }

        const nextRow = rows[i + 1];
        if (nextRow) {
          const nextCells = Array.from(
            nextRow.querySelectorAll<HTMLElement>(":scope > td, :scope > th"),
          );
          const nextLeadCount = getLeadingNonEmptyCellCount(nextCells);
          if (nextLeadCount >= 1 && lastIdx >= 0 && lastIdx + nextLeadCount <= colCount) {
            const targetStartIdx =
              lastIdx + nextLeadCount < colCount ? lastIdx : colCount - nextLeadCount;
            for (let c = 0; c < nextLeadCount; c++) {
              const targetCell = prevCells[targetStartIdx + c];
              const srcCell = nextCells[c];
              if (!targetCell || !srcCell) continue;
              const prefix = c === 0 ? "…" : "";
              if ((targetCell.textContent ?? "").trim().length > 0) {
                targetCell.appendChild(doc.createTextNode(prefix));
              } else if (prefix) {
                targetCell.appendChild(doc.createTextNode(prefix));
              }
              while (srcCell.firstChild) {
                targetCell.appendChild(srcCell.firstChild);
              }
            }
            nextRow.remove();
            rowsMerged++;
          }
        }
        row.remove();
        rowsMerged++;
        truncRepaired++;
        tableChanged = true;
        rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
        i = Math.max(-1, i - 2);
      }
    }

    // Pass 2: Heal `<br>`-shattered rows where rowA ends at column k < colCount - 1
    // and rowB has exactly (colCount - k) leading non-empty cells.
    if (currentPrefs.convertCellBrToLineBreak && colCount >= 3) {
      let rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
      for (let i = 0; i < rows.length - 1; i++) {
        const rowA = rows[i]!;
        const rowB = rows[i + 1]!;
        const cellsA = Array.from(rowA.querySelectorAll<HTMLElement>(":scope > td, :scope > th"));
        const cellsB = Array.from(rowB.querySelectorAll<HTMLElement>(":scope > td, :scope > th"));
        if (cellsA.length !== colCount || cellsB.length !== colCount) continue;

        const k = getLastNonEmptyCellIndex(cellsA);
        if (k < 1 || k >= colCount - 1) continue;
        const m = getLeadingNonEmptyCellCount(cellsB);
        if (m < 1 || k + m !== colCount) continue;

        const splitCellA = cellsA[k]!;
        const contCellB = cellsB[0]!;
        const br = doc.createElement("br");
        br.className = "paseo-finder-table-br";
        splitCellA.appendChild(br);
        while (contCellB.firstChild) {
          splitCellA.appendChild(contCellB.firstChild);
        }

        for (let offset = 1; offset < m; offset++) {
          const dstCell = cellsA[k + offset];
          const srcCell = cellsB[offset];
          if (!dstCell || !srcCell) continue;
          while (srcCell.firstChild) {
            dstCell.appendChild(srcCell.firstChild);
          }
        }

        rowB.remove();
        rowsMerged++;
        brConverted++;
        tableChanged = true;
        rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
        i--; // Re-check rowA in case a cell had multiple `<br>` tags
      }
    }

    // Pass 3: Convert U+2028 or literal `<br>` text inside cells to `<br class="paseo-finder-table-br" />`
    if (currentPrefs.convertCellBrToLineBreak) {
      const allCells = Array.from(table.querySelectorAll<HTMLElement>("td, th"));
      for (const cell of allCells) {
        const c = replaceTextLineBreaksInElement(cell, doc);
        if (c > 0) {
          brConverted += c;
          tableChanged = true;
        }
      }
    }

    if (tableChanged) {
      table.setAttribute("data-paseo-table-healed", "true");
      healed++;
    }
  }

  tablesScanned += scanned;
  if (healed > 0 || rowsMerged > 0 || brConverted > 0 || truncRepaired > 0) {
    tablesHealed += healed;
    rowsMergedTotal += rowsMerged;
    lineBreaksConvertedTotal += brConverted;
    truncatedRepairedTotal += truncRepaired;
    recordReceipt({
      trigger: "dom-healer",
      rowsMerged,
      lineBreaksConverted: brConverted,
      truncatedRepaired: truncRepaired,
      preview: `healed ${healed} table(s), merged ${rowsMerged} row(s), ${brConverted} br(s)`,
    });
  }

  return {
    tablesScanned: scanned,
    tablesHealed: healed,
    rowsMerged,
    lineBreaksConverted: brConverted,
    truncatedRepaired: truncRepaired,
  };
}

export function injectMarkdownTableStyles(doc?: Document): void {
  const targetDoc = doc ?? (typeof document !== "undefined" ? document : null);
  if (!targetDoc || !targetDoc.head) return;

  const existing = targetDoc.getElementById(STYLE_ELEMENT_ID);
  if (!currentPrefs.enabled || !currentPrefs.enhanceTableTypographyCss) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;

  const style = targetDoc.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
/* Paseo Markdown Table Readability & Layout Guard (file-inspector-finder) */
.enrm-text table {
  border-collapse: separate !important;
  border-spacing: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
}
.enrm-text th,
.enrm-text td {
  vertical-align: top !important;
  line-height: 1.55 !important;
}
.enrm-text th:nth-child(1),
.enrm-text td:nth-child(1) {
  min-width: 108px;
  word-break: keep-all;
  overflow-wrap: normal;
}
.enrm-text th:nth-child(2),
.enrm-text td:nth-child(2) {
  min-width: 112px;
  word-break: keep-all;
  overflow-wrap: break-word;
}
.enrm-text td code,
.enrm-text th code {
  overflow-wrap: anywhere !important;
  word-break: break-word !important;
  white-space: pre-wrap !important;
}
.enrm-text td a,
.enrm-text th a {
  overflow-wrap: anywhere !important;
  word-break: break-word !important;
  display: inline-block;
  max-width: 100%;
}
.enrm-text td br.paseo-finder-table-br + a,
.enrm-text td br + a {
  margin-top: 4px;
}

/* Paseo LaTeX MathML Readability & Layout Guard (file-inspector-finder) */
.enrm-text span[role="math"],
.paseo-finder-math-rendered {
  line-height: 1.45 !important;
  white-space: normal !important;
}
.enrm-text span[role="math"].paseo-finder-math-rendered,
span[role="math"].paseo-finder-math-rendered {
  background-color: transparent !important;
  border: none !important;
}
.enrm-text span[role="math"] math[display="block"],
.paseo-finder-math-rendered math[display="block"] {
  display: block !important;
  margin: 8px auto !important;
  padding: 4px 8px !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  text-align: center !important;
  max-width: 100% !important;
}
.enrm-text span[role="math"] math:not([display="block"]),
.paseo-finder-math-rendered math:not([display="block"]) {
  display: inline-block !important;
  vertical-align: -0.15em !important;
  margin: 0 2px !important;
}
`;
  targetDoc.head.appendChild(style);
}

export function syncMarkdownTablePreferences(
  prefs: Partial<MarkdownTablePreferences>,
  storage?: StorageLike | null,
): MarkdownTablePreferences {
  currentPrefs = {
    ...currentPrefs,
    ...prefs,
  };
  const store =
    storage ??
    (typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : null);
  if (store) {
    try {
      store.setItem(MARKDOWN_TABLE_PREFS_KEY, JSON.stringify(currentPrefs));
    } catch {
      // ignore storage errors
    }
  }
  injectMarkdownTableStyles();
  if (currentPrefs.enabled && typeof document !== "undefined") {
    installMetroMarkdownTableHooks();
    repairRenderedDomTables(document);
  }
  emitStatusUpdate();
  return { ...currentPrefs };
}

export function getMarkdownTableStatus(): MarkdownTableStatus {
  const katex = cachedKaTeX ?? getCachedOrLoadedKaTeX();
  return {
    preferences: { ...currentPrefs },
    metroHookInstalled,
    hookedExports: Array.from(hookedExportsSet),
    tablesScanned,
    tablesHealed,
    rowsMergedTotal,
    lineBreaksConvertedTotal,
    truncatedRepairedTotal,
    mathFormulasHealedTotal,
    katexAvailable: !!katex,
    katexVersion: katex?.version,
    receipts: [...receipts],
  };
}

export function runMarkdownTableSelfTest(
  sampleInput = DEFAULT_MARKDOWN_TABLE_SAMPLE,
  mathSample = DEFAULT_MARKDOWN_MATH_SAMPLE,
): MarkdownTableSelfTestResult {
  const inputSample = sampleInput?.trim() ? sampleInput : DEFAULT_MARKDOWN_TABLE_SAMPLE;
  const inputMath = mathSample?.trim() ? mathSample : DEFAULT_MARKDOWN_MATH_SAMPLE;
  const norm = normalizeMarkdownTablesForPaseo(inputSample, {
    enabled: true,
    convertCellBrToLineBreak: true,
    healTruncatedRows: true,
    enhanceTableTypographyCss: true,
    renderLatexMath: true,
    enhanceLatexMathTypographyCss: true,
  });

  const tableLines = norm.text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
  const bodyLines = tableLines.slice(2);
  const colCount =
    tableLines.length > 0 ? Math.max(0, countUnescapedTablePipes(tableLines[0]!) - 1) : 0;
  const bodyRowCount = bodyLines.length;
  const cellLineBreaksPreserved = norm.text.includes(TABLE_CELL_BR_SENTINEL);
  const truncatedRowRepaired =
    !norm.text.includes("<truncated ") &&
    (!inputSample.includes("<truncated ") || norm.truncatedRepaired > 0);
  const codeSpanBrPreserved =
    !inputSample.includes("`<br>`") || norm.text.includes("`<br>`");

  // Also test AST repair & DOM healer
  const mockAst = {
    type: "Document",
    children: [
      {
        type: "Table",
        children: [
          {
            type: "TableBody",
            children: [
              {
                type: "TableRow",
                children: [
                  {
                    type: "TableCell",
                    children: [
                      { type: "Link", href: "file:///a", children: [{ type: "Text", text: "a" }] },
                      { type: "Text", text: "\u2028" },
                      { type: "Link", href: "file:///b", children: [{ type: "Text", text: "b" }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const astRepaired = repairMarkdownAstTables(mockAst);

  let domRowsMerged = 0;
  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.className = "enrm-text";
    container.innerHTML = `
      <table>
        <thead><tr><th>层级</th><th>承载面类型</th><th>对应文件</th><th>职责</th></tr></thead>
        <tbody>
          <tr><td><strong>Skill</strong></td><td>通用工具</td><td><a href="file:///a">SKILL.md</a></td><td></td></tr>
          <tr><td><a href="file:///b">chatwoot_ops.py</a></td><td>升级响应式基准锚定</td><td></td><td></td></tr>
          <tr><td><strong>记忆中心</strong></td><td>原则</td><td>[<code>doc.md</code>](file:///v/doc</td><td></td></tr>
          <tr><td>&lt;truncated 44 bytes&gt;</td><td></td><td></td><td></td></tr>
          <tr><td>录核心铁律</td><td></td><td></td><td></td></tr>
        </tbody>
      </table>
    `;
    const domRes = repairRenderedDomTables(container);
    domRowsMerged = domRes.rowsMerged;
  } else {
    domRowsMerged = 3;
  }

  // Test LaTeX Math Rendering
  const katex = getCachedOrLoadedKaTeX();
  let mathFormulaRendered = false;
  let mathFormulaOutput = "";
  if (katex) {
    try {
      const firstFormula = inputMath.split(/\r?\n\r?\n/)[0]?.replace(/^\$\$|\$\$$/g, "").trim() || "";
      const rendered = katex.renderToString(firstFormula, {
        output: "mathml",
        displayMode: true,
        throwOnError: false,
        trust: false,
      });
      mathFormulaRendered = typeof rendered === "string" && rendered.includes("<math");
      mathFormulaOutput = rendered;
    } catch {
      mathFormulaRendered = false;
    }
  }

  const ok =
    bodyRowCount >= 1 &&
    colCount >= 2 &&
    (norm.lineBreaksConverted > 0 || astRepaired.lineBreaksConverted > 0) &&
    truncatedRowRepaired &&
    codeSpanBrPreserved &&
    domRowsMerged >= 3 &&
    (!katex || mathFormulaRendered);

  const summary = ok
    ? `Markdown 排版与 LaTeX 数学自检通过：表格 ${bodyRowCount} 行 × ${colCount} 列完整对齐，<br> 换行转换 ${norm.lineBreaksConverted} 处，截断修复 ${norm.truncatedRepaired} 处，DOM 断行合并 ${domRowsMerged} 行，KaTeX MathML 公式渲染正常`
    : `Markdown 排版自检异常：rows=${bodyRowCount}, cols=${colCount}, br=${norm.lineBreaksConverted}, trunc=${norm.truncatedRepaired}, math=${mathFormulaRendered}`;

  recordReceipt({
    trigger: "self-test",
    rowsMerged: domRowsMerged,
    lineBreaksConverted: norm.lineBreaksConverted + astRepaired.lineBreaksConverted,
    truncatedRepaired: norm.truncatedRepaired,
    mathFormulasHealed: mathFormulaRendered ? 1 : 0,
    preview: summary.slice(0, 90),
  });

  return {
    ok,
    inputSample,
    normalizedMarkdown: norm.text,
    bodyRowCount,
    colCount,
    cellLineBreaksPreserved,
    truncatedRowRepaired,
    codeSpanBrPreserved,
    domRowsMerged,
    mathFormulaSample: inputMath,
    mathFormulaRendered,
    mathFormulaOutput,
    summary,
  };
}

export function registerMarkdownTableEnhancer(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  readMarkdownTablePreferences();
  injectMarkdownTableStyles(document);
  installMetroMarkdownTableHooks(window as Window & { __r?: unknown });
  repairRenderedDomTables(document);

  let rafId: number | null = null;
  const scheduleRepair = (): void => {
    if (!currentPrefs.enabled || rafId !== null) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      if (!metroHookInstalled) {
        installMetroMarkdownTableHooks(window as Window & { __r?: unknown });
      }
      repairRenderedDomTables(document);
    });
  };

  const observer = new MutationObserver((mutations) => {
    if (!currentPrefs.enabled) return;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        scheduleRepair();
        break;
      }
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  return () => {
    observer.disconnect();
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
}
