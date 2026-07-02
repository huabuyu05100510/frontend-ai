import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Sidebar } from '../Sidebar';
import { useAuthStore } from '../../../auth/store';

function CurrentPath() {
  const loc = useLocation();
  return <div data-testid="current-path">{loc.pathname}</div>;
}

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar />
      <CurrentPath />
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    // 重置为管理员（有所有权限）
    useAuthStore.setState({
      user: { id: 'u1', name: '管理员' },
      permissions: [
        'a:user:view', 'a:user:list', 'a:user:role', 'a:dashboard:view',
        'b:order:view', 'b:order:pending', 'b:order:history', 'b:report:view',
        'c:product:view', 'c:product:list', 'c:product:create', 'c:legacy:view',
      ],
    });
  });

  it('按权限渲染三个系统的分组菜单', () => {
    renderSidebar();
    expect(screen.getByTestId('sidebar-group-A')).toHaveTextContent('用户中心');
    expect(screen.getByTestId('sidebar-group-B')).toHaveTextContent('订单中心');
    expect(screen.getByTestId('sidebar-group-C')).toHaveTextContent('商品中心');
  });

  it('用户没有系统 C 的商品创建权限时，该菜单项不显示', () => {
    useAuthStore.setState({
      user: { id: 'u2', name: '运营' },
      permissions: ['a:user:view', 'a:user:list', 'a:dashboard:view', 'b:order:view', 'b:order:pending', 'c:product:view', 'c:product:list'],
    });
    renderSidebar();
    expect(screen.queryByTestId('menu-item-c-product-create')).not.toBeInTheDocument();
    expect(screen.getByTestId('menu-item-c-product-list')).toBeInTheDocument();
  });

  it('用户没有任何权限时，Sidebar 不渲染任何菜单项', () => {
    useAuthStore.setState({ user: { id: 'u3', name: '空' }, permissions: [] });
    renderSidebar();
    expect(screen.queryByTestId('sidebar-group-A')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-group-B')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-group-C')).not.toBeInTheDocument();
  });

  it('点击菜单项触发导航（navigate）', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const beforePath = screen.getByTestId('current-path').textContent;
    expect(beforePath).toBe('/');
    await user.click(screen.getByTestId('menu-item-a-user-list'));
    // MemoryRouter 内的 navigate 会改变 path，但 window.location.pathname 不变
    // 用 location 组件的 innerText 来验证
    expect(screen.getByTestId('current-path').textContent).toBe('/system-a/user/list');
  });

  it('菜单项按 order 字段升序排序', () => {
    renderSidebar();
    const groupA = screen.getByTestId('sidebar-group-A');
    // 只取顶层菜单（level=0）
    const items = groupA.parentElement!.querySelectorAll('[data-testid^="menu-item-a-"][data-menu-level="0"]');
    const ids = Array.from(items).map(el => el.getAttribute('data-testid'));
    // 顶层只有 a-user(order=1) 和 a-dashboard(order=2)
    expect(ids).toEqual(['menu-item-a-user', 'menu-item-a-dashboard']);
  });
});