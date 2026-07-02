# Phase A.2 — ResizableSplit 原语

> 模型：claude-sonnet-4-6
> 日期：2026-07-02
> 分支：`feature/design-overhaul`
> 父计划：`/Users/didi/.claude/plans/smooth-weaving-wilkes.md`

---

## 范围

按 plan 中 Phase A.2 (line 62) 交付一个可拖拽分割面板原语，附 TDD 测试与 CSS。

## 交付物

| 文件 | 行数 | 说明 |
|------|------|------|
| `web/src/components/ResizableSplit.tsx` | 261 | 拖拽分割面板原语 |
| `web/test/components/ResizableSplit.test.tsx` | 264 | 10 个 TDD 用例（拖拽 / 键盘 / 持久化 / clamp） |
| `web/src/styles.css` (末尾区块) | +80 | `.oa-split` 系列类，含 dark mode |

## API

```ts
export type SplitDirection = 'horizontal' | 'vertical'

export interface ResizableSplitProps {
  storageKey: string                        // localStorage key — 调用方编码 taskId+role
  direction?: SplitDirection                // 默认 'horizontal'
  initialRatio?: number                     // 0..1，默认 0.5
  minRatio?: number                         // 默认 0.15
  maxRatio?: number                         // 默认 0.85
  step?: number                             // 键盘步长，默认 0.02
  children: ReactNode                       // 左/上面板
  second: ReactNode                         // 右/下面板
  className?: string
  onRatioChange?: (ratio: number) => void
}
```

## 行为

- **拖拽**：pointer + mouse 事件双绑定（兼容 jsdom 不支持 PointerEvent 的环境）
- **键盘**：聚焦 handle 后 ←/→ 或 ↑/↓ 调整 0.02，Home/End 跳到 min/max
- **持久化**：每次 ratio 变化后写入 `localStorage[storageKey]`，下次挂载时 hydrate
- **响应**：ResizeObserver 监听容器尺寸变化，比例随容器自适应
- **可观测**：`console.info('[translate-ui ISO] split drag|keyboard taskId=… ratio=…')`
- **降级**：container 尺寸测量为 0（jsdom / SSR）时回退到 `ratio * 100%` 百分比基础

## 已知设计决策

1. **jsdom 兼容**：jsdom 不提供 `PointerEvent` 构造器，`fireEvent.pointerDown` 不会携带 `clientX`/`button` 等字段。组件同时绑定 `onPointerDown` 与 `onMouseDown`，并监听 window 的 `pointermove` + `mousemove` + `pointerup` + `mouseup`，让 jsdom 测试（用 `fireEvent.mouseDown`）与真实浏览器（用 PointerEvent）都能工作。
2. **测量同步性**：useEffect 异步测量导致 jsdom 第一次 render 时 `flexBasis` 是百分比。测试在 stub 完 `getBoundingClientRect` 后通过 `window.__oaSplitResync?.()` 强制重测（也可在生产环境作为外部 hook 使用）。
3. **React 百分比归一化**：`'50.0000%'` 在 React 渲染到 `style.flexBasis` 时被去尾零为 `'50%'`。测试断言同时接受两种写法。
4. **不依赖 `usePrefersReducedMotion` hook**：组件用直接读 `document.documentElement.getAttribute('data-motion')` 走 `<html data-motion="off">` 守卫；CSS 过渡 `transition: background 0.15s` 在 motion=off 时被内联 style `transition: 'none'` 覆盖。这避免了引入 hook 在 component 顶部产生额外副作用。

## 测试

- **Vitest**：`673 passed + 1 skipped`（96 个测试文件）— ResizableSplit 贡献 10 个新用例
- **noInlineHex guard**：通过（无内联 hex 字面量）
- **tsc -b --noEmit**：本组件零错误（其他 agent 的 pre-existing 2 个错误与本组件无关）

## 后续

- 阶段 B 集成 `DocTranslateStagePanel` review 阶段使用 `<ResizableSplit storageKey="translate-doc-review-${taskId}">`
- 阶段 C 集成 `ImageTranslateStagePanel` review 阶段使用 `<ResizableSplit storageKey="translate-image-review-${taskId}" direction="vertical">`
- 阶段 D 加 1 个 e2e spec：`translate-resizable-split.spec.ts`（拖拽 + localStorage 跨页持久化）
- 阶段 D 加 1 套 visual 快照：`translate-resizable-split-visual.spec.ts-snapshots/`（30/70 + 50/50 两张）
