# 变更记录

## 2026-06-22 — 段落对齐双栏对比（CSS Grid 单滚动容器）

**模型：claude-sonnet-4-6**

### 目标
双栏对比模式从 "两个独立滚动容器 + JS 同步滚动" 升级为 **CSS Grid 单滚动容器段落对齐**：
- 每个段落 diff block 是一个 CSS Grid row（`1fr | 1px | 1fr`），CSS 自动等高两列
- 消除全部 JS 滚动同步代码，对应段落在视觉上永远水平对齐
- 字符级内嵌高亮：change block 内嵌字符级 charOps

### 技术方案
| 层 | 方案 |
|---|---|
| 段落分割 | `splitParagraphs()` 启发式（空行率 > 10% 用双换行，否则单换行） |
| 段落 diff | `myersDiffArray()` — Myers 算法在段落数组上运行 |
| change 配对 | 相邻 delete+insert 段落配对为 change，嵌入 `myersDiff()` 字符级 diff |
| 前端渲染 | `DualColumnView.tsx` — `.dcv-container` 单 overflow-y，rows 用 CSS Grid |
| 滚动同步 | 零代码——CSS Grid 等高自动对齐，删除全部 syncScroll 状态和 JS 监听 |

### 修改文件
- `server/src/diff.mjs` — 新增 `splitParagraphs`, `myersDiffArray`, `paragraphDiff`
- `server/src/router.mjs` — `granularity='paragraph'` 分支，响应包含 `paragraphBlocks`
- `web/src/types.ts` — 新增 `ParagraphDiffBlock` 接口
- `web/src/inspect/DualColumnView.tsx` — 新建：段落对齐视图组件
- `web/src/inspect/InspectCompareModal.tsx` — 双栏模式使用 `DualColumnView`，移除同步滚动代码
- `web/src/styles.css` — 新增 `.dcv-*` 样式，新增 `.icm-dual-colheads`
- `server/test/diff.test.mjs` — 新增 15 个段落 diff 测试（共 102 通过）
- `web/test/InspectCompareModal.test.tsx` — 更新双栏模式测试用 `.dcv-*`（68 通过）

---

## 2026-06-22 — 双栏对比 · 智检 UI 重构（对标设计稿）

**模型：claude-sonnet-4-6**

### 目标
严格对标 `讯飞设计稿/讯飞智检.png` 和 `讯飞设计稿/翻译对比.png` 重构 InspectCompareModal UI。

### 重构要点
| 变更 | 说明 |
|---|---|
| 智检模式布局 | 左侧分类导航（文字校对/文档校对等） + 主文档区 + 右侧错误列表 |
| 错误高亮 | 原红色删除线 → 红色波浪下划线（`text-decoration: underline wavy`），选中变蓝色高亮 |
| 错误侧栏 | 编号 + 原文→改正 + 接受/忽略按钮；点击展开错误类型 + 比对/改写 |
| 双向联动 | 点击侧栏条目 → 主文档滚动到对应错误位置 |
| 双栏对比模式 | 格式工具条（B/I/U/S/X²）+ 语言切换 + AI翻译 + 同步滚动 |
| 底部工具条 | 仿设计稿编辑工具栏（B/H/T/F/I/S 等按钮） |
| CSS 重构 | 全新 `icm-*` 类名体系；`--bg-sub` token 补充到 `:root` |
| 测试更新 | 68 个测试全部通过，新增双栏模式 token 测试、展开详情测试 |

### 修改文件
- `web/src/inspect/InspectCompareModal.tsx` — 完全重写
- `web/src/styles.css` — 替换 inspect 样式区段（378 行起）
- `web/test/InspectCompareModal.test.tsx` — 更新测试适配新设计

---

## 2026-06-22 — 双栏对比 · 智检功能

**模型：claude-sonnet-4-6 / MiniMax-M3**

### 目标
对标讯飞智检（`讯飞设计稿/翻译对比.png` + `讯飞设计稿/讯飞智检.png`），在 office-preview-app 内落地**双栏对比 + 智检错误列表**。

