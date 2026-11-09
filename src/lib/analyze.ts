import "server-only";
import latest from "../data/snapshots/latest.json";
import type { Snapshot } from "./snapshot";
import { getCloses, getCompany, getDaily, getIntraday } from "./data";
import { scoreCompany } from "./scoring/engine";
import { summarize } from "./scoring/summary";
import type { Explain, ScoreResult } from "./scoring/types";
import { analyzeShortTerm, type ShortTermResult } from "./shortterm";
import { computeTrend, industryProxy, quadrant, type TrendResult } from "./trend";
import type { CompanyProfile, MarketSnapshot, PeriodRow, Source } from "./types";

export interface LongTermReport {
  profile: CompanyProfile;
  market: MarketSnapshot;
  score: ScoreResult;
  trend?: TrendResult;
  quadrant?: Explain & { title: string };
  summary: Explain;
  annual: PeriodRow[];
  ttm?: PeriodRow;
  sources: Source[];
  warnings: string[];
  fetchedAt: string;
}

export async function analyzeLongTerm(symbol: string): Promise<LongTermReport> {
  const company = await getCompany(symbol);
  const proxy = industryProxy(company.profile.industry, company.profile.sector);
  const [spy, peers] = await Promise.all([
    getCloses("SPY", 300).catch(() => undefined),
    proxy !== "SPY" ? getCloses(proxy, 300).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const score = scoreCompany(company);
  const trend = computeTrend(company.prices, spy, peers, proxy);
  // Prefer industry-peer momentum from the weekly scan; the ETF proxy is the fallback.
  const peerInd = company.profile.industry ? (latest as Snapshot).industries?.[company.profile.industry] : undefined;
  if (trend && peerInd) {
    trend.ind = peerInd.ind;
    trend.industryProxy = `${peerInd.n} ${company.profile.industry} peers`;
  }
  const warnings = [...company.warnings];
  if (!trend) warnings.push("Not enough price history for the trend reading.");
  return {
    profile: company.profile,
    market: company.market,
    score,
    trend,
    quadrant: trend && score.scorable ? quadrant(score.total, trend.state) : undefined,
    summary: summarize(company.profile.name, score, trend),
    annual: company.annual,
    ttm: company.ttm,
    sources: company.sources,
    warnings,
    fetchedAt: company.fetchedAt,
  };
}

export async function analyzeDay(symbol: string): Promise<ShortTermResult> {
  const [daily, intraday] = await Promise.all([getDaily(symbol, 120), getIntraday(symbol).catch(() => [])]);
  if (!daily.length) throw new Error(`No price data for ${symbol}`);
  return analyzeShortTerm(symbol.toUpperCase(), daily, intraday);
}
