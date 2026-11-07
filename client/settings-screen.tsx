import {
  type PluginSurfaceProps,
  useRpc,
  useSettings,
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
  SUPPORTED_IMAGE_EXTENSIONS,
  diagnosePathRpc,
  openFileTargetRpc,
  pluginSettings,
} from "../shared/contracts";
import { syncImagePanelAssociations } from "./web";

export function FinderPluginSettingsScreen({ theme, layout }: PluginSurfaceProps) {
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
        <Text style={styles.label}>配置加载异常: {settings.error}</Text>
      </View>
    );
  }

  const { values, revision, save } = settings;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <SettingsSection title="1. 核心打开行为与表面增强 (能调 · Live Config)">
        <SettingsCard>
          <SettingsSelect
            label="默认首选定位动作 (Default Primary Action)"
            hint="点击快捷按钮或执行 /reveal 时的默认系统动作"
            value={values.defaultPrimaryAction}
            options={[
              { label: "📂 在 Finder 中显示并选中文件 (open -R)", value: "finder-reveal" },
              { label: "📁 打开所在父级文件夹 (open [dir])", value: "finder-folder" },
              { label: "🖼️ 使用 macOS 系统预览打开 (Preview.app)", value: "system-preview" },
              { label: "💻 使用 Antigravity IDE 打开", value: "antigravity" },
              { label: "💻 使用 Cursor IDE 打开", value: "cursor" },
            ]}
            onValueChange={(next) => {
              void save({ ...values, defaultPrimaryAction: next }, revision);
            }}
          />

          <SettingsSelect
            label="首选代码编辑器 (Preferred Code Editor)"
            hint="图片检查器工具栏上的代码编辑器直达按钮"
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
            label="图片预览默认画布底色 (Default Canvas Background)"
            hint="方便查看透明背景 PNG / SVG 素材边缘"
            value={values.defaultCanvasBackground}
            options={[
              { label: "深灰棋盘对比底 (Checker Contrast)", value: "checker" },
              { label: "纯暗黑底 (Dark #090a0f)", value: "dark" },
              { label: "浅灰亮底 (Light #f4f4f5)", value: "light" },
            ]}
            onValueChange={(next) => {
              void save({ ...values, defaultCanvasBackground: next }, revision);
            }}
          />

          <SettingsSwitch
            label="自动将图片后缀关联至增强检查器 (Auto-Associate Image File Panel)"
            hint={`自动将 ${SUPPORTED_IMAGE_EXTENSIONS.join(", ")} 关联到带 Finder 工具栏的面板`}
            value={values.autoAssociateImagePanels}
            onValueChange={(next) => {
              void save({ ...values, autoAssociateImagePanels: next }, revision);
              syncImagePanelAssociations("file-inspector-finder", "image-inspector", next);
            }}
          />

          <SettingsSwitch
            label="启用桌面端右键菜单与快捷键增强 (Desktop Right-Click & Option+Click)"
            hint="支持对聊天内文件链接和文件标签页右键弹出「在 Finder 中显示」、Option+Click 秒开、⌘⇧R 快捷键"
            value={values.enableDesktopContextMenuHelper}
            onValueChange={(next) => {
              void save({ ...values, enableDesktopContextMenuHelper: next }, revision);
            }}
          />

          <SettingsAction
            label="立即同步图片面板默认关联 (Re-sync File Panel Associations)"
            hint="确保所有图片标签页默认使用带 Finder 工具栏的 Image Inspector 打开"
            actionLabel="立即同步关联"
            onPress={() => {
              syncImagePanelAssociations("file-inspector-finder", "image-inspector", true);
              toast.show("已将所有图片后缀关联至 Image Inspector & Finder", {
                variant: "success",
              });
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="2. 路径解析与系统打开对账器 (能试 · Live Diagnostic Reconciler)">
        <View style={styles.diagBox}>
          <Text style={styles.label}>
            输入任意相对路径、绝对路径或文件名以验算 Daemon 真实解析结果：
          </Text>
          <View style={styles.row}>
            <TextInput
              value={testInput}
              onChangeText={setTestInput}
              placeholder="例如: assets/preview.png 或 docs/architecture.svg"
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Run path diagnostic"
              onPress={() => diagMutation.mutate(testInput.trim() || ".")}
              style={styles.btn}
            >
              <Icon name="Activity" size={14} color={theme.colors.accentForeground} />
              <Text style={styles.btnText}>运行诊断验算</Text>
            </Pressable>
          </View>

          {diagMutation.data ? (
            <View style={{ gap: 6, marginTop: 6 }}>
              <Text style={styles.label}>
                {diagMutation.data.resolvedMetadata.exists
                  ? "✅ 文件/目录存在 (Verified on Disk)"
                  : "⚠️ 目标文件不存在 (将回退打开已存在的父级目录)"}
              </Text>
              <Text style={styles.detail}>
                • 解析绝对路径: {diagMutation.data.resolvedMetadata.absolutePath}
              </Text>
              <Text style={styles.detail}>
                • 所在父级目录: {diagMutation.data.resolvedMetadata.parentDir}
              </Text>
              <Text style={styles.detail}>
                • 文件属性: {diagMutation.data.resolvedMetadata.sizeFormatted}
                {diagMutation.data.resolvedMetadata.width
                  ? ` · ${diagMutation.data.resolvedMetadata.width}×${diagMutation.data.resolvedMetadata.height} px`
                  : ""}{" "}
                · 修改于 {diagMutation.data.resolvedMetadata.modifiedRelative}
              </Text>
              <View style={styles.row}>
                {diagMutation.data.availableTargets.map((t) => (
                  <Pressable
                    key={t.target}
                    accessibilityRole="button"
                    accessibilityLabel={`Test ${t.label}`}
                    onPress={() =>
                      openMutation.mutate({
                        path: diagMutation.data.resolvedMetadata.absolutePath,
                        target: t.target,
                      })
                    }
                    style={styles.secondaryBtn}
                  >
                    <Text style={styles.secondaryBtnText}>实测: {t.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </SettingsSection>

      <SettingsSection title="3. 生效契约与快捷键一览 (能读 · Active Surface Contract)">
        <SettingsCard>
          <SettingsRow
            label="图片标签页顶部工具栏 (Image File Panel)"
            hint="打开任意 PNG/JPG/WebP/SVG 标签页，顶部自带「在 Finder 中显示 / 打开所在文件夹 / 系统预览 / 复制路径 / 缩放」"
          />
          <SettingsRow
            label="右上角 Header 按钮与底部聊天栏胶囊 (Header & Composer Pill)"
            hint="工作区右上角 📂 图标与聊天输入框下方「📂 Finder」按钮，一键弹出当前工作区最新生成的图片列表"
          />
          <SettingsRow
            label="桌面端快捷交互 (Right-Click / Option+Click / ⌘⇧R)"
            hint="对聊天中的文件链接或标签页按住 Option 左键点击直接定位 Finder；右键弹出快捷菜单；按 ⌘⇧R 定位当前激活文件"
          />
          <SettingsRow
            label="命令中心与斜杠指令 (⌘K & /reveal)"
            hint="在聊天框输入 /reveal [文件名] 或 /finder [路径]，或按 ⌘K 搜索 Finder"
          />
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
  );
}
