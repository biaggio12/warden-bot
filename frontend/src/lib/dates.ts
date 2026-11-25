/** yyyy-mm-dd of a local date, as <input type="date"> wants it. */
export function dayString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Local midnight of a yyyy-mm-dd day, plus `days`, as an ISO date-time for the API. */
export function midnight(day: string, days = 0): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d! + days).toISOString();
}

/**
 * The API's `from` / `until` for a From–To pick where either day may be empty; both days
 * count in full (until is the midnight after `to`). Null when the start is after the end.
 */
export function dayWindow(from: string, to: string): { from?: string; until?: string } | null {
  if (from && to && from > to) return null;
  return { ...(from ? { from: midnight(from) } : {}), ...(to ? { until: midnight(to, 1) } : {}) };
}
