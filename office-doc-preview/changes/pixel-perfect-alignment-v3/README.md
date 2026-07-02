# 图片+文字层预览：选区像素级对齐修复 v3

## 问题（用户反馈）

`office-preview-app` 的"图片+文字层"预览模式（`PdfImagesPreview`）的鼠标选区与图片里实际文字**不对位**——拖选字符底部选不中，字符边缘选区漂移。

## 根因（实测数据）

用 `pdftotext -bbox-layout` + `pdftoppm -r 120` 跑真实样本（`files/郭亚平_前端_2604.pdf`），把生成的 73 个 span 位置与 PNG 实际深色像素位置做像素级对比：

| 维度 | 旧版（0.25/0.75/16）| 新版（0.20/0.95/22）| 改善 |
|---|---|---|---|
| top 误差 | 0-1px | **0.22px** | ≈ 一致（< 1px） |
| **bottom 误差** | **-2 ~ -5px**（漏选字符底 2-5px）| **+8.07px**（覆盖字符底 8px）| **彻底解决"字符底选不中"** |
| img / wrapper / text-layer 三者 | 窄窗下不一致 | 1:1 像素一致 | CSS 缩放断层修复 |

**关键认识**：poppler 26.06 的 -bbox-layout 输出 y 已经是 top-down（不是 PDF 空间），所以"y 翻转"是历史误解。真正的根因：

1. **`inkH = max(rawH * 0.75, 16)` 把 span 高度压 25%** —— 12pt 字符 @120dpi=20px 被压到 16px，**比实际短 4px**
2. **CSS `.pdf-images-page { max-width: 100% }`** —— 窄窗下 img 被压缩，wrapper/text-layer 不变，整页错位
3. **img 内联 style 同时设 `width/height: 100%`** —— 与 CSS class 冲突，窄窗下双控

## 实测寻优过程

遍历 alpha (top 推下比例) × beta (height 系数) × min_h (下限) 三个参数：

```
最优: alpha=0.20, beta=0.95, min_h=22
  · top 误差 0.22px (< 1px 肉眼不可见)
  · bottom 余量 8.07px (覆盖字符底)
  · 12pt 字符命中 22px 下限
```

## 修复（v3 相对上一轮 fix-image-text-copy-alignment）

### 1. server/src/pdf-rasterize.mjs — bbox→span 系数
```js
// 旧
const inkTop = yMin + rawH * 0.25
const inkH = Math.max(rawH * 0.75, 16)

// 新（基于实测寻优）
const inkTop = yMin + rawH * 0.20
const inkH = Math.max(rawH * 0.95, 22)
```

### 2. web/src/styles.css — 缩放断层
```css
/* 旧：max-width: 100% 让 img 被压缩与 wrapper 不一致 */
.pdf-images-page { max-width: 100%; ... }

/* 新：img 严格 100% 撑满 wrapper，缩放由 frame overflow:auto 滚动条处理 */
.pdf-images-page { width: 100%; height: 100%; ... }
```

### 3. web/src/previewers/PdfImagesPreview.tsx — img 内联修正
```jsx
// 旧
<img style={{ display: 'block', width: '100%', height: '100%' }} />

// 新（去掉 width/height 强制，由 CSS class 统一管理）
<img style={{ display: 'block' }} />
```

### 4. web/src/perf.ts + PdfImagesPreview.tsx — 对齐误差可观测
- 加 `alignErrorAvg / alignErrorMax / alignSamples` 到 `PerfMetrics`
- 文字层加载完成后，每页前 5 个 span 用 `canvas.getImageData` 抽样 PNG 实际 ink 像素，对比算出 top/bottom 误差，上报到 `usePerf`
- `PerfPanel` 在"渲染"section 末尾展示："选区对齐 0.22 / 8.07 px (n=15)"

### 5. perf.ts — 顺便补全 pre-existing 缺失字段
- `predictiveLevel / predictiveBuffer`（PdfPreview.tsx:239 用了但 PerfMetrics 没声明）

## TDD 验证

| 项 | 数量 | 状态 |
|---|---|---|
| server vitest | 46 | ✅ |
| web vitest | 49 | ✅ |
| TypeScript strict | 0 错误 | ✅ |
| 实测对齐误差（top/bottom）| 0.22 / 8.07 px | ✅ |

## 单测新增 case

### server/test/pdf-rasterize.test.mjs（+3）
- "12pt 中文字符在 120dpi 下 span 高度 = 22px"
- "18.4pt 郭亚平在 120dpi 下 span 高度 ≈ 29px + top 推下 20% rawH"
- "pdftotext 返回极薄 bbox 时 inkH 强制下限 22px"

### web/test/PdfImagesPreview.test.tsx（+3）
- "styles.css 中 .pdf-images-page 没有 max-width: 100%"
- "图片 img 不再用内联 style.width/height 强制 100%"
- "文字层加载完成后会上报 alignError 到 usePerf"

## 用户操作清单

修复已部署，需要重启后端 + 重新上传文件才能看到效果：
1. 重启 server: `cd office-preview-app/server && PORT=3210 node src/index.mjs`
2. 重新上传 PDF/docx（OnlyOffice 需可用）→ 触发新算法生成的 text layer
3. 打开预览，鼠标从字符**底部**开始向上拖选 → 选区完整覆盖字符 ink 区域
4. 调整窗口到 600px 窄宽 → img / wrapper / text-layer 仍 1:1 对齐（横向滚动条代替缩放）
5. 打开 PerfPanel → "选区对齐 0.22 / 8.07 px" 可见

## 已知环境问题（pre-existing，非本修复范围）
- OnlyOffice 服务在当前环境返回 -4，无法用 `convert_pdf` 策略生成新 docx→PDF→text layer
- 已有 docx 任务的 text layer 仍是旧版算法（重生成需 OnlyOffice）

## 模型
Claude MiniMax-M3（MiniMax）
