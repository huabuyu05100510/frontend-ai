import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IframePool } from '../iframe-pool';

describe('perf/iframe-pool', () => {
  let pool: IframePool;

  beforeEach(() => {
    pool = new IframePool({ maxSize: 3 });
    document.body.innerHTML = '';
  });

  describe('acquire', () => {
    it('首次获取子应用 → 创建新 iframe', () => {
      const iframe = pool.acquire('system-a');
      expect(iframe.tagName).toBe('IFRAME');
      expect(iframe.dataset.appId).toBe('system-a');
      expect(iframe.style.display).toBe('none'); // 默认隐藏
    });

    it('重复获取同一子应用 → 返回缓存的 iframe（不重建）', () => {
      const first = pool.acquire('system-a');
      const second = pool.acquire('system-a');
      expect(second).toBe(first); // 同一引用
    });

    it('不同子应用 → 创建不同 iframe', () => {
      const a = pool.acquire('system-a');
      const b = pool.acquire('system-b');
      expect(a).not.toBe(b);
      expect(a.dataset.appId).toBe('system-a');
      expect(b.dataset.appId).toBe('system-b');
    });
  });

  describe('LRU 淘汰', () => {
    it('超过 maxSize 时淘汰最久未用的 iframe', () => {
      pool.acquire('system-a');
      pool.acquire('system-b');
      pool.acquire('system-c');
      // 三个 iframe 已满，再获取新子应用 → 应该淘汰第一个
      pool.acquire('system-d');
      // system-a 已被淘汰，size <= maxSize
      expect(pool.size).toBeLessThanOrEqual(3);
    });

    it('acquire 已存在的子应用会更新 LRU 顺序', () => {
      pool.acquire('system-a');
      pool.acquire('system-b');
      pool.acquire('system-c');
      // 重新访问 system-a（更新 LRU）
      pool.acquire('system-a');
      // 现在淘汰的是 system-b（最久未用）
      pool.acquire('system-d');
      // system-a 还在
      expect(pool.has('system-a')).toBe(true);
    });
  });

  describe('activate / hide', () => {
    it('activate 把 iframe 显示出来', () => {
      const iframe = pool.acquire('system-a');
      pool.activate('system-a');
      expect(iframe.style.display).toBe('block');
    });

    it('切换子应用时，前一个自动隐藏', () => {
      pool.acquire('system-a');
      pool.acquire('system-b');
      pool.activate('system-a');
      pool.activate('system-b');
      // system-a 应该隐藏，system-b 显示
      const a = pool.acquire('system-a');
      expect(a.style.display).toBe('none');
    });
  });

  describe('destroy', () => {
    it('显式销毁某个 iframe', () => {
      pool.acquire('system-a');
      pool.destroy('system-a');
      expect(pool.has('system-a')).toBe(false);
    });

    it('销毁时 iframe src 设为 about:blank 释放内存', () => {
      const iframe = pool.acquire('system-a');
      iframe.src = 'https://example.com/heavy-page';
      pool.destroy('system-a');
      expect(iframe.src).toContain('about:blank');
    });
  });

  describe('clear', () => {
    it('清空所有 iframe', () => {
      pool.acquire('system-a');
      pool.acquire('system-b');
      pool.acquire('system-c');
      pool.clear();
      expect(pool.size).toBe(0);
    });
  });
});