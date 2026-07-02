/**
 * Trinity Transpiler - Popup Script
 */

const btnShow = document.getElementById('btnShow');
const btnHide = document.getElementById('btnHide');

// Show skeleton on current tab
btnShow.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Content script is already injected via manifest.json
    // Just send message to show skeleton
    await chrome.tabs.sendMessage(tab.id, { type: 'TRINITY_SHOW_SKELETON' });

    // Close popup
    window.close();
  } catch (error) {
    console.error('Error:', error);
    alert('Error: ' + error.message);
  }
});

// Hide skeleton on current tab
btnHide.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'TRINITY_HIDE_SKELETON' });
    window.close();
  } catch (error) {
    console.error('Error:', error);
  }
});
