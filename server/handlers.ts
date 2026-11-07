import type { RpcInput } from "@getpaseo/plugin";
import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  type ActionLogEntry,
  type FileMetadata,
  type OpenerTarget,
  SUPPORTED_IMAGE_EXTENSIONS,
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
  type WorkspaceLabelEntry,
  type diagnosePathRpc,
  type inspectFileRpc,
  type listWorkspaceMediaRpc,
  type manageWorkspaceLabelsRpc,
  type openFileTargetRpc,
  type renameWorkspaceOrAgentRpc,
} from "../shared/contracts";

const IMAGE_EXT_SET = new Set<string>(SUPPORTED_IMAGE_EXTENSIONS);
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".DS_Store",
]);

const recentActionLogs: ActionLogEntry[] = [];

function recordActionLog(entry: Omit<ActionLogEntry, "id" | "timestampIso">) {
  const full: ActionLogEntry = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestampIso: new Date().toISOString(),
    ...entry,
  };
  recentActionLogs.unshift(full);
  if (recentActionLogs.length > 30) {
    recentActionLogs.length = 30;
  }
  return full;
}

export function getRecentActionLogs(): ActionLogEntry[] {
  return [...recentActionLogs];
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatRelativeTime(mtimeMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - mtimeMs) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function expandHome(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^['"`]+|['"`]+$/g, "");
  if (trimmed.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return trimmed.slice("file://".length);
    }
  }
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

function stripLineSuffix(rawPath: string): string {
  const hashIdx = rawPath.indexOf("#");
  const withoutHash = hashIdx >= 0 ? rawPath.slice(0, hashIdx) : rawPath;
  const match = withoutHash.match(/^(.+?):(\d+)(?::\d+)?(?:-\d+)?$/);
  return match ? match[1] : withoutHash;
}

export async function resolveWorkspaceDirectory(
  context: PluginHandlerContext,
  workspaceId?: string,
  workspaceRoot?: string,
): Promise<string> {
  if (workspaceRoot && workspaceRoot.trim().length > 0) {
    return expandHome(workspaceRoot);
  }
  if (workspaceId && workspaceId.trim().length > 0) {
    try {
      const handle = context.paseo.workspaces.ref(workspaceId.trim());
      if (handle.directory) {
        return expandHome(handle.directory);
      }
      const current = handle.current() ?? (await handle.refresh());
      if (current?.workspaceDirectory) {
        return expandHome(current.workspaceDirectory);
      }
    } catch {
      // Fallback to listing active workspaces
    }
  }
  try {
    const list = await context.paseo.workspaces.list();
    if (workspaceId) {
      const matched = list.entries.find((w) => w.id === workspaceId);
      if (matched?.workspaceDirectory) return expandHome(matched.workspaceDirectory);
    }
    const firstWithDir = list.entries.find((w) => Boolean(w.workspaceDirectory));
    if (firstWithDir?.workspaceDirectory) return expandHome(firstWithDir.workspaceDirectory);
  } catch {
    // Ignore
  }
  return os.homedir();
}

export async function listAllWorkspaceDirectories(
  context: PluginHandlerContext,
  primaryRoot?: string,
): Promise<string[]> {
  const roots: string[] = [];
  const pushRoot = (dir?: string | null) => {
    if (!dir || !dir.trim()) return;
    const normalized = path.normalize(expandHome(dir));
    if (!roots.includes(normalized)) roots.push(normalized);
  };
  if (primaryRoot) pushRoot(primaryRoot);
  try {
    const list = await context.paseo.workspaces.list();
    for (const entry of list.entries) {
      pushRoot(entry.workspaceDirectory);
    }
  } catch {
    // Ignore
  }
  return roots;
}

export function buildCandidatePaths(
  rawInput: string,
  workspaceRoot: string,
  extraRoots: string[] = [],
): string[] {
  const cleaned = stripLineSuffix(expandHome(rawInput));
  const candidates: string[] = [];
  const pushUnique = (p: string) => {
    const normalized = path.normalize(p);
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };

  if (!cleaned || cleaned === ".") {
    pushUnique(workspaceRoot);
    return candidates;
  }

  if (path.isAbsolute(cleaned)) {
    pushUnique(cleaned);
  } else {
    pushUnique(path.resolve(workspaceRoot, cleaned));
    for (const root of extraRoots) {
      pushUnique(path.resolve(root, cleaned));
    }
  }
  return candidates;
}

async function findMatchingFileByBasename(
  workspaceRoot: string,
  query: string,
  maxDepth = 5,
): Promise<string | null> {
  const targetLower = query.toLowerCase();
  let exactMatch: string | null = null;
  let partialMatch: string | null = null;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || exactMatch) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (exactMatch) return;
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const nameLower = entry.name.toLowerCase();
      if (nameLower === targetLower) {
        exactMatch = fullPath;
        return;
      }
      if (!partialMatch && nameLower.includes(targetLower)) {
        partialMatch = fullPath;
      }
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      }
    }
  }

  await walk(workspaceRoot, 0);
  return exactMatch ?? partialMatch;
}

