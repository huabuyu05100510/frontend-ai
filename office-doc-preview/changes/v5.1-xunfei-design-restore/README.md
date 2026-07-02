# v5.1 — 讯飞设计稿还原（智检 + OCR 三模式）

> 模型：claude-sonnet-4-6
> 日期：2026-06-30
> 类型：UI 重设计（按讯飞设计稿 100% 还原）

## 触发原因

用户反馈："设计稿按照目录下的设计稿还原"。
工作目录 `office-doc-preview/讯飞设计稿/` 含 4 张原始设计稿（来自用户 2018-2023 讯飞 BG 期间的 SaaS 平台截图）：
- 讯飞智检.png（文本校对 + 错误侧栏 + 富文本工具栏）
- 图片识别及标注.png（OCR 缩略图列 + 大图预览 + 字段结果）
- OCR训练模板编辑.png（面包屑 + 工具栏 + 模板预览 + 两步骤面板）
- OCR训练模板管理.png（标签页 + 模板表格 + CRUD 操作）

v5.0 已实现"大厂风格"（Ant Design 蓝 + AI 紫），但偏离讯飞设计稿方向。本版本按设计稿 1:1 还原。

## 设计稿 vs 还原对比

### 1. 讯飞智检（QC）
| 设计稿元素 | 还原实现 |
|---|---|
| 顶栏: 品牌 logo + 主导航(首页/使用中心/充值管理/任务管理/词库管理/API文档) + 用户头像 | `.xf-topbar` + `.xf-brand` + `.xf-mainnav` + `.xf-user-chip` |
| 左侧子菜单: 文字校对/文档校对/文本合规/文档合规/图片合规/音频合规/视频合规 | `.xf-submenu` + `.xf-submenu-item` (蓝色激活态 + 左侧 3px 边) |
| 主区: 富文本编辑 + 红色波浪线错误标记 | `.xf-editor-canvas` + `.xf-token.error` (text-decoration: underline wavy) |
| 错误侧栏: 编号 03-10 + 原文 → 改正 + 比对/改写/忽略 | `.xf-error-list` + `.xf-error-card` + `.xf-mini-btn` |
| 底部: B/H/I/U/S + 字号 + 撤销重做 + 字符数 | `.xf-editor-toolbar` + `.xf-tb-btn` |

### 2. 图片识别及标注（OCR 识别）
| 设计稿元素 | 还原实现 |
|---|---|
| 顶部 banner: 功能介绍 + 购买套餐/批量使用/集成API | `.xf-ocr-banner` + 渐变橙红 `.xf-btn-purchase` |
| 左侧: 图片缩略图列(蓝色 2px 边框选中) | `.xf-ocr-thumbs` + `.xf-ocr-thumb.active` |
| 中央: 大图预览 + 缩放/旋转工具条 | `.xf-ocr-preview` + `.xf-ocr-preview-toolbar` |
| 右侧: JSON结果 / 识别结果 双折叠面板 | `.xf-result-section` + `.xf-result-section-header` (点击折叠) |
| 底部: 今日可用 + 上传本地文件 / 输入在线文件URL | `.xf-ocr-footer` + `.xf-input-url` |

### 3. OCR 训练模板编辑
| 设计稿元素 | 还原实现 |
|---|---|
| 面包屑: 模板管理 › 编辑模板 + 保存/试一试/发布 | `.xf-template-bar` + `.xf-breadcrumb` + `.xf-btn-solid/.xf-btn-outline` |
| 左侧垂直工具栏: 全屏/框选/+/1:1 | `.xf-vtoolbar` + `.xf-vtool.active` (蓝色) |
| 中央: 模板预览 + 红色叠加框 | `.xf-template-canvas` + `.xf-template-overlay` |
| 右侧: 第1步:框选参照字段 / 第2步:框选识别区 两步骤 tab | `.xf-step-tabs` + `.xf-step-tab.active` |
| 参照字段 1/2/3/4 输入框 + × 关闭 + 警告 | `.xf-field-list` + `.xf-field-row` + `.xf-field-warning` |

### 4. OCR 训练模板管理
| 设计稿元素 | 还原实现 |
|---|---|
| 标签页: 预置模板 / 自定义模板 (下划线激活) | `.xf-tpl-tabs` + `.xf-tpl-tab.active` |
| 右上: 模板迁移 ▾ / +创建模板 / 搜索 | `.xf-tpl-toolbar` + `.xf-tpl-search` |
| 表格: 模板名称/模板图片/模板ID/发布时间/修改时间/操作 | `.xf-tpl-row` + `.xf-tpl-row.header` |
| 行内元素: 名称 + 编辑铅笔 + 缩略图 + ID + 复制图标 + 未发布 + 操作链接 | `.xf-tpl-name` + `.xf-tpl-thumb` + `.xf-tpl-id-copy` + `.xf-tpl-actions` |

