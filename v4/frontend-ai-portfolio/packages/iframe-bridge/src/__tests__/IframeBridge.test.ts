import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IframeBridge } from '../IframeBridge';
import { BridgeErrorCode, InternalMethods } from '../constants';
import {
  BridgeTimeoutError,
  BridgeDestroyedError,
  BridgeVersionMismatchError,
} from '../errors';

// ============================================================
// Test Helpers
// ============================================================

/**
 * Create a pair of bridges that communicate via postMessage on the same
 * jsdom window.  We mock postMessage to route messages to the other bridge's
 * handleMessage listener via dispatchEvent.
 */
function createBridgePair(origin: string = '*') {
  const hostBridge = new IframeBridge(window as unknown as Window, origin);
  const guestBridge = new IframeBridge(window as unknown as Window, origin);

  // Override postMessage on both bridges to intercept and dispatch
  const originalHostPost = (hostBridge as any).postMessage.bind(hostBridge);
  const originalGuestPost = (guestBridge as any).postMessage.bind(guestBridge);

  (hostBridge as any).postMessage = (msg: unknown) => {
    const event = new MessageEvent('message', {
      data: msg,
      source: {} as Window,
      origin,
    });
    setTimeout(() => {
      // Simulate Guest receiving Host's message
      (guestBridge as any).handleMessage(event);
    }, 0);
  };

  (guestBridge as any).postMessage = (msg: unknown) => {
    const event = new MessageEvent('message', {
      data: msg,
      source: {} as Window,
      origin,
    });
    setTimeout(() => {
      // Simulate Host receiving Guest's message
      (hostBridge as any).handleMessage(event);
    }, 0);
  };

  return { hostBridge, guestBridge };
}

/** Wait for microtasks to flush */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

// ============================================================
// 6.1 request/response 正常通信流程
// ============================================================

describe('IframeBridge — request/response', () => {
  let hostBridge: IframeBridge;
  let guestBridge: IframeBridge;

  beforeEach(() => {
    const pair = createBridgePair();
    hostBridge = pair.hostBridge;
    guestBridge = pair.guestBridge;
  });

  afterEach(() => {
    hostBridge.destroy();
    guestBridge.destroy();
  });

  it('should resolve with the result when Guest responds', async () => {
    guestBridge.on('app.health', async () => ({ status: 'ok' }));

    const result = await hostBridge.request('app.health');
    expect(result).toEqual({ status: 'ok' });
  });

  it('should return an error when method is not registered', async () => {
    try {
      await hostBridge.request('unknown.method');
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe(BridgeErrorCode.METHOD_NOT_FOUND);
      expect(err.message).toContain('unknown.method');
    }
  });

  it('should support typed generic requests', async () => {
    interface TokenResponse {
      token: string;
      expiresAt: number;
    }

    guestBridge.on('auth.getToken', async (): Promise<TokenResponse> => ({
      token: 'jwt-abc-123',
      expiresAt: 1700000000,
    }));

    const result = await hostBridge.request<TokenResponse>('auth.getToken');
    expect(result.token).toBe('jwt-abc-123');
    expect(typeof result.expiresAt).toBe('number');
  });

  it('should handle concurrent requests independently', async () => {
    guestBridge.on('slow', async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 'slow-result';
    });
    guestBridge.on('fast', async () => 'fast-result');

    const [slow, fast] = await Promise.all([
      hostBridge.request('slow'),
      hostBridge.request('fast'),
    ]);

    expect(slow).toBe('slow-result');
    expect(fast).toBe('fast-result');
  });

  it('should pass params correctly', async () => {
    guestBridge.on('echo', async (params) => params);

    const result = await hostBridge.request('echo', { foo: 'bar', num: 42 });
    expect(result).toEqual({ foo: 'bar', num: 42 });
  });
});

// ============================================================
// 6.2 notification 单向广播
// ============================================================

