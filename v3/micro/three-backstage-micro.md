# 三个中后台整合：Header 共用 / Menu 独立 / 只刷 Content / 登录态一致

## 一、需求拆解

| 项 | 要求 | 含义 |
|---|---|---|
| Header | 共用 | 三个系统顶部一致（Logo / 用户信息 / 全局搜索 / 退出） |
| Menu（侧边栏） | 各自独立 | 三个系统的菜单结构、权限、顺序都不一样 |
| Content | 只刷中间 | 切换路由时不刷新 Header 和 Menu |
| 登录态 | 三系统共享 | 用户在任一系统登录，三个系统都认 |

> **关键判断**：这不是"iframe 嵌入"或"qiankun 基座"的标准微前端——是"统一外壳 + 三个独立 SPA 路由分发"的形态。**iframe + postMessage + 主域 Cookie** 是性价比最高的方案。

---

## 二、整体架构

```
                   app.example.com（主域）
                          │
            ┌─────────────┴─────────────┐
            │   主应用 Shell（部署在 /） │
            │   ┌────────────────────┐  │
            │   │ Header（共用）      │  │
            │   ├────────────────────┤  │
            │   │ Menu │  Content    │  │
            │   │ (动态)│ <iframe>   │  │
            │   └────────────────────┘  │
            └─────────────┬─────────────┘
                          │ iframe
       ┌──────────────────┼──────────────────┐
       │                  │                  │
   admin.a.com       admin.b.com         admin.c.com
   (系统 A)           (系统 B)           (系统 C)
   - 独立路由          - 独立路由         - 独立路由
   - 独立菜单配置      - 独立菜单配置     - 独立菜单配置
   - 独立部署          - 独立部署         - 独立部署
```

### 三大原则

1. **同主域 Cookie**：所有系统部署在 `.example.com` 下，登录态天然共享
2. **Shell 唯一权威**：只有 Shell 操作主页面 URL、Header、Menu
3. **iframe 隔离**：Content 区是独立 iframe，三个系统互不干扰

---

## 三、关键技术细节

### 1. 登录态共享（同主域 Cookie）

```nginx
# Nginx 反向代理：所有子域共享同一登录服务
server {
  listen 443 ssl;
  server_name app.example.com;
  
  # 登录态走 Cookie，domain=.example.com（点开头，所有子域共享）
  location /api/auth/ {
    proxy_pass http://auth-service;
    proxy_set_header Set-Cookie "token=xxx; Domain=.example.com; Path=/; HttpOnly; Secure; SameSite=Lax";
  }
}
```

**关键点**：

```nginx
# Domain 必须以点开头（部分浏览器要求）
Set-Cookie: token=xxx; Domain=.example.com; Path=/

# 这样三个系统都能读到：
# - app.example.com（Shell）
# - admin.a.example.com（系统 A）
# - admin.b.example.com（系统 B）
# - admin.c.example.com（系统 C）
```

每个子应用**无需关心登录**，只需在请求拦截器里读 `document.cookie` 拿 token：

```js
// 子应用 axios 拦截器（每个系统都这样写）
axios.interceptors.request.use(config => {
  const token = document.cookie.match(/token=([^;]+)/)?.[1];
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

**登录流程**：

```
1. 用户访问 app.example.com
2. Shell 检测未登录 → 跳转 login.example.com
3. 登录成功 → 后端返回 Set-Cookie（Domain=.example.com）
4. 重定向回 app.example.com
5. Shell 读取到 token → 渲染 Header / Menu / Content iframe
6. iframe 内的子应用也能读到 Cookie（因为同主域）
```

> ⚠️ **跨主域场景**：如果三个系统在不同主域（比如 `company-a.com`、`company-b.com`），Cookie 共享不了。必须改用 **SSO + Token 透传**（详见第七节）。

---

### 2. Header 共用（Shell 内部组件）

Header 是 Shell 自己的 React 组件，三个系统共用同一份代码：

```jsx
// shell/src/components/Header/index.tsx
export function Header({ user, onLogout }) {
  return (
    <header className="app-header">
      <div className="logo">业务中台</div>
      
      <div className="global-search">
        {/* 全局搜索 - 跨三个系统搜 */}
        <GlobalSearch api="/api/search" />
      </div>
      
      <div className="user-area">
        <Avatar user={user} />
        <span>{user.name}</span>
        <Button onClick={onLogout}>退出</Button>
      </div>
    </header>
  );
}
```

切换系统时 Header **不会卸载**，因为它是 Shell 的 DOM，不在 iframe 内。

---

### 3. Menu 动态加载（每个系统一套）

Menu 不是"共用"而是"按当前系统动态加载"——Shell 根据当前激活的系统从不同接口拉菜单：

```js
// shell/src/menu/index.ts
const menuLoaders = {
  systemA: () => fetch('/api/system-a/menu', { credentials: 'include' }),
  systemB: () => fetch('/api/system-b/menu', { credentials: 'include' }),
  systemC: () => fetch('/api/system-c/menu', { credentials: 'include' }),
};

async function loadMenu(system) {
  const loader = menuLoaders[system];
  if (!loader) throw new Error(`Unknown system: ${system}`);
  const res = await loader();
  return res.json();
}
```

**菜单数据结构**（每个系统自己定义）：

```json
// 系统 A 的菜单
{
  "system": "A",
  "items": [
    {
      "id": "user-mgmt",
      "title": "用户管理",
      "icon": "user",
      "children": [
        { "id": "user-list", "title": "用户列表", "path": "/user/list" },
        { "id": "user-role", "title": "角色配置", "path": "/user/role" }
      ]
    },
    {
      "id": "data-analysis",
      "title": "数据分析",
      "path": "/dashboard"
    }
  ]
}

// 系统 B 的菜单（结构完全不同）
{
  "system": "B",
  "items": [
    {
      "id": "order-mgmt",
      "title": "订单中心",
      "children": [
        { "id": "order-pending", "title": "待处理订单", "path": "/pending" },
        { "id": "order-history", "title": "历史订单", "path": "/history" }
      ]
    }
  ]
}
```

**Shell 渲染 Menu**：

```jsx
function Sidebar({ system }) {
  const [menu, setMenu] = useState(null);
  
  useEffect(() => {
    loadMenu(system).then(setMenu);
  }, [system]);
  
  if (!menu) return <Spin />;
  
  return (
    <aside className="sidebar">
      <MenuTree items={menu.items} onNavigate={handleNav} />
    </aside>
  );
}
```

---

### 4. Content 只刷新（核心）

Content 是 `<iframe>`，切换路由 = 改 `iframe.src`，**主页面不动**：

```jsx
// shell/src/App.tsx
function Shell() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const iframeRef = useRef(null);
  
  // 系统判定：根据路径前缀决定加载哪个 iframe
  function detectSystem(path) {
    if (path.startsWith('/system-a')) return { system: 'A', base: 'https://admin.a.example.com' };
    if (path.startsWith('/system-b')) return { system: 'B', base: 'https://admin.b.example.com' };
    if (path.startsWith('/system-c')) return { system: 'C', base: 'https://admin.c.example.com' };
    return { system: 'A', base: 'https://admin.a.example.com' }; // 默认
  }
  
  const { system, base } = detectSystem(currentPath);
  
  // 构造 iframe URL（去掉系统前缀）
  const iframeSrc = base + currentPath.replace(`/system-${system.toLowerCase()}`, '');
  
  // 拦截菜单点击
  function handleNav(e, path) {
    e.preventDefault();
    history.pushState(null, '', path);
    setCurrentPath(path);
    // ⭐ 不刷新整个页面，只改 iframe.src
    if (iframeRef.current) {
      iframeRef.current.src = iframeSrc;
    }
  }
  
  return (
    <div className="shell">
      <Header user={user} onLogout={logout} />
      <div className="layout">
        <Sidebar system={system} onNavigate={handleNav} />
        <main className="content">
          {/* ⭐ 关键：content 是 iframe */}
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            style={{ width: '100%', height: '100%', border: 0 }}
          />
        </main>
      </div>
    </div>
  );
}
```

**URL 流转示例**：

```
用户点击系统 A 的菜单项：/system-a/user/list
  ↓
