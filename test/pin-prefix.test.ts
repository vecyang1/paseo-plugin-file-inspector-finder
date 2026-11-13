import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PIN_PREFIX,
  applyPinPrefix,
  computePinSyncedTitle,
  hasPinPrefix,
  normalizePinPrefix,
  removePinPrefix,
  splitPinPrefix,
} from "../shared/pin-prefix";
import { pluginSettings } from "../shared/contracts";
import { computeDoneToggledTitle } from "../client/web";
import {
  type PinPrefixStorageLike,
  type PinTitleApplyContext,
  type SessionStoreLike,
  inspectSessionStorePinnedWorkspaces,
  readPinPrefixPrefs,
  readPinPrefixReceipts,
  reconcilePinTitlePrefixes,
  syncPinPrefixPrefs,
} from "../client/pin-prefix-web";
import { handleManagePinPrefix } from "../server/handlers";
import { isLinkShapedTitle, runLinkFirstRetitle } from "../server/link-first-retitle";

function createMemStorage(): PinPrefixStorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

test("Pin Prefix 1: Pure prefix helpers handle CJK, URLs, idempotency, empty/main, and custom prefixes", () => {
  assert.equal(normalizePinPrefix(undefined), "[pin] ");
  assert.equal(normalizePinPrefix("  "), "[pin] ");
  assert.equal(normalizePinPrefix("[pin]"), "[pin] ");
  assert.equal(normalizePinPrefix("[PIN]  "), "[PIN] ");
  assert.equal(normalizePinPrefix("PIN:"), "PIN: ");

  const igTitle = "Follow 对标https://www.instagram.com/damianodesu?vrfl=MWR5dHDq";
  assert.equal(hasPinPrefix(igTitle), false);
  assert.equal(applyPinPrefix(igTitle), `[pin] ${igTitle}`);
  assert.equal(applyPinPrefix(`[pin] ${igTitle}`), `[pin] ${igTitle}`);
  assert.equal(applyPinPrefix(`[PIN] ${igTitle}`), `[PIN] ${igTitle}`);
  assert.equal(removePinPrefix(`[pin] ${igTitle}`), igTitle);
  assert.equal(removePinPrefix(igTitle), igTitle);

  assert.equal(applyPinPrefix(""), "[pin]");
  assert.equal(applyPinPrefix("main"), "[pin]");
  assert.equal(removePinPrefix("[pin]"), null);

  const c1 = computePinSyncedTitle("d Diagnose Paseo slowdown", true);
  assert.deepEqual(c1, { changed: true, nextTitle: "[pin] d Diagnose Paseo slowdown" });

  const c2 = computePinSyncedTitle("[pin] d Diagnose Paseo slowdown", false);
  assert.deepEqual(c2, { changed: true, nextTitle: "d Diagnose Paseo slowdown" });

  const c3 = computePinSyncedTitle("d [pin] Legacy order", false);
  assert.deepEqual(c3, { changed: true, nextTitle: "d Legacy order" });

  assert.deepEqual(splitPinPrefix("d [pin] Task"), {
    hasPin: true,
    pinPrefix: "[pin] ",
    rest: "d Task",
  });
});

test("Pin Prefix 2: computeDoneToggledTitle preserves leading [pin] prefix", () => {
  const marked = computeDoneToggledTitle("[pin] Fix sidebar scroll", "d ");
  assert.deepEqual(marked, {
    newTitle: "[pin] d Fix sidebar scroll",
    action: "marked",
  });

  const unmarked = computeDoneToggledTitle("[pin] d Fix sidebar scroll", "d ");
  assert.deepEqual(unmarked, {
    newTitle: "[pin] Fix sidebar scroll",
    action: "unmarked",
  });

  const unmarkedLegacy = computeDoneToggledTitle("d [pin] Fix sidebar scroll", "d ");
  assert.deepEqual(unmarkedLegacy, {
    newTitle: "[pin] Fix sidebar scroll",
    action: "unmarked",
  });
});

