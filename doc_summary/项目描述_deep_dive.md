# 项目描述

> 每个决策必须有「为什么常规方案不行」的 tradeoff 推导，量化数据从前端视角出发
> 叙事主线：把 LLM 输入（流式 SSE / 不全 JSON）和输出（Function Calling 组件化）两个不确定性问题，在浏览器端用确定性的工程手段解决

---

## 项目经历

---

### 一、AI Agent 编排平台 + Generative UI 体系

**背景**：从零搭建 Agent 编排平台，支撑行中导游、AI 图搜等 5 个 AI 业务，H5 / 小程序 / PC 三端交付。

**职责**：自研 DAG 编排引擎 + Generative UI 流式渲染框架 + 全链路可观测体系。

**技术栈**：React 19 + TypeScript 6 + Vite 8 + ReactFlow + ReadableStream SSE + WebSocket + OpenTelemetry

---

**1. 自研 DAG 编排引擎——不用 Dify/Coze/LangGraph**

**为什么？** 数据合规要求模型调用链路完全自主可控，外部编排平台无法审计。LangGraph 功能过剩但依赖 Python 生态，前端无法直接集成。

**怎么做：**
- Kahn 拓扑排序实现 DAG 执行器。条件分支 `selectBranch` + 子树排除——未选中分支的下游整棵子树直接跳过，不做无效推理
- Plugin Registry 注册式扩展 + CDN 沙箱 `new Function()` 动态加载 + PermissionProxy 9 种权限细粒度代理（network / env:read / email:send / llm:invoke / knowledge:read）。destroy 全拒绝，不留残留
- VariableResolver：类 Handlebars 的 `${nodeId.field}` 模板引擎，递归深度解析 + DFS 循环引用检测
- Tiptap 富文本变量编辑器：`/` 斜杠补全 + `${}` 双向序列化，Prompt 工程师可直接在编辑器中插入变量

**量化：** 较 LangGraph 体积 ↓80%+，冷启动 < 50ms。AI 功能上线从天级压缩至小时级，支撑 5 个 AI 业务。

---

**2. Generative UI：括号深度计数替代 JSON.parse**

**为什么不能用 JSON.parse？** Function Calling `arguments` 是流式 SSE 分片——每片都是不完整 JSON。全量 parse 必然崩；try-catch 循环重试产生指数级无效计算，用户看到组件反复销毁重建。

**怎么做：**
- 逐字符读流：`{` +1 / `}` -1，计数归零 = JSON 合法闭合 → 即刻实例化 React 组件
- 本质是把「等完整再 parse」的**同步思维**替换为「逐字符判闭合」的**流式思维**。O(n) 单次遍历，零回溯
- Markdown 降级：增量 AST patch + rAF commit（60fps），不全量 re-parse
- 幂等状态机 + sequence 号防 SSE 乱序——后到的旧消息直接丢弃

**量化：** 流式组件渲染 60fps，较全量 re-render 快 2x。

---

**3. 全链路可观测——前端 AI 工程的可靠性底座**

AI 应用的可靠性问题比传统前端更复杂：模型返回不可控（格式错误/超时/hallucination）、多轮推理链路长（一个编排跑 10+ 个节点）、用户等待时间长（推理 15s+ 体验黑洞）。

**白屏检测——双校验消除误报：**
- 9 点采样法：页面上下左右中 × 3 排 = 9 个采样点，取色判断是否全白。消除单点误判
- MutationObserver 监听 DOM 变更，骨架屏渲染完成后自动标记 `phase: 'skeleton'`，白屏检测跳过骨架屏——避免「有骨架屏但没内容」被误报为白屏
- 连续 3s 白屏 → 触发告警 + 自动截屏留存