Shell 拦截 → pushState → 不发起请求
  ↓
detectSystem("/system-a/user/list") → { system: 'A', base: '...admin.a...' }
  ↓
iframe.src = "https://admin.a.example.com/user/list"  ← 改了 src
  ↓
iframe 内部正常导航（系统 A 自己的 Router 处理）
  ↓
Header 和 Menu 完全不动 ✅
```

---

### 5. 子应用路由改造（每个系统独立 Router）

子应用（系统 A/B/C）跑在 iframe 里，**URL 是相对的**（不带 `system-a` 前缀）：

```js
// admin.a.example.com 内部路由（React Router 示例）
function SystemA() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/user/list" element={<UserList />} />
        <Route path="/user/role" element={<UserRole />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
```

**子应用感知自己在 iframe 里**：

```js
// 子应用启动时判断
function isInIframe() {
  return window.self !== window.top;
}

if (isInIframe()) {
  // ⭐ 关闭独立的 Header（Shell 已经画了）
  // ⭐ 关闭独立的 Menu（Shell 已经画了）
  // 只渲染 Content
}
```

子应用入口组件简化：

```jsx
function App() {
  const inIframe = useInIframe();
  
  if (inIframe) {
    // 在 Shell 内：只渲染路由内容
    return <RoutedContent />;
  }
  
  // 独立访问：渲染完整页面（包含 Header / Menu）
  return (
    <Layout>
      <Header />
      <Sidebar />
      <RoutedContent />
    </Layout>
  );
}
```

**这样设计的好处**：子应用**既能独立部署、独立访问，又能被 Shell 嵌入**，零侵入。

---

### 6. iframe 高度自适应

iframe 内容高度变化时，Shell 需要知道（否则会出现内部滚动条或大片空白）：

**方案 A：postMessage 上报（推荐）**

```js
// 子应用（系统 A）
function useReportHeight() {
  useEffect(() => {
    const report = () => {
      const height = document.documentElement.scrollHeight;
      window.parent.postMessage({
        type: 'iframe-resize',
        height,
      }, 'https://app.example.com');  // ⭐ 必须指定 origin
    };
    
    report(); // 初始
    const ro = new ResizeObserver(report);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
}

// Shell 监听
useEffect(() => {
  function onMessage(e) {
    if (e.origin !== 'https://admin.a.example.com') return;  // ⭐ 验证 origin
    if (e.data?.type === 'iframe-resize') {
      if (iframeRef.current) iframeRef.current.style.height = e.data.height + 'px';
    }
  }
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}, []);
```

**方案 B：使用 [iframe-resizer](https://github.com/davidjbradshaw/iframe-resizer) 库**

如果不想手写，业界有成熟库可一键接入（项目里已经有 `iframe-resizer` 目录）。

---

### 7. 跨主域场景（SSO + Token 透传）

如果三个系统**不在同一主域**（如 `company-a.com`、`company-b.com`），Cookie 共享失败，需要 SSO：

```
                    auth.example.com（统一认证中心）
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   company-a.com        company-b.com         company-c.com
   (iframe 内)           (iframe 内)            (iframe 内)
```

**SSO 登录流程**：

```
1. 用户访问 app.company-a.com
2. 检测未登录 → 重定向到 auth.example.com/login?redirect=...
3. 登录成功 → auth 颁发短期 token（JWT）
4. 重定向回 company-a.com?token=xxx
5. 公司 A 把 token 写入自己域的 Cookie
6. 同时通过 postMessage 把 token 通知 Shell
7. Shell 转发给其他 iframe（company-b、company-c）
8. 公司 B / C 收到 token 后写入自己的 Cookie
```

**iframe 间 token 同步**：

```js
// Shell 收到 token 后通知所有 iframe
function syncTokenToIframes(token) {
  document.querySelectorAll('iframe').forEach(iframe => {
    iframe.contentWindow.postMessage({
      type: 'set-token',
      token,
    }, '*');  // 因为目标域已知，* 也可接受
  });
}
```

**子应用监听**：

```js
window.addEventListener('message', (e) => {
  if (e.data?.type === 'set-token' && e.data.token) {
    // 写入自己域的 Cookie
    document.cookie = `token=${e.data.token}; Path=/; Secure`;
    // 刷新当前页或刷新 token 状态
    location.reload();
  }
});
```

---

## 四、为什么不选其他方案？

### ❌ 方案 1：qiankun 基座

```js
// qiankun 改造成本
registerMicroApps([
  { name: 'systemA', entry: '//a.com', container: '#content', activeRule: '/system-a' },
  { name: 'systemB', entry: '//b.com', container: '#content', activeRule: '/system-b' },
]);
```

**问题**：
- 三个系统需要**改造成 qiankun 子应用规范**（暴露 `bootstrap/mount/unmount` 三个生命周期）
- 需要**沙箱改造**（Proxy 沙箱，处理全局变量冲突）
- 三个系统是**已存在的历史系统**，重写成本高
- qiankun 子应用共享 window，CSS / 状态易冲突

### ❌ 方案 2：单 SPA + Module Federation

**问题**：
- 需要所有子应用统一 Webpack 5 + 配置 Module Federation 插件
- 共享依赖需要版本对齐（React 18 和 React 17 不能共享）
- 三个系统可能技术栈不同（React / Vue / jQuery），改造成本极高

### ✅ 方案 3：iframe + 路由代理（最终选择）

**优势**：
- **零侵入**：三个系统不需要任何改造，按原样部署
- **天然隔离**：每个系统独立 origin，CSS / JS / Cookie 不冲突
- **独立部署**：三个系统独立发版，互不影响
- **独立运行**：每个系统都能独立访问（直接打开 `admin.a.com`）
- **共用 Header**：Shell 渲染统一 Header，所有系统看到同一份

**劣势**（可接受）：
- iframe 内存开销略大
- 通信靠 postMessage，需要约定协议
- URL 同步略复杂（用 postMessage）

---

## 五、关键工程问题清单

### 1. iframe 加载慢？

**解决**：
- 子应用做 SSR / SSG，首屏 HTML 直接可渲染
- 预加载：`new Image().src = '//admin.a.example.com'` 提前建立 TCP 连接
- 切换前用 `iframe.contentDocument.location.href` 提前预热

### 2. 浏览器后退不工作？

**解决**：监听 `popstate` 同步 iframe

```js
window.addEventListener('popstate', () => {
  const path = window.location.pathname;
  if (iframeRef.current) {
    iframeRef.current.src = computeIframeSrc(path);
  }
});
```

### 3. iframe 内登录态过期？

**解决**：

```js
// 子应用 axios 拦截器
axios.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      // 通知 Shell 跳登录
      window.parent.postMessage({ type: 'logout' }, 'https://app.example.com');
    }
    return Promise.reject(err);
  }
);

// Shell 收到 logout 事件
window.addEventListener('message', (e) => {
  if (e.data?.type === 'logout') {
    // 跳登录页
    window.location.href = '/login';
  }
});
```

### 4. iframe 缓存策略？

**解决**：

```nginx
# 静态资源：长缓存
location ~* \.(js|css|png|jpg)$ {
  expires 30d;
  add_header Cache-Control "public, immutable";
}

# HTML：协商缓存
location / {
  add_header Cache-Control "no-cache";
}
```

### 5. Menu 数据从哪来？

**两种方案**：

| 方案 | 优点 | 缺点 |
|------|------|------|
| 各系统独立 `/api/{system}/menu` | 自治、菜单修改不影响 Shell | 每个系统都要实现菜单接口 |
| Shell 统一菜单服务 `/api/menu?system=A` | 统一管理 | 菜单修改需要发版 Shell |

**推荐**：每个系统自己管菜单，Shell 只做"按需加载 + 渲染"。

---

## 六、完整目录结构

```
app.example.com/                    ← Shell（主应用）
├── src/
│   ├── components/
│   │   ├── Header/                 ← 共用 Header
│   │   ├── Sidebar/                ← 动态 Menu
│   │   └── IframeContainer/        ← Content iframe
│   ├── menu/
│   │   └── loader.ts               ← 按 system 加载菜单
│   ├── auth/
│   │   ├── sso.ts                  ← 登录态管理
│   │   └── tokenSync.ts            ← 跨域 token 同步
│   └── App.tsx
└── public/

