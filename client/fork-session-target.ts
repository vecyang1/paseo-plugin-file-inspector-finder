import { extractCurrentRouteAgentId } from "./subagents-tree-web";

export const AGENT_TAB_PREFIX = "workspace-tab-agent_";

/** The agent the header is showing: host context first, then the route, then the selected tab. */
export function resolveForkTargetAgentId(
  props: { context?: string; agentId?: string },
  pathname?: string | null,
  selectedTabTestId?: string | null,
): string | null {
  if (props.context === "agent" && props.agentId) return props.agentId;
  const fromRoute = extractCurrentRouteAgentId(pathname);
  if (fromRoute) return fromRoute;
  if (selectedTabTestId && selectedTabTestId.startsWith(AGENT_TAB_PREFIX)) {
    const id = selectedTabTestId.slice(AGENT_TAB_PREFIX.length);
    return id.length >= 8 ? id : null;
  }
  return null;
}
