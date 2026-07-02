---

### **个人亮点**

- **10年+前端开发经验**，先后任职于**科大讯飞、阿里巴巴、滴滴**等头部企业，深耕 **AI 前端工程化、复杂系统设计、大文件处理、Web 性能优化** 领域，主导过 12+ 核心技术项目，3 个 SaaS 平台商业化盈利（合计年 ARR 近千万）。

- **AI 前端工程化专家**：独立落地**类 Coze AI Agent 工作流编排平台**（ReactFlow DAG + SSE 运行时节点状态可视化 + 幂等状态机）与 **Generative UI 渲染引擎**（Function Calling `arguments` 分片 → 括号深度计数追踪 JSON 完整性 → 动态 React 组件流式实例化，降级增量 Markdown 解析）；精通 AI 流式全链路（`fetch + ReadableStream` 手动消费 SSE，优于受限原生 `EventSource`，支持 POST / Authorization Header / AbortController 精确中断）；落地带**滑动窗口预生产**策略的 AI 播客引擎，彻底消除长内容生成中断流问题。

- **复杂前端系统架构专家**：独立设计 **3 层 Smarty Skeleton 自动骨架屏系统**（① 内联 JS SDK 同步读 localStorage 立即占位 + 异步 IndexedDB 还原精确骨架；② NPM 运行时 BFS + `requestIdleCallback` 40ms 时间切片无侵入学习真实布局；③ Chrome 插件覆盖 SSR / 首次访问盲区；4D 隐式缓存失效无需版本号），CLS **0.15+ → < 0.02**，单页开发成本降低 **95%**（0.5 人日 → 5 分钟），全团队 20+ 页面接入；自研前端监控 SDK（**< 5KB gzip**，白屏检测 + LoAF + SourceMap CI 还原 + API 异常），P0 故障响应从小时级降至 **5 分钟内**。

- **大文件与富媒体处理专家**：主导浏览器端 23 种文档格式、1GB+ 音视频预览 / 编辑 / 标注 / 导出全闭环；引入 **pdfium-wasm**（C++ 编译 WASM，百页文档渲染耗时较 PDF.js 降低 60%+）与 **FFmpeg.wasm**（浏览器端 PCM/WAV 转码从秒级降至百毫秒，长音频 SharedArrayBuffer + Atomics 并行）；**AudioWorklet** 独立音频线程采集 PCM + 双重 VAD（能量阈值 + 过零率）过滤静音，上行带宽降低 **50%**；首屏可见时间降低 **70%+**，内存峰值降低 **60%+**。

- **协同系统设计者**：独立落地基于 **CRDT（Yjs）** 的多人实时协同编辑系统；选型依据：CRDT 操作可交换结合，天然支持离线和 P2P，OT 需中央服务器做变换无法适配私有化场景；Awareness 协议实现光标 / 选区感知；段落级编辑锁防重复翻译；增量 Op（< 1KB）+ IndexedDB 持久化支持**百人并发与断线自动恢复**。

- **Web 性能优化专家**：主导阿里 ICBU 核心页面 Core Web Vitals 全链路调优，P90 **FCP < 1000ms / LCP < 2000ms / CLS < 0.02 / INP < 200ms** 全项达标；熟练使用 **LoAF API** 定位长动画帧，**Scheduler.postTask** 将同步大计算拆分为 yield 分片；骨架屏自动化方案彻底消除 CLS 布局偏移。

---

### **技术能力**

**核心框架与原理**
- 精通 **React(18)** / **Vue(3)**，深入理解 Fiber 调度机制、Concurrent 并发渲染、Diff 算法与响应式原理；主导过 ICBU 海外 20+ 核心业务页面架构升级，支撑千万级 UV 访问。

