# 双栏对比 · 智检功能

> **模型**：Claude MiniMax-M3（MiniMax-M3，Anthropic Claude 4.6 同级）
> **日期**：2026-06-22
> **目标**：对标讯飞智检（`讯飞设计稿/讯飞智检.png` + `讯飞设计稿/翻译对比.png`），在 `office-preview-app` 内落地**双栏对比 + 智检错误列表**功能

## 1. 背景与设计稿拆解

### 1.1 设计稿诉求

| 设计稿 | 关键 UI 元素 | 对应功能 |
|---|---|---|
| `翻译对比.png` | 左侧功能栏（文字校对/文档校对/文本合规/...）+ 中间原文带红色下划线错误 + 右侧编号错误列表（03/04/05 原→改）+ 底部富文本工具条 | **智检模式**：原文 + 错误列表 |
| `讯飞智检.png` | 左右两栏双语（中/英）并排显示 + 顶部工具条 + 各自独立滚动 | **双栏对比模式**：源/译 并排 |

### 1.2 与现有体系的关系

- **不动**：PDF 渲染管线（PDFium / pdf.js / 栅格化）+ 任务列表 + 上传链路
- **新增**：一套独立于 PreviewModal 的 **InspectCompareModal**（顶层弹层）
- **入口**：任务卡片新增 `🔍 智检` 按钮；PreviewModal 顶部新增 `双栏对比` 入口（接收第二个 task 作为对比对象）

## 2. 架构（对标 Office Online 校对侧栏 / Google Docs Suggested Edits）

```
┌─────────────────────────────────────────────────────────────────┐
│ InspectCompareModal (顶层弹层，独立于 PreviewModal)              │
│                                                                 │
│  ┌─ Toolbar ──────────────────────────────────────────────────┐ │
│  │ 模式: [智检] [双栏对比]   源: [任务A ▾]   目标: [任务B ▾]  │ │
│  │ 同步滚动: ☑   接受全部: ☐                                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌─ Sidebar ──┐ ┌─ Main (双栏) ──────────┐ ┌─ DiffSidebar ──┐  │
│  │ 文字校对    │ │ 源(原文)   目标(改正)  │ │ 01 错字 → 改字 │  │
│  │ 文档校对    │ │ ──────────  ────────── │ │ 02 标点 → 标点 │  │
│  │ 文本合规    │ │ ████████   ████████    │ │ 03 字 → 字     │  │
│  │ 文档合规    │ │   错误红   改正绿      │ │ ...            │  │
│  │ 图片合规    │ │ ████ ✗    ████ ✓       │ │ ✓ 已接受       │  │
│  │ 音频合规    │ │ ...                   │ │ + 添加 − 忽略  │  │
│  │ 视频合规    │ │                       │ │                │  │
│  └────────────┘ └─────────────────────────┘ └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 新增模块（4 个）+ 修改（6 个）

### 3.1 新增

| 路径 | 行数预估 | 职责 |
|---|---|---|
| `server/src/diff.mjs` | ~120 | 字符级 / 词级 diff 引擎（自研 Myers diff 算法 + 中文友好分词） |
| `server/test/diff.test.mjs` | ~150 | TDD 单元测试（10+ cases：相同/纯增/纯删/混合/中文/Emoji/长文本性能） |
| `web/src/inspect/InspectCompareModal.tsx` | ~280 | 双栏对比弹层（工具条 + 双栏渲染 + 错误侧栏 + 同步滚动 hook） |
| `web/src/inspect/diffSidebar.tsx` | ~150 | 错误列表侧栏（编号、原→改、✓/+/− 按钮、滚动联动） |
| `web/test/InspectCompareModal.test.tsx` | ~200 | RTL 组件测试（mode 切换 / 双栏渲染 / 错误点击联动 / 同步滚动 hook） |

### 3.2 修改

| 路径 | 改什么 |
|---|---|
| `server/src/router.mjs` | 新增 `POST /api/inspect/diff` 端点；`X-Diff-Engine: myers@1.0` 响应头；请求体 {left, right, granularity:'char'\|'word'} |
| `web/src/components/TaskCard.tsx` | 任务卡片增加 `🔍 智检` 按钮（仅对 text/docx/pdf 显示）→ `onInspect(task)` |
| `web/src/store.ts` | state 加 `inspectTarget: Task \| null` + `inspectCompare: Task \| null` + `openInspect(t, cmp?)` |
| `web/src/App.tsx` | 挂载 `InspectCompareModal`（与 `PreviewModal` 并列）；列表筛选 tab 增加 `inspect` |
| `web/src/styles.css` | `.inspect-compare-*` 样式（双栏 grid / 错误高亮 / 侧栏固定列） |
| `web/src/types.ts` | 新增 `DiffError { id, type, original, corrected, originalStart, originalEnd, correctedStart, correctedEnd }` |

## 4. 关键不变式（机器可验证）

```js
// 1. diff 算法正确性
expect(diff('abc', 'axc')).toEqual([{op:'equal',text:'a'},{op:'delete',text:'b'},{op:'insert',text:'x'},{op:'equal',text:'c'}])

