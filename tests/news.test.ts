import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewsView } from "@/components/news";
import { mapYahooNews, mergeNews, type NewsItem, type RawNews, safeUrl } from "@/lib/data/news-map";

vi.mock("server-only", () => ({}));
const yahoo = vi.hoisted(() => ({ yahooNews: vi.fn<(s: string) => Promise<RawNews[]>>() }));
vi.mock("@/lib/data/yahoo", () => yahoo);

const raw = (over: Partial<RawNews> = {}): RawNews => ({
  uuid: "u1", title: "Apple beats estimates", publisher: "Reuters", link: "https://finance.yahoo.com/news/apple-1.html",
  providerPublishTime: new Date("2026-11-24T10:00:00Z"), relatedTickers: ["AAPL", "MSFT"], ...over,
});
const item = (id: string, publishedAt: string | undefined, symbols: string[], over: Partial<NewsItem> = {}): NewsItem => ({
  id, title: `Story ${id}`, publisher: "P", url: `https://x.test/${id}`, publishedAt, symbols, ...over,
});

describe("news mapping", () => {
  it("keeps only stories tagged with the stock, with safe links and real headlines", () => {
    const items = mapYahooNews([
      raw(),
      raw({ uuid: "u2", relatedTickers: ["NVDA"] }),
      raw({ uuid: "u3", link: "javascript:alert(1)" }),
      raw({ uuid: "u4", title: "  " }),
      raw({ uuid: "u5", relatedTickers: undefined }),
      raw({ uuid: "u6", publisher: "", providerPublishTime: "not a date", relatedTickers: ["aapl"] }),
    ], "aapl");
    expect(items.map((n) => n.id)).toEqual(["u1", "u6"]);
    expect(items[0]).toEqual({ id: "u1", title: "Apple beats estimates", publisher: "Reuters", url: "https://finance.yahoo.com/news/apple-1.html", publishedAt: "2026-11-24T10:00:00.000Z", symbols: ["AAPL"] });
    expect(items[1]).toMatchObject({ publisher: "Unknown publisher", publishedAt: undefined });
    expect(safeUrl("data:text/html,hi")).toBeUndefined();
  });

  it("merges the same story across stocks, newest first, undated last", () => {
    const merged = mergeNews([
      [item("a", "2026-11-24T09:00:00Z", ["AAPL"]), item("b", undefined, ["AAPL"])],
      [item("a2", "2026-11-24T09:00:00Z", ["MSFT"], { url: "https://x.test/a" }), item("c", "2026-11-24T11:00:00Z", ["MSFT"], { title: "STORY a!" })],
    ], 10);
    expect(merged.map((n) => [n.id, n.symbols])).toEqual([["a", ["AAPL", "MSFT"]], ["b", ["AAPL"]]]);
    expect(mergeNews([[item("x", "2026-11-23T00:00:00Z", ["A"]), item("y", "2026-11-24T00:00:00Z", ["A"]), item("z", undefined, ["A"])]], 2).map((n) => n.id)).toEqual(["y", "x"]);
  });

  it("lets each stock take a turn, so one busy stock can't fill a list's news", () => {
    const busy = ["10", "11", "12", "13"].map((h) => item(`n${h}`, `2026-11-24T${h}:00:00Z`, ["NVDA"]));
    const merged = mergeNews([busy, [item("a", "2026-11-24T08:00:00Z", ["AAPL"]), item("a2", "2026-11-24T07:00:00Z", ["AAPL"])], [item("v", "2026-11-24T09:00:00Z", ["V"])]], 4);
    expect(merged.map((n) => n.id)).toEqual(["n13", "n12", "v", "a"]);
  });
});

describe("getNews", () => {
  beforeEach(() => {
    vi.resetModules();
    yahoo.yahooNews.mockReset();
    vi.stubEnv("DEMO_MODE", "0");
  });

  it("returns partial results when one stock fails, and caches each stock's headlines", async () => {
    yahoo.yahooNews.mockImplementation(async (s) => {
      if (s === "MSFT") throw new Error("429 Too Many Requests");
      return [raw({ relatedTickers: [s] })];
    });
    const { getNews } = await import("@/lib/data/news");
    const r = await getNews(["AAPL", "MSFT"]);
    expect(r).toMatchObject({ status: "ok", failed: ["MSFT"], items: [{ id: "u1", symbols: ["AAPL"] }] });
    await getNews(["AAPL"]);
    expect(yahoo.yahooNews.mock.calls.filter(([s]) => s === "AAPL")).toHaveLength(1);
  });

  it("separates no stories, provider failure and demo companies", async () => {
    const { getNews } = await import("@/lib/data/news");
    yahoo.yahooNews.mockResolvedValueOnce([raw({ relatedTickers: ["OTHER"] })]);
    expect(await getNews(["NOVO-B.CO"])).toMatchObject({ status: "none", failed: [] });
    yahoo.yahooNews.mockRejectedValue(new Error("fetch failed"));
    expect(await getNews(["ASML"])).toMatchObject({ status: "unavailable" });
    expect(await getNews(["NWSW"])).toEqual({ status: "demo" });
    expect(yahoo.yahooNews).toHaveBeenCalledTimes(2);
  });

  it("rejects bad tickers and oversized requests at the route", async () => {
    const { GET } = await import("@/app/api/news/route");
    expect((await GET(new Request("http://x/api/news?symbols=AAPL,<b>"))).status).toBe(400);
    expect((await GET(new Request("http://x/api/news"))).status).toBe(400);
    const many = Array.from({ length: 13 }, (_, i) => `T${i}`).join(",");
    expect((await GET(new Request(`http://x/api/news?symbols=${many}`))).status).toBe(400);
    expect(yahoo.yahooNews).not.toHaveBeenCalled();
  });
});

describe("news panel", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  it("opens stories in a new tab without giving them access to this page", () => {
    const html = renderToStaticMarkup(createElement(NewsView, {
      result: { status: "ok", items: [item("a", "2026-11-24T09:00:00Z", ["AAPL", "MSFT"])], failed: ["NVDA"], fetchedAt: "" },
      subject: "these stocks", showSymbols: true, now,
    }));
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("3 hours ago");
    expect(html).toContain("AAPL, MSFT");
    expect(html).toContain("Couldn&#x27;t load news for NVDA.");
  });

  it("says why there is nothing to show", () => {
    const render = (result: Parameters<typeof NewsView>[0]["result"]) => renderToStaticMarkup(createElement(NewsView, { result, subject: "NOVO-B.CO", now }));
    expect(render({ status: "none", failed: [], fetchedAt: "" })).toContain("no recent stories tagged with NOVO-B.CO");
    expect(render({ status: "unavailable", reason: "Yahoo Finance news is unavailable right now." })).toContain("unavailable right now");
    expect(render({ status: "demo" })).toContain("fictional");
  });
});