**LoAF 帧级性能监控：**
- `PerformanceObserver` 监听 `long-animation-frame`，拆解每帧为 `scripts[]` 数组——每段脚本的 `duration`、`sourceURL`、`invoker`、`sourceFunctionName` 全部采集
- 区分「AI 推理等待时间」（SSE 无数据到达时段）和「前端渲染阻塞时间」（强制 reflow / 大组件 render）——两类瓶颈根因完全不同，排查路径也不同
- 按 AI 编排节点粒度打 tag：`nodeType=llm`、`nodeType=condition`、`nodeType=http`，定位是哪个节点的推理拖慢了整体

**fetch/XHR 零感知注入——不侵入业务代码：**
- monkey-patch `window.fetch` 和 `XMLHttpRequest.prototype.open/send`，在 AOP 层拦截所有 AI API 请求
- 自动采集：请求耗时、响应状态码、token 消耗量（从 SSE 事件计数推断）、首 token 到达时间（TTFT）、token 生成速率（tokens/s）
- `navigator.sendBeacon` 批量上报——页面卸载时也不丢数据

**SourceMap 独立上传——不随 CDN 发布：**
- CI 构建时 SourceMap 上传到监控服务，CDN 产物不含 SourceMap
- 线上报错堆栈反向解析到源码行号——排查 AI 返回异常数据导致的渲染崩溃时，5 分钟内定位根因

**量化：** P0 故障平均响应时间 < 5 分钟。AI API 异常（超时/格式错误/hallucination 白屏）平均发现时间从小时级压缩至分钟级。

---

### 二、全链路性能治理 + 骨架屏自动化系统

**背景：** 海外 B2B 平台 20+ 核心页面，千人千面布局、多国家弱网低端设备、存量 MPA 架构老化。

**职责：** 主导性能优化、骨架屏自动化基建 0→1、MPA→SPA 渐进迁移。

**技术栈：** React 18 + TypeScript + Scheduler.postTask + LoAF API + IndexedDB + Playwright + pixelmatch

---

**1. INP 优化——LoAF 替代 LongTask**

**为什么 LongTask 不够？** INP 衡量「用户交互到下一帧绘制」的延迟。LongTask 告知有 > 50ms 任务，但一帧可能含多个脚本块 + style/layout 计算——定位不到具体哪段脚本触发了强制 reflow。

**怎么做：**
- LoAF 逐帧拆解 `scripts[]` 数组，每段有 `duration`、`sourceURL`、`sourceFunctionName`。逐一排查到引发 layout thrashing 的代码路径
- Scheduler.postTask 三阶段分离：`user-blocking`（交互响应）→ `user-visible`（动画）→ `background`（非关键更新），交互层不跟动画抢帧

**量化：** P90 全指标——FCP < 1s / LCP < 2s / CLS < 0.02 / INP < 200ms。

---

**2. 骨架屏自动化——运行时学习 + 编译式重排**

**为什么手工写不行？** 千人千面下商品详情页随国家/商品类型/商家模板三个维度变化，人工覆盖所有变体不可行。

**怎么做——核心算法链：**

**BFS 学习阶段：**
- 内联 JS SDK 放在 HTML head 同步执行——骨架屏在 bundle 加载前就已渲染，< 500ms
- `requestIdleCallback` 40ms/帧分片遍历 DOM，不阻塞主线程
- 4D 缓存 key = path + componentId + viewportWidth + viewportHeight——相同布局复用缓存
- 可见性滤波：`display:none` / `visibility:hidden` / `opacity:0` / overflow 裁剪链——只学习用户实际能看到的

**topology DFS 路径压缩：**
- 识别「冗余 wrapper」——bbox 与父级完全一致 + 无视觉样式（背景/边框/margin）的节点。这种是 React/Vue 组件树中的透传包装层，对用户不可见
- 剪枝并提升子节点。思想来自编译器优化的 SSA 路径压缩——消除无意义的中间表示
- 节点数 ↓30-50%

**三阶段 Merge 算法：**
- 几何合并：R-Tree 空间索引加速邻近查询 + overlap 阈值。相邻同宽高骨骼合并
- 模式识别：水平/垂直阵列 → ListBone（6 个 tag 按钮 → 1 条），相邻文本 rect → TextBone
- 最终收敛：3 轮迭代两两检查，≤ 45 bones/页，≤ 60ms

