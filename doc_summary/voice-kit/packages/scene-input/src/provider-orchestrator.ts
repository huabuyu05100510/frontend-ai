/**
 * ProviderOrchestrator — multi-provider ASR failover and latency-ranked selection.
 *
 * Wraps multiple IASRProvider candidates and exposes a single IASRProvider.
 * Implements two strategies:
 *
 * 1. Latency-ranked selection (default):
 *    - On first openStream(), races all providers with a tiny health probe.
 *    - Subsequent calls reuse the fastest provider.
 *    - Re-ranks every `rerankIntervalMs` (default 60 s) to adapt to network changes.
 *
 * 2. Failover:
 *    - If the active provider's openStream() throws or the session emits an error
 *      result, the orchestrator transparently retries with the next ranked provider.
 *    - The caller's AsyncIterable continues uninterrupted (events are replayed
 *      from the new session).
 *
 * Usage:
 *   const orchestrator = new ProviderOrchestrator([doubaoProvider, zhipuProvider]);
 *   const session = await orchestrator.openStream(config);
 *   // session behaves exactly like a normal ASRStreamSession
 */

import type { IASRProvider, ASRStreamConfig, ASRStreamSession, ASRResult } from '@voice-kit/core-types';

export interface ProviderOrchestratorOptions {
  /**
   * How often to re-measure provider latency and re-rank (ms). Default: 60 000.
   * Set to 0 to disable automatic re-ranking.
   */
  rerankIntervalMs?: number;
  /**
   * Timeout for the latency probe (ms). Providers that don't respond within
   * this window are ranked last. Default: 3000.
   */
  probeTimeoutMs?: number;
}

interface ProviderRank {
  provider: IASRProvider;
  latencyMs: number;
}

export class ProviderOrchestrator implements IASRProvider {
  private ranked: ProviderRank[];
  private lastRankedAt = 0;
  private readonly rerankInterval: number;
  private readonly probeTimeout: number;

  constructor(
    private readonly providers: readonly IASRProvider[],
    opts: ProviderOrchestratorOptions = {},
  ) {
    if (providers.length === 0) throw new Error('ProviderOrchestrator: at least one provider required');
    // Initially assume equal latency; will be updated on first probe.
    this.ranked = providers.map((p) => ({ provider: p, latencyMs: 0 }));
    this.rerankInterval = opts.rerankIntervalMs ?? 60_000;
    this.probeTimeout = opts.probeTimeoutMs ?? 3000;
  }

  async openStream(config: ASRStreamConfig): Promise<ASRStreamSession> {
    await this.maybeRerank(config);

    // Try providers in ranked order; fall back on error.
    for (const { provider } of this.ranked) {
      try {
        const session = await provider.openStream(config);
        return new FailoverSession(session, this.ranked, config);
      } catch {
        // Try next provider
      }
    }
    throw new Error('ProviderOrchestrator: all providers failed to open a stream');
  }

  // ---------------------------------------------------------------------------
  // Latency probing
  // ---------------------------------------------------------------------------

  private async maybeRerank(config: ASRStreamConfig): Promise<void> {
    const now = Date.now();
    if (this.rerankInterval === 0) return;
    if (now - this.lastRankedAt < this.rerankInterval && this.lastRankedAt > 0) return;
    this.lastRankedAt = now;

    const results = await Promise.allSettled(
      this.providers.map((p) => this.probe(p, config)),
    );

    this.ranked = this.providers
      .map((provider, i) => ({
        provider,
        latencyMs: results[i].status === 'fulfilled'
          ? (results[i] as PromiseFulfilledResult<number>).value
          : Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.latencyMs - b.latencyMs);
  }

  private async probe(provider: IASRProvider, config: ASRStreamConfig): Promise<number> {
    const start = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('probe timeout')), this.probeTimeout),
    );
    // Open and immediately close — just measure connection setup time.
    const sessionPromise = provider.openStream(config).then(async (s) => {
      await s.close();
      return Date.now() - start;
    });
    return Promise.race([sessionPromise, timeoutPromise]);
  }
}

// ---------------------------------------------------------------------------
// FailoverSession — wraps an active session; switches provider on error
// ---------------------------------------------------------------------------

class FailoverSession implements ASRStreamSession {
  private pendingAudio: ArrayBuffer[] = [];
  private finalized = false;

  constructor(
    private session: ASRStreamSession,
    private readonly ranked: readonly ProviderRank[],
    private readonly config: ASRStreamConfig,
  ) {}

  pushAudio(chunk: ArrayBuffer): void {
    this.pendingAudio.push(chunk);
    this.session.pushAudio(chunk);
  }

  finalize(): void {
    this.finalized = true;
    this.session.finalize();
  }

  results(): AsyncIterable<ASRResult> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<ASRResult>> {
            // eslint-disable-next-line no-constant-condition
            while (true) {
              const iter = self.session.results()[Symbol.asyncIterator]();
              const result = await iter.next();
              if (result.done) return { value: undefined as unknown as ASRResult, done: true };
              const value = result.value;
              // On error result, attempt provider failover
              if (value.kind === 'error') {
                const switched = await self.tryFailover();
                if (!switched) return { value, done: false }; // no more providers
                continue; // retry from new session
              }
              return { value, done: false };
            }
          },
        };
      },
    };
  }

  async close(): Promise<void> {
    await this.session.close();
  }

  private async tryFailover(): Promise<boolean> {
    const currentRank = this.ranked.findIndex(
      (r) => r.provider === (this.session as unknown as { provider?: IASRProvider })?.provider,
    );
    const nextProviders = this.ranked.slice(currentRank + 1);
    for (const { provider } of nextProviders) {
      try {
        const newSession = await provider.openStream(this.config);
        // Replay buffered audio to new session
        for (const chunk of this.pendingAudio) {
          newSession.pushAudio(chunk);
        }
        if (this.finalized) newSession.finalize();
        await this.session.close();
        this.session = newSession;
        return true;
      } catch {
        // Try next
      }
    }
    return false;
  }
}