**AI 前端工程化**
- 精通 AI 流式全链路：`fetch + ReadableStream` 手动消费 SSE（支持 POST、自定义 Authorization Header、AbortController 流级中断，相比原生 `EventSource` 能力更完整）；高频 token 到来时采用**增量 Markdown 解析 + `requestAnimationFrame` 批量 commit**，避免全量重 parse 导致帧率下降；落地 **Generative UI**（Function Calling `arguments` 分片流 → 括号深度计数追踪 JSON 完整性 → 动态 React 组件实例化，parse 失败降级 Markdown）与**类 Coze Agent 编排平台**（ReactFlow DAG + SSE 节点状态推送 + 幂等状态机 + sequence 号防乱序）；熟练处理多模态输入（Canvas EXIF 矫正 / 图像压缩、AudioWorklet PCM 采集 / VAD 过滤）。

**实时通信与协同**
- 精通 **WebSocket / SSE**；独立落地 **CRDT（Yjs）** 多人协同编辑系统（百人并发 + 断线离线恢复）；熟练使用 **Web Worker、SharedArrayBuffer + Atomics** 处理计算密集型任务，保障主线程零阻塞；具备 **AudioWorklet + VAD + WebSocket ASR** 实时语音采集到转写完整链路工程经验。

**文档与富媒体处理**
- 精通 **Canvas / SVG**；熟练使用 **PDF.js、pdfium-wasm**（C++ 编译 WASM 渲染引擎，性能超 PDF.js 1-2 个数量级，动态 import 按需加载 ~3MB）、**ProseMirror、Monaco Editor、pdf-lib**；引入 **FFmpeg.wasm** 实现浏览器端多格式转码（短音频 < 100ms，长音频 SharedArrayBuffer + Atomics 并行）；具备大文件分片上传（MD5 秒传 + 断点续传）、虚拟页面池（LRU + revokeObjectURL）、HTTP Range Request 流式播放全套工程经验。

**性能优化**
- 精通 **Core Web Vitals** 全链路调优（FCP / LCP / CLS / INP）；熟练使用 **LoAF API、PerformanceObserver** 定位长动画帧与长任务；**Scheduler.postTask** yield 分片拆解同步大计算；设计 3 层自动骨架屏系统（CLS 0.15+ → < 0.02）；主导 ICBU P90 指标全项达标；熟练应用 SSR / 预渲染、WebP / preload、关键 CSS 内联、render-blocking 脚本消除。

**前端工程化**
- 精通 **Vite / Webpack**，主导过大型项目构建全链路优化（冷启动 / 打包体积 / 缓存策略）；熟练应用 **Monorepo（pnpm）**，主导过公司级跨项目组件库建设，复用率 **70%+**；具备运行时配置注入（`window.__CONFIG__`）支持私有化多环境免重新构建实战经验。

**架构设计**
- 熟练应用 **Redux / Zustand / Pinia**；具备微前端、插件化平台（iframe 沙箱 + postMessage 协议）、状态机驱动复杂表单流转、国别化配置驱动架构（Feature Flag + Schema 注入，新增国家只需配置）等复杂架构落地经验。

**全栈与配套能力**
- 精通 **TypeScript**；熟练使用 **Node.js（NestJS）** 处理 BFF 层需求；自研前端监控 SDK（< 5KB gzip，覆盖 JS 运行时错误 / API 异常 / 白屏检测 / LoAF / SourceMap 还原），CI 打包上传 SourceMap 至内网平台（不随 CDN 发布），支撑 20+ 页面稳定性治理，P0 响应降至 **5 分钟内**。

---

### **项目经历**

#### **阿里巴巴 ICBU 海外商品域 & 商增域**（2023.12 - 2025.04）
**技术栈**：React18, TypeScript, Vite, Monorepo (pnpm), Node.js/BFF, Performance API, IndexedDB, Chrome 插件, SSR, 数据埋点

**项目背景 (Situation)**：ICBU 是阿里面向全球买卖家的 B2B 跨境电商平台，核心挑战三重：发品属性体系庞大（百级字段），历史表单单文件 3000+ 行，状态管理混乱；各目标国入驻流程、认证方式、支付渠道均不同，一套代码难以覆盖多国差异；核心交易页面 Web 性能不达标，INP 超 500ms，LCP 超 4s，直接影响转化率。

