/**
 * runtime —— 业务侧使用 A2UI SDK 的最小运行时入口。
 *
 * 业务接入三步：
 *   1. defineCard({ name: 'guide', component: GuideCard });
 *   2. const provider = createMockProvider(responder);   // 或 minimax/openai
 *   3. const state = await consumeStream(provider.stream({ messages, signal }));
 *      // state.cards['c1'].body → JSON.parse → 喂给 component
 *
 * 这里的 resolveCardView 把「StreamState 里的 card 字段 + Registry 里的 component」
 * 做最后一公里拼接，业务侧 React/Vue 组件直接 render 这一份 view 列表。
 */

import { CardDefinition, getCard } from './CardRegistry';
import { consumeStream } from './StreamConsumer';
import type { ProviderAdapter } from './ProviderAdapter';
import type { ChatMessage } from './ProviderAdapter';
import type { StreamState, CardView } from './StreamConsumer';

export interface ResolvedCard<TData = any> {
  id: string;
  lang: string;
  body: string;
  /** 半截 JSON 是否当前可 parse（业务侧决定骨架 vs 实数据） */
  parseable: boolean;
  /** 解析后的 data（parseable=false 时 undefined） */
  data?: TData;
  done: boolean;
  /** Registry 中匹配到的卡片定义（可能未注册） */
  def?: CardDefinition<TData>;
}

export async function runStream(opts: {
  provider: ProviderAdapter;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onPart?: (state: StreamState) => void;
}): Promise<StreamState> {
  const { provider, messages, signal, onPart } = opts;
  return consumeStream(provider.stream({ messages, signal }), { onPart, signal });
}

/** 把 StreamState.cards 投影成业务侧可渲染的卡片视图列表。 */
export function resolveCardViews(state: StreamState): ResolvedCard[] {
  return Object.values(state.cards).map((c: CardView) => {
    const def = getCard(c.lang ?? '') as CardDefinition | undefined;
    const trimmed = (c.body ?? '').trim();
    let parseable = false;
    let data: unknown;
    if (trimmed) {
      try {
        data = JSON.parse(trimmed);
        parseable = true;
      } catch {
        parseable = false;
      }
    }
    return {
      id: c.id,
      lang: c.lang ?? '',
      body: c.body ?? '',
      parseable,
      data,
      done: c.done,
      def,
    };
  });
}
