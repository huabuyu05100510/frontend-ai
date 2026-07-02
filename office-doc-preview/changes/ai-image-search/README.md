# AI 图搜 设计稿 — 8 子模式 × 9 维度行业对标 + 实施规范

> **模型声明**:claude-sonnet-4-6
> **生成日期**:2026-07-01
> **状态**:调研 → 设计稿(本报告) → 用户审批 → TDD 实施
> **覆盖范围**:8 个 AI 图搜子模式 × 9 维度 = 完整产品表面
> **调研支撑**:见 [`industry-research.md`](./industry-research.md)(~80KB,37 款产品 + 60 顶尖实践 + 30 失败吐槽 + 12 技术栈)
> **方法**:WebSearch / WebFetch 在当前网络环境持续返回 API 错误,故"竞品最新版本细节"以业内公知信息 + 截至 2026-01 模型知识 + 本仓库代码 / memory 沉淀为依据
> **本报告纯只读**,未修改任何代码文件

---

## 0. 速查总览(8 子模式 ROI 矩阵)

| # | 子模式 | 当前实现度 | 行业差距 | 用户感知 | ROI | 优先级 | 推荐窗口 | 复用率 |
|---|---|---|---|---|---|---|---|---|
| 1 | 以图搜图 (Reverse Search) | 0% | 极大 | ★★★★★ | 15/15 | **P0** | Week 1-2 | 90% |
| 2 | 截图/拖拽识图 (Screenshot) | 0% | 大 | ★★★★★ | 14/15 | **P0** | Week 2 | 95% |
| 3 | 跨文档追溯 (Trace) | 0% | 极大 | ★★★★ | 13/15 | **P1** | Week 3 | 80% |
| 4 | 图像 diff (Visual Diff) | 0% | 中 | ★★★ | 11/15 | **P2** | Week 4 | 85% |
| 5 | 视觉聚类 (Clustering) | 0% | 大 | ★★★ | 10/15 | **P2** | Week 4 | 75% |
| 6 | 图片 TM (Image TM) | 0% | 中 | ★★★★ | 12/15 | **P1** | Week 3 | 90% |
| 7 | 质量雷达 (Quality Scan) | 0% | 中 | ★★★ | 9/15 | **P3** | Month 2 | 70% |
| 8 | 多模态联动 (Pipeline) | 0% | 极大 | ★★★★★ | 14/15 | **P1** | Week 2-3 | 80% |

**核心策略**:Week 1-2 集中交付 P0 双子模式(图搜 MVP + 截图助手),Week 3 补齐 P1 追溯 + 图片 TM,Week 4 扩展 P2 视觉聚类 + 图像 diff,Month 2 处理 P3 质量雷达 + 多模态联动旗舰。

**复用率说明**:从已有 PDFium / OCR / Translation / RightPanel 体系可复用的代码比例;P0 子模式 ≥ 90% 复用是因为截图助手几乎纯前端 + 复用 OCR,而 P3 质量雷达需要 CNN 模型复用率较低。

---

## 1. 目录结构

本报告按 8 个图搜子模式分章节,每子模式统一 9 个维度:

1. 行业最佳实践
2. 亮点挖掘(≥ 8 条,带产品出处)
3. ASCII 设计稿
4. 关键交互流
5. 动效规范
6. 响应式断点(375 / 768 / 1440 / 1920)
7. 可观测指标(`X-ImageSearch-*` 响应头)
8. 深色模式
9. KPI 基线

子模式完整设计稿见同目录子文件:

