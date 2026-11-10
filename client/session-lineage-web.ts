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

type LineageRpcResponse = RpcOutput<typeof manageSessionLineageRpc>;

export interface SessionJumpBreadcrumb {
  from: SessionLineageNode;
  toAgentId: string;
  toWorkspaceId: string;
  atMs: number;
}

const BREADCRUMB_STORAGE_KEY = "paseo_finder_session_jump_breadcrumb_v1";
const globalSessionDirectoryByAgentId = new Map<string, SessionLineageNode>();
const globalSessionDirectoryByWorkspaceId = new Map<string, SessionLineageNode[]>();
let jumpBreadcrumbStack: SessionJumpBreadcrumb[] = [];
let metroNavigateToAgentFn:
  | ((opts: { serverId: string; agentId: string; workspaceId?: string }) => unknown)
  | null = null;

export function clearSessionDirectoryForTests(): void {
  globalSessionDirectoryByAgentId.clear();
  globalSessionDirectoryByWorkspaceId.clear();
  jumpBreadcrumbStack = [];
  metroNavigateToAgentFn = null;
}

function upsertDirectoryNode(node: SessionLineageNode | null | undefined): void {
  if (!node || !node.agentId) return;
  const existing = globalSessionDirectoryByAgentId.get(node.agentId);
  const merged: SessionLineageNode = existing
    ? {
        ...existing,
        ...node,
        providerSessionId: node.providerSessionId ?? existing.providerSessionId ?? null,
        briefPath: node.briefPath ?? existing.briefPath ?? null,
        reportPath: node.reportPath ?? existing.reportPath ?? null,
        reportExists: node.reportExists || existing.reportExists,
        notionUrl: node.notionUrl ?? existing.notionUrl ?? null,
        notionTaskId: node.notionTaskId ?? existing.notionTaskId ?? null,
      }
    : {
        ...node,
        shortId: node.shortId || node.agentId.slice(0, 8),
      };
  globalSessionDirectoryByAgentId.set(merged.agentId, merged);

  if (merged.workspaceId) {
    const wsList = globalSessionDirectoryByWorkspaceId.get(merged.workspaceId) ?? [];
    const idx = wsList.findIndex((item) => item.agentId === merged.agentId);
    if (idx >= 0) {
      wsList[idx] = merged;
    } else {
      wsList.push(merged);
    }
    globalSessionDirectoryByWorkspaceId.set(merged.workspaceId, wsList);
  }
}

export function ingestSessionLineageResponse(data: LineageRpcResponse | null | undefined): void {
  if (!data) return;
  upsertDirectoryNode(data.current);
  upsertDirectoryNode(data.parent);
  for (const ch of data.children ?? []) upsertDirectoryNode(ch);
  for (const sb of data.siblings ?? []) upsertDirectoryNode(sb);
  for (const pp of data.projectPeers ?? []) upsertDirectoryNode(pp);
  for (const dn of data.directory ?? []) upsertDirectoryNode(dn);
}

let cachedLiveMetroMap: Map<
  number,
  { isInitialized?: boolean; publicModule?: { exports?: Record<string, any> } }
> | null = null;

export function getMetroModuleList(
  win?: Window | null,
): Array<{ isInitialized?: boolean; publicModule?: { exports?: Record<string, any> } }> {
  const w = (win ?? (typeof window !== "undefined" ? window : null)) as
    | (Window & {
        __c?: unknown;
        __r?: unknown;
      })
    | null;
  if (!w) return [];

  const registry = w.__c;
  if (registry && typeof registry === "object") {
    return registry instanceof Map
      ? Array.from(registry.values())
      : Object.values(registry as Record<string, any>);
  }

  if (!cachedLiveMetroMap && typeof w.__r === "function") {
    const origMapGet = Map.prototype.get;
    try {
      Map.prototype.get = function (this: Map<unknown, unknown>, key: unknown) {
        if (key === 0 && !cachedLiveMetroMap && this instanceof Map && this.size > 50) {
          cachedLiveMetroMap = this as unknown as Map<
            number,
            { isInitialized?: boolean; publicModule?: { exports?: Record<string, any> } }
          >;
        }
        return origMapGet.call(this, key);
      };
      try {
        (w.__r as (id: number) => unknown)(0);
      } catch {
        // ignore
      }
    } finally {
      Map.prototype.get = origMapGet;
    }
  }

  if (cachedLiveMetroMap) {
    return Array.from(cachedLiveMetroMap.values());
  }
  return [];
}

