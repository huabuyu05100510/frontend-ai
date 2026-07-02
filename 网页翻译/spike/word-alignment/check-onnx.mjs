/**
 * 检查 ONNX 模型输出节点
 */
import ort from 'onnxruntime-node'

const MODEL_PATH = './node_modules/@huggingface/transformers/.cache/Xenova/opus-mt-en-zh/onnx/decoder_model_merged.onnx'

console.log('═══════════════════════════════════════════════════════')
console.log('  检查 opus-mt decoder ONNX 输出节点')
console.log('═══════════════════════════════════════════════════════\n')

const sess = await ort.InferenceSession.create(MODEL_PATH)

console.log('输入节点:')
sess.inputNames.forEach((n, i) => console.log(`  [in ${i}] ${n}`))

console.log('\n输出节点:')
sess.outputNames.forEach((n, i) => console.log(`  [out ${i}] ${n}`))

const hasAttn = sess.outputNames.some(n => n.toLowerCase().includes('attent'))
console.log(`\n${hasAttn ? '✅' : '❌'} ONNX 图${hasAttn ? '包含' : '不含'} attention 输出`)
