import type { BlockKind } from './types';

/** 卡片语言集（与 CardRenderer 对齐） */
export const CARD_LANGS = new Set(['amap', 'weather', 'product', 'stat', 'card']);

/** 围栏起始行：```lang / ~~~lang */
export const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;

const HEADING_RE = /^#{1,6}\s/;
const HR_RE = /^([-*_])\s*(\1\s*){2,}$/;
const LIST_RE = /^\s*([-*+]|\d+\.)\s/;
const BLOCKQUOTE_RE = /^\s*>/;
/** 表格分隔行：仅由 | : - 空白组成且含 - */
const TABLE_SEP_RE = /^[\s|:-]+$/;

function fenceLang(firstLine: string): string {
  const m = firstLine.match(FENCE_RE);
  if (!m) return '';
  return (m[3].trim().split(/\s+/)[0] ?? '').toLowerCase();
}

/** 给定单个块的原文，判定块类型与语言（见 spec.md §4） */
export function classify(text: string): { kind: BlockKind; lang?: string } {
  const lines = text.split('\n');
  const first = lines[0] ?? '';

  if (FENCE_RE.test(first)) {
    const lang = fenceLang(first);
    return CARD_LANGS.has(lang) ? { kind: 'card', lang } : { kind: 'fence', lang };
  }
  if (HEADING_RE.test(first)) return { kind: 'heading' };
  if (HR_RE.test(first.trim())) return { kind: 'hr' };

  if (
    lines.length >= 2 &&
    first.includes('|') &&
    lines[1].includes('-') &&
    TABLE_SEP_RE.test(lines[1].trim())
  ) {
    return { kind: 'table' };
  }

  if (BLOCKQUOTE_RE.test(first)) return { kind: 'blockquote' };
  if (LIST_RE.test(first)) return { kind: 'list' };
  return { kind: 'paragraph' };
}
