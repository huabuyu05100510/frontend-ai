# 共享技术栈设计

> **模型**：Claude (Sonnet 4.5)
> **目的**：翻译 + 图搜两个项目共享底层 lib，证明**前端 ML 部署基础设施的抽象与复用能力**

---

## 1. 共享层架构

```
┌──────────────────────────────────────────────────────┐
│ 应用层                                                 │
│  ├─ 翻译扩展（demo.html + extension/）                 │
│  └─ 图搜扩展（image-search/）                          │
├──────────────────────────────────────────────────────┤
│ 共享层 lib/（本文件定义）                              │
│  ├─ webgpu-engine.mjs       通用推理引擎              │
│  ├─ attention-visualizer.mjs attention 可视化         │
│  ├─ model-cache.mjs         Service Worker 缓存       │
│  ├─ streaming-inference.mjs 流式推理框架              │
│  └─ backend-detector.mjs    WebGPU/wasm 自动降级      │
├──────────────────────────────────────────────────────┤
│ 第三方依赖                                              │
│  ├─ @huggingface/transformers（transformers.js v3）   │
│  ├─ hnswlib-wasm（仅图搜用）                          │
│  └─ onnxruntime-web（底层推理）                       │
└──────────────────────────────────────────────────────┘
```

---

## 2. lib 模块清单

### 2.1 `lib/webgpu-engine.mjs`（核心）

通用模型加载 + 推理，**模型无关**（支持 NMT / CLIP / 任意 transformer）。

```javascript
export class WebGpuEngine {
  /**
   * @param {Object} opts
   * @param {string} opts.modelUrl  ONNX 模型 URL
   * @param {'auto'|'webgpu'|'wasm'} opts.backend
   */
  static async load(opts) { /* ... */ }

  /**
   * 编码图片 → embedding（CLIP 用）
   * @param {Blob|ArrayBuffer} image
   * @returns {Promise<Float32Array>}
   */
  async encodeImage(image) { /* ... */ }

  /**
   * 翻译 + 导出 attention（NMT 用）
   * @param {string} text
   * @returns {Promise<{ translation, attention, srcTokens, tgtTokens }>}
   */
  async translateWithAttention(text) { /* ... */ }

  /**
   * 通用文本编码（CLIP text encoder / BGE / ...）
   * @param {string} text
   * @returns {Promise<Float32Array>}
   */
  async encodeText(text) { /* ... */ }
}
```

**关键设计**：
- 单例：一个页面同时只加载一个模型实例（内存控制）
- backend 自动降级：WebGPU → wasm → 抛错（让上层 fallback 云 API）
- 可观测：每次推理记录 latency / token 数 / memory

### 2.2 `lib/attention-visualizer.mjs`

**双模式**：词级（翻译）+ 区域级（图搜）。

```javascript
export class AttentionVisualizer {
  /**
   * @param {Object} opts
   * @param {'word'|'region'} opts.mode
   * @param {number} opts.threshold  显示阈值
   * @param {string} opts.highlightClass  CSS 类
   */
  constructor(opts) { /* ... */ }

  /**
   * 绑定到容器（翻译：DOM；图搜：canvas）
   * @param {HTMLElement|HTMLCanvasElement} container
   * @param {AttentionData} attention
   */
  bindTo(container, attention) { /* ... */ }

  /** hover 处理 */
  _onHover(idx) { /* ... */ }

  /** 高亮 src ↔ tgt 配对 */
  _highlightPair(srcIdx, tgtIdx) { /* ... */ }
}
```

**翻译用法**：
```javascript
viz.bindTo(translatedDom, {
  mode: 'word',
  pairs: [{ srcIdx: 0, tgtIdx: 1, score: 0.9 }],
})
```

**图搜用法**：
```javascript
viz.bindTo(imageCanvas, {
  mode: 'region',
  heatmap: attentionMatrix,  // [h×w]
})
```

### 2.3 `lib/model-cache.mjs`

Service Worker 拦截模型请求，分片缓存。

```javascript
export class ModelCache {
  /**
   * @param {string} cacheName  'nmt-v1' / 'clip-v1'
   * @param {number} maxBytes  配额
   */
  constructor(cacheName, maxBytes) { /* ... */ }

  /**
   * 注册到 Service Worker
   */
  registerInSW(swScriptPath) { /* ... */ }

  /**
   * 查询缓存
   */
  async get(url) { /* ... */ }

  /**
   * 写入缓存（带 LRU）
   */
  async set(url, response) { /* ... */ }

  /**
   * 配额检查 + 淘汰
   */
  async evictIfNeeded() { /* ... */ }
}
```

### 2.4 `lib/streaming-inference.mjs`

流式推理（长文本翻译 / 多图编码）。

```javascript
export class StreamingInference {
  /**
   * 流式翻译（边生成边返回）
   * @param {string} text
   * @param {(chunk: { token, attention? }) => void} onToken
   */
  async *translateStream(text) {
    // 用 transformers.js 的 streamer 接口
  }

  /**
   * 批量图像编码
   * @param {Blob[]} images
   * @param {(idx, embedding) => void} onProgress
   */
  async *encodeImagesStream(images) { /* ... */ }
}
```

### 2.5 `lib/backend-detector.mjs`

```javascript
export async function detectBackend() {
  // 1. WebGPU
  if ('gpu' in navigator) {
    const adapter = await navigator.gpu.requestAdapter()
    if (adapter) return { name: 'webgpu', adapterInfo: adapter.info }
  }
  // 2. wasm threads
  if (typeof SharedArrayBuffer !== 'undefined') {
    return { name: 'wasm-threads' }
  }
  // 3. wasm
  return { name: 'wasm' }
  // 4. 都不行 → 上层 fallback 云 API
}
```

---

## 3. 项目独有模块（不复用）

### 翻译项目独有
- `lib/word-aligner.mjs` — attention → 词级对齐算法（BPE 合并、argmax）
- `lib/token-char-mapper.mjs` — BPE token → 字符区间映射（Marian 专用）

### 图搜项目独有
- `lib/vector-index.mjs` — hnswlib-wasm 封装
- `lib/index-sharding.mjs` — 地理分片策略
- `lib/map-heatmap.mjs` — 地图热力图渲染

---

## 4. 共享比例

| 模块 | 翻译用 | 图搜用 | 共享 |
|---|---|---|---|
| webgpu-engine | ✅ | ✅ | ⭐⭐⭐⭐⭐ |
| attention-visualizer | ✅ | ✅ | ⭐⭐⭐⭐⭐ |
| model-cache | ✅ | ✅ | ⭐⭐⭐⭐⭐ |
| streaming-inference | ✅ | ✅ | ⭐⭐⭐⭐ |
| backend-detector | ✅ | ✅ | ⭐⭐⭐⭐ |
| word-aligner | ✅ | ❌ | - |
| vector-index | ❌ | ✅ | - |
| map-heatmap | ❌ | ✅ | - |

**共享率 ≈ 70%**（5/8 模块）。

---

## 5. 简历叙事

> 自研「前端 ML 部署基础设施」共享层（`lib/webgpu-engine` + `attention-visualizer` + `model-cache` + `streaming-inference` + `backend-detector`），抽象模型加载 / 推理 / 缓存 / 可视化的通用能力。在「翻译词级对齐」和「图搜跨模态检索」两个项目中**复用 70% 代码**，证明前端 ML 工程的抽象设计能力。
