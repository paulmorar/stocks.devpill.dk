import "server-only";
import { cached, TTL } from "./cache";
import { isDemoSymbol } from "./demo";
import { demoMode } from "./index";
import { mapYahooNews, mergeNews, type NewsResult } from "./news-map";
import { yahooNews } from "./yahoo";

/** Most stocks one request may ask about; keeps a long watchlist from fanning out into dozens of provider calls. */
export const MAX_NEWS_SYMBOLS = 12;

/**
 * Recent stories for one or more stocks. Each stock's headlines are cached for 15 minutes and fetched through
 * the Yahoo client's queue, which limits concurrency. One stock failing doesn't hide the others.
 */
export async function getNews(symbols: string[], limit = symbols.length > 1 ? 8 : 5): Promise<NewsResult> {
  const real = [...new Set(symbols.map((s) => s.toUpperCase()))].filter((s) => !isDemoSymbol(s)).slice(0, MAX_NEWS_SYMBOLS);
  if (demoMode() || !real.length) return { status: "demo" };
  const results = await Promise.allSettled(real.map((s) => cached(`news:${s}`, TTL.news, async () => mapYahooNews(await yahooNews(s), s))));
  const failed = real.filter((_, i) => results[i]!.status === "rejected");
  if (failed.length === real.length) {
    const reason = (results[0] as PromiseRejectedResult).reason;
    console.error("Yahoo news failed:", String((reason as Error)?.message ?? reason).slice(0, 200));
    return { status: "unavailable", reason: "Yahoo Finance news is unavailable right now. Try again in a few minutes." };
  }
  const items = mergeNews(results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])), limit);
  const fetchedAt = new Date().toISOString();
  return items.length ? { status: "ok", items, failed, fetchedAt } : { status: "none", failed, fetchedAt };
}
