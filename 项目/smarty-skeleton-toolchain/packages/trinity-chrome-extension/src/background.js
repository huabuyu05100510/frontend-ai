/**
 * Trinity Transpiler - Background Service Worker
 *
 * Handles communication between content scripts and popup
 * Manages extension state and transpilation results
 */

// Store for transpilation results (in-memory cache)
const resultCache = new Map();
const MAX_CACHE_SIZE = 50;

// Listen for installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Trinity Transpiler] Extension installed');
  } else if (details.reason === 'update') {
    console.log('[Trinity Transpiler] Extension updated');
  }
});

// Handle messages from popup/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case 'STORE_RESULT':
      handleStoreResult(payload);
      sendResponse({ success: true });
      break;

    case 'GET_RESULT':
      const result = handleGetResult(payload.key);
      sendResponse({ success: !!result, result });
      break;

    case 'GET_STATS':
      const stats = handleGetStats();
      sendResponse({ success: true, stats });
      break;

    case 'CLEAR_CACHE':
      resultCache.clear();
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true;
});

function handleStoreResult(payload) {
  // Implement LRU eviction if cache is full
  if (resultCache.size >= MAX_CACHE_SIZE) {
    const firstKey = resultCache.keys().next().value;
    resultCache.delete(firstKey);
  }
  resultCache.set(payload.key, payload.data);
  console.log(`[Trinity] Stored result: ${payload.key}`);
}

function handleGetResult(key) {
  const result = resultCache.get(key);
  if (result) {
    console.log(`[Trinity] Retrieved result: ${key}`);
  }
  return result || null;
}

function handleGetStats() {
  const stats = {
    cachedResults: resultCache.size,
    timestamp: new Date().toISOString(),
  };
  return stats;
}

// Badge management
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'UPDATE_BADGE') {
    const { count, color } = message.payload || {};
    chrome.action.setBadgeText({ text: count ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: color || '#3b82f6' });
  }
});

console.log('[Trinity Transpiler] Background service worker initialized');
