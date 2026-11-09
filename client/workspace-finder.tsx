import {
  type PluginButtonContentProps,
  type PluginWorkspacePanelProps,
  useRpc,
  useSettings,
  useTranslation,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { Icon, Loading, ScrollView, TextInput, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type FileMetadata,
  type OpenerTarget,
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
  importFolderWorkspaceRpc,
  listWorkspaceMediaRpc,
  manageWorkspaceLabelsRpc,
  openFileTargetRpc,
  pluginSettings,
  quickJumpWorkspaceRpc,
  renameWorkspaceOrAgentRpc,
} from "../shared/contracts";
import { pluginTranslations } from "./i18n";
import {
  LABEL_COLOR_HEX,
  focusWorkspaceInApp,
  openQuickWorkspaceSwitcherModal,
  syncInlineRenamePreferences,
  syncQuickJumpPreferences,
  syncSidebarDropPreferences,
} from "./web";

interface SharedFinderBrowserProps {
  workspaceId: string;
  theme: PluginWorkspacePanelProps["theme"];
  compact: boolean;
  onClosePopover?: () => void;
}

function FinderBrowserView({
  workspaceId,
  theme,
  compact,
  onClosePopover,
}: SharedFinderBrowserProps) {
  const { t } = useTranslation(pluginTranslations);
  const toast = useToast();
  const listMedia = useRpc(listWorkspaceMediaRpc);
  const openTarget = useRpc(openFileTargetRpc);
  const renameThread = useRpc(renameWorkspaceOrAgentRpc);
  const manageLabels = useRpc(manageWorkspaceLabelsRpc);
  const importFolder = useRpc(importFolderWorkspaceRpc);
  const quickJump = useRpc(quickJumpWorkspaceRpc);
  const settingsState = useSettings(pluginSettings);

  useEffect(() => {
    if (settingsState.status === "ready") {
      syncSidebarDropPreferences(
        settingsState.values.enableSidebarFolderDrop,
        settingsState.values.sidebarDropDefaultBehavior,
      );
      syncInlineRenamePreferences({
        enableInlineDoubleClickRename:
          settingsState.values.enableInlineDoubleClickRename,
        enableQuickRenameAndLabelShortcuts:
          settingsState.values.enableQuickRenameAndLabelShortcuts,
        enableDesktopContextMenuHelper:
          settingsState.values.enableDesktopContextMenuHelper,
      });
      syncQuickJumpPreferences({
        enableWorkspaceQuickJump: settingsState.values.enableWorkspaceQuickJump,
        enableCommandCenterProjectItems:
          settingsState.values.enableCommandCenterProjectItems,
        quickJumpDefaultAction: settingsState.values.quickJumpDefaultAction,
      });
    }
  }, [settingsState]);

  const workspace = useWorkspace(workspaceId, (w) => ({
    name: w.name,
    directory: w.directory,
  }));

  const maxLimit =
    settingsState.status === "ready" ? settingsState.values.maxRecentFiles : 24;

  const [onlyImages, setOnlyImages] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [folderImportPath, setFolderImportPath] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState<WorkspaceLabelColor>("amber");

  const importFolderMutation = useMutation({
    mutationFn: (rawFolder: string) =>
      importFolder({
        paths: [rawFolder],
        source: "ui",
      }),
    onSuccess: (res) => {
      void mediaQuery.refetch();
      if (res.ok) {
        setFolderImportPath("");
        toast.show(res.message, { variant: "success" });
        if (res.primaryWorkspaceId) {
          onClosePopover?.();
          focusWorkspaceInApp(res.primaryWorkspaceId, res.primaryProjectId);
        }
      } else {
        toast.error(res.message);
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const labelsQuery = useQuery({
    queryKey: ["finder.manageWorkspaceLabels", workspaceId],
    queryFn: () =>
      manageLabels({
        action: "inspect",
        workspaceId,
      }),
    staleTime: 3000,
  });

  const renameMutation = useMutation({
    mutationFn: (nextTitle: string | null) =>
      renameThread({
        workspaceId,
        title: nextTitle,
        source: "ui",
      }),
    onSuccess: (res) => {
      void labelsQuery.refetch();
      void mediaQuery.refetch();
      if (res.ok) {
        toast.show(res.message, { variant: "success" });
      } else {
        toast.error(res.message);
      }
    },
  });

  const labelMutation = useMutation({
    mutationFn: (vars: {
      action: "toggle" | "assign" | "unassign" | "update" | "delete";
      labelName: string;
      color?: WorkspaceLabelColor;
    }) =>
      manageLabels({
        action: vars.action,
        workspaceId,
        labelName: vars.labelName,
        color: vars.color,
      }),
    onSuccess: (res) => {
      void labelsQuery.refetch();
      void mediaQuery.refetch();
      if (res.ok) {
        toast.show(res.message, { variant: "success" });
      } else {
        toast.error(res.message);
      }
    },
  });

  const mediaQuery = useQuery({
    queryKey: [
      "finder.listWorkspaceMedia",
      workspaceId,
      workspace?.directory,
      onlyImages,
      searchQuery,
      maxLimit,
    ],
    queryFn: () =>
      listMedia({
        workspaceId,
        workspaceRoot: workspace?.directory ?? undefined,
        onlyImages,
        query: searchQuery,
        limit: maxLimit,
      }),
    staleTime: 4000,
  });

  const openMutation = useMutation({
    mutationFn: (vars: { path: string; target: OpenerTarget }) =>
      openTarget({
        workspaceId,
        workspaceRoot: workspace?.directory ?? undefined,
        path: vars.path,
        target: vars.target,
      }),
    onSuccess: (res) => {
      void mediaQuery.refetch();
      if (res.ok) {
        toast.show(res.message, { variant: "success" });
      } else {
        toast.error(res.message);
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const styles = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
        padding: compact ? 10 : 14,
        gap: 10,
        minWidth: onClosePopover ? 420 : undefined,
        maxHeight: onClosePopover ? 560 : undefined,
      },
      headerRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      titleGroup: {
        gap: 2,
        flex: 1,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: 15,
        fontWeight: "600" as const,
      },
      subtitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      row: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      accentBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: theme.colors.accent,
      },
      accentBtnText: {
        color: theme.colors.accentForeground,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      secondaryBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      activeChip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.accent,
      },
      inactiveChip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      btnText: {
        color: theme.colors.foreground,
        fontSize: 11.5,
      },
      mutedText: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      inputBox: {
        flex: 1,
        minWidth: 160,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
        color: theme.colors.foreground,
        fontSize: 12,
      },
      cardList: {
        flex: 1,
      },
      cardListContent: {
        gap: 6,
        paddingBottom: 8,
      },
      fileCard: {
        padding: 9,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 6,
      },
      fileHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      fileName: {
        color: theme.colors.foreground,
        fontSize: 12.5,
        fontWeight: "600" as const,
        flex: 1,
      },
      fileBadge: {
        color: theme.colors.accent,
        fontSize: 11,
      },
      filePath: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      auditBox: {
        padding: 8,
        borderRadius: 6,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 3,
      },
      auditTitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 10.5,
        fontWeight: "600" as const,
      },
    }),
    [theme, compact, onClosePopover],
  );

  async function handleCopyPath(text: string) {
    try {
      await copyText(text);
      toast.show(`${t("actions.copiedFilePath")}: ${text}`, { variant: "success" });
    } catch {
      toast.error(t("actions.copyFailed"));
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <Text style={styles.title}>{t("browser.title")}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {t("browser.workspacePrefix")}{" "}
            {workspace?.directory ?? mediaQuery.data?.workspaceRoot ?? t("browser.resolving")}
          </Text>
        </View>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("browser.openWorkspaceRoot")}
            onPress={() => openMutation.mutate({ path: ".", target: "finder-folder" })}
            style={styles.accentBtn}
          >
            <Icon name="FolderOpen" size={13} color={theme.colors.accentForeground} />
            <Text style={styles.accentBtnText}>{t("browser.openWorkspaceRoot")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("settings.quickJumpOpenModalBtn")}
            onPress={() => {
              onClosePopover?.();
              void openQuickWorkspaceSwitcherModal({
                defaultJumpMode:
                  settingsState.status === "ready"
                    ? settingsState.values.quickJumpDefaultAction
                    : "new-workspace",
                onListJumpProjects: async (q) => {
                  const r = await quickJump({
                    action: "list",
                    query: q,
                    limit: 50,
                    source: "quick-switcher",
                  });
                  return r.candidates;
                },
                onExecuteQuickJump: async (input) => {
                  const r = await quickJump({
                    action: "jump",
                    projectId: input.projectId,
                    query: input.query,
                    jumpMode: input.jumpMode,
                    source: input.source ?? "quick-switcher",
                  });
                  return {
                    ok: r.ok,
                    jumpMode: r.jumpMode,
                    targetWorkspaceId: r.targetWorkspaceId,
                    targetProjectId: r.targetProjectId,
                    targetProjectKey: r.targetProjectKey,
                    targetProjectName: r.targetProjectName,
                    message: r.message,
                  };
                },
              });
            }}
            style={styles.secondaryBtn}
          >
            <Icon name="FolderSearch" size={13} color={theme.colors.foreground} />
            <Text style={styles.btnText}>{t("settings.quickJumpOpenModalBtn")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("browser.refresh")}
            onPress={() => void mediaQuery.refetch()}
            style={styles.secondaryBtn}
          >
            <Icon name="RefreshCw" size={13} color={theme.colors.foreground} />
            <Text style={styles.btnText}>{t("browser.refresh")}</Text>
          </Pressable>
          {onClosePopover ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close popover"
              onPress={onClosePopover}
              style={styles.secondaryBtn}
            >
              <Icon name="X" size={13} color={theme.colors.foreground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.fileCard}>
        <Text style={styles.auditTitle}>{t("browser.threadMetaTitle")}</Text>
        <View style={styles.row}>
          <TextInput
            value={titleDraft || workspace?.name || labelsQuery.data?.workspaceTitle || ""}
            onChangeText={setTitleDraft}
            placeholder={t("browser.threadNamePlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.inputBox}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("actions.saveTitle")}
            onPress={() => {
              const next = (
                titleDraft ||
                workspace?.name ||
                labelsQuery.data?.workspaceTitle ||
                ""
              ).trim();
              renameMutation.mutate(next || null);
            }}
            style={styles.accentBtn}
          >
            <Text style={styles.accentBtnText}>{t("actions.saveTitle")}</Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          {(labelsQuery.data?.catalog ?? []).length === 0 ? (
            <Text style={styles.mutedText}>{t("browser.noLabelsYet")}</Text>
          ) : (
            (labelsQuery.data?.catalog ?? []).map((entry) => {
              const isAssigned = (labelsQuery.data?.assignedLabels ?? []).includes(entry.name);
              const dotHex = LABEL_COLOR_HEX[entry.color] ?? LABEL_COLOR_HEX.violet;
              return (
                <Pressable
                  key={entry.name}
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.name}`}
                  onPress={() =>
                    labelMutation.mutate({
                      action: "toggle",
                      labelName: entry.name,
                      color: entry.color,
                    })
                  }
                  style={isAssigned ? styles.activeChip : styles.inactiveChip}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      backgroundColor: dotHex,
                    }}
                  />
                  <Text style={styles.btnText}>
                    {isAssigned ? `${entry.name} ✓` : entry.name}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t("actions.deleteLabel")}: ${entry.name}`}
                    hitSlop={6}
                    onPress={(ev) => {
                      ev?.stopPropagation?.();
                      labelMutation.mutate({
                        action: "delete",
                        labelName: entry.name,
                      });
                    }}
                    style={{
                      marginLeft: 3,
                      paddingHorizontal: 2,
                      opacity: 0.7,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        color: theme.colors.foregroundMuted,
                        lineHeight: 12,
                      }}
                    >
                      ×
                    </Text>
                  </Pressable>
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.row}>
          <TextInput
            value={newLabelName}
            onChangeText={setNewLabelName}
            placeholder={t("browser.newLabelPlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.inputBox}
          />
          {WORKSPACE_LABEL_COLORS.slice(0, 6).map((c) => (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityLabel={`Color ${c}`}
              onPress={() => setNewLabelColor(c)}
              style={{
                width: 16,
                height: 16,
                borderRadius: 99,
                backgroundColor: LABEL_COLOR_HEX[c],
                borderWidth: newLabelColor === c ? 2 : 0,
                borderColor: theme.colors.foreground,
              }}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("actions.addLabel")}
            onPress={() => {
              const trimmed = newLabelName.trim();
              if (!trimmed) return;
              setNewLabelName("");
              labelMutation.mutate({
                action: "assign",
                labelName: trimmed,
                color: newLabelColor,
              });
            }}
            style={styles.secondaryBtn}
          >
            <Text style={styles.btnText}>{t("actions.addLabel")}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.fileCard}>
        <Text style={styles.auditTitle}>{t("browser.folderImportTitle")}</Text>
        <View style={styles.row}>
          <TextInput
            value={folderImportPath}
            onChangeText={setFolderImportPath}
            placeholder={t("browser.folderImportPlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.inputBox}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("actions.importFolderBtn")}
            onPress={() => {
              const trimmed = folderImportPath.trim();
              if (!trimmed) return;
              importFolderMutation.mutate(trimmed);
            }}
            style={styles.accentBtn}
          >
            <Icon name="FolderPlus" size={13} color={theme.colors.accentForeground} />
            <Text style={styles.accentBtnText}>{t("actions.importFolderBtn")}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.row}>
        <TextInput
          value={manualPath}
          onChangeText={setManualPath}
          placeholder={t("browser.pathPlaceholder")}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.inputBox}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("browser.revealBtn")}
          onPress={() => {
            const p = manualPath.trim() || ".";
            openMutation.mutate({ path: p, target: "finder-reveal" });
          }}
          style={styles.accentBtn}
        >
          <Icon name="Search" size={13} color={theme.colors.accentForeground} />
          <Text style={styles.accentBtnText}>{t("browser.revealBtn")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("browser.previewBtn")}
          onPress={() => {
            const p = manualPath.trim();
            if (p) openMutation.mutate({ path: p, target: "system-preview" });
          }}
          style={styles.secondaryBtn}
        >
          <Text style={styles.btnText}>{t("browser.previewBtn")}</Text>
        </Pressable>
      </View>

      <View style={styles.headerRow}>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("browser.imagesOnly")}
            onPress={() => setOnlyImages(true)}
            style={onlyImages ? styles.activeChip : styles.inactiveChip}
          >
            <Icon name="Image" size={12} color={theme.colors.foreground} />
            <Text style={styles.btnText}>{t("browser.imagesOnly")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("browser.allRecentFiles")}
            onPress={() => setOnlyImages(false)}
            style={!onlyImages ? styles.activeChip : styles.inactiveChip}
          >
            <Icon name="FileText" size={12} color={theme.colors.foreground} />
            <Text style={styles.btnText}>{t("browser.allRecentFiles")}</Text>
          </Pressable>
        </View>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t("browser.filterPlaceholder")}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.inputBox}
        />
      </View>

      {mediaQuery.isLoading ? (
        <Loading />
      ) : (
        <ScrollView style={styles.cardList} contentContainerStyle={styles.cardListContent}>
          {(mediaQuery.data?.items ?? []).length === 0 ? (
            <Text style={styles.mutedText}>{t("browser.emptyState")}</Text>
          ) : (
            (mediaQuery.data?.items ?? []).map((item: FileMetadata) => (
              <View key={item.absolutePath} style={styles.fileCard}>
                <View style={styles.fileHeader}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {item.fileName}
                  </Text>
                  <Text style={styles.fileBadge}>
                    {item.width && item.height ? `${item.width}×${item.height} · ` : ""}
                    {item.sizeFormatted} · {item.modifiedRelative}
                  </Text>
                </View>
                <Text style={styles.filePath} numberOfLines={1}>
                  {item.relativePath}
                </Text>
                <View style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t("actions.revealInFinder")} ${item.fileName}`}
                    onPress={() =>
                      openMutation.mutate({ path: item.absolutePath, target: "finder-reveal" })
                    }
                    style={styles.accentBtn}
                  >
                    <Icon name="FolderOpen" size={12} color={theme.colors.accentForeground} />
                    <Text style={styles.accentBtnText}>{t("actions.revealInFinder")}</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t("actions.openContainingFolder")} ${item.fileName}`}
                    onPress={() =>
                      openMutation.mutate({ path: item.absolutePath, target: "finder-folder" })
                    }
                    style={styles.secondaryBtn}
                  >
                    <Icon name="Folder" size={12} color={theme.colors.foreground} />
                    <Text style={styles.btnText}>{t("actions.openContainingFolder")}</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t("actions.openInPreview")} ${item.fileName}`}
                    onPress={() =>
                      openMutation.mutate({ path: item.absolutePath, target: "system-preview" })
                    }
                    style={styles.secondaryBtn}
                  >
                    <Icon name="ExternalLink" size={12} color={theme.colors.foreground} />
                    <Text style={styles.btnText}>{t("actions.openInPreview")}</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t("actions.copyFilePath")} ${item.fileName}`}
                    onPress={() => void handleCopyPath(item.absolutePath)}
                    style={styles.secondaryBtn}
                  >
                    <Icon name="Copy" size={12} color={theme.colors.foreground} />
                    <Text style={styles.btnText}>{t("actions.copyFilePath")}</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {(mediaQuery.data?.recentActions ?? []).length > 0 ? (
        <View style={styles.auditBox}>
          <Text style={styles.auditTitle}>{t("browser.recentAuditTitle")}</Text>
          {(mediaQuery.data?.recentActions ?? []).slice(0, 2).map((act) => (
            <Text key={act.id} style={styles.mutedText} numberOfLines={1}>
              [{act.target}] {act.message} ({act.durationMs}ms)
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function WorkspaceFinderPopover({
  workspaceId,
  theme,
  layout,
  close,
}: PluginButtonContentProps) {
  return (
    <FinderBrowserView
      workspaceId={workspaceId}
      theme={theme}
      compact={layout.compact}
      onClosePopover={close}
    />
  );
}

export function WorkspaceFinderPanel({
  workspaceId,
  theme,
  layout,
}: PluginWorkspacePanelProps) {
  return (
    <FinderBrowserView workspaceId={workspaceId} theme={theme} compact={layout.compact} />
  );
}
