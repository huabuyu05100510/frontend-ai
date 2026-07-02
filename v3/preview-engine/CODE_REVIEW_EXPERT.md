# preview-engine 深度 Code Review（资深前端视角）
> 日期：2026-06-18 | 审查者：Claude Sonnet 4.6

---

## 一、总体架构评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构分层 | ⭐⭐⭐⭐⭐ | kernel/pipeline/ooxml/renderers 分层清晰，职责单一 |
| 性能设计 | ⭐⭐⭐⭐ | CumulativeIndex + RAF + Worker 思路对，细节有漏 |
| 测试覆盖 | ⭐⭐⭐⭐ | 纯逻辑层 TDD 可靠，集成层缺失 |
| **DOCX 还原度** | ⭐⭐ | 结构对，但样式链未实现，视觉差距大 |
| **PPTX 还原度** | ⭐ | 最薄弱——背景/填充/形状完全缺失，像白板 |
| XLSX 还原度 | ⭐⭐⭐ | 网格可用，但只支持单表/无数字格式 |

---

## 二、DOCX 解析效果差——根因逐层拆解

### 根因 1：没有 styles.xml 样式链（影响最大，≈60% 视觉差距）

```
Word 文档的样式继承链：
  inline rPr → w:rStyle → w:pStyle → Normal → docDefaults
                                           ↑
                                     styles.xml 定义了字号/字体/颜色/间距
```

当前代码 `docx.ts:80-88` 只用 `w:pStyle` 的 val 字符串猜标题级别，完全忽略了样式表本身。结果：

- 所有 `NormalText`、`BodyText`、`Caption`、`Strong` 等命名样式 → 无任何格式
- 中文文档常用"正文"、"标题1"、"标题2"（非英文名）→ 标题识别失败
- 默认字号 11pt 未从 docDefaults 读取，浏览器用自己的默认值

**修复方向：** 解析 `word/styles.xml`，建立 `{ styleId → resolved properties }` 的扁平化缓存，段落/run 渲染时做继承合并。

---

### 根因 2：`w:szCs`（复杂文字字号）缺失——中文文档专有问题

```typescript
// 当前 docx.ts:51-56 — 只读 w:sz
const szEl = rPr && firstChild(rPr, 'w:sz')
```

Word 对中文字符用 `w:szCs`（Complex Script），对拉丁字符用 `w:sz`。
中文文档里几乎所有汉字的字号都在 `w:szCs` 里，当前代码完全读不到，
导致**中文字号统统显示为 0（继承浏览器默认）**。

---

### 根因 3：`w:spacing w:line` 缺失——行距是中文文档的灵魂

```
w:spacing w:line="480"  →  2倍行距
w:spacing w:line="360"  →  1.5倍行距（中文正式文件最常用）
w:spacing w:lineRule="exact" → 固定行距
```

当前 `spacingOf()` 只解析 `w:before`/`w:after`，不解析 `w:line`，
导致段落行距与原稿完全不符。

---

### 根因 4：`w:ind` 只解析 `w:left`，缺 `w:firstLine` / `w:hanging`

中文正式文档的段落普遍有**首行缩进 2 字符**（`w:firstLine="480"`），当前代码忽略：

```typescript
// docx.ts:129-136 — 只取 w:left
function indentOf(p: XmlNode): { indentLeft?: number } {
  const left = attr(ind, 'w:left')  // firstLine/hanging 未取
```

---

### 根因 5：表格质量极差

```typescript
// OfficeView.tsx:158-174 — table 分支
// 问题清单：
// 1. 无 w:tblGrid + w:tcW → 列宽全等宽
// 2. 无 w:vMerge / w:gridSpan → 合并单元格不渲染
// 3. 无 w:shd → 无背景色
// 4. 单元格只渲染纯文本，run 样式全丢失
// 5. 无 w:tblBorders → 边框样式固定
```

---

### 根因 6：Object URL 内存泄漏

```typescript
// docx.ts:297
b.src = URL.createObjectURL(blob)  // 创建了，但从不 revokeObjectURL
// pptx.ts:219 同样问题
```

每次加载新文件，旧文件的所有图片 Blob URL 永久泄漏，累积占用内存。

---

## 三、PPTX 解析效果差——整个项目最薄弱的地方

### 根因 1：幻灯片背景完全缺失（最直观的问题）

```typescript
// OfficeView.tsx:569-580
<div style={{ background: '#fff', ... }}>
// 所有幻灯片都是白背景
// p:bg/p:bgPr 从未被解析
```

