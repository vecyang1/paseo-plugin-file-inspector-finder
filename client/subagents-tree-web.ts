/// <reference lib="dom" />
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  type FlatSubagentNode,
  type OpenerTarget,
  type SubagentAgentTree,
  type SubagentTimelineItem,
  manageSubagentsRpc,
  openFileTargetRpc,
} from "../shared/contracts";
import { isChineseLocale } from "./i18n";
import { syncPaseoThemeCssVariables } from "./theme-web";

export interface SubagentsTreeWebClient {
  call<TDef extends typeof manageSubagentsRpc | typeof openFileTargetRpc>(
    def: TDef,
    input: RpcInput<TDef>,
  ): Promise<RpcOutput<TDef>>;
  getLocale?: () => string | undefined;
}

const KNOWN_SUBAGENT_TYPES = new Set([
  "deepcoder",
  "deepcoderworkerl0",
  "deepcoderimprovementworker",
  "research",
  "self",
  "image-generator",
  "firestore-rules-author",
]);

let externalOpenDrawerFn:
  | ((opts?: { agentId?: string | null; conversationId?: string | null }) => void)
  | null = null;

export function triggerSubagentsTreeDrawer(opts?: {
  agentId?: string | null;
  conversationId?: string | null;
}): void {
  externalOpenDrawerFn?.(opts);
}

export function extractCurrentRouteAgentId(pathname?: string | null): string | null {
  const raw = (pathname ?? "").trim();
  const m = raw.match(/\/ag\/([A-Za-z0-9-]{8,})/);
  return m ? m[1] : null;
}

function formatStatusLabel(status: string, isZh: boolean): string {
  if (status === "running") return isZh ? "运行中" : "Running";
  if (status === "failed") return isZh ? "失败" : "Failed";
  return isZh ? "已完成" : "Done";
}

function statusColors(
  status: string,
  tokens: ReturnType<typeof syncPaseoThemeCssVariables>,
): { fg: string; bg: string; border: string; dot: string } {
  if (status === "running") {
    return {
      fg: tokens.statusWarning,
      bg: tokens.statusWarningTint,
      border: `${tokens.statusWarning}66`,
      dot: tokens.statusWarning,
    };
  }
  if (status === "failed") {
    return {
      fg: tokens.destructive,
      bg: `${tokens.destructive}1a`,
      border: `${tokens.destructive}66`,
      dot: tokens.destructive,
    };
  }
  return {
    fg: tokens.statusSuccess,
    bg: tokens.statusSuccessTint,
    border: `${tokens.statusSuccess}55`,
    dot: tokens.statusSuccess,
  };
}

