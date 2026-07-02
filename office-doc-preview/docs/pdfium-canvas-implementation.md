# pdfium Canvas 实现：核心代码详解

## 一、依赖安装

```bash
npm install @aspect-pdf/pdfium
```

---

## 二、后端实现

### server/src/pdfium.mjs

```javascript
import { PDFiumLibrary } from '@aspect-pdf/pdfium';
import fs from 'fs/promises';

let pdfium = null;

/**
 * 初始化 pdfium WASM
 */
export async function initPdfium() {
  if (!pdfium) {
    pdfium = await PDFiumLibrary.load({
      // WASM 文件路径
      wasmBinary: await fs.readFile('./pdfium.wasm')
    });
  }
  return pdfium;
}

/**
 * 渲染页面 + 提取 UDM（同一 scale，坐标对齐）
 */
export async function renderPage(pdfPath, pageNum, scale = 2) {
  const lib = await initPdfium();
  const doc = await lib.openDocument(pdfPath);
  const page = await doc.getPage(pageNum);

  // 获取页面尺寸
  const width = Math.floor(page.getWidth() * scale);
  const height = Math.floor(page.getHeight() * scale);

  // 1. 渲染图像
  const bitmap = await page.render({
    scale,
    format: 'rgba',
  });

  // 2. 提取文本（同一 page 对象，同一 scale）
  const textPage = await page.getTextPage();
  const charCount = await textPage.countChars();

  const chars = [];
  for (let i = 0; i < charCount; i++) {
    const char = await textPage.getChar(i);
    const bbox = await textPage.getCharBox(i);

    chars.push({
      char: char.unicode,
      bbox: [
        bbox.left * scale,
        bbox.top * scale,
        (bbox.right - bbox.left) * scale,
        (bbox.bottom - bbox.top) * scale
      ]
    });
  }

  // 3. 组合成段落
  const paragraphs = groupIntoParagraphs(chars);

  return {
    image: bitmap.data,
    width,
    height,
    udm: {
      pageNum,
      width,
      height,
      scale,
      paragraphs
    }
  };
}

/**
 * 字符组合成段落
 */
function groupIntoParagraphs(chars) {
  const paragraphs = [];
  let current = null;
  const LINE_HEIGHT_TOLERANCE = 5 * chars[0]?.bbox[3] || 15;

  for (const char of chars) {
    // 检测换行（y坐标差异超过容差）
    const isNewLine = !current ||
      Math.abs(char.bbox[1] - current.bbox[1]) > LINE_HEIGHT_TOLERANCE;

    if (isNewLine && current) {
      paragraphs.push(current);
      current = null;
    }

    if (!current) {
      current = {
        paraId: `p${paragraphs.length}-${char.bbox[1].toFixed(0)}`,
        text: '',
        bbox: [char.bbox[0], char.bbox[1], char.bbox[2], char.bbox[3]],
        chars: [],
        style: {}
      };
    }

    current.text += char.char;
    current.chars.push(char);

    // 扩展段落 bbox
    current.bbox[2] = char.bbox[0] + char.bbox[2] - current.bbox[0];
  }

  if (current) {
    paragraphs.push(current);
  }

  // 过滤空段落
  return paragraphs.filter(p => p.text.trim());
}

/**
 * 提取完整文档 UDM
 */
export async function extractUDM(pdfPath) {
  const lib = await initPdfium();
  const doc = await lib.openDocument(pdfPath);
  const pageCount = await doc.getPageCount();

  const pages = [];

  for (let i = 1; i <= pageCount; i++) {
    const result = await renderPage(pdfPath, i, 2);
    pages.push(result.udm);
  }

  return {
    version: '1.0',
    pageCount,
    pages,
    metadata: {
      extractedAt: Date.now(),
      scale: 2
    }
  };
}
```

### server/src/udm-extractor.mjs

