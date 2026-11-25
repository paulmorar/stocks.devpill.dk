# Stock Scout 🚀

Find and understand stocks, two ways:

- **On the Radar / Full ranking**: every S&P 500 + Nasdaq-100 company scored weekly, ranked in the same layout as TTT's weekly post, with ▲▼ changes vs last week. Switch between S&P 500, Nasdaq-100 or both, and filter the full ranking by sector, trend, minimum score and financial history. Sector tiles show how many stocks each sector has ranked, how many score 80+, and the median score. Filters are kept in the URL, so a view can be bookmarked or shared.
- **My portfolio / Watchlist / My lists / Discover**: your own lists, scored live and ranked the same way. Named lists group stocks the way you research them. Lists stay in your browser, or follow your account across devices once a list database is connected (see Saved lists).
- **Long-term**: a 0–100 business-quality score modelled on The Traveling Trader's TTT Score (Value 25 · Growth 25 · Quality 30 · Financial Health 20), with red-flag caps, a financials scorecard (**F**), a heavy-investor mode (**CAPEX**), and a separate 200-day trend reading with RS and industry momentum.
- **Stock pages** link to the company's latest annual and quarterly SEC filings, and say how current each number is: when the price was set, which annual reports were used, when the data was retrieved, and which weekly snapshot ranked the stock. They also list recent headlines about the company and can load an interactive TradingView chart when you ask for it.
- **Day trading**: a scanner for stocks "in play" (gap, relative volume, VWAP, RSI, ATR, stretch) that spots common setups, suggests mechanical stops/targets, and sizes positions from your risk.

Every number is explained twice. Use the **Beginner / Expert** switch in the header to choose which version leads; the other is one tap away. Underlined terms have plain-language tooltips, and `/learn` explains the whole method. Press **⌘K** (Ctrl+K on Windows and Linux) to search from any page. Results can go straight onto your watchlist or portfolio, and recently viewed stocks appear when the search box is empty.

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
npm test          # scoring, currencies, trend, splits, merging, snapshots, ranking filters, SEC filings, data freshness, search, saved lists, news, chart symbols, day-trading signals, auth
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
2. Set the login env vars (see Login above) and, optionally, `FMP_API_KEY`, `SEC_USER_AGENT` (see SEC EDGAR below) and a list database (see Saved lists below).
3. Deploy.

The `allowScripts` entry in `package.json` approves only the pinned esbuild version's
binary setup script. After upgrading esbuild, review its install script and run
`npm install-scripts approve esbuild --allow-scripts-pin` with a current npm version
to update that approval. Do not blanket-approve dependency install scripts.

## Saved lists

The watchlist, the portfolio and named lists (the My lists tab, or the Lists button on a stock page) are kept in your browser by default. To use the same lists on every device you sign in on, connect an Upstash Redis database:

1. In Vercel, open the project's Storage tab, create an **Upstash for Redis** database (the free plan is plenty) and connect it to the project. That adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`. If you already have an Upstash database, or chose a custom prefix while connecting, set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the database's REST API details instead.
2. Redeploy.

While an account has nothing saved yet, the list tabs offer to copy the lists from that browser into it. Copying never removes anything from the browser, and **Delete saved lists** only removes the account copy. **Export** downloads every list as a JSON file that **Import a file** can read on any device or account, which also makes a simple backup.

- Each account is one small document in Redis, stored under a SHA-256 hash of the account (`gh:<email>` for GitHub sign-in, `pw:<username>` for passwords), so a GitHub account and a password user never share lists. Nothing else is stored.
- Every save checks a version number inside a Lua script, so two devices saving at the same moment both keep their changes. If a save still conflicts after 8 tries, the app says the change wasn't saved.
- Limits: 20 named lists, 500 stocks per list, names up to 60 characters.
- With no database, with login off, or in demo mode, lists stay in the browser and the server stores nothing. The database URL must use https (plain http is accepted only for localhost).

## Weekly scan (On the Radar)

Scoring ~515 companies takes too long for a page load or a Vercel function, so it runs as a scheduled GitHub Action:

1. `.github/workflows/weekly-scan.yml` runs every Sunday 05:17 UTC (or on demand from the Actions tab, optionally for a few symbols).
2. `npm run universe` refreshes S&P 500 / Nasdaq-100 membership (keeps the old list if a source fails).
3. `npm run scan` scores everything and writes `src/data/snapshots/<date>.json` + `latest.json` (26 weeks kept). Deltas are computed against the previous file, so ▲▼ are real week-over-week changes.
4. The workflow commits the snapshot; the commit triggers a Vercel deploy that serves it via `/api/radar`.

