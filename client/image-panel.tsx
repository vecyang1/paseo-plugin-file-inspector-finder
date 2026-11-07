import {
  type PluginFilePanelProps,
  useFileUrl,
  useRpc,
  useSettings,
  useTranslation,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { Icon, Loading, ScrollView, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import {
  type OpenerTarget,
  inspectFileRpc,
  openFileTargetRpc,
  pluginSettings,
} from "../shared/contracts";
import { pluginTranslations } from "./i18n";

type CanvasBg = "dark" | "checker" | "light";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

export function ImageInspectorFilePanel({
  file,
  params,
  workspaceId,
  theme,
  layout,
}: PluginFilePanelProps) {
  const { t } = useTranslation(pluginTranslations);
  const urlState = useFileUrl(file);
  const toast = useToast();
  const inspectFile = useRpc(inspectFileRpc);
  const openTarget = useRpc(openFileTargetRpc);
  const settingsState = useSettings(pluginSettings);
  const workspaceDir = useWorkspace(workspaceId, (w) => w.directory);

  const defaultBg: CanvasBg =
    settingsState.status === "ready" ? settingsState.values.defaultCanvasBackground : "checker";
  const preferredEditor =
    settingsState.status === "ready" ? settingsState.values.preferredCodeEditor : "antigravity";

  const [zoom, setZoom] = useState<number>(1);
  const [canvasBg, setCanvasBg] = useState<CanvasBg>(defaultBg);
  const [lastReceipt, setLastReceipt] = useState<string | null>(null);

  const metaQuery = useQuery({
    queryKey: ["finder.inspectFile", workspaceId, workspaceDir, params.path, file.size],
    queryFn: () =>
      inspectFile({
        workspaceId,
        workspaceRoot: workspaceDir ?? undefined,
        path: params.path,
      }),
    staleTime: 10000,
  });

  const openMutation = useMutation({
    mutationFn: (target: OpenerTarget) =>
      openTarget({
        workspaceId,
        workspaceRoot: workspaceDir ?? undefined,
        path: params.path,
        target,
      }),
    onSuccess: (res) => {
      if (res.ok) {
        setLastReceipt(`${res.message} (${res.durationMs}ms)`);
        toast.show(res.message, { variant: "success" });
      } else {
        setLastReceipt(res.message);
        toast.error(res.message);
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setLastReceipt(msg);
      toast.error(msg);
    },
  });

  const meta = metaQuery.data;

  const canvasBackgroundColor = useMemo(() => {
    if (canvasBg === "light") return "#f4f4f5";
    if (canvasBg === "checker") return "#1e222a";
    return "#090a0f";
  }, [canvasBg]);

  const styles = useMemo(
    () => ({
      root: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
      },
      toolbar: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: layout.compact ? 10 : 14,
        paddingVertical: 8,
        gap: 8,
        backgroundColor: theme.colors.surface1,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      buttonGroup: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      primaryBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: theme.colors.accent,
      },
      primaryBtnText: {
        color: theme.colors.accentForeground,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      secondaryBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 9,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      activeChipBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.accent,
      },
      chipBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: theme.colors.surface1,
      },
      btnText: {
        color: theme.colors.foreground,
        fontSize: 12,
      },
      mutedBtnText: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      metaBar: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: layout.compact ? 10 : 14,
        paddingVertical: 6,
        gap: 8,
        backgroundColor: theme.colors.surface0,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      metaRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 10,
      },
      metaTag: {
        color: theme.colors.foreground,
        fontSize: 11,
        fontWeight: "600" as const,
      },
      metaDetail: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      receiptText: {
        color: theme.colors.statusSuccess,
        fontSize: 11,
      },
      canvasScroll: {
        flex: 1,
        backgroundColor: canvasBackgroundColor,
      },
      canvasContent: {
        flexGrow: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        padding: layout.compact ? 12 : 24,
      },
      errorBox: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        padding: 24,
        gap: 12,
      },
      errorText: {
        color: theme.colors.statusDanger,
        fontSize: 13,
      },
    }),
    [theme, layout.compact, canvasBackgroundColor],
  );

  if (urlState.status === "loading") {
    return <Loading />;
  }

  if (urlState.status === "error") {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>{urlState.error.message}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("imagePanel.revealMissingDir")}
          onPress={() => openMutation.mutate("finder-reveal")}
          style={styles.primaryBtn}
        >
          <Icon name="FolderOpen" size={14} color={theme.colors.accentForeground} />
          <Text style={styles.primaryBtnText}>{t("imagePanel.revealMissingDir")}</Text>
        </Pressable>
      </View>
    );
  }

  const baseW = meta?.width && meta.width > 0 ? Math.min(meta.width, 1100) : 860;
  const baseH =
    meta?.width && meta?.height && meta.width > 0
      ? Math.round((baseW * meta.height) / meta.width)
      : 540;
  const displayW = Math.round(baseW * zoom);
  const displayH = Math.round(baseH * zoom);

  async function handleCopy(text: string, isRelative: boolean) {
    try {
      await copyText(text);
      const msg = isRelative ? t("actions.copiedRelativePath") : t("actions.copiedFilePath");
      setLastReceipt(`${msg}: ${text}`);
      toast.show(msg, { variant: "success" });
    } catch {
      toast.error(t("actions.copyFailed"));
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <View style={styles.buttonGroup}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("actions.revealInFinder")}
            onPress={() => openMutation.mutate("finder-reveal")}
            disabled={openMutation.isPending}
            style={styles.primaryBtn}
          >
            <Icon name="FolderOpen" size={14} color={theme.colors.accentForeground} />
            <Text style={styles.primaryBtnText}>{t("actions.revealInFinder")}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("actions.openContainingFolder")}
            onPress={() => openMutation.mutate("finder-folder")}
            disabled={openMutation.isPending}
            style={styles.secondaryBtn}
          >
            <Icon name="Folder" size={14} color={theme.colors.foreground} />
            <Text style={styles.btnText}>{t("actions.openContainingFolder")}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("actions.openInPreview")}
            onPress={() => openMutation.mutate("system-preview")}
            disabled={openMutation.isPending}
            style={styles.secondaryBtn}
          >
            <Icon name="ExternalLink" size={14} color={theme.colors.foreground} />
            <Text style={styles.btnText}>{t("actions.openInPreview")}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              preferredEditor === "antigravity"
                ? t("actions.openInAntigravity")
                : preferredEditor === "cursor"
                  ? t("actions.openInCursor")
                  : t("actions.openInVscode")
            }
            onPress={() => openMutation.mutate(preferredEditor)}
            disabled={openMutation.isPending}
            style={styles.secondaryBtn}
          >
            <Icon name="Code" size={14} color={theme.colors.foreground} />
            <Text style={styles.btnText}>
              {preferredEditor === "antigravity"
                ? "Antigravity"
                : preferredEditor === "cursor"
                  ? "Cursor"
                  : "VS Code"}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("actions.copyFilePath")}
            onPress={() => void handleCopy(meta?.absolutePath ?? params.path, false)}
            style={styles.secondaryBtn}
          >
            <Icon name="Copy" size={13} color={theme.colors.foreground} />
            <Text style={styles.btnText}>{t("actions.copyFilePath")}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("actions.copyRelativePath")}
            onPress={() => void handleCopy(meta?.relativePath ?? params.path, true)}
            style={styles.secondaryBtn}
          >
            <Icon name="FileText" size={13} color={theme.colors.foreground} />
            <Text style={styles.btnText}>{t("actions.copyRelativePath")}</Text>
          </Pressable>
        </View>

        <View style={styles.buttonGroup}>
          {ZOOM_STEPS.map((step) => (
            <Pressable
              key={step}
              accessibilityRole="button"
              accessibilityLabel={`Zoom ${Math.round(step * 100)}%`}
              onPress={() => setZoom(step)}
              style={zoom === step ? styles.activeChipBtn : styles.chipBtn}
            >
              <Text style={zoom === step ? styles.btnText : styles.mutedBtnText}>
                {Math.round(step * 100)}%
              </Text>
            </Pressable>
          ))}

          {(["dark", "checker", "light"] as const).map((bg) => (
            <Pressable
              key={bg}
              accessibilityRole="button"
              accessibilityLabel={`Canvas background ${bg}`}
              onPress={() => setCanvasBg(bg)}
              style={canvasBg === bg ? styles.activeChipBtn : styles.chipBtn}
            >
              <Text style={canvasBg === bg ? styles.btnText : styles.mutedBtnText}>
                {bg === "dark"
                  ? t("imagePanel.bgDark")
                  : bg === "checker"
                    ? t("imagePanel.bgChecker")
                    : t("imagePanel.bgLight")}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.metaBar}>
        <View style={styles.metaRow}>
          <Text style={styles.metaTag}>
            {meta?.width && meta?.height
              ? `${meta.width} × ${meta.height} px`
              : meta?.extension?.toUpperCase() || t("imagePanel.imageFallback")}
          </Text>
          <Text style={styles.metaDetail}>
            {meta?.sizeFormatted ?? `${Math.round(file.size / 1024)} KB`}
          </Text>
          {meta?.modifiedRelative ? (
            <Text style={styles.metaDetail}>{meta.modifiedRelative}</Text>
          ) : null}
          <Text style={styles.metaDetail} numberOfLines={1}>
            {meta?.absolutePath ?? params.path}
          </Text>
        </View>
        {lastReceipt ? <Text style={styles.receiptText}>{lastReceipt}</Text> : null}
      </View>

      <ScrollView
        style={styles.canvasScroll}
        contentContainerStyle={styles.canvasContent}
        horizontal={zoom > 1}
      >
        <Image
          source={{ uri: urlState.url }}
          resizeMode="contain"
          style={{ width: displayW, height: displayH }}
          accessibilityLabel={params.path}
        />
      </ScrollView>
    </View>
  );
}
