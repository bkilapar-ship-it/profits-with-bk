#!/usr/bin/env node
/*
 * Trade With BK — MACD Curl-Up Screener — scheduled market scan
 *
 * Runs in GitHub Actions (Node 22+, built-in fetch, no npm dependencies).
 * 1. Lists all active, tradable US stocks & ETFs from Alpaca.
 * 2. Downloads ~300 daily candles for all of them (many symbols per request).
 * 3. Keeps stocks that pass the price / volume filters.
 * 4. For the most-traded subset, downloads 30-minute candles and builds
 *    regular-session 1H and 4H candles (anchored at 9:30 ET, like most charts).
 * 5. Computes MACD / Signal / RSI / relative volume with the SAME code as the
 *    website (../app.js) and writes data/1D.json, data/4H.json, data/1H.json.
 * 6. Backtests the Early Bullish Curl / Approaching rules on each stock's history
 *    and writes the market-wide summary (inside the files above) plus the
 *    per-stock signal lists (data/bt-1D.json, data/bt-4H.json, data/bt-1H.json).
 * 7. Writes data/universe.json: company names, S&P 500 / Nasdaq-100 / Dow 30
 *    members, GICS sectors and themes (see THEMES below or themes.json).
 * 8. Writes data/setups.json: today's Uptrend Dip (long) and Downtrend Rip (short)
 *    setups with entry/target/stop levels, late-entry checks and a tracker of
 *    the last few sessions' signals (rules in app.js, section 4c).
 *
 * Only completed candles are used, so results do not change until the next candle closes.
 *
 * Usage:  ALPACA_KEY_ID=... ALPACA_SECRET_KEY=... node scanner/scan.js --out data
 *
 * Technical screening only. Not financial advice.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../app.js');

/* ------------------------------------------------------------------ config */
const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const list = (v, d) => String(v || d).split(',').map(x => x.trim().toUpperCase()).filter(Boolean);

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const CFG = {
  keyId: env.ALPACA_KEY_ID || '',
  secret: env.ALPACA_SECRET_KEY || '',
  tradingBase: (env.ALPACA_TRADING_BASE || 'https://paper-api.alpaca.markets').replace(/\/+$/, ''),
  dataBase: (env.ALPACA_DATA_BASE || 'https://data.alpaca.markets').replace(/\/+$/, ''),
  feed: (env.ALPACA_FEED || 'sip').toLowerCase(),
  adjustment: (env.ALPACA_ADJUSTMENT || 'split').toLowerCase(),
  rpm: num(env.ALPACA_RPM, 180),                 // free plan allows 200 requests/min
  concurrency: num(env.CONCURRENCY, 4),
  batchSize: num(env.BATCH_SIZE, 100),           // symbols per request
  exchanges: list(env.EXCHANGES, 'NYSE,NASDAQ,AMEX,ARCA,NYSEARCA,BATS'),
  minPrice: num(env.MIN_PRICE, 2),
  minAvgVolume: num(env.MIN_AVG_VOLUME, 500000),
  intradayMax: num(env.INTRADAY_MAX_SYMBOLS, 1000),
  timeframes: list(env.TIMEFRAMES, '1D,4H,1H').filter(tf => ['1D', '4H', '1H'].includes(tf)),
  dailyLookbackDays: num(env.DAILY_LOOKBACK_DAYS, 460),       // ≈ 315 trading days
  intradayLookbackDays: num(env.INTRADAY_LOOKBACK_DAYS, 120), // ≈ 80 sessions → ~160 4H / ~560 1H candles
  includeSeries: String(env.INCLUDE_CHART_SERIES || 'true').toLowerCase() !== 'false',
  previousBaseUrl: (env.PREVIOUS_BASE_URL || '').replace(/\/+$/, ''),
  params: {
    fast: num(env.MACD_FAST, 12),
    slow: num(env.MACD_SLOW, 26),
    signal: num(env.MACD_SIGNAL, 9),
    rsiLen: num(env.RSI_LENGTH, 14),
  },
  // Thresholds used for the published backtest (the page's "All US stocks" backtest).
  backtest: {
    rsiMin: num(env.RSI_MIN, 35),
    rsiMax: num(env.RSI_MAX, 55),
    minBtc: num(env.MIN_BARS_TO_CROSS, 1),
    maxBtc: num(env.MAX_BARS_TO_CROSS, 5),
    volumeFilter: String(env.VOLUME_FILTER || 'false').toLowerCase() === 'true',
    minRelVol: num(env.MIN_REL_VOL, 1),
  },
  keepCandles: num(env.KEEP_CANDLES, 300),
  // Stop downloading after this many minutes so the site still deploys before
  // GitHub's job time limit (timeout-minutes in the workflow). Unfinished
  // timeframes keep their previously published results.
  timeBudgetMin: num(env.SCAN_TIME_BUDGET_MIN, 24),
  intradayIncludeGroups: String(env.INTRADAY_INCLUDE_GROUPS || 'true').toLowerCase() !== 'false',
  outDir: argValue('--out', 'data'),
};
let deadline = Infinity;

