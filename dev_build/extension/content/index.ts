// Content script - thin wrapper that imports from core/
// Phase 2: Detection, extraction, and table rendering

// Import modal HTML and CSS as raw strings (Vite ?raw imports)
import modalHTML from './modal.html?raw';
import modalCSS from './modal.css?raw';

// Import core functions (ZERO chrome.* in these)
import { detectPatterns, getElementsByPattern, cyclePattern } from '../../core/detector';
import { extractFromElements, extractTableHeaders } from '../../core/extractor';
import { buildTable, renameColumn } from '../../core/table-builder';
import { enableSelectionMode, findSimilarElements, generateSelector } from '../../core/selector';
import {
  toCSV,
  toJSON,
  toXLSX,
  toClipboard,
  capturePageHTML,
  downloadFile,
  copyToClipboard,
  generateFilename,
} from '../../core/exporter';
import { findNextButton, isButtonDisabled, getScrollDistance } from '../../core/pagination';
import {
  buildTransformPrompt,
  buildSmartExtractPrompt,
  callClaude,
  parseLLMResponse,
  parseSmartExtractResponse,
  applyTransforms,
  describeTransform,
  LLMError,
  MAX_CALLS_PER_DOMAIN,
  RATE_LIMIT_WINDOW_MS,
  type TransformSuggestions,
  type SmartExtractResult,
} from '../../core/llm';
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

// Manual selection state
let isSelecting = false;
let selectionCleanup: (() => void) | null = null;

// Pagination & Crawling state
let locatedNextButton: HTMLElement | null = null;
let isLocatingNextButton = false;
let isCrawling = false;
let crawlPageCount = 0;
let crawlTotalRows = 0;
let crawlFailedAttempts = 0;
let crawlAbortController: AbortController | null = null;
let crawlStartTime = 0;
let crawlTimerInterval: ReturnType<typeof setInterval> | null = null;
let crawlDotCount = 0;

// AI Cleanup state
let aiOverlayVisible = false;
let aiSuggestions: TransformSuggestions | null = null;
let aiRemainingCalls = MAX_CALLS_PER_DOMAIN;
let enabledRenames: Set<string> = new Set();
let enabledTransforms: Set<number> = new Set();
let enabledDeletions: Set<number> = new Set();

// API Key - Set in .env file as VITE_ANTHROPIC_API_KEY
// Get one at: https://console.anthropic.com/
const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || 'YOUR_ANTHROPIC_API_KEY_HERE';

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

  // For HTML tables, use actual header names from <th> elements
  const tableHeaders = extractTableHeaders(pattern.selector);
  if (tableHeaders.length > 0 && currentTable.columns.length > 0) {
    // Apply header names to columns (for col_0, col_1, etc. from table extraction)
    currentTable = {
      ...currentTable,
      columns: currentTable.columns.map((col, idx) => {
        if (idx < tableHeaders.length && tableHeaders[idx]) {
          return { ...col, name: tableHeaders[idx] };
        }
        return col;
      }),
    };
  }

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

  // Wire up editable column headers
  wireUpColumnEditing(container);

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

  // Header row - clickable to edit
  for (const col of table.columns) {
    const escapedName = escapeHTML(col.name);
    const escapedId = escapeHTML(col.id);
    html += `<th data-column-id="${escapedId}" class="yoink-editable-header" title="Click to rename">${escapedName}</th>`;
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

// ============================================================================
// COLUMN EDITING
// ============================================================================

/**
 * Wire up click handlers for editable column headers.
 */
function wireUpColumnEditing(container: Element): void {
  const headers = container.querySelectorAll('.yoink-editable-header');

  headers.forEach(header => {
    header.addEventListener('click', (e) => {
      const th = e.currentTarget as HTMLTableCellElement;
      startColumnEdit(th);
    });
  });
}

/**
 * Start editing a column header.
 */
function startColumnEdit(th: HTMLTableCellElement): void {
  const columnId = th.dataset.columnId;
  if (!columnId || !currentTable) return;

  // Get current name
  const currentName = th.textContent?.trim() || '';

  // Create input element
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.className = 'yoink-header-input';

  // Save on Enter or blur
  const saveEdit = () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName && currentTable) {
      currentTable = renameColumn(currentTable, columnId, newName);
      console.log('[Yoink] Renamed column:', columnId, '->', newName);
    }
    finishColumnEdit(th, newName || currentName);
  };

  // Cancel on Escape
  const cancelEdit = () => {
    finishColumnEdit(th, currentName);
  };

  input.addEventListener('blur', saveEdit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur(); // Triggers saveEdit via blur
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.removeEventListener('blur', saveEdit); // Don't save on blur after ESC
      cancelEdit();
    }
  });

  // Replace text with input
  th.textContent = '';
  th.appendChild(input);
  th.classList.add('yoink-editing');

  // Focus and select all
  input.focus();
  input.select();
}

/**
 * Finish editing a column header.
 */
function finishColumnEdit(th: HTMLTableCellElement, name: string): void {
  th.textContent = name;
  th.classList.remove('yoink-editing');
  th.title = 'Click to rename';
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

  // Manual Select button
  const manualSelectBtn = shadowRoot.querySelector('#btn-manual-select');
  if (manualSelectBtn) {
    manualSelectBtn.addEventListener('click', () => {
      toggleManualSelection();
    });
  }

  // Export buttons
  const csvBtn = shadowRoot.querySelector('#btn-csv');
  if (csvBtn) {
    csvBtn.addEventListener('click', () => exportCSV());
  }

  const jsonBtn = shadowRoot.querySelector('#btn-json');
  if (jsonBtn) {
    jsonBtn.addEventListener('click', () => exportJSON());
  }

  const xlsxBtn = shadowRoot.querySelector('#btn-xlsx');
  if (xlsxBtn) {
    xlsxBtn.addEventListener('click', () => exportXLSX());
  }

  const copyBtn = shadowRoot.querySelector('#btn-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => exportClipboard());
  }

  const htmlBtn = shadowRoot.querySelector('#btn-html');
  if (htmlBtn) {
    htmlBtn.addEventListener('click', () => exportHTML());
  }

  // Crawling buttons
  const locateNextBtn = shadowRoot.querySelector('#btn-locate-next');
  if (locateNextBtn) {
    locateNextBtn.addEventListener('click', () => toggleLocateNextButton());
  }

  const startCrawlBtn = shadowRoot.querySelector('#btn-start-crawl');
  if (startCrawlBtn) {
    startCrawlBtn.addEventListener('click', () => toggleCrawling());
  }

  const stopCrawlBtn = shadowRoot.querySelector('#btn-stop-crawl');
  if (stopCrawlBtn) {
    stopCrawlBtn.addEventListener('click', () => stopCrawling());
  }

  // AI Cleanup button
  const aiCleanBtn = shadowRoot.querySelector('#btn-ai-clean');
  if (aiCleanBtn) {
    aiCleanBtn.addEventListener('click', () => openAICleanup());
  }

  // Smart Extract button
  const smartExtractBtn = shadowRoot.querySelector('#btn-smart-extract');
  if (smartExtractBtn) {
    smartExtractBtn.addEventListener('click', () => runSmartExtract());
  }

  // Allow Enter key in prompt input
  const promptInput = shadowRoot.querySelector('#input-ai-prompt') as HTMLInputElement;
  if (promptInput) {
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runSmartExtract();
      }
    });
  }
}

