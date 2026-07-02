# SPEC：三个中后台一体化整合方案

## 一、需求（Requirements）

### R1. 三个独立系统整合

- **R1.1** 系统 A：用户与权限管理（用户列表 / 角色权限 / 运营看板）
- **R1.2** 系统 B：订单中心（待处理订单 / 历史订单 / 数据报表）
- **R1.3** 系统 C：商品管理（商品列表 / 发布商品 / 老库存 iframe 兼容）

### R2. 公共能力

- **R2.1** Header 共用：三个系统顶部一致（Logo / 全局搜索 / 用户头像 / 退出）
- **R2.2** Menu 独立：每个系统有自己的菜单结构、权限
- **R2.3** 只刷新 Content：切换路由不刷新 Header 和 Menu
- **R2.4** 登录态一致：用户在任一系统登录，三个系统都认

### R3. 历史域名兼容

- **R3.1** 用户书签 `a.example.com/xxx` 仍能访问
- **R3.2** 不能用 301 重定向（会触发整页刷新）
- **R3.3** 所有二级域名部署同一份 SPA

### R4. 性能与构建

- **R4.1** 三个系统模块独立打包，按需加载（lazy + Suspense）
- **R4.2** 共享库单独 chunk（react / react-router-dom）
- **R4.3** 首次进入只下载对应系统 chunk + shared

---

## 二、架构（Architecture）

### A1. 总体结构

```
                  console.example.com（一站式入口）
                           │
                  ┌────────┴────────┐
                  │   SPA Bundle    │
                  │  - Shell        │
                  │  - 路由分发      │
                  │  - lazy chunks  │
                  └────────┬────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   system-a chunk    system-b chunk    system-c chunk
   - DashboardA      - OrderList       - ProductList
   - UserList        - Report          - ProductCreate
   - UserRole                           - LegacyIframe
   - UserDetail
```

### A2. 域名映射

| 域名 | BrowserRouter basename |
|------|----------------------|
| `a.example.com` | `/system-a` |
| `b.example.com` | `/system-b` |
| `c.example.com` | `/system-c` |
| `console.example.com` | `''` |
| `localhost` | `''`（开发） |

### A3. 模块划分

- `src/shell/` - 外壳（Header / Sidebar / Layout / Login / Profile）
- `src/modules/system-{a,b,c}/` - 各系统业务模块
- `src/menu/` - 菜单定义与聚合器
- `src/auth/` - 登录态管理
- `src/config/` - 域名等全局配置
- `src/shared/` - 共享类型、工具、数据 mock

---

## 三、行为（Behavior）

### B1. 登录流程

```
1. 用户访问 / (未登录)
2. ProtectedRoute 检测 isLoggedIn() === false
3. <Navigate to="/login" replace />
4. 用户点击预置账号按钮（admin / operator / merchant）
5. 点击登录 → login(user, permissions)
6. navigate('/') → 渲染 Dashboard
```

### B2. 菜单渲染

```
1. Sidebar 从 useAuthStore.permissions 读取权限码
2. buildMenu(ALL_MENUS, permissions) 调用聚合器
3. 过滤无权限项 → 按 order 排序 → 按 system 分组
4. 渲染三段：用户中心 / 订单中心 / 商品中心
```

### B3. 路由切换（不刷新 Header / Menu）

```
1. 用户点击 Sidebar 菜单项
2. navigate(path) - 只改 URL，不发请求
3. React Router 重新匹配 <Routes>
4. Suspense 加载对应 chunk（如未缓存）
5. 渲染新页面，<Layout> 不卸载，Header / Sidebar 不重建
```

### B4. 老域名兼容

```
1. 用户访问 https://a.example.com/user/list
2. Nginx 同源转发到同一份 SPA 构建产物
3. SPA 启动：window.location.hostname = 'a.example.com'
4. resolveBasename() 返回 '/system-a'
5. <BrowserRouter basename="/system-a"> 解释 URL
6. 匹配 /system-a/* → SystemARoutes → 渲染 UserList
7. 全程无 301 重定向，无整页刷新
```

---

## 四、数据模型（Data Model）

### MenuItem

```ts
interface MenuItem {
  id: string;
  title: string;
  icon?: string;
  path?: string;
  children?: MenuItem[];
  permission?: string;
  system: 'A' | 'B' | 'C';
  order?: number;
}
```

### User

```ts
interface User {
  id: string;
  name: string;
  avatar?: string;
  email?: string;
}
```

### 业务实体

- **SystemAUser**: id / name / email / department / role / status / createdAt
- **Order**: id / customer / amount / status / createdAt / items
- **Product**: id / name / category / price / stock / status / cover / createdAt

---

## 五、关键技术决策（Decisions）

### D1. 为什么选一体化 SPA 而不是 iframe？

✅ 三个系统同主域，技术栈统一（React 18 + TS）
✅ 菜单可整合（每个系统提供 MenuItem[]，聚合为一棵树）
✅ 一体化首屏更快、内存更低、SEO 友好
✅ 站内导航靠 pushState，不发请求、不刷新
❌ iframe 适合跨主域 / 老系统 / 不愿重构

