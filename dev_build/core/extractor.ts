/**
 * Data Extractor - Pull structured data from DOM elements
 *
 * ZERO chrome.* references allowed in this file.
 * This is a pure JS library that works on any DOM.
 *
 * IMPORTANT: Uses whitespace injection between tags to preserve null/empty columns.
 * When extracting child elements, we inject " \t " (space-tab-space) between each
 * child's content. This ensures that if a child is empty, we still get a delimiter
 * that indicates there's a column position there.
 */

import type { ExtractedRow } from './types';

// ============================================================================
// WHITESPACE INJECTION
// ============================================================================

/**
 * The delimiter used to separate child element content.
 * This allows us to detect null/empty columns.
 */
const CHILD_DELIMITER = ' \t ';

/**
 * Extract text from an element with whitespace injection between children.
 *
 * This is the KEY function that fixes the null column problem:
 * - For each direct child, we extract its text
 * - We join children with CHILD_DELIMITER
 * - Empty children become empty strings between delimiters
 * - Later, table-builder can split on the delimiter to get columns
 *
 * @param element - DOM element
 * @returns Text with delimiter-separated child content
 */
function extractTextWithDelimiters(element: Element): string {
  const children = element.children;

  // If no children, just get the text content
  if (children.length === 0) {
    return normalizeWhitespace(element.textContent || '');
  }

  // Extract text from each direct child with delimiter separation
  const childTexts: string[] = [];

  for (const child of children) {
    // Get this child's text (recursively, but normalized)
    const text = normalizeWhitespace((child as HTMLElement).innerText || child.textContent || '');
    childTexts.push(text); // Even empty string is pushed to preserve position
  }

  return childTexts.join(CHILD_DELIMITER);
}

/**
 * Normalize whitespace: collapse multiple spaces/newlines into single space.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Get clean text content using innerText (respects CSS visibility).
 */
function extractText(element: Element): string {
  const htmlElement = element as HTMLElement;
  const text = htmlElement.innerText || element.textContent || '';
  return normalizeWhitespace(text);
}

// ============================================================================
// LINK EXTRACTION
// ============================================================================

/**
 * Extract all links from within an element.
 */
function extractLinks(element: Element): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const anchors = element.querySelectorAll('a[href]');

  for (const anchor of anchors) {
    const a = anchor as HTMLAnchorElement;

    // Skip empty, javascript:, or same-page anchors
    if (!a.href || a.href.startsWith('javascript:')) continue;
    if (a.href === window.location.href || a.href === window.location.href + '#') continue;

    const link = {
      text: normalizeWhitespace(a.innerText || a.textContent || ''),
      href: a.href,
    };

    // Avoid duplicates
    if (!links.some(l => l.href === link.href)) {
      links.push(link);
    }
  }

  // Check if element itself is a link
  if (element.tagName.toLowerCase() === 'a') {
    const a = element as HTMLAnchorElement;
    if (a.href && !a.href.startsWith('javascript:')) {
      const selfLink = {
        text: normalizeWhitespace(a.innerText || a.textContent || ''),
        href: a.href,
      };
      if (!links.some(l => l.href === selfLink.href)) {
        links.unshift(selfLink);
      }
    }
  }

  return links;
}

// ============================================================================
// IMAGE EXTRACTION
// ============================================================================

/**
 * Extract all images from within an element.
 */
function extractImages(element: Element): Array<{ src: string; alt: string }> {
  const images: Array<{ src: string; alt: string }> = [];
  const imgElements = element.querySelectorAll('img');

  for (const img of imgElements) {
    // Try multiple src attributes (for lazy loading)
    const src = img.src ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-original') ||
      '';

    if (!src) continue;

    // Skip tiny data URIs (placeholders)
    if (src.startsWith('data:') && src.length < 200) continue;

    const image = {
      src,
      alt: img.alt || '',
    };

    // Avoid duplicates
    if (!images.some(i => i.src === image.src)) {
      images.push(image);
    }
  }

  // Check if element itself is an image
  if (element.tagName.toLowerCase() === 'img') {
    const img = element as HTMLImageElement;
    const src = img.src || img.getAttribute('data-src') || '';

    if (src && !images.some(i => i.src === src)) {
      images.unshift({ src, alt: img.alt || '' });
    }
  }

  return images;
}

