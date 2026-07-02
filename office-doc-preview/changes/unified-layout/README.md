# 统一布局系统重构 — 消除双系统竞争

## 问题

项目存在两套互不兼容的布局系统，导致样式混乱、逻辑复杂：

| 页面 | 布局 | 顶栏 | 侧菜单 | 主内容 |
|------|------|------|--------|--------|
| Files / Translate | `oa-*` (AppLayoutV2 Grid) | oa-topbar (Office AI 品牌) | oa-sidemenu (4 模块) | oa-main (max-width 1280px) |
| QC / OCR | `xf-*` (自建独立 mini-app) | xf-topbar (讯飞智检品牌) → TopNavSwitch hack | xf-submenu (140px) | xf-content (全宽) |

根因：QC/OCR 页面的 `QualityCheckPage.tsx` / `OCRPage.tsx` 各自渲染了完整的 `<div className="xf-app">` 外壳（包括自己的品牌顶栏），使得它们无法组合进共享的 `AppLayoutV2`。

`App.tsx` 通过 `isFullscreenPage` 的 if 分支完全绕过了 `AppLayoutV2`，注入了一个独立的 `TopNavSwitch` 顶栏作为菜单切换条。这导致：

1. **两份顶栏**：TopNavSwitch（菜单切换） + 页面内部的 xf-topbar（讯飞品牌），视觉顶栏区域有两行
2. **两份菜单**：SideMenu vs TopNavSwitch，功能重叠
3. **RightPanel 完全丢弃**：QC/OCR 页面无法看到任务列表和系统状态
4. **页面高度计算混乱**：xf-app 使用 `min-height: 100vh`，而 oa-shell 也用 `height: 100vh`

## 改进

### 1. App.tsx：移除双系统分支

- 删除 `isFullscreenPage` / `TopNavSwitch` / if-else 分支
- 所有 4 个页面统一走 `AppLayoutV2`
- QC/OCR 页面传入 `fullWidth={true}`（无边距，全宽编辑区）
- QC/OCR 页面传入 `showRightPanel={false}`（编辑页不需要右侧任务面板）

### 2. QualityCheckPage.tsx：移除独立外壳

- 删除 `.xf-app` 外层 div
- 删除 `.xf-topbar`（讯飞品牌顶栏 + MAIN_NAV + 用户芯片）
- 删除 `activeNav` 状态、`MAIN_NAV` 常量、`ChevronDownIcon` 导入
- `xf-workspace` 现在是页面根元素，直接嵌入 `oa-main`

### 3. OCRPage.tsx：移除独立外壳

- 删除 `.xf-app` 外层 div
- 保留 `TopBanner`（功能说明横幅），在 flex column 中自然排列
- `xf-content` 直接嵌入，不再独占全视口
- 删除 `ChevronDownIcon` 导入

### 4. AppLayoutV2.tsx：添加 `fullWidth` 模式

- 新增 `fullWidth?: boolean` prop
- fullWidth 时：`oa-main` 去掉 padding，`oa-main-inner` 不包裹
- 默认模式保持不变（max-width 居中包裹）

### 5. styles.css：清理布局相关 CSS

- 删除 `.xf-topnav-switch` / `.xf-topnav-btn`（不再需要 TopNavSwitch）
- `.xf-app` 改为 `flex: 1; min-height: 0`（适应嵌入模式，不脱离 `100vh`）
- `.xf-workspace` 设为 `height: 100%`（填满 oa-main 高度）
- `.xf-content` 添加 `min-height: 0`（防止 flex overflow）
- `.xf-submenu` 添加 `overflow-y: auto`

## 结果

- 所有 19 个测试文件、203 个测试用例通过
- 统一导航：SideMenu 是唯一的菜单入口
- TopBar 是唯一的顶栏（Office AI 品牌 + 搜索 + 健康状态）
- QC/OCR 页面作为全宽无右侧面板的编辑区嵌入
- 布局从"两套系统竞争"变成"一套系统 + 模式切换"
