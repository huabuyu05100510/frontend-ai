# Design Overhaul — 三大支柱改造总览

**模型：claude-sonnet-4-6**
**日期：2026-07-01**
**分支：feature/pdfium-unified-renderer** (P0/P1/P2 多阶段)
**整体规 (3 Pillars)**：**Tokens / Motion / IA**

---

## 1. Vision

> 打造 10 年内最值得关注的中文办公预览前端作品。
> 设计层面建立单一 source of truth，让任何视觉调整（暗色、品牌色、动效密度）
> 都能在 ≤ 2 个文件内完成；动效永远尊重 OS-level `prefers-reduced-motion`；
> 跨页面导航、⌘K 命令面板、深链任务移交在所有路由上一致可用。

**为什么这很重要？**

- **Tokens (Phase 1.A)**：项目里有 3 套历史 `:root` 块 (slate / v5 Ant / iFlytek) 共存。
  任何品牌色调整需要修改 N 个文件，且无 dark mode 支持。
- **Motion (Phase 0.B / 1.B)**：动效要么全开要么全关，没有 user-friendly 的 opt-in；
  framer-motion vs motion 包混乱；可访问性盲区。
- **IA (Phase 0.C / 1.C / 2.C)**：早期用 `useState<active>` 模拟菜单选中，浏览器后退/前进
  失效；任务无法从 OCR 流转到 Translation；⌘K 面板缺失。

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Primitive Layer (Phase 0.A)                                │
│  src/design/primitives.{ts,css}                             │
│  10 scales × 12 lightness steps (Radix-aligned)             │
│  Single brand: --blue-7 = #1677ff                            │
└──────────────────────────────────────────────────────────────┘
                              ↓ wraps
┌──────────────────────────────────────────────────────────────┐
│  Semantic Layer (Phase 1.A)                                 │
│  src/design/semantic.{ts,css} + dark.css                    │
│  36 role-based aliases: --color-{primary,bg,text,…}          │
│  Dark mode: [data-theme="dark"] overrides                    │
└──────────────────────────────────────────────────────────────┘
                              ↓ consumed by
┌──────────────────────────────────────────────────────────────┐
│  Component Layer (Phase 2.A)                                │
│  src/components/{Modal,TopBar,…}                            │
│  var(--color-*) only, 0 raw hex in owned files               │
│  <Hover>, <Press>, <PageTransition> primitives              │
└──────────────────────────────────────────────────────────────┘
                              ↓ composed in
┌──────────────────────────────────────────────────────────────┐
│  Page Layer (Phase 2.A-C)                                   │
│  src/pages/{FilesPage,TranslationPage,…} + 3 placeholders    │
│  All routes registered in src/routes.ts + AppRouter          │
└──────────────────────────────────────────────────────────────┘
```

Cross-cutting concerns:
- **Motion**: `src/motion/{index,loadMotion,MotionProvider}.tsx` + primitives
- **A11y**: `src/a11y/reducedMotion.css` + `src/hooks/usePrefersReducedMotion.ts`
- **Routing**: `src/routes.ts` + `src/router/AppRouter.tsx` (react-router-dom v7)
- **Palette**: `src/palette/{usePalette,registry,Palette}.tsx` + 5 sources
- **Hooks**: `src/hooks/{useTheme,useCrossPageHandoff,useWorkspaceTimeline,…}`

---

## 3. Phase 0 — Foundations (8 files, 31 tests)

| 阶段 | 文件 | 测试 |
|---|---|---|
| **0.A Primitives** | `src/design/primitives.{ts,css,loader.ts}` | `test/design/{primitives,noDeadTokens}.test.ts` (7 tests) |
| **0.B Motion** | `src/motion/{index,loadMotion,MotionProvider}.{ts,tsx}` | `test/motion/{loadMotion,MotionProvider,bundleSize}.test.{ts,tsx}` (8 tests) |
| **0.C Router** | `src/routes.ts` + `src/router/AppRouter.tsx` | `test/router/{routeContract,browserBack,redirectRoot}.test.{ts,tsx}` (9 tests) |
| **0.D A11y** | `src/hooks/usePrefersReducedMotion.ts` + `src/a11y/reducedMotion.css` | `test/a11y/reducedMotion.visual.test.tsx` + `test/hooks/usePrefersReducedMotion.test.tsx` (7 tests) |

**关键决策**：
- 0.A 单 brand `#1677ff` (= `--blue-7`, Ant Blue 中段第 7 阶)；保留现有 3 个老 `:root`
  块避免 ~25 TSX 文件一夜崩
