import { Link } from 'react-router-dom';
import { useAuthStore } from '../../auth/store';

export function Dashboard() {
  const user = useAuthStore(s => s.user);

  const stats = [
    { label: '今日新增用户', value: '128', delta: '+12%', trend: 'up' },
    { label: '待处理订单', value: '23', delta: '-5%', trend: 'down' },
    { label: '商品总数', value: '1,256', delta: '+8', trend: 'up' },
    { label: '系统访问量', value: '8,432', delta: '+15%', trend: 'up' },
  ];

  return (
    <div>
      <div className="page-card">
        <h1 className="page-title" data-testid="dashboard-title">
          欢迎回来，{user?.name ?? '游客'} 👋
        </h1>
        <p className="page-subtitle">一站式业务中台 - 整合用户中心 / 订单中心 / 商品中心</p>
      </div>

      <div className="stats-grid">
        {stats.map(s => (
          <div className="stat-card" key={s.label} data-testid={`stat-${s.label}`}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            <div className={`stat-delta ${s.trend}`}>{s.delta}</div>
          </div>
        ))}
      </div>

      <div className="page-card">
        <h2 className="page-title" style={{ fontSize: 16 }}>快捷入口</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/system-a/user/list" className="app-link">→ 用户列表</Link>
          <Link to="/system-b/order/pending" className="app-link">→ 待处理订单</Link>
          <Link to="/system-c/product/list" className="app-link">→ 商品列表</Link>
          <Link to="/system-c/legacy" className="app-link">→ 老库存（iframe 兼容）</Link>
        </div>
      </div>
    </div>
  );
}