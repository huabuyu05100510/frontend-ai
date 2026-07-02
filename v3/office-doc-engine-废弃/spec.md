# 在线 Office 文档引擎 — 技术规格文档 v1.0

> 对标：Google Docs / Microsoft 365 Online / Notion / 飞书文档
> 版本：v1.0 | 日期：2026-06
> 定位：生产级在线文档编辑引擎，TDD 开发，可独立运行 demo

---

## 0. 设计原则

| 原则 | 说明 |
|------|------|
| **AI 原生** | AI 不是插件，是文档基础设施的一部分 |
| **协同优先** | OT 算法保证多人编辑一致性，非事后补丁 |
| **TDD 驱动** | 核心算法先写测试，实现只为通过测试 |
| **最小依赖** | 核心逻辑 0 外部依赖，可独立测试 |
| **可观测** | 性能数据可见，FPS/渲染耗时实时展示 |

---

## 1. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│  Toolbar | DocEditor | AICopilot | VersionHistory | PerfPanel│
├─────────────────────────────────────────────────────────────┤
│                      Editor Engine                           │
│  EditorCore(ProseMirror) | AISuggestionPlugin | CollabPlugin │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ DocumentModel│  OTEngine    │  AIEngine    │  VersionStore  │
│ (Block CRUD) │ (Transform)  │ (Streaming)  │ (Snapshot+Diff)│
├──────────────┴──────────────┴──────────────┴────────────────┤
│                     Infrastructure                           │
│       EventBus | PerfCollector | ExportEngine               │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 文档数据模型

### 2.1 Block 类型系统

```typescript
type BlockType =
  | 'heading'       // h1-h6，attrs: { level: 1|2|3|4|5|6 }
  | 'paragraph'     // 普通段落
  | 'blockquote'    // 引用块
  | 'code_block'    // 代码块，attrs: { language: string }
  | 'bullet_list'   // 无序列表
  | 'ordered_list'  // 有序列表
  | 'list_item'     // 列表项
  | 'table'         // 表格
  | 'image'         // 图片，attrs: { src, alt, width, height }
  | 'divider'       // 分割线

type InlineType =
  | 'text'
  | 'bold' | 'italic' | 'underline' | 'strikethrough'
  | 'code' | 'link' | 'highlight' | 'ai_generated'
```

### 2.2 核心 Block 结构

```typescript
interface Block {
  id: string                          // uuid v4
  type: BlockType
  content: string                     // plain text content
  children: string[]                  // child block IDs (ordered)
  props: Record<string, unknown>      // type-specific props
  meta: {
    createdBy: string
    createdAt: number
    updatedAt: number
    version: number
  }
}

interface Document {
  id: string
  title: string
  rootId: string
  blocks: Record<string, Block>       // flat map, O(1) lookup
  children: Record<string, string[]>  // parentId → childIds
  meta: DocumentMeta
}
```

### 2.3 DocumentModel 操作 API

```typescript
class DocumentModel {
  // 查询
  getBlock(id: string): Block
  getChildren(parentId: string): Block[]
  getPath(blockId: string): string[]   // 返回从根到节点的路径
  findBlocks(predicate: (b: Block) => boolean): Block[]
  search(query: string): SearchResult[]
  stats(): DocumentStats               // wordCount, charCount, blockCount

  // 变更（每次变更生成 Operation，供 OT 使用）
  insertBlock(parentId: string, index: number, block: Omit<Block, 'id'>): Operation
  deleteBlock(blockId: string): Operation
  updateBlock(blockId: string, patch: Partial<Block>): Operation
  moveBlock(blockId: string, newParentId: string, newIndex: number): Operation

  // 序列化
  toJSON(): Document
  static fromJSON(json: Document): DocumentModel

  // 快照（供 VersionStore 使用）
  snapshot(): DocumentSnapshot
}
```

---

## 3. OT 协同引擎（Operational Transformation）

### 3.1 操作原语

```typescript
// 字符串级别操作（映射到文本节点）
type Op =
  | { type: 'retain'; n: number }      // 保留 n 个字符不变
  | { type: 'insert'; text: string }   // 插入文本
  | { type: 'delete'; n: number }      // 删除 n 个字符

type OperationList = Op[]
```

### 3.2 核心算法：transform

```
前提：doc0 是共同基准
Alice: op_a = [retain(3), insert("hello")]  → doc_a
Bob:   op_b = [retain(5), insert("world")]  → doc_b

目标：双方最终收敛到相同状态 doc_final
  transform(op_a, op_b) → [op_a', op_b']
  apply(doc_b, op_a') == apply(doc_a, op_b') == doc_final

收敛性定理（测试验证）：
  ∀ op_a, op_b, doc:
    apply(apply(doc, op_a), T(op_b, op_a)) ≡
    apply(apply(doc, op_b), T(op_a, op_b))
```

