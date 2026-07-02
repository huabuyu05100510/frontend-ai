/**
 * Doubao / 火山引擎 HMAC-SHA256 signature builder.
 *
 * Auth quirk: `Authorization: Bearer; <token>` uses a SEMICOLON (Volcengine-wide).
 * New console (single header): X-Api-Key.
 * Legacy console (dual header): X-Api-App-Key + X-Api-Access-Key.
 *
 * Browser caveat: WebSocket cannot set custom headers. Auth is passed via
 * query string or sub-protocol. Use the gateway (apps/gateway) to sign on
 * behalf of the client to avoid leaking secrets.
 */

export interface DoubaoCredentials {
  appId?: string;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  resourceId?: string;
  endpoint?: string;
}

export interface DoubaoAuthHeaders {
  'X-Api-App-Key'?: string;
  'X-Api-Access-Key'?: string;
  'X-Api-Key'?: string;
  'X-Api-Resource-Id'?: string;
  Authorization: string; // always present, "Bearer; <token>"
}

/**
 * Build the headers for a Volcengine WebSocket handshake.
 *
 * Volcengine v3 accepts multiple auth shapes; we emit ALL plausible headers so
 * any console variant (legacy dual-header, new X-Api-Key, or simple Bearer)
 * finds one it recognizes. Redundant headers are harmless; missing one yields 400.
 */
export function buildAuthHeaders(creds: DoubaoCredentials): DoubaoAuthHeaders {
  const headers: DoubaoAuthHeaders = {
    Authorization: `Bearer; ${creds.accessToken ?? ''}`,
  };
  // Resource id — Volcengine accepts either spelling depending on console version
  if (creds.resourceId) {
    headers['X-Api-Resource-Id'] = creds.resourceId;
    (headers as Record<string, string>)['Resource-Id'] = creds.resourceId;
  }
  if (creds.apiKey) {
    // New console: single API key header
    headers['X-Api-Key'] = creds.apiKey;
  }
  // Legacy console: dual header — emit whenever we have appId+accessToken so
  // older deployments work too. Harmless if the upstream ignores it.
  if (creds.appId && creds.accessToken) {
    headers['X-Api-App-Key'] = creds.appId;
    headers['X-Api-Access-Key'] = creds.accessToken;
  }
  return headers;
}

/**
 * Build a query-string form of the headers (for browser WebSocket which cannot
 * set custom headers). The gateway should instead mint a short-lived signed
 * URL to avoid leaking long-term credentials.
 */
export function buildAuthQuery(creds: DoubaoCredentials): URLSearchParams {
  const params = new URLSearchParams();
  params.set('authorization', `Bearer; ${creds.accessToken ?? ''}`);
  if (creds.apiKey) params.set('x-api-key', creds.apiKey);
  if (creds.appId) params.set('x-app-id', creds.appId);
  if (creds.resourceId) params.set('x-resource-id', creds.resourceId);
  return params;
}

/**
 * HMAC-SHA256 signature. Uses Web Crypto when available; falls back to
 * node:crypto in node-only environments.
 *
 * Returns base64-encoded signature.
 */
export async function hmacSha256(
  key: string,
  message: string
): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
    return arrayBufferToBase64(sig);
  }
  // Node fallback
  const nodeCrypto = await import('node:crypto');
  const sig = nodeCrypto.createHmac('sha256', key).update(message).digest();
  return sig.toString('base64');
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (typeof btoa === 'function') {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}
