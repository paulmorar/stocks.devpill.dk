/**
 * Compare this app's scores with The Traveling Trader's published ones.
 *
 *   npm run calibrate                 # all 42 reference stocks
 *   npm run calibrate -- --symbols NOW,AAPL
 *
 * Prints per-stock differences, then per-pillar bias (ours − theirs) and mean
 * absolute error, plus trend/F/CAPEX agreement. For pillars that are off by 4+
 * points it lists the individual checks, which is where the sliding-scale
 * thresholds in src/lib/scoring/checks-*.ts should be tuned.
 * Also writes calibration-report.md.
 */
import { writeFile } from "node:fs/promises";
import { TTT_REFERENCE, TTT_REFERENCE_DATE, type TttRef } from "../src/data/ttt-reference";
import { analyzeLongTerm, type LongTermReport } from "../src/lib/analyze";

const only = (() => {
  const i = process.argv.indexOf("--symbols");
  return i > -1 ? process.argv[i + 1]?.split(",").map((s) => s.trim().toUpperCase()) : undefined;
})();

const PILLARS = [
  ["value", "v", "Value"],
  ["growth", "g", "Growth"],
  ["quality", "q", "Quality"],
  ["health", "h", "Health"],
] as const;

async function main() {
  const refs = only ? TTT_REFERENCE.filter((r) => only.includes(r.symbol)) : TTT_REFERENCE;
  const results: { ref: TttRef; rep?: LongTermReport; err?: string }[] = [];
  const queue = [...refs];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const ref = queue.shift()!;
        try {
          results.push({ ref, rep: await analyzeLongTerm(ref.symbol) });
        } catch (e) {
          results.push({ ref, err: String((e as Error).message ?? e) });
        }
        process.stdout.write(".");
      }
    }),
  );
  console.log("\n");
  results.sort((a, b) => b.ref.score - a.ref.score);

  const out: string[] = [];
  const log = (s = "") => {
    console.log(s);
    out.push(s);
  };
  log(`# Calibration vs TTT (${TTT_REFERENCE_DATE})\n`);
  log("| Ticker | TTT | Ours | Δ | V (TTT/ours) | G | Q | H | Trend (TTT/ours) | F/CAPEX (TTT/ours) |");
  log("|---|---|---|---|---|---|---|---|---|---|");

  const diffs: Record<string, number[]> = { total: [], v: [], g: [], q: [], h: [] };
  let trendAgree = 0;
  let fAgree = 0;
  let capexAgree = 0;
  let n = 0;
  const detail: string[] = [];

  for (const { ref, rep, err } of results) {
    if (!rep) {
      log(`| ${ref.symbol} | ${ref.score} | error | | | | | | | ${err?.slice(0, 60)} |`);
      continue;
    }
    n++;
    const s = rep.score;
    const p = Object.fromEntries(s.pillars.map((x) => [x.id, x.points]));
    const ours = { v: p.value ?? 0, g: p.growth ?? 0, q: p.quality ?? 0, h: p.health ?? 0 };
    diffs.total!.push(s.total - ref.score);
    for (const [, k] of PILLARS) diffs[k]!.push(ours[k] - ref[k]);
    if (rep.trend?.state === ref.trend) trendAgree++;
    const isF = s.scorecard === "financials";
    if (isF === !!ref.f) fAgree++;
    if (s.capexMode === !!ref.capex) capexAgree++;
    const cell = (k: "v" | "g" | "q" | "h") => `${ref[k]}/${Math.round(ours[k])}`;
    log(
      `| ${ref.symbol} | ${ref.score} | ${s.total} | ${s.total - ref.score > 0 ? "+" : ""}${s.total - ref.score} | ${cell("v")} | ${cell("g")} | ${cell("q")} | ${cell("h")} | ${ref.trend}/${rep.trend?.state ?? "—"} | ${ref.f ? "F" : ""}${ref.capex ? "C" : ""}/${isF ? "F" : ""}${s.capexMode ? "C" : ""} |`,
    );

    for (const [id, k, label] of PILLARS) {
      const gap = ours[k] - ref[k];
      if (Math.abs(gap) < 4) continue;
      const pillar = s.pillars.find((x) => x.id === id)!;
      detail.push(
        `- **${ref.symbol} ${label}** TTT ${ref[k]}, ours ${ours[k].toFixed(1)} (${gap > 0 ? "+" : ""}${gap.toFixed(1)}): ` +
          pillar.checks.map((c) => `${c.id} ${c.score === undefined ? "skip" : c.score.toFixed(2)} [${c.display}]`).join("; "),
      );
    }
  }

  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const mae = (a: number[]) => mean(a.map(Math.abs));
  log(`\n## Summary (${n} stocks)\n`);
  log("| | Bias (ours − TTT) | Mean abs. error |");
  log("|---|---|---|");
  log(`| Total | ${mean(diffs.total!).toFixed(1)} | ${mae(diffs.total!).toFixed(1)} |`);
  for (const [, k, label] of PILLARS) log(`| ${label} | ${mean(diffs[k]!).toFixed(1)} | ${mae(diffs[k]!).toFixed(1)} |`);
  log(`\nTrend agreement ${trendAgree}/${n} · F agreement ${fAgree}/${n} · CAPEX agreement ${capexAgree}/${n}`);
  log("\nA positive bias means this app scores that pillar more generously than TTT: tighten its scales (or loosen if negative).");
  if (detail.length) {
    log("\n## Pillars off by 4+ points\n");
    for (const d of detail) log(d);
  }
  await writeFile("calibration-report.md", out.join("\n") + "\n");
  console.log("\nWrote calibration-report.md");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