```javascript
import { extractUDM } from './pdfium.mjs';
import fs from 'fs/promises';
import path from 'path';

/**
 * 处理文件：转码 + 提取 UDM
 */
export async function processFile(fileId, pdfPath) {
  // 提取 UDM
  const udm = await extractUDM(pdfPath);

  // 保存 UDM
  const udmPath = path.join('.data/derived', fileId, 'udm.json');
  await fs.mkdir(path.dirname(udmPath), { recursive: true });
  await fs.writeFile(udmPath, JSON.stringify(udm, null, 2));

  // 生成缩略图（前3页）
  const thumbnails = [];
  for (let i = 1; i <= Math.min(3, udm.pageCount); i++) {
    const result = await renderPage(pdfPath, i, 1); // 低分辨率缩略图
    const thumbPath = path.join('.data/derived', fileId, `thumb-${i}.png`);

    // 转换为 PNG
    const png = await convertToPNG(result.image, result.width, result.height);
    await fs.writeFile(thumbPath, png);

    thumbnails.push({
      pageNum: i,
      path: `/api/file/${fileId}/thumb-${i}.png`
    });
  }

  return {
    udmPath: `/api/file/${fileId}/udm.json`,
    thumbnails,
    pageCount: udm.pageCount
  };
}

/**
 * ImageData 转 PNG（使用 canvas 或 sharp）
 */
async function convertToPNG(imageData, width, height) {
  // 使用 sharp 或其他库
  // 这里简化处理
  return imageData;
}
```

### server/src/converter.mjs 改造

```javascript
import { convertOfficeToPdf } from './office-converter.mjs';
import { processFile } from './udm-extractor.mjs';

/**
 * 转换文件 + 提取 UDM
 */
export async function convertFile(file) {
  const fileId = file.id;
  const originalPath = file.path;

  // 1. 判断是否需要转码
  const ext = path.extname(originalPath).toLowerCase();
  let pdfPath = originalPath;

  if (['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls'].includes(ext)) {
    // Office 文件转 PDF
    pdfPath = await convertOfficeToPdf(originalPath);
  }

  // 2. 提取 UDM
  const result = await processFile(fileId, pdfPath);

  // 3. 更新任务状态
  await updateTask(fileId, {
    status: 'completed',
    pdfPath: `/api/file/${fileId}.pdf`,
    udmPath: result.udmPath,
    pageCount: result.pageCount,
    thumbnails: result.thumbnails
  });

  return result;
}
```

---

## 三、前端实现

### web/src/workers/pdfium-worker.js

```javascript
import { PDFiumLibrary } from '@aspect-pdf/pdfium';

let pdfium = null;
let currentDoc = null;

// 初始化
async function init() {
  pdfium = await PDFiumLibrary.load();
  self.postMessage({ type: 'ready' });
}

// 加载文档
async function loadDocument(pdfBuffer) {
  currentDoc = await pdfium.openDocument(pdfBuffer);
  const pageCount = await currentDoc.getPageCount();

  self.postMessage({
    type: 'loaded',
    pageCount
  });
}

// 渲染页面
async function renderPage(pageNum, scale) {
  const page = await currentDoc.getPage(pageNum);

  const width = Math.floor(page.getWidth() * scale);
  const height = Math.floor(page.getHeight() * scale);

  const bitmap = await page.render({
    scale,
    format: 'rgba'
  });

  // 发送渲染结果
  self.postMessage({
    type: 'rendered',
    pageNum,
    width,
    height,
    imageData: bitmap.data
  }, [bitmap.data]); // Transferable
}

// 消息处理
self.onmessage = async (e) => {
  const { type, data } = e.data;

  switch (type) {
    case 'init':
      await init();
      break;

    case 'load':
      await loadDocument(data.pdfBuffer);
      break;

    case 'render':
      await renderPage(data.pageNum, data.scale);
      break;
  }
};
```

### web/src/hooks/usePdfium.ts

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';

