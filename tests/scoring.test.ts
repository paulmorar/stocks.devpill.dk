import { describe, expect, it } from "vitest";
import { demoBenchmark, demoCompany, DEMO_SYMBOLS } from "@/lib/data/demo";
import { scoreCompany, isFinancial, notScoredReason } from "@/lib/scoring/engine";
import { bandOf } from "@/lib/scoring/types";
import { summarize } from "@/lib/scoring/summary";
import { computeTrend, quadrant } from "@/lib/trend";
import type { CompanyData, PeriodRow } from "@/lib/types";

const demo = (s: string) => structuredClone(demoCompany(s) as CompanyData);

describe("score bands (methodology slide: score colors)", () => {
  it.each([
    [80, "lime"], [100, "lime"], [79, "green"], [65, "green"], [64, "amber"], [50, "amber"], [49, "red"], [0, "red"],
  ] as const)("%i → %s", (score, band) => expect(bandOf(score)).toBe(band));
});

describe("scoreCompany on demo companies", () => {
  it("all pillars sum to the 25/25/30/20 split", () => {
    const r = scoreCompany(demo("NWSW"));
    expect(r.pillars.map((p) => p.maxPoints)).toEqual([25, 25, 30, 20]);
    for (const p of r.pillars) {
      const live = p.checks.filter((c) => c.score !== undefined);
      expect(live.reduce((a, c) => a + c.maxPoints, 0)).toBeCloseTo(p.maxPoints, 6);
    }
  });

  it("a strong, clean business scores high with no red flags", () => {
    const r = scoreCompany(demo("NWSW"));
    expect(r.redFlags).toHaveLength(0);
    expect(r.total).toBeGreaterThanOrEqual(75);
    expect(r.scorecard).toBe("main");
  });

  it("banks use the financials scorecard", () => {
    const c = demo("CTSB");
    expect(isFinancial(c)).toBe(true);
    const r = scoreCompany(c);
    expect(r.scorecard).toBe("financials");
    expect(r.pillars[0]!.checks.map((x) => x.id)).toContain("ptbv_vs_median");
  });

  it("card networks stay on the main scorecard", () => {
    const c = demo("CTSB");
    c.profile.symbol = "V";
    c.profile.industry = "Credit Services";
    expect(isFinancial(c)).toBe(false);
    c.profile.symbol = "COF";
    expect(isFinancial(c)).toBe(true);
  });

  it("heavy spenders (capex > 2× depreciation) switch to CAPEX mode", () => {
    const r = scoreCompany(demo("FBCL"));
    expect(r.capexMode).toBe(true);
    expect(r.pillars[2]!.checks.find((c) => c.id === "cash_conversion")!.label).toMatch(/maintenance/);
  });

  it("one red flag caps at 59, two or more at 39", () => {
    const one = scoreCompany(demo("FBCL"));
    expect(one.redFlags.length).toBe(1);
    expect(one.total).toBeLessThanOrEqual(59);
    const many = scoreCompany(demo("TSRT"));
    expect(many.redFlags.length).toBeGreaterThanOrEqual(2);
    expect(many.total).toBeLessThanOrEqual(39);
  });

  it("missing data skips a check and re-weights its pillar instead of scoring zero", () => {
    const c = demo("NWSW");
    c.market.forwardPE = undefined;
    c.market.forwardEps = undefined;
    const r = scoreCompany(c);
    const value = r.pillars.find((p) => p.id === "value")!;
    const live = value.checks.filter((x) => x.score !== undefined);
    expect(live).toHaveLength(2);
    expect(live[0]!.maxPoints).toBeCloseTo(12.5);
  });

  it("companies with under 5 years of history, ETFs and REITs aren't scored", () => {
    const short = demo("NWSW");
    short.annual = short.annual.slice(-4);
    expect(notScoredReason(short)).toMatch(/5 are needed/);
    const etf = demo("NWSW");
    etf.profile.quoteType = "ETF";
    expect(notScoredReason(etf)).toMatch(/ETF/);
    const reit = demo("NWSW");
    reit.profile.industry = "REIT - Industrial";
    expect(scoreCompany(reit).scorable).toBe(false);
  });

  it("every check carries both an expert and a beginner explanation", () => {
    for (const s of DEMO_SYMBOLS) {
      const r = scoreCompany(demo(s));
      for (const p of r.pillars) for (const c of p.checks) {
        expect(c.explain.expert.length).toBeGreaterThan(10);
        expect(c.explain.simple.length).toBeGreaterThan(10);
        expect(c.explain.simple).not.toMatch(/undefined|NaN/);
        expect(c.explain.expert).not.toMatch(/undefined|NaN/);
      }
      const sum = summarize(s, r);
      expect(sum.simple).not.toMatch(/undefined|NaN/);
    }
  });

  it("dilution red flag fires above 4%/yr", () => {
    const c = demo("NWSW");
    let sh = 1e9;
    c.annual = c.annual.map((r: PeriodRow) => ({ ...r, dilutedShares: (sh *= 1.06), sharesOutstanding: sh }));
    expect(scoreCompany(c).redFlags.map((f) => f.id)).toContain("dilution");
  });
});

describe("trend states (200-day average)", () => {
  const line = (n: number, f: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10), close: f(i) }));

  it("steady climb → Uptrend", () => expect(computeTrend(line(400, (i) => 100 + i * 0.5))!.state).toBe("Uptrend"));
  it("steady fall → Downtrend", () => expect(computeTrend(line(400, (i) => 300 - i * 0.5))!.state).toBe("Downtrend"));
  it("long slump then sharp rebound → Recovering", () => {
    const t = computeTrend(line(400, (i) => (i < 360 ? 300 - i * 0.5 : 120 + (i - 360) * 4)))!;
    expect(t.state).toBe("Recovering");
  });
  it("rally then a fresh dip below the 200-day → Weakening", () => {
    const t = computeTrend(line(400, (i) => (i < 385 ? 100 + i * 0.4 : 100 + 385 * 0.4 - (i - 385) * 6)))!;
    expect(t.state).toBe("Weakening");
  });
  it("RS compares 12-month return (skipping the last month) to the S&P 500", () => {
    const stock = line(300, (i) => 100 * 1.002 ** i);
    const spy = line(300, () => 100);
    const t = computeTrend(stock, spy)!;
    expect(t.rs).toBeCloseTo(1.002 ** 231 - 1, 3);
  });
  it("demo recovering company is Recovering", () => {
    const c = demo("ADTM");
    expect(computeTrend(c.prices, demoBenchmark(1, 300))!.state).toBe("Recovering");
  });
  it("quadrant questions follow the methodology", () => {
    expect(quadrant(85, "Uptrend").expert).toMatch(/already in the price/);
    expect(quadrant(85, "Downtrend").expert).toMatch(/cheap for a reason/);
    expect(quadrant(40, "Uptrend").expert).toMatch(/market see/);
    expect(quadrant(40, "Downtrend").expert).toMatch(/what would have to change/);
  });
});
