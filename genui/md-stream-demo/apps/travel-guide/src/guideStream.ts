/**
 * 行中导游真实场景的 SDK 接入层。
 *
 * 业务侧：defineCard(guide) + createTravelGuideProvider
 * 流程：
 *   1. 直线采样路径（routeEngine.sampleRoute）
 *   2. 围栏相交检测（routeEngine.filterAlongRoute）→ 真实 POI 列表
 *   3. emit card-start(guide) → card-delta（POI 列表）→ card-end —— 真实数据，无 LLM
 *   4. 把 POI 列表 + 起终点 拼成 prompt
 *   5. 调真实 LLM（通过 SDK 的 OpenAI 兼容 adapter）流式生成剧本
 *   6. LLM 的 text-delta 直接转发给消费者
 *   7. done
 *
 * 整个流程是一个 AsyncIterable<StreamPart>，业务侧零感知。
 */

import {
  createOpenAICompatibleProvider,
  type OpenAICompatibleOptions,
} from '@a2ui-stream/core/adapters/openai-compatible';
import type { ProviderAdapter } from '@a2ui-stream/core/provider';
import { createProvider } from '@a2ui-stream/core/provider';
import { Part, type StreamPart } from '@a2ui-stream/core/protocol';
import { BEIJING_POIS, type Poi } from './poiDataset';
import { filterAlongRoute, sampleRoute, type LngLat, type PoiFilterOutput } from './routeEngine';

export interface TravelGuideOptions {
  /** 起点 */
  start: LngLat;
  /** 终点 */
  end: LngLat;
  startName: string;
  endName: string;
  /** 路径采样数（路径越长越多） */
  samples?: number;
  /** LLM 配置（不传则只发 POI 卡片，不生成剧本） */
  llm?: OpenAICompatibleOptions;
}

export interface GuideCardData {
  title: string;
  routeFrom: string;
  routeTo: string;
  distanceKm: number;
  pois: Array<{
    id: string;
    name: string;
    category: string;
    intro: string;
    enterIndex: number;
    leaveIndex: number;
    distanceInFenceKm: number;
  }>;
}

export function createTravelGuideProvider(opts: TravelGuideOptions): ProviderAdapter {
  const samples = opts.samples ?? 80;

  // 内层：路线计算（同步，零延迟）
  const routeProvider = createProvider('travel-guide-route', async function* () {
    yield Part.textDelta('t_start', `🚗 路线计算：${opts.startName} → ${opts.endName}\n\n`);

    const t0 = performance.now();
    const path = sampleRoute(opts.start, opts.end, samples);
    const passed = filterAlongRoute(path, BEIJING_POIS);
    const routeMs = performance.now() - t0;

    const totalKm = path.slice(0, 1)[0]
      ? require_haversinePath(path)
      : 0;

    yield Part.textDelta(
      't_route_done',
      `📍 路径采样 ${path.length} 点，围栏相交检测耗时 ${routeMs.toFixed(2)}ms\n` +
        `🎯 沿途命中 ${passed.length} 个景点（直线总长 ${totalKm.toFixed(1)}km）\n\n`,
    );

    if (passed.length === 0) {
      yield Part.textDelta('t_no_poi', '⚠️ 这条直线路径未穿越任何景点围栏，请尝试其他起终点。\n');
      yield Part.done();
      return;
    }

    // emit POI 卡片（真实数据，结构化）
    yield Part.cardStart('card_pois', 'guide-pois');
    const cardData: GuideCardData = {
      title: `${opts.startName} → ${opts.endName} 沿途景点`,
      routeFrom: opts.startName,
      routeTo: opts.endName,
      distanceKm: Number(totalKm.toFixed(2)),
      pois: passed.map((r: PoiFilterOutput) => ({
        id: r.poi.id,
        name: r.poi.name,
        category: r.poi.category,
        intro: r.poi.intro,
        enterIndex: r.enterIndex,
        leaveIndex: r.leaveIndex,
        distanceInFenceKm: Number(r.distanceInFenceKm.toFixed(2)),
      })),
    };
    yield Part.cardDelta('card_pois', JSON.stringify(cardData));
    yield Part.cardEnd('card_pois');

    yield Part.textDelta('t_card_done', '🗺️ 景点卡已生成。开始调 LLM 生成沿途剧本…\n\n');

    yield Part.done();
  });

  // 外层：包 LLM provider
  if (!opts.llm) return routeProvider;

  const llmProvider = createOpenAICompatibleProvider(opts.llm);

  return createProvider('travel-guide-full', async function* ({ signal }) {
    // 先跑路线
    const routeIter = routeProvider.stream({ messages: [], signal });
    const pois: Poi[] = [];
    let cardData: GuideCardData | null = null;
    for await (const part of routeIter) {
      // 注意：routeProvider 的 done 是内层终态，不能透传给外层消费者
      // （SDK 的 consumeStream 一遇到 terminal part 就 break）
      if (part.type === 'done') break;
      yield part;
      if (part.type === 'card-delta' && part.id === 'card_pois') {
        try {
          cardData = JSON.parse(part.body) as GuideCardData;
        } catch {
          // ignore
        }
      }
    }
    if (!cardData || cardData.pois.length === 0) {
      yield Part.done();
      return;
    }

    for (const p of cardData.pois) {
      const found = BEIJING_POIS.find((x) => x.id === p.id);
      if (found) pois.push(found);
    }

    // 构造 prompt
    const system = buildSystemPrompt();
    const user = buildUserPrompt(cardData, pois);

    // 调 LLM，把 text-delta 直接转发
    yield Part.textDelta('t_llm_start', '🎙️ 剧本开始流式生成：\n\n');
    const llmIter = llmProvider.stream({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      signal,
    });
    for await (const part of llmIter) {
      if (part.type === 'text-delta') {
        yield part;
      } else if (part.type === 'error') {
        yield part;
        return;
      } else if (part.type === 'done') {
        yield part;
        return;
      }
    }
  });
}

function buildSystemPrompt(): string {
  return [
    '你是滴滴行中导游的播客剧本生成器。',
    '任务：根据用户提供的沿途景点列表，生成一段多角色播客剧本。',
    '',
    '要求：',
    '1. 角色固定为「原野」「晓曼」两个主持人，每段不超过 40 字',
    '2. 剧本必须覆盖每一个沿途景点',
    '3. 介绍景点的历史 / 趣闻 / 出片建议',
    '4. 不要 markdown 标题，直接对话内容，每行一个角色',
    '5. 格式：「原野：xxx」或「晓曼：xxx」',
    '6. 总长度 8-15 段对话',
  ].join('\n');
}

function buildUserPrompt(card: GuideCardData, pois: Poi[]): string {
  const lines = [
    `路线：${card.routeFrom} → ${card.routeTo}（直线 ${card.distanceKm}km）`,
    `沿途命中 ${card.pois.length} 个景点：`,
    '',
    ...card.pois.map((p, i) => `${i + 1}. ${p.name}（${p.category}）—— ${p.intro} · 围栏内 ${p.distanceInFenceKm}km`),
    '',
    '请生成播客剧本。',
  ];
  void pois;
  return lines.join('\n');
}

// 避免 import cycle 的 helper
function require_haversinePath(path: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  return total;
}
