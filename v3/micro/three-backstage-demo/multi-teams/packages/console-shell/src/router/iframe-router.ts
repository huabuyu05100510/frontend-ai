import type { SubAppConfig } from '../subapps/registry';

/**
 * 构造 iframe URL
 *
 * 规则：
 *   pathname 去掉子应用 basename 前缀 → 子应用相对路径
 *   baseUrl + 子应用相对路径 + search → iframe 完整 URL
 *
 *   例：baseUrl = "https://a-cdn.com/system-a"
 *       pathname = "/system-a/user/list"
 *       → "https://a-cdn.com/system-a/user/list"
 */
export function buildIframeUrl(
  app: SubAppConfig,
  pathname: string,
  search: string = ''
): string {
  // 去掉 basename 前缀（保持原 pathname 中 basename 之后的部分）
  let relative = pathname;
  if (app.basename && pathname.startsWith(app.basename)) {
    relative = pathname.slice(app.basename.length);
    if (!relative.startsWith('/')) relative = '/' + relative;
  }
  return `${app.baseUrl.replace(/\/$/, '')}${relative}${search}`;
}

/**
 * 判断是否需要切换子应用
 *
 * 同子应用内路由变化 → false（只改 iframe.src）
 * 不同子应用切换 → true（iframe pool 处理）
 */
export function shouldChangeSubApp(
  from: SubAppConfig | null,
  to: SubAppConfig | null,
  fromPath: string,
  toPath: string
): boolean {
  // 两者都为空（访问的是非子应用页面）
  if (!from && !to) return false;
  // 一方为空 → 需要切换
  if (!from || !to) return true;
  // id 不同 → 需要切换
  if (from.id !== to.id) return true;
  // 同子应用但路径相同 → 不需要（已经是目标）
  if (fromPath === toPath) return false;
  // 同子应用不同路径 → 不需要（只改 iframe.src）
  return false;
}