test("Pin Prefix 3: Store reconciler handles initial backfill, manual F2 edit immunity, unpin/re-pin, and echo guard", async () => {
  const storage = createMemStorage();
  let workspaces: Array<{ id: string; name?: string | null; title?: string | null; pinnedAt?: string | null }> = [
    {
      id: "wks_1",
      name: "main",
      title: "Follow 对标https://www.instagram.com/damianodesu",
      pinnedAt: "2026-11-13T06:02:09.171Z",
    },
    {
      id: "wks_2",
      name: "main",
      title: "Unpinned background work",
      pinnedAt: null,
    },
    {
      id: "wks_3",
      name: "main",
      title: null,
      pinnedAt: "2026-11-13T06:05:00.000Z",
    },
  ];
  const agents = [
    { id: "agt_3", workspaceId: "wks_3", title: "Agent derived title", parentAgentId: null },
  ];

  const fakeStore: SessionStoreLike = {
    getState: () => ({
      sessions: {
        srv_local: {
          workspaces: new Map(workspaces.map((w) => [w.id, w])),
          agents: new Map(agents.map((a) => [a.id, a])),
        },
      },
    }),
  };

  const applied: PinTitleApplyContext[] = [];
  const inFlightWrites = new Map<string, { nextTitle: string | null; atMs: number }>();

  // 1. Initial backfill applies [pin] to wks_1 and wks_3 (using agent title fallback), leaves wks_2 untouched
  const res1 = await reconcilePinTitlePrefixes({
    store: fakeStore,
    storage,
    inFlightWrites,
    onApplyTitle: (ctx) => {
      applied.push(ctx);
    },
  });
  assert.equal(res1.updated, 2);
  assert.equal(applied[0].workspaceId, "wks_1");
  assert.equal(applied[0].nextTitle, "[pin] Follow 对标https://www.instagram.com/damianodesu");
  assert.equal(applied[0].reason, "initial-backfill");
  assert.equal(applied[1].workspaceId, "wks_3");
  assert.equal(applied[1].nextTitle, "[pin] Agent derived title");

  // 2. While daemon echo hasn't returned yet, a second reconcile tick does NOT duplicate writes
  const resEcho = await reconcilePinTitlePrefixes({
    store: fakeStore,
    storage,
    inFlightWrites,
    onApplyTitle: (ctx) => {
      applied.push(ctx);
    },
  });
  assert.equal(resEcho.updated, 0);

  // Simulate daemon delivering the updated titles
  workspaces[0].title = "[pin] Follow 对标https://www.instagram.com/damianodesu";
  workspaces[2].title = "[pin] Agent derived title";

  // 3. If the user manually edits wks_1 via F2 to remove [pin] while keeping it pinned, reconciler does NOT fight it
  workspaces[0].title = "Custom manual title without tag";
  const resManual = await reconcilePinTitlePrefixes({
    store: fakeStore,
    storage,
    inFlightWrites,
    onApplyTitle: (ctx) => {
      applied.push(ctx);
    },
  });
  assert.equal(resManual.updated, 0);

  // 4. forceBackfill ("Sync all pinned") re-adds [pin] to wks_1
  const resSync = await reconcilePinTitlePrefixes({
    store: fakeStore,
    storage,
    forceBackfill: true,
    inFlightWrites,
    onApplyTitle: (ctx) => {
      applied.push(ctx);
      workspaces[0].title = ctx.nextTitle;
    },
  });
  assert.equal(resSync.updated, 1);
  assert.equal(workspaces[0].title, "[pin] Custom manual title without tag");

  // 5. Unpinning wks_1 removes [pin]
  workspaces[0].pinnedAt = null;
  const resUnpin = await reconcilePinTitlePrefixes({
    store: fakeStore,
    storage,
    inFlightWrites,
    onApplyTitle: (ctx) => {
      applied.push(ctx);
      workspaces[0].title = ctx.nextTitle;
    },
  });
  assert.equal(resUnpin.updated, 1);
  assert.equal(workspaces[0].title, "Custom manual title without tag");

  // 6. Pinning wks_2 transitions unpinned -> pinned and adds [pin]
  workspaces[1].pinnedAt = "2026-11-13T10:00:00.000Z";
  const resPin2 = await reconcilePinTitlePrefixes({
    store: fakeStore,
    storage,
    inFlightWrites,
    onApplyTitle: (ctx) => {
      applied.push(ctx);
      workspaces[1].title = ctx.nextTitle;
    },
  });
  assert.equal(resPin2.updated, 1);
  assert.equal(workspaces[1].title, "[pin] Unpinned background work");

  // Receipts & inspect helper
  const receipts = readPinPrefixReceipts(storage);
  assert.ok(receipts.length >= 4);
  const inspected = inspectSessionStorePinnedWorkspaces(fakeStore, DEFAULT_PIN_PREFIX);
  assert.equal(inspected.pinnedCount, 2);
  assert.equal(inspected.withPrefixCount, 2);
  assert.equal(inspected.missingPrefixCount, 0);
});

