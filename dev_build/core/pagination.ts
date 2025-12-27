/**
 * Pagination Detection - Find next buttons and detect pagination types
 *
 * ZERO chrome.* references allowed in this file.
 * This is a pure JS library that works on any DOM.
 *
 * The pagination module:
 * 1. Finds "next" buttons using common patterns
 * 2. Detects if a button is disabled
 * 3. Detects pagination type (button, infinite scroll, none)
 */

import type { PaginationInfo } from './types';

// ============================================================================
// NEXT BUTTON DETECTION
// ============================================================================

/**
 * Common patterns for "next" buttons across websites
 */
const NEXT_BUTTON_PATTERNS = [
  // Text content patterns (case-insensitive)
  { type: 'text', patterns: ['next', 'next page', '>', '>>', '›', '»', 'load more', 'show more', 'see more'] },

  // aria-label patterns
  { type: 'aria', patterns: ['next', 'next page', 'go to next page', 'load more'] },

  // Class/ID patterns
  { type: 'class', patterns: ['next', 'pagination-next', 'pager-next', 'load-more', 'loadmore'] },

  // Common selectors used by popular frameworks
  { type: 'selector', patterns: [
    'a[rel="next"]',
    '[data-testid*="next"]',
    '[data-automation*="next"]',
    '.pagination li:last-child a',
    '.pagination .next a',
    '.pager .next a',
    '[aria-label*="next" i]',
    'button[class*="load-more" i]',
    'button[class*="loadmore" i]',
  ]},
];

/**
 * Find the "next" button on a page.
 *
 * Strategy:
 * 1. Try common selector patterns first (most reliable)
 * 2. Search for buttons/links with "next" in text, aria-label, or class
 * 3. Look for arrow symbols (>, >>)
 *
 * @param root - Root element to search within (usually document.body)
 * @returns The next button element, or null if not found
 */
export function findNextButton(root: Element | Document): HTMLElement | null {
  const searchRoot = root instanceof Document ? root.body : root;
  if (!searchRoot) return null;

  // 1. Try direct selector patterns first
  for (const selector of NEXT_BUTTON_PATTERNS[3].patterns) {
    try {
      const el = searchRoot.querySelector(selector) as HTMLElement;
      if (el && isElementVisible(el) && !isButtonDisabled(el)) {
        return el;
      }
    } catch {
      // Invalid selector, skip
    }
  }

  // 2. Search clickable elements for text patterns
  const clickables = searchRoot.querySelectorAll('a, button, [role="button"], [onclick]');

  for (const el of clickables) {
    const htmlEl = el as HTMLElement;
    if (!isElementVisible(htmlEl) || isButtonDisabled(htmlEl)) continue;

    // Check text content
    const text = htmlEl.textContent?.trim().toLowerCase() || '';
    const textPatterns = NEXT_BUTTON_PATTERNS[0].patterns;

    for (const pattern of textPatterns) {
      // Exact match or starts with the pattern
      if (text === pattern || text === pattern + ' page') {
        return htmlEl;
      }
    }

    // Check aria-label
    const ariaLabel = htmlEl.getAttribute('aria-label')?.toLowerCase() || '';
    const ariaPatterns = NEXT_BUTTON_PATTERNS[1].patterns;

    for (const pattern of ariaPatterns) {
      if (ariaLabel.includes(pattern)) {
        return htmlEl;
      }
    }

    // Check class and id
    const className = htmlEl.className?.toLowerCase() || '';
    const id = htmlEl.id?.toLowerCase() || '';
    const classPatterns = NEXT_BUTTON_PATTERNS[2].patterns;

    for (const pattern of classPatterns) {
      if (className.includes(pattern) || id.includes(pattern)) {
        return htmlEl;
      }
    }
  }

  // 3. Last resort: look for arrow-only buttons (could be false positives)
  for (const el of clickables) {
    const htmlEl = el as HTMLElement;
    if (!isElementVisible(htmlEl) || isButtonDisabled(htmlEl)) continue;

    const text = htmlEl.textContent?.trim() || '';
    // Only if text is just an arrow (not part of other content)
    if (text === '>' || text === '>>' || text === '›' || text === '»') {
      return htmlEl;
    }
  }

  return null;
}

/**
 * Check if a button element is disabled.
 *
 * Checks:
 * - HTML disabled attribute
 * - aria-disabled attribute
 * - Common disabled class patterns
 * - Pointer-events CSS (if accessible)
 *
 * @param element - Element to check
 * @returns true if disabled
 */
