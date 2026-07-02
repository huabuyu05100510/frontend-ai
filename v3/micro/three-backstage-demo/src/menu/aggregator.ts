import type { MenuItem } from '../shared/types/menu';

/**
 * 按权限码过滤菜单树
 *
 * 规则：
 * 1. 没有 permission 字段 → 默认可访问
 * 2. 有 permission → 用户必须拥有此权限码
 * 3. 父菜单有权限、子菜单无权限 → 父菜单保留但只显示有权限的子项
 * 4. 父菜单有权限但所有子菜单都无权 → 父菜单隐藏
 * 5. 父菜单无权限但子菜单有权限 → 不展示（无法访问到子菜单）
 */
export function filterByPermission(
  items: MenuItem[],
  permissions: string[]
): MenuItem[] {
  return items
    .map(item => filterItem(item, permissions))
    .filter((item): item is MenuItem => item !== null);
}

function filterItem(item: MenuItem, permissions: string[]): MenuItem | null {
  const hasAccess =
    !item.permission || permissions.includes(item.permission);

  if (!hasAccess) {
    // 父菜单无权限：尝试递归检查子菜单
    if (item.children?.length) {
      const filteredChildren = filterByPermission(item.children, permissions);
      if (filteredChildren.length > 0) {
        return { ...item, children: filteredChildren };
      }
    }
    return null;
  }

  // 父菜单有权限
  if (item.children?.length) {
    const filteredChildren = filterByPermission(item.children, permissions);
    if (filteredChildren.length === 0 && item.children.length > 0) {
      // 父菜单有权限但所有子菜单都无权 → 隐藏整个父菜单
      return null;
    }
    return { ...item, children: filteredChildren };
  }

  return item;
}

/**
 * 按 order 字段升序排序，没有 order 的排在最后
 */
export function sortByOrder(items: MenuItem[]): MenuItem[] {
  return [...items].sort((a, b) => {
    const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
}

/**
 * 构建用户菜单（过滤 + 排序，递归处理子菜单）
 */
export function buildMenu(
  items: MenuItem[],
  permissions: string[]
): MenuItem[] {
  const filtered = filterByPermission(items, permissions);
  const sorted = sortByOrder(filtered);

  // 递归排序子菜单
  return sorted.map(item => {
    if (item.children?.length) {
      return { ...item, children: sortByOrder(item.children) };
    }
    return item;
  });
}