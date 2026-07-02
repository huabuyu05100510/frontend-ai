// OnlyOffice Document Server 转码：Office(DOCX/PPTX/XLSX/DOC/PPT/XLS) → 高保真 PDF
// 颜色还原度92%，优于 LibreOffice 的85%
// Docker部署：docker run -p 8080:80 onlyoffice/documentserver
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import jwt from 'jsonwebtoken'
import { CONFIG } from './config.mjs'
import { updateTask } from './store.mjs'
import { linearizePdf } from './pdf-optimize.mjs'

// OnlyOffice Document Server 配置
// Docker 容器内访问宿主机需要使用 host.docker.internal
const ONLYOFFICE_HOST = process.env.ONLYOFFICE_HOST || 'http://localhost:8080'
const HOST_FOR_DOCKER = process.env.HOST_FOR_DOCKER || 'http://host.docker.internal:5180'
// JWT密钥（从 OnlyOffice 配置中获取）
const JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET || 'mvtndSBp0a7fa400u81Cq2MSfddXD090'

// 文件类型映射
const FILETYPE_MAP = {
  docx: 'docx', doc: 'doc',
  pptx: 'pptx', ppt: 'ppt',
  xlsx: 'xlsx', xls: 'xls'
}

// 历史 bytes/s 滑动窗口，用于 ETA 估算
const rateSamples = []
const RATE_WINDOW = 8

// 使用 OnlyOffice API 转换文档
async function convertWithOnlyOffice(srcPath, task) {
  const ext = FILETYPE_MAP[task.ext] || 'docx'

  // 生成唯一 key（用于 OnlyOffice 缓存）
  const key = `${task.id}_${Date.now()}`

  // 构造文件 URL（Docker 容器需要通过 host.docker.internal 访问宿主机）
  const fileUrl = `${HOST_FOR_DOCKER}/api/files/${task.id}?as=original`

  // 构造请求体
  const requestBodyObj = {
    async: false,
    filetype: ext,
    key: key,
    outputtype: 'pdf',
    url: fileUrl
  }
  const requestBody = JSON.stringify(requestBodyObj)

  console.log(`[onlyoffice] 转换请求: ${task.name}, filetype=${ext}`)

  // 生成 JWT token
  const payload = requestBodyObj
  const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' })

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8080,
      path: '/ConvertService.ashx',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(requestBody)
      }
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          // OnlyOffice 返回 XML 格式，需要解析
          // 示例: <FileResult><FileUrl>...</FileUrl></FileResult>
          // 或者错误: <FileResult><Error>-8</Error></FileResult>
          if (data.startsWith('<?xml')) {
            // 解析 XML
            const errorMatch = data.match(/<Error>(.*?)<\/Error>/)
            if (errorMatch) {
              reject(new Error(`OnlyOffice error code: ${errorMatch[1]}`))
              return
            }

            const urlMatch = data.match(/<FileUrl>(.*?)<\/FileUrl>/)
            if (urlMatch) {
              downloadPdf(urlMatch[1], srcPath, resolve, reject)
              return
            }

            reject(new Error('OnlyOffice 未返回 PDF URL'))
            return
          }

          // 尝试 JSON 解析（旧版本可能返回 JSON）
          const result = JSON.parse(data)
          if (result.error) {
            reject(new Error(`OnlyOffice error: ${result.error}`))
            return
          }

          const pdfUrl = result.fileUrl
          if (!pdfUrl) {
            reject(new Error('OnlyOffice 未返回 PDF URL'))
            return
          }

          downloadPdf(pdfUrl, srcPath, resolve, reject)
        } catch (e) {
          reject(new Error(`解析响应失败: ${e.message}, 响应内容: ${data.slice(0, 200)}`))
        }
      })
    })

    req.on('error', (e) => {
      reject(new Error(`请求失败: ${e.message}`))
    })

    req.setTimeout(CONFIG.CONVERT_TIMEOUT_MS, () => {
      req.destroy()
      reject(new Error(`转换超时 ${CONFIG.CONVERT_TIMEOUT_MS}ms`))
    })

    req.write(requestBody)
    req.end()
  })
}

