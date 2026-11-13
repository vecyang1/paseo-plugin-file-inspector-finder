import assert from "node:assert/strict";
import { test } from "node:test";
import { withRpcTiming, type RpcSlowRecord } from "../server/rpc-timing.ts";

function fakeServer() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    label: "fake",
    handle(descriptor: { name: string }, handler: (...args: unknown[]) => unknown) {
      handlers.set(descriptor.name, handler);
    },
    whoAmI() {
      return this.label;
    },
  };
}

function clock(steps: number[]) {
  let index = 0;
  return () => steps[Math.min(index++, steps.length - 1)];
}

test("a slow RPC is reported with its method name", async () => {
  const server = fakeServer();
  const records: RpcSlowRecord[] = [];
  const timed = withRpcTiming(server, { now: clock([0, 2500]), report: (r) => records.push(r) });
  timed.handle({ name: "finder.slow" }, async (input: unknown) => ({ echoed: input }));

  const result = await server.handlers.get("finder.slow")!("x");

  assert.deepEqual(result, { echoed: "x" });
  assert.deepEqual(records, [{ rpc: "finder.slow", ms: 2500, ok: true, inflight: 1 }]);
});

test("a fast RPC is not reported", async () => {
  const server = fakeServer();
  const records: RpcSlowRecord[] = [];
  const timed = withRpcTiming(server, { now: clock([0, 999]), report: (r) => records.push(r) });
  timed.handle({ name: "finder.fast" }, () => 1);

  assert.equal(await server.handlers.get("finder.fast")!(), 1);
  assert.deepEqual(records, []);
});

test("a slow failing RPC is reported as failed and still throws", async () => {
  const server = fakeServer();
  const records: RpcSlowRecord[] = [];
  const timed = withRpcTiming(server, { now: clock([0, 30000]), report: (r) => records.push(r) });
  timed.handle({ name: "finder.broken" }, async () => {
    throw new Error("boom");
  });

  await assert.rejects(() => server.handlers.get("finder.broken")!() as Promise<unknown>, /boom/);
  assert.deepEqual(records, [{ rpc: "finder.broken", ms: 30000, ok: false, inflight: 1 }]);
});

test("a reporter that throws does not change the RPC result", async () => {
  const server = fakeServer();
  const timed = withRpcTiming(server, {
    now: clock([0, 5000]),
    report: () => {
      throw new Error("reporter down");
    },
  });
  timed.handle({ name: "finder.ok" }, () => "fine");

  assert.equal(await server.handlers.get("finder.ok")!(), "fine");
});

test("other server methods keep their receiver", () => {
  const server = fakeServer();
  const timed = withRpcTiming(server);
  assert.equal(timed.whoAmI(), "fake");
});
