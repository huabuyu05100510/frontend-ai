# AI 图搜技术方案 — 14 年前端资深专家代表作

> 模型：claude-sonnet-4-6
> 生成日期：2026-07-01
> 调研来源：4 个并行 agent（技术栈 / UX 范式 / 后端架构 / 代码库扫描）
> 基础设计稿：`changes/ai-image-search/`（10 个文件，460KB，8 子模式 × 9 维度）

---

## 一、定位与目标

本方案将 AI 图搜（AI Image Search）打造为 office-doc-preview 系统的**核心差异化能力**，对标 Google Lens / Pinterest Lens / 拍立淘，面向办公文档场景（PDF/DOCX/PPT/扫描件/截图），实现：

- **以图搜图**：上传/截图/拖拽任意图片，在系统所有已索引文件中找到视觉相似内容
- **文字跨模态搜图**：输入文字描述，找到视觉匹配的文档页面
- **框选区域精搜**：框选文档某一局部，精准查找同款区域
- **文档级精准定位**：搜索结果直接定位到文档第 N 页、第 M 行，带高亮 bbox overlay
- **渐进式三层检索**：pHash(12ms) → MobileCLIP-S1(150ms) → SigLIP-base(500ms)，越来越准

---

## 二、技术栈选型（三阶段）

### Phase 0 — MVP（Week 1，3-4 人天）

| 层 | 选型 | 理由 |
|----|------|------|
| 嵌入模型 | **MobileCLIP-S0 ONNX INT8**（~50MB，512-dim） | 最小最快，CPU P50 < 100ms |
| 推理运行时 | **onnxruntime-node** | 纯 Node.js，零 Python 依赖，与现有栈一致 |
| 嵌入缓存 | **L1 Map LRU 500 + L2 JSONL 5000** | 零额外依赖，文件 hash 快速命中 |
| 粗筛层 | **pHash 64-bit**（纯 JS，< 5ms） | 完全相同图零模型命中 |
| 索引存储 | **JSONL 暴力扫描**（< 1000 张，< 30ms） | 代码 < 200 行，零依赖 |
| 搜索策略 | 余弦相似度暴力排序，RRF 融合 text fallback | |
| 前端推理 | 服务端模式（MVP 不做浏览器推理） | 降低复杂度 |
| 新增 npm | `onnxruntime-node` `xxhash-wasm` | |

### Phase 1 — 生产级（Week 2-3，6-8 人天）

| 层 | 选型 | 升级理由 |
|----|------|---------|
| 嵌入模型 | **MobileCLIP-S1 ONNX**（~150MB，512-dim） | 精度接近 CLIP ViT-B/32，中文场景更好 |
| 文本嵌入 | **MobileCLIP text encoder**（同一模型） | 支持文字描述搜图（跨模态） |
| 索引存储 | **LanceDB HNSW**（10K 内 < 8ms） | 零运维，Node npm 包，Parquet 列存 |
| 检索策略 | **Hybrid Search = 视觉稠密 + BM25 稀疏，RRF 融合** | 兼顾视觉和文字内容 |
| 前端推理 | **WebGPU EP（MobileCLIP-S1 ONNX INT8）**，WASM 降级 | Chrome 113+ ~12-30ms，Firefox WASM ~150ms |
| 增量索引 | 文件 `mtime` 轮询 + 脏检测重建 | |
| 新增 npm | `lancedb` | |

### Phase 2 — 规模化（Month 2+）

| 层 | 选型 | 说明 |
|----|------|------|
| 嵌入模型 | **SigLIP-base**（~400MB，768-dim，多语言强） | 中英混合文档精度提升 ~10% |
| 推理 | **Python CLIP 微服务**（GPU 加速，可选） | 吞吐 > 4x，部署成本高 |
| 索引 | **Qdrant Docker HNSW**（< 100K，< 3ms） | 多租户 + 过滤推送 |
| 流式响应 | **SSE `/api/search/stream`** | 大索引边算边推结果 |
| 可观测 | OTEL 指标 + 仪表盘 | |

---

## 三、后端模块设计

### 3.1 文件结构