// ============================================================================
// MANUAL SELECTION MODE
// ============================================================================

/**
 * Toggle manual selection mode.
 */
function toggleManualSelection(): void {
  if (isSelecting) {
    stopManualSelection();
  } else {
    startManualSelection();
  }
}

/**
 * Enter manual selection mode.
 */
function startManualSelection(): void {
  if (isSelecting) return;

  console.log('[Yoink] Entering manual selection mode');
  isSelecting = true;

  // Update button state
  updateManualSelectButton(true);

  // Clear previous highlights
  clearHighlights();

  // Hide modal temporarily to allow selection
  if (modalHost) {
    modalHost.style.opacity = '0.3';
    modalHost.style.pointerEvents = 'none';
  }

  // Enable selection mode
  selectionCleanup = enableSelectionMode(
    document.body,
    // On select
    (element) => {
      console.log('[Yoink] Element selected:', element.tagName);
      handleElementSelected(element);
    },
    // On hover
    (element) => {
      // Could show preview info in modal, but keeping it simple for now
    }
  );
}

/**
 * Exit manual selection mode.
 */
function stopManualSelection(): void {
  if (!isSelecting) return;

  console.log('[Yoink] Exiting manual selection mode');
  isSelecting = false;

  // Clean up selection mode
  if (selectionCleanup) {
    selectionCleanup();
    selectionCleanup = null;
  }

  // Restore modal
  if (modalHost) {
    modalHost.style.opacity = '1';
    modalHost.style.pointerEvents = 'auto';
  }

  // Update button state
  updateManualSelectButton(false);
}

/**
 * Handle when user selects an element.
 */
function handleElementSelected(element: Element): void {
  // Exit selection mode
  stopManualSelection();

  // Find similar elements
  const similarElements = findSimilarElements(document.body, element);
  console.log('[Yoink] Found', similarElements.length, 'similar elements');

  if (similarElements.length === 0) {
    showEmptyState('No similar elements found');
    return;
  }

  // Generate a selector for this pattern
  const selector = generateSelector(element);

  // Create a manual pattern
  const manualPattern: DetectedPattern = {
    id: `manual-${Date.now()}`,
    selector,
    count: similarElements.length,
    sampleText: similarElements.slice(0, 3).map(el => {
      const text = el.textContent?.trim() || '';
      return text.length > 50 ? text.slice(0, 50) + '...' : text;
    }),
    confidence: 1.0, // Manual selection = highest confidence
  };

  // Add to patterns (at the beginning)
  detectedPatterns = [manualPattern, ...detectedPatterns];
  currentPatternIndex = 0;

  // Highlight and extract
  highlightElements(similarElements);

  const rows = extractFromElements(similarElements);
  currentTable = buildTable(rows, location.href);

  // For HTML tables, use actual header names
  const tableHeaders = extractTableHeaders(selector);
  if (tableHeaders.length > 0 && currentTable.columns.length > 0) {
    currentTable = {
      ...currentTable,
      columns: currentTable.columns.map((col, idx) => {
        if (idx < tableHeaders.length && tableHeaders[idx]) {
          return { ...col, name: tableHeaders[idx] };
        }
        return col;
      }),
    };
  }

  console.log('[Yoink] Built table from manual selection:', currentTable.columns.length, 'columns,', currentTable.totalRows, 'rows');

  renderTable();
}

/**
 * Update the Manual Select button appearance.
 */
