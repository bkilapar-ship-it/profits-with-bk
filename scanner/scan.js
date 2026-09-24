#!/usr/bin/env node
/*
 * MACD Curl-Up Screener — scheduled market scan
 *
 * Runs in GitHub Actions (Node 22+, built-in fetch, no npm dependencies).
 * 1. Lists all active, tradable US stocks & ETFs from Alpaca.
 * 2. Downloads ~300 daily candles for all of them (many symbols per request).
 * 3. Keeps stocks that pass the price / volume filters.
 * 4. For the most-traded subset, downloads 30-minute candles and builds
 *    regular-session 1H and 4H candles (anchored at 9:30 ET, like most charts).
 * 5. Computes MACD / Signal / RSI / relative volume with the SAME code as the
 *    website (../app.js) and writes data/1D.json, data/4H.json, data/1H.json.
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
  keepCandles: 300,
  outDir: argValue('--out', 'data'),
};

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
  return assets
    .filter(a => a && a.tradable && a.status === 'active' && exchanges.has(String(a.exchange).toUpperCase()))
    .map(a => String(a.symbol))
    .filter(sym => /^[A-Z]{1,5}(\.[A-Z])?$/.test(sym))   // plain tickers and class shares like BRK.B
    .sort();
}

/* ------------------------------------------------------------------- bars */
async function fetchBars(symbols, timeframe, start, end, label) {
  const out = new Map();
  const batches = chunk(symbols, CFG.batchSize);
  let done = 0;
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
    } while (token);
    done++;
    if (done % 10 === 0 || done === batches.length) log(`${label}: ${done}/${batches.length} batches, ${requestCount} requests so far`);
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

  for (const sym of symbols) {
    try {
      const m = core.computeMetrics(getCandles(sym) || [], CFG.params);
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

  return {
    version: 1,
    timeframe: tf,
    generatedAt: new Date().toISOString(),
    dataEnd: dataEnd.toISOString(),
    source: `Alpaca ${CFG.feed.toUpperCase()} feed, ${CFG.adjustment}-adjusted`,
    params: CFG.params,
    universe: { ...universe, analyzed: rows.length, errors, errorSamples },
    stale: false,
    rows,
    series,
  };
}

async function fetchPrevious(tf) {
  if (!CFG.previousBaseUrl) return null;
  try {
    const res = await fetch(`${CFG.previousBaseUrl}/data/${tf}.json`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const json = await res.json();
    return json && Array.isArray(json.rows) && json.rows.length ? json : null;
  } catch {
    return null;
  }
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
  const results = {};
  let failure = null;

  try {
    if (!CFG.keyId || !CFG.secret) {
      throw new Error('ALPACA_KEY_ID and ALPACA_SECRET_KEY are not set. Add them as repository secrets (see README).');
    }
    if (!CFG.timeframes.length) throw new Error('TIMEFRAMES must include at least one of 1D, 4H, 1H.');

    // The free plan cannot read SIP data from the most recent 15 minutes.
    const dataEnd = new Date(Date.now() - 16 * 60 * 1000);

    const symbols = await fetchUniverse();
    log(`Universe: ${symbols.length} listed symbols on ${CFG.exchanges.join(', ')}`);

    const dailyStart = new Date(dataEnd.getTime() - CFG.dailyLookbackDays * 86400000);
    const dailyBars = await fetchBars(symbols, '1Day', dailyStart, dataEnd, 'Daily');
    const daily = new Map();
    for (const [sym, bars] of dailyBars) daily.set(sym, toDailyCandles(bars, dataEnd).slice(-CFG.keepCandles));

    const liquid = [];
    for (const [sym, candles] of daily) {
      const st = liquidityStats(candles);
      if (st && st.lastClose >= CFG.minPrice && st.avgVolume >= CFG.minAvgVolume) liquid.push({ sym, ...st });
    }
    liquid.sort((a, b) => b.avgDollarVolume - a.avgDollarVolume);
    log(`${liquid.length} symbols pass price ≥ $${CFG.minPrice} and 20-day avg volume ≥ ${CFG.minAvgVolume}`);

    const universe = {
      listed: symbols.length,
      withData: daily.size,
      passedFilters: liquid.length,
      filters: { minPrice: CFG.minPrice, minAvgVolume: CFG.minAvgVolume, exchanges: CFG.exchanges },
    };

    if (CFG.timeframes.includes('1D')) {
      results['1D'] = buildFile('1D', liquid.map(x => x.sym), sym => daily.get(sym), dataEnd, universe);
      log(`1D: ${results['1D'].rows.length} analysed, ${Object.keys(results['1D'].series).length} charts`);
    }

    const intradayTfs = CFG.timeframes.filter(tf => tf !== '1D');
    if (intradayTfs.length && CFG.intradayMax > 0) {
      const subset = liquid.slice(0, CFG.intradayMax).map(x => x.sym);
      const intradayStart = new Date(dataEnd.getTime() - CFG.intradayLookbackDays * 86400000);
      const bars30 = await fetchBars(subset, '30Min', intradayStart, dataEnd, 'Intraday');
      for (const tf of intradayTfs) {
        const minutes = tf === '1H' ? 60 : 240;
        const candles = new Map();
        for (const sym of subset) {
          candles.set(sym, aggregateSession(bars30.get(sym) || [], minutes, dataEnd).slice(-CFG.keepCandles));
        }
        results[tf] = buildFile(tf, subset, sym => candles.get(sym), dataEnd, { ...universe, intradaySubset: subset.length });
        log(`${tf}: ${results[tf].rows.length} analysed, ${Object.keys(results[tf].series).length} charts`);
      }
    }
  } catch (e) {
    failure = e;
    console.error(`Scan error: ${e.message}`);
  }

  // Write what succeeded; for anything that failed, keep the previously published results.
  for (const tf of CFG.timeframes) {
    const file = path.join(CFG.outDir, `${tf}.json`);
    if (results[tf]) { writeJson(file, results[tf]); continue; }

    const reason = failure ? failure.message
      : (tf !== '1D' && CFG.intradayMax <= 0 ? 'Intraday scan is disabled (INTRADAY_MAX_SYMBOLS=0).' : 'Timeframe was not scanned.');
    const previous = await fetchPrevious(tf);
    if (previous) {
      previous.stale = true;
      previous.staleReason = reason;
      writeJson(file, previous);
      log(`${tf}: kept previous results from ${previous.generatedAt}`);
    } else {
      writeJson(file, { version: 1, timeframe: tf, generatedAt: new Date().toISOString(), error: reason, rows: [], series: {} });
    }
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

module.exports = { CFG, etParts, toDailyCandles, aggregateSession, liquidityStats, buildFile, main };