/* ------------------------------------------------------ sectors & themes */
// GICS sectors with their SPDR sector ETFs (the tile badge shows the ETF's own signal).
const SECTORS = [
  { key: 'Information Technology', label: 'Information Technology', etf: 'XLK' },
  { key: 'Communication Services', label: 'Communication Services', etf: 'XLC' },
  { key: 'Consumer Discretionary', label: 'Consumer Discretionary', etf: 'XLY' },
  { key: 'Consumer Staples', label: 'Consumer Staples', etf: 'XLP' },
  { key: 'Energy', label: 'Energy', etf: 'XLE' },
  { key: 'Financials', label: 'Financials', etf: 'XLF' },
  { key: 'Health Care', label: 'Health Care', etf: 'XLV' },
  { key: 'Industrials', label: 'Industrials', etf: 'XLI' },
  { key: 'Materials', label: 'Materials', etf: 'XLB' },
  { key: 'Real Estate', label: 'Real Estate', etf: 'XLRE' },
  { key: 'Utilities', label: 'Utilities', etf: 'XLU' },
];

// Starter theme lists. Edit freely, or put your own list in themes.json at the
// repo root (same shape) to replace these. Tickers that aren't listed or have
// no data are skipped automatically.
const THEMES = [
  { key: 'semis', label: 'Semiconductors', etf: 'SMH', tickers: ['NVDA', 'AMD', 'AVGO', 'TSM', 'ASML', 'QCOM', 'TXN', 'INTC', 'MU', 'AMAT', 'LRCX', 'KLAC', 'ADI', 'MRVL', 'NXPI', 'MCHP', 'ON', 'MPWR', 'SWKS', 'QRVO', 'TER', 'ENTG', 'ARM', 'GFS', 'COHR', 'ALAB', 'CRDO', 'SITM', 'LSCC', 'AMKR', 'ONTO', 'FORM', 'RMBS'] },
  { key: 'ai', label: 'AI & data centers', etf: 'AIQ', tickers: ['NVDA', 'AMD', 'AVGO', 'MRVL', 'ANET', 'VRT', 'SMCI', 'DELL', 'CRWV', 'NBIS', 'ORCL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'PLTR', 'AI', 'SOUN', 'BBAI', 'APLD', 'PATH', 'SNOW'] },
  { key: 'quantum', label: 'Quantum computing', etf: 'QTUM', tickers: ['IONQ', 'RGTI', 'QBTS', 'QUBT', 'ARQQ', 'IBM', 'HON', 'GOOGL'] },
  { key: 'nuclear', label: 'Nuclear & uranium', etf: 'URA', tickers: ['CCJ', 'UEC', 'NXE', 'UUUU', 'DNN', 'LEU', 'SMR', 'OKLO', 'NNE', 'BWXT', 'CEG', 'VST', 'TLN', 'GEV'] },
  { key: 'clean', label: 'Solar & clean energy', etf: 'ICLN', tickers: ['FSLR', 'ENPH', 'SEDG', 'RUN', 'NXT', 'ARRY', 'SHLS', 'PLUG', 'BE', 'NEE', 'AES', 'CSIQ', 'JKS'] },
  { key: 'cyber', label: 'Cybersecurity', etf: 'CIBR', tickers: ['CRWD', 'PANW', 'FTNT', 'ZS', 'OKTA', 'NET', 'S', 'QLYS', 'TENB', 'RPD', 'CHKP', 'VRNS', 'CYBR'] },
  { key: 'software', label: 'Cloud & software', etf: 'IGV', tickers: ['MSFT', 'ORCL', 'CRM', 'NOW', 'ADBE', 'INTU', 'SNOW', 'DDOG', 'MDB', 'NET', 'PLTR', 'WDAY', 'TEAM', 'HUBS', 'SHOP', 'APP'] },
  { key: 'crypto', label: 'Crypto & bitcoin miners', etf: 'IBIT', tickers: ['COIN', 'MSTR', 'MARA', 'RIOT', 'CLSK', 'HUT', 'CIFR', 'IREN', 'WULF', 'BITF', 'HOOD', 'GLXY', 'CRCL', 'BTDR', 'CORZ'] },
  { key: 'ev', label: 'EVs & autonomy', etf: 'DRIV', tickers: ['TSLA', 'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'GM', 'F', 'QS'] },
  { key: 'space', label: 'Space & defense', etf: 'ITA', tickers: ['LMT', 'NOC', 'RTX', 'GD', 'LHX', 'BA', 'HII', 'RKLB', 'ASTS', 'LUNR', 'PL', 'RDW', 'KTOS', 'AVAV'] },
  { key: 'gold', label: 'Gold & silver miners', etf: 'GDX', tickers: ['NEM', 'AEM', 'B', 'GOLD', 'KGC', 'AU', 'GFI', 'WPM', 'FNV', 'RGLD', 'AGI', 'HMY', 'EGO', 'PAAS', 'AG'] },
  { key: 'oil', label: 'Oil & gas', etf: 'XOP', tickers: ['XOM', 'CVX', 'COP', 'EOG', 'OXY', 'DVN', 'FANG', 'APA', 'CTRA', 'EQT', 'AR', 'RRC', 'SLB', 'HAL', 'BKR', 'MPC', 'PSX', 'VLO'] },
];

function loadThemes() {
  const file = path.join(__dirname, '..', 'themes.json');
  try {
    if (!fs.existsSync(file)) return THEMES;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(json) ? json : json.themes;
    if (!Array.isArray(list)) throw new Error('expected an array of themes');
    const ok = list.filter(t => t && t.key && t.label && Array.isArray(t.tickers));
    log(`Using ${ok.length} themes from themes.json`);
    return ok.map(t => ({ ...t, tickers: t.tickers.map(x => String(x).toUpperCase().trim()).filter(Boolean) }));
  } catch (e) {
    log(`themes.json ignored (${e.message}); using built-in themes`);
    return THEMES;
  }
}

const RTH_OPEN = 9 * 60 + 30;   // 09:30 ET in minutes
const RTH_CLOSE = 16 * 60;      // 16:00 ET

/* ----------------------------------------------------------------- helpers */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const r7 = x => (isNum(x) ? Number(x.toPrecision(7)) : null);
const pad2 = n => String(n).padStart(2, '0');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; await worker(items[i], i); }
  });
  await Promise.all(runners);
}

