# 行业顶尖文档预览/编辑方案调研

> 日期：2026-06-18

---

## 一、行业格局概览


| 产品                      | 技术路线                        | 还原度  | 编辑能力 |
| ----------------------- | --------------------------- | ---- | ---- |
| Microsoft Office Online | 服务端 Word 引擎 + 客户端 Canvas 渲染 | 100% | 完整   |
| Google Docs             | 完全自研 JS 排版引擎 + Canvas       | ~95% | 完整   |
| Collabora Online        | LibreOffice headless + 瓦片流  | 99%  | 完整   |
| WPS 网页版                 | C++ WPS 引擎 → SVG/Canvas 指令流 | ~98% | 完整   |
| 腾讯文档                    | 类 Google Docs 自研 Canvas 引擎  | ~90% | 完整   |
| Dropbox/Box 预览          | 服务端转 PDF + pdf.js           | ~95% | 不支持  |


---

## 二、Microsoft Office Online 技术架构

```
用户浏览器                         Azure WAC 服务
    │                                   │
    │  上传 DOCX                        │
    │ ────────────────────────────────→ │
    │                          真实 Word C++ 引擎处理
    │                          ↓
    │                     预计算全文档 Layout
    │                     (段落位置/行宽/分页点/字形坐标)
    │                          ↓
    │  ←── 流式传输 Layout JSON + 字形坐标 ──
    │
    │  客户端：
    │  Canvas 2D 按精确坐标绘制字形
    │  编辑操作 → 发回服务端 → 重算脏区域 → 推送差量
```

**核心秘密：** 服务端跑真实 Word 排版引擎（C++ native），客户端只是"显示终端"。
文字位置是由服务端精确计算后下发的，浏览器只负责 Canvas drawText。

---

## 三、Google Docs 技术架构

Google 没有使用任何 Office 代码，从零用 JavaScript 重写了整个排版引擎。

### 核心技术栈

```
1. 自定义 Document Model（不是 DOM）
   └─ 内存中维护: ParagraphElement → LineBox → GlyphRun
   └─ 与 HTML DOM 完全解耦

2. Knuth-Plass 最优断行算法
   └─ 全局最优化：考虑整个段落的视觉均衡
   └─ 对比 CSS 的贪心断行（填满一行就换），视觉质量更高
   └─ 这是 Google Docs 段落看起来比浏览器渲染"舒适"的根本原因

3. Canvas 2D 渲染（不是 HTML/CSS）
   └─ 精确控制每个字形的像素位置和间距
   └─ 字体度量缓存：预加载字体后用 measureText() 建立字形宽度表
   └─ 绕过浏览器文字布局，完全自控

4. 增量布局
   └─ 只重排从"脏段落"往后的内容
   └─ 视口外的段落缓存布局结果，不重绘
   └─ 100 万字文档修改一个字 → 只重算受影响的几段

5. 协同：OT → CRDT（迁移中）
   └─ 操作转换保证最终一致性
   └─ 乐观更新：本地先应用，服务端确认后 reconcile
```

### 为什么 CSS 永远无法完美还原 Word

```
Office Word 排版              CSS 排版（浏览器）
─────────────────            ─────────────────────────
Knuth-Plass 全局最优断行  vs  贪心行填充（greedy）
精确字形间距控制（kerning）vs  由 OS 字体引擎决定
分页算法（孤行/寡行控制）  vs  CSS 无分页概念
段前/段后间距折叠规则      vs  margin collapse 规则不同
复杂列表编号继承            vs  CSS counter 简化版
文字绕图（锚定对象）        vs  float 行为不兼容

结论：即使 XML 解析 100% 正确，
      CSS 渲染出来的换行点仍和 Word 不同，
      导致整个文档的行位置全部漂移。
```

### 字体是最大的精度瓶颈

