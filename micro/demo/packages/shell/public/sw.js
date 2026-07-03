// Service Worker（坑#5：必须在主应用注册，iframe 内 navigator.serviceWorker 为 null）
// 三段式缓存策略 —— 面试文档 5.5
const CACHE_VERSION = 'v1-2026-07'
const APP_SHELL = [
  '/',
  '/index.html',
  // 壳子 JS 由 Vite 注入 hash 文件名，运行时拦截时缓存
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // HTML 用 StaleWhileRevalidate（首屏秒开 + 后台更新）
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(staleWhileRevalidate(event.request))
    return
  }
  // 带 hash 的静态资源用 CacheFirst（immutable）
  if (/\.[a-f0-9]{8}\.(js|css|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(event.request))
    return
  }
  // BFF API 不拦截（每次拿最新）
  if (url.pathname.startsWith('/api/')) return
})

async function cacheFirst(req) {
  const cached = await caches.match(req)
  return cached || fetch(req)
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_VERSION)
  const cached = await cache.match(req)
  const network = fetch(req)
    .then((resp) => {
      if (resp && resp.status === 200) cache.put(req, resp.clone())
      return resp
    })
    .catch(() => cached)
  return cached || network
}
