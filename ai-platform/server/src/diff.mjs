// 双栏对比 / 智检 — diff 引擎 + 中文分词 + AI 语义校对
// 模型：claude-sonnet-4-6

/** Myers diff — character-level LCS edit script */
export function myersDiff(a, b) {
  const A = Array.from(a), B = Array.from(b)
  const N = A.length, M = B.length
  if (N === 0 && M === 0) return []
  if (N === 0) return [{ op: 'insert', text: b }]
  if (M === 0) return [{ op: 'delete', text: a }]

  const MAX = N + M
  const V = new Int32Array(2 * MAX + 1)
  V.fill(-1)
  V[MAX + 1] = 0
  const trace = []

  outer: for (let D = 0; D <= MAX; D++) {
    trace.push(new Int32Array(V))
    for (let k = -D; k <= D; k += 2) {
      let x
      if (k === -D || (k !== D && V[MAX + k - 1] < V[MAX + k + 1])) x = V[MAX + k + 1]
      else x = V[MAX + k - 1] + 1
      let y = x - k
      while (x < N && y < M && A[x] === B[y]) { x++; y++ }
      V[MAX + k] = x
      if (x >= N && y >= M) break outer
    }
  }

  const ops = []
  let x = N, y = M
  for (let D = trace.length - 1; D >= 0; D--) {
    const Vd = trace[D], k = x - y
    const prevK = (k === -D || (k !== D && Vd[MAX + k - 1] < Vd[MAX + k + 1])) ? k + 1 : k - 1
    const prevX = Vd[MAX + prevK], prevY = prevX - prevK
    while (x > prevX && y > prevY) { x--; y--; ops.push({ op: 'equal', text: A[x] }) }
    if (D > 0) {
      if (x === prevX) { y--; ops.push({ op: 'insert', text: B[y] }) }
      else { x--; ops.push({ op: 'delete', text: A[x] }) }
    }
  }
  ops.reverse()
  return mergeAdjacent(ops)
}

function mergeAdjacent(ops) {
  if (ops.length === 0) return ops
  const out = [ops[0]]
  for (let i = 1; i < ops.length; i++) {
    if (out[out.length - 1].op === ops[i].op) out[out.length - 1].text += ops[i].text
    else out.push(ops[i])
  }
  return out
}

export function groupByHunk(ops) {
  const groups = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].op === 'equal') { groups.push({ kind: 'equal', text: ops[i].text }); i++ }
    else {
      let original = '', corrected = ''
      while (i < ops.length && ops[i].op !== 'equal') {
        if (ops[i].op === 'delete') original += ops[i].text
        else corrected += ops[i].text
        i++
      }
      groups.push({ kind: 'change', original, corrected })
    }
  }
  return groups
}

export function summarizeErrors(ops) {
  const errors = []
  let id = 0, i = 0
  while (i < ops.length) {
    if (ops[i].op === 'equal') { i++; continue }
    let original = '', corrected = ''
    while (i < ops.length && ops[i].op !== 'equal') {
      if (ops[i].op === 'delete') original += ops[i].text
      else if (ops[i].op === 'insert') corrected += ops[i].text
      i++
    }
    id++
    errors.push({ id: 'e' + id, original, corrected, op: original && corrected ? 'change' : (original ? 'delete' : 'insert') })
  }
  return errors
}

export function charDiffToRenderTokens(ops) {
  return ops.map(o => ({ type: o.op, text: o.text }))
}

export function splitParagraphs(text) {
  const normalized = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const emptyRatio = lines.filter(l => l.trim().length === 0).length / Math.max(1, lines.length)
  const sep = emptyRatio > 0.1 ? /\n\n+/ : /\n/
  return normalized.split(sep).map(s => s.trim()).filter(s => s.length > 0)
}

// ======== 中文分词 ========
function isCJK(c) { const code = c.codePointAt(0); return code >= 0x4E00 && code <= 0x9FFF }

export function segmentWords(text) {
  if (!text) return []
  const chars = Array.from(text)
  const tokens = []
  let buf = '', bufType = null

  function getType(c) {
    if (/\s/.test(c)) return 'space'
    if (/[0-9]/.test(c)) return 'digit'
    if (/[a-zA-Z]/.test(c)) return 'alpha'
    if (isCJK(c)) return 'cjk'
    return 'punct'
  }

  for (const c of chars) {
    const type = getType(c)
    if (type === 'cjk' || type === 'punct') {
      if (buf) { tokens.push(buf); buf = ''; bufType = null }
      tokens.push(c)
    } else if (type === bufType) { buf += c }
    else { if (buf) tokens.push(buf); buf = c; bufType = type }
  }
  if (buf) tokens.push(buf)
  return tokens.filter(t => t.trim().length > 0)
}

