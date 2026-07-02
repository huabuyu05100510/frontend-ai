# 文档预览引擎：专家级深做路线图

> 双目标：①极致预览性能（CLAUDE.md 原始要求）②内容增强（讯飞背景）
> 制定日期：2026-06-19

---

## 项目双定位

1. **高性能多格式预览引擎**（性能工程方向）
   - FCP/LCP/CLS/INP 对标一线大厂
   - 大文件虚拟化、转码调度、显存控制
2. **内容增强平台**（讯飞翻译/质检方向）
   - 基于统一文档模型 UDM
   - 全文搜索、双语翻译对照、协同批注

两条线**并行推进**：预览性能是地基，内容增强是差异化。

---

## Phase 0：焊实现有"伪深点"（1 周，必做）

当前代码的 6 处面试官追问会破的硬伤，每修一条 = 简历厚一条。

| # | 现在写了 | 追问会破 | 修法 |
|---|---|---|---|
| 1 | 视口虚拟化 ±2 页 | 为什么是 2？有压测依据？ | 跑压测找最优窗口（1/2/4/8 页对比，测内存与命中率） |
| 2 | token 防竞态 | 缩放时在途 `getTextContent` 未 cancel，内存泄漏 | 把 text layer fetch 也纳入 token 取消 |
| 3 | DPR 封顶 ×2 | 4K 屏、手机 ×3 怎么办？ | 分档策略：低/标/高分屏不同 DPR |
| 4 | soffice 多实例池 round-robin | 某 slot 卡死仍分配给它 | 加负载感知：挑队列最短的 slot |
| 5 | ETA 滑动窗口 8 样本 | 冷启动无样本、小文件抖动 | 冷启动显示"估算中"+ 加平滑（中位数 / EMA） |
| 6 | 手写 multipart 零依赖 | 边界 case（空 part、CR/LF 变体）未测 | 补单元测试覆盖 RFC 7578 边界 |

---

## Phase 1：预览性能打到一线大厂水平（1 周）

对标阿里 ICBU 经验：FCP<1000ms、LCP<2000ms、CLS<0.02、INP<200ms。

### 1.1 Web Vitals 全链路打点
- 接 `web-vitals` 库，自动上报 FCP/LCP/CLS/INP/TTFB
- 自研打点 SDK，关键路径漏斗（上传 → 转码 → 首屏渲染）
- 对标 ICBU 经验做 RUM（真实用户监控）

### 1.2 字体子集化管线（讯飞经历对口）
- 服务端 `pyftsubset`：按文档实际字符做子集化 → woff2
- 内容哈希做 CDN 缓存键，重复文档秒级命中
- 前端 `document.fonts.load` 懒加载 + FOIT/FOTF 策略避免闪烁
- 中文文档字体从 8MB 平均压到 ~120KB

### 1.3 Lighthouse CI 回归门禁
- CI 跑 Lighthouse，性能劣化拦截在合并前
- 黄金样本 100 份 + SSIM 自动对比，目标 SSIM > 0.95

### 1.4 SLO/SLI 体系
- SLI：首屏渲染 P99 < 2s、转码成功率 > 99%、OOM 率 < 0.1%
- 错误预算（error budget）追踪
- Sentry 错误聚合 + Prometheus 指标

---

## Phase 2：极端样本覆盖（1 周）

证明项目"工业级"而非"demo 级"。

### 2.1 大文件压测
- 500MB PDF 跑通：内存峰值 < 500MB（虚拟分页 + LRU 卸载）
- 1GB 视频 Range seek 流畅
- 多并发转码（10 个 PPTX 同时入队）

### 2.2 扫描件兜底
- 图片型 PDF 检测（pdf.js textContent 为空）
- 走 tesseract.js OCR 兜底路径

### 2.3 复杂格式样本
- CJK（中日韩）、阿拉伯（RTL）、混排文档
- 含修订/批注/公式（OMML）的 DOCX
- SmartArt / 动画的 PPTX

### 2.4 保真度回归
- 100 份黄金样本
- SSIM 对比 soffice 转 PDF 与 Office 原生
- 自动生成保真度报告

---

## Phase 3：UDM 统一文档模型（1-2 周，内容增强地基）

