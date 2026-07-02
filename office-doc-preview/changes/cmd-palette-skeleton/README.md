# cmd-palette-skeleton — Phase 1.C

模型: claude-sonnet-4-6

## 决策

- **触发**: ⌘K / Ctrl+K 全局快捷键; Esc 关闭; 搜索框 onFocus / onClick / Enter 打开
- **注册中心**: 单一 `paletteRegistry` (`Map<id, item>`); 注册/反注册幂等
- **Phase 1.C sources**: 仅 navigation (7 个路由跳转项)
- **Phase 2.B 会加**: files (⌘K 搜文件名)、templates (OCR 模板)、voices (TTS 声音)、actions (主题切换等)
- **UI**: modal 样式 + 分组渲染 + 键盘上下/Enter 操作; mask 点击关闭; Esc 关闭
- **Observability**: `[palette ${ISO-timestamp}] opened|closed` console.info
- **可观测性 header**: 无 (前端 UI 行为，不需要 HTTP 头)
- **架构**: `PaletteHost` 组件包装 `useRegisterNavigationItems` + `usePalette` + `<Palette>`，作为 `<AppShell>` 内 `<AppRouter>` 的兄弟节点，确保跨页面全局可达
- **设计 token**: 全部复用 `--color-*` / `--font-size-*` / `--radius-*` / `--shadow-lg` / `--z-modal` 等 Phase 1.A 语义层

## 文件变更

- NEW: `web/src/palette/usePalette.ts` (state + ⌘K/Ctrl+K/Esc listener + observability 日志)
- NEW: `web/src/palette/registry.ts` (`PaletteItem` type + register/list/search/clear)
- NEW: `web/src/palette/Palette.tsx` (modal UI + 键盘导航 + 分组渲染)
- NEW: `web/src/palette/sources/navigation.ts` (7 nav items: files/translate/qc/ocr/convert/upload/voice + ⌘1-⌘7 快捷键提示)
- NEW: `web/src/palette/index.ts` (barrel)
- MOD: `web/src/components/TopBar.tsx` (search 框 onFocus/onClick/onKeyDown → palette.open + ⌘K kbd badge)
- MOD: `web/src/App.tsx` (新增 `<PaletteHost />` 在 `<AppShell>` 内 `<AppRouter>` 兄弟节点)
- MOD: `web/src/styles.css` (追加 palette UI 样式 + .oa-kbd 通用键位样式)

## 测试 (18 new tests, all green)

| 文件 | tests | 内容 |
|------|-------|------|
| `test/palette/registry.test.ts` | 4 | starts empty / register / search by title / search by group |
| `test/palette/usePalette.test.tsx` | 7 | initial closed / open / close / toggle / Cmd+K / Ctrl+K / Esc |
| `test/palette/Palette.test.tsx` | 4 | closed → null / open → input / displays items / filters by query |
| `test/palette/sources/navigation.test.tsx` | 3 | registers 7 nav items / each action callable / unregisters on unmount |
| **合计** | **18** | |

## 测试结果

- Frontend (palette 子集): **18/18 green**
- Frontend (总计): **340/340 green, 1 skipped** (与基线一致, 无回归)
- Server: **405/405 green**
- TypeScript: `tsc -b` 无错误
- Build: `vite build` 成功, 0 警告

## 验证步骤

1. `cd office-preview-app/web && npx vitest run test/palette/` → 18 green
2. `cd office-preview-app/web && npx vitest run` → 340 green
3. `cd office-preview-app/server && npm test` → 405 green
4. `cd office-preview-app/web && npm run build` → 无错误
5. `cd office-preview-app/web && npm run dev` → 浏览器打开, 按 ⌘K 看到面板; 关闭后 Esc; 输入 "文件" → 高亮 "文档预览"; Enter → 跳到 /files

## 已知边界 / 后续阶段

- **未实现**: files/templates/voices/actions 来源 (Phase 2.B)
- **未实现**: SideMenu 收藏夹/示例库/图片画廊 pill 跳转 (Phase 2.C)
- **未实现**: 跨页 handoff / RightPanel palette 入口 (Phase 2.C)
- **快捷键**: ⌘K 全局监听 — 未来 Phase 2.A 可加自定义 shortcut 配置 (当前 ⌘1-⌘7 仅作为 palette 内的 hint 显示，不实际绑定)
- **焦点陷阱**: 当 palette 打开时焦点移到 input，但未实现"焦点陷阱 (focus trap)" (即 Tab 不会跑出 panel 之外) — Phase 2.D 增强 a11y 时补
- **滚动**: 当结果很多时，`oa-palette-list` 有 `overflow-y: auto`，但未实现"虚拟滚动" — 文件量 <100 时性能足够

## 改动原则遵循

- TDD: 4 个测试文件先写 (red) → 实现 (green)
- 文件头 `// 模型：claude-sonnet-4-6` 所有新文件已加
- Observability: console.info with `[palette ${ISO-ts}]` 前缀
- 多 agent: Phase 1.A (token) / Phase 1.B (其他) / Phase 1.C (本 phase) 独立
- Phase 1.C 不触碰: router/*, routes.ts, motion/*, design/*, hooks/usePrefersReducedMotion.ts, a11y/*, SideMenu.tsx, main.tsx, primitives/*