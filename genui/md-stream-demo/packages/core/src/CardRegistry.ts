/**
 * CardRegistry —— 业务方零渲染层改动接入的 schema 注册表。
 *
 * 对标：
 *   - Vercel AI SDK 的 tool / streamComponent 注册
 *   - LangChain.js 的 Tool / Runnable 注册表
 *   - MDX provider 的 component map
 *
 * 业务方接入一个新卡片：
 *
 *   defineCard({
 *     name: 'guide',
 *     component: GuideCard,
 *     perfBudget: { cls: 0.05, ttft: 500 },
 *     fallback: 'skeleton',
 *   });
 *
 * 渲染层根据 StreamPart 自动驱动：
 *   - card-start(lang=guide) → 查表 → mount skeleton 或 component（带空 data）
 *   - card-delta             → 累积 body，safeParse 字段级降级渲染
 *   - card-end               → 最终 data，metric 上报
 *
 * 不变量：
 *   - 注册名全局唯一（重复注册 dev 环境 warn，prod 默认覆盖，可通过 strict 模式禁用）
 *   - getCard 不命中返回 undefined（消费侧自行决定骨架 / 抛错）
 *   - 零运行时依赖 React —— component 字段是 ComponentType 引用，但 registry 本身不 import React
 */

// 故意不 import React —— registry 是框架无关的。
// component 字段类型用泛型松绑，业务侧再绑定到具体框架。
export type AnyComponent<TData = any> = (props: { data: TData }) => unknown;

export interface CardDefinition<TData = any> {
  /** 全局唯一卡片名，与 card-start.lang 对应 */
  name: string;
  /** 业务组件引用；registry 不调用它，只持有 */
  component: AnyComponent<TData>;
  /** card-start 到 card-end 之间用什么占位；默认 'skeleton' */
  fallback?: 'skeleton' | 'none' | 'inline-partial';
  /** 性能预算；运行时 PerformanceObserver 自动校验 */
  perfBudget?: {
    cls?: number;
    ttftMs?: number;
    longTaskMs?: number;
  };
  /** dev 环境 schema 校验提示（不强制，soft） */
  description?: string;
}

export interface RegistryOptions {
  /** 重复注册时是否抛错（默认 false = warn 后覆盖） */
  strict?: boolean;
}

const registry = new Map<string, CardDefinition>();
let registryOptions: RegistryOptions = {};

/** 注册一个卡片定义。重复注册在 strict 模式抛错，否则 warn 后覆盖。 */
export function defineCard<TData>(def: CardDefinition<TData>): void {
  if (!def.name || typeof def.name !== 'string') {
    throw new Error(`[A2UI] defineCard: name 必须是非空字符串`);
  }
  if (typeof def.component !== 'function') {
    throw new Error(`[A2UI] defineCard(${def.name}): component 必须是可调用组件`);
  }
  if (registry.has(def.name)) {
    if (registryOptions.strict) {
      throw new Error(`[A2UI] defineCard(${def.name}): 重复注册（strict 模式）`);
    }
    if (typeof console !== 'undefined') {
      console.warn(`[A2UI] card "${def.name}" 已注册，覆盖`);
    }
  }
  registry.set(def.name, def as CardDefinition);
}

/** 按名查卡片定义；未注册返回 undefined。 */
export function getCard(name: string): CardDefinition | undefined {
  return registry.get(name);
}

/** 列出已注册全部卡片名（用于调试 / 文档生成）。 */
export function listCards(): string[] {
  return Array.from(registry.keys());
}

/** 内部：重置注册表（测试用，业务侧勿调）。 */
export function _resetRegistry(opts?: RegistryOptions): void {
  registry.clear();
  registryOptions = opts ?? {};
}

/** 内部：配置注册表选项（测试用）。 */
export function _configureRegistry(opts: RegistryOptions): void {
  registryOptions = opts;
}
