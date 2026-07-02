import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['mupdf'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/kernel/**', 'src/pipeline/**', 'src/edit/**', 'src/collab/**'],
      thresholds: { lines: 85, functions: 85, branches: 75 },
    },
  },
})
