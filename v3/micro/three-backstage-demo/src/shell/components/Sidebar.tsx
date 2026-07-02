import { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../auth/store';
import { buildMenu } from '../../menu/aggregator';
import { ALL_MENUS } from '../../menu/definitions';
import type { MenuItem } from '../../shared/types/menu';

const SYSTEM_NAMES: Record<string, string> = {
  A: '用户中心',
  B: '订单中心',
  C: '商品中心',
};

const SYSTEM_ICONS: Record<string, string> = {
  user: '👤',
  dashboard: '📊',
  order: '📦',
  chart: '📈',
  product: '🛒',
  archive: '🗄️',
};

export function Sidebar() {
  const permissions = useAuthStore(s => s.permissions);
  const navigate = useNavigate();
  const location = useLocation();

  // ⭐ 按权限构建菜单树
  const menu = useMemo(
    () => buildMenu(ALL_MENUS, permissions),
    [permissions]
  );

  // 按系统分组
  const grouped = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    for (const item of menu) {
      const list = groups.get(item.system) || [];
      list.push(item);
      groups.set(item.system, list);
    }
    return groups;
  }, [menu]);

  const handleNav = (path: string) => {
    // ⭐ 关键：站内导航永远只改 path，不改 host，不刷新
    navigate(path);
  };

  const isActive = (path?: string) => path === location.pathname;

  return (
    <aside className="app-sidebar" data-testid="app-sidebar">
      {Array.from(grouped.entries()).map(([system, items]) => (
        <div key={system}>
          <div className="app-sidebar-title" data-testid={`sidebar-group-${system}`}>
            {SYSTEM_NAMES[system] || system}
          </div>
          {items.map(item => (
            <MenuTreeItem
              key={item.id}
              item={item}
              depth={0}
              onNav={handleNav}
              isActive={isActive}
            />
          ))}
        </div>
      ))}
    </aside>
  );
}

function MenuTreeItem({
  item,
  depth,
  onNav,
  isActive,
}: {
  item: MenuItem;
  depth: number;
  onNav: (path: string) => void;
  isActive: (path?: string) => boolean;
}) {
  const hasChildren = item.children && item.children.length > 0;
  const icon = SYSTEM_ICONS[item.icon ?? ''] ?? '▸';

  return (
    <>
      <div
        className={`app-menu-item ${isActive(item.path) ? 'active' : ''}`}
        onClick={() => item.path && onNav(item.path)}
        data-testid={`menu-item-${item.id}`}
        data-menu-level={depth}
        style={depth > 0 ? { paddingLeft: 24 + depth * 24 } : undefined}
      >
        <span className="app-menu-item-icon">{icon}</span>
        <span>{item.title}</span>
      </div>
      {hasChildren && (
        <div className="app-submenu">
          {item.children!.map(child => (
            <span
              key={child.id}
              className={`app-submenu-item ${isActive(child.path) ? 'active' : ''}`}
              onClick={() => child.path && onNav(child.path)}
              data-testid={`menu-item-${child.id}`}
              data-menu-level={depth + 1}
            >
              {child.title}
            </span>
          ))}
        </div>
      )}
    </>
  );
}