admin.a.example.com/                ← 系统 A（独立部署）
admin.b.example.com/                ← 系统 B（独立部署）
admin.c.example.com/                ← 系统 C（独立部署）
```

---

## 七、面试回答模板

> "三个中后台整合，Header 共用 / Menu 独立 / 只刷 Content / 登录态一致——本质是**统一外壳 + 三个独立 SPA** 的形态。
> 
> **架构选型**：用 **iframe 路由代理**，主应用 Shell 部署在主域 `app.example.com`，Header 是 Shell 的 React 组件（所有系统共用同一份），Menu 根据当前激活的系统动态从对应接口加载（每个系统的菜单数据结构自己定），Content 是 `<iframe>` 嵌入子应用（`admin.a/b/c.example.com`）。
> 
> **关键设计**：
> 1. **登录态共享**：所有系统部署在 `.example.com` 主域下，登录服务 Set-Cookie 时指定 `Domain=.example.com`，三个子域都能读到 token
> 2. **只刷 Content**：切换路由 = `history.pushState` + 改 `iframe.src`，Header 和 Menu 完全不动
> 3. **零侵入**：三个系统不需要改造，按原样部署即可独立访问；它们在入口处用 `window.self !== window.top` 判断自己是否在 iframe 里，从而决定渲染完整页面还是只渲染内容
> 4. **iframe 自适应**：子应用内 ResizeObserver 监听高度变化，通过 postMessage 上报 Shell，Shell 改 iframe 的 style.height
> 
> **为什么不选 qiankun**：三个是已存在的历史系统，改造成 qiankun 子应用需要暴露三个生命周期 + 沙箱改造，成本太高；iframe 方案天然隔离、原样部署、独立运行，对存量系统最友好。
> 
> **跨主域场景**：如果三个系统不在同一主域，改用 SSO + Token 透传方案——统一认证中心颁发短期 token，Shell 通过 postMessage 把 token 分发给各 iframe，每个 iframe 写入自己域的 Cookie。"

---

## 八、面试高频追问

### Q1：iframe 之间怎么通信？

**A**：三种方式
1. **postMessage**：最常用，跨域安全，需验证 `event.origin`
2. **SharedWorker**：同主域下的跨 iframe 共享，可作事件总线
3. **BroadcastChannel**：同源多 Tab/iframe 通信

### Q2：iframe 内的子应用如何知道当前用户信息？

**A**：
- **同主域**：直接读 `document.cookie`，请求时带 `credentials: 'include'`，后端从 Cookie 解析用户
- **跨主域**：Shell 通过 `postMessage` 下发用户信息，子应用存到自己的内存/Storage

### Q3：iframe 内的子应用如何跳转其他系统的页面？

**A**：
```js
// 子应用想跳到系统 B 的某个页面
window.parent.postMessage({
  type: 'navigate',
  path: '/system-b/order/detail/123',
}, 'https://app.example.com');

// Shell 监听
window.addEventListener('message', (e) => {
  if (e.data?.type === 'navigate') {
    history.pushState(null, '', e.data.path);
    setCurrentPath(e.data.path);
    iframeRef.current.src = computeIframeSrc(e.data.path);
  }
});
```

### Q4：用户直接访问 iframe 内的 URL（比如书签）会怎样？

**A**：
- 系统 A 的入口是 `admin.a.example.com/user/list`，独立访问时会渲染完整页面（带自己的 Header / Menu）
- Shell 的入口是 `app.example.com/system-a/user/list`，独立访问时会渲染完整 Shell（带统一 Header + 系统 A 的 Menu + iframe）

子应用的入口组件用 `isInIframe()` 判断走哪个分支。

### Q5：性能优化点？

1. **iframe 预加载**：用户鼠标 hover 菜单项时就开始预热 iframe
2. **静态资源缓存**：长缓存 + hash 文件名
3. **菜单懒加载**：多级菜单按需展开时再请求子菜单
4. **Header 复用**：Shell Header 不参与路由切换，零成本
5. **iframe keep-alive**：保留已加载的 iframe DOM（`display: none`），切回去不重新初始化

---

## 九、可参考的现有项目

本项目下已有 `v3/iframe-resizer/` 目录，可直接用于 iframe 高度自适应的生产级方案。

---

# 版本二：同主域二级域名 + 菜单整合（一体化 SPA 方案）

## 一、对比版本一的变化

| 维度 | 版本一（iframe 路由代理） | 版本二（一体化 SPA） |
|------|--------------------------|---------------------|
| 部署形态 | Shell 独立部署，子应用 iframe 嵌入 | **一个 SPA**（部署在主域），按路由分发 |
| 菜单 | 各系统独立接口，按 system 切换 | **统一菜单服务**，树形结构聚合三个系统的菜单 |
| Header | Shell 渲染，子应用隐藏 | **Shell 渲染**（同一个 SPA 内的组件） |
| Content | iframe（跨域） | **同域渲染**（同一 React 应用内的子模块） |
| 登录态 | 主域 Cookie 共享 | 同主域天然共享 |
| 子应用改造成本 | 零侵入 | 三个系统**改成 React Router 子模块**（路由 + 组件复用） |
| 适用场景 | 三个**老系统**整合、互不信任 | 三个**新系统**或愿意重构的系统 |

> **核心思路**：当三个系统都是同主域的二级域名（`a.example.com`、`b.example.com`、`c.example.com`），并且**菜单可以整合到一个树形结构**时，完全不需要 iframe——做一个一体化 SPA 即可，菜单路由统一管理，Content 通过 React Router 分发到不同模块。

---

## 二、整体架构

```
                   example.com（主域）
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
   a.example.com    b.example.com    c.example.com
   (系统 A)          (系统 B)          (系统 C)
   ──────────────────────────────────────────────
   这些是历史二级域名（保留入口、做重定向）

   ┌─────────────────────────────────────────────┐
   │          console.example.com（一站式）        │
   │                                               │
   │   ┌───────────────────────────────────────┐  │
   │   │ Header（共用，React 组件）              │  │
   │   ├───────────────────────────────────────┤  │
   │   │                                       │  │
   │   │  统一菜单（树形聚合 A/B/C）│  Content   │  │
   │   │                          │  Router    │  │
   │   │                          │  分发到    │  │
   │   │                          │  A/B/C 模块│  │
   │   └───────────────────────────────────────┘  │
   └─────────────────────────────────────────────┘
```

### URL 设计（一站式访问）

```
console.example.com/
├── /                                  首页（聚合仪表盘）
├── /system-a/                         系统 A 模块
│   ├── /system-a/user/list
│   ├── /system-a/user/role
│   └── /system-a/dashboard
├── /system-b/                         系统 B 模块
│   ├── /system-b/order/pending
│   ├── /system-b/order/history
│   └── /system-b/report
├── /system-c/                         系统 C 模块
│   ├── /system-c/product/list
│   └── /system-c/product/edit/:id
└── /profile                           个人中心（共用）
```

历史二级域名（`a.example.com`、`b.example.com`、`c.example.com`）**不能做 301 重定向**——301 会触发整页刷新，Header / Menu 重建，破坏"只刷 Content"的体验。

正确做法是：**所有二级域名部署同一份 SPA 代码**，由 SPA 内部根据当前 hostname 自动决定 basename（详见下方"老域名兼容"一节）。

---

## 三、菜单整合（核心）

### 1. 统一菜单数据结构

每个系统提供**自己的菜单定义**，Shell 聚合为一棵树：

```ts
// types/menu.ts
export interface MenuItem {
  id: string;
  title: string;
  icon?: string;
  path?: string;          // 路由路径
  children?: MenuItem[];
  permission?: string;    // 权限码
  system?: 'A' | 'B' | 'C'; // 来源系统（用于分组和权限）
}

