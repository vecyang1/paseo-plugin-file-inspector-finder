import {
  type PluginSurfaceProps,
  useRpc,
  useSettings,
  useTranslation,
} from "@getpaseo/plugin/client";
import {
  Icon,
  Loading,
  ScrollView,
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type OpenerTarget,
  type QuickJumpAction,
  VOICE_STT_PRESETS,
  diagnosePathRpc,
  importFolderWorkspaceRpc,
  inspectScheduleRunsRpc,
  manageVoiceSttRpc,
  manageWorkspaceLabelsRpc,
  openFileTargetRpc,
  openScheduleRunSessionRpc,
  pluginSettings,
  quickJumpWorkspaceRpc,
  renameWorkspaceOrAgentRpc,
} from "../shared/contracts";
import { isChineseLocale, pluginTranslations } from "./i18n";
import {
  navigateToPaseoWorkspace,
  triggerScheduleRunsDrawer,
} from "./schedule-runs-web";
import { syncVoiceCustomModelPreferences } from "./voice-stt-web";
import {
  focusWorkspaceInApp,
  locateProjectInSidebar,
  openQuickWorkspaceSwitcherModal,
  resolveCurrentActiveWorkspaceId,
  syncImagePanelAssociations,
  syncInlineRenamePreferences,
  syncQuickJumpPreferences,
  syncSidebarDropPreferences,
} from "./web";

