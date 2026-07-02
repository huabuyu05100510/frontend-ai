import { useRef, useState, useEffect, useCallback } from 'react'
import type { UploadConfig, UploadFile } from '../types'
import { SmartUploader, UploadOptions } from '../smart-uploader'
import { UploadMetrics } from '../telemetry'

export function useUpload(config: UploadConfig) {
  const uploaderRef = useRef<SmartUploader | null>(null)
  if (!uploaderRef.current) {
    uploaderRef.current = new SmartUploader()
  }

  const [files, setFiles] = useState<UploadFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [metrics, setMetrics] = useState<UploadMetrics | null>(null)
  const [connState, setConnState] = useState({
    concurrency: 3,
    ewmaLatency: 0,
    successRate: 1,
  })

  useEffect(() => {
    const uploader = uploaderRef.current!

    // rAF 批处理：高频上传事件（progress/chunk）合并到一帧，避免整树高频重渲染导致抖动
    let scheduled = false
    const flush = () => {
      scheduled = false
      setFiles(uploader.getAllFiles())
    }
    const unsub = uploader.on(() => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(flush)
    })

    // 定时刷新连接状态
    const timer = setInterval(() => {
      const cm = uploader.getConnectionManager()
      setConnState(prev => {
        const next = {
          concurrency: cm.maxConcurrent,
          ewmaLatency: cm.getEWMALatency(),
          successRate: cm.getSuccessRate(),
        }
        // 值未变则复用旧引用，避免无意义重渲染
        if (prev.concurrency === next.concurrency &&
            prev.ewmaLatency === next.ewmaLatency &&
            prev.successRate === next.successRate) return prev
        return next
      })
    }, 1000)

    return () => {
      unsub()
      clearInterval(timer)
      uploader.cancelAll()
    }
  }, [])

  const upload = useCallback((fileList: FileList | File[]) => {
    const arr = Array.from(fileList)
    const opts: UploadOptions = {
      config,
      onMetrics: (m) => setMetrics(m),
    }
    for (const file of arr) {
      uploaderRef.current!.upload(file, opts)
    }
  }, [config])

  const pause = useCallback((id: string) => uploaderRef.current!.pause(id), [])
  const resume = useCallback((id: string) => uploaderRef.current!.resume(id), [])
  const cancel = useCallback((id: string) => {
    uploaderRef.current!.cancel(id)
    setFiles(uploaderRef.current!.getAllFiles())
  }, [])
  const cancelAll = useCallback(() => {
    uploaderRef.current!.cancelAll()
    setFiles([])
  }, [])

  const clearCompleted = useCallback(() => {
    uploaderRef.current!.clearCompleted()
    setFiles(uploaderRef.current!.getAllFiles())
  }, [])

  // 拖拽
  const dragCounter = useRef(0)
  const dropZoneProps = {
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault(); dragCounter.current++; setIsDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      e.preventDefault(); dragCounter.current--;
      if (dragCounter.current === 0) setIsDragging(false)
    },
    onDragOver: (e: React.DragEvent) => { e.preventDefault() },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); dragCounter.current = 0; setIsDragging(false)
      if (e.dataTransfer.files.length > 0) upload(e.dataTransfer.files)
    },
  }

  return {
    files, upload, pause, resume, cancel, cancelAll, clearCompleted, isDragging, dropZoneProps,
    metrics, connState,
  }
}