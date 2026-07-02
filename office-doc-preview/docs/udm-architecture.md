# UDM 统一文档模型：技术架构详解

## 一、设计理念

**核心原则**：
- 所有格式统一转为 PDF
- 渲染和 UDM 用同一引擎（pdfium）
- 坐标系统天然对齐（100%）

**为什么不用多格式各自提取**：
- PDF/DOCX/PPTX 各有坐标系统
- 跨格式坐标校准误差 5-15px
- 维护成本高（每格式一套）

**为什么统一转 PDF 后提取**：
- 单一数据源
- pdfium 同时渲染+提取，坐标对齐
- 代码量少，维护简单

---

## 二、架构图

```
┌─────────────────────────────────────────────────────────┐
│                      文件上传                            │
│  DOCX / PPTX / XLSX / PDF / PNG / MP4 ...              │
└─────────────────────────────────────────────────────────┘
                          ↓
            ┌─────────────┴─────────────┐
            ↓                           ↓
      需要转码                      无需转码
  (Office/图片/视频)              (PDF)
            ↓                           │
    LibreOffice 转 PDF                  │
            ↓                           │
            └─────────────┬─────────────┘
                          ↓
                 pdfium 处理
               ┌─────┴─────┐
               ↓           ↓
          渲染图像      提取UDM
               ↓           ↓
          Canvas      udm.json
               ↓           ↓
            └─────┬───────┘
                  ↓
            前端加载预览
```

---

## 三、UDM 数据结构

```typescript
interface UDM {
  version: string;
  pageCount: number;
  pages: Page[];
  metadata?: {
    title?: string;
    author?: string;
    createdAt?: number;
  };
}

interface Page {
  pageNum: number;
  width: number;   // 页面宽度（像素，scale=2时）
  height: number;  // 页面高度
  scale: number;   // 渲染scale
  paragraphs: Paragraph[];
}

interface Paragraph {
  paraId: string;       // 唯一标识：p1-para3
  text: string;         // 文本内容
  bbox: [x, y, w, h];   // 页面坐标（像素）
  chars: Char[];        // 字符级坐标
  style?: {
    fontSize?: number;
    fontFamily?: string;
    isBold?: boolean;
  };
}

interface Char {
  char: string;
  bbox: [x, y, w, h];
}
```

---

## 四、坐标对齐原理

### 问题：不同引擎坐标不对齐

```
PDF 原始坐标：
- 原点：左下角 (0, 0)
- 单位：point (1/72 英寸)

pdf.js 提取坐标：
- 可能与渲染不一致

pdfium 提取坐标：
- 同一 API，同一 page 对象
- 100% 对齐
```

### 解决方案：单引擎同源提取

```cpp
// pdfium API 示例
FPDF_PAGE page = FPDF_LoadPage(doc, pageNum);

// 渲染
FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0);

// 同一 page 对象提取坐标
FPDF_TEXTPAGE textPage = FPDFText_LoadPage(page);
FPDFText_GetCharBox(textPage, charIndex, &left, &right, &bottom, &top);

// 坐标与渲染 100% 对齐
```

---

## 五、渲染架构

### 三层设计

```
┌─────────────────────────────────────────────┐
│  Canvas 层（pdfium 渲染）                    │
│  - 纯展示                                    │
│  - 矢量渲染，可无损缩放                      │
│  - 保真度 95-99%                             │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  UDM 交互层                                  │
│  - 透明，不可见                              │
│  - paraId 锚点                               │
│  - 用于：选中、点击、锚定                    │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  高亮层                                      │
│  - 搜索结果高亮                              │
│  - 批注标记                                  │
│  - 翻译对照                                  │
└─────────────────────────────────────────────┘
```

### React 实现

```tsx
function PageRenderer({ page }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);

  return (
    <div 
      className="relative"
      style={{ width: page.width * scale, height: page.height * scale }}
    >
      {/* Canvas 层 */}
      <canvas 
        ref={canvasRef}
        width={page.width}
        height={page.height}
        style={{ transform: `scale(${scale})` }}
      />

      {/* UDM 交互层 */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{ transform: `scale(${scale})` }}
      >
        {page.paragraphs.map(p => (
          <div
            key={p.paraId}
            data-para-id={p.paraId}
            className="absolute"
            style={{
              left: p.bbox[0],
              top: p.bbox[1],
              width: p.bbox[2],
              height: p.bbox[3],
            }}
          />
        ))}
      </div>

      {/* 高亮层 */}
      <div className="absolute inset-0 pointer-events-none">
        {highlights.map(h => (
          <HighlightBox 
            key={h.id}
            bbox={h.bbox}
            color={h.color}
          />
        ))}
      </div>
    </div>
  );
}
```

---

## 六、核心功能实现

### 1. 搜索高亮

```typescript
function searchInUDM(udm: UDM, keyword: string): SearchResult[] {
  const results: SearchResult[] = [];
  
  for (const page of udm.pages) {
    for (const para of page.paragraphs) {
      const index = para.text.indexOf(keyword);
      if (index !== -1) {
        // 计算关键词在段落内的精确 bbox
        const charWidth = para.bbox[2] / para.text.length;
        
        results.push({
          paraId: para.paraId,
          pageNum: page.pageNum,
          bbox: [
            para.bbox[0] + index * charWidth,
            para.bbox[1],
            keyword.length * charWidth,
            para.bbox[3]
          ],
          text: para.text.slice(index, index + keyword.length)
        });
      }
    }
  }
  
  return results;
}
```

### 2. 批注锚定

