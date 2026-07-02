# 翻译：mount 自动触发 + 格式选择器（PDF / 图片+文字 / WASM）

> 模型: claude-sonnet-4-6（由 glm-5.2 调用）
> 日期: 2026-06-23
> 关联分支: `feature/pdfium-unified-renderer`

## 背景

原翻译流程存在两个体验断点（用户反馈 + 设计稿 `讯飞设计稿/翻译对照.png`）：

1. **多点一次**：点 TaskCard 的 🌐 翻译 → 弹层打开但显示「请点 AI 翻译」提示 → 用户必须再点右上角 `🌐 AI 翻译` 按钮 → 才进入双栏渲染。冗余的中间态，与设计稿不符。
2. **无格式选择**：翻译弹层工具栏只有缩放/复制/下载，缺少「PDF / 图片+文字 / WASM」三态切换。预览弹层（`PreviewModal`）已实现该切换（`PdfRenderMode` + `PreviewRouter`），但完全未接到翻译流程。

## 目标

- 点翻译 → `TranslationLayout` mount 时自动 `handleTranslate`，跳过「点 AI 翻译」中间态
- 顶部工具栏新增 `PDF / 图片+文字 / WASM` 三按钮，控制**左右两栏整体**的渲染方式
- PDF / WASM 模式复用源 PDF（identity-mock 现状：译文 = 原文）
- 严格遵守 CLAUDE.md：TDD red→green→refactor，所有路径加 console.log

## 用户确认的关键决策

| 问题 | 决策 |
|---|---|
| 格式选择器作用域 | **整页两栏都用**（左右两栏渲染方式同步切换） |
| 翻译触发时机 | **TranslationLayout mount 时自动触发**（保留按钮作为重译入口） |
| 译文 PDF 来源 | **复用源 PDF**（`source.previewUrl \|\| source.originalUrl`，DOCX 走转码后的 linear.pdf） |

## 实现

### 改动清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `web/src/types.ts` | 新增类型 | `TranslateRenderMode = 'pdf' \| 'images' \| 'wasm'` |
| `web/src/store.ts` | 新增字段 + action | `translateRenderMode`（默认 `'images'`）+ `setTranslateRenderMode`，`openTranslate` 重置默认值并从 localStorage 恢复偏好 |
| `web/src/inspect/TranslationLayout.tsx` | 核心改动 | mount 自动触发 + 工具栏格式选择器 + 左右 cell 按模式分发 |
| `web/src/App.tsx` | 修复 | 把 `inspectMode` 传给 `InspectCompareModal` 的 `defaultMode`（修复 pre-existing bug：弹层打开时模式被重置为 inspect） |
| `web/src/styles.css` | 新增样式 | `.ttl-mode-toggle`、`.ttl-cell-pdf`、`.ttl-cell-loading`、`.icm-fmt-btn` |
| `web/test/TranslationLayout.test.tsx` | 测试更新 + 新增 | 适配 mount 自动触发语义；新增 4 个格式选择器用例 |
| `web/test/InspectCompareModal.test.tsx` | 测试更新 | 改用 testid 而非按钮文案 |
| `web/e2e/translate-dual.spec.ts` | 完全重写 | 6 个端到端用例覆盖 tab 激活 / mount 自动触发 / 默认模式高亮 / PDF iframe / WASM / 关闭清理 |

### 核心机制

**1. mount 自动触发（带 ref 守卫）**
```tsx
const autoFiredRef = useRef<string | null>(null)
useEffect(() => {
  if (!source) return
  if (autoFiredRef.current === source.id) return  // 每个 source 只触发一次
  if (status !== 'idle') return
  autoFiredRef.current = source.id
  console.log('[translate] mount auto-trigger', source.id)
  handleTranslate()
}, [status, source?.id])
```
- 用 `useRef` 而非 state，避免 React 严格模式双调用导致 API 被调用两次
- 切换 source（同一个弹层打开不同任务）时仍会触发

**2. supportsPdf 计算（txt/md 不支持 PDF/WASM）**
```tsx
const supportsPdf = useMemo(() => {
  if (!source) return false
  if (source.previewUrl) return true
  const ext = (source.previewExt || source.ext || '').toLowerCase()
  return ext === 'pdf' || ext === 'docx' || ext === 'doc'
}, [source])
```
- 不支持时 PDF/WASM 按钮 `disabled` + `title="无源 PDF"`
- 切到 txt/md 任务时自动回退到 images 模式

**3. 三栏渲染分发**
| 模式 | 左 cell（原文） | 右 cell（译文） |
|---|---|---|
| `images`（默认） | `pages[i].url` 图片 + TextPage | `<TranslatedPage>` 按需渲染（IntersectionObserver + LRU 缓存） |
| `pdf` | `<iframe src={sourcePdfUrl}#page=N}>` | 同左（identity-mock 下译文=原文） |
| `wasm` | `<PdfPreviewWASM url={sourcePdfUrl}>` | 同左 |