| # | 子文件 | 子模式 | 核心对标 |
|---|---|---|---|
| 01 | [`01-reverse-image-search.md`](./01-reverse-image-search.md) | 以图搜图 | Google Lens / 拍立淘 / Pinterest Lens |
| 02 | [`02-screenshot-assistant.md`](./02-screenshot-assistant.md) | 截图/拖拽识图 | 微信识图 / CamScanner / Snipaste |
| 03 | [`03-cross-doc-trace.md`](./03-cross-doc-trace.md) | 跨文档追溯 | TinEye / Eagle / 百度识图 |
| 04 | [`04-visual-diff.md`](./04-visual-diff.md) | 图像 diff | Adobe Firefly / DiffImg / ImageMagick |
| 05 | [`05-clustering.md`](./05-clustering.md) | 视觉聚类 | Eagle / Billfish / Adobe Bridge |
| 06 | [`06-image-tm.md`](./06-image-tm.md) | 图片 TM | SDL Trados / memoQ / OmegaT |
| 07 | [`07-quality-scanner.md`](./07-quality-scanner.md) | 质量雷达 | Adobe Photoshop / Lightroom |
| 08 | [`08-multimodal-pipeline.md`](./08-multimodal-pipeline.md) | 多模态联动 | Midjourney / Adobe Firefly / Canva Magic |
| — | [`industry-research.md`](./industry-research.md) | 调研基础 | 37 款产品 + 60 实践 + 30 吐槽 + 12 技术栈 |

---

## 2. 跨子模式共享能力(必读)

所有 AI 图搜子模式都依赖以下 6 类共享能力,**新建子模式时必须复用,禁止重复造轮子**:

### 2.1 三层设计 Token(已落地 Phase 1.A)
- **primitive**:`web/src/design/primitives.ts` — Radix 12-step × 10 色板
- **semantic**:`web/src/design/semantic.ts` — 36 个语义 alias(brand/ai/text/bg/border/status/diff)
- **dark**:`web/src/design/dark.css` — `[data-theme="dark"]` 覆盖

任何新组件的 hex 字面量都会被 `noInlineHex.test.tsx` 静态守卫拦截。

### 2.2 动效原语(已落地 Phase 1.B)
- `motion/primitives/Hover.tsx` — 100ms ease-out 涟漪
- `motion/primitives/Press.tsx` — 120ms scale 0.97
- `motion/primitives/PageTransition.tsx` — 200ms 进出
- 全部读 `<html data-motion="on|off">`,默认 off(无障碍优先)
- 启用:`?motion=on` query string,`MotionProvider` 在 App.tsx 顶层

### 2.3 ⌘K 命令面板(已落地 Phase 1.C / 2.B)
- 5 类 source:`navigation` / `files` / `templates` / `voices` / `actions`
- ⌘K / Ctrl+K 打开,Esc 关闭
- **本次新增**:第 6 类 source `imageSearch`,注册"以图搜图 / 截图助手 / 跨文档追溯"等 8 条快捷操作

### 2.4 工作区时间轴(已落地 Phase 2.B)
- `server/src/workspace-timeline.mjs` — JSONL 持久化(200 cap, 10k rotation)
- 客户端:`hooks/useWorkspaceTimeline.ts` — in-flight dedup
- **本次新增**:`kind='image-search'`,子类型 `reverse / screenshot / trace / diff / cluster / tm / quality / pipeline`
- 每个图搜操作的成功/失败事件必须 emit,header 返回 `X-Timeline-Count/Kind/Id`

### 2.5 共享后端模块(本次新增)

| 模块 | 路径 | 职责 |
|---|---|---|
| Embedding 抽象层 | `server/src/image-search/embedding.mjs` | L1(pHash + HSV) + L2(MobileCLIP ONNX) + L3(智谱 vision)三档 |
| 索引存储 | `server/src/image-search/index-store.mjs` | JSONL 持久化 + Vectra HNSW 索引 |
| 相似度算法 | `server/src/image-search/similarity.mjs` | 余弦 / 汉明 / 混合相似度 |
| 兜底向量 | `server/src/image-search/mock-embeddings.mjs` | 无 API key 时 fallback 哈希向量 |
| 任务调度 | `server/src/image-search/jobs.mjs` | 异步批量入库 + 进度推送 |
| 导出器 | `server/src/image-search/export.mjs` | 命中结果导出 JSON / CSV / ZIP |

### 2.6 共享前端 hook(本次新增)

