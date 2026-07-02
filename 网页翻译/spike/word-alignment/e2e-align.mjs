/**
 * e2e-align —— 端到端跑 5 个测试用例，打印对齐结果，写 JSON
 *
 * 用法：
 *   cd spike/word-alignment
 *   node e2e-align.mjs
 *
 * 输出：
 *   - 控制台：每个 case 的对齐列表（tgt → src 评分）
 *   - results/e2e-alignment.json：符合可视化契约的 JSON
 *
 * 模型：Claude (Sonnet 4.5)
 */

import { alignSentence } from '../../lib/word-aligner.mjs'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CASES = [
  { src: 'The quick brown fox jumps over the lazy dog', tgt: '棕色的狐狸跳过懒狗' },
  { src: 'I love you',                                  tgt: '我爱你' },
  { src: 'Hello world',                                  tgt: '你好世界' },
  { src: 'The cat is sleeping',                          tgt: '猫在睡觉' },
  { src: 'Open the door',                                tgt: '打开门' },
]

// 每个用例的"直觉正确"标注（人工对照：哪些 tgt token 应对齐到哪个 src）
// 用于打印时打勾/打叉
// 字段：tgtText → [可接受的 srcIdx 集合]（容错：可能是多个合理答案）
// ⚠ 注意 MarianMT en-zh 的 tokenizer 把中文按"词/字组合"切成多 char token：
//   - "我爱你" 可能是 1 个 token（"我爱你"）或拆成"我" "爱你"
//   - "你好" "世界" "打开" "睡觉" 通常是各自 1 个 token
// GOLD 里的 key 是「实际 decode 出来的 tgt token 字符串」，与运行时 result.tgtTokens 对应。
// srcIdx 用「visible src token 下标」（即去掉 special 后），方便人工核对。
const GOLD = [
  // case 0: 棕色的狐狸跳过懒狗 vs The quick brown fox jumps over the lazy dog
  // src visible: [0]The [1]quick [2]brown [3]fox [4]jump [5]s [6]over [7]the [8]lazy [9]dog
  // (注：jumps 被 BPE 拆为 jump + s，gold 里 [4,5] 都接受)
  {
    '棕':  [2],
    '色':  [2],
    '的':  [0, 3, 7],   // 虚词，宽松
    '狐':  [3],
    '狸':  [3],
    '跳':  [4, 5],
    '过':  [4, 5, 6],
    '懒':  [8],
    '狗':  [9],
  },
  // case 1: 我爱你 vs I love you — 可能 1 个或多个 token
  {
    '我':   [0],
    '爱':   [1],
    '你':   [2],
    '我爱你': [0, 1, 2],  // 整段算"可对齐到任一"，因为是 1 个 token
  },
  // case 2: 你好世界 vs Hello world — "你好"/"世界" 各 1 token
  {
    '你好': [0],
    '世界': [1],
  },
  // case 3: 猫在睡觉 vs The cat is sleeping
  {
    '猫':   [1],
    '在':   [2],
    '睡觉': [3],
  },
  // case 4: 打开门 vs Open the door
  {
    '打开': [0],
    '门':   [2],
  },
]

function fmtScore(s) {
  return (s >= 0 ? '+' : '') + s.toFixed(3)
}

