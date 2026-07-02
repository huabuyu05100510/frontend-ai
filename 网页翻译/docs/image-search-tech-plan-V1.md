# 图搜地点 技术方案 V1（开源复刻版）

> **模型**：Claude (Sonnet 4.5)
> **定位**：浏览器内跨模态图搜系统，**不调云 API（不调豆包）**
> **IP 声明**：与滴滴实现完全独立，使用公开数据集 + 开源模型

---

## 1. 与滴滴版本的对比

| 维度 | 滴滴版本 | 本开源版 |
|---|---|---|
| 推理位置 | 调豆包 vision API（字节服务器） | **浏览器内**（WebGPU） |
| 模型 | 豆包（闭源） | **Chinese-CLIP**（OFA-Sys 开源） |
| 索引 | 服务端向量库 | **浏览器内 hnswlib-wasm** |
| 图片数据 | 上传到字节 | **永不上传** |
| 离线 | 不支持 | **支持** |
| IP | 滴滴公司 | **完全自有，可开源** |

**关键差异**：本版本主打「**隐私 / 离线 / 全本地**」，与滴滴商业产品**结构上不同**。

---

## 2. 技术栈

### 2.1 模型选型

| 模型 | 大小 | 中文支持 | 决定 |
|---|---|---|---|
| Chinese-CLIP-base | ~400MB | ✅ 原生中文 | ✅ 主选 |
| Chinese-CLIP-large | ~1.2GB | ✅ | 进阶 |
| OpenAI CLIP（原版） | ~600MB | ❌ 英文优先 | ❌ |

**量化**：Chinese-CLIP-base int8 量化后 ~100MB（浏览器可加载）。

### 2.2 索引

| 选项 | 优缺 | 决定 |
|---|---|---|
| hnswlib-wasm | 纯浏览器，性能好 | ✅ 主选 |
| 用 transformers.js 内置 | 简单但不支持增量 | 备选 |
| FAISS-wasm | 功能强但 wasm 编译复杂 | ❌ |

### 2.3 数据集（避开 IP）

| 数据集 | 来源 | 合规 |
|---|---|---|
| **TripAdvisor** 公开景点图 | Kaggle 公开数据集 | ✅ |
| **Unsplash Scenes** | Unsplash API（CC0） | ✅ |
| **小红书公开图** | ❌ **不可用**（滴滴场景） | ❌ IP 风险 |
| 自采集（旅游博客 CC0 图） | 手工 + 爬虫（合规） | ✅ |

**MVP**：先用 TripAdvisor + Unsplash，~10K 地点，~50K 图。

---

## 3. 架构

```
┌──────────────────────────────────────────────────┐
│ 浏览器扩展 / Web App                              │
│                                                   │
│   ┌─────────────┐                                 │
│   │ 用户上传图  │                                 │
│   └──────┬──────┘                                 │
│          ↓                                        │
│   ┌─────────────────────┐                         │
│   │ webgpu-engine.mjs   │ ← 复用翻译项目          │
│   │ Chinese-CLIP 编码   │                         │
│   └──────┬──────────────┘                         │
│          ↓ query embedding (512-d)                │
│   ┌─────────────────────┐                         │
│   │ vector-index.mjs    │                         │
│   │ hnswlib-wasm 检索   │                         │
│   └──────┬──────────────┘                         │
│          ↓ top-K 地点                              │
│   ┌─────────────────────┐                         │
│   │ attention-visualizer│ ← 复用翻译项目          │
│   │ 图像区域高亮        │                         │
│   └──────┬──────────────┘                         │
│          ↓                                        │
│   ┌─────────────────────┐                         │
│   │ map-heatmap.mjs     │                         │
│   │ 地图相似度热力图    │                         │
│   └─────────────────────┘                         │
└──────────────────────────────────────────────────┘

索引分片（按地理区域）：
  ├─ china-east.hnsw   (5K 地点)
  ├─ china-west.hnsw   (3K 地点)
  ├─ europe.hnsw       (8K 地点)
  └─ ... 按需加载
```

---

## 4. 关键模块

### 4.1 浏览器内推理（复用 `lib/webgpu-engine.mjs`）

```javascript
import { WebGpuEngine } from './lib/webgpu-engine.mjs'

const engine = await WebGpuEngine.load({
  model: 'ofa-sys/chinese-clip-vision-base-int8.onnx',
  backend: 'auto',  // webgpu > wasm
})

const embedding = await engine.encodeImage(imageBlob)
// → Float32Array(512)
```

