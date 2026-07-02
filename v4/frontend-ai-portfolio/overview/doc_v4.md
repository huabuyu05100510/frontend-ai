# [姓名]

**求职意向**：AI 前端工程师 / Agent 前端工程师 &nbsp;|&nbsp; **工作年限**：10 年+ &nbsp;|&nbsp; **学历**：硕士 &nbsp;|&nbsp; **所在地**：杭州

**电话**：[手机号] &nbsp;|&nbsp; **邮箱**：[邮箱] &nbsp;|&nbsp; **GitHub**：[GitHub 地址]

---

## 个人亮点

- **AI 前端工程深耕 5 年+**：在科大讯飞（3.5 年，消费 BG 核心产品线）、阿里 ICBU、滴滴 LLab 持续从事 AI 产品前端架构，将 NLP 纠错、OCR 识别、语音转写、机器翻译、大模型推理等 AI 模型输出落地为可交互浏览器端应用，覆盖文本 / 图像 / 音视频 / 文档多模态场景，支撑 6 个商业化 SaaS 平台（翻译产品矩阵服务百万级用户，合计年 ARR 近千万）。

- **AI Agent & 流式工程范式建立者**：在滴滴 LLab 建立了一套可复用的 AI 流式前端范式——`fetch + ReadableStream` 替代 `EventSource`（支持 POST / Authorization / AbortController，EventSource 三者均不具备）；**括号深度计数**追踪 Function Calling `arguments` 分片完整性 → 动态 React 组件流式实例化（Generative UI）；**幂等状态机 + sequence 号**保证多节点 Agent SSE 乱序安全；独立搭建 AI Agent 编排平台，**AI 功能上线周期从天级压缩至小时级**。

- **浏览器底层工程专家**：在生产场景落地 5 类核心底层 API——**AudioWorklet**（独立音频线程采集 PCM，解决 ScriptProcessor 主线程丢帧根因）、**pdfium-wasm**（C++ WASM 渲染，百页文档渲染耗时降低 60%+）、**Web Worker + WASM**（Rust 编译大文件 MD5 Hash，150-300 MB/s 主线程零阻塞）、**ReadableStream + AbortController**（可中断流式消费与竞态防护）、**SharedArrayBuffer + Atomics**（多 Worker 并行计算零拷贝）；每项均源于生产问题驱动。

- **Web 性能全链路度量与优化专家**：建立「**定位 → 拆解 → 优化 → 度量**」性能工程闭环——**LoAF API** 精准定位长动画帧内阻塞脚本（粒度优于 LongTask）→ **Scheduler.postTask** yield 分片拆解主线程占用 → **Smarty Skeleton** 三层骨架屏消除 CLS → **PerformanceObserver** 持续度量反馈；主导阿里 ICBU P90 全指标达标（FCP < 1000ms / LCP < 2000ms / CLS < 0.02 / INP < 200ms），骨架屏自动化 CLS 优化成本降低 **95%**；自研监控 SDK（**< 5KB gzip**，白屏双重校验 + LoAF + SourceMap CI 还原），P0 故障响应降至 **5 分钟内**。

---

## 技术能力

### AI & Agent 技术栈（核心方向）

- **流式工程**：`fetch + ReadableStream` 消费 SSE，AbortController 流级中断，背压感知；增量 Markdown 解析 + rAF 批量 commit，维护已解析 AST 只 patch 新增节点；落地 **Generative UI**（Function Calling arguments 分片 → 括号深度计数 → 动态 React 组件实例化）
- **Agent 框架**：LangChain.js / LangGraph.js，熟悉 ReAct / Plan-Execute、状态图管理、Tool Calling
- **工作流引擎**：自研 TypeScript DAG 执行引擎（Kahn 算法拓扑排序 + 循环检测 + 节点注册插件系统）；可视化编排基于 XYFlow（React Flow）；运行时 SSE 推送节点状态，幂等状态机 + sequence 号防乱序
- **RAG & 向量检索**：熟悉 RAG 管道全流程（文档解析 → 分块 → Embedding → 向量检索 → 重排序），实战使用 Qdrant 向量数据库
- **Prompt Engineering**：Prompt 变量编辑器（Tiptap / ProseMirror 自定义 Decoration，支持 `${node.var}` 语法高亮 + 自动补全 + 循环依赖检测）

### 前端核心框架

- **React 生态**：精通 React 18/19，深入理解 Fiber 架构、并发特性（Suspense / useTransition）、RSC；熟练使用 Next.js App Router
- **Vue 生态**：精通 Vue 3 Composition API，深入理解 Proxy-based 响应式、编译优化（静态提升 / PatchFlags）
- **编辑器**：contentEditable + Range API、Tiptap（ProseMirror）、Monaco Editor
- **跨端**：PC Web / H5 / 微信小程序 / Chrome Extension 多端实战