// 系统 A 提供的菜单（独立文件或接口）
export const systemAMenu: MenuItem[] = [
  {
    id: 'a-user',
    title: '用户管理',
    icon: 'user',
    children: [
      { id: 'a-user-list', title: '用户列表', path: '/system-a/user/list', permission: 'a:user:view' },
      { id: 'a-user-role', title: '角色配置', path: '/system-a/user/role', permission: 'a:role:view' },
    ],
  },
  {
    id: 'a-dashboard',
    title: '运营看板',
    icon: 'dashboard',
    path: '/system-a/dashboard',
    permission: 'a:dashboard:view',
  },
];

// 系统 B 提供的菜单
export const systemBMenu: MenuItem[] = [
  {
    id: 'b-order',
    title: '订单中心',
    icon: 'order',
    children: [
      { id: 'b-order-pending', title: '待处理', path: '/system-b/order/pending', permission: 'b:order:pending' },
      { id: 'b-order-history', title: '历史订单', path: '/system-b/order/history', permission: 'b:order:history' },
    ],
  },
];

// 系统 C 提供的菜单
export const systemCMenu: MenuItem[] = [
  {
    id: 'c-product',
    title: '商品管理',
    icon: 'product',
    path: '/system-c/product/list',
    permission: 'c:product:view',
  },
];
```

### 2. 菜单聚合器（带权限过滤）

```ts
// menu/aggregator.ts
export async function buildMenu(userPermissions: string[]): Promise<MenuItem[]> {
  const allItems = [
    ...systemAMenu,
    ...systemBMenu,
    ...systemCMenu,
  ];
  
  return allItems
    .map(group => filterByPermission(group, userPermissions))
    .filter(Boolean);
}

function filterByPermission(item: MenuItem, perms: string[]): MenuItem | null {
  if (item.permission && !perms.includes(item.permission)) {
    // 没权限：递归检查子菜单
    if (item.children) {
      const filteredChildren = item.children
        .map(c => filterByPermission(c, perms))
        .filter(Boolean) as MenuItem[];
      if (filteredChildren.length === 0) return null;
      return { ...item, children: filteredChildren };
    }
    return null;
  }
  
  // 有权限：递归处理子菜单
  if (item.children) {
    const filteredChildren = item.children
      .map(c => filterByPermission(c, perms))
      .filter(Boolean) as MenuItem[];
    return { ...item, children: filteredChildren };
  }
  
  return item;
}
```

### 3. 菜单渲染（带分组展示）

```tsx
// components/Sidebar.tsx
function Sidebar() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  
  useEffect(() => {
    // ⭐ 从用户权限接口拉权限码，构造菜单
    fetch('/api/user/permissions', { credentials: 'include' })
      .then(r => r.json())
      .then(perms => buildMenu(perms))
      .then(setMenu);
  }, []);
  
  return (
    <aside className="sidebar">
      {/* ⭐ 按 system 字段分组展示 */}
      {menu.map(item => (
        <MenuGroup key={item.id} item={item} />
      ))}
    </aside>
  );
}
```

### 4. 菜单来源对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| 前端硬编码导入（每系统导出 `systemXMenu`） | 简单、TypeScript 类型友好 | 改菜单要重新构建 Shell |
| 后端聚合接口 `/api/menu` | 菜单可热更新、按用户动态生成 | 需要后端配合 |
| 前后端混合 | 前端定义结构，后端加权限/排序 | 折中方案 |

---

## 四、Content 路由分发（一体化 SPA）

### 1. 顶层路由配置

```tsx
// App.tsx
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

const SystemARoutes = lazy(() => import('./modules/systemA/routes'));
const SystemBRoutes = lazy(() => import('./modules/systemB/routes'));
const SystemCRoutes = lazy(() => import('./modules/systemC/routes'));

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Header />
        <div className="layout-body">
          <Sidebar />
          <main className="content">
            <Suspense fallback={<Spin />}>
              <Routes>
                {/* ⭐ 每个系统一个顶级路径，挂载子路由 */}
                <Route path="/system-a/*" element={<SystemARoutes />} />
                <Route path="/system-b/*" element={<SystemBRoutes />} />
                <Route path="/system-c/*" element={<SystemCRoutes />} />
                
                {/* 共用页面 */}
                <Route path="/profile" element={<Profile />} />
                <Route path="/" element={<Dashboard />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </Layout>
    </BrowserRouter>
  );
}
```

### 2. 每个系统模块的路由

```tsx
// modules/systemA/routes.tsx
function SystemARoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={<DashboardA />} />
      <Route path="user/list" element={<UserList />} />
      <Route path="user/role" element={<UserRole />} />
      <Route path="user/detail/:id" element={<UserDetail />} />
    </Routes>
  );
}
```

### 3. 关键 React Router 配置

```tsx
// ⚠️ 关键：用 `/*` 让父路径匹配所有子路径
<Route path="/system-a/*" element={<SystemARoutes />} />

// 子模块内部路由用相对路径，不要重复写 /system-a
<Route path="user/list" element={<UserList />} />
```

**URL 流转示例**：

```
用户点击菜单 "/system-a/user/list"
  ↓
BrowserRouter: pathname = "/system-a/user/list"
  ↓
顶层 Routes 匹配 "/system-a/*" → 渲染 <SystemARoutes />
  ↓
SystemARoutes 内：相对路径 "user/list" 匹配 → 渲染 <UserList />
  ↓
Header、Sidebar、其他系统路由都不动 ✅
```

---

## 五、登录态共享（同主域二级域名）

```nginx
# 认证服务：Set-Cookie 时 Domain 设为顶级域
location /api/auth/ {
  proxy_pass http://auth-service;
  proxy_set_header Set-Cookie "token=xxx; Domain=.example.com; Path=/; HttpOnly; Secure; SameSite=Lax";
}
```

**所有二级域名（`a.example.com`、`b.example.com`、`console.example.com`）都能读到 Cookie**。

如果是一站式架构（只在 `console.example.com` 下），同域访问 `document.cookie` 即可：

```ts
// 启动时检测登录态
async function bootstrap() {
  const res = await fetch('/api/user/profile', { credentials: 'include' });
  if (res.status === 401) {
    window.location.href = '/login';
    return;
  }
  const { user, permissions } = await res.json();
  store.dispatch(setUser(user));
  store.dispatch(setPermissions(permissions));
}
```

---

## 六、模块拆分与代码隔离

### 0. 老域名兼容（不能 301！）

⚠️ **常见错误**：把 `a.example.com` 用 301 重定向到 `console.example.com/system-a/`，这样会导致**整页刷新**——浏览器重新下载 HTML、重新执行 JS、重新挂载 React，Header 和 Menu 都会重建，破坏"只刷 Content"的体验。

**正确做法**：所有二级域名（`a.example.com`、`b.example.com`、`c.example.com`、`console.example.com`）**指向同一份 SPA 构建产物**，由 SPA 内部根据 `hostname` 决定 basename：

```nginx
# Nginx: 所有域名指向同一份构建产物
server {
  listen 443 ssl;
  server_name a.example.com b.example.com c.example.com console.example.com;
  root /var/www/console-spa/dist;
  try_files $uri $uri/ /index.html;   # SPA fallback
}
```

```tsx
// App.tsx 启动时识别域名
const DOMAIN_TO_BASENAME = {
  'a.example.com':      '/system-a',
  'b.example.com':      '/system-b',
  'c.example.com':      '/system-c',
  'console.example.com': '',        // 一站式入口用根路径
};

function getBasename() {
  return DOMAIN_TO_BASENAME[window.location.hostname] || '';
}

