/// <reference lib="dom" />
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  type FlatSubagentNode,
  type OpenerTarget,
  type SubagentAgentTree,
  type SubagentTimelineItem,
  type SubagentTimerOrTaskNode,
  manageSubagentsRpc,
  openFileTargetRpc,
} from "../shared/contracts";
import { isChineseLocale } from "./i18n";
import { extractCurrentWorkspaceAndAgent } from "./session-lineage-web";
import { syncPaseoThemeCssVariables } from "./theme-web";
import { focusWorkspaceInApp } from "./web";

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
  "browser_subagent",
]);

const DRAWER_MODE_STORAGE_KEY = "paseo:finder-plugin:subagents-drawer-mode";
const LEFT_SIDEBAR_COLLAPSED_KEY = "paseo:finder-plugin:left-sidebar-subagents-collapsed";

export type SubagentDrawerLayoutMode = "docked-right" | "wide-modal";

let externalOpenDrawerFn:
  | ((opts?: {
      agentId?: string | null;
      workspaceId?: string | null;
      conversationId?: string | null;
      layoutMode?: SubagentDrawerLayoutMode;
    }) => void)
  | null = null;

export function triggerSubagentsTreeDrawer(opts?: {
  agentId?: string | null;
  workspaceId?: string | null;
  conversationId?: string | null;
  layoutMode?: SubagentDrawerLayoutMode;
}): void {
  externalOpenDrawerFn?.(opts);
}

export function extractCurrentRouteAgentId(pathname?: string | null): string | null {
  const raw = (pathname ?? "").trim();
  const m = raw.match(/\/ag\/([A-Za-z0-9-]{8,})/);
  return m ? m[1] : null;
}

export function normalizeWorkspaceKey(workspaceId?: string | null): string | null {
  const raw = (workspaceId ?? "").trim();
  if (!raw) return null;
  const idx = raw.indexOf(":");
  return idx >= 0 ? raw.slice(idx + 1).trim() || null : raw;
}

function readDrawerLayoutMode(): SubagentDrawerLayoutMode {
  try {
    const v = window.localStorage?.getItem(DRAWER_MODE_STORAGE_KEY);
    if (v === "wide-modal" || v === "docked-right") return v;
  } catch {
    // ignore
  }
  return "docked-right";
}

