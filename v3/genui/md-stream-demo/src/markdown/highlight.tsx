import { Fragment, type ReactNode } from 'react';

/** 轻量语法高亮（构建 React span，绝不用 innerHTML，安全） */
const KEYWORDS: Record<string, string[]> = {
  ts: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'import', 'from', 'export', 'default', 'class', 'extends', 'new', 'await', 'async', 'type', 'interface', 'enum', 'public', 'private', 'readonly', 'as', 'implements', 'this', 'void', 'string', 'number', 'boolean'],
  js: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'import', 'from', 'export', 'default', 'class', 'extends', 'new', 'await', 'async', 'this'],
  bash: ['cd', 'ls', 'npm', 'pnpm', 'yarn', 'echo', 'export', 'sudo', 'git', 'cat', 'run', 'install', 'dev'],
};
KEYWORDS.tsx = KEYWORDS.ts;
KEYWORDS.jsx = KEYWORDS.js;
KEYWORDS.typescript = KEYWORDS.ts;
KEYWORDS.javascript = KEYWORDS.js;
KEYWORDS.shell = KEYWORDS.bash;

export function highlight(code: string, lang: string): ReactNode {
  const kw = KEYWORDS[lang] ?? [];
  const kwAlt = kw.length ? `\\b(?:${kw.join('|')})\\b` : '(?!x)x';
  const re = new RegExp(
    [
      '(\\/\\/[^\\n]*|#[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1 注释
      '("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)', // 2 字符串
      '\\b(true|false|null|undefined)\\b', // 3 字面量
      '\\b(\\d+(?:\\.\\d+)?)\\b', // 4 数字
      `(${kwAlt})`, // 5 关键字
    ].join('|'),
    'g',
  );

  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(<Fragment key={k++}>{code.slice(last, m.index)}</Fragment>);
    const [full, comment, str, lit, num, keyword] = m;
    const cls = comment ? 'tok-comment' : str ? 'tok-string' : lit ? 'tok-lit' : num ? 'tok-num' : keyword ? 'tok-kw' : '';
    out.push(
      <span key={k++} className={cls}>
        {full}
      </span>,
    );
    last = m.index + full.length;
  }
  if (last < code.length) out.push(<Fragment key={k++}>{code.slice(last)}</Fragment>);
  return out;
}
