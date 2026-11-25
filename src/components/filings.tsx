"use client";

import { LONG_TERM, useCached } from "@/lib/client";
import type { FilingLinks, FilingPair, FilingsResult } from "@/lib/data/sec-map";
import { Updating } from "./ui";

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

function Report({ label, pair, list, note }: { label: string; pair: FilingPair; list: string; note?: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {pair.latest ? (
          <>
            <a href={pair.latest.url} {...ext}>Form {pair.latest.form}, filed {day(pair.latest.filed)}</a>
            {pair.latest.period && <span className="muted"> · period ending {day(pair.latest.period)}</span>}
          </>
        ) : (
          <span className="muted">{note ?? "None in EDGAR's recent filings."}</span>
        )}
        {pair.amendment && (
          <div>
            <span className="chip">Amendment</span>{" "}
            <a href={pair.amendment.url} {...ext}>Form {pair.amendment.form}, filed {day(pair.amendment.filed)}</a>
            <span className="muted"> · read it together with the original report.</span>
          </div>
        )}
        <div className="tiny"><a href={list} {...ext}>Earlier {label.toLowerCase()}s on EDGAR</a></div>
      </dd>
    </>
  );
}

function Links({ links, prefix }: { links: FilingLinks; prefix: string }) {
  return (
    <p style={{ margin: 0 }}>
      {prefix} <a href={links.annual} {...ext}>annual reports</a> · <a href={links.quarterly} {...ext}>quarterly reports</a> ·{" "}
      <a href={links.all} {...ext}>all filings</a>
    </p>
  );
}

/** What EDGAR returned, or why it couldn't be asked. The links always work, even when the lookup didn't. */
export function FilingsView({ result: r }: { result: FilingsResult }) {
  if (r.status === "demo") return <p className="muted" style={{ margin: 0 }}>Demo companies are fictional and have no SEC filings.</p>;
  if (r.status === "not-us") {
    return <p className="muted" style={{ margin: 0 }}>SEC filings cover companies listed in the US. {r.symbol} trades on an exchange outside the US.</p>;
  }
  if (r.status !== "ok") {
    const why =
      r.status === "not-configured" ? "Latest report dates appear here once SEC_USER_AGENT is set." :
      r.status === "unavailable" ? `SEC EDGAR is unavailable right now. ${r.reason}` :
      `There is no SEC company number on file for ${r.symbol}; we keep them for S&P 500 and Nasdaq-100 companies. These links search EDGAR by ticker.`;
    return (
      <>
        <p className="muted">{why}</p>
        {r.links && <Links links={r.links} prefix="Open EDGAR:" />}
      </>
    );
  }
  const f = r.filings;
  const foreign = f.annual.latest && f.annual.latest.form !== "10-K";
  return (
    <>
      <dl className="facts">
        {r.links && (
          <>
            <Report label="Annual report" pair={f.annual} list={r.links.annual} />
            <Report
              label="Quarterly report"
              pair={f.quarterly}
              list={r.links.quarterly}
              note={foreign ? `None on file. Companies filing Form ${f.annual.latest?.form} usually report quarterly results on other forms.` : undefined}
            />
          </>
        )}
      </dl>
      {r.links && <p className="tiny" style={{ marginBottom: 0 }}><a href={r.links.all} {...ext}>All {f.company || r.symbol} filings on EDGAR</a></p>}
    </>
  );
}

/** Official reports next to the score. Loaded separately, so an SEC problem never blocks the page. */
export function FilingsPanel({ symbol }: { symbol: string }) {
  const { data: result, error, updating } = useCached<FilingsResult>(`/api/filings/${encodeURIComponent(symbol)}`, LONG_TERM);
  return (
    <section className="panel small">
      <h3>Company reports (SEC) <Updating on={updating} /></h3>
      <p className="tiny muted">
        Official filings from SEC EDGAR. The score takes recent years from Yahoo Finance and can take older years from these filings, so recent figures can differ.
      </p>
      {result ? <FilingsView result={result} /> : error ? <p className="band-red" style={{ margin: 0 }}>Couldn&apos;t load filing links: {error}</p> : <div className="skeleton" style={{ height: 64 }} />}
    </section>
  );
}
