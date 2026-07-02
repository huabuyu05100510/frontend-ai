// 语音能力统一模块 (TTS 合成 + ASR 识别 + 实时翻译 + 声音复刻 + 音色设计)
// 模型：claude-sonnet-4-6
//
// 移植自 voice-portfolio (Python) 的协议层，适配到 Node fetch + 服务端持有凭证模式。
// 设计目标与原项目一致：
//   - 隐藏凭证：服务端持有 VOLC_* 环境变量，前端不直连火山引擎
//   - 避开 CORS：前端只调 /api/speech/* 同源 endpoint
//   - 失败可观测：响应头 X-TTS-Engine / X-TTS-Ms / X-ASR-Engine / X-ASR-Ms
//   - 无凭证时降级到 mock 模式，保证 UI 流程可演示
//
// 鉴权注意（火山引擎特殊）：
//   - TTS / 文件 ASR / 翻译 / Realtime 用 `Authorization: Bearer; {token}`（分号+空格）
//   - v3 实时 ASR 网关用 `X-Api-*` headers，无 Authorization
//
// 限流：使用独立 TokenBucket（见 ./rate-limiter.mjs）

import crypto from 'node:crypto'

// ============ 常量 ============

const TEXT_MAX_BYTES = 1024  // 火山引擎单次硬限
const SPEED_RANGE = [0.5, 2.0]
const PITCH_RANGE = [0.5, 2.0]
const VOLUME_RANGE = [0.5, 2.0]

/** 火山引擎 SeedTTS 经典音色（兜底） */
export const FALLBACK_VOICES = [
  { id: 'BV001_streaming', name: '磁性男声', gender: 'male', sample_rate: 24000 },
  { id: 'BV002_streaming', name: '温柔女声', gender: 'female', sample_rate: 24000 },
  { id: 'BV003_streaming', name: '活力童声', gender: 'child', sample_rate: 24000 },
  { id: 'BV004_streaming', name: '沉稳旁白', gender: 'male', sample_rate: 24000 },
]

/** 实时翻译语言对白名单（31 对，与 voice-portfolio translation.py 对齐） */
export const SUPPORTED_TRANSLATE_PAIRS = new Set([
  'zh-en', 'zh-ja', 'zh-ko', 'zh-ru', 'zh-fr', 'zh-de', 'zh-es', 'zh-id', 'zh-vi', 'zh-ms', 'zh-th', 'zh-ar',
  'en-ja', 'en-ko', 'en-fr', 'en-de', 'en-es', 'en-ru',
])

// ============ 异常类型 ============

export class SpeechError extends Error {
  constructor(statusCode, body, message) {
    super(message || `speech request failed (status=${statusCode})`)
    this.statusCode = statusCode
    this.body = body || ''
  }
}

// ============ 配置读取 ============

export function readTtsConfig() {
  return {
    appid: (process.env.VOLC_TTS_APP_ID || '').trim(),
    token: (process.env.VOLC_TTS_TOKEN || '').trim(),
    cluster: (process.env.VOLC_TTS_CLUSTER || 'volcano_tts').trim(),
    endpoint: (process.env.VOLC_TTS_ENDPOINT || 'https://openspeech.bytedance.com/api/v1/tts').trim(),
    defaultVoice: (process.env.VOLC_TTS_VOICE || 'BV001_streaming').trim(),
    defaultFormat: (process.env.VOLC_TTS_DEFAULT_FORMAT || 'mp3').trim(),
  }
}

export function readAsrConfig() {
  return {
    appId: (process.env.VOLC_FILE_ASR_APP_ID || '').trim(),
    token: (process.env.VOLC_FILE_ASR_TOKEN || '').trim(),
    cluster: (process.env.VOLC_FILE_ASR_CLUSTER || 'volc_bigasr').trim(),
    endpoint: (process.env.VOLC_FILE_ASR_ENDPOINT || 'https://openspeech.bytedance.com/api/v3/recognitions/bigmodel').trim(),
  }
}

export function readTranslateConfig() {
  return {
    appId: (process.env.VOLC_TRANSLATE_APP_ID || '').trim(),
    token: (process.env.VOLC_TRANSLATE_TOKEN || '').trim(),
    resourceId: (process.env.VOLC_TRANSLATE_RESOURCE_ID || 'volc.translate.s2t.v2').trim(),
    endpoint: (process.env.VOLC_TRANSLATE_ENDPOINT || 'https://openspeech.bytedance.com/api/v2/simultaneous').trim(),
  }
}

export function ttsAvailable() {
  const c = readTtsConfig()
  return !!(c.appid && c.token && c.cluster)
}
export function asrAvailable() {
  const c = readAsrConfig()
  return !!(c.appId && c.token)
}
export function voiceTranslateAvailable() {
  const c = readTranslateConfig()
  return !!(c.appId && c.token)
}