### 工程化 & 架构

- **构建与 Monorepo**：Vite / Webpack，主导大型项目构建优化（冷启动 < 3s、HMR < 100ms、包体积 ↓40%+）；Turborepo + pnpm Monorepo
- **微前端**：qiankun / iframe + postMessage，Router-based 子应用动态加载
- **状态管理**：Redux / Zustand / Pinia；有限状态机驱动复杂表单流转
- **后端能力**：Node.js（NestJS）+ Prisma ORM + PostgreSQL + Redis BullMQ，具备全栈交付能力

### 性能优化 & 底层

- **渲染优化**：虚拟滚动（不定高 + ResizeObserver 动态修正）、Canvas 分块渲染（Tile Rendering）、脏矩形优化（Dirty Rect）、OffscreenCanvas 离屏渲染
- **计算加速**：Web Worker + WASM（Rust）、SharedArrayBuffer + Atomics 零拷贝、Transferable Objects
- **性能监控**：LoAF API、PerformanceObserver、requestIdleCallback、自研监控 SDK（< 5KB gzip）

---

## 工作经历

---

### 滴滴 llab（2025.06 - 至今）| 高级前端工程师

**技术栈**：React 18 / 微信小程序 + TypeScript + SSE + ReadableStream + ReactFlow + Canvas + LangChain.js + Tiptap

**业务背景**：llab 是滴滴探索 AI + 出行场景融合的创新实验室，核心命题：**如何让 AI 能力真正融入出行路线，而非停留在对话框**；同时需要工程侧支持产品快速搭建复杂多步骤 AI 功能，减少工程排期依赖。

---

#### 项目一：AI Agent 工作流编排平台

**Situation**：AI 功能开发高度依赖工程排期，产品每新增一个 AI 场景（搜地点 / 导游讲解 / 问答）均需重新排期，迭代周期以天计。需要一套低代码工具让产品可以自主编排 AI 工作流并发布。

**Action**：

**1. 可视化 DAG 工作流编辑器**
- 基于 **ReactFlow（XYFlow）** 实现拖拽节点、连线、端口类型合法性校验（string / object / array / any，不合法连线实时标红）
- 节点类型覆盖：LLM 对话、工具调用（搜索 / POI / 天气）、条件分支、循环、人工审核
- 工作流 JSON Schema 统一序列化，支持导入导出与版本管理

**2. 自研 TypeScript DAG 执行引擎**
- **Kahn 算法**实现拓扑排序 + **DFS 染色法**循环检测，保证执行合法性
- 基于注册模式（Plugin Registry）的节点扩展系统：新增节点类型只需实现标准 `NodeType` 接口（input / output / execute / config schema）即可热插拔，**不改动引擎核心代码**
- 节点间数据传递通过 Context Passing 支持 `${node.var}` 变量引用，并行分支 + 条件路由统一调度
- 零外部依赖，包体积较 LangGraph 减少 80%+，启动耗时 < 50ms

**3. 运行时可视化 —— SSE 状态推送 + 幂等状态机**
- SSE 实时推送节点状态变更，前端维护 `nodeStatus Map` 驱动节点样式（running 流光动画 / done 绿 / failed 红）
- **难点**：后端多节点并行执行导致 SSE 事件乱序到达，按到达顺序更新状态会出现闪烁和状态回退
- **方案**：幂等状态机——状态只能单向流转（pending → running → done/failed），done/failed 后忽略后续同节点事件；SSE event 携带 `sequence` 号，乱序到达时按 sequence 排序后重放

**4. Prompt 变量编辑器**
- 基于 **Tiptap（ProseMirror）** 自定义 Decoration 实现 `${node.var}` 语法高亮
- 自动补全列表基于当前 DAG 上游可达节点输出变量（通过拓扑排序获取），循环依赖通过构建变量引用图 + DFS 判环
- 变量引用校验在编辑态实时运行，防止运行时注入错误

**Result**：
- AI 功能上线周期从**天级压缩至小时级**
- 自研 DAG 引擎零外部依赖，启动耗时 < 50ms，包体积减少 80%+
- Prompt 编辑器支持自动补全 + 语法高亮 + 循环依赖检测，Prompt 编写错误率降低 70%+

---

#### 项目二：「行中导游」—— 出行 AI 播客的流式内容调度与 Generative UI

**Situation**：基于旅行路线实时生成景点讲解 + 双角色语音播客 + AI 博客，行驶过程中无缝收听，路线变化时内容需立即切换不能断流。

