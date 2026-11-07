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
    enableQuickRenameAndLabelShortcuts: z.boolean().default(true),
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
  target: OpenerTargetSchema,
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
  }),
  output: z.object({
    ok: z.boolean(),
    workspaceId: z.string(),
    title: z.string().nullable(),
    message: z.string(),
    durationMs: z.number(),
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
  }),
});