**核心难点**：
- **INP 超标**：商品管理页存在大量同步计算阻塞主线程，LoAF API 检测到长任务（> 50ms）频发，用户交互响应延迟明显；
- **骨架屏根本矛盾**：千人千面页面「构建期不知运行时布局」，手工维护成本 ~0.5 人日/页，CLS 始终无法稳定达标；
- **多国差异代码腐化**：税制 / 支付 / 合规规则散落 if-else 中，新增国家需改动核心逻辑，回归成本高。

**我的职责 (Action)**：

1. **主导 Core Web Vitals 全链路性能优化**，P90 达到 **FCP < 1000ms / LCP < 2000ms / CLS < 0.02 / INP < 200ms**：
   - LCP：SSR 首屏直出 + Hero 图 WebP / preload；消除 render-blocking 脚本；关键 CSS 内联；
   - INP：**LoAF API** 精准定位长动画帧，**Scheduler.postTask** 将同步大计算拆分为 yield 分片，事件处理只触发最小 UI 更新；
   - CLS：依托 Smarty Skeleton 自动化方案精准预占位，彻底消除内容加载后的布局偏移。

2. **独立设计并落地 3 层 Smarty Skeleton 自动骨架屏系统**，破解「构建期不知运行时布局」的根本矛盾：
   - **内联 JS SDK（极致性能层）**：注入 HTML `<head>`，在 bundle 解析前执行；同步读 **localStorage** 元数据（宽高 / hasCache）立即创建尺寸精确的占位容器，再异步读 **IndexedDB** 取骨架数字数组（每块 `[left%, top%, w%, h%, type]` 五元组，百分比坐标保持响应式），动态生成占位节点；框架水合前骨架已就位，首次像素 **< 500ms**，白屏彻底消除；
   - **NPM 运行时学习层**：首次真实渲染完成后静默 BFS 遍历 DOM，**requestIdleCallback 40ms 预算/帧**时间切片，不阻塞任何交互；对每个节点计算与父节点矩形交集（clip），文本节点减 padding 贴合真实文字区域；**4 路并联叶子识别**（hasChildText / img·input·button 枚举 / 背景图渐变 / `data-skeleton-block` 标记）任一满足即停止递归；邻近块合并（minGap 阈值）消除密集文本碎条；结果双写 localStorage（元数据）+ IndexedDB（完整数组）；
   - **4D 隐式缓存失效**（key = `path + componentId + innerWidth + innerHeight`），视口变化自然 cache miss 触发重新学习，无需显式版本号；componentId 由业务方控制（`card-vip / card-guest`），可扩展千人千面；
   - **Chrome 插件预生成层**：运行时学习覆盖不到 SSR（服务端无 DOM）和首次访问（新用户无缓存）；插件在真实页面叠层可视化预览骨架，开发者调整后一键保存至项目约定路径，提交 git 后 SSR 直接读取，彻底消除首次白屏；
   - CLS **0.15+ → < 0.02**，单页开发成本 **0.5 人日 → 5 分钟（↓95%）**，全团队 **20+ 页面**接入。

3. **独立主导发品表单架构升级**，3000+ 行大文件按模块拆解为 < 500 行/模块；引入**有限状态机**管理多步骤流转（草稿 → 填写中 → 校验中 → 提交中 → 完成），每个状态只声明允许的事件与转移，消除散落的 if-else 分支；统一 Design Token UI 规范，建立灰度发布 + 异常监控告警机制，核心模块代码量 **↓60%+**。

4. **落地 AI 属性补全交互层**，商家输入标题后 500ms 防抖触发 AI 接口，返回推荐属性以浮层展示，一键接受或逐项修改；AI 搬品页设计批量选品 + 类目映射可视化编辑器，属性冲突实时高亮。