function prettyPrintCase(caseIdx, src, tgt, result, goldMap) {
  console.log('─'.repeat(70))
  console.log(`Case ${caseIdx + 1}`)
  console.log(`  src: "${src}"`)
  console.log(`  tgt: "${tgt}"`)

  // 可见 token list
  const srcVisible = result.srcTokens.filter(t => !t.special)
  const tgtVisible = result.tgtTokens.filter(t => !t.special)
  console.log(`  srcTokens (visible ${srcVisible.length}):`)
  srcVisible.forEach((t, visIdx) =>
    console.log(`    [v${visIdx} id${t.idx}] "${t.text}" (${t.start ?? '?'}..${t.end ?? '?'})`)
  )
  console.log(`  tgtTokens (visible ${tgtVisible.length}):`)
  tgtVisible.forEach((t, visIdx) =>
    console.log(`    [v${visIdx} id${t.idx}] "${t.text}" (${t.start ?? '?'}..${t.end ?? '?'})`)
  )

  // 构造 id-space idx → visible-space idx 映射
  const srcIdToVis = new Map()
  srcVisible.forEach((t, visIdx) => srcIdToVis.set(t.idx, visIdx))
  const tgtIdToVis = new Map()
  tgtVisible.forEach((t, visIdx) => tgtIdToVis.set(t.idx, visIdx))

  // 对齐表 + gold 对照（gold 用 visible src idx）
  console.log(`  alignments (${result.alignments.length}):`)
  let correct = 0
  let total = 0
  let semanticallyOK = 0
  result.alignments.forEach(a => {
    const tgtTok = result.tgtTokens[a.tgtIdx]
    const srcTok = result.srcTokens[a.srcIdx]
    const tgtText = tgtTok.text.replace(/\s+/g, '')
    const visSrcIdx = srcIdToVis.get(a.srcIdx)
    const goldSrcIdxSet = goldMap?.[tgtText]
    total++
    let marker = '  '
    if (goldSrcIdxSet) {
      if (goldSrcIdxSet.includes(visSrcIdx)) {
        marker = '✓ '
        correct++
        semanticallyOK++
      } else {
        marker = '✗ '
      }
    } else {
      // 虚词 / 没有标注的，不算对也不算错
      marker = '· '
    }
    console.log(
      `    ${marker}tgt[v${tgtIdToVis.get(a.tgtIdx)}]"${tgtText}" → src[v${visSrcIdx}]"${srcTok.text}"  score=${fmtScore(a.score)}`
    )
  })

  const precision = total > 0 ? correct / total : 0
  console.log(
    `  直觉判定：${correct}/${total} 严格对齐（precision=${(precision * 100).toFixed(1)}%），${semanticallyOK} 语义对齐`
  )
}

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  E2E Word Alignment (fingerprint-v1)')
  console.log('  model: Xenova/opus-mt-en-zh')
  console.log('═══════════════════════════════════════════════════════\n')

  const cases = []
  for (let i = 0; i < CASES.length; i++) {
    const { src, tgt } = CASES[i]
    const t0 = Date.now()
    try {
      const result = await alignSentence(src, tgt, { verbose: false })
      const elapsed = Date.now() - t0
      prettyPrintCase(i, src, tgt, result, GOLD[i])
      console.log(`  ⏱ ${elapsed} ms`)

      // 契约要求：tokens 字段只有 {text, start, end}，不要把 idx/special 泄漏到 JSON
      cases.push({
        src,
        tgt,
        srcTokens: result.srcTokens
          .filter(t => !t.special)
          .map(t => ({ text: t.text, start: t.start, end: t.end })),
        tgtTokens: result.tgtTokens
          .filter(t => !t.special)
          .map(t => ({ text: t.text, start: t.start, end: t.end })),
        // 注意：去掉 special 后，srcIdx/tgtIdx 需要重新映射到「可见 token 数组里的下标」
        alignments: remapAlignments(result),
        method: result.method,
      })
    } catch (err) {
      console.error(`Case ${i + 1} FAILED:`, err)
      throw err
    }
  }

  // 写 JSON
  const out = {
    meta: {
      model: 'Xenova/opus-mt-en-zh',
      method: 'fingerprint-v1',
      timestamp: new Date().toISOString(),
      description:
        'K-fingerprint alignment: src vectors = last-layer cross-attn K (present.5.encoder.key), tgt vectors = last-layer self-attn K (present.5.decoder.key), cosine argmax',
    },
    cases,
  }
  const outDir = path.join(__dirname, 'results')
  await mkdir(outDir, { recursive: true })
  const outPath = path.join(outDir, 'e2e-alignment.json')
  await writeFile(outPath, JSON.stringify(out, null, 2), 'utf8')
  console.log('\n═══════════════════════════════════════════════════════')
  console.log(`✅ JSON written: ${outPath}`)
  console.log('═══════════════════════════════════════════════════════')
}

/**
 * 把 alignments 的 tgtIdx/srcIdx 从「含 special 的 id 序列下标」
 * 重新映射到「去掉 special 后的可见 token 数组下标」。
 * 这样可视化层用 alignments[t].srcIdx 直接索引 srcTokens 数组即可。
 */
function remapAlignments(result) {
  // 构造 id 序列下标 → 可见下标 的映射
  const srcMap = []
  const tgtMap = []
  result.srcTokens.forEach((t, i) => {
    if (!t.special) srcMap.push(i)
  })
  result.tgtTokens.forEach((t, i) => {
    if (!t.special) tgtMap.push(i)
  })
  const srcIdxToVisible = new Map()
  srcMap.forEach((idIdx, visIdx) => srcIdxToVisible.set(idIdx, visIdx))
  const tgtIdxToVisible = new Map()
  tgtMap.forEach((idIdx, visIdx) => tgtIdxToVisible.set(idIdx, visIdx))

  return result.alignments
    .map(a => ({
      tgtIdx: tgtIdxToVisible.get(a.tgtIdx),
      srcIdx: srcIdxToVisible.get(a.srcIdx),
      score: a.score,
    }))
    .filter(a => a.tgtIdx != null && a.srcIdx != null)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
