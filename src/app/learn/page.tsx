"use client";

import { GLOSSARY } from "@/lib/glossary";
import { Only, useMode } from "@/components/mode";
import { Disclaimer } from "@/components/ui";

const PILLARS = [
  {
    name: "Value", pts: 25,
    simple: "Is the price fair? We compare it with the company's past valuations. We also look at expected growth and how much cash the business generates for the price you pay.",
    expert: "P/E vs own median over up to 5 available fiscal years · PEG · forward vs trailing EPS · FCF yield.",
  },
  {
    name: "Growth", pts: 25,
    simple: "Is the business growing? We look at sales growth over the history we have, up to 5 and 10 years. We also check whether profit and cash flow have risen consistently.",
    expert: "Revenue CAGR over 3 to 5 years, plus a separate long-run check when enough history exists. Net income and cash-flow trends combine the frequency of increases with CAGR and include TTM data.",
  },
  {
    name: "Quality", pts: 30,
    simple: "Does the business earn strong returns on the money invested? We check how steady its profit margins are and how much of its reported profit turns into cash.",
    expert: "ROIC · operating-margin stability (σ and slope) · cash conversion · ROIC durability.",
  },
  {
    name: "Financial Health", pts: 20,
    simple: "Can the company meet its financial commitments? We check debt, interest payments, new share issues, and whether the business regularly has cash left over.",
    expert: "Debt/equity (or net debt/EBITDA when buybacks shrink equity) · share-count CAGR · interest coverage · years of positive FCF.",
  },
];

