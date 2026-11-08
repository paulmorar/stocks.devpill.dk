"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchJson, getReport, scoreDelta, useMany, useWatchlist } from "@/lib/client";
import type { LongTermReport } from "@/lib/analyze";
import { Only, useMode } from "@/components/mode";
import { Disclaimer, ScoreCardMini, SkeletonCard, Term } from "@/components/ui";

type Meta = { demo: boolean; fmp: boolean; demoSymbols: string[] };
type ScreenHit = { symbol: string; name: string };

const LISTS = [
  { id: "watchlist", label: "My watchlist" },
  { id: "undervalued_large_caps", label: "Undervalued large caps" },
  { id: "growth_technology_stocks", label: "Growth tech" },
  { id: "portfolio_anchors", label: "Portfolio anchors" },
  { id: "undervalued_growth_stocks", label: "Undervalued growth" },
] as const;

type SortKey = "score" | "rs" | "symbol";

export default function Home() {
  const { mode } = useMode();
  const wl = useWatchlist();
  const [meta, setMeta] = useState<Meta>();
  const [tab, setTab] = useState<(typeof LISTS)[number]["id"]>("watchlist");
  const [screen, setScreen] = useState<ScreenHit[]>([]);
  const [screenErr, setScreenErr] = useState<string>();
  const [radarOnly, setRadarOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("score");

  useEffect(() => {
    fetchJson<Meta>("/api/meta").then(setMeta).catch(() => setMeta({ demo: false, fmp: false, demoSymbols: [] }));
  }, []);

  useEffect(() => {
    if (tab === "watchlist") return;
    setScreen([]);
    setScreenErr(undefined);
    fetchJson<ScreenHit[]>(`/api/screen?id=${tab}&count=25`).then(setScreen).catch((e) => setScreenErr(e.message));
  }, [tab]);

  const symbols = useMemo(() => {
    if (!meta) return [];
    if (meta.demo) return meta.demoSymbols;
    if (tab === "watchlist") return wl.ready ? wl.list : [];
    return screen.map((s) => s.symbol);
  }, [meta, tab, wl.ready, wl.list, screen]);

  const { data, errors, pending } = useMany<LongTermReport>(symbols, getReport, 3);
  const [deltas, setDeltas] = useState<Record<string, number | undefined>>({});
  useEffect(() => {
    const d: Record<string, number | undefined> = {};
    for (const [s, r] of Object.entries(data)) if (r.score.scorable) d[s] = scoreDelta(s, r.score.total);
    setDeltas(d);
  }, [data]);

  const reports = symbols.map((s) => data[s]).filter((r): r is LongTermReport => !!r);
  const sorted = [...reports]
    .filter((r) => !radarOnly || (r.score.scorable && r.score.total >= 80))
    .sort((a, b) => {
      if (sort === "symbol") return a.profile.symbol.localeCompare(b.profile.symbol);
      if (sort === "rs") return (b.trend?.rs ?? -9) - (a.trend?.rs ?? -9);
      return (b.score.scorable ? b.score.total : -1) - (a.score.scorable ? a.score.total : -1);
    });
  const turningUp = reports.filter((r) => r.score.scorable && r.score.total >= 65 && r.trend?.state === "Recovering");
  const callouts = tab === "watchlist" ? reports.filter((r) => r.trend?.state === "Downtrend" || r.score.redFlags.length > 0) : [];
  const loadingCount = Math.max(0, symbols.length - reports.length - Object.keys(errors).filter((e) => symbols.includes(e)).length);

  return (
    <div className="stack">
      <section className="panel">
        <Only mode="beginner">
          <h1>Is this a good company, at a fair price?</h1>
          <p className="muted">
            Every company gets a score from 0 to 100 based on four questions: is the price fair, is it growing, is it a really good
            business, and is it financially safe? Next to the score you&apos;ll see the <b>trend</b> — whether the stock price has been going up or down.
            The two are kept separate on purpose: a great company can have a falling price, and that disagreement is often the most interesting part.
          </p>
          <p className="small muted">Tap any card to see every check explained. Hover underlined words like <Term id="pe" /> for a definition.</p>
        </Only>
        <Only mode="expert">
          <h1>Long-term scorecard</h1>
          <p className="muted small">
            0–100 fundamentals score (Value 25 · Growth 25 · Quality 30 · Health 20) with partial credit, own-history valuation, TTM-inclusive trends,
            red-flag caps (59 / 39), F and CAPEX scorecards. Trend from the 200-DMA with 12-1 RS and industry momentum, never blended.
          </p>
        </Only>
        {meta?.demo && <div className="banner info small" style={{ marginTop: 8 }}>Demo mode: showing fictional sample companies with made-up numbers.</div>}
        {meta && !meta.demo && !meta.fmp && (
          <p className="tiny faint" style={{ marginTop: 6 }}>Second data source off: add <code>FMP_API_KEY</code> to unlock the 10-year checks.</p>
        )}
      </section>

      {turningUp.length > 0 && (
        <section className="banner info">
          <b>Turning up:</b>{" "}
          {turningUp.map((r, i) => (
            <span key={r.profile.symbol}>
              {i > 0 && ", "}
              <Link href={`/stock/${r.profile.symbol}`}>{r.profile.symbol}</Link> ({r.score.total})
            </span>
          ))}
          <span className="muted small">
            {" "}— {mode === "expert" ? "65+ score, just reclaimed the 200-day after months below." : "good companies whose price just started climbing again after a slump."}
          </span>
        </section>
      )}
      {callouts.length > 0 && (
        <section className="banner warn small">
          <b>Watch out:</b>{" "}
          {callouts.map((r, i) => (
            <span key={r.profile.symbol}>
              {i > 0 && " · "}
              <Link href={`/stock/${r.profile.symbol}`}>{r.profile.symbol}</Link>{" "}
              {[r.trend?.state === "Downtrend" ? "downtrend" : "", r.score.redFlags.length ? `${r.score.redFlags.length} red flag${r.score.redFlags.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ")}
            </span>
          ))}
        </section>
      )}

      <div className="row between">
        {!meta?.demo && (
          <div className="tabs">
            {LISTS.map((l) => (
              <button key={l.id} className={tab === l.id ? "on" : ""} onClick={() => setTab(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        )}
        <div className="row small">
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={radarOnly} onChange={(e) => setRadarOnly(e.target.checked)} /> On the radar (80+)
          </label>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
            <option value="score">Sort: score</option>
            <option value="rs">Sort: relative strength</option>
            <option value="symbol">Sort: A–Z</option>
          </select>
        </div>
      </div>

      {tab !== "watchlist" && !meta?.demo && (
        <p className="tiny faint">
          Candidates come from Yahoo&apos;s &ldquo;{LISTS.find((l) => l.id === tab)?.label}&rdquo; screen, then get scored here. {screenErr && <span className="band-red">Screen failed: {screenErr}</span>}
        </p>
      )}

      <div className="grid cards">
        {sorted.map((r) => (
          <ScoreCardMini key={r.profile.symbol} r={r} delta={deltas[r.profile.symbol]} />
        ))}
        {pending > 0 && Array.from({ length: Math.min(loadingCount, 6) }, (_, i) => <SkeletonCard key={`sk${i}`} />)}
      </div>

      {Object.keys(errors).filter((s) => symbols.includes(s)).length > 0 && (
        <details className="small muted">
          <summary>{Object.keys(errors).filter((s) => symbols.includes(s)).length} couldn&apos;t load</summary>
          {Object.entries(errors).filter(([s]) => symbols.includes(s)).map(([s, e]) => (
            <div key={s}>
              <b>{s}</b>: {e}
            </div>
          ))}
        </details>
      )}
      {tab === "watchlist" && wl.ready && !meta?.demo && wl.list.length === 0 && (
        <p className="muted">Your watchlist is empty. Search for a company above and press &ldquo;Add to watchlist&rdquo;.</p>
      )}
      <Disclaimer />
    </div>
  );
}
