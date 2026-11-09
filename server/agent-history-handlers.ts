import type { RpcInput } from "@getpaseo/plugin";
import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  AgentHistoryTargetReceipt,
  CustomizeItem,
  FlatSubagentNode,
  PaseoRecoveryAgentItem,
  SessionLineageNode,
  SlashDryRunResolution,
  SubagentAgentTree,
  SubagentTimelineItem,
  SubagentTimerOrTaskNode,
  WritebackReplayEvent,
  manageAgentHistoryRpc,
  manageSessionLineageRpc,
  manageSlashSkillsRpc,
  manageSubagentsRpc,
  manageWritebackHookRpc,
  reconcilePaseoRecoveryRpc,
} from "../shared/contracts";
import { getRecentActionLogs } from "./handlers";

const APP_SESSION_TS =
  "/Applications/Paseo.app/Contents/Resources/builtin-plugins/antigravity-provider/server/internal/session.ts";
const CLI_SESSION_TS =
  "/opt/homebrew/lib/node_modules/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/builtin-plugins/antigravity-provider/server/internal/session.ts";
const ANTIGRAVITY_OPS_BIN = path.join(os.homedir(), ".local", "bin", "antigravity-ops");
const WEBHOOK_HUB_BIN =
  process.env.WEBHOOK_HUB_BIN || path.join(os.homedir(), ".local", "bin", "webhook-hub");

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
        content.includes("vecReadTranscript") &&
        content.includes("vecGlobalSlashSkills") &&
        content.includes("vecFinalizeDriverPrompt")
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
  let configSummary = "history_replay=on · settle_answered_errors=on · slash=on (inline+global skills)";
  try {
    const rawCfg = JSON.parse(await fs.readFile(cfgPath, "utf8")) as Record<string, unknown>;
    configSummary = `history_replay=${String(rawCfg.history_replay ?? "on")} · settle=${String(
      rawCfg.settle_answered_errors ?? "on",
    )} · slash=${String(rawCfg.slash_commands ?? "on")} (global+inline skills) · max=${String(
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
    details: `App=${appPatched ? "PATCHED (v1+vault+slash-skills)" : "UNPATCHED"} · CLI=${
      cliPatched ? "PATCHED (v1+vault+slash-skills)" : "UNPATCHED"
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
        await execCommand(ANTIGRAVITY_OPS_BIN, ["slash", "sync", "--json"], {
          timeout: 30_000,
          env: { ...process.env, VEC_PASEO_NO_RESTART: "1" },
        });
        actionsTaken.push(
          "Synced global/workspace slash skills, synced/*/* symlinks & inline /skill expansion (slash sync)",
        );
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

  let slashProbeDetail = "";
  if (qWs.includes("/") && (await fileExists(ANTIGRAVITY_OPS_BIN))) {
    try {
      const slashRes = await execCommand(
        ANTIGRAVITY_OPS_BIN,
        ["slash", "test", qWs, "--json"],
        { timeout: 15_000, env: { ...process.env, VEC_PASEO_NO_RESTART: "1" } },
      );
      const parsedSlash = JSON.parse(slashRes.stdout || "{}") as {
        summary?: { total_advertised?: number; inline_autocomplete_count?: number };
        dry_run?: { detected_tokens?: string[]; expanded_count?: number; total_injected_chars?: number };
      };
      const adv = parsedSlash.summary?.total_advertised ?? 0;
      const inl = parsedSlash.summary?.inline_autocomplete_count ?? 0;
      const toks = (parsedSlash.dry_run?.detected_tokens ?? []).join(", ");
      const exp = parsedSlash.dry_run?.expanded_count ?? 0;
      const chars = parsedSlash.dry_run?.total_injected_chars ?? 0;
      slashProbeDetail = ` · slashProbe=[${toks} -> ${exp} expanded (${chars} chars) | catalog=${adv} (${inl} inline)]`;
      actionsTaken.push(
        `Slash Skill Dry-Run: ${toks || "(none)"} -> ${exp} expanded (${chars} chars injected, ${adv} skills in catalog)`,
      );
    } catch {
      // Ignore
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
      } · shelf_tp=${shelfTranscriptExists ? "OK" : "MISSING"} · lines=${transcriptLines}${slashProbeDetail}`,
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

export async function handleManageSlashSkills(
  input: RpcInput<typeof manageSlashSkillsRpc>,
  _context: PluginHandlerContext,
) {
  const startMs = Date.now();
  const action = input.action ?? "status";
  const args = ["slash", action, "--json"];
  if (input.samplePrompt && input.samplePrompt.trim()) {
    args.push(input.samplePrompt.trim());
  }
  if (input.slug && input.slug.trim()) {
    args.push("--slug", input.slug.trim());
  }
  if (input.category && input.category !== "all") {
    args.push("--category", input.category);
  }
  if (input.scope && input.scope !== "all") {
    args.push("--scope", input.scope);
  }
  if (input.query && input.query.trim()) {
    args.push("--query", input.query.trim());
  }
  if (input.cwd && input.cwd.trim()) {
    args.push("--cwd", input.cwd.trim());
  }
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
    args.push("--limit", String(Math.min(1000, Math.max(1, Math.floor(input.limit)))));
  } else {
    args.push("--limit", "150");
  }

  try {
    const res = await execCommand(ANTIGRAVITY_OPS_BIN, args, {
      timeout: 35_000,
      env: { ...process.env, VEC_PASEO_NO_RESTART: "1" },
    });
    const parsed = JSON.parse(res.stdout || "{}") as Record<string, unknown>;
    const summary = (parsed.summary ?? {}) as Record<string, unknown>;
    const synced = (parsed.synced_skills ?? {}) as Record<string, unknown>;
    const counts = (parsed.customize_counts ?? {}) as Record<string, unknown>;
    const dryRun = (parsed.dry_run ?? {}) as Record<string, unknown>;
    const actions = Array.isArray(parsed.actions) ? (parsed.actions as string[]) : [];
    const totalAdvertised = Number(summary.total_advertised ?? 0);
    const inlineCount = Number(summary.inline_autocomplete_count ?? 0);
    const pinnedCount = Number(summary.pinned_count ?? 0);
    const durationMs = Date.now() - startMs;

    const message =
      actions.length > 0
        ? `Customize: ${actions.join(" · ")} (${totalAdvertised} active · ${pinnedCount} pinned)`
        : `Customize Inventory: ${totalAdvertised} slash commands & skills active (${inlineCount} inline /skill ready · ${pinnedCount} pinned)`;

    return {
      ok: Boolean(parsed.ok ?? true),
      action,
      slashCommandsMode: String(parsed.slash_commands_mode ?? "on"),
      configSource: String(parsed.config_source ?? "defaults"),
      pinnedSlashCommands: Array.isArray(parsed.pinned_slash_commands)
        ? (parsed.pinned_slash_commands as string[])
        : [],
      disabledSlashCommands: Array.isArray(parsed.disabled_slash_commands)
        ? (parsed.disabled_slash_commands as string[])
        : [],
      totalAdvertised,
      builtinCount: Number(summary.builtin_count ?? 12),
      skillCount: Number(summary.skill_count ?? 0),
      inlineAutocompleteCount: inlineCount,
      pinnedCount,
      disabledCount: Number(summary.disabled_count ?? 0),
      syncedSkillsCount: Number(synced.count ?? 0),
      syncedSkillsAllLinked: Boolean(synced.all_linked ?? true),
      customizeCounts: {
        all: Number(counts.all ?? 0),
        commands: Number(counts.commands ?? 0),
        skills: Number(counts.skills ?? 0),
        rules: Number(counts.rules ?? 0),
        subagents: Number(counts.subagents ?? 0),
        mcps: Number(counts.mcps ?? 0),
        plugins: Number(counts.plugins ?? 0),
        pinned: Number(counts.pinned ?? 0),
        disabled: Number(counts.disabled ?? 0),
        workspace: Number(counts.workspace ?? 0),
      },
      customizeItems: Array.isArray(parsed.customize_items)
        ? (parsed.customize_items.map((raw) => {
            const r = (raw ?? {}) as Record<string, unknown>;
            return {
              name: String(r.name ?? ""),
              category: String(r.category ?? "skills"),
              kind: String(r.kind ?? "skill"),
              scope: String(r.scope ?? "user"),
              source: String(r.source ?? "global"),
              path: typeof r.path === "string" ? r.path : null,
              description: String(r.description ?? ""),
              pinned: Boolean(r.pinned),
              enabled: Boolean(r.enabled ?? true),
              inline_autocomplete: Boolean(r.inline_autocomplete),
            };
          }) as CustomizeItem[])
        : [],
      dryRun: {
        samplePrompt: String(dryRun.sample_prompt ?? ""),
        detectedTokens: Array.isArray(dryRun.detected_tokens)
          ? (dryRun.detected_tokens as string[])
          : [],
        expandedCount: Number(dryRun.expanded_count ?? 0),
        totalInjectedChars: Number(dryRun.total_injected_chars ?? 0),
        budgetCapChars: Number(dryRun.budget_cap_chars ?? 48000),
        perSkillBudgetChars: Number(dryRun.per_skill_budget_chars ?? 6000),
        resolutions: Array.isArray(dryRun.resolutions)
          ? (dryRun.resolutions.map((raw) => {
              const r = (raw ?? {}) as Record<string, unknown>;
              return {
                token: String(r.token ?? ""),
                slug: String(r.slug ?? ""),
                status: String(r.status ?? ""),
                mode: String(r.mode ?? ""),
                path: typeof r.path === "string" ? r.path : null,
                injected_chars: Number(r.injected_chars ?? 0),
              };
            }) as SlashDryRunResolution[])
          : [],
      },
      actions,
      message,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      action,
      slashCommandsMode: "on",
      configSource: "error",
      pinnedSlashCommands: [],
      disabledSlashCommands: [],
      totalAdvertised: 0,
      builtinCount: 0,
      skillCount: 0,
      inlineAutocompleteCount: 0,
      pinnedCount: 0,
      disabledCount: 0,
      syncedSkillsCount: 0,
      syncedSkillsAllLinked: false,
      customizeCounts: {
        all: 0,
        commands: 0,
        skills: 0,
        rules: 0,
        subagents: 0,
        mcps: 0,
        plugins: 0,
        pinned: 0,
        disabled: 0,
        workspace: 0,
      },
      customizeItems: [],
      dryRun: {
        samplePrompt: "",
        detectedTokens: [],
        expandedCount: 0,
        totalInjectedChars: 0,
        budgetCapChars: 48000,
        perSkillBudgetChars: 6000,
        resolutions: [],
      },
      actions: [],
      message: `Customize reconciler error: ${errMsg}`,
      durationMs,
    };
  }
}

export async function handleManageWritebackHook(
  input: RpcInput<typeof manageWritebackHookRpc>,
  _context: PluginHandlerContext,
) {
  const startMs = Date.now();
  const action = input.action ?? "status";

  try {
    let statusRaw: Record<string, unknown> = {};
    let replayData: {
      conversationId: string;
      totalStopPoints: number;
      legacyV1BlockCount: number;
      v2BlockCount: number;
      falseBlocksEliminated: number;
      events: WritebackReplayEvent[];
    } | null = null;

    if (action === "tune") {
      const tuneArgs = ["writeback-hook", "tune", "--json"];
      if (typeof input.enabled === "boolean") {
        tuneArgs.push("--enabled", String(input.enabled));
      }
      if (typeof input.maxBlocksPerTurn === "number") {
        tuneArgs.push("--max-blocks-per-turn", String(input.maxBlocksPerTurn));
      }
      if (typeof input.requireFullyIdle === "boolean") {
        tuneArgs.push("--require-fully-idle", String(input.requireFullyIdle));
      }
      if (typeof input.transcriptTailFallback === "boolean") {
        tuneArgs.push("--transcript-tail-fallback", String(input.transcriptTailFallback));
      }
      const res = await execCommand(ANTIGRAVITY_OPS_BIN, tuneArgs, { timeout: 15_000 });
      statusRaw = JSON.parse(res.stdout || "{}") as Record<string, unknown>;
    } else if (action === "reset") {
      const resetArgs = ["writeback-hook", "reset", "--json"];
      if (input.clearMarkers !== false) {
        resetArgs.push("--clear-markers");
      }
      if (input.clearAudit) {
        resetArgs.push("--clear-audit");
      }
      const res = await execCommand(ANTIGRAVITY_OPS_BIN, resetArgs, { timeout: 15_000 });
      statusRaw = JSON.parse(res.stdout || "{}") as Record<string, unknown>;
    } else {
      const res = await execCommand(
        ANTIGRAVITY_OPS_BIN,
        ["writeback-hook", "status", "--json", "--limit", "30"],
        { timeout: 15_000 },
      );
      statusRaw = JSON.parse(res.stdout || "{}") as Record<string, unknown>;
    }

    if (action === "simulate" || (input.conversationId && input.conversationId.trim())) {
      const cid = (input.conversationId || "4886f126-34b5-4dea-b6dd-01685971fb77").trim();
      const simRes = await execCommand(
        ANTIGRAVITY_OPS_BIN,
        [
          "writeback-hook",
          "simulate",
          "--conversation-id",
          cid,
          "--replay-transcript",
          "--json",
        ],
        { timeout: 20_000 },
      );
      const simParsed = JSON.parse(simRes.stdout || "{}") as Record<string, unknown>;
      if (simParsed.mode === "replay_transcript") {
        const rawEvents = Array.isArray(simParsed.events) ? simParsed.events : [];
        replayData = {
          conversationId: String(simParsed.conversation_id ?? cid),
          totalStopPoints: Number(simParsed.total_stop_points ?? rawEvents.length),
          legacyV1BlockCount: Number(simParsed.legacy_v1_block_count ?? 0),
          v2BlockCount: Number(simParsed.v2_block_count ?? 0),
          falseBlocksEliminated: Number(simParsed.false_blocks_eliminated ?? 0),
          events: rawEvents.map((ev) => {
            const r = (ev ?? {}) as Record<string, unknown>;
            return {
              line: Number(r.line ?? 0),
              stepIndex: typeof r.step_index === "number" ? r.step_index : null,
              fullyIdle: Boolean(r.fully_idle ?? true),
              executionNum: Number(r.execution_num ?? 1),
              hasWritebackLine: Boolean(r.has_writeback_line ?? false),
              recordedHookBlockedInTranscript: Boolean(
                r.recorded_hook_blocked_in_transcript ?? false,
              ),
              legacyV1Decision: String(r.legacy_v1_decision ?? "allow"),
              legacyV1Reason: String(r.legacy_v1_reason ?? ""),
              v2Decision: String(r.v2_decision ?? "allow"),
              v2Reason: String(r.v2_reason ?? ""),
              preview: String(r.preview ?? ""),
            };
          }),
        };
      }
    }

    const cfg = (statusRaw.config ?? {}) as Record<string, unknown>;
    const hooksJson = (statusRaw.hooks_json ?? {}) as Record<string, unknown>;
    const stats = (statusRaw.stats ?? {}) as Record<string, unknown>;
    const activeMarkers = Array.isArray(statusRaw.active_markers)
      ? statusRaw.active_markers
      : [];
    const byReasonRaw = (stats.by_reason_code ?? {}) as Record<string, unknown>;
    const auditByReason: Record<string, number> = {};
    for (const [k, v] of Object.entries(byReasonRaw)) {
      auditByReason[k] = Number(v ?? 0);
    }

    const durationMs = Date.now() - startMs;
    const msg = replayData
      ? `Stop Hook v${String(statusRaw.hook_version ?? "2.0.0")} replay (${replayData.conversationId.slice(0, 8)}): v1 blocked ${replayData.legacyV1BlockCount}x → v2 blocked ${replayData.v2BlockCount}x (${replayData.falseBlocksEliminated} false blocks eliminated)`
      : `Stop Hook v${String(statusRaw.hook_version ?? "2.0.0")} (${String(cfg.source ?? "default")}): enabled=${String(cfg.enabled ?? true)} · maxBlocks=${String(cfg.max_blocks_per_turn ?? 1)} · fullyIdleGuard=${String(cfg.require_fully_idle ?? true)} · tailFallback=${String(cfg.transcript_tail_fallback ?? true)}`;

    return {
      ok: Boolean(statusRaw.ok ?? true),
      action,
      hookVersion: String(statusRaw.hook_version ?? "2.0.0"),
      configSource: String(cfg.source ?? "default"),
      enabled: Boolean(cfg.enabled ?? true),
      maxBlocksPerTurn: Number(cfg.max_blocks_per_turn ?? 1),
      requireFullyIdle: Boolean(cfg.require_fully_idle ?? true),
      transcriptTailFallback: Boolean(cfg.transcript_tail_fallback ?? true),
      stopHookEnabledInHooksJson: Boolean(hooksJson.stop_enabled ?? true),
      turnMarkerEnabledInHooksJson: Boolean(hooksJson.turn_marker_enabled ?? true),
      activeMarkersCount: activeMarkers.length,
      auditSampleSize: Number(stats.sample_size ?? 0),
      auditAllowCount: Number(stats.allow_count ?? 0),
      auditBlockCount: Number(stats.block_count ?? 0),
      auditByReason,
      replay: replayData,
      message: msg,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      action,
      hookVersion: "2.0.0",
      configSource: "error",
      enabled: true,
      maxBlocksPerTurn: 1,
      requireFullyIdle: true,
      transcriptTailFallback: true,
      stopHookEnabledInHooksJson: true,
      turnMarkerEnabledInHooksJson: true,
      activeMarkersCount: 0,
      auditSampleSize: 0,
      auditAllowCount: 0,
      auditBlockCount: 0,
      auditByReason: {},
      replay: null,
      message: `Writeback hook reconciler error: ${errMsg}`,
      durationMs,
    };
  }
}

function normalizeTimelineItems(rawItems: unknown): SubagentTimelineItem[] {
  if (!Array.isArray(rawItems)) return [];
  const out: SubagentTimelineItem[] = [];
  for (const r of rawItems) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    const rawType = String(obj.type ?? "assistant_message");
    const type: "user_message" | "assistant_message" | "tool_call" =
      rawType === "user_message" || rawType === "tool_call" ? rawType : "assistant_message";
    out.push({
      id: String(obj.id ?? ""),
      stepIndex: Number(obj.stepIndex ?? 0),
      type,
      name: typeof obj.name === "string" ? obj.name : undefined,
      summary: typeof obj.summary === "string" ? obj.summary : undefined,
      text: typeof obj.text === "string" ? obj.text : undefined,
      sender: typeof obj.sender === "string" ? obj.sender : undefined,
      childConversationId:
        typeof obj.childConversationId === "string" ? obj.childConversationId : null,
      subAgentType: typeof obj.subAgentType === "string" ? obj.subAgentType : null,
      timestamp: typeof obj.timestamp === "string" ? obj.timestamp : null,
    });
  }
  return out;
}

function normalizeTimersAndTasks(rawItems: unknown): SubagentTimerOrTaskNode[] {
  if (!Array.isArray(rawItems)) return [];
  const out: SubagentTimerOrTaskNode[] = [];
  for (const r of rawItems) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    const rawKind = String(obj.kind ?? "timer");
    const kind: "timer" | "background_task" =
      rawKind === "background_task" ? "background_task" : "timer";
    const rawSt = String(obj.status ?? "completed");
    const status: "running" | "completed" | "canceled" =
      rawSt === "running" || rawSt === "canceled" ? rawSt : "completed";
    out.push({
      id: String(obj.id ?? ""),
      taskId: String(obj.taskId ?? ""),
      kind,
      stepIndex: Number(obj.stepIndex ?? 0),
      durationSeconds: typeof obj.durationSeconds === "number" ? obj.durationSeconds : null,
      cronExpression: typeof obj.cronExpression === "string" ? obj.cronExpression : null,
      timerCondition: typeof obj.timerCondition === "string" ? obj.timerCondition : null,
      prompt: String(obj.prompt ?? ""),
      status,
      timestamp: typeof obj.timestamp === "string" ? obj.timestamp : null,
    });
  }
  return out;
}

function normalizeFlatSubagentNode(raw: unknown): FlatSubagentNode | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  const rawStatus = String(n.status ?? "completed");
  const status: "running" | "completed" | "failed" =
    rawStatus === "running" || rawStatus === "failed" ? rawStatus : "completed";
  return {
    conversationId: String(n.conversationId ?? ""),
    parentConversationId: String(n.parentConversationId ?? ""),
    depth: Number(n.depth ?? 1),
    toolCallId: typeof n.toolCallId === "string" ? n.toolCallId : null,
    stepIndex: typeof n.stepIndex === "number" ? n.stepIndex : null,
    subAgentType: String(n.subAgentType ?? "subagent"),
    role: String(n.role ?? ""),
    promptPreview: String(n.promptPreview ?? n.firstPromptPreview ?? ""),
    status,
    badge: String(n.badge ?? `[${status === "running" ? "Running" : status === "failed" ? "Failed" : "Done"}]`),
    stepCount: Number(n.stepCount ?? 0),
    toolCallCount: Number(n.toolCallCount ?? 0),
    lastToolName: String(n.lastToolName ?? ""),
    lastMessagePreview: String(n.lastMessagePreview ?? ""),
    lastErrorText: String(n.lastErrorText ?? ""),
    updatedAt: String(n.updatedAt ?? ""),
    mtimeAgeSeconds: Number(n.mtimeAgeSeconds ?? 0),
    transcriptPath: String(n.transcriptPath ?? ""),
    nestedSubagentCount: Number(n.nestedSubagentCount ?? 0),
    nestedRunningCount: Number(n.nestedRunningCount ?? 0),
    timersAndTasks: normalizeTimersAndTasks(n.timersAndTasks),
    timeline: normalizeTimelineItems(n.timeline),
  };
}

export async function handleManageSubagents(
  input: RpcInput<typeof manageSubagentsRpc>,
  _context: PluginHandlerContext,
) {
  const startMs = Date.now();
  const action = input.action ?? "status";
  try {
    const cliArgs = ["subagents", action, "--json"];
    if (input.agentId && input.agentId.trim()) {
      cliArgs.push("--agent", input.agentId.trim());
    }
    if (input.workspaceId && input.workspaceId.trim()) {
      cliArgs.push("--workspace", input.workspaceId.trim());
    }
    if (input.conversationId && input.conversationId.trim()) {
      cliArgs.push("--cid", input.conversationId.trim());
    }
    if (input.includeTimeline || action === "inspect" || action === "timeline") {
      cliArgs.push("--timeline");
    }
    if (typeof input.limit === "number") {
      cliArgs.push("--limit", String(input.limit));
    }

    const res = await execCommand(ANTIGRAVITY_OPS_BIN, cliArgs, { timeout: 20_000 });
    const parsed = JSON.parse(res.stdout || "{}") as Record<string, unknown>;
    const summaryRaw = (parsed.summary ?? {}) as Record<string, unknown>;
    const rawTrees = Array.isArray(parsed.trees) ? parsed.trees : [];
    const trees: SubagentAgentTree[] = rawTrees.map((t) => {
      const tr = (t ?? {}) as Record<string, unknown>;
      const subSum = (tr.subagentSummary ?? {}) as Record<string, unknown>;
      const rawFlat = Array.isArray(tr.flatSubagents) ? tr.flatSubagents : [];
      const flatSubagents: FlatSubagentNode[] = [];
      for (const item of rawFlat) {
        const norm = normalizeFlatSubagentNode(item);
        if (norm) flatSubagents.push(norm);
      }
      return {
        agentId: String(tr.agentId ?? ""),
        workspaceId: String(tr.workspaceId ?? ""),
        workspaceName: String(tr.workspaceName ?? ""),
        title: String(tr.title ?? ""),
        cwd: String(tr.cwd ?? ""),
        model: String(tr.model ?? "default"),
        agentStatus: String(tr.agentStatus ?? "idle"),
        archived: Boolean(tr.archived ?? false),
        rootConversationId: String(tr.rootConversationId ?? ""),
        rootStepCount: Number(tr.rootStepCount ?? 0),
        rootToolCallCount: Number(tr.rootToolCallCount ?? 0),
        rootLastMessagePreview: String(tr.rootLastMessagePreview ?? ""),
        rootTimersAndTasks: normalizeTimersAndTasks(tr.rootTimersAndTasks),
        updatedAt: String(tr.updatedAt ?? ""),
        subagentSummary: {
          total: Number(subSum.total ?? flatSubagents.length),
          running: Number(subSum.running ?? 0),
          completed: Number(subSum.completed ?? 0),
          failed: Number(subSum.failed ?? 0),
          maxDepth: Number(subSum.maxDepth ?? 0),
          totalSubagentSteps: Number(subSum.totalSubagentSteps ?? 0),
        },
        flatSubagents,
        rootTimeline: normalizeTimelineItems(tr.rootTimeline),
      };
    });

    const singleConversation = normalizeFlatSubagentNode(
      parsed.singleConversation ?? parsed.focusedConversation,
    );
    const totalSubagents = Number(summaryRaw.totalSubagents ?? 0);
    const runningSubagents = Number(summaryRaw.runningSubagents ?? 0);
    const completedSubagents = Number(summaryRaw.completedSubagents ?? 0);
    const failedSubagents = Number(summaryRaw.failedSubagents ?? 0);
    const durationMs = Date.now() - startMs;

    return {
      ok: Boolean(parsed.ok ?? true),
      action,
      targetAgentId: typeof parsed.targetAgentId === "string" ? parsed.targetAgentId : null,
      targetWorkspaceId:
        typeof parsed.targetWorkspaceId === "string" ? parsed.targetWorkspaceId : null,
      targetConversationId:
        typeof parsed.targetConversationId === "string" ? parsed.targetConversationId : null,
      summary: {
        agentsWithSubagents: Number(summaryRaw.agentsWithSubagents ?? trees.length),
        totalSubagents,
        runningSubagents,
        completedSubagents,
        failedSubagents,
      },
      trees,
      singleConversation,
      message: `Subagent Tree: ${trees.length} session(s) · ${totalSubagents} subagents (Running=${runningSubagents}, Done=${completedSubagents}, Failed=${failedSubagents})`,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      action,
      targetAgentId: input.agentId ?? null,
      targetWorkspaceId: input.workspaceId ?? null,
      targetConversationId: input.conversationId ?? null,
      summary: {
        agentsWithSubagents: 0,
        totalSubagents: 0,
        runningSubagents: 0,
        completedSubagents: 0,
        failedSubagents: 0,
      },
      trees: [],
      singleConversation: null,
      message: `Subagent inspector error: ${errMsg}`,
      durationMs,
    };
  }
}

interface FullRawWorkspaceRecord {
  workspaceId?: string;
  id?: string;
  projectId?: string;
  title?: string | null;
  displayName?: string | null;
  cwd?: string;
  archivedAt?: string | null;
  background?: boolean;
}

interface FullRawProjectRecord {
  projectId?: string;
  displayName?: string;
  customName?: string | null;
  rootPath?: string;
  archivedAt?: string | null;
}

interface FullRawAgentRecord {
  id?: string;
  workspaceId?: string;
  provider?: string;
  title?: string | null;
  cwd?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
  lastStatus?: string | null;
  labels?: Record<string, string>;
  config?: {
    model?: string;
    systemPrompt?: string;
  };
}

interface IntakeTaskStateEntry {
  page_id?: string;
  title?: string;
  brief?: string;
  report?: string;
  agent_id?: string;
  state?: string;
}

export async function handleManageSessionLineage(
  input: RpcInput<typeof manageSessionLineageRpc>,
  context: PluginHandlerContext,
) {
  const startMs = Date.now();
  const action = input.action ?? "inspect";
  const autoFixTitles = input.autoFixTitles ?? true;
  const home = os.homedir();
  const paseoDir = path.join(home, ".paseo");

  try {
    // If explicit reconcile requested, run CLI reconciler first so labels + titles are synced
    let cliReconcileRaw: Record<string, unknown> | null = null;
    if (action === "reconcile") {
      try {
        const res = await execCommand(ANTIGRAVITY_OPS_BIN, ["peers", "reconcile", "--json"], {
          timeout: 25_000,
        });
        cliReconcileRaw = JSON.parse(res.stdout || "{}") as Record<string, unknown>;
      } catch {
        // Continue with in-process inspection & title reconciliation
      }
    }

    // 1. Load projects.json & workspaces.json
    const projectsById = new Map<string, FullRawProjectRecord>();
    try {
      const projRaw = JSON.parse(
        await fs.readFile(path.join(paseoDir, "projects", "projects.json"), "utf8"),
      ) as unknown;
      if (Array.isArray(projRaw)) {
        for (const p of projRaw as FullRawProjectRecord[]) {
          if (p.projectId) projectsById.set(p.projectId, p);
        }
      }
    } catch {
      // Ignore
    }

    const workspacesById = new Map<string, FullRawWorkspaceRecord>();
    try {
      const wsRaw = JSON.parse(
        await fs.readFile(path.join(paseoDir, "projects", "workspaces.json"), "utf8"),
      ) as unknown;
      if (Array.isArray(wsRaw)) {
        for (const w of wsRaw as FullRawWorkspaceRecord[]) {
          const wsId = (w.workspaceId ?? w.id ?? "").trim();
          if (wsId) workspacesById.set(wsId, w);
        }
      }
    } catch {
      // Ignore
    }

    // 2. Load Intake state.json for brief/report/Notion links
    const intakeByAgentId = new Map<string, IntakeTaskStateEntry>();
    const intakeByBriefStem = new Map<string, IntakeTaskStateEntry>();
    try {
      const stateRaw = JSON.parse(
        await fs.readFile(path.join(paseoDir, "vec-intake", "state.json"), "utf8"),
      ) as { tasks?: Record<string, IntakeTaskStateEntry> };
      for (const [pageId, entry] of Object.entries(stateRaw.tasks ?? {})) {
        const enriched: IntakeTaskStateEntry = { ...entry, page_id: entry.page_id ?? pageId };
        if (entry.agent_id) {
          intakeByAgentId.set(entry.agent_id, enriched);
          intakeByAgentId.set(entry.agent_id.slice(0, 8), enriched);
        }
        if (entry.brief) {
          const stem = path.basename(entry.brief, path.extname(entry.brief));
          intakeByBriefStem.set(stem, enriched);
        }
      }
    } catch {
      // Ignore
    }

    // 3. Scan ~/.paseo/agents/*/*.json
    const agentsRoot = path.join(paseoDir, "agents");
    const agentsById = new Map<string, FullRawAgentRecord>();
    const agentsByShortId = new Map<string, FullRawAgentRecord[]>();
    const agentsByWorkspaceId = new Map<string, FullRawAgentRecord[]>();

    try {
      const buckets = await fs.readdir(agentsRoot, { withFileTypes: true });
      for (const bucket of buckets) {
        if (!bucket.isDirectory()) continue;
        const bPath = path.join(agentsRoot, bucket.name);
        const files = await fs.readdir(bPath);
        for (const f of files) {
          if (!f.endsWith(".json")) continue;
          try {
            const rec = JSON.parse(
              await fs.readFile(path.join(bPath, f), "utf8"),
            ) as FullRawAgentRecord;
            const aid = (rec.id ?? "").trim();
            if (!aid) continue;
            if (rec.labels?.["paseo.internal"] === "true") continue;
            const sysPrompt = rec.config?.systemPrompt ?? "";
            if (sysPrompt.includes("Generates a short title for a coding workspace")) continue;
            agentsById.set(aid, rec);
            const sid = aid.slice(0, 8);
            const shortList = agentsByShortId.get(sid) ?? [];
            shortList.push(rec);
            agentsByShortId.set(sid, shortList);
            if (!rec.archivedAt && rec.workspaceId) {
              const wsList = agentsByWorkspaceId.get(rec.workspaceId) ?? [];
              wsList.push(rec);
              agentsByWorkspaceId.set(rec.workspaceId, wsList);
            }
          } catch {
            // Ignore malformed agent json
          }
        }
      }
    } catch {
      // Ignore
    }

    // 4. Auto-reconcile any active workspace whose title is null/empty ('main') using its primary agent's title
    const renamedWorkspaces: Array<{
      workspaceId: string;
      oldDisplayName: string;
      newTitle: string;
      agentId: string;
    }> = [];
    let untitledFound = 0;

    for (const [wsId, ws] of workspacesById.entries()) {
      if (ws.archivedAt) continue;
      const curTitle = (ws.title ?? "").trim();
      if (curTitle) continue;
      const wsAgents = [...(agentsByWorkspaceId.get(wsId) ?? [])].sort((a, b) =>
        String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
      );
      const titledAgent = wsAgents.find((a) => Boolean((a.title ?? "").trim()));
      if (!titledAgent || !titledAgent.id) continue;
      untitledFound += 1;
      const nextTitle = String(titledAgent.title ?? "").trim().slice(0, 80);
      if (autoFixTitles || action === "reconcile") {
        try {
          await context.paseo.workspaces.ref(wsId).setTitle(nextTitle);
          ws.title = nextTitle;
          ws.displayName = nextTitle;
          renamedWorkspaces.push({
            workspaceId: wsId,
            oldDisplayName: String(ws.displayName ?? "main"),
            newTitle: nextTitle,
            agentId: titledAgent.id,
          });
        } catch {
          // Ignore if workspace ref fails
        }
      }
    }

    if (cliReconcileRaw && Array.isArray(cliReconcileRaw.renamed_workspaces)) {
      for (const item of cliReconcileRaw.renamed_workspaces as Array<Record<string, unknown>>) {
        const wsId = String(item.workspace_id ?? "");
        if (wsId && !renamedWorkspaces.some((r) => r.workspaceId === wsId)) {
          renamedWorkspaces.push({
            workspaceId: wsId,
            oldDisplayName: String(item.old_display_name ?? "main"),
            newTitle: String(item.new_title ?? ""),
            agentId: String(item.agent_id ?? ""),
          });
        }
      }
    }

    const resolveAgentByIdOrPrefix = (idOrPrefix?: string | null): FullRawAgentRecord | null => {
      const needle = (idOrPrefix ?? "").trim();
      if (!needle) return null;
      const exact = agentsById.get(needle);
      if (exact) return exact;
      const byShort = agentsByShortId.get(needle.slice(0, 8));
      if (byShort && byShort.length === 1) return byShort[0];
      for (const [id, rec] of agentsById.entries()) {
        if (id.startsWith(needle)) return rec;
      }
      return null;
    };

    const resolveParentOfAgent = (rec: FullRawAgentRecord): FullRawAgentRecord | null => {
      const labels = rec.labels ?? {};
      const parentLabel = (labels["paseo.parent-agent-id"] ?? "").trim();
      if (parentLabel) {
        const found = resolveAgentByIdOrPrefix(parentLabel);
        if (found && found.id !== rec.id) return found;
      }
      const spawnedBy = (labels["spawned-by"] ?? "").trim();
      if (spawnedBy && spawnedBy !== "outside-paseo") {
        const found = resolveAgentByIdOrPrefix(spawnedBy);
        if (found && found.id !== rec.id) return found;
      }
      const parentWsId = (labels["parent-workspace"] ?? "").trim();
      if (parentWsId && parentWsId !== rec.workspaceId) {
        const parentWsAgents = [...(agentsByWorkspaceId.get(parentWsId) ?? [])].sort((a, b) =>
          String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
        );
        if (parentWsAgents[0] && parentWsAgents[0].id !== rec.id) {
          return parentWsAgents[0];
        }
      }
      return null;
    };

    const toLineageNode = async (rec: FullRawAgentRecord): Promise<SessionLineageNode> => {
      const aid = String(rec.id ?? "");
      const wsId = String(rec.workspaceId ?? "");
      const ws = workspacesById.get(wsId);
      const proj = ws?.projectId ? projectsById.get(ws.projectId) : undefined;
      const agentTitle = String(rec.title ?? "").trim() || aid.slice(0, 8);
      const workspaceTitle =
        String(ws?.title ?? "").trim() ||
        (ws?.displayName && ws.displayName !== "main" ? String(ws.displayName) : agentTitle);
      const projectName = proj
        ? String(proj.customName ?? proj.displayName ?? "").trim() || null
        : null;

      const labels = rec.labels ?? {};
      const briefStem = (labels.brief ?? "").trim();
      const intakeEntry =
        intakeByAgentId.get(aid) ??
        intakeByAgentId.get(aid.slice(0, 8)) ??
        (briefStem ? intakeByBriefStem.get(briefStem) : undefined);

      let briefPath: string | null = intakeEntry?.brief ?? null;
      let reportPath: string | null = intakeEntry?.report ?? null;
      if (!briefPath && briefStem) {
        const candidateBrief = path.join(paseoDir, "vec-intake", "briefs", `${briefStem}.md`);
        if (await fileExists(candidateBrief)) {
          briefPath = candidateBrief;
        }
      }
      if (!reportPath && briefStem) {
        const candidateReport = path.join(
          paseoDir,
          "vec-intake",
          "reports",
          `${briefStem}.report.md`,
        );
        if (await fileExists(candidateReport)) {
          reportPath = candidateReport;
        }
      }
      const reportExists = reportPath ? await fileExists(reportPath) : false;
      const notionTaskId = intakeEntry?.page_id ?? null;
      const notionUrl = notionTaskId
        ? `https://www.notion.so/${notionTaskId.replace(/-/g, "")}`
        : null;

      return {
        agentId: aid,
        shortId: aid.slice(0, 8),
        agentTitle,
        workspaceId: wsId,
        workspaceTitle,
        projectId: ws?.projectId ?? null,
        projectName,
        status: String(rec.lastStatus ?? "idle"),
        provider: String(rec.provider ?? "antigravity"),
        model: String(rec.config?.model ?? "default"),
        createdAt: rec.createdAt ?? null,
        updatedAt: rec.updatedAt ?? null,
        briefPath,
        reportPath,
        reportExists,
        notionUrl,
        notionTaskId,
      };
    };

    // 5. Resolve target current agent
    let currentAgent: FullRawAgentRecord | null = null;
    if (input.agentId && input.agentId.trim()) {
      currentAgent = resolveAgentByIdOrPrefix(input.agentId.trim());
    }
    if (!currentAgent && input.workspaceId && input.workspaceId.trim()) {
      const wsAgents = [...(agentsByWorkspaceId.get(input.workspaceId.trim()) ?? [])].sort((a, b) =>
        String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
      );
      currentAgent =
        wsAgents.find((a) => Boolean(resolveParentOfAgent(a))) ?? wsAgents[0] ?? null;
    }

    let currentNode: SessionLineageNode | null = null;
    let parentNode: SessionLineageNode | null = null;
    const childNodes: SessionLineageNode[] = [];
    const siblingNodes: SessionLineageNode[] = [];

    if (currentAgent && currentAgent.id) {
      currentNode = await toLineageNode(currentAgent);
      const parentRec = resolveParentOfAgent(currentAgent);
      if (parentRec) {
        parentNode = await toLineageNode(parentRec);
      }

      const curId = currentAgent.id;
      const curWsId = currentAgent.workspaceId ?? "";
      const rawChildren: FullRawAgentRecord[] = [];
      const rawSiblings: FullRawAgentRecord[] = [];

      for (const candidate of agentsById.values()) {
        if (!candidate.id || candidate.archivedAt) continue;
        const candWs = candidate.workspaceId ? workspacesById.get(candidate.workspaceId) : undefined;
        if (candWs?.archivedAt) continue;

        const candParent = resolveParentOfAgent(candidate);
        const candParentWs = (candidate.labels?.["parent-workspace"] ?? "").trim();
        const isChildOfCurrent =
          (candParent &&
            (candParent.id === curId ||
              (curWsId && candParent.workspaceId === curWsId && candidate.workspaceId !== curWsId))) ||
          (curWsId && candParentWs === curWsId && candidate.workspaceId !== curWsId);

        if (isChildOfCurrent && candidate.id !== curId) {
          rawChildren.push(candidate);
        } else if (
          parentRec &&
          candParent &&
          candParent.id === parentRec.id &&
          candidate.id !== curId
        ) {
          rawSiblings.push(candidate);
        }
      }

      rawChildren.sort((a, b) =>
        String(b.updatedAt ?? b.createdAt ?? "").localeCompare(
          String(a.updatedAt ?? a.createdAt ?? ""),
        ),
      );
      rawSiblings.sort((a, b) =>
        String(b.updatedAt ?? b.createdAt ?? "").localeCompare(
          String(a.updatedAt ?? a.createdAt ?? ""),
        ),
      );

      for (const ch of rawChildren.slice(0, 24)) {
        childNodes.push(await toLineageNode(ch));
      }
      for (const sb of rawSiblings.slice(0, 12)) {
        siblingNodes.push(await toLineageNode(sb));
      }
    }

    const durationMs = Date.now() - startMs;
    const unlinkedFound = Number(cliReconcileRaw?.unlinked_found ?? 0);
    const linkedCount = Number(cliReconcileRaw?.linked_count ?? 0);

    return {
      ok: true,
      action,
      current: currentNode,
      parent: parentNode,
      siblings: siblingNodes,
      children: childNodes,
      reconcileSummary: {
        untitledFound: Math.max(untitledFound, renamedWorkspaces.length),
        renamedCount: renamedWorkspaces.length,
        unlinkedFound,
        linkedCount,
        renamedWorkspaces,
      },
      message:
        renamedWorkspaces.length > 0 || linkedCount > 0
          ? `已同步 ${renamedWorkspaces.length} 个侧边栏工作区标题，关联 ${linkedCount} 个派生会话链路`
          : currentNode
            ? `会话血缘: 父会话=${parentNode ? parentNode.workspaceTitle : "无"} · 派生子会话=${childNodes.length}`
            : "会话血缘检查完成",
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      action,
      current: null,
      parent: null,
      siblings: [],
      children: [],
      reconcileSummary: {
        untitledFound: 0,
        renamedCount: 0,
        unlinkedFound: 0,
        linkedCount: 0,
        renamedWorkspaces: [],
      },
      message: `Session lineage error: ${errMsg}`,
      durationMs,
    };
  }
}
