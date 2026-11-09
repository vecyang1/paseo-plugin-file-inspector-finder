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
    autoJumpToFirstPlaceInput: z.boolean().default(true),
    inlineRenameCaretPosition: InlineRenameCaretPositionSchema.default("start"),
    enableQuickRenameAndLabelShortcuts: z.boolean().default(true),
    enableMarkDoneShortcut: z.boolean().default(true),
    markDonePrefix: z.string().default("d "),
    enableSidebarFolderDrop: z.boolean().default(true),
    sidebarDropDefaultBehavior: SidebarDropBehaviorSchema.default("open-or-create"),
    enableWorkspaceQuickJump: z.boolean().default(true),
    enableCommandCenterProjectItems: z.boolean().default(true),
    autoRevealActiveWorkspaceInSidebar: z.boolean().default(true),
    startNewProjectsCollapsed: z.boolean().default(true),
    quickJumpDefaultAction: QuickJumpActionSchema.default("open-latest"),
    enableScheduleRunsInspector: z.boolean().default(true),
    enableVoiceCustomModelHelper: z.boolean().default(true),
    dictationSendBehavior: z.enum(["insert-only", "native"]).default("insert-only"),
    enableModelQuickSwitch: z.boolean().default(true),
    modelQuickSwitchDigits: z.enum(["empty-search", "modifier-only"]).default("empty-search"),
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
  workspaceIds: z.array(z.string()).optional(),
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

export const PaseoRecoveryAgentItemSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string().nullable(),
  title: z.string(),
  status: z.string(),
  persistedStatus: z.string().nullable().optional(),
  conversationId: z.string(),
  epochs: z.number(),
  totalSteps: z.number(),
  lastStepIndex: z.number(),
  lastStepType: z.string(),
  shellCallsInTurn: z.number(),
  otherToolCallsInTurn: z.number(),
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

export * from "./schedule-runs-contracts";

