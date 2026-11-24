/**
 * Recent headlines for stocks, from Yahoo Finance's search results. Pure, so the filtering and
 * de-duplication can be tested without the network. Headlines are research context only:
 * nothing here feeds the score.
 */

export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  url: string;
  /** ISO time the publisher released the story. */
  publishedAt?: string;
  /** The requested stocks the story is tagged with. */
  symbols: string[];
}

export type NewsResult =
  | { status: "ok"; items: NewsItem[]; failed: string[]; fetchedAt: string }
  /** The provider answered, but no story is tagged with these stocks. */
  | { status: "none"; failed: string[]; fetchedAt: string }
  | { status: "unavailable"; reason: string }
  | { status: "demo" };

/** The fields read from yahoo-finance2's `search().news` entries. */
export interface RawNews {
  uuid?: unknown;
  title?: unknown;
  publisher?: unknown;
  link?: unknown;
  providerPublishTime?: unknown;
  relatedTickers?: unknown;
}

/** Only http(s) links are ever rendered, so a malformed entry can't become a script link. */
export function safeUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

function isoTime(v: unknown): string | undefined {
  const d = v instanceof Date ? v : typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : typeof v === "string" ? new Date(v) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined;
}

/** Stories tagged with `symbol`. Yahoo's results for a ticker can include stories about other companies; those are dropped. */
export function mapYahooNews(raw: readonly RawNews[], symbol: string): NewsItem[] {
  const want = symbol.toUpperCase();
  const out: NewsItem[] = [];
  for (const n of raw) {
    const tickers = Array.isArray(n.relatedTickers) ? n.relatedTickers.map((t) => String(t).toUpperCase()) : [];
    const url = safeUrl(n.link);
    const title = typeof n.title === "string" ? n.title.trim() : "";
    if (!tickers.includes(want) || !url || !title) continue;
    out.push({
      id: typeof n.uuid === "string" && n.uuid ? n.uuid : url,
      title,
      publisher: typeof n.publisher === "string" && n.publisher.trim() ? n.publisher.trim() : "Unknown publisher",
      url,
      publishedAt: isoTime(n.providerPublishTime),
      symbols: [want],
    });
  }
  return out;
}

const titleKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const byDate = (a: NewsItem, b: NewsItem) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");

/**
 * Merges per-stock results: the same story (by id, link or headline) appears once, tagged with every requested
 * stock it covers. Stocks take turns: every stock's newest story is picked before any stock's second newest, so
 * one busy stock can't fill the whole selection. The picked stories are shown newest first; undated stories last.
 */
export function mergeNews(lists: readonly NewsItem[][], limit: number): NewsItem[] {
  const merged: NewsItem[] = [];
  for (const item of lists.flat()) {
    const same = merged.find((m) => m.id === item.id || m.url === item.url || titleKey(m.title) === titleKey(item.title));
    if (same) same.symbols = [...new Set([...same.symbols, ...item.symbols])];
    else merged.push({ ...item, symbols: [...item.symbols] });
  }
  const perStock = new Map<string, number>();
  const turns = merged.sort(byDate).map((item) => {
    const turn = Math.min(...item.symbols.map((s) => perStock.get(s) ?? 0));
    for (const s of item.symbols) perStock.set(s, (perStock.get(s) ?? 0) + 1);
    return { item, turn };
  });
  return turns.sort((a, b) => a.turn - b.turn).slice(0, limit).map((t) => t.item).sort(byDate);
}
