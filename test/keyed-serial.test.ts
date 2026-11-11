import assert from "node:assert/strict";
import test from "node:test";

import { createKeyedSerialQueue } from "../client/keyed-serial";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("same key: a later task starts only after the earlier one settles", async () => {
  const queue = createKeyedSerialQueue();
  const events: string[] = [];
  const first = queue.run("ws_1", async () => {
    events.push("first:start");
    await sleep(40);
    events.push("first:end");
    return "a";
  });
  const second = queue.run("ws_1", async () => {
    events.push("second:start");
    events.push("second:end");
    return "b";
  });
  assert.deepEqual(await Promise.all([first, second]), ["a", "b"]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("different keys run concurrently", async () => {
  const queue = createKeyedSerialQueue();
  const events: string[] = [];
  const slow = queue.run("ws_1", async () => {
    events.push("slow:start");
    await sleep(40);
    events.push("slow:end");
  });
  const fast = queue.run("ws_2", async () => {
    events.push("fast:start");
    events.push("fast:end");
  });
  await Promise.all([slow, fast]);
  assert.deepEqual(events, ["slow:start", "fast:start", "fast:end", "slow:end"]);
});

test("a rejected task does not block the next one, and its caller still sees the error", async () => {
  const queue = createKeyedSerialQueue();
  const failing = queue.run("ws_1", async () => {
    await sleep(10);
    throw new Error("rpc failed");
  });
  const next = queue.run("ws_1", async () => "ran");
  await assert.rejects(failing, /rpc failed/);
  assert.equal(await next, "ran");
});

test("idle keys are released so the map does not grow", async () => {
  const queue = createKeyedSerialQueue();
  await queue.run("ws_1", async () => {});
  await queue.run("ws_2", async () => {});
  await sleep(0);
  assert.equal(queue.pendingKeys(), 0);
});
