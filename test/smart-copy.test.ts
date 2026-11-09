import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SMART_COPY_SAMPLE,
  enhanceRichClipboardHtml,
  getSmartCopyStatus,
  installSmartClipboardCopy,
  isCodeOnlyClipboardPayload,
  markdownToCleanPlainText,
  runSmartCopySelfTest,
  syncSmartCopyPreferences,
  transformClipboardPayload,
} from "../client/smart-copy-web";

test("Smart Copy 1: strips all ** asterisks from multi-paragraph Markdown prose while preserving • bullets and paragraph breaks", () => {
  const res = markdownToCleanPlainText(DEFAULT_SMART_COPY_SAMPLE, {
    bulletMarker: "bullet",
    linkFormat: "label-only",
  });

  assert.equal(res.plainText.includes("**"), false, "Should not contain any ** asterisks");
  assert.ok(res.strippedTokens >= 8, `Expected >= 8 stripped tokens, got ${res.strippedTokens}`);
  assert.ok(res.plainText.startsWith('"Thanks for reaching out! Great to connect with you.'));
  assert.ok(
    res.plainText.includes(
      "real-time session streaming, deterministic UI observability, and zero-popout background automation.",
    ),
  );
  assert.ok(res.plainText.includes("• First, on the runtime side: At Acme Cloud—"));
  assert.ok(
    res.plainText.includes("• Second, on the client UX side: We unified keyboard-first navigation"),
  );
  assert.ok(res.plainText.includes("• Recently: We've been shipping update-safe local plugins"));
});

test("Smart Copy 2: preserves *, #, and **kwargs inside fenced code blocks and inline code spans", () => {
  const markdownWithCode = [
    "### Deployment Steps",
    "",
    "Run `python3 -m pytest tests/*.py` with `**kwargs` support:",
    "",
    "```python",
    "# Keep this comment and **kwargs intact",
    "def run_query(*args, **kwargs):",
    "    return 4 * 5",
    "```",
    "",
    "- **Step 1**: Check [Documentation](https://example.com/docs)",
  ].join("\n");

  const res = markdownToCleanPlainText(markdownWithCode, {
    bulletMarker: "bullet",
    linkFormat: "label-only",
  });

  assert.ok(res.plainText.startsWith("Deployment Steps\n"));
  assert.ok(res.plainText.includes("Run python3 -m pytest tests/*.py with **kwargs support:"));
  assert.ok(res.plainText.includes("# Keep this comment and **kwargs intact"));
  assert.ok(res.plainText.includes("def run_query(*args, **kwargs):"));
  assert.ok(res.plainText.includes("    return 4 * 5"));
  assert.equal(res.plainText.includes("```"), false);
  assert.ok(res.plainText.includes("• Step 1: Check Documentation"));
});

test("Smart Copy 3: linkFormat 'label-with-url' keeps URL in parentheses unless label already matches URL", () => {
  const md =
    "Check [project docs](https://example.com) or [example.com/docs](https://example.com/docs).";
  const withUrl = markdownToCleanPlainText(md, {
    bulletMarker: "bullet",
    linkFormat: "label-with-url",
  });
  assert.equal(
    withUrl.plainText,
    "Check project docs (https://example.com) or example.com/docs.",
  );
});

test("Smart Copy 4: enhanceRichClipboardHtml upgrades CJK fullwidth-colon **...：** in HTML prose without touching <code>", () => {
  const rawHtml =
    '<meta charset="utf-8"><p>• **体量与角色：**管理 4 个品牌</p><pre><code>const x = "**not bold**";</code></pre>';
  const enhanced = enhanceRichClipboardHtml(rawHtml);
  assert.ok(enhanced.includes("<p>• <strong>体量与角色：</strong>管理 4 个品牌</p>"));
  assert.ok(enhanced.includes('<code>const x = "**not bold**";</code>'));
});

