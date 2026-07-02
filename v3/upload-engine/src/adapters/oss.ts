// ============================================================
// 阿里云 OSS 存储适配器 —— PostObject 表单直传
//   仅需后端用 AK/SK 签一个 policy（无需 STS/RAM 角色），
//   适合试用账号快速跑通。密钥永远只在后端，前端拿签名直传。
//   文档：https://help.aliyun.com/zh/oss/use-cases/uploading-objects-to-oss-directly-from-web-applications
// ============================================================

import type { StorageAdapter, StorageUploadCtx } from '../types'

/** 后端 /policy 接口返回结构 */
export interface OSSPolicyResponse {
  host: string            // 如 https://my-bucket.oss-cn-hangzhou.aliyuncs.com
  dir: string             // 目录前缀，如 uploads/
  key: string             // 最终对象 key，如 uploads/2026/xxx.png
  policy: string          // base64 policy
  signature: string       // base64(HMAC-SHA1)
  OSSAccessKeyId: string
  publicRead: boolean     // 桶是否公共读
}

export interface OSSAdapterOptions {
  /** 后端签名接口：GET ?filename= → OSSPolicyResponse */
  policyUrl: string
  /** 私有桶回显签名接口：GET ?key= → { url } */
  signGetUrl?: string
  /** 透传到 policy 接口的额外查询参数（如业务标识） */
  extraQuery?: Record<string, string>
}

export function createOSSAdapter(opts: OSSAdapterOptions): StorageAdapter {
  return {
    name: 'aliyun-oss',
    async upload(file: File, ctx: StorageUploadCtx): Promise<{ url: string }> {
      const meta = await fetchPolicy(file, opts, ctx.signal)

      const form = new FormData()
      // key 必须在 file 之前
      form.append('key', meta.key)
      form.append('OSSAccessKeyId', meta.OSSAccessKeyId)
      form.append('policy', meta.policy)
      form.append('Signature', meta.signature)
      form.append('success_action_status', '200')
      if (file.type) form.append('Content-Type', file.type)
      form.append('file', file)

      await xhrPost(meta.host, form, ctx.onProgress, ctx.signal)

      // 回显 URL：公共读直接拼，私有桶走后端签名 GET
      let url = `${meta.host}/${encodeURI(meta.key)}`
      if (!meta.publicRead && opts.signGetUrl) {
        url = await fetchSignedGet(opts.signGetUrl, meta.key, ctx.signal)
      }
      return { url }
    },
  }
}

async function fetchPolicy(
  file: File,
  opts: OSSAdapterOptions,
  signal?: AbortSignal,
): Promise<OSSPolicyResponse> {
  const params = new URLSearchParams({ filename: file.name, ...opts.extraQuery })
  const sep = opts.policyUrl.includes('?') ? '&' : '?'
  const resp = await fetch(`${opts.policyUrl}${sep}${params.toString()}`, { signal })
  if (!resp.ok) throw new Error(`获取 OSS 签名失败：HTTP ${resp.status}`)
  return resp.json()
}

async function fetchSignedGet(
  signGetUrl: string,
  key: string,
  signal?: AbortSignal,
): Promise<string> {
  const sep = signGetUrl.includes('?') ? '&' : '?'
  const resp = await fetch(`${signGetUrl}${sep}key=${encodeURIComponent(key)}`, { signal })
  if (!resp.ok) throw new Error(`获取签名 URL 失败：HTTP ${resp.status}`)
  const data = await resp.json()
  return data.url
}

function xhrPost(
  url: string,
  form: FormData,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    signal?.addEventListener('abort', () => {
      xhr.abort()
      reject(new DOMException('Aborted', 'AbortError'))
    })
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100)
        resolve()
      } else {
        reject(new Error(`OSS 直传失败：HTTP ${xhr.status} ${xhr.responseText?.slice(0, 200) ?? ''}`))
      }
    }
    xhr.onerror = () => reject(new Error('OSS 直传网络错误（检查 Bucket CORS 配置）'))
    xhr.ontimeout = () => reject(new Error('OSS 直传超时'))
    xhr.open('POST', url)
    xhr.send(form)
  })
}
