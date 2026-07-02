/**
 * 投机闭合：对 active 尾块在渲染前做临时闭合，治流式闪烁（见 spec.md §5）。
 * 幂等：对已闭合输入返回原值。不修改 Segment.text，仅作渲染输入。
 */
export function speculativeClose(text: string): string {
  let out = text;

  // 1) 未闭合围栏代码块（奇数个 ``` / ~~~）
  const fences = out.match(/^(`{3,}|~{3,})/gm) ?? [];
  if (fences.length % 2 === 1) out += '\n```';

  // 2) 未闭合行内代码（奇数个单反引号，排除围栏的连续反引号）
  const inlineTicks = (out.match(/(?<!`)`(?!`)/g) ?? []).length;
  if (inlineTicks % 2 === 1) out += '`';

  // 3) 未闭合粗体 **
  if ((out.match(/\*\*/g) ?? []).length % 2 === 1) out += '**';

  // 4) 未闭合链接圆括号 [t](u
  if (/\]\([^)]*$/.test(out)) out += ')';

  // 5) 未闭合链接方括号 [text
  const open = (out.match(/\[/g) ?? []).length;
  const close = (out.match(/\]/g) ?? []).length;
  if (open > close) out += ']';

  return out;
}
