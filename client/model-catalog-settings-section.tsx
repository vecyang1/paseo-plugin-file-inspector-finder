import { useRpc } from "@getpaseo/plugin/client";
import { SettingsSection, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { RpcOutput } from "@getpaseo/plugin";
import { manageHarnessCatalogsRpc } from "../shared/contracts";

type CatalogSnapshot = RpcOutput<typeof manageHarnessCatalogsRpc>;

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

export function ModelCatalogSettingsSection({ isZh, styles }: { isZh: boolean; styles: Styles }) {
  const toast = useToast();
  const callCatalog = useRpc(manageHarnessCatalogsRpc);
  const [snap, setSnap] = useState<CatalogSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void callCatalog({ action: "status" })
      .then((res) => {
        if (alive) setSnap(res);
      })
      .catch(() => {
        // Ignore silent background initial read errors
      });
    return () => {
      alive = false;
    };
  }, [callCatalog]);

  const runAction = (action: "status" | "sync" | "refresh") => {
    if (busy) return;
    setBusy(true);
    void callCatalog({ action })
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
      title={isZh ? "全端模型目录自动发现与零重启同步" : "Multi-Harness Model Catalog Auto-Sync"}
    >
      <View style={styles.diagBox}>
        <Text style={styles.label}>
          {isZh
            ? "实时联合扫描本地模型池、命令行工具与各提供商上游目录，自动补齐桥接路由并向宿主推送最新模型快照与常用画像，无需重启守护进程。"
            : "Discovers new models across all active harnesses, provisions routing bridges automatically, and pushes live catalog and profile updates without restarting the host."}
        </Text>

        <Text style={styles.detail}>
          {isZh
            ? `对账状态：${snap ? (snap.ok ? "已全部对齐" : "存在待同步项") : "读取中"} · 目录指纹：${snap?.catalogSignature || "读取中"} · 活跃池模型：${snap?.antigravityTotal ?? 0} · 原生档位 ${snap?.nativeEffortCount ?? 0} · 动态桥接 ${snap?.bridgeCount ?? 0}`
            : `Status: ${snap ? (snap.ok ? "All synced" : "Drift detected") : "Loading"} · Signature: ${snap?.catalogSignature || "loading"} · Active pool models: ${snap?.antigravityTotal ?? 0} · Native ${snap?.nativeEffortCount ?? 0} · Bridged ${snap?.bridgeCount ?? 0}`}
        </Text>

        {snap?.harnesses?.map((h) => (
          <Text key={h.provider} style={styles.detail}>
            {isZh
              ? `${h.provider}：在库 ${h.paseoModelCount}${h.upstreamCount !== null ? ` / 上游 ${h.upstreamCount}` : ""} · ${h.inSync ? "已同步" : `待同步 ${h.missingInPaseo.length} 项`} · 置顶：${h.topModels.slice(0, 3).join("、") || "无"}`
              : `${h.provider}: active ${h.paseoModelCount}${h.upstreamCount !== null ? ` / upstream ${h.upstreamCount}` : ""} · ${h.inSync ? "Synced" : `${h.missingInPaseo.length} missing`} · Top: ${h.topModels.slice(0, 3).join(", ") || "none"}`}
          </Text>
        ))}

        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => runAction("status")}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>
              {isZh ? "检查目录漂移" : "Check Drift"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => runAction("sync")}
            style={styles.btn}
          >
            <Text style={styles.btnText}>
              {isZh ? "同步最新模型" : "Sync Latest Models"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => runAction("refresh")}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>
              {isZh ? "强制刷新全端快照" : "Refresh All Snapshots"}
            </Text>
          </Pressable>
        </View>
      </View>
    </SettingsSection>
  );
}
