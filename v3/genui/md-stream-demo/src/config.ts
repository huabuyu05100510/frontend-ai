export const SPEEDS = {
  slow: { label: '慢速', charsPerTick: 2, intervalMs: 55 },
  normal: { label: '中速', charsPerTick: 7, intervalMs: 28 },
  fast: { label: '快速', charsPerTick: 20, intervalMs: 16 },
  stress: { label: '极速', charsPerTick: 60, intervalMs: 0 },
} as const;

export type SpeedKey = keyof typeof SPEEDS;
