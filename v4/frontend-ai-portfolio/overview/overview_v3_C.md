---

### **个人亮点**

- **10年+前端开发经验**，先后任职于**科大讯飞、阿里巴巴、滴滴**等头部企业，具备**从 0 到 1 独立设计并落地可商业化前端复杂系统**的完整能力——3 个 SaaS 平台商业化盈利（合计年 ARR 近千万），所设计的技术系统（骨架屏自动化、监控 SDK、CRDT 协同）均成为所在团队长期技术基座。

- **AI 前端工程范式建立者**：在 LLM 落地的工程链路上建立了一套可复用的前端范式：① `fetch + ReadableStream` 替代 `EventSource`（让调用方完全控制流的生命周期——支持 POST / Authorization / AbortController，EventSource 三者均不具备）；② **括号深度计数**追踪 Function Calling `arguments` 分片完整性 → 动态 React 组件流式实例化（Generative UI）；③ **滑动窗口预生产 + 版本号竞态防护**解决长内容生成断流与旧回包污染；④ **幂等状态机 + sequence 号**保证多节点 Agent SSE 乱序安全；独立搭建类 Coze AI Agent 编排平台，**AI 功能上线周期从天级压缩至小时级**。

- **浏览器底层工程专家**：精通 5 类核心浏览器底层 API 并有生产落地经验：**AudioWorklet**（独立音频线程采集 PCM，解决 ScriptProcessor 主线程丢帧）、**pdfium-wasm / FFmpeg.wasm**（C++ WASM 渲染 + 转码，性能较纯 JS 实现提升 1-2 个数量级）、**SharedArrayBuffer + Atomics**（跨 Worker 并行转码）、**CRDT / Yjs**（分布式可交换数据结构，天然支持离线与 P2P）、**ReadableStream + AbortController**（可中断流式消费与背压感知）；上述每项 API 均源于生产问题驱动，而非技术展示。

- **系统级前端架构设计者**：独立设计 **3 层 Smarty Skeleton 骨架屏自动化系统**（内联 JS SDK 极致性能层 + NPM 运行时学习层 + Chrome 插件 SSR / 首次访问覆盖层，4D 隐式缓存失效无需版本号），CLS **0.15+ → < 0.02**，单页开发成本降低 **95%**；自研前端监控 SDK（**< 5KB gzip**，白屏双重校验防误报 + LoAF + SourceMap 不随 CDN 发布），P0 故障响应降至 **5 分钟内**；独立落地 **CRDT（Yjs）百人并发多人协同系统**（段落级编辑锁 + IndexedDB 离线持久化）。

- **Web 性能全链路度量与优化专家**：建立「定位 → 拆解 → 优化 → 度量」的性能工程闭环：**LoAF API** 定位长动画帧 → **Scheduler.postTask** yield 分片拆解主线程占用 → **Smarty Skeleton** 消除 CLS → **PerformanceObserver** 持续度量；主导阿里 ICBU P90 全项达标（**FCP < 1000ms / LCP < 2000ms / CLS < 0.02 / INP < 200ms**），骨架屏自动化使 CLS 优化工作量降低 **95%**。

---

### **技术专长**

**AI 流式工程**
- 设计原则：**调用方控制流的完整生命周期**。`fetch + ReadableStream` 消费 SSE（支持 POST、Authorization Header、AbortController 流级中断、背压感知），而非依赖服务端连接管理的 `EventSource`；高频 token 到来时**增量 Markdown 解析 + rAF 批量 commit**，维护已解析 AST 只 patch 新增节点，避免每帧全量重 parse；落地 **Generative UI**（Function Calling `arguments` 分片 → 括号深度计数追踪 JSON 完整性 → 动态 React 组件实例化，降级 Markdown）；搭建类 Coze **Agent 编排平台**（ReactFlow DAG + SSE 运行时状态推送 + 幂等状态机 + sequence 号防乱序）；多模态输入预处理（Canvas EXIF 矫正 / 图像压缩、AudioWorklet PCM 采集 / VAD 过滤）。

**浏览器底层工程**
- 设计原则：**在正确的层解决性能问题，而非用应用层 workaround 掩盖**。精通 **Canvas / SVG**；熟练使用 **PDF.js、pdfium-wasm**（C++ 编译 WASM，渲染速度超 PDF.js 1-2 个数量级，动态 import ~3MB 按需加载）、**ProseMirror、Monaco Editor、pdf-lib**；**AudioWorklet** 独立音频线程（解决 ScriptProcessor 主线程丢帧根因）；**FFmpeg.wasm** 浏览器端多格式转码（SharedArrayBuffer + Atomics 并行处理长音频）；大文件分片上传（MD5 秒传 + 断点续传）、虚拟页面池（LRU + revokeObjectURL）、HTTP Range Request 流式播放。

