import { env, AutoModel, AutoProcessor, RawImage } from '@huggingface/transformers'

env.allowLocalModels = false
env.allowRemoteModels = true
env.remoteHost = 'https://hf-mirror.com'
env.remotePathTemplate = '{model}/resolve/{revision}/'

// vision-only 模型 — 不需要文本输入
const VISION_MODEL = 'Xenova/clip-vit-base-patch16'
const TEXT_MODEL = 'Xenova/clip-vit-base-patch16'

console.log('═══════ Probe: 加载 vision_model + text_model 分开 ═══════')

const processor = await AutoProcessor.from_pretrained(VISION_MODEL)
const visionModel = await AutoModel.from_pretrained(VISION_MODEL)

console.log('visionModel.sessions keys:', Object.keys(visionModel.sessions || {}))

// 如果有 sessions.vision_model / sessions.text_model 就直接用
if (visionModel.sessions?.vision_model) {
  console.log('✅ 发现 sessions.vision_model！')
}

// 尝试走 vision-only: 加载专门的 vision model
// Xenova 上有 XenoVa/clip-vit-base-patch16 是 combined
// 我们用 text_model + vision_model 接口
const image = await RawImage.read('./sample.jpg')
const imageInputs = await processor(image)
console.log('\nimage inputs:', Object.keys(imageInputs))

// 直接喂给 combined model 的 vision 部分？不行，combined 强制要 input_ids
// 解决：单独加载 vision model 配置
// Xenova/clip-vit-base-patch16 实际有 onnx/vision_model.onnx 和 onnx/text_model.onnx

// 试试从 sessions 拿
const sessionNames = visionModel.sessions ? Object.keys(visionModel.sessions) : []
console.log('所有 session:', sessionNames)

for (const name of sessionNames) {
  console.log(`\n  ${name}:`)
  const sess = visionModel.sessions[name]
  console.log('    inputNames:', sess?.inputNames)
  console.log('    outputNames:', sess?.outputNames?.slice(0, 8))
  if (sess?.outputNames?.length > 8) console.log(`    ... (${sess.outputNames.length} total)`)
}
