import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * pdfiumWasmPlugin
 * ---------------
 * 拦截 `@hyzyla/pdfium/browser/base64` 入口中的动态导入
 *   `import('./pdfium.wasm.base64-B4io7kt4.js')`
 * 默认情况下，Vite 不知道这个相对路径（hash 后缀）来自哪个模块，因此解析失败 → wasm 加载失败 → canvas 透明。
 *
 * 本插件在 resolveId 阶段：
 *   1. 识别 id 形如 `pdfium.wasm.base64-*.js` 或带 `./pdfium.wasm.base64-*.js` 前缀；
 *   2. 把它映射到 node_modules/@hyzyla/pdfium/dist/pdfium.wasm.base64-*.js 物理文件；
 *   3. 通过 load() 读取文件内容并原样返回（base64 字符串已在文件内嵌好）。
 */
function pdfiumWasmPlugin(): Plugin {
  const PLACEHOLDER_RE = /^.*?pdfium\.wasm\.base64-[A-Za-z0-9_-]+\.js$/
  let resolvedPath: string | null = null

  return {
    name: 'pdfium-wasm-fix',
    enforce: 'pre',
    resolveId(id) {
      if (PLACEHOLDER_RE.test(id)) {
        if (!resolvedPath) {
          const distDir = path.resolve(
            __dirname,
            'node_modules/@hyzyla/pdfium/dist'
          )
          if (!fs.existsSync(distDir)) {
            this.warn('[pdfium-wasm-fix] dist 目录不存在：' + distDir)
            return null
          }
          const files = fs.readdirSync(distDir)
          const match = files.find(f => f.startsWith('pdfium.wasm.base64-') && f.endsWith('.js'))
          if (!match) {
            this.warn('[pdfium-wasm-fix] 未找到 pdfium.wasm.base64-*.js 占位文件')
            return null
          }
          resolvedPath = path.join(distDir, match)
          this.warn('[pdfium-wasm-fix] 解析占位模块 → ' + resolvedPath)
        }
        return '\0pdfium-wasm-base64:' + resolvedPath
      }
      return null
    },
    load(id) {
      if (id.startsWith('\0pdfium-wasm-base64:')) {
        const fp = id.slice('\0pdfium-wasm-base64:'.length)
        return fs.readFileSync(fp, 'utf-8')
      }
      return null
    }
  }
}

export default defineConfig({
  plugins: [react(), pdfiumWasmPlugin()],
  server: {
    port: 5188,
    proxy: {
      '/api': { target: 'http://localhost:5180', changeOrigin: true }
    },
    // 关键：开发模式下不放 COOP/COEP，避免 Vite HMR / WebSocket 跨域问题。
    // WASM 模式需要的 crossOriginIsolated 由 PreviewModal 给出提示，
    // 生产环境需要时再通过部署层单独设置跨源隔离头。
    headers: {}
  },
  optimizeDeps: {
    // 关键：不要让 Vite 预先打包 @hyzyla/pdfium，
    // 否则 esbuild 会跳过我们的 resolveId 钩子，吞掉占位模块解析
    exclude: ['@hyzyla/pdfium', '@hyzyla/pdfium/browser/base64']
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      // 把 pdfium WASM 包拆成独立 chunk，避免主 bundle 体积膨胀
      output: {
        manualChunks(id) {
          if (id.includes('@hyzyla/pdfium')) return 'pdfium-wasm'
          if (id.includes('pdfjs-dist')) return 'pdfjs'
          if (id.includes('node_modules/motion') || id.includes('node_modules\\motion')) return 'motion'
          if (id.includes('framer-motion')) return 'motion'
          return undefined
        }
      }
    }
  }
})