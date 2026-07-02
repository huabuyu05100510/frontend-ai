# preview-engine — 资深前端专家 Code Review

> 审阅日期：2026-06-17
> 审阅标准：对标行业顶尖水平（Figma/Notion/飞书文档级别），聚焦极致体验与性能

---

## 一、总体评价

**综合评分：⭐⭐⭐⭐☆（4/5）**

这是一个工程密度极高的前端预览引擎 demo，在架构设计、测试质量、算法选型上已达到较高水平。核心逻辑层（pipeline、ooxml、collab）接近生产可用标准；UI 集成层（PdfEditor、VirtualList）存在若干需要修复的问题。

**架构亮点：**
- `kernel → pipeline → ooxml → renderers → collab` 五层分离，依赖方向单向，职责清晰
- 零依赖 OOXML 内核（ZIP + XML + 三格式），可测试性极强
- TDD 驱动，~220 个测试，纯逻辑层几乎 100% 覆盖
- 多项性能专项设计：前缀和二分、LRU 对象池、三段式渐进首屏、双轴虚拟化

---

## 二、问题清单（按优先级）

### P0 — 必须修复（影响正确性）

#### 1. `CapabilityRouter.ts` — mediaMime() 输出非标准 MIME

**文件：** `demo/src/kernel/CapabilityRouter.ts`

```typescript
// 当前：错误的 MIME
function mediaMime(realType: string): string {
  const audio = new Set(['mp3', 'wav', 'aac', 'm4a', 'amr', 'wma', 's48', 'pcm'])
  return `${audio.has(realType) ? 'audio' : 'video'}/${realType}`
  // 产出：audio/mp3、audio/m4a、video/mov、video/m4v ... 均非标准
}
```

**问题：** `canPlayType('audio/mp3')` 在严格浏览器下返回 `''`（false），导致 mp3 等常见格式走 wasm/server 路径，造成不必要的性能损耗。`FilePreview.tsx` 在 UI 层打了补丁修复，但根源在路由层，其他消费方不加修复会出错。

**修复方案：**
```typescript
const MIME_MAP: Record<string, string> = {
  mp3:  'audio/mpeg',
  wav:  'audio/wav',
  aac:  'audio/aac',
  m4a:  'audio/mp4',
  amr:  'audio/amr',
  wma:  'audio/x-ms-wma',
  mp4:  'video/mp4',
  webm: 'video/webm',
  mov:  'video/quicktime',
  m4v:  'video/mp4',
  avi:  'video/x-msvideo',
  mkv:  'video/x-matroska',
  flv:  'video/x-flv',
}

function mediaMime(realType: string): string {
  return MIME_MAP[realType] ?? `application/octet-stream`
}
```

同步删除 `FilePreview.tsx` 中的 MIME 补丁 (`fixed` 变量)，消除"破窗"。

---

#### 2. `xlsx.ts` — 工作表按字典序排序导致 sheet 顺序错误

**文件：** `demo/src/ooxml/xlsx.ts`

```typescript
// 当前：字典序（sheet1 < sheet10 < sheet2）
const sheetName = zip.names()
  .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  .sort()[0]
```

**问题：** 含 ≥10 个工作表的 xlsx，sheet2 → sheet10 → sheet11 ... 顺序颠倒，解析结果对应错误的工作表。

**修复方案：**
```typescript
const sheetName = zip.names()
  .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  .sort((a, b) => {
    const na = parseInt(/sheet(\d+)\.xml$/.exec(a)![1], 10)
    const nb = parseInt(/sheet(\d+)\.xml$/.exec(b)![1], 10)
    return na - nb
  })[0] ?? 'xl/worksheets/sheet1.xml'
```

> 注：`pptx.ts` 幻灯片加载已正确用数字排序，`xlsx.ts` 应保持一致。

---

### P1 — 重要问题（影响稳定性/安全性）