### 新增模块（5 个）
| 路径 | 行数 | 职责 |
|---|---|---|
| `server/src/diff.mjs` | 180 | Myers diff 引擎 + hunk 聚类 + 错误列表提取 |
| `server/test/diff.test.mjs` | 239 | TDD：23 cases（基础不变式 / 中文 / Emoji / 性能 100KB） |
| `web/src/inspect/InspectCompareModal.tsx` | 289 | 双栏对比弹层（工具条 + 双栏 + 错误侧栏 + 同步滚动） |
| `web/test/InspectCompareModal.test.tsx` | 350 | RTL：14 cases（渲染 / 加载 / 侧栏交互 / 模式切换 / 关闭） |
| `web/e2e/inspect-compare.spec.ts` | 114 | Playwright：5 cases（端到端 + 可观测响应头） |

### 修改模块（7 个）
| 路径 | 改什么 |
|---|---|
| `server/src/router.mjs` | 新增 `POST /api/inspect/diff` 端点 + 6 个可观测响应头 |
| `server/test/router.test.mjs` | 新增 6 个 API 集成测试 |
| `web/src/types.ts` | 新增 `DiffOp` / `RenderToken` / `DiffHunk` / `DiffError` / `InspectMode` / `InspectDiffResponse` |
| `web/src/store.ts` | 新增 inspect state（`inspectOpen` / `inspectSource` / `inspectCompare` / `inspectMode`）+ actions |
| `web/src/App.tsx` | 挂载 `InspectCompareModal`，wire `openInspect` 到 TaskCard |
| `web/src/components/TaskCard.tsx` | 新增 🔍 智检按钮（仅 txt/md 可用） |
| `web/src/styles.css` | 双栏布局 + 错误 token 配色 + 错误侧栏 + 底部 footer（+253 行） |

### 关键不变式（机器可验证）
- diff round-trip：`filter(!insert) → 原左`；`filter(!delete) → 原右`
- 中文友好：`既往开来 → 继往开来` 识别为 1 处 change；`湖北省张家界市 → 湖南省张家界` 重建原文一致
- 性能：100KB 双栏 diff **8ms**（远低于 200ms 门槛）
- 全端类型契约：`RenderToken.type ∈ {equal, delete, insert}` 完备

### 可观测
- 服务端响应头：`X-Diff-Engine: myers@1.0` / `X-Diff-Ms` / `X-Diff-Length-Left/Right` / `X-Diff-Ops` / `X-Diff-Errors`
- 服务端日志：`[inspect-diff] granularity=char left=X right=Y ops=Z errors=W ms=N`
- 前端日志：`[inspect] mode= dual source= t1 compare= t2 ops= 7 errors= 2 ms= 10.1`
- 失败重试：左/右栏独立重试按钮，点击重发 diff 请求

### TDD 全绿
| 套件 | 数量 | 状态 |
|---|---|---|
| server vitest | 87（+24：23 diff + 6 router inspect，其中 5 共用） | ✅ |
| web vitest | 65（+14 InspectCompareModal） | ✅ |
| TypeScript strict | 0 error | ✅ |
| **回归**（既有 51 web + 63 server） | 全绿 | ✅ |

### 不做什么（避免 over-engineering）
- ❌ 不实现真正的「AI 校对」（需 NLU 模型，本期做纯文本 diff，target 由后端业务方注入）
- ❌ 不实现富文本编辑器（底部工具条本期为占位 UI）
- ❌ 不实现多语言对齐（中↔英段落映射本期不做，预留 `granularity` 字段）
- ❌ 不动 PDF 渲染管线

详见 `changes/dual-column-smart-inspect/README.md`

---

## 2026-06-21 — 纯净 pdf.js scaleX 对齐（v4.4：错选+收尾覆盖双解）

**模型：claude-sonnet-4-6**

### 问题

