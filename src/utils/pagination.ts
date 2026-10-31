/** Stable, one-based pagination shared by the UI and regression tests. */
export interface PageResult<T> {
  pageRows: T[];
  page: number;
  pageCount: number;
  total: number;
  first: number;
  last: number;
}

export function paginate<T>(rows: readonly T[], requestedPage: number, pageSize: number): PageResult<T> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Page size must be a positive integer.');
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const start = (page - 1) * pageSize;
  return { pageRows: rows.slice(start, start + pageSize), page, pageCount, total,
    first: total ? start + 1 : 0, last: Math.min(total, start + pageSize) };
}

export interface OrderSequence { id: string; createdAt: string }
/** Creation instant (not edit time), then stable ID; both use the same direction. */
export function compareOrderSequence(a: OrderSequence, b: OrderSequence, direction: 'newest' | 'oldest' = 'newest'): number {
  const delta = Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
  return direction === 'newest' ? -delta : delta;
}
