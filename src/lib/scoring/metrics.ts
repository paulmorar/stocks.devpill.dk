import type { CompanyData, PeriodRow, PricePoint } from "../types";
import { cagr, clamp, isNum, median } from "../util";

/**
 * Derived series the checks read from. Built once per company.
 * "Flows" (revenue, profit, cash flow) include the trailing twelve months as
 * the newest point when it's newer than the last annual report — the
 * methodology's "latest 12 months, not just the last annual report" rule.
 */
export interface Metrics {
  annual: PeriodRow[];
  /** Annual rows plus TTM (if newer), oldest first. */
  flows: PeriodRow[];
  /** Newest flow row (TTM or last annual). */
  latestFlow?: PeriodRow;
  /** Newest balance-sheet row (TTM rarely has one, so this is usually the last annual). */
  latestBalance?: PeriodRow;
  price?: number;
  marketCap?: number;
  capexMode: boolean;
}

export function buildMetrics(c: CompanyData): Metrics {
  const annual = [...c.annual].sort((a, b) => a.fy - b.fy);
  const last = annual.at(-1);
  const flows = [...annual];
  if (c.ttm && (!last || c.ttm.date > last.date)) {
    // Fractional fiscal year so growth spans stay honest (TTM ending 7 months after FY2025 = 2025.58).
    const fy = last ? last.fy + (Date.parse(c.ttm.date) - Date.parse(last.date)) / (365.25 * 86400000) : c.ttm.fy;
    if (!last || fy - last.fy > 0.2) flows.push({ ...c.ttm, fy });
  }
  const latestFlow = flows.at(-1);
  const latestBalance = [...annual].reverse().find((r) => isNum(r.equity) || isNum(r.totalAssets)) ?? last;

  // CAPEX mode: spending more than 2x depreciation in the latest period.
  const capexRef = latestFlow && isNum(latestFlow.capex) && isNum(latestFlow.da) ? latestFlow : last;
  const capexMode = !!capexRef && isNum(capexRef.capex) && isNum(capexRef.da) && capexRef.da > 0 && capexRef.capex > 2 * capexRef.da;

  return {
    annual,
    flows,
    latestFlow,
    latestBalance,
    price: c.market.price ?? c.prices.at(-1)?.close,
    marketCap: c.market.marketCap,
    capexMode,
  };
}

/** Close on or just before a date (prices sorted oldest first). */
export function closeAt(prices: PricePoint[], date: string): number | undefined {
  let lo = 0;
  let hi = prices.length - 1;
  let ans: number | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = prices[mid] as PricePoint;
    if (p.date <= date) {
      ans = p.close;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export const strictFcf = (r: PeriodRow) =>
  isNum(r.freeCashFlow) ? r.freeCashFlow : isNum(r.operatingCashFlow) && isNum(r.capex) ? r.operatingCashFlow - r.capex : undefined;

/** Cash flow after maintenance spending only (estimated as depreciation). */
export const maintenanceFcf = (r: PeriodRow) =>
  isNum(r.operatingCashFlow) && isNum(r.da) ? r.operatingCashFlow - Math.min(r.da, r.capex ?? r.da) : strictFcf(r);

export function taxRate(r: PeriodRow) {
  if (isNum(r.taxProvision) && isNum(r.pretaxIncome) && r.pretaxIncome > 0) return clamp(r.taxProvision / r.pretaxIncome, 0, 0.35);
  return 0.21;
}

export function roic(r: PeriodRow, balance: PeriodRow = r) {
  if (!isNum(r.operatingIncome)) return undefined;
  const debt = balance.totalDebt ?? 0;
  const equity = balance.equity;
  if (!isNum(equity)) return undefined;
  let invested = debt + equity - (balance.cash ?? 0);
  if (invested <= 0) invested = debt + equity;
  if (invested <= 0) return undefined;
  return (r.operatingIncome * (1 - taxRate(r))) / invested;
}

export function roe(r: PeriodRow, balance: PeriodRow = r) {
  if (!isNum(r.netIncome) || !isNum(balance.equity) || balance.equity <= 0) return undefined;
  return r.netIncome / balance.equity;
}

/** Values of one field across rows, keeping only finite numbers, with their row. */
export function series(rows: PeriodRow[], pick: (r: PeriodRow) => number | undefined) {
  return rows.map((r) => ({ r, v: pick(r) })).filter((x): x is { r: PeriodRow; v: number } => isNum(x.v));
}

/** CAGR between the oldest and newest point at most `years` apart. */
export function cagrOver(points: { r: PeriodRow; v: number }[], years: number) {
  if (points.length < 2) return undefined;
  const end = points.at(-1) as { r: PeriodRow; v: number };
  const target = end.r.fy - years;
  const start = points.find((p) => p.r.fy >= target) ?? points[0];
  if (!start || start === end) return undefined;
  const span = end.r.fy - start.r.fy;
  if (span < 1) return undefined;
  const g = cagr(start.v, end.v, span);
  return g === undefined ? undefined : { g, span, start: start.v, end: end.v };
}

/** Yearly P/E at each fiscal year end, over the last `years`. */
export function peHistory(m: Metrics, prices: PricePoint[], years = 5) {
  const out: number[] = [];
  for (const r of m.annual.slice(-years)) {
    const px = closeAt(prices, r.date);
    if (isNum(px) && isNum(r.eps) && r.eps > 0) out.push(px / r.eps);
  }
  return out;
}

export function currentPE(c: CompanyData, m: Metrics) {
  const eps = c.market.trailingEps ?? m.latestFlow?.eps;
  if (isNum(m.price) && isNum(eps) && eps > 0) return m.price / eps;
  if (isNum(c.market.trailingPE) && c.market.trailingPE > 0) return c.market.trailingPE;
  return undefined;
}

export { median };
