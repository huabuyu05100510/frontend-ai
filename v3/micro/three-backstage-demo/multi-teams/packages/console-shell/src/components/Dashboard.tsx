import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { SUB_APP_REGISTRY } from '../subapps/registry';

export function Dashboard() {
  const user = useAuthStore(s => s.user);

  return (
    <div style={{ padding: 24 }}>
      <div className="page-card">
        <h1 className="page-title" data-testid="dashboard-title">
          欢迎回来，{user?.name ?? '游客'} 👋
        </h1>
        <p className="page-subtitle">
          一站式业务中台 - 整合用户中心 / 订单中心 / 商品中心（iframe + 多仓架构）
        </p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">子应用数</div>
          <div className="stat-value">{SUB_APP_REGISTRY.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">架构模式</div>
          <div className="stat-value" style={{ fontSize: 20 }}>iframe + 多仓</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">隔离度</div>
          <div className="stat-value" style={{ fontSize: 20, color: '#52c41a' }}>强</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">独立部署</div>
          <div className="stat-value" style={{ fontSize: 20, color: '#52c41a' }}>✓</div>
        </div>
      </div>

      <div className="page-card">
        <h2 className="page-title" style={{ fontSize: 16 }}>子应用快捷入口</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {SUB_APP_REGISTRY.map(app => (
            <Link
              key={app.id}
              to={`${app.basename}/`}
              className="app-link"
              data-testid={`link-${app.id}`}
            >
              → {app.name}
            </Link>
          ))}
        </div>
      </div>

      <div className="page-card">
        <h2 className="page-title" style={{ fontSize: 16 }}>架构说明</h2>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
          <li>Shell 与各子应用分别在独立的 git 仓库</li>
          <li>每个子应用由独立团队维护，独立发版</li>
          <li>通过 iframe 嵌入实现路由代理（Shell 只分发 URL，不耦合子应用代码）</li>
          <li>postMessage 通信协议：登录态同步、路由同步、resize 上报</li>
          <li>iframe 池 + LRU 淘汰 + src=about:blank 控制内存</li>
        </ul>
      </div>
    </div>
  );
}