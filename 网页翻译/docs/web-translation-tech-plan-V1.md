# 网页翻译平台 — 技术方案 V1

> **模型声明**：本方案由 Claude Sonnet 4.6 (`claude-sonnet-4-6`) 生成，2026-06-22

---

## 一、目标定义

| 维度 | 目标 |
|------|------|
| **产品** | 对标讯飞智能翻译 SaaS，覆盖网页/文档/文本/图片翻译 + 双语对照 |
| **性能** | FCP<1000ms · LCP<2000ms · CLS<0.02 · INP<200ms |
| **质量** | TDD + E2E + UI回归，覆盖率 >80% |
| **可观测** | 全链路 tracing，翻译延迟 P90/P95/P99 上报 |
| **扩展** | 后续叠加标注、协同、质检能力 |

---

## 二、整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                      前端翻译平台（React 18 + Vite）                    │
│                                                                        │
│  ┌──────────────┬──────────────┬──────────────┬────────────────────┐  │
│  │  网页翻译     │  文档翻译     │  文本翻译     │   翻译任务中心      │  │
│  │  URL → 抓取  │  Upload+解析  │  Google式输入 │   TaskHub         │  │
│  └──────────────┴──────────────┴──────────────┴────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │              双语对照器 BilingualViewer                            │  │
│  │   OriginalPane  ←──[段落级同步滚动]──→  TranslationPane           │  │
│  │   [原文高亮]                            [流式译文渐入]             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTP/SSE
┌───────────────────────────────▼──────────────────────────────────────┐
│                    后端服务（Node.js + Fastify）                        │
│                                                                        │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────────────────┐ │
│  │  网页抓取 │  文档解析 │  翻译网关 │  任务调度 │  翻译记忆 TM Cache  │ │
│  │ WebFetch │ DocParser│ TransGW  │TaskSched │  Redis + Sqlite      │ │
│  └──────────┴──────────┴──────────┴──────────┴──────────────────────┘ │
│                                  │                                     │
│                       ┌──────────▼──────────┐                         │
│                       │   MiniMax LLM API    │                         │
│                       │  (sk-cp-..., 流式)   │                         │
│                       └─────────────────────┘                         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 三、核心模块设计

### 3.1 翻译引擎 TranslationEngine

```typescript
// 翻译引擎核心抽象
interface TranslationEngine {
  // 段落级翻译，返回 AsyncGenerator 实现流式输出
  translateStream(
    segments: Segment[],
    srcLang: LangCode,
    tgtLang: LangCode,
    options?: TranslateOptions
  ): AsyncGenerator<TranslationChunk>
}

interface Segment {
  id: string          // 段落 ID，用于双语对齐
  text: string        // 原文
  context?: string    // 上下文（前后段落）— 提升翻译质量
  type: 'paragraph' | 'heading' | 'caption' | 'code' | 'nav'
}

interface TranslationChunk {
  segmentId: string
  delta: string       // 增量文字（流式）
  done: boolean
  confidence?: number // 置信度（用于高亮）
}
```

**MiniMax LLM 集成策略**：
- System Prompt 注入：角色 + 领域专业词汇 + 格式约束
- Batch 合并：≤8 段合一次请求，减少 RTT
- 上下文滑窗：携带前2段作 context，提升连贯性
- 流式 SSE：后端转发给前端，实现逐字渐显效果

### 3.2 网页翻译（核心功能）

**方案：服务端代理 + DOM 注入**

```
用户输入 URL
     ↓
后端 WebFetch（Puppeteer headless）
     ↓
提取正文 DOM（Readability.js 算法）
     ↓
结构化为 Segments（保留 heading/p/li/td 语义）
     ↓
翻译引擎并行翻译（≤4 并发）
     ↓
前端 BilingualViewer 渲染
   ├── 双语模式：原文 + 译文双列
   └── 仅译文模式：替换原文
```

**关键技术点**：
1. **结构保留**：翻译 text node，保留 HTML 结构（链接/图片/表格不破坏）
2. **跳过不翻译**：`<code>` `<pre>` `<script>` `<style>` 节点跳过
3. **页面截图**：Puppeteer 截图作为视觉参考（用于后续标注功能）

### 3.3 文档翻译

复用 office-doc-preview 的文档解析基础设施：

