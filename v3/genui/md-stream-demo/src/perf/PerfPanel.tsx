import { useSyncExternalStore } from 'react';
import { perfStore, type PerfRun, type RenderMode } from './PerfStore';
import { SPEEDS, type SpeedKey } from '../config';

interface Props {
  mode: RenderMode;
  speed: SpeedKey;
  running: boolean;
  onMode: (m: RenderMode) => void;
  onSpeed: (s: SpeedKey) => void;
  onCompare: () => void;
}

export function PerfPanel({ mode, speed, running, onMode, onSpeed, onCompare }: Props) {
  const s = useSyncExternalStore(perfStore.subscribe, perfStore.getSnapshot);

  const fpsClass = s.fps >= 50 ? 'good' : s.fps >= 30 ? 'warn' : 'bad';

  return (
    <aside className="perf-panel">
      <div className="perf-head">
        <h3>性能面板</h3>
        <span className={`perf-status ${s.running ? 'live' : ''}`}>{s.running ? '采集中' : '空闲'}</span>
      </div>

      <div className="perf-controls">
        <div className="pc-row">
          <span className="pc-label">渲染</span>
          <div className="seg sm">
            <button className={mode === 'incremental' ? 'on' : ''} disabled={running} onClick={() => onMode('incremental')}>
              增量内核
            </button>
            <button className={mode === 'memoized' ? 'on' : ''} disabled={running} onClick={() => onMode('memoized')}>
              记忆化
            </button>
            <button className={mode === 'naive' ? 'on' : ''} disabled={running} onClick={() => onMode('naive')}>
              朴素
            </button>
          </div>
        </div>
        <div className="pc-row">
          <span className="pc-label">流速</span>
          <div className="seg sm">
            {(Object.keys(SPEEDS) as SpeedKey[]).map((k) => (
              <button key={k} className={speed === k ? 'on' : ''} disabled={running} onClick={() => onSpeed(k)}>
                {SPEEDS[k].label}
              </button>
            ))}
          </div>
        </div>
        <button className="btn sm compare-btn" disabled={running} onClick={onCompare}>
          ⚡ 跑对比（增量 vs 记忆化 vs 朴素）
        </button>
      </div>

      <div className="perf-grid">
        <Metric label="TTFC 首屏" value={fmt(s.ttfcMs, 'ms')} hint="首个内容可见耗时，越小越好" highlight />
        <Metric label="流式时长" value={fmt(s.durationMs, 'ms')} />
        <Metric label="字符数" value={String(s.chars)} />
        <Metric label="吞吐" value={`${s.throughput}/s`} />
        <Metric label="实时 FPS" value={String(s.fps)} cls={fpsClass} highlight />
        <Metric label="掉帧" value={String(s.jankFrames)} cls={s.jankFrames > 0 ? 'warn' : 'good'} hint="帧间隔>50ms 计一次" />
        <Metric label="React 提交" value={String(s.commits)} hint="Profiler 统计的提交次数" />
        <Metric label="累计渲染" value={fmt(s.totalRenderMs, 'ms')} hint="所有提交的渲染耗时之和，越小越好" highlight />
        <Metric label="最大单帧" value={fmt(s.maxFrameMs, 'ms')} cls={s.maxFrameMs > 16.7 ? 'warn' : 'good'} />
        <Metric label="平均单帧" value={fmt(s.avgFrameMs, 'ms')} />
        <Metric label="块渲染次数" value={String(s.blockRenders)} hint="记忆化/增量模式下应远小于「提交次数×块数」" />
        <Metric label="常驻块(DOM)" value={String(s.domBlocks)} cls={s.domBlocks > 80 ? 'warn' : 'good'} hint="流式区真实块 DOM 峰值；增量+虚拟化应保持恒定" highlight />
        <Metric label="渲染模式" value={MODE_LABEL[s.mode]} />
      </div>

      {s.lastRuns.length > 0 && (
        <div className="perf-compare">
          <h4>增量 vs 记忆化 vs 朴素 对比</h4>
          <table>
            <thead>
              <tr>
                <th>指标</th>
                <th>增量</th>
                <th>记忆化</th>
                <th>朴素</th>
                <th>增量/朴素</th>
              </tr>
            </thead>
            <tbody>
              <CompareRow label="累计渲染(ms)" pick={(r) => r.totalRenderMs} runs={s.lastRuns} lowerBetter />
              <CompareRow label="最大单帧(ms)" pick={(r) => r.maxFrameMs} runs={s.lastRuns} lowerBetter />
              <CompareRow label="平均 FPS" pick={(r) => r.avgFps} runs={s.lastRuns} />
              <CompareRow label="掉帧次数" pick={(r) => r.jankFrames} runs={s.lastRuns} lowerBetter />
              <CompareRow label="常驻 DOM 块" pick={(r) => r.domBlocks} runs={s.lastRuns} lowerBetter />
            </tbody>
          </table>
          <p className="perf-note">
            说明：三种模式渲染同一份内容、相同流速。增量内核每 token 只解析新增 delta（O(尾块)），
            记忆化每 token 重切全文但只重渲尾块，朴素整篇重解析重渲。故累计渲染耗时与卡顿：增量 ≤ 记忆化 ≪ 朴素。
          </p>
        </div>
      )}
    </aside>
  );
}

function Metric({
  label,
  value,
  hint,
  cls,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  cls?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`metric ${highlight ? 'metric-hl' : ''}`} title={hint}>
      <div className={`metric-value ${cls ?? ''}`}>{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function CompareRow({
  label,
  pick,
  runs,
  lowerBetter,
}: {
  label: string;
  pick: (r: PerfRun) => number;
  runs: PerfRun[];
  lowerBetter?: boolean;
}) {
  const inc = runs.find((r) => r.mode === 'incremental');
  const mem = runs.find((r) => r.mode === 'memoized');
  const naive = runs.find((r) => r.mode === 'naive');
  const i = inc ? pick(inc) : null;
  const m = mem ? pick(mem) : null;
  const n = naive ? pick(naive) : null;
  let gain = '—';
  if (i != null && n != null && i > 0 && n > 0) {
    const ratio = lowerBetter ? n / i : i / n;
    gain = ratio >= 1 ? `${ratio.toFixed(1)}×` : `${(1 / ratio).toFixed(1)}× 慢`;
  }
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{i ?? '—'}</td>
      <td className="num">{m ?? '—'}</td>
      <td className="num">{n ?? '—'}</td>
      <td className="num gain">{gain}</td>
    </tr>
  );
}

const MODE_LABEL: Record<RenderMode, string> = {
  incremental: '增量内核',
  memoized: '记忆化',
  naive: '朴素重渲',
};

function fmt(n: number | null, unit: string): string {
  return n == null ? '—' : `${n}${unit}`;
}
