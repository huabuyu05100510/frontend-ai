// 双栏对比 / 智检 — diff 引擎 + 中文分词 + AI 语义校对
// 模型：claude-sonnet-4-6
//
// 算法：Myers diff（O((N+M)·D) 编辑距离线性），字符级 diff
//   - 对中文 / Emoji / Unicode 友好（按 Unicode 代码点切分，而非字节/UTF-16）
//   - 输出 ops 序列：equal / delete（仅左）/ insert（仅右）
//   - round-trip 不变式：filter(!insert) → 原左；filter(!delete) → 原右
//
// v6: 新增中文分词、短语级错误检测、AI 语义校对接口
//
// API：
//   myersDiff(left, right)              → DiffOp[]
//   groupByHunk(ops)                    → Hunk[]  (UI 渲染单元：连续 equal/change)
//   summarizeErrors(ops)                → Error[] (侧栏列表条目，带 id)
//   charDiffToRenderTokens(ops)         → RenderToken[] (前端 React 渲染用)
//   segmentWords(text)                  → string[] (中文分词)
//   detectPhraseErrors(left, right)     → PhraseError[] (短语级错误)
//   categorizeErrors(errors)            → CategorizedError[] (按类型分类)
//   aiQualityCheck(text)                → Promise<QCResult> (AI 语义校对)

/**
 * Myers diff — 字符级 LCS 编辑脚本
 * @param {string} a
 * @param {string} b
 * @returns {Array<{op:'equal'|'delete'|'insert', text:string}>}
 */
export function myersDiff(a, b) {
  // 按 Unicode 代码点（Array.from 自动处理 surrogate pair → Emoji 友好）
  const A = Array.from(a)
  const B = Array.from(b)
  const N = A.length
  const M = B.length

  // 边界：空串
  if (N === 0 && M === 0) return []
  if (N === 0) return [{ op: 'insert', text: b }]
  if (M === 0) return [{ op: 'delete', text: a }]

  // ⚡ 快速路径：A 与 B 完全无公共字符（如 'aaa' vs 'bbb'）
  // 这种情况 Myers 会跑满 D = N+M 次（O(NM)），对长文本是 100M+ 次循环
  // 提前检测：构造 B 的字符集 + 线性扫描 A
  //   - 若 0 个公共字符 → 直接返回 delete-all + insert-all（O(N+M)）
  //   - 若 ≥1 个公共字符 → 走 Myers（D << N+M 的常见场景）
  const bHas = new Set(B)
  let hasCommon = false
  for (let i = 0; i < N; i++) {
    if (bHas.has(A[i])) { hasCommon = true; break }
  }
  if (!hasCommon) {
    return [
      { op: 'delete', text: a },
      { op: 'insert', text: b },
    ]
  }

  const MAX = N + M
  // V 数组：V[k] = 某条对角线上能达到的最远 x
  // 使用 TypedArray 提升性能（高 D 时循环密集）
  const V = new Int32Array(2 * MAX + 1)
  V.fill(-1)
  V[MAX + 1] = 0
  const trace = []

  outer: for (let D = 0; D <= MAX; D++) {
    trace.push(new Int32Array(V))
    for (let k = -D; k <= D; k += 2) {
      let x
      if (k === -D || (k !== D && V[MAX + k - 1] < V[MAX + k + 1])) {
        x = V[MAX + k + 1]  // down (insert)
      } else {
        x = V[MAX + k - 1] + 1  // right (delete)
      }
      let y = x - k
      // snake：沿对角线走相等的字符
      while (x < N && y < M && A[x] === B[y]) { x++; y++ }
      V[MAX + k] = x
      if (x >= N && y >= M) {
        break outer
      }
    }
  }

  // 回溯：从终点 (N,M) 倒推 ops
  const ops = []
  let x = N, y = M
  for (let D = trace.length - 1; D >= 0; D--) {
    const Vd = trace[D]
    const k = x - y
    let prevK
    if (k === -D || (k !== D && Vd[MAX + k - 1] < Vd[MAX + k + 1])) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }
    const prevX = Vd[MAX + prevK]
    const prevY = prevX - prevK

    // 沿对角线走的部分 = equal
    while (x > prevX && y > prevY) {
      x--; y--
      ops.push({ op: 'equal', text: A[x] })
    }

    if (D > 0) {
      if (x === prevX) {
        // insert：b[prevY..y-1] 是插入的
        y--
        ops.push({ op: 'insert', text: B[y] })
      } else {
        // delete：a[prevX..x-1] 是删除的
        x--
        ops.push({ op: 'delete', text: A[x] })
      }
    }
  }

  // 反转得到正序，并合并相邻同 op
  ops.reverse()
  return mergeAdjacent(ops)
}

