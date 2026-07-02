/**
 * AdaptiveBitrateController — wires transport backpressure to capture quality.
 *
 * When the WebSocket send buffer fills up (onPressure(true)), we degrade audio
 * quality to reduce bandwidth:
 *   - Increase frame interval (send every N chunks instead of every chunk)
 *   - Signal the capture layer to drop non-critical frames
 *
 * When pressure clears (onPressure(false)), restore full quality.
 *
 * Integration:
 *   const abc = new AdaptiveBitrateController({
 *     onFrameIntervalChange: (every) => captureLayer.setFrameInterval(every),
 *   });
 *   // Pass abc.backpressureHandler as BackpressureOptions.onPressure
 *   transport.connect(url, { backpressure: {
 *     highWaterBytes: 32_000,
 *     lowWaterBytes: 8_000,
 *     onPressure: abc.backpressureHandler,
 *   }});
 *
 * Frame thinning: the controller accumulates pushAudio calls and only forwards
 * every `frameInterval`-th chunk when degraded. This halves (interval=2) or
 * quarters (interval=4) the send rate without changing the capture clock.
 */

export interface AdaptiveBitrateOptions {
  /**
   * Called when the frame interval changes (1 = full rate, 2 = half rate, etc.)
   * The capture layer should honour this by dropping frames accordingly.
   */
  onFrameIntervalChange?: (frameInterval: number) => void;
  /**
   * Frame interval to use when backpressure is high. Default: 2 (half rate).
   * Higher values reduce bandwidth more aggressively.
   */
  degradedFrameInterval?: number;
  /**
   * Minimum ms to stay in degraded mode after pressure clears, preventing
   * rapid oscillation. Default: 2000.
   */
  recoveryHysteresisMs?: number;
}

export type BitrateState = 'normal' | 'degraded';

export class AdaptiveBitrateController {
  private state: BitrateState = 'normal';
  private frameCounter = 0;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly degradedInterval: number;
  private readonly hysteresisMs: number;
  private readonly onFrameIntervalChange?: (n: number) => void;

  constructor(opts: AdaptiveBitrateOptions = {}) {
    this.degradedInterval = opts.degradedFrameInterval ?? 2;
    this.hysteresisMs = opts.recoveryHysteresisMs ?? 2000;
    this.onFrameIntervalChange = opts.onFrameIntervalChange;
  }

  get bitrateState(): BitrateState {
    return this.state;
  }

  /**
   * Pass this as BackpressureOptions.onPressure in TransportOptions.
   * Arrow function preserves `this` so it can be passed directly as a callback.
   */
  readonly backpressureHandler = (paused: boolean): void => {
    if (paused) {
      this.enterDegraded();
    } else {
      this.scheduleRecovery();
    }
  };

  /**
   * Call before each pushAudio(). Returns true if the frame should be sent,
   * false if it should be dropped (thinning).
   *
   * In normal mode: always returns true.
   * In degraded mode: returns true every `degradedInterval`-th call.
   */
  shouldSendFrame(): boolean {
    this.frameCounter++;
    if (this.state === 'normal') return true;
    return this.frameCounter % this.degradedInterval === 0;
  }

  private enterDegraded(): void {
    if (this.state === 'degraded') return;
    this.cancelRecovery();
    this.state = 'degraded';
    this.frameCounter = 0;
    this.onFrameIntervalChange?.(this.degradedInterval);
  }

  private scheduleRecovery(): void {
    if (this.state === 'normal') return;
    this.cancelRecovery();
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      this.state = 'normal';
      this.onFrameIntervalChange?.(1);
    }, this.hysteresisMs);
  }

  private cancelRecovery(): void {
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  dispose(): void {
    this.cancelRecovery();
    this.state = 'normal';
  }
}
