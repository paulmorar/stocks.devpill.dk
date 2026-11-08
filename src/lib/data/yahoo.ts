import "server-only";
import YahooFinance from "yahoo-finance2";
import type { CompanyData, DailyBar, IntradayBar, PeriodRow, PricePoint } from "../types";
import { isNum, isoDate, num } from "../util";
import { byYear, mapStatementRow } from "./yahoo-map";
import { applySplits, type Split } from "./splits";

/**
 * Yahoo Finance adapter — the successor of the netlify-lambda proxy in
 * paulmorar/how-is-my-stock-doing, using the maintained yahoo-finance2 library.
 * Runs server-side only: Yahoo needs cookies/crumbs and blocks browser CORS.
 */
const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  queue: { concurrency: 4 },
});

async function statements(symbol: string, type: "annual" | "trailing"): Promise<PeriodRow[]> {
  const period1 = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * (type === "annual" ? 12 : 2));
  const rows = (await yf.fundamentalsTimeSeries(symbol, { period1, type, module: "all" })) as unknown as Record<
    string,
    unknown
  >[];
  return byYear(rows.map(mapStatementRow).filter((r): r is PeriodRow => !!r));
}

export async function yahooCompany(symbol: string): Promise<Omit<CompanyData, "fetchedAt"> & { splits: Split[] }> {
  const warnings: string[] = [];
  const [summary, annualRes, ttmRes, chart] = await Promise.allSettled([
    yf.quoteSummary(symbol, {
      modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "earningsTrend", "assetProfile", "quoteType"],
    }),
    statements(symbol, "annual"),
    statements(symbol, "trailing"),
    yf.chart(symbol, {
      period1: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 6.5),
      interval: "1d",
      events: "split",
    }),
  ]);

  if (summary.status === "rejected") throw new Error(`Yahoo has no quote for ${symbol}: ${String(summary.reason?.message ?? summary.reason)}`);
  const s = summary.value as Record<string, any>;
  const price = s.price ?? {};
  const detail = s.summaryDetail ?? {};
  const stats = s.defaultKeyStatistics ?? {};
  const fin = s.financialData ?? {};
  const prof = s.assetProfile ?? {};
  const trend: any[] = s.earningsTrend?.trend ?? [];
  const growthFor = (period: string) => num(trend.find((t) => t?.period === period), "growth");

  let prices: PricePoint[] = [];
  let splits: Split[] = [];
  if (chart.status === "fulfilled") {
    prices = chart.value.quotes
      .filter((q) => isNum(q.close))
      .map((q) => ({ date: isoDate(q.date), close: q.close as number, volume: q.volume ?? undefined }));
    splits = (chart.value.events?.splits ?? []).map((sp) => ({
      date: isoDate(sp.date),
      ratio: sp.numerator / sp.denominator,
    }));
  } else warnings.push("Price history unavailable from Yahoo.");

  let annual: PeriodRow[] = [];
  if (annualRes.status === "fulfilled") annual = applySplits(annualRes.value, splits);
  else warnings.push("Annual statements unavailable from Yahoo.");

  let ttm: PeriodRow | undefined;
  if (ttmRes.status === "fulfilled" && ttmRes.value.length) {
    ttm = applySplits(ttmRes.value, splits).at(-1);
  }

  return {
    profile: {
      symbol: symbol.toUpperCase(),
      name: price.longName ?? price.shortName ?? symbol.toUpperCase(),
      currency: fin.financialCurrency ?? price.currency ?? "USD",
      exchange: price.exchangeName,
      quoteType: s.quoteType?.quoteType ?? price.quoteType,
      sector: prof.sector,
      industry: prof.industry,
      summary: prof.longBusinessSummary,
      website: prof.website,
    },
    market: {
      price: num(price, "regularMarketPrice") ?? num(fin, "currentPrice"),
      marketCap: num(price, "marketCap") ?? num(detail, "marketCap"),
      changePct: num(price, "regularMarketChangePercent"), // quoteSummary.price: fraction (0.0123)
      trailingPE: num(detail, "trailingPE"),
      forwardPE: num(detail, "forwardPE") ?? num(stats, "forwardPE"),
      trailingEps: num(stats, "trailingEps"),
      forwardEps: num(stats, "forwardEps"),
      epsGrowthNextYear: growthFor("+1y"),
      epsGrowthLongTerm: growthFor("+5y") ?? growthFor("LTG"),
      dividendYield: num(detail, "dividendYield"),
      priceToBook: num(stats, "priceToBook"),
      analystTarget: num(fin, "targetMeanPrice"),
      recommendation: fin.recommendationKey,
    },
    annual,
    ttm,
    prices,
    splits,
    sources: ["yahoo"],
    warnings,
  };
}