async function readImageDimensions(
  absPath: string,
  ext: string,
): Promise<{ width: number | null; height: number | null }> {
  if (!IMAGE_EXT_SET.has(ext) || ext === "svg") {
    return { width: null, height: null };
  }
  try {
    const { stdout } = await execCommand(
      "/usr/bin/sips",
      ["-g", "pixelWidth", "-g", "pixelHeight", absPath],
      { timeout: 2500 },
    );
    const wMatch = stdout.match(/pixelWidth:\s*(\d+)/);
    const hMatch = stdout.match(/pixelHeight:\s*(\d+)/);
    const width = wMatch ? parseInt(wMatch[1], 10) : null;
    const height = hMatch ? parseInt(hMatch[1], 10) : null;
    return {
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
    };
  } catch {
    return { width: null, height: null };
  }
}

export async function inspectSinglePath(
  absPath: string,
  workspaceRoot: string,
  includeDimensions = true,
): Promise<FileMetadata> {
  const normalized = path.normalize(absPath);
  const parentDir = path.dirname(normalized);
  const fileName = path.basename(normalized);
  const extRaw = path.extname(fileName).toLowerCase();
  const extension = extRaw.startsWith(".") ? extRaw.slice(1) : extRaw;
  const rel =
    workspaceRoot && normalized.startsWith(workspaceRoot)
      ? path.relative(workspaceRoot, normalized) || "."
      : normalized;

  try {
    const stat = await fs.stat(normalized);
    const isDirectory = stat.isDirectory();
    const dims =
      !isDirectory && includeDimensions
        ? await readImageDimensions(normalized, extension)
        : { width: null, height: null };

    return {
      exists: true,
      absolutePath: normalized,
      relativePath: rel,
      parentDir: isDirectory ? normalized : parentDir,
      fileName,
      extension,
      isDirectory,
      sizeBytes: stat.size,
      sizeFormatted: formatBytes(stat.size),
      modifiedIso: stat.mtime.toISOString(),
      modifiedRelative: formatRelativeTime(stat.mtimeMs),
      width: dims.width,
      height: dims.height,
      error: null,
    };
  } catch (err) {
    return {
      exists: false,
      absolutePath: normalized,
      relativePath: rel,
      parentDir,
      fileName,
      extension,
      isDirectory: false,
      sizeBytes: 0,
      sizeFormatted: "0 B",
      modifiedIso: "",
      modifiedRelative: "missing",
      width: null,
      height: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function resolveBestPath(
  rawInput: string,
  workspaceRoot: string,
  extraRoots: string[] = [],
): Promise<{ resolvedPath: string; candidates: string[]; metadata: FileMetadata }> {
  const allRoots = [workspaceRoot, ...extraRoots.filter((r) => r !== workspaceRoot)].filter(Boolean);
  const candidates = buildCandidatePaths(rawInput, workspaceRoot, extraRoots);
  for (const candidate of candidates) {
    const matchingRoot = allRoots.find((r) => candidate.startsWith(r)) ?? workspaceRoot;
    const meta = await inspectSinglePath(candidate, matchingRoot, true);
    if (meta.exists) {
      return { resolvedPath: candidate, candidates, metadata: meta };
    }
  }
  const cleaned = stripLineSuffix(expandHome(rawInput));
  const baseQuery = path.basename(cleaned);
  if (baseQuery && baseQuery !== ".") {
    for (const root of allRoots) {
      const found = await findMatchingFileByBasename(root, baseQuery);
      if (found) {
        candidates.push(found);
        const meta = await inspectSinglePath(found, root, true);
        if (meta.exists) {
          return { resolvedPath: found, candidates, metadata: meta };
        }
      }
    }
  }
  const fallback = candidates[0] ?? workspaceRoot;
  const fallbackMeta = await inspectSinglePath(fallback, workspaceRoot, false);
  return { resolvedPath: fallback, candidates, metadata: fallbackMeta };
}

export async function handleInspectFile(
  input: RpcInput<typeof inspectFileRpc>,
  context: PluginHandlerContext,
) {
  const workspaceRoot = await resolveWorkspaceDirectory(
    context,
    input.workspaceId,
    input.workspaceRoot,
  );
  const extraRoots = await listAllWorkspaceDirectories(context, workspaceRoot);
  const { metadata } = await resolveBestPath(input.path, workspaceRoot, extraRoots);
  return metadata;
}

async function openFolderCrossPlatform(folderPath: string): Promise<void> {
  if (process.platform === "darwin") {
    await execCommand("/usr/bin/open", [folderPath], { timeout: 5000 });
  } else if (process.platform === "win32") {
    await execCommand("explorer.exe", [folderPath], { timeout: 5000 });
  } else {
    await execCommand("xdg-open", [folderPath], { timeout: 5000 });
  }
}

async function revealPathCrossPlatform(targetPath: string, isDirectory: boolean, parentDir: string): Promise<void> {
  if (isDirectory) {
    await openFolderCrossPlatform(targetPath);
    return;
  }
  if (process.platform === "darwin") {
    await execCommand("/usr/bin/open", ["-R", targetPath], { timeout: 5000 });
  } else if (process.platform === "win32") {
    await execCommand("explorer.exe", [`/select,${targetPath}`], { timeout: 5000 });
  } else {
    await openFolderCrossPlatform(parentDir);
  }
}

export async function handleOpenFileTarget(
  input: RpcInput<typeof openFileTargetRpc>,
  context: PluginHandlerContext,
  options?: { dryRun?: boolean },
) {
  const startMs = Date.now();
  const workspaceRoot = await resolveWorkspaceDirectory(
    context,
    input.workspaceId,
    input.workspaceRoot,
  );
  const extraRoots = await listAllWorkspaceDirectories(context, workspaceRoot);
  const { resolvedPath, metadata } = await resolveBestPath(input.path, workspaceRoot, extraRoots);
  const target: OpenerTarget = input.target;
  const dryRun = options?.dryRun === true || process.env.PASEO_FINDER_DRY_RUN === "1";

  if (!metadata.exists) {
    // If file does not exist but parentDir exists, reveal parentDir on finder-folder
    const parentMeta = await inspectSinglePath(metadata.parentDir, workspaceRoot, false);
    if (parentMeta.exists && (target === "finder-folder" || target === "finder-reveal")) {
      if (!dryRun) {
        await openFolderCrossPlatform(metadata.parentDir);
      }
      const durationMs = Date.now() - startMs;
      const msg = `Target file missing; opened existing parent folder: ${metadata.parentDir}`;
      recordActionLog({
        target,
        resolvedPath: metadata.parentDir,
        ok: true,
        durationMs,
        message: msg,
      });
      return {
        ok: true,
        resolvedPath: metadata.parentDir,
        parentDir: metadata.parentDir,
        target,
        message: msg,
        durationMs,
      };
    }
    const durationMs = Date.now() - startMs;
    const msg = `Path does not exist: ${resolvedPath}`;
    recordActionLog({ target, resolvedPath, ok: false, durationMs, message: msg });
    return {
      ok: false,
      resolvedPath,
      parentDir: metadata.parentDir,
      target,
      message: msg,
      durationMs,
    };
  }

  try {
    if (!dryRun) {
      if (target === "finder-reveal") {
        await revealPathCrossPlatform(resolvedPath, metadata.isDirectory, metadata.parentDir);
      } else if (target === "finder-folder") {
        const folder = metadata.isDirectory ? resolvedPath : metadata.parentDir;
        await openFolderCrossPlatform(folder);
      } else if (target === "system-preview") {
        if (process.platform === "darwin" && IMAGE_EXT_SET.has(metadata.extension)) {
          await execCommand("/usr/bin/open", ["-a", "Preview", resolvedPath], { timeout: 5000 }).catch(
            () => execCommand("/usr/bin/open", [resolvedPath], { timeout: 5000 }),
          );
        } else {
          await openFolderCrossPlatform(resolvedPath);
        }
      } else if (target === "quicklook") {
        if (process.platform === "darwin") {
          await execCommand("/usr/bin/qlmanage", ["-p", resolvedPath], { timeout: 2500 }).catch(() =>
            execCommand("/usr/bin/open", [resolvedPath], { timeout: 5000 }),
          );
        } else {
          await openFolderCrossPlatform(resolvedPath);
        }
      } else if (target === "antigravity") {
        await execCommand("/usr/bin/open", ["-a", "Antigravity", resolvedPath], {
          timeout: 5000,
        });
      } else if (target === "cursor") {
        await execCommand("/usr/bin/open", ["-a", "Cursor", resolvedPath], { timeout: 5000 });
      } else if (target === "vscode") {
        await execCommand("/usr/bin/open", ["-a", "Visual Studio Code", resolvedPath], {
          timeout: 5000,
        });
      } else if (target === "terminal") {
        const folder = metadata.isDirectory ? resolvedPath : metadata.parentDir;
        await execCommand("/usr/bin/open", ["-a", "Terminal", folder], { timeout: 5000 });
      }
    }

    const durationMs = Date.now() - startMs;
    const actionLabel =
      target === "finder-reveal"
        ? `Revealed in Finder: ${metadata.fileName}`
        : target === "finder-folder"
          ? `Opened folder in Finder: ${metadata.parentDir}`
          : target === "system-preview"
            ? `Opened in Preview: ${metadata.fileName}`
            : `Opened with ${target}: ${metadata.fileName}`;

    recordActionLog({
      target,
      resolvedPath,
      ok: true,
      durationMs,
      message: actionLabel,
    });

    return {
      ok: true,
      resolvedPath,
      parentDir: metadata.parentDir,
      target,
      message: actionLabel,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const msg = err instanceof Error ? err.message : String(err);
    recordActionLog({ target, resolvedPath, ok: false, durationMs, message: msg });
    return {
      ok: false,
      resolvedPath,
      parentDir: metadata.parentDir,
      target,
      message: msg,
      durationMs,
    };
  }
}

export async function handleListWorkspaceMedia(
  input: RpcInput<typeof listWorkspaceMediaRpc>,
  context: PluginHandlerContext,
) {
  const workspaceRoot = await resolveWorkspaceDirectory(
    context,
    input.workspaceId,
    input.workspaceRoot,
  );
  const onlyImages = input.onlyImages ?? true;
  const limit = input.limit ?? 24;
  const queryLower = (input.query ?? "").trim().toLowerCase();

  const rawEntries: { absPath: string; mtimeMs: number; size: number }[] = [];

  async function scanDir(dir: string, depth: number): Promise<void> {
    if (depth > 5 || rawEntries.length > 400) return;
    let list;
    try {
      list = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of list) {
      if (d.name.startsWith(".") && d.name !== ".well-known") continue;
      if (IGNORED_DIRS.has(d.name)) continue;
      const fullPath = path.join(dir, d.name);
      if (d.isDirectory()) {
        await scanDir(fullPath, depth + 1);
      } else if (d.isFile()) {
        const ext = path.extname(d.name).toLowerCase().replace(/^\./, "");
        if (onlyImages && !IMAGE_EXT_SET.has(ext)) continue;
        const relPath = path.relative(workspaceRoot, fullPath);
        if (queryLower && !relPath.toLowerCase().includes(queryLower)) continue;
        try {
          const st = await fs.stat(fullPath);
          rawEntries.push({ absPath: fullPath, mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          // Ignore unreadable file
        }
      }
    }
  }

  await scanDir(workspaceRoot, 0);
  rawEntries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sliced = rawEntries.slice(0, limit);

  const items: FileMetadata[] = await Promise.all(
    sliced.map((item, idx) => inspectSinglePath(item.absPath, workspaceRoot, idx < 8)),
  );

  return {
    workspaceRoot,
    scannedAtIso: new Date().toISOString(),
    totalFound: rawEntries.length,
    items,
    recentActions: getRecentActionLogs().slice(0, 8),
  };
}

export async function handleDiagnosePath(
  input: RpcInput<typeof diagnosePathRpc>,
  context: PluginHandlerContext,
) {
  const workspaceRoot = await resolveWorkspaceDirectory(
    context,
    input.workspaceId,
    input.workspaceRoot,
  );
  const extraRoots = await listAllWorkspaceDirectories(context, workspaceRoot);
  const { resolvedPath, candidates, metadata } = await resolveBestPath(
    input.rawInput,
    workspaceRoot,
    extraRoots,
  );

  const availableTargets: {
    target: OpenerTarget;
    label: string;
    available: boolean;
    commandPreview: string;
  }[] = [
    {
      target: "finder-reveal",
      label: "Reveal in Finder",
      available: true,
      commandPreview: `open -R "${resolvedPath}"`,
    },
    {
      target: "finder-folder",
      label: "Open containing folder",
      available: true,
      commandPreview: `open "${metadata.parentDir}"`,
    },
    {
      target: "system-preview",
      label: "Open in Preview",
      available: true,
      commandPreview: `open -a Preview "${resolvedPath}"`,
    },
    {
      target: "antigravity",
      label: "Antigravity IDE",
      available: true,
      commandPreview: `open -a Antigravity "${resolvedPath}"`,
    },
    {
      target: "cursor",
      label: "Cursor IDE",
      available: true,
      commandPreview: `open -a Cursor "${resolvedPath}"`,
    },
    {
      target: "terminal",
      label: "macOS Terminal",
      available: true,
      commandPreview: `open -a Terminal "${metadata.parentDir}"`,
    },
  ];

  return {
    rawInput: input.rawInput,
    workspaceRoot,
    candidatePaths: candidates,
    resolvedMetadata: metadata,
    availableTargets,
    recentActions: getRecentActionLogs(),
  };
}

export interface DaemonLabelBridge {
  listWorkspaceLabels(): Promise<{
    labels: Array<{ name: string; color: WorkspaceLabelColor }>;
  }>;
  fetchWorkspaces(options?: { limit?: number }): Promise<{
    entries: Array<{
      id: string;
      name: string;
      title?: string | null;
      labels?: string[];
      workspaceDirectory?: string | null;
    }>;
  }>;
  setWorkspaceLabel(options: {
    workspaceId: string;
    label: { name: string; color?: WorkspaceLabelColor };
    assigned: boolean;
  }): Promise<unknown>;
  updateWorkspaceLabel(options: {
    name: string;
    newName?: string;
    color?: WorkspaceLabelColor;
  }): Promise<unknown>;
  deleteWorkspaceLabel(options: { name: string }): Promise<unknown>;
  updateAgent(
    agentId: string,
    updates: { name?: string; labels?: Record<string, string> },
  ): Promise<void>;
}

const VALID_LABEL_COLORS = new Set<string>(WORKSPACE_LABEL_COLORS);

function normalizeLabelColor(color?: string | null): WorkspaceLabelColor {
  if (color && VALID_LABEL_COLORS.has(color)) {
    return color as WorkspaceLabelColor;
  }
  return "violet";
}

async function withLocalDaemonBridge<T>(
  fn: (bridge: DaemonLabelBridge) => Promise<T>,
  overrideBridge?: DaemonLabelBridge,
): Promise<T> {
  if (overrideBridge) {
    return fn(overrideBridge);
  }
  const paseoDir = path.join(os.homedir(), ".paseo");
  const credRaw = await fs.readFile(path.join(paseoDir, "local-credential"), "utf-8");
  const password = credRaw.trim();
  let listen = "127.0.0.1:6767";
  try {
    const cfgRaw = await fs.readFile(path.join(paseoDir, "config.json"), "utf-8");
    const cfg = JSON.parse(cfgRaw) as { daemon?: { listen?: string } };
    if (cfg.daemon?.listen) {
      listen = cfg.daemon.listen;
    }
  } catch {
    // Default loopback listen
  }
  const modPath = new URL(
    "../node_modules/@getpaseo/client/dist/node/index.js",
    import.meta.url,
  ).href;
  const { createHostClient } = (await import(modPath)) as {
    createHostClient: (
      url: string,
      opts: { clientId: string; password?: string },
    ) => DaemonLabelBridge & { connect(): Promise<void>; close(): Promise<void> };
  };
  const client = createHostClient(`ws://${listen}/ws`, {
    clientId: `plugin-finder-bridge-${Date.now()}`,
    password,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

async function resolveActiveWorkspaceId(
  context: PluginHandlerContext,
  explicitWorkspaceId?: string,
): Promise<string> {
  if (explicitWorkspaceId && explicitWorkspaceId.trim()) {
    return explicitWorkspaceId.trim();
  }
  try {
    const list = await context.paseo.workspaces.list();
    if (list.entries[0]?.id) {
      return list.entries[0].id;
    }
  } catch {
    // Fallback
  }
  return "";
}

export async function handleRenameThread(
  input: RpcInput<typeof renameWorkspaceOrAgentRpc>,
  context: PluginHandlerContext,
  options?: { bridge?: DaemonLabelBridge },
) {
  const startMs = Date.now();
  const workspaceId = await resolveActiveWorkspaceId(context, input.workspaceId);
  const rawTitle = input.title === null ? null : input.title.trim();
  const normalizedTitle =
    rawTitle === null || rawTitle === "" || rawTitle.toLowerCase() === "clear" || rawTitle.toLowerCase() === "reset"
      ? null
      : rawTitle;

  if (!workspaceId && !input.agentId) {
    return {
      ok: false,
      workspaceId: "",
      title: normalizedTitle,
      message: "No active workspaceId or agentId found to rename",
      durationMs: Date.now() - startMs,
    };
  }

  try {
    if (workspaceId) {
      const ref = context.paseo.workspaces.ref(workspaceId);
      await ref.setTitle(normalizedTitle);
    }
    if (input.agentId && normalizedTitle) {
      await withLocalDaemonBridge(
        (bridge) => bridge.updateAgent(input.agentId!, { name: normalizedTitle }),
        options?.bridge,
      );
    }
    const durationMs = Date.now() - startMs;
    const msg = normalizedTitle
      ? `Renamed workspace (${workspaceId}) to "${normalizedTitle}"`
      : `Cleared custom title for workspace (${workspaceId})`;
    recordActionLog({
      target: "finder-folder",
      resolvedPath: workspaceId || input.agentId || "",
      ok: true,
      durationMs,
      message: msg,
    });
    return {
      ok: true,
      workspaceId,
      title: normalizedTitle,
      message: msg,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      workspaceId,
      title: normalizedTitle,
      message: msg,
      durationMs,
    };
  }
}

export async function handleManageWorkspaceLabels(
  input: RpcInput<typeof manageWorkspaceLabelsRpc>,
  context: PluginHandlerContext,
  options?: { bridge?: DaemonLabelBridge },
) {
  const startMs = Date.now();
  const workspaceId = await resolveActiveWorkspaceId(context, input.workspaceId);
  const action = input.action ?? "inspect";
  const labelName = (input.labelName ?? "").trim();

  try {
    return await withLocalDaemonBridge(async (bridge) => {
      const readState = async () => {
        const [labelList, wsList] = await Promise.all([
          bridge.listWorkspaceLabels(),
          bridge.fetchWorkspaces({ limit: 200 }),
        ]);
        const catalog: WorkspaceLabelEntry[] = (labelList.labels ?? []).map((item) => ({
          name: item.name,
          color: normalizeLabelColor(item.color),
        }));
        const matchedWs =
          wsList.entries.find((w) => w.id === workspaceId) ?? wsList.entries[0];
        const resolvedWsId = matchedWs?.id ?? workspaceId;
        const workspaceTitle = matchedWs?.title ?? matchedWs?.name ?? resolvedWsId;
        const assignedLabels = Array.isArray(matchedWs?.labels)
          ? [...matchedWs.labels]
          : [];
        return { catalog, resolvedWsId, workspaceTitle, assignedLabels };
      };

      const initial = await readState();
      const targetWsId = initial.resolvedWsId;

      if (action === "inspect" || !labelName) {
        return {
          ok: true,
          workspaceId: targetWsId,
          workspaceTitle: initial.workspaceTitle,
          assignedLabels: initial.assignedLabels,
          catalog: initial.catalog,
          message: `Loaded ${initial.assignedLabels.length} assigned labels (${initial.catalog.length} in catalog)`,
          durationMs: Date.now() - startMs,
        };
      }

      if (action === "toggle" || action === "assign" || action === "unassign") {
        const currentlyAssigned = initial.assignedLabels.includes(labelName);
        const nextAssigned =
          action === "toggle" ? !currentlyAssigned : action === "assign";
        const existingInCatalog = initial.catalog.find((c) => c.name === labelName);
        const color = normalizeLabelColor(input.color ?? existingInCatalog?.color ?? "violet");

        await bridge.setWorkspaceLabel({
          workspaceId: targetWsId,
          label: { name: labelName, color },
          assigned: nextAssigned,
        });

        const updated = await readState();
        const durationMs = Date.now() - startMs;
        const msg = nextAssigned
          ? `Assigned label "${labelName}" (${color}) to workspace ${targetWsId}`
          : `Removed label "${labelName}" from workspace ${targetWsId}`;
        recordActionLog({
          target: "finder-folder",
          resolvedPath: `${targetWsId}#label:${labelName}`,
          ok: true,
          durationMs,
          message: msg,
        });
        return {
          ok: true,
          workspaceId: targetWsId,
          workspaceTitle: updated.workspaceTitle,
          assignedLabels: updated.assignedLabels,
          catalog: updated.catalog,
          message: msg,
          durationMs,
        };
      }

      if (action === "update") {
        const nextName = input.newName?.trim();
        await bridge.updateWorkspaceLabel({
          name: labelName,
          ...(nextName ? { newName: nextName } : {}),
          ...(input.color ? { color: normalizeLabelColor(input.color) } : {}),
        });
        const updated = await readState();
        const durationMs = Date.now() - startMs;
        const msg = `Updated label "${labelName}"${nextName ? ` -> "${nextName}"` : ""}${input.color ? ` (${input.color})` : ""}`;
        return {
          ok: true,
          workspaceId: targetWsId,
          workspaceTitle: updated.workspaceTitle,
          assignedLabels: updated.assignedLabels,
          catalog: updated.catalog,
          message: msg,
          durationMs,
        };
      }

      if (action === "delete") {
        await bridge.deleteWorkspaceLabel({ name: labelName });
        const updated = await readState();
        const durationMs = Date.now() - startMs;
        const msg = `Deleted label "${labelName}" from catalog`;
        return {
          ok: true,
          workspaceId: targetWsId,
          workspaceTitle: updated.workspaceTitle,
          assignedLabels: updated.assignedLabels,
          catalog: updated.catalog,
          message: msg,
          durationMs,
        };
      }

      return {
        ok: true,
        workspaceId: targetWsId,
        workspaceTitle: initial.workspaceTitle,
        assignedLabels: initial.assignedLabels,
        catalog: initial.catalog,
        message: "No-op",
        durationMs: Date.now() - startMs,
      };
    }, options?.bridge);
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      workspaceId,
      workspaceTitle: workspaceId,
      assignedLabels: [],
      catalog: [],
      message: msg,
      durationMs,
    };
  }
}