interface PdfiumWorker {
  ready: boolean;
  pageCount: number;
  renderPage: (pageNum: number, scale: number) => Promise<RenderResult>;
  loadDocument: (pdf: ArrayBuffer) => Promise<void>;
}

interface RenderResult {
  pageNum: number;
  width: number;
  height: number;
  imageData: ImageData;
}

export function usePdfium(): PdfiumWorker {
  const workerRef = useRef<Worker | null>(null);
  const [ready, setReady] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const pendingRef = useRef<Map<string, { resolve, reject }>>(new Map());

  useEffect(() => {
    // 创建 Worker
    workerRef.current = new Worker('/workers/pdfium-worker.js');

    workerRef.current.onmessage = (e) => {
      const { type, ...data } = e.data;

      switch (type) {
        case 'ready':
          setReady(true);
          break;

        case 'loaded':
          setPageCount(data.pageCount);
          const loadResolve = pendingRef.current.get('load');
          if (loadResolve) {
            loadResolve.resolve();
            pendingRef.current.delete('load');
          }
          break;

        case 'rendered':
          const renderResolve = pendingRef.current.get(`render-${data.pageNum}`);
          if (renderResolve) {
            renderResolve.resolve(data);
            pendingRef.current.delete(`render-${data.pageNum}`);
          }
          break;
      }
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const loadDocument = useCallback((pdf: ArrayBuffer) => {
    return new Promise<void>((resolve, reject) => {
      pendingRef.current.set('load', { resolve, reject });
      workerRef.current?.postMessage({
        type: 'load',
        data: { pdfBuffer: pdf }
      }, [pdf]);
    });
  }, []);

  const renderPage = useCallback((pageNum: number, scale: number) => {
    return new Promise<RenderResult>((resolve, reject) => {
      pendingRef.current.set(`render-${pageNum}`, { resolve, reject });
      workerRef.current?.postMessage({
        type: 'render',
        data: { pageNum, scale }
      });
    });
  }, []);

  return {
    ready,
    pageCount,
    loadDocument,
    renderPage
  };
}
```

### web/src/previewers/PdfPreviewPro.tsx

```typescript
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePdfium } from '../hooks/usePdfium';
import { useUDM } from '../hooks/useUDM';
import { UDMOverlay } from '../components/UDMOverlay';
import { SearchHighlight } from '../components/SearchHighlight';

interface Props {
  file: { id: string; url: string };
}

export function PdfPreviewPro({ file }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 状态
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // Hooks
  const { ready, pageCount, loadDocument, renderPage } = usePdfium();
  const { udm, loading } = useUDM(file.id);

  // 加载 PDF
  useEffect(() => {
    if (!ready) return;

    fetch(file.url)
      .then(r => r.arrayBuffer())
      .then(pdf => loadDocument(pdf));
  }, [ready, file.url]);

  // 渲染当前页
  useEffect(() => {
    if (!ready || !udm) return;

    renderPage(currentPage, scale * 2).then(result => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;

      // 设置 canvas 尺寸
      canvasRef.current.width = result.width;
      canvasRef.current.height = result.height;

      // 绘制
      ctx.putImageData(result.imageData, 0, 0);
    });
  }, [ready, currentPage, scale, udm]);

  // 搜索
  const handleSearch = useCallback((keyword: string) => {
    if (!udm || !keyword) {
      setSearchResults([]);
      return;
    }

    const results: SearchResult[] = [];

    for (const page of udm.pages) {
      for (const para of page.paragraphs) {
        const index = para.text.toLowerCase().indexOf(keyword.toLowerCase());
        if (index !== -1) {
          const charWidth = para.bbox[2] / para.text.length;
          results.push({
            paraId: para.paraId,
            pageNum: page.pageNum,
            bbox: [
              para.bbox[0] + index * charWidth,
              para.bbox[1],
              keyword.length * charWidth,
              para.bbox[3]
            ]
          });
        }
      }
    }

    setSearchResults(results);
  }, [udm]);

  // 当前页的 UDM
  const pageUdm = udm?.pages.find(p => p.pageNum === currentPage);
  const currentHighlights = searchResults.filter(r => r.pageNum === currentPage);

  if (loading) {
    return <div className="loading">加载中...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="toolbar flex gap-2 p-2 border-b">
        <input
          type="text"
          placeholder="搜索..."
          value={searchKeyword}
          onChange={e => {
            setSearchKeyword(e.target.value);
            handleSearch(e.target.value);
          }}
        />

        <button onClick={() => setScale(s => s * 1.2)}>
          放大
        </button>
        <button onClick={() => setScale(s => s / 1.2)}>
          缩小
        </button>

        <span className="ml-auto">
          {currentPage} / {pageCount}
        </span>
      </div>

      {/* 渲染区域 */}
      <div
        ref={containerRef}
        className="relative overflow-auto flex-1"
      >
        <div
          className="relative mx-auto"
          style={{
            width: pageUdm?.width * scale / 2,
            height: pageUdm?.height * scale / 2
          }}
        >
          {/* Canvas 层 */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0"
            style={{
              transform: `scale(${scale / 2})`,
              transformOrigin: 'top left'
            }}
          />

          {/* UDM 交互层 */}
          {pageUdm && (
            <UDMOverlay
              paragraphs={pageUdm.paragraphs}
              scale={scale / 2}
              onParagraphClick={(paraId) => {
                console.log('点击段落', paraId);
              }}
            />
          )}

          {/* 搜索高亮 */}
          {currentHighlights.length > 0 && (
            <SearchHighlight
              highlights={currentHighlights}
              scale={scale / 2}
            />
          )}
        </div>
      </div>

      {/* 页面导航 */}
      <div className="page-nav flex gap-1 p-2 border-t justify-center">
        {Array.from({ length: pageCount }, (_, i) => (
          <button
            key={i}
            className={i + 1 === currentPage ? 'active' : ''}
            onClick={() => setCurrentPage(i + 1)}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
```

### web/src/components/UDMOverlay.tsx

```typescript
import { useState } from 'react';

interface Props {
  paragraphs: Paragraph[];
  scale: number;
  onParagraphClick: (paraId: string) => void;
}

export function UDMOverlay({ paragraphs, scale, onParagraphClick }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      className="absolute inset-0"
      style={{
        transform: `scale(${scale})`,
        transformOrigin: 'top left'
      }}
    >
      {paragraphs.map(para => (
        <div
          key={para.paraId}
          className="absolute cursor-pointer transition-colors"
          style={{
            left: para.bbox[0],
            top: para.bbox[1],
            width: para.bbox[2],
            height: para.bbox[3],
            backgroundColor: hovered === para.paraId
              ? 'rgba(59, 130, 246, 0.1)'
              : 'transparent'
          }}
          onMouseEnter={() => setHovered(para.paraId)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => onParagraphClick(para.paraId)}
          title={para.text.slice(0, 50)}
        />
      ))}
    </div>
  );
}
```

### web/src/components/SearchHighlight.tsx

```typescript
interface Props {
  highlights: { paraId: string; bbox: [number, number, number, number] }[];
  scale: number;
}

export function SearchHighlight({ highlights, scale }: Props) {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        transform: `scale(${scale})`,
        transformOrigin: 'top left'
      }}
    >
      {highlights.map((h, i) => (
        <div
          key={`${h.paraId}-${i}`}
          className="absolute bg-yellow-300/40 border border-yellow-500"
          style={{
            left: h.bbox[0],
            top: h.bbox[1],
            width: h.bbox[2],
            height: h.bbox[3]
          }}
        />
      ))}
    </div>
  );
}
```

### web/src/hooks/useUDM.ts

```typescript
import { useState, useEffect } from 'react';

export function useUDM(fileId: string) {
  const [udm, setUdm] = useState<UDM | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetch(`/api/file/${fileId}/udm.json`)
      .then(r => {
        if (!r.ok) throw new Error('UDM not found');
        return r.json();
      })
      .then(data => {
        setUdm(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
      });
  }, [fileId]);

  return { udm, loading, error };
}
```

---

## 四、路由改造

### web/src/previewers/index.tsx

```typescript
import { lazy, Suspense } from 'react';

// 预览器懒加载
const PdfPreviewPro = lazy(() => import('./PdfPreviewPro'));
const ImagePreview = lazy(() => import('./ImagePreview'));
const VideoPreview = lazy(() => import('./VideoPreview'));

// 预览路由
export function PreviewRouter({ file }: Props) {
  const ext = file.name.split('.').pop()?.toLowerCase();

  // PDF 使用新的 Pro 版本
  if (ext === 'pdf') {
    return (
      <Suspense fallback={<Loading />}>
        <PdfPreviewPro file={file} />
      </Suspense>
    );
  }

  // 图片
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    return (
      <Suspense fallback={<Loading />}>
        <ImagePreview file={file} />
      </Suspense>
    );
  }

  // 视频
  if (['mp4', 'webm', 'mov'].includes(ext)) {
    return (
      <Suspense fallback={<Loading />}>
        <VideoPreview file={file} />
      </Suspense>
    );
  }

  // Office 文件（已转码为 PDF）
  if (['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls'].includes(ext)) {
    const pdfFile = {
      ...file,
      url: `/api/file/${file.id}.pdf`,
      name: file.name.replace(/\.[^.]+$/, '.pdf')
    };

    return (
      <Suspense fallback={<Loading />}>
        <PdfPreviewPro file={pdfFile} />
      </Suspense>
    );
  }

  return <div>不支持的格式</div>;
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin">⏳</div>
    </div>
  );
}
```

---

## 五、测试要点

### 1. 坐标对齐验证

```typescript
// 测试：UDM坐标是否与渲染对齐
function testAlignment(pdfPath) {
  const result = renderPage(pdfPath, 1, 2);

  // 获取第一个段落
  const firstPara = result.udm.paragraphs[0];

  // 在 canvas 上点击对应位置
  const clickX = firstPara.bbox[0] + firstPara.bbox[2] / 2;
  const clickY = firstPara.bbox[1] + firstPara.bbox[3] / 2;

  // 应该命中这个段落
  console.log('段落文本:', firstPara.text);
  console.log('点击位置:', clickX, clickY);
}
```

### 2. 缩放测试

```typescript
// 测试：缩放后坐标是否仍然对齐
function testZoomAlignment(pdfPath) {
  const scale1 = renderPage(pdfPath, 1, 1);
  const scale2 = renderPage(pdfPath, 1, 2);

  // 同一段落在不同 scale 下的坐标
  const para1 = scale1.udm.paragraphs[0];
  const para2 = scale2.udm.paragraphs[0];

  // 坐标应该按比例缩放
  console.log('scale=1:', para1.bbox);
  console.log('scale=2:', para2.bbox);
  // para2.bbox 应该约等于 para1.bbox * 2
}
```

### 3. 性能测试

```typescript
// 测试：大文件性能
function testPerformance(pdfPath) {
  const start = Date.now();
  const udm = extractUDM(pdfPath);
  const elapsed = Date.now() - start;

  console.log('提取耗时:', elapsed, 'ms');
  console.log('页数:', udm.pageCount);
  console.log('段落数:', udm.pages.reduce((sum, p) => sum + p.paragraphs.length, 0));
}
```

---

## 六、注意事项

1. **WASM 加载时机**：在 Worker 中初始化，避免阻塞主线程
2. **内存管理**：大文件按页加载，及时释放已渲染页面
3. **缩放策略**：渲染 scale=2，前端 CSS scale 调整显示大小
4. **缓存**：已渲染页面缓存，避免重复渲染
5. **降级**：移动端或 WASM 失败时降级到图片