function toBars(quotes: Array<Record<string, unknown>>): IntradayBar[] {
  return quotes
    .filter((q) => isNum(q.close) && isNum(q.open) && isNum(q.high) && isNum(q.low))
    .map((q) => ({
      time: new Date(q.date as Date).toISOString(),
      open: q.open as number,
      high: q.high as number,
      low: q.low as number,
      close: q.close as number,
      volume: isNum(q.volume) ? q.volume : 0,
    }));
}

export async function yahooDaily(symbol: string, days: number): Promise<DailyBar[]> {
  const res = await yf.chart(symbol, { period1: new Date(Date.now() - days * 86400000), interval: "1d" });
  return toBars(res.quotes as unknown as Array<Record<string, unknown>>);
}

/** 5-minute bars for the most recent session (looks back 5 days to cover weekends/holidays). */
export async function yahooIntraday(symbol: string): Promise<{ bars: IntradayBar[]; meta: Record<string, unknown> }> {
  const res = await yf.chart(symbol, {
    period1: new Date(Date.now() - 5 * 86400000),
    interval: "5m",
    includePrePost: false,
  });
  const bars = toBars(res.quotes as unknown as Array<Record<string, unknown>>);
  const lastDay = bars.at(-1)?.time.slice(0, 10);
  return { bars: bars.filter((b) => b.time.slice(0, 10) === lastDay), meta: res.meta as unknown as Record<string, unknown> };
}

export interface ScreenerHit {
  symbol: string;
  name: string;
  price?: number;
  changePct?: number;
  volume?: number;
  avgVolume?: number;
  marketCap?: number;
}

export type ScreenId =
  | "day_gainers"
  | "day_losers"
  | "most_actives"
  | "undervalued_large_caps"
  | "undervalued_growth_stocks"
  | "growth_technology_stocks"
  | "portfolio_anchors"
  | "aggressive_small_caps"
  | "small_cap_gainers";

export async function yahooScreener(scrIds: ScreenId, count = 25): Promise<ScreenerHit[]> {
  const res = await yf.screener({ scrIds, count });
  return (res.quotes ?? [])
    .filter((q) => q.quoteType === "EQUITY")
    .map((q) => {
      const r = q as unknown as Record<string, unknown>;
      return {
        symbol: q.symbol,
        name: String(r.shortName ?? r.longName ?? q.symbol),
        price: num(r, "regularMarketPrice"),
        // Screener/quote endpoints report percent (1.23); normalize to a fraction like quoteSummary.
        changePct: ((v) => (v === undefined ? undefined : v / 100))(num(r, "regularMarketChangePercent")),
        volume: num(r, "regularMarketVolume"),
        avgVolume: num(r, "averageDailyVolume3Month", "averageDailyVolume10Day"),
        marketCap: num(r, "marketCap"),
      };
    });
}

export async function yahooSearch(query: string) {
  const res = await yf.search(query, { quotesCount: 8, newsCount: 0 });
  return (res.quotes ?? [])
    .map((q) => q as unknown as Record<string, unknown>)
    .filter((q) => q.isYahooFinance && (q.quoteType === "EQUITY" || q.quoteType === "ETF"))
    .map((q) => ({
      symbol: String(q.symbol),
      name: String(q.shortname ?? q.longname ?? q.symbol),
      exchange: String(q.exchDisp ?? q.exchange ?? ""),
      type: String(q.quoteType),
    }));
}