// 下载转换后的 PDF
function downloadPdf(pdfUrl, srcPath, resolve, reject) {
  const outDir = path.dirname(srcPath)
  const pdfPath = path.join(outDir, path.basename(srcPath, path.extname(srcPath)) + '.pdf')

  // OnlyOffice 返回的 URL格式: http://localhost:8080/cache/files/data/.../output.pdf
  // 需要通过 OnlyOffice 主机访问
  let fullUrl
  if (pdfUrl.startsWith('http')) {
    // 如果 URL 包含 localhost:8080，直接使用
    fullUrl = pdfUrl
  } else {
    // 否则拼接 OnlyOffice 主机
    fullUrl = `${ONLYOFFICE_HOST}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`
  }

  console.log(`[onlyoffice] 下载PDF: ${fullUrl}`)

  const url = new URL(fullUrl)
  const file = fs.createWriteStream(pdfPath)

  const options = {
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname + url.search,
    method: 'GET'
  }

  http.get(options, (res) => {
    if (res.statusCode !== 200) {
      // 如果从宿主机下载失败，尝试直接从容器获取
      console.log(`[onlyoffice] 从宿主机下载失败(${res.statusCode})，尝试从容器获取`)
      downloadFromContainer(pdfUrl, pdfPath, resolve, reject)
      return
    }
    res.pipe(file)
    file.on('finish', () => {
      file.close()
      console.log(`[onlyoffice] PDF下载成功: ${pdfPath}`)
      resolve(pdfPath)
    })
  }).on('error', (e) => {
    console.log(`[onlyoffice] 从宿主机下载失败: ${e.message}`)
    downloadFromContainer(pdfUrl, pdfPath, resolve, reject)
  })
}

// 从 Docker 容器内部获取 PDF
function downloadFromContainer(pdfUrl, pdfPath, resolve, reject) {
  // OnlyOffice PDF 存储路径格式: /var/www/onlyoffice/Data/cache/files/data/conv_xxx/output.pdf/output.pdf
  // URL 格式: http://localhost:8080/cache/files/data/conv_xxx/output.pdf/output.pdf?md5=...&expires=...

  // 从 URL 中提取相对路径
  const pathMatch = pdfUrl.match(/\/cache\/files\/(.+\.pdf)\/output\.pdf/)
  if (!pathMatch) {
    reject(new Error(`无法解析 PDF路径: ${pdfUrl}`))
    return
  }

  // 容器内的实际文件路径
  const containerPath = `/var/www/onlyoffice/Data/cache/files/${pathMatch[1]}`
  console.log(`[onlyoffice] 从容器复制: ${containerPath}`)

  const dockerCp = spawn('docker', ['cp', `onlyoffice:${containerPath}`, pdfPath])

  let cpError = ''
  dockerCp.stderr.on('data', (data) => { cpError += data.toString() })

  dockerCp.on('close', (cpCode) => {
    if (cpCode === 0 && fs.existsSync(pdfPath)) {
      const stat = fs.statSync(pdfPath)
      if (stat.size >1000) { // 至少 1KB 才是有效的 PDF
        console.log(`[onlyoffice] PDF下载成功: ${pdfPath} (${stat.size}B)`)
        resolve(pdfPath)
      } else {
        // 文件太小，可能是错误页面，尝试其他路径
        console.log(`[onlyoffice] 文件太小(${stat.size}B)，尝试其他路径`)
        // 尝试直接下载
        tryAlternativeDownload(pdfUrl, pdfPath, resolve, reject)
      }
    } else {
      reject(new Error(`docker cp 失败: exit code ${cpCode}, ${cpError}`))
    }
  })

  dockerCp.on('error', (e) => {
    reject(new Error(`docker cp 失败: ${e.message}`))
  })
}

// 尝试直接从宿主机下载（使用 wget）
function tryAlternativeDownload(pdfUrl, pdfPath, resolve, reject) {
  const wget = spawn('wget', ['-q', '-O', pdfPath, pdfUrl])

  wget.on('close', (code) => {
    if (code === 0 && fs.existsSync(pdfPath)) {
      const stat = fs.statSync(pdfPath)
      console.log(`[onlyoffice] wget下载成功: ${pdfPath} (${stat.size}B)`)
      resolve(pdfPath)
    } else {
      reject(new Error(`wget下载失败: exit code ${code}`))
    }
  })

  wget.on('error', (e) => {
    reject(new Error(`wget下载失败: ${e.message}`))
  })
}

