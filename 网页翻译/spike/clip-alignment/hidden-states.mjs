/**
 * 最后尝试：transformers.js 的 output_hidden_states / output_attentions
 * 看 combined CLIPModel 是否透传
 */
import { env, AutoModel, AutoProcessor, AutoTokenizer, RawImage } from '@huggingface/transformers'

env.allowLocalModels = false
env.allowRemoteModels = true
env.remoteHost = 'https://hf-mirror.com'
env.remotePathTemplate = '{model}/resolve/{revision}/'

const MODEL = 'Xenova/clip-vit-base-patch16'

const processor = await AutoProcessor.from_pretrained(MODEL)
const tokenizer = await AutoTokenizer.from_pretrained(MODEL)
const model = await AutoModel.from_pretrained(MODEL)

const image = await RawImage.read('./sample.jpg')
const imageInputs = await processor(image)
const textInputs = await tokenizer(['a dog'], { padding: true, truncation: true })

console.log('▶ 尝试 model.forward 带 output_hidden_states...')
// transformers.js 内部 forward 接受 options
try {
  const out = await model({
    ...imageInputs,
    ...textInputs,
  }, {
    output_hidden_states: true,
    output_attentions: true,
  })
  console.log('输出 keys:', Object.keys(out))
  for (const k of Object.keys(out)) {
    const v = out[k]
    if (v && v.dims) console.log(`  ${k}: [${v.dims.join(',')}]`)
    else if (Array.isArray(v)) console.log(`  ${k}: Array(${v.length})`)
    else console.log(`  ${k}:`, typeof v)
  }
} catch (e) {
  console.log('失败:', e.message)
}

// 看模型 _forward 签名
console.log('\n▶ 看 forward_params:')
console.log(model.forward_params)