function updateManualSelectButton(selecting: boolean): void {
  if (!shadowRoot) return;

  const btn = shadowRoot.querySelector('#btn-manual-select') as HTMLButtonElement;
  if (!btn) return;

  if (selecting) {
    btn.textContent = 'Selecting...';
    btn.classList.remove('yoink-btn-primary');
    btn.classList.add('yoink-btn-warning');
  } else {
    btn.textContent = 'Manual Select';
    btn.classList.remove('yoink-btn-warning');
    btn.classList.add('yoink-btn-primary');
  }
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

/**
 * Export current table as CSV.
 */
function exportCSV(): void {
  if (!currentTable) {
    showToast('No data to export');
    return;
  }

  const csv = toCSV(currentTable);
  const filename = generateFilename('csv', currentTable.sourceUrl);
  downloadFile(csv, filename, 'text/csv');
  showToast(`Downloaded ${filename}`);
}

/**
 * Export current table as JSON.
 */
function exportJSON(): void {
  if (!currentTable) {
    showToast('No data to export');
    return;
  }

  const json = toJSON(currentTable);
  const filename = generateFilename('json', currentTable.sourceUrl);
  downloadFile(json, filename, 'application/json');
  showToast(`Downloaded ${filename}`);
}

/**
 * Export current table as XLSX.
 */
function exportXLSX(): void {
  if (!currentTable) {
    showToast('No data to export');
    return;
  }

  const blob = toXLSX(currentTable);
  if (!blob) {
    showToast('XLSX export failed');
    return;
  }

  const filename = generateFilename('xlsx', currentTable.sourceUrl);
  downloadFile(blob, filename);
  showToast(`Downloaded ${filename}`);
}

/**
 * Copy current table to clipboard as TSV.
 */
async function exportClipboard(): Promise<void> {
  if (!currentTable) {
    showToast('No data to copy');
    return;
  }

  const tsv = toClipboard(currentTable);
  await copyToClipboard(tsv);
  showToast(`Copied ${currentTable.totalRows} rows to clipboard`);
}

/**
 * Export full page HTML.
 */
function exportHTML(): void {
  const html = capturePageHTML();
  const filename = generateFilename('html', location.href);
  downloadFile(html, filename, 'text/html');
  showToast(`Downloaded ${filename}`);
}

/**
 * Show a toast notification in the modal.
 */
function showToast(message: string): void {
  if (!shadowRoot) return;

  // Remove any existing toast
  const existingToast = shadowRoot.querySelector('.yoink-toast');
  if (existingToast) {
    existingToast.remove();
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'yoink-toast';
  toast.textContent = message;

  // Add to modal
  const modal = shadowRoot.querySelector('.yoink-modal');
  if (modal) {
    modal.appendChild(toast);

    // Auto-remove after 2 seconds
    setTimeout(() => {
      toast.remove();
    }, 2000);
  }
}

// ============================================================================
// PAGINATION & CRAWLING
// ============================================================================

/**
 * Toggle the "Locate Next Button" mode.
 */
function toggleLocateNextButton(): void {
  if (isLocatingNextButton) {
    stopLocateNextButton();
  } else {
    startLocateNextButton();
  }
}

/**
 * Enter "Locate Next Button" selection mode.
 */
function startLocateNextButton(): void {
  if (isLocatingNextButton) return;

  console.log('[Yoink] Entering locate next button mode');
  isLocatingNextButton = true;

  // Update button state
  updateLocateNextButton('locating');

  // Hide modal temporarily
  if (modalHost) {
    modalHost.style.opacity = '0.3';
    modalHost.style.pointerEvents = 'none';
  }

  // Enable selection mode for next button
  selectionCleanup = enableSelectionMode(
    document.body,
    // On select
    (element) => {
      console.log('[Yoink] Next button selected:', element.tagName, element.textContent?.trim());
      handleNextButtonSelected(element as HTMLElement);
    },
    // On hover - no-op
    () => {}
  );
}

/**
 * Exit "Locate Next Button" mode.
 */
function stopLocateNextButton(): void {
  if (!isLocatingNextButton) return;

  console.log('[Yoink] Exiting locate next button mode');
  isLocatingNextButton = false;

  if (selectionCleanup) {
    selectionCleanup();
    selectionCleanup = null;
  }

  // Restore modal
  if (modalHost) {
    modalHost.style.opacity = '1';
    modalHost.style.pointerEvents = 'auto';
  }

  // Update button state (keep as located if we have a button, else back to default)
  updateLocateNextButton(locatedNextButton ? 'located' : 'default');
}

/**
 * Handle when user selects a next button.
 */
function handleNextButtonSelected(element: HTMLElement): void {
  stopLocateNextButton();
  locatedNextButton = element;
  console.log('[Yoink] Located next button:', locatedNextButton);

  // Visual feedback
  updateLocateNextButton('located');
  showToast('Next button located');
}

/**
 * Update the Locate Next Button appearance.
 */
function updateLocateNextButton(state: 'default' | 'locating' | 'located'): void {
  if (!shadowRoot) return;

  const btn = shadowRoot.querySelector('#btn-locate-next') as HTMLButtonElement;
  if (!btn) return;

  // Remove all state classes
  btn.classList.remove('yoink-btn-secondary', 'yoink-btn-warning', 'yoink-btn-success');

  switch (state) {
    case 'locating':
      btn.textContent = 'Click Next Button...';
      btn.classList.add('yoink-btn-warning');
      break;
    case 'located':
      btn.textContent = 'Next Button Located';
      btn.classList.add('yoink-btn-success');
      break;
    default:
      btn.textContent = 'Locate Next Button';
      btn.classList.add('yoink-btn-secondary');
  }
}

/**
 * Toggle crawling on/off.
 */
function toggleCrawling(): void {
  if (isCrawling) {
    stopCrawling();
  } else {
    startCrawling();
  }
}

/**
 * Get crawl settings from the modal inputs.
 */
function getCrawlSettings(): { minDelay: number; maxDelay: number; maxPages: number; infiniteScroll: boolean } {
  if (!shadowRoot) return { minDelay: 1, maxDelay: 20, maxPages: 10, infiniteScroll: false };

  const minDelayInput = shadowRoot.querySelector('#input-min-delay') as HTMLInputElement;
  const maxDelayInput = shadowRoot.querySelector('#input-max-delay') as HTMLInputElement;
  const maxPagesInput = shadowRoot.querySelector('#input-max-pages') as HTMLInputElement;
  const infiniteScrollChk = shadowRoot.querySelector('#chk-infinite-scroll') as HTMLInputElement;

  const minDelay = Math.max(0, parseFloat(minDelayInput?.value || '1'));
  const maxDelay = Math.max(minDelay, parseFloat(maxDelayInput?.value || '20'));
  const maxPages = Math.max(1, Math.min(100, parseInt(maxPagesInput?.value || '10', 10)));
  const infiniteScroll = infiniteScrollChk?.checked || false;

  return { minDelay, maxDelay, maxPages, infiniteScroll };
}

/**
 * Start crawling multiple pages.
 */
async function startCrawling(): Promise<void> {
  if (isCrawling) return;

  const settings = getCrawlSettings();

  // Check if we have a way to paginate
  if (!settings.infiniteScroll && !locatedNextButton) {
    // Try to auto-detect a next button
    const autoDetected = findNextButton(document);
    if (autoDetected) {
      locatedNextButton = autoDetected;
      updateLocateNextButton('located');
      console.log('[Yoink] Auto-detected next button');
    } else {
      showToast('Please locate the Next button or enable Infinite Scroll');
      return;
    }
  }

  // Must have data to crawl
  if (!currentTable || detectedPatterns.length === 0) {
    showToast('Please detect or select data first');
    return;
  }

  console.log('[Yoink] Starting crawl. Settings:', settings);
  isCrawling = true;
  crawlPageCount = 1;
  crawlTotalRows = currentTable.totalRows;
  crawlFailedAttempts = 0;
  crawlAbortController = new AbortController();
  crawlStartTime = Date.now();
  crawlDotCount = 0;

  // Start timer for animated updates
  startCrawlTimer();

  // Update UI
  updateCrawlButton(true);
  showCrawlProgress(true);
  updateCrawlProgress();

  try {
    await runCrawlLoop(settings);
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      console.error('[Yoink] Crawl error:', error);
      showToast('Crawl error: ' + (error as Error).message);
    }
  }

  // Crawl finished
  finishCrawling();
}

/**
 * Stop the current crawl.
 */
function stopCrawling(): void {
  if (!isCrawling) return;

  console.log('[Yoink] Stopping crawl');
  crawlAbortController?.abort();
}

/**
 * Clean up after crawling finishes.
 */
function finishCrawling(): void {
  isCrawling = false;
  crawlAbortController = null;
  stopCrawlTimer();
  updateCrawlButton(false);
  showCrawlProgress(false);

  const elapsed = formatElapsedTime(Date.now() - crawlStartTime);
  console.log('[Yoink] Crawl finished. Total pages:', crawlPageCount, 'Total rows:', crawlTotalRows, 'Time:', elapsed);
  showToast(`Crawled ${crawlPageCount} pages, ${crawlTotalRows} rows in ${elapsed}`);
}

/**
 * Run the main crawl loop.
 */
async function runCrawlLoop(settings: { minDelay: number; maxDelay: number; maxPages: number; infiniteScroll: boolean }): Promise<void> {
  // Infinite scroll needs MUCH more patience - pages can be slow to load
  const MAX_FAILED_ATTEMPTS = settings.infiniteScroll ? 5 : 2;

  while (isCrawling && crawlPageCount < settings.maxPages) {
    // Check abort
    if (crawlAbortController?.signal.aborted) {
      throw new DOMException('Crawl aborted', 'AbortError');
    }

    // Navigate to next page
    let gotNewContent = false;

    if (settings.infiniteScroll) {
      gotNewContent = await scrollForMore();
    } else {
      gotNewContent = await clickNextButton();
    }

    if (!gotNewContent) {
      crawlFailedAttempts++;
      console.log('[Yoink] No new content, attempt', crawlFailedAttempts);

      if (crawlFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        console.log('[Yoink] Max failed attempts reached, stopping crawl');
        break;
      }
    } else {
      crawlFailedAttempts = 0;
      crawlPageCount++;
    }

    // Extract new data
    const newRows = extractCurrentData();
    if (newRows > 0) {
      crawlTotalRows += newRows;
      updateCrawlProgress();
      console.log('[Yoink] Extracted', newRows, 'new rows. Total:', crawlTotalRows);
    }

    // Random delay between pages
    const delay = randomDelay(settings.minDelay * 1000, settings.maxDelay * 1000);
    console.log('[Yoink] Waiting', Math.round(delay / 1000), 'seconds before next page');
    await sleep(delay, crawlAbortController?.signal);
  }
}

/**
 * Click the next button and wait for content.
 */
async function clickNextButton(): Promise<boolean> {
  if (!locatedNextButton) return false;

  // Check if button is still valid and not disabled
  if (!document.contains(locatedNextButton)) {
    // Try to re-find the button (page may have changed)
    const newButton = findNextButton(document);
    if (newButton) {
      locatedNextButton = newButton;
    } else {
      console.log('[Yoink] Next button no longer in DOM');
      return false;
    }
  }

  if (isButtonDisabled(locatedNextButton)) {
    console.log('[Yoink] Next button is disabled');
    return false;
  }

  // Record current state to detect changes (fingerprint + count)
  const selector = detectedPatterns[currentPatternIndex]?.selector || '';
  const beforeElements = document.querySelectorAll(selector);
  const beforeFingerprint = getContentFingerprint(beforeElements);
  const beforeRowCount = beforeElements.length;

  // Click the button
  console.log('[Yoink] Clicking next button');
  locatedNextButton.click();

  // Wait for content to CHANGE (not just increase)
  const gotNewContent = await waitForContentChange(selector, beforeFingerprint, beforeRowCount);
  return gotNewContent;
}

/**
 * Create a fingerprint of content to detect changes.
 * Uses first few elements' text to detect when content is replaced.
 */
function getContentFingerprint(elements: NodeListOf<Element>): string {
  const samples: string[] = [];
  const sampleCount = Math.min(3, elements.length);

  for (let i = 0; i < sampleCount; i++) {
    const text = elements[i]?.textContent?.trim().slice(0, 100) || '';
    samples.push(text);
  }

  return samples.join('|||');
}

/**
 * Wait for content to change (replacement-style pagination).
 * Detects both: new elements added OR existing elements replaced.
 */
async function waitForContentChange(
  selector: string,
  beforeFingerprint: string,
  beforeRowCount: number
): Promise<boolean> {
  const SETTLE_TIMEOUT = 500;
  const MAX_WAIT = 10000;

  return new Promise((resolve) => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;

    const cleanup = () => {
      if (settleTimer) clearTimeout(settleTimer);
      observer.disconnect();
    };

    const checkForChanges = (): boolean => {
      const currentElements = document.querySelectorAll(selector);
      const currentFingerprint = getContentFingerprint(currentElements);
      const currentRowCount = currentElements.length;

      // Check 1: More elements than before (appended content)
      if (currentRowCount > beforeRowCount) {
        console.log('[Yoink] New elements detected:', currentRowCount - beforeRowCount);
        return true;
      }

      // Check 2: Content changed (replaced content - same count but different fingerprint)
      if (currentFingerprint !== beforeFingerprint && currentRowCount > 0) {
        console.log('[Yoink] Content changed (replacement detected)');
        return true;
      }

      return false;
    };

    const resolveWith = (value: boolean) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };

    const observer = new MutationObserver(() => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        resolveWith(checkForChanges());
      }, SETTLE_TIMEOUT);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Max wait timeout
    setTimeout(() => {
      if (!resolved) {
        console.log('[Yoink] Max wait timeout reached');
        resolveWith(checkForChanges());
      }
    }, MAX_WAIT);

    // Don't check immediately - give the page a moment to start loading
    setTimeout(() => {
      if (!resolved && checkForChanges()) {
        resolveWith(true);
      }
    }, 100);
  });
}