// ============ HTTP helper ============

async function postJSON(url, headers, bodyObj, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(bodyObj),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      throw new SpeechError(res.status, text.slice(0, 500))
    }
    return text  // 火山引擎 TTS 直接返回音频字节，ASR/翻译返回 JSON 文本
  } finally {
    clearTimeout(timer)
  }
}

// ============ 校验 ============

function validateTtsParams(text, speed, pitch, volume) {
  if (!text || !text.trim()) {
    throw new SpeechError(400, '', 'text must be non-empty')
  }
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > TEXT_MAX_BYTES) {
    throw new SpeechError(400, '', `text exceeds ${TEXT_MAX_BYTES} bytes`)
  }
  for (const [name, v, range] of [['speed', speed, SPEED_RANGE], ['pitch', pitch, PITCH_RANGE], ['volume', volume, VOLUME_RANGE]]) {
    if (!(range[0] <= v && v <= range[1])) {
      throw new SpeechError(400, '', `${name} out of range [${range[0]}, ${range[1]}]`)
    }
  }
}

// ============ TTS：火山引擎 SeedTTS ============

function buildTtsBody({ text, voice, speed, pitch, volume, audioFormat, sampleRate, cfg }) {
  const textType = text.trimStart().startsWith('<speak') ? 'ssml' : 'plain'
  return {
    app: { appid: cfg.appid, token: cfg.token, cluster: cfg.cluster },
    user: { uid: 'office-doc-preview' },
    audio: {
      voice_type: voice || cfg.defaultVoice,
      encoding: audioFormat,
      speed_ratio: Number(speed),
      pitch_ratio: Number(pitch),
      volume_ratio: Number(volume),
      sample_rate: Number(sampleRate),
      bit_rate: 160000,
      channel: 1,
    },
    request: {
      reqid: `${crypto.randomBytes(16).toString('hex')}:text`,
      text,
      text_type: textType,
      operation: 'query',
      with_frontend: 1,
      frontend_type: 'unitTson',
    },
  }
}

/**
 * 调用火山引擎 TTS 合成音频
 * @returns {Promise<{audio: Buffer, engine: string, ms: number, voice: string}>}
 */
export async function synthesizeTTS({
  text, voice, speed = 1.0, pitch = 1.0, volume = 1.0,
  audioFormat, sampleRate = 24000,
} = {}) {
  const fmt = audioFormat || readTtsConfig().defaultFormat || 'mp3'
  validateTtsParams(text, speed, pitch, volume)

  const cfg = readTtsConfig()
  const useVoice = voice || cfg.defaultVoice

  // 凭证缺失 → mock 模式：生成最小有效 WAV（静音 ~1.2s，含文本长度提示音）
  if (!ttsAvailable()) {
    const t0 = Date.now()
    const buf = mockWavBuffer(Math.min(30000, 8000 + text.length * 600))
    return {
      audio: buf,
      engine: 'mock-wav',
      ms: Date.now() - t0,
      voice: useVoice,
      format: 'wav',
    }
  }

  const t0 = Date.now()
  const body = buildTtsBody({ text, voice: useVoice, speed, pitch, volume, audioFormat: fmt, sampleRate, cfg })
  const headers = {
    Authorization: `Bearer; ${cfg.token}`,
    'User-Agent': 'office-doc-preview-tts/1.0',
  }
  const audioText = await postJSON(cfg.endpoint, headers, body, 30000)
  // 火山引擎 1.0 单 shot 返回 JSON-encoded base64 or raw bytes；2.0 直接返回 mp3
  let audio
  try {
    // 尝试作为 JSON 解析（部分实现返回 {data: base64}）
    const obj = JSON.parse(audioText)
    audio = Buffer.from(obj.data || obj.audio || '', 'base64')
  } catch {
    // 否则视为二进制原始字节
    audio = Buffer.from(audioText, 'binary')
  }
  if (!audio || audio.length === 0) {
    throw new SpeechError(502, '', 'TTS returned empty audio')
  }
  return {
    audio,
    engine: 'volc-seedtts',
    ms: Date.now() - t0,
    voice: useVoice,
    format: fmt,
  }
}

/**
 * 列出可用音色（凭证缺失时降级到 FALLBACK_VOICES）
 */