- 0.B 用 `motion@12.42.2` 而非 `framer-motion` (motion 是 framer-motion v11+ 重命名)
- 0.C `useState` → `useLocation`，浏览器后退/前进来回正确
- 0.D 全局 CSS 护栏 + JS bridge 写到 `<html data-motion>`

详见：`changes/primitives-foundation/README.md`、`changes/motion-foundation/README.md`、
`changes/router-foundation/README.md`、`changes/a11y-reduced-motion/README.md`

---

## 4. Phase 1 — Pillars (3 大支柱)

### 4.A Semantic Tokens (semantic-tokens)
- **36 个 role-based 别名**：`--color-primary`、`--color-bg-canvas`、
  `--color-text-tertiary`、`--color-ai`、`--color-danger`、`--color-success`…
- **Dark mode** 通过 `[data-theme="dark"]` 选择器覆盖；brand 自动切到 `--blue-5`
  (light blue) 提升对比度
- **System preference** 优先 localStorage，fallback `prefers-color-scheme: dark`
- 未删除老的 3 个 `:root` 块，留待 Phase 2.A 迁移时统一清理
- 详见：`changes/semantic-tokens/README.md`

### 4.B Motion Primitives (motion-primitives)
- `<Hover>` (scale 1.02, 200ms)、`<Press>` (scale 0.97, 80ms)、
  `<PageTransition>` (fade+slide, 200ms)
- 每个 primitive 都读 `<html data-motion="off">`：如果关闭则动画跳过
- `<MotionConfig reducedMotion="user">` 包整棵树
- easing `[0.4, 0, 0.2, 1]` (Material standard)
- 详见：`changes/motion-primitives/README.md`

### 4.C ⌘K Command Palette (cmd-palette-skeleton)
- 全局快捷键：⌘K / Ctrl+K；Esc 关闭；上下/Enter 键盘导航
- Phase 1.C 仅 7 个导航项；后续追加 4 类内容源 (Phase 2.B)
- observability：`[palette ISO] opened|closed` log
- 详见：`changes/cmd-palette-skeleton/README.md`

---

## 5. Phase 2 — Surface (用户可见的迁移)

### 5.A Inline Hex Sweep + Modal Primitive (inline-hex-and-modal)
- **Modal primitive** `<Modal open onClose title>` 统一 Esc / mask / focus trap
- 2 个 modal 迁移：`PreviewModal`、`InspectCompareModal` (bare mode)
- **352 个 hex literal** 在 19 个 TSX 文件里被替换为 `var(--color-*)`
- SideMenu.tsx + RightPanel.tsx 有意保留到 Phase 2.B/C
- 详见：`changes/inline-hex-and-modal/README.md`

### 5.B Workspace Timeline + Palette Content (workspace-timeline-and-palette-content)
- **后端**：JSONL 持久化 `/api/workspace/timeline` (POST/GET/DELETE/clear)
  14 个 TDD 测试
- **客户端 hook** `useWorkspaceTimeline` (load/append/remove/clear)
- **Palette 4 类 source** (files/templates/voices/actions) — 升至"命令面板"
- App.tsx 由 P3 切换为 v2 PaletteHost (AllSourcesRegister)
- 详见：`changes/workspace-timeline-and-palette-content/README.md`

### 5.C SideMenu Placeholders + Handoff (sidemenu-placeholders-and-handoff)
- 3 个新页面：`BookmarksPage`、`SamplesPage`、`GalleryPage`
- `useCrossPageHandoff(taskId, target)` 构建深链 + navigate
- store 加 `bookmarks: Set<string>` (localStorage 持久化)
- 路由从 7 → 10 (加 3 个 placeholders)
- 详见：`changes/sidemenu-placeholders-and-handoff/README.md`

---

## 6. Phase 3 — Polish (a11y + 视觉回归)

### 6.A Visual Regression (P3.A owns)
- **未在本 umbrella 范围**。Phase 3.A 计划新增：
  - visual-regression baselines for 7 main pages (light + dark)
  - prefers-reduced-motion 二次 baseline
  - axe-core 全局 scan

### 6.B Reduced-Motion Compliance Audit (P3.B — 本次)
- **静态扫描测试** (`test/a11y/reducedMotionAudit.test.tsx`, 18 tests)
- **e2e 浏览器验证** (`e2e/reduced-motion-audit.spec.ts`, 4 tests, dev-server 依赖)
- 结论：WCAG 2.3.3 PASS (静态扫描 + 真实 emulated context 都通过)
- 详见：`changes/reduced-motion-audit/README.md` + `changes/reduced-motion-audit/FINDINGS.md`

---

## 7. API Surface

