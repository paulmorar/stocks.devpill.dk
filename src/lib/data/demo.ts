import type { CompanyData, DailyBar, IntradayBar, PeriodRow, PricePoint } from "../types";
import { isoDate } from "../util";

/**
 * Synthetic sample companies. Fictional names and tickers, made-up numbers —
 * they exist so the UI and scoring can be exercised offline and in tests.
 * Each one is shaped to land in a different part of the methodology.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Spec {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  summary: string;
  seed: number;
  rev0: number; // revenue 10 years ago
  revGrowth: number;
  opMargin: number;
  marginDrift: number; // per year
  netMarginOfOp: number;
  ocfOfNi: number;
  capexOfRev: number;
  daOfRev: number;
  debtOfEquity: number;
  equityOfRev: number;
  shareDrift: number; // per year
  interestRate: number;
  pe: number;
  /** Price path: drift per day for the older part and the recent part. */
  drift: [number, number];
  /** How many recent sessions use the second drift (default 120). */
  recentDays?: number;
  vol: number;
  bank?: boolean;
  lossLastYear?: boolean;
}

const SPECS: Spec[] = [
  {
    symbol: "NWSW", name: "Northwind Software (demo)", sector: "Technology", industry: "Software - Application",
    summary: "Fictional subscription software company used for demos.",
    seed: 11, rev0: 8e9, revGrowth: 0.14, opMargin: 0.3, marginDrift: 0.004, netMarginOfOp: 0.8, ocfOfNi: 1.25,
    capexOfRev: 0.03, daOfRev: 0.04, debtOfEquity: 0.35, equityOfRev: 0.9, shareDrift: -0.015, interestRate: 0.035,
    pe: 27, drift: [0.0007, 0.0009], vol: 0.014,
  },
  {
    symbol: "CTSB", name: "Contoso Bank (demo)", sector: "Financial Services", industry: "Banks - Diversified",
    summary: "Fictional diversified bank used to show the financials scorecard.",
    seed: 23, rev0: 30e9, revGrowth: 0.05, opMargin: 0.34, marginDrift: 0, netMarginOfOp: 0.79, ocfOfNi: 1.1,
    capexOfRev: 0.02, daOfRev: 0.02, debtOfEquity: 1.2, equityOfRev: 2.4, shareDrift: -0.02, interestRate: 0.03,
    pe: 11, drift: [0.0004, -0.0012], vol: 0.013, bank: true,
  },
  {
    symbol: "FBCL", name: "Fabrikam Cloud (demo)", sector: "Communication Services", industry: "Internet Content & Information",
    summary: "Fictional hyperscaler spending heavily on data centers (CAPEX mode).",
    seed: 37, rev0: 60e9, revGrowth: 0.16, opMargin: 0.3, marginDrift: 0.003, netMarginOfOp: 0.85, ocfOfNi: 1.5,
    capexOfRev: 0.26, daOfRev: 0.09, debtOfEquity: 0.15, equityOfRev: 1.1, shareDrift: -0.01, interestRate: 0.04,
    pe: 24, drift: [0.0006, 0.0011], vol: 0.016,
  },
  {
    symbol: "TSRT", name: "Tailspin Retail (demo)", sector: "Consumer Cyclical", industry: "Specialty Retail",
    summary: "Fictional struggling retailer: losses, dilution, thin interest cover (red flags).",
    seed: 41, rev0: 12e9, revGrowth: -0.01, opMargin: 0.05, marginDrift: -0.008, netMarginOfOp: 0.6, ocfOfNi: 0.7,
    capexOfRev: 0.05, daOfRev: 0.04, debtOfEquity: 2.4, equityOfRev: 0.25, shareDrift: 0.06, interestRate: 0.07,
    pe: 14, drift: [-0.0003, -0.0016], vol: 0.025, lossLastYear: true,
  },
  {
    symbol: "ADTM", name: "Adatum Semiconductors (demo)", sector: "Technology", industry: "Semiconductors",
    summary: "Fictional chipmaker coming back after a long slump (Recovering trend).",
    seed: 53, rev0: 15e9, revGrowth: 0.09, opMargin: 0.22, marginDrift: -0.002, netMarginOfOp: 0.85, ocfOfNi: 1.15,
    capexOfRev: 0.08, daOfRev: 0.07, debtOfEquity: 0.45, equityOfRev: 1.0, shareDrift: 0.005, interestRate: 0.04,
    pe: 19, drift: [-0.0012, 0.0065], vol: 0.018, recentDays: 40,
  },
  {
    symbol: "LTWR", name: "Litware Health (demo)", sector: "Healthcare", industry: "Drug Manufacturers - General",
    summary: "Fictional pharma: solid but slow, cheap versus its own history.",
    seed: 67, rev0: 40e9, revGrowth: 0.035, opMargin: 0.26, marginDrift: -0.001, netMarginOfOp: 0.82, ocfOfNi: 1.2,
    capexOfRev: 0.04, daOfRev: 0.05, debtOfEquity: 0.7, equityOfRev: 0.8, shareDrift: -0.008, interestRate: 0.035,
    pe: 13, drift: [0.0002, -0.0004], vol: 0.012,
  },
];

