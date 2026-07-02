# A2UI · Markdown 流式渲染 + 性能面板（可验收 Demo）

对应《A2UI-最佳实践与架构方案.md》§6.6「Markdown 流式渲染」的可运行实现。

## 能力一览

- **多轮对话 + 历史记录**：左侧历史侧栏（localStorage 持久化），可新建/切换/删除会话，从任意历史**继续多轮对话**；首条用户消息自动成为会话标题。
- **自动跟随滚动**：流式生成时自动滚到底部，**新内容不再被遮挡**；用户上滑查看历史时自动暂停跟随，回到底部再恢复。
- **流式渲染**：模拟 LLM token 级 `streamAppend`，边到边渲染，带流式光标；可随时「停止」（已生成内容入历史）。
- **块级记忆化**（性能核心）：按块切分 + 内容 hash 记忆化，流式期间**只重渲尾块**，完成块零重渲。
- **性能面板（验收用）**：TTFC 首屏、流式时长、吞吐、实时 FPS、掉帧、React 提交次数、累计/最大/平均渲染耗时、块渲染次数。
- **一键对比**：`记忆化 vs 朴素重渲` 跑同一份内容，量化「累计渲染 / 最大单帧 / FPS / 掉帧」的提升倍数。
- **丰富输出**：标题/列表/任务/表格/引用/代码高亮，以及卡片混排：
  - ` ```amap ` 高德地图卡（SVG 仿真地图 + 导航/在高德打开/复制地址，无需 key）
  - ` ```weather ` 天气卡、` ```product ` 商品卡、` ```stat ` 统计卡、` ```card ` 通用信息卡
- **可复制 / 可分享**：每段「复制本段」、代码块「复制代码」、卡片复制、顶部「复制全文 / 分享链接」；正文文本可自由选择复制。
- **安全**：不渲染裸 HTML，链接仅允许 http(s)，卡片半截 JSON 显示骨架，闭合后成型。

## 运行

> 本机已通过软链复用同仓 `v3/preview-engine/demo/node_modules`（React 18.3 / Vite 5）。

```bash
cd genui/md-stream-demo
npm run dev          # 打开 http://127.0.0.1:5188
```

若需独立安装依赖（联网环境）：`npm install` 后再 `npm run dev`。

## 验收步骤

1. 在输入框发送「上海一日游路线」「北京天气」「推荐个充电器」「本周数据对比」「这段代码怎么写」，观察流式生成、卡片成型、**自动跟随滚动**。
2. 继续追问形成**多轮对话**；右侧性能面板实时看 TTFC / FPS / 累计渲染等。
3. 在右侧面板点 **⚡ 跑对比**：用「记忆化 / 朴素」各重放上一条回答，看底部对比表 —— 记忆化的「累计渲染 / 最大单帧 / 掉帧」显著更优；切「极速」复跑差距更大。
4. 左侧历史侧栏切换/新建/删除会话，验证历史持久化与**从历史继续对话**。
5. 顶部「复制对话」「分享」（分享链接复制到剪贴板，打开即还原为一条新会话）；每条回答可「复制回答」，每段可「复制本段」。

## 结构

```
src/
├── chat/          store(会话+localStorage) · ChatView(自动滚动+输入) · Message · HistorySidebar · responder(离线意图应答)
├── stream/        StreamBuffer(streamAppend 缓冲) · StreamRunner(token 级模拟)
├── markdown/      blocks(切块+虚拟补全) · miniMarkdown(零依赖解析) · MarkdownRenderer(记忆化)
│   ├── highlight / CodeBlock
│   └── cards/     CardRenderer · AmapCard · SimpleCards
├── perf/          PerfStore(采集) · PerfPanel(面板+控制+对比)
├── components/    CopyButton
├── utils/         clipboard(复制/分享链接)
├── config.ts      流速档位
└── samples/       demoContent(覆盖多场景样例)
```