```
server/src/
  image-search/
    embedding.mjs       # ONNX session + pHash + LRU cache
    index-store.mjs     # JSONL 持久化 + 余弦搜索（Phase 0）
    index-lancedb.mjs   # LanceDB HNSW（Phase 1 替换）
    similarity.mjs      # 余弦 / 汉明距离工具函数
    jobs.mjs            # 异步嵌入队列（复用 translate-jobs 模式）
    mock-embeddings.mjs # IMAGE_SEARCH_PROVIDER=mock 时返回 5 个示例向量
  router.mjs            # 新增 8 条路由（regex 匹配，避免 query string bug）
```

### 3.2 API 路由（8 条，按项目 router.mjs 模式）

```
POST   /api/search/image          # 图片文件上传 → 向量检索
POST   /api/search/text           # 文字描述 → 跨模态搜图
POST   /api/search/region         # base64 裁剪区域 → 精准搜
GET    /api/search/index/status   # 索引状态 + 进度
POST   /api/search/index/rebuild  # 触发全量重建
POST   /api/search/index/update   # 增量更新单张图
GET    /api/search/suggest        # 搜索建议（历史向量聚类）
GET    /api/search/stream         # SSE 流式结果（Phase 2）
```

### 3.3 核心响应头（可观测性）

```
X-Search-Engine          mobileclip-s0 | mobileclip-s1 | siglip-base | phash
X-Search-Latency-Ms      服务端端到端延迟（整数）
X-Search-Total           返回命中数
X-Embed-Model            嵌入模型名
X-Embed-Dim              向量维度 64 / 512 / 768
X-Index-Size             索引条目数
X-Search-Threshold       相似度阈值
X-Search-Mode            dense | hybrid | text
X-Search-Layer           L1 | L2 | L3（命中层）
X-Cache-Hit              true | false
X-Query-Id               UUID 追踪
X-Timeline-Id            workspace-timeline 事件 ID
```

### 3.4 日志格式

遵循项目约定：

```
[image-search 2026-07-01T14:32:18.231Z] action=search_start queryId=uuid inputFile=car.jpg inputBytes=234567
[image-search 2026-07-01T14:32:18.290Z] action=phash_hit queryId=uuid hash=abc123 latencyMs=2
[image-search 2026-07-01T14:32:18.490Z] action=embed_infer queryId=uuid engine=mobileclip-s0 dim=512 latencyMs=198
[image-search 2026-07-01T14:32:18.530Z] action=index_search queryId=uuid mode=bruteforce indexSize=1024 latencyMs=38
[image-search 2026-07-01T14:32:18.531Z] action=search_done queryId=uuid engine=mobileclip-s0 hits=47 latencyMs=300 topSim=0.94
```

### 3.5 三层检索降级链

```
用户上传图片
  |
  +-- L1: pHash 64-bit (< 5ms, 零模型)
  |   完全相同图 / 旋转镜像 → 直接命中，终止
  |
  +-- L2: MobileCLIP ONNX 512-dim (~120ms)
  |   余弦 > 0.75 → 返回 Top-50，终止
  |
  +-- L3: 文本 OCR fallback
      L2 命中 < 5 条 → 提取文件名/OCR文字 → 文本倒排
```

### 3.6 嵌入缓存策略

```javascript
// 三层缓存
L1: Map LRU 500 条    // 进程内存，~0.01ms
L2: JSONL 磁盘 5000 条 // .data/image-search/embedding-cache.jsonl，~0.5ms
L3: 无                 // 直接 ONNX 推理，~120-250ms

// 文件 hash（前 4KB + 文件大小，xxhash 8 字符短 hash）
// mtime 变化 → 缓存失效 → 重新推理
```

### 3.7 文档入库流水线

```
POST /api/upload 完成（现有逻辑）
  |
  +-- 判断文件类型（图片：png/jpg/webp/gif/bmp）
      非图片 → 如是 PDF/DOCX → PDFium 页面截图 → 同样走图片索引
  |
  +-- pushToEmbeddingQueue(fileId)
      1. 计算 fileHash（xxhash）
      2. 检查 L1/L2 缓存
      3. 运行 MobileCLIP ONNX session.run()
      4. 写入 IndexStore
      5. 任务状态 → 'indexed'
      6. 可选: emit SSE 进度到前端
```

---

## 四、前端模块设计

### 4.1 文件结构

