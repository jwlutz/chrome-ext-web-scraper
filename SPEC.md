# Yoink.ai — Product Specification

> **Purpose of this document:** This is the single source of truth for rebuilding Yoink.ai. Claude Code should reference this file throughout development. When in doubt, check the spec.

---

## What is Yoink.ai?

A Chrome extension for scraping structured data from any webpage. Competitor to Instant Data Scraper, but with AI-powered data cleaning.

**Core value prop:** 
- Auto-detect repeating elements (products, listings, tables)
- Extract to CSV/XLSX/JSON with one click
- AI cleans up messy data (smart column names, price extraction, URL fixing)
- Multi-page crawling with pagination support

---

## Repository Structure (ENFORCED)

```
yoink/
├── SPEC.md                    # THIS FILE - source of truth
├── dev_build/                 # NEW clean implementation
│   ├── core/                  # Pure JS library - ZERO chrome.* allowed
│   │   ├── index.ts           # Barrel export
│   │   ├── detector.ts        # Auto-detect repeating elements
│   │   ├── selector.ts        # Manual selection, highlighting
│   │   ├── extractor.ts       # Extract data from elements
│   │   ├── table-builder.ts   # Build structured table
│   │   ├── pagination.ts      # Detect next buttons, infinite scroll
│   │   ├── exporter.ts        # CSV, XLSX, JSON generation
│   │   └── types.ts           # Shared TypeScript types
│   │
│   ├── extension/             # Chrome extension wrapper
│   │   ├── manifest.json      # MV3 manifest (NO default_popup)
│   │   ├── background/
│   │   │   └── index.ts       # Service worker, message routing, icon click
│   │   └── content/
│   │       ├── index.ts       # Message handling + modal injection
│   │       ├── modal.html     # Modal HTML structure
│   │       └── modal.css      # Modal styles (injected into Shadow DOM)
│   │
│   ├── dist/                  # Build output (gitignored)
│   ├── vite.config.ts         # Build configuration
│   ├── package.json
│   └── tsconfig.json
│
├── src/                       # OLD code - reference only, DO NOT MODIFY
└── legacy_notes.md            # Useful patterns extracted from old code
```

### Rules

1. **`dev_build/core/` must have ZERO `chrome.*` references.** Run `grep -r "chrome\." dev_build/core/` — it must return nothing.

2. **`dev_build/extension/content/index.ts` responsibilities:**
   - Imports from `core/`
   - Listens for messages from background
   - Creates and manages the modal (in Shadow DOM)
   - Calls core functions
   - Sends responses

3. **NO popup directory.** The UI is an in-page modal, not a browser popup.

4. **Old `src/` directory is READ-ONLY reference.** Copy logic patterns, not architecture.

---

## Modal Architecture

The UI is **NOT a browser popup** (`default_popup`). It is an **in-page modal** injected by the content script.

### Why a Modal Instead of Popup?
- Modal stays open while user interacts with the page
- Modal can show real-time updates as elements are selected
- Modal doesn't close when clicking outside (popups do)
- Better UX for a tool that needs to interact with page content

### How It Works

1. **Extension icon click** → background receives `chrome.action.onClicked`
2. **Background sends** `TOGGLE_MODAL` message to content script
3. **Content script** creates/shows/hides the modal

### Shadow DOM Isolation

The modal is injected into a **Shadow DOM** to prevent page styles from breaking it:

```typescript
// content/index.ts
const host = document.createElement('div');
host.id = 'yoink-modal-host';
const shadow = host.attachShadow({ mode: 'closed' });

// Inject modal HTML and CSS into shadow root
shadow.innerHTML = `
  <style>${modalCSS}</style>
  ${modalHTML}
`;

document.body.appendChild(host);
```

Benefits:
- Page CSS cannot affect modal styles
- Modal CSS cannot leak into page
- Clean encapsulation

### Modal Behavior

| Action | Result |
|--------|--------|
| Click extension icon | Modal appears (or hides if already open) |
| Click X button | Modal hides |
| Page scroll | Modal stays visible (fixed position) |
| Page navigation | Modal closes (content script dies) |

### Modal Positioning

- **Position:** Fixed, bottom-right corner of viewport
- **Size:** ~450px wide, auto height (max ~600px with scrollable table)
- **Z-index:** Very high (999999) to stay above page content

---

## UI Layout (Based on Wireframe)

```
┌─────────────────────────────────────────────────────────────┐
│  [X]                                               YOINK.AI │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────────┬───────────────┐  ┌──────────────────┐  │
│  │ Try Another    │    Manual     │  │       CSV        │  │
│  │    Table       │    Select     │  ├──────────────────┤  │
│  ├────────────────┼───────────────┤  │      XLSX        │  │
│  │ Locate Next    │    Start      │  ├──────────────────┤  │
│  │   Button       │   Crawling    │  │      JSON        │  │
│  └────────────────┴───────────────┘  ├──────────────────┤  │
│                                      │    COPY ALL      │  │
│  ☐ Infinite Scroll                   └──────────────────┘  │
│                                                             │
│  ┌──────────────────────┐                                  │
│  │ Min Delay [ 1  ] sec │                                  │
│  ├──────────────────────┤                                  │
│  │ Max Delay [ 20 ] sec │                                  │
│  └──────────────────────┘                                  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────┬───────────────────────────┐   │
│  │    ✨ CLEAN WITH AI     │  📄 Download Full Page    │   │
│  │        (purple)         │       HTML (green)        │   │
│  └─────────────────────────┴───────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┬──────────────┬──────────────┬────────┐   │
│  │ editable     │ editable     │ editable     │  ...   │   │
│  │ column 1     │ column 2     │ column 3     │        │   │
│  ├──────────────┼──────────────┼──────────────┼────────┤   │
│  │ content      │ content      │ content      │        │   │
│  │ content      │ content      │ content      │        │   │
│  │ content      │ content      │ content      │        │   │
│  │ (scrollable) │              │              │        │   │
│  └──────────────┴──────────────┴──────────────┴────────┘   │
│                                                             │
│  Found 24 rows × 3 columns                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### UI Component Details

**Top Controls (Left Column):**
| Button | Default State | Active State | Action |
|--------|---------------|--------------|--------|
| Try Another Table | Blue | - | Cycles to next auto-detected pattern |
| Manual Select | Blue | "Selecting..." (yellow) | Enters manual selection mode |
| Locate Next Button | Red/pink | "Located" (green) | User clicks to identify pagination |
| Start Crawling | Blue | "Stop Crawling" (red) | Toggles multi-page crawl |

**Checkbox:**
- ☐ Infinite Scroll — When checked, uses scroll-based pagination instead of button clicks

**Delay Inputs:**
- Min Delay: number input, default 1, unit "sec"
- Max Delay: number input, default 20, unit "sec"
- Used for random delay between page crawls

**Export Buttons (Right Column):**
- CSV (green) — Downloads .csv file
- XLSX (green) — Downloads .xlsx file (use SheetJS)
- JSON (green) — Downloads .json file
- COPY ALL (green) — Copies table as TSV to clipboard

**Big Action Row:**
- Clean with AI (purple, wide) — Sends data to LLM for cleanup suggestions
- Download Full Page HTML (green) — Saves current page as .html file

**Data Table:**
- Column headers are **editable** — click to rename
- Scrollable body (max-height ~250px)
- Show row count below: "Found X rows × Y columns"
- Empty state: "Click 'Try Another Table' or 'Manual Select' to begin"

### Styling Guidelines

- Width: ~450px (slightly wider than typical popup)
- Padding: 12px
- Button border-radius: 4px
- Colors:
  - Primary actions: `#6366f1` (indigo/purple)
  - Export buttons: `#22c55e` (green)
  - Warning/stop: `#ef4444` (red)
  - Neutral: `#6b7280` (gray)