| Hook | 职责 |
|---|---|
| `useImageSearch()` | 包装 `/api/image-search/*` + polling |
| `useImageSearchHistory()` | timeline kind='image-search' |
| `useClipboardImage()` | 监听 paste 触发截图助手 |
| `useColorPicker()` | 主色调筛选(EyeDropper API) |
| `useDropZone()` | 复用 OCRPage 的拖拽组件,扩展支持文件夹 |
| `useMockEmbedding()` | 端侧 hash 算 pHash 64-bit,零网络 |

---

## 3. 可观测规范

### 3.1 响应头命名约定(新模式前缀)

| Header 名 | 含义 | 示例值 |
|---|---|---|
| `X-ImageSearch-Engine` | 引擎类型 | `phash` / `mobileclip-s0` / `zhipu-glm-4v` |
| `X-ImageSearch-Latency-Ms` | 服务端处理时长 | `234` |
| `X-ImageSearch-Hits` | 命中条目数 | `12` |
| `X-ImageSearch-Confidence` | 平均相似度 (0-1) | `0.87` |
| `X-ImageSearch-Cache` | 缓存命中 | `hit` / `miss` |
| `X-ImageSearch-Index-Size` | 索引规模 | `1024` |
| `X-ImageSearch-Trace-Mode` | 检索模式 | `visual` / `text` / `hybrid` |
| `X-ImageSearch-Embedding-Dim` | 向量维度 | `512` |
| `X-ImageSearch-Mock` | 是否使用 mock | `true` / `false` |
| `X-Timeline-Id` | 时间轴事件 ID(共享) | `tl_01HX...` |

**命名规则**:`X-ImageSearch-*` 与现有 `X-OCR-*` / `X-Translate-*` 平级,便于灰度对比。

### 3.2 前端埋点(必加)
- 每个 AI 图搜操作的 `start` / `success` / `error` 三个事件必须埋点
- 字段:`mode='image-search'` / `subMode` / `engine` / `inputBytes` / `latencyMs` / `hits` / `cache` / `confidence` / `timestamp`
- 失败时 `error.code` / `error.message` / `error.stack`(prod 仅 code+message)
- 用户操作:`upload` / `paste` / `screenshot` / `drag` / `click` 五入口统一埋点

### 3.3 性能基线

| 操作 | P50 | P95 | P99 | 备注 |
|---|---|---|---|---|
| pHash 64-bit 计算(端侧) | < 5ms | < 10ms | < 20ms | Canvas + dHash 变种 |
| HSV 直方图(端侧) | < 2ms | < 5ms | < 10ms | 8×8×8 = 512 bin |
| MobileCLIP-S0 推理(CPU) | < 70ms | < 150ms | < 250ms | onnxruntime-web |
| MobileCLIP-S0 推理(WebGPU) | < 12ms | < 30ms | < 50ms | feature detection |
| 1k 张 Vectra HNSW 检索 | < 5ms | < 15ms | < 30ms | ef_construction=200 |
| 10k 张 Vectra 检索 | < 20ms | < 60ms | < 120ms | 升级 lancedb 阈值 |
| 智谱 vision 远程调用 | < 800ms | < 1.5s | < 3s | 弱网 5s+ |
| 端到端图搜(图搜 MVP) | < 200ms | < 500ms | < 1s | mock < 50ms |

---

## 4. 各子模式实施总览

### 4.1 以图搜图(01-reverse-image-search)

**核心定位**:上传/拖拽/粘贴一张图,从任务库 + 公开池找出相似图与来源,**借鉴 Eagle / TinEye / 拍立淘**。

**借鉴 TOP 3 行业实践**:
1. **Google Lens 圆点扫描**:摄像头取景框实时检测物体边界(蓝色描边 + 角点标记)
2. **拍立淘主色筛选**:拍同款按钮 + Top-3 颜色直方图可选
3. **Pinterest Lens 区域裁切**:用户框选局部 → 只搜该区域

**用户故事**:作为设计师,我把刚画好的 logo 草图拖进搜索框,3 秒内看到任务库里有 3 张参考图,以及 Pinterest 类似风格链接,点开就能直接套用。