export function syncSessionDirectoryFromMetro(win?: Window | null): number {
  const modules = getMetroModuleList(win);
  if (modules.length === 0) return 0;

  let syncedCount = 0;
  for (const mod of modules) {
    if (!mod || mod.isInitialized !== true) continue;
    const exp = mod.publicModule?.exports;
    if (!exp || (typeof exp !== "object" && typeof exp !== "function")) continue;

    if (typeof exp.navigateToAgent === "function") {
      metroNavigateToAgentFn = exp.navigateToAgent;
    }

    if (typeof exp.useSessionStore?.getState === "function") {
      try {
        const state = exp.useSessionStore.getState();
        const sessions = state?.sessions ?? {};
        for (const session of Object.values(sessions) as Array<Record<string, any>>) {
          if (!session) continue;
          const workspacesMap: Map<string, any> | undefined = session.workspaces;
          const projectsMap: Map<string, any> | undefined = session.projects;
          const agentsMap: Map<string, any> | undefined = session.agents;
          if (!agentsMap || typeof agentsMap.values !== "function") continue;

          for (const ag of agentsMap.values()) {
            if (!ag?.id || ag.archivedAt) continue;
            const aid = String(ag.id).trim();
            const wsId = String(ag.workspaceId ?? "").trim();
            const ws = wsId && workspacesMap?.get ? workspacesMap.get(wsId) : null;
            const projId = String(ws?.projectId ?? ag.projectPlacement?.projectId ?? "").trim() || null;
            const proj = projId && projectsMap?.get ? projectsMap.get(projId) : null;
            const projectName =
              String(
                proj?.projectCustomName ??
                  proj?.projectDisplayName ??
                  ws?.projectCustomName ??
                  ws?.projectDisplayName ??
                  "",
              ).trim() || null;
            const agentTitle = String(ag.title ?? "").trim() || aid.slice(0, 8);
            const workspaceTitle =
              String(ws?.title ?? "").trim() ||
              (ws?.name && ws.name !== "main" ? String(ws.name) : agentTitle);
            const status =
              ag.turn?.phase === "open" || ag.status === "running"
                ? "running"
                : String(ag.status ?? "idle");

            upsertDirectoryNode({
              agentId: aid,
              shortId: aid.slice(0, 8),
              agentTitle,
              workspaceId: wsId,
              workspaceTitle,
              projectId: projId,
              projectName,
              status,
              provider: String(ag.provider ?? "antigravity"),
              model: "default",
              providerSessionId: null,
              createdAt:
                ag.createdAt instanceof Date
                  ? ag.createdAt.toISOString()
                  : typeof ag.createdAt === "string"
                    ? ag.createdAt
                    : null,
              updatedAt:
                ag.lastActivityAt instanceof Date
                  ? ag.lastActivityAt.toISOString()
                  : typeof ag.lastActivityAt === "string"
                    ? ag.lastActivityAt
                    : null,
              briefPath: null,
              reportPath: null,
              reportExists: false,
              notionUrl: null,
              notionTaskId: null,
            });
            syncedCount += 1;
          }
        }
      } catch {
        // Ignore store inspection errors
      }
    }
  }
  return syncedCount;
}

