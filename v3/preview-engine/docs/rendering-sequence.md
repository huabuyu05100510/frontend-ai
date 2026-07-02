# PDF 分片渲染时序图

```mermaid
sequenceDiagram
    participant U as 用户
    participant PV as PdfViewer
    participant S as 服务端 (server.mjs)
    participant PJ as pdf.js (Worker)

    Note over U,S: ═══ 阶段 1: 预取关键数据（并行） ═══

    U->>PV: 点击「开始分片加载」
    PV->>S: HEAD /pdf/{id}.pdf
    PV->>S: Range: bytes=0-1048575 (首 1MB)
    PV->>S: Range: bytes=fileSize-5MB ~ fileSize-1 (尾 5MB)

    par 并行响应
        S-->>PV: Content-Length: 172338016
        S-->>PV: 206 首 1MB 数据
        S-->>PV: 206 尾 5MB 数据
    end

    Note over PV: 首尾数据存入内存缓存<br/>firstChunk(1MB) + lastChunk(5MB)

    Note over U,S: ═══ 阶段 2: 文档解析（内存缓存命中） ═══

    PV->>PJ: getDocument({ range: transport, length })
    activate PJ

    PJ->>PV: requestDataRange(0, 65536) 要 header
    Note over PV: 命中 firstChunk 缓存<br/>同步返回，零网络延迟
    PV-->>PJ: onDataRange(0, headerChunk)

    PJ->>PV: requestDataRange(172294144, 172338016) 要 xref
    Note over PV: 命中 lastChunk 缓存<br/>同步返回，零网络延迟
    PV-->>PJ: onDataRange(172294144, xrefChunk)

    PJ->>PV: requestDataRange(172163072, 172228608) 要 xref 段
    Note over PV: 命中 lastChunk 缓存<br/>同步返回
    PV-->>PJ: onDataRange(172163072, xrefChunk)

    Note over PJ: 解析 PDF 结构<br/>header + xref + page tree

    PJ-->>PV: .promise resolved
    deactivate PJ

    Note over U,S: ═══ 阶段 3: 首屏渲染 ═══

    PV->>PJ: doc.getPage(1)
    activate PJ
    PJ-->>PV: page 1
    deactivate PJ

    PV->>PJ: page.getViewport({ scale: 1 })
    PJ-->>PV: viewport size

    PV->>PV: setPageSizes([firstSize, ...])<br/>setPhase('ready')

    Note over PV: 首屏可见！⏱ 计时停止

    Note over U,S: ═══ 阶段 4: 页面按需渲染（IntersectionObserver） ═══

    loop 每页进入可视区
        Note over PV: IntersectionObserver<br/>rootMargin: 800px
        PV->>PJ: page.getPage(i)
        PJ-->>PV: page i
        PV->>PJ: page.render({ canvasContext, viewport })
        Note over PJ: 渲染到 canvas<br/>可能触发更多 requestDataRange 调用
        PJ->>PV: requestDataRange(...) 页面资源
        alt 命中缓存
            PV-->>PJ: 内存缓存直接返回
        else 未命中
            PV->>S: Range: bytes=...
            S-->>PV: 206 分片数据
            PV-->>PJ: onDataRange(...)
        end
        PJ-->>PV: render complete
    end

    Note over U,S: ═══ 对比：全量加载模式 ═══

    rect rgb(255, 240, 200)
        Note over U,S: Full 模式（右侧面板）
        PV->>S: fetch /pdf/{id}.pdf (无 Range 头)
        S-->>PV: 200 全部 164MB
        Note over PV: 等待全部下载完成...
        PV->>PJ: getDocument({ data: buffer })
        PJ-->>PV: .promise resolved
        Note over PV: 首屏可见（但已下载全部 164MB）
    end
```

## 关键优化点

| 优化 | 说明 |
|------|------|
| 并行预取 | HEAD + 首 1MB + 尾 5MB 同时发起，减少串行等待 |
| 内存缓存 | 首尾数据驻留内存，pdf.js 请求时同步返回，零网络延迟 |
| PDFDataRangeTransport | 接管所有网络请求，确保每条请求都带 Range 头 |
| URL 直接加载 | pdf.js 通过 url 参数发起 Range 请求（206 Partial Content） |
| IntersectionObserver | 仅渲染可见页 ±800px，按需加载页面资源 |

## 为什么之前慢

```
pdf.js 需要 xref 表 → 发 Range 请求 → 等网络 → 回来 → 还需要下一段 xref → 再发请求 → 再等...
                                        ↑
                                    几十次往返 = 3-4 秒
```

现在 xref 表已经在内存里，pdf.js 要什么直接给，零等待。