import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const CompactionSummaryItemSchema = z.object({
  stepIndex: z.number(),
  trigger: z.enum(["manual", "auto"]),
  preTokens: z.number(),
  postTokens: z.number(),
  createdAt: z.string().nullable(),
  summaryPreview: z.string(),
});

export type CompactionSummaryItem = z.infer<typeof CompactionSummaryItemSchema>;

export const AntigravityContextSnapshotSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string().nullable(),
  conversationId: z.string().nullable(),
  model: z.string().nullable(),
  contextWindowMaxTokens: z.number(),
  contextWindowUsedTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number(),
  stepCount: z.number(),
  compactionCount: z.number(),
  lastCompaction: CompactionSummaryItemSchema.nullable(),
});

export type AntigravityContextSnapshot = z.infer<typeof AntigravityContextSnapshotSchema>;

export const inspectAntigravityContextRpc = defineRpc({
  name: "finder.inspect_antigravity_context",
  input: z.object({
    agentIds: z.array(z.string()).max(100).optional(),
    workspaceId: z.string().optional(),
    includeCompactionHistory: z.boolean().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    items: z.array(AntigravityContextSnapshotSchema),
    message: z.string(),
    durationMs: z.number(),
  }),
});

export function resolveAntigravityModelContextMaxTokens(modelId?: string | null): number {
  const id = String(modelId ?? "").trim().toLowerCase();
  if (id.startsWith("gpt-oss")) return 128_000;
  if (/claude-(?:opus|sonnet|haiku)-4/.test(id) && !id.includes("1m")) return 200_000;
  return 1_000_000;
}

export function formatEnhancedCompactionLabel(input: {
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
  baseLabel: string;
  locale?: string;
}): string {
  if (input.status === "loading") return input.baseLabel;
  const preTokens = input.preTokens;
  if (typeof preTokens !== "number" || !Number.isFinite(preTokens) || preTokens <= 0) {
    return input.baseLabel;
  }
  const tokensK = Math.max(1, Math.round(preTokens / 1000));
  if (input.baseLabel.includes(`${tokensK}K`)) {
    return input.baseLabel;
  }
  const isZh = /^zh\b/i.test(String(input.locale ?? "").trim());
  if (isZh) {
    if (input.trigger === "manual") return `已手动压缩上下文 · ${tokensK}K 词元`;
    if (input.trigger === "auto") return `已自动压缩上下文 · ${tokensK}K 词元`;
    return `上下文已压缩 · ${tokensK}K 词元`;
  }
  return `${input.baseLabel} · ${tokensK}K tokens`;
}
