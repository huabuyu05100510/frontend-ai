/**
 * WordSyncTracker — synchronises TranscriptionWord timestamps to AudioContext
 * playback time for karaoke-style word highlighting.
 *
 * How it works:
 *   1. At response start, caller provides the list of words and the AudioContext
 *      start time (from player.getScheduledEndTime() delta or a direct timestamp).
 *   2. The tracker runs a requestAnimationFrame loop, comparing AudioContext
 *      currentTime to each word's startMs / endMs.
 *   3. When the current word changes, onWordChange(word, index) fires.
 *   4. On interrupt / response end, stop() tears down the rAF loop.
 *
 * AudioContext time alignment:
 *   - AudioContext.currentTime is in seconds from context creation.
 *   - Word timestamps (startMs / endMs) are relative to utterance start.
 *   - `audioStartTime` (seconds in AudioContext domain) is when the first
 *     chunk of this response was scheduled to play.
 *   - Current word offset = (ctx.currentTime - audioStartTime) * 1000 ms.
 *
 * Usage (in scene orchestrator):
 *   const tracker = new WordSyncTracker(audioCtx, words, audioStartTimeSec, {
 *     onWordChange: (word, idx) => setHighlightedWord(idx),
 *   });
 *   tracker.start();
 *   player.onEnded(responseId => tracker.stop());
 */

export interface TrackedWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface WordSyncTrackerOptions {
  /**
   * Called whenever the current highlighted word changes.
   * `word` is null when no word is active (before first / after last).
   */
  onWordChange: (word: TrackedWord | null, index: number) => void;
  /**
   * How many ms ahead to pre-highlight the next word (compensates for
   * rendering latency). Default: 30.
   */
  lookaheadMs?: number;
}

/** Minimal AudioContext interface needed — avoids hard browser dependency. */
export interface AudioContextRef {
  readonly currentTime: number; // seconds, monotonic
}

export class WordSyncTracker {
  private rafHandle: number | null = null;
  private currentIndex = -1;
  private readonly lookaheadMs: number;

  constructor(
    private readonly ctx: AudioContextRef,
    private readonly words: readonly TrackedWord[],
    /** The AudioContext time (seconds) at which the first word starts playing. */
    private readonly audioStartTimeSec: number,
    private readonly opts: WordSyncTrackerOptions,
  ) {
    this.lookaheadMs = opts.lookaheadMs ?? 30;
  }

  start(): void {
    if (this.rafHandle !== null) return;
    this.tick();
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    if (this.currentIndex !== -1) {
      this.currentIndex = -1;
      this.opts.onWordChange(null, -1);
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private tick = (): void => {
    const offsetMs =
      (this.ctx.currentTime - this.audioStartTimeSec) * 1000 + this.lookaheadMs;

    const idx = this.findWordIndex(offsetMs);
    if (idx !== this.currentIndex) {
      this.currentIndex = idx;
      this.opts.onWordChange(idx >= 0 ? this.words[idx] : null, idx);
    }

    // Stop the loop automatically once past the last word
    if (offsetMs > (this.words[this.words.length - 1]?.endMs ?? 0) + 200) {
      this.rafHandle = null;
      return;
    }

    this.rafHandle = requestAnimationFrame(this.tick);
  };

  /**
   * Binary search for the word whose [startMs, endMs] window contains offsetMs.
   * Returns -1 if no word is active at the given offset.
   */
  private findWordIndex(offsetMs: number): number {
    let lo = 0;
    let hi = this.words.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const w = this.words[mid];
      if (offsetMs < w.startMs) {
        hi = mid - 1;
      } else if (offsetMs > w.endMs) {
        lo = mid + 1;
      } else {
        return mid; // offsetMs is within this word's window
      }
    }
    return -1;
  }
}