**系统架构设计**
- 精通 **React(18) / Vue(3)**，深入理解 Fiber 调度、Concurrent 渲染、Diff 算法；具备**状态机**驱动复杂表单流转（草稿 → 填写中 → 校验中 → 提交中 → 完成，消除 if-else 分支）、**CRDT（Yjs）** 分布式协同（Awareness 光标感知 + 段落锁 + IndexedDB 离线）、**微前端 / 插件化平台**（iframe 沙箱 + postMessage）、**国别化配置驱动**（Feature Flag + Schema 注入，新增国家只需配置）等复杂架构落地经验；熟练应用 Redux / Zustand / Pinia。

**性能工程**
- 精通 **Core Web Vitals** 全链路（FCP / LCP / CLS / INP）；熟练使用 **LoAF API、PerformanceObserver** 定位长动画帧与长任务；**Scheduler.postTask** yield 分片拆解主线程同步大计算；设计 3 层 Smarty Skeleton 自动化骨架屏（CLS 0.15+ → < 0.02）；熟练应用 SSR / 预渲染、WebP / preload、关键 CSS 内联、render-blocking 消除。

**前端基础设施**
- 设计原则：**基础设施应该降低使用门槛，而非增加使用负担**。精通 **Vite / Webpack** 构建全链路优化；熟练应用 **Monorepo（pnpm）** + 公司级组件库建设（复用率 70%+）；运行时配置注入（`window.__CONFIG__`）支持私有化多环境免重新构建；自研监控 SDK（< 5KB gzip，白屏检测 / LoAF / SourceMap CI 还原 / API 异常）；精通 **TypeScript**；熟练使用 **Node.js（NestJS）** 处理 BFF 层。

---

### **项目经历**

#### **阿里巴巴 ICBU 海外商品域 & 商增域**（2023.12 - 2025.04）
**技术栈**：React18, TypeScript, Vite, Monorepo (pnpm), Node.js/BFF, Performance API, IndexedDB, Chrome 插件, SSR, 数据埋点

**项目背景 (Situation)**：ICBU 是阿里面向全球买卖家的 B2B 跨境电商平台，核心挑战三重：发品属性体系庞大（百级字段），历史表单单文件 3000+ 行，状态管理混乱；各目标国入驻流程、认证方式、支付渠道均不同，一套代码难以覆盖多国差异；核心交易页面 Web 性能不达标，INP 超 500ms，LCP 超 4s，直接影响转化率。

**核心难点**：
- **INP 超标的根因**：商品管理页大量同步计算阻塞主线程，关键洞察：**用 LoAF API 才能精准定位「哪个动画帧里哪段脚本阻塞了输入响应」**，而非仅用 LongTask API 得到粗粒度时间段；
- **骨架屏的根本矛盾**：千人千面页面「构建期不知运行时布局」——构建时不存在 DOM，运行时渲染完毕何需骨架，这是一个必须在系统层解决的矛盾，而非靠约定规避；
- **多国差异的腐化路径**：税制 / 支付 / 合规规则散落 if-else 中，每次新增国家都在核心逻辑打补丁，腐化是必然结果，需要架构层隔离。

**我的职责 (Action)**：

1. **主导 Core Web Vitals 全链路性能优化**，P90 达到 **FCP < 1000ms / LCP < 2000ms / CLS < 0.02 / INP < 200ms**：
   - **LCP**：SSR 首屏直出 + Hero 图 WebP / preload；消除 render-blocking 脚本；关键 CSS 内联；
   - **INP**：**LoAF API** 精准定位长动画帧（区别于 LongTask，LoAF 能关联到具体的输入延迟），**Scheduler.postTask** 将同步大计算拆分为 yield 分片，事件处理函数只触发最小 UI 更新，将「响应 → 动画 → 空闲」三阶段严格分离；
   - **CLS**：依托 Smarty Skeleton 自动化方案精准预占位，彻底消除内容加载后的布局偏移。

