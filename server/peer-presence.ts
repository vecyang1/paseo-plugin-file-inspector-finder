/**
 * Peer presence (T-098): reads the two `antigravity-ops peers touching` reports for
 * Settings -> Peer Agents. No I/O of its own: the caller hands in the function that runs the CLI.
 *
 *   peers touching --json            files two or more sessions edited inside the window
 *   peers touching --verify --json   did every editing session leave lines in the hook ledger
 *
 * A run that failed or printed something unreadable is `null`. The settings screen shows that as
 * "unknown". It is never turned into an empty list or a passing verdict, because "nobody shares a
 * file" and "the check did not run" call for opposite reactions.
 */
import type {
  PeerPresenceSummary,
  PeerPresenceVerify,
  PeerSharedFile,
  PeerSharedFileSession,
} from "../shared/contracts";

/** Rows sent to the client. `presence.sharedTotal` and `presence.truncated` say when more exist. */
export const SHARED_FILES_CAP = 20;
export const TOUCHING_ARGS = ["peers", "touching", "--json"] as const;
export const VERIFY_ARGS = ["peers", "touching", "--verify", "--json"] as const;

/** Runs `antigravity-ops <args>`. Rejects the way `execFile` does on a non-zero exit. */
export type PeerCliExec = (args: string[]) => Promise<{ stdout: string }>;

export interface PeerCliRun {
  /** null = the process did not exit by itself (not found, killed, timed out, output too large). */
  exitCode: number | null;
  stdout: string;
}

export interface PeerSharedFilesRead {
  sharedFiles: PeerSharedFile[] | null;
  presence: PeerPresenceSummary | null;
}

/** The optional fields `handleManagePeerAgents` adds to its reply. An absent key = not asked. */
export interface PeerPresenceFields {
  sharedFiles?: PeerSharedFile[] | null;
  presence?: PeerPresenceSummary | null;
  presenceVerify?: PeerPresenceVerify | null;
}