5. **设计国别化配置驱动架构**，路由层读取 `countryCode` 动态注入差异化 Schema（表单字段 / 校验规则 / 支付渠道 / 合规提示），Feature Flag 控制功能开关；核心业务组件对国别**完全无感知**，**新增国家只需配置不改业务代码**；落地 OCR 证件识别自动填充，多国本地支付 SDK 统一封装为 `PaymentContext`。

6. **建设数据埋点与稳定性体系**，制定统一曝光 / 点击 / 转化埋点规范，接入漏斗分析与 A/B 实验，精准定位转化断点；快速建立 ICBU 页面稳定性告警体系。

**项目成果 (Result)**：
- Core Web Vitals P90 全指标达标：**FCP < 1000ms / LCP < 2000ms / CLS < 0.02 / INP < 200ms**；
- Smarty Skeleton 落地，CLS **0.15+ → < 0.02**，单页开发成本 **↓95%**（0.5 人日 → 5 分钟），全团队 20+ 页面零维护接入；
- 表单架构升级，核心模块代码量 **↓60%+**，单模块 < 500 行，发布稳定性与 CR 效率显著提升；
- 国别化架构落地，新增国家改造成本从周级降至天级，代码腐化风险大幅降低。

---

#### **滴滴 llab AI 出行体验**（2025.06 - 至今）
**技术栈**：React18 / 微信小程序, TypeScript, SSE, Function Calling, ReactFlow, Canvas, LBS/POI 服务, 多说话人 TTS

**项目背景 (Situation)**：llab 是滴滴探索 AI + 出行场景融合的创新实验室。用户在出行途中有强烈的「景点讲解、路线导游、附近打卡」诉求，传统导航与搜索无法满足沉浸式旅行体验；同时需要探索 AI 工作流编排能力，支持产品无需工程排期快速搭建多步骤 AI 功能。

**核心难点**：
- **流式 JSON 不完整解析**：Function Calling `arguments` 分片到达，中间帧非合法 JSON，直接 `JSON.parse` 崩溃；
- **Agent SSE 乱序**：多节点并行执行时 SSE 事件乱序，画布状态需与实际执行序严格对齐，不能闪烁或丢失；
- **内容调度竞态**：路线实时变化与内容生成 / 播放存在竞态，旧 SSE 回包可能在 abort 后异步污染新内容；
- **AI 长推理等待体验**：复杂地点推理达 15s，如何让等待「可见且有意义」而非让用户误判为卡死。

**我的职责 (Action)**：

1. **独立从 0 到 1 搭建类 Coze AI Agent 工作流编排平台**：
   - 基于 **ReactFlow** 的可视化 DAG 编辑器，支持节点拖拽 / 连线 / 端口类型合法性校验（string / object / array / any，不合法连线实时标红）；
   - 节点类型覆盖：LLM 对话节点（多模型切换）、工具调用节点（搜索 / POI / 天气）、条件分支节点、循环节点、人工审核节点；
   - **运行时可视化**：SSE 实时推送节点状态（pending → running → done / failed），前端维护 `nodeStatus Map` 驱动 ReactFlow 节点样式更新（done 绿 / failed 红 / running 流光动画）；针对乱序 SSE 设计**幂等状态机 + sequence 号**，保证画布状态与实际执行序一致；
   - 工作流 JSON Schema 统一序列化，支持导入导出与版本管理；**AI 功能上线周期从天级压缩至小时级**。

2. **「行中导游」—— 出行 AI 播客的流式内容调度与 Generative UI 工程**：
   - **播放连续性**：借鉴视频预加载缓冲思路，设计**滑动窗口预生产策略**（预生产 3 段 ≥ 15 分钟，消费到第 2 段自动触发下一批 SSE），彻底消除断流；
   - **竞态处理**：用户绕路改道时，`AbortController` 立即中断旧 SSE 并清空队列，引入**版本号校验**防止旧响应异步回包污染新内容；
   - **双人播客 TTS 顺序保证**：双角色对话 TTS 并发请求回包顺序不保证；维护**串行 Promise 队列**按脚本角色序依次合成音频 chunk 后拼接，同时实现路线进度联动自动切景点、手动切换 / 暂停 / 拖拽；
   - **Generative UI 流式 JSON 解析**：Function Calling `arguments` 分片到达，用**括号深度计数**追踪 JSON 完整性，仅合法闭合时实例化 `render_poi_card / render_route_map / render_tip_block` 组件；降级 Markdown 路径采用**增量解析 + rAF 批量 commit**，维护已解析 AST，每帧只 patch 新增 token 对应节点，帧率稳定。

