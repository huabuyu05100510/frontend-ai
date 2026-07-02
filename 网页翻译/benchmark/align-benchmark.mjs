/**
 * Phase 2-5 benchmark：LaBSE SimAlign 端到端 + F1 评估
 *
 * 流程：
 *   1. 读 test/fixtures/labse-embeddings.json（LaBSE 已提取的 token 级 embedding）
 *   2. 每个 case：buildSimMatrix → simAlign(grow_diag) → 对齐对
 *   3. 可选：与金标准对比算 F1
 *
 * 跑：
 *   node benchmark/align-benchmark.mjs
 *
 * 输出：
 *   benchmark/results/phase2-simalign.json
 *   benchmark/results/phase2-simalign.log
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { buildSimMatrix, simAlign, argmax, itermax } from '../lib/labse-simalign.mjs'

const FIXTURE = 'test/fixtures/labse-embeddings.json'
const GOLD = 'test/fixtures/align-gold.json'
const OUT_JSON = 'benchmark/results/phase2-simalign.json'

if (!existsSync(FIXTURE)) {
  console.error(`✗ fixture 不存在: ${FIXTURE}`)
  console.error(`  请先跑: node spike/phase2/extract-labse.mjs`)
  process.exit(1)
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const gold = existsSync(GOLD) ? JSON.parse(readFileSync(GOLD, 'utf8')) : null

console.log('═══════════════════════════════════════════════════════')
console.log('  Phase 2 Benchmark — LaBSE + SimAlign')
console.log(`  Model: ${fixture.model}`)
console.log(`  Cases: ${fixture.cases.length}`)
console.log('═══════════════════════════════════════════════════════\n')

const results = []

for (let ci = 0; ci < fixture.cases.length; ci++) {
  const c = fixture.cases[ci]
  // 去掉 [CLS] (idx 0) 和 [SEP] (last)
  const srcEmb = c.srcEmb.slice(1, c.srcSeqLen - 1)
  const tgtEmb = c.tgtEmb.slice(1, c.tgtSeqLen - 1)

  const t0 = Date.now()
  const sim = buildSimMatrix(srcEmb, tgtEmb)
  const aligned = simAlign(sim, { strategy: 'argmax' })
  const dt = Date.now() - t0

  // 构造可读 token 标注（用 sim 矩阵的反查 + 字符）
  const pairsDisplay = aligned.map(p => ({
    tgtIdx: p.tgtIdx,
    srcIdx: p.srcIdx,
    score: Number(p.score.toFixed(3)),
  }))

  console.log(`▶ Case ${ci + 1}: "${c.src}"  ⇆  "${c.tgt}"`)
  console.log(`  src tokens=${srcEmb.length}, tgt tokens=${tgtEmb.length}, ${dt}ms`)
  console.log(`  对齐 (${aligned.length} 对):`)
  pairsDisplay.forEach(p => console.log(`    tgt[${p.tgtIdx}] → src[${p.srcIdx}]  score=${p.score}`))

  let f1info = null
  if (gold && gold.cases[ci]) {
    const g = gold.cases[ci]
    const { evaluateF1 } = await import('../lib/ensemble-aligner.mjs')
    f1info = evaluateF1(aligned, g.alignments)
    console.log(`  金标准对比: P=${f1info.precision.toFixed(3)} R=${f1info.recall.toFixed(3)} F1=${f1info.f1.toFixed(3)}  (tp=${f1info.tp} pred=${f1info.predCount} gold=${f1info.goldCount})`)
  }
  console.log('')

  results.push({
    caseIdx: ci,
    src: c.src,
    tgt: c.tgt,
    srcTokenCount: srcEmb.length,
    tgtTokenCount: tgtEmb.length,
    latencyMs: dt,
    alignments: pairsDisplay,
    f1: f1info,
  })
}

// 汇总
const summary = {
  model: fixture.model,
  totalCases: results.length,
  avgLatencyMs: Number((results.reduce((s, r) => s + r.latencyMs, 0) / results.length).toFixed(2)),
  avgAlignmentsPerCase: Number((results.reduce((s, r) => s + r.alignments.length, 0) / results.length).toFixed(1)),
}
if (gold) {
  const f1s = results.filter(r => r.f1).map(r => r.f1.f1)
  if (f1s.length) {
    summary.avgF1 = Number((f1s.reduce((s, f) => s + f, 0) / f1s.length).toFixed(3))
    summary.minF1 = Number(Math.min(...f1s).toFixed(3))
    summary.maxF1 = Number(Math.max(...f1s).toFixed(3))
  }
}

writeFileSync(OUT_JSON, JSON.stringify({ summary, cases: results }, null, 2))
console.log('───────────────────────────────────────────────────────')
console.log(`  Summary:`)
Object.entries(summary).forEach(([k, v]) => console.log(`    ${k}: ${v}`))
console.log(`\n✓ 结果落盘: ${OUT_JSON}`)
