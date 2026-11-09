import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import {
  type ScheduleRunEntry,
  type ScheduleRunStatus,
  type ScheduleRunTimelineMessage,
  type ScheduleRunsSummary,
  type inspectScheduleRunsRpc,
  type openScheduleRunSessionRpc,
} from "../shared/schedule-runs-contracts";
import {
  normalizeDaemonListenAddress,
  resolveDaemonClientModuleHref,
} from "./handlers";

const STANDBY_MARKER_RE =
  /^\[ag-standby slug=(?<slug>[^\s\]]+)\s+sha=(?<sha>[0-9a-f]{12})\]/;

export interface DaemonScheduleBridge {
  fetchWorkspaces?(options?: { limit?: number }): Promise<{
    entries: Array<{
      id: string;
      name: string;
      title?: string | null;
      workspaceDirectory?: string | null;
    }>;
  }>;
  inspectWorkspaceRecovery?(workspaceId: string): Promise<{
    kind?: string;
    workspaceId?: string;
    workspaceName?: string | null;
    action?: string;
  }>;
  restoreWorkspace?(workspaceId: string): Promise<void>;
  fetchAgentTimeline?(
    agentId: string,
    options?: { limit?: number },
  ): Promise<{
    entries?: Array<{
      timestamp?: string | null;
      item?: {
        type?: string;
        role?: string;
        text?: string;
        message?: string;
        messageId?: string;
      };
    }>;
  }>;
  scheduleUpdate?(options: {
    id: string;
    newAgentConfig?: {
      provider?: string;
      model?: string | null;
      modeId?: string | null;
      archiveOnFinish?: boolean;
      cwd?: string;
    };
  }): Promise<unknown>;
  scheduleRunOnce?(options: { id: string }): Promise<unknown>;
}

interface RawScheduleRunOnDisk {
  id?: string;
  scheduledFor?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  status?: string;
  agentId?: string | null;
  workspaceId?: string | null;
  output?: string | null;
  error?: string | null;
}

interface RawScheduleOnDisk {
  id?: string;
  name?: string | null;
  prompt?: string | null;
  cadence?: {
    type?: string;
    expression?: string;
    timezone?: string;
  };
  target?: {
    type?: string;
    config?: {
      provider?: string;
      cwd?: string;
      modeId?: string;
      model?: string;
      archiveOnFinish?: boolean;
    };
  };
  status?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  runs?: RawScheduleRunOnDisk[];
}

function formatDurationMs(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return "-";
  }
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const totalSec = Math.round(durationMs / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function normalizeRunStatus(raw?: string | null): ScheduleRunStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "succeeded" || s === "failed" || s === "running" || s === "cancelled") {
    return s;
  }
  return "unknown";
}

function normalizeScheduleStatus(
  raw?: string | null,
): ScheduleRunsSummary["status"] {
  const s = (raw ?? "").trim().toLowerCase();
  if (
    s === "active" ||
    s === "paused" ||
    s === "expired" ||
    s === "completed"
  ) {
    return s;
  }
  return "unknown";
}

function compactPreview(raw: string, maxLen = 220): string {
  const oneLine = raw
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen - 1)}…`;
}

async function withScheduleDaemonBridge<T>(
  fn: (bridge: DaemonScheduleBridge) => Promise<T>,
  overrideBridge?: DaemonScheduleBridge,
): Promise<T> {
  if (overrideBridge) {
    return fn(overrideBridge);
  }
  const paseoDir = path.join(os.homedir(), ".paseo");
  const credRaw = await fs.readFile(
    path.join(paseoDir, "local-credential"),
    "utf-8",
  );
  const password = credRaw.trim();
  let listen = "127.0.0.1:6767";
  try {
    const cfgRaw = await fs.readFile(path.join(paseoDir, "config.json"), "utf-8");
    const cfg = JSON.parse(cfgRaw) as { daemon?: { listen?: string } };
    if (cfg.daemon?.listen) {
      listen = normalizeDaemonListenAddress(cfg.daemon.listen);
    }
  } catch {
    // Default loopback listen
  }
  const modPath = await resolveDaemonClientModuleHref(
    typeof import.meta !== "undefined" ? import.meta.url : undefined,
    paseoDir,
  );
  const { createHostClient } = (await import(modPath)) as {
    createHostClient: (
      url: string,
      opts: { clientId: string; password?: string },
    ) => DaemonScheduleBridge & { connect(): Promise<void>; close(): Promise<void> };
  };
  const client = createHostClient(`ws://${listen}/ws`, {
    clientId: `plugin-schedule-runs-${Date.now()}`,
    password,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

