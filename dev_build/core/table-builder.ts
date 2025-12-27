/**
 * Table Builder - Convert extracted data into structured tables
 *
 * ZERO chrome.* references allowed in this file.
 * This is a pure JS library that works on any DOM.
 *
 * The table builder:
 * 1. Infers column structure from extracted rows
 * 2. Detects column types (text, url, number, price, etc.)
 * 3. Normalizes data into a 2D array
 */

import type { ExtractedRow, DataTable, TableColumn } from './types';

// ============================================================================
// COLUMN INFERENCE
// ============================================================================

interface InferredColumn {
  name: string;
  type: TableColumn['type'];
  sourceKey: string;
  values: string[];
}

/**
 * Infer column type from values
 */
function inferColumnType(values: string[]): TableColumn['type'] {
  const nonEmpty = values.filter(v => v && v.trim());
  if (nonEmpty.length === 0) return 'text';

  // Check for URLs
  const urlCount = nonEmpty.filter(v => /^https?:\/\//i.test(v)).length;
  if (urlCount / nonEmpty.length > 0.7) return 'url';

  // Check for images (URLs ending in image extensions)
  const imgCount = nonEmpty.filter(v => /\.(jpg|jpeg|png|gif|webp|svg)/i.test(v)).length;
  if (imgCount / nonEmpty.length > 0.7) return 'image';

  // Check for prices
  const priceCount = nonEmpty.filter(v => /[\$£€¥][\d,]+(\.\d{2})?|\d+[\.,]\d{2}\s*[\$£€¥]/.test(v)).length;
  if (priceCount / nonEmpty.length > 0.5) return 'price';

  // Check for numbers
  const numCount = nonEmpty.filter(v => /^[\d,\.]+%?$/.test(v.trim())).length;
  if (numCount / nonEmpty.length > 0.7) return 'number';

  // Check for dates
  const datePatterns = [
    /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/,
    /\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/,
    /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i,
  ];
  const dateCount = nonEmpty.filter(v => datePatterns.some(p => p.test(v))).length;
  if (dateCount / nonEmpty.length > 0.5) return 'date';

  return 'text';
}

/**
 * Generate a column name from the source key
 */
function generateColumnName(sourceKey: string, index: number): string {
  // Clean up source key to make a readable name
  const cleaned = sourceKey
    .replace(/([A-Z])/g, ' $1') // Split camelCase
    .replace(/[_-]/g, ' ') // Replace separators
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();

  if (cleaned && cleaned.length < 30) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return `Column ${index + 1}`;
}

/**
 * Infer columns from extracted rows.
 *
 * Strategy:
 * 1. Check for structured text fields (title, price, etc.)
 * 2. Check for links and images
 * 3. Fall back to plain text
 */
function inferColumns(rows: ExtractedRow[]): InferredColumn[] {
  const columns: InferredColumn[] = [];

  if (rows.length === 0) return columns;

  // Collect all possible fields across rows
  const fieldValues: Map<string, string[]> = new Map();

  for (const row of rows) {
    // Structured text fields
    if (row.structuredText) {
      for (const [key, value] of Object.entries(row.structuredText)) {
        if (!fieldValues.has(`struct:${key}`)) {
          fieldValues.set(`struct:${key}`, []);
        }
        fieldValues.get(`struct:${key}`)!.push(value || '');
      }
    }

    // Links (first link href and text)
    if (row.links.length > 0) {
      if (!fieldValues.has('link:href')) {
        fieldValues.set('link:href', []);
        fieldValues.set('link:text', []);
      }
      fieldValues.get('link:href')!.push(row.links[0].href);
      fieldValues.get('link:text')!.push(row.links[0].text);
    } else {
      if (fieldValues.has('link:href')) {
        fieldValues.get('link:href')!.push('');
        fieldValues.get('link:text')!.push('');
      }
    }

    // Images (first image src)
    if (row.images.length > 0) {
      if (!fieldValues.has('image:src')) {
        fieldValues.set('image:src', []);
      }
      fieldValues.get('image:src')!.push(row.images[0].src);
    } else {
      if (fieldValues.has('image:src')) {
        fieldValues.get('image:src')!.push('');
      }
    }

    // Raw text as fallback
    if (!fieldValues.has('text')) {
      fieldValues.set('text', []);
    }
    fieldValues.get('text')!.push(row.text);
  }

  // Fill in missing values to align all arrays
  const rowCount = rows.length;
  for (const [key, values] of fieldValues) {
    while (values.length < rowCount) {
      values.push('');
    }
  }

  // Build columns from fields (prioritize structured text)
  const structFields = Array.from(fieldValues.entries())
    .filter(([k]) => k.startsWith('struct:'))
    .sort((a, b) => {
      // Prioritize common fields
      const priority: Record<string, number> = {
        'struct:title': 0,
        'struct:price': 1,
        'struct:rating': 2,
        'struct:description': 3,
      };
      return (priority[a[0]] ?? 10) - (priority[b[0]] ?? 10);
    });

  // Add structured fields first
  for (const [key, values] of structFields) {
    const fieldName = key.replace('struct:', '');
    const nonEmpty = values.filter(v => v && v.trim()).length;

    // Only include if at least 30% of rows have this field
    if (nonEmpty / rowCount >= 0.3) {
      columns.push({
        name: generateColumnName(fieldName, columns.length),
        type: inferColumnType(values),
        sourceKey: key,
        values,
      });
    }
  }

  // Add link if we have URLs and they're not duplicates of title
  const linkHref = fieldValues.get('link:href');
  if (linkHref && linkHref.filter(v => v).length / rowCount >= 0.3) {
    columns.push({
      name: 'Link',
      type: 'url',
      sourceKey: 'link:href',
      values: linkHref,
    });
  }

  // Add image if we have images
  const imageSrc = fieldValues.get('image:src');
  if (imageSrc && imageSrc.filter(v => v).length / rowCount >= 0.3) {
    columns.push({
      name: 'Image',
      type: 'image',
      sourceKey: 'image:src',
      values: imageSrc,
    });
  }

  // If no columns yet, use raw text
  if (columns.length === 0) {
    const textValues = fieldValues.get('text') || [];
    columns.push({
      name: 'Text',
      type: 'text',
      sourceKey: 'text',
      values: textValues,
    });
  }

  return columns;
}

// ============================================================================
// MAIN API
// ============================================================================

let tableIdCounter = 0;

/**
 * Build a DataTable from extracted rows.
 *
 * @param rows - Array of extracted row data
 * @param sourceUrl - URL the data was extracted from
 * @returns Structured DataTable
 */
export function buildTable(rows: ExtractedRow[], sourceUrl: string): DataTable {
  const inferredColumns = inferColumns(rows);

  // Build column definitions
  const columns: TableColumn[] = inferredColumns.map((col, idx) => ({
    id: `col-${++tableIdCounter}`,
    name: col.name,
    type: col.type,
    sourceKey: col.sourceKey,
  }));

  // Build 2D array of cell values
  const tableRows: string[][] = [];
  const rowCount = rows.length;

  for (let i = 0; i < rowCount; i++) {
    const row: string[] = [];
    for (const col of inferredColumns) {
      row.push(col.values[i] || '');
    }
    tableRows.push(row);
  }

  return {
    columns,
    rows: tableRows,
    sourceUrl,
    extractedAt: Date.now(),
    totalRows: rowCount,
  };
}

/**
 * Rename a column in the table (returns new table, immutable).
 *
 * @param table - Original table
 * @param columnId - ID of column to rename
 * @param newName - New column name
 * @returns New table with renamed column
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
 * Delete a column from the table (returns new table, immutable).
 *
 * @param table - Original table
 * @param columnId - ID of column to delete
 * @returns New table without the column
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
