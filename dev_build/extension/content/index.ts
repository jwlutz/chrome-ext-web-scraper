// Content script - thin wrapper that imports from core/
// Phase 1: Modal injection and toggle via Shadow DOM

// Import modal HTML and CSS as raw strings (Vite ?raw imports)
import modalHTML from './modal.html?raw';
import modalCSS from './modal.css?raw';

console.log('[Yoink] Content script loaded:', location.href);

// Notify background script that content script is ready
chrome.runtime.sendMessage({ type: 'CONTENT_READY', payload: { url: location.href } });

// Modal state
let modalHost: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let isModalVisible = false;

// Create modal in Shadow DOM (closed mode for style isolation)
function createModal(): void {
  modalHost = document.createElement('div');
  modalHost.id = 'yoink-modal-host';

  // Use closed shadow DOM to fully isolate styles
  shadowRoot = modalHost.attachShadow({ mode: 'closed' });

  // Inject styles and HTML
  shadowRoot.innerHTML = `<style>${modalCSS}</style>${modalHTML}`;

  // Wire up close button
  const closeBtn = shadowRoot.querySelector('.yoink-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideModal);
  }

  // Initially hidden
  modalHost.style.display = 'none';

  document.body.appendChild(modalHost);
  console.log('[Yoink] Modal created');
}

function showModal(): void {
  if (!modalHost) {
    createModal();
  }
  if (modalHost) {
    modalHost.style.display = 'block';
    isModalVisible = true;
    console.log('[Yoink] Modal shown');
  }
}

function hideModal(): void {
  if (modalHost) {
    modalHost.style.display = 'none';
    isModalVisible = false;
    console.log('[Yoink] Modal hidden');
  }
}

function toggleModal(): void {
  if (isModalVisible) {
    hideModal();
  } else {
    showModal();
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PING') {
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === 'TOGGLE_MODAL') {
    toggleModal();
    sendResponse({ success: true, visible: isModalVisible });
    return true;
  }

  return true; // Keep channel open for async responses
});