/**
 * Scroll down for infinite scroll pages.
 * Scrolls aggressively until new content appears or we definitively hit the bottom.
 */
async function scrollForMore(): Promise<boolean> {
  const selector = detectedPatterns[currentPatternIndex]?.selector || '';
  const MAX_SCROLL_ATTEMPTS = 20; // Even more attempts for stubborn pages
  const SCROLL_SETTLE_DELAY = 200;

  // Record initial state
  const beforeRowCount = document.querySelectorAll(selector).length;
  let consecutiveBottomHits = 0;
  const MAX_BOTTOM_HITS = 5; // Must hit bottom 5 times with no new content to give up

  for (let attempt = 1; attempt <= MAX_SCROLL_ATTEMPTS; attempt++) {
    // Check abort signal
    if (crawlAbortController?.signal.aborted) {
      return false;
    }

    const beforeScrollHeight = document.documentElement.scrollHeight;
    const beforeScrollTop = window.scrollY;

    // Scroll down by one viewport
    const scrollDistance = getScrollDistance();
    window.scrollBy({ top: scrollDistance, behavior: 'smooth' });

    // Wait for scroll animation to settle
    await new Promise(resolve => setTimeout(resolve, SCROLL_SETTLE_DELAY));

    // Check if we actually scrolled
    const afterScrollTop = window.scrollY;
    const scrolledAmount = afterScrollTop - beforeScrollTop;
    const isAtBottom = (window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 50;

    // Check for new content
    const currentRowCount = document.querySelectorAll(selector).length;
    const currentScrollHeight = document.documentElement.scrollHeight;

    if (currentRowCount > beforeRowCount) {
      console.log('[Yoink] New elements after scroll:', currentRowCount - beforeRowCount);
      return true;
    }

    if (currentScrollHeight > beforeScrollHeight) {
      console.log('[Yoink] Page grew, waiting for elements to appear...');
      // Page height increased - content is loading
      await new Promise(resolve => setTimeout(resolve, 800));
      const finalRowCount = document.querySelectorAll(selector).length;
      if (finalRowCount > beforeRowCount) {
        console.log('[Yoink] New elements after page grow:', finalRowCount - beforeRowCount);
        return true;
      }
      // Page grew but no new matching elements yet - keep trying
      consecutiveBottomHits = 0;
      continue;
    }

    // Check if we're at the bottom
    if (isAtBottom || scrolledAmount < scrollDistance * 0.3) {
      consecutiveBottomHits++;
      console.log('[Yoink] At bottom, hit #', consecutiveBottomHits, '/', MAX_BOTTOM_HITS);

      if (consecutiveBottomHits >= MAX_BOTTOM_HITS) {
        // Really at the bottom - one last long wait for lazy loading
        console.log('[Yoink] Final wait for lazy content...');
        await new Promise(resolve => setTimeout(resolve, 4000));

        const lastCheck = document.querySelectorAll(selector).length;
        if (lastCheck > beforeRowCount) {
          console.log('[Yoink] Found elements after final wait:', lastCheck - beforeRowCount);
          return true;
        }

        console.log('[Yoink] Confirmed at bottom with no new content');
        return false;
      }

      // Wait longer at bottom for lazy loading
      await new Promise(resolve => setTimeout(resolve, 1500));
    } else {
      // Not at bottom, reset counter
      consecutiveBottomHits = 0;
    }

    console.log('[Yoink] Scroll attempt', attempt, '- continuing...');
  }

  // Max attempts reached - check one more time
  const finalCount = document.querySelectorAll(selector).length;
  return finalCount > beforeRowCount;
}

/**
 * Wait for new content to appear using MutationObserver.
 */
async function waitForNewContent(beforeRowCount: number, beforeScrollHeight?: number): Promise<boolean> {
  const SETTLE_TIMEOUT = 500; // Wait 500ms after last mutation
  const MAX_WAIT = 10000; // Max 10 seconds

  const selector = detectedPatterns[currentPatternIndex]?.selector || '';

  return new Promise((resolve) => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;

    const cleanup = () => {
      if (settleTimer) clearTimeout(settleTimer);
      observer.disconnect();
    };

    const checkForChanges = () => {
      const currentRowCount = document.querySelectorAll(selector).length;
      const currentScrollHeight = document.documentElement.scrollHeight;

      // Check if we have new elements OR scroll height increased (for infinite scroll)
      if (currentRowCount > beforeRowCount) {
        console.log('[Yoink] New elements detected:', currentRowCount - beforeRowCount);
        return true;
      }

      if (beforeScrollHeight !== undefined && currentScrollHeight > beforeScrollHeight) {
        console.log('[Yoink] Scroll height increased, checking for elements...');
        return true;
      }

      return false;
    };

    const resolveWith = (value: boolean) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };

    // Set up mutation observer
    const observer = new MutationObserver(() => {
      // Reset settle timer on each mutation
      if (settleTimer) clearTimeout(settleTimer);

      settleTimer = setTimeout(() => {
        // Settled - check if we have new content
        resolveWith(checkForChanges());
      }, SETTLE_TIMEOUT);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Max wait timeout
    setTimeout(() => {
      if (!resolved) {
        console.log('[Yoink] Max wait timeout reached');
        resolveWith(checkForChanges());
      }
    }, MAX_WAIT);

    // Check immediately in case content already loaded
    if (checkForChanges()) {
      resolveWith(true);
    }
  });
}

/**
 * Extract data from current page and append to table.
 * For replacement-style pagination, extracts ALL visible elements and appends to accumulated table.
 */
function extractCurrentData(): number {
  const pattern = detectedPatterns[currentPatternIndex];
  if (!pattern || !currentTable) return 0;

  // Get current elements on page
  const elements = getElementsByPattern(document.body, pattern.selector);
  if (elements.length === 0) return 0;

  // Extract data from current page elements
  const rows = extractFromElements(elements);
  const pageTable = buildTable(rows, location.href);

  // For replacement pagination: append ALL rows from this page to accumulated table
  // For append pagination: only truly new rows get added (handled by checking count increase)
  const previousRowCount = currentTable.rows.length;

  // Append all rows from this page
  for (const row of pageTable.rows) {
    currentTable.rows.push(row);
  }
  currentTable.totalRows = currentTable.rows.length;

  const newRowCount = currentTable.rows.length - previousRowCount;

  if (newRowCount > 0) {
    // Re-render the table
    renderTable();
  }

  return newRowCount;
}

/**
 * Update the Start Crawling button state.
 */
function updateCrawlButton(crawling: boolean): void {
  if (!shadowRoot) return;

  const btn = shadowRoot.querySelector('#btn-start-crawl') as HTMLButtonElement;
  if (!btn) return;

  if (crawling) {
    btn.textContent = 'Stop Crawling';
    btn.classList.remove('yoink-btn-primary');
    btn.classList.add('yoink-btn-danger');
  } else {
    btn.textContent = 'Start Crawling';
    btn.classList.remove('yoink-btn-danger');
    btn.classList.add('yoink-btn-primary');
  }
}

/**
 * Show/hide the crawl progress section.
 */
function showCrawlProgress(show: boolean): void {
  if (!shadowRoot) return;

  const progress = shadowRoot.querySelector('#crawl-progress') as HTMLElement;
  if (progress) {
    progress.style.display = show ? 'flex' : 'none';
  }
}

/**
 * Update the crawl progress display.
 */
function updateCrawlProgress(): void {
  if (!shadowRoot) return;

  const status = shadowRoot.querySelector('#crawl-status');
  const stats = shadowRoot.querySelector('#crawl-stats');

  if (status) {
    if (isCrawling) {
      // Animated dots: "" → "." → ".." → "..." → ""
      const dots = '.'.repeat(crawlDotCount);
      const padding = '\u00A0'.repeat(3 - crawlDotCount); // Non-breaking spaces to prevent layout shift
      status.textContent = `Crawling${dots}${padding}`;
    } else {
      status.textContent = 'Crawl Complete';
    }
  }
  if (stats) {
    const elapsed = formatElapsedTime(Date.now() - crawlStartTime);
    stats.textContent = `Page ${crawlPageCount} | ${crawlTotalRows} rows | ${elapsed}`;
  }
}

/**
 * Start the crawl timer for animated updates.
 */
function startCrawlTimer(): void {
  stopCrawlTimer(); // Clear any existing timer

  crawlTimerInterval = setInterval(() => {
    crawlDotCount = (crawlDotCount + 1) % 4; // Cycle 0, 1, 2, 3, 0, ...
    updateCrawlProgress();
  }, 400); // Update every 400ms for smooth animation
}

/**
 * Stop the crawl timer.
 */
function stopCrawlTimer(): void {
  if (crawlTimerInterval) {
    clearInterval(crawlTimerInterval);
    crawlTimerInterval = null;
  }
}

/**
 * Format elapsed time as M:SS or H:MM:SS.
 */
function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Generate a random delay between min and max milliseconds.
 */
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for a specified duration, respecting abort signal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

// ============================================================================
// AI CLEANUP
// ============================================================================

const RATE_LIMIT_STORAGE_KEY = 'yoink_rate_limit';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Get domain from URL.
 */
function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * Get rate limits from storage.
 */
async function getRateLimits(): Promise<Record<string, RateLimitEntry>> {
  try {
    const stored = await chrome.storage.session.get(RATE_LIMIT_STORAGE_KEY);
    return stored[RATE_LIMIT_STORAGE_KEY] || {};
  } catch {
    return {};
  }
}

/**
 * Check if a call is allowed for current domain.
 */
async function checkRateLimit(): Promise<boolean> {
  const domain = getDomain(location.href);
  const limits = await getRateLimits();
  const entry = limits[domain];

  if (!entry || Date.now() > entry.resetAt) {
    aiRemainingCalls = MAX_CALLS_PER_DOMAIN;
    return true;
  }

  aiRemainingCalls = Math.max(0, MAX_CALLS_PER_DOMAIN - entry.count);
  return entry.count < MAX_CALLS_PER_DOMAIN;
}

/**
 * Increment rate limit after successful API call.
 */
async function incrementRateLimit(): Promise<void> {
  const domain = getDomain(location.href);
  const limits = await getRateLimits();
  const entry = limits[domain];

  if (!entry || Date.now() > entry.resetAt) {
    limits[domain] = {
      count: 1,
      resetAt: Date.now() + RATE_LIMIT_WINDOW_MS,
    };
  } else {
    limits[domain].count++;
  }

  aiRemainingCalls = Math.max(0, MAX_CALLS_PER_DOMAIN - limits[domain].count);

  try {
    await chrome.storage.session.set({ [RATE_LIMIT_STORAGE_KEY]: limits });
  } catch {
    // Ignore storage errors
  }
}

/**
 * Open the AI Cleanup overlay.
 */
async function openAICleanup(): Promise<void> {
  if (!currentTable || currentTable.rows.length === 0) {
    showToast('Extract data first before using AI cleanup');
    return;
  }

  // Check rate limit
  const canProceed = await checkRateLimit();
  if (!canProceed) {
    showToast('Rate limit reached. Try again in an hour.');
    return;
  }

  // Show loading overlay
  showAIOverlay('loading');
  aiOverlayVisible = true;

  try {
    // Build prompt with sample data
    const sampleRows = currentTable.rows.slice(0, 5);
    const columns = currentTable.columns.map(c => c.name);

    const prompt = buildTransformPrompt({
      columns,
      sampleRows,
      rowCount: currentTable.totalRows,
      sourceUrl: currentTable.sourceUrl,
    });

    console.log('[Yoink] Calling AI for data cleanup...');

    // Call API
    const response = await callClaude(prompt, ANTHROPIC_API_KEY);

    // Parse response
    aiSuggestions = parseLLMResponse(response);
    console.log('[Yoink] AI suggestions:', aiSuggestions);

    // Increment rate limit on success
    await incrementRateLimit();

    // Enable all suggestions by default
    enabledRenames = new Set(Object.keys(aiSuggestions.columnRenames));
    enabledTransforms = new Set(aiSuggestions.transforms.map((_, i) => i));
    enabledDeletions = new Set(aiSuggestions.deletions);

    // Show suggestions
    showAIOverlay('suggestions');
  } catch (error) {
    console.error('[Yoink] AI cleanup error:', error);

    let errorMessage = 'Unknown error occurred';
    if (error instanceof LLMError) {
      errorMessage = error.message;
    } else if (error instanceof SyntaxError) {
      errorMessage = 'Failed to parse AI response. Please try again.';
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    showAIOverlay('error', errorMessage);
  }
}

/**
 * Close the AI overlay.
 */
function closeAIOverlay(): void {
  if (!shadowRoot) return;

  const overlay = shadowRoot.querySelector('.yoink-ai-overlay');
  if (overlay) {
    overlay.remove();
  }

  aiOverlayVisible = false;
  aiSuggestions = null;
}

/**
 * Show the AI overlay with different states.
 */
function showAIOverlay(state: 'loading' | 'suggestions' | 'error', errorMessage?: string): void {
  if (!shadowRoot) return;

  // Remove existing overlay
  const existing = shadowRoot.querySelector('.yoink-ai-overlay');
  if (existing) {
    existing.remove();
  }

  const modal = shadowRoot.querySelector('.yoink-modal');
  if (!modal) return;

  const overlay = document.createElement('div');
  overlay.className = 'yoink-ai-overlay';

  let content = '';

  if (state === 'loading') {
    content = `
      <header class="yoink-ai-header">
        <span class="yoink-ai-title">✨ AI Cleanup</span>
        <button class="yoink-ai-close" id="ai-close">&times;</button>
      </header>
      <div class="yoink-ai-body">
        <div class="yoink-ai-loading">
          <div class="yoink-ai-spinner"></div>
          <span>Analyzing your data...</span>
        </div>
      </div>
    `;
  } else if (state === 'error') {
    content = `
      <header class="yoink-ai-header">
        <span class="yoink-ai-title">✨ AI Cleanup</span>
        <button class="yoink-ai-close" id="ai-close">&times;</button>
      </header>
      <div class="yoink-ai-body">
        <div class="yoink-ai-error">${escapeHTML(errorMessage || 'An error occurred')}</div>
      </div>
      <footer class="yoink-ai-footer">
        <span class="yoink-ai-rate-limit"><strong>${aiRemainingCalls}</strong> AI uses remaining</span>
        <div class="yoink-ai-actions">
          <button class="yoink-btn yoink-btn-secondary" id="ai-cancel">Close</button>
        </div>
      </footer>
    `;
  } else if (state === 'suggestions' && aiSuggestions) {
    content = buildSuggestionsHTML(aiSuggestions);
  }

  overlay.innerHTML = content;
  modal.appendChild(overlay);

  // Wire up close button
  const closeBtn = overlay.querySelector('#ai-close');
  closeBtn?.addEventListener('click', closeAIOverlay);

  const cancelBtn = overlay.querySelector('#ai-cancel');
  cancelBtn?.addEventListener('click', closeAIOverlay);

  // Wire up apply button
  const applyBtn = overlay.querySelector('#ai-apply');
  applyBtn?.addEventListener('click', applyAISuggestions);

  // Wire up checkboxes
  wireUpAICheckboxes(overlay);
}

/**
 * Build HTML for suggestions view.
 */
function buildSuggestionsHTML(suggestions: TransformSuggestions): string {
  const columns = currentTable?.columns.map(c => c.name) || [];

  let renamesHTML = '';
  const renames = Object.entries(suggestions.columnRenames);
  if (renames.length > 0) {
    const renameItems = renames.map(([oldName, newName]) => `
      <div class="yoink-ai-item">
        <input type="checkbox" data-type="rename" data-key="${escapeHTML(oldName)}" ${enabledRenames.has(oldName) ? 'checked' : ''} />
        <span class="yoink-ai-item-label">
          <span class="yoink-ai-item-from">${escapeHTML(oldName)}</span>
          <span class="yoink-ai-item-arrow">→</span>
          <span class="yoink-ai-item-to">${escapeHTML(newName)}</span>
        </span>
      </div>
    `).join('');

    renamesHTML = `
      <div class="yoink-ai-section">
        <div class="yoink-ai-section-header">
          <span class="yoink-ai-section-title">Column Renames</span>
          <span class="yoink-ai-section-count">${renames.length}</span>
        </div>
        <div class="yoink-ai-section-items">${renameItems}</div>
      </div>
    `;
  }

  let transformsHTML = '';
  if (suggestions.transforms.length > 0) {
    const transformItems = suggestions.transforms.map((t, i) => {
      const description = describeTransform(t, columns);
      return `
        <div class="yoink-ai-item">
          <input type="checkbox" data-type="transform" data-index="${i}" ${enabledTransforms.has(i) ? 'checked' : ''} />
          <span class="yoink-ai-item-label">${escapeHTML(description)}</span>
        </div>
      `;
    }).join('');

    transformsHTML = `
      <div class="yoink-ai-section">
        <div class="yoink-ai-section-header">
          <span class="yoink-ai-section-title">Data Transforms</span>
          <span class="yoink-ai-section-count">${suggestions.transforms.length}</span>
        </div>
        <div class="yoink-ai-section-items">${transformItems}</div>
      </div>
    `;
  }

  let deletionsHTML = '';
  if (suggestions.deletions.length > 0) {
    const deletionItems = suggestions.deletions.map(idx => {
      const colName = columns[idx] || `Column ${idx + 1}`;
      return `
        <div class="yoink-ai-item">
          <input type="checkbox" data-type="deletion" data-index="${idx}" ${enabledDeletions.has(idx) ? 'checked' : ''} />
          <span class="yoink-ai-item-label">Delete column "${escapeHTML(colName)}"</span>
        </div>
      `;
    }).join('');

    deletionsHTML = `
      <div class="yoink-ai-section">
        <div class="yoink-ai-section-header">
          <span class="yoink-ai-section-title">Delete Columns</span>
          <span class="yoink-ai-section-count">${suggestions.deletions.length}</span>
        </div>
        <div class="yoink-ai-section-items">${deletionItems}</div>
      </div>
    `;
  }

  let warningsHTML = '';
  if (suggestions.warnings.length > 0) {
    const warningItems = suggestions.warnings.map(w => `<li>${escapeHTML(w)}</li>`).join('');
    warningsHTML = `
      <div class="yoink-ai-warnings">
        <div class="yoink-ai-warning-title">Data Quality Warnings</div>
        <ul class="yoink-ai-warning-list">${warningItems}</ul>
      </div>
    `;
  }

  const noSuggestions = renames.length === 0 && suggestions.transforms.length === 0 && suggestions.deletions.length === 0;
  const emptySuggestions = noSuggestions
    ? '<div class="yoink-ai-error">No improvements suggested. Your data looks clean!</div>'
    : '';

  const confidencePercent = Math.round(suggestions.confidence * 100);

  return `
    <header class="yoink-ai-header">
      <span class="yoink-ai-title">✨ AI Cleanup Suggestions</span>
      <button class="yoink-ai-close" id="ai-close">&times;</button>
    </header>
    <div class="yoink-ai-body">
      ${emptySuggestions}
      ${renamesHTML}
      ${transformsHTML}
      ${deletionsHTML}
      ${warningsHTML}
      <div class="yoink-ai-confidence">AI Confidence: ${confidencePercent}%</div>
    </div>
    <footer class="yoink-ai-footer">
      <span class="yoink-ai-rate-limit"><strong>${aiRemainingCalls}</strong> AI uses remaining</span>
      <div class="yoink-ai-actions">
        <button class="yoink-btn yoink-btn-secondary" id="ai-cancel">Cancel</button>
        <button class="yoink-btn yoink-btn-primary" id="ai-apply" ${noSuggestions ? 'disabled' : ''}>Apply Selected</button>
      </div>
    </footer>
  `;
}

/**
 * Wire up AI suggestion checkboxes.
 */
function wireUpAICheckboxes(overlay: Element): void {
  const checkboxes = overlay.querySelectorAll('input[type="checkbox"]');

  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const type = input.dataset.type;
      const key = input.dataset.key;
      const index = input.dataset.index ? parseInt(input.dataset.index, 10) : -1;

      if (type === 'rename' && key) {
        if (input.checked) {
          enabledRenames.add(key);
        } else {
          enabledRenames.delete(key);
        }
      } else if (type === 'transform' && index >= 0) {
        if (input.checked) {
          enabledTransforms.add(index);
        } else {
          enabledTransforms.delete(index);
        }
      } else if (type === 'deletion' && index >= 0) {
        if (input.checked) {
          enabledDeletions.add(index);
        } else {
          enabledDeletions.delete(index);
        }
      }
    });
  });
}

