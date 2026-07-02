/**
 * 域名 → BrowserRouter basename 映射
 *
 * 设计原则：
 * 1. 所有二级域名指向同一份 SPA 构建产物（nginx 配置）
 * 2. SPA 启动时根据 hostname 自动决定 basename
 * 3. 站内导航永远只改 path 不改 host，避免整页刷新
 * 4. console.example.com 是新一站式入口，basename 为空字符串
 *
 * 为什么不 301：
 * 301 是 HTTP 层跳转，会触发整页刷新（HTML 重解析、JS 重执行、React 重 mount），
 * Header 和 Menu 会重建，破坏"只刷 Content"的体验。
 */
export const DOMAIN_BASENAME_MAP: Record<string, string> = {
  'a.example.com': '/system-a',
  'b.example.com': '/system-b',
  'c.example.com': '/system-c',
  'console.example.com': '',
  'localhost': '', // 开发环境
  '127.0.0.1': '', // 开发环境
};

/**
 * 老域名集合（保留给用户历史书签的入口）
 */
export const LEGACY_DOMAINS = new Set([
  'a.example.com',
  'b.example.com',
  'c.example.com',
]);

/**
 * 根据 hostname 解析 basename
 * @param hostname 可选，默认从 window.location.hostname 读取
 */
export function resolveBasename(hostname?: string): string {
  if (hostname !== undefined) {
    return DOMAIN_BASENAME_MAP[hostname] ?? '';
  }
  if (typeof window === 'undefined') return '';
  return DOMAIN_BASENAME_MAP[window.location.hostname] ?? '';
}

/**
 * 判断当前域名是否为老域名（二级域名入口）
 */
export function isLegacyDomain(hostname: string = window.location.hostname): boolean {
  return LEGACY_DOMAINS.has(hostname);
}

/**
 * 根据当前 basename 推断系统前缀
 * 用于在站内导航时构造正确的目标路径
 */
export function resolveSystemPrefix(): '/system-a' | '/system-b' | '/system-c' | '' {
  const basename = resolveBasename();
  if (basename === '/system-a') return '/system-a';
  if (basename === '/system-b') return '/system-b';
  if (basename === '/system-c') return '/system-c';
  return '';
}