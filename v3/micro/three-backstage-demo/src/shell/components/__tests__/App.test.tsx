import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../../App';
import { useAuthStore } from '../../../auth/store';

// jsdom 默认 hostname 是 'localhost'，正好被 DOMAIN_BASENAME_MAP 映射为 '' (basename 为空)
// 适合作为 console.example.com 的等价测试场景
describe('App 端到端', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, permissions: [] });
    localStorage.clear();
  });

  it('未登录访问根路径时跳转到 /login', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('btn-login')).toBeInTheDocument();
    });
  });

  it('完整流程：登录 → 看 Dashboard → 切到系统 A 用户列表 → 查看用户详情', async () => {
    const user = userEvent.setup();

    render(<App />);

    // 1. 未登录 → 跳到 /login
    await waitFor(() => screen.getByTestId('btn-login'));

    // 2. 默认选中 admin 账号，点击登录
    await user.click(screen.getByTestId('btn-login'));

    // 3. 登录后看到 Dashboard（注意：Header 渲染用户名"管理员"）
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-title')).toHaveTextContent('管理员');
    });
    expect(screen.getByTestId('user-name')).toHaveTextContent('管理员');

    // 4. 点击侧边栏的"用户列表"菜单
    await user.click(screen.getByTestId('menu-item-a-user-list'));

    // 5. 渲染系统 A 的 UserList 页面
    await waitFor(() => {
      expect(screen.getByTestId('user-table')).toBeInTheDocument();
    });

    // 6. 点击用户名进入详情（注意：Header 和 Sidebar 不变）
    expect(screen.getByTestId('app-header')).toBeInTheDocument();
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();
    await user.click(screen.getByText('张三'));

    // 7. 详情页应该展示用户信息（页面标题包含用户详情）
    await waitFor(() => {
      expect(document.body.textContent).toContain('用户详情');
      expect(document.body.textContent).toContain('u001');
    });
  });

  it('切换到系统 B 订单模块：Header 和 Sidebar 保持不变', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({
      user: { id: 'u1', name: '管理员' },
      permissions: ['b:order:view', 'b:order:pending'],
    });

    render(<App />);

    await waitFor(() => screen.getByTestId('app-header'));

    // 导航到 /system-b/order/pending
    await user.click(screen.getByTestId('menu-item-b-order-pending'));

    await waitFor(() => {
      expect(screen.getByTestId('order-table')).toBeInTheDocument();
    });

    // Header 与 Sidebar 仍然存在（不重新挂载）
    expect(screen.getByTestId('app-header')).toBeInTheDocument();
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();
  });

  it('退出登录后跳回登录页', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({
      user: { id: 'u1', name: '管理员' },
      permissions: ['a:dashboard:view'],
    });

    render(<App />);
    await waitFor(() => screen.getByTestId('btn-logout'));

    await user.click(screen.getByTestId('btn-logout'));

    await waitFor(() => {
      expect(screen.getByTestId('btn-login')).toBeInTheDocument();
    });
  });

  it('演示账号切换：admin → merchant 只看到商品管理菜单', async () => {
    const user = userEvent.setup();

    render(<App />);
    await waitFor(() => screen.getByTestId('btn-login'));

    // 切换到商家账号
    await user.click(screen.getByTestId('preset-merchant'));
    await user.click(screen.getByTestId('btn-login'));

    await waitFor(() => {
      expect(screen.getByTestId('user-name')).toHaveTextContent('商家老王');
    });

    // 商家只有商品中心权限，不应该看到用户中心和订单中心
    expect(screen.queryByTestId('sidebar-group-A')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-group-B')).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar-group-C')).toBeInTheDocument();
  });
});