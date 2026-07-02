import { describe, it, expect } from 'vitest';
import { buildMenu, filterByPermission, sortByOrder } from '../aggregator';
import type { MenuItem } from '../../shared/types/menu';

describe('menu aggregator', () => {
  const fullMenu: MenuItem[] = [
    // 系统 A
    {
      id: 'a-user',
      title: '用户管理',
      icon: 'user',
      system: 'A',
      order: 1,
      permission: 'a:user:view',
      children: [
        {
          id: 'a-user-list',
          title: '用户列表',
          path: '/system-a/user/list',
          system: 'A',
          permission: 'a:user:list',
        },
        {
          id: 'a-user-role',
          title: '角色配置',
          path: '/system-a/user/role',
          system: 'A',
          permission: 'a:user:role',
        },
      ],
    },
    {
      id: 'a-dashboard',
      title: '运营看板',
      icon: 'dashboard',
      path: '/system-a/dashboard',
      system: 'A',
      order: 2,
      permission: 'a:dashboard:view',
    },
    // 系统 B
    {
      id: 'b-order',
      title: '订单中心',
      icon: 'order',
      system: 'B',
      order: 1,
      permission: 'b:order:view',
      children: [
        {
          id: 'b-order-pending',
          title: '待处理订单',
          path: '/system-b/order/pending',
          system: 'B',
          permission: 'b:order:pending',
        },
        {
          id: 'b-order-history',
          title: '历史订单',
          path: '/system-b/order/history',
          system: 'B',
          permission: 'b:order:history',
        },
      ],
    },
    // 系统 C
    {
      id: 'c-product',
      title: '商品管理',
      icon: 'product',
      path: '/system-c/product/list',
      system: 'C',
      order: 1,
      permission: 'c:product:view',
    },
  ];

  describe('filterByPermission', () => {
    it('当用户没有任何权限时返回空数组', () => {
      const result = filterByPermission(fullMenu, []);
      expect(result).toEqual([]);
    });

    it('当用户拥有所有权限时返回完整菜单树', () => {
      const perms = [
        'a:user:view', 'a:user:list', 'a:user:role',
        'a:dashboard:view',
        'b:order:view', 'b:order:pending', 'b:order:history',
        'c:product:view',
      ];
      const result = filterByPermission(fullMenu, perms);
      // fullMenu 里有 4 个一级菜单：a-user / a-dashboard / b-order / c-product
      expect(result).toHaveLength(4);
      expect(result[0].id).toBe('a-user');
      expect(result[0].children).toHaveLength(2);
    });

    it('当用户只有部分子菜单权限时，父菜单保留但只显示有权限的子项', () => {
      const perms = ['a:user:view', 'a:user:list']; // 只有用户列表权限
      const result = filterByPermission(fullMenu, perms);
      const userMgmt = result.find(m => m.id === 'a-user');
      expect(userMgmt).toBeDefined();
      expect(userMgmt?.children).toHaveLength(1);
      expect(userMgmt?.children?.[0].id).toBe('a-user-list');
    });

    it('当用户有父菜单权限但所有子菜单都没权限时，整个分组隐藏', () => {
      const perms = ['a:user:view']; // 只有父菜单权限，没有子菜单权限
      const result = filterByPermission(fullMenu, perms);
      const userMgmt = result.find(m => m.id === 'a-user');
      expect(userMgmt).toBeUndefined();
    });

    it('没有 permission 字段的菜单项默认可访问', () => {
      const openMenu: MenuItem[] = [
        { id: 'public', title: '公开页面', path: '/public', system: 'A' },
      ];
      const result = filterByPermission(openMenu, []);
      expect(result).toHaveLength(1);
    });

    it('没有子菜单也没有 permission 的菜单会被保留', () => {
      const menu: MenuItem[] = [
        { id: 'no-auth', title: '免权限', path: '/no-auth', system: 'A' },
      ];
      const result = filterByPermission(menu, []);
      expect(result).toHaveLength(1);
    });
  });

  describe('sortByOrder', () => {
    it('按 order 升序排序', () => {
      const items: MenuItem[] = [
        { id: 'c', title: 'C', system: 'A', order: 3 },
        { id: 'a', title: 'A', system: 'A', order: 1 },
        { id: 'b', title: 'B', system: 'A', order: 2 },
      ];
      const sorted = sortByOrder(items);
      expect(sorted.map(i => i.id)).toEqual(['a', 'b', 'c']);
    });

    it('没有 order 字段的菜单排在最后', () => {
      const items: MenuItem[] = [
        { id: 'no-order', title: '无序', system: 'A' },
        { id: 'first', title: '首位', system: 'A', order: 1 },
      ];
      const sorted = sortByOrder(items);
      expect(sorted[0].id).toBe('first');
      expect(sorted[1].id).toBe('no-order');
    });
  });

  describe('buildMenu（端到端）', () => {
    it('完整流程：过滤 + 排序，返回用户可访问的有序菜单树', () => {
      const perms = [
        'a:user:view', 'a:user:list',
        'a:dashboard:view',
        'b:order:view', 'b:order:pending',
        'c:product:view',
      ];
      const result = buildMenu(fullMenu, perms);
      // 4 个分组都保留（因为每个都有权限）
      expect(result).toHaveLength(4);
      // 按 order 排序：a-user(1) → b-order(1) → a-dashboard(2) → c-product(1)
      // 实际同 order 时保留输入顺序
      expect(result.map(m => m.id)).toEqual(['a-user', 'b-order', 'c-product', 'a-dashboard']);
      // a-user(1), b-order(1), c-product(1) 同 order 保持输入顺序
      // a-dashboard(2) order 最大，排在最后
    });

    it('用户没有任何权限时返回空数组', () => {
      expect(buildMenu(fullMenu, [])).toEqual([]);
    });

    it('用户只有 C 系统权限时，只返回 C 系统菜单', () => {
      const result = buildMenu(fullMenu, ['c:product:view']);
      expect(result).toHaveLength(1);
      expect(result[0].system).toBe('C');
    });
  });
});