// ======== 短语级错误检测 ========
export function detectPhraseErrors(leftText, rightText) {
  if (!leftText || !rightText) return []
  const ops = myersDiff(leftText, rightText)
  const errors = []
  let leftPos = 0, rightPos = 0, i = 0

  while (i < ops.length) {
    if (ops[i].op === 'equal') {
      leftPos += Array.from(ops[i].text).length
      rightPos += Array.from(ops[i].text).length
      i++; continue
    }
    let deletes = '', inserts = ''
    while (i < ops.length && ops[i].op !== 'equal') {
      if (ops[i].op === 'delete') deletes += ops[i].text
      else inserts += ops[i].text
      i++
    }
    const leftLen = Array.from(deletes).length
    const rightLen = Array.from(inserts).length
    let type = 'spell'
    if (leftLen === 0 && rightLen > 0) type = 'missing'
    else if (leftLen > 0 && rightLen === 0) type = 'redundant'
    else if (leftLen > 1 && rightLen > 1) type = leftLen === rightLen ? 'word_order' : 'grammar'

    errors.push({ phrase: deletes, suggestion: inserts, type, leftPos, rightPos })
    leftPos += leftLen; rightPos += rightLen
  }
  return errors
}

// ======== AI 语义校对 ========
export async function aiQualityCheck(text, opts = {}) {
  const t0 = Date.now()
  if (!text || !text.trim()) return { errors: [], summary: { total: 0, spell: 0, grammar: 0, punct: 0, other: 0 }, ms: 0, engine: 'empty' }

  const hasAI = !!(process.env.MINIMAX_API_KEY || process.env.ZHIPU_API_KEY || process.env.VOLCANO_API_KEY)
  if (!hasAI) {
    const errors = basicQualityCheck(text)
    return { errors, summary: summarizeQCErrors(errors), ms: Date.now() - t0, engine: 'heuristic-v1' }
  }

  try {
    const { translateAI } = await import('./translate-provider.mjs')
    const prompt = `你是中文文本校对专家。请校对以下文本并返回JSON：
{"errors":[{"type":"spell","original":"错字","corrected":"正字","position":10,"reason":"错别字"}]}
类型：spell/grammar/punct/number/unit/political/other
文本：${text.slice(0, 2000)}`

    const { target } = await translateAI({ text: prompt, sourceLang: 'zh-CN', targetLang: 'zh-CN', provider: opts.provider, apiKey: opts.apiKey })
    const jsonMatch = target.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { errors: [] }
    const errors = (parsed.errors || []).map((e, i) => ({
      id: 'qc' + (i + 1), type: e.type || 'other', original: e.original || '', corrected: e.corrected || '',
      position: e.position || 0, reason: e.reason || '',
      op: e.original && e.corrected ? 'change' : (e.original ? 'delete' : 'insert'),
    }))
    return { errors, summary: summarizeQCErrors(errors), ms: Date.now() - t0, engine: 'ai-qc-v1' }
  } catch (e) {
    console.error('[ai-quality-check] failed:', e.message)
    const errors = basicQualityCheck(text)
    return { errors, summary: summarizeQCErrors(errors), ms: Date.now() - t0, engine: 'heuristic-fallback-v1' }
  }
}

function basicQualityCheck(text) {
  const errors = []; let id = 0, m

  // 重复标点
  const dupRe = /([。，、；：！？,.!?;:])\1+/g
  while ((m = dupRe.exec(text)) !== null) {
    id++; errors.push({ id: 'qc' + id, type: 'punct', original: m[0], corrected: m[1], position: m.index, reason: '重复标点', op: 'change' })
  }
  // 中英混用标点
  const enPunctRe = /[\u4e00-\u9fff][,.]\s*[\u4e00-\u9fff]/g
  while ((m = enPunctRe.exec(text)) !== null) {
    id++; errors.push({ id: 'qc' + id, type: 'punct', original: m[0], corrected: m[0].replace(',', '，').replace('.', '。'), position: m.index, reason: '中文文本中的英文标点', op: 'change' })
  }
  // 常见错别字
  const typos = [['在', '再'], ['的', '得'], ['做', '作'], ['已', '己'], ['人', '入'], ['未', '末'], ['侯', '候'], ['燥', '躁'], ['那', '哪'], ['象', '像'], ['帐', '账'], ['长', '常']]
  for (const [w, r] of typos) {
    let pos = 0
    while ((pos = text.indexOf(w, pos)) >= 0) {
      id++; errors.push({ id: 'qc' + id, type: 'spell', original: w, corrected: r + '（疑似）', position: pos, reason: `"${w}" 可能是"${r}"的误用`, op: 'change' })
      pos++
    }
  }
  return errors
}

function summarizeQCErrors(errors) {
  const s = { total: errors.length, spell: 0, grammar: 0, punct: 0, other: 0 }
  for (const e of errors) {
    if (s[e.type] !== undefined) s[e.type]++
    else s.other++
  }
  return s
}