export default function Learn() {
  const { mode } = useMode();
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <h1>{mode === "expert" ? "Methodology" : "How this works, in plain English"}</h1>
      <Only mode="beginner">
        <p className="muted">
          Buying a stock means owning a small part of a company. The Long-term tab helps you research the business.
          The Day-trading tab looks for unusual price and trading activity today. A company can suit one approach without suiting the other.
        </p>
      </Only>

      <section className="panel">
        <h2>The score: 0 to 100</h2>
        <p className="muted small">
          {mode === "expert"
            ? "The score has four pillars. Checks award partial credit on a sliding scale, and valuation uses the company's own history rather than a market benchmark. If data is missing, we skip the check and share its points across the remaining checks in that pillar. We exclude ETFs, funds, REITs, and companies with fewer than four annual reports."
            : "The score covers four areas, each worth a share of the points. A check can earn some points without earning all of them. When data is missing, we skip that check rather than give it zero. Its points go to the remaining checks in the same area."}
        </p>
        <p className="small muted">
          With only four annual reports, we mark the score <b>Limited history</b>. Treat it as an early estimate.
          Four consecutive reports let us measure three years of growth. We skip checks that need older data instead of filling in missing years.
          Stocks in the S&amp;P 500 receive no extra points.
        </p>
        {PILLARS.map((p) => (
          <div key={p.name} className="check">
            <div className="head">
              <b>{p.name}</b>
              <span className="pts">{p.pts} pts</span>
            </div>
            <p className="small" style={{ marginBottom: 0 }}>{mode === "expert" ? p.expert : p.simple}</p>
          </div>
        ))}
        <div className="row small" style={{ marginTop: 10, gap: 14 }}>
          <span><b className="band-lime">80+</b> excellent</span>
          <span><b className="band-green">65 to 79</b> good</span>
          <span><b className="band-amber">50 to 64</b> middling</span>
          <span><b className="band-red">&lt;50</b> weak</span>
        </div>
      </section>

      <section className="panel">
        <h2>Red flags</h2>
        <p className="small muted">
          {mode === "expert"
            ? "One red flag caps the score at 59; two or more cap it at 39. The main scorecard flags a TTM net loss, negative FCF in 2 of 3 years, share-count growth above 4% a year, or interest coverage below 2×. The financials scorecard flags a TTM loss, equity below 5% of assets, dividends above earnings in 2 of 3 years, share-count growth above 4% a year, or three consecutive declines in TBVPS."
            : "Losses, cash burn, and repeated share issues can limit a score even when the stock looks cheap. One red flag holds the score at 59 or below. Two or more hold it at 39."}
        </p>
      </section>

      <section className="panel">
        <h2>Special cases</h2>
        <p className="small">
          <span className="chip f">F</span>{" "}
          {mode === "expert"
            ? "Banks, brokers, insurers, asset managers, card lenders and clearing-house exchanges use a financials scorecard (P/E and P/TBV vs history, shareholder yield, TBVPS growth, ROE, ROA, equity/assets, payout). Visa, Mastercard and PayPal stay on the main card."
            : "Borrowing is part of how banks and insurers do business. We use a separate scorecard that compares what they own with what they owe and measures returns on shareholders' money."}
        </p>
        <p className="small" style={{ marginBottom: 0 }}>
          <span className="chip capex">CAPEX</span>{" "}
          {mode === "expert"
            ? "When capex exceeds 2× depreciation, cash conversion and cash-flow trends subtract only estimated maintenance capex (approximately D&A). FCF yield, FCF history, and red flags still use all capex. Debt-funded expansion can still limit the score."
            : "A company building new data centers may spend much more than it needs to keep its existing business running. In some checks, we count only estimated maintenance spending. Other checks still count all spending, so borrowing to expand can still limit the score."}
        </p>
      </section>

      <section className="panel">
        <h2>The trend (kept separate)</h2>
        <p className="small muted">
          {mode === "expert"
            ? "Trend uses the 200-DMA. Uptrend means price and the 50-DMA are above a rising 200-DMA. Recovering means price has moved back above it after spending most of six months below. Weakening means price has slipped below before the averages turn down. The other states are Mixed and Downtrend. RS compares the 12-1 month return with SPY. Ind compares industry peers with SPY over six months, with an industry ETF fallback."
            : "The score describes the business. The trend describes its share price. A company can score well while its price falls. Read both before drawing a conclusion."}
        </p>
        <div className="grid two small">
          <div className="setup long"><b>Good score + rising price</b><br />{mode === "expert" ? "How much good news is priced in?" : "Does the higher price already reflect the good news?"}</div>
          <div className="setup caution"><b>Good score + falling price</b><br />{mode === "expert" ? "Cheap for a reason, or overreaction?" : "Is the stock cheaper, or is there a problem the score misses?"}</div>
          <div className="setup caution"><b>Weak score + rising price</b><br />{mode === "expert" ? "What does the market see that the numbers don't?" : "Turnaround coming, or just hype?"}</div>
          <div className="setup short"><b>Weak score + falling price</b><br />{mode === "expert" ? "What would have to change?" : "Usually one to avoid."}</div>
        </div>
      </section>

      <section className="panel">
        <h2>Day trading</h2>
        <p className="small">
          {mode === "expert"
            ? "Signals use daily and 5-minute bars: gap, time-adjusted RVOL, VWAP, RSI(14), ATR(14), distance from the 20-EMA, and the opening range. Setups include Gap & Go, gap fade, gap-down reclaim, ORB, 20-day breakout, oversold bounce, VWAP reclaim, and overextended. Stops use price structure or 1 ATR, with a 2R target. Data is delayed; use it for screening."
            : "Day traders look for price moves backed by heavy trading and plan where to exit. The app explains common patterns and estimates position size from your chosen risk budget. It cannot guarantee the amount you will lose on a trade."}
        </p>
        <Only mode="beginner">
          <ul className="small muted" style={{ paddingLeft: 18, marginBottom: 0 }}>
            <li>Decide where you&apos;ll get out <i>before</i> you get in.</li>
            <li>Risk a small, fixed slice of your money per trade (many use 1%).</li>
            <li>Practice with pretend money first. Most brokers have a paper-trading mode.</li>
            <li>A great long-term company can be a terrible day trade, and the other way round.</li>
          </ul>
        </Only>
      </section>

      <section className="panel">
        <h2>Glossary</h2>
        {Object.entries(GLOSSARY).map(([k, g]) => (
          <div key={k} className="check">
            <b>{g.term}</b>
            <p className="small" style={{ marginBottom: 0 }}>{mode === "expert" ? g.expert : g.simple}</p>
          </div>
        ))}
      </section>

      <p className="tiny faint">
        This methodology is adapted from The Traveling Trader&apos;s &quot;How the TTT Score Works&quot;. The original does not publish check thresholds.
        We set our own scales and show them on each check in Expert mode, so our scores will not match TTT&apos;s published numbers.
      </p>
      <Disclaimer />
    </div>
  );
}
