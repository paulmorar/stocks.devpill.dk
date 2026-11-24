import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataFreshness } from "@/components/freshness";
import type { LongTermReport } from "@/lib/analyze";
import { demoCompany } from "@/lib/data/demo";
import { formatAge, formatTimestamp, freshness, SNAPSHOT_STALE_DAYS } from "@/lib/freshness";
import { scoreCompany } from "@/lib/scoring/engine";
import { summarize } from "@/lib/scoring/summary";
import { type Snapshot, toRow } from "@/lib/snapshot";
import type { MarketSnapshot } from "@/lib/types";

const friday = "2026-11-20T21:00:00.000Z"; // 4:00 PM in New York
const monday = Date.parse("2026-11-23T14:00:00Z");

function report(market: Partial<MarketSnapshot> = {}): LongTermReport {
  const company = structuredClone(demoCompany("NWSW"));
  if (!company) throw new Error("Missing NWSW fixture");
  company.annual = company.annual.slice(-4);
  const score = scoreCompany(company);
  return { ...company, market: { ...company.market, ...market }, score, summary: summarize(company.profile.name, score), fetchedAt: "2026-11-23T11:00:00Z" };
}

describe("freshness helpers", () => {
  it("treat missing or invalid timestamps as unavailable, never as current", () => {
    expect(freshness(undefined, 8, monday)).toEqual({ state: "unavailable" });
    expect(freshness("soon", 8, monday)).toEqual({ state: "unavailable" });
    expect(freshness("2026-11-16T05:17:00Z", SNAPSHOT_STALE_DAYS, monday).state).toBe("current");
    expect(freshness("2026-11-15T05:17:00Z", SNAPSHOT_STALE_DAYS, monday).state).toBe("stale");
    expect([30_000, 5 * 60_000, 3_600_000, 2.5 * 86_400_000].map(formatAge)).toEqual(["just now", "5 min ago", "1 hour ago", "2 days ago"]);
  });
});

describe("data freshness panel", () => {
  it("keeps a Friday quote's own timestamp when viewed on Monday", () => {
    expect(formatTimestamp(friday, "America/New_York")).toMatch(/^Nov 20, 2026, 4:00\sPM EST$/);
    const html = renderToStaticMarkup(createElement(DataFreshness, { r: report({ quoteTime: friday }), now: monday }));
    expect(html).toContain("(2 days ago)");
    expect(html).not.toContain("Nov 23");
    expect(html).toContain("3 hours ago from demo data");
  });

  it("says when the provider gave no quote time instead of inventing one", () => {
    const html = renderToStaticMarkup(createElement(DataFreshness, { r: report({ quoteTime: undefined }), now: monday }));
    expect(html).toContain("did not say when this price was set");
    expect(html).toContain("4 annual reports, FY");
  });

  it("mentions the trailing 12 months only when they reach past the last annual report", () => {
    const r = report();
    const last = r.annual.at(-1)!;
    const after = (days: number) => new Date(Date.parse(last.date) + days * 86_400_000).toISOString().slice(0, 10);
    const panel = (ttmDate: string) => renderToStaticMarkup(createElement(DataFreshness, { r: { ...r, ttm: { ...last, date: ttmDate } }, now: monday }));
    expect(panel(after(3))).not.toContain("trailing 12 months");
    expect(panel(after(182))).toContain("plus the trailing 12 months to");
  });

  it("separates the weekly score and rank from a different live score", () => {
    const r = report();
    const row = { ...toRow(r), score: r.score.total - 3 };
    const snap: Snapshot = {
      date: "2026-11-22", generatedAt: "2026-11-22T13:00:00Z", universe: "", attempted: 2, failed: [],
      rows: [row, { ...row, symbol: "TOP", score: 99, raw: 99 }],
    };
    const html = renderToStaticMarkup(createElement(DataFreshness, { r, snap, now: monday }));
    expect(html).toContain(`Scored ${row.score} in the Nov 22, 2026 snapshot, ranked 2 of 2.`);
    expect(html).toContain(`The live score here is ${r.score.total} because it uses newer data.`);
  });

  it("flags a missed weekly scan and a stock outside the snapshot", () => {
    const snap: Snapshot = {
      date: "2026-11-08", generatedAt: "2026-11-08T06:00:00Z", universe: "", attempted: 1, failed: [],
      rows: [{ ...toRow(report()), symbol: "OTHER" }],
    };
    const html = renderToStaticMarkup(createElement(DataFreshness, { r: report(), snap, now: monday }));
    expect(html).toContain("Not in the Nov 8, 2026 snapshot");
    expect(html).toContain("15 days old, so at least one weekly scan was missed");
    expect(renderToStaticMarkup(createElement(DataFreshness, { r: report(), snapError: "HTTP 500", now: monday }))).toContain("couldn&#x27;t load: HTTP 500");
  });
});