3. **「在哪儿问问」—— 多模态 Agent 推理链路的前端体验工程**（微信小程序）：
   - **长推理等待**：15s 推理通过 SSE 实时流式渲染推理过程（多轮搜索 / 图像分析均可见），让用户「看见 AI 在思考」；推理完成手风琴动画收起推理链，切换为地图卡片 + Markdown 结果态；
   - **动态分流 UI**：根据**首包是否含推理事件**自动分流——有推理 → 展示推理链滚动，无推理 → 骨架屏快速占位，两条路径收敛到相同结果态 UI；
   - **EXIF 矫正提升模型精度**：iOS 相机照片携带 EXIF 方向标记，直接上传模型接收到旋转 90° 图片导致识别准确率明显下降；Canvas 读取 `Orientation` 字段**先矫正方向再压缩**上传，确保模型输入方向正确。

**项目成果 (Result)**：
- 行中导游实现讲解文字 + 双人语音播客 + AI 博客三合一，滑动窗口策略消除内容断流，路线联动播放提供沉浸式导游体验；
- 在哪儿问问首 token 推理响应 **≤ 2s**，端到端搜地点体验流畅；
- Agent 编排平台让业务无需工程排期搭建复杂 AI 工作流，**AI 功能上线周期从天级压缩至小时级**；
- Generative UI 建立 Function Calling → buffer 拼接 → 动态组件实例化的前端范式，AI 内容渲染从纯文字升级为富交互组件流。

---

#### **科大讯飞 ToB SaaS 矩阵**（2018.07 - 2023.07）
**技术栈**：React18, TypeScript, ProseMirror, Yjs, WebSocket/SSE, AudioWorklet, Canvas, Web Worker, pdf-lib, Monaco Editor, pdfium-wasm, FFmpeg.wasm, 自研前端监控 SDK

**项目背景 (Situation)**：公司 AI 能力（语音转写、OCR、多模态翻译）缺乏企业级产品载体；ToB 场景下大体量文档处理（23 种格式、1GB+ 媒体）、多人协作审校、合规签署等诉求在业界无成熟纯前端解决方案，传统桌面客户端部署成本高、迭代慢，制约 AI 能力商业化速度。

**核心难点**：
- **多人并发冲突**：多译员同时编辑同一文档段落，OT 算法需要中央服务器做变换，离线场景和私有化部署均无法处理；
- **大文件渲染不崩溃**：百页 PDF 全量渲染内存溢出，Canvas 节点爆炸，低端设备帧率崩溃；
- **私有化部署差异大**：6 个 SaaS 平台 + 多套私有化环境，线上问题难以复现和定位。

**我的职责 (Action)**：

1. **独立攻克多人实时协同编辑**，选型 CRDT（Yjs）而非 OT：CRDT 操作可交换结合，天然支持离线和 P2P，无需中央服务器做变换；Awareness 协议广播光标 / 选区感知；段落级编辑锁防止重复翻译；增量 Op（< 1KB）+ 服务端广播支持百人并发；IndexedDB 持久化保障断线后自动恢复。

