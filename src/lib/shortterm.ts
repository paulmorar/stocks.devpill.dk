import type { DailyBar, IntradayBar } from "./types";
import { fx, isNum, pct, signedPct } from "./util";
import type { Explain } from "./scoring/types";

/**
 * Short-term (intraday / swing) signals. Deliberately separate from the
 * long-term score: these describe price action today, not business quality.
 */

export interface Indicator {
  id: string;
  label: string;
  display: string;
  tone: "good" | "bad" | "neutral" | "warn";
  explain: Explain;
}

export interface Setup {
  id: string;
  label: string;
  bias: "long" | "short" | "caution";
  /** 0..1 how cleanly the conditions are met. */
  strength: number;
  entry?: number;
  stop?: number;
  target?: number;
  explain: Explain;
}

export interface ShortTermResult {
  symbol: string;
  sessionDate?: string;
  last: number;
  prevClose: number;
  open?: number;
  gapPct?: number;
  changePct: number;
  vwap?: number;
  rvol?: number;
  rsi?: number;
  atr?: number;
  atrPct?: number;
  ema9?: number;
  ema20?: number;
  sma50?: number;
  high20?: number;
  low20?: number;
  orHigh?: number;
  orLow?: number;
  indicators: Indicator[];
  setups: Setup[];
  /** Ranking key for the scanner: how "in play" the stock is. */
  activity: number;
  intraday: { time: string; close: number; vwap: number }[];
  warnings: string[];
}

export function ema(values: number[], n: number) {
  if (values.length < n) return undefined;
  const k = 2 / (n + 1);
  let e = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < values.length; i++) e = (values[i] as number) * k + e * (1 - k);
  return e;
}

/** Wilder's RSI. */
export function rsi(closes: number[], n = 14) {
  if (closes.length <= n) return undefined;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = (closes[i] as number) - (closes[i - 1] as number);
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = (closes[i] as number) - (closes[i - 1] as number);
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Wilder's ATR. */
export function atr(bars: DailyBar[], n = 14) {
  if (bars.length <= n) return undefined;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i] as DailyBar;
    const pc = (bars[i - 1] as DailyBar).close;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)));
  }
  let a = trs.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < trs.length; i++) a = (a * (n - 1) + (trs[i] as number)) / n;
  return a;
}

export function vwapSeries(bars: IntradayBar[]) {
  let pv = 0;
  let v = 0;
  return bars.map((b) => {
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * b.volume;
    v += b.volume;
    return v > 0 ? pv / v : tp;
  });
}

/** Regular US session = 78 five-minute bars. */
const SESSION_BARS = 78;