v4.3 移除 scaleX 后，用户反馈两个问题：
1. "想选 '实践有一定的实战经验' 但反选成为了图片所示" —— 仍错选
2. "覆盖不全的问题也很明显尤其收尾的" —— 选区高亮首尾有缺口

### 根因（历经四版迭代定位）

1. **v4.2 的 width=inkWidth/sx 写法错误**：transform 会双重放大 box，hit area 错位 → 错选
2. **v4.3 移除 scaleX**：`::selection` 跟随浏览器文字字形（窄于 PDFium ink），收尾出现缺口
3. **v4.4 首次尝试**：用 Range 测文字宽度，但 transform 作用在 box（shrink-to-fit）上而非文字 → box×sx ≠ inkWidth
4. **真正根因**：React `dangerouslySetInnerHTML` 在 textLayers 变化时**重置 innerHTML**，清掉 JS 设的 inline transform。而 `scaleAppliedPages` skip 已处理页 → transform 丢失，所有 span 退回未补偿状态（渲染宽度 = box 自然宽度 ≠ inkWidth）

### 修复（pdf.js 标准做法）

1. 清除服务端 `width:inkWidth`，让 span 自然宽度 = 浏览器文字渲染宽度（shrink-to-fit）
2. 用 `el.getBoundingClientRect().width` 测 **box 宽度**（transform 作用对象，非文字宽度）
3. `scaleX = inkWidth / boxWidth`，`transform-origin: 0 0`
4. 不设显式 width —— transform 后 `box = 自然宽度 × sx = inkWidth`
5. **原始 inkWidth 缓存到 `dataset.inkW`**（React 重渲染清空 inline width 后仍可读取）
6. **移除 scaleAppliedPages skip**：每次 textLayers 变化都重新应用（因为 innerHTML 被重置）
7. **等待 `document.fonts.ready`** 再测量（回退字体宽度 ≠ 最终字体，会导致 sx 偏差）

### 效果

| 指标 | v4.3（无 scaleX） | v4.4（纯净 scaleX） |
|------|-------------------|---------------------|
| 渲染宽度 vs inkWidth | 偏差 1-4px | **15/15 匹配，maxDiff 0.74px** |
| hit area | = inkWidth box | = inkWidth box（精确） |
| 收尾覆盖 | ✗ 有缺口 | ✓ 完整 |
| 点击准确 | △ 偶尔错选 | ✓ 精确 |

box × sx = inkWidth 数学精确成立，hit area 与 PNG 文字 1:1 映射 → 点击准确且高亮完整覆盖。

### 测试全绿
- ✓ 51 web 单元测试
- ✓ 4 E2E：渲染宽度 = inkWidth（<1.5px）、渲染位置 <2px、wrapper = PNG 像素、选区截图

---

## 2026-06-21 — 移除 scaleX，点击准确优先（v4.3）

**模型：claude-sonnet-4-6**

### 问题

用户反馈"想选 '实践有一定的实战经验' 但反选成为了图片所示"——点击 PNG 文字时选中的是相邻 span 的文字。

根因：scaleX 会把 span 的 hit area 偏离 PNG 文字位置。浏览器 hit-test 命中的是 transform 后的 span box，当 scaleX ≠ 1 时，这个 box 与视觉 PNG 文字错位 → 点击 "实践" 命中 "实战经验" 的 span → 错选。

### 修复

**完全移除 scaleX**。保持 span box = inkWidth（PDFium 测量的文字宽度 = PNG 文字宽度）：
- 点击 PNG 文字必然落在对应 span 上（box = PNG 文字区域，1:1 映射）
- 选区高亮可能有细微空隙（浏览器字体窄于 PDFium 时，`::selection` 跟随字形而非 box），但点击准确、不会错选
- 之前的"重影"已由 extractSpans 消除双重嵌套解决，与 scaleX 无关

