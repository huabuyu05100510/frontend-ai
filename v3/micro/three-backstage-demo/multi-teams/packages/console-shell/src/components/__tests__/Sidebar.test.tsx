import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Sidebar } from '../Sidebar';
import { useAuthStore } from '../../store/auth';

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

describe('Sidebar (multi-teams)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', name: '管理员' },
      token: 'mock-token',
      permissions: ['*'],
    });
  });

  it('渲染三个子应用分组', () => {
    renderSidebar();
    expect(screen.getByTestId('sidebar-group-system-a')).toHaveTextContent('用户中心');
    expect(screen.getByTestId('sidebar-group-system-b')).toHaveTextContent('订单中心');
    expect(screen.getByTestId('sidebar-group-system-c')).toHaveTextContent('商品中心');
  });

  it('点击菜单跳转到子应用 basename', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByTestId('menu-item-system-a'));
    expect(screen.getByTestId('current-path').textContent).toBe('/system-a/');
  });

  it('未登录时不渲染菜单', () => {
    useAuthStore.setState({ user: null, token: null, permissions: [] });
    renderSidebar();
    expect(screen.queryByTestId('sidebar-group-system-a')).not.toBeInTheDocument();
  });
});