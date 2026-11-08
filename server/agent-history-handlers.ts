import type { RpcInput } from "@getpaseo/plugin";
import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  AgentHistoryTargetReceipt,
  PaseoRecoveryAgentItem,
  manageAgentHistoryRpc,
  reconcilePaseoRecoveryRpc,
} from "../shared/contracts";
import { getRecentActionLogs } from "./handlers";

const APP_SESSION_TS =
  "/Applications/Paseo.app/Contents/Resources/builtin-plugins/antigravity-provider/server/internal/session.ts";
const CLI_SESSION_TS =
  "/opt/homebrew/lib/node_modules/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/builtin-plugins/antigravity-provider/server/internal/session.ts";
const ANTIGRAVITY_OPS_BIN = path.join(os.homedir(), ".local", "bin", "antigravity-ops");
const WEBHOOK_HUB_BIN =
  "/Users/vecsatfoxmailcom/Documents/A-coding/26.09.08-antigravity-webhook-hub/bin/webhook-hub";

interface RawWorkspaceRecord {
  workspaceId?: string;
  id?: string;
  name?: string;
  title?: string | null;
  archivedAt?: string | null;
  pinnedAt?: string | null;
  background?: boolean;
  updatedAt?: string | null;
}

interface RawAgentRecord {
  id?: string;
  workspaceId?: string;
  provider?: string;
  title?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  updatedAt?: string | null;
  lastActivityAt?: string | null;
  persistence?: {
    sessionId?: string;
  };
  config?: {
    systemPrompt?: string;
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(targetPath: string): Promise<number> {
  try {
    const st = await fs.stat(targetPath);
    return st.size;
  } catch {
    return 0;
  }
}

function extractConversationId(record: RawAgentRecord): string | null {
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

async function inspectSessionPatchFiles(): Promise<{
  ok: boolean;
  appPatched: boolean;
  cliPatched: boolean;
  configSummary: string;
  details: string;
}> {
  const checkFile = async (fpath: string): Promise<boolean> => {
    try {
      const content = await fs.readFile(fpath, "utf8");
      return (
        content.includes("vec-patch:session") &&
        content.includes("vecReplayHistory") &&
        content.includes("vecPrepareConversation") &&
        content.includes("vecReadTranscript")
      );
    } catch {
      return false;
    }
  };
  const [appPatched, cliPatched] = await Promise.all([
    checkFile(APP_SESSION_TS),
    checkFile(CLI_SESSION_TS),
  ]);
  const cfgPath = path.join(os.homedir(), ".config", "vec", "paseo-patches.json");
  let configSummary = "history_replay=on · settle_answered_errors=on · resume_guard=on";
  try {
    const rawCfg = JSON.parse(await fs.readFile(cfgPath, "utf8")) as Record<string, unknown>;
    configSummary = `history_replay=${String(rawCfg.history_replay ?? "on")} · settle=${String(
      rawCfg.settle_answered_errors ?? "on",
    )} · slash=${String(rawCfg.slash_commands ?? "on")} · max=${String(
      rawCfg.max_replay_messages ?? 400,
    )}`;
  } catch {
    // Use default summary
  }
  const ok = appPatched && cliPatched;
  return {
    ok,
    appPatched,
    cliPatched,
    configSummary,
    details: `App=${appPatched ? "PATCHED (v1+vault-guard)" : "UNPATCHED"} · CLI=${
      cliPatched ? "PATCHED (v1+vault-guard)" : "UNPATCHED"
    }`,
  };
}

export async function handleManageAgentHistory(
  input: RpcInput<typeof manageAgentHistoryRpc>,
  _context: PluginHandlerContext,
) {
  const startMs = Date.now();
  const action = input.action ?? "inspect";
  const home = os.homedir();
  const paseoDir = path.join(home, ".paseo");
  const cliBase = path.join(home, ".gemini", "antigravity-cli");
  const actionsTaken: string[] = [];

  // 1. Read active workspaces from ~/.paseo/projects/workspaces.json
  const workspacesPath = path.join(paseoDir, "projects", "workspaces.json");
  const activeWsMap = new Map<string, RawWorkspaceRecord>();
  try {
    const parsed = JSON.parse(await fs.readFile(workspacesPath, "utf8")) as unknown;
    const items: RawWorkspaceRecord[] = Array.isArray(parsed)
      ? (parsed as RawWorkspaceRecord[])
      : Array.isArray((parsed as { workspaces?: unknown })?.workspaces)
        ? ((parsed as { workspaces: RawWorkspaceRecord[] }).workspaces ?? [])
        : [];
    for (const w of items) {
      const wsId = (w.workspaceId ?? w.id ?? "").trim();
      if (!wsId) continue;
      if ((!w.archivedAt || w.pinnedAt) && !w.background) {
        activeWsMap.set(wsId, w);
      }
    }
  } catch {
    // Ignore unreadable workspaces.json
  }

  // 2. Scan ~/.paseo/agents/*/*.json for antigravity agents
  const agentsRoot = path.join(paseoDir, "agents");
  const agentRecords: { record: RawAgentRecord; cid: string; filePath: string }[] = [];
  try {
    const buckets = await fs.readdir(agentsRoot, { withFileTypes: true });
    for (const bucket of buckets) {
      if (!bucket.isDirectory()) continue;
      const bPath = path.join(agentsRoot, bucket.name);
      const files = await fs.readdir(bPath);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const fullPath = path.join(bPath, f);
        try {
          const rec = JSON.parse(await fs.readFile(fullPath, "utf8")) as RawAgentRecord;
          if (rec.provider !== "antigravity") continue;
          const sysPrompt = rec.config?.systemPrompt ?? "";
          if (sysPrompt.includes("Generates a short title for a coding workspace")) continue;
          const cid = extractConversationId(rec);
          if (!cid) continue;
          agentRecords.push({ record: rec, cid, filePath: fullPath });
        } catch {
          // Ignore malformed agent json
        }
      }
    }
  } catch {
    // Ignore missing agents directory
  }

  // Sort by updatedAt descending
  agentRecords.sort((a, b) => {
    const ta = Date.parse(a.record.updatedAt ?? a.record.lastActivityAt ?? "") || 0;
    const tb = Date.parse(b.record.updatedAt ?? b.record.lastActivityAt ?? "") || 0;
    return tb - ta;
  });

  // 3. Compute Vault Stats across active workspace agents
  let antigravityAgentsCount = 0;
  let healthyConversationsCount = 0;
  let missingDbCount = 0;
  let missingTranscriptCount = 0;
  let shelvedTranscriptCount = 0;
  const missingCids: string[] = [];

  for (const item of agentRecords) {
    const wsId = item.record.workspaceId ?? "";
    if (!activeWsMap.has(wsId)) continue;
    antigravityAgentsCount += 1;
    const cid = item.cid;
    const dbPath = path.join(cliBase, "conversations", `${cid}.db`);
    const brainTp = path.join(
      cliBase,
      "brain",
      cid,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    const shelfTp = path.join(
      cliBase,
      "conversation_vault",
      "transcript_shelf",
      cid,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    let [hasDb, hasBrainTp, hasShelfTp] = await Promise.all([
      fileExists(dbPath),
      fileExists(brainTp),
      fileExists(shelfTp),
    ]);
    if (!hasDb) {
      const localVaultCandidates = [
        path.join(
          cliBase,
          "conversation_vault",
          "pinned_conversations",
          "conversations",
          `${cid}.db`,
        ),
        path.join(cliBase, "conversation_vault", "conversations", `${cid}.db`),
        path.join(home, ".gemini", "antigravity", "conversations", `${cid}.db`),
      ];
      for (const cand of localVaultCandidates) {
        if (await fileExists(cand)) {
          try {
            await fs.mkdir(path.dirname(dbPath), { recursive: true });
            await fs.copyFile(cand, dbPath);
            hasDb = true;
            actionsTaken.push(`Auto-restored ${cid.slice(0, 8)}.db from local vault armor`);
          } catch {
            // Ignore
          }
          break;
        }
      }
    }
    if (hasShelfTp) shelvedTranscriptCount += 1;
    if (!hasDb) {
      missingDbCount += 1;
      missingCids.push(cid);
    }
    if (!hasBrainTp && !hasShelfTp) {
      missingTranscriptCount += 1;
    }
    if (hasDb && (hasBrainTp || hasShelfTp)) {
      healthyConversationsCount += 1;
    }
  }

  // 4. Resolve target agent for inspection / probe / heal
  const qWs = (input.workspaceId ?? "").trim();
  const qAgent = (input.agentId ?? "").trim();
  const qCid = (input.conversationId ?? "").trim();

  let matched =
    agentRecords.find(
      (x) =>
        (qCid && x.cid === qCid) ||
        (qAgent && (x.record.id === qAgent || (x.record.id ?? "").startsWith(qAgent))) ||
        (qWs &&
          (x.record.workspaceId === qWs ||
            (activeWsMap.get(x.record.workspaceId ?? "")?.name ?? "")
              .toLowerCase()
              .includes(qWs.toLowerCase()))),
    ) ??
    agentRecords.find((x) => activeWsMap.has(x.record.workspaceId ?? "")) ??
    agentRecords[0] ??
    null;

  // 5. If action === "heal", execute self-healing across local vault, GDrive restore, and antigravity-ops doctor --fix
  if (action === "heal") {
    const cidsToHeal = new Set<string>(missingCids);
    if (matched?.cid) cidsToHeal.add(matched.cid);
    if (qCid && /^[A-Za-z0-9-]+$/.test(qCid)) cidsToHeal.add(qCid);

    for (const cid of cidsToHeal) {
      const targetDb = path.join(cliBase, "conversations", `${cid}.db`);
      if (!(await fileExists(targetDb))) {
        const localCandidates = [
          path.join(
            cliBase,
            "conversation_vault",
            "pinned_conversations",
            "conversations",
            `${cid}.db`,
          ),
          path.join(cliBase, "conversation_vault", "conversations", `${cid}.db`),
          path.join(home, ".gemini", "antigravity", "conversations", `${cid}.db`),
        ];
        let copied = false;
        for (const cand of localCandidates) {
          if (await fileExists(cand)) {
            await fs.mkdir(path.dirname(targetDb), { recursive: true });
            await fs.copyFile(cand, targetDb);
            actionsTaken.push(`Restored ${cid.slice(0, 8)}.db from local vault armor`);
            copied = true;
            break;
          }
        }
        if (!copied && (await fileExists(WEBHOOK_HUB_BIN))) {
          try {
            await execCommand(
              WEBHOOK_HUB_BIN,
              ["antigravity", "restore", cid, "--root", "cli"],
              { timeout: 45_000 },
            );
            if (await fileExists(targetDb)) {
              actionsTaken.push(`Restored ${cid.slice(0, 8)}.db from Google Drive vault`);
            }
          } catch {
            // Continue
          }
        }
      }

      // Ensure transcript_shelf copy is also mirrored into brain/<cid>/.system_generated/logs/
      const brainLogs = path.join(cliBase, "brain", cid, ".system_generated", "logs");
      const shelfLogs = path.join(
        cliBase,
        "conversation_vault",
        "transcript_shelf",
        cid,
        ".system_generated",
        "logs",
      );
      if (
        !(await fileExists(path.join(brainLogs, "transcript.jsonl"))) &&
        (await fileExists(path.join(shelfLogs, "transcript.jsonl")))
      ) {
        await fs.mkdir(brainLogs, { recursive: true });
        await fs.copyFile(
          path.join(shelfLogs, "transcript.jsonl"),
          path.join(brainLogs, "transcript.jsonl"),
        );
        if (await fileExists(path.join(shelfLogs, "transcript_full.jsonl"))) {
          await fs.copyFile(
            path.join(shelfLogs, "transcript_full.jsonl"),
            path.join(brainLogs, "transcript_full.jsonl"),
          );
        }
        actionsTaken.push(`Synced shelved transcript.jsonl for ${cid.slice(0, 8)}`);
      }
    }

    // Run antigravity-ops red-dot --apply & doctor --fix (with VEC_PASEO_NO_RESTART=1)
    if (await fileExists(ANTIGRAVITY_OPS_BIN)) {
      try {
        await execCommand(ANTIGRAVITY_OPS_BIN, ["red-dot", "--apply"], {
          timeout: 25_000,
          env: { ...process.env, VEC_PASEO_NO_RESTART: "1" },
        });
        actionsTaken.push("Settled stale answered-turn error dots (red-dot --apply)");
      } catch {
        // Ignore
      }
      try {
        await execCommand(ANTIGRAVITY_OPS_BIN, ["doctor", "--fix"], {
          timeout: 45_000,
          env: { ...process.env, VEC_PASEO_NO_RESTART: "1" },
        });
        actionsTaken.push(
          "Verified & applied Paseo session.ts history replay + vault resume guards (doctor --fix)",
        );
      } catch {
        // Ignore
      }
    }
  }

  // Re-evaluate session patches & target agent after potential heal
  const sessionPatches = await inspectSessionPatchFiles();
  let targetReceipt: AgentHistoryTargetReceipt | null = null;
  if (matched) {
    const cid = matched.cid;
    const wsId = matched.record.workspaceId ?? null;
    const wsObj = wsId ? activeWsMap.get(wsId) : undefined;
    const dbPath = path.join(cliBase, "conversations", `${cid}.db`);
    const brainTp = path.join(
      cliBase,
      "brain",
      cid,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    const shelfTp = path.join(
      cliBase,
      "conversation_vault",
      "transcript_shelf",
      cid,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    const [dbExists, dbBytes, brainTranscriptExists, shelfTranscriptExists] =
      await Promise.all([
        fileExists(dbPath),
        fileSize(dbPath),
        fileExists(brainTp),
        fileExists(shelfTp),
      ]);
    let transcriptLines = 0;
    const tpToRead = brainTranscriptExists ? brainTp : shelfTranscriptExists ? shelfTp : null;
    if (tpToRead) {
      try {
        const rawTp = await fs.readFile(tpToRead, "utf8");
        transcriptLines = rawTp.split("\n").filter((l) => l.trim().length > 0).length;
      } catch {
        transcriptLines = 0;
      }
    }
    const healable = !dbExists || !brainTranscriptExists || !sessionPatches.ok;
    targetReceipt = {
      workspaceId: wsId,
      workspaceName: (wsObj?.title ?? wsObj?.name ?? matched.record.title ?? null) as
        | string
        | null,
      agentId: matched.record.id ?? null,
      conversationId: cid,
      status: matched.record.lastStatus ?? "idle",
      lastError: matched.record.lastError ?? null,
      dbExists,
      dbSizeFormatted: formatBytes(dbBytes),
      brainTranscriptExists,
      shelfTranscriptExists,
      transcriptLines,
      healable,
      healed: action === "heal" && dbExists && (brainTranscriptExists || shelfTranscriptExists),
      detail: `db=${dbExists ? formatBytes(dbBytes) : "MISSING"} · brain_tp=${
        brainTranscriptExists ? "OK" : "MISSING"
      } · shelf_tp=${shelfTranscriptExists ? "OK" : "MISSING"} · lines=${transcriptLines}`,
    };
  }

  const durationMs = Date.now() - startMs;
  const ok =
    sessionPatches.ok &&
    (targetReceipt
      ? targetReceipt.dbExists &&
        (targetReceipt.brainTranscriptExists || targetReceipt.shelfTranscriptExists)
      : missingDbCount === 0);

  const message =
    action === "heal"
      ? `Self-healed Agent History (${actionsTaken.length} actions) · Patches=${sessionPatches.details}`
      : `Agent History Reconciler: ${healthyConversationsCount}/${antigravityAgentsCount} active workspaces healthy · ${sessionPatches.details}`;

  return {
    ok,
    action,
    sessionPatches,
    vaultStats: {
      activeWorkspacesCount: activeWsMap.size,
      antigravityAgentsCount,
      healthyConversationsCount,
      missingDbCount,
      missingTranscriptCount,
      shelvedTranscriptCount,
    },
    targetAgent: targetReceipt,
    actionsTaken,
    message,
    durationMs,
    recentActions: getRecentActionLogs().slice(0, 8),
  };
}

export async function handleReconcilePaseoRecovery(
  input: RpcInput<typeof reconcilePaseoRecoveryRpc>,
  _context: PluginHandlerContext,
) {
  const startMs = Date.now();
  const action = input.action ?? "status";
  const args = ["paseo-recovery", action, "--json"];
  if (input.agentId && input.agentId.trim()) {
    args.push("--agent", input.agentId.trim());
  }
  if (typeof input.maxAgeHours === "number" && Number.isFinite(input.maxAgeHours)) {
    args.push("--max-age-hours", String(input.maxAgeHours));
  }
  if (input.prompt && input.prompt.trim()) {
    args.push("--prompt", input.prompt.trim());
  }

  try {
    const res = await execCommand(ANTIGRAVITY_OPS_BIN, args, {
      timeout: 45_000,
      env: { ...process.env, VEC_PASEO_NO_RESTART: "1" },
    });
    const parsed = JSON.parse(res.stdout || "{}") as Record<string, unknown>;
    const durationMs = Date.now() - startMs;
    const ok = Boolean(parsed.ok);
    const interruptedCount = Number(parsed.interruptedCount ?? 0);
    const healedCount = Number(parsed.healedCount ?? 0);
    const totalScanned = Number(parsed.totalScanned ?? 0);
    const message =
      action === "heal"
        ? `Auto-pulled up ${healedCount}/${interruptedCount} interrupted Paseo agent(s) (${totalScanned} scanned)`
        : action === "reset"
          ? `Reset Paseo auto-pull-up circuit breaker (${totalScanned} active agents scanned)`
          : `Startup Recovery Reconciler: ${interruptedCount} interrupted · ${healedCount} healed · ${totalScanned} scanned`;

    return {
      ok,
      action,
      resumeOnStartup: Boolean(parsed.resumeOnStartup ?? true),
      versionCacheOk: Boolean(parsed.versionCacheOk ?? true),
      catalogSingleflightOk: Boolean(parsed.catalogSingleflightOk ?? true),
      proxyHealthy: Boolean(parsed.proxyHealthy ?? true),
      daemonRunning: Boolean(parsed.daemonRunning ?? true),
      daemonStartupFailedCount: Number(parsed.daemonStartupFailedCount ?? 0),
      interruptedCount,
      healedCount,
      unhealedCount: Number(parsed.unhealedCount ?? 0),
      circuitBreakerCount: Number(parsed.circuitBreakerCount ?? 0),
      totalScanned,
      agents: Array.isArray(parsed.agents)
        ? (parsed.agents.slice(0, 20) as PaseoRecoveryAgentItem[])
        : [],
      interruptedAgents: Array.isArray(parsed.interruptedAgents)
        ? (parsed.interruptedAgents as PaseoRecoveryAgentItem[])
        : [],
      healedAgents: Array.isArray(parsed.healedAgents)
        ? (parsed.healedAgents as PaseoRecoveryAgentItem[])
        : [],
      actions: Array.isArray(parsed.actions) ? (parsed.actions as string[]) : [],
      issues: Array.isArray(parsed.issues) ? (parsed.issues as string[]) : [],
      message,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      action,
      resumeOnStartup: true,
      versionCacheOk: true,
      catalogSingleflightOk: true,
      proxyHealthy: false,
      daemonRunning: false,
      daemonStartupFailedCount: 0,
      interruptedCount: 0,
      healedCount: 0,
      unhealedCount: 0,
      circuitBreakerCount: 0,
      totalScanned: 0,
      agents: [] as PaseoRecoveryAgentItem[],
      interruptedAgents: [] as PaseoRecoveryAgentItem[],
      healedAgents: [] as PaseoRecoveryAgentItem[],
      actions: [] as string[],
      issues: [errMsg],
      message: `Paseo recovery reconciler failed: ${errMsg}`,
      durationMs,
    };
  }
}
