# Agent 工作流编排平台 — 深度技术全景

> 来源：resume.md「滴滴 llab AI Agent 工作流编排平台」+ 企业级类 Coze/Dify 架构面试资料综合整理。
> 覆盖：DAG 执行引擎、节点扩展系统、变量解析、Prompt 编辑器、RAG 节点、运行时可视化、LangGraph 对比，共 10 个维度 + 专项面试 QA。

---

## 一、项目定位与核心挑战

**目标**：让业务侧（非工程师）可视化搭建多步骤 AI 工作流，无需工程排期即可上线，AI 功能上线周期从天级压缩至小时级。

**技术本质**：可视化 DAG 编辑器（前端）+ 工作流执行引擎（后端/BFF）+ 运行时状态可视化，三层协同。核心挑战不在于「画图」：

| 挑战 | 难点 |
|------|------|
| DAG 拓扑执行 | 并行节点调度、循环检测、条件分支裁剪 |
| 变量引用与作用域 | `${nodeId.key}` 跨节点数据流、块级作用域隔离 |
| 节点可扩展性 | 增加新节点类型不改核心逻辑（开放封闭原则） |
| 运行时可视化 | SSE 乱序推送与画布状态强一致 |
| Prompt 编辑体验 | 富文本变量插入、`${}` 高亮与序列化 |

---

## 二、DAG 数据模型

### 2.1 核心数据结构

```ts
interface Workflow {
  id: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: GlobalVariable[];
}

interface WorkflowNode {
  id: string;
  type: NodeType; // 见下方枚举
  position: { x: number; y: number };
  data: {
    label: string;
    config: NodeConfig;     // 每种类型独立 Schema（用 Zod 定义）
    inputs: Port[];
    outputs: Port[];
  };
}

type NodeType =
  | 'start' | 'end'
  | 'llm'           // LLM 对话
  | 'tool'          // HTTP / 搜索 / POI / 天气
  | 'condition'     // 条件分支路由
  | 'loop'          // forEach / whileTrue
  | 'knowledge'     // RAG 知识库检索
  | 'human_review'; // 人工审核暂停

interface WorkflowEdge {
  id: string;
  source: string;       // 源节点 id
  sourceHandle: string; // 源端口 id
  target: string;
  targetHandle: string;
  conditionLabel?: string; // condition 节点分支标签（true/false 或自定义）
}

interface Port {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  required: boolean;
}
```

**设计决策**：
- `conditionLabel` 挂在 Edge 上，条件路由由**后端执行**，前端不做表达式求值
- 节点 Config 用 **Zod Schema** 定义，前端运行时校验 + 序列化导出复用同一 Schema
- 端口类型系统做静态兼容性检查，防止运行时类型错误

---

## 三、执行引擎：Kahn 算法拓扑调度

### 3.1 为什么用 Kahn 而不是 DFS

DFS 拓扑排序需要完整递归后输出结果，无法增量感知「哪些节点当前可执行」。

**Kahn 算法** 基于「入度」驱动，天然契合 DAG 流程执行的并行调度：

```
算法流程：
1. 计算所有节点入度 inDegree[nodeId]
2. 将所有入度为 0 的节点放入执行队列（可并行触发）
3. 某节点执行完成后，其所有后继节点 inDegree -= 1
4. inDegree 降为 0 的后继节点立即入队
5. 循环直到队列为空（所有节点执行完）或检测到死锁（存在环）
```

