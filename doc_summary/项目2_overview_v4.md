---

### **个人亮点**
- **10年+前端开发经验**，先后任职于科大讯飞、阿里巴巴、滴滴等头部企业，深耕 **AI前端工程化、多人协同、大文件处理、性能优化** 领域，主导过 10+ 核心技术项目与商业化产品。
- **AI 前端工程化专家**：落地过**类 Coze AI Agent 工作流编排平台**（ReactFlow DAG + SSE 运行时可视化）与 **Generative UI**（Function Calling → 动态 React 组件流式实例化）；落地过景点讲解 + TTS 语音合成 + 路线联动播放器、多模态兴趣图搜等 AI 出行产品；精通 AI 流式全链路（`fetch` + `ReadableStream` 手动消费 SSE、增量 Markdown 解析 + rAF 批量 commit、Generative UI JSON 分片解析），具备 AudioWorklet 实时语音采集、多模态图像预处理全链路工程经验。
- **智能化工程工具创造者**：自研 **Smarty Skeleton** 三层骨架屏自动化系统（内联 SDK + 运行时自学习 NPM 包 + Chrome 预生成插件），从根本上解决千人千面页面「构建期无 DOM、运行时无需骨架」的矛盾；方案落地 **20+ 页面**，单页开发成本 **↓95%**（0.5 人日 → 5 分钟），CLS 从 0.15+ 降至 **< 0.02**，推广全团队使用。
- **协同系统设计者**：独立设计并落地完整的多人实时协同编辑系统；基于 **CRDT（Yjs）** 解决多人并发冲突，Awareness 协议实现光标感知，增量 Op（< 1KB）+ IndexedDB 持久化支持**百人并发与离线恢复**。
- **大文件与文档处理专家**：主导实现浏览器端 23 种格式文档、1GB+ 音视频预览/编辑/标注/导出全闭环；虚拟页面池 + Web Worker + HTTP Range Request 方案使首屏可见时间降低 **70%+**，内存峰值降低 **60%+**。
- **Web 性能优化专家**：主导阿里 ICBU 核心页面 Core Web Vitals 全链路调优，关键页面 P90 达到 **FCP < 1000ms、LCP < 2000ms、CLS < 0.02、INP < 200ms**；熟练使用 LoAF / Scheduler.postTask 定位并拆分长任务。
- **工程化与团队建设**：主导公司级 Monorepo 组件库建设，复用率 **70%+**；带领 4 人团队在多平台并行场景下高质量交付，沉淀部门前端架构标准底座。

---

### **技术能力**

**核心技术栈**
- 精通 **React(18)** / **Vue(3)**，深入理解 Fiber 调度、Diff 算法、响应式原理；主导过 ICBU 海外 20+ 核心业务页面架构升级，支撑千万级 UV 访问。

**AI 前端工程化**
- 精通 AI 流式全链路：使用 **`fetch` + `ReadableStream`** 手动消费 SSE 流（相比 `EventSource` 支持 POST、自定义 Authorization Header、AbortController 精确中断）；流式 token 高频到来时采用**增量 Markdown 解析 + `requestAnimationFrame` 批量 commit**，避免全量重 parse 导致帧率下降；落地过 **Generative UI**（Function Calling JSON 分片流 → 括号深度计数 → 动态 React 组件实例化，parse 失败降级 Markdown）与**类 Coze Agent 编排平台**（ReactFlow DAG + 运行时状态 SSE 推送 + 幂等状态机）；熟练处理多模态输入（Canvas 图像压缩/EXIF 矫正、AudioWorklet PCM 采集）。

**实时通信与协同**
- 精通 **WebSocket / SSE**，SSE 接入优先使用 **`fetch` + `ReadableStream`**（支持请求头携带 Token、AbortController 流级中断、背压感知），而非受限的原生 `EventSource`；独立落地基于 **CRDT（Yjs）** 的多人协同编辑系统，支持百人并发；熟练使用 **Web Worker、SharedArrayBuffer** 处理计算密集型任务，保障主线程不阻塞。

**文档与富媒体处理**
- 精通 **Canvas / SVG**；熟练使用 **PDF.js、ProseMirror、Monaco Editor、pdf-lib**；具备大文件分片上传（MD5 秒传 + 断点续传）、虚拟渲染、流式播放的完整工程经验；引入 **WASM**（pdfium-wasm / FFmpeg.wasm）实现浏览器端 PDF 渲染加速与音视频转码。