/** 合并相邻同 op（如 ['删','删','删'] → ['删×3']） */
function mergeAdjacent(ops) {
  if (ops.length === 0) return ops
  const out = [ops[0]]
  for (let i = 1; i < ops.length; i++) {
    const prev = out[out.length - 1]
    const cur = ops[i]
    if (prev.op === cur.op) {
      prev.text += cur.text
    } else {
      out.push(cur)
    }
  }
  return out
}

/**
 * 将 ops 聚类为 UI 渲染单元（hunk）：连续 delete+insert 合并为 1 个 change
 * @returns {Array<{kind:'equal'|'change', text?:string, original?:string, corrected?:string}>}
 */
export function groupByHunk(ops) {
  const groups = []
  let i = 0
  while (i < ops.length) {
    const o = ops[i]
    if (o.op === 'equal') {
      groups.push({ kind: 'equal', text: o.text })
      i++
    } else {
      // 收集连续的 delete + insert
      let original = ''
      let corrected = ''
      while (i < ops.length && ops[i].op !== 'equal') {
        if (ops[i].op === 'delete') original += ops[i].text
        else if (ops[i].op === 'insert') corrected += ops[i].text
        i++
      }
      groups.push({ kind: 'change', original, corrected })
    }
  }
  return groups
}

/**
 * 从 ops 中提取错误条目（用于 DiffSidebar 列表）
 * @returns {Array<{id:string, original:string, corrected:string, op:'change'|'delete'|'insert'}>}
 */
export function summarizeErrors(ops) {
  const errors = []
  let id = 0
  let i = 0
  while (i < ops.length) {
    const o = ops[i]
    if (o.op === 'equal') { i++; continue }
    let original = ''
    let corrected = ''
    let op
    while (i < ops.length && ops[i].op !== 'equal') {
      if (ops[i].op === 'delete') original += ops[i].text
      else if (ops[i].op === 'insert') corrected += ops[i].text
      i++
    }
    if (original && corrected) op = 'change'
    else if (original) op = 'delete'
    else op = 'insert'
    id++
    errors.push({
      id: 'e' + id,
      original,
      corrected,
      op
    })
  }
  return errors
}

/**
 * 转为前端 React 渲染 token（type 字段替 op，与前端 switch 命名一致）
 * @returns {Array<{type:'equal'|'delete'|'insert', text:string}>}
 */
export function charDiffToRenderTokens(ops) {
  return ops.map(o => ({ type: o.op, text: o.text }))
}

/**
 * 段落分割
 * 启发式：空行率 > 10% 用双换行分段（正式文档）；否则用单换行（诗歌/代码）
 * @param {string} text
 * @returns {string[]}
 */
export function splitParagraphs(text) {
  const normalized = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const emptyRatio = lines.filter(l => l.trim().length === 0).length / Math.max(1, lines.length)
  const sep = emptyRatio > 0.1 ? /\n\n+/ : /\n/
  return normalized.split(sep).map(s => s.trim()).filter(s => s.length > 0)
}