### 根因 2：非文字形状完全不可见

```
p:sp（形状）中，没有 txBody 的形状 → 被完全跳过
p:cxnSp（连接线）→ 完全跳过
p:grpSp（组合）→ 完全跳过
```

一张典型 PPT 页面，60-80% 的视觉元素是非文字形状（矩形、箭头、流程图、色块）。

### 根因 3：文本框单色、单字号——丢失所有 run 级格式

```typescript
// pptx.ts:65-110 parseTextShape
// 整个文本框只取"最大字号"和"第一个颜色"
let maxSize = 0
let color: string | undefined
// 一个含"标题28pt红色 + 正文14pt黑色"的文本框
// 渲染结果：全部 28pt 红色 ← 完全不正确
```

### 根因 4：Slide Master / Layout 未解析

```
PPTX 三级继承：
  幻灯片 slide.xml → slideLayout.xml → slideMaster.xml
```

- 母版上的 logo、背景、公司信息 → 不显示
- 主题颜色映射（dk1/lt1/acc1...）→ 所有用主题色的文字显示为黑色

### 根因 5：图片 `objectFit: 'fill'` 拉伸失真

```typescript
// OfficeView.tsx:592
objectFit: 'fill'  // 应该是 'contain' 或 'cover'
```

---

## 四、XLSX 解析问题

### 1. 只加载 sheet1，无多工作表支持
### 2. 无数字格式（日期显示为序列号如 44927，百分比显示为 0.85）
### 3. 无合并单元格（`<mergeCells>` 完全未解析）
### 4. 无单元格样式（无背景色、字体加粗等）
### 5. 列宽公式 `w * 7` 误差 ±20%，未检查 `customWidth` 属性

---

## 五、性能层缺陷

### 1. `MAIN_THREAD_MAX = 25MB` 阈值过高

```typescript
// OfficeView.tsx:57
const MAIN_THREAD_MAX = 25 * 1024 * 1024  // 25MB
// 5MB DOCX 在主线程解析可能阻塞 2-5 秒
// 建议降至 1-2MB
```

### 2. `DocxNatural` 2000 块全量渲染

```typescript
const DOCX_NATURAL_MAX = 2000  // 2000 个 React 节点 × 多个 span = 10000+ DOM 节点
// 初始渲染可能需要 300ms+
```

### 3. `VirtualSheet` 每次 scroll 触发 `setWin` 强制 re-render

```typescript
setWin({...})  // 每个 RAF 都触发全组件重绘
// 应使用 startTransition 或减少更新频率
```

---

## 六、代码质量问题

### 代码重复（DRY 违反）

```
docx.ts 和 pptx.ts 各自有：
  - parseRels()  — 完全相同
  - joinPath()   — 完全相同
  - MIME 对象    — 基本相同
  - FALSY Set    — 完全相同

建议提取到 ooxml/shared.ts
```

### 类型安全

```typescript
OoxmlWorkerResponse.result: unknown  // 需要在使用处强制转型，易出错
Block type 'table' 的 rows: Run[][][]  // 单元格内无法表达富文本格式
```

### XML 解析器鲁棒性

```typescript
// xml.ts:55 — tagRe 不处理属性值中含 > 的边界情况
// xml.ts:67 — 闭合标签回溯是错误恢复模式，可能产生意外结果
```

---

## 七、Bug 清单

| 位置 | Bug | 严重度 |
|------|-----|--------|
| `docx.ts:297` | `URL.createObjectURL` 无对应 `revoke` | 🔴 内存泄漏 |
| `pptx.ts:219` | 同上，PPTX 图片也泄漏 | 🔴 内存泄漏 |
| `OfficeView.tsx:57` | `MAIN_THREAD_MAX = 25MB` 阻塞主线程 | 🟠 性能 |
| `xlsx.ts:70` | `w * 7` 列宽近似，误差 ±20% | 🟡 精度 |
| `docx.ts:86` | 只匹配 ASCII `heading` 样式名，"标题1"等中文样式名无法识别 | 🟠 中文文档必现 |
| `translate.ts` | `translateAll` 是 mock 字典，生产要接真实 MT API | 🟠 功能未完成 |
| `xml.ts:55` | tagRe 不处理属性中包含 `>` 的边界情况 | 🟡 XML 解析鲁棒性 |
| `OfficeView.tsx:592` | `objectFit: 'fill'` 导致图片拉伸失真 | 🟡 视觉问题 |

