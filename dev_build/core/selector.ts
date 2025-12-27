/**
 * Manual Selector - Enable user to click-select elements
 *
 * ZERO chrome.* references allowed in this file.
 * This is a pure JS library that works on any DOM.
 */

// ============================================================================
// SELECTOR GENERATION
// ============================================================================

/**
 * Generate a unique CSS selector for an element.
 * Prioritizes stable attributes over position-based selectors.
 */
export function generateSelector(element: Element): string {
  // Try ID first (most stable)
  if (element.id && !isDynamicId(element.id)) {
    return `#${CSS.escape(element.id)}`;
  }

  // Build selector path
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body) {
    const selector = getElementSelector(current);
    path.unshift(selector);

    // If we have a unique selector, stop
    if (selector.startsWith('#') || isUniqueSelector(path.join(' > '))) {
      break;
    }

    current = current.parentElement;
  }

  return path.join(' > ');
}

/**
 * Check if an ID looks dynamically generated.
 */
function isDynamicId(id: string): boolean {
  // Random hex strings, numbers, or very long IDs
  if (/^[a-f0-9]{8,}$/i.test(id)) return true;
  if (/^\d+$/.test(id)) return true;
  if (id.length > 50) return true;
  if (/^:/.test(id)) return true; // React/framework IDs
  return false;
}

/**
 * Get a selector for a single element.
 */
function getElementSelector(element: Element): string {
  const tag = element.tagName.toLowerCase();

  // ID
  if (element.id && !isDynamicId(element.id)) {
    return `#${CSS.escape(element.id)}`;
  }

  // Stable classes
  const classes = getStableClasses(element);
  if (classes.length > 0) {
    // Pick most semantic class
    const bestClass = classes.find(c => isSemanticClass(c)) || classes[0];
    return `${tag}.${CSS.escape(bestClass)}`;
  }

  // Data attributes
  const dataAttr = getBestDataAttribute(element);
  if (dataAttr) {
    return `${tag}[${dataAttr}]`;
  }

  // Fallback: tag with nth-child
  const parent = element.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(element) + 1;
      return `${tag}:nth-of-type(${index})`;
    }
  }

  return tag;
}

/**
 * Get stable (non-dynamic) class names.
 */
function getStableClasses(element: Element): string[] {
  if (!element.className || typeof element.className !== 'string') {
    return [];
  }
  return element.className
    .trim()
    .split(/\s+/)
    .filter(cls => cls && !isDynamicClass(cls))
    .sort((a, b) => {
      // Prefer semantic classes
      const aScore = isSemanticClass(a) ? 0 : 1;
      const bScore = isSemanticClass(b) ? 0 : 1;
      return aScore - bScore;
    });
}

/**
 * Check if a class looks dynamically generated.
 */
function isDynamicClass(cls: string): boolean {
  if (/^[a-z]+-[a-f0-9]{5,}$/i.test(cls)) return true;
  if (/^[a-z]{2,3}[A-Z][a-zA-Z0-9]{10,}$/.test(cls)) return true;
  if (cls.startsWith('_')) return true;
  if (cls.length > 40) return true;
  return false;
}

/**
 * Check if a class name is semantic (meaningful).
 */
function isSemanticClass(cls: string): boolean {
  const semanticTerms = [
    'item', 'card', 'product', 'article', 'post', 'entry', 'result',
    'row', 'listing', 'tile', 'cell', 'container', 'wrapper', 'content',
    'title', 'name', 'price', 'image', 'link', 'button', 'header', 'footer'
  ];
  const lower = cls.toLowerCase();
  return semanticTerms.some(term => lower.includes(term));
}

/**
 * Get best data attribute for selection.
 */
function getBestDataAttribute(element: Element): string | null {
  const htmlEl = element as HTMLElement;
  if (!htmlEl.dataset) return null;

  // Prefer meaningful data attributes
  const preferredKeys = ['id', 'item', 'product', 'listing', 'index', 'key'];
  for (const key of preferredKeys) {
    if (htmlEl.dataset[key]) {
      return `data-${key}`;
    }
  }

  // Any non-empty data attribute
  for (const [key, value] of Object.entries(htmlEl.dataset)) {
    if (value && value.length < 50) {
      return `data-${key}`;
    }
  }

  return null;
}

/**
 * Check if selector uniquely identifies elements.
 */
