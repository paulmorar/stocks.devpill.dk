import type { CompanyData, PeriodRow } from "../types";
import { fx, isNum, mean, pct, scale, signedPct, slope, stdev } from "../util";
import { type CheckDef, skip } from "./check";
import { cagrOver, closeAt, currentPE, median, type Metrics, peHistory, roe, series } from "./metrics";

/**
 * Financials scorecard (marked F): banks, brokers, insurers, asset managers,
 * card lenders and clearing-house exchanges. Debt is their raw material, so
 * they're judged on book value and return on equity instead.
 */
export const tbvps = (r: PeriodRow) => {
  const sh = r.sharesOutstanding ?? r.dilutedShares;
  return isNum(r.tangibleBookValue) && isNum(sh) && sh > 0 ? r.tangibleBookValue / sh : undefined;
};

export function financialChecks(c: CompanyData, m: Metrics): CheckDef[] {
  const name = c.profile.name;
  const lf = m.latestFlow;
  const bal = m.latestBalance;

  const marginCheck: CheckDef = {
    id: "pretax_margin_stability", pillar: "quality", label: "Pre-tax margin stability",
    rule: "Steadiness: 0 pts at 8-pt swings, full at 1-pt. Shrinking margins penalized.",
    run: () => {
      const margins = m.flows
        .filter((r) => isNum(r.pretaxIncome) && isNum(r.revenue) && (r.revenue as number) > 0)
        .map((r) => (r.pretaxIncome as number) / (r.revenue as number))
        .slice(-10);
      if (margins.length < 4) return skip("Fewer than 4 years of margins");
      const sd = stdev(margins) as number;
      const sl = slope(margins) as number;
      const avg = mean(margins) as number;
      return {
        score: scale(sd, 0.08, 0.01) * 0.6 + scale(sl, -0.015, 0.005) * 0.4,
        display: `${pct(avg)} avg, ±${fx(sd * 100, 1)} pts`,
        expert: `Pre-tax margin averaged ${pct(avg)} (σ ${fx(sd * 100, 1)} pts, trend ${fx(sl * 100, 2)} pts/yr).`,
        simple: `Out of every $100 of revenue, ${name} keeps about $${fx(avg * 100, 0)} before tax, and ${sd < 0.03 ? "that's been steady" : "that moves around a lot"}.`,
      };
    },
  };

  return [
    // VALUE
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
          expert: `Trailing P/E ${fx(pe)}× vs a 5-year median of ${fx(med)}×.`,
          simple: `You pay about ${fx(pe, 0)} years of profit for ${name}; it's usually ${fx(med, 0)}. ${ratio < 0.95 ? "Cheaper than normal." : ratio > 1.05 ? "Pricier than normal." : "About normal."}`,
        };
      },
    },
    {
      id: "ptbv_vs_median", pillar: "value", label: "Price-to-tangible-book vs its history",
      rule: "0 pts at 1.4× its median, full at 0.7×",
      run: () => {
        const tb = bal?.tangibleBookValue;
        if (!isNum(tb) || tb <= 0 || !isNum(m.marketCap)) return skip("No tangible book value");
        const now = m.marketCap / tb;
        const hist = m.annual.slice(-5).map((r) => {
          const px = closeAt(c.prices, r.date);
          const sh = r.sharesOutstanding ?? r.dilutedShares;
          return isNum(px) && isNum(sh) && isNum(r.tangibleBookValue) && r.tangibleBookValue > 0 ? (px * sh) / r.tangibleBookValue : undefined;
        }).filter(isNum);
        const med = median(hist);
        if (!isNum(med) || hist.length < 3) return skip("Fewer than 3 years of book-value history");
        return {
          score: scale(now / med, 1.4, 0.7),
          display: `${fx(now, 2)}× vs ${fx(med, 2)}×`,
          expert: `Market cap is ${fx(now, 2)}× tangible book (strips goodwill and intangibles) vs a median of ${fx(med, 2)}×.`,
          simple: `Tangible book is roughly what the company would be worth if you sold everything it owns and paid off everything it owes. You're paying ${fx(now, 1)}× that; it's usually ${fx(med, 1)}×.`,
        };
      },
    },
    {
      id: "shareholder_yield", pillar: "value", label: "Shareholder yield",
      rule: "0 pts at 1%, full at 7%",
      run: () => {
        const row = m.annual.at(-1);
        if (!row || !isNum(m.marketCap)) return skip("No payout data");
        const paid = (row.dividendsPaid ?? 0) + (row.buybacks ?? 0);
        const y = paid / m.marketCap;
        return {
          score: scale(y, 0.01, 0.07),
          display: pct(y),
          expert: `Dividends plus buybacks over market cap: ${pct(y)}.`,
          simple: `Each year ${name} hands back about $${fx(y * 100, 1)} per $100 of stock, through dividends or by buying back shares.`,
        };
      },
    },
    // GROWTH
    {
      id: "tbvps_growth", pillar: "growth", label: "Tangible book value per share growth",
      rule: "0 pts at 0%/yr, full at 10%/yr",
      run: () => {
        const g = cagrOver(series(m.annual, tbvps), 5);
        if (!g) return skip("No tangible book history");
        return {
          score: scale(g.g, 0, 0.1),
          display: `${signedPct(g.g, 1)}/yr`,
          expert: `Tangible book per share compounded ${signedPct(g.g, 1)} a year over ${g.span} years — the core value-creation metric for a balance-sheet business.`,
          simple: `How fast is the "net worth per share" growing? About ${pct(Math.abs(g.g), 0)} a year ${g.g >= 0 ? "up" : "down"}.`,
        };
      },
    },
    {
      id: "rev_cagr_5", pillar: "growth", label: "Revenue growth, 5 years",
      rule: "0 pts at 0%/yr, full at 12%/yr",
      run: () => {
        const g = cagrOver(series(m.annual, (r) => r.revenue), 5);
        if (!g || g.span < 4) return skip("Fewer than 5 years of revenue");
        return {
          score: scale(g.g, 0, 0.12), display: `${signedPct(g.g, 1)}/yr`,
          expert: `Revenue CAGR ${signedPct(g.g, 1)} over ${g.span} years.`,
          simple: `${name}'s revenue grew about ${pct(g.g, 0)} a year over ${g.span} years.`,
        };
      },
    },
    {
      id: "eps_trend", pillar: "growth", label: "EPS trend",
      rule: "Half: share of years EPS rose. Half: growth rate (0 at 0%/yr, full at 12%/yr).",
      run: () => {
        const pts = series(m.flows, (r) => r.eps).slice(-11);
        if (pts.length < 4) return skip("Fewer than 4 years of EPS");
        let ups = 0;
        for (let i = 1; i < pts.length; i++) if (pts[i]!.v > pts[i - 1]!.v) ups++;
        const g = cagrOver(pts, 10);
        return {
          score: (ups / (pts.length - 1)) * 0.5 + (g ? scale(g.g, 0, 0.12) : 0) * 0.5,
          display: `${ups}/${pts.length - 1} yrs up`,
          expert: `EPS rose in ${ups}/${pts.length - 1} periods${g ? `, CAGR ${signedPct(g.g, 1)}` : ""}.`,
          simple: `Profit per share went up in ${ups} of ${pts.length - 1} years.`,
        };
      },
    },
    // QUALITY
    {
      id: "roe", pillar: "quality", label: "Return on equity",
      rule: "0 pts at 5%, full at 15%",
      run: () => {
        if (!lf || !bal) return skip("No statements");
        const v = roe(lf, bal);
        if (!isNum(v)) return skip("Missing equity");
        return {
          score: scale(v, 0.05, 0.15), display: pct(v),
          expert: `Net income over shareholders' equity: ${pct(v)}.`,
          simple: `For every $100 the owners have in ${name}, it earns about $${fx(v * 100, 0)} a year. Banks above $12 are doing well.`,
        };
      },
    },
    {
      id: "roa", pillar: "quality", label: "Return on assets",
      rule: "0 pts at 0.3%, full at 1.5%",
      run: () => {
        if (!lf || !bal || !isNum(lf.netIncome) || !isNum(bal.totalAssets) || bal.totalAssets <= 0) return skip("Missing assets");
        const v = lf.netIncome / bal.totalAssets;
        return {
          score: scale(v, 0.003, 0.015), display: pct(v, 2),
          expert: `Net income over total assets: ${pct(v, 2)}. Around 1% is solid for a bank.`,
          simple: `For every $100 of loans and other stuff ${name} holds, it earns about $${fx(v * 100, 2)}. For a bank, $1 is good.`,
        };
      },
    },
    marginCheck,
    {
      id: "roe_durability", pillar: "quality", label: "ROE durability",
      rule: "Share of years with ROE ≥ 12%",
      run: () => {
        const vals = m.annual.slice(-10).map((r) => roe(r)).filter(isNum);
        if (vals.length < 4) return skip("Fewer than 4 years of ROE");
        const good = vals.filter((v) => v >= 0.12).length;
        return {
          score: good / vals.length, display: `${good}/${vals.length} yrs ≥12%`,
          expert: `ROE cleared 12% in ${good} of ${vals.length} years.`,
          simple: `${name} earned strong returns in ${good} of the last ${vals.length} years.`,
        };
      },
    },
    // HEALTH
    {
      id: "equity_to_assets", pillar: "health", label: "Equity vs total assets",
      rule: "0 pts at 5%, full at 12%",
      run: () => {
        if (!bal || !isNum(bal.equity) || !isNum(bal.totalAssets) || bal.totalAssets <= 0) return skip("Missing balance sheet");
        const v = bal.equity / bal.totalAssets;
        return {
          score: scale(v, 0.05, 0.12), display: pct(v),
          expert: `Equity is ${pct(v)} of total assets — the loss-absorbing cushion (a rough leverage proxy, not regulatory capital).`,
          simple: `If ${name}'s assets lost ${pct(v, 0)} of their value, the owners' money would be wiped out. A bigger cushion is safer.`,
        };
      },
    },
    {
      id: "share_count", pillar: "health", label: "Share count",
      rule: "0 pts at +4%/yr dilution, full at −3%/yr",
      run: () => {
        const g = cagrOver(series(m.annual, (r) => r.dilutedShares ?? r.sharesOutstanding), 5);
        if (!g) return skip("No share-count history");
        return {
          score: scale(g.g, 0.04, -0.03), display: `${signedPct(g.g, 1)}/yr`,
          expert: `Share count ${signedPct(g.g, 1)}/yr over ${g.span} years.`,
          simple: g.g < 0 ? `${name} is buying back shares, so your slice grows.` : `${name} is issuing shares, so your slice shrinks a little.`,
        };
      },
    },
    {
      id: "payout_ratio", pillar: "health", label: "Dividend payout ratio",
      rule: "0 pts at 100% of earnings, full at 40% or less",
      run: () => {
        const r = m.annual.at(-1);
        if (!r || !isNum(r.netIncome)) return skip("No earnings");
        if (r.netIncome <= 0) return { score: 0, display: "loss", expert: "Paying dividends out of a loss.", simple: `${name} lost money, so any dividend is coming out of savings.` };
        const p = (r.dividendsPaid ?? 0) / r.netIncome;
        return {
          score: scale(p, 1.0, 0.4), display: pct(p, 0),
          expert: `Dividends were ${pct(p, 0)} of net income.`,
          simple: `${name} pays out about $${fx(p * 100, 0)} of every $100 it earns as dividends${p > 0.8 ? ", which leaves little room for a bad year" : ", keeping the rest as a buffer"}.`,
        };
      },
    },
    {
      id: "profitable_years", pillar: "health", label: "Profitable years",
      rule: "Share of the last 10 years with a profit: 0 at 50%, full at 100%",
      run: () => {
        const vals = m.annual.slice(-10).map((r) => r.netIncome).filter(isNum);
        if (vals.length < 4) return skip("Fewer than 4 years");
        const pos = vals.filter((v) => v > 0).length;
        return {
          score: scale(pos / vals.length, 0.5, 1), display: `${pos}/${vals.length} yrs`,
          expert: `Profitable in ${pos} of ${vals.length} years.`,
          simple: `${name} made money in ${pos} of the last ${vals.length} years.`,
        };
      },
    },
  ];
}