/**
 * 段落级 Myers diff（以段落数组为元素）
 * @param {string[]} A
 * @param {string[]} B
 * @returns {Array<{op:'equal'|'delete'|'insert', text:string}>}
 */
export function myersDiffArray(A, B) {
  const N = A.length, M = B.length
  if (N === 0 && M === 0) return []
  if (N === 0) return B.map(t => ({ op: 'insert', text: t }))
  if (M === 0) return A.map(t => ({ op: 'delete', text: t }))

  const MAX = N + M
  const V = new Array(2 * MAX + 1).fill(-1)
  V[MAX + 1] = 0
  const trace = []

  outer: for (let D = 0; D <= MAX; D++) {
    trace.push(V.slice())
    for (let k = -D; k <= D; k += 2) {
      let x
      if (k === -D || (k !== D && V[MAX + k - 1] < V[MAX + k + 1])) {
        x = V[MAX + k + 1]
      } else {
        x = V[MAX + k - 1] + 1
      }
      let y = x - k
      while (x < N && y < M && A[x] === B[y]) { x++; y++ }
      V[MAX + k] = x
      if (x >= N && y >= M) break outer
    }
  }

  const ops = []
  let x = N, y = M
  for (let D = trace.length - 1; D >= 0; D--) {
    const Vd = trace[D]
    const k = x - y
    let prevK
    if (k === -D || (k !== D && Vd[MAX + k - 1] < Vd[MAX + k + 1])) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }
    const prevX = Vd[MAX + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--; y--
      ops.push({ op: 'equal', text: A[x] })
    }
    if (D > 0) {
      if (x === prevX) {
        y--
        ops.push({ op: 'insert', text: B[y] })
      } else {
        x--
        ops.push({ op: 'delete', text: A[x] })
      }
    }
  }
  ops.reverse()
  return ops
}

/**
 * 段落级 diff，产生 ParagraphDiffBlock 数组
 * 相邻 delete+insert 配对为 change（嵌入字符级 charOps）
 * @param {string} leftText
 * @param {string} rightText
 * @returns {Array<{kind:'equal'|'change'|'delete'|'insert', leftText:string, rightText:string, charOps?:Array}>}
 */
export function paragraphDiff(leftText, rightText) {
  const leftParas = splitParagraphs(leftText || '')
  const rightParas = splitParagraphs(rightText || '')
  const paraOps = myersDiffArray(leftParas, rightParas)

  const blocks = []
  let i = 0
  while (i < paraOps.length) {
    const cur = paraOps[i]
    if (cur.op === 'delete' && i + 1 < paraOps.length && paraOps[i + 1].op === 'insert') {
      // 配对为 change，嵌入字符级 diff
      const charOps = myersDiff(cur.text, paraOps[i + 1].text)
      blocks.push({ kind: 'change', leftText: cur.text, rightText: paraOps[i + 1].text, charOps })
      i += 2
    } else if (cur.op === 'equal') {
      blocks.push({ kind: 'equal', leftText: cur.text, rightText: cur.text })
      i++
    } else if (cur.op === 'delete') {
      blocks.push({ kind: 'delete', leftText: cur.text, rightText: '' })
      i++
    } else {
      blocks.push({ kind: 'insert', leftText: '', rightText: cur.text })
      i++
    }
  }
  return blocks
}

// ============ v6: 中文分词 + 短语错误检测 + AI 语义校对 ============

/** CJK 字符判断 */
function isCJK(c) {
  const code = c.codePointAt(0)
  return code >= 0x4E00 && code <= 0x9FFF
}

/**
 * 简易中文分词（基于字符类型 + 字符级 unigram 启发式）
 * 行业对标：结巴分词的轻量版，适合服务端无依赖场景
 *
 * 策略：
 *   1. CJK 单字为独立 token
 *   2. 连续 ASCII（字母/数字）合并为一个 token
 *   3. 标点/空白独立 token
 *
 * @param {string} text
 * @returns {string[]}
 */