- Font: system-ui, 13px base
- Table: alternating row colors, compact padding

---

## Core Library API

### types.ts

```typescript
export interface DetectedPattern {
  id: string;
  selector: string;
  count: number;
  sampleText: string[];
  confidence: number;
}

export interface ExtractedRow {
  text: string;
  links: Array<{ href: string; text: string }>;
  images: Array<{ src: string; alt: string }>;
  dataAttributes: Record<string, string>;
  structuredText: Record<string, string>;  // price, title, etc. if detected
}

export interface TableColumn {
  id: string;
  name: string;              // User-editable display name
  type: 'text' | 'number' | 'url' | 'image' | 'date' | 'price';
  sourceKey: string;         // How to extract from ExtractedRow
}

export interface DataTable {
  columns: TableColumn[];
  rows: string[][];          // 2D array of cell values
  sourceUrl: string;
  extractedAt: number;
  totalRows: number;
}

export interface PaginationInfo {
  type: 'button' | 'infinite' | 'none';
  selector?: string;
  buttonText?: string;
}
```

### detector.ts

```typescript
// Finds repeating element patterns on the page
export function detectPatterns(root: Element): DetectedPattern[];

// Applies a pattern to get all matching elements
export function getElementsByPattern(root: Element, selector: string): Element[];

// Gets the next pattern (for "Try Another Table")
export function cyclePattern(patterns: DetectedPattern[], currentIndex: number): number;
```

### selector.ts

```typescript
// Enters manual selection mode — returns cleanup function
export function enableSelectionMode(
  root: Element,
  onSelect: (element: Element) => void,
  onHover: (element: Element | null) => void
): () => void;

// Highlights elements matching selector
export function highlightElements(elements: Element[], color?: string): () => void;

// Generates a selector for an element
export function generateSelector(element: Element): string;

// Finds elements similar to the selected one
export function findSimilarElements(root: Element, element: Element): Element[];
```

### extractor.ts

```typescript
// Extracts all data from a single element
export function extractFromElement(element: Element): ExtractedRow;

// Batch extraction
export function extractFromElements(elements: Element[]): ExtractedRow[];
```

### table-builder.ts

```typescript
// Infers columns and builds table from extracted rows
export function buildTable(rows: ExtractedRow[], sourceUrl: string): DataTable;

// Renames a column (returns new table, immutable)
export function renameColumn(table: DataTable, columnId: string, newName: string): DataTable;

// Deletes a column
export function deleteColumn(table: DataTable, columnId: string): DataTable;
```

### pagination.ts

```typescript
// Detects pagination method on page
export function detectPagination(root: Element): PaginationInfo;

// Finds the "next" button if present
export function findNextButton(root: Element): Element | null;

// Checks if infinite scroll is present
export function detectInfiniteScroll(root: Element): boolean;
```

### exporter.ts

```typescript
// Generate CSV string
export function toCSV(table: DataTable): string;

// Generate JSON string
export function toJSON(table: DataTable): string;

// Generate XLSX blob (uses SheetJS)
export function toXLSX(table: DataTable): Blob;

// Format for clipboard (TSV)
export function toClipboard(table: DataTable): string;

// Generate full page HTML
export function capturePageHTML(): string;
```

---

## Message Protocol

### Background ↔ Content Script

```typescript
// Background → Content (triggered by extension icon click)
{ type: 'TOGGLE_MODAL' }
{ type: 'PING' }
{ type: 'DETECT_PATTERNS' }
{ type: 'SELECT_PATTERN', payload: { selector: string } }
{ type: 'START_MANUAL_SELECT' }
{ type: 'STOP_MANUAL_SELECT' }
{ type: 'EXTRACT_DATA' }
{ type: 'FIND_NEXT_BUTTON' }
{ type: 'CLICK_NEXT_BUTTON' }
{ type: 'HIGHLIGHT_ELEMENTS', payload: { selector: string } }

// Content → Background
{ type: 'CONTENT_READY', payload: { url: string } }
{ type: 'ELEMENT_SELECTED', payload: { selector: string, count: number } }
{ type: 'GET_STATE' }
{ type: 'TRY_ANOTHER_TABLE' }
{ type: 'LOCATE_NEXT_BUTTON' }
{ type: 'START_CRAWL', payload: { minDelay: number, maxDelay: number, infiniteScroll: boolean } }
{ type: 'STOP_CRAWL' }
{ type: 'RENAME_COLUMN', payload: { columnId: string, newName: string } }
{ type: 'EXPORT', payload: { format: 'csv' | 'xlsx' | 'json' | 'clipboard' | 'html' } }
{ type: 'AI_CLEAN' }

// Background → Content (state updates)
{ type: 'STATE_UPDATE', payload: AppState }
```

**Note:** All UI actions (button clicks, exports, etc.) now originate from the modal in the content script, not a popup.

### App State (Background)

```typescript
interface AppState {
  // Connection
  contentScriptReady: boolean;
  currentUrl: string;
  
  // Detection
  patterns: DetectedPattern[];
  currentPatternIndex: number;
  
  // Selection
  isManualSelecting: boolean;
  selectedSelector: string | null;
  selectedCount: number;
  
  // Data
  table: DataTable | null;
  
  // Pagination
  pagination: PaginationInfo | null;
  nextButtonSelector: string | null;
  
  // Crawling
  isCrawling: boolean;
  crawlProgress: { current: number; total: number; rowsCollected: number };
  
  // AI
  aiUsesRemaining: number;
}
```

---

## Implementation Phases

### Phase 1: Foundation (Must complete first)

**Goal:** Extension loads, content script runs, modal can be toggled via extension icon.

**Duration:** This phase establishes the core infrastructure. All subsequent phases depend on it.

#### 1.1 Directory Structure

Create the following structure:

```
dev_build/
├── core/
│   └── types.ts           # Shared types (NO chrome.* references)
├── extension/
│   ├── manifest.json
│   ├── background/
│   │   └── index.ts
│   ├── content/
│   │   ├── index.ts
│   │   ├── modal.html
│   │   └── modal.css
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── dist/                  # Build output (gitignored)
├── vite.config.ts
├── package.json
└── tsconfig.json
```

#### 1.2 manifest.json

```json
{
  "manifest_version": 3,
  "name": "Yoink.ai",
  "version": "0.1.0",
  "description": "Extract structured data from any webpage",
  "action": {
    "default_title": "Yoink.ai",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content/index.js"],
    "run_at": "document_idle"
  }],
  "permissions": ["activeTab", "storage"],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**Key points:**
- NO `default_popup` — we use an in-page modal instead
- `action.onClicked` only fires when there's no default_popup
- `run_at: document_idle` ensures DOM is ready

#### 1.3 core/types.ts

Shared TypeScript types. **ZERO `chrome.*` references allowed.**

```typescript
// Message types for extension communication
export type MessageType =
  | 'TOGGLE_MODAL'
  | 'PING'
  | 'CONTENT_READY'
  | 'GET_STATE'
  | 'STATE_UPDATE'
  | 'DETECT_PATTERNS'
  | 'TRY_ANOTHER_TABLE'
  | 'START_MANUAL_SELECT'
  | 'STOP_MANUAL_SELECT'
  | 'ELEMENT_SELECTED'
  | 'EXTRACT_DATA'
  | 'EXPORT';

export interface Message {
  type: MessageType;
  payload?: unknown;
}

export interface ContentReadyPayload {
  url: string;
}

// These will be expanded in Phase 2
export interface DetectedPattern {
  id: string;
  selector: string;
  count: number;
  sampleText: string[];
  confidence: number;
}