### D2. 为什么老域名不能 301？

301 触发整页刷新，HTML / JS / React 全部重建，Header 与 Menu 状态丢失。改用"所有域名指向同一份 SPA + hostname → basename 映射"。

### D3. 为什么用 lazy + Suspense？

三个系统模块互不依赖，分别 lazy 加载后进入哪个系统只下载对应 chunk。配合 Vite `manualChunks`，shared 库也独立 chunk。

### D4. 为什么用 zustand 而不是 Redux？

zustand 体积小（<1KB），无 Provider 嵌套，store 可在任意位置定义。zustand 的 `setState` 让测试也能直接操作 store 状态（`useAuthStore.setState(...)`）。

---

## 六、验收清单（Acceptance Criteria）

### ✅ 已自动化验收（42 个测试通过）

| 维度 | 验收点 | 测试位置 |
|------|-------|---------|
| 菜单聚合 | 按权限过滤 | `src/menu/__tests__/aggregator.test.ts` |
| 菜单聚合 | 按 order 排序 | 同上 |
| 菜单聚合 | 父子递归 | 同上 |
| 域名映射 | a/b/c/console → 各自 basename | `src/config/__tests__/domains.test.ts` |
| 域名映射 | fallback 处理 | 同上 |
| 登录态 | login/logout/hasPermission | `src/auth/__tests__/auth.test.ts` |
| Sidebar | 按权限渲染分组 | `src/shell/components/__tests__/Sidebar.test.tsx` |
| Sidebar | 排序正确 | 同上 |
| Sidebar | 点击菜单导航 | 同上 |
| UserList | localStorage 读写 | `src/shell/components/__tests__/UserList.test.tsx` |
| UserList | 搜索过滤 | 同上 |
| UserList | 新增用户流程 | 同上 |
| App 端到端 | 登录 → Dashboard | `src/shell/components/__tests__/App.test.tsx` |
| App 端到端 | 切系统不刷新 Header/Sidebar | 同上 |
| App 端到端 | 退出登录 | 同上 |
| App 端到端 | 不同账号看到不同菜单 | 同上 |

### 🎯 手工验收（启动 dev server）

```bash
cd v3/micro/three-backstage-demo
npm install
npm run dev
# 访问 http://localhost:5173
```

| 步骤 | 操作 | 期望结果 |
|------|------|---------|
| 1 | 打开首页 | 自动跳转登录页 |
| 2 | 点击"管理员"账号 → 登录 | 进入 Dashboard，看到"欢迎回来，管理员" |
| 3 | 点击侧边栏"用户列表" | URL 变为 /system-a/user/list，Header/Sidebar 不变 |
| 4 | 点击"新增用户" → 填写表单 → 提交 | 表格新增一行 |
| 5 | 点击"待处理订单" | 切换到 /system-b/order/pending，图表数据展示 |
| 6 | 点击"商品列表" | 切换到 /system-c/product/list，分类切换 |
| 7 | 点击"发布商品" → 填写 → 提交 | 跳回商品列表，新商品出现在第一行 |
| 8 | 点击"老库存系统" | 展示 iframe 兼容模块，模拟 jQuery 老系统 |
| 9 | 点击退出登录 | 回到登录页 |
| 10 | 切换"运营小李"账号登录 | 菜单只剩部分可见（受权限控制） |

### 📊 覆盖率指标

```
核心逻辑层（auth / config / menu）：87% - 100%
业务层（system-a UserList / Detail / system-b OrderList）：85% - 100%
Shell 组件层（Sidebar / Layout / Login / Dashboard）：100%
```

---

## 七、风险与限制（Risks & Limitations）

### R1. 数据持久化用 localStorage

⚠️ 本 Demo 所有业务数据存 localStorage。生产环境应替换为真实后端 API。

### R2. 登录态用 zustand 内存存储

⚠️ 刷新页面会丢失登录态。生产环境应配合 Cookie / localStorage 持久化（zustand 有 `persist` 中间件）。

### R3. iframe 兼容模块是模拟

⚠️ `LegacyIframe.tsx` 直接渲染了等价数据，不是真的 iframe 嵌入。生产环境应：

```jsx
<iframe
  src="https://legacy-inventory.example.com/dashboard"
  className="iframe-wrapper-frame"
  ref={iframeRef}
  onLoad={handleIframeLoad}
/>
```

并通过 `postMessage` 接收高度上报，详见 `three-backstage-micro.md` 文档第 6 节。

### R4. 权限码 hardcoded

⚠️ Login 组件里预置了三个演示账号的权限码。生产环境应改为调用 `/api/auth/login` 接口获取。

### R5. 未做 SSR

⚠️ 本 Demo 是纯 CSR。生产环境如果需要 SEO 友好，可改造为 Next.js 或 Vite SSR + 边缘函数。