```
Word 里"宋体 12pt 第3行结尾"的位置取决于：
  字形宽度 → 依赖 font hinting（操作系统级别）
  字距     → 依赖 kerning 表（字体文件内）
  字形渲染 → 依赖 ClearType 亚像素算法

浏览器里同一段文字：
  字形宽度 → 浏览器自己的字体栅格化引擎
  字距     → CSS letter-spacing（粗粒度）
  字形渲染 → 由 OS 字体子系统决定（macOS/Windows 结果不同）

结论：同一份文档在 macOS Chrome 和 Windows Edge 里
      CSS 渲染的换行位置可能不同。
```

---

## 四、LibreOffice Online / Collabora（最有参考价值的开源方案）

### 方案 A：服务端 Tile 渲染

```
服务端 LibreOffice 进程
   ↓
文档分割成 256×256 像素瓦片
   ↓
每块瓦片渲染为 PNG（真实 LibreOffice 渲染）
   ↓
WebSocket 流式推送到浏览器那么OK
   ↓
浏览器用 Canvas 合并瓦片（类似地图引擎 OpenLayers/Leaflet）
   ↓
用户编辑 → 发送事件到服务端 → 服务端重渲染脏瓦片 → 推送差量瓦片
```

**优点：** 像素级保真，支持所有 LibreOffice 能打开的格式（.doc/.docx/.odt/.ppt 等）
**缺点：** 需要常驻服务端进程，延迟比纯客户端高

### 方案 B：WASM LibreOffice（真正浏览器内运行）

```
LibreOffice C++ 源码
   ↓ emscripten 编译
.wasm（约 40MB gzip 后）
   ↓ 浏览器加载
完全离线运行真实 LibreOffice
完全像素级保真，支持编辑
无需服务器
```

