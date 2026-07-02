### **个人亮点**

- **10年+前端开发经验**，先后任职于**科大讯飞、阿里巴巴、滴滴**等头部企业，具备**从 0 到 1 独立设计并落地可商业化前端复杂系统**的完整能力——3 个 SaaS 平台商业化盈利（合计年 ARR 近千万），所设计的技术系统（骨架屏自动化、监控 SDK、CRDT 协同、AI Agent 编排平台）均成为所在团队长期技术基座，并具备跨 BU 推广与对外分享的技术影响力。

- **AI Native 前端范式建立者**：在 LLM 落地的工程链路上建立了一套可复用的前端范式：① `fetch + ReadableStream` 替代 `EventSource`（让调用方完全控制流的生命周期——支持 POST / Authorization / AbortController 流级中断，EventSource 三者均不具备）；② **括号深度计数**追踪 Function Calling `arguments` 分片完整性 → 动态 React 组件流式实例化（Generative UI）；③ **滑动窗口预生产 + 版本号竞态防护**解决长内容生成断流与旧回包污染；④ **幂等状态机 + sequence 号**保证多节点 Agent SSE 乱序安全；⑤ 深入关注 **MCP（Model Context Protocol）/ 端侧 WebLLM（WebGPU + WASM）**等 AI 前端新方向。独立搭建类 Coze AI Agent 编排平台，**AI 功能上线周期从天级压缩至小时级**，被团队作为 AI 业务标准接入底座。

- **浏览器底层工程专家**：精通 5 类核心浏览器底层 API 并有生产落地经验：**AudioWorklet**（独立音频线程采集 PCM，解决 ScriptProcessor 主线程丢帧）、**pdfium-wasm / FFmpeg.wasm**（C++ WASM 渲染 + 转码，性能较纯 JS 实现提升 1-2 个数量级）、**SharedArrayBuffer + Atomics**（跨 Worker 并行转码）、**CRDT / Yjs**（分布式可交换数据结构，天然支持离线与 P2P）、**ReadableStream + AbortController**（可中断流式消费与背压感知）；关注 **WebTransport（HTTP/3 双向流）**、**WebCodecs**（硬件加速编解码）、**WebGPU**（GPU 加速推理与渲染）等下一代 Web 平台能力；上述每项 API 均源于生产问题驱动，而非技术展示。

- **系统级前端架构设计者**：独立设计 **3 层 Smarty Skeleton 骨架屏自动化系统**（内联 JS SDK 极致性能层 + NPM 运行时学习层 + Chrome 插件 SSR / 首次访问覆盖层，4D 隐式缓存失效无需版本号），CLS **0.15+ → < 0.02**，单页开发成本降低 **95%**；自研前端监控 SDK（**< 5KB gzip**，白屏双重校验防误报 + LoAF + SourceMap 不随 CDN 发布），P0 故障响应降至 **5 分钟内**，并成为部门前端稳定性基线方案；独立落地 **CRDT（Yjs）百人并发多人协同系统**（段落级编辑锁 + IndexedDB 离线持久化）。

- **Web 性能全链路度量与优化专家**：建立「定位 → 拆解 → 优化 → 度量」的工程闭环：**LoAF API** 定位长动画帧 → **Scheduler.postTask** yield 分片拆解主线程占用 → **Smarty Skeleton** 消除 CLS → **PerformanceObserver** 持续度量；主导阿里 ICBU P90 全项达标（**FCP < 1000ms / LCP < 2000ms / CLS < 0.02 / INP < 200ms**），**直接带动发品详情页转化率提升 12%**；性能优化方法论被纳入前端团队 Code Review 必查项。

- **工程效率与团队规模化推动者**：在阿里主导**前端稳定性治理专项**（覆盖 20+ 页面，线上故障发生率 ↓45%），**代码质量门禁**（ESLint 自研规则 30+ 条、提交前 lint-staged、PR 模板强制带性能/可观测性 checklist）；推广 Monorepo + 私有组件库，**新页面接入效率提升 40%**；曾作为面试官参与前端 P6/P7 招聘评审，累计面试候选人 100+，沉淀《前端面试评估手册》供团队复用。

---

### **技术专长**

**AI 流式工程 / LLM 前端落地**
- 设计原则：**调用方控制流的完整生命周期**。`fetch + ReadableStream` 消费 SSE（支持 POST、Authorization Header、AbortController 流级中断、背压感知），而非依赖服务端连接管理的 `EventSource`；高频 token 到来时**增量 Markdown 解析 + rAF 批量 commit**，维护已解析 AST 只 patch 新增节点，避免每帧全量重 parse；落地 **Generative UI**（Function Calling `arguments` 分片 → 括号深度计数追踪 JSON 完整性 → 动态 React 组件实例化，降级 Markdown）；搭建类 Coze **Agent 编排平台**（ReactFlow DAG + SSE 运行时状态推送 + 幂等状态机 + sequence 号防乱序）；多模态输入预处理（Canvas EXIF 矫正 / 图像压缩、AudioWorklet PCM 采集 / VAD 过滤）；关注 **MCP（Model Context Protocol）**、**端侧 WebLLM（WebGPU + WASM 推理）**、**RAG 检索增强前端展示**等新方向。

**浏览器底层工程 / 富媒体处理**
- 设计原则：**在正确的层解决性能问题，而非用应用层 workaround 掩盖**。精通 **Canvas / SVG / WebGL**；熟练使用 **PDF.js、pdfium-wasm**（C++ 编译 WASM，渲染速度超 PDF.js 1-2 个数量级，动态 import ~3MB 按需加载）、**ProseMirror、Monaco Editor、pdf-lib**；**AudioWorklet** 独立音频线程（解决 ScriptProcessor 主线程丢帧根因）；**FFmpeg.wasm** 浏览器端多格式转码（SharedArrayBuffer + Atomics 并行处理长音频）；关注 **WebTransport（HTTP/3 QUIC 双向流，替代 SSE 长连接的更优解）**、**WebCodecs（GPU 硬件加速视频帧处理）**、**WebGPU（端侧 AI 推理 + 大规模渲染）**；大文件分片上传（MD5 秒传 + 断点续传）、虚拟页面池（LRU + revokeObjectURL）、HTTP Range Request 流式播放。

**系统架构设计**
- 精通 **React(18) / Vue(3)**，深入理解 Fiber 调度、Concurrent 渲染、Diff 算法；**Next.js 14 App Router** 实战经验（RSC 流式渲染 + Server Actions + Edge Runtime）；具备**状态机**驱动复杂表单流转（草稿 → 填写中 → 校验中 → 提交中 → 完成，消除 if-else 分支）、**CRDT（Yjs）** 分布式协同（Awareness 光标感知 + 段落锁 + IndexedDB 离线）、**微前端**（qiankun / micro-app / Module Federation 生产落地）、**插件化平台**（iframe 沙箱 + postMessage）、**国别化配置驱动**（Feature Flag + Schema 注入，新增国家只需配置）等复杂架构落地经验；熟练应用 Redux / Zustand / Pinia。

