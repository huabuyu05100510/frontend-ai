import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@skeleton/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@skeleton/adapter-web': resolve(__dirname, 'packages/adapter-web/src/index.ts'),
      '@skeleton/renderer-taro': resolve(__dirname, 'packages/renderer-taro/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    environmentOptions: {
      jsdom: { url: 'http://localhost' },
    },
    include: ['packages/**/src/__tests__/**/*.test.ts', 'packages/**/src/__tests__/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/**/src/**/*.ts', 'packages/**/src/**/*.tsx'],
      exclude: ['packages/**/src/__tests__/**', 'packages/**/src/index.ts'],
    },
  },
})
