/** 增量流式 Markdown 内核 —— 数据模型（见 spec.md §2） */

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'blockquote'
  | 'fence'
  | 'card'
  | 'hr';

export interface Segment {
  /** 单调递增稳定 id；一旦 final 永不改变 */
  id: number;
  /** 块类型 */
  kind: BlockKind;
  /** 原始 markdown 源切片（已去尾部换行） */
  text: string;
  /** 内容指纹（cyrb53）；final 后稳定 */
  hash: string;
  /** active = 仍可能增长的尾块；final = 已冻结 */
  status: 'final' | 'active';
  /** fence / card 的语言标记 */
  lang?: string;
}