**性能工程**
- 精通 **Core Web Vitals** 全链路（FCP / LCP / CLS / INP / TTFB）；熟练使用 **LoAF API、PerformanceObserver** 定位长动画帧与长任务；**Scheduler.postTask** yield 分片拆解主线程同步大计算；设计 3 层 Smarty Skeleton 自动化骨架屏（CLS 0.15+ → < 0.02）；熟练应用 SSR / 预渲染 / 流式 HTML、WebP / preload / 关键 CSS 内联、render-blocking 消除、Bundle Spliting、Tree Shaking、浏览器多目标降级。

**前端基础设施 / 工程化**
- 设计原则：**基础设施应该降低使用门槛，而非增加使用负担**。精通 **Vite / Webpack** 构建全链路优化（冷启动 / 打包体积 / 缓存策略 / SourceMap 策略）；熟练应用 **Monorepo（pnpm）** + 公司级组件库建设（复用率 70%+）；运行时配置注入（`window.__CONFIG__`）支持私有化多环境免重新构建；自研监控 SDK（< 5KB gzip，白屏检测 / LoAF / SourceMap CI 还原 / API 异常）；精通 **TypeScript**（含类型体操、声明合并、模块扩展）；熟练使用 **Node.js（NestJS）** 处理 BFF 层；**Docker / Nginx** 私有化部署脚本化，支撑交付周期 5-7 天 → 1-2 天。

---

### **项目经历**

#### **阿里巴巴 ICBU 海外商品域 & 商增域**（2023.12 - 2025.04）
**技术栈**：React18, TypeScript, Vite, Monorepo (pnpm), Next.js 14, Node.js/BFF, Performance API, IndexedDB, Chrome 插件, SSR, 数据埋点, qiankun 微前端

**项目背景 (Situation)**：ICBU 是阿里面向全球买卖家的 B2B 跨境电商平台，月活买家数千万，覆盖 200+ 国家；我所在的海外商品域核心命题是**让商品有质量地规模化上翻**（AI 搬品 / AI 极简征品），商增域核心命题是**提升新卖家入驻转化与留存**。核心挑战三重：发品属性体系庞大（百级字段），历史表单单文件 3000+ 行，状态管理混乱；各目标国入驻流程、认证方式、支付渠道均不同，一套代码难以覆盖多国差异；核心交易页面 Web 性能不达标，INP 超 500ms，LCP 超 4s，**直接拉低海外买家发品详情页转化率 9 个百分点**（A/B 实验前后对比）。

**核心难点**：
- **INP 超标的根因**：商品管理页大量同步计算阻塞主线程，关键洞察：**用 LoAF API 才能精准定位「哪个动画帧里哪段脚本阻塞了输入响应」**，而非仅用 LongTask API 得到粗粒度时间段；
- **骨架屏的根本矛盾**：千人千面页面「构建期不知运行时布局」——构建时不存在 DOM，运行时渲染完毕何需骨架，这是一个必须在系统层解决的矛盾，而非靠约定规避；
- **多国差异的腐化路径**：税制 / 支付 / 合规规则散落 if-else 中，每次新增国家都在核心逻辑打补丁，腐化是必然结果，需要架构层隔离；
- **稳定性治理的"破窗效应"**：20+ 老旧页面无监控、无降级、无告警，任何一处崩溃都直接打击 GMV。

**我的职责 (Action)**：

1. **主导 Core Web Vitals 全链路性能优化**，P90 达到 **FCP < 1000ms / LCP < 2000ms / CLS < 0.02 / INP < 200ms**，**A/B 实验验证带动发品详情页转化率 +12%，月 GMV 增量预估千万级**：
   - **LCP**：SSR 首屏直出 + Hero 图 WebP / preload；消除 render-blocking 脚本；关键 CSS 内联；图片懒加载 + IntersectionObserver；
   - **INP**：**LoAF API** 精准定位长动画帧（区别于 LongTask，LoAF 能关联到具体的输入延迟），**Scheduler.postTask** 将同步大计算拆分为 yield 分片，事件处理函数只触发最小 UI 更新，将「响应 → 动画 → 空闲」三阶段严格分离；
   - **CLS**：依托 Smarty Skeleton 自动化方案精准预占位，彻底消除内容加载后的布局偏移；
   - **TTFB**：BFF 层 Node.js NestJS 聚合接口，减少瀑布请求，核心接口 RT 从 800ms 降至 220ms。

2. **独立设计并落地 3 层 Smarty Skeleton 自动骨架屏系统**——破解「构建期不知运行时布局」的根本矛盾，核心思路：**将首次渲染作为「学习投资」，从第二次访问起骨架屏自动还原、精准匹配、零人工维护**：

   - **内联 JS SDK（极致性能层）**——覆盖第 2 次起的所有访问：注入 HTML `<head>`，在 bundle 解析前执行；同步读 **localStorage** 元数据（宽高 / hasCache）立即创建尺寸精确的占位容器，再异步读 **IndexedDB** 取骨架数字数组（每块 `[left%, top%, w%, h%, type]` 五元组，百分比坐标天然响应式），动态生成占位节点；框架水合前骨架已就位，首次像素 **< 500ms**，白屏彻底消除；

   - **NPM 运行时学习层**——解决「谁来生成骨架数据」的问题：首次真实渲染完成后静默 BFS 遍历 DOM，**requestIdleCallback 40ms 预算/帧**时间切片（空闲时间执行，不占任何主线程帧预算）；对每个节点计算与父节点矩形交集（clip），文本节点减 padding 贴合真实文字区域；**4 路并联叶子识别**（hasChildText / img·input·button 枚举 / 背景图渐变 / `data-skeleton-block` 标记）任一满足即停止递归；邻近块合并（minGap 阈值）消除密集文本碎条；结果双写 localStorage（元数据）+ IndexedDB（完整数组）；**4D 隐式缓存失效**（key = `path + componentId + innerWidth + innerHeight`），视口变化自然 cache miss，无需显式版本号，componentId 扩展千人千面；

   - **Chrome 插件预生成层**——覆盖两个学习层无法触达的盲区：SSR 场景（服务端无 DOM，无法运行时测量）和首次访问（新用户无缓存只能看白屏）；插件在真实页面叠层可视化预览骨架，开发者调整后一键保存至项目约定路径，提交 git 后 SSR 直接读取，彻底消除首次白屏；

   - **架构权衡**：评估过业界方案 `react-content-loader`（需手写 SVG，不适合千人千面）/ `react-placeholder`（仅图片型占位，不支持复杂布局）/ `react-loading-skeleton`（无学习能力，需硬编码）/ **结论：现有方案均无法在"零人工维护 + 千人千面 + 极致性能"三角中占两角以上，必须自研**；

   - **结果**：CLS **0.15+ → < 0.02**，单页开发成本 **0.5 人日 → 5 分钟（↓95%）**，全团队 **20+ 页面**接入，**作为部门前端基建标准方案被推广到兄弟 BU**（考拉 / Lazada 共享项目），**我作为 Owner 对外做了 3 次技术分享**。

