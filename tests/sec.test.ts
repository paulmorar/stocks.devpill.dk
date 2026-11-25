import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilingsPanel, FilingsView } from "@/components/filings";
import { parseCsvLine } from "@/lib/csv";
import { cikFor, edgarLinks, type FilingsResult, isForeignListing, padCik, parseSubmissions, secUserAgent } from "@/lib/data/sec-map";
import { type CompanyFacts, type SecFact, secAnnual } from "@/lib/data/sec-facts";
import type { PeriodRow } from "@/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("@/data/universe.json", () => ({
  default: { members: [{ symbol: "AAPL", name: "Apple", index: ["SP500"], cik: "0000320193" }, { symbol: "ARM", name: "Arm", index: ["NDX"] }] },
}));

/** data.sec.gov/submissions column arrays, newest first, with unrelated forms mixed in. */
const recent = (rows: [form: string, filed: string, period?: string, doc?: string][]) => ({
  form: rows.map((r) => r[0]),
  filingDate: rows.map((r) => r[1]),
  reportDate: rows.map((r) => r[2] ?? ""),
  accessionNumber: rows.map((_, i) => `0000320193-25-${String(i).padStart(6, "0")}`),
  primaryDocument: rows.map((r) => r[3] ?? "doc.htm"),
});

describe("SEC filing selection", () => {
  it("picks the newest annual and quarterly reports among other forms", () => {
    const f = parseSubmissions("320193", {
      name: "Apple Inc.",
      filings: { recent: recent([
        ["4", "2025-11-20"], ["10-K", "2025-10-31", "2025-09-27", "aapl-20250927.htm"], ["8-K", "2025-10-30"],
        ["10-Q", "2025-08-01", "2025-06-28"], ["10-K", "2024-11-01", "2024-09-28"],
      ]) },
    });
    expect(f.annual).toEqual({
      latest: { form: "10-K", filed: "2025-10-31", period: "2025-09-27", url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000001/aapl-20250927.htm" },
      amendment: undefined,
    });
    expect(f.quarterly.latest).toMatchObject({ form: "10-Q", filed: "2025-08-01", period: "2025-06-28" });
  });

  it("shows a newer amendment separately and never substitutes it for the original", () => {
    const f = parseSubmissions("1067983", {
      filings: { recent: recent([["10-K/A", "2025-04-15", "2024-12-31"], ["10-K", "2025-02-24", "2024-12-31"], ["10-Q", "2024-11-04"], ["10-Q/A", "2024-01-10"]]) },
    });
    expect(f.annual.latest).toMatchObject({ form: "10-K", filed: "2025-02-24" });
    expect(f.annual.amendment).toMatchObject({ form: "10-K/A", filed: "2025-04-15" });
    expect(f.quarterly.amendment).toBeUndefined();
  });

  it("handles a foreign issuer with a 20-F, no 10-Q and no primary document", () => {
    const f = parseSubmissions("937966", { filings: { recent: recent([["6-K", "2025-10-15"], ["20-F", "2025-02-12", "2024-12-31", ""]]) } });
    expect(f.annual.latest?.url).toBe("https://www.sec.gov/Archives/edgar/data/937966/000032019325000001/0000320193-25-000001-index.htm");
    expect(f.quarterly).toEqual({ latest: undefined, amendment: undefined });
  });
});

describe("CIK lookup and EDGAR links", () => {
  const members = [{ symbol: "AAPL", cik: "0000320193" }, { symbol: "BRK-B", cik: "0001067983" }, { symbol: "ARM" }];

  it("matches class shares written with a dot or a hyphen", () => {
    expect(cikFor(members, "brk.b")).toBe("0001067983");
    expect(cikFor(members, "ARM")).toBeUndefined();
    expect(cikFor(members, "ZZZZ")).toBeUndefined();
    expect(isForeignListing("NOVO-B.CO")).toBe(true);
    expect(isForeignListing("BRK-B")).toBe(false);
  });

  it("lists filings by CIK, or searches by ticker when the CIK is unknown", () => {
    expect(padCik(320193)).toBe("0000320193");
    expect(edgarLinks("AAPL", "320193", "20-F").annual).toBe(
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=20-F&dateb=&owner=include&count=40",
    );
    expect(edgarLinks("BRK.B").quarterly).toContain("CIK=BRK-B&type=10-Q");
  });

  it("requires a contact email before any SEC request", () => {
    expect(secUserAgent({})).toBeUndefined();
    expect(secUserAgent({ SEC_USER_AGENT: "Stock Scout" })).toBeUndefined();
    expect(secUserAgent({ SEC_USER_AGENT: " Stock Scout ops@example.com " })).toBe("Stock Scout ops@example.com");
  });

  it("parses quoted CSV fields, so the S&P 500 dataset's CIK column lines up", () => {
    expect(parseCsvLine('AAPL,Apple Inc.,Information Technology,"Technology Hardware, Storage & Peripherals","Cupertino, California",1982-11-30,320193,1977'))
      .toEqual(["AAPL", "Apple Inc.", "Information Technology", "Technology Hardware, Storage & Peripherals", "Cupertino, California", "1982-11-30", "320193", "1977"]);
    expect(parseCsvLine('a,"say ""hi""",')).toEqual(["a", 'say "hi"', ""]);
  });
});

describe("getFilings", () => {
  const env = { SEC_USER_AGENT: "Stock Scout ops@example.com" };
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes no SEC request without a declared contact, but still returns working links", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { getFilings } = await import("@/lib/data/sec");
    const r = await getFilings("AAPL", {});
    expect(r).toMatchObject({ status: "not-configured", cik: "0000320193" });
    expect(r.links?.all).toContain("CIK=0000320193");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("identifies itself, and serves concurrent and repeat lookups from one request", async () => {
    const body = { name: "Apple Inc.", filings: { recent: recent([["10-K", "2025-10-31", "2025-09-27"]]) } };
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body)));
    vi.stubGlobal("fetch", fetch);
    const { getFilings } = await import("@/lib/data/sec");
    const [a, b] = await Promise.all([getFilings("AAPL", env), getFilings("aapl", env)]);
    expect(a).toMatchObject({ status: "ok", filings: { company: "Apple Inc.", annual: { latest: { form: "10-K" } } } });
    expect(b.status).toBe("ok");
    expect((await getFilings("AAPL", env)).status).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://data.sec.gov/submissions/CIK0000320193.json");
    expect((fetch.mock.calls[0]?.[1]?.headers as Record<string, string>)["User-Agent"]).toBe(env.SEC_USER_AGENT);
  });

  it("reports an outage as unavailable with fallback links, then waits before asking again", async () => {
    const fetch = vi.fn(async () => new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const { getFilings } = await import("@/lib/data/sec");
    const first = await getFilings("AAPL", env);
    expect(first).toMatchObject({ status: "unavailable", reason: "SEC EDGAR returned HTTP 503." });
    expect(first.links?.annual).toContain("CIK=0000320193");
    expect((await getFilings("AAPL", env)).status).toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("separates companies without a CIK on file from non-US listings", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { getFilings } = await import("@/lib/data/sec");
    expect(await getFilings("ARM", env)).toMatchObject({ status: "unknown-company", links: { all: expect.stringContaining("CIK=ARM&") } });
    expect(await getFilings("NOVO-B.CO", env)).toEqual({ status: "not-us", symbol: "NOVO-B.CO" });
  });
});