**Action**：

**1. Generative UI —— Function Calling 分片流式实例化**
- **难点**：Function Calling `arguments` 是 JSON 字符串按 chunk 分片到达，直接 `JSON.parse` 必然抛异常
- **方案**：**括号深度计数**（O(n) 逐字符扫描，`{` +1 / `}` -1，归零时 JSON 合法闭合），仅合法闭合时实例化 `render_poi_card / render_route_map / render_tip_block`；降级 Markdown 路径用**增量解析 + rAF 批量 commit**，维护已解析 AST 每帧只 patch 新增节点，帧率稳定

**2. 滑动窗口预生产 —— 彻底消除断流**
- 借鉴视频预加载缓冲模型：始终维护 3 段 ≥ 15 分钟内容缓冲，消费到第 2 段时自动触发下一批 SSE，生产速度永远快于消费速度

**3. 路线变化竞态防护**
- `AbortController` 立即中断旧 SSE（而非等待其自然结束），清空待播队列；每次路线变化递增**版本号**，SSE 回调先校验版本号，旧版本响应直接丢弃

**4. TTS 串行队列 —— 双角色播客顺序保证**
- 双角色（原野 / 晓曼）TTS 并发请求回包顺序不保证；维护**串行 Promise 队列**按脚本角色序依次 resolve，保证播放顺序与脚本完全一致，支持路线进度联动自动切景点

**Result**：
- 滑动窗口策略彻底消除断流，实现讲解文字 + 双人语音播客 + AI 博客三合一沉浸式体验
- Generative UI 建立 Function Calling → 括号深度计数 → 动态组件实例化前端范式，**成为团队 AI 内容渲染的标准方案**

---

#### 项目三：「在哪儿问问」—— 多模态 Agent 推理链路前端体验工程（微信小程序）

**Situation**：用户上传兴趣图片（类小红书打卡照），AI 识别场景后搜索类似地点并推荐打卡路线。多轮搜索 + 图像分析的推理链路需要 15s，传统 loading 下用户无法区分「AI 在思考」和「服务挂了」。

**Action**：

**1. 15s 长推理等待体验工程**
- **关键洞察**：让等待「可见且有意义」比缩短等待更重要
- 推理过程通过 SSE 实时流式渲染（多轮搜索 / 图像细节分析均可见），推理完成后手风琴动画收起推理链，切换为地图卡片 + Markdown 结果态

**2. 动态分流 UI**
- 根据**首包是否含推理事件**动态分流：有推理 → 展示推理链滚动；无推理 → 骨架屏快速占位；两条路径收敛到相同结果态

**3. EXIF 矫正**
- iOS 相机照片 EXIF 方向标记导致模型接收旋转 90° 图片，识别准确率明显下降；Canvas 读取 `Orientation` 字段先矫正再压缩

**4. 为什么用 `fetch + ReadableStream` 而非 `EventSource`**
- `EventSource` 只支持 GET、不支持 Authorization Header、不支持 AbortController 精确中断；`fetch + ReadableStream` 三者均支持且能感知背压，路线变化时可立即切断旧流

**Result**：首 token 推理响应 ≤ 2s，长推理等待用户留存率明显提升（推理过程可见，用户不再主动退出）

---

### 阿里巴巴 ICBU（2023.12 - 2025.04）| 前端工程师

**技术栈**：React 18 + TypeScript + Next.js（App Router / SSR）+ Node.js/BFF + Vite + Monorepo（pnpm）+ LoAF API / PerformanceObserver + IndexedDB + Chrome 插件 + 数据埋点

**业务背景**：ICBU 是阿里面向全球买卖家的 B2B 跨境电商平台，负责**海外商品域**（AI 惠普 / 搬品 / 征品 / 交易化 by 国家链路）和**海外商增域**（入驻流程国别化 / AI 极简认证 / 支付本地化）。核心挑战三重：发品表单历史包袱重（单文件 3000+ 行，状态管理混乱）；多国差异散落 if-else 中（税制 / 支付 / 合规规则每次新增国家都在核心逻辑打补丁）；核心交易页面性能不达标（P90 INP > 500ms，LCP > 4s，CLS > 0.15，直接影响转化率）。

---

#### 项目一：Core Web Vitals 全链路性能优化 + Smarty Skeleton 自动骨架屏

**Situation**：核心页面 P90 指标严重不达标——INP > 500ms（交互响应慢，用户感知卡顿）、LCP > 4s（首屏加载慢，跳出率高）、CLS > 0.15（布局抖动，影响点击准确性）。三项指标同时超标，需系统性治理而非单点修补。

