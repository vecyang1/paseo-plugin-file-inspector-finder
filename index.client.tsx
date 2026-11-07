import type {
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/ui";
import {
  type OpenerTarget,
  SUPPORTED_IMAGE_EXTENSIONS,
  listWorkspaceMediaRpc,
  openFileTargetRpc,
} from "./shared/contracts";
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
  // 1. Pre-associate image extensions with our rich Image Inspector & Finder file panel
  syncImagePanelAssociations("file-inspector-finder", "image-inspector", true);

  // 2. Register Image & Media File Panel (adds top Finder/Preview/Copy/Metadata toolbar inside image tabs)
  client.addFilePanel({
    id: "image-inspector",
    title: "Image Inspector & Finder",
    icon: "Image",
    files: {
      extensions: SUPPORTED_IMAGE_EXTENSIONS,
    },
    Component: ImageInspectorFilePanel,
  });

  // 3. Register Workspace & Explorer Sidebar Panel
  client.addWorkspacePanel({
    id: "finder-panel",
    title: "Finder & Media Inspector",
    icon: "FolderOpen",
    locations: ["workspace", "explorer"],
    Component: WorkspaceFinderPanel,
  });

  // 4. Register Plugin Settings & Live Diagnostic Screen (UI Observability Mandate)
  client.addSettingsScreen({
    id: "finder-settings",
    title: "File Inspector & Finder",
    icon: "FolderSearch",
    Component: FinderPluginSettingsScreen,
  });

  // 5. Register Command Center (⌘K) actions
  client.addCommandCenterItem({
    id: "reveal-latest-image",
    title: "Finder: 在 Finder 中显示最近生成的图片 (Reveal Latest Image)",
    icon: "Image",
    keywords: ["finder", "reveal", "image", "folder", "open", "文件夹", "图片", "打开"],
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
    title: "Finder: 打开当前工作区文件夹 (Open Workspace Folder in Finder)",
    icon: "FolderOpen",
    keywords: ["finder", "workspace", "folder", "directory", "文件夹", "目录"],
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
    title: "Finder: 打开媒体与文件快开面板 (Open Finder & Media Inspector Panel)",
    icon: "FolderSearch",
    keywords: ["finder", "inspector", "media", "panel", "图片", "面板"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("finder-panel", { location: "explorer" });
    },
  });

  // 6. Register Composer Slash Commands (/reveal and /finder)
  for (const cmdName of ["reveal", "finder"] as const) {
    client.addSlashCommand({
      name: cmdName,
      description: "在 Finder 中定位图片/文件或打开工作区目录 (留空则定位最新生成的图片)",
      argumentHint: "[文件路径或文件名关键词，留空定位最新图片]",
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

  // 7. Dynamically register Top-Right Workspace Header Button + Per-Agent Composer Pill
  const headerButtons = new Map<string, PluginButtonRegistration>();
  const composerPills = new Map<string, PluginButtonRegistration>();
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
          title: "Finder & 媒体文件夹快开器 (Reveal Images & Files in Finder)",
          icon: "FolderOpen",
          behavior: {
            kind: "popover",
            Content: WorkspaceFinderPopover,
          },
        },
      }),
    );
  };

  const registerAgentPill = (agent: { id: string; workspaceId?: string | null }) => {
    if (lifetime.signal.aborted || !agent.workspaceId) return;
    const agentId = agent.id;
    const workspaceId = agent.workspaceId;
    registerWorkspaceHeader({ id: workspaceId });
    composerPills.get(agentId)?.remove();
    composerPills.set(
      agentId,
      client.addComposerPill({
        id: "finder-composer-pill",
        workspaceId,
        agentId,
        button: {
          title: "在 Finder 中定位图片或文件夹 (Finder & Media Inspector)",
          icon: "FolderOpen",
          label: "Finder",
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
          for (const { agent } of entries) registerAgentPill(agent);
        },
        update: (msg) => {
          if (msg.type !== "agent_update") return;
          if (msg.payload.kind === "upsert") {
            registerAgentPill(msg.payload.agent);
          } else {
            composerPills.get(msg.payload.agentId)?.remove();
            composerPills.delete(msg.payload.agentId);
          }
        },
      });
      return undefined;
    })
    .catch(() => {});

  // 8. Install Desktop Right-Click Context Menu, Option+Click, and ⌘⇧R Shortcut Helper
  const cleanupWebHelpers = installDesktopRevealHelpers({
    isEnabled: () => true,
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
    for (const pill of composerPills.values()) pill.remove();
    composerPills.clear();
  };
}