```ts
// 前端根据 DAG 结构预计算执行顺序（用于 UI 动画预判）
function buildExecutionPlan(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>(); // nodeId → 后继 nodeId[]

  nodes.forEach(n => { inDegree.set(n.id, 0); graph.set(n.id, []); });
  edges.forEach(e => {
    graph.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  });

  const queue: string[] = [];
  inDegree.forEach((deg, id) => { if (deg === 0) queue.push(id); });

  const order: string[][] = []; // 每层可并行的节点组
  while (queue.length) {
    order.push([...queue]);
    const next: string[] = [];
    queue.splice(0).forEach(id => {
      graph.get(id)!.forEach(successor => {
        const newDeg = inDegree.get(successor)! - 1;
        inDegree.set(successor, newDeg);
        if (newDeg === 0) next.push(successor);
      });
    });
    queue.push(...next);
  }
  return order; // [[start], [llm], [condition], [tool, llm-2], [end]]
}
```

**实际使用**：后端执行引擎用此算法驱动真实调度；前端用此预计算结果做**动画预判**（在 SSE 事件到达前提前高亮「即将执行」的节点，降低感知延迟）。

### 3.2 环检测（防死循环 DAG）

Kahn 算法执行完成后，如果 `inDegree` 中仍有非零节点，说明存在环：

```ts
const hasCircle = (nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean => {
  // 用上面 buildExecutionPlan 的中间结果
  // 执行完后检查是否所有节点都进入了 order
  const totalProcessed = order.flat().length;
  return totalProcessed !== nodes.length;
};
```

**前端时机**：每次新增 Edge 时触发环检测，检测到环则拒绝连线并标红提示。
**Loop 节点处理**：Loop 节点的内部子图（`body` 字段）是合法的"内部回边"，环检测时将 Loop 节点视为原子整体，不展开其子图。

### 3.3 条件分支子树裁剪

Condition 节点执行时，后端确定走哪条边，未激活分支的所有下游节点进入 `skipped` 状态：

```ts
// 后端通知前端激活哪条边
interface ConditionEvent {
  type: 'condition_branch';
  nodeId: string;
  activeEdge: string; // 激活的 edgeId
  skippedNodes: string[]; // 子树裁剪结果：已跳过的节点 id 列表
}
```

前端收到后：激活边高亮蓝色，skippedNodes 批量更新为 `skipped`（灰色半透明），无需前端自行做子树 BFS。

---

## 四、变量引用与 ExecutionContext

### 4.1 `${nodeId.key}` 变量引用机制

节点 Prompt / 表达式中通过 `${nodeId.variableName}` 引用上游输出：

```
示例工作流：
  start → llm_1（输出 answer）→ tool_1（HTTP 请求）
               ↓
  tool_1 的 URL 配置：https://api.example.com?q=${llm_1.answer}
```

**后端 ExecutionContext**：每次工作流执行维护一个上下文 Map：

```ts
interface ExecutionContext {
  workflowId: string;
  runId: string;
  variables: Map<string, any>; // key = `${nodeId}.${varName}`
  resolve(template: string): string; // 替换 ${...} 占位符
}
```

**前端变量提示**：节点配置面板输入 `${` 时，BFS 向上遍历所有可达上游节点，收集已定义的 outputVar，展示补全列表（含类型标注）：

```ts
function getReachableVars(nodeId: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  const visited = new Set<string>();
  const queue = [nodeId];
  const vars: VariableHint[] = [];

  while (queue.length) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);

    edges
      .filter(e => e.target === cur)
      .forEach(e => {
        const upstream = nodes.find(n => n.id === e.source)!;
        upstream.data.outputs.forEach(p => {
          vars.push({ nodeId: e.source, portName: p.name, type: p.type });
        });
        queue.push(e.source);
      });
  }
  return vars;
}
```

### 4.2 变量作用域规则

```
全局变量（Workflow.variables）  →  所有节点可读
上游节点输出变量               →  当前节点及其所有下游可读
Loop 节点迭代变量              →  仅循环体内可读（块级作用域）
条件分支变量                   →  仅该分支路径可读
```

**静态分析**：如果变量 `x` 定义在条件分支 A 中，但节点 B 在分支 A 和 B 的汇合点之后引用了 `x`，前端标黄警告「变量 x 在某些执行路径下可能未定义」。

---