/**
 * Apply selected AI suggestions to the data.
 */
function applyAISuggestions(): void {
  if (!currentTable || !aiSuggestions) {
    closeAIOverlay();
    return;
  }

  console.log('[Yoink] Applying AI suggestions...');
  console.log('  Renames:', [...enabledRenames]);
  console.log('  Transforms:', [...enabledTransforms]);
  console.log('  Deletions:', [...enabledDeletions]);

  // Apply transforms
  const result = applyTransforms(
    currentTable.rows,
    currentTable.columns.map(c => c.name),
    aiSuggestions,
    enabledRenames,
    enabledTransforms,
    enabledDeletions
  );

  // Update table with new data
  currentTable = {
    ...currentTable,
    columns: result.columns.map((name, i) => ({
      id: `col-${i}`,
      name,
      type: 'text' as const,
      sourceKey: `col-${i}`,
    })),
    rows: result.data,
    totalRows: result.data.length,
  };

  // Re-render table
  renderTable();

  // Show toast
  const appliedCount = enabledRenames.size + enabledTransforms.size + enabledDeletions.size;
  showToast(`Applied ${appliedCount} AI suggestions`);

  // Close overlay
  closeAIOverlay();
}

// ============================================================================
// SMART EXTRACTION
// ============================================================================

/**
 * Generate a simplified DOM sample for AI analysis.
 * Shows structure with sample content, not the full DOM.
 */
