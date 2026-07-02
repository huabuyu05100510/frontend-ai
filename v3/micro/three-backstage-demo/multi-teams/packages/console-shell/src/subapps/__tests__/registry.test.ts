import { describe, it, expect } from 'vitest';
import { SUB_APP_REGISTRY, matchSubApp, parseActiveRule } from '../registry';

describe('subapps/registry', () => {
  describe('matchSubApp', () => {
    it('系统 A 路径匹配 system-a', () => {
      const app = matchSubApp('/system-a/user/list');
      expect(app?.id).toBe('system-a');
    });

    it('系统 B 路径匹配 system-b', () => {
      const app = matchSubApp('/system-b/order/pending');
      expect(app?.id).toBe('system-b');
    });

    it('系统 C 路径匹配 system-c', () => {
      const app = matchSubApp('/system-c/product/create');
      expect(app?.id).toBe('system-c');
    });

    it('未知路径返回 null', () => {
      expect(matchSubApp('/')).toBeNull();
      expect(matchSubApp('/profile')).toBeNull();
    });

    it('精确匹配 system-a 根路径（带斜杠）', () => {
      expect(matchSubApp('/system-a')?.id).toBe('system-a');
      expect(matchSubApp('/system-a/')?.id).toBe('system-a');
    });

    it('不会把 /system-abc 错配为 system-a', () => {
      // /system-abc 不应该匹配 /system-a
      expect(matchSubApp('/system-abc/list')).toBeNull();
    });
  });

  describe('parseActiveRule', () => {
    it('解析字符串前缀', () => {
      const re = parseActiveRule('/system-a');
      expect(re.test('/system-a/user')).toBe(true);
      expect(re.test('/system-a')).toBe(true);
      expect(re.test('/system-abc')).toBe(false);
      expect(re.test('/other')).toBe(false);
    });

    it('解析正则表达式', () => {
      const re = parseActiveRule(/^\/system-a(\/|$)/);
      expect(re.test('/system-a/user')).toBe(true);
      expect(re.test('/system-a')).toBe(true);
      expect(re.test('/system-abc')).toBe(false);
    });
  });

  describe('SUB_APP_REGISTRY', () => {
    it('至少注册了三个子应用', () => {
      expect(SUB_APP_REGISTRY.length).toBeGreaterThanOrEqual(3);
    });

    it('每个子应用必须有 id/name/baseUrl/container', () => {
      for (const app of SUB_APP_REGISTRY) {
        expect(app.id).toBeTruthy();
        expect(app.name).toBeTruthy();
        expect(app.baseUrl).toMatch(/^https?:\/\//);
        expect(app.container).toBeTruthy();
      }
    });
  });
});