```
Upload → DocParser → UDM（统一文档模型）
                         ↓
              UDMTranslator（段落遍历）
                         ↓
              翻译引擎流式翻译
                         ↓
              BilingualDocViewer（双列PDF/DOCX渲染）
```

支持格式：PDF / DOCX / TXT / SRT（MVP 阶段）

### 3.4 BilingualViewer 双语对照器

```typescript
// 双语视图核心 hook
function useBilingualSync(segments: BilingualPair[]) {
  const [activeId, setActiveId] = useState<string | null>(null)

  // 段落级同步滚动（非像素级）
  const syncScroll = useCallback((segmentId: string) => {
    const srcEl = document.querySelector(`[data-seg="${segmentId}"]`)
    const tgtEl = document.querySelector(`[data-tgt="${segmentId}"]`)
    tgtEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  // 点击段落高亮对应译文
  const handleSegmentClick = (id: string) => {
    setActiveId(id)
    syncScroll(id)
  }

  return { activeId, handleSegmentClick }
}
```

**布局策略**：

| 模式 | 布局 | 适用场景 |
|------|------|---------|
| 双栏对照 | 50/50 左右分列 | 桌面端，需对比 |
| 译文覆盖 | 单栏，译文替换 | 快速阅读 |
| 悬停弹窗 | hover 原文显示译文气泡 | 轻量阅读 |
| 句句对照 | 原文行/译文行交替 | 学习场景 |

---

## 四、后端 API 设计

```
POST   /api/translate/text          # 文本直接翻译
POST   /api/translate/url           # 网页 URL 翻译（返回任务 ID）
POST   /api/translate/document      # 文件上传翻译
GET    /api/translate/stream/:taskId # SSE 流式接收翻译进度+结果
GET    /api/tasks                   # 翻译任务列表
GET    /api/tasks/:id               # 任务详情
DELETE /api/tasks/:id               # 删除任务
GET    /api/languages               # 支持语言列表（123语种）
```

**SSE 数据格式**：
```
event: segment
data: {"id":"p3","delta":"The ","done":false}

event: segment
data: {"id":"p3","delta":"quick brown","done":false}

event: segment
data: {"id":"p3","delta":" fox","done":true,"full":"The quick brown fox"}

event: complete
data: {"taskId":"xxx","totalSegments":42,"duration":3200}
```

---

## 五、翻译记忆 (TM) 系统

```typescript
// 翻译记忆：相同片段不重复调用 API
class TranslationMemory {
  // Redis Hash: langPair → { textHash → translation }
  async lookup(text: string, srcLang: string, tgtLang: string): Promise<string | null>
  async store(text: string, src: string, tgt: string, translation: string): Promise<void>

  // 相似度匹配（编辑距离 < 15%，返回模糊匹配）
  async fuzzyLookup(text: string, threshold = 0.85): Promise<TMMatch[]>
}
```

**命中率预期**：
- 同文档重复段落：~40% 命中
- 跨任务高频短语：~25% 命中
- 整体 API 调用节省 ~30%

---

## 六、前端状态管理

```typescript
// Zustand store
interface TranslationStore {
  // 任务列表
  tasks: TranslationTask[]

  // 当前活跃翻译
  activeTask: TranslationTask | null
  segments: Map<string, BilingualPair>  // segId → {src, tgt}
  streamingSegId: string | null         // 正在流式接收的段落

  // 视图状态
  viewMode: 'bilingual' | 'translation-only' | 'hover' | 'interleaved'
  srcLang: LangCode
  tgtLang: LangCode

  // Actions
  submitUrl: (url: string) => Promise<void>
  uploadDocument: (file: File) => Promise<void>
  translateText: (text: string) => Promise<void>
  swapLanguages: () => void
  setViewMode: (mode: ViewMode) => void

  // SSE 连接
  connectStream: (taskId: string) => () => void  // 返回 cleanup
}
```

---

## 七、性能策略

| 场景 | 问题 | 方案 |
|------|------|------|
| 大文档翻译 | 500+ 段落，API 慢 | 并发 4 请求 + 流式渐显，首段 <2s 可见 |
| 长网页 | DOM 节点 >10000 | IntersectionObserver 懒翻译（进视口才翻） |
| 重复任务 | 相同 URL/文档重复提交 | 内容哈希去重，直接返回缓存结果 |
| 首屏速度 | 主包过大 | 路由懒加载 + WASM 按格式分包 |
| 流式渲染 | 频繁 setState 导致卡顿 | `startTransition` + 16ms 帧合批更新 |