**与现有能力复用**:
- `RightPanel.tsx` 命中结果双栏布局
- `useImageSearch()` hook 包装
- `workspace-timeline.mjs` JSONL 持久化
- `design/semantic.ts` 36 个 alias + 状态色

**风险**:CLIP 模型首次下载 30MB 慢,需 Service Worker 预缓存 + 进度条 + 降级 L1 pHash。

### 4.2 截图/拖拽识图(02-screenshot-assistant)

**核心定位**:系统级截图(桌面/窗口/区域)+ 自动上传 + OCR + 翻译 + 图搜一气呵成,**借鉴 微信 / CamScanner / Snipaste**。

**借鉴 TOP 3 行业实践**:
1. **Snipaste 贴图置顶**:截图后 F3 贴图,继续工作
2. **微信识图底部弹层**:3 卡片(翻译/识别/搜同款)+ 关闭手势
3. **CamScanner 自动增强**:截图后自动去阴影 + 透视矫正 + 对比度

**用户故事**:作为运营,我看到截图里有英文产品参数,按 ⌘+Shift+S 截屏,屏幕右下角弹出 3 卡片:中文翻译 / OCR 文字 / 同款图源,点翻译直接复制到剪贴板。

**与现有能力复用**:
- `OCRPage.recognize()` 全链路
- `TranslationPage.realtime()` 翻译流
- `useClipboardImage()` 监听 paste
- `ImageRegionSvgOverlay.tsx` 框选

**风险**:浏览器安全模型限制(Chrome 不允许截整屏),需引导用户安装桌面端 / PWA + 提供手动上传兜底。

### 4.3 跨文档追溯(03-cross-doc-trace)

**核心定位**:给定一张图,扫描任务库所有 docx/pdf/pptx,定位该图出现的所有文档 + 页码 + 上下文,**借鉴 TinEye / Eagle**。

**借鉴 TOP 3 行业实践**:
1. **TinEye 跨站追溯**:每张图给唯一 ID,扫描全网所有出现位置
2. **Eagle 任务库 AI 搜索**:本地索引 + 跨文件夹聚合
3. **百度识图 相似图 + 同款**:两种结果分类展示

**用户故事**:作为编辑,我担心版权风险,把图丢进追溯,2 秒内看到它出现在 5 个不同的 docx 文件 3 个 pptx 第 7 页,以及原图出处链接。

**与现有能力复用**:
- `image-batch.mjs` 批量入库
- `translate-jobs.mjs` 任务状态机
- `pdfium-render.mjs` PDF 文字层定位
- `quality-check.mjs` 红盖叠加

**风险**:索引膨胀(> 100k 张时检索慢),需 LRU + JSONL rotation + 升级 lancedb。

### 4.4 图像 diff(04-visual-diff)

**核心定位**:两张图并排对比,像素级 diff + 语义级 diff(结构 vs 风格)双模式,**借鉴 Adobe Firefly / DiffImg**。

**借鉴 TOP 3 行业实践**:
1. **Adobe Firefly 双参考**:结构参考 + 风格参考分两栏
2. **DiffImg 像素差异红绿**:差异区域红色叠加
3. **Beyond Compare 二值化**:左右联动滚动

**用户故事**:作为前端,我改了一版 UI,把新旧截图丢进 diff,看到"按钮颜色 + 间距 + 圆角"3 处不同,点差异区域直接跳到代码位置。

**与现有能力复用**:
- `QualityCheckPage.text` token 错误展示框架
- `ImageDualView.tsx` 双视图组件
- `ConfidenceDot.tsx` 置信度可视化

**风险**:像素 diff 对抗压缩/缩放噪声差,需先做 alignment + normalization。

### 4.5 视觉聚类(05-clustering)

**核心定位**:对任务库所有图自动按视觉相似度聚类,2D 散点图 + 缩略图网格双视图,**借鉴 Eagle / Billfish / Adobe Bridge**。

**借鉴 TOP 3 行业实践**:
1. **Eagle 智能文件夹**:基于视觉聚类自动归类
2. **Billfish 瀑布流**:相似图自动堆叠成组
3. **Adobe Bridge 关键词 + 视觉双过滤**

