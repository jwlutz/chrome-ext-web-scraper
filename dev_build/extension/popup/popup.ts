// Popup UI logic
// Phase 1: Minimal implementation - just show connection status

const statusEl = document.getElementById('status');

function updateStatus(connected: boolean, url?: string) {
  if (!statusEl) return;

  if (connected) {
    statusEl.textContent = 'Connected';
    statusEl.className = 'status status-connected';
  } else {
    statusEl.textContent = 'Content script not loaded';
    statusEl.className = 'status status-disconnected';
  }
}

// Request state from background script
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
  if (chrome.runtime.lastError) {
    console.error('[Yoink] Error getting state:', chrome.runtime.lastError);
    updateStatus(false);
    return;
  }

  updateStatus(response?.contentScriptReady ?? false, response?.currentUrl);
});