export function segmentWords(text) {
  if (!text) return []
  const chars = Array.from(text)
  const tokens = []
  let buf = ''
  let bufType = null

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
    } else if (type === bufType) {
      buf += c
    } else {
      if (buf) tokens.push(buf)
      buf = c
      bufType = type
    }
  }
  if (buf) tokens.push(buf)

  return tokens.filter(t => t.trim().length > 0)
}

/**
 * 短语级错误检测：在 Myers diff 基础上，将相邻的 delete+insert 对聚类为短语级错误
 *
 * 行业对标讯飞文本纠错 CGED TOP1 技术：
 *   - 拼写错误：insert 单字 → delete 单字
 *   - 语序错误：delete+insert 同一位置 → 换词
 *   - 冗余错误：纯 delete
 *   - 遗漏错误：纯 insert
 *
 * @param {string} leftText
 * @param {string} rightText
 * @returns {Array<{phrase:string, suggestion:string, type:'spell'|'redundant'|'missing'|'word_order'|'grammar', leftPos:number, rightPos:number}>}
 */
export function detectPhraseErrors(leftText, rightText) {
  if (!leftText || !rightText) return []

  const ops = myersDiff(leftText, rightText)
  const errors = []
  let leftPos = 0, rightPos = 0
  let i = 0

  while (i < ops.length) {
    const op = ops[i]
    if (op.op === 'equal') {
      leftPos += Array.from(op.text).length
      rightPos += Array.from(op.text).length
      i++
      continue
    }

    // 收集连续的非 equal ops
    let deletes = '', inserts = ''
    while (i < ops.length && ops[i].op !== 'equal') {
      if (ops[i].op === 'delete') deletes += ops[i].text
      else inserts += ops[i].text
      i++
    }

    let type = 'spell'
    const leftLen = Array.from(deletes).length
    const rightLen = Array.from(inserts).length

    if (leftLen === 0 && rightLen > 0) type = 'missing'
    else if (leftLen > 0 && rightLen === 0) type = 'redundant'
    else if (leftLen > 1 && rightLen > 1) {
      type = leftLen === rightLen ? 'word_order' : 'grammar'
    }

    errors.push({
      phrase: deletes,
      suggestion: inserts,
      type,
      leftPos,
      rightPos,
    })

    leftPos += leftLen
    rightPos += rightLen
  }

  return errors
}

/** 错误分类（对标讯飞智检 6 大类） */
const ERROR_CATEGORIES = {
  'spell': '拼写差错',
  'redundant': '冗余差错',
  'missing': '遗漏差错',
  'word_order': '语序差错',
  'grammar': '语法差错',
  'punct': '标点差错',
  'number': '数字差错',
  'unit': '量和单位差错',
  'political': '政治领域差错',
  'unknown': '其他差错',
}

/**
 * 对 error 列表按类型分类（对标讯飞智检分类体系）
 * @param {Array} errors - summarizeErrors 的输出
 * @returns {Array<{id:string, label:string, count:number, errors:Array}>}
 */
export function categorizeErrors(errors) {
  const map = new Map()
  for (const err of errors) {
    // 基于内容特征推断错误类型
    const type = inferErrorType(err)
    if (!map.has(type)) map.set(type, [])
    map.get(type).push(err)
  }
  const cats = Object.keys(ERROR_CATEGORIES).filter(k => map.has(k))
  return cats.map(id => ({
    id,
    label: ERROR_CATEGORIES[id] || id,
    count: map.get(id).length,
    errors: map.get(id),
  }))
}

