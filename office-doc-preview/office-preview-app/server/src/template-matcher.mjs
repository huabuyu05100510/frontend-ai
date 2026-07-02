// 自研 iocr 模板匹配引擎
// 模型：claude-sonnet-4-6
//
// 对标百度 iocr 的核心算法：基于参照字段锚点的坐标变换 + 区域投影提取
//
// 工作流（与百度 iocr 控制台一致）：
//   1. 用户在样例图上画"参照字段"（reference fields）+ 填写实际文字
//      —— 这些是稳定的视觉锚点（如"发票号码"、"开票日期"标签）
//   2. 用户画"识别字段"（recognition fields）—— 真正要提取的数据区
//   3. 新图来时：
//      a. 调通用 OCR → 得到所有文字 + 坐标
//      b. 用参照字段的文字在新图 OCR 结果中模糊匹配 → 得到 (template_box, region_box) 锚点对
//      c. 计算变换：offset（中位数）+ scale（中位数），抗离群
//      d. 把识别字段的模板坐标做变换 → 在新图找落在该区域的 OCR 文字
//      e. 按阅读顺序拼接 → 字段值
//
// 算法复杂度：O(R × N)（R=参照字段数, N=OCR regions 数）
//   - 通常 R<10, N<500，<10ms 完成
//
// 关键设计点：
//   - 文字相似度：字符级 bigram Jaccard，对中英混排 + 标点容错（"发票号码" vs "发票号码："仍高匹配）
//   - 变换估计：中位数聚合，单/多锚点都鲁棒；离群（误匹配）被自然过滤
//   - 阅读顺序：先 y 后 x（同 y 容差内按 x 排序），符合中文文档阅读习惯

/**
 * 字符级 bigram Jaccard 相似度
 * 对"发票号码" vs "发票号码："（含标点）仍给高分
 * @param {string} a
 * @param {string} b
 * @returns {number} [0, 1]
 */
