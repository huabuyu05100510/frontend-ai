import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';

interface MockUser {
  id: string;
  name: string;
  email: string;
  permissions: string[];
}

const PRESET_USERS: Record<string, MockUser> = {
  admin: {
    id: 'u-admin',
    name: '管理员',
    email: 'admin@example.com',
    permissions: ['*'],
  },
  operator: {
    id: 'u-op',
    name: '运营小李',
    email: 'lisi@example.com',
    permissions: ['a:user:view', 'b:order:view', 'c:product:view'],
  },
  merchant: {
    id: 'u-mer',
    name: '商家老王',
    email: 'wang@example.com',
    permissions: ['c:product:view'],
  },
};

export function Login() {
  const navigate = useNavigate();
  const login = useAuthStore(s => s.login);
  const [selectedPreset, setSelectedPreset] = useState<keyof typeof PRESET_USERS>('admin');

  const handleLogin = () => {
    const u = PRESET_USERS[selectedPreset];
    login(
      { id: u.id, name: u.name, email: u.email },
      'mock-jwt-token-' + u.id,
      u.permissions
    );
    navigate('/');
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">业务中台</h1>
        <p className="auth-subtitle">三个中后台一体化登录</p>

        <div className="app-form-item">
          <label className="app-form-label">用户名</label>
          <input
            className="app-input"
            value={PRESET_USERS[selectedPreset].name}
            readOnly
            data-testid="login-username"
          />
        </div>

        <div className="app-form-item">
          <label className="app-form-label">密码</label>
          <input
            className="app-input"
            type="password"
            defaultValue="demo-password"
            data-testid="login-password"
          />
        </div>

        <button
          className="app-btn app-btn-primary"
          onClick={handleLogin}
          style={{ width: '100%' }}
          data-testid="btn-login"
        >
          登录
        </button>

        <div className="auth-quick">
          <div className="auth-quick-title">快速切换演示账号：</div>
          {Object.entries(PRESET_USERS).map(([key, user]) => (
            <span
              key={key}
              className={`auth-quick-btn ${selectedPreset === key ? 'active' : ''}`}
              onClick={() => setSelectedPreset(key as keyof typeof PRESET_USERS)}
              data-testid={`preset-${key}`}
            >
              {user.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}