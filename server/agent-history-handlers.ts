import type { RpcInput } from "@getpaseo/plugin";
import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  AgentHistoryTargetReceipt,
  CustomizeItem,
  PaseoRecoveryAgentItem,
  SlashDryRunResolution,
  WritebackReplayEvent,
  manageAgentHistoryRpc,
  manageSlashSkillsRpc,
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
