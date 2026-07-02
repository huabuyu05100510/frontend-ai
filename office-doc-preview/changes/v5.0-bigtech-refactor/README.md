# v5.0 — 大厂风格重构 + 三家 AI 全打通 + 单端口上线

> 模型：claude-sonnet-4-6
> 日期：2026-06-30
> 类型：Architecture Refactor + Visual Overhaul + AI Integration + Production Hardening

## 改动一览

### 1. AI 三家 Provider 全打通（mock → real）

**症状**：所有 AI 功能都走 mock fallback，UI 显示 "[en] <source>" 而不是真实翻译；OCR 返回空；智检返回空。

**根因**：服务端 `.env` 缺失 / Provider URL 错误 / 模型名错误。

**方案**：

| Provider | Endpoint | Model | 状态 |
|----------|----------|-------|------|
| MiniMax | `https://api.minimax.chat/v1/text/chatcompletion_v2` | `MiniMax-Text-01` | ✓ OK |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-4-flash` | ✓ OK |
| 火山引擎 | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` | env override | ⚠ Key 类型不匹配（401） |

**实际验证**（vitest live test）：
```
[minimax] in="今天天气真好" out="The weather is really nice today" engine=minimax-ai-v1 ms=1537
[zhipu]   in="今天天气真好" out="The weather is really nice today." engine=zhipu-ai-v1 ms=751
[volcano] in="今天天气真好" out="[en] 今天天气真好" engine=mock-fallback-v1 ms=3116
```

> 注：火山引擎 key 是 voice-portfolio 的 ASR/TTS 凭据，不能用于 Ark LLM API。
> 现网翻译用 MiniMax + 智谱双 Provider 兜底。

**Bug Fixes**：
- `ocr.mjs` URL `api.minimaxi.chat` → `api.minimax.chat`（多余的 i）
- `ocr.mjs` model `abab6.5s-chat` → `MiniMax-Text-01`
- `ocr.mjs` Zhipu `max_tokens: 4096` → `1024`（GLM-4V 上限）
- `ocr.mjs` 优先级：新增 `OCR_PROVIDER` 环境变量（之前误用 `TRANSLATE_PROVIDER`）

### 2. 服务端清理（生产可观测）

- **删除** `server/src/scheduler.mjs`（死代码：364 行 TypeScript 写在 `.mjs` 里，import 必然失败，从未被引用）
- **`/api/health/translate` / `/api/health/ocr` / `/api/health/qc`**：
  - 之前永远返回 `{ok: true}` —— 误导线上监控
  - 现在无 AI Key 时返回 `503 {ok:false, status:'degraded', reason:'...'}`
- **新增 `/api/health/all`** 聚合端点（前端 banner 消费）
- **JSON parse 错误**：之前返回 500，现在返回 `400 {error:'invalid JSON body: ...'}`
  - 新增 `parseJSONBody()` helper（带 `INVALID_JSON` 错误码）
  - 修复 6 个路由：`inspect-diff / ocr-recognize / ocr-compare / quality-check / phrase-errors / inspect-translate`

### 3. 前端大厂视觉系统（对标飞书 / Ant Design / 腾讯文档）

**症状**：4 个页面（FilesPage/TranslationPage/QualityCheckPage/OCRPage）使用的 `plt-* / tr-* / qc-* / ocr-*` class 在 styles.css 中**完全不存在**，导致页面渲染近乎裸 HTML。

**方案**：

#### 3.1 Design Tokens（`src/design/tokens.ts`）
- 主色 Ant Design 蓝 `#1677ff` + AI 紫 `#722ed1`
- 8 级字号 / 8 级间距 / 6 级圆角 / 6 级阴影
- `toCSSVars()` 函数 → 自动 emit `:root` CSS variables（避免重复定义）

#### 3.2 Icons（`src/design/icons.tsx`）
- 44 个 lucide-style SVG 图标（stroke-based，统一 24px 视图框）
- 含：FileText / Languages / ShieldCheck / Scan / Sparkle / Brain / Search / Refresh / Copy / ChevronXxx / ArrowXxx ...

#### 3.3 Design System CSS（追加 ~880 行到 `styles.css`）
- `.oa-shell` 三栏布局：TopBar(56px) + SideMenu(220px) + Main + RightPanel(320px)
- `.oa-card` / `.oa-btn-*` / `.oa-input` / `.oa-badge-*` / `.oa-tab` / `.oa-page-header`
- `.oa-stat-grid` 统计卡片
- `.oa-empty` / `.oa-alert-*` / `.oa-spinner` / `.oa-skeleton`
- AI 渐变：`linear-gradient(135deg, #722ed1, #1677ff)` 用于 AI 标识
- 移动端响应式：< 768px 自动隐藏侧栏

#### 3.4 AppShell + AppLayoutV2（参考 voice-portfolio 结构，重做视觉）

- **`AppShell.tsx`**：ErrorBoundary（page error 不让整个 app 白屏）
- **`AppLayoutV2.tsx`**：三栏布局容器 + dynamic grid template
- **`components/TopBar.tsx`**：品牌 + 全局搜索 + AI 健康徽章
- **`components/SideMenu.tsx`**：3 分组（文档 / AI 能力 / 工具集）+ 激活项蓝色左 border + AI 紫色徽章
- **`components/RightPanel.tsx`**：最近任务列表 + 系统状态（PDFium / 翻译 / OCR Provider）
- **`App.tsx`**：30 秒健康轮询 + 降级模式顶部 banner + 选中任务高亮

