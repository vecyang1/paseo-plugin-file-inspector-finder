import {
  type PluginButtonContentProps,
  type PluginWorkspacePanelProps,
  useRpc,
  useSettings,
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
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.accent,
      },
      inactiveChip: {
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
      toast.show(`已复制路径: ${text}`, { variant: "success" });
    } catch {
      toast.error("复制失败");
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <Text style={styles.title}>📂 Finder & 媒体文件夹快开器</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            工作区: {workspace?.directory ?? mediaQuery.data?.workspaceRoot ?? "解析中..."}
          </Text>
        </View>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open workspace root in Finder"
            onPress={() => openMutation.mutate({ path: ".", target: "finder-folder" })}
            style={styles.accentBtn}
          >
            <Icon name="FolderOpen" size={13} color={theme.colors.accentForeground} />
            <Text style={styles.accentBtnText}>打开工作区根目录</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh workspace files"
            onPress={() => void mediaQuery.refetch()}
            style={styles.secondaryBtn}
          >
            <Icon name="RefreshCw" size={13} color={theme.colors.foreground} />
            <Text style={styles.btnText}>刷新</Text>
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
          placeholder="粘贴任意相对/绝对路径或文件名 (如 00_mobile_ui...png) 一键定位"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.inputBox}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reveal typed path in Finder"
          onPress={() => {
            const p = manualPath.trim() || ".";
            openMutation.mutate({ path: p, target: "finder-reveal" });
          }}
          style={styles.accentBtn}
        >
          <Icon name="Search" size={13} color={theme.colors.accentForeground} />
          <Text style={styles.accentBtnText}>定位文件</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Preview typed path"
          onPress={() => {
            const p = manualPath.trim();
            if (p) openMutation.mutate({ path: p, target: "system-preview" });
          }}
          style={styles.secondaryBtn}
        >
          <Text style={styles.btnText}>预览</Text>
        </Pressable>
      </View>

      <View style={styles.headerRow}>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show images only"
            onPress={() => setOnlyImages(true)}
            style={onlyImages ? styles.activeChip : styles.inactiveChip}
          >
            <Text style={styles.btnText}>🖼️ 仅看图片</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show all recent files"
            onPress={() => setOnlyImages(false)}
            style={!onlyImages ? styles.activeChip : styles.inactiveChip}
          >
            <Text style={styles.btnText}>📄 全部最近文件</Text>
          </Pressable>
        </View>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="过滤文件名或子目录..."
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.inputBox}
        />
      </View>

      {mediaQuery.isLoading ? (
        <Loading />
      ) : (
        <ScrollView style={styles.cardList} contentContainerStyle={styles.cardListContent}>
          {(mediaQuery.data?.items ?? []).length === 0 ? (
            <Text style={styles.mutedText}>
              当前工作区暂无匹配文件。可直接点击上方「打开工作区根目录」或在输入框粘贴路径。
            </Text>
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
                  📂 {item.relativePath}
                </Text>
                <View style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Reveal ${item.fileName} in Finder`}
                    onPress={() =>
                      openMutation.mutate({ path: item.absolutePath, target: "finder-reveal" })
                    }
                    style={styles.accentBtn}
                  >
                    <Icon name="FolderOpen" size={12} color={theme.colors.accentForeground} />
                    <Text style={styles.accentBtnText}>在 Finder 中显示</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open parent folder of ${item.fileName}`}
                    onPress={() =>
                      openMutation.mutate({ path: item.absolutePath, target: "finder-folder" })
                    }
                    style={styles.secondaryBtn}
                  >
                    <Icon name="Folder" size={12} color={theme.colors.foreground} />
                    <Text style={styles.btnText}>打开所在目录</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Preview ${item.fileName}`}
                    onPress={() =>
                      openMutation.mutate({ path: item.absolutePath, target: "system-preview" })
                    }
                    style={styles.secondaryBtn}
                  >
                    <Icon name="ExternalLink" size={12} color={theme.colors.foreground} />
                    <Text style={styles.btnText}>系统预览</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Copy path of ${item.fileName}`}
                    onPress={() => void handleCopyPath(item.absolutePath)}
                    style={styles.secondaryBtn}
                  >
                    <Icon name="Copy" size={12} color={theme.colors.foreground} />
                    <Text style={styles.btnText}>复制路径</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {(mediaQuery.data?.recentActions ?? []).length > 0 ? (
        <View style={styles.auditBox}>
          <Text style={styles.auditTitle}>最近操作对账回执 (UI Observability):</Text>
          {(mediaQuery.data?.recentActions ?? []).slice(0, 2).map((act) => (
            <Text key={act.id} style={styles.mutedText} numberOfLines={1}>
              {act.ok ? "✅" : "❌"} [{act.target}] {act.message} ({act.durationMs}ms)
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