#### 3. `VirtualList.tsx` — 量测 useEffect 无依赖数组，存在渲染循环风险

**文件：** `demo/src/components/VirtualList.tsx`

```typescript
// 当前：每次渲染都执行（无依赖数组）
useEffect(() => {
  let changed = false
  for (let i = range[0]; i <= range[1]; i++) {
    const h = itemEls.current.get(i)?.offsetHeight
    if (h && measured.current.get(i) !== h) {
      // ...
      changed = true
    }
  }
  if (changed) setVersion(v => v + 1) // 触发重渲 → 再次量测 → 死循环风险
}) // ← 没有依赖数组
```

**问题：** 字体异步加载、CSS animation、动态内容都可能造成高度持续抖动，触发无限渲染循环。

**修复方案：** 改用 `ResizeObserver`，仅在尺寸真正变化时更新：

```typescript
useEffect(() => {
  const ro = new ResizeObserver((entries) => {
    let changed = false
    for (const entry of entries) {
      const el = entry.target as HTMLElement
      const i = Number(el.dataset.index)
      const h = entry.borderBoxSize[0]?.blockSize ?? el.offsetHeight
      if (h > 0 && measured.current.get(i) !== h) {
        measured.current.set(i, h)
        index.setSize(i, h)
        changed = true
      }
    }
    if (changed) { recompute(); setVersion(v => v + 1) }
  })

  for (const [, el] of itemEls.current) ro.observe(el)
  return () => ro.disconnect()
}, [range[0], range[1]]) // 范围变化时重新绑定
```

---

#### 4. `CollabDoc.ts` — 墓碑无 GC，长期运行内存持续增长

**文件：** `demo/src/collab/CollabDoc.ts`

**问题：** 每次 `delete(key)` 写入一个永久墓碑 `{deleted: true, ...}`，`snapshot()` 导出所有墓碑。用户频繁增删批注后，快照体积无限增长，影响内存占用和 WebSocket 传输效率。

**修复方案（向量时钟 GC）：**
```typescript
/**
 * 当所有客户端的向量时钟都已超过某个墓碑的 ts 时，该墓碑可以安全回收。
 * 调用时机：收到服务端广播的 minClock（所有在线客户端的最小时钟值）
 */
gc(minClock: number): void {
  for (const [k, e] of this.store) {
    if (e.deleted && e.ts <= minClock) {
      this.store.delete(k)
    }
  }
}
```

服务端在 `room.mjs` 中维护 `minClock = Math.min(...clients.map(c => c.clock))`，定期广播给所有客户端触发 GC。

---

#### 5. `server.mjs` — room ID 无校验，存在资源耗尽攻击

**文件：** `preview-engine/server/server.mjs`

```javascript
// 当前：直接使用客户端传入的 room 字段
joined = getRoom(String(msg.room || 'default'))
// rooms 是 Map，无上限，恶意客户端可创建无数 room
```

**修复方案：**
```javascript
const ROOM_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/
const MAX_ROOMS = 1000

function validateRoomId(id) {
  return typeof id === 'string' && ROOM_ID_RE.test(id)
}

// 在处理 join 消息时：
if (!validateRoomId(msg.room)) {
  ws.close(1008, 'invalid room id')
  return
}
if (!rooms.has(msg.room) && rooms.size >= MAX_ROOMS) {
  ws.close(1013, 'server at capacity')
  return
}
joined = getRoom(msg.room)
```

---

### P2 — 建议改进（影响可维护性/体验）

#### 6. `ProgressiveLoader.ts` — hires 阶段两次 setStage 语义模糊

**文件：** `demo/src/pipeline/ProgressiveLoader.ts`

**问题：** `setStage('hires')` 调用两次：第一次表示"开始加载高清"，第二次表示"高清就绪"，外部监听者无法区分，导致 UI 无法展示"高清加载中"的微交互（如 spinner）。