export interface PeerPresenceOptions {
  /** Home directory; a path under it is shortened to `~/...`. */
  home?: string;
  cap?: number;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function parseObject(stdout: string): Json | null {
  const body = stdout.trim();
  if (!body) return null;
  try {
    const value: unknown = JSON.parse(body);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function shortenHome(filePath: string, home: string): string {
  const root = home.replace(/\/+$/, "");
  return root && filePath.startsWith(`${root}/`) ? `~${filePath.slice(root.length)}` : filePath;
}

const countNoun = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Runs the CLI and keeps what a rejection carries. `--verify` exits 1 with its full report on
 * stdout, so the exit code and the output are both needed to tell a gap from a broken run.
 */
export async function runPeerCli(exec: PeerCliExec, args: readonly string[]): Promise<PeerCliRun> {
  try {
    const result = await exec([...args]);
    return { exitCode: 0, stdout: text(result?.stdout) };
  } catch (error) {
    const failure = isRecord(error) || error instanceof Error ? (error as { code?: unknown; stdout?: unknown }) : {};
    return {
      exitCode: typeof failure.code === "number" ? failure.code : null,
      stdout: text(failure.stdout),
    };
  }
}

function readSession(raw: Json): PeerSharedFileSession {
  return {
    agent: text(raw.agent),
    session: text(raw.session),
    provider: text(raw.provider),
    harness: text(raw.harness),
    model: text(raw.model),
    status: text(raw.status) || "unknown",
    title: text(raw.title),
    scheduled: typeof raw.scheduled === "boolean" ? raw.scheduled : null,
    last: numberOrNull(raw.last),
    count: numberOrNull(raw.count),
  };
}

/** `peers touching --json`. Only exit 0 with a JSON object counts as a read. */
export function parseSharedFiles(run: PeerCliRun, options: PeerPresenceOptions = {}): PeerSharedFilesRead {
  if (run.exitCode !== 0) return { sharedFiles: null, presence: null };
  const payload = parseObject(run.stdout);
  if (!payload) return { sharedFiles: null, presence: null };

  const home = options.home ?? "";
  const cap = options.cap ?? SHARED_FILES_CAP;
  const warnings = stringList(payload.warnings);
  let sharedFiles: PeerSharedFile[] | null = null;
  let sharedTotal: number | null = null;

  // A payload without `paths` says nothing about shared files: the list stays unknown.
  if (Array.isArray(payload.paths)) {
    const files: PeerSharedFile[] = [];
    let unreadEntries = 0;
    let unreadSessions = 0;
    for (const entry of payload.paths) {
      if (!isRecord(entry) || typeof entry.path !== "string" || !entry.path || !Array.isArray(entry.sessions)) {
        unreadEntries += 1;
        continue;
      }
      const sessions: PeerSharedFileSession[] = [];
      for (const row of entry.sessions) {
        if (isRecord(row)) sessions.push(readSession(row));
        else unreadSessions += 1;
      }
      files.push({ path: entry.path, shortPath: shortenHome(entry.path, home), sessions });
    }
    if (unreadEntries > 0) {
      warnings.push(`${countNoun(unreadEntries, "shared-file entry", "shared-file entries")} could not be read`);
    }
    if (unreadSessions > 0) {
      warnings.push(`${countNoun(unreadSessions, "session row", "session rows")} could not be read`);
    }
    sharedTotal = files.length;
    sharedFiles = files.slice(0, Math.max(0, cap));
  }

  return {
    sharedFiles,
    presence: {
      windowMinutes: numberOrNull(payload.window_minutes),
      edits: numberOrNull(payload.edits),
      sessions: numberOrNull(payload.sessions),
      files: numberOrNull(payload.files),
      sharedTotal,
      truncated: sharedFiles !== null && sharedTotal !== null && sharedTotal > sharedFiles.length,
      warnings,
    },
  };
}

/**
 * `peers touching --verify --json`. Exit 0 and exit 1 both carry a report; the verdict is the
 * report's own `ok` (true, false, or null when the CLI could not grade). Anything else is null.
 */
export function parsePresenceVerify(run: PeerCliRun): PeerPresenceVerify | null {
  if (run.exitCode !== 0 && run.exitCode !== 1) return null;
  const payload = parseObject(run.stdout);
  if (!payload) return null;
  // A report without `ok` (undefined) is not a verdict either.
  const ok = payload.ok;
  if (ok !== true && ok !== false && ok !== null) return null;

  const graded = isRecord(payload.graded) ? payload.graded : {};
  const harness = Object.entries(isRecord(payload.harness) ? payload.harness : {})
    .filter((pair): pair is [string, Json] => isRecord(pair[1]))
    .map(([name, report]) => ({
      harness: name,
      gradedSessions: numberOrNull(graded[name]),
      editedPairs: numberOrNull(report.edited_pairs),
      inLedger: numberOrNull(report.in_ledger),
      beforeHook: numberOrNull(report.before_hook),
      missingSessions: stringList(report.missing_sessions),
      hookRanButEditUnread: stringList(report.hook_ran_but_edit_unread),
      noHookRun: stringList(report.no_hook_run),
      missingExamples: stringList(report.missing_examples),
    }));
  const reason = text(payload.reason).trim();

  return {
    ok,
    reason: reason || null,
    gapSessions: [...new Set(harness.flatMap((report) => report.missingSessions))].sort(),
    harness,
    warnings: stringList(payload.warnings),
  };
}

/**
 * What one `manage_peer_agents` action adds to its reply: `status` reads the shared-files list,
 * `verify_presence` runs the recording check, every other action adds nothing. Never rejects.
 */
export async function collectPeerPresence(
  action: string,
  exec: PeerCliExec,
  options: PeerPresenceOptions = {},
): Promise<PeerPresenceFields> {
  if (action === "status") {
    return parseSharedFiles(await runPeerCli(exec, TOUCHING_ARGS), options);
  }
  if (action === "verify_presence") {
    return { presenceVerify: parsePresenceVerify(await runPeerCli(exec, VERIFY_ARGS)) };
  }
  return {};
}
