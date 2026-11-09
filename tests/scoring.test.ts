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

  it.each([0, 1, 2, 3])("does not score %i annual periods, even with TTM available", (years) => {
    const short = demo("NWSW");
    short.annual = years ? short.annual.slice(-years) : [];
    expect(short.ttm).toBeDefined();
    expect(notScoredReason(short)).toMatch(/at least 4 are needed/);
    expect(scoreCompany(short).scorable).toBe(false);
  });

  it.each(["ETF", "MUTUALFUND"])("does not score %s with four annual periods", (quoteType) => {
    const etf = demo("NWSW");
    etf.annual = etf.annual.slice(-4);
    etf.profile.quoteType = quoteType;
    expect(notScoredReason(etf)).toMatch(/ETF/);
    expect(scoreCompany(etf).scorable).toBe(false);
  });

  it("does not score REITs with four annual periods", () => {
    const reit = demo("NWSW");
    reit.annual = reit.annual.slice(-4);
    reit.profile.industry = "REIT - Industrial";
    expect(scoreCompany(reit).scorable).toBe(false);
  });

  it.each(["NWSW", "CTSB"])("scores four-period %s histories with the actual three-year revenue CAGR", (symbol) => {
    const company = demo(symbol);
    company.annual = company.annual.slice(-4);
    const result = scoreCompany(company);
    expect(result.scorable).toBe(true);
    expect(result.notScoredReason).toBeUndefined();
    expect(result.yearsOfHistory).toBe(4);
    expect(result.notes.join(" ")).toMatch(/Limited history.*provisional/);
    expect(summarize(symbol, result).expert).toMatch(/Limited history.*provisional/);
    expect(summarize(symbol, result).simple).toMatch(/Limited history.*provisional/);
    expect(summarize(symbol, result).simple).toContain("early estimate");
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);

    const checks = result.pillars.flatMap((pillar) => pillar.checks);
    const revenue = checks.find((check) => check.id === "rev_cagr_5")!;
    const cagr = (company.annual.at(-1)!.revenue! / company.annual[0]!.revenue!) ** (1 / 3) - 1;
    const fullCredit = symbol === "CTSB" ? 0.12 : 0.15;
    expect(revenue.score).toBeCloseTo(Math.min(1, Math.max(0, cagr / fullCredit)));
    expect(revenue.display).toContain("(3y)");
    expect(revenue.explain.expert).toMatch(/over 3 (fiscal )?years/);

    const pe = checks.find((check) => check.id === "pe_vs_median")!;
    expect(pe.explain.expert).toContain("4 annual observations");
    expect(pe.explain.simple).toContain("4 available fiscal years");
    for (const pillar of result.pillars) {
      expect(pillar.checks.reduce((sum, check) => sum + check.maxPoints, 0)).toBeCloseTo(pillar.maxPoints);
    }
  });

  it("does not invent long-term revenue history for a four-period company", () => {
    const company = demo("NWSW");
    company.annual = company.annual.slice(-4);
    const result = scoreCompany(company);
    const longRun = result.pillars.flatMap((pillar) => pillar.checks).find((check) => check.id === "rev_cagr_10")!;
    expect(longRun.score).toBeUndefined();
    expect(longRun.points).toBe(0);
    expect(longRun.skippedReason).toContain("Fewer than 8 years");
  });

  it.each(["NWSW", "CTSB"])("still skips revenue growth when %s has less than three elapsed years of revenue", (symbol) => {
    const company = demo(symbol);
    company.annual = company.annual.slice(-4);
    company.annual[0]!.revenue = undefined;
    const check = scoreCompany(company).pillars.flatMap((pillar) => pillar.checks).find((entry) => entry.id === "rev_cagr_5")!;
    expect(check.score).toBeUndefined();
    expect(check.skippedReason).toContain("Fewer than 3 years");
  });

  it("does not mark five-period scores as limited-history", () => {
    const company = demo("NWSW");
    company.annual = company.annual.slice(-5);
    const result = scoreCompany(company);
    expect(result.scorable).toBe(true);
    expect(result.notes.join(" ")).not.toContain("Limited history");
    expect(summarize(company.profile.name, result).simple).not.toContain("provisional");
  });

  it.each([["FBCL", 59], ["TSRT", 39]] as const)("preserves the red-flag cap for four-period %s histories", (symbol, cap) => {
    const company = demo(symbol);
    company.annual = company.annual.slice(-4);
    const result = scoreCompany(company);
    expect(result.scorable).toBe(true);
    expect(result.redFlags.length).toBeGreaterThanOrEqual(cap === 59 ? 1 : 2);
    expect(result.total).toBeLessThanOrEqual(cap);
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
      expect(sum.expert).not.toMatch(/[—–“”]/);
      expect(sum.simple).not.toMatch(/[—–“”]/);
    }
  });

  it("explains when there is not enough data to compare pillars", () => {
    const result = scoreCompany(demo("NWSW"));
    result.pillars = [];
    const summary = summarize("Northwind", result);
    expect(summary.expert).toContain("There is not enough data to compare the pillars.");
    expect(summary.simple).toContain("model. There is not enough data to compare the pillars.");
    expect(summary.expert + summary.simple).not.toContain("undefined");
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
