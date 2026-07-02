import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { useAuthStore } from '../store/auth';

describe('App 端到端 (multi-teams)', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null, permissions: [] });
  });

  it('未登录跳转到 /login', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('btn-login')).toBeInTheDocument();
    });
  });

  it('完整流程：登录 → Dashboard → 切换子应用', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 1. 登录
    await waitFor(() => screen.getByTestId('btn-login'));
    await user.click(screen.getByTestId('btn-login'));

    // 2. Dashboard
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-title')).toHaveTextContent('管理员');
    });
    expect(screen.getByTestId('user-name')).toHaveTextContent('管理员');

    // 3. Header / Sidebar 始终存在（不刷新）
    expect(screen.getByTestId('app-header')).toBeInTheDocument();
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();

    // 4. 点侧边栏菜单 → 切换到 system-a
    await user.click(screen.getByTestId('menu-item-system-a'));

    // 5. URL 变为 /system-a/，SubAppLoader 触发
    await waitFor(() => {
      expect(window.location.pathname).toMatch(/system-a/);
    });

    // 6. Header / Sidebar 仍然存在（不刷新）
    expect(screen.getByTestId('app-header')).toBeInTheDocument();
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();
  });

  it('退出登录后回到登录页', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({
      user: { id: 'u1', name: '管理员' },
      token: 'mock-token',
      permissions: ['*'],
    });

    render(<App />);
    await waitFor(() => screen.getByTestId('btn-logout'));

    await user.click(screen.getByTestId('btn-logout'));

    await waitFor(() => {
      expect(screen.getByTestId('btn-login')).toBeInTheDocument();
    });
  });

  it('不同权限账号登录后看到对应账号名', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => screen.getByTestId('btn-login'));

    // 默认 admin
    await user.click(screen.getByTestId('btn-login'));

    await waitFor(() => {
      expect(screen.getByTestId('user-name')).toHaveTextContent('管理员');
    });

    // 退出
    await user.click(screen.getByTestId('btn-logout'));

    // 切到商家账号登录
    await waitFor(() => screen.getByTestId('preset-merchant'));
    await user.click(screen.getByTestId('preset-merchant'));
    await user.click(screen.getByTestId('btn-login'));

    await waitFor(() => {
      expect(screen.getByTestId('user-name')).toHaveTextContent('商家老王');
    });
  });
});