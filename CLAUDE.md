# CLAUDE.md - Agent Instructions for Yoink.ai

This file defines how AI agents should work on this project.

## Project Overview

Yoink.ai is a Chrome extension that extracts structured data from webpages into spreadsheets. Users click an element, the extension finds similar elements, and exports the data to CSV.

**Key files:**
- `project_spec.md` - Full project specification
- `task_list.md` - Task breakdown with Build/Review/Approve workflow

---

## Agent Roles

### Builder Agent

You are responsible for implementing tasks. Follow this workflow:

#### 1. Review the Task
```
Before writing any code:
1. Read the task in task_list.md
2. Read project_spec.md for architecture context
3. Understand the acceptance criteria
4. Identify dependencies on previous tasks
```

#### 2. Understand the Codebase
```
Before implementing:
1. Read existing code in the areas you'll modify
2. Understand the patterns already established
3. Check how similar functionality was implemented
4. Note the message passing patterns if touching background/content/popup
```

#### 3. Implement the Task
```
Implementation rules:
1. Follow existing code patterns and style
2. Keep changes minimal and focused
3. Add TypeScript types for all new code
4. No over-engineering - solve the task, nothing more
5. Handle errors gracefully
6. Test your code manually before declaring done
```

#### 4. Explain Your Implementation
```
After implementing, provide:

## Implementation Summary

### What I Built
- List the files created/modified
- Describe the key components

### How It Works
- Explain the flow (e.g., "User clicks → event captured → message sent → ...")
- Describe key functions and their purpose
- Note any design decisions made

### Testing Done
- What manual tests you performed
- Edge cases you considered

### Known Limitations
- What doesn't work yet
- What's out of scope for this task
```

#### 5. Update task_list.md
Mark Build as complete:
```markdown
| Build | [B] | Implementation summary link or notes |
```

---

### Reviewer Agent

You are responsible for testing implementations and suggesting improvements. Your goal is to **break things**.

#### 1. Understand the Implementation
```
1. Read the Builder's implementation summary
2. Read all code changes
3. Understand what the code is supposed to do
4. Review against acceptance criteria
```

#### 2. Test the Implementation
```
Testing approach:
1. Verify the happy path works
2. Try to break it with edge cases:
   - Empty inputs
   - Malformed data
   - Missing elements
   - Rapid repeated actions
   - Large datasets
   - Unusual DOM structures
3. Check error handling
4. Verify no regressions to previous tasks
```

#### 3. Attempt to Break It
```
Adversarial testing:
- What happens with 1000 elements?
- What if the page structure is weird?
- What if the user clicks rapidly?
- What if elements disappear during extraction?
- What if there's no matching pattern?
- What about iframes, shadow DOM?
- Memory leaks? Performance issues?
```

#### 4. Provide Review Feedback
```
## Review Report

### Test Results
- [ ] Acceptance criteria met
- [ ] Happy path works
- [ ] Error handling adequate

### Issues Found
List any bugs or problems:
1. Issue description + reproduction steps
2. Severity (blocker/major/minor)

### Suggested Improvements
For each suggestion:
1. What to change
2. Why it matters (or why it can be left as-is)
3. Code example if applicable

### Verdict
- **PASS**: Ready for human review
- **NEEDS WORK**: List required fixes before re-review
```

#### 5. Update task_list.md
If passing:
```markdown
| Review | [R] | Review passed - summary of findings |
```

If needs work:
```markdown
| Review | [ ] | Blocked: [issue description] |
```

---

## Code Standards

### File Structure
```
src/
├── background/        # Service worker only
├── content/           # Content scripts only
├── popup/             # Popup UI only
├── lib/               # Shared utilities
└── types/             # TypeScript types
```

### Naming Conventions
- Files: `kebab-case.ts`
- Functions: `camelCase`
- Types/Interfaces: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`

### TypeScript
- Explicit types for function parameters and returns
- Use interfaces for object shapes
- No `any` unless absolutely necessary (document why)

### Message Passing
```typescript
// All messages must use this pattern
interface Message {
  type: string;       // ACTION_NAME format
  payload?: unknown;  // Data if needed
}

// Example
{ type: 'START_SELECTION', payload: { mode: 'manual' } }
{ type: 'ELEMENT_SELECTED', payload: { selector: '...', html: '...' } }
```

### Error Handling
```typescript
// Always handle errors explicitly
try {
  await riskyOperation();
} catch (error) {
  console.error('[Yoink] Operation failed:', error);
  // Graceful fallback or user notification
}
```

---

## Testing Guidelines

### Manual Testing Checklist
For each task, verify:
- [ ] Feature works on a simple test page
- [ ] Feature works on a complex real-world page (Amazon, LinkedIn, etc.)
- [ ] No console errors
- [ ] Extension popup still works
- [ ] Previous features still work (regression check)

### Test Pages
Use these for consistent testing:
- Simple: Create local HTML with known structure
- Medium: Wikipedia tables, GitHub issues
- Complex: Amazon products, LinkedIn jobs, news sites

### Performance Checks
- Extraction of 100+ items should complete in < 2 seconds
- No memory leaks (check DevTools Memory tab)
- No excessive DOM queries

---

## Common Patterns

### Sending Messages (Content → Background)
```typescript
chrome.runtime.sendMessage({ type: 'ACTION', payload: data });
```

### Sending Messages (Background → Content)
```typescript
chrome.tabs.sendMessage(tabId, { type: 'ACTION', payload: data });
```

### Sending Messages (Popup → Background)
```typescript
chrome.runtime.sendMessage({ type: 'ACTION', payload: data }, (response) => {
  // Handle response
});
```

### Getting Current Tab
```typescript
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
```

### Storage
```typescript
// Save
await chrome.storage.local.set({ key: value });

// Load
const { key } = await chrome.storage.local.get('key');
```

---

## Debugging

### Content Script
```javascript
// In browser console on the page
console.log('[Yoink]', 'message');
```

### Background Script
```
1. Go to chrome://extensions
2. Find Yoink
3. Click "Service Worker" link
4. Opens DevTools for background
```

### Popup
```
1. Right-click the popup
2. Click "Inspect"
3. Opens DevTools for popup
```

---

## Human Review Checklist

Before marking a task as fully approved, the human reviewer verifies:

- [ ] Implementation matches acceptance criteria
- [ ] Code is clean and follows project patterns
- [ ] No obvious bugs or edge case failures
- [ ] Feature works on real-world sites
- [ ] Previous features still work
- [ ] Ready to build on for next task
