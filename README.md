# Stock Scout 🚀

Find and understand stocks, two ways:

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
npm test          # 43 unit tests: scoring, trend, splits, merging, day-trading signals
npm run typecheck
npm run build
```

## Deploy to Vercel

1. Push the repo and import it in Vercel (framework auto-detected as Next.js; Node 22+).
2. Optional env var `FMP_API_KEY`.
3. Deploy. API responses carry `s-maxage` headers, so Vercel's CDN absorbs repeat requests (scores 30 min, day-trading data 60 s).

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
- **Ind** uses an industry ETF as the peer group (software → IGV, semis → SOXX, regional banks → KRE, …, falling back to the sector SPDR). The deck uses actual industry peers.
- **"Change since last week"** is tracked in your browser (localStorage), not server-side.
- **Universe**: your watchlist plus Yahoo's predefined screens, scored on demand — not a weekly batch over all S&P 500 / Nasdaq 100 names. A Vercel Cron job writing to a KV store would be the next step for that.

## Layout

```
src/lib/data/        yahoo.ts, yahoo-map.ts, fmp.ts, merge.ts, splits.ts, demo.ts, cache.ts, index.ts (facade)
src/lib/scoring/     engine.ts (pillars, re-weighting, flags, caps), checks-main.ts, checks-financials.ts, metrics.ts, summary.ts
src/lib/trend.ts     200-DMA states, RS, Ind, score × trend quadrants
src/lib/shortterm.ts day-trading indicators, setups, position sizing
src/app/api/         score/[symbol], short/[symbol], screen, search, meta
src/app/             / (long-term), /stock/[symbol], /day, /learn
```