```
web/src/
  pages/
    ImageSearchPage.tsx          # 图搜主页面（路由 /image-search）
  components/
    ImageSearchBox.tsx           # 多模态搜索框（文字+图片+URL混合 query）
    ResultCard.tsx               # 三合一结果卡（缩略图+文件+相似度）
    ResultMasonry.tsx            # 虚拟化瀑布流视图
    ResultGrid.tsx               # 网格视图
    ResultList.tsx               # 列表视图（带文档级定位）
    SelectionCrop.tsx            # 框选裁剪 overlay（Canvas，零依赖）
    HeatmapOverlay.tsx           # 相似度热力图 canvas overlay
    PreviewPopover.tsx           # hover 600ms 触发的文档预览浮卡
    SimilarityBadge.tsx          # 相似度色阶徽章（复用 ConfidenceDot 逻辑）
  hooks/
    useImageSearch.ts            # 包装 /api/search/* API
    useClipboardImage.ts         # 全局 paste 监听 + 权限引导
    useKeyboardNav.ts            # 全局快捷键导航
    useSelectionCrop.ts          # 框选选区状态机
    useSearchHistory.ts          # IndexedDB 历史记录 + 向量建议
  store.ts                       # 新增 imageSearch 切片
  routes.ts                      # 新增 /image-search 路由
```

### 4.2 多模态搜索框状态机

```
空态 → [粘贴图片] → 图片附件模式（图+文混合 query）
     → [粘贴URL]  → URL 分析模式（远程图片预取）
     → [拖入图片] → 以图搜图模式
     → [输入文字] → 纯文本搜图模式
     → [摄像头]   → 实时拍照模式

混合 query 向量融合策略：
  纯文本 → CLIP text encoder → 512-dim
  图片   → CLIP vision encoder → 512-dim
  混合   → weight sum: vision * 0.6 + text * 0.4
```

### 4.3 Google Lens 式框选放大镜

```
触发：Shift + 拖拽 或 长按（移动端）
实现：
  1. Canvas 2D drawImage 裁剪选区
  2. 放大镜：clip-path circle(80px) 跟随光标
  3. 8 个 resize 手柄（N/NE/E/SE/S/SW/W/NW）
  4. 键盘微调：← → ↑ ↓（1px），Shift+（10px）
  5. 确认后 POST /api/search/region，body 为 base64 裁剪图
```

### 4.4 三种视图切换（V 键循环）

| 视图 | 场景 | 技术 |
|------|------|------|
| 瀑布流（默认） | 以图搜图、设计素材 | 虚拟化 masonry，column-count CSS |
| 网格 | 文档扫描件、截图 | CSS Grid，aspect-ratio 保持 |
| 列表 | 跨文档追溯、精准定位 | flex column，带页码+摘要 |

### 4.5 文档级精准定位

```
点击结果卡 [定位到此处]：
  → navigate(`/files/${taskId}?page=7&highlight=bbox_42`)
  → PreviewModal 打开第 7 页
  → ImageRegionSvgOverlay（复用已有组件）绘制 bbox
  → 脉冲动画 2s（蓝色描边 0.3↔0.6 opacity）
  → RightPanel 文字行高亮
  → toast: "已定位到合同第 7 页 第 12 行"
```

### 4.6 Shared Element Transition（结果卡 → 文档预览）

```typescript
// View Transitions API（Chrome 111+）
document.startViewTransition(() => {
  navigate(`/files/${taskId}?page=7`)
})

// 降级：Framer Motion layoutId（?motion=on 时）
<motion.div layoutId={`result-${matchId}`}>
  {isOpen ? <FullPreview /> : <ResultCard />}
</motion.div>

// 兜底：无动画（data-motion="off" 或不支持）
```

### 4.7 全局快捷键

```
/           聚焦搜索框
↑↓          结果列表导航
Enter       打开选中结果
V           切换视图（瀑布流/网格/列表）
F           收藏/取消收藏
R           重新搜索
Esc         返回 / 关闭浮卡
⌘+Enter    在侧栏打开完整文档
⌘+Shift+V  粘贴剪贴板图片搜索
⌘+Shift+S  区域截图模式
1/2/3       切换 L1/L2/L3 检索层
Alt+H       显示快捷键帮助
```

### 4.8 动效规范

