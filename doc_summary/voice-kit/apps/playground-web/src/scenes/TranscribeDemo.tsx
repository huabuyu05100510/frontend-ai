import { useEffect, useRef, useState } from 'react';
import { WebAudioCapture } from '@voice-kit/adapter-web';
import { DoubaoASRProvider } from '@voice-kit/provider-doubao';
import {
  transcriptionReducer,
  initialTranscriptionState,
  type TranscriptionState,
} from '@voice-kit/scene-transcribe';

// Gateway运行在独立端口8787，前端在5174，需明确指定
const gatewayUrl = `ws://localhost:8787/api/asr/doubao`;

export default function TranscribeDemo() {
  const [state, setState] = useState<TranscriptionState>(initialTranscriptionState);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawCount, setRawCount] = useState(0);
  const captureRef = useRef<WebAudioCapture | null>(null);
  const stateRef = useRef<TranscriptionState>(initialTranscriptionState);
  stateRef.current = state;

  useEffect(() => {
    return () => {
      captureRef.current?.stop().catch(() => {});
    };
  }, []);

  async function start() {
    setError(null);
    try {
      const capture = new WebAudioCapture({ processorUrl: '/capture-processor.js' });
      await capture.start();
      captureRef.current = capture;

      const provider = new DoubaoASRProvider({ gatewayUrl });
      const session = await provider.openStream({
        language: 'zh-CN',
        punctuation: true,
        diarization: true,
        audioFormat: { sampleRate: 16000, encoding: 'pcm-s16le', channels: 1 },
      });

      setRunning(true);
      setState(initialTranscriptionState);
      stateRef.current = initialTranscriptionState;

      // Pipe capture → ASR
      (async () => {
        for await (const chunk of capture.chunks()) {
          session.pushAudio(chunk.data);
        }
      })();

      // Consume ASR results → reducer
      (async () => {
        for await (const r of session.results()) {
          setRawCount((c) => c + 1);
          if (r.kind === 'error') {
            setError(`${r.code}: ${r.message ?? ''}`);
            continue;
          }
          const action =
            r.kind === 'partial'
              ? {
                  type: 'PARTIAL' as const,
                  text: r.text,
                  isCumulative: r.isCumulative,
                  ts: r.ts,
                }
              : {
                  type: 'FINAL' as const,
                  text: r.text,
                  isCumulative: r.isCumulative,
                  utterances: r.utterances.map((u) => ({
                    text: u.text,
                    startMs: u.startMs,
                    endMs: u.endMs,
                    rawSpeakerId: u.speakerId,
                    words: u.words,
                    definite: u.definite,
                  })),
                  ts: r.ts,
                };
          const next = transcriptionReducer(stateRef.current, action);
          stateRef.current = next;
          setState(next);
        }
      })();
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
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

  return (
    <div>
      <div className="row">
        <button className="primary" disabled={running} onClick={start}>
          开始录音
        </button>
        <button className="primary danger" disabled={!running} onClick={stop}>
          停止
        </button>
        <span className="meta">{running ? '录制中...' : '已停止'}</span>
        <span className="meta">接收 {rawCount} 帧</span>
      </div>
      {error && <pre style={{ color: '#E86452' }}>{error}</pre>}
      <p className="meta">
        Cards: {state.cards.length} · Speakers: {state.stats.speakerCount} ·
        Finalized: {state.stats.finalizedCards}
      </p>
      <div className="cards">
        {state.cards.map((c) => (
          <div
            key={c.id}
            className="card"
            style={{ ['--speaker-color' as string]: c.speakerColor }}
          >
            <div className="speaker">
              {c.speakerLabel} · {c.definite ? '已确定' : '识别中'}
            </div>
            <div className="text">{c.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
