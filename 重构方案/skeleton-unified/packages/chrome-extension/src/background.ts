// Service worker: 处理 icon 点击 + 热重载轮询
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'SKE_TOGGLE' }).catch(() => {
      // content script 可能尚未注入（如 chrome:// 页面），静默忽略
    })
  }
})

// ─── 热重载：轮询 vite build --watch 的 hash 端点 ────────────────────────────
// 检测到 hash 变化后自动 chrome.runtime.reload()，无需手动在扩展管理页刷新

const RELOAD_PORT = 7779
let lastHash = ''

async function checkReload() {
  try {
    const res = await fetch(`http://localhost:${RELOAD_PORT}`)
    if (!res.ok) return
    const { hash } = await res.json() as { hash: string }
    if (lastHash && hash !== lastHash) {
      console.log(`[skeleton-ext] 检测到更新 (${lastHash} → ${hash})，自动重载...`)
      chrome.runtime.reload()
    }
    lastHash = hash
  } catch {
    // 本地 vite 未运行，静默忽略
  }
}

// 每 2 秒检查一次
setInterval(checkReload, 2000)
checkReload()