function generateDOMSample(): string {
  const MAX_ELEMENTS = 50;
  const MAX_TEXT_LENGTH = 50;

  const elements: string[] = [];
  let count = 0;

  function processElement(el: Element, depth: number): void {
    if (count >= MAX_ELEMENTS) return;
    if (depth > 5) return;

    const tag = el.tagName.toLowerCase();

    // Skip script, style, etc.
    if (['script', 'style', 'noscript', 'meta', 'link', 'svg', 'path'].includes(tag)) return;

    const indent = '  '.repeat(depth);
    const id = el.id ? `#${el.id}` : '';
    const classes = el.className && typeof el.className === 'string'
      ? '.' + el.className.split(/\s+/).filter(c => c && c.length < 30).slice(0, 3).join('.')
      : '';

    // Get text content (direct text only, not from children)
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent?.trim() || '';
        if (t) text += t + ' ';
      }
    }
    text = text.trim();
    if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH) + '...';

    // Get href for links
    const href = tag === 'a' ? ` href="${(el as HTMLAnchorElement).href?.slice(0, 50) || ''}"` : '';

    // Build element string
    const textPart = text ? ` "${text}"` : '';
    elements.push(`${indent}<${tag}${id}${classes}${href}>${textPart}`);
    count++;

    // Process children
    for (const child of el.children) {
      processElement(child, depth + 1);
    }
  }

  // Start from main content areas
  const main = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
  processElement(main, 0);

  return elements.join('\n');
}

