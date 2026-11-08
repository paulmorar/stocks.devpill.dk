import type { PricePoint } from "./types";
import { isNum } from "./util";
import type { Explain } from "./scoring/types";

/**
 * Trend reading, built from the 200-day moving average. It describes what the
 * market is doing and is never blended into the business score.
 */
export type TrendState = "Uptrend" | "Recovering" | "Mixed" | "Weakening" | "Downtrend";

export interface TrendResult {
  state: TrendState;
  price: number;
  ma50: number;
  ma200: number;
  ma200Rising: boolean;
  /** Share of the last ~6 months spent below the 200-day. */
  belowShare6m: number;
  /** 12-month return minus S&P 500's, skipping the most recent month. */
  rs?: number;
  /** Industry peers' 6-month return minus S&P 500's. */
  ind?: number;
  industryProxy?: string;
  explain: Explain;
  /** Recent closes with moving averages, for the chart (last ~260 sessions). */
  chart: { date: string; close: number; ma50?: number; ma200?: number }[];
}

function smaAt(closes: number[], end: number, n: number) {
  if (end + 1 < n) return undefined;
  let s = 0;
  for (let i = end - n + 1; i <= end; i++) s += closes[i] as number;
  return s / n;
}

/** Industry ETFs used as the "peers" proxy for Ind. Falls back to the sector SPDR. */
const INDUSTRY_ETF: [RegExp, string][] = [
  [/software/i, "IGV"],
  [/semiconductor/i, "SOXX"],
  [/banks - regional/i, "KRE"],
  [/bank/i, "KBE"],
  [/insurance/i, "KIE"],
  [/capital markets|asset management/i, "IAI"],
  [/biotech/i, "XBI"],
  [/drug manufacturers|pharma/i, "XPH"],
  [/medical (devices|instruments)/i, "IHI"],
  [/health(care)? (plans|information)|medical care/i, "IHF"],
  [/oil & gas e&p/i, "XOP"],
  [/oil & gas (equipment|drilling)/i, "XES"],
  [/internet (content|retail)/i, "FDN"],
  [/aerospace|defense/i, "ITA"],
  [/residential construction|homebuild/i, "XHB"],
  [/retail|department stores|apparel/i, "XRT"],
  [/airlines/i, "JETS"],
  [/solar/i, "TAN"],
  [/gold/i, "GDX"],
  [/steel|metals|mining/i, "XME"],
  [/railroads|trucking|freight|logistics/i, "IYT"],
  [/restaurants/i, "PEJ"],
  [/telecom/i, "IYZ"],
  [/utilities/i, "XLU"],
];
const SECTOR_ETF: Record<string, string> = {
  Technology: "XLK", "Financial Services": "XLF", Healthcare: "XLV", "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP", Energy: "XLE", Industrials: "XLI", "Basic Materials": "XLB",
  "Real Estate": "XLRE", Utilities: "XLU", "Communication Services": "XLC",
};

export function industryProxy(industry?: string, sector?: string) {
  for (const [re, etf] of INDUSTRY_ETF) if (industry && re.test(industry)) return etf;
  return (sector && SECTOR_ETF[sector]) || "SPY";
}

/** Return between two offsets from the end (in trading sessions), aligned to the series' own dates. */
function windowReturn(series: PricePoint[], fromBack: number, toBack: number) {
  const n = series.length;
  const a = series[n - 1 - fromBack]?.close;
  const b = series[n - 1 - toBack]?.close;
  return isNum(a) && isNum(b) && a > 0 ? b / a - 1 : undefined;
}