---

## 八、可观测性

```typescript
// 翻译链路追踪
const translationLogger = {
  onSegmentStart: (segId, text) => log.info({ event: 'segment_start', segId, chars: text.length }),
  onSegmentDone: (segId, duration) => metrics.histogram('segment_translate_ms', duration),
  onAPIError: (err, segId) => log.error({ event: 'api_error', segId, code: err.code }),
  onTMHit: (segId, matchScore) => metrics.counter('tm_hit', { score: matchScore > 0.95 ? 'exact' : 'fuzzy' }),
}

// 核心业务指标
// - translation_task_total（按语言对、格式分维度）
// - translation_latency_p99（目标 <8s/页）
// - tm_hit_rate（翻译记忆命中率）
// - stream_ttfb_ms（流式首字节延迟，目标 <800ms）
// - api_error_rate（MiniMax API 错误率）
```

---

## 九、TDD 测试策略

```
单元测试（Vitest）
  ├── TranslationEngine: 分段逻辑、批次合并、上下文注入
  ├── TranslationMemory: 哈希命中、模糊匹配
  ├── SegmentExtractor: HTML → Segments 提取正确性
  └── BilingualViewer: 段落对齐、同步滚动

集成测试
  ├── /api/translate/text → MiniMax mock → SSE 流
  ├── /api/translate/url → Puppeteer mock → 段落提取
  └── 翻译记忆读写 Redis

E2E测试（Playwright）
  ├── smoke: 文本翻译全流程
  ├── url-translate: URL输入→双语视图
  ├── document-translate: 上传→进度→双语PDF
  ├── language-switch: 语言切换+反转
  └── view-mode-toggle: 四种视图模式切换

UI 回归
  └── 双语对照器截图对比（Percy / Playwright visual）
```

---

## 十、技术栈

| 层 | 选型 | 理由 |
|----|------|------|
| 前端框架 | React 18 + TypeScript + Vite 5 | 复用现有工程 |
| 状态 | Zustand 4 + TanStack Query | 异步任务 + UI 状态分离 |
| 样式 | TailwindCSS 3 + CSS Variables | 主题切换 + 极速开发 |
| 动画 | Framer Motion | 双语切换动效，品质感 |
| 后端 | Node.js 20 + Fastify 4 | 性能优于 Express，插件生态 |
| 翻译 AI | MiniMax LLM API（流式） | 已有 API key，中文质量好 |
| 网页抓取 | Puppeteer（服务端） | 处理 SPA/JS 渲染网页 |
| 缓存 | Redis（TM） + Sqlite（任务持久化） | 轻量部署 |
| 测试 | Vitest + RTL + Playwright | TDD 全覆盖 |
| 监控 | 自研打点 + console structured log | 可观测需求 |

---

## 十一、分阶段交付

| 阶段 | 交付内容 | 验收标准 |
|------|---------|---------|
| **M1 基座** | 文本翻译 + 任务列表 + MiniMax 流式接入 | 文本翻译 TTFB<800ms |
| **M2 网页翻译** | URL 抓取 + DOM 解析 + 双语对照视图 | 主流网站正确提取率>90% |
| **M3 文档翻译** | DOCX/PDF/TXT 上传翻译 + 双语文档预览 | 500KB 文档 <15s 完成 |
| **M4 体验打磨** | 四种视图模式 + TM 缓存 + 语言检测 | Lighthouse ≥90 |
| **M5 标注扩展** | 段落标注 + 译文修正 + 协同（预留接口） | - |

---

## 十二、关键风险

| 风险 | 概率 | 应对 |
|------|------|------|
| 反爬导致 URL 抓取失败 | 高 | User-Agent 轮换 + 降级提示用户粘贴文本 |
| MiniMax API 限流 | 中 | 请求队列 + 指数退避 + 翻译记忆降低依赖 |
| 长文档翻译超时 | 中 | 分片并行 + 断点续传（taskId + segmentOffset） |
| 格式复杂导致段落乱序 | 中 | 严格 paraId 映射 + 人工可修正 |