3. **独立主导发品表单架构升级**——核心决策：用**有限状态机**取代散落的 if-else，决策依据：**if-else 是状态转移的隐式编码，状态越多 if-else 越难穷举**（实测该表单历史 if-else 嵌套最深达 7 层，新人维护时几乎无法理解所有路径）；FSM 将每个状态允许的事件与转移显式声明，组件只根据当前状态渲染，新增状态不影响已有路径；3000+ 行大文件按模块拆解为 < 500 行/模块，统一 Design Token 消除样式碎片化，建立灰度发布 + 异常监控机制，核心模块代码量 **↓60%+**；建立 Form 组件层公共契约，**新表单开发周期从 1 周缩短至 2 天**。

4. **设计国别化配置驱动架构**——核心原则：**核心业务组件对国别无感知**；路由层读取 `countryCode` 动态注入差异化 Schema（表单字段 / 校验规则 / 支付渠道 / 合规提示），Feature Flag 控制功能开关；**新增国家只需新增配置文件，不改任何业务代码**（越南/泰国上线从原 2 周压缩至 3 天）；落地 OCR 证件识别自动填充，多国本地支付 SDK 统一封装为 `PaymentContext`。

5. **落地 AI 属性补全与智能搬品**，商家输入标题后 500ms 防抖触发 AI 接口，推荐属性以浮层展示；**AI 搬品页设计批量选品 + 类目映射可视化编辑器**，属性冲突实时高亮，**搬品效率提升 3 倍，AI 采纳率 67%**（数据来自业务方埋点统计）。

6. **建设数据埋点体系**——设计原则：**埋点基础设施不应对业务组件有侵入性**；曝光埋点基于 **`IntersectionObserver`** 声明式监听（组件标注 `data-track-expose` 属性即自动采集，替代高频 `scroll` + `getBoundingClientRect` 采样，主线程零额外负担）；点击埋点用**事件委托**在根节点单一监听，不在每个元素绑定 handler，列表渲染场景内存节省显著；A/B 实验分组信息在 HTML 注入时写入 `window.__EXPERIMENTS__`（与 `window.__CONFIG__` 同一 Nginx 注入管道），组件通过 `useExperiment` Hook 无感知读取，无需业务代码感知实验逻辑；埋点数据内存聚合后通过 **`navigator.sendBeacon`** 在 `visibilitychange: hidden` 时批量发送，保证页面关闭时数据不丢失；接入漏斗分析平台，**精准定位泰国/越南用户入驻断点（卡在 KYC 步骤），改造后转化率 +18%**。

7. **主导前端稳定性治理专项**（覆盖 20+ 页面）——复用讯飞阶段沉淀的监控 SDK（统一团队稳定性基线），接入告警值班（钉钉 + 邮件双通道）；建立**前端错误分级标准**（P0 全量用户受影响 / P1 5% 以上 / P2 个例）与**应急响应 SOP**（5 分钟止血 / 30 分钟定位 / 2 小时修复）；推动**灰度发布 + 异常熔断**（错误率超阈值自动回滚）；**专项上线后线上 P0/P1 故障发生率 ↓45%**。

8. **建立前端代码质量门禁体系**——基于 ESLint + 自研规则（30+ 条覆盖性能、可观测性、可访问性）+ Stylelint + Commitlint + lint-staged；强制 PR 模板带「性能影响 / 可观测性 / 灰度策略 / 监控配置」checklist；推动 TypeScript strict 模式全量开启（**类型覆盖率 85% → 96%**），编译期消除大量潜在 bug。

**项目成果 (Result)**：
- **业务价值**：Core Web Vitals 优化带动**发品详情页转化率 +12%**（A/B 实验验证，月 GMV 增量千万级）；AI 搬品**采纳率 67%、效率提升 3 倍**；国别化改造使**越南/泰国上线周期从 2 周 → 3 天，新商家入驻转化率 +18%**；
- **技术价值**：Smarty Skeleton 落地，CLS **0.15+ → < 0.02**，单页开发成本 **↓95%**，**作为部门前端基建标准方案跨 BU 推广**；表单架构升级，核心模块代码量 **↓60%+**，**新表单开发周期 1 周 → 2 天**；
- **稳定性**：监控 + 灰度 + 熔断体系上线后，**线上 P0/P1 故障发生率 ↓45%**，P0 平均止血时间 **< 5 分钟**；TypeScript strict 覆盖率 **85% → 96%**；**沉淀为前端部门稳定性治理基线方案**；
- **影响力**：作为 Owner 对 Smarty Skeleton / 稳定性治理对外做了 **3 次技术分享**，**1 篇内网技术博客阅读量 8000+**。

---

#### **滴滴 llab AI 出行体验**（2025.06 - 至今）
**技术栈**：React18, TypeScript, Next.js 14, 微信小程序, SSE, Function Calling, ReactFlow, Canvas, WebGPU, LBS/POI 服务, 多说话人 TTS, WebTransport

**项目背景 (Situation)**：llab 是滴滴探索 AI + 出行场景融合的创新实验室，核心命题：**如何让 AI 能力真正融入出行路线，而非停留在对话框**；同时需要探索工程侧如何支持产品快速搭建复杂多步骤 AI 功能，减少工程排期依赖。当前行中导游灰度用户 **DAU 12 万+，次日留存 41%**；在哪儿问问已接入小红书 / 抖音等兴趣地点挖掘场景，**首屏搜地点成功率 87%**。

**核心难点**：
- **流式 JSON 不完整解析**：Function Calling `arguments` 按 chunk 分片到达，直接 `JSON.parse` 必然抛异常；需要一种在 O(n) 时间内判断 JSON 是否合法闭合的轻量方案；
- **Agent SSE 乱序**：后端多节点并行执行导致 SSE 事件乱序到达，画布状态如果按到达顺序更新会出现闪烁和状态回退；
- **出行内容竞态**：用户绕路改道时，旧路线对应的 SSE 回包可能在 `AbortController` 触发后仍异步到达，需要「毒化旧响应」而非「等待旧响应结束」；
- **15s 长推理体验**：传统 loading 状态下用户无法区分「AI 在思考」和「服务挂了」，15s 的感知等待接近用户放弃阈值；
- **小程序的 WebAssembly 兼容性**：微信小程序 JS-Skeleton 弱于浏览器，AudioWorklet/WebGPU 等能力受限，需要降级方案。

**我的职责 (Action)**：

