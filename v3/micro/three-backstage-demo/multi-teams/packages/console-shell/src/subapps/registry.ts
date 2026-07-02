/**
 * 子应用注册表
 *
 * 平台架构组维护：声明哪些子应用可用、如何路由、如何加载
 * 每个子应用由独立团队在独立仓库实现，部署到独立 CDN
 */

export interface SubAppConfig {
  /** 子应用 ID（全局唯一） */
  id: string;
  /** 显示名称（菜单 / Header / iframe title） */
  name: string;
  /** 子应用部署地址（CDN / OSS / 静态站点） */
  baseUrl: string;
  /** 激活规则：URL 前缀字符串或正则 */
  activeRule: string | RegExp;
  /** iframe 容器选择器 */
  container: string;
  /** 子应用内部 React Router basename */
  basename: string;
  /** 协议版本（用于兼容） */
  protocolVersion?: string;
  /** 灰度版本（可选） */
  version?: string;
  /** 是否需要登录态同步 */
  requireAuth?: boolean;
}

/**
 * 默认注册表（生产环境从配置中心拉取）
 *
 * 注意：baseUrl 在不同环境下不同
 *   dev:    http://127.0.0.1:5181 / 5182 / 5183
 *   staging: https://a-staging.example.com/system-a
 *   prod:   https://a-cdn.example.com/system-a
 */
export const SUB_APP_REGISTRY: SubAppConfig[] = [
  {
    id: 'system-a',
    name: '用户中心',
    baseUrl: getBaseUrl('system-a'),
    activeRule: /^\/system-a(\/|$)/,
    container: '#subapp-frame',
    basename: '/system-a',
    protocolVersion: '1.0',
    requireAuth: true,
  },
  {
    id: 'system-b',
    name: '订单中心',
    baseUrl: getBaseUrl('system-b'),
    activeRule: /^\/system-b(\/|$)/,
    container: '#subapp-frame',
    basename: '/system-b',
    protocolVersion: '1.0',
    requireAuth: true,
  },
  {
    id: 'system-c',
    name: '商品中心',
    baseUrl: getBaseUrl('system-c'),
    activeRule: /^\/system-c(\/|$)/,
    container: '#subapp-frame',
    basename: '/system-c',
    protocolVersion: '1.0',
    requireAuth: true,
  },
];

/**
 * 解析 activeRule 为统一 RegExp
 */
export function parseActiveRule(rule: string | RegExp): RegExp {
  if (rule instanceof RegExp) return rule;
  // 字符串前缀：必须严格匹配，避免 /system-a 错配 /system-abc
  const escaped = rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(\\/|$)`);
}

/**
 * 根据 pathname 匹配子应用
 */
export function matchSubApp(pathname: string): SubAppConfig | null {
  for (const app of SUB_APP_REGISTRY) {
    const re = parseActiveRule(app.activeRule);
    if (re.test(pathname)) return app;
  }
  return null;
}

/**
 * 环境感知的 baseUrl 解析
 *   dev 环境指向本地子应用 dev server
 *   生产环境指向 CDN
 */
function getBaseUrl(id: string): string {
  if (typeof window === 'undefined') {
    return `https://${id}-cdn.example.com/${id}`;
  }
  const hostname = window.location.hostname;
  // 开发环境：指向本地子应用 vite dev server 端口
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const ports: Record<string, number> = {
      'system-a': 5181,
      'system-b': 5182,
      'system-c': 5183,
    };
    return `http://127.0.0.1:${ports[id] ?? 5180}`;
  }
  // 生产/预发环境：CDN
  return `https://${id}-cdn.${extractRootDomain(hostname)}/${id}`;
}

function extractRootDomain(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }
  return hostname;
}