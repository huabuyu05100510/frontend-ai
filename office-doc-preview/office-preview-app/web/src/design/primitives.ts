// 模型：claude-sonnet-4-6
// Primitive token scale — Radix-style 12-step palette
// Single source of truth for color values; consumed via primitivesToCSSVars()
// Single brand: Ant Blue #1677ff as blue-7 (third darkest of mid-range)
// Decision: see changes/primitives-foundation/README.md

export type ScaleName = 'slate' | 'blue' | 'purple' | 'indigo' | 'red' | 'green' | 'amber' | 'cyan' | 'magenta' | 'orange'

export const PRIMITIVES: Record<ScaleName, readonly [string, string, string, string, string, string, string, string, string, string, string, string]> = {
  slate:   ['#fcfcfd', '#f8f9fa', '#f1f3f5', '#eceef0', '#e6e8eb', '#dfe3e6', '#d3d7dc', '#b1b8be', '#8b949e', '#6e7681', '#4e5969', '#1f2329'],
  blue:    ['#f5f8ff', '#e6f4ff', '#bae0ff', '#91caff', '#69b1ff', '#4096ff', '#1677ff', '#0958d9', '#003eb3', '#002c8c', '#001d66', '#001040'],
  purple:  ['#faf5ff', '#f9f0ff', '#efdbff', '#d3adf7', '#b37feb', '#9254de', '#722ed1', '#531dab', '#391e5a', '#2c1242', '#1f0a2e', '#12051a'],
  indigo:  ['#eef0ff', '#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#3730a3', '#1e1b4b', '#16143a', '#0f0d28', '#080616'],
  red:     ['#fff1f0', '#ffccc7', '#ffa39e', '#ff7875', '#ff4d4f', '#f5222d', '#cf1322', '#a8071a', '#820014', '#5c0011', '#36000a', '#1a0003'],
  green:   ['#f6ffed', '#d9f7be', '#b7eb8f', '#95de64', '#73d13d', '#52c41a', '#389e0d', '#237804', '#135200', '#093500', '#04200a', '#011203'],
  amber:   ['#fffbe6', '#fff1b8', '#ffe58f', '#ffd666', '#ffc53d', '#faad14', '#d48806', '#ad6800', '#874d00', '#613400', '#3f2200', '#1f0e00'],
  cyan:    ['#e6fffb', '#b5f5ec', '#87e8de', '#5cdbd3', '#36cfc9', '#13c2c2', '#08979c', '#006d75', '#00474f', '#002329', '#001417', '#000a0c'],
  magenta: ['#fff0f6', '#ffd6e7', '#ffadd2', '#ff85c0', '#f759ab', '#eb2f96', '#c41d7f', '#9e1068', '#780650', '#52033a', '#2c011e', '#10000a'],
  orange:  ['#fff7e6', '#ffe7ba', '#ffd591', '#ffc069', '#ffa940', '#fa8c16', '#d46b08', '#ad4e00', '#874000', '#5c2d00', '#321900', '#170a00'],
}

export const SCALE_NAMES = Object.keys(PRIMITIVES) as ScaleName[]

/** Generate kebab-case CSS variable declarations for :root injection */
export function primitivesToCSSVars(): string {
  const lines: string[] = []
  for (const name of SCALE_NAMES) {
    PRIMITIVES[name].forEach((hex, idx) => {
      lines.push(`  --${name}-${idx + 1}: ${hex};`)
    })
  }
  return lines.join('\n')
}