1. **独立从 0 到 1 搭建类 Coze AI Agent 工作流编排平台**：
   - 基于 **ReactFlow** 的可视化 DAG 编辑器，支持节点拖拽 / 连线 / 端口类型合法性校验（string / object / array / any，不合法连线实时标红）；节点类型覆盖 LLM 对话、工具调用（搜索 / POI / 天气）、条件分支、循环、人工审核；
   - **运行时可视化核心设计**：SSE 实时推送节点状态变更，前端维护 `nodeStatus Map` 驱动节点样式（done 绿 / failed 红 / running 流光动画）；乱序 SSE 用**幂等状态机**处理——状态只能单向流转，done / failed 后忽略后续同节点事件；SSE event 携带 `sequence` 号，乱序到达时按 sequence 排序后重放；
   - 工作流 JSON Schema 统一序列化，支持导入导出与版本管理；**AI 功能上线周期从天级压缩至小时级**；**平台上线后团队内 5 个 AI 业务（行中导游 / 在哪儿问问 / 智能客服 / 行程规划 / 司机助手）均基于该平台搭建**；
   - **架构权衡**：评估过 Dify / Coze 成熟产品直接接入，结论：**滴滴内部对算子扩展性、数据合规、模型自主可控有强诉求**，开源方案不满足；自研的核心是**编排引擎 + 状态机运行时 + 节点算子 SDK**三件套，已封装为部门 AI 中间件。

2. **「行中导游」—— 出行 AI 播客的流式内容调度与 Generative UI 工程**：
   - **播放连续性**——借鉴视频预加载缓冲模型，设计**滑动窗口预生产策略**：始终维护 3 段 ≥ 15 分钟的内容缓冲，消费到第 2 段时自动触发下一批 SSE，消费速度永远慢于生产速度，彻底消除断流；
   - **竞态防护**——`AbortController` 立即中断旧 SSE（而非等待其自然结束），清空待播队列；引入**版本号校验**：每次路线变化递增版本号，SSE 回调收到响应时先校验版本号是否与当前一致，旧版本响应直接丢弃，解决 abort 后异步回包污染；
   - **TTS 串行队列**——双角色（原野 / 晓曼）对话 TTS 并发请求回包顺序不保证；维护**串行 Promise 队列**，按脚本角色序依次 resolve 音频 chunk 后拼接，保证播放顺序与脚本完全一致，同时支持路线进度联动自动切景点、手动切换 / 暂停 / 拖拽；
   - **Generative UI**——Function Calling `arguments` 分片到达，用**括号深度计数**（O(n) 逐字符扫描，`{` +1 / `}` -1，计数归零时 JSON 合法闭合）追踪完整性，仅合法闭合时实例化 `render_poi_card / render_route_map / render_tip_block` 组件；降级 Markdown 路径采用**增量解析 + rAF 批量 commit**，维护已解析 AST，每帧只 patch 新增 token 对应节点，帧率稳定。

3. **「在哪儿问问」—— 多模态 Agent 推理链路的前端体验工程**（微信小程序）：
   - **长推理等待**——关键洞察：**让等待「可见且有意义」比缩短等待更重要**；15s 推理过程通过 SSE 实时流式渲染（多轮搜索 / 图像细节分析均可见），用户看见 AI 在思考而非等待结果；推理完成后手风琴动画收起推理链，切换为地图卡片 + Markdown 结果态，**用户调研感知等待时长从 15s 缩短至 7s**（自报数据）；**次日留存 +18%**（埋点验证）；
   - **动态分流 UI**——同一入口 3s 与 15s 响应若使用相同 UI，慢场景用户会误判为出错；根据**首包是否含推理事件**动态分流：有推理 → 展示推理链滚动，无推理 → 骨架屏快速占位，两条路径收敛到相同结果态，分流逻辑对用户完全透明；
   - **EXIF 矫正**——iOS 相机照片 EXIF 方向标记导致模型接收旋转 90° 图片，识别准确率明显下降；Canvas 读取 `Orientation` 字段先矫正再压缩，确保模型输入图片方向正确；**图片搜地点首屏成功率从 62% 提升至 87%**。

4. **关注与探索 WebLLM 端侧推理**——评估在 WebGPU 上跑 1.5B ~ 3B 参数模型的能力（**WebLLM** 项目），为「断网/弱网场景行中导游兜底」做技术储备；目前落地 7B 模型在端侧首 token 延迟 < 1.5s（Mac M1 基准），**为后续弱网降级方案铺垫**。

5. **建立团队 AI 前端开发规范**——统一 SSE/Function Calling 消费范式（`useChatStream` Hook + Generative UI 组件注册协议），**降低 AI 业务前端开发门槛**；沉淀《AI 前端工程手册 v1.0》供团队内 6 名前端工程师学习，**新人首次接 AI 业务开发周期从 1 周缩短至 2 天**。

**项目成果 (Result)**：
- **业务价值**：行中导游实现讲解文字 + 双人语音播客 + AI 博客三合一，**DAU 12 万+，次日留存 41%**；在哪儿问问**首屏搜地点成功率 87%，次日留存 +18%**；Agent 编排平台**支撑 5 个 AI 业务快速上线**；
- **技术价值**：滑动窗口策略消除断流，**路线联动播放实现沉浸式导游体验**；Generative UI 建立 Function Calling → buffer 拼接 → 动态组件实例化的前端范式，**成为团队 AI 内容渲染的标准方案**；**端侧 WebLLM 弱网兜底**完成技术验证；
- **影响力**：建立团队 AI 前端开发规范 + 《AI 前端工程手册 v1.0》，**新人 AI 业务上手周期 1 周 → 2 天**；在团队内 2 次分享 AI 前端工程化经验。

---

#### **科大讯飞 ToB & ToC 双线 SaaS 矩阵**（2018.07 - 2023.07）
**技术栈**：React18, TypeScript, ProseMirror, Yjs, WebSocket/SSE, AudioWorklet, WebAudio API, Canvas, WebGL, Web Worker, pdf-lib, Monaco Editor, pdfium-wasm, FFmpeg.wasm, 自研前端监控 SDK

**项目背景 (Situation)**：公司 AI 能力（语音转写、OCR 识别、多模态翻译、TTS 合成）缺乏面向企业客户与消费者的产品载体，需同时支撑**两条产品线**：ToB 企业级（智能翻译、质检、OCR 规则训练、电子签——大体量文档处理 / 多人协作 / 合规签署）和 ToC 消费级（网页翻译、实时语音转写、在线配音——无需安装、即开即用）；**6 个 SaaS 平台累计服务 1000+ 企业客户、千万级 C 端用户**；传统桌面客户端部署成本高、迭代慢，业界缺乏覆盖上述诉求的成熟纯前端方案，制约 AI 能力的商业化速度。

**核心难点**：
- **协同冲突的根本矛盾**：多译员同时编辑同一段落必然产生冲突，OT 算法需要中央服务器做变换，与私有化部署（网络隔离）和离线使用场景根本冲突；
- **大文件渲染的内存模型**：百页 PDF 全量渲染等价于在内存中维护 N 张 Canvas bitmap，内存溢出是必然结果，需要设计「按需存在」的内存模型；
- **网页翻译的无侵入注入**：ToC 网页翻译必须在不破坏目标页面任何 DOM 结构、CSS 样式、JS 事件的前提下完成文本替换，SPA 路由切换后还需自动重注入，不能依赖插件权限；
- **私有化场景的可观测性**：6 个平台 + 多套私有化环境，客户侧出现问题时没有任何遥测数据，排查效率极低；
- **多端一致性**：H5 / PC Web / 微信小程序需共享同一份核心业务逻辑，重复实现成本高且行为不一致。

