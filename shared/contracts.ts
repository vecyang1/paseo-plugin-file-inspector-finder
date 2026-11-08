import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const SUPPORTED_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
  "heic",
  "tif",
  "tiff",
] as const;

export const OpenerTargetSchema = z.enum([
  "finder-reveal",
  "finder-folder",
  "system-preview",
  "quicklook",
  "antigravity",
  "cursor",
  "vscode",
  "terminal",
]);

export type OpenerTarget = z.infer<typeof OpenerTargetSchema>;

export const SidebarDropBehaviorSchema = z.enum(["open-or-create", "always-create"]);

export type SidebarDropBehavior = z.infer<typeof SidebarDropBehaviorSchema>;

export const QuickJumpActionSchema = z.enum(["open-latest", "locate-sidebar", "create-new"]);

export type QuickJumpAction = z.infer<typeof QuickJumpActionSchema>;

export const ActionLogTargetSchema = z.union([
  OpenerTargetSchema,
  z.literal("workspace-import"),
  z.literal("workspace-meta"),
  z.literal("workspace-jump"),
]);

export type ActionLogTarget = z.infer<typeof ActionLogTargetSchema>;

export const WORKSPACE_LABEL_COLORS = [
  "violet",
  "sky",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue",
] as const;

export const WorkspaceLabelColorSchema = z.enum(WORKSPACE_LABEL_COLORS);

export type WorkspaceLabelColor = z.infer<typeof WorkspaceLabelColorSchema>;

export const WorkspaceLabelEntrySchema = z.object({
  name: z.string(),
  color: WorkspaceLabelColorSchema,
});

export type WorkspaceLabelEntry = z.infer<typeof WorkspaceLabelEntrySchema>;

export const InlineRenameSourceSchema = z.enum([
  "inline-sidebar",
  "inline-header",
  "inline-tab",
  "f2-inline",
  "slash-command",
  "ui",
  "agent-tool",
]);

export type InlineRenameSource = z.infer<typeof InlineRenameSourceSchema>;

export const pluginSettings = defineSettings({
  id: "finder-settings",
  scope: "host",
  version: 1,
  schema: z.object({
    defaultPrimaryAction: OpenerTargetSchema.default("finder-reveal"),
    preferredCodeEditor: z.enum(["antigravity", "cursor", "vscode"]).default("antigravity"),
    maxRecentFiles: z.number().int().min(5).max(100).default(24),
    autoAssociateImagePanels: z.boolean().default(true),
    enableDesktopContextMenuHelper: z.boolean().default(true),
    enableInlineDoubleClickRename: z.boolean().default(true),
    enableQuickRenameAndLabelShortcuts: z.boolean().default(true),
    enableSidebarFolderDrop: z.boolean().default(true),
    sidebarDropDefaultBehavior: SidebarDropBehaviorSchema.default("open-or-create"),
    enableWorkspaceQuickJump: z.boolean().default(true),
    enableCommandCenterProjectItems: z.boolean().default(true),
    quickJumpDefaultAction: QuickJumpActionSchema.default("open-latest"),
    showComposerPill: z.boolean().default(false),
    defaultCanvasBackground: z.enum(["dark", "checker", "light"]).default("checker"),
  }),
});

export const FileMetadataSchema = z.object({
  exists: z.boolean(),
  absolutePath: z.string(),
  relativePath: z.string(),
  parentDir: z.string(),
  fileName: z.string(),
  extension: z.string(),
  isDirectory: z.boolean(),
  sizeBytes: z.number(),
  sizeFormatted: z.string(),
  modifiedIso: z.string(),
  modifiedRelative: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  error: z.string().nullable(),
});

export type FileMetadata = z.infer<typeof FileMetadataSchema>;

export const ActionLogEntrySchema = z.object({
  id: z.string(),
  timestampIso: z.string(),
  target: ActionLogTargetSchema,
  resolvedPath: z.string(),
  ok: z.boolean(),
  durationMs: z.number(),
  message: z.string(),
});

export type ActionLogEntry = z.infer<typeof ActionLogEntrySchema>;

export const inspectFileRpc = defineRpc({
  name: "finder.inspect_file",
  input: z.object({
    workspaceId: z.string().optional(),
    workspaceRoot: z.string().optional(),
    path: z.string(),
  }),
  output: FileMetadataSchema,
});

export const openFileTargetRpc = defineRpc({
  name: "finder.open_target",
  input: z.object({
    workspaceId: z.string().optional(),
    workspaceRoot: z.string().optional(),
    path: z.string(),
    target: OpenerTargetSchema,
  }),
  output: z.object({
    ok: z.boolean(),
    resolvedPath: z.string(),
    parentDir: z.string(),
    target: OpenerTargetSchema,
    message: z.string(),
    durationMs: z.number(),
  }),
});

