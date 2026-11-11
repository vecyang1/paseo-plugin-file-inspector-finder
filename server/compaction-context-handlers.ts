import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  type AntigravityContextSnapshot,
  type CompactionSummaryItem,
  type inspectAntigravityContextRpc,
  resolveAntigravityAutoCompactCeilingTokens,
  resolveAntigravityModelContextMaxTokens,
} from "../shared/compaction-context-contracts";

interface RawAgentDiskRecord {
  id?: string;
  workspaceId?: string | null;
  provider?: string;
  model?: string | null;
  config?: { model?: string | null };
  persistence?: { sessionId?: string };
}

function extractConversationIdFromRecord(record: RawAgentDiskRecord): string | null {
  const sid = record.persistence?.sessionId ?? "";
  if (!sid.startsWith("plugin:")) return null;
  try {
    const parsed = JSON.parse(sid.slice("plugin:".length)) as {
      data?: { conversationId?: string };
    };
    const cid = parsed.data?.conversationId?.trim();
    return cid && /^[A-Za-z0-9-]+$/.test(cid) ? cid : null;
  } catch {
    return null;
  }
}

async function resolveTranscriptPath(conversationId: string, homeDir: string): Promise<string | null> {
  const logDirs = [
    path.join(homeDir, ".gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs"),
    path.join(
      homeDir,
      ".gemini",
      "antigravity-cli",
      "conversation_vault",
      "transcript_shelf",
      conversationId,
      ".system_generated",
      "logs",
    ),
    path.join(
      homeDir,
      ".gemini",
      "antigravity-cli",
      "conversation_vault",
      "pinned_conversations",
      "brain",
      conversationId,
      ".system_generated",
      "logs",
    ),
    path.join(
      homeDir,
      ".gemini",
      "antigravity-cli",
      "conversation_vault",
      "brain",
      conversationId,
      ".system_generated",
      "logs",
    ),
    path.join(homeDir, ".gemini", "antigravity", "brain", conversationId, ".system_generated", "logs"),
    path.join(
      homeDir,
      ".gemini",
      "antigravity",
      "conversation_vault",
      "transcript_shelf",
      conversationId,
      ".system_generated",
      "logs",
    ),
  ];

  for (const dir of logDirs) {
    for (const fileName of ["transcript_full.jsonl", "transcript.jsonl"]) {
      const candidate = path.join(dir, fileName);
      try {
        const st = await fs.stat(candidate);
        if (st.isFile() && st.size > 0 && st.size <= 64 * 1024 * 1024) {
          return candidate;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

function cleanUserPromptBody(raw: string): string {
  let text = raw;
  const reqMatch = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i.exec(text);
  if (reqMatch?.[1] !== undefined) text = reqMatch[1];
  const directiveIdx = text.indexOf("\n\n<!-- vec-slash-directive -->");
  if (directiveIdx !== -1) text = text.slice(0, directiveIdx);
  text = text
    .replace(/^\s*<system starter prompt in paseo>[\s\S]*?(?:-----------------[\s\S]*?<user prompt>:\s*|-----------------)/i, "")
    .replace(/<!--\s*paseo-peers:start[\s\S]*?(?:<!--\s*paseo-peers:end\s*-->|$)/gi, "")
    .replace(/^\s*<cadance>[\s\S]*?(?:<\/cadance>|(?=If u need make change to Paseo app)|(?=\r?\n\r?\n(?!\s*\/scheduled-task-rescheduler|\s*scan patterns|\s*reply concisly|\s*e2e test)))/gi, "")
    .replace(/^\s*If u need make change to Paseo app,\s*make sure it would survive auto updates and see if need contribute back to community auto\.?\s*/i, "")
    .replace(/^\s*<user prompt>:\s*/i, "");
  return text.trim();
}

export function parseAntigravityTranscriptContext(
  rawTranscript: string,
  modelId?: string | null,
): Omit<AntigravityContextSnapshot, "agentId" | "workspaceId" | "conversationId" | "model"> {
  const contextWindowMaxTokens = resolveAntigravityModelContextMaxTokens(modelId);
  const autoCompactCeilingTokens = resolveAntigravityAutoCompactCeilingTokens(modelId);
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let contextWindowUsedTokens = 0;
  let stepCount = 0;
  let compactionCount = 0;
  let lastUserBody = "";
  let lastCompaction: CompactionSummaryItem | null = null;
  const compactions: CompactionSummaryItem[] = [];
  let awaitingPostStepCompaction: CompactionSummaryItem | null = null;

  for (const line of rawTranscript.split("\n")) {
    if (!line) continue;
    if (
      !line.includes('"PLANNER_RESPONSE"') &&
      !line.includes('"CHECKPOINT"') &&
      !line.includes('"USER_INPUT"')
    ) {
      if (line.includes('"step_index"')) {
        const sm = /"step_index"\s*:\s*(\d+)/.exec(line);
        if (sm) {
          const nextCount = Number(sm[1]) + 1;
          if (nextCount > stepCount) stepCount = nextCount;
        }
      }
      continue;
    }

    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const stepIdx = typeof row.step_index === "number" ? row.step_index : -1;
    if (stepIdx + 1 > stepCount) stepCount = stepIdx + 1;

    if (row.type === "USER_INPUT" && row.source === "USER_EXPLICIT" && typeof row.content === "string") {
      lastUserBody = cleanUserPromptBody(row.content);
      continue;
    }

    const u = row.usage && typeof row.usage === "object" ? (row.usage as Record<string, unknown>) : null;
    const inTok =
      typeof row.input_tokens === "number"
        ? row.input_tokens
        : u && typeof u.input_tokens === "number"
          ? u.input_tokens
          : 0;
    const cacheTok =
      typeof row.cache_read_tokens === "number"
        ? row.cache_read_tokens
        : u && typeof u.cache_read_tokens === "number"
          ? u.cache_read_tokens
          : 0;
    const outTok =
      typeof row.output_tokens === "number"
        ? row.output_tokens
        : u && typeof u.output_tokens === "number"
          ? u.output_tokens
          : 0;

    if (row.type === "PLANNER_RESPONSE") {
      const sum = inTok + cacheTok + outTok;
      if (sum > 0) {
        inputTokens += inTok;
        cachedInputTokens += cacheTok;
        outputTokens += outTok;
        contextWindowUsedTokens = sum;
        if (awaitingPostStepCompaction) {
          const measuredPost = inTok + cacheTok;
          if (measuredPost > 0 && measuredPost < awaitingPostStepCompaction.preTokens) {
            awaitingPostStepCompaction.postTokens = measuredPost;
          }
          awaitingPostStepCompaction = null;
        }
      }
      continue;
    }

    if (row.type === "CHECKPOINT") {
      const preTokens = inTok + cacheTok + outTok;
      const isDone = row.status !== "ACTIVE" && row.status !== "RUNNING";
      if (preTokens > 0) {
        inputTokens += inTok;
        cachedInputTokens += cacheTok;
        outputTokens += outTok;
      }
      const postTokens =
        preTokens > 42_000
          ? Math.min(preTokens, (outTok || 4_000) + 38_000)
          : preTokens > 0
            ? Math.max(outTok || 1_000, Math.round(preTokens * 0.35))
            : contextWindowUsedTokens;
      if (isDone) {
        compactionCount += 1;
        if (postTokens > 0) contextWindowUsedTokens = postTokens;
        const isManual =
          /^\u200b?\/compact(?:\s|$)/i.test(lastUserBody) ||
          /(?:^|\r?\n)[ \t]*\u200b?\/compact[ \t]*$/i.test(lastUserBody);
        const rawSummary = typeof row.content === "string" ? row.content : "";
        const cleanedSummary = rawSummary
          .replace(/^#\s*Resuming from a compaction\s*/i, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 220);
        const item: CompactionSummaryItem = {
          stepIndex: stepIdx >= 0 ? stepIdx : stepCount,
          trigger: isManual ? "manual" : "auto",
          preTokens,
          postTokens,
          createdAt: typeof row.created_at === "string" ? row.created_at : null,
          summaryPreview: cleanedSummary,
        };
        compactions.push(item);
        lastCompaction = item;
        awaitingPostStepCompaction = item;
      }
    }
  }

  return {
    contextWindowMaxTokens,
    autoCompactCeilingTokens,
    contextWindowUsedTokens,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    stepCount,
    compactionCount,
    lastCompaction,
    compactions: compactions.slice(-25),
  };
}

export async function handleInspectAntigravityContext(
  input: RpcInput<typeof inspectAntigravityContextRpc>,
  options?: { homeDir?: string },
): Promise<RpcOutput<typeof inspectAntigravityContextRpc>> {
  const startMs = Date.now();
  const homeDir = options?.homeDir ?? os.homedir();
  const agentsRoot = path.join(homeDir, ".paseo", "agents");
  const targetAgentSet =
    input.agentIds && input.agentIds.length > 0 ? new Set(input.agentIds.map((x) => x.trim()).filter(Boolean)) : null;
  const targetWorkspaceId = input.workspaceId?.trim() || null;

  const candidateFiles: string[] = [];
  try {
    const entries = await fs.readdir(agentsRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const fullPath = path.join(agentsRoot, ent.name);
      if (ent.isFile() && ent.name.endsWith(".json")) {
        const stem = ent.name.slice(0, -5);
        if (!targetAgentSet || targetAgentSet.has(stem)) {
          candidateFiles.push(fullPath);
        }
      } else if (ent.isDirectory()) {
        try {
          const subFiles = await fs.readdir(fullPath);
          for (const sf of subFiles) {
            if (!sf.endsWith(".json")) continue;
            const stem = sf.slice(0, -5);
            if (!targetAgentSet || targetAgentSet.has(stem)) {
              candidateFiles.push(path.join(fullPath, sf));
            }
          }
        } catch {
          continue;
        }
      }
    }
  } catch {
    return {
      ok: true,
      items: [],
      message: "No Paseo agent records found on disk",
      durationMs: Date.now() - startMs,
    };
  }

  const maxScan = targetAgentSet ? targetAgentSet.size + 10 : targetWorkspaceId ? 1000 : 200;
  const items: AntigravityContextSnapshot[] = [];
  for (const filePath of candidateFiles.slice(0, maxScan)) {
    let record: RawAgentDiskRecord;
    try {
      record = JSON.parse(await fs.readFile(filePath, "utf8")) as RawAgentDiskRecord;
    } catch {
      continue;
    }
    if (record.provider !== "antigravity") continue;
    const agentId = record.id?.trim() || path.basename(filePath, ".json");
    if (targetAgentSet && !targetAgentSet.has(agentId)) continue;
    if (targetWorkspaceId && record.workspaceId !== targetWorkspaceId) continue;

    const conversationId = extractConversationIdFromRecord(record);
    const model = record.model ?? record.config?.model ?? null;
    if (!conversationId) {
      items.push({
        agentId,
        workspaceId: record.workspaceId ?? null,
        conversationId: null,
        model,
        contextWindowMaxTokens: resolveAntigravityModelContextMaxTokens(model),
        autoCompactCeilingTokens: resolveAntigravityAutoCompactCeilingTokens(model),
        contextWindowUsedTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        stepCount: 0,
        compactionCount: 0,
        lastCompaction: null,
      });
      continue;
    }

    const tp = await resolveTranscriptPath(conversationId, homeDir);
    if (!tp) continue;
    let rawTranscript = "";
    try {
      rawTranscript = await fs.readFile(tp, "utf8");
    } catch {
      continue;
    }
    const parsed = parseAntigravityTranscriptContext(rawTranscript, model);
    items.push({
      agentId,
      workspaceId: record.workspaceId ?? null,
      conversationId,
      model,
      ...parsed,
      lastCompaction: input.includeCompactionHistory === false ? null : parsed.lastCompaction,
      compactions: input.includeCompactionHistory === false ? undefined : parsed.compactions,
    });
  }

  return {
    ok: true,
    items,
    message: `Inspected ${items.length} Antigravity session(s)`,
    durationMs: Date.now() - startMs,
  };
}
