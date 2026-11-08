import { describe, expect, it } from "vitest";
import { applySplits } from "@/lib/data/splits";
import { mergeAnnual } from "@/lib/data/merge";
import { byYear, mapStatementRow } from "@/lib/data/yahoo-map";
import type { PeriodRow } from "@/lib/types";
import { cagr, scale } from "@/lib/util";

const row = (fy: number, extra: Partial<PeriodRow> = {}): PeriodRow => ({ fy, date: `${fy}-12-31`, sources: ["yahoo"], ...extra });

describe("util", () => {
  it("scale gives partial credit in both directions", () => {
    expect(scale(0.5, 0, 1)).toBe(0.5);
    expect(scale(2, 0, 1)).toBe(1);
    expect(scale(1.05, 1.4, 0.7)).toBeCloseTo(0.5);
    expect(scale(2, 1.4, 0.7)).toBe(0);
  });
  it("cagr", () => {
    expect(cagr(100, 200, 5)).toBeCloseTo(0.1487, 3);
    expect(cagr(-1, 200, 5)).toBeUndefined();
  });
});

describe("yahoo fundamentalsTimeSeries mapping", () => {
  // Shape as returned by yahoo-finance2 v4 with module "all".
  const fixture = {
    date: new Date("2025-09-27T00:00:00Z"), TYPE: "ALL", periodType: "12M",
    totalRevenue: 416_161_000_000, operatingIncome: 133_050_000_000, netIncomeCommonStockholders: 112_010_000_000,
    dilutedEPS: 7.46, dilutedAverageShares: 15_004_697_000, interestExpense: 0, pretaxIncome: 132_729_000_000,
    taxProvision: 20_719_000_000, EBITDA: 144_748_000_000, reconciledDepreciation: 11_698_000_000,
    operatingCashFlow: 111_482_000_000, capitalExpenditure: -12_715_000_000, freeCashFlow: 98_767_000_000,
    repurchaseOfCapitalStock: -90_711_000_000, cashDividendsPaid: -15_421_000_000, totalDebt: 98_657_000_000,
    stockholdersEquity: 73_733_000_000, cashCashEquivalentsAndShortTermInvestments: 54_697_000_000,
    totalAssets: 359_241_000_000, tangibleBookValue: 73_733_000_000, ordinarySharesNumber: 14_773_260_000,
  };

  it("maps and normalizes signs", () => {
    const r = mapStatementRow(fixture)!;
    expect(r.fy).toBe(2025);
    expect(r.revenue).toBe(416_161_000_000);
    expect(r.capex).toBe(12_715_000_000); // negative → positive spend
    expect(r.buybacks).toBe(90_711_000_000);
    expect(r.dividendsPaid).toBe(15_421_000_000);
    expect(r.ebitda).toBe(144_748_000_000);
    expect(r.da).toBe(11_698_000_000);
  });

  it("accepts older prefixed keys", () => {
    const r = mapStatementRow({ date: "2024-12-31", annualTotalRevenue: 10, annualNetIncome: 2 })!;
    expect(r.revenue).toBe(10);
    expect(r.netIncome).toBe(2);
  });

  it("derives FCF when missing and drops empty padded rows", () => {
    expect(mapStatementRow({ date: "2024-12-31", operatingCashFlow: 10, capitalExpenditure: -3 })!.freeCashFlow).toBe(7);
    expect(mapStatementRow({ date: "2024-12-31" })).toBeUndefined();
  });

  it("collapses split statement rows of the same year", () => {
    const merged = byYear([row(2024, { revenue: 5 }), row(2024, { equity: 9 }), row(2023, { revenue: 4 })]);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ revenue: 5, equity: 9 });
  });
});

describe("splits", () => {
  it("restates unadjusted history across a 10-for-1 split", () => {
    const rows = [row(2022, { eps: 10, dilutedShares: 1e9 }), row(2023, { eps: 12, dilutedShares: 1e9 }), row(2024, { eps: 1.4, dilutedShares: 1e10 })];
    const out = applySplits(rows, [{ date: "2024-06-10", ratio: 10 }]);
    expect(out[0]!.eps).toBeCloseTo(1);
    expect(out[1]!.dilutedShares).toBe(1e10);
    expect(out[2]!.eps).toBe(1.4);
  });
  it("leaves already-adjusted history alone", () => {
    const rows = [row(2023, { eps: 1.2, dilutedShares: 1e10 }), row(2024, { eps: 1.4, dilutedShares: 1.01e10 })];
    const out = applySplits(rows, [{ date: "2024-06-10", ratio: 10 }]);
    expect(out[0]!.eps).toBe(1.2);
  });
});

describe("mergeAnnual (Yahoo first, FMP fills gaps)", () => {
  it("prefers the first source and extends history from the second", () => {
    const yahoo = [row(2023, { revenue: 100 }), row(2024, { revenue: 110 })];
    const fmp: PeriodRow[] = [
      { ...row(2015, { revenue: 50 }), sources: ["fmp"] },
      { ...row(2023, { revenue: 999, tangibleBookValue: 40 }), sources: ["fmp"] },
    ];
    const m = mergeAnnual(yahoo, fmp);
    expect(m.map((r) => r.fy)).toEqual([2015, 2023, 2024]);
    expect(m[1]!.revenue).toBe(100);
    expect(m[1]!.tangibleBookValue).toBe(40);
    expect(m[1]!.sources).toEqual(["yahoo", "fmp"]);
    expect(m[0]!.sources).toEqual(["fmp"]);
  });
});
