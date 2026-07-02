# Workspace Timeline + Palette Content Sources (P2.B)

## 模型：claude-sonnet-4-6

## 概述
Phase 2.B 双交付：
1. **Workspace Timeline 后端 + 持久化 + 客户端 hook**：跨会话记录用户在 5 类工作流（upload / translate / qc / ocr / voice）上的关键活动，供 ⌘K Palette 的"最近活动"面板消费，同时提供可观测的活动日志。
2. **Palette Content Sources 4 个**：在已有 `navigation.ts` 基础上，新增 4 类 palette items（文件 / 模板 / 语音 / 操作），把 Palette 从纯导航器升级为"命令面板"。

## 1. Workspace Timeline API

### 持久化
- 路径：`server/.data/derived/workspace-timeline/<userId|anonymous>.jsonl`
- 每用户一个 JSONL 文件
- 单文件超过 **10_000 行**自动归档为 `<userId>.<ts>.jsonl`，新文件继续 append
- 每用户上限 **200 条**：超出时丢弃最早的 1 条再 append
- malformed line 跳过 + warn（不抛错，保证脏数据不影响可用性）

### 端点（均带 ISO 时间戳日志 + X-Timeline-* 响应头）

| 方法 | 路径 | 入参 | 出参 | 响应头 |
|------|------|------|------|--------|
| POST | `/api/workspace/timeline` | `{kind, taskId?, summary, meta?}` | `{ok, entry}` | `X-Timeline-Id`, `X-Timeline-Kind` |
| GET | `/api/workspace/timeline?limit=50&kind=` | — | `{entries[]}` | `X-Timeline-Count`, `X-Timeline-Kind` |
| DELETE | `/api/workspace/timeline/:id` | — | `{ok, id}` | `X-Timeline-Removed-Id` |
| POST | `/api/workspace/timeline/clear` | — | `{ok, cleared}` | `X-Timeline-Cleared` |

### 数据形状
```ts
interface TimelineEntry {
  id: string       // 'tl_' + base36 + 6-hex
  kind: 'upload'|'translate'|'qc'|'ocr'|'voice'
  taskId: string | null
  summary: string  // ≤500 chars
  ts: number       // epoch ms（排序用）
  tsIso: string    // ISO 8601（前端展示用）
  meta: object | null
}
```

### 用户标识
- 通过 `X-User-Id` header 透传，缺省 `'anonymous'`
- 服务端做 `[^\w.-]` 清洗 + 64 字符截断防路径穿越

## 2. 客户端 Hook `useWorkspaceTimeline`

文件：`web/src/hooks/useWorkspaceTimeline.ts`

```ts
const {
  entries,    // TimelineEntry[]（倒序最新优先）
  loading,    // boolean
  error,      // string | null
  load,       // (opts?: {kind?, limit?}) => Promise<void>
  append,     // (input: AppendInput) => Promise<TimelineEntry | null>
  remove,     // (id: string) => Promise<boolean>
  clear,      // () => Promise<void>
} = useWorkspaceTimeline({ userId?: string, autoLoad?: boolean, limit?: number, kind?: TimelineKind })
```

要点：
- `load()` 内部 in-flight 互斥（防止组件重渲触发重复请求）
- `append()` 成功后本地 prepend；服务端排序兜底（不与服务端漂移）
- `remove()` 成功后本地 filter；删除失败返回 `false`
- `clear()` 清空本地 state
- `autoLoad=true` 时 mount 后 micro-delay 自动 load（不与其他 hook 抢首次渲染）

## 3. Palette 4 个内容源

| 文件 | 分组 | 注册 items | 行为 |
|------|------|-----------|------|
| `palette/sources/files.ts` | 文件 | 当前 tasks 前 20 个 | 点击 → `navigate('/files?task=<id>')` |
| `palette/sources/templates.ts` | 模板 | 7 个工作流入口（新建翻译/智检/OCR/格式转换/上传/语音/查文件） | 点击 → navigate 到对应路由 |
| `palette/sources/voices.ts` | 语音 | 4 项（打开语音中心/朗读选中文本/上传音频/音频翻译） | 朗读选中文本时 dispatch `palette:tts-request` 事件，让 VoicePage 监听消费 |
| `palette/sources/actions.ts` | 操作 | 2 项（切换主题/切换动效） | toggleTheme + 翻转 `localStorage.motion` 后 dispatch `palette:motion-toggled` |

每个 source 严格镜像 `navigation.ts` 的双 API：
- `useRegisterXxxItems()` — Hook（在 React 组件中调用）
- `registerXxxItems(...)` — Imperative（测试 / 非 React 上下文）

