import { useAuthStore } from '../../auth/store';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

export function Header() {
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchValue.trim()) {
      // 演示用：实际项目跳到搜索结果页
      alert(`搜索：${searchValue}（演示）`);
    }
  };

  return (
    <header className="app-header" data-testid="app-header">
      <div className="app-logo">
        业务中台
        <span className="logo-badge">Console</span>
      </div>

      <div className="app-search">
        <input
          type="text"
          placeholder="全局搜索用户 / 订单 / 商品..."
          value={searchValue}
          onChange={e => setSearchValue(e.target.value)}
          onKeyDown={handleSearch}
        />
      </div>

      <div className="app-user">
        <div className="app-avatar" data-testid="user-avatar">
          {user?.name?.charAt(0) ?? '?'}
        </div>
        <span className="app-username" data-testid="user-name">
          {user?.name ?? '未登录'}
        </span>
        <button
          className="app-btn"
          onClick={() => navigate('/profile')}
          data-testid="btn-profile"
        >
          个人中心
        </button>
        <button
          className="app-btn app-btn-primary"
          onClick={handleLogout}
          data-testid="btn-logout"
        >
          退出登录
        </button>
      </div>
    </header>
  );
}