### 3.3 OTEngine API

```typescript
class OTEngine {
  // 将 op1 变换到 op2 之后执行（返回 [op1', op2']）
  static transform(op1: OperationList, op2: OperationList): [OperationList, OperationList]

  // 将两个操作组合为一个等价操作
  static compose(op1: OperationList, op2: OperationList): OperationList

  // 将操作应用到字符串，返回新字符串
  static apply(doc: string, ops: OperationList): string

  // 验证操作列表合法性（长度守恒等）
  static validate(ops: OperationList, docLen: number): boolean

  // 生成逆操作（用于撤销）
  static invert(ops: OperationList, doc: string): OperationList
}
```

### 3.4 CollabEngine（多人协同模拟器）

```typescript
interface CollabUser {
  id: string
  name: string
  color: string
  cursor: CursorPosition | null
  selection: SelectionRange | null
}

class CollabEngine {
  // 模拟服务端：持有权威文档状态 + 操作历史
  private serverDoc: string
  private history: OperationList[]

  // 提交操作（含 OT 变换）
  submit(userId: string, ops: OperationList, revision: number): OperationList

  // 模拟第二用户行为（定时插入操作）
  simulateUser(userId: string, interval: number): Disposable

  // Awareness：光标/选区状态
  updateAwareness(userId: string, state: Partial<CollabUser>): void
  getAwareness(): CollabUser[]

  on(event: 'remote-op', handler: (ops: OperationList, userId: string) => void): void
  on(event: 'awareness', handler: (users: CollabUser[]) => void): void
}
```

---

## 4. AI 引擎（AIEngine）

### 4.1 支持的命令

| 命令 | 触发方式 | 描述 |
|------|----------|------|
| `continue` | 光标停留 800ms | 幽灵文本续写建议 |
| `summarize` | 选中文本 → 浮动菜单 | 摘要当前选区或全文 |
| `translate` | 选中 → 指定目标语言 | 流式翻译 |
| `fix_grammar` | 选中 → 修正语法 | 语法和用词修正 |
| `expand` | 选中 → 扩写 | 扩展内容 |
| `shorten` | 选中 → 压缩 | 精简内容 |

### 4.2 AIEngine API

```typescript
interface AIRequest {
  command: AICommand
  selectedText: string
  context?: string              // 选区前后的上下文
  targetLanguage?: string       // 用于 translate
  documentOutline?: string[]    // 用于 continue（避免偏题）
}

class AIEngine {
  // 流式生成（AsyncGenerator，支持 AbortSignal）
  stream(request: AIRequest, signal?: AbortSignal): AsyncGenerator<string>

  // 语言检测（zh/en/ja/...）
  detectLanguage(text: string): string

  // 构建 AI 上下文（提取文档结构信息，限制 token 数）
  buildContext(doc: DocumentModel, selectionPos: number, maxTokens?: number): AIContext
}

interface AIContext {
  selectedText: string
  surroundingText: string     // 选区前后各 200 字
  documentTitle: string
  outlineHeadings: string[]
  estimatedTokens: number
}
```

### 4.3 幽灵文本（Ghost Text）机制

```
用户停止输入（800ms debounce）
    ↓
AIEngine.stream({ command: 'continue', ... })
    ↓
ProseMirror Decoration: "ghost" span（灰色）插入光标后
    ↓
用户按 Tab → 接受：将 ghost text 写入文档，标记 ai_generated mark
用户按 Esc  → 拒绝：移除 decoration
用户继续输入 → 自动取消上一次流，重新触发
```

---

## 5. 版本历史（VersionStore）

### 5.1 快照策略

```
触发快照的条件：
  1. 用户手动"保存版本"
  2. 自动：每隔 30s（有变更时）
  3. 自动：执行重大 AI 操作前（保护现场）

快照数据结构：
  VersionSnapshot {
    id: string             // hash(content)
    label: string          // 自动："自动保存 14:32" / 手动："发布前版本"
    content: DocumentJSON  // 完整文档快照
    timestamp: number
    isPinned: boolean      // 固定版本不参与 LRU 淘汰
    author: string
    stats: { wordCount, charCount }
  }

存储上限：50 个快照（LRU）
固定版本：不受上限约束
```

### 5.2 Diff 算法

```typescript
// Myers diff 算法（字符串级别）
// 输出结构化的 diff，用于版本对比视图

interface DiffChunk {
  type: 'equal' | 'insert' | 'delete'
  text: string
  lineNumber?: number
}

class DiffEngine {
  // 计算两个文档快照之间的差异
  static diff(before: string, after: string): DiffChunk[]

  // 统计变更量
  static summary(chunks: DiffChunk[]): DiffSummary  // { added, removed, unchanged }
}
```

---

