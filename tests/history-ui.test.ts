import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HistoryBadge, ScoreCardMini } from "@/components/ui";
import { RankTable } from "@/components/rank-table";
import type { LongTermReport } from "@/lib/analyze";
import { demoCompany } from "@/lib/data/demo";
import { scoreCompany } from "@/lib/scoring/engine";
import { summarize } from "@/lib/scoring/summary";
import { rank, toRow, withDeltas, type Snapshot } from "@/lib/snapshot";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/mode", () => ({ useMode: () => ({ mode: "expert" }) }));

function report(years: number): LongTermReport {
  const company = structuredClone(demoCompany("NWSW"));
  if (!company) throw new Error("Missing NWSW fixture");
  company.annual = company.annual.slice(-years);
  const score = scoreCompany(company);
  return { ...company, score, summary: summarize(company.profile.name, score) };
}

describe("limited-history reporting", () => {
  it("preserves history metadata through snapshot serialization and ranking", () => {
    const row = toRow(report(4), ["SP500"]);
    expect(JSON.parse(JSON.stringify(row))).toMatchObject({
      scorable: true, yearsOfHistory: 4, index: ["SP500"],
    });
    expect(rank([row])).toEqual([row]);
  });

  it("labels the ranking table and the live score card", () => {
    const r = report(4);
    const table = renderToStaticMarkup(createElement(RankTable, { rows: [toRow(r)] }));
    const card = renderToStaticMarkup(createElement(ScoreCardMini, { r }));
    expect(table).toContain("Limited history: 4y");
    expect(table).toContain("provisional score from four annual periods");
    expect(card).toContain("Limited history: 4y");
    expect(card).toContain("Provisional score");
  });

  it.each([undefined, 3, 5, 10])("does not invent limited-history metadata for %s years", (years) => {
    expect(renderToStaticMarkup(createElement(HistoryBadge, { years }))).toBe("");
  });

  it("does not label excluded stocks as provisionally scored", () => {
    const r = report(3);
    const card = renderToStaticMarkup(createElement(ScoreCardMini, { r }));
    expect(card).toContain("Not scored");
    expect(card).not.toContain("Limited history");
  });

  it("keeps older snapshots readable without changing their eligibility", () => {
    const eligible = toRow(report(5));
    delete eligible.yearsOfHistory;
    const excluded = { ...eligible, symbol: "OLD", scorable: false };
    expect(rank([eligible, excluded])).toEqual([eligible]);
    const table = renderToStaticMarkup(createElement(RankTable, { rows: [eligible] }));
    expect(table).not.toContain("Limited history");
  });

  it("does not compare newly eligible scores with an excluded previous score", () => {
    const row = toRow(report(4));
    const previous: Snapshot = {
      date: "2026-11-01", generatedAt: "", universe: "", attempted: 1, failed: [],
      rows: [{ ...row, scorable: false }],
    };
    expect(withDeltas([row], previous)[0]?.delta).toBeNull();
  });
});