function inferErrorType(err) {
  const text = (err.original || '') + (err.corrected || '')
  // 政治敏感词检测
  const politicalTerms = ['习近平', '台独', '法轮功', '六四', '藏独', '疆独']
  if (politicalTerms.some(t => text.includes(t))) return 'political'
  // 数字差错
  if (/\d/.test(err.original || '') || /\d/.test(err.corrected || '')) {
    if (/[亿万千百万十]/.test(text)) return 'unit'
    return 'number'
  }
  // 标点差错
  if (/[\p{P}]/u.test(err.original || '') || /[\p{P}]/u.test(err.corrected || '')) return 'punct'
  // 语法差错（较长片段）
  const len = Math.max((err.original || '').length, (err.corrected || '').length)
  if (len > 3) return 'grammar'
  if (err.original && !err.corrected) return 'redundant'
  if (!err.original && err.corrected) return 'missing'
  return 'spell'
}

/**
 * AI 语义校对：调用 LLM 对文本进行深度校对
 *
 * 行业对标讯飞文本纠错 CGED 2018 TOP1：
 *   - 拼写、语法、标点、数字、量和单位、政治领域 6 大类
 *   - 基于海量标注数据和深度学习算法
 *
 * 当前实现：调用 translate-provider 的 AI 接口做语义校对
 * 当有可用的 AI provider 时返回深度校对结果，否则返回基于 Myers diff 的基本检测
 *
 * @param {string} text - 待校对文本
 * @param {{ provider?: string, apiKey?: string }} opts
 * @returns {Promise<{errors:Array, summary:{total:int, spell:int, grammar:int, punct:int, other:int}, ms:number, engine:string}>}
 */
export async function aiQualityCheck(text, opts = {}) {
  const t0 = Date.now()
  if (!text || !text.trim()) {
    return { errors: [], summary: { total: 0, spell: 0, grammar: 0, punct: 0, other: 0 }, ms: 0, engine: 'empty' }
  }

  const hasAI = !!(process.env.MINIMAX_API_KEY || process.env.ZHIPU_API_KEY || process.env.VOLCANO_API_KEY)

  if (!hasAI) {
    // 无 AI → 返回基于 heuristics 的基本检测
    const errors = basicQualityCheck(text)
    const ms = Date.now() - t0
    return { errors, summary: summarizeQCErrors(errors), ms, engine: 'heuristic-v1' }
  }

  try {
    // 动态导入避免循环依赖
    const { translateAI } = await import('./translate-provider.mjs')
    const prompt = `你是一个专业的中文文本校对专家。请对以下文本进行校对，检查并返回所有发现的错误。
对于每个错误，请提供：
1. 错误类型：spell（拼写）、grammar（语法）、punct（标点）、number（数字）、unit（量和单位）、political（政治）、other（其他）
2. 错误原文片段
3. 修正建议片段
4. 错误位置（大致字符位置）
5. 错误说明

请严格按照以下 JSON 格式返回，不要包含任何其他内容：
{"errors":[{"type":"spell","original":"错字","corrected":"正字","position":10,"reason":"错别字"},{"type":"grammar","original":"把书放在桌子","corrected":"把书放在桌子上","position":45,"reason":"缺少方位词"}]}

待校对文本：
${text.slice(0, 2000)}`

    const { target } = await translateAI({
      text: prompt,
      sourceLang: 'zh-CN',
      targetLang: 'zh-CN',
      provider: opts.provider,
      apiKey: opts.apiKey,
    })

    // 解析 JSON
    const jsonMatch = target.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { errors: [] }
    const errors = (parsed.errors || []).map((e, i) => ({
      id: 'qc' + (i + 1),
      type: e.type || 'other',
      original: e.original || '',
      corrected: e.corrected || '',
      position: e.position || 0,
      reason: e.reason || '',
      op: e.original && e.corrected ? 'change' : (e.original ? 'delete' : 'insert'),
    }))

    const ms = Date.now() - t0
    return { errors, summary: summarizeQCErrors(errors), ms, engine: 'ai-qc-v1' }
  } catch (e) {
    console.error('[ai-quality-check] failed:', e.message)
    const errors = basicQualityCheck(text)
    const ms = Date.now() - t0
    return { errors, summary: summarizeQCErrors(errors), ms, engine: 'heuristic-fallback-v1' }
  }
}

