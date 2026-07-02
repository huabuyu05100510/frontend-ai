# 飞书文档内容提取

---

## 文档一：资源优化实战（S4bGdz1JWotr2Dxxi44cphFNnKc）

### 课程目标
- 通过减少资源大小（代码压缩、图片压缩）优化页面加载
- 掌握资源缓存策略：localStorage、浏览器缓存、Service Worker
- 熟悉懒加载和预加载策略
- 实际操作 Webpack/Vite 配置
- 掌握 Node.js format/tooling 相关能力

### 课程大纲
- 资源压缩
  - JavaScript & CSS 文件压缩
  - 图片压缩
  - 文本文件压缩
  - Node API 处理 gzip、brotli 压缩
  - 配置 Nginx 使用 Gzip 和 Brotli
- 请求优化
  - 减少 HTTP 请求数
  - 使用懒加载、预加载、预请求
  - 使用 HTTP2 多路复用
- 资源缓存
  - 强缓存 + 协商缓存
  - SessionStorage / IndexedDB
  - Service Worker Cache
- 数据缓存

---

### 5. 资源压缩与请求优化

#### 资源压缩
- **JavaScript 压缩**：terser（CLI：`npx terser src/app.js -o dist/app.min.js --compress --mangle`）
- **CSS 压缩**：cssnano（配合 postcss 使用）
- **图片压缩**：
  - imagemin：支持 JPEG、PNG 及 GIF 格式压缩
  - TinyPNG：在线压缩工具
  - WebP 格式：cwebp 工具转换（`cwebp src/image.jpg -o dist/image.webp`）
- **文本文件压缩**：Gzip（Google 推荐方法）、Brotli（更高压缩比）
  - Node API gzip 压缩示例
  - 配置 Nginx 使用 Gzip 和 Brotli 压缩

#### 请求优化
- **减少 HTTP 请求数**：打包合并 CSS/JS 为单文件，内联小 CSS/JS
- **懒加载**：对图片用 `loading="lazy"`；对 CSS/JavaScript 按需加载
- **预加载**：`<link rel="preload">` 提前加载关键资源
- **预请求**：`<link rel="prefetch">` 提前请求可能使用的资源
- **HTTP2 多路复用**：配置 Nginx，允许多请求复用同一 TCP 连接

---

### 大文件基本缓存对比

| 特征 | 强缓存 | 协商缓存 |
|------|--------|--------|
| 请求是否发送 | 不发送请求 | 发送请求验证 |
| 缓存控制 | Cache-Control / Expires | ETag / Last-Modified |
| 状态码 | 200（from cache） | 304 Not Modified |
| 适用场景 | 静态资源（JS/CSS/图片） | 动态内容、HTML |

### 6. 资源缓存

#### 强缓存
- **Cache-Control**：最高优先级，设置 `max-age`、`no-cache`、`no-store` 等
- **Expires**：HTTP/1.0 遗留字段，已被 Cache-Control 替代

#### 协商缓存
- **ETag / If-None-Match**：基于内容 Hash，精确判断文件是否变化；优先级高于 Last-Modified
- **Last-Modified / If-Modified-Since**：基于文件修改时间，精度到秒，有一秒误差问题

**缓存决策流程**（完整流程图）：
1. Cache-Control → 最高优先级处理
2. Expires → 管理过期
3. If-None-Match (ETag) → 一致性验证
4. If-Modified-Since (Last-Modified) → 时间比对

**ETag 与 If-None-Match 判断逻辑**（代码实现）：
```js
// 弱 ETag 比较（W/"..."）
const eTagMatch = (noneMatch) => {
  const etag = currentEtag.etag
  if (!etag) return false
  const etagValue = true
  for (let i = 0; i < matches.length; i++) {
    if (match === etag || match === 'W/' + etag || 'W/' + match === etag) {
      etagValue = true; break
    }
  }
  if (!etagValue) return false
  // ...
}
```

---

### Service Worker

#### 生命周期
```
Register → Install → Activate → Idle → Fetch / Terminated
```

**installing 阶段**：
- 预缓存静态资源（CACHE_PREFIX + CACHE_VERSION 版本控制）
- 缓存所有 urlsToCache 资源

**activated 阶段**：
- 清理旧版本缓存（遍历 cacheNames，删除不匹配当前 CACHE_VERSION 的缓存）
- 调用 `clients.claim()` 立即接管所有页面，无需等待刷新

**fetch 阶段**（四种策略）：
1. **仅缓存**：直接从 Cache 返回，不请求网络
2. **仅网络**：直接走网络，不读缓存
3. **缓存优先**：先读 Cache，命中则返回；否则请求网络并更新 Cache
4. **网络优先（Stale-While-Revalidate）**：先读 Cache 快速响应，同时后台请求网络更新缓存

```js
// 网络优先策略 fetch 示例
self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.open('fetch').then(function(cache) {
      return fetch(event.request).then(function(response) {
        cache.put(event.request, response.clone())
        return response
      })
    })
  )
})
```

---

### 7. 数据缓存

#### LocalStorage
- 同步 API，每个域名最多 5MB
- 只能存储字符串，需 JSON 序列化
- 实用场景：主题设置、用户偏好、表单数据草稿

**主题切换示例**：
```js
// 保存主题
function saveTheme(theme) {
  if (theme === 'dark') { document.body.classList.add('dark-mode') }
  else { document.body.classList.remove('dark-mode') }
  localStorage.setItem('theme', theme)
}
```