export const DEMO_SYMBOLS = SPECS.map((s) => s.symbol);
export const isDemoSymbol = (s: string) => DEMO_SYMBOLS.includes(s.toUpperCase());

function pricePath(spec: Spec, days: number, endPrice: number): PricePoint[] {
  const r = rng(spec.seed * 7);
  const rets: number[] = [];
  for (let i = 0; i < days; i++) {
    const d = i > days - (spec.recentDays ?? 120) ? spec.drift[1] : spec.drift[0];
    rets.push(d + (r() - 0.5) * 2 * spec.vol);
  }
  const out: PricePoint[] = [];
  let p = endPrice;
  const today = new Date();
  // Walk backwards from today's price so the last close equals endPrice.
  const closes: number[] = [p];
  for (let i = days - 1; i > 0; i--) {
    p = p / (1 + (rets[i] as number));
    closes.unshift(p);
  }
  let d = new Date(today);
  const dates: string[] = [];
  while (dates.length < days) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.unshift(isoDate(d));
    d = new Date(d.getTime() - 86400000);
  }
  closes.forEach((c, i) => out.push({ date: dates[i] as string, close: +c.toFixed(2), volume: Math.round(5e6 * (0.6 + r())) }));
  return out;
}

function build(spec: Spec): CompanyData {
  const r = rng(spec.seed);
  const thisYear = new Date().getUTCFullYear();
  const annual: PeriodRow[] = [];
  let shares = 1e9;
  for (let i = 0; i < 10; i++) {
    const fy = thisYear - 10 + i;
    const noise = 1 + (r() - 0.5) * 0.06;
    const revenue = spec.rev0 * (1 + spec.revGrowth) ** i * noise;
    const opMargin = spec.opMargin + spec.marginDrift * i + (r() - 0.5) * 0.02;
    const operatingIncome = revenue * opMargin;
    let netIncome = operatingIncome * spec.netMarginOfOp;
    if (spec.lossLastYear && i === 9) netIncome = -Math.abs(revenue * 0.02);
    const capexBoost = spec.symbol === "FBCL" && i >= 8 ? 1.8 : 1;
    const capex = revenue * spec.capexOfRev * capexBoost * (1 + (r() - 0.5) * 0.1);
    const da = revenue * spec.daOfRev;
    const ocf = Math.max(netIncome, operatingIncome * 0.6) * spec.ocfOfNi * (spec.lossLastYear && i >= 8 ? 0.4 : 1);
    const equity = revenue * spec.equityOfRev;
    const totalDebt = equity * spec.debtOfEquity;
    shares *= 1 + spec.shareDrift;
    const totalAssets = spec.bank ? equity * 11 : equity + totalDebt + revenue * 0.4;
    annual.push({
      fy,
      date: `${fy}-12-31`,
      revenue,
      operatingIncome,
      pretaxIncome: operatingIncome * 0.97,
      taxProvision: operatingIncome * 0.97 - netIncome,
      netIncome,
      eps: netIncome / shares,
      dilutedShares: shares,
      interestExpense: spec.bank ? undefined : totalDebt * spec.interestRate,
      ebitda: operatingIncome + da,
      da,
      operatingCashFlow: ocf,
      capex,
      freeCashFlow: ocf - capex,
      buybacks: spec.shareDrift < 0 ? Math.abs(spec.shareDrift) * shares * 50 : 0,
      dividendsPaid: Math.max(0, netIncome * 0.3),
      totalDebt,
      equity,
      cash: revenue * 0.15,
      totalAssets,
      tangibleBookValue: equity * 0.8,
      sharesOutstanding: shares,
      sources: ["demo"],
    });
  }
  const last = annual.at(-1) as PeriodRow;
  const ttm: PeriodRow = { ...last, fy: thisYear, date: isoDate(new Date()), revenue: (last.revenue ?? 0) * (1 + spec.revGrowth / 2) };
  const eps = (last.netIncome ?? 0) / shares;
  const price = Math.max(5, eps > 0 ? eps * spec.pe : 18);
  const prices = pricePath(spec, 1560, +price.toFixed(2));
  const growth = spec.revGrowth * 1.1;
  return {
    profile: {
      symbol: spec.symbol, name: spec.name, currency: "USD", exchange: "DEMO", quoteType: "EQUITY",
      sector: spec.sector, industry: spec.industry, summary: spec.summary,
    },
    market: {
      price,
      marketCap: price * shares,
      changePct: (r() - 0.45) * 0.03,
      trailingPE: eps > 0 ? price / eps : undefined,
      forwardPE: eps > 0 ? price / (eps * (1 + growth)) : undefined,
      trailingEps: eps,
      forwardEps: eps * (1 + growth),
      epsGrowthNextYear: growth,
      epsGrowthLongTerm: growth,
      dividendYield: Math.max(0, (last.dividendsPaid ?? 0) / (price * shares)),
      priceToBook: (price * shares) / (last.equity ?? 1),
    },
    annual,
    ttm,
    prices,
    sources: ["demo"],
    warnings: ["Demo company: fictional name and made-up numbers."],
    fetchedAt: new Date().toISOString(),
  };
}

