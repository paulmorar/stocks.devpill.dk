import type { CompanyData } from "../types";
import { fx, isNum, mean, pct, scale, signedPct, slope, stdev } from "../util";
import { type CheckDef, skip } from "./check";
import {
  cagrOver, currentPE, maintenanceFcf, median, type Metrics, peHistory, roic, series, strictFcf,
} from "./metrics";

/**
 * Main scorecard checks. Calibrations (where partial credit starts and maxes out)
 * are this app's own choices — the TTT methodology names the checks but does not
 * publish thresholds. Each `rule` string is shown in the UI so nothing is hidden.
 */
export function mainChecks(c: CompanyData, m: Metrics): CheckDef[] {
  const name = c.profile.name;
  const flows = m.flows;
  const lf = m.latestFlow;
  const bal = m.latestBalance;
  const cashLabel = m.capexMode ? "cash flow after maintenance spending" : "free cash flow";
  const cashOf = m.capexMode ? maintenanceFcf : strictFcf;

  return [
    // ───────────── VALUE (25) ─────────────
    {
      id: "pe_vs_median", pillar: "value", label: "P/E vs its own 5-year median",
      rule: "0 pts at 1.4× its median, full at 0.7×",
      run: () => {
        const pe = currentPE(c, m);
        const hist = peHistory(m, c.prices, 5);
        const med = median(hist);
        if (!isNum(pe)) return skip("No positive trailing earnings");
        if (!isNum(med) || hist.length < 3) return skip("Fewer than 3 years of P/E history");
        const ratio = pe / med;
        return {
          score: scale(ratio, 1.4, 0.7),
          display: `${fx(pe)}× vs ${fx(med)}× median`,
          expert: `Trailing P/E ${fx(pe)}× against a 5-year median of ${fx(med)}× (${fx(ratio, 2)}× its norm). Below 1.0× means the market is paying less than usual for each dollar of earnings.`,
          simple: `P/E is how many years of today's profit you pay for when you buy the stock. ${name} costs about ${fx(pe, 0)} years of profit right now; over the last five years it usually cost ${fx(med, 0)}. ${ratio < 0.95 ? "So it's cheaper than normal for this company." : ratio > 1.05 ? "So it's pricier than normal for this company." : "That's about its usual price."}`,
        };
      },
    },
    {
      id: "peg", pillar: "value", label: "PEG (forward P/E ÷ expected growth)",
      rule: "0 pts at 2.5, full at 1.0 or lower",
      run: () => {
        const fpe = c.market.forwardPE;
        const g = c.market.epsGrowthLongTerm ?? c.market.epsGrowthNextYear;
        if (!isNum(fpe) || fpe <= 0) return skip("No forward P/E");
        if (!isNum(g)) return skip("No analyst growth estimate");
        if (g <= 0) {
          return {
            score: 0, display: `growth ${signedPct(g)}`,
            expert: `Analysts expect EPS to shrink (${signedPct(g)}), so PEG is undefined and scores zero.`,
            simple: `Experts who follow ${name} expect its profit to shrink, so paying ${fx(fpe, 0)}× next year's profit isn't backed by growth.`,
          };
        }
        const peg = fpe / (g * 100);
        return {
          score: scale(peg, 2.5, 1.0),
          display: `${fx(peg, 2)}`,
          expert: `Forward P/E ${fx(fpe)}× over expected EPS growth of ${pct(g)} gives a PEG of ${fx(peg, 2)}. Around 1 means you pay roughly one turn of P/E per point of growth.`,
          simple: `This compares the price to how fast profit is expected to grow. A score near 1 is a fair deal; higher means you're paying extra for the growth. ${name} is at ${fx(peg, 1)}.`,
        };
      },
    },
    {
      id: "fwd_vs_trailing", pillar: "value", label: "Forward vs trailing earnings",
      rule: "0 pts at −5%, full at +15% or better",
      run: () => {
        const t = c.market.trailingEps ?? lf?.eps;
        const f = c.market.forwardEps;
        if (!isNum(t) || t <= 0) return skip("No positive trailing EPS");
        if (!isNum(f)) return skip("No forward EPS estimate");
        const d = f / t - 1;
        return {
          score: scale(d, -0.05, 0.15),
          display: signedPct(d),
          expert: `Consensus next-12-month EPS of ${fx(f, 2)} vs trailing ${fx(t, 2)}: ${signedPct(d, 1)}. Estimates can be wrong and are revised often.`,
          simple: `Analysts guess ${name} will earn ${d >= 0 ? `${pct(d, 0)} more` : `${pct(-d, 0)} less`} over the next year than it did over the last one. ${d >= 0.05 ? "That's a good sign — if they're right." : "That's not much of a tailwind."}`,
        };
      },
    },
    {
      id: "fcf_yield", pillar: "value", label: "Free-cash-flow yield",
      rule: "0 pts at 1%, full at 6% or higher",
      run: () => {
        const fcf = lf ? strictFcf(lf) : undefined;
        if (!isNum(fcf)) return skip("No free cash flow");
        if (!isNum(m.marketCap) || m.marketCap <= 0) return skip("No market cap");
        const y = fcf / m.marketCap;
        return {
          score: scale(y, 0.01, 0.06),
          display: pct(y),
          expert: `Strict FCF (operating cash flow minus all capex) of the latest 12 months over market cap: ${pct(y)}.${m.capexMode ? " Strict FCF is used here even in CAPEX mode." : ""}`,
          simple: `If you bought the whole company, this is the spare cash it would hand you each year per $100 you paid: about $${fx(y * 100, 1)}. ${y >= 0.04 ? "That's a healthy return." : y > 0 ? "That's modest." : "It's currently burning cash."}`,
        };
      },
    },

    // ───────────── GROWTH (25) ─────────────
    {
      id: "rev_cagr_5", pillar: "growth", label: "Revenue growth, 5 years",
      rule: "0 pts at 0%/yr, full at 15%/yr",
      run: () => {
        const g = cagrOver(series(m.annual, (r) => r.revenue), 5);
        if (!g || g.span < 4) return skip("Fewer than 5 years of revenue");
        return {
          score: scale(g.g, 0, 0.15),
          display: `${signedPct(g.g, 1)}/yr`,
          expert: `Revenue compounded at ${signedPct(g.g, 1)} a year over ${g.span} fiscal years.`,
          simple: `Over the last ${g.span} years, ${name}'s sales grew about ${pct(g.g, 0)} a year on average. ${g.g >= 0.1 ? "That's fast." : g.g >= 0.04 ? "That's steady." : "That's slow or shrinking."}`,
        };
      },
    },
    {
      id: "rev_cagr_10", pillar: "growth", label: "Revenue growth, 10 years",
      rule: "0 pts at 0%/yr, full at 12%/yr",
      run: () => {
        const g = cagrOver(series(m.annual, (r) => r.revenue), 10);
        if (!g || g.span < 8) return skip("Fewer than 8 years of revenue (add an FMP key for more)");
        return {
          score: scale(g.g, 0, 0.12),
          display: `${signedPct(g.g, 1)}/yr`,
          expert: `Long-run revenue CAGR of ${signedPct(g.g, 1)} over ${g.span} years — the through-cycle track record.`,
          simple: `Looking back about ${g.span} years, sales grew ${pct(g.g, 0)} a year. A long record matters because a few good years can be luck.`,
        };
      },
    },
    trendCheck("ni_trend", "Net income trend", "profit", flows.map((r) => r.netIncome), name),
    trendCheck(
      "cf_trend",
      m.capexMode ? "Cash-flow trend (maintenance basis)" : "Cash-flow trend",
      m.capexMode ? "cash after maintenance spending" : "free cash flow",
      flows.map(cashOf),
      name,
    ),

    // ───────────── QUALITY (30) ─────────────
    {
      id: "roic", pillar: "quality", label: "Return on invested capital",
      rule: "0 pts at 5%, full at 20% or higher",
      run: () => {
        if (!lf || !bal) return skip("No statements");
        const v = roic(lf, bal);
        if (!isNum(v)) return skip("Missing operating income or capital");
        return {
          score: scale(v, 0.05, 0.2),
          display: pct(v),
          expert: `After-tax operating profit over (debt + equity − cash): ${pct(v)}. Above ~10% usually beats the cost of capital.`,
          simple: `For every $100 put into the business, ${name} earns about $${fx(v * 100, 0)} a year. ${v >= 0.15 ? "That's excellent." : v >= 0.08 ? "That's decent." : "That's weak."}`,
        };
      },
    },
    {
      id: "margin_stability", pillar: "quality", label: "Operating margin stability",
      rule: "Steadiness: 0 pts at 8-pt swings, full at 1-pt. Shrinking margins penalized.",
      run: () => {
        const margins = flows
          .filter((r) => isNum(r.operatingIncome) && isNum(r.revenue) && (r.revenue as number) > 0)
          .map((r) => (r.operatingIncome as number) / (r.revenue as number))
          .slice(-10);
        if (margins.length < 4) return skip("Fewer than 4 years of margins");
        const sd = stdev(margins) as number;
        const sl = slope(margins) as number;
        const score = scale(sd, 0.08, 0.01) * 0.6 + scale(sl, -0.015, 0.005) * 0.4;
        const avg = mean(margins) as number;
        return {
          score,
          display: `${pct(avg)} avg, ±${fx(sd * 100, 1)} pts`,
          expert: `Operating margin averaged ${pct(avg)} with a standard deviation of ${fx(sd * 100, 1)} pts; trend ${sl >= 0 ? "+" : "−"}${fx(Math.abs(sl) * 100, 2)} pts/yr.`,
          simple: `Out of every $100 of sales, ${name} keeps about $${fx(avg * 100, 0)} as operating profit. ${sd < 0.03 ? "It's kept that steady" : "It swings around quite a bit"}${sl < -0.005 ? ", and it's been slipping." : sl > 0.005 ? ", and it's been improving." : "."}`,
        };
      },
    },
    {
      id: "cash_conversion", pillar: "quality", label: m.capexMode ? "Cash conversion (maintenance basis)" : "Cash conversion",
      rule: "0 pts at 50% of profit, full at 100%+",
      run: () => {
        const recent = flows.slice(-3);
        const ni = recent.reduce((a, r) => a + (r.netIncome ?? 0), 0);
        const cash = recent.map(cashOf);
        if (cash.some((v) => !isNum(v))) return skip("Missing cash-flow data");
        if (ni <= 0) return skip("No positive profit to convert");
        const ratio = (cash as number[]).reduce((a, b) => a + b, 0) / ni;
        return {
          score: scale(ratio, 0.5, 1.0),
          display: pct(ratio, 0),
          expert: `${m.capexMode ? "OCF minus maintenance capex (≈ depreciation)" : "Free cash flow"} over net income, last ${recent.length} periods: ${pct(ratio, 0)}.${m.capexMode ? " Growth capex is excluded because the company is in an unusual build-out (CAPEX mode)." : ""}`,
          simple: `Profit on paper isn't the same as cash in the bank. For every $100 ${name} reported as profit, about $${fx(ratio * 100, 0)} actually showed up as spare cash. ${ratio >= 0.9 ? "That's what you want to see." : "Some of the profit isn't turning into cash."}`,
        };
      },
    },
    {
      id: "roic_durability", pillar: "quality", label: "ROIC durability",
      rule: "Share of years with ROIC ≥ 15% (70%) plus median ROIC (30%)",
      run: () => {
        const vals = m.annual.slice(-10).map((r) => roic(r)).filter(isNum);
        if (vals.length < 4) return skip("Fewer than 4 years of ROIC");
        const good = vals.filter((v) => v >= 0.15).length;
        const med = median(vals) as number;
        return {
          score: (good / vals.length) * 0.7 + scale(med, 0.08, 0.2) * 0.3,
          display: `${good}/${vals.length} yrs ≥15%`,
          expert: `ROIC cleared 15% in ${good} of ${vals.length} years (median ${pct(med)}). Persistence suggests a moat rather than a cyclical peak.`,
          simple: `Did ${name} earn great returns year after year, or just once? It hit the "great" bar in ${good} of the last ${vals.length} years.`,
        };
      },
    },

    // ───────────── FINANCIAL HEALTH (20) ─────────────
    {
      id: "debt_load", pillar: "health", label: "Debt load",
      rule: "Debt/equity: 0 pts at 2.0, full at 0.3. Net debt/EBITDA (if buybacks shrank equity): 0 pts at 4×, full at 1×.",
      run: () => {
        if (!bal) return skip("No balance sheet");
        const debt = bal.totalDebt ?? 0;
        const eq = bal.equity;
        const ebitda = lf?.ebitda ?? (isNum(lf?.operatingIncome) && isNum(lf?.da) ? (lf?.operatingIncome as number) + (lf?.da as number) : undefined);
        const shares = series(m.annual, (r) => r.dilutedShares);
        const shrank = shares.length >= 2 && (shares.at(-1)!.v / shares[Math.max(0, shares.length - 6)]!.v) < 0.95;
        const de = isNum(eq) && eq > 0 ? debt / eq : undefined;
        const useEbitda = !isNum(de) || (shrank && de > 1.5);
        let out;
        if (useEbitda) {
          if (!isNum(ebitda) || ebitda <= 0) return skip("Negative equity and no EBITDA");
          const nd = (debt - (bal.cash ?? 0)) / ebitda;
          out = {
            score: scale(nd, 4, 1),
            display: `${fx(nd, 1)}× net debt/EBITDA`,
            expert: `Equity is ${isNum(eq) && eq <= 0 ? "negative" : "shrunk by buybacks"}, so debt is measured against earnings: net debt is ${fx(nd, 1)}× EBITDA.`,
            simple: `${name} owes about ${fx(Math.max(nd, 0), 1)} years' worth of its yearly operating earnings (after counting its cash). Under 2 years is comfortable.`,
          };
        } else {
          out = {
            score: debt <= 0 ? 1 : scale(de as number, 2.0, 0.3),
            display: `${fx(de, 2)} debt/equity`,
            expert: `Total debt is ${fx(de, 2)}× shareholders' equity.`,
            simple: `For every $1 the owners have in the business, ${name} has borrowed about $${fx(de, 2)}. ${(de as number) < 0.5 ? "That's light borrowing." : (de as number) < 1.2 ? "That's moderate." : "That's a lot of borrowing."}`,
          };
        }
        // CAPEX mode: "borrowing to build still gets capped".
        if (m.capexMode) {
          const recent = m.annual.slice(-3);
          const debtRose = recent.length >= 2 && (recent.at(-1)!.totalDebt ?? 0) > (recent[0]!.totalDebt ?? 0) * 1.15;
          const negFcf = lf && (strictFcf(lf) ?? 0) < 0;
          if (debtRose && negFcf) {
            out.score = Math.min(out.score, 0.5);
            out.expert += " Capped at half credit: debt is rising while strict free cash flow is negative (borrowing to build).";
            out.simple += " It's also borrowing to pay for its building spree, which limits this score.";
          }
        }
        return out;
      },
    },
    {
      id: "share_count", pillar: "health", label: "Share count",
      rule: "0 pts at +4%/yr dilution, full at −3%/yr (buybacks)",
      run: () => {
        const g = cagrOver(series(m.annual, (r) => r.dilutedShares ?? r.sharesOutstanding), 5);
        if (!g) return skip("No share-count history");
        return {
          score: scale(g.g, 0.04, -0.03),
          display: `${signedPct(g.g, 1)}/yr`,
          expert: `Diluted share count changed ${signedPct(g.g, 1)} a year over ${g.span} years (split-adjusted).`,
          simple: g.g < -0.005
            ? `${name} has been buying back its own shares, so each share you own is a slightly bigger slice of the company every year.`
            : g.g > 0.01
              ? `${name} keeps issuing new shares, so each share you own becomes a smaller slice of the company over time.`
              : `The number of shares has stayed about the same, so your slice of the company isn't shrinking.`,
        };
      },
    },
    {
      id: "interest_coverage", pillar: "health", label: "Interest coverage",
      rule: "0 pts at 2×, full at 15×",
      run: () => {
        const ebit = lf?.operatingIncome;
        const int = lf?.interestExpense;
        if (!isNum(ebit)) return skip("No operating income");
        if (!isNum(int) || int <= 0) {
          const debt = bal?.totalDebt ?? 0;
          if (debt <= 0 || (isNum(lf?.revenue) && debt < (lf?.revenue as number) * 0.05)) {
            return { score: 1, display: "no meaningful interest", expert: "No material interest expense.", simple: `${name} pays little or no interest on debt, so this is no worry.` };
          }
          return skip("Interest expense not reported");
        }
        const cov = ebit / int;
        return {
          score: scale(cov, 2, 15),
          display: `${fx(cov, 1)}×`,
          expert: `Operating profit covers interest ${fx(cov, 1)}×. Below 2× is a red flag.`,
          simple: `${name}'s yearly operating profit could pay its yearly interest bill about ${fx(Math.max(cov, 0), 0)} times over. ${cov >= 8 ? "Very safe." : cov >= 3 ? "OK." : "That's tight — a bad year could hurt."}`,
        };
      },
    },
    {
      id: "fcf_history", pillar: "health", label: "Free-cash-flow history",
      rule: "Share of the last 10 years with positive strict FCF: 0 pts at 40%, full at 100%",
      run: () => {
        const vals = m.annual.slice(-10).map(strictFcf).filter(isNum);
        if (vals.length < 4) return skip("Fewer than 4 years of cash flow");
        const pos = vals.filter((v) => v > 0).length;
        return {
          score: scale(pos / vals.length, 0.4, 1),
          display: `${pos}/${vals.length} yrs positive`,
          expert: `Strict free cash flow was positive in ${pos} of ${vals.length} fiscal years.`,
          simple: `In ${pos} of the last ${vals.length} years, ${name} had cash left over after paying all its bills and investments. More years is better.`,
        };
      },
    },
  ];

  function trendCheck(id: string, label: string, noun: string, values: (number | undefined)[], who: string): CheckDef {
    return {
      id, pillar: "growth", label,
      rule: "Half: share of years it rose. Half: growth rate (0 pts at 0%/yr, full at 15%/yr).",
      run: () => {
        const pts = values.map((v, i) => ({ v, fy: flows[i]?.fy ?? 0 })).filter((p): p is { v: number; fy: number } => isNum(p.v)).slice(-11);
        if (pts.length < 4) return skip(`Fewer than 4 years of ${noun}`);
        let ups = 0;
        for (let i = 1; i < pts.length; i++) if ((pts[i] as { v: number }).v > (pts[i - 1] as { v: number }).v) ups++;
        const upFrac = ups / (pts.length - 1);
        const first = pts[0] as { v: number; fy: number };
        const last = pts.at(-1) as { v: number; fy: number };
        const span = last.fy - first.fy;
        const g = first.v > 0 && last.v > 0 && span > 0 ? (last.v / first.v) ** (1 / span) - 1 : undefined;
        const rate = isNum(g) ? scale(g, 0, 0.15) : last.v <= 0 ? 0 : 0.5;
        return {
          score: upFrac * 0.5 + rate * 0.5,
          display: `${ups}/${pts.length - 1} yrs up${isNum(g) ? `, ${signedPct(g, 0)}/yr` : ""}`,
          expert: `${label}: rose in ${ups} of ${pts.length - 1} year-over-year comparisons (latest 12 months included)${isNum(g) ? `, compounding ${signedPct(g, 1)} a year` : "; no growth rate because the start or end is a loss"}.`,
          simple: `Did ${who}'s ${noun} keep going up? It rose in ${ups} out of ${pts.length - 1} years${isNum(g) ? `, by about ${pct(Math.abs(g), 0)} a year ${g >= 0 ? "on average" : "downward on average"}` : ""}.`,
        };
      },
    };
  }
}