export const listWorkspaceMediaRpc = defineRpc({
  name: "finder.list_workspace_media",
  input: z.object({
    workspaceId: z.string().optional(),
    workspaceRoot: z.string().optional(),
    query: z.string().optional(),
    onlyImages: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  output: z.object({
    workspaceRoot: z.string(),
    scannedAtIso: z.string(),
    totalFound: z.number(),
    items: z.array(FileMetadataSchema),
    recentActions: z.array(ActionLogEntrySchema),
  }),
});

export const diagnosePathRpc = defineRpc({
  name: "finder.diagnose_path",
  input: z.object({
    workspaceId: z.string().optional(),
    workspaceRoot: z.string().optional(),
    rawInput: z.string(),
  }),
  output: z.object({
    rawInput: z.string(),
    workspaceRoot: z.string(),
    candidatePaths: z.array(z.string()),
    resolvedMetadata: FileMetadataSchema,
    availableTargets: z.array(
      z.object({
        target: OpenerTargetSchema,
        label: z.string(),
        available: z.boolean(),
        commandPreview: z.string(),
      }),
    ),
    recentActions: z.array(ActionLogEntrySchema),
  }),
});

export const renameWorkspaceOrAgentRpc = defineRpc({
  name: "finder.rename_thread",
  input: z.object({
    workspaceId: z.string().optional(),
    agentId: z.string().optional(),
    title: z.string().nullable(),
    source: InlineRenameSourceSchema.optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    workspaceId: z.string(),
    title: z.string().nullable(),
    message: z.string(),
    durationMs: z.number(),
    recentActions: z.array(ActionLogEntrySchema).optional(),
  }),
});

export const manageWorkspaceLabelsRpc = defineRpc({
  name: "finder.manage_labels",
  input: z.object({
    action: z
      .enum(["inspect", "toggle", "assign", "unassign", "update", "delete"])
      .default("inspect"),
    workspaceId: z.string().optional(),
    labelName: z.string().optional(),
    newName: z.string().optional(),
    color: WorkspaceLabelColorSchema.optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    workspaceId: z.string(),
    workspaceTitle: z.string(),
    assignedLabels: z.array(z.string()),
    catalog: z.array(WorkspaceLabelEntrySchema),
    message: z.string(),
    durationMs: z.number(),
    recentActions: z.array(ActionLogEntrySchema).optional(),
  }),
});

export const ImportedWorkspaceItemSchema = z.object({
  inputPath: z.string(),
  resolvedDirectory: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  projectId: z.string().nullable(),
  alreadyExisted: z.boolean(),
  created: z.boolean(),
  fromFileParent: z.boolean(),
  error: z.string().nullable(),
});

export type ImportedWorkspaceItem = z.infer<typeof ImportedWorkspaceItemSchema>;

export const importFolderWorkspaceRpc = defineRpc({
  name: "finder.import_folder_workspace",
  input: z.object({
    paths: z.array(z.string()).min(1),
    mode: SidebarDropBehaviorSchema.optional(),
    dryRun: z.boolean().optional(),
    title: z.string().optional(),
    source: z.enum(["sidebar-drop", "ui", "slash-command", "agent-tool"]).optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    disabled: z.boolean().optional(),
    mode: SidebarDropBehaviorSchema,
    dryRun: z.boolean(),
    primaryWorkspaceId: z.string(),
    primaryProjectId: z.string().nullable(),
    primaryDirectory: z.string(),
    primaryWorkspaceName: z.string(),
    createdCount: z.number(),
    reusedCount: z.number(),
    items: z.array(ImportedWorkspaceItemSchema),
    message: z.string(),
    durationMs: z.number(),
    recentActions: z.array(ActionLogEntrySchema),
  }),
});

export const ProjectJumpCandidateSchema = z.object({
  projectId: z.string(),
  projectKey: z.string().nullable(),
  projectName: z.string(),
  projectRootPath: z.string(),
  shortPath: z.string(),
  projectKind: z.enum(["directory", "git", "non_git"]),
  activeWorkspaceCount: z.number(),
  primaryWorkspaceId: z.string().nullable(),
  primaryWorkspaceTitle: z.string().nullable(),
  hasRunningAgent: z.boolean(),
  lastActivityIso: z.string().nullable(),
  lastActivityRelative: z.string(),
  score: z.number(),
});

export type ProjectJumpCandidate = z.infer<typeof ProjectJumpCandidateSchema>;

export const quickJumpWorkspaceRpc = defineRpc({
  name: "finder.quick_jump_projects",
  input: z.object({
    action: z.enum(["list", "jump"]).default("list"),
    query: z.string().optional(),
    projectId: z.string().optional(),
    jumpMode: QuickJumpActionSchema.optional(),
    dryRun: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    source: z
      .enum(["quick-switcher", "command-center", "slash-command", "ui", "agent-tool"])
      .optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    action: z.enum(["list", "jump"]),
    jumpMode: QuickJumpActionSchema,
    dryRun: z.boolean(),
    query: z.string(),
    totalProjects: z.number(),
    totalActiveWorkspaces: z.number(),
    emptyProjects: z.number(),
    candidates: z.array(ProjectJumpCandidateSchema),
    selectedCandidate: ProjectJumpCandidateSchema.nullable(),
    targetWorkspaceId: z.string().nullable(),
    targetProjectId: z.string().nullable(),
    targetProjectKey: z.string().nullable(),
    targetProjectName: z.string().nullable(),
    targetDirectory: z.string().nullable(),
    createdWorkspace: z.boolean(),
    message: z.string(),
    durationMs: z.number(),
    recentActions: z.array(ActionLogEntrySchema),
  }),
});

export function stripLeadingDatePrefix(name: string): string {
  return name
    .trim()
    .replace(/^(?:\d{2,4}[._-]\d{1,2}[._-]\d{1,2}|\d{6,8})[\s._-]*/u, "")
    .trim();
}

export function extractProjectSearchKeywords(
  projectName: string,
  projectRootPath: string,
): string[] {
  const keywords = new Set<string>(["jump", "workspace", "project", "folder", "go", "switch"]);
  const push = (val?: string | null) => {
    const cleaned = (val ?? "").trim().toLowerCase();
    if (cleaned.length >= 2) {
      keywords.add(cleaned);
    }
  };
  push(projectName);
  const stripped = stripLeadingDatePrefix(projectName);
  push(stripped);

  const pathParts = projectRootPath.split(/[/\\]+/).filter(Boolean);
  const baseName = pathParts[pathParts.length - 1] ?? "";
  push(baseName);
  push(stripLeadingDatePrefix(baseName));
  if (pathParts.length >= 2) {
    push(pathParts[pathParts.length - 2]);
  }

  const wordTokens = `${projectName} ${baseName}`
    .toLowerCase()
    .split(/[\s._/-]+/)
    .filter(Boolean);
  for (const tok of wordTokens) {
    push(tok);
  }

  const alphaWords = stripped
    .toLowerCase()
    .split(/[\s._/-]+/)
    .filter((w) => w.length > 0 && !/^\d+$/.test(w));
  if (alphaWords.length >= 2) {
    const acronym = alphaWords.map((w) => w[0]).join("");
    push(acronym);
  }

  return Array.from(keywords);
}

function isSubsequenceMatch(needle: string, haystack: string): boolean {
  if (!needle || needle.length > haystack.length) return false;
  let ni = 0;
  for (let hi = 0; hi < haystack.length && ni < needle.length; hi += 1) {
    if (haystack[hi] === needle[ni]) {
      ni += 1;
    }
  }
  return ni === needle.length;
}

export function scoreProjectJumpQuery(
  candidate: Pick<
    ProjectJumpCandidate,
    "projectName" | "projectRootPath" | "shortPath" | "primaryWorkspaceTitle"
  >,
  rawQuery?: string | null,
): number {
  const trimmed = (rawQuery ?? "").trim().toLowerCase();
  if (!trimmed) return 100;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 100;

  const nameLower = candidate.projectName.trim().toLowerCase();
  const strippedLower = stripLeadingDatePrefix(candidate.projectName).toLowerCase();
  const pathParts = candidate.projectRootPath.split(/[/\\]+/).filter(Boolean);
  const baseLower = (pathParts[pathParts.length - 1] ?? "").toLowerCase();
  const shortLower = candidate.shortPath.toLowerCase();
  const titleLower = (candidate.primaryWorkspaceTitle ?? "").toLowerCase();

  const words = `${nameLower} ${baseLower}`.split(/[\s._/-]+/).filter(Boolean);
  const alphaWords = strippedLower
    .split(/[\s._/-]+/)
    .filter((w) => w.length > 0 && !/^\d+$/.test(w));
  const acronym = alphaWords.map((w) => w[0]).join("");

  let totalScore = 0;
  for (const token of tokens) {
    let tokenScore = 0;
    if (nameLower === token || strippedLower === token || baseLower === token) {
      tokenScore = 1000;
    } else if (strippedLower.startsWith(token) || nameLower.startsWith(token)) {
      tokenScore = 880;
    } else if (words.some((w) => w === token)) {
      tokenScore = 820;
    } else if (words.some((w) => w.startsWith(token))) {
      tokenScore = 760;
    } else if (acronym.length >= 2 && acronym.startsWith(token)) {
      tokenScore = 720;
    } else if (strippedLower.includes(token) || nameLower.includes(token)) {
      tokenScore = 640;
    } else if (baseLower.includes(token)) {
      tokenScore = 560;
    } else if (shortLower.includes(token)) {
      tokenScore = 420;
    } else if (token.length >= 2 && isSubsequenceMatch(token, strippedLower.replace(/\s+/g, ""))) {
      tokenScore = 300;
    } else if (titleLower.includes(token)) {
      tokenScore = 180;
    }

    if (tokenScore === 0) {
      return 0;
    }
    totalScore += tokenScore;
  }

  return totalScore;
}




