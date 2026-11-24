"use client";

import type { LongTermReport } from "@/lib/analyze";
import { COMPANY_CACHE_HOURS, formatAge, formatDuration, formatTimestamp, freshness, QUOTE_STALE_DAYS, SNAPSHOT_STALE_DAYS } from "@/lib/freshness";
import { rank, type Snapshot } from "@/lib/snapshot";
import { newerTtm } from "@/lib/scoring/metrics";
import type { MarketSnapshot, Source } from "@/lib/types";
import { fx } from "@/lib/util";

const SOURCE_NAME: Record<Source, string> = { yahoo: "Yahoo Finance", fmp: "Financial Modeling Prep", demo: "demo data" };

/** Inline label for the time a price was set. Never substitutes the viewing time for a missing quote time. */
export function QuoteTime({ market, now = Date.now() }: { market: MarketSnapshot; now?: number }) {
  if (market.price === undefined) return null;
  const f = freshness(market.quoteTime, QUOTE_STALE_DAYS, now);
  if (f.state === "unavailable") return <span className="faint">price time not provided</span>;
  return (
    <span className={f.state === "stale" ? "band-amber" : "faint"} title={f.state === "stale" ? `No newer trade for more than ${QUOTE_STALE_DAYS} days.` : undefined}>
      as of {formatTimestamp(market.quoteTime as string)}
    </span>
  );
}

function priceLine(r: LongTermReport, now: number) {
  const m = r.market;
  if (m.price === undefined) return "The data provider returned no price.";
  const price = `${fx(m.price, 2)} ${r.profile.tradingCurrency ?? r.profile.currency}`;
  const f = freshness(m.quoteTime, QUOTE_STALE_DAYS, now);
  if (f.state === "unavailable") return `${price}. The data provider did not say when this price was set.`;
  const when = `${price} as of ${formatTimestamp(m.quoteTime as string)} (${formatAge(f.ageMs)}).`;
  return f.state === "stale"
    ? `${when} That is more than ${QUOTE_STALE_DAYS} days ago. Trading may be halted, or the listing may have changed.`
    : when;
}

function reportsLine(r: LongTermReport) {
  if (!r.annual.length) return "The data provider returned no annual reports.";
  const years = r.annual.map((x) => x.fy);
  const n = r.annual.length;
  const t = newerTtm(r.annual.at(-1), r.ttm);
  const ttm = t ? `, plus the trailing 12 months to ${new Date(`${t.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}` : "";
  return `${n} annual report${n === 1 ? "" : "s"}, FY${Math.min(...years)} to FY${Math.max(...years)}${ttm}.`;
}

function weeklyLine(symbol: string, liveScore: number | undefined, snap: Snapshot | undefined, error: string | undefined, now: number) {
  if (error) return `The weekly ranking couldn't load: ${error}`;
  if (!snap) return "Loading the weekly ranking…";
  if (!snap.rows.length) return "There is no weekly ranking yet.";
  const row = snap.rows.find((x) => x.symbol === symbol);
  const date = new Date(`${snap.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const f = freshness(snap.generatedAt, SNAPSHOT_STALE_DAYS, now);
  const stale = f.state === "stale" ? ` That snapshot is ${formatDuration(f.ageMs)} old, so at least one weekly scan was missed.` : "";
  if (!row) return `Not in the ${date} snapshot, which covers the S&P 500 and Nasdaq-100.${stale}`;
  if (!row.scorable) return `In the ${date} snapshot, but not scored.${stale}`;
  const ranked = rank(snap.rows);
  const pos = ranked.findIndex((x) => x.symbol === symbol) + 1;
  const differs = liveScore !== undefined && liveScore !== row.score ? ` The live score here is ${liveScore} because it uses newer data.` : "";
  return `Scored ${row.score} in the ${date} snapshot, ranked ${pos} of ${ranked.length}.${differs}${stale}`;
}

/** Separates the four clocks behind a stock page: price, financial reports, retrieval, and the weekly ranking. */
export function DataFreshness({ r, snap, snapError, now = Date.now() }: { r: LongTermReport; snap?: Snapshot; snapError?: string; now?: number }) {
  const fetched = freshness(r.fetchedAt, COMPANY_CACHE_HOURS / 24, now);
  const sources = r.sources.map((s) => SOURCE_NAME[s] ?? s).join(" and ");
  return (
    <section className="panel small">
      <h3>How current is this?</h3>
      <dl className="facts">
        <dt>Price</dt>
        <dd>{priceLine(r, now)}</dd>
        <dt>Financial reports</dt>
        <dd>{reportsLine(r)}</dd>
        <dt>Retrieved</dt>
        <dd>
          {fetched.state === "unavailable" ? "At an unknown time" : fetched.ageMs < 60_000 ? "Just now" : formatAge(fetched.ageMs)} from {sources}.
          {" "}Company data stays cached for up to {COMPANY_CACHE_HOURS} hours, so reloading can show the same numbers.
        </dd>
        <dt>Weekly ranking</dt>
        <dd>{weeklyLine(r.profile.symbol, r.score.scorable ? r.score.total : undefined, snap, snapError, now)}</dd>
      </dl>
    </section>
  );
}

/** Generation time for a weekly snapshot, with a warning once the weekly scan has been missed. */
export function SnapshotAge({ snap, now = Date.now() }: { snap: Snapshot; now?: number }) {
  const f = freshness(snap.generatedAt, SNAPSHOT_STALE_DAYS, now);
  if (f.state === "unavailable") return <div className="tiny faint">Generation time unknown</div>;
  return (
    <>
      <div className="tiny faint">Generated {formatTimestamp(snap.generatedAt)}</div>
      {f.state === "stale" && (
        <div className="tiny band-amber" role="status">
          {formatDuration(f.ageMs)} old: the weekly scan may have failed.
        </div>
      )}
    </>
  );
}
