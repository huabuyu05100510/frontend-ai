import { parseXml, findAll, firstChild, attr, firstText, type XmlNode } from './xml'
import { ZipArchive } from './zip'

// ============================================================================
// pptx — PresentationML(slideN.xml) → Slide[]（纯逻辑，可测）
//   提取：文本框（位置/尺寸 EMU、字号 pt、颜色、粗体、水平/垂直对齐）、
//         图片(p:pic：位置/尺寸 + r:embed 关系)。
//   幻灯片实际尺寸从 ppt/presentation.xml 的 p:sldSz 读取（EMU）。
// ============================================================================

const DEFAULT_SLIDE_W = 12192000
const DEFAULT_SLIDE_H = 6858000
const DEFAULT_FONT_PT = 18

export type Align = 'left' | 'center' | 'right' | 'justify'
export type VAnchor = 'top' | 'center' | 'bottom'

export interface SlideText {
  text: string
  x: number
  y: number
  w: number
  h: number
  size: number // pt（代表字号，取形状内最大 run）
  color?: string
  bold?: boolean
  align?: Align
  anchor?: VAnchor
}
export interface SlideImage {
  x: number
  y: number
  w: number
  h: number
  rId?: string
  target?: string
  src?: string
}
export interface Slide {
  index: number
  texts: SlideText[]
  images: SlideImage[]
  slideWidth?: number
  slideHeight?: number
}

const FALSY = new Set(['0', 'false', 'off'])

/** a:xfrm → 位置/尺寸（EMU）；缺失则 0 */
function xfrmOf(sp: XmlNode): { x: number; y: number; w: number; h: number } {
  const off = findAll(sp, 'a:off')[0]
  const ext = findAll(sp, 'a:ext')[0]
  return {
    x: off ? parseInt(attr(off, 'x') ?? '0', 10) || 0 : 0,
    y: off ? parseInt(attr(off, 'y') ?? '0', 10) || 0 : 0,
    w: ext ? parseInt(attr(ext, 'cx') ?? '0', 10) || 0 : 0,
    h: ext ? parseInt(attr(ext, 'cy') ?? '0', 10) || 0 : 0,
  }
}

const ALGN: Record<string, Align> = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }
const ANCHOR: Record<string, VAnchor> = { t: 'top', ctr: 'center', b: 'bottom' }

/** 文本框：拼接段落文本，并提取代表字号/颜色/粗体/对齐 */
function parseTextShape(sp: XmlNode): Omit<SlideText, 'x' | 'y' | 'w' | 'h'> | null {
  const txBody = firstChild(sp, 'p:txBody')
  if (!txBody) return null
  const paras = findAll(txBody, 'a:p')
  const lines: string[] = []
  let maxSize = 0
  let color: string | undefined
  let bold: boolean | undefined
  let align: Align | undefined

  for (const p of paras) {
    const pPr = firstChild(p, 'a:pPr')
    if (align === undefined && pPr) {
      const a = attr(pPr, 'algn')
      if (a && ALGN[a]) align = ALGN[a]
    }
    let line = ''
    for (const r of findAll(p, 'a:r')) {
      const t = findAll(r, 'a:t').map(firstText).join('')
      line += t
      const rPr = firstChild(r, 'a:rPr')
      if (rPr) {
        const sz = attr(rPr, 'sz')
        if (sz) maxSize = Math.max(maxSize, parseInt(sz, 10) / 100)
        const b = attr(rPr, 'b')
        if (b !== undefined && !FALSY.has(b) && bold === undefined) bold = true
        if (!color) {
          const fill = firstChild(rPr, 'a:solidFill')
          const srgb = fill && firstChild(fill, 'a:srgbClr')
          const v = srgb && attr(srgb, 'val')
          if (v) color = '#' + v
        }
      }
    }
    lines.push(line)
  }
  const text = lines.join('\n').replace(/\n+$/g, '')
  if (!text.trim()) return null

  // 垂直对齐 p:bodyPr@anchor
  const bodyPr = firstChild(txBody, 'p:bodyPr')
  const anc = bodyPr && attr(bodyPr, 'anchor')
  const anchor = anc ? ANCHOR[anc] : undefined

  return { text, size: maxSize > 0 ? maxSize : DEFAULT_FONT_PT, color, bold, align, anchor }
}

