import { cleanSymbol, fail, json } from "@/lib/api";
import { getNews, MAX_NEWS_SYMBOLS } from "@/lib/data/news";

/** GET /api/news?symbols=AAPL,MSFT: recent stories tagged with these stocks, newest first. */
export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get("symbols") ?? "").split(",").filter((s) => s.trim());
  const symbols = raw.map((s) => cleanSymbol(s));
  if (!symbols.length || symbols.some((s) => !s)) return fail(new Error("Give one or more valid tickers in ?symbols="), 400);
  if (symbols.length > MAX_NEWS_SYMBOLS) return fail(new Error(`Ask for at most ${MAX_NEWS_SYMBOLS} stocks at a time.`), 400);
  try {
    const result = await getNews(symbols as string[]);
    return json(result, result.status === "ok" || result.status === "none" ? 60 * 5 : 60);
  } catch (e) {
    return fail(e);
  }
}
