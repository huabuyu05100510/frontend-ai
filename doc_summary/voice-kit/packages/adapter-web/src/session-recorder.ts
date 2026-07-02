/**
 * SessionRecorder / SessionReplayer — deterministic session capture & replay.
 *
 * Records the full stream of TranscriptionAction or ConverseAction events plus
 * optional audio chunks to IndexedDB (via IStorage / WebStorage blob store).
 * Replay feeds saved events back to a reducer without real mic or network,
 * enabling:
 *   - Bug reproduction: share a session.json + blobs to reproduce any state
 *   - QA regression: seed a saved session, assert final reducer state
 *   - Demo mode: replay a canned session in a product demo
 *
 * Storage layout (per session key prefix):
 *   kv  'session:{id}:meta'          → SessionMeta
 *   kv  'session:{id}:event:{seq}'   → SessionEvent (JSON-serialisable action)
 *   blob 'session:{id}:audio:{seq}'  → ArrayBuffer PCM chunk
 */

import type { IStorage } from '@voice-kit/core-types';

export interface SessionMeta {
  id: string;
  startedAt: number;
  endedAt?: number;
  eventCount: number;
  kind: 'transcribe' | 'converse' | 'generic';
}

export interface SessionEvent<A = unknown> {
  seq: number;
  wallMs: number; // real-world timestamp for replay pacing
  action: A;
  /** Key of the associated audio blob in IStorage, if any */
  audioBlobKey?: string;
}

export class SessionRecorder<A> {
  private seq = 0;
  private startedAt = Date.now();

  constructor(
    private readonly storage: IStorage,
    private readonly sessionId: string,
    private readonly kind: SessionMeta['kind'] = 'generic',
  ) {}

  /**
   * Record one action (and optionally an associated audio chunk).
   * Fire-and-forget async — recording errors are swallowed so they don't
   * affect the live session.
   */
  record(action: A, audioChunk?: ArrayBuffer): void {
    const seq = ++this.seq;
    const wallMs = Date.now();
    const eventKey = `session:${this.sessionId}:event:${seq}`;
    const event: SessionEvent<A> = { seq, wallMs, action };

    void (async () => {
      try {
        if (audioChunk) {
          const audioBlobKey = `session:${this.sessionId}:audio:${seq}`;
          await this.storage.putBlob(audioBlobKey, audioChunk);
          event.audioBlobKey = audioBlobKey;
        }
        await this.storage.set(eventKey, event);
        // Update meta count
        const metaKey = `session:${this.sessionId}:meta`;
        await this.storage.set<SessionMeta>(metaKey, {
          id: this.sessionId,
          startedAt: this.startedAt,
          eventCount: seq,
          kind: this.kind,
        });
      } catch {
        /* recording errors must not affect live session */
      }
    })();
  }

  /** Finalise the session (writes endedAt to meta). */
  async end(): Promise<void> {
    const metaKey = `session:${this.sessionId}:meta`;
    const existing = await this.storage.get<SessionMeta>(metaKey);
    if (existing) {
      await this.storage.set<SessionMeta>(metaKey, { ...existing, endedAt: Date.now() });
    }
  }
}

export interface ReplayOptions {
  /**
   * Replay pacing: 'realtime' inserts delays to match original timing,
   * 'instant' feeds all events synchronously (fastest, for unit tests).
   * Default: 'realtime'
   */
  pacing?: 'realtime' | 'instant';
  /** Called for each audio blob key so the caller can pipe audio to a player. */
  onAudioBlob?: (blob: Blob | null, event: SessionEvent) => void;
}

export class SessionReplayer<A> {
  constructor(
    private readonly storage: IStorage,
    private readonly sessionId: string,
  ) {}

  /**
   * Load all events for this session and replay them to `dispatch`.
   * Returns the final accumulated state produced by `reducer`.
   */
  async replay<S>(
    reducer: (state: S, action: A) => S,
    initialState: S,
    opts: ReplayOptions = {},
  ): Promise<S> {
    const pacing = opts.pacing ?? 'realtime';
    const events = await this.loadEvents();
    let state = initialState;
    let prevWallMs: number | null = null;

    for (const event of events) {
      if (pacing === 'realtime' && prevWallMs !== null) {
        const delay = event.wallMs - prevWallMs;
        if (delay > 0) await new Promise<void>((r) => setTimeout(r, delay));
      }
      prevWallMs = event.wallMs;

      if (event.audioBlobKey && opts.onAudioBlob) {
        const blob = await this.storage.getBlob(event.audioBlobKey);
        opts.onAudioBlob(blob, event);
      }

      state = reducer(state, event.action as A);
    }
    return state;
  }

  /** List all recorded sessions (meta only). */
  static async listSessions(storage: IStorage): Promise<SessionMeta[]> {
    const metas: SessionMeta[] = [];
    for await (const [, meta] of storage.iterate<SessionMeta>('session:')) {
      if ((meta as SessionMeta).eventCount !== undefined && (meta as SessionMeta).startedAt !== undefined) {
        metas.push(meta as SessionMeta);
      }
    }
    return metas.sort((a, b) => b.startedAt - a.startedAt);
  }

  private async loadEvents(): Promise<SessionEvent<A>[]> {
    const prefix = `session:${this.sessionId}:event:`;
    const events: SessionEvent<A>[] = [];
    for await (const [, ev] of this.storage.iterate<SessionEvent<A>>(prefix)) {
      events.push(ev);
    }
    return events.sort((a, b) => a.seq - b.seq);
  }
}