**方法论**：建立「**定位 → 拆解 → 优化 → 度量**」性能工程闭环——先用精准工具定位根因，再针对性拆解每个指标的优化链路，最后用 PerformanceObserver 持续度量，防止回归。

**Action**：

---

**一、LCP 优化链路（Loading Performance）**

LCP 超标根因是**资源加载瀑布流长**：HTML 由客户端渲染（白屏时间长）、LCP 图片无优先级声明、render-blocking 脚本阻塞解析、首屏 JS bundle 体积过大。

**1. SSR 首屏直出**
- 迁移 Next.js App Router SSR，服务端直出首屏 HTML，消除客户端渲染的白屏时间
- 关键 CSS 内联到 `<head>`（Critical CSS Extraction），消除 CSSOM 构建对首屏渲染的阻塞
- LCP 元素在服务端已渲染，浏览器收到 HTML 即可开始绘制

**2. LCP 图片优先加载**
- Hero 图（LCP 元素）添加 `<link rel="preload" as="image">`，提升资源在 HTTP 请求队列中的优先级，避免被 JS / CSS 资源抢占带宽
- 统一使用 Next.js `Image` 组件：自动转换 **WebP 格式**（体积减少 25-35%）、生成响应式 `srcset`（避免移动端加载 2x 大图）、非 LCP 图片自动懒加载（`loading="lazy"`）
- LCP 图片显式设置 `priority` 属性，跳过懒加载直接预加载

**3. 消除 render-blocking 资源**
- Google Analytics、客服 SDK 等非关键第三方脚本改为动态插入（`document.createElement('script')`）或 `defer`，延迟到 `DOMContentLoaded` 后执行，消除对 HTML 解析的阻塞
- 字体文件添加 `<link rel="preload" as="font" crossorigin>`，消除字体加载导致的 FOUT（无样式文本闪烁）；同时进行**字体子集化**（只打包页面实际使用的字形），字体文件体积减少 60%+

**4. 代码分割（Code Splitting）**
- 基于 Next.js 动态 `import()` 实现**路由级 + 组件级**代码分割；大型弹窗、富文本编辑器等非首屏组件按需加载
- 首屏 JS bundle 体积减少 **40%+**，显著缩短 parse / compile 时间
- 配合 `React.lazy + Suspense` 实现组件级流式渲染，骨架屏在 JS 加载期间保持可见

**LCP 结果：P90 LCP 4s+ → < 2000ms**

---

**二、INP 优化链路（Interaction Responsiveness）**

**关键洞察**：LongTask API 只给出粗粒度任务时长（「哪段时间有长任务」）；**LoAF（Long Animation Frame）API** 能精准关联到「哪个动画帧里哪段脚本阻塞了输入响应」，定位精度从任务级提升到帧内脚本级。

**1. 根因定位**
- 通过 `PerformanceObserver('long-animation-frame')` 采集 LoAF entries，每条 entry 包含：帧内所有脚本的执行时长、强制 reflow（Forced Synchronous Layout）信息、以及与 INP 事件的关联
- 定位到商品管理页的**同步大计算**（属性体系递归处理、价格矩阵计算）是 INP 根因——这些同步逻辑在点击事件处理函数中直接执行，阻塞了后续渲染帧

**2. Scheduler.postTask yield 分片**
- 用 **`scheduler.postTask()`** 将同步大计算拆分为多个 yield 分片，每次 postTask 让出主线程控制权，浏览器可在分片间处理用户输入和渲染
- 严格遵循「**响应 → 动画 → 空闲**」三阶段分离：事件处理函数只执行最小 UI 更新（响应阶段），计算密集任务推后到空闲阶段（`postTask({ priority: 'background' }`）
- 对于无法拆分的遗留同步逻辑，降级使用 `requestIdleCallback` 在浏览器空闲时执行

**3. 事件处理优化**
- 批量 state 更新合并为单次 re-render（React 18 自动批处理 + flushSync 精确控制）
- 高频事件（scroll / resize / input）统一 debounce / throttle，避免每次触发都阻塞主线程

**INP 结果：P90 INP 500ms → < 200ms**

---

**三、CLS 优化链路（Layout Stability）**

CLS 超标的三大来源：骨架屏缺失导致内容加载后布局突变、图片无尺寸声明加载后撑开布局、字体加载完成后文字重排（FOUT）。

**1. Smarty Skeleton 三层自动化骨架屏系统**

核心矛盾：千人千面页面「构建期不知运行时布局」—— 构建时不存在 DOM，运行时渲染完毕何需骨架。这是一个必须在系统层解决的矛盾，不能靠约定规避。核心思路：**将首次渲染作为「学习投资」，从第二次访问起骨架屏自动还原、精准匹配、零人工维护**。

