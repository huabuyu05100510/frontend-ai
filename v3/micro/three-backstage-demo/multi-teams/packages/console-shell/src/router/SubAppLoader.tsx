import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { matchSubApp } from '../subapps/registry';
import { buildIframeUrl, shouldChangeSubApp } from './iframe-router';
import { globalIframePool } from '../perf/iframe-pool';
import { useAuthStore } from '../store/auth';
import { createProtocol } from '../sdk/protocol';

/**
 * iframe Loader：根据当前 URL 加载对应子应用
 *
 * 性能优化：
 *   - 全局 iframe 池（LRU + maxSize=3）
 *   - 同子应用切换只改 src（< 100ms）
 *   - 不同子应用切换复用 iframe 池
 */
export function SubAppLoader() {
  const location = useLocation();
  const token = useAuthStore(s => s.token);
  const user = useAuthStore(s => s.user);

  const currentApp = matchSubApp(location.pathname);
  const lastAppIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentApp) return;

    const needSwitch = shouldChangeSubApp(
      lastAppIdRef.current ? { id: lastAppIdRef.current } as any : null,
      currentApp,
      location.pathname,
      location.pathname
    );

    if (lastAppIdRef.current !== currentApp.id || needSwitch) {
      // ⭐ 关键：从池里取 iframe，复用而不重建
      const iframe = globalIframePool.acquire(currentApp.id);
      const url = buildIframeUrl(currentApp, location.pathname, location.search);
      
      // ⭐ 性能优化：只在 URL 不同时才设置 src（避免无谓重载）
      const currentSrc = iframe.src;
      const targetOrigin = new URL(currentApp.baseUrl).origin;
      if (!currentSrc || !currentSrc.startsWith(currentApp.baseUrl) || currentSrc !== url) {
        iframe.src = url;
      }

      globalIframePool.activate(currentApp.id);

      // ⭐ 关键：登录态同步到 iframe（postMessage）
      const protocol = createProtocol({
        targetOrigin,
        allowedOrigins: [targetOrigin],
        onMessage: msg => {
          // 监听子应用上报的消息
          if (msg.type === 'route:sync') {
            // 子应用路由变化 → 同步到 Shell 地址栏
            if (window.location.pathname !== msg.path) {
              window.history.replaceState(null, '', msg.path);
            }
          } else if (msg.type === 'auth:logout') {
            // 子应用登出 → Shell 也登出
            useAuthStore.getState().logout();
          }
        },
        targetWindow: () => iframe.contentWindow,
      });

      // 监听来自子应用的消息
      const messageHandler = (e: MessageEvent) => protocol.handleMessage(e);
      window.addEventListener('message', messageHandler);

      // 登录态下发
      if (token && user) {
        protocol.send({ type: 'auth:sync', token, user });
      }

      lastAppIdRef.current = currentApp.id;

      return () => {
        window.removeEventListener('message', messageHandler);
      };
    }
  }, [currentApp, location.pathname, location.search, token, user]);

  if (!currentApp) return null;

  // 渲染当前激活的 iframe（display 控制）
  return <IframeRenderer />;
}

function IframeRenderer() {
  // 子应用的 iframe 已经通过 pool 挂载到 document.body
  // 这里返回 null，iframe 由 pool 管理
  return null;
}