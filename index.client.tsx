import type {
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/ui";
import {
  type OpenerTarget,
  SUPPORTED_IMAGE_EXTENSIONS,
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
  importFolderWorkspaceRpc,
  listWorkspaceMediaRpc,
  manageWorkspaceLabelsRpc,
  openFileTargetRpc,
  renameWorkspaceOrAgentRpc,
} from "./shared/contracts";
import { pluginTranslations } from "./client/i18n";
import { ImageInspectorFilePanel } from "./client/image-panel";
import { FinderPluginSettingsScreen } from "./client/settings-screen";
import {
  focusWorkspaceInApp,
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

  client.addCommandCenterItem({
    id: "quick-rename-workspace",
    title: pluginTranslations.message("commands.quickRenameWorkspace"),
    icon: "Edit3",
    keywords: ["rename", "title", "thread", "workspace", "name", "f2"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("finder-panel", { location: "explorer" });
    },
  });

  client.addCommandCenterItem({
    id: "quick-manage-labels",
    title: pluginTranslations.message("commands.quickManageLabels"),
    icon: "Tag",
    keywords: ["label", "tag", "color", "thread", "workspace"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("finder-panel", { location: "explorer" });
    },
  });

  client.addCommandCenterItem({
    id: "import-folder-workspace",
    title: pluginTranslations.message("commands.importFolderWorkspace"),
    icon: "FolderPlus",
    keywords: ["folder", "drop", "import", "workspace", "project", "open"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("finder-panel", { location: "explorer" });
    },
  });

  // 6. Register Composer Slash Commands (/reveal, /finder, /rename, /title, /label, /tag)
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

  for (const cmdName of ["rename", "title"] as const) {
    client.addSlashCommand({
      name: cmdName,
      description: pluginTranslations.message("commands.renameSlashDescription"),
      argumentHint: pluginTranslations.message("commands.renameSlashHint"),
      context: "workspace",
      async onSubmit({ args, workspace, rpc }) {
        const trimmed = args.trim();
        if (!trimmed) return;
        const normalized =
          trimmed.toLowerCase() === "clear" || trimmed.toLowerCase() === "reset"
            ? null
            : trimmed;
        await client.paseo.workspaces.ref(workspace.id).setTitle(normalized);
        await rpc(renameWorkspaceOrAgentRpc, {
          workspaceId: workspace.id,
          title: normalized,
        });
      },
    });
  }

  const validColorSet = new Set<string>(WORKSPACE_LABEL_COLORS);

  for (const cmdName of ["label", "tag"] as const) {
    client.addSlashCommand({
      name: cmdName,
      description: pluginTranslations.message("commands.labelSlashDescription"),
      argumentHint: pluginTranslations.message("commands.labelSlashHint"),
      context: "workspace",
      async onSubmit({ args, workspace, rpc }) {
        const tokens = args.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return;

        const firstLower = tokens[0].toLowerCase();
        if (firstLower === "delete" || firstLower === "rm" || firstLower === "remove") {
          const targetName = tokens.slice(1).join(" ");
          if (!targetName) return;
          await rpc(manageWorkspaceLabelsRpc, {
            action: "delete",
            workspaceId: workspace.id,
            labelName: targetName,
          });
          return;
        }

        if (firstLower === "rename" || firstLower === "update") {
          const oldName = tokens[1];
          const newName = tokens[2];
          const maybeColor = tokens[3]?.toLowerCase();
          if (!oldName || !newName) return;
          await rpc(manageWorkspaceLabelsRpc, {
            action: "update",
            workspaceId: workspace.id,
            labelName: oldName,
            newName,
            color:
              maybeColor && validColorSet.has(maybeColor)
                ? (maybeColor as WorkspaceLabelColor)
                : undefined,
          });
          return;
        }

        const lastTokenLower = tokens[tokens.length - 1].toLowerCase();
        const hasTrailingColor = tokens.length >= 2 && validColorSet.has(lastTokenLower);
        const color = hasTrailingColor ? (lastTokenLower as WorkspaceLabelColor) : undefined;
        const labelName = hasTrailingColor
          ? tokens.slice(0, -1).join(" ")
          : tokens.join(" ");

        await rpc(manageWorkspaceLabelsRpc, {
          action: "toggle",
          workspaceId: workspace.id,
          labelName,
          color,
        });
      },
    });
  }

  for (const cmdName of ["open-folder", "import-workspace"] as const) {
    client.addSlashCommand({
      name: cmdName,
      description: pluginTranslations.message("commands.openFolderSlashDescription"),
      argumentHint: pluginTranslations.message("commands.openFolderSlashHint"),
      context: "workspace",
      async onSubmit({ args, rpc }) {
        const trimmed = args.trim();
        if (!trimmed) return;
        const res = await rpc(importFolderWorkspaceRpc, {
          paths: [trimmed],
          source: "slash-command",
        });
        if (res.ok && res.primaryWorkspaceId) {
          focusWorkspaceInApp(res.primaryWorkspaceId, res.primaryProjectId);
        }
      },
    });
  }

  // 7. Dynamically register Top-Right Workspace Header Button
  const headerButtons = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  let lastKnownWorkspaceId: string | undefined;

  const registerWorkspaceHeader = (workspace: { id: string }) => {
    if (lifetime.signal.aborted) return;
    const workspaceId = workspace.id;
    lastKnownWorkspaceId = workspaceId;
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

  // 8. Extend Native Tab Context Menus In-Place + Chat File Link Menu + Option+Click + ⌘⇧R + F2 / ⌘⇧E / ⌘⇧L
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
    onFetchThreadMetadata: async () => {
      const res = await client.rpc(manageWorkspaceLabelsRpc, {
        action: "inspect",
        workspaceId: lastKnownWorkspaceId,
      });
      if (!res.ok) return null;
      lastKnownWorkspaceId = res.workspaceId || lastKnownWorkspaceId;
      return {
        workspaceId: res.workspaceId,
        workspaceTitle: res.workspaceTitle,
        assignedLabels: res.assignedLabels,
        catalog: res.catalog,
      };
    },
    onRenameThread: async (newTitle: string | null) => {
      if (lastKnownWorkspaceId) {
        try {
          await client.paseo.workspaces.ref(lastKnownWorkspaceId).setTitle(newTitle);
        } catch {
          // Fallback to RPC
        }
      }
      await client.rpc(renameWorkspaceOrAgentRpc, {
        workspaceId: lastKnownWorkspaceId,
        title: newTitle,
      });
    },
    onToggleLabel: async (labelName: string, color?: WorkspaceLabelColor) => {
      const res = await client.rpc(manageWorkspaceLabelsRpc, {
        action: "toggle",
        workspaceId: lastKnownWorkspaceId,
        labelName,
        color,
      });
      if (!res.ok) return null;
      return {
        workspaceId: res.workspaceId,
        workspaceTitle: res.workspaceTitle,
        assignedLabels: res.assignedLabels,
        catalog: res.catalog,
      };
    },
    onDropFolders: async (paths: string[], options: { forceNew: boolean }) => {
      const res = await client.rpc(importFolderWorkspaceRpc, {
        paths,
        ...(options.forceNew ? { mode: "always-create" as const } : {}),
        source: "sidebar-drop",
      });
      if (res.disabled) {
        return null;
      }
      if (res.ok && res.primaryWorkspaceId) {
        lastKnownWorkspaceId = res.primaryWorkspaceId;
      }
      return {
        ok: res.ok,
        primaryWorkspaceId: res.primaryWorkspaceId,
        primaryProjectId: res.primaryProjectId,
        primaryWorkspaceName: res.primaryWorkspaceName,
        createdCount: res.createdCount,
        reusedCount: res.reusedCount,
        message: res.message,
      };
    },
  });

  return () => {
    lifetime.abort();
    cleanupWebHelpers();
    for (const btn of headerButtons.values()) btn.remove();
    headerButtons.clear();
  };
}
