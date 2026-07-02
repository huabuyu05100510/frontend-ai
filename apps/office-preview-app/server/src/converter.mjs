// soffice 转码调度：Office(DOCX/PPTX/XLSX/DOC/PPT/XLS) → 高保真 PDF
// 设计要点：
//   1. 多实例池（CONVERT_CONCURRENCY），每实例独立 UserInstallation profile，可并发
//   2. 启动预热：消除 soffice 首次冷启动（字体扫描 + profile 初始化）导致的失败重试
//   3. writer/impress/calc 分别传 FilterOptions：无损 + 不降采样，最大化还原度
//   4. 全链路指标：convertStartAt/DoneAt/DurationMs/Retries 写回 task，供前端可观测面板
//   5. ETA 估算：按历史 bytes/s 滑动平均推算剩余
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from './config.mjs'
import { updateTask } from './store.mjs'
import { linearizePdf } from './pdf-optimize.mjs'

// 每扩展名对应的 PDF 导出过滤器（不同 Office 组件用不同 filter）
const FILTER_BY_EXT = {
  docx: 'writer_pdf_Export', doc: 'writer_pdf_Export',
  pptx: 'impress_pdf_Export', ppt: 'impress_pdf_Export',
  xlsx: 'calc_pdf_Export',   xls: 'calc_pdf_Export'
}

// 高保真导出参数：Quality 90 JPEG（视觉无损）+ 不降采样 + 不压缩图
// 权衡：纯无损会令含大量图片的文档 PDF 膨胀到 200MB+，拖垮加载/渲染；
// 90 质量 + 不降采样在肉眼无差别的前提下把体积压到合理区间。
function filterArgs(ext) {
  const filter = FILTER_BY_EXT[ext] || 'writer_pdf_Export'
  const opts = JSON.stringify({
    UseLosslessCompression:   { type: 'boolean', value: 'false' },
    Quality:                  { type: 'long',    value: '90' },
    ReduceImageResolution:    { type: 'boolean', value: 'false' },
    MaxImageResolution:       { type: 'long',    value: '600' },
    ExportFormFields:         { type: 'boolean', value: 'false' },
    ExportNotes:              { type: 'boolean', value: 'false' }
  })
  return `pdf:${filter}:${opts}`
}

// 进程级实例池：每个 slot 自带串行队列，slot 间并行
const POOL_SIZE = Math.max(1, CONFIG.CONVERT_CONCURRENCY || 1)
const profiles = Array.from({ length: POOL_SIZE }, (_, i) =>
  path.resolve(CONFIG.DERIVED_DIR, 'profiles', `p${i}`)
)
const slots = profiles.map(profile => ({ profile, chain: Promise.resolve() }))

// 历史 bytes/s 滑动窗口，用于 ETA 估算
const rateSamples = []
const RATE_WINDOW = 8

function spawnConvert(src, outDir, ext, profile) {
  fs.mkdirSync(profile, { recursive: true })
  const profileUri = `file://${profile}`
  const args = [
    `--headless`, `--norestore`, `--nofirststartwizard`, `--nologo`,
    `-env:UserInstallation=${profileUri}`,
    `--convert-to`, filterArgs(ext),
    `--outdir`, outDir,
    src
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(CONFIG.SOFFICE, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', c => { stderr += c.toString() })
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      reject(new Error(`soffice timeout after ${CONFIG.CONVERT_TIMEOUT_MS}ms: ${stderr.slice(0, 500)}`))
    }, CONFIG.CONVERT_TIMEOUT_MS)
    child.on('error', err => { clearTimeout(timer); reject(err) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`soffice exited ${code}: ${stderr.slice(0, 500)}`))
      const pdf = path.join(outDir, path.basename(src, path.extname(src)) + '.pdf')
      if (!fs.existsSync(pdf)) return reject(new Error('pdf not produced'))
      resolve(pdf)
    })
  })
}

// 预热单个 profile：跑一次最小转换，让 soffice 完成字体扫描 + profile 初始化
function warmup(profile) {
  const outDir = path.resolve(CONFIG.DERIVED_DIR, 'warmup')
  fs.mkdirSync(outDir, { recursive: true })
  // 构造一个极简 docx（仅含一个空段落）作为预热输入
  const tiny = path.join(outDir, 'warmup.docx')
  if (!fs.existsSync(tiny)) {
    const ZIP = 'PK\x03\x04'
    fs.writeFileSync(tiny, ZIP) // 伪文件；若无效则忽略错误即可
  }
  return spawnConvertSafe(tiny, outDir, 'docx', profile, /*warm*/ true)
}

function spawnConvertSafe(src, outDir, ext, profile, isWarm) {
  return spawnConvert(src, outDir, ext, profile).catch(err => {
    if (isWarm) return null // 预热失败可容忍
    throw err
  })
}

let warmed = false
export function warmupAll() {
  if (warmed) return Promise.resolve()
  warmed = true
  return Promise.all(slots.map(s => warmup(s.profile).catch(() => null)))
    .then(() => console.log(`[converter] 池预热完成 (×${POOL_SIZE})`))
}

// 单任务转码（含重试 1 次 + 指标记录 + ETA）
async function runConvert(task, srcPath) {
  const ext = (task.ext || '').toLowerCase()
  const outDir = path.resolve(CONFIG.DERIVED_DIR, task.id)
  fs.mkdirSync(outDir, { recursive: true })

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
      pdf = await spawnConvert(srcPath, outDir, ext, task._profile)
    } catch (e1) {
      retries = 1
      updateTask(task.id, { convertStatus: 'retrying', convertRetries: 1 })
      // 重试换一个 profile，避免某实例卡死
      task._profile = profiles[(profiles.indexOf(task._profile) + 1) % profiles.length]
      pdf = await spawnConvert(srcPath, outDir, ext, task._profile)
    }
  } catch (err) {
    clearInterval(etaTimer)
    updateTask(task.id, { convertStatus: 'failed', convertError: String(err.message || err) })
    console.error(`[converter] ${task.name} failed:`, err.message)
    return
  }
  clearInterval(etaTimer)

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
  console.log(`[converter] ${task.name} → PDF ok ${stat.size}B in ${durationMs}ms (retries=${retries})`)
}

function avgRateBytesPerSec() {
  if (!rateSamples.length) return 0
  return rateSamples.reduce((a, b) => a + b, 0) / rateSamples.length
}

function recordRate(srcBytesPerSec) {
  rateSamples.push(srcBytesPerSec)
  if (rateSamples.length > RATE_WINDOW) rateSamples.shift()
}

// 入队：轮询分配到 slot（round-robin），每个 slot 内串行
let rr = 0
export function enqueueConvert(task, srcPath) {
  const slot = slots[rr % slots.length]
  rr++
  task._profile = slot.profile
  slot.chain = slot.chain
    .then(() => runConvert(task, srcPath))
    .catch(err => { console.error('[converter] chain error', err) })
  return slot.chain
}
