// Shared TypeScript types for Yoink.ai
// Phase 1: Minimal placeholder - will be expanded in Phase 2

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
  structuredText: Record<string, string>;
}

export interface TableColumn {
  id: string;
  name: string;
  type: 'text' | 'number' | 'url' | 'image' | 'date' | 'price';
  sourceKey: string;
}

export interface DataTable {
  columns: TableColumn[];
  rows: string[][];
  sourceUrl: string;
  extractedAt: number;
  totalRows: number;
}

export interface PaginationInfo {
  type: 'button' | 'infinite' | 'none';
  selector?: string;
  buttonText?: string;
}
