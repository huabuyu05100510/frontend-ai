import type { Segment } from './types';
import { classify, FENCE_RE } from './classify';
import { cyrb53 } from './hash';

/** 去掉块尾部多余换行（用于展示/指纹，buffer 仍保留精确字符） */
function clean(text: string): string {
  return text.replace(/\n+$/, '');
}

/** 从尾部缓冲中提取「已完成块」与「剩余 active 尾块」（见 spec.md §3.1） */
function extract(buffer: string): { completed: string[]; rest: string } {
  const completed: string[] = [];
  let blockStart = 0; // 当前块起始下标
  let fence: string | null = null; // 当前打开的围栏标记
  let pos = 0;

  while (true) {
    const nl = buffer.indexOf('\n', pos);
    if (nl === -1) break; // 余下为「未以换行终止」的尾片 → 归入 active
    const line = buffer.slice(pos, nl);
    const lineEnd = nl + 1;
    const m = line.match(FENCE_RE);

    if (fence == null) {
      if (line.trim() === '') {
        // 空行：终止当前块（若有内容）
        if (pos > blockStart) completed.push(buffer.slice(blockStart, pos));
        blockStart = lineEnd;
      } else if (m) {
        // 开围栏前，先把已积累的普通块收尾
        if (pos > blockStart) {
          completed.push(buffer.slice(blockStart, pos));
          blockStart = pos;
        }
        fence = m[2];
      }
      // 其余普通内容行：并入当前块（不动 blockStart）
    } else {
      // 围栏内：仅检测闭合行
      if (m && line.trim().startsWith(fence[0].repeat(3)) && m[3].trim() === '') {
        fence = null;
        completed.push(buffer.slice(blockStart, lineEnd));
        blockStart = lineEnd;
      }
    }
    pos = lineEnd;
  }

  return { completed, rest: buffer.slice(blockStart) };
}

/**
 * 增量流式 Markdown 切块内核。
 * 已完成块冻结（id/hash 稳定），仅尾块 active 可增长；每次 push 只扫描尾部 → O(尾块)。
 */
export class IncrementalSegmenter {
  private finalized: Segment[] = [];
  private buffer = '';
  private nextId = 0;
  /** drainDirty 上次快照：id -> `${status}:${hash}` */
  private snapshot = new Map<number, string>();

  private makeSegment(text: string, status: 'final' | 'active', id: number): Segment {
    const { kind, lang } = classify(text);
    const seg: Segment = { id, kind, text, hash: cyrb53(text), status };
    if (lang) seg.lang = lang;
    return seg;
  }

  push(delta: string): void {
    if (!delta) return;
    this.buffer += delta;
    const { completed, rest } = extract(this.buffer);
    for (const raw of completed) {
      const text = clean(raw);
      if (text === '') continue;
      this.finalized.push(this.makeSegment(text, 'final', this.nextId++));
    }
    this.buffer = rest;
  }

  end(): void {
    const text = clean(this.buffer);
    if (text !== '') {
      this.finalized.push(this.makeSegment(text, 'final', this.nextId++));
    }
    this.buffer = '';
  }

  getSegments(): readonly Segment[] {
    const active = clean(this.buffer);
    if (active === '') return this.finalized;
    // active 复用 nextId（finalize 时才真正消费），保证 id 跨 push 稳定
    return [...this.finalized, this.makeSegment(active, 'active', this.nextId)];
  }

  drainDirty(): { changed: Segment[]; removedIds: number[] } {
    const current = this.getSegments();
    const changed: Segment[] = [];
    const seen = new Set<number>();
    for (const seg of current) {
      seen.add(seg.id);
      const key = `${seg.status}:${seg.hash}`;
      if (this.snapshot.get(seg.id) !== key) {
        changed.push(seg);
        this.snapshot.set(seg.id, key);
      }
    }
    const removedIds: number[] = [];
    for (const id of this.snapshot.keys()) {
      if (!seen.has(id)) {
        removedIds.push(id);
        this.snapshot.delete(id);
      }
    }
    return { changed, removedIds };
  }

  reset(): void {
    this.finalized = [];
    this.buffer = '';
    this.nextId = 0;
    this.snapshot.clear();
  }
}