const cache = new Map<string, CompanyData>();
export function demoCompany(symbol: string): CompanyData | undefined {
  const spec = SPECS.find((s) => s.symbol === symbol.toUpperCase());
  if (!spec) return undefined;
  if (!cache.has(spec.symbol)) cache.set(spec.symbol, build(spec));
  return cache.get(spec.symbol);
}

/** A benchmark line for demo mode (stands in for SPY and industry ETFs). */
export function demoBenchmark(seed: number, days: number): PricePoint[] {
  const spec: Spec = { ...(SPECS[0] as Spec), seed, drift: [0.0004, 0.0004], vol: 0.009 };
  return pricePath(spec, days, 500);
}

export function demoDaily(symbol: string, days: number): DailyBar[] {
  const c = demoCompany(symbol);
  const pts = c ? c.prices.slice(-days) : demoBenchmark(symbol.length * 13, days);
  const r = rng(symbol.charCodeAt(0) * 31);
  return pts.map((p, i) => {
    const prev = pts[i - 1]?.close ?? p.close;
    const open = prev * (1 + (r() - 0.5) * 0.01);
    return {
      time: `${p.date}T20:00:00.000Z`,
      open,
      high: Math.max(open, p.close) * (1 + r() * 0.01),
      low: Math.min(open, p.close) * (1 - r() * 0.01),
      close: p.close,
      volume: p.volume ?? 4e6,
    };
  });
}

export function demoIntraday(symbol: string): IntradayBar[] {
  const daily = demoDaily(symbol, 30);
  const prevClose = daily.at(-2)?.close ?? 100;
  const r = rng(symbol.charCodeAt(1) * 17 + 3);
  const gap = (r() - 0.35) * 0.08;
  let p = prevClose * (1 + gap);
  const day = isoDate(new Date());
  const bars: IntradayBar[] = [];
  const start = Date.parse(`${day}T14:30:00.000Z`);
  for (let i = 0; i < 60; i++) {
    const o = p;
    p = p * (1 + (r() - 0.48) * 0.006);
    bars.push({
      time: new Date(start + i * 300000).toISOString(),
      open: o,
      high: Math.max(o, p) * (1 + r() * 0.002),
      low: Math.min(o, p) * (1 - r() * 0.002),
      close: p,
      volume: Math.round((i < 6 ? 150000 : 45000) * (0.5 + r()) * (Math.abs(gap) > 0.03 ? 3 : 1)),
    });
  }
  return bars;
}