async function readSchedulesFromDisk(
  schedulesDir: string,
  filterScheduleId?: string,
): Promise<RawScheduleOnDisk[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(schedulesDir);
  } catch {
    return [];
  }
  const jsonFiles = entries
    .filter((f) => f.endsWith(".json"))
    .filter((f) =>
      filterScheduleId ? path.basename(f, ".json") === filterScheduleId : true,
    )
    .sort();

  const results = await Promise.all(
    jsonFiles.map(async (fileName) => {
      try {
        const raw = await fs.readFile(path.join(schedulesDir, fileName), "utf-8");
        const parsed = JSON.parse(raw) as RawScheduleOnDisk;
        if (!parsed.id) {
          parsed.id = path.basename(fileName, ".json");
        }
        return parsed;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((item): item is RawScheduleOnDisk => item !== null);
}

function msToIsoUtc(rawMs: unknown): string | null {
  const n = typeof rawMs === "number" ? rawMs : Number(String(rawMs ?? ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

async function readFallbackSidecarRuns(
  slug: string,
  sidecarDataDir: string,
  maxEvents = 25,
): Promise<RawScheduleRunOnDisk[]> {
  const eventsDir = path.join(sidecarDataDir, slug, "events");
  let files: string[] = [];
  try {
    files = await fs.readdir(eventsDir);
  } catch {
    return [];
  }
  const jsonFiles = files
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(-maxEvents);
  const runs: RawScheduleRunOnDisk[] = [];
  for (const fileName of jsonFiles) {
    try {
      const raw = JSON.parse(
        await fs.readFile(path.join(eventsDir, fileName), "utf-8"),
      ) as {
        timestampMs?: string | number;
        commandInvocationTimestampMs?: string | number;
        error?: string;
        payload?: { newConversation?: { conversationId?: string } };
      };
      const endedAt = msToIsoUtc(raw.timestampMs);
      const startedAt =
        msToIsoUtc(raw.commandInvocationTimestampMs) ?? endedAt;
      if (!startedAt) continue;
      const errText = (raw.error ?? "").trim();
      const convId = raw.payload?.newConversation?.conversationId;
      const stem = path.basename(fileName, ".json");
      runs.push({
        id: `ag-sidecar-${stem}`,
        scheduledFor: startedAt,
        startedAt,
        endedAt: endedAt && endedAt >= startedAt ? endedAt : startedAt,
        status: errText ? "failed" : "succeeded",
        agentId: null,
        workspaceId: null,
        output: errText
          ? null
          : `Antigravity Automations historical run (sidecar=${slug}${
              convId ? `, conversationId=${convId}` : ""
            })`,
        error: errText || null,
      });
    } catch {
      // Ignore corrupt event JSON
    }
  }
  return runs;
}

async function resolveProjectLastActiveByKey(
  paseoProjectsDir: string,
  summaries: ReadonlyArray<Pick<ScheduleRunsSummary, "cwd" | "lastRunAt">>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const bump = (key: string | null | undefined, iso: string | null | undefined) => {
    if (!key || !iso) return;
    const trimmedKey = key.trim();
    const trimmedIso = iso.trim();
    if (!trimmedKey || !trimmedIso) return;
    const prev = out[trimmedKey];
    if (!prev || trimmedIso > prev) {
      out[trimmedKey] = trimmedIso;
    }
  };

  let projectsList: Array<{
    projectId?: string;
    rootPath?: string;
    displayName?: string;
    projectKey?: string;
    updatedAt?: string | null;
  }> = [];
  let workspacesList: Array<{
    projectId?: string;
    cwd?: string;
    updatedAt?: string | null;
    createdAt?: string | null;
  }> = [];

  try {
    const rawProjs = await fs.readFile(
      path.join(paseoProjectsDir, "projects.json"),
      "utf-8",
    );
    const parsed = JSON.parse(rawProjs);
    if (Array.isArray(parsed)) projectsList = parsed;
  } catch {
    // Ignore when projects.json is absent
  }

  try {
    const rawWs = await fs.readFile(
      path.join(paseoProjectsDir, "workspaces.json"),
      "utf-8",
    );
    const parsed = JSON.parse(rawWs);
    if (Array.isArray(parsed)) workspacesList = parsed;
  } catch {
    // Ignore when workspaces.json is absent
  }

  const maxByProjectId = new Map<string, string>();
  const maxByRootPath = new Map<string, string>();

  for (const w of workspacesList) {
    const ts = w.updatedAt || w.createdAt || null;
    if (!ts) continue;
    if (w.projectId) {
      const prev = maxByProjectId.get(w.projectId);
      if (!prev || ts > prev) maxByProjectId.set(w.projectId, ts);
    }
    if (w.cwd) {
      const prev = maxByRootPath.get(w.cwd);
      if (!prev || ts > prev) maxByRootPath.set(w.cwd, ts);
    }
  }

  for (const s of summaries) {
    if (s.cwd && s.lastRunAt) {
      const prev = maxByRootPath.get(s.cwd);
      if (!prev || s.lastRunAt > prev) {
        maxByRootPath.set(s.cwd, s.lastRunAt);
      }
    }
  }

  for (const p of projectsList) {
    const candidates = [
      p.updatedAt ?? null,
      p.projectId ? maxByProjectId.get(p.projectId) ?? null : null,
      p.rootPath ? maxByRootPath.get(p.rootPath) ?? null : null,
    ].filter((x): x is string => Boolean(x));
    if (candidates.length === 0) continue;
    candidates.sort();
    const latest = candidates[candidates.length - 1];
    bump(p.projectKey, latest);
    bump(p.displayName, latest);
    bump(p.projectId, latest);
  }

  return out;
}

export async function handleInspectScheduleRuns(
  input: RpcInput<typeof inspectScheduleRunsRpc>,
  context: PluginHandlerContext,
  options?: {
    schedulesDir?: string;
    bridge?: DaemonScheduleBridge;
  },
) {
  const startMs = Date.now();
  const schedulesDir =
    options?.schedulesDir ?? path.join(os.homedir(), ".paseo", "schedules");
  const filterId = input.scheduleId?.trim() || undefined;
  const queryLower = (input.query ?? "").trim().toLowerCase();
  const maxRuns = input.maxRunsPerSchedule ?? 50;

  const activeWorkspacesMap = new Map<string, string>();
  try {
    const activeList = await context.paseo.workspaces.list();
    for (const w of activeList.entries) {
      activeWorkspacesMap.set(w.id, w.title || w.name || w.id);
    }
  } catch {
    // Ignore when running outside active daemon workspace context
  }

  const rawSchedules = await readSchedulesFromDisk(schedulesDir, filterId);
  const recoveryNameMap = new Map<string, { name: string | null; archived: boolean }>();

  if (input.includeWorkspaceNames || filterId) {
    const workspaceIdsToInspect = new Set<string>();
    for (const sched of rawSchedules) {
      for (const r of sched.runs ?? []) {
        if (r.workspaceId && !activeWorkspacesMap.has(r.workspaceId)) {
          workspaceIdsToInspect.add(r.workspaceId);
        }
      }
    }
    if (workspaceIdsToInspect.size > 0 && workspaceIdsToInspect.size <= 25) {
      try {
        await withScheduleDaemonBridge(async (bridge) => {
          if (!bridge.inspectWorkspaceRecovery) return;
          await Promise.all(
            Array.from(workspaceIdsToInspect).map(async (wid) => {
              try {
                const rec = await bridge.inspectWorkspaceRecovery!(wid);
                recoveryNameMap.set(wid, {
                  name: rec.workspaceName ?? null,
                  archived: rec.action === "unarchive" || rec.kind === "recoverable",
                });
              } catch {
                // Ignore individual workspace recovery lookup failures
              }
            }),
          );
        }, options?.bridge);
      } catch {
        // Fallback gracefully if daemon bridge is offline
      }
    }
  }

  const summaries: ScheduleRunsSummary[] = [];
  const allRecentRuns: ScheduleRunEntry[] = [];
  let totalRuns = 0;
  let succeededRuns = 0;
  let failedRuns = 0;
  let runningRuns = 0;
  let schedulesWithRuns = 0;
  const sidecarDataDir = path.join(
    os.homedir(),
    ".gemini",
    "antigravity",
    "sidecar_data",
  );

  for (const raw of rawSchedules) {
    const sid = raw.id ?? "unknown";
    const sname = (raw.name ?? "").trim() || sid;
    const prompt = raw.prompt ?? "";
    const standbyMatch = STANDBY_MARKER_RE.exec(prompt);
    const isStandbyTwin = Boolean(standbyMatch || sname.startsWith("AG · "));
    const standbySlug = standbyMatch?.groups?.slug ?? null;
    const cfg = raw.target?.config ?? {};
    let rawRuns = Array.isArray(raw.runs) ? raw.runs : [];
    if (rawRuns.length === 0 && standbySlug) {
      rawRuns = await readFallbackSidecarRuns(standbySlug, sidecarDataDir, maxRuns);
    }

    let schedSucceeded = 0;
    let schedFailed = 0;
    let schedRunning = 0;

    const mappedRuns: ScheduleRunEntry[] = rawRuns.map((r, idx) => {
      const status = normalizeRunStatus(r.status);
      if (status === "succeeded") {
        schedSucceeded += 1;
        succeededRuns += 1;
      } else if (status === "failed") {
        schedFailed += 1;
        failedRuns += 1;
      } else if (status === "running") {
        schedRunning += 1;
        runningRuns += 1;
      }
      totalRuns += 1;

      const startedMs = r.startedAt ? Date.parse(r.startedAt) : NaN;
      const endedMs = r.endedAt ? Date.parse(r.endedAt) : NaN;
      const durationMs =
        Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs >= startedMs
          ? endedMs - startedMs
          : null;

      const wid = r.workspaceId ?? null;
      const activeTitle = wid ? activeWorkspacesMap.get(wid) ?? null : null;
      const recoveryMeta = wid ? recoveryNameMap.get(wid) : undefined;
      const workspaceName = activeTitle ?? recoveryMeta?.name ?? null;
      const isArchived = wid
        ? !activeWorkspacesMap.has(wid) && (recoveryMeta?.archived ?? true)
        : false;
      const output = r.output ?? "";
      const errText = r.error ?? null;

      return {
        id: r.id ?? `${sid}-run-${idx + 1}`,
        scheduleId: sid,
        scheduleName: sname,
        status,
        scheduledFor: r.scheduledFor ?? null,
        startedAt: r.startedAt ?? null,
        endedAt: r.endedAt ?? null,
        durationMs,
        durationFormatted: formatDurationMs(durationMs),
        agentId: r.agentId ?? null,
        workspaceId: wid,
        workspaceName,
        isArchived,
        output,
        outputPreview: compactPreview(errText || output || `${sname} (${status})`),
        error: errText,
      };
    });

    if (mappedRuns.length > 0) {
      schedulesWithRuns += 1;
    }

    // Sort runs newest first
    mappedRuns.sort((a, b) =>
      (b.startedAt ?? b.scheduledFor ?? "").localeCompare(
        a.startedAt ?? a.scheduledFor ?? "",
      ),
    );

    for (const runEntry of mappedRuns) {
      allRecentRuns.push(runEntry);
    }

    if (input.onlyWithRuns && mappedRuns.length === 0) {
      continue;
    }

    if (queryLower) {
      const hay = [
        sid,
        sname,
        standbySlug ?? "",
        cfg.provider ?? "",
        cfg.model ?? "",
        cfg.cwd ?? "",
        ...mappedRuns.map((r) => `${r.workspaceName ?? ""} ${r.outputPreview}`),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(queryLower)) {
        continue;
      }
    }

    summaries.push({
      id: sid,
      name: sname,
      status: normalizeScheduleStatus(raw.status),
      isStandbyTwin,
      standbySlug,
      cronExpression: raw.cadence?.expression ?? "",
      timezone: raw.cadence?.timezone ?? "UTC",
      provider: cfg.provider ?? "antigravity",
      model: cfg.model ?? "default",
      modeId: cfg.modeId ?? "full-access",
      cwd: cfg.cwd ?? "",
      archiveOnFinish: cfg.archiveOnFinish !== false,
      prompt,
      promptPreview: compactPreview(
        prompt.replace(STANDBY_MARKER_RE, "").trim(),
        260,
      ),
      nextRunAt: raw.nextRunAt ?? null,
      lastRunAt:
        raw.lastRunAt ??
        mappedRuns[0]?.endedAt ??
        mappedRuns[0]?.startedAt ??
        null,
      totalRuns: mappedRuns.length,
      succeededRuns: schedSucceeded,
      failedRuns: schedFailed,
      runningRuns: schedRunning,
      lastRunStatus: mappedRuns[0]?.status ?? null,
      runs: mappedRuns.slice(0, maxRuns),
    });
  }

  // Sort schedules: those with runs first (by latest run timestamp), then active before paused
  summaries.sort((a, b) => {
    if ((a.totalRuns > 0) !== (b.totalRuns > 0)) {
      return a.totalRuns > 0 ? -1 : 1;
    }
    if (a.lastRunAt && b.lastRunAt && a.lastRunAt !== b.lastRunAt) {
      return b.lastRunAt.localeCompare(a.lastRunAt);
    }
    if (a.status !== b.status) {
      return a.status === "active" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  allRecentRuns.sort((a, b) =>
    (b.startedAt ?? b.scheduledFor ?? "").localeCompare(
      a.startedAt ?? a.scheduledFor ?? "",
    ),
  );

  const paseoProjectsDir = path.join(path.dirname(schedulesDir), "projects");
  const projectLastActiveByKey = await resolveProjectLastActiveByKey(
    paseoProjectsDir,
    summaries,
  );

  const durationMs = Date.now() - startMs;
  return {
    ok: true,
    schedulesDir,
    totalSchedules: rawSchedules.length,
    schedulesWithRuns,
    totalRuns,
    succeededRuns,
    failedRuns,
    runningRuns,
    schedules: summaries,
    recentRuns: allRecentRuns.slice(0, 50),
    projectLastActiveByKey,
    durationMs,
    message: `Inspected ${rawSchedules.length} schedules (${schedulesWithRuns} with runs, ${totalRuns} total runs) in ${durationMs}ms`,
  };
}

export async function handleOpenScheduleRunSession(
  input: RpcInput<typeof openScheduleRunSessionRpc>,
  context: PluginHandlerContext,
  options?: {
    schedulesDir?: string;
    bridge?: DaemonScheduleBridge;
    spawnDetachedRunOnce?: (scheduleId: string) => void;
  },
) {
  const startMs = Date.now();
  const action = input.action ?? "open-run";
  const schedulesDir =
    options?.schedulesDir ?? path.join(os.homedir(), ".paseo", "schedules");
  const scheduleId = input.scheduleId.trim();

  const diskList = await readSchedulesFromDisk(schedulesDir, scheduleId);
  const sched = diskList[0];
  const scheduleName = (sched?.name ?? "").trim() || scheduleId;
  const runs = Array.isArray(sched?.runs) ? sched.runs : [];

  const targetRun = input.runId
    ? runs.find((r) => r.id === input.runId) ?? runs[runs.length - 1]
    : runs[runs.length - 1];

  const resolvedRunId = targetRun?.id ?? input.runId ?? null;
  const resolvedWorkspaceId =
    input.workspaceId?.trim() || targetRun?.workspaceId || null;
  const resolvedAgentId = input.agentId?.trim() || targetRun?.agentId || null;
  const runOutput = targetRun?.output ?? "";
  const runError = targetRun?.error ?? null;

  if (action === "toggle-archive-on-finish") {
    const currentArchive = sched?.target?.config?.archiveOnFinish !== false;
    const desiredArchive =
      typeof input.archiveOnFinish === "boolean"
        ? input.archiveOnFinish
        : !currentArchive;

    if (!input.dryRun) {
      try {
        await withScheduleDaemonBridge(async (bridge) => {
          if (bridge.scheduleUpdate) {
            await bridge.scheduleUpdate({
              id: scheduleId,
              newAgentConfig: {
                provider: sched?.target?.config?.provider ?? "antigravity",
                model: sched?.target?.config?.model ?? null,
                modeId: sched?.target?.config?.modeId ?? null,
                cwd: sched?.target?.config?.cwd,
                archiveOnFinish: desiredArchive,
              },
            });
          }
        }, options?.bridge);
      } catch {
        // Fallback to direct JSON patch if daemon rejects partial update
      }
      if (sched) {
        const filePath = path.join(schedulesDir, `${scheduleId}.json`);
        try {
          const raw = JSON.parse(await fs.readFile(filePath, "utf-8"));
          raw.target = raw.target ?? { type: "new-agent", config: {} };
          raw.target.config = raw.target.config ?? {};
          raw.target.config.archiveOnFinish = desiredArchive;
          await fs.writeFile(filePath, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
        } catch {
          // Ignore if read-only in test
        }
      }
    }

    const durationMs = Date.now() - startMs;
    return {
      ok: true,
      action,
      scheduleId,
      scheduleName,
      runId: resolvedRunId,
      workspaceId: resolvedWorkspaceId,
      workspaceName: null,
      agentId: resolvedAgentId,
      unarchived: false,
      archiveOnFinish: desiredArchive,
      timelineEntries: [],
      output: runOutput,
      error: runError,
      durationMs,
      message: `Set archiveOnFinish=${desiredArchive} for schedule "${scheduleName}" (${scheduleId})`,
    };
  }

  if (action === "recover-due") {
    const scriptPath = path.join(
      os.homedir(),
      ".agents",
      "skills",
      "scheduled-task-rescheduler",
      "scripts",
      "paseo_cadence.py",
    );
    const args = ["-B", scriptPath, "recover", "--json"];
    if (!input.dryRun) {
      args.push("--execute");
    }
    if (scheduleId) {
      args.push(scheduleId);
    }
    try {
      const { stdout } = await execFileAsync("python3", args, {
        timeout: 45_000,
      }).catch((err: { stdout?: string; stderr?: string; message?: string }) => {
        if (err.stdout) return { stdout: err.stdout, stderr: err.stderr ?? "" };
        throw err;
      });
      const parsed = JSON.parse(stdout) as {
        graded?: number;
        counts?: Record<string, number>;
        due?: Array<{ schedule_id?: string; name?: string; slot?: string; detail?: string }>;
        fired?: Array<{ schedule_id?: string; name?: string; fired?: { run_id?: string } }>;
        fire_errors?: Array<{ detail?: string }>;
      };
      const dueCount = (parsed.due ?? []).length;
      const firedCount = (parsed.fired ?? []).length;
      const durationMs = Date.now() - startMs;
      return {
        ok: (parsed.fire_errors ?? []).length === 0,
        action,
        scheduleId: scheduleId || "all",
        scheduleName: scheduleId ? scheduleName : "All Active Paseo Schedules",
        runId: parsed.fired?.[0]?.fired?.run_id ?? null,
        workspaceId: null,
        workspaceName: null,
        agentId: null,
        unarchived: false,
        archiveOnFinish: null,
        timelineEntries: [],
        output: stdout,
        error: parsed.fire_errors?.[0]?.detail ?? null,
        durationMs,
        message: input.dryRun
          ? `[dry-run] Graded ${parsed.graded ?? 0} active schedules · ${dueCount} due for recovery`
          : `Recovered ${firedCount}/${dueCount} due schedule slot(s) across ${parsed.graded ?? 0} active schedules`,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startMs;
      return {
        ok: false,
        action,
        scheduleId: scheduleId || "all",
        scheduleName: scheduleId ? scheduleName : "All Active Paseo Schedules",
        runId: null,
        workspaceId: null,
        workspaceName: null,
        agentId: null,
        unarchived: false,
        archiveOnFinish: null,
        timelineEntries: [],
        output: "",
        error: errMsg,
        durationMs,
        message: `Failed running paseo_cadence.py recover: ${errMsg}`,
      };
    }
  }

  if (action === "auto-evolve") {
    const scriptPath = path.join(
      os.homedir(),
      ".agents",
      "skills",
      "scheduled-task-rescheduler",
      "scripts",
      "cadence_ctl.py",
    );
    const args = ["-B", scriptPath, "evolve-sidecars"];
    if (input.dryRun) {
      args.push("--dry-run");
    }
    if (scheduleId) {
      const slug = sched?.prompt
        ? STANDBY_MARKER_RE.exec(sched.prompt)?.groups?.slug
        : undefined;
      args.push("--slug", slug || scheduleId);
    }
    try {
      const { stdout, stderr } = await execFileAsync("python3", args, {
        timeout: 90_000,
      }).catch((err: { stdout?: string; stderr?: string; message?: string }) => {
        if (err.stdout) return { stdout: err.stdout, stderr: err.stderr ?? "" };
        throw err;
      });
      const evolvedMatch = /Evolved:\s+(\d+)/.exec(stdout);
      const scannedMatch = /Total Scanned:\s+(\d+)/.exec(stdout);
      const evolvedCount = evolvedMatch ? Number(evolvedMatch[1]) : 0;
      const scannedCount = scannedMatch ? Number(scannedMatch[1]) : 0;
      const durationMs = Date.now() - startMs;
      return {
        ok: true,
        action,
        scheduleId: scheduleId || "all",
        scheduleName: scheduleId ? scheduleName : "All Cadences & Paseo Twins",
        runId: null,
        workspaceId: null,
        workspaceName: null,
        agentId: null,
        unarchived: false,
        archiveOnFinish: null,
        timelineEntries: [],
        output: stdout || stderr,
        error: null,
        durationMs,
        message: input.dryRun
          ? `[dry-run] Scanned ${scannedCount} cadence(s) · ${evolvedCount} would auto-evolve`
          : `Auto-evolved ${evolvedCount}/${scannedCount} cadence(s) & synchronized Paseo twins`,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startMs;
      return {
        ok: false,
        action,
        scheduleId: scheduleId || "all",
        scheduleName: scheduleId ? scheduleName : "All Cadences & Paseo Twins",
        runId: null,
        workspaceId: null,
        workspaceName: null,
        agentId: null,
        unarchived: false,
        archiveOnFinish: null,
        timelineEntries: [],
        output: "",
        error: errMsg,
        durationMs,
        message: `Failed running cadence auto-evolve: ${errMsg}`,
      };
    }
  }

  if (action === "run-now") {
    if (!input.dryRun) {
      if (options?.spawnDetachedRunOnce) {
        options.spawnDetachedRunOnce(scheduleId);
      } else {
        const paseoBin = path.join(os.homedir(), ".local", "bin", "paseo");
        const child = spawn(paseoBin, ["schedule", "run-once", scheduleId, "--json"], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      }
    }
    const durationMs = Date.now() - startMs;
    return {
      ok: true,
      action,
      scheduleId,
      scheduleName,
      runId: resolvedRunId,
      workspaceId: resolvedWorkspaceId,
      workspaceName: null,
      agentId: resolvedAgentId,
      unarchived: false,
      archiveOnFinish: sched?.target?.config?.archiveOnFinish !== false,
      timelineEntries: [],
      output: runOutput,
      error: runError,
      durationMs,
      message: input.dryRun
        ? `[dry-run] Would trigger run-once for "${scheduleName}" (${scheduleId})`
        : `Triggered immediate run for "${scheduleName}" (${scheduleId})`,
    };
  }

  let workspaceName: string | null = null;
  let unarchived = false;
  const timelineEntries: ScheduleRunTimelineMessage[] = [];

  try {
    await withScheduleDaemonBridge(async (bridge) => {
      if (resolvedWorkspaceId && bridge.inspectWorkspaceRecovery) {
        try {
          const rec = await bridge.inspectWorkspaceRecovery(resolvedWorkspaceId);
          workspaceName = rec.workspaceName ?? null;
          const needsUnarchive =
            rec.action === "unarchive" || rec.kind === "recoverable";
          if (
            action === "open-run" &&
            !input.dryRun &&
            needsUnarchive &&
            bridge.restoreWorkspace
          ) {
            await bridge.restoreWorkspace(resolvedWorkspaceId);
            unarchived = true;
          }
        } catch {
          // Workspace may already be active
        }
      }

      if (resolvedAgentId && bridge.fetchAgentTimeline) {
        try {
          const tl = await bridge.fetchAgentTimeline(resolvedAgentId, {
            limit: 40,
          });
          for (const [idx, entry] of (tl.entries ?? []).entries()) {
            const item = entry.item;
            if (!item) continue;
            const text = (item.text ?? item.message ?? "").trim();
            if (!text) continue;
            const role =
              item.type === "user_message"
                ? "user"
                : item.type === "assistant_message"
                  ? "assistant"
                  : item.role ?? item.type ?? "event";
            timelineEntries.push({
              id: item.messageId ?? `tl-${idx + 1}`,
              role,
              text,
              timestamp: entry.timestamp ?? null,
            });
          }
        } catch {
          // Ignore timeline fetch error if agent snapshot is unavailable
        }
      }
    }, options?.bridge);
  } catch {
    // Fallback to on-disk run output when daemon bridge is unavailable
  }

  if (!workspaceName && resolvedWorkspaceId) {
    try {
      const list = await context.paseo.workspaces.list();
      const found = list.entries.find((w) => w.id === resolvedWorkspaceId);
      if (found) {
        workspaceName = found.title || found.name || null;
      }
    } catch {
      // Ignore
    }
  }

  const durationMs = Date.now() - startMs;
  const ok = Boolean(resolvedWorkspaceId || resolvedAgentId || runOutput || runError);
  return {
    ok,
    action,
    scheduleId,
    scheduleName,
    runId: resolvedRunId,
    workspaceId: resolvedWorkspaceId,
    workspaceName,
    agentId: resolvedAgentId,
    unarchived,
    archiveOnFinish: sched?.target?.config?.archiveOnFinish !== false,
    timelineEntries,
    output: runOutput,
    error: runError,
    durationMs,
    message: ok
      ? action === "open-run"
        ? `Ready to open run ${resolvedRunId ?? "(latest)"} in workspace ${resolvedWorkspaceId ?? "-"}${unarchived ? " (unarchived automatically)" : ""}`
        : `Loaded ${timelineEntries.length} timeline message(s) for run ${resolvedRunId ?? "(latest)"}`
      : `No recorded runs found for schedule "${scheduleName}" (${scheduleId})`,
  };
}
