import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveBasename, DOMAIN_BASENAME_MAP, isLegacyDomain } from '../domains';

describe('domains config', () => {
  describe('DOMAIN_BASENAME_MAP', () => {
    it('包含所有预期的二级域名映射', () => {
      expect(DOMAIN_BASENAME_MAP['a.example.com']).toBe('/system-a');
      expect(DOMAIN_BASENAME_MAP['b.example.com']).toBe('/system-b');
      expect(DOMAIN_BASENAME_MAP['c.example.com']).toBe('/system-c');
      expect(DOMAIN_BASENAME_MAP['console.example.com']).toBe('');
    });
  });

  describe('resolveBasename', () => {
    let originalLocation: Location;

    beforeEach(() => {
      originalLocation = window.location;
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function mockHostname(hostname: string) {
      // 用 stubGlobal 完全替换 location 对象
      const newLocation = {
        ...originalLocation,
        hostname,
        href: `https://${hostname}/`,
        origin: `https://${hostname}`,
        protocol: 'https:',
        host: hostname,
        pathname: '/',
        port: '',
        search: '',
        hash: '',
      } as Location;
      vi.stubGlobal('location', newLocation);
    }

    it('a.example.com → /system-a', () => {
      mockHostname('a.example.com');
      expect(resolveBasename()).toBe('/system-a');
    });

    it('b.example.com → /system-b', () => {
      mockHostname('b.example.com');
      expect(resolveBasename()).toBe('/system-b');
    });

    it('c.example.com → /system-c', () => {
      mockHostname('c.example.com');
      expect(resolveBasename()).toBe('/system-c');
    });

    it('console.example.com → 空字符串', () => {
      mockHostname('console.example.com');
      expect(resolveBasename()).toBe('');
    });

    it('localhost → 空字符串（开发环境）', () => {
      mockHostname('localhost');
      expect(resolveBasename()).toBe('');
    });

    it('未配置的域名 → 空字符串（fallback 到一站式模式）', () => {
      mockHostname('unknown.com');
      expect(resolveBasename()).toBe('');
    });
  });

  describe('isLegacyDomain', () => {
    it('a.example.com 是老域名', () => {
      expect(isLegacyDomain('a.example.com')).toBe(true);
    });

    it('b.example.com 是老域名', () => {
      expect(isLegacyDomain('b.example.com')).toBe(true);
    });

    it('c.example.com 是老域名', () => {
      expect(isLegacyDomain('c.example.com')).toBe(true);
    });

    it('console.example.com 不是老域名', () => {
      expect(isLegacyDomain('console.example.com')).toBe(false);
    });

    it('localhost 不是老域名', () => {
      expect(isLegacyDomain('localhost')).toBe(false);
    });
  });
});