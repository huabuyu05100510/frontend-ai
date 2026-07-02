# Translation UX Overhaul — Phase A.1 (Agent 1)

> 模型：claude-sonnet-4-6
> 日期：2026-07-02
> 分支：`feature/design-overhaul`
> Agent 1 of multi-agent "translation UX overhaul" implementation

---

## 范围 (Phase A.1)

3 个新组件 + 1 个 hook，构成 Phase B/C 编排组件的 UI 原语底层：

| 文件 | 行数 | 用途 |
|------|------|------|
| `web/src/components/StageIndicator.tsx` | 158 | 4 阶段步骤指示器（横向 chip 链 + Material-style connector） |
| `web/src/components/Toast.tsx` | 142 | 通知堆叠容器（AnimatePresence + 4 种 kind + Esc 关闭） |
| `web/src/hooks/useToast.ts` | 85 | Toast zustand slice（push/dismiss/clear + 自动 dismiss 定时器） |

测试文件：
| 文件 | 测试数 | 通过 |
|------|--------|------|
| `test/components/StageIndicator.test.tsx` | 10 | 10 |
| `test/components/Toast.test.tsx` | 9 | 9 |
| `test/hooks/useToast.test.ts` | 6 | 6 |
| **小计** | **25** | **25** |

（计划要求 22，Agent 1 额外加了 3 个：Space 键盘激活、custom labels、Esc closes all）

---

## TDD 流程

1. **RED**: 写 3 个测试文件后 `vitest run` 确认 `Failed to resolve import` (3 failed)
2. **GREEN**: 实现 `useToast` → `StageIndicator` → `Toast`，全部 25 通过
3. **修复发现的问题**:
   - `usePrefersReducedMotion` 副作用把 `data-motion` 改回 "on"，影响测试。改为只读 `document.documentElement.getAttribute('data-motion')`
   - `Toast` 组件只渲染 queue，自动 dismiss 由 `useToast` 内部 setTimeout 处理。修正一个测试的语义：从 "Toast 自身计时" 改为 "useToastStore 集成计时"

---

## API 设计

### `StageIndicator`
```ts
<StageIndicator
  current="pick" | "translating" | "review" | "export"
  onChange={(s) => ...}
  labels={{ pick, translating, review, export }}
  stages={...}                  // 可选，重排或减少 stage
  ariaLabel="翻译流程步骤"
/>
```
- 颜色：`var(--color-translate-stage-{active,done,pending})`
- 键盘：Enter / Space 激活；当前 stage `tabIndex=0`，其他 `-1`（roving tabindex）
- 角色：`role="navigation"` + 内部 `role="tab"` / `aria-selected` / `aria-current="step"`
- 守卫：尊重 `<html data-motion="off">`（CSS transition 关闭）
- 日志：点击触发 `[translate-ui ISO] stage={key}`

### `Toast`
```ts
<Toast
  queue={ToastItem[]}
  onDismiss={(id) => ...}
  ariaLive="polite" | "assertive"
/>
```
- 容器：右下角，z-index 1100
- Esc 一次性 dismiss 全部
- hover 暂停：JSX 标记 `data-paused="true|false"`（实际计时由 `useToast` 内部驱动）
- 角色：`role="alert"` + `aria-live` (error 升级为 assertive)
- 4 种 kind 视觉：`oa-toast-{success|error|info|warning}` 修饰 class + 左边框色

### `useToastStore` (zustand)
```ts
const id = useToastStore.getState().push({ kind, message, durationMs? })
useToastStore.getState().dismiss(id)
useToastStore.getState().clear()
const queue = useToastStore(s => s.queue)
```
- 默认 `durationMs = 4000`
- 自动 dismiss：`setTimeout(() => dismiss(id), durationMs)`（durationMs > 0）
- 日志：`[translate-toast ISO] kind=... message="..." durationMs=...`

---

## 新增 Semantic Tokens (12)

添加到 `web/src/design/semantic.ts` + `semantic.css` + `dark.css` 的末尾 Agent 1 标记块：

```
--color-translate-stage-active  → --blue-7  (light) / --blue-5  (dark)
--color-translate-stage-done    → --green-5 (light + dark)
--color-translate-stage-pending → --slate-3 (light) / --slate-8 (dark)
--color-annotation-kind-align   → --blue-6  (light) / --blue-5  (dark)  [shared with Agent 3]
--color-annotation-kind-seg     → --green-6 (light) / --green-5 (dark)  [shared with Agent 3]
--color-annotation-kind-alt     → --purple-6 (light) / --purple-5 (dark) [shared with Agent 3]
--color-toast-success → --green-6 / --green-5
--color-toast-error   → --red-6   / --red-5
--color-toast-info    → --blue-6  / --blue-5
--color-toast-warning → --amber-6 / --amber-5
--color-toast-bg      → --color-bg
```