**性能优化**
- 精通 **Core Web Vitals** 全链路调优（FCP/LCP/CLS/INP），熟练使用 LoAF、PerformanceObserver 定位长任务；主导 ICBU 核心页面 P90 指标全项达标；熟练 SSR/预渲染、图片格式优化、关键渲染路径精简、Scheduler.postTask 拆分。

**前端工程化与构建**
- 精通 **Vite / Webpack**，主导过大型项目构建优化（冷启动、打包体积、缓存策略）；熟练应用 **Monorepo（pnpm）**；主导公司级跨项目组件库建设，复用率 70%+。

**架构设计**
- 熟练应用 **Redux / Zustand / Pinia**；具备微前端、插件化平台（iframe 沙箱 + postMessage 协议）、状态机驱动复杂表单流转等架构落地经验。

**全栈与配套能力**
- 精通 **TypeScript**；熟练使用 **Node.js（NestJS）** 处理 BFF 层需求；具备前端监控 SDK 建设经验（JS 错误、API 异常、白屏检测、LoAF、SourceMap 还原），支撑 20+ 页面稳定性治理，线上问题排查效率提升 **80%+**。

---

### **项目经历**

#### **滴滴 llab AI 出行体验**（2025.06 - 至今）
- **技术栈**：React18 / 微信小程序, TypeScript, SSE, Function Calling, ReactFlow, Canvas, 地图 SDK, LBS/POI 服务, 多说话人 TTS

- **项目背景 (Situation)**：llab 是滴滴探索 AI + 出行场景融合的创新实验室。用户在出行途中有强烈的「景点讲解、路线导游、附近打卡」诉求，传统导航与搜索无法满足沉浸式旅行体验；同时需要探索 AI 工作流编排能力，支持产品无需工程排期快速搭建多步骤 AI 功能。

- **核心难点**：
  - **流式 JSON 不完整解析**：Function Calling `arguments` 分片到达，中间帧非合法 JSON，直接 parse 崩溃；
  - **Agent SSE 乱序**：多节点并行执行时 SSE 乱序，画布状态需与实际执行序严格对齐；
  - **出行内容调度竞态**：路线实时变化与内容生成/播放存在竞态，旧 SSE 回包可能在 abort 后异步污染新内容；
  - **AI 长推理等待体验**：复杂地点推理达 15s，如何让等待「可见且有意义」而非让用户误判为卡死。

- **我的职责 (Action)**：

  1. **独立从 0 到 1 搭建类 Coze 的 AI Agent 工作流编排平台**：
     - 基于 **ReactFlow** 的可视化 DAG 编辑器，支持节点拖拽、连线、端口类型合法性校验（string/object/array/any，不合法连线实时标红）；
     - 节点类型覆盖：LLM 对话节点（多模型切换）、工具调用节点（搜索/POI/天气）、条件分支节点（变量判断路由）、循环节点、人工审核节点；
     - **运行时可视化**：SSE 实时推送节点状态（pending → running → done/failed），前端维护 nodeStatus Map 驱动 ReactFlow 节点样式更新（done 绿/failed 红/running 流光动画）；针对乱序 SSE 设计幂等状态机，保证画布状态与实际执行序列一致；
     - 工作流 JSON Schema 统一序列化，支持导入导出与版本管理。

  2. **「行中导游」—— 出行 AI 播客的流式内容调度与 Generative UI 工程**：
     - **播放连续性难题**：全量等待内容生成耗时过长，按需逐段请求又面临「播到一半无内容」的空档；借鉴视频预加载缓冲思路，设计**滑动窗口预生产策略**（预生产 3 段 ≥15 分钟，消费到第 2 段自动触发下一批 SSE），彻底消除断流；
     - **路线变化的竞态处理**：用 `AbortController` 立即中断旧 SSE 并清空待播队列，引入版本号校验防止旧响应异步回包污染新内容；
     - **双人播客 TTS 顺序保证**：双角色 `原野/晓曼` 对话 TTS 并发请求时回包顺序不保证；维护**串行 Promise 队列**，按脚本角色序依次合成音频 chunk 后拼接，同时实现路线进度联动自动切景点、支持手动切换/暂停/拖拽；
     - **Generative UI 流式 JSON 解析**：Function Calling 的 `arguments` 分片流式到达，中间状态直接 `JSON.parse` 必然抛异常；用**括号深度计数**追踪 JSON 完整性，仅在合法闭合时实例化 `render_poi_card / render_route_map / render_tip_block` 组件；降级 Markdown 路径采用**增量解析 + `requestAnimationFrame` 批量 commit**，维护已解析 AST，每帧只 patch 新增 token 对应节点，帧率稳定。

  3. **「在哪儿问问」—— 多模态 Agent 推理链路的前端体验工程**（微信小程序）：
     - **长推理等待 vs 用户流失**：无标识建筑需多轮搜索+推理，响应可达 15s；将推理过程通过 SSE 实时流式渲染，让用户「看见 AI 在思考」；推理完成后手风琴动画收起推理链，切换为地图卡片 + markdown 结果态；
     - **简单/复杂场景体验分流**：前端根据**首包是否含推理事件**动态分流：有推理 → 展示推理链滚动，无推理 → 骨架屏快速占位，两条路径收敛到相同的结果态 UI；
     - **EXIF 旋转影响模型识别准确率**：iOS 相机照片携带 EXIF 方向标记，直接上传模型收到旋转 90° 图片，识别准确率明显下降；小程序 Canvas 读取 `Orientation` 字段，**先矫正方向再压缩**后发送。

