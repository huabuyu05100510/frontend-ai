# AI 能力页可视对比（Before vs After）

## 总览

在 `README.md` 已交付的 5 个 AI 能力 hover 联动基础上，本轮新增 **4 个可视能力增强**，每个都用前后对比截图证明用户能直接感知。

| # | 能力 | Before | After | 截图 |
|---|------|--------|-------|------|
| 1 | **VoicePage** — 音频段标记时间轴 | 仅文字段卡，无时间轴 | 彩色 marker 时间轴 + playhead | 11/12/13 |
| 2 | **OCR** — 区域 hover tooltip | 无 tooltip，hover 只改 stroke | 浮动黑底 tooltip（文字+置信度+坐标） | 03/04 |
| 3 | **OCR** — 区域序号标签 | 无 | 每段 `#1` `#2` 彩底白字 | 03 |
| 4 | **QC** — token/card scrollIntoView | hover 只改 class | 同步滚动 + 80ms debounce | 07/08/09 |
| 5 | **Translation** — 段落模式同步滚动 | hover 改色 | 80ms debounce + 双向 scrollIntoView | 02 |

新增测试：**+16** (timeline 7 + tooltip 4 + scroll 3 + paraScroll 2) → 总计 **667 passing**

---

## 1. VoicePage 段标记时间轴

### Before
仅段卡显示 `[00:00.00 → 00:02.06 (2.0s)] 文本 / 译文`，没有视觉化时间结构。

### After
新增独立的可视化时间轴条：

- **彩色 marker** 按段宽比例铺开（蓝/青/紫/绿循环）
- **hover marker** → 对应段卡 `.hovered` 状态 + 音频跳到 start_ms
- **active marker** → 实色填充 + 高亮边框（timeupdate 触发）
- **playhead** 蓝线 + 阴影随播放进度移动
- **总时长标签** `00:00 → 00:09` 在右上角

### 关键代码
```tsx
<div data-testid="voice-timeline">
  {segments.map((seg, i) => (
    <div data-testid={`voice-timeline-marker-${i}`}
         style={{ left: `${(seg.start_ms / totalMs) * 100}%`,
                  width: `${((seg.end_ms - seg.start_ms) / totalMs) * 100}%` }}
         onClick={() => handleSegmentEnter(seg)}
         onMouseEnter={...}>
      {seg.source}
    </div>
  ))}
</div>
```

### 截图
- `11-voice-baseline.png` — 4 段彩色 marker 完整渲染
- `12-voice-hover-seg1.png` — hover 第 2 段，marker + 段卡同步高亮
- `13-voice-hover-timeline-marker.png` — hover 第 3 段 marker，第 3 段卡片同步

---

## 2. OCR 区域 Hover Tooltip

### Before
hover 区域只改变 stroke 颜色（绿/黄/红 → 蓝），但**用户不知道这个区域里是什么文字**。

### After
- **SVG `<title>`** 子元素 — 浏览器原生 tooltip（hover 区域 1 秒后显示）
- **浮动 HTML tooltip** — 紧贴区域左上角，黑底白字，含：
  - 区域编号 `#1`
  - 识别文字 `"标题文字"`
  - 置信度 `95%`
  - 坐标 `x=66 y=46`
- **区域序号标签** — 每段 SVG 上叠 `#1 #2 #3` 彩底白字，paint-order: stroke fill 防锯齿

### 截图
- `03-ocr-baseline.png` — 5 个 SVG rect + `#1-#5` 彩色标签
- `04-ocr-hover-region.png` — hover 区域 #1，浮动 tooltip 显示文字+置信度+坐标

---

## 3. OCR Mock Provider（离线演示支撑）

### Before
ZHIPU_API_KEY 未配置 → OCR 返回 `regions: []` + `imageSize: null` → SVG 不渲染 → 截图只能展示空面板。

### After
新增 `mock` provider（`OCR_PROVIDER=mock` 启用）：
- 读真实图片尺寸（PNG/JPEG 解析）
- 返回 5 个示例区域（标题/副标题/正文×2/页脚）
- 置信度 0.95/0.88/0.92/0.75/0.42 演示置信度配色（绿/绿/绿/黄/红）

### 关键代码
```js
// server/src/ocr.mjs
case 'mock':
  ocrData = ocrMock(imagePath)
  engine = 'mock-v1'
  break
```

---

## 4. QualityCheck hover 同步滚动

### Before
hover token / card 只切换 className（黄色高亮），用户视线需要肉眼寻找对应元素。如果错误卡很多 + 长文本文档，**用户根本找不到**对应位置。

