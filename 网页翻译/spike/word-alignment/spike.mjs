/**
 * Spike: transformers.js 能否拿到 attention 矩阵？
 *
 * 三轮探测：
 *   1. 基础翻译（验证模型加载）
 *   2. output_attentions=true（验证 attention 是否暴露）
 *   3. 直接读 ONNX 模型的输出名（验证 ONNX 图是否包含 attention）
 *
 * 不做工程化，只为回答 yes/no。
 */
import { pipeline, env, AutoTokenizer, AutoModelForSeq2SeqLM } from '@huggingface/transformers'

// 关闭远程兜底，本地 HF cache
env.allowLocalModels = false
env.allowRemoteModels = true
// 国内镜像（huggingface.co 直连失败）
env.remoteHost = 'https://hf-mirror.com'
env.remotePathTemplate = '{model}/resolve/{revision}/'

const MODEL = 'Xenova/opus-mt-en-zh'

console.log('═══════════════════════════════════════════════════════')
console.log('  Spike: transformers.js attention 提取验证')
console.log(`  Model: ${MODEL}`)
console.log('═══════════════════════════════════════════════════════\n')

// ─── Probe 1: 基础翻译 ─────────────────────────────────
console.log('▶ Probe 1: 基础翻译（验证模型可加载）')
try {
  const t0 = Date.now()
  const translator = await pipeline('translation', MODEL)
  const out = await translator('The quick brown fox jumps over the lazy dog.', {
    tgt_lang: 'zh',
    src_lang: 'en',
  })
  console.log(`  ✓ 翻译成功 [${Date.now() - t0}ms]`)
  console.log(`  译文: ${out[0].translation_text}`)
} catch (e) {
  console.log(`  ✗ 失败: ${e.message}`)
  console.log('  → 模型加载/翻译都不行，spike 终止')
  process.exit(1)
}

// ─── Probe 2: 直接用 Model 类 + output_attentions ─────
console.log('\n▶ Probe 2: AutoModelForSeq2SeqLM + output_attentions=true')
try {
  const t0 = Date.now()
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL)
  const model = await AutoModelForSeq2SeqLM.from_pretrained(MODEL)

  const inputs = tokenizer('The quick brown fox jumps over the lazy dog.')
  console.log(`  ✓ 模型加载 [${Date.now() - t0}ms]`)

  console.log('  尝试 generate(output_attentions=true) ...')
  const t1 = Date.now()
  const out = await model.generate({
    ...inputs,
    max_new_tokens: 50,
    output_attentions: true,
    return_dict_in_generate: true,
  })
  console.log(`  ✓ generate 完成 [${Date.now() - t1}ms]`)

  console.log('  输出 keys:', Object.keys(out))

  if (out.cross_attentions) {
    console.log('  ✅ cross_attentions 存在！')
    console.log('  shape 示例:', out.cross_attentions[0]?.length, 'layers')
    console.log('  第一层 shape:', out.cross_attentions[0]?.[0]?.data?.length, '元素')
    console.log('\n  → 纯 JS 路线可行，进 Phase 1')
    process.exit(0)
  } else if (out.attentions) {
    console.log('  ✅ attentions 存在（非 cross）')
    console.log('  shape:', out.attentions[0]?.length)
    process.exit(0)
  } else {
    console.log('  ⚠️  output_attentions 被忽略，输出里没有 attention')
    console.log('  → 继续 Probe 3')
  }
} catch (e) {
  console.log(`  ✗ Probe 2 失败: ${e.message}`)
  console.log('  → 继续 Probe 3')
}

// ─── Probe 3: 直接看 ONNX 模型输出节点 ─────────────────
console.log('\n▶ Probe 3: 检查 ONNX 模型输出节点是否含 attention')
try {
  const path = await import('node:path')
  const { existsSync, readdirSync } = await import('node:fs')

  // HF cache 默认路径
  const cacheDir = path.join(process.env.HOME || '', '.cache/huggingface/hub')
  console.log(`  HF cache: ${cacheDir}`)

  if (!existsSync(cacheDir)) {
    console.log('  ⚠️  cache 不存在，跳过')
    process.exit(0)
  }

  // 找 opus-mt 的 onnx 目录
  const findModels = (dir, depth = 0) => {
    if (depth > 5) return []
    const results = []
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (name.endsWith('.onnx')) results.push(full)
      try {
        if (existsSync(full) && readdirSync(full).length > 0) {
          results.push(...findModels(full, depth + 1))
        }
      } catch {}
    }
    return results
  }

  const onnxFiles = findModels(cacheDir).filter(f => f.includes('opus-mt'))
  console.log(`  找到 ${onnxFiles.length} 个 opus-mt ONNX 文件`)
  onnxFiles.slice(0, 3).forEach(f => console.log('   -', f.split('/').slice(-3).join('/')))

  if (onnxFiles.length === 0) {
    console.log('  → 无 ONNX 文件可检查')
    process.exit(0)
  }

  // 用 onnxruntime 读输出节点名
  const ort = await import('onnxruntime-node')
  const sess = await ort.InferenceSession.create(onnxFiles[0])
  console.log('\n  ONNX 输出节点:')
  sess.outputNames.forEach((n, i) => console.log(`    [${i}] ${n}`))

  const hasAttn = sess.outputNames.some(n => n.toLowerCase().includes('attent'))
  if (hasAttn) {
    console.log('\n  ✅ ONNX 图包含 attention 输出！')
    console.log('  → Probe 2 失败可能是 transformers.js 没透传参数，可绕过')
  } else {
    console.log('\n  ❌ ONNX 图不含 attention 输出')
    console.log('  → 这个 ONNX 模型本身没导出 attention，需要找/自建导出版本')
  }
} catch (e) {
  console.log(`  ✗ Probe 3 失败: ${e.message}`)
}

console.log('\n═══════════════════════════════════════════════════════')
console.log('  Spike 完成 — 见上方结论')
console.log('═══════════════════════════════════════════════════════')