describe('IframeBridge — notification', () => {
  let hostBridge: IframeBridge;
  let guestBridge: IframeBridge;

  beforeEach(() => {
    const pair = createBridgePair();
    hostBridge = pair.hostBridge;
    guestBridge = pair.guestBridge;
  });

  afterEach(() => {
    hostBridge.destroy();
    guestBridge.destroy();
  });

  it('should deliver notification without id', async () => {
    const received: unknown[] = [];
    guestBridge.on('layout.resize', (params) => {
      received.push(params);
    });

    hostBridge.notify('layout.resize', { width: 1200, height: 800 });
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ width: 1200, height: 800 });
  });

  it('should not create a pending request for notifications', async () => {
    hostBridge.notify('layout.resize', { width: 1200 });

    // @ts-expect-error accessing private field for testing
    expect(hostBridge.pendingRequests.size).toBe(0);
  });

  it('should silently ignore if no handler is registered for notification', async () => {
    expect(() => {
      hostBridge.notify('nonexistent.event', { data: 1 });
    }).not.toThrow();
  });
});

// ============================================================
// 6.3 超时熔断
// ============================================================

describe('IframeBridge — timeout', () => {
  it('should reject with BridgeTimeoutError when timeout exceeded', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    // Register a handler that never responds
    guestBridge.on('slow.op', () => new Promise(() => {}));

    try {
      await hostBridge.request('slow.op', {}, 100);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeTimeoutError);
      expect((err as BridgeTimeoutError).message).toContain('slow.op');
      expect((err as BridgeTimeoutError).message).toContain('100ms');
    }

    hostBridge.destroy();
    guestBridge.destroy();
  });

  it('should not reject if response arrives before timeout', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    guestBridge.on('quick', async () => 'done');

    const result = await hostBridge.request('quick', {}, 5000);
    expect(result).toBe('done');

    hostBridge.destroy();
    guestBridge.destroy();
  });

  it('should ignore late responses after timeout', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    let resolveLate: (v: string) => void;
    guestBridge.on('delayed', () => {
      return new Promise<string>((resolve) => {
        resolveLate = resolve;
      });
    });

    const reqPromise = hostBridge.request('delayed', {}, 50);

    try {
      await reqPromise;
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeTimeoutError);
    }

    // Now resolve the late response — should not affect the already-rejected promise
    resolveLate!('too-late');
    await flush();

    // @ts-expect-error accessing private field
    expect(hostBridge.pendingRequests.size).toBe(0);

    hostBridge.destroy();
    guestBridge.destroy();
  });
});

// ============================================================
// 6.4 Method Not Found
// ============================================================

describe('IframeBridge — Method Not Found', () => {
  it('should return error code -32601 for unregistered methods', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    try {
      await hostBridge.request('nonexistent.method');
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe(BridgeErrorCode.METHOD_NOT_FOUND);
      expect(err.message).toContain('nonexistent.method');
    }

    hostBridge.destroy();
    guestBridge.destroy();
  });

  it('should return -32601 after method is removed via off()', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    guestBridge.on('temp.method', async () => 'ok');
    guestBridge.off('temp.method');

    try {
      await hostBridge.request('temp.method');
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe(BridgeErrorCode.METHOD_NOT_FOUND);
    }

    hostBridge.destroy();
    guestBridge.destroy();
  });
});

// ============================================================
// 6.5 on/off 动态注册和移除
// ============================================================

describe('IframeBridge — on/off', () => {
  it('should register a handler and make it callable', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    const handler = vi.fn(async (params) => ({ echoed: params }));
    guestBridge.on('test.method', handler);

    const result = await hostBridge.request('test.method', { key: 'val' });
    expect(result).toEqual({ echoed: { key: 'val' } });
    expect(handler).toHaveBeenCalledTimes(1);

    hostBridge.destroy();
    guestBridge.destroy();
  });

  it('should remove handler and make method unreachable', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    guestBridge.on('temp.method', async () => 'ok');
    const r1 = await hostBridge.request('temp.method');
    expect(r1).toBe('ok');

    guestBridge.off('temp.method');

    try {
      await hostBridge.request('temp.method');
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe(BridgeErrorCode.METHOD_NOT_FOUND);
    }

    hostBridge.destroy();
    guestBridge.destroy();
  });

  it('should allow re-registering the same method', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    guestBridge.on('test.method', async () => 'v1');
    let result = await hostBridge.request('test.method');
    expect(result).toBe('v1');

    guestBridge.on('test.method', async () => 'v2');
    result = await hostBridge.request('test.method');
    expect(result).toBe('v2');

    hostBridge.destroy();
    guestBridge.destroy();
  });
});