## 五、节点扩展系统：Registry Pattern

PDF 中指出这是架构亮点，对应简历「节点类型覆盖 LLM / 工具 / 条件 / 循环 / 人工审核」的实现机制。

### 5.1 BaseNodeExecutor 抽象基类

```ts
// 后端节点执行基类（前端 Node Schema 与之镜像对应）
abstract class BaseNodeExecutor<TConfig = any> {
  abstract type: NodeType;

  // 子类必须实现的执行方法
  abstract execute(config: TConfig, ctx: ExecutionContext): Promise<NodeOutput>;

  // 公共能力：日志记录、变量解析、耗时统计
  protected log(ctx: ExecutionContext, msg: string) { /* ... */ }
  protected resolveVar(template: string, ctx: ExecutionContext) {
    return ctx.resolve(template);
  }
  protected async withTiming<T>(fn: () => Promise<T>): Promise<[T, number]> {
    const start = Date.now();
    const result = await fn();
    return [result, Date.now() - start];
  }
}
```

### 5.2 NodeRegistry 注册中心

```ts
class NodeRegistry {
  private static map = new Map<NodeType, BaseNodeExecutor>();

  static register(executor: BaseNodeExecutor) {
    this.map.set(executor.type, executor);
  }

  static get(type: NodeType): BaseNodeExecutor {
    const executor = this.map.get(type);
    if (!executor) throw new Error(`未知节点类型: ${type}`);
    return executor;
  }
}

// 系统启动时注册内置节点
NodeRegistry.register(new LLMNodeExecutor());
NodeRegistry.register(new HTTPToolExecutor());
NodeRegistry.register(new ConditionExecutor());
NodeRegistry.register(new KnowledgeExecutor()); // RAG 节点
NodeRegistry.register(new HumanReviewExecutor());
```

### 5.3 新增节点只需三步（开放封闭原则）

```ts
// 以「发送邮件」节点为例
class EmailExecutor extends BaseNodeExecutor<EmailConfig> {
  type = 'email' as NodeType;

  async execute(config: EmailConfig, ctx: ExecutionContext) {
    const to = this.resolveVar(config.to, ctx);       // ${step1.email}
    const body = this.resolveVar(config.body, ctx);   // ${llm1.answer}
    await sendEmail({ to, subject: config.subject, body });
    return { success: true };
  }
}

// 注册（新增文件，不改任何现有代码）
NodeRegistry.register(new EmailExecutor());
```

**前端对应**：NodeSchema Registry 同样结构，前端动态注册节点的渲染组件和配置面板：

```ts
const nodeComponentMap: Record<NodeType, FC<NodeProps>> = {
  llm: LLMNode,
  tool: ToolNode,
  condition: ConditionNode,
  knowledge: KnowledgeNode,
  email: EmailNode,  // 新增一行
};
```

---

## 六、Prompt 变量编辑器（Tiptap 富文本）

### 6.1 为什么不用普通 textarea

普通 `<textarea>` 无法实现变量高亮块——`${llm1.answer}` 需要显示为带颜色标签，删除时整体删除，不能手动改内部文字。

**方案**：基于 **Tiptap**（ProseMirror 封装），开发自定义 `variableMention` Node Extension：

### 6.2 实现方案