/** 图片 p:pic → 位置/尺寸 + r:embed */
function parsePic(pic: XmlNode): SlideImage {
  const blip = findAll(pic, 'a:blip')[0]
  const rId = blip ? (attr(blip, 'r:embed') ?? attr(blip, 'r:link')) : undefined
  const box = xfrmOf(pic)
  return { ...box, rId }
}

export function parseSlide(
  index: number,
  slideXml: string,
  slideWidth = DEFAULT_SLIDE_W,
  slideHeight = DEFAULT_SLIDE_H,
): Slide {
  const root = parseXml(slideXml)
  const texts: SlideText[] = []
  for (const sp of findAll(root, 'p:sp')) {
    const t = parseTextShape(sp)
    if (!t) continue
    const box = xfrmOf(sp)
    texts.push({ ...box, ...t })
  }
  const images: SlideImage[] = []
  for (const pic of findAll(root, 'p:pic')) images.push(parsePic(pic))
  return { index, texts, images, slideWidth, slideHeight }
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  tiff: 'image/tiff',
  emf: 'image/emf',
  wmf: 'image/wmf',
}

function parseRels(relsXml: string): Record<string, string> {
  const root = parseXml(relsXml)
  const map: Record<string, string> = {}
  for (const r of findAll(root, 'Relationship')) {
    const id = attr(r, 'Id')
    const target = attr(r, 'Target')
    if (id && target) map[id] = target
  }
  return map
}

function joinPath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = baseDir.split('/').filter(Boolean)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

/** 从 PPTX 字节加载全部幻灯片（按编号排序），解析图片关系生成对象 URL */
export async function loadPptx(bytes: Uint8Array): Promise<Slide[]> {
  const zip = await ZipArchive.open(bytes)

  let slideWidth = DEFAULT_SLIDE_W
  let slideHeight = DEFAULT_SLIDE_H
  if (zip.has('ppt/presentation.xml')) {
    try {
      const presRoot = parseXml(await zip.text('ppt/presentation.xml'))
      const sldSz = findAll(presRoot, 'p:sldSz')[0]
      if (sldSz) {
        const cx = parseInt(attr(sldSz, 'cx') ?? '0', 10)
        const cy = parseInt(attr(sldSz, 'cy') ?? '0', 10)
        if (cx > 0) slideWidth = cx
        if (cy > 0) slideHeight = cy
      }
    } catch {
      // 回退默认值
    }
  }

  const slideNames = zip
    .names()
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(/slide(\d+)/.exec(a)![1], 10) - parseInt(/slide(\d+)/.exec(b)![1], 10))

  const slides: Slide[] = []
  for (let i = 0; i < slideNames.length; i++) {
    const name = slideNames[i]
    const slide = parseSlide(i, await zip.text(name), slideWidth, slideHeight)

    // 解析该页图片关系 → 对象 URL
    if (slide.images.length > 0) {
      const fileName = name.split('/').pop()!
      const relsPath = `ppt/slides/_rels/${fileName}.rels`
      const rels = zip.has(relsPath) ? parseRels(await zip.text(relsPath)) : {}
      for (const img of slide.images) {
        if (!img.rId) continue
        const target = rels[img.rId]
        if (!target) continue
        const path = joinPath('ppt/slides', target)
        if (!zip.has(path)) continue
        img.target = path
        const ext = path.split('.').pop()?.toLowerCase() ?? ''
        try {
          const data = await zip.bytes(path)
          const blob = new Blob([data as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' })
          img.src = URL.createObjectURL(blob)
        } catch {
          // 非浏览器环境（测试）跳过对象 URL
        }
      }
    }
    slides.push(slide)
  }
  return slides
}