/* New York local date & minutes-since-midnight for a Date (handles DST). */
const ET_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function etParts(date) {
  const p = {};
  for (const part of ET_FORMAT.formatToParts(date)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/* ------------------------------------------------------------------- HTTP */
const limiter = {
  stamps: [],
  async acquire() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter(t => now - t < 60000);
      if (this.stamps.length < CFG.rpm) { this.stamps.push(now); return; }
      await sleep(60000 - (now - this.stamps[0]) + 50);
    }
  },
};
let requestCount = 0;

async function alpacaGet(url, attempt = 0) {
  if (Date.now() > deadline) {
    throw new Error(`Stopped after ${CFG.timeBudgetMin} minutes (SCAN_TIME_BUDGET_MIN) so the site can still deploy. Lower INTRADAY_MAX_SYMBOLS, or raise SCAN_TIME_BUDGET_MIN together with timeout-minutes.`);
  }
  await limiter.acquire();
  requestCount++;
  let res;
  try {
    res = await fetch(url, {
      headers: { 'APCA-API-KEY-ID': CFG.keyId, 'APCA-API-SECRET-KEY': CFG.secret, Accept: 'application/json' },
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    if (attempt < 4) { await sleep(2000 * 2 ** attempt); return alpacaGet(url, attempt + 1); }
    throw new Error(`Network error calling Alpaca: ${e.message}`);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const wait = reset ? Math.max(1000, reset * 1000 - Date.now() + 500) : 3000 * 2 ** attempt;
    await sleep(Math.min(wait, 65000));
    return alpacaGet(url, attempt + 1);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    const where = url.split('?')[0];
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Alpaca rejected the request (HTTP ${res.status}) at ${where}. Check the ALPACA_KEY_ID / ALPACA_SECRET_KEY secrets${CFG.feed === 'sip' ? ', or set ALPACA_FEED=iex if your plan cannot read SIP data' : ''}. ${body}`);
    }
    throw new Error(`Alpaca HTTP ${res.status} at ${where}: ${body}`);
  }
  return res.json();
}

/* --------------------------------------------------------------- universe */
async function fetchUniverse() {
  const assets = await alpacaGet(`${CFG.tradingBase}/v2/assets?status=active&asset_class=us_equity`);
  if (!Array.isArray(assets)) throw new Error('Unexpected response from the Alpaca assets endpoint');
  const exchanges = new Set(CFG.exchanges);
  const names = {};
  const symbols = assets
    .filter(a => a && a.tradable && a.status === 'active' && exchanges.has(String(a.exchange).toUpperCase()))
    .filter(a => /^[A-Z]{1,5}(\.[A-Z])?$/.test(String(a.symbol)))   // plain tickers and class shares like BRK.B
    .map(a => { const sym = String(a.symbol); const n = cleanName(a.name); if (n) names[sym] = n; return sym; })
    .sort();
  return { symbols, names };
}

/* "Apple Inc. Common Stock" -> "Apple Inc." */
function cleanName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+(Class [A-Z]\s+)?(Common Stock|Common Shares|Ordinary Shares|Subordinate Voting Shares|American Depositary Shares|American Depository Shares|ADSs?|ADRs?|Depositary Shares|Shares of Beneficial Interest|New)\b.*$/i, '');
  s = s.replace(/\s+Class [A-Z]$/i, '').replace(/[,;]\s*$/, '').trim();
  return s;
}

/* ---------------------------------------------- index member lists */
const UA = 'TradeWithBK-screener/1.0 (scheduled GitHub Action; contact via repository)';
const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,text/csv,*/*' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function htmlText(s) {
  return String(s)
    .replace(/<sup\b[\s\S]*?<\/sup>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8211;|&ndash;/g, '–')
    .replace(/\s+/g, ' ').trim();
}

function parseHtmlTables(html) {
  const tables = [];
  const tableRe = /<table\b([^>]*)>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = tableRe.exec(html))) {
    const idMatch = m[1].match(/\bid="([^"]*)"/i);
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let r;
    while ((r = rowRe.exec(m[2]))) {
      const cells = [];
      const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let c;
      while ((c = cellRe.exec(r[1]))) cells.push(htmlText(c[2]));
      if (cells.length) rows.push(cells);
    }
    tables.push({ id: idMatch ? idMatch[1] : '', rows });
  }
  return tables;
}

function normTicker(raw) {
  let t = String(raw || '').toUpperCase();
  if (t.includes(':')) t = t.split(':').pop();
  return t.replace(/\s+/g, '').replace(/[^A-Z.]/g, '');
}

/* Turns a table (header row + data rows) into [{ t, name, sector }]. */
function membersFromRows(rows, { sectorIsGics = true } = {}) {
  if (!rows.length) return [];
  const header = rows[0].map(h => h.toLowerCase());
  const ti = header.findIndex(h => /^(symbol|ticker)\b/.test(h));
  if (ti < 0) return [];
  const ni = header.findIndex(h => /^(security|company|name)\b/.test(h));
  const si = sectorIsGics ? header.findIndex(h => /gics sector/.test(h) || h === 'sector') : -1;
  const out = [];
  for (const row of rows.slice(1)) {
    const t = normTicker(row[ti]);
    if (!TICKER_RE.test(t)) continue;
    out.push({ t, name: ni >= 0 ? row[ni] : '', sector: si >= 0 ? row[si] : '' });
  }
  return out;
}

async function fetchWikiIndex(url, minCount, opts) {
  const tables = parseHtmlTables(await fetchText(url));
  const ordered = [...tables.filter(t => t.id === 'constituents'), ...tables.filter(t => t.id !== 'constituents')];
  for (const tbl of ordered) {
    const members = membersFromRows(tbl.rows, opts);
    if (members.length >= minCount) return members;
  }
  throw new Error(`no table with at least ${minCount} members at ${url}`);
}

// Last-resort snapshot; the live list from Wikipedia is used whenever it loads.
const DOW_SNAPSHOT = ['AAPL', 'AMGN', 'AMZN', 'AXP', 'BA', 'CAT', 'CRM', 'CSCO', 'CVX', 'DIS', 'GS', 'HD', 'HON', 'IBM', 'JNJ', 'JPM', 'KO', 'MCD', 'MMM', 'MRK', 'MSFT', 'NKE', 'NVDA', 'PG', 'SHW', 'TRV', 'UNH', 'V', 'VZ', 'WMT'];

const INDEX_SOURCES = {
  sp500: {
    label: 'S&P 500',
    min: 450,
    loaders: [
      ['GitHub datasets/s-and-p-500-companies', async () => {
        const rows = parseCsv(await fetchText('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv'));
        return membersFromRows(rows);
      }],
      ['Wikipedia', () => fetchWikiIndex('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', 450)],
    ],
  },
  ndx: {
    label: 'Nasdaq-100',
    min: 90,
    loaders: [['Wikipedia', () => fetchWikiIndex('https://en.wikipedia.org/wiki/Nasdaq-100', 90)]],
  },
  dow: {
    label: 'Dow 30',
    min: 28,
    loaders: [
      ['Wikipedia', () => fetchWikiIndex('https://en.wikipedia.org/wiki/Dow_Jones_Industrial_Average', 28, { sectorIsGics: false })],
      ['built-in snapshot', async () => DOW_SNAPSHOT.map(t => ({ t, name: '', sector: '' }))],
    ],
  },
};

/* Downloads index lists; falls back to the previously published list, never fails the scan. */
async function buildGroups(previousUniverse) {
  const indexes = {};
  const sectorOf = {};
  const indexNames = {};
  for (const [key, src] of Object.entries(INDEX_SOURCES)) {
    let done = false;
    for (const [source, load] of src.loaders) {
      if (source === 'built-in snapshot' && previousUniverse && previousUniverse.indexes && previousUniverse.indexes[key]) break;
      try {
        const members = await load();
        if (members.length < src.min) throw new Error(`only ${members.length} members`);
        indexes[key] = { label: src.label, source, asOf: new Date().toISOString(), tickers: [...new Set(members.map(m => m.t))].sort() };
        for (const m of members) {
          if (m.sector && !sectorOf[m.t]) sectorOf[m.t] = m.sector;
          if (m.name && !indexNames[m.t]) indexNames[m.t] = m.name;
        }
        log(`${src.label}: ${indexes[key].tickers.length} members from ${source}`);
        done = true;
        break;
      } catch (e) {
        log(`${src.label}: ${source} failed (${e.message})`);
      }
    }
    if (!done && previousUniverse && previousUniverse.indexes && previousUniverse.indexes[key]) {
      indexes[key] = { ...previousUniverse.indexes[key], stale: true };
      for (const t of indexes[key].tickers) {
        const sec = previousUniverse.sectorOf && previousUniverse.sectorOf[t];
        if (sec && !sectorOf[t]) sectorOf[t] = sec;
      }
      log(`${src.label}: kept the previously published list`);
    }
  }
  const knownSectors = new Set(SECTORS.map(x => x.key));
  for (const [t, sec] of Object.entries(sectorOf)) if (!knownSectors.has(sec)) delete sectorOf[t];
  return { indexes, sectorOf, indexNames, themes: loadThemes() };
}

/* ------------------------------------------------------------------- bars */
async function fetchBars(symbols, timeframe, start, end, label) {
  const out = new Map();
  const batches = chunk(symbols, CFG.batchSize);
  let done = 0;
  let lastLog = Date.now();
  const progress = force => {
    if (force || Date.now() - lastLog > 20000) {
      lastLog = Date.now();
      log(`${label}: ${done}/${batches.length} batches done, ${requestCount} requests so far`);
    }
  };
  log(`${label}: downloading ${timeframe} bars for ${symbols.length} symbols in ${batches.length} batches`);
  await pool(batches, CFG.concurrency, async batch => {
    let token = null;
    do {
      const q = new URLSearchParams({
        symbols: batch.join(','),
        timeframe,
        start: start.toISOString(),
        end: end.toISOString(),
        limit: '10000',
        adjustment: CFG.adjustment,
        feed: CFG.feed,
        sort: 'asc',
      });
      if (token) q.set('page_token', token);
      const json = await alpacaGet(`${CFG.dataBase}/v2/stocks/bars?${q.toString()}`);
      for (const [sym, bars] of Object.entries(json.bars || {})) {
        if (!Array.isArray(bars)) continue;
        if (!out.has(sym)) out.set(sym, []);
        const arr = out.get(sym);
        for (const b of bars) arr.push(b);
      }
      token = json.next_page_token || null;
      progress(false);
    } while (token);
    done++;
    progress(done === batches.length);
  });
  for (const arr of out.values()) arr.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return out;
}

/* Daily bars -> candles; drops today's bar while the session is still open. */
function toDailyCandles(bars, dataEnd) {
  const end = etParts(dataEnd);
  const candles = [];
  for (const b of bars) {
    const t = etParts(new Date(b.t)).date;
    candles.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
  }
  const last = candles[candles.length - 1];
  if (last && last.t === end.date && end.minutes < RTH_CLOSE) candles.pop();
  return core.cleanCandles(candles);
}

/*
 * 30-minute bars -> regular-session candles of `bucketMinutes` (60 or 240),
 * anchored at 09:30 ET. Extended-hours bars are ignored. The last candle is
 * dropped if it had not finished by the data end time.
 */
function aggregateSession(bars30, bucketMinutes, dataEnd) {
  const out = [];
  let cur = null;
  for (const b of bars30) {
    const { date, minutes } = etParts(new Date(b.t));
    if (minutes < RTH_OPEN || minutes >= RTH_CLOSE) continue;
    const idx = Math.floor((minutes - RTH_OPEN) / bucketMinutes);
    const key = `${date}#${idx}`;
    if (!cur || cur.key !== key) {
      if (cur) out.push(cur);
      const startMin = RTH_OPEN + idx * bucketMinutes;
      cur = {
        key, date, startMin,
        t: `${date} ${pad2(Math.floor(startMin / 60))}:${pad2(startMin % 60)}`,
        o: b.o, h: b.h, l: b.l, c: b.c, v: isNum(b.v) ? b.v : 0,
      };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += isNum(b.v) ? b.v : 0;
    }
  }
  if (cur) out.push(cur);

  const end = etParts(dataEnd);
  const last = out[out.length - 1];
  if (last && last.date === end.date && end.minutes < Math.min(last.startMin + bucketMinutes, RTH_CLOSE)) out.pop();

  return core.cleanCandles(out.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v })));
}