/**
 * Run smart extraction using AI.
 */
async function runSmartExtract(): Promise<void> {
  if (!shadowRoot) return;

  const promptInput = shadowRoot.querySelector('#input-ai-prompt') as HTMLInputElement;
  const userPrompt = promptInput?.value?.trim() || '';

  if (!userPrompt) {
    showToast('Please describe what you want to extract');
    return;
  }

  // Check rate limit
  const canProceed = await checkRateLimit();
  if (!canProceed) {
    showToast('Rate limit reached. Try again in an hour.');
    return;
  }

  // Update button to show loading
  const smartBtn = shadowRoot.querySelector('#btn-smart-extract') as HTMLButtonElement;
  const originalText = smartBtn?.textContent || '';
  if (smartBtn) {
    smartBtn.disabled = true;
    smartBtn.textContent = '...';
  }

  try {
    // Generate DOM sample
    const domSample = generateDOMSample();

    // Build and send prompt
    const prompt = buildSmartExtractPrompt({
      userPrompt,
      pageUrl: location.href,
      domSample,
    });

    console.log('[Yoink] Running smart extraction...');
    const response = await callClaude(prompt, ANTHROPIC_API_KEY);

    // Parse response
    const result = parseSmartExtractResponse(response);
    console.log('[Yoink] Smart extraction result:', result);

    // Increment rate limit
    await incrementRateLimit();

    if (result.confidence < 0.3 || !result.selector) {
      showToast(result.explanation || 'Could not identify matching elements');
      return;
    }

    // Apply the extraction
    await applySmartExtraction(result, userPrompt);

  } catch (error) {
    console.error('[Yoink] Smart extraction error:', error);

    let message = 'Smart extraction failed';
    if (error instanceof LLMError) {
      message = error.message;
    } else if (error instanceof Error) {
      message = error.message;
    }

    showToast(message);
  } finally {
    // Restore button
    if (smartBtn) {
      smartBtn.disabled = false;
      smartBtn.textContent = originalText;
    }
  }
}

