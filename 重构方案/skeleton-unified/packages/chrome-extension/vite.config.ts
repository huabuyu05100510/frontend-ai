import { defineConfig } from 'vite'
import { resolve } from 'path'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import type { IncomingMessage } from 'http'
import zlib from 'zlib'
import crypto from 'crypto'

/** 生成一个 size×size 纯色 PNG（不依赖外部库） */
function makePNG(size: number, r: number, g: number, b: number): Buffer {
  function crc32(buf: Buffer): number {
    let crc = 0xffffffff
    const table: number[] = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
    for (const byte of buf) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
  }
  function chunk(name: string, data: Buffer): Buffer {
    const n = Buffer.from(name)
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([n, data])))
    return Buffer.concat([len, n, data, crc])
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.alloc(1 + size * 3)
  for (let x = 0; x < size; x++) { row[1 + x * 3] = r; row[1 + x * 3 + 1] = g; row[1 + x * 3 + 2] = b }
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ─── 热重载 server ──────────────────────────────────────────────────
// service worker 轮询此端口，检测到 hash 变更后自动 chrome.runtime.reload()
let reloadHash = ''
const RELOAD_PORT = 7779

// 只在首次 buildStart 启动 server（避免 --watch 模式下重复启动）
let serverStarted = false
function ensureReloadServer() {
  if (serverStarted) return
  serverStarted = true
  const srv = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ hash: reloadHash }))
  })
  srv.listen(RELOAD_PORT, () => {
    console.log(`[skeleton-ext] 热重载端口: ${RELOAD_PORT}`)
  })
}

// ─── Vite 配置 ──────────────────────────────────────────────────────

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content.ts'),
        background: resolve(__dirname, 'src/background.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        inlineDynamicImports: false,
      },
    },
    minify: false,
  },
  plugins: [
    {
      name: 'skeleton-extension-hot-reload',
      buildStart() {
        ensureReloadServer()
      },
      closeBundle() {
        const distDir = resolve(__dirname, 'dist')
        if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

        copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(distDir, 'manifest.json'),
        )

        const iconsDir = resolve(distDir, 'icons')
        if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true })
        for (const size of [16, 48, 128]) {
          writeFileSync(resolve(iconsDir, `icon${size}.png`), makePNG(size, 22, 119, 255))
        }

        // 更新 hash → service worker 检测到后自动 reload
        reloadHash = crypto.createHash('md5').update(Date.now().toString()).digest('hex').slice(0, 8)
        console.log(`[skeleton-ext] ✓ dist/  (hash=${reloadHash})`)
      },
    },
  ],
})
