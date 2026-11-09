import type { TrendState } from "@/lib/trend";

/**
 * The Traveling Trader's published scores, transcribed from the weekly
 * "On the Radar" and "Portfolio Holdings Scores" posts. Used as a reference
 * on stock pages and by `npm run calibrate` to measure how far this app's
 * (independently calibrated) scores sit from TTT's. Not live data.
 */
export interface TttRef {
  symbol: string;
  name: string;
  score: number;
  delta: number | null;
  v: number;
  g: number;
  q: number;
  h: number;
  trend: TrendState;
  rs: number;
  ind: number;
  f?: boolean;
  capex?: boolean;
  flag?: boolean;
  list: "radar" | "portfolio";
}

export const TTT_REFERENCE_DATE = "2026-11-08";

type Row = [string, string, number, number | null, number, number, number, number, TrendState, number, number, string?];
const radar: Row[] = [
  ["ADBE", "Adobe", 94, 0, 24, 20, 29, 20, "Weakening", -42, 10],
  ["FIX", "Comfort Systems USA", 93, 7, 22, 24, 28, 19, "Weakening", 63, -26, "capex"],
  ["PGR", "The Progressive", 88, 1, 20, 24, 27, 17, "Uptrend", -12, 14, "f"],
  ["DECK", "Deckers Outdoor", 87, -2, 21, 20, 25, 20, "Downtrend", -12, 6],
  ["EME", "EMCOR", 86, 5, 20, 18, 28, 20, "Weakening", 5, -26],
  ["LULU", "Lululemon Athletica", 86, 0, 14, 22, 30, 20, "Downtrend", -58, -9],
  ["IT", "Gartner", 86, 0, 24, 17, 25, 20, "Mixed", -32, 21],
  ["AXP", "American Express", 86, 1, 16, 21, 29, 20, "Recovering", -32, 29, "f"],
  ["ERIE", "Erie Indemnity", 85, 1, 17, 20, 30, 18, "Recovering", -37, 14, "f,capex"],
  ["RJF", "Raymond James Financial", 85, -2, 14, 22, 30, 19, "Mixed", -18, 9, "f"],
  ["SNDK", "Sandisk", 84, 25, 25, 23, 18, 19, "Weakening", 645, 24],
  ["TPL", "Texas Pacific Land", 84, 6, 18, 24, 24, 18, "Weakening", -9, -11],
  ["FTNT", "Fortinet", 84, 11, 16, 25, 24, 20, "Weakening", 126, 20],
  ["BKNG", "Booking", 84, -1, 25, 20, 21, 19, "Downtrend", -34, 17],
  ["MA", "Mastercard", 84, -1, 15, 20, 29, 20, "Uptrend", -10, 29],
  ["MU", "Micron Technology", 84, 3, 25, 23, 18, 18, "Weakening", 316, -18, "capex"],
  ["RMD", "ResMed", 82, 2, 18, 18, 28, 18, "Recovering", -24, 21],
  ["ACGL", "Arch Capital", 81, -3, 12, 24, 26, 20, "Uptrend", -7, 8, "f"],
  ["KLAC", "KLA", 81, 0, 12, 21, 28, 20, "Weakening", 46, -18],
  ["GL", "Globe Life", 81, 1, 19, 13, 29, 20, "Uptrend", 8, 14, "f"],
  ["GDDY", "GoDaddy", 80, 0, 25, 17, 22, 16, "Recovering", -38, 20],
  ["ANET", "Arista Networks", 80, 3, 15, 23, 23, 18, "Uptrend", 46, 24, "capex"],
  ["LLY", "Eli Lilly", 80, 1, 18, 20, 24, 18, "Uptrend", 10, 28, "capex"],
];
const portfolio: Row[] = [
  ["GOOG", "Alphabet", 86, 0, 15, 23, 28, 20, "Downtrend", 6, -27, "capex"],
  ["ASML", "ASML N.V.", 85, 1, 15, 23, 28, 20, "Weakening", 57, -18],
  ["APP", "AppLovin", 85, -1, 23, 22, 20, 20, "Downtrend", -72, 10],
  ["NVDA", "NVIDIA", 84, 1, 21, 24, 20, 18, "Weakening", 6, -18],
  ["NVO", "Novo Nordisk", 84, -1, 14, 21, 30, 19, "Downtrend", -33, 28, "capex"],
  ["META", "Meta Platforms", 84, 3, 17, 23, 23, 20, "Recovering", 0, -27, "capex"],
  ["MSFT", "Microsoft", 82, 1, 17, 20, 26, 18, "Uptrend", -9, 20, "capex"],
  ["NFLX", "Netflix", 79, 0, 21, 19, 20, 18, "Downtrend", -52, -3],
  ["NOW", "ServiceNow", 72, 3, 22, 23, 10, 17, "Weakening", -34, 10],
  ["UNH", "UnitedHealth", 72, 1, 22, 15, 18, 17, "Uptrend", 2, 6],
  ["AMZN", "Amazon.com", 71, 0, 15, 22, 18, 16, "Uptrend", -8, -2, "capex"],
  ["AVGO", "Broadcom", 71, 1, 14, 24, 18, 15, "Downtrend", -14, -18],
  ["AAPL", "Apple", 67, 0, 6, 12, 29, 20, "Uptrend", 9, 1],
  ["HOOD", "Robinhood Markets", 61, 1, 5, 21, 20, 15, "Weakening", -30, 0, "f"],
  ["HD", "The Home Depot", 58, -2, 8, 9, 29, 11, "Recovering", -37, 6],
  ["DVN", "Devon Energy", 57, 2, 12, 17, 14, 14, "Weakening", 33, -11, "flag"],
  ["MCD", "McDonald's", 56, -3, 11, 9, 26, 10, "Recovering", -37, 6],
  ["UBER", "Uber Technologies", 55, -5, 10, 19, 12, 14, "Downtrend", -39, 10],
  ["OXY", "Occidental Petroleum", 54, 0, 21, 10, 8, 15, "Weakening", 33, -11],
];

const toRef = (list: TttRef["list"]) => ([symbol, name, score, delta, v, g, q, h, trend, rs, ind, tags = ""]: Row): TttRef => ({
  symbol, name, score, delta, v, g, q, h, trend, rs: rs / 100, ind: ind / 100,
  f: tags.includes("f"), capex: tags.includes("capex"), flag: tags.includes("flag"), list,
});

export const TTT_REFERENCE: TttRef[] = [...radar.map(toRef("radar")), ...portfolio.map(toRef("portfolio"))];

export const tttRef = (symbol: string) => TTT_REFERENCE.find((r) => r.symbol === symbol.toUpperCase());

/** TTT's portfolio, handy as a default portfolio list. */
export const TTT_PORTFOLIO = portfolio.map((r) => r[0]);