2. **独立设计并落地 3 层 Smarty Skeleton 自动骨架屏系统**——破解「构建期不知运行时布局」的根本矛盾，核心思路：**将首次渲染作为「学习投资」，从第二次访问起骨架屏自动还原、精准匹配、零人工维护**：

   - **内联 JS SDK（极致性能层）**——覆盖第 2 次起的所有访问：注入 HTML `<head>`，在 bundle 解析前执行；同步读 **localStorage** 元数据（宽高 / hasCache）立即创建尺寸精确的占位容器，再异步读 **IndexedDB** 取骨架数字数组（每块 `[left%, top%, w%, h%, type]` 五元组，百分比坐标天然响应式），动态生成占位节点；框架水合前骨架已就位，首次像素 **< 500ms**，白屏彻底消除；

   - **NPM 运行时学习层**——解决「谁来生成骨架数据」的问题：首次真实渲染完成后静默 BFS 遍历 DOM，**requestIdleCallback 40ms 预算/帧**时间切片（空闲时间执行，不占任何主线程帧预算）；对每个节点计算与父节点矩形交集（clip），文本节点减 padding 贴合真实文字区域；**4 路并联叶子识别**（hasChildText / img·input·button 枚举 / 背景图渐变 / `data-skeleton-block` 标记）任一满足即停止递归；邻近块合并（minGap 阈值）消除密集文本碎条；结果双写 localStorage（元数据）+ IndexedDB（完整数组）；**4D 隐式缓存失效**（key = `path + componentId + innerWidth + innerHeight`），视口变化自然 cache miss，无需显式版本号，componentId 扩展千人千面；

   - **Chrome 插件预生成层**——覆盖两个学习层无法触达的盲区：SSR 场景（服务端无 DOM，无法运行时测量）和首次访问（新用户无缓存只能看白屏）；插件在真实页面叠层可视化预览骨架，开发者调整后一键保存至项目约定路径，提交 git 后 SSR 直接读取，彻底消除首次白屏；

   - 结果：CLS **0.15+ → < 0.02**，单页开发成本 **0.5 人日 → 5 分钟（↓95%）**，全团队 **20+ 页面**接入。

3. **独立主导发品表单架构升级**——核心决策：用**有限状态机**取代散落的 if-else，原因：if-else 是状态转移的隐式编码，状态越多 if-else 越难穷举；FSM 将每个状态允许的事件与转移显式声明，组件只根据当前状态渲染，新增状态不影响已有路径；3000+ 行大文件按模块拆解为 < 500 行/模块，统一 Design Token 消除样式碎片化，建立灰度发布 + 异常监控机制，核心模块代码量 **↓60%+**。

4. **设计国别化配置驱动架构**——核心原则：**核心业务组件对国别无感知**；路由层读取 `countryCode` 动态注入差异化 Schema（表单字段 / 校验规则 / 支付渠道 / 合规提示），Feature Flag 控制功能开关；**新增国家只需新增配置文件，不改任何业务代码**；落地 OCR 证件识别自动填充，多国本地支付 SDK 统一封装为 `PaymentContext`。

5. **落地 AI 属性补全与智能搬品**，商家输入标题后 500ms 防抖触发 AI 接口，推荐属性以浮层展示；AI 搬品页设计批量选品 + 类目映射可视化编辑器，属性冲突实时高亮。

6. **建设数据埋点体系**——设计原则：**埋点基础设施不应对业务组件有侵入性**；曝光埋点基于 **`IntersectionObserver`** 声明式监听（组件标注 `data-track-expose` 属性即自动采集，替代高频 `scroll` + `getBoundingClientRect` 采样，主线程零额外负担）；点击埋点用**事件委托**在根节点单一监听，不在每个元素绑定 handler，列表渲染场景内存节省显著；A/B 实验分组信息在 HTML 注入时写入 `window.__EXPERIMENTS__`（与 `window.__CONFIG__` 同一 Nginx 注入管道），组件通过 `useExperiment` Hook 无感知读取，无需业务代码感知实验逻辑；埋点数据内存聚合后通过 **`navigator.sendBeacon`** 在 `visibilitychange: hidden` 时批量发送，保证页面关闭时数据不丢失；接入漏斗分析平台，精准定位各国用户转化断点；快速复用讯飞阶段沉淀的监控 SDK，建立 ICBU 20+ 页面稳定性告警体系。

**项目成果 (Result)**：
- Core Web Vitals P90 全指标达标：**FCP < 1000ms / LCP < 2000ms / CLS < 0.02 / INP < 200ms**；
- Smarty Skeleton 落地，CLS **0.15+ → < 0.02**，单页开发成本 **↓95%**（0.5 人日 → 5 分钟），全团队 20+ 页面零维护接入，**沉淀为可对外推广的前端基建能力**；
- 表单架构升级，核心模块代码量 **↓60%+**，单模块 < 500 行；国别化架构落地，新增国家改造成本从周级降至天级。