- **项目成果 (Result)**：
  - 行中导游实现讲解文字 + 双人语音播客 + AI 博客三合一，滑动窗口策略**彻底消除内容断流**，路线联动播放提供沉浸式导游体验；
  - 在哪儿问问推理链路 SSE 流式展示 + 手风琴收起 + 地图卡片，**首 token 推理响应 ≤ 2s**，端到端搜地点体验流畅；
  - Agent 编排平台让业务无需工程排期即可搭建复杂 AI 工作流，**AI 功能上线周期从天级压缩至小时级**；
  - Generative UI 建立 Function Calling → buffer 拼接 → 动态组件实例化的前端范式，AI 内容渲染从纯文字升级为富交互组件流。

---

#### **科大讯飞 ToB SaaS 矩阵**（2018.07 - 2023.07）
- **技术栈**：React18, TypeScript, ProseMirror, Yjs, WebSocket/SSE, AudioWorklet, Canvas, Web Worker, pdf-lib, Monaco Editor, WASM, 前端监控 SDK

- **项目背景 (Situation)**：公司 AI 能力（语音转写、OCR、多模态翻译）缺乏企业级产品载体；ToB 场景下大体量文档处理（23 种格式、1GB+ 媒体）、多人协作审校、合规签署等诉求在业界无成熟纯前端解决方案，传统桌面客户端部署成本高、迭代慢。

- **核心难点**：
  - **多人并发冲突**：多译员同时编辑同一文档段落，OT 算法需要中央服务器做变换，离线场景无法处理；
  - **大文件渲染不崩溃**：百页 PDF 全量渲染内存溢出，Canvas 节点数量爆炸，低端设备帧率崩溃。

