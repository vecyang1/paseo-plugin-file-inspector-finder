// Names the plugin RPCs that are slow.
//
// Paseo's daemon logs every slow request as `plugin.rpc.invoke.request` with a
// duration and no method name, so a slow sidebar could not be traced to the
// handler behind it. Wrapping `server.handle` once records the method.
//
// Output: one stderr line per slow call, which the daemon stores in
// ~/.paseo/daemon.log as a "Plugin output" entry:
//   [finder.rpc-slow] {"rpc":"finder.diagnose_path","ms":2840,"ok":true,"inflight":3}
// Summarise with: node scripts/rpc-slow-report.mjs

export const RPC_SLOW_TAG = "[finder.rpc-slow]";
export const RPC_SLOW_THRESHOLD_MS = 1000;

export interface RpcSlowRecord {
  rpc: string;
  ms: number;
  ok: boolean;
  inflight: number;
}

interface TimingOptions {
  thresholdMs?: number;
  now?: () => number;
  report?: (record: RpcSlowRecord) => void;
}

interface HandleCapable {
  handle: (...args: any[]) => unknown;
}

function defaultReport(record: RpcSlowRecord): void {
  console.error(`${RPC_SLOW_TAG} ${JSON.stringify(record)}`);
}

function rpcName(descriptor: unknown): string {
  if (descriptor && typeof descriptor === "object") {
    const name = (descriptor as { name?: unknown }).name;
    if (typeof name === "string" && name) return name;
  }
  return "unknown";
}

/**
 * Returns a server whose `handle` times every RPC handler. Everything else on
 * the server is passed through untouched.
 */
export function withRpcTiming<T extends HandleCapable>(server: T, options: TimingOptions = {}): T {
  const thresholdMs = options.thresholdMs ?? RPC_SLOW_THRESHOLD_MS;
  const now = options.now ?? (() => performance.now());
  const report = options.report ?? defaultReport;
  let inflight = 0;

  const timedHandle = (descriptor: unknown, handler: (...args: any[]) => unknown, ...rest: unknown[]) => {
    const name = rpcName(descriptor);
    const timed = async (...args: unknown[]) => {
      const startedAt = now();
      inflight += 1;
      const inflightAtStart = inflight;
      let ok = true;
      try {
        return await handler(...args);
      } catch (error) {
        ok = false;
        throw error;
      } finally {
        inflight -= 1;
        const ms = Math.round(now() - startedAt);
        if (ms >= thresholdMs) {
          try {
            report({ rpc: name, ms, ok, inflight: inflightAtStart });
          } catch {
            // Reporting must never change the outcome of the RPC.
          }
        }
      }
    };
    return server.handle(descriptor, timed, ...rest);
  };

  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "handle") return timedHandle;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