**用户故事**:作为运营,我有 2000 张产品图,点聚类,看到 12 个主题簇(户外 / 室内 / 人物 / 食物...),点击簇直接批量打标签。

**与现有能力复用**:
- `ImageBatchQueue.tsx` 批量组件
- `ProgressRing.tsx` 进度可视化
- `useImageBatch()` hook

**风险**:HDBSCAN vs UMAP + KMeans 选型,需小规模 A/B 实测。

### 4.6 图片 TM(06-image-tm)

**核心定位**:翻译复用 — 已翻译过的图片 + 区域 bbox + 译文入库,下次相同区域自动匹配,**借鉴 SDL Trados / memoQ / OmegaT**。

**借鉴 TOP 3 行业实践**:
1. **SDL Trados TM**:segment-level fuzzy match + 95%+ 自动套用
2. **memoQ AutoPropagating**:跨文档传播翻译
3. **OmegaT 术语约束**:图片里的文字也走 TM

**用户故事**:作为本地化,我上传新一版游戏 UI 截图,系统提示"上次翻译过类似按钮文案,可复用?",点确认 3 秒内整批翻完。

**与现有能力复用**:
- `translate-memory.mjs` 文本 TM 持久化
- `translate-glossary.mjs` 术语库
- `DocTranslateMemoryPanel.tsx` 复用 UI
- `DocTranslateGlossaryPanel.tsx` 复用 UI

**风险**:图像 TM 需要稳定特征点(SIFT/ORB),对截图/UI 截图特别有效,对自然图效果一般。

### 4.7 质量雷达(07-quality-scanner)

**核心定位**:扫描图片库的"专业质量"(锐度 / 曝光 / 色偏 / 构图 / 噪点)5 维评分,雷达图 + 改进建议,**借鉴 Adobe Photoshop / Lightroom**。

**借鉴 TOP 3 行业实践**:
1. **Lightroom 直方图**:曝光 / 高光 / 阴影三段
2. **Photoshop 内容感知**:自动修复建议
3. **Google Photos 自动增强**:一键美化

**用户故事**:作为摄影爱好者,我有 500 张旅行照,点质量扫描,看到 Top-10 低分图(模糊 / 过曝),点开自动调色建议。

**与现有能力复用**:
- `QualityCheckPage.image` 复用框架
- `ProgressRing.tsx` 5 维评分
- `ConfidenceDot.tsx` 单项置信度

**风险**:质量评分模型本身有争议,需让用户可调阈值 + 自定义权重。

### 4.8 多模态联动(08-multimodal-pipeline)

**核心定位**:串联 OCR + 翻译 + 图搜 + TM 形成完整工作流,可编排 DAG,**借鉴 Midjourney / Adobe Firefly / Canva Magic**。

**借鉴 TOP 3 行业实践**:
1. **Midjourney /describe**:图 → 反推 prompt
2. **Adobe Firefly 结构 + 风格**:两图融合
3. **Canva Magic Design**:一键智能设计

**用户故事**:作为内容创作者,我拖入一张产品图,选择"自动生成营销文案" pipeline:图搜相似 → OCR 提取文字 → 翻译 → 风格化润色,30 秒内得到完整素材包。

**与现有能力复用**:
- **全部已有 AI 模块**:OCR + Translation + QualityCheck + Voice
- `useTranslateJob()` 任务状态机
- `translate-jobs.mjs` 异步调度
- `workspace-timeline.mjs` 全流程追踪

**风险**:DAG 编排复杂度高,UI 必须分步引导 + 撤销栈,不能直接放给用户自由编排。

---

## 5. 滚动交付 Roadmap(4 周)

### Week 1:基建 + 亮点 #1(图搜 MVP,8-10 人天)

