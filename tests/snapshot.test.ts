import { describe, expect, it } from "vitest";
import { industryMomentum, rank, type RadarRow, type Snapshot, withDeltas } from "@/lib/snapshot";
import { TTT_REFERENCE } from "@/data/ttt-reference";
import { demoCompany } from "@/lib/data/demo";
import { scoreCompany } from "@/lib/scoring/engine";
import universe from "@/data/universe.json";
import type { CompanyData } from "@/lib/types";

const row = (symbol: string, score: number, extra: Partial<RadarRow> = {}): RadarRow => ({
  symbol, name: symbol, scorable: true, score, raw: score, band: "lime", scorecard: "main", capexMode: false, flags: [],
  pillars: { value: 0, growth: 0, quality: 0, health: 0 }, ...extra,
});

describe("weekly snapshot", () => {
  it("computes week-over-week deltas; new names get null", () => {
    const prev: Snapshot = { date: "2026-11-01", generatedAt: "", universe: "", attempted: 2, failed: [], rows: [row("A", 80), row("B", 90)] };
    const out = withDeltas([row("A", 84), row("B", 89), row("C", 70)], prev);
    expect(out.map((r) => r.delta)).toEqual([4, -1, null]);
  });
  it("first-ever snapshot has no deltas", () => {
    expect(withDeltas([row("A", 84)]).at(0)?.delta).toBeUndefined();
  });
  it("ranks by score, then raw (pre-cap), then RS", () => {
    const r = rank([row("A", 84, { rs: 0.1 }), row("B", 84, { rs: 0.5 }), row("C", 90), row("D", 84, { raw: 88 }), row("E", 99, { scorable: false })]);
    expect(r.map((x) => x.symbol)).toEqual(["C", "D", "B", "A"]);
  });
  it("industry momentum: one value per industry, median of peers minus the S&P 500, needs 3 peers", () => {
    const rows = [
      row("ASML", 85, { industry: "Semiconductors", r6: -0.1 }),
      row("NVDA", 84, { industry: "Semiconductors", r6: 0.0 }),
      row("MU", 84, { industry: "Semiconductors", r6: 0.4 }),
      row("XOM", 60, { industry: "Oil & Gas Integrated", r6: 0.2 }),
      row("CVX", 60, { industry: "Oil & Gas Integrated", r6: 0.1 }),
    ];
    const ind = industryMomentum(rows, 0.08);
    expect(ind.Semiconductors).toEqual({ ind: -0.08, n: 3 });
    expect(ind["Oil & Gas Integrated"]).toBeUndefined();
  });
});

describe("financials can carry CAPEX too (TTT marks ERIE as F + CAPEX)", () => {
  it("keeps the CAPEX marker on the financials scorecard", () => {
    const c = structuredClone(demoCompany("CTSB") as CompanyData);
    c.annual = c.annual.map((r) => ({ ...r, capex: (r.da ?? 1) * 3 }));
    if (c.ttm) c.ttm.capex = (c.ttm.da ?? 1) * 3;
    const s = scoreCompany(c);
    expect(s.scorecard).toBe("financials");
    expect(s.capexMode).toBe(true);
  });
});

describe("reference data", () => {
  it("has all 42 TTT rows with pillar points that add up to the score (±2 for rounding)", () => {
    expect(TTT_REFERENCE).toHaveLength(42);
    for (const r of TTT_REFERENCE) {
      expect(Math.abs(r.v + r.g + r.q + r.h - r.score), r.symbol).toBeLessThanOrEqual(2);
      expect(r.v).toBeLessThanOrEqual(25);
      expect(r.q).toBeLessThanOrEqual(30);
      expect(r.h).toBeLessThanOrEqual(20);
    }
  });
  it("universe covers the S&P 500 plus Nasdaq-100 extras, with Yahoo-style symbols", () => {
    const syms = universe.members.map((m) => m.symbol);
    expect(syms.length).toBeGreaterThan(500);
    expect(new Set(syms).size).toBe(syms.length);
    expect(syms).toContain("BRK-B");
    expect(syms).toContain("ASML");
    for (const s of ["ADBE", "FIX", "SNDK", "TPL", "ERIE", "GDDY", "ANET", "LLY"]) expect(syms).toContain(s);
  });
});
