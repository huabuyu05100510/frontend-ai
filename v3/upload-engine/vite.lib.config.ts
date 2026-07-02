import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 库构建：产出 ESM；React 作为外部依赖不打包。
// 类型声明由 `tsc -p tsconfig.lib.json` 先行生成到 dist。
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: false, // 保留 tsc 生成的 .d.ts
    lib: {
      entry: {
        index: 'src/index.ts',
        react: 'src/react.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
})
