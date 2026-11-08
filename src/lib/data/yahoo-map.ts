import type { PeriodRow } from "../types";
import { abs, isNum, isoDate, num } from "../util";

/** Maps yahoo-finance2 fundamentalsTimeSeries rows to PeriodRow. Kept free of network code so it can be unit-tested. */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** fundamentalsTimeSeries keys arrive as `totalRevenue` (v4) or `annualTotalRevenue` (older shapes). */
function f(row: unknown, key: string) {
  return num(row, lowerFirst(key), `annual${key}`, `trailing${key}`, key);
}

export function mapStatementRow(row: Record<string, unknown>): PeriodRow | undefined {
  const date = row.date instanceof Date ? row.date : new Date(String(row.date));
  if (Number.isNaN(date.getTime())) return undefined;
  const r: PeriodRow = {
    fy: date.getUTCFullYear(),
    date: isoDate(date),
    revenue: f(row, "TotalRevenue"),
    operatingIncome: f(row, "OperatingIncome") ?? f(row, "EBIT"),
    pretaxIncome: f(row, "PretaxIncome"),
    taxProvision: f(row, "TaxProvision"),
    netIncome: f(row, "NetIncomeCommonStockholders") ?? f(row, "NetIncome"),
    eps: f(row, "DilutedEPS"),
    dilutedShares: f(row, "DilutedAverageShares"),
    interestExpense: abs(f(row, "InterestExpense") ?? f(row, "InterestExpenseNonOperating")),
    ebitda: f(row, "EBITDA") ?? f(row, "NormalizedEBITDA"),
    da: abs(f(row, "ReconciledDepreciation") ?? f(row, "DepreciationAndAmortization") ?? f(row, "DepreciationAmortizationDepletion")),
    operatingCashFlow: f(row, "OperatingCashFlow"),
    capex: abs(f(row, "CapitalExpenditure")),
    freeCashFlow: f(row, "FreeCashFlow"),
    buybacks: abs(f(row, "RepurchaseOfCapitalStock")),
    dividendsPaid: abs(f(row, "CashDividendsPaid") ?? f(row, "CommonStockDividendPaid")),
    totalDebt: f(row, "TotalDebt"),
    equity: f(row, "StockholdersEquity") ?? f(row, "CommonStockEquity"),
    cash: f(row, "CashCashEquivalentsAndShortTermInvestments") ?? f(row, "CashAndCashEquivalents"),
    totalAssets: f(row, "TotalAssets"),
    tangibleBookValue: f(row, "TangibleBookValue"),
    sharesOutstanding: f(row, "OrdinarySharesNumber") ?? f(row, "ShareIssued"),
    sources: ["yahoo"],
  };
  if (!isNum(r.freeCashFlow) && isNum(r.operatingCashFlow) && isNum(r.capex)) {
    r.freeCashFlow = r.operatingCashFlow - r.capex;
  }
  const hasData = isNum(r.revenue) || isNum(r.netIncome) || isNum(r.totalAssets) || isNum(r.operatingCashFlow);
  return hasData ? r : undefined;
}

/** Collapse rows sharing a fiscal year (Yahoo can return statements as separate rows). */
export function byYear(rows: PeriodRow[]): PeriodRow[] {
  const m = new Map<number, PeriodRow>();
  for (const r of rows) {
    const prev = m.get(r.fy);
    if (!prev) m.set(r.fy, r);
    else {
      const merged = { ...prev } as Record<string, unknown>;
      for (const [k, v] of Object.entries(r)) if (merged[k] === undefined) merged[k] = v;
      if (r.date > prev.date) merged.date = r.date;
      m.set(r.fy, merged as unknown as PeriodRow);
    }
  }
  return [...m.values()].sort((a, b) => a.fy - b.fy);
}

