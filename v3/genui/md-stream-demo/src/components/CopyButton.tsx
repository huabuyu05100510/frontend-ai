import { useState } from 'react';
import { copyText } from '../utils/clipboard';

interface Props {
  text: string;
  label?: string;
  className?: string;
}

export function CopyButton({ text, label = '复制', className = '' }: Props) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`copy-btn ${className}`}
      onClick={async () => {
        const ok = await copyText(text);
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
    >
      {done ? '已复制 ✓' : label}
    </button>
  );
}
