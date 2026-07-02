import { describe, it, expect } from 'vitest';
import { buildIframeUrl, shouldChangeSubApp } from '../iframe-router';

describe('router/iframe-router', () => {
  describe('buildIframeUrl', () => {
    it('构造完整的 iframe URL（带 search）', () => {
      const url = buildIframeUrl(
        {
          id: 'system-a',
          name: '用户中心',
          baseUrl: 'https://a-cdn.example.com/system-a',
          activeRule: '/system-a',
          container: '#subapp-frame',
          basename: '/system-a',
        },
        '/system-a/user/list',
        '?tab=profile'
      );
      expect(url).toBe('https://a-cdn.example.com/system-a/user/list?tab=profile');
    });

    it('不带 search 参数', () => {
      const url = buildIframeUrl(
        {
          id: 'system-a',
          name: '用户中心',
          baseUrl: 'https://a-cdn.example.com/system-a',
          activeRule: '/system-a',
          container: '#subapp-frame',
          basename: '/system-a',
        },
        '/system-a/user/list',
        ''
      );
      expect(url).toBe('https://a-cdn.example.com/system-a/user/list');
    });

    it('开发环境指向本地端口', () => {
      const url = buildIframeUrl(
        {
          id: 'system-a',
          name: '用户中心',
          baseUrl: 'http://127.0.0.1:5181',
          activeRule: '/system-a',
          container: '#subapp-frame',
          basename: '/system-a',
        },
        '/system-a/user/list'
      );
      expect(url).toBe('http://127.0.0.1:5181/user/list');
    });
  });

  describe('shouldChangeSubApp', () => {
    const appA = {
      id: 'system-a', name: 'A', baseUrl: '', activeRule: '/system-a',
      container: '', basename: '/system-a',
    };
    const appB = {
      id: 'system-b', name: 'B', baseUrl: '', activeRule: '/system-b',
      container: '', basename: '/system-b',
    };

    it('同子应用内路由变化 → 不需要切换', () => {
      expect(shouldChangeSubApp(appA, appA, '/system-a/user/list', '/system-a/user/detail/123'))
        .toBe(false);
    });

    it('不同子应用之间 → 需要切换', () => {
      expect(shouldChangeSubApp(appA, appB, '/system-a/user/list', '/system-b/order/pending'))
        .toBe(true);
    });

    it('从 null 切换到子应用 → 需要切换', () => {
      expect(shouldChangeSubApp(null, appA, '/', '/system-a/user/list'))
        .toBe(true);
    });

    it('从子应用切到 null（如访问 /profile） → 需要切换（iframe 卸载）', () => {
      expect(shouldChangeSubApp(appA, null, '/system-a/user/list', '/profile'))
        .toBe(true);
    });

    it('两者都是 null → 不需要切换', () => {
      expect(shouldChangeSubApp(null, null, '/', '/profile'))
        .toBe(false);
    });
  });
});