#### web/src/previewers/PdfImagesPreview.tsx
- 删除整个 scaleX 测量 + 补偿逻辑（Range 测量、width=inkWidth/sx、transform scaleX）
- useLayoutEffect 仅清除残留 transform，确保 hit area = inkWidth box
- 保留 `scaleAppliedPages` ref 作为"已处理"标记

### 权衡

| 方案 | 点击准确 | 高亮覆盖 | 复杂度 |
|------|---------|---------|--------|
| v4.2 scaleX 补偿 | ✗ 会错选 | ✓ 完整 | 高（Range 测量 + clamp） |
| **v4.3 无 scaleX** | ✓ 精确 | △ 细微空隙 | 低（box = inkWidth） |

用户优先级：点击准确 > 高亮覆盖 → 选择 v4.3。

### 测试全绿
- ✓ 51 web 单元测试
- ✓ 4 E2E：无 transform 残留、渲染位置 < 2px、wrapper = PNG 像素、选区截图

---

## 2026-06-21 — scaleX 测量修正 + 双重拉伸消除（v4.2 选区精确覆盖）

**模型：claude-sonnet-4-6**

### 问题根因

v4.1 移除 scaleX 后"重影"解决，但出现"有些没有覆盖"——选区高亮无法完整覆盖 PNG 文字。根因有两个：

1. **scaleX 测量用错了 API**：`getBoundingClientRect().width` 返回的是 span 的 box 宽度（= 内联 `width` = inkWidth），不是浏览器文字的自然宽度。导致 `sx = inkWidth / boxWidth = 1.0`，scaleX 永远失效。
2. **width + scaleX 双重拉伸**：span 同时设了 `width: inkWidth` 和 `transform: scaleX(sx)`，transform 会把 box 也拉伸。渲染宽度 = `inkWidth × sx`，超出 PNG 文字范围 → 选区高亮错位。

### 修复（pdf.js 行业标杆做法）

正确做法：**不设显式 width = inkWidth**，让 span 自然宽度 = 浏览器文字渲染宽度，用 scaleX 拉伸到 inkWidth。`::selection` 高亮跟随文字字形，拉伸后精确覆盖 PNG 文字区域。

#### web/src/previewers/PdfImagesPreview.tsx（服务端栅格化路径）
- 用 `Range.getBoundingClientRect()` 测量文字自然宽度（jsdom 不支持时回退 `scrollWidth`）
- `width = inkWidth / sx`（让 box 预留缩放空间）+ `transform: scaleX(sx)`
- 最终渲染宽度 = `(inkWidth/sx) × sx = inkWidth` = PNG 文字宽度
- 阈值降到 0.1%（881px span 的 2% 偏差 = 17px 肉眼可见）

#### web/src/previewers/PdfPreview.tsx（pdf.js wasm 路径）
- 同样修正：`width = pdfWidth / sx` + `transform: scaleX(sx)`
- 测量用 `ctx.measureText()`（Canvas API，本身正确），只修 width 双重拉伸问题
- 显式设 `transformOrigin: 0% 0%`（之前依赖 CSS，现在 JS 也设确保一致性）

### 验证结果

| 指标 | v4.1（scaleX 失效） | v4.2（scaleX 修正） |
|------|---------------------|---------------------|
| scaleX 测量源 | box width（= inkWidth） | Range 文字自然宽度 |
| 渲染宽度 vs inkWidth | 偏差 19-25px | **偏差 < 0.02px** |
| 15 个 span 匹配率 | 0.9% | **100%** |
| scaleX 中位数 | ~1.0（假象） | ~1.0（真实补偿） |

跨 span 复制验证：选中 4 个 span，复制内容完整连续：
`"郭亚平求职岗位：前端工程师1993 | 164 | 50 | 安徽阜阳 | 8 年经验18326019819 | pxl_0510@163.com"`

### 测试全绿
- ✓ 51 web 单元测试（含 jsdom Range 兜底）
- ✓ 4 E2E（Playwright 真实浏览器）：scaleX 中位数 ∈ [0.85, 1.15]、异常值 < 10%、渲染位置 < 2px、wrapper = PNG 像素