**修复方案：** 增加子状态：
```typescript
export type ProgressiveStage = 'skeleton' | 'lqip' | 'hires-loading' | 'hires-ready'

// ProgressiveLoader.ts 内部：
this.setStage('hires-loading')
const v = await this.opts.loadHiRes()
if (this.cancelled) return
this.hires = v
this.setStage('hires-ready')
```

---

#### 7. `PdfEditor.tsx` — collabRef 在渲染函数体内写值

**文件：** `demo/src/components/renderers/PdfEditor.tsx`

```typescript
// 当前（不推荐）：在渲染期间写 ref
const collabRef = useRef<CollabDoc<Annotation> | null>(null)
if (!collabRef.current) collabRef.current = new CollabDoc<Annotation>(clientId.current)
```

**修复方案：** React 18 推荐的 lazy ref 初始化模式：
```typescript
const collabRef = useRef<CollabDoc<Annotation> | null>(null)
function getCollab(): CollabDoc<Annotation> {
  if (!collabRef.current) {
    collabRef.current = new CollabDoc<Annotation>(clientId.current)
  }
  return collabRef.current
}
```

或直接用 `useMemo`（若 clientId 不变）：
```typescript
const collab = useMemo(() => new CollabDoc<Annotation>(clientId.current), [])
```

---

#### 8. `PdfEditor.tsx` — 跨页划词高亮缺失

**文件：** `demo/src/components/renderers/PdfEditor.tsx`

**问题：** `commitTextHighlight` 基于 `mouseup` 事件在单个 `PageView` 内触发，跨页选区只在最后 `mouseup` 所在页面创建高亮，其他页面的选区丢失。

**修复方案：** 将 `commitTextHighlight` 提升到 `PdfEditor` 层，在 `wrapRef` 的 `mouseup` 事件中统一处理，遍历所有 `PageView` 的边界矩形，为每个页面各创建一组高亮。

---

#### 9. `PagePool.ts` — acquire 超容量一单位

**文件：** `demo/src/pipeline/PagePool.ts`

```typescript
// 当前：先 set 后 evict，瞬间超出容量 1 个单位
this.active.set(key, obj)
if (this.active.size > this.capacity) this.evictLRU()
```

**修复方案：**
```typescript
// 先检查再 set，确保 active 始终 ≤ capacity
if (this.active.size >= this.capacity) this.evictLRU()
this.active.set(key, obj)
```

---

#### 10. `FormatProbe.ts` — BMP 魔数过于宽泛

**文件：** `demo/src/kernel/FormatProbe.ts`

**问题：** `[0x42, 0x4d]`（"BM"）作为两字节 BMP 检测过于宽泛，存在理论上的误判风险。

**修复方案：** 额外验证 BMP 头大小字段（偏移 14，`BITMAPINFOHEADER` = 40，`BITMAPCOREHEADER` = 12）：
```typescript
function isBmp(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, [0x42, 0x4d])) return false
  if (bytes.length < 18) return false
  const dibSize = bytes[14] | (bytes[15] << 8) | (bytes[16] << 16) | (bytes[17] << 24)
  return dibSize === 40 || dibSize === 12 || dibSize === 108 || dibSize === 124
}
```

---

## 三、性能优化建议（对标行业顶尖）

### 3.1 波形计算移入 Web Worker

**文件：** `demo/src/renderers/media/waveform.ts`

当前 `computeWaveform(buffer)` 在主线程执行，大文件（> 30 分钟音频）会阻塞 UI 200ms 以上。

```typescript
// waveform.worker.ts
self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  const result = computeWaveform(e.data)
  self.postMessage(result, [result.buffer])
}

// MediaView.tsx
const workerRef = useRef<Worker | null>(null)
useEffect(() => {
  workerRef.current = new Worker(
    new URL('../renderers/media/waveform.worker.ts', import.meta.url),
    { type: 'module' }
  )
  return () => workerRef.current?.terminate()
}, [])
```

---

