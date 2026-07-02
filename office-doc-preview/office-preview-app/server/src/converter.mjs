// OnlyOffice Document Server 转码：Office → 高保真 PDF → 同步栅格化为缩略图 + 每页 PNG
// 模型：Claude MiniMax-M3（MiniMax）
// 流水线：convert(OnlyOffice HTTP) → linearize(qpdf) → thumb(pdftoppm page=1) → pages(pdftoppm 全页) → finalize
// 失败兜底：HTTP 不可达即抛 OnlyOfficeUnreachable，不再 docker cp / wget（跨主机部署可移植）
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import jwt from 'jsonwebtoken'
import { CONFIG } from './config.mjs'
import { updateTask } from './store.mjs'
import { linearizePdf } from './pdf-optimize.mjs'
import {
  getPdfPageCount,
  rasterizeThumb,
  rasterizeAllPages,
  extractAllTextLayers,
  imageDimensions,
  fileSize as fileSizeOf
} from './pdf-rasterize.mjs'

// ============ 文件类型映射 ============
const FILETYPE_MAP = {
  docx: 'docx', doc: 'doc',
  pptx: 'pptx', ppt: 'ppt',
  xlsx: 'xlsx', xls: 'xls'
}

// ============ 纯函数：JWT 签名 ============
/** 签发 OnlyOffice 鉴权 token（HS256） */
export function signOnlyOfficeRequest(payload) {
  return jwt.sign(payload, CONFIG.ONLYOFFICE_JWT_SECRET, { algorithm: 'HS256' })
}

// ============ 纯函数：响应解析 ============
/** 解码 XML 文本节点中的 HTML 实体（&amp; → &, &lt; → < 等） */
function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/** 解析 OnlyOffice /ConvertService.ashx 响应（XML 或 JSON）。返回 fileUrl，错误抛 OnlyOfficeError */
export function parseOnlyOfficeResponse(text) {
  if (typeof text !== 'string') throw new Error('parseOnlyOfficeResponse: text must be string')

  // XML 路径
  if (text.startsWith('<?xml') || text.includes('<FileResult>')) {
    const errorMatch = text.match(/<Error>(.*?)<\/Error>/)
    if (errorMatch) {
      const code = errorMatch[1]
      const msg = code === '-8' ? 'JWT 鉴权失败' : `OnlyOffice error code ${code}`
      const err = new Error(`OnlyOfficeError: ${msg} (code=${code})`)
      err.code = code
      err.onlyOffice = true
      throw err
    }
    const urlMatch = text.match(/<FileUrl>(.*?)<\/FileUrl>/)
    if (urlMatch) return decodeXmlEntities(urlMatch[1])
    throw new Error('parseOnlyOfficeResponse: XML missing FileUrl')
  }

  // JSON 路径（旧版本 OnlyOffice）
  let result
  try {
    result = JSON.parse(text)
  } catch (e) {
    throw new Error(`parseOnlyOfficeResponse: not XML or JSON, preview: ${text.slice(0, 120)}`)
  }
  if (result.error) throw new Error(`OnlyOfficeError: ${result.error}`)
  if (result.fileUrl) return result.fileUrl
  throw new Error('parseOnlyOfficeResponse: JSON missing fileUrl')
}

// ============ 自定义错误类型 ============
export class OnlyOfficeUnreachable extends Error {
  constructor(reason) {
    super(`OnlyOfficeUnreachable: ${reason}`)
    this.name = 'OnlyOfficeUnreachable'
    this.onlyOffice = true
  }
}

// ============ 阶段 1：OnlyOffice HTTP 转换 ============
/**
 * 调用 OnlyOffice /ConvertService.ashx 把 srcPath 转 PDF，返回下载 URL
 * 失败抛 OnlyOfficeUnreachable；JWT/参数错误抛 OnlyOfficeError（带 code）
 */
