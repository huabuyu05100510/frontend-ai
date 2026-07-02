# 三个中后台整合 Demo

> 一站式 SPA + iframe 混合方案的真实可运行 Demo，对应 [`../three-backstage-micro.md`](../three-backstage-micro.md) 文档中的"版本二（一体化 SPA）+ 混合方案"。

## ✨ 特性

- **统一 Header / Layout** - 三个系统共用同一份外壳
- **动态菜单聚合** - 按权限码过滤，按 system 分组，按 order 排序
- **老域名兼容** - 所有二级域名指向同一份 SPA，hostname → basename 映射
- **只刷 Content** - 站内导航用 React Router，Header / Sidebar 不重建
- **iframe 兼容** - 演示了老系统通过 iframe 嵌入的混合模式
- **完整测试** - 42 个单元测试 + 端到端测试，覆盖率核心层 100%

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
# → http://localhost:5173

# 运行测试
npm test

# 测试覆盖率
npm run test:coverage

# 构建生产
npm run build
```

## 🏗️ 目录结构

```
three-backstage-demo/
├── src/
│   ├── App.tsx                       # 顶层应用 + 路由分发
│   ├── main.tsx                      # 入口
│   ├── shell/                        # 外壳
│   │   ├── components/
│   │   │   ├── Header.tsx           # 共用 Header
│   │   │   ├── Sidebar.tsx          # 动态菜单
│   │   │   ├── Layout.tsx           # 三段式布局
│   │   │   ├── Dashboard.tsx        # 首页
│   │   │   ├── Profile.tsx          # 个人中心
│   │   │   ├── Login.tsx            # 登录页（含三个预置账号）
│   │   │   └── NotFound.tsx
│   │   └── shell.css                 # 全局样式
│   ├── modules/                      # 业务模块（独立打包）
│   │   ├── system-a/                 # 系统 A：用户中心
│   │   │   ├── routes.tsx
│   │   │   └── pages/
│   │   │       ├── UserList.tsx     # 用户列表 + 增删改查
│   │   │       ├── UserDetail.tsx   # 用户详情
│   │   │       ├── UserRole.tsx     # 角色权限
│   │   │       └── DashboardA.tsx   # 运营看板（图表）
│   │   ├── system-b/                 # 系统 B：订单中心
│   │   │   ├── routes.tsx
│   │   │   └── pages/
│   │   │       ├── OrderList.tsx    # 订单列表 + Tab + 状态切换
│   │   │       └── Report.tsx       # 数据报表
│   │   └── system-c/                 # 系统 C：商品中心
│   │       ├── routes.tsx
│   │       └── pages/
│   │           ├── ProductList.tsx  # 商品列表 + 分类切换
│   │           ├── ProductCreate.tsx # 发布商品
│   │           └── LegacyIframe.tsx  # iframe 兼容演示
│   ├── menu/                         # 菜单
│   │   ├── definitions.ts            # 三个系统的菜单定义
│   │   └── aggregator.ts             # 过滤 + 排序聚合器
│   ├── auth/store.ts                 # 登录态（zustand）
│   ├── config/domains.ts             # 域名 → basename 映射
│   └── shared/                       # 共享类型与工具
├── SPEC.md                           # 完整规约（需求 / 架构 / 验收）
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 🎯 演示账号

打开应用后，在登录页可切换三个预置账号：

| 账号 | 角色 | 可见菜单 |
|------|------|---------|
| 管理员 | 超级管理员 | 全部（用户 / 订单 / 商品 + 老库存 iframe） |
| 运营小李 | 运营经理 | 用户列表 / 看板 / 待处理订单 / 商品列表 |
| 商家老王 | 商家 | 只看商品管理 |

## 📋 验收路径

1. **登录页** → 选择"管理员" → 登录
2. **Dashboard** - 看到四个核心指标卡片
3. **系统 A** - 点击"用户列表" → 增删改查 → 点击用户名进详情
4. **系统 B** - 点击"待处理订单" → Tab 切换 → 改状态
5. **系统 C** - 点击"商品列表" → 分类切换 → 发布新商品
6. **iframe 兼容** - 点击"老库存系统" → 看 jQuery 老系统模拟
7. **权限切换** - 退出登录 → 选"商家老王" → 只看到商品管理
8. **站内导航验证** - 反复切换不同系统菜单，Header / Sidebar 始终不动（DevTools Elements 面板可以验证）

## 🧪 测试

```bash
npm test                    # 跑全部测试
npm run test:coverage       # 覆盖率报告
npm run test:ui             # Vitest UI
```

测试统计：

```
Test Files  6 passed (6)
     Tests  42 passed (42)
```

## 🔗 相关文档

- [`../three-backstage-micro.md`](../three-backstage-micro.md) - 完整技术方案（含版本一 iframe / 版本二一体化 / 混合方案）
- [`./SPEC.md`](./SPEC.md) - 本 Demo 的 SPEC（需求 / 架构 / 验收清单）

## 📦 技术栈

- React 18 + TypeScript
- React Router v6
- Zustand（状态管理）
- Vite（构建）
- Vitest + Testing Library（测试）
- localStorage（业务数据持久化）