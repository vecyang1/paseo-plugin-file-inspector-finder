// Link-First Retitle
//
// Problem (measured 2026-11-10): when the first prompt is only a link (Slack
// thread, Notion page, GitHub issue), Paseo names the workspace once, from the
// prompt text alone. Its generator (`worktree-branch-name-generator.js`) is told
// "Do not read files, run tools", so the best it can produce is
// "Investigate Slack thread in www-hea...". Eighteen sessions opened from Slack
// links all looked alike in the sidebar.
//
// Fix: after the first completed turn, the agent has already read the link. If
// the title still describes the link instead of the agenda, derive a title from
// the agent's own answer and write it through the plugin's single rename path
// (`handleRenameThread`, which also feeds the Settings action log).
//
// Guards: once per agent (ledger), only early in a session, only when the first
// prompt is link-only, only when the current title is still link-shaped (a title
// a human or the agent already chose is left alone), never for subagents.
//
// Read:  ledger at ~/.paseo/file-inspector-finder/link-retitle-ledger.jsonl
// Test:  `manage_link_retitle` agent tool, action "dry_run"
// Tune:  ~/.paseo/file-inspector-finder/link-retitle.json or env
//        FINDER_LINK_RETITLE=0 | FINDER_RETITLE_BASE_URL | FINDER_RETITLE_MODEL
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface LinkRetitleConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  maxUserMessages: number;
  timeoutMs: number;
  source: "default" | "json" | "env";
}

export interface LinkRetitleLedgerEntry {
  at: string;
  agentId: string;
  workspaceId: string | null;
  from: string | null;
  to: string | null;
  model: string;
  ok: boolean;
  reason: string;
  dryRun?: boolean;
}

const DATA_DIR = path.join(os.homedir(), ".paseo", "file-inspector-finder");
export const LINK_RETITLE_LEDGER_PATH = path.join(DATA_DIR, "link-retitle-ledger.jsonl");
export const LINK_RETITLE_CONFIG_PATH = path.join(DATA_DIR, "link-retitle.json");

// Gateway and model verified live 2026-11-10: `GET 127.0.0.1:8045/v1/models`
// lists gemini-3.5-flash-lite; a chat completion returned in ~12 s.
const DEFAULTS: Omit<LinkRetitleConfig, "source"> = {
  enabled: true,
  baseUrl: "http://127.0.0.1:8045/v1",
  model: "gemini-3.5-flash-lite",
  maxUserMessages: 2,
  timeoutMs: 45_000,
};

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const GENERIC_HOST_LABELS = new Set([
  "www", "app", "com", "net", "org", "io", "co", "ai", "dev", "so", "cn", "jp",
  "m", "web", "docs", "api", "archives",
]);
const MAX_TITLE_CHARS = 60;

export function loadLinkRetitleConfig(env: NodeJS.ProcessEnv = process.env): LinkRetitleConfig {
  let config: LinkRetitleConfig = { ...DEFAULTS, source: "default" };
  try {
    const parsed = JSON.parse(fs.readFileSync(LINK_RETITLE_CONFIG_PATH, "utf8")) as Partial<LinkRetitleConfig>;
    config = { ...config, ...pickKnown(parsed), source: "json" };
  } catch {
    // No config file: defaults apply.
  }
  if (env.FINDER_LINK_RETITLE !== undefined) {
    config = { ...config, enabled: !["0", "false", "off"].includes(env.FINDER_LINK_RETITLE.toLowerCase()), source: "env" };
  }
  if (env.FINDER_RETITLE_BASE_URL) config = { ...config, baseUrl: env.FINDER_RETITLE_BASE_URL, source: "env" };
  if (env.FINDER_RETITLE_MODEL) config = { ...config, model: env.FINDER_RETITLE_MODEL, source: "env" };
  return config;
}

function pickKnown(raw: Partial<LinkRetitleConfig>): Partial<LinkRetitleConfig> {
  const out: Partial<LinkRetitleConfig> = {};
  if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
  if (typeof raw.baseUrl === "string" && raw.baseUrl.trim()) out.baseUrl = raw.baseUrl.trim();
  if (typeof raw.model === "string" && raw.model.trim()) out.model = raw.model.trim();
  if (typeof raw.maxUserMessages === "number" && raw.maxUserMessages > 0) out.maxUserMessages = raw.maxUserMessages;
  if (typeof raw.timeoutMs === "number" && raw.timeoutMs > 0) out.timeoutMs = raw.timeoutMs;
  return out;
}

export function extractUrls(text: string): string[] {
  return Array.from(text.matchAll(URL_PATTERN), (m) => m[0]);
}

