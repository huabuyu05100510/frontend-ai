# Office 文档智能解析与高保真在线预览 — 技术方案

## Context（背景与目标）

源自 `apps/work.md` 中科大讯飞消费者 BG 的实战经验：构建智能翻译/质检 SaaS 平台，需支持 23 种文档格式（PDF/DOCX/PPT/PPTX/TXT/XLS/XLSX/SRT + 图片 + 音视频）的智能解析、高保真还原、在线预览，并叠加翻译双语对照、文档内搜索、内容复制、协同批注四大能力。

**核心矛盾**：纯前端渲染追求"首屏极速 + 部署轻量"，但 23 种格式中存在 PDF（栅格化）、PPT（动画/嵌入对象）、音视频（编解码）等天然不适合纯前端解析的复杂场景。

**设计原则**：
1. 纯前端优先（WASM + Canvas/WebGL），复杂格式按需服务端兜底预渲染
2. 极致性能：FCP<1000ms、LCP<2000ms、CLS<0.02、INP<200ms（对标阿里 ICBU 经验）
3. 高保真：像素级还原排版、字体、图表、批注、修订、公式
4. SaaS + 私有化双模：同一代码库，配置驱动
5. 行业顶尖：对标 Google Docs / Office Online / WPS Web / Notion

---

## 一、整体架构

### 1.1 分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  接入层 Presentation                                            │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐ │
│  │ 文档预览器   │ 翻译对照器   │ 批注协作层   │ 搜索/复制层  │ │
│  │ DocViewer    │ BilingualPane│ CollabLayer  │ SearchLayer  │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  渲染层 Rendering                                               │
│  ┌────────────┬────────────┬────────────┬────────────────────┐ │
│  │ Canvas引擎 │ WebGL合成  │ 排版引擎   │ 字体/图表/公式渲染 │ │
│  │ PageRenderer│ Compositor│ LayoutEng  │ AssetRenderer      │ │
│  └────────────┴────────────┴────────────┴────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  解析层 Parsing (WASM / Worker)                                 │
│  ┌──────────┬──────────┬──────────┬──────────┬───────────────┐ │
│  │ DOCX解析│ PPTX解析 │ XLSX解析 │ PDF解析  │ 音视频解码    │ │
│  │ docx-wasm│ pptx-wasm│ xlsx-wasm│ pdfium  │ ffmpeg.wasm  │ │
│  └──────────┴──────────┴──────────┴──────────┴───────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  服务层 Backend (Node.js + 协同网关)                            │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────────────┐ │
│  │ 转档服务│ 文件存储│ 协同CRDT│ 翻译网关│ 配额/鉴权/许可  │ │
│  │ LibreOffice│ OSS  │ Yjs/WS  │ MT API  │ TenantGuard     │ │
│  └─────────┴─────────┴─────────┴─────────┴─────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  基础设施 Infra                                                 │
│  K8s + Docker · CDN边缘缓存 · Redis · Kafka · Prometheus       │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 渲染决策矩阵（关键）

| 格式 | 解析方式 | 渲染方式 | 兜底策略 |
|------|---------|---------|---------|
| DOCX | WASM (docx → AST) | DOM + Canvas 混合 | 服务端转 PDF |
| PPTX | WASM (pptx → scene graph) | Canvas + WebGL | LibreOffice 转图片 |
| XLSX | JS (SheetJS) | 虚拟滚动表格 | - |
| PDF | pdfium.wasm | Canvas/WebGL 矢量 | - |
| TXT/MD/SRT | JS | 流式渲染 + Monaco | - |
| 图片 | 浏览器原生 | WebGL 瓦片 | - |
| 音频 | Web Audio API | wavesurfer 波形 | - |
| 视频 | MSE/HTML5 | hls.js / WebCodecs | - |

---

## 二、格式解析引擎

### 2.1 智能格式探测