2. **设计并实现浏览器端全模态文档处理引擎**，支持 23 种文档格式、8 种音频、9 种视频格式，文件支持 1GB+；核心方案：服务端统一转换管道 + PDF.js + Canvas 分页渲染 + **虚拟页面池**（仅维护可视区 ±2 页，LRU 淘汰 + revokeObjectURL 及时释放）+ Web Worker 异步解析 + HTTP Range Request 按需加载；后期引入 **pdfium-wasm** 替代 PDF.js（C++ WASM，百页文档渲染耗时降低 60%+，动态 import ~3MB 按需加载）；引入 **FFmpeg.wasm** 实现浏览器端 PCM / MP3 / WAV 转码（短音频 < 100ms，长音频 SharedArrayBuffer + Atomics 并行）；首屏可见时间降低 **70%+**，内存峰值降低 **60%+**。

3. **构建所见即所得文档编辑能力**，基于 ProseMirror 打造富文本编辑内核，维护文档 AST 与渲染层双向同步；DOCX / XLSX / PPT 采用 JSZip + xml2js 结构化解析与二进制序列化导出，格式还原度 **95%+**；段落级双栏译文对照编辑器（Myers Diff 字符级高亮 + react-window 虚拟列表），万级段落无卡顿。

4. **落地实时语音转写前端链路**，**AudioWorklet** 独立音频线程采集 PCM（16kHz / 单声道 / 帧长 160ms），解决 ScriptProcessor 在主线程运行复杂页面丢帧问题；双重 VAD（能量阈值 + 过零率）过滤静音帧（上行带宽降低 **50%**），有效帧 WebSocket 实时推送 ASR；partial / final 结果分级增量渲染（partial 灰色叠加不触发重排，收到 final 原地替换），字随声出，端到端延迟 **< 800ms**；同步落地**在线配音制作**（WebAudio API + TTS 时间轴字幕对齐 + Web Worker WAV 导出）。

5. **交付电子签全链路**，Canvas 三阶贝塞尔曲线手写签名（采集压力点序列拟合，平滑无锯齿，支持触控）；pdf-lib 写入签章坐标，SHA-256 哈希锁定文档完整性；有限状态机管理多方签署流程（顺序签 / 并行签），WebSocket 实时推送进度，动态水印防截图。

6. **负责文本校对与合规引擎**，三层混合规则（关键词黑名单 → 正则匹配 → AI 语义），结果以字符区间为 key 取最高风险等级去重渲染；300ms 防抖 + SSE 流式 + 字符级 Diff 高亮，支持逐条 Accept / Reject。

7. **建设 AILab 能力集市**，Monaco Editor + 虚拟目录树实现代码仓库在线预览（对齐 GitHub Web IDE 体验）；iframe 沙箱 + postMessage 协议，AI Demo 以 JSON 配置零代码接入，平台与 Demo 完全解耦，新能力上线无需改动平台代码。

8. **沉淀跨平台公共组件库与工程规范**，抽象文件上传器、标注画板、AI 流式输出面板、媒体播放器、音频时间轴等核心组件，复用率 **70%+**；运行时配置注入（`window.__CONFIG__`），Nginx 在 HTML 注入不同 env，免重新构建支持多套私有化环境；私有化部署交付周期从 **5-7 天压缩至 1-2 天**。

9. **从 0 搭建六平台前端监控体系**，自研轻量监控 SDK（**< 5KB gzip**），覆盖 JS 运行时错误（全局 onerror + unhandledRejection）、API 异常（fetch/xhr 劫持采集 status / 耗时）、白屏检测（DOMContentLoaded 后 MutationObserver + 9 点坐标采样双重验证，骨架屏场景不误报）、LoAF 长任务（PerformanceObserver）；CI 打包将 SourceMap 上传内网平台（不随 CDN 发布），线上 error stack 自动还原到源码行号；异常聚合去重接入钉钉 / 邮件告警，**P0 问题响应从小时级降至 5 分钟内**，私有化客户侧故障排查效率提升 **80%+**。

