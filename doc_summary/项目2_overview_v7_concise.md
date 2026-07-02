# [姓名]

**求职意向**：AI 前端专家 / Agent 前端架构师  |  **14 年**  |  **硕士**  |  **杭州**

**电话**：[手机号]  |  **邮箱**：[邮箱]  |  **GitHub**：[GitHub 地址]

---

## 个人亮点

**AI Native 前端范式建立者。** 过去两年在滴滴 LLab 从零搭建 Agent 编排平台 + Generative UI 体系，沉淀了一套 LLM 落地的前端工程范式：`fetch + ReadableStream` 替代 EventSource 控流、括号深度计数驱动 Function Calling 组件流式实例化、幂等状态机 + sequence 号防 SSE 乱序、滑动窗口预生产消除断流。**AI 功能上线从天级压缩至小时级，团队标准接入底座。**

**能做「只有前端能做的」架构决策。** CRDT 选 Yjs 而非 OT（私有化场景中央服务器不可达，操作交换律结合律天然支持离线 P2P）；音频采 AudioWorklet 而非 ScriptProcessor（独立音频线程，平台级隔离而非 API 优化）；PDF 渲染用 pdfium-wasm C++ WASM 而非 PDF.js（速度提升 1-2 数量级）；INP 定位用 LoAF 而非 LongTask（帧内脚本级 vs 任务级粒度）。每个决策有完整 tradeoff 推导和落地验证。

**3 个 SaaS 平台商业化盈利（年 ARR 近千万），技术基座跨 BU 推广。** 讯飞 6 平台矩阵 → 阿里 Smarty Skeleton 推广至考拉/Lazada → 滴滴 Agent 平台支撑 5 个 AI 业务。行中导游 DAU 12 万+、次日留存 41%；ICBU 性能优化带动 GMV 增量千万级；网页翻译 500 万 C 端用户自然增长。

---

## 技术能力

| 领域 | 核心能力 |
|------|---------|
| **AI 流式工程** | ReadableStream SSE、Generative UI（括号深度计数 + 动态组件实例化）、幂等状态机防乱序、滑动窗口预生产 |
| **Agent & RAG** | 自研 DAG 执行引擎（Kahn + 分支剪枝 + Plugin Registry + CDN 沙箱 PermissionProxy）、Qdrant + Hybrid RRF |
| **浏览器底层** | AudioWorklet、pdfium-wasm / FFmpeg.wasm、CRDT(Yjs + Awareness + WebRTC)、OffscreenCanvas 零拷贝、ProseMirror |
| **性能工程** | LoAF、Scheduler.postTask、骨架屏自动化（BGv2 + SKBD 编码 + LZW）、虚拟滚动/页面池 LRU、SSR 流式 |
| **框架/工程化** | React 18/19 (Fiber/Suspense/RSC)、Next.js App Router、Monorepo、微前端、自研监控 SDK、TDD/Playwright E2E |

---

## 项目经历

### 一、AI Agent 编排平台 + Generative UI —— 滴滴 LLab（2025.06 - 至今）

**一句话**：把 AI 能力从对话框搬到出行路线，从零搭建类 Coze 编排平台，定义了团队的 AI 前端工程范式。

**核心决策与实现**：

- **不用 Dify/Coze，自研编排引擎。** 滴滴对算子扩展性、数据合规、模型自主可控有强诉求。基于 ReactFlow 实现 DAG 编辑器 + Kahn 拓扑排序引擎 + Plugin Registry 注册式扩展，**零外部依赖，较 LangGraph 体积减 80%+，启动 < 50ms**。三级插件体系：内置 Registry → CDN 沙箱 `new Function()` 动态加载 → PermissionProxy 9 种权限动态代理。

- **Generative UI：括号深度计数而非 JSON.parse。** Function Calling `arguments` 流式分片到达时，全量 parse 必崩溃。核心洞察：`{` +1 / `}` -1，计数归零 = JSON 合法闭合 → 即刻实例化 React 组件。降级 Markdown 用增量 AST patch + rAF commit，60fps vs 30fps。

