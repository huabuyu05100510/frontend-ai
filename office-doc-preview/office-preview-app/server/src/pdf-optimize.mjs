// PDF 优化：线性化（fast web view）
// 线性化后首页数据在文件开头、对象按页顺序排列 → pdf.js 流式顺序读取，
// 首屏秒开、滚动不再因随机 Range 回源而逐块闪动。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from './config.mjs'

const QPDF = process.env.QPDF || '/opt/homebrew/bin/qpdf'

// 线性化 src → dst，返回 dst
export function linearizePdf(src, dst) {
  return new Promise((resolve, reject) => {
    const tmp = dst + '.tmp'
    const child = spawn(QPDF, ['--linearize', '--object-streams=generate', src, tmp], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stderr = ''
    child.stderr.on('data', c => { stderr += c.toString() })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`qpdf exited ${code}: ${stderr.slice(0, 300)}`))
      // 原子重命名
      try { fs.renameSync(tmp, dst) } catch { /* dst==tmp 时 qpdf 已直接写 */ }
      resolve(dst)
    })
  })
}

// 判断是否线性化（避免重复处理）
export function isLinearized(filePath) {
  try {
    // 线性化 PDF 开头含 /Linearized 1
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(4096)
    fs.readSync(fd, buf, 0, 4096, 0)
    fs.closeSync(fd)
    return buf.toString('latin1').includes('/Linearized')
  } catch {
    return false
  }
}

// 幂等：确保 PDF 已线性化；未线性化则在 DERIVED_DIR 生成线性化副本并返回路径
export async function ensureLinearized(task, srcPath) {
  if (isLinearized(srcPath)) return srcPath
  const outDir = path.resolve(CONFIG.DERIVED_DIR, task.id)
  fs.mkdirSync(outDir, { recursive: true })
  const dst = path.join(outDir, task.name.replace(/\.[^.]+$/, '') + '.linear.pdf')
  if (fs.existsSync(dst)) return dst
  await linearizePdf(srcPath, dst)
  return dst
}