### 3.1 UDM 类型设计
```typescript
interface UnifiedDocModel {
  meta: DocMeta;              // 页数、作者、修订
  blocks: Block[];            // 段落/标题/表格 AST
  styles: StyleTable;         // 样式继承链
  assets: Asset[];            // 字体、图片
  annotations: Annotation[];  // 批注
}
interface Block {
  paraId: string;             // 段落稳定 ID（关键）
  type: 'paragraph' | 'heading' | 'table' | 'image';
  text?: string;
  children?: Block[];
}
```

### 3.2 各格式 UDM 来源（分层策略）
- **DOCX** → mammoth 原生语义 UDM（最佳质量）
- **PDF** → pdf.js textContent + 位置启发式推断 UDM（段落/标题/paraId）
  - 同 Y 坐标聚类 → 行
  - Y 差 ≈ 字号 × 1.2 → 同段
  - Y 差 > 字号 × 2 → 换段
  - 字号大于正文 → 标题
- **PPTX/XLSX** → soffice 转 PDF 后同 PDF 路径

### 3.3 自动渲染策略选择
- mammoth 解析后判断复杂度（表格数、浮动图、字体数）
- 简单 → 走 mammoth 渲染（原生 UDM）
- 复杂 → 走 soffice → PDF（推断 UDM）

### 3.4 paraId 锚定
- 合成 paraId 时用文本哈希做种子，相同内容稳定
- 批注/选区锚定用 `paraId + offset`，缩放/重排/转档后零漂移

---

## Phase 4：内容增强功能（2-3 周，简历差异化）

基于 UDM 实现，每个功能都是简历一条硬核点。

### 4.1 全文搜索（1 天，UDM 验证用）
- 基于 UDM text blocks 建倒排索引
- 高亮 + 跳转 + 上下文预览
- 跨格式统一搜索（docx + pdf 混搜）

### 4.2 翻译双语对照（3-5 天，讯飞背景王牌）
- 源 UDM ↔ 译 UDM 用 paraId 映射
- 双视图同步滚动（按段落而非像素）
- 翻译流式返回（增量 re-render）
- Diff 高亮（词汇/句法差异）
- 四种模式：仅原文 / 仅译文 / 双语对照 / 悬停弹窗

### 4.3 协同批注（1 周，对标 Yjs）
- Yjs CRDT + y-websocket
- 批注锚定用 `paraId + offset`
- WebSocket + Awareness 协议同步光标/选区
- 离线编辑联网 CRDT 自动合并
- 覆盖 12 类并发写冲突测试

### 4.4 结构化复制（可选）
- DOM 区：原生 Selection API
- 表格：导出 CSV/XLSX
- Canvas 区：OCR 兜底（极少触发）

---

## 简历定位（做完后的写法）

> **多格式文档智能解析与高保真在线预览引擎**——纯前端优先 + 服务端兜底混合架构，对标 Google Docs / Office Online / PSPDFKit。
>
> - 极致性能：FCP<1s、LCP<2s、CLS<0.02、INP<200ms（对标一线大厂）
> - 渲染工程：自研视口虚拟化 + token 竞态根治 + DPR 分档 + 显存预算
> - 转码调度：soffice 多实例池 + profile 隔离 + 预热 + 负载感知 + 抢占
> - 统一文档模型 UDM：4 种格式归一为同一中间表示，搜索/翻译/批注复用一套实现
> - 段落级 paraId 锚点：批注在缩放/重排/转档后零坐标漂移
> - 双语翻译对照、Yjs CRDT 协同批注、全文搜索三大内容增强能力
> - 可观测性：Web Vitals RUM + SLO/SLI + 100 份黄金样本 SSIM 自动回归

---

## 时间预算总览

| Phase | 工作量 | 累计 |
|---|---|---|
| 0 焊实伪深点 | 1 周 | 1 周 |
| 1 性能打标 | 1 周 | 2 周 |
| 2 极端样本 | 1 周 | 3 周 |
| 3 UDM 模型 | 1-2 周 | 4-5 周 |
| 4 内容增强 | 2-3 周 | 6-8 周 |

---

## 关键认知

- **UDM 不是为了渲染，是为了内容增强**。如果只做预览，全转 PDF 就够。
- **渲染保真和语义结构是鱼和熊掌**：业界只有 ONLYOFFICE / Google Docs 级别能同时拿到。
- **个人项目的边界**：不做编辑（那是 100 人年），聚焦"只读 + 增强"。
- **专家级的标志**：每条技术点都能讲清「难点 → 取舍 → 放弃面」，而不是"用了什么库"。
