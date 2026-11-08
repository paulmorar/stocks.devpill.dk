import "server-only";
import type { CompanyData, DailyBar, IntradayBar, PricePoint } from "../types";
import { cached, TTL } from "./cache";
import { demoBenchmark, demoCompany, demoDaily, demoIntraday, DEMO_SYMBOLS, isDemoSymbol } from "./demo";
import { fmpAnnual, fmpEnabled } from "./fmp";
import { mergeAnnual } from "./merge";
import { applySplits } from "./splits";
import { yahooCompany, yahooDaily, yahooIntraday, yahooScreener, yahooSearch, type ScreenId, type ScreenerHit } from "./yahoo";

/**
 * The one entry point the API routes use. Aggregates Yahoo (primary: prices,
 * quotes, recent statements, estimates) with FMP (optional: longer statement
 * history), or serves demo data.
 */

export const demoMode = () => process.env.DEMO_MODE === "1";
const useDemo = (symbol: string) => demoMode() || isDemoSymbol(symbol);

export async function getCompany(symbol: string): Promise<CompanyData> {
  const sym = symbol.toUpperCase();
  if (useDemo(sym)) {
    const d = demoCompany(sym);
    if (!d) throw new Error(`Demo mode: ${sym} isn't a sample company. Try ${DEMO_SYMBOLS.join(", ")}.`);
    return d;
  }
  return cached(`company:${sym}`, TTL.fundamentals, async () => {
    const [y, f] = await Promise.allSettled([
      yahooCompany(sym),
      fmpEnabled() ? fmpAnnual(sym) : Promise.resolve(undefined),
    ]);
    if (y.status === "rejected") throw y.reason;
    const yd = y.value;
    const warnings = [...yd.warnings];
    let annual = yd.annual;
    const sources = [...yd.sources];
    if (f.status === "fulfilled" && f.value?.length) {
      annual = mergeAnnual(yd.annual, applySplits(f.value, yd.splits));
      sources.push("fmp");
    } else if (f.status === "rejected") {
      warnings.push(`FMP unavailable (${String((f.reason as Error)?.message ?? f.reason).slice(0, 80)}); using Yahoo only.`);
    }
    if (!fmpEnabled() && annual.length < 10) {
      warnings.push(`Only ${annual.length} fiscal years from Yahoo; add FMP_API_KEY for the 10-year checks.`);
    }
    const { splits: _s, ...rest } = yd;
    return { ...rest, annual, sources, warnings, fetchedAt: new Date().toISOString() };
  });
}

export async function getCloses(symbol: string, days: number): Promise<PricePoint[]> {
  const sym = symbol.toUpperCase();
  if (useDemo(sym)) {
    const c = demoCompany(sym);
    return c ? c.prices.slice(-days) : demoBenchmark(sym.length * 97 + (sym.charCodeAt(0) ?? 0), days);
  }
  return cached(`closes:${sym}:${days}`, TTL.prices, async () => {
    const bars = await yahooDaily(sym, Math.ceil(days * 1.5));
    return bars.map((b) => ({ date: b.time.slice(0, 10), close: b.close, volume: b.volume })).slice(-days);
  });
}

export async function getDaily(symbol: string, days = 120): Promise<DailyBar[]> {
  const sym = symbol.toUpperCase();
  if (useDemo(sym)) return demoDaily(sym, days);
  return cached(`daily:${sym}:${days}`, TTL.prices, async () => (await yahooDaily(sym, Math.ceil(days * 1.5))).slice(-days));
}

export async function getIntraday(symbol: string): Promise<IntradayBar[]> {
  const sym = symbol.toUpperCase();
  if (useDemo(sym)) return demoIntraday(sym);
  return cached(`intraday:${sym}`, TTL.intraday, async () => (await yahooIntraday(sym)).bars);
}

export async function getScreen(id: ScreenId, count = 25): Promise<ScreenerHit[]> {
  if (demoMode()) {
    return DEMO_SYMBOLS.map((s) => {
      const c = demoCompany(s);
      return { symbol: s, name: c?.profile.name ?? s, price: c?.market.price, changePct: c?.market.changePct, marketCap: c?.market.marketCap };
    });
  }
  return cached(`screen:${id}:${count}`, TTL.screener, () => yahooScreener(id, count));
}

export async function search(query: string) {
  if (demoMode()) {
    const q = query.toUpperCase();
    return DEMO_SYMBOLS.filter((s) => s.includes(q) || demoCompany(s)?.profile.name.toUpperCase().includes(q)).map((s) => ({
      symbol: s, name: demoCompany(s)?.profile.name ?? s, exchange: "DEMO", type: "EQUITY",
    }));
  }
  return cached(`search:${query.toLowerCase()}`, TTL.screener, () => yahooSearch(query));
}

export type { ScreenId, ScreenerHit };
export { DEMO_SYMBOLS };
