"use client";

import { DEFAULT_FILTERS, type Filters, isDefault, MIN_SCORES, type Overview, TRENDS, type UniverseId, UNIVERSES } from "@/lib/explore";
import { bandOf } from "@/lib/scoring/types";

/** Choose which index the weekly lists cover. A stock in both indices appears once in the combined view. */
export function UniverseSwitch({ value, options, onChange }: { value: UniverseId; options: typeof UNIVERSES; onChange: (u: UniverseId) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="Index">
      {options.map((u) => (
        <button key={u.id} className={value === u.id ? "on" : ""} aria-pressed={value === u.id} onClick={() => onChange(u.id)}>
          {u.label}
        </button>
      ))}
    </div>
  );
}

/** Score overview per sector, built from the weekly snapshot. Selecting a tile filters the ranking below. */
export function SectorTiles({ overview: o, label, active, onPick }: { overview: Overview; label: string; active?: string; onPick: (sector?: string) => void }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <p className="small muted" style={{ marginBottom: 8 }}>
        {label}: <b className="num">{o.scored}</b> ranked · <span className="num">{o.excluded}</span> not scored ·{" "}
        <span className="num">{o.failed}</span> failed to load
        {o.unknown > 0 && <> · <span className="num">{o.unknown}</span> without index data in this snapshot</>}.
        {" "}Sector figures count ranked stocks only.
      </p>
      <div className="sector-tiles">
        {o.sectors.map((s) => {
          const on = active === s.sector;
          return (
            <button key={s.sector} className={`tile${on ? " on" : ""}`} aria-pressed={on} onClick={() => onPick(on ? undefined : s.sector)}>
              <span className="tile-name">{s.sector}</span>
              <span className="tiny muted num">{s.scored} ranked · {s.top} at 80+</span>
              {s.median !== undefined && (
                <span className="tiny muted">
                  median <b className={`num band-${bandOf(s.median)}`}>{Math.round(s.median)}</b>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Ranking filters. Reset keeps the selected index, which has its own switch. */
export function RankingFilters({ filters: f, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const resettable = !isDefault({ ...f, universe: "all" });
  return (
    <div className="row filters">
      <input
        type="search"
        placeholder="Filter by ticker, name or industry"
        aria-label="Filter by ticker, name or industry"
        value={f.q}
        onChange={(e) => onChange({ ...f, q: e.target.value })}
      />
      <select aria-label="Trend" value={f.trend ?? ""} onChange={(e) => onChange({ ...f, trend: TRENDS.find((t) => t === e.target.value) })}>
        <option value="">Any trend</option>
        {TRENDS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <select aria-label="Minimum score" value={f.minScore} onChange={(e) => onChange({ ...f, minScore: Number(e.target.value) })}>
        {MIN_SCORES.map((m) => (
          <option key={m} value={m}>{m ? `${m}+` : "Any score"}</option>
        ))}
      </select>
      <select aria-label="Financial history" value={f.history} onChange={(e) => onChange({ ...f, history: e.target.value as Filters["history"] })}>
        <option value="all">Any history</option>
        <option value="full">5+ annual reports</option>
        <option value="limited">Limited history (4 reports)</option>
      </select>
      {f.sector && (
        <span className="chip">
          {f.sector}
          <button className="linkish" aria-label={`Remove sector filter ${f.sector}`} onClick={() => onChange({ ...f, sector: undefined })}>✕</button>
        </span>
      )}
      {resettable && (
        <button className="linkish" onClick={() => onChange({ ...DEFAULT_FILTERS, universe: f.universe })}>
          Reset filters
        </button>
      )}
    </div>
  );
}
