/**
 * Runs async tasks one at a time per key, in call order. Tasks under different keys run
 * concurrently. A rejected task still rejects for its own caller but never blocks the next one.
 *
 * Use it wherever several writes to the same remote record can overlap and the last one must
 * win: e.g. two quick Option+D presses each send a native title write plus a plugin RPC write,
 * and without ordering a slow RPC from the first press can land after the second press.
 */
export interface KeyedSerialQueue {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** Keys with a task still queued or running (for tests and diagnostics). */
  pendingKeys(): number;
}

export function createKeyedSerialQueue(): KeyedSerialQueue {
  const tails = new Map<string, Promise<void>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(task);
      const tail = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
    pendingKeys(): number {
      return tails.size;
    },
  };
}
