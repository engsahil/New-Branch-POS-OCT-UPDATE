/**
 * Minimal CSV generation and download.
 *
 * No spreadsheet library: a report export is a handful of rows, and RFC 4180
 * quoting is simple enough to own outright. Values are quoted only when they
 * contain a comma, quote or newline, which keeps the output readable in both
 * spreadsheet software and a text editor.
 */

export type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // Preserve numeric cells, but neutralise formulas in untrusted text cells.
  const text = typeof value === 'string' && /^[\s]*[=+@-]|^[\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
}

/** Local timestamp safe for a file name, e.g. 2026-10-23-1430. */
export function fileStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Trigger a browser download for the given CSV rows. */
export function downloadCsv(fileName: string, rows: CsvCell[][]): void {
  // A BOM keeps non-ASCII restaurant and customer names readable in Excel.
  const blob = new Blob([`\uFEFF${buildCsv(rows)}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