export function analyzeShortTerm(symbol: string, daily: DailyBar[], intraday: IntradayBar[]): ShortTermResult {
  const warnings: string[] = [];
  const sessionDate = intraday.at(-1)?.time.slice(0, 10);
  // Daily bars may already include today's partial session; keep only completed prior days.
  const prior = daily.filter((d) => !sessionDate || d.time.slice(0, 10) < sessionDate);
  if (!intraday.length) warnings.push("No intraday bars (market closed or data delayed); using daily data only.");

  const prevClose = prior.at(-1)?.close ?? daily.at(-2)?.close ?? daily.at(-1)?.close ?? 0;
  const open = intraday[0]?.open;
  const last = intraday.at(-1)?.close ?? daily.at(-1)?.close ?? prevClose;
  const gapPct = isNum(open) && prevClose ? open / prevClose - 1 : undefined;
  const changePct = prevClose ? last / prevClose - 1 : 0;

  const vw = vwapSeries(intraday);
  const vwap = vw.at(-1);
  const todayVol = intraday.reduce((a, b) => a + b.volume, 0);
  const avgVol = prior.slice(-20).reduce((a, b) => a + b.volume, 0) / Math.max(1, Math.min(20, prior.length));
  const elapsed = Math.min(1, Math.max(intraday.length, 1) / SESSION_BARS);
  const rvol = intraday.length && avgVol > 0 ? todayVol / (avgVol * elapsed) : undefined;

  const closesWithToday = [...prior.map((d) => d.close), last];
  const r = rsi(closesWithToday);
  const barsWithToday: DailyBar[] = intraday.length
    ? [...prior, { time: intraday[0]!.time, open: open as number, high: Math.max(...intraday.map((b) => b.high)), low: Math.min(...intraday.map((b) => b.low)), close: last, volume: todayVol }]
    : prior;
  const a = atr(barsWithToday);
  const e9 = ema(closesWithToday, 9);
  const e20 = ema(closesWithToday, 20);
  const s50 = prior.length >= 50 ? prior.slice(-50).reduce((x, y) => x + y.close, 0) / 50 : undefined;
  const last20 = prior.slice(-20);
  const high20 = last20.length ? Math.max(...last20.map((d) => d.high)) : undefined;
  const low20 = last20.length ? Math.min(...last20.map((d) => d.low)) : undefined;
  const or = intraday.slice(0, 6);
  const orHigh = or.length === 6 ? Math.max(...or.map((b) => b.high)) : undefined;
  const orLow = or.length === 6 ? Math.min(...or.map((b) => b.low)) : undefined;

  const indicators: Indicator[] = [];
  if (isNum(gapPct)) {
    indicators.push({
      id: "gap", label: "Gap", display: signedPct(gapPct, 1),
      tone: Math.abs(gapPct) >= 0.03 ? "warn" : "neutral",
      explain: {
        expert: `Opened ${signedPct(gapPct, 1)} vs prior close ${fx(prevClose, 2)}. Gaps ≥3% on news tend to bring volume and volatility.`,
        simple: `Overnight, the price jumped ${gapPct >= 0 ? "up" : "down"} ${pct(Math.abs(gapPct), 1)} before trading even started — usually because of news.`,
      },
    });
  }
  indicators.push({
    id: "change", label: "Change today", display: signedPct(changePct, 1), tone: changePct >= 0 ? "good" : "bad",
    explain: { expert: `Last ${fx(last, 2)} vs prior close ${fx(prevClose, 2)}.`, simple: `Since yesterday's close, it's ${changePct >= 0 ? "up" : "down"} ${pct(Math.abs(changePct), 1)}.` },
  });
  if (isNum(rvol)) {
    indicators.push({
      id: "rvol", label: "Relative volume", display: `${fx(rvol, 1)}×`, tone: rvol >= 2 ? "good" : rvol < 0.7 ? "bad" : "neutral",
      explain: {
        expert: `Volume so far is ${fx(rvol, 1)}× the 20-day average pace for this point in the session. RVOL ≥2 means it's "in play".`,
        simple: `${fx(rvol, 1)} times more people are trading it than on a normal day by this time. Busy stocks move more — both ways.`,
      },
    });
  }
  if (isNum(vwap)) {
    const above = last > vwap;
    indicators.push({
      id: "vwap", label: "vs VWAP", display: `${above ? "above" : "below"} ${fx(vwap, 2)}`, tone: above ? "good" : "bad",
      explain: {
        expert: `VWAP ${fx(vwap, 2)}; price is ${signedPct(last / vwap - 1, 2)} ${above ? "above" : "below"}. Intraday buyers are on average ${above ? "in profit" : "under water"}.`,
        simple: `VWAP is the average price everyone paid today. Being ${above ? "above it means buyers are winning today" : "below it means sellers are winning today"}.`,
      },
    });
  }
  if (isNum(r)) {
    indicators.push({
      id: "rsi", label: "RSI (14-day)", display: fx(r, 0), tone: r >= 70 ? "warn" : r <= 30 ? "warn" : "neutral",
      explain: {
        expert: `Daily RSI ${fx(r, 0)}. >70 overbought, <30 oversold — in strong trends these readings can persist.`,
        simple: `A 0–100 gauge of how hard it's been pushed lately. ${r >= 70 ? "Above 70: it's run up a lot, could be due a breather." : r <= 30 ? "Below 30: it's been beaten down, could bounce." : "In the normal range."}`,
      },
    });
  }
  if (isNum(a)) {
    indicators.push({
      id: "atr", label: "ATR (14-day)", display: `${fx(a, 2)} (${pct(a / last, 1)})`, tone: "neutral",
      explain: {
        expert: `Average true range ${fx(a, 2)}, ${pct(a / last, 1)} of price. Use it to size stops and positions.`,
        simple: `On a typical day this stock moves about ${pct(a / last, 1)} (≈${fx(a, 2)} per share). That's the normal "wiggle" — a stop closer than that gets hit by noise.`,
      },
    });
  }
  if (isNum(e20) && isNum(a) && a > 0) {
    const stretch = (last - e20) / a;
    indicators.push({
      id: "stretch", label: "Stretch vs 20-day EMA", display: `${fx(stretch, 1)} ATR`, tone: Math.abs(stretch) >= 3 ? "warn" : "neutral",
      explain: {
        expert: `Price is ${fx(stretch, 1)} ATRs from its 20-day EMA (${fx(e20, 2)}).`,
        simple: `How far the price has run from its recent average, measured in "normal days of movement". Beyond 3 it's stretched, like a rubber band.`,
      },
    });
  }

  const setups: Setup[] = [];
  const risk = (entry: number, stop: number) => (entry > stop ? { entry, stop, target: entry + 2 * (entry - stop) } : { entry, stop, target: entry - 2 * (stop - entry) });
  const hasVol = isNum(rvol);

  if (isNum(gapPct) && gapPct >= 0.03 && isNum(vwap) && last > vwap && (!hasVol || (rvol as number) >= 1.5)) {
    const stop = Math.max(vwap, orLow ?? 0);
    setups.push({
      id: "gap_and_go", label: "Gap & Go", bias: "long",
      strength: Math.min(1, (gapPct / 0.08) * 0.5 + ((rvol ?? 1) / 4) * 0.5),
      ...risk(last, stop < last ? stop : vwap),
      explain: {
        expert: `Gapped ${signedPct(gapPct, 1)} on ${fx(rvol, 1)}× RVOL and holding above VWAP. Classic continuation; invalidated on a VWAP loss.`,
        simple: "It jumped at the open on lots of trading and is holding the gain. Traders bet it keeps going — but if it drops below today's average price, the idea is wrong.",
      },
    });
  }
  if (isNum(gapPct) && gapPct >= 0.03 && isNum(vwap) && last < vwap) {
    setups.push({
      id: "gap_fade", label: "Gap fading", bias: "caution", strength: Math.min(1, (vwap - last) / vwap / 0.02),
      explain: {
        expert: "Gap up that has lost VWAP — sellers are absorbing the gap. Late longs are trapped; gap-fill risk.",
        simple: "It jumped at the open but has since slipped below today's average price. The early excitement is fading — buying now is risky.",
      },
    });
  }
  if (isNum(gapPct) && gapPct <= -0.03 && isNum(vwap) && last > vwap) {
    setups.push({
      id: "gap_down_reclaim", label: "Gap-down reclaim", bias: "long", strength: Math.min(1, (last - vwap) / vwap / 0.015),
      ...risk(last, Math.min(vwap, ...intraday.map((b) => b.low))),
      explain: {
        expert: `Gapped ${signedPct(gapPct, 1)} but reclaimed VWAP: sellers exhausted. Stop under the day's low.`,
        simple: "It opened sharply lower but buyers stepped in and pushed it back above today's average price. Sometimes the start of a rebound.",
      },
    });
  }
  if (isNum(orHigh) && isNum(orLow) && intraday.length > 6 && last > orHigh && (!hasVol || (rvol as number) >= 1.5)) {
    setups.push({
      id: "orb", label: "Opening-range breakout", bias: "long", strength: Math.min(1, (rvol ?? 1) / 3),
      ...risk(last, (orHigh + orLow) / 2),
      explain: {
        expert: `Broke the 30-minute opening range high (${fx(orHigh, 2)}) on above-average volume. Stop at the range midpoint.`,
        simple: "In the first half-hour it set a high and low. It has now broken above that high with heavy trading — a common sign of a strong day.",
      },
    });
  }
  if (isNum(high20) && last > high20 && (!hasVol || (rvol as number) >= 1.3) && isNum(a)) {
    setups.push({
      id: "breakout_20d", label: "20-day breakout", bias: "long", strength: Math.min(1, ((last - high20) / a) * 0.7 + 0.3),
      ...risk(last, last - a),
      explain: {
        expert: `Trading above the prior 20-session high (${fx(high20, 2)}). Swing setup; 1-ATR stop.`,
        simple: "It's at its highest price in about a month. Breakouts can run for days — or fail quickly, so use a stop.",
      },
    });
  }
  if (isNum(r) && r <= 32 && changePct > 0 && (!isNum(vwap) || last > vwap)) {
    setups.push({
      id: "oversold_bounce", label: "Oversold bounce", bias: "long", strength: Math.min(1, (35 - r) / 15),
      ...(isNum(a) ? risk(last, last - a) : {}),
      explain: {
        expert: `RSI ${fx(r, 0)} with a green session${isNum(vwap) ? " above VWAP" : ""}. Counter-trend: smaller size, quick targets.`,
        simple: "It's been beaten down hard and is bouncing today. Bounces in a falling stock are often short — this is a fast in-and-out trade, not an investment.",
      },
    });
  }
  if ((isNum(r) && r >= 75) || (isNum(e20) && isNum(a) && a > 0 && (last - e20) / a >= 3)) {
    setups.push({
      id: "overextended", label: "Overextended", bias: "caution", strength: 0.7,
      explain: {
        expert: `Stretched: RSI ${fx(r, 0)}, ${isNum(e20) && isNum(a) ? fx((last - e20) / a, 1) : "?"} ATR above the 20-EMA. Chasing here has poor risk/reward.`,
        simple: "It has run up a lot, very fast. Buying now means paying top dollar right when early buyers may start cashing in.",
      },
    });
  }
  if (isNum(vwap) && intraday.length >= 8) {
    const recent = intraday.slice(-6);
    const vwRecent = vw.slice(-6);
    const wasBelow = recent.slice(0, 4).some((b, i) => b.close < (vwRecent[i] as number));
    const rising = (recent.at(-1)?.volume ?? 0) > (recent[0]?.volume ?? 0);
    if (wasBelow && last > vwap && rising && !setups.some((s) => s.id === "gap_down_reclaim")) {
      setups.push({
        id: "vwap_reclaim", label: "VWAP reclaim", bias: "long", strength: 0.5,
        ...risk(last, Math.min(...recent.map((b) => b.low))),
        explain: {
          expert: "Crossed back above VWAP in the last 30 minutes on rising volume. Stop under the recent swing low.",
          simple: "In the last half-hour it climbed back above today's average price with more people trading. Buyers are taking back control.",
        },
      });
    }
  }

  const activity = Math.abs(changePct) * 100 * Math.min(rvol ?? 1, 5) + (setups.filter((s) => s.bias === "long").length ? 2 : 0);

  return {
    symbol, sessionDate, last, prevClose, open, gapPct, changePct, vwap, rvol, rsi: r, atr: a,
    atrPct: isNum(a) ? a / last : undefined, ema9: e9, ema20: e20, sma50: s50, high20, low20, orHigh, orLow,
    indicators, setups, activity,
    intraday: intraday.map((b, i) => ({ time: b.time, close: b.close, vwap: vw[i] as number })),
    warnings,
  };
}

/** Position size from account risk. Returns whole shares. */
export function positionSize(account: number, riskPct: number, entry: number, stop: number) {
  const perShare = Math.abs(entry - stop);
  if (!(account > 0) || !(riskPct > 0) || !(perShare > 0)) return undefined;
  const riskAmount = account * riskPct;
  const shares = Math.floor(riskAmount / perShare);
  return { shares, riskAmount, perShare, positionValue: shares * entry, pctOfAccount: (shares * entry) / account };
}
