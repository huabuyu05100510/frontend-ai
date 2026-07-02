import type { MenuItem } from '../shared/types/menu';

/**
 * 系统 A 菜单：用户与权限管理
 */
export const systemAMenu: MenuItem[] = [
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
        order: 1,
        permission: 'a:user:list',
      },
      {
        id: 'a-user-role',
        title: '角色权限',
        path: '/system-a/user/role',
        system: 'A',
        order: 2,
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
];

/**
 * 系统 B 菜单：订单中心
 */
export const systemBMenu: MenuItem[] = [
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
        order: 1,
        permission: 'b:order:pending',
      },
      {
        id: 'b-order-history',
        title: '历史订单',
        path: '/system-b/order/history',
        system: 'B',
        order: 2,
        permission: 'b:order:history',
      },
    ],
  },
  {
    id: 'b-report',
    title: '数据报表',
    icon: 'chart',
    path: '/system-b/report',
    system: 'B',
    order: 2,
    permission: 'b:report:view',
  },
];

/**
 * 系统 C 菜单：商品管理
 */
export const systemCMenu: MenuItem[] = [
  {
    id: 'c-product',
    title: '商品管理',
    icon: 'product',
    system: 'C',
    order: 1,
    permission: 'c:product:view',
    children: [
      {
        id: 'c-product-list',
        title: '商品列表',
        path: '/system-c/product/list',
        system: 'C',
        order: 1,
        permission: 'c:product:list',
      },
      {
        id: 'c-product-create',
        title: '发布商品',
        path: '/system-c/product/create',
        system: 'C',
        order: 2,
        permission: 'c:product:create',
      },
    ],
  },
  {
    id: 'c-legacy',
    title: '老库存系统',
    icon: 'archive',
    path: '/system-c/legacy',
    system: 'C',
    order: 99,
    permission: 'c:legacy:view',
  },
];

/**
 * 聚合所有系统的菜单定义
 */
export const ALL_MENUS: MenuItem[] = [
  ...systemAMenu,
  ...systemBMenu,
  ...systemCMenu,
];