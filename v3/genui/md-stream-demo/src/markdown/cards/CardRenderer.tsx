import { AmapCard } from './AmapCard';
import { InfoCard, WeatherCard, ProductCard, StatCard } from './SimpleCards';

/** 支持作为卡片渲染的围栏语言 */
export const CARD_LANGS = ['card', 'amap', 'weather', 'product', 'stat'] as const;
export type CardLang = (typeof CARD_LANGS)[number];

export function isCardLang(lang: string): lang is CardLang {
  return (CARD_LANGS as readonly string[]).includes(lang);
}

/**
 * 把围栏代码块（其 body 为 JSON）渲染为对应卡片。
 * 流式期间 body 可能是半截 JSON → 解析失败时显示「卡片加载中」骨架，闭合后自动成型。
 */
export function CardRenderer({ lang, body }: { lang: CardLang; body: string }) {
  const parsed = safeParse(body);
  if (!parsed.ok) {
    return (
      <div className="card card-skeleton" aria-busy="true">
        <div className="sk-line w60" />
        <div className="sk-line w90" />
        <div className="sk-line w40" />
        <span className="card-skeleton-tag">{lang} 卡片生成中…</span>
      </div>
    );
  }
  try {
    switch (lang) {
      case 'amap':
        return <AmapCard data={parsed.value} />;
      case 'weather':
        return <WeatherCard data={parsed.value} />;
      case 'product':
        return <ProductCard data={parsed.value} />;
      case 'stat':
        return <StatCard data={parsed.value} />;
      case 'card':
      default:
        return <InfoCard data={parsed.value} />;
    }
  } catch {
    return <div className="card card-error">卡片数据格式错误</div>;
  }
}

function safeParse(body: string): { ok: true; value: any } | { ok: false } {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}