export interface DataTable {
  columns: Array<{ id: string; name: string }>;
  rows: string[][];
  sourceUrl: string;
  extractedAt: number;
  totalRows: number;
}
```

#### 1.4 background/index.ts

```typescript
import type { Message, ContentReadyPayload } from '../../core/types';

// Track which tabs have content scripts ready
const tabStates = new Map<number, { ready: boolean; url: string }>();

// Listen for extension icon click → toggle modal
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MODAL' } as Message)
      .catch((err) => {
        console.warn('[Yoink] Could not send TOGGLE_MODAL:', err.message);
        // Content script not loaded (restricted page like chrome://)
      });
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (msg.type) {
    case 'CONTENT_READY':
      if (tabId) {
        const payload = msg.payload as ContentReadyPayload;
        tabStates.set(tabId, { ready: true, url: payload.url });
        console.log('[Yoink] Content script ready on tab', tabId);
      }
      break;

    case 'GET_STATE':
      if (tabId) {
        const state = tabStates.get(tabId);
        sendResponse({ ready: state?.ready ?? false, url: state?.url ?? '' });
      }
      break;
  }

  return true; // Keep message channel open for async response
});

// Clean up when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

// Clean up when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabStates.delete(tabId);
  }
});

console.log('[Yoink] Background service worker started');
```

#### 1.5 content/index.ts

```typescript
import type { Message } from '../../core/types';
import modalHTML from './modal.html?raw';
import modalCSS from './modal.css?raw';

console.log('[Yoink] Content script loaded:', location.href);

// Notify background that content script is ready
chrome.runtime.sendMessage({
  type: 'CONTENT_READY',
  payload: { url: location.href }
} as Message);

// Modal state
let modalHost: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let isModalVisible = false;

/**
 * Create the modal inside a Shadow DOM for style isolation
 */
function createModal(): ShadowRoot {
  modalHost = document.createElement('div');
  modalHost.id = 'yoink-modal-host';
  modalHost.style.cssText = 'all: initial;'; // Reset inherited styles

  shadowRoot = modalHost.attachShadow({ mode: 'closed' });
  shadowRoot.innerHTML = `<style>${modalCSS}</style>${modalHTML}`;

  // Wire up close button
  const closeBtn = shadowRoot.querySelector('.yoink-close');
  closeBtn?.addEventListener('click', hideModal);

  document.body.appendChild(modalHost);
  return shadowRoot;
}

function showModal() {
  if (!shadowRoot) {
    shadowRoot = createModal();
  }
  const modal = shadowRoot.querySelector('.yoink-modal') as HTMLElement;
  if (modal) {
    modal.style.display = 'flex';
    isModalVisible = true;
  }
}

function hideModal() {
  if (shadowRoot) {
    const modal = shadowRoot.querySelector('.yoink-modal') as HTMLElement;
    if (modal) {
      modal.style.display = 'none';
      isModalVisible = false;
    }
  }
}

function toggleModal() {
  if (isModalVisible) {
    hideModal();
  } else {
    showModal();
  }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  switch (msg.type) {
    case 'PING':
      sendResponse({ success: true });
      break;

    case 'TOGGLE_MODAL':
      toggleModal();
      sendResponse({ visible: isModalVisible });
      break;
  }

  return true;
});
```

#### 1.6 content/modal.html

Basic layout shell (buttons non-functional in Phase 1):

```html
<div class="yoink-modal">
  <!-- Header -->
  <div class="yoink-header">
    <button class="yoink-close" title="Close">✕</button>
    <span class="yoink-title">YOINK.AI</span>
  </div>

  <!-- Controls Section -->
  <div class="yoink-controls">
    <div class="yoink-controls-left">
      <!-- 2x2 Button Grid -->
      <div class="yoink-button-grid">
        <button class="yoink-btn yoink-btn-primary" data-action="try-another">
          Try Another<br>Table
        </button>
        <button class="yoink-btn yoink-btn-primary" data-action="manual-select">
          Manual<br>Select
        </button>
        <button class="yoink-btn yoink-btn-danger" data-action="locate-next">
          Locate Next<br>Button
        </button>
        <button class="yoink-btn yoink-btn-primary" data-action="start-crawl">
          Start<br>Crawling
        </button>
      </div>

      <!-- Infinite Scroll Checkbox -->
      <label class="yoink-checkbox">
        <input type="checkbox" id="infinite-scroll">
        <span>Infinite Scroll</span>
      </label>

      <!-- Delay Inputs -->
      <div class="yoink-delay-inputs">
        <div class="yoink-delay-row">
          <span>Min Delay</span>
          <input type="number" value="1" min="0" max="60" id="min-delay">
          <span>sec</span>
        </div>
        <div class="yoink-delay-row">
          <span>Max Delay</span>
          <input type="number" value="20" min="0" max="120" id="max-delay">
          <span>sec</span>
        </div>
      </div>
    </div>

    <div class="yoink-controls-right">
      <!-- Export Buttons -->
      <button class="yoink-btn yoink-btn-export" data-action="export-csv">CSV</button>
      <button class="yoink-btn yoink-btn-export" data-action="export-xlsx">XLSX</button>
      <button class="yoink-btn yoink-btn-export" data-action="export-json">JSON</button>
      <button class="yoink-btn yoink-btn-export" data-action="copy-all">COPY ALL</button>
    </div>
  </div>

  <!-- Action Buttons Row -->
  <div class="yoink-actions">
    <button class="yoink-btn yoink-btn-ai" data-action="clean-ai">
      ✨ CLEAN WITH AI
    </button>
    <button class="yoink-btn yoink-btn-export" data-action="download-html">
      📄 Download Full Page HTML
    </button>
  </div>

  <!-- Data Table -->
  <div class="yoink-table-container">
    <table class="yoink-table">
      <thead>
        <tr>
          <th><input type="text" value="Column 1" class="yoink-col-header"></th>
          <th><input type="text" value="Column 2" class="yoink-col-header"></th>
          <th><input type="text" value="Column 3" class="yoink-col-header"></th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="3" class="yoink-empty-state">
            Click "Try Another Table" or "Manual Select" to begin
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Status Bar -->
  <div class="yoink-status">
    <span class="yoink-status-text">Ready</span>
  </div>
</div>
```

#### 1.7 content/modal.css

```css
/* Reset and base */
.yoink-modal {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 460px;
  max-height: 600px;
  background: #f5f5f5;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  z-index: 999999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
.yoink-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #e0e0e0;
  border-bottom: 1px solid #ccc;
}

.yoink-close {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  color: #666;
}

.yoink-close:hover {
  background: #d0d0d0;
  color: #333;
}

.yoink-title {
  font-weight: 600;
  color: #333;
  letter-spacing: 1px;
}

/* Controls Section */
.yoink-controls {
  display: flex;
  gap: 16px;
  padding: 12px;
}

