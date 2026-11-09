# Stock Scout 🚀

Find and understand stocks, two ways:

- **On the Radar / Full ranking**: every S&P 500 + Nasdaq-100 company scored weekly, ranked in the same layout as TTT's weekly post, with ▲▼ changes vs last week.
- **My portfolio / Watchlist / Discover**: your own lists, scored live and ranked the same way.
- **Long-term**: a 0–100 business-quality score modelled on The Traveling Trader's TTT Score (Value 25 · Growth 25 · Quality 30 · Financial Health 20), with red-flag caps, a financials scorecard (**F**), a heavy-investor mode (**CAPEX**), and a separate 200-day trend reading with RS and industry momentum.
- **Day trading**: a scanner for stocks "in play" (gap, relative volume, VWAP, RSI, ATR, stretch) that spots common setups, suggests mechanical stops/targets, and sizes positions from your risk.

Every number is explained twice. Use the **Beginner / Expert** switch in the header to choose which version leads; the other is one tap away. Underlined terms have plain-language tooltips, and `/learn` explains the whole method.

> Educational tool, not investment advice. Data is delayed and may be wrong.

## Run it

Use Node.js 24.x. The same major version is used locally, in GitHub Actions, and on Vercel.

```bash
npm ci
cp .env.example .env.local   # optional: add FMP_API_KEY
npm run dev                  # http://localhost:3000
```

Offline / UI work: `DEMO_MODE=1 npm run dev` serves six fictional companies, each shaped to exercise a different part of the method (clean high scorer, bank, CAPEX hyperscaler, red-flag retailer, recovering chipmaker, cheap-but-slow pharma).

```bash
npm test          # scoring, trend, splits, merging, snapshots, day-trading signals, auth
npm run typecheck
npm run build
```

## Login

The whole app (pages and API) sits behind a login gate (`src/proxy.ts`), so strangers can't use it or burn your Yahoo/FMP access. No database: sessions are signed cookies (30 days), and every request re-checks them against the current env vars.

**GitHub SSO + email allowlist (main way in)**
1. GitHub → Settings → Developer settings → OAuth Apps → New. Homepage `https://<your-domain>`, callback `https://<your-domain>/api/auth/github/callback`.
2. In Vercel → Project → Settings → Environment Variables (Production): `AUTH_SECRET` (`npm run auth -- secret`), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `AUTH_ALLOWED_EMAILS=you@example.com,partner@example.com`.
3. Redeploy: Vercel only applies env changes to new deployments.

Sign-in only asks GitHub for the account's email addresses (`user:email` scope). The callback checks the *verified* ones against `AUTH_ALLOWED_EMAILS` on the server, then discards the GitHub token. Removing an email from the list (and redeploying) logs that person out everywhere.

**Password fallback (optional)** for someone without a GitHub account: `npm run auth -- user anna` prompts for a password and prints an `AUTH_USERS` entry (scrypt hash). The login page shows whichever methods are configured. Leave `AUTH_USERS` empty to make GitHub the only way in.

**Behaviour**
- Production with nothing configured → every request gets 503 (fails closed, never public by accident). Local `npm run dev` stays open.
- Expired or revoked session → API returns 401 and the UI sends you back to the login page.
- Rotate `AUTH_SECRET` to log everyone out.
- API responses are `Cache-Control: private`, so nothing user-only lands in Vercel's shared CDN cache. Server-side caching still avoids repeat Yahoo calls.
- `robots.txt` and meta tags ask search engines not to index the app.

**Extra hardening in the Vercel dashboard (free)**
- Firewall → add one rate-limit rule (Hobby allows one): path starts with `/api/`, 60 requests / 60 s per IP, action Deny. It also covers repeated password guesses against `/api/auth/login`, on top of the app's own 8-failures-per-15-minutes lockout.
- Bot Management → Attack Mode during an actual attack; challenged traffic isn't billed.
- GitHub OAuth callbacks only work on the domain you registered, so preview deployments can't do GitHub sign-in. Use the password fallback there, or keep previews behind Vercel's own Deployment Protection (on by default for previews).

## Deploy to Vercel

1. Push the repo and import it in Vercel (framework auto-detected as Next.js; Node 24.x, pinned in `package.json`).
2. Set the login env vars (see Login above) and, optionally, `FMP_API_KEY`.
3. Deploy.

The `allowScripts` entry in `package.json` approves only the pinned esbuild version's
binary setup script. After upgrading esbuild, review its install script and run
`npm install-scripts approve esbuild --allow-scripts-pin` with a current npm version
to update that approval. Do not blanket-approve dependency install scripts.

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

### Scoring with Yahoo-only history

You can rank stocks with four or more annual reports without an FMP key.
When we have only four reports, stock pages, cards, and ranking tables show a
Limited history badge. These scores are provisional: they are early estimates based
on a shorter record. We do not score funds, ETFs, REITs, or companies with fewer than
four annual reports. Stocks in the S&P 500 follow the same rules.

Value is worth 25 points, growth 25, quality 30, and financial health 20.
One red flag caps the score at 59; two or more cap it at 39. Revenue growth uses
the time between reports, so four consecutive annual reports give a three-year CAGR.
P/E comparisons show how many observations we used. If a check needs more history
than we have, we skip it and share its points across the remaining checks in that
pillar. We do not fill in missing years. A score based on four reports has less
evidence behind it than one based on a longer record.

To refresh all rankings, run Weekly scan on `main` with the symbols input empty.
Then check that Vercel deploys the resulting commit. The website reads the saved
snapshot, so changes to scoring rules need a new scan and deployment before they
appear in the rankings. The scan log lists how many companies were ranked, had
limited history, were excluded, or failed to load.

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
src/app/api/         score/[symbol], short/[symbol], radar, screen, search, meta, auth/{login,logout,github}
src/lib/auth/        session.ts (signed cookies, allowlist), password.ts (scrypt), github.ts (OAuth)
src/proxy.ts         login gate in front of every page and API route
src/app/             / (long-term), /stock/[symbol], /day, /learn
```