---

#### **滴滴 llab AI 出行体验**（2025.06 - 至今）
**技术栈**：React18 / 微信小程序, TypeScript, SSE, Function Calling, ReactFlow, Canvas, LBS/POI 服务, 多说话人 TTS

**项目背景 (Situation)**：llab 是滴滴探索 AI + 出行场景融合的创新实验室，核心命题：**如何让 AI 能力真正融入出行路线，而非停留在对话框**；同时需要探索工程侧如何支持产品快速搭建复杂多步骤 AI 功能，减少工程排期依赖。

**核心难点**：
- **流式 JSON 不完整解析**：Function Calling `arguments` 按 chunk 分片到达，直接 `JSON.parse` 必然抛异常；需要一种在 O(n) 时间内判断 JSON 是否合法闭合的轻量方案；
- **Agent SSE 乱序**：后端多节点并行执行导致 SSE 事件乱序到达，画布状态如果按到达顺序更新会出现闪烁和状态回退；
- **出行内容竞态**：用户绕路改道时，旧路线对应的 SSE 回包可能在 `AbortController` 触发后仍异步到达，需要「毒化旧响应」而非「等待旧响应结束」；
- **15s 长推理体验**：传统 loading 状态下用户无法区分「AI 在思考」和「服务挂了」，15s 的感知等待接近用户放弃阈值。

**我的职责 (Action)**：

1. **独立从 0 到 1 搭建类 Coze AI Agent 工作流编排平台**：
   - 基于 **ReactFlow** 的可视化 DAG 编辑器，支持节点拖拽 / 连线 / 端口类型合法性校验（string / object / array / any，不合法连线实时标红）；节点类型覆盖 LLM 对话、工具调用（搜索 / POI / 天气）、条件分支、循环、人工审核；
   - **运行时可视化核心设计**：SSE 实时推送节点状态变更，前端维护 `nodeStatus Map` 驱动节点样式（done 绿 / failed 红 / running 流光动画）；乱序 SSE 用**幂等状态机**处理——状态只能单向流转，done / failed 后忽略后续同节点事件；SSE event 携带 `sequence` 号，乱序到达时按 sequence 排序后重放；
   - 工作流 JSON Schema 统一序列化，支持导入导出与版本管理；**AI 功能上线周期从天级压缩至小时级**。

2. **「行中导游」—— 出行 AI 播客的流式内容调度与 Generative UI 工程**：
   - **播放连续性**——借鉴视频预加载缓冲模型，设计**滑动窗口预生产策略**：始终维护 3 段 ≥ 15 分钟的内容缓冲，消费到第 2 段时自动触发下一批 SSE，消费速度永远慢于生产速度，彻底消除断流；
   - **竞态防护**——`AbortController` 立即中断旧 SSE（而非等待其自然结束），清空待播队列；引入**版本号校验**：每次路线变化递增版本号，SSE 回调收到响应时先校验版本号是否与当前一致，旧版本响应直接丢弃，解决 abort 后异步回包污染；
   - **TTS 串行队列**——双角色（原野 / 晓曼）对话 TTS 并发请求回包顺序不保证；维护**串行 Promise 队列**，按脚本角色序依次 resolve 音频 chunk 后拼接，保证播放顺序与脚本完全一致，同时支持路线进度联动自动切景点、手动切换 / 暂停 / 拖拽；
   - **Generative UI**——Function Calling `arguments` 分片到达，用**括号深度计数**（O(n) 逐字符扫描，`{` +1 / `}` -1，计数归零时 JSON 合法闭合）追踪完整性，仅合法闭合时实例化 `render_poi_card / render_route_map / render_tip_block` 组件；降级 Markdown 路径采用**增量解析 + rAF 批量 commit**，维护已解析 AST，每帧只 patch 新增 token 对应节点，帧率稳定。

3. **「在哪儿问问」—— 多模态 Agent 推理链路的前端体验工程**（微信小程序）：
   - **长推理等待**——关键洞察：**让等待「可见且有意义」比缩短等待更重要**；15s 推理过程通过 SSE 实时流式渲染（多轮搜索 / 图像细节分析均可见），用户看见 AI 在思考而非等待结果；推理完成后手风琴动画收起推理链，切换为地图卡片 + Markdown 结果态，感知等待时长明显缩短；
   - **动态分流 UI**——同一入口 3s 与 15s 响应若使用相同 UI，慢场景用户会误判为出错；根据**首包是否含推理事件**动态分流：有推理 → 展示推理链滚动，无推理 → 骨架屏快速占位，两条路径收敛到相同结果态，分流逻辑对用户完全透明；
   - **EXIF 矫正**——iOS 相机照片 EXIF 方向标记导致模型接收旋转 90° 图片，识别准确率明显下降；Canvas 读取 `Orientation` 字段先矫正再压缩，确保模型输入图片方向正确。