.yoink-controls-left {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.yoink-controls-right {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100px;
}

/* Button Grid */
.yoink-button-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

/* Buttons */
.yoink-btn {
  padding: 8px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: opacity 0.2s;
}

.yoink-btn:hover {
  opacity: 0.9;
}

.yoink-btn:active {
  opacity: 0.8;
}

.yoink-btn-primary {
  background: #6366f1;
  color: white;
}

.yoink-btn-danger {
  background: #ec4899;
  color: white;
}

.yoink-btn-export {
  background: #22c55e;
  color: white;
}

.yoink-btn-ai {
  background: #8b5cf6;
  color: white;
  flex: 1;
}

/* Checkbox */
.yoink-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.yoink-checkbox input {
  width: 16px;
  height: 16px;
}

/* Delay Inputs */
.yoink-delay-inputs {
  background: #ffe4e6;
  border-radius: 4px;
  padding: 8px;
}

.yoink-delay-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.yoink-delay-row + .yoink-delay-row {
  margin-top: 4px;
}

.yoink-delay-row input {
  width: 50px;
  padding: 4px;
  border: 1px solid #ccc;
  border-radius: 4px;
  text-align: center;
}

/* Action Buttons Row */
.yoink-actions {
  display: flex;
  gap: 8px;
  padding: 0 12px 12px;
}

.yoink-actions .yoink-btn {
  flex: 1;
  padding: 12px;
}

/* Table */
.yoink-table-container {
  flex: 1;
  overflow: auto;
  max-height: 250px;
  margin: 0 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
}

.yoink-table {
  width: 100%;
  border-collapse: collapse;
}

.yoink-table th,
.yoink-table td {
  padding: 8px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

.yoink-table th {
  background: #f9f9f9;
  position: sticky;
  top: 0;
}

.yoink-col-header {
  border: none;
  background: transparent;
  font-weight: 600;
  width: 100%;
  padding: 4px;
}

.yoink-col-header:focus {
  outline: 2px solid #6366f1;
  border-radius: 2px;
}

.yoink-empty-state {
  text-align: center;
  color: #999;
  padding: 40px !important;
}

/* Status Bar */
.yoink-status {
  padding: 8px 12px;
  background: #e0e0e0;
  border-top: 1px solid #ccc;
  font-size: 12px;
  color: #666;
}
```

#### 1.8 Build Configuration

**vite.config.ts:**

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyDirBeforeWrite: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'extension/background/index.ts'),
        content: resolve(__dirname, 'extension/content/index.ts'),
      },
      output: {
        entryFileNames: '[name]/index.js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'core'),
    },
  },
});
```

**package.json:**

```json
{
  "name": "yoink-extension",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build",
    "check-core": "grep -r \"chrome\\.\" core/ && exit 1 || echo 'No chrome.* in core/ ✓'"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

#### 1.9 Icons

Create placeholder icons (solid purple squares):
- `icons/icon16.png` — 16×16px
- `icons/icon48.png` — 48×48px
- `icons/icon128.png` — 128×128px

#### 1.10 Verification Checklist

```bash
# 1. Build succeeds
cd dev_build && npm run build
# Expected: dist/ folder created with background/index.js and content/index.js

# 2. No chrome.* in core/
npm run check-core
# Expected: "No chrome.* in core/ ✓"

# 3. Load extension in Chrome
# - Go to chrome://extensions
# - Enable "Developer mode"
# - Click "Load unpacked" → select dist/ folder
# - Should see Yoink.ai with purple icon

# 4. Test on any webpage (not chrome:// pages)
# - Open any website (e.g., google.com)
# - Check DevTools console: "[Yoink] Content script loaded: https://..."
# - Click extension icon → modal appears
# - Click extension icon again → modal hides
# - Click X button → modal hides
# - Modal should be styled correctly (not affected by page CSS)
```

---

### Phase 2: Core Detection & Extraction

**Goal:** "Try Another Table" works, data appears in modal.

**Depends on:** Phase 1 complete

#### 2.1 Overview

This phase implements the core pattern detection algorithm that finds repeating elements on a page (product listings, table rows, search results, etc.) and extracts their data.

#### 2.2 Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `core/detector.ts` | Create | Find repeating patterns in DOM |
| `core/extractor.ts` | Create | Extract data from elements |
| `core/table-builder.ts` | Create | Build structured table from raw data |
| `core/index.ts` | Create | Barrel export for core modules |
| `content/index.ts` | Modify | Wire up detection to modal buttons |
| `content/modal.html` | Modify | Update table rendering |

#### 2.3 core/detector.ts

```typescript
import type { DetectedPattern } from './types';

/**
 * Finds repeating element patterns on a page.
 *
 * Strategy:
 * 1. Find all elements with multiple siblings of same tag
 * 2. Group by parent + tag combination
 * 3. Score by count, depth, and content variety
 * 4. Return top patterns sorted by confidence
 */
export function detectPatterns(root: Element = document.body): DetectedPattern[] {
  const patterns: Map<string, Element[]> = new Map();

  // Find candidate containers (elements with 3+ similar children)
  const containers = findContainers(root);

  for (const container of containers) {
    const selector = generatePatternSelector(container);
    const elements = Array.from(root.querySelectorAll(selector));

    if (elements.length >= 3) {
      patterns.set(selector, elements);
    }
  }

  // Convert to DetectedPattern and score
  return Array.from(patterns.entries())
    .map(([selector, elements]) => ({
      id: generateId(),
      selector,
      count: elements.length,
      sampleText: elements.slice(0, 3).map(el => el.textContent?.trim().slice(0, 50) || ''),
      confidence: calculateConfidence(elements),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10); // Top 10 patterns
}

/**
 * Gets all elements matching a pattern selector
 */
export function getElementsByPattern(root: Element, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/**
 * Cycles to the next pattern (for "Try Another Table")
 */
export function cyclePattern(patterns: DetectedPattern[], currentIndex: number): number {
  if (patterns.length === 0) return -1;
  return (currentIndex + 1) % patterns.length;
}

// Helper functions
function findContainers(root: Element): Element[] {
  // Implementation: walk DOM, find elements with 3+ same-tag children
  // ...
}

function generatePatternSelector(container: Element): string {
  // Implementation: create CSS selector for container's children
  // ...
}

function calculateConfidence(elements: Element[]): number {
  // Implementation: score based on count, text variety, structure similarity
  // ...
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}
```

#### 2.4 core/extractor.ts

```typescript
import type { ExtractedRow } from './types';

/**
 * Extracts all meaningful data from a single element
 */
export function extractFromElement(element: Element): ExtractedRow {
  return {
    text: element.textContent?.trim() || '',
    links: extractLinks(element),
    images: extractImages(element),
    dataAttributes: extractDataAttributes(element),
    structuredText: extractStructuredText(element),
  };
}

/**
 * Batch extraction from multiple elements
 */
export function extractFromElements(elements: Element[]): ExtractedRow[] {
  return elements.map(extractFromElement);
}

function extractLinks(element: Element): Array<{ href: string; text: string }> {
  return Array.from(element.querySelectorAll('a[href]')).map(a => ({
    href: (a as HTMLAnchorElement).href,
    text: a.textContent?.trim() || '',
  }));
}

function extractImages(element: Element): Array<{ src: string; alt: string }> {
  return Array.from(element.querySelectorAll('img[src]')).map(img => ({
    src: (img as HTMLImageElement).src,
    alt: (img as HTMLImageElement).alt || '',
  }));
}

function extractDataAttributes(element: Element): Record<string, string> {
  const data: Record<string, string> = {};
  for (const attr of element.attributes) {
    if (attr.name.startsWith('data-')) {
      data[attr.name] = attr.value;
    }
  }
  return data;
}

function extractStructuredText(element: Element): Record<string, string> {
  // Look for common patterns: prices, dates, ratings, etc.
  const structured: Record<string, string> = {};
  const text = element.textContent || '';

  // Price detection
  const priceMatch = text.match(/\$[\d,]+\.?\d*/);
  if (priceMatch) structured.price = priceMatch[0];

  // More patterns...
  return structured;
}
```

#### 2.5 core/table-builder.ts

```typescript
import type { DataTable, ExtractedRow, TableColumn } from './types';

/**
 * Builds a structured table from extracted rows.
 * Infers column types and creates meaningful column names.
 */
export function buildTable(rows: ExtractedRow[], sourceUrl: string): DataTable {
  if (rows.length === 0) {
    return {
      columns: [],
      rows: [],
      sourceUrl,
      extractedAt: Date.now(),
      totalRows: 0,
    };
  }

  // Analyze first few rows to determine columns
  const columns = inferColumns(rows.slice(0, 5));

  // Extract cell values based on inferred columns
  const tableRows = rows.map(row => extractRowValues(row, columns));

  return {
    columns,
    rows: tableRows,
    sourceUrl,
    extractedAt: Date.now(),
    totalRows: rows.length,
  };
}

/**
 * Renames a column (immutable)
 */
export function renameColumn(table: DataTable, columnId: string, newName: string): DataTable {
  return {
    ...table,
    columns: table.columns.map(col =>
      col.id === columnId ? { ...col, name: newName } : col
    ),
  };
}

/**
 * Deletes a column (immutable)
 */
export function deleteColumn(table: DataTable, columnId: string): DataTable {
  const colIndex = table.columns.findIndex(c => c.id === columnId);
  if (colIndex === -1) return table;

  return {
    ...table,
    columns: table.columns.filter(c => c.id !== columnId),
    rows: table.rows.map(row => row.filter((_, i) => i !== colIndex)),
  };
}

function inferColumns(sampleRows: ExtractedRow[]): TableColumn[] {
  // Implementation: analyze sample data to create columns
  // ...
}

function extractRowValues(row: ExtractedRow, columns: TableColumn[]): string[] {
  // Implementation: map row data to column values
  // ...
}
```

#### 2.6 Wire Up content/index.ts

Add to content/index.ts:

```typescript
import { detectPatterns, getElementsByPattern, cyclePattern } from '../../core/detector';
import { extractFromElements } from '../../core/extractor';
import { buildTable } from '../../core/table-builder';
import type { DetectedPattern, DataTable } from '../../core/types';

// State
let patterns: DetectedPattern[] = [];
let currentPatternIndex = -1;
let currentTable: DataTable | null = null;

// Wire up "Try Another Table" button
function initModalButtons() {
  if (!shadowRoot) return;

  const tryAnotherBtn = shadowRoot.querySelector('[data-action="try-another"]');
  tryAnotherBtn?.addEventListener('click', handleTryAnother);
}

function handleTryAnother() {
  // First click: detect patterns
  if (patterns.length === 0) {
    patterns = detectPatterns(document.body);
    if (patterns.length === 0) {
      updateStatus('No patterns found on this page');
      return;
    }
  }

  // Cycle to next pattern
  currentPatternIndex = cyclePattern(patterns, currentPatternIndex);
  const pattern = patterns[currentPatternIndex];

  // Extract and build table
  const elements = getElementsByPattern(document.body, pattern.selector);
  const rows = extractFromElements(elements);
  currentTable = buildTable(rows, location.href);

  // Update UI
  renderTable(currentTable);
  updateStatus(`Pattern ${currentPatternIndex + 1}/${patterns.length}: ${pattern.count} items`);
}

function renderTable(table: DataTable) {
  // Implementation: update modal table DOM
  // ...
}

function updateStatus(text: string) {
  if (!shadowRoot) return;
  const status = shadowRoot.querySelector('.yoink-status-text');
  if (status) status.textContent = text;
}
```

#### 2.7 Verification Checklist

```bash
# 1. Build succeeds
npm run build

# 2. No chrome.* in core/
npm run check-core

# 3. Test on Amazon product listing
# - Go to amazon.com, search for anything
# - Click extension icon → modal appears
# - Click "Try Another Table"
# - Table should populate with product data
# - Click again → different pattern selected
# - Status shows "Pattern X/Y: N items"

# 4. Test on Wikipedia table page
# - Go to any Wikipedia page with tables
# - Click "Try Another Table"
# - Should detect table rows

# 5. Test on empty/minimal page
# - Go to about:blank or simple page
# - Click "Try Another Table"
# - Should show "No patterns found"
```

---

### Phase 3: Manual Selection

**Goal:** User can click to select elements, and the extension finds similar elements.

**Depends on:** Phase 2 complete

#### 3.1 Overview

This phase adds the ability for users to manually select an element on the page. The extension then finds all similar elements and extracts data from them.

#### 3.2 Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `core/selector.ts` | Create | Element selection and similarity matching |
| `content/index.ts` | Modify | Wire up selection mode |
| `content/modal.css` | Modify | Add highlight styles |

#### 3.3 core/selector.ts

```typescript
/**
 * Handles manual element selection and similarity matching.
 */

// Highlight color for selection mode
const HOVER_COLOR = 'rgba(99, 102, 241, 0.3)';   // indigo
const SELECT_COLOR = 'rgba(34, 197, 94, 0.3)';   // green

/**
 * Enables manual selection mode.
 * Returns a cleanup function to exit selection mode.
 */
export function enableSelectionMode(
  root: Element,
  onSelect: (element: Element) => void,
  onHover: (element: Element | null) => void
): () => void {
  let hoveredElement: Element | null = null;

  const handleMouseMove = (e: MouseEvent) => {
    const target = e.target as Element;
    if (target === hoveredElement) return;

    // Remove previous highlight
    if (hoveredElement) {
      removeHighlight(hoveredElement);
    }

    // Don't highlight the modal itself
    if (isModalElement(target)) {
      hoveredElement = null;
      onHover(null);
      return;
    }

    // Add new highlight
    hoveredElement = target;
    addHighlight(target, HOVER_COLOR);
    onHover(target);
  };

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.target as Element;
    if (isModalElement(target)) return;

    onSelect(target);
  };

  // Add listeners
  root.addEventListener('mousemove', handleMouseMove, true);
  root.addEventListener('click', handleClick, true);

  // Change cursor
  document.body.style.cursor = 'crosshair';

  // Return cleanup function
  return () => {
    root.removeEventListener('mousemove', handleMouseMove, true);
    root.removeEventListener('click', handleClick, true);
    document.body.style.cursor = '';

    if (hoveredElement) {
      removeHighlight(hoveredElement);
    }
  };
}

/**
 * Highlights all provided elements
 */
export function highlightElements(elements: Element[], color = SELECT_COLOR): () => void {
  elements.forEach(el => addHighlight(el, color));

  return () => {
    elements.forEach(removeHighlight);
  };
}

/**
 * Generates a CSS selector for an element
 */
export function generateSelector(element: Element): string {
  // Strategy: Use tag + classes + nth-child as needed
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    // Add ID if present (most specific)
    if (current.id) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    }

    // Add meaningful classes
    const classes = Array.from(current.classList)
      .filter(c => !c.match(/^(js-|is-|has-)/)) // Skip state classes
      .slice(0, 2);

    if (classes.length) {
      selector += '.' + classes.join('.');
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}

/**
 * Finds elements similar to the selected one
 */
export function findSimilarElements(root: Element, element: Element): Element[] {
  // Strategy 1: Same parent, same tag
  const parent = element.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(
      child => child.tagName === element.tagName
    );
    if (siblings.length >= 3) {
      return siblings;
    }
  }

  // Strategy 2: Same selector pattern
  const selector = generateSelector(element);
  const bySelector = Array.from(root.querySelectorAll(selector));
  if (bySelector.length >= 2) {
    return bySelector;
  }

  // Strategy 3: Same tag + similar classes
  const classes = Array.from(element.classList).slice(0, 2).join('.');
  if (classes) {
    const byClass = Array.from(root.querySelectorAll(`${element.tagName}.${classes}`));
    if (byClass.length >= 2) {
      return byClass;
    }
  }

  // Fallback: just the selected element
  return [element];
}

// Helper functions
function addHighlight(element: Element, color: string) {
  const el = element as HTMLElement;
  el.dataset.yoinkOriginalOutline = el.style.outline;
  el.dataset.yoinkOriginalBg = el.style.backgroundColor;
  el.style.outline = '2px solid #6366f1';
  el.style.backgroundColor = color;
}

function removeHighlight(element: Element) {
  const el = element as HTMLElement;
  el.style.outline = el.dataset.yoinkOriginalOutline || '';
  el.style.backgroundColor = el.dataset.yoinkOriginalBg || '';
  delete el.dataset.yoinkOriginalOutline;
  delete el.dataset.yoinkOriginalBg;
}

function isModalElement(element: Element): boolean {
  return !!element.closest('#yoink-modal-host');
}
```

#### 3.4 Wire Up content/index.ts

Add to content/index.ts:

```typescript
import {
  enableSelectionMode,
  highlightElements,
  findSimilarElements,
  generateSelector,
} from '../../core/selector';

// State
let isSelecting = false;
let cleanupSelection: (() => void) | null = null;
let cleanupHighlights: (() => void) | null = null;

function initSelectionButton() {
  if (!shadowRoot) return;

  const manualSelectBtn = shadowRoot.querySelector('[data-action="manual-select"]');
  manualSelectBtn?.addEventListener('click', toggleSelectionMode);
}

function toggleSelectionMode() {
  if (isSelecting) {
    exitSelectionMode();
  } else {
    enterSelectionMode();
  }
}

function enterSelectionMode() {
  isSelecting = true;
  hideModal(); // Hide modal while selecting

  cleanupSelection = enableSelectionMode(
    document.body,
    handleElementSelected,
    handleElementHover
  );

  updateSelectButton('Selecting...', 'yoink-btn-warning');
  updateStatus('Click an element to select it (ESC to cancel)');

  // Allow ESC to cancel
  document.addEventListener('keydown', handleEscKey);
}

function exitSelectionMode() {
  isSelecting = false;

  if (cleanupSelection) {
    cleanupSelection();
    cleanupSelection = null;
  }

  updateSelectButton('Manual Select', 'yoink-btn-primary');
  document.removeEventListener('keydown', handleEscKey);
  showModal();
}

function handleElementSelected(element: Element) {
  exitSelectionMode();

  // Find similar elements
  const similar = findSimilarElements(document.body, element);

  // Clear previous highlights
  if (cleanupHighlights) {
    cleanupHighlights();
  }

  // Highlight all similar elements
  cleanupHighlights = highlightElements(similar);

  // Extract data
  const selector = generateSelector(element);
  const rows = extractFromElements(similar);
  currentTable = buildTable(rows, location.href);

  // Update UI
  renderTable(currentTable);
  updateStatus(`Selected: ${similar.length} similar elements`);

  // Store for future use
  patterns = [{
    id: 'manual',
    selector,
    count: similar.length,
    sampleText: similar.slice(0, 3).map(el => el.textContent?.trim().slice(0, 50) || ''),
    confidence: 1,
  }];
  currentPatternIndex = 0;
}

function handleElementHover(element: Element | null) {
  // Optional: update status with hovered element info
  if (element) {
    updateStatus(`Hover: <${element.tagName.toLowerCase()}> - Click to select`);
  }
}

function handleEscKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    exitSelectionMode();
  }
}

function updateSelectButton(text: string, className: string) {
  if (!shadowRoot) return;
  const btn = shadowRoot.querySelector('[data-action="manual-select"]');
  if (btn) {
    btn.textContent = text;
    btn.className = `yoink-btn ${className}`;
  }
}
```

#### 3.5 Add Warning Button Style

Add to content/modal.css:

```css
.yoink-btn-warning {
  background: #eab308;
  color: black;
}
```

#### 3.6 Verification Checklist

```bash
# 1. Build succeeds
npm run build

# 2. No chrome.* in core/
npm run check-core

# 3. Test selection mode entry/exit
# - Click "Manual Select" → cursor changes to crosshair
# - Modal hides
# - Button text changes to "Selecting..."
# - Press ESC → exits selection mode
# - Modal reappears

# 4. Test element hovering
# - Enter selection mode
# - Hover over elements → they highlight with outline
# - Moving away removes highlight
# - Modal elements don't highlight

# 5. Test element selection
# - Enter selection mode
# - Click any repeating element (e.g., search result)
# - Similar elements get highlighted
# - Modal appears with extracted data
# - Status shows "Selected: N similar elements"

# 6. Test on different sites
# - Amazon product listing: click one product
# - Google search results: click one result
# - Wikipedia: click a table cell
# - News site: click an article card

# 7. Test edge cases
# - Click on text inside an element
# - Click on nested elements
# - Click on single element (no siblings)
```

#### 3.7 Button State Changes

| Button | Default State | During Selection |
|--------|---------------|------------------|
| Manual Select | Blue, "Manual Select" | Yellow, "Selecting..." |
| Modal | Visible | Hidden |
| Cursor | Default | Crosshair |

---

### Phase 4: Export

**Goal:** All export buttons work: CSV, XLSX, JSON, Copy All, and Download Full Page HTML.

**Depends on:** Phase 2 complete (need data to export)

#### 4.1 Overview

This phase implements all data export functionality. Users can export their extracted data in multiple formats for use in spreadsheets, databases, or other tools.

#### 4.2 Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `core/exporter.ts` | Create | Generate CSV, JSON, XLSX, clipboard formats |
| `content/index.ts` | Modify | Wire up export buttons |
| `package.json` | Modify | Add SheetJS dependency for XLSX |

#### 4.3 core/exporter.ts

```typescript
import type { DataTable } from './types';

/**
 * Generates a CSV string from a DataTable.
 * Handles escaping of quotes and commas.
 */
export function toCSV(table: DataTable): string {
  const escape = (val: string): string => {
    // If value contains comma, quote, or newline, wrap in quotes and escape quotes
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const header = table.columns.map(col => escape(col.name)).join(',');
  const rows = table.rows.map(row => row.map(escape).join(','));

  return [header, ...rows].join('\n');
}

/**
 * Generates a JSON string from a DataTable.
 * Returns an array of objects with column names as keys.
 */
export function toJSON(table: DataTable): string {
  const data = table.rows.map(row => {
    const obj: Record<string, string> = {};
    table.columns.forEach((col, i) => {
      obj[col.name] = row[i] ?? '';
    });
    return obj;
  });

  return JSON.stringify(data, null, 2);
}

/**
 * Generates TSV string for clipboard (tabs between columns).
 * Most spreadsheet apps accept TSV paste.
 */
export function toClipboard(table: DataTable): string {
  const header = table.columns.map(col => col.name).join('\t');
  const rows = table.rows.map(row => row.join('\t'));
  return [header, ...rows].join('\n');
}

/**
 * Generates an XLSX blob using SheetJS.
 * Import dynamically to avoid loading SheetJS unless needed.
 */
export async function toXLSX(table: DataTable): Promise<Blob> {
  // Dynamic import to reduce initial bundle size
  const XLSX = await import('xlsx');

  // Create worksheet data (array of arrays)
  const wsData = [
    table.columns.map(col => col.name),
    ...table.rows,
  ];

  // Create workbook and worksheet
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Auto-size columns (optional enhancement)
  const colWidths = table.columns.map((col, i) => {
    const maxLen = Math.max(
      col.name.length,
      ...table.rows.map(row => (row[i] ?? '').length)
    );
    return { wch: Math.min(maxLen + 2, 50) };
  });
  ws['!cols'] = colWidths;

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Data');

  // Generate blob
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Captures the full page HTML including doctype.
 */
export function capturePageHTML(): string {
  const doctype = document.doctype
    ? `<!DOCTYPE ${document.doctype.name}${document.doctype.publicId ? ` PUBLIC "${document.doctype.publicId}"` : ''}${document.doctype.systemId ? ` "${document.doctype.systemId}"` : ''}>`
    : '<!DOCTYPE html>';

  return `${doctype}\n${document.documentElement.outerHTML}`;
}

/**
 * Triggers a file download in the browser.
 */
export function downloadFile(content: string | Blob, filename: string, mimeType: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Copies text to clipboard using modern Clipboard API.
 * Falls back to execCommand for older browsers.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers or when clipboard API fails
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

/**
 * Generates a filename with timestamp.
 */
export function generateFilename(base: string, extension: string): string {
  const date = new Date();
  const timestamp = date.toISOString().slice(0, 19).replace(/[T:]/g, '-');
  return `${base}-${timestamp}.${extension}`;
}
```

#### 4.4 Wire Up content/index.ts

Add to content/index.ts:

```typescript
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

function initExportButtons() {
  if (!shadowRoot) return;

  // CSV
  shadowRoot.querySelector('[data-action="export-csv"]')
    ?.addEventListener('click', handleExportCSV);

  // XLSX
  shadowRoot.querySelector('[data-action="export-xlsx"]')
    ?.addEventListener('click', handleExportXLSX);

  // JSON
  shadowRoot.querySelector('[data-action="export-json"]')
    ?.addEventListener('click', handleExportJSON);

  // Copy All
  shadowRoot.querySelector('[data-action="copy-all"]')
    ?.addEventListener('click', handleCopyAll);

  // Download HTML
  shadowRoot.querySelector('[data-action="download-html"]')
    ?.addEventListener('click', handleDownloadHTML);
}

async function handleExportCSV() {
  if (!currentTable || currentTable.rows.length === 0) {
    updateStatus('No data to export');
    return;
  }

  const csv = toCSV(currentTable);
  const filename = generateFilename('yoink-data', 'csv');
  downloadFile(csv, filename, 'text/csv;charset=utf-8');
  updateStatus(`Exported ${currentTable.rows.length} rows to ${filename}`);
}

async function handleExportXLSX() {
  if (!currentTable || currentTable.rows.length === 0) {
    updateStatus('No data to export');
    return;
  }

  updateStatus('Generating XLSX...');

  try {
    const blob = await toXLSX(currentTable);
    const filename = generateFilename('yoink-data', 'xlsx');
    downloadFile(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    updateStatus(`Exported ${currentTable.rows.length} rows to ${filename}`);
  } catch (error) {
    console.error('[Yoink] XLSX export failed:', error);
    updateStatus('XLSX export failed - see console');
  }
}

async function handleExportJSON() {
  if (!currentTable || currentTable.rows.length === 0) {
    updateStatus('No data to export');
    return;
  }

  const json = toJSON(currentTable);
  const filename = generateFilename('yoink-data', 'json');
  downloadFile(json, filename, 'application/json');
  updateStatus(`Exported ${currentTable.rows.length} rows to ${filename}`);
}

async function handleCopyAll() {
  if (!currentTable || currentTable.rows.length === 0) {
    updateStatus('No data to copy');
    return;
  }

  const tsv = toClipboard(currentTable);
  const success = await copyToClipboard(tsv);

  if (success) {
    updateStatus(`Copied ${currentTable.rows.length} rows to clipboard`);
  } else {
    updateStatus('Failed to copy to clipboard');
  }
}

function handleDownloadHTML() {
  const html = capturePageHTML();
  const filename = generateFilename('page', 'html');
  downloadFile(html, filename, 'text/html;charset=utf-8');
  updateStatus(`Downloaded page HTML as ${filename}`);
}
```

#### 4.5 Add SheetJS Dependency

Update package.json:

```json
{
  "name": "yoink-extension",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build",
    "check-core": "grep -r \"chrome\\.\" core/ && exit 1 || echo 'No chrome.* in core/ ✓'"
  },
  "dependencies": {
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

**Note:** SheetJS is dynamically imported in `toXLSX()` to avoid loading it until needed, reducing initial bundle size.

#### 4.6 Export Button Behavior

| Button | Format | MIME Type | Extension | Notes |
|--------|--------|-----------|-----------|-------|
| CSV | Comma-separated | text/csv | .csv | Universal spreadsheet format |
| XLSX | Excel workbook | application/vnd... | .xlsx | Native Excel, preserves formatting |
| JSON | JSON array | application/json | .json | For developers/APIs |
| COPY ALL | Tab-separated | - | - | Paste directly into Excel/Sheets |
| Download HTML | Full page | text/html | .html | For archival/debugging |

#### 4.7 Verification Checklist

```bash
# 1. Build succeeds
npm run build

# 2. No chrome.* in core/
npm run check-core

# 3. Test with no data
# - Click any export button before selecting data
# - Should show "No data to export" status

# 4. Test CSV export
# - Extract some data using "Try Another Table"
# - Click CSV button
# - File downloads with timestamp name
# - Open in Excel/Numbers/Sheets → data displays correctly
# - Check: commas in data are properly escaped

# 5. Test XLSX export
# - Click XLSX button
# - File downloads
# - Open in Excel → data displays with column headers
# - Check: columns are auto-sized

# 6. Test JSON export
# - Click JSON button
# - File downloads
# - Open in text editor → valid JSON array of objects
# - Column names are object keys

# 7. Test Copy All
# - Click COPY ALL button
# - Open Excel/Google Sheets → Paste
# - Data appears in cells with correct columns

# 8. Test Download Full Page HTML
# - Click "Download Full Page HTML"
# - File downloads
# - Open .html file in browser → page renders (may lack assets)

# 9. Test with special characters
# - Extract data containing commas, quotes, newlines
# - Export to CSV → should be properly escaped
# - Export to JSON → should be properly escaped
```

---

### Phase 5: Editable Columns

**Goal:** Users can click column headers to rename them. Custom names persist and are used in exports.

**Depends on:** Phase 2 complete (need table with columns)

#### 5.1 Overview

This phase enables users to customize column names by clicking on the header and typing a new name. This is essential for creating clean exports with meaningful column headers instead of auto-generated ones.

#### 5.2 Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `core/table-builder.ts` | Modify | Add `renameColumn` function (already exists) |
| `content/index.ts` | Modify | Wire up editable column headers |
| `content/modal.css` | Modify | Style editable headers |

#### 5.3 Update renderTable in content/index.ts

The table rendering needs to create editable header inputs and handle their events:

```typescript
/**
 * Renders the data table in the modal.
 * Creates editable column headers and scrollable data rows.
 */
function renderTable(table: DataTable) {
  if (!shadowRoot) return;

  const container = shadowRoot.querySelector('.yoink-table-container');
  if (!container) return;

  // Handle empty table
  if (!table || table.columns.length === 0) {
    container.innerHTML = `
      <table class="yoink-table">
        <tbody>
          <tr>
            <td class="yoink-empty-state">
              Click "Try Another Table" or "Manual Select" to begin
            </td>
          </tr>
        </tbody>
      </table>
    `;
    return;
  }

  // Build header row with editable inputs
  const headerCells = table.columns.map((col, index) => `
    <th>
      <input
        type="text"
        class="yoink-col-header"
        value="${escapeHtml(col.name)}"
        data-column-id="${col.id}"
        data-column-index="${index}"
      >
    </th>
  `).join('');

  // Build data rows (limit to first 100 for performance)
  const displayRows = table.rows.slice(0, 100);
  const dataRows = displayRows.map(row => `
    <tr>
      ${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}
    </tr>
  `).join('');

  // Show truncation notice if needed
  const truncationNotice = table.rows.length > 100
    ? `<tr><td colspan="${table.columns.length}" class="yoink-truncation-notice">
         Showing 100 of ${table.rows.length} rows
       </td></tr>`
    : '';

  container.innerHTML = `
    <table class="yoink-table">
      <thead>
        <tr>${headerCells}</tr>
      </thead>
      <tbody>
        ${dataRows}
        ${truncationNotice}
      </tbody>
    </table>
  `;

  // Wire up editable headers
  wireUpColumnHeaders();

  // Update status
  updateStatus(`Found ${table.rows.length} rows × ${table.columns.length} columns`);
}

/**
 * Wires up event listeners for editable column headers.
 */
function wireUpColumnHeaders() {
  if (!shadowRoot) return;

  const headers = shadowRoot.querySelectorAll('.yoink-col-header');

  headers.forEach((input) => {
    const inputEl = input as HTMLInputElement;

    // Handle blur (when clicking away)
    inputEl.addEventListener('blur', () => {
      handleColumnRename(inputEl);
    });

    // Handle Enter key
    inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        inputEl.blur(); // Triggers blur handler
      }
      if (e.key === 'Escape') {
        // Revert to original value
        const colId = inputEl.dataset.columnId;
        const col = currentTable?.columns.find(c => c.id === colId);
        if (col) {
          inputEl.value = col.name;
        }
        inputEl.blur();
      }
    });

    // Select all text on focus for easy replacement
    inputEl.addEventListener('focus', () => {
      inputEl.select();
    });
  });
}

/**
 * Handles renaming a column when the input loses focus.
 */
function handleColumnRename(input: HTMLInputElement) {
  if (!currentTable) return;

  const columnId = input.dataset.columnId;
  const newName = input.value.trim();

  if (!columnId || !newName) {
    // Revert to original if empty
    const col = currentTable.columns.find(c => c.id === columnId);
    if (col) {
      input.value = col.name;
    }
    return;
  }

  // Check if name actually changed
  const col = currentTable.columns.find(c => c.id === columnId);
  if (col && col.name === newName) {
    return; // No change
  }

  // Update table (immutable)
  currentTable = renameColumn(currentTable, columnId, newName);

  // Update status to confirm
  updateStatus(`Renamed column to "${newName}"`);
}

/**
 * Escapes HTML to prevent XSS when rendering data.
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

#### 5.4 Import renameColumn

Make sure to import `renameColumn` from the core module:

```typescript
import { buildTable, renameColumn } from '../../core/table-builder';
```

#### 5.5 Add Column Header Styles

Add to content/modal.css:

```css
/* Editable column headers */
.yoink-col-header {
  border: 1px solid transparent;
  background: transparent;
  font-weight: 600;
  font-size: 12px;
  width: 100%;
  padding: 4px 6px;
  border-radius: 3px;
  cursor: text;
  transition: border-color 0.2s, background-color 0.2s;
}

.yoink-col-header:hover {
  border-color: #ddd;
  background: #f5f5f5;
}

.yoink-col-header:focus {
  outline: none;
  border-color: #6366f1;
  background: white;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

/* Truncation notice */
.yoink-truncation-notice {
  text-align: center;
  color: #888;
  font-style: italic;
  padding: 12px !important;
  background: #f9f9f9;
}

/* Improve table cell styling for data */
.yoink-table td {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yoink-table td:hover {
  white-space: normal;
  word-break: break-word;
}
```

#### 5.6 Column Editing UX Details

| Action | Result |
|--------|--------|
| Click header | Text input activates, all text selected |
| Type new name | Input updates |
| Press Enter | Saves change, deselects input |
| Press Escape | Reverts to original name |
| Click away (blur) | Saves change |
| Empty input on blur | Reverts to original name |

#### 5.7 Integration with Exports

The exports already use `table.columns[i].name`, so renamed columns automatically appear in:
- CSV headers
- XLSX column headers
- JSON object keys
- Clipboard data (first row)

No additional changes needed for export integration.

#### 5.8 Verification Checklist

```bash
# 1. Build succeeds
npm run build

# 2. No chrome.* in core/
npm run check-core

# 3. Test header click behavior
# - Extract data from a page
# - Click on a column header
# - Text should be selected (ready to type)
# - Input should have focus outline

# 4. Test renaming
# - Click header, type new name, press Enter
# - Status shows "Renamed column to 'NewName'"
# - Header displays new name

# 5. Test Enter key
# - Click header, type name, press Enter
# - Input loses focus
# - Name is saved

# 6. Test Escape key
# - Click header, type something
# - Press Escape
# - Original name is restored

# 7. Test blur (click away)
# - Click header, type name
# - Click elsewhere in modal
# - Name is saved

# 8. Test empty name prevention
# - Click header, delete all text
# - Click away or press Enter
# - Original name is restored (not empty)

# 9. Test export with custom names
# - Rename columns to "Product", "Price", "URL"
# - Export to CSV
# - Open CSV → headers are "Product", "Price", "URL"
# - Export to JSON → keys are "Product", "Price", "URL"

# 10. Test with special characters
# - Rename column to include comma or quote
# - Export to CSV → properly escaped
# - Export to JSON → properly escaped

# 11. Test table re-render
# - Rename a column
# - Click "Try Another Table"
# - New table renders with default names (rename state is per-extraction)
```

#### 5.9 Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| Empty column name | Reverts to previous name |
| Whitespace-only name | Reverts to previous name |
| Very long name | Allowed, truncated in display |
| Special characters | Allowed, escaped in exports |
| Same name as another column | Allowed (user's choice) |
| Rename then export | Uses new names |
| Rename then re-extract | Names reset to auto-detected |

---

### Phase 6: Pagination & Crawling

**Goal:** Multi-page scraping works.

- [ ] Implement `core/pagination.ts`
- [ ] "Locate Next Button" enters selection mode for pagination
- [ ] "Start Crawling" begins automated crawl
- [ ] Respects min/max delay
- [ ] "Stop Crawling" halts process
- [ ] Infinite scroll option works
- [ ] Progress shows in modal

### Phase 7: AI Cleanup

**Goal:** AI improves data quality.

- [ ] Port LLM handler from old code
- [ ] "Clean with AI" sends sample data to API
- [ ] Apply suggested column renames
- [ ] Apply data transformations
- [ ] Show rate limit remaining

---

## Testing Checklist

Run after each phase:

```bash
# 1. No Chrome APIs in core
grep -r "chrome\." dev_build/core/
# Expected: no results

# 2. Extension loads without errors
# Check chrome://extensions for errors

# 3. Content script runs
# Check page console for "[Yoink] Content script loaded"

# 4. Build succeeds
cd dev_build && npm run build
# Expected: no errors, dist/ populated
```

---

## Reference: Useful Patterns from Old Code

When implementing, you may reference `src/` for these patterns:

| Feature | Old Location | Notes |
|---------|--------------|-------|
| Element similarity matching | `src/lib/pattern-matcher.ts` | Good algorithm |
| Data extraction | `src/lib/extractor.ts` | Comprehensive |
| Column type inference | `src/lib/table-builder.ts` | Smart detection |
| LLM prompt | `src/background/llm-handler.ts` | Working prompt |
| CSV generation | `src/lib/csv-exporter.ts` | Handles edge cases |

**Do NOT copy:**
- Build configuration (was broken)
- Message routing structure (over-complicated)
- State management (tangled)

---

## Prompt for Claude Code

Once this SPEC.md is in the repo, use this prompt:

```
Read SPEC.md carefully. Implement Phase 1 of dev_build/.

Rules:
1. Follow the exact directory structure in SPEC.md
2. Zero chrome.* in core/ directory
3. Do NOT reference or copy structure from src/ — only look at it for algorithm logic if needed
4. After each file, verify it matches the spec
5. Do not say "done" until verification checklist passes

Start by creating the directory structure and manifest.json. Show me the manifest before proceeding.
```

---

## Changelog

- v1.1 — Changed from popup to in-page modal (Shadow DOM), updated UI layout to match wireframe exactly
- v1.0 — Initial spec based on wireframe
