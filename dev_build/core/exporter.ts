/**
 * Exporter - Generate CSV, JSON, XLSX, and clipboard formats
 *
 * ZERO chrome.* references allowed in this file.
 * This is a pure JS library that works on any DOM.
 */

import type { DataTable } from './types';

// ============================================================================
// CSV EXPORT
// ============================================================================

/**
 * Escape a value for CSV format.
 * - Wraps in quotes if contains comma, quote, or newline
 * - Doubles internal quotes
 */
function escapeCSV(value: string): string {
  if (!value) return '';

  const needsQuotes = /[",\n\r]/.test(value);
  if (needsQuotes) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Generate CSV string from table data.
 *
 * @param table - The data table to export
 * @returns CSV formatted string
 */
export function toCSV(table: DataTable): string {
  const lines: string[] = [];

  // Header row
  const headers = table.columns.map(col => escapeCSV(col.name));
  lines.push(headers.join(','));

  // Data rows
  for (const row of table.rows) {
    const cells = row.map(cell => escapeCSV(cell || ''));
    lines.push(cells.join(','));
  }

  return lines.join('\n');
}

// ============================================================================
// JSON EXPORT
// ============================================================================

/**
 * Generate JSON string from table data.
 *
 * Returns an array of objects, where each object has column names as keys.
 *
 * @param table - The data table to export
 * @returns JSON formatted string
 */
export function toJSON(table: DataTable): string {
  const rows: Record<string, string>[] = [];

  for (const row of table.rows) {
    const obj: Record<string, string> = {};
    for (let i = 0; i < table.columns.length; i++) {
      const col = table.columns[i];
      obj[col.name] = row[i] || '';
    }
    rows.push(obj);
  }

  return JSON.stringify(rows, null, 2);
}

// ============================================================================
// TSV (CLIPBOARD) EXPORT
// ============================================================================

/**
 * Escape a value for TSV format (clipboard paste).
 */
function escapeTSV(value: string): string {
  if (!value) return '';
  // Replace tabs and newlines with spaces
  return value.replace(/[\t\n\r]/g, ' ');
}

/**
 * Generate TSV string for clipboard (paste into Excel/Sheets).
 *
 * @param table - The data table to export
 * @returns TSV formatted string
 */
export function toClipboard(table: DataTable): string {
  const lines: string[] = [];

  // Header row
  const headers = table.columns.map(col => escapeTSV(col.name));
  lines.push(headers.join('\t'));

  // Data rows
  for (const row of table.rows) {
    const cells = row.map(cell => escapeTSV(cell || ''));
    lines.push(cells.join('\t'));
  }

  return lines.join('\n');
}

// ============================================================================
// XLSX EXPORT (using SheetJS)
// ============================================================================

/**
 * Generate XLSX blob from table data.
 *
 * Requires SheetJS (xlsx) library to be loaded.
 * Returns null if SheetJS is not available.
 *
 * @param table - The data table to export
 * @returns Blob containing XLSX data, or null if SheetJS unavailable
 */
export function toXLSX(table: DataTable): Blob | null {
  // Check if SheetJS is available
  const XLSX = (window as unknown as { XLSX?: XLSXLibrary }).XLSX;
  if (!XLSX) {
    console.warn('[Yoink] SheetJS (XLSX) library not loaded');
    return null;
  }

  try {
    // Build worksheet data
    const wsData: string[][] = [];

    // Header row
    wsData.push(table.columns.map(col => col.name));

    // Data rows
    for (const row of table.rows) {
      wsData.push(row.map(cell => cell || ''));
    }

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');

    // Generate binary
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    return new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  } catch (error) {
    console.error('[Yoink] XLSX generation failed:', error);
    return null;
  }
}

// SheetJS type definitions (minimal)
interface XLSXLibrary {
  utils: {
    aoa_to_sheet: (data: string[][]) => unknown;
    book_new: () => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
  };
  write: (wb: unknown, opts: { bookType: string; type: string }) => ArrayBuffer;
}

// ============================================================================
// FULL PAGE HTML CAPTURE
// ============================================================================

/**
 * Capture the current page's HTML.
 *
 * @returns Full HTML string of the page
 */
export function capturePageHTML(): string {
  // Get the full document HTML
  const doctype = document.doctype
    ? `<!DOCTYPE ${document.doctype.name}${
        document.doctype.publicId ? ` PUBLIC "${document.doctype.publicId}"` : ''
      }${document.doctype.systemId ? ` "${document.doctype.systemId}"` : ''}>\n`
    : '';

  return doctype + document.documentElement.outerHTML;
}

// ============================================================================
// DOWNLOAD HELPERS
// ============================================================================

/**
 * Trigger a file download in the browser.
 *
 * @param content - File content (string or Blob)
 * @param filename - Name for the downloaded file
 * @param mimeType - MIME type (only used if content is string)
 */
export function downloadFile(
  content: string | Blob,
  filename: string,
  mimeType = 'text/plain'
): void {
  const blob = typeof content === 'string'
    ? new Blob([content], { type: mimeType })
    : content;

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
 * Copy text to clipboard.
 *
 * @param text - Text to copy
 * @returns Promise that resolves when copied
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

/**
 * Generate a filename based on the page title and format.
 *
 * @param format - File extension (csv, json, xlsx, html)
 * @param sourceUrl - URL of the source page
 * @returns Filename string
 */
export function generateFilename(format: string, sourceUrl: string): string {
  // Try to get a meaningful name from the URL
  let name = 'yoink-data';

  try {
    const url = new URL(sourceUrl);
    const hostname = url.hostname.replace(/^www\./, '');
    const pathname = url.pathname
      .replace(/\/$/, '')
      .split('/')
      .filter(p => p)
      .pop();

    if (pathname && pathname.length < 50) {
      name = `${hostname}-${pathname}`;
    } else {
      name = hostname;
    }

    // Clean up for filename
    name = name.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-');
  } catch {
    // Invalid URL, use default
  }

  // Add timestamp
  const date = new Date();
  const timestamp = date.toISOString().slice(0, 10);

  return `${name}-${timestamp}.${format}`;
}