function liquidityStats(candles) {
  if (!candles || candles.length < 20) return null;
  const last20 = candles.slice(-20);
  const vols = last20.map(c => c.v).filter(isNum);
  if (vols.length < 15) return null;
  const avgVolume = vols.reduce((a, b) => a + b, 0) / vols.length;
  const dollars = last20.filter(c => isNum(c.v)).map(c => c.c * c.v);
  const avgDollarVolume = dollars.reduce((a, b) => a + b, 0) / dollars.length;
  return { lastClose: candles[candles.length - 1].c, avgVolume, avgDollarVolume };
}

/* ------------------------------------------------------------ build output */
function buildFile(tf, symbols, getCandles, dataEnd, universe) {
  const rows = [];
  const series = {};
  let errors = 0;
  const errorSamples = [];
  const btSettings = { ...core.DEFAULT_SETTINGS, ...CFG.params, ...CFG.backtest, timeframe: tf };
  const btResults = [];
  const btSignals = {};

  for (const sym of symbols) {
    try {
      const candles = getCandles(sym) || [];
      const m = core.computeMetrics(candles, CFG.params);
      const bt = core.backtestCandles(candles, btSettings);
      btResults.push(bt);
      if (bt.signals.length) btSignals[sym] = bt.signals.map(core.packSignal);
      rows.push({
        ticker: sym,
        time: m.time,
        candleCount: m.candleCount,
        price: r7(m.price),
        macd: r7(m.macd),
        signal: r7(m.signal),
        gap: r7(m.gap),
        gapVelocity: r7(m.gapVelocity),
        slope: r7(m.slope),
        accel: r7(m.accel),
        rsi: r7(m.rsi),
        rsiPrev: r7(m.rsiPrev),
        relVol: r7(m.relVol),
      });
      // Charts only for stocks in the setup's core shape (below Signal, rising, gap closing).
      // These conditions do not depend on the user's adjustable thresholds.
      if (CFG.includeSeries && m.gap < 0 && m.slope > 0 && m.gapVelocity > 0) {
        series[sym] = {
          time: m.series.time,
          close: m.series.close.map(r7),
          macd: m.series.macd.map(r7),
          signal: m.series.signal.map(r7),
          hist: m.series.hist.map(r7),
          rsi: m.series.rsi.map(r7),
        };
      }
    } catch (e) {
      errors++;
      if (errorSamples.length < 10) errorSamples.push(`${sym}: ${e.message}`);
    }
  }

  const generatedAt = new Date().toISOString();
  const backtest = roundNumbers(core.summarizeBacktest(btResults, btSettings));
  const main = {
    version: 1,
    timeframe: tf,
    generatedAt,
    dataEnd: dataEnd.toISOString(),
    source: `Alpaca ${CFG.feed.toUpperCase()} feed, ${CFG.adjustment}-adjusted`,
    params: CFG.params,
    universe: { ...universe, analyzed: rows.length, errors, errorSamples },
    stale: false,
    backtest,
    rows,
    series,
  };
  const btFile = { version: 1, timeframe: tf, generatedAt, thresholds: backtest.thresholds, signals: btSignals };
  return { main, bt: btFile };
}