```ts
// 自定义 variableMention 扩展
const VariableMention = Node.create({
  name: 'variableMention',
  group: 'inline',
  inline: true,
  atom: true, // 原子节点，不可内部编辑

  addAttributes() {
    return {
      nodeId: { default: null },
      varName: { default: null },
      displayText: { default: null }, // 展示为 "${llm1.answer}"
    };
  },

  renderHTML({ node }) {
    return ['span', {
      class: 'variable-tag',
      'data-node-id': node.attrs.nodeId,
      'data-var': node.attrs.varName,
      style: 'background:#e6f4ff;border-radius:4px;padding:0 4px;color:#1677ff',
    }, `\${${node.attrs.nodeId}.${node.attrs.varName}}`];
  },
});

// Suggestion 插件：输入 ${ 时触发变量补全弹窗
const variableSuggestion = Suggestion({
  char: '${',
  command({ editor, range, props }) {
    editor.chain().focus()
      .deleteRange(range)
      .insertContent({
        type: 'variableMention',
        attrs: {
          nodeId: props.nodeId,
          varName: props.varName,
          displayText: `\${${props.nodeId}.${props.varName}}`,
        },
      })
      .run();
  },
  items: ({ query }) => getReachableVars(currentNodeId).filter(v =>
    `${v.nodeId}.${v.varName}`.includes(query)
  ),
});
```

### 6.3 序列化与反序列化

```ts
// 存储时：Tiptap JSON → 标准变量引用字符串
const serialize = (doc: JSONContent): string => {
  return doc.content?.flatMap(block =>
    block.content?.map(node =>
      node.type === 'variableMention'
        ? `\${${node.attrs.nodeId}.${node.attrs.varName}}`
        : node.text ?? ''
    ) ?? []
  ).join('') ?? '';
};

// 加载时：字符串 → Tiptap JSON（正则解析还原原子节点）
const deserialize = (template: string): JSONContent => {
  const parts = template.split(/(\$\{[^}]+\})/);
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: parts.map(p => {
      const match = p.match(/^\$\{(.+?)\.(.+?)\}$/);
      if (match) return { type: 'variableMention', attrs: { nodeId: match[1], varName: match[2] } };
      return { type: 'text', text: p };
    })}],
  };
};
```

---

## 七、RAG 知识库节点

### 7.1 节点功能

Knowledge 节点将文档检索能力嵌入工作流，用户上传文档后可在 LLM Prompt 中注入检索结果：

```
用户问题 → Knowledge 节点（向量检索 Top-K） → 检索结果 → LLM 节点（带上下文回答）
```

### 7.2 RAG 管道设计（前端关注的工程部分）

**文档预处理**（前端上传交互）：
- 文件上传进度 + 处理阶段可视化：`上传中 → 解析中 → 分块中 → 向量化中 → 就绪`
- 分块策略：语义分块（按 Markdown 标题/段落）优于固定字符切割，保持上下文完整性
- 前端展示：文档管理页展示每个 chunk 的 embedding 状态，支持手动标注排除噪声 chunk

**检索质量优化**（节点配置暴露给用户）：
```ts
interface KnowledgeConfig {
  knowledgeBaseId: string;
  topK: number;                    // 召回数量（默认 5）
  threshold: number;               // 相似度阈值（默认 0.7）
  searchMode: 'vector' | 'hybrid'; // 向量检索 or 混合检索
  // hybrid 模式下：BM25（关键词）+ Embedding（语义）→ RRF 融合排序
  rerankEnabled: boolean;          // 是否启用 Re-rank 模型精排
}
```

**混合检索（Hybrid Search）**：
- 单纯向量搜索对精确关键词（如专有名词、代码）效果差
- BM25（关键词）解决精确匹配，Embedding 解决语义相似
- **RRF（Reciprocal Rank Fusion）**：两路结果按排名倒数加权融合，无需调参

---

## 八、运行时状态可视化

### 8.1 SSE 事件协议设计

后端推送的 SSE 事件统一结构，前端按 `eventType` 分发处理：

```ts
// 所有工作流 SSE 事件的基础类型
type WorkflowEvent =
  | { type: 'node_start';    sequence: number; nodeId: string; iterationIndex?: number }
  | { type: 'node_stream';   sequence: number; nodeId: string; delta: string }  // LLM 流式 token
  | { type: 'node_done';     sequence: number; nodeId: string; output: Record<string, any>; durationMs: number }
  | { type: 'node_failed';   sequence: number; nodeId: string; error: string }
  | { type: 'node_skipped';  sequence: number; nodeId: string }                 // 条件分支裁剪
  | { type: 'condition_branch'; sequence: number; nodeId: string; activeEdge: string; skippedNodes: string[] }
  | { type: 'workflow_done'; runId: string; totalDurationMs: number }
  | { type: 'workflow_failed'; runId: string; error: string };
```