### v4.2.1 — scaleX 范围限制（解决错选/不易选中）

用户反馈"很容易错选 不易选中"。根因：个别 span 因字体替换/CJK 回退出现极端 scaleX（最高 3.06），拉伸 hit area 到文字外 → 点空白处误选文字；或收缩到极窄 → 文字间出现难点击间隙。

修复：`scaleX` 限制在 `[0.85, 1.15]`。极端值不再拉伸/收缩 hit area，选区稳定。个别 span 接受微小未覆盖（< 15%），换取整体可选择性。

实测 111 个 span 全部在 [0.8543, 1.1500]，中位数 0.98，`allInRange: true`。

---

## 2026-06-21 — 选区重影根因修复（v4.1 文字层嵌套）

**模型：claude-sonnet-4-6**

### 问题根因（真正的 bug）

用户反馈"重影很严重"——选中文字时，选区高亮出现双重影像。

DOM 审查发现 `.pdf-text-layer` 被**双重嵌套**：
1. React 渲染外层 `<div className="pdf-text-layer">`（`position:absolute; inset:0; z-index:1; pointer-events:auto`）
2. 服务端返回的 HTML 内部又包含一个 `<div class="pdf-text-layer">`（同样 `position:absolute; inset:0; z-index:1; pointer-events:auto`）

两层都有 `position:absolute` + `z-index:1` + `pointer-events:auto`，浏览器对选区事件同时派发到两层，spans 被渲染两遍 → 视觉重影。

### 修复

#### web/src/previewers/PdfImagesPreview.tsx
- 新增 `extractSpans(html)` 辅助函数：从服务端 text-layer HTML 中只提取 spans（innerHTML），剥离外层 `.pdf-text-layer` div
- `dangerouslySetInnerHTML` 改为 `extractSpans(textHtml)`，消除双重嵌套

#### web/src/previewers/PdfImagesPreview.tsx（scaleX 补偿移除）
- 删除整个 `useLayoutEffect` scaleX 补偿代码块
- 删除 `scaleAppliedPages` ref
- 原因：v4 文字层的 span width 已经是 PDFium ink bbox 像素宽度（与 PNG 同源同坐标），旧的 scaleX 会把选区拉伸/收缩到错误位置（fontSize 从 PDF points 改到 screen px 后，scaleX 偏差从 ~1.0 变为 0.3~1.6，造成严重重影）

#### web/src/styles.css
- 移除 `.pdf-text-layer span` 的 `transform-origin: 0% 0%`

### 验证结果（TDD 端到端）

新增 `web/e2e/v4-alignment.spec.ts`（Playwright 真实浏览器验证）：

| 测试 | 结果 |
|------|------|
| span 无 transform 残留（scaleX 已移除） | ✓ |
| span 渲染位置 = 服务端坐标（偏差 < 2px） | ✓ |
| page wrapper 尺寸 = PNG 像素尺寸（无拉伸） | ✓ |
| 截图：选区高亮与文字视觉对齐 | ✓ |

测试全绿：**58 server + 51 web + 4 E2E** 全部通过。

### 浏览器调试输出（实测对齐精度）

- `spanStyle.left: "461.73px"` 匹配 `spanRelToPage.left: 461.71875`（亚像素精度）
- `wrapper.w: 1020` 匹配 `img.naturalW: 1020`（无拉伸）
- `transform: "(none)"`（无 scaleX 残留）
- `nestedTextLayers: 0`（嵌套已消除）

---

## 2026-06-21 — 坐标系根本性修复（v4 文字层）

**模型：claude-sonnet-4-6**

### 问题根因（真正的 bug）

PDFium `page.render({ scale: 120/72 })` 的实际输出尺寸 ≠ `Math.round(originalSize × scale)`：
- `originalSize = 595.3 × 841.95`（PDF points）
- `scale = 120/72 = 1.6667`
- `Math.round(595.3 × 1.6667) = 992` ← 旧代码用这个作为文字层坐标系
- PDFium 实际 render 输出 = `991 × 1401` ← PNG 像素空间