**我的职责 (Action)**：

1. **独立设计并落地 CRDT 多人实时协同编辑系统**——核心架构决策：选型 **Yjs（CRDT）** 而非 OT，决策依据：**CRDT 操作满足交换律和结合律，合并结果与操作到达顺序无关**，天然支持离线编辑和 P2P；OT 需要中央服务器对每对并发操作做变换，在私有化网络隔离场景下无法保障可用性；具体实现：Awareness 协议广播光标 / 选区实时感知；段落级编辑锁（编辑时广播锁定 Op，其他端 UI 置灰该段落，释放时广播解锁）防止重复翻译；增量 Op（< 1KB）+ 服务端广播支持百人并发；IndexedDB 持久化保障断线后自动恢复；**系统在数十家企业私有化客户侧稳定运行 4 年+，零数据丢失事故**。

2. **设计并实现浏览器端全模态文档处理引擎**，支持 23 种文档格式（PDF / DOCX / PPT / XLS / SRT 等）、8 种音频、9 种视频格式，文件支持 1GB+——核心架构决策：**服务端统一转换管道**（所有格式转 PDF，前端维护一套渲染逻辑，格式差异在服务端消化）；**虚拟页面池**（仅维护可视区 ±2 页，LRU 淘汰 + revokeObjectURL 及时释放，内存占用从 O(n) 降至 O(1)）；Web Worker 异步解析（解码不阻塞渲染线程）；HTTP Range Request 按需加载（大文件不全量下载）；后期引入 **pdfium-wasm** 替代 PDF.js（C++ 编译 WASM，百页渲染耗时降低 60%+，动态 import ~3MB 按需加载）；引入 **FFmpeg.wasm** 实现浏览器端转码（短音频 < 100ms，长音频 SharedArrayBuffer + Atomics 并行）；大文档首页可见时间从 **8s 降至 2.4s 以内（P75）**，内存峰值降低 **60%+**。

3. **构建所见即所得文档编辑能力**，基于 ProseMirror 打造富文本编辑内核，维护文档 AST 与渲染层双向同步；DOCX / XLSX / PPT 采用 JSZip + xml2js 结构化解析与二进制序列化导出——关键原则：**只修改目标 XML 节点，不碰其他节点**，格式还原度 **95%+**；段落级双栏译文对照编辑器（Myers Diff 字符级高亮 + react-window 虚拟列表），万级段落无卡顿。

4. **落地实时语音转写前端链路**——核心架构决策：**AudioWorklet** 替代 ScriptProcessor，原因：ScriptProcessor 在主线程运行，复杂页面 16ms 帧预算被占用会丢帧；AudioWorklet 有独立音频处理线程，零主线程占用；双重 VAD（能量阈值 + 过零率）过滤静音帧（上行带宽降低 **50%**）；partial / final 分级渲染——partial 用绝对定位叠在 final 末尾不触发重排，收到 final 原地替换；端到端延迟 **< 800ms**，字随声出；**在 1024 开发者节主论坛演讲中实测万人同屏转写零延迟**。

5. **构建在线配音制作能力（ToC）**，基于 **WebAudio API** 设计音频时间轴编辑器，支持多段 TTS 合成片段的拖拽排列与波形可视化预览；`AudioContext` 调度多轨音频（配音轨 + 背景音乐轨），各轨独立 `GainNode` 控制音量；导出时在 **Web Worker** 线程完成 PCM 帧拼接与 WAV 封装，主线程零阻塞；字幕轨与音频轨通过时间码绑定，每段 TTS 合成后拿到精确时长，字幕轨按时间码偏移渲染，逐句校验误差，支持语速 / 音调参数调节，一键导出带字幕混合音频。

6. **实现网页翻译（ToC，无需插件）**——核心挑战：在不破坏目标页面任何 DOM 结构与 CSS 选择器的前提下完成文本替换；方案：脚本注入目标页面后，**TreeWalker** 只遍历 Text 节点并就地替换 `nodeValue`（不改动任何 Element 节点，CSS 选择器、事件绑定完全不受影响）；**MutationObserver** 监听 SPA 的动态 DOM 变化，新增节点自动译文填充；路由切换通过 monkey-patch `history.pushState / replaceState` + 监听 `popstate` 事件触发**自动重注入**，支持所有主流 SPA 框架；跨域场景用 **postMessage 桥接通信**，iframe 内页面翻译结果回传宿主窗口；**产品在未做付费推广的情况下凭借口碑自然增长，3 年累计 C 端用户 500 万+**。

7. **搭建 OCR 规则训练平台的图像标注工具**，Canvas 实现矩形框选、多边形标注及自由缩放拖拽；**坐标系变换矩阵**是关键：鼠标事件坐标 ÷ 缩放比例 − 偏移量 = 原图像素坐标，逆变换确保标注框在任意缩放比下精准映射回原图，不因显示比例产生误差；基于 **Command 模式**封装每个操作的 `execute / undo` 函数，维护操作栈实现无限步撤销 / 重做；标注数据与训练任务绑定，支持批量审核与置信度可视化，构成从数据标注到模型迭代的完整 MLOps 前端闭环。

8. **交付电子签全链路**，Canvas 三阶贝塞尔曲线手写签名（采集压力点序列拟合，平滑无锯齿，支持触控）；pdf-lib 写入签章坐标，SHA-256 哈希锁定文档完整性；有限状态机管理多方签署流程（顺序签 / 并行签，状态：待发起 → 签署中 → 完成 / 拒签 / 过期），WebSocket 实时推送进度，动态水印 + 防截图保障合同安全；**合同签署周期从平均 3 天压缩至 5 分钟**。

9. **负责文本校对与合规引擎**，三层混合规则（关键词黑名单 → 正则匹配 → AI 语义），结果合并——以字符区间为 key 做并集，相同区间取最高风险等级去重渲染；300ms 防抖 + SSE 流式 + 字符级 Diff 高亮，支持逐条 Accept / Reject；审计日志完整留存，支持合规报告一键导出。

10. **建设 AILab 能力集市**，Monaco Editor + 虚拟目录树实现代码仓库在线预览（对齐 GitHub Web IDE）；**架构核心**：iframe 沙箱 + postMessage 协议——平台与 Demo 约定消息格式，AI Demo 以 JSON 配置零代码接入，新能力上线**不改动平台代码**，平台与内容完全解耦。

11. **沉淀跨平台公共组件库与工程规范**，抽象文件上传器、标注画板、AI 流式输出面板、媒体播放器、音频时间轴等核心组件，复用率 **70%+**；`window.__CONFIG__` 运行时注入（Nginx 在 HTML `<head>` 注入不同 env 对象），免重新构建支持多套私有化环境；Nginx 反代 + CSP 白名单配置脚本化，docker-compose 统一编排，私有化部署交付周期 **5-7 天 → 1-2 天**；制定 Code Review 标准、分支策略与性能预算机制，保障 4 人团队多平台并行高质量交付；**作为 4 人前端小组的 Tech Lead**，承担任务分配、Code Review 主体责任、新人带教。