// ============================================================
// 6.6 handshake 版本协商
// ============================================================

describe('IframeBridge — handshake', () => {
  it('should complete handshake with matching versions', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    guestBridge.on(InternalMethods.BRIDGE_HANDSHAKE, async (params: any) => ({
      version: params.version,
      capabilities: ['app.health', 'app.ready', 'app.getState'],
    }));

    const result = await hostBridge.handshake('2.0');
    expect(result.version).toBe('2.0');
    expect(result.capabilities).toContain('app.health');

    hostBridge.destroy();
    guestBridge.destroy();
  });

  it('should reject on version mismatch', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    guestBridge.on(InternalMethods.BRIDGE_HANDSHAKE, async () => ({
      version: '1.0',
      capabilities: [],
    }));

    try {
      await hostBridge.handshake('2.0');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeVersionMismatchError);
    }

    hostBridge.destroy();
    guestBridge.destroy();
  });
});

// ============================================================
// 6.7 destroy 清理验证
// ============================================================

describe('IframeBridge — destroy', () => {
  it('should reject all pending promises with BridgeDestroyedError', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    guestBridge.on('slow', () => new Promise(() => {}));

    const p1 = hostBridge.request('slow', {}, 99999);
    const p2 = hostBridge.request('slow', {}, 99999);

    hostBridge.destroy();

    await expect(p1).rejects.toBeInstanceOf(BridgeDestroyedError);
    await expect(p2).rejects.toBeInstanceOf(BridgeDestroyedError);

    guestBridge.destroy();
  });

  it('should reject new requests after destroy', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    hostBridge.destroy();

    await expect(hostBridge.request('any.method')).rejects.toBeInstanceOf(BridgeDestroyedError);

    guestBridge.destroy();
  });

  it('should be idempotent (safe to call destroy multiple times)', () => {
    const { hostBridge, guestBridge } = createBridgePair();

    expect(() => {
      hostBridge.destroy();
      hostBridge.destroy();
      hostBridge.destroy();
    }).not.toThrow();

    guestBridge.destroy();
  });

  it('should not throw when notify is called after destroy', () => {
    const { hostBridge, guestBridge } = createBridgePair();

    hostBridge.destroy();

    expect(() => {
      hostBridge.notify('some.event', {});
    }).not.toThrow();

    guestBridge.destroy();
  });
});

// ============================================================
// 6.8 targetOrigin 场景
// ============================================================

describe('IframeBridge — targetOrigin', () => {
  it('should work with explicit origin', async () => {
    const pair = createBridgePair('https://app.example.com');

    pair.guestBridge.on('ping', async () => 'pong');

    const result = await pair.hostBridge.request('ping');
    expect(result).toBe('pong');

    pair.hostBridge.destroy();
    pair.guestBridge.destroy();
  });
});

// ============================================================
// Edge Cases
// ============================================================

describe('IframeBridge — edge cases', () => {
  it('should handle handler that throws synchronously', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    guestBridge.on('broken', () => {
      throw new Error('sync error');
    });

    try {
      await hostBridge.request('broken');
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe(BridgeErrorCode.INTERNAL_ERROR);
      expect(err.message).toContain('sync error');
    }

    hostBridge.destroy();
    guestBridge.destroy();
  });

  it('should handle handler that rejects asynchronously', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    guestBridge.on('broken', async () => {
      throw new Error('async error');
    });

    try {
      await hostBridge.request('broken');
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe(BridgeErrorCode.INTERNAL_ERROR);
      expect(err.message).toContain('async error');
    }

    hostBridge.destroy();
    guestBridge.destroy();
  });

  it('should handle null/undefined params', async () => {
    const { hostBridge, guestBridge } = createBridgePair();

    guestBridge.on('noop', async () => 'ok');

    const r1 = await hostBridge.request('noop');
    expect(r1).toBe('ok');

    const r2 = await hostBridge.request('noop', null);
    expect(r2).toBe('ok');

    hostBridge.destroy();
    guestBridge.destroy();
  });

  it('should handle notification to unregistered handler (silent)', () => {
    const { hostBridge, guestBridge } = createBridgePair();

    expect(() => {
      hostBridge.notify('no.such.notification', { x: 1 });
    }).not.toThrow();

    hostBridge.destroy();
    guestBridge.destroy();
  });
});