- **我的职责 (Action)**：

  1. **独立攻克多人实时协同编辑**，选型 CRDT（Yjs）而非 OT，原因：CRDT 操作可交换结合，天然支持离线和 P2P，无需中央服务器做变换；Awareness 协议广播光标/选区实时感知；设计段落级编辑锁防止重复翻译；增量 Op（< 1KB）+ 服务端广播支持百人并发；IndexedDB 持久化保障离线断线后自动恢复。

  2. **设计并实现浏览器端全模态文档处理引擎**，支持 23 种文档格式、1GB+ 音视频；核心方案：服务端统一转换管道 + PDF.js + Canvas 分页渲染 + **虚拟页面池**（仅维护可视区 ±2 页，LRU 淘汰 + revokeObjectURL 释放内存）+ Web Worker 异步解析 + HTTP Range Request 按需加载；后期引入 **pdfium-wasm** 替代纯 JS 渲染，百页文档渲染耗时降低 60%+；引入 **FFmpeg.wasm** 实现浏览器端 PCM/MP3/WAV 转码，导出延迟从秒级降至百毫秒级；首屏可见时间降低 **70%+**，内存峰值降低 **60%+**。

  3. **构建所见即所得文档编辑能力**，基于 ProseMirror 打造富文本编辑内核，维护文档 AST 与渲染层双向同步；DOCX/XLSX/PPT 采用 JSZip + xml2js 结构化解析与二进制序列化导出，格式还原度 **95%+**；段落级双栏译文对照编辑器（Myers Diff 字符级高亮 + react-window 虚拟列表），万级段落无卡顿。

  4. **落地实时语音转写前端链路**，**AudioWorklet** 独立音频线程采集 PCM（16kHz/单声道/帧长 160ms），解决 ScriptProcessor 在主线程运行丢帧的问题；WebSocket 流式上传；识别结果按 partial（灰色占位）/ final（固定黑色）分级增量渲染，字随声出；MessageChannel 解耦 Worker 与主线程，不阻塞编辑区。同步落地**在线配音制作**（Web Audio API + TTS 时间轴字幕对齐，多轨 PCM 混合在 Worker 线程封 WAV 导出，主线程零阻塞）。

  5. **交付电子签全链路**，Canvas 三阶贝塞尔曲线手写签名（采集压力点序列拟合，平滑无锯齿）；pdf-lib 写入签章坐标，SHA-256 哈希锁定文档完整性；有限状态机管理多方签署流程（顺序签/并行签），WebSocket 推送进度，动态水印防截图。

  6. **负责文本校对与合规引擎**，三层混合规则（关键词黑名单 → 正则 → AI 语义），结果按高危/中危/低危定位到字符区间；300ms 防抖 + SSE 流式 + 字符级 Diff 高亮，支持逐条 Accept/Reject。

  7. **建设 AILab 能力集市**，Monaco Editor + 虚拟目录树实现代码仓库在线预览；iframe 沙箱 + postMessage 协议，AI Demo 以 JSON 配置零代码接入，平台与 Demo 完全解耦。

  8. **沉淀公共组件库与工程规范**，抽象文件上传器、标注画板、AI 流式输出面板、媒体播放器，复用率 **70%+**；私有化部署配置脚本化，交付周期从周级压缩至天级。

  9. **从 0 搭建六平台前端监控体系**，6 个 SaaS 平台 + 私有化部署环境差异大，线上问题难以复现；自研轻量监控 SDK（< 5KB gzip），覆盖 **JS 运行时错误**（全局 onerror + unhandledRejection）、**API 异常**（fetch/xhr 劫持采集 status/耗时）、**白屏检测**（DOMContentLoaded 后关键节点心跳 + 9 点坐标采样双重验证）、**长任务**（PerformanceObserver LongTask）；CI 打包时将 SourceMap 上传内网平台（不随 CDN 发布），线上 error stack 自动还原到源码行号；异常聚合去重后接入钉钉/邮件告警，P0 问题响应从小时级降至 **5 分钟内**，私有化客户侧故障排查效率提升 **80%+**。

- **项目成果 (Result)**：
  - 首屏可见时间 **↓70%+**，内存峰值 **↓60%+**，格式还原度 **95%+**，百页文档 WASM 渲染耗时 **↓60%+**；
  - 监控 SDK 上线后，P0 问题响应从小时级降至 **5 分钟内**，客户侧故障排查效率 **↑80%+**；
  - 3 个平台商业化盈利，合计年收入**近千万**；合同签署周期从**天级→分钟级**；
  - 组件库复用率 **70%+**，新平台启动成本降低 **70%+**，成为部门前端架构标准底座。

---

#### **阿里巴巴 ICBU 海外商品域 & 商增域**（2023.12 - 2025.04）
- **技术栈**：React18, TypeScript, Vite, Monorepo (pnpm), Node.js/BFF, Performance API, IndexedDB, Chrome 插件, 数据埋点, SSR

- **项目背景 (Situation)**：ICBU 是阿里巴巴面向全球买卖家的 B2B 跨境电商平台。核心技术挑战：发品属性体系庞大（百级字段），历史表单代码单文件 3000+ 行，状态管理混乱；各目标国入驻流程、认证方式、支付渠道均不同，一套代码难以覆盖多国差异；核心交易页面 Web 性能不达标，INP 超 500ms，LCP 超 4s。

- **核心难点**：
  - **INP 超标**：商品管理页存在大量同步计算阻塞主线程，LoAF 检测长任务频发，用户交互响应延迟明显；
  - **骨架屏难维护**：商品页千人千面，不同国家/类目/用户层级页面结构差异大，手动为每个页面编写骨架屏成本高（~0.5 人日/页），CLS 优化不达预期；
  - **多国差异难维护**：税制/支付/合规规则分散在业务代码 if-else 中，新增国家需改动核心逻辑，风险高。

