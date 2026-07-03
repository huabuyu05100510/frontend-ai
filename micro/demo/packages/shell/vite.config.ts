import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: Number(process.env.SHELL_PORT) || 7180,
    proxy: {
      // 子应用走静态服务（同源前提下沙箱 fetch 才能工作）
      '/vue2-list': 'http://localhost:7182',
      '/jquery-form': 'http://localhost:7182',
      '/react-detail': 'http://localhost:7182',
      '/broken': 'http://localhost:7182',
      '/waterfall': 'http://localhost:7182',
      '/footer': 'http://localhost:7182',
      '/proxy': 'http://localhost:7182',
      '/mock-internal-sdk': 'http://localhost:7182',
      '/legacy': 'http://localhost:7183',
      '/api': 'http://localhost:7183',
    },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
})