**4. localStorage 持久化偏好**
- key: `translate-render-mode`
- `openTranslate` 时恢复；`setTranslateRenderMode` 时保存
- 跨会话保留用户上次选择

### App.tsx 模式重置 bug 修复（pre-existing）

修复前：点击 🌐 翻译 → `openInspect(t, null, { mode: 'translate' })` 把 store 的 `inspectMode` 设为 `'translate'`，但 `InspectCompareModal` 没接到 `defaultMode`，弹层 mount 时 useEffect 把内部 mode 重置为默认 `'inspect'`，导致翻译 tab 不激活。

修复后：
```tsx
<InspectCompareModal
  open={inspectOpen}
  source={inspectSource}
  compare={inspectCompare}
  onClose={closeInspect}
  defaultMode={inspectMode}  // NEW
/>
```

## 测试

### 单元测试（Vitest）
```bash
cd office-preview-app/web
npx vitest run test/TranslationLayout.test.tsx test/InspectCompareModal.test.tsx
# → Tests 65 passed (65)
```

新增/更新用例：
- ✅ `mount auto-triggers translate API`：mock fetch，assert mount 时 `POST /api/inspect/translate` 被调用一次
- ✅ `renders format selector with three buttons`：找 `translate-mode-pdf/-images/-wasm`
- ✅ `switching mode updates store`：点击 PDF 按钮 → store.translateRenderMode === 'pdf'
- ✅ `pdf/wasm disabled for txt files`：source.ext='txt' → PDF/WASM 按钮 disabled
- ✅ `click 重新翻译`：mount 已触发一次，手动点击 → 共 2 次 API 调用
- ✅ `切换语言后清空旧结果`：切换后 status='loading'（auto-refire）

### E2E 测试（Playwright）
```bash
cd office-preview-app/web
npx playwright test e2e/translate-dual.spec.ts
# → 6 passed (5.2s)
```

6 个用例：
1. 点翻译 → 弹层打开 + 翻译 tab 激活 + AI 按钮 + 三格式按钮可见
2. mount 自动触发：无需手点 AI 按钮，直接拉到 translate API + 渲染 `.ttl-page-row`
3. 默认 images 模式高亮
4. 切换 PDF 模式 → 出现 `iframe.ttl-cell-pdf`
5. 切换 WASM 模式 → WASM 按钮 `.on`
6. 关闭弹层 → 翻译状态被清理

## 验证

### 手动 UI 回归（headed Chrome）
```bash
# Server
cd office-preview-app/server && node src/index.mjs &
# Web
cd office-preview-app/web && npx vite --host 0.0.0.0 --port 5188
```

操作：上传/选择 docx 任务 → 点 🌐 翻译 → 应直接看到双栏渲染（无需手点 AI 按钮）→ 顶部三按钮切换：

| 模式 | 结果 |
|---|---|
| 图片+文字（默认） | ✅ 左右栏均渲染 PNG + 文字层，字符级 hover 联动正常 |
| PDF | ✅ 左右栏均嵌入 iframe，Chrome PDF Viewer 渲染源 PDF（identity-mock 下译文=原文） |
| WASM | ✅ 左右栏均挂载 PdfPreviewWASM，前端 pdfium 渲染 |

### 已知限制

- **headless Chrome PDF iframe 显示空白**：Chromium 的内置 PDF Viewer 插件在 headless 模式下不渲染像素。E2E 测试只断言 `iframe.ttl-cell-pdf` 的存在与可见性，不断言像素内容（与 Playwright headless PDF 测试惯例一致）。Headed 浏览器 / 真实用户使用时无此问题（已通过 headed Playwright 验证）。
- **iframe 大文件性能**：PDF 模式下两栏各一个 iframe 嵌整本 PDF，几百页大文件可能卡。回退方案（未启用）：后端加 `?page=N` 参数返回单页 PDF。本次未启用，留作 v4.3 优化。
- **PdfPreviewWASM initialPage**：当前 WASM 组件无 `initialPage` prop，渲染整本文档靠 IntersectionObserver 跟随当前页。简单可用，未来可加 prop 优化。

## 风险与回滚

- 改动完全限制在翻译弹层，不影响预览/智检/双栏对比等其它流程
- 所有改动有对应测试覆盖
- 回滚：revert 本次 commit + 删除新增的 changes 目录

## 复用资产

- `PdfRenderMode` 类型 + `PreviewRouter` 分发逻辑（`previewers/index.tsx:24-53`）— 思路直接复刻到翻译
- `PdfPreviewWASM` 组件 — 直接复用
- `pageRenderCache` LRU — 不改 key（不同格式走完全不同分支，不复用缓存条目）
- `IntersectionObserver` 页跟踪（`rootMargin: '0px 0px -80% 0px'`）— 三模式都复用同一套页码跟踪
