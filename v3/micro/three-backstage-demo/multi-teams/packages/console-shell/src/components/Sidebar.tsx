import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { SUB_APP_REGISTRY, matchSubApp } from '../subapps/registry';

const SYSTEM_GROUP: Record<string, string> = {
  'system-a': '用户中心',
  'system-b': '订单中心',
  'system-c': '商品中心',
};

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const permissions = useAuthStore(s => s.permissions);

  // 按 system 分组
  const groups = new Map<string, typeof SUB_APP_REGISTRY>();
  for (const app of SUB_APP_REGISTRY) {
    const list = groups.get(app.id) || [];
    list.push(app);
    groups.set(app.id, list);
  }

  const currentApp = matchSubApp(location.pathname);

  return (
    <aside className="app-sidebar" data-testid="app-sidebar">
      {Array.from(groups.entries()).map(([systemId, apps]) => {
        const firstApp = apps[0];
        // 简单的权限检查：演示用，真实项目从子应用 manifest 读取
        const hasPermission = permissions.length > 0;
        if (!hasPermission) return null;

        return (
          <div key={systemId}>
            <div className="app-sidebar-title" data-testid={`sidebar-group-${systemId}`}>
              {SYSTEM_GROUP[systemId] || systemId}
            </div>
            <div
              className={`app-menu-item ${currentApp?.id === systemId ? 'active' : ''}`}
              onClick={() => navigate(`${firstApp.basename}/`)}
              data-testid={`menu-item-${systemId}`}
            >
              <span>{getIcon(systemId)}</span>
              <span>{firstApp.name}</span>
            </div>
          </div>
        );
      })}
    </aside>
  );
}

function getIcon(systemId: string): string {
  if (systemId.includes('a')) return '👤';
  if (systemId.includes('b')) return '📦';
  return '🛒';
}