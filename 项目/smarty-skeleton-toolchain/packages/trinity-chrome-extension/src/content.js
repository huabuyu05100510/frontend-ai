/**
 * Trinity Transpiler - 骨架屏生成器 v2
 */

function showSkeleton() {
  hideSkeleton();

  const startTime = performance.now();

  try {
    const transpiler = new SkeletonTranspiler({
      preserveLayout: true,
      textToGradient: true,
      minHeight: 4
    });

    const result = transpiler.transpile(document.body);

    if (!result || !result.code) {
      console.error('[Trinity] Failed to generate skeleton');
      return;
    }

    const duration = (performance.now() - startTime).toFixed(1);
    console.log(`[Trinity] Generated in ${duration}ms:`, result.stats);

    // 构建预览HTML
    const preview = document.createElement('div');
    preview.id = 'trinity-preview';
    preview.innerHTML = `
      <div style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;overflow:auto;background:white;">
        <style>
          @keyframes trinity-shimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
          }
        </style>
        <div style="position:relative;width:100%;height:100vh;">
          ${result.code}
        </div>
        <button onclick="this.parentElement.parentElement.remove()" style="position:fixed;top:16px;right:16px;width:40px;height:40px;background:rgba(0,0,0,0.7);color:white;border:none;border-radius:50%;font-size:20px;cursor:pointer;z-index:2147483648;pointer-events:auto;">×</button>
      </div>
    `;

    document.body.appendChild(preview);
    console.log('[Trinity] Skeleton preview shown');

  } catch (e) {
    console.error('[Trinity] Error:', e);
  }
}

function hideSkeleton() {
  const preview = document.getElementById('trinity-preview');
  if (preview) preview.remove();
}

// Chrome消息监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRINITY_SHOW_SKELETON') {
    showSkeleton();
    sendResponse({ success: true });
  }
  if (message.type === 'TRINITY_HIDE_SKELETON') {
    hideSkeleton();
    sendResponse({ success: true });
  }
  return true;
});

console.log('[Trinity] Ready - SkeletonTranspiler v2.0');
