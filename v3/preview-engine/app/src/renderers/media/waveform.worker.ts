import { computePeaks } from './waveform'
import type { Peak } from './waveform'

// ============================================================================
// waveform.worker — 在 Worker 中执行 PCM 降采样，避免阻塞主线程
//   大文件（长音频）可能耗时 100ms+，必须离开主线程执行。
// ============================================================================

self.onmessage = (e: MessageEvent<{ samples: Float32Array; buckets: number }>) => {
  const { samples, buckets } = e.data
  const peaks: Peak[] = computePeaks(samples, buckets)
  // 不用 Transferable（Float32Array 已被 decodeAudioData 消费），直接传值即可
  self.postMessage(peaks)
}