## 6. 导出引擎（ExportEngine）

```typescript
class ExportEngine {
  // Markdown 导出（保留标题层级、列表、代码块）
  toMarkdown(doc: DocumentModel): string

  // HTML 导出（带基础样式）
  toHTML(doc: DocumentModel): string

  // 纯文本（去除所有格式）
  toPlainText(doc: DocumentModel): string

  // JSON（lossless，供导入使用）
  toJSON(doc: DocumentModel): string
}
```

### 6.1 Markdown 转换规则

```
heading(level=1)  → # 内容
heading(level=2)  → ## 内容
paragraph         → 内容\n
blockquote        → > 内容
code_block(lang)  → ```lang\n内容\n```
bullet_list item  → - 内容
ordered_list item → 1. 内容
divider           → ---
image             → ![alt](src)
```

---

## 7. 性能监控（PerfCollector + PerfPanel）

### 7.1 采集指标

```typescript
interface PerfSnapshot {
  fps: number              // 1s 滑动窗口，rAF 计数
  operationTime: number    // ms，最近一次 OT transform 耗时
  renderTime: number       // ms，ProseMirror docChanged 到 DOM 更新
  aiLatency: number        // ms，AI 首 token 延迟
  documentSize: number     // 字符总数
  blockCount: number       // block 总数
  collaborators: number    // 当前在线用户数
}
```

### 7.2 PerfPanel 展示

```
┌──────────────────────────┐
│  PERF MONITOR       [×]  │
│──────────────────────────│
│  FPS     ██████████  60  │
│  OT      ▌        0.3ms  │
│  Render  ████      4.1ms │
│  AI首帧  ──────    280ms  │
│  文档    2,341 字         │
│  协作者  👤 2            │
└──────────────────────────┘
位置：fixed 右下角，monospace 11px，backdrop-blur
```

---

## 8. ProseMirror 编辑器规格

### 8.1 Schema 节点

| Node | Content | Marks | 说明 |
|------|---------|-------|------|
| `doc` | `block+` | - | 根节点 |
| `heading` | `inline*` | 全部 | level 1-6 |
| `paragraph` | `inline*` | 全部 | 默认段落 |
| `blockquote` | `block+` | - | 引用块 |
| `code_block` | `text*` | - | 代码，保留空白 |
| `bullet_list` | `list_item+` | - | 无序列表 |
| `ordered_list` | `list_item+` | - | 有序列表 |
| `list_item` | `paragraph block*` | - | 列表项 |
| `horizontal_rule` | - | - | 分割线 |
| `image` | - | - | 内联图片 |
| `text` | - | - | 文本节点 |

### 8.2 Schema Marks

| Mark | 触发快捷键 | DOM |
|------|-----------|-----|
| `bold` | Ctrl+B | `<strong>` |
| `italic` | Ctrl+I | `<em>` |
| `underline` | Ctrl+U | `<u>` |
| `strikethrough` | - | `<s>` |
| `code` | Ctrl+` | `<code>` |
| `link` | Ctrl+K | `<a>` |
| `highlight` | - | `<mark>` |
| `ai_generated` | 自动 | `<span class="ai">` |

### 8.3 InputRules（Markdown 快捷输入）

```
# 空格       → heading level 1
## 空格      → heading level 2
### 空格     → heading level 3
- 空格       → bullet list
1. 空格      → ordered list
> 空格       → blockquote
``` 回车     → code block
--- 回车     → horizontal rule
**文本**     → bold mark
*文本*       → italic mark
`文本`       → code mark
```

### 8.4 插件列表

```
plugins: [
  history(),                    // 撤销/重做
  keymap(baseKeymap),           // 基础快捷键
  keymap(customKeymap),         // 格式化快捷键
  inputRules({ rules }),        // Markdown 快捷输入
  aiSuggestionPlugin(),         // AI 幽灵文本
  collabCursorPlugin(),         // 协同光标渲染
  placeholderPlugin(),          // 空文档占位提示
]
```

---

## 9. 测试策略（TDD）

### 9.1 测试分层

| 层 | 框架 | 覆盖目标 |
|----|------|----------|
| 单元测试 | Vitest | DocumentModel / OTEngine / AIEngine / VersionStore / DiffEngine / ExportEngine |
| 集成测试 | Vitest + @testing-library/react | EditorCore + Plugin 联动 |
| 收敛性测试 | Vitest | OT 收敛定理（属性测试，随机生成操作对） |
| 性能测试 | Vitest benchmark | OT transform < 1ms，DocumentModel 操作 < 5ms |

### 9.2 关键测试用例