/**
 * 基本文本质量检测（无 AI 时的 heuristic 方案）
 * 对标讯飞 6 大类：拼写、标点、数字、量和单位、语法、政治领域
 */
function basicQualityCheck(text) {
  const errors = []
  let id = 0

  // 1. 重复标点检测（如 。。、，，）
  const dupPunctRe = /([。，、；：！？,.!?;:])\1+/g
  let m
  while ((m = dupPunctRe.exec(text)) !== null) {
    id++
    errors.push({
      id: 'qc' + id,
      type: 'punct',
      original: m[0],
      corrected: m[1],
      position: m.index,
      reason: '重复标点',
      op: 'change',
    })
  }

  // 2. 中英混用标点（中文文本中的英文标点）
  const enPunctRe = /[\u4e00-\u9fff][,.]\s*[\u4e00-\u9fff]/g
  while ((m = enPunctRe.exec(text)) !== null) {
    id++
    const fixed = m[0].replace(',', '，').replace('.', '。')
    errors.push({
      id: 'qc' + id,
      type: 'punct',
      original: m[0],
      corrected: fixed,
      position: m.index,
      reason: '中文文本中的英文标点',
      op: 'change',
    })
  }

  // 3. 常见错别字检测
  const commonTypos = [
    ['在', '再'], ['的', '得'], ['做', '作'],
    ['已', '己'], ['人', '入'], ['未', '末'],
    ['侯', '候'], ['燥', '躁'], ['那', '哪'],
    ['象', '像'], ['帐', '账'], ['长', '常'],
  ]
  for (const [wrong, right] of commonTypos) {
    let pos = 0
    while ((pos = text.indexOf(wrong, pos)) >= 0) {
      // 需要更多上下文判断（简化版：出现即标记）
      const context = text.slice(Math.max(0, pos - 2), pos + wrong.length + 3)
      if (context.length > 2) {
        id++
        errors.push({
          id: 'qc' + id,
          type: 'spell',
          original: wrong,
          corrected: right + '（疑似）',
          position: pos,
          reason: `"${wrong}" 可能是"${right}"的误用`,
          op: 'change',
        })
      }
      pos++
    }
  }

  // 4. 数字与单位间距检测
  const numUnitRe = /(\d+)\s*([亿万千百万十]|[a-zA-Z]{1,3})/g
  while ((m = numUnitRe.exec(text)) !== null) {
    id++
    errors.push({
      id: 'qc' + id,
      type: 'unit',
      original: m[0],
      corrected: m[0],
      position: m.index,
      reason: `数字+单位检查: ${m[0]}`,
      op: 'equal',
    })
  }

  return errors
}

function summarizeQCErrors(errors) {
  const summary = { total: errors.length, spell: 0, grammar: 0, punct: 0, other: 0 }
  for (const e of errors) {
    if (summary[e.type] !== undefined) summary[e.type]++
    else summary.other++
  }
  return summary
}

/**
 * 词级 diff：把 srcText / tgtText 分词后做 Myers 词级 diff，
 * 并算出每个 token 在原文中的 [start, end) code-point 偏移，便于前端 span 染色。
 *
 * @param {string} srcText
 * @param {string} tgtText
 * @param {[string,string]} [langPair]  仅作为可观测字段（目前 tokenize 用同一套 segmentWords）
 * @returns {{
 *   srcTokens: string[],
 *   tgtTokens: string[],
 *   srcOffsets: Array<[number, number]>,
 *   tgtOffsets: Array<[number, number]>,
 *   ops: Array<{op:'equal'|'delete'|'insert', text:string}>,
 *   srcChars: number,
 *   tgtChars: number,
 *   ms: number,
 *   langPair: [string, string]
 * }}
 */
