import { memo, useEffect, useRef, useSyncExternalStore } from 'react';
import { renderMarkdown } from './miniMarkdown';
import { CopyButton } from '../components/CopyButton';
import { streamBuffer } from '../stream/StreamBuffer';
import { perfStore } from '../perf/PerfStore';
import { IncrementalSegmenter } from '../imd/segmenter';
import { speculativeClose } from '../imd/speculative';
import type { Segment } from '../imd/types';
import { VirtualBlock } from './VirtualBlock';

/**
 * IncrementalBlock —— 记忆化单块渲染。
 * memo 比较 id+hash+status：final 块 hash 稳定 → 流式期间完全跳过；
 * active 块仅在 hash/status 变化时重渲，配合投机闭合避免半截语法闪烁。
 */
const IncrementalBlock = memo(
  function IncrementalBlock({ seg, streaming }: { seg: Segment; streaming: boolean }) {
    perfStore.onBlockRender();
    const text = seg.status === 'active' ? speculativeClose(seg.text) : seg.text;
    return (
      <div className={`md-block ${streaming ? 'is-streaming' : ''}`}>
        {renderMarkdown(text)}
        <CopyButton className="block-copy" text={seg.text} label="复制本段" />
        {streaming && <span className="stream-caret" aria-hidden />}
      </div>
    );
  },
  (a, b) =>
    a.seg.id === b.seg.id &&
    a.seg.hash === b.seg.hash &&
    a.seg.status === b.seg.status &&
    a.streaming === b.streaming,
);

/**
 * 增量内核渲染：B 级方案。
 * 不再每 token 重切全文，而是把「新增 delta」喂给 IncrementalSegmenter，
 * 已完成块冻结、仅尾块增量解析（O(尾块)），渲染层据稳定 id/hash 跳过重渲。
 */
export function IncrementalMarkdown({ running, virtualize = true }: { running: boolean; virtualize?: boolean }) {
  const version = useSyncExternalStore(streamBuffer.subscribe, streamBuffer.getVersion);

  const segRef = useRef<IncrementalSegmenter | null>(null);
  if (segRef.current == null) segRef.current = new IncrementalSegmenter();
  const seg = segRef.current;
  const prevLen = useRef(0);
  const lastVersion = useRef(-1);

  // 由 version 驱动：仅喂入新增 delta（变短视为新一轮 → reset）
  if (version !== lastVersion.current) {
    lastVersion.current = version;
    const content = streamBuffer.get();
    if (content.length < prevLen.current) {
      seg.reset();
      prevLen.current = 0;
    }
    const delta = content.slice(prevLen.current);
    if (delta) seg.push(delta);
    prevLen.current = content.length;
  }

  const segments = seg.getSegments();

  const hasContent = segments.length > 0;
  useEffect(() => {
    if (hasContent) perfStore.markFirstContent();
  }, [hasContent]);

  return (
    <div className="md-doc">
      {segments.map((s) => {
        const block = <IncrementalBlock key={s.id} seg={s} streaming={running && s.status === 'active'} />;
        // 仅虚拟化已完成块；尾块 active 始终实体渲染
        return s.status === 'final' ? (
          <VirtualBlock key={s.id} enabled={virtualize}>
            {block}
          </VirtualBlock>
        ) : (
          block
        );
      })}
    </div>
  );
}
