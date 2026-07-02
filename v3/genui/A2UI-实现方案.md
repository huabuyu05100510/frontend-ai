# A2UI / GenUI 完整实现方案

> 基于 tech1–tech4 四份技术文档整理 | 覆盖：概念体系 → 协议规范 → SDK 实现 → 服务端 → 高级交互

---

## 目录

1. [概念体系](#一概念体系)
2. [A2UI 协议规范](#二a2ui-协议规范)
3. [架构总览](#三架构总览)
4. [SDK 层：@a2ui/core](#四sdk-层a2uicore)
5. [SDK 层：@a2ui/react](#五sdk-层a2uireact)
6. [传输层：SSE + AGUI 协议](#六传输层sse--agui-协议)
7. [服务端：Koa + Agent 集成](#七服务端koa--agent-集成)
8. [高级功能：图片理解 & 多轮对话 & 元素级交互](#八高级功能)
9. [样式系统：useHint + styles](#九样式系统usehint--styles)
10. [工程最佳实践](#十工程最佳实践)
11. [MVP 实施路线图](#十一mvp-实施路线图)

---

## 一、概念体系

### 1.1 什么是生成式 UI（GenUI）

生成式 UI 是由 **AI 根据任务、上下文和用户意图动态生成的用户界面**，而非预先设计和编码的固定界面。

| 维度 | 传统 UI | 生成式 UI |
|------|---------|-----------|
| 流程 | 设计师→工程师→测试→上线 | 用户任务→AI分析→动态生成 |
| 场景 | 只支持已规划的场景 | 支持无限场景 |
| 成本 | 每个界面需设计+编码 | AI 直接生成，零开发成本 |
| 速度 | 开发周期天/周 | 秒级生成 |
| 上下文 | UI 与对话分离 | 界面是对话的自然延伸 |

### 1.2 典型应用场景

- **数据查询与可视化**："对比Q1和Q2销售数据" → 即时生成图表
- **表单与配置**："帮我创建新任务" → 即时生成表单
- **复杂信息展示**："分析代码库结构" → 即时生成 Dashboard
- **交互式工作流**："帮我预订会议室" → 多步骤向导

### 1.3 技术方案选型

| 方案 | 安全性 | 灵活性 | 代表产品 | 适用场景 |
|------|--------|--------|---------|---------|
| HTML/CSS/JS 生成 | ❌ XSS风险 | ⭐⭐⭐ | Vercel v0, Claude Artifacts | 开放场景、原型 |
| 组件树 JSON | ✅ | ⭐⭐ | React Server Components | 企业应用、固定组件 |
| 声明式 DSL | ✅ | ⭐⭐ | Jetpack Compose | 原生应用、高性能 |
| **A2UI** | ✅✅ | ⭐⭐⭐ | OpenClaw A2UI | **Agent对话、动态场景** |

**选 A2UI 的理由**：专为 Agent 设计、流式传输、平台无关、无代码执行风险。

---

## 二、A2UI 协议规范

### 2.1 协议关系图

```
A2UI（应用层）: 定义 UI 组件树、JSONL 消息格式、DataModel
    类比：A2UI : AG-UI = HTML : HTTP

AG-UI（传输层）: 定义 SSE/WebSocket 连接、消息封装与传输
    来源：CopilotKit  职责：Agent 用户双向交互（事件流、状态同步）

MCP：Agent 工具/数据连接协议
A2A：Agent-to-Agent 协作协议（Google）
```

### 2.2 核心概念

| 概念 | 说明 | React 类比 |
|------|------|-----------|
| **Surface** | UI 画布，独立的 UI 表面（对话框/面板/卡片） | `<App>` 根组件 |
| **Component** | UI 组件（Text、Button、Column、Row…） | React 组件 |
| **DataModel** | UI 状态存储 | React state |
| **JSONL** | 传输格式，每行一个 JSON 对象 | JSX 的序列化形式 |

### 2.3 消息类型（服务端 → 客户端）

```typescript
// A2UI 协议消息类型
type ServerMessage =
  | CreateSurfaceMessage     // 创建 UI 画布
  | SurfaceUpdateMessage     // 更新组件树
  | DataModelUpdateMessage   // 更新数据状态
  | BeginRenderingMessage    // 开始渲染
  | DeleteSurfaceMessage;    // 删除 UI 画布

// 创建 Surface
interface CreateSurfaceMessage {
  createSurface: {
    surfaceId: string;   // Surface 唯一标识
    version: string;     // 协议版本，如 "0.9"
  };
}

// 更新组件树（扁平列表形式）
interface SurfaceUpdateMessage {
  surfaceUpdate: {
    surfaceId: string;
    components: Component[];
  };
}

// 组件定义
interface Component {
  id: string;                              // 组件唯一标识
  component: {
    [componentType: string]: ComponentProps; // Text / Button / Column…
  };
}

// 更新数据模型
interface DataModelUpdateMessage {
  dataModelUpdate: {
    surfaceId: string;
    dataModel: Record<string, any>;
  };
}

// 开始渲染
interface BeginRenderingMessage {
  beginRendering: {
    surfaceId: string;
    root: string;   // 根组件 ID
  };
}
```

### 2.4 消息类型（客户端 → 服务端）

```typescript
// 用户交互事件
interface EventMessage {
  event: {
    surfaceId: string;
    componentId: string;
    eventType: 'press' | 'change' | 'select' | 'scroll' | 'focus' | 'blur';
    payload?: any;
  };
}

// Surface 就绪通知
interface SurfaceReadyMessage {
  surfaceReady: { surfaceId: string };
}
```

### 2.5 完整消息流示例：简单卡片

```jsonl
{"createSurface": {"surfaceId": "card1", "version": "0.9"}}
{"surfaceUpdate": {"surfaceId": "card1", "components": [
  {"id": "title",   "component": {"Text": {"text": {"literalString": "天气卡片"}, "usageHint": "h1"}}},
  {"id": "content", "component": {"Text": {"text": {"literalString": "北京今天晴，15°C"}, "usageHint": "body"}}},
  {"id": "root",    "component": {"Column": {"children": {"explicitList": ["title", "content"]}}}}
]}}
{"beginRendering": {"surfaceId": "card1", "root": "root"}}
```

### 2.6 协议版本对比

| 特性 | v0.8 | v0.9 |
|------|------|------|
| Surface 创建 | 隐式（无需 createSurface） | **显式 createSurface** |
| 基础组件 | Text, Button, Column, Row | + Chart, List, Card, Input |
| 状态管理 | ❌ | ✅ `dataModelUpdate` |
| 增量更新 | ❌ | ✅ Diff + Patch |

---

## 三、架构总览

```
┌─────────────────────────────────────────────────────┐
│                    用户界面层                        │
│  文字描述 │ 图片上传 │ 对话历史 │ 预览/交互区域       │
└────────────────────┬────────────────────────────────┘
                     │ SSE（接收 UI 更新）+ HTTP（发送事件）
┌────────────────────▼────────────────────────────────┐
│                客户端 SDK（@a2ui/react）              │
│  SSE Receiver → Parser → Store → Renderer            │
│                          ↕                           │
│                   componentMap                       │
│                   hydrateMap                         │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              服务端（Koa + Agent）                   │
│  SSE Handler → Agent → A2UI Generator → JSONL Stream │
│                                                      │
│  多模态输入层：文字解析 │ Vision LLM │ 样式语义化     │
│  对话管理层：历史注入 │ 状态快照 │ Diff 生成          │
└─────────────────────────────────────────────────────┘
```

**核心数据流**：
```
Agent 生成 UI 描述
  → JSONL 序列化
  → SSE 传输（AGUI 协议）
  → Parser 解析 → componentMap: Map<id, ComponentDef>
  → render 阶段 → hydrateMap: Map<id, VNode>
  → treeBuild 阶段 → 完整组件树
  → React.render() → DOM
```

---

## 四、SDK 层：@a2ui/core

纯 TypeScript 实现，**框架无关**，不依赖 React/Vue，可运行于 Web / Node.js / RN / 小程序。

### 4.1 Parser（协议解析器）

```typescript
interface IParser {
  parseLine(line: string): ParseResult;       // 单行解析（调试/测试用）
  parseChunk(chunk: string): ParseResult[];   // 流式解析 SSE chunk
  reset(): void;                              // 重置（断线重连时）
}

interface ParseResult {
  type: 'createSurface' | 'surfaceUpdate' | 'beginRendering'
      | 'dataModelUpdate' | 'deleteSurface' | 'error' | 'unknown';
  message?: A2UIMessage;
  error?: string;
}
```

**关键设计**：
- **流式解析**：逐行处理，不等待完整数据，支持增量渲染
- **容错处理**：无效 JSON 行记录日志并跳过，不中断整体流程
- **buffer 机制**：缓存 SSE 不完整行，等待下一个 chunk 补全

```typescript
class A2UIParser implements IParser {
  private buffer = '';

  parseChunk(chunk: string): ParseResult[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';          // 最后一行可能不完整，留缓冲
    return lines
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => this.parseLine(line));
  }

  parseLine(line: string): ParseResult {
    try {
      const msg = JSON.parse(line);
      if (msg?.createSurface)    return { type: 'createSurface',    message: msg };
      if (msg?.surfaceUpdate)    return { type: 'surfaceUpdate',    message: msg };
      if (msg?.beginRendering)   return { type: 'beginRendering',   message: msg };
      if (msg?.dataModelUpdate)  return { type: 'dataModelUpdate',  message: msg };
      if (msg?.deleteSurface)    return { type: 'deleteSurface',    message: msg };
      return { type: 'unknown' };
    } catch {
      return { type: 'error', error: `Invalid JSON: ${line.slice(0, 80)}` };
    }
  }
}
```

### 4.2 Store（中心状态管理）

```typescript
interface A2UIStore {
  // 组件定义 Map（Parser 输出）
  componentMap: Map<string, ComponentDef>;
  // 渲染实例 Map（render 阶段输出）
  hydrateNodeMap: Map<string, VNode>;
  // 新增组件标记（用于淡入动画）
  newComponentIds: Set<string>;
  // 当前 Surface ID
  currentSurfaceId: string | null;

  setComponentMap(map: Map<string, ComponentDef>): void;
  setHydrateNodeMap(map: Map<string, VNode>): void;
  updateVNode(id: string, vnode: VNode): void;
  isNewComponent(id: string): boolean;
  clearNewComponentMark(id: string): void;
  setSurfaceId(id: string): void;
  clear(): void;
  subscribe(listener: () => void): () => void; // 返回取消订阅函数
}
```

**标记清除法（淡入动画）**：
```typescript
setComponentMap(map) {
  const oldIds = new Set(this.hydrateNodeMap.keys());
  this.componentMap = map;
  // 标记新增组件（存在于新 map 但不存在于旧 hydrateMap）
  this.newComponentIds = new Set(
    [...map.keys()].filter(id => !oldIds.has(id))
  );
  this.notify();
}
```

### 4.3 TreeBuilder（树构建器）

将 Parser 输出的**扁平组件列表**转换为**树形结构**，核心难点是**循环引用检测**。

```typescript
class TreeBuilder {
  build(componentMap: Map<string, ComponentDef>, rootId: string): VNode {
    return this.buildNode(rootId, componentMap, new Set<string>());
  }

  private buildNode(
    id: string,
    map: Map<string, ComponentDef>,
    visiting: Set<string>   // 当前访问路径，用于检测循环
  ): VNode {
    if (visiting.has(id)) {
      throw new Error(`循环引用检测到: ${id}`);
    }
    const def = map.get(id);
    if (!def) return createPlaceholder(id);

    visiting.add(id);
    const vnode = hydrateMap.get(id)!;         // 已在 render 阶段创建
    vnode.children = (def.children ?? [])
      .map(childId => this.buildNode(childId, map, visiting));
    visiting.delete(id);
    return vnode;
  }
}
```

**为何扁平→树两阶段**：
- 扁平列表适合传输（JSONL 逐行流式）
- 树形结构适合渲染（递归处理）
- 解耦传输层和渲染层

---

## 五、SDK 层：@a2ui/react

### 5.1 三阶段渲染流程

```
阶段 1: render（只渲染，不关联）
  遍历 componentMap → 逐个创建 vnode → 存入 hydrateMap
  此时 vnode.children 为空/未关联

阶段 2: treeBuild（只关联，不渲染）
  从 hydrateMap 取 vnode（不调用 render）
  根据 componentMap.children 引用关联
  递归构建完整树结构
  检测循环引用

阶段 3: 最终渲染
  React.render(rootVNode, container) → DOM
```

### 5.2 组件映射器（Component Mapper）

```typescript
const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
  Text:   ({ text, usageHint, style }) => {
    const Tag = usageHintToTag(usageHint);  // h1/h2/p/span
    return <Tag style={style}>{text.literalString}</Tag>;
  },
  Button: ({ label, onPress, style }) => (
    <button style={style} onClick={() => dispatchEvent('press', onPress)}>
      {label.literalString}
    </button>
  ),
  Column: ({ children, spacing, style }) => (
    <div style={{ display:'flex', flexDirection:'column',
                  gap: spacingToGap(spacing), ...style }}>
      {children}
    </div>
  ),
  Row:    ({ children, alignment, style }) => (
    <div style={{ display:'flex', flexDirection:'row',
                  alignItems: alignmentToCSS(alignment), ...style }}>
      {children}
    </div>
  ),
  Input:  ({ placeholder, value, onChange, style }) => (
    <input style={style} placeholder={placeholder} value={value}
      onChange={e => dispatchEvent('change', onChange, e.target.value)} />
  ),
  // 高级组件
  Chart: ({ data, chartType }) => <ChartAdapter data={data} type={chartType} />,
  List:  ({ items, renderItem }) => <ListAdapter items={items} renderItem={renderItem} />,
  Card:  ({ title, children }) => <CardAdapter title={title}>{children}</CardAdapter>,
};
```

### 5.3 淡入动画 HOC

```typescript
function withFadeIn<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  componentId: string
): React.FC<P> {
  return function FadeInComponent(props: P) {
    const [visible, setVisible] = useState(!store.isNewComponent(componentId));

    useEffect(() => {
      if (store.isNewComponent(componentId)) {
        requestAnimationFrame(() => setVisible(true));
        const timer = setTimeout(() => {
          store.clearNewComponentMark(componentId);
        }, 300);
        return () => clearTimeout(timer);
      }
    }, []);

    return (
      <div style={{ opacity: visible ? 1 : 0,
                    transition: 'opacity 0.3s ease-in-out' }}>
        <WrappedComponent {...props} />
      </div>
    );
  };
}
```

### 5.4 增量更新

```typescript
// 只 re-render 变化的组件，保持其他组件状态
function updateComponent(id: string, newDef: ComponentDef) {
  store.componentMap.set(id, newDef);
  const newVNode = adapter.render(newDef, id, false);  // false = 不标记为新增
  store.hydrateNodeMap.set(id, newVNode);
}

function batchUpdate(newComponents: ComponentDef[]) {
  const oldIds = new Set(store.hydrateNodeMap.keys());
  for (const comp of newComponents) {
    if (!oldIds.has(comp.id)) {
      store.newComponentIds.add(comp.id);  // 新增组件加淡入标记
    }
    updateComponent(comp.id, comp);
  }
  treeBuild('root');
  renderAll();
}
```

---

## 六、传输层：SSE + AGUI 协议

### 6.1 为什么选 SSE

| 特性 | SSE | WebSocket |
|------|-----|-----------|
| 通信方向 | 单向（服务端→客户端） | 双向 |
| 协议基础 | HTTP | 独立协议（需升级） |
| 代理/CDN兼容 | ✅ 天然兼容 | ⚠️ 需特殊配置 |
| 断线重连 | ✅ 浏览器自动处理 | ❌ 需手动实现 |
| 复杂度 | 低 | 高 |
| A2UI 适用性 | ✅ 主流：服务端推送 UI | 可选：双向事件时用 |

### 6.2 SSE 消息格式

```
event: a2ui
data: {"createSurface": {"surfaceId": "main", "version": "0.9"}}

data: {"surfaceUpdate": {"surfaceId": "main", "components": [...]}}

event: done
data: {}

```
（每条消息以空行结束）

### 6.3 客户端连接

```typescript
class A2UISSEClient {
  private es: EventSource | null = null;
  private parser = new A2UIParser();

  connect(url: string, onMessage: (result: ParseResult) => void) {
    this.es = new EventSource(url);

    this.es.onmessage = (event) => {
      const results = this.parser.parseChunk(event.data + '\n');
      results.forEach(onMessage);
    };

    this.es.addEventListener('done', () => this.disconnect());
    this.es.onerror = (err) => console.error('SSE error:', err);
  }

  disconnect() {
    this.es?.close();
    this.parser.reset();
  }
}
```

### 6.4 AG-UI 事件类型（16+ 种，7 大类）

| 分类 | 事件 | 用途 |
|------|------|------|
| 生命周期 | RUN_STARTED, RUN_FINISHED, STEP_STARTED/FINISHED, RUN_ERROR | 监控 Agent 运行 |
| 文本消息 | TEXT_MESSAGE_START/CONTENT/END | 流式文本输出 |
| 工具调用 | TOOL_CALL_START/ARGS/END/RESULT | 工具执行 |
| 状态管理 | STATE_DELTA, STATE_SNAPSHOT | 状态同步 |
| 活动事件 | ACTIVITY_START/END | 活动进度 |
| 推理事件 | REASONING_START/MESSAGE_*/END | LLM 推理可见性 |
| 特殊事件 | RAW, CUSTOM | 扩展功能 |

AG-UI 集成 A2UI：
```json
{"type": "CUSTOM", "name": "a2ui_surface_update",
 "value": {"surfaceUpdate": {"surfaceId": "main", "components": [...]}}}
```

---

## 七、服务端：Koa + Agent 集成

### 7.1 SSE 服务端核心

```typescript
import Koa from 'koa';

const app = new Koa();

app.use(async (ctx) => {
  if (ctx.path !== '/a2ui/stream') return;

  // SSE 必要 Headers
  ctx.set('Content-Type', 'text/event-stream');
  ctx.set('Cache-Control', 'no-cache');
  ctx.set('Connection', 'keep-alive');
  ctx.set('X-Accel-Buffering', 'no');      // 关闭 Nginx 缓冲
  ctx.status = 200;

  // 推送 A2UI 消息
  const send = (data: object, event?: string) => {
    if (event) ctx.res.write(`event: ${event}\n`);
    ctx.res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const { message, imageBase64 } = ctx.request.body;
  await streamA2UIFromAgent(message, imageBase64, send, ctx);

  send({}, 'done');
  ctx.res.end();
});
```

### 7.2 Agent 集成（伪代码）

```typescript
async function streamA2UIFromAgent(
  userMessage: string,
  imageBase64: string | undefined,
  send: (data: object, event?: string) => void,
  ctx: Koa.Context
) {
  const conversationState = getSession(ctx);

  // 1. 构建 Prompt（含历史上下文）
  const prompt = buildPrompt(userMessage, conversationState);

  // 2. 发送 createSurface
  const surfaceId = uuid();
  send({ createSurface: { surfaceId, version: '0.9' } });

  // 3. 调用 LLM，流式获取 A2UI JSONL
  const stream = await llm.stream({
    model: imageBase64 ? 'qwen-vl-max' : 'qwen-max',
    messages: buildMessages(prompt, imageBase64),
    stream: true,
  });

  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk.choices[0]?.delta?.content ?? '';
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        send(msg);                           // 逐行推送给客户端
      } catch { /* 非 JSON 行跳过 */ }
    }
  }

  // 4. 发送 beginRendering
  send({ beginRendering: { surfaceId, root: 'root' } });

  // 5. 保存对话历史
  conversationState.history.push({ role: 'user', content: userMessage });
  conversationState.history.push({ role: 'assistant', a2uiSnapshot: lastA2UI });
}
```

---

## 八、高级功能

### 8.1 图片理解 → A2UI

```typescript
// Step 1: 图片压缩（前端，< 1MB）
async function compressImage(file: File, maxSize = 1 * 1024 * 1024): Promise<Blob> {
  const canvas = document.createElement('canvas');
  // ... canvas resize + toBlob(quality 调整)
}

// Step 2: Vision LLM Prompt
const VISION_PROMPT = `
你是一个 UI 分析专家。请分析图片中的界面布局，识别所有 UI 组件，
输出结构化 A2UI JSON 格式。

输出格式：
{"components": [{"type": "Button|Card|Text|Input|Image", "properties": {...}}],
 "layout": {"type": "flex-row|flex-col|grid", "alignment": "center|start|end"},
 "style": {"theme": "light|dark", "spacing": "tight|normal|loose"}}
`;

// Step 3: VisionOutput → A2UINode
function visionOutputToA2UI(vision: VisionOutput): A2UINode {
  return {
    id: 'root',
    type: 'Container',
    useHint: {
      layout: vision.layout.type,
      spacing: vision.style.spacing,
    },
    children: vision.components.map((comp, i) => ({
      id: `comp_${i}`,
      type: mapComponentType(comp.type),
      styles: mapStyleProperties(comp),
    })),
  };
}
```

### 8.2 多轮对话状态管理

```typescript
interface ConversationState {
  sessionId: string;
  currentA2UI: A2UINode | null;
  history: ConversationTurn[];
  stylePreferences?: StylePreferences;
  elementMap: Map<string, DOMElementInfo>;  // 组件ID → DOM信息
}

interface ConversationTurn {
  role: 'user' | 'assistant';
  turnId: number;
  content: string;
  a2uiSnapshot?: A2UINode;          // 每次生成的 A2UI 快照
  modifiedElements?: string[];      // 被修改的组件 ID 列表
  modificationType?: 'initial' | 'refine' | 'element_edit';
}

// 上下文注入策略（节省 token）
function buildContextForLLM(state: ConversationState, newMessage: string) {
  return {
    // 摘要历史（最近 10 轮）
    summaryHistory: state.history.slice(-10).map(t => `${t.role}: ${t.content}`),
    // 当前 A2UI 状态（必须保留，供 Agent 做增量修改）
    currentA2UI: state.currentA2UI,
    userMessage: newMessage,
  };
}
```

### 8.3 Diff 增量更新

```typescript
interface A2UIDiff {
  type: 'add' | 'remove' | 'update';
  componentId: string;
  path: string;           // JSON Path，如 "children[0].children[2]"
  changes?: Record<string, any>;
}

function generateDiff(oldNode: A2UINode, newNode: A2UINode): A2UIDiff[] {
  const diffs: A2UIDiff[] = [];
  traverse(oldNode, newNode, 'root', diffs);
  return diffs;
}
```

优势：
- 只 re-render 变化的组件
- 新增组件有淡入动画，更新组件无动画
- 保持组件状态（输入框内容等）
- 避免全量重新生成（100 个组件只修改 1 个 → 只传 1 个 diff）

### 8.4 元素级交互（Click → Quote → Modify）

```typescript
// 渲染时为每个组件添加标识属性
function renderA2UINode(node: A2UINode) {
  return (
    <div
      data-component-id={node.id}
      data-component-type={node.type}
      data-use-hint={JSON.stringify(node.useHint ?? {})}
      style={mergeStyles(node.useHint, node.styles)}
      onClick={(e) => handleElementClick(e, node)}
      className={generateClassNames(node.useHint)}
    >
      {node.children?.map(child => renderA2UINode(child))}
    </div>
  );
}

// 点击处理：高亮 + 插入引用文本
function handleElementClick(e: MouseEvent, node: A2UINode) {
  document.querySelectorAll('.a2ui-selected')
    .forEach(el => el.classList.remove('a2ui-selected'));
  (e.currentTarget as HTMLElement).classList.add('a2ui-selected');

  const ref: ElementReference = {
    componentId: node.id,
    type: node.type,
    displayText: `@${node.type}[${node.id}]`,  // 插入对话框的文本
  };
  onElementSelect(ref);
}
```

Agent Prompt 示例（元素级修改）：
```
## 当前任务：元素级修改
选中的元素：@Button[btn_2]，JSON Path: children[0].children[2]
当前属性：{"text": "提交", "color": "blue"}
当前 useHint：{"style": "elevated"}

## 用户修改需求
请修改 @Button[btn_2]，把颜色改成红色

## 当前完整 A2UI 协议
{...完整协议...}

## 对话历史
user: 创建一个登录页面
user: 请修改 @Button[btn_2]，把颜色改成红色

## 输出要求
- 直接返回修改后的完整 A2UI 协议（JSON 格式）
- 保持其他未修改元素不变
- 返回完整协议，不只是修改部分
```

---

## 九、样式系统：useHint + styles

### 9.1 双层样式架构

```
useHint（语义化，中等优先级）→ 转换为 CSS 类名
styles（精细控制，最高优先级）→ 直接内联样式

最终样式 = merge(defaultStyles, useHintToCss(useHint), styles)
```

### 9.2 useHint 接口

```typescript
interface UseHint {
  layout?:      'flex-row' | 'flex-col' | 'grid' | 'stack' | 'inline';
  spacing?:     'tight' | 'normal' | 'loose' | 'none';
  align?:       'start' | 'center' | 'end' | 'stretch';
  justify?:     'start' | 'center' | 'end' | 'between' | 'around';
  size?:        'fit-content' | 'fill-container' | 'fixed';
  height?:      'short' | 'medium' | 'tall' | 'full';
  width?:       'narrow' | 'medium' | 'wide' | 'full';
  style?:       'minimal' | 'card' | 'elevated' | 'bordered' | 'glass';
  theme?:       'light' | 'dark' | 'primary' | 'accent';
  interactive?: 'button' | 'link' | 'input' | 'hoverable';
  state?:       'default' | 'active' | 'disabled' | 'loading';
}
```

### 9.3 useHint → CSS 转换表

```typescript
const USE_HINT_MAPPINGS = {
  'spacing:tight':  () => ({ padding: '8px',  gap: '8px'  }),
  'spacing:normal': () => ({ padding: '16px', gap: '16px' }),
  'spacing:loose':  () => ({ padding: '24px', gap: '24px' }),

  'align:center':   () => ({ alignItems: 'center' }),
  'justify:center': () => ({ justifyContent: 'center' }),

  'style:card':     () => ({
    backgroundColor: '#ffffff', borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  }),
  'style:elevated': () => ({
    backgroundColor: '#ffffff', borderRadius: '12px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
  }),
  'style:glass':    () => ({
    backdropFilter: 'blur(10px)',
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.3)',
  }),

  'theme:light': () => ({ backgroundColor: '#ffffff', color: '#333333' }),
  'theme:dark':  () => ({ backgroundColor: '#1a1a1a', color: '#ffffff' }),
};

export function useHintToCss(hint: UseHint): CSSProperties {
  const styles: CSSProperties = {};
  Object.entries(hint).forEach(([key, val]) => {
    const mapper = USE_HINT_MAPPINGS[`${key}:${val}`];
    if (mapper) Object.assign(styles, mapper());
  });
  return styles;
}

export function mergeStyles(
  hint: UseHint | undefined,
  styles: CSSProperties | undefined
): CSSProperties {
  return { ...useHintToCss(hint ?? {}), ...styles };  // styles 覆盖 hint
}
```

---

## 十、工程最佳实践

### 10.1 Monorepo 结构

```
packages/
├── @a2ui/core         # 纯 TS，框架无关（Parser + TreeBuilder + Store）
├── @a2ui/react        # React 适配器（Renderer + 组件映射 + 淡入 HOC）
├── @a2ui/server       # Koa SSE 服务端
├── @a2ui/agent        # Agent 集成层（LLM 调用 + JSONL 生成）
└── a2ui-playground    # 完整演示 App
```

### 10.2 TypeScript Spec 驱动开发

先写接口类型（Spec），再写实现，再写测试：

```typescript
// 1. 定义 Spec
interface ServerMessage {
  createSurface?:    { surfaceId: string; version: string };
  surfaceUpdate?:    { surfaceId: string; components: Component[] };
  dataModelUpdate?:  { surfaceId: string; dataModel: Record<string, any> };
  beginRendering?:   { surfaceId: string; root: string };
  deleteSurface?:    { surfaceId: string };
}

// 2. 类型守卫
function isCreateSurface(msg: any): msg is { createSurface: {...} } {
  return msg?.createSurface !== undefined;
}

// 3. 再写实现
// 4. 再写测试
```

好处：类型安全、接口清晰、支持并行开发、文档即代码。

### 10.3 测试金字塔

```
端到端测试 (10%)
├── 完整 A2UI 流程（上传截图 → 生成 → 修改）
集成测试 (20%)
├── Parser + TreeBuilder 协作
├── Store + Renderer 协作
单元测试 (70%)
├── Parser：每种消息类型、容错
├── TreeBuilder：循环引用检测、缺失节点
├── Store：标记清除、订阅机制
└── useHintToCss：各种 hint 组合
```

### 10.4 性能优化

| 优化点 | 方案 |
|--------|------|
| 图片上传 | 前端压缩到 < 1MB |
| 对话历史 | 保留最近 10 轮 + 关键信息摘要 |
| DOM 更新 | React.memo 避免不必要重渲染 |
| useHint 转换 | 缓存结果，避免重复计算 |
| 增量渲染 | 只 re-render 变化组件 |
| 首屏优先 | 流式解析，先解析先渲染 |

### 10.5 错误处理策略

| 错误场景 | 处理策略 |
|----------|---------|
| 图片理解失败 | 降级为文字描述 |
| Parser 无效 JSON | 记录日志，跳过该行，继续 |
| 循环引用 | 抛出错误，终止 treeBuild，显示错误提示 |
| 元素定位失败 | 提示用户重新点击 |
| 样式值无效 | 自动补全单位或降级为默认值 |
| SSE 断线 | 浏览器自动重连（Last-Event-ID） |
| Nginx 缓冲 | 设置 `X-Accel-Buffering: no` |

---

## 十一、MVP 实施路线图

### Phase 1：渲染器 MVP（tech1）

**目标**：静态 JSONL → 渲染到页面

- [ ] 环境搭建：Node.js 24+、pnpm 8+
- [ ] `@a2ui/core`：Parser（parseLine + parseChunk + reset）
- [ ] `@a2ui/core`：Store（Zustand 模式，纯 JS）
- [ ] `@a2ui/core`：TreeBuilder（扁平→树，循环引用检测）
- [ ] `@a2ui/react`：基础组件（Text、Button、Column、Row）
- [ ] `@a2ui/react`：Renderer（三阶段：render → treeBuild → React.render）
- [ ] 静态 JSONL 渲染 Demo

### Phase 2：传输层 + 服务端（tech2）

**目标**：Agent 流式输出 → 实时渲染

- [ ] Koa SSE 服务端（正确 Headers、流式 write）
- [ ] AG-UI 协议封装（消息类型、传输约定）
- [ ] 客户端 SSEClient（EventSource + Parser 集成）
- [ ] 单轮 LLM Agent 集成（输出 A2UI JSONL）
- [ ] 完整端到端 Demo（提问 → 生成 UI）

### Phase 3：高级交互（tech3）

**目标**：视觉 + 记忆 + 交互 + 审美

- [ ] 图片上传 + 压缩组件
- [ ] Vision LLM 集成（Qwen-VL / GPT-4V）
- [ ] 多轮对话状态管理（ConversationState + 历史注入）
- [ ] Diff 生成算法 + 增量更新
- [ ] 元素级交互（data-component-id + 点击→引用→修改）
- [ ] useHint 语义化样式系统 + styles 精细控制
- [ ] 淡入动画 HOC

### Phase 4：生产级完善

- [ ] 协议版本协商（v0.8 / v0.9）
- [ ] 多 Surface 管理
- [ ] DataModel 与 Input 组件双向绑定
- [ ] 性能优化（React.memo、useHint 缓存）
- [ ] 错误边界 + 降级策略
- [ ] 部署（Nginx 配置、连接数限制处理）

---

## 附：关键 API 速查

```typescript
// 核心数据流
SSE chunk
  → parser.parseChunk(chunk)
  → [ParseResult]
  → switch(type):
      surfaceUpdate  → store.setComponentMap(map)
      beginRendering → renderer.renderAll()
      dataModelUpdate → store.setDataModel(model)
      deleteSurface  → store.clear()

// 渲染流程
store.setComponentMap(componentMap)       // Phase 1
  → store.setHydrateNodeMap(hydrateMap)  // Phase 2 (render)
  → treeBuild('root')                    // Phase 3 (关联)
  → React.render(rootVNode, container)   // Phase 4 (显示)

// 样式计算
mergeStyles(node.useHint, node.styles)
  = { ...useHintToCss(useHint), ...styles }  // styles 优先级最高

// 元素交互
click → handleElementClick(e, node)
  → setSelectedElement({componentId, type, displayText})
  → chatInput.prepend(`@${type}[${id}]`)
  → send(message + elementRef + currentA2UI + history)
  → agent returns modified A2UI
  → generateDiff(old, new) → batchUpdate(diffs)
```

---

> 参考文档：tech1–tech4（genui/tech/extracted/markdown/）
> AG-UI 官方文档：https://docs.ag-ui.com/
> AG-UI GitHub：https://github.com/ag-ui-protocol/ag-ui
