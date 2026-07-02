/**
 * Trinity Transpiler - Content Script
 *
 * Injected into web pages to perform transpilation analysis
 * Communicates with background service worker and popup
 */

import { TrinityTranspiler, TrinityOutput } from './trinity-core';

declare const chrome: any;

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  if (message.type === 'TRANSPILENT_REQUEST') {
    const { targetElement, options } = message.payload || {};

    try {
      let root: Element | null = null;

      if (targetElement) {
        root = document.querySelector(targetElement);
      }

      if (!root) {
        // Default to data-ske-root attribute or body
        root = document.querySelector('[data-ske-root]') || document.body;
      }

      const transpiler = new TrinityTranspiler(root);
      const result: TrinityOutput = transpiler.transpile();

      // Store result for retrieval
      const resultKey = `trinity-result-${Date.now()}`;
      sessionStorage.setItem(resultKey, JSON.stringify(result));

      sendResponse({
        success: true,
        payload: {
          resultKey,
          stats: result.stats,
          preview: {
            nodeCount: result.stats.finalNodeCount,
            prunedCount: result.stats.prunedWrapperCount,
            anchorCount: result.anchors.length,
          }
        }
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
    }
  }

  if (message.type === 'TRANSPILENT_GET_RESULT') {
    const { resultKey } = message.payload || {};
    try {
      const resultJson = sessionStorage.getItem(resultKey);
      if (resultJson) {
        sendResponse({ success: true, payload: JSON.parse(resultJson) });
      } else {
        sendResponse({ success: false, error: 'Result not found or expired' });
      }
    } catch (error) {
      sendResponse({ success: false, error: (error as Error).message });
    }
  }

  if (message.type === 'HIGHLIGHT_NODE') {
    const { nodeId, enable } = message.payload || {};
    highlightNode(nodeId, enable);
    sendResponse({ success: true });
  }

  return true; // Keep channel open for async response
});

/**
 * Highlight a topology node in the page for debugging/visualization
 */
function highlightNode(nodeId: string, enable: boolean = true) {
  // Remove existing highlights
  document.querySelectorAll('[data-ske-highlight]').forEach(el => {
    el.removeAttribute('data-ske-highlight');
  });

  if (!enable) return;

  // Find elements with matching data-ske-id
  const elements = document.querySelectorAll(`[data-ske-id="${nodeId}"]`);
  elements.forEach(el => {
    el.setAttribute('data-ske-highlight', 'true');
    (el as HTMLElement).style.outline = '2px solid #3b82f6';
  });
}

/**
 * Mark an element as a transpiler root
 */
export function markAsRoot(el: Element, id: string) {
  el.setAttribute('data-ske-root', id);
  el.setAttribute('data-ske-id', id);
}

/**
 * Get layout information for a specific element
 */
export function getElementLayout(selector: string) {
  const el = document.querySelector(selector);
  if (!el) return null;

  const { TrinityTranspiler } = require('./trinity-core');
  const transpiler = new TrinityTranspiler(el);
  return transpiler.transpile();
}

// Signal that content script is ready
console.log('[Trinity Transpiler] Content script loaded');
