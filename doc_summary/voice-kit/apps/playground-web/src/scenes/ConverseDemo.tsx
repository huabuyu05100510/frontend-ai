import { useRef, useState } from 'react';
import { WebAudioPlayer } from '@voice-kit/adapter-web';
import {
  conversationReducer,
  initialConverseState,
  type ConverseState,
  type ConverseAction,
} from '@voice-kit/scene-converse';

/**
 * ConverseDemo — UI showcase for the Barge-in FSM.
 *
 * Without real provider credentials, this demo simulates AI responses with
 * canned audio chunks to demonstrate the barge-in state machine. Click
 * "Simulate AI speech" then "Interrupt" to see currentResponseId bump and
 * stale chunks drop in real-time.
 */

export default function ConverseDemo() {
  const [state, setState] = useState<ConverseState>(initialConverseState);
  const [history, setHistory] = useState<string[]>([]);
  const stateRef = useRef<ConverseState>(initialConverseState);
  stateRef.current = state;
  const playerRef = useRef<WebAudioPlayer | null>(null);
  const simulatedResponseSeq = useRef(0);

  function dispatch(action: ConverseAction) {
    const next = conversationReducer(stateRef.current, action);
    stateRef.current = next;
    setState(next);
    if (action.type === 'BARGE_IN') {
      setHistory((h) => [...h, `[BARGE_IN] bumped currentResponseId → ${next.currentResponseId}`]);
    }
  }

  function ensurePlayer() {
    if (!playerRef.current) {
      playerRef.current = new WebAudioPlayer();
    }
    return playerRef.current;
  }

  function connect() {
    dispatch({ type: 'CONNECT_START', ts: Date.now() });
    setTimeout(() => dispatch({ type: 'CONNECTED', ts: Date.now() }), 100);
  }

  function simulateAISpeech() {
    const player = ensurePlayer();
    const responseId = String(stateRef.current.currentResponseId + 1);

    dispatch({ type: 'AI_RESPONSE_START', responseId, ts: Date.now() });

    // Generate a 1-second PCM beep per chunk, scheduled back-to-back
    for (let seq = 1; seq <= 3; seq++) {
      const samples = 16000; // 1s @ 16kHz
      const buf = new Int16Array(samples);
      for (let i = 0; i < samples; i++) {
        const env = Math.min(1, i / 800, (samples - i) / 800); // fade in/out
        buf[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.3 * env * 0x7fff;
      }
      player.enqueue({
        data: buf.buffer,
        responseId,
        seq,
        format: { sampleRate: 16000, channels: 1, encoding: 'pcm-s16le' },
        isFinal: seq === 3,
      });
      simulatedResponseSeq.current = seq;
    }

    // Emit transcript deltas
    setTimeout(() => {
      dispatch({
        type: 'AI_TRANSCRIPT_DELTA',
        responseId,
        delta: '这是一段',
        ts: Date.now(),
      });
    }, 400);
    setTimeout(() => {
      dispatch({
        type: 'AI_TRANSCRIPT_DELTA',
        responseId,
        delta: '模拟的语音。',
        ts: Date.now(),
      });
    }, 800);
  }

  function interrupt() {
    dispatch({ type: 'BARGE_IN', ts: Date.now() });
    playerRef.current?.interrupt();
    // Demonstrate stale rejection: try to enqueue for old responseId
    setTimeout(() => {
      const staleAccepted = playerRef.current?.enqueue({
        data: new ArrayBuffer(32000),
        responseId: String(stateRef.current.currentResponseId - 1),
        seq: 99,
        format: { sampleRate: 16000, channels: 1, encoding: 'pcm-s16le' },
      });
      setHistory((h) => [
        ...h,
        `[STALE TEST] enqueue old responseId → accepted=${staleAccepted} (expected false)`,
      ]);
    }, 200);
    setTimeout(() => {
      dispatch({ type: 'BARGE_IN_COMPLETE', ts: Date.now() });
    }, 500);
  }

  return (
    <div>
      <p className="meta">
        本 demo 用模拟音频展示 Barge-in FSM。状态机处理真实 Provider 时
        逻辑一致 — 仅替换 audio source。
      </p>
      <div className="row">
        <button className="primary" onClick={connect} disabled={state.status !== 'idle'}>
          连接
        </button>
        <button
          className="primary"
          onClick={simulateAISpeech}
          disabled={state.status === 'idle' || state.status === 'speaking'}
        >
          模拟 AI 说话
        </button>
        <button className="primary danger" onClick={interrupt} disabled={state.status !== 'speaking'}>
          打断 (Barge-in)
        </button>
      </div>
      <div className="row">
        状态：
        <span className={`status ${state.status}`}>{state.status}</span>
        <span className="meta">currentResponseId = {state.currentResponseId}</span>
      </div>
      <div className="row">
        <div>AI 转录：{state.assistantMessage?.transcript || '(空)'}</div>
      </div>
      <pre>stats: {JSON.stringify(state.stats, null, 2)}</pre>
      <div>
        <strong>事件历史：</strong>
        <ul style={{ fontSize: 12, color: '#94a3b8' }}>
          {history.slice(-8).map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
