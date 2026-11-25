import "server-only";
import universe from "../../data/universe.json";
import { cached, TTL } from "./cache";
import { demoMode } from "./index";
import { isDemoSymbol } from "./demo";
import { cikFor, edgarLinks, type Filings, type FilingsResult, isForeignListing, padCik, parseSubmissions, secUserAgent } from "./sec-map";
import type { CompanyFacts } from "./sec-facts";

/**
 * Latest annual and quarterly report links from SEC EDGAR, and the company facts behind the older years of the
 * statement history. Only S&P 500 / Nasdaq-100 members have a CIK on file (src/data/universe.json).
 */

const TIMEOUT_MS = 8000;
/** SEC allows 10 requests a second; one instance stays well below that. */
const GAP_MS = 150;
/** After a failure, wait before asking SEC about the same company again. */
const RETRY_AFTER_MS = 10 * 60_000;

let nextSlot = 0;
const failedUntil = new Map<string, number>();

async function pace() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

export async function getFilings(symbol: string, env: Record<string, string | undefined> = process.env): Promise<FilingsResult> {
  const sym = symbol.toUpperCase();
  if (demoMode() || isDemoSymbol(sym)) return { status: "demo", symbol: sym };
  const cik = cikFor(universe.members as { symbol: string; cik?: string }[], sym);
  if (!cik) return isForeignListing(sym) ? { status: "not-us", symbol: sym } : { status: "unknown-company", symbol: sym, links: edgarLinks(sym) };

  const links = edgarLinks(sym, cik);
  const ua = secUserAgent(env);
  if (!ua) return { status: "not-configured", symbol: sym, cik, links };
  const key = padCik(cik);
  if ((failedUntil.get(key) ?? 0) > Date.now()) {
    return { status: "unavailable", symbol: sym, cik, links, reason: "SEC EDGAR did not respond a few minutes ago. Try again later." };
  }

  try {
    const filings = await cached<Filings & { fetchedAt: string }>(`sec:${key}`, TTL.filings, async () => {
      await pace();
      const res = await fetch(`https://data.sec.gov/submissions/CIK${key}.json`, {
        headers: { "User-Agent": ua, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.status === 403) throw new Error("SEC refused the request. Check that SEC_USER_AGENT names the app and a contact email.");
      if (!res.ok) throw new Error(`SEC EDGAR returned HTTP ${res.status}.`);
      return { ...parseSubmissions(key, await res.json()), fetchedAt: new Date().toISOString() };
    });
    return { status: "ok", symbol: sym, cik, links: edgarLinks(sym, cik, filings.annual.latest?.form), filings, fetchedAt: filings.fetchedAt };
  } catch (e) {
    failedUntil.set(key, Date.now() + RETRY_AFTER_MS);
    const timedOut = (e as { name?: string })?.name === "TimeoutError";
    return { status: "unavailable", symbol: sym, cik, links, reason: timedOut ? "SEC EDGAR did not respond in time." : String((e as Error)?.message ?? e) };
  }
}

/**
 * Every figure the company has tagged in its filings (data.sec.gov/api/xbrl/companyfacts), or undefined when there
 * is nothing to ask: no CIK on file, or SEC_USER_AGENT isn't set. Throws when SEC fails. The caller keeps only the
 * mapped rows, because the files run to several MB.
 */
export async function secCompanyFacts(symbol: string, env: Record<string, string | undefined> = process.env): Promise<CompanyFacts | undefined> {
  const cik = cikFor(universe.members as { symbol: string; cik?: string }[], symbol);
  const ua = secUserAgent(env);
  if (!cik || !ua) return undefined;
  const key = `facts:${padCik(cik)}`;
  if ((failedUntil.get(key) ?? 0) > Date.now()) throw new Error("SEC EDGAR did not respond a few minutes ago");
  try {
    await pace();
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`, {
      headers: { "User-Agent": ua, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 404) return undefined;
    if (res.status === 403) throw new Error("SEC refused the request. Check that SEC_USER_AGENT names the app and a contact email.");
    if (!res.ok) throw new Error(`SEC EDGAR returned HTTP ${res.status}`);
    return (await res.json()) as CompanyFacts;
  } catch (e) {
    failedUntil.set(key, Date.now() + RETRY_AFTER_MS);
    throw (e as { name?: string })?.name === "TimeoutError" ? new Error("SEC EDGAR did not respond in time") : e;
  }
}