```
OTEngine.test.ts:
  ✓ 同位置并发插入（Alice/Bob 都在位置3插入）→ 确定性合并
  ✓ 插入 vs 删除：insert(3,"x") + delete(5,2) → 收敛
  ✓ 收敛定理属性测试：50次随机操作对，100%收敛
  ✓ 空操作幂等性
  ✓ compose 结合律

DocumentModel.test.ts:
  ✓ insertBlock / deleteBlock / moveBlock 后 children 一致性
  ✓ 深层嵌套序列化/反序列化无损
  ✓ search() 多关键词匹配
  ✓ stats() 空文档边界

AIEngine.test.ts:
  ✓ stream() 生成 token 序列不为空
  ✓ abort() 立即中断迭代器
  ✓ buildContext() 不超过 maxTokens 限制
  ✓ detectLanguage() 中/英/混合识别

VersionStore.test.ts:
  ✓ snapshot() 内容寻址（相同内容相同 id）
  ✓ LRU 淘汰：第51个快照淘汰最旧非固定版本
  ✓ pinned 版本不被淘汰
  ✓ restore() 后 DocumentModel 状态与快照一致

ExportEngine.test.ts:
  ✓ heading → # Markdown 语法
  ✓ code_block 保留缩进
  ✓ nested list 正确缩进层级
  ✓ toHTML() 含有效 DOCTYPE
```

---

## 10. 文件结构

```
office-doc-engine/
├── spec.md                          # 本文件
└── demo/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── core/
        │   ├── types.ts             # 全局类型定义
        │   ├── DocumentModel.ts     # Block 模型
        │   └── EventBus.ts          # 类型安全事件总线
        ├── ot/
        │   └── OTEngine.ts          # OT 变换算法（纯函数，0依赖）
        ├── collaboration/
        │   └── CollabEngine.ts      # 协同引擎（含模拟用户）
        ├── ai/
        │   └── AIEngine.ts          # AI 流式引擎
        ├── history/
        │   ├── VersionStore.ts      # 版本快照管理
        │   └── DiffEngine.ts        # Myers diff
        ├── export/
        │   └── ExportEngine.ts      # 多格式导出
        ├── perf/
        │   ├── PerfCollector.ts     # 性能数据采集
        │   └── PerfPanel.tsx        # 性能面板 UI
        ├── editor/
        │   ├── schema.ts            # ProseMirror schema
        │   ├── EditorCore.ts        # 编辑器初始化
        │   ├── inputRules.ts        # Markdown 快捷输入
        │   └── plugins/
        │       ├── AISuggestionPlugin.ts   # 幽灵文本
        │       └── CollabCursorPlugin.ts   # 协同光标
        ├── components/
        │   ├── App.tsx
        │   ├── DocEditor.tsx
        │   ├── Toolbar.tsx
        │   ├── AICopilot.tsx
        │   ├── VersionHistory.tsx
        │   └── CollabAvatars.tsx
        ├── main.tsx
        └── __tests__/
            ├── DocumentModel.test.ts
            ├── OTEngine.test.ts
            ├── AIEngine.test.ts
            ├── VersionStore.test.ts
            ├── DiffEngine.test.ts
            └── ExportEngine.test.ts
```

---

## 11. 验收标准（Demo 通过条件）

| 场景 | 验收指标 |
|------|----------|
| 富文本编辑 | Markdown 快捷输入 / 格式工具栏 / Ctrl+Z 撤销全部正常 |
| AI 幽灵文本 | 停止输入 800ms 后出现灰色续写，Tab 接受 / Esc 拒绝 |
| AI 浮动菜单 | 选中文本 → 出现菜单 → 点击"翻译" → 流式替换原文 |
| 协同模拟 | Bob 光标以彩色可见，Bob 输入文字实时出现在编辑器中 |
| 版本历史 | 打开历史面板，选择两个版本，看到字符级 diff 对比 |
| 性能面板 | FPS ≥ 58，OT transform < 1ms，Render < 16ms |
| 测试全绿 | vitest run 所有测试通过，覆盖率核心模块 ≥ 90% |
| 导出 | 点击"导出 MD"下载文件，内容与编辑器一致 |

---

## 12. Demo 演示脚本（10 分钟）

```
0:00 - 1:30  架构图讲解（3层：UI → Engine → Core），打开 PerfPanel
1:30 - 3:00  富文本编辑：# 快捷输入标题，- 列表，Ctrl+B 加粗，Ctrl+Z 撤销
3:00 - 5:00  AI Copilot：停止输入→幽灵文本→Tab接受（展示 ai_generated 标记）
5:00 - 6:30  AI 浮动菜单：选中段落→翻译为中文→流式替换动画
6:30 - 7:30  协同模拟：Bob 光标出现，Bob 开始打字，观察 OT 实时合并
7:30 - 9:00  版本历史：切换版本→字符级 diff 红绿对比
9:00 -10:00  Q&A：讲 OT 收敛定理 / AI 幽灵文本 ghost text 实现细节
```