**SKBD 二进制编码：**
- **为什么不用 JSON？** 几百个骨骼 `"left":"47.2"` `"top":"128.6"` 中 key 重复几百次，IndexedDB 有存储上限，移动端更敏感
- 自研格式：4 字节魔法数 + Uint16 坐标 × 100（保留 2 位精度）+ 1 字节 flags 位域编码 3 个 bool（isContainer/hasBorder/hasBackground）+ 字典去重 CSS 值。LZW 二次压缩
- 体积较 JSON ↓40-60%

**CSS 级 FCP 触发：**
- `linear-gradient` 作为 `background-image` 被浏览器计入 contentful paint，FCP 在骨架屏阶段即触发；纯色 div 不会
- 渲染时机层面的精细优化——用户感知「页面已响应」而非「白屏」

**Playwright 视觉回归 CI：**
- 每次构建 Playwright 截图 + pixelmatch 逐像素对比基准
- 三态裁决：MISSING（消失）→ CI 告警；STALE（漂移 > 5%）→ 提示更新；DRIFT（渐进偏差）→ 记录趋势

**跨平台：** Web(rIC) / RN(InteractionManager+Animated API+useNativeDriver) / Taro 小程序(wx.nextTick+createSelectorQuery)。共用 SkeletonData schema + 百分比坐标，渲染器各自实现

**量化：** 开发 0.5 人日→5 分钟（↓95%）。CLS 0.15+→< 0.02。数据体积 ↓40-60%。20+ 页面接入，跨 BU 推广。

---

**3. 存量 MPA→SPA 渐进迁移**
- 20+ 老旧 MPA 零中断——iframe 兼容模式与原 URL 并存，逐步切流
- 微前端统一 3 后台系统，域名→basename 自动映射。42 单测 + 100% 核心覆盖率

---

### 三、多模态 AI SaaS 平台矩阵

**背景：** AI 能力产品化，构建翻译、质检、OCR、语音转写 SaaS 平台矩阵，SaaS + 私有化双模式。

**职责：** 4 人前端 Tech Lead，主导 6 个 SaaS 平台前端架构设计与核心模块编码，统一技术底座跨平台复用。

**技术栈：** React + Canvas 2D + AudioWorklet + WebSocket + CRDT (Yjs + WebRTC) + Chrome Extension MV3

---

**1. 实时语音转写——AudioWorklet + 自研 Canvas 可视化引擎**

**AudioWorklet 管线——为什么不用 ScriptProcessor？**

ScriptProcessor 在主线程跑音频回调，主线程被 UI 渲染抢占时丢帧→音频断断续续，缓冲区大小不可控。AudioWorklet 独立音频线程，与主线程零竞争。不是「换 API」——是**平台级架构隔离**。

- `WeakMap<AudioContext, Promise>` 缓存 Worklet 模块，同 session 不复下载
- 软重采样降级：原生采样率协商失败时线性插值兜底，不中断采集
- 欠载检测：`currentTime` 跳变 > 50ms 自动累计，`getMetrics()` 暴露 baseLatency / outputLatency / underrunCount
- Profile 系统：pure（关闭 NS/AEC/AGC，单人录音）vs meeting（开启降噪+回声消除）一键切换
- F1 门控 Promise：`startRecording()` 在服务端 `recording_started` 到达前不 resolve，防止 WSS 握手期间的首包丢失

**Canvas 多模态可视化（60fps，零 React 重渲染）：**

**为什么不用 React 组件？** 四面板每 16ms 刷新一帧。React reconcile + DOM 操作一帧 > 30ms，4 面板直接超预算。

- 直接操作 Canvas 2D API，所有绑定在 `requestAnimationFrame` 回调完成，零 virtual DOM
- 频谱热力图：128 bins FFT + `SpectrumRing` 列优先环形缓冲（新列覆盖旧列，零分配）+ 深蓝→红热力配色映射
- 音高曲线：ACF 自相关基频估计 60-1000Hz + 一阶 IIR 平滑 + 阈值归一化
- VU 能量条：24 段 LED 渐变色柱（绿→黄→红）+ VAD 指示灯（RMS 阈值 + 5 帧保持防闪烁）

