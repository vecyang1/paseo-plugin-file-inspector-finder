import { defineAgentTool, type PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  OpenerTargetSchema,
  QuickJumpActionSchema,
  SidebarDropBehaviorSchema,
  WorkspaceLabelColorSchema,
  diagnosePathRpc,
  importFolderWorkspaceRpc,
  inspectFileRpc,
  listWorkspaceMediaRpc,
  manageWorkspaceLabelsRpc,
  openFileTargetRpc,
  pluginSettings,
  quickJumpWorkspaceRpc,
  renameWorkspaceOrAgentRpc,
  inspectScheduleRunsRpc,
  openScheduleRunSessionRpc,
  manageVoiceSttRpc,
  manageAgentHistoryRpc,
  manageSessionLineageRpc,
  manageSlashSkillsRpc,
  manageSubagentsRpc,
  manageWritebackHookRpc,
  reconcilePaseoRecoveryRpc,
} from "./shared/contracts";
import {
  handleDiagnosePath,
  handleImportFolderWorkspace,
  handleInspectFile,
  handleListWorkspaceMedia,
  handleManageAgentHistory,
  handleManageSessionLineage,
  handleManageSlashSkills,
  handleManageSubagents,
  handleManageVoiceStt,
  handleManageWorkspaceLabels,
  handleManageWritebackHook,
  handleOpenFileTarget,
  handleQuickJumpWorkspace,
  handleReconcilePaseoRecovery,
  handleRenameThread,
} from "./server/handlers";
import {
  buildSettingsPath,
  searchSettingsIndex,
  settingsResultBreadcrumb,
} from "./shared/settings-search";
import { SETTINGS_SEARCH_SEED } from "./shared/settings-search-seed";
import {
  handleInspectScheduleRuns,
  handleOpenScheduleRunSession,
} from "./server/schedule-runs-handlers";

