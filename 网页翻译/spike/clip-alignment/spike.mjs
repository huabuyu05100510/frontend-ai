/**
 * Spike: CLIP patch embedding → 区域热力图（图搜项目核心）
 *
 * 三轮探测：
 *   1. 基础图文相似度（CLIP 加载验证）
 *   2. patch embedding 提取（拿中间层）
 *   3. 区域热力图计算（patch · text → heatmap）
 *
 * 关键问题：transformers.js 能否拿到 image_model 的 patch embeddings？
 */
import { pipeline, env, AutoModel, AutoProcessor, AutoTokenizer, RawImage } from '@huggingface/transformers'

env.allowLocalModels = false
env.allowRemoteModels = true
env.remoteHost = 'https://hf-mirror.com'
env.remotePathTemplate = '{model}/resolve/{revision}/'

const MODEL = 'Xenova/clip-vit-base-patch16'
const IMAGE_PATH = './sample.jpg'

console.log('═══════════════════════════════════════════════════════')
console.log('  Spike: CLIP patch embedding → 区域热力图')
console.log(`  Model: ${MODEL}`)
console.log(`  Image: ${IMAGE_PATH}`)
console.log('═══════════════════════════════════════════════════════\n')

// ─── Probe 1: 基础图文相似度 ───────────────────────────
console.log('▶ Probe 1: 基础图文相似度（CLIP 加载验证）')
try {
  const t0 = Date.now()
  const classifier = await pipeline('zero-shot-image-classification', MODEL)
  const image = await RawImage.read(IMAGE_PATH)
  const labels = ['a dog', 'a cat', 'a car', 'a building']
  const out = await classifier(image, labels)
  console.log(`  ✓ 加载 + 推理成功 [${Date.now() - t0}ms]`)
  console.log('  分类结果:')
  out.forEach(r => console.log(`    ${r.score.toFixed(3)}  ${r.label}`))
} catch (e) {
  console.log(`  ✗ 失败: ${e.message}`)
  process.exit(1)
}

// ─── Probe 2: 直接读 vision_model 的 patch embedding ──
console.log('\n▶ Probe 2: 提取 vision_model patch embeddings')
let imageEmbeddings = null
let textEmbeddings = null
let patchShape = null

try {
  const t0 = Date.now()
  const processor = await AutoProcessor.from_pretrained(MODEL)
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL)
  const model = await AutoModel.from_pretrained(MODEL, { output_attentions: true })

  const image = await RawImage.read(IMAGE_PATH)
  const imageInputs = await processor(image)
  const textInputs = await tokenizer(['a dog', 'a cat', 'a building'], { padding: true, truncation: true })

  console.log(`  ✓ 模型加载 [${Date.now() - t0}ms]`)

  // vision model forward
  console.log('  跑 vision_model forward...')
  const t1 = Date.now()
  const visOut = await model.vision_model(imageInputs)
  console.log(`  ✓ vision forward [${Date.now() - t1}ms]`)
  console.log('  vision 输出 keys:', Object.keys(visOut))

  if (visOut.last_hidden_state) {
    // shape: [batch, num_patches, hidden_dim]
    const shape = visOut.last_hidden_state.dims
    patchShape = shape
    console.log(`  ✅ last_hidden_state shape: [${shape.join(', ')}]`)
    console.log(`     → ${shape[1]} patches × ${shape[2]} dim`)
    imageEmbeddings = visOut.last_hidden_state.data
  }

  // text model forward
  console.log('  跑 text_model forward...')
  const textOut = await model.text_model(textInputs)
  console.log('  text 输出 keys:', Object.keys(textOut))

  if (textOut.last_hidden_state) {
    textEmbeddings = textOut.last_hidden_state.data
    console.log(`  ✅ text last_hidden_state shape: [${textOut.last_hidden_state.dims.join(', ')}]`)
  }

  // 检查 attention（顺便）
  if (visOut.attentions) {
    console.log('  ✨ vision attentions 也存在！')
    console.log('  shape:', visOut.attentions[0]?.dims)
  } else {
    console.log('  ℹ️  vision attentions 不存在（预期内，但 patch embedding 已够用）')
  }

} catch (e) {
  console.log(`  ✗ Probe 2 失败: ${e.message}`)
  console.log(e.stack)
}

// ─── Probe 3: 区域热力图计算 ───────────────────────────
console.log('\n▶ Probe 3: 计算 patch · text 相似度热力图')

if (patchShape && imageEmbeddings) {
  try {
    // CLIP-ViT-B/16: 输入 224×224，patch 16×16 → 14×14 = 196 patches
    // + 1 CLS token = 197 tokens，第 0 个是 CLS
    // patch tokens: indices 1..196
    const [, numTokens, hiddenDim] = patchShape
    const gridDim = Math.sqrt(numTokens - 1)  // 减 CLS
    const grid = Math.round(gridDim)
    console.log(`  patch 网格: ${grid}×${grid} = ${grid * grid} patches (CLS 除外)`)

    // 抽 query 文本「a dog」的 embedding
    // 这里用 pooled_output（CLS）作为 text 全局表示，更标准
    // 实际我们要的是 text 单 token 或 pooled embedding（512-d，与 image pooled 对齐）
    // 但 patch embedding 是 768-d（hidden），与 text pooled（512-d，proj 后）维度不一致
    // CLIP 标准做法：用 vision_model 的 patch_hidden + text_model 的 token_hidden
    // 都过 projection 后才能点积

    // 简化 spike：用模型自带的相似度计算
    console.log('  用 CLIP 标准相似度计算（vision_proj · text_proj）...')

    const processor = await AutoProcessor.from_pretrained(MODEL)
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL)
    const model = await AutoModel.from_pretrained(MODEL)

    const image = await RawImage.read(IMAGE_PATH)
    const imageInputs = await processor(image)
    const textInputs = await tokenizer(['a dog', 'a cat', 'a fence', 'grass'], { padding: true, truncation: true })

    // 完整 forward（含 projection）
    const { image_embeds, text_embeds } = await model({ ...imageInputs, ...textInputs })
    console.log(`  ✅ image_embeds: [${image_embeds.dims.join(', ')}]`)
    console.log(`  ✅ text_embeds: [${text_embeds.dims.join(', ')}]`)

    // 现在做区域热力图：每个 patch token（hidden 768-d）vs text pooled（proj 512-d）
    // 不对齐！需要 projection 才行
    // 但 vision_model.last_hidden_state 是 pre-projection 的
    // CLIP 内部：last_hidden_state → pooler (CLS) → projection → image_embeds
    // patch tokens 没有独立的 projection

    console.log('\n  ⚠️  发现维度不匹配：')
    console.log('    - patch hidden_dim (768) vs text_embeds (512)')
    console.log('    - CLIP projection 只对 CLS token，不对所有 patch')
    console.log('    - 需要 patch 级 attention，必须用 attentions 或自算 Q·K')

    console.log('\n  → 降级方案：用 attentions（如果有）或 Grad-CAM 风格')

  } catch (e) {
    console.log(`  ✗ Probe 3 失败: ${e.message}`)
  }
} else {
  console.log('  跳过（patch shape 未拿到）')
}

console.log('\n═══════════════════════════════════════════════════════')
console.log('  Spike 完成 — 见上方结论')
console.log('═══════════════════════════════════════════════════════')
