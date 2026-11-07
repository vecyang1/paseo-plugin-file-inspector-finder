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
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type FileMetadata,
  type OpenerTarget,
  listWorkspaceMediaRpc,
  openFileTargetRpc,
  pluginSettings,
} from "../shared/contracts";
import { pluginTranslations } from "./i18n";

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
  const settingsState = useSettings(pluginSettings);

  const workspace = useWorkspace(workspaceId, (w) => ({
    name: w.name,
    directory: w.directory,
  }));

  const maxLimit =
    settingsState.status === "ready" ? settingsState.values.maxRecentFiles : 24;

  const [onlyImages, setOnlyImages] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [manualPath, setManualPath] = useState("");

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
