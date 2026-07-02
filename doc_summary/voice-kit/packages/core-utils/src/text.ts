/**
 * Text & hashing utilities for ASR dedup heuristics.
 */

/**
 * djb2 hash with unsigned 32-bit conversion (>>> 0).
 * Used for stable speaker → color mapping across sessions.
 * The `>>> 0` is critical: avoids Math.abs(-2^31) bug (returns negative).
 */
export function djb2Hash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Strip all Unicode punctuation & whitespace for robust text comparison.
 * Volcengine resends cumulative text with punctuation changes between frames;
 * this normalization makes prefix-comparison stable.
 *
 * Uses Unicode property escapes (\p{P}\p{S}) — ES2018+.
 */
export function normalizeForCompare(text: string): string {
  return text.replace(/[\p{P}\p{S}\s]/gu, '');
}

/**
 * Prefix overlap ratio in [0,1]. 0 = no overlap, 1 = `prefix` is a complete
 * prefix of `text`. Operates on normalized strings.
 */
export function prefixOverlap(prefix: string, text: string): number {
  const a = normalizeForCompare(prefix);
  const b = normalizeForCompare(text);
  if (a.length === 0 || b.length === 0) return 0;
  const maxLen = Math.min(a.length, b.length);
  let i = 0;
  while (i < maxLen && a[i] === b[i]) i++;
  return i / b.length;
}

/**
 * Speaker color palette — 12 colors mapped by djb2 hash modulo.
 */
export const SPEAKER_PALETTE = [
  '#5B8FF9',
  '#5AD8A6',
  '#5D7092',
  '#F6BD16',
  '#E86452',
  '#6DC8EC',
  '#945FB9',
  '#FF9845',
  '#1E9493',
  '#FF99C3',
  '#A78BFA',
  '#FBCFE8',
] as const;

export function getSpeakerColor(speakerId: string): string {
  return SPEAKER_PALETTE[djb2Hash(speakerId) % SPEAKER_PALETTE.length];
}
