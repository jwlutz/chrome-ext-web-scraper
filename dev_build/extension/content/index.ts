// Content script - thin wrapper that imports from core/
// Phase 1: Minimal implementation for connection testing

console.log('[Yoink] Content script loaded:', location.href);

// Notify background script that content script is ready
chrome.runtime.sendMessage({ type: 'CONTENT_READY', payload: { url: location.href } });

// Listen for messages from background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PING') {
    sendResponse({ success: true });
  }
  return true; // Keep channel open for async response
});
