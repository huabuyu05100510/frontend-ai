/**
 * Phase 3 Route C benchmark：MarianMT cross-attention 对齐
 *
 * 跑：node benchmark/route-c-benchmark.mjs
 * 输出：benchmark/results/phase3-route-c.json + log
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { alignWithCrossAttn } from '../lib/marian-crossattn-aligner.mjs'
import { evaluateF1 } from '../lib/ensemble-aligner.mjs'

const FIXTURE = 'test/fixtures/marian-crossattn.json'
const GOLD = 'test/fixtures/marian-crossattn-gold.json'
const OUT_JSON = 'benchmark/results/phase3-route-c.json'

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const gold = JSON.parse(readFileSync(GOLD, 'utf8'))

console.log('═══════════════════════════════════════════════════════')
console.log('  Phase 3 Benchmark — Route C MarianMT cross-attention')
console.log(`  Model: ${fixture.model}`)
console.log(`  Cases: ${fixture.cases.length}`)
console.log('═══════════════════════════════════════════════════════\n')

const results = []
for (let ci = 0; ci < fixture.cases.length; ci++) {
  const c = fixture.cases[ci]
  const t0 = Date.now()
  const aligned = alignWithCrossAttn(c)
  const dt = Date.now() - t0
  const g = gold.cases[ci]
  const r = evaluateF1(aligned, g.alignments)

  // 检查 cross-attn 信号集中度（attention 是否尖锐）
  // 取每个 tgt token 的 max attention 值，平均后反映「信号强度」
  const { crossAttn, tgtTokens, srcTokens } = c
  let maxAttnSum = 0, maxAttnCount = 0
  for (let i = 0; i < tgtTokens.length; i++) {
    if (tgtTokens[i].trim() === '' || tgtTokens[i] === '</s>' || tgtTokens[i] === '<pad>') continue
    const row = crossAttn[i]
    if (!row) continue
    const maxV = Math.max(...row)
    maxAttnSum += maxV
    maxAttnCount++
  }
  const avgMaxAttn = maxAttnCount > 0 ? maxAttnSum / maxAttnCount : 0

  console.log(`▶ Case ${ci + 1}: "${c.src}"  →  gen="${g.gen_tgt}"`)
  console.log(`  gold note: ${g.note || '—'}`)
  console.log(`  src tokens: ${c.srcTokens.filter(t => t && t !== '</s>' && t !== '<pad>').join('|')}`)
  console.log(`  tgt tokens (gen): ${c.tgtTokens.filter(t => t && t !== '</s>' && t !== '<pad>').join('|')}`)
  console.log(`  aligned ${aligned.length} 对，${dt}ms`)
  console.log(`  avg max attention = ${avgMaxAttn.toFixed(3)} （信号集中度，越高越尖）`)
  console.log(`  F1: P=${r.precision.toFixed(3)} R=${r.recall.toFixed(3)} F1=${r.f1.toFixed(3)}  (tp=${r.tp}/${r.goldCount} gold)`)
  console.log('')

  results.push({
    caseIdx: ci,
    src: c.src,
    gen_tgt: g.gen_tgt,
    note: g.note,
    alignedCount: aligned.length,
    goldCount: g.alignments.length,
    avgMaxAttn: Number(avgMaxAttn.toFixed(3)),
    latencyMs: dt,
    f1: r,
    alignments: aligned.map(p => ({ tgtIdx: p.tgtIdx, srcIdx: p.srcIdx, score: Number(p.score.toFixed(3)) })),
  })
}

const f1s = results.map(r => r.f1.f1)
const summary = {
  model: fixture.model,
  route: 'C (MarianMT cross-attention)',
  totalCases: results.length,
  avgF1: Number((f1s.reduce((s, f) => s + f, 0) / f1s.length).toFixed(3)),
  minF1: Number(Math.min(...f1s).toFixed(3)),
  maxF1: Number(Math.max(...f1s).toFixed(3)),
  avgMaxAttn: Number((results.reduce((s, r) => s + r.avgMaxAttn, 0) / results.length).toFixed(3)),
  avgLatencyMs: Number((results.reduce((s, r) => s + r.latencyMs, 0) / results.length).toFixed(2)),
  vsRouteA: {
    routeA_avgF1: 0.841,
    diff: Number((f1s.reduce((s, f) => s + f, 0) / f1s.length - 0.841).toFixed(3)),
  },
}

writeFileSync(OUT_JSON, JSON.stringify({ summary, cases: results }, null, 2))
console.log('───────────────────────────────────────────────────────')
console.log(`  Summary:`)
Object.entries(summary).forEach(([k, v]) => {
  if (typeof v === 'object') {
    console.log(`    ${k}:`)
    Object.entries(v).forEach(([k2, v2]) => console.log(`      ${k2}: ${v2}`))
  } else {
    console.log(`    ${k}: ${v}`)
  }
})
console.log(`\n✓ 结果落盘: ${OUT_JSON}`)
