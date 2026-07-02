/**
 * 键盘快捷键注册 Hook
 *
 * 统一管理场景级键盘快捷键，自动清理。
 *
 * @module hooks/useKeyboardNav
 */

import { useEffect } from 'react';

interface KeyBinding {
  /** 按键 */
  key: string;
  /** 是否需要 Shift */
  shiftKey?: boolean;
  /** 是否需要 Ctrl/Meta */
  ctrlKey?: boolean;
  /** 处理函数 */
  handler: () => void;
  /** 描述（用于文档） */
  description: string;
}

/**
 * 注册键盘快捷键
 *
 * @example
 * ```ts
 * useKeyboardNav([
 *   { key: 'F8', handler: focusNext, description: '下一个错误' },
 *   { key: 'F8', shiftKey: true, handler: focusPrev, description: '上一个错误' },
 *   { key: 'Escape', handler: closeTooltip, description: '关闭' },
 * ]);
 * ```
 */
export function useKeyboardNav(bindings: KeyBinding[]): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      for (const binding of bindings) {
        if (
          e.key === binding.key &&
          !!e.shiftKey === !!binding.shiftKey &&
          !!e.ctrlKey === !!binding.ctrlKey
        ) {
          // 防止 F8 等快捷键触发浏览器默认行为
          if (binding.key.startsWith('F') || binding.key === 'Escape') {
            e.preventDefault();
          }
          binding.handler();
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [bindings]);
}