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
  "system-default",
  "quicklook",
  "antigravity",
  "cursor",
  "vscode",
  "terminal",
]);

export type OpenerTarget = z.infer<typeof OpenerTargetSchema>;

export const SidebarDropBehaviorSchema = z.enum(["open-or-create", "always-create"]);

export type SidebarDropBehavior = z.infer<typeof SidebarDropBehaviorSchema>;

export const QuickJumpActionSchema = z.enum([
  "new-workspace",
  "open-latest",
  "locate-sidebar",
  "create-new",
]);

export type QuickJumpAction = z.infer<typeof QuickJumpActionSchema>;

export const ActionLogTargetSchema = z.union([
  OpenerTargetSchema,
  z.literal("workspace-import"),
  z.literal("workspace-meta"),
  z.literal("workspace-jump"),
  z.literal("voice-stt"),
  z.literal("agent-history"),
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
  "mark-done-shortcut",
  "ui",
  "agent-tool",
]);

export type InlineRenameSource = z.infer<typeof InlineRenameSourceSchema>;

export const InlineRenameCaretPositionSchema = z.enum([
  "start",
  "select-all",
  "end",
]);

export type InlineRenameCaretPosition = z.infer<
  typeof InlineRenameCaretPositionSchema
>;

export const SmartCopyModeSchema = z.enum(["smart", "markdown", "plain"]);
export type SmartCopyMode = z.infer<typeof SmartCopyModeSchema>;

export const LabelShortcutComboSchema = z.enum([
  "cmd_l",
  "cmd_shift_l",
  "both",
]);
export type LabelShortcutCombo = z.infer<typeof LabelShortcutComboSchema>;

export const ProjectPickerShortcutPresetSchema = z.enum([
  "alt_p",
  "cmd_shift_j",
  "cmd_alt_o",
  "cmd_p",
  "custom",
]);
export type ProjectPickerShortcutPreset = z.infer<
  typeof ProjectPickerShortcutPresetSchema
>;

export const SidebarGroupingPresetSchema = z.enum([
  "cmd_ctrl_p_s",
  "cmd_alt_p_s",
  "ctrl_shift_p_s",
  "custom",
]);
export type SidebarGroupingPreset = z.infer<
  typeof SidebarGroupingPresetSchema
>;

export const SmartCopyBulletMarkerSchema = z.enum(["bullet", "dash"]);
export type SmartCopyBulletMarker = z.infer<typeof SmartCopyBulletMarkerSchema>;

export const SmartCopyLinkFormatSchema = z.enum(["label-only", "label-with-url", "markdown"]);
export type SmartCopyLinkFormat = z.infer<typeof SmartCopyLinkFormatSchema>;

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
    enableCmdClickOpenSystemDefault: z.boolean().default(true),
    cmdClickDefaultTarget: OpenerTargetSchema.default("system-default"),
    enableSidebarCmdClickFinder: z.boolean().default(true),
    enableInlineDoubleClickRename: z.boolean().default(true),
    autoJumpToFirstPlaceInput: z.boolean().default(true),
    inlineRenameCaretPosition: InlineRenameCaretPositionSchema.default("start"),
    enableQuickRenameAndLabelShortcuts: z.boolean().default(true),
    enableThreadNavigationShortcuts: z.boolean().default(true),
    enablePinWorkspaceShortcut: z.boolean().default(true),
    labelShortcutCombo: LabelShortcutComboSchema.default("both"),
    enableMarkDoneShortcut: z.boolean().default(true),
    markDonePrefix: z.string().default("d "),
    enableSidebarDeleteKeyArchive: z.boolean().default(true),
    enableSmartClipboardCopy: z.boolean().default(true),
    defaultClipboardCopyMode: SmartCopyModeSchema.default("smart"),
    smartCopyBulletMarker: SmartCopyBulletMarkerSchema.default("bullet"),
    smartCopyLinkFormat: SmartCopyLinkFormatSchema.default("label-only"),
    enableMarkdownTableEnhancer: z.boolean().default(true),
    enableLatexMathRendering: z.boolean().default(true),
    enableSessionFinishedTimeEnhancer: z.boolean().default(true),
    sessionTimeClockFormat: z.enum(["24h", "12h"]).default("24h"),
    showFinishedTimeInSidebar: z.boolean().default(true),
    showRelativeAgeInTurnFooter: z.boolean().default(true),
    enableSidebarFolderDrop: z.boolean().default(true),
    sidebarDropDefaultBehavior: SidebarDropBehaviorSchema.default("open-or-create"),
    enableWorkspaceQuickJump: z.boolean().default(true),
    enableCommandCenterProjectItems: z.boolean().default(true),
    dedupeCommandCenterAgentRows: z.boolean().default(true),
    autoRevealActiveWorkspaceInSidebar: z.boolean().default(true),
    startNewProjectsCollapsed: z.boolean().default(true),
    enableSettingsSearch: z.boolean().default(true),
    settingsSearchShortcut: z.boolean().default(true),
    quickJumpDefaultAction: QuickJumpActionSchema.default("new-workspace"),
    enableScheduleRunsInspector: z.boolean().default(true),
    enableVoiceCustomModelHelper: z.boolean().default(true),
    dictationSendBehavior: z.enum(["insert-only", "native"]).default("insert-only"),
    enableModelQuickSwitch: z.boolean().default(true),
    modelQuickSwitchDigits: z.enum(["empty-search", "modifier-only"]).default("empty-search"),
    enableProjectPickerShortcut: z.boolean().default(true),
    projectPickerShortcutPreset: ProjectPickerShortcutPresetSchema.default("alt_p"),
    projectPickerCustomShortcut: z.string().default("Alt+P"),
    enableSidebarGroupingShortcuts: z.boolean().default(true),
    sidebarGroupingPreset: SidebarGroupingPresetSchema.default("cmd_ctrl_p_s"),
    sidebarGroupingProjectShortcut: z.string().default("Cmd+Ctrl+P"),
    sidebarGroupingStatusShortcut: z.string().default("Cmd+Ctrl+S"),
    sidebarGroupingToggleOnRePress: z.boolean().default(false),
    enableAgentHistoryAutoHeal: z.boolean().default(true),
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
    projectName: z.string().optional(),
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