describe("filings panel", () => {
  const links = edgarLinks("AAPL", "320193");

  it("labels an amendment on its own line and says which years of the score come from filings", () => {
    const filings = parseSubmissions("320193", {
      name: "Apple Inc.",
      filings: { recent: recent([["10-K/A", "2025-12-01"], ["10-K", "2025-10-31", "2025-09-27"]]) },
    });
    const ok: FilingsResult = { status: "ok", symbol: "AAPL", cik: "0000320193", links, filings, fetchedAt: "2026-11-24T08:00:00Z" };
    const html = renderToStaticMarkup(createElement(FilingsView, { result: ok }));
    expect(html).toContain("Form 10-K, filed Oct 31, 2025");
    expect(html).toContain("Amendment");
    expect(html).toContain("Form 10-K/A, filed Dec 1, 2025");
    expect(renderToStaticMarkup(createElement(FilingsPanel, { symbol: "AAPL" }))).toContain("recent years from Yahoo Finance and can take older years from these filings");
  });

  it("explains why details are missing and still links to EDGAR", () => {
    for (const [result, text] of [
      [{ status: "not-configured", symbol: "AAPL", links }, "SEC_USER_AGENT"],
      [{ status: "unavailable", symbol: "AAPL", links, reason: "SEC EDGAR did not respond in time." }, "did not respond in time"],
      [{ status: "unknown-company", symbol: "ARM", links: edgarLinks("ARM") }, "search EDGAR by ticker"],
    ] as [FilingsResult, string][]) {
      const html = renderToStaticMarkup(createElement(FilingsView, { result }));
      expect(html).toContain(text);
      expect(html).toContain("browse-edgar");
    }
  });
});

