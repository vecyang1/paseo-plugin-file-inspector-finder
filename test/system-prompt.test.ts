import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  cleanPromptTextPure,
  handleInspectSystemPrompt,
  parsePromptSections,
} from "../server/system-prompt-handlers.ts";

test("System Prompt 1: parsePromptSections extracts headings and rule blocks", () => {
  const sample = `# Preamble
Follow standard instructions.

## [关注点分工 · 三权分立]
文案层 -> /unslop
设计层 -> /design-md
交互层 -> /ui-ux-pro-max

## Peer Agents
Peers block details.
`;

  const sections = parsePromptSections(sample);
  assert.ok(sections.length >= 3, `Expected at least 3 sections, got ${sections.length}`);
  assert.equal(sections[0]?.title, "Preamble");
  assert.ok(sections.some((s) => s.title.includes("三权分立")));
  assert.ok(sections.some((s) => s.title.includes("Peer Agents")));
  assert.ok(sections.every((s) => s.charCount > 0 && typeof s.preview === "string"));
});

test("System Prompt 2: cleanPromptTextPure adaptively strips historical peer-blocks and starter prompts", () => {
  const starter = `<system starter prompt in paseo>

Reply in Chinese. 

When communicate with human, be 克制, 陈述, 平视, 极简主义, 简短;
-----------------
<user prompt>:
<!-- paseo-peers:start v4 -->
## Peer Agents
Other agent sessions may be working beside you.
<!-- paseo-peers:end -->

https://example.com/user-real-task`;

  const cleaned = cleanPromptTextPure(starter);
  assert.equal(cleaned, "https://example.com/user-real-task");
});

test("System Prompt 3: cleanPromptTextPure handles slash directive hoisting and empty fallback", () => {
  const withSlash = `/plan \u200bReview architecture\n\n<!-- vec-slash-directive -->\n<SKILL name="foo" />`;
  const cleaned = cleanPromptTextPure(withSlash);
  assert.equal(cleaned, "Review architecture");

  assert.equal(cleanPromptTextPure(""), "");
  assert.equal(cleanPromptTextPure("just normal text"), "just normal text");
});

test("System Prompt 4: handleInspectSystemPrompt loads config.json and calculates metadata", async () => {
  const configPath = path.join(os.homedir(), ".paseo", "config.json");
  const hadConfig = fs.existsSync(configPath);
  if (!hadConfig) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        daemon: {
          appendSystemPrompt: "## Instructions\nRole instructions for testing.",
        },
      }),
    );
  }
  try {
    const res = await handleInspectSystemPrompt({ action: "inspect" });
    assert.equal(res.ok, true);
    assert.ok(typeof res.configPath === "string");
    assert.ok(res.charCount > 0);
    assert.ok(res.estimatedTokens > 0);
    assert.ok(Array.isArray(res.sections));
    assert.ok(res.sections.length > 0);
  } finally {
    if (!hadConfig) {
      try {
        fs.unlinkSync(configPath);
      } catch {}
    }
  }
});

test("System Prompt 5: handleInspectSystemPrompt action=test_clean runs sanitization dry-run", async () => {
  const res = await handleInspectSystemPrompt({
    action: "test_clean",
    testInput: "<system starter prompt in paseo>\n\n-----------------\n<user prompt>:\nhttps://my-task.org",
  });
  assert.equal(res.ok, true);
  assert.ok(res.testResult);
  assert.equal(res.testResult?.cleanedText, "https://my-task.org");
  assert.equal(res.testResult?.strippedPrefix, true);
});

test("System Prompt 6: parsePromptSections cleanly strips brackets to prevent double-bracket pill badges", () => {
  const raw = `
[关注点分工 · 三权分立]
文案 -> /unslop
设计 -> /design-md

## [执行与闭环流水线 · 五步法]
1. 意图解析
2. 标杆摄取

# [Peer Agents]
Teammates.
`;
  const sections = parsePromptSections(raw);
  assert.equal(sections.length, 3);
  assert.equal(sections[0]?.title, "关注点分工 · 三权分立");
  assert.equal(sections[1]?.title, "执行与闭环流水线 · 五步法");
  assert.equal(sections[2]?.title, "Peer Agents");
  // Invariant: no title retains surrounding brackets
  assert.ok(sections.every((s) => !s.title.startsWith("[") && !s.title.endsWith("]")));
});

test("System Prompt 7: cleanPromptTextPure removes cadance block cleanly without leftover prompt noise", () => {
  const withCadence = `
<cadance>
If you think u need cadance to RSI or auto evolve and fix, init it.
 /scheduled-task-rescheduler for above to see if need create cadance or audit, updates ; plz scan patterns, ur log or other intake data source /feedback source and see how should be productive enough as input and audit sidecard if need;
</cadance>

User actual message here.
`;
  const cleaned = cleanPromptTextPure(withCadence);
  assert.equal(cleaned, "User actual message here.");
  assert.ok(!cleaned.includes("<cadance>"));
  assert.ok(!cleaned.includes("how should be productive"));
});