/** True when the prompt is a link with at most a few words around it. */
export function isLinkOnlyPrompt(text: string | null | undefined): boolean {
  if (!text) return false;
  const urls = extractUrls(text);
  if (urls.length === 0) return false;
  const rest = text.replace(URL_PATTERN, " ").replace(/[\s\p{P}\p{S}]+/gu, " ").trim();
  if (!rest) return true;
  const words = rest.split(" ").filter(Boolean);
  // CJK has no spaces, so also bound the raw character count.
  return words.length <= 3 && rest.length <= 16;
}

/** Host tokens that make a title read as "about the link", e.g. slack, www-headquarters. */
export function hostTokens(urls: string[]): string[] {
  const tokens = new Set<string>();
  for (const raw of urls) {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      for (const label of host.split(".")) {
        if (label.length >= 3 && !GENERIC_HOST_LABELS.has(label)) tokens.add(label);
      }
    } catch {
      // Unparseable URL: ignore.
    }
  }
  return [...tokens];
}

// Words that describe "go look at a link" rather than what the link is about.
const LINK_VERB_NOUN_WORDS = new Set([
  "investigate", "review", "triage", "read", "check", "open", "analyze", "analyse", "summarize", "summarise",
  "look", "inspect", "view", "see", "handle", "process", "follow", "up", "into",
  "a", "an", "the", "in", "from", "on", "of", "for", "to", "at", "via", "about", "this", "that",
  "thread", "threads", "message", "messages", "link", "linked", "url", "page", "post", "channel", "request",
  "doc", "document", "issue", "discussion", "comment", "reply", "item", "task", "note", "workspace",
  "slack", "notion", "github", "google", "docs", "drive", "figma", "linear", "jira", "x", "twitter",
]);
const ID_TOKEN = /^(?=.*\d)[a-z0-9_-]{6,}$/i;
// Paseo's done toggle (`⌥D`) prefixes titles with this marker.
export const DONE_PREFIX = "d ";

function stripDonePrefix(title: string): string {
  return title.startsWith(DONE_PREFIX) ? title.slice(DONE_PREFIX.length) : title;
}

/**
 * A title still describes the link (or nothing) rather than the agenda.
 * Measured on 15 real sidebar titles 2026-11-10: "Triage Slack thread
 * p1794186693896139" and "Review Slack thread in headquarters channel" are
 * link-shaped; "Fix cadence Notion sync from Slack thread" and "Collect email
 * leads into FluentCRM from Slack" are not, even though they name a platform.
 * Rule: drop link verbs/nouns, platform and host tokens, and ids; if at most
 * one content word is left, the title is about the link.
 */
export function isLinkShapedTitle(title: string | null | undefined, prompt: string): boolean {
  const clean = stripDonePrefix((title ?? "").trim()).toLowerCase();
  if (!clean || clean === "main") return true;
  if (clean.includes("://") || clean.startsWith("www.")) return true;
  const promptLine = prompt.trim().split(/\r?\n/)[0]?.trim().toLowerCase() ?? "";
  const bare = clean.replace(/(\.\.\.|…)$/, "");
  if (promptLine && bare.length >= 8 && promptLine.startsWith(bare)) return true;
  const hosts = hostTokens(extractUrls(prompt));
  const content = clean
    .split(/\s+/)
    .map((w) => w.replace(/(\.\.\.|…)$/, "").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => w.length > 1)
    .filter((w) => !LINK_VERB_NOUN_WORDS.has(w))
    .filter((w) => !ID_TOKEN.test(w) || /^[a-z]+$/i.test(w))
    .filter((w) => !hosts.some((h) => h === w || (w.length >= 3 && h.startsWith(w))));
  // CJK titles have no spaces; one long token is real content, not a link.
  if (content.length === 1 && /[\u3040-\u30ff\u3400-\u9fff]/.test(content[0]) && content[0].length >= 4) return false;
  return content.length <= 1;
}

export function normalizeGeneratedTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let title = raw
    .replace(/^```[a-z]*|```$/gim, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "";
  title = title
    .replace(/^(title|标题)\s*[:：]\s*/i, "")
    .replace(/^["'“”‘’`*#\s]+|["'“”‘’`*\s]+$/g, "")
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/[.。!！]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title || title.includes("://")) return null;
  return title.length > MAX_TITLE_CHARS ? title.slice(0, MAX_TITLE_CHARS).trim() : title;
}

export function buildRetitlePrompt(firstPrompt: string, assistantReply: string): string {
  const reply = assistantReply.length > 6000 ? `${assistantReply.slice(0, 4500)}\n...\n${assistantReply.slice(-1500)}` : assistantReply;
  return [
    "Name this agent session for a sidebar list.",
    "The user opened it by pasting only a link. The assistant has since read the link and answered.",
    "Write a title for the real agenda (the request or topic inside the linked content), not for the link or platform.",
    "Rules: an actionable task label, operation + concrete target, about 4 to 7 words, max 60 characters, sentence case.",
    "Keep distinguishing names (project, product, person, ticket). No emoji, no quotes, no trailing punctuation.",
    "Never mention Slack, Notion, link, URL, thread or message unless that is the actual subject.",
    "Use the language the linked request is written in.",
    "Return the title only.",
    "",
    `User prompt: ${firstPrompt.trim().slice(0, 500)}`,
    "",
    "Assistant answer:",
    reply,
  ].join("\n");
}

export async function generateTitleViaGateway(
  prompt: string,
  config: LinkRetitleConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        // Reasoning models spend tokens before the answer; keep headroom.
        max_tokens: 400,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return normalizeGeneratedTitle(body.choices?.[0]?.message?.content ?? null);
  } finally {
    clearTimeout(timer);
  }
}

