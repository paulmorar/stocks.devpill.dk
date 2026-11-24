import { describe, expect, it } from "vitest";
import { applyFilters, availableUniverses, DEFAULT_FILTERS, type Filters, filtersToParams, inUniverse, overview, parseFilters } from "@/lib/explore";
import { rank, type RadarRow, type Snapshot } from "@/lib/snapshot";

const row = (symbol: string, score: number, extra: Partial<RadarRow> = {}): RadarRow => ({
  symbol, name: `${symbol} Inc`, scorable: true, score, raw: score, band: "lime", scorecard: "main", capexMode: false, flags: [],
  pillars: { value: 0, growth: 0, quality: 0, health: 0 }, index: ["SP500"], sector: "Technology", yearsOfHistory: 4, ...extra,
});

const snap: Pick<Snapshot, "rows" | "failed"> = {
  rows: [
    row("AAPL", 82, { index: ["SP500", "NDX"], trend: "Uptrend" }),
    row("ASML", 90, { index: ["NDX"], trend: "Downtrend", yearsOfHistory: 6 }),
    row("JPM", 70, { sector: "Financial Services", trend: "Uptrend" }),
    row("XOM", 41, { sector: "Energy", trend: "Mixed" }),
    row("O", 0, { sector: "Real Estate", scorable: false }),
    row("OLD", 60, { index: undefined }),
  ],
  failed: [{ symbol: "BAD", error: "timeout", index: ["SP500"] }, { symbol: "OLDFAIL", error: "timeout" }],
};
const ranked = rank(snap.rows);
const pick = (f: Partial<Filters>) => applyFilters(ranked, { ...DEFAULT_FILTERS, ...f }).map((r) => r.symbol);

describe("index membership", () => {
  it("lists a stock in both indices once in the combined view, and in each index view", () => {
    expect(pick({}).filter((s) => s === "AAPL")).toHaveLength(1);
    expect(pick({ universe: "sp500" })).toEqual(["AAPL", "JPM", "XOM"]);
    expect(pick({ universe: "ndx" })).toEqual(["ASML", "AAPL"]);
  });

  it("treats rows without index data as unknown, never as members", () => {
    expect(inUniverse({ index: undefined }, "sp500")).toBeUndefined();
    expect(inUniverse({ index: [] }, "sp500")).toBe(false);
    expect(pick({ universe: "sp500" })).not.toContain("OLD");
  });

  it("offers only the indices a snapshot has data for", () => {
    expect(availableUniverses(snap.rows).map((u) => u.id)).toEqual(["all", "sp500", "ndx"]);
    expect(availableUniverses([row("DEMO1", 80, { index: ["DEMO"] })]).map((u) => u.id)).toEqual(["all"]);
  });
});

describe("ranking filters", () => {
  it("combine sector, trend, minimum score, history and text, keeping rank order", () => {
    expect(pick({ sector: "Technology", trend: "Uptrend" })).toEqual(["AAPL"]);
    expect(pick({ minScore: 65 })).toEqual(["ASML", "AAPL", "JPM"]);
    expect(pick({ history: "full" })).toEqual(["ASML"]);
    expect(pick({ history: "limited", universe: "sp500" })).toEqual(["AAPL", "JPM", "XOM"]);
    expect(pick({ q: "jpm" })).toEqual(["JPM"]);
  });
});

describe("sector overview", () => {
  it("uses the selected index for every count and leaves excluded and failed stocks out of the scores", () => {
    const o = overview(snap, "sp500");
    expect(o).toMatchObject({ scored: 3, excluded: 1, failed: 1, unknown: 2 });
    expect(o.sectors.find((s) => s.sector === "Real Estate")).toBeUndefined();
    expect(o.sectors.find((s) => s.sector === "Technology")).toEqual({ sector: "Technology", scored: 1, top: 1, median: 82 });
  });

  it("uses the median and puts sectors with more 80+ scores first", () => {
    const o = overview({ rows: [row("A", 90), row("B", 50), row("C", 60), row("D", 75, { sector: "Energy" })], failed: [] }, "all");
    expect(o.sectors.map((s) => s.sector)).toEqual(["Technology", "Energy"]);
    expect(o.sectors[0]).toMatchObject({ scored: 3, top: 1, median: 60 });
  });
});

describe("filters in the URL", () => {
  it("round-trip, leave defaults out and ignore malformed values", () => {
    const f: Filters = { universe: "sp500", sector: "Energy", trend: "Recovering", minScore: 65, history: "limited", q: "oil" };
    const params = filtersToParams(f);
    expect(params.toString()).toBe("u=sp500&sector=Energy&trend=Recovering&min=65&history=limited&q=oil");
    expect(parseFilters(params)).toEqual(f);
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe("");
    expect(parseFilters(new URLSearchParams("u=ftse&trend=Sideways&min=42&history=x"))).toEqual(DEFAULT_FILTERS);
  });

  it("keeps unrelated query parameters", () => {
    expect(filtersToParams({ ...DEFAULT_FILTERS, minScore: 80 }, new URLSearchParams("tab=ranking")).toString()).toBe("tab=ranking&min=80");
  });
});