### 3.2 OOXML 解析移入 Web Worker + Transferable

DOCX/XLSX/PPTX 解析目前在主线程，大型文件（> 5MB）解析耗时 > 100ms。

```typescript
// ooxml.worker.ts
import { loadDocx } from './docx'
import { loadXlsx } from './xlsx'
import { loadPptx } from './pptx'

self.onmessage = async (e) => {
  const { type, buffer } = e.data
  const result = type === 'docx' ? await loadDocx(buffer)
               : type === 'xlsx' ? await loadXlsx(buffer)
               : await loadPptx(buffer)
  self.postMessage(result)
}
```

---

### 3.3 PDF.js 渲染使用 OffscreenCanvas

```typescript
// PdfEditor.tsx - PageView 内
useEffect(() => {
  if (!visible || !pdfRef.current) return
  const offscreen = canvasRef.current!.transferControlToOffscreen()
  const worker = new Worker(...)
  worker.postMessage({ offscreen, pageNum: index + 1, scale }, [offscreen])
}, [visible, scale, index])
```

减少主线程 Canvas 绘制压力，尤其在低端设备上效果显著。

---

### 3.4 CumulativeIndex 支持增量更新批处理

```typescript
// 当前：setSize 每次调用都标记 dirty
setSize(i: number, h: number): void {
  this.sizes[i] = h
  if (!this.dirty || i < this.dirtyFrom) this.dirtyFrom = i
  this.dirty = true
}

// 建议增加 batch 方法，配合 ResizeObserver 批量回填
batchSetSizes(updates: Map<number, number>): void {
  let minDirty = Infinity
  for (const [i, h] of updates) {
    this.sizes[i] = h
    if (i < minDirty) minDirty = i
  }
  if (minDirty < Infinity) {
    this.dirtyFrom = Math.min(this.dirtyFrom ?? Infinity, minDirty)
    this.dirty = true
  }
}
```

---

### 3.5 XLSX 大表格虚拟化时启用行列粒度增量解析

当前 `loadXlsx` 解析完整工作表后返回，10 万行表格首屏时间长。建议：

1. 先解析行数/列数，返回 skeleton
2. 按可视区域范围按需解析 `<row>` 节点（流式 XML 解析）
3. 配合 `ViewportScheduler` 预取上下各 2 屏的行数据

---

### 3.6 OCR 引擎本地化（消除 CDN 依赖）

```typescript
// 当前：运行时从 esm.sh 动态导入 tesseract.js（~3MB JS + ~20MB 语言模型）
_mod = import(/* @vite-ignore */ 'https://esm.sh/tesseract.js@5')
```

**改进方案：**
1. 将 tesseract.js 和语言模型文件放入 `public/vendors/` 静态托管
2. 改为本地路径导入，用 Service Worker 缓存模型文件
3. 增加进度回调，在 UI 层显示模型加载进度（首次加载体验）
4. 使用 `Tesseract.createWorker` 的 `logger` 选项实时显示识别进度

---

## 四、架构升级路线（生产化方向）

```
当前 Demo 架构                      生产目标架构
─────────────────────               ─────────────────────────────────────────
主线程: 所有解析 + 渲染              主线程: UI 交互 + 状态管理
                                    Worker Pool: OOXML解析 / PDF渲染 / OCR / 波形

单 CollabClient                     多通道 CollabClient
                                    + 心跳检测 + 指数退避重连
                                    + 消息队列（离线暂存）

CollabDoc 墓碑永久保留              CollabDoc + GC（向量时钟 minClock）
                                    + Snapshot 压缩（超过阈值触发全量快照）

XLSX 单工作表                       XLSX 多工作表 Tabs
                                    + 流式解析（按需加载行列）

PDF 单实例                          PDF ServiceWorker 预取
                                    + 渲染队列优先级调度（可见 > 预取 > 缓存）

server.mjs 无验证                   server.mjs + room 鉴权 + 连接数限制
                                    + Redis pub/sub（多节点横向扩展）
```

