import type {
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/ui";
import {
  type OpenerTarget,
  SUPPORTED_IMAGE_EXTENSIONS,
  listWorkspaceMediaRpc,
  openFileTargetRpc,
} from "./shared/contracts";
import { pluginTranslations } from "./client/i18n";
import { ImageInspectorFilePanel } from "./client/image-panel";
import { FinderPluginSettingsScreen } from "./client/settings-screen";
import {
  installDesktopRevealHelpers,
  syncImagePanelAssociations,
} from "./client/web";
import {
  WorkspaceFinderPanel,
  WorkspaceFinderPopover,
} from "./client/workspace-finder";

export default function contribute(client: PluginClientContext) {
  // 1. Pre-associate image extensions with our Image Inspector file panel
  syncImagePanelAssociations("file-inspector-finder", "image-inspector", true);

  // 2. Register Image & Media File Panel (adds top Finder/Preview/Copy/Metadata toolbar inside image tabs)
  client.addFilePanel({
    id: "image-inspector",
    title: pluginTranslations.message("plugin.filePanelTitle"),
    icon: "Image",
    files: {
      extensions: SUPPORTED_IMAGE_EXTENSIONS,
    },
    Component: ImageInspectorFilePanel,
  });

  // 3. Register Workspace & Explorer Sidebar Panel
  client.addWorkspacePanel({
    id: "finder-panel",
    title: pluginTranslations.message("plugin.workspacePanelTitle"),
    icon: "FolderOpen",
    locations: ["workspace", "explorer"],
    Component: WorkspaceFinderPanel,
  });

  // 4. Register Plugin Settings & Live Diagnostic Screen
  client.addSettingsScreen({
    id: "finder-settings",
    title: pluginTranslations.message("plugin.settingsTitle"),
    icon: "FolderSearch",
    Component: FinderPluginSettingsScreen,
  });

  // 5. Register Command Center (⌘K) actions
  client.addCommandCenterItem({
    id: "reveal-latest-image",
    title: pluginTranslations.message("commands.revealLatestImage"),
    icon: "Image",
    keywords: ["finder", "reveal", "image", "folder", "open"],
    context: "workspace",
    async onSelect({ workspace, rpc }) {
      const list = await rpc(listWorkspaceMediaRpc, {
        workspaceId: workspace.id,
        workspaceRoot: workspace.directory ?? undefined,
        onlyImages: true,
        limit: 1,
      });
      const latest = list.items[0];
      if (latest) {
        await rpc(openFileTargetRpc, {
          workspaceId: workspace.id,
          workspaceRoot: workspace.directory ?? undefined,
          path: latest.absolutePath,
          target: "finder-reveal",
        });
      } else {
        await rpc(openFileTargetRpc, {
          workspaceId: workspace.id,
          workspaceRoot: workspace.directory ?? undefined,
          path: ".",
          target: "finder-folder",
        });
      }
    },
  });

  client.addCommandCenterItem({
    id: "open-workspace-folder",
    title: pluginTranslations.message("commands.openWorkspaceFolder"),
    icon: "FolderOpen",
    keywords: ["finder", "workspace", "folder", "directory"],
    context: "workspace",
    async onSelect({ workspace, rpc }) {
      await rpc(openFileTargetRpc, {
        workspaceId: workspace.id,
        workspaceRoot: workspace.directory ?? undefined,
        path: ".",
        target: "finder-folder",
      });
    },
  });

  client.addCommandCenterItem({
    id: "open-finder-inspector-panel",
    title: pluginTranslations.message("commands.openInspectorPanel"),
    icon: "FolderSearch",
    keywords: ["finder", "inspector", "media", "panel"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("finder-panel", { location: "explorer" });
    },
  });

  // 6. Register Composer Slash Commands (/reveal and /finder)
  for (const cmdName of ["reveal", "finder"] as const) {
    client.addSlashCommand({
      name: cmdName,
      description: pluginTranslations.message("commands.slashDescription"),
      argumentHint: pluginTranslations.message("commands.slashHint"),
      context: "workspace",
      async onSubmit({ args, workspace, rpc }) {
        const trimmed = args.trim();
        if (!trimmed) {
          const list = await rpc(listWorkspaceMediaRpc, {
            workspaceId: workspace.id,
            workspaceRoot: workspace.directory ?? undefined,
            onlyImages: true,
            limit: 1,
          });
          const latest = list.items[0];
          await rpc(openFileTargetRpc, {
            workspaceId: workspace.id,
            workspaceRoot: workspace.directory ?? undefined,
            path: latest ? latest.absolutePath : ".",
            target: latest ? "finder-reveal" : "finder-folder",
          });
          return;
        }
        await rpc(openFileTargetRpc, {
          workspaceId: workspace.id,
          workspaceRoot: workspace.directory ?? undefined,
          path: trimmed,
          target: "finder-reveal",
        });
      },
    });
  }

  // 7. Dynamically register Top-Right Workspace Header Button
  const headerButtons = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();

  const registerWorkspaceHeader = (workspace: { id: string }) => {
    if (lifetime.signal.aborted) return;
    const workspaceId = workspace.id;
    headerButtons.get(workspaceId)?.remove();
    headerButtons.set(
      workspaceId,
      client.addHeaderButton({
        id: "finder-header-btn",
        workspaceId,
        button: {
          title: pluginTranslations.message("plugin.headerButtonTitle"),
          icon: "FolderOpen",
          behavior: {
            kind: "popover",
            Content: WorkspaceFinderPopover,
          },
        },
      }),
    );
  };

  void client.paseo.workspaces
    .list({ subscribe: {} })
    .then(({ entries, subscription }) => {
      for (const ws of entries) registerWorkspaceHeader(ws);
      subscription.subscribe({
        snapshot: ({ entries: nextEntries }) => {
          for (const ws of nextEntries) registerWorkspaceHeader(ws);
        },
        update: (msg) => {
          if (msg.type === "workspace_update" && msg.payload.kind === "upsert") {
            registerWorkspaceHeader(msg.payload.workspace);
          }
        },
      });
      return undefined;
    })
    .catch(() => {});

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          for (const { agent } of entries) {
            if (agent.workspaceId) registerWorkspaceHeader({ id: agent.workspaceId });
          }
        },
        update: (msg) => {
          if (
            msg.type === "agent_update" &&
            msg.payload.kind === "upsert" &&
            msg.payload.agent.workspaceId
          ) {
            registerWorkspaceHeader({ id: msg.payload.agent.workspaceId });
          }
        },
      });
      return undefined;
    })
    .catch(() => {});

  // 8. Extend Native Tab Context Menus In-Place + Chat File Link Menu + Option+Click + ⌘⇧R
  const cleanupWebHelpers = installDesktopRevealHelpers({
    isEnabled: () => true,
    getLocale: () => client.i18n.locale,
    onOpenTarget: async (path: string, target: OpenerTarget) => {
      await client.rpc(openFileTargetRpc, {
        path,
        target,
      });
    },
    onCopyPath: async (path: string) => {
      await copyText(path);
    },
  });

  return () => {
    lifetime.abort();
    cleanupWebHelpers();
    for (const btn of headerButtons.values()) btn.remove();
    headerButtons.clear();
  };
}
