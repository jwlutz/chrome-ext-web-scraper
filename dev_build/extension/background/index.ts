// Background service worker - message routing and state management
// Phase 1: Handle icon clicks, toggle modal via content script

// Track which tabs have content scripts ready
const tabState = new Map<number, { ready: boolean; url: string }>();

// Listen for extension icon click → send TOGGLE_MODAL to content script
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MODAL' });
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Handle content script ready notification
  if (msg.type === 'CONTENT_READY' && sender.tab?.id) {
    tabState.set(sender.tab.id, {
      ready: true,
      url: msg.payload.url
    });
    console.log('[Yoink] Content script ready on tab', sender.tab.id, msg.payload.url);
    return;
  }

  // Handle state request from content script
  if (msg.type === 'GET_STATE' && sender.tab?.id) {
    const state = tabState.get(sender.tab.id);
    sendResponse({ ready: state?.ready ?? false });
    return;
  }

  return true; // Keep channel open for async responses
});

// Clean up state when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

// Reset state when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabState.delete(tabId);
  }
});

console.log('[Yoink] Background service worker started');
