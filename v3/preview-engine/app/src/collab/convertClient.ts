// ============================================================================
// convertClient — 旧版二进制 Office 的服务端转换客户端
//   POST 原始字节到本地 /convert，得到 OOXML 字节(base64) 或直接的 sheet model。
// ============================================================================

export interface ConvertSheetModel {
  name: string
  rows: number
  cols: number
  cells: { r: number; c: number; text: string }[]
}

export interface ConvertResult {
  ok: boolean
  format?: 'ooxml' | 'model'
  realType?: string
  base64?: string
  kind?: string
  model?: ConvertSheetModel
  via?: string
  reason?: string
  install?: string
}

const BASE_URL =
  typeof location !== 'undefined' && (location as Location).protocol === 'https:'
    ? 'https://localhost:8787'
    : 'http://localhost:8787'

export { BASE_URL }

const DEFAULT_ENDPOINT = BASE_URL + '/convert'

export async function convertLegacy(bytes: Uint8Array, ext: string, endpoint = DEFAULT_ENDPOINT): Promise<ConvertResult> {
  const res = await fetch(`${endpoint}?ext=${encodeURIComponent(ext)}`, {
    method: 'POST',
    body: bytes as BodyInit,
  })
  return (await res.json()) as ConvertResult
}

export interface PdfConvertResult {
  ok: boolean
  url?: string
  reason?: string
  install?: string
}

/** DOCX/XLSX/PPTX/DOC/XLS/PPT → PDF URL（服务端 LibreOffice 转换，流式加载） */
export async function convertToPdf(bytes: Uint8Array, ext: string): Promise<PdfConvertResult> {
  const res = await fetch(`${BASE_URL}/convert-pdf?ext=${encodeURIComponent(ext)}`, {
    method: 'POST',
    body: bytes as BodyInit,
  })
  return (await res.json()) as PdfConvertResult
}

/** 上传 PDF 到服务端 /upload-pdf，返回服务端 URL（支持 Range 请求） */
export async function uploadPdf(bytes: Uint8Array): Promise<PdfConvertResult> {
  const res = await fetch(`${BASE_URL}/upload-pdf`, {
    method: 'POST',
    body: bytes as BodyInit,
  })
  return (await res.json()) as PdfConvertResult
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
