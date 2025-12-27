/**
 * LLM Module for AI Data Cleanup
 *
 * ZERO chrome.* references allowed in this file.
 * This is a pure JS library for LLM interactions.
 *
 * Rate limiting is handled in the extension layer.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface TransformRequest {
  columns: string[];
  sampleRows: string[][];
  rowCount: number;
  sourceUrl: string;
}

export type Transform =
  | { type: 'rename'; column: number; to: string }
  | { type: 'extract_number'; column: number }
  | { type: 'extract_date'; column: number }
  | { type: 'split'; column: number; delimiter: string; into: string[] }
  | { type: 'merge'; columns: number[]; delimiter: string; into: string }
  | { type: 'delete'; column: number }
  | { type: 'strip_whitespace'; column: number }
  | { type: 'strip_emoji'; column: number }
  | { type: 'lowercase'; column: number }
  | { type: 'uppercase'; column: number }
  | { type: 'absolute_url'; column: number; baseUrl: string };

export interface TransformSuggestions {
  columnRenames: Record<string, string>;
  transforms: Transform[];
  deletions: number[];
  warnings: string[];
  confidence: number;
}

export interface TransformResult {
  data: string[][];
  columns: string[];
}

export interface SmartExtractRequest {
  userPrompt: string;
  pageUrl: string;
  domSample: string; // Simplified DOM structure
}

export interface SmartExtractResult {
  selector: string;
  fields: Array<{
    name: string;
    cssSelector: string;
    description: string;
  }>;
  confidence: number;
  explanation: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// API Settings - Uses claude-haiku-4-5 for fast, cheap inference
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;

// Rate limit constants
export const MAX_CALLS_PER_DOMAIN = 5;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ============================================================================
// PROMPT BUILDING
// ============================================================================

/**
 * Build the prompt for data transformation suggestions.
 */
export function buildTransformPrompt(request: TransformRequest): string {
  const { columns, sampleRows, rowCount, sourceUrl } = request;

  // Extract base URL for absolute_url transforms
  let baseUrl = sourceUrl;
  try {
    const url = new URL(sourceUrl);
    baseUrl = `${url.protocol}//${url.host}`;
  } catch {
    // Keep original if parsing fails
  }

  // Format sample rows
  const formattedRows = sampleRows
    .map((row, i) => `Row ${i + 1}: ${JSON.stringify(row)}`)
    .join('\n');

  // Format columns with indices
  const columnsWithIndices = columns
    .map((col, i) => `  ${i}: "${col}"`)
    .join('\n');

  return `You are a data cleaning assistant. Analyze this scraped data and suggest improvements.

## Scraped Data
Source: ${sourceUrl}
Base URL: ${baseUrl}
Total rows: ${rowCount}

Columns (index: name):
${columnsWithIndices}

Sample data:
${formattedRows}

## Your Task
Return a JSON object with these fields:

### 1. columnRenames (object)
Map current column names to better names based on the VALUES, not the current names.
- Use lowercase_snake_case
- Only rename if the current name is gibberish or unclear
- Example: {"col_0": "product_name", "x15mokao": "price"}

### 2. transforms (array)
Array of transformations. Use the column INDEX (0-based integer), not the name.

Available transform types:
- {"type": "extract_number", "column": 0} — Extract "$1,234.56" → 1234.56
- {"type": "split", "column": 0, "delimiter": " - ", "into": ["name", "size"]} — Split "Widget - Large" into two columns
- {"type": "strip_whitespace", "column": 0} — Normalize whitespace
- {"type": "strip_emoji", "column": 0} — Remove emoji characters
- {"type": "absolute_url", "column": 0, "baseUrl": "${baseUrl}"} — Convert "/path" to full URL

### 3. deletions (array)
Array of column INDICES (integers) that are empty or useless.
Example: [3, 5] means delete columns at index 3 and 5.

### 4. warnings (array)
Array of strings describing data quality issues.
Example: ["Price in row 2 shows 'From $19.99' - minimum price used"]

### 5. confidence (number)
0.0 to 1.0 indicating overall confidence.

## Rules
- Column indices are 0-based integers (first column is 0)
- Only suggest transforms you're confident about
- Be conservative - skip uncertain suggestions
- For absolute_url, use baseUrl: "${baseUrl}"

## Response
Return ONLY a JSON object. No markdown, no code blocks, no explanation:
{"columnRenames":{}, "transforms":[], "deletions":[], "warnings":[], "confidence":0.8}`;
}

/**
 * Build the prompt for smart extraction based on user description.
 */
