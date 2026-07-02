import { CopyButton } from '../components/CopyButton';
import { highlight } from './highlight';

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{lang || 'text'}</span>
        <CopyButton className="code-copy" text={code} label="复制代码" />
      </div>
      <pre className="code-pre">
        <code>{highlight(code, lang)}</code>
      </pre>
    </div>
  );
}
