"use client";

import { GLOSSARY } from "@/lib/glossary";
import { Only, useMode } from "@/components/mode";
import { Disclaimer } from "@/components/ui";

const PILLARS = [
  {
    name: "Value", pts: 25,
    simple: "Is the price fair? We compare today's price with what this same company usually costs, how fast it's expected to grow, and how much spare cash it makes for the price.",
    expert: "P/E vs own median over up to 5 available fiscal years · PEG · forward vs trailing EPS · FCF yield.",
  },
  {
    name: "Growth", pts: 25,
    simple: "Is the business getting bigger? Sales growth over the available history, up to 5 and 10 years, and whether profit and cash keep rising year after year.",
    expert: "Revenue CAGR over 3–5 years plus a separate long-run check when sufficient history exists · net income trend · cash-flow trend (frequency of increases + CAGR), TTM included.",
  },
  {
    name: "Quality", pts: 30,
    simple: "Is it a really good business? Does it earn a lot on the money invested, keep its profit margins steady, and turn its profit into real cash — year after year?",
    expert: "ROIC · operating-margin stability (σ and slope) · cash conversion · ROIC durability.",
  },
  {
    name: "Financial Health", pts: 20,
    simple: "Is it safe? Not too much debt, can easily pay interest, doesn't keep printing new shares, and reliably has cash left over.",
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
          Buying a stock means buying a small piece of a company. This app helps with two different questions:{" "}
          <b>&ldquo;Is this a good company to own for years?&rdquo;</b> (the Long-term tab) and{" "}
          <b>&ldquo;Is something interesting happening to this stock today?&rdquo;</b> (the Day-trading tab). They&apos;re very different games.
        </p>
      </Only>

      <section className="panel">
        <h2>The score: 0 to 100</h2>
        <p className="muted small">
          {mode === "expert"
            ? "Four pillars, each check scored on a sliding scale (no pass/fail cliffs). Valuation is compared with the company's own history, not the market. Missing data skips a check and re-weights its pillar. ETFs, funds, REITs and companies with under 4 annual periods aren't scored."
            : "Four questions, each worth a share of the points. Every check gives partial credit — not just pass or fail. If a number is missing, that check is skipped rather than counted as a zero."}
        </p>
        <p className="small muted">
          Four annual periods are enough for a provisional score, marked <b>Limited history</b>. Four consecutive reports provide three years of growth,
          not four. Missing long-term checks stay skipped; we do not invent older data. S&amp;P 500 membership gives no extra points.
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
          <span><b className="band-green">65–79</b> good</span>
          <span><b className="band-amber">50–64</b> middling</span>
          <span><b className="band-red">&lt;50</b> weak</span>
        </div>
      </section>

      <section className="panel">
        <h2>Red flags</h2>
        <p className="small muted">
          {mode === "expert"
            ? "Cap the score at 59 with one flag, 39 with two or more. Main: TTM net loss; negative FCF in 2 of 3 years; shares +4%/yr; interest coverage < 2×. Financials: TTM loss; equity < 5% of assets; dividends > earnings in 2 of 3 years; shares +4%/yr; TBVPS down 3 years straight."
            : "Some problems are so serious that a cheap price can't make up for them — like losing money, burning cash, or constantly creating new shares. One of these holds the score at 59 or below; two or more, at 39."}
        </p>
      </section>

      <section className="panel">
        <h2>Special cases</h2>
        <p className="small">
          <span className="chip f">F</span>{" "}
          {mode === "expert"
            ? "Banks, brokers, insurers, asset managers, card lenders and clearing-house exchanges use a financials scorecard (P/E and P/TBV vs history, shareholder yield, TBVPS growth, ROE, ROA, equity/assets, payout). Visa, Mastercard and PayPal stay on the main card."
            : "Banks and insurers work differently — borrowing is their raw material — so they're judged on what they own versus owe, and on returns on the owners' money."}
        </p>
        <p className="small" style={{ marginBottom: 0 }}>
          <span className="chip capex">CAPEX</span>{" "}
          {mode === "expert"
            ? "When capex > 2× depreciation, cash conversion and the cash-flow trend subtract only maintenance capex (≈ D&A). FCF yield, FCF history and the red flag stay strict; debt-funded build-outs get capped."
            : "Some companies (like the big AI cloud firms) are spending enormous amounts building data centers. Counting all of it against them would make a growing business look like it's shrinking, so we only count the 'keep the lights on' spending in some checks."}
        </p>
      </section>

      <section className="panel">
        <h2>The trend (kept separate)</h2>
        <p className="small muted">
          {mode === "expert"
            ? "States from the 200-DMA: Uptrend (P > 200, 50 > 200, 200 rising) · Recovering (back above after most of 6 months below) · Mixed · Weakening (just below; averages not rolled over) · Downtrend. RS = 12-1 month return minus SPY. Ind = industry ETF 6-month return minus SPY."
            : "The score is about the company. The trend is about the stock price — whether investors have been buying or selling. A great company can still have a falling price. When the two disagree, it's worth asking why."}
        </p>
        <div className="grid two small">
          <div className="setup long"><b>Good score + rising price</b><br />{mode === "expert" ? "How much good news is priced in?" : "Everyone likes it — are you paying too much?"}</div>
          <div className="setup caution"><b>Good score + falling price</b><br />{mode === "expert" ? "Cheap for a reason, or overreaction?" : "A sale — or do others know something?"}</div>
          <div className="setup caution"><b>Weak score + rising price</b><br />{mode === "expert" ? "What does the market see that the numbers don't?" : "Turnaround coming, or just hype?"}</div>
          <div className="setup short"><b>Weak score + falling price</b><br />{mode === "expert" ? "What would have to change?" : "Usually one to avoid."}</div>
        </div>
      </section>

      <section className="panel">
        <h2>Day trading</h2>
        <p className="small">
          {mode === "expert"
            ? "Signals from daily + 5-minute bars: gap, RVOL (time-of-day adjusted), VWAP, RSI(14), ATR(14), 20-EMA stretch, opening range. Setups: Gap & Go, gap fade, gap-down reclaim, ORB, 20-day breakout, oversold bounce, VWAP reclaim, overextended. Stops/targets are mechanical (structure or 1 ATR; 2R target). Data is delayed — screening only."
            : "Day traders look for stocks moving a lot today on lots of trading, then try to catch part of the move with a planned exit. The app spots common patterns and explains each one. It also has a calculator so you never risk more than you decided to."}
        </p>
        <Only mode="beginner">
          <ul className="small muted" style={{ paddingLeft: 18, marginBottom: 0 }}>
            <li>Decide where you&apos;ll get out <i>before</i> you get in.</li>
            <li>Risk a small, fixed slice of your money per trade (many use 1%).</li>
            <li>Practice with pretend money first — most brokers have a paper-trading mode.</li>
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
        Methodology adapted from The Traveling Trader&apos;s &ldquo;How the TTT Score Works&rdquo;. The original doesn&apos;t publish check thresholds, so the sliding
        scales here are this app&apos;s own and shown on each check in Expert mode. Scores won&apos;t match TTT&apos;s published numbers.
      </p>
      <Disclaimer />
    </div>
  );
}