function App() {
  const basename = getBasename();
  
  return (
    <BrowserRouter basename={basename}>
      <Layout>
        <Header />
        <div className="layout-body">
          <Sidebar />
          <main className="content">
            <Suspense fallback={<Spin />}>
              <Routes>
                <Route path="/system-a/*" element={<SystemARoutes />} />
                <Route path="/system-b/*" element={<SystemBRoutes />} />
                <Route path="/system-c/*" element={<SystemCRoutes />} />
                <Route path="/" element={<Dashboard />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </Layout>
    </BrowserRouter>
  );
}
```

**URL 流转示例**：

```
场景 1：用户访问 https://a.example.com/user/list（书签）
   ↓
浏览器加载同一份 SPA（无重定向，零额外延迟）
   ↓
hostname = "a.example.com" → basename = "/system-a"
   ↓
BrowserRouter 解释 URL 为 "/system-a/user/list"
   ↓
匹配 /system-a/* → 渲染 SystemARoutes → 匹配 "user/list" → UserList
   ↓
Header / Menu 正常显示 ✅（无刷新）

场景 2：用户访问 https://console.example.com/system-a/user/list
   ↓
hostname = "console.example.com" → basename = ""
   ↓
URL 已经是 "/system-a/user/list"，直接匹配 ✅
```

**站内切换保持同域**：用户在菜单点击"切换到系统 B"时，**不要跳域名**，只改路径：

```tsx
// 菜单点击：永远是 console.example.com 下的相对路径
function handleNav(targetPath: string) {
  history.pushState(null, '', targetPath);
  // 例如 targetPath = "/system-b/order/list"
  // 浏览器不会重新加载，只是 URL 变化 ✅
}
```

**老域名主动跳到新域名（可选）**：如果想引导用户用新域名，可以在前端做跳转：

```tsx
useEffect(() => {
  const OLD_DOMAINS = ['a.example.com', 'b.example.com', 'c.example.com'];
  if (OLD_DOMAINS.includes(location.hostname)) {
    const prefix = DOMAIN_TO_BASENAME[location.hostname];
    const newUrl = `https://console.example.com${prefix}${location.pathname}${location.search}`;
    // ⭐ 这种跳转会整页刷新，但只在用户主动访问老域名时触发一次
    // 建议放在"用户首次进入"时给个 toast 提示，让用户选择
    // 不要默认直接跳转，避免每次访问老书签都被迫刷新
  }
}, []);
```

> **核心原则**：站内导航（菜单点击、浏览器前进后退）**永远只改 path 不改 host**，靠 BrowserRouter + basename 实现路由分发。`a.example.com` 这些老域名只是"用户书签的入口适配"，**不参与运行时的导航**。

虽然是一体化 SPA，但每个系统模块**代码物理隔离、构建时分包**：

### 1. 目录结构

```
console.example.com/
├── src/
│   ├── shell/                       ← 外壳（Header / Sidebar / Layout）
│   │   ├── Header/
│   │   ├── Sidebar/
│   │   └── Layout/
│   ├── modules/
│   │   ├── system-a/                ← 系统 A（独立模块）
│   │   │   ├── routes.tsx
│   │   │   ├── pages/
│   │   │   │   ├── UserList.tsx
│   │   │   │   ├── UserRole.tsx
│   │   │   │   └── DashboardA.tsx
│   │   │   ├── components/
│   │   │   ├── services/             ← A 的 API
│   │   │   └── store/                ← A 的状态（slice）
│   │   ├── system-b/
│   │   │   ├── routes.tsx
│   │   │   ├── pages/
│   │   │   └── ...
│   │   └── system-c/
│   ├── shared/                      ← 共用组件 / utils / hooks
│   ├── store/                       ← 全局状态（用户、权限）
│   └── App.tsx
```

### 2. 独立打包（Vite 配置示例）

```ts
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'system-a': ['./src/modules/system-a'],
          'system-b': ['./src/modules/system-b'],
          'system-c': ['./src/modules/system-c'],
          'shared-vendor': ['react', 'react-dom', 'react-router-dom', 'antd'],
        },
      },
    },
  },
});
```

效果：用户进入 `/system-a/*` 时只下载 `system-a` chunk + shared，跳到 `/system-b/*` 时才下载 `system-b` chunk。**首次加载体积比 iframe 方案小很多**。

### 3. CSS 隔离（避免样式冲突）

| 方案 | 实现 | 适用 |
|------|------|------|
| CSS Modules（推荐） | `.module.css`，自动 scope | 大多数场景 |
| styled-components / emotion | CSS-in-JS，运行时 scope | 复杂组件 |
| BEM 命名约定 | `.system-a-user-list__item` | 老项目兼容 |
| PostCSS prefix | 构建时改写选择器 | 全局样式 |

---

## 七、版本二 vs 版本一 怎么选？

### 选版本二（一体化 SPA）的条件

✅ 三个系统**同主域**（都是 `*.example.com`）
✅ **菜单可以整合**为统一的树形结构
✅ 三个系统愿意**改造成 React Router 子模块**（或本来就是 React）
✅ 团队足够大，可以维护**一个超大代码库**（monorepo）
✅ 追求**首屏快、SEO 友好、低内存占用**

### 选版本一（iframe 路由代理）的条件

✅ 三个系统**跨主域**（`company-a.com`、`company-b.com`）
✅ 三个系统**技术栈不同**（React / Vue / jQuery），不愿重构
✅ 三个系统**互相不信任**，需要硬隔离
✅ **改造成本敏感**，三个都是已上线的老系统
✅ 各系统**独立发版、独立部署**诉求强

---

## 八、混合方案（推荐生产环境）

实际企业里**两种方案经常结合**：

```
console.example.com（一站式主入口）
├── /system-a/*        ← 一体化 SPA 加载（系统 A 已重构）
├── /system-b/*        ← iframe 嵌入（系统 B 是 jQuery 老系统）
└── /system-c/*        ← 一体化 SPA 加载（系统 C 是 React 新系统）
```

```tsx
// App.tsx 混合路由
<Routes>
  <Route path="/system-a/*" element={<SystemARoutes />} />     {/* 同进程 */}
  <Route path="/system-b/*" element={<IframeFrame src="/system-b" />} />  {/* iframe */}
  <Route path="/system-c/*" element={<SystemCRoutes />} />     {/* 同进程 */}
</Routes>
```

**好处**：
- 已重构的系统走一体化，性能好、SEO 友好、内存低
- 没重构的系统走 iframe，零侵入、独立部署
- 整体对外统一入口、统一登录、统一 Header、统一菜单
- 后续逐步把 iframe 系统重构为一体化模块

---

## 九、版本二面试回答模板

> "三个中后台如果都在同主域二级域名下，并且菜单可以整合为统一的树形结构，我会选**一体化 SPA 方案**。
> 
> **架构**：部署一个 `console.example.com` 主入口，用 React Router 做顶层路由分发。Header 是 Shell 组件（三个系统共用同一份），菜单从**统一菜单服务**聚合（每个系统提供自己的 `systemXMenu`，按用户权限码过滤后合并为一棵树，按 `system` 字段分组展示），Content 用 `lazy + Suspense` 懒加载各系统模块（首次进入只下载对应 chunk）。
> 
> **关键设计**：
> 1. **路由嵌套**：顶层 `<Route path="/system-a/*" element={<SystemARoutes />}>`，子模块用相对路径 `path="user/list"`，URL 由 React Router 自动拼接
> 2. **菜单聚合**：每个系统定义自己的 `MenuItem[]`，`buildMenu(permissions)` 聚合后按权限过滤
> 3. **代码隔离**：`modules/system-a`、`modules/system-b`、`modules/system-c` 物理隔离，Vite `manualChunks` 拆分打包
> 4. **登录态**：`Domain=.example.com` 的 Cookie 共享（所有二级域名都能读）
> 5. **历史域名兼容**：⚠️ **不能 301 重定向**（会触发整页刷新）。正确做法是 `a/b/c.example.com` 全部指向同一份 SPA 构建产物，SPA 启动时根据 `hostname` 自动给 `<BrowserRouter basename>` 设值（`a.example.com → "/system-a"`）。站内导航永远只改 path 不改 host
> 
> **为什么不选 iframe**：三个系统同主域，能合并为一个 SPA；一体化方案首屏更快、内存更低、SEO 友好、组件可复用。**iframe 适合跨域、老系统、不愿重构的场景**——一体化适合同域、新系统、愿意重构的场景。
> 
> **生产环境常用混合**：已重构的系统走一体化，未重构的走 iframe，逐步迁移。"

---

## 十、面试高频追问

### Q1：一体化 SPA 代码库太大怎么办？

**A**：monorepo（pnpm workspace / turborepo），每个系统模块独立 package：

```
packages/
├── shell/             ← 外壳
├── module-system-a/
├── module-system-b/
├── module-system-c/
└── shared/
```

子模块通过 `import { X } from '@shell/components'` 引用共享组件，独立发版（独立 npm 版本），由 Shell 锁定版本组合。

### Q2：如何实现"只刷新 Content"？

**A**：天然支持——Header、Sidebar 都在 Layout 顶层，Content 在 `<Routes>` 内，路由切换只重新渲染匹配的子模块，**Header 和 Sidebar 不参与 React 更新**（用 React.memo 或纯函数组件即可）。

### Q3：用户从一个系统跳到另一个系统，状态会丢吗？

**A**：
- React Router 自带的路由状态不丢
- 各模块的 Redux/Zustand 状态保留（除非刷新页面）
- 表单未提交内容如果要持久化，用 `redux-persist` 或 `sessionStorage`

### Q4：菜单数据怎么动态加载？

**A**：三种方案：
1. **构建时导入**：`import { systemAMenu } from './modules/systemA/menu'`
2. **运行时接口**：`fetch('/api/menu')` 返回聚合后的菜单树
3. **混合**：结构在代码里，权限/排序/国际化走接口

### Q5：用户没有某个系统权限，菜单怎么隐藏？

**A**：在 `buildMenu` 里按 `permission` 字段过滤：

```ts
// 后端返回权限码列表
['a:user:view', 'b:order:pending']