12. **从 0 设计并落地六平台前端监控 SDK**——设计约束：私有化环境极致轻量（**< 5KB gzip**），零第三方依赖，不影响宿主页面任何性能指标：
    - **错误采集**：全局 `onerror` + `unhandledrejection` 双入口覆盖同步错误与未捕获 Promise，捕获后在**微任务队列异步上报**，不阻塞当前执行帧；
    - **API 异常**：Monkey-patch `window.fetch`（包装 Promise chain，在 reject 或非 2xx 时采集 url / status / 耗时）和 `XMLHttpRequest.prototype.open / send`（劫持 `onreadystatechange`），宿主代码**零感知**；
    - **白屏检测**：`DOMContentLoaded` 后对 9 个均布坐标点调用 `document.elementFromPoint`，**全部命中根节点**（body / html）才判定白屏；同时 MutationObserver 监听关键容器首次出现子节点，**两者均触发才上报**，彻底消除骨架屏 / Loading 组件导致的误报；
    - **LoAF 监控**：`PerformanceObserver('long-animation-frame')` 替代 `LongTask`，原因：LoAF entry 包含帧内所有脚本执行时长与强制 reflow 信息，粒度远细于 LongTask 仅给出任务总时长；
    - **SourceMap 还原**：CI 打包时将 `.map` 上传至内网监控平台（**不随 CDN 发布**，不暴露源码结构），error stack 由服务端 `source-map` 库在线还原到源文件行号，告警附带可跳转源码链接；
    - **发送策略**：错误聚合去重后，通过 **`navigator.sendBeacon`** 在 `visibilitychange: hidden` 时批量发送（不阻塞页面关闭），P0 实时告警走 `fetch + keepalive: true`；接入钉钉 / 邮件告警，**P0 问题响应从小时级降至 5 分钟内**。

**项目成果 (Result)**：
- **业务价值**：3 个平台盈利，合计年 ARR **近千万**；6 个 SaaS 平台累计服务 **1000+ 企业客户、500 万+ C 端用户**；合同签署周期 **3 天 → 5 分钟**；私有化部署周期 **5-7 天 → 1-2 天**；
- **性能指标**：大文档首页可见时间 **8s → 2.4s 以内（P75）**，内存峰值 **↓60%+**，pdfium-wasm 渲染耗时 **↓60%+**，DOCX / XLSX / PPT 格式还原度 **95%+**；实时语音转写端到端延迟 **< 800ms**，VAD 静音过滤使上行带宽降低 **50%**；
- **稳定性**：SDK 上线后 P0 响应从小时级降至 **5 分钟内**，私有化客户侧故障排查效率 **↑80%+**，**SDK 沉淀为部门标准监控方案并在 ICBU 阶段快速复用**；
- **效率与复用**：组件库复用率 **70%+**，新平台启动成本降低 **70%+**，**成为部门前端架构标准底座**；
- **管理**：4 人前端小组 Tech Lead，承担任务分配、Code Review、新人带教。

---

### **架构决策与技术权衡（高频被问）**

| 决策点 | 备选方案 | 我的选择 | 决策依据 |
|--------|---------|---------|---------|
| 骨架屏方案 | react-content-loader / react-placeholder / react-loading-skeleton / **自研 3 层系统** | 自研 | 现有方案均无法在「零人工维护 + 千人千面 + 极致性能」三角中占两角以上；自研的 3 层架构分别覆盖性能/学习/兜底三个独立问题域 |
| 协同算法 | OT / **CRDT（Yjs）** | CRDT | 私有化部署场景下中央服务器不可达，OT 无法工作；CRDT 操作满足交换律结合律，天然支持离线 + P2P |
| SSE 消费方式 | EventSource / **fetch + ReadableStream** | fetch + ReadableStream | EventSource 不支持 POST / Authorization / AbortController，无法满足生产需求；fetch 三者均支持且感知背压 |
| 渲染引擎 | PDF.js / **pdfium-wasm** | pdfium-wasm | PDF.js 百页以上主线程占用高且无法并行；pdfium-wasm C++ 编译 Worker 运行，速度快 1-2 个数量级，代价 ~3MB 包体可动态 import 解决 |
| 音频处理 | ScriptProcessor / **AudioWorklet** | AudioWorklet | ScriptProcessor 在主线程运行，复杂页面 16ms 帧预算被占会丢帧；AudioWorklet 平台级音频线程隔离，零主线程占用 |
| AI 业务架构 | 直接用 Dify / Coze / **自研 Agent 编排** | 自研 | 滴滴对算子扩展性 / 数据合规 / 模型自主可控有强诉求，开源方案不满足；自研核心是编排引擎 + 状态机运行时 + 节点算子 SDK |
| 函数调用渲染 | 全量 JSON 解析 + 重渲染 / **括号深度计数 + 增量流式组件** | 括号深度计数 | arguments 分片到达，全量解析必然崩溃；O(n) 括号计数追踪完整性，仅合法闭合时实例化，parse 失败降级 Markdown |
| 状态机 vs if-else | 散落 if-else / **有限状态机（XState 风格自研）** | 状态机 | 状态超过 5 个后 if-else 嵌套不可维护（实测历史代码最深 7 层）；状态机显式声明状态-事件-转移，新增状态不影响已有路径 |
| 智能体状态同步 | 按到达顺序更新 / **幂等状态机 + sequence 号** | 幂等 + sequence | 多节点并行导致 SSE 乱序；状态机只允许单向流转，sequence 号保证乱序到达也能正确重放 |
| 多端代码复用 | 多套实现 / **业务模型统一 + 渲染层适配** | 模型统一 + 适配 | H5 / 小程序 / PC Web 渲染层 API 差异大，但业务逻辑（数据流 / 状态机 / 校验规则）应统一；适配层只处理平台差异 |
| 性能监控 | LongTask / **LoAF API** | LoAF | LongTask 只能给出粗粒度时间段；LoAF 关联到具体输入延迟和帧内脚本，可精准定位 INP 根因 |
| 包管理 | Multirepo / **Monorepo（pnpm）** | Monorepo | 跨项目组件复用 + 原子化发布 + 统一 lint / tsconfig 标准化；6 平台多团队并行场景下，组件改动一次即可全量生效 |
| 灰度发布 | 全量发布 / **分国家 + 分用户群灰度** | 灰度 | 海外多国业务，某一国家上线问题不应影响其他国家；先 1% 灰度 → 10% → 50% → 100%，每阶段观察监控指标 |
| LLM 流式渲染性能 | 每 token setState / **rAF 批量 commit + 增量 AST patch** | rAF 批 commit | 每 token setState 在高频场景下帧率会掉到 30fps 以下；rAF 批 commit 维持 60fps，增量 patch 只更新新增 token 对应节点 |

---

### **团队影响与技术品牌**

