/**
 * 直接用 onnxruntime-node 跑 vision_model.onnx，绕过 transformers.js 的 combined 限制
 *
 * 目标：拿到 patch-level embedding (last_hidden_state)
 */
import { env, AutoProcessor, RawImage } from '@huggingface/transformers'
import ort from 'onnxruntime-node'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'

env.allowLocalModels = false
env.allowRemoteModels = true
env.remoteHost = 'https://hf-mirror.com'
env.remotePathTemplate = '{model}/resolve/{revision}/'

const MODEL_ID = 'Xenova/clip-vit-base-patch16'

console.log('═══════════════════════════════════════════════════════')
console.log('  直接加载 vision_model.onnx')
console.log('═══════════════════════════════════════════════════════\n')

// 1. 用 transformers.js 的 processor 预处理图片（标准化部分难手写）
console.log('▶ 用 AutoProcessor 预处理图片...')
const processor = await AutoProcessor.from_pretrained(MODEL_ID)
const image = await RawImage.read('./sample.jpg')
const imageInputs = await processor(image)
console.log('  pixel_values shape:', imageInputs.pixel_values.dims)

// 2. 触发 transformers.js 下载 vision_model.onnx（先伪造一次加载）
console.log('\n▶ 触发下载 vision_model.onnx...')
try {
  // 用 transformers.js 的 cache 机制
  const { AutoModel } = await import('@huggingface/transformers')
  // 指定加载 vision_model（transformers.js 支持的 subfolder 配置）
  await AutoModel.from_pretrained(MODEL_ID, {
    config: { model_type: 'clip' },
  })
} catch (e) {
  console.log('  (transformers.js 加载失败，预期，继续)')
}

// 3. 检查 cache 里有没有 vision_model.onnx
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const cacheDir = 'node_modules/@huggingface/transformers/.cache/Xenova/clip-vit-base-patch16/onnx'
console.log(`\n▶ 检查 cache: ${cacheDir}`)
if (existsSync(cacheDir)) {
  console.log('  文件:', readdirSync(cacheDir))
} else {
  console.log('  目录不存在')
}

// 4. 直接用 onnxruntime-node 加载 vision_model.onnx
//    如果没下载到本地，需要先 fetch
const visionModelPath = path.join(cacheDir, 'vision_model.onnx')

if (!existsSync(visionModelPath)) {
  console.log('\n▶ 手动下载 vision_model.onnx...')
  const url = `https://hf-mirror.com/${MODEL_ID}/resolve/main/onnx/vision_model.onnx`
  const res = await fetch(url)
  if (!res.ok) {
    console.log(`  ✗ 下载失败: HTTP ${res.status}`)
    process.exit(1)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const { writeFile, mkdir } = await import('node:fs/promises')
  await mkdir(path.dirname(visionModelPath), { recursive: true })
  await writeFile(visionModelPath, buf)
  console.log(`  ✓ 下载 ${(buf.length / 1024 / 1024).toFixed(1)}MB → ${visionModelPath}`)
}

console.log('\n▶ 加载 vision_model.onnx 到 onnxruntime...')
const sess = await ort.InferenceSession.create(visionModelPath)
console.log('  ✓ 加载成功')
console.log('  输入:', sess.inputNames)
console.log('  输出:', sess.outputNames)

// 5. 跑 forward
console.log('\n▶ 跑 vision_model forward...')
const feeds = { pixel_values: imageInputs.pixel_values }
const out = await sess.run(feeds)

for (const name of sess.outputNames) {
  const t = out[name]
  console.log(`  ${name}: dims=[${t.dims.join(',')}]  type=${t.type}  size=${t.data.length}`)
}

// 6. 分析 patch embedding
const patchKey = sess.outputNames.find(n => n.includes('hidden') || n.includes('patch') || n.includes('last'))
if (patchKey) {
  const [batch, numTokens, hiddenDim] = out[patchKey].dims
  console.log(`\n✅ patch embedding 拿到！`)
  console.log(`   ${numTokens} tokens × ${hiddenDim} dim`)
  console.log(`   CLIP-ViT-B/16: 224×224 输入 / 16 patch = 14×14 = 196 + CLS = ${14*14+1}`)
  console.log(`   → 后续：取 tokens[1..196] 做 region attention`)
}
