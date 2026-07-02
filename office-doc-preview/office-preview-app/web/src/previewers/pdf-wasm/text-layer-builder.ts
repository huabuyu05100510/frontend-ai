// Text Layer Builder: charBox Float32Array → data-pdfium HTML
// 模型：claude-sonnet-4-6
//
// 与 server 端 pdfium-text-layer.mjs 完全对齐的浏览器端实现：
//   - Run 级分组（fontSize + baselineY）
//   - span 定位：left/top/width/height absolute
//   - 输出 data-pdfium="4" 格式 HTML
//
// 入参 charPositions 格式（7 floats/char）：
//   [left, top, right, bottom, fontSize, charCode, width]

const RUN_ASCENT_RATIO = 0.80
const RUN_LINE_TOLERANCE = 0.5

interface CharBox {
  char: string
  left: number; top: number; right: number; bottom: number
  fontSize: number
  charW: number
}

interface TextRun {
  chars: CharBox[]
  str: string
  fontSize: number
  baselineY: number
  left: number; right: number; top: number; bottom: number
}

/**
 * 从 Worker 返回的 Float32Array 构建 data-pdfium="4" 格式的 text-layer HTML。
 * 输出与 server 端 pdfium-text-layer.mjs 的 buildRunBboxHtml 完全对齐。
 */
export function buildTextLayerFromCharBoxes(
  positions: Float32Array,
  chars: string,
  pageW: number,
  pageH: number,
): string {
  if (!positions.length || !chars.length) return ''

  const count = Math.min(positions.length / 7, chars.length)
  const boxes: CharBox[] = []

  for (let i = 0; i < count; i++) {
    const idx = i * 7
    boxes.push({
      char: chars[i] || '',
      left: positions[idx],
      top: positions[idx + 1],
      right: positions[idx + 2],
      bottom: positions[idx + 3],
      fontSize: positions[idx + 4],
      charW: positions[idx + 6],
    })
  }

  const runs = groupIntoRuns(boxes)
  return renderRunsToHtml(runs, pageW, pageH)
}

function groupIntoRuns(boxes: CharBox[]): TextRun[] {
  const runs: TextRun[] = []
  if (!boxes.length) return runs

  let current: CharBox[] = []
  let currentStr = ''

  for (const box of boxes) {
    if (!box.char) continue

    // 跳过极小的字（PDF 控制码 / ghost chars）
    if (box.fontSize < 3) continue

    const shouldStartNew = current.length === 0 || shouldBreak(current[current.length - 1], box)
    if (shouldStartNew && current.length > 0) {
      runs.push(makeRun(current, currentStr))
      current = []
      currentStr = ''
    }

    current.push(box)
    currentStr += box.char
  }

  if (current.length > 0) {
    runs.push(makeRun(current, currentStr))
  }

  return runs
}

function shouldBreak(prev: CharBox, next: CharBox): boolean {
  const sameFont = Math.abs(prev.fontSize - next.fontSize) < 0.5
  const fontSizeMax = Math.max(prev.fontSize, next.fontSize)
  const sameLine = Math.abs(prev.bottom - next.bottom) < fontSizeMax * RUN_LINE_TOLERANCE
  return !sameFont || !sameLine
}

function makeRun(chars: CharBox[], str: string): TextRun {
  const fontSize = chars[0].fontSize
  const baselineY = chars[0].bottom
  const left = Math.min(...chars.map(c => c.left))
  const right = Math.max(...chars.map(c => c.right))
  const top = Math.min(...chars.map(c => c.top))
  const bottom = Math.max(...chars.map(c => c.bottom))
  return { chars, str, fontSize, baselineY, left, right, top, bottom }
}

function renderRunsToHtml(runs: TextRun[], pageW: number, pageH: number): string {
  const spans = runs.map(run => {
    const inkW = Math.max(run.right - run.left, run.fontSize * 0.5)
    const inkH = Math.max(run.bottom - run.top, run.fontSize * 0.85)
    const escaped = escapeHtml(run.str)
    return `<span style="position:absolute;left:${run.left.toFixed(1)}px;top:${run.top.toFixed(1)}px;width:${inkW.toFixed(1)}px;height:${inkH.toFixed(1)}px;font-size:${run.fontSize.toFixed(1)}px">${escaped}</span>`
  })

  return spans.join('')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 包装器：生成完整 text-layer div（与 server 端 format 一致）
 */
export function buildTextLayerDiv(
  positions: Float32Array,
  chars: string,
  pageW: number,
  pageH: number,
  pdfiumVersion = '4',
): string {
  const inner = buildTextLayerFromCharBoxes(positions, chars, pageW, pageH)
  if (!inner) return ''
  return `<div class="pdf-text-layer" data-pdfium="${pdfiumVersion}" data-page-w="${pageW}" data-page-h="${pageH}">${inner}</div>`
}