"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { LongTermReport } from "@/lib/analyze";
import { getReport, scoreDelta, useWatchlist } from "@/lib/client";
import { fx, money, pct, signedPct } from "@/lib/util";
import { Explain, Only, useMode } from "@/components/mode";
import { Chips, Disclaimer, LineChart, RocketGauge, Term, TrendBadge } from "@/components/ui";

export default function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = use(params);
  const symbol = decodeURIComponent(raw).toUpperCase();
  const { mode } = useMode();
  const wl = useWatchlist();
  const [r, setR] = useState<LongTermReport>();
  const [err, setErr] = useState<string>();
  const [delta, setDelta] = useState<number>();

  useEffect(() => {
    setR(undefined);
    setErr(undefined);
    getReport(symbol)
      .then((rep) => {
        setR(rep);
        if (rep.score.scorable) setDelta(scoreDelta(symbol, rep.score.total));
      })
      .catch((e) => setErr(e.message));
  }, [symbol]);

  if (err) {
    return (
      <div className="panel">
        <h1>{symbol}</h1>
        <p className="band-red">Couldn&apos;t load this one: {err}</p>
        <Link href="/">← Back</Link>
      </div>
    );
  }
  if (!r) return <div className="skeleton" style={{ height: 420 }} />;

  const s = r.score;
  const m = r.market;
  const cur = r.profile.currency;

  return (
    <div className="stack">
      <section className="row between">
        <div>
          <h1 style={{ marginBottom: 2 }}>
            {r.profile.name} <span className="muted">({r.profile.symbol})</span>
          </h1>
          <div className="row small muted">
            <span className="num" style={{ color: "var(--text)", fontSize: 18, fontWeight: 700 }}>
              {fx(m.price, 2)} {cur}
            </span>
            {m.changePct !== undefined && (
              <span className={`num ${m.changePct >= 0 ? "band-green" : "band-red"}`}>{signedPct(m.changePct, 2)} today</span>
            )}
            <span>{[r.profile.sector, r.profile.industry].filter(Boolean).join(" · ")}</span>
            {m.marketCap !== undefined && <span>Market cap {money(m.marketCap, cur)}</span>}
            <Chips r={r} />
          </div>
        </div>
        <div className="row">
          <Link className="btn" href={`/day?symbol=${encodeURIComponent(symbol)}`}>Day-trading view</Link>
          {wl.ready && (
            <button className={`btn ${wl.has(symbol) ? "" : "primary"}`} onClick={() => (wl.has(symbol) ? wl.remove(symbol) : wl.add(symbol))}>
              {wl.has(symbol) ? "Remove from watchlist" : "Add to watchlist"}
            </button>
          )}
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="row" style={{ alignItems: "flex-start", gap: 18 }}>
            {s.scorable ? (
              <div style={{ textAlign: "center" }}>
                <RocketGauge score={s.total} band={s.band} />
                {delta !== undefined && delta !== 0 && (
                  <div className={`small num ${delta > 0 ? "band-green" : "band-red"}`}>
                    {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} since last week
                  </div>
                )}
                {s.cap !== undefined && <div className="tiny band-red">Capped from {s.raw} by red flags</div>}
              </div>
            ) : null}
            <div style={{ flex: 1, minWidth: 220 }}>
              <h2>{s.scorable ? (mode === "expert" ? "Business score" : "How good is the business?") : "Not scored"}</h2>
              <Explain e={r.summary} />
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="row between" style={{ alignItems: "flex-start" }}>
            <div>
              <h2>{mode === "expert" ? "Trend" : "What is the price doing?"}</h2>
              <TrendBadge t={r.trend} />
            </div>
            {r.trend?.industryProxy && r.trend.industryProxy !== "SPY" && (
              <span className="tiny faint">Industry proxy: {r.trend.industryProxy}</span>
            )}
          </div>
          {r.trend && (
            <>
              <LineChart
                xKey="date"
                data={r.trend.chart}
                height={170}
                series={[
                  { key: "close", color: "#eef0f4", label: "Price", width: 1.4 },
                  { key: "ma50", color: "#61dafb", label: "50-day avg" },
                  { key: "ma200", color: "#f4b740", label: "200-day avg", width: 2 },
                ]}
              />
              <Explain e={r.trend.explain} />
            </>
          )}
        </div>
      </section>

      {r.quadrant && (
        <section className="banner info">
          <b>{r.quadrant.title}.</b> {mode === "expert" ? r.quadrant.expert : r.quadrant.simple}
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {mode === "expert" ? "Score rates the business; trend shows the market. They're never blended." : "The score is about the company. The trend is about what other investors are doing. When they disagree, that's worth digging into."}
          </div>
        </section>
      )}

      {s.redFlags.length > 0 && (
        <section className="banner risk">
          <b>Red flags</b> — {mode === "expert" ? `cap the score at ${s.redFlags.length >= 2 ? 39 : 59}.` : "a cheap price can't make up for these."}
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {s.redFlags.map((f) => (
              <li key={f.id}>
                <b>{f.label}.</b> <span className="muted">{mode === "expert" ? f.explain.expert : f.explain.simple}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.notes.length > 0 && (
        <section className="small muted">
          {s.notes.map((n) => (
            <div key={n}>• {n}</div>
          ))}
        </section>
      )}

      {s.scorable && (
        <section className="grid two">
          {s.pillars.map((p) => (
            <div className="panel" key={p.id}>
              <div className="row between">
                <h2 style={{ marginBottom: 0 }}>{p.label}</h2>
                <span className={`num band-${s.band}`} style={{ fontWeight: 700 }}>
                  {fx(p.points, 1)} / {p.maxPoints}
                </span>
              </div>
              <p className="muted small">{mode === "expert" ? p.question : p.simpleQuestion}</p>
              <div className="bar" style={{ marginBottom: 6 }}>
                <i className={`bg-${s.band}`} style={{ width: `${(p.points / p.maxPoints) * 100}%` }} />
              </div>
              {p.checks.map((c) => (
                <div key={c.id} className={`check ${c.score === undefined ? "skipped" : ""}`}>
                  <div className="head">
                    <div>
                      <b>{c.label}</b> <span className="num muted small">{c.display}</span>
                    </div>
                    <span className="pts">{c.score === undefined ? "skipped" : `${fx(c.points, 1)}/${fx(c.maxPoints, 1)}`}</span>
                  </div>
                  {c.score !== undefined && (
                    <div className="bar" style={{ height: 4, margin: "6px 0" }}>
                      <i className={`bg-${s.band}`} style={{ width: `${c.score * 100}%` }} />
                    </div>
                  )}
                  <Explain e={c.explain} className="small" />
                  <Only mode="expert">
                    <div className="tiny faint">Scale: {c.rule}</div>
                  </Only>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <details open={mode === "expert"}>
          <summary style={{ cursor: "pointer" }}>
            <h2 style={{ display: "inline" }}>Financial history</h2>{" "}
            <span className="small muted">{mode === "beginner" ? "(the raw numbers behind the score)" : ""}</span>
          </summary>
          <FinancialTable r={r} />
        </details>
      </section>

      <section className="panel small">
        <h3>What this score is not</h3>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>Not a buy or sell signal</b> — {mode === "expert" ? "a starting point for your own research." : "it tells you where to start looking, not what to do."}</li>
          <li><b>Not a risk rating</b> — {mode === "expert" ? "near-perfect fundamentals didn't stop META falling ~75% from its 2021 peak to its 2022 low." : "even great companies' stocks can fall a lot. Facebook's owner lost about three-quarters of its value in 2022 despite strong finances."}</li>
          <li><b>Not a forecast</b> — {mode === "expert" ? "forward-looking checks rely on analyst estimates." : "some checks use experts' guesses about the future, and those can be wrong."}</li>
        </ul>
        <p className="tiny faint" style={{ marginTop: 8 }}>
          Sources: {r.sources.join(" + ")} · {s.yearsOfHistory} fiscal years · fetched {new Date(r.fetchedAt).toLocaleString()}
          {r.warnings.map((w) => (
            <span key={w}>
              <br />⚠ {w}
            </span>
          ))}
        </p>
        <Disclaimer />
      </section>
    </div>
  );
}

function FinancialTable({ r }: { r: LongTermReport }) {
  const rows = [...r.annual].slice(-10);
  const cur = r.profile.currency;
  const cols: { label: string; term?: Parameters<typeof Term>[0]["id"]; get: (x: (typeof rows)[number]) => string }[] = [
    { label: "Revenue", get: (x) => money(x.revenue, cur) },
    { label: "Operating income", get: (x) => money(x.operatingIncome, cur) },
    { label: "Op. margin", term: "margin", get: (x) => (x.revenue && x.operatingIncome !== undefined ? pct(x.operatingIncome / x.revenue) : "—") },
    { label: "Net income", get: (x) => money(x.netIncome, cur) },
    { label: "EPS", term: "eps", get: (x) => fx(x.eps, 2) },
    { label: "Free cash flow", term: "fcf", get: (x) => money(x.freeCashFlow, cur) },
    { label: "Capex", get: (x) => money(x.capex, cur) },
    { label: "Depreciation", get: (x) => money(x.da, cur) },
    { label: "Debt", get: (x) => money(x.totalDebt, cur) },
    { label: "Equity", get: (x) => money(x.equity, cur) },
    { label: "Diluted shares", get: (x) => (x.dilutedShares ? `${(x.dilutedShares / 1e6).toFixed(0)}M` : "—") },
    { label: "Source", get: (x) => x.sources.join("+") },
  ];
  return (
    <div className="scroll-x" style={{ marginTop: 10 }}>
      <table>
        <thead>
          <tr>
            <th>Fiscal year</th>
            {rows.map((x) => (
              <th key={x.fy} className="num">{x.fy}</th>
            ))}
            {r.ttm && <th className="num">TTM</th>}
          </tr>
        </thead>
        <tbody>
          {cols.map((c) => (
            <tr key={c.label}>
              <td>{c.term ? <Term id={c.term}>{c.label}</Term> : c.label}</td>
              {rows.map((x) => (
                <td key={x.fy} className="num">{c.get(x)}</td>
              ))}
              {r.ttm && <td className="num">{c.label === "Debt" || c.label === "Equity" ? "—" : c.get(r.ttm)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