/**
 * Apply smart extraction result to the page.
 */
async function applySmartExtraction(result: SmartExtractResult, userPrompt: string): Promise<void> {
  // Find elements matching the selector
  let elements: Element[];
  try {
    elements = Array.from(document.querySelectorAll(result.selector));
  } catch {
    showToast(`Invalid selector: ${result.selector}`);
    return;
  }

  if (elements.length === 0) {
    showToast(`No elements found for: ${result.selector}`);
    return;
  }

  console.log(`[Yoink] Found ${elements.length} elements for: ${result.selector}`);

  // Extract data using the field selectors
  const rows: string[][] = [];
  const columns = result.fields.map(f => f.name);

  for (const el of elements) {
    const row: string[] = [];

    for (const field of result.fields) {
      let value = '';

      try {
        // Try each selector (comma-separated for fallbacks)
        const selectors = field.cssSelector.split(',').map(s => s.trim());

        for (const selector of selectors) {
          const target = selector === ':scope' || !selector
            ? el
            : el.querySelector(selector);

          if (target) {
            // Special handling for links
            if (selector.includes('a[href]') || target.tagName.toLowerCase() === 'a') {
              value = (target as HTMLAnchorElement).href || '';
            } else if (selector.includes('img') || target.tagName.toLowerCase() === 'img') {
              value = (target as HTMLImageElement).src || '';
            } else {
              value = ((target as HTMLElement).innerText || target.textContent || '').trim();
            }

            if (value) break;
          }
        }
      } catch {
        // Invalid selector, skip
      }

      row.push(value);
    }

    rows.push(row);
  }

  // Create pattern and table
  const smartPattern: DetectedPattern = {
    id: `smart-${Date.now()}`,
    selector: result.selector,
    count: elements.length,
    sampleText: [userPrompt, result.explanation || ''],
    confidence: result.confidence,
  };

  detectedPatterns = [smartPattern, ...detectedPatterns];
  currentPatternIndex = 0;

  // Highlight elements
  highlightElements(elements);

  // Build table
  currentTable = {
    columns: columns.map((name, i) => ({
      id: `col-${i}`,
      name: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      type: 'text' as const,
      sourceKey: `smart-${i}`,
    })),
    rows,
    sourceUrl: location.href,
    extractedAt: Date.now(),
    totalRows: rows.length,
  };

  renderTable();
  showToast(`Extracted ${rows.length} items with ${columns.length} fields`);
}

// Initialize rate limit check on load
checkRateLimit().then(() => {
  console.log('[Yoink] AI uses remaining:', aiRemainingCalls);
});