| # | 子模式 | 增量 | 人天 | 关联文件 |
|---|---|---|---|---|
| 1 | 共享基建 | `embedding.mjs` L1(pHash+HSV) | 1.5 | `server/src/image-search/embedding.mjs` |
| 2 | 共享基建 | `index-store.mjs` Vectra + JSONL | 2 | `server/src/image-search/index-store.mjs` |
| 3 | 共享基建 | `useImageSearch()` + `useClipboardImage()` | 1 | `web/src/hooks/` |
| 4 | 共享基建 | ⌘K palette 新增 `imageSearch` source | 0.5 | `web/src/palette/sources/imageSearch.ts` |
| 5 | 共享基建 | 时间轴 `kind='image-search'` | 0.5 | `server/src/workspace-timeline.mjs` |
| 6 | 01 图搜 | 上传/拖拽/粘贴 3 入口 | 1 | `pages/ImageSearchPage.tsx` |
| 7 | 01 图搜 | 命中结果双栏(图 + 来源) | 1.5 | 同上 |
| 8 | 01 图搜 | 主色调筛选(EyeDropper) | 1 | 同上 + `useColorPicker()` |
| 9 | 01 图搜 | 进度环 + 性能埋点 | 0.5 | 同上 |
| 10 | 全局 | dark/light × 1440 视觉回归 | 0.5 | `e2e/image-search.spec.ts` |

**TDD 三件套目标**:
- 单测 8+ (embedding / index-store / similarity / hook)
- e2e 2+ (上传 → 命中 → 点开)
- 视觉回归 1+ (dark/light × 1440)

### Week 2:亮点 #2(截图助手)+ 基建深化(10-12 人天)

| # | 子模式 | 增量 | 人天 |
|---|---|---|---|
| 11 | 02 截图 | 全局 ⌘+Shift+S 截图快捷键 | 1 |
| 12 | 02 截图 | 截屏自动上传 + OCR + 翻译 | 2.5 |
| 13 | 02 截图 | 右下角 3 卡片弹层 | 1.5 |
| 14 | 02 截图 | 贴图置顶(Snipaste 风格) | 1 |
| 15 | 02 截图 | 自动增强(去阴影/对比度) | 1 |
| 16 | 共享基建 | `embedding.mjs` L2(MobileCLIP ONNX) | 2 |
| 17 | 共享基建 | WebGPU feature detection | 0.5 |
| 18 | 共享基建 | 端侧 mock embedding | 0.5 |
| 19 | 01 图搜 | 区域裁切(框选再搜) | 1.5 |
| 20 | 全局 | 375/768/1920 三断点回归 | 0.5 |

**TDD 三件套目标**:单测 10+ / e2e 3+ / 视觉回归 3+

### Week 3:亮点 #3(跨文档追溯 + 图片 TM,10-12 人天)

| # | 子模式 | 增量 | 人天 |
|---|---|---|---|
| 21 | 03 追溯 | 全任务库扫描 + 进度 | 2.5 |
| 22 | 03 追溯 | 命中文档 + 页码 + 上下文 | 2 |
| 23 | 03 追溯 | 原图出处链接(若可获取) | 1 |
| 24 | 06 图片 TM | segment 级 fuzzy match | 2 |
| 25 | 06 图片 TM | 复用 panel 接入 | 1 |
| 26 | 06 图片 TM | 命中阈值滑条(80%-99%) | 0.5 |
| 27 | 08 联动 | pipeline DAG 框架 | 1.5 |
| 28 | 08 联动 | OCR + 翻译 一键 pipeline | 1.5 |

**TDD 三件套目标**:单测 10+ / e2e 3+ / 视觉回归 3+

### Week 4:亮点 #4 / #5(图像 diff + 视觉聚类,10-12 人天)

| # | 子模式 | 增量 | 人天 |
|---|---|---|---|
| 29 | 04 diff | 像素级 diff 红绿叠加 | 2 |
| 30 | 04 diff | 语义级 diff(结构 vs 风格) | 2.5 |
| 31 | 04 diff | 左右联动滚动 | 1 |
| 32 | 05 聚类 | UMAP 降维 + KMeans | 2 |
| 33 | 05 聚类 | 2D 散点图 + 缩略图网格 | 1.5 |
| 34 | 05 聚类 | 簇内批量打标签 | 1 |
| 35 | 05 聚类 | HDBSCAN A/B(可选) | 0.5 |
| 36 | 全局 | 视觉回归 + 性能 benchmark | 1.5 |

