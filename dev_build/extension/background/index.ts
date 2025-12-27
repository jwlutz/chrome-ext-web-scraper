// Background service worker - message routing and state management
// Phase 1: Minimal implementation for connection testing

// Track which tabs have content scripts ready
const tabState = new Map<number, { ready: boolean; url: string }>();

// Listen for messages from content scripts and popup
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

  // Handle popup requesting state
  if (msg.type === 'GET_STATE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ contentScriptReady: false, currentUrl: '' });
        return;
      }

      const state = tabState.get(tab.id);
      sendResponse({
        contentScriptReady: state?.ready ?? false,
        currentUrl: state?.url ?? tab.url ?? ''
      });
    });
    return true; // Keep channel open for async response
  }
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
