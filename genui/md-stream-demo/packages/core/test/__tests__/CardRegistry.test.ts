import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CardDefinition,
  _configureRegistry,
  _resetRegistry,
  defineCard,
  getCard,
  listCards,
} from '../../src/CardRegistry';

describe('CardRegistry', () => {
  beforeEach(() => {
    _resetRegistry();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('defineCard + getCard 基本流程', () => {
    const Comp = (_props: { data: { title: string } }) => null;
    defineCard({ name: 'guide', component: Comp });
    expect(getCard('guide')?.component).toBe(Comp);
  });

  it('listCards 列出全部已注册名', () => {
    defineCard({ name: 'a', component: () => null });
    defineCard({ name: 'b', component: () => null });
    expect(listCards().sort()).toEqual(['a', 'b']);
  });

  it('getCard 未注册返回 undefined', () => {
    expect(getCard('not-exist')).toBeUndefined();
  });

  it('defineCard 重复注册默认 warn 后覆盖', () => {
    const A = () => null;
    const B = () => null;
    defineCard({ name: 'x', component: A });
    defineCard({ name: 'x', component: B });
    expect(getCard('x')?.component).toBe(B);
    expect(console.warn).toHaveBeenCalled();
  });

  it('strict 模式下重复注册抛错', () => {
    _configureRegistry({ strict: true });
    defineCard({ name: 'x', component: () => null });
    expect(() => defineCard({ name: 'x', component: () => null })).toThrow();
  });

  it('name 为空抛错', () => {
    expect(() => defineCard({ name: '', component: () => null })).toThrow();
  });

  it('component 非 function 抛错', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => defineCard({ name: 'bad', component: 42 as any })).toThrow();
  });

  it('CardDefinition 类型推导（编译期保证）', () => {
    // 这一行不是运行时断言，是给 tsc 看的：泛型 TData 必须能从 component 推到 def
    const def: CardDefinition<{ title: string }> = {
      name: 'typed',
      component: (props: { data: { title: string } }) => props.data.title,
    };
    defineCard(def);
    expect(getCard('typed')).toBeDefined();
  });
});
