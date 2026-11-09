"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { GLOSSARY } from "@/lib/glossary";
import type { LongTermReport } from "@/lib/analyze";
import type { Band, PillarResult } from "@/lib/scoring/types";
import { TREND_ICON, type TrendResult } from "@/lib/trend";
import { signedPct } from "@/lib/util";
import { useMode } from "./mode";

export function Term({ id, children }: { id: keyof typeof GLOSSARY; children?: ReactNode }) {
  const g = GLOSSARY[id];
  const { mode } = useMode();
  if (!g) return <>{children}</>;
  return (
    <span className="term" tabIndex={0}>
      {children ?? g.term}
      <span className="tip" role="tooltip">
        <b>{g.term}</b>
        <br />
        {mode === "expert" ? g.expert : g.simple}
      </span>
    </span>
  );
}

/**
 * Score dial — a nod to the GME "moon ride" rocket. The rocket points from
 * down-right (0) through level (50) to straight up (100).
 */
export function RocketGauge({ score, band, size = 150 }: { score: number; band: Band; size?: number }) {
  const angle = -90 + (score / 100) * 180; // -90 = left, 90 = right on the arc
  const color = `var(--${band})`;
  const r = 60;
  const cx = 75;
  const cy = 78;
  const arc = (from: number, to: number) => {
    const a0 = ((from - 90) * Math.PI) / 180;
    const a1 = ((to - 90) * Math.PI) / 180;
    return `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
  };
  return (
    <svg width={size} height={size * 0.68} viewBox="0 0 150 102" role="img" aria-label={`Score ${score} out of 100`}>
      <path d={arc(-90, 90)} stroke="var(--panel-2)" strokeWidth="10" fill="none" strokeLinecap="round" />
      <path d={arc(-90, -90 + (Math.max(score, 1) / 100) * 180)} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" />
      <g transform={`translate(${cx} ${cy}) rotate(${angle})`}>
        <g transform="translate(0 -36)">
          <path d="M0 -14 C5 -9 6 -2 5 6 L-5 6 C-6 -2 -5 -9 0 -14 Z" fill="#eef0f4" />
          <circle cx="0" cy="-3" r="2.2" fill="#61dafb" />
          <path d="M-5 2 L-9 9 L-5 7 Z M5 2 L9 9 L5 7 Z" fill="#f2555d" />
          <path d="M-3 7 L0 13 L3 7 Z" fill="#f4b740" />
        </g>
      </g>
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="30" fontWeight="800" fill={color} className="num">
        {score}
      </text>
      <text x={cx} y={cy + 20} textAnchor="middle" fontSize="10" fill="var(--muted)">
        out of 100
      </text>
    </svg>
  );
}

export function PillarBars({ pillars, band }: { pillars: PillarResult[]; band: Band }) {
  const { mode } = useMode();
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {pillars.map((p) => (
        <div className="pillar-mini" key={p.id} title={mode === "expert" ? p.question : p.simpleQuestion}>
          <span>{p.label === "Financial Health" ? "Health" : p.label}</span>
          <div className="bar">
            <i className={`bg-${band}`} style={{ width: `${(p.points / p.maxPoints) * 100}%` }} />
          </div>
          <span className="num" style={{ textAlign: "right" }}>
            {Math.round(p.points)}/{p.maxPoints}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TrendBadge({ t, compact = false }: { t?: TrendResult; compact?: boolean }) {
  if (!t) return <span className="faint small">No trend</span>;
  return (
    <div>
      <span className={`trend trend-${t.state}`}>{TREND_ICON[t.state]} {t.state}</span>
      <div className="tiny muted num">
        <Term id="rs">RS</Term> {t.rs !== undefined ? signedPct(t.rs) : "—"}
        {!compact || t.ind !== undefined ? (
          <>
            {" · "}
            <Term id="ind">Ind</Term> {t.ind !== undefined ? signedPct(t.ind) : "—"}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function Chips({ r }: { r: LongTermReport }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      {r.score.scorecard === "financials" && <span className="chip f" title="Scored on the financials scorecard">F</span>}
      {r.score.capexMode && <span className="chip capex" title="Spending more than 2× depreciation">CAPEX</span>}
      {r.score.redFlags.length > 0 && (
        <span className="chip flag" title={r.score.redFlags.map((f) => f.label).join("\n")}>
          ⚑ {r.score.redFlags.length}
        </span>
      )}
    </div>
  );
}

export function ScoreCardMini({ r, delta }: { r: LongTermReport; delta?: number }) {
  const s = r.score;
  return (
    <Link href={`/stock/${encodeURIComponent(r.profile.symbol)}`} className="card">
      <div className="top">
        <div>
          <div style={{ fontWeight: 700 }}>{r.profile.symbol}</div>
          <div className="name">{r.profile.name}</div>
        </div>
        <Chips r={r} />
      </div>
      <div className="row between" style={{ margin: "10px 0" }}>
        {s.scorable ? (
          <div className="row" style={{ alignItems: "baseline", gap: 6 }}>
            <span className={`score num band-${s.band}`}>{s.total}</span>
            {delta !== undefined && delta !== 0 && (
              <span className={`small num ${delta > 0 ? "band-green" : "band-red"}`} title="Change since you last looked">
                {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
              </span>
            )}
          </div>
        ) : (
          <span className="small muted">Not scored</span>
        )}
        <TrendBadge t={r.trend} compact />
      </div>
      {s.scorable ? <PillarBars pillars={s.pillars} band={s.band} /> : <p className="tiny muted">{s.notScoredReason}</p>}
    </Link>
  );
}

export function SkeletonCard() {
  return <div className="skeleton" style={{ height: 178 }} />;
}

/** Small SVG line chart. Series share one y-axis. */
export function LineChart({
  data, series, height = 220, xKey,
}: {
  data: Record<string, unknown>[];
  series: { key: string; color: string; label: string; width?: number; dash?: string }[];
  height?: number;
  xKey: string;
}) {
  const W = 760;
  const H = height;
  const pad = { l: 8, r: 52, t: 10, b: 22 };
  const vals = data.flatMap((d) => series.map((s) => d[s.key])).filter((v): v is number => typeof v === "number");
  if (data.length < 2 || !vals.length) return <p className="muted small">Not enough data to chart.</p>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / (data.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const ticks = [min, min + span / 2, max];
  const first = String(data[0]?.[xKey] ?? "");
  const lastLabel = String(data.at(-1)?.[xKey] ?? "");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Price chart">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={W - pad.r + 6} y={y(t) + 4} fontSize="11" fill="var(--faint)" className="num">
              {t >= 100 ? t.toFixed(0) : t.toFixed(2)}
            </text>
          </g>
        ))}
        {series.map((s) => {
          let d = "";
          data.forEach((row, i) => {
            const v = row[s.key];
            if (typeof v !== "number") return;
            d += `${d ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
          });
          return <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.6} strokeDasharray={s.dash} />;
        })}
        <text x={pad.l} y={H - 4} fontSize="11" fill="var(--faint)">{first.slice(0, 16).replace("T", " ")}</text>
        <text x={W - pad.r} y={H - 4} fontSize="11" fill="var(--faint)" textAnchor="end">{lastLabel.slice(0, 16).replace("T", " ")}</text>
      </svg>
      <div className="row tiny muted" style={{ gap: 14 }}>
        {series.map((s) => (
          <span key={s.key} className="row" style={{ gap: 5 }}>
            <i style={{ width: 14, height: 2, background: s.color, display: "inline-block" }} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Disclaimer() {
  return (
    <p className="tiny faint">
      Educational tool, not investment advice. Scores are a starting point for your own research — not buy or sell signals, not risk ratings, not forecasts.
    </p>
  );
}
