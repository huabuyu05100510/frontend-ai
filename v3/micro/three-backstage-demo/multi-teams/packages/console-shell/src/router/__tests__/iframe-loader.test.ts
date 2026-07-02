import { describe, it, expect, beforeEach } from 'vitest';
import { resolveIframeUrl, buildPreloadHints, IFRAME_LIMITS } from '../iframe-loader';

describe('router/iframe-loader', () => {
  describe('resolveIframeUrl', () => {
    it('拼接子应用 baseUrl + 当前路径 + 查询参数', () => {
      const url = resolveIframeUrl(
        { id: 'a', name: 'A', baseUrl: 'https://a.example.com', activeRule: '/a', container: '#', basename: '/a' },
        '/system-a/user/list',
        '?tab=profile'
      );
      expect(url).toBe('https://a.example.com/system-a/user/list?tab=profile');
    });

    it('无查询参数时不附加 ?', () => {
      const url = resolveIframeUrl(
        { id: 'a', name: 'A', baseUrl: 'https://a.example.com', activeRule: '/a', container: '#', basename: '/a' },
        '/system-a/dashboard',
        ''
      );
      expect(url).toBe('https://a.example.com/system-a/dashboard');
    });

    it('保留 hash', () => {
      const url = resolveIframeUrl(
        { id: 'a', name: 'A', baseUrl: 'https://a.example.com', activeRule: '/a', container: '#', basename: '/a' },
        '/system-a/user/123',
        '#section'
      );
      expect(url).toBe('https://a.example.com/system-a/user/123#section');
    });
  });

  describe('buildPreloadHints', () => {
    it('生成 preload + preconnect 两种 hint', () => {
      const hints = buildPreloadHints({
        id: 'a', name: 'A', baseUrl: 'https://a.example.com',
        activeRule: '/a', container: '#', basename: '/a',
      }, '/system-a/user/list');
      expect(hints).toHaveLength(2);
      expect(hints[0]).toMatchObject({ rel: 'preload', as: 'document' });
      expect(hints[0].href).toBe('https://a.example.com/system-a/user/list');
      expect(hints[1]).toMatchObject({ rel: 'preconnect', href: 'https://a.example.com' });
    });
  });

  describe('IFRAME_LIMITS', () => {
    it('限制同时存在的 iframe 数量', () => {
      expect(IFRAME_LIMITS.MAX_ACTIVE_IFRAMES).toBeGreaterThanOrEqual(2);
      expect(IFRAME_LIMITS.MAX_ACTIVE_IFRAMES).toBeLessThanOrEqual(5);
    });

    it('限制每个 iframe 内存预算', () => {
      expect(IFRAME_LIMITS.PER_IFRAME_MEMORY_MB).toBeGreaterThan(0);
    });
  });
});