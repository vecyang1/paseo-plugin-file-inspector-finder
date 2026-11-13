#!/usr/bin/env node
// Summarises slow plugin RPCs recorded by server/rpc-timing.ts.
// Usage: node scripts/rpc-slow-report.mjs [--json] [daemon.log ...]
// Default input: ~/.paseo/daemon.log

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TAG = "[finder.rpc-slow]";
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const files = args.filter((a) => a !== "--json");
if (files.length === 0) files.push(join(homedir(), ".paseo", "daemon.log"));

const byRpc = new Map();
let lines = 0;
let unreadable = 0;

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`cannot read ${file}: ${error.message}`);
    process.exitCode = 2;
    continue;
  }
  for (const line of text.split("\n")) {
    const at = line.indexOf(TAG);
    if (at === -1) continue;
    lines += 1;
    try {
      // The daemon stores plugin stderr as a JSON string field, so the record is escaped once.
      const message = JSON.parse(line).message;
      const record = JSON.parse(message.slice(message.indexOf(TAG) + TAG.length));
      const entry = byRpc.get(record.rpc) ?? { rpc: record.rpc, count: 0, failed: 0, durations: [] };
      entry.count += 1;
      if (!record.ok) entry.failed += 1;
      entry.durations.push(record.ms);
      byRpc.set(record.rpc, entry);
    } catch {
      unreadable += 1;
    }
  }
}

const rows = [...byRpc.values()]
  .map((e) => {
    const sorted = e.durations.sort((a, b) => a - b);
    return {
      rpc: e.rpc,
      count: e.count,
      failed: e.failed,
      p50Ms: sorted[Math.floor(sorted.length / 2)],
      maxMs: sorted[sorted.length - 1],
      totalS: Math.round(sorted.reduce((a, b) => a + b, 0) / 1000),
    };
  })
  .sort((a, b) => b.totalS - a.totalS);

if (asJson) {
  console.log(JSON.stringify({ files, lines, unreadable, rows }, null, 2));
} else {
  console.log(`slow plugin RPCs: ${lines} line(s) across ${files.length} file(s), ${unreadable} unreadable`);
  if (rows.length === 0) console.log("none recorded (the plugin logs calls of 1000 ms or more)");
  for (const r of rows) {
    console.log(
      `${String(r.totalS).padStart(6)}s  n=${String(r.count).padStart(4)}  p50=${String(r.p50Ms).padStart(6)}ms  max=${String(r.maxMs).padStart(6)}ms  failed=${r.failed}  ${r.rpc}`,
    );
  }
}
