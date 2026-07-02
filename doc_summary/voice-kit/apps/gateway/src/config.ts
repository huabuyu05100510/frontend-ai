/**
 * Gateway configuration — reads from environment with sensible defaults.
 */

export interface GatewayConfig {
  port: number;
  /** CORS allowed origins */
  corsOrigins: string[];
  doubao: {
    appId?: string;
    apiKey?: string;
    apiSecret?: string;
    accessToken?: string;
    resourceId?: string;
    asrEndpoint: string;
    ttsEndpoint: string;
    realtime?: {
      appId?: string;
      token?: string;
      endpoint: string;
    };
  };
  zhipu: {
    apiKey?: string;
    apiSecret?: string;
    baseUrl?: string;
  };
  minimax: {
    apiKey?: string;
    groupId?: string;
    baseUrl?: string;
  };
  /** Token TTL in seconds for short-lived JWTs minted for clients */
  tokenTtlSec: number;
}

export function loadConfig(): GatewayConfig {
  return {
    port: Number(process.env.VK_GATEWAY_PORT ?? 8787),
    corsOrigins: (process.env.VK_CORS_ORIGINS ?? '*').split(','),
    doubao: {
      appId: process.env.VK_DOUBAO_APP_ID,
      apiKey: process.env.VK_DOUBAO_API_KEY,
      apiSecret: process.env.VK_DOUBAO_API_SECRET,
      accessToken: process.env.VK_DOUBAO_ACCESS_TOKEN,
      resourceId: process.env.VK_DOUBAO_RESOURCE_ID ?? 'volc.seedasr.sauc.duration',
      asrEndpoint:
        process.env.VK_DOUBAO_ASR_ENDPOINT ??
        'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
      ttsEndpoint:
        process.env.VK_DOUBAO_TTS_ENDPOINT ??
        'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
      realtime: process.env.VK_DOUBAO_REALTIME_APP_ID
        ? {
            appId: process.env.VK_DOUBAO_REALTIME_APP_ID,
            token: process.env.VK_DOUBAO_REALTIME_TOKEN,
            endpoint:
              process.env.VK_DOUBAO_REALTIME_ENDPOINT ??
              'wss://openspeech.bytedance.com/api/v3/realtime',
          }
        : undefined,
    },
    zhipu: {
      apiKey: process.env.VK_ZHIPU_API_KEY,
      apiSecret: process.env.VK_ZHIPU_API_SECRET,
      baseUrl: process.env.VK_ZHIPU_BASE_URL,
    },
    minimax: {
      apiKey: process.env.VK_MINIMAX_API_KEY,
      groupId: process.env.VK_MINIMAX_GROUP_ID,
      baseUrl: process.env.VK_MINIMAX_BASE_URL,
    },
    tokenTtlSec: Number(process.env.VK_TOKEN_TTL_SEC ?? 300),
  };
}

export function hasDoubao(config: GatewayConfig): boolean {
  return Boolean(
    config.doubao.apiKey || (config.doubao.appId && config.doubao.accessToken)
  );
}

export function describeDoubao(config: GatewayConfig): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!config.doubao.appId) missing.push('VK_DOUBAO_APP_ID');
  if (!config.doubao.apiKey && !config.doubao.accessToken) {
    missing.push(config.doubao.appId ? 'VK_DOUBAO_ACCESS_TOKEN' : 'VK_DOUBAO_API_KEY');
  }
  return { ok: missing.length === 0, missing };
}
