import "server-only";
import type { PeriodRow } from "../types";
import { abs, isNum, isoDate, num } from "../util";

/**
 * Financial Modeling Prep adapter — optional second source.
 * Used to extend statement history (10-year checks) and fill fields Yahoo
 * leaves empty. Enabled only when FMP_API_KEY is set.
 */
const BASE = "https://financialmodelingprep.com/stable";

export const fmpEnabled = () => !!process.env.FMP_API_KEY;

async function get(path: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams({ ...params, apikey: process.env.FMP_API_KEY ?? "" });
  const res = await fetch(`${BASE}/${path}?${qs}`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`FMP ${path} ${res.status}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error(`FMP ${path}: ${JSON.stringify(body).slice(0, 160)}`);
  return body as Record<string, unknown>[];
}

/** Free plans cap `limit`; fall back to 5 years if 10 is refused. */
async function statement(path: string, symbol: string) {
  try {
    return await get(path, { symbol, period: "annual", limit: "10" });
  } catch {
    return get(path, { symbol, period: "annual", limit: "5" });
  }
}

/** Key years by period-end date, the same way the Yahoo adapter does, so rows line up. */
const yearOf = (r: Record<string, unknown>) => {
  const d = new Date(String(r.date));
  if (!Number.isNaN(d.getTime())) return d.getUTCFullYear();
  return num(r, "fiscalYear", "calendarYear") ?? 0;
};

export async function fmpAnnual(symbol: string): Promise<PeriodRow[]> {
  const [inc, bal, cf] = await Promise.all([
    statement("income-statement", symbol),
    statement("balance-sheet-statement", symbol).catch(() => []),
    statement("cash-flow-statement", symbol).catch(() => []),
  ]);
  const balBy = new Map(bal.map((r) => [yearOf(r), r]));
  const cfBy = new Map(cf.map((r) => [yearOf(r), r]));

  return inc
    .map((i): PeriodRow => {
      const fy = yearOf(i);
      const b = balBy.get(fy) ?? {};
      const c = cfBy.get(fy) ?? {};
      const equity = num(b, "totalStockholdersEquity");
      const intangibles = num(b, "goodwillAndIntangibleAssets");
      const ocf = num(c, "operatingCashFlow", "netCashProvidedByOperatingActivities");
      const capex = abs(num(c, "capitalExpenditure", "investmentsInPropertyPlantAndEquipment"));
      return {
        fy,
        date: isoDate(String(i.date)),
        revenue: num(i, "revenue"),
        operatingIncome: num(i, "operatingIncome"),
        pretaxIncome: num(i, "incomeBeforeTax"),
        taxProvision: num(i, "incomeTaxExpense"),
        netIncome: num(i, "netIncome"),
        eps: num(i, "epsDiluted", "epsdiluted"),
        dilutedShares: num(i, "weightedAverageShsOutDil"),
        interestExpense: abs(num(i, "interestExpense")),
        ebitda: num(i, "ebitda"),
        da: abs(num(i, "depreciationAndAmortization") ?? num(c, "depreciationAndAmortization")),
        operatingCashFlow: ocf,
        capex,
        freeCashFlow: num(c, "freeCashFlow") ?? (isNum(ocf) && isNum(capex) ? ocf - capex : undefined),
        buybacks: abs(num(c, "commonStockRepurchased")),
        dividendsPaid: abs(num(c, "commonDividendsPaid", "netDividendsPaid", "dividendsPaid")),
        totalDebt: num(b, "totalDebt"),
        equity,
        cash: num(b, "cashAndShortTermInvestments", "cashAndCashEquivalents"),
        totalAssets: num(b, "totalAssets"),
        tangibleBookValue: isNum(equity) ? equity - (intangibles ?? 0) : undefined,
        sharesOutstanding: num(i, "weightedAverageShsOut"),
        sources: ["fmp"],
      };
    })
    .sort((a, b) => a.fy - b.fy);
}