function writeDrawerLayoutMode(mode: SubagentDrawerLayoutMode): void {
  try {
    window.localStorage?.setItem(DRAWER_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

function formatStatusLabel(status: string, isZh: boolean): string {
  if (status === "running") return isZh ? "运行中" : "Running";
  if (status === "failed") return isZh ? "失败" : "Failed";
  if (status === "canceled") return isZh ? "已取消" : "Canceled";
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
  if (status === "canceled") {
    return {
      fg: tokens.foregroundMuted,
      bg: tokens.surface2,
      border: tokens.border,
      dot: tokens.foregroundMuted,
    };
  }
  return {
    fg: tokens.statusSuccess,
    bg: tokens.statusSuccessTint,
    border: `${tokens.statusSuccess}55`,
    dot: tokens.statusSuccess,
  };
}

function classifyToolCallBadgeText(
  rawText: string,
  tree: SubagentAgentTree | null,
): {
  kind: "subagent" | "timer" | "task" | "message" | null;
  subagentName?: string;
} {
  const trimmed = rawText.trim();
  if (!trimmed) return { kind: null };
  const robotPrefix = "\u{1F916}";
  const hasRobotPrefix = trimmed.startsWith(robotPrefix);
  const withoutRobot = trimmed.replace(/^\u{1F916}\s*/u, "").trim();
  const firstToken = withoutRobot.split(/[\s*:]+/)[0]?.toLowerCase() ?? "";

  if (hasRobotPrefix || KNOWN_SUBAGENT_TYPES.has(firstToken)) {
    return { kind: "subagent", subagentName: firstToken };
  }
  if (
    tree?.flatSubagents.some(
      (s) => s.subAgentType.toLowerCase() === firstToken && firstToken.length >= 2,
    )
  ) {
    return { kind: "subagent", subagentName: firstToken };
  }
  if (/^Timer\s*\(/i.test(withoutRobot) || /^schedule\b/i.test(withoutRobot)) {
    return { kind: "timer" };
  }
  if (/^Task\s*\(/i.test(withoutRobot) || /^manage_task\b/i.test(withoutRobot)) {
    return { kind: "task" };
  }
  if (/^Send message\s*->/i.test(withoutRobot) || /^send_message\b/i.test(withoutRobot)) {
    return { kind: "message" };
  }
  return { kind: null };
}

export function installDesktopSubagentsTreeEnhancer(
  client: SubagentsTreeWebClient,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const treeCacheByKey = new Map<
    string,
    {
      tree: SubagentAgentTree | null;
      fetchedAtMs: number;
      inFlight?: Promise<SubagentAgentTree | null>;
    }
  >();
  let lastScopeKey: string | null = null;
  let activeDrawerOverlayEl: HTMLElement | null = null;
  let activeDrawerRefreshFn: (() => Promise<void>) | null = null;
  let activeDrawerSelectSessionFn: ((cid: string) => void) | null = null;
  let pollIntervalId: ReturnType<typeof setInterval> | null = null;
  let rafId: number | null = null;
  let leftSidebarCollapsed = false;
  try {
    leftSidebarCollapsed = window.localStorage?.getItem(LEFT_SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    leftSidebarCollapsed = false;
  }

  const isZh = (): boolean => isChineseLocale(client.getLocale?.() ?? window.navigator?.language);

  const resolveActiveScope = (): {
    scopeKey: string | null;
    agentId: string | null;
    workspaceId: string | null;
  } => {
    const ctx = extractCurrentWorkspaceAndAgent(document, window);
    const agId = ctx.agentId ?? extractCurrentRouteAgentId(window.location?.pathname);
    const wsId = normalizeWorkspaceKey(ctx.workspaceId);
    const scopeKey = agId ? `ag:${agId}` : wsId ? `ws:${wsId}` : null;
    return { scopeKey, agentId: agId, workspaceId: wsId };
  };

  const cacheTreeUnderAllKeys = (tree: SubagentAgentTree | null, requestedKey?: string | null) => {
    const now = Date.now();
    if (requestedKey) {
      treeCacheByKey.set(requestedKey, { tree, fetchedAtMs: now });
    }
    if (tree) {
      if (tree.agentId) {
        treeCacheByKey.set(`ag:${tree.agentId}`, { tree, fetchedAtMs: now });
        treeCacheByKey.set(tree.agentId, { tree, fetchedAtMs: now });
      }
      const normWs = normalizeWorkspaceKey(tree.workspaceId);
      if (normWs) {
        treeCacheByKey.set(`ws:${normWs}`, { tree, fetchedAtMs: now });
      }
    }
  };

  const getCachedTreeForScope = (scope: {
    scopeKey: string | null;
    agentId: string | null;
    workspaceId: string | null;
  }): SubagentAgentTree | null => {
    if (scope.scopeKey && treeCacheByKey.get(scope.scopeKey)?.tree) {
      return treeCacheByKey.get(scope.scopeKey)!.tree;
    }
    if (scope.agentId && treeCacheByKey.get(`ag:${scope.agentId}`)?.tree) {
      return treeCacheByKey.get(`ag:${scope.agentId}`)!.tree;
    }
    if (scope.workspaceId && treeCacheByKey.get(`ws:${scope.workspaceId}`)?.tree) {
      return treeCacheByKey.get(`ws:${scope.workspaceId}`)!.tree;
    }
    return null;
  };

  const fetchScopeTree = async (
    scope: { scopeKey: string | null; agentId: string | null; workspaceId: string | null },
    force = false,
    includeTimeline = false,
  ): Promise<SubagentAgentTree | null> => {
    if (!scope.scopeKey) return null;
    const cached = treeCacheByKey.get(scope.scopeKey);
    const now = Date.now();
    const ttlMs = cached?.tree?.subagentSummary.running ? 2_500 : 10_000;
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
        agentId: scope.agentId ?? undefined,
        workspaceId: scope.workspaceId ?? undefined,
        includeTimeline,
        limit: 5,
        source: includeTimeline ? "drawer" : "timeline-inline",
      })
      .then((res) => {
        const matched =
          res.trees.find(
            (t) =>
              (scope.agentId &&
                (t.agentId === scope.agentId || t.agentId.startsWith(scope.agentId))) ||
              (scope.workspaceId && normalizeWorkspaceKey(t.workspaceId) === scope.workspaceId),
          ) ??
          res.trees[0] ??
          null;
        cacheTreeUnderAllKeys(matched, scope.scopeKey);
        return matched;
      })
      .catch(() => {
        const prev = getCachedTreeForScope(scope);
        cacheTreeUnderAllKeys(prev, scope.scopeKey);
        return prev;
      });

    treeCacheByKey.set(scope.scopeKey, {
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
      activeDrawerRefreshFn = null;
      activeDrawerSelectSessionFn = null;
    }
  };

  const openDrawer = async (opts?: {
    agentId?: string | null;
    workspaceId?: string | null;
    conversationId?: string | null;
    layoutMode?: SubagentDrawerLayoutMode;
  }) => {
    // If already open and just switching conversationId within the same drawer, switch in place
    if (activeDrawerOverlayEl && opts?.conversationId && activeDrawerSelectSessionFn && !opts.layoutMode) {
      activeDrawerSelectSessionFn(opts.conversationId);
      return;
    }

    closeDrawer();
    const zh = isZh();
    const tokens = syncPaseoThemeCssVariables(document as never, window as never);
    const currentScope = resolveActiveScope();
    const targetAgentId = opts?.agentId ?? currentScope.agentId ?? undefined;
    const targetWorkspaceId =
      normalizeWorkspaceKey(opts?.workspaceId) ?? currentScope.workspaceId ?? undefined;
    let layoutMode: SubagentDrawerLayoutMode = opts?.layoutMode ?? readDrawerLayoutMode();

    const overlay = document.createElement("div");
    overlay.setAttribute("data-testid", "paseo-finder-subagents-drawer");
    overlay.setAttribute("data-layout-mode", layoutMode);

    const modal = document.createElement("div");
    modal.setAttribute("data-testid", "paseo-finder-subagents-panel");

    const applyLayoutStyles = () => {
      overlay.setAttribute("data-layout-mode", layoutMode);
      if (layoutMode === "docked-right") {
        Object.assign(overlay.style, {
          position: "fixed",
          top: "0",
          right: "0",
          bottom: "0",
          left: "auto",
          width: "min(620px, 52vw)",
          zIndex: "2147483645",
          backgroundColor: "transparent",
          backdropFilter: "none",
          display: "flex",
          alignItems: "stretch",
          justifyContent: "flex-end",
          padding: "0",
          boxSizing: "border-box",
          pointerEvents: "auto",
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        });
        Object.assign(modal.style, {
          width: "100%",
          height: "100%",
          backgroundColor: tokens.surface0,
          borderLeft: `1px solid ${tokens.border}`,
          borderTop: "none",
          borderRight: "none",
          borderBottom: "none",
          borderRadius: "0",
          boxShadow: tokens.shadowLg,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: tokens.foreground,
        });
      } else {
        Object.assign(overlay.style, {
          position: "fixed",
          inset: "0",
          width: "100vw",
          zIndex: "2147483645",
          backgroundColor: "rgba(0, 0, 0, 0.48)",
          backdropFilter: "blur(3px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          boxSizing: "border-box",
          pointerEvents: "auto",
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        });
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
      }
    };

    applyLayoutStyles();

    overlay.addEventListener("click", (ev) => {
      if (layoutMode === "wide-modal" && ev.target === overlay) {
        closeDrawer();
      }
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
      padding: "12px 16px",
      borderBottom: `1px solid ${tokens.border}`,
      backgroundColor: tokens.surface1,
      gap: "10px",
      flexShrink: "0",
    });

    const titleWrap = document.createElement("div");
    Object.assign(titleWrap.style, {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      minWidth: "0",
    });

    const titleEl = document.createElement("div");
    titleEl.textContent = zh
      ? "子智能体与后台计时器侧边栏"
      : "Subagent Sessions & Timers Sidebar";
    Object.assign(titleEl.style, {
      fontSize: "13.5px",
      fontWeight: "600",
      color: tokens.foreground,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });

    const subtitleEl = document.createElement("div");
    subtitleEl.textContent = zh
      ? "正在同步关联会话树与步骤记录..."
      : "Syncing linked session tree and step timeline...";
    Object.assign(subtitleEl.style, {
      fontSize: "11.5px",
      color: tokens.foregroundMuted,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });

    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(subtitleEl);

    const headerActions = document.createElement("div");
    Object.assign(headerActions.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      flexShrink: "0",
    });

    const modeToggleBtn = document.createElement("button");
    modeToggleBtn.type = "button";
    modeToggleBtn.setAttribute("data-testid", "paseo-finder-subagents-layout-toggle");
    const updateModeToggleLabel = () => {
      modeToggleBtn.textContent =
        layoutMode === "docked-right"
          ? zh
            ? "展开宽屏"
            : "Expand Modal"
          : zh
            ? "停靠右侧栏"
            : "Dock Right";
    };
    updateModeToggleLabel();
    Object.assign(modeToggleBtn.style, {
      padding: "5px 9px",
      borderRadius: "6px",
      border: `1px solid ${tokens.border}`,
      backgroundColor: tokens.surface2,
      color: tokens.foreground,
      fontSize: "11.5px",
      fontWeight: "500",
      cursor: "pointer",
    });

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.setAttribute("data-testid", "paseo-finder-subagents-refresh");
    refreshBtn.textContent = zh ? "刷新" : "Refresh";
    Object.assign(refreshBtn.style, {
      padding: "5px 9px",
      borderRadius: "6px",
      border: `1px solid ${tokens.border}`,
      backgroundColor: tokens.surface2,
      color: tokens.foreground,
      fontSize: "11.5px",
      fontWeight: "500",
      cursor: "pointer",
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("data-testid", "paseo-finder-subagents-close");
    closeBtn.textContent = zh ? "关闭" : "Close";
    Object.assign(closeBtn.style, {
      padding: "5px 9px",
      borderRadius: "6px",
      border: `1px solid ${tokens.border}`,
      backgroundColor: tokens.surface2,
      color: tokens.foreground,
      fontSize: "11.5px",
      fontWeight: "500",
      cursor: "pointer",
    });
    closeBtn.addEventListener("click", closeDrawer);

    headerActions.appendChild(modeToggleBtn);
    headerActions.appendChild(refreshBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(titleWrap);
    header.appendChild(headerActions);
    modal.appendChild(header);

    const body = document.createElement("div");
    Object.assign(body.style, {
      display: "flex",
      flex: "1",
      minHeight: "0",
      overflow: "hidden",
    });

    const leftPane = document.createElement("div");
    const rightPane = document.createElement("div");

    const syncBodyDirection = () => {
      if (layoutMode === "docked-right") {
        Object.assign(body.style, {
          flexDirection: "column",
        });
        Object.assign(leftPane.style, {
          width: "100%",
          maxHeight: "225px",
          flexShrink: "0",
          borderRight: "none",
          borderBottom: `1px solid ${tokens.border}`,
          backgroundColor: tokens.surface1,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          padding: "8px 12px",
          gap: "6px",
          boxSizing: "border-box",
        });
      } else {
        Object.assign(body.style, {
          flexDirection: "row",
        });
        Object.assign(leftPane.style, {
          width: "340px",
          maxHeight: "none",
          flexShrink: "0",
          borderRight: `1px solid ${tokens.border}`,
          borderBottom: "none",
          backgroundColor: tokens.surface1,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          padding: "10px",
          gap: "8px",
          boxSizing: "border-box",
        });
      }
      Object.assign(rightPane.style, {
        flex: "1",
        display: "flex",
        flexDirection: "column",
        minWidth: "0",
        minHeight: "0",
        overflow: "hidden",
        backgroundColor: tokens.surface0,
      });
    };

    syncBodyDirection();
    body.appendChild(leftPane);
    body.appendChild(rightPane);
    modal.appendChild(body);

    let allTrees: SubagentAgentTree[] = [];
    let selectedTree: SubagentAgentTree | null = null;
    let selectedCid: string | null = opts?.conversationId ?? null;
    let timelineFilter: "all" | "messages" | "tools" | "timers" = "all";

    modeToggleBtn.addEventListener("click", () => {
      layoutMode = layoutMode === "docked-right" ? "wide-modal" : "docked-right";
      writeDrawerLayoutMode(layoutMode);
      updateModeToggleLabel();
      applyLayoutStyles();
      syncBodyDirection();
      renderPanes();
    });

    activeDrawerSelectSessionFn = (cid: string) => {
      selectedCid = cid;
      if (allTrees.length > 0) {
        const ownerTree = allTrees.find(
          (t) =>
            t.rootConversationId.startsWith(cid) ||
            t.flatSubagents.some((s) => s.conversationId.startsWith(cid)),
        );
        if (ownerTree) selectedTree = ownerTree;
      }
      renderPanes();
    };

    const loadAndRender = async () => {
      subtitleEl.textContent = zh
        ? "正在读取会话与子智能体执行轨迹..."
        : "Loading session and subagent timelines...";
      const [focusedRes, listRes] = await Promise.all([
        targetAgentId || targetWorkspaceId || opts?.conversationId
          ? client
              .call(manageSubagentsRpc, {
                action: "inspect",
                agentId: targetAgentId,
                workspaceId: targetWorkspaceId,
                conversationId: opts?.conversationId ?? undefined,
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
            limit: 12,
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
        cacheTreeUnderAllKeys(tr);
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
        if (!selectedTree && targetAgentId) {
          selectedTree =
            allTrees.find(
              (t) => t.agentId === targetAgentId || t.agentId.startsWith(targetAgentId),
            ) ?? null;
        }
        if (!selectedTree && targetWorkspaceId) {
          selectedTree =
            allTrees.find(
              (t) => normalizeWorkspaceKey(t.workspaceId) === targetWorkspaceId,
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

      if (selectedTree) {
        const runningCnt = selectedTree.subagentSummary.running;
        subtitleEl.textContent = zh
          ? `${selectedTree.workspaceName || selectedTree.title} · 共 ${selectedTree.subagentSummary.total} 个子智能体 (${runningCnt > 0 ? `运行中 ${runningCnt}` : "全部完成"} · 累计 ${selectedTree.subagentSummary.totalSubagentSteps} 步)`
          : `${selectedTree.workspaceName || selectedTree.title} · ${selectedTree.subagentSummary.total} subagents (${runningCnt > 0 ? `${runningCnt} running` : "all completed"} · ${selectedTree.subagentSummary.totalSubagentSteps} steps)`;
      } else {
        subtitleEl.textContent = zh
          ? "当前暂无包含子智能体的会话记录"
          : "No sessions with subagents found";
      }

      renderPanes();
      // Also keep main DOM & left sidebar synced
      if (selectedTree) {
        decorateActiveAgentSubagentsDom(selectedTree);
      }
    };

    activeDrawerRefreshFn = loadAndRender;

    const buildLineageChain = (
      tree: SubagentAgentTree,
      activeNode: FlatSubagentNode | null,
    ): Array<{ cid: string; label: string; status: string; isCurrent: boolean }> => {
      const chain: Array<{ cid: string; label: string; status: string; isCurrent: boolean }> = [];
      let cursor: FlatSubagentNode | null = activeNode;
      const visited = new Set<string>();
      while (cursor && !visited.has(cursor.conversationId)) {
        visited.add(cursor.conversationId);
        chain.unshift({
          cid: cursor.conversationId,
          label: `L${cursor.depth} ${cursor.subAgentType}`,
          status: cursor.status,
          isCurrent: cursor.conversationId === activeNode?.conversationId,
        });
        const parentCid = cursor.parentConversationId;
        if (!parentCid || parentCid === tree.rootConversationId) {
          break;
        }
        cursor = tree.flatSubagents.find((s) => s.conversationId === parentCid) ?? null;
      }
      chain.unshift({
        cid: tree.rootConversationId,
        label: zh ? "主会话" : "Main Session",
        status: tree.agentStatus === "running" ? "running" : "completed",
        isCurrent: !activeNode,
      });
      return chain;
    };

    const renderPanes = () => {
      leftPane.innerHTML = "";
      rightPane.innerHTML = "";

      if (allTrees.length === 0 || !selectedTree) {
        const emptyEl = document.createElement("div");
        emptyEl.textContent = zh
          ? "当前暂无子智能体或后台计时器记录。"
          : "No subagents or background timers recorded yet.";
        Object.assign(emptyEl.style, {
          padding: "24px",
          fontSize: "13px",
          color: tokens.foregroundMuted,
        });
        rightPane.appendChild(emptyEl);
        return;
      }

      // In docked-right mode, show the active workspace's tree first and allow switching trees via a compact selector
      const treesToRender =
        layoutMode === "docked-right" ? [selectedTree] : allTrees;

      if (layoutMode === "docked-right" && allTrees.length > 1) {
        const switcherRow = document.createElement("div");
        Object.assign(switcherRow.style, {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          marginBottom: "2px",
        });
        const swLabel = document.createElement("span");
        swLabel.textContent = zh ? "关联主会话:" : "Session Tree:";
        Object.assign(swLabel.style, {
          fontSize: "11px",
          fontWeight: "600",
          color: tokens.foregroundMuted,
          flexShrink: "0",
        });
        const selectEl = document.createElement("select");
        Object.assign(selectEl.style, {
          flex: "1",
          minWidth: "0",
          padding: "4px 8px",
          borderRadius: "6px",
          border: `1px solid ${tokens.border}`,
          backgroundColor: tokens.surface0,
          color: tokens.foreground,
          fontSize: "11.5px",
        });
        for (const tr of allTrees) {
          const opt = document.createElement("option");
          opt.value = tr.agentId;
          opt.selected = tr.agentId === selectedTree.agentId;
          opt.textContent = `${tr.workspaceName || tr.title} (${tr.subagentSummary.total} · ${tr.subagentSummary.totalSubagentSteps} steps)`;
          selectEl.appendChild(opt);
        }
        selectEl.addEventListener("change", () => {
          const next = allTrees.find((t) => t.agentId === selectEl.value);
          if (next) {
            selectedTree = next;
            selectedCid =
              next.flatSubagents[0]?.conversationId ?? next.rootConversationId;
            renderPanes();
          }
        });
        switcherRow.appendChild(swLabel);
        switcherRow.appendChild(selectEl);
        leftPane.appendChild(switcherRow);
      }

      for (const tree of treesToRender) {
        const isCurrentTree = tree.agentId === selectedTree.agentId;
        const treeGroup = document.createElement("div");
        Object.assign(treeGroup.style, {
          border: `1px solid ${isCurrentTree ? tokens.accent : tokens.border}`,
          borderRadius: "8px",
          backgroundColor: tokens.surface0,
          overflow: "hidden",
          flexShrink: "0",
        });

        if (layoutMode === "wide-modal") {
          const groupHeader = document.createElement("div");
          Object.assign(groupHeader.style, {
            padding: "8px 11px",
            cursor: "pointer",
            backgroundColor: isCurrentTree ? tokens.surface2 : tokens.surface0,
            borderBottom: isCurrentTree ? `1px solid ${tokens.border}` : "none",
            display: "flex",
            flexDirection: "column",
            gap: "3px",
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
          countPill.textContent = `${tree.subagentSummary.total} · ${tree.subagentSummary.totalSubagentSteps} steps`;
          Object.assign(countPill.style, {
            fontSize: "10.5px",
            fontWeight: "600",
            padding: "1px 6px",
            borderRadius: "999px",
            backgroundColor: sumCol.bg,
            color: sumCol.fg,
            border: `1px solid ${sumCol.border}`,
            flexShrink: "0",
          });

          topRow.appendChild(wsBadge);
          topRow.appendChild(countPill);

          const subRow = document.createElement("div");
          subRow.textContent = `${tree.model} · ${tree.rootStepCount} steps`;
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
        }

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
            padding: "6px 9px",
            borderRadius: "6px",
            cursor: "pointer",
            backgroundColor: isRootSelected ? tokens.surface2 : "transparent",
            border: isRootSelected
              ? `1px solid ${tokens.accent}`
              : "1px solid transparent",
          });

          const rootLabel = document.createElement("div");
          rootLabel.textContent = zh
            ? `主会话 (${tree.rootConversationId.slice(0, 8)})`
            : `Main Session (${tree.rootConversationId.slice(0, 8)})`;
          Object.assign(rootLabel.style, {
            fontSize: "12px",
            fontWeight: isRootSelected ? "600" : "500",
            color: tokens.foreground,
          });

          const rootMeta = document.createElement("span");
          rootMeta.textContent = zh
            ? `${tree.rootStepCount} 步`
            : `${tree.rootStepCount} steps`;
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
              Boolean(selectedCid && sub.conversationId.startsWith(selectedCid));
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
              gap: "2px",
              padding: "6px 9px",
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

            const leftTitleWrap = document.createElement("div");
            Object.assign(leftTitleWrap.style, {
              display: "flex",
              alignItems: "center",
              gap: "6px",
              minWidth: "0",
            });

            const dotEl = document.createElement("span");
            Object.assign(dotEl.style, {
              width: "7px",
              height: "7px",
              borderRadius: "999px",
              backgroundColor: sc.dot,
              flexShrink: "0",
            });

            const nameSpan = document.createElement("span");
            nameSpan.textContent = `L${sub.depth} · ${sub.subAgentType}${
              sub.role ? ` (${sub.role})` : ""
            }`;
            Object.assign(nameSpan.style, {
              fontSize: "12px",
              fontWeight: "600",
              color: tokens.foreground,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            });

            leftTitleWrap.appendChild(dotEl);
            leftTitleWrap.appendChild(nameSpan);

            const timersCnt = (sub.timersAndTasks ?? []).length;
            const statusBadge = document.createElement("span");
            statusBadge.textContent = `${formatStatusLabel(sub.status, zh)} · ${
              zh ? `${sub.stepCount} 步` : `${sub.stepCount} steps`
            }${timersCnt > 0 ? (zh ? ` · ${timersCnt} 任务` : ` · ${timersCnt} tasks`) : ""}`;
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

            r1.appendChild(leftTitleWrap);
            r1.appendChild(statusBadge);
            nodeRow.appendChild(r1);

            if (sub.promptPreview) {
              const promptEl = document.createElement("div");
              promptEl.textContent = sub.promptPreview;
              Object.assign(promptEl.style, {
                fontSize: "11px",
                color: tokens.foregroundMuted,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              });
              nodeRow.appendChild(promptEl);
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

      // Right/Bottom pane: Selected Session Inspector
      const activeSub =
        selectedTree.flatSubagents.find(
          (s) =>
            s.conversationId === selectedCid ||
            Boolean(selectedCid && s.conversationId.startsWith(selectedCid)),
        ) ?? null;
      const isInspectingRoot = !activeSub;
      const currentCid = activeSub
        ? activeSub.conversationId
        : selectedTree.rootConversationId;
      const timelineItems: SubagentTimelineItem[] = activeSub
        ? activeSub.timeline ?? []
        : selectedTree.rootTimeline ?? [];
      const activeTimers: SubagentTimerOrTaskNode[] = activeSub
        ? activeSub.timersAndTasks ?? []
        : selectedTree.rootTimersAndTasks ?? [];

      const sessionHeader = document.createElement("div");
      Object.assign(sessionHeader.style, {
        padding: "12px 16px",
        borderBottom: `1px solid ${tokens.border}`,
        backgroundColor: tokens.surface1,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        flexShrink: "0",
      });

      // 1. Bidirectional Session Lineage Breadcrumb Bar
      const lineageChain = buildLineageChain(selectedTree, activeSub);
      const breadcrumbBar = document.createElement("div");
      breadcrumbBar.setAttribute("data-testid", "paseo-finder-subagent-lineage-breadcrumbs");
      Object.assign(breadcrumbBar.style, {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        flexWrap: "wrap",
      });

      lineageChain.forEach((step, idx) => {
        if (idx > 0) {
          const arrow = document.createElement("span");
          arrow.textContent = "›";
          Object.assign(arrow.style, {
            fontSize: "12px",
            color: tokens.foregroundMuted,
            padding: "0 2px",
          });
          breadcrumbBar.appendChild(arrow);
        }
        const sc = statusColors(step.status, tokens);
        const crumbBtn = document.createElement("button");
        crumbBtn.type = "button";
        crumbBtn.setAttribute(
          "data-testid",
          `paseo-finder-subagent-crumb-${step.cid.slice(0, 8)}`,
        );
        crumbBtn.textContent = step.label;
        Object.assign(crumbBtn.style, {
          padding: "2px 8px",
          borderRadius: "6px",
          fontSize: "11px",
          fontWeight: step.isCurrent ? "600" : "500",
          cursor: "pointer",
          border: `1px solid ${step.isCurrent ? tokens.accent : sc.border}`,
          backgroundColor: step.isCurrent ? tokens.surface2 : tokens.surface0,
          color: tokens.foreground,
        });
        crumbBtn.addEventListener("click", () => {
          selectedCid = step.cid;
          renderPanes();
        });
        breadcrumbBar.appendChild(crumbBtn);
      });

      // Also show direct child subagent jump chips right in the breadcrumb bar
      const directChildren = selectedTree.flatSubagents.filter(
        (s) => s.parentConversationId === currentCid,
      );
      for (const child of directChildren) {
        const arrow = document.createElement("span");
        arrow.textContent = "↳";
        Object.assign(arrow.style, {
          fontSize: "11px",
          color: tokens.foregroundMuted,
          paddingLeft: "4px",
        });
        breadcrumbBar.appendChild(arrow);

        const cCol = statusColors(child.status, tokens);
        const childChip = document.createElement("button");
        childChip.type = "button";
        childChip.setAttribute(
          "data-testid",
          `paseo-finder-subagent-jump-child-${child.conversationId.slice(0, 8)}`,
        );
        childChip.textContent = `L${child.depth} ${child.subAgentType} (${
          zh ? `${child.stepCount} 步` : `${child.stepCount} steps`
        })`;
        Object.assign(childChip.style, {
          padding: "2px 8px",
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
        breadcrumbBar.appendChild(childChip);
      }

      sessionHeader.appendChild(breadcrumbBar);

      // 2. Title & Actions row
      const topInfoRow = document.createElement("div");
      Object.assign(topInfoRow.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        flexWrap: "wrap",
      });

      const sessionTitle = document.createElement("div");
      sessionTitle.textContent = activeSub
        ? `L${activeSub.depth} ${activeSub.subAgentType}${activeSub.role ? ` — ${activeSub.role}` : ""}`
        : zh
          ? `主会话 — ${selectedTree.title}`
          : `Main Session — ${selectedTree.title}`;
      Object.assign(sessionTitle.style, {
        fontSize: "13.5px",
        fontWeight: "600",
        color: tokens.foreground,
      });

      const actionBtnsWrap = document.createElement("div");
      Object.assign(actionBtnsWrap.style, {
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
        const upBtn = document.createElement("button");
        upBtn.type = "button";
        upBtn.setAttribute("data-testid", "paseo-finder-subagent-jump-parent");
        upBtn.textContent = parentNode
          ? zh
            ? `返回父级 L${parentNode.depth} ${parentNode.subAgentType}`
            : `Back to L${parentNode.depth} ${parentNode.subAgentType}`
          : zh
            ? "返回主会话"
            : "Back to Main Session";
        Object.assign(upBtn.style, {
          padding: "4px 9px",
          borderRadius: "6px",
          border: `1px solid ${tokens.border}`,
          backgroundColor: tokens.surface2,
          color: tokens.foreground,
          fontSize: "11px",
          fontWeight: "500",
          cursor: "pointer",
        });
        upBtn.addEventListener("click", () => {
          selectedCid = parentCid;
          renderPanes();
        });
        actionBtnsWrap.appendChild(upBtn);
      }

      if (activeSub?.transcriptPath) {
        const revealBtn = document.createElement("button");
        revealBtn.type = "button";
        revealBtn.textContent = zh ? "定位日志" : "Reveal Transcript";
        Object.assign(revealBtn.style, {
          padding: "4px 9px",
          borderRadius: "6px",
          border: `1px solid ${tokens.border}`,
          backgroundColor: tokens.surface2,
          color: tokens.foreground,
          fontSize: "11px",
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

      if (activeSub && activeSub.depth === 1) {
        const nativeTabBtn = document.createElement("button");
        nativeTabBtn.type = "button";
        nativeTabBtn.textContent = zh ? "原生子标签打开" : "Open Native Tab";
        Object.assign(nativeTabBtn.style, {
          padding: "4px 9px",
          borderRadius: "6px",
          border: `1px solid ${tokens.accent}`,
          backgroundColor: tokens.surface2,
          color: tokens.foreground,
          fontSize: "11px",
          fontWeight: "500",
          cursor: "pointer",
        });
        nativeTabBtn.addEventListener("click", () => {
          if (tryClickNativeSubagentTrackRow(activeSub.conversationId)) {
            closeDrawer();
          }
        });
        actionBtnsWrap.appendChild(nativeTabBtn);
      }

      const activeScopeNow = resolveActiveScope();
      if (
        activeScopeNow.agentId !== selectedTree.agentId &&
        activeScopeNow.workspaceId !== normalizeWorkspaceKey(selectedTree.workspaceId)
      ) {
        const jumpAgentBtn = document.createElement("button");
        jumpAgentBtn.type = "button";
        jumpAgentBtn.textContent = zh ? "跳转至该工作区" : "Jump to Workspace";
        Object.assign(jumpAgentBtn.style, {
          padding: "4px 9px",
          borderRadius: "6px",
          border: `1px solid ${tokens.border}`,
          backgroundColor: tokens.primary,
          color: tokens.primaryForeground,
          fontSize: "11px",
          fontWeight: "500",
          cursor: "pointer",
        });
        jumpAgentBtn.addEventListener("click", () => {
          const normW = normalizeWorkspaceKey(selectedTree!.workspaceId);
          if (normW && focusWorkspaceInApp(normW, null, document as never, window as never)) {
            return;
          }
          const nextUrl = normW
            ? `/h/local/workspace/${normW}`
            : `/ag/${selectedTree!.agentId}`;
          window.history.pushState({}, "", nextUrl);
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
        actionBtnsWrap.appendChild(jumpAgentBtn);
      }

      topInfoRow.appendChild(sessionTitle);
      topInfoRow.appendChild(actionBtnsWrap);
      sessionHeader.appendChild(topInfoRow);

      // 3. Metadata + Filter tabs
      const metaRow = document.createElement("div");
      Object.assign(metaRow.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        flexWrap: "wrap",
      });

      const metaStats = document.createElement("div");
      const stepCnt = activeSub ? activeSub.stepCount : selectedTree.rootStepCount;
      const toolCnt = activeSub ? activeSub.toolCallCount : selectedTree.rootToolCallCount;
      metaStats.textContent = `ID: ${currentCid.slice(0, 12)} · ${
        zh ? `步数: ${stepCnt} · 工具: ${toolCnt}` : `Steps: ${stepCnt} · Tools: ${toolCnt}`
      }${activeSub?.lastToolName ? ` · ${activeSub.lastToolName}` : ""}`;
      Object.assign(metaStats.style, {
        fontSize: "11px",
        color: tokens.foregroundMuted,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      });

      const filterWrap = document.createElement("div");
      Object.assign(filterWrap.style, {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        flexWrap: "wrap",
      });

      const filters: {
        key: "all" | "messages" | "tools" | "timers";
        label: string;
      }[] = [
        {
          key: "all",
          label: zh ? `全部 (${timelineItems.length})` : `All (${timelineItems.length})`,
        },
        {
          key: "messages",
          label: zh
            ? `对话与汇报 (${timelineItems.filter((i) => i.type !== "tool_call").length})`
            : `Messages (${timelineItems.filter((i) => i.type !== "tool_call").length})`,
        },
        {
          key: "tools",
          label: zh
            ? `工具调用 (${timelineItems.filter((i) => i.type === "tool_call").length})`
            : `Tools (${timelineItems.filter((i) => i.type === "tool_call").length})`,
        },
        {
          key: "timers",
          label: zh
            ? `计时与后台任务 (${activeTimers.length})`
            : `Timers & Tasks (${activeTimers.length})`,
        },
      ];

      for (const f of filters) {
        const fBtn = document.createElement("button");
        fBtn.type = "button";
        fBtn.setAttribute("data-testid", `paseo-finder-subagent-filter-${f.key}`);
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
      rightPane.appendChild(sessionHeader);

      // Timeline Scroll Container
      const timelineScroll = document.createElement("div");
      Object.assign(timelineScroll.style, {
        flex: "1",
        overflowY: "auto",
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      });

      // Show Timers & Background Tasks summary card when on "timers" tab or when running timers exist
      if (timelineFilter === "timers" || activeTimers.some((t) => t.status === "running")) {
        const timersList =
          timelineFilter === "timers"
            ? activeTimers
            : activeTimers.filter((t) => t.status === "running");
        if (timersList.length > 0) {
          const timersBox = document.createElement("div");
          timersBox.setAttribute("data-testid", "paseo-finder-subagent-timers-list");
          Object.assign(timersBox.style, {
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            padding: "10px 12px",
            borderRadius: "8px",
            backgroundColor: tokens.surface1,
            border: `1px solid ${tokens.border}`,
          });

          const tHeader = document.createElement("div");
          tHeader.textContent = zh
            ? `计时器与后台任务 (${timersList.length})`
            : `Timers & Background Tasks (${timersList.length})`;
          Object.assign(tHeader.style, {
            fontSize: "11.5px",
            fontWeight: "600",
            color: tokens.foreground,
          });
          timersBox.appendChild(tHeader);

          for (const tm of timersList) {
            const tsc = statusColors(tm.status, tokens);
            const tRow = document.createElement("div");
            Object.assign(tRow.style, {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              padding: "6px 8px",
              borderRadius: "6px",
              backgroundColor: tokens.surface0,
              border: `1px solid ${tokens.border}`,
            });

            const tLeft = document.createElement("div");
            Object.assign(tLeft.style, {
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              minWidth: "0",
              flex: "1",
            });

            const tTitle = document.createElement("div");
            const kindLabel =
              tm.kind === "timer"
                ? zh
                  ? `计时器${tm.durationSeconds ? ` (${tm.durationSeconds}s)` : ""}`
                  : `Timer${tm.durationSeconds ? ` (${tm.durationSeconds}s)` : ""}`
                : zh
                  ? "后台命令任务"
                  : "Background Command";
            tTitle.textContent = `#${tm.stepIndex} · ${kindLabel} · ${tm.taskId.split("/").pop() ?? tm.taskId}`;
            Object.assign(tTitle.style, {
              fontSize: "11px",
              fontWeight: "600",
              color: tokens.foreground,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            });

            const tPrompt = document.createElement("div");
            tPrompt.textContent = tm.prompt;
            Object.assign(tPrompt.style, {
              fontSize: "11px",
              color: tokens.foregroundMuted,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            });

            tLeft.appendChild(tTitle);
            tLeft.appendChild(tPrompt);

            const tBadge = document.createElement("span");
            tBadge.textContent = formatStatusLabel(tm.status, zh);
            Object.assign(tBadge.style, {
              fontSize: "10.5px",
              fontWeight: "600",
              padding: "1px 6px",
              borderRadius: "999px",
              backgroundColor: tsc.bg,
              color: tsc.fg,
              border: `1px solid ${tsc.border}`,
              flexShrink: "0",
            });

            tRow.appendChild(tLeft);
            tRow.appendChild(tBadge);
            timersBox.appendChild(tRow);
          }

          timelineScroll.appendChild(timersBox);
        } else if (timelineFilter === "timers") {
          const noTimers = document.createElement("div");
          noTimers.textContent = zh
            ? "该会话暂无计时器或后台任务记录。"
            : "No timers or background tasks recorded in this session.";
          Object.assign(noTimers.style, {
            fontSize: "12px",
            color: tokens.foregroundMuted,
            padding: "16px 0",
          });
          timelineScroll.appendChild(noTimers);
        }
      }

      if (timelineFilter !== "timers") {
        const filteredItems = timelineItems.filter((item) => {
          if (timelineFilter === "messages") return item.type !== "tool_call";
          if (timelineFilter === "tools") return item.type === "tool_call";
          return true;
        });

        if (filteredItems.length === 0) {
          const emptyTl = document.createElement("div");
          emptyTl.textContent = isInspectingRoot
            ? zh
              ? "点击上方任一 L1 / L2 子智能体节点可查看其完整执行轨迹。"
              : "Select any L1 / L2 subagent node above to inspect its timeline."
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
            tcRow.setAttribute("data-testid", `paseo-finder-timeline-tool-${item.stepIndex}`);
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
              jumpSubBtn.textContent = zh ? "跳转子会话 →" : "Open Session →";
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
            padding: "10px 13px",
            borderRadius: "8px",
            backgroundColor: isUser ? tokens.surface2 : tokens.surface1,
            border: `1px solid ${tokens.border}`,
            display: "flex",
            flexDirection: "column",
            gap: "5px",
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
              ? zh
                ? `来自 ${item.sender.slice(0, 8)} 的消息 · 步骤 #${item.stepIndex}`
                : `Message from ${item.sender.slice(0, 8)} · Step #${item.stepIndex}`
              : zh
                ? `任务指令 · 步骤 #${item.stepIndex}`
                : `Task Prompt · Step #${item.stepIndex}`
            : zh
              ? `智能体回复 · 步骤 #${item.stepIndex}`
              : `Agent Response · Step #${item.stepIndex}`;

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

  // Render collapsible Subagent & Timer Tree inside Paseo's Left Sidebar right below the active workspace row
  const renderLeftSidebarSubagentsTree = (
    tree: SubagentAgentTree | null,
    scope: { scopeKey: string | null; agentId: string | null; workspaceId: string | null },
  ) => {
    const existingLeftTree = document.querySelector<HTMLElement>(
      '[data-testid="paseo-finder-left-sidebar-subagents"]',
    );
    const totalTimers =
      (tree?.rootTimersAndTasks?.length ?? 0) +
      (tree?.flatSubagents ?? []).reduce((acc, s) => acc + (s.timersAndTasks?.length ?? 0), 0);

    if (!scope.scopeKey || !tree || (tree.subagentSummary.total === 0 && totalTimers === 0)) {
      existingLeftTree?.remove();
      return;
    }

    const normWs = normalizeWorkspaceKey(tree.workspaceId) ?? scope.workspaceId;
    const candidateSelectors = [
      ...(normWs
        ? [
            `[data-testid="sidebar-workspace-row-local:${normWs}"]`,
            `[data-testid="sidebar-workspace-row-${normWs}"]`,
          ]
        : []),
      '[data-testid^="sidebar-workspace-row-"][aria-selected="true"]',
    ];
    let targetWsRow: HTMLElement | null = null;
    for (const sel of candidateSelectors) {
      targetWsRow = document.querySelector<HTMLElement>(sel);
      if (targetWsRow) break;
    }

    if (!targetWsRow || !targetWsRow.parentElement) {
      existingLeftTree?.remove();
      return;
    }

    const zh = isZh();
    const tokens = syncPaseoThemeCssVariables(document as never, window as never);
    const sig = `${tree.agentId}:${tree.subagentSummary.total}:${tree.subagentSummary.running}:${tree.subagentSummary.totalSubagentSteps}:${totalTimers}:${leftSidebarCollapsed}:${zh}`;

    let container = existingLeftTree;
    if (!container || container.previousElementSibling !== targetWsRow) {
      existingLeftTree?.remove();
      container = document.createElement("div");
      container.setAttribute("data-testid", "paseo-finder-left-sidebar-subagents");
      targetWsRow.insertAdjacentElement("afterend", container);
    }

    if (container.getAttribute("data-render-sig") === sig) {
      return;
    }
    container.setAttribute("data-render-sig", sig);
    container.innerHTML = "";

    Object.assign(container.style, {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      margin: "2px 8px 6px 20px",
      paddingLeft: "8px",
      borderLeft: `1px solid ${tokens.border}`,
      fontFamily:
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });

    const headerRow = document.createElement("div");
    headerRow.setAttribute("data-testid", "paseo-finder-left-sidebar-subagents-toggle");
    Object.assign(headerRow.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "3px 6px",
      borderRadius: "5px",
      cursor: "pointer",
      userSelect: "none",
    });

    const headerLabel = document.createElement("span");
    headerLabel.textContent = zh
      ? `${leftSidebarCollapsed ? "▸" : "▾"} 子会话树 (${tree.subagentSummary.total})`
      : `${leftSidebarCollapsed ? "▸" : "▾"} Subagents (${tree.subagentSummary.total})`;
    Object.assign(headerLabel.style, {
      fontSize: "11px",
      fontWeight: "600",
      color: tokens.foregroundMuted,
    });

    const headerSteps = document.createElement("span");
    headerSteps.textContent = zh
      ? `${tree.subagentSummary.totalSubagentSteps} 步`
      : `${tree.subagentSummary.totalSubagentSteps} steps`;
    Object.assign(headerSteps.style, {
      fontSize: "10.5px",
      color: tokens.foregroundMuted,
    });

    headerRow.appendChild(headerLabel);
    headerRow.appendChild(headerSteps);
    headerRow.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      leftSidebarCollapsed = !leftSidebarCollapsed;
      try {
        window.localStorage?.setItem(LEFT_SIDEBAR_COLLAPSED_KEY, String(leftSidebarCollapsed));
      } catch {
        // ignore
      }
      renderLeftSidebarSubagentsTree(tree, scope);
    });
    container.appendChild(headerRow);

    if (leftSidebarCollapsed) {
      return;
    }

    for (const sub of tree.flatSubagents) {
      const sc = statusColors(sub.status, tokens);
      const itemBtn = document.createElement("button");
      itemBtn.type = "button";
      itemBtn.setAttribute(
        "data-testid",
        `paseo-finder-left-sidebar-subagent-${sub.conversationId.slice(0, 8)}`,
      );
      const indentPx = Math.max(0, (sub.depth - 1) * 10);
      Object.assign(itemBtn.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "6px",
        marginLeft: `${indentPx}px`,
        padding: "4px 6px",
        borderRadius: "5px",
        border: "1px solid transparent",
        backgroundColor: "transparent",
        color: tokens.foreground,
        fontSize: "11.5px",
        cursor: "pointer",
        textAlign: "left",
      });

      const leftPart = document.createElement("div");
      Object.assign(leftPart.style, {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        minWidth: "0",
        flex: "1",
      });

      const dot = document.createElement("span");
      Object.assign(dot.style, {
        width: "6px",
        height: "6px",
        borderRadius: "999px",
        backgroundColor: sc.dot,
        flexShrink: "0",
      });

      const nameEl = document.createElement("span");
      nameEl.textContent = `L${sub.depth} ${sub.subAgentType}`;
      Object.assign(nameEl.style, {
        fontSize: "11.5px",
        fontWeight: "500",
        color: tokens.foreground,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });

      leftPart.appendChild(dot);
      leftPart.appendChild(nameEl);

      const metaEl = document.createElement("span");
      metaEl.textContent = zh ? `${sub.stepCount}步` : `${sub.stepCount}s`;
      Object.assign(metaEl.style, {
        fontSize: "10.5px",
        color: sc.fg,
        flexShrink: "0",
      });

      itemBtn.appendChild(leftPart);
      itemBtn.appendChild(metaEl);

      itemBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void openDrawer({
          agentId: tree.agentId,
          workspaceId: tree.workspaceId,
          conversationId: sub.conversationId,
          layoutMode: "docked-right",
        });
      });

      container.appendChild(itemBtn);
    }
  };

  // Decorate inline `[data-testid="tool-call-badge"]` rows for subagents / timers
  // and render Connected Subagents Bar above composer + Left Sidebar Subagents Tree
  const decorateActiveAgentSubagentsDom = (tree: SubagentAgentTree | null) => {
    const zh = isZh();
    const tokens = syncPaseoThemeCssVariables(document as never, window as never);
    const scope = resolveActiveScope();

    // 1. Left Sidebar Subagents Tree under the active workspace row
    renderLeftSidebarSubagentsTree(tree, scope);

    // 2. Connected Subagents Bar right above the composer
    const existingBar = document.querySelector<HTMLElement>(
      '[data-testid="paseo-finder-subagents-bar"]',
    );
    if (!scope.scopeKey || !tree || tree.subagentSummary.total === 0) {
      existingBar?.remove();
    } else {
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
            ? `关联子会话 (${tree.subagentSummary.total} 个 · 共 ${tree.subagentSummary.totalSubagentSteps} 步):`
            : `Connected Subagents (${tree.subagentSummary.total} · ${tree.subagentSummary.totalSubagentSteps} steps):`;
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
            )} (${zh ? `${sub.stepCount} 步` : `${sub.stepCount} steps`})`;
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
                workspaceId: tree.workspaceId,
                conversationId: sub.conversationId,
                layoutMode: "docked-right",
              });
            });
            leftSide.appendChild(pill);
          }

          const openTreeBtn = document.createElement("button");
          openTreeBtn.type = "button";
          openTreeBtn.setAttribute("data-testid", "paseo-finder-open-subagents-sidebar");
          openTreeBtn.textContent = zh ? "展开子会话侧边栏 (⌘⇧B)" : "Open Subagent Sidebar (⌘⇧B)";
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
            void openDrawer({
              agentId: tree.agentId,
              workspaceId: tree.workspaceId,
              layoutMode: "docked-right",
            });
          });

          bar.appendChild(leftSide);
          bar.appendChild(openTreeBtn);
        }
      }
    }

    // 3. Decorate inline `[data-testid="tool-call-badge"]` rows for DeepCoder, Timers, Tasks, etc.
    const badges = document.querySelectorAll<HTMLElement>('[data-testid="tool-call-badge"]');
    let subCallOccurrenceIdx = 0;
    const l1Subagents = (tree?.flatSubagents ?? []).filter((s) => s.depth === 1);

    for (let i = 0; i < badges.length; i += 1) {
      const badge = badges[i];
      if (!badge) continue;
      // Exclude our own injected chip text when classifying
      const existingChip = badge.querySelector<HTMLElement>(
        '[data-testid="paseo-finder-inline-subagent-chip"]',
      );
      const rawFullText = (badge.textContent ?? "").trim();
      const chipText = (existingChip?.textContent ?? "").trim();
      const baseText =
        chipText && rawFullText.endsWith(chipText)
          ? rawFullText.slice(0, rawFullText.length - chipText.length).trim()
          : rawFullText;

      const classified = classifyToolCallBadgeText(baseText, tree);
      if (!classified.kind) {
        continue;
      }

      let matchedSub: FlatSubagentNode | null = null;
      if (classified.kind === "subagent") {
        matchedSub =
          l1Subagents[subCallOccurrenceIdx] ??
          tree?.flatSubagents.find(
            (s) => s.subAgentType.toLowerCase() === classified.subagentName,
          ) ??
          tree?.flatSubagents[0] ??
          null;
        subCallOccurrenceIdx += 1;
      } else {
        matchedSub = tree?.flatSubagents[0] ?? null;
      }

      badge.style.cursor = "pointer";
      badge.setAttribute("data-paseo-finder-subagent-kind", classified.kind);
      if (matchedSub) {
        badge.setAttribute("data-paseo-finder-subagent-cid", matchedSub.conversationId);
      }

      const chipSig = matchedSub
        ? `${classified.kind}:${matchedSub.conversationId}:${matchedSub.status}:${matchedSub.stepCount}:${matchedSub.nestedSubagentCount}:${zh}`
        : `generic:${classified.kind}:${classified.subagentName ?? ""}:${zh}`;

      if (existingChip && existingChip.getAttribute("data-sig") === chipSig) {
        continue;
      }
      existingChip?.remove();

      const chip = document.createElement("span");
      chip.setAttribute("data-testid", "paseo-finder-inline-subagent-chip");
      chip.setAttribute("data-sig", chipSig);

      if (matchedSub && classified.kind === "subagent") {
        const sc = statusColors(matchedSub.status, tokens);
        const nestedPart =
          matchedSub.nestedSubagentCount > 0
            ? zh
              ? ` · 派生 ${matchedSub.nestedSubagentCount} 个子会话 (共 ${tree?.subagentSummary.totalSubagentSteps ?? matchedSub.stepCount} 步)`
              : ` · +${matchedSub.nestedSubagentCount} nested (${tree?.subagentSummary.totalSubagentSteps ?? matchedSub.stepCount} total steps)`
            : "";
        chip.textContent = `${formatStatusLabel(matchedSub.status, zh)} · ${
          zh ? `${matchedSub.stepCount} 步` : `${matchedSub.stepCount} steps`
        }${nestedPart} · ${zh ? "弹出侧边栏 ↗" : "Open Sidebar ↗"}`;
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
        chip.textContent = zh ? "弹出子会话侧边栏 ↗" : "Open Subagent Sidebar ↗";
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

      badge.appendChild(chip);
    }
  };

  // Document-level capture-phase click listener so clicking ANY inline subagent / timer tool call badge
  // reliably pops out the Right-Docked Subagent Sidebar even across virtualized list re-renders!
  const onDocumentClickCapture = (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (activeDrawerOverlayEl && activeDrawerOverlayEl.contains(target)) {
      return;
    }

    const badge = target.closest<HTMLElement>('[data-testid="tool-call-badge"]');
    if (!badge) return;

    const scope = resolveActiveScope();
    const curTree = getCachedTreeForScope(scope);
    const existingChip = badge.querySelector<HTMLElement>(
      '[data-testid="paseo-finder-inline-subagent-chip"]',
    );
    const rawFullText = (badge.textContent ?? "").trim();
    const chipText = (existingChip?.textContent ?? "").trim();
    const baseText =
      chipText && rawFullText.endsWith(chipText)
        ? rawFullText.slice(0, rawFullText.length - chipText.length).trim()
        : rawFullText;

    const classified = classifyToolCallBadgeText(baseText, curTree);
    if (!classified.kind && !badge.getAttribute("data-paseo-finder-subagent-kind")) {
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();

    const boundCid = badge.getAttribute("data-paseo-finder-subagent-cid");
    const targetSub =
      (boundCid
        ? curTree?.flatSubagents.find((s) => s.conversationId === boundCid)
        : null) ??
      (classified.subagentName
        ? curTree?.flatSubagents.find(
            (s) => s.subAgentType.toLowerCase() === classified.subagentName,
          )
        : null) ??
      curTree?.flatSubagents[0] ??
      null;

    if (ev.altKey && targetSub && tryClickNativeSubagentTrackRow(targetSub.conversationId)) {
      return;
    }

    void openDrawer({
      agentId: curTree?.agentId ?? scope.agentId,
      workspaceId: curTree?.workspaceId ?? scope.workspaceId,
      conversationId: targetSub?.conversationId ?? null,
      layoutMode: "docked-right",
    });
  };

  const syncCurrentAgentSubagents = () => {
    const scope = resolveActiveScope();
    if (!scope.scopeKey) {
      lastScopeKey = null;
      decorateActiveAgentSubagentsDom(null);
      return;
    }
    const force = scope.scopeKey !== lastScopeKey;
    lastScopeKey = scope.scopeKey;
    const cached = getCachedTreeForScope(scope);
    if (cached) {
      decorateActiveAgentSubagentsDom(cached);
    }
    void fetchScopeTree(scope, force, false).then((tree) => {
      const latestScope = resolveActiveScope();
      if (latestScope.scopeKey === scope.scopeKey) {
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
    const scope = resolveActiveScope();
    if (!scope.scopeKey) return;
    const cached = getCachedTreeForScope(scope);
    const hasBadgeInDom = Boolean(document.querySelector('[data-testid="tool-call-badge"]'));
    if (cached?.subagentSummary.running || (hasBadgeInDom && !cached) || activeDrawerOverlayEl) {
      void fetchScopeTree(scope, true, false).then((tree) => {
        const latestScope = resolveActiveScope();
        if (latestScope.scopeKey === scope.scopeKey) {
          decorateActiveAgentSubagentsDom(tree);
        }
      });
      if (activeDrawerOverlayEl && activeDrawerRefreshFn && cached?.subagentSummary.running) {
        void activeDrawerRefreshFn();
      }
    }
  }, 3_000);

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && activeDrawerOverlayEl) {
      ev.preventDefault();
      ev.stopPropagation();
      closeDrawer();
      return;
    }
    // Cmd+Shift+B (Ctrl+Shift+B) toggles the Right-Docked Subagent Sidebar
    if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "b") {
      ev.preventDefault();
      ev.stopPropagation();
      if (activeDrawerOverlayEl) {
        closeDrawer();
      } else {
        const scope = resolveActiveScope();
        void openDrawer({
          agentId: scope.agentId,
          workspaceId: scope.workspaceId,
          layoutMode: "docked-right",
        });
      }
    }
  };

  document.addEventListener("click", onDocumentClickCapture, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("popstate", syncCurrentAgentSubagents, false);
  setTimeout(syncCurrentAgentSubagents, 80);

  return () => {
    externalOpenDrawerFn = null;
    closeDrawer();
    observer.disconnect();
    if (pollIntervalId) clearInterval(pollIntervalId);
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    document.removeEventListener("click", onDocumentClickCapture, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("popstate", syncCurrentAgentSubagents, false);
  };
}