// 2. 字符级 diff 还原输入（round-trip）
const parts = diff(left, right)
expect(parts.filter(p=>p.op!=='insert').map(p=>p.text).join('')).toBe(left)
expect(parts.filter(p=>p.op!=='delete').map(p=>p.text).join('')).toBe(right)

// 3. 中文友好：'张家界市' vs '张家界' 应识别为「纯删除」
expect(diff('湖北省张家界市', '湖南省张家界').filter(p=>p.op==='delete').map(p=>p.text)).toEqual(['湖北','市'])

// 4. 长文本性能：100KB 文本 < 200ms（O(ND) Myers diff）
```

## 5. 同步滚动策略（关键交互）

- **模式 A（默认）**：左侧滚动 → 右侧按比例同步（`scrollTop / scrollHeight`）
- **模式 B（独立）**：用户拖动右侧滚动条 → 解除同步（按钮显示「解除同步 ✓」）
- **激活错误项**：点击 DiffSidebar 第 N 项 → 两侧对应位置 `scrollIntoView({behavior:'smooth', block:'center'})`
- **双向高亮**：点击原文错误段 → DiffSidebar 对应项加 `.is-active` 边框；反之亦然

## 6. 可观测性

| 维度 | 接入点 |
|---|---|
| **服务端** | `/api/inspect/diff` 响应头 `X-Diff-Ms` / `X-Diff-Length-Left` / `X-Diff-Length-Right` / `X-Diff-Ops` |
| **前端 perf** | `usePerf` 新增 `inspectMs` / `inspectErrorCount` / `inspectMode` |
| **客户端日志** | `console.info('[inspect] mode=dual source=t_xxx target=t_yyy ops=42 ms=15')` |
| **错误捕获** | `try/catch` 包住 diff 调用 → 上报 `usePerf.inspectError = String(e)` |

## 7. TDD 验收门槛

| 测试套件 | 数量目标 | 关键 case |
|---|---|---|
| `server/test/diff.test.mjs` | ≥ 10 | round-trip / 中文 / Emoji / 性能 |
| `web/test/InspectCompareModal.test.tsx` | ≥ 8 | mode 切换 / 双栏渲染 / 错误点击联动 / 同步滚动 / 接受 / 忽略 |
| `web/e2e/inspect-compare.spec.ts` | ≥ 4 | 端到端：从任务卡 → 智检 → 错误列表 → 点击高亮 → 接受 |
| **回归**：现有 51 web + 63 server | 全绿 | `bash tdd-test.sh` 通过 |

## 8. 不做什么（避免 over-engineering）

- ❌ 不实现真正的「AI 校对」（设计稿的 `03 既往开来 → 继往开来` 需 NLU 模型，本期做**纯文本 diff**，模型侧由后端业务方注入 `target` 文本）
- ❌ 不实现富文本编辑器（底部 `B/H/T/F/...` 工具条本期为占位 UI）
- ❌ 不实现多语言对齐（中↔英段落映射本期不做，预留 `granularity` 字段）
- ❌ 不动 PDF 渲染管线（保留 PDFium 路径不变）

## 9. 文件清单

```
changes/dual-column-smart-inspect/
├── README.md              # 本文件
├── diff.patch             # 完整 unified diff
└── diffstat.txt           # 11 files, +约 1100 / -约 50
```