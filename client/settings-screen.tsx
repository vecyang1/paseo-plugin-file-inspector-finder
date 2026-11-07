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
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type OpenerTarget,
  diagnosePathRpc,
  openFileTargetRpc,
  pluginSettings,
} from "../shared/contracts";
import { pluginTranslations } from "./i18n";
import { syncImagePanelAssociations } from "./web";

export function FinderPluginSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const { t } = useTranslation(pluginTranslations);
  const settings = useSettings(pluginSettings);
  const toast = useToast();
  const diagnosePath = useRpc(diagnosePathRpc);
  const openTarget = useRpc(openFileTargetRpc);

  const [testInput, setTestInput] = useState(
    "reports/mobile_ui_series/00_mobile_ui_5screen_panoramic_showcase.png",
  );

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
              void save({ ...values, enableDesktopContextMenuHelper: next }, revision);
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

      <SettingsSection title={t("settings.sectionContract")}>
        <SettingsCard>
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