```
文件上传 → Magic Number 校验 → MIME 类型 → 扩展名兜底
        ↓
   格式分发器 FormatDispatcher
        ↓
   ┌──────┴──────┐
   │             │
WASM解析路径   原生/服务端路径
```

**Magic Number 优先**防止伪造扩展名攻击。23 种格式分三类：

- **结构化文本类**（DOCX/PPTX/XLSX/SRT/TXT/MD）：本质是 ZIP + XML，WASM 直接解析
- **栅格化类**（PDF）：pdfium.wasm 解析页面树
- **二进制媒体类**（图片/音视频）：浏览器原生能力 + WebCodecs/ffmpeg.wasm

### 2.2 核心解析器选型

| 解析器 | 选型 | 理由 |
|--------|------|------|
| DOCX | `docx-preview` + 自研 docx-wasm | 业界还原度最高，支持修订/批注/公式 (OMML) |
| PPTX | `pptxjs` 改造 + 自研 SceneGraph | 支持动画时间轴、SmartArt、嵌入图表 |
| XLSX | `SheetJS (xlsx)` | 工业标准，公式/条件格式/图表全覆盖 |
| PDF | `pdfium` WASM 编译版 | Chrome 同款引擎，矢量保真度业界第一 |
| 公式 | OMML → MathML 转换 + KaTeX | 解决 Word 公式渲染痛点 |
| 字体 | 字体子集化 + woff2 懒加载 | 解决嵌入字体缺失问题 |

### 2.3 统一文档模型 (UDM)

所有格式解析后归一化为统一中间表示：

```typescript
interface UnifiedDocModel {
  meta: DocMeta;              // 页数、作者、修订记录
  sections: Section[];        // 章节结构
  pages: Page[];              // 分页信息（流式 vs 固定页）
  contentNodes: ContentNode[];// 段落/表格/图片/公式 AST
  styles: StyleTable;         // 样式表（继承链）
  assets: Asset[];            // 字体、图片、嵌入对象
  annotations: Annotation[]; // 批注、修订
}
```

**UDM 的价值**：渲染层只对接一种数据结构；翻译/搜索/批注都基于 UDM 操作，无需关心源格式。

---

## 三、渲染管线（极致性能核心）

### 3.1 双轨渲染策略

**DOM 优先 + Canvas 兜底**：
- 文字、表格 → DOM 渲染（可选中、可复制、SEO 友好）
- 复杂图表、SmartArt、3D、动画 → Canvas/WebGL 离屏渲染后合成

### 3.2 虚拟分页 + 渐进式渲染

针对 500MB 大文件核心优化：

```
可见视口 → 仅渲染当前 ±2 页
        ↓
requestIdleCallback 渲染相邻页缩略图
        ↓
IntersectionObserver 触发真实渲染
        ↓
LRU 缓存最近 20 页，超出则卸载回收内存
```

### 3.3 WASM 多线程解析

```
主线程 MainThread
   │ 派发
   ├→ Worker Pool (navigator.hardwareConcurrency)
   │    ├ Worker1: 解析 docx chunk 1
   │    ├ Worker2: 解析 docx chunk 2
   │    └ ...
   ├→ SharedArrayBuffer (跨线程共享)
   └→ OffscreenCanvas (Worker 直接渲染)
```

