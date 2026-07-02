/**
 * ASR WebSocket proxy — accepts client WS, opens upstream Volcengine WSS with
 * signed headers, and bidirectionally pipes binary frames.
 *
 * The client speaks the same v3/sauc binary protocol as Volcengine; the gateway
 * is a transparent bytes pipe with header injection.
 *
 * Required env: VK_DOUBAO_APP_ID + (VK_DOUBAO_API_KEY | VK_DOUBAO_ACCESS_TOKEN).
 * When credentials are missing, the proxy rejects the client with code 4401 so
 * failures are surfaced immediately instead of silently accepting zero frames.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { GatewayConfig } from './config.js';
import { buildAuthHeaders } from '@voice-kit/provider-doubao';

export interface AsrProxyOptions {
  config: GatewayConfig;
  /** Path to mount on the HTTP server, e.g. '/api/asr/doubao' */
  path: string;
}

const CLOSE_MISSING_CREDENTIALS = 4401;
const CLOSE_UPSTREAM_UNAVAILABLE = 4402;

export function mountAsrProxy(server: import('http').Server | import('https').Server, opts: AsrProxyOptions): WebSocketServer {
  const wss = new WebSocketServer({ server, path: opts.path });

  wss.on('connection', (client: WebSocket, req) => {
    if (!opts.config.doubao.apiKey && !opts.config.doubao.accessToken) {
      console.warn('[asr-proxy] rejecting', req.url, '— Doubao credentials not configured');
      try {
        client.close(CLOSE_MISSING_CREDENTIALS, 'Doubao credentials not configured');
      } catch {
        /* socket already gone */
      }
      return;
    }

    const headers = buildAuthHeaders({
      appId: opts.config.doubao.appId,
      apiKey: opts.config.doubao.apiKey,
      accessToken: opts.config.doubao.accessToken,
      resourceId: opts.config.doubao.resourceId,
    });

    // Volcengine handshake headers (ws lib supports per-connection headers)
    const upstreamHeaders: Record<string, string> = {
      ...headers,
      'X-Api-App-Id': opts.config.doubao.appId ?? '',
      'X-Api-Request-Id': crypto.randomUUID(),
      'X-Api-Connect-Id': crypto.randomUUID(),
      'X-Api-Sequence': '-1',
    };

    const upstream = new WebSocket(opts.config.doubao.asrEndpoint, {
      headers: upstreamHeaders,
    });
    upstream.binaryType = 'arraybuffer';

    // Surface HTTP upgrade error body so 4xx responses aren't silently 4402
    (upstream as unknown as { on: (e: string, h: (...a: unknown[]) => void) => void }).on(
      'unexpected-response',
      (_req: unknown, res: import('http').IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          console.error(
            `[asr-proxy] upstream HTTP ${res.statusCode} ${res.statusMessage}: ${body.slice(0, 500)}`
          );
          console.error('[asr-proxy] sent headers:', upstreamHeaders);
        });
      }
    );

    let upstreamOpen = false;
    const pendingFromClient: ArrayBuffer[] = [];

    upstream.on('open', () => {
      upstreamOpen = true;
      for (const buf of pendingFromClient) {
        upstream.send(buf);
      }
      pendingFromClient.length = 0;
    });

    upstream.on('message', (data) => {
      // TEMP: log speaker fields for bigmodel verification
      try {
        const view = new Uint8Array(data as ArrayBuffer);
        if (view.length >= 8) {
          const flags = view[1] & 0x0f;
          let offset = 4;
          if (flags & 0x01) offset += 4;
          if (view.length >= offset + 4) {
            const dv = new DataView(view.buffer, view.byteOffset);
            const size = dv.getUint32(offset);
            offset += 4;
            const body = new TextDecoder().decode(view.subarray(offset, Math.min(offset + size, view.length)));
            // Extract every speaker_id occurrence
            const speakers = [...body.matchAll(/"speaker_id":"([^"]+)"/g)].map((m) => m[1]);
            if (speakers.length > 0) {
              console.log(`[upstream-speakers] count=${speakers.length} ids=${JSON.stringify(speakers)}`);
            } else {
              console.log(`[upstream] size=${size} body=${body.slice(0, 200)}`);
            }
          }
        }
      } catch (e) {
        console.log('[upstream] log error:', (e as Error).message);
      }
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });

    upstream.on('close', (code, reason) => {
      try {
        client.close(code, reason.toString());
      } catch {
        /* ignore */
      }
    });

    upstream.on('error', (err) => {
      console.error('[asr-proxy] upstream error:', err.message);
      try {
        client.close(CLOSE_UPSTREAM_UNAVAILABLE, 'Upstream error');
      } catch {
        /* ignore */
      }
    });

    client.on('message', (data) => {
      if (typeof data === 'string') return; // ignore text frames
      const buf = data as Buffer;
      if (upstreamOpen) {
        upstream.send(buf);
      } else {
        // Copy into a fresh ArrayBuffer so the pending queue type matches
        // ws.send()'s expected ArrayBuffer (not SharedArrayBuffer).
        const ab = new ArrayBuffer(buf.byteLength);
        new Uint8Array(ab).set(buf);
        pendingFromClient.push(ab);
      }
    });

    client.on('close', () => {
      try {
        upstream.close();
      } catch {
        /* ignore */
      }
    });

    client.on('error', () => {
      try {
        upstream.close();
      } catch {
        /* ignore */
      }
    });
  });

  return wss;
}