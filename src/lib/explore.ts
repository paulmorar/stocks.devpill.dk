import { hasLimitedHistory, MIN_HISTORY_YEARS } from "./scoring/types";
import type { RadarRow, Snapshot } from "./snapshot";
import type { TrendState } from "./trend";
import { median } from "./util";

/**
 * Filters and summaries for exploring the weekly snapshot. Pure, so the
 * counts can be checked against the same snapshot without a browser and
 * without any provider calls.
 */

export type UniverseId = "all" | "sp500" | "ndx";
export type HistoryFilter = "all" | "full" | "limited";

export interface Filters {
  universe: UniverseId;
  sector?: string;
  trend?: TrendState;
  /** 0 = any score. */
  minScore: number;
  history: HistoryFilter;
  /** Free text matched against ticker, name and industry. */
  q: string;
}

export const DEFAULT_FILTERS: Filters = { universe: "all", minScore: 0, history: "all", q: "" };

export const UNIVERSES: { id: UniverseId; label: string; index?: string }[] = [
  { id: "all", label: "S&P 500 + Nasdaq-100" },
  { id: "sp500", label: "S&P 500", index: "SP500" },
  { id: "ndx", label: "Nasdaq-100", index: "NDX" },
];
export const TRENDS: TrendState[] = ["Uptrend", "Recovering", "Mixed", "Weakening", "Downtrend"];
export const MIN_SCORES = [0, 50, 65, 80] as const;
/** Rows without a sector are grouped under this label rather than dropped. */
export const NO_SECTOR = "Unclassified";

const sectorOf = (r: RadarRow) => r.sector || NO_SECTOR;

/** true/false when the row records its indices; undefined when the snapshot predates that data. Never guessed. */
export function inUniverse(row: Pick<RadarRow, "index">, universe: UniverseId): boolean | undefined {
  if (universe === "all") return true;
  if (!row.index) return undefined;
  return row.index.includes(UNIVERSES.find((u) => u.id === universe)?.index ?? "");
}

/** Universes that the snapshot can actually answer for (demo snapshots have no index data). */
export const availableUniverses = (rows: RadarRow[]) =>
  UNIVERSES.filter((u) => !u.index || rows.some((r) => r.index?.includes(u.index as string)));

function historyMatches(years: number | undefined, filter: HistoryFilter) {
  if (filter === "limited") return hasLimitedHistory(years);
  if (filter === "full") return years !== undefined && years > MIN_HISTORY_YEARS;
  return true;
}

/** Apply every filter. Keeps the input order, so ranked input stays ranked. */
export function applyFilters(rows: RadarRow[], f: Filters): RadarRow[] {
  const q = f.q.trim().toUpperCase();
  return rows.filter(
    (r) =>
      inUniverse(r, f.universe) === true &&
      (!f.sector || sectorOf(r) === f.sector) &&
      (!f.trend || r.trend === f.trend) &&
      r.score >= f.minScore &&
      historyMatches(r.yearsOfHistory, f.history) &&
      (!q || r.symbol.includes(q) || r.name.toUpperCase().includes(q) || (r.industry ?? "").toUpperCase().includes(q)),
  );
}

export const isDefault = (f: Filters) =>
  f.universe === "all" && !f.sector && !f.trend && f.minScore === 0 && f.history === "all" && !f.q.trim();

export interface SectorSummary {
  sector: string;
  /** Scored stocks only: excluded and failed stocks never count as zero scores. */
  scored: number;
  top: number;
  median?: number;
}

export interface Overview {
  /** Scored stocks in the selected universe. */
  scored: number;
  /** In the universe but not scored (funds, REITs, too little history). */
  excluded: number;
  /** Data failed to load; counted only when the snapshot records their index. */
  failed: number;
  /** Rows or failures whose index membership the snapshot doesn't record (only for S&P 500 / Nasdaq-100 views). */
  unknown: number;
  sectors: SectorSummary[];
}

/** Sector tiles plus honest denominators for one universe. */
export function overview(snap: Pick<Snapshot, "rows" | "failed">, universe: UniverseId): Overview {
  const member = (x: Pick<RadarRow, "index">) => inUniverse(x, universe);
  const inside = snap.rows.filter((r) => member(r) === true);
  const scored = inside.filter((r) => r.scorable);
  const bySector = new Map<string, number[]>();
  for (const r of scored) bySector.set(sectorOf(r), [...(bySector.get(sectorOf(r)) ?? []), r.score]);
  const sectors = [...bySector.entries()]
    .map(([sector, scores]) => ({ sector, scored: scores.length, top: scores.filter((s) => s >= 80).length, median: median(scores) }))
    .sort((a, b) => b.top - a.top || (b.median ?? 0) - (a.median ?? 0) || a.sector.localeCompare(b.sector));
  const failed = snap.failed ?? [];
  return {
    scored: scored.length,
    excluded: inside.length - scored.length,
    failed: failed.filter((x) => member(x) === true).length,
    unknown: snap.rows.filter((r) => member(r) === undefined).length + failed.filter((x) => member(x) === undefined).length,
    sectors,
  };
}

/** Read filters from a URL query. Unknown or malformed values fall back to the defaults. */
export function parseFilters(params: URLSearchParams): Filters {
  const universe = UNIVERSES.find((u) => u.id === params.get("u"))?.id ?? "all";
  const trend = TRENDS.find((t) => t === params.get("trend"));
  const min = Number(params.get("min"));
  const history = params.get("history");
  return {
    universe,
    sector: params.get("sector")?.trim() || undefined,
    trend,
    minScore: (MIN_SCORES as readonly number[]).includes(min) ? min : 0,
    history: history === "full" || history === "limited" ? history : "all",
    q: (params.get("q") ?? "").slice(0, 40),
  };
}

/** Write filters into a URL query, leaving defaults out so plain URLs stay plain. */
export function filtersToParams(f: Filters, params = new URLSearchParams()): URLSearchParams {
  const set = (k: string, v: string | undefined) => (v ? params.set(k, v) : params.delete(k));
  set("u", f.universe === "all" ? undefined : f.universe);
  set("sector", f.sector);
  set("trend", f.trend);
  set("min", f.minScore ? String(f.minScore) : undefined);
  set("history", f.history === "all" ? undefined : f.history);
  set("q", f.q.trim() || undefined);
  return params;
}
