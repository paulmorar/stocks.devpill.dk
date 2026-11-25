"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchJson, getReport, scoreDelta, useMany, useSnapshot } from "@/lib/client";
import type { LongTermReport } from "@/lib/analyze";
import { applyFilters, availableUniverses, DEFAULT_FILTERS, filtersToParams, type Filters, inUniverse, overview, parseFilters, UNIVERSES } from "@/lib/explore";
import { COMPANY_CACHE_HOURS } from "@/lib/freshness";
import { rank, type RadarRow, toRow } from "@/lib/snapshot";
import { TTT_PORTFOLIO } from "@/data/ttt-reference";
import { RankingFilters, SectorTiles, UniverseSwitch } from "@/components/explore";
import { SnapshotAge } from "@/components/freshness";
import { ListsSync, NamedLists, useLists, usePortfolio, useWatchlist } from "@/components/lists";
import { Only, useMode } from "@/components/mode";
import { ListNews } from "@/components/news";
import { RankTable } from "@/components/rank-table";
import { Disclaimer, ScoreCardMini, SkeletonCard, Term } from "@/components/ui";

type Meta = { demo: boolean; fmp: boolean; sec: boolean; demoSymbols: string[] };
type Tab = "radar" | "ranking" | "portfolio" | "watchlist" | "lists" | "discover";
type ScreenId = "undervalued_large_caps" | "growth_technology_stocks" | "aggressive_small_caps" | "undervalued_growth_stocks";

const TABS: { id: Tab; label: string }[] = [
  { id: "radar", label: "On the Radar" },
  { id: "ranking", label: "Full ranking" },
  { id: "portfolio", label: "My portfolio" },
  { id: "watchlist", label: "Watchlist" },
  { id: "lists", label: "My lists" },
  { id: "discover", label: "Discover" },
];
const SCREENS: { id: ScreenId; label: string }[] = [
  { id: "undervalued_large_caps", label: "Undervalued large caps" },
  { id: "growth_technology_stocks", label: "Growth tech" },
  { id: "aggressive_small_caps", label: "Small-cap growth" },
  { id: "undervalued_growth_stocks", label: "Undervalued growth" },
];
const PAGE = 50;

const fmtDate = (d?: string) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