export function textSimilarity(a, b) {
  if (!a || !b) return 0
  const sa = String(a).trim()
  const sb = String(b).trim()
  if (!sa || !sb) return 0
  if (sa === sb) return 1

  // 子串包含：a ⊂ b 或 b ⊂ a → 高分（标签常被 OCR 加冒号/空格）
  if (sb.includes(sa) || sa.includes(sb)) {
    const shorter = Math.min(sa.length, sb.length)
    const longer = Math.max(sa.length, sb.length)
    return shorter / longer
  }

  // 字符 bigram Jaccard
  const bigramsOf = (s) => {
    const set = new Set()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const ba = bigramsOf(sa)
  const bb = bigramsOf(sb)
  let inter = 0
  for (const g of ba) if (bb.has(g)) inter++
  const union = ba.size + bb.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * 计算坐标变换（offset + scale），基于锚点对的中位数估计
 * 抗离群：用 median 而非 mean
 * @param {Array<{template:{x,y,w,h}, matched:{x,y,w,h}}>} anchors
 * @returns {{offsetX:number, offsetY:number, scaleX:number, scaleY:number}}
 */
export function computeTransform(anchors) {
  if (!anchors || anchors.length === 0) {
    return { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }
  }

  const offsetsX = []
  const offsetsY = []
  const scalesX = []
  const scalesY = []
  for (const a of anchors) {
    if (!a.matched) continue
    const tcx = a.template.x + a.template.w / 2
    const tcy = a.template.y + a.template.h / 2
    const mcx = a.matched.x + a.matched.w / 2
    const mcy = a.matched.y + a.matched.h / 2
    offsetsX.push(mcx - tcx)
    offsetsY.push(mcy - tcy)
    if (a.template.w > 0) scalesX.push(a.matched.w / a.template.w)
    if (a.template.h > 0) scalesY.push(a.matched.h / a.template.h)
  }

  if (offsetsX.length === 0) {
    return { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }
  }

  return {
    offsetX: median(offsetsX),
    offsetY: median(offsetsY),
    scaleX: scalesX.length ? clamp(median(scalesX), 0.5, 2.0) : 1,
    scaleY: scalesY.length ? clamp(median(scalesY), 0.5, 2.0) : 1,
  }
}

function median(arr) {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * 找出中心落在 box 内的 regions，按阅读顺序排序（先 y 后 x）
 * @param {Array<{x,y,w,h,text}>} regions
 * @param {{x,y,w,h}} box
 * @returns {Array} 排序后的 regions
 */
export function findRegionsInBox(regions, box) {
  const inBox = []
  for (const r of regions) {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    if (cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h) {
      inBox.push(r)
    }
  }
  // 阅读顺序：按 y 中心聚类（容差 = 平均行高的 0.5），同聚类内按 x 升序
  const avgH = inBox.length > 0
    ? inBox.reduce((s, r) => s + r.h, 0) / inBox.length
    : 20
  inBox.sort((a, b) => {
    const ya = a.y + a.h / 2
    const yb = b.y + b.h / 2
    if (Math.abs(ya - yb) > avgH * 0.5) return ya - yb
    return (a.x + a.w / 2) - (b.x + b.w / 2)
  })
  return inBox
}

/**
 * 把模板坐标系下的 box 变换到目标图坐标系
 */
function applyTransform(box, transform) {
  return {
    x: box.x * transform.scaleX + transform.offsetX,
    y: box.y * transform.scaleY + transform.offsetY,
    w: box.w * transform.scaleX,
    h: box.h * transform.scaleY,
  }
}

/**
 * 主入口：模板匹配
 * @param {{regions: Array<{text,x,y,w,h,confidence?}>, template: {referenceFields: Array, fields: Array}}} opts
 * @returns {{fields: Array<{name, value, location, confidence}>, anchors: Array<{id, name, matched, score, region?}>, transform: {offsetX,offsetY,scaleX,scaleY}, alignmentScore: number}}
 */
export function matchTemplate({ regions, template }) {
  const refs = template.referenceFields || []
  const fields = template.fields || []

  // 1. 锚点匹配：每个 referenceField 在 regions 里找最相似的
  const anchors = []
  for (const ref of refs) {
    let best = null
    let bestScore = 0
    for (const r of regions) {
      const score = textSimilarity(ref.text, r.text)
      if (score > bestScore) {
        bestScore = score
        best = r
      }
    }
    // 阈值：相似度 >= 0.5 才算匹配上
    const matched = bestScore >= 0.5
    anchors.push({
      id: ref.id,
      name: ref.name,
      text: ref.text,
      matched,
      score: bestScore,
      region: matched ? best : null,
      templateBox: { x: ref.x, y: ref.y, w: ref.w, h: ref.h },
    })
  }

  // 2. 用匹配上的锚点计算变换
  const matchedAnchors = anchors
    .filter(a => a.matched)
    .map(a => ({ template: a.templateBox, matched: a.region }))
  const transform = computeTransform(matchedAnchors)

  // 3. 对每个识别字段做坐标变换 → 落在变换后区域的文字
  const outFields = fields.map(f => {
    const targetBox = applyTransform({ x: f.x, y: f.y, w: f.w, h: f.h }, transform)
    const hit = findRegionsInBox(regions, targetBox)
    const value = hit.map(r => r.text).join('')
    const avgConf = hit.length > 0
      ? hit.reduce((s, r) => s + (r.confidence || 0.9), 0) / hit.length
      : 0
    return {
      id: f.id,
      name: f.name,
      type: f.type,
      value,
      location: hit.length > 0 ? {
        x: Math.min(...hit.map(r => r.x)),
        y: Math.min(...hit.map(r => r.y)),
        w: Math.max(...hit.map(r => r.x + r.w)) - Math.min(...hit.map(r => r.x)),
        h: Math.max(...hit.map(r => r.y + r.h)) - Math.min(...hit.map(r => r.y)),
      } : null,
      confidence: avgConf,
      hitCount: hit.length,
    }
  })

  // 4. alignmentScore = 匹配锚点占比 × 平均相似度
  const matchedCount = anchors.filter(a => a.matched).length
  const avgScore = anchors.length > 0
    ? anchors.reduce((s, a) => s + a.score, 0) / anchors.length
    : 1  // 无锚点时默认满分（直接按坐标提取）
  const matchRate = anchors.length > 0 ? matchedCount / anchors.length : 1
  const alignmentScore = matchRate * avgScore

  return {
    fields: outFields,
    anchors,
    transform,
    alignmentScore,
  }
}
