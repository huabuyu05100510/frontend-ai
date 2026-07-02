/**
 * Phase 6 Route C benchmark：NLLB-200 4 个候选 alignment head 选最优
 *
 * 跑：node benchmark/nllb-route-c-benchmark.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { alignWithCrossAttn } from '../lib/marian-crossattn-aligner.mjs'
import { evaluateF1 } from '../lib/ensemble-aligner.mjs'

const CANDIDATES = ['L1H4', 'L2H4', 'L1H10', 'L0H15']
const GOLD = 'test/fixtures/nllb-crossattn-gold.json'
const OUT_JSON = 'benchmark/results/phase6-nllb-route-c.json'

const gold = JSON.parse(readFileSync(GOLD, 'utf8'))

const allResults = {}

for (const cand of CANDIDATES) {
  const fixture = JSON.parse(readFileSync(`test/fixtures/nllb-crossattn-${cand}.json`, 'utf8'))
  console.log(`\n═══════════════════════════════════════════════════════`)
  console.log(`  Candidate: ${cand}  (${fixture.model})`)
  console.log(`═══════════════════════════════════════════════════════`)

  const results = []
  // 试多个 threshold 找最优
  const THRESHOLDS = [0.1, 0.2, 0.3]
  let bestThresholdF1 = -1
  let bestThreshold = 0.3
  const thresholdResults = {}

  for (const thr of THRESHOLDS) {
    const tResults = []
    for (let ci = 0; ci < fixture.cases.length; ci++) {
      const c = fixture.cases[ci]
      const aligned = alignWithCrossAttn(c, { threshold: thr })
      const g = gold.cases[ci]
      const r = evaluateF1(aligned, g.alignments)
      tResults.push({ ci, f1: r, aligned: aligned.length })
    }
    const avgF1 = tResults.reduce((s, r) => s + r.f1.f1, 0) / tResults.length
    thresholdResults[thr] = { avgF1, cases: tResults }
    if (avgF1 > bestThresholdF1) {
      bestThresholdF1 = avgF1
      bestThreshold = thr
    }
  }

  // 用最佳 threshold 出详细
  for (let ci = 0; ci < fixture.cases.length; ci++) {
    const c = fixture.cases[ci]
    const aligned = alignWithCrossAttn(c, { threshold: bestThreshold })
    const g = gold.cases[ci]
    const r = evaluateF1(aligned, g.alignments)

    let maxAttnSum = 0, n = 0
    for (let i = 0; i < c.tgtTokens.length; i++) {
      if (!c.crossAttn[i]) continue
      const row = c.crossAttn[i]
      const maxV = Math.max(...row)
      maxAttnSum += maxV
      n++
    }
    const avgMaxAttn = n > 0 ? maxAttnSum / n : 0

    console.log(`▶ Case ${ci+1}: "${c.src}" → "${g.gen_tgt}"`)
    console.log(`  aligned ${aligned.length} 对, avg max attn = ${avgMaxAttn.toFixed(3)} (thr=${bestThreshold})`)
    console.log(`  F1=${r.f1.toFixed(3)} (P=${r.precision.toFixed(2)} R=${r.recall.toFixed(2)})`)
    console.log('')

    results.push({ ci, f1: r, avgMaxAttn, aligned: aligned.length })
  }

  const f1s = results.map(r => r.f1.f1)
  allResults[cand] = {
    avgF1: Number((f1s.reduce((s, f) => s + f, 0) / f1s.length).toFixed(3)),
    minF1: Number(Math.min(...f1s).toFixed(3)),
    maxF1: Number(Math.max(...f1s).toFixed(3)),
    avgMaxAttn: Number((results.reduce((s, r) => s + r.avgMaxAttn, 0) / results.length).toFixed(3)),
    cases: results,
  }
  console.log(`  ${cand} summary: avgF1=${allResults[cand].avgF1} avgMaxAttn=${allResults[cand].avgMaxAttn}`)
}

// 选最佳候选
const best = Object.entries(allResults).reduce(
  (b, [k, v]) => v.avgF1 > b.f1 ? { name: k, f1: v.avgF1, maxAttn: v.avgMaxAttn } : b,
  { name: '-', f1: -1, maxAttn: 0 }
)

writeFileSync(OUT_JSON, JSON.stringify({ candidates: allResults, best }, null, 2))

console.log(`\n───────────────────────────────────────────────────────`)
console.log(`  各候选 avg F1:`)
for (const [k, v] of Object.entries(allResults)) {
  console.log(`    ${k}: F1=${v.avgF1} min=${v.minF1} max=${v.maxF1} maxAttn=${v.avgMaxAttn}`)
}
console.log(`\n  ✓ 最佳: ${best.name} (F1=${best.f1})`)
console.log(`  ✓ 落盘: ${OUT_JSON}`)