export function buildSmartExtractPrompt(request: SmartExtractRequest): string {
  const { userPrompt, pageUrl, domSample } = request;

  return `You are a web scraping expert. Analyze this page and help extract the data the user wants.

## User Request
"${userPrompt}"

## Page URL
${pageUrl}

## DOM Sample (simplified structure with sample content)
${domSample}

## Your Task
Identify the repeating elements that contain the data the user wants, and the CSS selectors to extract each field.

Return a JSON object with:

### selector (string)
CSS selector for the repeating container elements (like product cards, list items, table rows).
Example: ".product-card" or "tr.data-row" or "[data-testid='post']"

### fields (array)
Array of field definitions to extract from each element:
- name: Column name (snake_case)
- cssSelector: CSS selector RELATIVE to the container element
- description: What this field contains

Example:
[
  {"name": "title", "cssSelector": "h2.title, .heading a", "description": "Product title"},
  {"name": "price", "cssSelector": ".price, [data-price]", "description": "Price value"},
  {"name": "link", "cssSelector": "a[href]", "description": "Product URL"}
]

### confidence (number)
0.0 to 1.0 indicating how confident you are.

### explanation (string)
Brief explanation of what you identified and why.

## Rules
- The container selector should match multiple repeating elements
- Field selectors are RELATIVE to the container, not absolute
- Use multiple fallback selectors separated by commas for robustness
- If the user asks for something not on the page, return confidence: 0 and explain

## Response
Return ONLY a JSON object. No markdown, no code blocks:
{"selector": "", "fields": [], "confidence": 0.8, "explanation": ""}`;
}

/**
 * Parse smart extraction response from LLM.
 */
export function parseSmartExtractResponse(response: string): SmartExtractResult {
  const cleaned = cleanJsonResponse(response);
  const parsed = JSON.parse(cleaned);

  return {
    selector: typeof parsed.selector === 'string' ? parsed.selector : '',
    fields: Array.isArray(parsed.fields) ? parsed.fields.filter((f: unknown) => {
      if (typeof f !== 'object' || f === null) return false;
      const field = f as Record<string, unknown>;
      return typeof field.name === 'string' && typeof field.cssSelector === 'string';
    }) : [],
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
  };
}

// ============================================================================
// API CLIENT
// ============================================================================

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: 'auth' | 'rate_limit' | 'network' | 'parse' | 'unknown',
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/**
 * Call the Anthropic API with a prompt.
 * Requires API key to be passed in (not bundled in core/).
 */
export async function callClaude(prompt: string, apiKey: string): Promise<string> {
  if (!apiKey) {
    throw new LLMError('API key not configured', 'auth', false);
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (response.status === 401) {
      throw new LLMError('Invalid API key', 'auth', false);
    }

    if (response.status === 429) {
      throw new LLMError('API rate limit reached. Try again later.', 'rate_limit', true);
    }

    if (response.status === 529) {
      throw new LLMError('API overloaded. Please try again later.', 'rate_limit', true);
    }

    if (!response.ok) {
      throw new LLMError(`API error: ${response.status}`, 'unknown', response.status >= 500);
    }

    const data = await response.json();

    if (!data.content || data.content.length === 0) {
      throw new LLMError('Empty response from AI', 'parse', true);
    }

    return data.content[0].text;
  } catch (error) {
    if (error instanceof LLMError) throw error;

    if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
      throw new LLMError('Network error. Check your connection.', 'network', true);
    }

    throw new LLMError(
      `Unexpected error: ${error instanceof Error ? error.message : 'Unknown'}`,
      'unknown',
      true
    );
  }
}

/**
 * Clean up LLM response to extract valid JSON.
 */
