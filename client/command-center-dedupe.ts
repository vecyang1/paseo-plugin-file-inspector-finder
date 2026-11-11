/**
 * Cmd+K shows one session twice: Paseo lists every workspace under "Workspaces" and every agent
 * under "Agents", and a workspace that holds a single agent has the same title as that agent, so
 * one query hits both rows and both open the same place.
 *
 * The rule here: an agent row is hidden only when its workspace row is already in the same result
 * list and that workspace has no other agent row. Both rows then lead to one destination, so
 * nothing becomes unreachable. A workspace with several agents keeps every agent row (each is a
 * different tab), and an agent whose workspace row is not shown keeps its row.
 *
 * Paseo computes both sections in one render, workspaces first, from the same query. The agent
 * pass therefore reads the workspace pass recorded for that exact query; with any other query on
 * record it hides nothing, which is Paseo's own behaviour.
 */

export interface CommandCenterRowLike {
  kind?: unknown;
  serverId?: unknown;
  workspaceId?: unknown;
  agent?: { serverId?: unknown; workspaceId?: unknown } | null;
}

export interface AgentRowDedupeResult<T> {
  kept: T[];
  hidden: number;
}

export interface CommandCenterDedupeStatus {
  enabled: boolean;
  /** Query of the last agent pass, or null before the first search. */
  lastQuery: string | null;
  hiddenAgentRows: number;
  keptAgentRows: number;
  shownWorkspaceRows: number;
  atMs: number | null;
}

function joinKey(serverId: unknown, workspaceId: unknown): string | null {
  const workspace = typeof workspaceId === "string" ? workspaceId.trim() : "";
  if (!workspace) return null;
  const server = typeof serverId === "string" ? serverId.trim() : "";
  return `${server}:${workspace}`;
}

export function workspaceRowKey(row: CommandCenterRowLike | null | undefined): string | null {
  if (!row || row.kind !== "workspace") return null;
  return joinKey(row.serverId, row.workspaceId);
}

export function agentRowWorkspaceKey(row: CommandCenterRowLike | null | undefined): string | null {
  if (!row || row.kind !== "agent" || !row.agent) return null;
  return joinKey(row.agent.serverId, row.agent.workspaceId);
}

export function dropAgentRowsCoveredByWorkspaceRows<T>(
  rows: readonly T[],
  shownWorkspaceKeys: ReadonlySet<string> | null | undefined,
): AgentRowDedupeResult<T> {
  if (!shownWorkspaceKeys || shownWorkspaceKeys.size === 0) {
    return { kept: [...rows], hidden: 0 };
  }
  const agentRowsPerWorkspace = new Map<string, number>();
  for (const row of rows) {
    const key = agentRowWorkspaceKey(row as CommandCenterRowLike);
    if (key) agentRowsPerWorkspace.set(key, (agentRowsPerWorkspace.get(key) ?? 0) + 1);
  }
  const kept = rows.filter((row) => {
    const key = agentRowWorkspaceKey(row as CommandCenterRowLike);
    if (!key) return true;
    return !(shownWorkspaceKeys.has(key) && agentRowsPerWorkspace.get(key) === 1);
  });
  return { kept, hidden: rows.length - kept.length };
}

let shownWorkspaces: { query: string; keys: Set<string> } | null = null;
let lastReceipt: Omit<CommandCenterDedupeStatus, "enabled"> = {
  lastQuery: null,
  hiddenAgentRows: 0,
  keptAgentRows: 0,
  shownWorkspaceRows: 0,
  atMs: null,
};

/** Called with what the workspace section will show for `query`. */
export function recordShownWorkspaceRows(query: string, rows: readonly unknown[]): void {
  const keys = new Set<string>();
  for (const row of rows) {
    const key = workspaceRowKey(row as CommandCenterRowLike);
    if (key) keys.add(key);
  }
  shownWorkspaces = { query, keys };
}

/** The workspace rows on record for exactly this query, or null when the record is for another. */
export function shownWorkspaceKeysForQuery(query: string): ReadonlySet<string> | null {
  return shownWorkspaces && shownWorkspaces.query === query ? shownWorkspaces.keys : null;
}

export function recordAgentPassReceipt(query: string, kept: number, hidden: number): void {
  lastReceipt = {
    lastQuery: query,
    hiddenAgentRows: hidden,
    keptAgentRows: kept,
    shownWorkspaceRows: shownWorkspaceKeysForQuery(query)?.size ?? 0,
    atMs: Date.now(),
  };
}

export function getCommandCenterDedupeStatus(enabled: boolean): CommandCenterDedupeStatus {
  return { enabled, ...lastReceipt };
}

export function resetCommandCenterDedupeForTests(): void {
  shownWorkspaces = null;
  lastReceipt = {
    lastQuery: null,
    hiddenAgentRows: 0,
    keptAgentRows: 0,
    shownWorkspaceRows: 0,
    atMs: null,
  };
}
