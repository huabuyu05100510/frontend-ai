import { useEffect, useRef, useState } from 'react';
import { HistorySidebar } from './chat/HistorySidebar';
import { ChatView } from './chat/ChatView';
import { PerfPanel } from './perf/PerfPanel';
import { chatStore } from './chat/store';
import { respond } from './chat/responder';
import { perfStore, type RenderMode } from './perf/PerfStore';
import { streamRunner } from './stream/StreamRunner';
import { streamBuffer } from './stream/StreamBuffer';
import { buildShareUrl, copyText, readSharedContent } from './utils/clipboard';
import { SPEEDS, type SpeedKey } from './config';

export function App() {
  const [mode, setMode] = useState<RenderMode>('incremental');
  const [speed, setSpeed] = useState<SpeedKey>('normal');
  const [running, setRunning] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [toast, setToast] = useState('');
  const speedRef = useRef(speed);
  speedRef.current = speed;

  // 分享链接载入
  useEffect(() => {
    const shared = readSharedContent();
    if (shared) {
      chatStore.newSession();
      chatStore.addTurn('user', '（来自分享链接）');
      chatStore.addTurn('assistant', shared);
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, []);

  const showToast = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(''), 1600);
  };

  /** 启动一次流式输出；commit=true 时结束后写入会话历史 */
  const startStream = (target: string, commit: boolean, perfMode: RenderMode) =>
    new Promise<void>((resolve) => {
      perfStore.setMode(perfMode);
      setStreaming(true);
      setRunning(true);
      streamRunner.start(target, SPEEDS[speedRef.current], () => {
        if (commit) chatStore.addTurn('assistant', target);
        streamBuffer.reset();
        setStreaming(false);
        setRunning(false);
        resolve();
      });
    });

  const handleSend = (text: string) => {
    if (running) return;
    const session = chatStore.current();
    const turnIndex = session ? session.turns.filter((t) => t.role === 'user').length : 0;
    chatStore.addTurn('user', text);
    const answer = respond(text, turnIndex);
    void startStream(answer, true, mode);
  };

  const handleStop = () => {
    streamRunner.stop();
    perfStore.endRun();
    const partial = streamBuffer.get();
    if (partial.trim()) chatStore.addTurn('assistant', partial + '\n\n_（已停止生成）_');
    streamBuffer.reset();
    setStreaming(false);
    setRunning(false);
  };

  const lastAssistant = (): string | null => {
    const turns = chatStore.current()?.turns ?? [];
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'assistant') return turns[i].content;
    return null;
  };

  const handleCompare = async () => {
    if (running) return;
    const last = lastAssistant();
    if (!last) {
      showToast('先进行一轮对话，再跑性能对比');
      return;
    }
    perfStore.clearRuns();
    const runs: RenderMode[] = ['incremental', 'memoized', 'naive'];
    for (const m of runs) {
      setMode(m);
      await delay(80);
      await startStream(last, false, m);
      await delay(220);
    }
    setMode('incremental');
    showToast('对比完成，见性能面板');
  };

  const handleShare = async () => {
    const last = lastAssistant();
    if (!last) {
      showToast('暂无可分享内容');
      return;
    }
    const ok = await copyText(buildShareUrl(last));
    showToast(ok ? '分享链接已复制' : '生成失败');
  };

  const handleCopyAll = async () => {
    const turns = chatStore.current()?.turns ?? [];
    const md = turns.map((t) => (t.role === 'user' ? `## 🧑 ${t.content}` : t.content)).join('\n\n---\n\n');
    const ok = await copyText(md);
    showToast(ok ? '已复制当前对话' : '复制失败');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">A2UI</span>
          <div>
            <h1>Markdown 流式对话 · 多轮 + 历史记录 + 性能面板</h1>
            <p className="subtitle">块级记忆化 · 卡片混排（高德地图/天气/商品/统计）· 自动跟随滚动 · 可复制可分享</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={handleCopyAll}>
            复制对话
          </button>
          <button className="btn ghost" onClick={handleShare}>
            分享
          </button>
        </div>
      </header>

      <div className="body">
        <HistorySidebar disabled={running} />
        <ChatView mode={mode} streaming={streaming} running={running} onSend={handleSend} onStop={handleStop} />
        <PerfPanel
          mode={mode}
          speed={speed}
          running={running}
          onMode={setMode}
          onSpeed={setSpeed}
          onCompare={handleCompare}
        />
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