**1-2px 的系统性偏差**导致 span 坐标落在 992×1403 坐标系，但 PNG 是 991×1401 像素。虽然偏差看似小，但：
- 水平方向每 500px 累积 ~0.5px 偏移
- 垂直方向每 700px 累积 ~1px 偏移
- 叠加浏览器字体替换漂移 → 用户感知"极差"

### PDFium 实际公式（逆向推导）

```
render_width  = Math.floor(Math.floor(originalWidth)  * scale)
render_height = Math.floor(Math.floor(originalHeight) * scale)
```

验证：
- `floor(floor(595.3) × 1.6667) = floor(595 × 1.6667) = floor(991.67) = 991` ✓
- `floor(floor(841.95) × 1.6667) = floor(841 × 1.6667) = floor(1401.67) = 1401` ✓

### 修复

#### server/src/pdfium-render.mjs `pdfiumExtractCharBoxes`
- `pageWidthPx`: `Math.round(orig × scale)` → `Math.floor(Math.floor(orig) × scale)`
- `pageHeightPx`: 同上
- 坐标转换：uniform `scale` → non-uniform `scaleX = pageWidthPx / originalWidth`, `scaleY = pageHeightPx / originalHeight`
- `fontSize`：PDF points → screen pixels（`fontSizePt × scaleY`），14pt → 23.3px（匹配 120 DPI 渲染）

#### server/src/pdfium-text-layer.mjs
- 版本号 `data-pdfium="3"` → `"4"`，触发旧文件自动重生

#### server/src/router.mjs
- 自动重生检测条件更新为 `data-pdfium="4"`

### 验证结果

| 指标 | 修复前 (v3) | 修复后 (v4) |
|------|------------|------------|
| 文字层坐标系 | 992 × 1403 | **991 × 1401** |
| PNG 像素空间 | 991 × 1401 | 991 × 1401 |
| 尺寸偏差 | 1-2px | **0px** |
| 郭亚平 Y 偏移 | 0px (巧合) | 0.57px |
| 郭亚平 X 偏移 | 0px (巧合) | 0.45px |
| font-size | 9.00px (PDF points) | **14.98px** (screen pixels) |

> 注：v3 的 0px 偏移是巧合——PNG 被 CSS 拉伸到 992×1403 抵消了坐标系偏差。v4 消除了拉伸，PNG 以原始 991×1401 显示，span 坐标也在 991×1401 空间，真正的像素级对齐。

---

## 2026-06-21 — 选区可点击性修复（v3 文字层）

**模型：claude-sonnet-4-6**

### 问题根因

1. **细横笔无法点选**：`一` 等细横线字符的 ink-bbox 高度仅 ~4.8px，远小于光标可命中区域。`Math.max(inkH, fontSize×0.5)` 的最小高度公式不够大（9px 字体仅保证 4.5px）。
2. **幽灵 span 干扰**：PDF 内嵌控制字符（换行符、fontSize<3 的不可见字符）产生 0.5×0.5px 幽灵 span，混淆事件命中区域。

### 修复方案

#### server/src/pdfium-render.mjs
- 在 `pdfiumExtractTextRuns` 中过滤 `fontSize < 3` 的字符及 Unicode 控制字符（0x00–0x1F、0x7F–0x9F）
- 效果：span 数量从 96 减到 44（resume page-1），消除所有幽灵 span

#### server/src/pdfium-text-layer.mjs
- `runToSpan` 最小高度从 `fontSize × 0.5` 提升到 `fontSize × 0.85`
- 9px 字体的 `一` 字 span 高度：4.81px → 7.65px（可点击性显著提升）
- 版本号从 `data-pdfium="2"` 升级到 `data-pdfium="3"`，触发旧文件自动重生