### After
- **hover card → 对应 token scrollIntoView**（block: nearest，无副作用）
- **hover token → 对应 card scrollIntoView**
- **80ms debounce** — 快速掠过多个 token 不会触发抖动
- **requestAnimationFrame** — 等 hovered class 先生效再滚，视觉过渡平滑

### 关键代码
```tsx
const setHover = useCallback((id, source) => {
  setHoveredErrId(id)
  if (id && source) {
    hoverSourceRef.current = source
    const now = Date.now()
    if (now - lastScrollTsRef.current < 80) return
    lastScrollTsRef.current = now
    requestAnimationFrame(() => {
      const sel = source === 'card'
        ? `[data-err-id="${id}"]`     // card → 找 token
        : `[data-testid="qc-error-card-${id}"]`  // token → 找 card
      const el = document.querySelector(sel)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }
}, [])
```

### 截图
- `07-qc-baseline.png` — 编辑器中红色虚线 token + 右侧 8 个错误卡
- `08-qc-hover-token.png` — hover token，第 1 个错误卡边框高亮
- `09-qc-hover-card.png` — hover 第 2 个错误卡，编辑器对应位置 token 高亮

---

## 5. Translation 段落模式同步滚动

### Before
RealtimeTranslateMode 段落对照模式：hover 一边改另一边颜色，但**两边各 3+ 段时用户需要肉眼匹配**。

### After
hover src 段 → 对应 tgt 段 `scrollIntoView({ block: 'nearest' })`，反向同理。
80ms debounce + rAF，行为与 QC 一致。

### 关键代码
```tsx
// 给两列分别加 ref
<div ref={paraSrcRef} data-testid="rt-para-src-col">...</div>
<div ref={paraTgtRef} data-testid="rt-para-tgt-col">...</div>

// hover 段落 → 同步滚动
onMouseEnter={() => {
  setHoveredSrcPara(i)
  if (Date.now() - lastParaScrollTsRef.current >= 80) {
    lastParaScrollTsRef.current = Date.now()
    requestAnimationFrame(() => {
      paraTgtRef.current?.querySelector(
        `[data-testid="rt-para-tgt-${i}"]`
      )?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }
}}
```

### 截图
- `01-translate-baseline.png` — 翻译结果左右栏显示
- `02-translate-hover-row0.png` — hover 第 1 段，左右两栏同时高亮（黄色背景 + borderLeft/Right 加粗）

---

## 测试覆盖

| 模块 | 文件 | 测试数 |
|------|------|--------|
| VoicePage 时间轴 | `web/test/VoicePage.timeline.test.tsx` | 7 |
| OCR tooltip + 标签 | `web/test/OCRPage.tooltip.test.tsx` | 4 |
| QC hover 滚动 | `web/test/QualityCheckPage.scroll.test.tsx` | 3 |
| Translation 段落滚动 | `web/test/TranslationPage.paraScroll.test.tsx` | 2 |
| **新增总计** | | **+16** |

**回归基线**：
- Server: 405/405 (33 文件)
- Web: 262/262 (32 文件) — 之前 246 → +16
- **总计 667 passing**

---

## 截图清单

所有截图保存在 `screenshots/` 目录，13 张，按页面分组：

```
01-translate-baseline.png            # 翻译结果
02-translate-hover-row0.png          # 翻译 hover 联动
03-ocr-baseline.png                  # OCR 5 区域 + 序号标签
04-ocr-hover-region.png              # OCR tooltip 显示
05-ocr-hover-card.png                # OCR 文字卡 hover
06-ocr-export-pdf.png                # OCR 导出可搜索 PDF
07-qc-baseline.png                   # 校对结果双栏
08-qc-hover-token.png                # 校对 token hover
09-qc-hover-card.png                 # 校对错误卡 hover
10-qc-corrected-pane.png             # 改正后文本面板
11-voice-baseline.png                # 语音段标记时间轴
12-voice-hover-seg1.png              # 语音段卡 hover
13-voice-hover-timeline-marker.png   # 语音时间轴 marker hover
```

---

## 关键文件改动

| 文件 | 改动 |
|------|------|
| `web/src/pages/VoicePage.tsx` | 新增可视化时间轴（marker + playhead + 双向 hover） |
| `web/src/pages/OCRPage.tsx` | SVG `<title>` + 浮动 HTML tooltip + `#1` 序号标签 |
| `web/src/pages/QualityCheckPage.tsx` | `setHover(id, source)` + scrollIntoView + 80ms debounce |
| `web/src/pages/TranslationPage.tsx` | `paraSrcRef`/`paraTgtRef` + 段落模式同步滚动 |
| `server/src/ocr.mjs` | 新增 `mock` provider（演示模式） |

模型：claude-sonnet-4-6