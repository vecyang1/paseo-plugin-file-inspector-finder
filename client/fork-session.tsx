import { type PluginButtonContentProps, useAgent, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { forkSessionRpc } from "../shared/contracts";
import { AGENT_TAB_PREFIX, resolveForkTargetAgentId } from "./fork-session-target";

const FORKABLE_PROVIDER = "antigravity";

function currentSelectedTabTestId(): string | null {
  if (typeof document === "undefined") return null;
  const tab = document.querySelector<HTMLElement>(`[data-testid^="${AGENT_TAB_PREFIX}"][aria-selected="true"]`);
  return tab?.getAttribute("data-testid") ?? null;
}

export function ForkSessionPopover(props: PluginButtonContentProps) {
  const { theme, close } = props;
  const toast = useToast();
  const forkSession = useRpc(forkSessionRpc);
  const agentId = useMemo(
    () =>
      resolveForkTargetAgentId(
        props as { context?: string; agentId?: string },
        typeof window !== "undefined" ? window.location?.pathname : null,
        currentSelectedTabTestId(),
      ),
    [props],
  );
  const agent = useAgent(agentId ?? "", (a) => ({ provider: a.provider, title: a.title, model: a.model }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = agent?.provider ?? null;
  const forkable = Boolean(agentId) && (provider === null || provider === FORKABLE_PROVIDER);
  const title = agent?.title?.trim() || "this session";
  const c = theme.colors;

  const onFork = async () => {
    if (!agentId || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await forkSession({ agentId, open: true, dryRun: false, source: "header-button" });
      if (res.ok) {
        toast.show(res.message, { variant: "success" });
        close();
        return;
      }
      setError(res.error ?? res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={{ padding: 12, gap: 8, width: 300 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="Split" size={14} color={c.foreground} />
        <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>Fork this session</Text>
      </View>
      <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
        {forkable
          ? `Copies the full conversation of "${title}" into a new agent. This session stays as it is.`
          : agentId
            ? "Fork this session copies Antigravity conversations. For other providers, use the fork icon under any reply."
            : "Open an agent tab first."}
      </Text>
      {forkable ? (
        <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>
          The new agent starts on the default model. Switch with ⌘/.
        </Text>
      ) : null}
      {error ? (
        <Text selectable style={{ color: c.statusDanger, fontSize: 11.5, lineHeight: 16 }}>
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
        <Pressable
          accessibilityRole="button"
          onPress={close}
          style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface2 }}
        >
          <Text style={{ color: c.foreground, fontSize: 12 }}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fork this session"
          testID="fork-session-confirm"
          disabled={!forkable || pending}
          onPress={() => void onFork()}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 6,
            backgroundColor: c.accent,
            opacity: !forkable || pending ? 0.5 : 1,
          }}
        >
          <Text style={{ color: c.accentForeground, fontSize: 12, fontWeight: "600" }}>
            {pending ? "Forking…" : "Fork"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