```css
/* 粒子扩散（分析中） */
@keyframes particle-spread {
  0%   { transform: translate(0,0) scale(1); opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(0.3); opacity: 0; }
}

/* 结果卡 stagger 飞入 */
@keyframes card-enter {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* stagger 间隔 60ms；easing: cubic-bezier(0.4, 0, 0.2, 1) */

/* 命中区域脉冲（attention） */
@keyframes attention-pulse {
  0%, 100% { box-shadow: 0 0 4px rgba(66,133,244,0.3); }
  50%       { box-shadow: 0 0 16px rgba(66,133,244,0.6); }
}

/* 全部动效受 html[data-motion="off"] 守卫（项目既有规范） */
html[data-motion="off"] * {
  animation-duration: 0.01ms !important;
  transition-duration: 0.01ms !important;
}
```

### 4.9 深色模式

所有颜色使用 `var(--color-*)` 语义 token，禁止 hex 字面量（`noInlineHex.test.tsx` 静态守卫）：

```css
/* 相似度色阶（深色模式自动切换） */
--sim-high:   var(--color-green-5);   /* > 0.9 */
--sim-mid:    var(--color-amber-5);   /* 0.7-0.9 */
--sim-low:    var(--color-orange-5);  /* 0.5-0.7 */
--sim-miss:   var(--color-red-5);     /* < 0.5 */
```

---

## 五、ASCII 设计稿

### 5.1 主界面——空态 / 分析中 / 有结果

```
空态:
+-----------------------------------------------------------------------------+
| TopBar  [AI 图搜]  ...  [⌘K]  [主题]                                        |
+-----------------------------------------------------------------------------+
|                                                                             |
|                       以图搜图 — 找到文档中的相似内容                         |
|                                                                             |
|            +----------------------------------------------+                |
|            |                                              |                |
|            |  拖入图片 / 文件夹（最多 50 张）              |                |
|            |  ─────────────────────────────────           |                |
|            |  [选文件]  [⌘V 粘贴]  [URL]  [摄像头]        |                |
|            |                                              |                |
|            |  [🔍 输入文字描述搜图...]          [📎]      |                |
|            |                                              |                |
|            +----------------------------------------------+                |
|            最近: [合同模板]  [产品图]  [公司 logo]                           |
+-----------------------------------------------------------------------------+

分析中:
+-----------------------------------------------------------------------------+
|                                                                             |
|  正在分析图片内容...                                                         |
|                                                                             |
|  +--------------------------------------------------------------+           |
|  |    .  .  .  .       粒子向四周扩散（12 颗，brand 渐变）        |           |
|  |   . [缩略图] .                                                |           |
|  |    .  .  .  .                                                 |           |
|  |                                                              |           |
|  |  [============================-----] 65%                     |           |
|  |  v L1 pHash (12ms)                                           |           |
|  |  ... L2 MobileCLIP (~600ms)                                  |           |
|  |  ... L3 文本 fallback (~1.2s)                                |           |
|  +--------------------------------------------------------------+           |
|  预计剩余 1.5s  [取消]                                                       |
+-----------------------------------------------------------------------------+

有结果（瀑布流 + 侧栏筛选器）:
+-----------------------------------------------------------------------------+
| [🖼 car.jpg x] 汽车内饰设计  [📎]  [⌘1 L1] [⌘2 L2] [V 视图] [F 筛选]      |
| 共 47 个结果 · 1.2s · L2 语义 · 引擎: mobileclip-s1                         |
+--------------------------------------------------+---------------------------+
|  瀑布流 4 列（虚拟化）                            |  筛选器                  |
|  +------+ +------+ +------+ +------+             |  相似度 ─○─────── 0.7   |
|  |      | |      | |      | |      |  0.94/0.91 |  格式 jpg png webp      |
|  | 🚗#1 | | 🚙#2 | | 🏎#3  | | 📄#4 |  0.88/0.85|  时间 全部/本周/本月    |
|  |      | |      | |      | |      |             |  颜色 [色块选色器]       |
|  +------+ +------+ +------+ +------+             |                         |
|  文件名    第7页    logo.png  合同p3               |  键盘:                  |
|                                                  |  V 切视图  / 聚焦       |
|  +------+ +------+ +------+ +------+             |  F 收藏   R 重搜        |
|  | 🖼#5 | | 📸#6 | | 🚛#7  | | 🖼#8 |             |  1-3 L1/L2/L3 层       |
|  +------+ +------+ +------+ +------+             |                         |
|                                                  |                         |
|  [加载更多...]                                   |                         |
+--------------------------------------------------+---------------------------+
```

