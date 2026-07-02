/**
 * Phase 2 策略对比：argmax / itermax / union / intersect / grow_diag
 * 找出哪个策略对 zh-en（多对一）最友好
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { buildSimMatrix, simAlign, argmax, itermax } from '../lib/labse-simalign.mjs'
import { evaluateF1 } from '../lib/ensemble-aligner.mjs'

const fixture = JSON.parse(readFileSync('test/fixtures/labse-embeddings.json', 'utf8'))
const gold = JSON.parse(readFileSync('test/fixtures/align-gold.json', 'utf8'))

const strategies = ['argmax', 'union', 'intersect', 'grow_diag']

// 自定义 argmax 策略（多对一友好）
const argmaxStrategy = (sim) => argmax(sim)

console.log('策略对比（8 cases, LaBSE SimAlign）\n')
console.log('Case |  Gold | ' + strategies.map(s => s.padStart(16)).join(' | '))
console.log('-'.repeat(80))

const summary = Object.fromEntries(strategies.map(s => [s, { f1: [], p: [], r: [] }]))

for (let ci = 0; ci < fixture.cases.length; ci++) {
  const c = fixture.cases[ci]
  const srcEmb = c.srcEmb.slice(1, c.srcSeqLen - 1)
  const tgtEmb = c.tgtEmb.slice(1, c.tgtSeqLen - 1)
  const sim = buildSimMatrix(srcEmb, tgtEmb)
  const g = gold.cases[ci]

  const line = [`C${ci + 1}`.padEnd(5), `${g.alignments.length}`.padStart(5)]

  for (const s of strategies) {
    let predicted
    if (s === 'argmax') {
      predicted = argmaxStrategy(sim)
    } else {
      predicted = simAlign(sim, { strategy: s })
    }
    const r = evaluateF1(predicted, g.alignments)
    summary[s].f1.push(r.f1)
    summary[s].p.push(r.precision)
    summary[s].r.push(r.recall)
    line.push(`${r.f1.toFixed(3)}(P${r.precision.toFixed(2)}/R${r.recall.toFixed(2)})`.padStart(16))
  }
  console.log(line.join(' | '))
}

console.log('\n平均：')
for (const s of strategies) {
  const avg = arr => arr.reduce((x, y) => x + y, 0) / arr.length
  console.log(`  ${s.padEnd(12)} F1=${avg(summary[s].f1).toFixed(3)}  P=${avg(summary[s].p).toFixed(3)}  R=${avg(summary[s].r).toFixed(3)}`)
}

// 还测一个 "argmax 双向各自独立"（forward + reverse 都保留为多对一）
console.log('\n补充 — 双向 argmax 独立合并（多对一友好）：')
let fwdF1 = { f1: 0, count: 0 }
for (let ci = 0; ci < fixture.cases.length; ci++) {
  const c = fixture.cases[ci]
  const srcEmb = c.srcEmb.slice(1, c.srcSeqLen - 1)
  const tgtEmb = c.tgtEmb.slice(1, c.tgtSeqLen - 1)
  const sim = buildSimMatrix(srcEmb, tgtEmb)
  // forward only: 每个 tgt 找 src（多对一）
  const fwdPairs = []
  for (let t = 0; t < tgtEmb.length; t++) {
    let bestS = 0, bestV = sim[0][t]
    for (let s = 1; s < srcEmb.length; s++) {
      if (sim[s][t] > bestV) { bestV = sim[s][t]; bestS = s }
    }
    fwdPairs.push({ srcIdx: bestS, tgtIdx: t })
  }
  const r = evaluateF1(fwdPairs, gold.cases[ci].alignments)
  fwdF1.f1 += r.f1; fwdF1.count++
}
console.log(`  forward-argmax (tgt→src) avg F1 = ${(fwdF1.f1 / fwdF1.count).toFixed(3)}`)

writeFileSync('benchmark/results/phase2-strategy-compare.json', JSON.stringify({
  perStrategy: Object.fromEntries(
    Object.entries(summary).map(([k, v]) => {
      const avg = arr => arr.reduce((x, y) => x + y, 0) / arr.length
      return [k, { avgF1: avg(v.f1), avgP: avg(v.p), avgR: avg(v.r), perCase: v.f1 }]
    })
  ),
}, null, 2))