- **内联 JS SDK（极致性能层）** —— 覆盖第 2 次起的所有访问：注入 HTML `<head>`，在 bundle 解析前同步执行；同步读 **localStorage** 元数据立即创建占位容器，异步读 **IndexedDB** 取骨架数据（每块 `[left%, top%, w%, h%, type]` 五元组，百分比坐标天然响应式），动态生成占位节点；框架水合前骨架已就位，白屏彻底消除；

- **NPM 运行时学习层** —— 解决「谁来生成骨架数据」：首次真实渲染完成后静默 BFS 遍历 DOM，**requestIdleCallback 40ms 预算/帧**时间切片（空闲时间执行，不占任何主线程帧预算）；4 路并联叶子识别（hasChildText / img·input·button 枚举 / 背景图渐变 / `data-skeleton-block` 标记）；邻近块合并消除密集文本碎条；结果双写 localStorage（元数据）+ IndexedDB（完整数组）；**4D 隐式缓存失效**（key = `path + componentId + innerWidth + innerHeight`），视口变化自然 cache miss，无需显式版本号；

- **Chrome 插件预生成层** —— 覆盖 SSR 场景（服务端无 DOM）和首次访问（新用户无缓存）两个运行时 SDK 到不了的盲区；插件在真实页面叠层可视化预览骨架，开发者调整后一键保存至项目约定路径，提交 git 后 SSR 直接读取；

**2. 图片尺寸预占位**
- 所有图片显式声明 `width` / `height` 属性（或通过 Next.js Image 自动注入），浏览器在图片加载前即可预留空间，消除加载后的尺寸撑开
- 使用 CSS `aspect-ratio` 实现响应式图片容器的宽高比预占位，适配不同屏幕宽度

**3. 字体预加载消除 FOUT**
- `<link rel="preload" as="font">` 使字体与 HTML 同优先级并行加载，字体就绪时间提前，FOUT 引起的文字重排窗口从秒级压缩至毫秒级
- 回退字体（`font-display: optional`）与目标字体字形尺寸匹配，进一步减少替换时的 layout shift

**CLS 结果：P90 CLS 0.15+ → < 0.02**

---

**四、缓存策略（Cache Strategy）**

- **静态资源长期缓存**：Vite 构建产物文件名包含内容 hash，配合 `Cache-Control: max-age=31536000, immutable`，CDN / 浏览器缓存永不过期，内容变更时 hash 变化自动更新
- **CDN 边缘缓存**：静态资源通过 CDN 就近分发，海外用户（欧美 / 东南亚）访问延迟减少 50%+
- **SWR 客户端数据缓存**：页面切换时 stale 数据即时展示（消除白屏），后台重新请求后静默更新，兼顾速度与新鲜度
- **预取（Prefetch）**：Next.js Link 组件在视口内自动 prefetch 下一页资源，页面切换 < 200ms

---

**五、性能度量体系（Measurement）**

- **PerformanceObserver 持续监控**：通过 `PerformanceObserver` 在生产环境持续采集 LCP / INP / CLS / LoAF 数据，实时上报到监控平台；区分 P50 / P75 / P90 / P99 分位，重点关注 P90 达标情况
- **复用讯飞监控 SDK**：快速接入讯飞阶段沉淀的监控 SDK（< 5KB gzip），白屏检测 + SourceMap CI 还原 + P0 告警，建立 ICBU 20+ 页面稳定性告警体系
- **性能预算机制**：在 CI/CD 流水线中集成 Lighthouse CI，核心页面性能指标作为卡点，回归自动拦截

**总结 Result**：
- Core Web Vitals P90 全指标达标：**FCP < 1000ms / LCP < 2000ms / CLS < 0.02 / INP < 200ms**
- Smarty Skeleton：CLS **0.15+ → < 0.02**，单页开发成本 **0.5 人日 → 5 分钟（↓95%）**，全团队 20+ 页面零维护接入，**沉淀为可对外推广的前端基建能力**
- 首屏 JS bundle 体积 **↓40%+**，字体文件体积 **↓60%+**，海外用户静态资源加载延迟 **↓50%+**

---

#### 项目二：发品表单架构升级 + 国别化配置驱动架构

**1. 表单架构 —— 有限状态机取代 if-else**
- **根因**：3000+ 行大文件中表单状态散落 if-else，if-else 是状态转移的隐式编码，状态越多越难穷举边界
- **方案**：**有限状态机**将每个状态允许的事件与转移显式声明（草稿 → 填写中 → 校验中 → 提交中 → 完成），组件只根据当前状态渲染，新增状态不影响已有路径；按模块拆解为 < 500 行/模块，统一 Design Token 消除样式碎片化
- 核心模块代码量 **↓60%+**，新表单开发效率 **↑50%**

