import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type {
  IntakeAnswerPreview,
  IntakeDecisionItem,
  IntakeDecisionOption,
  manageIntakeDecisionsRpc,
} from "../shared/intake-decisions-contracts";

const execFileAsync = promisify(execFile);

export type IntakeCliExec = (args: string[]) => Promise<{ stdout: string; stderr?: string }>;

export interface IntakeDecisionHandlerDeps {
  exec?: IntakeCliExec;
  homeDir?: string;
  intakeHome?: string;
}

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asString = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const asNumber = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function shortenHome(rawPath: string, homeDir: string): string {
  const root = homeDir.replace(/\/+$/, "");
  return root && rawPath.startsWith(`${root}/`) ? `~${rawPath.slice(root.length)}` : rawPath;
}

function defaultCliPath(homeDir: string): string {
  const envBin = process.env.PASEO_INTAKE_CLI;
  if (envBin && envBin.trim()) return envBin.trim();
  const localBin = path.join(homeDir, ".local", "bin", "antigravity-ops");
  return fs.existsSync(localBin) ? localBin : "antigravity-ops";
}

function createDefaultExec(homeDir: string): IntakeCliExec {
  const bin = defaultCliPath(homeDir);
  return async (args: string[]) => {
    const { stdout, stderr } = await execFileAsync(bin, ["intake", ...args], {
      timeout: 25_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: `${path.join(homeDir, ".local", "bin")}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      },
    });
    return { stdout, stderr };
  };
}

function parseJsonObject(raw: string): Json | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readJsonFile(filePath: string): Json | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return parseJsonObject(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function mapOption(raw: unknown, idx: number): IntakeDecisionOption | null {
  if (!isRecord(raw)) return null;
  const label = asString(raw.label).trim();
  if (!label) return null;
  return {
    index: asNumber(raw.index, idx + 1),
    label,
    recommended: Boolean(raw.recommended),
  };
}

function mapDecisionItem(raw: unknown, homeDir: string): IntakeDecisionItem | null {
  if (!isRecord(raw)) return null;
  const taskId = asString(raw.task_id).trim();
  const shortId = asString(raw.short_id).trim();
  if (!taskId || !shortId) return null;
  const rawOpts = Array.isArray(raw.options) ? raw.options : [];
  const options = rawOpts
    .map((o, i) => mapOption(o, i))
    .filter((o): o is IntakeDecisionOption => o !== null);
  const checkpoints = Array.isArray(raw.checkpoints)
    ? raw.checkpoints.filter((c): c is string => typeof c === "string")
    : [];
  const agentId = asString(raw.agent_id).trim() || null;
  const workspaceId = asString(raw.workspace_id).trim() || null;
  return {
    taskId,
    shortId,
    state: asString(raw.state, "blocked"),
    title: asString(raw.title),
    priority: asString(raw.priority, "Do Next"),
    kind: asString(raw.kind, "other"),
    profile: asString(raw.profile, "-"),
    agentId,
    workspaceId,
    agentLiveStatus: asString(raw.agent_live_status, agentId ? "unknown" : "missing"),
    resumable: Boolean(raw.resumable ?? Boolean(agentId)),
    decisionRounds: asNumber(raw.decision_rounds, 0),
    finishedAt: asString(raw.finished_at) || null,
    url: asString(raw.url),
    report: shortenHome(asString(raw.report), homeDir),
    summary: asString(raw.summary),
    checkpoints,
    options,
    bucket: asString(raw.bucket, "product_or_scope_decision"),
  };
}

function flattenDigestItems(digest: Json, homeDir: string): IntakeDecisionItem[] {
  const buckets = isRecord(digest.buckets) ? digest.buckets : {};
  const order = [
    "spend_or_purchase",
    "external_outreach",
    "credentials_or_auth",
    "product_or_scope_decision",
  ];
  const seen = new Set<string>();
  const out: IntakeDecisionItem[] = [];
  for (const key of order) {
    const arr = Array.isArray(buckets[key]) ? buckets[key] : [];
    for (const entry of arr) {
      const item = mapDecisionItem(entry, homeDir);
      if (item && !seen.has(item.taskId)) {
        seen.add(item.taskId);
        out.push(item);
      }
    }
  }
  for (const [key, val] of Object.entries(buckets)) {
    if (order.includes(key) || !Array.isArray(val)) continue;
    for (const entry of val) {
      const item = mapDecisionItem(entry, homeDir);
      if (item && !seen.has(item.taskId)) {
        seen.add(item.taskId);
        out.push(item);
      }
    }
  }
  return out;
}

function readLocalIntakeConfig(intakeHome: string): { maxDecisionRounds: number; maxConcurrent: number } {
  const raw = readJsonFile(path.join(intakeHome, "config.json")) ?? {};
  return {
    maxDecisionRounds: asNumber(raw.max_decision_rounds, 8),
    maxConcurrent: asNumber(raw.max_concurrent, 4),
  };
}

function digestHasStructuredOptions(digest: Json): boolean {
  const buckets = isRecord(digest.buckets) ? digest.buckets : {};
  for (const val of Object.values(buckets)) {
    if (Array.isArray(val) && val.length > 0 && isRecord(val[0])) {
      return Object.prototype.hasOwnProperty.call(val[0], "options");
    }
  }
  return true;
}

function mapPreview(raw: Json, homeDir: string): IntakeAnswerPreview {
  return {
    mode: asString(raw.mode, "unknown"),
    taskId: asString(raw.task_id),
    shortId: asString(raw.short_id),
    title: asString(raw.title),
    agentId: asString(raw.agent_id) || null,
    agentStatus: asString(raw.agent_status) || null,
    workspaceId: asString(raw.workspace_id) || null,
    profile: asString(raw.profile) || null,
    round: typeof raw.round === "number" ? raw.round : null,
    maxDecisionRounds: typeof raw.max_decision_rounds === "number" ? raw.max_decision_rounds : null,
    decisionText: asString(raw.decision_text),
    nextReport: raw.next_report ? shortenHome(asString(raw.next_report), homeDir) : null,
    promptPreview: raw.prompt_preview ? shortenHome(asString(raw.prompt_preview), homeDir) : null,
  };
}

export async function handleManageIntakeDecisions(
  input: RpcInput<typeof manageIntakeDecisionsRpc>,
  deps: IntakeDecisionHandlerDeps = {},
): Promise<RpcOutput<typeof manageIntakeDecisionsRpc>> {
  const started = Date.now();
  const homeDir = deps.homeDir ?? os.homedir();
  const intakeHome =
    deps.intakeHome ??
    process.env.PASEO_INTAKE_HOME ??
    path.join(homeDir, ".paseo", "vec-intake");
  const exec = deps.exec ?? createDefaultExec(homeDir);
  const action = input.action ?? "list";

  const loadSnapshot = async (forceRefresh: boolean): Promise<{ available: boolean; digest: Json | null }> => {
    const queueFile = path.join(intakeHome, "review_queue.json");
    if (!forceRefresh) {
      const cached = readJsonFile(queueFile);
      if (cached && digestHasStructuredOptions(cached)) {
        return { available: true, digest: cached };
      }
    }
    try {
      const { stdout } = await exec(["review", "--json"]);
      const fresh = parseJsonObject(stdout);
      if (fresh) return { available: true, digest: fresh };
    } catch {
      const fallback = readJsonFile(queueFile);
      if (fallback) return { available: true, digest: fallback };
    }
    return { available: fs.existsSync(intakeHome), digest: null };
  };

  let preview: IntakeAnswerPreview | null = null;
  let actionMessage = "";
  let actionOk = true;

  if (action === "tune_config") {
    const cfgAct = input.configAction ?? "show";
    const args = ["config", cfgAct];
    if (cfgAct === "set" && input.configKey && input.configValue !== undefined) {
      args.push(input.configKey, input.configValue);
    } else if (cfgAct === "reset" && input.configKey) {
      args.push(input.configKey);
    }
    args.push("--json");
    try {
      const { stdout } = await exec(args);
      const parsed = parseJsonObject(stdout);
      actionOk = Boolean(parsed);
      actionMessage = actionOk ? `Updated intake config (${cfgAct})` : "Failed to parse intake config output";
    } catch (err) {
      actionOk = false;
      actionMessage = err instanceof Error ? err.message : String(err);
    }
  } else if (action === "preview_answer" || action === "answer" || action === "resolve_done") {
    const target = (input.taskId ?? "").trim();
    if (!target) {
      return {
        ok: false,
        available: true,
        action,
        totalTasks: 0,
        actionableBlockedCount: 0,
        supersededDuplicateCount: 0,
        concernsCount: 0,
        doneCount: 0,
        maxDecisionRounds: 8,
        maxConcurrent: 4,
        items: [],
        preview: null,
        message: "Missing taskId",
        durationMs: Date.now() - started,
      };
    }
    const args = ["answer", target, "--json"];
    if (action === "preview_answer") args.push("--dry-run");
    if (action === "resolve_done") args.push("--resolve-only");
    if (input.choice !== undefined) args.push("--choice", String(input.choice));
    if (input.text && input.text.trim()) args.push("--text", input.text.trim());
    try {
      const { stdout } = await exec(args);
      const parsed = parseJsonObject(stdout);
      if (parsed && parsed.ok !== false) {
        preview = mapPreview(parsed, homeDir);
        actionMessage =
          action === "preview_answer"
            ? `Preview ready (${preview.mode})`
            : action === "resolve_done"
              ? `Resolved ${preview.shortId} as Done`
              : `Resumed ${preview.shortId} (${preview.mode})`;
      } else {
        actionOk = false;
        actionMessage = asString(parsed?.error, "Intake answer command failed");
      }
    } catch (err) {
      const errObj = err as { stdout?: unknown; message?: string };
      const parsedErr = typeof errObj?.stdout === "string" ? parseJsonObject(errObj.stdout) : null;
      actionOk = false;
      actionMessage = asString(parsedErr?.error, errObj?.message ?? String(err));
    }
  }

  const shouldRefresh = Boolean(input.refresh) || action === "answer" || action === "resolve_done";
  const { available, digest } = await loadSnapshot(shouldRefresh);
  const cfg = readLocalIntakeConfig(intakeHome);

  if (!digest) {
    return {
      ok: action === "list" ? true : actionOk,
      available,
      action,
      generatedAt: null,
      totalTasks: 0,
      actionableBlockedCount: 0,
      supersededDuplicateCount: 0,
      concernsCount: 0,
      doneCount: 0,
      maxDecisionRounds: cfg.maxDecisionRounds,
      maxConcurrent: cfg.maxConcurrent,
      items: [],
      preview,
      message: actionMessage || (available ? "Decision queue empty" : "Intake router not configured on this host"),
      durationMs: Date.now() - started,
    };
  }

  const items = flattenDigestItems(digest, homeDir);
  const counts = isRecord(digest.counts_by_state) ? digest.counts_by_state : {};
  const actionableCount = asNumber(digest.actionable_blocked_count, items.length);

  return {
    ok: actionOk,
    available: true,
    action,
    generatedAt: asString(digest.generated_at) || null,
    totalTasks: asNumber(digest.total_tasks, 0),
    actionableBlockedCount: actionableCount,
    supersededDuplicateCount: asNumber(digest.superseded_duplicate_count, 0),
    concernsCount: asNumber(digest.concerns_count, 0),
    doneCount: asNumber(counts.done, 0),
    maxDecisionRounds: cfg.maxDecisionRounds,
    maxConcurrent: cfg.maxConcurrent,
    items,
    preview,
    message: actionMessage || `${actionableCount} pending decisions`,
    durationMs: Date.now() - started,
  };
}