test("Smart Copy 5: transformClipboardPayload handles smart, plain, markdown, and code-passthrough modes", () => {
  const html = '<meta charset="utf-8"><p><strong>Hello</strong> world</p>';
  const raw = "**Hello** world";

  const smart = transformClipboardPayload({ plainText: raw, html }, undefined, "smart");
  assert.equal(smart.modeUsed, "smart");
  assert.equal(smart.plainText, "Hello world");
  assert.equal(smart.html, html);

  const plain = transformClipboardPayload({ plainText: raw, html }, undefined, "plain");
  assert.equal(plain.modeUsed, "plain");
  assert.equal(plain.plainText, "Hello world");
  assert.equal(plain.html, undefined);

  const md = transformClipboardPayload({ plainText: raw, html }, undefined, "markdown");
  assert.equal(md.modeUsed, "markdown");
  assert.equal(md.plainText, "**Hello** world");
  assert.equal(md.html, html);

  const codeOnly = isCodeOnlyClipboardPayload(
    '<meta charset="utf-8"><pre><code class="language-sh">echo "**keep**"</code></pre>',
  );
  assert.equal(codeOnly, true);
  const passthrough = transformClipboardPayload(
    { plainText: 'echo "**keep**"', html: "<pre><code>echo \"**keep**\"</code></pre>", isCodeOnly: true },
    undefined,
    "smart",
  );
  assert.equal(passthrough.modeUsed, "code-passthrough");
  assert.equal(passthrough.plainText, 'echo "**keep**"');
});

test("Smart Copy 6: window bubble copy listener cleans Paseo selection copy in-place while keeping HTML for Notion", () => {
  const listeners = new Map<string, Set<(ev: unknown) => void>>();
  const docListeners = new Map<string, Set<(ev: unknown) => void>>();

  const fakeDoc = {
    activeElement: null,
    addEventListener(type: string, fn: (ev: unknown) => void) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (ev: unknown) => void) {
      docListeners.get(type)?.delete(fn);
    },
  } as unknown as Document;

  const fakeWin = {
    localStorage: {
      store: new Map<string, string>(),
      getItem(k: string) {
        return this.store.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        this.store.set(k, v);
      },
    },
    getSelection: () => null,
    addEventListener(type: string, fn: (ev: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (ev: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent() {
      return true;
    },
  } as unknown as Window;

  const cleanup = installSmartClipboardCopy(fakeDoc, fakeWin);
  try {
    syncSmartCopyPreferences({ enabled: true, defaultMode: "smart" });
    const dataMap = new Map<string, string>([
      ["text/plain", '**"Thanks for reaching out!**\n\n• **First**: At **Acme Cloud**'],
      [
        "text/html",
        '<meta charset="utf-8"><p><strong>"Thanks for reaching out!</strong></p><p>• <strong>First</strong>: At <strong>Acme Cloud</strong></p>',
      ],
    ]);

    const copyEvent = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
      clipboardData: {
        getData(type: string) {
          return dataMap.get(type) ?? "";
        },
        setData(type: string, val: string) {
          dataMap.set(type, val);
        },
        clearData() {
          dataMap.clear();
        },
      },
    };

    for (const fn of listeners.get("copy") ?? []) {
      fn(copyEvent);
    }

    assert.equal(copyEvent.prevented, true);
    assert.equal(dataMap.get("text/plain"), '"Thanks for reaching out!\n\n• First: At Acme Cloud');
    assert.ok(dataMap.get("text/html")?.includes("<strong>Acme Cloud</strong>"));
  } finally {
    cleanup();
  }
});

test("Smart Copy 7: runSmartCopySelfTest passes all invariants", () => {
  const res = runSmartCopySelfTest();
  assert.equal(res.ok, true, res.summary);
  assert.equal(res.smartPlainOutput.includes("**"), false);
  assert.equal(res.codeBlockPreserved, true);
  assert.equal(res.plainOnlyHasHtml, false);
  const status = getSmartCopyStatus();
  assert.equal(status.preferences.defaultMode, "smart");
});