export function isButtonDisabled(element: HTMLElement): boolean {
  // Check disabled attribute (for buttons)
  if (element.hasAttribute('disabled')) return true;

  // Check aria-disabled
  if (element.getAttribute('aria-disabled') === 'true') return true;

  // Check common disabled classes
  const className = element.className?.toLowerCase() || '';
  const disabledPatterns = ['disabled', 'is-disabled', 'btn-disabled', 'inactive'];

  for (const pattern of disabledPatterns) {
    if (className.includes(pattern)) return true;
  }

  // Check for cursor: not-allowed (common indicator)
  try {
    const style = window.getComputedStyle(element);
    if (style.cursor === 'not-allowed' || style.pointerEvents === 'none') {
      return true;
    }
  } catch {
    // Can't access computed style, skip this check
  }

  return false;
}

/**
 * Check if an element is visible in the DOM.
 *
 * @param element - Element to check
 * @returns true if visible
 */
function isElementVisible(element: HTMLElement): boolean {
  if (!element) return false;

  // Check if element has size
  if (element.offsetWidth === 0 && element.offsetHeight === 0) return false;

  // Check display and visibility
  try {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  } catch {
    // Can't access computed style
  }

  return true;
}

// ============================================================================
// INFINITE SCROLL DETECTION
// ============================================================================

/**
 * Detect if the page uses infinite scroll.
 *
 * Detection strategies:
 * 1. Look for common infinite scroll libraries/classes
 * 2. Check for loading indicators at bottom of page
 * 3. Look for "load more" type buttons (not pagination)
 *
 * @param root - Root element to search
 * @returns true if infinite scroll is likely
 */
export function detectInfiniteScroll(root: Element | Document): boolean {
  const searchRoot = root instanceof Document ? root.body : root;
  if (!searchRoot) return false;

  // Check for infinite scroll library indicators
  const infiniteScrollIndicators = [
    '[data-infinite-scroll]',
    '[infinite-scroll]',
    '.infinite-scroll',
    '.infinite-loading',
    '[data-load-more]',
    '.waypoint',
    '.intersection-observer',
  ];

  for (const selector of infiniteScrollIndicators) {
    try {
      if (searchRoot.querySelector(selector)) return true;
    } catch {
      // Invalid selector
    }
  }

  // Check for loading spinners at bottom of content
  const loadingIndicators = searchRoot.querySelectorAll('.loading, .spinner, .loader, [class*="loading"]');
  for (const el of loadingIndicators) {
    const htmlEl = el as HTMLElement;
    const rect = htmlEl.getBoundingClientRect();
    // If loading indicator is near bottom of viewport, likely infinite scroll
    if (rect.top > window.innerHeight * 0.7) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// PAGINATION DETECTION
// ============================================================================

/**
 * Detect the pagination method used on a page.
 *
 * @param root - Root element to search
 * @returns PaginationInfo object describing the pagination type
 */
export function detectPagination(root: Element | Document): PaginationInfo {
  // First check for infinite scroll
  if (detectInfiniteScroll(root)) {
    return {
      type: 'infinite',
    };
  }

  // Then check for next button
  const nextButton = findNextButton(root);
  if (nextButton) {
    // Generate a selector for the button
    const selector = generateButtonSelector(nextButton);
    const buttonText = nextButton.textContent?.trim() || '';

    return {
      type: 'button',
      selector,
      buttonText,
    };
  }

  // No pagination detected
  return {
    type: 'none',
  };
}

/**
 * Generate a selector for a button element.
 * Tries to create a stable selector that will work across page loads.
 *
 * @param element - Button element
 * @returns CSS selector string
 */
function generateButtonSelector(element: HTMLElement): string {
  // Try ID first (most reliable)
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  // Try data-testid or similar
  const testId = element.getAttribute('data-testid');
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }

  // Try aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return `[aria-label="${CSS.escape(ariaLabel)}"]`;
  }

  // Try rel="next"
  if (element.getAttribute('rel') === 'next') {
    return 'a[rel="next"]';
  }

  // Fall back to tag + class combination
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList)
    .filter(c => c && !c.includes(':')) // Filter out pseudo-class-like classes
    .slice(0, 3) // Limit to first 3 classes
    .map(c => `.${CSS.escape(c)}`)
    .join('');

  if (classes) {
    return `${tag}${classes}`;
  }

  // Last resort: tag with text content match
  const text = element.textContent?.trim();
  if (text && text.length < 20) {
    return `${tag}:contains("${text}")`;
  }

  return tag;
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Wait for new content to appear after clicking next/scrolling.
 *
 * NOTE: This function signature is for documentation.
 * The actual implementation with MutationObserver and timers
 * should be in the content script, not here (no timers in core).
 *
 * This file provides the detection functions only.
 */

/**
 * Perform a scroll action for infinite scroll pages.
 *
 * NOTE: This is a pure helper that returns scroll parameters.
 * The actual scrolling should be done in the content script.
 *
 * @returns Scroll distance to use (one viewport height)
 */
export function getScrollDistance(): number {
  return typeof window !== 'undefined' ? window.innerHeight : 800;
}
