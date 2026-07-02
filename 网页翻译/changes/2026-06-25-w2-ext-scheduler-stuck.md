# 2026-06-25 W2 扩展 scheduler 卡死修复

> **模型**：Claude (Sonnet 4.5)

## 问题

用户反馈：扩展加载后「一直卡着」。

实测复现（playwright 加载扩展 → BBC → 点翻译）：
- 提取到 **151 段**
- 第一批 **8 段** 翻译完成
- 后续 143 段**永不调度**
- 页面只渲染 27 段就停

## 根因

`extension/src/content/scheduler.ts` `viewportGated` 双重 bug：

### Bug A：markDone 不触发下一批调度（视口门控模式）

旧代码：
```ts
// 非视口门控：批次消化完，立即排下一批（视口门控靠 IntersectionObserver 触发）
if (!this.viewportGated && this.pending.size > 0) this.scheduleFlush()
```

视口门控模式完全依赖 `IntersectionObserver` 触发新批次。但在 BBC 这类内容站：
- 首屏已加载的段一次性进入视口，observer 触发一次后 `isIntersecting` 不再变化
- 用户不滚动 = 翻译停止
- 即使滚动，IntersectionObserver 对动态加载/lazy-load 内容回调不稳

### Bug B：默认 viewportGated=true 与用户预期不符

bilingual 模式默认 `viewportGated=true`（content.ts L181: `mode !== 'sidebar'`），但用户期望对标百度翻译：**点击翻译 = 整页翻译**，不需要滚动触发。

## 修复

### 1. `scheduler.ts` markDone 总是调度下一批

```ts
// W2 修复：视口门控模式下，IntersectionObserver 在内容已加载/已滚动场景
// 可能不再回调（lazy-load、已 in-view 但 isIntersecting 未变化等），
// 导致首批完成后剩余 pending 永不调度。
// 解决：markDone 总是尝试 scheduleFlush；flush 内的 rect 检查保证视口语义。
if (this.pending.size > 0) this.scheduleFlush()
```

`flush()` 内部仍有 `rect.top < innerHeight + 300` 视口检查，视口语义不破坏。

### 2. `content.ts` 全模式禁用 viewportGated

```ts
scheduler = new TranslationScheduler(
  onBatch, 8, 2000,
  30_000,
  false,  // viewportGated: W2 全模式禁用，对齐百度翻译体验
)
```

sidebar 模式本来就是 false，bilingual 现在也 false。

### 3. UI 文案对齐

把 "等待视口触发" 改成 "后台批量翻译"，避免用户以为要主动滚动。

## TDD

### 失败测试先行（`extension/test/unit/scheduler.test.ts`）

```ts
it('viewportGated 模式：第一批 markDone 后，剩余在视口内的 pending 应自动调度下一批', async () => {
  // 复现 W2 真实 bug：BBC 151 段，第一批 8 段翻译完后，
  // IntersectionObserver 不再触发新批次 → 后续 143 段永远卡住
  const scheduler = new TranslationScheduler(onBatch, 8, 10000, 30_000, true)  // viewportGated=true
  // ... register 20 段全部在视口内
  // ... 触发首批 8 段 → 全部 markDone
  // 期望：onBatch 被调用 2 次（无需新视口触发）
  expect(onBatch).toHaveBeenCalledTimes(2)
})
```

测试在修复前失败（`onBatch called 1 time, expected 2`），修复后通过。

### vitest 结果

| 阶段 | 通过/总数 |
|------|-----------|
| 修复前 | 119/120（仅已知 timeout flake） |
| 加测试 | 119/121（新测试失败 + 老 flake） |
| 修复后 | 120/122（新测试过 + 老 flake 仍 flake） |

## 端到端验证

`test/ext-translate-probe.mjs` playwright + chromium 加载 dist/ → BBC → 点翻译：

| 阶段 | BBC 151 段翻译进度 |
|------|---------------------|
| 修复前 | 30s 仅 27 段注入，后续停顿 |
| 修复后 | **22s 完成 141/151 段注入**（接近全部），完整跑完 |

timeline：
```
[0s]  injected=0  pending=151
[16s] injected=8  pending=151   (DeepL 首批响应)
[17s] injected=16 pending=141
[18s] injected=30 pending=141
[19s] injected=46 pending=141
[20s] injected=59 pending=141
[21s] injected=86 pending=141
[22s] injected=141 pending=141  ✅
```

## 已知遗留

- `data-xt-pending` attr 在 markDone 后未清，导致 DOM 上 `pending` 计数不准确（不影响功能）
- MV3 SW 长时空闲被 chrome 杀仍是潜在风险（30s+），但实际 DeepL 单批 ~1s，不会触发
- 老 translator.test.ts 的 timeout flake 仍未修（W1 已知，与本次无关）