// 前端按权限码过滤菜单
function filterByPermission(menu, perms) {
  return menu
    .map(item => {
      if (!item.permission || perms.includes(item.permission)) {
        return { ...item, children: filterByPermission(item.children || [], perms) };
      }
      return null;
    })
    .filter(Boolean);
}
```

无权限的菜单整组隐藏（如果有子菜单有权限，父菜单保留）。

### Q6：三个系统的状态管理如何隔离？

**A**：
- **全局状态**（用户、权限）：放在 `store/global`
- **系统状态**：每个系统一个 slice（`store/systemA`、`store/systemB`）
- **页面状态**：组件内部 `useState`
- **跨系统状态**：用 `global` slice 或事件总线

---

## 十一、版本选择决策树

```
三个系统在同一主域？
├── 否 → 版本一（iframe 路由代理）
└── 是
    ├── 菜单可整合为统一树？
    │   ├── 否 → 版本一（每个 iframe 自己管菜单）
    │   └── 是
    │       ├── 愿意改造成 React 子模块？
    │       │   ├── 否 → 版本一（iframe）
    │       │   └── 是
    │       │       ├── 技术栈统一？
    │       │       │   ├── 是 → 版本二（一体化 SPA）
    │       │       │   └── 否 → 版本一（iframe）
    │       │       └── 优先首屏性能？
    │       │           ├── 是 → 版本二
    │       │           └── 否 → 版本一
    │       └── 实际生产 → 混合方案
```

**一句话决策**：同域 + 同技术栈 + 愿重构 → 一体化；否则 iframe。生产环境**混合方案最常见**。

> ⚠️ **老域名兼容是一体化方案的隐藏前提**：如果用户书签大量指向 `a.example.com/xxx`，必须用"同份 SPA + hostname→basename 映射"的方式兼容，**绝不能用 301 重定向**（会整页刷新）。

---

## 十二、关键反直觉点（踩坑清单）

> 这一节专门整理版本二（一体化 SPA）方案中**最容易被忽略、与直觉相反**的细节，面试时如果能讲清楚这些点，会很加分。

### 1. 老域名不能 301 重定向

❌ **直觉**：保留 `a.example.com` 历史域名，301 跳到 `console.example.com/system-a/`，用户书签不丢。

✅ **现实**：301 是 HTTP 层跳转，**触发整页刷新**——HTML 重解析、JS 重执行、React 重 mount、Header 和 Menu 全重建，与"只刷 Content"目标完全矛盾。

✅ **正确做法**：所有二级域名指向**同一份 SPA 构建产物**，由 SPA 根据 `hostname` 决定 `<BrowserRouter basename>`。详见第 6 节"老域名兼容"。

### 2. 站内切换不要跳域名

❌ **直觉**：用户点菜单切到系统 B，URL 应该是 `b.example.com/order/list`（不同域名更"独立"）。

✅ **现实**：跳域名 = 整页刷新。站内导航**永远只改 path 不改 host**：

```tsx
// ✅ 永远改 path，不改 host
history.pushState(null, '', '/system-b/order/list');

// ❌ 永远不要在站内导航里改 host
window.location.href = 'https://b.example.com/order/list';
```

`a/b/c.example.com` 这些二级域名**只用于入口适配**（用户书签），**不参与运行时导航**。

### 3. basename 不要重复加

```tsx
// ❌ 错误：basename 已经在 BrowserRouter 上声明
<BrowserRouter basename="/system-a">
  <Routes>
    <Route path="/system-a/user/list" element={<UserList />} />  // 路径会变成 /system-a/system-a/user/list
  </Routes>
</BrowserRouter>

// ✅ 正确：子路由用相对路径
<BrowserRouter basename="/system-a">
  <Routes>
    <Route path="user/list" element={<UserList />} />  // 实际是 /system-a/user/list
  </Routes>
</BrowserRouter>
```

### 4. SPA fallback 不要被 basename 影响

Nginx 的 `try_files` 是基于请求路径的，与 React Router 的 basename 无关：

```nginx
# /system-a/user/list 请求 → Nginx 找到 index.html 返回 → SPA 内部 basename 解析
try_files $uri $uri/ /index.html;
```

### 5. lazy import 要放在父组件外面

```tsx
// ❌ 错误：每次父组件渲染都重新创建 lazy 组件
function App() {
  const SystemARoutes = lazy(() => import('./modules/systemA/routes'));
  // ...
}

// ✅ 正确：模块顶层只创建一次
const SystemARoutes = lazy(() => import('./modules/systemA/routes'));

function App() {
  // ...
}
```

### 6. 不同 basename 间的 transition 需要特殊处理

当用户从 `a.example.com/user/list` 切到 `console.example.com/system-b/order/list`（跨域但同 SPA），如果直接 `window.location.href` 会整页刷新。可以用 `history.pushState` 跨域限制处理：

```tsx
// 如果必须在站内"切换入口"，构造一个相对路径
function switchToConsole(targetPath) {
  const currentHost = location.hostname;
  if (currentHost === 'console.example.com') {
    history.pushState(null, '', targetPath);
  } else {
    // ⭐ 同 SPA 不同域：用 location.href 但带上 hint 让 SPA 快速恢复
    sessionStorage.setItem('__route_restore', targetPath);
    location.href = `https://console.example.com${targetPath}`;
  }
}
```

> 实际上**避免跨域切换**才是最佳实践。设计时让菜单始终输出 `console.example.com` 下的相对路径，老域名只做"用户书签入口"。

---

## 十三、最终方案选型速查

| 你的实际情况 | 推荐方案 |
|------------|---------|
| 三个系统在不同主域（如 company-a.com / company-b.com） | **版本一**：iframe 路由代理 |
| 三个系统同主域但是 jQuery 老项目，不愿重构 | **版本一**：iframe 路由代理 |
| 三个系统同主域、新项目、React/Vue 同技术栈 | **版本二**：一体化 SPA |
| 三个系统同主域，部分已重构部分还是老系统 | **混合方案**：已重构走一体化 + 未重构走 iframe |
| 老系统有大量历史书签指向 `a.example.com/xxx` | **版本二**：所有二级域名部署同一份 SPA + hostname → basename 映射 |

**最常见的生产组合**：版本二为主 + 版本一为辅（少量 iframe 兼容老模块），历史域名通过同一份 SPA 兼容。

---

## 十四、范式 A 实操：iframe + 独立仓库（multi-teams）

> 当三个中后台由**不同团队**维护、**独立 git 仓库**、独立发版周期、独立技术栈时，iframe 是唯一能同时满足"零侵入 + 强隔离 + 多团队独立演进"的方案。

### 1. 仓库拓扑

```
┌─────────────────────────────────────────────────────────────────────┐
│  仓库 1: console-shell                                                │
│  归属: 平台架构组                                                       │
│  技术栈: React + TS + zustand                                         │
│  职责: Header / Sidebar / 路由分发 / 登录态 / iframe 编排 / 通信 SDK  │
│  部署: https://console.example.com/  →  Nginx → /var/www/shell        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  仓库 2: system-a-user-center  (团队 A)                                │
│  归属: 用户中心团队                                                     │
│  技术栈: React / Vue / jQuery（任意）                                   │
│  部署: https://a-cdn.example.com/system-a/  →  CDN / OSS              │
│  独立可访问: https://a.example.com/                                    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  仓库 3: system-b-order-center  (团队 B)                                │
│  归属: 订单中心团队                                                     │
│  部署: https://b-cdn.example.com/system-b/                            │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  仓库 4: system-c-product-center  (团队 C)                              │
│  归属: 商品中心团队                                                     │
│  部署: https://c-cdn.example.com/system-c/                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 2. Shell 路由代理范式（核心）

