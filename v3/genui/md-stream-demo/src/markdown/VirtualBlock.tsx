import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 离屏块虚拟化（spec.md §7 / T11）。
 * 已完成块滚出视口后，用「等高占位」替换真实内容 → DOM 节点数与可见区相关，
 * 而非与文档长度相关（恒定 DOM / 恒定内存）。占位高度 = 折叠前实测高度 → 不抖动、不破坏自动贴底。
 *
 * 单个 IntersectionObserver 按「滚动根」复用，避免 N 个块创建 N 个 observer。
 */
type Cb = (visible: boolean) => void;
const REGISTRY = new WeakMap<Element, { io: IntersectionObserver; cbs: Map<Element, Cb> }>();

function scrollParent(el: HTMLElement): Element {
  let p = el.parentElement;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
    p = p.parentElement;
  }
  return document.scrollingElement ?? document.documentElement;
}

function observe(el: Element, root: Element, cb: Cb): () => void {
  let entry = REGISTRY.get(root);
  if (!entry) {
    const cbs = new Map<Element, Cb>();
    const isViewport = root === (document.scrollingElement ?? document.documentElement);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) cbs.get(e.target)?.(e.isIntersecting);
      },
      // rootMargin 预留 600px：滚动方向上提前实体化，避免露白
      { root: isViewport ? null : root, rootMargin: '600px 0px' },
    );
    entry = { io, cbs };
    REGISTRY.set(root, entry);
  }
  entry.cbs.set(el, cb);
  entry.io.observe(el);
  return () => {
    entry!.cbs.delete(el);
    entry!.io.unobserve(el);
  };
}

const supported = typeof IntersectionObserver !== 'undefined';

export function VirtualBlock({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const heightRef = useRef(0);
  const [visible, setVisible] = useState(true);

  const active = enabled && supported;

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const root = scrollParent(el);
    return observe(el, root, (v) => {
      if (!v && ref.current) heightRef.current = ref.current.offsetHeight || heightRef.current;
      setVisible(v);
    });
  }, [active]);

  // 可见时持续记录高度，作为折叠后的占位高度
  useEffect(() => {
    if (visible && ref.current) heightRef.current = ref.current.offsetHeight || heightRef.current;
  });

  if (active && !visible) {
    return <div ref={ref} className="md-block-ph" style={{ height: heightRef.current || 32 }} aria-hidden />;
  }
  return <div ref={ref}>{children}</div>;
}