**TDD 三件套目标**:单测 8+ / e2e 3+ / 视觉回归 4+

### Month 2:质量雷达 + 多模态联动旗舰(15-20 人天)

| # | 子模式 | 增量 | 人天 |
|---|---|---|---|
| 37 | 07 质量 | 5 维评分(锐度/曝光/色偏/构图/噪点) | 3 |
| 38 | 07 质量 | 雷达图 + Top-10 低分图 | 1.5 |
| 39 | 07 质量 | 自动调色建议 | 2 |
| 40 | 08 联动 | pipeline DAG 编辑器 | 3 |
| 41 | 08 联动 | 撤销栈 + 模板保存 | 2 |
| 42 | 08 联动 | 公开 pipeline 模板市场 | 2 |
| 43 | 08 联动 | 端到端 benchmark(30s 任务) | 1 |
| 44 | 全局 | dark/light × 4 断点 × 8 子模式完整回归 | 2 |

**TDD 三件套目标**:单测 12+ / e2e 5+ / 视觉回归 8+

---

## 6. 落地前置条件(等用户决策)

### 决策点

| # | 决策项 | 选项 | 推荐 | 原因 |
|---|---|---|---|---|
| 1 | 路由方案 | (A) 独立路由 `/image-search` / (B) 嵌入 OCR 子模式 | **A** | 8 子模式独立 UI 复杂度高,独立路由便于导航 |
| 2 | L1 + L2 一起上 | (A) 一起 / (B) 分阶段 | **B** | L1 立即可用,L2 需 ~30MB 模型下载;Week 1 上 L1,Week 2 上 L2 |
| 3 | L3 智谱启用 | (A) 启用 / (B) 不启用 | **A(可选)** | 需要 `ZHIPU_API_KEY`,无 key 时 fallback L1 + L2 |
| 4 | 索引存储 | (A) Vectra / (B) lancedb | **A(起步)** | Vectra 1k-10k 已够;>100k 升级 lancedb |
| 5 | 视觉聚类算法 | (A) UMAP + KMeans / (B) HDBSCAN | **A(主推)+ B(A/B)** | KMeans 可控,HDBSCAN 自适应 |
| 6 | WebGPU 默认 | (A) 默认开 / (B) 默认关 | **B** | Firefox 默认关;feature detect + WASM fallback |
| 7 | 隐私策略 | (A) 默认云端 / (B) 默认端侧 | **B** | 端侧 + 显式云端勾选;企业用户友好 |
| 8 | 图片 TM 是否独立 | (A) 与文本 TM 共用 / (B) 独立存储 | **B** | 图像特征维度不同,独立 Vectra index 更稳 |

**等用户回复后开工。**

---

## 7. 核心风险与对冲

| 风险 | 影响 | 对策 |
|---|---|---|
| CLIP 模型首次下载 30MB | 弱网慢 / 失败率高 | Service Worker 预缓存 + 进度条 + 降级 L1 pHash |
| WebGPU 兼容性 | Firefox / Safari 默认关 | feature detection → WASM CPU fallback + UI 提示 |
| 索引膨胀 (> 100k 张) | 检索慢 / 内存爆炸 | LRU 缓存 + JSONL rotation + 升级 lancedb |
| 隐私顾虑 | 企业用户不敢上传 | 端侧 WebGPU + 不上传原图 + 显式云端勾选 |
| 跨语言结果不足 | 设计师看不到亚洲图 | 多语言 caption 索引 + 智谱 vision 增强 |
| 截图权限限制 | Chrome 截整屏失败 | 引导 PWA / 桌面端 + 手动上传兜底 |
| 图像 diff 抗噪差 | 像素 diff 对压缩敏感 | 先 alignment + normalization + perceptual hash |
| 视觉聚类质量 | 用户不买账 | HDBSCAN A/B + 人工簇调整 |
| DAG 编排 UX | 太复杂劝退 | 分步引导 + 模板市场 + 撤销栈 |
| 8 子模式并发实施失控 | 全局延期 | Week 1 后基于真实反馈动态调整 + 优先级滚动 |