### 4.2 索引（新增 `lib/vector-index.mjs`）

```javascript
import { VectorIndex } from './lib/vector-index.mjs'

const index = await VectorIndex.load({
  shards: ['china-east', 'china-west'],
  dim: 512,
  maxElements: 50000,
})

const results = await index.search(embedding, { k: 20 })
// → [{ placeId, score, geo }, ...]
```

**分片加载**：按 GPS 预过滤加载相关 shard，避免一次加载全索引。

### 4.3 attention 可视化（复用 `lib/attention-visualizer.mjs`）

**与翻译项目共享同一 lib**：
- 翻译项目：hover 中文词 → 高亮英文原文
- 图搜项目：hover 图像区域 → 高亮匹配地点特征

```javascript
import { AttentionVisualizer } from './lib/attention-visualizer.mjs'

const viz = new AttentionVisualizer({
  mode: 'region',  // 'word'（翻译）或 'region'（图搜）
  threshold: 0.3,
})

viz.bindTo(imageCanvas, attentionMap)
```

### 4.4 地图热力图（新增 `lib/map-heatmap.mjs`）

```javascript
import { MapHeatmap } from './lib/map-heatmap.mjs'

const heatmap = new MapHeatmap({
  container: mapElement,
  results,  // [{ placeId, score, geo }]
})

heatmap.render()
```

用 Mapbox GL JS 或 deck.gl（开源版用 Leaflet + heatmap.js）。

---

## 5. 性能预算

| 指标 | 目标 | 备注 |
|---|---|---|
| 首次加载（模型 + 1 shard） | < 5s | 模型 100MB + shard 5MB |
| 二次加载（SW 缓存） | < 500ms | |
| 图像编码 | < 200ms | WebGPU |
| HNSW 检索（10K 向量） | < 50ms | hnswlib-wasm |
| 内存峰值 | < 1.5GB | 模型 + 索引 + canvas |

---

## 6. UI 设计

### 6.1 主界面
```
┌──────────────────────────────────────┐
│ [上传图 / 粘贴 URL / 拖拽]            │
├──────────────────────────────────────┤
│ [搜索结果 - 卡片列表 / 地图视图]      │
│                                       │
│  ┌─────────┐  相似度 92%             │
│  │ place A │  杭州 · 西湖             │
│  └─────────┘                          │
│                                       │
│  ┌─────────┐  相似度 85%             │
│  │ place B │  苏州 · 拙政园           │
│  └─────────┘                          │
└──────────────────────────────────────┘
```

### 6.2 图像区域高亮
- 鼠标悬停图片某区域 → 该区域的 attention 高亮 + 弹出匹配地点
- 类似「这块石头匹配了哪个景点」

### 6.3 地图热力图
- 搜索结果按地理位置分布，相似度用颜色深浅表示
- 点击地点 → drill-down 看更多相似

---

## 7. 实施路线（4-5 周，前置：翻译项目完成）

| 周 | 交付 | 复用翻译项目 |
|---|---|---|
| W1 | Chinese-CLIP 浏览器加载 + 编码 | webgpu-engine ✅ |
| W2 | hnswlib-wasm 索引 + 离线构建 | - |
| W3 | 文字/图片 → top-K 地点（基础链路） | - |
| W4 | 图像区域 attention 高亮 | attention-visualizer ✅ |
| W5 | 地图热力图 + drill-down + 开源 | - |

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 量化 Chinese-CLIP 准确率掉 | 用 fp16 而非 int8；进阶接 rerank |
| 10 万+ 索引浏览器装不下 | 地理分片 + 按需加载 |
| Unsplash/TripAdvisor 数据量不够 | 加自采集 CC0 图 |
| **滴滴 IP 风险** | **数据 / 模型 / 实现完全独立，README 声明** |

---

## 9. 简历叙事

> **基于 WebGPU 的浏览器内跨模态图搜系统**：Chinese-CLIP 量化模型（~100MB）+ hnswlib-wasm 向量索引 + 地理分片加载，**图片 embedding 全本地推理，永不上传**。复用自研 WebGPU 推理引擎与 attention 可视化框架（与「翻译词级对齐」项目共享 70% 代码）。集成图像区域 attention 高亮、地图相似度热力图、交互式 drill-down，提供 Google Lens / 小红书搜索等云架构产品**结构上做不到**的隐私 + 离线体验。检索准确率 X%（自有评估集）。
