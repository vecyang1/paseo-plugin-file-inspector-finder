import { defineAgentTool, type PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  OpenerTargetSchema,
  WorkspaceLabelColorSchema,
  diagnosePathRpc,
  inspectFileRpc,
  listWorkspaceMediaRpc,
  manageWorkspaceLabelsRpc,
  openFileTargetRpc,
  pluginSettings,
  renameWorkspaceOrAgentRpc,
} from "./shared/contracts";
import {
  handleDiagnosePath,
  handleInspectFile,
  handleListWorkspaceMedia,
  handleManageWorkspaceLabels,
  handleOpenFileTarget,
  handleRenameThread,
} from "./server/handlers";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(pluginSettings);

  server.handle(inspectFileRpc, handleInspectFile);
  server.handle(openFileTargetRpc, handleOpenFileTarget);
  server.handle(listWorkspaceMediaRpc, handleListWorkspaceMedia);
  server.handle(diagnosePathRpc, handleDiagnosePath);
  server.handle(renameWorkspaceOrAgentRpc, handleRenameThread);
  server.handle(manageWorkspaceLabelsRpc, handleManageWorkspaceLabels);

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

  server.before("agent.session_open", ({ request }) => {
    return {
      ...request,
      tools: [...(request.tools ?? []), revealTool, threadMetaTool],
    };
  });

  return () => {};
}
