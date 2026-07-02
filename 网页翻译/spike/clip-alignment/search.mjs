/**
 * search.mjs — 浏览器内图搜 PoC：以图搜图 + 以文搜图
 *
 * 用法：
 *   node search.mjs --text "a dog"
 *   node search.mjs --image ./images/dog.jpg
 *   node search.mjs --demo        # 跑所有 demo 用例并写 search-demo.json
 *
 * 模型声明：Xenova/clip-vit-base-patch16（英文 CLIP）
 * 索引：./results/image-search-index.json（由 build-index.mjs 生成）
 */
import { env, AutoProcessor, AutoTokenizer, AutoModel, RawImage } from '@huggingface/transformers'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── 配置 ────────────────────────────────────────────────
env.allowLocalModels = false
env.allowRemoteModels = true
env.remoteHost = 'https://hf-mirror.com'
env.remotePathTemplate = '{model}/resolve/{revision}/'

const MODEL = 'Xenova/clip-vit-base-patch16'
const __dirname = dirname(fileURLToPath(import.meta.url))
const INDEX_PATH = resolve(__dirname, 'results', 'image-search-index.json')
const DEMO_OUT_PATH = resolve(__dirname, 'results', 'search-demo.json')
const TOP_K = 3

// ─── 工具函数 ────────────────────────────────────────────
function normalize(v) {
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) + 1e-8
  return v.map((x) => x / n)
}
// 已归一化向量的余弦 = 点积
function cosine(a, b) {
  return a.reduce((s, x, i) => s + x * b[i], 0)
}

function topK(index, queryEmbedding, k = TOP_K) {
  return index.items
    .map((it) => ({
      id: it.id,
      label: it.label,
      path: it.path,
      score: cosine(queryEmbedding, it.embedding),
    }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
}

function fmtResults(results) {
  return results.map((r) => `    ${r.score.toFixed(4)}  ${r.id}  "${r.label}"`).join('\n')
}

// ─── 编码器 ──────────────────────────────────────────────
async function encodeImage(model, processor, tokenizer, imagePath) {
  const image = await RawImage.read(imagePath)
  const imageInputs = await processor(image)
  const textInputs = tokenizer('a', { padding: true, truncation: true })
  const { image_embeds } = await model({ ...imageInputs, ...textInputs })
  const data = await image_embeds.data
  return normalize(Array.from(data))
}

async function encodeText(model, processor, tokenizer, query) {
  const textInputs = tokenizer([query], { padding: true, truncation: true })
  // CLIP forward 需要图像输入，给 1x1 占位图不现实
  // transformers.js 的 CLIP 允许只传 text 时走 text_model 分支吗？不一定
  // 安全做法：复用索引中第一张图作为占位（反正只取 text_embeds）
  const imageInputs = await processor(await RawImage.read(resolve(__dirname, index.items[0].path)))
  const { text_embeds } = await model({ ...imageInputs, ...textInputs })
  const data = await text_embeds.data
  return normalize(Array.from(data.slice(0, 512))) // 只取第一条 query
}

// ─── 主流程 ──────────────────────────────────────────────
let index
async function loadIndex() {
  if (!existsSync(INDEX_PATH)) {
    console.error(`✗ 索引不存在：${INDEX_PATH}`)
    console.error(`  请先运行：node build-index.mjs`)
    process.exit(1)
  }
  index = JSON.parse(await readFile(INDEX_PATH, 'utf8'))
  console.log(`  ✓ 索引加载：${index.meta.count} items × ${index.meta.dim} dim`)
}

let model, processor, tokenizer
async function loadModel() {
  const t0 = Date.now()
  processor = await AutoProcessor.from_pretrained(MODEL)
  tokenizer = await AutoTokenizer.from_pretrained(MODEL)
  model = await AutoModel.from_pretrained(MODEL)
  console.log(`  ✓ 模型加载 [${Date.now() - t0}ms]`)
}

function parseArgs() {
  const args = process.argv.slice(2)
  const out = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--text') out.text = args[++i]
    else if (args[i] === '--image') out.image = args[++i]
    else if (args[i] === '--demo') out.demo = true
  }
  return out
}

async function singleQuery(query) {
  console.log(`\n▶ Query: ${query.type === 'image' ? '[image]' : '"'}${query.query}${query.type === 'image' ? '' : '"'}`)
  const t0 = Date.now()
  let emb
  if (query.type === 'text') {
    emb = await encodeText(model, processor, tokenizer, query.query)
  } else {
    const absPath = resolve(__dirname, query.query)
    emb = await encodeImage(model, processor, tokenizer, absPath)
  }
  const results = topK(index, emb)
  console.log(`  top-${TOP_K} [${Date.now() - t0}ms]:`)
  console.log(fmtResults(results))
  return { ...query, results: results.map((r) => ({ id: r.id, score: Number(r.score.toFixed(4)), label: r.label })) }
}

// ─── Demo 用例 ───────────────────────────────────────────
const DEMO_QUERIES = [
  { type: 'text', query: 'a dog' },
  { type: 'text', query: 'a cat' },
  { type: 'text', query: 'a car' },
  { type: 'text', query: 'outdoor scenery' },
  { type: 'text', query: 'a building' },
  { type: 'text', query: 'food' },
  { type: 'text', query: 'a person' },
  { type: 'text', query: 'indoor room' },
  { type: 'image', query: './images/dog.jpg' },
  { type: 'image', query: './images/cat.jpg' },
]

// ─── CLI 入口 ────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════')
console.log('  search: 以图搜图 + 以文搜图')
console.log(`  Model: ${MODEL}`)
console.log('═══════════════════════════════════════════════════════\n')

const args = parseArgs()

console.log('▶ 加载索引')
await loadIndex()

console.log('\n▶ 加载模型')
await loadModel()

if (args.demo) {
  console.log('\n═══════════════════════════════════════════════════════')
  console.log('  Demo 用例')
  console.log('═══════════════════════════════════════════════════════')
  const results = []
  for (const q of DEMO_QUERIES) {
    results.push(await singleQuery(q))
  }
  await mkdir(dirname(DEMO_OUT_PATH), { recursive: true })
  await writeFile(DEMO_OUT_PATH, JSON.stringify({ queries: results }, null, 2))
  console.log(`\n✓ Demo 结果保存：${DEMO_OUT_PATH}`)
} else if (args.text) {
  await singleQuery({ type: 'text', query: args.text })
} else if (args.image) {
  await singleQuery({ type: 'image', query: args.image })
} else {
  console.log('\n用法：')
  console.log('  node search.mjs --text "a dog"')
  console.log('  node search.mjs --image ./images/dog.jpg')
  console.log('  node search.mjs --demo')
}

console.log('\n═══════════════════════════════════════════════════════')
console.log('  search 完成')
console.log('═══════════════════════════════════════════════════════')
