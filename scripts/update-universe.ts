/**
 * Refresh src/data/universe.json from public sources:
 *  - S&P 500: github.com/datasets/s-and-p-500-companies (CSV)
 *  - Nasdaq-100: Nasdaq's public list API
 * Keeps the current file if either source fails, so a flaky source never empties the universe.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "src/data/universe.json");
type Member = { symbol: string; name: string; index: string[] };

const yahooSymbol = (s: string) => s.trim().toUpperCase().replace(/\./g, "-");

async function sp500(): Promise<Member[]> {
  const res = await fetch("https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv");
  if (!res.ok) throw new Error(`S&P 500 CSV ${res.status}`);
  const lines = (await res.text()).trim().split("\n").slice(1);
  return lines.map((line) => {
    // Symbol,Security,... — names may contain quoted commas, so only split the first two fields carefully.
    const m = line.match(/^([^,]+),("([^"]*)"|[^,]*)/);
    return { symbol: yahooSymbol(m?.[1] ?? ""), name: (m?.[3] ?? m?.[2] ?? "").trim(), index: ["SP500"] };
  }).filter((m) => m.symbol);
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
  await writeFile(
    FILE,
    JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), source: "S&P 500: datasets/s-and-p-500-companies; Nasdaq-100: api.nasdaq.com", members }, null, 0),
  );
  console.log(`Universe: ${members.length} members (${members.filter((m) => m.index.includes("NDX")).length} in Nasdaq-100).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
