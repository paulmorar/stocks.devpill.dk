"use client";

import { useRouter } from "next/navigation";
import type { RadarRow } from "@/lib/snapshot";
import { hasLimitedHistory, type PillarId } from "@/lib/scoring/types";
import { TREND_ICON, type TrendState } from "@/lib/trend";
import { signedPct } from "@/lib/util";
import { useMode } from "./mode";
import { HistoryBadge, Term } from "./ui";

/** Ranked list in the layout of TTT's weekly "On the Radar" / "Portfolio Holdings Scores" posts. */

const PILLAR_COLS: { id: PillarId; label: string; max: number }[] = [
  { id: "value", label: "Value", max: 25 },
  { id: "growth", label: "Growth", max: 25 },
  { id: "quality", label: "Quality", max: 30 },
  { id: "health", label: "Fin. health", max: 20 },
];

export function TrendPill({ state }: { state?: TrendState }) {
  if (!state) return <span className="faint small">—</span>;
  return (
    <span className={`trend-pill trend-${state}`}>
      {TREND_ICON[state]} {state}
    </span>
  );
}

export function Delta({ d }: { d?: number | null }) {
  if (d === null) return <span className="delta tiny faint">new</span>;
  if (d === undefined || d === 0) return <span className="delta faint">–</span>;
  return <span className={`delta num ${d > 0 ? "band-lime" : "band-red"}`}>{d > 0 ? "▲" : "▼"}{Math.abs(d)}</span>;
}

export function RankTable({ rows, startRank = 1, showDelta = true }: { rows: RadarRow[]; startRank?: number; showDelta?: boolean }) {
  const router = useRouter();
  const { mode } = useMode();
  return (
    <div className="scroll-x">
      <table className="rank">
        <thead>
          <tr>
            <th className="rank-no">#</th>
            <th>Ticker</th>
            <th>Score</th>
            {PILLAR_COLS.map((c) => (
              <th key={c.id} className="pcol">{c.label}</th>
            ))}
            <th>Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.symbol} className="click" onClick={() => router.push(`/stock/${encodeURIComponent(r.symbol)}`)}>
              <td className="faint num rank-no">{startRank + i}</td>
              <td>
                <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                  <b className="ticker">{r.symbol}</b>
                  {r.scorecard === "financials" && <span className="chip f-outline" title="Financials scorecard">F</span>}
                  {r.capexMode && <span className="chip capex-outline" title="Spending more than 2× depreciation">CAPEX</span>}
                  {r.flags.length > 0 && <span className="band-red" title={r.flags.join("\n")}>⚑{r.flags.length > 1 ? r.flags.length : ""}</span>}
                </div>
                <div className="tiny muted ellipsis">{r.name}</div>
              </td>
              <td>
                {r.scorable ? (
                  <div className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "baseline" }}>
                    <span className={`big-score num band-${r.band}`}>{r.score}</span>
                    {showDelta && <Delta d={r.delta} />}
                  </div>
                ) : (
                  <span className="tiny muted">not scored</span>
                )}
                {r.scorable && <HistoryBadge years={r.yearsOfHistory} />}
                {r.scorable && (
                  <div className="mobile-pillars tiny muted num">
                    V {r.pillars.value} · G {r.pillars.growth}
                    <br />
                    Q {r.pillars.quality} · H {r.pillars.health}
                  </div>
                )}
              </td>
              {PILLAR_COLS.map((c) => {
                const v = r.pillars[c.id] ?? 0;
                return (
                  <td key={c.id} className="pcol">
                    {r.scorable ? (
                      <>
                        <span className="num">
                          <b>{v}</b>
                          <span className="faint">/{c.max}</span>
                        </span>
                        <div className="bar" style={{ marginTop: 4 }}>
                          <i className="bg-lime" style={{ width: `${(v / c.max) * 100}%` }} />
                        </div>
                      </>
                    ) : null}
                  </td>
                );
              })}
              <td>
                <TrendPill state={r.trend} />
                <div className="tiny muted num rsline" style={{ marginTop: 3 }}>
                  RS {r.rs !== undefined ? signedPct(r.rs) : "—"} · Ind {r.ind !== undefined ? signedPct(r.ind) : "—"}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="legend tiny muted">
        <span><i className="sw bg-lime" /> 80+</span>
        <span><i className="sw bg-green" /> 65 to 79</span>
        <span><i className="sw bg-amber" /> 50 to 64</span>
        <span><i className="sw bg-red" /> under 50</span>
        <span><span className="band-red">⚑</span> red flag caps score</span>
        <span><span className="chip f-outline">F</span> financials scorecard</span>
        <span><span className="chip capex-outline">CAPEX</span> spending &gt;2× depreciation</span>
        {rows.some((r) => r.scorable && hasLimitedHistory(r.yearsOfHistory)) && (
          <span>Scores marked Limited history use just four annual reports.</span>
        )}
      </div>
      <p className="tiny faint" style={{ marginTop: 6 }}>
        {mode === "expert" ? (
          <>
            <b>Trend</b> sits beside the score, not inside it: price vs its 200-day average, the average&apos;s slope, and days spent below it over 6 months.{" "}
            <Term id="rs">RS</Term> = 12-month return vs S&amp;P 500 (skipping the last month). <Term id="ind">Ind</Term> = industry peers&apos; 6-month return vs S&amp;P 500.
          </>
        ) : (
          <>
            The <b>score</b> rates the business. The <b>trend</b> shows what the stock price has been doing. <b>RS</b>: did it beat the overall market this year?{" "}
            <b>Ind</b>: did its industry? ▲/▼ next to a score is the change since last week.
          </>
        )}
      </p>
    </div>
  );
}