test("Pin Prefix 4: Settings schema defaults, prefs sync, and disabled toggle behavior", async () => {
  const parsed = pluginSettings.schema.parse({});
  assert.equal(parsed.enablePinTitlePrefix, true);
  assert.equal(parsed.pinTitlePrefix, "[pin] ");

  const storage = createMemStorage();
  assert.deepEqual(readPinPrefixPrefs(storage), { enabled: true, prefix: "[pin] " });
  syncPinPrefixPrefs({ enabled: false, prefix: "PIN:" }, storage);
  assert.deepEqual(readPinPrefixPrefs(storage), { enabled: false, prefix: "PIN: " });

  const fakeStore: SessionStoreLike = {
    getState: () => ({
      sessions: {
        srv_local: {
          workspaces: new Map([
            ["wks_9", { id: "wks_9", title: "Alpha", pinnedAt: "2026-11-13T00:00:00Z" }],
          ]),
        },
      },
    }),
  };

  let calls = 0;
  const res = await reconcilePinTitlePrefixes({
    store: fakeStore,
    storage,
    onApplyTitle: () => {
      calls += 1;
    },
  });
  assert.equal(res.updated, 0);
  assert.equal(calls, 0);
});

test("Pin Prefix 5: Server RPC handleManagePinPrefix inspects and syncs missing prefixes", async () => {
  const entries = [
    { id: "wks_a", name: "main", title: "Already pinned", pinnedAt: "2026-11-13T00:00:00Z" },
    { id: "wks_b", name: "main", title: "[pin] Already prefixed", pinnedAt: "2026-11-13T00:00:00Z" },
    { id: "wks_c", name: "main", title: "Not pinned", pinnedAt: null },
  ];
  const renamed: Array<{ id: string; title: string | null }> = [];
  const fakeCtx = {
    paseo: {
      workspaces: {
        list: async () => ({ entries }),
        ref: (id: string) => ({
          setTitle: async (title: string | null) => {
            renamed.push({ id, title });
            const row = entries.find((e) => e.id === id);
            if (row) row.title = title ?? "";
            return { title };
          },
        }),
      },
    },
  } as never;

  const dry = await handleManagePinPrefix({ action: "sync", dryRun: true }, fakeCtx);
  assert.equal(dry.ok, true);
  assert.equal(dry.pinnedCount, 2);
  assert.equal(dry.withPrefixCount, 1);
  assert.equal(dry.missingPrefixCount, 1);
  assert.equal(dry.updatedCount, 0);
  assert.equal(renamed.length, 0);

  const synced = await handleManagePinPrefix({ action: "sync" }, fakeCtx);
  assert.equal(synced.ok, true);
  assert.equal(synced.updatedCount, 1);
  assert.deepEqual(renamed, [{ id: "wks_a", title: "[pin] Already pinned" }]);
});

test("Pin Prefix 6: link-first-retitle recognizes link-shaped titles under [pin] and preserves [pin]", async () => {
  const prompt = "https://www.instagram.com/damianodesu?vrfl=MWR5dHDq";
  assert.equal(isLinkShapedTitle(`[pin] Follow ${prompt}`, prompt), true);
  assert.equal(isLinkShapedTitle("[pin] Audit Instagram benchmark account", prompt), false);

  const writes: Array<{ title: string }> = [];
  const entry = await runLinkFirstRetitle(
    {
      agentId: "agt_pin_link",
      workspaceId: "wks_pin_link",
      dryRun: true,
      force: false,
    },
    {
      paseo: {
        agents: {
          ref: () => ({
            timeline: {
              refetch: async () => ({
                agent: { title: prompt, workspaceId: "wks_pin_link" },
                entries: [
                  { item: { type: "user_message", text: prompt } },
                  {
                    item: {
                      type: "assistant_message",
                      text: "This is a detailed analysis of the Instagram creator benchmark account covering content cadence, hooks, and conversion architecture across 120 characters.",
                    },
                  },
                ],
              }),
            },
          }),
        },
        workspaces: {
          list: async () => ({
            entries: [
              { id: "wks_pin_link", title: `[pin] Follow ${prompt}`, name: "main" },
            ],
          }),
        },
      },
      rename: async (input) => {
        writes.push({ title: input.title });
        return { ok: true };
      },
      generate: async () => "Benchmark Instagram creator damianodesu",
    },
  );
  assert.equal(entry.ok, true);
  assert.equal(entry.to, "[pin] Benchmark Instagram creator damianodesu");
  assert.equal(writes.length, 0);
});