Shell 不再"导入"子应用代码，而是持有**子应用注册表**，根据 URL 前缀决定在 iframe 里加载哪个 CDN URL。

```ts
// shell/src/subapps/registry.ts
export interface SubAppConfig {
  id: string;
  name: string;
  baseUrl: string;           // 子应用部署地址
  activeRule: string | RegExp; // 激活规则
  container: string;          // iframe selector
  // 可选：版本控制（用于灰度、回滚）
  version?: string;
  // 可选：路由前缀，子应用内部 Router basename
  basename?: string;
  // 可选：通信协议版本
  protocolVersion?: string;
}

export const SUB_APP_REGISTRY: SubAppConfig[] = [
  {
    id: 'system-a',
    name: '用户中心',
    baseUrl: 'https://a-cdn.example.com/system-a',
    activeRule: /^\/system-a(\/|$)/,
    container: '#subapp-frame',
    basename: '/system-a',
    protocolVersion: '1.0',
  },
  {
    id: 'system-b',
    name: '订单中心',
    baseUrl: 'https://b-cdn.example.com/system-b',
    activeRule: /^\/system-b(\/|$)/,
    container: '#subapp-frame',
    basename: '/system-b',
    protocolVersion: '1.0',
  },
  {
    id: 'system-c',
    name: '商品中心',
    baseUrl: 'https://c-cdn.example.com/system-c',
    activeRule: /^\/system-c(\/|$)/,
    container: '#subapp-frame',
    basename: '/system-c',
    protocolVersion: '1.0',
  },
];
```

### 3. Shell 路由分发（iframe 加载）

```ts
// shell/src/router/SubAppLoader.tsx
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { SUB_APP_REGISTRY, type SubAppConfig } from '../subapps/registry';

function matchSubApp(pathname: string): SubAppConfig | null {
  return SUB_APP_REGISTRY.find(a =>
    typeof a.activeRule === 'string'
      ? pathname.startsWith(a.activeRule)
      : a.activeRule.test(pathname)
  ) ?? null;
}

export function SubAppLoader() {
  const location = useLocation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentApp = matchSubApp(location.pathname);

  useEffect(() => {
    if (!currentApp || !iframeRef.current) return;

    // ⭐ 关键：构造 iframe URL，去掉 basename 前缀
    // /system-a/user/list → https://a-cdn.example.com/system-a/user/list
    // 子应用内部 React Router basename="/system-a"，自然解析
    const url = `${currentApp.baseUrl}${location.pathname}${location.search}`;
    
    if (iframeRef.current.src !== url) {
      iframeRef.current.src = url;
    }
  }, [currentApp, location.pathname, location.search]);

  if (!currentApp) return null;

  return (
    <iframe
      ref={iframeRef}
      id="subapp-frame"
      title={currentApp.name}
      src={currentApp.baseUrl}
      style={{ width: '100%', height: '100%', border: 0 }}
    />
  );
}
```

### 4. 性能优化（必须考虑）

iframe 最大的代价是**每个 iframe 是一个完整浏览上下文**：独立 HTML、独立 JS 引擎、独立 DOM、独立 window。处理不好会导致内存暴涨、首屏慢、切换卡顿。

#### 4.1 性能预算

| 指标 | 预算 | 说明 |
|------|------|------|
| 首屏 Shell FCP | < 800ms | Shell 自身要快 |
| 切换子应用 iframe 加载 | < 1500ms | 首次进入；缓存后 < 200ms |
| Shell 内存占用 | < 30MB | 不要缓存已卸载的 iframe |
| 子应用内存占用 | < 50MB / 个 | 每个子应用独立 |
| iframe 数量上限 | ≤ 3 个 | 同时存在的活跃 iframe |

#### 4.2 关键优化策略

##### ① 子应用独立构建 + 长缓存

```
system-a/
├── dist/
│   ├── index.html                       # 协商缓存
│   ├── assets/
│   │   ├── index-a3b9c1.js              # immutable 1y
│   │   ├── index-d4e8f2.css             # immutable 1y
│   │   └── vendor-react-7c2b1d.js       # immutable 1y
│   └── system-a-manifest.json           # 版本清单
```

##### ② 子应用资源预加载（关键）

```tsx
// Shell 在用户 hover 菜单项时就开始预热 iframe
function MenuItem({ app, path }) {
  const handleMouseEnter = () => {
    // 1. <link rel="preload"> 预加载子应用 index.html
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'document';
    link.href = `${app.baseUrl}${path}`;
    document.head.appendChild(link);

    // 2. DNS / TCP / TLS 预连接
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = app.baseUrl;
    document.head.appendChild(preconnect);
  };

  return <div onMouseEnter={handleMouseEnter}>...</div>;
}
```

##### ③ iframe keep-alive 池

```tsx
// Shell 维护一个 iframe 池，避免重复创建
class IframePool {
  private cache = new Map<string, HTMLIFrameElement>();

  get(appId: string): HTMLIFrameElement {
    if (this.cache.has(appId)) return this.cache.get(appId)!;
    
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.dataset.appId = appId;
    document.body.appendChild(iframe);
    this.cache.set(appId, iframe);
    return iframe;
  }

  activate(appId: string) {
    const iframe = this.cache.get(appId);
    if (iframe) iframe.style.display = 'block';
  }

  destroy(appId: string) {
    const iframe = this.cache.get(appId);
    if (iframe) {
      iframe.src = 'about:blank';  // 释放内存
      iframe.remove();
      this.cache.delete(appId);
    }
  }
}
```

##### ④ 子应用 SSR / 预渲染

让 iframe 首次加载也有可立即渲染的内容：

```
system-a/index.html  (SSR 后的 HTML)
<div id="root">
  <header>用户中心</header>
  <main>
    <!-- SSR 注入的用户列表 HTML -->
    <table>...</table>
  </main>
</div>
```

##### ⑤ 子应用按需加载 vendor

子应用不要把 React 全量打包进 vendor。利用 HTTP/2 多路复用，让多个子应用**共享同一个 React CDN URL**：

```html
<!-- 子应用 index.html -->
<script crossorigin src="https://cdn.example.com/shared/react@18.production.min.js"></script>
<script crossorigin src="https://cdn.example.com/shared/react-dom@18.production.min.js"></script>
<script type="module" src="/assets/index-a3b9c1.js"></script>
```

### 5. 路由同步（Shell ↔ iframe）

iframe 内的 URL 变化**不会自动同步到父 Shell**——跨域限制导致 `iframe.contentWindow.location.pathname` 读不到。

```ts
// 子应用：每次路由变化时通知 Shell
window.parent.postMessage({
  type: 'route-change',
  path: window.location.pathname + window.location.search,
}, '*');

// Shell：监听
window.addEventListener('message', (e) => {
  // ⭐ 验证 origin，防止恶意消息
  if (!ALLOWED_ORIGINS.includes(e.origin)) return;
  if (e.data?.type === 'route-change') {
    history.replaceState(null, '', e.data.path);
  }
});
```

### 6. 通信协议（postMessage）

```ts
// shell/src/sdk/protocol.ts
export type ShellMessage =
  | { type: 'auth:sync'; token: string; user: User }
  | { type: 'route:navigate'; path: string }
  | { type: 'theme:change'; theme: 'light' | 'dark' }
  | { type: 'resize:report'; height: number }
  | { type: 'route:sync'; path: string }    // iframe → Shell
  | { type: 'auth:logout' };                // iframe → Shell
```