- **我的职责 (Action)**：

  1. **主导 Core Web Vitals 全链路性能优化**，P90 指标达到 **FCP < 1000ms、LCP < 2000ms、CLS < 0.02、INP < 200ms**；LCP 优化：SSR 首屏直出 + Hero 图 WebP/preload；INP 优化：LoAF API 定位长任务，Scheduler.postTask 将同步大计算拆分为 yield 分片，事件处理只做最小 UI 更新；CLS 优化：依托骨架屏自动化方案（见下）精准预占位，彻底消除内容加载后的布局偏移。

  2. **设计并落地骨架屏自动化系统（Smarty Skeleton）**：

     千人千面页面骨架屏有个根本矛盾——**构建期不知道运行时布局，运行时渲染完毕何需骨架**。Smarty Skeleton 的破局方式：**将首次渲染作为"学习投资"**，SDK 静默采集真实 DOM 布局并持久化，从第二次访问起骨架屏自动还原、精准匹配、零人工维护。系统分三层交付：

     - **内联 JS SDK（极致性能层）**：注入 HTML `<head>`，在框架 bundle 解析前即执行；同步读 **localStorage** 元数据（`{width,height,hasCache}`）立即创建正确尺寸占位容器，再异步读 **IndexedDB** 取骨架数字数组、按百分比坐标动态生成占位节点；框架水合前骨架已就位，FP **< 500ms**，白屏彻底消失；

     - **NPM 包（运行时学习层）**：首次真实渲染完成后静默触发 DOM 采集——**BFS + requestIdleCallback 时间切片**（40ms 预算/帧，不阻塞交互）；对每个节点计算与父节点的**矩形交集（clip）**，文本节点减去 padding 贴近真实文字区域；**4 路并联叶子识别**（hasChildText / img·input·button 等枚举标签 / 背景图渐变 / `data-skeleton-block`）任一满足即停止递归；**邻近块合并**（minGap 阈值）消除密集文本的碎条；采集结果序列化为**紧凑数字数组**（每个骨架块以 `[left%, top%, w%, h%, type]` 五元组表示），双写至 **localStorage**（元数据）和 **IndexedDB**（完整数组）；CLS **0.1X → < 0.02**；

     - **Chrome 插件（预生成层）**：解决 SSR（服务端无 DOM）和首次访问（新用户无缓存）两个运行时 SDK 覆盖不到的场景；插件在真实页面叠层可视化预览骨架结构，开发者交互式调整遮盖区域，确认后一键保存至**项目约定路径**，提交 git 后 SSR 直接读取预生成产物，彻底消除首次白屏；

     - **四维隐式缓存失效**：key = `path + componentId + innerWidth + innerHeight`，视口变化自然触发 cache miss 重新学习，无需显式版本号；componentId 由业务方控制（`card-vip` / `card-guest`）扩展千人千面；

     方案推广全团队，海外 **20+ 页面**全面接入，单页开发成本 **0.5 人日 → 5 分钟**。

  3. **独立主导发品表单架构升级**，3000+ 行大文件按模块拆解为 < 500 行/模块；引入**状态机**管理复杂多步骤流转（草稿 → 填写中 → 校验中 → 提交中 → 完成），每个状态只声明允许的事件与转移，消除散落的 if-else 分支；统一 Design Token UI 规范，消除多年迭代产生的样式碎片化；建立灰度发布 + 异常监控告警机制。

  4. **落地 AI 属性补全交互层**，商家输入标题后 500ms 防抖触发 AI 接口，返回推荐属性列表以浮层展示，用户一键接受或逐项修改；AI 搬品页设计批量选品 + 类目映射可视化编辑器，属性冲突实时高亮标红。

  5. **设计国别化配置驱动架构**，路由层读取 countryCode 动态注入差异化 Schema（表单字段/校验规则/支付渠道/合规提示），Feature Flag 控制功能开关，核心业务组件对国别无感知，**新增国家只需配置不改业务代码**；落地 OCR 证件识别自动填充，多国本地支付 SDK 统一封装为 PaymentContext。

  6. **建设数据埋点体系**，制定统一曝光/点击/转化埋点规范，接入漏斗分析与 A/B 实验，精准定位转化断点；复用讯飞阶段沉淀的监控 SDK，快速建立 ICBU 页面稳定性告警体系。

- **项目成果 (Result)**：
  - Core Web Vitals 全指标 P90 达标（**FCP < 1000ms / LCP < 2000ms / CLS < 0.02 / INP < 200ms**）；
  - Smarty Skeleton 落地，CLS **从 0.15+ 降至 < 0.02**，单页开发成本 **↓95%**（0.5 人日 → 5 分钟），20+ 页面全面接入；
  - 表单架构升级，核心模块代码量 **↓60%+**，单模块 < 500 行，发布稳定性与 CR 效率显著提升。

