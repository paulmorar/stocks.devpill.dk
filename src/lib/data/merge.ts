import type { PeriodRow, Source } from "../types";

const FIELDS = [
  "revenue", "operatingIncome", "pretaxIncome", "taxProvision", "netIncome", "eps", "dilutedShares",
  "interestExpense", "ebitda", "da", "operatingCashFlow", "capex", "freeCashFlow", "buybacks",
  "dividendsPaid", "totalDebt", "equity", "cash", "totalAssets", "tangibleBookValue", "sharesOutstanding",
] as const satisfies readonly (keyof PeriodRow)[];

/**
 * Merge annual rows from several providers by fiscal year.
 * The first list wins field-by-field; later lists only fill gaps and add
 * years the first one doesn't have. Each row records which sources contributed.
 */
export function mergeAnnual(...lists: PeriodRow[][]): PeriodRow[] {
  const byYear = new Map<number, PeriodRow>();
  for (const list of lists) {
    for (const row of list) {
      const cur = byYear.get(row.fy);
      if (!cur) {
        byYear.set(row.fy, { ...row, sources: [...row.sources] });
        continue;
      }
      let used = false;
      for (const k of FIELDS) {
        if (cur[k] === undefined && row[k] !== undefined) {
          (cur as unknown as Record<string, unknown>)[k] = row[k];
          used = true;
        }
      }
      if (used) cur.sources = [...new Set<Source>([...cur.sources, ...row.sources])];
    }
  }
  return [...byYear.values()].sort((a, b) => a.fy - b.fy);
}