export default function contribute(server: PluginServerContext) {
  const settingsHandle = server.registerSettings(pluginSettings);

  server.handle(inspectFileRpc, handleInspectFile);
  server.handle(openFileTargetRpc, handleOpenFileTarget);
  server.handle(listWorkspaceMediaRpc, handleListWorkspaceMedia);
  server.handle(diagnosePathRpc, handleDiagnosePath);
  server.handle(renameWorkspaceOrAgentRpc, handleRenameThread);
  server.handle(manageWorkspaceLabelsRpc, handleManageWorkspaceLabels);
  server.handle(importFolderWorkspaceRpc, (input, context) =>
    handleImportFolderWorkspace(input, context, {
      readSettings: () => settingsHandle.read(),
    }),
  );
  server.handle(quickJumpWorkspaceRpc, (input, context) =>
    handleQuickJumpWorkspace(input, context, {
      readSettings: () => settingsHandle.read(),
    }),
  );
  server.handle(inspectScheduleRunsRpc, handleInspectScheduleRuns);
  server.handle(openScheduleRunSessionRpc, handleOpenScheduleRunSession);
  server.handle(manageVoiceSttRpc, handleManageVoiceStt);
  server.handle(manageAgentHistoryRpc, handleManageAgentHistory);
  server.handle(manageSessionLineageRpc, handleManageSessionLineage);
  server.handle(manageSlashSkillsRpc, handleManageSlashSkills);
  server.handle(manageSubagentsRpc, handleManageSubagents);
  server.handle(manageWritebackHookRpc, handleManageWritebackHook);
  server.handle(reconcilePaseoRecoveryRpc, handleReconcilePaseoRecovery);

  const revealTool = defineAgentTool({
    name: "reveal_in_finder",
    title: "Reveal File or Folder in Finder",
    description:
      "Reveal a file, image, or directory in macOS Finder (open -R) or open it in Preview/Antigravity/Cursor.",
    input: z.object({
      path: z.string().describe("Relative or absolute path to the file or directory"),
      target: OpenerTargetSchema.optional().describe(
        "Target opener: finder-reveal (default), finder-folder, system-preview, antigravity, cursor",
      ),
    }),
    async execute(input, { agent, paseo }) {
      const result = await handleOpenFileTarget(
        {
          workspaceId: agent.workspaceId ?? undefined,
          workspaceRoot: agent.cwd ?? undefined,
          path: input.path,
          target: input.target ?? "finder-reveal",
        },
        { paseo },
      );
      return {
        text: JSON.stringify(result, null, 2),
        structuredContent: result,
        isError: !result.ok,
      };
    },
  });

  const threadMetaTool = defineAgentTool({
    name: "manage_thread_metadata",
    title: "Rename Workspace / Thread or Manage Labels",
    description:
      "Rename the active Paseo workspace/thread title or inspect/assign/toggle/update workspace labels.",
    input: z.object({
      title: z
        .string()
        .optional()
        .describe("Optional new workspace/thread title (pass 'clear' to reset custom title)"),
      labelAction: z
        .enum(["inspect", "toggle", "assign", "unassign", "update", "delete"])
        .optional()
        .describe("Label operation to perform"),
      labelName: z.string().optional().describe("Label name (e.g. '⭐️', 'feat', '🤔', '⚒️')"),
      newLabelName: z.string().optional().describe("New label name when labelAction is 'update'"),
      labelColor: WorkspaceLabelColorSchema.optional().describe(
        "Label color: violet, sky, emerald, orange, pink, indigo, teal, red, amber, blue",
      ),
    }),
    async execute(input, { agent, paseo }) {
      const results: Record<string, unknown> = {};
      let hasError = false;
      if (input.title !== undefined) {
        const renameRes = await handleRenameThread(
          {
            workspaceId: agent.workspaceId ?? undefined,
            agentId: agent.id,
            title: input.title,
          },
          { paseo } as never,
        );
        results.rename = renameRes;
        if (!renameRes.ok) hasError = true;
      }
      if (input.labelAction || input.labelName) {
        const labelRes = await handleManageWorkspaceLabels(
          {
            action: input.labelAction ?? (input.labelName ? "toggle" : "inspect"),
            workspaceId: agent.workspaceId ?? undefined,
            labelName: input.labelName,
            newName: input.newLabelName,
            color: input.labelColor,
          },
          { paseo } as never,
        );
        results.labels = labelRes;
        if (!labelRes.ok) hasError = true;
      }
      return {
        text: JSON.stringify(results, null, 2),
        structuredContent: results,
        isError: hasError,
      };
    },
  });

  const importFolderTool = defineAgentTool({
    name: "import_folder_workspace",
    title: "Import or Open Folder as Paseo Workspace",
    description:
      "Register and open one or more local folders as Paseo workspaces if they do not yet exist (or reuse existing active workspaces without duplication).",
    input: z.object({
      paths: z
        .array(z.string())
        .min(1)
        .describe("Absolute or ~ folder paths to register/open as Paseo workspaces"),
      mode: SidebarDropBehaviorSchema.optional().describe(
        "open-or-create (default, deduplicates existing workspaces) or always-create",
      ),
      title: z
        .string()
        .optional()
        .describe("Optional custom title when creating a new workspace"),
      dryRun: z
        .boolean()
        .optional()
        .describe("Set true to preview whether a workspace already exists without creating one"),
    }),
    async execute(input, { paseo }) {
      const result = await handleImportFolderWorkspace(
        {
          paths: input.paths,
          mode: input.mode,
          title: input.title,
          dryRun: input.dryRun,
          source: "agent-tool",
        },
        { paseo },
        { readSettings: () => settingsHandle.read() },
      );
      return {
        text: JSON.stringify(result, null, 2),
        structuredContent: result,
        isError: !result.ok,
      };
    },
  });

  const quickJumpTool = defineAgentTool({
    name: "quick_jump_workspace",
    title: "Search or Quick-Jump to Paseo Project Workspace",
    description:
      "Search and rank Paseo project workspaces without sub-thread clutter, or resolve/open the primary workspace for a target project folder.",
    input: z.object({
      action: z
        .enum(["list", "jump"])
        .optional()
        .describe("list (rank matching project workspaces) or jump (resolve/open target project)"),
      query: z
        .string()
        .optional()
        .describe("Search query by project name, stripped date name, acronym, or path segment"),
      projectId: z.string().optional().describe("Optional explicit projectId to jump to"),
      jumpMode: QuickJumpActionSchema.optional().describe(
        "new-workspace (default), open-latest, locate-sidebar, or create-new",
      ),
      dryRun: z.boolean().optional().describe("Set true to preview resolution without creating"),
    }),
    async execute(input, { paseo }) {
      const result = await handleQuickJumpWorkspace(
        {
          action: input.action ?? (input.query || input.projectId ? "jump" : "list"),
          query: input.query,
          projectId: input.projectId,
          jumpMode: input.jumpMode,
          dryRun: input.dryRun,
          source: "agent-tool",
        },
        { paseo } as never,
        { readSettings: () => settingsHandle.read() },
      );
      return {
        text: JSON.stringify(result, null, 2),
        structuredContent: result,
        isError: !result.ok,
      };
    },
  });

  const scheduleRunsTool = defineAgentTool({
    name: "inspect_schedule_runs",
    title: "Inspect Paseo Schedule Runs & Open Run Conversation",
    description:
      "List Paseo schedule execution history (all runs across native schedules and AG standby twins), preview run conversation timelines, trigger run-now, or unarchive a completed run workspace.",
    input: z.object({
      action: z
        .enum([
          "list",
          "open-run",
          "preview-timeline",
          "run-now",
          "toggle-archive-on-finish",
          "recover-due",
          "auto-evolve",
        ])
        .optional()
        .describe(
          "list (default), open-run, preview-timeline, run-now, toggle-archive-on-finish, recover-due, or auto-evolve",
        ),
      scheduleId: z.string().optional().describe("Schedule ID (e.g. 2a8a43f9 or 85c593c3)"),
      runId: z.string().optional().describe("Specific run ID to inspect or open"),
      query: z.string().optional().describe("Filter schedules/runs by name, model, or output"),
      onlyWithRuns: z.boolean().optional().describe("Only return schedules that have recorded runs"),
      archiveOnFinish: z
        .boolean()
        .optional()
        .describe("When action is toggle-archive-on-finish, set archiveOnFinish value"),
    }),
    async execute(input, { paseo }) {
      const act = input.action ?? "list";
      if (act === "list") {
        const result = await handleInspectScheduleRuns(
          {
            scheduleId: input.scheduleId,
            query: input.query,
            onlyWithRuns: input.onlyWithRuns ?? true,
            includeWorkspaceNames: true,
            maxRunsPerSchedule: 30,
          },
          { paseo } as never,
        );
        return {
          text: JSON.stringify(result, null, 2),
          structuredContent: result,
          isError: !result.ok,
        };
      }
      const result = await handleOpenScheduleRunSession(
        {
          action: act,
          scheduleId: input.scheduleId ?? "",
          runId: input.runId,
          archiveOnFinish: input.archiveOnFinish,
          dryRun: false,
        },
        { paseo } as never,
      );
      return {
        text: JSON.stringify(result, null, 2),
        structuredContent: result,
        isError: !result.ok,
      };
    },
  });

  const voiceSttTool = defineAgentTool({
    name: "manage_voice_stt",
    title: "Inspect, Test, or Configure Paseo Custom Voice / STT Models (SiliconFlow & Audio Pool)",
    description:
      "Inspect Paseo's active Speech-to-text configuration, apply SiliconFlow free/SOTA presets (FunAudioLLM/SenseVoiceSmall, Qwen/Qwen3-ASR-1.7B, TeleAI/TeleSpeechASR) or arbitrary custom STT models, or run a live transcription probe.",
    input: z.object({
      action: z
        .enum(["inspect", "apply", "test", "reset"])
        .optional()
        .describe("inspect (default), apply, test, or reset"),
      presetId: z
        .string()
        .optional()
        .describe(
          "Optional preset ID: siliconflow-sensevoice-free, siliconflow-qwen3-asr, siliconflow-telespeech-free, gemini-pool-3.5, groq-whisper-v3, local-parakeet",
        ),
      model: z
        .string()
        .optional()
        .describe(
          "Custom STT model ID (e.g. FunAudioLLM/SenseVoiceSmall, Qwen/Qwen3-ASR-1.7B, TeleAI/TeleSpeechASR, gemini-3.5-transcribe)",
        ),
      baseUrl: z
        .string()
        .optional()
        .describe("Optional OpenAI-compatible STT base URL (defaults to http://127.0.0.1:8787/v1 when local pool gateway is active)"),
      apiKey: z.string().optional().describe("Optional API key override"),
      language: z.string().optional().describe("Optional language hint (e.g. auto, zh, en)"),
      routeViaGateway: z
        .boolean()
        .optional()
        .describe("Route SiliconFlow/Gemini/Groq models via local Audio Pool Gateway :8787 (default true)"),
    }),
    async execute(input, { paseo }) {
      const result = await handleManageVoiceStt(
        {
          action: input.action ?? (input.presetId || input.model ? "apply" : "inspect"),
          presetId: input.presetId,
          model: input.model,
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
          language: input.language,
          routeViaGateway: input.routeViaGateway,
          source: "agent-tool",
        },
        { paseo } as never,
      );
      return {
        text: JSON.stringify(result, null, 2),
        structuredContent: result,
        isError: !result.ok,
      };
    },
  });

  const agentHistoryTool = defineAgentTool({
    name: "manage_agent_history",
    title: "Inspect, Probe, or Self-Heal Paseo Antigravity Agent History & Session Patches",
    description:
      "Inspect Paseo Antigravity session.ts patches & CLI Conversation Vault health (能读), probe a workspace/agent/conversation's .db & transcript status (能试), or trigger 1-click self-healing from local/GDrive vault + antigravity-ops doctor --fix (能调).",
    input: z.object({
      action: z
        .enum(["inspect", "probe", "heal"])
        .optional()
        .describe("inspect (default), probe, or heal"),
      workspaceId: z
        .string()
        .optional()
        .describe("Optional workspace ID or title query to inspect/heal"),
      agentId: z.string().optional().describe("Optional agent ID"),
      conversationId: z.string().optional().describe("Optional Antigravity conversation UUID"),
    }),
    async execute(input, { agent, paseo }) {
      const result = await handleManageAgentHistory(
        {
          action: input.action ?? "inspect",
          workspaceId: input.workspaceId ?? agent.workspaceId ?? undefined,
          agentId: input.agentId,
          conversationId: input.conversationId,
          source: "agent-tool",
        },
        { paseo } as never,
      );
      return {
        text: JSON.stringify(result, null, 2),
        structuredContent: result,
        isError: !result.ok,
      };
    },
  });

  const paseoRecoveryTool = defineAgentTool({
    name: "reconcile_paseo_recovery",
    title: "Inspect, Simulate, or Auto-Pull-Up Interrupted Paseo Agents",
    description:
      "Inspect Paseo's startup auto-pull-up state & tool replay trajectory (能读), simulate interrupted agent detection (能试), or automatically pull up interrupted/startup-failed Paseo agents via antigravity-ops paseo-recovery (能调).",
    input: z.object({
      action: z
        .enum(["status", "simulate", "heal", "reset"])
        .optional()
        .describe("status (default), simulate, heal, or reset"),
      agentId: z
        .string()
        .optional()
        .describe("Optional specific agent ID or prefix to inspect/pull up"),
      maxAgeHours: z
        .number()
        .optional()
        .describe("Transcript activity window in hours (default 12)"),
      prompt: z
        .string()
        .optional()
        .describe("Optional custom resume prompt when action is heal"),
    }),
    async execute(input, { paseo }) {
      const result = await handleReconcilePaseoRecovery(
        {
          action: input.action ?? "status",
          agentId: input.agentId,
          maxAgeHours: input.maxAgeHours,
          prompt: input.prompt,
          source: "agent-tool",
        },
        { paseo } as never,
      );
      return {
        text: JSON.stringify(result, null, 2),
        structuredContent: result,
        isError: !result.ok,
      };
    },
  });

  const slashSkillsTool = defineAgentTool({
    name: "manage_slash_skills",
    title: "Customize & Reconcile Paseo Slash Commands, Skills, Rules, Subagents & MCPs",
    description:
      "Inspect, search, pin/unpin, enable/disable, dry-run test multi-skill prompt expansion, or sync Paseo Antigravity slash commands, skills, rules, subagents, MCPs, and plugins.",
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
        .optional()
        .describe("status/inspect (default), test (dry-run prompt), sync, pin, unpin, enable, disable, or reset-pins"),
      slug: z
        .string()
        .optional()
        .describe("Command or skill slug when action is pin, unpin, enable, or disable (e.g. 'wheel-check')"),
      samplePrompt: z
        .string()
        .optional()
        .describe("Sample prompt containing /commands or inline /skills to dry-run test"),
      category: z
        .enum(["all", "commands", "skills", "rules", "subagents", "mcps", "plugins"])
        .optional()
        .describe("Filter Customize inventory by category"),
      scope: z
        .enum(["all", "workspace", "user", "pinned", "disabled"])
        .optional()
        .describe("Filter Customize inventory by scope"),
      query: z.string().optional().describe("Search query across name, description, and source"),
    }),
    async execute(input, { agent, paseo }) {
      const result = await handleManageSlashSkills(
        {
          action: input.action ?? "status",
          slug: input.slug,
          samplePrompt: input.samplePrompt,
          category: input.category,
          scope: input.scope,
          query: input.query,
          cwd: agent.cwd ?? undefined,
          source: "agent-tool",
        },
        { paseo } as never,
      );
      return {
        text: JSON.stringify(result, null, 2),
        structuredContent: result,
        isError: !result.ok,
      };
    },
  });

  const writebackHookTool = defineAgentTool({
    name: "manage_writeback_hook",
    title: "Inspect, Replay & Tune Antigravity Stop Hook & Writeback Gate",
    description:
      "Inspect, replay against a conversation transcript (comparing legacy v1 vs current v2), tune runtime parameters, or reset the Antigravity finishing-with-writeback Stop hook.",
    input: z.object({
      action: z
        .enum(["status", "simulate", "tune", "reset"])
        .optional()
        .describe("status (default), simulate (replay transcript), tune, or reset"),
      conversationId: z
        .string()
        .optional()
        .describe("Antigravity conversation UUID to replay when action is simulate"),
      enabled: z.boolean().optional().describe("Enable or disable Stop hook gate"),
      maxBlocksPerTurn: z.number().int().min(1).max(5).optional().describe("Max blocks per turn"),
      requireFullyIdle: z
        .boolean()
        .optional()
        .describe("Skip blocking when background tasks are still running (fullyIdle: false)"),
      transcriptTailFallback: z
        .boolean()
        .optional()
        .describe("Inspect transcriptPath tail when finalModelOutput is scrubbed by agy_cli"),
    }),
    async execute(input, { paseo }) {
      const result = await handleManageWritebackHook(
        {
          action: input.action ?? "status",
          conversationId: input.conversationId,
          enabled: input.enabled,
          maxBlocksPerTurn: input.maxBlocksPerTurn,
          requireFullyIdle: input.requireFullyIdle,
          transcriptTailFallback: input.transcriptTailFallback,
          source: "agent-tool",
        },
        { paseo } as never,
      );
      return {
        text: JSON.stringify(result, null, 2),
        structuredContent: result,
        isError: !result.ok,
      };
    },
  });

  const sessionLineageTool = defineAgentTool({
    name: "manage_session_lineage",
    title: "Inspect or Reconcile Session Lineage & Sidebar Workspace Titles",
    description:
      "Inspect parent/initiating session, spawned child sessions, sibling sessions, Intake brief/report/Notion links, or reconcile untitled 'main' sidebar workspaces from their agent title.",
    input: z.object({
      action: z
        .enum(["inspect", "reconcile"])
        .optional()
        .describe("inspect (default) or reconcile (fix untitled 'main' workspaces and missing parent labels)"),
      workspaceId: z.string().optional().describe("Target workspace ID (defaults to active workspace)"),
      agentId: z.string().optional().describe("Target agent ID or prefix (defaults to active agent)"),
    }),
    async execute(input, { agent, paseo }) {
      const result = await handleManageSessionLineage(
        {
          action: input.action ?? "inspect",
          workspaceId: input.workspaceId ?? agent.workspaceId ?? undefined,
          agentId: input.agentId ?? agent.id,
          autoFixTitles: true,
          source: "agent-tool",
        },
        { paseo } as never,
      );
      return {
        text: JSON.stringify(result, null, 2),
        structuredContent: result,
        isError: !result.ok,
      };
    },
  });

  const settingsSearchTool = defineAgentTool({
    name: "search_paseo_settings",
    title: "Find a Paseo Setting",
    description:
      "Find where a Paseo setting lives (page, group, row title, hint and settings route) by keyword, e.g. 'keep daemon running', 'log file', 'send shortcut'. Same index and ranking as the search field in Paseo Settings. Host pages need the host's server id in the route.",
    input: z.object({
      query: z.string().min(1).describe("Words from the setting's name or description"),
      limit: z.number().int().min(1).max(20).optional().describe("Max results (default 8)"),
      serverId: z
        .string()
        .optional()
        .describe("Host server id to fill into host routes (from `paseo daemon status`)"),
    }),
    async execute(input) {
      const results = searchSettingsIndex(SETTINGS_SEARCH_SEED.pages, input.query, {
        limit: input.limit ?? 8,
      }).map((result) => ({
        page: result.pageLabel,
        where: settingsResultBreadcrumb(result) || result.pageLabel,
        title: result.title,
        hint: result.hint ?? null,
        kind: result.kind,
        matchedIn: result.field === 0 ? "title" : result.field === 1 ? "page or group" : "hint",
        route:
          buildSettingsPath(result.pageKey, input.serverId ?? "{serverId}") ??
          `settings page ${result.pageKey}`,
      }));
      const payload = {
        query: input.query,
        count: results.length,
        index: `seed from Paseo ${SETTINGS_SEARCH_SEED.paseoVersion} (${SETTINGS_SEARCH_SEED.generatedAt}); pages opened in the app are also learned there`,
        results,
      };
      return {
        text: JSON.stringify(payload, null, 2),
        structuredContent: payload,
        isError: false,
      };
    },
  });

  server.before("agent.session_open", ({ request }) => {
    return {
      ...request,
      tools: [
        ...(request.tools ?? []),
        revealTool,
        threadMetaTool,
        importFolderTool,
        quickJumpTool,
        scheduleRunsTool,
        voiceSttTool,
        agentHistoryTool,
        paseoRecoveryTool,
        slashSkillsTool,
        writebackHookTool,
        sessionLineageTool,
        settingsSearchTool,
      ],
    };
  });

  return () => {};
}
