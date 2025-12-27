// Content script - thin wrapper that imports from core/
// Phase 2: Detection, extraction, and table rendering

// Import modal HTML and CSS as raw strings (Vite ?raw imports)
import modalHTML from './modal.html?raw';
import modalCSS from './modal.css?raw';

// Import core functions (ZERO chrome.* in these)
import { detectPatterns, getElementsByPattern, cyclePattern } from '../../core/detector';
import { extractFromElements } from '../../core/extractor';
import { buildTable } from '../../core/table-builder';
import type { DetectedPattern, DataTable } from '../../core/types';

console.log('[Yoink] Content script loaded:', location.href);

// Notify background script that content script is ready
chrome.runtime.sendMessage({ type: 'CONTENT_READY', payload: { url: location.href } });

// Modal state
let modalHost: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let isModalVisible = false;

// Data state
let detectedPatterns: DetectedPattern[] = [];
let currentPatternIndex = 0;
let currentTable: DataTable | null = null;
let highlightedElements: Element[] = [];

// Inject highlight styles into the page (not shadow DOM)
const HIGHLIGHT_STYLE_ID = 'yoink-highlight-styles';
function ensureHighlightStyles(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .yoink-highlighted {
      outline: 2px solid #22c55e !important;
      outline-offset: 2px !important;
      background-color: rgba(34, 197, 94, 0.1) !important;
      transition: outline 0.2s, background-color 0.2s !important;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Highlight elements on the page.
 */
function highlightElements(elements: Element[]): void {
  // Clear previous highlights
  clearHighlights();

  // Ensure styles are injected
  ensureHighlightStyles();

  // Add highlight class to new elements
  for (const el of elements) {
    el.classList.add('yoink-highlighted');
    highlightedElements.push(el);
  }
}

/**
 * Clear all highlights from the page.
 */
function clearHighlights(): void {
  for (const el of highlightedElements) {
    el.classList.remove('yoink-highlighted');
  }
  highlightedElements = [];
}

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

  // Wire up action buttons
  wireUpButtons();

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

    // Auto-detect on first open
    if (detectedPatterns.length === 0) {
      runDetection();
    }
  }
}

function hideModal(): void {
  if (modalHost) {
    modalHost.style.display = 'none';
    isModalVisible = false;
    clearHighlights();
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

// ============================================================================
// TABLE DETECTION & RENDERING
// ============================================================================

/**
 * Run pattern detection and extract data from the first pattern.
 */
function runDetection(): void {
  console.log('[Yoink] Running pattern detection...');

  // Detect patterns on the page
  detectedPatterns = detectPatterns(document.body);
  console.log('[Yoink] Detected patterns:', detectedPatterns.length);

  if (detectedPatterns.length === 0) {
    showEmptyState('No repeating patterns found on this page');
    return;
  }

  // Start with the first pattern (highest confidence)
  currentPatternIndex = 0;
  extractAndRender();
}

/**
 * Cycle to the next pattern and re-extract.
 */
function tryAnotherTable(): void {
  if (detectedPatterns.length === 0) {
    // First time - run detection
    runDetection();
    return;
  }

  // Cycle to next pattern
  currentPatternIndex = cyclePattern(detectedPatterns, currentPatternIndex);
  console.log('[Yoink] Cycling to pattern', currentPatternIndex + 1, 'of', detectedPatterns.length);
  extractAndRender();
}

/**
 * Extract data from current pattern and render the table.
 */
function extractAndRender(): void {
  const pattern = detectedPatterns[currentPatternIndex];
  if (!pattern) {
    showEmptyState('No pattern selected');
    return;
  }

  console.log('[Yoink] Extracting from pattern:', pattern.selector, '(', pattern.count, 'elements)');

  // Get elements matching the pattern
  const elements = getElementsByPattern(document.body, pattern.selector);
  if (elements.length === 0) {
    showEmptyState('No elements match the selected pattern');
    return;
  }

  // Highlight matched elements on the page
  highlightElements(elements);

  // Extract data from elements
  const rows = extractFromElements(elements);

  // Build the table
  currentTable = buildTable(rows, location.href);
  console.log('[Yoink] Built table:', currentTable.columns.length, 'columns,', currentTable.totalRows, 'rows');

  // Render the table
  renderTable();
}

/**
 * Render the current table in the modal.
 */
function renderTable(): void {
  if (!shadowRoot || !currentTable) return;

  const container = shadowRoot.querySelector('.yoink-table-container');
  const footer = shadowRoot.querySelector('.yoink-row-count');

  if (!container) return;

  // Build table HTML
  const tableHTML = buildTableHTML(currentTable);
  container.innerHTML = tableHTML;

  // Update footer with row count and pattern info
  if (footer) {
    const patternInfo = detectedPatterns.length > 1
      ? ` (Pattern ${currentPatternIndex + 1}/${detectedPatterns.length})`
      : '';
    footer.textContent = `${currentTable.totalRows} rows extracted${patternInfo}`;
  }
}

/**
 * Build HTML for the data table.
 */
function buildTableHTML(table: DataTable): string {
  if (table.rows.length === 0) {
    return '<div class="yoink-empty-state">No data extracted</div>';
  }

  let html = '<table class="yoink-data-table"><thead><tr>';

  // Header row
  for (const col of table.columns) {
    const escapedName = escapeHTML(col.name);
    html += `<th title="${escapedName}">${escapedName}</th>`;
  }
  html += '</tr></thead><tbody>';

  // Data rows
  for (const row of table.rows) {
    html += '<tr>';
    for (let i = 0; i < row.length; i++) {
      const col = table.columns[i];
      const value = row[i] || '';
      html += `<td>${formatCell(value, col?.type || 'text')}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  return html;
}

/**
 * Format a cell value based on its type.
 */
function formatCell(value: string, type: string): string {
  if (!value) return '<span class="yoink-null">—</span>';

  const escaped = escapeHTML(value);

  switch (type) {
    case 'url':
      // Truncate long URLs for display
      const displayUrl = value.length > 40 ? value.slice(0, 40) + '...' : value;
      return `<a href="${escaped}" target="_blank" title="${escaped}">${escapeHTML(displayUrl)}</a>`;

    case 'image':
      return `<img src="${escaped}" alt="" class="yoink-thumb" />`;

    case 'price':
      return `<span class="yoink-price">${escaped}</span>`;

    default:
      // Truncate long text
      if (value.length > 100) {
        return `<span title="${escaped}">${escapeHTML(value.slice(0, 100))}...</span>`;
      }
      return escaped;
  }
}

/**
 * Escape HTML special characters.
 */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Show empty state message in the table container.
 */
function showEmptyState(message: string): void {
  if (!shadowRoot) return;

  const container = shadowRoot.querySelector('.yoink-table-container');
  const footer = shadowRoot.querySelector('.yoink-row-count');

  if (container) {
    container.innerHTML = `<div class="yoink-empty-state">${escapeHTML(message)}</div>`;
  }
  if (footer) {
    footer.textContent = 'No data loaded';
  }
}

/**
 * Wire up button event handlers in the modal.
 */
function wireUpButtons(): void {
  if (!shadowRoot) return;

  // Try Another Table button
  const tryAnotherBtn = shadowRoot.querySelector('#btn-try-another');
  if (tryAnotherBtn) {
    tryAnotherBtn.addEventListener('click', () => {
      tryAnotherTable();
    });
  }
}
