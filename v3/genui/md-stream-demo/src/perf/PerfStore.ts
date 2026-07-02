/**
 * PerfStore —— 性能采集中心，供性能面板验收。
 * 数据来源：
 *  - React <Profiler> 的 onRender（提交次数、累计/单帧渲染耗时）
 *  - rAF 采样（流式期间 FPS / 掉帧）
 *  - 流式控制器（TTFC、时长、字符数）
 */
export type RenderMode = 'incremental' | 'memoized' | 'naive';

export interface PerfSnapshot {
  mode: RenderMode;
  running: boolean;
  // 流式
  ttfcMs: number | null; // 首个内容可见耗时
  durationMs: number | null; // 流式总时长
  chars: number; // 已流入字符数
  throughput: number; // 字符/秒
  // 渲染（来自 Profiler）
  commits: number; // React 提交次数
  totalRenderMs: number; // 累计渲染耗时
  maxFrameMs: number; // 最大单次提交耗时
  avgFrameMs: number; // 平均提交耗时
  blockRenders: number; // 块组件累计渲染次数（仅记忆化模式有意义）
  // 流畅度
  fps: number; // 实时 FPS
  jankFrames: number; // 掉帧数（帧间隔 > 50ms）
  domBlocks: number; // 当前常驻 DOM 块数（虚拟化效果，越小越省）
  // 上一轮对比结果
  lastRuns: PerfRun[];
}

export interface PerfRun {
  mode: RenderMode;
  durationMs: number;
  commits: number;
  totalRenderMs: number;
  maxFrameMs: number;
  avgFps: number;
  jankFrames: number;
  domBlocks: number; // 峰值常驻 DOM 块数
  chars: number;
}

type Listener = () => void;

class PerfStore {
  private s: PerfSnapshot = this.fresh('memoized');
  private listeners = new Set<Listener>();
  private startTime = 0;
  private rafId: number | null = null;
  private lastFrameTs = 0;
  private fpsSamples: number[] = [];
  private maxDom = 0;

  private fresh(mode: RenderMode): PerfSnapshot {
    return {
      mode,
      running: false,
      ttfcMs: null,
      durationMs: null,
      chars: 0,
      throughput: 0,
      commits: 0,
      totalRenderMs: 0,
      maxFrameMs: 0,
      avgFrameMs: 0,
      blockRenders: 0,
      fps: 0,
      jankFrames: 0,
      domBlocks: 0,
      lastRuns: this.s?.lastRuns ?? [],
    };
  }

  setMode(mode: RenderMode) {
    this.s = { ...this.s, mode };
    this.emit();
  }

  /** 流式开始：重置本轮指标，开启 FPS 采样 */
  beginRun() {
    const keepRuns = this.s.lastRuns;
    this.s = { ...this.fresh(this.s.mode), running: true, lastRuns: keepRuns };
    this.startTime = performance.now();
    this.lastFrameTs = this.startTime;
    this.fpsSamples = [];
    this.maxDom = 0;
    this.startFpsLoop();
    this.emit();
  }

  /** 首帧内容渲染完成 */
  markFirstContent() {
    if (this.s.ttfcMs == null) {
      this.s = { ...this.s, ttfcMs: round(performance.now() - this.startTime) };
      this.emit();
    }
  }

  /** 每次有 delta 到达，更新字符数与吞吐 */
  markChars(chars: number) {
    const elapsed = (performance.now() - this.startTime) / 1000;
    this.s = {
      ...this.s,
      chars,
      throughput: elapsed > 0 ? Math.round(chars / elapsed) : 0,
    };
    this.emit();
  }

  /** React Profiler 回调 */
  onCommit(actualDuration: number) {
    const commits = this.s.commits + 1;
    const totalRenderMs = this.s.totalRenderMs + actualDuration;
    this.s = {
      ...this.s,
      commits,
      totalRenderMs: round(totalRenderMs),
      maxFrameMs: round(Math.max(this.s.maxFrameMs, actualDuration)),
      avgFrameMs: round(totalRenderMs / commits),
    };
    this.emit();
  }

  /** 块组件渲染计数（演示记忆化只重渲尾块） */
  onBlockRender() {
    this.s.blockRenders++;
    // 不立即 emit，避免渲染中 setState 抖动；随提交一起刷新
  }

  /** 流式结束：归档本轮，停止采样 */
  endRun() {
    const avgFps = this.fpsSamples.length
      ? Math.round(this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length)
      : 0;
    const durationMs = round(performance.now() - this.startTime);
    this.stopFpsLoop();
    const run: PerfRun = {
      mode: this.s.mode,
      durationMs,
      commits: this.s.commits,
      totalRenderMs: this.s.totalRenderMs,
      maxFrameMs: this.s.maxFrameMs,
      avgFps,
      jankFrames: this.s.jankFrames,
      domBlocks: this.maxDom,
      chars: this.s.chars,
    };
    const lastRuns = [run, ...this.s.lastRuns.filter((r) => r.mode !== run.mode)].slice(0, 3);
    this.s = { ...this.s, running: false, durationMs, fps: avgFps, lastRuns };
    this.emit();
  }

  clearRuns() {
    this.s = { ...this.s, lastRuns: [] };
    this.emit();
  }

  private startFpsLoop() {
    const loop = (ts: number) => {
      const delta = ts - this.lastFrameTs;
      this.lastFrameTs = ts;
      if (delta > 0) {
        const fps = Math.min(120, Math.round(1000 / delta));
        this.fpsSamples.push(fps);
        const jank = delta > 50 ? this.s.jankFrames + 1 : this.s.jankFrames;
        const domBlocks = countDomBlocks();
        if (domBlocks > this.maxDom) this.maxDom = domBlocks;
        this.s = { ...this.s, fps, jankFrames: jank, domBlocks };
        this.emit();
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopFpsLoop() {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  getSnapshot = (): PerfSnapshot => this.s;
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private emit() {
    this.listeners.forEach((l) => l());
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 实测当前流式区内常驻的真实块 DOM 数（占位 .md-block-ph 不计） */
function countDomBlocks(): number {
  if (typeof document === 'undefined') return 0;
  return document.querySelectorAll('.transcript .md-doc .md-block').length;
}

export const perfStore = new PerfStore();
