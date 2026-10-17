/**
 * Client-side CSV exports (orders, products): builds a real .csv file and
 * hands it to the share sheet on native / downloads it on web, instead of
 * pasting the CSV text into the share message.
 */
export type CsvCell = string | number | null | undefined;

export function escapeCsvCell(value: CsvCell): string {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(header: string[], rows: CsvCell[][]): string {
  return [header, ...rows].map(r => r.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
}

/** `orders-2026-10-17.csv` style filename (local date). */
export function csvFilename(prefix: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}

/**
 * Writes the CSV and opens the share sheet / triggers a download.
 * Returns false when sharing isn't available on this device (the file is
 * still written to the cache directory). Throws on write failure.
 */
export async function exportCsvFile(prefix: string, csv: string, dialogTitle: string): Promise<boolean> {
  // Loaded on demand so screens importing this don't pull the native
  // file-system/sharing modules in at startup.
  const { saveExportFile } = await import('@/lib/saveExportFile');
  // BOM so Excel opens UTF-8 names (accents, emoji) correctly.
  return saveExportFile(
    { filename: csvFilename(prefix), mimeType: 'text/csv', encoding: 'utf8', data: '﻿' + csv },
    dialogTitle,
  );
}
