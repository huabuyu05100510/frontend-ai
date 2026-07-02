# ICBU 商家平台 MPA → SPA 迁移方案

> 场景：阿里国际 ICBU 商家后台（商品管理 / 订单 / 营销 / 数据分析 / 店铺装修）
> 现状：基于 Velocity 模板引擎的多页应用（MPA），部分页面叠加 jQuery + Rax/React 孤岛
> 目标：统一迁移为 SPA（渐进式），保留微前端架构扩展空间，不影响在线商家
> 对标：AliExpress Seller Center、Lazada Seller Center、Shopify Admin、Amazon Seller Central
> 设计目标：FCP < 1.8s（P75），TTI < 3s，单页导航 < 300ms，灰度迁移零故障率 > 99.5%

---

## 目录

1. [现状诊断与迁移动因](#1-现状诊断与迁移动因)
2. [迁移目标与设计原则](#2-迁移目标与设计原则)
3. [整体架构演进](#3-整体架构演进)
4. [技术选型决策](#4-技术选型决策)
5. [五大核心技术难点](#5-五大核心技术难点)
6. [渐进式迁移策略（双轨并行）](#6-渐进式迁移策略双轨并行)
7. [路由系统设计](#7-路由系统设计)
8. [状态管理迁移](#8-状态管理迁移)
9. [性能优化体系](#9-性能优化体系)
10. [降级与回滚机制](#10-降级与回滚机制)
11. [可观测与质量保障](#11-可观测与质量保障)
12. [安全与权限统一](#12-安全与权限统一)
13. [分阶段落地与里程碑](#13-分阶段落地与里程碑)
14. [面试回答模板](#14-面试回答模板)

---

## 1. 现状诊断与迁移动因

### 1.1 ICBU 商家平台现状

| 维度 | 现状 | 问题 |
|---|---|---|
| **页面数量** | ~200+ 独立页面 | 每次跳转全页刷新，白屏 1~3s |
| **技术栈** | Velocity + Ant Design + 部分 React 孤岛 | 技术栈分裂，共享组件难以复用 |
| **构建体系** | 每页独立打包 (~200 个 webpack 入口) | CI 耗时 30min+，增量构建弱 |
| **状态共享** | 依赖服务端 Session + URL 参数传递 | 跨页面状态丢失、表单数据丢失 |
| **导航体验** | 全页刷新（含 Navigation bar 闪烁） | 商家反馈"页面切换太卡" |
| **多团队协作** | 商品/订单/营销/数据各团队独立维护 | 组件重复造轮子，UI 一致性差 |
| **性能指标** | FCP P75 ≈ 3.5s，LCP P75 ≈ 5s | 流量指标不达标 |
| **国际化** | 每页各自处理 i18n | 文案包重复加载 (~300KB per page) |

### 1.2 迁移收益预期

| 指标 | 迁移前 | 迁移后目标 | 收益 |
|---|---|---|---|
| FCP (P75) | 3.5s | < 1.8s | **-48%** |
| 页面内导航耗时 | 1.5~3s (全刷新) | < 300ms (路由切换) | **-90%** |
| JS 重复加载 | 每页独立加载公共包 | 共享缓存复用 | **-60% 流量** |
| 构建时间 | 30min (全量) | 8min (增量) | **-73%** |
| 组件复用率 | ~30% | > 70% | **+40%** |
| 首屏空白率（弱网 4G） | ~15% | < 3% | **-80%** |

### 1.3 迁移核心挑战

```
┌─────────────────────────────────────────────────────────────┐
│  挑战一：灰度发布   200+ 页面不能一次性切换，需要 MPA/SPA 共存 │
│  挑战二：状态同步   服务端 Session → 客户端 Store 的映射      │
│  挑战三：首屏性能   SPA 的 JS 包体积反而可能使首屏变慢         │
│  挑战四：多团队协作 4 个业务团队独立发布节奏，不能互相阻塞      │
│  挑战五：遗留兼容   部分页面仍有 jQuery/Velocity，短期无法清除  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 迁移目标与设计原则

### 2.1 迁移目标

- **用户无感知**：商家在迁移过程中不感知任何异常，功能与数据完全一致
- **团队解耦**：各业务线可独立迁移、独立发布，不强制整体升级
- **性能提升**：导航体验从"换页白屏"升级到"应用内切换"
- **技术统一**：最终收敛到 React 18 + TypeScript + 统一组件库

### 2.2 核心设计原则

1. **渐进式**：MPA 是旧轨，SPA 是新轨，双轨并行，逐页迁移，可随时回退
2. **壳先行**：先建好 SPA Shell（Layout + 路由 + 权限 + 状态容器），再填充内容
3. **微前端兜底**：单体 SPA 之上保留微前端扩展点，各业务域可独立部署
4. **性能优先**：代码分割、预加载、Streaming SSR 三板斧，杜绝 SPA 首屏退化
5. **可观测贯穿**：迁移的每个阶段都要有性能/错误对比基线，用数据驱动决策

---

## 3. 整体架构演进

### 3.1 三阶段架构演进

```
──────────────────────────────────────────────────────────────
 阶段 0（现状）：纯 MPA
──────────────────────────────────────────────────────────────
  浏览器                  服务端 (Java/Node)
  ┌──────────────────┐    ┌─────────────────────────────────┐
  │  Page A (全页)   │←──│  Velocity 模板 A  /seller/goods │
  │  Page B (全页)   │←──│  Velocity 模板 B  /seller/order │
  │  Page C (全页)   │←──│  Velocity 模板 C  /seller/mkt   │
  └──────────────────┘    └─────────────────────────────────┘
     每次导航 = HTTP 请求 + 全页重建（白屏 ~2s）

──────────────────────────────────────────────────────────────
 阶段 1（过渡）：MPA + SPA 双轨 + Iframe Bridge
──────────────────────────────────────────────────────────────
  浏览器
  ┌──────────────────────────────────────────────────────┐
  │  SPA Shell（新轨：已迁移页面走这里）                   │
  │  ┌────────────────────────────────────────────────┐   │
  │  │ Topbar | Sidebar (统一 Layout)                  │   │
  │  │  ┌─────────────────────┐  ┌─────────────────┐ │   │
  │  │  │  SPA 页面 A (React) │  │  MPA 页面 B     │ │   │
  │  │  │  已迁移             │  │  (Iframe 嵌入)  │ │   │
  │  │  └─────────────────────┘  └─────────────────┘ │   │
  │  └────────────────────────────────────────────────┘   │
  └──────────────────────────────────────────────────────┘

──────────────────────────────────────────────────────────────
 阶段 2（目标）：SPA + 微前端扩展点
──────────────────────────────────────────────────────────────
  浏览器
  ┌──────────────────────────────────────────────────────┐
  │  SPA Shell (Vite + React 18 + React Router v6)       │
  │  ┌──────────────────────────────────────────────────┐ │
  │  │ Layout Shell (TopBar + SideBar + Breadcrumb)     │ │
  │  │  ┌────────────────┬──────────────┬────────────┐  │ │
  │  │  │ 商品域         │  订单域       │  营销域    │  │ │
  │  │  │ (可独立部署)   │ (可独立部署)  │(可独立部署)│  │ │
  │  │  │  /goods/**     │  /order/**    │  /mkt/**   │  │ │
  │  │  └────────────────┴──────────────┴────────────┘  │ │
  │  └──────────────────────────────────────────────────┘ │
  └──────────────────────────────────────────────────────┘
```

### 3.2 技术层次

```
┌──────────────────────────────────────────────────────────────┐
│                    前端 CDN / 边缘缓存                         │
│                 (HTML骨架 + 静态资源 + 路由)                    │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│                      SPA Shell 层                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ 路由引擎  │ │ 权限中心  │ │ 全局状态  │ │  布局 & 导航     │ │
│  │ (RR v6)  │ │ (RBAC)   │ │ (Zustand) │ │  (共享组件)      │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
└────────────────────────────┬─────────────────────────────────┘
                             │
          ┌──────────────────┼────────────────────┐
          ▼                  ▼                    ▼
┌─────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│    商品子域      │ │    订单子域       │ │    营销子域       │
│  /goods/*       │ │  /order/*        │ │  /mkt/*          │
│  (独立打包)      │ │  (独立打包)       │ │  (独立打包)       │
└─────────────────┘ └──────────────────┘ └──────────────────┘
          │                  │                    │
          └──────────────────┼────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                     BFF / API Gateway                         │
│   (统一鉴权 / 限流 / Mock / 灰度路由 / SSR 渲染)               │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 技术选型决策

### 4.1 核心框架选型

| 方案 | 优势 | 劣势 | 结论 |
|---|---|---|---|
| **React 18 + Vite** | 团队现有 React 孤岛基础，Vite 极快构建 | 需自建约定 | ✅ **选用** |
| Next.js | SSR 开箱即用，文档完善 | 框架侵入强，App Router 学习成本，私有化部署复杂 | ❌ 排除 |
| Umi 4 | 阿里系亲和，约定式路由 | 黑盒多，定制困难，国际化不友好 | ⚠️ 备选 |
| Remix | Web 标准优先 | 团队不熟悉，生态较小 | ❌ 排除 |

### 4.2 状态管理选型

| 方案 | 场景适合度 | 包体积 | Bundle 影响 | 结论 |
|---|---|---|---|---|
| **Zustand** | ✅ 轻量、跨模块共享好 | ~3KB | 极小 | ✅ 全局状态 |
| **React Query / SWR** | ✅ 服务端状态天然适配 | ~13KB | 小 | ✅ 服务端状态 |
| Redux Toolkit | 过重，模板代码多 | ~18KB | 中 | ❌ 排除 |
| Jotai | 原子化，好用但较新 | ~3KB | 极小 | ⚠️ 备选 |

### 4.3 微前端方案选型

| 方案 | 隔离性 | 接入成本 | 性能 | 适合场景 | 结论 |
|---|---|---|---|---|---|
| **模块联邦 (Module Federation)** | 中（共享 React） | 低 | 最好（无沙箱开销） | 同技术栈多团队 | ✅ **一期首选** |
| qiankun / micro-app | 高（JS 沙箱 + CSS 隔离） | 高 | 中（沙箱开销） | 异构技术栈共存 | ✅ **兼容旧 MPA** |
| single-spa | 低（无隔离） | 中 | 高 | 路由级拆分 | ⚠️ 不推荐 |
| iframe | 完全隔离 | 低 | 差（内存×N） | 彻底隔离旧系统 | ⚠️ 仅过渡期用 |

**结论**：新业务域用 **Module Federation**；仍未迁移的 MPA 页面临时用 **qiankun + iframe** 嵌入过渡。

### 4.4 路由方案

```
React Router v6 (Data Router 模式)
  - loader / action 支持数据预取（替代传统 componentDidMount 请求）
  - Nested Routes 映射业务层级
  - lazy() + Suspense 天然代码分割
  - errorElement 统一错误边界
```

---

## 5. 五大核心技术难点

### 5.1 难点一：MPA / SPA 双轨路由共存

**问题**：迁移期间，`/seller/goods` 可能还在 MPA，`/seller/order` 已在 SPA，如何做到无感切换？

**方案：路由代理层 + 特性开关**

```
请求 /seller/*
     │
     ▼
 Nginx / BFF 路由代理
     │
     ├─ 命中 SPA 白名单 (feature flag) ──→ 返回 SPA Shell HTML
     │                                      (shell 内部再做客户端路由)
     └─ 未命中              ──────────────→ 转发到原 Velocity 服务
                                            (原 MPA 无变更)
```

```nginx
# nginx 示例：通过 feature-flag Cookie 或 URL 参数灰度
map $cookie_spa_flag $use_spa {
  "1" 1;
  default 0;
}

location /seller/ {
  if ($use_spa) {
    # SPA Shell: 所有路由返回同一 HTML + JS
    try_files $uri /seller/index.html;
  }
  # 否则走原 MPA upstream
  proxy_pass http://mpa_upstream;
}
```

**SPA Shell 内部路由懒加载**：

```ts
// routes/index.tsx
const routes: RouteObject[] = [
  {
    path: '/seller',
    element: <ShellLayout />,
    errorElement: <RootErrorBoundary />,
    children: [
      // 已迁移页面
      {
        path: 'goods',
        lazy: () => import('@goods/routes'),   // Module Federation 远程加载
      },
      {
        path: 'order',
        lazy: () => import('@order/routes'),
      },
      // 未迁移页面：降级到 IframeProxy 组件
      {
        path: 'legacy/*',
        element: <IframeProxy />,
      },
    ],
  },
];
```

### 5.2 难点二：服务端 Session 状态 → 客户端 Store 迁移

**问题**：MPA 页面依赖服务端 Session（登录信息、商家信息、权限列表），SPA 需要在客户端持久化这些状态。

**方案：Bootstrap API + 客户端状态水合**

```
SPA Shell 首次加载
    │
    ▼
GET /api/bootstrap   (单次请求，包含所有初始化数据)
    │
    ▼
{
  "user": { "id": "...", "name": "...", "avatar": "..." },
  "shop": { "shopId": "...", "status": "normal", "level": "gold" },
  "permissions": ["goods:write", "order:read", "mkt:write"],
  "featureFlags": { "newGoodsEditor": true, "betaDashboard": false },
  "i18nBundle": { "zh": {...} },    // 按 locale 返回文案包
  "csrfToken": "xxx"
}
    │
    ▼
useBootstrap() hook 注水到 Zustand Store
    │
    ▼
App 渲染（此时全局状态已就绪，子路由无需再请求用户信息）
```

```ts
// store/bootstrap.ts
interface BootstrapState {
  user: User | null;
  shop: Shop | null;
  permissions: Set<string>;
  featureFlags: Record<string, boolean>;
  status: 'idle' | 'loading' | 'ready' | 'error';
}

export const useBootstrapStore = create<BootstrapState>()((set) => ({
  user: null,
  shop: null,
  permissions: new Set(),
  featureFlags: {},
  status: 'idle',
}));

// App.tsx 入口水合
export function App() {
  const { status } = useBootstrapStore();
  const { data, error } = useSWR('/api/bootstrap', fetcher, {
    revalidateOnFocus: false,
    onSuccess: (data) => {
      useBootstrapStore.setState({
        user: data.user,
        shop: data.shop,
        permissions: new Set(data.permissions),
        featureFlags: data.featureFlags,
        status: 'ready',
      });
    },
  });

  if (status !== 'ready') return <AppSkeleton />;
  return <RouterProvider router={router} />;
}
```

### 5.3 难点三：首屏性能不退化（SPA 的 JS 包陷阱）

**问题**：SPA 若不做优化，首屏 JS 可能从 MPA 的 200KB 膨胀到 1MB+，导致 TTI 反而更慢。

**分层加载策略**：

```
────────────────────────────────────────────────────────
 Critical Path（必须同步）        ~60KB gzipped
────────────────────────────────────────────────────────
  ① Shell HTML（骨架 + 内联关键 CSS）
  ② React 18 Runtime + ReactDOM         ~45KB
  ③ Bootstrap Store + useBootstrap      ~5KB
  ④ Router（仅注册路由，不加载 chunk）  ~10KB

────────────────────────────────────────────────────────
 Eager Preload（当前路由 chunk）   ~100~200KB
────────────────────────────────────────────────────────
  ⑤ Layout 组件（TopBar + Sidebar）
  ⑥ 当前激活页面 chunk（lazy import）
  ⑦ Ant Design 按需 chunk

────────────────────────────────────────────────────────
 Prefetch（下一跳，利用空闲时间）
────────────────────────────────────────────────────────
  ⑧ 最近访问或侧边栏可见的相邻路由 chunk
  ⑨ 用户权限范围内的高频入口 chunk
```

```ts
// 预取策略：悬停 100ms 触发预取（仿浏览器 <link rel="prefetch">）
function usePrefetchOnHover(to: string) {
  const navigate = useNavigate();
  return {
    onMouseEnter: debounce(() => {
      const match = matchRoutes(routes, to);
      match?.forEach(({ route }) => {
        if ('lazy' in route && typeof route.lazy === 'function') {
          route.lazy(); // 触发 lazy import，提前下载 chunk
        }
      });
    }, 100),
  };
}
```

**Streaming SSR（中期目标）**：

```
服务端流式渲染：Shell HTML 先出，数据 Suspense 后补
  0ms:    <html><head>...</head><body><div id="root">
  50ms:   <!-- Shell: Topbar + Sidebar + Skeleton -->
  300ms:  <!-- Suspense 解析：商品列表数据注入 -->
  500ms:  </body></html>
```

### 5.4 难点四：多团队独立发布（Module Federation）

**问题**：商品/订单/营销/数据 4 个团队各自有 Scrum 节奏，不能强制统一发布窗口。

**Module Federation 架构**：

```
┌─────────────────────────────────────────────────────┐
│  Shell（宿主，Host）                                  │
│  - 统一路由注册表（从远端动态拉取路由 manifest）        │
│  - 共享 React / React-DOM / 设计系统（避免重复加载）   │
│  - 权限/用户 Context Provider                        │
└───────────────────────────────────┬─────────────────┘
         动态加载 remoteEntry.js      │
    ┌────────────┬────────────┬──────┘
    ▼            ▼            ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│ goods   │ │ order   │ │  mkt    │
│ Remote  │ │ Remote  │ │ Remote  │
│ v2.3.1  │ │ v1.8.0  │ │ v3.1.2  │
│ CDN地址  │ │ CDN地址  │ │ CDN地址  │
└─────────┘ └─────────┘ └─────────┘
  独立部署     独立部署     独立部署
```

```ts
// vite.config.ts (Shell 宿主)
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    federation({
      name: 'shell',
      remotes: {
        '@goods': `promise new Promise(resolve => {
          fetch('/api/remote-manifest').then(r => r.json()).then(manifest => {
            resolve(manifest.goods.url + '/remoteEntry.js');
          });
        })`,  // 动态从后端获取最新版本 URL，实现热更新
      },
      shared: ['react', 'react-dom', 'react-router-dom', 'zustand'],
    }),
  ],
});
```

**路由 Manifest（动态路由注册）**：

```json
// GET /api/remote-manifest
{
  "goods": {
    "url": "https://cdn.icbu.com/seller/goods/v2.3.1",
    "routes": ["/seller/goods", "/seller/goods/:id", "/seller/goods/new"]
  },
  "order": {
    "url": "https://cdn.icbu.com/seller/order/v1.8.0",
    "routes": ["/seller/order", "/seller/order/:id"]
  }
}
```

### 5.5 难点五：遗留 MPA 页面嵌入（Iframe Bridge）

**问题**：部分复杂度极高的 MPA 页面（如店铺装修 DSL 编辑器）短期无法重写，需要在 SPA Shell 内安全嵌入。

**IframeProxy 通信协议**：

```ts
// components/IframeProxy.tsx
// Shell <-> MPA Iframe 通信（postMessage）

type BridgeMessage =
  | { type: 'NAVIGATE'; to: string }        // Iframe 触发 SPA 路由跳转
  | { type: 'SET_TITLE'; title: string }     // 更新 Shell 标题栏
  | { type: 'SET_BADGE'; count: number }     // 消息数量角标
  | { type: 'REQUEST_TOKEN'; nonce: string } // 请求鉴权 token
  | { type: 'TOKEN_RESPONSE'; token: string; nonce: string }
  | { type: 'SYNC_THEME'; theme: 'light' | 'dark' }
  | { type: 'RESIZE'; height: number };     // 动态高度

export function IframeProxy({ src }: { src: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();
  const { csrfToken } = useBootstrapStore();

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      // 严格校验 origin，防止 XSS
      if (e.origin !== 'https://seller.icbu.alibaba.com') return;

      const msg = e.data as BridgeMessage;
      switch (msg.type) {
        case 'NAVIGATE':
          navigate(msg.to);  // Iframe 内链接 → SPA 路由
          break;
        case 'REQUEST_TOKEN':
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'TOKEN_RESPONSE', token: csrfToken, nonce: msg.nonce },
            'https://seller.icbu.alibaba.com'
          );
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [navigate, csrfToken]);

  return (
    <iframe
      ref={iframeRef}
      src={src}
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
      style={{ width: '100%', height: '100%', border: 'none' }}
      title="Legacy Page"
    />
  );
}
```

---

## 6. 渐进式迁移策略（双轨并行）

### 6.1 灰度迁移流程

```
┌──────────────────────────────────────────────────────────────┐
│  页面迁移生命周期（以"订单列表页"为例）                         │
│                                                              │
│  MPA 线上                                                    │
│  ──────────────────────────────────────────────────────     │
│  100% 流量 → 0%                                             │
│                                                              │
│  SPA 灰度                                                    │
│  ──────────────────────────────────────────────────────     │
│  0% → 5%(内部员工) → 20%(Beta商家) → 50% → 100%             │
│                                                              │
│  判断标准：                                                   │
│  - JS Error Rate < 0.1%                                      │
│  - 功能完整性 UAT 通过                                        │
│  - Core Web Vitals 不低于 MPA 基线                           │
│  - 用户反馈无明显投诉                                         │
└──────────────────────────────────────────────────────────────┘
```

**特性开关控制（Feature Flags）**：

```ts
// 基于 userId 哈希 + 商家等级进行灰度分流
function shouldUseSPA(userId: string, page: string): boolean {
  const flags = useBootstrapStore.getState().featureFlags;
  const key = `spa_${page}`; // e.g., "spa_order_list"

  if (!(key in flags)) return false;  // 未开放 → 走 MPA
  if (flags[key] === true) return true; // 全量开放

  // 哈希灰度：userId 末尾 2 位 < threshold
  const threshold = flags[`${key}_pct`] as number ?? 0;
  const hash = parseInt(userId.slice(-2), 16);
  return (hash % 100) < threshold;
}
```

### 6.2 页面迁移优先级矩阵

```
             访问频率
          高         低
         ┌──────────┬──────────┐
    简单  │ P0 先迁  │ P2 后迁  │
复杂      │（商品列表│（财务报表│
度        │ 订单列表)│ 申诉中心)│
         ├──────────┼──────────┤
    复杂  │ P1 分解  │ P3 暂缓  │
         │（商品编辑│（店铺装修│
         │ 营销配置)│ DSL 编辑)│
         └──────────┴──────────┘
```

**P0（优先迁移）**：
- 商品列表 `/seller/goods` — 每日 UV 最高，迁移收益最大
- 订单列表 `/seller/order` — 商家最频繁操作
- 数据概览 `/seller/dashboard` — 首屏最重要

**P3（暂缓，Iframe 过渡）**：
- 店铺装修编辑器 — 重写成本极高
- 财务核销 — 合规强审计，不敢轻易动

### 6.3 迁移卡点 Checklist

每个页面进入 SPA 前必须通过：

```
迁移准入 Checklist
──────────────────────────────────────────
[ ] React 18 重写完成（TypeScript 严格模式）
[ ] UT 覆盖核心逻辑 > 80%
[ ] E2E 测试覆盖主链路（Playwright）
[ ] 权限校验通过（RBAC 配置正确）
[ ] i18n 文案全覆盖（中/英/阿拉伯语 RTL 检查）
[ ] Core Web Vitals FCP < 2s / TTI < 3.5s
[ ] 无障碍访问 a11y 通过 axe-core 扫描
[ ] 移动端响应式适配（1280px / 1024px 断点）
[ ] 错误边界覆盖（Sentry sourcemap 上传）
[ ] 灰度配置 Done（feature flag key 注册）
```

---

## 7. 路由系统设计

### 7.1 路由层级设计

```
/seller
  ├── /seller/goods                    # 商品管理
  │     ├── /seller/goods              # 商品列表（index）
  │     ├── /seller/goods/new          # 发布商品
  │     └── /seller/goods/:id/edit     # 编辑商品
  ├── /seller/order                    # 订单管理
  │     ├── /seller/order              # 订单列表
  │     └── /seller/order/:id          # 订单详情
  ├── /seller/mkt                      # 营销工具
  │     ├── /seller/mkt/coupon         # 优惠券
  │     └── /seller/mkt/campaign       # 活动
  ├── /seller/data                     # 数据中心
  │     └── /seller/data/overview      # 经营概览
  └── /seller/settings                 # 店铺设置
```

### 7.2 路由守卫

```ts
// 权限路由守卫
function PermissionGuard({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const permissions = useBootstrapStore((s) => s.permissions);
  const location = useLocation();

  if (!permissions.has(permission)) {
    return <Navigate to="/seller/403" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

// 路由定义中嵌入守卫
{
  path: 'goods/new',
  element: (
    <PermissionGuard permission="goods:write">
      <NewGoodsPage />
    </PermissionGuard>
  ),
}
```

### 7.3 历史路由兼容（MPA 旧链接不断）

```ts
// 旧 MPA URL → SPA URL 的重定向映射
// MPA: /seller/product/list.htm → SPA: /seller/goods
const legacyRedirects: Record<string, string> = {
  '/seller/product/list.htm': '/seller/goods',
  '/seller/order/list.htm': '/seller/order',
  '/seller/shop/decoration.htm': '/seller/legacy/shop-decoration', // Iframe 过渡
};

// Nginx 层做 301 永久重定向
// 同时在 SPA Router 层做兜底
{
  path: 'product/list.htm',
  element: <Navigate to="/seller/goods" replace />,
}
```

---

## 8. 状态管理迁移

### 8.1 状态分层

```
┌─────────────────────────────────────────────────────┐
│  全局持久状态 (Zustand)                               │
│  - 用户信息 / 店铺信息 / 权限 / 特性开关               │
│  - 全局通知 / 消息数量                               │
│  - 主题 / 语言偏好                                   │
├─────────────────────────────────────────────────────┤
│  服务端状态 (React Query)                             │
│  - 商品列表 / 订单列表 / 营销数据                     │
│  - 自动缓存、后台刷新、乐观更新                       │
├─────────────────────────────────────────────────────┤
│  页面局部状态 (useState / useReducer)                 │
│  - 表单草稿 / 弹窗开关 / 选中行 / 筛选条件            │
├─────────────────────────────────────────────────────┤
│  URL 状态 (Search Params)                             │
│  - 分页 / 排序 / 筛选 / Tab（可分享、可刷新）          │
└─────────────────────────────────────────────────────┘
```

### 8.2 旧 jQuery 数据绑定 → React Query 迁移

**迁移前（MPA 方式）**：

```js
// 旧代码：jQuery AJAX + 手动 DOM 更新
$.ajax({
  url: '/api/goods/list',
  success: function(data) {
    $('#goods-table').html(renderTable(data.list));
    $('#total').text(data.total);
  }
});
```

**迁移后（React Query）**：

```ts
// 新代码：声明式数据获取
function GoodsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get('page') ?? 1);
  const status = searchParams.get('status') ?? 'all';

  const { data, isLoading } = useQuery({
    queryKey: ['goods', { page, status }],
    queryFn: () => fetchGoodsList({ page, status }),
    staleTime: 30_000,          // 30s 内不重新请求
    placeholderData: keepPreviousData, // 翻页时保留旧数据，不闪烁
  });

  return (
    <GoodsTable
      data={data?.list}
      loading={isLoading}
      pagination={{
        current: page,
        total: data?.total,
        onChange: (p) => setSearchParams({ page: String(p), status }),
      }}
    />
  );
}
```

### 8.3 跨域子应用状态共享

```ts
// Shell 通过 Context 向 Module Federation 子应用注入全局状态
// 子应用不需要再发 bootstrap 请求
const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const bootstrapStore = useBootstrapStore();
  return (
    <ShellContext.Provider value={{ bootstrapStore, queryClient }}>
      {children}
    </ShellContext.Provider>
  );
}

// 子应用 (goods remote) 中使用
export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('Must be used within Shell');
  return ctx;
}
```

---

## 9. 性能优化体系

### 9.1 Bundle 优化策略

```
分包策略 (Vite manualChunks)
──────────────────────────────────────────────────────
  vendor-react.js        React + ReactDOM + RR    ~50KB
  vendor-antd.js         Ant Design (按需)        ~200KB
  vendor-query.js        React Query               ~15KB
  shell.js               Shell 核心代码             ~30KB
  goods.[hash].js        商品域 (懒加载)           ~150KB
  order.[hash].js        订单域 (懒加载)           ~100KB
  mkt.[hash].js          营销域 (懒加载)           ~120KB
  ──────────────────────
  首屏 Critical Path:    ~95KB gzipped ✅
```

### 9.2 资源预加载

```html
<!-- Shell HTML 输出时注入 preload hint -->
<!-- 当前路由的 chunk -->
<link rel="modulepreload" href="/assets/goods.abc123.js">

<!-- 高概率下一跳（侧边栏前 3 项） -->
<link rel="prefetch" href="/assets/order.def456.js">
<link rel="prefetch" href="/assets/mkt.ghi789.js">
```

### 9.3 导航性能目标

| 场景 | P50 目标 | P95 目标 | 优化手段 |
|---|---|---|---|
| 首次进入 Shell（冷启动） | < 1.8s FCP | < 3.5s TTI | 关键路径 < 60KB + HTML 骨架 |
| 已迁移页面间切换 | < 200ms | < 500ms | chunk 已缓存 + React 渲染 |
| 首次进入新域（chunk 未缓存） | < 800ms | < 1.5s | prefetch + Suspense skeleton |
| Iframe MPA 页面加载 | < 2.5s | < 5s | 异步加载，不阻塞 SPA |

### 9.4 图片与媒体资源

- 商品图片使用 `loading="lazy"` + WebP（阿里云 OSS 转码）
- SPU 图片列表使用虚拟滚动（@tanstack/react-virtual）
- 店铺 Banner 使用 `<link rel="preload" as="image">`

---

## 10. 降级与回滚机制

### 10.1 两级降级

```
L0: SPA Shell + 完整子应用正常运行                    (默认)
  └ 子应用远端加载失败 ↓
L1: SPA Shell + 降级到 IframeProxy（加载旧 MPA URL）
  └ Bootstrap API 失败 ↓
L2: 直接走 MPA 旧页面（Nginx fallback 关闭 SPA flag）
  └ 完全不可用 ↓
L3: 静态降级页面（"系统维护中，请刷新重试"）
```

### 10.2 模块联邦加载失败降级

```ts
// 远程 chunk 加载失败时，优雅降级到旧 MPA
async function loadRemoteGoods() {
  try {
    return await import('@goods/routes');
  } catch (e) {
    // 上报错误到监控
    reportError('MF_LOAD_FAILED', { module: 'goods', error: e });

    // 降级策略：显示 IframeProxy 嵌入旧 MPA
    return {
      default: () => <IframeProxy src="https://seller.icbu.com/seller/goods" />,
    };
  }
}
```

### 10.3 一键回滚

```bash
# 发布脚本中的回滚入口
# 将 SPA feature flag 关闭，立即恢复 100% MPA 流量
curl -X POST 'https://config.icbu.alibaba.com/flags/spa_goods_list' \
  -d '{"enabled": false, "rollback_reason": "FCP regression detected"}'
```

---

## 11. 可观测与质量保障

### 11.1 迁移期间双模型监控

迁移期间**同时对 MPA 和 SPA 采集同一批指标**，做实时对比：

```
指标名                  MPA 基线    SPA 目标    告警阈值
───────────────────────────────────────────────────────
page_fcp_p75           3.5s       < 1.8s      > 2.5s 告警
page_tti_p75           5.0s       < 3.5s      > 4.5s 告警
nav_duration_p75       2.0s       < 300ms     > 500ms 告警
js_error_rate          0.08%      < 0.1%      > 0.5% 告警
api_error_rate         0.5%       < 0.5%      > 1% 告警
chunk_load_failure     -          -           > 0.01% 告警 (MF)
```

### 11.2 性能埋点

```ts
// 路由切换性能打点
function NavigationPerf() {
  const navigation = useNavigation();

  useEffect(() => {
    if (navigation.state === 'idle') {
      const entry = performance.getEntriesByType('navigation')[0];
      track('spa_navigation', {
        from: prevLocation.current,
        to: location.pathname,
        durationMs: performance.now() - navStartTime.current,
        type: 'soft_nav',
      });
    }
  }, [navigation.state]);
}
```

### 11.3 用户体验指标

```ts
// 使用 web-vitals 上报 Core Web Vitals
import { onFCP, onLCP, onCLS, onINP, onTTFB } from 'web-vitals';

onFCP((metric) => track('CWV_FCP', { value: metric.value, rating: metric.rating }));
onLCP((metric) => track('CWV_LCP', { value: metric.value }));
onINP((metric) => track('CWV_INP', { value: metric.value }));  // 替代 FID
```

### 11.4 错误追踪

```ts
// Sentry 集成（sourcemap 自动上传 CI）
Sentry.init({
  dsn: 'https://xxx@sentry.io/icbu-seller',
  release: __APP_VERSION__,
  integrations: [
    Sentry.reactRouterV6BrowserTracingIntegration({ useEffect, useLocation, useNavigationType }),
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: false }),
  ],
  tracesSampleRate: 0.1,   // 10% 性能采样
  replaysOnErrorSampleRate: 1.0,  // 报错 100% 录屏
});
```

---

## 12. 安全与权限统一

### 12.1 RBAC 权限统一

```
MPA 时代：每个页面各自调用 /api/check-permission (N+1 问题)
SPA 时代：Bootstrap 一次性下发所有权限 Token
```

```ts
// 权限 Hook（替代分散在各页面的权限请求）
function usePermission(permission: string): boolean {
  return useBootstrapStore((s) => s.permissions.has(permission));
}

// 使用
const canCreateGoods = usePermission('goods:write');
```

### 12.2 CSRF 防护

```ts
// SPA 所有变更请求携带 CSRF Token
const axiosInstance = axios.create({
  baseURL: '/api',
});

axiosInstance.interceptors.request.use((config) => {
  const { csrfToken } = useBootstrapStore.getState();
  if (['post', 'put', 'delete', 'patch'].includes(config.method ?? '')) {
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});
```

### 12.3 IframeProxy 安全

- 严格 `sandbox` 属性，禁止 `allow-top-navigation`（防止钓鱼跳转）
- `postMessage` 严格校验 `origin`
- CSP `frame-ancestors` 限制只允许 `seller.icbu.alibaba.com` 嵌入

---

## 13. 分阶段落地与里程碑

### Phase 0：技术评审与基础建设（3 周）

- [ ] 技术选型 RFC 评审（React Router v6 / Zustand / Module Federation）
- [ ] Shell 骨架原型（Layout + 路由 + 权限 + Bootstrap API）
- [ ] 性能基线采集（MPA 现状 FCP/TTI/导航耗时）
- [ ] 灰度发布基础设施（Feature Flag 服务 + Nginx 规则）
- [ ] CI/CD 流水线调整（Vite 构建 + Sentry sourcemap 上传）
- [ ] 迁移准入 Checklist 和 E2E 测试框架（Playwright）搭建

### Phase 1：Shell + P0 页面（6 周）

- [ ] SPA Shell 上线（Layout / 权限 / Bootstrap，仅 1% 内部流量）
- [ ] 商品列表 `/seller/goods` 迁移（P0，最高频）
- [ ] 订单列表 `/seller/order` 迁移（P0）
- [ ] 数据概览 `/seller/dashboard` 迁移（P0）
- [ ] 旧 MPA 页面 IframeProxy 接入（P3 页面兜底）
- [ ] 对比监控 Dashboard 上线（MPA vs SPA 指标并行）
- [ ] **里程碑**：3 个 P0 页面 SPA 化，Beta 商家 5% 灰度，FCP 达标

### Phase 2：Module Federation + 多团队接入（8 周）

- [ ] Module Federation 架构落地（goods / order / mkt 三域独立打包）
- [ ] 各子域 CI/CD 独立部署流水线
- [ ] P1 高频复杂页面迁移（商品编辑器、营销配置）
- [ ] 共享组件库版本统一（@icbu/seller-ui）
- [ ] i18n 统一（中/英/阿拉伯语 RTL 验证）
- [ ] **里程碑**：迁移覆盖 60% 页面，50% 商家流量切换

### Phase 3：全量切换 + 性能冲刺（6 周）

- [ ] 剩余 P2 页面全量迁移
- [ ] Streaming SSR 试点（数据概览页）
- [ ] Prefetch 策略精细化（基于用户行为模型）
- [ ] 移除 Nginx MPA fallback（仅保留 P3 Iframe 页面）
- [ ] 性能优化冲刺：FCP P75 < 1.5s，导航 < 200ms
- [ ] **里程碑**：100% 商家流量走 SPA，MPA 服务进入只读维护

### Phase 4：MPA 下线 + 技术债清偿（4 周）

- [ ] IframeProxy 页面逐步重写（或保留为独立微前端）
- [ ] 下线 Velocity 模板服务
- [ ] jQuery / 旧组件库代码彻底清除
- [ ] 性能 & 稳定性 SLA 复盘
- [ ] 最终 Core Web Vitals 目标验收

---

## 14. 面试回答模板

### 14.1 一句话定义

> 我们采用"**双轨渐进 + 壳先行**"策略，以 Nginx 特性开关为切换枢纽，先建 SPA Shell（React Router v6 + Zustand + Module Federation），再逐页将 MPA 迁入，IframeProxy 桥接无法短期重写的遗留页面，实现商家无感知的平滑迁移。

### 14.2 三分钟版

> ICBU 商家平台有 200+ MPA 页面，每次跳转全页刷新白屏约 2 秒，FCP 均值 3.5s，且各团队技术栈割裂，严重影响商家效率和研发产能。
>
> 我们设计了四个核心机制：
>
> **① 壳先行**：先上线 SPA Shell，包含统一 Layout、权限路由守卫、Bootstrap API 一次性下发用户/权限/FeatureFlags，不破坏现有 MPA 服务。
>
> **② 双轨并行**：Nginx 层用 Feature Flag 做流量分流，同一个 URL 既可走 MPA 也可走 SPA，按 userId 哈希灰度，任意时刻可一键回滚到 MPA 基线。
>
> **③ Module Federation**：商品/订单/营销/数据 4 个团队独立打包、独立部署，Shell 通过动态路由 Manifest 热加载各域 remote 模块，互不阻塞发布节奏。
>
> **④ IframeProxy 桥接**：店铺装修编辑器等复杂度极高的页面，通过 IframeProxy + postMessage 协议嵌入 SPA Shell，短期不重写、长期再规划。
>
> 性能上：首屏关键路径压缩到 ~60KB gzipped，配合 prefetch + React Router lazy，页面内导航从 2s 降到 < 300ms，FCP P75 从 3.5s 目标降到 1.8s。
>
> 按 4 个 Phase 落地：Phase1 建 Shell + P0 页面（6 周），Phase2 多团队 MF 接入（8 周），Phase3 全量 + SSR 冲刺（6 周），Phase4 下线 MPA（4 周），**全程不停服、不影响在线商家**。

### 14.3 追问回答要点

**Q：为什么不用 Next.js？**
> Next.js App Router 在 Monorepo 多团队 Module Federation 场景下框架侵入过强，且我们内部有私有化部署需求，自建 Vite 方案更可控。SSR 我们在 Phase3 用 React 18 Streaming SSR 自实现，不依赖框架。

**Q：Module Federation 版本兼容怎么处理？**
> 通过动态 Manifest API（`/api/remote-manifest`）管理每个子应用的版本 URL，Shell 不写死 remote 地址。共享库（React/ReactDOM）在 Shell 端固定版本，子应用声明 `singleton: true`，强制复用 Shell 的实例，避免多版本 React 问题。

**Q：IframeProxy 性能差怎么办？**
> Iframe 仅用于无法短期迁移的 P3 页面（< 10 个），且是懒加载不会阻塞主渲染。用户导航到 P3 页面时显示 Skeleton，异步加载 Iframe。同时我们在 OKR 里明确 P3 页面在 6 个月内完成迁移，Iframe 是临时桥梁不是长期方案。

**Q：灰度过程中 MPA 和 SPA 状态不一致怎么办？**
> 商家的持久化数据在服务端（数据库），不存在状态不一致问题。客户端临时状态（如表单草稿）MPA 中是存在 `sessionStorage`，SPA 中是 React 状态，跨渲染模式本来就不会保留，在灰度切换边界提示用户保存即可。

**Q：迁移中如何保证不影响在线商家？**
> 三个保障：① Nginx 双轨 + Feature Flag，30 秒内可一键关闭 SPA 入口；② 每个页面上 SPA 前必须通过准入 Checklist（E2E 测试 + 性能基线 + 5% Beta 灰度观察 24h）；③ 告警阈值设为 MPA 基线的 120%，任何指标劣化自动触发回滚。

**Q：首屏性能如何保证 FCP < 1.8s？**
> 四板斧：① 关键路径 JS 压缩到 ~60KB gzipped（只含 React + Shell 核心）；② HTML 骨架内联关键 CSS，避免 FOUC；③ Bootstrap API 与页面数据请求并发发出（不串行）；④ 当前路由 chunk `modulepreload`，相邻路由 `prefetch`。Phase3 上 Streaming SSR 后，服务端先推 Shell HTML 骨架，再 `<Suspense>` 注入数据。

**Q：RTL（阿拉伯语）怎么支持？**
> i18n 统一在 Shell 层处理，Bootstrap API 返回当前 locale，Shell 注入 `<html dir="rtl">`。组件库选择原生支持 RTL 的 Ant Design（v5 `ConfigProvider locale`），避免手写 `transform: scaleX(-1)` hack。迁移准入 Checklist 中有 RTL 视觉验收项。

---

## 附录 A：关键依赖版本

```json
{
  "react": "^18.3.0",
  "react-dom": "^18.3.0",
  "react-router-dom": "^6.23.0",
  "zustand": "^4.5.0",
  "@tanstack/react-query": "^5.40.0",
  "vite": "^5.2.0",
  "@originjs/vite-plugin-federation": "^1.3.5",
  "antd": "^5.18.0",
  "@sentry/react": "^8.0.0",
  "web-vitals": "^3.5.2",
  "@tanstack/react-virtual": "^3.5.0",
  "axios": "^1.7.0"
}
```

## 附录 B：参考资料

- [React Router v6 Data Router](https://reactrouter.com/en/main/routers/create-browser-router)
- [Module Federation Plugin (Vite)](https://github.com/originjs/vite-plugin-federation)
- [Web Vitals — Chrome Developers](https://web.dev/vitals/)
- [Shopify Polaris — Admin SPA 迁移经验](https://shopify.engineering/)
- [micro-app 微前端框架](https://micro-zoe.github.io/micro-app/)
- [Webpack Module Federation 官方文档](https://webpack.js.org/concepts/module-federation/)

---

> 配套子文档（待补全）：
> - `mpa-to-spa-shell-design.md`：Shell 组件详细设计（Layout / 权限 / 导航）
> - `mpa-to-spa-module-federation.md`：MF 多团队接入规范与 versioning 策略
> - `mpa-to-spa-perf-budget.md`：性能预算与 CI 卡口配置
> - `mpa-to-spa-rollback-runbook.md`：灰度回滚 Runbook
