/**
 * 错误上报接口
 *
 * 默认实现：console.error（开发模式）。
 * 可通过 setReporter() 注入 Sentry / 自建平台。
 *
 * @module monitoring/error-tracking
 */

import type { ErrorReporter } from '../core/types';

/** 默认 reporter：仅 console */
const defaultReporter: ErrorReporter = {
  captureException(error, context) {
    console.error('[ErrorTracking]', error.message, context);
  },
  captureMessage(message, level = 'info') {
    const method = level === 'error' ? console.error
      : level === 'warning' ? console.warn
      : console.info;
    method('[ErrorTracking]', message);
  },
  setUser() {
    // noop
  },
};

let activeReporter: ErrorReporter = defaultReporter;

/**
 * 设置错误上报实现
 *
 * @example
 * ```ts
 * import * as Sentry from '@sentry/browser';
 * setReporter({
 *   captureException: (error, context) => Sentry.captureException(error, { contexts: context }),
 *   captureMessage: (msg, level) => Sentry.captureMessage(msg, level),
 *   setUser: (user) => Sentry.setUser(user),
 * });
 * ```
 */
export function setReporter(reporter: ErrorReporter): void {
  activeReporter = reporter;
}

/** 获取当前 reporter */
export function getReporter(): ErrorReporter {
  return activeReporter;
}

/** 上报异常 */
export function captureException(
  error: Error,
  context?: Record<string, unknown>,
): void {
  activeReporter.captureException(error, context);
}

/** 上报消息 */
export function captureMessage(
  message: string,
  level?: 'info' | 'warning' | 'error',
): void {
  activeReporter.captureMessage(message, level);
}

/** 设置用户信息 */
export function setUser(user: { id: string; [key: string]: unknown }): void {
  activeReporter.setUser(user);
}

// ---- 全局错误监听 ----

let globalListening = false;

/**
 * 开启全局错误监听
 *
 * 捕获 window.onerror 和 unhandledrejection。
 */
export function startGlobalErrorListener(): void {
  if (globalListening) return;
  globalListening = true;

  window.addEventListener('error', (e) => {
    if (e.error instanceof Error) {
      captureException(e.error, { source: 'window.onerror' });
    }
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    if (reason instanceof Error) {
      captureException(reason, { source: 'unhandledrejection' });
    } else {
      captureMessage(`Unhandled rejection: ${String(reason)}`, 'error');
    }
  });
}