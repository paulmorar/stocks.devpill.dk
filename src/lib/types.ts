/**
 * Normalized data model. Every provider (Yahoo, FMP, demo) is mapped into
 * these shapes so the scoring engine never touches provider-specific fields.
 * All money values are in the company's reporting currency, absolute units.
 */

export type Source = "yahoo" | "fmp" | "demo";

/** One fiscal year (or the trailing twelve months) of statement data. */
export interface PeriodRow {
  /** Fiscal year the period ends in. For TTM rows this is the year of the latest quarter. */
  fy: number;
  /** ISO date of period end. */
  date: string;
  revenue?: number;
  operatingIncome?: number;
  pretaxIncome?: number;
  taxProvision?: number;
  netIncome?: number;
  /** Diluted EPS. */
  eps?: number;
  dilutedShares?: number;
  interestExpense?: number;
  ebitda?: number;
  /** Depreciation & amortization (positive). */
  da?: number;
  operatingCashFlow?: number;
  /** Capital expenditure (positive number = cash spent). */
  capex?: number;
  freeCashFlow?: number;
  /** Share repurchases (positive = cash spent buying back). */
  buybacks?: number;
  /** Dividends paid (positive = cash paid out). */
  dividendsPaid?: number;
  totalDebt?: number;
  equity?: number;
  cash?: number;
  totalAssets?: number;
  tangibleBookValue?: number;
  sharesOutstanding?: number;
  /** Which providers contributed fields to this row. */
  sources: Source[];
}

export interface PricePoint {
  date: string; // ISO date
  close: number;
  volume?: number;
}

export interface IntradayBar {
  time: string; // ISO timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DailyBar extends IntradayBar {}

export interface CompanyProfile {
  symbol: string;
  name: string;
  currency: string;
  exchange?: string;
  quoteType?: string; // EQUITY, ETF, ...
  sector?: string;
  industry?: string;
  summary?: string;
  website?: string;
}

export interface MarketSnapshot {
  price?: number;
  marketCap?: number;
  /** Fraction: 0.0123 = +1.23%. */
  changePct?: number;
  trailingPE?: number;
  forwardPE?: number;
  trailingEps?: number;
  forwardEps?: number;
  /** Analyst EPS growth expected next fiscal year, as a fraction (0.12 = 12%). */
  epsGrowthNextYear?: number;
  /** Analyst long-term (5y) EPS growth, as a fraction. */
  epsGrowthLongTerm?: number;
  dividendYield?: number;
  priceToBook?: number;
  analystTarget?: number;
  recommendation?: string;
}

export interface CompanyData {
  profile: CompanyProfile;
  market: MarketSnapshot;
  /** Fiscal years, oldest first. */
  annual: PeriodRow[];
  /** Trailing twelve months, if available. */
  ttm?: PeriodRow;
  /** Daily closes, oldest first (~6 years). */
  prices: PricePoint[];
  sources: Source[];
  warnings: string[];
  fetchedAt: string;
}
