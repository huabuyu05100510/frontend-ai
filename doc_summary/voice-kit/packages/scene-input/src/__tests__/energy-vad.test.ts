import { describe, expect, it } from 'vitest';
import { EnergyVAD } from '../energy-vad';

function makeTone(samples: number, amp = 0.5, freq = 440, rate = 16000): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return out;
}

function makeSilence(samples: number): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = (Math.random() - 0.5) * 0.001;
  return out;
}

function collectEvents(vad: EnergyVAD): import('@voice-kit/core-types').VADEvent[] {
  const events: import('@voice-kit/core-types').VADEvent[] = [];
  for (const l of (vad as unknown as { listeners: Set<(e: import('@voice-kit/core-types').VADEvent) => void> }).listeners) {
    (vad as unknown as { listeners: Set<(e: import('@voice-kit/core-types').VADEvent) => void> }).listeners.delete(l);
  }
  (vad as unknown as { listeners: Set<(e: import('@voice-kit/core-types').VADEvent) => void> }).listeners.add((e) => events.push(e));
  return events;
}

describe('EnergyVAD', () => {
  it('fires speech-start after sustained speech frames', () => {
    const vad = new EnergyVAD({ threshold: 0.05, minSpeechMs: 100 }, 16000, 320);
    const events = collectEvents(vad);

    // 20ms per frame; need 100ms = 5 frames
    for (let i = 0; i < 6; i++) vad.push(makeTone(320, 0.5));

    const starts = events.filter((e) => e.kind === 'speech-start');
    expect(starts.length).toBe(1);
  });

  it('fires speech-end after sustained silence', () => {
    const vad = new EnergyVAD(
      { threshold: 0.05, minSpeechMs: 100, minSilenceMs: 400 },
      16000,
      320
    );
    const events = collectEvents(vad);

    for (let i = 0; i < 6; i++) vad.push(makeTone(320, 0.5));
    for (let i = 0; i < 30; i++) vad.push(makeSilence(320));

    const ends = events.filter((e) => e.kind === 'speech-end');
    expect(ends.length).toBe(1);
  });

  it('does not fire speech-start for brief noise bursts below minSpeechMs', () => {
    const vad = new EnergyVAD({ threshold: 0.05, minSpeechMs: 500 }, 16000, 320);
    const events = collectEvents(vad);

    // Only 2 frames (40ms) of speech, well below 500ms threshold
    vad.push(makeTone(320, 0.5));
    vad.push(makeTone(320, 0.5));
    vad.push(makeSilence(320));

    const starts = events.filter((e) => e.kind === 'speech-start');
    expect(starts.length).toBe(0);
  });

  it('emits confidence events for every frame', () => {
    const vad = new EnergyVAD();
    const events = collectEvents(vad);
    vad.push(makeTone(320));
    vad.push(makeTone(320));
    const confidences = events.filter((e) => e.kind === 'confidence');
    expect(confidences.length).toBe(2);
    expect(confidences[0].score).toBeGreaterThan(0);
  });

  it('configure() updates thresholds', () => {
    const vad = new EnergyVAD({ threshold: 0.5 });
    vad.configure({ threshold: 0.01 });
    const events = collectEvents(vad);
    // With low threshold, even soft tones trigger
    for (let i = 0; i < 15; i++) vad.push(makeTone(320, 0.1));
    const starts = events.filter((e) => e.kind === 'speech-start');
    expect(starts.length).toBeGreaterThanOrEqual(1);
  });

  it('reset() clears state', () => {
    const vad = new EnergyVAD({ threshold: 0.05, minSpeechMs: 100 });
    const events = collectEvents(vad);
    for (let i = 0; i < 6; i++) vad.push(makeTone(320, 0.5));
    expect(events.some((e) => e.kind === 'speech-start')).toBe(true);
    vad.reset();
    // Continue with more speech — should fire start again
    for (let i = 0; i < 6; i++) vad.push(makeTone(320, 0.5));
    const starts = events.filter((e) => e.kind === 'speech-start');
    expect(starts.length).toBe(2);
  });
});