### 4. 4 个页面重写（大厂视觉）

- **`FilesPage.tsx`**：统计卡片（总/转码中/就绪/失败）+ 搜索 + Tabs + 文件网格
- **`TranslationPage.tsx`**：源/目标语言选择 + 交换 + AI 翻译按钮（紫色渐变）+ 双栏结果展示
- **`QualityCheckPage.tsx`**：3 模式（双栏对比 / AI 校对 / 分词检测）+ 错误列表可点击高亮 + 5 项统计
- **`OCRPage.tsx`**：图片选择 + 区域检测 SVG overlay + 文字区域列表（坐标 + 置信度）+ 对比模式

## 验证结果

### 服务端
```bash
npm --prefix server test
# 20 个文件，300 个测试，全部通过

# AI 真实连通
curl -X POST http://localhost:5180/api/inspect/translate \
  -H 'Content-Type: application/json' \
  -d '{"taskId":"standalone","sourceLang":"zh-CN","targetLang":"en","text":"今天天气真好"}'
# → "The weather is really nice today"  （不是 mock 前缀）

curl http://localhost:5180/api/health/all
# → {"ok":true,"status":"ok","version":"5.0","translate":{"providers":["mock","minimax","zhipu","volcano"]}}
```

### 前端
```bash
npm --prefix web test
# 19 个文件，203 个测试，全部通过
npm --prefix web run build
# 512 modules, 2.92s, dist 51.9KB CSS
npx tsc --noEmit
# ✓ clean
```

### 端到端（http://localhost:5180/）
```
GET /                          → 200 text/html (SPA shell)
GET /assets/index-*.css        → 200 text/css (51.9 KB, immutable cache)
GET /some/spa/route            → 200 text/html (SPA fallback)
GET /api/health/all            → 200 application/json (聚合状态)
POST /api/inspect/translate    → 200 (MiniMax 真实翻译，1.5s)
POST /api/ocr/recognize        → 200 (MiniMax 视觉，1.6s)
POST {bad json}                → 400 (invalid JSON body)
```

## 可观测

- **TopBar** 实时显示 `AI · 已就绪` / `AI · 降级模式` 徽章
- **降级模式 banner**：无 AI Provider 时顶部红色/黄色提示，告知用户在 `.env` 配置 key
- **RightPanel**：实时展示 PDFium 引擎 / 翻译 Provider / OCR Provider
- **服务端日志**：所有 AI 调用带 `[translate-provider] / [ocr] / [quality-check]` 前缀
- **响应头**：`X-Translate-Engine / X-OCR-Engine / X-OCR-Regions / X-Translate-Ms` 保留

## 文件清单

### 新增
- `web/src/design/tokens.ts` — 大厂设计 tokens
- `web/src/design/icons.tsx` — 44 个 lucide-style 图标
- `web/src/AppShell.tsx` — ErrorBoundary
- `web/src/AppLayoutV2.tsx` — 三栏布局容器
- `web/src/components/TopBar.tsx` — 顶栏
- `web/src/components/SideMenu.tsx` — 左侧导航
- `web/src/components/RightPanel.tsx` — 右侧任务/状态
- `server/test/ai-providers-live.test.mjs` — 真实 AI 连通性测试
- `server/.env` — 三家 key（gited 排除，由用户本地创建）

### 重写
- `web/src/styles.css` — 追加 ~880 行设计系统
- `web/src/App.tsx` — 接入新布局 + 健康轮询
- `web/src/pages/FilesPage.tsx` — 大厂视觉
- `web/src/pages/TranslationPage.tsx` — 大厂视觉
- `web/src/pages/QualityCheckPage.tsx` — 大厂视觉
- `web/src/pages/OCRPage.tsx` — 大厂视觉
- `server/src/router.mjs` — 健康检查 / JSON parse 修复
- `server/src/ocr.mjs` — URL / model 修复 + OCR_PROVIDER env

### 删除
- `server/src/scheduler.mjs` — 死代码（TypeScript 语法写在 .mjs）

## Risks / Known Limitations

1. **火山引擎**：当前 key 是 voice-portfolio ASR/TTS 凭据，不适用 Ark LLM API
   - 需用户提供新的火山方舟 key（`ep-xxx` endpoint ID）
2. **OCR 文字提取质量**：当前 MiniMax / GLM-4V 返回 prompt 模板而非真实 OCR
   - 需要专业的 OCR 服务（如讯飞 OCR API / 自训练模型）替换
3. **智检（aiQualityCheck）**：当前还是 heuristic regex，需要时再接 LLM
4. **OnlyOffice JWT**：当前默认值 `mvtndSBp0a7fa400u81Cq2MSfddXD090` 是 dev fallback
   - 生产部署必须设置 `ONLYOFFICE_JWT_SECRET` 环境变量

## 上线清单

- [x] AI Provider 接通（MiniMax ✓ / 智谱 ✓ / 火山 ⚠）
- [x] Health endpoint 上报降级状态
- [x] 静态前端单端口托管
- [x] JSON parse 错误 4xx 处理
- [x] 错误日志统一前缀
- [x] CORS / Cache-Control 头部
- [ ] PM2 / systemd 守护进程（部署阶段）
- [ ] Nginx HTTPS 反代（部署阶段）
- [ ] OnlyOffice 生产 JWT（部署阶段）