import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type ActionLogEntry,
  type FileMetadata,
  type ImportedWorkspaceItem,
  type OpenerTarget,
  type ProjectJumpCandidate,
  type QuickJumpAction,
  type SidebarDropBehavior,
  SUPPORTED_IMAGE_EXTENSIONS,
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
  type WorkspaceLabelEntry,
  type archiveWorkspaceRpc,
  type toggleWorkspacePinRpc,
  type diagnosePathRpc,
  type importFolderWorkspaceRpc,
  type inspectFileRpc,
  type listWorkspaceMediaRpc,
  type manageWorkspaceLabelsRpc,
  type openFileTargetRpc,
  type quickJumpWorkspaceRpc,
  type renameWorkspaceOrAgentRpc,
  scoreProjectJumpQuery,
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
  projectName?: string,
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
    if (projectName && projectName.trim()) {
      const cleanName = projectName.trim().toLowerCase();
      const matchedProj = list.entries.find((w) => {
        const rawProj = (w as { projectName?: string; name?: string }).projectName ?? w.name;
        return rawProj && rawProj.toLowerCase() === cleanName && Boolean(w.workspaceDirectory);
      });
      if (matchedProj?.workspaceDirectory) return expandHome(matchedProj.workspaceDirectory);
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

async function openSystemDefaultCrossPlatform(targetPath: string): Promise<void> {
  if (process.platform === "darwin") {
    await execCommand("/usr/bin/open", [targetPath], { timeout: 5000 });
  } else if (process.platform === "win32") {
    await execCommand("cmd.exe", ["/c", "start", '""', targetPath], { timeout: 5000 }).catch(
      () => execCommand("explorer.exe", [targetPath], { timeout: 5000 }),
    );
  } else {
    await execCommand("xdg-open", [targetPath], { timeout: 5000 });
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
    input.projectName,
  );
  const extraRoots = await listAllWorkspaceDirectories(context, workspaceRoot);
  const { resolvedPath, metadata } = await resolveBestPath(input.path, workspaceRoot, extraRoots);
  const target: OpenerTarget = input.target;
  const dryRun = options?.dryRun === true || process.env.PASEO_FINDER_DRY_RUN === "1";

  if (!metadata.exists) {
    // If file does not exist but parentDir exists, reveal parentDir on finder-folder or system-default
    const parentMeta = await inspectSinglePath(metadata.parentDir, workspaceRoot, false);
    if (
      parentMeta.exists &&
      (target === "finder-folder" || target === "finder-reveal" || target === "system-default")
    ) {
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
      } else if (target === "system-default") {
        if (metadata.isDirectory) {
          await openFolderCrossPlatform(resolvedPath);
        } else {
          await openSystemDefaultCrossPlatform(resolvedPath);
        }
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
      target: "system-default",
      label: "System default application",
      available: true,
      commandPreview: `open "${resolvedPath}"`,
    },
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
  fetchWorkspaces(options?: {
    limit?: number;
    page?: { limit?: number; cursor?: string };
  }): Promise<{
    entries: Array<{
      id: string;
      name: string;
      title?: string | null;
      labels?: string[];
      workspaceDirectory?: string | null;
    }>;
    pageInfo?: {
      nextCursor?: string | null;
      hasMore?: boolean;
    };
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

export function normalizeDaemonListenAddress(raw?: string | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "127.0.0.1:6767";
  const withoutProto = trimmed
    .replace(/^ws(s)?:\/\//i, "")
    .replace(/^http(s)?:\/\//i, "")
    .replace(/\/.*$/, "");
  if (!withoutProto) return "127.0.0.1:6767";
  if (withoutProto.startsWith(":")) {
    return `127.0.0.1${withoutProto}`;
  }
  if (withoutProto.startsWith("0.0.0.0:")) {
    return `127.0.0.1:${withoutProto.slice("0.0.0.0:".length)}`;
  }
  if (withoutProto.startsWith("[::]:")) {
    return `127.0.0.1:${withoutProto.slice("[::]:".length)}`;
  }
  return withoutProto;
}

export async function resolveDaemonClientModuleHref(
  metaUrl?: string,
  paseoHomeDir: string = path.join(os.homedir(), ".paseo"),
): Promise<string> {
  const relModule = path.join(
    "node_modules",
    "@getpaseo",
    "client",
    "dist",
    "node",
    "index.js",
  );
  const candidates: string[] = [];

  if (typeof metaUrl === "string" && metaUrl.startsWith("file:")) {
    try {
      const baseDir = path.dirname(fileURLToPath(metaUrl));
      candidates.push(path.resolve(baseDir, "..", relModule));
      candidates.push(path.resolve(baseDir, relModule));
    } catch {
      // Ignore malformed file URL in bundled worker environments
    }
  }

  candidates.push(
    path.join(paseoHomeDir, "plugins", "file-inspector-finder", relModule),
  );
  candidates.push(path.resolve(process.cwd(), relModule));

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return pathToFileURL(candidate).href;
    } catch {
      // Try next candidate
    }
  }

  return pathToFileURL(
    path.join(paseoHomeDir, "plugins", "file-inspector-finder", relModule),
  ).href;
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

function stripWorkspaceServerPrefix(raw?: string | null): string {
  return (raw ?? "")
    .trim()
    .replace(/^sidebar-workspace-row-/, "")
    .replace(/^(?:local|srv_[^:]+):/, "")
    .trim();
}

async function resolveActiveWorkspaceId(
  context: PluginHandlerContext,
  explicitWorkspaceId?: string,
): Promise<string> {
  const cleanedExplicit = stripWorkspaceServerPrefix(explicitWorkspaceId);
  if (cleanedExplicit) {
    return cleanedExplicit;
  }
  try {
    const list = await context.paseo.workspaces.list();
    if (list.entries[0]?.id) {
      return stripWorkspaceServerPrefix(list.entries[0].id);
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
    const sourceTag = input.source ? ` [${input.source}]` : "";
    const msg = normalizedTitle
      ? `Renamed ${input.agentId && !workspaceId ? `agent (${input.agentId})` : `workspace (${workspaceId})`} to "${normalizedTitle}"${sourceTag}`
      : `Cleared custom title for workspace (${workspaceId})${sourceTag}`;
    recordActionLog({
      target: "workspace-meta",
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
      recentActions: getRecentActionLogs().slice(0, 8),
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

export async function handleArchiveWorkspace(
  input: RpcInput<typeof archiveWorkspaceRpc>,
  context: PluginHandlerContext,
  options?: { bridge?: DaemonLabelBridge },
): Promise<RpcOutput<typeof archiveWorkspaceRpc>> {
  const workspaceId = await resolveActiveWorkspaceId(context, input.workspaceId);
  if (!workspaceId) {
    return {
      ok: false,
      workspaceId: "",
      archivedAt: null,
      error: "No active workspaceId found to archive",
    };
  }

  // Validate that the workspace exists before simulating or performing the archive
  let workspaceExists = false;
  try {
    const list = await context.paseo.workspaces?.list?.();
    if (list?.entries && Array.isArray(list.entries)) {
      workspaceExists = list.entries.some((entry: { id?: string }) => entry.id === workspaceId);
    } else {
      const ref = context.paseo.workspaces?.ref?.(workspaceId);
      const desc = ref?.current?.();
      workspaceExists = Boolean(desc?.id);
    }
  } catch {
    workspaceExists = true;
  }

  if (input.dryRun) {
    if (!workspaceExists) {
      return {
        ok: false,
        workspaceId,
        archivedAt: null,
        error: `Workspace ${workspaceId} not found`,
      };
    }
    return {
      ok: true,
      workspaceId,
      archivedAt: null,
      message: `Simulated archive for workspace ${workspaceId}`,
    };
  }

  try {
    const paseo = context.paseo as {
      daemonClient?: {
        archiveWorkspace?: (id: string) => Promise<{ archivedAt?: string }>;
      };
      workspaces?: {
        ref?: (id: string) => {
          archive?: () => Promise<{ archivingAt?: string; archivedAt?: string }>;
        };
        archive?: (id: string) => Promise<{ archivedAt?: string }>;
      };
    };

    let archivedAt: string | null = null;
    if (paseo.daemonClient?.archiveWorkspace) {
      const res = await paseo.daemonClient.archiveWorkspace(workspaceId);
      archivedAt = res?.archivedAt ?? null;
    } else if (paseo.workspaces?.ref) {
      const handle = paseo.workspaces.ref(workspaceId);
      if (handle?.archive) {
        const res = await handle.archive();
        archivedAt = res?.archivingAt ?? res?.archivedAt ?? null;
      }
    } else if (paseo.workspaces?.archive) {
      const res = await paseo.workspaces.archive(workspaceId);
      archivedAt = res?.archivedAt ?? null;
    }

    recordActionLog({
      target: "workspace-meta",
      resolvedPath: workspaceId,
      ok: true,
      durationMs: 0,
      message: `Archived workspace ${workspaceId}`,
    });

    return {
      ok: true,
      workspaceId,
      archivedAt,
      message: `Archived workspace ${workspaceId}`,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    recordActionLog({
      target: "workspace-meta",
      resolvedPath: workspaceId,
      ok: false,
      durationMs: 0,
      message: `Failed to archive workspace ${workspaceId}: ${errorMsg}`,
    });
    return {
      ok: false,
      workspaceId,
      error: errorMsg,
    };
  }
}

export async function handleToggleWorkspacePin(
  input: RpcInput<typeof toggleWorkspacePinRpc>,
  context: PluginHandlerContext,
): Promise<RpcOutput<typeof toggleWorkspacePinRpc>> {
  const workspaceId = await resolveActiveWorkspaceId(context, input.workspaceId);
  if (!workspaceId) {
    return {
      ok: false,
      workspaceId: "",
      pinned: false,
      pinnedAt: null,
      message: "No active workspaceId found to toggle pin",
    };
  }

  let currentlyPinned = false;
  let workspaceTitle = workspaceId;
  try {
    const list = await context.paseo.workspaces?.list?.();
    if (list?.entries && Array.isArray(list.entries)) {
      const entry = list.entries.find(
        (e: { id?: string; name?: string; title?: string | null; pinnedAt?: unknown }) =>
          e.id === workspaceId,
      );
      if (entry) {
        currentlyPinned = Boolean((entry as { pinnedAt?: unknown }).pinnedAt);
        workspaceTitle =
          (entry as { title?: string; name?: string }).title ||
          (entry as { name?: string }).name ||
          workspaceId;
      }
    }
  } catch {
    // ignore
  }

  const nextPinned = input.pinned !== undefined ? input.pinned : !currentlyPinned;

  if (input.dryRun) {
    return {
      ok: true,
      workspaceId,
      pinned: nextPinned,
      pinnedAt: nextPinned ? Date.now() : null,
      message: `[dryRun] Would ${nextPinned ? "pin" : "unpin"} workspace ${workspaceTitle}`,
    };
  }

  try {
    const paseo = context.paseo as {
      daemonClient?: {
        setWorkspacePinned?: (
          id: string,
          pinned: boolean,
        ) => Promise<{ pinnedAt?: string | number | null }>;
      };
    };

    let pinnedAt: string | number | null = null;
    if (typeof paseo.daemonClient?.setWorkspacePinned === "function") {
      const res = await paseo.daemonClient.setWorkspacePinned(workspaceId, nextPinned);
      pinnedAt = res?.pinnedAt ?? (nextPinned ? Date.now() : null);
    } else {
      try {
        const res = await withLocalDaemonBridge(async (bridge) => {
          const pinBridge = bridge as unknown as {
            setWorkspacePinned?: (
              id: string,
              pinned: boolean,
            ) => Promise<{ pinnedAt?: string | number | null }>;
          };
          if (typeof pinBridge.setWorkspacePinned === "function") {
            return await pinBridge.setWorkspacePinned(workspaceId, nextPinned);
          }
          return null;
        });
        pinnedAt = res?.pinnedAt ?? (nextPinned ? Date.now() : null);
      } catch {
        pinnedAt = nextPinned ? Date.now() : null;
      }
    }

    recordActionLog({
      target: "workspace-meta",
      resolvedPath: workspaceId,
      ok: true,
      durationMs: 0,
      message: `${nextPinned ? "Pinned" : "Unpinned"} workspace ${workspaceTitle}`,
    });

    return {
      ok: true,
      workspaceId,
      pinned: nextPinned,
      pinnedAt,
      message: nextPinned
        ? `Pinned workspace: ${workspaceTitle}`
        : `Unpinned workspace: ${workspaceTitle}`,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      workspaceId,
      pinned: currentlyPinned,
      pinnedAt: null,
      message: `Failed to toggle pin for workspace ${workspaceId}: ${errorMsg}`,
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
        const [labelList, firstWsPage, sdkList] = await Promise.all([
          bridge.listWorkspaceLabels(),
          bridge.fetchWorkspaces({ limit: 200, page: { limit: 200 } }),
          context.paseo.workspaces.list().catch(() => ({ entries: [] })),
        ]);
        const catalog: WorkspaceLabelEntry[] = (labelList.labels ?? []).map((item) => ({
          name: item.name,
          color: normalizeLabelColor(item.color),
        }));
        const explicitClean = stripWorkspaceServerPrefix(input.workspaceId);
        const searchTarget = explicitClean || stripWorkspaceServerPrefix(workspaceId);
        let matchedWs = searchTarget
          ? firstWsPage.entries.find((w) => stripWorkspaceServerPrefix(w.id) === searchTarget)
          : firstWsPage.entries[0];

        // Paseo daemon paginates fetchWorkspaces at 200 entries per page (`page.cursor` / `pageInfo.nextCursor`).
        // Walk remaining pages when looking up a specific workspaceId beyond the first 200 workspaces!
        let nextCursor = firstWsPage.pageInfo?.nextCursor ?? null;
        let pageGuard = 0;
        while (!matchedWs && searchTarget && nextCursor && pageGuard < 25) {
          pageGuard += 1;
          const nextPage = await bridge.fetchWorkspaces({
            page: { limit: 200, cursor: nextCursor },
          });
          matchedWs = nextPage.entries.find(
            (w) => stripWorkspaceServerPrefix(w.id) === searchTarget,
          );
          nextCursor = nextPage.pageInfo?.nextCursor ?? null;
        }

        // Never fall back to `firstWsPage.entries[0]` (another session!) when an explicit workspaceId was requested
        if (!matchedWs && !explicitClean) {
          matchedWs = firstWsPage.entries[0];
        }
        const resolvedWsId = matchedWs?.id ?? (explicitClean || workspaceId);
        const matchedSdkWs = sdkList.entries.find(
          (w) => stripWorkspaceServerPrefix(w.id) === stripWorkspaceServerPrefix(resolvedWsId),
        );
        const workspaceTitle =
          matchedWs?.title ??
          (matchedSdkWs as { title?: string | null } | undefined)?.title ??
          (matchedWs?.name && matchedWs.name !== "main" ? matchedWs.name : undefined) ??
          (matchedSdkWs?.name && matchedSdkWs.name !== "main" ? matchedSdkWs.name : undefined) ??
          resolvedWsId;
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
          recentActions: getRecentActionLogs().slice(0, 8),
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
          target: "workspace-meta",
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
        recordActionLog({
          target: "workspace-meta",
          resolvedPath: `${targetWsId}#label:${labelName}:deleted`,
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

export interface ImportFolderWorkspaceOptions {
  readSettings?: () => Promise<
    | {
        status: "ready";
        values: {
          enableSidebarFolderDrop?: boolean;
          sidebarDropDefaultBehavior?: SidebarDropBehavior;
        };
      }
    | { status: "invalid"; error: string }
  >;
}

export async function handleImportFolderWorkspace(
  input: RpcInput<typeof importFolderWorkspaceRpc>,
  context: PluginHandlerContext,
  options?: ImportFolderWorkspaceOptions,
) {
  const startMs = Date.now();
  const dryRun = Boolean(input.dryRun);
  let defaultMode: SidebarDropBehavior = "open-or-create";

  if (options?.readSettings) {
    try {
      const settingsState = await options.readSettings();
      if (settingsState.status === "ready") {
        if (settingsState.values.sidebarDropDefaultBehavior) {
          defaultMode = settingsState.values.sidebarDropDefaultBehavior;
        }
        if (
          input.source === "sidebar-drop" &&
          settingsState.values.enableSidebarFolderDrop === false
        ) {
          const durationMs = Date.now() - startMs;
          const msg = "Sidebar folder drag & drop is disabled in plugin settings";
          return {
            ok: false,
            disabled: true,
            mode: input.mode ?? defaultMode,
            dryRun,
            primaryWorkspaceId: "",
            primaryProjectId: null,
            primaryDirectory: "",
            primaryWorkspaceName: "",
            createdCount: 0,
            reusedCount: 0,
            items: [] as ImportedWorkspaceItem[],
            message: msg,
            durationMs,
            recentActions: getRecentActionLogs(),
          };
        }
      }
    } catch {
      // Fallback to defaults if settings state is unavailable
    }
  }

  const mode: SidebarDropBehavior = input.mode ?? defaultMode;
  const customTitle = input.title?.trim() || undefined;
  const fallbackRoot = await resolveWorkspaceDirectory(context);

  const existingByDir = new Map<
    string,
    {
      id: string;
      name: string;
      title?: string | null;
      projectId?: string | null;
    }
  >();

  try {
    const existingList = await context.paseo.workspaces.list();
    for (const entry of existingList.entries) {
      if (!entry.workspaceDirectory) continue;
      const normDir = path.resolve(expandHome(entry.workspaceDirectory));
      if (!existingByDir.has(normDir)) {
        existingByDir.set(normDir, {
          id: entry.id,
          name: entry.name,
          title: (entry as { title?: string | null }).title ?? null,
          projectId: (entry as { projectId?: string | null }).projectId ?? null,
        });
      }
    }
  } catch {
    // Non-fatal if workspace listing fails
  }

  const items: ImportedWorkspaceItem[] = [];
  const seenDirectories = new Set<string>();
  let createdCount = 0;
  let reusedCount = 0;

  for (const rawInputPath of input.paths) {
    const cleaned = stripLineSuffix(expandHome(rawInputPath));
    if (!cleaned) continue;

    const absCandidate = path.isAbsolute(cleaned)
      ? path.resolve(cleaned)
      : path.resolve(fallbackRoot, cleaned);

    let targetDir = absCandidate;
    let fromFileParent = false;

    try {
      const stat = await fs.stat(absCandidate);
      if (!stat.isDirectory()) {
        targetDir = path.dirname(absCandidate);
        fromFileParent = true;
      }
    } catch (err) {
      items.push({
        inputPath: rawInputPath,
        resolvedDirectory: absCandidate,
        workspaceId: "",
        workspaceName: path.basename(absCandidate) || absCandidate,
        projectId: null,
        alreadyExisted: false,
        created: false,
        fromFileParent: false,
        error: err instanceof Error ? err.message : `Directory not found: ${absCandidate}`,
      });
      continue;
    }

    if (seenDirectories.has(targetDir)) {
      continue;
    }
    seenDirectories.add(targetDir);

    const existing = existingByDir.get(targetDir);
    const folderBaseName = path.basename(targetDir) || targetDir;

    if (dryRun) {
      const willReuse = Boolean(existing) && mode === "open-or-create";
      if (willReuse && existing) {
        reusedCount += 1;
        items.push({
          inputPath: rawInputPath,
          resolvedDirectory: targetDir,
          workspaceId: existing.id,
          workspaceName:
            existing.title ||
            (existing.name && existing.name !== "main" && existing.name !== "master"
              ? existing.name
              : folderBaseName),
          projectId: existing.projectId ?? null,
          alreadyExisted: true,
          created: false,
          fromFileParent,
          error: null,
        });
      } else {
        createdCount += 1;
        items.push({
          inputPath: rawInputPath,
          resolvedDirectory: targetDir,
          workspaceId: existing?.id ? `${existing.id} (will create new)` : "(will create)",
          workspaceName: customTitle || folderBaseName,
          projectId: existing?.projectId ?? null,
          alreadyExisted: Boolean(existing),
          created: true,
          fromFileParent,
          error: null,
        });
      }
      continue;
    }

    try {
      if (mode === "always-create") {
        const createdHandle = await context.paseo.workspaces.create({
          source: { kind: "directory", path: targetDir },
          ...(customTitle ? { title: customTitle } : {}),
        });
        createdCount += 1;
        const rawCreatedName = createdHandle.name ?? "";
        const resolvedName =
          customTitle ||
          (rawCreatedName && rawCreatedName !== "main" && rawCreatedName !== "master"
            ? rawCreatedName
            : folderBaseName);
        items.push({
          inputPath: rawInputPath,
          resolvedDirectory: targetDir,
          workspaceId: createdHandle.id,
          workspaceName: resolvedName,
          projectId: createdHandle.projectId ?? existing?.projectId ?? null,
          alreadyExisted: Boolean(existing),
          created: true,
          fromFileParent,
          error: null,
        });
        existingByDir.set(targetDir, {
          id: createdHandle.id,
          name: resolvedName,
          title: customTitle ?? null,
          projectId: createdHandle.projectId ?? null,
        });
      } else {
        const openedHandle = await context.paseo.workspaces.open(targetDir);
        const wasAlreadyActive = Boolean(existing && existing.id === openedHandle.id);
        if (!wasAlreadyActive && customTitle) {
          await openedHandle.setTitle(customTitle).catch(() => {});
        }
        if (wasAlreadyActive) {
          reusedCount += 1;
        } else {
          createdCount += 1;
        }
        const rawOpenedName = openedHandle.name || existing?.name || "";
        const resolvedName =
          (!wasAlreadyActive && customTitle) ||
          existing?.title ||
          (rawOpenedName && rawOpenedName !== "main" && rawOpenedName !== "master"
            ? rawOpenedName
            : folderBaseName);
        items.push({
          inputPath: rawInputPath,
          resolvedDirectory: targetDir,
          workspaceId: openedHandle.id,
          workspaceName: resolvedName,
          projectId: openedHandle.projectId ?? existing?.projectId ?? null,
          alreadyExisted: wasAlreadyActive,
          created: !wasAlreadyActive,
          fromFileParent,
          error: null,
        });
        existingByDir.set(targetDir, {
          id: openedHandle.id,
          name: resolvedName,
          title: customTitle ?? existing?.title ?? null,
          projectId: openedHandle.projectId ?? existing?.projectId ?? null,
        });
      }
    } catch (err) {
      items.push({
        inputPath: rawInputPath,
        resolvedDirectory: targetDir,
        workspaceId: "",
        workspaceName: folderBaseName,
        projectId: null,
        alreadyExisted: Boolean(existing),
        created: false,
        fromFileParent,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const succeededItems = items.filter((item) => !item.error && Boolean(item.workspaceId));
  const primary = succeededItems[succeededItems.length - 1] ?? items[0];
  const ok = succeededItems.length > 0;
  const durationMs = Date.now() - startMs;

  let message: string;
  if (!ok) {
    message = items[0]?.error ?? "No valid directories provided to import";
  } else if (dryRun) {
    if (primary.alreadyExisted && mode === "open-or-create") {
      message = `Dry-run: workspace already exists for "${primary.workspaceName}" (${primary.workspaceId}) — will switch without duplicating`;
    } else {
      message = `Dry-run: will create new workspace for "${primary.workspaceName}" (${primary.resolvedDirectory})`;
    }
  } else if (succeededItems.length === 1) {
    message = primary.created
      ? `Created workspace "${primary.workspaceName}" (${primary.workspaceId})`
      : `Switched to existing workspace "${primary.workspaceName}" (${primary.workspaceId})`;
  } else {
    message = `Imported ${succeededItems.length} workspaces (${createdCount} created, ${reusedCount} existing)`;
  }

  recordActionLog({
    target: "workspace-import",
    resolvedPath: primary?.resolvedDirectory ?? input.paths[0] ?? "",
    ok,
    durationMs,
    message,
  });

  return {
    ok,
    mode,
    dryRun,
    primaryWorkspaceId: primary?.workspaceId ?? "",
    primaryProjectId: primary?.projectId ?? null,
    primaryDirectory: primary?.resolvedDirectory ?? "",
    primaryWorkspaceName: primary?.workspaceName ?? "",
    createdCount,
    reusedCount,
    items,
    message,
    durationMs,
    recentActions: getRecentActionLogs(),
  };
}

function shortenHomePath(absPath: string): string {
  const home = os.homedir();
  const normalized = path.normalize(absPath);
  if (normalized === home) return "~";
  if (normalized.startsWith(`${home}${path.sep}`)) {
    return `~/${normalized.slice(home.length + 1)}`;
  }
  return normalized;
}

function pickWorkspaceTimestampMs(ws: {
  lastUserMessageAt?: string | null;
  activityAt?: string | null;
  updatedAt?: string | null;
  statusEnteredAt?: string | null;
  createdAt?: string | null;
}): number {
  for (const raw of [
    ws.lastUserMessageAt,
    ws.activityAt,
    ws.updatedAt,
    ws.statusEnteredAt,
    ws.createdAt,
  ]) {
    if (raw) {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return 0;
}

export interface QuickJumpWorkspaceOptions {
  readSettings?: () => Promise<
    | {
        status: "ready";
        values: {
          enableWorkspaceQuickJump?: boolean;
          quickJumpDefaultAction?: QuickJumpAction;
        };
      }
    | { status: string }
  >;
}

interface QuickJumpAgentSummary {
  agentId: string;
  shortId: string;
  workspaceId: string;
  title: string;
  providerSessionId: string | null;
}

let cachedQuickJumpAgentsByWorkspace: {
  atMs: number;
  byWorkspaceId: Map<string, QuickJumpAgentSummary[]>;
} | null = null;

async function loadQuickJumpAgentsByWorkspace(): Promise<Map<string, QuickJumpAgentSummary[]>> {
  const now = Date.now();
  if (cachedQuickJumpAgentsByWorkspace && now - cachedQuickJumpAgentsByWorkspace.atMs < 5_000) {
    return cachedQuickJumpAgentsByWorkspace.byWorkspaceId;
  }
  const byWorkspaceId = new Map<string, QuickJumpAgentSummary[]>();
  try {
    const agentsRoot = path.join(os.homedir(), ".paseo", "agents");
    const buckets = await fs.readdir(agentsRoot, { withFileTypes: true });
    const filePaths: string[] = [];
    for (const bucket of buckets) {
      if (!bucket.isDirectory()) continue;
      const bPath = path.join(agentsRoot, bucket.name);
      try {
        const files = await fs.readdir(bPath);
        for (const f of files) {
          if (f.endsWith(".json")) {
            filePaths.push(path.join(bPath, f));
          }
        }
      } catch {
        // Skip unreadable bucket
      }
    }
    const CHUNK_SIZE = 32;
    for (let i = 0; i < filePaths.length; i += CHUNK_SIZE) {
      const slice = filePaths.slice(i, i + CHUNK_SIZE);
      const records = await Promise.all(
        slice.map(async (filePath) => {
          try {
            const content = await fs.readFile(filePath, "utf8");
            return JSON.parse(content) as {
              id?: string;
              workspaceId?: string;
              title?: string | null;
              archivedAt?: string | null;
              labels?: Record<string, string>;
              persistence?: {
                sessionId?: string | null;
                metadata?: {
                  pluginProviderPersistence?: {
                    data?: { conversationId?: string | null };
                  };
                };
              };
            };
          } catch {
            return null;
          }
        }),
      );
      for (const rec of records) {
        if (!rec || !rec.id || !rec.workspaceId || rec.archivedAt) continue;
        if (rec.labels?.["paseo.internal"] === "true") continue;
        const aid = rec.id.trim();
        const wsId = rec.workspaceId.trim();
        const convId =
          rec.persistence?.metadata?.pluginProviderPersistence?.data?.conversationId ?? null;
        const list = byWorkspaceId.get(wsId) ?? [];
        list.push({
          agentId: aid,
          shortId: aid.slice(0, 8),
          workspaceId: wsId,
          title: String(rec.title ?? "").trim() || aid.slice(0, 8),
          providerSessionId: typeof convId === "string" && convId.trim() ? convId.trim() : null,
        });
        byWorkspaceId.set(wsId, list);
      }
    }
  } catch {
    // Ignore if ~/.paseo/agents does not exist
  }
  cachedQuickJumpAgentsByWorkspace = { atMs: now, byWorkspaceId };
  return byWorkspaceId;
}

export async function handleQuickJumpWorkspace(
  input: RpcInput<typeof quickJumpWorkspaceRpc>,
  context: PluginHandlerContext,
  options?: QuickJumpWorkspaceOptions,
) {
  const startMs = Date.now();
  const action = input.action ?? "list";
  const query = (input.query ?? "").trim();
  const dryRun = Boolean(input.dryRun);
  const limit = input.limit ?? 50;

  let defaultJumpMode: QuickJumpAction = "new-workspace";
  if (options?.readSettings) {
    try {
      const st = await options.readSettings();
      if (st.status === "ready" && "values" in st && st.values.quickJumpDefaultAction) {
        defaultJumpMode = st.values.quickJumpDefaultAction;
      }
    } catch {
      // Fallback to default
    }
  }
  const jumpMode: QuickJumpAction = input.jumpMode ?? defaultJumpMode;

  type RawProjectItem = {
    projectId: string;
    projectKey?: string | null;
    projectDisplayName?: string;
    projectCustomName?: string | null;
    projectRootPath?: string;
    projectKind?: "directory" | "git" | "non_git";
  };

  type RawWorkspaceItem = {
    id: string;
    projectId?: string | null;
    projectDisplayName?: string;
    projectCustomName?: string | null;
    projectRootPath?: string;
    workspaceDirectory?: string;
    projectKind?: "directory" | "git" | "non_git";
    workspaceKind?: string;
    name?: string;
    title?: string | null;
    pinnedAt?: string | null;
    internal?: boolean;
    background?: boolean;
    archivingAt?: string | null;
    status?: string;
    statusEnteredAt?: string | null;
    activityAt?: string | null;
    updatedAt?: string | null;
    createdAt?: string | null;
    lastUserMessageAt?: string | null;
  };

  let rawProjects: RawProjectItem[] = [];
  let rawWorkspaces: RawWorkspaceItem[] = [];

  try {
    if (context.paseo.projects?.list) {
      const projRes = await context.paseo.projects.list();
      if (Array.isArray(projRes?.projects)) {
        rawProjects = projRes.projects as RawProjectItem[];
      }
    }
  } catch {
    // Fallback to workspace-derived projects
  }

  try {
    const wsRes = await context.paseo.workspaces.list();
    if (Array.isArray(wsRes?.entries)) {
      rawWorkspaces = wsRes.entries as RawWorkspaceItem[];
    }
  } catch {
    // Ignore
  }

  const activeWorkspaces = rawWorkspaces.filter(
    (w) => !w.archivingAt && !w.internal && !w.background,
  );

  const projectMap = new Map<
    string,
    {
      projectId: string;
      projectKey: string | null;
      projectName: string;
      projectRootPath: string;
      projectKind: "directory" | "git" | "non_git";
      workspaces: RawWorkspaceItem[];
    }
  >();

  const projectByPath = new Map<string, string>();

  for (const p of rawProjects) {
    if (!p?.projectId) continue;
    const rootPath = path.normalize(expandHome(p.projectRootPath || os.homedir()));
    const name =
      (p.projectCustomName ?? "").trim() ||
      (p.projectDisplayName ?? "").trim() ||
      path.basename(rootPath) ||
      p.projectId;
    projectMap.set(p.projectId, {
      projectId: p.projectId,
      projectKey: p.projectKey ?? null,
      projectName: name,
      projectRootPath: rootPath,
      projectKind: p.projectKind ?? "directory",
      workspaces: [],
    });
    projectByPath.set(rootPath, p.projectId);
  }

  for (const ws of activeWorkspaces) {
    const wsRoot = path.normalize(
      expandHome(ws.projectRootPath || ws.workspaceDirectory || os.homedir()),
    );
    const resolvedProjectId =
      (ws.projectId && projectMap.has(ws.projectId) ? ws.projectId : null) ??
      projectByPath.get(wsRoot) ??
      ws.projectId ??
      `prj_dir_${path.basename(wsRoot)}`;

    let group = projectMap.get(resolvedProjectId);
    if (!group) {
      const fallbackName =
        (ws.projectCustomName ?? "").trim() ||
        (ws.projectDisplayName ?? "").trim() ||
        path.basename(wsRoot) ||
        resolvedProjectId;
      group = {
        projectId: resolvedProjectId,
        projectKey: null,
        projectName: fallbackName,
        projectRootPath: wsRoot,
        projectKind: ws.projectKind ?? "directory",
        workspaces: [],
      };
      projectMap.set(resolvedProjectId, group);
      projectByPath.set(wsRoot, resolvedProjectId);
    }
    group.workspaces.push(ws);
  }

  const agentsByWorkspaceId = await loadQuickJumpAgentsByWorkspace();
  const allCandidates: ProjectJumpCandidate[] = [];
  let emptyProjects = 0;
  const cleanQueryNeedle = query.trim().replace(/^#/, "").toLowerCase();

  for (const group of projectMap.values()) {
    const sortedWs = [...group.workspaces].sort((a, b) => {
      // 1. Pinned workspaces first
      const aPinned = Boolean(a.pinnedAt);
      const bPinned = Boolean(b.pinnedAt);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      // 2. Non-worktree (root directory) before isolated worktrees when timestamps are close
      const aIsRoot = a.workspaceKind !== "worktree";
      const bIsRoot = b.workspaceKind !== "worktree";
      const aTime = pickWorkspaceTimestampMs(a);
      const bTime = pickWorkspaceTimestampMs(b);
      if (Math.abs(aTime - bTime) > 60_000 && aTime !== bTime) {
        return bTime - aTime;
      }
      if (aIsRoot !== bIsRoot) return aIsRoot ? -1 : 1;
      return bTime - aTime;
    });

    const primaryWs = sortedWs[0] ?? null;
    const latestMs = sortedWs.reduce(
      (max, w) => Math.max(max, pickWorkspaceTimestampMs(w)),
      0,
    );
    const lastActivityIso = latestMs > 0 ? new Date(latestMs).toISOString() : null;
    const lastActivityRelative = latestMs > 0 ? formatRelativeTime(latestMs) : "idle";
    const hasRunningAgent = sortedWs.some(
      (w) =>
        w.status === "running" ||
        w.status === "needs_input" ||
        w.status === "attention",
    );
    if (sortedWs.length === 0) {
      emptyProjects += 1;
    }

    const shortPath = shortenHomePath(group.projectRootPath);
    const primaryTitle =
      (primaryWs?.title ?? "").trim() || (primaryWs?.name ?? "").trim() || null;

    const searchTokens: string[] = [];
    let matchedWorkspaceId: string | null = null;
    let matchedAgentId: string | null = null;
    let matchedAgentShortId: string | null = null;
    let matchedAgentTitle: string | null = null;

    for (const w of sortedWs) {
      if (w.id) {
        searchTokens.push(w.id);
        const wTitle = (w.title ?? w.name ?? "").trim();
        if (wTitle) searchTokens.push(wTitle);
        if (
          cleanQueryNeedle.length >= 4 &&
          !matchedWorkspaceId &&
          (w.id.toLowerCase() === cleanQueryNeedle ||
            w.id.toLowerCase().replace(/^wks_/, "").startsWith(cleanQueryNeedle))
        ) {
          matchedWorkspaceId = w.id;
        }
        const wsAgents = agentsByWorkspaceId.get(w.id) ?? [];
        for (const ag of wsAgents) {
          searchTokens.push(ag.agentId, ag.shortId, ag.agentId.slice(0, 7), ag.title);
          if (ag.providerSessionId) {
            searchTokens.push(ag.providerSessionId);
          }
          if (
            cleanQueryNeedle.length >= 4 &&
            !matchedAgentId &&
            (ag.agentId.toLowerCase().startsWith(cleanQueryNeedle) ||
              (ag.providerSessionId &&
                ag.providerSessionId.toLowerCase().startsWith(cleanQueryNeedle)))
          ) {
            matchedWorkspaceId = w.id;
            matchedAgentId = ag.agentId;
            matchedAgentShortId = ag.agentId.slice(0, 7);
            matchedAgentTitle = ag.title;
          }
        }
      }
    }

    const baseScore = scoreProjectJumpQuery(
      {
        projectName: group.projectName,
        projectRootPath: group.projectRootPath,
        shortPath,
        primaryWorkspaceTitle: primaryTitle,
        workspaceIds: sortedWs.map((w) => w.id),
        searchTokens,
      },
      query,
    );

    allCandidates.push({
      projectId: group.projectId,
      projectKey: group.projectKey,
      projectName: group.projectName,
      projectRootPath: group.projectRootPath,
      shortPath,
      projectKind: group.projectKind,
      activeWorkspaceCount: sortedWs.length,
      primaryWorkspaceId: primaryWs?.id ?? null,
      primaryWorkspaceTitle: primaryTitle,
      workspaceIds: sortedWs.map((w) => w.id),
      searchTokens,
      matchedWorkspaceId,
      matchedAgentId,
      matchedAgentShortId,
      matchedAgentTitle,
      hasRunningAgent,
      lastActivityIso,
      lastActivityRelative,
      score: baseScore,
    });
  }

  const matchedCandidates = allCandidates
    .filter((c) => c.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aMs = a.lastActivityIso ? Date.parse(a.lastActivityIso) : 0;
      const bMs = b.lastActivityIso ? Date.parse(b.lastActivityIso) : 0;
      if (bMs !== aMs) return bMs - aMs;
      if (b.activeWorkspaceCount !== a.activeWorkspaceCount) {
        return b.activeWorkspaceCount - a.activeWorkspaceCount;
      }
      return a.projectName.localeCompare(b.projectName);
    })
    .slice(0, limit);

  if (action === "list") {
    return {
      ok: true,
      action: "list" as const,
      jumpMode,
      dryRun,
      query,
      totalProjects: allCandidates.length,
      totalActiveWorkspaces: activeWorkspaces.length,
      emptyProjects,
      candidates: matchedCandidates,
      selectedCandidate: matchedCandidates[0] ?? null,
      targetWorkspaceId:
        matchedCandidates[0]?.matchedWorkspaceId ??
        matchedCandidates[0]?.primaryWorkspaceId ??
        null,
      targetAgentId: matchedCandidates[0]?.matchedAgentId ?? null,
      targetProjectId: matchedCandidates[0]?.projectId ?? null,
      targetProjectKey: matchedCandidates[0]?.projectKey ?? null,
      targetProjectName: matchedCandidates[0]?.projectName ?? null,
      targetDirectory: matchedCandidates[0]?.projectRootPath ?? null,
      createdWorkspace: false,
      message: `Indexed ${allCandidates.length} project workspaces (${matchedCandidates.length} matched${query ? ` for "${query}"` : ""})`,
      durationMs: Date.now() - startMs,
      recentActions: getRecentActionLogs().slice(0, 8),
    };
  }

  // action === "jump"
  const explicitProjectId = (input.projectId ?? "").trim();
  const targetCandidate = explicitProjectId
    ? allCandidates.find(
        (c) =>
          c.projectId === explicitProjectId ||
          c.projectKey === explicitProjectId ||
          c.primaryWorkspaceId === explicitProjectId ||
          Boolean(c.workspaceIds?.includes(explicitProjectId)) ||
          Boolean(c.searchTokens?.some((t) => t.toLowerCase() === explicitProjectId.toLowerCase())) ||
          c.projectName.toLowerCase() === explicitProjectId.toLowerCase(),
      ) ?? matchedCandidates[0] ?? null
    : matchedCandidates[0] ?? null;

  if (!targetCandidate) {
    const durationMs = Date.now() - startMs;
    const msg = query
      ? `No project workspace matched "${query}"`
      : "No project workspace found to jump to";
    return {
      ok: false,
      action: "jump" as const,
      jumpMode,
      dryRun,
      query,
      totalProjects: allCandidates.length,
      totalActiveWorkspaces: activeWorkspaces.length,
      emptyProjects,
      candidates: matchedCandidates,
      selectedCandidate: null,
      targetWorkspaceId: null,
      targetAgentId: null,
      targetProjectId: null,
      targetProjectKey: null,
      targetProjectName: null,
      targetDirectory: null,
      createdWorkspace: false,
      message: msg,
      durationMs,
      recentActions: getRecentActionLogs().slice(0, 8),
    };
  }

  const hasSpecificSessionMatch = Boolean(
    targetCandidate.matchedWorkspaceId || targetCandidate.matchedAgentId,
  );
  const effectiveJumpMode: QuickJumpAction =
    hasSpecificSessionMatch && !input.jumpMode && jumpMode === "new-workspace"
      ? "open-latest"
      : jumpMode;

  let targetWorkspaceId: string | null =
    targetCandidate.matchedWorkspaceId ?? targetCandidate.primaryWorkspaceId;
  const targetAgentId: string | null = targetCandidate.matchedAgentId ?? null;
  let createdWorkspace = false;
  let message = "";

  try {
    if (effectiveJumpMode === "locate-sidebar") {
      targetWorkspaceId = null;
      message = dryRun
        ? `Dry-run: will expand and scroll sidebar to "${targetCandidate.projectName}" (${targetCandidate.activeWorkspaceCount} threads)`
        : `Located "${targetCandidate.projectName}" in sidebar (${targetCandidate.activeWorkspaceCount} threads)`;
    } else if (effectiveJumpMode === "new-workspace") {
      targetWorkspaceId = null;
      message = dryRun
        ? `Dry-run: will open New Workspace composer for "${targetCandidate.projectName}" (${targetCandidate.shortPath})`
        : `Opened New Workspace in "${targetCandidate.projectName}"`;
    } else if (effectiveJumpMode === "create-new") {
      if (dryRun) {
        message = `Dry-run: will create a fresh workspace inside "${targetCandidate.projectName}" (${targetCandidate.shortPath})`;
      } else {
        const importRes = await handleImportFolderWorkspace(
          {
            paths: [targetCandidate.projectRootPath],
            mode: "always-create",
            source: "ui",
          },
          context,
        );
        if (importRes.ok && importRes.primaryWorkspaceId) {
          targetWorkspaceId = importRes.primaryWorkspaceId;
          createdWorkspace = true;
          message = `Created fresh workspace in "${targetCandidate.projectName}" (${targetWorkspaceId})`;
        } else {
          message = importRes.message;
        }
      }
    } else {
      // effectiveJumpMode === "open-latest"
      if (targetWorkspaceId) {
        const agentSuffix = targetCandidate.matchedAgentShortId
          ? ` · agent #${targetCandidate.matchedAgentShortId}`
          : "";
        message = dryRun
          ? `Dry-run: will jump to "${targetCandidate.projectName}" (${targetWorkspaceId}${agentSuffix}, ${targetCandidate.activeWorkspaceCount} threads)`
          : `Jumped to "${targetCandidate.projectName}" (${targetWorkspaceId}${agentSuffix})`;
      } else if (dryRun) {
        message = `Dry-run: "${targetCandidate.projectName}" has 0 active threads — will open clean workspace in ${targetCandidate.shortPath}`;
      } else {
        const importRes = await handleImportFolderWorkspace(
          {
            paths: [targetCandidate.projectRootPath],
            mode: "open-or-create",
            source: "ui",
          },
          context,
        );
        if (importRes.ok && importRes.primaryWorkspaceId) {
          targetWorkspaceId = importRes.primaryWorkspaceId;
          createdWorkspace = importRes.createdCount > 0;
          message = `Opened workspace "${targetCandidate.projectName}" (${targetWorkspaceId})`;
        } else {
          message = importRes.message;
        }
      }
    }
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }

  const durationMs = Date.now() - startMs;
  const ok =
    effectiveJumpMode === "locate-sidebar" || effectiveJumpMode === "new-workspace"
      ? true
      : Boolean(targetWorkspaceId) || dryRun;

  recordActionLog({
    target: "workspace-jump",
    resolvedPath: `${targetCandidate.projectName}${targetWorkspaceId ? `#${targetWorkspaceId}` : "#sidebar"}`,
    ok,
    durationMs,
    message,
  });

  return {
    ok,
    action: "jump" as const,
    jumpMode: effectiveJumpMode,
    dryRun,
    query,
    totalProjects: allCandidates.length,
    totalActiveWorkspaces: activeWorkspaces.length,
    emptyProjects,
    candidates: matchedCandidates,
    selectedCandidate: targetCandidate,
    targetWorkspaceId,
    targetAgentId,
    targetProjectId: targetCandidate.projectId,
    targetProjectKey: targetCandidate.projectKey,
    targetProjectName: targetCandidate.projectName,
    targetDirectory: targetCandidate.projectRootPath,
    createdWorkspace,
    message,
    durationMs,
    recentActions: getRecentActionLogs().slice(0, 8),
  };
}

export * from "./schedule-runs-handlers";
export * from "./voice-stt-handlers";
export * from "./agent-history-handlers";