**项目成果 (Result)**：
- 首屏可见时间 **↓70%+**，内存峰值 **↓60%+**，pdfium-wasm 渲染耗时 **↓60%+**，格式还原度 **95%+**；
- 监控 SDK 上线，P0 问题响应从小时级降至 **5 分钟内**，私有化客户侧故障排查效率 **↑80%+**；
- 3 个平台商业化盈利，合计年 ARR **近千万**；合同签署周期 **天级 → 分钟级**；私有化部署周期 **5-7 天 → 1-2 天**；
- 组件库复用率 **70%+**，新平台启动成本降低 **70%+**，成为部门前端架构标准底座。

---

#### **技术 Portfolio（面试可演示）**

- **collab-editor**（React18 + TypeScript + Yjs + TipTap + WebRTC）：多人实时协同编辑器完整 demo。
  - **CRDT 协同**：Yjs UndoManager 接管 History，协同感知撤销（只回滚本人 Op，不影响他人）；
  - **传输层**：优先 BroadcastChannel（同机器多 Tab 零延迟），降级 WebRTC P2P 信令，无需自建服务端；
  - **段落感知**：自定义 ProseMirror DecorationSet 插件，将他人正在编辑的段落渲染为彩色边框；
  - **工程细节**：useMemo 保证 ydoc/provider 引用稳定；peersRef 解决 Plugin 闭包陈旧引用；仅段落 pos 变化时广播，避免频繁 Awareness 更新。

---

## 面试深挖速查

