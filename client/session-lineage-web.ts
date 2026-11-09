/// <reference lib="dom" />
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  type SessionLineageNode,
  manageSessionLineageRpc,
  openFileTargetRpc,
} from "../shared/contracts";
import { isChineseLocale } from "./i18n";
import { syncPaseoThemeCssVariables } from "./theme-web";
import { focusWorkspaceInApp } from "./web";

export interface SessionLineageWebClient {
  call<TDef extends typeof manageSessionLineageRpc | typeof openFileTargetRpc>(
    def: TDef,
    input: RpcInput<TDef>,
  ): Promise<RpcOutput<TDef>>;
  getLocale?: () => string | undefined;
}

export interface ActiveWorkspaceAndAgent {
  workspaceId: string | null;
  agentId: string | null;
}

export function extractCurrentWorkspaceAndAgent(
  doc?: Document | null,
  win?: Window | null,
): ActiveWorkspaceAndAgent {
  const pathname = (win?.location?.pathname ?? "").trim();
  let workspaceId: string | null = null;
  let agentId: string | null = null;

  const wsMatch = pathname.match(/\/workspace\/([^/?#]+)/);
  if (wsMatch?.[1]) {
    try {
      workspaceId = decodeURIComponent(wsMatch[1]).trim() || null;
    } catch {
      workspaceId = wsMatch[1].trim() || null;
    }
  }

  const agMatch = pathname.match(/\/ag\/([A-Za-z0-9-]{8,})/);
  if (agMatch?.[1]) {
    agentId = agMatch[1].trim();
  }

  if (doc) {
    if (!workspaceId) {
      const selectedRow = doc.querySelector<HTMLElement>(
        '[data-testid^="sidebar-workspace-row-"][aria-selected="true"]',
      );
      const rawTestId = selectedRow?.getAttribute("data-testid") ?? "";
      const stripped = rawTestId.replace(/^sidebar-workspace-row-(?:local:)?/, "").trim();
      if (stripped.startsWith("wks_")) {
        workspaceId = stripped;
      }
    }

    if (!agentId) {
      const tabs = Array.from(
        doc.querySelectorAll<HTMLElement>('[data-testid^="workspace-tab-agent_"]'),
      ).filter((el) => {
        const tid = el.getAttribute("data-testid") ?? "";
        return (
          !tid.startsWith("workspace-tab-context-") &&
          !tid.startsWith("workspace-tab-menu-") &&
          !tid.startsWith("workspace-tab-tooltip-") &&
          !tid.startsWith("workspace-tab-modified-") &&
          !tid.startsWith("workspace-tab-close-")
        );
      });
      const selectedTab =
        tabs.find(
          (el) =>
            el.getAttribute("aria-selected") === "true" ||
            el.getAttribute("data-state") === "active",
        ) ??
        (tabs.length === 1 ? tabs[0] : null);
      if (selectedTab) {
        const tid = selectedTab.getAttribute("data-testid") ?? "";
        const extracted = tid.slice("workspace-tab-agent_".length).trim();
        if (extracted) {
          agentId = extracted;
        }
      }
    }
  }

  return { workspaceId, agentId };
}

function findReactFiber(el: Element | null): Record<string, any> | null {
  if (!el) return null;
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  return key ? ((el as unknown as Record<string, any>)[key] ?? null) : null;
}

export function navigateToLineageNode(
  node: Pick<
    SessionLineageNode,
    "workspaceId" | "agentId" | "projectId" | "projectName"
  >,
  doc?: Document | null,
  win?: Window | null,
): boolean {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  const w = win ?? (typeof window !== "undefined" ? window : null);
  if (!d || !w) return false;

  // Fast path 1: If Paseo's native subagent track pill is mounted for this agentId, click it
  if (node.agentId) {
    const trackBtn = d.querySelector<HTMLElement>(
      `[data-testid="subagent-track-${node.agentId}"]`,
    );
    if (trackBtn) {
      trackBtn.click();
      return true;
    }
  }

  const focused = focusWorkspaceInApp(
    node.workspaceId,
    node.projectId,
    d as never,
    w as never,
    { projectName: node.projectName },
  );

  const trySelectAgentTab = () => {
    if (!node.agentId) return;
    const tab = d.querySelector<HTMLElement>(
      `[data-testid="workspace-tab-agent_${node.agentId}"]`,
    );
    if (tab) {
      if (tab.getAttribute("aria-selected") !== "true") {
        tab.click();
      }
      return;
    }
    const nativeTrack = d.querySelector<HTMLElement>(
      `[data-testid="subagent-track-${node.agentId}"]`,
    );
    if (nativeTrack) {
      nativeTrack.click();
    }
  };

  trySelectAgentTab();
  for (const delay of [90, 220, 460]) {
    setTimeout(trySelectAgentTab, delay);
  }
  return focused;
}

export function enhanceTimelineSentByButtons(
  data: RpcOutput<typeof manageSessionLineageRpc> | null,
  doc?: Document | null,
  win?: Window | null,
): number {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  const w = win ?? (typeof window !== "undefined" ? window : null);
  if (!d || !w || !data?.current) return 0;

  const currentId = data.current.agentId;
  const peerCandidates: SessionLineageNode[] = [
    ...(data.children ?? []),
    ...(data.parent ? [data.parent] : []),
    ...(data.siblings ?? []),
  ].filter((n) => n.agentId && n.agentId !== currentId);
  if (peerCandidates.length === 0) return 0;

  let healedCount = 0;
  const buttons = Array.from(d.querySelectorAll<HTMLButtonElement>("button"));
  for (const btn of buttons) {
    const rawText = (btn.textContent ?? "").trim();
    if (!rawText.startsWith("Sent by ") && !rawText.startsWith("发送自 ")) {
      continue;
    }

    let cur = findReactFiber(btn);
    let senderFiber: Record<string, any> | null = null;
    for (let depth = 0; depth < 12 && cur; depth++, cur = cur.return) {
      const p = cur.memoizedProps ?? cur.pendingProps;
      if (p && typeof p === "object" && p.sender && typeof p.sender.id === "string") {
        senderFiber = cur;
        break;
      }
    }

    const senderObj =
      (senderFiber?.memoizedProps?.sender ?? senderFiber?.pendingProps?.sender) as
        | { id?: string; title?: string }
        | undefined;
    const isSelfSender =
      (senderObj?.id && senderObj.id === currentId) ||
      rawText === `Sent by ${data.current.agentTitle}` ||
      rawText === `发送自 ${data.current.agentTitle}`;

    if (!isSelfSender) continue;

    const msgContainer =
      btn.closest('[data-testid^="user-message-"]') ??
      btn.parentElement?.parentElement ??
      btn.parentElement;
    const msgText = (msgContainer?.textContent ?? "").toLowerCase();

    let matchedPeer =
      peerCandidates.find((cand) => {
        const stem = cand.briefPath
          ? cand.briefPath.split("/").pop()?.replace(/\.md$/i, "").toLowerCase()
          : "";
        if (stem && msgText.includes(stem)) return true;
        const titleTail = cand.agentTitle.split(":").pop()?.trim().toLowerCase() ?? "";
        if (titleTail.length >= 6 && msgText.includes(titleTail)) return true;
        return false;
      }) ??
      (peerCandidates.length === 1 ? peerCandidates[0] : null);

    if (!matchedPeer) continue;

    if (senderFiber) {
      for (const f of [senderFiber, senderFiber.alternate]) {
        if (!f) continue;
        for (const propBag of [f.memoizedProps, f.pendingProps]) {
          if (propBag?.sender && typeof propBag.sender === "object") {
            propBag.sender.id = matchedPeer.agentId;
            propBag.sender.title = matchedPeer.agentTitle;
          }
        }
      }
    }

    const prefix = rawText.startsWith("发送自 ") ? "发送自 " : "Sent by ";
    for (const childNode of Array.from(btn.childNodes)) {
      if (childNode.nodeType === 3 && (childNode.textContent ?? "").includes(prefix.trim())) {
        childNode.textContent = `${prefix}${matchedPeer.agentTitle}`;
      }
    }
    if ((btn.textContent ?? "").trim() === rawText) {
      const spans = Array.from(btn.querySelectorAll("span"));
      const targetSpan = spans[spans.length - 1];
      if (targetSpan) {
        targetSpan.textContent = `${prefix}${matchedPeer.agentTitle}`;
      }
    }

    if (btn.getAttribute("data-vec-healed-sender") !== matchedPeer.agentId) {
      btn.setAttribute("data-vec-healed-sender", matchedPeer.agentId);
      const peerTarget = matchedPeer;
      btn.addEventListener("click", () => {
        setTimeout(() => {
          navigateToLineageNode(peerTarget, d, w);
        }, 30);
      });
    }
    healedCount += 1;
  }

  return healedCount;
}

type LineageRpcResponse = RpcOutput<typeof manageSessionLineageRpc>;

let externalJumpToParentFn: (() => Promise<boolean>) | null = null;
let externalReconcileTitlesFn: (() => Promise<LineageRpcResponse | null>) | null = null;

export async function triggerJumpToParentSession(): Promise<boolean> {
  if (!externalJumpToParentFn) return false;
  return externalJumpToParentFn();
}

export async function triggerReconcileSidebarWorkspaceTitles(): Promise<LineageRpcResponse | null> {
  if (!externalReconcileTitlesFn) return null;
  return externalReconcileTitlesFn();
}

export function installDesktopSessionLineageEnhancer(
  client: SessionLineageWebClient,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const cacheByKey = new Map<
    string,
    {
      data: LineageRpcResponse;
      fetchedAtMs: number;
      inFlight?: Promise<LineageRpcResponse | null>;
    }
  >();

  let lastRouteKey = "";
  let childrenPopoverOpen = false;
  let rafId: number | null = null;
  let pollId: ReturnType<typeof setInterval> | null = null;
  let initialReconcileDone = false;

  const isZh = (): boolean =>
    isChineseLocale(client.getLocale?.() ?? window.navigator?.language);

  const fetchLineage = async (
    workspaceId: string | null,
    agentId: string | null,
    force = false,
    action: "inspect" | "reconcile" = "inspect",
  ): Promise<LineageRpcResponse | null> => {
    const key = `${workspaceId ?? ""}:${agentId ?? ""}`;
    if (!workspaceId && !agentId && action !== "reconcile") return null;

    const cached = cacheByKey.get(key);
    const now = Date.now();
    if (!force && action === "inspect" && cached && now - cached.fetchedAtMs < 6_000) {
      return cached.data;
    }
    if (!force && action === "inspect" && cached?.inFlight) {
      return cached.inFlight;
    }

    const promise = client
      .call(manageSessionLineageRpc, {
        action,
        workspaceId: workspaceId ?? undefined,
        agentId: agentId ?? undefined,
        autoFixTitles: true,
        source: "lineage-bar",
      })
      .then((res) => {
        cacheByKey.set(key, { data: res, fetchedAtMs: Date.now() });
        return res;
      })
      .catch(() => null);

    if (cached) {
      cached.inFlight = promise;
    } else {
      cacheByKey.set(key, {
        data: {
          ok: true,
          action: "inspect",
          current: null,
          parent: null,
          siblings: [],
          children: [],
          reconcileSummary: {
            untitledFound: 0,
            renamedCount: 0,
            unlinkedFound: 0,
            linkedCount: 0,
            renamedWorkspaces: [],
          },
          message: "",
          durationMs: 0,
        },
        fetchedAtMs: 0,
        inFlight: promise,
      });
    }
    return promise;
  };

  externalJumpToParentFn = async () => {
    const { workspaceId, agentId } = extractCurrentWorkspaceAndAgent(document, window);
    const data = await fetchLineage(workspaceId, agentId, true, "inspect");
    if (data?.parent) {
      return navigateToLineageNode(data.parent, document, window);
    }
    return false;
  };

  externalReconcileTitlesFn = async () => {
    const { workspaceId, agentId } = extractCurrentWorkspaceAndAgent(document, window);
    const res = await fetchLineage(workspaceId, agentId, true, "reconcile");
    if (res) {
      renderLineageBar(res);
    }
    return res;
  };

  const statusDotColor = (
    status: string,
    tokens: ReturnType<typeof syncPaseoThemeCssVariables>,
  ): string => {
    if (status === "running") return tokens.statusWarning;
    if (status === "failed" || status === "error") return tokens.destructive;
    return tokens.statusSuccess;
  };

  const renderLineageBar = (data: LineageRpcResponse | null) => {
    enhanceTimelineSentByButtons(data, document, window);

    const existing = document.querySelector<HTMLElement>(
      '[data-testid="paseo-finder-session-lineage-bar"]',
    );
    const hasParent = Boolean(data?.parent);
    const children = data?.children ?? [];
    const siblings = data?.siblings ?? [];
    const current = data?.current ?? null;
    const hasBriefOrReport = Boolean(
      current?.briefPath || current?.reportPath || current?.notionUrl,
    );

    const hasCrossWorkspaceLineage = Boolean(
      (data?.parent && data.parent.workspaceId !== current?.workspaceId) ||
        children.some((c) => c.workspaceId !== current?.workspaceId),
    );

    if (
      !data ||
      (!hasParent && children.length === 0 && !hasBriefOrReport) ||
      (!hasCrossWorkspaceLineage && !hasBriefOrReport)
    ) {
      existing?.remove();
      return;
    }

    const composer = document.querySelector<HTMLElement>(
      '[data-testid="agent-composer"], [data-testid="message-input-root"]',
    );
    const hostParent = composer?.parentElement ?? null;
    if (!hostParent || !composer) {
      existing?.remove();
      return;
    }

    const displayLabelFor = (node: SessionLineageNode): string =>
      node.workspaceId && node.workspaceId === current?.workspaceId
        ? node.agentTitle || node.workspaceTitle
        : node.workspaceTitle || node.agentTitle;

    const zh = isZh();
    const tokens = syncPaseoThemeCssVariables(document as never, window as never);

    let bar = existing;
    if (!bar || bar.parentElement !== hostParent) {
      existing?.remove();
      bar = document.createElement("div");
      bar.setAttribute("data-testid", "paseo-finder-session-lineage-bar");
      hostParent.insertBefore(bar, composer);
    }

    const sig = JSON.stringify({
      cur: current?.agentId,
      par: data.parent?.agentId,
      parTitle: data.parent ? displayLabelFor(data.parent) : null,
      chCount: children.length,
      chIds: children.slice(0, 6).map((c) => `${c.shortId}:${c.status}:${displayLabelFor(c)}`),
      sibCount: siblings.length,
      brief: current?.briefPath,
      report: current?.reportExists,
      open: childrenPopoverOpen,
      zh,
      theme: tokens.name,
    });

    if (bar.getAttribute("data-render-sig") === sig) {
      return;
    }
    bar.setAttribute("data-render-sig", sig);
    bar.innerHTML = "";

    Object.assign(bar.style, {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      margin: "0 16px 8px 16px",
      padding: "6px 10px",
      borderRadius: "8px",
      backgroundColor: tokens.surface1,
      border: `1px solid ${tokens.border}`,
      fontFamily:
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: "11.5px",
      color: tokens.foreground,
    });

    const topRow = document.createElement("div");
    Object.assign(topRow.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
      flexWrap: "wrap",
    });

    const leftGroup = document.createElement("div");
    Object.assign(leftGroup.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      flexWrap: "wrap",
      minWidth: "0",
    });

    // 1. Parent / Initiating Session 1-Click Jump Pill
    if (data.parent) {
      const parentNode = data.parent;
      const parentDisplay = displayLabelFor(parentNode);
      const parentBtn = document.createElement("button");
      parentBtn.type = "button";
      parentBtn.setAttribute("data-testid", "paseo-finder-lineage-parent-btn");
      parentBtn.title = zh
        ? `点击一键返回发起会话: ${parentDisplay} (#${parentNode.shortId})`
        : `Click to jump back to initiating session: ${parentDisplay} (#${parentNode.shortId})`;

      const dot = document.createElement("span");
      Object.assign(dot.style, {
        width: "6px",
        height: "6px",
        borderRadius: "999px",
        backgroundColor: statusDotColor(parentNode.status, tokens),
        flexShrink: "0",
      });

      const textSpan = document.createElement("span");
      const truncatedParentTitle =
        parentDisplay.length > 38
          ? `${parentDisplay.slice(0, 38)}...`
          : parentDisplay;
      textSpan.textContent = zh
        ? `↖ 发起会话: ${truncatedParentTitle} (#${parentNode.shortId})`
        : `↖ Initiated by: ${truncatedParentTitle} (#${parentNode.shortId})`;

      parentBtn.appendChild(dot);
      parentBtn.appendChild(textSpan);
      Object.assign(parentBtn.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 9px",
        borderRadius: "6px",
        border: `1px solid ${tokens.borderAccent}`,
        backgroundColor: tokens.surface2,
        color: tokens.foreground,
        fontSize: "11.5px",
        fontWeight: "600",
        cursor: "pointer",
      });

      parentBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        navigateToLineageNode(parentNode, document, window);
      });

      leftGroup.appendChild(parentBtn);
    }

    // 2. Spawned Child Sessions Pill + Expandable List
    if (children.length > 0) {
      const runningCount = children.filter((c) => c.status === "running").length;
      const childrenToggleBtn = document.createElement("button");
      childrenToggleBtn.type = "button";
      childrenToggleBtn.setAttribute("data-testid", "paseo-finder-lineage-children-toggle");
      const runningText =
        runningCount > 0
          ? zh
            ? ` · ${runningCount} 运行中`
            : ` · ${runningCount} running`
          : "";
      childrenToggleBtn.textContent = zh
        ? `↘ 派生会话 (${children.length}${runningText}) ${childrenPopoverOpen ? "▴" : "▾"}`
        : `↘ Spawned Sessions (${children.length}${runningText}) ${childrenPopoverOpen ? "▴" : "▾"}`;
      Object.assign(childrenToggleBtn.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "3px 9px",
        borderRadius: "6px",
        border: `1px solid ${tokens.border}`,
        backgroundColor: childrenPopoverOpen ? tokens.surfaceSidebarSelected : tokens.surface2,
        color: childrenPopoverOpen ? tokens.accent : tokens.foreground,
        fontSize: "11.5px",
        fontWeight: "600",
        cursor: "pointer",
      });
      childrenToggleBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        childrenPopoverOpen = !childrenPopoverOpen;
        bar?.removeAttribute("data-render-sig");
        renderLineageBar(data);
      });
      leftGroup.appendChild(childrenToggleBtn);

      // Show up to 3 direct quick-jump child chips inline when collapsed
      if (!childrenPopoverOpen) {
        for (const child of children.slice(0, 3)) {
          const childDisplay = displayLabelFor(child);
          const chip = document.createElement("button");
          chip.type = "button";
          chip.setAttribute(
            "data-testid",
            `paseo-finder-lineage-child-chip-${child.shortId}`,
          );
          const shortTitle =
            childDisplay.length > 24
              ? `${childDisplay.slice(0, 24)}...`
              : childDisplay;
          chip.textContent = `${shortTitle} (#${child.shortId}) ↗`;
          chip.title = `${childDisplay} (#${child.shortId})`;
          Object.assign(chip.style, {
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "2px 8px",
            borderRadius: "999px",
            border: `1px solid ${tokens.border}`,
            backgroundColor: tokens.surface0,
            color: tokens.foregroundMuted,
            fontSize: "11px",
            fontWeight: "500",
            cursor: "pointer",
          });
          chip.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            navigateToLineageNode(child, document, window);
          });
          leftGroup.appendChild(chip);
        }
      }
    }

    // 3. Right side: Brief / Report / Notion quick open links
    const rightGroup = document.createElement("div");
    Object.assign(rightGroup.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      flexWrap: "wrap",
    });

    if (current?.briefPath) {
      const briefBtn = document.createElement("button");
      briefBtn.type = "button";
      briefBtn.textContent = zh ? "任务简报" : "Brief";
      briefBtn.title = current.briefPath;
      Object.assign(briefBtn.style, {
        padding: "2px 8px",
        borderRadius: "5px",
        border: `1px solid ${tokens.border}`,
        backgroundColor: tokens.surface2,
        color: tokens.foregroundMuted,
        fontSize: "11px",
        fontWeight: "500",
        cursor: "pointer",
      });
      briefBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (current.briefPath) {
          void client.call(openFileTargetRpc, {
            workspaceId: current.workspaceId,
            path: current.briefPath,
            target: "finder-reveal",
          });
        }
      });
      rightGroup.appendChild(briefBtn);
    }

    if (current?.reportPath) {
      const reportBtn = document.createElement("button");
      reportBtn.type = "button";
      reportBtn.textContent = current.reportExists
        ? zh
          ? "执行报告 (已生成)"
          : "Report (Ready)"
        : zh
          ? "执行报告 (待写入)"
          : "Report (Pending)";
      reportBtn.title = current.reportPath;
      Object.assign(reportBtn.style, {
        padding: "2px 8px",
        borderRadius: "5px",
        border: `1px solid ${current.reportExists ? tokens.statusSuccess : tokens.border}`,
        backgroundColor: current.reportExists ? tokens.statusSuccessTint : tokens.surface2,
        color: current.reportExists ? tokens.statusSuccess : tokens.foregroundMuted,
        fontSize: "11px",
        fontWeight: "500",
        cursor: "pointer",
      });
      reportBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (current.reportPath) {
          void client.call(openFileTargetRpc, {
            workspaceId: current.workspaceId,
            path: current.reportExists
              ? current.reportPath
              : current.briefPath ?? current.reportPath,
            target: "finder-reveal",
          });
        }
      });
      rightGroup.appendChild(reportBtn);
    }

    if (current?.notionUrl) {
      const notionLink = document.createElement("a");
      notionLink.href = current.notionUrl;
      notionLink.target = "_blank";
      notionLink.rel = "noopener noreferrer";
      notionLink.textContent = zh ? "Notion 任务 ↗" : "Notion Task ↗";
      Object.assign(notionLink.style, {
        padding: "2px 8px",
        borderRadius: "5px",
        border: `1px solid ${tokens.border}`,
        backgroundColor: tokens.surface2,
        color: tokens.foreground,
        fontSize: "11px",
        fontWeight: "500",
        textDecoration: "none",
      });
      rightGroup.appendChild(notionLink);
    }

    topRow.appendChild(leftGroup);
    if (rightGroup.childElementCount > 0) {
      topRow.appendChild(rightGroup);
    }
    bar.appendChild(topRow);

    // 4. Expanded Children List Drawer inside Bar
    if (childrenPopoverOpen && children.length > 0) {
      const listGrid = document.createElement("div");
      Object.assign(listGrid.style, {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: "6px",
        paddingTop: "6px",
        borderTop: `1px solid ${tokens.border}`,
        maxHeight: "210px",
        overflowY: "auto",
      });

      for (const child of children) {
        const itemBtn = document.createElement("button");
        itemBtn.type = "button";
        itemBtn.setAttribute(
          "data-testid",
          `paseo-finder-lineage-child-row-${child.shortId}`,
        );
        Object.assign(itemBtn.style, {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          padding: "5px 8px",
          borderRadius: "6px",
          border: `1px solid ${tokens.border}`,
          backgroundColor: tokens.surface0,
          color: tokens.foreground,
          fontSize: "11px",
          textAlign: "left",
          cursor: "pointer",
        });

        const itemLeft = document.createElement("div");
        Object.assign(itemLeft.style, {
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
          backgroundColor: statusDotColor(child.status, tokens),
          flexShrink: "0",
        });

        const titleSpan = document.createElement("span");
        titleSpan.textContent = displayLabelFor(child);
        Object.assign(titleSpan.style, {
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: "500",
        });

        itemLeft.appendChild(dot);
        itemLeft.appendChild(titleSpan);

        const metaSpan = document.createElement("span");
        metaSpan.textContent = `#${child.shortId} ↗`;
        Object.assign(metaSpan.style, {
          color: tokens.foregroundMuted,
          fontSize: "10.5px",
          flexShrink: "0",
        });

        itemBtn.appendChild(itemLeft);
        itemBtn.appendChild(metaSpan);
        itemBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          navigateToLineageNode(child, document, window);
        });

        listGrid.appendChild(itemBtn);
      }

      bar.appendChild(listGrid);
    }
  };

  const syncLineageForCurrentRoute = (force = false) => {
    const { workspaceId, agentId } = extractCurrentWorkspaceAndAgent(document, window);
    const routeKey = `${workspaceId ?? ""}:${agentId ?? ""}`;
    if (!workspaceId && !agentId) {
      lastRouteKey = "";
      renderLineageBar(null);
      return;
    }

    const routeChanged = routeKey !== lastRouteKey;
    if (routeChanged) {
      lastRouteKey = routeKey;
      childrenPopoverOpen = false;
    }

    const cached = cacheByKey.get(routeKey)?.data ?? null;
    if (cached) {
      renderLineageBar(cached);
    }

    const action = !initialReconcileDone ? "reconcile" : "inspect";
    initialReconcileDone = true;

    void fetchLineage(workspaceId, agentId, force || routeChanged, action).then((res) => {
      const nowActive = extractCurrentWorkspaceAndAgent(document, window);
      if (`${nowActive.workspaceId ?? ""}:${nowActive.agentId ?? ""}` === routeKey) {
        renderLineageBar(res);
      }
    });
  };

  const observer = new MutationObserver(() => {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      syncLineageForCurrentRoute(false);
    });
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  pollId = setInterval(() => {
    syncLineageForCurrentRoute(true);
  }, 10_000);

  const onKeyDown = (ev: KeyboardEvent) => {
    // Alt+Up or Cmd+Shift+Up jumps back to the initiating (parent) session
    if (
      (ev.metaKey || ev.ctrlKey) &&
      ev.shiftKey &&
      !ev.altKey &&
      ev.key === "ArrowUp"
    ) {
      const { workspaceId, agentId } = extractCurrentWorkspaceAndAgent(document, window);
      const cached = cacheByKey.get(`${workspaceId ?? ""}:${agentId ?? ""}`)?.data;
      if (cached?.parent) {
        ev.preventDefault();
        ev.stopPropagation();
        navigateToLineageNode(cached.parent, document, window);
      }
    }
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("popstate", () => syncLineageForCurrentRoute(true), false);
  setTimeout(() => syncLineageForCurrentRoute(true), 120);

  return () => {
    externalJumpToParentFn = null;
    externalReconcileTitlesFn = null;
    observer.disconnect();
    if (pollId) clearInterval(pollId);
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    window.removeEventListener("keydown", onKeyDown, true);
    document
      .querySelector('[data-testid="paseo-finder-session-lineage-bar"]')
      ?.remove();
  };
}
