import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5188,
    proxy: {
      '/api': { target: 'http://localhost:5180', changeOrigin: true }
    }
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false }
})