---

## 五、代码质量改进

### 5.1 消除类型断言 `as`

```typescript
// 当前（不安全）
const collab = collabRef as React.MutableRefObject<CollabDoc<Annotation>>

// 改进：使用非空断言 + 类型守卫
function assertCollab(ref: React.RefObject<CollabDoc<Annotation> | null>)
  : asserts ref is React.MutableRefObject<CollabDoc<Annotation>> {
  if (!ref.current) throw new Error('CollabDoc not initialized')
}
```

### 5.2 FormatProbe 添加 CFB 子类型注释

```typescript
// CFB（OLE2）无法从字节层区分 doc/xls/ppt，
// 必须依赖扩展名辅助，这是 OLE2 格式的固有限制（非 Bug）。
// 未知扩展名时 realType = 'cfb'，路由到 server 端兜底转换。
if (realType === 'cfb') {
  realType = (['doc', 'xls', 'ppt'] as const).includes(declared as never)
    ? (declared as 'doc' | 'xls' | 'ppt')
    : 'cfb'
}
```

### 5.3 xml.ts 增加属性值中 `>` 的兼容性

```typescript
// 当前正则不处理属性值中的未转义 `>`
// 虽然 OOXML 规范要求转义，但防御性处理更稳健
const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/g
```

---

## 六、测试补充建议

| 模块 | 当前状态 | 建议补充 |
|------|---------|---------|
| `VirtualList.tsx` | 无测试 | 用 `@testing-library/react` + `jsdom` 测试量测回填逻辑 |
| `PdfEditor.tsx` | 无测试 | 用 MSW mock PDF.js，测试批注 CRUD + 撤销/重做 |
| `xlsx.ts` | 单工作表 | 补充多工作表文档解析测试，验证数字排序 |
| `FormatProbe.ts` | BMP 简单 | 补充 BMP 头验证的边界测试 |
| `CollabDoc.ts` | GC 缺失 | 补充 GC 后墓碑清理、minClock 边界的测试 |
| `waveform.ts` | 纯逻辑 | 补充 Worker 消息传递的集成测试 |

---

## 七、安全加固清单

- [ ] `server.mjs`：room ID 格式正则校验 + 最大 room 数限制
- [ ] `server.mjs`：WebSocket 消息体大小限制（防 OOM）
- [ ] `PdfEditor.tsx`：导出 PDF 前校验批注数据，防止 XSS 注入到 PDF 元数据
- [ ] `CapabilityRouter.ts`：mediaMime 修复后删除 UI 层的 MIME 补丁
- [ ] `CollabClient.ts`：增加消息签名验证（防伪造协同消息）

---

## 八、行业对标差距分析

| 能力维度 | 当前实现 | 行业顶尖（飞书/Notion） | 差距 |
|---------|---------|----------------------|------|
| 渲染首屏 | 三段式渐进 ✅ | 流式 SSR + 骨架屏 + 增量水合 | 缺流式 |
| 虚拟滚动 | 变高估算+回填 ✅ | 动态测量 + ResizeObserver ✅ | 有循环风险 |
| PDF 渲染 | IntersectionObserver ✅ | OffscreenCanvas + Worker 池 | 主线程渲染 |
| 协同 CRDT | LWW-Map ✅ | OT/YCRDT（字符级） | 批注粒度尚可 |
| 离线支持 | 无 | Service Worker + IndexedDB | 缺失 |
| 格式支持 | OOXML + legacy ✅ | + ODS/Numbers/Keynote | 较少 |
| OCR | CDN 动态加载 ⚠️ | 本地模型 + 渐进识别 | 体验差 |
| 安全 | 基础 ⚠️ | 沙箱 + CSP + 内容签名 | 需加固 |

---

*本报告由 Claude Code 审阅生成，基于对全量源码的静态分析。*
