// 文本校对 / 内容合规 — 讯飞智检对标
// 模型：claude-sonnet-4-6
// 六大类：拼写、语法、标点、数字、量和单位、政治领域

// Myers diff（字符级，Unicode 安全）
function myersDiff(a: string, b: string): Array<{ op: 'equal' | 'delete' | 'insert'; text: string }> {
  const A = Array.from(a), B = Array.from(b)
  const N = A.length, M = B.length

  if (N === 0 && M === 0) return []
  if (N === 0) return [{ op: 'insert', text: b }]
  if (M === 0) return [{ op: 'delete', text: a }]

  const MAX = N + M
  const V = new Int32Array(2 * MAX + 1)
  V.fill(-1)
  V[MAX + 1] = 0
  const trace: Int32Array[] = []

  outer: for (let D = 0; D <= MAX; D++) {
    trace.push(new Int32Array(V))
    for (let k = -D; k <= D; k += 2) {
      let x: number
      if (k === -D || (k !== D && V[MAX + k - 1] < V[MAX + k + 1])) x = V[MAX + k + 1]
      else x = V[MAX + k - 1] + 1
      let y = x - k
      while (x < N && y < M && A[x] === B[y]) { x++; y++ }
      V[MAX + k] = x
      if (x >= N && y >= M) break outer
    }
  }

  const ops: Array<{ op: 'equal' | 'delete' | 'insert'; text: string }> = []
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
  return ops.reverse().reduce((acc, o) => {
    const last = acc[acc.length - 1]
    if (last && last.op === o.op) last.text += o.text
    else acc.push({ ...o, text: o.text })
    return acc
  }, [] as Array<{ op: 'equal' | 'delete' | 'insert'; text: string }>)
}

export function diffChars(left: string, right: string) {
  const t0 = Date.now()
  const ops = myersDiff(left, right)
  const errors: Array<{
    id: string; original: string; corrected: string; op: string; type: string;
    leftPos: number; rightPos: number;
  }> = []

  let id = 0, leftPos = 0, rightPos = 0, i = 0
  while (i < ops.length) {
    const op = ops[i]
    if (op.op === 'equal') {
      const len = Array.from(op.text).length
      leftPos += len; rightPos += len
      i++
      continue
    }
    // 收集连续的非 equal
    let deletes = '', inserts = ''
    while (i < ops.length && ops[i].op !== 'equal') {
      if (ops[i].op === 'delete') deletes += ops[i].text
      else inserts += ops[i].text
      i++
    }
    id++
    errors.push({
      id: `e${id}`, original: deletes, corrected: inserts,
      op: deletes && inserts ? 'change' : (deletes ? 'delete' : 'insert'),
      type: classifyType(deletes, inserts),
      leftPos, rightPos,
    })
    leftPos += Array.from(deletes).length
    rightPos += Array.from(inserts).length
  }

  const tokens = ops.map(o => ({ type: o.op, text: o.text }))
  return { ops: tokens, errors, tokens, ms: Date.now() - t0, meta: { leftChars: Array.from(left).length, rightChars: Array.from(right).length, errorCount: errors.length } }
}

function classifyType(del: string, ins: string): string {
  if (!del) return 'missing'
  if (!ins) return 'redundant'
  if (del.length === ins.length && del.length > 1) return 'word_order'
  if (del.length > 1 || ins.length > 1) return 'grammar'
  const c = del + ins
  if (/[\p{P}]/u.test(c)) return 'punct'
  if (/\d/.test(c)) return 'number'
  if (/[亿万千百十]/.test(c)) return 'unit'
  return 'spell'
}

// 基本 heuristic 校对
export function heuristicCheck(text: string) {
  const errors: Array<{ id: string; type: string; original: string; corrected: string; position: number; reason: string }> = []
  let id = 0

  // 重复标点
  const dupRe = /([。，、；：！？,.!?;:])\1+/g
  let m: RegExpExecArray | null
  while ((m = dupRe.exec(text)) !== null) {
    id++; errors.push({ id: `qc${id}`, type: 'punct', original: m[0], corrected: m[1], position: m.index, reason: '重复标点' })
  }

  // 中英标点混用
  const enPunctRe = /[\u4e00-\u9fff][,.]\s*[\u4e00-\u9fff]/g
  while ((m = enPunctRe.exec(text)) !== null) {
    id++; errors.push({ id: `qc${id}`, type: 'punct', original: m[0], corrected: m[0].replace(',', '，').replace('.', '。'), position: m.index, reason: '中文文本中的英文标点' })
  }

  // 常见错别字
  const typos = [['在', '再'], ['的', '得'], ['做', '作'], ['已', '己'], ['人', '入'], ['未', '末'], ['侯', '候'], ['燥', '躁'], ['那', '哪'], ['象', '像'], ['帐', '账'], ['长', '常']]
  for (const [w, r] of typos) {
    let pos = 0
    while ((pos = text.indexOf(w, pos)) >= 0) {
      id++; errors.push({ id: `qc${id}`, type: 'spell', original: w, corrected: `${r}（疑似）`, position: pos, reason: `"${w}" 可能是"${r}"的误用` })
      pos++
    }
  }

  const summary = { total: errors.length, spell: 0, grammar: 0, punct: 0, other: 0 }
  for (const e of errors) {
    const k = e.type as keyof typeof summary
    if (summary[k] !== undefined) summary[k]++
    else summary.other++
  }
  return { errors, summary }
}

// 中文分词
export function segmentWords(text: string): string[] {
  if (!text) return []
  const chars = Array.from(text)
  const tokens: string[] = []
  let buf = '', bufType: string | null = null

  const getType = (c: string) => {
    if (/\s/.test(c)) return 'space'
    if (/[0-9]/.test(c)) return 'digit'
    if (/[a-zA-Z]/.test(c)) return 'alpha'
    if (/[\u4e00-\u9fff]/.test(c)) return 'cjk'
    return 'punct'
  }

  for (const c of chars) {
    const t = getType(c)
    if (t === 'cjk' || t === 'punct') {
      if (buf) { tokens.push(buf); buf = ''; bufType = null }
      tokens.push(c)
    } else if (t === bufType) { buf += c }
    else { if (buf) tokens.push(buf); buf = c; bufType = t }
  }
  if (buf) tokens.push(buf)
  return tokens.filter(t => t.trim().length > 0)
}