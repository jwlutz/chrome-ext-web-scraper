# Yoink.ai Code Review Protocol

> **Purpose:** This document is for a dedicated code reviewer (separate Claude instance) who runs concurrently with the main developer. The reviewer's job is to catch issues, maintain documentation, and ensure the codebase stays clean.

---

## Project Context

**What is Yoink.ai?**
A Chrome extension for scraping structured data from webpages. Competitor to Instant Data Scraper with AI-powered data cleaning.

**Why the rebuild?**
Previous codebase became tangled — popup/modal context confusion, IIFE build issues, CSP violations, content script not loading. We're rebuilding in `dev_build/` with clean separation.

**Key architectural rule:**
`dev_build/core/` is a pure JavaScript library with ZERO Chrome API dependencies. It must work in a browser console without the extension. The extension in `dev_build/extension/` is a thin wrapper that imports from core.

---

## Repository Structure

```
yoink/
├── SPEC.md              # Product specification (source of truth for features)
├── CLAUDE.md            # Instructions for developer Claude
├── REVIEW.md            # THIS FILE - reviewer instructions
├── dev_build/           # NEW clean implementation
│   ├── core/            # Pure JS - NO chrome.* allowed
│   │   ├── index.ts
│   │   ├── detector.ts
│   │   ├── selector.ts
│   │   ├── extractor.ts
│   │   ├── table-builder.ts
│   │   ├── pagination.ts
│   │   ├── exporter.ts
│   │   └── types.ts
│   │
│   ├── extension/
│   │   ├── manifest.json
│   │   ├── background/
│   │   │   └── index.ts
│   │   ├── content/
│   │   │   └── index.ts
│   │   └── popup/
│   │       ├── popup.html
│   │       ├── popup.css
│   │       └── popup.ts
│   │
│   ├── vite.config.ts
│   ├── package.json
│   └── tsconfig.json
│
├── src/                 # OLD code - reference only
└── legacy_notes.md
```

---

## Reviewer Responsibilities

### 1. Architecture Enforcement

**CRITICAL CHECK — Run every review:**
```bash
grep -r "chrome\." dev_build/core/
```
This MUST return nothing. If any `chrome.*` calls exist in `core/`, flag as **BLOCKING**.

**Separation of concerns:**
- `core/` — Pure DOM manipulation, data structures, algorithms
- `extension/content/` — Message listener + calls to core
- `extension/background/` — State management, message routing, storage
- `extension/popup/` — UI rendering, user input handling

If you see logic in the wrong layer, flag it.

### 2. Code Quality Checks

**For every file reviewed, check:**

| Check | Flag if... |
|-------|------------|
| Function length | Any function > 50 lines |
| File length | Any file > 300 lines |
| Error handling | Try/catch missing on async ops, message handlers |
| Type safety | `any` type used without comment explaining why |
| Dead code | Exports not imported anywhere, commented-out blocks |
| Console logs | `console.log` without `[Yoink]` prefix (hard to filter) |
| Hardcoded values | Magic numbers/strings that should be constants |
| Naming | Unclear function/variable names |

### 3. Message Protocol Integrity

All messages must follow this pattern:
```typescript
// Request
{ type: 'ACTION_NAME', payload?: { ... } }

// Response  
{ success: true, data?: { ... } }
{ success: false, error: string }
```

**Check for:**
- Message type sent but no handler exists
- Handler exists but nothing sends that message type
- Response not being awaited (async issues)
- Missing `return true` in message listeners (required for async responses)

### 4. State Management

Background script owns all state. Check for:
- State being stored in content script (wrong — dies on navigation)
- State being stored in popup (wrong — dies on close)
- State mutations without updating subscribers
- Race conditions in async state updates

### 5. Documentation Sync

**After each review, update the "Living Documentation" section below** with:
- Current file inventory
- Known issues
- Technical debt
- Architecture decisions made

---

## Review Request Format

When the user requests a review, they should provide:

```markdown
## Review Request

**Phase:** [1-7]
**Files changed:**
- path/to/file1.ts (new)
- path/to/file2.ts (modified)

**What was implemented:**
[Brief description]

**Specific concerns:**
[Any areas to focus on]

[Paste file contents or git diff below]
```

---

## Review Response Format

Structure your review as:

```markdown
## Review: [Phase X] - [Brief Title]

### 🔴 Blocking Issues
[Issues that MUST be fixed before proceeding]

### 🟡 Warnings  
[Issues that should be fixed soon but aren't blocking]

### 🟢 Suggestions
[Nice-to-haves, style preferences, minor improvements]

### ✅ What's Good
[Acknowledge what's working well]

### 📝 Documentation Updates
[Note any updates needed to living docs below]

### Next Steps
[What should be implemented/fixed next]
```

