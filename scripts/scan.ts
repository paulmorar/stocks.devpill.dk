/**
 * Weekly universe scan. Scores every S&P 500 + Nasdaq-100 company and writes
 *   src/data/snapshots/<date>.json   (history, last 26 kept)
 *   src/data/snapshots/latest.json   (what the app serves)
 *
 *   npm run scan                          # whole universe
 *   npm run scan -- --symbols AAPL,MSFT   # just these (merged into latest)
 *   npm run scan -- --limit 40            # first N, for a quick test
 *
 * Runs in GitHub Actions every Sunday (.github/workflows/weekly-scan.yml).
 * Needs network access to Yahoo (and FMP if FMP_API_KEY is set).
 */
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import universe from "../src/data/universe.json" with { type: "json" };
import { analyzeLongTerm } from "../src/lib/analyze";
import { getCloses } from "../src/lib/data";
import { industryMomentum, rank, type RadarRow, type Snapshot, toRow, withDeltas } from "../src/lib/snapshot";
import { hasLimitedHistory } from "../src/lib/scoring/types";

const DIR = path.join(process.cwd(), "src/data/snapshots");
const KEEP = 26;

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function readSnapshot(file: string): Promise<Snapshot | undefined> {
  try {
    return JSON.parse(await readFile(path.join(DIR, file), "utf8")) as Snapshot;
  } catch {
    return undefined;
  }
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String((e as Error)?.message ?? e);
      // Unknown symbol or no data: retrying won't help.
      if (/no quote|not found|404|Only \d+ years/i.test(msg)) break;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1) ** 2));
    }
  }
  throw last;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const only = arg("symbols")?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const limit = Number(arg("limit") ?? 0) || undefined;
  const concurrency = Number(arg("concurrency") ?? 3) || 3;

  const members = universe.members as { symbol: string; name: string; index: string[] }[];
  let targets = only ? only.map((s) => members.find((m) => m.symbol === s) ?? { symbol: s, name: s, index: [] }) : members;
  if (limit) targets = targets.slice(0, limit);

  await mkdir(DIR, { recursive: true });
  const files = (await readdir(DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const prevFile = [...files].reverse().find((f) => f.slice(0, 10) < today);
  const prev = prevFile ? await readSnapshot(prevFile) : undefined;
  const existingToday = only ? await readSnapshot("latest.json") : undefined;

  console.log(`Scanning ${targets.length} symbols (concurrency ${concurrency}); previous snapshot: ${prevFile ?? "none"}`);
  const rows: RadarRow[] = [];
  const failed: Snapshot["failed"] = [];
  const queue = [...targets];
  let done = 0;
  const started = Date.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const m = queue.shift()!;
        try {
          const rep = await withRetry(() => analyzeLongTerm(m.symbol));
          rows.push(toRow(rep, m.index));
        } catch (e) {
          failed.push({ symbol: m.symbol, error: String((e as Error)?.message ?? e).slice(0, 200) });
        }
        done++;
        if (done % 25 === 0 || done === targets.length) {
          const secs = Math.round((Date.now() - started) / 1000);
          console.log(`  ${done}/${targets.length} · ${failed.length} failed · ${secs}s`);
        }
      }
    }),
  );

  // A partial run (--symbols) updates those rows inside today's snapshot instead of replacing it.
  let merged = rows;
  if (existingToday && only) {
    const fresh = new Set(rows.map((r) => r.symbol));
    merged = [...existingToday.rows.filter((r) => !fresh.has(r.symbol)), ...rows];
  }

  // Industry momentum from this week's peers, applied to every row in the industry.
  const spy = await getCloses("SPY", 200).catch(() => []);
  const spy6 = spy.length > 127 ? spy.at(-1)!.close / spy[spy.length - 127]!.close - 1 : undefined;
  const industries = spy6 !== undefined ? industryMomentum(merged, spy6) : {};
  merged = merged.map((r) => (r.industry && industries[r.industry] ? { ...r, ind: industries[r.industry]!.ind } : r));

  const snapshot: Snapshot = {
    date: today,
    generatedAt: new Date().toISOString(),
    universe: "S&P 500 + Nasdaq 100",
    previousDate: prev?.date,
    attempted: only && existingToday ? existingToday.attempted : targets.length,
    spy6: spy6 !== undefined ? Math.round(spy6 * 1000) / 1000 : undefined,
    industries,
    rows: rank(withDeltas(merged, prev)).concat(merged.filter((r) => !r.scorable)),
    failed,
  };

  const json = JSON.stringify(snapshot);
  await writeFile(path.join(DIR, `${today}.json`), json);
  await writeFile(path.join(DIR, "latest.json"), json);

  // Prune old history.
  const all = (await readdir(DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP))) await unlink(path.join(DIR, f));

  const ranked = rank(snapshot.rows);
  const limited = ranked.filter((r) => hasLimitedHistory(r.yearsOfHistory));
  const radar = ranked.filter((r) => r.score >= 80);
  console.log(`\nDone: ${ranked.length} ranked (${limited.length} limited-history), ${snapshot.rows.length - ranked.length} excluded, ${failed.length} failed, ${radar.length} on the radar (80+).`);
  for (const [i, r] of radar.entries()) {
    const d = r.delta === null || r.delta === undefined ? "new" : r.delta === 0 ? "–" : `${r.delta > 0 ? "▲" : "▼"}${Math.abs(r.delta)}`;
    console.log(`${String(i + 1).padStart(3)} ${r.symbol.padEnd(6)} ${r.score} ${d.padEnd(4)} V${r.pillars.value} G${r.pillars.growth} Q${r.pillars.quality} H${r.pillars.health} ${r.trend ?? ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
