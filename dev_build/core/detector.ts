/**
 * Pattern Detector - Find repeating elements on a page
 *
 * ZERO chrome.* references allowed in this file.
 * This is a pure JS library that works on any DOM.
 */

import type { DetectedPattern } from './types';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Tags to ignore when scanning */
const IGNORE_TAGS = new Set([
  'script', 'style', 'noscript', 'meta', 'link', 'head',
  'br', 'hr', 'iframe', 'object', 'embed', 'svg', 'path',
]);

/** Navigation tags that are less likely to contain data */
const NAV_TAGS = new Set(['nav', 'header', 'footer', 'aside', 'menu']);

/** Minimum elements to form a valid pattern */
const MIN_ELEMENTS = 3;

/** Maximum patterns to return */
const MAX_PATTERNS = 5;

/** Similarity threshold for grouping (0-1) */
const SIMILARITY_THRESHOLD = 0.7;

// ============================================================================
// FINGERPRINTING
// ============================================================================

interface ElementFingerprint {
  tag: string;
  classes: string[];
  childSignature: string;
  depth: number;
  hasLinks: boolean;
  hasImages: boolean;
  hasText: boolean;
}

/**
 * Check if a class name looks dynamically generated
 */
function isDynamicClass(cls: string): boolean {
  // Random hex strings (e.g., "css-1a2b3c", "sc-abc123")
  if (/^[a-z]+-[a-f0-9]{5,}$/i.test(cls)) return true;
  if (/^[a-z]{2,3}[A-Z][a-zA-Z0-9]{10,}$/.test(cls)) return true;
  // Classes starting with underscore (framework internals)
  if (cls.startsWith('_')) return true;
  // Very long classes are often generated
  if (cls.length > 40) return true;
  return false;
}

/**
 * Get stable (non-dynamic) class names from an element
 */
function getStableClasses(element: Element): string[] {
  if (!element.className || typeof element.className !== 'string') {
    return [];
  }
  return element.className
    .trim()
    .split(/\s+/)
    .filter(cls => cls && !isDynamicClass(cls))
    .sort();
}

/**
 * Get a signature representing the child structure
 */
function getChildSignature(element: Element): string {
  const children = Array.from(element.children);
  if (children.length === 0) return '';

  // Get tag names and compress repeated sequences
  const tags: string[] = [];
  let lastTag = '';
  let count = 0;

  for (const child of children) {
    const tag = child.tagName.toLowerCase();
    if (tag === lastTag) {
      count++;
    } else {
      if (lastTag) {
        tags.push(count > 1 ? `${lastTag}*${count}` : lastTag);
      }
      lastTag = tag;
      count = 1;
    }
  }
  if (lastTag) {
    tags.push(count > 1 ? `${lastTag}*${count}` : lastTag);
  }

  return tags.join(',');
}

/**
 * Calculate the depth of an element's subtree
 */
function getTreeDepth(element: Element, maxDepth = 5): number {
  if (maxDepth <= 0 || element.children.length === 0) return 0;

  let max = 0;
  for (const child of element.children) {
    const d = getTreeDepth(child, maxDepth - 1);
    if (d > max) max = d;
  }
  return max + 1;
}

/**
 * Create a fingerprint for an element
 */
function fingerprint(element: Element): ElementFingerprint {
  const tag = element.tagName.toLowerCase();
  const classes = getStableClasses(element);
  const childSignature = getChildSignature(element);
  const depth = getTreeDepth(element);

  const hasLinks = element.getElementsByTagName('a').length > 0;
  const hasImages = element.getElementsByTagName('img').length > 0;
  const text = element.textContent?.trim() || '';
  const hasText = text.length > 10;

  return { tag, classes, childSignature, depth, hasLinks, hasImages, hasText };
}

/**
 * Compare two fingerprints for similarity (0-1)
 */
function compareFingerprints(a: ElementFingerprint, b: ElementFingerprint): number {
  // Tag must match
  if (a.tag !== b.tag) return 0;

  let score = 0.4; // Base score for matching tag

  // Class overlap (weight: 0.3)
  if (a.classes.length > 0 || b.classes.length > 0) {
    const intersection = a.classes.filter(c => b.classes.includes(c));
    const union = [...new Set([...a.classes, ...b.classes])];
    const overlap = union.length > 0 ? intersection.length / union.length : 0;
    score += 0.3 * overlap;
  } else {
    score += 0.3; // Both have no classes = match
  }

  // Child structure (weight: 0.2)
  if (a.childSignature === b.childSignature) {
    score += 0.2;
  } else if (a.childSignature && b.childSignature) {
    // Partial match
    const aParts = a.childSignature.split(',');
    const bParts = b.childSignature.split(',');
    const common = aParts.filter(p => bParts.includes(p)).length;
    const total = Math.max(aParts.length, bParts.length);
    score += 0.2 * (common / total);
  }

  // Depth similarity (weight: 0.1)
  const depthDiff = Math.abs(a.depth - b.depth);
  score += 0.1 * Math.max(0, 1 - depthDiff * 0.3);

  return score;
}

