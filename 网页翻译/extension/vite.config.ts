import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'
import { writeFileSync, copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

// 热重载插件：每次 build 写入新时间戳到 dist/hotreload.txt
// background 轮询该文件，变化时调用 chrome.runtime.reload()
function hotReload() {
  let count = 0
  return {
    name: 'hot-reload-trigger',
    writeBundle() {
      count++
      writeFileSync('./dist/hotreload.txt', `${Date.now()}-${count}\n`)
    },
  }
}

// 拷贝 lib/*.mjs 到 dist/lib/，让 background 的 dynamic import 能解析到 annotation-store
function copyLib() {
  function copyDir(srcDir: string, dstDir: string) {
    mkdirSync(dstDir, { recursive: true })
    for (const name of readdirSync(srcDir)) {
      const s = resolve(srcDir, name)
      const d = resolve(dstDir, name)
      if (statSync(s).isDirectory()) copyDir(s, d)
      else copyFileSync(s, d)
    }
  }
  return {
    name: 'copy-lib',
    closeBundle() {
      copyDir(resolve(__dirname, '../lib'), resolve(__dirname, 'dist/lib'))
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
    hotReload(),
    copyLib(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    // e2e 脚本使用 playwright + process.exit，不是 vitest test；在此排除
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'test/e2e/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
    },
  },
})
