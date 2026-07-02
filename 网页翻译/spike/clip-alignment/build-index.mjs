/**
 * build-index.mjs — 浏览器内图搜 PoC：下载图片 + 编码 + 保存索引
 *
 * 模型声明：Xenova/clip-vit-base-patch16（英文 CLIP，PoC 阶段先用英文 query）
 * 依赖：@huggingface/transformers + onnxruntime-node（已软链 node_modules）
 *
 * 输出：./results/image-search-index.json
 */
import { env, AutoProcessor, AutoTokenizer, AutoModel, RawImage } from '@huggingface/transformers'
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import https from 'node:https'

// ─── 代理自动探测（Clash Verge mixed-port 7897）─────────
const PROXY_CANDIDATES = ['http://127.0.0.1:7897', 'http://127.0.0.1:7890']
let proxyInUse = null
for (const p of PROXY_CANDIDATES) {
  try {
    const u = new URL(p)
    const net = await import('node:net')
    const sock = net.createConnection({ host: u.hostname, port: Number(u.port) })
    const ok = await new Promise((res) => {
      sock.once('connect', () => { res(true); sock.destroy() })
      sock.once('error', () => res(false))
    })
    if (ok) { proxyInUse = p; break }
  } catch { /* ignore */ }
}
if (proxyInUse) {
  console.log(`  ℹ️  使用代理：${proxyInUse}`)
  process.env.HTTP_PROXY = proxyInUse
  process.env.HTTPS_PROXY = proxyInUse
}

// 用 http.request 通过代理下载（绕过 undici 不读 env 的坑）
async function fetchViaProxy(url) {
  return new Promise((resolveP, rejectP) => {
    const target = new URL(url)
    if (proxyInUse) {
      const proxyUrl = new URL(proxyInUse)
      const proxyReq = http.request({
        host: proxyUrl.hostname,
        port: proxyUrl.port,
        method: 'GET',
        path: url,
        headers: { Host: target.host },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          fetchViaProxy(res.headers.location).then(resolveP).catch(rejectP)
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolveP({ ok: res.statusCode === 200, buf: Buffer.concat(chunks), status: res.statusCode }))
      })
      proxyReq.on('error', rejectP)
      proxyReq.end()
    } else {
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          fetchViaProxy(res.headers.location).then(resolveP).catch(rejectP)
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolveP({ ok: res.statusCode === 200, buf: Buffer.concat(chunks), status: res.statusCode }))
      }).on('error', rejectP)
    }
  })
}

// ─── 配置 ────────────────────────────────────────────────
env.allowLocalModels = false
env.allowRemoteModels = true
env.remoteHost = 'https://hf-mirror.com'
env.remotePathTemplate = '{model}/resolve/{revision}/'

const MODEL = 'Xenova/clip-vit-base-patch16'
const __dirname = dirname(fileURLToPath(import.meta.url))
const IMAGES_DIR = resolve(__dirname, 'images')
const RESULTS_DIR = resolve(__dirname, 'results')