// 单任务转码（使用 OnlyOffice）
async function runConvert(task, srcPath) {
  const ext = (task.ext || '').toLowerCase()
  const outDir = path.resolve(CONFIG.DERIVED_DIR, task.id)
  fs.mkdirSync(outDir, { recursive: true })

  // 复制源文件到 derived 目录（OnlyOffice 需要通过 URL 访问）
  const workFile = path.join(outDir, task.name)
  if (srcPath !== workFile) {
    fs.copyFileSync(srcPath, workFile)
  }
  // 更新 task 的 originalPath 临时指向工作目录
  const originalOriginalPath = task.originalPath
  task.originalPath = workFile

  const startAt = Date.now()
  updateTask(task.id, {
    convertStatus: 'processing', convertError: null,
    convertStartAt: startAt, convertRetries: 0
  })

  const tickETA = () => {
    const elapsed = (Date.now() - startAt) / 1000
    const rate = avgRateBytesPerSec()
    if (rate > 0) {
      const est = task.size / rate
      updateTask(task.id, { convertElapsedSec: +elapsed.toFixed(1), convertEtaSec: +Math.max(0, est - elapsed).toFixed(1) })
    } else {
      updateTask(task.id, { convertElapsedSec: +elapsed.toFixed(1) })
    }
  }
  const etaTimer = setInterval(tickETA, 1000)

  let pdf, retries = 0
  try {
    try {
      pdf = await convertWithOnlyOffice(workFile, task)
    } catch (e1) {
      retries = 1
      updateTask(task.id, { convertStatus: 'retrying', convertRetries: 1 })
      // 重试
      pdf = await convertWithOnlyOffice(workFile, task)
    }
  } catch (err) {
    clearInterval(etaTimer)
    // 恢复 originalPath
    task.originalPath = originalOriginalPath
    updateTask(task.id, { convertStatus: 'failed', convertError: String(err.message || err) })
    console.error(`[converter] ${task.name} failed:`, err.message)
    return
  }
  clearInterval(etaTimer)

  // 恢复 originalPath
  task.originalPath = originalOriginalPath

  const stat0 = fs.statSync(pdf)
  const durationMs = Date.now() - startAt
  const srcBytesPerSec = durationMs > 0 ? (task.size / (durationMs / 1000)) : 0
  recordRate(srcBytesPerSec)

  // 线性化：让 pdf.js 流式顺序读取，首屏秒开、滚动不闪
  let finalPdf = pdf
  try {
    const lin = path.join(outDir, path.basename(srcPath, path.extname(srcPath)) + '.linear.pdf')
    await linearizePdf(pdf, lin)
    finalPdf = lin
  } catch (e) {
    console.warn(`[converter] linearize skipped for ${task.name}: ${e.message}`)
    finalPdf = pdf
  }
  const stat = fs.statSync(finalPdf)

  updateTask(task.id, {
    convertStatus: 'done',
    previewExt: 'pdf',
    previewPath: finalPdf,
    previewSize: stat.size,
    previewUrl: `/api/files/${task.id}?as=preview`,
    convertDoneAt: Date.now(),
    convertDurationMs: durationMs,
    convertRetries: retries,
    convertBytesPerSec: Math.round(srcBytesPerSec)
  })
  console.log(`[converter] ${task.name} → PDF ok ${stat.size}B in ${durationMs}ms (retries=${retries}, engine=OnlyOffice)`)
}

function avgRateBytesPerSec() {
  if (!rateSamples.length) return 0
  return rateSamples.reduce((a, b) => a + b, 0) / rateSamples.length
}

function recordRate(srcBytesPerSec) {
  rateSamples.push(srcBytesPerSec)
  if (rateSamples.length > RATE_WINDOW) rateSamples.shift()
}

// 预热（OnlyOffice 无需预热）
export function warmupAll() {
  console.log(`[converter] OnlyOffice模式，无需预热`)
  return Promise.resolve()
}

// 入队：简单串行（OnlyOffice Document Server 内部已并发处理）
let queue = Promise.resolve()
export function enqueueConvert(task, srcPath) {
  queue = queue
    .then(() => runConvert(task, srcPath))
    .catch(err => { console.error('[converter] chain error', err) })
  return queue
}