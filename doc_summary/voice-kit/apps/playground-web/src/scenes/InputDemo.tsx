import { useEffect, useRef, useState } from 'react';
import { WebAudioCapture } from '@voice-kit/adapter-web';
import { EnergyVAD } from '@voice-kit/scene-input';
import type { VADEvent } from '@voice-kit/core-types';

/**
 * InputDemo — input-method scenario with energy VAD endpoint detection.
 *
 * No provider required: VAD runs entirely client-side and demonstrates
 * end-of-utterance auto-detection (key for short-voice input).
 */
export default function InputDemo() {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<VADEvent[]>([]);
  const [rms, setRms] = useState(0);
  const captureRef = useRef<WebAudioCapture | null>(null);
  const vadRef = useRef<EnergyVAD | null>(null);

  useEffect(() => {
    return () => {
      captureRef.current?.stop().catch(() => {});
    };
  }, []);

  async function start() {
    const capture = new WebAudioCapture({ processorUrl: '/capture-processor.js' });
    await capture.start();
    captureRef.current = capture;

    const vad = new EnergyVAD(
      { threshold: 0.02, minSpeechMs: 200, minSilenceMs: 700 },
      16000,
      320
    );
    vadRef.current = vad;

    // Wire capture → VAD
    (async () => {
      for await (const chunk of capture.chunks()) {
        const view = new Int16Array(chunk.data);
        const f32 = new Float32Array(view.length);
        for (let i = 0; i < view.length; i++) f32[i] = view[i] / 0x8000;
        vad.push(f32);
      }
    })();

    // Wire VAD events → UI
    (async () => {
      for await (const ev of vad.events()) {
        setEvents((prev) => [...prev.slice(-20), ev]);
        if (ev.kind === 'confidence') setRms(ev.score ?? 0);
      }
    })();

    setRunning(true);
    setEvents([]);
  }

  async function stop() {
    setRunning(false);
    try {
      await captureRef.current?.stop();
    } catch {
      /* ignore */
    }
    captureRef.current = null;
  }

  const lastSpeechStart = [...events].reverse().find((e) => e.kind === 'speech-start');
  const lastSpeechEnd = [...events].reverse().find((e) => e.kind === 'speech-end');

  return (
    <div>
      <p className="meta">
        纯端上能量 VAD（RMS + 过零率）。说话后停顿 700ms 自动检测到端点。
        无需 Provider，可独立测试输入法场景的端点判断。
      </p>
      <div className="row">
        <button className="primary" disabled={running} onClick={start}>
          开始录音
        </button>
        <button className="primary danger" disabled={!running} onClick={stop}>
          停止
        </button>
        <span className="meta">RMS: {(rms * 100).toFixed(1)}%</span>
      </div>

      <div className="row">
        {lastSpeechStart && (
          <span className="status listening">🎤 说话中</span>
        )}
        {!lastSpeechStart && lastSpeechEnd && (
          <span className="status">已检测端点</span>
        )}
      </div>

      <div>
        <strong>VAD 事件流：</strong>
        <ul style={{ fontSize: 12, color: '#94a3b8' }}>
          {events.slice(-15).map((e, i) => (
            <li key={i}>
              [{new Date(e.ts).toLocaleTimeString()}] {e.kind}
              {e.score !== undefined && ` score=${e.score.toFixed(3)}`}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