export const archiveWorkspaceRpc = defineRpc({
  name: "finder.archive_workspace",
  input: z.object({
    workspaceId: z.string(),
    dryRun: z.boolean().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    workspaceId: z.string(),
    archivedAt: z.string().nullable().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
});

export const toggleWorkspacePinRpc = defineRpc({
  name: "finder.toggle_workspace_pin",
  input: z.object({
    workspaceId: z.string().optional(),
    pinned: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    workspaceId: z.string(),
    pinned: z.boolean(),
    pinnedAt: z.union([z.string(), z.number()]).nullable().optional(),
    message: z.string(),
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
  workspaceIds: z.array(z.string()).optional(),
  searchTokens: z.array(z.string()).optional(),
  matchedWorkspaceId: z.string().nullable().optional(),
  matchedAgentId: z.string().nullable().optional(),
  matchedAgentShortId: z.string().nullable().optional(),
  matchedAgentTitle: z.string().nullable().optional(),
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
    targetAgentId: z.string().nullable().optional(),
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

export const VoiceSttPresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  labelZh: z.string(),
  provider: z.enum(["openai", "local"]),
  model: z.string(),
  baseUrl: z.string(),
  directBaseUrl: z.string(),
  badge: z.string(),
  freeTier: z.boolean(),
  description: z.string(),
  descriptionZh: z.string(),
});

export type VoiceSttPreset = z.infer<typeof VoiceSttPresetSchema>;

export const VOICE_STT_PRESETS: readonly VoiceSttPreset[] = [
  {
    id: "siliconflow-sensevoice-free",
    label: "SiliconFlow Free · SenseVoiceSmall",
    labelZh: "硅基流动免费 · SenseVoiceSmall",
    provider: "openai",
    model: "FunAudioLLM/SenseVoiceSmall",
    baseUrl: "http://127.0.0.1:8787/v1",
    directBaseUrl: "https://api.siliconflow.cn/v1",
    badge: "FREE · ~0.9s",
    freeTier: true,
    description: "Zero-cost high-speed multilingual ASR (CN/EN/JA/Cantonese) via SiliconFlow",
    descriptionZh: "硅基流动免费极速多语种语音识别（中/英/日/粤）",
  },
  {
    id: "siliconflow-qwen3-asr",
    label: "OpenWhispr SOTA · Qwen3-ASR-1.7B",
    labelZh: "OpenWhispr 同款 · Qwen3-ASR-1.7B",
    provider: "openai",
    model: "Qwen/Qwen3-ASR-1.7B",
    baseUrl: "http://127.0.0.1:8787/v1",
    directBaseUrl: "https://api.siliconflow.cn/v1",
    badge: "OPENWHISPR · ~0.78s",
    freeTier: false,
    description: "Exact model configured in OpenWhispr — ultra-low latency bilingual SOTA ASR",
    descriptionZh: "与 OpenWhispr 完全一致的高精度中英混输语音模型",
  },
  {
    id: "siliconflow-telespeech-free",
    label: "SiliconFlow Free · TeleSpeechASR",
    labelZh: "硅基流动免费 · TeleSpeechASR",
    provider: "openai",
    model: "TeleAI/TeleSpeechASR",
    baseUrl: "http://127.0.0.1:8787/v1",
    directBaseUrl: "https://api.siliconflow.cn/v1",
    badge: "FREE · CN/Dialect",
    freeTier: true,
    description: "Zero-cost TeleAI speech recognition for Mandarin & dialects via SiliconFlow",
    descriptionZh: "硅基流动免费中国电信星辰语音识别模型",
  },
  {
    id: "gemini-pool-3.5",
    label: "Gemini 6-Key Pool · gemini-3.5-transcribe",
    labelZh: "Gemini 6-Key 轮询池 · gemini-3.5-transcribe",
    provider: "openai",
    model: "gemini-3.5-transcribe",
    baseUrl: "http://127.0.0.1:8787/v1",
    directBaseUrl: "http://127.0.0.1:8787/v1",
    badge: "6-KEY POOL · FREE",
    freeTier: true,
    description: "Auto-rotating 6-key Google Gemini Interactions pool with 429 cooldown protection",
    descriptionZh: "本地 6-Key 自动轮换防 429 熔断语音池",
  },
  {
    id: "groq-whisper-v3",
    label: "Groq LPU · whisper-large-v3",
    labelZh: "Groq 极速 · whisper-large-v3",
    provider: "openai",
    model: "whisper-large-v3",
    baseUrl: "http://127.0.0.1:8787/v1",
    directBaseUrl: "https://api.groq.com/openai/v1",
    badge: "GROQ · ~0.85s",
    freeTier: true,
    description: "Groq LPU Whisper-Large-V3 ultra-fast transcription",
    descriptionZh: "Groq LPU 极速 Whisper-Large-V3 语音转录",
  },
  {
    id: "local-parakeet",
    label: "Local Offline · parakeet-tdt-0.6b-v2",
    labelZh: "本地离线 · parakeet-tdt-0.6b-v2",
    provider: "local",
    model: "parakeet-tdt-0.6b-v2",
    baseUrl: "",
    directBaseUrl: "",
    badge: "OFFLINE",
    freeTier: true,
    description: "On-device Sherpa-ONNX offline speech recognition",
    descriptionZh: "设备端 Sherpa-ONNX 离线语音识别",
  },
] as const;

export const VoiceSttEndpointSnapshotSchema = z.object({
  provider: z.string(),
  model: z.string(),
  baseUrl: z.string(),
  language: z.string(),
  hasApiKey: z.boolean(),
  apiKeyPreview: z.string(),
  sourceBadge: z.string(),
});

export type VoiceSttEndpointSnapshot = z.infer<typeof VoiceSttEndpointSnapshotSchema>;

export const VoiceSttTestReceiptSchema = z.object({
  ok: z.boolean(),
  transcript: z.string(),
  model: z.string(),
  provider: z.string(),
  keyUsed: z.string(),
  latencyMs: z.number(),
  endpoint: z.string(),
  error: z.string().nullable(),
});

export type VoiceSttTestReceipt = z.infer<typeof VoiceSttTestReceiptSchema>;

export const manageVoiceSttRpc = defineRpc({
  name: "finder.manage_voice_stt",
  input: z.object({
    action: z.enum(["inspect", "apply", "test", "reset"]).default("inspect"),
    presetId: z.string().optional(),
    provider: z.enum(["openai", "local"]).optional(),
    model: z.string().optional(),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    language: z.string().optional(),
    syncVoiceMode: z.boolean().optional(),
    routeViaGateway: z.boolean().optional(),
    source: z
      .enum(["voice-sheet", "settings-ui", "slash-command", "command-center", "agent-tool"])
      .optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    action: z.enum(["inspect", "apply", "test", "reset"]),
    dictationStt: VoiceSttEndpointSnapshotSchema,
    voiceModeStt: VoiceSttEndpointSnapshotSchema,
    gateway: z.object({
      reachable: z.boolean(),
      url: z.string(),
      healthyKeys: z.number(),
      totalKeys: z.number(),
      siliconflowConfigured: z.boolean(),
      groqConfigured: z.boolean(),
    }),
    openWhisprDetected: z.object({
      found: z.boolean(),
      endpoint: z.string(),
      model: z.string(),
    }),
    presets: z.array(VoiceSttPresetSchema),
    testResult: VoiceSttTestReceiptSchema.nullable(),
    message: z.string(),
    durationMs: z.number(),
    recentActions: z.array(ActionLogEntrySchema),
  }),
});

export const AgentHistoryTargetReceiptSchema = z.object({
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  agentId: z.string().nullable(),
  conversationId: z.string().nullable(),
  status: z.string().nullable(),
  lastError: z.string().nullable(),
  dbExists: z.boolean(),
  dbSizeFormatted: z.string(),
  brainTranscriptExists: z.boolean(),
  shelfTranscriptExists: z.boolean(),
  transcriptLines: z.number(),
  healable: z.boolean(),
  healed: z.boolean(),
  detail: z.string(),
});

export type AgentHistoryTargetReceipt = z.infer<typeof AgentHistoryTargetReceiptSchema>;

export const manageAgentHistoryRpc = defineRpc({
  name: "finder.manage_agent_history",
  input: z.object({
    action: z.enum(["inspect", "probe", "heal"]).default("inspect"),
    workspaceId: z.string().optional(),
    agentId: z.string().optional(),
    conversationId: z.string().optional(),
    source: z
      .enum([
        "settings-ui",
        "slash-command",
        "command-center",
        "timeline-banner",
        "agent-tool",
      ])
      .optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    action: z.enum(["inspect", "probe", "heal"]),
    sessionPatches: z.object({
      ok: z.boolean(),
      appPatched: z.boolean(),
      cliPatched: z.boolean(),
      configSummary: z.string(),
      details: z.string(),
    }),
    vaultStats: z.object({
      activeWorkspacesCount: z.number(),
      antigravityAgentsCount: z.number(),
      healthyConversationsCount: z.number(),
      missingDbCount: z.number(),
      missingTranscriptCount: z.number(),
      shelvedTranscriptCount: z.number(),
    }),
    targetAgent: AgentHistoryTargetReceiptSchema.nullable(),
    actionsTaken: z.array(z.string()),
    message: z.string(),
    durationMs: z.number(),
    recentActions: z.array(ActionLogEntrySchema),
  }),
});

export const PaseoRecoveryQuotaCooldownSchema = z.object({
  waitSecs: z.number().nullable().optional(),
  remainingSecs: z.number().nullable().optional(),
  resumeAt: z.string().nullable().optional(),
  deferred: z.boolean().optional(),
});

export const PaseoRecoveryAgentItemSchema = z.object({
  agentId: z.string(),
  provider: z.string().optional(),
  workspaceId: z.string().nullable(),
  title: z.string(),
  cwd: z.string().nullable().optional(),
  status: z.string(),
  persistedStatus: z.string().nullable().optional(),
  conversationId: z.string(),
  turnState: z.string().nullable().optional(),
  epochs: z.number().default(1),
  totalSteps: z.number().default(0),
  lastStepIndex: z.number().default(0),
  lastStepType: z.string().default(""),
  shellCallsInTurn: z.number().default(0),
  otherToolCallsInTurn: z.number().default(0),
  toolSummary: z.string(),
  wasStartupRecoveryFailed: z.boolean(),
  lastErrorText: z.string().nullable(),
  ageHours: z.number(),
  classification: z.string(),
  needsPullUp: z.boolean(),
  reason: z.string(),
  attemptsAtCurrentStep: z.number(),
  healed: z.boolean(),
  healError: z.string().nullable().optional(),
  quotaCooldown: PaseoRecoveryQuotaCooldownSchema.nullable().optional(),
});

export type PaseoRecoveryAgentItem = z.infer<typeof PaseoRecoveryAgentItemSchema>;

export const reconcilePaseoRecoveryRpc = defineRpc({
  name: "finder.reconcile_paseo_recovery",
  input: z.object({
    action: z.enum(["status", "simulate", "heal", "reset"]).default("status"),
    agentId: z.string().optional(),
    maxAgeHours: z.number().optional(),
    prompt: z.string().optional(),
    source: z
      .enum([
        "settings-ui",
        "slash-command",
        "command-center",
        "agent-tool",
      ])
      .optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    action: z.enum(["status", "simulate", "heal", "reset"]),
    resumeOnStartup: z.boolean(),
    versionCacheOk: z.boolean(),
    catalogSingleflightOk: z.boolean(),
    proxyHealthy: z.boolean(),
    daemonRunning: z.boolean(),
    daemonStartupFailedCount: z.number(),
    interruptedCount: z.number(),
    healedCount: z.number(),
    unhealedCount: z.number(),
    circuitBreakerCount: z.number(),
    totalScanned: z.number(),
    agents: z.array(PaseoRecoveryAgentItemSchema),
    interruptedAgents: z.array(PaseoRecoveryAgentItemSchema),
    healedAgents: z.array(PaseoRecoveryAgentItemSchema),
    actions: z.array(z.string()),
    issues: z.array(z.string()),
    message: z.string(),
    durationMs: z.number(),
  }),
});

export const CustomizeCategorySchema = z.enum([
  "all",
  "commands",
  "skills",
  "rules",
  "subagents",
  "mcps",
  "plugins",
]);

export type CustomizeCategory = z.infer<typeof CustomizeCategorySchema>;

export const CustomizeScopeSchema = z.enum([
  "all",
  "workspace",
  "user",
  "pinned",
  "disabled",
]);

export type CustomizeScope = z.infer<typeof CustomizeScopeSchema>;

export const CustomizeItemSchema = z.object({
  name: z.string(),
  category: z.string(),
  kind: z.string(),
  scope: z.string(),
  source: z.string(),
  path: z.string().nullable(),
  description: z.string(),
  pinned: z.boolean(),
  enabled: z.boolean(),
  inline_autocomplete: z.boolean(),
});

export type CustomizeItem = z.infer<typeof CustomizeItemSchema>;

export const SlashDryRunResolutionSchema = z.object({
  token: z.string(),
  slug: z.string(),
  status: z.string(),
  mode: z.string(),
  path: z.string().nullable(),
  injected_chars: z.number(),
});

export type SlashDryRunResolution = z.infer<typeof SlashDryRunResolutionSchema>;

export const manageSlashSkillsRpc = defineRpc({
  name: "finder.manage_slash_skills",
  input: z.object({
    action: z
      .enum([
        "status",
        "inspect",
        "test",
        "sync",
        "pin",
        "unpin",
        "enable",
        "disable",
        "reset-pins",
      ])
      .default("status"),
    slug: z.string().optional(),
    samplePrompt: z.string().optional(),
    category: CustomizeCategorySchema.optional(),
    scope: CustomizeScopeSchema.optional(),
    query: z.string().optional(),
    cwd: z.string().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    source: z
      .enum(["settings-ui", "slash-command", "command-center", "agent-tool"])
      .optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    action: z.string(),
    slashCommandsMode: z.string(),
    configSource: z.string(),
    pinnedSlashCommands: z.array(z.string()),
    disabledSlashCommands: z.array(z.string()),
    totalAdvertised: z.number(),
    builtinCount: z.number(),
    skillCount: z.number(),
    inlineAutocompleteCount: z.number(),
    pinnedCount: z.number(),
    disabledCount: z.number(),
    syncedSkillsCount: z.number(),
    syncedSkillsAllLinked: z.boolean(),
    customizeCounts: z.object({
      all: z.number(),
      commands: z.number(),
      skills: z.number(),
      rules: z.number(),
      subagents: z.number(),
      mcps: z.number(),
      plugins: z.number(),
      pinned: z.number(),
      disabled: z.number(),
      workspace: z.number(),
    }),
    customizeItems: z.array(CustomizeItemSchema),
    dryRun: z.object({
      samplePrompt: z.string(),
      detectedTokens: z.array(z.string()),
      expandedCount: z.number(),
      totalInjectedChars: z.number(),
      budgetCapChars: z.number(),
      perSkillBudgetChars: z.number(),
      resolutions: z.array(SlashDryRunResolutionSchema),
    }),
    actions: z.array(z.string()),
    message: z.string(),
    durationMs: z.number(),
  }),
});

export const WritebackReplayEventSchema = z.object({
  line: z.number(),
  stepIndex: z.number().nullable(),
  fullyIdle: z.boolean(),
  executionNum: z.number(),
  hasWritebackLine: z.boolean(),
  recordedHookBlockedInTranscript: z.boolean(),
  legacyV1Decision: z.string(),
  legacyV1Reason: z.string(),
  v2Decision: z.string(),
  v2Reason: z.string(),
  preview: z.string(),
});

export type WritebackReplayEvent = z.infer<typeof WritebackReplayEventSchema>;

export const manageWritebackHookRpc = defineRpc({
  name: "finder.manage_writeback_hook",
  input: z.object({
    action: z.enum(["status", "simulate", "tune", "reset"]).default("status"),
    conversationId: z.string().optional(),
    enabled: z.boolean().optional(),
    maxBlocksPerTurn: z.number().int().min(1).max(5).optional(),
    requireFullyIdle: z.boolean().optional(),
    transcriptTailFallback: z.boolean().optional(),
    clearMarkers: z.boolean().optional(),
    clearAudit: z.boolean().optional(),
    source: z
      .enum(["settings-ui", "slash-command", "command-center", "agent-tool"])
      .optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    action: z.string(),
    hookVersion: z.string(),
    configSource: z.string(),
    enabled: z.boolean(),
    maxBlocksPerTurn: z.number(),
    requireFullyIdle: z.boolean(),
    transcriptTailFallback: z.boolean(),
    stopHookEnabledInHooksJson: z.boolean(),
    turnMarkerEnabledInHooksJson: z.boolean(),
    activeMarkersCount: z.number(),
    auditSampleSize: z.number(),
    auditAllowCount: z.number(),
    auditBlockCount: z.number(),
    auditByReason: z.record(z.string(), z.number()),
    replay: z
      .object({
        conversationId: z.string(),
        totalStopPoints: z.number(),
        legacyV1BlockCount: z.number(),
        v2BlockCount: z.number(),
        falseBlocksEliminated: z.number(),
        events: z.array(WritebackReplayEventSchema),
      })
      .nullable(),
    message: z.string(),
    durationMs: z.number(),
  }),
});

export const SubagentTimerOrTaskNodeSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  kind: z.enum(["timer", "background_task"]),
  stepIndex: z.number(),
  durationSeconds: z.number().nullable().optional(),
  cronExpression: z.string().nullable().optional(),
  timerCondition: z.string().nullable().optional(),
  prompt: z.string(),
  status: z.enum(["running", "completed", "canceled"]),
  timestamp: z.string().nullable().optional(),
});

export type SubagentTimerOrTaskNode = z.infer<typeof SubagentTimerOrTaskNodeSchema>;

export const SubagentTimelineItemSchema = z.object({
  id: z.string(),
  stepIndex: z.number(),
  type: z.enum(["user_message", "assistant_message", "tool_call"]),
  name: z.string().optional(),
  summary: z.string().optional(),
  text: z.string().optional(),
  sender: z.string().optional(),
  childConversationId: z.string().nullable().optional(),
  subAgentType: z.string().nullable().optional(),
  timestamp: z.string().nullable().optional(),
});

export type SubagentTimelineItem = z.infer<typeof SubagentTimelineItemSchema>;

export const FlatSubagentNodeSchema = z.object({
  conversationId: z.string(),
  parentConversationId: z.string(),
  depth: z.number(),
  toolCallId: z.string().nullable().optional(),
  stepIndex: z.number().nullable().optional(),
  subAgentType: z.string(),
  role: z.string(),
  promptPreview: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  badge: z.string(),
  stepCount: z.number(),
  toolCallCount: z.number(),
  lastToolName: z.string(),
  lastMessagePreview: z.string(),
  lastErrorText: z.string(),
  updatedAt: z.string(),
  mtimeAgeSeconds: z.number(),
  transcriptPath: z.string(),
  nestedSubagentCount: z.number(),
  nestedRunningCount: z.number(),
  timersAndTasks: z.array(SubagentTimerOrTaskNodeSchema).optional(),
  timeline: z.array(SubagentTimelineItemSchema).optional(),
});

export type FlatSubagentNode = z.infer<typeof FlatSubagentNodeSchema>;

export const SubagentAgentTreeSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  title: z.string(),
  cwd: z.string(),
  model: z.string(),
  agentStatus: z.string(),
  archived: z.boolean(),
  rootConversationId: z.string(),
  rootStepCount: z.number(),
  rootToolCallCount: z.number(),
  rootLastMessagePreview: z.string(),
  rootTimersAndTasks: z.array(SubagentTimerOrTaskNodeSchema).optional(),
  updatedAt: z.string(),
  subagentSummary: z.object({
    total: z.number(),
    running: z.number(),
    completed: z.number(),
    failed: z.number(),
    maxDepth: z.number(),
    totalSubagentSteps: z.number(),
  }),
  flatSubagents: z.array(FlatSubagentNodeSchema),
  rootTimeline: z.array(SubagentTimelineItemSchema),
});

