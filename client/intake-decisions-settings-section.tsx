import { useRpc } from "@getpaseo/plugin/client";
import { SettingsSection, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { RpcOutput } from "@getpaseo/plugin";
import { manageIntakeDecisionsRpc } from "../shared/intake-decisions-contracts";
import {
  openIntakeDecisionsDrawer,
  readIntakeDecisionsPrefs,
  writeIntakeDecisionsPrefs,
} from "./intake-decisions-web";
import { getWebWindow } from "./web";

type DecisionsSnapshot = RpcOutput<typeof manageIntakeDecisionsRpc>;

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

export function IntakeDecisionsSettingsSection({
  isZh,
  styles,
}: {
  isZh: boolean;
  styles: Styles;
}) {
  const toast = useToast();
  const callDecisions = useRpc(manageIntakeDecisionsRpc);
  const [snap, setSnap] = useState<DecisionsSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [shortcutEnabled, setShortcutEnabled] = useState<boolean>(() =>
    readIntakeDecisionsPrefs(getWebWindow()).enableShortcut,
  );

  useEffect(() => {
    let alive = true;
    void callDecisions({ action: "list" })
      .then((res) => {
        if (alive) setSnap(res);
      })
      .catch(() => {
        // Ignore background initial fetch errors
      });
    return () => {
      alive = false;
    };
  }, [callDecisions]);

  const refreshQueue = () => {
    if (busy) return;
    setBusy(true);
    void callDecisions({ action: "list", refresh: true })
      .then((res) => {
        setSnap(res);
        toast.show(res.message);
      })
      .catch((err: unknown) => {
        toast.show(err instanceof Error ? err.message : String(err), { variant: "error" });
      })
      .finally(() => setBusy(false));
  };

  const previewTopItem = () => {
    if (busy) return;
    const first = snap?.items[0];
    if (!first) {
      toast.show(isZh ? "当前队列没有待拍板项" : "No pending decision items");
      return;
    }
    const recChoice = (first.options.find((o) => o.recommended) ?? first.options[0])?.index;
    setBusy(true);
    void callDecisions({
      action: "preview_answer",
      taskId: first.shortId,
      choice: recChoice,
      text: recChoice === undefined ? "Approve and continue" : undefined,
    })
      .then((res) => {
        setSnap(res);
        toast.show(res.message);
      })
      .catch((err: unknown) => {
        toast.show(err instanceof Error ? err.message : String(err), { variant: "error" });
      })
      .finally(() => setBusy(false));
  };

  const resetConfigDefaults = () => {
    if (busy) return;
    setBusy(true);
    void callDecisions({ action: "tune_config", configAction: "reset" })
      .then((res) => {
        setSnap(res);
        const nextPrefs = { enableShortcut: true };
        writeIntakeDecisionsPrefs(nextPrefs, getWebWindow());
        setShortcutEnabled(true);
        toast.show(isZh ? "已恢复默认路由与拍板参数" : "Restored default decision queue parameters");
      })
      .catch((err: unknown) => {
        toast.show(err instanceof Error ? err.message : String(err), { variant: "error" });
      })
      .finally(() => setBusy(false));
  };

  const toggleShortcut = () => {
    const next = !shortcutEnabled;
    writeIntakeDecisionsPrefs({ enableShortcut: next }, getWebWindow());
    setShortcutEnabled(next);
    toast.show(
      isZh
        ? next
          ? "已启用快捷键 Ctrl+Cmd+D"
          : "已停用快捷键 Ctrl+Cmd+D"
        : next
          ? "Enabled Ctrl+Cmd+D shortcut"
          : "Disabled Ctrl+Cmd+D shortcut",
    );
  };

  return (
    <SettingsSection
      title={isZh ? "任务拍板与原会话续接队列" : "Task Decisions & In-Place Session Resume"}
    >
      <View style={styles.diagBox} testID="intake-decisions-settings-card">
        <Text style={styles.label}>
          {isZh
            ? "集中展示遇到人工阻塞节点的后台任务选项，一键拍板并直接唤醒原 Paseo 会话续跑，无需重开重复会话。"
            : "Inspects blocked background tasks with structured options and resumes the original Paseo session in-place upon approval."}
        </Text>

        <Text style={styles.detail}>
          {isZh
            ? `待拍板：${snap?.actionableBlockedCount ?? 0} 项 · 已完成：${snap?.doneCount ?? 0} 项 · 带关注完成：${snap?.concernsCount ?? 0} 项 · 已折叠重复项：${snap?.supersededDuplicateCount ?? 0} 项`
            : `Pending decisions: ${snap?.actionableBlockedCount ?? 0} · Completed: ${snap?.doneCount ?? 0} · Concerns: ${snap?.concernsCount ?? 0} · Folded duplicates: ${snap?.supersededDuplicateCount ?? 0}`}
        </Text>

        <Text style={styles.detail}>
          {isZh
            ? `跳数熔断上限：${snap?.maxDecisionRounds ?? 8} 轮 · 并发上限：${snap?.maxConcurrent ?? 4} · 快捷键 Ctrl+Cmd+D：${shortcutEnabled ? "已开启" : "已关闭"}`
            : `Hop breaker ceiling: ${snap?.maxDecisionRounds ?? 8} rounds · Max concurrent: ${snap?.maxConcurrent ?? 4} · Shortcut Ctrl+Cmd+D: ${shortcutEnabled ? "enabled" : "disabled"}`}
        </Text>

        {snap?.preview ? (
          <Text style={styles.detail} testID="intake-decisions-settings-preview">
            {isZh
              ? `干跑预演结果：${snap.preview.shortId} -> 模式 ${snap.preview.mode} · 目标会话 ${(snap.preview.agentId ?? "-").slice(0, 8)} (${snap.preview.agentStatus ?? "-"}) · 第 ${snap.preview.round ?? 1}/${snap.preview.maxDecisionRounds ?? 8} 轮`
              : `Dry-run preview: ${snap.preview.shortId} -> ${snap.preview.mode} · agent ${(snap.preview.agentId ?? "-").slice(0, 8)} (${snap.preview.agentStatus ?? "-"}) · round ${snap.preview.round ?? 1}/${snap.preview.maxDecisionRounds ?? 8}`}
          </Text>
        ) : null}

        <View style={styles.row}>
          <Pressable
            style={styles.btn}
            disabled={busy}
            onPress={() => {
              void openIntakeDecisionsDrawer((input) => callDecisions(input));
            }}
            testID="intake-decisions-open-btn"
          >
            <Text style={styles.btnText}>
              {isZh ? "打开拍板队列 (Ctrl+Cmd+D)" : "Open Decisions Queue (Ctrl+Cmd+D)"}
            </Text>
          </Pressable>

          <Pressable
            style={styles.secondaryBtn}
            disabled={busy}
            onPress={previewTopItem}
            testID="intake-decisions-dryrun-btn"
          >
            <Text style={styles.secondaryBtnText}>
              {isZh ? "预演首项续接" : "Dry-Run Top Item"}
            </Text>
          </Pressable>

          <Pressable
            style={styles.secondaryBtn}
            disabled={busy}
            onPress={refreshQueue}
            testID="intake-decisions-refresh-btn"
          >
            <Text style={styles.secondaryBtnText}>
              {isZh ? "刷新对账" : "Refresh"}
            </Text>
          </Pressable>

          <Pressable
            style={styles.secondaryBtn}
            disabled={busy}
            onPress={toggleShortcut}
            testID="intake-decisions-shortcut-toggle"
          >
            <Text style={styles.secondaryBtnText}>
              {isZh
                ? shortcutEnabled
                  ? "停用快捷键"
                  : "启用快捷键"
                : shortcutEnabled
                  ? "Disable Shortcut"
                  : "Enable Shortcut"}
            </Text>
          </Pressable>

          <Pressable
            style={styles.secondaryBtn}
            disabled={busy}
            onPress={resetConfigDefaults}
            testID="intake-decisions-reset-btn"
          >
            <Text style={styles.secondaryBtnText}>
              {isZh ? "恢复默认" : "Restore Defaults"}
            </Text>
          </Pressable>
        </View>
      </View>
    </SettingsSection>
  );
}