**2. 国别化配置驱动架构**
- **根因**：多国差异散落 if-else，每次新增国家都在核心逻辑打补丁，腐化是必然结果
- **核心原则**：核心业务组件对国别无感知；路由层读取 `countryCode` 动态注入差异化 Schema（表单字段 / 校验规则 / 支付渠道 / 合规提示），Feature Flag 控制功能开关
- **新增国家只需新增配置文件，不改任何业务代码**；落地 OCR 证件识别自动填充，多国本地支付 SDK 统一封装为 `PaymentContext`

**3. AI 属性补全 & 智能搬品**
- 商家输入标题后 500ms 防抖触发 AI 接口，推荐属性以浮层展示；SSE + ReadableStream 逐 Token 解析 + 增量 DOM 更新，AI 生成内容流式渲染
- AI 搬品页设计批量选品 + 类目映射可视化编辑器，属性冲突实时高亮；可编辑 Diff（contentEditable + MutationObserver 实时计算「AI 原文 vs 用户修改」，`<ins>` / `<del>` 标签标记）

**4. 数据埋点体系**
- 曝光埋点基于 **IntersectionObserver** 声明式监听（组件标注 `data-track-expose` 即自动采集，替代高频 scroll + getBoundingClientRect，主线程零额外负担）
- 点击埋点用事件委托在根节点单一监听；A/B 实验分组写入 `window.__EXPERIMENTS__`，组件通过 `useExperiment` Hook 无感知读取；埋点数据通过 **`navigator.sendBeacon`** 在 `visibilitychange: hidden` 时批量发送，页面关闭不丢数据

**Result**：
- 表单架构升级：核心模块代码量 **↓60%+**，新表单开发效率 **↑50%**
- 国别化架构：新增国家改造成本从周级降至天级
- 线上错误率 **0.5% → 0.1%**

---

### 科大讯飞（2020.03 - 2023.08）| 消费 BG | 资深前端工程师

**技术栈**：React / TypeScript / Canvas / WebSocket / AudioWorklet / pdfium-wasm / Chrome Extension / 微信小程序 / iframe 微前端

负责消费 BG 6 个 AI SaaS 平台（智能翻译全产品矩阵 / 讯飞智检 / OCR 规则训练 / LLab 模型平台 / 在线配音）的前端架构与核心模块开发，前三个平台商业化盈利，均为部门重点项目，合计年 ARR 近千万。

核心命题：**如何将不同模态的 AI 模型推理结果，在浏览器端进行高效、精准的可视化还原，并与原始内容形成可交互的比对。**

---

#### 项目一：多模态 AI 比对渲染引擎（覆盖 7 条产品线）

**1. 字符级 —— 讯飞智检 contentEditable 纠错引擎**

- **背景**：基于 CGED 2018 TOP1 中文语法检错技术，6 大类错误（拼写 / 语法 / 标点 / 数字 / 量词 / 政治）+ 涉政涉黄违禁词，需精准标注到原文对应字符位
- **难点**：`contentEditable` 的 `Range` API 在跨标签、跨行、跨嵌套结构时行为不一致（Chrome / Safari / Firefox 三端差异）
- **方案**：实现 **Range Normalizer**——将任意 Range 拆解为原子文本节点片段，每个片段独立包裹 `<mark>` 标签；通过 `TreeWalker` 构建 `textOffset → node` 索引，O(log n) 定位任意字符位；用户二次编辑时通过 `MutationObserver` 实时重建索引；撤销 / 重做通过自定义 Command Pattern 管理，避免浏览器原生 undo 的不可控性
- **性能**：10 万字+长文档首屏高亮 < 500ms——`requestIdleCallback` 分片渲染（每帧处理 2000 字符），避免 Long Tasks 阻塞主线程

**2. 段落级 —— 文档翻译双栏同步比对**

- **背景**：支持 PDF / DOCX / PPT / XLS 等 23 种格式、123 语种在线翻译，需保持原排版，原文与译文段落一一映射、双侧同步高亮
- **技术决策**：为什么用 Canvas 而非 DOM？——DOM 渲染 23 种格式样式兼容成本过高（PPT 动画 / XLS 公式 / PDF 矢量图），Canvas 统一渲染管线后兼容成本降低 80%；代价是失去原生文本选择——通过 `canvas.addEventListener('click')` + `positionMap` 二分查找实现「模拟文本选择」
- **方案**：Canvas 逐页渲染 → 提取段落盒模型坐标构建 `positionMap` → `IntersectionObserver` 锁定可视段落 → `postMessage` 驱动左右两侧同步滚动；树形 Diff 标记段落内文本增删改，低置信度译文以 `globalAlpha` 透明度编码（0.3-0.7）引导审校优先级
- **大文档性能**：引入 **pdfium-wasm**（C++ 编译 WASM，在 Worker 中运行）替代 PDF.js，百页文档渲染耗时降低 **60%+**；虚拟页面池（仅维护可视区 ±2 页，LRU 淘汰 + revokeObjectURL 释放），内存占用从 O(n) 降至 O(1)