export function FinderPluginSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const { t } = useTranslation(pluginTranslations);
  const settings = useSettings(pluginSettings);
  const toast = useToast();
  const diagnosePath = useRpc(diagnosePathRpc);
  const openTarget = useRpc(openFileTargetRpc);
  const importFolder = useRpc(importFolderWorkspaceRpc);
  const manageLabels = useRpc(manageWorkspaceLabelsRpc);
  const renameThread = useRpc(renameWorkspaceOrAgentRpc);
  const quickJump = useRpc(quickJumpWorkspaceRpc);
  const inspectScheduleRuns = useRpc(inspectScheduleRunsRpc);
  const openScheduleRunSession = useRpc(openScheduleRunSessionRpc);
  const manageVoiceStt = useRpc(manageVoiceSttRpc);
  const isZh = isChineseLocale(
    typeof navigator !== "undefined" ? navigator.language : undefined,
  );

  const [testInput, setTestInput] = useState(
    "reports/mobile_ui_series/00_mobile_ui_5screen_panoramic_showcase.png",
  );
  const [folderTestInput, setFolderTestInput] = useState("~/Documents");
  const [renameDiagInput, setRenameDiagInput] = useState("");
  const [quickJumpQueryInput, setQuickJumpQueryInput] = useState("");
  const [scheduleRunsQueryInput, setScheduleRunsQueryInput] = useState("");
  const [scheduleRunsDiagData, setScheduleRunsDiagData] = useState<
    Awaited<ReturnType<typeof inspectScheduleRuns>> | null
  >(null);
  const [voiceModelInput, setVoiceModelInput] = useState("FunAudioLLM/SenseVoiceSmall");
  const [voiceBaseUrlInput, setVoiceBaseUrlInput] = useState("http://127.0.0.1:8787/v1");
  const [voiceSnapData, setVoiceSnapData] = useState<
    Awaited<ReturnType<typeof manageVoiceStt>> | null
  >(null);

  useEffect(() => {
    if (settings.status === "ready") {
      syncSidebarDropPreferences(
        settings.values.enableSidebarFolderDrop,
        settings.values.sidebarDropDefaultBehavior,
      );
      syncInlineRenamePreferences({
        enableInlineDoubleClickRename: settings.values.enableInlineDoubleClickRename,
        enableQuickRenameAndLabelShortcuts:
          settings.values.enableQuickRenameAndLabelShortcuts,
        enableDesktopContextMenuHelper: settings.values.enableDesktopContextMenuHelper,
      });
      syncQuickJumpPreferences({
        enableWorkspaceQuickJump: settings.values.enableWorkspaceQuickJump,
        enableCommandCenterProjectItems: settings.values.enableCommandCenterProjectItems,
        quickJumpDefaultAction: settings.values.quickJumpDefaultAction,
      });
      syncVoiceCustomModelPreferences(settings.values.enableVoiceCustomModelHelper);
    }
  }, [settings]);

  useEffect(() => {
    void manageVoiceStt({ action: "inspect", source: "settings-ui" })
      .then((res) => {
        setVoiceSnapData(res);
        if (res.dictationStt.model) setVoiceModelInput(res.dictationStt.model);
        if (res.dictationStt.baseUrl) setVoiceBaseUrlInput(res.dictationStt.baseUrl);
      })
      .catch(() => {});
  }, [manageVoiceStt]);

  const resolveActiveWsId = (): string | undefined => {
    const g = globalThis as { document?: unknown; window?: unknown };
    if (g.document && g.window) {
      return resolveCurrentActiveWorkspaceId(
        g.document as Parameters<typeof resolveCurrentActiveWorkspaceId>[0],
        g.window as Parameters<typeof resolveCurrentActiveWorkspaceId>[1],
      );
    }
    return undefined;
  };

  const renameInspectMutation = useMutation({
    mutationFn: () =>
      manageLabels({
        action: "inspect",
        workspaceId: resolveActiveWsId(),
      }),
    onSuccess: (res) => {
      if (res.ok) {
        if (!renameDiagInput.trim() && res.workspaceTitle) {
          setRenameDiagInput(res.workspaceTitle);
        }
      } else {
        toast.error(res.message);
      }
    },
  });

  const renameApplyMutation = useMutation({
    mutationFn: (vars: { title: string | null }) =>
      renameThread({
        workspaceId: renameInspectMutation.data?.workspaceId || resolveActiveWsId(),
        title: vars.title,
        source: "ui",
      }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.show(res.message, { variant: "success" });
        if (res.title) {
          setRenameDiagInput(res.title);
        }
        renameInspectMutation.mutate();
      } else {
        toast.error(res.message);
      }
    },
  });

  const folderDiagMutation = useMutation({
    mutationFn: (vars: { path: string; dryRun: boolean }) =>
      importFolder({
        paths: [vars.path],
        dryRun: vars.dryRun,
        source: "ui",
      }),
    onSuccess: (res, vars) => {
      if (res.ok) {
        toast.show(res.message, { variant: "success" });
        if (!vars.dryRun && res.primaryWorkspaceId) {
          focusWorkspaceInApp(res.primaryWorkspaceId, res.primaryProjectId);
        }
      } else {
        toast.error(res.message);
      }
    },
  });

  const quickJumpDiagMutation = useMutation({
    mutationFn: (vars: {
      query: string;
      action: "list" | "jump";
      jumpMode?: QuickJumpAction;
      dryRun?: boolean;
    }) =>
      quickJump({
        action: vars.action,
        query: vars.query,
        jumpMode: vars.jumpMode,
        dryRun: vars.dryRun,
        limit: 12,
        source: "ui",
      }),
    onSuccess: (res, vars) => {
      if (res.ok) {
        toast.show(res.message, { variant: "success" });
        if (vars.action === "jump" && !vars.dryRun) {
          if (res.jumpMode === "locate-sidebar") {
            locateProjectInSidebar({
              projectId: res.targetProjectId,
              projectKey: res.targetProjectKey,
              projectName: res.targetProjectName,
              expandIfCollapsed: true,
              highlightFlash: true,
            });
          } else if (res.targetWorkspaceId) {
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
        }
      } else {
        toast.error(res.message);
      }
    },
  });

  const diagMutation = useMutation({
    mutationFn: (rawInput: string) => diagnosePath({ rawInput }),
  });

  const openMutation = useMutation({
    mutationFn: (vars: { path: string; target: OpenerTarget }) => openTarget(vars),
    onSuccess: (res) => {
      if (res.ok) {
        toast.show(res.message, { variant: "success" });
      } else {
        toast.error(res.message);
      }
      if (testInput.trim()) {
        diagMutation.mutate(testInput.trim());
      }
    },
  });

  const styles = useMemo(
    () => ({
      root: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
      },
      content: {
        padding: layout.compact ? 14 : 24,
        gap: 18,
      },
      diagBox: {
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 8,
      },
      row: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      input: {
        flex: 1,
        minWidth: 220,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 6,
        backgroundColor: theme.colors.surface0,
        borderWidth: 1,
        borderColor: theme.colors.border,
        color: theme.colors.foreground,
        fontSize: 12,
      },
      btn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 6,
        backgroundColor: theme.colors.accent,
      },
      btnText: {
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
      secondaryBtnText: {
        color: theme.colors.foreground,
        fontSize: 11.5,
      },
      label: {
        color: theme.colors.foreground,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      detail: {
        color: theme.colors.foregroundMuted,
        fontSize: 11.5,
      },
    }),
    [theme, layout.compact],
  );

  if (settings.status === "loading") {
    return <Loading />;
  }

  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <View style={styles.content}>
        <Text style={styles.label}>
          {t("settings.loadError")} {settings.error}
        </Text>
      </View>
    );
  }

  const { values, revision, save } = settings;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <SettingsSection title={t("settings.sectionBehavior")}>
        <SettingsCard>
          <SettingsSelect
            label={t("settings.defaultActionLabel")}
            hint={t("settings.defaultActionHint")}
            value={values.defaultPrimaryAction}
            options={[
              { label: t("settings.optFinderReveal"), value: "finder-reveal" },
              { label: t("settings.optFinderFolder"), value: "finder-folder" },
              { label: t("settings.optSystemPreview"), value: "system-preview" },
              { label: t("settings.optAntigravity"), value: "antigravity" },
              { label: t("settings.optCursor"), value: "cursor" },
              { label: t("settings.optVscode"), value: "vscode" },
              { label: t("settings.optTerminal"), value: "terminal" },
            ]}
            onValueChange={(next) => {
              void save({ ...values, defaultPrimaryAction: next }, revision);
            }}
          />

          <SettingsSelect
            label={t("settings.preferredEditorLabel")}
            hint={t("settings.preferredEditorHint")}
            value={values.preferredCodeEditor}
            options={[
              { label: "Antigravity IDE", value: "antigravity" },
              { label: "Cursor IDE", value: "cursor" },
              { label: "Visual Studio Code", value: "vscode" },
            ]}
            onValueChange={(next) => {
              void save({ ...values, preferredCodeEditor: next }, revision);
            }}
          />

          <SettingsSelect
            label={t("settings.canvasBgLabel")}
            hint={t("settings.canvasBgHint")}
            value={values.defaultCanvasBackground}
            options={[
              { label: t("settings.optBgChecker"), value: "checker" },
              { label: t("settings.optBgDark"), value: "dark" },
              { label: t("settings.optBgLight"), value: "light" },
            ]}
            onValueChange={(next) => {
              void save({ ...values, defaultCanvasBackground: next }, revision);
            }}
          />

          <SettingsSwitch
            label={t("settings.autoAssocLabel")}
            hint={t("settings.autoAssocHint")}
            value={values.autoAssociateImagePanels}
            onValueChange={(next) => {
              void save({ ...values, autoAssociateImagePanels: next }, revision);
              syncImagePanelAssociations("file-inspector-finder", "image-inspector", next);
            }}
          />

          <SettingsSwitch
            label={t("settings.desktopHelperLabel")}
            hint={t("settings.desktopHelperHint")}
            value={values.enableDesktopContextMenuHelper}
            onValueChange={(next) => {
              syncInlineRenamePreferences({
                enableInlineDoubleClickRename: values.enableInlineDoubleClickRename,
                enableQuickRenameAndLabelShortcuts:
                  values.enableQuickRenameAndLabelShortcuts,
                enableDesktopContextMenuHelper: next,
              });
              void save({ ...values, enableDesktopContextMenuHelper: next }, revision);
            }}
          />

          <SettingsSwitch
            label={t("settings.inlineDoubleClickRenameLabel")}
            hint={t("settings.inlineDoubleClickRenameHint")}
            value={values.enableInlineDoubleClickRename}
            onValueChange={(next) => {
              syncInlineRenamePreferences({
                enableInlineDoubleClickRename: next,
                enableQuickRenameAndLabelShortcuts:
                  values.enableQuickRenameAndLabelShortcuts,
                enableDesktopContextMenuHelper: values.enableDesktopContextMenuHelper,
              });
              void save({ ...values, enableInlineDoubleClickRename: next }, revision);
            }}
          />

          <SettingsSwitch
            label={t("settings.quickRenameLabelShortcutsLabel")}
            hint={t("settings.quickRenameLabelShortcutsHint")}
            value={values.enableQuickRenameAndLabelShortcuts}
            onValueChange={(next) => {
              syncInlineRenamePreferences({
                enableInlineDoubleClickRename: values.enableInlineDoubleClickRename,
                enableQuickRenameAndLabelShortcuts: next,
                enableDesktopContextMenuHelper: values.enableDesktopContextMenuHelper,
              });
              void save({ ...values, enableQuickRenameAndLabelShortcuts: next }, revision);
            }}
          />

          <SettingsSwitch
            label={t("settings.sidebarDropLabel")}
            hint={t("settings.sidebarDropHint")}
            value={values.enableSidebarFolderDrop}
            onValueChange={(next) => {
              syncSidebarDropPreferences(next, values.sidebarDropDefaultBehavior);
              void save({ ...values, enableSidebarFolderDrop: next }, revision);
            }}
          />

          <SettingsSelect
            label={t("settings.sidebarDropModeLabel")}
            hint={t("settings.sidebarDropModeHint")}
            value={values.sidebarDropDefaultBehavior}
            options={[
              { label: t("settings.optDropOpenOrCreate"), value: "open-or-create" },
              { label: t("settings.optDropAlwaysCreate"), value: "always-create" },
            ]}
            onValueChange={(next) => {
              syncSidebarDropPreferences(values.enableSidebarFolderDrop, next);
              void save({ ...values, sidebarDropDefaultBehavior: next }, revision);
            }}
          />

          <SettingsSwitch
            label={t("settings.quickJumpEnabledLabel")}
            hint={t("settings.quickJumpEnabledHint")}
            value={values.enableWorkspaceQuickJump}
            onValueChange={(next) => {
              syncQuickJumpPreferences({
                enableWorkspaceQuickJump: next,
                enableCommandCenterProjectItems: values.enableCommandCenterProjectItems,
                quickJumpDefaultAction: values.quickJumpDefaultAction,
              });
              void save({ ...values, enableWorkspaceQuickJump: next }, revision);
            }}
          />

          <SettingsSwitch
            label={t("settings.commandCenterProjectsLabel")}
            hint={t("settings.commandCenterProjectsHint")}
            value={values.enableCommandCenterProjectItems}
            onValueChange={(next) => {
              syncQuickJumpPreferences({
                enableWorkspaceQuickJump: values.enableWorkspaceQuickJump,
                enableCommandCenterProjectItems: next,
                quickJumpDefaultAction: values.quickJumpDefaultAction,
              });
              void save({ ...values, enableCommandCenterProjectItems: next }, revision);
            }}
          />

          <SettingsSelect
            label={t("settings.quickJumpModeLabel")}
            hint={t("settings.quickJumpModeHint")}
            value={values.quickJumpDefaultAction}
            options={[
              { label: t("settings.optJumpOpenLatest"), value: "open-latest" },
              { label: t("settings.optJumpLocateSidebar"), value: "locate-sidebar" },
              { label: t("settings.optJumpCreateNew"), value: "create-new" },
            ]}
            onValueChange={(next) => {
              syncQuickJumpPreferences({
                enableWorkspaceQuickJump: values.enableWorkspaceQuickJump,
                enableCommandCenterProjectItems: values.enableCommandCenterProjectItems,
                quickJumpDefaultAction: next,
              });
              void save({ ...values, quickJumpDefaultAction: next }, revision);
            }}
          />

          <SettingsSwitch
            label={t("settings.voiceHelperEnabledLabel")}
            hint={t("settings.voiceHelperEnabledHint")}
            value={values.enableVoiceCustomModelHelper}
            onValueChange={(next) => {
              syncVoiceCustomModelPreferences(next);
              void save({ ...values, enableVoiceCustomModelHelper: next }, revision);
            }}
          />

          <SettingsSwitch
            label={t("settings.showComposerPillLabel")}
            hint={t("settings.showComposerPillHint")}
            value={values.showComposerPill}
            onValueChange={(next) => {
              void save({ ...values, showComposerPill: next }, revision);
            }}
          />

          <SettingsAction
            label={t("settings.resyncLabel")}
            hint={t("settings.resyncHint")}
            actionLabel={t("settings.resyncAction")}
            onPress={() => {
              syncImagePanelAssociations("file-inspector-finder", "image-inspector", true);
              toast.show(t("settings.resyncSuccess"), {
                variant: "success",
              });
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("settings.sectionQuickJumpDiag")}>
        <View style={styles.diagBox}>
          <Text style={styles.label}>{t("settings.quickJumpDiagPrompt")}</Text>
          <View style={styles.row}>
            <TextInput
              value={quickJumpQueryInput}
              onChangeText={setQuickJumpQueryInput}
              placeholder={t("settings.quickJumpDiagPlaceholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.quickJumpPreviewBtn")}
              onPress={() => {
                quickJumpDiagMutation.mutate({
                  query: quickJumpQueryInput.trim(),
                  action: "jump",
                  dryRun: true,
                });
              }}
              style={styles.secondaryBtn}
            >
              <Icon name="Activity" size={14} color={theme.colors.foreground} />
              <Text style={styles.secondaryBtnText}>
                {t("settings.quickJumpPreviewBtn")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.quickJumpTestBtn")}
              onPress={() => {
                quickJumpDiagMutation.mutate({
                  query: quickJumpQueryInput.trim(),
                  action: "jump",
                  jumpMode: values.quickJumpDefaultAction,
                  dryRun: false,
                });
              }}
              style={styles.btn}
            >
              <Icon name="FolderOpen" size={14} color={theme.colors.accentForeground} />
              <Text style={styles.btnText}>{t("settings.quickJumpTestBtn")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.quickJumpLocateBtn")}
              onPress={() => {
                quickJumpDiagMutation.mutate({
                  query: quickJumpQueryInput.trim(),
                  action: "jump",
                  jumpMode: "locate-sidebar",
                  dryRun: false,
                });
              }}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>
                {t("settings.quickJumpLocateBtn")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.quickJumpOpenModalBtn")}
              onPress={() => {
                void openQuickWorkspaceSwitcherModal({
                  initialQuery: quickJumpQueryInput.trim(),
                  defaultJumpMode: values.quickJumpDefaultAction,
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
              <Text style={styles.secondaryBtnText}>
                {t("settings.quickJumpOpenModalBtn")}
              </Text>
            </Pressable>
          </View>

          {quickJumpDiagMutation.data ? (
            <View style={{ gap: 5, marginTop: 6 }}>
              <Text style={styles.label}>
                {t("settings.quickJumpSummaryPrefix")}{" "}
                {quickJumpDiagMutation.data.totalProjects} ·{" "}
                {t("settings.quickJumpActiveThreadsPrefix")}{" "}
                {quickJumpDiagMutation.data.totalActiveWorkspaces} ·{" "}
                {t("settings.quickJumpEmptyProjectsPrefix")}{" "}
                {quickJumpDiagMutation.data.emptyProjects} ·{" "}
                {quickJumpDiagMutation.data.durationMs}ms
              </Text>
              <Text style={styles.detail}>
                • {quickJumpDiagMutation.data.targetProjectName || "-"} →{" "}
                {quickJumpDiagMutation.data.selectedCandidate?.primaryWorkspaceTitle || "-"} (
                {quickJumpDiagMutation.data.targetWorkspaceId || "sidebar-only"})
              </Text>
              {quickJumpDiagMutation.data.candidates.slice(0, 4).map((cand) => (
                <Text key={cand.projectId} style={styles.detail}>
                  • [{cand.score} pts] {cand.projectName} ({cand.activeWorkspaceCount} threads) —{" "}
                  {cand.shortPath}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </SettingsSection>

      <SettingsSection title={t("settings.sectionInlineRenameDiag")}>
        <View style={styles.diagBox}>
          <Text style={styles.label}>{t("settings.inlineRenameDiagPrompt")}</Text>
          <View style={styles.row}>
            <TextInput
              value={renameDiagInput}
              onChangeText={setRenameDiagInput}
              placeholder={t("settings.inlineRenameDiagPlaceholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.inlineRenameInspectBtn")}
              onPress={() => {
                renameInspectMutation.mutate();
              }}
              style={styles.secondaryBtn}
            >
              <Icon name="Activity" size={14} color={theme.colors.foreground} />
              <Text style={styles.secondaryBtnText}>
                {t("settings.inlineRenameInspectBtn")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.inlineRenameApplyBtn")}
              onPress={() => {
                const trimmed = renameDiagInput.trim();
                if (!trimmed) return;
                renameApplyMutation.mutate({ title: trimmed });
              }}
              style={styles.btn}
            >
              <Icon name="Edit3" size={14} color={theme.colors.accentForeground} />
              <Text style={styles.btnText}>{t("settings.inlineRenameApplyBtn")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.inlineRenameResetBtn")}
              onPress={() => {
                renameApplyMutation.mutate({ title: null });
              }}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>
                {t("settings.inlineRenameResetBtn")}
              </Text>
            </Pressable>
          </View>

          <View style={{ gap: 5, marginTop: 4 }}>
            <Text style={styles.detail}>
              •{" "}
              {values.enableInlineDoubleClickRename
                ? t("settings.inlineRenameSurfaces")
                : t("settings.inlineRenameDisabledHint")}
            </Text>
            {renameInspectMutation.data ? (
              <>
                <Text style={styles.detail}>
                  • {t("settings.inlineRenameActiveWs")}{" "}
                  {renameInspectMutation.data.workspaceId || "-"} ·{" "}
                  {t("settings.inlineRenameCurrentTitle")}{" "}
                  {renameInspectMutation.data.workspaceTitle || "-"}
                </Text>
                {(renameApplyMutation.data?.recentActions ??
                  renameInspectMutation.data.recentActions
                )
                  ?.slice(0, 3)
                  .map((act, idx: number) => (
                    <Text key={`${act.timestampIso}-${idx}`} style={styles.detail}>
                      • [{act.target}] {act.resolvedPath} — {act.message}
                    </Text>
                  ))}
              </>
            ) : null}
          </View>
        </View>
      </SettingsSection>

      <SettingsSection title={t("settings.sectionFolderImportDiag")}>
        <View style={styles.diagBox}>
          <Text style={styles.label}>{t("settings.folderDiagPrompt")}</Text>
          <View style={styles.row}>
            <TextInput
              value={folderTestInput}
              onChangeText={setFolderTestInput}
              placeholder={t("settings.folderDiagPlaceholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("actions.dryRunCheckBtn")}
              onPress={() => {
                const p = folderTestInput.trim() || ".";
                folderDiagMutation.mutate({ path: p, dryRun: true });
              }}
              style={styles.secondaryBtn}
            >
              <Icon name="Activity" size={14} color={theme.colors.foreground} />
              <Text style={styles.secondaryBtnText}>{t("actions.dryRunCheckBtn")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("actions.importFolderBtn")}
              onPress={() => {
                const p = folderTestInput.trim() || ".";
                folderDiagMutation.mutate({ path: p, dryRun: false });
              }}
              style={styles.btn}
            >
              <Icon name="FolderPlus" size={14} color={theme.colors.accentForeground} />
              <Text style={styles.btnText}>{t("actions.importFolderBtn")}</Text>
            </Pressable>
          </View>

          {folderDiagMutation.data ? (
            <View style={{ gap: 5, marginTop: 6 }}>
              <Text style={styles.label}>
                {folderDiagMutation.data.reusedCount > 0
                  ? t("settings.folderDiagStatusReused")
                  : t("settings.folderDiagStatusCreated")}
              </Text>
              <Text style={styles.detail}>
                • {t("settings.folderDiagWorkspaceId")}{" "}
                {folderDiagMutation.data.primaryWorkspaceId || "-"} (
                {folderDiagMutation.data.primaryWorkspaceName || "-"})
              </Text>
              <Text style={styles.detail}>
                • {t("settings.folderDiagDirectory")}{" "}
                {folderDiagMutation.data.primaryDirectory || "-"} ·{" "}
                {folderDiagMutation.data.durationMs}ms
              </Text>
            </View>
          ) : null}
        </View>
      </SettingsSection>

      <SettingsSection title={t("settings.sectionDiagnostic")}>
        <View style={styles.diagBox}>
          <Text style={styles.label}>{t("settings.diagPrompt")}</Text>
          <View style={styles.row}>
            <TextInput
              value={testInput}
              onChangeText={setTestInput}
              placeholder={t("settings.diagPlaceholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.diagRunBtn")}
              onPress={() => diagMutation.mutate(testInput.trim() || ".")}
              style={styles.btn}
            >
              <Icon name="Activity" size={14} color={theme.colors.accentForeground} />
              <Text style={styles.btnText}>{t("settings.diagRunBtn")}</Text>
            </Pressable>
          </View>

          {diagMutation.data ? (
            <View style={{ gap: 6, marginTop: 6 }}>
              <Text style={styles.label}>
                {diagMutation.data.resolvedMetadata.exists
                  ? t("settings.diagExists")
                  : t("settings.diagMissing")}
              </Text>
              <Text style={styles.detail}>
                • {t("settings.diagResolvedPath")} {diagMutation.data.resolvedMetadata.absolutePath}
              </Text>
              <Text style={styles.detail}>
                • {t("settings.diagParentDir")} {diagMutation.data.resolvedMetadata.parentDir}
              </Text>
              <Text style={styles.detail}>
                • {t("settings.diagFileMeta")} {diagMutation.data.resolvedMetadata.sizeFormatted}
                {diagMutation.data.resolvedMetadata.width
                  ? ` · ${diagMutation.data.resolvedMetadata.width}×${diagMutation.data.resolvedMetadata.height} px`
                  : ""}{" "}
                · {t("settings.diagModified")} {diagMutation.data.resolvedMetadata.modifiedRelative}
              </Text>
              <View style={styles.row}>
                {diagMutation.data.availableTargets.map((targetItem) => (
                  <Pressable
                    key={targetItem.target}
                    accessibilityRole="button"
                    accessibilityLabel={`${t("settings.diagTestPrefix")} ${targetItem.label}`}
                    onPress={() =>
                      openMutation.mutate({
                        path: diagMutation.data.resolvedMetadata.absolutePath,
                        target: targetItem.target,
                      })
                    }
                    style={styles.secondaryBtn}
                  >
                    <Text style={styles.secondaryBtnText}>
                      {t("settings.diagTestPrefix")} {targetItem.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </SettingsSection>

      <SettingsSection
        title={
          isZh
            ? "定时任务运行历史与会话穿透对账器 (Schedules Runs & Session Drill-Down)"
            : "Schedule Runs & Session Drill-Down Inspector (⌘⇧H)"
        }
      >
        <View style={styles.diagBox}>
          <Text style={styles.label}>
            {isZh
              ? "实时读取 Paseo 全部定时任务与 AG 灾备孪生运行历史（runs[]），一键打开「运行记录抽屉 (⌘⇧H)」或自动解档并跳转进入任意历史运行会话："
              : "Inspect live Paseo schedule run history across all native & standby schedules, open the Runs Drawer (⌘⇧H), or unarchive and jump directly into any run conversation:"}
          </Text>
          <View style={styles.row}>
            <TextInput
              value={scheduleRunsQueryInput}
              onChangeText={setScheduleRunsQueryInput}
              placeholder={
                isZh
                  ? "筛选任务名/ID（留空默认列出有运行记录的任务）..."
                  : "Filter schedule name or ID (leave empty for schedules with runs)..."
              }
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                inspectScheduleRuns({
                  query: scheduleRunsQueryInput.trim() || undefined,
                  onlyWithRuns: !scheduleRunsQueryInput.trim(),
                  includeWorkspaceNames: true,
                  maxRunsPerSchedule: 15,
                }).then((res) => {
                  setScheduleRunsDiagData(res);
                })
              }
              style={styles.btn}
            >
              <Icon name="Clock" size={14} color={theme.colors.accentForeground} />
              <Text style={styles.btnText}>
                {isZh ? "读取运行账本" : "Inspect Runs"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                triggerScheduleRunsDrawer(scheduleRunsQueryInput.trim() || null)
              }
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>
                {isZh ? "打开运行抽屉 (⌘⇧H)" : "Open Runs Drawer (⌘⇧H)"}
              </Text>
            </Pressable>
          </View>

          {scheduleRunsDiagData ? (
            <View style={{ gap: 6, marginTop: 6 }}>
              <Text style={styles.label}>
                {isZh
                  ? `已扫描 ${scheduleRunsDiagData.totalSchedules} 个任务 · ${scheduleRunsDiagData.schedulesWithRuns} 个含运行记录 · 共 ${scheduleRunsDiagData.totalRuns} 次运行（✓ ${scheduleRunsDiagData.succeededRuns} / ✕ ${scheduleRunsDiagData.failedRuns}）· ${scheduleRunsDiagData.durationMs}ms`
                  : `Scanned ${scheduleRunsDiagData.totalSchedules} schedules · ${scheduleRunsDiagData.schedulesWithRuns} with runs · ${scheduleRunsDiagData.totalRuns} total runs (✓ ${scheduleRunsDiagData.succeededRuns} / ✕ ${scheduleRunsDiagData.failedRuns}) · ${scheduleRunsDiagData.durationMs}ms`}
              </Text>
              {scheduleRunsDiagData.recentRuns.slice(0, 6).map((runItem) => (
                <View
                  key={runItem.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={[styles.detail, { flex: 1 }]} numberOfLines={1}>
                    • [{runItem.status === "succeeded" ? "✓" : "✕"}]{" "}
                    {runItem.scheduleName} ({runItem.durationFormatted}) —{" "}
                    {runItem.workspaceName || runItem.outputPreview}
                  </Text>
                  {runItem.workspaceId ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        void openScheduleRunSession({
                          action: "open-run",
                          scheduleId: runItem.scheduleId,
                          runId: runItem.id,
                          workspaceId: runItem.workspaceId ?? undefined,
                          agentId: runItem.agentId ?? undefined,
                          dryRun: false,
                        }).then((res) => {
                          if (res.workspaceId) {
                            navigateToPaseoWorkspace(res.workspaceId, res.agentId);
                          }
                        });
                      }}
                      style={styles.secondaryBtn}
                    >
                      <Text style={styles.secondaryBtnText}>
                        {isZh ? "进入对话 ↗" : "Open Chat ↗"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </SettingsSection>

      <SettingsSection title={t("settings.sectionVoiceSttDiag")}>
        <View style={styles.diagBox}>
          <Text style={styles.label}>{t("settings.voiceSttDiagPrompt")}</Text>

          <View style={styles.row}>
            {VOICE_STT_PRESETS.map((preset) => {
              const isSelected =
                voiceSnapData?.dictationStt.model.toLowerCase() ===
                preset.model.toLowerCase();
              return (
                <Pressable
                  key={preset.id}
                  accessibilityRole="button"
                  onPress={() => {
                    setVoiceModelInput(preset.model);
                    setVoiceBaseUrlInput(preset.baseUrl);
                    void manageVoiceStt({
                      action: "apply",
                      presetId: preset.id,
                      model: preset.model,
                      source: "settings-ui",
                    }).then((res) => {
                      setVoiceSnapData(res);
                      setVoiceModelInput(res.dictationStt.model);
                      if (res.dictationStt.baseUrl) {
                        setVoiceBaseUrlInput(res.dictationStt.baseUrl);
                      }
                      if (res.ok) {
                        toast.show(res.message, { variant: "success" });
                      } else {
                        toast.error(res.message);
                      }
                    });
                  }}
                  style={isSelected ? styles.btn : styles.secondaryBtn}
                >
                  <Text style={isSelected ? styles.btnText : styles.secondaryBtnText}>
                    {isZh ? preset.labelZh : preset.label} ({preset.badge})
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.row}>
            <TextInput
              value={voiceModelInput}
              onChangeText={setVoiceModelInput}
              placeholder={t("settings.voiceSttModelPlaceholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.input}
            />
            <TextInput
              value={voiceBaseUrlInput}
              onChangeText={setVoiceBaseUrlInput}
              placeholder={t("settings.voiceSttBaseUrlPlaceholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.input}
            />
          </View>

          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void manageVoiceStt({
                  action: "inspect",
                  source: "settings-ui",
                }).then((res) => {
                  setVoiceSnapData(res);
                  setVoiceModelInput(res.dictationStt.model);
                  if (res.dictationStt.baseUrl) {
                    setVoiceBaseUrlInput(res.dictationStt.baseUrl);
                  }
                });
              }}
              style={styles.secondaryBtn}
            >
              <Icon name="Activity" size={14} color={theme.colors.foreground} />
              <Text style={styles.secondaryBtnText}>
                {t("settings.voiceSttInspectBtn")}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const m = voiceModelInput.trim();
                if (!m) return;
                void manageVoiceStt({
                  action: "apply",
                  model: m,
                  baseUrl: voiceBaseUrlInput.trim() || undefined,
                  source: "settings-ui",
                }).then((res) => {
                  setVoiceSnapData(res);
                  setVoiceModelInput(res.dictationStt.model);
                  if (res.dictationStt.baseUrl) {
                    setVoiceBaseUrlInput(res.dictationStt.baseUrl);
                  }
                  if (res.ok) {
                    toast.show(res.message, { variant: "success" });
                  } else {
                    toast.error(res.message);
                  }
                });
              }}
              style={styles.btn}
            >
              <Text style={styles.btnText}>{t("settings.voiceSttApplyBtn")}</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void manageVoiceStt({
                  action: "test",
                  model: voiceModelInput.trim() || undefined,
                  baseUrl: voiceBaseUrlInput.trim() || undefined,
                  source: "settings-ui",
                }).then((res) => {
                  setVoiceSnapData(res);
                  if (res.ok) {
                    toast.show(res.message, { variant: "success" });
                  } else {
                    toast.error(res.message);
                  }
                });
              }}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>
                {t("settings.voiceSttTestBtn")}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void manageVoiceStt({
                  action: "reset",
                  source: "settings-ui",
                }).then((res) => {
                  setVoiceSnapData(res);
                  setVoiceModelInput(res.dictationStt.model);
                  setVoiceBaseUrlInput(res.dictationStt.baseUrl);
                  toast.show(res.message, { variant: "success" });
                });
              }}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>
                {t("settings.voiceSttResetBtn")}
              </Text>
            </Pressable>
          </View>

          {voiceSnapData ? (
            <View style={{ gap: 5, marginTop: 6 }}>
              <Text style={styles.label}>
                • Dictation STT: {voiceSnapData.dictationStt.provider} ·{" "}
                {voiceSnapData.dictationStt.model} ({voiceSnapData.dictationStt.sourceBadge})
              </Text>
              <Text style={styles.detail}>
                • Base URL: {voiceSnapData.dictationStt.baseUrl || "local"} · API Key:{" "}
                {voiceSnapData.dictationStt.apiKeyPreview || "none"} · Audio Pool Gateway (:8787):{" "}
                {voiceSnapData.gateway.reachable
                  ? `ONLINE (${voiceSnapData.gateway.healthyKeys}/${voiceSnapData.gateway.totalKeys} Gemini keys · SiliconFlow=${voiceSnapData.gateway.siliconflowConfigured})`
                  : "OFFLINE"}
              </Text>
              {voiceSnapData.testResult ? (
                <Text style={styles.label}>
                  • {voiceSnapData.testResult.ok ? "✓" : "✕"} [{voiceSnapData.testResult.provider} ·{" "}
                  {voiceSnapData.testResult.model}] {voiceSnapData.testResult.latencyMs}ms —{" "}
                  {voiceSnapData.testResult.ok
                    ? `"${voiceSnapData.testResult.transcript}"`
                    : voiceSnapData.testResult.error}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </SettingsSection>

      <SettingsSection title={t("settings.sectionContract")}>
        <SettingsCard>
          <SettingsRow
            label={t("settings.contractVoiceSttLabel")}
            hint={t("settings.contractVoiceSttHint")}
          />
          <SettingsRow
            label={t("settings.contractQuickJumpLabel")}
            hint={t("settings.contractQuickJumpHint")}
          />
          <SettingsRow
            label={t("settings.contractInlineRenameLabel")}
            hint={t("settings.contractInlineRenameHint")}
          />
          <SettingsRow
            label={t("settings.contractSidebarDropLabel")}
            hint={t("settings.contractSidebarDropHint")}
          />
          <SettingsRow
            label={t("settings.contractTabMenuLabel")}
            hint={t("settings.contractTabMenuHint")}
          />
          <SettingsRow
            label={t("settings.contractImageToolbarLabel")}
            hint={t("settings.contractImageToolbarHint")}
          />
          <SettingsRow
            label={t("settings.contractShortcutsLabel")}
            hint={t("settings.contractShortcutsHint")}
          />
          <SettingsRow
            label={t("settings.contractCommandsLabel")}
            hint={t("settings.contractCommandsHint")}
          />
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
  );
}
