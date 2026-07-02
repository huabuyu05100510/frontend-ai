import { useAuthStore } from '../../auth/store';

export function Profile() {
  const user = useAuthStore(s => s.user);
  const permissions = useAuthStore(s => s.permissions);

  return (
    <div>
      <div className="page-card">
        <h1 className="page-title">个人中心</h1>
        <p className="page-subtitle">当前登录信息与权限码</p>

        <div className="app-form-item">
          <label className="app-form-label">用户 ID</label>
          <input
            className="app-input"
            value={user?.id ?? ''}
            readOnly
            data-testid="profile-user-id"
          />
        </div>

        <div className="app-form-item">
          <label className="app-form-label">姓名</label>
          <input className="app-input" value={user?.name ?? ''} readOnly />
        </div>

        <div className="app-form-item">
          <label className="app-form-label">邮箱</label>
          <input className="app-input" value={user?.email ?? ''} readOnly />
        </div>
      </div>

      <div className="page-card">
        <h2 className="page-title" style={{ fontSize: 16 }}>权限码（{permissions.length}）</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {permissions.map(p => (
            <span key={p} className="app-badge app-badge-info" data-testid={`perm-${p}`}>
              {p}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}