**3. 像素级 —— 图片翻译 Canvas 叠加对比**

- 双层 Canvas（原图层 + 译文文字层），`globalCompositeOperation` 控制叠加顺序；拖拽滑块时通过 `clip()` 裁剪左右两侧渲染区域
- **坐标系对齐**：OCR 识别区坐标需经三层变换（模型坐标 → 图像尺寸归一化 → Canvas 物理像素 → CSS 显示像素）才能与 UI 叠加层对齐

**4. 字段级 —— OCR 训练平台空间索引优化**

- **难点**：数百个标注框 + 识别框叠加，鼠标 hover/click O(n) 遍历导致卡顿（500 个标注框场景下 hover 检测 15ms）
- **方案**：构建 **R-Tree 空间索引**，Hit Test 从 O(n) 降至 O(log n)，hover 检测 **15ms → 0.5ms**；`OffscreenCanvas` 在 Worker 中离屏渲染置信度热力图，低置信度区域（< 0.7）红色标记

**Result**：
- 通用比对组件库覆盖 **7 条产品线**，新接入产品接入成本**降低 70%**
- 翻译产品矩阵服务**百万级用户**，覆盖 123 语种、23 种文档格式
- 讯飞智检基于 CGED 2018 TOP1 技术落地，文本校对效率相比人工**提升 80%+**，广泛应用于政府 / 教育 / 企业场景
- OCR Hit Test **O(n) → O(log n)**，500 个标注框场景 hover 检测 **15ms → 0.5ms**

---

#### 项目二：翻译 SaaS 三层架构 —— 大文件分片 + WebSocket 流式

**架构抽象**：将 7 条产品线抽象为「**输入适配 → 任务调度 → 比对输出**」三层架构，统一复用。

**1. 大文件分片上传（视频 / 音频最大 5H / 1GB）**
- 分片大小 2MB，**Web Worker** 计算 MD5 Hash（`crypto.subtle.digest` 在 Worker 中避免主线程卡死），WASM 加速哈希计算至 150-300 MB/s
- 断点续传通过 `localStorage` 记录已上传分片索引，上传成功率 **85% → 99%+**

**2. 实时语音转写 —— AudioWorklet 独立音频线程**
- **决策依据**：ScriptProcessor 在主线程运行，复杂页面 16ms 帧预算被占用会丢帧；AudioWorklet 有独立音频处理线程，零主线程占用——这是平台级架构隔离而非 API 优化
- 双重 VAD（能量阈值 + 过零率）过滤静音帧，上行带宽降低 **50%**
- partial / final 分级渲染——partial 用绝对定位叠在 final 末尾不触发重排，收到 final 原地替换；端到端延迟 **< 800ms**，覆盖 PC / H5 / 微信小程序三端

**3. 浏览器翻译插件（Chrome Extension）**
- `MutationObserver` 监听动态 DOM 增量翻译，处理 iframe 跨域、Shadow DOM 穿透（递归遍历 shadowRoot）
- **TreeWalker 只遍历 Text 节点并就地替换 `nodeValue`**，不改动任何 Element 节点，CSS 选择器 / 事件绑定完全不受影响；monkey-patch `history.pushState/replaceState` 实现 SPA 路由切换后自动重注入

**Result**：上传成功率 **85% → 99%+**；语音转写端到端延迟 **< 800ms**；VAD 过滤使上行带宽降低 **50%**

---

#### 项目三：LLab AI 模型平台 + OCR 规则训练平台

**1. LLab —— iframe 微前端的工程化挑战**
- 各 AI 团队模型 Demo 技术栈异构（Python Streamlit / JS / WebGL），需完全隔离，选 iframe 微前端
- `postMessage` + `BroadcastChannel` 双通道通信：postMessage 处理父子通信，BroadcastChannel 处理跨 iframe 兄弟通信
- 鉴权穿透：通过 postMessage 传递 JWT token，子应用注入 localStorage，避免跨域 Cookie 问题
- 搭建模型在线推理沙箱（输入 / 输出可视化 + 参数调节）、数据集多模态预览、Monaco Editor 代码在线预览
- **模型接入耗时降低 60%+**（3 天 → 1 天），支撑消费 BG 核心 AI 模型基础设施

