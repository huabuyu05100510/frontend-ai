import { Fragment, type ReactNode } from 'react';
import { CodeBlock } from './CodeBlock';
import { CardRenderer, isCardLang } from './cards/CardRenderer';

/**
 * 轻量 Markdown → React 渲染器（零三方依赖）。
 * 覆盖：标题 / 段落 / 加粗斜体 / 行内代码 / 链接图片 / 列表(含任务) / 引用 / 分割线 /
 *       GFM 表格 / 围栏代码（含卡片拦截）。
 * 安全：不渲染裸 HTML（按纯文本转义）；链接仅允许 http(s)。
 */
export function renderMarkdown(src: string): ReactNode {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // 围栏代码 / 卡片
    const fence = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const marker = fence[2][0].repeat(3);
      const lang = fence[3].trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过闭合行
      const body = buf.join('\n');
      out.push(<FenceBlock key={key++} lang={lang} body={body} />);
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(heading(h[1].length, h[2], key++));
      i++;
      continue;
    }

    // 分割线
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={key++} />);
      i++;
      continue;
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(<blockquote key={key++}>{renderMarkdown(buf.join('\n'))}</blockquote>);
      continue;
    }

    // 表格（当前行含 | 且下一行是分隔行）
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) &&
      lines[i + 1].includes('-')
    ) {
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(parseAlign);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(table(header, aligns, rows, key++));
      continue;
    }

    // 列表
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      out.push(list(buf, key++));
      continue;
    }

    // 段落
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(<p key={key++}>{renderInline(buf.join(' '))}</p>);
  }

  return out;
}

function FenceBlock({ lang, body }: { lang: string; body: string }) {
  if (isCardLang(lang)) return <CardRenderer lang={lang} body={body} />;
  return <CodeBlock code={body.replace(/\n$/, '')} lang={lang} />;
}

function isBlockStart(line: string): boolean {
  return (
    /^(\s*)(`{3,}|~{3,})/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*([-*+]|\d+\.)\s+/.test(line) ||
    /^\s*([-*_])(\s*\1){2,}\s*$/.test(line) ||
    line.includes('|')
  );
}

function heading(level: number, text: string, key: number): ReactNode {
  const children = renderInline(text);
  const Tag = (`h${level}` as unknown) as keyof JSX.IntrinsicElements;
  return <Tag key={key}>{children}</Tag>;
}

function list(itemLines: string[], key: number): ReactNode {
  const ordered = /^\s*\d+\.\s+/.test(itemLines[0]);
  const items = itemLines.map((l, idx) => {
    const content = l.replace(/^\s*([-*+]|\d+\.)\s+/, '');
    const task = content.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      const checked = task[1].toLowerCase() === 'x';
      return (
        <li key={idx} className="task-item">
          <input type="checkbox" checked={checked} readOnly /> {renderInline(task[2])}
        </li>
      );
    }
    return <li key={idx}>{renderInline(content)}</li>;
  });
  return ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
}

function table(header: string[], aligns: Align[], rows: string[][], key: number): ReactNode {
  return (
    <div className="table-wrap" key={key}>
      <table>
        <thead>
          <tr>
            {header.map((c, i) => (
              <th key={i} style={{ textAlign: aligns[i] ?? 'left' }}>
                {renderInline(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} style={{ textAlign: aligns[ci] ?? 'left' }}>
                  {renderInline(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Align = 'left' | 'center' | 'right';
function parseAlign(cell: string): Align {
  const c = cell.trim();
  const l = c.startsWith(':');
  const r = c.endsWith(':');
  if (l && r) return 'center';
  if (r) return 'right';
  return 'left';
}
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((s) => s.trim());
}

/** 行内解析：图片 > 链接 > 行内代码 > 加粗 > 斜体 */
export function renderInline(text: string): ReactNode {
  const patterns: { re: RegExp; fn: (m: RegExpExecArray) => ReactNode }[] = [
    { re: /!\[([^\]]*)\]\(([^)\s]+)\)/, fn: (m) => <img src={safeUrl(m[2])} alt={m[1]} loading="lazy" /> },
    {
      re: /\[([^\]]+)\]\(([^)\s]+)\)/,
      fn: (m) => {
        const href = safeUrl(m[2]);
        return href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {renderInline(m[1])}
          </a>
        ) : (
          <>{m[1]}</>
        );
      },
    },
    { re: /`([^`]+)`/, fn: (m) => <code className="md-inline-code">{m[1]}</code> },
    { re: /\*\*([^*]+)\*\*/, fn: (m) => <strong>{renderInline(m[1])}</strong> },
    { re: /(?:\*([^*\n]+)\*|_([^_\n]+)_)/, fn: (m) => <em>{renderInline(m[1] ?? m[2])}</em> },
  ];

  const nodes: ReactNode[] = [];
  let rest = text;
  let guard = 0;
  while (rest && guard++ < 5000) {
    let best: { idx: number; len: number; node: ReactNode } | null = null;
    for (const p of patterns) {
      p.re.lastIndex = 0;
      const m = p.re.exec(rest);
      if (m && (best === null || m.index < best.idx)) {
        best = { idx: m.index, len: m[0].length, node: p.fn(m) };
      }
    }
    if (!best) {
      nodes.push(rest);
      break;
    }
    if (best.idx > 0) nodes.push(rest.slice(0, best.idx));
    nodes.push(best.node);
    rest = rest.slice(best.idx + best.len);
  }
  return nodes.map((n, i) => (typeof n === 'string' ? <Fragment key={i}>{n}</Fragment> : <Fragment key={i}>{n}</Fragment>));
}

function safeUrl(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}