// ============================================================================
// ELEMENT FILTERING
// ============================================================================

/**
 * Check if an element should be ignored
 */
function shouldIgnore(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  return IGNORE_TAGS.has(tag);
}

/**
 * Check if an element is navigation/chrome
 */
function isNavElement(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (NAV_TAGS.has(tag)) return true;

  const role = element.getAttribute('role');
  if (role && ['navigation', 'banner', 'contentinfo', 'menu'].includes(role)) {
    return true;
  }

  return false;
}

/**
 * Check if an element is interesting (has meaningful content)
 */
function isInteresting(element: Element): boolean {
  const hasLinks = element.getElementsByTagName('a').length > 0;
  const hasImages = element.getElementsByTagName('img').length > 0;
  const text = element.textContent?.trim() || '';
  const hasText = text.length > 5;

  if (element.children.length > 0) {
    return hasLinks || hasImages || hasText;
  }

  // Leaf elements need more content
  return hasLinks || hasImages || text.length > 10;
}

// ============================================================================
// GROUPING
// ============================================================================

/**
 * Group elements by fingerprint similarity
 */
function groupByFingerprint(elements: Element[]): Map<string, Element[]> {
  const groups = new Map<string, Element[]>();
  const fingerprints = new Map<string, ElementFingerprint>();

  for (const element of elements) {
    const fp = fingerprint(element);
    const fpKey = `${fp.tag}:${fp.classes.join(',')}:${fp.childSignature}`;

    // Find best matching group
    let bestMatch: { key: string; similarity: number } | null = null;

    for (const [groupKey, groupFp] of fingerprints) {
      const similarity = compareFingerprints(fp, groupFp);
      if (similarity >= SIMILARITY_THRESHOLD) {
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { key: groupKey, similarity };
        }
      }
    }

    if (bestMatch) {
      groups.get(bestMatch.key)!.push(element);
    } else {
      // Create new group
      groups.set(fpKey, [element]);
      fingerprints.set(fpKey, fp);
    }
  }

  return groups;
}

// ============================================================================
// SCORING
// ============================================================================

/**
 * Score a group of elements for data quality
 */
function scoreGroup(elements: Element[]): number {
  // Size score (more = better, logarithmic)
  const sizeScore = Math.min(100, Math.log2(elements.length + 1) * 20);

  // Content score
  let linksCount = 0;
  let imagesCount = 0;
  let textCount = 0;

  for (const el of elements) {
    if (el.getElementsByTagName('a').length > 0) linksCount++;
    if (el.getElementsByTagName('img').length > 0) imagesCount++;
    if ((el.textContent?.trim().length || 0) > 30) textCount++;
  }

  const linkRatio = linksCount / elements.length;
  const imageRatio = imagesCount / elements.length;
  const textRatio = textCount / elements.length;

  const contentScore = (
    Math.min(30, linkRatio * 60) +
    Math.min(30, imageRatio * 60) +
    Math.min(40, textRatio * 80)
  );

  // Structure score
  const fp = fingerprint(elements[0]);
  let structureScore = 0;
  structureScore += Math.min(30, fp.depth * 10);
  structureScore += Math.min(20, elements[0].children.length * 5);
  if (fp.hasImages && fp.hasText) structureScore += 20;
  if (fp.hasLinks) structureScore += 15;

  // Navigation penalty
  let navPenalty = 0;
  const navAncestor = elements[0].closest('nav, header, footer, aside');
  if (navAncestor) navPenalty = 25;

  const rawScore = (sizeScore * 0.3) + (contentScore * 0.4) + (structureScore * 0.3);
  return Math.max(0, rawScore - navPenalty);
}

/**
 * Generate a CSS selector for a group of elements
 */
function generateSelector(elements: Element[], container: Element): string {
  if (elements.length === 0) return '';

  const first = elements[0];
  const tag = first.tagName.toLowerCase();

  // Find common classes
  const commonClasses = getStableClasses(first).filter(cls =>
    elements.every(el => el.classList.contains(cls))
  );

  let selector = tag;
  if (commonClasses.length > 0) {
    // Pick best class (semantic > generic)
    const ranked = commonClasses.sort((a, b) => {
      const semanticTerms = ['item', 'card', 'product', 'article', 'post', 'entry', 'result', 'row'];
      const aScore = semanticTerms.some(t => a.toLowerCase().includes(t)) ? 100 : 0;
      const bScore = semanticTerms.some(t => b.toLowerCase().includes(t)) ? 100 : 0;
      return bScore - aScore;
    });
    selector += `.${CSS.escape(ranked[0])}`;
  }

  // Add container context if available
  if (container !== document.body && container.id && !/\d/.test(container.id)) {
    selector = `#${CSS.escape(container.id)} ${selector}`;
  }

  return selector;
}