Before the first run, the Radar tabs show how to trigger it. Add `FMP_API_KEY` as a repo secret if you use FMP. A full weekly scan is ~1,500 FMP calls, above the free plan's 250/day, so FMP falls back to Yahoo-only for the rest unless you're on a paid plan. Add `SEC_USER_AGENT` as a repo secret too: the scan then scores US companies on up to 10 years of SEC EDGAR figures instead of Yahoo's ~4, and the universe update adds CIKs for the Nasdaq-100 companies outside the S&P 500 (see SEC EDGAR below).

Locally: `npm run scan -- --limit 30` for a quick test, `npm run scan -- --symbols NVDA,ASML` to rescore a few names inside today's snapshot.

The scan log ends with how many companies came back without trailing-12-month figures. Nearly every company has them, so a large number means Yahoo or `yahoo-finance2` changed and scores are falling back to annual reports. The next line counts companies without older years from SEC EDGAR: all of them when `SEC_USER_AGENT` isn't set, otherwise the members without a CIK or without US-GAAP figures (foreign filers such as Novo Nordisk report under IFRS), plus companies whose older years were cut (see SEC EDGAR below) and any SEC failures.

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
| **Yahoo Finance** via [`yahoo-finance2`](https://github.com/gadicc/yahoo-finance2) v4 | prices (6.5 y daily, 5-min intraday), quote, analyst estimates, profile, statements (`fundamentalsTimeSeries`), daily exchange rates, screeners, search, news headlines | Server-side only, same pattern as `how-is-my-stock-doing`'s netlify-lambda proxy. Unofficial API: shapes can change. Usually ~4–5 fiscal years of statements. |
| **SEC EDGAR** (optional) | up to 10 years of annual figures for US companies in the S&P 500 and Nasdaq-100 (company facts); links to the latest annual and quarterly filings on stock pages | Free, no key. Set `SEC_USER_AGENT` (see below). |
| **Financial Modeling Prep** (optional) | longer statement history for the 10-year checks; fills gaps | Set `FMP_API_KEY`. Free plans may cap history at 5 years; the adapter retries with `limit=5`. |
| **TradingView** (on request) | interactive chart on stock pages | Never used for scores. Loads only when you click (see below). |

Merging: rows are keyed by period-end year; Yahoo wins field-by-field, SEC EDGAR fills gaps and adds older years, and FMP fills what is left. Each row records which source(s) contributed (shown in the financial history table). Stock splits are detected per provider and history restated so a 10-for-1 split doesn't look like 900% dilution.

The trailing-12-month (TTM) figures come from the same Yahoo endpoint as the annual reports. `yahoo-finance2` 4.0.x rejects the `periodType: "TTM"` that Yahoo now sends, so the app reads statement rows without the library's schema check and checks each value itself. When Yahoo has no TTM figures for a company, its stock page says the score uses annual reports only. Yahoo's TTM row sometimes lacks a single figure that the annual report has, most often interest expense. Checks that need that figure then use the last annual report, and take both sides of a ratio such as interest coverage from that report.

Each stock page has a **How current is this?** panel. The price shows the time the provider set it, never the time you opened the page, so a Friday close still reads as Friday on Monday. Company data, including that price, stays in the server cache for up to 12 hours. A weekly snapshot older than 8 days is flagged, because it means at least one scan was missed.

### Currencies

Reported figures stay in the company's reporting currency, and prices stay in the currency the stock trades in. They can differ: ASML trades in dollars in New York but reports in euros, and HSBA.L trades in pence (GBp) in London but reports in dollars. Yahoo quotes London in pence, Johannesburg in cents (ZAc) and Tel Aviv in agorot (ILA), while its market caps and per-share estimates use the main unit.

Checks that compare the price or market cap with reported figures convert the price into the reporting currency first: P/E against its own history, FCF yield, shareholder yield and price-to-tangible-book. They use Yahoo's daily exchange rates, so a past P/E uses the rate on that fiscal year's end. If Yahoo has no rate, those checks are skipped instead of mixing currencies. The stock page labels the price and market cap with the trading currency and notes when the reports use another one.

Known limit: Yahoo gives US-listed ADRs their EPS per ADR but their share count in ordinary shares, so the price-to-tangible-book history of a foreign bank ADR (for example HSBC or LYG) is off by the ADR ratio. Banks listed on their home exchange are not affected.

### SEC EDGAR

Stock pages link to the company's filings on EDGAR. The weekly universe update stores each company's SEC number (CIK) in `src/data/universe.json`: from SEC's ticker list when `SEC_USER_AGENT` is set, otherwise from the S&P 500 dataset, so the Nasdaq-100 companies outside the S&P 500 only get one with the SEC list. Without a CIK, the links search EDGAR by ticker. Non-US listings get no links.

To show the latest annual report (10-K, 20-F or 40-F) and quarterly report (10-Q) with their filing dates, set `SEC_USER_AGENT` in Vercel and as a GitHub Actions secret. SEC rejects automated requests that don't name a contact, so use the app name and an email address, such as `Stock Scout you@example.com`. Without it, the app sends no requests to the SEC. Amendments (10-K/A, 10-Q/A) are listed separately from the original report. Lookups are cached for 12 hours, spaced out, and paused for 10 minutes after a failure. The links open in your browser either way.

The same setting gives the score up to 10 years of history. For each US company in the S&P 500 and Nasdaq-100, the app downloads SEC's company facts (every figure tagged in its filings: a median of 270 KB compressed, 4 MB unpacked) and keeps annual figures from 10-K reports. Yahoo stays the source for the years it covers. SEC fills its gaps and adds older years back to 10 years before Yahoo's newest report, never a newer year.

Each figure is used only if one of its SEC concepts matches Yahoo within 2% in the oldest year both have, so the two series join without a jump. Revenue, net income, cash flow and equity join for about 90% of the 503 companies. Operating income joins for about 200, because Yahoo's figure often leaves out one-off items. Share counts and EPS are restated across stock splits from the counts each 10-K repeats for earlier years. EPS figures that don't fit net income over diluted shares are left out, and so are share counts and EPS for years that started before the listing: before an IPO, the weighted count leaves out preferred stock that converts at the IPO.

After a spin-off or sale, a 10-K restates the years it shows as continuing operations, while older years stay as first reported. When a later report changed a year's revenue by more than 10%, the years before that report's first year are left out. That cut applies to 79 of the 503 companies, such as GE, 3M, J&J and IBM. ROIC durability counts a year only when its cash and debt are known (debt-free companies excepted). Companies that file under IFRS, such as Novo Nordisk, and companies outside the two indexes keep Yahoo's history. Foreign filers that report under US GAAP, such as ASML, are covered once the universe update has stored their CIK. The weekly scan log counts the companies that got no SEC history.

### News

Stock pages show up to five recent headlines tagged with the company. The portfolio, watchlist and My lists tabs have a **Recent news** section that covers the first 12 stocks in the list and loads only when you open it. It shows up to 8 headlines, and every stock gets one before any stock gets a second, so one busy stock can't fill the section. The app shows the headline, publisher and time and links to the original story. It never copies article text. Headlines are cached for 15 minutes per stock and never affect a score.

### Interactive chart

Stock pages can load TradingView's Advanced Chart, with candles, volume, drawing tools and indicators. The moving average and RSI are on by default, MACD and Bollinger Bands can be added, and the choice is remembered in the browser. Nothing loads from TradingView until you click **Load the TradingView chart**. Loading it sends the page address, the ticker and your IP address to TradingView, and nothing about your account or lists.

TradingView only allows embedded charts for US listings and for Copenhagen, Stockholm, Helsinki, Oslo, Xetra, Euronext Amsterdam and Paris, SIX Swiss, Toronto and ASX. Other stocks get a link to the chart on TradingView instead. The chart uses TradingView's own prices, which can differ from the data behind the score. It uses TradingView's documented iframe embed, which TradingView may eventually retire in favour of its newer web component.

### Scoring with Yahoo-only history

You can rank stocks with four or more annual reports without `SEC_USER_AGENT` or an FMP key.
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
src/lib/data/        yahoo.ts, yahoo-map.ts, fmp.ts, merge.ts, splits.ts, demo.ts, cache.ts, sec.ts + sec-map.ts + sec-facts.ts (EDGAR), news.ts + news-map.ts (headlines), index.ts (facade)
src/lib/lists/       model.ts (list rules shared by browser and server), store.ts (Upstash REST, compare-and-set), service.ts (load, save with retries)
src/lib/scoring/     engine.ts (pillars, re-weighting, flags, caps), checks-main.ts, checks-financials.ts, metrics.ts, summary.ts
src/lib/trend.ts     200-DMA states, RS, Ind, score × trend quadrants
src/lib/shortterm.ts day-trading indicators, setups, position sizing
src/lib/snapshot.ts  weekly snapshot format, deltas, ranking, industry-peer momentum
src/lib/explore.ts   ranking filters, sector overview, filters in the URL
src/lib/freshness.ts how old quotes, retrieved data and snapshots are
src/lib/search.ts    header search: shortcut, recent symbols, stale-response guard
src/lib/tradingview.ts  TradingView symbols, indicators and widget settings
src/components/      lists.tsx (list state, Lists menu, My lists, sync), news.tsx, tv-chart.tsx, header.tsx, …
src/data/            universe.json (members, index, CIK), snapshots/, ttt-reference.ts
scripts/             scan.ts, update-universe.ts, calibrate.ts
src/app/api/         score/[symbol], short/[symbol], filings/[symbol], radar, screen, search, meta, lists, news, auth/{login,logout,github}
src/lib/auth/        session.ts (signed cookies, allowlist), password.ts (scrypt), github.ts (OAuth)
src/proxy.ts         login gate in front of every page and API route
src/app/             / (long-term), /stock/[symbol], /day, /learn
```
