# router-foundation — Phase 0.C

模型: claude-sonnet-4-6

## 决策
- **路由库**: react-router-dom v7.18.1 (已装, 未用; Phase 0 启用)
- **路由策略**: 7 个 flat 路由 + MenuKey ↔ Route 双向映射
- **Active 推导**: App.tsx 用 `useLocation()` + `routeToMenuKey()` 替代 `useState<active>`
- **SideMenu**: 默认 `useNavigate`, 但保留 `onChange` prop 供测试 mock
- **Observability**: 路由切换 console.info `[router ${ts}] navigate: ${pathname} -> ${menuKey}`
- **Phase 0 范围**: URL 驱动 + 浏览器后退/前进工作; 不做 lazy loading (Phase 1)

## 路由表
| Menu Key | Route |
|---|---|
| files | /files |
| translate | /translate |
| qc | /qc |
| ocr | /ocr |
| convert | /convert |
| upload | /upload |
| voice | /voice |

## 文件变更
- NEW: web/src/routes.ts (route table + mapping functions)
- NEW: web/src/router/AppRouter.tsx (BrowserRouter + route logger)
- NEW: web/test/router/routeContract.test.ts (6 tests)
- NEW: web/test/router/browserBack.test.tsx (2 tests)
- NEW: web/test/router/redirectRoot.test.tsx (1 test)
- MOD: web/src/App.tsx (useState → useLocation/useNavigate)
- MOD: web/src/components/SideMenu.tsx (useNavigate fallback)

## 测试
- 9 new tests added; 293 frontend + 405 server tests still green
- TypeScript build: clean
- Vite production build: clean (555 modules)

## 后续阶段
- Phase 1.B: <PageTransition> 包裹 <Routes> 子树
- Phase 1.C: ⌘K palette 集成 navigate
- Phase 2.C: cross-page handoff (TranslationPage 读 ?task=)
- Phase 2.C: SideMenu bookmarks/samples/gallery 三个占位项接路由