| 维度 | 成果 |
|------|------|
| **技术分享** | 阿里阶段对 Smarty Skeleton / 稳定性治理对外做 3 次技术分享；滴滴阶段 2 次团队内 AI 前端工程化分享 |
| **技术博客** | 内网技术博客 1 篇（Smarty Skeleton 设计）阅读量 8000+；正在筹备公众号 / 掘金输出 AI 前端工程化系列 |
| **代码评审** | 阿里阶段作为前端稳定性治理 Owner 月均评审 PR 50+，滴滴阶段作为 Agent 平台 Owner 月均评审 PR 30+ |
| **招聘贡献** | 阿里 / 滴滴阶段作为前端面试官，累计面试候选人 100+，沉淀《前端面试评估手册》供团队复用 |
| **新人带教** | 滴滴阶段沉淀《AI 前端工程手册 v1.0》，**新人首次接 AI 业务开发周期从 1 周缩短至 2 天** |
| **开源关注** | 长期关注 Yjs / pdfium-wasm / FFmpeg.wasm / WebLLM / MCP 等开源项目演进；曾在团队内部分享中解读 Yjs 源码设计 |
| **专利** | 申请中：「一种基于 IndexedDB 的客户端骨架屏数据预加载方法及装置」（结构化梳理后撰写） |
| **方法论沉淀** | 沉淀《前端稳定性治理 SOP》《性能优化 Checklist》《AI 前端工程手册 v1.0》三份团队文档 |

---

### **技术 Portfolio（面试可演示）**

- **collab-editor**（React18 + TypeScript + Yjs + TipTap + WebRTC）：多人实时协同编辑器完整 demo。
  - **CRDT 协同**：Yjs UndoManager 接管 History，协同感知撤销（只回滚本人 Op，不影响他人）；
  - **传输层**：优先 BroadcastChannel（同机器多 Tab 零延迟），降级 WebRTC P2P 信令，无需自建服务端；
  - **段落感知**：自定义 ProseMirror DecorationSet 插件，将他人正在编辑的段落渲染为彩色边框；
  - **工程细节**：useMemo 保证 ydoc/provider 引用稳定；peersRef 解决 Plugin 闭包陈旧引用；仅段落 pos 变化时广播，避免频繁 Awareness 更新。

- **smart-skeleton**（TypeScript + Vite + Chrome Extension API）：3 层骨架屏自动化系统 demo，可视化展示 SDK / NPM / Chrome 插件三层协同。
  - 重点演示 4D 缓存命中逻辑 + 千人千面 componentId 扩展 + SSR 场景插件预生成。

- **generative-ui-runtime**（React18 + TypeScript + Vite）：Generative UI 运行时 demo，模拟 Function Calling 分片 → 括号深度计数 → 动态组件实例化全链路。
  - 重点演示 rAF 批 commit + 增量 AST patch 对比每 token setState 的帧率差异（30fps vs 60fps）。

- **ai-agent-orchestrator**（React18 + TypeScript + ReactFlow + SSE）：类 Coze 编排平台 demo，含可视化 DAG 编辑、节点状态实时推送、乱序 sequence 号处理。

- **webllm-poc**（WebGPU + WebLLM）：端侧 LLM 推理 POC，1.5B / 3B / 7B 模型在浏览器内推理性能测试。

---

## 面试深挖速查