export default function Home() {
  const { mode } = useMode();
  const wl = useWatchlist();
  const pf = usePortfolio();
  const lists = useLists();
  const { snap, error: snapErr } = useSnapshot();
  const [meta, setMeta] = useState<Meta>();
  const [tab, setTab] = useState<Tab>("radar");
  const [screenId, setScreenId] = useState<ScreenId>("undervalued_large_caps");
  const [screen, setScreen] = useState<string[]>([]);
  const [screenErr, setScreenErr] = useState<string>();
  const [view, setView] = useState<"table" | "cards">("table");
  const [page, setPage] = useState(0);
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS);
  const [listId, setListId] = useState<string>();
  const [urlRead, setUrlRead] = useState(false);
  const [introHidden, setIntroHidden] = useState(false);
  const named = lists.doc.lists.filter((l) => l.kind === "custom");
  const selectedList = named.find((l) => l.id === listId) ?? named[0];

  useEffect(() => {
    fetchJson<Meta>("/api/meta").then(setMeta).catch(() => setMeta({ demo: false, fmp: false, sec: false, demoSymbols: [] }));
    // A shared or reopened URL wins over the tab remembered in this browser.
    const params = new URLSearchParams(window.location.search);
    setFiltersState(parseFilters(params));
    setListId(params.get("list") ?? undefined);
    try {
      const t = params.get("tab") ?? localStorage.getItem("scout:tab");
      if (TABS.some((x) => x.id === t)) setTab(t as Tab);
      const v = localStorage.getItem("scout:view");
      if (v === "cards" || v === "table") setView(v);
      setIntroHidden(localStorage.getItem("scout:intro") === "hidden");
    } catch {}
    setUrlRead(true);
  }, []);

  // Keep the view in the URL so it can be reopened or shared. replaceState adds no history entry per keystroke.
  useEffect(() => {
    if (!urlRead) return;
    const params = filtersToParams(filters, new URLSearchParams(window.location.search));
    if (tab === "radar") params.delete("tab");
    else params.set("tab", tab);
    if (tab === "lists" && selectedList) params.set("list", selectedList.id);
    else params.delete("list");
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [tab, filters, urlRead, selectedList]);

  const setFilters = (f: Filters) => {
    setFiltersState(f);
    setPage(0);
  };
  const pickTab = (t: Tab) => {
    setTab(t);
    setPage(0);
    try {
      localStorage.setItem("scout:tab", t);
    } catch {}
  };
  const pickView = (v: "table" | "cards") => {
    setView(v);
    try {
      localStorage.setItem("scout:view", v);
    } catch {}
  };

  useEffect(() => {
    if (tab !== "discover" || meta?.demo) return;
    let current = true;
    setScreen([]);
    setScreenErr(undefined);
    fetchJson<{ symbol: string }[]>(`/api/screen?id=${screenId}&count=25`)
      .then((h) => current && setScreen(h.map((x) => x.symbol)))
      .catch((e) => current && setScreenErr(e.message));
    // A slower reply for a screen chosen earlier must not replace this one.
    return () => {
      current = false;
    };
  }, [tab, screenId, meta?.demo]);

  const snapshotTab = tab === "radar" || tab === "ranking";
  const snapRows = useMemo(() => rank(snap?.rows ?? []), [snap]);
  const snapBy = useMemo(() => new Map(snapRows.map((r) => [r.symbol, r])), [snapRows]);
  const hasSnapshot = snapRows.length > 0;
  const universes = useMemo(() => availableUniverses(snap?.rows ?? []), [snap]);
  // A URL can ask for an index this snapshot has no data for (demo mode); fall back to everything.
  const universe = universes.some((u) => u.id === filters.universe) ? filters.universe : "all";
  const universeRows = useMemo(() => snapRows.filter((r) => inUniverse(r, universe) === true), [snapRows, universe]);
  const universeLabel = universe === "all" ? (snap?.universe ?? "S&P 500 + Nasdaq 100") : (UNIVERSES.find((u) => u.id === universe)?.label ?? "");
  const sectorOverview = useMemo(() => (snap ? overview(snap, universe) : undefined), [snap, universe]);
  const rankingRows = useMemo(() => applyFilters(snapRows, { ...filters, universe }), [snapRows, filters, universe]);

  // Lists scored live, on request.
  const liveSymbols = useMemo(() => {
    if (!meta || snapshotTab) return [];
    if (meta.demo) return meta.demoSymbols;
    if (tab === "portfolio") return pf.ready ? pf.list : [];
    if (tab === "watchlist") return wl.ready ? wl.list : [];
    if (tab === "lists") return selectedList?.symbols ?? [];
    return screen;
  }, [meta, snapshotTab, tab, pf.ready, pf.list, wl.ready, wl.list, selectedList, screen]);
  const { data, errors, pending } = useMany<LongTermReport>(liveSymbols, getReport, 3);

  const [localDeltas, setLocalDeltas] = useState<Record<string, number | undefined>>({});
  useEffect(() => {
    const d: Record<string, number | undefined> = {};
    for (const [s, r] of Object.entries(data)) if (r.score.scorable) d[s] = scoreDelta(s, r.score.total);
    setLocalDeltas(d);
  }, [data]);

  const liveReports = liveSymbols.map((s) => data[s]).filter((r): r is LongTermReport => !!r);
  const liveRows: RadarRow[] = rank(
    liveReports.map((r) => {
      const row = toRow(r);
      const weekly = snapBy.get(r.profile.symbol);
      // Prefer the committed weekly history; fall back to what this browser saw last week.
      const lastWeek = weekly && typeof weekly.delta === "number" ? weekly.score - weekly.delta : undefined;
      return { ...row, delta: lastWeek !== undefined ? row.score - lastWeek : localDeltas[r.profile.symbol] };
    }),
  ).concat(liveReports.filter((r) => !r.score.scorable).map((r) => toRow(r)));

  const radar = universeRows.filter((r) => r.score >= 80);
  const turningUp = universeRows.filter((r) => r.score >= 65 && r.trend === "Recovering").slice(0, 12);
  const holdingsWarn = tab === "portfolio" ? liveRows.filter((r) => r.trend === "Downtrend" || r.flags.length > 0) : [];

  const title =
    tab === "radar" ? "On the Radar"
    : tab === "ranking" ? "Full ranking"
    : tab === "portfolio" ? "Portfolio holdings scores"
    : tab === "watchlist" ? "Watchlist"
    : tab === "lists" ? (selectedList?.name ?? "My lists")
    : "Discover";
  const subtitle =
    snapshotTab && !snap
      ? "Loading the weekly ranking…"
      : tab === "radar"
        ? `All ${radar.length} scoring 80+ · ${universeLabel}`
        : tab === "ranking"
          ? `${rankingRows.length} of ${universeRows.length} ranked · ${universeLabel}`
          : tab === "lists" && !selectedList
            ? "No named lists yet"
            : `${liveRows.length} stocks · scored live`;

  return (
    <div className="stack">
      {introHidden ? (
        <div className="row between small">
          <span className="muted">{meta?.demo ? "Demo mode: fictional sample companies." : ""}</span>
          <button className="linkish" onClick={() => { setIntroHidden(false); try { localStorage.removeItem("scout:intro"); } catch {} }}>How does this work?</button>
        </div>
      ) : (
      <section className="panel" style={{ position: "relative" }}>
        <button className="linkish" style={{ position: "absolute", right: 14, top: 12 }} onClick={() => { setIntroHidden(true); try { localStorage.setItem("scout:intro", "hidden"); } catch {} }}>Hide</button>
        <Only mode="beginner">
          <h1>Is this a good company, at a fair price?</h1>
          <p className="muted">
            We score companies with enough financial history from 0 to 100. The score covers price, growth, profitability, and financial health.
            The <b>trend</b> shows whether the stock price is rising or falling. A company can score well while its share price falls, so read both.
          </p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            <b>On the Radar</b> shows stocks in the S&amp;P 500 and Nasdaq 100 that score 80 or more. The weekly scan updates the list each weekend.
            Open a row to see how we calculated its score. Hover over underlined terms such as <Term id="pe" /> to see a definition.
          </p>
        </Only>
        <Only mode="expert">
          <h1>Long-term scorecard</h1>
          <p className="muted small" style={{ marginBottom: 0 }}>
            The fundamentals score runs from 0 to 100: Value 25 · Growth 25 · Quality 30 · Health 20. Checks award partial credit, compare valuation
            with the company&apos;s own history, and include TTM data in growth trends. Red flags cap scores at 59 or 39; F and CAPEX rules apply where relevant.
            Price trend stays separate, using the 200-DMA, 12-1 RS, and industry-peer momentum. Weekly scans show changes since the previous snapshot.
          </p>
        </Only>
        {meta?.demo && <div className="banner info small" style={{ marginTop: 8 }}>Demo mode: fictional sample companies with made-up numbers.</div>}
        {meta && !meta.demo && !meta.fmp && !meta.sec && (
          <p className="tiny faint" style={{ marginTop: 6, marginBottom: 0 }}>
            Using Yahoo data only, about 4 years of reports. Set <code>SEC_USER_AGENT</code> to add up to 10 years from SEC EDGAR for US companies.
          </p>
        )}
      </section>
      )}

      <div className="row between">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => pickTab(t.id)}>
              {t.label}
              {t.id === "radar" && hasSnapshot ? ` · ${radar.length}` : ""}
              {t.id === "portfolio" && pf.list.length ? ` · ${pf.list.length}` : ""}
            </button>
          ))}
        </div>
        {!snapshotTab && (
          <div className="view-toggle" role="group" aria-label="View">
            <button className={view === "table" ? "on" : ""} onClick={() => pickView("table")}>Table</button>
            <button className={view === "cards" ? "on" : ""} onClick={() => pickView("cards")}>Cards</button>
          </div>
        )}
      </div>

      <section className="panel">
        <div className="list-head">
          <div>
            <div className="tiny muted" style={{ letterSpacing: ".18em", textTransform: "uppercase" }}>Stock Scout</div>
            <h2 style={{ fontSize: 26, marginBottom: 0 }}>{title}</h2>
          </div>
          <div className="meta">
            {snapshotTab && snap?.date && <div className="num" style={{ fontWeight: 700 }}>{fmtDate(snap.date)}</div>}
            {snapshotTab && snap?.date && <SnapshotAge snap={snap} />}
            <div className="small muted">{subtitle}</div>
            {snapshotTab && snap?.previousDate && <div className="tiny faint">▲▼ vs {fmtDate(snap.previousDate)}</div>}
            {!snapshotTab && <div className="tiny faint">Company data is cached for up to {COMPANY_CACHE_HOURS} hours.</div>}
          </div>
        </div>

        {snapshotTab && hasSnapshot && universes.length > 1 && (
          <div className="row" style={{ marginBottom: 12 }}>
            <UniverseSwitch value={universe} options={universes} onChange={(u) => setFilters({ ...filters, universe: u })} />
          </div>
        )}

        {/* Snapshot-backed lists */}
        {snapshotTab && !snap && !snapErr && <div className="skeleton" style={{ height: 300 }} />}
        {snapshotTab && snapErr && <p className="band-red small">Couldn&apos;t load the weekly list: {snapErr}</p>}
        {snapshotTab && snap && !hasSnapshot && (
          <div className="banner info small">
            <b>{snap.rows.length ? "None of the imported companies meet the scoring requirements." : "The weekly ranking has no data yet."}</b>{" "}
            {snap.rows.length > 0 && <>We need at least four annual reports. We don&apos;t score funds or REITs. </>}
            The scan covers about 515 S&amp;P 500 and Nasdaq-100 companies. It runs separately because scanning them all would slow down this page.
            Run <i>Weekly scan</i> from the repository&apos;s GitHub Actions tab, or run{" "}
            <code>npm run scan</code> locally and commit <code>src/data/snapshots</code>. The scheduled scan runs every Sunday.
            You can use <i>My portfolio</i>, <i>Watchlist</i>, or <i>Discover</i> while you wait; those tabs fetch scores when you open them.
          </div>
        )}
        {tab === "radar" && hasSnapshot && (radar.length ? <RankTable rows={radar} /> : <p className="muted">Nothing in the {universeLabel} scores 80+ this week.</p>)}
        {tab === "ranking" && hasSnapshot && (
          <>
            {sectorOverview && (
              <SectorTiles overview={sectorOverview} label={universeLabel} active={filters.sector} onPick={(sector) => setFilters({ ...filters, sector })} />
            )}
            <RankingFilters filters={filters} onChange={setFilters} />
            <div className="row" style={{ margin: "10px 0 8px" }}>
              <span className="small muted" role="status">
                {rankingRows.length ? `${page * PAGE + 1}–${Math.min(rankingRows.length, (page + 1) * PAGE)} of ${rankingRows.length}` : "No stocks match these filters."}
              </span>
              <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <button className="btn" disabled={(page + 1) * PAGE >= rankingRows.length} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
            {rankingRows.length > 0 && <RankTable rows={rankingRows.slice(page * PAGE, (page + 1) * PAGE)} startRank={page * PAGE + 1} />}
          </>
        )}
        {snapshotTab && turningUp.length > 0 && (
          <p className="small" style={{ marginTop: 12, marginBottom: 0 }}>
            <b>Turning up</b>{" "}
            <span className="muted">({mode === "expert" ? "65+, just reclaimed the 200-day" : "good companies whose price just started climbing again"}):</span>{" "}
            {turningUp.map((r, i) => (
              <span key={r.symbol}>
                {i > 0 && ", "}
                <Link href={`/stock/${r.symbol}`}>{r.symbol}</Link> <span className="faint num">{r.score}</span>
              </span>
            ))}
          </p>
        )}

        {/* Live-scored lists */}
        {(tab === "portfolio" || tab === "watchlist" || tab === "lists") && <ListsSync />}
        {tab === "lists" && (
          <>
            <NamedLists selected={selectedList} onSelect={(id) => (setListId(id), setPage(0))} />
            {lists.ready && !selectedList && (
              <p className="muted small">
                Named lists group stocks the way you research them, for example &ldquo;Quality at a fair price&rdquo; or &ldquo;Earnings this month&rdquo;.
                Create one above, then use the <b>Lists</b> button on any stock page to add stocks.
              </p>
            )}
            {selectedList && selectedList.symbols.length === 0 && !meta?.demo && (
              <p className="muted small">This list is empty. Use the <b>Lists</b> button on any stock page to add stocks.</p>
            )}
          </>
        )}
        {tab === "portfolio" && pf.ready && pf.list.length === 0 && !meta?.demo && (
          <div className="banner info small">
            Add the stocks you own with &ldquo;Add to portfolio&rdquo; on any stock page. They are ranked here like a weekly holdings report.{" "}
            <button className="linkish" onClick={() => pf.addMany(TTT_PORTFOLIO)}>Or load The Traveling Trader&apos;s 19 holdings as an example.</button>
          </div>
        )}
        {tab === "discover" && !meta?.demo && (
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="tabs">
              {SCREENS.map((s) => (
                <button key={s.id} className={screenId === s.id ? "on" : ""} onClick={() => setScreenId(s.id)}>{s.label}</button>
              ))}
            </div>
            <span className="tiny faint">Candidates from Yahoo&apos;s screen, scored here. {screenErr && <span className="band-red">Screen failed: {screenErr}</span>}</span>
          </div>
        )}
        {holdingsWarn.length > 0 && (
          <div className="banner warn small" style={{ marginBottom: 10 }}>
            <b>Worth a look:</b>{" "}
            {holdingsWarn.map((r, i) => (
              <span key={r.symbol}>
                {i > 0 && " · "}
                <Link href={`/stock/${r.symbol}`}>{r.symbol}</Link>{" "}
                {[r.trend === "Downtrend" ? "downtrend" : "", r.flags.length ? `${r.flags.length} red flag${r.flags.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ")}
              </span>
            ))}
          </div>
        )}
        {!snapshotTab && liveRows.length > 0 && view === "table" && <RankTable rows={liveRows} />}
        {!snapshotTab && view === "cards" && (
          <div className="grid cards">
            {liveRows.map((row) => data[row.symbol] && <ScoreCardMini key={row.symbol} r={data[row.symbol]!} delta={row.delta ?? undefined} />)}
            {pending > 0 && Array.from({ length: Math.min(pending, 6) }, (_, i) => <SkeletonCard key={`sk${i}`} />)}
          </div>
        )}
        {!snapshotTab && view === "table" && pending > 0 && (
          <p className="small muted" style={{ marginTop: 8 }}>Scoring {pending} more…</p>
        )}
        {!snapshotTab && Object.keys(errors).filter((s) => liveSymbols.includes(s)).length > 0 && (
          <details className="small muted" style={{ marginTop: 8 }}>
            <summary>{Object.keys(errors).filter((s) => liveSymbols.includes(s)).length} couldn&apos;t load</summary>
            {Object.entries(errors)
              .filter(([s]) => liveSymbols.includes(s))
              .map(([s, e]) => (
                <div key={s}>
                  <b>{s}</b>: {e}
                </div>
              ))}
          </details>
        )}
        {tab === "watchlist" && wl.ready && !meta?.demo && wl.list.length === 0 && (
          <p className="muted">Your watchlist is empty. Search for a company above and press &ldquo;Add to watchlist&rdquo;.</p>
        )}
        {(tab === "portfolio" || tab === "watchlist" || tab === "lists") && meta && !meta.demo && (
          <ListNews
            key={`${tab}:${selectedList?.id ?? ""}`}
            symbols={liveSymbols}
            name={tab === "portfolio" ? "your portfolio" : tab === "watchlist" ? "your watchlist" : (selectedList?.name ?? "this list")}
          />
        )}
      </section>
      <Disclaimer />
    </div>
  );
}
