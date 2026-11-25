"use client";

import { useState } from "react";
import { LONG_TERM, useCached } from "@/lib/client";
import type { NewsResult } from "@/lib/data/news-map";
import { formatAge, formatTimestamp } from "@/lib/freshness";
import { Updating } from "./ui";

const MAX_SYMBOLS = 12;

/** Headlines, or why there are none. Each headline links to the publisher's story in a new tab. */
export function NewsView({ result, subject, showSymbols = false, now = Date.now() }: { result: NewsResult; subject: string; showSymbols?: boolean; now?: number }) {
  if (result.status === "demo") return <p className="muted small" style={{ margin: 0 }}>Demo companies are fictional, so they have no news.</p>;
  if (result.status === "unavailable") return <p className="band-amber small" style={{ margin: 0 }}>{result.reason}</p>;
  const partial = result.failed.length > 0 && <p className="tiny band-amber" style={{ margin: "6px 0 0" }}>Couldn&apos;t load news for {result.failed.join(", ")}.</p>;
  if (result.status === "none") {
    return (
      <>
        <p className="muted small" style={{ margin: 0 }}>Yahoo Finance has no recent stories tagged with {subject}.</p>
        {partial}
      </>
    );
  }
  return (
    <>
      <ul className="news">
        {result.items.map((n) => (
          <li key={n.id}>
            <a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a>
            <div className="tiny muted">
              {n.publisher}
              {n.publishedAt && (
                <>
                  {" · "}
                  <time dateTime={n.publishedAt} title={formatTimestamp(n.publishedAt)}>{formatAge(Math.max(0, now - Date.parse(n.publishedAt)))}</time>
                </>
              )}
              {showSymbols && <> · <span className="num">{n.symbols.join(", ")}</span></>}
            </div>
          </li>
        ))}
      </ul>
      {partial}
    </>
  );
}

function useNews(symbols: string[], enabled: boolean) {
  const key = symbols.slice(0, MAX_SYMBOLS).join(",");
  const { data: result, error, updating } = useCached<NewsResult>(enabled && key ? `/api/news?symbols=${encodeURIComponent(key)}` : undefined, LONG_TERM);
  return { result, error, updating };
}

const NOTE = "Headlines from Yahoo Finance, linked to the original stories. They are not part of the score.";

export function StockNews({ symbol }: { symbol: string }) {
  const { result, error, updating } = useNews([symbol], true);
  return (
    <section className="panel small">
      <h3>Recent news <Updating on={updating} /></h3>
      <p className="tiny muted">{NOTE}</p>
      {result ? <NewsView result={result} subject={symbol} /> : error ? <p className="band-red" style={{ margin: 0 }}>Couldn&apos;t load news: {error}</p> : <div className="skeleton" style={{ height: 90 }} />}
    </section>
  );
}

/** News for a list of stocks, fetched only when opened so browsing lists costs no news requests. */
export function ListNews({ symbols, name }: { symbols: string[]; name: string }) {
  const [open, setOpen] = useState(false);
  const { result, error, updating } = useNews(symbols, open);
  if (!symbols.length) return null;
  return (
    <details className="small" style={{ marginTop: 12 }} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary style={{ cursor: "pointer" }}>Recent news for {name} <Updating on={updating} /></summary>
      <div style={{ marginTop: 8 }}>
        <p className="tiny muted">
          {NOTE}
          {symbols.length > MAX_SYMBOLS && ` Showing the first ${MAX_SYMBOLS} of ${symbols.length} stocks.`}
        </p>
        {result ? <NewsView result={result} subject="these stocks" showSymbols /> : error ? <p className="band-red">Couldn&apos;t load news: {error}</p> : open && <div className="skeleton" style={{ height: 90 }} />}
      </div>
    </details>
  );
}