describe("SEC company facts", () => {
  /** One fiscal year (calendar year) as tagged in the annual report filed the next February. */
  const year = (fy: number, val: number, accn = `A${fy}`): SecFact => ({ start: `${fy}-01-01`, end: `${fy}-12-31`, val, accn, form: "10-K", filed: `${Number(accn.slice(1)) + 1}-02-15` });
  const facts = (concepts: Record<string, Record<string, SecFact[]>>): CompanyFacts => ({
    facts: { "us-gaap": Object.fromEntries(Object.entries(concepts).map(([k, units]) => [k, { units }])) },
  });
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const revenue = (fy: number) => 100e9 * 1.1 ** (fy - 2013);
  const yahoo = (fys: number[], f: (fy: number) => Partial<PeriodRow>): PeriodRow[] => fys.map((fy) => ({ fy, date: `${fy}-12-31`, sources: ["yahoo"], ...f(fy) }));

  it("adds up to 10 older years for figures that join Yahoo's, and never a newer year", () => {
    const rows = secAnnual(
      facts({
        SalesRevenueNet: { USD: range(2013, 2017).map((fy) => year(fy, revenue(fy))) },
        RevenueFromContractWithCustomerExcludingAssessedTax: { USD: range(2016, 2026).map((fy) => year(fy, revenue(fy))) },
        OperatingIncomeLoss: { USD: range(2013, 2025).map((fy) => year(fy, 0.2 * revenue(fy))) },
      }),
      // Yahoo's operating income is adjusted, 5% above the GAAP figure.
      yahoo(range(2022, 2025), (fy) => ({ revenue: revenue(fy), operatingIncome: 0.21 * revenue(fy) })),
      "USD",
    );
    expect(rows.map((r) => r.fy)).toEqual(range(2015, 2025));
    expect(rows[0]).toEqual({ fy: 2015, date: "2015-12-31", sources: ["sec"], revenue: revenue(2015) });
    expect(rows.some((r) => r.operatingIncome !== undefined)).toBe(false);
  });

  it("leaves out years before a spin-off restated the revenue of the remaining business", () => {
    const remaining = (fy: number) => revenue(fy) / 2;
    const rows = secAnnual(
      facts({
        // Each report as first filed, then the FY2024 report restating FY2022 to FY2024 without the spun-off half.
        Revenues: { USD: [...range(2013, 2023).map((fy) => year(fy, revenue(fy))), ...range(2022, 2025).map((fy) => year(fy, remaining(fy), "A2024"))] },
        NetIncomeLoss: { USD: range(2013, 2025).map((fy) => year(fy, revenue(fy) / 10)) },
      }),
      yahoo(range(2023, 2025), (fy) => ({ revenue: remaining(fy), netIncome: revenue(fy) / 10 })),
      "USD",
    );
    expect(rows.map((r) => r.fy)).toEqual(range(2022, 2025));
    expect(rows[0]!.revenue).toBe(remaining(2022));
  });

  it("leaves out share counts and EPS for years that started before the listing, but keeps the business figures", () => {
    const rows = secAnnual(
      facts({
        Revenues: { USD: range(2016, 2025).map((fy) => year(fy, revenue(fy))) },
        // Before the IPO, the weighted count leaves out preferred stock that converts at the IPO.
        WeightedAverageNumberOfDilutedSharesOutstanding: { shares: range(2016, 2025).map((fy) => year(fy, fy < 2020 ? 50e6 : 100e6, "A2025")) },
      }),
      yahoo(range(2022, 2025), (fy) => ({ revenue: revenue(fy), dilutedShares: 100e6 })),
      "USD",
      "2019-05-10",
    );
    expect(rows.filter((r) => r.dilutedShares !== undefined).map((r) => r.fy)).toEqual(range(2020, 2025));
    expect(rows.find((r) => r.fy === 2018)?.revenue).toBe(revenue(2018));
  });

  it("restates share counts and EPS across a split, and leaves out figures in the wrong scale", () => {
    // A 4-for-1 split in 2023: the FY2023 report restates FY2021 and FY2022. The FY2020 report tagged shares in thousands.
    const filings: [accn: string, fys: number[], basis: number][] = [
      ["A2020", [2018, 2019, 2020], 1e-3], ["A2022", [2020, 2021, 2022], 1], ["A2023", [2021, 2022, 2023], 4], ["A2024", [2022, 2023, 2024], 4], ["A2025", [2023, 2024, 2025], 4],
    ];
    const tag = (f: (fy: number, basis: number) => number) => filings.flatMap(([accn, fys, basis]) => fys.map((fy) => year(fy, f(fy, basis), accn)));
    const preSplitEps = (fy: number) => fy - 2016;
    const income = (fy: number) => preSplitEps(fy) * 100e6;
    const eps = tag((fy, basis) => (basis === 1 ? preSplitEps(fy) : preSplitEps(fy) / 4));
    eps.find((f) => f.accn === "A2023" && f.end === "2021-12-31")!.val *= 1000;
    const rows = secAnnual(
      facts({
        Revenues: { USD: range(2016, 2025).map((fy) => year(fy, revenue(fy))) },
        NetIncomeLoss: { USD: range(2016, 2025).map((fy) => year(fy, income(fy))) },
        WeightedAverageNumberOfDilutedSharesOutstanding: { shares: tag((_, basis) => (basis === 1e-3 ? 100e3 : basis * 100e6)) },
        EarningsPerShareDiluted: { "USD/shares": eps },
      }),
      yahoo(range(2022, 2025), (fy) => ({ revenue: revenue(fy), netIncome: income(fy), dilutedShares: 400e6, eps: preSplitEps(fy) / 4 })),
      "USD",
    );
    const at = (fy: number) => rows.find((r) => r.fy === fy)!;
    expect([at(2020).dilutedShares, at(2020).eps]).toEqual([400e6, 1]);
    // EPS tagged 1000× too high no longer fits net income over shares, so both are left out.
    expect([at(2021).dilutedShares, at(2021).eps]).toEqual([undefined, undefined]);
    expect([at(2019).dilutedShares, at(2019).eps, at(2019).netIncome]).toEqual([undefined, undefined, income(2019)]);
  });
});
