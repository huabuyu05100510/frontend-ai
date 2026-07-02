/**
 * Phase 5 Benchmark — Route A + Route C 真正跨路 Ensemble
 *
 * 关键：两路统一在 MarianMT token 空间（srcValidIdx/tgtValidIdx）
 *   - Route A: LaBSE embedding on MarianMT tokens → simAlign argmax
 *   - Route C: MarianMT cross-attn L3 H0 → attnAlign
 *   - Ensemble: 加权投票
 *
 * 跑：node benchmark/ensemble-benchmark.mjs
 * 输出：benchmark/results/phase5-ensemble.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { buildSimMatrix, simAlign } from '../lib/labse-simalign.mjs'
import { alignWithCrossAttn } from '../lib/marian-crossattn-aligner.mjs'
import { ensemble, evaluateF1 } from '../lib/ensemble-aligner.mjs'

const LABSE_FIXTURE = 'test/fixtures/labse-embeddings-marian-tokens.json'
const CROSSATTN_FIXTURE = 'test/fixtures/marian-crossattn.json'
const GOLD = 'test/fixtures/marian-crossattn-gold.json'
const OUT_JSON = 'benchmark/results/phase5-ensemble.json'

const labse = JSON.parse(readFileSync(LABSE_FIXTURE, 'utf8'))
const crossattn = JSON.parse(readFileSync(CROSSATTN_FIXTURE, 'utf8'))
const gold = JSON.parse(readFileSync(GOLD, 'utf8'))

console.log('═══════════════════════════════════════════════════════')
console.log('  Phase 5 Benchmark — Route A + C Ensemble (unified tok)')
console.log(`  Cases: ${labse.cases.length}`)
console.log('═══════════════════════════════════════════════════════\n')

// 三种权重配置对比
const WEIGHT_CONFIGS = [
  { name: 'A=0.5/C=0.5', wA: 0.5, wC: 0.5 },
  { name: 'A=0.7/C=0.3', wA: 0.7, wC: 0.3 },
  { name: 'A=0.3/C=0.7', wA: 0.3, wC: 0.7 },
]

const results = []

for (let ci = 0; ci < labse.cases.length; ci++) {
  const l = labse.cases[ci]
  const x = crossattn.cases[ci]
  const g = gold.cases[ci]

  // Route A: LaBSE on MarianMT tokens, simAlign argmax（双向并集，保留多对一能力）
  const sim = buildSimMatrix(l.srcEmb, l.tgtEmb)
  const routeA = simAlign(sim, { strategy: 'argmax' })
  // score 是 cosine (-1..1)，转 0..1 给 ensemble 用
  const routeA_norm = routeA.map(p => ({ ...p, score: (p.score + 1) / 2 }))

  // Route C
  const routeC = alignWithCrossAttn(x)

  // Ensemble 多权重
  const perConfig = {}
  for (const cfg of WEIGHT_CONFIGS) {
    const ens = ensemble([
      { name: 'A', weight: cfg.wA, pairs: routeA_norm },
      { name: 'C', weight: cfg.wC, pairs: routeC },
    ])
    // 只保留 {tgtIdx, srcIdx} 给 F1
    const pairs = ens.map(p => ({ tgtIdx: p.tgtIdx, srcIdx: p.srcIdx }))
    const f1 = evaluateF1(pairs, g.alignments)
    perConfig[cfg.name] = f1
  }

  const f1A = evaluateF1(routeA, g.alignments)
  const f1C = evaluateF1(routeC, g.alignments)

  console.log(`▶ Case ${ci+1}: "${l.src}"  →  gen="${g.gen_tgt}"`)
  console.log(`    Route A only: F1=${f1A.f1.toFixed(3)} (P=${f1A.precision.toFixed(2)} R=${f1A.recall.toFixed(2)})`)
  console.log(`    Route C only: F1=${f1C.f1.toFixed(3)} (P=${f1C.precision.toFixed(2)} R=${f1C.recall.toFixed(2)})`)
  for (const cfg of WEIGHT_CONFIGS) {
    const f = perConfig[cfg.name]
    console.log(`    Ensemble ${cfg.name}: F1=${f.f1.toFixed(3)} (P=${f.precision.toFixed(2)} R=${f.recall.toFixed(2)})`)
  }
  console.log('')

  results.push({
    caseIdx: ci,
    src: l.src,
    gen_tgt: g.gen_tgt,
    f1A, f1C,
    f1Ensemble: perConfig,
    routeAPairs: routeA.length,
    routeCPairs: routeC.length,
    goldCount: g.alignments.length,
  })
}

// 汇总
const avg = key => results.reduce((s, r) => s + r[key].f1, 0) / results.length
const avgEns = name => results.reduce((s, r) => s + r.f1Ensemble[name].f1, 0) / results.length

const summary = {
  routeA_avgF1: Number(avg('f1A').toFixed(3)),
  routeC_avgF1: Number(avg('f1C').toFixed(3)),
  ensemble_50_50: Number(avgEns('A=0.5/C=0.5').toFixed(3)),
  ensemble_70_30: Number(avgEns('A=0.7/C=0.3').toFixed(3)),
  ensemble_30_70: Number(avgEns('A=0.3/C=0.7').toFixed(3)),
}

// 找最佳配置
const configs = ['ensemble_50_50', 'ensemble_70_30', 'ensemble_30_70']
const best = configs.reduce((b, c) => summary[c] > summary[b] ? c : b, 'ensemble_50_50')
summary.best = best
summary.bestF1 = summary[best]
summary.vsRouteA = Number((summary.bestF1 - summary.routeA_avgF1).toFixed(3))
summary.vsRouteC = Number((summary.bestF1 - summary.routeC_avgF1).toFixed(3))

writeFileSync(OUT_JSON, JSON.stringify({ summary, cases: results }, null, 2))

console.log('───────────────────────────────────────────────────────')
console.log('  Summary:')
Object.entries(summary).forEach(([k, v]) => console.log(`    ${k}: ${v}`))
console.log(`\n✓ 结果落盘: ${OUT_JSON}`)
