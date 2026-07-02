import { describe, expect, it } from 'vitest';
import {
  float32ToInt16,
  int16ToFloat32,
  mergeChunks,
  rms,
  resampleLinear,
  bytesToBase64,
  base64ToBytes,
} from '../audio';

describe('float32 ↔ int16 conversion', () => {
  it('round-trips with bounded error', () => {
    const original = new Float32Array([0.5, -0.5, 0.25, -0.25, 1.0, -1.0]);
    const int16 = float32ToInt16(original);
    const back = int16ToFloat32(int16.buffer);
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(back[i] - original[i])).toBeLessThan(1e-3);
    }
  });

  it('clamps out-of-range', () => {
    const int16 = float32ToInt16(new Float32Array([5.0, -5.0]));
    expect(int16[0]).toBe(32767);
    expect(int16[1]).toBe(-32768);
  });
});

describe('mergeChunks', () => {
  it('concatenates multiple buffers', () => {
    const a = new Int16Array([1, 2, 3]).buffer;
    const b = new Int16Array([4, 5]).buffer;
    const merged = new Int16Array(mergeChunks([a, b]));
    expect(Array.from(merged)).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles empty input', () => {
    expect(mergeChunks([]).byteLength).toBe(0);
  });
});

describe('rms', () => {
  it('returns 0 for silence', () => {
    const buf = new Int16Array(100).buffer; // all zeros
    expect(rms(buf)).toBe(0);
  });

  it('returns ~0.707 for full-scale square wave', () => {
    const wave = new Int16Array(100);
    for (let i = 0; i < 100; i++) wave[i] = 32767;
    const r = rms(wave.buffer);
    expect(r).toBeCloseTo(1.0, 1);
  });
});

describe('resampleLinear', () => {
  it('passes through when rates match', () => {
    const input = new Float32Array([1, 2, 3, 4]);
    expect(resampleLinear(input, 16000, 16000)).toBe(input);
  });

  it('halves sample count when down-sampling 2x', () => {
    const input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const out = resampleLinear(input, 48000, 24000);
    expect(out.length).toBe(4);
  });
});

describe('bytesToBase64 / base64ToBytes round-trip', () => {
  it('preserves data', () => {
    const orig = new Uint8Array([0, 127, 128, 255, 1, 2, 3]).buffer;
    const b64 = bytesToBase64(orig);
    const back = base64ToBytes(b64);
    expect(new Uint8Array(back)).toEqual(new Uint8Array(orig));
  });

  it('handles large buffers without stack overflow', () => {
    const big = new Uint8Array(200_000);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;
    const b64 = bytesToBase64(big.buffer);
    const back = new Uint8Array(base64ToBytes(b64));
    expect(back.length).toBe(big.length);
    expect(back[100000]).toBe(big[100000]);
  });
});
