/**
 * SEC EDGAR helpers: CIK lookup, filing selection and link building. Pure (no
 * network), so the selection rules can be tested with fixtures. Also used by
 * scripts/update-universe.ts, so it must not import server-only code.
 *
 * SEC asks automated tools to identify themselves with a contact address and
 * rejects undeclared ones (https://www.sec.gov/os/accessing-edgar-data).
 */

export const ANNUAL_FORMS = ["10-K", "20-F", "40-F"] as const;
export const QUARTERLY_FORMS = ["10-Q"] as const;

export interface Filing {
  form: string;
  /** Filing date, YYYY-MM-DD. */
  filed: string;
  /** End of the period the report covers, when EDGAR records it. */
  period?: string;
  url: string;
}

/** The newest original report, plus an amendment only when it was filed on or after that report. Never merged. */
export interface FilingPair {
  latest?: Filing;
  amendment?: Filing;
}

export interface Filings {
  company: string;
  annual: FilingPair;
  quarterly: FilingPair;
}

export interface FilingLinks {
  all: string;
  annual: string;
  quarterly: string;
}

export type FilingsResult = { symbol: string; cik?: string; links?: FilingLinks } & (
  | { status: "ok"; filings: Filings; fetchedAt: string }
  /** SEC_USER_AGENT isn't set, so no lookup was made. Links still work in the browser. */
  | { status: "not-configured" }
  | { status: "unavailable"; reason: string }
  /** No CIK on file: links search EDGAR by ticker instead. */
  | { status: "unknown-company" }
  | { status: "not-us" }
  | { status: "demo" }
);

export const padCik = (cik: string | number) => String(cik).replace(/\D/g, "").padStart(10, "0");

/** Yahoo-style symbol: BRK.B and BRK-B are the same share class. */
export const normalizeSymbol = (s: string) => s.trim().toUpperCase().replace(/\./g, "-");

/** Yahoo marks non-US listings with an exchange suffix (NOVO-B.CO, SAP.DE). Check the universe before calling this. */
export const isForeignListing = (symbol: string) => /\.[A-Z]{1,4}$/i.test(symbol.trim());

export function cikFor(members: readonly { symbol: string; cik?: string }[], symbol: string): string | undefined {
  const s = normalizeSymbol(symbol);
  return members.find((m) => normalizeSymbol(m.symbol) === s)?.cik;
}

/** SEC_USER_AGENT must name the app and a contact email, e.g. "Stock Scout you@example.com". */
export function secUserAgent(env: Record<string, string | undefined> = process.env): string | undefined {
  const ua = env.SEC_USER_AGENT?.trim();
  return ua && ua.includes("@") ? ua : undefined;
}

/** EDGAR filing lists, opened in the viewer's browser. By CIK when known, otherwise by ticker. */
export function edgarLinks(symbol: string, cik?: string, annualForm = "10-K"): FilingLinks {
  const id = cik ? padCik(cik) : encodeURIComponent(normalizeSymbol(symbol));
  const list = (type: string) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${id}&type=${encodeURIComponent(type)}&dateb=&owner=include&count=40`;
  return { all: list(""), annual: list(annualForm), quarterly: list("10-Q") };
}

export function documentUrl(cik: string, accession: string, primaryDocument?: string) {
  const folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}`;
  return primaryDocument ? `${folder}/${primaryDocument}` : `${folder}/${accession}-index.htm`;
}

/** Column arrays from the `filings.recent` block of data.sec.gov/submissions/CIK##########.json. */
export interface RecentFilings {
  form?: string[];
  filingDate?: string[];
  reportDate?: string[];
  accessionNumber?: string[];
  primaryDocument?: string[];
}

export function pickFilings(cik: string, recent: RecentFilings, forms: readonly string[]): FilingPair {
  const rows = (recent.form ?? [])
    .map((form, i) => ({
      form,
      filed: recent.filingDate?.[i] ?? "",
      period: recent.reportDate?.[i] || undefined,
      accession: recent.accessionNumber?.[i] ?? "",
      doc: recent.primaryDocument?.[i] || undefined,
    }))
    .filter((r) => r.filed && r.accession)
    .sort((a, b) => b.filed.localeCompare(a.filed));
  const toFiling = (r: (typeof rows)[number]): Filing => ({ form: r.form, filed: r.filed, period: r.period, url: documentUrl(cik, r.accession, r.doc) });
  const base = rows.find((r) => forms.includes(r.form));
  const amendment = rows.find((r) => forms.some((f) => r.form === `${f}/A`) && (!base || r.filed >= base.filed));
  return { latest: base && toFiling(base), amendment: amendment && toFiling(amendment) };
}

export function parseSubmissions(cik: string, body: { name?: string; filings?: { recent?: RecentFilings } }): Filings {
  const recent = body.filings?.recent ?? {};
  return {
    company: body.name ?? "",
    annual: pickFilings(cik, recent, ANNUAL_FORMS),
    quarterly: pickFilings(cik, recent, QUARTERLY_FORMS),
  };
}
