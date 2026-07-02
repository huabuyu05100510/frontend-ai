import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../store';

describe('auth store', () => {
  beforeEach(() => {
    // 重置 store
    useAuthStore.setState({ user: null, permissions: [] });
  });

  it('初始状态：未登录，无权限', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.permissions).toEqual([]);
    expect(state.isLoggedIn()).toBe(false);
  });

  it('login 后用户信息和权限被正确设置', () => {
    const user = { id: '1', name: '张三', avatar: '' };
    const permissions = ['a:user:view', 'b:order:view'];
    useAuthStore.getState().login(user, permissions);
    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.permissions).toEqual(permissions);
    expect(state.isLoggedIn()).toBe(true);
  });

  it('logout 后清空用户信息和权限', () => {
    useAuthStore.getState().login({ id: '1', name: '张三', avatar: '' }, ['a:user:view']);
    useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.permissions).toEqual([]);
    expect(state.isLoggedIn()).toBe(false);
  });

  it('hasPermission 判断单个权限', () => {
    useAuthStore.getState().login(
      { id: '1', name: '张三', avatar: '' },
      ['a:user:view', 'a:user:list']
    );
    expect(useAuthStore.getState().hasPermission('a:user:view')).toBe(true);
    expect(useAuthStore.getState().hasPermission('a:user:role')).toBe(false);
  });

  it('hasAnyPermission 判断多个权限之一', () => {
    useAuthStore.getState().login(
      { id: '1', name: '张三', avatar: '' },
      ['a:user:view']
    );
    expect(useAuthStore.getState().hasAnyPermission(['a:user:view', 'a:user:list'])).toBe(true);
    expect(useAuthStore.getState().hasAnyPermission(['a:user:list', 'b:order:view'])).toBe(false);
  });
});