// ============================================================================
// DATA ATTRIBUTES
// ============================================================================

/**
 * Extract data-* attributes from an element.
 */
function extractDataAttributes(element: Element): Record<string, string> {
  const data: Record<string, string> = {};
  const htmlElement = element as HTMLElement;

  if (htmlElement.dataset) {
    for (const [key, value] of Object.entries(htmlElement.dataset)) {
      if (value) {
        data[key] = value;
      }
    }
  }

  return data;
}

// ============================================================================
// STRUCTURED TEXT EXTRACTION
// ============================================================================

/**
 * Extract structured text fields (title, price, etc.) from complex elements.
 * Uses semantic selectors to find common data patterns.
 */
function extractStructuredText(element: Element): Record<string, string> {
  const result: Record<string, string> = {};

  // Title patterns
  const titleSelectors = ['h1', 'h2', 'h3', 'h4', '.title', '[class*="title"]', 'a[title]'];
  for (const sel of titleSelectors) {
    try {
      const el = element.querySelector(sel);
      if (el) {
        const text = normalizeWhitespace((el as HTMLElement).innerText || el.textContent || '');
        if (text && text.length > 3 && text.length < 300) {
          result.title = text;
          break;
        }
      }
    } catch { /* skip invalid selector */ }
  }

  // Price patterns
  const priceSelectors = ['.price', '[class*="price"]', '[data-price]', '.cost'];
  for (const sel of priceSelectors) {
    try {
      const el = element.querySelector(sel);
      if (el) {
        const text = normalizeWhitespace((el as HTMLElement).innerText || el.textContent || '');
        if (text && /[\$£€¥]|\d+[.,]\d{2}/.test(text)) {
          result.price = text;
          break;
        }
      }
    } catch { /* skip */ }
  }

  // Rating patterns
  const ratingSelectors = ['.rating', '[class*="rating"]', '[class*="star"]', '[aria-label*="rating"]'];
  for (const sel of ratingSelectors) {
    try {
      const el = element.querySelector(sel);
      if (el) {
        const ariaLabel = el.getAttribute('aria-label');
        const text = ariaLabel || normalizeWhitespace((el as HTMLElement).innerText || '');
        if (text) {
          result.rating = text;
          break;
        }
      }
    } catch { /* skip */ }
  }

  // Description patterns
  const descSelectors = ['.description', '.desc', '.summary', 'p'];
  for (const sel of descSelectors) {
    try {
      const el = element.querySelector(sel);
      if (el) {
        const text = normalizeWhitespace((el as HTMLElement).innerText || el.textContent || '');
        if (text && text.length > 20 && text.length < 500) {
          result.description = text;
          break;
        }
      }
    } catch { /* skip */ }
  }

  // Fallback: extract from text patterns
  const fullText = (element as HTMLElement).innerText || element.textContent || '';

  // View counts
  const viewMatch = fullText.match(/(\d[\d,\.]*[KMB]?\s*views?)/i);
  if (viewMatch && !result.views) {
    result.views = viewMatch[1].trim();
  }

  // Time ago
  const timeMatch = fullText.match(/(\d+\s*(?:second|minute|hour|day|week|month|year)s?\s*ago)/i);
  if (timeMatch && !result.uploaded) {
    result.uploaded = timeMatch[1].trim();
  }

  // Duration
  const durationMatch = fullText.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  if (durationMatch && !result.duration) {
    result.duration = durationMatch[1].trim();
  }

  return result;
}

// ============================================================================
// TABLE ROW EXTRACTION
// ============================================================================

/**
 * Check if an element is a table row.
 */
function isTableRow(element: Element): boolean {
  return element.tagName.toLowerCase() === 'tr';
}

/**
 * Extract data from a table row, treating each cell as a column.
 * This provides much better extraction for native HTML tables.
 */
