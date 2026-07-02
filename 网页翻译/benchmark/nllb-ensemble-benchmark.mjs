/**
 * Phase 6 Ensemble：NLLB Route C + LaBSE Route A
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { buildSimMatrix, simAlign } from '../lib/labse-simalign.mjs'
import { alignWithCrossAttn } from '../lib/marian-crossattn-aligner.mjs'
import { ensemble, evaluateF1 } from '../lib/ensemble-aligner.mjs'

const LABSE_FIXTURE = 'test/fixtures/labse-embeddings-nllb-tokens.json'
const CROSSATTN_FIXTURE = 'test/fixtures/nllb-crossattn-L0H15.json'
const GOLD = 'test/fixtures/nllb-crossattn-gold.json'
const OUT_JSON = 'benchmark/results/phase6-ensemble.json'

const labse = JSON.parse(readFileSync(LABSE_FIXTURE, 'utf8'))
const crossattn = JSON.parse(readFileSync(CROSSATTN_FIXTURE, 'utf8'))
const gold = JSON.parse(readFileSync(GOLD, 'utf8'))

console.log('═══════════════════════════════════════════════════════')
console.log('  Phase 6 Ensemble — NLLB Route C + LaBSE Route A')
console.log('═══════════════════════════════════════════════════════\n')

const WEIGHT_CONFIGS = [
  { name: 'A=0.5/C=0.5', wA: 0.5, wC: 0.5 },
  { name: 'A=0.7/C=0.3', wA: 0.7, wC: 0.3 },
  { name: 'A=0.3/C=0.7', wA: 0.3, wC: 0.7 },
  { name: 'A=0.0/C=1.0', wA: 0.0, wC: 1.0 },
]

const results = []

for (let ci = 0; ci < labse.cases.length; ci++) {
  const l = labse.cases[ci]
  const x = crossattn.cases[ci]
  const g = gold.cases[ci]

  const sim = buildSimMatrix(l.srcEmb, l.tgtEmb)
  const routeA = simAlign(sim, { strategy: 'argmax' })
  const routeA_norm = routeA.map(p => ({ ...p, score: (p.score + 1) / 2 }))

  const routeC = alignWithCrossAttn(x, { threshold: 0.1 })

  const perConfig = {}
  for (const cfg of WEIGHT_CONFIGS) {
    if (cfg.wA === 0) {
      const pairs = routeC.map(p => ({ tgtIdx: p.tgtIdx, srcIdx: p.srcIdx }))
      perConfig[cfg.name] = evaluateF1(pairs, g.alignments)
      continue
    }
    const ens = ensemble([
      { name: 'A', weight: cfg.wA, pairs: routeA_norm },
      { name: 'C', weight: cfg.wC, pairs: routeC },
    ])
    const pairs = ens.map(p => ({ tgtIdx: p.tgtIdx, srcIdx: p.srcIdx }))
    perConfig[cfg.name] = evaluateF1(pairs, g.alignments)
  }

  const f1A = evaluateF1(routeA, g.alignments)
  const f1C = evaluateF1(routeC, g.alignments)

  console.log(`▶ Case ${ci+1}: "${l.src}" → "${g.gen_tgt}"`)
  console.log(`    Route A only: F1=${f1A.f1.toFixed(3)} (P=${f1A.precision.toFixed(2)} R=${f1A.recall.toFixed(2)})`)
  console.log(`    Route C only: F1=${f1C.f1.toFixed(3)} (P=${f1C.precision.toFixed(2)} R=${f1C.recall.toFixed(2)})`)
  for (const cfg of WEIGHT_CONFIGS) {
    const f = perConfig[cfg.name]
    console.log(`    Ensemble ${cfg.name}: F1=${f.f1.toFixed(3)}`)
  }
  console.log('')

  results.push({ caseIdx: ci, f1A, f1C, f1Ensemble: perConfig })
}

const avg = key => results.reduce((s, r) => s + r[key].f1, 0) / results.length
const avgEns = name => results.reduce((s, r) => s + r.f1Ensemble[name].f1, 0) / results.length

const summary = {
  routeA_avgF1: Number(avg('f1A').toFixed(3)),
  routeC_avgF1: Number(avg('f1C').toFixed(3)),
  ensemble_50_50: Number(avgEns('A=0.5/C=0.5').toFixed(3)),
  ensemble_70_30: Number(avgEns('A=0.7/C=0.3').toFixed(3)),
  ensemble_30_70: Number(avgEns('A=0.3/C=0.7').toFixed(3)),
}

writeFileSync(OUT_JSON, JSON.stringify({ summary, cases: results }, null, 2))

console.log('───────────────────────────────────────────────────────')
console.log('  Summary (NLLB Phase 6):')
Object.entries(summary).forEach(([k, v]) => console.log(`    ${k}: ${v}`))

// 对比 Phase 5
console.log('\n  对比 Phase 5（opus-mt）:')
console.log('    Phase 5 Route A only: 0.706 | Route C only: 0.704 | Ensemble best: 0.781')
console.log(`    Phase 6 Route A only: ${summary.routeA_avgF1} | Route C only: ${summary.routeC_avgF1} | Ensemble best: ${Math.max(summary.ensemble_50_50, summary.ensemble_70_30, summary.ensemble_30_70)}`)
console.log(`\n✓ 落盘: ${OUT_JSON}`)