function isUniqueSelector(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

// ============================================================================
// SIMILAR ELEMENT DETECTION
// ============================================================================

interface ElementFingerprint {
  tag: string;
  classes: string[];
  childTags: string[];
  depth: number;
  hasText: boolean;
  hasLinks: boolean;
  hasImages: boolean;
}

/**
 * Create a fingerprint for element comparison.
 */
function fingerprint(element: Element): ElementFingerprint {
  const tag = element.tagName.toLowerCase();
  const classes = getStableClasses(element);

  const children = Array.from(element.children);
  const childTags = children.slice(0, 5).map(c => c.tagName.toLowerCase());

  const depth = getDepth(element);
  const hasText = (element.textContent?.trim().length || 0) > 10;
  const hasLinks = element.getElementsByTagName('a').length > 0;
  const hasImages = element.getElementsByTagName('img').length > 0;

  return { tag, classes, childTags, depth, hasText, hasLinks, hasImages };
}

/**
 * Get depth of element in DOM tree.
 */
function getDepth(element: Element, maxDepth = 5): number {
  if (maxDepth <= 0 || element.children.length === 0) return 0;

  let max = 0;
  for (const child of element.children) {
    const d = getDepth(child, maxDepth - 1);
    if (d > max) max = d;
  }
  return max + 1;
}

/**
 * Compare two fingerprints for similarity (0-1).
 */
function compareFP(a: ElementFingerprint, b: ElementFingerprint): number {
  if (a.tag !== b.tag) return 0;

  let score = 0.3; // Base for matching tag

  // Class overlap
  if (a.classes.length > 0 || b.classes.length > 0) {
    const intersection = a.classes.filter(c => b.classes.includes(c));
    const union = [...new Set([...a.classes, ...b.classes])];
    score += 0.3 * (union.length > 0 ? intersection.length / union.length : 0);
  } else {
    score += 0.3;
  }

  // Child structure
  if (a.childTags.length > 0 || b.childTags.length > 0) {
    const commonTags = a.childTags.filter((t, i) => b.childTags[i] === t).length;
    const maxTags = Math.max(a.childTags.length, b.childTags.length);
    score += 0.2 * (maxTags > 0 ? commonTags / maxTags : 0);
  } else {
    score += 0.2;
  }

  // Content similarity
  if (a.hasText === b.hasText) score += 0.05;
  if (a.hasLinks === b.hasLinks) score += 0.05;
  if (a.hasImages === b.hasImages) score += 0.05;

  // Depth similarity
  const depthDiff = Math.abs(a.depth - b.depth);
  score += 0.05 * Math.max(0, 1 - depthDiff * 0.3);

  return score;
}

/**
 * Find elements similar to the selected one.
 *
 * Strategy:
 * 1. Start from the element's parent
 * 2. Look for siblings with similar fingerprints
 * 3. If not enough, go up the tree and look in ancestor's children
 */
export function findSimilarElements(root: Element, element: Element): Element[] {
  const targetFP = fingerprint(element);
  const threshold = 0.7;
  const results: Element[] = [element];
  const seen = new Set<Element>([element]);

  // Start with siblings
  let parent = element.parentElement;
  let searchDepth = 0;
  const maxSearchDepth = 5;

  while (parent && parent !== root && searchDepth < maxSearchDepth) {
    for (const child of parent.children) {
      if (seen.has(child)) continue;

      const childFP = fingerprint(child);
      const similarity = compareFP(targetFP, childFP);

      if (similarity >= threshold) {
        results.push(child);
        seen.add(child);
      }
    }

    // If we found enough siblings, stop
    if (results.length >= 3) break;

    parent = parent.parentElement;
    searchDepth++;
  }

  // If still not enough, try document-wide search with stricter criteria
  if (results.length < 3) {
    // Generate a selector based on the element's characteristics
    const tag = element.tagName.toLowerCase();
    const classes = getStableClasses(element);

    if (classes.length > 0) {
      const selector = `${tag}.${CSS.escape(classes[0])}`;
      try {
        const candidates = root.querySelectorAll(selector);
        for (const candidate of candidates) {
          if (seen.has(candidate)) continue;

          const candidateFP = fingerprint(candidate);
          const similarity = compareFP(targetFP, candidateFP);

          if (similarity >= threshold) {
            results.push(candidate);
            seen.add(candidate);
          }
        }
      } catch {
        // Invalid selector, skip
      }
    }
  }

  return results;
}

// ============================================================================
// SELECTION MODE
// ============================================================================

/** Style ID for selection mode overlay */
const SELECTION_STYLE_ID = 'yoink-selection-styles';

/**
 * Inject selection mode styles into the document.
 */
function ensureSelectionStyles(): void {
  if (document.getElementById(SELECTION_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = SELECTION_STYLE_ID;
  style.textContent = `
    .yoink-selectable-hover {
      outline: 2px dashed #6366f1 !important;
      outline-offset: 2px !important;
      background-color: rgba(99, 102, 241, 0.1) !important;
      cursor: crosshair !important;
    }
    .yoink-selection-overlay {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      z-index: 999998 !important;
      cursor: crosshair !important;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Remove selection mode styles from the document.
 */
function removeSelectionStyles(): void {
  const style = document.getElementById(SELECTION_STYLE_ID);
  if (style) style.remove();
}

/**
 * Enable manual selection mode.
 *
 * Creates an overlay that intercepts all clicks.
 * Hovering highlights elements, clicking selects them.
 *
 * @param root - Root element to select within
 * @param onSelect - Called when user clicks an element
 * @param onHover - Called when user hovers over an element (or null when leaving)
 * @returns Cleanup function to exit selection mode
 */
export function enableSelectionMode(
  root: Element,
  onSelect: (element: Element) => void,
  onHover: (element: Element | null) => void
): () => void {
  ensureSelectionStyles();

  let currentHover: Element | null = null;

  // Create invisible overlay to capture events
  const overlay = document.createElement('div');
  overlay.className = 'yoink-selection-overlay';

  const handleMouseMove = (e: MouseEvent) => {
    // Hide overlay temporarily to get element under cursor
    overlay.style.pointerEvents = 'none';
    const target = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'auto';

    // Skip our own elements
    if (!target || target === overlay || target.closest('#yoink-modal-host')) {
      if (currentHover) {
        currentHover.classList.remove('yoink-selectable-hover');
        currentHover = null;
        onHover(null);
      }
      return;
    }

    // Find the best element to highlight (not too small, not too big)
    const element = findBestSelectableElement(target as Element);

    if (element !== currentHover) {
      if (currentHover) {
        currentHover.classList.remove('yoink-selectable-hover');
      }
      if (element) {
        element.classList.add('yoink-selectable-hover');
        currentHover = element;
        onHover(element);
      } else {
        currentHover = null;
        onHover(null);
      }
    }
  };

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (currentHover) {
      onSelect(currentHover);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cleanup();
    }
  };

  overlay.addEventListener('mousemove', handleMouseMove);
  overlay.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleKeyDown);

  document.body.appendChild(overlay);

  const cleanup = () => {
    overlay.removeEventListener('mousemove', handleMouseMove);
    overlay.removeEventListener('click', handleClick);
    document.removeEventListener('keydown', handleKeyDown);

    if (currentHover) {
      currentHover.classList.remove('yoink-selectable-hover');
    }

    overlay.remove();
    removeSelectionStyles();
  };

  return cleanup;
}

/**
 * Find the best element to select (not too small, not too big).
 */
function findBestSelectableElement(target: Element): Element | null {
  // Skip tiny elements (icons, etc.)
  const rect = target.getBoundingClientRect();
  if (rect.width < 30 || rect.height < 20) {
    // Try parent
    if (target.parentElement && target.parentElement !== document.body) {
      return findBestSelectableElement(target.parentElement);
    }
    return null;
  }

  // Skip huge elements (body, main containers)
  if (rect.width > window.innerWidth * 0.9 && rect.height > window.innerHeight * 0.9) {
    return null;
  }

  // Skip common non-content elements
  const tag = target.tagName.toLowerCase();
  if (['html', 'body', 'script', 'style', 'head', 'meta', 'link'].includes(tag)) {
    return null;
  }

  return target;
}

// ============================================================================
// HIGHLIGHT UTILITY
// ============================================================================

/** Style ID for general highlighting */
const HIGHLIGHT_STYLE_ID = 'yoink-highlight-styles';

/**
 * Highlight multiple elements with a specific color.
 *
 * @param elements - Elements to highlight
 * @param color - Highlight color (default: green)
 * @returns Cleanup function to remove highlights
 */
export function highlightElements(
  elements: Element[],
  color = '#22c55e'
): () => void {
  // Ensure styles exist
  let style = document.getElementById(HIGHLIGHT_STYLE_ID) as HTMLStyleElement;
  if (!style) {
    style = document.createElement('style');
    style.id = HIGHLIGHT_STYLE_ID;
    document.head.appendChild(style);
  }

  // Generate unique class for this highlight session
  const className = `yoink-hl-${Date.now()}`;

  style.textContent += `
    .${className} {
      outline: 2px solid ${color} !important;
      outline-offset: 2px !important;
      background-color: ${color}1a !important;
    }
  `;

  for (const el of elements) {
    el.classList.add(className);
  }

  return () => {
    for (const el of elements) {
      el.classList.remove(className);
    }
  };
}
