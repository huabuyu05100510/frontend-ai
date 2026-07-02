// Vitest 配置：Node 环境 + ESM
export default {
  test: {
    environment: 'node',
    include: ['test/**/*.test.mjs'],
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000
  }
}