## 设计 Token

```css
--xf-primary: #2772ff;       /* 讯飞蓝 */
--xf-primary-hover: #1e5fd9;
--xf-danger: #ff4d4f;         /* 错误红 */
--xf-text: #333; --xf-text-secondary: #666; --xf-text-tertiary: #999;
--xf-bg: #fff; --xf-bg-canvas: #f5f5f5; --xf-bg-subtle: #fafafa;
--xf-border: #e5e5e5; --xf-border-light: #f0f0f0;
```

## 路由切换

`App.tsx` 中 QC / OCR 页改为全屏替换布局（不再套用 v5.0 的 `AppLayoutV2` 三栏外壳），以便 Xunfei 风格顶栏作为主导航使用。FilesPage / TranslationPage 仍保留 v5.0 大厂布局。

```tsx
const isFullscreenPage = active === 'qc' || active === 'ocr'
if (isFullscreenPage) {
  return (
    <AppShell>
      <TopNavSwitch />          {/* 浮动 4 菜单切换 */}
      {active === 'qc' && <QualityCheckPage />}
      {active === 'ocr' && <OCRPage />}
    </AppShell>
  )
}
```

## 修改文件

### 新增
- `office-preview-app/web/src/design/` 命名空间 `xf-*`（CSS 追加 ~870 行到 styles.css）
- 4 张原始设计稿复制到 `office-doc-preview/讯飞设计稿/`

### 重写
- `office-preview-app/web/src/pages/QualityCheckPage.tsx` — 讯飞智检风格
- `office-preview-app/web/src/pages/OCRPage.tsx` — 三模式(图片识别 + 模板编辑 + 模板管理)

### 修改
- `office-preview-app/web/src/App.tsx` — QC/OCR 全屏替换外壳
- `office-preview-app/server/src/index.mjs` — 加载 `server/.env` 修复 AI key 加载

## 验证

### 视觉回归
截图保存在 `/tmp/design-shots/`：
- `01-qc-page.png` — 智检页（讯飞智检风格）
- `02-ocr-recognize.png` — 图片识别
- `03-ocr-template-edit.png` — 模板编辑
- `04-ocr-template-manage.png` — 模板管理

### 功能测试
- Server: 300/300 tests pass
- Web: 203/203 tests pass
- TypeScript: clean (`tsc --noEmit`)
- 端到端:
  - QC API 5 错误识别 (ai-qc-v1, 5226ms)
  - OCR API 4 regions + text (zhipu-glm-4v-v1, 6376ms)
  - 翻译 API 真实 MiniMax 翻译

### 健康检查
```
translate: { ok: true, providers: [mock, minimax, zhipu, volcano], active: minimax }
ocr: { ok: true, providers: [minimax, zhipu, volcano], active: minimax }
qc: { ok: true, active: zhipu }
status: ok
```

## 关键 Bug 修复

### 1. .env 未加载
**症状**: 重启后 AI 全部降级到 mock，`translate.providers` 只有 `mock`
**根因**: `server/src/index.mjs` 没有调用 `dotenv.config()`，env 变量永远为空
**修复**: 添加 dotenv 加载逻辑
```js
import dotenv from 'dotenv'
const envPath = path.resolve(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
}
```

### 2. QC/OCR 页面被 v5.0 外壳包裹
**症状**: 设计稿还原后页面仍显示"Office AI" 大厂顶栏
**根因**: `App.tsx` 中所有页面都套用 `AppLayoutV2`（TopBar + SideMenu + RightPanel），与讯飞设计稿的独立顶栏冲突
**修复**: 增加 `isFullscreenPage` 分支，QC/OCR 走全屏布局 + 浮动 TopNavSwitch

## 后续待办

1. **OCR 模板编辑**: 框选拖拽 + resize handle（当前用固定坐标）
2. **模板管理**: 接入真实 API（当前 mock 7 条数据）
3. **TranslationPage**: 同步更新为讯飞风格（用户未明确要求）
4. **样本自动加载**: `智检样例_原文.txt` fetch 路径修复（被 Vite proxy 拦截返回 HTML）