### 5.2 结果卡片解剖图

```
+----------------------------------------------+
|                                              |
|  +------------------------------------------+ |
|  |  [缩略图，保持原始比例，max-width 280px]   | |
|  |                                          | |
|  |  +-- 相似度徽章（左上角）──+              | |
|  |  | 0.94  [色阶指示]       |              | |
|  |  +────────────────────────+              | |
|  |  绿 >= 0.9 / 黄 0.7-0.9 / 红 < 0.7      | |
|  +------------------------------------------+ |
|                                              |
|  📄 contract-v3.pdf           [打开] [定位]  |
|  📍 第 7 页 · 第 12 行         [收藏] [删除] |
|  命中文字: "合同金额 ¥1,500,000..."           |
|                                              |
|  hover 600ms → 右侧展开完整文档预览浮卡       |
+----------------------------------------------+
```

### 5.3 框选搜索 Overlay

```
+------------------------------------------------------------------+
|  文档大图预览（全屏 canvas）                                       |
|                                                                  |
|  鼠标 → 十字准心 (crosshair)                                     |
|                                                                  |
|    +──────────────────+                                          |
|    |  选区 320×240     |   ← 2px brand-color 边框                |
|    |  "合同金额条款"   |   ← 文字预览（实时 OCR）                 |
|    |                  |   ← 4 角 L 形 24px                       |
|    |                  |   ← 4 边中点 resize 手柄                  |
|    +──────────────────+                                          |
|    选区外：半透明暗色遮罩                                         |
|                                                                  |
|  +── 放大镜（跟随光标，偏移 20px）──+                             |
|  |  圆形剪裁 80px 半径 / 1.5x 放大  |                             |
|  +────────────────────────────────+                             |
|                                                                  |
|  底部操作栏:                                                      |
|  [搜索该区域]  [重新框选]  [取消]                                  |
|  快捷键: R 重选  Enter 确认  Esc 退出                             |
+------------------------------------------------------------------+
```

---

## 六、TDD 三件套

### 6.1 单元测试（10+ 条）

```
server/test/
  image-search.embedding.test.mjs    # pHash / ONNX 缓存命中 / 批量推理
  image-search.index-store.test.mjs  # JSONL upsert / remove / search topK
  image-search.similarity.test.mjs   # 余弦距离 / 汉明距离 / RRF 融合

web/test/
  hooks/useImageSearch.test.ts       # 状态机 / 错误降级 / 取消
  hooks/useSelectionCrop.test.ts     # 拖拽 / resize 手柄 / 边界 clamp
  hooks/useClipboardImage.test.ts    # paste 事件 / 权限引导
  components/ImageSearchBox.test.tsx # 三种 query 类型切换
  components/ResultCard.test.tsx     # 相似度色阶 / 定位跳转
  components/SelectionCrop.test.tsx  # Canvas 裁剪 / 键盘微调
  components/SimilarityBadge.test.tsx # 色阶逻辑
```

### 6.2 E2E 测试（3+ 条）

```
web/e2e/
  image-search-upload.spec.ts     # 拖拽上传 → 分析 → 瀑布流结果
  image-search-keyboard.spec.ts   # / 聚焦 → ↑↓ 导航 → Enter 打开 → Esc 返回
  image-search-region.spec.ts     # Shift+拖拽 → 框选 → 搜索 → 预览定位
```

### 6.3 视觉回归（3+ 条）

```
web/e2e/image-search.spec.ts-snapshots/
  空态截图.png
  有结果-瀑布流.png
  框选-overlay.png
```

---

## 七、存量设计稿集成

`changes/ai-image-search/` 已有 8 个子模式设计稿（460KB），本技术方案与之关系：

