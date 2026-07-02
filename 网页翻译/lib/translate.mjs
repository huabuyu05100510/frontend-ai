/**
 * 翻译分块 + 并行调用 + 顺序合并
 *
 * 设计：
 * 1. BATCH_SIZE=20 既低于 LLM token 上限风险，又让请求并发度合理
 * 2. Promise.allSettled：单批失败不影响其他批；失败的段在结果中填空字符串，UI 端能识别
 * 3. 输出数组严格按输入顺序：第 i 段译文一定在 out[i]
 * 4. 打结构化日志：[translate] 分 N 批 / 批 X/Y ok/fail / 汇总
 */

/** 每批最多段数 —— LLM 单次推荐 ≤20 段以控制 token */
export const BATCH_SIZE = 20

/**
 * 把数组按 size 切块
 * @template T
 * @param {T[]} arr
 * @param {number} size
 * @returns {T[][]}
 */
export function chunk(arr, size) {
  if (arr.length === 0) return []
  const out = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

/**
 * 并行分块翻译，保留原顺序
 *
 * @param {string[]} segments 待翻译段落
 * @param {string} tgtLang 目标语言
 * @param {(batch: string[], batchIdx: number, allBatches: number) => Promise<string[]>} callApi
 *        实际翻译函数；返回数组长度应等于 batch 长度
 * @param {{ log?: (...args: any[]) => void, warn?: (...args: any[]) => void }} [logger]
 * @returns {Promise<string[]>} 与输入等长，失败段填空字符串
 */
export async function translateBatches(segments, tgtLang, callApi, logger = console) {
  if (segments.length === 0) return []

  const batches = chunk(segments, BATCH_SIZE)
  logger.log?.(`[translate] 分 ${batches.length} 批 (BATCH_SIZE=${BATCH_SIZE}) → ${tgtLang}, 共 ${segments.length} 段`)

  const results = await Promise.allSettled(
    batches.map((batch, idx) => callApi(batch, idx, batches.length))
  )

  /** @type {string[]} */
  const merged = new Array(segments.length).fill('')
  let okBatches = 0
  let failBatches = 0
  let okSegs = 0

  results.forEach((r, idx) => {
    const start = idx * BATCH_SIZE
    const expectedLen = Math.min(BATCH_SIZE, segments.length - start)

    if (r.status === 'fulfilled') {
      okBatches++
      const arr = r.value ?? []
      for (let i = 0; i < expectedLen; i++) {
        const v = arr[i]
        if (typeof v === 'string' && v.length > 0) {
          merged[start + i] = v
          okSegs++
        }
      }
      logger.log?.(`[translate] 批 ${idx + 1}/${batches.length} ✅ 返回 ${arr.length} 段（期望 ${expectedLen}）`)
    } else {
      failBatches++
      const msg = r.reason?.message ?? String(r.reason)
      logger.warn?.(`[translate] 批 ${idx + 1}/${batches.length} ❌ ${msg}（${expectedLen} 段填空）`)
    }
  })

  logger.log?.(`[translate] 汇总 ok=${okSegs}/${segments.length} 段, 成功批=${okBatches}, 失败批=${failBatches}`)
  return merged
}