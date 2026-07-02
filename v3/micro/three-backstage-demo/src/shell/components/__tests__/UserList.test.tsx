import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { UserList } from '../../../modules/system-a/pages/UserList';

beforeEach(() => {
  localStorage.clear();
});

describe('UserList 页面', () => {
  it('加载时从 localStorage 读取并展示用户列表', async () => {
    render(
      <MemoryRouter initialEntries={['/system-a/user/list']}>
        <Routes>
          <Route path="/system-a/user/list" element={<UserList />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-table')).toBeInTheDocument();
    });

    // 默认种子数据：5 个用户
    expect(screen.getByTestId('user-row-u001')).toBeInTheDocument();
    expect(screen.getByTestId('user-row-u005')).toBeInTheDocument();
  });

  it('搜索关键词过滤用户列表', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/system-a/user/list']}>
        <Routes>
          <Route path="/system-a/user/list" element={<UserList />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByTestId('user-row-u001'));
    const searchInput = screen.getByTestId('user-search');
    await user.type(searchInput, '李四');

    await waitFor(() => {
      expect(screen.queryByTestId('user-row-u001')).not.toBeInTheDocument();
      expect(screen.getByTestId('user-row-u002')).toBeInTheDocument();
    });
  });

  it('点击"新增用户"打开表单弹窗', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/system-a/user/list']}>
        <Routes>
          <Route path="/system-a/user/list" element={<UserList />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByTestId('btn-create-user'));
    await user.click(screen.getByTestId('btn-create-user'));

    expect(screen.getByTestId('form-name')).toBeInTheDocument();
    expect(screen.getByTestId('form-email')).toBeInTheDocument();
  });

  it('提交表单后用户列表新增一条', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/system-a/user/list']}>
        <Routes>
          <Route path="/system-a/user/list" element={<UserList />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByTestId('btn-create-user'));
    await user.click(screen.getByTestId('btn-create-user'));

    await user.type(screen.getByTestId('form-name'), '测试用户');
    await user.type(screen.getByTestId('form-email'), 'test@example.com');
    await user.click(screen.getByTestId('form-submit'));

    await waitFor(() => {
      // 新用户 id = u006
      expect(screen.getByTestId('user-row-u006')).toBeInTheDocument();
    });
  });
});