---

#### **技术 Portfolio（面试可演示）**

- **collab-editor**（React18 + TypeScript + Yjs + TipTap + WebRTC）：多人实时协同编辑器完整 demo。
  - **CRDT 协同**：Yjs UndoManager 接管 History，协同感知撤销（只回滚本人 Op，不影响他人）；
  - **传输层**：优先 BroadcastChannel（同机器多 Tab 零延迟），降级 WebRTC P2P 信令，无需自建服务端；
  - **段落感知**：自定义 ProseMirror DecorationSet 插件，将他人正在编辑的段落渲染为彩色边框；
  - **工程细节**：useMemo 保证 ydoc/provider 引用稳定；peersRef 解决 Plugin 闭包陈旧引用；仅段落 pos 变化时广播，避免频繁 Awareness 更新。

- **smarty-skeleton**（内联 JS SDK + NPM 运行时包 + Chrome 插件三层架构）：千人千面页面骨架屏自动化方案。
  - **学习投资策略**：首次真实渲染后 BFS + requestIdleCallback 静默采集真实 DOM 布局，序列化为 `[left%, top%, w%, h%, type]` 五元组数字数组，双写 localStorage/IndexedDB；
  - **极致启动性能**：内联 SDK 在 `<head>` 同步读元数据预占位，异步读骨架数据生成占位节点，FP < 500ms；
  - **SSR/首次访问**：Chrome 插件可视化预览一键生成预产物，随 git 提交后 SSR 直接消费，新用户无白屏；
  - **四维隐式缓存失效**：path + componentId + 视口宽高，视口变化自然触发重学习，无版本号管理负担。

- **ai-agent-workflow**（ReactFlow + TypeScript + SSE + Zustand）：类 Coze AI Agent 工作流编排平台 demo。
  - 支持 LLM / 工具调用 / 条件分支 / 循环 / 人工审核节点；端口类型合法性校验，不合法连线实时标红；
  - 运行时 SSE 推送节点状态，幂等状态机（状态只能单向流转，done/failed 后忽略后续消息）保证乱序 SSE 下画布状态正确；
  - 工作流序列化为 JSON Schema，支持导入导出与版本管理，平台与业务逻辑完全解耦。

---

## 面试深挖速查

