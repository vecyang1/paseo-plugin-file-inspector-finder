import { useRpc } from "@getpaseo/plugin/client";
import { SettingsSection, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { RpcOutput } from "@getpaseo/plugin";
import { manageRelayHealthRpc } from "../shared/contracts";
import { getWebWindow, installTimelineWireSanitizer } from "./web";

type RelayHealthSnapshot = RpcOutput<typeof manageRelayHealthRpc>;

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

export function RelaySettingsSection({ isZh, styles }: { isZh: boolean; styles: Styles }) {
  const toast = useToast();
  const callRelayHealth = useRpc(manageRelayHealthRpc);
  const [snap, setSnap] = useState<RelayHealthSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void callRelayHealth({ action: "status" })
      .then((res) => {
        if (alive) setSnap(res);
      })
      .catch(() => {
        // Ignore background initial fetch errors
      });
    return () => {
      alive = false;
    };
  }, [callRelayHealth]);

  const sanitizerHandle = installTimelineWireSanitizer(getWebWindow());
  const repairedCount = sanitizerHandle.getRepairedCount();

  const runAction = (action: "status" | "probe" | "revive") => {
    if (busy) return;
    setBusy(true);
    void callRelayHealth({ action })
      .then((res) => {
        setSnap(res);
        toast.show(res.message);
      })
      .catch((err: unknown) => {
        toast.show(err instanceof Error ? err.message : String(err), { variant: "error" });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <SettingsSection
      title={isZh ? "远程中继直连与会话时间线对账" : "Remote Relay & Timeline Reconciler"}
    >
      <View style={styles.diagBox}>
        <Text style={styles.label}>
          {isZh
            ? "守护手机端加密中继通道免受代理分流劫持，并实时校验驻留会话时间线协议完整性，防止桌面端与手机端加载卡死。"
            : "Protects mobile encrypted relay connectivity from proxy tunnel hijacking and verifies resident session timeline integrity."}
        </Text>

        <Text style={styles.detail}>
          {isZh
            ? `控制通道：${snap?.controlState ?? "读取中"} · 分流出口：${snap?.clashRoute ?? "读取中"} · 手机最近握手：${snap?.lastMobileHelloAt ?? "暂无记录"} · 前端实时修复条目：${repairedCount}`
            : `Control: ${snap?.controlState ?? "loading"} · Route: ${snap?.clashRoute ?? "loading"} · Last mobile hello: ${snap?.lastMobileHelloAt ?? "none"} · Repaired items: ${repairedCount}`}
        </Text>

        {snap ? (
          <Text style={styles.detail}>
            {isZh
              ? `驻留会话校验：已查 ${snap.checkedTimelines} 个，异常 ${snap.badTimelines.length} 个 · 近十五分钟中继错误：${snap.recentRelayErrors15m} 次，租约超时断开：${snap.recentLeaseDrops15m} 次`
              : `Resident timelines checked: ${snap.checkedTimelines}, invalid: ${snap.badTimelines.length} · Relay errors: ${snap.recentRelayErrors15m}, lease drops: ${snap.recentLeaseDrops15m}`}
          </Text>
        ) : null}

        {snap?.e2eeOk !== null && snap?.e2eeOk !== undefined ? (
          <Text style={styles.detail}>
            {isZh
              ? snap.e2eeOk
                ? `端到端回环实测通过：握手耗时 ${snap.e2eeConnectMs ?? 0} 毫秒，状态拉取 ${snap.e2eeStatusMs ?? 0} 毫秒`
                : `端到端回环实测失败：${snap.e2eeError ?? "连接超时"}`
              : snap.e2eeOk
                ? `End-to-end probe passed: connect ${snap.e2eeConnectMs ?? 0} ms, status ${snap.e2eeStatusMs ?? 0} ms`
                : `End-to-end probe failed: ${snap.e2eeError ?? "timeout"}`}
          </Text>
        ) : null}

        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => runAction("status")}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>
              {isZh ? "刷新状态" : "Refresh Status"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => runAction("probe")}
            style={styles.btn}
          >
            <Text style={styles.btnText}>
              {isZh ? "实测端到端中继握手" : "Probe Relay Handshake"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => runAction("revive")}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>
              {isZh ? "无感重连远程中继" : "Reconnect Relay Channel"}
            </Text>
          </Pressable>
        </View>
      </View>
    </SettingsSection>
  );
}