**自研 PerfMonitor 性能仪表盘：**
- `Float64Array` 环形缓冲存最近 60 帧耗时——覆盖旧值，零 GC
- 延迟分位数 P50/P95/P99：nearest-rank + 泛型 `SlidingWindow<T>`，O(1) push
- 音频引擎指标实时采样 + JS 堆内存采样 + 颜色编码 FPS（绿 ≥ 55 / 黄 30-54 / 红 < 30）

**纯函数转写状态机（513 行，零副作用）：**
- 7 种 action type，PURE reducer，无定时器无全局变量，完整可单测
- 火山引擎 v3 full 协议：utterance 合并 + definite 锁定
- 同说话人连续合并（≤ 1.5s 间隔 + 归一化前缀）：防 VAD 过度切分。同文本去重：防时间戳漂移
- djb2 哈希 12 色稳定映射 + 用户重命名锁定

---

**2. Myers Diff 自研算法——三层粒度 + 6 类中文错误分类**

**为什么不用 jsdiff 等现成库？** 市面 diff 库以空格分词面向英文，CJK 处理粗糙。讯飞质检对标「中文语法检错评测 CGED 2018」TOP1 标准——拼写/语法/标点/数字/量和单位/政治领域 6 大类错误，需要自研分类器。

**字符级 diff：**
- Myers O((N+M)×D) 编辑距离算法。`Int32Array` 存 V 数组（k 对角线上最远 x 值），减少 GC
- `Array.from()` 按码点拆分，正确处理 emoji 和 4 字节 CJK 代理对
- v6 快速路径：两字符串不共享任何字符时，Set 检测 O(N) 跳过 O(NM) 退化

**段落级 + 短语级：** 数组级 Myers 嵌套字符级 diff + `groupByHunk` 聚合替换块 + 滑动窗口短语检测 + `segmentWords` 中文分词（CJK 单 token，字母数字合并）

**6 类错误分类器：** 拼写（单字替换）/ 语法（多字不对等）/ 标点（`\p{P}` 匹配）/ 数字 / 单位（亿万千百十匹配）/ 政治（关键词表）。AI 不可用时启发式降级（正则 + 12 高频错别字对：在/再、的/得、做/作 等）

---

**3. Canvas 统一渲染管线——不逐格式适配 DOM**

**为什么不用 DOM？** 23 种文档格式各自 DOM 兼容成本不可控。PPTX 文本框旋转、PDF 精确坐标定位、XLSX 合并单元格边框——DOM 做到高还原度等于逐格式写布局引擎。

- 所有格式→LibreOffice→PDF→Canvas 统一绘制，**兼容成本 ↓80%**
- 3 层架构：Canvas 矢量层→UDM 交互层（透明 span，不遮挡）→高亮层（标注/翻译叠加）
- 128MB LRU + 优先级队列 + 渐进清晰 + 快速滚动跳过 + 滚动停止 200ms 后渲染预取
- **189 页 PDF 内存 300MB→10MB（↓30x），首屏 8s→300ms**

---

**4. 网页翻译 Chrome Extension——零布局破坏注入**

**为什么不能插兄弟节点？** 译文插入到原文旁在 flex/grid/table 中破坏子元素排列。父容器布局未知，无法穷举兼容。

- 译文 span 插入原文元素**内部**末尾——不改变子元素数量和顺序
- TreeWalker 只改 Text `nodeValue`，不改 Element 结构
- 词级对齐：NLLB-600M L0H15（F1=0.851）+ 启发式对角线降级（服务不可用时客户端自给）
- 标注反馈闭环：用户修正+评分→IDB→NestJS→训练数据飞轮
- **500 万+ C 端用户自然增长**

---

**5. 协同编辑——选 CRDT 而非 OT**

