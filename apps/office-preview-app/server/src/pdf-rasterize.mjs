// 服务端逐页栅格化为图片：让大/复杂 PDF 在浏览器里直接显示 <img>，
// 而非 pdf.js 现场栅格化（含 7713px 大图的页 pdf.js 要 15s，服务端一次性渲染后浏览器零成本）。
// 用 pdftoppm（poppler，已装）批量渲染，产物按页号 + 分辨率命名。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from './config.mjs'

const PDFTOPPM = process.env.PDFTOPPM || '/opt/homebrew/bin/pdftoppm'
const PDFINFO = process.env.PDFINFO || '/opt/homebrew/bin/pdfinfo'

// 获取页数
export function getPdfPageCount(filePath) {
  return new Promise((resolve, reject) => {
    const c = spawn(PDFINFO, [filePath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    c.stdout.on('data', d => { out += d.toString() })
    c.on('close', () => {
      const m = out.match(/^Pages:\s+(\d+)/m)
      resolve(m ? Number(m[1]) : 0)
    })
    c.on('error', reject)
  })
}

// 批量渲染 [from, to] 页为 PNG（分辨率 dpi），产物命名 <prefix>-NNN.png
// 返回生成的文件路径数组
export function rasterizePages(filePath, from, to, dpi, outDir, prefix) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outDir, { recursive: true })
    const args = ['-png', '-r', String(dpi), '-f', String(from), '-l', String(to), filePath, path.join(outDir, prefix)]
    const c = spawn(PDFTOPPM, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    c.stderr.on('data', d => { err += d.toString() })
    c.on('error', reject)
    c.on('close', code => {
      if (code !== 0) return reject(new Error(`pdftoppm exited ${code}: ${err.slice(0,300)}`))
      // 收集产物
      const padLen = String(to).length
      const files = []
      for (let p = from; p <= to; p++) {
        const fn = `${prefix}-${String(p).padStart(padLen < 3 ? 3 : padLen, '0')}.png`
        // pdftoppm 默认补零到 2 位，大文档可能 3 位；两种都试
        const candidates = [
          path.join(outDir, `${prefix}-${String(p).padStart(2,'0')}.png`),
          path.join(outDir, `${prefix}-${String(p).padStart(3,'0')}.png`),
          path.join(outDir, fn)
        ]
        const f = candidates.find(c => fs.existsSync(c))
        if (f) files.push({ page: p, file: f })
      }
      resolve(files)
    })
  })
}
