/**
 * Settings -> Plugins -> File Inspector & Finder -> Multi-Document Preview & Scroll/Drag.
 * Read: active local rendering engines, cache telemetry, and associated extensions.
 * Test: probe any PDF / Office / iWork / EPUB path or run interactive pan/zoom/sanitizer self-test.
 * Tune: default interaction mode (Drag vs Select), PDF mode, multi-doc drop behavior, sync scroll, cache clear, and Restore defaults.
 */
import { useRpc } from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsSelect,
  SettingsSection,
  SettingsSwitch,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type DocDropBehavior,
  type DocInteractionMode,
  type DocPdfRenderMode,
  diagnoseDocPreviewRpc,
} from "../shared/doc-preview-contracts";
import {
  type DocPreviewPrefs,
  type DocPreviewRuntimeStatus,
  getDocPreviewRuntimeStatus,
  resetDocPreviewPrefs,
  runDocPreviewWebSelfTest,
  subscribeDocPreviewStatus,
  syncDocPreviewPrefs,
} from "./doc-preview-web";

type Styles = Record<
  | "diagBox"
  | "row"
  | "input"
  | "btn"
  | "btnText"
  | "secondaryBtn"
  | "secondaryBtnText"
  | "label"
  | "detail",
  object
>;

export function DocPreviewSettingsSection({ isZh, styles }: { isZh: boolean; styles: Styles }) {
  const toast = useToast();
  const diagnoseDoc = useRpc(diagnoseDocPreviewRpc);
  const [runtime, setRuntime] = useState<DocPreviewRuntimeStatus>(() => getDocPreviewRuntimeStatus());
  const [probePath, setProbePath] = useState("");
  const [testSummary, setTestSummary] = useState<string | null>(null);

  useEffect(() => {
    return subscribeDocPreviewStatus(() => setRuntime(getDocPreviewRuntimeStatus()));
  }, []);

  const statusQuery = useQuery({
    queryKey: ["finder.diagnoseDocPreview.status"],
    queryFn: () => diagnoseDoc({ action: "status" }),
    staleTime: 10000,
  });

  const probeMutation = useMutation({
    mutationFn: (targetPath: string) =>
      diagnoseDoc({
        action: "probe",
        path: targetPath,
      }),
    onSuccess: (res) => {
      setTestSummary(res.message);
      toast.show(res.message, { variant: res.ok ? "success" : "error" });
      void statusQuery.refetch();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setTestSummary(msg);
      toast.error(msg);
    },
  });

  const clearCacheMutation = useMutation({
    mutationFn: () => diagnoseDoc({ action: "clear_cache" }),
    onSuccess: (res) => {
      setTestSummary(res.message);
      toast.show(res.message, { variant: "success" });
      void statusQuery.refetch();
    },
  });

  const setPref = (next: Partial<DocPreviewPrefs>) => {
    syncDocPreviewPrefs(next);
    setRuntime(getDocPreviewRuntimeStatus());
  };

  const enginesLine = statusQuery.data?.engines
    ? statusQuery.data.engines
        .map((e) => `${e.id}: ${e.available ? "ready" : "off"}`)
        .join(" · ")
    : isZh
      ? "正在检测渲染引擎..."
      : "Detecting rendering engines...";

  return (
    <SettingsSection
      title={isZh ? "多格式文档预览与拖拽滚动" : "Multi-document preview & drag navigation"}
    >
      <SettingsCard>
        <SettingsSwitch
          label={isZh ? "自动接管 PDF 与办公文档标签页" : "Auto-open PDF and Office documents"}
          hint={
            isZh
              ? "自动使用多文档预览面板打开 pdf、docx、doc、xlsx、xls、pptx、ppt、rtf、odt、epub、pages、numbers、key 文件，替代默认的二进制不可用占位。"
              : "Opens pdf, docx, doc, xlsx, xls, pptx, ppt, rtf, odt, epub, pages, numbers, and key files directly instead of showing Binary preview unavailable."
          }
          value={runtime.prefs.autoAssociateDocumentPanels}
          onValueChange={(next: boolean) => setPref({ autoAssociateDocumentPanels: next })}
        />

        <SettingsSelect
          label={isZh ? "默认鼠标交互模式" : "Default pointer mode"}
          hint={
            isZh
              ? "拖拽模式下按住左键即可在放大页面与宽表格中自由平移；选择模式下可划词引用回复（按住空格键临时拖拽平移）。"
              : "Drag mode pans pages and wide sheets by dragging; Select mode lets you highlight text for Quote Reply (hold Space to pan)."
          }
          value={runtime.prefs.defaultInteractionMode}
          onValueChange={(v) => setPref({ defaultInteractionMode: v as DocInteractionMode })}
          options={[
            { value: "pan", label: isZh ? "拖拽平移" : "Drag to pan" },
            { value: "select", label: isZh ? "文本选择" : "Select text" },
          ]}
        />

        <SettingsSelect
          label={isZh ? "默认 PDF 渲染视图" : "Default PDF view"}
          hint={
            isZh
              ? "画布视图支持抓手拖拽、双文档同步滚动与缩放；原生视图使用内置文档框架。"
              : "Canvas view supports grab-to-pan drag, synchronized multi-doc scroll, and zoom; Native uses Paseo's built-in frame."
          }
          value={runtime.prefs.defaultPdfMode}
          onValueChange={(v) => setPref({ defaultPdfMode: v as DocPdfRenderMode })}
          options={[
            { value: "canvas", label: isZh ? "高清画布（支持拖拽与对比）" : "Canvas (drag & compare)" },
            { value: "native", label: isZh ? "原生文档框" : "Native frame" },
            { value: "text", label: isZh ? "纯文本提取" : "Extracted text" },
          ]}
        />

        <SettingsSelect
          label={isZh ? "拖入多个文档时的默认行为" : "File drop on preview pane"}
          hint={
            isZh
              ? "从聊天链接或 Finder 拖入文件到右侧预览区时，可并排对比预览或分别打开独立标签页（按住 Option 临时切换）。"
              : "Dropping files from Finder or chat links onto the preview pane compares them side-by-side or opens separate tabs (hold Option to invert)."
          }
          value={runtime.prefs.defaultDropBehavior}
          onValueChange={(v) => setPref({ defaultDropBehavior: v as DocDropBehavior })}
          options={[
            { value: "compare", label: isZh ? "并排对比预览" : "Compare side-by-side" },
            { value: "tabs", label: isZh ? "打开独立标签页" : "Open separate tabs" },
          ]}
        />

        <SettingsSwitch
          label={isZh ? "多文档对比时同步滚动" : "Synchronize scroll in multi-doc compare"}
          hint={
            isZh
              ? "并排或上下对比两份文档（如简历 PDF 与 DOCX）时按比例联动滚动。"
              : "Scrolls compared documents proportionally when viewing two or more files side-by-side."
          }
          value={runtime.prefs.enableSyncScrollInCompare}
          onValueChange={(next: boolean) => setPref({ enableSyncScrollInCompare: next })}
        />
      </SettingsCard>

      <View style={styles.diagBox} testID="paseo-doc-preview-diagnostics">
        <Text style={styles.label}>
          {isZh ? "渲染引擎与实时状态" : "Rendering engines & live status"}
        </Text>
        <Text style={styles.detail}>{enginesLine}</Text>
        <Text style={styles.detail}>
          {isZh
            ? `关联后缀：${runtime.associatedCount} · 活跃视口：${runtime.activeViewports} · 拖拽计数：${runtime.panDragCount} · 缓存：${statusQuery.data?.cacheFileCount ?? 0} 项 (${statusQuery.data?.cacheBytesFormatted ?? "0 B"})`
            : `Associated: ${runtime.associatedCount} · Active viewports: ${runtime.activeViewports} · Pan drags: ${runtime.panDragCount} · Cache: ${statusQuery.data?.cacheFileCount ?? 0} files (${statusQuery.data?.cacheBytesFormatted ?? "0 B"})`}
        </Text>

        <View style={styles.row}>
          <View style={styles.input}>
            <TextInput
              value={probePath}
              onChangeText={setProbePath}
              placeholder={
                isZh
                  ? "输入 PDF / DOCX / XLSX / PPTX 路径实测渲染..."
                  : "Enter PDF / DOCX / XLSX / PPTX path to probe..."
              }
            />
          </View>
          <Pressable
            accessibilityRole="button"
            testID="paseo-doc-preview-probe-btn"
            onPress={() => {
              if (probePath.trim()) {
                probeMutation.mutate(probePath.trim());
              } else {
                const selfRes = runDocPreviewWebSelfTest();
                setTestSummary(selfRes.summary);
                toast.show(selfRes.summary, { variant: selfRes.ok ? "success" : "error" });
              }
            }}
            style={styles.btn}
          >
            <Text style={styles.btnText}>
              {probePath.trim() ? (isZh ? "实测文档" : "Probe file") : isZh ? "运行自检" : "Run self-test"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => clearCacheMutation.mutate()}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>{isZh ? "清理缓存" : "Clear cache"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              resetDocPreviewPrefs();
              setRuntime(getDocPreviewRuntimeStatus());
              toast.show(isZh ? "已恢复默认文档预览配置" : "Restored default document preview settings", {
                variant: "success",
              });
            }}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>{isZh ? "恢复默认" : "Restore defaults"}</Text>
          </Pressable>
        </View>

        {testSummary ? <Text style={styles.detail}>{testSummary}</Text> : null}
      </View>
    </SettingsSection>
  );
}
