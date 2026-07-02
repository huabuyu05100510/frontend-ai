/**
 * voice-kit gateway — Node.js service.
 *
 * Responsibilities:
 *   1. Sign upstream Volcengine WebSocket requests (keeps apiSecret server-side)
 *   2. Mint short-lived tokens for client SDKs
 *   3. Proxy ASR / TTS / Realtime WebSocket connections with header injection
 *   4. (Future) rate-limit, quota, audit log per appId
 *
 * Run: VK_DOUBAO_API_KEY=... pnpm dev
 */

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig, hasDoubao, describeDoubao } from './config.js';
import { mountAsrProxy } from './asr-proxy.js';

// Load .env if present (no external dep — keeps prod image small)
const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

async function main() {
  const config = loadConfig();
  const doubaoStatus = describeDoubao(config);
  if (!doubaoStatus.ok) {
    console.error(
      `[gateway] Doubao misconfigured — missing env: ${doubaoStatus.missing.join(', ')}. ` +
        `ASR proxy will reject connections with code 4401 until these are set.`
    );
  }
  console.log('[gateway] config loaded', {
    port: config.port,
    doubao: hasDoubao(config),
    doubaoMissing: doubaoStatus.missing,
    zhipu: Boolean(config.zhipu.apiKey),
    minimax: Boolean(config.minimax.apiKey),
  });

  const server = http.createServer((req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      const origin = req.headers.origin ?? '*';
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          providers: {
            doubao: hasDoubao(config),
            zhipu: Boolean(config.zhipu.apiKey),
            minimax: Boolean(config.minimax.apiKey),
          },
        })
      );
      return;
    }

    if (req.url === '/api/providers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          providers: [
            { id: 'doubao', available: hasDoubao(config), missing: doubaoStatus.missing },
            { id: 'zhipu', available: Boolean(config.zhipu.apiKey) },
            { id: 'minimax', available: Boolean(config.minimax.apiKey) },
          ],
        })
      );
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  // Mount ASR proxy at /api/asr/doubao
  mountAsrProxy(server, { config, path: '/api/asr/doubao' });

  server.listen(config.port, () => {
    console.log(`[gateway] listening on http://localhost:${config.port}`);
    console.log(`[gateway] ASR proxy mounted at ws://localhost:${config.port}/api/asr/doubao`);
  });
}

main().catch((err) => {
  console.error('[gateway] fatal:', err);
  process.exit(1);
});