| 方向 | 高频问题 | 核心答案（架构视角） |
|------|---------|---------|
| 骨架屏 | 为什么要 3 层而不是直接 NPM 包？ | 3 层覆盖 3 个独立场景：SDK 层覆盖第 2+ 次访问（性能极致）；NPM 层解决「谁来生成数据」；插件层覆盖 SSR 和首次访问两个运行时 SDK 到不了的盲区；缺任何一层都有覆盖漏洞 |
| 骨架屏 | 骨架屏自动化怎么保证和真实内容一致？ | 运行时 DOM 遍历：真实渲染后对关键节点做 getBoundingClientRect，计算与父节点矩形交集（clip）生成百分比骨架块；尺寸来自用户真实渲染，精准匹配 |
| 骨架屏 | 缓存怎么失效？为什么不用版本号？ | 4D key（path + componentId + innerWidth + innerHeight）隐式失效：视口变化自然 cache miss 触发重新学习，无需显式版本号；版本号方案需要业务方主动维护，维护成本高且容易忘 |
| 骨架屏 | SDK 怎么不阻塞首屏？ | BFS + requestIdleCallback 40ms 预算/帧时间切片，学习过程完全在空闲时间执行，不占用任何主线程帧预算 |
| 骨架屏 | 业界有现成方案为何要自研？ | react-content-loader / react-placeholder / react-loading-skeleton 均无法在「零人工维护 + 千人千面 + 极致性能」三角中占两角以上，必须自研 |
| 协同 | 为什么选 CRDT 不用 OT？ | OT 需要中央服务器对每对并发操作做变换（中央化架构），私有化部署网络隔离 + 离线场景下中央服务器不可达；CRDT 操作满足交换律结合律，合并结果与顺序无关，天然支持 P2P 和离线 |
| 协同 | 百人并发怎么不卡？ | 只传增量 Op（< 1KB）+ 服务端广播，不同步全文档状态；Op 是意图描述而非状态快照，大小恒定 |
| 协同 | 段落锁怎么实现的？ | 编辑时广播锁定 Op（携带段落 ID + 用户 ID），其他端收到后 UI 置灰该段落；离开段落时广播解锁 Op；CRDT 保证锁 Op 最终一致 |
| 协同-撤销 | 协同下撤销为什么用 UndoManager？ | 原生 history 撤销会回退时间线上的所有 Op（包括他人的）；UndoManager 只追踪本地用户产生的 Op，撤销只回滚自己的操作，他人操作不受影响 |
| 大文件 | 23 种格式怎么不各写一套渲染逻辑？ | 架构决策：服务端统一转 PDF 管道，格式差异在服务端消化，前端维护一套 PDF 渲染逻辑；代价是服务端转换开销，收益是前端复杂度恒定 |
| 内存 | 大文档怎么不崩溃？ | 虚拟页面池：只维护可视区 ±2 页的 Canvas 实例，LRU 淘汰超出范围的页面并 revokeObjectURL 释放；内存占用从 O(n) 降至 O(1) |
| WASM | 为什么用 pdfium-wasm 而不是继续用 PDF.js？ | PDF.js 是 JS 实现，百页以上渲染主线程占用高且无法并行；pdfium-wasm 基于 C++ 编译在 Worker 运行，速度快 1-2 个数量级；代价包体约 3MB，动态 import 按需加载 |
| 语音转写 | AudioWorklet 比 ScriptProcessor 好在哪？ | ScriptProcessor 在主线程运行，复杂页面 16ms 帧预算被占用会丢帧；AudioWorklet 有独立音频处理线程，零主线程占用，这是平台级的架构隔离而非 API 优化 |
| 语音转写 | partial/final 结果怎么渲染不闪烁？ | partial 用 span 绝对定位叠在 final 末尾（不加入文档流），颜色灰色；收到 final 时原地替换并移除 partial span，不触发任何重排 |
| 监控 | 白屏检测怎么实现不误报？ | MutationObserver 监测关键容器 + DOMContentLoaded 后 N 秒 9 点坐标采样双重验证；骨架屏节点存在时不触发上报（白名单）；Performance 时序做二次确认 |
| 监控 | SourceMap 为什么不随 CDN 发布？ | SourceMap 包含完整源码路径和内容映射，随 CDN 发布等于将源码结构暴露给所有用户；CI 上传内网平台后，只有内部系统能用它还原 stack，不影响线上用户 |
| 监控 | API 异常怎么捕获不改业务代码？ | Monkey-patch window.fetch（包装 Promise chain，在 reject 或非 2xx 时采集 url/status/耗时）和 XMLHttpRequest.prototype.open/send（劫持 onreadystatechange），宿主代码零感知 |
| 网页翻译 | 怎么替换文字不破坏 CSS 样式和事件绑定？ | TreeWalker 只遍历 Text 节点并就地替换 nodeValue，不改动任何 Element 节点；CSS 选择器基于 Element 而非 TextNode，事件绑定也在 Element 上，所以完全不受影响 |
| 网页翻译 | SPA 路由切换后怎么自动重注入？ | monkey-patch history.pushState/replaceState + 监听 popstate 事件，路由变化时重新执行 TreeWalker 遍历，已译文字的 Text 节点打标记跳过，避免重复翻译 |
| OCR 标注 | 图片缩放后标注框怎么对齐原图像素？ | 坐标系变换矩阵：鼠标事件坐标 ÷ 缩放比例 − 偏移量 = 原图像素坐标；存储时存原图坐标，渲染时乘以当前缩放比还原显示位置，缩放比变化只影响渲染不影响数据 |
| 配音制作 | 多轨音频时间轴怎么做的？ | AudioContext 统一时间基准；各轨独立 GainNode 控制音量；导出在 Web Worker 里做 PCM 帧拼接与 WAV 封装，主线程零阻塞 |
| 埋点 | 曝光埋点为什么用 IntersectionObserver 不用 scroll 事件？ | scroll 事件高频触发需节流 + getBoundingClientRect（会强制 reflow）；IntersectionObserver 是浏览器原生实现，异步回调不在主线程执行，零主线程负担 |
| 阿里-性能 | INP 怎么从 500ms 优化到 < 200ms？ | LoAF API 定位具体是哪个动画帧里哪段脚本阻塞了输入（比 LongTask 粒度更细）；Scheduler.postTask 将同步大计算拆分为 yield 分片，「响应 → 动画 → 空闲」三阶段严格分离；事件处理函数只做最小 UI 更新 |
| 阿里-性能 | 性能优化怎么量化业务价值？ | A/B 实验是金标准：性能优化上线后对比实验组与对照组的核心业务指标（转化率 / GMV / 留存），而非只看性能指标本身 |
| 阿里-骨架屏 | 为什么需要内联 JS SDK？用 CSS 占位不行吗？ | CSS 占位只能做固定尺寸，千人千面页面每个用户看到的组件组合不同，CSS 无法表达运行时动态布局；内联 SDK 读取 IndexedDB 里的真实测量数据，精准还原每个用户自己的历史布局 |
| AI 流式 | 为什么用 fetch + ReadableStream 而不用 EventSource？ | EventSource 只支持 GET、不支持自定义请求头（无法携带 Authorization Token）、不支持 AbortController 精确中断；fetch + ReadableStream 三者均支持，且能感知背压 |
| 生成式 UI | Function Calling 的 chunk 怎么处理？ | arguments 字段是 JSON 字符串分片到达，用括号深度计数追踪完整性（O(n) 时间，无需正则）；`{` 计数+1，`}` 计数-1，归零时 JSON 合法闭合才 parse 实例化组件；parse 失败降级文字渲染 |
| 生成式 UI | 为什么不用正则匹配 JSON 闭合？ | 正则需要反复回溯，O(n^2) 时间复杂度；括号深度计数是 O(n) 一次扫描；高频 token 场景下性能差异显著 |
| Agent 编排 | 运行时节点状态怎么和画布同步不乱序？ | 幂等状态机：状态只能单向流转（pending → running → done/failed），done/failed 后忽略后续同节点事件；SSE event 携带 sequence 号，乱序到达时按 sequence 排序后重放 |
| Agent 编排 | 为什么不用 Dify / Coze 自建？ | 滴滴对算子扩展性 / 数据合规 / 模型自主可控有强诉求，开源方案不满足；自研核心是编排引擎 + 状态机运行时 + 节点算子 SDK 三件套 |
| 滴滴-导游 | 内容断流怎么解决？ | 借鉴视频预加载缓冲模型：预生产 3 段 ≥ 15 分钟，消费到第 2 段时自动触发下一批 SSE；生产速度始终快于消费速度，缓冲永远存在 |
| 滴滴-导游 | 路线变化竞态怎么处理？ | AbortController 立即中断旧 SSE（毒化旧请求而非等待其结束），清空待播队列；版本号校验：每次路线变化递增版本号，旧版本响应直接丢弃 |
| 滴滴-在哪儿 | 15s 推理等待怎么不让用户以为卡死？ | 关键洞察：让等待「可见且有意义」比缩短等待更重要；推理过程 SSE 实时流式渲染，用户看见 AI 在思考；推理完成手风琴动画收起切结果态，感知等待明显缩短；用户调研感知等待时长从 15s 缩短至 7s |
| 滴滴-在哪儿 | 怎么用数据证明体验优化有效？ | 不能只看技术指标：用用户调研（自报感知等待时长）+ 埋点（次日留存 / 完成率）双重验证；优化前感知 15s / 优化后自报 7s / 次日留存 +18% |
| 端侧 LLM | WebGPU 端侧推理当前瓶颈？ | 模型体积（7B 量化后约 4GB）与下载成本；首 token 延迟在 M1 约 1.5s，但低端机 / 移动端仍较高；适合弱网兜底而非主链路 |
| MCP | MCP 协议对前端的影响？ | 前后端契约从「固定 API」变为「动态工具描述」，前端需根据工具 schema 动态生成 UI；这是 Generative UI 的下一个演进方向 |
| 私有化 | 部署周期怎么从周级压缩到天级？ | 本质是消除人工逐项配置：window.__CONFIG__ 运行时注入使产物与环境解耦；nginx + docker-compose 模板化使配置只需填 env 文件；证书 / 回调地址替换全部脚本化 |
| 工程化 | 怎么推动团队代码质量提升？ | 工具 + 流程 + 文化三位一体：自研 ESLint 规则 / PR 模板 checklist / Code Review 严格度分级；不能只靠工具或只靠人 |
| 团队管理 | 怎么带 4 人小组完成多平台并行？ | 任务分配基于能力矩阵 + 成长诉求；Code Review 主体责任 + 关键技术决策 Review；周会同步 + 季度复盘沉淀方法论；新人 1v1 带教 |