function extractFromTableRow(row: Element): ExtractedRow {
  const cells = Array.from(row.querySelectorAll('td, th'));

  // Build structured text from each cell
  const structuredText: Record<string, string> = {};
  const cellTexts: string[] = [];

  cells.forEach((cell, index) => {
    const text = normalizeWhitespace((cell as HTMLElement).innerText || cell.textContent || '');
    cellTexts.push(text);
    structuredText[`col_${index}`] = text;
  });

  // Join cell texts for the main text field
  const text = cellTexts.join(' \t ');

  return {
    text,
    links: extractLinks(row),
    images: extractImages(row),
    dataAttributes: extractDataAttributes(row),
    structuredText,
  };
}

// ============================================================================
// MAIN API
// ============================================================================

/**
 * Extract all data from a single element.
 *
 * @param element - The DOM element to extract from
 * @returns Extracted row data
 */
export function extractFromElement(element: Element): ExtractedRow {
  // Special handling for table rows - extract each cell as a column
  if (isTableRow(element)) {
    return extractFromTableRow(element);
  }

  return {
    text: extractText(element),
    links: extractLinks(element),
    images: extractImages(element),
    dataAttributes: extractDataAttributes(element),
    structuredText: extractStructuredText(element),
  };
}

/**
 * Extract data from multiple elements.
 *
 * @param elements - Array of DOM elements
 * @returns Array of extracted rows
 */
export function extractFromElements(elements: Element[]): ExtractedRow[] {
  return elements.map(el => extractFromElement(el));
}

/**
 * Extract child content with delimiters preserved.
 * Used by table-builder to infer columns.
 *
 * Returns an array where each element corresponds to a direct child.
 * Empty children are represented as empty strings.
 *
 * @param element - DOM element
 * @returns Array of child text contents
 */
export function extractChildTexts(element: Element): string[] {
  const children = element.children;

  if (children.length === 0) {
    // No children - return the element's text as a single "column"
    return [normalizeWhitespace(element.textContent || '')];
  }

  const texts: string[] = [];
  for (const child of children) {
    const text = normalizeWhitespace((child as HTMLElement).innerText || child.textContent || '');
    texts.push(text); // Empty string preserves the column position
  }

  return texts;
}

/**
 * Extract table headers from an HTML table.
 * Looks for th elements in thead, or first row if it contains th elements.
 *
 * @param selector - The selector used to find table rows
 * @returns Array of header names, or empty array if no headers found
 */
export function extractTableHeaders(selector: string): string[] {
  // Only works for table row selectors
  if (!selector.includes('tbody tr') && !selector.includes('table tr')) {
    return [];
  }

  // Find the table from the selector
  const tableSelector = selector.replace(/\s*tbody\s*tr.*$/, '').replace(/\s*tr.*$/, '');

  try {
    const table = document.querySelector(tableSelector) as HTMLTableElement;
    if (!table) return [];

    const headers: string[] = [];

    // Try thead first
    const thead = table.querySelector('thead');
    if (thead) {
      const headerRow = thead.querySelector('tr');
      if (headerRow) {
        const ths = headerRow.querySelectorAll('th');
        ths.forEach((th) => {
          const text = normalizeWhitespace((th as HTMLElement).innerText || th.textContent || '');
          headers.push(text || `Column ${headers.length + 1}`);
        });
      }
    }

    // If no thead, check first row for th elements
    if (headers.length === 0) {
      const firstRow = table.querySelector('tr');
      if (firstRow) {
        const ths = firstRow.querySelectorAll('th');
        if (ths.length > 0) {
          ths.forEach((th) => {
            const text = normalizeWhitespace((th as HTMLElement).innerText || th.textContent || '');
            headers.push(text || `Column ${headers.length + 1}`);
          });
        }
      }
    }

    return headers;
  } catch {
    return [];
  }
}

/**
 * Trigger lazy loading by scrolling elements into view.
 *
 * @param elements - Elements to trigger loading for
 */
export async function triggerLazyLoading(elements: Element[]): Promise<void> {
  if (elements.length === 0) return;

  // Adaptive delay based on count (cap at 2 seconds total)
  const delay = Math.max(10, Math.min(50, 2000 / elements.length));

  for (const el of elements) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise(r => setTimeout(r, delay));
  }

  // Scroll back to top
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Brief pause for final images
  await new Promise(r => setTimeout(r, 200));
}
