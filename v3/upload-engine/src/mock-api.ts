// ============================================================
// Mock API — 模拟服务端行为，演示完整上传流程
// 生产环境替换为真实接口即可
// 支持在线预览：存储上传文件，通过 /api/preview/:hash 返回
// ============================================================

const KNOWN_HASHES = new Set<string>()
const uploadedChunks = new Map<string, Set<number>>()
const fileStore = new Map<string, { blob: Blob; name: string; type: string }>()

const MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm',
  avi: 'video/x-msvideo', m4v: 'video/mp4', flv: 'video/x-flv', wmv: 'video/x-ms-wmv', ts: 'video/mp2t',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  aac: 'audio/aac', wma: 'audio/x-ms-wma', pcm: 'audio/l16', amr: 'audio/amr',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  json: 'application/json', xml: 'application/xml', html: 'text/html', htm: 'text/html',
  css: 'text/css', js: 'text/javascript',
  jsx: 'text/javascript', tsx: 'text/typescript',
  py: 'text/x-python', java: 'text/x-java', go: 'text/x-go', rs: 'text/x-rust',
  yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain',
  ini: 'text/plain', cfg: 'text/plain', log: 'text/plain', srt: 'text/plain',
  sql: 'text/plain', sh: 'text/x-shellscript', bash: 'text/x-shellscript', zsh: 'text/x-shellscript',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation', rtf: 'application/rtf',
}

function getMime(fileName: string, fileType: string): string {
  if (fileType && fileType !== 'application/octet-stream') return fileType
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return MIME_MAP[ext] || 'application/octet-stream'
}

export function setupMockAPI(): () => void {
  // ---- 拦截 fetch（秒传检查 + 合并请求 + 预览下载） ----
  const originalFetch = window.fetch

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? 'GET'

    // ---- 在线预览下载 ----
    if (url.includes('/api/preview/') && method === 'GET') {
      const hash = url.split('/api/preview/')[1]
      const stored = fileStore.get(hash)
      if (stored) {
        await delay(100 + Math.random() * 200)
        const mime = getMime(stored.name, stored.type)
        return new Response(stored.blob, {
          status: 200,
          headers: {
            'Content-Type': mime,
            'Cache-Control': 'public, max-age=3600',
            'X-File-Hash': hash,
          },
        })
      }
      return new Response('Not Found', { status: 404 })
    }

    if (url.includes('/api/upload/check') && method === 'POST') {
      const body = JSON.parse(init?.body as string ?? '{}')
      await delay(200 + Math.random() * 300)
      if (KNOWN_HASHES.has(body.hash)) {
        return jsonResponse(200, { url: `/api/preview/${body.hash}`, instant: true })
      }
      return jsonResponse(404, { instant: false })
    }

    // 网络探测（HEAD 测 RTT）
    if (url.includes('/api/upload') && method === 'HEAD') {
      await delay(30 + Math.random() * 70)
      return new Response(null, { status: 200 })
    }

    // 带宽探测（POST 128KB 测上行）
    if (url.includes('/api/upload/probe') && method === 'POST') {
      await delay(200 + Math.random() * 300)
      return jsonResponse(200, { ok: true })
    }

    if (url.includes('/api/upload/merge') && method === 'POST') {
      const body = JSON.parse(init?.body as string ?? '{}')
      await delay(500 + Math.random() * 1000)
      KNOWN_HASHES.add(body.hash)
      uploadedChunks.delete(body.hash)
      return jsonResponse(200, { url: `/api/preview/${body.hash}`, merged: true })
    }

    return originalFetch.call(window, input, init)
  }) as typeof fetch

  // ---- 拦截 XHR（直传 + 分片上传进度） ----
  const OriginalXHR = window.XMLHttpRequest

  const XHRMock = function (this: XMLHttpRequest) {
    const xhr = new OriginalXHR()
    const originalOpen = xhr.open
    const originalSend = xhr.send

    let _url = ''
    let _method = ''

    xhr.open = function (method: string, url: string, ...args: any[]) {
      _method = method
      _url = url
      return (originalOpen as Function).apply(xhr, [method, url, ...args])
    } as any

    xhr.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      if (_url.includes('/api/upload') && !_url.includes('/chunk') && !_url.includes('/check') && !_url.includes('/merge') && _method === 'POST') {
        const form = body as FormData
        const file = form.get('file') as File
        const hash = form.get('hash') as string

        // 存储文件用于在线预览
        if (file && hash) {
          fileStore.set(hash, { blob: file, name: file.name, type: getMime(file.name, file.type) })
          KNOWN_HASHES.add(hash)
        }

        simulateProgress(xhr, 1000 + Math.random() * 2000).then(() => {
          fireXHRLoad(xhr, 200, JSON.stringify({ url: `/api/preview/${hash}` }))
        })
        return
      }

      if (_url.includes('/api/upload/chunk') && _method === 'POST') {
        const form = body as FormData
        const hash = form.get('hash') as string
        const index = parseInt(form.get('index') as string, 10)
        const total = parseInt(form.get('total') as string, 10)
        const chunk = form.get('chunk') as File

        // 存储分片数据
        if (!uploadedChunks.has(hash)) uploadedChunks.set(hash, new Set())
        uploadedChunks.get(hash)!.add(index)

        // 首次收到分片时记录文件信息
        if (chunk && !fileStore.has(hash)) {
          fileStore.set(hash, { blob: chunk, name: `chunked_${hash}`, type: chunk.type })
        }

        simulateProgress(xhr, 300 + Math.random() * 600).then(() => {
          fireXHRLoad(xhr, 200, JSON.stringify({ ok: true, index }))
        })
        return
      }

      return (originalSend as Function).apply(xhr, [body])
    } as any

    return xhr
  } as any

  window.XMLHttpRequest = XHRMock as any

  return () => {
    window.fetch = originalFetch
    window.XMLHttpRequest = OriginalXHR
  }
}

function simulateProgress(xhr: XMLHttpRequest, duration: number): Promise<void> {
  return new Promise(resolve => {
    const startTime = Date.now()
    const total = 100
    const tick = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const loaded = Math.round(progress * total)
      const event = new ProgressEvent('progress', { lengthComputable: true, loaded, total })
      if (xhr.upload) {
        // @ts-ignore
        xhr.upload.onprogress?.(event)
      }
      if (progress >= 1) {
        resolve()
      } else {
        setTimeout(tick, 50 + Math.random() * 100)
      }
    }
    tick()
  })
}

function fireXHRLoad(xhr: XMLHttpRequest, status: number, responseText: string) {
  Object.defineProperty(xhr, 'status', { value: status, writable: true })
  Object.defineProperty(xhr, 'readyState', { value: 4, writable: true })
  Object.defineProperty(xhr, 'responseText', { value: responseText, writable: true })
  // @ts-ignore
  xhr.onload?.()
}

function jsonResponse(status: number, data: object) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}