# 统一布局：OCR / 翻译页面子菜单重构

## 背景
- `QualityCheckPage` 使用 `xf-workspace`（左侧 `xf-submenu` + 右侧 `xf-content`）布局
- `OCRPage` 用右上角浮动按钮切换模式，不一致
- `TranslationPage` 只有文本输入，缺少文档/图片/音频/视频翻译模式（background.md 显示需支持 23 种格式）

## 改动
1. **OCRPage** → 改用 `xf-workspace` 布局，左侧子菜单：图片识别 / 模板编辑 / 模板管理
   - 移除右上角浮动模式切换器
   - 顶部 Banner 移除，保留工作区核心功能
   - 工具按钮条改为顶部横向条（参考 QualityCheckPage）

2. **TranslationPage** → 改用 `xf-workspace` 布局，左侧子菜单：
   - 文本翻译（standalone 模式，复用现有 `/api/inspect/translate`）
   - 文档翻译（选择 task，调用 `/api/inspect/translate`）
   - 图片翻译（OCR + 翻译，串接 `/api/ocr/recognize` → `/api/inspect/translate`）
   - 音频翻译（占位：语音转写 ASR 待接入）
   - 视频翻译（占位：音轨提取 + ASR 待接入）

3. **CSS** 新增 `.xf-select`、`.xf-file-card` 通用样式
4. **icons** 新增 `MusicIcon`、`VideoIcon`

## 链路打通
| 模式 | 端点 | 说明 |
|------|------|------|
| 文本翻译 | `POST /api/inspect/translate` | standalone 模式 |
| 文档翻译 | `POST /api/inspect/translate` | taskId 模式 |
| 图片翻译 | `POST /api/ocr/recognize` → `POST /api/inspect/translate` | OCR 文字 → 翻译 |
| 图片识别 | `POST /api/ocr/recognize` | 直接 OCR |

## 文件
- `office-preview-app/web/src/pages/OCRPage.tsx` — 重构为 xf-workspace
- `office-preview-app/web/src/pages/TranslationPage.tsx` — 重构为 5 模式子菜单
- `office-preview-app/web/src/styles.css` — 新增 .xf-select / .xf-file-card
- `office-preview-app/web/src/design/icons.tsx` — 新增 MusicIcon / VideoIcon

## 验证
- `npx tsc --noEmit` 通过

## 模型
claude-sonnet-4-6