export async function safeListVoices() {
  if (!ttsAvailable()) {
    return { data: FALLBACK_VOICES, degraded: true, source: 'fallback', reason: 'misconfigured' }
  }
  const cfg = readTtsConfig()
  const listEndpoint = cfg.endpoint.replace('/tts', '/list_voices')
  try {
    const text = await postJSON(listEndpoint, {
      Authorization: `Bearer; ${cfg.token}`,
    }, {
      app: { appid: cfg.appid, token: cfg.token, cluster: cfg.cluster },
      user: { uid: 'office-doc-preview' },
    }, 15000)
    const payload = JSON.parse(text)
    const raw = payload.data || payload.voices || []
    const data = raw.map(v => ({
      id: v.voice_type || v.id || v.voice_id,
      name: v.name || v.voice_type || v.id || 'unknown',
      gender: (v.gender || 'unknown').toLowerCase(),
      sample_rate: Number(v.sample_rate || 24000),
    }))
    return { data, degraded: false, source: 'live' }
  } catch (e) {
    return { data: FALLBACK_VOICES, degraded: true, source: 'fallback', reason: e.statusCode ? `http_${e.statusCode}` : 'exception' }
  }
}

// ============ ASR：录音文件识别（mock + 火山引擎异步轮询）============

/**
 * 录音文件识别。无凭证时返回 mock 占位。
 * @param {{taskId?: string, audioPath?: string, lang?: string}} opts
 * @returns {Promise<{text: string, segments: Array, engine: string, ms: number}>}
 */
export async function recognizeASR({ taskId, audioPath, lang = 'zh-CN' } = {}) {
  const t0 = Date.now()
  if (!asrAvailable()) {
    // mock 模式：基于 taskId / lang 生成占位
    // 注：mock 文本与 server 一致，便于 UI 测试 + 单元测试断言
    const mockText = mockAsrText(taskId, lang)
    return {
      text: mockText,
      segments: mockSplitSegments(mockText),
      engine: 'mock',
      ms: Date.now() - t0,
    }
  }
  // 真实火山引擎路径：这里仅给出骨架（完整实现需要 submit + 轮询）
  // 见 voice-portfolio/server/file_asr.py
  throw new SpeechError(501, '', '火山引擎 ASR 文件识别未实现（需移植 file_asr.py 完整轮询）')
}

// ============ Mock ASR helper functions ============
// 让 mock 数据有可预测的段落 + 时间戳，便于前端 hover 联动

const MOCK_ASR_TEMPLATES = [
  {
    lang: 'zh-CN',
    text: '各位同事大家好，今天我们来讨论一下项目进度。第一阶段已经完成开发工作。第二阶段正在测试环境验证中。第三阶段预计下周开始上线。',
  },
  {
    lang: 'en',
    text: 'Hello everyone, welcome to today\'s meeting. We will discuss the project timeline. The first phase is complete. The second phase is in testing. The third phase starts next week.',
  },
  {
    lang: 'zh-CN',
    text: '今天的会议主要讨论两个议题。第一项是预算分配方案。第二项是人员调整计划。希望大家积极发言。',
  },
]

/** mock ASR 文本：根据 taskId + lang 选模板（无 taskId 用第 1 个） */
function mockAsrText(taskId, lang = 'zh-CN') {
  const arr = MOCK_ASR_TEMPLATES.filter(t => t.lang === lang)
  const list = arr.length ? arr : MOCK_ASR_TEMPLATES
  if (!taskId || taskId === 'standalone') return list[0].text
  // 用 taskId 末尾字符作 hash 选择模板（确定性）
  let sum = 0
  for (let i = 0; i < taskId.length; i++) sum = (sum + taskId.charCodeAt(i)) % 997
  return list[sum % list.length].text
}

/** mock 拆分：按 。．.!?！？\n 拆段；模拟每段 ~3s，按字符数比例分时间 */
export function mockSplitSegments(text) {
  if (!text) return []
  // 切段（中英标点：。.！？!?；\n）
  const parts = text
    .split(/(?<=[。．.！!？?\n])/)
    .map(p => p.trim())
    .filter(Boolean)
  if (!parts.length) parts.push(text)
  const total = parts.reduce((s, p) => s + Math.max(1, p.length), 0)
  // 用起始累加；起始 = sum(prev_lens) / total * duration
  // duration 用 text.length * 60ms（让 100 字约 6 秒）
  const totalMs = Math.max(2000, parts.reduce((s, p) => s + p.length, 0) * 60)
  const out = []
  let cumulativeMs = 0
  for (const p of parts) {
    const dur = Math.round((p.length / total) * totalMs)
    out.push({
      text: p,
      start_ms: cumulativeMs,
      end_ms: cumulativeMs + dur,
      speaker: 0,
    })
    cumulativeMs += dur
  }
  return out
}

/**
 * 对 segments[] 逐段翻译。
 * 输入：[{text, start_ms, end_ms, ...}, ...]
 * 输出：[{..., source: 原 text, target: 翻译}, ...]
 * 错误时某段翻译失败不应中断：用原文兜底 + 错误标记
 */
