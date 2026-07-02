import { streamBuffer } from './StreamBuffer';
import { perfStore } from '../perf/PerfStore';

export interface RunOptions {
  charsPerTick: number; // 每帧推送字符数（模拟吞吐）
  intervalMs: number; // 帧间隔
}

/** 把目标文本以 token 级节奏喂入 streamBuffer，模拟 LLM 流式 streamAppend */
export class StreamRunner {
  private timer: number | null = null;
  private cursor = 0;
  private target = '';
  private onDone?: () => void;

  start(target: string, opts: RunOptions, onDone?: () => void) {
    this.stop();
    this.target = target;
    this.cursor = 0;
    this.onDone = onDone;
    streamBuffer.reset();
    perfStore.beginRun();
    this.tick(opts);
  }

  private tick(opts: RunOptions) {
    const step = () => {
      if (this.cursor >= this.target.length) {
        this.finish();
        return;
      }
      const next = Math.min(this.cursor + opts.charsPerTick, this.target.length);
      const delta = this.target.slice(this.cursor, next);
      this.cursor = next;
      streamBuffer.append(delta);
      perfStore.markChars(this.cursor);
      this.timer = window.setTimeout(step, opts.intervalMs);
    };
    this.timer = window.setTimeout(step, opts.intervalMs);
  }

  private finish() {
    this.stop();
    perfStore.endRun();
    this.onDone?.();
  }

  stop() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }

  get running() {
    return this.timer != null;
  }
}

export const streamRunner = new StreamRunner();