---

## 8. 核心数据回顾

调研发现(详见 `industry-research.md`):

| 维度 | 数量 | 备注 |
|---|---|---|
| 国际巨头产品 | 8 款 | Google Lens / Pinterest / Bing / Snapchat / eBay / Apple / Amazon / Adobe |
| 国内大厂产品 | 15 款 | 淘宝拍立淘 / 百度识图 / 微信 / 抖音 / 小红书 / 华为 / OPPO / 夸克 / 百度翻译 / 有道 / 讯飞 / CamScanner / 夸克扫描王 / 百度网盘 / 阿里相册 |
| 设计师工具 | 14 款 | Adobe / Canva / Figma / Midjourney / Pinterest / Eagle / Billfish / Pixiv / TinEye / 虎课 / 摄图 / 千图 / 包图 / 觅元素 |
| 顶尖实践 TOP | 60 条 | 6 大类(算法 / UX / 工程 / 隐私 / 性能 / 商业化) |
| 失败/吐槽点 TOP | 30 条 | 3 大类(误识别 / 慢 / 隐私) |
| 技术栈 | 12 类 | CLIP / MobileCLIP / SigLIP / DINOv2 / pHash / Vectra / onnxruntime-web / HNSW / UMAP / HDBSCAN / WebGPU / WASM |

**最强对标(1:1 映射)**:

| 我们 | 对标产品 | 对标理由 |
|---|---|---|
| 任务库图搜 | **Eagle**(本地素材库 AI 搜索) | 都聚焦本地任务库 / 资源库 |
| 跨文档追溯 | **TinEye**(跨站追溯) | 唯一被认可的图像反向搜索 |
| 区域级图搜 | **Pinterest Lens**(圆点裁切再搜) | 区域框选再搜的范式 |
| 截图助手 | **CamScanner**(拍照 + 增强 + OCR + 导出) | 截图后自动加工的标杆 |
| 图像 diff | **Adobe Firefly**(结构/风格解耦双参考) | 结构 + 风格双参考对标 |
| 视觉聚类 | **Billfish / Eagle**(智能文件夹) | 聚类 + 自动归类 |
| 图片 TM | **SDL Trados / memoQ**(segment fuzzy) | segment-level 复用 |
| 多模态联动 | **Canva Magic Design**(一键智能设计) | pipeline 一键化 |

---

## 9. 模型与时间声明

> **本文档由 claude-sonnet-4-6 生成于 2026-07-01**
> 总设计稿 9 个文件 ~250-400KB
> 调研基础:`industry-research.md`(~80KB)
> 覆盖子模式:8/8
> 业界对标产品:37(国际 8 + 国内 15 + 设计师 14)
> 顶尖实践:60 条
> 失败/吐槽:30 条
> 技术栈覆盖:12 类
> 设计稿 ASCII wireframe 数量:8
> 亮点挖掘条目数:≥ 64(每子模式 ≥ 8)
> 可观测 Header 命名规范:`X-ImageSearch-*` 9 个
> TDD 三件套强制:每子模式 5+ 单测 / 2+ e2e / 1+ 截图
> 工具受限说明:WebSearch / WebFetch 在当前环境不可用,所有竞品细节以业内公知 + 模型知识为准

---

**报告元信息**:
- **生成模型**:claude-sonnet-4-6
- **总字数**:约 5000 字(主报告)
- **完整设计稿**:8 个子文件 + 1 调研文件 ~300KB
- **覆盖子模式**:8/8
- **复用既有能力**:6 类(三层 token / 动效 / ⌘K / 时间轴 / RightPanel / 现有 AI 块)
- **新增共享模块**:6 后端 + 6 前端 hook
- **可观测响应头**:9 个 `X-ImageSearch-*` 头
- **TDD 三件套强制**:每子模式 5+ 单测 / 2+ e2e / 1+ 截图