### PaletteHost 切换（P3 待办）
当前 App.tsx 中的 `PaletteHost` 仅注册 navigation。新增 `palette/PaletteHost.tsx` 提供 v2 版本（注册全部 5 类 sources），由 P3 阶段替换。**Phase 2.B 不修改 App.tsx**（CLAUDE.md 边界规则）。

新增 `palette/AllSourcesRegister.tsx` 暴露 `RegisterAllSources` 组件供未来 PaletteHost 调用，文件顶部留 TODO 注释。

## 4. 设计决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 存储后端 | SQLite vs JSONL vs IndexedDB | **JSONL** | 现有 annotation / translate-annotation 已用 JSONL，零迁移成本；append-only 友好 |
| 排序键 | `ts` 数字 vs `tsIso` 字符串 | **ts（数字）** | 数字比较 O(1)，字符串比较需要先 Date.parse |
| 容量上限 | 50 / 200 / 1000 | **200** | 平衡：够用 1-2 天工作记忆 + 单文件不会过大 |
| Rotation 阈值 | 1k / 10k / 无 | **10k** | 同 annotation 实现；对齐；普通用户几月写不到 |
| 用户隔离 | 强制登录 vs header 透传 | **header 透传** | 与 translate-annotation 模式一致；零侵入 |
| 切换 motion | reload vs in-place toggle | **dispatch 事件 + 提示 reload** | Motion chunk 已切分，reload 是最简单可靠的初始化路径；非阻塞体验 |

## 5. 改动文件清单

### 新增
| 文件 | 说明 |
|------|------|
| `server/src/workspace-timeline.mjs` | Timeline CRUD + 持久化 + rotation |
| `server/test/workspace-timeline.test.mjs` | 14 个 server 端 TDD 测试 |
| `web/src/hooks/useWorkspaceTimeline.ts` | 客户端 hook |
| `web/src/palette/sources/files.ts` | 文件源（top 20 tasks） |
| `web/src/palette/sources/templates.ts` | 7 个工作流模板 |
| `web/src/palette/sources/voices.ts` | 4 个语音子动作 |
| `web/src/palette/sources/actions.ts` | 主题 + 动效 toggle |
| `web/src/palette/AllSourcesRegister.tsx` | 5 类 source 聚合组件 |
| `web/src/palette/PaletteHost.tsx` | v2 PaletteHost（待 P3 切换） |
| `web/test/hooks/useWorkspaceTimeline.test.tsx` | 6 个 hook TDD 测试 |
| `web/test/palette/sources/files.test.tsx` | 4 个文件源测试 |
| `web/test/palette/sources/templates.test.tsx` | 3 个模板源测试 |
| `web/test/palette/sources/voices.test.tsx` | 4 个语音源测试 |
| `web/test/palette/sources/actions.test.tsx` | 5 个操作源测试 |

### 修改
| 文件 | 说明 |
|------|------|
| `server/src/router.mjs` | import + 5 处路由分发 + 4 个 handler（handleTimelineAppend/List/Remove/Clear） + `userIdFromReq()` helper |
| `web/src/palette/index.ts` | barrel 增加 4 个新 source + RegisterAllSources + PaletteHost 导出 |

## 6. 测试覆盖与质量门

| 指标 | 数值 |
|------|------|
| **Server tests** | 419 passed (34 files) — was 405, **+14 new** |
| **Frontend tests** | 392 passed + 1 skipped — was 340, **+52 new**（注：6 hook + 16 source + 30 来自既有测试连带恢复） |
| `tsc -b` | clean |
| `vite build` | 2.42s, no errors |
| File headers | 全部含 `// 模型：claude-sonnet-4-6` |
| ISO timestamp | 所有 server log 均带 ISO 时间戳 |
| Observability headers | `X-Timeline-Count` / `X-Timeline-Kind` / `X-Timeline-Id` / `X-Timeline-Removed-Id` / `X-Timeline-Cleared` 全部设置 |

## 7. 验证清单

- [x] POST 写入 JSONL，文件存在 + 行数对
- [x] GET 按 ts desc 排序
- [x] `?kind=` 过滤生效
- [x] `?limit=` 截断生效
- [x] DELETE 按 id 命中并删除
- [x] DELETE 不存在的 id → 404
- [x] POST /clear 清空文件
- [x] 空文件 → GET 返回 `[]`
- [x] malformed line 不抛错，跳过 warn
- [x] 10000 行后自动 rotation，新文件从 1 行开始
- [x] 200 条上限：超过时丢最早的 1 条
- [x] Hook: load/append/remove/clear 全部端到端走通
- [x] Hook: in-flight 防抖
- [x] Hook: error 捕获
- [x] Sources: imperative + hook 双 API 一致
- [x] Sources: 卸载清理 registry
- [x] App.tsx 未改（CLAUDE.md 边界遵守）
- [x] build clean (tsc + vite)