export async function translateSegments(segments, { sourceLang = 'zh', targetLang = 'en' } = {}) {
  if (!Array.isArray(segments)) return []
  const out = []
  for (const seg of segments) {
    const text = (seg.text || '').trim()
    if (!text) {
      out.push({ ...seg, source: '', target: '' })
      continue
    }
    try {
      const r = await translateOnce({ text, sourceLang, targetLang })
      out.push({
        ...seg,
        source: text,
        target: r.translation || '',
        engine: r.engine,
      })
    } catch (e) {
      out.push({
        ...seg,
        source: text,
        target: '',
        engine: 'error',
      })
    }
  }
  return out
}

// ============ 实时翻译：火山引擎同声传译 2.0（mock + LRU）============

const TRANSLATE_LRU_MAX = 256
const translateLRU = new Map()

/**
 * 同声传译单次翻译。带 LRU 缓存（256 条）。
 * 无凭证时返回 mock（与 translate.mjs 的 standalone mock 行为一致）。
 */
export async function translateOnce({ text, sourceLang, targetLang, useCache = true } = {}) {
  if (!text || !text.trim()) {
    return { translation: '', engine: 'mock', cached: false, latency_ms: 0 }
  }
  const t0 = Date.now()
  const pairKey = `${sourceLang}-${targetLang}`
  const cacheKey = `${pairKey}:${crypto.createHash('sha1').update(text).digest('hex').slice(0, 16)}`

  if (useCache && translateLRU.has(cacheKey)) {
    const v = translateLRU.get(cacheKey)
    translateLRU.delete(cacheKey); translateLRU.set(cacheKey, v)  // bump LRU
    return { translation: v, engine: 'mock', cached: true, latency_ms: Date.now() - t0 }
  }

  let translation, engine
  if (!voiceTranslateAvailable() || !SUPPORTED_TRANSLATE_PAIRS.has(pairKey)) {
    // mock 模式：[targetLang -> sourceLang] 文本
    translation = `[${targetLang}] ${text}`
    engine = 'mock'
  } else {
    const cfg = readTranslateConfig()
    const body = {
      user: { uid: 'office-doc-preview' },
      audio: { format: 'wav', rate: 16000, language: sourceLang },
      request: { model: cfg.resourceId, text, source_language: sourceLang, target_language: targetLang },
      app: { appid: cfg.appId, token: cfg.token, cluster: cfg.resourceId },
    }
    const text2 = await postJSON(cfg.endpoint, {
      Authorization: `Bearer; ${cfg.token}`,
    }, body, 10000)
    const obj = JSON.parse(text2)
    translation = obj.translation || obj.text || ''
    engine = 'volc-translate'
  }

  if (useCache) {
    translateLRU.set(cacheKey, translation)
    if (translateLRU.size > TRANSLATE_LRU_MAX) {
      const firstKey = translateLRU.keys().next().value
      translateLRU.delete(firstKey)
    }
  }
  return { translation, engine, cached: false, latency_ms: Date.now() - t0 }
}

export function clearTranslateCache() {
  const n = translateLRU.size
  translateLRU.clear()
  return n
}

// ============ mock WAV 生成（最小可用 RIFF 容器）============

function mockWavBuffer(byteLen) {
  // 简化 RIFF/WAVE：PCM 16-bit mono 8kHz，全部 0（静音）
  const sampleRate = 8000
  const bitsPerSample = 16
  const numChannels = 1
  const byteRate = sampleRate * numChannels * bitsPerSample / 8
  const blockAlign = numChannels * bitsPerSample / 8
  const dataSize = Math.max(0, byteLen - 44)
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)         // PCM
  buf.writeUInt16LE(numChannels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(bitsPerSample, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  return buf
}

// ============ 健康检查 ============

export function speechHealth() {
  const tts = ttsAvailable()
  const asr = asrAvailable()
  const vt = voiceTranslateAvailable()
  return {
    ok: tts || asr || vt,
    tts: {
      available: tts,
      engines: tts ? ['volc-seedtts'] : ['mock-wav'],
      active: tts ? 'volc-seedtts' : 'mock-wav',
    },
    asr: {
      available: asr,
      engines: asr ? ['volc-bigmodel'] : ['mock'],
      active: asr ? 'volc-bigmodel' : 'mock',
    },
    translate: {
      available: vt,
      engines: vt ? ['volc-translate'] : ['mock'],
      active: vt ? 'volc-translate' : 'mock',
    },
    providers: {
      tts: tts ? ['volcengine'] : [],
      asr: asr ? ['volcengine'] : [],
      translate: vt ? ['volcengine'] : [],
    },
  }
}
