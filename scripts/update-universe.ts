/**
 * Refresh src/data/universe.json from public sources:
 *  - S&P 500: github.com/datasets/s-and-p-500-companies (CSV, includes each company's SEC CIK)
 *  - Nasdaq-100: Nasdaq's public list API
 *  - SEC company tickers (optional, needs SEC_USER_AGENT): CIKs for the Nasdaq-100 extras
 * Keeps the current file if either index source fails, so a flaky source never empties the universe,
 * and keeps known CIKs when no source has a newer one.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCsvLine } from "../src/lib/csv";
import { normalizeSymbol as yahooSymbol, padCik, secUserAgent } from "../src/lib/data/sec-map";

const FILE = path.join(process.cwd(), "src/data/universe.json");
type Member = { symbol: string; name: string; index: string[]; cik?: string };

async function sp500(): Promise<Member[]> {
  const res = await fetch("https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv");
  if (!res.ok) throw new Error(`S&P 500 CSV ${res.status}`);
  const [header = [], ...rows] = (await res.text()).trim().split("\n").map((line) => parseCsvLine(line.replace(/\r$/, "")));
  const [sym, name, cik] = ["Symbol", "Security", "CIK"].map((c) => header.indexOf(c));
  return rows
    .map((f) => ({
      symbol: yahooSymbol(f[sym as number] ?? ""),
      name: (f[name as number] ?? "").trim(),
      index: ["SP500"],
      cik: /^\d+$/.test(f[cik as number]?.trim() ?? "") ? padCik(f[cik as number] as string) : undefined,
    }))
    .filter((m) => m.symbol);
}

/** SEC's own ticker list. SEC rejects requests without a declared contact, so this only runs with SEC_USER_AGENT set. */
async function secCiks(): Promise<Map<string, string>> {
  const ua = secUserAgent();
  if (!ua) throw new Error("SEC_USER_AGENT is not set (it needs a contact email)");
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": ua, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`SEC company tickers ${res.status}`);
  const body = (await res.json()) as Record<string, { cik_str: number; ticker: string }>;
  return new Map(Object.values(body).map((e) => [yahooSymbol(e.ticker), padCik(e.cik_str)]));
}

async function nasdaq100(): Promise<Member[]> {
  const res = await fetch("https://api.nasdaq.com/api/quote/list-type/nasdaq100", {
    headers: { "User-Agent": "Mozilla/5.0 (stock-scout universe updater)", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Nasdaq-100 API ${res.status}`);
  const body = (await res.json()) as { data?: { data?: { rows?: { symbol: string; companyName: string }[] } } };
  const rows = body.data?.data?.rows ?? [];
  if (rows.length < 90) throw new Error(`Nasdaq-100 API returned ${rows.length} rows`);
  return rows.map((r) => ({ symbol: yahooSymbol(r.symbol), name: r.companyName, index: ["NDX"] }));
}

async function main() {
  const current = JSON.parse(await readFile(FILE, "utf8")) as { members: Member[] };
  const [sp, ndx] = await Promise.allSettled([sp500(), nasdaq100()]);
  const spList = sp.status === "fulfilled" && sp.value.length > 480 ? sp.value : current.members.filter((m) => m.index.includes("SP500"));
  const ndxList = ndx.status === "fulfilled" ? ndx.value : current.members.filter((m) => m.index.includes("NDX"));
  if (sp.status === "rejected") console.warn("S&P 500 source failed, keeping current list:", sp.reason);
  if (ndx.status === "rejected") console.warn("Nasdaq-100 source failed, keeping current list:", ndx.reason);

  const by = new Map<string, Member>();
  for (const m of spList) by.set(m.symbol, { ...m, index: ["SP500"] });
  for (const m of ndxList) {
    const e = by.get(m.symbol);
    if (e) e.index = [...new Set([...e.index, "NDX"])];
    else by.set(m.symbol, { ...m, index: ["NDX"] });
  }
  const members = [...by.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  // CIKs: SEC's list when available, then the S&P 500 CSV, then what the file already had.
  const sec = await secCiks().catch((e) => {
    console.warn("SEC tickers unavailable, using CSV and known CIKs:", (e as Error).message);
    return undefined;
  });
  const known = new Map(current.members.filter((m) => m.cik).map((m) => [m.symbol, m.cik as string]));
  for (const m of members) {
    const cik = sec?.get(m.symbol) ?? m.cik ?? known.get(m.symbol);
    if (cik) m.cik = cik;
    else delete m.cik;
  }
  await writeFile(
    FILE,
    JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), source: "S&P 500: datasets/s-and-p-500-companies; Nasdaq-100: api.nasdaq.com; CIK: SEC or the S&P 500 dataset", members }, null, 0),
  );
  console.log(`Universe: ${members.length} members (${members.filter((m) => m.index.includes("NDX")).length} in Nasdaq-100, ${members.filter((m) => m.cik).length} with a CIK).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
