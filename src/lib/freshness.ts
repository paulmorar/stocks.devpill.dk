/**
 * How old the numbers on screen are. Pure helpers, so the wording can be tested
 * without a browser. Weekly rankings, quotes and financial reports age
 * differently, and the UI labels each one separately.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The weekly scan runs every Sunday. A snapshot older than this means at least one run was missed. */
export const SNAPSHOT_STALE_DAYS = 8;
/** A last trade older than a long weekend: trading may be halted, or the listing may have changed. */
export const QUOTE_STALE_DAYS = 4;
/** Company data (statements and the price used for the score) stays in the server cache this long. */
export const COMPANY_CACHE_HOURS = 12;

export type Freshness = { state: "unavailable" } | { state: "current" | "stale"; ageMs: number };

/** Classify a timestamp against a staleness threshold. Missing or invalid timestamps are "unavailable", never "current". */
export function freshness(iso: string | undefined, staleAfterDays: number, now = Date.now()): Freshness {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(t)) return { state: "unavailable" };
  const ageMs = Math.max(0, now - t);
  return { state: ageMs > staleAfterDays * DAY ? "stale" : "current", ageMs };
}

/** "12 min", "1 hour", "3 days". */
export function formatDuration(ms: number): string {
  if (ms < MINUTE) return "less than a minute";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.floor(ms / DAY);
  return `${d} day${d === 1 ? "" : "s"}`;
}

export const formatAge = (ms: number) => (ms < MINUTE ? "just now" : `${formatDuration(ms)} ago`);

/** Date and time with the time zone spelled out, so a Friday close never reads as a Monday price. */
export function formatTimestamp(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone,
  });
}
