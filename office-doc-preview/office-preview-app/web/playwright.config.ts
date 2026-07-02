import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testIgnore: /smoke\.spec\.ts$/,  // smoke.spec.ts is for ad-hoc verification; not in CI matrix
  fullyParallel: false,        // 单进程跑，避免本地端口冲突
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // Phase D: translate/image specs need longer timeout (OCR + translate + UI render).
  // Default 30s isn't enough for image OCR mock + bbox render.
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // P3.A: Visual regression suite — 9 viewports × 2 themes × 7 pages = 126 snapshots.
    //   Per-test viewport is set inside the spec via newContext().
    //   60s timeout accommodates slow first-paint with PDFium WASM warmup.
    //   Threshold maxDiffPixelRatio: 0.005 is enforced inside toHaveScreenshot().
    {
      name: 'design-regression',
      testMatch: /design-regression\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
      timeout: 60_000,
      expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.005 } },
    }
  ],
  webServer: [
    {
      command: 'cd ../server && ONLYOFFICE_HOST=http://localhost:8080 ONLYOFFICE_JWT_SECRET=mvtndSBp0a7fa400u81Cq2MSfddXD090 HOST_FOR_DOCKER=http://host.docker.internal:5180 node src/index.mjs',
      url: 'http://localhost:5180/api/health',
      reuseExistingServer: true,
      timeout: 15_000,
      stdout: 'pipe',
      stderr: 'pipe'
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5188',
      reuseExistingServer: true,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe'
    }
  ]
})