export function readLinkRetitleLedger(limit = 50): LinkRetitleLedgerEntry[] {
  try {
    const lines = fs.readFileSync(LINK_RETITLE_LEDGER_PATH, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l) as LinkRetitleLedgerEntry).reverse();
  } catch {
    return [];
  }
}

function appendLedger(entry: LinkRetitleLedgerEntry) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(LINK_RETITLE_LEDGER_PATH, `${JSON.stringify(entry)}\n`);
  } catch {
    // Ledger is best-effort; never break the turn hook.
  }
}

// Terminal outcomes end the retitle for an agent. Retryable skips
// (answer_too_short after a clarifying question, gateway_error) try again on
// the next completed turn while the session is still early.
const TERMINAL_REASONS = new Set(["renamed", "title_already_specific", "session_too_far_along"]);
function alreadyHandled(agentId: string): boolean {
  return readLinkRetitleLedger(500).some((e) => e.agentId === agentId && !e.dryRun && TERMINAL_REASONS.has(e.reason));
}

// --- Daemon access -------------------------------------------------------

type TimelineItem = { type: string; text?: string };
interface PaseoLike {
  agents: { ref(id: string): { timeline: { refetch(o: { direction?: "tail"; limit?: number }): Promise<{ entries: { item: TimelineItem }[]; agent?: { title?: string | null; workspaceId?: string } | null }> } } };
  workspaces: { list(): Promise<{ entries: { id: string; title?: string | null; name?: string | null }[] }> };
}

export interface RetitleInput {
  agentId: string;
  workspaceId: string | null;
  parentAgentId?: string | null;
  agentTitle?: string | null;
  dryRun?: boolean;
  force?: boolean;
  /** Backfill of an older session: the early-session guard does not apply. */
  backfill?: boolean;
}

export interface RetitleDeps {
  paseo: PaseoLike;
  rename: (input: { workspaceId?: string; agentId: string; title: string; source: string }) => Promise<{ ok: boolean; message?: string }>;
  config?: LinkRetitleConfig;
  generate?: (prompt: string, config: LinkRetitleConfig) => Promise<string | null>;
}

