import type { UploadConfig } from './types'
import { validateMagic } from './magic'

export interface ValidationError {
  file: string
  code: 'magic' | 'format' | 'size' | 'dimension' | 'count'
  message: string
}

/** 四级校验：魔数→扩展名→大小→图片尺寸 */
export async function validateFiles(
  files: File[],
  config: UploadConfig,
  existingCount: number = 0,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = []

  if (existingCount + files.length > config.maxCount) {
    errors.push({
      file: `(${files.length} 个文件)`,
      code: 'count',
      message: `单次最多上传 ${config.maxCount} 个文件，当前已有 ${existingCount} 个`,
    })
  }

  // 通配符模式：accept 含 '*' → 全格式放行，跳过魔数 + 扩展名白名单
  const acceptAll = config.accept.includes('*')

  for (const file of files) {
    if (!acceptAll) {
      // 1. 魔数校验（安全第一道防线）
      const magic = await validateMagic(file)
      if (!magic.valid) {
        errors.push({
          file: file.name,
          code: 'magic',
          message: magic.reason ?? '文件签名不匹配',
        })
        continue
      }

      // 2. 扩展名白名单
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      if (!config.accept.includes(ext)) {
        errors.push({
          file: file.name,
          code: 'format',
          message: `不支持 .${ext} 格式，支持：${config.accept.join(', ')}`,
        })
        continue
      }
    }

    // 3. 文件大小
    if (file.size > config.maxSize) {
      errors.push({
        file: file.name,
        code: 'size',
        message: `文件大小 ${formatSize(file.size)} 超出限制 ${formatSize(config.maxSize)}`,
      })
      continue
    }
  }

  // 4. 图片尺寸校验（仅 image/ai-image 场景）
  if (config.minDimension || config.maxDimension) {
    for (const file of files) {
      if (errors.some(e => e.file === file.name)) continue
      const imgErr = await validateImageDimension(file, config)
      if (imgErr) errors.push(imgErr)
    }
  }

  return errors
}

async function validateImageDimension(
  file: File,
  config: UploadConfig,
): Promise<ValidationError | null> {
  if (!file.type.startsWith('image/')) return null

  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const { naturalWidth, naturalHeight } = img
      const errs: string[] = []

      if (config.minDimension) {
        const { w, h } = config.minDimension
        if (naturalWidth < w || naturalHeight < h) {
          errs.push(`尺寸 ${naturalWidth}x${naturalHeight} 小于最小 ${w}x${h}`)
        }
      }
      if (config.maxDimension) {
        const { w, h } = config.maxDimension
        if (naturalWidth > w || naturalHeight > h) {
          errs.push(`尺寸 ${naturalWidth}x${naturalHeight} 超出最大 ${w}x${h}`)
        }
      }

      resolve(errs.length ? { file: file.name, code: 'dimension', message: errs.join('；') } : null)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}