**为什么 OT 不行？** 私有化部署客户内网无中央服务器。OT 核心假设「所有操作先发服务器做并发变换」不成立。OT 无法直接 P2P。

- Y.Doc——CRDT 操作满足交换律结合律，任意顺序到达最终一致
- y-webrtc（BroadcastChannel→WebRTC P2P 降级）+ 段落编辑锁 + Awareness 光标感知 + IDB 离线恢复
- **数十家企业 4 年+稳定运行，零数据丢失**

---

**6. 自研 multipart 编译器**

- Lexer→Parser→AST→Visitor，零依赖，完整 RFC 7578。替代 multer，**体积 ↓90%+**

---

**7. 企业级上传引擎——自研 7 层管线**

- Magic Number 校验→自适应分片（网络探测动态调整）→流式哈希→熔断器→并发控制→上传→Merkle Tree 完整性校验 + 秒传（SHA-256 去重）
- WebTransport QUIC，**弱网吞吐 +40%**。预测性上传 + IndexedDB 续传

**前端量化：** 语音 Canvas 60fps 零 React 重渲染。Myers Diff 三层粒度 + 6 类分类。PDF 首屏 ↓37x，内存 ↓30x。multipart ↓90%+。词级对齐 F1=0.851。QPS 提升 20x。3 平台盈利，500 万+ C 端用户。180+ 测试。

---

## 关键架构决策

| # | 决策 | 常规方案 | 我的选择 | 为什么 |
|---|------|---------|---------|--------|
| 1 | 编排引擎 | Dify/Coze | **自研 DAG** | 合规+可控，体积 ↓80%+ |
| 2 | FuncCall 流式 | JSON.parse | **括号深度计数 O(n)** | 流式分片不完整，parse 必崩 |
| 3 | 骨架屏 | 手工 CSS | **运行时学习+编译重排** | 千人千面构建期不可知布局 |
| 4 | 骨架格式 | JSON | **SKBD 二进制+LZW** | key 重复浪费，IDB 有限，↓40-60% |
| 5 | 节点剪枝 | 全保留 | **topology DFS 路径压缩** | 组件树大量透明 wrapper |
| 6 | 骨骼合并 | 逐节点 | **三阶段 Merge** | 200+→≤45 bones |
| 7 | 音频采集 | ScriptProcessor | **AudioWorklet** | 独立线程，架构隔离非 API 优化 |
| 8 | 可视化 | React 组件 | **Canvas 2D** | 16ms/帧不够 React reconcile |
| 9 | 转写状态 | 分散 useState | **纯函数 Reducer 513 行** | 去重+合并+说话人管理需集中 |
| 10 | 协同编辑 | OT | **CRDT (Yjs)** | 私有化无服务器，OT 前提不成立 |
| 11 | 文本 diff | jsdiff | **自研 Myers+中文分类器** | 英文分词对 CJK 粗糙 |
| 12 | SSE 消费 | EventSource | **fetch+ReadableStream** | 需 POST/Authorization/AbortController |
| 13 | INP 定位 | LongTask | **LoAF** | 帧内脚本级 vs 任务级 |
| 14 | 插件安全 | iframe/Worker | **new Function+PermissionProxy** | 9 种细粒度权限管控 |
| 15 | 监控注入 | 业务代码埋点 | **AOP monkey-patch 零感知** | 不侵入代码，sendBeacon 上报 |
| 16 | 白屏检测 | 单点取色 | **9 点采样+MutationObserver 双校验** | 消除骨架屏误报 |
| 17 | Multipart | multer | **自研编译器** | 零依赖，↓90%+ |
| 18 | 上传协议 | HTTP/1.1 分片 | **WebTransport QUIC** | 弱网+40% |
| 19 | 翻译注入 | 兄弟节点 | **子节点内追加** | 零布局破坏 |
| 20 | 文档渲染 | DOM 逐格式 | **Canvas 统一管线** | 23 格式兼容成本不可控 |
| 21 | 对齐降级 | 仅远程模型 | **NLLB+启发式双路径** | 服务不可用客户端自给 |