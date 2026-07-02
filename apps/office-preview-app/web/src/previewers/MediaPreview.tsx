interface Props { url: string; kind: 'image' | 'video' | 'audio' }

// 图片：使用 loading=lazy + decoding=async，浏览器原生优化
export function ImagePreview({ url }: { url: string }) {
  return (
    <div className="media-root image-root">
      <img src={url} alt="preview" loading="lazy" decoding="async" />
    </div>
  )
}

// 视频：原生 video，支持 Range seek，自动按需缓冲
export function VideoPreview({ url }: { url: string }) {
  return (
    <div className="media-root video-root">
      <video src={url} controls autoPlay playsInline preload="metadata" />
    </div>
  )
}

// 音频：原生 audio，加封面占位
export function AudioPreview({ url }: { url: string }) {
  return (
    <div className="media-root audio-root">
      <div className="audio-cover">🎵</div>
      <audio src={url} controls autoPlay preload="metadata" />
    </div>
  )
}
