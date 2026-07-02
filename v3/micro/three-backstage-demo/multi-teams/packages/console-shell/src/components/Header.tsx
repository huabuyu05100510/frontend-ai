import { useAuthStore } from '../store/auth';

export function Header() {
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);

  return (
    <header className="app-header" data-testid="app-header">
      <div className="app-logo">
        业务中台
        <span className="badge">Console</span>
      </div>

      <div style={{ flex: 1 }} />

      <div className="app-user">
        <div className="app-avatar" data-testid="user-avatar">
          {user?.name?.charAt(0) ?? '?'}
        </div>
        <span className="app-username" data-testid="user-name">
          {user?.name ?? '未登录'}
        </span>
        <button
          className="app-btn app-btn-primary"
          onClick={logout}
          data-testid="btn-logout"
        >
          退出登录
        </button>
      </div>
    </header>
  );
}