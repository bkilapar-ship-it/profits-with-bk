# Trade With BK — MACD Curl-Up Screener

A static stock screener for GitHub Pages. It finds stocks where the **MACD line is still below its Signal line but curling upward**, with the gap between them narrowing. This is often visible a few candles before a conventional bullish MACD crossover.

> **Important:** This is a technical-analysis screening tool, **not financial advice** and **not a trading system**. It only reports whether current indicator values match the criteria you choose. "Setup Strength" is **not** a probability and does **not** predict future prices.

The site has six tabs: **All US**, **Watchlist**, **S&P 500**, **Nasdaq-100**, **Dow 30** and **Sectors & themes**. Every tab except Watchlist reads the results of the scheduled market scan, filtered to that list. Tapping a stock shows its company name, sector, index memberships and themes, along with the signal details, chart and backtest.

There are two ways to scan:

| | **All US, index and sector tabs** | **Watchlist tab** |
|---|---|---|
| What | Every listed US stock that passes a price/volume filter | Tickers you type in |
| Where the work happens | A scheduled GitHub Action (runs on GitHub's servers) | Your browser |
| Speed | Results load in about a second | About 8 tickers/minute on Twelve Data's free plan |
| Data | Alpaca (free account) | Twelve Data by default (replaceable) |
| API key | Stored in GitHub's encrypted secrets, never in the browser | Stored in your browser's localStorage |
| Freshness | Updated hourly during market hours, plus once after the close | Live when you press Scan |
| MACD / RSI periods | Fixed in the workflow file (default 12/26/9, RSI 14) | Adjustable on the page |

Both use exactly the same maths. The scheduled scan loads `app.js` to compute its indicators.

```
/
├── index.html                    UI markup
├── style.css                     Layout, light/dark theme, mobile cards
├── app.js                        Indicators, analysis, UI (also used by the scanner)
├── scanner/scan.js               Scheduled market scan, backtest, index/sector/theme lists (Node, no dependencies)
├── themes.json                   (optional) your own theme lists; see section 4
├── .github/workflows/scan.yml    Runs the scan on a schedule and deploys the site
├── .gitignore
└── README.md
```

No framework, npm install, backend server, database or login is needed.

---

## 1. Setup (about 10 minutes)

### Step 1: Get free Alpaca API keys

1. Sign up at [alpaca.markets](https://alpaca.markets). A free **paper trading** account is enough.
2. In the dashboard, make sure you're in **Paper Trading**, then generate API keys. Copy the **Key ID** and **Secret Key**.

Use paper-trading keys. They can read market data but can't touch real money. Alpaca keys also control the trading account, which is another reason they should never be put in a browser.

### Step 2: Create the repository

Create a GitHub repository and add all the files above, keeping the folder structure (including `.github/workflows/scan.yml`). The repository must be **public** for free GitHub Pages. Pages on private repositories needs a paid GitHub plan.

### Step 3: Add the keys as secrets

Go to **Settings → Secrets and variables → Actions → New repository secret** and add two secrets:

- `ALPACA_KEY_ID` = your Key ID
- `ALPACA_SECRET_KEY` = your Secret Key

### Step 4: Switch Pages to GitHub Actions

Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Do not choose "Deploy from a branch". The workflow publishes the site together with the scan results.

### Step 5: Run the first scan

Go to **Actions → Market scan and deploy → Run workflow**. The first run takes a few minutes. When it finishes, the site is live at `https://<username>.github.io/<repository>/`.

After that it runs automatically:

- every hour at about :05 past the hour, 14:05–21:05 UTC on weekdays (covers US market hours in summer and winter)
- once more at 22:45 UTC, after the close, to capture the final daily candle
- whenever you push to `main`

## 2. How the scheduled scan works

1. **Universe.** It lists all active, tradable US equities on NYSE, NASDAQ, NYSE American, NYSE Arca and Cboe BZX (OTC is excluded). Plain tickers and class shares like `BRK.B` are kept. Warrants and similar symbols with suffixes are dropped.
2. **Daily candles.** It downloads about 315 daily candles for every symbol. Alpaca's multi-symbol endpoint returns many symbols per request (100 symbols per batch).
3. **Filters.** It keeps stocks whose last close is at least `MIN_PRICE` (default $2) and whose 20-day average volume is at least `MIN_AVG_VOLUME` (default 500,000). This usually leaves a few thousand stocks.
4. **1H / 4H candles.** For the `INTRADAY_MAX_SYMBOLS` most-traded stocks (default 1,000, ranked by 20-day average dollar volume), it downloads 30-minute bars. It builds **regular-session** candles from them, anchored at 9:30 ET like most charting platforms:
   - 1H: 9:30, 10:30 … 15:30 (the last one is 30 minutes)
   - 4H: 9:30–13:30 and 13:30–16:00

   Pre-market and after-hours trades are excluded.
5. **Completed candles only.** A daily candle is used only after 16:00 ET. An intraday candle is used only once it has closed. Results therefore don't flicker while a candle is still forming.
6. **Indicators.** MACD, Signal, histogram, Wilder RSI and relative volume are calculated with the functions in `app.js`. The results are written to `data/1D.json`, `data/4H.json` and `data/1H.json`.
7. **Charts.** Price/MACD/RSI chart data is published only for stocks already in the setup's core shape (MACD below Signal, rising, gap closing). That keeps the files small. For any other stock, the detail panel offers **Add to my watchlist** to load its chart live.
8. **Index lists, sectors and themes.** The scan also downloads S&P 500, Nasdaq-100 and Dow 30 members and GICS sectors, and publishes them with company names in `data/universe.json` (see section 4).
9. **Backtest.** The same signal rules are replayed on every stock's history (see section 3). The market-wide summary goes into the result files, and each stock's past signals go into `data/bt-1D.json` etc.
10. **If a scan fails** (bad keys, Alpaca outage), the site is still deployed. It keeps the previously published results and shows a warning that they are from an earlier scan.

A full run makes several hundred Alpaca requests. The 1H/4H part is the slowest, and a first run can take 15+ minutes. The scanner stops downloading after `SCAN_TIME_BUDGET_MIN` (default 24 minutes), so the site still deploys before GitHub's 30-minute job limit. Timeframes that didn't finish keep their previous results. It uses Alpaca's free-plan limit of 200 requests/minute. The scanner paces itself at 180/minute and backs off automatically if it gets rate-limited.

In the browser, **RSI range, Bars To Cross range, volume filter and minimum relative volume** can still be changed instantly. The page re-scores every stock from the published values without downloading anything.

## 3. Backtest

The backtest answers one question: when these signals appeared in the past, what happened next?

**How it works**
- The screener's exact rules are replayed on each candle of the downloaded history (about 300 candles). EMA, RSI and SMA only use earlier candles, so each signal is exactly what the screener would have shown at that time. There is no look-ahead.
- **Entry:** the next candle's open, since you can only act after a candle closes.
- **Return:** close 5, 10 and 20 candles later ÷ entry − 1.
- **Crossed:** whether MACD closed above Signal within 10 candles, which tests the Bars To Cross idea directly.
- **Worst dip:** the lowest low within 10 candles, relative to entry. Useful when thinking about stop distance.
- **Repeats:** a signal counts only when it newly appears, and not within 5 candles of the previous signal of the same type.
- **All candles (baseline):** the same forward returns measured from every candle. A signal only adds something if it beats this column. In a rising market most things go up.

**Where to find it**
- **Summary panel** above the results. On the market tabs it always covers every stock in the scan, not just the current tab. On the Watchlist tab it covers your scanned tickers.
- **Past signals** section in each stock's detail view, with a list of dates and outcomes. Past signals are also marked on the chart with ▲.

**Which settings it uses**
- *Market tabs (All US, indexes, sectors):* the thresholds set in the workflow (`RSI_MIN`, `RSI_MAX`, `MIN_BARS_TO_CROSS`, `MAX_BARS_TO_CROSS`, `VOLUME_FILTER`, `MIN_REL_VOL`; defaults match the page). Changing settings on the page doesn't change these results, and the page tells you when your settings differ.
- *Watchlist tab:* your current settings, recalculated instantly when you change them.

**Limitations**
- *Survivorship bias:* the market scan only includes stocks that are listed and liquid today. Stocks that collapsed or were delisted are missing, which makes results look better than reality.
- *One period:* about a year of daily history, or a few months of intraday history. One market regime may not repeat.
- *No costs:* commissions, slippage, spreads and taxes are ignored.
- *Not independent:* many signals fire on the same days, so 1,000 signals aren't 1,000 independent tests.
- *Small samples:* a single stock's handful of signals says very little.

For longer history, raise `DAILY_LOOKBACK_DAYS` (e.g. `760`) and `KEEP_CANDLES` (e.g. `500`) in the workflow. That adds download time.

Past results do not predict future results.

## 4. Indexes, sectors and themes

**Where the lists come from**

| List | Source | If it can't be downloaded |
|---|---|---|
| S&P 500 members and GICS sectors | [datasets/s-and-p-500-companies](https://github.com/datasets/s-and-p-500-companies) on GitHub, then Wikipedia | Keeps the previously published list |
| Nasdaq-100 members and GICS sectors | Wikipedia (“Nasdaq-100”) | Keeps the previously published list |
| Dow 30 members | Wikipedia (“Dow Jones Industrial Average”) | Previous list, then a built-in snapshot |
| Company names | Alpaca's asset list (e.g. “Apple Inc.”) | Index list names |
| Themes | `THEMES` in `scanner/scan.js`, or your `themes.json` | Built-in themes |

Index and theme members are always scanned, even when they miss the price/volume filter. They're also added to the 1H/4H scan, so these tabs stay complete. Set `INTRADAY_INCLUDE_GROUPS: 'false'` to turn that off for intraday if scans get too slow.

**The Sectors & themes tab** shows one tile per group:
- the number of stocks, and the share whose MACD is rising
- a bar showing how many are Early Curls and how many are Approaching
- the top setups in the group
- the signal of the group's ETF (e.g. SMH for semiconductors, XLE for energy)

Tiles are sorted by the share of stocks with a signal. When many stocks in one group curl up together, the whole group may be turning, which is often more telling than a single stock. Tap a tile to see its stocks.

- **Sectors** are the 11 official GICS sectors. They only cover S&P 500 and Nasdaq-100 members, because those are the lists that come with free sector data.
- **Themes** are hand-picked lists for areas GICS doesn't capture, such as quantum computing, AI, nuclear, crypto miners and space. They're starting points from mid-2026. Review them, since companies come and go.

**Editing themes.** Create `themes.json` in the repository root (next to `index.html`). Once it exists, it replaces the built-in list:

```json
[
  { "key": "quantum", "label": "Quantum computing", "etf": "QTUM",
    "tickers": ["IONQ", "RGTI", "QBTS", "QUBT", "IBM"] },
  { "key": "robotics", "label": "Robotics", "etf": "BOTZ",
    "tickers": ["ISRG", "TER", "ROK", "SYM"] }
]
```

`key` must be unique, and `etf` is optional. Tickers that aren't listed or have no data are skipped. Changes appear after the next scheduled scan.

## 5. Mathematical formulas

**EMA** (implemented by hand, seeded with the SMA of the first `period` values):

```
k = 2 / (period + 1)
EMA_today = Price_today * k + EMA_yesterday * (1 − k)
```

**MACD**

```
MACD      = EMA(12) − EMA(26)
Signal    = EMA(9) of MACD
Histogram = MACD − Signal
```

**RSI(14), Wilder's method**

```
First average gain/loss = simple mean of the first 14 gains/losses
AvgGain_t = (AvgGain_{t−1} * 13 + Gain_t) / 14
AvgLoss_t = (AvgLoss_{t−1} * 13 + Loss_t) / 14
RSI = 100 − 100 / (1 + AvgGain / AvgLoss)      (RSI = 100 if AvgLoss = 0)
```

**Curl detection** (t = latest completed candle, Gap = MACD − Signal = Histogram):

| # | Condition | Formula |
|---|---|---|
| 1 | MACD below Signal | `Gap[t] < 0` |
| 2 | MACD rising | `MACD[t] > MACD[t−1]` |
| 3 | MACD accelerating (preferred) | `(MACD[t]−MACD[t−1]) > (MACD[t−1]−MACD[t−2])` |
| 4 | Gap shrinking | `Gap[t] > Gap[t−1]` |
| 5 | Gap velocity | `GapVelocity = Gap[t] − Gap[t−1]` |
| 6 | Bars to cross | `BarsToCross = −Gap[t] / GapVelocity` (only when Gap < 0 and GapVelocity > 0, otherwise "—") |
| 7 | In range | `MinBarsToCross ≤ BarsToCross ≤ MaxBarsToCross` (default 1–5) |

BarsToCross is a straight-line extrapolation: "if the gap keeps closing at the current speed, how many candles until it reaches zero?" It changes with every new candle.

**RSI filter:** `RSI_min ≤ RSI[t] ≤ RSI_max` and `RSI[t] > RSI[t−1]` (default 35–55).

**Volume filter (optional):** `Volume[t] > VolumeSMA20[t]` and `RelativeVolume ≥ MinRelVol`, where `RelativeVolume = Volume[t] / VolumeSMA20[t]`.

**Normalized gap:** `((MACD − Signal) / Close) × 100`. This makes the gap comparable between a $3 and a $300 stock.

**Signal Status**

- 🟢 **Early Bullish Curl**: conditions 1, 2 and 4 hold, BarsToCross is in range, the RSI filter passes, and the volume filter passes if it is enabled.
- 🟡 **Approaching Crossover**: conditions 1, 2 and 4 hold, but BarsToCross or a filter is outside your settings.
- ⚪ **No Signal**: anything else, including MACD already at or above Signal.

**Setup Strength (0–100)** measures how closely current conditions match your criteria. Points are only awarded when MACD is below Signal.

| Condition | Points |
|---|---|
| MACD rising | 20 |
| MACD acceleration positive | 20 |
| Gap shrinking | 20 |
| BarsToCross within range | 20 |
| RSI in range and rising | 10 |
| Volume confirmation (only if filter enabled) | 10 |

When the volume filter is off, the maximum is 90 and the score is rescaled to 0–100. It is labeled "without volume confirmation".

## 6. Configuring the scheduled scan

Edit the `env:` block of the **Run market scan** step in `.github/workflows/scan.yml`:

| Setting | Default | Meaning |
|---|---|---|
| `MIN_PRICE` | `2` | Minimum last close, in dollars |
| `MIN_AVG_VOLUME` | `500000` | Minimum 20-day average daily volume (shares) |
| `INTRADAY_MAX_SYMBOLS` | `1000` | How many of the most-traded stocks get 1H/4H scans (`0` turns intraday off) |
| `TIMEFRAMES` | `1D,4H,1H` | Which result files to produce |
| `MACD_FAST` / `MACD_SLOW` / `MACD_SIGNAL` / `RSI_LENGTH` | `12` / `26` / `9` / `14` | Indicator periods used for the market tabs |
| `ALPACA_FEED` | `sip` | `sip` = all US exchanges (15-minute delay on the free plan). Use `iex` if your account can't read SIP data |
| `INCLUDE_CHART_SERIES` | `true` | Set to `false` to publish only indicator values, not chart data |
| `EXCHANGES` | `NYSE,NASDAQ,AMEX,ARCA,NYSEARCA,BATS` | Remove `ARCA,NYSEARCA,BATS` to exclude most ETFs |
| `RSI_MIN` / `RSI_MAX` / `MIN_BARS_TO_CROSS` / `MAX_BARS_TO_CROSS` | `35` / `55` / `1` / `5` | Thresholds for the published backtest |
| `VOLUME_FILTER` / `MIN_REL_VOL` | `false` / `1` | Volume rule for the published backtest |
| `SCAN_TIME_BUDGET_MIN` | `24` | Stop downloading after this many minutes so the site still deploys. Keep it about 5 below `timeout-minutes` |
| `BATCH_SIZE` / `CONCURRENCY` | `100` / `4` | Symbols per request / parallel downloads. `25` / `8` can be faster for 1H/4H |
| `INTRADAY_INCLUDE_GROUPS` | `true` | Also scan index and theme members on 1H/4H, not just the most-traded stocks |
| `DAILY_LOOKBACK_DAYS` / `KEEP_CANDLES` | `460` / `300` | How much daily history to download and keep (more = longer backtest, slower scan) |

None of these need to be in the workflow file. Add a line only for settings you want to change.

To change the schedule, edit the `cron:` lines. Cron times are in UTC.

## 7. The Watchlist tab and its data provider

The Watchlist tab works as before. It downloads candles in the browser through `fetchHistoricalData()`, which calls the active entry in `PROVIDERS` in `app.js`. The default is **Twelve Data**, which allows browser (CORS) requests and supports 1day/4h/1h intervals.

1. Create a free Twelve Data account and copy the API key.
2. On the site, open **Filters** (top right), paste the key under **Live data for your watchlist**, and press **Save**. The Watchlist tab also has an **Add free key** button when no key is saved.
3. Without a key, the public `demo` key is used. It only works for a handful of symbols such as AAPL.

The key is kept only in that browser's `localStorage` and sent only to the provider. Anyone with access to that browser can read it. Use a free or low-privilege key, and use **Remove key from this browser** on shared machines.

To add another provider, add an object with the same shape to `PROVIDERS`:

```js
PROVIDERS.myprovider = {
  label: 'My Provider',
  intervals: { '1D': 'day', '4H': '4hour', '1H': 'hour' },
  keyHelp: 'Get a key at example.com',
  async fetch(ticker, timeframe, apiKey, outputSize) {
    const res = await fetch(`https://api.example.com/candles?symbol=${encodeURIComponent(ticker)}` +
                            `&interval=${this.intervals[timeframe]}&limit=${outputSize}&key=${apiKey}`);
    if (!res.ok) throw new ScreenerError(`HTTP ${res.status}`, 'api');
    const json = await res.json();
    // Must return OLDEST FIRST: [{ t, o, h, l, c, v }, ...]
    return json.candles.map(k => ({ t: k.time, o: +k.open, h: +k.high, l: +k.low, c: +k.close, v: +k.volume }));
  },
};
```

The provider must allow browser (CORS) requests.

## 8. Running locally

Serve the folder over HTTP. Opening `index.html` directly from disk blocks loading the result files.

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

Without result files, the market tabs show "No scan results have been published yet", and the **Watchlist** tab works normally. To generate real result files locally (Node 22 or newer):

```bash
ALPACA_KEY_ID=your_key ALPACA_SECRET_KEY=your_secret node scanner/scan.js --out data
```

The `data/` folder is in `.gitignore`. The published results are built by the workflow, not committed.

## 9. Limitations

- **Delay and freshness.** On Alpaca's free plan, SIP data from the most recent 15 minutes isn't available, so the scan reads data up to 16 minutes old. It then uses only completed candles. GitHub also doesn't guarantee exact cron timing, and scheduled runs can start several minutes late or occasionally be skipped at busy times.
- **Scheduled runs pause after inactivity.** In public repositories, GitHub disables scheduled workflows after 60 days with no repository activity. GitHub emails you. Re-enable it in the Actions tab, or push any commit.
- **Intraday coverage** is limited to the most-traded `INTRADAY_MAX_SYMBOLS` stocks. The daily scan covers everything that passes the filters.
- **Values can differ slightly from charting platforms.** Causes include EMA seeding, history length, split adjustment (dividends are not adjusted), and how sessions are defined.
- **Actions minutes.** Public repositories get free GitHub Actions minutes. About 9 runs per weekday at 3–5 minutes each fits comfortably.
- **Data terms.** The site publishes indicator values and, by default, chart data derived from Alpaca's feed. Check Alpaca's market-data terms before making the site public. Set `INCLUDE_CHART_SERIES: 'false'` to publish less.
- **Watchlist mode limits.** Twelve Data's free plan allows a small number of requests per minute and per day. Check their pricing page. The page paces requests with the **Requests / minute** setting and caches candles (60 min for 1D, 15 min for 4H, 5 min for 1H).

## 10. Disclaimer

This software is provided for educational and research purposes only. It identifies technical indicator conditions and **does not** provide investment, financial, or trading advice. A detected "Early Bullish Curl" does not mean a price will rise, and MACD crossovers frequently fail. Setup Strength is a checklist-match score, not a probability. You are solely responsible for any decisions you make. Past indicator behavior does not guarantee future results.
