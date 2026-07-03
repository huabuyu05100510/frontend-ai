/**
 * 行中导游真实应用 UI —— markdown-live-preview 范式。
 *
 * 三栏布局展示 @a2ui-stream/core 的 protocol 在做什么：
 *   ① StreamPart 流（左）—— 类比 markdown 源码
 *   ② StreamState 快照（中）—— 类比 AST
 *   ③ Rendered 产物（右）—— 类比渲染 HTML
 *
 * SDK 业务侧：
 *   - defineCard('guide-pois') 注册 POI 卡片
 *   - useA2UIStream 驱动 provider，onPart 收集所有 part 给调试器
 *   - resolveCardViews 渲染结构化卡片
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { defineCard, resolveCardViews, type StreamState } from '@a2ui-stream/core';
import { useA2UIStream } from '@a2ui-stream/core/react';
import type { StreamPart } from '@a2ui-stream/core/protocol';
import { createTravelGuideProvider, type GuideCardData } from './guideStream';
import './styles.css';

defineCard<GuideCardData>({
  name: 'guide-pois',
  component: (props) => <PoiCard data={props.data} />,
  fallback: 'skeleton',
  perfBudget: { cls: 0.05 },
});

function PoiCard({ data }: { data: Partial<GuideCardData> }) {
  if (!data || !data.pois || data.pois.length === 0) {
    return <div className="card skeleton">沿途景点计算中…</div>;
  }
  return (
    <div className="card poi-card">
      <div className="poi-header">
        <span className="poi-title">🗺️ {data.title}</span>
        {data.distanceKm != null && <span className="poi-dist">{data.distanceKm}km</span>}
      </div>
      <ol className="poi-list">
        {data.pois.map((p, i) => (
          <li key={p.id} className="poi-item">
            <span className="poi-idx">{i + 1}</span>
            <div className="poi-body">
              <div className="poi-name">
                {p.name} <span className="poi-cat">{p.category}</span>
              </div>
              <div className="poi-intro">{p.intro}</div>
              <div className="poi-meta">围栏内 {p.distanceInFenceKm}km</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// 预设路线
const ROUTES: Array<{ id: string; name: string; startName: string; endName: string; start: { lng: number; lat: number }; end: { lng: number; lat: number } }> = [
  {
    id: 'guomao_summerpalace',
    name: '国贸 → 颐和园',
    startName: '国贸',
    endName: '颐和园',
    start: { lng: 116.4644, lat: 39.9089 },
    end: { lng: 116.295, lat: 39.9999 },
  },
  {
    id: 'tiananmen_zhongguancun',
    name: '天安门 → 中关村',
    startName: '天安门',
    endName: '中关村',
    start: { lng: 116.39745, lat: 39.90872 },
    end: { lng: 116.3172, lat: 39.9838 },
  },
  {
    id: 'beihai_birdnest',
    name: '北海公园 → 鸟巢',
    startName: '北海公园',
    endName: '鸟巢',
    start: { lng: 116.3893, lat: 39.9255 },
    end: { lng: 116.3972, lat: 39.9929 },
  },
];

// 9 种 part 的视觉编码（彩色 chip 标签）
const PART_META: Record<StreamPart['type'], { color: string; bg: string; label: string }> = {
  'text-delta':      { color: '#fff', bg: '#6b7280', label: 'textΔ' },
  'card-start':      { color: '#fff', bg: '#3b82f6', label: 'card▶' },
  'card-delta':      { color: '#fff', bg: '#06b6d4', label: 'cardΔ' },
  'card-end':        { color: '#fff', bg: '#14b8a6', label: 'card■' },
  'tool-call-start':     { color: '#fff', bg: '#a855f7', label: 'tool▶' },
  'tool-call-arg-delta': { color: '#fff', bg: '#ec4899', label: 'argΔ'  },
  'tool-call-end':       { color: '#fff', bg: '#8b5cf6', label: 'tool■' },
  'error':           { color: '#fff', bg: '#ef4444', label: 'error' },
  'done':            { color: '#fff', bg: '#22c55e', label: 'done'  },
};

function partSnippet(part: StreamPart): string {
  switch (part.type) {
    case 'text-delta':      return JSON.stringify(part.text);
    case 'card-start':      return `id=${part.id} lang=${part.lang}`;
    case 'card-delta':      return `id=${part.id} · ${part.body.length}B · ${truncate(part.body, 50)}`;
    case 'card-end':        return `id=${part.id}`;
    case 'tool-call-start':     return `id=${part.id} name=${part.name}`;
    case 'tool-call-arg-delta': return `id=${part.id} .${part.argName} += ${truncate(part.argPartial, 50)}`;
    case 'tool-call-end':       return `id=${part.id}`;
    case 'error':           return `${part.code} · ${part.message}`;
    case 'done':            return part.usage ? `usage=${JSON.stringify(part.usage)}` : '(terminal)';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function ProtocolChip({ part, idx, isStop }: { part: StreamPart; idx: number; isStop: boolean }) {
  const meta = PART_META[part.type];
  return (
    <div className={`chip-row ${isStop ? 'chip-stop' : ''}`}>
      <span className="chip-idx">{String(idx).padStart(3, '0')}</span>
      <span className="chip-label" style={{ background: meta.bg, color: meta.color }}>
        {meta.label}
      </span>
      <span className="chip-snippet">{partSnippet(part)}</span>
    </div>
  );
}

export function TravelGuideApp() {
  const [routeId, setRouteId] = useState(ROUTES[0]!.id);
  const [runId, setRunId] = useState(0);
  const [llmOn, setLlmOn] = useState(true);
  const [parts, setParts] = useState<StreamPart[]>([]);
  const [abortIdx, setAbortIdx] = useState(-1);
  const [aborted, setAborted] = useState(false);

  const route = useMemo(() => ROUTES.find((r) => r.id === routeId)!, [routeId]);

  // 读 env
  const llmConfig = useMemo(() => {
    const provider = (import.meta.env.VITE_LLM_PROVIDER ?? '').trim();
    const apiKey = (import.meta.env.VITE_LLM_API_KEY ?? '').trim();
    const model = (import.meta.env.VITE_LLM_MODEL ?? '').trim();
    if (!provider || !apiKey) return null;
    const useProxy = import.meta.env.DEV;
    const cfg: Record<string, { baseUrl: string; model: string }> = {
      minimax:  { baseUrl: useProxy ? '/llm' : 'https://api.minimaxi.com/v1', model: model || 'MiniMax-Text-01' },
      deepseek: { baseUrl: useProxy ? '/llm' : 'https://api.deepseek.com/v1', model: model || 'deepseek-chat' },
      openai:   { baseUrl: useProxy ? '/llm' : 'https://api.openai.com/v1', model: model || 'gpt-4o-mini' },
      qwen:     { baseUrl: useProxy ? '/llm' : 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: model || 'qwen-plus' },
    };
    const c = cfg[provider];
    if (!c) return null;
    return { apiKey, ...c, providerName: provider };
  }, []);

  const providerRef = useRef(
    createTravelGuideProvider({
      start: route.start,
      end: route.end,
      startName: route.startName,
      endName: route.endName,
      samples: 100,
      llm: llmOn && llmConfig ? llmConfig : undefined,
    }),
  );
  useEffect(() => {
    providerRef.current = createTravelGuideProvider({
      start: route.start,
      end: route.end,
      startName: route.startName,
      endName: route.endName,
      samples: 100,
      llm: llmOn && llmConfig ? llmConfig : undefined,
    });
  }, [route, llmOn, llmConfig]);

  const partsRef = useRef<StreamPart[]>([]);
  partsRef.current = parts;

  const { state, send, cancel, isStreaming } = useA2UIStream({
    provider: providerRef.current,
    messages: [],
    auto: false,
    onPart: (part) => {
      setParts((prev) => [...prev, part]);
    },
  });

  useEffect(() => {
    if (runId > 0) {
      setParts([]);
      setAbortIdx(-1);
      setAborted(false);
      send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const handleAbort = () => {
    setAbortIdx(partsRef.current.length - 1);
    setAborted(true);
    cancel();
  };

  const views = resolveCardViews(state as StreamState);
  const poiView = views.find((v) => v.lang === 'guide-pois');

  // 不变量显示
  const invariantStats = {
    parts: parts.length,
    chars: state.text.length,
    cards: Object.keys(state.cards).length,
  };

  return (
    <div className="app">
      <header>
        <h1>@a2ui-stream/core · <span className="brand-accent">remark for LLM streaming</span></h1>
        <p className="sub">
          9-type StreamPart protocol · card-streaming primitive · abort-no-loss invariant
        </p>
      </header>

      <section className="controls">
        <label>
          路线
          <select value={routeId} onChange={(e) => setRouteId(e.target.value)} disabled={isStreaming}>
            {ROUTES.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={llmOn} onChange={(e) => setLlmOn(e.target.checked)} disabled={isStreaming} />
          调真实 LLM
          {!llmConfig && llmOn && <span className="warn">（未配置 .env.local，将跳过 LLM）</span>}
        </label>
        <button onClick={() => setRunId((n) => n + 1)} disabled={isStreaming} className="btn-primary">
          {isStreaming ? '流式中…' : '生成剧本'}
        </button>
        {isStreaming && (
          <button onClick={handleAbort} className="btn-stop">
            ◼ 中断（验证 abort-no-loss）
          </button>
        )}
        {aborted && (
          <span className="invariant-badge invariant-keep">
            ✓ abort-no-loss：保留 {invariantStats.parts} parts · {invariantStats.chars} chars · {invariantStats.cards} cards
          </span>
        )}
      </section>

      <main className="three-pane">
        {/* ① 左：StreamPart 流（类比 markdown 源码） */}
        <section className="pane pane-source">
          <header className="pane-head">
            <h3>① StreamPart 流</h3>
            <span className="pane-tag">{parts.length} parts</span>
          </header>
          <p className="pane-hint">LLM 的 text-delta + routeProvider 的 card-* 在同一协议下并发流动</p>
          <div className="parts-list">
            {parts.length === 0 && <div className="empty">点击「生成剧本」开始</div>}
            {parts.map((p, i) => (
              <ProtocolChip key={i} part={p} idx={i} isStop={i === abortIdx} />
            ))}
          </div>
        </section>

        {/* ② 中：StreamState 快照（类比 AST） */}
        <section className="pane pane-ast">
          <header className="pane-head">
            <h3>② StreamState</h3>
            <span className={`pane-tag pane-tag-${state.status}`}>{state.status}</span>
          </header>
          <p className="pane-hint">reducer 把 parts 归约成不可变 state（每 part 一次浅比较）</p>
          <pre className="state-snapshot">{JSON.stringify(state, null, 2)}</pre>
        </section>

        {/* ③ 右：Rendered 产物（类比 HTML） */}
        <section className="pane pane-render">
          <header className="pane-head">
            <h3>③ Rendered</h3>
            <span className="pane-tag">React</span>
          </header>
          <p className="pane-hint">resolveCardViews 把 state 投影到注册的 component</p>
          <div className="text-stream">{state.text || '—'}</div>
          {poiView && !poiView.parseable && (
            <div className="card skeleton">景点计算中…</div>
          )}
          {poiView?.parseable && poiView.data && (
            <PoiCard data={poiView.data as GuideCardData} />
          )}
          {state.status === 'error' && (
            <div className="card error-card">
              <strong>错误：</strong> {state.error?.code} — {state.error?.message}
            </div>
          )}
        </section>
      </main>

      <footer className="status">
        <span>status: {state.status}</span>
        {state.usage && <span>usage: {JSON.stringify(state.usage)}</span>}
        <span>cards: {Object.keys(state.cards).length}</span>
        <span>toolCalls: {Object.keys(state.toolCalls).length}</span>
      </footer>
    </div>
  );
}