**项目成果 (Result)**：
- 行中导游实现讲解文字 + 双人语音播客 + AI 博客三合一，滑动窗口策略消除断流，路线联动播放实现沉浸式导游体验；
- 在哪儿问问首 token 推理响应 **≤ 2s**，端到端搜地点体验流畅；
- Agent 编排平台**AI 功能上线周期从天级压缩至小时级**；
- Generative UI 建立 Function Calling → buffer 拼接 → 动态组件实例化的前端范式，**成为团队 AI 内容渲染的标准方案**。

---

#### **科大讯飞 ToB & ToC 双线 SaaS 矩阵**（2018.07 - 2023.07）
**技术栈**：React18, TypeScript, ProseMirror, Yjs, WebSocket/SSE, AudioWorklet, WebAudio API, Canvas, Web Worker, pdf-lib, Monaco Editor, pdfium-wasm, FFmpeg.wasm, 自研前端监控 SDK

**项目背景 (Situation)**：公司 AI 能力（语音转写、OCR 识别、多模态翻译、TTS 合成）缺乏面向企业客户与消费者的产品载体，需同时支撑**两条产品线**：ToB 企业级（智能翻译、质检、OCR 规则训练、电子签——大体量文档处理 / 多人协作 / 合规签署）和 ToC 消费级（网页翻译、实时语音转写、在线配音——无需安装、即开即用）；传统桌面客户端部署成本高、迭代慢，业界缺乏覆盖上述诉求的成熟纯前端方案，制约 AI 能力的商业化速度。

**核心难点**：
- **协同冲突的根本矛盾**：多译员同时编辑同一段落必然产生冲突，OT 算法需要中央服务器做变换，与私有化部署（网络隔离）和离线使用场景根本冲突；
- **大文件渲染的内存模型**：百页 PDF 全量渲染等价于在内存中维护 N 张 Canvas bitmap，内存溢出是必然结果，需要设计「按需存在」的内存模型；
- **网页翻译的无侵入注入**：ToC 网页翻译必须在不破坏目标页面任何 DOM 结构、CSS 样式、JS 事件的前提下完成文本替换，SPA 路由切换后还需自动重注入，不能依赖插件权限；
- **私有化场景的可观测性**：6 个平台 + 多套私有化环境，客户侧出现问题时没有任何遥测数据，排查效率极低。

**我的职责 (Action)**：

1. **独立设计并落地 CRDT 多人实时协同编辑系统**——核心架构决策：选型 **Yjs（CRDT）** 而非 OT，决策依据：**CRDT 操作满足交换律和结合律，合并结果与操作到达顺序无关**，天然支持离线编辑和 P2P；OT 需要中央服务器对每对并发操作做变换，在私有化网络隔离场景下无法保障可用性；具体实现：Awareness 协议广播光标 / 选区实时感知；段落级编辑锁（编辑时广播锁定 Op，其他端 UI 置灰该段落，释放时广播解锁）防止重复翻译；增量 Op（< 1KB）+ 服务端广播支持百人并发；IndexedDB 持久化保障断线后自动恢复。

2. **设计并实现浏览器端全模态文档处理引擎**，支持 23 种文档格式（PDF / DOCX / PPT / XLS / SRT 等）、8 种音频、9 种视频格式，文件支持 1GB+——核心架构决策：**服务端统一转换管道**（所有格式转 PDF，前端维护一套渲染逻辑，格式差异在服务端消化）；**虚拟页面池**（仅维护可视区 ±2 页，LRU 淘汰 + revokeObjectURL 及时释放，内存占用从 O(n) 降至 O(1)）；Web Worker 异步解析（解码不阻塞渲染线程）；HTTP Range Request 按需加载（大文件不全量下载）；后期引入 **pdfium-wasm** 替代 PDF.js（C++ 编译 WASM，百页渲染耗时降低 60%+，动态 import ~3MB 按需加载）；引入 **FFmpeg.wasm** 实现浏览器端转码（短音频 < 100ms，长音频 SharedArrayBuffer + Atomics 并行）；大文档首页可见时间从 **8s 降至 2.4s 以内（P75）**，内存峰值降低 **60%+**。

