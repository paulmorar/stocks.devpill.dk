import { describe, expect, it } from "vitest";
import { analyzeShortTerm, atr, ema, positionSize, rsi, vwapSeries } from "@/lib/shortterm";
import type { DailyBar, IntradayBar } from "@/lib/types";

const daily = (n: number, f: (i: number) => number, vol = 1_000_000): DailyBar[] =>
  Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { time: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString(), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: vol };
  });

describe("indicators", () => {
  it("RSI is 100 on a straight climb and ~0 on a straight fall", () => {
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 + i))).toBe(100);
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 - i))!).toBeLessThan(1);
  });
  it("RSI matches Wilder's reference series", () => {
    // Classic example from Wilder (1978) via StockCharts: RSI(14) ≈ 70.53 on the 15th close.
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(closes)!).toBeCloseTo(70.53, 0);
  });
  it("EMA of a constant is the constant", () => expect(ema(Array(30).fill(5), 9)).toBe(5));
  it("ATR of identical 2% ranges ≈ 2% of price", () => expect(atr(daily(30, () => 100))!).toBeCloseTo(2, 5));
  it("VWAP weights by volume", () => {
    const bars: IntradayBar[] = [
      { time: "t1", open: 10, high: 10, low: 10, close: 10, volume: 100 },
      { time: "t2", open: 20, high: 20, low: 20, close: 20, volume: 300 },
    ];
    expect(vwapSeries(bars).at(-1)).toBeCloseTo(17.5);
  });
});

describe("setups", () => {
  it("detects Gap & Go on a 5% gap with heavy volume holding above VWAP", () => {
    const d = daily(60, () => 100);
    const today = new Date(Date.UTC(2026, 2, 3, 14, 30)).toISOString().slice(0, 10);
    const intraday: IntradayBar[] = Array.from({ length: 12 }, (_, i) => {
      const p = 105 + i * 0.2;
      return { time: `${today}T${String(14 + Math.floor((30 + i * 5) / 60)).padStart(2, "0")}:${String((30 + i * 5) % 60).padStart(2, "0")}:00.000Z`, open: p - 0.1, high: p + 0.1, low: p - 0.15, close: p, volume: 200_000 };
    });
    const r = analyzeShortTerm("TEST", d, intraday);
    expect(r.gapPct!).toBeCloseTo(0.049, 2);
    expect(r.rvol!).toBeGreaterThan(2);
    expect(r.setups.map((s) => s.id)).toContain("gap_and_go");
    const g = r.setups.find((s) => s.id === "gap_and_go")!;
    expect(g.stop!).toBeLessThan(g.entry!);
    expect(g.target!).toBeGreaterThan(g.entry!);
  });
  it("flags overextended runs", () => {
    const r = analyzeShortTerm("RUN", daily(80, (i) => 100 * 1.02 ** i), []);
    expect(r.setups.map((s) => s.id)).toContain("overextended");
    expect(r.warnings[0]).toMatch(/No intraday/);
  });
});

describe("position sizing", () => {
  it("risks a fixed share of the account", () => {
    const p = positionSize(10_000, 0.01, 50, 48)!;
    expect(p.shares).toBe(50);
    expect(p.riskAmount).toBe(100);
    expect(p.positionValue).toBe(2500);
  });
  it("rejects a stop equal to entry", () => expect(positionSize(10_000, 0.01, 50, 50)).toBeUndefined());
});