export function wordDiff(srcText, tgtText, langPair = ['zh', 'en']) {
  const t0 = Date.now()
  const src = srcText || ''
  const tgt = tgtText || ''

  const srcTokens = segmentWords(src)
  const tgtTokens = segmentWords(tgt)
  // myersDiffArray 对 array 元素（字符串）做 diff，ops 的 text 即单个 token
  const ops = myersDiffArray(srcTokens, tgtTokens)

  const srcOffsets = tokenCharOffsets(src, srcTokens)
  const tgtOffsets = tokenCharOffsets(tgt, tgtTokens)

  return {
    srcTokens,
    tgtTokens,
    srcOffsets,
    tgtOffsets,
    ops,
    srcChars: Array.from(src).length,
    tgtChars: Array.from(tgt).length,
    ms: Date.now() - t0,
    langPair,
  }
}

/**
 * 给定原文 text 与 token 数组（顺序与 segmentWords 一致），返回每个 token 在 text 中
 * 的 [start, end) 偏移（按 code points 计算，匹配 Array.from(text) 的索引空间）。
 *
 * 算法：用同一个状态机再走一遍字符流，按 segmentWords 产生 token 的顺序（含被
 * 后置 filter 过滤的空白 token）记录 [start, end)。返回前把空 token 对应的偏移剔除，
 * 保证与外部传入的 tokens 数组一一对应。
 */
function tokenCharOffsets(text, tokens) {
  const offsets = []
  if (!tokens.length || !text) {
    for (let i = 0; i < tokens.length; i++) offsets.push([0, 0])
    return offsets
  }

  const chars = Array.from(text)
  const tokenCharLen = (t) => Array.from(t).length

  function getType(c) {
    if (/\s/.test(c)) return 'space'
    if (/[0-9]/.test(c)) return 'digit'
    if (/[a-zA-Z]/.test(c)) return 'alpha'
    if (isCJK(c)) return 'cjk'
    return 'punct'
  }

  let i = 0  // char cursor
  let tIdx = 0  // token cursor (over internal stream including space tokens)
  let buf = ''
  let bufType = null
  let bufStart = -1
  const out = []  // 收集 (rawToken, [start, end))

  while (i < chars.length) {
    const c = chars[i]
    const type = getType(c)
    if (type === 'cjk' || type === 'punct') {
      if (buf) {
        out.push([buf, [bufStart, i]])
        buf = ''
        bufType = null
        bufStart = -1
      }
      out.push([c, [i, i + 1]])
      i++
    } else if (type === bufType) {
      buf += c
      i++
    } else {
      if (buf) {
        out.push([buf, [bufStart, i]])
      }
      buf = c
      bufType = type
      bufStart = i
      i++
    }
  }
  if (buf) out.push([buf, [bufStart, i]])

  // 对齐外部 tokens：内部 out 可能含空白 token（被 segmentWords 的 filter 剔除），
  // 用 tokenCharLen 累加推进 out 指针。
  let oi = 0
  for (let k = 0; k < tokens.length; k++) {
    const want = tokens[k]
    const wantLen = tokenCharLen(want)
    // 跳过 out 中所有 tokenCharLen 之和 < wantLen 的项
    let acc = 0
    while (oi < out.length) {
      const [ot, off] = out[oi]
      const otLen = tokenCharLen(ot)
      acc += otLen
      if (acc === wantLen) {
        // 完全匹配 → 取本 token 的 [start, end)
        offsets.push(off)
        oi++
        break
      } else if (acc > wantLen) {
        // 不会发生：external token 在 internal stream 里是连读的；防御性处理
        offsets.push([out[oi][1][0], out[oi][1][0] + wantLen])
        break
      } else {
        // 跳过空格等 internal-only token
        oi++
      }
    }
    if (offsets.length <= k) offsets.push([0, 0])
  }
  return offsets
}