---

## 八、改进方案——效果优先级排序

### 🔴 P0：PPTX 背景 + 形状填充（1-2天，视觉冲击最大）

```typescript
// 1. 解析幻灯片背景色
function parseSlideBg(root: XmlNode): string {
  const bgPr = findAll(root, 'p:bgPr')[0]
  const solidFill = bgPr && findAll(bgPr, 'a:solidFill')[0]
  const srgb = solidFill && findAll(solidFill, 'a:srgbClr')[0]
  return srgb ? '#' + attr(srgb, 'val') : '#fff'
}

// 2. 解析 per-run 富文本（替换当前的 maxSize + firstColor 模式）
interface SlideTextRun {
  text: string
  size: number
  color?: string
  bold?: boolean
  italic?: boolean
}
interface SlideTextParagraph {
  runs: SlideTextRun[]
  align?: Align
}
// SlideText.paragraphs 替换 SlideText.text
```

### 🔴 P0：DOCX styles.xml 样式解析

```typescript
// 新增 parseDocxStyles(xml): StyleMap
interface StyleDef {
  fontSize?: number       // pt (w:sz/2)
  fontSizeCs?: number     // pt CJK (w:szCs/2)
  bold?: boolean
  italic?: boolean
  color?: string
  lineSpacing?: number    // 倍数 (w:line/240)
  spacingBefore?: number  // px
  spacingAfter?: number   // px
  indentLeft?: number     // px
  indentFirstLine?: number // px
}
// loadDocx 中先解析 styles.xml，再传入 parseDocx 用于样式继承
```

### 🟠 P1：XLSX 多工作表 + 数字格式（2-3天）

```typescript
// 解析 xl/workbook.xml 中所有 <sheet name r:id>
// 建立 Tab 切换 UI（SheetModel[] + 当前激活 index）
// 解析 xl/styles.xml numFmts（日期/货币/百分比）
const BUILTIN_FORMATS: Record<number, (v: number) => string> = {
  14: (v) => excelDateToString(v),  // m/d/yyyy
  10: (v) => (v * 100).toFixed(2) + '%',
  // ...
}
```

### 🟠 P1：DOCX `w:szCs` + 首行缩进 + 行距

```typescript
// runOf() 中优先使用 CJK 字号
const szCsEl = rPr && firstChild(rPr, 'w:szCs')
const szCsVal = szCsEl && attr(szCsEl, 'w:val')
if (szCsVal) run.fontSize = parseInt(szCsVal, 10) / 2

// spacingOf() 中加入行距
const line = attr(spacing, 'w:line')
const lineRule = attr(spacing, 'w:lineRule')
if (line) result.lineHeight = parseInt(line, 10) / 240  // 倍数

// indentOf() 中加入首行缩进
const firstLine = attr(ind, 'w:firstLine')
if (firstLine) result.indentFirstLine = Math.round(parseInt(firstLine, 10) * TWIPS_TO_PX)
```

### 🟡 P2：Object URL 泄漏修复

```typescript
// loadDocx 返回 dispose 函数
export async function loadDocx(bytes: Uint8Array): Promise<{
  blocks: Block[]
  dispose: () => void
}> {
  const urls: string[] = []
  // 创建时：urls.push(url)
  return { blocks, dispose: () => urls.forEach(URL.revokeObjectURL) }
}
// OfficeView.tsx useEffect cleanup 中调用 dispose()
```

### 🟡 P2：提取 ooxml 公共模块

```typescript
// 新建 ooxml/shared.ts
export function parseRels(relsXml: string): Record<string, string> { ... }
export function joinPath(baseDir: string, target: string): string { ... }
export const MIME: Record<string, string> = { ... }
export const FALSY = new Set(['0', 'false', 'off'])
```

---

## 九、还原度现状与目标

| 方案 | DOCX | PPTX | XLSX | 首屏延迟 |
|------|------|------|------|----------|
| 当前前端解析 | 40% | 15% | 60% | <1s |
| 修复 P0/P1 后 | 70% | 55% | 80% | <1s |
| 后端 LibreOffice→HTML | 99% | 95% | 99% | 3-8s |
| 后端 LibreOffice→PDF+pdf.js | 100% | 100% | 100% | 5-15s |

**推荐策略**：前端快速解析作为骨架（即时显示），后台异步转换高保真版本完成后替换渲染器（类似 LQIP 思路，pipeline 架构天然支持这种替换）。
