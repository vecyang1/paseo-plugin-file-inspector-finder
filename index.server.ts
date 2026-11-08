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
  reconcilePaseoRecoveryRpc,
} from "./shared/contracts";
import {
  handleDiagnosePath,
  handleImportFolderWorkspace,
  handleInspectFile,
  handleListWorkspaceMedia,
  handleManageAgentHistory,
  handleManageVoiceStt,
  handleManageWorkspaceLabels,
  handleOpenFileTarget,
  handleQuickJumpWorkspace,
  handleReconcilePaseoRecovery,
  handleRenameThread,
} from "./server/handlers";
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
        "open-latest (default), locate-sidebar, or create-new",
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
        ])
        .optional()
        .describe("list (default), open-run, preview-timeline, run-now, or toggle-archive-on-finish"),
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
      ],
    };
  });

  return () => {};
}