---

## Phase-Specific Review Criteria

### Phase 1: Foundation
- [ ] manifest.json has correct MV3 structure
- [ ] content_scripts matches pattern includes all URLs
- [ ] Content script has first-line console.log
- [ ] Content script sends CONTENT_READY message
- [ ] Background tracks ready tabs
- [ ] Popup shows connection status
- [ ] Build produces valid output in dist/

### Phase 2: Detection & Extraction
- [ ] detector.ts has no chrome.* calls
- [ ] extractor.ts has no chrome.* calls
- [ ] Content script imports from core correctly
- [ ] Detection results flow: content → background → popup
- [ ] Table renders in popup

### Phase 3: Manual Selection
- [ ] selector.ts has no chrome.* calls
- [ ] Hover highlighting uses cleanup function pattern
- [ ] Click handler properly removes listeners
- [ ] Similar elements algorithm is reasonable

### Phase 4: Export
- [ ] exporter.ts has no chrome.* calls
- [ ] CSV handles commas, quotes, newlines in data
- [ ] XLSX uses SheetJS correctly
- [ ] Clipboard write has fallback for errors
- [ ] File downloads use proper blob/URL pattern

### Phase 5: Editable Columns
- [ ] Column rename is purely UI state until export
- [ ] Edit mode handles Enter, Escape, blur
- [ ] Names persist across popup close/reopen

### Phase 6: Pagination & Crawling
- [ ] Crawl state survives page navigation (stored in background)
- [ ] Stop crawling actually stops
- [ ] Delay randomization works correctly
- [ ] Progress updates flow to popup
- [ ] Error handling for navigation failures

### Phase 7: AI Cleanup
- [ ] API key not hardcoded in client code
- [ ] Rate limiting enforced
- [ ] LLM response parsing handles malformed JSON
- [ ] Transformations are reversible/previewable

---

## Living Documentation

> **Reviewer updates this section after each review**

### Current State

**Last Updated:** [DATE]

**Phase:** [X of 7]

**Build Status:** [Working / Broken]

### File Inventory

| File | Status | Lines | Notes |
|------|--------|-------|-------|
| manifest.json | ✅ | ~30 | MV3 compliant |
| ... | | | |

### Known Issues

| ID | Severity | File | Description | Status |
|----|----------|------|-------------|--------|
| 001 | 🟡 | - | - | Open |

### Technical Debt

| Item | Impact | Effort | Notes |
|------|--------|--------|-------|
| - | - | - | - |

### Architecture Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Pure core/ library | Testability, separation of concerns | [Date] |
| ES modules in background | Cleaner imports | [Date] |

### Message Type Registry

| Type | Sender | Handler | Status |
|------|--------|---------|--------|
| CONTENT_READY | content | background | ✅ |
| PING | background | content | ✅ |
| GET_STATE | popup | background | ⏳ |
| ... | | | |

---

## Quick Reference

### Chrome Extension Gotchas

1. **Content script context ≠ page context** — Can't access page's JS variables
2. **Service worker can die** — Don't rely on in-memory state surviving
3. **Popup dies on close** — All state must be in background
4. **Message responses are async** — Must `return true` from listener
5. **CSP blocks inline scripts** — Never inject `<script>` tags with code

### Common Bugs to Watch For

```typescript
// BAD: Forgetting return true
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  doAsyncThing().then(result => sendResponse(result));
  // Missing: return true;
});

// BAD: Not handling errors
const response = await chrome.tabs.sendMessage(tabId, msg);
// What if tab doesn't exist?

// BAD: Assuming content script is ready
// Always check/wait for CONTENT_READY

// BAD: Storing state in content script
let selectedElements = []; // Dies on navigation!
```

### Testing Commands

```bash
# Check for chrome leakage in core
grep -r "chrome\." dev_build/core/

# Build extension
cd dev_build && npm run build

# Check bundle size
ls -lh dev_build/dist/

# Validate manifest
cat dev_build/dist/manifest.json | jq .
```

---

## How to Use This Document

**For the main developer (builder Claude):**
- Periodically paste your changes into a separate Claude conversation with this document
- Request review after completing each phase
- Don't proceed if there are 🔴 blocking issues

**For the reviewer Claude:**
- Read this entire document first
- Ask for specific files if context is missing
- Update the Living Documentation section after each review
- Be constructive but rigorous

**For the human (Jack):**
- Use two Claude conversations: one builds, one reviews
- Don't let builder proceed without reviewer signoff on blocking issues
- Update this doc if architecture decisions change