### 8.2 幂等状态机

状态单向流转，防止乱序 SSE 导致状态回退：

```ts
const STATUS_PRIORITY = { pending: 0, running: 1, done: 2, failed: 2, skipped: 2 };

const updateNodeStatus = (nodeId: string, next: NodeStatus) => {
  const current = nodeStatusMap.get(nodeId) ?? 'pending';
  // 优先级相同或退化，直接忽略（幂等保证）
  if (STATUS_PRIORITY[next] <= STATUS_PRIORITY[current]) return;
  nodeStatusMap.set(nodeId, next);
  flushNodeStyle(nodeId);
};
```

### 8.3 sequence 缓冲区处理乱序

并行节点（Fork）多分支并发执行，SSE sequence 差距可达 10+，直接丢弃会导致状态缺失：

```ts
let expectedSeq = 0;
const buffer: WorkflowEvent[] = [];

const onSSEEvent = (event: WorkflowEvent) => {
  buffer.push(event);
  buffer.sort((a, b) => a.sequence - b.sequence);

  while (buffer.length && buffer[0].sequence === expectedSeq) {
    dispatch(buffer.shift()!);
    expectedSeq++;
  }
};

const dispatch = (event: WorkflowEvent) => {
  switch (event.type) {
    case 'node_start':   updateNodeStatus(event.nodeId, 'running'); break;
    case 'node_done':    updateNodeStatus(event.nodeId, 'done'); showOutput(event); break;
    case 'node_failed':  updateNodeStatus(event.nodeId, 'failed'); showError(event); break;
    case 'node_skipped': updateNodeStatus(event.nodeId, 'skipped'); break;
    case 'node_stream':  appendStreamToken(event.nodeId, event.delta); break;
    case 'condition_branch':
      highlightEdge(event.activeEdge);
      event.skippedNodes.forEach(id => updateNodeStatus(id, 'skipped'));
      break;
  }
};
```

### 8.4 节点样式纯函数映射

```ts
const NODE_STYLE: Record<NodeStatus, React.CSSProperties> = {
  pending:  { border: '1px solid #d9d9d9', background: '#fafafa' },
  running:  { border: '2px solid #1677ff', animation: 'flowLight 1.5s infinite' },
  done:     { border: '2px solid #52c41a', background: '#f6ffed' },
  failed:   { border: '2px solid #ff4d4f', background: '#fff2f0' },
  skipped:  { border: '1px dashed #bfbfbf', opacity: 0.5 },
};
```

React.memo + Zustand atom 下沉：`nodeStatus` 订阅下沉到每个节点组件内部，状态更新不触发顶层 `setNodes` 全量重渲染。

---

## 九、复杂节点处理

### 9.1 循环节点（Loop）

```ts
interface LoopConfig {
  loopType: 'forEach' | 'whileTrue';
  iterateVar: string;          // forEach：遍历的数组变量名
  conditionExpr?: string;      // whileTrue：循环条件
  maxIterations: number;       // 安全阈值，防止死循环
  body: string[];              // 循环体节点 id 集合（子图）
}
```

前端展示：
- 折叠模式（默认）：循环节点卡片内显示「当前迭代 N/M」进度条 + 最新迭代子节点状态
- SSE 事件携带 `iterationIndex`，前端维护 `loopHistory: Map<nodeId, IterationRecord[]>`
- 展开模式：侧边抽屉逐次迭代历史，可查看每次迭代的 input/output 快照

### 9.2 并行节点 Fork/Join

