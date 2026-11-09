import type { RpcInput } from "@getpaseo/plugin";
import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import * as os from "node:os";
import * as path from "node:path";
import type { forkSessionRpc } from "../shared/contracts";

// One owner for branching agy conversations: agy_conversation_branch.py behind antigravity-ops.
const ANTIGRAVITY_OPS_BIN = path.join(os.homedir(), ".local", "bin", "antigravity-ops");

type ForkCliResult = {
  error?: string;
  dry_run?: boolean;
  agent_id?: string | null;
  source_agent_id?: string;
  conversation_id?: string;
  source_conversation_id?: string;
  title?: string;
  steps_kept?: number;
};

export function buildForkArgs(input: RpcInput<typeof forkSessionRpc>): string[] {
  const args = ["conversation", "fork-agent", input.agentId.trim(), "--json"];
  if (input.title && input.title.trim()) args.push("--title", input.title.trim());
  if (input.dryRun) args.push("--dry-run");
  else if (input.open !== false) args.push("--open");
  return args;
}

export function parseForkOutput(stdout: string): ForkCliResult {
  const line = String(stdout || "").trim().split("\n").pop() || "{}";
  try {
    return JSON.parse(line) as ForkCliResult;
  } catch {
    return { error: `Unreadable fork output: ${line.slice(0, 200)}` };
  }
}

export async function handleForkSession(
  input: RpcInput<typeof forkSessionRpc>,
  _context: PluginHandlerContext,
) {
  const started = Date.now();
  const dryRun = Boolean(input.dryRun);
  let parsed: ForkCliResult;
  try {
    const res = await execCommand(ANTIGRAVITY_OPS_BIN, buildForkArgs(input), { timeout: 180_000 });
    parsed = parseForkOutput(res.stdout);
  } catch (error) {
    // The CLI exits 1 with {"error": ...} on stdout; execFile rejects but keeps stdout on the error.
    const stdout = (error as { stdout?: string }).stdout ?? "";
    parsed = stdout.trim()
      ? parseForkOutput(stdout)
      : { error: error instanceof Error ? error.message.slice(0, 300) : String(error) };
  }
  const errorText = parsed.error ?? null;
  const ok = !errorText && (dryRun || Boolean(parsed.agent_id));
  const title = parsed.title ?? null;
  return {
    ok,
    dryRun,
    agentId: parsed.agent_id ?? null,
    sourceAgentId: parsed.source_agent_id ?? input.agentId,
    conversationId: parsed.conversation_id ?? null,
    sourceConversationId: parsed.source_conversation_id ?? null,
    title,
    stepsCopied: typeof parsed.steps_kept === "number" ? parsed.steps_kept : null,
    message: ok
      ? dryRun
        ? `Ready to fork conversation ${String(parsed.source_conversation_id ?? "").slice(0, 8)}`
        : `Forked into "${title ?? "new session"}"`
      : `Fork failed: ${errorText ?? "no agent was created"}`,
    error: ok ? null : (errorText ?? "no agent was created"),
    durationMs: Date.now() - started,
  };
}