| 方向 | 高频问题 | 核心答案 |
|------|---------|---------|
| 大文件 | 1GB文件上传怎么保证成功率？ | 5MB分片 + MD5秒传 + 断点续传，失败只重传出错的片段 |
| 渲染 | 23种格式怎么不各写一套？ | 服务端统一转PDF管道，前端一套渲染逻辑，格式差异在服务端消化 |
| 内存 | 大文档怎么不崩溃？ | 虚拟页面池LRU淘汰 + revokeObjectURL + Worker独立堆内存 |
| 编辑 | DOCX编辑后格式为什么不乱？ | JSZip解压→精准修改目标XML节点→重新打包，不碰其他节点 |
| 协同 | 为什么选CRDT不用OT？ | OT需要中央服务器做变换，离线无法处理；CRDT操作可交换结合，天然支持离线和P2P |
| 协同 | 百人并发怎么不卡？ | 只传增量Op（<1KB）+ 服务端广播，不同步全文档状态 |
| 协同 | 段落锁怎么实现的？ | 编辑时广播锁定Op，其他客户端收到后UI置灰该段落，释放时广播解锁 |
| 协同-撤销 | 协同下撤销为什么用UndoManager？ | 原生history撤销会连别人的Op一起撤；UndoManager只追踪本地用户Op，只回滚自己的操作 |
| 协同-离线 | 断网编辑重连后怎么合并？ | 离线时Yjs正常生成Op存入IndexedDB；重连后广播离线Op；CRDT保证操作可交换结合自动合并 |
| 签名 | 手写签名为什么不锯齿？ | 采集压力点序列，三阶贝塞尔曲线拟合，平滑连续而非直线连点 |
| 签名 | PDF签章后怎么防止被篡改？ | pdf-lib写入签章后立即计算整个PDF的SHA-256哈希值存证；验签时重新计算对比，任意字节改动都破坏哈希 |
| 合规 | 规则引擎三层怎么合并结果？ | 以字符区间为key做并集，相同区间取最高风险等级，去重后统一渲染 |
| AILab | 新Demo怎么零改动上线？ | JSON配置驱动动态注册，iframe沙箱隔离，postMessage约定消息格式 |
| 架构 | 怎么管理6个平台不重复造轮子？ | Monorepo统一仓库 + 公共组件库 + 通用Hooks，各平台按需引入 |
| 语音转写 | AudioWorklet比ScriptProcessor好在哪？ | ScriptProcessor在主线程运行复杂页面丢帧；AudioWorklet独立音频线程，零主线程占用 |
| 语音转写 | partial/final结果怎么渲染不闪烁？ | partial用span绝对定位叠在final末尾颜色灰色；收到final时原地替换并移除partial span，不重排 |
| 配音制作 | 多轨音频怎么导出为单一WAV？ | Web Worker里按时间轴对齐所有轨道PCM帧，样本级加权混合（钳位防溢出），混合完整PCM后写WAV文件头（RIFF/fmt/data chunks），主线程零阻塞 |
| WASM | 为什么用pdfium-wasm而不是继续用PDF.js？ | PDF.js是JS实现，百页以上渲染主线程占用高；pdfium-wasm基于C++编译在Worker线程运行，渲染速度快1-2个数量级；代价是包体约3MB，动态import按需加载 |
| WASM | FFmpeg.wasm转码会不会很慢？ | WASM约为原生1/2-1/3，但远快于往返服务端；短音频百毫秒内完成；长音频用SharedArrayBuffer+Atomics跨Worker并行转码 |
| 骨架屏 | Smarty Skeleton怎么解决"构建期无DOM"的矛盾？ | 将首次真实渲染作为"学习投资"：运行时SDK在真实DOM渲染完毕后静默采集布局并持久化，第二次访问起骨架屏精准还原；首次访问和SSR场景由Chrome插件预生成兜底 |
| 骨架屏 | 骨架屏自动化怎么保证高度和真实内容一致？ | 运行时DOM遍历：真实页面渲染后SDK对每个关键节点做getBoundingClientRect，计算与父节点矩形交集（clip）后生成百分比定位的骨架块；尺寸来自用户真实渲染，与真实内容精准匹配 |
| 骨架屏 | Chrome插件在骨架屏系统中是什么角色？ | 解决SSR（服务端无DOM）和首次访问（新用户无缓存）两个运行时SDK覆盖不到的场景；在真实页面叠层可视化预览，确认后保存预生成产物供CI消费，彻底消除新用户首次白屏 |
| 骨架屏 | 运行时DOM采集怎么不卡UI？ | BFS遍历 + requestIdleCallback时间切片（40ms预算/帧），只在空闲时推进，不抢交互帧 |
| 骨架屏 | 缓存怎么失效？有没有版本号？ | 四维key（path + componentId + innerWidth + innerHeight）隐式失效；视口变化自然cache miss触发重新生成，无需显式版本号；业务方通过componentId区分不同用户态（vip/guest） |
| 骨架屏 | 为什么用双存储（localStorage + IndexedDB）？ | localStorage同步API存元数据（宽高/hasCache），SDK启动时立即读取先占位；骨架数据存IndexedDB（异步不阻塞、无5MB限制），序列化为紧凑数字数组，体积小无需压缩 |
| 骨架屏 | 骨架屏误判为白屏怎么处理？ | 监控SDK白屏检测排除已知骨架屏容器（通过class白名单）；骨架屏节点存在时不触发白屏上报；只有骨架屏渲染后N秒内真实内容还未出现才上报 |
| 监控 | 白屏检测怎么实现不误报？ | DOMContentLoaded后关键容器MutationObserver + 9点坐标采样双重验证；结合骨架屏白名单排除误报；Performance时序做二次确认 |
| 监控 | SourceMap线上还原怎么做的？ | CI打包时.map上传内网监控平台（不随CDN发布）；上报errorStack后平台用source-map库还原到源文件行号，告警附带可跳转源码链接 |
| 监控 | 为什么不直接用Sentry而是自研SDK？ | 私有化部署客户不允许数据出内网；Sentry上报到外网服务器；自研SDK上报到内网平台，SourceMap也存内网，满足合规要求 |
| 阿里-性能 | LCP从4s到<2s你做了什么？ | SSR首屏直出+Hero图WebP/preload；去除render-blocking脚本；关键CSS内联 |
| 阿里-性能 | INP怎么从500ms优化到<200ms？ | LoAF API定位长任务，Scheduler.postTask拆分同步大计算为yield分片；事件处理只做最小UI更新 |
| 阿里-架构 | 发品表单状态机怎么设计的？ | 定义状态枚举，每个状态允许的事件与转移写成配置表；组件只根据当前状态渲染，消除if-else分支；非法跳转配置期即可发现 |
| 阿里-架构 | 状态机和if-else有什么本质区别？ | if-else散落各处难以追踪全局状态；状态机把所有可能状态和合法跳转集中成配置表，非法跳转编译期就能发现，新增状态只扩展配置不改业务代码 |
| 阿里-国别化 | 一套代码怎么支持多国差异？ | 路由层读countryCode动态注入差异化Schema，Feature Flag控功能开关，核心组件对国别无感知，新增国家只需配置 |
| 阿里-AI | AI属性补全防抖怎么设计？ | 商家输入标题后500ms防抖触发，非每次keystroke请求；返回推荐属性以浮层展示，一键接受或逐项修改，接受后回填到对应表单字段 |
| AI流式 | SSE连接断了怎么处理？ | fetch+ReadableStream手动维护：catch错误后指数退避重试，reconnect成功后从中断token继续渲染，UI显示"重连中"状态 |
| AI流式 | 大模型首字慢怎么优化用户感知？ | 发请求时立即显示骨架屏动画，首个token到达时无缝切换打字机；加timeout兜底（10s无响应显示重试按钮）|
| 生成式UI | Generative UI和Markdown渲染有什么区别？ | Markdown是被动文字排版；Generative UI是LLM通过Function Calling声明组件类型，前端预注册渲染器，收到tool_call后实例化真正的React组件，有真实交互能力 |
| 生成式UI | Function Calling的chunk怎么处理？ | arguments字段是JSON字符串分片流式到达，用累积buffer拼接；括号深度计数检测到合法JSON闭合后再parse实例化组件；parse失败降级为文字渲染 |
| Agent编排 | DAG连线怎么做类型合法性校验？ | 每种节点定义输入输出端口类型Schema；连线时做兼容性check（any可接受一切，string不能连object）；不合法连线实时标红，提交前统一再校验 |
| Agent编排 | 运行时节点状态怎么和画布同步不乱序？ | 维护nodeStatus Map + 幂等状态机（状态只能单向流转，done/failed后忽略后续事件）；SSE event带sequence号，乱序到达时按sequence重放 |
| Agent编排 | 工作流版本管理怎么实现的？ | 整个DAG序列化为JSON Schema（节点列表+连线列表+节点配置），每次保存生成版本快照；支持版本对比和回滚，导出JSON可跨环境迁移 |
| 滴滴-导游 | 路线联动语音怎么实现的？ | 路线分段对应景点POI列表，监听地图SDK路线进度回调，进入某段时触发对应TTS音频播放（预加载±1段缓解首次延迟）；Audio元素管理播放状态，支持手动切换和进度拖拽 |
| 滴滴-导游 | 滑动窗口预生产策略是怎么设计的？ | 预先生产3段内容（≥15分钟），消费到第2段时自动触发下一批SSE请求；类似视频播放器的缓冲机制，保证播放队列始终有内容待播，彻底消除断流 |
| 滴滴-导游 | 双人TTS顺序怎么保证？ | 维护串行Promise队列，按脚本角色序依次await TTS合成结果，拼接音频chunk后再触发下一段合成；并发请求但顺序消费，防止乱序播放 |
| 滴滴-在哪儿 | 15s推理等待怎么不让用户以为卡死？ | 推理过程通过SSE实时流式渲染（多轮搜索/图像分析过程可见），用户看见AI在思考；推理完成手风琴动画收起链路切换结果态，感知等待明显缩短 |
| 滴滴-在哪儿 | 简单地点3s、复杂地点15s，同一入口UI怎么区分？ | 根据首包是否含推理事件动态分流：有推理→展示推理链滚动，无推理→骨架屏快速占位，两条路径收敛到相同结果态 |
| 滴滴-在哪儿 | EXIF为什么影响模型识别准确率？ | iOS相机照片携带EXIF方向标记，直接上传模型收到旋转90°图片，特征错位导致识别准确率明显下降；Canvas读取Orientation字段先矫正方向再压缩上传 |
| 私有化 | 前端怎么支持多套私有化环境免重新构建？ | 构建时不hardcode环境变量，运行时读window.__CONFIG__，Nginx在HTML里注入不同env对象 |
| 私有化 | 部署周期怎么从周级压缩到天级？ | 环境变量统一抽象，打包产物+nginx+docker-compose模板化；客户侧只需填写env文件执行一条命令，证书配置和回调地址替换全部脚本化 |
