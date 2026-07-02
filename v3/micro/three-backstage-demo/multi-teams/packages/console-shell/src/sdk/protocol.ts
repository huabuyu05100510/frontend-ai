/**
 * Shell ↔ 子应用 postMessage 通信协议
 *
 * 消息格式：
 *   {
 *     type: 消息类型（必须）
 *     ... 其他字段
 *   }
 *
 * 安全规则：
 *   1. 必须指定 targetOrigin（不能是 '*'）
 *   2. 必须验证 event.origin 在白名单内
 *   3. 消息必须可 JSON 序列化（无函数 / Symbol）
 */

// ---------- 消息类型定义 ----------

export interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
}

export type ShellMessage =
  | { type: 'auth:sync'; token: string; user: User }
  | { type: 'auth:logout' }
  | { type: 'route:navigate'; path: string }
  | { type: 'route:sync'; path: string }
  | { type: 'theme:change'; theme: 'light' | 'dark' }
  | { type: 'resize:report'; height: number }
  | { type: 'subapp:ready'; appId: string }
  | { type: 'subapp:error'; appId: string; error: string };

// ---------- Origin 验证 ----------

/**
 * 验证消息来源是否在白名单内
 */
export function validateOrigin(origin: string, allowed: string[]): boolean {
  if (!origin) return false;

  for (const pattern of allowed) {
    if (pattern === origin) return true;
    // 通配符：https://*.example.com 匹配 https://sub.example.com
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
      );
      if (regex.test(origin)) return true;
    }
  }
  return false;
}

// ---------- 消息解析 ----------

const KNOWN_TYPES = new Set<ShellMessage['type']>([
  'auth:sync',
  'auth:logout',
  'route:navigate',
  'route:sync',
  'theme:change',
  'resize:report',
  'subapp:ready',
  'subapp:error',
]);

/**
 * 解析并校验消息
 */
export function parseMessage(data: unknown): ShellMessage | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.type !== 'string') return null;
  return obj as unknown as ShellMessage;
}

// ---------- 协议实例 ----------

export interface ProtocolConfig {
  /** 发送消息时的目标 origin（不能是 '*'） */
  targetOrigin: string;
  /** 接收消息时允许的 origin 白名单 */
  allowedOrigins: string[];
  /** 收到合法消息时的回调 */
  onMessage: (msg: ShellMessage) => void;
  /** 目标窗口获取函数（iframe.contentWindow 等） */
  targetWindow: () => Window | null;
}

export function createProtocol(config: ProtocolConfig) {
  const { targetOrigin, allowedOrigins, onMessage, targetWindow } = config;

  return {
    /**
     * 向子应用发送消息
     */
    send(message: ShellMessage) {
      const win = targetWindow();
      if (!win) return;
      // ⭐ 必须指定 targetOrigin（不能用 '*'）
      win.postMessage(message, targetOrigin);
    },

    /**
     * 处理来自子应用的消息
     */
    handleMessage(event: MessageEvent) {
      // ⭐ 1. 验证 origin
      if (!validateOrigin(event.origin, allowedOrigins)) {
        console.warn('[protocol] rejected message from origin:', event.origin);
        return;
      }
      // ⭐ 2. 验证消息结构
      const msg = parseMessage(event.data);
      if (!msg) {
        console.warn('[protocol] rejected malformed message:', event.data);
        return;
      }
      onMessage(msg);
    },
  };
}

export type Protocol = ReturnType<typeof createProtocol>;