#### server/src/router.mjs
- 自动重生检测：将 `data-pdfium="2"` 纳入重生条件（reason: `pre-pdfium-v3`）

### 验证

- 最小 span 高度：7.65px（升级前 4.81px），全部 span 高度 ≥ 7.65px
- 坐标对齐：像素级验证（`郭亚平` ink y=96px，span top=95.58px；`求职岗位` ink y=142px，span top=141.82px）
- 幽灵 span：0 个（升级前 44 个不可见 span）

---

## 2026-06-21 — 选区对齐深度优化（文字与背景像素级对齐）

**模型：claude-sonnet-4-6**

### 问题根因（行业深度调研）

PDF 文档在"图片+文字层"预览模式下，选中高亮背景与 PNG 墨水像素存在偏移，原因如下：

1. **垂直偏移**：旧代码使用 `top = baselineY - fontSize × 0.80` 的近似公式，固定 ASCENT_RATIO=0.80 对 CJK 字符（实际约 0.88）偏低约 1-2px，导致选区高亮比文字偏低。
2. **水平漂移**：span 的 `width` 来自 PDFium，但浏览器用系统字体渲染透明字符，字体替换导致字符实际宽度与 span 边界不一致（PDF.js --scale-x 同款问题）。
3. **维度不一致**：`Math.floor` vs PDFium 实际渲染维度（`Math.round`）导致页面尺寸差 1px，进而 `<img>` 被轻微拉伸。

### 修复方案（对标 Adobe Acrobat / PDF.js v4 行业标杆）

#### server/src/pdfium-text-layer.mjs（v4）
- **移除 ASCENT_RATIO 近似公式**：直接使用 `run.top`（PDFium ink bbox 顶边）作为 span 的 `top`
- 高度使用 `max(inkH, fontSize × 0.5)`（ink 真实高度兜底）
- 版本号从 `data-pdfium="1"` 升级到 `data-pdfium="2"`，触发旧缓存文件自动重生

#### server/src/pdfium-render.mjs
- `Math.floor` → `Math.round`：页面像素尺寸与 PDFium 实际渲染维度一致

#### server/src/router.mjs
- 自动重生检测：将 `data-pdfium="1"` 旧版格式纳入重生条件（reason: `pre-pdfium-v2`）

#### web/src/previewers/PdfImagesPreview.tsx
- **新增客户端 scaleX 补偿**（`useLayoutEffect`）：
  - 文字层注入 DOM 后、浏览器首次 paint 前执行（无闪烁）
  - 对每个 span 用 DOM-attached canvas 测量浏览器字体渲染宽度
  - 注入 `transform: scaleX(pdfWidth / browserWidth)`，消除字体替换水平漂移
  - 仅在偏差 >0.5% 时写入（减少不必要的 style mutation）
  - `lang` 属性确保测量 canvas 与渲染字体一致（PDF.js 2024 同款修复）

#### web/src/previewers/PdfPreview.tsx
- pdf.js 模式文字层同步对齐：加入 `item.width × scale` 作为 span 宽度
- 同款 scaleX 补偿（每个 span 独立计算）

#### web/src/styles.css
- `.pdf-text-layer span`：新增 `overflow: hidden`（防止浏览器字形溢出 ink bbox）
- `.pdf-textlayer span`（pdf.js 模式）：同步加 `overflow: hidden; user-select: text`

### 技术选型依据

| 方案 | 原理 | 对齐精度 |
|------|------|----------|
| PDF.js 默认 | per-run scaleX + canvas 测量 | run 边界准确，run 内均匀拉伸 |
| Adobe Acrobat Web | per-char 独立 span | 字符级精确 |
| **本项目（v4）** | PDFium ink bbox 直接定位 + client scaleX | 与 PNG 渲染同源，理论 0 偏移 |

核心优势：PNG 渲染与 bbox 来自同一 PDFium WASM 实例，坐标系完全一致，无跨引擎漂移；客户端 scaleX 仅补偿浏览器字体替换误差。
