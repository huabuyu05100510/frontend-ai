# Nginx 部署配置

> 三个中后台一体化 SPA 的 Nginx 配置，核心是"所有域名指向同一份构建产物 + 不做 301 重定向"。

## 📁 配置文件清单

| 文件 | 用途 |
|------|------|
| `console.conf` | **生产环境**完整配置：4 个 HTTPS server + HTTP→HTTPS 重定向 + 本地开发 |
| `dev-proxy.conf` | **开发环境**反向代理：把 `*.local` 转发到 vite dev server |
| `hosts.example` | 本地 `/etc/hosts` 配置示例 |

---

## 🏭 生产部署（`console.conf`）

### 适用场景

✅ 真实生产环境（域名 + SSL 证书 + CDN）
✅ 多个子域共享同一份 SPA 构建产物
✅ 老域名入口兼容

### 核心特性

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器请求                                                    │
│  ├─ console.example.com         → basename = ''              │
│  ├─ a.example.com               → basename = '/system-a'    │
│  ├─ b.example.com               → basename = '/system-b'    │
│  └─ c.example.com               → basename = '/system-c'    │
└─────────────────────────────────────────────────────────────┘
         │              │              │             │
         └──────────────┴──────────────┴─────────────┘
                          │
                  ┌───────┴────────┐
                  │ Nginx（同一份） │
                  │ console.conf   │
                  └───────┬────────┘
                          │
                  ┌───────┴────────────────┐
                  │ 同一份 SPA 构建产物      │
                  │ /var/www/console-spa/  │
                  │   ├─ index.html        │
                  │   ├─ assets/           │
                  │   │   ├─ index-abc.js  │
                  │   │   └─ index-def.css │
                  │   └─ ...               │
                  └────────────────────────┘
```

### 部署步骤

```bash
# 1. 构建 SPA
cd /Users/didi/Downloads/前端AI面试题/v3/micro/three-backstage-demo
npm run build
# → dist/ 目录

# 2. 上传到服务器
scp -r dist/* user@server:/var/www/console-spa/

# 3. 部署 Nginx 配置
sudo cp nginx/console.conf /etc/nginx/conf.d/console.conf
# 修改证书路径、上游地址、构建产物路径

# 4. 测试并重载
sudo nginx -t
sudo nginx -s reload
```

### 配置关键点

#### ✅ 正确：所有域名指向同一份构建产物

```nginx
server {
    server_name console.example.com;
    root /var/www/console-spa/dist;
    # ...
}

server {
    server_name a.example.com b.example.com c.example.com;
    root /var/www/console-spa/dist;   # ⭐ 同一份！
    # ...
}
```

#### ❌ 错误：301 重定向老域名

```nginx
server {
    server_name a.example.com;
    return 301 https://console.example.com/system-a$request_uri;
    # ❌ 这会触发整页刷新，Header/Menu 全部重建！
}
```

#### ✅ 正确：SPA fallback 返回 200

```nginx
location / {
    try_files $uri $uri/ /index.html;
    # ⭐ 永远返回 200，不修改地址栏 URL
}
```

#### ✅ 正确：分层缓存策略

```nginx
# HTML：永远协商缓存
location / {
    add_header Cache-Control "no-cache";
    try_files $uri $uri/ /index.html;
}

# 带 hash 的资源：永久缓存
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

#### ✅ 正确：API 不走 SPA fallback

```nginx
location /api/ {
    proxy_pass http://api_gateway;
    # /api/* 不会被 rewrite 到 /index.html
}

location / {
    try_files $uri $uri/ /index.html;
}
```

#### ✅ 正确：登录 Cookie 跨子域共享

后端代码（或 Nginx `proxy_hide_header + add_header`）：

```nginx
location /auth/ {
    proxy_pass http://auth_api;
    proxy_hide_header Set-Cookie;
    add_header Set-Cookie "token=xxx; Domain=.example.com; Path=/; HttpOnly; Secure; SameSite=Lax" always;
    #                            ⭐ 关键：Domain 以点开头，所有子域共享
}
```

---

## 🛠 本地开发（`dev-proxy.conf`）

### 场景

本地同时跑 vite dev server，但要用 `console.local` / `a.local` 等多域名验证 hostname → basename 映射。

### 启动方式

```bash
# 1. 配置本地 hosts（参考 hosts.example）
sudo vim /etc/hosts
# 添加：
#   127.0.0.1 console.local a.local b.local c.local

# 2. （可选）启动 nginx 反向代理
# macOS Homebrew：
ln -sf $(pwd)/nginx/dev-proxy.conf /opt/homebrew/etc/nginx/servers/console-dev.conf
nginx -t
brew services restart nginx

# 或者直接用 nginx：
nginx -c $(pwd)/nginx/dev-proxy.conf -p $(pwd)

# 3. 启动 vite dev server（已在跑）
cd /Users/didi/Downloads/前端AI面试题/v3/micro/three-backstage-demo
npm run dev
# → http://127.0.0.1:5180

# 4. 浏览器访问
# http://console.local    → 一站式入口
# http://a.local         → 系统 A 入口（basename 自动 = '/system-a'）
# http://b.local         → 系统 B 入口
# http://c.local         → 系统 C 入口
```

### 不装 Nginx 的纯开发方案

如果不想折腾 Nginx 和 hosts，可以直接在 vite.config.ts 里加 `server.allowedHosts`，配合 `--host` 参数也能跨域访问：

```bash
# vite --host 让局域网可访问
npm run dev -- --host
# → http://192.168.x.x:5180
```

但这种方案**无法测试多域名 basename 映射**，仅适合开发调试。

---

## 🧪 验证清单

启动后检查以下项：

| 验证项 | 方法 | 期望 |
|--------|------|------|
| 无 301 重定向 | DevTools Network 面板观察 | 访问老域名直接返回 200，无 3xx |
| basename 自动切换 | Console 输入 `window.location.hostname` | `a.local` / `b.local` / `c.local` / `console.local` |
| HTML 不缓存 | 强制刷新 (Cmd+Shift+R) | 总是拿到最新版本 |
| 资源长缓存 | Network 面板看 Cache-Control | `/assets/*.js` 返回 `max-age=31536000, immutable` |
| API 不走 SPA | 访问 `/api/test` | 返回后端响应，不是 index.html |
| Cookie 跨子域 | 在 console.local 登录后访问 a.local | 已登录态 |

---

## 🔗 相关文档

- [`../three-backstage-micro.md`](../three-backstage-micro.md) 第六节"老域名兼容"——为什么不能 301
- [`../SPEC.md`](../SPEC.md) B4 节"老域名兼容流程"
- [`../README.md`](../README.md) - 快速开始