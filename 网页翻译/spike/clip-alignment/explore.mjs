/**
 * 探索 transformers.js 的 CLIP 模型 API
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

console.log('model 类型:', model.constructor.name)
console.log('model 直接调用的方法/属性:')
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(model)).filter(n => !n.startsWith('_')).join(', '))

console.log('\nmodel 自身属性:')
console.log(Object.keys(model).join(', '))

// 试着直接 forward image
const image = await RawImage.read('./sample.jpg')
const imageInputs = await processor(image)
console.log('\nimage_inputs keys:', Object.keys(imageInputs))

console.log('\n尝试 model(imageInputs)...')
try {
  const out = await model(imageInputs)
  console.log('✓ 直接 forward 成功')
  console.log('输出 keys:', Object.keys(out))
  for (const k of Object.keys(out)) {
    console.log(`  ${k}: dims=[${out[k].dims?.join(',')}]`)
  }
} catch (e) {
  console.log('✗ 直接 forward 失败:', e.message)

  console.log('\n尝试 model({ pixel_values, input_ids: null })...')
  try {
    const out = await model({ pixel_values: imageInputs.pixel_values, input_ids: null })
    console.log('输出 keys:', Object.keys(out))
  } catch (e2) {
    console.log('✗ 也失败:', e2.message)
  }
}
