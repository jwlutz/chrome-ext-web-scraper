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
│   │   ├── manifest.json      # MV3 manifest
│   │   ├── background/
│   │   │   └── index.ts       # Service worker, message routing
│   │   ├── content/
│   │   │   └── index.ts       # Thin wrapper, imports core
│   │   └── popup/
│   │       ├── popup.html     # UI structure
│   │       ├── popup.css      # Styling
│   │       └── popup.ts       # UI logic
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

2. **`dev_build/extension/content/index.ts` must be thin.** It only:
   - Imports from `core/`
   - Listens for messages
   - Calls core functions
   - Sends responses

3. **Old `src/` directory is READ-ONLY reference.** Copy logic patterns, not architecture.

---

## UI Layout (Based on Wireframe)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   LEFT COLUMN                    RIGHT COLUMN               │
│   ┌──────────┬──────────┐       ┌────────────────────┐     │
│   │Try Another│  Manual  │       │        CSV         │     │
│   │  Table   │  Select  │       ├────────────────────┤     │
│   ├──────────┼──────────┤       │       XLSX         │     │
│   │ Locate   │  Start   │       ├────────────────────┤     │
│   │Next Btn  │ Crawling │       │       JSON         │     │
│   └──────────┴──────────┘       ├────────────────────┤     │
│                                  │     COPY ALL       │     │
│   ☐ Infinite Scroll              └────────────────────┘     │
│                                                             │
│   ┌────────────────────────────┐                           │
│   │ Min Delay  [ 1   ] sec     │                           │
│   │ Max Delay  [ 20  ] sec     │                           │
│   └────────────────────────────┘                           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────┬───────────────────────────────┐  │
│   │   ✨ CLEAN WITH AI  │   📄 Download Full Page HTML  │  │
│   └─────────────────────┴───────────────────────────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────┬─────────────────┬─────────────────┐  │
│   │ editable col 1  │ editable col 2  │ editable col 3  │  │  ← Click to rename
│   ├─────────────────┼─────────────────┼─────────────────┤  │
│   │ row 1 data      │ row 1 data      │ row 1 data      │  │
│   ├─────────────────┼─────────────────┼─────────────────┤  │
│   │ row 2 data      │ row 2 data      │ row 2 data      │  │
│   ├─────────────────┼─────────────────┼─────────────────┤  │
│   │ row 3 data      │ row 3 data      │ row 3 data      │  │
│   ├─────────────────┼─────────────────┼─────────────────┤  │
│   │ ...scrollable...│                 │                 │  │
│   └─────────────────┴─────────────────┴─────────────────┘  │
│                                                             │
│   Found 24 rows × 3 columns                                │
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

### Content Script ↔ Background

```typescript
// Content → Background
{ type: 'CONTENT_READY', payload: { url: string } }
{ type: 'ELEMENT_SELECTED', payload: { selector: string, count: number } }

// Background → Content
{ type: 'PING' }
{ type: 'DETECT_PATTERNS' }
{ type: 'SELECT_PATTERN', payload: { selector: string } }
{ type: 'START_MANUAL_SELECT' }
{ type: 'STOP_MANUAL_SELECT' }
{ type: 'EXTRACT_DATA' }
{ type: 'FIND_NEXT_BUTTON' }
{ type: 'CLICK_NEXT_BUTTON' }
{ type: 'HIGHLIGHT_ELEMENTS', payload: { selector: string } }
```

### Popup ↔ Background

```typescript
// Popup → Background
{ type: 'GET_STATE' }
{ type: 'TRY_ANOTHER_TABLE' }
{ type: 'START_MANUAL_SELECT' }
{ type: 'STOP_MANUAL_SELECT' }
{ type: 'LOCATE_NEXT_BUTTON' }
{ type: 'START_CRAWL', payload: { minDelay: number, maxDelay: number, infiniteScroll: boolean } }
{ type: 'STOP_CRAWL' }
{ type: 'RENAME_COLUMN', payload: { columnId: string, newName: string } }
{ type: 'EXPORT', payload: { format: 'csv' | 'xlsx' | 'json' | 'clipboard' | 'html' } }
{ type: 'AI_CLEAN' }

// Background → Popup (via state updates)
{ type: 'STATE_UPDATE', payload: AppState }
```

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

**Goal:** Extension loads, content script runs, popup shows connection status.

- [ ] Create `dev_build/` directory structure
- [ ] Write `manifest.json` (MV3)
- [ ] Minimal `content/index.ts`:
  ```typescript
  console.log('[Yoink] Content script loaded:', location.href);
  chrome.runtime.sendMessage({ type: 'CONTENT_READY', payload: { url: location.href } });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') sendResponse({ success: true });
    return true;
  });
  ```
- [ ] Minimal `background/index.ts`:
  - Track content script ready state per tab
  - Respond to GET_STATE from popup
- [ ] Minimal `popup/`:
  - Shows "Connected" or "Content script not loaded"
  - Basic layout shell (no functionality yet)
- [ ] `vite.config.ts` that builds extension to `dist/`
- [ ] Load in Chrome, verify no errors

**Verification:**
```bash
# Must see log in page console:
[Yoink] Content script loaded: https://...

# Popup must show "Connected" status
```

### Phase 2: Core Detection & Extraction

**Goal:** "Try Another Table" works, data appears in popup.

- [ ] Implement `core/detector.ts`
- [ ] Implement `core/extractor.ts`
- [ ] Implement `core/table-builder.ts`
- [ ] Wire up content script to use core functions
- [ ] Popup: "Try Another Table" sends message, receives patterns
- [ ] Popup: Table renders with data
- [ ] Test on amazon.com product listing

**Verification:**
- Click extension on Amazon
- Click "Try Another Table" a few times
- See different patterns detected
- Table shows real data

### Phase 3: Manual Selection

**Goal:** User can click to select elements.

- [ ] Implement `core/selector.ts`
- [ ] "Manual Select" button enters selection mode
- [ ] Hovering highlights elements
- [ ] Clicking selects and finds similar
- [ ] Selection updates table

### Phase 4: Export

**Goal:** All 4 export buttons work.

- [ ] Implement `core/exporter.ts`
- [ ] CSV export (no dependencies)
- [ ] JSON export (no dependencies)
- [ ] XLSX export (add SheetJS dependency)
- [ ] Copy All (clipboard API)
- [ ] Download Full Page HTML

### Phase 5: Editable Columns

**Goal:** Click column header to rename.

- [ ] Column headers show input on click
- [ ] Enter/blur saves new name
- [ ] Changes persist in state
- [ ] Export uses custom names

### Phase 6: Pagination & Crawling

**Goal:** Multi-page scraping works.

- [ ] Implement `core/pagination.ts`
- [ ] "Locate Next Button" enters selection mode for pagination
- [ ] "Start Crawling" begins automated crawl
- [ ] Respects min/max delay
- [ ] "Stop Crawling" halts process
- [ ] Infinite scroll option works
- [ ] Progress shows in popup

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

- v1.0 — Initial spec based on wireframe