/* Uptrend Dip / Downtrend Rip setups over the last few completed daily candles. */
function buildSetupsFile(symbols, getCandles, groups) {
  const lastDate = {};
  for (const sym of symbols) {
    const c = getCandles(sym);
    if (c && c.length) lastDate[sym] = String(c[c.length - 1].t).slice(0, 10);
  }
  const asOf = Object.values(lastDate).sort().pop() || null;
  const sp500 = new Set((groups && groups.indexes.sp500 && groups.indexes.sp500.tickers) || []);
  const items = [];
  for (const sym of symbols) {
    if (lastDate[sym] !== asOf) continue;                     // skip halted / stale tickers
    for (const sig of core.scanSetups(getCandles(sym))) items.push({ ticker: sym, sp500: sp500.has(sym), ...sig });
  }
  const clean = roundNumbers(items);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    asOf,
    nextSession: asOf ? core.addSessions(asOf, 1) : null,
    rules: core.SETUP,
    sp500Listed: sp500.size > 0,
    dip: clean.filter(x => x.kind === 'dip'),
    rip: clean.filter(x => x.kind === 'rip'),
  };
}

/* Rounds every non-integer number in a plain object to 2 decimals (for the backtest summary). */
function roundNumbers(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v)));
}

async function fetchPrevious(name) {
  if (!CFG.previousBaseUrl) return null;
  try {
    const res = await fetch(`${CFG.previousBaseUrl}/data/${name}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function logResult(tf, res) {
  const b = res.main.backtest;
  const c10 = b.curl.horizons[10] || {};
  log(`${tf}: ${res.main.rows.length} analysed, ${Object.keys(res.main.series).length} charts, ` +
    `backtest ${b.curl.count} Early Curls / ${b.approaching.count} Approaching` +
    (c10.n ? ` (Early Curl +10 candles: ${Math.round(c10.winRate)}% up, avg ${c10.avg}%)` : ''));
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  log(`Wrote ${file} (${kb} KB)`);
}

/* -------------------------------------------------------------------- main */
async function main() {
  const t0 = Date.now();
  deadline = t0 + CFG.timeBudgetMin * 60000;
  const results = {};
  let failure = null;
  let groups = null;
  let universeNames = {};
  const analysed = new Set();
  let setupsOut = null;

  try {
    if (!CFG.keyId || !CFG.secret) {
      throw new Error('ALPACA_KEY_ID and ALPACA_SECRET_KEY are not set. Add them as repository secrets (see README).');
    }
    if (!CFG.timeframes.length) throw new Error('TIMEFRAMES must include at least one of 1D, 4H, 1H.');

    // The free plan cannot read SIP data from the most recent 15 minutes.
    const dataEnd = new Date(Date.now() - 16 * 60 * 1000);

    const { symbols, names } = await fetchUniverse();
    log(`Universe: ${symbols.length} listed symbols on ${CFG.exchanges.join(', ')}`);

    groups = await buildGroups(await fetchPrevious('universe.json'));
    const forced = new Set();
    for (const ix of Object.values(groups.indexes)) ix.tickers.forEach(t => forced.add(t));
    for (const th of groups.themes) { th.tickers.forEach(t => forced.add(t)); if (th.etf) forced.add(th.etf); }
    for (const sec of SECTORS) forced.add(sec.etf);
    universeNames = names;

    const dailyStart = new Date(dataEnd.getTime() - CFG.dailyLookbackDays * 86400000);
    const dailyBars = await fetchBars(symbols, '1Day', dailyStart, dataEnd, 'Daily');
    const daily = new Map();
    for (const [sym, bars] of dailyBars) daily.set(sym, toDailyCandles(bars, dataEnd).slice(-CFG.keepCandles));

    const liquid = [];
    let forcedIn = 0;
    for (const [sym, candles] of daily) {
      const st = liquidityStats(candles);
      if (!st) continue;
      const passes = st.lastClose >= CFG.minPrice && st.avgVolume >= CFG.minAvgVolume;
      if (passes || forced.has(sym)) { liquid.push({ sym, forced: forced.has(sym), ...st }); if (!passes) forcedIn++; }
    }
    liquid.sort((a, b) => b.avgDollarVolume - a.avgDollarVolume);
    log(`${liquid.length} symbols scanned: pass price ≥ $${CFG.minPrice} and 20-day avg volume ≥ ${CFG.minAvgVolume}, plus ${forcedIn} index/theme members below the filter`);

    const universe = {
      listed: symbols.length,
      withData: daily.size,
      passedFilters: liquid.length,
      filters: { minPrice: CFG.minPrice, minAvgVolume: CFG.minAvgVolume, exchanges: CFG.exchanges },
    };

    if (CFG.timeframes.includes('1D')) {
      results['1D'] = buildFile('1D', liquid.map(x => x.sym), sym => daily.get(sym), dataEnd, universe);
      results['1D'].main.rows.forEach(r => analysed.add(r.ticker));
      setupsOut = buildSetupsFile(liquid.map(x => x.sym), sym => daily.get(sym), groups);
      log(`Setups: ${setupsOut.dip.length} Uptrend Dip and ${setupsOut.rip.length} Downtrend Rip signals in the last ${core.SETUP.LOOKBACK} sessions (as of ${setupsOut.asOf})`);
      logResult('1D', results['1D']);
    }

    const intradayTfs = CFG.timeframes.filter(tf => tf !== '1D');
    if (intradayTfs.length && CFG.intradayMax > 0) {
      const top = liquid.slice(0, CFG.intradayMax).map(x => x.sym);
      const members = CFG.intradayIncludeGroups ? liquid.filter(x => x.forced).map(x => x.sym) : [];
      const subset = [...new Set([...top, ...members])];
      log(`Intraday: ${top.length} most-traded + ${subset.length - top.length} more index/theme members`);
      const intradayStart = new Date(dataEnd.getTime() - CFG.intradayLookbackDays * 86400000);
      const bars30 = await fetchBars(subset, '30Min', intradayStart, dataEnd, 'Intraday');
      for (const tf of intradayTfs) {
        const minutes = tf === '1H' ? 60 : 240;
        const candles = new Map();
        for (const sym of subset) {
          candles.set(sym, aggregateSession(bars30.get(sym) || [], minutes, dataEnd).slice(-CFG.keepCandles));
        }
        results[tf] = buildFile(tf, subset, sym => candles.get(sym), dataEnd, { ...universe, intradaySubset: subset.length });
        logResult(tf, results[tf]);
      }
    }
  } catch (e) {
    failure = e;
    console.error(`Scan error: ${e.message}`);
  }

  // Write what succeeded; for anything that failed, keep the previously published results.
  for (const tf of CFG.timeframes) {
    const file = path.join(CFG.outDir, `${tf}.json`);
    const btPath = path.join(CFG.outDir, `bt-${tf}.json`);
    if (results[tf]) {
      writeJson(file, results[tf].main);
      writeJson(btPath, results[tf].bt);
      continue;
    }

    const reason = failure ? failure.message
      : (tf !== '1D' && CFG.intradayMax <= 0 ? 'Intraday scan is disabled (INTRADAY_MAX_SYMBOLS=0).' : 'Timeframe was not scanned.');
    const previous = await fetchPrevious(`${tf}.json`);
    if (previous && Array.isArray(previous.rows) && previous.rows.length) {
      previous.stale = true;
      previous.staleReason = reason;
      writeJson(file, previous);
      log(`${tf}: kept previous results from ${previous.generatedAt}`);
      const prevBt = await fetchPrevious(`bt-${tf}.json`);
      if (prevBt && prevBt.signals) writeJson(btPath, prevBt);
    } else {
      writeJson(file, { version: 1, timeframe: tf, generatedAt: new Date().toISOString(), error: reason, rows: [], series: {} });
    }
  }

  const setupsPath = path.join(CFG.outDir, 'setups.json');
  if (setupsOut) writeJson(setupsPath, setupsOut);
  else {
    const previous = await fetchPrevious('setups.json');
    if (previous) { previous.stale = true; writeJson(setupsPath, previous); }
  }

  const universePath = path.join(CFG.outDir, 'universe.json');
  if (groups) {
    const names = {};
    for (const t of analysed) names[t] = universeNames[t] || groups.indexNames[t] || '';
    for (const [t, n] of Object.entries(groups.indexNames)) if (!names[t] && analysed.has(t)) names[t] = n;
    writeJson(universePath, {
      version: 1,
      generatedAt: new Date().toISOString(),
      names,
      indexes: groups.indexes,
      sectorOf: groups.sectorOf,
      sectors: SECTORS,
      themes: groups.themes,
    });
  } else {
    const previous = await fetchPrevious('universe.json');
    if (previous) writeJson(universePath, previous);
  }

  log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)} s with ${requestCount} Alpaca requests.`);
  if (failure) {
    console.log(`::error::Market scan failed: ${failure.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}

module.exports = {
  CFG, etParts, toDailyCandles, aggregateSession, liquidityStats, buildFile, main,
  cleanName, parseCsv, parseHtmlTables, membersFromRows, buildGroups, buildSetupsFile, THEMES, SECTORS,
};