- Fork 节点输出多条边，后端并行触发多个分支，SSE 多路 `node_start` 同时到来
- Join 节点聚合模式：
  - `ALL`：等所有上游 done（后端保证），前端等所有前驱 done 后节点才能收到 node_start
  - `ANY`：任一分支 done 即触发（竞速/降级场景）

### 9.3 人工审核节点

```
工作流暂停 → 节点 running 状态 + 「等待审核」badge
→ 审核人在节点 Popover 里选 Approve/Reject
→ 前端调 POST /workflow/runs/:runId/review
→ 后端继续推送后续 SSE 事件
```

SSE 连接在等待期间保持（后端心跳机制），超时后自动 Reject 并推送 `node_failed` 事件。

---

## 十、自研 DAG 引擎 vs LangGraph 对比

| 维度 | 自研 DAG 引擎 | LangGraph |
|------|-------------|-----------|
| 图结构 | 静态 DAG（有向无环图） | 状态机 + Graph（支持有向有环图） |
| 执行模型 | Kahn 拓扑排序，线性可预测 | 动态路由，节点决定下一步 |
| 循环支持 | Loop 节点封装循环体（受控） | 原生支持 Cyclic Graph |
| 动态路由 | 条件分支节点 + 子树裁剪 | 任意节点可返回多条件边 |
| 人机交互 | 人工审核节点（Pause/Resume） | 原生 Interrupt + Checkpoint |
| 可调试性 | 每步输出快照 + 完整日志 | Checkpoint 恢复，断点续跑 |
| 适用场景 | 业务流程编排（可视化 workflow） | 复杂 Agent（多轮对话、自反思、工具调用循环） |

**项目中的结合策略**（PDF 课程建议，简历可引用）：
- 自研 DAG 引擎处理**确定性业务流程**（标准节点编排，可视化配置）
- 在 LLM 节点或特定「复杂推理」节点内部，集成 **LangGraph** 实现 ReAct 循环（Tool → Observe → Think → Act），实现局部 AI 自主性
- 两者边界：DAG 管宏观流程，LangGraph 管微观 Agent 推理

---

## 十一、性能优化

### 11.1 大 DAG 渲染优化

- **React.memo + Zustand atom 下沉**：运行时状态订阅在节点内部，`nodeStatus` 更新不触发顶层 `setNodes`
- **ReactFlow virtualization**：viewport 外节点跳过渲染
- **拖拽连线预计算**：拖拽开始时 O(n) 预计算兼容端口 Set，hover 时 O(1) 查询

### 11.2 连线类型校验

```ts
const isValidConnection = (conn: Connection): boolean => {
  const srcPort = getPort(conn.source, conn.sourceHandle, 'output');
  const tgtPort = getPort(conn.target, conn.targetHandle, 'input');
  if (!srcPort || !tgtPort) return false;
  if (tgtPort.type === 'any' || srcPort.type === 'any') return true;
  return srcPort.type === tgtPort.type;
};
```

---

## 十二、面试深挖速查（完整版）

