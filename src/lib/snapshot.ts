import type { LongTermReport } from "./analyze";
import type { Band, PillarId } from "./scoring/types";
import type { TrendState } from "./trend";

/**
 * Weekly snapshot of the whole universe — the data behind the "On the Radar"
 * list. Produced by scripts/scan.ts (GitHub Actions, weekly) and committed to
 * the repo, so each deploy ships the latest scores and the week-over-week
 * changes are computed from real history rather than the viewer's browser.
 */
export interface RadarRow {
  symbol: string;
  name: string;
  index?: string[];
  sector?: string;
  industry?: string;
  scorable: boolean;
  score: number;
  raw: number;
  band: Band;
  scorecard: "main" | "financials";
  capexMode: boolean;
  flags: string[];
  pillars: Record<PillarId, number>;
  trend?: TrendState;
  rs?: number;
  ind?: number;
  /** Own 6-month return (input to industry momentum). */
  r6?: number;
  price?: number;
  /** Change vs the previous snapshot. null = not in the previous snapshot. */
  delta?: number | null;
}

export interface Snapshot {
  date: string;
  generatedAt: string;
  universe: string;
  previousDate?: string;
  attempted: number;
  /** S&P 500 6-month return used for Ind. */
  spy6?: number;
  /** Industry momentum from universe peers: median 6-month return minus the S&P 500's. */
  industries?: Record<string, { ind: number; n: number }>;
  rows: RadarRow[];
  failed: { symbol: string; error: string }[];
}

export const EMPTY_SNAPSHOT: Snapshot = {
  date: "", generatedAt: "", universe: "S&P 500 + Nasdaq 100", attempted: 0, rows: [], failed: [],
};

export function toRow(r: LongTermReport, index?: string[]): RadarRow {
  const p = Object.fromEntries(r.score.pillars.map((x) => [x.id, Math.round(x.points)])) as Record<PillarId, number>;
  return {
    symbol: r.profile.symbol,
    name: r.profile.name,
    index,
    sector: r.profile.sector,
    industry: r.profile.industry,
    scorable: r.score.scorable,
    score: r.score.total,
    raw: r.score.raw,
    band: r.score.band,
    scorecard: r.score.scorecard,
    capexMode: r.score.capexMode,
    flags: r.score.redFlags.map((f) => f.label),
    pillars: p,
    trend: r.trend?.state,
    rs: r.trend?.rs !== undefined ? Math.round(r.trend.rs * 1000) / 1000 : undefined,
    ind: r.trend?.ind !== undefined ? Math.round(r.trend.ind * 1000) / 1000 : undefined,
    r6: r.trend?.r6 !== undefined ? Math.round(r.trend.r6 * 1000) / 1000 : undefined,
    price: r.market.price,
  };
}

/**
 * Ind the way TTT appears to compute it: every stock in the same industry shares one
 * value (their ASML, NVDA, MU and KLAC all show -18%). Median of the universe peers'
 * 6-month returns minus the S&P 500's. Needs at least 3 peers.
 */
export function industryMomentum(rows: RadarRow[], spy6: number, minPeers = 3) {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.industry || r.r6 === undefined) continue;
    groups.set(r.industry, [...(groups.get(r.industry) ?? []), r.r6]);
  }
  const out: Record<string, { ind: number; n: number }> = {};
  for (const [industry, vals] of groups) {
    if (vals.length < minPeers) continue;
    const s = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    const med = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
    out[industry] = { ind: Math.round((med - spy6) * 1000) / 1000, n: vals.length };
  }
  return out;
}

export function withDeltas(rows: RadarRow[], prev?: Snapshot): RadarRow[] {
  const before = new Map((prev?.rows ?? []).filter((r) => r.scorable).map((r) => [r.symbol, r.score]));
  return rows.map((r) => ({ ...r, delta: before.has(r.symbol) ? r.score - (before.get(r.symbol) as number) : prev ? null : undefined }));
}

/** Rank: score desc, then raw score, then relative strength, then symbol. */
export function rank(rows: RadarRow[]) {
  return [...rows]
    .filter((r) => r.scorable)
    .sort((a, b) => b.score - a.score || b.raw - a.raw || (b.rs ?? -9) - (a.rs ?? -9) || a.symbol.localeCompare(b.symbol));
}
