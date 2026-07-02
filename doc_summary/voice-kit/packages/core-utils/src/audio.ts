/**
 * Audio buffer utilities — pure functions, no platform deps.
 */

/**
 * Concatenate Int16 PCM chunks into a single buffer (zero-copy via set).
 */
export function mergeChunks(chunks: readonly ArrayBuffer[]): ArrayBuffer {
  let totalLen = 0;
  const views: Int16Array[] = [];
  for (const c of chunks) {
    const v = new Int16Array(c);
    views.push(v);
    totalLen += v.length;
  }
  const out = new ArrayBuffer(totalLen * 2);
  const outView = new Int16Array(out);
  let offset = 0;
  for (const v of views) {
    outView.set(v, offset);
    offset += v.length;
  }
  return out;
}

/**
 * Convert Float32 samples (-1..1) to Int16 PCM (-32768..32767).
 */
export function float32ToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * Convert Int16 PCM to Float32 (-1..1).
 */
export function int16ToFloat32(input: ArrayBuffer | Int16Array): Float32Array {
  const view = input instanceof Int16Array ? input : new Int16Array(input);
  const out = new Float32Array(view.length);
  for (let i = 0; i < view.length; i++) {
    out[i] = view[i] / 0x8000;
  }
  return out;
}

/**
 * Compute RMS amplitude in [0,1] from Int16 PCM data.
 */
export function rms(int16: ArrayBuffer | Int16Array): number {
  const view = int16 instanceof Int16Array ? int16 : new Int16Array(int16);
  if (view.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < view.length; i++) {
    const n = view[i] / 0x8000;
    sumSq += n * n;
  }
  return Math.sqrt(sumSq / view.length);
}

/**
 * Linear-interpolation resampler. FALLBACK ONLY — has audible aliasing for
 * down-sampling by ≥3×. Adapter layer should prefer Speex WASM when available.
 */
export function resampleLinear(
  input: Float32Array,
  inRate: number,
  outRate: number
): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = srcIdx - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}

/**
 * Encode an ArrayBuffer of Int16 PCM to a base64 string (browser & node compatible).
 */
export function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  if (typeof btoa === 'function') {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < view.length; i += CHUNK) {
      binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  // Node fallback
  return Buffer.from(view).toString('base64');
}

/**
 * Decode a base64 string to ArrayBuffer.
 */
export function base64ToBytes(b64: string): ArrayBuffer {
  if (typeof atob === 'function') {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out.buffer;
  }
  return Buffer.from(b64, 'base64').buffer;
}
