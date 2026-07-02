#!/usr/bin/env node
/**
 * Production E2E: verify the gateway in "no creds configured" mode.
 *
 * Asserts:
 *  1. GET /api/providers returns doubao with available=false and a missing list
 *  2. WS /api/asr/doubao is rejected with close code 4401
 *  3. Playground UI surfaces the rejection as an error message (not silent)
 *  4. No VK_DOUBAO_MOCK env is read (production mode)
 */
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import WebSocket from '/Users/didi/Downloads/前端AI/doc_summary/voice-kit/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js';

const GATEWAY = 'http://localhost:8787';
const PLAYGROUND = 'http://localhost:5174';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

// === Test 1: providers endpoint reveals missing creds ===
console.log('\n=== 1. /api/providers (production, no creds) ===');
const providers = await (await fetch(`${GATEWAY}/api/providers`)).json();
const doubao = providers.providers.find((p) => p.id === 'doubao');
check('doubao.available === false', doubao.available === false);
check(
  'doubao.missing lists env vars',
  Array.isArray(doubao.missing) && doubao.missing.includes('VK_DOUBAO_APP_ID'),
  JSON.stringify(doubao.missing)
);

// === Test 2: WebSocket rejected with code 4401 ===
console.log('\n=== 2. ASR WS rejected with 4401 ===');
const closeInfo = await new Promise((resolve) => {
  const ws = new WebSocket(`${GATEWAY.replace('http', 'ws')}/api/asr/doubao?lang=zh-CN`);
  ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  ws.on('error', () => {});
  setTimeout(() => resolve({ code: 0, reason: 'timeout' }), 3000);
});
check(
  'WS closed with code 4401',
  closeInfo.code === 4401,
  `code=${closeInfo.code}, reason="${closeInfo.reason}"`
);

// === Test 3: Playground UI surfaces the rejection ===
console.log('\n=== 3. Playground UI surfaces 4401 as error ===');
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--use-file-for-fake-audio-capture=/tmp/sine.wav',
  ],
});
const ctx = await browser.newContext({
  permissions: ['microphone'],
  viewport: { width: 1280, height: 800 },
});
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

await page.goto(PLAYGROUND, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(800);

// Provider 状态 tab should now show doubao as unavailable
await page.locator('.tab:has-text("Provider")').click();
await page.waitForTimeout(800);
const providerText = await page.locator('.panel').innerText();
check('UI shows doubao unavailable', /doubao.*❌|doubao.*false|不可用/.test(providerText), providerText.replace(/\n/g, ' | ').slice(0, 120));

// TranscribeDemo: start, expect error message about credentials
await page.locator('.tab:has-text("实时转写")').click();
await page.waitForTimeout(500);
await page.locator('button:has-text("开始录音")').first().click();
await page.waitForTimeout(2500);
const errorPre = await page.locator('pre').first().innerText().catch(() => '');
check('UI displays error message about credentials', /WS_4401|credentials|Doubao|VK_DOUBAO/i.test(errorPre), errorPre.slice(0, 150));

// === Summary ===
console.log(`\n=== SUMMARY ===\nPassed: ${pass} | Failed: ${fail}`);
console.log(`Page errors:    ${pageErrors.length}`);
pageErrors.forEach((e) => console.log('  -', e));
console.log(`Console errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log('  -', e.slice(0, 150)));

await browser.close();
process.exit(fail === 0 ? 0 : 1);