import type {
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/ui";
import {
  type OpenerTarget,
  type QuickJumpAction,
  SUPPORTED_IMAGE_EXTENSIONS,
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
  extractProjectSearchKeywords,
  importFolderWorkspaceRpc,
  listWorkspaceMediaRpc,
  manageVoiceSttRpc,
  manageWorkspaceLabelsRpc,
  openFileTargetRpc,
  quickJumpWorkspaceRpc,
  renameWorkspaceOrAgentRpc,
} from "./shared/contracts";
import { getCatalogForLocale, pluginTranslations } from "./client/i18n";
import { ImageInspectorFilePanel } from "./client/image-panel";
import { FinderPluginSettingsScreen } from "./client/settings-screen";
import { installDesktopVoiceSttEnhancer } from "./client/voice-stt-web";
import {
  findF2InlineRenameTarget,
  focusWorkspaceInApp,
  installDesktopRevealHelpers,
  locateProjectInSidebar,
  mountInlineTitleInput,
  openQuickWorkspaceSwitcherModal,
  readQuickJumpPreferences,
  syncImagePanelAssociations,
} from "./client/web";
import {
  WorkspaceFinderPanel,
  WorkspaceFinderPopover,
} from "./client/workspace-finder";
import {
  installDesktopScheduleRunsEnhancer,
  triggerScheduleRunsDrawer,
} from "./client/schedule-runs-web";

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
    onSelect({ workspace, openPanel, rpc }) {
      const g = globalThis as { document?: unknown; window?: unknown };
      if (g.document && g.window) {
        const target = findF2InlineRenameTarget(
          g.document as Parameters<typeof findF2InlineRenameTarget>[0],
          g.window as Parameters<typeof findF2InlineRenameTarget>[1],
          workspace.id,
        );
        if (target) {
          setTimeout(() => {
            mountInlineTitleInput(
              g.document as Parameters<typeof mountInlineTitleInput>[0],
              g.window as Parameters<typeof mountInlineTitleInput>[1],
              target,
              async (nextTitle, meta) => {
                const targetWsId = meta?.workspaceId ?? workspace.id;
                if (targetWsId && !meta?.agentId) {
                  try {
                    await client.paseo.workspaces.ref(targetWsId).setTitle(nextTitle);
                  } catch {
                    // Fallback to RPC
                  }
                }
                await rpc(renameWorkspaceOrAgentRpc, {
                  workspaceId: targetWsId,
                  agentId: meta?.agentId,
                  title: nextTitle,
                  source: meta?.source ?? "f2-inline",
                });
              },
            );
          }, 40);
          return;
        }
      }
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

  const launchQuickJumpModal = (initialQuery?: string) => {
    const jumpPrefs = readQuickJumpPreferences();
    void openQuickWorkspaceSwitcherModal({
      initialQuery,
      locale: client.i18n.locale,
      defaultJumpMode: jumpPrefs.quickJumpDefaultAction,
      onListJumpProjects: async (query?: string) => {
        const res = await client.rpc(quickJumpWorkspaceRpc, {
          action: "list",
          query,
          limit: 50,
          source: "quick-switcher",
        });
        return res.candidates;
      },
      onExecuteQuickJump: async (input) => {
        const res = await client.rpc(quickJumpWorkspaceRpc, {
          action: "jump",
          projectId: input.projectId,
          query: input.query,
          jumpMode: input.jumpMode,
          source: input.source ?? "quick-switcher",
        });
        if (res.ok && res.targetWorkspaceId) {
          lastKnownWorkspaceId = res.targetWorkspaceId;
        }
        return {
          ok: res.ok,
          jumpMode: res.jumpMode,
          targetWorkspaceId: res.targetWorkspaceId,
          targetProjectId: res.targetProjectId,
          targetProjectKey: res.targetProjectKey,
          targetProjectName: res.targetProjectName,
          message: res.message,
        };
      },
    });
  };

  client.addCommandCenterItem({
    id: "quick-jump-workspace",
    title: pluginTranslations.message("commands.quickJumpWorkspace"),
    icon: "FolderSearch",
    keywords: [
      "jump",
      "switch",
      "workspace",
      "project",
      "folder",
      "go",
      "cmd+j",
      "quick",
    ],
    context: "global",
    onSelect({ openSettings }) {
      setTimeout(() => {
        launchQuickJumpModal();
      }, 30);
      void openSettings;
    },
  });

  client.addCommandCenterItem({
    id: "inspect-schedule-runs",
    title: "Schedules: Inspect Runs & Execution History (⌘⇧H)",
    icon: "Clock",
    keywords: [
      "schedule",
      "runs",
      "history",
      "cadence",
      "automation",
      "standby",
      "logs",
      "定时任务",
      "运行记录",
      "历史",
    ],
    context: "global",
    onSelect() {
      setTimeout(() => {
        triggerScheduleRunsDrawer(null);
      }, 30);
    },
  });

  client.addSlashCommand({
    name: "schedule-runs",
    description:
      "Open Paseo Schedule Runs & Execution History drawer (or inspect a specific schedule ID)",
    argumentHint: "[schedule-id]",
    context: "workspace",
    async onSubmit({ args }) {
      const sid = args.trim() || null;
      setTimeout(() => {
        triggerScheduleRunsDrawer(sid);
      }, 30);
    },
  });

  client.addCommandCenterItem({
    id: "configure-custom-voice-stt",
    title: pluginTranslations.message("commands.configureVoiceStt"),
    icon: "Activity",
    keywords: [
      "voice",
      "stt",
      "speech",
      "dictation",
      "siliconflow",
      "openwhispr",
      "sensevoice",
      "qwen",
      "telespeech",
      "whisper",
      "语音",
      "硅基流动",
    ],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("finder-settings");
    },
  });

  for (const cmdName of ["voice", "stt"] as const) {
    client.addSlashCommand({
      name: cmdName,
      description: pluginTranslations.message("commands.voiceSlashDescription"),
      argumentHint: pluginTranslations.message("commands.voiceSlashHint"),
      context: "workspace",
      async onSubmit({ args, rpc }) {
        const trimmed = args.trim();
        if (!trimmed) {
          await rpc(manageVoiceSttRpc, {
            action: "inspect",
            source: "slash-command",
          });
          return;
        }
        const lower = trimmed.toLowerCase();
        if (lower === "test" || lower === "probe") {
          await rpc(manageVoiceSttRpc, {
            action: "test",
            source: "slash-command",
          });
          return;
        }
        if (lower === "reset" || lower === "default") {
          await rpc(manageVoiceSttRpc, {
            action: "reset",
            source: "slash-command",
          });
          return;
        }
        await rpc(manageVoiceSttRpc, {
          action: "apply",
          presetId: trimmed,
          model: trimmed,
          source: "slash-command",
        });
      },
    });
  }

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
          source: "slash-command",
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

  for (const cmdName of ["jump", "go"] as const) {
    client.addSlashCommand({
      name: cmdName,
      description: pluginTranslations.message("commands.jumpSlashDescription"),
      argumentHint: pluginTranslations.message("commands.jumpSlashHint"),
      context: "workspace",
      async onSubmit({ args, rpc }) {
        const trimmed = args.trim();
        if (!trimmed) {
          launchQuickJumpModal();
          return;
        }
        const res = await rpc(quickJumpWorkspaceRpc, {
          action: "jump",
          query: trimmed,
          source: "slash-command",
        });
        if (!res.ok) {
          launchQuickJumpModal(trimmed);
          return;
        }
        if (res.jumpMode === "locate-sidebar") {
          locateProjectInSidebar({
            projectId: res.targetProjectId,
            projectKey: res.targetProjectKey,
            projectName: res.targetProjectName,
            expandIfCollapsed: true,
            highlightFlash: true,
          });
        } else if (res.targetWorkspaceId) {
          lastKnownWorkspaceId = res.targetWorkspaceId;
          focusWorkspaceInApp(
            res.targetWorkspaceId,
            res.targetProjectId,
            undefined,
            undefined,
            {
              projectKey: res.targetProjectKey,
              projectName: res.targetProjectName,
            },
          );
        }
      },
    });
  }

  // 7. Dynamically register Top-Right Workspace Header Button + Command Center (⌘K) Project Jump Items
  const headerButtons = new Map<string, PluginButtonRegistration>();
  const projectCommandCleanups = new Map<string, () => void>();
  const lifetime = new AbortController();
  let lastKnownWorkspaceId: string | undefined;
  let syncProjectsTimer: ReturnType<typeof setTimeout> | null = null;

  const clearProjectCommandItems = () => {
    for (const cleanup of projectCommandCleanups.values()) {
      try {
        cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
    projectCommandCleanups.clear();
  };

  const syncCommandCenterProjectItems = async () => {
    if (lifetime.signal.aborted) return;
    const res = await client
      .rpc(quickJumpWorkspaceRpc, {
        action: "list",
        limit: 50,
        source: "command-center",
      })
      .catch(() => null);
    if (!res || lifetime.signal.aborted) return;

    const jumpPrefs = readQuickJumpPreferences();
    if (!jumpPrefs.enableCommandCenterProjectItems) {
      clearProjectCommandItems();
      return;
    }

    const catalog = getCatalogForLocale(client.i18n.locale);
    const seenIds = new Set<string>();

    for (const candidate of res.candidates) {
      const itemId = `jump-project-${candidate.projectId}`;
      seenIds.add(itemId);
      projectCommandCleanups.get(itemId)?.();

      const cleanup = client.addCommandCenterItem({
        id: itemId,
        title: `${catalog.commands.jumpToProjectPrefix} ${candidate.projectName} (${candidate.activeWorkspaceCount})`,
        icon: "FolderOpen",
        keywords: extractProjectSearchKeywords(
          candidate.projectName,
          candidate.projectRootPath,
        ),
        context: "global",
        async onSelect({ rpc }) {
          const jumpRes = await rpc(quickJumpWorkspaceRpc, {
            action: "jump",
            projectId: candidate.projectId,
            source: "command-center",
          });
          if (!jumpRes.ok) return;
          if (jumpRes.jumpMode === "locate-sidebar") {
            locateProjectInSidebar({
              projectId: jumpRes.targetProjectId ?? candidate.projectId,
              projectKey: jumpRes.targetProjectKey ?? candidate.projectKey,
              projectName: jumpRes.targetProjectName ?? candidate.projectName,
              expandIfCollapsed: true,
              highlightFlash: true,
            });
          } else if (jumpRes.targetWorkspaceId) {
            lastKnownWorkspaceId = jumpRes.targetWorkspaceId;
            focusWorkspaceInApp(
              jumpRes.targetWorkspaceId,
              jumpRes.targetProjectId ?? candidate.projectId,
              undefined,
              undefined,
              {
                projectKey: jumpRes.targetProjectKey ?? candidate.projectKey,
                projectName: jumpRes.targetProjectName ?? candidate.projectName,
              },
            );
          }
        },
      });

      if (typeof cleanup === "function") {
        projectCommandCleanups.set(itemId, cleanup);
      }
    }

    for (const [existingId, cleanup] of projectCommandCleanups.entries()) {
      if (!seenIds.has(existingId)) {
        try {
          cleanup();
        } catch {
          // Ignore
        }
        projectCommandCleanups.delete(existingId);
      }
    }
  };

  const scheduleCommandCenterProjectsSync = () => {
    if (lifetime.signal.aborted) return;
    if (syncProjectsTimer) {
      clearTimeout(syncProjectsTimer);
    }
    syncProjectsTimer = setTimeout(() => {
      void syncCommandCenterProjectItems();
    }, 120);
  };

  void syncCommandCenterProjectItems();

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
          scheduleCommandCenterProjectsSync();
        },
        update: (msg) => {
          if (msg.type === "workspace_update" && msg.payload.kind === "upsert") {
            registerWorkspaceHeader(msg.payload.workspace);
          }
          scheduleCommandCenterProjectsSync();
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

  // 8. Extend Native Tab Context Menus In-Place + Chat File Link Menu + Option+Click + ⌘⇧R + Double-Click Inline Rename + F2 / ⌘⇧E / ⌘⇧L
  const cleanupWebHelpers = installDesktopRevealHelpers({
    isEnabled: () => true,
    getLocale: () => client.i18n.locale,
    getFallbackWorkspaceId: () => lastKnownWorkspaceId,
    onOpenTarget: async (path: string, target: OpenerTarget) => {
      await client.rpc(openFileTargetRpc, {
        path,
        target,
      });
    },
    onCopyPath: async (path: string) => {
      await copyText(path);
    },
    onFetchThreadMetadata: async (explicitWorkspaceId?: string) => {
      const res = await client.rpc(manageWorkspaceLabelsRpc, {
        action: "inspect",
        workspaceId: explicitWorkspaceId ?? lastKnownWorkspaceId,
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
    onRenameThread: async (
      newTitle: string | null,
      options?: {
        workspaceId?: string;
        agentId?: string;
        source?:
          | "inline-sidebar"
          | "inline-header"
          | "inline-tab"
          | "f2-inline"
          | "slash-command"
          | "ui"
          | "agent-tool";
      },
    ) => {
      const targetWsId = options?.workspaceId ?? lastKnownWorkspaceId;
      if (targetWsId && !options?.agentId) {
        try {
          await client.paseo.workspaces.ref(targetWsId).setTitle(newTitle);
        } catch {
          // Fallback to RPC
        }
      }
      await client.rpc(renameWorkspaceOrAgentRpc, {
        workspaceId: targetWsId,
        agentId: options?.agentId,
        title: newTitle,
        source: options?.source,
      });
    },
    onToggleLabel: async (
      labelName: string,
      color?: WorkspaceLabelColor,
      explicitWorkspaceId?: string,
    ) => {
      const res = await client.rpc(manageWorkspaceLabelsRpc, {
        action: "toggle",
        workspaceId: explicitWorkspaceId ?? lastKnownWorkspaceId,
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
    onListJumpProjects: async (query?: string) => {
      const res = await client.rpc(quickJumpWorkspaceRpc, {
        action: "list",
        query,
        limit: 50,
        source: "quick-switcher",
      });
      return res.candidates;
    },
    onExecuteQuickJump: async (input: {
      projectId?: string;
      query?: string;
      jumpMode?: QuickJumpAction;
      source?: "quick-switcher";
    }) => {
      const res = await client.rpc(quickJumpWorkspaceRpc, {
        action: "jump",
        projectId: input.projectId,
        query: input.query,
        jumpMode: input.jumpMode,
        source: input.source ?? "quick-switcher",
      });
      if (res.ok && res.targetWorkspaceId) {
        lastKnownWorkspaceId = res.targetWorkspaceId;
      }
      return {
        ok: res.ok,
        jumpMode: res.jumpMode,
        targetWorkspaceId: res.targetWorkspaceId,
        targetProjectId: res.targetProjectId,
        targetProjectKey: res.targetProjectKey,
        targetProjectName: res.targetProjectName,
        message: res.message,
      };
    },
  });

  const cleanupScheduleRunsEnhancer = installDesktopScheduleRunsEnhancer({
    call: (def, input) => client.rpc(def as never, input as never) as never,
  });

  const cleanupVoiceSttEnhancer = installDesktopVoiceSttEnhancer({
    call: (def, input) => client.rpc(def, input),
    getLocale: () => client.i18n.locale,
  });

  return () => {
    lifetime.abort();
    if (syncProjectsTimer) {
      clearTimeout(syncProjectsTimer);
    }
    clearProjectCommandItems();
    cleanupWebHelpers();
    cleanupScheduleRunsEnhancer();
    cleanupVoiceSttEnhancer();
    for (const btn of headerButtons.values()) btn.remove();
    headerButtons.clear();
  };
}