| 子模式 | 文件 | 优先级 | 本方案覆盖 |
|--------|------|--------|-----------|
| 以图搜图 | 01-reverse-image-search.md | **P0** | 完整覆盖 |
| 截图识图 | 02-screenshot-assistant.md | **P0** | 完整覆盖 |
| 跨文档追溯 | 03-cross-doc-trace.md | **P1** | Phase 1 列表视图 |
| 图像 Diff | 04-visual-diff.md | **P2** | Phase 2 |
| 视觉聚类 | 05-clustering.md | **P2** | Phase 2 |
| 图片 TM | 06-image-tm.md | **P1** | Phase 1 |
| 质量雷达 | 07-quality-scanner.md | **P3** | 后续 |
| 多模态联动 | 08-multimodal-pipeline.md | **P1** | Phase 1 |

---

## 八、与现有项目的集成点

### 8.1 复用现有组件

| 组件/Hook | 路径 | 复用方式 |
|-----------|------|---------|
| `ImageRegionSvgOverlay` | components/ | 命中区域 bbox overlay（定位高亮） |
| `ProgressRing` | components/ | 嵌入分析进度环 |
| `ConfidenceDot` | components/ | 相似度色阶（相同配色逻辑） |
| `ImageDualView` | components/ | 原图 vs 命中页双栏对比 |
| `Modal` | components/ | 快捷键帮助 / 分享链接弹层 |
| `RightPanel` | components/ | 结果详情侧栏 |
| `useWorkspaceTimeline` | hooks/ | 记录 kind='image-search' 事件 |
| `useImageBatch` | hooks/ | 批量上传队列 |
| `useCrossPageHandoff` | hooks/ | 结果 → 文档页面跳转 URL 构建 |
| `usePrefersReducedMotion` | hooks/ | 动效守卫 |
| `Hover/Press/PageTransition` | motion/ | 卡片交互动效 |

### 8.2 新增路由

在 `routes.ts` 和 `AppRouter.tsx` 中新增：

```typescript
{ path: '/image-search', label: 'AI 图搜', icon: 'search', key: 'imageSearch' }
```

### 8.3 zustand store 新增切片

```typescript
// 新增 imageSearch 切片
imageSearchQuery: null as File | string | null,
imageSearchResults: [] as ImageSearchResult[],
imageSearchStatus: 'idle' as 'idle' | 'analyzing' | 'searching' | 'done' | 'error',
imageSearchLayer: 'L2' as 'L1' | 'L2' | 'L3',
imageSearchViewMode: 'masonry' as 'masonry' | 'grid' | 'list',
imageSearchHistory: [] as ImageSearchHistory[],  // localStorage 持久化
setImageSearchQuery: (q) => ...,
setImageSearchResults: (r) => ...,
```

### 8.4 ⌘K Palette 新增 imageSearch 来源

在 `palette/sources/` 中新增 `imageSearch.ts`，注册到 `AllSourcesRegister`：

```typescript
// 来源 6: imageSearch
// 包含 8 个子模式快速入口 + 最近搜索记录
```

---

## 九、性能基线

| 操作 | P50 目标 | P95 目标 | 说明 |
|------|---------|---------|------|
| pHash 计算（端侧） | < 5ms | < 15ms | Canvas dHash |
| MobileCLIP-S1 WebGPU | < 30ms | < 80ms | Chrome 113+ |
| MobileCLIP-S1 WASM 降级 | < 200ms | < 400ms | Firefox |
| 服务端 ONNX 推理 | < 150ms | < 300ms | CPU |
| JSONL 暴力搜索（1K） | < 5ms | < 20ms | MVP |
| LanceDB HNSW（10K） | < 8ms | < 20ms | Phase 1 |
| 端到端图搜（L1） | < 100ms | < 300ms | 含网络 |
| 端到端图搜（L2） | < 500ms | < 1s | 含推理 |
| 缩略图 hover 预览 | < 50ms | < 150ms | 已有 PDFium |

---

## 十、变更文档位置

```
changes/ai-image-search/
  README.md              # 总索引（已有，8 子模式 ROI 矩阵）
  technical-design.md    # 本文档（技术方案）
  industry-research.md   # 调研（37 款产品，已有）
  01～08-*.md            # 子模式详细设计（已有）
```

---

> 声明：本技术方案由 claude-sonnet-4-6 生成，基于 4 个并行调研 agent 的汇总输出。
> 关键数字（模型大小、延迟基准）来自 changes/ai-image-search/industry-research.md 及公开论文，建议实测验证。