export function convertWithOnlyOffice(srcPath, task) {
  const ext = FILETYPE_MAP[task.ext] || 'docx'
  const key = `${task.id}_${Date.now()}`
  const fileUrl = `${CONFIG.HOST_FOR_DOCKER}/api/files/${task.id}?as=original`

  const payload = { async: false, filetype: ext, key, outputtype: 'pdf', url: fileUrl }
  const requestBody = JSON.stringify(payload)
  const token = signOnlyOfficeRequest(payload)

  return new Promise((resolve, reject) => {
    let urlObj
    try {
      urlObj = new URL('/ConvertService.ashx', CONFIG.ONLYOFFICE_HOST)
    } catch (e) {
      return reject(new OnlyOfficeUnreachable(`bad ONLYOFFICE_HOST: ${e.message}`))
    }

    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(requestBody)
      }
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new OnlyOfficeUnreachable(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`))
        }
        console.log(`[onlyoffice] convert response (${data.length}B): ${data.slice(0, 300)}`)
        try {
          const fileUrl = parseOnlyOfficeResponse(data)
          resolve(fileUrl)
        } catch (e) {
          reject(e)
        }
      })
    })

    req.on('error', (e) => reject(new OnlyOfficeUnreachable(`network: ${e.message}`)))
    req.setTimeout(CONFIG.CONVERT_TIMEOUT_MS, () => {
      req.destroy()
      reject(new OnlyOfficeUnreachable(`timeout ${CONFIG.CONVERT_TIMEOUT_MS}ms`))
    })
    req.write(requestBody)
    req.end()
  })
}

// ============ 阶段 1 兜底：本地 soffice 转码 ============
// 当 OnlyOffice Docker 容器无法访问宿主机（host.docker.internal 路由失败）
// 或 OnlyOffice 持续返回业务错误时，用本地 LibreOffice headless 转 Office → PDF。
// 兼容性：保留率低于 OnlyOffice 但比直接抛错好，部署/开发两用。
export function convertWithSoffice(srcPath, task) {
  const outDir = path.dirname(srcPath)
  const outPdf = path.join(outDir, path.basename(srcPath, path.extname(srcPath)) + '.pdf')
  return new Promise((resolve, reject) => {
    const soffice = spawn('soffice', [
      '--headless',
      '--norestore', '--nofirststartwizard', '--nologo',
      '--convert-to', 'pdf',
      '--outdir', outDir,
      srcPath
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    soffice.stderr.on('data', d => { err += d.toString() })
    soffice.on('error', e => reject(new Error(`soffice spawn failed: ${e.message}`)))
    soffice.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`soffice exited ${code}: ${err.slice(0, 300)}`))
      }
      if (!fs.existsSync(outPdf) || fs.statSync(outPdf).size < 1024) {
        return reject(new Error(`soffice did not produce PDF at ${outPdf}`))
      }
      console.log(`[soffice] converted ${task.name} → ${path.basename(outPdf)} (${fs.statSync(outPdf).size}B)`)
      resolve(outPdf)
    })
    soffice.stdout?.on('data', () => {})
  })
}

// ============ 阶段 2：下载 PDF ============
/**
 * 从 ONLYOFFICE_HOST 下载 PDF 到本地 dstPath；返回 dstPath
 * OnlyOffice 缓存文件用 nginx secure_link（md5/expires 查询参数）鉴权。
 * 注意：部分 OnlyOffice 容器版本（已知 9.4.0.129）的 cache URL 路径生成有 bug
 * （URL 期望 `/output.pdf/output.pdf` 嵌套，但实际文件是 `/output.pdf` 平铺）。
 * 当 HTTP 下载失败且 ONLYOFFICE_HOST 指向本机时，回退到 docker cp 直拷容器文件。
 */
export function downloadPdf(pdfUrl, dstPath) {
  const url = new URL(pdfUrl, CONFIG.ONLYOFFICE_HOST)
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dstPath)
    const req = http.get({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: 'GET'
    }, (res) => {
      console.log(`[onlyoffice] download response: ${res.statusCode} ${url.href}`)
      if (res.statusCode === 200) {
        res.pipe(file)
        file.on('finish', () => {
          file.close()
          const stat = fs.statSync(dstPath)
          if (stat.size < 1024) {
            fs.unlinkSync(dstPath)
            return reject(new OnlyOfficeUnreachable(`downloaded PDF too small (${stat.size}B)`))
          }
          resolve(dstPath)
        })
        return
      }
      file.close()
      try { fs.unlinkSync(dstPath) } catch {}
      // HTTP 失败，尝试本地 docker cp 兜底（仅当 ONLYOFFICE_HOST 是 localhost）
      const isLocal = ['localhost', '127.0.0.1', 'host.docker.internal'].includes(url.hostname)
      if (isLocal) {
        const fallback = downloadViaDockerCp(pdfUrl, dstPath)
        fallback.then(resolve).catch(reject)
      } else {
        reject(new OnlyOfficeUnreachable(`PDF download HTTP ${res.statusCode} from ${url.href}`))
      }
    })
    req.on('error', (e) => {
      file.close()
      try { fs.unlinkSync(dstPath) } catch {}
      const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
      if (isLocal) {
        const fallback = downloadViaDockerCp(pdfUrl, dstPath)
        fallback.then(resolve).catch(reject)
      } else {
        reject(new OnlyOfficeUnreachable(`download error: ${e.message}`))
      }
    })
    req.setTimeout(CONFIG.CONVERT_TIMEOUT_MS, () => {
      req.destroy()
      reject(new OnlyOfficeUnreachable('download timeout'))
    })
  })
}

/** 本地开发兜底：用 docker cp 从 OnlyOffice 容器拷出 PDF。仅 localhost 调用。 */
function downloadViaDockerCp(pdfUrl, dstPath) {
  return new Promise((resolve, reject) => {
    // FileUrl 形式: http://localhost:8080/cache/files/data/conv_xxx/output.pdf/output.pdf?md5=...
    // 容器实际路径：/var/lib/onlyoffice/documentserver/App_Data/cache/files/data/conv_xxx/output.pdf（平铺）
    // 因此正则要吃掉 URL 末尾多余的 "/output.pdf"
    const m = pdfUrl.match(/\/cache\/files\/(data\/conv_[^/]+\/output\.pdf)/)
    if (!m) return reject(new OnlyOfficeUnreachable(`docker cp: cannot parse path from ${pdfUrl}`))
    const relPath = m[1]
    const containerPath = `/var/lib/onlyoffice/documentserver/App_Data/cache/files/${relPath}`
    console.log(`[onlyoffice] fallback docker cp: onlyoffice:${containerPath}`)
    const cp = spawn('docker', ['cp', `onlyoffice:${containerPath}`, dstPath])
    let err = ''
    cp.stderr.on('data', d => { err += d.toString() })
    cp.on('close', code => {
      if (code === 0 && fs.existsSync(dstPath)) {
        const stat = fs.statSync(dstPath)
        if (stat.size > 1024) {
          console.log(`[onlyoffice] docker cp ok: ${dstPath} (${stat.size}B)`)
          return resolve(dstPath)
        }
      }
      reject(new OnlyOfficeUnreachable(`docker cp failed: ${err || `code ${code}`}`))
    })
    cp.on('error', e => reject(new OnlyOfficeUnreachable(`docker cp spawn error: ${e.message}`)))
  })
}

// ============ 阶段 3-5：线性化 + 缩略图 + 全页栅格化 ============
/** 6 段状态机：convert → linearize → page-count → thumb → pages → finalize */
async function runConvert(task, srcPath) {
  const outDir = path.resolve(CONFIG.DERIVED_DIR, task.id)
  fs.mkdirSync(outDir, { recursive: true })

  const originalOriginalPath = task.originalPath
  // 把源文件复制到 derived（OnlyOffice 通过 URL 访问）
  const workFile = path.join(outDir, task.name)
  if (srcPath !== workFile) fs.copyFileSync(srcPath, workFile)
  task.originalPath = workFile

  const startAt = Date.now()
  updateTask(task.id, {
    convertStatus: 'processing', convertError: null,
    convertStage: 'convert',
    convertStartAt: startAt, convertRetries: 0
  })

  // ---------- 阶段 1：OnlyOffice 转换（带 1 次重试）→ soffice 兜底 ----------
  let pdfDownloadUrl = null
  let pdfPath = null  // soffice 直接产出本地路径时跳过阶段 2
  try {
    pdfDownloadUrl = await convertWithOnlyOffice(workFile, task)
  } catch (err) {
    if (err.onlyOffice && err.code) {
      // OnlyOffice 业务错误（JWT / 格式不支持等）—— 直接失败
      task.originalPath = originalOriginalPath
      updateTask(task.id, { convertStatus: 'failed', convertStage: null, convertError: err.message })
      console.error(`[converter] ${task.name} OnlyOfficeError:`, err.message)
      return
    }
    // 网络不可达：单次重试
    updateTask(task.id, { convertRetries: 1, convertStage: 'convert', convertError: `retry: ${err.message}` })
    try {
      pdfDownloadUrl = await convertWithOnlyOffice(workFile, task)
    } catch (err2) {
      // OnlyOffice 仍不可达 → soffice（LibreOffice headless）兜底
      console.warn(`[converter] OnlyOffice unreachable, falling back to soffice: ${err2.message}`)
      updateTask(task.id, { convertRetries: 2, convertStage: 'convert', convertError: `soffice fallback: ${err2.message}` })
      try {
        pdfPath = await convertWithSoffice(workFile, task)
      } catch (sErr) {
        task.originalPath = originalOriginalPath
        updateTask(task.id, { convertStatus: 'failed', convertStage: null, convertError: sErr.message })
        console.error(`[converter] ${task.name} soffice also failed:`, sErr.message)
        return
      }
    }
  }
  updateTask(task.id, { convertRetries: 0 })

  // ---------- 阶段 2：下载 PDF（soffice 已直接产出则跳过）----------
  if (!pdfPath) {
    const rawPdfPath = path.join(outDir, path.basename(workFile, path.extname(workFile)) + '.pdf')
    try {
      pdfPath = await downloadPdf(pdfDownloadUrl, rawPdfPath)
    } catch (err) {
      task.originalPath = originalOriginalPath
      updateTask(task.id, { convertStatus: 'failed', convertStage: null, convertError: err.message })
      return
    }
  }

  // ---------- 阶段 3：线性化 ----------
  let finalPdf = pdfPath
  try {
    updateTask(task.id, { convertStage: 'linearize' })
    const linPath = path.join(outDir, path.basename(pdfPath, '.pdf') + '.linear.pdf')
    await linearizePdf(pdfPath, linPath)
    finalPdf = linPath
  } catch (e) {
    console.warn(`[converter] linearize skipped for ${task.name}: ${e.message}`)
    finalPdf = pdfPath
  }

  // ---------- 阶段 4：页数探测 ----------
  let pageCount = 0
  try {
    updateTask(task.id, { convertStage: 'thumb' })
    pageCount = await getPdfPageCount(finalPdf)
  } catch (e) {
    console.warn(`[converter] page count failed for ${task.name}: ${e.message}`)
  }

  const finalStat = fs.statSync(finalPdf)
  const taskUpdate = {
    previewExt: 'pdf',
    previewPath: finalPdf,
    previewSize: finalStat.size,
    previewUrl: `/api/files/${task.id}?as=preview`,
    pagesTotal: pageCount
  }

  // ---------- 阶段 5：缩略图 ----------
  let thumbRelPath = null
  try {
    if (pageCount > 0) {
      const thumbPath = path.join(outDir, 'thumb.png')
      await rasterizeThumb(finalPdf, thumbPath, CONFIG.RASTERIZE_THUMB_DPI)
      thumbRelPath = thumbPath
    }
  } catch (e) {
    console.warn(`[converter] thumb failed for ${task.name}: ${e.message}`)
  }

  // ---------- 阶段 6：全页栅格化 ----------
  let pagesRelDir = null
  let pages = []
  try {
    if (pageCount > 0 && pageCount <= CONFIG.RASTERIZE_MAX_PAGES) {
      updateTask(task.id, { convertStage: 'pages' })
      pagesRelDir = path.join(outDir, 'pages')
      pages = await rasterizeAllPages(
        finalPdf, pagesRelDir, 'page',
        CONFIG.RASTERIZE_PAGE_DPI, CONFIG.RASTERIZE_PAGE_PARALLEL,
        (done) => updateTask(task.id, { pagesDone: done })
      )
    } else if (pageCount > CONFIG.RASTERIZE_MAX_PAGES) {
      console.warn(`[converter] ${task.name} has ${pageCount} pages > MAX ${CONFIG.RASTERIZE_MAX_PAGES}; skip rasterize`)
    }
  } catch (e) {
    console.warn(`[converter] pages rasterize failed for ${task.name}: ${e.message}`)
  }

  // ---------- 阶段 6.5：文字覆盖层（方案 B） ----------
  let textRelDir = null
  let textByPage = new Map()
  try {
    if (pages.length > 0 && pageCount <= CONFIG.RASTERIZE_MAX_PAGES) {
      updateTask(task.id, { convertStage: 'textLayer' })
      textRelDir = path.join(outDir, 'text')
      const layers = await extractAllTextLayers(
        finalPdf, textRelDir, 'page',
        CONFIG.RASTERIZE_PAGE_PARALLEL,
        CONFIG.RASTERIZE_PAGE_DPI,
        (done) => updateTask(task.id, { textDone: done })
      )
      textByPage = new Map(layers.map(l => [l.page, l]))
    }
  } catch (e) {
    console.warn(`[converter] text layer failed for ${task.name}: ${e.message}`)
  }

  // ---------- 阶段 7：finalize ----------
  task.originalPath = originalOriginalPath
  const durationMs = Date.now() - startAt
  const srcBytesPerSec = durationMs > 0 ? Math.round(task.size / (durationMs / 1000)) : 0

  // 缩略图尺寸仍单独取（用于前端骨架定位）
  let thumbDims = { width: 0, height: 0 }
  try {
    if (thumbRelPath) thumbDims = await imageDimensions(thumbRelPath)
  } catch {}

  // 关键：用每页栅格化 PNG 的真实像素尺寸（width/height from rasterizeAllPages），
  // 不是 thumbDims —— 否则前端容器被压成缩略图大小（96 DPI ≈ 300×424），
  // 而文字层 bbox 坐标系是 120 DPI ≈ 1000×1414，必然严重错位。
  const publicPages = pages.map(p => {
    const text = textByPage.get(p.page)
    return {
      page: p.page,
      url: `/api/files/${task.id}?as=page&n=${p.page}`,
      textUrl: text ? `/api/files/${task.id}?as=text&n=${p.page}` : undefined,
      textWords: text?.words || 0,
      bytes: fileSizeOf(p.file),
      width: p.width || thumbDims.width || 0,
      height: p.height || thumbDims.height || 0
    }
  })

  updateTask(task.id, {
    ...taskUpdate,
    convertStatus: 'done',
    convertStage: null,
    pagesDone: pages.length,
    convertDoneAt: Date.now(),
    convertDurationMs: durationMs,
    convertBytesPerSec: srcBytesPerSec,
    thumbUrl: thumbRelPath ? `/api/files/${task.id}?as=thumb` : null,
    thumbPath: thumbRelPath,
    pagesDir: pagesRelDir,
    textDir: textRelDir,
    pages: publicPages
  })
  console.log(`[converter] ${task.name} → done ${publicPages.length}/${pageCount} pages, text=${textByPage.size} in ${durationMs}ms (engine=OnlyOffice)`)
}

// ============ 队列：简单串行（OnlyOffice Document Server 内部已并发处理） ============
let queue = Promise.resolve()
export function enqueueConvert(task, srcPath) {
  queue = queue
    .then(() => runConvert(task, srcPath))
    .catch(err => { console.error('[converter] chain error', err) })
  return queue
}

// ============ 预热（OnlyOffice 无需预热） ============
export function warmupAll() {
  console.log(`[converter] OnlyOffice模式，无需预热`)
  return Promise.resolve()
}