**表单数据储存**：定期自动保存，页面刷新后恢复草稿

#### IndexedDB
- 异步 API，存储大量结构化数据，支持事务和索引
- 适合大型数据集，可存 Blob/File/ArrayBuffer

**基本用法**：
```js
const request = indexedDB.open('myDatabase', 1)
// 添加数据（事务）
const transaction = db.transaction(['myObjectStore'], 'readwrite')
const objectStore = transaction.objectStore('myObjectStore')
objectStore.add({ id: 1, name: 'test', age: 30 })
```

---

## 文档二：5倍滚动性能优化实践 + WASM（TQNNd43dno8nx9xYtCucVeqenLh）

### 5倍滚动性能优化

#### 背景
长列表页面（10000+ 条数据）全量渲染导致：帧率崩溃、内存溢出、白屏

#### 核心方案：虚拟滚动 + 5步优化

**步骤 1：虚拟渲染窗口**
- 只渲染可视区 ± buffer 范围内的节点
- 通过绝对定位 + translateY 模拟真实滚动位置

**步骤 2：基于二分查找的滚动计算**
- 问题：scrollTop 不能直接计算索引（动态高度场景）
- 解决：维护 startIndex，使用二分查找（Binary Search）O(log n) 定位
```js
// 二分查找当前 scrollTop 对应的 startIndex
let lo = 0, hi = positions.length - 1
while (lo < hi) {
  const mid = (lo + hi) >> 1
  if (positions[mid].bottom < scrollTop) lo = mid + 1
  else hi = mid
}
```

**步骤 3：缓冲区（Buffer Zone）设计**
- 在可视区上下各保留 N 个 buffer 节点，防止快速滚动出现白屏
```js
const startIndex = binarySearch(scrollTop)
const visibleStart = Math.max(0, startIndex - bufferSize)
const renderedEnd = Math.min(data.length, startIndex + visibleCount + bufferSize)
```

**步骤 4：真实布局监测与动态修正（精心调教）**
- 工具：ResizeObserver 监听每个列表项真实高度变化
- 方法：当 cachedPositions[i].height < 150px 时缓存预估高度
- 实际渲染后计算与预估的 delta，同步更新所有后续节点的 top/bottom
- 更新方式：`scrollElement.scrollTop -= delta`

**步骤 5：滚动锚定（Scroll Anchoring）——防止抖动**
- 问题：列表顶部加载新数据时，当前视图内容向下跳动 100px+
- 解决方案：
  - 在正在查看的第 1 个元素之上 记录 scrollTop 参照
  - 插入新内容后，恢复 `container.scrollTop` 到参照值，防止跳动

**最终实现完整代码（原生 HTML）**：含完整 CSS + JS 虚拟滚动实现，支持动态高度 + Buffer + 二分查找 + Scroll Anchoring

---

### WASM 图片处理优化

**技术选型**：vite-plugin-wasm + target web
```js
import { init, process_image_wasm } from './pkg/wasm_image_group.js'
```

**主要优化总结**：

| 指标 | Native Canvas (JS + Browser) | Rust + WASM | 是否提升 |
|------|------|------|------|
| 处理速度 | 350ms | 270ms | ✓ +45% |
| 内存管理 | 依赖 Canvas (DOM 绑定) | 手动内存（无 GC 开销） | ✓ |
| 产物大小(gzip后) | — | 需要额外 .wasm 文件 | 需权衡 |
| 多线程支持 | Web Worker | Web Worker | 持平 |
| 降级支持(无 WASM) | — | 降级使用 Web Worker | ✓ |

---

### MD5/SHA 大文件秒传计算

**业务需求**：上传 2GB 文件时，需要计算文件的 MD5/SHA-256 值（Hash），用于「秒传」功能（服务端匹配已有文件）以及完整性校验（上传后）

**技术方案（Web Worker + WASM + Stream）**：

1. **读取分片**：使用 `FileReader` 或 `File.slice + stream` 读取文件内容（每片 Chunk）
2. **Web Worker**：处理 WASM 加载，纯 JS 计算
   - WASM 计算：`postMessage(chunk, [chunk.buffer])` Transferable 避免拷贝
   - Worker 更新：`context.update(ptr, len)` 更新 hash 状态
   - WASM 计算：重复上述步骤直到所有 chunk 处理完毕，获取最终 hash 值

**性能对比**：
- JS (CryptoJS)：约 15-20 MB/s
- JS (WebCrypto API)：较好（Native 实现），但仅支持完整数据一次性输入，不支持 Incremental Update，无法处理大文件流式分片
- WASM (Rust)：约 500-600 MB/s，比原生方式还快，支持增量分片

**最终实现效果对比（Rust + 原生 HTML）**：

1. 初始化 wasm 工程：`cargo init`
2. 指定构建参数（Cargo.toml）
3. 构建：`wasm-pack build %s/14 --target web`
4. 在 worker.js 中使用 WebWorker 引入 wasm
5. 绑定文件中使用 WebWorker 更新

**wasm 主要优化总结**：

| 方法 | 速度 (MB/s) | 2.4GB 耗时 | 备注 |
|------|------|------|------|
| JS (spark-md5) | ~20 MB/s | ~15 分 | 纯 JS，兼容性好 |
| Rust + WASM + Worker | ~280 MB/s | ~8.5 分 | 约比 JS 快 14 倍 |
| Native (原生 rust) | ~830 MB/s | ~4 分 | 本地测试，无浏览器环境限制 |
