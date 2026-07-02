import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProtocol, parseMessage, validateOrigin, type ShellMessage } from '../protocol';

describe('sdk/protocol', () => {
  describe('validateOrigin', () => {
    it('白名单内的 origin 通过', () => {
      expect(validateOrigin('https://a-cdn.example.com', ['https://a-cdn.example.com']))
        .toBe(true);
    });

    it('不在白名单的 origin 拒绝', () => {
      expect(validateOrigin('https://evil.com', ['https://a-cdn.example.com']))
        .toBe(false);
    });

    it('空 origin（如 file://）默认拒绝', () => {
      expect(validateOrigin('', ['https://a-cdn.example.com'])).toBe(false);
    });

    it('通配符子域匹配', () => {
      expect(validateOrigin('https://sub.example.com', ['https://*.example.com']))
        .toBe(true);
    });
  });

  describe('parseMessage', () => {
    it('合法消息返回结构化对象', () => {
      const data = { type: 'route:sync', path: '/user/list' };
      const msg = parseMessage(data);
      expect(msg).toEqual(data);
    });

    it('非对象数据返回 null', () => {
      expect(parseMessage(null)).toBeNull();
      expect(parseMessage('string')).toBeNull();
      expect(parseMessage(123)).toBeNull();
    });

    it('没有 type 字段返回 null', () => {
      expect(parseMessage({ foo: 'bar' })).toBeNull();
    });

    it('未知 type 仍然返回（兼容未来扩展）', () => {
      expect(parseMessage({ type: 'future:type' })).toEqual({ type: 'future:type' });
    });

    it('已知 type 列表', () => {
      // 列举所有支持的 type
      const knownTypes: ShellMessage['type'][] = [
        'auth:sync',
        'auth:logout',
        'route:navigate',
        'route:sync',
        'theme:change',
        'resize:report',
        'subapp:ready',
        'subapp:error',
      ];
      for (const t of knownTypes) {
        const result = parseMessage({ type: t });
        expect(result?.type).toBe(t);
      }
    });
  });

  describe('createProtocol', () => {
    let protocol: ReturnType<typeof createProtocol>;
    let onMessage: ReturnType<typeof vi.fn>;
    let targetWindow: any;
    let postMessageSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      onMessage = vi.fn();
      targetWindow = { postMessage: vi.fn() };
      postMessageSpy = targetWindow.postMessage;
      protocol = createProtocol({
        targetOrigin: 'https://a-cdn.example.com',
        allowedOrigins: ['https://a-cdn.example.com'],
        onMessage,
        targetWindow: () => targetWindow,
      });
    });

    it('send 调用 targetWindow.postMessage 并指定 origin', () => {
      protocol.send({ type: 'auth:sync', token: 'xxx', user: { id: '1' } });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'auth:sync' }),
        'https://a-cdn.example.com'
      );
    });

    it('handleMessage 验证 origin 后再触发 onMessage', () => {
      const event = new MessageEvent('message', {
        origin: 'https://a-cdn.example.com',
        data: { type: 'route:sync', path: '/user/list' },
      });
      protocol.handleMessage(event);
      expect(onMessage).toHaveBeenCalledWith({ type: 'route:sync', path: '/user/list' });
    });

    it('handleMessage 拒绝非白名单 origin', () => {
      const event = new MessageEvent('message', {
        origin: 'https://evil.com',
        data: { type: 'route:sync', path: '/user/list' },
      });
      protocol.handleMessage(event);
      expect(onMessage).not.toHaveBeenCalled();
    });

    it('handleMessage 拒绝非结构化消息', () => {
      const event = new MessageEvent('message', {
        origin: 'https://a-cdn.example.com',
        data: 'string',
      });
      protocol.handleMessage(event);
      expect(onMessage).not.toHaveBeenCalled();
    });
  });
});