3. **构建所见即所得文档编辑能力**，基于 ProseMirror 打造富文本编辑内核，维护文档 AST 与渲染层双向同步；DOCX / XLSX / PPT 采用 JSZip + xml2js 结构化解析与二进制序列化导出——关键原则：**只修改目标 XML 节点，不碰其他节点**，格式还原度 **95%+**；段落级双栏译文对照编辑器（Myers Diff 字符级高亮 + react-window 虚拟列表），万级段落无卡顿。

4. **落地实时语音转写前端链路**——核心架构决策：**AudioWorklet** 替代 ScriptProcessor，原因：ScriptProcessor 在主线程运行，复杂页面 16ms 帧预算被占用会丢帧；AudioWorklet 有独立音频处理线程，零主线程占用；双重 VAD（能量阈值 + 过零率）过滤静音帧（上行带宽降低 **50%**）；partial / final 分级渲染——partial 用绝对定位叠在 final 末尾不触发重排，收到 final 原地替换；端到端延迟 **< 800ms**，字随声出。

5. **构建在线配音制作能力（ToC）**，基于 **WebAudio API** 设计音频时间轴编辑器，支持多段 TTS 合成片段的拖拽排列与波形可视化预览；`AudioContext` 调度多轨音频（配音轨 + 背景音乐轨），各轨独立 `GainNode` 控制音量；导出时在 **Web Worker** 线程完成 PCM 帧拼接与 WAV 封装，主线程零阻塞；字幕轨与音频轨通过时间码绑定，每段 TTS 合成后拿到精确时长，字幕轨按时间码偏移渲染，逐句校验误差，支持语速 / 音调参数调节，一键导出带字幕混合音频。

6. **实现网页翻译（ToC，无需插件）**——核心挑战：在不破坏目标页面任何 DOM 结构与 CSS 选择器的前提下完成文本替换；方案：脚本注入目标页面后，**TreeWalker** 只遍历 Text 节点并就地替换 `nodeValue`（不改动任何 Element 节点，CSS 选择器、事件绑定完全不受影响）；**MutationObserver** 监听 SPA 的动态 DOM 变化，新增节点自动译文填充；路由切换通过 monkey-patch `history.pushState / replaceState` + 监听 `popstate` 事件触发**自动重注入**，支持所有主流 SPA 框架；跨域场景用 **postMessage 桥接通信**，iframe 内页面翻译结果回传宿主窗口。

7. **搭建 OCR 规则训练平台的图像标注工具**，Canvas 实现矩形框选、多边形标注及自由缩放拖拽；**坐标系变换矩阵**是关键：鼠标事件坐标 ÷ 缩放比例 − 偏移量 = 原图像素坐标，逆变换确保标注框在任意缩放下精准映射回原图，不因显示比例产生误差；基于 **Command 模式**封装每个操作的 `execute / undo` 函数，维护操作栈实现无限步撤销 / 重做；标注数据与训练任务绑定，支持批量审核与置信度可视化，构成从数据标注到模型迭代的完整 MLOps 前端闭环。

8. **交付电子签全链路**，Canvas 三阶贝塞尔曲线手写签名（采集压力点序列拟合，平滑无锯齿，支持触控）；pdf-lib 写入签章坐标，SHA-256 哈希锁定文档完整性；有限状态机管理多方签署流程（顺序签 / 并行签，状态：待发起 → 签署中 → 完成 / 拒签 / 过期），WebSocket 实时推送进度，动态水印 + 防截图保障合同安全。

9. **负责文本校对与合规引擎**，三层混合规则（关键词黑名单 → 正则匹配 → AI 语义），结果合并——以字符区间为 key 做并集，相同区间取最高风险等级去重渲染；300ms 防抖 + SSE 流式 + 字符级 Diff 高亮，支持逐条 Accept / Reject；审计日志完整留存，支持合规报告一键导出。

10. **建设 AILab 能力集市**，Monaco Editor + 虚拟目录树实现代码仓库在线预览（对齐 GitHub Web IDE）；**架构核心**：iframe 沙箱 + postMessage 协议——平台与 Demo 约定消息格式，AI Demo 以 JSON 配置零代码接入，新能力上线**不改动平台代码**，平台与内容完全解耦。

