import { defineAgentTool, type PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  OpenerTargetSchema,
  diagnosePathRpc,
  inspectFileRpc,
  listWorkspaceMediaRpc,
  openFileTargetRpc,
  pluginSettings,
} from "./shared/contracts";
import {
  handleDiagnosePath,
  handleInspectFile,
  handleListWorkspaceMedia,
  handleOpenFileTarget,
} from "./server/handlers";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(pluginSettings);

  server.handle(inspectFileRpc, handleInspectFile);
  server.handle(openFileTargetRpc, handleOpenFileTarget);
  server.handle(listWorkspaceMediaRpc, handleListWorkspaceMedia);
  server.handle(diagnosePathRpc, handleDiagnosePath);

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

  server.before("agent.session_open", ({ request }) => {
    return {
      ...request,
      tools: [...(request.tools ?? []), revealTool],
    };
  });

  return () => {};
}