**要求**：COOP/COEP 头部配置 (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`) 启用 SharedArrayBuffer。

### 3.4 关键性能指标达成路径

| 指标 | 目标 | 技术手段 |
|------|------|---------|
| FCP < 1000ms | 加载首屏骨架 + 字体子集预加载 + WASM 预热 CDN | critical CSS inline |
| LCP < 2000ms | 首页优先流式渲染，边解析边渲染 | chunked parse |
| CLS < 0.02 | 占位骨架 + 文档尺寸预计算 | layout stability |
| INP < 200ms | 渲染拆 16ms 帧片 + Web Worker 卸载 | time-slicing |

### 3.5 字体策略（保真关键）

- 文档嵌入字体：服务端字体子集化（pyftsubset）→ woff2 懒加载
- 缺失字体：CDN 字体兜底库（覆盖思源/CJK/阿拉伯等）
- 字体指纹：内容哈希做缓存键，命中直接复用

---

## 四、翻译双语对照

### 4.1 双视图布局

```
┌────────────────┬────────────────┐
│  原文 Document  │  译文 Document │
│  (UDM Source)   │  (UDM Target)  │
│  ← 同步滚动 →   │                │
└────────────────┴────────────────┘
```

**段落级映射**：源 UDM 与译 UDM 通过 `paraId` 建立映射表，实现：
- 同步滚动（按段落而非按像素）
- Diff 高亮（词汇/句法差异着色）
- 点击原文段落自动定位译文（反之亦然）

### 4.2 翻译增量流式

```
原文分片 → 翻译网关流式返回 → 译 UDM 增量更新 → 局部 re-render
```

避免整篇翻译完才显示，提升感知速度。

---

## 五、四大增强能力

### 5.1 文档内搜索
- 基于 UDM 文本节点构建倒排索引（浏览器内 IndexedDB 持久化）
- 高亮、跳转、上下文预览，支持正则/通配符

### 5.2 内容复制
- DOM 渲染区：原生 `Selection API` + `Clipboard API`
- Canvas 渲染区：OCR 兜底（仅复杂图表，极少触发）
- 表格：导出为 CSV/XLSX
- 图片：右键另存

### 5.3 协同批注（CRDT）
- 选型：**Yjs**（CRDT，天然支持离线/弱网合并）
- 实时协同：WebSocket + Yjs Awareness 协议
- 批注锚定：基于 UDM `paraId + offset`，非像素坐标（缩放/重排不丢失）

### 5.4 翻译模式切换
- 仅原文 / 仅译文 / 双语对照 / 鼠标悬停弹窗译文

---

## 六、SaaS + 私有化双模

### 6.1 配置驱动

```typescript
// config.ts
export const deployment = {
  mode: process.env.DEPLOY_MODE, // 'saas' | 'private'
  features: {
    collab: true,        // 私有化可关闭
    cloudTranslate: true, // 私有化需本地 MT
  },
  license: {
    type: 'perpetual' | 'subscription',
    seatLimit: 100,
    expireAt: '2027-01-01',
  }
}
```

### 6.2 私有化交付
- Docker 镜像 + Helm Chart（K8s 一键部署）
- 离线 License：RSA 非对称签名 + 机器指纹绑定
- 离线字体/字典包预置

### 6.3 多租户隔离（SaaS）
- 租户级命名空间隔离（DB schema + OSS prefix）
- 配额：单文件 500MB / 批量 10 个 / 并发解析数
- 数据加密：传输 TLS 1.3，存储 AES-256-GCM

---

## 七、技术栈推荐

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | React 18 + TypeScript | 18.3+ |
| 构建 | Vite + Rollup | 5.x |
| 状态 | Zustand + React Query | 4.x / 5.x |
| Canvas | Konva / 自研 OffscreenCanvas | - |
| WASM | Rust + wasm-bindgen（自研解析器） | - |
| 文档 | docx-preview, SheetJS, pdf.js | latest |
| 协同 | Yjs + y-websocket | 13.x |
| 编辑器 | Monaco Editor | 0.45+ |
| 视频 | hls.js + WebCodecs | 1.x |
| 音频 | wavesurfer.js | 7.x |
| 后端 | Node.js + Fastify + BullMQ | 20+ |
| 转档 | LibreOffice headless + unoconv | 7.6 |
| 存储 | MinIO / OSS + Redis + Kafka | - |
| 部署 | Docker + Helm + K8s | 1.28+ |
| 监控 | Prometheus + Grafana + Sentry | - |

---

## 八、模块清单

| 模块 | 职责 | 关键接口 |
|------|------|---------|
| `FormatDispatcher` | 格式探测与路由 | `detect(file) → ParserType` |
| `WasmParserPool` | WASM 解析器池 | `parse(file, onProgress)` |
| `UDMBuilder` | 构建 UDM | `build(rawAST) → UDM` |
| `PageRenderer` | 页面渲染 | `render(page, viewport)` |
| `VirtualScroller` | 虚拟滚动 | `observe(el, onVisible)` |
| `BilingualPane` | 双语对照 | `syncScroll(paraId)` |
| `DiffHighlighter` | 差异高亮 | `diff(srcUDM, tgtUDM)` |
| `SearchEngine` | 倒排搜索 | `index(UDM); query(kw)` |
| `ClipboardManager` | 复制管理 | `copy(range)` |
| `CollabSession` | CRDT 协同 | `connect(roomId)` |
| `TranslateGateway` | 翻译网关 | `stream(srcText, target)` |
| `QuotaGuard` | 配额守卫 | `check(tenant, file)` |
| `LicenseManager` | 私有化授权 | `validate(licenseKey)` |

---

## 九、安全合规

1. **XSS 防护**：UDM → 渲染前 DOMPurify 清洗；Canvas 渲染天然免疫
2. **文件校验**：Magic Number + 病毒扫描（ClamAV 服务端）
3. **内容脱敏**：私有化支持敏感词过滤回调
4. **沙箱**：渲染 iframe sandbox 隔离用户文档 JS
5. **CSP**：严格 CSP 头，禁内联脚本

---

## 十、可观测性

- **性能**：Web Vitals 自动上报（FCP/LCP/CLS/INP/TTFB）
- **错误**：Sentry 前后端错误聚合
- **行为**：自研打点 SDK（对标 ICBU 经验），关键路径漏斗
- **业务**：格式分布、文件大小分布、渲染时长 P90/P95/P99
- **告警**：渲染失败率 > 0.5% / WASM 加载失败率 > 1% 触发告警

---

## 十一、分阶段交付里程碑

| 阶段 | 周期 | 交付内容 |
|------|------|---------|
| M1 基座 | - | UDM 模型、WASM 解析池、PageRenderer、虚拟滚动 |
| M2 核心 | - | DOCX/PPTX/XLSX/PDF 4 大格式高保真 |
| M3 增强 | - | 双语对照、搜索、复制、批注 CRDT |
| M4 扩展 | - | 图片/音视频/SRT/剩余格式 |
| M5 商用 | - | SaaS 多租户、私有化打包、License |

---

## 十二、验证方法

1. **保真度**：构建黄金样本集（100 份含修订/公式/图表/批注的真实文档），与 Office 原生渲染做像素对比，目标 SSIM > 0.95
2. **性能**：Lighthouse 跑分 + 真实用户 RUM，验证 FCP/LCP/CLS/INP 达标
3. **兼容**：23 种格式 × 各取 5 份样本，全量通过冒烟测试
4. **协同**：双端同时编辑批注，断网重连后无冲突
5. **私有化**：Docker Compose 单机一键起，Helm 部署 K8s 集群

---

## 关键风险与对策

| 风险 | 对策 |
|------|------|
| PPT 动画还原困难 | 服务端 LibreOffice 转视频/图片兜底 |
| 大文件 OOM | 流式解析 + LRU 页面卸载 + Web Worker 隔离 |
| 字体缺失致版式错乱 | 字体子集化 + CDN 兜底库 + 哈希缓存 |
| WASM 体积大 | 按格式分包 + CDN 预热 + IndexedDB 缓存 |
| SharedArrayBuffer 需特殊 header | 部署文档明确 COOP/COEP 配置；降级为单线程 |

---

**结论**：本方案以"统一文档模型 UDM + 双轨渲染 + WASM 解析池"为核心，对标 Google Docs 与 Office Online，兼顾 SaaS 弹性扩展与私有化离线交付，覆盖 23 种格式与四大增强能力，性能指标对标一线大厂标准。