| 问题 | 核心答案 |
|------|---------|
| 为什么用 Kahn 算法而不是 DFS 拓扑排序？ | DFS 需要完整递归才能输出，无法感知「当前可执行节点」；Kahn 基于入度驱动，入度归零即可调度，天然支持并行节点的增量并发触发，也可直接检测环（执行完后仍有非零入度节点）。 |
| DAG 环检测具体怎么实现？ | Kahn 执行后检查是否所有节点都进入了执行序列；连线时增量检测：对新边做 DFS，Loop 节点子图整体折叠不展开，防止误判内部循环。 |
| 变量 `${nodeId.key}` 如何实现跨节点引用？ | ExecutionContext 维护 `Map<string, any>`，key 为 `nodeId.varName`；节点执行完后写入输出变量；后续节点 Config 中的模板字符串由 `ctx.resolve()` 替换；前端节点配置面板 BFS 向上遍历可达上游提供变量补全。 |
| 节点扩展系统怎么实现「新增节点不改核心逻辑」？ | Registry Pattern：BaseNodeExecutor 抽象基类定义 execute 接口；NodeRegistry 维护 Map；新增节点继承基类、注册一行代码，核心调度器只调 `registry.get(type).execute()`，不感知具体类型，符合开放封闭原则。 |
| Prompt 编辑器的 `${}` 变量插入怎么实现？ | Tiptap 自定义 `variableMention` 原子节点（atom:true，不可内部编辑）+ Suggestion 插件（输入 `${` 时弹出变量列表）；存储时序列化为 `${nodeId.varName}` 字符串，加载时正则解析还原原子节点，Tiptap 负责高亮展示。 |
| 条件分支「未激活路径」怎么处理？ | 后端执行 condition 节点后，通过 SSE 推送 `condition_branch` 事件，携带 `activeEdge` 和 `skippedNodes` 列表；前端批量更新 skippedNodes 为 `skipped` 状态（灰色半透明），前端不做条件求值，避免前后端语义不一致。 |
| SSE 乱序了怎么处理？ | 事件携带 `sequence` 序列号，前端维护缓冲区收集后按 sequence 排序，按序消费（expectedSeq 递增）；并行节点多分支 sequence 差距可达 10+，缓冲+排序是唯一正确解，不能丢弃。 |
| 幂等状态机如何防止状态回退？ | STATUS_PRIORITY 常量（pending<running<done/failed/skipped）；收到事件时对比当前优先级，低于或等于当前状态的更新直接丢弃；保证乱序/重发不导致 done→running 的异常回退。 |
| RAG 节点如何提升检索质量？ | 混合检索（BM25 关键词 + Embedding 语义）+ RRF 融合排序；元数据过滤缩小检索范围；可选 Re-rank 模型精排 Top-K 结果；前端暴露 topK、threshold、searchMode 配置给业务方调优。 |
| 循环节点多次迭代如何在画布展示？ | SSE 事件携带 `iterationIndex`，前端维护 `loopHistory`；默认折叠显示当前迭代进度条，点击展开侧边抽屉查看历史迭代 input/output 快照，`maxIterations` 防止死循环。 |
| 自研 DAG 引擎和 LangGraph 什么区别，怎么选？ | 自研 DAG：静态图、Kahn 线性调度、可视化配置，适合确定性业务流程；LangGraph：状态机+有环图，支持 ReAct 自反思循环，适合复杂 Agent 推理。实际项目：DAG 管宏观流程编排，LLM 节点内部嵌入 LangGraph 实现 Tool-Observe-Think-Act 循环，两者边界清晰。 |
| 人工审核节点工作流怎么暂停等待？ | 节点 running + SSE 长连接保持（心跳维活）；审核人在节点 Popover 操作，前端调 `/workflow/runs/:runId/review` API；后端继续推送后续节点 SSE；超时自动 Reject 并推送 node_failed。 |
| 为什么前端不做条件表达式求值？ | 避免前后端表达式语义不一致（类型转换、函数支持差异）导致 UI 与实际执行路径不符，产生「画布显示走 A 分支，实际走 B 分支」的误导性 bug；条件路由是后端职责，前端只负责展示激活结果。 |
| 大 DAG（50+ 节点）频繁 SSE 更新卡顿怎么优化？ | nodeStatus 通过 Zustand atom 下沉到节点组件内部订阅（不触发顶层 setNodes）；React.memo 隔离重渲染；ReactFlow virtualization 跳过视口外节点渲染；条件分支 skippedNodes 批量一次性更新而非逐条触发。 |
| 工作流 JSON Schema 如何防止破坏性变更？ | 节点 type 版本化（llm_v2）；导入时用 Zod 做 Schema 校验，不认识字段容错保留；删除已连接端口时检测受影响 Edge 并弹出 breaking change 提示；后端做最终合法性校验，前端只做 UX 层预警。 |
