# Stock Scout 🚀

Find and understand stocks, two ways:

- **On the Radar / Full ranking**: every S&P 500 + Nasdaq-100 company scored weekly, ranked in the same layout as TTT's weekly post, with ▲▼ changes vs last week.
- **My portfolio / Watchlist / Discover**: your own lists, scored live and ranked the same way.
- **Long-term**: a 0–100 business-quality score modelled on The Traveling Trader's TTT Score (Value 25 · Growth 25 · Quality 30 · Financial Health 20), with red-flag caps, a financials scorecard (**F**), a heavy-investor mode (**CAPEX**), and a separate 200-day trend reading with RS and industry momentum.
- **Day trading**: a scanner for stocks "in play" (gap, relative volume, VWAP, RSI, ATR, stretch) that spots common setups, suggests mechanical stops/targets, and sizes positions from your risk.

Every number is explained twice. Use the **Beginner / Expert** switch in the header to choose which version leads; the other is one tap away. Underlined terms have plain-language tooltips, and `/learn` explains the whole method.

> Educational tool, not investment advice. Data is delayed and may be wrong.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add FMP_API_KEY
npm run dev                  # http://localhost:3000
```

Offline / UI work: `DEMO_MODE=1 npm run dev` serves six fictional companies, each shaped to exercise a different part of the method (clean high scorer, bank, CAPEX hyperscaler, red-flag retailer, recovering chipmaker, cheap-but-slow pharma).

```bash
npm test          # 50 unit tests: scoring, trend, splits, merging, snapshots, day-trading signals
npm run typecheck
npm run build
```

## Deploy to Vercel

1. Push the repo and import it in Vercel (framework auto-detected as Next.js; Node 22+).
2. Optional env var `FMP_API_KEY`.
3. Deploy. API responses carry `s-maxage` headers, so Vercel's CDN absorbs repeat requests (scores 30 min, day-trading data 60 s).

## Weekly scan (On the Radar)

Scoring ~515 companies takes too long for a page load or a Vercel function, so it runs as a scheduled GitHub Action:

1. `.github/workflows/weekly-scan.yml` runs every Sunday 05:17 UTC (or on demand from the Actions tab, optionally for a few symbols).
2. `npm run universe` refreshes S&P 500 / Nasdaq-100 membership (keeps the old list if a source fails).
3. `npm run scan` scores everything and writes `src/data/snapshots/<date>.json` + `latest.json` (26 weeks kept). Deltas are computed against the previous file, so ▲▼ are real week-over-week changes.
4. The workflow commits the snapshot; the commit triggers a Vercel deploy that serves it via `/api/radar`.

Before the first run, the Radar tabs show how to trigger it. Add `FMP_API_KEY` as a repo secret if you use FMP. A full weekly scan is ~1,500 FMP calls, above the free plan's 250/day, so FMP falls back to Yahoo-only for the rest unless you're on a paid plan.

Locally: `npm run scan -- --limit 30` for a quick test, `npm run scan -- --symbols NVDA,ASML` to rescore a few names inside today's snapshot.

## Calibrating against TTT

`src/data/ttt-reference.ts` holds The Traveling Trader's published scores from 8 Nov 2026 (23 "On the Radar" + 19 portfolio holdings). Stock pages that appear there show TTT's numbers next to ours.

```bash
npm run calibrate                     # all 42; writes calibration-report.md
npm run calibrate -- --symbols NOW,AAPL
```

The report shows the gap for each stock and each pillar, the overall bias and mean absolute error per pillar, and agreement on trend, F and CAPEX. For pillars off by 4+ points it lists every check's partial credit. Those tell you which scales in `src/lib/scoring/checks-*.ts` to move. Running it once with live data and tuning from the report is the obvious next step: this app's thresholds are educated guesses until then.

## Data sources

| Source | Used for | Notes |
|---|---|---|
| **Yahoo Finance** via [`yahoo-finance2`](https://github.com/gadicc/yahoo-finance2) v4 | prices (6.5 y daily, 5-min intraday), quote, analyst estimates, profile, statements (`fundamentalsTimeSeries`), screeners, search | Server-side only, same pattern as `how-is-my-stock-doing`'s netlify-lambda proxy. Unofficial API: shapes can change. Usually ~4–5 fiscal years of statements. |
| **Financial Modeling Prep** (optional) | longer statement history for the 10-year checks; fills gaps | Set `FMP_API_KEY`. Free plans may cap history at 5 years; the adapter retries with `limit=5`. |

Merging: rows are keyed by period-end year; Yahoo wins field-by-field and FMP fills gaps and adds older years. Each row records which source(s) contributed (shown in the financial history table). Stock splits are detected per provider and history restated so a 10-for-1 split doesn't look like 900% dilution.

## How the score maps to the TTT methodology

The TTT deck names each check and the rules (partial credit, own-history valuation, TTM included, re-weighting on missing data, caps at 59/39, F and CAPEX scorecards, five trend states, RS and Ind). **It does not publish thresholds**, so the sliding scales here are this app's own — each check shows its scale in Expert mode, and all of them live in `src/lib/scoring/checks-*.ts`. Scores will not match TTT's published numbers.

Interpretation choices worth knowing:

- **Cash-flow trend** uses free cash flow on the main card, and OCF minus maintenance capex (≈ D&A) in CAPEX mode — so CAPEX mode is the more lenient one, as the deck intends.
- **Cash conversion** = FCF ÷ net income over the latest three periods (maintenance basis in CAPEX mode).
- **"Borrowing to build still gets capped"**: in CAPEX mode, if debt rose >15% while strict FCF is negative, the debt-load check is capped at half credit.
- **Ind** is computed from actual peers, the way TTT's lists suggest (their ASML, NVDA, MU and KLAC all show the same −18%): the weekly scan takes the median 6-month return of all universe stocks in the same Yahoo industry (3+ peers) minus the S&P 500's. Stocks outside the universe, or before the first scan, fall back to an industry ETF (software → IGV, semis → SOXX, …).
- **CAPEX on financials**: shown when spending is over 2× depreciation (TTT marks ERIE as F + CAPEX). The financials scorecard has no cash-flow checks, so on those it's informational.
- **"Change since last week"** comes from the committed weekly snapshots. Stocks outside the universe fall back to what your browser saw last week.

## Layout

```
src/lib/data/        yahoo.ts, yahoo-map.ts, fmp.ts, merge.ts, splits.ts, demo.ts, cache.ts, index.ts (facade)
src/lib/scoring/     engine.ts (pillars, re-weighting, flags, caps), checks-main.ts, checks-financials.ts, metrics.ts, summary.ts
src/lib/trend.ts     200-DMA states, RS, Ind, score × trend quadrants
src/lib/shortterm.ts day-trading indicators, setups, position sizing
src/lib/snapshot.ts  weekly snapshot format, deltas, ranking, industry-peer momentum
src/data/            universe.json, snapshots/, ttt-reference.ts
scripts/             scan.ts, update-universe.ts, calibrate.ts
src/app/api/         score/[symbol], short/[symbol], radar, screen, search, meta
src/app/             / (long-term), /stock/[symbol], /day, /learn
```
