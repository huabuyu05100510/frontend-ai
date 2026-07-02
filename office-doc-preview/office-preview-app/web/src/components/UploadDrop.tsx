import { useCallback, useRef, useState } from 'react'
import { useStore } from '../store'

// 拖拽 + 点击双通道上传，体验极致：
//  - 进入页面边界即激活
//  - 拖拽计数防止子元素抖动
//  - 输入 accept 按支持格式动态拼接
export function UploadDrop() {
  const upload = useStore(s => s.upload)
  const uploading = useStore(s => s.uploading)
  const uploadPct = useStore(s => s.uploadPct)
  const uploadName = useStore(s => s.uploadName)
  const fetchTasks = useStore(s => s.fetchTasks)
  const [over, setOver] = useState(false)
  const dragDepth = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    if (!files.length) return
    try {
      await upload(files)
    } catch (err: any) {
      alert(err?.message || '上传失败')
    }
  }, [upload])

  const onPick = async (files: FileList | null) => {
    if (!files || !files.length) return
    try {
      await upload(Array.from(files))
    } catch (err: any) {
      alert(err?.message || '上传失败')
    }
  }

  return (
    <div
      className={`upload-drop ${over ? 'over' : ''} ${uploading ? 'busy' : ''}`}
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setOver(true) }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => { e.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setOver(false) }}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept=".pdf,.docx,.pptx,.xlsx,.doc,.ppt,.xls,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.mp3,.wav,.m4a,.aac,.mp4,.mov,.mkv,.flv,.webm,.txt,.md"
        onChange={e => { onPick(e.target.files); e.currentTarget.value = '' }}
      />
      <div className="upload-inner">
        <div className="upload-emoji">{uploading ? '⏳' : '⬆️'}</div>
        <div className="upload-title">
          {uploading ? `上传中… ${(uploadPct * 100).toFixed(0)}%` : '点击或拖拽文件到此处'}
        </div>
        <div className="upload-sub">
          {uploading && uploadName
            ? uploadName
            : '支持 PDF / DOCX / PPTX / XLSX / 图片 / 音视频，单文件 ≤ 500MB'}
        </div>
        {uploading && (
          <div className="upload-bar"><div className="upload-bar-fill" style={{ width: `${uploadPct * 100}%` }} /></div>
        )}
        <button className="btn-ghost" type="button" onClick={(e) => { e.stopPropagation(); fetchTasks() }}>
          刷新列表
        </button>
      </div>
    </div>
  )
}