export function computeTrend(prices: PricePoint[], spy?: PricePoint[], peers?: PricePoint[], proxy?: string): TrendResult | undefined {
  if (prices.length < 210) return undefined;
  const closes = prices.map((p) => p.close);
  const last = closes.length - 1;
  const price = closes[last] as number;
  const ma50 = smaAt(closes, last, 50) as number;
  const ma200 = smaAt(closes, last, 200) as number;
  const ma200Prev = smaAt(closes, last - 21, 200);
  const ma200Rising = isNum(ma200Prev) ? ma200 > ma200Prev : false;

  let below = 0;
  let counted = 0;
  for (let i = last - 126; i < last; i++) {
    const m = smaAt(closes, i, 200);
    if (!isNum(m)) continue;
    counted++;
    if ((closes[i] as number) < m) below++;
  }
  const belowShare6m = counted ? below / counted : 0;

  const above = price > ma200;
  let state: TrendState;
  if (above && belowShare6m > 0.5) state = "Recovering";
  else if (above && ma50 > ma200 && ma200Rising) state = "Uptrend";
  else if (above) state = "Mixed";
  else if (ma50 < ma200 && !ma200Rising) state = "Downtrend";
  else state = "Weakening";

  // RS: 12-month return skipping the latest month (sessions 252 → 21 back), minus SPY's.
  const own12 = windowReturn(prices, 252, 21);
  const spy12 = spy ? windowReturn(spy, 252, 21) : undefined;
  const rs = isNum(own12) && isNum(spy12) ? own12 - spy12 : undefined;
  const peer6 = peers ? windowReturn(peers, 126, 0) : undefined;
  const spy6 = spy ? windowReturn(spy, 126, 0) : undefined;
  const ind = isNum(peer6) && isNum(spy6) && proxy !== "SPY" ? peer6 - spy6 : undefined;

  const chart = prices.slice(-260).map((p, i, arr) => {
    const idx = last - (arr.length - 1 - i);
    return { date: p.date, close: p.close, ma50: smaAt(closes, idx, 50), ma200: smaAt(closes, idx, 200) };
  });

  return { state, price, ma50, ma200, ma200Rising, belowShare6m, rs, ind, industryProxy: proxy, explain: explainTrend(state), chart };
}

export function explainTrend(state: TrendState): Explain {
  switch (state) {
    case "Uptrend":
      return {
        expert: "Price above the 200-day, 50-day above the 200-day, and the 200-day rising.",
        simple: "The price has been climbing for months, and the recent climb is faster than the long-run one. The market likes it right now.",
      };
    case "Recovering":
      return {
        expert: "Back above the 200-day after spending most of the last 6 months below it.",
        simple: "The price was in a slump for most of the past half-year and has just climbed back above its long-run average. Could be the start of a turnaround — or a false start.",
      };
    case "Mixed":
      return {
        expert: "Above the 200-day, but the 50-day/200-day relationship or the 200-day slope disagrees.",
        simple: "The price is above its long-run average, but the other signals don't agree. No clear direction.",
      };
    case "Weakening":
      return {
        expert: "Slipped below the 200-day; the longer averages haven't rolled over yet.",
        simple: "The price just dipped below its long-run average. It's a warning sign, not yet a full downtrend.",
      };
    case "Downtrend":
      return {
        expert: "Below the 200-day, 50-day below the 200-day, and the 200-day falling.",
        simple: "The price has been falling for months. The market is selling this one.",
      };
  }
}

/** The four score × trend combinations, each raising a different question. */
export function quadrant(score: number, state: TrendState): Explain & { title: string } {
  const high = score >= 65;
  const up = state === "Uptrend" || state === "Recovering";
  const down = state === "Downtrend" || state === "Weakening";
  if (high && up) return { title: "Strong business, and the market agrees", expert: "Ask: how much of the good news is already in the price?", simple: "Everyone already likes it. The question is whether you're late to the party and paying too much." };
  if (high && down) return { title: "Strong business the market is selling", expert: "Ask: is it cheap for a reason — or has the market overreacted?", simple: "Good company, falling price. Either people know something bad that isn't in the numbers yet, or this is a sale. Find out which." };
  if (!high && up) return { title: "Weaker fundamentals, but the stock is rising", expert: "Ask: what does the market see that the numbers don't show yet?", simple: "The numbers are so-so, but people are buying. Maybe a turnaround is coming — or it's hype." };
  if (!high && down) return { title: "Weak fundamentals and a falling price", expert: "Ask: what would have to change for either to improve?", simple: "Both the business and the price look weak. Usually one to avoid unless you know exactly what will turn it around." };
  return { title: "Mixed signals", expert: "Trend is indecisive; let the fundamentals lead and watch for a resolution.", simple: "The price isn't clearly going up or down. Focus on whether it's a good business." };
}
