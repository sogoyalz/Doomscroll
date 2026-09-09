/**
 * Local-time date key, `YYYY-MM-DD`.
 *
 * Daily aggregates are bucketed in the user's own timezone — a reel watched
 * at 11pm belongs to that day as they experienced it, not to whatever UTC
 * says. Built from the local getters rather than toISOString(), which would
 * silently shift the boundary.
 */
export function localDateKey(timestamp: number): string {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}


/**
 * Start of the local day `daysBack` days before `timestamp`.
 *
 * Uses date arithmetic rather than subtracting fixed 24h blocks, so DST
 * transitions don't shift the boundary by an hour.
 */
export function startOfLocalDayBefore(timestamp: number, daysBack: number): number {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

/**
 * The inclusive local-time timestamp range covered by a `YYYY-MM-DD` key.
 *
 * Constructed with the local Date constructor rather than Date.parse, which
 * reads a bare YYYY-MM-DD as UTC and would shift the whole day.
 */
export function localDayRange(dateKey: string): { from: number; to: number } {
  const [year, month, day] = dateKey.split('-').map(Number);
  const from = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
  const to = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 23, 59, 59, 999);
  return { from: from.getTime(), to: to.getTime() };
}