### 7.1 Design Tokens
- **10 primitive scales**：slate / blue / purple / indigo / red / green / amber / cyan / magenta / orange
- **12 lightness steps** 每个 scale (Radix-aligned)
- **36 semantic aliases** (light) + **36 dark overrides**
- 公开 API：`src/design/tokens.ts` (`COLORS`、`STATUS_COLORS`、re-export primitives)、`src/design/semantic.ts` (`SEMANTIC_ALIASES`、`DARK_OVERRIDES`)

### 7.2 Motion Primitives
```ts
import { Hover, Press, PageTransition } from '@/motion'
<Hover data-testid="card">
  <button>Click me</button>
</Hover>
```
- 全部尊重 `<html data-motion="off">`
- 全部透传 `data-*` / `aria-*` 属性
- 默认 mode 静默不副作用；Phase 4+ 提供 opt-in `onHover` callback 桥接

### 7.3 Routes
```ts
// src/routes.ts
const ROUTES = {
  files:      '/files',
  translate:  '/translate',
  qc:         '/qc',
  ocr:        '/ocr',
  convert:    '/convert',
  upload:     '/upload',
  voice:      '/voice',
  bookmarks:  '/bookmarks',
  samples:    '/samples',
  gallery:    '/gallery',
} as const
```

### 7.4 Palette 5 Sources
| Source | 项目数 | 触发动作 |
|---|---|---|
| `navigation.ts` | 7 (+ 3 占位) | navigate 路由 |
| `files.ts` | top-20 tasks | navigate `?task=<id>` |
| `templates.ts` | 7 | 工作流入口 |
| `voices.ts` | 4 | TTS / 音频 |
| `actions.ts` | 2 | 主题 + 动效 toggle |

### 7.5 Modals
- **1 primitive**: `<Modal open onClose title? footer? width?>` + `useModal()` hook
- **2 migrated**: `PreviewModal`、`InspectCompareModal` (bare mode 保留 legacy CSS)
- 协奏：Modal 监听 Esc、`palette/Palette.tsx` 监听 ⌘K，两者不冲突

---

## 8. Bundle Analysis

测量来源：`web/dist/assets/` (生产构建)

| 资产 | 原始 | gzip (估) | 来源 |
|---|---|---|---|
| `index-*.js` | **470 KB** | ~140 KB | Vite 入口，包含 primitives + semantic + 路由 + palette + 5 page entry |
| `index-*.css` | 82 KB | ~15 KB | primitives + semantic + dark + reducedMotion + page-level |
| `motion-*.js` (lazy chunk) | **135 KB** | ~45 KB | opt-in via `?motion=on` 或 `localStorage.motion`；生产默认不进入初始 bundle |
| `pdfium-*.wasm` | 333 KB | ~98 KB | PDFium C++ 渲染，统一文本层 + 渲染管线 |
| `pdfium.wasm.base64-*.js` | 5.3 MB | — | base64 内嵌 wasm fallback；PDFium WASM 模块的 imperative 加载 |

**预算**：初始 JS 实际 ~470 KB；预算 ≤ 600 KB；CSS ≤ 120 KB；都没爆。
motion chunk 实际 ~45 KB gz；预算 ≤ 60 KB (Phase 0.B budget)。

**`vite.config.ts` manualChunks**：
- `@hyzyla/pdfium` → `pdfium-wasm` (独立 chunk，不进 main)
- `motion` / `framer-motion` → `motion` (opt-in)

---

## 9. Test Coverage

| 套件 | 数量 | 文件数 |
|---|---|---|
| **Server** | **419 passed** (34 files) | `server/test/*.test.mjs` |
| **Frontend** | **394 passed + 1 skipped** (66 files) | `web/test/**/*.{test,spec}.{ts,tsx}` |
| **Delta** (Phase 0 start → Phase 3.B) | Server +14, Frontend +132 | +9 server files, +18 frontend files |

文件级细分：
- `test/a11y/`: reducedMotion (4) + reducedMotionAudit (18) = 22
- `test/design/`: primitives (5) + noDeadTokens (2) + semantic (6) + darkMode (3) = 16
- `test/motion/`: loadMotion (5) + MotionProvider (2) + bundleSize (1) + Hover (4) + Press (4) + PageTransition (3) = 19
- `test/router/`: routeContract (6) + browserBack (2) + redirectRoot (1) + AppRouter smoke = 9+
- `test/palette/`: 4 files × 18 = 18
- `test/hooks/`: useTheme (6) + usePrefersReducedMotion (3) + useCrossPageHandoff (3) + useWorkspaceTimeline (6) = 18
- `test/components/`: Modal (13) + noInlineHex (2) + ThemeToggle (3) + RightPanel.routing (2) = 20
- `test/store/`: bookmarks (3) = 3
- 其他合并到 `test/components` 和 `test/pages` 中 = ~269