```typescript
interface Annotation {
  id: string;
  paraId: string;        // UDM 锚点
  offsetStart: number;   // 段落内字符起始
  offsetEnd: number;     // 段落内字符结束
  text: string;          // 批注内容
  author: string;
  createdAt: number;
  resolved: boolean;
}

// 渲染批注标记
function renderAnnotation(ann: Annotation, udm: UDM) {
  const para = findParagraph(udm, ann.paraId);
  const charWidth = para.bbox[2] / para.text.length;
  
  return (
    <div
      className="absolute bg-yellow-200"
      style={{
        left: para.bbox[0] + ann.offsetStart * charWidth,
        top: para.bbox[1],
        width: (ann.offsetEnd - ann.offsetStart) * charWidth,
        height: para.bbox[3],
      }}
    >
      <CommentBubble text={ann.text} />
    </div>
  );
}
```

### 3. 翻译对照

```typescript
interface Translation {
  paraId: string;
  original: string;
  translated: string;
  source: 'zh' | 'en';
}

function TranslationOverlay({ trans, udm }: Props) {
  const para = findParagraph(udm, trans.paraId);
  
  return (
    <div
      className="absolute bg-white border-l-2 border-blue-500"
      style={{
        // 显示在原文右侧
        left: para.bbox[0] + para.bbox[2] + 10,
        top: para.bbox[1],
        maxWidth: 300,
      }}
    >
      <p>{trans.translated}</p>
    </div>
  );
}
```

### 4. 文本选中

```typescript
// 透明文本层，可选中
<div className="absolute inset-0">
  {page.paragraphs.map(p => (
    <div
      key={p.paraId}
      className="absolute"
      style={{
        left: p.bbox[0],
        top: p.bbox[1],
        width: p.bbox[2],
        height: p.bbox[3],
      }}
    >
      <span
        className="whitespace-pre select-text"
        style={{
          fontSize: p.style?.fontSize,
          color: 'transparent',  // 透明但可选中
        }}
      >
        {p.text}
      </span>
    </div>
  ))}
</div>
```

---

## 七、存储结构

```
.data/
├── uploads/
│   ├── abc123.docx          # 原始文件
│   └── abc123.pdf           # 转换后 PDF
└── derived/
    └── abc123/
        ├── udm.json         # UDM 数据
        ├── page-1.png       # 缩略图（可选）
        └── annotations.json # 批注数据
```

---

## 八、API 设计

### 后端 API

```
POST /api/upload
→ 返回 { fileId, status: 'converting' }

GET /api/task/:fileId
→ 返回 { status, progress, udmReady }

GET /api/file/:fileId/udm.json
→ 返回完整 UDM

GET /api/file/:fileId.pdf
→ 返回 PDF 文件流

GET /api/file/:fileId/page/:pageNum?scale=2
→ 返回单页渲染（按需加载）
```

### 前端加载

```typescript
// 先加载 UDM（轻量）
const udm = await fetch(`/api/file/${fileId}/udm.json`).then(r => r.json());

// PDF 按页加载
const pdf = await fetch(`/api/file/${fileId}.pdf`).then(r => r.arrayBuffer());

// 渲染第1页
const worker = new PdfiumWorker();
const page1 = await worker.renderPage(pdf, 1, scale);
```

---

## 九、还原度分析

### 图片 vs Canvas 对比

| 维度 | 图片渲染 | Canvas (pdfium) |
|------|---------|-----------------|
| 正常阅读 (100-150%) | ✅ 完美 | ✅ 完美 |
| 放大查看 (200%+) | ❌ 模糊 | ✅ 矢量无损 |
| 文字边缘 | 像素化 | 矢量锐利 |
| 线条/图表 | 锯齿 | 矢量平滑 |
| 矢量图形 | 栅格化 | 保持矢量 |
| 高DPI屏幕 | 需高分辨率图 | 自动适配 |

### 选择 Canvas 的原因

**项目定位**："极致体验及性能"、"对标顶尖技术"

- 还原度要求 95-99%
- 需要支持缩放查看细节
- 工程图纸/设计稿需要高保真

**结论**：pdfium Canvas 为主 + 图片降级

---

## 十、性能优化

### 1. 按页加载

```typescript
// 只加载可见页
<VirtualList
  items={udm.pages}
  renderItem={(page) => (
    <LazyPage page={page} pdf={pdf} />
  )}
/>
```

### 2. Web Worker

```typescript
// pdfium 在 worker 中运行，不阻塞 UI
const worker = new Worker('/workers/pdfium-worker.js');
worker.postMessage({ type: 'render', pdf, pageNum, scale });
```

### 3. 缓存策略

```typescript
// 已渲染页面缓存
const pageCache = new Map<string, ImageData>();

async function renderPage(pageNum, scale) {
  const key = `${pageNum}-${scale}`;
  if (pageCache.has(key)) {
    return pageCache.get(key);
  }
  
  const result = await worker.render(pageNum, scale);
  pageCache.set(key, result);
  return result;
}
```

---

## 十一、降级策略

```tsx
function PreviewRenderer({ file }: Props) {
  const [mode, setMode] = useState<'canvas' | 'image'>('canvas');

  // Canvas 失败时降级到图片
  const handleError = () => {
    setMode('image');
  };

  // 移动端直接用图片
  if (isMobile()) {
    return <ImageRenderer file={file} />;
  }

  if (mode === 'canvas') {
    return (
      <ErrorBoundary fallback={<ImageRenderer file={file} />}>
        <PdfiumCanvas file={file} onError={handleError} />
      </ErrorBoundary>
    );
  }

  return <ImageRenderer file={file} />;
}
```