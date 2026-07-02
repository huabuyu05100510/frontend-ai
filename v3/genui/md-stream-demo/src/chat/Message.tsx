import { memo } from 'react';
import { renderMarkdown } from '../markdown/miniMarkdown';
import { CopyButton } from '../components/CopyButton';
import type { Turn } from './types';

/** 已完成的消息气泡。assistant 内容按 Markdown 渲染并整体记忆化。 */
export const Message = memo(
  function Message({ turn }: { turn: Turn }) {
    if (turn.role === 'user') {
      return (
        <div className="msg msg-user">
          <div className="bubble user-bubble">{turn.content}</div>
        </div>
      );
    }
    return (
      <div className="msg msg-assistant">
        <div className="avatar">AI</div>
        <div className="bubble assistant-bubble">
          <div className="md-doc">{renderMarkdown(turn.content)}</div>
          <div className="msg-toolbar">
            <CopyButton className="msg-copy" text={turn.content} label="复制回答" />
          </div>
        </div>
      </div>
    );
  },
  (a, b) => a.turn.id === b.turn.id && a.turn.content === b.turn.content,
);