| 方向 | 高频问题 | 核心答案 |
|------|---------|---------|
| 大文件 | 1GB 文件上传怎么保证成功率？ | 5MB 分片 + MD5 秒传 + 断点续传，失败只重传出错的片段 |
| 渲染 | 23 种格式怎么不各写一套？ | 服务端统一转 PDF 管道，前端一套渲染逻辑，格式差异在服务端消化 |
| 内存 | 大文档怎么不崩溃？ | 虚拟页面池 LRU 淘汰 + revokeObjectURL + Worker 独立堆内存 |
| 编辑 | DOCX 编辑后格式为什么不乱？ | JSZip 解压 → 精准修改目标 XML 节点 → 重新打包，不碰其他节点 |
| 协同 | 为什么选 CRDT 不用 OT？ | OT 需要中央服务器做变换，离线无法处理；CRDT 操作可交换结合，天然支持离线和 P2P |
| 协同 | 百人并发怎么不卡？ | 只传增量 Op（< 1KB）+ 服务端广播，不同步全文档状态 |
| 协同 | 段落锁怎么实现的？ | 编辑时广播锁定 Op，其他客户端收到后 UI 置灰该段落，释放时广播解锁 |
| 协同-撤销 | 协同下撤销为什么用 UndoManager？ | 原生 history 撤销会连别人的 Op 一起撤；UndoManager 只追踪本地用户 Op |
| 协同-离线 | 断网编辑重连后怎么合并？ | 离线时 Yjs 正常生成 Op 存 IndexedDB；重连后广播离线 Op；CRDT 保证可交换自动合并 |
| WASM | 为什么用 pdfium-wasm 而不是继续用 PDF.js？ | PDF.js 是 JS 实现，百页以上渲染主线程占用高；pdfium-wasm 基于 C++ 编译在 Worker 线程运行，快 1-2 个数量级；代价包体约 3MB，动态 import 按需加载 |
| WASM | FFmpeg.wasm 转码会不会很慢？ | WASM 约为原生 1/2-1/3，但远快于往返服务端；短音频百毫秒内完成；长音频 SharedArrayBuffer + Atomics 并行 |
| 语音转写 | AudioWorklet 比 ScriptProcessor 好在哪？ | ScriptProcessor 在主线程运行，复杂页面丢帧；AudioWorklet 独立音频线程，零主线程占用 |
| 语音转写 | partial/final 结果怎么渲染不闪烁？ | partial 用 span 绝对定位叠在 final 末尾颜色灰色；收到 final 时原地替换并移除 partial span，不重排 |
| 骨架屏 | 骨架屏自动化怎么保证高度和真实内容一致？ | 运行时 DOM 遍历：真实渲染后 SDK 对关键节点做 getBoundingClientRect，计算与父节点矩形交集（clip）后生成百分比定位骨架块 |
| 骨架屏 | 缓存怎么失效？有没有版本号？ | 4D key（path + componentId + innerWidth + innerHeight）隐式失效，视口变化自然 cache miss，无需显式版本号 |
| 骨架屏 | 为什么用双存储（localStorage + IndexedDB）？ | localStorage 同步 API 存元数据立即读取先占位；骨架数组存 IndexedDB（异步不阻塞、无 5MB 限制）；不存 HTML 字符串，体积更小 |
| 监控 | 白屏检测怎么实现不误报？ | MutationObserver 监测关键容器 + 9 点坐标采样双重验证；骨架屏白名单排除误报；Performance 时序二次确认 |
| 监控 | SourceMap 线上还原怎么做的？ | CI 打包时 .map 上传内网监控平台（不随 CDN 发布）；上报 errorStack 后平台用 source-map 库还原到源文件行号 |
| 阿里-性能 | LCP 从 4s 到 < 2s 你做了什么？ | SSR 首屏直出 + Hero 图 WebP/preload；去除 render-blocking 脚本；关键 CSS 内联 |
| 阿里-性能 | INP 怎么从 500ms 优化到 < 200ms？ | LoAF API 定位长任务，Scheduler.postTask 拆分同步大计算为 yield 分片；事件处理只做最小 UI 更新 |
| 阿里-架构 | 发品表单状态机怎么设计的？ | 定义状态枚举，每个状态允许的事件与转移写成配置表；组件只根据当前状态渲染，消除 if-else 分支 |
| 阿里-国别化 | 一套代码怎么支持多国差异？ | 路由层读 countryCode 动态注入差异化 Schema，Feature Flag 控功能开关，核心组件对国别无感知 |
| AI 流式 | SSE 连接断了怎么处理？ | fetch + ReadableStream 手动维护：catch 错误后指数退避重试，reconnect 成功后从中断 token 继续渲染 |
| AI 流式 | 大模型首字慢怎么优化用户感知？ | 发请求时立即显示骨架屏动画，首个 token 到达时无缝切换打字机；10s 无响应显示重试按钮 |
| 生成式 UI | Generative UI 和 Markdown 渲染有什么区别？ | Markdown 是被动文字排版；Generative UI 是 LLM 通过 Function Calling 声明组件类型，前端实例化真正的 React 组件，有真实交互能力 |
| 生成式 UI | Function Calling 的 chunk 怎么处理？ | arguments 字段 JSON 字符串分片到达，用括号深度计数追踪完整性，合法 JSON 才 parse 实例化；parse 失败降级文字渲染 |
| Agent 编排 | DAG 连线怎么做类型合法性校验？ | 每种节点定义输入输出端口类型 Schema；连线时做兼容性 check（any 可接受一切，string 不能连 object）；不合法连线实时标红 |
| Agent 编排 | 运行时节点状态怎么和画布同步不乱序？ | 维护 nodeStatus Map + 幂等状态机（done/failed 后忽略后续）；SSE event 带 sequence 号，乱序到达时按 sequence 重放 |
| 滴滴-导游 | 内容断流怎么解决？ | 滑动窗口预生产：预生产 3 段 ≥ 15 分钟，消费到第 2 段自动触发下一批 SSE，缓冲始终存在 |
| 滴滴-导游 | 路线变化竞态怎么处理？ | AbortController 立即中断旧 SSE，清空队列，版本号校验防止旧响应回包污染新内容 |
| 滴滴-在哪儿 | 15s 推理等待怎么不让用户误以为卡死？ | 推理过程 SSE 实时流式渲染（多轮搜索 / 图像分析过程可见），推理完成手风琴动画收起切结果态 |
| 私有化 | 部署周期怎么从周级压缩到天级？ | 环境变量统一抽象，构建产物 + nginx + docker-compose 模板化；客户侧只需填 env 文件执行一条命令 |