export function installDesktopSubagentsTreeEnhancer(
  client: SubagentsTreeWebClient,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const treeCacheByAgent = new Map<
    string,
    { tree: SubagentAgentTree | null; fetchedAtMs: number; inFlight?: Promise<SubagentAgentTree | null> }
  >();
  let lastRouteAgentId: string | null = null;
  let activeDrawerOverlayEl: HTMLElement | null = null;
  let pollIntervalId: ReturnType<typeof setInterval> | null = null;
  let rafId: number | null = null;

  const isZh = (): boolean => isChineseLocale(client.getLocale?.() ?? window.navigator?.language);

  const fetchAgentTree = async (
    agentId: string,
    force = false,
    includeTimeline = false,
  ): Promise<SubagentAgentTree | null> => {
    const cleanId = agentId.trim();
    if (!cleanId) return null;
    const cached = treeCacheByAgent.get(cleanId);
    const now = Date.now();
    const ttlMs = cached?.tree?.subagentSummary.running ? 2_500 : 12_000;
    if (
      !force &&
      !includeTimeline &&
      cached &&
      now - cached.fetchedAtMs < ttlMs &&
      cached.tree !== undefined
    ) {
      return cached.tree;
    }
    if (!force && !includeTimeline && cached?.inFlight) {
      return cached.inFlight;
    }

    const promise = client
      .call(manageSubagentsRpc, {
        action: includeTimeline ? "inspect" : "tree",
        agentId: cleanId,
        includeTimeline,
        limit: 5,
        source: includeTimeline ? "drawer" : "timeline-inline",
      })
      .then((res) => {
        const matched =
          res.trees.find((t) => t.agentId === cleanId || t.agentId.startsWith(cleanId)) ??
          res.trees[0] ??
          null;
        treeCacheByAgent.set(cleanId, {
          tree: matched,
          fetchedAtMs: Date.now(),
        });
        return matched;
      })
      .catch(() => {
        const prev = treeCacheByAgent.get(cleanId)?.tree ?? null;
        treeCacheByAgent.set(cleanId, {
          tree: prev,
          fetchedAtMs: Date.now(),
        });
        return prev;
      });

    treeCacheByAgent.set(cleanId, {
      tree: cached?.tree ?? null,
      fetchedAtMs: cached?.fetchedAtMs ?? 0,
      inFlight: promise,
    });
    return promise;
  };

  const tryClickNativeSubagentTrackRow = (conversationId: string): boolean => {
    const cid = conversationId.trim();
    if (!cid) return false;
    const candidates = [
      `[data-testid="subagents-track-row-vec-subagent:${cid}"]`,
      `[data-testid="subagents-track-row-${cid}"]`,
    ];
    for (const sel of candidates) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) {
        el.click();
        return true;
      }
    }
    return false;
  };

  const closeDrawer = () => {
    if (activeDrawerOverlayEl) {
      activeDrawerOverlayEl.remove();
      activeDrawerOverlayEl = null;
    }
  };

  const openDrawer = async (opts?: {
    agentId?: string | null;
    conversationId?: string | null;
  }) => {
    closeDrawer();
    const zh = isZh();
    const tokens = syncPaseoThemeCssVariables(document as never, window as never);
    const routeAgentId =
      opts?.agentId ?? extractCurrentRouteAgentId(window.location?.pathname) ?? undefined;

    const overlay = document.createElement("div");
    overlay.setAttribute("data-testid", "paseo-finder-subagents-drawer");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483645",
      backgroundColor: "rgba(0, 0, 0, 0.52)",
      backdropFilter: "blur(3px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      boxSizing: "border-box",
      fontFamily:
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    });

    const modal = document.createElement("div");
    Object.assign(modal.style, {
      width: "min(1180px, 95vw)",
      height: "min(820px, 90vh)",
      backgroundColor: tokens.surface0,
      border: `1px solid ${tokens.border}`,
      borderRadius: "12px",
      boxShadow: tokens.shadowLg,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      color: tokens.foreground,
    });

    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) closeDrawer();
    });
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    activeDrawerOverlayEl = overlay;

    // Header
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "14px 18px",
      borderBottom: `1px solid ${tokens.border}`,
      backgroundColor: tokens.surface1,
      gap: "12px",
    });

    const titleWrap = document.createElement("div");
    Object.assign(titleWrap.style, {
      display: "flex",
      flexDirection: "column",
      gap: "3px",
    });

    const titleEl = document.createElement("div");
    titleEl.textContent = zh
      ? "Antigravity 子智能体树与级联对话巡检器 (/boost · Connected Sessions)"
      : "Antigravity Subagent Tree & Connected Sessions Inspector (/boost)";
    Object.assign(titleEl.style, {
      fontSize: "14px",
      fontWeight: "600",
      color: tokens.foreground,
    });

    const subtitleEl = document.createElement("div");
    subtitleEl.textContent = zh
      ? "正在加载级联子智能体树 (Root -> L1 -> L2) 与实时执行步数..."
      : "Loading multi-level subagent tree (Root -> L1 -> L2) and live step timelines...";
    Object.assign(subtitleEl.style, {
      fontSize: "12px",
      color: tokens.foregroundMuted,
    });

    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(subtitleEl);

    const headerActions = document.createElement("div");
    Object.assign(headerActions.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
    });

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.textContent = zh ? "刷新状态" : "Refresh";
    Object.assign(refreshBtn.style, {
      padding: "6px 11px",
      borderRadius: "6px",
      border: `1px solid ${tokens.border}`,
      backgroundColor: tokens.surface2,
      color: tokens.foreground,
      fontSize: "12px",
      fontWeight: "500",
      cursor: "pointer",
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = zh ? "关闭 (Esc)" : "Close (Esc)";
    Object.assign(closeBtn.style, {
      padding: "6px 11px",
      borderRadius: "6px",
      border: `1px solid ${tokens.border}`,
      backgroundColor: tokens.surface2,
      color: tokens.foreground,
      fontSize: "12px",
      fontWeight: "500",
      cursor: "pointer",
    });
    closeBtn.addEventListener("click", closeDrawer);

    headerActions.appendChild(refreshBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(titleWrap);
    header.appendChild(headerActions);
    modal.appendChild(header);

    // Body split: Left (Connected Session Tree) + Right (Selected Session Timeline)
    const body = document.createElement("div");
    Object.assign(body.style, {
      display: "flex",
      flex: "1",
      minHeight: "0",
      overflow: "hidden",
    });

    const leftPane = document.createElement("div");
    Object.assign(leftPane.style, {
      width: "340px",
      flexShrink: "0",
      borderRight: `1px solid ${tokens.border}`,
      backgroundColor: tokens.surface1,
      display: "flex",
      flexDirection: "column",
      overflowY: "auto",
      padding: "10px",
      gap: "8px",
    });

    const rightPane = document.createElement("div");
    Object.assign(rightPane.style, {
      flex: "1",
      display: "flex",
      flexDirection: "column",
      minWidth: "0",
      overflow: "hidden",
      backgroundColor: tokens.surface0,
    });

    body.appendChild(leftPane);
    body.appendChild(rightPane);
    modal.appendChild(body);

    let allTrees: SubagentAgentTree[] = [];
    let selectedTree: SubagentAgentTree | null = null;
    let selectedCid: string | null = opts?.conversationId ?? null;
    let timelineFilter: "all" | "messages" | "tools" = "all";

    const loadAndRender = async () => {
      subtitleEl.textContent = zh ? "正在同步最新 Transcript..." : "Syncing transcripts...";
      const [focusedRes, listRes] = await Promise.all([
        routeAgentId
          ? client
              .call(manageSubagentsRpc, {
                action: "inspect",
                agentId: routeAgentId,
                includeTimeline: true,
                limit: 5,
                source: "drawer",
              })
              .catch(() => null)
          : Promise.resolve(null),
        client
          .call(manageSubagentsRpc, {
            action: "inspect",
            includeTimeline: true,
            limit: 15,
            source: "drawer",
          })
          .catch(() => null),
      ]);

      const mergedMap = new Map<string, SubagentAgentTree>();
      for (const tr of focusedRes?.trees ?? []) {
        if (tr.agentId) mergedMap.set(tr.agentId, tr);
      }
      for (const tr of listRes?.trees ?? []) {
        if (tr.agentId && !mergedMap.has(tr.agentId)) {
          mergedMap.set(tr.agentId, tr);
        }
      }
      allTrees = Array.from(mergedMap.values());
      for (const tr of allTrees) {
        treeCacheByAgent.set(tr.agentId, { tree: tr, fetchedAtMs: Date.now() });
      }

      if (!selectedTree) {
        if (opts?.conversationId) {
          selectedTree =
            allTrees.find(
              (t) =>
                t.rootConversationId.startsWith(opts.conversationId!) ||
                t.flatSubagents.some((s) => s.conversationId.startsWith(opts.conversationId!)),
            ) ?? null;
        }
        if (!selectedTree && routeAgentId) {
          selectedTree =
            allTrees.find(
              (t) => t.agentId === routeAgentId || t.agentId.startsWith(routeAgentId),
            ) ?? null;
        }
        if (!selectedTree) {
          selectedTree = allTrees[0] ?? null;
        }
      } else {
        selectedTree =
          allTrees.find((t) => t.agentId === selectedTree!.agentId) ?? allTrees[0] ?? null;
      }

      if (selectedTree && !selectedCid) {
        selectedCid =
          selectedTree.flatSubagents[0]?.conversationId ?? selectedTree.rootConversationId;
      }

      const totalSubs = allTrees.reduce((acc, t) => acc + t.subagentSummary.total, 0);
      const runningSubs = allTrees.reduce((acc, t) => acc + t.subagentSummary.running, 0);
      subtitleEl.textContent = zh
        ? `已发现 ${allTrees.length} 个包含子智能体的主会话 · 共 ${totalSubs} 个子智能体 (运行中: ${runningSubs})`
        : `${allTrees.length} root sessions with subagents · ${totalSubs} total subagents (Running: ${runningSubs})`;

      renderPanes();
    };

    const renderPanes = () => {
      leftPane.innerHTML = "";
      rightPane.innerHTML = "";

      if (allTrees.length === 0 || !selectedTree) {
        const emptyEl = document.createElement("div");
        emptyEl.textContent = zh
          ? "当前暂无包含子智能体 (invoke_subagent / /boost) 的会话记录。"
          : "No sessions with Antigravity subagents found yet.";
        Object.assign(emptyEl.style, {
          padding: "24px",
          fontSize: "13px",
          color: tokens.foregroundMuted,
        });
        rightPane.appendChild(emptyEl);
        return;
      }

      // Left pane: Tree selector + Hierarchical session nodes
      for (const tree of allTrees) {
        const isCurrentTree = tree.agentId === selectedTree.agentId;
        const treeGroup = document.createElement("div");
        Object.assign(treeGroup.style, {
          border: `1px solid ${isCurrentTree ? tokens.accent : tokens.border}`,
          borderRadius: "8px",
          backgroundColor: tokens.surface0,
          overflow: "hidden",
          flexShrink: "0",
        });

        const groupHeader = document.createElement("div");
        Object.assign(groupHeader.style, {
          padding: "9px 11px",
          cursor: "pointer",
          backgroundColor: isCurrentTree ? tokens.surface2 : tokens.surface0,
          borderBottom: isCurrentTree ? `1px solid ${tokens.border}` : "none",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        });

        const topRow = document.createElement("div");
        Object.assign(topRow.style, {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "6px",
        });

        const wsBadge = document.createElement("span");
        wsBadge.textContent = tree.workspaceName || tree.title;
        Object.assign(wsBadge.style, {
          fontSize: "12px",
          fontWeight: "600",
          color: tokens.foreground,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        });

        const sumCol = statusColors(
          tree.subagentSummary.running > 0
            ? "running"
            : tree.subagentSummary.failed > 0
              ? "failed"
              : "completed",
          tokens,
        );
        const countPill = document.createElement("span");
        countPill.textContent = `${tree.subagentSummary.total} sub · ${tree.subagentSummary.totalSubagentSteps} steps`;
        Object.assign(countPill.style, {
          fontSize: "10.5px",
          fontWeight: "600",
          padding: "2px 6px",
          borderRadius: "999px",
          backgroundColor: sumCol.bg,
          color: sumCol.fg,
          border: `1px solid ${sumCol.border}`,
          flexShrink: "0",
        });

        topRow.appendChild(wsBadge);
        topRow.appendChild(countPill);

        const subRow = document.createElement("div");
        subRow.textContent = `${tree.model} · Root ${tree.rootStepCount} steps`;
        Object.assign(subRow.style, {
          fontSize: "11px",
          color: tokens.foregroundMuted,
        });

        groupHeader.appendChild(topRow);
        groupHeader.appendChild(subRow);
        groupHeader.addEventListener("click", () => {
          selectedTree = tree;
          selectedCid =
            tree.flatSubagents[0]?.conversationId ?? tree.rootConversationId;
          renderPanes();
        });
        treeGroup.appendChild(groupHeader);

        if (isCurrentTree) {
          const nodesList = document.createElement("div");
          Object.assign(nodesList.style, {
            display: "flex",
            flexDirection: "column",
            padding: "6px",
            gap: "4px",
          });

          // 1. Root Session row
          const isRootSelected = selectedCid === tree.rootConversationId;
          const rootRow = document.createElement("div");
          rootRow.setAttribute(
            "data-testid",
            `paseo-finder-subagent-node-${tree.rootConversationId}`,
          );
          Object.assign(rootRow.style, {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "7px 9px",
            borderRadius: "6px",
            cursor: "pointer",
            backgroundColor: isRootSelected ? tokens.surface2 : "transparent",
            border: isRootSelected
              ? `1px solid ${tokens.accent}`
              : "1px solid transparent",
          });

          const rootLabel = document.createElement("div");
          rootLabel.textContent = zh
            ? `Root 主会话 (${tree.rootConversationId.slice(0, 8)})`
            : `Root Session (${tree.rootConversationId.slice(0, 8)})`;
          Object.assign(rootLabel.style, {
            fontSize: "12px",
            fontWeight: isRootSelected ? "600" : "500",
            color: tokens.foreground,
          });

          const rootMeta = document.createElement("span");
          rootMeta.textContent = `${tree.rootStepCount} steps`;
          Object.assign(rootMeta.style, {
            fontSize: "11px",
            color: tokens.foregroundMuted,
          });

          rootRow.appendChild(rootLabel);
          rootRow.appendChild(rootMeta);
          rootRow.addEventListener("click", () => {
            selectedCid = tree.rootConversationId;
            renderPanes();
          });
          nodesList.appendChild(rootRow);

          // 2. Child Subagent rows (L1, L2, L3)
          for (const sub of tree.flatSubagents) {
            const isSelected =
              selectedCid === sub.conversationId ||
              (selectedCid && sub.conversationId.startsWith(selectedCid));
            const sc = statusColors(sub.status, tokens);
            const nodeRow = document.createElement("div");
            nodeRow.setAttribute(
              "data-testid",
              `paseo-finder-subagent-node-${sub.conversationId}`,
            );
            const indentPx = Math.min(36, Math.max(1, sub.depth) * 14);
            Object.assign(nodeRow.style, {
              display: "flex",
              flexDirection: "column",
              gap: "3px",
              padding: "7px 9px",
              marginLeft: `${indentPx}px`,
              borderRadius: "6px",
              cursor: "pointer",
              backgroundColor: isSelected ? tokens.surface2 : "transparent",
              border: isSelected
                ? `1px solid ${tokens.accent}`
                : `1px solid ${tokens.border}`,
            });

            const r1 = document.createElement("div");
            Object.assign(r1.style, {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "6px",
            });

            const nameSpan = document.createElement("span");
            nameSpan.textContent = `L${sub.depth} · ${sub.subAgentType}`;
            Object.assign(nameSpan.style, {
              fontSize: "12px",
              fontWeight: "600",
              color: tokens.foreground,
            });

            const statusBadge = document.createElement("span");
            statusBadge.textContent = `${formatStatusLabel(sub.status, zh)} · ${sub.stepCount} steps`;
            Object.assign(statusBadge.style, {
              fontSize: "10.5px",
              fontWeight: "600",
              padding: "1px 6px",
              borderRadius: "999px",
              backgroundColor: sc.bg,
              color: sc.fg,
              border: `1px solid ${sc.border}`,
              flexShrink: "0",
            });

            r1.appendChild(nameSpan);
            r1.appendChild(statusBadge);
            nodeRow.appendChild(r1);

            if (sub.role) {
              const roleEl = document.createElement("div");
              roleEl.textContent = sub.role;
              Object.assign(roleEl.style, {
                fontSize: "11px",
                color: tokens.foregroundMuted,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              });
              nodeRow.appendChild(roleEl);
            }

            nodeRow.addEventListener("click", () => {
              selectedCid = sub.conversationId;
              renderPanes();
            });
            nodesList.appendChild(nodeRow);
          }

          treeGroup.appendChild(nodesList);
        }

        leftPane.appendChild(treeGroup);
      }

      // Right pane: Selected Session Inspector
      const activeSub =
        selectedTree.flatSubagents.find(
          (s) =>
            s.conversationId === selectedCid ||
            (selectedCid && s.conversationId.startsWith(selectedCid)),
        ) ?? null;
      const isInspectingRoot = !activeSub;
      const currentCid = activeSub
        ? activeSub.conversationId
        : selectedTree.rootConversationId;
      const timelineItems: SubagentTimelineItem[] = activeSub
        ? activeSub.timeline ?? []
        : selectedTree.rootTimeline ?? [];

      const sessionHeader = document.createElement("div");
      Object.assign(sessionHeader.style, {
        padding: "14px 18px",
        borderBottom: `1px solid ${tokens.border}`,
        backgroundColor: tokens.surface1,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      });

      const topInfoRow = document.createElement("div");
      Object.assign(topInfoRow.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        flexWrap: "wrap",
      });

      const sessionTitle = document.createElement("div");
      sessionTitle.textContent = activeSub
        ? `L${activeSub.depth} ${activeSub.subAgentType}${activeSub.role ? ` — ${activeSub.role}` : ""}`
        : zh
          ? `Root 主会话 — ${selectedTree.title}`
          : `Root Session — ${selectedTree.title}`;
      Object.assign(sessionTitle.style, {
        fontSize: "14px",
        fontWeight: "600",
        color: tokens.foreground,
      });

      const actionBtnsWrap = document.createElement("div");
      Object.assign(actionBtnsWrap.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
      });

      if (activeSub?.transcriptPath) {
        const revealBtn = document.createElement("button");
        revealBtn.type = "button";
        revealBtn.textContent = zh ? "在 Finder 中定位日志" : "Reveal Transcript in Finder";
        Object.assign(revealBtn.style, {
          padding: "5px 10px",
          borderRadius: "6px",
          border: `1px solid ${tokens.border}`,
          backgroundColor: tokens.surface2,
          color: tokens.foreground,
          fontSize: "11.5px",
          cursor: "pointer",
        });
        revealBtn.addEventListener("click", () => {
          void client.call(openFileTargetRpc, {
            path: activeSub.transcriptPath,
            target: "finder-reveal" as OpenerTarget,
          });
        });
        actionBtnsWrap.appendChild(revealBtn);
      }

      if (activeSub) {
        const nativeTabBtn = document.createElement("button");
        nativeTabBtn.type = "button";
        nativeTabBtn.textContent = zh ? "在 Paseo 原生标签页打开 ↗" : "Open Native Paseo Tab ↗";
        Object.assign(nativeTabBtn.style, {
          padding: "5px 10px",
          borderRadius: "6px",
          border: `1px solid ${tokens.accent}`,
          backgroundColor: tokens.surface2,
          color: tokens.foreground,
          fontSize: "11.5px",
          fontWeight: "500",
          cursor: "pointer",
        });
        nativeTabBtn.addEventListener("click", () => {
          const clicked = tryClickNativeSubagentTrackRow(activeSub.conversationId);
          if (clicked) {
            closeDrawer();
          }
        });
        actionBtnsWrap.appendChild(nativeTabBtn);
      }

      if (extractCurrentRouteAgentId(window.location?.pathname) !== selectedTree.agentId) {
        const jumpAgentBtn = document.createElement("button");
        jumpAgentBtn.type = "button";
        jumpAgentBtn.textContent = zh ? "跳转到该主会话 ↗" : "Jump to Root Agent ↗";
        Object.assign(jumpAgentBtn.style, {
          padding: "5px 10px",
          borderRadius: "6px",
          border: `1px solid ${tokens.border}`,
          backgroundColor: tokens.primary,
          color: tokens.primaryForeground,
          fontSize: "11.5px",
          fontWeight: "500",
          cursor: "pointer",
        });
        jumpAgentBtn.addEventListener("click", () => {
          closeDrawer();
          window.history.pushState({}, "", `/ag/${selectedTree!.agentId}`);
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
        actionBtnsWrap.appendChild(jumpAgentBtn);
      }

      topInfoRow.appendChild(sessionTitle);
      topInfoRow.appendChild(actionBtnsWrap);
      sessionHeader.appendChild(topInfoRow);

      // Metadata + Connected Sessions Navigation Bar
      const metaRow = document.createElement("div");
      Object.assign(metaRow.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        flexWrap: "wrap",
      });

      const metaStats = document.createElement("div");
      const stepCnt = activeSub ? activeSub.stepCount : selectedTree.rootStepCount;
      const toolCnt = activeSub ? activeSub.toolCallCount : selectedTree.rootToolCallCount;
      metaStats.textContent = `Conversation ID: ${currentCid} · Steps: ${stepCnt} · Tools: ${toolCnt}${
        activeSub?.lastToolName ? ` · Last Tool: ${activeSub.lastToolName}` : ""
      }`;
      Object.assign(metaStats.style, {
        fontSize: "11.5px",
        color: tokens.foregroundMuted,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      });

      const filterWrap = document.createElement("div");
      Object.assign(filterWrap.style, {
        display: "flex",
        alignItems: "center",
        gap: "4px",
      });

      const filters: { key: "all" | "messages" | "tools"; label: string }[] = [
        { key: "all", label: zh ? `全部 (${timelineItems.length})` : `All (${timelineItems.length})` },
        {
          key: "messages",
          label: zh
            ? `消息与汇报 (${timelineItems.filter((i) => i.type !== "tool_call").length})`
            : `Messages (${timelineItems.filter((i) => i.type !== "tool_call").length})`,
        },
        {
          key: "tools",
          label: zh
            ? `工具调用 (${timelineItems.filter((i) => i.type === "tool_call").length})`
            : `Tools (${timelineItems.filter((i) => i.type === "tool_call").length})`,
        },
      ];

      for (const f of filters) {
        const fBtn = document.createElement("button");
        fBtn.type = "button";
        fBtn.textContent = f.label;
        const active = timelineFilter === f.key;
        Object.assign(fBtn.style, {
          padding: "3px 8px",
          borderRadius: "6px",
          fontSize: "11px",
          fontWeight: active ? "600" : "500",
          cursor: "pointer",
          border: `1px solid ${active ? tokens.accent : tokens.border}`,
          backgroundColor: active ? tokens.surface2 : tokens.surface0,
          color: tokens.foreground,
        });
        fBtn.addEventListener("click", () => {
          timelineFilter = f.key;
          renderPanes();
        });
        filterWrap.appendChild(fBtn);
      }

      metaRow.appendChild(metaStats);
      metaRow.appendChild(filterWrap);
      sessionHeader.appendChild(metaRow);

      // Connected Parent / Child Quick Jump Chips
      const connectedRow = document.createElement("div");
      Object.assign(connectedRow.style, {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        flexWrap: "wrap",
      });

      if (activeSub) {
        const parentCid = activeSub.parentConversationId;
        const parentNode = selectedTree.flatSubagents.find(
          (s) => s.conversationId === parentCid,
        );
        const parentChip = document.createElement("button");
        parentChip.type = "button";
        parentChip.textContent = parentNode
          ? `↑ Parent: L${parentNode.depth} ${parentNode.subAgentType}`
          : zh
            ? "↑ 返回 Root 主会话"
            : "↑ Back to Root Session";
        Object.assign(parentChip.style, {
          padding: "3px 8px",
          borderRadius: "999px",
          fontSize: "11px",
          cursor: "pointer",
          border: `1px solid ${tokens.border}`,
          backgroundColor: tokens.surface2,
          color: tokens.foreground,
        });
        parentChip.addEventListener("click", () => {
          selectedCid = parentCid;
          renderPanes();
        });
        connectedRow.appendChild(parentChip);
      }

      const directChildren = selectedTree.flatSubagents.filter(
        (s) => s.parentConversationId === currentCid,
      );
      for (const child of directChildren) {
        const cCol = statusColors(child.status, tokens);
        const childChip = document.createElement("button");
        childChip.type = "button";
        childChip.textContent = `↳ L${child.depth} ${child.subAgentType} (${formatStatusLabel(
          child.status,
          zh,
        )} · ${child.stepCount} steps)`;
        Object.assign(childChip.style, {
          padding: "3px 9px",
          borderRadius: "999px",
          fontSize: "11px",
          fontWeight: "600",
          cursor: "pointer",
          border: `1px solid ${cCol.border}`,
          backgroundColor: cCol.bg,
          color: cCol.fg,
        });
        childChip.addEventListener("click", () => {
          selectedCid = child.conversationId;
          renderPanes();
        });
        connectedRow.appendChild(childChip);
      }

      if (connectedRow.childNodes.length > 0) {
        sessionHeader.appendChild(connectedRow);
      }
      rightPane.appendChild(sessionHeader);

      // Timeline Scroll Container
      const timelineScroll = document.createElement("div");
      Object.assign(timelineScroll.style, {
        flex: "1",
        overflowY: "auto",
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      });

      const filteredItems = timelineItems.filter((item) => {
        if (timelineFilter === "messages") return item.type !== "tool_call";
        if (timelineFilter === "tools") return item.type === "tool_call";
        return true;
      });

      if (filteredItems.length === 0) {
        const emptyTl = document.createElement("div");
        emptyTl.textContent = isInspectingRoot
          ? zh
            ? "点击左侧任一 L1 / L2 子智能体节点可查看其完整执行轨迹。"
            : "Select any L1 / L2 subagent node on the left to inspect its timeline."
          : zh
            ? "该筛选条件下暂无步骤记录。"
            : "No timeline items match the current filter.";
        Object.assign(emptyTl.style, {
          fontSize: "12.5px",
          color: tokens.foregroundMuted,
          padding: "16px 0",
        });
        timelineScroll.appendChild(emptyTl);
      }

      for (const item of filteredItems) {
        if (item.type === "tool_call") {
          const tcRow = document.createElement("div");
          const isSubCall = Boolean(item.childConversationId);
          Object.assign(tcRow.style, {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            padding: "7px 11px",
            borderRadius: "7px",
            backgroundColor: tokens.surface1,
            border: `1px solid ${isSubCall ? tokens.accent : tokens.border}`,
            cursor: isSubCall ? "pointer" : "default",
          });

          const leftInfo = document.createElement("div");
          Object.assign(leftInfo.style, {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            minWidth: "0",
            flex: "1",
          });

          const stepTag = document.createElement("span");
          stepTag.textContent = `#${item.stepIndex}`;
          Object.assign(stepTag.style, {
            fontSize: "10.5px",
            color: tokens.foregroundMuted,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            flexShrink: "0",
          });

          const toolName = document.createElement("span");
          toolName.textContent = item.subAgentType
            ? `invoke_subagent (${item.subAgentType})`
            : item.name || "tool_call";
          Object.assign(toolName.style, {
            fontSize: "11.5px",
            fontWeight: "600",
            color: tokens.foreground,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            flexShrink: "0",
          });

          const sumText = document.createElement("span");
          sumText.textContent = item.summary || "";
          Object.assign(sumText.style, {
            fontSize: "11.5px",
            color: tokens.foregroundMuted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          });

          leftInfo.appendChild(stepTag);
          leftInfo.appendChild(toolName);
          leftInfo.appendChild(sumText);
          tcRow.appendChild(leftInfo);

          if (item.childConversationId) {
            const jumpSubBtn = document.createElement("span");
            jumpSubBtn.textContent = zh ? "切入子智能体对话 →" : "Inspect Subagent →";
            Object.assign(jumpSubBtn.style, {
              fontSize: "11px",
              fontWeight: "600",
              color: tokens.accent,
              flexShrink: "0",
            });
            tcRow.appendChild(jumpSubBtn);
            tcRow.addEventListener("click", () => {
              selectedCid = item.childConversationId!;
              renderPanes();
            });
          }

          timelineScroll.appendChild(tcRow);
          continue;
        }

        // User or Assistant Message card
        const isUser = item.type === "user_message";
        const msgCard = document.createElement("div");
        Object.assign(msgCard.style, {
          padding: "11px 14px",
          borderRadius: "8px",
          backgroundColor: isUser ? tokens.surface2 : tokens.surface1,
          border: `1px solid ${tokens.border}`,
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        });

        const msgHeader = document.createElement("div");
        Object.assign(msgHeader.style, {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "11px",
          fontWeight: "600",
          color: tokens.foregroundMuted,
        });
        msgHeader.textContent = isUser
          ? item.sender
            ? `Task / Message from ${item.sender.slice(0, 8)} · Step #${item.stepIndex}`
            : `User / Task Prompt · Step #${item.stepIndex}`
          : `Subagent Response / Report · Step #${item.stepIndex}`;

        const msgBody = document.createElement("div");
        msgBody.textContent = item.text || "";
        Object.assign(msgBody.style, {
          fontSize: "12.5px",
          lineHeight: "1.55",
          color: tokens.foreground,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: "340px",
          overflowY: "auto",
        });

        msgCard.appendChild(msgHeader);
        msgCard.appendChild(msgBody);
        timelineScroll.appendChild(msgCard);
      }

      rightPane.appendChild(timelineScroll);
    };

    refreshBtn.addEventListener("click", () => {
      void loadAndRender();
    });

    await loadAndRender();
  };

  externalOpenDrawerFn = (opts) => {
    void openDrawer(opts);
  };

  // Decorate inline `[data-testid="tool-call-badge"]` rows for `🤖 DeepCoder` / subagents
  // and render Connected Subagents Bar above composer when viewing `/ag/<agentId>`
  const decorateActiveAgentSubagentsDom = (tree: SubagentAgentTree | null) => {
    const zh = isZh();
    const tokens = syncPaseoThemeCssVariables(document as never, window as never);
    const currentAgentId = extractCurrentRouteAgentId(window.location?.pathname);

    // 1. Remove stale Connected Subagents Bar if agent changed or has no subagents
    const existingBar = document.querySelector<HTMLElement>(
      '[data-testid="paseo-finder-subagents-bar"]',
    );
    if (!currentAgentId || !tree || tree.subagentSummary.total === 0) {
      existingBar?.remove();
    } else {
      // Mount or update Connected Subagents Bar right above the composer (or inside subagents-track area)
      const composer = document.querySelector<HTMLElement>('[data-testid="agent-composer"]');
      const hostParent = composer?.parentElement ?? null;
      if (hostParent && composer) {
        let bar = existingBar;
        if (!bar || bar.parentElement !== hostParent) {
          existingBar?.remove();
          bar = document.createElement("div");
          bar.setAttribute("data-testid", "paseo-finder-subagents-bar");
          hostParent.insertBefore(bar, composer);
        }

        const sig = `${tree.agentId}:${tree.subagentSummary.total}:${tree.subagentSummary.running}:${tree.subagentSummary.totalSubagentSteps}:${zh}`;
        if (bar.getAttribute("data-render-sig") !== sig) {
          bar.setAttribute("data-render-sig", sig);
          bar.innerHTML = "";
          Object.assign(bar.style, {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            flexWrap: "wrap",
            margin: "0 16px 8px 16px",
            padding: "7px 11px",
            borderRadius: "8px",
            backgroundColor: tokens.surface1,
            border: `1px solid ${tokens.border}`,
            fontFamily:
              'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          });

          const leftSide = document.createElement("div");
          Object.assign(leftSide.style, {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexWrap: "wrap",
          });

          const labelEl = document.createElement("span");
          labelEl.textContent = zh
            ? `级联子智能体树 (${tree.subagentSummary.total} 个会话 · 共 ${tree.subagentSummary.totalSubagentSteps} 步):`
            : `Connected Subagents (${tree.subagentSummary.total} sessions · ${tree.subagentSummary.totalSubagentSteps} steps):`;
          Object.assign(labelEl.style, {
            fontSize: "11.5px",
            fontWeight: "600",
            color: tokens.foregroundMuted,
          });
          leftSide.appendChild(labelEl);

          for (const sub of tree.flatSubagents) {
            const sc = statusColors(sub.status, tokens);
            const pill = document.createElement("button");
            pill.type = "button";
            pill.setAttribute(
              "data-testid",
              `paseo-finder-subagent-pill-${sub.conversationId.slice(0, 8)}`,
            );
            pill.textContent = `L${sub.depth} ${sub.subAgentType} · ${formatStatusLabel(
              sub.status,
              zh,
            )} (${sub.stepCount} steps)`;
            Object.assign(pill.style, {
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 8px",
              borderRadius: "999px",
              fontSize: "11px",
              fontWeight: "600",
              cursor: "pointer",
              backgroundColor: sc.bg,
              color: sc.fg,
              border: `1px solid ${sc.border}`,
            });
            pill.addEventListener("click", (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              if (ev.altKey && tryClickNativeSubagentTrackRow(sub.conversationId)) {
                return;
              }
              void openDrawer({
                agentId: tree.agentId,
                conversationId: sub.conversationId,
              });
            });
            leftSide.appendChild(pill);
          }

          const openTreeBtn = document.createElement("button");
          openTreeBtn.type = "button";
          openTreeBtn.textContent = zh ? "展开完整对话树 (⌘⇧B) ↗" : "Inspect Full Tree (⌘⇧B) ↗";
          Object.assign(openTreeBtn.style, {
            padding: "3px 9px",
            borderRadius: "6px",
            fontSize: "11px",
            fontWeight: "600",
            cursor: "pointer",
            backgroundColor: tokens.surface2,
            color: tokens.foreground,
            border: `1px solid ${tokens.border}`,
            flexShrink: "0",
          });
          openTreeBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            void openDrawer({ agentId: tree.agentId });
          });

          bar.appendChild(leftSide);
          bar.appendChild(openTreeBtn);
        }
      }
    }

    // 2. Decorate inline `[data-testid="tool-call-badge"]` rows for `🤖 DeepCoder` etc.
    const badges = document.querySelectorAll<HTMLElement>('[data-testid="tool-call-badge"]');
    let subCallOccurrenceIdx = 0;
    const l1Subagents = (tree?.flatSubagents ?? []).filter((s) => s.depth === 1);

    for (let i = 0; i < badges.length; i += 1) {
      const badge = badges[i];
      if (!badge) continue;
      const rawText = (badge.textContent ?? "").trim();
      const hasRobotPrefix = rawText.startsWith("🤖");
      const cleanedName = rawText.replace(/^🤖\s*/, "").split(/\s+/)[0]?.toLowerCase() ?? "";
      if (!hasRobotPrefix && !KNOWN_SUBAGENT_TYPES.has(cleanedName)) {
        continue;
      }

      const matchedSub =
        l1Subagents[subCallOccurrenceIdx] ??
        tree?.flatSubagents.find(
          (s) => s.subAgentType.toLowerCase() === cleanedName,
        ) ??
        null;
      subCallOccurrenceIdx += 1;

      badge.style.cursor = "pointer";
      const existingChip = badge.querySelector<HTMLElement>(
        '[data-testid="paseo-finder-inline-subagent-chip"]',
      );
      const chipSig = matchedSub
        ? `${matchedSub.conversationId}:${matchedSub.status}:${matchedSub.stepCount}:${matchedSub.nestedSubagentCount}:${zh}`
        : `generic:${cleanedName}:${zh}`;

      if (existingChip && existingChip.getAttribute("data-sig") === chipSig) {
        continue;
      }
      existingChip?.remove();

      const chip = document.createElement("span");
      chip.setAttribute("data-testid", "paseo-finder-inline-subagent-chip");
      chip.setAttribute("data-sig", chipSig);

      if (matchedSub) {
        const sc = statusColors(matchedSub.status, tokens);
        const nestedPart =
          matchedSub.nestedSubagentCount > 0
            ? zh
              ? ` · 派生 ${matchedSub.nestedSubagentCount} 个子智能体 (共 ${tree?.subagentSummary.totalSubagentSteps ?? matchedSub.stepCount} 步)`
              : ` · +${matchedSub.nestedSubagentCount} nested (${tree?.subagentSummary.totalSubagentSteps ?? matchedSub.stepCount} total steps)`
            : "";
        chip.textContent = `${formatStatusLabel(matchedSub.status, zh)} · ${matchedSub.stepCount} steps${nestedPart} · ${
          zh ? "点击查看对话树 ↗" : "Inspect Session Tree ↗"
        }`;
        Object.assign(chip.style, {
          display: "inline-flex",
          alignItems: "center",
          marginLeft: "8px",
          padding: "2px 8px",
          borderRadius: "999px",
          fontSize: "11px",
          fontWeight: "600",
          backgroundColor: sc.bg,
          color: sc.fg,
          border: `1px solid ${sc.border}`,
          cursor: "pointer",
          userSelect: "none",
        });
      } else {
        chip.textContent = zh ? "点击查看子智能体对话树 ↗" : "Inspect Subagent Tree ↗";
        Object.assign(chip.style, {
          display: "inline-flex",
          alignItems: "center",
          marginLeft: "8px",
          padding: "2px 8px",
          borderRadius: "999px",
          fontSize: "11px",
          fontWeight: "600",
          backgroundColor: tokens.surface2,
          color: tokens.foreground,
          border: `1px solid ${tokens.border}`,
          cursor: "pointer",
          userSelect: "none",
        });
      }

      if (badge.getAttribute("data-paseo-finder-subagent-bound") !== "true") {
        badge.setAttribute("data-paseo-finder-subagent-bound", "true");
        badge.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const agId = extractCurrentRouteAgentId(window.location?.pathname);
          const curTree = agId ? treeCacheByAgent.get(agId)?.tree ?? null : null;
          const targetSub =
            curTree?.flatSubagents.find(
              (s) => s.subAgentType.toLowerCase() === cleanedName,
            ) ?? curTree?.flatSubagents[0];
          if (ev.altKey && targetSub && tryClickNativeSubagentTrackRow(targetSub.conversationId)) {
            return;
          }
          void openDrawer({
            agentId: agId,
            conversationId: targetSub?.conversationId ?? null,
          });
        });
      }

      badge.appendChild(chip);
    }
  };

  const syncCurrentAgentSubagents = () => {
    const agId = extractCurrentRouteAgentId(window.location?.pathname);
    if (!agId) {
      lastRouteAgentId = null;
      decorateActiveAgentSubagentsDom(null);
      return;
    }
    const force = agId !== lastRouteAgentId;
    lastRouteAgentId = agId;
    const cached = treeCacheByAgent.get(agId)?.tree ?? null;
    if (cached) {
      decorateActiveAgentSubagentsDom(cached);
    }
    void fetchAgentTree(agId, force, false).then((tree) => {
      if (extractCurrentRouteAgentId(window.location?.pathname) === agId) {
        decorateActiveAgentSubagentsDom(tree);
      }
    });
  };

  const observer = new MutationObserver(() => {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      syncCurrentAgentSubagents();
    });
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  pollIntervalId = setInterval(() => {
    const agId = extractCurrentRouteAgentId(window.location?.pathname);
    if (!agId) return;
    const cached = treeCacheByAgent.get(agId)?.tree;
    const hasUnmatchedBadge = Boolean(
      document.querySelector('[data-testid="tool-call-badge"]'),
    );
    if (cached?.subagentSummary.running || (hasUnmatchedBadge && !cached)) {
      void fetchAgentTree(agId, true, false).then((tree) => {
        if (extractCurrentRouteAgentId(window.location?.pathname) === agId) {
          decorateActiveAgentSubagentsDom(tree);
        }
      });
    }
  }, 3_000);

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && activeDrawerOverlayEl) {
      ev.preventDefault();
      ev.stopPropagation();
      closeDrawer();
      return;
    }
    // Cmd+Shift+B (Ctrl+Shift+B) opens the Subagent Tree & /boost Connected Sessions Drawer
    if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "b") {
      ev.preventDefault();
      ev.stopPropagation();
      if (activeDrawerOverlayEl) {
        closeDrawer();
      } else {
        void openDrawer({
          agentId: extractCurrentRouteAgentId(window.location?.pathname),
        });
      }
    }
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("popstate", syncCurrentAgentSubagents, false);
  setTimeout(syncCurrentAgentSubagents, 80);

  return () => {
    externalOpenDrawerFn = null;
    closeDrawer();
    observer.disconnect();
    if (pollIntervalId) clearInterval(pollIntervalId);
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("popstate", syncCurrentAgentSubagents, false);
  };
}