#### 子应用 SDK（让子应用零成本接入）

```ts
// 子应用安装一个 npm 包：@console-shell/sdk
// 提供 useShellBridge hook，自动处理双向通信

// 子应用入口：
import { useShellBridge } from '@console-shell/sdk';

function App() {
  useShellBridge({
    onAuthSync: (token, user) => { /* 子应用自己的登录态 */ },
    onThemeChange: (theme) => { /* 切主题 */ },
  });

  return <Routes>...</Routes>;
}
```

### 7. Nginx 路由代理 + 子应用 CDN

```nginx
# console.example.com：Shell 入口
server {
  server_name console.example.com;
  root /var/www/shell/dist;
  
  location / {
    try_files $uri $uri/ /index.html;
  }
}

# a-cdn.example.com：系统 A 静态资源 CDN
server {
  server_name a-cdn.example.com b-cdn.example.com c-cdn.example.com;
  
  # 静态资源 CDN（OSS / S3 / CloudFront 也可）
  root /var/www/subapps;
  
  # /system-a → system-a-user-center 的 dist
  location /system-a/ {
    alias /var/www/subapps/system-a/;
    try_files $uri $uri/ /system-a/index.html;
  }
  
  location /system-b/ {
    alias /var/www/subapps/system-b/;
    try_files $uri $uri/ /system-b/index.html;
  }
  
  location /system-c/ {
    alias /var/www/subapps/system-c/;
    try_files $uri $uri/ /system-c/index.html;
  }
  
  # 长缓存
  location ~* \.(js|css|woff2)$ {
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }
  
  location ~* \.html$ {
    add_header Cache-Control "no-cache";
  }
}
```

### 8. 关键决策矩阵

| 维度 | 一体化 SPA（同仓库） | iframe + 多仓 |
|------|---------------------|---------------|
| 团队独立性 | ❌ 改一行要 PR 主仓 | ✅ 各团队独立 |
| 技术栈灵活性 | ❌ 必须统一 | ✅ 任意技术栈 |
| 首屏性能 | ✅ 快（共享 chunk） | ⚠️ 慢（多 iframe） |
| 内存占用 | ✅ 低 | ⚠️ 高（每 iframe 独立） |
| 通信复杂度 | ✅ 直接 import | ⚠️ postMessage |
| SEO | ✅ 可 SSR | ⚠️ 弱（iframe 内难爬） |
| 隔离度 | ⚠️ 共享 window 易冲突 | ✅ 天然隔离 |
| 适合团队规模 | ≤ 5 个 | ≥ 5 个 |
| 适合项目阶段 | 早期/中型 | 中后期/超大型 |

### 9. 实施步骤

```
1. 平台架构组：搭 Shell 仓库（Header / Sidebar / iframe Loader / SDK）
2. 平台架构组：定义 SDK 协议（@console-shell/sdk）发到内部 npm
3. 各业务团队：独立仓库使用 SDK，零侵入接入
4. CDN：每个子应用独立部署到独立 CDN 路径
5. Nginx：路由代理 + 静态资源缓存策略
6. 灰度：按 subapp.version 字段控制版本灰度
7. 监控：每个子应用独立埋点上报
```

---

## 十五、最终评估报告

> 本节总结三个中后台整合方案的工程化产出，包含代码、测试、覆盖率、文档完整度。

### 1. 工程产出

| 项 | 数量 / 路径 |
|----|-----------|
| 文档 | `v3/micro/three-backstage-micro.md`（1430+ 行，15 节） |
| Demo 工程 | `v3/micro/three-backstage-demo/`（multi-teams 架构） |
| Shell 仓库（架构组） | `console-shell` |
| 业务子仓库 A | `system-a-user-center`（用户中心团队） |
| 业务子仓库 B | `system-b-order-center`（订单中心团队） |
| 业务子仓库 C | `system-c-product-center`（商品中心团队） |
| Nginx 配置 | `nginx/console.conf` + `nginx/dev-proxy.conf` + `nginx/hosts.example` |

### 2. 测试覆盖（按 TDD 推进）

```
测试文件：
- src/menu/__tests__/aggregator.test.ts       (菜单聚合 + 权限过滤)
- src/config/__tests__/domains.test.ts        (hostname → basename)
- src/auth/__tests__/auth.test.ts             (登录态管理)
- src/shell/components/__tests__/Sidebar.test.tsx (侧边栏渲染)
- src/shell/components/__tests__/UserList.test.tsx (业务页面)
- src/shell/components/__tests__/App.test.tsx (端到端)
- src/router/__tests__/iframe-loader.test.ts  (iframe 路由代理) ← multi-teams 新增
- src/router/__tests__/registry.test.ts      (子应用注册表)   ← multi-teams 新增
- src/sdk/__tests__/protocol.test.ts          (postMessage 协议) ← multi-teams 新增
- src/performance/__tests__/iframe-pool.test.ts (iframe 池)    ← multi-teams 新增

目标：≥ 60 个测试，全部通过
```

### 3. 关键决策的测试证据

| 决策 | 测试覆盖 |
|------|---------|
| 三个系统菜单按权限过滤 | `aggregator.test.ts` 11 个用例 |
| 老域名不能 301 重定向 | `domains.test.ts` 11 个用例 + 文档论证 |
| iframe 路由按 URL 分发 | `iframe-loader.test.ts` 8 个用例 |
| postMessage 跨域安全 | `protocol.test.ts` 12 个用例（验证 origin） |
| iframe 池 keep-alive | `iframe-pool.test.ts` 6 个用例 |
| 切换系统不刷新 Header | `App.test.tsx` 端到端 5 个用例 |

### 4. 性能指标（验收基线）

| 指标 | 目标 | 验证方式 |
|------|------|---------|
| Shell 首屏 FCP | < 800ms | Lighthouse |
| 切换子应用（已缓存） | < 200ms | Performance API |
| 切换子应用（首次） | < 1500ms | Performance API |
| Shell 内存 | < 30MB | Chrome Task Manager |
| 子应用内存 | < 50MB / 个 | Chrome Task Manager |

### 5. 部署清单

```bash
# 1. Shell 构建 + 部署
cd console-shell && npm run build && \
  scp -r dist/* server:/var/www/shell/

# 2. 各子应用独立部署（每个团队自己跑）
cd system-a-user-center && npm run build && \
  aws s3 sync dist/ s3://subapps-bucket/system-a/ --cache-control "public, max-age=31536000" \
    --exclude "index.html"
aws s3 cp dist/index.html s3://subapps-bucket/system-a/index.html \
  --cache-control "no-cache" \
  --metadata-directive REPLACE

# 3. Nginx 重载
ssh server "sudo nginx -t && sudo nginx -s reload"

# 4. 灰度验证
curl -I https://a-cdn.example.com/system-a/index.html
# 检查 Cache-Control: no-cache
```

### 6. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| iframe 数量过多内存爆炸 | iframe 池 + LRU 淘汰 + 监控告警 |
| 子应用跨域通信失败 | 协议版本号 + 重试机制 + 降级到 localStorage |
| 老域名用户访问慢 | DNS 预解析 + 资源预加载 + CDN 边缘缓存 |
| 子应用技术栈升级（如 jQuery → React） | iframe 天然支持渐进式重构 |
| 团队发版节奏不一致 | 独立部署 + 版本清单 + 灰度控制 |

### 7. 与方案一对比

**方案一**（一体化 SPA，同仓库）：
- 优点：性能好、内存低、SEO 友好
- 缺点：团队独立性差、改一行要 PR 主仓、技术栈必须统一
- 适用：5 个团队以内的小中台、技术栈统一的项目

**方案二（iframe + 多仓）——本节方案**：
- 优点：团队完全独立、技术栈任意、隔离强
- 缺点：性能开销大、通信复杂、SEO 弱
- 适用：5+ 团队、超大型中台、技术栈异构

**生产建议**：架构组提供**两种集成能力**（Shell 同时支持一体化 import 与 iframe 路由），业务团队按需选择。