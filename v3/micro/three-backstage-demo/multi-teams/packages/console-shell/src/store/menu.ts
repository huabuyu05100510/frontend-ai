import type { SubAppConfig } from '../subapps/registry';

/**
 * 菜单项（从子应用注册表派生）
 */
export interface MenuItem {
  id: string;
  title: string;
  icon: string;
  path: string;
  system: 'A' | 'B' | 'C';
  permission?: string;
}

/**
 * 按权限过滤菜单
 */
export function filterMenuByPermissions(
  items: MenuItem[],
  permissions: string[]
): MenuItem[] {
  return items.filter(
    item => !item.permission || permissions.includes(item.permission)
  );
}

/**
 * 根据子应用注册表构造菜单
 */
export function buildMenuFromRegistry(
  registry: SubAppConfig[],
  systemLabel: Record<string, string>
): MenuItem[] {
  return registry.map(app => ({
    id: `app-${app.id}`,
    title: app.name,
    icon: iconForSystem(app.id),
    path: `${app.basename}/`,
    system: app.id.includes('a') ? 'A' : app.id.includes('b') ? 'B' : 'C',
  }));
}

function iconForSystem(appId: string): string {
  if (appId.includes('a')) return '👤';
  if (appId.includes('b')) return '📦';
  return '🛒';
}