function cleanJsonResponse(response: string): string {
  let cleaned = response.trim();

  // Remove markdown code blocks
  const codeBlockMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // Extract JSON object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

/**
 * Validate a single transform object.
 */
function isValidTransform(t: unknown): t is Transform {
  if (typeof t !== 'object' || t === null) return false;
  const transform = t as Record<string, unknown>;

  if (typeof transform.type !== 'string') return false;

  switch (transform.type) {
    case 'rename':
      return typeof transform.column === 'number' && typeof transform.to === 'string';
    case 'extract_number':
    case 'strip_whitespace':
    case 'strip_emoji':
    case 'lowercase':
    case 'uppercase':
    case 'delete':
    case 'extract_date':
      return typeof transform.column === 'number';
    case 'split':
      return (
        typeof transform.column === 'number' &&
        typeof transform.delimiter === 'string' &&
        Array.isArray(transform.into) &&
        transform.into.length >= 2
      );
    case 'merge':
      return (
        Array.isArray(transform.columns) &&
        transform.columns.every((c: unknown) => typeof c === 'number') &&
        typeof transform.delimiter === 'string' &&
        typeof transform.into === 'string'
      );
    case 'absolute_url':
      return typeof transform.column === 'number' && typeof transform.baseUrl === 'string';
    default:
      return false;
  }
}

/**
 * Validate transform suggestions from LLM response.
 */
export function validateSuggestions(raw: unknown): TransformSuggestions {
  const obj = raw as Record<string, unknown>;

  // Validate columnRenames
  let columnRenames: Record<string, string> = {};
  if (typeof obj.columnRenames === 'object' && obj.columnRenames !== null) {
    const renames = obj.columnRenames as Record<string, unknown>;
    for (const [key, value] of Object.entries(renames)) {
      if (typeof value === 'string' && value.trim() !== '') {
        columnRenames[key] = value;
      }
    }
  }

  // Validate transforms
  const transforms: Transform[] = [];
  if (Array.isArray(obj.transforms)) {
    for (const t of obj.transforms) {
      if (isValidTransform(t)) {
        transforms.push(t);
      }
    }
  }

  // Validate deletions
  const deletions: number[] = [];
  if (Array.isArray(obj.deletions)) {
    for (const d of obj.deletions) {
      if (typeof d === 'number' && Number.isInteger(d) && d >= 0) {
        deletions.push(d);
      }
    }
  }

  // Validate warnings
  const warnings: string[] = [];
  if (Array.isArray(obj.warnings)) {
    for (const w of obj.warnings) {
      if (typeof w === 'string' && w.trim() !== '') {
        warnings.push(w);
      }
    }
  }

  // Validate confidence
  let confidence = 0.5;
  if (typeof obj.confidence === 'number' && !isNaN(obj.confidence)) {
    confidence = Math.max(0, Math.min(1, obj.confidence));
  }

  return { columnRenames, transforms, deletions, warnings, confidence };
}

/**
 * Parse LLM response into TransformSuggestions.
 */
export function parseLLMResponse(response: string): TransformSuggestions {
  const cleaned = cleanJsonResponse(response);
  const parsed = JSON.parse(cleaned);
  return validateSuggestions(parsed);
}

// ============================================================================
// TRANSFORM EXECUTION
// ============================================================================

/**
 * Apply transforms to data.
 */
export function applyTransforms(
  data: string[][],
  columns: string[],
  suggestions: TransformSuggestions,
  enabledRenames: Set<string>,
  enabledTransforms: Set<number>,
  enabledDeletions: Set<number>
): TransformResult {
  let newData = data.map(row => [...row]);
  let newColumns = [...columns];
  const columnShifts: number[] = new Array(columns.length).fill(0);

  // 1. Apply column renames
  for (const [oldName, newName] of Object.entries(suggestions.columnRenames)) {
    if (enabledRenames.has(oldName)) {
      const idx = newColumns.indexOf(oldName);
      if (idx !== -1) {
        newColumns[idx] = newName;
      }
    }
  }

  // 2. Apply transforms
  for (let i = 0; i < suggestions.transforms.length; i++) {
    if (!enabledTransforms.has(i)) continue;

    const transform = suggestions.transforms[i];
    const result = applySingleTransform(newData, newColumns, transform, columnShifts);
    newData = result.data;
    newColumns = result.columns;
  }

  // 3. Apply deletions (reverse order)
  const sortedDeletions = [...enabledDeletions].sort((a, b) => b - a);
  for (const idx of sortedDeletions) {
    const adjustedIdx = idx + columnShifts.slice(0, idx + 1).reduce((a, b) => a + b, 0);
    if (adjustedIdx >= 0 && adjustedIdx < newColumns.length) {
      newColumns.splice(adjustedIdx, 1);
      newData = newData.map(row => {
        const newRow = [...row];
        newRow.splice(adjustedIdx, 1);
        return newRow;
      });
    }
  }

  return { data: newData, columns: newColumns };
}

function applySingleTransform(
  data: string[][],
  columns: string[],
  transform: Transform,
  columnShifts: number[]
): TransformResult {
  const adjustedColumn = 'column' in transform
    ? transform.column + columnShifts.slice(0, transform.column + 1).reduce((a, b) => a + b, 0)
    : 0;

  switch (transform.type) {
    case 'rename':
      return { data, columns };

    case 'extract_number':
      return {
        data: data.map(row => {
          const newRow = [...row];
          const val = newRow[adjustedColumn] || '';
          const cleaned = val.replace(/[^0-9.\-]/g, '');
          const num = parseFloat(cleaned);
          newRow[adjustedColumn] = isNaN(num) ? val : String(num);
          return newRow;
        }),
        columns,
      };

    case 'split': {
      const { delimiter, into } = transform;
      const numNewCols = into.length - 1;

      if (transform.column < columnShifts.length) {
        columnShifts[transform.column] += numNewCols;
      }

      const newColumns = [...columns];
      newColumns.splice(adjustedColumn, 1, ...into);

      const newData = data.map(row => {
        const newRow = [...row];
        const val = newRow[adjustedColumn] || '';
        const parts = val.split(delimiter);

        while (parts.length < into.length) {
          parts.push('');
        }

        newRow.splice(adjustedColumn, 1, ...parts.slice(0, into.length));
        return newRow;
      });

      return { data: newData, columns: newColumns };
    }

    case 'strip_whitespace':
      return {
        data: data.map(row => {
          const newRow = [...row];
          newRow[adjustedColumn] = (newRow[adjustedColumn] || '')
            .trim()
            .replace(/\s+/g, ' ');
          return newRow;
        }),
        columns,
      };

    case 'strip_emoji':
      return {
        data: data.map(row => {
          const newRow = [...row];
          newRow[adjustedColumn] = (newRow[adjustedColumn] || '')
            .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
            .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
            .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
            .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
            .replace(/[\u{2600}-\u{26FF}]/gu, '')
            .replace(/[\u{2700}-\u{27BF}]/gu, '')
            .trim();
          return newRow;
        }),
        columns,
      };

    case 'lowercase':
      return {
        data: data.map(row => {
          const newRow = [...row];
          newRow[adjustedColumn] = (newRow[adjustedColumn] || '').toLowerCase();
          return newRow;
        }),
        columns,
      };

    case 'uppercase':
      return {
        data: data.map(row => {
          const newRow = [...row];
          newRow[adjustedColumn] = (newRow[adjustedColumn] || '').toUpperCase();
          return newRow;
        }),
        columns,
      };

    case 'absolute_url': {
      const { baseUrl } = transform;
      return {
        data: data.map(row => {
          const newRow = [...row];
          const val = newRow[adjustedColumn] || '';
          if (val && !val.startsWith('http://') && !val.startsWith('https://')) {
            try {
              newRow[adjustedColumn] = new URL(val, baseUrl).href;
            } catch {
              // Keep original
            }
          }
          return newRow;
        }),
        columns,
      };
    }

    case 'delete':
      return { data, columns };

    case 'extract_date':
      return {
        data: data.map(row => {
          const newRow = [...row];
          const val = newRow[adjustedColumn] || '';
          try {
            const date = new Date(val);
            if (!isNaN(date.getTime())) {
              newRow[adjustedColumn] = date.toISOString().split('T')[0];
            }
          } catch {
            // Keep original
          }
          return newRow;
        }),
        columns,
      };

    default:
      return { data, columns };
  }
}

/**
 * Get human-readable description of a transform.
 */
export function describeTransform(transform: Transform, columns: string[]): string {
  const getColName = (idx: number) => columns[idx] || `Column ${idx + 1}`;

  switch (transform.type) {
    case 'rename':
      return `Rename "${getColName(transform.column)}" to "${transform.to}"`;
    case 'extract_number':
      return `Extract numbers from "${getColName(transform.column)}"`;
    case 'extract_date':
      return `Extract dates from "${getColName(transform.column)}"`;
    case 'split':
      return `Split "${getColName(transform.column)}" by "${transform.delimiter}"`;
    case 'merge':
      return `Merge columns [${transform.columns.map(getColName).join(', ')}]`;
    case 'delete':
      return `Delete column "${getColName(transform.column)}"`;
    case 'strip_whitespace':
      return `Strip whitespace from "${getColName(transform.column)}"`;
    case 'strip_emoji':
      return `Remove emoji from "${getColName(transform.column)}"`;
    case 'lowercase':
      return `Convert "${getColName(transform.column)}" to lowercase`;
    case 'uppercase':
      return `Convert "${getColName(transform.column)}" to uppercase`;
    case 'absolute_url':
      return `Convert relative URLs in "${getColName(transform.column)}" to absolute`;
    default:
      return 'Unknown transform';
  }
}
