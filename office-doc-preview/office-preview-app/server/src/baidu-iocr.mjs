// 百度 iocr API 客户端
// 模型：claude-sonnet-4-6
//
// 文档参考：百度智能云 iocr (自定义模板文字识别)
//   1. 用 AK/SK 换 access_token（缓存到 tokenExpireAt）
//   2. POST https://aip.baidubce.com/rest/2.0/solution/v1/iocr/processor
//      body: templateSign=N&url=xxx 或 image=base64
//      返回: {words_result: {[field]: {words, location}}, words_result_num, log_id}
//
// 环境变量：
//   BAIDU_OCR_API_KEY     百度云 API Key
//   BAIDU_OCR_SECRET_KEY  百度云 Secret Key
//
// 无环境变量时返回 mock 结构（标志 isMock=true）便于开发/测试。

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token'
const PROCESSOR_URL = 'https://aip.baidubce.com/rest/2.0/solution/v1/iocr/processor'
const GENERAL_OCR_URL = 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic'

let cachedToken = null  // {value, expireAt}

/**
 * 获取百度云 access_token（带缓存）
 * @returns {Promise<{token: string, isMock: boolean}>}
 */
export async function getAccessToken() {
  const ak = process.env.BAIDU_OCR_API_KEY
  const sk = process.env.BAIDU_OCR_SECRET_KEY
  if (!ak || !sk) {
    return { token: null, isMock: true }
  }
  if (cachedToken && cachedToken.expireAt > Date.now() + 60_000) {
    return { token: cachedToken.value, isMock: false }
  }
  const url = `${TOKEN_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(ak)}&client_secret=${encodeURIComponent(sk)}`
  const r = await fetch(url, { method: 'POST' })
  if (!r.ok) throw new Error(`baidu token ${r.status}: ${await r.text().catch(() => '')}`)
  const d = await r.json()
  cachedToken = {
    value: d.access_token,
    expireAt: Date.now() + (d.expires_in || 2592000) * 1000,
  }
  console.log('[baidu-iocr] access_token fetched, expires_in', d.expires_in)
  return { token: cachedToken.value, isMock: false }
}

/**
 * 用模板识别图片
 * @param {{templateSign: string, imageBuffer?: Buffer, imageUrl?: string}} opts
 * @returns {Promise<{fields: Array<{name, value, location?}>, wordsResultNum: number, logId: number, isMock: boolean, ms: number}>}
 */
export async function recognizeByTemplate({ templateSign, imageBuffer, imageUrl }) {
  const t0 = Date.now()
  const { token, isMock } = await getAccessToken()

  if (isMock) {
    // mock：返回空字段，让上游决定如何填充
    console.warn('[baidu-iocr] no AK/SK configured, returning mock structure')
    return {
      fields: [],
      wordsResultNum: 0,
      logId: 0,
      isMock: true,
      ms: Date.now() - t0,
    }
  }

  const body = new URLSearchParams()
  body.append('templateSign', templateSign)
  if (imageUrl) {
    body.append('url', imageUrl)
  } else if (imageBuffer) {
    body.append('image', imageBuffer.toString('base64'))
  } else {
    throw new Error('either imageBuffer or imageUrl required')
  }

  const url = `${PROCESSOR_URL}?access_token=${token}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!r.ok) throw new Error(`baidu iocr ${r.status}: ${await r.text().catch(() => '')}`)
  const d = await r.json()

  if (d.error_code) {
    throw new Error(`baidu iocr error ${d.error_code}: ${d.error_msg}`)
  }

  // 转 fields 数组
  const fields = []
  const wr = d.words_result || {}
  for (const [name, info] of Object.entries(wr)) {
    fields.push({
      name,
      value: info.words || '',
      location: info.location || null,
    })
  }

  console.log(`[baidu-iocr] templateSign=${templateSign} fields=${fields.length} ms=${Date.now() - t0}`)
  return {
    fields,
    wordsResultNum: d.words_result_num || fields.length,
    logId: d.log_id || 0,
    isMock: false,
    ms: Date.now() - t0,
  }
}

/** 仅测试用：重置 token 缓存 */
export function _resetTokenCacheForTests() {
  cachedToken = null
}

/**
 * 百度通用 OCR（accurate_basic）—— 返回文字 + 坐标
 *
 * 与 iocr 的核心区别：iocr 是基于预训练模板直接输出结构化 KV；本接口只做
 * 通用文字识别，返回 {words, location}[] 列表，由自研 template-matcher 做
 * 模板匹配。
 *
 * @param {{imageBuffer?: Buffer, imageUrl?: string}} opts
 * @returns {Promise<{regions: Array<{text, x, y, w, h, confidence}>, wordsResultNum: number, logId: number, isMock: boolean, ms: number}>}
 *
 * isMock=true 时返回 0 区域（开发/测试用）。
 */
export async function recognizeGeneral({ imageBuffer, imageUrl }) {
  const t0 = Date.now()
  const { token, isMock } = await getAccessToken()

  if (isMock) {
    console.warn('[baidu-ocr-general] no AK/SK configured, returning empty regions (isMock)')
    return {
      regions: [],
      wordsResultNum: 0,
      logId: 0,
      isMock: true,
      ms: Date.now() - t0,
    }
  }

  const body = new URLSearchParams()
  if (imageUrl) {
    body.append('url', imageUrl)
  } else if (imageBuffer) {
    body.append('image', imageBuffer.toString('base64'))
  } else {
    throw new Error('either imageBuffer or imageUrl required')
  }

  const url = `${GENERAL_OCR_URL}?access_token=${token}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!r.ok) throw new Error(`baidu general ocr ${r.status}: ${await r.text().catch(() => '')}`)
  const d = await r.json()

  if (d.error_code) {
    throw new Error(`baidu general ocr error ${d.error_code}: ${d.error_msg}`)
  }

  // 归一化为 {text, x, y, w, h, confidence}
  const regions = []
  for (const w of (d.words_result || [])) {
    const loc = w.location || {}
    regions.push({
      text: w.words || '',
      x: Math.round(loc.left || 0),
      y: Math.round(loc.top || 0),
      w: Math.round(loc.width || 0),
      h: Math.round(loc.height || 0),
      confidence: (w.probability && w.probability.average) || 0.9,
    })
  }

  console.log(`[baidu-ocr-general] regions=${regions.length} ms=${Date.now() - t0}`)
  return {
    regions,
    wordsResultNum: d.words_result_num || regions.length,
    logId: d.log_id || 0,
    isMock: false,
    ms: Date.now() - t0,
  }
}
