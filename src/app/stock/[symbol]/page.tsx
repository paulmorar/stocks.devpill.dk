"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import type { LongTermReport } from "@/lib/analyze";
import { LONG_TERM, reportUrl, scoreDelta, useCached, useRecent, useSnapshot } from "@/lib/client";
import { tttRef, TTT_REFERENCE_DATE } from "@/data/ttt-reference";
import { pushRecent } from "@/lib/search";
import { newerTtm } from "@/lib/scoring/metrics";
import { TREND_ICON } from "@/lib/trend";
import { currencyUnit, fx, money, pct, signedPct } from "@/lib/util";
import { FilingsPanel } from "@/components/filings";
import { DataFreshness, QuoteTime } from "@/components/freshness";
import { AddToLists, usePortfolio, useWatchlist } from "@/components/lists";
import { Explain, Only, useMode } from "@/components/mode";
import { StockNews } from "@/components/news";
import { InteractiveChart } from "@/components/tv-chart";
import { Chips, Disclaimer, LineChart, RocketGauge, Term, TrendBadge, Updating } from "@/components/ui";

export default function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = use(params);
  const symbol = decodeURIComponent(raw).toUpperCase();
  const { mode } = useMode();
  const wl = useWatchlist();
  const pf = usePortfolio();
  const recent = useRecent();
  const { snap, error: snapError } = useSnapshot();
  const { data: r, error: err, updating } = useCached<LongTermReport>(reportUrl(symbol), LONG_TERM);
  const [delta, setDelta] = useState<number>();
  const recorded = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!r) return;
    // Only symbols that actually loaded go into the search box's recent list.
    if (recorded.current !== symbol) {
      recorded.current = symbol;
      recent.update((l) => pushRecent(l, symbol));
    }
    setDelta(r.score.scorable ? scoreDelta(symbol, r.score.total) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, symbol]);

  if (err && !r) {
    return (
      <div className="panel">
        <h1>{symbol}</h1>
        <p className="band-red">Couldn&apos;t load this one: {err}</p>
        <Link href="/">← Back</Link>
      </div>
    );
  }
  if (!r) return <div className="skeleton" style={{ height: 420 }} />;

  const weekly = snap?.rows.find((x) => x.symbol === symbol);
  const lastWeek = weekly && typeof weekly.delta === "number" ? weekly.score - weekly.delta : undefined;
  const weekDelta = lastWeek !== undefined && r.score.scorable ? r.score.total - lastWeek : delta;
  const ref = tttRef(symbol);

  const s = r.score;
  const m = r.market;
  const quoted = r.profile.tradingCurrency ?? r.profile.currency;

  return (
    <div className="stack">
      <section className="row between">
        <div>
          <h1 style={{ marginBottom: 2 }}>
            {r.profile.name} <span className="muted">({r.profile.symbol})</span>
          </h1>
          <div className="row small muted">
            <span className="num" style={{ color: "var(--text)", fontSize: 18, fontWeight: 700 }}>
              {fx(m.price, 2)} {quoted}
            </span>
            {m.changePct !== undefined && (
              <span className={`num ${m.changePct >= 0 ? "band-green" : "band-red"}`}>{signedPct(m.changePct, 2)}</span>
            )}
            <QuoteTime market={m} />
            <Updating on={updating} />
            <span>{[r.profile.sector, r.profile.industry].filter(Boolean).join(" · ")}</span>
            {m.marketCap !== undefined && <span>Market cap {money(m.marketCap, currencyUnit(quoted).main)}</span>}
            <Chips r={r} />
          </div>
        </div>
        <div className="row">
          <Link className="btn" href={`/day?symbol=${encodeURIComponent(symbol)}`}>Day-trading view</Link>
          {wl.ready && (
            <button className="btn" disabled={wl.saving(symbol)} onClick={() => (wl.has(symbol) ? wl.remove(symbol) : wl.add(symbol))}>
              {wl.saving(symbol) ? "Saving…" : wl.has(symbol) ? "✓ Watching" : "+ Watchlist"}
            </button>
          )}
          {pf.ready && (
            <button
              className={`btn ${pf.has(symbol) ? "" : "primary"}`}
              disabled={pf.saving(symbol)}
              onClick={() => (pf.has(symbol) ? pf.remove(symbol) : pf.add(symbol))}
            >
              {pf.saving(symbol) ? "Saving…" : pf.has(symbol) ? "✓ In portfolio" : "+ Portfolio"}
            </button>
          )}
          <AddToLists symbol={symbol} />
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="row" style={{ alignItems: "flex-start", gap: 18 }}>
            {s.scorable ? (
              <div style={{ textAlign: "center" }}>
                <RocketGauge score={s.total} band={s.band} />
                {weekDelta !== undefined && weekDelta !== 0 && (
                  <div className={`small num ${weekDelta > 0 ? "band-green" : "band-red"}`}>
                    {weekDelta > 0 ? "▲" : "▼"} {Math.abs(weekDelta)} since last week
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

      <InteractiveChart symbol={r.profile.symbol} />

      {r.quadrant && (
        <section className="banner info">
          <b>{r.quadrant.title}.</b> {mode === "expert" ? r.quadrant.expert : r.quadrant.simple}
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {mode === "expert" ? "Score rates the business; trend shows the market. They're never blended." : "The score is about the company. The trend is about what other investors are doing. When they disagree, that's worth digging into."}
          </div>
        </section>
      )}

      {ref && s.scorable && (
        <section className="panel small">
          <div className="row between">
            <h3 style={{ marginBottom: 0 }}>{mode === "expert" ? "vs The Traveling Trader" : "What another trader's model says"}</h3>
            <span className="tiny faint">TTT published {new Date(`${TTT_REFERENCE_DATE}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {ref.list === "radar" ? "On the Radar" : "Portfolio holdings"}</span>
          </div>
          <div className="scroll-x">
            <table style={{ marginTop: 6 }}>
              <thead>
                <tr><th></th><th>Score</th><th>Value</th><th>Growth</th><th>Quality</th><th>Fin. health</th><th>Trend</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>TTT</td>
                  <td className="num"><b>{ref.score}</b></td>
                  <td className="num">{ref.v}/25</td><td className="num">{ref.g}/25</td><td className="num">{ref.q}/30</td><td className="num">{ref.h}/20</td>
                  <td>{TREND_ICON[ref.trend]} {ref.trend}</td>
                </tr>
                <tr>
                  <td>Stock Scout</td>
                  <td className={`num band-${s.band}`}><b>{s.total}</b></td>
                  {s.pillars.map((p) => <td key={p.id} className="num">{Math.round(p.points)}/{p.maxPoints}</td>)}
                  <td>{r.trend ? `${TREND_ICON[r.trend.state]} ${r.trend.state}` : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="tiny muted" style={{ marginTop: 6, marginBottom: 0 }}>
            {mode === "expert"
              ? "Same four pillars, independently set thresholds (TTT doesn't publish theirs). Gaps of a few points per pillar are expected; `npm run calibrate` measures them across all 42 published names."
              : "Both use the same four questions, but each decides its own pass marks, so a few points of difference is normal. If they disagree a lot, look at which pillar differs and read why."}
          </p>
        </section>
      )}

      {s.redFlags.length > 0 && (
        <section className="banner risk">
          <b>Red flags.</b> {mode === "expert" ? `These cap the score at ${s.redFlags.length >= 2 ? 39 : 59}.` : "These problems limit the score, even if the price looks cheap."}
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

      <StockNews symbol={r.profile.symbol} />

      <section className="panel">
        <details open={mode === "expert"}>
          <summary style={{ cursor: "pointer" }}>
            <h2 style={{ display: "inline" }}>Financial history</h2>{" "}
            <span className="small muted">{mode === "beginner" ? "(the raw numbers behind the score)" : ""}</span>
          </summary>
          <FinancialTable r={r} />
        </details>
      </section>

      <section className="grid two">
        <FilingsPanel symbol={r.profile.symbol} />
        <DataFreshness r={r} snap={snap} snapError={snapError} />
      </section>

      <section className="panel small">
        <h3>What this score is not</h3>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>This is not a buy or sell signal. {mode === "expert" ? "Use it as a starting point for your own research." : "Use it to decide what to research, not what to trade."}</li>
          <li>A strong score does not mean low risk. {mode === "expert" ? "META fell about 75% from its 2021 peak to its 2022 low despite strong fundamentals." : "Even companies with strong finances can lose much of their share value. Facebook's owner lost about three-quarters of its value in 2022."}</li>
          <li>This is not a forecast. {mode === "expert" ? "Forward-looking checks rely on analyst estimates, which can be wrong." : "Some checks use analysts' estimates of future earnings. Those estimates can be wrong."}</li>
        </ul>
        {r.warnings.length > 0 && (
          <p className="tiny faint" style={{ marginTop: 8 }}>
            {r.warnings.map((w, i) => (
              <span key={w}>
                {i > 0 && <br />}⚠ {w}
              </span>
            ))}
          </p>
        )}
        <Disclaimer />
      </section>
    </div>
  );
}

function FinancialTable({ r }: { r: LongTermReport }) {
  const rows = [...r.annual].slice(-10);
  // Same rule as the score: a TTM that ends with the last fiscal year would only repeat that column.
  const ttm = newerTtm(r.annual.at(-1), r.ttm);
  const cur = r.profile.currency;
  const quoted = r.profile.tradingCurrency ?? cur;
  const unit = currencyUnit(quoted);
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
            {ttm && <th className="num">TTM</th>}
          </tr>
        </thead>
        <tbody>
          {cols.map((c) => (
            <tr key={c.label}>
              <td>{c.term ? <Term id={c.term}>{c.label}</Term> : c.label}</td>
              {rows.map((x) => (
                <td key={x.fy} className="num">{c.get(x)}</td>
              ))}
              {ttm && <td className="num">{c.label === "Debt" || c.label === "Equity" ? "—" : c.get(ttm)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {quoted !== cur && (
        <p className="tiny muted" style={{ marginTop: 6 }}>
          Reported in {cur}. The share price is quoted in {quoted}
          {unit.perMain > 1 && ` (hundredths of a ${unit.main})`}. Checks that compare the price with these figures convert
          it to {cur} first{unit.main !== cur && ", at the exchange rate of the day"}.
        </p>
      )}
    </div>
  );
}
