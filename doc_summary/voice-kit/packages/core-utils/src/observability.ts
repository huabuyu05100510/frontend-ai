/**
 * ObservabilityImpl — concrete IObservability backed by HDR histograms.
 *
 * Provides:
 *  - span()      : lightweight async span (no external SDK dependency)
 *  - histogram() : O(1) record into named HDR histograms; p50/p95/p99 on snapshot
 *  - counter()   : simple increment counters
 *  - gauge()     : latest-value gauges
 *  - markCapture / markAck : RTT attribution for audio chunk round-trips
 *
 * RTT attribution:
 *   markCapture(chunkId, sendTs) stores the send timestamp.
 *   markAck(chunkId, ackTs)     looks up sendTs, computes rtt = ackTs - sendTs,
 *                                 records into histogram('asr.rtt.ms').
 *   Stale entries (not ack'd within TTL) are purged on the next markCapture
 *   call to prevent unbounded memory growth.
 */

import type { IObservability, Span, Attrs } from '@voice-kit/core-types';
import { HDRHistogram } from './hdr-histogram';

export interface ObservabilitySnapshot {
  histograms: Record<string, ReturnType<HDRHistogram['snapshot']>>;
  counters: Record<string, number>;
  gauges: Record<string, number>;
}

const CAPTURE_TTL_MS = 30_000; // purge unacknowledged chunkIds after 30 s

export class ObservabilityImpl implements IObservability {
  private enabled = true;

  private readonly histograms = new Map<string, HDRHistogram>();
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  // chunkId → { ts: number } for RTT attribution
  private readonly captureMap = new Map<number, number>();
  private lastCaptureAt = 0;

  // ---------------------------------------------------------------------------
  // IObservability
  // ---------------------------------------------------------------------------

  async span<T>(name: string, attrs: Attrs, fn: (span: Span) => Promise<T> | T): Promise<T> {
    const start = Date.now();
    const spanImpl: Span = {
      setAttribute: () => {},
      recordError: (err) => {
        this.counter(`${name}.error`, attrs);
        if (typeof err !== 'string') {
          // record error type for debugging
          this.counter(`${name}.error.${err.name}`, attrs);
        }
      },
      end: () => {
        if (this.enabled) {
          this.histogram(`${name}.duration.ms`, Date.now() - start, attrs);
        }
      },
    };
    try {
      const result = await fn(spanImpl);
      spanImpl.end();
      return result;
    } catch (e) {
      spanImpl.recordError(e instanceof Error ? e : String(e));
      spanImpl.end();
      throw e;
    }
  }

  histogram(name: string, valueMs: number, _attrs?: Attrs): void {
    if (!this.enabled) return;
    let h = this.histograms.get(name);
    if (!h) {
      h = new HDRHistogram(3, 60_000);
      this.histograms.set(name, h);
    }
    h.record(valueMs);
  }

  counter(name: string, _attrs?: Attrs): void {
    if (!this.enabled) return;
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }

  gauge(name: string, value: number, _attrs?: Attrs): void {
    if (!this.enabled) return;
    this.gauges.set(name, value);
  }

  markCapture(chunkId: number, ts: number): void {
    if (!this.enabled) return;
    this.purgeStaleCaptureEntries(ts);
    this.captureMap.set(chunkId, ts);
    this.lastCaptureAt = ts;
  }

  markAck(chunkId: number, ts: number): void {
    if (!this.enabled) return;
    const sendTs = this.captureMap.get(chunkId);
    if (sendTs === undefined) return; // stale or duplicate ack
    this.captureMap.delete(chunkId);
    const rtt = ts - sendTs;
    if (rtt >= 0) {
      this.histogram('asr.rtt.ms', rtt);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  // ---------------------------------------------------------------------------
  // Public extras (not on IObservability interface but useful for export)
  // ---------------------------------------------------------------------------

  snapshot(): ObservabilitySnapshot {
    const histograms: ObservabilitySnapshot['histograms'] = {};
    for (const [name, h] of this.histograms) {
      histograms[name] = h.snapshot();
    }
    return {
      histograms,
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }

  reset(): void {
    for (const h of this.histograms.values()) h.reset();
    this.counters.clear();
    this.gauges.clear();
    this.captureMap.clear();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private purgeStaleCaptureEntries(now: number): void {
    // Only purge occasionally to avoid O(n) on every call
    if (now - this.lastCaptureAt < CAPTURE_TTL_MS) return;
    for (const [id, ts] of this.captureMap) {
      if (now - ts > CAPTURE_TTL_MS) this.captureMap.delete(id);
    }
  }
}
