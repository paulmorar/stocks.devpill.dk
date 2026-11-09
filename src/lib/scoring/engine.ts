import type { CompanyData } from "../types";
import { cagr, isNum, pct } from "../util";
import { runCheck } from "./check";
import { mainChecks } from "./checks-main";
import { financialChecks, tbvps } from "./checks-financials";
import { buildMetrics, type Metrics, strictFcf } from "./metrics";
import { bandOf, hasLimitedHistory, MIN_HISTORY_YEARS, type PillarId, type PillarResult, type RedFlag, type ScoreResult } from "./types";

export const PILLARS: Record<PillarId, { label: string; max: number; question: string; simpleQuestion: string }> = {
  value: { label: "Value", max: 25, question: "Is the price reasonable for what you get?", simpleQuestion: "Is it a fair price?" },
  growth: { label: "Growth", max: 25, question: "Is the business getting bigger?", simpleQuestion: "Is it growing?" },
  quality: { label: "Quality", max: 30, question: "Does it consistently earn strong returns?", simpleQuestion: "Does it earn steady profits?" },
  health: { label: "Financial Health", max: 20, question: "Can it pay its bills without diluting shareholders?", simpleQuestion: "Can it pay its bills without issuing more shares?" },
};

/** Card networks and payment processors stay on the main scorecard (per the methodology). */
const MAIN_SCORECARD_FINANCIALS = new Set(["V", "MA", "PYPL"]);
/** Clearing-house exchanges go on the financials scorecard; data/ratings firms (SPGI, MCO, MSCI) don't. */
const CLEARING_EXCHANGES = new Set(["CME", "ICE", "NDAQ", "CBOE", "DB1.DE", "LSEG.L", "0388.HK"]);
/** Yahoo industry names: "Banks - Regional", "Insurance - Life", "Capital Markets", "Credit Services", ... */
const FIN_INDUSTRY = /bank|insurance|capital markets|asset management|credit services|mortgage finance|financial conglomerates|brokers|reinsurance|thrift|consumer finance/i;

export function isFinancial(c: CompanyData) {
  const sym = c.profile.symbol.toUpperCase();
  if (MAIN_SCORECARD_FINANCIALS.has(sym)) return false;
  if (CLEARING_EXCHANGES.has(sym)) return true;
  return FIN_INDUSTRY.test(c.profile.industry ?? "");
}

export function notScoredReason(c: CompanyData): string | undefined {
  const qt = (c.profile.quoteType ?? "EQUITY").toUpperCase();
  if (qt === "ETF" || qt === "MUTUALFUND") return "We don't score ETFs or funds because they hold many companies.";
  if (/reit/i.test(c.profile.industry ?? "")) return "We don't score REITs because property depreciation makes these checks unsuitable.";
  if (c.annual.length < MIN_HISTORY_YEARS) return `Only ${c.annual.length} years of history; at least ${MIN_HISTORY_YEARS} are needed.`;
  return undefined;
}

function mainFlags(m: Metrics): RedFlag[] {
  const flags: RedFlag[] = [];
  const lf = m.latestFlow;
  if (lf && isNum(lf.netIncome) && lf.netIncome < 0) {
    flags.push({ id: "net_loss", label: "Net loss over the last 12 months", explain: {
      expert: `Trailing-12-month net income is negative.`, simple: "The company lost money over the past year." } });
  }
  const last3 = m.annual.slice(-3).map(strictFcf).filter(isNum);
  if (last3.length >= 3 && last3.filter((v) => v < 0).length >= 2) {
    flags.push({ id: "neg_fcf", label: "Negative free cash flow in 2 of the last 3 years", explain: {
      expert: "Strict FCF (OCF − all capex) was negative in at least 2 of the last 3 fiscal years.", simple: "In two of the last three years it spent more cash than it brought in." } });
  }
  const shareFlag = dilutionFlag(m);
  if (shareFlag) flags.push(shareFlag);
  if (lf && isNum(lf.operatingIncome) && isNum(lf.interestExpense) && lf.interestExpense > 0) {
    const cov = lf.operatingIncome / lf.interestExpense;
    if (cov < 2) {
      flags.push({ id: "low_coverage", label: "Operating profit covers interest less than 2×", explain: {
        expert: `Interest coverage ${cov.toFixed(1)}×.`, simple: "Its profit barely covers the interest on its debt." } });
    }
  }
  return flags;
}

function dilutionFlag(m: Metrics): RedFlag | undefined {
  const rows = m.annual.filter((r) => isNum(r.dilutedShares ?? r.sharesOutstanding)).slice(-4);
  if (rows.length < 2) return undefined;
  const a = rows[0]!;
  const b = rows.at(-1)!;
  const g = cagr(a.dilutedShares ?? a.sharesOutstanding, b.dilutedShares ?? b.sharesOutstanding, b.fy - a.fy);
  if (isNum(g) && g > 0.04) {
    return { id: "dilution", label: "Share count growing more than 4% a year", explain: {
      expert: `Diluted shares grew ${pct(g)} a year over ${b.fy - a.fy} years.`, simple: "It keeps printing new shares, shrinking every owner's slice." } };
  }
  return undefined;
}