**2. OCR 训练平台 —— Drag & Drop 模板编辑器**
- **双轨编辑器**：预置模板（配置化，零代码）+ 自定义模板（Drag & Drop 可视化，灵活定义）
- **三层坐标映射**：Canvas 坐标 ⇔ 物理像素（`devicePixelRatio` 适配 Retina）⇔ 模板比例尺；鼠标事件坐标需经三层逆变换才能定位到模板坐标系正确位置
- 嵌套模板（表格内嵌列表）事件穿透通过 `pointer-events: none` + 手动 Hit Test 实现
- **OCR 训练从「算法工程师手动编码」转变为可视化编排，训练迭代效率提升 3 倍+**

**Result**：1024 开发者节（PC / H5 / 微信小程序三端）平稳支撑**数万开发者并发访问**；组件库复用率 70%+，新平台启动成本降低 70%+

---

#### 项目四：在线配音 + 前端监控 SDK

**在线配音制作**
- 基于 **WebAudio API** 设计音频时间轴编辑器，AudioContext 统一时间基准，各轨独立 GainNode 控制音量
- 导出时在 **Web Worker** 线程完成 PCM 帧拼接与 WAV 封装，主线程零阻塞
- 字幕轨与音频轨通过时间码绑定，支持语速 / 音调参数调节，一键导出带字幕混合音频

**从 0 设计并落地六平台前端监控 SDK（< 5KB gzip）**
- **白屏检测**：DOMContentLoaded 后对 9 个均布坐标点调用 `document.elementFromPoint`，全部命中根节点才判定白屏；同时 MutationObserver 监听关键容器首次出现子节点，**两者均触发才上报**，彻底消除骨架屏 / Loading 组件导致的误报
- **LoAF 监控**：`PerformanceObserver('long-animation-frame')` 替代 LongTask，LoAF entry 包含帧内所有脚本执行时长与强制 reflow 信息，粒度远细于 LongTask
- **API 异常**：Monkey-patch `window.fetch` + `XMLHttpRequest.prototype`，宿主代码零感知
- **SourceMap 还原**：CI 打包时 `.map` 上传至内网监控平台（**不随 CDN 发布**，不暴露源码），服务端在线还原到源文件行号
- **发送策略**：`navigator.sendBeacon` 在 `visibilitychange: hidden` 时批量发送；P0 实时告警走 `fetch + keepalive: true`
- **结果**：P0 响应从小时级降至 **5 分钟内**，私有化客户侧故障排查效率 **↑80%+**；**SDK 从讯飞 6 平台沉淀后在 ICBU 阶段快速复用**

---

### 上海优刻得 UCloud（2018.06 - 2020.03）| 前端工程师

**技术栈**：React / Vue / TypeScript / Webpack

负责 UCloud 云计算平台控制台前端开发，参与虚拟机管理、网络配置、存储管理、监控告警等核心模块开发。主导搭建团队级前端基建体系，包括业务组件库（50+ 组件）、脚手架工具、CI/CD 流程规范，研发提效 **30%+**。1.5 年内从初级成长为独立负责核心模块的资深开发，为后续承担 AI SaaS 产品架构设计奠定基础。

---

## 技术演进路径

- **UCloud（2018-2020）**：云控制台 → 工程化基建（组件库 / 脚手架 / CI/CD）
- **科大讯飞（2020-2023）**：AI SaaS 产品化 → 多模态比对引擎 → 浏览器底层（AudioWorklet / pdfium-wasm）→ 监控 SDK
- **阿里 ICBU（2023-2025）**：国际化场景 → 性能工程全链路（LoAF / Smarty Skeleton / LCP链路）→ 国别化架构
- **滴滴 LLab（2025-至今）**：AI 出行场景 → 流式工程范式（Generative UI / 竞态防护）→ Agent 编排平台（DAG / 幂等状态机）

### 三条技术能力线的复用与渐进

- **富编辑器能力线**：讯飞智检 contentEditable → OCR 模板 Drag & Drop → 滴滴 LLab Prompt 变量编辑器（Tiptap），编辑器插件化架构思想和坐标系处理持续复用
- **AI 可视化 / 流式能力线**：讯飞四层比对渲染 → ICBU AI 流式审校 → 滴滴 Generative UI + 推理链可视化，从「展示 AI 结果」到「编排 AI 流程」的递进
- **平台基建能力线**：讯飞监控 SDK → ICBU Smarty Skeleton + 性能工程闭环 → 滴滴 Agent 编排平台，从「可观测」到「性能工程」到「AI 工程效率」的升级