export function resolveSessionReference(
  rawToken: string | null | undefined,
  excludeAgentId?: string | null,
): SessionLineageNode | null {
  if (!rawToken) return null;
  let cleaned = rawToken
    .trim()
    .replace(/^[`"'(<\[]+|[`"')>\],.;:!?]+$/g, "")
    .trim();
  if (!cleaned) return null;

  cleaned = cleaned
    .replace(/^conversation:\/\//i, "")
    .replace(/^paseo:\/\/(?:agent|workspace)\//i, "")
    .replace(/^(?:agent|workspace):[^:]+:/i, "")
    .replace(/^local:/i, "")
    .replace(/^#/, "")
    .trim();

  if (!cleaned || cleaned.length < 6) return null;
  const lower = cleaned.toLowerCase();

  // 1. Workspace ID lookup (e.g. wks_76550e777429eb04)
  if (lower.startsWith("wks_")) {
    for (const [wsId, list] of globalSessionDirectoryByWorkspaceId.entries()) {
      if (wsId.toLowerCase() === lower || wsId.toLowerCase().startsWith(lower)) {
        const candidate = list.find((n) => n.agentId !== excludeAgentId) ?? list[0] ?? null;
        if (candidate && candidate.agentId !== excludeAgentId) return candidate;
      }
    }
    return null;
  }

  // 2. Must look like a UUID or 7..16 char hex prefix (e.g. fa22464, fa224642, or full UUID)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lower);
  const isHexPrefix = /^[0-9a-f]{7,16}$/i.test(lower);
  if (!isUuid && !isHexPrefix) return null;

  const exact = globalSessionDirectoryByAgentId.get(lower);
  if (exact && exact.agentId !== excludeAgentId) return exact;

  for (const node of globalSessionDirectoryByAgentId.values()) {
    if (node.agentId === excludeAgentId) continue;
    const aidLower = node.agentId.toLowerCase();
    if (aidLower === lower || aidLower.startsWith(lower)) {
      return node;
    }
    const pSidLower = (node.providerSessionId ?? "").toLowerCase();
    if (pSidLower && (pSidLower === lower || pSidLower.startsWith(lower))) {
      return node;
    }
  }

  // 3. Also check if hex prefix matches a workspaceId suffix (wks_<hex>)
  for (const [wsId, list] of globalSessionDirectoryByWorkspaceId.entries()) {
    const strippedWs = wsId.toLowerCase().replace(/^wks_/, "");
    if (strippedWs.length >= 7 && (strippedWs === lower || strippedWs.startsWith(lower))) {
      const candidate = list.find((n) => n.agentId !== excludeAgentId) ?? list[0] ?? null;
      if (candidate && candidate.agentId !== excludeAgentId) return candidate;
    }
  }

  return null;
}

function loadJumpBreadcrumbs(win?: Window | null): SessionJumpBreadcrumb[] {
  if (jumpBreadcrumbStack.length > 0) return jumpBreadcrumbStack;
  try {
    const raw = win?.sessionStorage?.getItem(BREADCRUMB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        jumpBreadcrumbStack = parsed.slice(-16);
      }
    }
  } catch {
    // Ignore storage errors
  }
  return jumpBreadcrumbStack;
}

function saveJumpBreadcrumbs(win?: Window | null): void {
  try {
    win?.sessionStorage?.setItem(
      BREADCRUMB_STORAGE_KEY,
      JSON.stringify(jumpBreadcrumbStack.slice(-16)),
    );
  } catch {
    // Ignore storage errors
  }
}

export function recordSessionJump(
  from: SessionLineageNode | null | undefined,
  to: Pick<SessionLineageNode, "agentId" | "workspaceId">,
  win?: Window | null,
): void {
  if (!from || !from.agentId) return;
  if (from.agentId === to.agentId && from.workspaceId === to.workspaceId) return;
  const stack = loadJumpBreadcrumbs(win);
  const filtered = stack.filter(
    (entry) =>
      !(entry.toAgentId === to.agentId && entry.from.agentId === from.agentId),
  );
  filtered.push({
    from,
    toAgentId: to.agentId,
    toWorkspaceId: to.workspaceId,
    atMs: Date.now(),
  });
  jumpBreadcrumbStack = filtered.slice(-16);
  saveJumpBreadcrumbs(win);
}

export function getReturnBreadcrumbForSession(
  workspaceId: string | null | undefined,
  agentId: string | null | undefined,
  win?: Window | null,
): SessionLineageNode | null {
  const stack = loadJumpBreadcrumbs(win);
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i];
    if (!entry) continue;
    if (
      (agentId && entry.toAgentId === agentId) ||
      (workspaceId && entry.toWorkspaceId === workspaceId && entry.from.workspaceId !== workspaceId)
    ) {
      if (entry.from.agentId !== agentId) {
        return globalSessionDirectoryByAgentId.get(entry.from.agentId) ?? entry.from;
      }
    }
  }
  return null;
}

export function clearReturnBreadcrumbForSession(
  workspaceId: string | null | undefined,
  agentId: string | null | undefined,
  win?: Window | null,
): void {
  const stack = loadJumpBreadcrumbs(win);
  jumpBreadcrumbStack = stack.filter(
    (entry) =>
      !(
        (agentId && entry.toAgentId === agentId) ||
        (workspaceId && entry.toWorkspaceId === workspaceId)
      ),
  );
  saveJumpBreadcrumbs(win);
}

export function patchCommandCenterSearch(win?: Window | null): boolean {
  const w = win ?? (typeof window !== "undefined" ? window : null);
  const modules = getMetroModuleList(w);
  if (modules.length === 0) return false;

  syncSessionDirectoryFromMetro(w);
  let patchedAny = false;

  for (const mod of modules) {
    if (!mod || mod.isInitialized !== true) continue;
    const exp = mod.publicModule?.exports;
    if (!exp || typeof exp !== "object") continue;

    // 1. Patch CommandCenter built-in agent search (filterAndRankBuiltInResults)
    if (
      typeof exp.filterAndRankBuiltInResults === "function" &&
      !exp.__paseoSessionIdSearchPatched
    ) {
      const origFilterBuiltIn = exp.filterAndRankBuiltInResults;
      exp.filterAndRankBuiltInResults = function patchedFilterAndRankBuiltInResults(
        items: any[],
        query: string,
        getFields: (row: any) => { visible: string[]; hidden: string[] },
      ) {
        if (!Array.isArray(items)) {
          return origFilterBuiltIn.call(this, items, query, getFields);
        }
        syncSessionDirectoryFromMetro(w);
        const qTrim = (query ?? "").trim();
        const qTokens = qTrim
          .toLowerCase()
          .split(/\s+/)
          .map((t) => t.replace(/^#/, ""))
          .filter(Boolean);

        const matchesAgentIdTokens = (aid: string, wsId: string, provId: string): boolean => {
          const aidLower = aid.toLowerCase();
          const wsLower = wsId.toLowerCase();
          const provLower = provId.toLowerCase();
          return qTokens.some(
            (tok) =>
              tok.length >= 4 &&
              (aidLower.startsWith(tok) ||
                wsLower.includes(tok) ||
                (provLower && provLower.startsWith(tok))),
          );
        };

        const enrichedItems = items.map((row) => {
          if (row?.kind !== "agent" || !row.agent?.id) return row;
          const aid = String(row.agent.id).trim();
          const wsId = String(row.agent.workspaceId ?? "").trim();
          const dirNode = globalSessionDirectoryByAgentId.get(aid);
          const provId = String(dirNode?.providerSessionId ?? "").trim();
          const idHit = matchesAgentIdTokens(aid, wsId, provId);

          const short7 = aid.slice(0, 7);
          const subtitle = String(row.subtitle ?? "").trim();
          const badge = `#${short7}`;
          const nextSubtitle = !idHit
            ? subtitle
            : subtitle.includes(short7)
              ? subtitle
              : subtitle
                ? `${subtitle} \u00b7 ${badge}`
                : badge;
          const origRun = row.run;
          return {
            ...row,
            subtitle: nextSubtitle,
            run:
              typeof origRun === "function"
                ? () => {
                    const cur = extractCurrentWorkspaceAndAgent(w?.document, w);
                    const fromNode =
                      (cur.agentId ? globalSessionDirectoryByAgentId.get(cur.agentId) : null) ??
                      (cur.workspaceId
                        ? globalSessionDirectoryByWorkspaceId.get(cur.workspaceId)?.[0]
                        : null);
                    recordSessionJump(
                      fromNode,
                      {
                        agentId: aid,
                        workspaceId: wsId,
                      },
                      w,
                    );
                    return origRun();
                  }
                : origRun,
          };
        });

        const wrappedGetFields = (row: any) => {
          const base =
            typeof getFields === "function"
              ? getFields(row)
              : { visible: [row?.title ?? "", row?.subtitle ?? ""], hidden: [] };
          if (row?.kind !== "agent" || !row.agent?.id) return base;
          const aid = String(row.agent.id).trim();
          const short7 = aid.slice(0, 7);
          const short8 = aid.slice(0, 8);
          const wsId = String(row.agent.workspaceId ?? "").trim();
          const dirNode = globalSessionDirectoryByAgentId.get(aid);
          const provId = String(dirNode?.providerSessionId ?? "").trim();
          const idHit = matchesAgentIdTokens(aid, wsId, provId);
          const extraHidden = [
            ...(idHit
              ? [aid, short7, short8, `#${short7}`, `#${short8}`, wsId, wsId.replace(/^wks_/, ""), provId]
              : []),
            dirNode?.projectName ?? "",
            dirNode?.workspaceTitle ?? "",
          ].filter(Boolean);
          return {
            visible: [row.title ?? "", row.subtitle ?? ""],
            hidden: [...(base.hidden ?? []), ...extraHidden],
          };
        };

        return origFilterBuiltIn.call(this, enrichedItems, query, wrappedGetFields);
      };
      exp.__paseoSessionIdSearchPatched = true;
      patchedAny = true;
    }

    // 2. Patch CommandCenter workspace search (filterAndRankWorkspaces)
    if (
      typeof exp.filterAndRankWorkspaces === "function" &&
      !exp.__paseoWorkspaceIdSearchPatched
    ) {
      const origFilterWorkspaces = exp.filterAndRankWorkspaces;
      exp.filterAndRankWorkspaces = function patchedFilterAndRankWorkspaces(
        workspaces: any[],
        query: string,
      ) {
        if (!Array.isArray(workspaces)) {
          return origFilterWorkspaces.call(this, workspaces, query);
        }
        syncSessionDirectoryFromMetro(w);
        const qTrim = (query ?? "").trim();
        if (!qTrim) {
          return origFilterWorkspaces.call(this, workspaces, query);
        }
        const qTokens = qTrim
          .toLowerCase()
          .split(/\s+/)
          .map((t) => t.replace(/^#/, ""))
          .filter(Boolean);

        const enrichedWorkspaces = workspaces.map((ws) => {
          const wsId = String(ws?.workspaceId ?? "").trim();
          if (!wsId) return ws;
          const wsAgents = globalSessionDirectoryByWorkspaceId.get(wsId) ?? [];
          let matchedBadge: string | null = null;
          let matchedAgentNode: SessionLineageNode | null = null;

          for (const tok of qTokens) {
            if (tok.length < 3) continue;
            if (
              wsId.toLowerCase() === tok ||
              wsId.toLowerCase().replace(/^wks_/, "").startsWith(tok)
            ) {
              matchedBadge = wsId;
              break;
            }
            const agHit = wsAgents.find(
              (a) =>
                a.agentId.toLowerCase().startsWith(tok) ||
                (a.providerSessionId && a.providerSessionId.toLowerCase().startsWith(tok)) ||
                a.agentTitle.toLowerCase().includes(tok),
            );
            if (agHit) {
              matchedAgentNode = agHit;
              matchedBadge = `#${agHit.agentId.slice(0, 7)}`;
              break;
            }
          }

          if (!matchedBadge) return ws;
          const subtitle = String(ws.subtitle ?? "").trim();
          const nextSubtitle = subtitle.includes(matchedBadge)
            ? subtitle
            : subtitle
              ? `${subtitle} \u00b7 ${matchedBadge}`
              : matchedBadge;
          const origRun = ws.run;
          return {
            ...ws,
            subtitle: nextSubtitle,
            run:
              typeof origRun === "function"
                ? () => {
                    const cur = extractCurrentWorkspaceAndAgent(w?.document, w);
                    const fromNode =
                      (cur.agentId ? globalSessionDirectoryByAgentId.get(cur.agentId) : null) ??
                      (cur.workspaceId
                        ? globalSessionDirectoryByWorkspaceId.get(cur.workspaceId)?.[0]
                        : null);
                    recordSessionJump(
                      fromNode,
                      {
                        agentId: matchedAgentNode?.agentId ?? "",
                        workspaceId: wsId,
                      },
                      w,
                    );
                    if (matchedAgentNode && metroNavigateToAgentFn) {
                      return metroNavigateToAgentFn({
                        serverId: String(ws.serverId ?? "local"),
                        agentId: matchedAgentNode.agentId,
                        workspaceId: wsId,
                      });
                    }
                    return origRun();
                  }
                : origRun,
          };
        });

        return origFilterWorkspaces.call(this, enrichedWorkspaces, query);
      };
      exp.__paseoWorkspaceIdSearchPatched = true;
      patchedAny = true;
    }
  }

  return patchedAny;
}

export function navigateToLineageNode(
  node: Pick<
    SessionLineageNode,
    "workspaceId" | "agentId" | "projectId" | "projectName"
  >,
  doc?: Document | null,
  win?: Window | null,
  fromOrigin?: SessionLineageNode | { recordBreadcrumb?: boolean } | null,
): boolean {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  const w = win ?? (typeof window !== "undefined" ? window : null);
  if (!d || !w) return false;

  syncSessionDirectoryFromMetro(w);
  const currentActive = extractCurrentWorkspaceAndAgent(d, w);
  const isOptionsObj =
    fromOrigin !== null &&
    typeof fromOrigin === "object" &&
    !("agentId" in fromOrigin);
  const shouldRecordBreadcrumb = isOptionsObj
    ? fromOrigin.recordBreadcrumb !== false
    : true;
  const explicitOriginNode =
    fromOrigin && "agentId" in fromOrigin ? fromOrigin : null;

  const resolvedOrigin =
    explicitOriginNode ??
    (currentActive.agentId ? globalSessionDirectoryByAgentId.get(currentActive.agentId) : null) ??
    (currentActive.workspaceId
      ? globalSessionDirectoryByWorkspaceId.get(currentActive.workspaceId)?.[0]
      : null) ??
    null;

  if (shouldRecordBreadcrumb && resolvedOrigin && (node.agentId || node.workspaceId)) {
    recordSessionJump(
      resolvedOrigin,
      {
        agentId: node.agentId,
        workspaceId: node.workspaceId,
      },
      w,
    );
  }

  // Fast path 0: Use Paseo's native Metro navigateToAgent when navigating to a known agentId
  if (node.agentId && metroNavigateToAgentFn) {
    try {
      metroNavigateToAgentFn({
        serverId: "local",
        agentId: node.agentId,
        workspaceId: node.workspaceId || undefined,
      });
    } catch {
      // Fall through to DOM navigation
    }
  }

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

export function enhanceTimelineAgentMentions(
  data: RpcOutput<typeof manageSessionLineageRpc> | null,
  doc?: Document | null,
  win?: Window | null,
): SessionLineageNode[] {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  const w = win ?? (typeof window !== "undefined" ? window : null);
  if (!d || !w) return [];

  ingestSessionLineageResponse(data);
  syncSessionDirectoryFromMetro(w);

  const currentActive = extractCurrentWorkspaceAndAgent(d, w);
  const currentId = data?.current?.agentId ?? currentActive.agentId ?? null;
  const currentNode =
    data?.current ??
    (currentId ? globalSessionDirectoryByAgentId.get(currentId) ?? null : null);
  const tokens = syncPaseoThemeCssVariables(d as never, w as never);
  const zh = isChineseLocale(w.navigator?.language);

  const referencedById = new Map<string, SessionLineageNode>();

  const statusColorFor = (status: string): string => {
    if (status === "running") return tokens.statusWarning;
    if (status === "failed" || status === "error") return tokens.destructive;
    return tokens.statusSuccess;
  };

  // 0. Wrap bare plain-text session IDs inside timeline message bubbles (e.g. "Paseo agent af81b8f0") into <code> so they become interactive pills
  const timelineRoot = d.querySelector<HTMLElement>('[data-testid="agent-timeline"]');
  if (timelineRoot && typeof d.createTreeWalker === "function") {
    const walker = d.createTreeWalker(timelineRoot, 4 /* NodeFilter.SHOW_TEXT */);
    const textNodesToProcess: Text[] = [];
    let curText = walker.nextNode();
    while (curText) {
      const parentEl = curText.parentElement;
      if (
        parentEl &&
        !parentEl.closest(
          'code, pre, a, button, [role="button"], [data-testid="paseo-finder-session-lineage-bar"], [data-testid="agent-composer"], [data-testid="message-input-root"]',
        )
      ) {
        const val = curText.nodeValue ?? "";
        if (
          val.length >= 7 &&
          (/(?:^|[\s(,#])[0-9a-f]{7,8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?(?=$|[\s),.:;!?])/i.test(
            val,
          ) ||
            /\bwks_[0-9a-zA-Z_-]{4,}\b/.test(val))
        ) {
          textNodesToProcess.push(curText as Text);
        }
      }
      curText = walker.nextNode();
    }

    const tokenRe =
      /\b(wks_[0-9a-zA-Z_-]{4,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{7,8})\b/gi;
    for (const tNode of textNodesToProcess) {
      const text = tNode.nodeValue ?? "";
      tokenRe.lastIndex = 0;
      let match: RegExpExecArray | null = null;
      let hasKnownHit = false;
      while ((match = tokenRe.exec(text)) !== null) {
        if (resolveSessionReference(match[1], currentId)) {
          hasKnownHit = true;
          break;
        }
      }
      if (!hasKnownHit || !tNode.parentNode) continue;

      tokenRe.lastIndex = 0;
      const frag = d.createDocumentFragment();
      let lastIdx = 0;
      while ((match = tokenRe.exec(text)) !== null) {
        const tok = match[1];
        const hit = resolveSessionReference(tok, currentId);
        if (!hit) continue;
        if (match.index > lastIdx) {
          frag.appendChild(d.createTextNode(text.slice(lastIdx, match.index)));
        }
        const codeWrapper = d.createElement("code");
        codeWrapper.setAttribute("data-vec-raw-token", tok);
        codeWrapper.textContent = tok;
        frag.appendChild(codeWrapper);
        lastIdx = match.index + tok.length;
      }
      if (lastIdx > 0) {
        if (lastIdx < text.length) {
          frag.appendChild(d.createTextNode(text.slice(lastIdx)));
        }
        tNode.parentNode.replaceChild(frag, tNode);
      }
    }
  }

  // 1. Upgrade inline <code> elements that reference a known Paseo agent ID / shortId / workspace ID
  const codeEls = Array.from(d.querySelectorAll<HTMLElement>("code"));
  for (const codeEl of codeEls) {
    if (codeEl.closest("pre")) continue;
    if (
      codeEl.closest(
        '[data-testid="agent-composer"], [data-testid="message-input-root"], [data-testid="paseo-finder-session-lineage-bar"], [data-testid="command-center-panel"]',
      )
    ) {
      continue;
    }

    const rawToken =
      codeEl.getAttribute("data-vec-raw-token") ?? (codeEl.textContent ?? "").trim();
    if (!rawToken || rawToken.length < 6 || rawToken.length > 64) continue;

    const matched = resolveSessionReference(rawToken, currentId);
    if (!matched) continue;

    referencedById.set(matched.agentId, matched);

    const short7 = matched.agentId.slice(0, 7);
    const displayTitle = matched.agentTitle || matched.workspaceTitle || short7;
    const shortPreview =
      displayTitle.length > 24 ? `${displayTitle.slice(0, 24)}\u2026` : displayTitle;
    const pillSig = `${matched.agentId}:${matched.status}:${shortPreview}:${tokens.name}`;

    if (codeEl.getAttribute("data-vec-pill-sig") !== pillSig) {
      codeEl.setAttribute("data-vec-raw-token", rawToken);
      codeEl.setAttribute("data-vec-session-pill", matched.agentId);
      codeEl.setAttribute("data-vec-pill-sig", pillSig);
      codeEl.setAttribute("data-testid", `paseo-finder-inline-session-pill-${short7}`);
      codeEl.setAttribute("role", "button");
      codeEl.tabIndex = 0;
      const projPart = matched.projectName ? ` \u00b7 ${matched.projectName}` : "";
      codeEl.title = zh
        ? `\u70b9\u51fb\u8df3\u8f6c\u81f3\u4f1a\u8bdd: ${displayTitle} (#${short7})${projPart} \u00b7 \u72b6\u6001: ${matched.status}`
        : `Click to jump to session: ${displayTitle} (#${short7})${projPart} \u00b7 Status: ${matched.status}`;

      Object.assign(codeEl.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "1px 7px",
        margin: "0 2px",
        borderRadius: "5px",
        border: `1px solid ${tokens.borderAccent}`,
        backgroundColor: tokens.surface2,
        color: tokens.foreground,
        cursor: "pointer",
        verticalAlign: "baseline",
        textDecoration: "none",
        lineHeight: "1.4",
      });

      codeEl.innerHTML = "";
      const dot = d.createElement("span");
      Object.assign(dot.style, {
        width: "6px",
        height: "6px",
        borderRadius: "999px",
        backgroundColor: statusColorFor(matched.status),
        flexShrink: "0",
      });

      const idSpan = d.createElement("span");
      idSpan.textContent = rawToken;
      Object.assign(idSpan.style, {
        fontWeight: "600",
        color: tokens.accent,
      });

      const titleSpan = d.createElement("span");
      titleSpan.setAttribute("data-vec-session-pill-meta", "1");
      titleSpan.textContent = `\u00b7 ${shortPreview} \u2197`;
      Object.assign(titleSpan.style, {
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: "0.88em",
        fontWeight: "500",
        color: tokens.foregroundMuted,
      });

      codeEl.appendChild(dot);
      codeEl.appendChild(idSpan);
      codeEl.appendChild(titleSpan);
    }

    if (codeEl.getAttribute("data-vec-pill-bound") !== matched.agentId) {
      codeEl.setAttribute("data-vec-pill-bound", matched.agentId);
      const targetNode = matched;
      const triggerJump = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
        navigateToLineageNode(targetNode, d, w, currentNode);
      };
      codeEl.addEventListener("click", triggerJump);
      codeEl.addEventListener("keydown", (ke: KeyboardEvent) => {
        if (ke.key === "Enter" || ke.key === " ") {
          triggerJump(ke);
        }
      });
    }
  }

  // 2. Upgrade <a href="conversation://..."> or <a href="paseo://..."> links in chat messages
  const anchorEls = Array.from(d.querySelectorAll<HTMLAnchorElement>("a[href]"));
  for (const anchor of anchorEls) {
    const href = (anchor.getAttribute("href") ?? "").trim();
    if (
      !href.startsWith("conversation://") &&
      !href.startsWith("paseo://agent/") &&
      !href.startsWith("paseo://workspace/")
    ) {
      continue;
    }
    const matched = resolveSessionReference(href, currentId);
    if (!matched) continue;
    referencedById.set(matched.agentId, matched);

    const short7 = matched.agentId.slice(0, 7);
    anchor.setAttribute("data-testid", `paseo-finder-inline-session-link-${short7}`);
    anchor.title = zh
      ? `\u70b9\u51fb\u8df3\u8f6c\u81f3\u4f1a\u8bdd: ${matched.agentTitle} (#${short7})`
      : `Click to jump to session: ${matched.agentTitle} (#${short7})`;
    if (anchor.getAttribute("data-vec-link-bound") !== matched.agentId) {
      anchor.setAttribute("data-vec-link-bound", matched.agentId);
      const targetNode = matched;
      anchor.addEventListener(
        "click",
        (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          navigateToLineageNode(targetNode, d, w, currentNode);
        },
        true,
      );
    }
  }

  return Array.from(referencedById.values());
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

  patchCommandCenterSearch(window);

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
        ingestSessionLineageResponse(res);
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
          projectPeers: [],
          directory: [],
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
    const returnCrumb = getReturnBreadcrumbForSession(workspaceId, agentId, window);
    if (returnCrumb) {
      clearReturnBreadcrumbForSession(workspaceId, agentId, window);
      return navigateToLineageNode(returnCrumb, document, window, {
        recordBreadcrumb: false,
      });
    }
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
    patchCommandCenterSearch(window);
    ingestSessionLineageResponse(data);
    enhanceTimelineSentByButtons(data, document, window);
    const referencedPeers = enhanceTimelineAgentMentions(data, document, window);

    const existing = document.querySelector<HTMLElement>(
      '[data-testid="paseo-finder-session-lineage-bar"]',
    );
    const hasParent = Boolean(data?.parent);
    const children = data?.children ?? [];
    const siblings = data?.siblings ?? [];
    const current = data?.current ?? null;
    const { workspaceId: curWksId, agentId: curAgentId } =
      extractCurrentWorkspaceAndAgent(document, window);
    const returnBreadcrumb = getReturnBreadcrumbForSession(
      current?.workspaceId ?? curWksId,
      current?.agentId ?? curAgentId,
      window,
    );

    const hasBriefOrReport = Boolean(
      current?.briefPath || current?.reportPath || current?.notionUrl,
    );

    const hasCrossWorkspaceLineage = Boolean(
      (data?.parent && data.parent.workspaceId !== current?.workspaceId) ||
        children.some((c) => c.workspaceId !== current?.workspaceId),
    );

    const hasReturnOrPeerMentions = Boolean(
      returnBreadcrumb || referencedPeers.length > 0,
    );

    if (
      !data ||
      (!hasParent &&
        children.length === 0 &&
        !hasBriefOrReport &&
        !hasReturnOrPeerMentions) ||
      (!hasCrossWorkspaceLineage &&
        !hasBriefOrReport &&
        !hasReturnOrPeerMentions)
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
      cur: current?.agentId ?? curAgentId,
      ret: returnBreadcrumb
        ? `${returnBreadcrumb.agentId}:${displayLabelFor(returnBreadcrumb)}`
        : null,
      par: data.parent?.agentId,
      parTitle: data.parent ? displayLabelFor(data.parent) : null,
      chCount: children.length,
      chIds: children.slice(0, 6).map((c) => `${c.shortId}:${c.status}:${displayLabelFor(c)}`),
      refIds: referencedPeers
        .slice(0, 4)
        .map((p) => `${p.shortId}:${p.status}:${displayLabelFor(p)}`),
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

    // 0. Return Breadcrumb ("Don't Lose Yourself" 1-Click Jump Back)
    if (returnBreadcrumb) {
      const returnDisplay = displayLabelFor(returnBreadcrumb);
      const returnBtn = document.createElement("button");
      returnBtn.type = "button";
      returnBtn.setAttribute("data-testid", "paseo-finder-lineage-return-btn");
      returnBtn.title = zh
        ? `点击一键返回刚才浏览的会话 (⌘[): ${returnDisplay} (#${returnBreadcrumb.shortId})`
        : `Click to jump back to previous session (⌘[): ${returnDisplay} (#${returnBreadcrumb.shortId})`;

      const dot = document.createElement("span");
      Object.assign(dot.style, {
        width: "6px",
        height: "6px",
        borderRadius: "999px",
        backgroundColor: statusDotColor(returnBreadcrumb.status, tokens),
        flexShrink: "0",
      });

      const textSpan = document.createElement("span");
      const truncatedReturnTitle =
        returnDisplay.length > 36
          ? `${returnDisplay.slice(0, 36)}...`
          : returnDisplay;
      textSpan.textContent = zh
        ? `↖ 返回刚才会话: ${truncatedReturnTitle} (#${returnBreadcrumb.shortId})`
        : `↖ Back to: ${truncatedReturnTitle} (#${returnBreadcrumb.shortId})`;

      returnBtn.appendChild(dot);
      returnBtn.appendChild(textSpan);
      Object.assign(returnBtn.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 9px",
        borderRadius: "6px",
        border: `1px solid ${tokens.accent}`,
        backgroundColor: tokens.surfaceSidebarSelected,
        color: tokens.foreground,
        fontSize: "11.5px",
        fontWeight: "600",
        cursor: "pointer",
      });

      returnBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        clearReturnBreadcrumbForSession(
          current?.workspaceId ?? curWksId,
          current?.agentId ?? curAgentId,
          window,
        );
        navigateToLineageNode(returnBreadcrumb, document, window, {
          recordBreadcrumb: false,
        });
      });

      leftGroup.appendChild(returnBtn);
    }

    // 1. Parent / Initiating Session 1-Click Jump Pill
    if (
      data.parent &&
      data.parent.agentId !== returnBreadcrumb?.agentId
    ) {
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

    // 2.5 Referenced Peer Sessions in Timeline Messages (`⇄ 文中提及同伴`)
    const childAgentIdSet = new Set(children.map((c) => c.agentId));
    const uniqueReferencedPeers = referencedPeers.filter(
      (peer) =>
        peer.agentId !== data.parent?.agentId &&
        peer.agentId !== returnBreadcrumb?.agentId &&
        !childAgentIdSet.has(peer.agentId),
    );
    if (uniqueReferencedPeers.length > 0) {
      for (const peer of uniqueReferencedPeers.slice(0, 3)) {
        const peerDisplay = displayLabelFor(peer);
        const peerChip = document.createElement("button");
        peerChip.type = "button";
        peerChip.setAttribute(
          "data-testid",
          `paseo-finder-lineage-ref-peer-${peer.shortId}`,
        );
        const shortPeerTitle =
          peerDisplay.length > 26
            ? `${peerDisplay.slice(0, 26)}...`
            : peerDisplay;
        peerChip.title = zh
          ? `文中提及同伴会话 · 点击一键跳转: ${peerDisplay} (#${peer.shortId})`
          : `Referenced peer session · Click to jump: ${peerDisplay} (#${peer.shortId})`;

        const dot = document.createElement("span");
        Object.assign(dot.style, {
          width: "6px",
          height: "6px",
          borderRadius: "999px",
          backgroundColor: statusDotColor(peer.status, tokens),
          flexShrink: "0",
        });

        const textSpan = document.createElement("span");
        textSpan.textContent = zh
          ? `⇄ 同伴 #${peer.shortId} · ${shortPeerTitle} ↗`
          : `⇄ Peer #${peer.shortId} · ${shortPeerTitle} ↗`;

        peerChip.appendChild(dot);
        peerChip.appendChild(textSpan);
        Object.assign(peerChip.style, {
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          padding: "2px 8px",
          borderRadius: "999px",
          border: `1px solid ${tokens.border}`,
          backgroundColor: tokens.surface2,
          color: tokens.foreground,
          fontSize: "11px",
          fontWeight: "500",
          cursor: "pointer",
        });
        peerChip.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          navigateToLineageNode(peer, document, window);
        });
        leftGroup.appendChild(peerChip);
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
    // ⌘[ or Cmd+Shift+Up jumps back to the Return Breadcrumb or Initiating (parent) session
    const isCmdShiftUp =
      (ev.metaKey || ev.ctrlKey) &&
      ev.shiftKey &&
      !ev.altKey &&
      ev.key === "ArrowUp";
    const isCmdBracketBack =
      (ev.metaKey || ev.ctrlKey) &&
      !ev.shiftKey &&
      !ev.altKey &&
      ev.key === "[";

    if (isCmdShiftUp || isCmdBracketBack) {
      const { workspaceId, agentId } = extractCurrentWorkspaceAndAgent(document, window);
      const returnCrumb = getReturnBreadcrumbForSession(workspaceId, agentId, window);
      if (returnCrumb) {
        ev.preventDefault();
        ev.stopPropagation();
        clearReturnBreadcrumbForSession(workspaceId, agentId, window);
        navigateToLineageNode(returnCrumb, document, window, {
          recordBreadcrumb: false,
        });
        return;
      }
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