/**
 * Find common parent of elements
 */
function findCommonParent(elements: Element[]): Element {
  if (elements.length === 0) return document.body;
  if (elements.length === 1) return elements[0].parentElement || document.body;

  let current: Element | null = elements[0];
  const parents: Element[] = [];

  while (current) {
    parents.push(current);
    current = current.parentElement;
  }

  for (const parent of parents) {
    if (elements.every(el => parent.contains(el)) && parent !== elements[0]) {
      return parent;
    }
  }

  return document.body;
}

/**
 * Get sample text from elements
 */
function getSampleText(elements: Element[], count = 3): string[] {
  return elements.slice(0, count).map(el => {
    const text = el.textContent?.trim() || '';
    return text.length > 50 ? text.slice(0, 50) + '...' : text;
  });
}

// ============================================================================
// SITE-SPECIFIC PATTERNS
// ============================================================================

/**
 * Known attribute-based selectors for popular sites
 */
const SITE_PATTERNS = [
  // YouTube
  { selector: 'ytd-rich-item-renderer', minCount: 3 },
  { selector: 'ytd-video-renderer', minCount: 3 },
  { selector: 'ytd-compact-video-renderer', minCount: 3 },
  // Amazon
  { selector: '[data-asin]:not([data-asin=""])', minCount: 3 },
  { selector: '[data-component-type="s-search-result"]', minCount: 3 },
  // eBay
  { selector: '.s-item', minCount: 3 },
  // Etsy
  { selector: '[data-listing-id]', minCount: 3 },
  // Job sites
  { selector: '[data-jk]', minCount: 3 },
  { selector: '[data-job-id]', minCount: 3 },
  // Real estate
  { selector: '[data-zpid]', minCount: 3 },
];

// ============================================================================
// MAIN API
// ============================================================================

let patternIdCounter = 0;

/**
 * Detect repeating element patterns on a page.
 *
 * @param root - Root element to scan (default: document.body)
 * @returns Array of detected patterns, sorted by confidence (best first)
 */
export function detectPatterns(root: Element = document.body): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Strategy 1: Check site-specific patterns first
  for (const pattern of SITE_PATTERNS) {
    try {
      const elements = Array.from(root.querySelectorAll(pattern.selector));
      const visible = elements.filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (visible.length >= pattern.minCount) {
        const score = scoreGroup(visible);
        patterns.push({
          id: `pattern-${++patternIdCounter}`,
          selector: pattern.selector,
          count: visible.length,
          sampleText: getSampleText(visible),
          confidence: Math.min(100, score + 15) / 100, // Boost for known patterns
        });
      }
    } catch {
      // Invalid selector, skip
    }
  }

  // Strategy 2: Tree-walk fingerprinting
  const visited = new Set<Element>();
  const MAX_VISITS = 5000;
  let visitCount = 0;

  function walkTree(element: Element): void {
    if (visitCount++ > MAX_VISITS) return;
    if (shouldIgnore(element)) return;
    if (visited.has(element)) return;
    visited.add(element);

    const children = Array.from(element.children).filter(c => !shouldIgnore(c));

    if (children.length >= MIN_ELEMENTS) {
      const interesting = children.filter(c => !isNavElement(c) && isInteresting(c));

      if (interesting.length >= MIN_ELEMENTS) {
        const groups = groupByFingerprint(interesting);

        for (const [, groupElements] of groups) {
          if (groupElements.length >= MIN_ELEMENTS) {
            const score = scoreGroup(groupElements);
            if (score >= 30) {
              const selector = generateSelector(groupElements, element);

              // Avoid duplicates
              if (!patterns.some(p => p.selector === selector)) {
                patterns.push({
                  id: `pattern-${++patternIdCounter}`,
                  selector,
                  count: groupElements.length,
                  sampleText: getSampleText(groupElements),
                  confidence: Math.min(100, score) / 100,
                });
              }
            }
          }
        }
      }
    }

    // Recurse into children
    for (const child of children) {
      walkTree(child);
    }
  }

  walkTree(root);

  // Sort by confidence and limit results
  return patterns
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_PATTERNS);
}

/**
 * Get all elements matching a pattern selector.
 *
 * @param root - Root element to search within
 * @param selector - CSS selector for the pattern
 * @returns Array of matching elements
 */
export function getElementsByPattern(root: Element, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/**
 * Cycle to the next pattern (for "Try Another Table" button).
 *
 * @param patterns - Array of detected patterns
 * @param currentIndex - Current pattern index
 * @returns Next pattern index (wraps around)
 */
export function cyclePattern(patterns: DetectedPattern[], currentIndex: number): number {
  if (patterns.length === 0) return 0;
  return (currentIndex + 1) % patterns.length;
}
