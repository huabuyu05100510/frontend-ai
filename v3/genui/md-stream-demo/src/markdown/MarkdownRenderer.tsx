import { memo, useEffect, useMemo, useSyncExternalStore } from 'react';
import { autoClose, splitBlocks, type Block } from './blocks';
import { renderMarkdown } from './miniMarkdown';
import { CopyButton } from '../components/CopyButton';
import { streamBuffer } from '../stream/StreamBuffer';
import { perfStore, type RenderMode } from '../perf/PerfStore';
import { IncrementalMarkdown } from './IncrementalMarkdown';

/**
 * MarkdownBlock —— 记忆化的单块渲染。
 * memo 比较：hash 或 streaming 变化才重渲。已完成块 hash 稳定 → 流式期间零重渲。
 */
const MarkdownBlock = memo(
  function MarkdownBlock({ block, streaming }: { block: Block; streaming: boolean }) {
    perfStore.onBlockRender(); // 验收用：统计块渲染次数
    const text = streaming ? autoClose(block.text) : block.text;
    return (
      <div className={`md-block ${streaming ? 'is-streaming' : ''}`}>
        {renderMarkdown(text)}
        <CopyButton className="block-copy" text={block.text} label="复制本段" />
        {streaming && <span className="stream-caret" aria-hidden />}
      </div>
    );
  },
  (a, b) => a.block.hash === b.block.hash && a.streaming === b.streaming,
);

/**
 * StreamingMarkdown —— 流式渲染入口（按模式分发）。
 * incremental：增量内核（B 级，只解析新 delta + 投机闭合）
 * memoized：块级切分 + 记忆化（A.5，每 token 重切全文但只重渲尾块）
 * naive：整篇重新解析（用于性能对比）
 */
export function StreamingMarkdown({ mode, running }: { mode: RenderMode; running: boolean }) {
  if (mode === 'incremental') return <IncrementalMarkdown running={running} />;
  return <ClassicMarkdown mode={mode} running={running} />;
}

function ClassicMarkdown({ mode, running }: { mode: RenderMode; running: boolean }) {
  useSyncExternalStore(streamBuffer.subscribe, streamBuffer.getVersion);
  const content = streamBuffer.get();

  const hasContent = content.length > 0;
  useEffect(() => {
    if (hasContent) perfStore.markFirstContent();
  }, [hasContent]);

  const blocks = useMemo(() => (mode === 'memoized' ? splitBlocks(content) : []), [mode, content]);

  if (mode === 'naive') {
    return <div className="md-doc">{renderMarkdown(content)}</div>;
  }

  return (
    <div className="md-doc">
      {blocks.map((b, i) => {
        const isLast = i === blocks.length - 1;
        return <MarkdownBlock key={`${i}:${b.hash}`} block={b} streaming={isLast && running} />;
      })}
    </div>
  );
}