避让策略：所有 token 写在 `// ============ Translation UX Overhaul (Phase A.1 Agent 1) ============` 块内，方便 Agent 3 后续在自己段尾追加并最后合并。

注意 `--color-translate-stage-pending` 用 `var(--slate-3)`（slate scale 存在；项目里没有 `--gray-*` 原始色阶）。

---

## CSS 规则（添加到 `styles.css` 末尾 Agent 1 标记块）

- `.oa-stage-indicator` / `.oa-stage-list` / `.oa-stage-item` / `.oa-stage-chip` / `.oa-stage-connector`
- `.oa-stage-chip.is-active|done|pending` / `.oa-stage-connector.is-done|is-pending`
- `[data-motion="off"] .oa-stage-chip` → 关闭 transition
- `.oa-toast-container` (fixed bottom-right, z-index 1100)
- `.oa-toast` / `.oa-toast-icon` / `.oa-toast-message` / `.oa-toast-dismiss`
- `.oa-toast-{success|error|info|warning}` 修饰 class
- `[data-motion="off"] .oa-toast` → 关闭 transition

---

## 验证结果

```bash
cd office-preview-app/web
npx vitest run test/components/StageIndicator.test.tsx test/components/Toast.test.tsx test/hooks/useToast.test.ts
```
- **3 个 test file 全部通过，25 / 25 tests passed**
- 耗时 ~1.07s（远低于 5s 限制）

```bash
npx tsc -b --noEmit
```
- **我的 6 个文件 0 个 TS 错误**
- 项目中有 14 个错误来自其他 agent 的文件（Agent 2/3/4/5 并行中），不在我职责范围

```bash
npx vitest run test/components/noInlineHex.test.tsx
```
- 2/2 通过；我的 3 个新组件未引入任何 `#RRGGBB` 字面量（仅 `var(--color-*)`）

---

## 已知限制 / 待办

1. **hover 暂停未驱动实际计时器**：当前 Toast 在 hover 时只设 `data-paused="true"` 标记；`useToast` 内部的 `setTimeout` 不响应此信号。如要完整实现需：
   - 把 useToast 改成"mount 时启动、hover 时清 timer、unhover 时基于剩余时间重启"或
   - 改用 `requestAnimationFrame` 循环 + paused flag
   - 推迟到 Phase B 集成时再实现（依赖 DocTranslateStagePanel/ImageTranslateStagePanel 实际调用模式）

2. **StageIndicator 的 onChange 未与 URL search params 联动**——属于 Phase A.4 (`useTranslateStage` hook) 职责

3. **Toast 容器挂载点** — 我没把 `<Toast>` 注入到 `App.tsx`。应由 Phase B 集成时 `AppShell` 内挂载 `<ToastHost>` 订阅 `useToastStore.queue`

4. **Stage 状态机没有走 zustand store** — 当前 StageIndicator 是受控组件。Phase A.4 的 `useTranslateStage` 会接管 `current` + `onChange` 双向同步 URL。

5. **CSS 注入位置** — 我的 `.oa-stage-*` 和 `.oa-toast-*` 块写在 Agent 4 的 ImagePreviewPane CSS 之后。如果 Agent 3 / Agent 5 之后追加 CSS，应保证我的选择器具体性足以覆盖任何潜在冲突。

---

## 与其他 Agent 的边界

- **Agent 3 (AnnotationChip/List/Popup + useAnnotation)**：共享 `--color-annotation-kind-{align,seg,alt}` 3 个 token。我们都各自只追加，不删除对方的 token
- **Agent 4 (DocPreviewPane/ImagePreviewPane/useTranslateStage)**：在 styles.css 末尾相邻段落，互不干扰
- **Agent 5 (server annotation headers)**：不动前端，不冲突
- **Agent 6 (Phase B+C 集成)**：将消费我的 StageIndicator + Toast + useToastStore
- **Agent 2 (ResizableSplit)**：共享 styles.css 末尾，无 token 冲突

---

## Bundle 影响

- StageIndicator.tsx ≈ 5.0KB
- Toast.tsx ≈ 4.3KB
- useToast.ts ≈ 2.2KB
- 合计源码 ≈ 11.5KB（gzip 后 < 5KB）— 远低于 20KB 限制

CSS 增量（`.oa-stage-*` + `.oa-toast-*`）≈ 3.5KB

---

## 观测头与控制台日志

实际日志（来自测试输出）：
```
[translate-ui 2026-07-02T02:33:22.060Z] stage=review
[translate-toast 2026-07-02T02:33:22.031Z] kind=info message="hello" durationMs=4000
```

符合 plan A.6 规范：`[translate-{ui,toast,annotation,events} ISO] key=value ...`