- **长推理体验重构，不是技术问题而是产品问题。** 15s 推理等待中用户流失——将推理链 SSE 实时流式渲染，让用户「看见 AI 在思考」；手风琴动画收起切结果态。**感知等待 15s → 7s，次日留存 +18%。**

- 滑动窗口预生产（3 段 × 15min 缓冲）+ 版本号竞态防护（AbortController 中断 + 递增校验）+ TTS 串行 Promise 队列（双角色对话保序）+ VariableResolver 表达式引擎 + Tiptap Prompt 变量编辑器（`${` 触发补全 + DFS 循环检测）。

**结果**：AI 功能上线天级→小时级，支撑 5 个业务。行中导游 DAU 12 万+、次日留存 41%。沉淀《AI 前端工程手册 v1.0》。

---

### 二、ICBU 全链路性能治理 + 骨架屏自动化系统 —— 阿里巴巴（2023.12 - 2025.04）

**一句话**：用 LoAF 替代 LongTask 精准定位 INP 根因，用「运行时学习 + 编译式重排」替代手工骨架屏，在千人千面 B2B 平台落地并跨 BU 推广。

**核心决策与实现**：

- **INP 为何 > 500ms？不是「任务太大」而是「不知道哪帧里的哪段脚本」。** LongTask 只能告诉你有个长任务；LoAF 能拆出帧内每段脚本的耗时和强制 reflow。配合 Scheduler.postTask 三阶段分离（响应→动画→空闲），P90 全指标达标 FCP < 1s / LCP < 2s / CLS < 0.02 / INP < 200ms。

- **骨架屏核心矛盾：千人千面下「构建期不知运行时布局」。** 解法：把首次渲染当学习投资。内联 JS SDK（HTML head 内同步执行，bundle 前骨架已就位，< 500ms）+ 运行时 BFS 学习（rIC 40ms/帧，4D 缓存 key = path + componentId + viewport）+ Chrome 扩展预生成（补 SSR/首次访问盲区）。**单页开发 0.5 人日 → 5 分钟（↓95%），CLS 0.15+ → < 0.02。**

- 演进到 skeleton-unified 统一架构时，做了几个「只有前端能做」的底层优化：BGv2 10 阶段管线（≤ 45 bones/页，≤ 60ms）；topology DFS 路径压缩（透明 wrapper 节点 ↓30-50%）；自研 SKBD 二进制编码 + LZW（体积 ↓40-60%，魔法数格式 Uint16 坐标 × 100 + 1B flags 位域）；Playwright + pixelmatch 视觉回归 CI 门禁（三态裁决 MISSING/STALE/DRIFT）。

- **国别化配置驱动**：路由层动态注入 Schema，新增国家只加配置文件不改代码。越南/泰国 2 周 → 3 天。

**结果**：A/B 实验验证性能优化带动转化率 +12%（月 GMV 增量千万级）。Smarty Skeleton 推广至考拉/Lazada，团队 20+ 页面接入，3 次对外分享 + 内网博客 8000+ 阅读。

---

### 三、多模态 AI SaaS 平台矩阵 —— 科大讯飞（2020.03 - 2023.08）

**一句话**：4 人前端 Tech Lead，主导 6 个 SaaS 平台前端架构，其中 3 个商业化盈利（年 ARR 近千万），覆盖 1000+ 企业客户、500 万+ C 端用户。

**核心决策与实现**：

- **23 种文档格式 × 123 语种的双栏比对翻译，为什么选 Canvas 而非 DOM？** DOM 渲染每种格式的样式兼容成本巨大，Canvas 统一渲染管线后降低 80%。引入 pdfium-wasm（C++→WASM Worker 运行，较 PDF.js 快 1-2 数量级）+ 虚拟页面池（LRU + revokeObjectURL，内存 O(n)→O(1)）。

