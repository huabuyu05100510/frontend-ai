import { loadDocx } from './docx'
import { loadXlsx } from './xlsx'
import { loadPptx } from './pptx'

// ============================================================================
// ooxml.worker — 在 Worker 中解析 DOCX/XLSX/PPTX，避免大文件阻塞主线程
//   通过 Transferable ArrayBuffer 零拷贝传输字节给 Worker。
// ============================================================================

export type OoxmlWorkerRequest =
  | { type: 'docx'; buffer: ArrayBuffer }
  | { type: 'xlsx'; buffer: ArrayBuffer }
  | { type: 'pptx'; buffer: ArrayBuffer }

export type OoxmlWorkerResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: string }

self.onmessage = async (e: MessageEvent<OoxmlWorkerRequest>) => {
  const { type, buffer } = e.data
  try {
    const bytes = new Uint8Array(buffer)
    const result =
      type === 'docx' ? await loadDocx(bytes)
      : type === 'xlsx' ? await loadXlsx(bytes)
      : await loadPptx(bytes)
    const response: OoxmlWorkerResponse = { ok: true, result }
    self.postMessage(response)
  } catch (err) {
    const response: OoxmlWorkerResponse = { ok: false, error: String(err instanceof Error ? err.message : err) }
    self.postMessage(response)
  }
}