11. **沉淀跨平台公共组件库与工程规范**，抽象文件上传器、标注画板、AI 流式输出面板、媒体播放器、音频时间轴等核心组件，复用率 **70%+**；`window.__CONFIG__` 运行时注入（Nginx 在 HTML `<head>` 注入不同 env 对象），免重新构建支持多套私有化环境；Nginx 反代 + CSP 白名单配置脚本化，docker-compose 统一编排，私有化部署交付周期 **5-7 天 → 1-2 天**；制定 Code Review 标准、分支策略与性能预算机制，保障 4 人团队多平台并行高质量交付。

12. **从 0 设计并落地六平台前端监控 SDK**——设计约束：私有化环境极致轻量（**< 5KB gzip**），零第三方依赖，不影响宿主页面任何性能指标：
    - **错误采集**：全局 `onerror` + `unhandledRejection` 双入口覆盖同步错误与未捕获 Promise，捕获后在**微任务队列异步上报**，不阻塞当前执行帧；
    - **API 异常**：Monkey-patch `window.fetch`（包装 Promise chain，在 reject 或非 2xx 时采集 url / status / 耗时）和 `XMLHttpRequest.prototype.open / send`（劫持 `onreadystatechange`），宿主代码**零感知**；
    - **白屏检测**：`DOMContentLoaded` 后对 9 个均布坐标点调用 `document.elementFromPoint`，**全部命中根节点**（body / html）才判定白屏；同时 MutationObserver 监听关键容器首次出现子节点，**两者均触发才上报**，彻底消除骨架屏 / Loading 组件导致的误报；
    - **LoAF 监控**：`PerformanceObserver('long-animation-frame')` 替代 `LongTask`，原因：LoAF entry 包含帧内所有脚本执行时长与强制 reflow 信息，粒度远细于 LongTask 仅给出任务总时长；
    - **SourceMap 还原**：CI 打包时将 `.map` 上传至内网监控平台（**不随 CDN 发布**，不暴露源码结构），error stack 由服务端 `source-map` 库在线还原到源文件行号，告警附带可跳转源码链接；
    - **发送策略**：错误聚合去重后，通过 **`navigator.sendBeacon`** 在 `visibilitychange: hidden` 时批量发送（不阻塞页面关闭），P0 实时告警走 `fetch + keepalive: true`；接入钉钉 / 邮件告警，**P0 问题响应从小时级降至 5 分钟内**。

**项目成果 (Result)**：
- **ToB 性能**：大文档首页可见时间 **8s → 2.4s 以内（P75）**，内存峰值 **↓60%+**，pdfium-wasm 渲染耗时 **↓60%+**，DOCX / XLSX / PPT 格式还原度 **95%+**；实时语音转写端到端延迟 **< 800ms**，VAD 静音过滤使上行带宽降低 **50%**；
- **ToC 覆盖**：网页翻译无需安装插件即可覆盖主流浏览器；在线配音支持多轨混音一键 WAV 导出；OCR 标注工具构成完整 MLOps 前端闭环；
- **监控**：SDK 上线后 P0 响应从小时级降至 **5 分钟内**，私有化客户侧故障排查效率 **↑80%+**，**SDK 沉淀为部门标准监控方案并在 ICBU 阶段快速复用**；
- **商业化**：3 个平台盈利，合计年 ARR **近千万**；合同签署周期 **天级 → 分钟级**；私有化部署周期 **5-7 天 → 1-2 天**；组件库复用率 **70%+**，新平台启动成本降低 **70%+**，**成为部门前端架构标准底座**。

---

### **技术沉淀与影响力**

| 沉淀产物 | 核心价值 | 落地范围 |
|---------|---------|---------|
| Smarty Skeleton 骨架屏自动化系统 | 3 层架构解决「构建期不知运行时布局」根本矛盾，CLS ↓95%，开发成本 ↓95% | 全团队 20+ 页面，成为标准前端基建 |
| 自研前端监控 SDK（< 5KB gzip） | 白屏双重校验 + LoAF + SourceMap CI 还原，P0 响应降至 5 分钟内 | 科大讯飞 6 平台 → ICBU 快速复用 |
| Generative UI 前端范式 | Function Calling → 括号深度计数 → 动态组件实例化标准链路 | 滴滴 llab AI 出行产品线 |
| 公司级 Monorepo 组件库 | 文件上传器 / 标注画板 / AI 流式面板 / 媒体播放器，复用率 70%+ | 科大讯飞 6 个 SaaS 平台 |
| CRDT 协同编辑系统设计 | 选型 Yjs 解决离线 + 私有化场景，百人并发，IndexedDB 离线持久化 | 智能翻译平台，可直接复用 |

