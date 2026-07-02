/**
 * VadPlaybackCoordinator — VAD / AEC gate for the converse scene.
 *
 * Problem: EnergyVAD (and even Silero VAD) will detect the AI's own TTS audio
 * through the speaker as "speech-start", triggering a phantom barge-in. In a
 * real AEC pipeline the reference signal is subtracted in hardware; in a
 * browser-only stack the best approximation is to raise the VAD threshold
 * during playback so that only louder-than-speaker user speech fires.
 *
 * Integration (scene orchestrator, not the reducer):
 *   const coord = new VadPlaybackCoordinator(vad, player);
 *   // When AI starts speaking:
 *   coord.onPlaybackStart(responseId);
 *   // On barge-in or programmatic interrupt:
 *   coord.onPlaybackInterrupt();
 *   // On scene destroy:
 *   coord.dispose();
 *
 * The coordinator auto-restores the normal threshold once the player fires
 * onEnded() for the active responseId, with an optional echo-decay window
 * to let room reverb die down before re-enabling sensitive detection.
 */

import type { IVAD, IAudioPlayer } from '@voice-kit/core-types';

export interface VadPlaybackCoordinatorOptions {
  /**
   * VAD RMS threshold during normal (listening) mode.
   * Should match the threshold configured on the IVAD instance.
   * Default: 0.02
   */
  normalThreshold?: number;
  /**
   * VAD RMS threshold during AI playback (anti-echo mode).
   * Set high enough that speaker output doesn't trigger it, but low enough
   * that a user speaking loudly over the AI still fires barge-in.
   * Default: 0.15
   */
  antiEchoThreshold?: number;
  /**
   * Time in ms to keep the elevated threshold after playback ends, letting
   * room reverb / echo ring decay before restoring sensitive detection.
   * Default: 300
   */
  echoDecayMs?: number;
}

export class VadPlaybackCoordinator {
  private readonly normalThreshold: number;
  private readonly antiEchoThreshold: number;
  private readonly echoDecayMs: number;

  private activeResponseId: string | null = null;
  private endedUnsub: (() => void) | null = null;
  private decayTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly vad: IVAD,
    private readonly player: IAudioPlayer,
    opts: VadPlaybackCoordinatorOptions = {},
  ) {
    this.normalThreshold = opts.normalThreshold ?? 0.02;
    this.antiEchoThreshold = opts.antiEchoThreshold ?? 0.15;
    this.echoDecayMs = opts.echoDecayMs ?? 300;
  }

  /**
   * Call when the converse reducer transitions to 'speaking' and the player
   * starts scheduling chunks for `responseId`.
   */
  onPlaybackStart(responseId: string): void {
    if (this.disposed) return;

    // Cancel any pending restore from a previous response
    this.cancelDecay();
    this.unsubEnded();

    this.activeResponseId = responseId;
    this.vad.configure({ threshold: this.antiEchoThreshold });

    // Auto-restore when this specific responseId finishes playing
    const unsub = this.player.onEnded((endedId) => {
      if (endedId === responseId && this.activeResponseId === responseId) {
        unsub();
        this.endedUnsub = null;
        this.activeResponseId = null;
        this.scheduleRestore();
      }
    });
    this.endedUnsub = unsub;
  }

  /**
   * Call on barge-in (USER_SPEECH_START while speaking) or programmatic
   * BARGE_IN action. The player will be interrupted; restore VAD with a
   * short decay window so residual echo doesn't trigger another barge-in.
   */
  onPlaybackInterrupt(): void {
    if (this.disposed) return;
    this.unsubEnded();
    this.activeResponseId = null;
    // Use half the normal decay — user already broke in, restore faster
    this.scheduleRestore(Math.round(this.echoDecayMs / 2));
  }

  /**
   * Tear down all timers and subscriptions. Restores VAD to normal threshold.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelDecay();
    this.unsubEnded();
    this.vad.configure({ threshold: this.normalThreshold });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private scheduleRestore(delayMs: number = this.echoDecayMs): void {
    this.cancelDecay();
    this.decayTimer = setTimeout(() => {
      this.decayTimer = null;
      if (!this.disposed) {
        this.vad.configure({ threshold: this.normalThreshold });
      }
    }, delayMs);
  }

  private cancelDecay(): void {
    if (this.decayTimer !== null) {
      clearTimeout(this.decayTimer);
      this.decayTimer = null;
    }
  }

  private unsubEnded(): void {
    if (this.endedUnsub) {
      this.endedUnsub();
      this.endedUnsub = null;
    }
  }
}