**已有开源实现：** [allotropia/mobileapp](https://github.com/allotropia/mobileapp)（前身 Collabora Online）

**缺点：** 首次加载 40MB+（可按需分块加载），内存占用高

---

## 五、国内顶尖方案（WPS/腾讯/金山）

### WPS 网页版（推断）

```
1. 服务端：C++ WPS 引擎 → 渲染为分页 SVG/Canvas 指令流
2. 客户端：接收指令流 → WebGL 合成渲染
3. 字体：自建字体 CDN，按需子集化（font subsetting）推送
4. 编辑：客户端维护轻量编辑 AST，操作先本地应用（乐观更新）
         再 WebSocket 同步服务端确认
```

### 腾讯文档

```
1. 类 Google Docs 路线：完全自研 Canvas 渲染引擎
2. WebWorker 并行化：
   - 布局计算在 Worker
   - 光栅化在 OffscreenCanvas Worker
   - 主线程只做事件处理
3. 中文字体处理：自研字体渲染，绕过系统字体渲染差异
4. CRDT 协同（类似 Yjs）
```

---

## 六、编辑能力与高保真渲染的矛盾及解决方案

### 核心矛盾

```
DOCX/PPTX ──→ PDF   ✅ 像素级还原OK
                    ❌ 失去结构信息（段落/run/样式树）
                    ❌ 无法直接改文本
```

### 解决方案：双轨分离架构

```
原始文件 (DOCX)
    │
    ├──── 显示轨道 ────→ LibreOffice → PDF → pdf.js 渲染（高保真）
    │                                              ↕ 叠加层
    └──── 编辑轨道 ────→ OOXML 解析 → 结构化 AST → 编辑操作
                                                    ↓
                                              保存回 OOXML
```

### 三种具体实现方案

**方案 A：注解层编辑（成本最低，preview-engine 已有基础）**

```
PDF 渲染层（底层，只读）
    ↕
Annotation Overlay（高亮/批注/签名/盖章）← PdfEditor.tsx 已实现
    ↕
CRDT CollabDoc 同步 ← ColladDoc.ts 已实现
```

适合：文档审阅、协同标注场景

**方案 B：HTML 中间格式（推荐，平衡最好）**

```
DOCX ──→ LibreOffice ──→ HTML（带内嵌图片 CSS）
                              ↓
              ProseMirror / Tiptap 导入 HTML 进行编辑
                              ↓
              用户编辑 → 导出 HTML
                              ↓
              pandoc / LibreOffice → 写回 DOCX
```

服务端接口：

```javascript
// 转 HTML（显示+编辑两用）
soffice --headless --convert-to 'html:XHTML Writer File Filter,EmbedImages=1'

// HTML 写回 DOCX（保存）
pandoc -f html -t docx -o output.docx input.html
```

适合：需要改文字/格式 + 高保真显示

**方案 C：结构化 Round-trip（最高保真，成本最高）**

```
DOCX
  ↓ 解析
Block[] AST（当前已有）
  ↓ 用户编辑（修改 AST）
  ↓ 序列化回 DOCX XML（需新增 serializeDocx）
  ↓ LibreOffice 重新转 PDF
  ↓ 高保真 PDF 视图更新
```

适合：需要改内容后导出完美 DOCX

---

## 七、对 preview-engine 的落地建议

### 阶段演进路径

```
阶段1（1-2周）—— 立竿见影
──────────────────────────
后端加 LibreOffice tile 渲染服务（server.mjs 扩展）
前端改造成 tile 拼接显示（类地图引擎）
→ 立刻获得 99% 还原度
→ 与当前前端解析并存，作为"高保真模式"切换

阶段2（1-2月）—— 完整编辑
──────────────────────────
引入 Collabora Online 开源版（AGPL/商业双授权）
作为后端渲染+编辑服务
前端通过 WebSocket 接入标准协议
→ 完整编辑能力，与桌面 LibreOffice 一致
→ 支持 .doc/.xls/.ppt 等老格式

阶段3（可选，6月+）—— 离线能力
──────────────────────────────
WASM LibreOffice 客户端内嵌
→ 离线可用，无服务器依赖
→ 40MB+ bundle，ServiceWorker 缓存，PWA 形态
```

### 最诚实的结论

> 行业顶尖效果的核心不是"更好地解析 XML"，
> 而是**绕过 XML 解析问题**——要么用原生引擎（LibreOffice/Word）直接渲染，
> 要么像 Google 一样投入数百工程师重写整个排版引擎。
>
> 对于大多数产品，**LibreOffice headless/WASM** 是性价比最高的"顶尖还原度"方案，
> 而不是自己实现 XML 解析器。
>
> 自研 OOXML 解析器的价值在于：轻量快速的预览骨架（秒级首屏）、
> 文本可复制/可翻译、无服务依赖。两者结合是最优解。

### 最终架构建议

```
用户上传文件
    │
    ├─── 立即响应（<1s）──→ 前端 OOXML 解析
    │                        ↓ 骨架预览（文字/结构可见）
    │                        ↓ 可复制/可搜索/可翻译
    │
    └─── 后台转换（3-8s）→ 服务端 LibreOffice → HTML/PDF
                             ↓ 转换完成后替换渲染器
                             ↓ 高保真视觉（99%+）
                             ↓ 结果缓存（Redis/OSS），下次秒开
```

这种"先骨架后高保真"的渐进增强模式，与项目现有的
`ProgressiveLoader`（skeleton → lqip → hires）架构理念完全一致。

---

## 参考资源

- [Collabora Online (开源 LibreOffice 网页版)](https://github.com/CollaboraOnline/online)
- [allotropia mobileapp (WASM LibreOffice)](https://github.com/allotropia/mobileapp)
- [Google Docs 技术博客](https://drive.googleblog.com/)
- [ProseMirror (富文本编辑器内核)](https://prosemirror.net/)
- [Tiptap (基于 ProseMirror 的框架)](https://tiptap.dev/)
- [pdf-lib (前端 PDF 生成/修改)](https://pdf-lib.js.org/)

