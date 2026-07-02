import {
  Profiler,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ProfilerOnRenderCallback,
} from 'react';
import { Message } from './Message';
import { chatStore } from './store';
import { StreamingMarkdown } from '../markdown/MarkdownRenderer';
import { streamBuffer } from '../stream/StreamBuffer';
import { perfStore, type RenderMode } from '../perf/PerfStore';

interface Props {
  mode: RenderMode;
  streaming: boolean;
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function ChatView({ mode, streaming, running, onSend, onStop }: Props) {
  const { currentId } = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);
  const session = chatStore.current();
  const streamVersion = useSyncExternalStore(streamBuffer.subscribe, streamBuffer.getVersion);
  const [input, setInput] = useState('');
  const [atBottom, setAtBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const jumpToBottom = (smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight; // 瞬时，无动画
    stick.current = true;
    setAtBottom(true);
  };

  // 监听滚动位置，判断是否贴底
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      stick.current = bottom;
      setAtBottom(bottom);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // 切换会话 / 首次进入：绘制前瞬时定位底部（无滑动过程，对齐 DeepSeek）
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stick.current = true;
    setAtBottom(true);
  }, [currentId]);

  // 流式 / 新消息：贴底时绘制前跟随，无闪动无动画
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [streamVersion, session?.turns.length, streaming]);

  const onCommit: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
    perfStore.onCommit(actualDuration);
  };

  const send = () => {
    const t = input.trim();
    if (!t || running) return;
    setInput('');
    stick.current = true;
    onSend(t);
  };

  const turns = session?.turns ?? [];
  const liveLen = streamBuffer.get().length;
  const thinking = streaming && liveLen === 0;
  const empty = turns.length === 0 && !streaming;

  return (
    <section className="chat">
      <div className="transcript" ref={scrollRef}>
        <div className="transcript-inner">
          {empty && (
            <div className="empty-state">
              <div className="empty-logo">A2UI</div>
              <h2>开始一段多轮对话</h2>
              <p>支持流式 Markdown、卡片混排、历史记录。试试下面的问题：</p>
              <div className="suggestions">
                {['超长文档压测（虚拟化）', '上海一日游路线', '北京天气怎么样', '推荐个充电器', '本周数据对比', '这段代码怎么写'].map((s) => (
                  <button key={s} disabled={running} onClick={() => onSend(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t) => (
            <Message key={t.id} turn={t} />
          ))}

          {streaming && (
            <div className="msg msg-assistant">
              <div className="avatar">AI</div>
              <div className="bubble assistant-bubble">
                {thinking ? (
                  <div className="thinking">
                    <span /> <span /> <span />
                  </div>
                ) : (
                  <Profiler id="stream" onRender={onCommit}>
                    <StreamingMarkdown mode={mode} running={running} />
                  </Profiler>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {!atBottom && (
        <button className="to-bottom" onClick={() => jumpToBottom(true)} title="回到底部" aria-label="回到底部">
          ↓
        </button>
      )}

      <div className="composer">
        <textarea
          value={input}
          disabled={running}
          placeholder={running ? '正在生成…' : '输入消息，Enter 发送 / Shift+Enter 换行'}
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {running ? (
          <button className="btn danger send-btn" onClick={onStop}>
            停止
          </button>
        ) : (
          <button className="btn primary send-btn" onClick={send} disabled={!input.trim()}>
            发送
          </button>
        )}
      </div>
    </section>
  );
}
