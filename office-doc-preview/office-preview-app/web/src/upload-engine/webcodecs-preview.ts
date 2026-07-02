// ============================================================
// WebCodecs 视频/音频预览
// 浏览器原生解码，不依赖 ffmpeg.wasm（30MB+）
// 对标：Chrome 94+ WebCodecs API
// ============================================================

export interface VideoThumbnail {
  dataUrl: string
  timestamp: number  // 关键帧的时间戳
  width: number
  height: number
}

export interface AudioWaveform {
  peaks: Float32Array  // 归一化波形数据 [-1, 1]
  duration: number     // 音频时长（秒）
  sampleRate: number
}

/**
 * 视频关键帧提取缩略图
 * 只读文件前几 MB 即可提取第 1 帧，不加载全文件
 */
export async function extractVideoThumbnail(
  file: File,
  count: number = 3,
): Promise<VideoThumbnail[]> {
  // 读文件前 2MB 找第一个关键帧
  const head = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer())

  // 检测视频编码格式
  const codec = detectVideoCodec(file.name, head)
  if (!codec) {
    return fallbackVideoThumbnail(file)
  }

  const thumbnails: VideoThumbnail[] = []

  try {
    const decoder = new VideoDecoder({
      output(frame: VideoFrame) {
        // Canvas 绘制帧
        const canvas = document.createElement('canvas')
        canvas.width = frame.displayWidth
        canvas.height = frame.displayHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(frame, 0, 0)
        thumbnails.push({
          dataUrl: canvas.toDataURL('image/jpeg', 0.8),
          timestamp: frame.timestamp / 1_000_000,
          width: frame.displayWidth,
          height: frame.displayHeight,
        })
        frame.close()
        if (thumbnails.length >= count) {
          decoder.close()
        }
      },
      error(e: Error) {
        console.warn('VideoDecoder error:', e)
      },
    })

    decoder.configure({
      codec,
      optimizeForLatency: true,
    })

    // 分块喂数据直到拿到足够缩略图
    const chunkSize = 256 * 1024
    const totalChunks = Math.min(Math.ceil(file.size / chunkSize), 16) // 最多读 4MB

    for (let i = 0; i < totalChunks && thumbnails.length < count; i++) {
      const start = i * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      const chunk = new Uint8Array(await file.slice(start, end).arrayBuffer())

      const encodedChunk = new EncodedVideoChunk({
        type: i === 0 ? 'key' : 'delta',
        data: chunk,
        timestamp: i * chunkSize,
      })

      try {
        decoder.decode(encodedChunk)
      } catch {
        break
      }
    }

    await decoder.flush()
  } catch {
    // 降级：使用 video 元素
    return fallbackVideoThumbnail(file)
  }

  return thumbnails.length > 0 ? thumbnails : fallbackVideoThumbnail(file)
}

/**
 * 降级方案：使用 video 元素提取缩略图
 */
function fallbackVideoThumbnail(file: File): Promise<VideoThumbnail[]> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true

    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration * 0.1)
    }

    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0)

      URL.revokeObjectURL(url)
      resolve([{
        dataUrl: canvas.toDataURL('image/jpeg', 0.8),
        timestamp: video.currentTime,
        width: video.videoWidth,
        height: video.videoHeight,
      }])
    }

    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve([])
    }

    video.src = url
  })
}

/**
 * 检测视频编码格式
 */
function detectVideoCodec(filename: string, head: Uint8Array): string | null {
  const ext = filename.split('.').pop()?.toLowerCase()
  const codecMap: Record<string, string> = {
    mp4: 'avc1.42E01E',
    m4v: 'avc1.42E01E',
    mov: 'avc1.42E01E',
    mkv: 'vp09.00.10.08',
    webm: 'vp09.00.10.08',
  }
  return codecMap[ext ?? ''] ?? null
}

/**
 * 音频波形生成
 * 使用 AudioContext 解码 → 计算峰值
 */
export async function generateAudioWaveform(file: File): Promise<AudioWaveform | null> {
  try {
    const ctx = new AudioContext()
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer())

    const peaks = new Float32Array(200) // 200 个采样点
    const samplesPerPeak = Math.floor(buffer.length / peaks.length)

    for (let i = 0; i < peaks.length; i++) {
      let max = 0
      const start = i * samplesPerPeak
      const end = Math.min(start + samplesPerPeak, buffer.length)

      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const data = buffer.getChannelData(ch)
        for (let j = start; j < end; j++) {
          const abs = Math.abs(data[j])
          if (abs > max) max = abs
        }
      }
      peaks[i] = max
    }

    ctx.close()
    return { peaks, duration: buffer.duration, sampleRate: buffer.sampleRate }
  } catch {
    return null
  }
}

/**
 * 绘制音频波形到 Canvas
 */
export function drawWaveform(
  canvas: HTMLCanvasElement,
  waveform: AudioWaveform,
  color: string = '#1890ff',
): void {
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  const center = height / 2

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 1

  const barWidth = width / waveform.peaks.length

  for (let i = 0; i < waveform.peaks.length; i++) {
    const peak = waveform.peaks[i]
    const barHeight = peak * center
    ctx.fillRect(i * barWidth, center - barHeight, barWidth - 1, barHeight * 2)
  }
}