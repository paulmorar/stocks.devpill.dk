"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { fetchJson, getShort, useMany, useWatchlist } from "@/lib/client";
import type { Setup, ShortTermResult } from "@/lib/shortterm";
import { positionSize } from "@/lib/shortterm";
import { fx, money, pct, signedPct } from "@/lib/util";
import { Explain, Only, useMode } from "@/components/mode";
import { LineChart, Term } from "@/components/ui";

type Meta = { demo: boolean; fmp?: boolean; demoSymbols: string[] };
const LISTS = [
  { id: "most_actives", label: "Most active" },
  { id: "day_gainers", label: "Top gainers" },
  { id: "day_losers", label: "Top losers" },
  { id: "small_cap_gainers", label: "Small-cap gainers" },
  { id: "watchlist", label: "My watchlist" },
] as const;

export default function DayPage() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 300 }} />}>
      <Day />
    </Suspense>
  );
}

function Day() {
  const { mode } = useMode();
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get("symbol")?.toUpperCase();
  const wl = useWatchlist();
  const [meta, setMeta] = useState<Meta>();
  const [tab, setTab] = useState<(typeof LISTS)[number]["id"]>("most_actives");
  const [hits, setHits] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [onlySetups, setOnlySetups] = useState(false);

  useEffect(() => {
    fetchJson<Meta>("/api/meta").then(setMeta).catch(() => setMeta({ demo: false, fmp: false, demoSymbols: [] }));
  }, []);
  useEffect(() => {
    if (tab === "watchlist") return;
    fetchJson<{ symbol: string }[]>(`/api/screen?id=${tab}&count=25`).then((h) => setHits(h.map((x) => x.symbol))).catch(() => setHits([]));
  }, [tab, refresh]);

  const symbols = useMemo(() => {
    if (!meta) return [];
    if (meta.demo) return meta.demoSymbols;
    return tab === "watchlist" ? wl.list : hits;
  }, [meta, tab, wl.list, hits]);

  const { data, errors, pending } = useMany<ShortTermResult>(symbols, getShort, 4, refresh);
  const rows = symbols
    .map((s) => data[s])
    .filter((r): r is ShortTermResult => !!r)
    .filter((r) => !onlySetups || r.setups.some((s) => s.bias === "long"))
    .sort((a, b) => b.activity - a.activity);

  return (
    <div className="stack">
      <section className="banner risk small">
        <Only mode="beginner">
          <b>Read this first.</b> Day trading means buying and selling within hours. Most people who try it lose money, mostly to fast moves and
          their own emotions. Never trade money you can&apos;t afford to lose, always decide your exit (<Term id="stop">stop-loss</Term>) before you buy,
          and risk only a small slice — 1% is common — of your account on any one trade. The &ldquo;setups&rdquo; below are patterns, not predictions.
        </Only>
        <Only mode="expert">
          <b>Short-term signals only.</b> Pattern detection on delayed Yahoo data (5-min bars, typically ~15 min delay) — fine for screening, not for
          execution. Kept separate from the long-term score by design. Size from the stop, not from conviction.
        </Only>
      </section>

      {selected && <Detail symbol={selected} onClose={() => router.push("/day")} />}

      <section className="panel">
        <div className="row between">
          <h2 style={{ marginBottom: 0 }}>{mode === "expert" ? "Scanner" : "What's moving today"}</h2>
          <div className="row small">
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={onlySetups} onChange={(e) => setOnlySetups(e.target.checked)} /> Only with a long setup
            </label>
            <button className="btn" onClick={() => setRefresh((n) => n + 1)}>Refresh</button>
          </div>
        </div>
        {!meta?.demo && (
          <div className="tabs" style={{ margin: "12px 0" }}>
            {LISTS.map((l) => (
              <button key={l.id} className={tab === l.id ? "on" : ""} onClick={() => setTab(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        )}
        <Only mode="beginner">
          <p className="small muted">
            Sorted by how &ldquo;in play&rdquo; each stock is — moving a lot, on lots of trading. Tap a row for the full picture and an explanation.
          </p>
        </Only>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Last</th>
                <th>Change</th>
                <th><Term id="gap">Gap</Term></th>
                <th><Term id="rvol">RVOL</Term></th>
                <th><Term id="rsi">RSI</Term></th>
                <th><Term id="vwap">vs VWAP</Term></th>
                <th style={{ textAlign: "left" }}>Setups</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="click" onClick={() => router.push(`/day?symbol=${encodeURIComponent(r.symbol)}`)}>
                  <td><b>{r.symbol}</b></td>
                  <td className="num">{fx(r.last, 2)}</td>
                  <td className={`num ${r.changePct >= 0 ? "band-green" : "band-red"}`}>{signedPct(r.changePct, 1)}</td>
                  <td className="num">{r.gapPct !== undefined ? signedPct(r.gapPct, 1) : "—"}</td>
                  <td className={`num ${(r.rvol ?? 0) >= 2 ? "band-lime" : ""}`}>{r.rvol !== undefined ? `${fx(r.rvol, 1)}×` : "—"}</td>
                  <td className={`num ${(r.rsi ?? 50) >= 70 || (r.rsi ?? 50) <= 30 ? "band-amber" : ""}`}>{fx(r.rsi, 0)}</td>
                  <td className={`num ${r.vwap ? (r.last > r.vwap ? "band-green" : "band-red") : ""}`}>
                    {r.vwap ? signedPct(r.last / r.vwap - 1, 1) : "—"}
                  </td>
                  <td style={{ textAlign: "left" }}>
                    <div className="row" style={{ gap: 4 }}>
                      {r.setups.map((s) => (
                        <span key={s.id} className="chip" style={{ borderColor: s.bias === "long" ? "var(--green)" : s.bias === "short" ? "var(--red)" : "var(--amber)" }}>
                          {s.label}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pending > 0 && <p className="small muted">Loading {pending} more…</p>}
        {Object.keys(errors).length > 0 && <p className="tiny faint">{Object.keys(errors).length} symbols failed to load.</p>}
      </section>
    </div>
  );
}

function Detail({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const { mode } = useMode();
  const [r, setR] = useState<ShortTermResult>();
  const [err, setErr] = useState<string>();
  const [calc, setCalc] = useState<{ entry: string; stop: string }>({ entry: "", stop: "" });
  const [account, setAccount] = useState("10000");
  const [riskPct, setRiskPct] = useState("1");

  useEffect(() => {
    try {
      setAccount(localStorage.getItem("scout:account") ?? "10000");
      setRiskPct(localStorage.getItem("scout:risk") ?? "1");
    } catch {}
  }, []);
  useEffect(() => {
    setR(undefined);
    setErr(undefined);
    getShort(symbol)
      .then((x) => {
        setR(x);
        const first = x.setups.find((s) => s.entry && s.stop);
        setCalc(first ? { entry: fx(first.entry, 2), stop: fx(first.stop, 2) } : { entry: fx(x.last, 2), stop: x.atr ? fx(x.last - x.atr, 2) : "" });
      })
      .catch((e) => setErr(e.message));
  }, [symbol]);

  const size = positionSize(Number(account), Number(riskPct) / 100, Number(calc.entry), Number(calc.stop));
  const saveAcc = (v: string) => {
    setAccount(v);
    try {
      localStorage.setItem("scout:account", v);
    } catch {}
  };
  const saveRisk = (v: string) => {
    setRiskPct(v);
    try {
      localStorage.setItem("scout:risk", v);
    } catch {}
  };

  if (err) return <section className="panel band-red">Couldn&apos;t load {symbol}: {err}</section>;
  if (!r) return <div className="skeleton" style={{ height: 320 }} />;

  return (
    <section className="panel stack">
      <div className="row between">
        <div>
          <h2 style={{ marginBottom: 0 }}>
            {symbol} <span className="num">{fx(r.last, 2)}</span>{" "}
            <span className={`num ${r.changePct >= 0 ? "band-green" : "band-red"}`}>{signedPct(r.changePct, 2)}</span>
          </h2>
          <div className="tiny faint">Session {r.sessionDate ?? "—"} · prior close {fx(r.prevClose, 2)}</div>
        </div>
        <div className="row">
          <a className="btn" href={`/stock/${encodeURIComponent(symbol)}`}>Long-term score</a>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
      {r.warnings.map((w) => (
        <div key={w} className="banner warn small">{w}</div>
      ))}

      {r.intraday.length > 1 && (
        <LineChart
          xKey="time"
          data={r.intraday}
          height={200}
          series={[
            { key: "close", color: "#eef0f4", label: "Price (5-min)", width: 1.5 },
            { key: "vwap", color: "#61dafb", label: "VWAP", dash: "4 3" },
          ]}
        />
      )}

      <div className="grid two">
        <div>
          <h3>{mode === "expert" ? "Setups" : "Patterns spotted"}</h3>
          {r.setups.length === 0 && <p className="muted small">{mode === "expert" ? "No setup conditions met." : "Nothing stands out right now. Not trading is a valid choice."}</p>}
          <div className="stack">
            {r.setups.map((s) => (
              <SetupCard key={s.id} s={s} onUse={() => s.entry && s.stop && setCalc({ entry: fx(s.entry, 2), stop: fx(s.stop, 2) })} />
            ))}
          </div>
        </div>
        <div>
          <h3>{mode === "expert" ? "Indicators" : "The readings, explained"}</h3>
          {r.indicators.map((i) => (
            <div key={i.id} className="check">
              <div className="head">
                <b>{i.label}</b>
                <span className={`num ${i.tone === "good" ? "band-green" : i.tone === "bad" ? "band-red" : i.tone === "warn" ? "band-amber" : ""}`}>{i.display}</span>
              </div>
              <Explain e={i.explain} className="small" />
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ background: "var(--panel-2)" }}>
        <h3>Position size calculator</h3>
        <p className="small muted">
          {mode === "expert"
            ? "Shares = (account × risk %) ÷ (entry − stop)."
            : "Decide how much you're willing to lose if you're wrong, and where you'll get out. This tells you how many shares that allows."}
        </p>
        <div className="row small">
          <label>Account <input inputMode="decimal" value={account} onChange={(e) => saveAcc(e.target.value)} style={{ width: 110 }} /></label>
          <label>Risk % <input inputMode="decimal" value={riskPct} onChange={(e) => saveRisk(e.target.value)} style={{ width: 60 }} /></label>
          <label>Entry <input inputMode="decimal" value={calc.entry} onChange={(e) => setCalc({ ...calc, entry: e.target.value })} style={{ width: 90 }} /></label>
          <label>Stop <input inputMode="decimal" value={calc.stop} onChange={(e) => setCalc({ ...calc, stop: e.target.value })} style={{ width: 90 }} /></label>
        </div>
        {size ? (
          <p style={{ marginTop: 10 }}>
            <b className="num">{size.shares} shares</b> ({money(size.positionValue)}, {pct(size.pctOfAccount, 0)} of account). If the stop is hit you lose about{" "}
            <b className="num">{money(size.shares * size.perShare)}</b>.
            {size.pctOfAccount > 1 && <span className="band-amber"> That&apos;s more than your whole account — it would need margin (borrowed money). Widen nothing; reduce risk instead.</span>}
            {r.atr && size.perShare < r.atr * 0.5 && (
              <span className="band-amber"> Your stop is tighter than half a normal day&apos;s move ({fx(r.atr, 2)}), so noise may knock you out.</span>
            )}
          </p>
        ) : (
          <p className="small muted" style={{ marginTop: 10 }}>Enter an entry and a different stop price.</p>
        )}
      </div>
    </section>
  );
}

function SetupCard({ s, onUse }: { s: Setup; onUse: () => void }) {
  const { mode } = useMode();
  return (
    <div className={`setup ${s.bias}`}>
      <div className="row between">
        <b>{s.label}</b>
        <span className="tiny muted">
          {s.bias === "long" ? (mode === "expert" ? "Long bias" : "Possible buy pattern") : s.bias === "short" ? "Short bias" : "Caution"} · strength {Math.round(s.strength * 100)}%
        </span>
      </div>
      <Explain e={s.explain} className="small" />
      {s.entry !== undefined && s.stop !== undefined && (
        <div className="row small num" style={{ marginTop: 6 }}>
          <span>Entry {fx(s.entry, 2)}</span>
          <span className="band-red">Stop {fx(s.stop, 2)}</span>
          {s.target !== undefined && <span className="band-green">Target {fx(s.target, 2)} (2R)</span>}
          <button className="linkish" onClick={onUse}>Use in calculator</button>
        </div>
      )}
    </div>
  );
}
