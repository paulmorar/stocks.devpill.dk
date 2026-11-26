import "server-only";
import universe from "../../data/universe.json";
import { cached, TTL } from "./cache";
import { demoMode } from "./index";
import { isDemoSymbol } from "./demo";
import {
  cikFor, edgarLinks, type Filings, type FilingsResult, isForeignListing, normalizeSymbol, padCik, parseSubmissions, parseTickerList, PREDECESSOR_CIKS,
  secUserAgent,
} from "./sec-map";
import { type CompanyFacts, mergeFacts } from "./sec-facts";

/**
 * Latest annual and quarterly report links from SEC EDGAR, and the company facts behind the older years of the
 * statement history. S&P 500 / Nasdaq-100 members have a CIK on file (src/data/universe.json); other US listings
 * are looked up in SEC's ticker list.
 */

const TIMEOUT_MS = 8000;
/** SEC allows 10 requests a second; one instance stays well below that. */
const GAP_MS = 150;
/** After a failure, wait before asking SEC about the same company again. */
const RETRY_AFTER_MS = 10 * 60_000;
/** Between attempts at the same company facts, when SEC_FACTS_ATTEMPTS allows more than one (the weekly scan). */
const ATTEMPT_GAP_MS = 2000;

let nextSlot = 0;
const failedUntil = new Map<string, number>();

async function pace() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/**
 * The CIK on file for index members. Other US listings, such as Novo Nordisk's ADR, are found in SEC's ticker list,
 * which is fetched once per 12 hours. Undefined for non-US listings, or when SEC_USER_AGENT isn't set.
 */
async function lookupCik(symbol: string, ua: string | undefined): Promise<string | undefined> {
  const onFile = cikFor(universe.members as { symbol: string; cik?: string }[], symbol);
  if (onFile || !ua || isForeignListing(symbol)) return onFile;
  if ((failedUntil.get("tickers") ?? 0) > Date.now()) return undefined;
  try {
    const list = await cached("sec:tickers", TTL.filings, async () => {
      await pace();
      const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
        headers: { "User-Agent": ua, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`SEC EDGAR returned HTTP ${res.status}`);
      return parseTickerList(await res.json());
    });
    return list.get(normalizeSymbol(symbol));
  } catch {
    failedUntil.set("tickers", Date.now() + RETRY_AFTER_MS);
    return undefined;
  }
}

export async function getFilings(symbol: string, env: Record<string, string | undefined> = process.env): Promise<FilingsResult> {
  const sym = symbol.toUpperCase();
  if (demoMode() || isDemoSymbol(sym)) return { status: "demo", symbol: sym };
  const ua = secUserAgent(env);
  const cik = await lookupCik(sym, ua);
  if (!cik) return isForeignListing(sym) ? { status: "not-us", symbol: sym } : { status: "unknown-company", symbol: sym, links: edgarLinks(sym) };

  const links = edgarLinks(sym, cik);
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
 * Every figure the company has tagged in its filings (data.sec.gov/api/xbrl/companyfacts), merged with those of any
 * predecessor registrant, or undefined when there is nothing to ask: no CIK found, or SEC_USER_AGENT isn't set.
 * Throws when SEC fails. SEC_FACTS_ATTEMPTS (default 1) allows more attempts after a timeout, 429 or 5xx; the weekly
 * scan sets it, while stock pages stay on one attempt. The caller keeps only the mapped rows, because the files run
 * to several MB.
 */
export async function secCompanyFacts(symbol: string, env: Record<string, string | undefined> = process.env): Promise<CompanyFacts | undefined> {
  const ua = secUserAgent(env);
  const cik = ua ? await lookupCik(symbol, ua) : undefined;
  if (!ua || !cik) return undefined;
  const attempts = Math.max(1, Math.floor(Number(env.SEC_FACTS_ATTEMPTS)) || 1);
  const ciks = [padCik(cik), ...(PREDECESSOR_CIKS[padCik(cik)] ?? [])];
  return mergeFacts(...(await Promise.all(ciks.map((k) => companyFacts(k, ua, attempts)))));
}

async function companyFacts(cik: string, ua: string, attempts: number): Promise<CompanyFacts | undefined> {
  const key = `facts:${cik}`;
  if ((failedUntil.get(key) ?? 0) > Date.now()) throw new Error("SEC EDGAR did not respond a few minutes ago");
  for (let attempt = 1; ; attempt++) {
    try {
      await pace();
      const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
        headers: { "User-Agent": ua, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.status === 404) return undefined;
      if (res.status === 403) throw Object.assign(new Error("SEC refused the request. Check that SEC_USER_AGENT names the app and a contact email."), { final: true });
      if (!res.ok) throw Object.assign(new Error(`SEC EDGAR returned HTTP ${res.status}`), { final: res.status !== 429 && res.status < 500 });
      return (await res.json()) as CompanyFacts;
    } catch (e) {
      if (attempt >= attempts || (e as { final?: boolean }).final) {
        failedUntil.set(key, Date.now() + RETRY_AFTER_MS);
        throw (e as { name?: string })?.name === "TimeoutError" ? new Error("SEC EDGAR did not respond in time") : e;
      }
      await new Promise((r) => setTimeout(r, ATTEMPT_GAP_MS * attempt));
    }
  }
}