---

## 10. Migration Guide (升级路径)

如果从老版本 (前 Phase 0) 升级：

1. **依赖**
   ```bash
   cd office-preview-app/web
   npm i motion@^12 react-router-dom@^7
   ```

2. **main.tsx 改 Bootstrap wrapper**
   ```tsx
   import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
   import { useTheme } from '@/hooks/useTheme'
   import '@/a11y/reducedMotion.css'
   import '@/design/semantic.css'   // light
   import '@/design/dark.css'        // dark overrides
   ```

3. **App.tsx 用 router**
   ```tsx
   import { AppRouter } from '@/router/AppRouter'
   import { PaletteHost } from '@/palette/PaletteHost'  // v2
   <AppShell>
     <AppRouter />
     <PaletteHost />
   </AppShell>
   ```

4. **新增 token 替换**
   - `#1677ff` → `var(--color-primary)`
   - `#ff4d4f` → `var(--color-danger)`
   - `#fff` → `var(--color-bg)` 或 `var(--color-text-inverse)` (按语义)
   - 静态扫描：`test/components/noInlineHex.test.tsx` 自动 fail

5. **暗色支持**：`<ThemeToggle>` 已在 TopBar 内；localStorage 持久化。

6. **动效 opt-in**：URL 加 `?motion=on` 或 devtools console `localStorage.motion='on'; location.reload()`。

7. **⌘K**：生产环境默认可用（导航 + 4 类内容）。

---

## 11. Future Work (deferred)

- **页面级 lazy load**：当前所有 page 都进入 initial bundle (470 KB gz 140)。
  改用 `React.lazy(() => import('@/pages/...'))` + `<Suspense>` 后初始可降至 ~280 KB。
- **⌘K 内容源丰富**：当前 palette 5 类 source 够用；可加 remote search 拉服务端索引。
- **Storybook**：目前 tokens + primitives 没有独立文档站点；integration visual 是开发时延展。
- **`axe-core` CI scan**：Phase 3.B 静态扫描通过，但还应在 Playwright 里跑 axe-core 自动化。
- **`tokens.ts` 退役**：老 `COLORS` / `STATUS_COLORS` 应在 Phase 4 统一替换为 `SEMANTIC_ALIASES`。
- **遗留 inline transitions**：31 个 inline `transition:` 都依赖全局护栏；改写为 `<Hover>`/`<Press>` 后语义更清晰。
- **i18n**：所有 hardcoded 中文 label 应在 Phase 5 抽离到 `i18n/zh.json` / `en.json`。
- **P3.A visual regression baselines**：与本 umbrella 同时启动，产出 14 张 baseline PNG。
- **`useWorkspaceTimeline` 离线优先**：当前每次 mount 重新拉；可改 SQLite/IndexedDB 镜像 + sync。

---

## 12. 验证清单 (全绿)

- [x] `npx tsc -b` 0 errors
- [x] `npx vite build` 0 errors, no bundle-size warnings
- [x] Frontend: 394 passed + 1 skipped (66 files)
- [x] Server: 419 passed (34 files)
- [x] File headers `// 模型：claude-sonnet-4-6` 在所有 NEW 文件
- [x] 所有 log 用 ISO 时间戳
- [x] 所有 motion primitives 读 `<html data-motion>`
- [x] WCAG 2.3.3 reduced-motion：PASS
- [x] Inline hex 扫描：owned files 100% swept
- [x] 10 路由全部可达 + 浏览器后退/前进工作
- [x] ⌘K 全局工作 + 7 来源注册成功

---

## 相关变更索引

- [Phase 0.A Primitives](../primitives-foundation/README.md)
- [Phase 0.B Motion Foundation](../motion-foundation/README.md)
- [Phase 0.C Router Foundation](../router-foundation/README.md)
- [Phase 0.D A11y Reduced Motion](../a11y-reduced-motion/README.md)
- [Phase 1.A Semantic Tokens](../semantic-tokens/README.md)
- [Phase 1.B Motion Primitives](../motion-primitives/README.md)
- [Phase 1.C Cmd Palette Skeleton](../cmd-palette-skeleton/README.md)
- [Phase 2.A Inline Hex + Modal](../inline-hex-and-modal/README.md)
- [Phase 2.B Workspace Timeline + Palette Content](../workspace-timeline-and-palette-content/README.md)
- [Phase 2.C SideMenu Placeholders + Handoff](../sidemenu-placeholders-and-handoff/README.md)
- [Phase 3.B Reduced Motion Audit](../reduced-motion-audit/README.md)