function financialFlags(m: Metrics): RedFlag[] {
  const flags: RedFlag[] = [];
  const lf = m.latestFlow;
  const bal = m.latestBalance;
  if (lf && isNum(lf.netIncome) && lf.netIncome < 0) {
    flags.push({ id: "net_loss", label: "Net loss over the last 12 months", explain: { expert: "TTM net income is negative.", simple: "It lost money over the past year." } });
  }
  if (bal && isNum(bal.equity) && isNum(bal.totalAssets) && bal.totalAssets > 0 && bal.equity / bal.totalAssets < 0.05) {
    flags.push({ id: "thin_equity", label: "Equity under 5% of total assets", explain: { expert: `Equity/assets ${pct(bal.equity / bal.totalAssets)}.`, simple: "A small drop in what it owns could wipe out the owners." } });
  }
  const last3 = m.annual.slice(-3);
  if (last3.length >= 3 && last3.filter((r) => isNum(r.netIncome) && (r.dividendsPaid ?? 0) > Math.max(r.netIncome, 0)).length >= 2) {
    flags.push({ id: "overpaying", label: "Dividends above earnings in 2 of the last 3 years", explain: { expert: "Payout ratio above 100% in 2 of 3 years.", simple: "It paid out more in dividends than it earned." } });
  }
  const d = dilutionFlag(m);
  if (d) flags.push(d);
  const tb = m.annual.map(tbvps).filter(isNum).slice(-4);
  if (tb.length === 4 && tb[1]! < tb[0]! && tb[2]! < tb[1]! && tb[3]! < tb[2]!) {
    flags.push({ id: "tbv_falling", label: "Tangible book value per share down 3 years straight", explain: { expert: "TBVPS declined for three consecutive years.", simple: "Its net worth per share has shrunk three years in a row." } });
  }
  return flags;
}

export function scoreCompany(c: CompanyData): ScoreResult {
  const m = buildMetrics(c);
  const financial = isFinancial(c);
  const reason = notScoredReason(c);
  const notes: string[] = [];
  if (!reason && hasLimitedHistory(m.annual.length)) {
    notes.push(`Limited history: ${m.annual.length} annual reports. This score is provisional. We skip checks that need more data and share their points across the remaining checks in the same pillar.`);
  }
  if (m.capexMode && financial) notes.push("CAPEX: spending is more than 2× depreciation. The financials scorecard doesn't use cash-flow checks, so this is informational.");
  if (m.capexMode && !financial) notes.push("CAPEX mode: spending is more than 2× depreciation, so cash conversion and the cash-flow trend only subtract maintenance spending.");
  if (financial) notes.push("Scored on the financials scorecard (book value and return on equity).");

  const defs = financial ? financialChecks(c, m) : mainChecks(c, m);
  const results = defs.map(runCheck);

  const pillars: PillarResult[] = (Object.keys(PILLARS) as PillarId[]).map((id) => {
    const p = PILLARS[id];
    const checks = results.filter((r) => r.pillar === id);
    const live = checks.filter((r) => r.score !== undefined);
    const each = live.length ? p.max / live.length : 0;
    for (const ch of live) {
      ch.maxPoints = each;
      ch.points = each * (ch.score as number);
    }
    return { id, label: p.label, question: p.question, simpleQuestion: p.simpleQuestion, maxPoints: p.max, points: live.reduce((a, r) => a + r.points, 0), checks };
  });

  const availableMax = pillars.filter((p) => p.checks.some((ch) => ch.score !== undefined)).reduce((a, p) => a + p.maxPoints, 0);
  const sum = pillars.reduce((a, p) => a + p.points, 0);
  const raw = availableMax ? Math.round((sum / availableMax) * 100) : 0;
  if (availableMax && availableMax < 100) notes.push(`A whole pillar had no data; the score is scaled from ${availableMax} available points.`);

  const redFlags = financial ? financialFlags(m) : mainFlags(m);
  const cap = redFlags.length >= 2 ? 39 : redFlags.length === 1 ? 59 : undefined;
  const total = cap !== undefined ? Math.min(raw, cap) : raw;

  return {
    symbol: c.profile.symbol,
    scorable: !reason,
    notScoredReason: reason,
    scorecard: financial ? "financials" : "main",
    // Shown on financials too (TTT marks ERIE as F + CAPEX); only the main card changes its cash-flow checks.
    capexMode: m.capexMode,
    raw,
    total,
    band: bandOf(total),
    cap: cap !== undefined && raw > cap ? cap : undefined,
    pillars,
    redFlags,
    yearsOfHistory: m.annual.length,
    notes,
  };
}