export async function runLinkFirstRetitle(input: RetitleInput, deps: RetitleDeps): Promise<LinkRetitleLedgerEntry> {
  const config = deps.config ?? loadLinkRetitleConfig();
  const base = { at: new Date().toISOString(), agentId: input.agentId, workspaceId: input.workspaceId, model: config.model, dryRun: input.dryRun || undefined };
  const skip = (reason: string, from: string | null = null): LinkRetitleLedgerEntry => ({ ...base, from, to: null, ok: false, reason });

  if (!config.enabled && !input.force) return skip("disabled");
  if (input.parentAgentId && !input.force) return skip("subagent");
  if (!input.dryRun && !input.force && alreadyHandled(input.agentId)) return skip("already_handled");

  const page = await deps.paseo.agents.ref(input.agentId).timeline.refetch({ direction: "tail", limit: 400 });
  const items = page.entries.map((e) => e.item);
  const userMessages = items.filter((i) => i.type === "user_message");
  const firstPrompt = userMessages[0]?.text ?? input.agentTitle ?? page.agent?.title ?? "";
  const reply = [...items].reverse().find((i) => i.type === "assistant_message" && (i.text ?? "").trim().length > 0)?.text ?? "";

  if (!isLinkOnlyPrompt(firstPrompt)) return skip("not_link_only");
  // From here on the session is a link-first one, so every outcome is
  // recorded: the ledger answers "why was this one not renamed?".
  const logged = (entry: LinkRetitleLedgerEntry) => {
    if (!input.dryRun) appendLedger(entry);
    return entry;
  };
  if (!input.force && !input.backfill && userMessages.length > config.maxUserMessages) return logged(skip("session_too_far_along"));
  if (reply.trim().length < 120) return logged(skip("answer_too_short"));

  const workspaceId = input.workspaceId ?? page.agent?.workspaceId ?? null;
  // handleRenameThread falls back to the first listed workspace when it gets
  // no id, which would rename an unrelated row. Never call it without one.
  if (!workspaceId) return logged(skip("no_workspace"));
  let currentTitle: string | null = input.agentTitle ?? page.agent?.title ?? null;
  {
    const list = await deps.paseo.workspaces.list().catch(() => ({ entries: [] as { id: string; title?: string | null; name?: string | null }[] }));
    const ws = list.entries.find((w) => w.id === workspaceId);
    if (ws) currentTitle = ws.title ?? ws.name ?? currentTitle;
  }
  if (!input.force && !isLinkShapedTitle(currentTitle, firstPrompt)) return logged(skip("title_already_specific", currentTitle));

  const generate = deps.generate ?? ((p: string, c: LinkRetitleConfig) => generateTitleViaGateway(p, c));
  let title: string | null = null;
  try {
    title = await generate(buildRetitlePrompt(firstPrompt, reply), config);
  } catch (error) {
    return logged({ ...skip("gateway_error", currentTitle), detail: String(error) } as LinkRetitleLedgerEntry);
  }
  if (!title) return logged(skip("empty_generation", currentTitle));

  if (currentTitle?.startsWith(DONE_PREFIX)) title = `${DONE_PREFIX}${title}`;
  if (input.dryRun) return { ...base, workspaceId, from: currentTitle, to: title, ok: true, reason: "dry_run" };

  const res = await deps.rename({ workspaceId, agentId: input.agentId, title, source: "link-first-retitle" });
  const entry: LinkRetitleLedgerEntry = { ...base, workspaceId, from: currentTitle, to: title, ok: res.ok, reason: res.ok ? "renamed" : `rename_failed: ${res.message ?? ""}` };
  appendLedger(entry);
  return entry;
}

// --- Backfill ------------------------------------------------------------

export interface BackfillCandidate {
  workspaceId: string;
  workspaceTitle: string | null;
  agentId: string;
  firstPrompt: string;
}

interface AgentRecordLite {
  id: string;
  workspaceId?: string;
  title?: string | null;
  createdAt?: string;
  internal?: boolean;
  archivedAt?: string | null;
  labels?: Record<string, string>;
}

function readAgentRecords(root = path.join(os.homedir(), ".paseo", "agents")): AgentRecordLite[] {
  const out: AgentRecordLite[] = [];
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return out;
  }
  for (const dir of dirs) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(root, dir, file), "utf8")) as AgentRecordLite);
      } catch {
        // Skip unreadable records.
      }
    }
  }
  return out;
}

/** Workspaces whose sidebar title still names a link, paired with their first agent. */
export async function findBackfillCandidates(paseo: PaseoLike, records: AgentRecordLite[] = readAgentRecords()): Promise<BackfillCandidate[]> {
  const firstAgentByWorkspace = new Map<string, AgentRecordLite>();
  for (const rec of records) {
    if (!rec.workspaceId || rec.internal || rec.labels?.["paseo.parent-agent-id"]) continue;
    const prev = firstAgentByWorkspace.get(rec.workspaceId);
    if (!prev || (rec.createdAt ?? "") < (prev.createdAt ?? "")) firstAgentByWorkspace.set(rec.workspaceId, rec);
  }
  const list = await paseo.workspaces.list();
  const candidates: BackfillCandidate[] = [];
  for (const ws of list.entries) {
    const agent = firstAgentByWorkspace.get(ws.id);
    const prompt = agent?.title ?? "";
    const title = ws.title ?? ws.name ?? null;
    if (!agent || !isLinkOnlyPrompt(prompt) || !isLinkShapedTitle(title, prompt)) continue;
    candidates.push({ workspaceId: ws.id, workspaceTitle: title, agentId: agent.id, firstPrompt: prompt });
  }
  return candidates;
}

/** Retitles candidates one at a time; results land in the ledger. */
export async function runLinkRetitleBackfill(candidates: BackfillCandidate[], deps: RetitleDeps): Promise<LinkRetitleLedgerEntry[]> {
  const results: LinkRetitleLedgerEntry[] = [];
  for (const c of candidates) {
    try {
      results.push(await runLinkFirstRetitle({ agentId: c.agentId, workspaceId: c.workspaceId, agentTitle: c.firstPrompt, backfill: true }, deps));
    } catch (error) {
      results.push({ at: new Date().toISOString(), agentId: c.agentId, workspaceId: c.workspaceId, from: c.workspaceTitle, to: null, model: "", ok: false, reason: `error: ${String(error)}` });
    }
  }
  return results;
}