---

#### **技术 Portfolio（面试可演示）**

- **collab-editor**（React18 + TypeScript + Yjs + TipTap + WebRTC）：多人实时协同编辑器完整 demo。
  - **CRDT 协同**：Yjs UndoManager 接管 History，协同感知撤销（只回滚本人 Op，不影响他人）；
  - **传输层**：优先 BroadcastChannel（同机器多 Tab 零延迟），降级 WebRTC P2P 信令，无需自建服务端；
  - **段落感知**：自定义 ProseMirror DecorationSet 插件，将他人正在编辑的段落渲染为彩色边框；
  - **工程细节**：useMemo 保证 ydoc/provider 引用稳定；peersRef 解决 Plugin 闭包陈旧引用；仅段落 pos 变化时广播，避免频繁 Awareness 更新。

---

## 面试深挖速查

| 方向 | 高频问题 | 核心答案（架构视角） |
|------|---------|---------|
| 骨架屏 | 为什么要 3 层而不是直接 NPM 包？ | 3 层覆盖 3 个独立场景：SDK 层覆盖第 2+ 次访问（性能极致）；NPM 层解决「谁来生成数据」；插件层覆盖 SSR 和首次访问两个运行时 SDK 到不了的盲区；缺任何一层都有覆盖漏洞 |
| 骨架屏 | 骨架屏自动化怎么保证和真实内容一致？ | 运行时 DOM 遍历：真实渲染后对关键节点做 getBoundingClientRect，计算与父节点矩形交集（clip）生成百分比骨架块；尺寸来自用户真实渲染，精准匹配 |
| 骨架屏 | 缓存怎么失效？为什么不用版本号？ | 4D key（path + componentId + innerWidth + innerHeight）隐式失效：视口变化自然 cache miss 触发重新学习，无需显式版本号；版本号方案需要业务方主动维护，维护成本高且容易忘 |
| 骨架屏 | SDK 怎么不阻塞首屏？ | BFS + requestIdleCallback 40ms 预算/帧时间切片，学习过程完全在空闲时间执行，不占用任何主线程帧预算 |
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
| 阿里-骨架屏 | 为什么需要内联 JS SDK？用 CSS 占位不行吗？ | CSS 占位只能做固定尺寸，千人千面页面每个用户看到的组件组合不同，CSS 无法表达运行时动态布局；内联 SDK 读取 IndexedDB 里的真实测量数据，精准还原每个用户自己的历史布局 |
| AI 流式 | 为什么用 fetch + ReadableStream 而不用 EventSource？ | EventSource 只支持 GET、不支持自定义请求头（无法携带 Authorization Token）、不支持 AbortController 精确中断；fetch + ReadableStream 三者均支持，且能感知背压 |
| 生成式 UI | Function Calling 的 chunk 怎么处理？ | arguments 字段是 JSON 字符串分片到达，用括号深度计数追踪完整性（O(n) 时间，无需正则）；`{` 计数+1，`}` 计数-1，归零时 JSON 合法闭合才 parse 实例化组件；parse 失败降级文字渲染 |
| Agent 编排 | 运行时节点状态怎么和画布同步不乱序？ | 幂等状态机：状态只能单向流转（pending → running → done/failed），done/failed 后忽略后续同节点事件；SSE event 携带 sequence 号，乱序到达时按 sequence 排序后重放 |
| 滴滴-导游 | 内容断流怎么解决？ | 借鉴视频预加载缓冲模型：预生产 3 段 ≥ 15 分钟，消费到第 2 段时自动触发下一批 SSE；生产速度始终快于消费速度，缓冲永远存在 |
| 滴滴-导游 | 路线变化竞态怎么处理？ | AbortController 立即中断旧 SSE（毒化旧请求而非等待其结束），清空待播队列；版本号校验：每次路线变化递增版本号，旧版本响应直接丢弃 |
| 滴滴-在哪儿 | 15s 推理等待怎么不让用户以为卡死？ | 关键洞察：让等待「可见且有意义」比缩短等待更重要；推理过程 SSE 实时流式渲染，用户看见 AI 在思考；推理完成手风琴动画收起切结果态，感知等待明显缩短 |
| 私有化 | 部署周期怎么从周级压缩到天级？ | 本质是消除人工逐项配置：window.__CONFIG__ 运行时注入使产物与环境解耦；nginx + docker-compose 模板化使配置只需填 env 文件；证书 / 回调地址替换全部脚本化 |
