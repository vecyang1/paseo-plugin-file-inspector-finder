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
} from "./shared/contracts";
import {
  handleDiagnosePath,
  handleImportFolderWorkspace,
  handleInspectFile,
  handleListWorkspaceMedia,
  handleManageWorkspaceLabels,
  handleOpenFileTarget,
  handleQuickJumpWorkspace,
  handleRenameThread,
} from "./server/handlers";

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

  server.before("agent.session_open", ({ request }) => {
    return {
      ...request,
      tools: [
        ...(request.tools ?? []),
        revealTool,
        threadMetaTool,
        importFolderTool,
        quickJumpTool,
      ],
    };
  });

  return () => {};
}