- **协同编辑选 CRDT 而非 OT。** 私有化部署场景中央服务器不可达，OT 做并发变换无法保障可用性。Y.Doc + y-webrtc（BroadcastChannel→WebRTC P2P 降级）+ 段落级编辑锁 + Awareness 光标感知 + IndexedDB 离线恢复。**数十家企业 4 年+稳定运行，零数据丢失。**

- **AudioWorklet 而不是 ScriptProcessor——平台级隔离，不是 API 优化。** 独立音频线程零主线程占用 + 双重 VAD 降带宽 50% + partial/final 分级渲染，端到端 < 800ms。1024 开发者节万人同屏零延迟。

- **网页翻译 Extension（500 万+ C 端用户）：零布局破坏注入。** 译文 span 插入元素内部而非兄弟节点（不破坏 flex/grid/table），TreeWalker 只改 Text nodeValue 不改 Element。NLLB-600M L0H15 词级对齐 F1=0.851 业界领先。

**结果**：3 平台盈利。QPS 较初版提升 20x。私有化部署 5-7 天→1-2 天。

---

### 四、Office Doc AI 预览平台 + 前端监控 SDK —— 全栈工程能力

**一句话**：WASM PDFium 渐进渲染引擎 + 编译架构 multipart 解析器 + < 5KB 监控 SDK，全栈能力闭环。

**核心实现**：

- **WASM PDFium 渐进渲染**（coordinator.ts 616 行）：Worker 内运行 @hyzyla/pdfium，OffscreenCanvas + transferToImageBitmap 零拷贝，128MB LRU + 优先级队列，0.5x→1.0x 渐进清晰，快速滚动（>0.5 px/ms）跳过渲染。

- **翻译双栏（TranslationLayout.tsx ~1350 行）**：二分查找页码同步 + char-level span 注解（CJK 2 单位/ASCII 1 单位）+ 双策略管道（passthrough 零额外渲染 / synthetic 全链路）。21 E2E + 40+ 单测。

- **自研 multipart 编译器**：Lexer→Parser→AST→Visitor，零依赖，完整 RFC 规范，替代 multer 体积减 90%+。

- **监控 SDK < 5KB gzip**：白屏双重校验（9 点采样 + MutationObserver，消除骨架屏误报）、LoAF 监控、fetch/XHR monkey-patch 零感知、SourceMap CI 上传不随 CDN 发布、sendBeacon 批量发送。

**结果**：189 页 PDF 内存 300MB→10MB（30x↓），首屏 8s→300ms。P0 故障响应 5 分钟内，SDK 从讯飞复用至阿里。

---

## 关键架构决策

| 决策 | 常规方案 | 我的选择 | 一句话理由 |
|------|---------|---------|-----------|
| Agent 编排 | 接入 Dify/Coze | **自研 DAG 引擎** | 算子扩展性、数据合规、模型自主可控无法妥协 |
| FuncCall | 全量 JSON.parse | **括号深度计数 O(n)** | 流式分片全量 parse 必崩溃；逐字符判闭合是正确解 |
| 骨架屏 | 手工绘制 | **运行时学习 + 编译重排** | 千人千面下构建期不可能知道运行时布局 |
| 协同编辑 | OT | **CRDT (Yjs)** | 私有化无中央服务器，OT 依赖服务器做并发变换 |
| SSE 消费 | EventSource | **fetch + ReadableStream** | POST/Authorization/AbortController 三者 EventSource 均不支持 |
| PDF 渲染 | PDF.js | **pdfium-wasm** | C++→WASM Worker 运行，速度提升 1-2 个数量级 |
| 音频采集 | ScriptProcessor | **AudioWorklet** | 独立线程 vs 主线程——不是优化，是架构隔离 |
| INP 定位 | LongTask API | **LoAF API** | 帧内脚本级 vs 任务级，定位精度差一个量级 |
| 插件安全 | iframe/Worker | **new Function + PermissionProxy** | 9 种细粒度权限 + 审计 header + destroy 全拒绝 |
| Multipart | multer (npm) | **自研编译器** | Lexer→AST→Visitor，零依赖，体积 ↓90%+ |