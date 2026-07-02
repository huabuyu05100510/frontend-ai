/**
 * Dump LaBSE tokenizer 的 token 文本，辅助手工标注金标准
 */
import { pipeline, env, AutoTokenizer } from '@huggingface/transformers'

env.remoteHost = 'https://hf-mirror.com'

const CASES = [
  'The quick brown fox jumps over the lazy dog',
  'I love you',
  'Hello world',
  'The cat is sleeping',
  'Open the door',
  'Neural networks are powerful',
  'Machine learning models require large datasets',
  'The weather is nice today',
  '敏捷的棕色狐狸跳过了懒狗',
  '我爱你',
  '你好世界',
  '猫在睡觉',
  '打开门',
  '神经网络很强大',
  '机器学习模型需要大量数据',
  '今天天气很好',
]

const tok = await AutoTokenizer.from_pretrained('Xenova/LaBSE')

for (const s of CASES) {
  const ids = Array.from(tok(s).input_ids.data, x => Number(x))
  const decoded = ids.map(id => tok.decode([id]).trim() || `[${id}]`)
  console.log(`"${s}"`)
  console.log(`  ${decoded.map((t, i) => `${i}:${t}`).join('  ')}`)
  console.log()
}
