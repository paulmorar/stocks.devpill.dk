import "server-only";
import type { CompanyData, CompanyProfile, DailyBar, IntradayBar, PeriodRow, PricePoint } from "../types";
import { currencyUnit } from "../util";
import { cached, TTL } from "./cache";
import { demoBenchmark, demoCompany, demoDaily, demoIntraday, DEMO_SYMBOLS, isDemoSymbol } from "./demo";
import { fmpAnnual, fmpEnabled } from "./fmp";
import { mergeAnnual } from "./merge";
import { secCompanyFacts } from "./sec";
import { secAnnual } from "./sec-facts";
import { secUserAgent } from "./sec-map";
import { applySplits } from "./splits";
import { yahooCompany, yahooDaily, yahooFx, yahooIntraday, yahooScreener, yahooSearch, type ScreenId, type ScreenerHit } from "./yahoo";

/**
 * The one entry point the API routes use. Aggregates Yahoo (primary: prices, quotes, recent statements, estimates)
 * with SEC EDGAR (older annual figures of US companies) and FMP (optional: longer statement history), or serves
 * demo data.
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
    const [y, f, s] = await Promise.allSettled([
      yahooCompany(sym),
      fmpEnabled() ? fmpAnnual(sym) : Promise.resolve(undefined),
      secCompanyFacts(sym),
    ]);
    if (y.status === "rejected") throw y.reason;
    const yd = y.value;
    const warnings = [...yd.warnings];
    const sources = [...yd.sources];
    // Yahoo wins field by field; SEC fills gaps and adds older years (only figures that join Yahoo's), FMP the rest.
    const secRows = s.status === "fulfilled" && s.value ? secAnnual(s.value, yd.annual, yd.profile.currency, yd.profile.listedSince) : [];
    const lists: PeriodRow[][] = [yd.annual, secRows];
    if (s.status === "rejected") warnings.push(`SEC EDGAR unavailable (${String((s.reason as Error)?.message ?? s.reason).slice(0, 80)}); using Yahoo's reports only.`);
    if (f.status === "fulfilled" && f.value?.length) {
      lists.push(applySplits(f.value, yd.splits));
      sources.push("fmp");
    } else if (f.status === "rejected") {
      warnings.push(`FMP unavailable (${String((f.reason as Error)?.message ?? f.reason).slice(0, 80)}); using Yahoo only.`);
    }
    const annual = mergeAnnual(...lists);
    if (annual.some((r) => r.sources.includes("sec"))) sources.push("sec");
    if (annual.length < 10 && annual.length === yd.annual.length && s.status === "fulfilled" && !sources.includes("fmp")) {
      const why = !s.value
        ? secUserAgent()
          ? "There is no SEC company number on file for it (we keep them for the S&P 500 and Nasdaq-100), so SEC EDGAR can't add older years."
          : "Set SEC_USER_AGENT to add up to 10 years from SEC EDGAR."
        : secRows.length
          ? "SEC EDGAR has no comparable older years for it, for example after a spin-off or a sale."
          : "SEC EDGAR has no US-GAAP figures for it that match Yahoo's, so they weren't used.";
      warnings.push(`Only ${annual.length} fiscal years of reports. ${why}`);
    }
    const fx = await exchangeRates(yd.profile, warnings);
    const { splits: _s, ...rest } = yd;
    return { ...rest, annual, sources, warnings, fx, fetchedAt: new Date().toISOString() };
  });
}

/** Rates for converting the share price into the reporting currency, e.g. pounds into dollars for HSBA.L. */
async function exchangeRates(p: CompanyProfile, warnings: string[]): Promise<CompanyData["fx"]> {
  const from = currencyUnit(p.tradingCurrency ?? p.currency).main;
  if (from === p.currency) return undefined;
  const rates = await cached(`fx:${from}${p.currency}`, TTL.prices, () => yahooFx(from, p.currency)).catch(() => []);
  if (rates.length) return { from, to: p.currency, rates };
  warnings.push(`No ${from} to ${p.currency} exchange rate from Yahoo, so checks that compare the share price with the reports were skipped.`);
  return undefined;
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