// ─── 数据集（8 张图，覆盖 8 个主题）────────────────────
// Unsplash 直链，384px 宽度足够 PoC
const DATASET = [
  { id: 'img-001', label: 'a dog', url: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=384', file: 'dog.jpg' },
  { id: 'img-002', label: 'a cat', url: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=384', file: 'cat.jpg' },
  { id: 'img-003', label: 'a car', url: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=384', file: 'car.jpg' },
  { id: 'img-004', label: 'a building', url: 'https://images.unsplash.com/photo-1460472178825-e5240623afd5?w=384', file: 'building.jpg' },
  { id: 'img-005', label: 'food', url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=384', file: 'food.jpg' },
  { id: 'img-006', label: 'outdoor scenery', url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=384', file: 'scenery.jpg' },
  { id: 'img-007', label: 'a person', url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=384', file: 'person.jpg' },
  { id: 'img-008', label: 'indoor room', url: 'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=384', file: 'indoor.jpg' },
]

// ─── 工具函数 ────────────────────────────────────────────
function normalize(v) {
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) + 1e-8
  return v.map((x) => x / n)
}

async function downloadImage(item) {
  const filePath = resolve(IMAGES_DIR, item.file)
  if (existsSync(filePath)) {
    console.log(`  ✓ 已存在：${item.file}`)
    return filePath
  }
  console.log(`  ↓ 下载：${item.file} ← ${item.url}`)
  const res = await fetchViaProxy(item.url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${item.url}`)
  const buf = res.buf
  await writeFile(filePath, buf)
  console.log(`    ✓ ${buf.length} bytes`)
  return filePath
}

async function encodeImage(model, processor, tokenizer, imagePath) {
  const image = await RawImage.read(imagePath)
  const imageInputs = await processor(image)
  // CLIP 顶层 forward 要求 text 输入，给一个占位 token 拿 image_embeds
  const textInputs = tokenizer('a', { padding: true, truncation: true })
  const { image_embeds } = await model({ ...imageInputs, ...textInputs })
  // image_embeds: [1, 512] Tensor
  const data = await image_embeds.data
  return normalize(Array.from(data))
}

// ─── 主流程 ──────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════')
console.log('  build-index: 下载图片 + 编码 + 保存索引')
console.log(`  Model: ${MODEL}`)
console.log('═══════════════════════════════════════════════════════\n')

await mkdir(IMAGES_DIR, { recursive: true })
await mkdir(RESULTS_DIR, { recursive: true })

// 1) 下载图片
console.log('▶ Step 1: 下载图片')
const items = []
const skipDownload = process.env.SKIP_DOWNLOAD === '1'
for (const item of DATASET) {
  try {
    const filePath = resolve(IMAGES_DIR, item.file)
    if (skipDownload && existsSync(filePath)) {
      items.push({ ...item, path: `./images/${item.file}`, absPath: filePath })
      continue
    }
    const p = await downloadImage(item)
    items.push({ ...item, path: `./images/${item.file}`, absPath: p })
  } catch (e) {
    console.error(`  ✗ 下载失败 ${item.file}: ${e.message}`)
    process.exit(1)
  }
}
console.log(`  → ${items.length} 张图片就绪\n`)

// 2) 加载模型
console.log('▶ Step 2: 加载 CLIP 模型（首次会从 hf-mirror 下载 onnx）')
const t0 = Date.now()
const processor = await AutoProcessor.from_pretrained(MODEL)
const tokenizer = await AutoTokenizer.from_pretrained(MODEL)
const model = await AutoModel.from_pretrained(MODEL)
console.log(`  ✓ 模型加载 [${Date.now() - t0}ms]\n`)

// 3) 编码每张图
console.log('▶ Step 3: 编码图片')
const indexed = []
for (const item of items) {
  const t1 = Date.now()
  try {
    const embedding = await encodeImage(model, processor, tokenizer, item.absPath)
    indexed.push({
      id: item.id,
      path: item.path,
      label: item.label,
      embedding,
    })
    console.log(`  ✓ ${item.id} ${item.label} [${Date.now() - t1}ms] dim=${embedding.length}`)
  } catch (e) {
    console.error(`  ✗ 编码失败 ${item.id}: ${e.message}`)
    process.exit(1)
  }
}

// 4) 写索引
console.log('\n▶ Step 4: 保存索引')
const dim = indexed[0].embedding.length
const index = {
  meta: {
    model: MODEL,
    dim,
    count: indexed.length,
    timestamp: new Date().toISOString(),
  },
  items: indexed,
}
const indexPath = resolve(RESULTS_DIR, 'image-search-index.json')
await writeFile(indexPath, JSON.stringify(index, null, 2))
console.log(`  ✓ ${indexPath}`)
console.log(`  → ${indexed.length} items × ${dim} dim`)

console.log('\n═══════════════════════════════════════════════════════')
console.log('  build-index 完成')
console.log('═══════════════════════════════════════════════════════')