export type SubagentAgentTree = z.infer<typeof SubagentAgentTreeSchema>;

export const manageSubagentsRpc = defineRpc({
  name: "finder.manage_subagents",
  input: z.object({
    action: z.enum(["status", "tree", "inspect", "timeline"]).default("status"),
    agentId: z.string().optional(),
    workspaceId: z.string().optional(),
    conversationId: z.string().optional(),
    includeTimeline: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
    source: z
      .enum(["timeline-inline", "subagents-bar", "drawer", "settings-ui", "command-center", "agent-tool"])
      .optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    action: z.string(),
    targetAgentId: z.string().nullable(),
    targetWorkspaceId: z.string().nullable().optional(),
    targetConversationId: z.string().nullable(),
    summary: z.object({
      agentsWithSubagents: z.number(),
      totalSubagents: z.number(),
      runningSubagents: z.number(),
      completedSubagents: z.number(),
      failedSubagents: z.number(),
    }),
    trees: z.array(SubagentAgentTreeSchema),
    singleConversation: FlatSubagentNodeSchema.nullable(),
    message: z.string(),
    durationMs: z.number(),
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
  > & {
    workspaceIds?: string[];
    searchTokens?: string[];
  },
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
  const extraTokens = [
    ...(candidate.workspaceIds ?? []),
    ...(candidate.searchTokens ?? []),
  ]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const words = `${nameLower} ${baseLower}`.split(/[\s._/-]+/).filter(Boolean);
  const alphaWords = strippedLower
    .split(/[\s._/-]+/)
    .filter((w) => w.length > 0 && !/^\d+$/.test(w));
  const acronym = alphaWords.map((w) => w[0]).join("");

  let totalScore = 0;
  for (const rawToken of tokens) {
    const token = rawToken.replace(/^#/, "");
    if (!token) continue;
    let tokenScore = 0;
    if (nameLower === token || strippedLower === token || baseLower === token) {
      tokenScore = 1000;
    } else if (
      token.length >= 4 &&
      extraTokens.some(
        (ext) =>
          ext === token ||
          ext.replace(/^wks_/, "") === token ||
          ext.startsWith(token) ||
          ext.replace(/^wks_/, "").startsWith(token),
      )
    ) {
      tokenScore = 950;
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
    } else if (extraTokens.some((ext) => ext.includes(token))) {
      tokenScore = 360;
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

export const SessionRelationKindSchema = z.enum([
  "subagent",
  "colleague",
  "referenced",
  "intake-routed",
  "project-peer",
  "parent",
  "self",
]);

export type SessionRelationKind = z.infer<typeof SessionRelationKindSchema>;

export const SessionLineageNodeSchema = z.object({
  agentId: z.string(),
  shortId: z.string(),
  agentTitle: z.string(),
  workspaceId: z.string(),
  workspaceTitle: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  status: z.string(),
  provider: z.string(),
  model: z.string(),
  providerSessionId: z.string().nullable().optional(),
  relationKind: SessionRelationKindSchema.optional(),
  routedByAgentId: z.string().nullable().optional(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  briefPath: z.string().nullable(),
  reportPath: z.string().nullable(),
  reportExists: z.boolean(),
  notionUrl: z.string().nullable(),
  notionTaskId: z.string().nullable(),
});

export type SessionLineageNode = z.infer<typeof SessionLineageNodeSchema>;

export const manageSessionLineageRpc = defineRpc({
  name: "finder.manage_session_lineage",
  input: z.object({
    action: z.enum(["inspect", "reconcile"]).default("inspect"),
    workspaceId: z.string().optional(),
    agentId: z.string().optional(),
    autoFixTitles: z.boolean().optional(),
    source: z
      .enum(["lineage-bar", "settings-ui", "slash-command", "command-center", "agent-tool"])
      .optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    action: z.string(),
    current: SessionLineageNodeSchema.nullable(),
    parent: SessionLineageNodeSchema.nullable(),
    routedOrigin: SessionLineageNodeSchema.nullable().optional(),
    siblings: z.array(SessionLineageNodeSchema),
    children: z.array(SessionLineageNodeSchema),
    colleagues: z.array(SessionLineageNodeSchema).optional(),
    projectPeers: z.array(SessionLineageNodeSchema).optional(),
    directory: z.array(SessionLineageNodeSchema).optional(),
    reconcileSummary: z.object({
      untitledFound: z.number(),
      renamedCount: z.number(),
      unlinkedFound: z.number(),
      linkedCount: z.number(),
      detachedCount: z.number().optional(),
      renamedWorkspaces: z.array(
        z.object({
          workspaceId: z.string(),
          oldDisplayName: z.string(),
          newTitle: z.string(),
          agentId: z.string(),
        }),
      ),
    }),
    message: z.string(),
    durationMs: z.number(),
  }),
});

export * from "./schedule-runs-contracts";


// Fork this session: clone the Antigravity conversation (agy db branch) and import it as a new
// Paseo agent. One owner: `antigravity-ops conversation fork-agent` (agy_conversation_branch.py).
export const forkSessionRpc = defineRpc({
  name: "finder.fork_session",
  input: z.object({
    agentId: z.string().min(8),
    title: z.string().optional(),
    open: z.boolean().default(true),
    dryRun: z.boolean().default(false),
    source: z.enum(["header-button", "slash-command", "command-center", "agent-tool"]).optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    dryRun: z.boolean(),
    agentId: z.string().nullable(),
    sourceAgentId: z.string(),
    conversationId: z.string().nullable(),
    sourceConversationId: z.string().nullable(),
    title: z.string().nullable(),
    stepsCopied: z.number().nullable(),
    message: z.string(),
    error: z.string().nullable(),
    durationMs: z.number(),
  }),
});

export const PeerSurfaceStateSchema = z.object({
  name: z.string(),
  state: z.string(),
  version: z.number().nullable().optional(),
  covers: z.string(),
  target: z.string(),
});

export const PeerAgentProfileItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  model: z.string(),
  launchFlags: z.string().optional(),
});

// Peer presence (T-098): which files two or more sessions edited, read from
// `antigravity-ops peers touching --json`. One row is one working session.
export const PeerSharedFileSessionSchema = z.object({
  /** Paseo agent id, or "" for a session outside Paseo. */
  agent: z.string(),
  /** Provider session id. */
  session: z.string(),
  provider: z.string(),
  harness: z.string(),
  model: z.string(),
  status: z.string(),
  title: z.string(),
  scheduled: z.boolean().nullable(),
  /** Last edit, epoch seconds. null = the CLI did not state it. */
  last: z.number().nullable(),
  /** Edits in the window. null = the CLI did not state it. */
  count: z.number().nullable(),
});

export type PeerSharedFileSession = z.infer<typeof PeerSharedFileSessionSchema>;

export const PeerSharedFileSchema = z.object({
  path: z.string(),
  /** `path` with the home directory written as `~`. */
  shortPath: z.string(),
  sessions: z.array(PeerSharedFileSessionSchema),
});

export type PeerSharedFile = z.infer<typeof PeerSharedFileSchema>;

export const PeerPresenceSummarySchema = z.object({
  windowMinutes: z.number().nullable(),
  edits: z.number().nullable(),
  sessions: z.number().nullable(),
  files: z.number().nullable(),
  /** Shared files the CLI reported, before the cap. null = the list could not be read. */
  sharedTotal: z.number().nullable(),
  /** True when `sharedFiles` holds fewer rows than `sharedTotal`. */
  truncated: z.boolean(),
  warnings: z.array(z.string()),
});

export type PeerPresenceSummary = z.infer<typeof PeerPresenceSummarySchema>;

export const PeerPresenceVerifyHarnessSchema = z.object({
  harness: z.string(),
  gradedSessions: z.number().nullable(),
  editedPairs: z.number().nullable(),
  inLedger: z.number().nullable(),
  beforeHook: z.number().nullable(),
  missingSessions: z.array(z.string()),
  hookRanButEditUnread: z.array(z.string()),
  noHookRun: z.array(z.string()),
  missingExamples: z.array(z.string()),
});

export const PeerPresenceVerifySchema = z.object({
  /** true = every edit reached the ledger, false = a gap, null = the CLI could not grade it. */
  ok: z.boolean().nullable(),
  reason: z.string().nullable(),
  /** Short session ids with edits missing from the ledger, across harnesses. */
  gapSessions: z.array(z.string()),
  harness: z.array(PeerPresenceVerifyHarnessSchema),
  warnings: z.array(z.string()),
});

export type PeerPresenceVerify = z.infer<typeof PeerPresenceVerifySchema>;

export const managePeerAgentsRpc = defineRpc({
  name: "finder.manage_peer_agents",
  input: z.object({
    action: z
      .enum(["status", "test_resolve", "enable_all", "heal_outbox", "verify_presence"])
      .default("status"),
    profileQuery: z.string().optional(),
    cwd: z.string().optional(),
    source: z
      .enum(["settings-ui", "slash-command", "command-center", "agent-tool"])
      .optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    action: z.string(),
    blockVersion: z.number(),
    antigravityChannel: z.string(),
    surfaces: z.array(PeerSurfaceStateSchema),
    profiles: z.array(PeerAgentProfileItemSchema),
    activePeersCount: z.number(),
    closedPeersCount: z.number(),
    outboxSummary: z.string(),
    resolvedPreview: z
      .object({
        query: z.string(),
        matchedProfiles: z.array(z.string()),
        sampleReviewCommand: z.string(),
      })
      .nullable()
      .optional(),
    // Optional so an older client keeps working. Present on `status` (`sharedFiles`, `presence`)
    // and on `verify_presence` (`presenceVerify`). null = the CLI run failed or could not be
    // read, which is unknown and never an empty list.
    sharedFiles: z.array(PeerSharedFileSchema).nullable().optional(),
    presence: PeerPresenceSummarySchema.nullable().optional(),
    presenceVerify: PeerPresenceVerifySchema.nullable().optional(),
    message: z.string(),
    durationMs: z.number(),
  }),
});

export const SystemPromptSectionSchema = z.object({
  title: z.string(),
  charCount: z.number(),
  preview: z.string(),
});

export type SystemPromptSection = z.infer<typeof SystemPromptSectionSchema>;

export const inspectSystemPromptRpc = defineRpc({
  name: "finder.inspect_system_prompt",
  input: z.object({
    action: z.enum(["inspect", "test_clean", "normalize_boundary"]).default("inspect"),
    testInput: z.string().optional(),
    workspaceId: z.string().optional(),
    agentId: z.string().optional(),
    cwd: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    configPath: z.string(),
    mtime: z.string().nullable().optional(),
    appendSystemPrompt: z.string(),
    systemPrompt: z.string(),
    charCount: z.number(),
    lineCount: z.number(),
    estimatedTokens: z.number(),
    boundaryOk: z.boolean().optional(),
    leakedAfterUserPromptChars: z.number().optional(),
    sections: z.array(SystemPromptSectionSchema),
    cleanedPreview: z.string().optional(),
    testResult: z
      .object({
        inputChars: z.number(),
        cleanedText: z.string(),
        cleanedChars: z.number(),
        strippedPrefix: z.boolean(),
      })
      .optional(),
    message: z.string(),
    durationMs: z.number(),
  }),
});

export const BadTimelineEntrySchema = z.object({
  id: z.string(),
  status: z.string(),
  provider: z.string(),
  title: z.string(),
  error: z.string(),
});

export type BadTimelineEntry = z.infer<typeof BadTimelineEntrySchema>;

export const manageRelayHealthRpc = defineRpc({
  name: "finder.manage_relay_health",
  input: z.object({
    action: z.enum(["status", "probe", "revive"]).default("status"),
  }),
  output: z.object({
    ok: z.boolean(),
    action: z.enum(["status", "probe", "revive"]),
    relayOk: z.boolean(),
    relayEnabled: z.boolean(),
    controlState: z.string(),
    clashRoute: z.string(),
    lastMobileClientId: z.string().nullable().optional(),
    lastMobileHelloAt: z.string().nullable().optional(),
    recentRelayErrors15m: z.number(),
    recentLeaseDrops15m: z.number(),
    checkedTimelines: z.number(),
    badTimelines: z.array(BadTimelineEntrySchema),
    e2eeOk: z.boolean().nullable().optional(),
    e2eeConnectMs: z.number().nullable().optional(),
    e2eeStatusMs: z.number().nullable().optional(),
    e2eeError: z.string().nullable().optional(),
    actions: z.array(z.string()),
    issues: z.array(z.string()),
    details: z.string(),
    message: z.string(),
    durationMs: z.number(),
  }),
});
