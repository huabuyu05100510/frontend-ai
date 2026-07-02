/**
 * Stream utilities for AsyncIterable composition.
 *
 * tee() — the single most important primitive missing from the SDK.
 * All capture/transport/VAD streams are single-consumer by design; tee()
 * splits one source into n independent iterables so multiple scenes (e.g.
 * VAD + transport) can share the same AudioChunk stream without racing.
 */

/**
 * Split a single AsyncIterable<T> into `n` independent iterables.
 *
 * Design:
 * - A shared async pump advances source and enqueues items into n per-branch
 *   queues. Consumers pull at their own pace.
 * - `highWaterMark`: if any branch queue exceeds this, the pump yields for
 *   one event-loop turn (soft backpressure). Prevents unbounded memory when
 *   one consumer is much slower than the source.
 * - Abandoned consumers (iterator.return() called) stop receiving items so
 *   their queues don't grow forever. When ALL consumers are abandoned the
 *   pump stops.
 * - Source errors are re-thrown in every active consumer.
 *
 * @param source  The upstream AsyncIterable to fan out.
 * @param n       Number of independent branches to produce.
 * @param highWaterMark  Soft per-branch buffer limit (default 64).
 */
export function tee<T>(
  source: AsyncIterable<T>,
  n: number,
  highWaterMark = 64,
): ReadonlyArray<AsyncIterable<T>> {
  if (n <= 0) return [];

  // Per-branch state
  const queues: T[][] = Array.from({ length: n }, () => []);
  const waiters: Array<(() => void) | null> = new Array(n).fill(null);
  const abandoned: boolean[] = new Array(n).fill(false);

  let sourceDone = false;
  let sourceError: unknown = null;

  function wake(i: number): void {
    const w = waiters[i];
    if (w) {
      waiters[i] = null;
      w();
    }
  }

  function wakeAll(): void {
    for (let i = 0; i < n; i++) wake(i);
  }

  // Pump runs concurrently; not awaited by callers — fire-and-forget.
  (async () => {
    try {
      for await (const item of source) {
        // Check if all consumers have abandoned; if so, stop early.
        if (abandoned.every(Boolean)) break;

        for (let i = 0; i < n; i++) {
          if (!abandoned[i]) queues[i].push(item);
        }
        wakeAll();

        // Soft backpressure: if the slowest active branch has buffered too
        // many items, yield for one event-loop turn before reading more.
        const maxLen = queues.reduce((m, q, i) => (!abandoned[i] ? Math.max(m, q.length) : m), 0);
        if (maxLen >= highWaterMark) {
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      }
    } catch (e) {
      sourceError = e;
    } finally {
      sourceDone = true;
      wakeAll();
    }
  })();

  return Array.from({ length: n }, (_, i): AsyncIterable<T> => ({
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<T>> {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            if (queues[i].length > 0) {
              return { value: queues[i].shift()!, done: false };
            }
            if (sourceDone) {
              if (sourceError) throw sourceError;
              return { value: undefined as unknown as T, done: true };
            }
            // Park until pump wakes us
            await new Promise<void>((r) => {
              waiters[i] = r;
            });
          }
        },

        return(): Promise<IteratorResult<T>> {
          // Consumer abandoned (e.g. break out of for-await).
          abandoned[i] = true;
          queues[i] = []; // free memory
          wake(i);
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        },
      };
    },
  }));
}
