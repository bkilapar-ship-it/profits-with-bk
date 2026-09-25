/*
 * Trade With BK — MACD Curl-Up Screener — app.js
 *
 * A technical-analysis screening tool. It is NOT a trading system and does not
 * give financial advice. It only reports whether current indicator values match
 * the criteria the user selected.
 *
 * Two ways to scan:
 *   • All US stocks — loads results produced by the scheduled GitHub Action
 *     (scanner/scan.js), which uses this same file for its maths.
 *   • My watchlist  — downloads candles live in the browser (Twelve Data by default).
 *
 * Sections:
 *   0. Config & helpers
 *   1. Market-data provider for watchlist mode (replace to change data source)
 *   2. Cache, rate limiter, fetchHistoricalData()
 *   3. Indicators (EMA, MACD, Wilder RSI, SMA)
 *   4. Analysis (computeMetrics -> evaluate: curl detection, BarsToCross, Setup Strength)
 *   5. UI
 */
'use strict';

/* =========================================================================
 * 0. CONFIG & HELPERS
 * ========================================================================= */
const CONFIG = {
  STORAGE_PREFIX: 'mcs:',
  CANDLES_TO_FETCH: 300,          // ≥200 recommended so EMA(26)/EMA(9) are well initialised
  CONCURRENCY: 4,                 // parallel workers (the rate limiter still caps req/min)
  CACHE_TTL_MS: { '1D': 60 * 60 * 1000, '4H': 15 * 60 * 1000, '1H': 5 * 60 * 1000 },
  CHART_BARS: 120,
  VOLUME_SMA: 20,
  EPS: 1e-12,
  MARKET_DATA_DIR: 'data/',       // where the scheduled scan publishes 1D.json / 4H.json / 1H.json
  PAGE_SIZE: 150,                 // rows rendered at a time
};

const DEFAULT_SETTINGS = {
  fast: 12, slow: 26, signal: 9, rsiLen: 14,
  rsiMin: 35, rsiMax: 55, minBtc: 1, maxBtc: 5,
  volumeFilter: false, minRelVol: 1.0, timeframe: '1D',
  rpm: 8, persistCache: true,
};

class ScreenerError extends Error {
  constructor(message, kind = 'error') { super(message); this.name = 'ScreenerError'; this.kind = kind; }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/* Safe localStorage wrapper (localStorage can be unavailable or full). */
const storage = {
  get(key) { try { return localStorage.getItem(CONFIG.STORAGE_PREFIX + key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(CONFIG.STORAGE_PREFIX + key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(CONFIG.STORAGE_PREFIX + key); } catch { /* ignore */ } },
};

/* =========================================================================
 * 1. MARKET-DATA PROVIDER (watchlist mode)
 *
 * Each provider exposes:
 *   label, intervals (timeframe -> provider interval), keyHelp,
 *   fetch(ticker, timeframe, apiKey, outputSize) -> Promise<Candle[]>
 *
 * A Candle is { t: string (sortable datetime), o, h, l, c, v } with numbers.
 * Candles must be returned OLDEST FIRST. Throw ScreenerError on failure.
 * To add a provider, add an entry here — nothing else needs to change.
 * ========================================================================= */
const PROVIDERS = {
  twelvedata: {
    label: 'Twelve Data',
    intervals: { '1D': '1day', '4H': '4h', '1H': '1h' },
    keyHelp: 'Free key at twelvedata.com. Without a key the public "demo" key is used, which only works for a few symbols (e.g. AAPL).',

    async fetch(ticker, timeframe, apiKey, outputSize) {
      const interval = this.intervals[timeframe];
      if (!interval) throw new ScreenerError(`Timeframe ${timeframe} is not supported by ${this.label}`, 'config');

      const params = new URLSearchParams({
        symbol: ticker,
        interval,
        outputsize: String(outputSize),
        apikey: apiKey || 'demo',
        format: 'JSON',
      });
      const url = `https://api.twelvedata.com/time_series?${params.toString()}`;

      let res;
      try {
        res = await fetch(url);
      } catch {
        throw new ScreenerError('Network error — check your connection', 'network');
      }
      if (res.status === 429) throw new ScreenerError('Rate limit reached', 'rate');
      if (res.status === 401 || res.status === 403) {
        throw new ScreenerError(apiKey
          ? 'Twelve Data rejected your API key. Check it in Filters & settings.'
          : 'Needs a free Twelve Data API key (only AAPL works without one). Add it in Filters & settings.', 'auth');
      }
      if (!res.ok) throw new ScreenerError(`HTTP ${res.status} from data provider`, 'api');

      let json;
      try { json = await res.json(); } catch { throw new ScreenerError('Provider returned invalid JSON', 'api'); }

      if (json.status === 'error' || (json.code && json.code !== 200)) {
        const code = Number(json.code);
        const msg = String(json.message || 'Unknown API error');
        if (code === 429 || /credit|limit|too many/i.test(msg)) throw new ScreenerError('Rate limit reached', 'rate');
        if (code === 401 || code === 403 || /api ?key/i.test(msg)) {
          throw new ScreenerError(apiKey
            ? `Twelve Data rejected your API key: ${trimMsg(msg)}`
            : 'Needs a free Twelve Data API key (only AAPL works without one). Add it in Filters & settings.', 'auth');
        }
        if (code === 404 || /symbol|not found|invalid/i.test(msg)) throw new ScreenerError('Invalid or unsupported ticker', 'invalid');
        throw new ScreenerError(trimMsg(msg), 'api');
      }
      if (!Array.isArray(json.values) || json.values.length === 0) throw new ScreenerError('No price data returned', 'nodata');

      const candles = json.values.map(v => ({
        t: String(v.datetime),
        o: parseFloat(v.open),
        h: parseFloat(v.high),
        l: parseFloat(v.low),
        c: parseFloat(v.close),
        v: v.volume === undefined || v.volume === null || v.volume === '' ? NaN : parseFloat(v.volume),
      }));
      candles.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)); // oldest first
      return candles;
    },
  },
};

function trimMsg(msg) { return msg.length > 140 ? msg.slice(0, 137) + '…' : msg; }

let activeProviderId = 'twelvedata';

/* =========================================================================
 * 2. CACHE, RATE LIMITER, fetchHistoricalData()
 * ========================================================================= */
const memoryCache = new Map();   // key -> { ts, candles }
const inflight = new Map();      // key -> Promise (dedupes concurrent requests)
let persistCache = true;
let requestsPerMinute = DEFAULT_SETTINGS.rpm;
let abortFlag = false;

const cache = {
  key(provider, tf, ticker) { return `${CONFIG.STORAGE_PREFIX}cache:${provider}:${tf}:${ticker}`; },

  get(provider, tf, ticker) {
    const k = this.key(provider, tf, ticker);
    const ttl = CONFIG.CACHE_TTL_MS[tf] || CONFIG.CACHE_TTL_MS['1D'];
    let entry = memoryCache.get(k);
    if (!entry && persistCache) {
      try {
        const raw = localStorage.getItem(k);
        if (raw) {
          const obj = JSON.parse(raw);
          entry = {
            ts: obj.ts,
            candles: obj.d.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v === null ? NaN : v })),
          };
          memoryCache.set(k, entry);
        }
      } catch { /* corrupt entry: ignore */ }
    }
    if (entry && Date.now() - entry.ts < ttl) return entry.candles;
    return null;
  },

  set(provider, tf, ticker, candles) {
    const k = this.key(provider, tf, ticker);
    const entry = { ts: Date.now(), candles };
    memoryCache.set(k, entry);
    if (!persistCache) return;
    const payload = JSON.stringify({
      ts: entry.ts,
      d: candles.map(c => [c.t, c.o, c.h, c.l, c.c, isNum(c.v) ? c.v : null]),
    });
    try {
      localStorage.setItem(k, payload);
    } catch {
      this.evictOldest();
      try { localStorage.setItem(k, payload); } catch { /* storage full: memory cache only */ }
    }
  },

  cacheKeys() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CONFIG.STORAGE_PREFIX + 'cache:')) keys.push(k);
      }
    } catch { /* ignore */ }
    return keys;
  },

  evictOldest() {
    const entries = this.cacheKeys().map(k => {
      let ts = 0;
      try { ts = JSON.parse(localStorage.getItem(k)).ts || 0; } catch { /* ignore */ }
      return { k, ts };
    }).sort((a, b) => a.ts - b.ts);
    const n = Math.max(1, Math.ceil(entries.length / 2));
    entries.slice(0, n).forEach(e => { try { localStorage.removeItem(e.k); } catch { /* ignore */ } });
  },

  clear() {
    memoryCache.clear();
    this.cacheKeys().forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
  },
};

/* Sliding-window limiter: at most `requestsPerMinute` network calls per 60 s. */
const rateLimiter = {
  stamps: [],
  onWait: null,
  async acquire() {
    for (;;) {
      if (abortFlag) throw new ScreenerError('Scan stopped', 'aborted');
      const now = Date.now();
      this.stamps = this.stamps.filter(t => now - t < 60000);
      if (this.stamps.length < requestsPerMinute) { this.stamps.push(now); return; }
      const waitMs = 60000 - (now - this.stamps[0]) + 100;
      if (this.onWait) this.onWait(waitMs);
      await sleep(Math.min(waitMs, 500));
    }
  },
};

async function abortableSleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (abortFlag) throw new ScreenerError('Scan stopped', 'aborted');
    await sleep(Math.min(500, end - Date.now()));
  }
}

function cleanCandles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(c => c && isNum(c.c) && c.c > 0)
    .map(c => ({ ...c, v: isNum(c.v) && c.v >= 0 ? c.v : NaN }));
}

/**
 * The ONE function watchlist mode uses to get data.
 * Replace the provider (section 1) and this keeps working.
 * @returns {Promise<{candles: Candle[], fromCache: boolean}>}
 */
async function fetchHistoricalData(ticker, timeframe = '1D') {
  const provider = PROVIDERS[activeProviderId];
  if (!provider) throw new ScreenerError('No data provider configured', 'config');

  const cached = cache.get(activeProviderId, timeframe, ticker);
  if (cached) return { candles: cached, fromCache: true };

  const flightKey = `${activeProviderId}|${timeframe}|${ticker}`;
  if (inflight.has(flightKey)) return inflight.get(flightKey);

  const promise = (async () => {
    const apiKey = storage.get('apikey') || '';
    let raw;
    try {
      await rateLimiter.acquire();
      raw = await provider.fetch(ticker, timeframe, apiKey, CONFIG.CANDLES_TO_FETCH);
    } catch (err) {
      if (err instanceof ScreenerError && err.kind === 'rate') {
        // One retry after the rate window resets.
        if (rateLimiter.onWait) rateLimiter.onWait(61000);
        await abortableSleep(61000);
        await rateLimiter.acquire();
        raw = await provider.fetch(ticker, timeframe, apiKey, CONFIG.CANDLES_TO_FETCH);
      } else {
        throw err;
      }
    }
    const candles = cleanCandles(raw);
    if (candles.length === 0) throw new ScreenerError('No usable price data (missing closes)', 'nodata');
    cache.set(activeProviderId, timeframe, ticker, candles);
    return { candles, fromCache: false };
  })();

  inflight.set(flightKey, promise);
  try { return await promise; } finally { inflight.delete(flightKey); }
}

/* =========================================================================
 * 3. INDICATORS (pure functions, no external libraries)
 * ========================================================================= */

/**
 * EMA_today = Price_today * k + EMA_yesterday * (1 - k), k = 2 / (period + 1).
 * Seeded with the SMA of the first `period` values (standard convention).
 * Leading NaNs in `values` are skipped (needed for Signal = EMA of MACD).
 */
function ema(values, period) {
  const out = new Array(values.length).fill(NaN);
  const start = values.findIndex(isNum);
  if (start < 0 || values.length - start < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += values[i];
  let prev = sum / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function computeMACD(closes, fast, slow, signalPeriod) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macd = closes.map((_, i) => (isNum(emaFast[i]) && isNum(emaSlow[i]) ? emaFast[i] - emaSlow[i] : NaN));
  const signal = ema(macd, signalPeriod);
  const hist = macd.map((m, i) => (isNum(m) && isNum(signal[i]) ? m - signal[i] : NaN));
  return { macd, signal, hist };
}

/** Wilder RSI: first average = simple mean of first `period` changes, then Wilder smoothing. */
function rsiWilder(closes, period) {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = rsiFromAverages(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

function rsiFromAverages(avgGain, avgLoss) {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Simple moving average; NaN if any value in the window is missing. */
function sma(values, period) {
  const out = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0, ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (!isNum(values[j])) { ok = false; break; }
      sum += values[j];
    }
    if (ok) out[i] = sum / period;
  }
  return out;
}

/* =========================================================================
 * 4. ANALYSIS
 *
 * computeMetrics() turns candles into raw indicator values (needs the MACD/RSI
 * periods). evaluate() applies the user's thresholds to those values. Splitting
 * them lets the browser re-score thousands of pre-computed stocks instantly.
 * ========================================================================= */
function computeMetrics(candles, p) {
  const minBars = p.slow + p.signal + 3;
  if (!Array.isArray(candles) || candles.length < minBars) {
    throw new ScreenerError(`Insufficient history: ${candles ? candles.length : 0} candles (need at least ${minBars})`, 'insufficient');
  }

  const closes = candles.map(c => c.c);
  const volumes = candles.map(c => c.v);
  const { macd, signal, hist } = computeMACD(closes, p.fast, p.slow, p.signal);
  const rsi = rsiWilder(closes, p.rsiLen);
  const volSma = sma(volumes, CONFIG.VOLUME_SMA);

  const t = candles.length - 1;
  const m0 = macd[t], m1 = macd[t - 1], m2 = macd[t - 2];
  const sig0 = signal[t];
  const gap0 = hist[t], gap1 = hist[t - 1];
  if (![m0, m1, m2, sig0, gap0, gap1, closes[t]].every(isNum)) {
    throw new ScreenerError('Indicator values are NaN (missing or bad data near the latest candle)', 'nan');
  }

  const vol0 = volumes[t], volAvg = volSma[t];
  const keep = arr => arr.slice(-Math.min(CONFIG.CHART_BARS, candles.length));

  return {
    time: candles[t].t,
    candleCount: candles.length,
    price: closes[t],
    macd: m0,
    signal: sig0,
    gap: gap0,                              // MACD − Signal (= histogram)
    gapVelocity: gap0 - gap1,               // Gap[t] − Gap[t−1]
    slope: m0 - m1,                         // MACD[t] − MACD[t−1]
    accel: (m0 - m1) - (m1 - m2),           // > 0 ⇔ slope is increasing
    rsi: isNum(rsi[t]) ? rsi[t] : null,
    rsiPrev: isNum(rsi[t - 1]) ? rsi[t - 1] : null,
    relVol: isNum(vol0) && isNum(volAvg) && volAvg > 0 ? vol0 / volAvg : null,
    series: {
      time: keep(candles.map(c => c.t)),
      close: keep(closes),
      macd: keep(macd),
      signal: keep(signal),
      hist: keep(hist),
      rsi: keep(rsi),
    },
  };
}

/**
 * Applies the user's thresholds to one candle's indicator values.
 * Shared by the live screen and the backtest so both use identical rules.
 */
function classify(m, s) {
  // --- MACD curl conditions ---
  const below = m.gap < 0;
  const rising = m.slope > 0;
  const accelerating = m.accel > 0;
  const shrinking = below && m.gapVelocity > 0;

  // BarsToCross = -Gap / GapVelocity, only when Gap < 0 and GapVelocity > 0
  let barsToCross = null;
  if (below && m.gapVelocity > CONFIG.EPS) {
    const v = -m.gap / m.gapVelocity;
    if (isNum(v) && v >= 0) barsToCross = v;
  }
  const btcInRange = barsToCross !== null && barsToCross >= s.minBtc && barsToCross <= s.maxBtc;

  // --- RSI ---
  const rsiValid = isNum(m.rsi) && isNum(m.rsiPrev);
  const rsiInRange = rsiValid && m.rsi >= s.rsiMin && m.rsi <= s.rsiMax;
  const rsiRising = rsiValid && m.rsi > m.rsiPrev;
  const rsiOk = rsiInRange && rsiRising;

  // --- Volume: Volume > VolumeSMA20 (relVol > 1) and relVol ≥ minimum ---
  const relVol = isNum(m.relVol) ? m.relVol : null;
  const volOk = relVol !== null && relVol > 1 && relVol >= s.minRelVol;

  // --- Setup Strength (0–100). Only scored when MACD is below Signal. ---
  let raw = 0;
  if (below) {
    if (rising) raw += 20;
    if (accelerating) raw += 20;
    if (shrinking) raw += 20;
    if (btcInRange) raw += 20;
    if (rsiOk) raw += 10;
    if (s.volumeFilter && volOk) raw += 10;
  }
  const score = s.volumeFilter ? raw : Math.round((raw / 90) * 100);

  // --- Status ---
  let status;
  if (below && rising && shrinking && btcInRange && rsiOk && (!s.volumeFilter || volOk)) status = 'curl';
  else if (below && rising && shrinking) status = 'approaching';
  else status = 'none';

  return {
    below, rising, accelerating, shrinking, barsToCross, btcInRange,
    rsiValid, rsiInRange, rsiRising, rsiOk, relVol, volOk, score, status,
  };
}

function evaluate(m, s) {
  if (![m.price, m.macd, m.signal, m.gap, m.gapVelocity, m.slope, m.accel].every(isNum) || m.price <= 0) {
    throw new ScreenerError('Incomplete indicator data', 'nan');
  }
  const c = classify(m, s);

  // --- Warnings ---
  const warnings = [];
  const recommended = s.timeframe === '1D' ? 200 : 100;
  if (isNum(m.candleCount) && m.candleCount < recommended) {
    warnings.push(`Only ${m.candleCount} candles available (≥${recommended} recommended). EMA values may differ slightly from charting platforms.`);
  }
  if (c.relVol === null) warnings.push('Volume data is missing for this ticker/timeframe, so relative volume is unavailable.');
  const ageDays = candleAgeDays(m.time);
  if (ageDays !== null && ageDays > 5) {
    warnings.push(`The latest candle is ${Math.floor(ageDays)} days old. The ticker may be halted or delisted, or the data delayed.`);
  }

  const checks = buildChecks({
    ...c, s, slope: m.slope, accel: m.accel, gap0: m.gap, gapVelocity: m.gapVelocity, rsi0: m.rsi,
  });

  return {
    ...m,
    relVol: c.relVol,
    histogram: m.gap,
    normalizedGap: (m.gap / m.price) * 100,
    barsToCross: c.barsToCross,
    score: c.score,
    scoreNoVolume: !s.volumeFilter,
    status: c.status,
    checks,
    warnings,
    settings: { ...s },
  };
}

/** Full pipeline for raw candles (watchlist mode). */
function analyze(candles, s) {
  return evaluate(computeMetrics(candles, s), s);
}

/* =========================================================================
 * 4b. BACKTEST
 *
 * Replays the signal rules candle by candle over the downloaded history.
 * EMA, RSI and SMA only use past candles, so the values at candle i are
 * exactly what the screener would have shown at candle i (no look-ahead).
 *
 *   Entry:   the NEXT candle's open (you can only act after a candle closes)
 *   Return:  close h candles after the signal ÷ entry − 1, for h = 5, 10, 20
 *   Cross:   did MACD close above Signal within 10 candles?
 *   Dip:     lowest low within 10 candles ÷ entry − 1 (useful for stop placement)
 *   Repeats: a signal counts only when it newly appears, and not within
 *            5 candles of the previous one of the same type.
 *   Baseline: the same forward returns measured from EVERY candle, to show
 *            what "any day" looked like over the same period.
 * ========================================================================= */
const BT = {
  HORIZONS: [5, 10, 20],
  COOLDOWN: 5,
  CROSS_WINDOW: 10,
  DIP_WINDOW: 10,
  WARMUP_EXTRA: 20,   // extra candles after the indicators start, so EMAs settle before testing
};

function backtestCandles(candles, s) {
  const out = { signals: [], baseline: {}, from: null, to: null };
  BT.HORIZONS.forEach(h => { out.baseline[h] = []; });
  const n = Array.isArray(candles) ? candles.length : 0;
  const start = s.slow + s.signal + BT.WARMUP_EXTRA;
  if (n < start + 2) return out;

  const closes = candles.map(c => c.c);
  const opens = candles.map(c => (isNum(c.o) && c.o > 0 ? c.o : c.c));
  const lows = candles.map(c => (isNum(c.l) && c.l > 0 ? c.l : c.c));
  const vols = candles.map(c => c.v);
  const { macd, hist } = computeMACD(closes, s.fast, s.slow, s.signal);
  const rsi = rsiWilder(closes, s.rsiLen);
  const volSma = sma(vols, CONFIG.VOLUME_SMA);

  const lastCounted = { curl: -Infinity, approaching: -Infinity };
  let prevStatus = 'none';

  for (let i = start; i < n; i++) {
    const m = {
      gap: hist[i],
      gapVelocity: hist[i] - hist[i - 1],
      slope: macd[i] - macd[i - 1],
      accel: (macd[i] - macd[i - 1]) - (macd[i - 1] - macd[i - 2]),
      rsi: isNum(rsi[i]) ? rsi[i] : null,
      rsiPrev: isNum(rsi[i - 1]) ? rsi[i - 1] : null,
      relVol: isNum(vols[i]) && isNum(volSma[i]) && volSma[i] > 0 ? vols[i] / volSma[i] : null,
    };
    if (![m.gap, m.gapVelocity, m.slope, m.accel].every(isNum)) { prevStatus = 'none'; continue; }
    if (out.from === null) out.from = candles[i].t;
    out.to = candles[i].t;

    const entry = i + 1 < n ? opens[i + 1] : null;
    const r = {};
    for (const h of BT.HORIZONS) {
      r[h] = entry && i + h < n ? (closes[i + h] / entry - 1) * 100 : null;
      if (r[h] !== null) out.baseline[h].push(r[h]);
    }

    const c = classify(m, s);
    const isNew = c.status !== 'none' && c.status !== prevStatus && i - lastCounted[c.status] > BT.COOLDOWN;
    prevStatus = c.status;
    if (!isNew) continue;
    lastCounted[c.status] = i;

    let dip = null;
    if (entry && i + BT.DIP_WINDOW < n) {
      let lo = Infinity;
      for (let j = i + 1; j <= i + BT.DIP_WINDOW; j++) lo = Math.min(lo, lows[j]);
      dip = (lo / entry - 1) * 100;
    }

    // Bars until MACD closed above Signal: number, -1 = not within the window, null = not known yet.
    let crossBars = null;
    for (let j = i + 1; j < n && j <= i + BT.CROSS_WINDOW; j++) {
      if (isNum(hist[j]) && hist[j] > 0) { crossBars = j - i; break; }
    }
    if (crossBars === null && i + BT.CROSS_WINDOW < n) crossBars = -1;

    out.signals.push({ t: candles[i].t, type: c.status, predicted: c.barsToCross, r, crossBars, dip });
  }
  return out;
}

function median(values) {
  if (!values.length) return null;
  const a = Float64Array.from(values).sort();
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function summarizeReturns(values) {
  const v = values.filter(isNum);
  if (!v.length) return { n: 0, winRate: null, avg: null, median: null };
  let up = 0, sum = 0;
  for (const x of v) { if (x > 0) up++; sum += x; }
  return { n: v.length, winRate: (up / v.length) * 100, avg: sum / v.length, median: median(v) };
}

function summarizeSignals(signals, type) {
  const list = signals.filter(x => x.type === type);
  const horizons = {};
  for (const h of BT.HORIZONS) horizons[h] = summarizeReturns(list.map(x => x.r[h]));
  const decided = list.filter(x => x.crossBars !== null);
  const crossed = decided.filter(x => x.crossBars > 0);
  const dips = list.map(x => x.dip).filter(isNum);
  return {
    count: list.length,
    horizons,
    crossDecided: decided.length,
    crossed: crossed.length,
    crossRate: decided.length ? (crossed.length / decided.length) * 100 : null,
    medianCrossBars: median(crossed.map(x => x.crossBars)),
    avgDip: dips.length ? dips.reduce((a, b) => a + b, 0) / dips.length : null,
  };
}

function thresholdsOf(s) {
  return { rsiMin: s.rsiMin, rsiMax: s.rsiMax, minBtc: s.minBtc, maxBtc: s.maxBtc, volumeFilter: !!s.volumeFilter, minRelVol: s.minRelVol };
}

/** Combines many per-stock backtests into one market-wide summary. */
function summarizeBacktest(results, s) {
  const signals = [];
  const base = {};
  BT.HORIZONS.forEach(h => { base[h] = []; });
  let from = null, to = null, stocks = 0;
  for (const r of results) {
    if (!r || r.from === null) continue;
    stocks++;
    for (const sig of r.signals) signals.push(sig);
    for (const h of BT.HORIZONS) { const arr = r.baseline[h]; for (let k = 0; k < arr.length; k++) base[h].push(arr[k]); }
    if (from === null || r.from < from) from = r.from;
    if (to === null || r.to > to) to = r.to;
  }
  const baseline = {};
  for (const h of BT.HORIZONS) baseline[h] = summarizeReturns(base[h]);
  return {
    version: 1,
    horizons: BT.HORIZONS,
    cooldown: BT.COOLDOWN,
    crossWindow: BT.CROSS_WINDOW,
    dipWindow: BT.DIP_WINDOW,
    thresholds: thresholdsOf(s),
    stocks,
    from,
    to,
    curl: summarizeSignals(signals, 'curl'),
    approaching: summarizeSignals(signals, 'approaching'),
    baseline,
  };
}

/* Compact form for the published per-stock signal file. */
const r2 = x => (isNum(x) ? Math.round(x * 100) / 100 : null);
function packSignal(x) {
  return [x.t, x.type === 'curl' ? 'c' : 'a', isNum(x.predicted) ? Math.round(x.predicted * 10) / 10 : null,
    ...BT.HORIZONS.map(h => r2(x.r[h])), x.crossBars, r2(x.dip)];
}
function unpackSignal(a) {
  const r = {};
  BT.HORIZONS.forEach((h, k) => { r[h] = a[3 + k]; });
  const k = 3 + BT.HORIZONS.length;
  return { t: a[0], type: a[1] === 'c' ? 'curl' : 'approaching', predicted: a[2], r, crossBars: a[k], dip: a[k + 1] };
}

function candleAgeDays(t) {
  const d = new Date(String(t).replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / 86400000;
}

function buildChecks(x) {
  const c = [];
  const s = x.s;
  c.push(x.rising
    ? { state: 'ok', text: `MACD is rising (slope ${fmtSigned(x.slope)})` }
    : { state: 'fail', text: `MACD is not rising (slope ${fmtSigned(x.slope)})` });
  c.push(x.accelerating
    ? { state: 'ok', text: `MACD acceleration is positive (${fmtSigned(x.accel)})` }
    : { state: 'fail', text: `MACD acceleration is not positive (${fmtSigned(x.accel)}) — preferred, not required` });
  c.push(x.below
    ? { state: 'ok', text: `MACD remains below Signal (gap ${fmtSigned(x.gap0)})` }
    : { state: 'fail', text: `MACD is at or above Signal (gap ${fmtSigned(x.gap0)}) — the setup requires MACD below Signal` });
  c.push(x.shrinking
    ? { state: 'ok', text: `MACD/Signal gap is shrinking (${fmtSigned(x.gapVelocity)} per candle)` }
    : { state: 'fail', text: x.below
        ? `MACD/Signal gap is not shrinking (${fmtSigned(x.gapVelocity)} per candle)`
        : 'Gap shrinking not applicable (MACD is not below Signal)' });
  if (x.barsToCross === null) {
    c.push({ state: 'fail', text: 'Estimated crossover: not available (gap is not closing)' });
  } else if (x.btcInRange) {
    c.push({ state: 'ok', text: `Estimated crossover: ${x.barsToCross.toFixed(1)} candles (range ${s.minBtc}–${s.maxBtc})` });
  } else {
    c.push({ state: 'fail', text: `Estimated crossover: ${x.barsToCross.toFixed(1)} candles — outside range ${s.minBtc}–${s.maxBtc}` });
  }
  if (!x.rsiValid) {
    c.push({ state: 'fail', text: 'RSI not available' });
  } else {
    const r = x.rsi0.toFixed(1);
    if (x.rsiInRange && x.rsiRising) c.push({ state: 'ok', text: `RSI = ${r} and rising (range ${s.rsiMin}–${s.rsiMax})` });
    else if (!x.rsiInRange) c.push({ state: 'fail', text: `RSI = ${r} — outside range ${s.rsiMin}–${s.rsiMax}${x.rsiRising ? ' (rising)' : ' (falling)'}` });
    else c.push({ state: 'fail', text: `RSI = ${r} is in range but not rising` });
  }
  const rv = x.relVol === null ? 'n/a' : `${x.relVol.toFixed(2)}x`;
  if (!s.volumeFilter) c.push({ state: 'info', text: `Relative volume = ${rv} (volume filter off, informational only)` });
  else if (x.volOk) c.push({ state: 'ok', text: `Relative volume = ${rv} (min ${s.minRelVol}x, above 20-period average)` });
  else c.push({ state: 'fail', text: `Relative volume = ${rv} — below required ${s.minRelVol}x / 20-period average` });
  return c;
}

/* ---------- Formatting ---------- */
function fmtNum(x) {
  if (!isNum(x)) return '—';
  const a = Math.abs(x);
  if (a === 0) return '0';
  if (a >= 100) return x.toFixed(2);
  if (a >= 1) return x.toFixed(3);
  if (a >= 0.001) return x.toFixed(4);
  return x.toExponential(2);
}
function fmtSigned(x) { if (!isNum(x)) return '—'; return (x > 0 ? '+' : '') + fmtNum(x); }
function fmtPrice(x) { if (!isNum(x)) return '—'; return x >= 1 ? x.toFixed(2) : x.toPrecision(4); }
function fmtPct(x) { if (!isNum(x)) return '—'; return (x > 0 ? '+' : '') + x.toFixed(3) + '%'; }
function fmtInt(x) { return isNum(x) ? Math.round(x).toLocaleString() : '—'; }
function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || '—');
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* =========================================================================
 * 4c. SWING SETUPS: Uptrend Dip (long) and Downtrend Rip (short)
 *
 * Rules found and validated in the 1996-2026 S&P 500 study (explore 2000-2012,
 * check 2013-2018, final test 2019-2026). Daily candles only.
 *
 * Uptrend Dip:   close > 200-day SMA, down >= 10% over 5 sessions, and
 *                (closed in the bottom 20% of the day's range OR new 20-day
 *                closing low OR 3 lower closes in a row).
 * Downtrend Rip: close < 200-day SMA, up >= 10% over 5 sessions, RSI(14) >= 70.
 *
 * Trade plan (tested): enter at the next session's open; target 1.5 x ATR(14);
 * disaster stop 3 x ATR(14); exit at the close of the 3rd session.
 * Late entry (one session late) only if day 1 moved against the bounce:
 * dip -> day 1 closed below its open; rip -> day 1 closed above its open.
 * ========================================================================= */
const SETUP = { HOLD: 3, CHASE: 0.02, TARGET_ATR: 1.5, STOP_ATR: 3, LOOKBACK: 6, MIN_PRICE: 5 };

// NYSE full-day holidays (update once a year).
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/** Trading session `k` sessions after YYYY-MM-DD (skips weekends and NYSE holidays). */
function addSessions(dateStr, k) {
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00Z');
  let n = 0, s = String(dateStr).slice(0, 10);
  while (n < k) {
    d.setUTCDate(d.getUTCDate() + 1);
    s = d.toISOString().slice(0, 10);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !MARKET_HOLIDAYS.has(s)) n++;
  }
  return s;
}

function setupIndicators(candles) {
  const o = candles.map(x => x.o), h = candles.map(x => x.h), l = candles.map(x => x.l), c = candles.map(x => x.c);
  const v = candles.map(x => (isNum(x.v) ? x.v : NaN));
  const tr = c.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
  return { o, h, l, c, v, vsma: sma(v, CONFIG.VOLUME_SMA), s200: sma(c, 200), rsi: rsiWilder(c, 14), atr: sma(tr, 14) };
}

/** Setup flags for candle i (null if not enough history). */
function setupFlags(ind, i) {
  const { h, l, c, v, vsma, s200, rsi, atr } = ind;
  if (i < 200 || !isNum(s200[i]) || !isNum(atr[i]) || !isNum(c[i - 5]) || c[i - 5] <= 0) return null;
  const r5 = c[i] / c[i - 5] - 1;
  const rng = h[i] - l[i];
  const clv = rng > 0 ? (c[i] - l[i]) / rng : 0.5;
  let prior20min = Infinity;
  for (let k = i - 20; k < i; k++) prior20min = Math.min(prior20min, c[k]);
  const newLow20 = c[i] < prior20min;
  const down3 = c[i] < c[i - 1] && c[i - 1] < c[i - 2] && c[i - 2] < c[i - 3];
  const bottom20 = clv <= 0.2;
  const priceOk = c[i] >= SETUP.MIN_PRICE;
  return {
    dip: priceOk && c[i] > s200[i] && r5 <= -0.10 && (bottom20 || newLow20 || down3),
    rip: priceOk && c[i] < s200[i] && r5 >= 0.10 && isNum(rsi[i]) && rsi[i] >= 70,
    r5, clv, bottom20, newLow20, down3, vs200: c[i] / s200[i] - 1, rsi: rsi[i], atr: atr[i],
    relVol: isNum(v[i]) && isNum(vsma[i]) && vsma[i] > 0 ? v[i] / vsma[i] : null,
  };
}

/** Levels for a trade entered around `ref`: target 1.5 ATR, stop 3 ATR, 2% chase limit. */
function setupLevels(kind, ref, atr) {
  const long = kind === 'dip';
  return {
    ref,
    entryLimit: long ? ref * (1 + SETUP.CHASE) : ref * (1 - SETUP.CHASE),
    target: long ? ref + SETUP.TARGET_ATR * atr : ref - SETUP.TARGET_ATR * atr,
    stop: long ? ref - SETUP.STOP_ATR * atr : ref + SETUP.STOP_ATR * atr,
  };
}

/**
 * Follows a signal after it fired, assuming the tested entry (open of the next session).
 * Same-day target and stop -> stop assumed first (conservative); gaps past a level fill at the open.
 */
function trackSetup(kind, candles, i, atr) {
  const long = kind === 'dip';
  const n = candles.length;
  const after = n - 1 - i;
  if (after < 1) return { state: 'pending' };
  const entry = candles[i + 1].o;
  const lv = setupLevels(kind, entry, atr);
  const ret = px => (long ? px / entry - 1 : 1 - px / entry) * 100;
  const last = Math.min(after, SETUP.HOLD);
  for (let j = 1; j <= last; j++) {
    const k = candles[i + j];
    if (j > 1) {
      if (long ? k.o >= lv.target : k.o <= lv.target) return { state: 'target', day: j, entry, exit: k.o, pct: ret(k.o), levels: lv };
      if (long ? k.o <= lv.stop : k.o >= lv.stop) return { state: 'stop', day: j, entry, exit: k.o, pct: ret(k.o), levels: lv };
    }
    if (long ? k.l <= lv.stop : k.h >= lv.stop) return { state: 'stop', day: j, entry, exit: lv.stop, pct: ret(lv.stop), levels: lv };
    if (long ? k.h >= lv.target : k.l <= lv.target) return { state: 'target', day: j, entry, exit: lv.target, pct: ret(lv.target), levels: lv };
  }
  const lastClose = candles[i + last].c;
  if (after >= SETUP.HOLD) return { state: 'closed', day: SETUP.HOLD, entry, exit: lastClose, pct: ret(lastClose), levels: lv };
  return { state: 'open', day: after, entry, now: lastClose, pct: ret(lastClose), levels: lv };
}

/** Everything the app needs about one setup signal at candle i. */
function describeSetup(kind, candles, ind, i, f) {
  const n = candles.length;
  const signalDate = String(candles[i].t).slice(0, 10);
  const sessionsAgo = n - 1 - i;
  const out = {
    kind, signalDate, sessionsAgo,
    close: candles[i].c, chg5d: f.r5 * 100, rsi: f.rsi, vs200: f.vs200 * 100, atr: f.atr, atrPct: (f.atr / candles[i].c) * 100, relVol: f.relVol,
    reasons: kind === 'dip' ? [f.bottom20 && 'closed near the day’s low', f.newLow20 && 'new 20-day low', f.down3 && '3 down days in a row'].filter(Boolean) : [],
    levels: setupLevels(kind, candles[i].c, f.atr),
    entryDate: addSessions(signalDate, 1),
    exitDate: addSessions(signalDate, SETUP.HOLD),
    track: trackSetup(kind, candles, i, f.atr),
  };
  if (sessionsAgo === 1) {
    const d1 = candles[i + 1];
    const lateOk = kind === 'dip' ? d1.c < d1.o : d1.c > d1.o;
    out.late = {
      ok: lateOk, day1Open: d1.o, day1Close: d1.c,
      levels: setupLevels(kind, d1.c, f.atr),
      entryDate: addSessions(signalDate, 2),
      exitDate: addSessions(signalDate, SETUP.HOLD + 1),
    };
  }
  return out;
}

/** Scans the last SETUP.LOOKBACK completed daily candles of one stock. */
function scanSetups(candles) {
  const found = [];
  if (!Array.isArray(candles) || candles.length < 206) return found;
  const ind = setupIndicators(candles);
  const n = candles.length;
  for (let back = 0; back < SETUP.LOOKBACK; back++) {
    const i = n - 1 - back;
    const f = setupFlags(ind, i);
    if (!f) continue;
    if (f.dip) found.push(describeSetup('dip', candles, ind, i, f));
    if (f.rip) found.push(describeSetup('rip', candles, ind, i, f));
  }
  return found;
}

/* =========================================================================
 * 5. UI
 * ========================================================================= */
const STATUS_LABEL = {
  curl: 'Early Bullish Curl',
  approaching: 'Approaching Crossover',
  none: 'No Signal',
};
const SIGNAL_TEXT = {
  curl: 'EARLY BULLISH CURL',
  approaching: 'APPROACHING CROSSOVER',
  none: 'NO SIGNAL',
};
const DEFAULT_SORT_DIR = { score: 'desc', btc: 'asc', rsi: 'desc', relVol: 'desc', gap: 'desc', ticker: 'asc' };
const PERIOD_FIELDS = ['setFast', 'setSlow', 'setSignal', 'setRsiLen'];
const TIMEFRAMES = ['1D', '4H', '1H'];

// Strategy tabs, each with the same list sub-tabs underneath.
const STRATEGIES = { dip: 'Uptrend Dip', rip: 'Downtrend Rip', macd: 'MACD Curl' };
const DEFAULT_SUBVIEW = { dip: 'sp500', rip: 'sp500', macd: 'all' };   // Dip and Rip were tested on S&P 500 stocks
// Sort options per strategy: [key, label, default direction]
const SORTS = {
  macd: [['score', 'Setup Strength', 'desc'], ['btc', 'Bars To Cross', 'asc'], ['price', 'Price', 'desc'], ['relVol', 'Relative volume', 'desc'],
         ['rsi', 'RSI', 'desc'], ['gap', 'MACD Gap', 'desc'], ['ticker', 'Ticker', 'asc']],
  dip: [['vs200', 'Uptrend strength (vs 200-day)', 'desc'], ['chg5d', '5-day drop', 'asc'], ['price', 'Price', 'desc'], ['relVol', 'Relative volume', 'desc'],
        ['rsi', 'RSI', 'asc'], ['atrPct', 'Volatility (ATR %)', 'desc'], ['ticker', 'Ticker', 'asc']],
  rip: [['chg5d', '5-day rally', 'desc'], ['vs200', 'Downtrend depth (vs 200-day)', 'asc'], ['price', 'Price', 'desc'], ['relVol', 'Relative volume', 'desc'],
        ['rsi', 'RSI', 'desc'], ['atrPct', 'Volatility (ATR %)', 'desc'], ['ticker', 'Ticker', 'asc']],
};
// List sub-tabs. "index" views filter by index membership.
const VIEWS = {
  all: { label: 'All US' },
  watchlist: { label: 'Watchlist' },
  sp500: { label: 'S&P 500', index: 'sp500' },
  ndx: { label: 'Nasdaq-100', index: 'ndx' },
  dow: { label: 'Dow 30', index: 'dow' },
  sectors: { label: 'Sectors & themes' },
};

const SETTING_FIELDS = [
  ['fast', 'setFast', 'int'], ['slow', 'setSlow', 'int'], ['signal', 'setSignal', 'int'],
  ['rsiLen', 'setRsiLen', 'int'], ['rsiMin', 'setRsiMin', 'num'], ['rsiMax', 'setRsiMax', 'num'],
  ['minBtc', 'setMinBtc', 'num'], ['maxBtc', 'setMaxBtc', 'num'],
  ['volumeFilter', 'setVolFilter', 'bool'], ['minRelVol', 'setMinRelVol', 'num'],
  ['rpm', 'setRpm', 'int'], ['persistCache', 'setCache', 'bool'],
];

const state = {
  view: 'all',
  mode: 'market',                         // 'market' (scheduled scan) | 'watchlist' (live)
  group: null,                            // selected sector/theme on the Sectors tab
  timeframe: '1D',
  watchRows: new Map(),                   // ticker -> { ticker, status, result, error, candles, fromCache, bt }
  marketRows: new Map(),                  // ticker -> { ticker, status, result, error, metrics }
  marketFile: null,
  marketError: '',
  marketCache: new Map(),
  marketLoadToken: 0,
  universe: null,                         // names, indexes, sectors, themes (data/universe.json)
  universeLoading: null,
  scanning: false,
  scannedTimeframe: null,
  strategy: 'dip',
  subByStrategy: { ...DEFAULT_SUBVIEW },
  sort: { macd: { key: 'score', dir: 'desc' }, dip: { key: 'vs200', dir: 'desc' }, rip: { key: 'chg5d', dir: 'desc' } },
  statusFilter: { market: 'signals', watchlist: 'all' },
  findText: '',
  visibleLimit: CONFIG.PAGE_SIZE,
  layout: 'cards',
  openTicker: null,
  btFiles: new Map(),
  watchBacktest: null,
  detailMarkers: [],
  setups: null,
  setupsError: '',
  setupsLoading: null,
};
const sortOf = () => state.sort[state.strategy];
const isSetupStrategy = () => state.strategy !== 'macd';
const currentRows = () => (state.mode === 'market' ? state.marketRows : state.watchRows);

const els = {};
const $ = id => document.getElementById(id);
let lastSettingsKey = '';

function init() {
  [
    'openSettings', 'tabs', 'scanInfo', 'reloadMarket', 'watchPanel', 'tickerInput', 'addTicker', 'tickers',
    'scanBtn', 'stopBtn', 'clearBtn', 'watchKeyNote', 'groupHeader', 'sectorBoard', 'listArea', 'statChips',
    'btPanel', 'btHeadline', 'btBody', 'findTicker', 'sortKey', 'sortDir', 'layoutCards', 'layoutTable',
    'statusText', 'progressBar', 'emptyState', 'noMatch', 'resultsCards', 'resultsTable', 'resultsBody',
    'shownCount', 'showMore', 'settingsSheet', 'closeSettings', 'settingsError', 'periodsHint',
    'providerSelect', 'apiKey', 'saveKey', 'keyStatus', 'forgetKey', 'clearCacheBtn', 'resetSettings',
    'detail', 'detailBody', 'detailClose', 'setupArea', 'tfSwitch', 'strategyTabs', 'toolbar', 'statusRow', 'strategyIntro', 'layoutToggle',
  ].forEach(id => { els[id] = $(id); });
  SETTING_FIELDS.forEach(([, id]) => { els[id] = $(id); });

  // Providers
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = p.label;
    els.providerSelect.appendChild(opt);
  }
  const savedProvider = storage.get('provider');
  if (savedProvider && PROVIDERS[savedProvider]) activeProviderId = savedProvider;
  els.providerSelect.value = activeProviderId;

  // Restore settings, tickers, layout
  const saved = loadSavedSettings();
  applySettingsToForm(saved);
  state.timeframe = TIMEFRAMES.includes(saved.timeframe) ? saved.timeframe : '1D';
  syncTimeframeUI();
  persistCache = saved.persistCache;
  requestsPerMinute = saved.rpm;
  els.tickers.value = storage.get('tickers') ?? 'AAPL, NVDA, AMD, PLTR, BBAI, TSLA';
  state.layout = storage.get('layout') === 'table' ? 'table' : 'cards';
  try {
    const saved = JSON.parse(storage.get('sort') || 'null');
    if (saved) for (const k of Object.keys(state.sort)) if (saved[k] && SORTS[k].some(o => o[0] === saved[k].key)) state.sort[k] = saved[k];
    const subs = JSON.parse(storage.get('subviews') || 'null');
    if (subs) for (const k of Object.keys(STRATEGIES)) if (VIEWS[subs[k]]) state.subByStrategy[k] = subs[k];
  } catch { /* ignore */ }
  updateKeyStatus();

  // Tabs & timeframe
  els.tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });
  document.querySelectorAll('input[name="tf"]').forEach(r => {
    r.addEventListener('change', () => { if (r.checked) setTimeframe(r.value); });
  });
  els.strategyTabs.addEventListener('click', e => {
    const b = e.target.closest('[data-strategy]');
    if (b) setStrategy(b.dataset.strategy);
  });
  els.reloadMarket.addEventListener('click', () => {
    if (isSetupStrategy()) { loadUniverse(true); loadSetups(true); return; }
    if (state.mode !== 'market') return;
    state.btFiles.delete(state.timeframe);
    loadUniverse(true);
    loadMarket(state.timeframe, true);
  });

  // Filter chips
  els.statChips.addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    state.statusFilter[state.mode] = b.dataset.filter;
    state.visibleLimit = CONFIG.PAGE_SIZE;
    render();
  });

  // Settings sheet
  els.openSettings.addEventListener('click', () => openSheet(els.settingsSheet));
  els.closeSettings.addEventListener('click', () => closeSheet(els.settingsSheet));
  els.settingsSheet.addEventListener('click', e => { if (e.target === els.settingsSheet) closeSheet(els.settingsSheet); });

  // Watchlist
  els.addTicker.addEventListener('click', addTickerFromInput);
  els.tickerInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTickerFromInput(); } });
  els.tickers.addEventListener('input', () => storage.set('tickers', els.tickers.value));
  els.scanBtn.addEventListener('click', scan);
  els.stopBtn.addEventListener('click', () => { abortFlag = true; setStatus('Stopping…'); });
  els.clearBtn.addEventListener('click', clearAll);
  els.watchKeyNote.addEventListener('click', e => {
    if (e.target.closest('[data-open-key]')) { openSheet(els.settingsSheet); setTimeout(() => els.apiKey.focus(), 250); }
  });
  els.resetSettings.addEventListener('click', () => { applySettingsToForm(DEFAULT_SETTINGS); onSettingsChanged(); });

  // Provider & key
  els.providerSelect.addEventListener('change', () => {
    activeProviderId = els.providerSelect.value;
    storage.set('provider', activeProviderId);
    updateKeyStatus();
  });
  els.saveKey.addEventListener('click', () => {
    const key = els.apiKey.value.trim();
    if (!key) { els.keyStatus.textContent = 'Paste a key first.'; return; }
    storage.set('apikey', key);
    els.apiKey.value = '';
    updateKeyStatus();
  });
  els.forgetKey.addEventListener('click', () => { storage.remove('apikey'); els.apiKey.value = ''; updateKeyStatus(); });
  els.clearCacheBtn.addEventListener('click', () => { cache.clear(); setStatus('Cached data cleared. The next watchlist scan will download fresh candles.'); });

  // Settings inputs
  SETTING_FIELDS.forEach(([, id]) => {
    els[id].addEventListener('change', onSettingsChanged);
    if (els[id].type === 'number') els[id].addEventListener('input', debounce(onSettingsChanged, 400));
  });

  // Sorting, search, layout, paging
  els.sortKey.addEventListener('change', () => {
    const opt = SORTS[state.strategy].find(o => o[0] === els.sortKey.value);
    state.sort[state.strategy] = { key: els.sortKey.value, dir: opt ? opt[2] : 'desc' };
    storage.set('sort', JSON.stringify(state.sort));
    state.visibleLimit = CONFIG.PAGE_SIZE;
    render();
  });
  els.sortDir.addEventListener('click', () => {
    const so = sortOf(); so.dir = so.dir === 'asc' ? 'desc' : 'asc';
    storage.set('sort', JSON.stringify(state.sort));
    render();
  });
  els.findTicker.addEventListener('input', debounce(() => {
    state.findText = els.findTicker.value.trim().toUpperCase().replace(/^\$/, '');
    state.visibleLimit = CONFIG.PAGE_SIZE;
    render();
  }, 150));
  els.showMore.addEventListener('click', () => { state.visibleLimit += CONFIG.PAGE_SIZE; render(); });
  els.layoutCards.addEventListener('click', () => setLayout('cards'));
  els.layoutTable.addEventListener('click', () => setLayout('table'));
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      const so = state.sort.macd;
      if (so.key === key) so.dir = so.dir === 'asc' ? 'desc' : 'asc';
      else { so.key = key; so.dir = DEFAULT_SORT_DIR[key] || 'desc'; }
      storage.set('sort', JSON.stringify(state.sort));
      render();
    });
  });

  // Sectors & themes
  els.sectorBoard.addEventListener('click', e => {
    const tile = e.target.closest('[data-group]');
    if (!tile || !state.universe) return;
    state.group = state.universe.groupById.get(tile.dataset.group) || null;
    state.visibleLimit = CONFIG.PAGE_SIZE;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  els.groupHeader.addEventListener('click', e => {
    if (e.target.closest('[data-back]')) { state.group = null; render(); }
  });

  // Opening details
  const openFromEvent = e => {
    const el = e.target.closest('[data-ticker]');
    if (el) openDetail(el.dataset.ticker);
  };
  els.resultsBody.addEventListener('click', openFromEvent);
  els.resultsCards.addEventListener('click', openFromEvent);
  const keyOpen = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-ticker]')) { e.preventDefault(); openFromEvent(e); } };
  els.resultsBody.addEventListener('keydown', keyOpen);
  els.resultsCards.addEventListener('keydown', keyOpen);

  els.detailClose.addEventListener('click', closeDetail);
  els.detail.addEventListener('click', e => { if (e.target === els.detail) closeDetail(); });
  els.detailBody.addEventListener('click', e => {
    const btn = e.target.closest('[data-add-watch]');
    if (btn) addToWatchlist(btn.dataset.addWatch);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!els.detail.hidden) closeDetail();
    else if (!els.settingsSheet.hidden) closeSheet(els.settingsSheet);
  });

  const redrawOpenChart = () => {
    if (!state.openTicker) return;
    const row = currentRows().get(state.openTicker);
    if (row && row.result && row.result.series) drawChart($('detailChart'), row.result, state.detailMarkers);
  };
  window.addEventListener('resize', debounce(redrawOpenChart, 150));
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', redrawOpenChart);

  rateLimiter.onWait = ms => {
    if (state.scanning) setStatus(`Waiting ${Math.ceil(ms / 1000)} s for the API rate limit (${requestsPerMinute} requests/min)…`);
  };

  loadUniverse();
  const savedStrategy = storage.get('strategy');
  setStrategy(STRATEGIES[savedStrategy] ? savedStrategy : 'dip');
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------- Sheets ---------- */
function openSheet(el) {
  el.hidden = false;
  document.body.classList.add('no-scroll');
}
function closeSheet(el) {
  el.hidden = true;
  if (els.detail.hidden && els.settingsSheet.hidden) document.body.classList.remove('no-scroll');
}

/* ---------- Strategy, views, timeframe, layout ---------- */
function setStrategy(strategy) {
  if (!STRATEGIES[strategy]) strategy = 'dip';
  if (state.scanning) { setStatus('Stop the watchlist scan before switching.'); return; }
  state.strategy = strategy;
  storage.set('strategy', strategy);
  els.sortKey.innerHTML = SORTS[strategy].map(([k, label]) => `<option value="${k}">${escapeHtml(label)}</option>`).join('');
  els.strategyTabs.querySelectorAll('[data-strategy]').forEach(b => {
    const on = b.dataset.strategy === strategy;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  setView(state.subByStrategy[strategy] || DEFAULT_SUBVIEW[strategy], true);
}

function setView(view, keepScroll) {
  if (!VIEWS[view]) view = 'all';
  const mode = view === 'watchlist' ? 'watchlist' : 'market';
  if (state.scanning && (mode !== 'watchlist' || view !== state.view)) { setStatus('Stop the watchlist scan before switching.'); return; }
  state.view = view;
  state.mode = mode;
  state.group = null;
  state.visibleLimit = CONFIG.PAGE_SIZE;
  lastSettingsKey = '';
  state.subByStrategy[state.strategy] = view;
  storage.set('subviews', JSON.stringify(state.subByStrategy));
  closeDetail();
  PERIOD_FIELDS.forEach(id => { els[id].disabled = mode === 'market'; });
  updatePeriodsHint();

  const tab = els.tabs.querySelector(`[data-view="${view}"]`);
  if (tab && tab.scrollIntoView) tab.scrollIntoView({ block: 'nearest', inline: 'center' });

  if (isSetupStrategy()) {
    if (mode === 'market') loadSetups();
    else setStatus(state.watchRows.size ? '' : 'Add tickers and tap Scan watchlist. Setups use daily candles.');
    render();
    return;
  }
  if (mode === 'market') {
    if (!state.marketFile || state.marketFile.timeframe !== state.timeframe) loadMarket(state.timeframe);
    else { updateScanInfo(state.marketFile); setStatus(summaryText()); render(); }
  } else {
    setProgress(0);
    setStatus(state.watchRows.size ? summaryText() : 'Add tickers and tap Scan watchlist.');
    render();
  }
}

function setTimeframe(tf) {
  if (!TIMEFRAMES.includes(tf) || tf === state.timeframe) { syncTimeframeUI(); return; }
  state.timeframe = tf;
  syncTimeframeUI();
  onSettingsChanged();
}

function syncTimeframeUI() {
  document.querySelectorAll('input[name="tf"]').forEach(r => { r.checked = r.value === state.timeframe; });
}

function setLayout(layout) {
  state.layout = layout;
  storage.set('layout', layout);
  render();
}

function updatePeriodsHint() {
  if (state.mode !== 'market') {
    els.periodsHint.textContent = 'These periods apply to the Watchlist tab.';
    els.periodsHint.hidden = false;
    return;
  }
  const p = (state.marketFile && state.marketFile.params) || DEFAULT_SETTINGS;
  els.periodsHint.textContent = `The market-wide tabs use the periods fixed by the scheduled scan: MACD ${p.fast}/${p.slow}/${p.signal}, RSI ${p.rsiLen}. Use the Watchlist tab to try your own.`;
  els.periodsHint.hidden = false;
}

/* ---------- Universe: company names, indexes, sectors, themes ---------- */
function loadUniverse(force = false) {
  if (state.universeLoading && !force) return state.universeLoading;
  state.universeLoading = fetch(`${CONFIG.MARKET_DATA_DIR}universe.json`, { cache: 'no-cache' })
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null)
    .then(u => {
      state.universe = u && typeof u === 'object' ? indexUniverse(u) : null;
      if (state.group && state.universe) state.group = state.universe.groupById.get(state.group.id) || null;
      render();
      if (state.openTicker) openDetail(state.openTicker);
      return state.universe;
    });
  return state.universeLoading;
}

function indexUniverse(u) {
  const out = {
    raw: u,
    names: u.names || {},
    sectorOf: u.sectorOf || {},
    indexSets: {},
    indexLabels: {},
    indexesOf: new Map(),
    themesOf: new Map(),
    groups: [],
    groupById: new Map(),
  };
  for (const [key, ix] of Object.entries(u.indexes || {})) {
    if (!ix || !Array.isArray(ix.tickers) || !ix.tickers.length) continue;
    out.indexSets[key] = new Set(ix.tickers);
    out.indexLabels[key] = ix.label || key;
    for (const t of ix.tickers) {
      if (!out.indexesOf.has(t)) out.indexesOf.set(t, []);
      out.indexesOf.get(t).push(ix.label || key);
    }
  }
  const bySector = new Map();
  for (const [t, sec] of Object.entries(out.sectorOf)) {
    if (!bySector.has(sec)) bySector.set(sec, new Set());
    bySector.get(sec).add(t);
  }
  for (const sec of u.sectors || []) {
    const g = { id: `sector:${sec.key}`, kind: 'sector', label: sec.label || sec.key, etf: sec.etf || null, tickers: bySector.get(sec.key) || new Set() };
    if (g.tickers.size) { out.groups.push(g); out.groupById.set(g.id, g); }
  }
  for (const th of u.themes || []) {
    if (!th || !Array.isArray(th.tickers)) continue;
    const g = { id: `theme:${th.key}`, kind: 'theme', label: th.label || th.key, etf: th.etf || null, note: th.note || '', tickers: new Set(th.tickers) };
    out.groups.push(g);
    out.groupById.set(g.id, g);
    for (const t of th.tickers) {
      if (!out.themesOf.has(t)) out.themesOf.set(t, []);
      out.themesOf.get(t).push(g.label);
    }
  }
  return out;
}

function companyName(t) {
  return (state.universe && state.universe.names[t]) || '';
}

function tagInfo(t) {
  const u = state.universe;
  if (!u) return { sector: '', indexes: [], themes: [] };
  return { sector: u.sectorOf[t] || '', indexes: u.indexesOf.get(t) || [], themes: u.themesOf.get(t) || [] };
}

/* ---------- Market scan results ---------- */
async function loadMarket(tf, force = false) {
  const token = ++state.marketLoadToken;
  let file = force ? null : state.marketCache.get(tf);

  if (!file) {
    setStatus(`Loading the latest ${tf} scan…`);
    els.scanInfo.textContent = 'Loading…';
    try {
      const res = await fetch(`${CONFIG.MARKET_DATA_DIR}${tf}.json`, { cache: 'no-cache' });
      if (res.status === 404) throw new ScreenerError(`No ${tf} scan results have been published yet.`, 'missing');
      if (!res.ok) throw new ScreenerError(`Could not load ${tf} scan results (HTTP ${res.status}).`, 'api');
      file = await res.json();
      if (!file || !Array.isArray(file.rows)) throw new ScreenerError('The scan results file is malformed.', 'api');
      state.marketCache.set(tf, file);
    } catch (e) {
      if (token !== state.marketLoadToken || state.mode !== 'market') return;
      state.marketFile = null;
      state.marketRows = new Map();
      state.marketError = e instanceof ScreenerError ? e.message : `Could not load scan results: ${e.message || e}`;
      els.scanInfo.textContent = state.marketError;
      setStatus('');
      render();
      return;
    }
  }
  if (token !== state.marketLoadToken || state.mode !== 'market') return;

  const s = readSettings();
  if (!s) return;
  state.marketFile = file;
  state.marketError = file.error && file.rows.length === 0 ? `The latest scheduled scan failed: ${file.error}` : '';
  buildMarketRows(file, s);
  updateScanInfo(file);
  updatePeriodsHint();
  setStatus(state.marketError ? '' : summaryText());
  render();
  if (state.openTicker) openDetail(state.openTicker);
}

function marketSettings(s, file) {
  return { ...s, ...(file.params || {}), timeframe: file.timeframe };
}

function buildMarketRows(file, s) {
  const ms = marketSettings(s, file);
  const rows = new Map();
  for (const r of file.rows) {
    if (!r || typeof r.ticker !== 'string') continue;
    const metrics = { ...r, series: file.series && file.series[r.ticker] ? file.series[r.ticker] : null };
    const row = { ticker: r.ticker, metrics };
    try { row.result = evaluate(metrics, ms); row.status = 'done'; }
    catch (e) { row.status = 'error'; row.error = errorMessage(e); }
    rows.set(r.ticker, row);
  }
  state.marketRows = rows;
}

function updateScanInfo(file) {
  const u = file.universe || {};
  const parts = [`Updated ${fmtDateTime(file.generatedAt)}, ${fmtInt(u.analyzed)} stocks scanned, completed candles only.`];
  if (file.timeframe !== '1D') parts.push('1H/4H cover the most-traded stocks plus index and theme members.');
  if (file.stale) parts.push(`⚠ The latest scan failed (${file.staleReason || 'unknown error'}); showing the previous results.`);
  const ageDays = (Date.now() - new Date(file.generatedAt).getTime()) / 86400000;
  if (ageDays > 4) parts.push(`⚠ These results are ${Math.floor(ageDays)} days old. Check that the GitHub Action is still running.`);
  els.scanInfo.textContent = parts.join(' ');
}

/* ---------- Settings ---------- */
function loadSavedSettings() {
  try {
    const saved = JSON.parse(storage.get('settings') || 'null');
    return { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

function applySettingsToForm(s) {
  for (const [key, id, type] of SETTING_FIELDS) {
    if (type === 'bool') els[id].checked = !!s[key];
    else els[id].value = s[key];
  }
}

function readSettings() {
  const s = { timeframe: state.timeframe };
  const errors = [];
  for (const [key, id, type] of SETTING_FIELDS) {
    const el = els[id];
    if (type === 'bool') { s[key] = el.checked; continue; }
    const raw = String(el.value).trim();
    const v = Number(raw);
    const labelEl = el.closest('label') && el.closest('label').querySelector('span');
    const label = labelEl ? labelEl.textContent.trim() : key;
    if (raw === '' || !isNum(v)) { errors.push(`${label} must be a number.`); continue; }
    s[key] = type === 'int' ? Math.round(v) : v;
  }
  if (!errors.length) {
    if (s.fast < 1 || s.slow < 2 || s.signal < 1) errors.push('MACD periods must be positive.');
    if (s.fast >= s.slow) errors.push('MACD fast must be smaller than MACD slow.');
    if (s.rsiLen < 2) errors.push('RSI length must be at least 2.');
    if (s.rsiMin < 0 || s.rsiMax > 100 || s.rsiMin > s.rsiMax) errors.push('RSI range must be within 0–100, with min ≤ max.');
    if (s.minBtc < 0 || s.minBtc > s.maxBtc) errors.push('Bars to cross: min must be ≥ 0 and not greater than max.');
    if (s.minRelVol < 0) errors.push('Minimum relative volume must be 0 or more.');
    if (s.rpm < 1) errors.push('Requests / minute must be at least 1.');
    if (s.slow + s.signal + 3 > CONFIG.CANDLES_TO_FETCH) errors.push('Slow + Signal periods are too large for the downloaded history.');
    if (state.mode === 'watchlist' && !PROVIDERS[activeProviderId].intervals[s.timeframe]) {
      errors.push(`${PROVIDERS[activeProviderId].label} does not support ${s.timeframe}.`);
    }
  }
  if (errors.length) {
    els.settingsError.innerHTML = errors.map(escapeHtml).join('<br>');
    els.settingsError.hidden = false;
    setStatus('Some settings need fixing. Open Filters & settings.');
    return null;
  }
  els.settingsError.hidden = true;
  return s;
}

function onSettingsChanged() {
  const s = readSettings();
  if (!s) return;
  // Inputs fire both "input" and "change" (on blur). Skip repeats so the list
  // isn't redrawn mid-tap, which would swallow the tap.
  const key = `${state.mode}|${JSON.stringify(s)}`;
  if (key === lastSettingsKey) return;
  lastSettingsKey = key;
  storage.set('settings', JSON.stringify(s));
  persistCache = s.persistCache;
  requestsPerMinute = s.rpm;
  if (isSetupStrategy()) { render(); return; }   // Dip / Rip rules are fixed by the research

  if (state.mode === 'market') {
    if (!state.marketFile || state.marketFile.timeframe !== s.timeframe) { loadMarket(s.timeframe); return; }
    buildMarketRows(state.marketFile, s);
    setStatus(summaryText());
    render();
    if (state.openTicker) openDetail(state.openTicker);
    return;
  }

  if (state.scanning || state.watchRows.size === 0) { render(); return; }
  if (s.timeframe !== state.scannedTimeframe) {
    setStatus(`Timeframe changed to ${s.timeframe}. Tap Scan watchlist to load ${s.timeframe} candles.`);
    return;
  }
  // Re-score from already-downloaded candles, no new API calls.
  for (const row of state.watchRows.values()) {
    if (!row.candles) continue;
    try { row.result = analyze(row.candles, s); row.status = 'done'; row.error = null; }
    catch (e) { row.result = null; row.status = 'error'; row.error = errorMessage(e); }
  }
  refreshWatchBacktest(s);
  render();
  setStatus(summaryText() + ' Re-scored with new settings (no new downloads).');
  if (state.openTicker) openDetail(state.openTicker);
}

function updateKeyStatus() {
  const p = PROVIDERS[activeProviderId];
  const hasKey = !!storage.get('apikey');
  els.keyStatus.textContent = hasKey ? `A key is saved in this browser for ${p.label}.` : `No key saved. ${p.keyHelp}`;
  els.forgetKey.hidden = !hasKey;
  els.watchKeyNote.className = hasKey ? 'key-note' : 'key-note warn';
  els.watchKeyNote.innerHTML = hasKey
    ? `Live data from ${escapeHtml(p.label)} with your saved key.`
    : `No ${escapeHtml(p.label)} key saved, so only AAPL will load. <button type="button" class="btn btn-small" data-open-key>Add free key</button>`;
}

/* ---------- Tickers ---------- */
function parseTickers(text) {
  const parts = String(text).toUpperCase().split(/[\s,;]+/).map(t => t.replace(/^\$/, '')).filter(Boolean);
  const valid = [], invalid = [], seen = new Set();
  for (const t of parts) {
    if (seen.has(t)) continue;
    seen.add(t);
    (/^[A-Z0-9][A-Z0-9.\-:/]{0,14}$/.test(t) ? valid : invalid).push(t);
  }
  return { valid, invalid };
}

function addTickerFromInput() {
  const { valid } = parseTickers(els.tickerInput.value);
  if (!valid.length) return;
  const existing = parseTickers(els.tickers.value).valid;
  const merged = [...existing, ...valid.filter(t => !existing.includes(t))];
  els.tickers.value = merged.join(', ');
  storage.set('tickers', els.tickers.value);
  els.tickerInput.value = '';
  els.tickerInput.focus();
}

function addToWatchlist(ticker) {
  const existing = parseTickers(els.tickers.value).valid;
  if (!existing.includes(ticker)) els.tickers.value = [...existing, ticker].join(', ');
  storage.set('tickers', els.tickers.value);
  setView('watchlist');
  setStatus(`${ticker} is in your watchlist. Tap Scan watchlist to load its live data and chart.`);
}

function clearAll() {
  if (state.scanning) abortFlag = true;
  els.tickers.value = '';
  storage.set('tickers', '');
  state.watchRows.clear();
  state.watchBacktest = null;
  closeDetail();
  setProgress(0);
  setStatus('Cleared. Add tickers and tap Scan watchlist.');
  render();
}

/* ---------- Watchlist scan ---------- */
function errorMessage(e) {
  if (e instanceof ScreenerError) return e.message;
  return 'Unexpected error: ' + (e && e.message ? e.message : String(e));
}

async function runPool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !abortFlag) {
      const idx = next++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function scan() {
  if (state.scanning || state.mode !== 'watchlist') return;
  const s = readSettings();
  if (!s) return;
  storage.set('settings', JSON.stringify(s));
  persistCache = s.persistCache;
  requestsPerMinute = s.rpm;

  const { valid, invalid } = parseTickers(els.tickers.value);
  if (!valid.length && !invalid.length) { setStatus('Enter at least one ticker.'); return; }

  state.watchRows = new Map();
  closeDetail();
  for (const t of invalid) state.watchRows.set(t, { ticker: t, status: 'error', error: 'Invalid ticker format' });
  for (const t of valid) state.watchRows.set(t, { ticker: t, status: 'pending' });

  const tf = isSetupStrategy() ? '1D' : s.timeframe;   // Dip / Rip are daily-candle setups
  const sc = { ...s, timeframe: tf };
  state.scanning = true;
  state.scannedTimeframe = tf;
  abortFlag = false;
  els.scanBtn.disabled = true;
  els.stopBtn.hidden = false;
  setProgress(0);
  setStatus(`Scanning ${valid.length} ticker${valid.length === 1 ? '' : 's'} on ${tf}…`);
  render();

  let done = 0;
  await runPool(valid, CONFIG.CONCURRENCY, async ticker => {
    const row = state.watchRows.get(ticker);
    row.status = 'loading';
    scheduleRender();
    try {
      const { candles, fromCache } = await fetchHistoricalData(ticker, tf);
      row.candles = candles;
      row.fromCache = fromCache;
      row.result = analyze(candles, sc);
      row.status = 'done';
    } catch (e) {
      row.status = e instanceof ScreenerError && e.kind === 'aborted' ? 'skipped' : 'error';
      row.error = errorMessage(e);
    }
    done++;
    setProgress(done / valid.length);
    if (!abortFlag) setStatus(`Scanned ${done} of ${valid.length}…`);
    scheduleRender();
  });

  for (const row of state.watchRows.values()) {
    if (row.status === 'pending' || row.status === 'loading') { row.status = 'skipped'; row.error = 'Scan stopped'; }
  }
  state.scanning = false;
  els.scanBtn.disabled = false;
  els.stopBtn.hidden = true;
  setProgress(1);
  refreshWatchBacktest(sc);
  if (state.mode === 'watchlist') setStatus((abortFlag ? 'Scan stopped. ' : 'Scan complete. ') + summaryText());
  abortFlag = false;
  render();
}

function summaryText() {
  const rows = scopedRows();
  let curl = 0, appr = 0, err = 0, cached = 0;
  for (const r of rows) {
    if (r.result && r.result.status === 'curl') curl++;
    else if (r.result && r.result.status === 'approaching') appr++;
    if (r.status === 'error') err++;
    if (r.fromCache) cached++;
  }
  const parts = [`${curl} early curl${curl === 1 ? '' : 's'}`, `${appr} approaching`];
  if (err) parts.push(`${err} error${err === 1 ? '' : 's'}`);
  if (cached) parts.push(`${cached} from cache`);
  if (state.mode === 'market') {
    const tf = state.marketFile ? state.marketFile.timeframe : state.timeframe;
    return `${parts.join(', ')} among ${rows.length.toLocaleString()} stocks (${tf}).`;
  }
  return parts.join(', ') + '.';
}

function setStatus(text) { els.statusText.textContent = text; }
function setProgress(f) { els.progressBar.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`; }

/* ---------- Scoping, filtering, sorting ---------- */
function scopedRows() {
  let rows = [...currentRows().values()];
  if (state.mode !== 'market') return rows;
  const v = VIEWS[state.view];
  if (v.index) {
    const set = state.universe && state.universe.indexSets[v.index];
    rows = set ? rows.filter(r => set.has(r.ticker)) : [];
  } else if (state.view === 'sectors') {
    rows = state.group ? rows.filter(r => state.group.tickers.has(r.ticker)) : [];
  }
  return rows;
}

function sortValue(row, key) {
  if (key === 'ticker') return row.ticker;
  if (!row.result) return null;
  const r = row.result;
  switch (key) {
    case 'score': return r.score;
    case 'price': return r.price;
    case 'btc': return r.barsToCross;
    case 'rsi': return r.rsi;
    case 'relVol': return r.relVol;
    case 'gap': return r.normalizedGap;
    default: return null;
  }
}

function statusRank(row) {
  return { done: 0, loading: 1, pending: 2, skipped: 3, error: 4 }[row.status] ?? 5;
}

function filteredSortedRows(scoped) {
  let rows = scoped;
  const f = state.statusFilter[state.mode];
  if (f === 'signals') rows = rows.filter(r => r.result && r.result.status !== 'none');
  else if (f === 'curl' || f === 'approaching') rows = rows.filter(r => r.result && r.result.status === f);
  if (state.findText) {
    const q = state.findText;
    rows = rows.filter(r => r.ticker.startsWith(q) || (q.length >= 2 && companyName(r.ticker).toUpperCase().includes(q)));
  }
  const so = state.sort.macd;
  const dir = so.dir === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    const va = sortValue(a, so.key), vb = sortValue(b, so.key);
    const na = va === null || va === undefined || (typeof va === 'number' && !isNum(va));
    const nb = vb === null || vb === undefined || (typeof vb === 'number' && !isNum(vb));
    if (na && nb) return statusRank(a) - statusRank(b) || a.ticker.localeCompare(b.ticker);
    if (na) return 1;   // missing values always last
    if (nb) return -1;
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return cmp * dir || a.ticker.localeCompare(b.ticker);
  });
}

/* ---------- Rendering ---------- */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function statusPill(row) {
  if (row.status === 'loading') return '<span class="pill pill-loading"><span class="spinner"></span>Loading</span>';
  if (row.status === 'pending') return '<span class="pill pill-loading">Queued</span>';
  if (row.status === 'skipped') return '<span class="pill pill-none">Skipped</span>';
  if (row.status === 'error') return '<span class="pill pill-error">Error</span>';
  const st = row.result.status;
  return `<span class="pill pill-${st}">${STATUS_LABEL[st]}</span>`;
}

function scoreHtml(r) {
  const note = r.scoreNoVolume ? '<small title="Volume filter off: score rescaled from 90 to 100">no vol.</small>' : '';
  return `<div class="score" title="Setup Strength: match to your selected criteria, not a probability">
    <div class="score-bar"><div class="score-fill" style="width:${r.score}%"></div></div>
    <span class="score-num">${r.score}</span>${note}</div>`;
}

function rsiHtml(r) {
  if (!isNum(r.rsi)) return '—';
  const arrow = !isNum(r.rsiPrev) ? '' : r.rsi > r.rsiPrev ? ' <span class="up">▲</span>' : ' <span class="down">▼</span>';
  return r.rsi.toFixed(1) + arrow;
}

/* Tiny MACD (blue) vs Signal (orange) chart for cards. */
function sparkline(series) {
  if (!series || !Array.isArray(series.macd) || !Array.isArray(series.signal)) return '';
  const n = 40;
  const m = series.macd.slice(-n), sg = series.signal.slice(-n);
  const vals = m.concat(sg).filter(isNum);
  if (vals.length < 6 || m.length < 3) return '';
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi - lo < 1e-12) hi = lo + 1;
  const W = 110, H = 32;
  const x = i => (i / (m.length - 1)) * W;
  const y = v => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
  const path = arr => arr.map((v, i) => (isNum(v) ? `${i === 0 || !isNum(arr[i - 1]) ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}` : '')).join('');
  const y0 = y(0).toFixed(1);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="MACD and Signal, recent candles">
    <line x1="0" x2="${W}" y1="${y0}" y2="${y0}" class="spark-zero"/>
    <path d="${path(sg)}" class="spark-signal"/><path d="${path(m)}" class="spark-macd"/></svg>`;
}

function cardTags(t) {
  const info = tagInfo(t);
  const tags = [];
  if (info.themes.length) tags.push(`<span class="tag">${escapeHtml(info.themes[0])}</span>`);
  else if (info.sector) tags.push(`<span class="tag">${escapeHtml(info.sector)}</span>`);
  return tags.join('');
}

function cardHtml(row) {
  const t = escapeHtml(row.ticker);
  const name = escapeHtml(companyName(row.ticker));
  if (!row.result) {
    const cls = row.status === 'error' ? 'row-error' : 'row-pending';
    return `<article class="card ${cls}">
      <div class="card-top"><div class="card-id"><span class="ticker">${t}</span>${name ? `<span class="cname">${name}</span>` : ''}</div>${statusPill(row)}</div>
      ${row.error ? `<div class="err-text">${escapeHtml(row.error)}</div>` : ''}</article>`;
  }
  const r = row.result;
  return `<article class="card row-${r.status}" data-ticker="${t}" tabindex="0" role="button" aria-label="Open details for ${t}${name ? `, ${name}` : ''}">
    <div class="card-top">
      <div class="card-id"><span class="ticker">${t}</span>${name ? `<span class="cname">${name}</span>` : ''}</div>
      <div class="card-price">${fmtPrice(r.price)}</div>
    </div>
    <div class="card-mid">${statusPill(row)}${sparkline(r.series)}</div>
    <div class="card-stats">
      <div><span>Gap</span><b>${fmtPct(r.normalizedGap).replace(/(\.\d\d)\d%$/, '$1%')}</b></div>
      <div><span>Cross in</span><b>${r.barsToCross === null ? '—' : r.barsToCross.toFixed(1)}</b></div>
      <div><span>RSI</span><b>${rsiHtml(r)}</b></div>
      <div><span>Rel. vol</span><b>${r.relVol === null ? '—' : r.relVol.toFixed(2) + 'x'}</b></div>
    </div>
    <div class="card-foot">${scoreHtml(r)}<div class="card-tags">${row.fromCache ? '<span class="tag">cached</span>' : ''}${cardTags(row.ticker)}</div></div>
  </article>`;
}

function tableRowHtml(row) {
  const t = escapeHtml(row.ticker);
  const name = escapeHtml(companyName(row.ticker));
  if (!row.result) {
    const msg = row.error ? `<span class="err-text">${escapeHtml(row.error)}</span>` : '';
    return `<tr class="row-${row.status === 'error' ? 'error' : 'pending'}">
      <td><span class="ticker">${t}</span>${name ? `<small>${name}</small>` : ''}</td>
      <td colspan="9">${msg}</td><td>${statusPill(row)}</td></tr>`;
  }
  const r = row.result;
  return `<tr class="row-${r.status}" data-ticker="${t}" tabindex="0" title="Open details for ${t}">
    <td><span class="ticker">${t}</span>${name ? `<small>${name}</small>` : ''}</td>
    <td class="num">${fmtPrice(r.price)}</td>
    <td class="num">${fmtNum(r.macd)}</td>
    <td class="num">${fmtNum(r.signal)}</td>
    <td class="num">${fmtSigned(r.gap)}<small>${fmtPct(r.normalizedGap)}</small></td>
    <td class="num ${r.gapVelocity > 0 ? 'up' : 'down'}">${fmtSigned(r.gapVelocity)}</td>
    <td class="num">${r.barsToCross === null ? '—' : r.barsToCross.toFixed(1)}</td>
    <td class="num">${rsiHtml(r)}</td>
    <td class="num">${r.relVol === null ? '—' : r.relVol.toFixed(2) + 'x'}</td>
    <td>${scoreHtml(r)}</td>
    <td>${statusPill(row)}</td></tr>`;
}

function renderChips(scoped) {
  let curl = 0, appr = 0;
  for (const r of scoped) {
    if (!r.result) continue;
    if (r.result.status === 'curl') curl++;
    else if (r.result.status === 'approaching') appr++;
  }
  const f = state.statusFilter[state.mode];
  const chip = (key, label, n, cls = '') =>
    `<button type="button" class="chip ${cls}${f === key ? ' active' : ''}" data-filter="${key}" aria-pressed="${f === key}"><span class="chip-n">${fmtInt(n)}</span><span>${label}</span></button>`;
  els.statChips.innerHTML =
    chip('signals', 'Signals', curl + appr) +
    chip('curl', 'Early curl', curl, 'chip-curl') +
    chip('approaching', 'Approaching', appr, 'chip-appr') +
    chip('all', 'All stocks', scoped.length);
}

function emptyMessage(scoped) {
  const market = state.mode === 'market';
  if (!market) {
    return state.watchRows.size ? null : ['Your watchlist results will appear here.', 'Add tickers above and tap Scan watchlist.'];
  }
  if (!state.marketFile) {
    return state.marketError
      ? [state.marketError, 'Set up the scheduled GitHub Action (see README), or use the Watchlist tab to scan tickers live.']
      : ['Loading results…', ''];
  }
  const v = VIEWS[state.view];
  if (v.index && !(state.universe && state.universe.indexSets[v.index])) {
    return [`The ${v.label} list isn’t available yet.`, 'Index lists are downloaded by the scheduled scan and will appear after its next run.'];
  }
  if (!scoped.length && state.view !== 'sectors') return ['No stocks in this list for this timeframe.', ''];
  return null;
}

function render() {
  const market = state.mode === 'market';
  const setupMode = isSetupStrategy();
  const boardMode = state.view === 'sectors' && !state.group;

  els.tabs.querySelectorAll('[data-view]').forEach(b => {
    const on = b.dataset.view === state.view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  els.tfSwitch.hidden = setupMode;
  els.watchPanel.hidden = market;
  els.reloadMarket.hidden = !market;
  els.scanInfo.hidden = !market;
  els.sectorBoard.hidden = !boardMode;
  els.groupHeader.hidden = !(state.view === 'sectors' && state.group);
  els.toolbar.hidden = boardMode;
  els.statusRow.hidden = boardMode || (setupMode && market);
  els.layoutToggle.hidden = setupMode;
  const so = sortOf();
  els.sortKey.value = so.key;
  els.sortDir.textContent = so.dir === 'asc' ? '↑' : '↓';
  if (state.view === 'sectors' && state.group) renderGroupHeader();
  renderStrategyIntro();

  if (setupMode) {
    els.listArea.hidden = true;
    els.setupArea.hidden = boardMode;
    const S = state.setups;
    if (market) {
      els.scanInfo.textContent = S
        ? `Daily setups, updated ${fmtDateTime(S.generatedAt)}. Based on completed daily candles only.`
        : (state.setupsError || 'Loading setups…');
    }
    if (boardMode) renderSetupBoard(state.strategy);
    else renderSetups(state.strategy);
    return;
  }

  els.setupArea.hidden = true;
  els.listArea.hidden = boardMode;
  els.listArea.dataset.layout = state.layout;
  els.layoutCards.classList.toggle('active', state.layout === 'cards');
  els.layoutTable.classList.toggle('active', state.layout === 'table');

  if (boardMode) { renderBoard(); return; }
  if (market && state.marketFile && !state.marketError) setStatus(summaryText());

  const scoped = scopedRows();
  renderChips(scoped);
  renderBacktestPanel();

  const filtered = filteredSortedRows(scoped);
  const visible = filtered.slice(0, state.visibleLimit);
  const empty = emptyMessage(scoped);

  els.emptyState.hidden = !empty;
  if (empty) els.emptyState.innerHTML = `<p><strong>${escapeHtml(empty[0])}</strong></p>${empty[1] ? `<p>${escapeHtml(empty[1])}</p>` : ''}`;
  const noMatch = !empty && filtered.length === 0;
  els.noMatch.hidden = !noMatch;
  if (noMatch) {
    const f = state.statusFilter[state.mode];
    els.noMatch.innerHTML = state.findText
      ? `<p><strong>No match for “${escapeHtml(state.findText)}” here.</strong></p><p>${f !== 'all' ? 'It may have no signal right now. Tap “All stocks” to include every stock.' : 'Check the spelling, or try another tab.'}</p>`
      : `<p><strong>No ${f === 'curl' ? 'Early Bullish Curls' : f === 'approaching' ? 'Approaching Crossovers' : 'signals'} in this list right now.</strong></p><p>Tap “All stocks” to see everything, or loosen the rules in Filters &amp; settings.</p>`;
  }

  document.querySelectorAll('th[data-sort]').forEach(th => {
    const active = th.dataset.sort === state.sort.macd.key;
    th.classList.toggle('sorted', active);
    th.classList.toggle('asc', active && state.sort.macd.dir === 'asc');
  });

  els.resultsCards.innerHTML = visible.map(cardHtml).join('');
  els.resultsBody.innerHTML = visible.map(tableRowHtml).join('');
  els.resultsTable.hidden = visible.length === 0;

  els.showMore.hidden = filtered.length <= visible.length;
  els.shownCount.textContent = filtered.length ? `Showing ${visible.length.toLocaleString()} of ${filtered.length.toLocaleString()}` : '';
}

/* ---------- Swing setups: Uptrend Dip / Downtrend Rip ---------- */
// Figures from the 1996-2026 S&P 500 study (daily candles, costs excluded).
const STRATEGY_INFO = {
  dip: {
    title: 'Uptrend Dip', side: 'Long',
    summary: 'Buys a sharp drop in a stock that is still in a long-term uptrend, and holds for up to 3 sessions.',
    headline: 'In 2019–2026, 37% of trades reached +5% within 3 sessions, 37% lost, and the average trade made +0.9%.',
    rules: ['Close above its 200-day moving average', 'Down 10% or more over the last 5 sessions',
            'At least one of: closed in the bottom 20% of the day’s range, a new 20-day closing low, or 3 lower closes in a row'],
    plan: ['Buy at the next session’s open. Best at or below the signal close; avoid paying more than 2% above it.',
           'Target: entry + 1.5 × ATR (the stock’s average daily range).',
           'Disaster stop: entry − 3 × ATR. Tighter stops did worse in testing.',
           'Sell at the close of the 3rd session if neither level is hit.',
           'One session late? Only enter if day 1 closed below its open.'],
    stats: [['Signals', '2,546 (about 330 a year)'], ['Reached +5% within 3 sessions', '37%'], ['Losing trades', '37%'],
            ['Average per trade (+5% target)', '+0.9%'], ['Average per trade (ATR levels)', '+1.0%, 60% profitable'],
            ['Lost more than 5%', '10% of trades'], ['Worst year', '2022: −0.5% per trade'], ['Strongest version', 'More than 10% above the 200-day: +1.45%']],
    cautions: ['Signals bunch up in sell-offs. Buying many at once is one big bet on the market bouncing.',
               'Tested on S&P 500 stocks only. Smaller stocks were not tested.'],
  },
  rip: {
    title: 'Downtrend Rip', side: 'Short',
    summary: 'Shorts a sharp rally in a stock that is still in a long-term downtrend, and covers within 3 sessions.',
    headline: 'In 2019–2026 (excluding the unusual 2020), shorts averaged +0.6% and 59% were profitable.',
    rules: ['Close below its 200-day moving average', 'Up 10% or more over the last 5 sessions', 'RSI(14) at 70 or above'],
    plan: ['Short at the next session’s open. Best at or above the signal close; avoid shorting more than 2% below it.',
           'Target: entry − 1.5 × ATR.',
           'Disaster stop: entry + 3 × ATR. Losses on a short have no ceiling, so always use it.',
           'Cover at the close of the 3rd session if neither level is hit.',
           'One session late? Only enter if day 1 closed above its open.'],
    stats: [['Signals', '734 (about 75 a year outside 2020)'], ['Fell 5% within 3 sessions', '39% (21% excluding 2020)'],
            ['Rose 5% against you', '15%'], ['Average per short', '+1.7% (+0.6% excluding 2020)'], ['Profitable', '69% (59% excluding 2020)'],
            ['Beat the average stock', '24 of 26 years']],
    cautions: ['Borrow fees, margin and dividends owed while short are not included.',
               'Tested on S&P 500 stocks only. Small caps and meme stocks can squeeze violently; this is not for them.'],
  },
};

function loadSetups(force = false) {
  if (state.setupsLoading && !force) return state.setupsLoading;
  state.setupsError = '';
  state.setupsLoading = fetch(`${CONFIG.MARKET_DATA_DIR}setups.json`, { cache: 'no-cache' })
    .then(res => {
      if (res.status === 404) throw new ScreenerError('No setups have been published yet. They appear after the next scheduled scan.', 'missing');
      if (!res.ok) throw new ScreenerError(`Could not load setups (HTTP ${res.status}).`, 'api');
      return res.json();
    })
    .then(j => { state.setups = j; })
    .catch(e => { state.setups = null; state.setupsError = errorMessage(e); })
    .then(() => { render(); return state.setups; });
  return state.setupsLoading;
}

function fmtSession(dateStr) {
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00Z');
  if (isNaN(d.getTime())) return String(dateStr || '—');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function pctText(x) { return isNum(x) ? `${x > 0 ? '+' : ''}${x.toFixed(1)}%` : '—'; }

function levelsHtml(kind, lv, exitDate) {
  const long = kind === 'dip';
  const rel = v => pctText((v / lv.ref - 1) * 100);
  return `<div class="levels">
    <div><span>${long ? 'Buy up to' : 'Short down to'}</span><b>${fmtPrice(lv.entryLimit)}</b></div>
    <div><span>Target</span><b class="up">${fmtPrice(lv.target)}</b><small>${rel(lv.target)}</small></div>
    <div><span>Stop</span><b class="down">${fmtPrice(lv.stop)}</b><small>${rel(lv.stop)}</small></div>
    <div><span>Exit by</span><b>${escapeHtml(fmtSession(exitDate))}</b><small>at the close</small></div>
  </div>`;
}

function setupTags(x) {
  const tags = [];
  if (!x.sp500) tags.push('<span class="tag warn">Not in S&amp;P 500: untested</span>');
  if (x.kind === 'dip') {
    if (x.vs200 > 10) tags.push(`<span class="tag good">Strong uptrend: ${pctText(x.vs200)} vs 200-day</span>`);
    else if (x.vs200 < 1) tags.push(`<span class="tag warn">Barely above 200-day (${pctText(x.vs200)})</span>`);
    for (const r of x.reasons || []) tags.push(`<span class="tag">${escapeHtml(r)}</span>`);
  } else {
    tags.push(`<span class="tag">RSI ${isNum(x.rsi) ? x.rsi.toFixed(0) : '—'}</span>`);
    tags.push(`<span class="tag">${pctText(x.vs200)} vs 200-day</span>`);
  }
  return tags.join('');
}

function setupCard(x, mode) {
  const t = escapeHtml(x.ticker);
  const name = escapeHtml(companyName(x.ticker));
  const long = x.kind === 'dip';
  let banner = '', lv = x.levels, exitDate = x.exitDate, priceLabel = `${escapeHtml(fmtSession(x.signalDate))} close`, price = x.close;
  if (mode === 'late' && x.late) {
    const L = x.late;
    banner = L.ok
      ? `<div class="late ok">✓ Late entry OK: day 1 (${escapeHtml(fmtSession(x.entryDate))}) closed ${long ? 'below' : 'above'} its open, so the ${long ? 'bounce' : 'drop'} hasn’t started. Enter at the next open.</div>`
      : `<div class="late skip">✗ Skip: day 1 (${escapeHtml(fmtSession(x.entryDate))}) closed ${long ? 'above' : 'below'} its open, so the ${long ? 'bounce' : 'drop'} already began. Late entries like this did much worse.</div>`;
    lv = L.levels; exitDate = L.exitDate; price = L.day1Close; priceLabel = `${escapeHtml(fmtSession(x.entryDate))} close`;
  }
  const facts = `${pctText(x.chg5d)} in 5 sessions, RSI ${isNum(x.rsi) ? x.rsi.toFixed(0) : '—'}, daily range (ATR) ${isNum(x.atrPct) ? x.atrPct.toFixed(1) : '—'}% = ${fmtPrice(x.atr)}`;
  const showLevels = mode !== 'late' || (x.late && x.late.ok);
  return `<article class="card setup-card${mode === 'late' && x.late && !x.late.ok ? ' muted-card' : ''}">
    <div class="card-top">
      <div class="card-id"><span class="ticker">${t}</span>${name ? `<span class="cname">${name}</span>` : ''}</div>
      <div class="card-price">${fmtPrice(price)}<small>${priceLabel}</small></div>
    </div>
    ${banner}
    <p class="setup-facts">${escapeHtml(facts)}</p>
    ${showLevels ? levelsHtml(x.kind, lv, exitDate) : ''}
    ${showLevels ? `<p class="hint">Adjust to your fill: target = fill ${long ? '+' : '−'} ${fmtPrice(SETUP.TARGET_ATR * x.atr)}, stop = fill ${long ? '−' : '+'} ${fmtPrice(SETUP.STOP_ATR * x.atr)}.</p>` : ''}
    <div class="card-tags left">${setupTags(x)}</div>
  </article>`;
}

function trackRow(x) {
  const tr = x.track || {};
  const t = escapeHtml(x.ticker);
  let label, cls;
  switch (tr.state) {
    case 'target': label = `Target hit on day ${tr.day} (${pctText(tr.pct)})`; cls = 'up'; break;
    case 'stop': label = `Stopped on day ${tr.day} (${pctText(tr.pct)})`; cls = 'down'; break;
    case 'closed': label = `Closed at day 3 (${pctText(tr.pct)})`; cls = tr.pct >= 0 ? 'up' : 'down'; break;
    case 'open': label = `Open, day ${tr.day} of 3 (${pctText(tr.pct)} so far)`; cls = tr.pct >= 0 ? 'up' : 'down'; break;
    default: label = 'Waiting for entry'; cls = 'muted';
  }
  return `<div class="track-row">
    <div><span class="ticker">${t}</span><small>${escapeHtml(fmtSession(x.signalDate))} signal${isNum(tr.entry) ? `, entry ${fmtPrice(tr.entry)}` : ''}${x.sp500 ? '' : ', not in S&amp;P 500'}</small></div>
    <b class="${cls}">${escapeHtml(label)}</b>
  </div>`;
}

function setupSortValue(x, key) {
  switch (key) {
    case 'price': return x.close;
    case 'relVol': return isNum(x.relVol) ? x.relVol : null;
    case 'chg5d': return x.chg5d;
    case 'vs200': return x.vs200;
    case 'rsi': return isNum(x.rsi) ? x.rsi : null;
    case 'atrPct': return x.atrPct;
    case 'ticker': return x.ticker;
    default: return null;
  }
}

function sortSetups(list) {
  const so = sortOf();
  const dir = so.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = setupSortValue(a, so.key), vb = setupSortValue(b, so.key);
    if (va === null && vb === null) return a.ticker.localeCompare(b.ticker);
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return cmp * dir || a.ticker.localeCompare(b.ticker);
  });
}

function matchesFind(ticker) {
  const q = state.findText;
  if (!q) return true;
  return ticker.startsWith(q) || (q.length >= 2 && companyName(ticker).toUpperCase().includes(q));
}

/* Setup signals for the current tab: scheduled scan (market tabs) or live watchlist candles. */
function setupItems(kind) {
  const sp = state.universe && state.universe.indexSets.sp500;
  if (state.mode === 'watchlist') {
    if (!state.watchRows.size) return { items: [], message: ['Your watchlist results will appear here.', 'Add tickers above and tap Scan watchlist. Setups are checked on daily candles.'] };
    if (state.scannedTimeframe !== '1D') return { items: [], message: ['Your watchlist was scanned on intraday candles.', 'Tap Scan watchlist to load the daily candles this setup needs.'] };
    const items = [];
    for (const row of state.watchRows.values()) {
      if (!row.candles) continue;
      for (const sig of scanSetups(row.candles)) if (sig.kind === kind) items.push({ ticker: row.ticker, sp500: sp ? sp.has(row.ticker) : true, ...sig });
    }
    return { items };
  }
  const S = state.setups;
  if (!S) return { items: [], message: [state.setupsError || 'Loading setups…', ''] };
  let items = S[kind] || [];
  const v = VIEWS[state.view];
  if (v.index) {
    const set = state.universe && state.universe.indexSets[v.index];
    if (!set) return { items: [], message: [`The ${v.label} list isn’t available yet.`, 'Index lists are downloaded by the scheduled scan and will appear after its next run.'] };
    items = items.filter(x => set.has(x.ticker));
  } else if (state.view === 'sectors') {
    items = state.group ? items.filter(x => state.group.tickers.has(x.ticker)) : [];
  }
  return { items };
}

/* For the Watchlist tab: how close each ticker is to the setup today. */
function watchlistSetupStatus(kind, withSetup) {
  const rows = [];
  for (const row of state.watchRows.values()) {
    if (!matchesFind(row.ticker)) continue;
    if (!row.candles) { rows.push(`<div class="track-row"><div><span class="ticker">${escapeHtml(row.ticker)}</span></div><b class="down">${escapeHtml(row.error || 'No data')}</b></div>`); continue; }
    if (withSetup.has(row.ticker)) continue;
    const ind = setupIndicators(row.candles);
    const f = setupFlags(ind, row.candles.length - 1);
    const label = !f ? 'Not enough history (needs about 205 daily candles)'
      : kind === 'dip'
        ? `${pctText(f.r5 * 100)} in 5 sessions (needs −10%), ${pctText(f.vs200 * 100)} vs 200-day (needs above)`
        : `${pctText(f.r5 * 100)} in 5 sessions (needs +10%), RSI ${isNum(f.rsi) ? f.rsi.toFixed(0) : '—'} (needs 70+), ${pctText(f.vs200 * 100)} vs 200-day (needs below)`;
    rows.push(`<div class="track-row"><div><span class="ticker">${escapeHtml(row.ticker)}</span><small>${escapeHtml(companyName(row.ticker))}</small></div><b class="muted">${escapeHtml(label)}</b></div>`);
  }
  return rows.join('');
}

function setupIntroHtml(kind) {
  const info = STRATEGY_INFO[kind];
  return `
    <div class="panel setup-intro">
      <div class="setup-title"><h2>${info.title}</h2><span class="tag ${kind === 'dip' ? 'good' : 'warn'}">${info.side}, up to 3 sessions</span></div>
      <p>${escapeHtml(info.summary)}</p>
      <p class="setup-headline">${escapeHtml(info.headline)}</p>
      <details class="setup-more">
        <summary>Rules, trade plan and tested results</summary>
        <h3>Scan rules (daily candles)</h3><ul>${info.rules.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
        <h3>Trade plan</h3><ul>${info.plan.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
        <h3>Tested results, 2019–2026 (S&amp;P 500 stocks)</h3>
        <div class="bt-scroll"><table class="bt-list">${info.stats.map(([a, b]) => `<tr><td>${escapeHtml(a)}</td><td><b>${escapeHtml(b)}</b></td></tr>`).join('')}</table></div>
        <h3>Be aware</h3><ul>${info.cautions.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
        <p class="hint">Found on 2000–2012, checked on 2013–2018, and confirmed on 2019–2026 data that wasn’t used while searching. Trading costs excluded. Past results don’t guarantee future results. Not financial advice.</p>
      </details>
    </div>`;
}

function renderSetups(kind) {
  const info = STRATEGY_INFO[kind];
  const box = els.setupArea;
  const { items: raw, message } = setupItems(kind);
  if (message) {
    box.innerHTML = `<div class="empty"><p><strong>${escapeHtml(message[0])}</strong></p>${message[1] ? `<p>${escapeHtml(message[1])}</p>` : ''}</div>`;
    return;
  }
  const items = raw.filter(x => matchesFind(x.ticker));
  const S = state.setups;
  const watch = state.mode === 'watchlist';
  const fresh = sortSetups(items.filter(x => x.sessionsAgo === 0));
  const late = sortSetups(items.filter(x => x.sessionsAgo === 1 && x.late));
  const tracked = items.filter(x => x.sessionsAgo >= 1).sort((a, b) => (a.signalDate < b.signalDate ? 1 : a.signalDate > b.signalDate ? -1 : a.ticker.localeCompare(b.ticker)));
  const counts = { target: 0, stop: 0, closed: 0, open: 0 };
  let closedUp = 0;
  for (const x of tracked) { const st = x.track && x.track.state; if (st in counts) counts[st]++; if (st === 'closed' && x.track.pct > 0) closedUp++; }
  const asOfDate = watch ? (items[0] && addSessions(items[0].signalDate, items[0].sessionsAgo)) || null : S && S.asOf;
  const lastCandle = watch ? (() => { for (const r of state.watchRows.values()) if (r.candles) return String(r.candles[r.candles.length - 1].t).slice(0, 10); return null; })() : asOfDate;
  const asOf = escapeHtml(fmtSession(lastCandle));
  const next = escapeHtml(fmtSession(lastCandle ? addSessions(lastCandle, 1) : ''));
  const scopeNote = state.view === 'all'
    ? 'Includes stocks outside the S&amp;P 500. Those weren’t part of the test, so they are marked.'
    : state.view === 'sp500' ? 'S&amp;P 500 stocks, the group the rules were tested on.'
    : watch ? 'Checked live on your watchlist’s daily candles.'
    : state.view === 'sectors' && state.group ? `Stocks in ${escapeHtml(state.group.label)}.` : '';
  const section = (title, sub, body) => `<section class="setup-section"><h2>${title}</h2>${sub ? `<p class="hint">${sub}</p>` : ''}${body}</section>`;
  const withSetup = new Set(items.filter(x => x.sessionsAgo === 0).map(x => x.ticker));
  box.innerHTML = `
    <p class="hint setup-scope">${scopeNote} Setups from the close of ${asOf}.${S && S.stale && !watch ? ' ⚠ The latest scan failed, so these may be out of date.' : ''}</p>
    ${section(`New setups: ${kind === 'dip' ? 'buy' : 'short'} at the ${next} open`, 'Levels are based on the signal close. Recalculate from your actual fill using the note on each card.',
      fresh.length ? `<div class="cards">${fresh.map(x => setupCard(x, 'new')).join('')}</div>`
                   : `<div class="empty small"><p>No new ${info.title} setups ${state.findText ? 'matching your search ' : ''}at the ${asOf} close.</p></div>`)}
    ${late.length ? section('One session late', 'The tested entry was yesterday’s open. A late entry only held up when day 1 moved against the setup.', `<div class="cards">${late.map(x => setupCard(x, 'late')).join('')}</div>`) : ''}
    ${section('Tracker: signals from the last 5 sessions', tracked.length
        ? `Assumes the tested entry (the open after the signal). ${counts.target} hit target, ${counts.stop} stopped, ${counts.closed} closed at day 3 (${closedUp} up), ${counts.open} still open.`
        : '', tracked.length ? `<div class="panel track-list">${tracked.map(trackRow).join('')}</div>` : '<div class="empty small"><p>No signals in the last 5 sessions.</p></div>')}
    ${watch ? section('The rest of your watchlist', 'How far each stock is from qualifying today.', `<div class="panel track-list">${watchlistSetupStatus(kind, withSetup) || '<p class="hint">Every ticker has a setup today.</p>'}</div>`) : ''}
    <p class="disclaimer">Rules-based output from a backtested model, not financial advice. Always check the live price and news before trading.</p>`;
}

/* Sectors & themes board for Dip / Rip: where the setups are clustering. */
function setupGroupStats(g, kind) {
  const all = (state.setups && state.setups[kind]) || [];
  const mine = all.filter(x => g.tickers.has(x.ticker));
  const fresh = sortSetups(mine.filter(x => x.sessionsAgo === 0));
  return {
    members: g.tickers.size, fresh: fresh.length, recent: mine.length,
    hits: mine.filter(x => x.track && x.track.state === 'target').length,
    top: fresh.slice(0, 4).map(x => x.ticker),
  };
}

function renderSetupBoard(kind) {
  const box = els.sectorBoard;
  if (!state.setups) { box.innerHTML = `<div class="empty"><p><strong>${escapeHtml(state.setupsError || 'Loading setups…')}</strong></p></div>`; return; }
  if (!state.universe || !state.universe.groups.length) {
    box.innerHTML = '<div class="empty"><p><strong>Sectors and themes will appear after the next scheduled scan.</strong></p></div>';
    return;
  }
  const title = STRATEGY_INFO[kind].title;
  const tile = g => {
    const st = setupGroupStats(g, kind);
    return `<button type="button" class="tile${st.recent ? '' : ' tile-quiet'}" data-group="${escapeHtml(g.id)}">
      <div class="tile-head"><span class="tile-name">${escapeHtml(g.label)}</span><span class="etf">${st.members} stocks</span></div>
      <div class="tile-legend"><span><b>${st.fresh}</b> new today</span><span><b>${st.recent}</b> in the last 6 sessions</span></div>
      <div class="tile-sub">${st.recent ? `${st.hits} of those hit their target` : `No ${escapeHtml(title)} signals lately`}</div>
      ${st.top.length ? `<div class="tile-top">New: <b>${st.top.map(escapeHtml).join(', ')}</b></div>` : ''}
    </button>`;
  };
  const order = gs => gs.map(g => ({ g, st: setupGroupStats(g, kind) }))
    .sort((a, b) => b.st.fresh - a.st.fresh || b.st.recent - a.st.recent || a.g.label.localeCompare(b.g.label)).map(x => x.g);
  const themes = order(state.universe.groups.filter(g => g.kind === 'theme'));
  const sectors = order(state.universe.groups.filter(g => g.kind === 'sector'));
  const section = (h, note, gs) => gs.length ? `<section class="board-section"><h2>${h}</h2><p>${note}</p><div class="tiles">${gs.map(tile).join('')}</div></section>` : '';
  box.innerHTML =
    section('Themes', `Where ${escapeHtml(title)} setups are appearing, busiest first. Tap one to see its setups.`, themes) +
    section('Sectors', 'GICS sectors for S&amp;P 500 and Nasdaq-100 members.', sectors);
}

/* Intro card for the selected strategy (re-rendered only when the strategy changes). */
function renderStrategyIntro() {
  const kind = state.strategy;
  if (els.strategyIntro.dataset.kind === kind) return;
  els.strategyIntro.dataset.kind = kind;
  els.strategyIntro.innerHTML = kind === 'macd' ? macdIntroHtml() : setupIntroHtml(kind);
}

function macdIntroHtml() {
  return `
    <div class="panel setup-intro">
      <div class="setup-title"><h2>MACD Curl</h2><span class="tag">Watch and timing</span></div>
      <p>Finds stocks where MACD is still below its Signal line but curling upward, with the gap narrowing, before a bullish crossover.</p>
      <p class="setup-headline">In the 1996–2026 study, the curl on its own did no better than an average stock over 1–5 days. Use it to spot and time stocks worth watching, not as a stand-alone buy signal.</p>
      <details class="setup-more">
        <summary>How the curl is detected</summary>
        <ul>
          <li>MACD (12, 26) is below its 9-period Signal line, and rising.</li>
          <li>The MACD/Signal gap is shrinking. Bars To Cross = −gap ÷ how fast the gap is closing (default 1–5 candles).</li>
          <li>RSI(14) is between your minimum and maximum (default 35–55) and rising. Volume confirmation is optional.</li>
          <li>Setup Strength (0–100) measures how closely a stock matches these rules. It is not a probability.</li>
        </ul>
        <p class="hint">Adjust the rules in Filters &amp; settings. The Backtest box below shows how past curls played out.</p>
      </details>
    </div>`;
}

/* ---------- Sectors & themes board ---------- */
function groupStats(g) {
  const rows = [];
  for (const t of g.tickers) {
    const r = state.marketRows.get(t);
    if (r && r.result) rows.push(r);
  }
  let curl = 0, appr = 0, rising = 0;
  for (const r of rows) {
    if (r.result.status === 'curl') curl++;
    else if (r.result.status === 'approaching') appr++;
    if (r.result.slope > 0) rising++;
  }
  const top = rows.filter(r => r.result.status !== 'none')
    .sort((a, b) => b.result.score - a.result.score || a.ticker.localeCompare(b.ticker))
    .slice(0, 4).map(r => r.ticker);
  const etfRow = g.etf ? state.marketRows.get(g.etf) : null;
  return { n: rows.length, curl, appr, risingPct: rows.length ? (rising / rows.length) * 100 : null, top, etfRow };
}

function etfBadge(g, etfRow) {
  if (!g.etf) return '';
  const st = etfRow && etfRow.result ? etfRow.result.status : null;
  const label = st === 'curl' ? 'Early curl' : st === 'approaching' ? 'Approaching' : st === 'none' ? 'No signal' : 'n/a';
  return `<span class="etf" title="${escapeHtml(g.etf)}: ${escapeHtml(label)}"><span class="dot ${st || ''}"></span>${escapeHtml(g.etf)} ${escapeHtml(label)}</span>`;
}

function tileHtml(g) {
  const st = groupStats(g);
  if (!st.n) return '';
  const pc = x => ((x / st.n) * 100).toFixed(1);
  return `<button type="button" class="tile" data-group="${escapeHtml(g.id)}">
    <div class="tile-head"><span class="tile-name">${escapeHtml(g.label)}</span>${etfBadge(g, st.etfRow)}</div>
    <div class="tile-sub">${st.n} stock${st.n === 1 ? '' : 's'}${isNum(st.risingPct) ? `, MACD rising in ${Math.round(st.risingPct)}%` : ''}</div>
    <div class="breadth" aria-hidden="true"><span class="b-curl" style="width:${pc(st.curl)}%"></span><span class="b-appr" style="width:${pc(st.appr)}%"></span></div>
    <div class="tile-legend"><span><b>${st.curl}</b> early curl${st.curl === 1 ? '' : 's'}</span><span><b>${st.appr}</b> approaching</span></div>
    ${st.top.length ? `<div class="tile-top">Top setups: <b>${st.top.map(escapeHtml).join(', ')}</b></div>` : ''}
  </button>`;
}

function sortGroups(groups) {
  return groups
    .map(g => ({ g, st: groupStats(g) }))
    .filter(x => x.st.n > 0)
    .sort((a, b) => ((b.st.curl + b.st.appr) / b.st.n) - ((a.st.curl + a.st.appr) / a.st.n) || (b.st.risingPct || 0) - (a.st.risingPct || 0))
    .map(x => x.g);
}

function renderBoard() {
  const box = els.sectorBoard;
  if (!state.marketFile) {
    box.innerHTML = `<div class="empty"><p><strong>${escapeHtml(state.marketError || 'Loading results…')}</strong></p></div>`;
    return;
  }
  if (!state.universe || !state.universe.groups.length) {
    box.innerHTML = '<div class="empty"><p><strong>Sectors and themes will appear after the next scheduled scan.</strong></p><p>The scan downloads index lists, sectors and themes, then publishes them with the results.</p></div>';
    return;
  }
  const themes = sortGroups(state.universe.groups.filter(g => g.kind === 'theme'));
  const sectors = sortGroups(state.universe.groups.filter(g => g.kind === 'sector'));
  const section = (title, note, groups) => groups.length
    ? `<section class="board-section"><h2>${title}</h2><p>${note}</p><div class="tiles">${groups.map(tileHtml).join('')}</div></section>`
    : '';
  box.innerHTML =
    section('Themes', 'Hand-picked groups, sorted by the share of stocks with a signal. Tap one to see its stocks.', themes) +
    section('Sectors', 'GICS sectors for S&amp;P 500 and Nasdaq-100 members. The badge shows the sector ETF’s own signal.', sectors);
}

function renderGroupHeader() {
  const g = state.group;
  if (isSetupStrategy()) {
    const st = state.setups ? setupGroupStats(g, state.strategy) : null;
    els.groupHeader.innerHTML = `
      <button type="button" class="btn btn-small btn-ghost" data-back>← All sectors &amp; themes</button>
      <h2>${escapeHtml(g.label)}</h2>
      <p>${st ? `${st.fresh} new ${escapeHtml(STRATEGIES[state.strategy])} setup${st.fresh === 1 ? '' : 's'} today, ${st.recent} in the last 6 sessions.` : ''}${g.kind === 'sector' ? ' Sector membership covers S&amp;P 500 and Nasdaq-100 stocks.' : ''}</p>`;
    return;
  }
  const st = groupStats(g);
  const etfLine = g.etf
    ? ` ${escapeHtml(g.etf)} (the group’s ETF): ${st.etfRow && st.etfRow.result ? STATUS_LABEL[st.etfRow.result.status] : 'not in this scan'}.`
    : '';
  const note = g.kind === 'sector' ? ' Sector membership covers S&amp;P 500 and Nasdaq-100 stocks.' : (g.note ? ` ${escapeHtml(g.note)}` : '');
  els.groupHeader.innerHTML = `
    <button type="button" class="btn btn-small btn-ghost" data-back>← All sectors &amp; themes</button>
    <h2>${escapeHtml(g.label)}</h2>
    <p>${st.n} stock${st.n === 1 ? '' : 's'} in this scan.${etfLine}${note}</p>`;
}

/* ---------- Backtest display ---------- */
function fmtRet(x) { return isNum(x) ? `${x > 0 ? '+' : ''}${x.toFixed(1)}%` : '—'; }
function retHtml(x) { return isNum(x) ? `<span class="${x > 0 ? 'up' : x < 0 ? 'down' : ''}">${fmtRet(x)}</span>` : '<span class="muted">—</span>'; }
function fmtPct0(x) { return isNum(x) ? `${Math.round(x)}%` : '—'; }

function loadBacktestFile(tf) {
  if (!state.btFiles.has(tf)) {
    state.btFiles.set(tf, fetch(`${CONFIG.MARKET_DATA_DIR}bt-${tf}.json`, { cache: 'no-cache' })
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null));
  }
  return state.btFiles.get(tf);
}

function refreshWatchBacktest(s) {
  const results = [];
  for (const row of state.watchRows.values()) {
    if (!row.candles) continue;
    row.bt = backtestCandles(row.candles, s);
    results.push(row.bt);
  }
  state.watchBacktest = results.length ? summarizeBacktest(results, s) : null;
}

function thresholdsText(t) {
  return `RSI ${t.rsiMin}–${t.rsiMax}, Bars To Cross ${t.minBtc}–${t.maxBtc}, volume filter ${t.volumeFilter ? `on (≥ ${t.minRelVol}x)` : 'off'}`;
}

function btScopeNote(bt, mode) {
  const t = bt.thresholds || {};
  let note = `Signals use ${thresholdsText(t)}.`;
  if (mode === 'market') {
    const s = readSettings();
    if (s && JSON.stringify(thresholdsOf(s)) !== JSON.stringify(thresholdsOf({ ...DEFAULT_SETTINGS, ...t }))) {
      note += ' Your current settings differ, and these results don’t change when you adjust them. Use the Watchlist tab to backtest your own settings.';
    }
  }
  return note;
}

function btCell(stat, unit) {
  if (!stat || !stat.n) return '<td class="muted">—</td>';
  return `<td><b>${fmtPct0(stat.winRate)} up</b><small>avg ${fmtRet(stat.avg)}, median ${fmtRet(stat.median)}</small><small>${fmtInt(stat.n)} ${unit}</small></td>`;
}

function renderBacktestPanel() {
  const bt = state.mode === 'market' ? (state.marketFile && state.marketFile.backtest) : state.watchBacktest;
  // The market-wide backtest covers the whole scan, so say so on the index and sector tabs.
  if (!bt || !bt.stocks) { els.btPanel.hidden = true; return; }
  els.btPanel.hidden = false;

  const H = bt.horizons || BT.HORIZONS;
  const hMid = H[Math.min(1, H.length - 1)];
  const c = bt.curl, a = bt.approaching, b = bt.baseline;
  const cs = c.horizons[hMid], bs = b[hMid];
  const who = state.mode === 'market' ? '' : ' (your watchlist)';
  els.btHeadline.textContent = cs && cs.n
    ? `Backtest${who}: ${hMid} candles after past Early Bullish Curls, price was higher ${fmtPct0(cs.winRate)} of the time (average ${fmtRet(cs.avg)}). All candles: ${fmtPct0(bs.winRate)} (average ${fmtRet(bs.avg)}).`
    : `Backtest${who}: no past Early Bullish Curls with ${hMid} candles of follow-up yet. Tap for details.`;

  const scope = state.mode === 'market'
    ? `All ${fmtInt(bt.stocks)} stocks in this scan (not only this tab), candles from ${escapeHtml(bt.from)} to ${escapeHtml(bt.to)}.`
    : `Your ${fmtInt(bt.stocks)} watchlist stock${bt.stocks === 1 ? '' : 's'}, candles from ${escapeHtml(bt.from)} to ${escapeHtml(bt.to)}.`;

  const rows = H.map(h => `<tr><th>${h} candles</th>${btCell(c.horizons[h], 'signals')}${btCell(a.horizons[h], 'signals')}${btCell(b[h], 'candles')}</tr>`).join('');

  const facts = [];
  if (isNum(c.crossRate) || isNum(a.crossRate)) {
    facts.push(`MACD closed above Signal within ${bt.crossWindow} candles after ${fmtPct0(c.crossRate)} of Early Curls${isNum(c.medianCrossBars) ? ` (median ${c.medianCrossBars} candles)` : ''} and ${fmtPct0(a.crossRate)} of Approaching signals${isNum(a.medianCrossBars) ? ` (median ${a.medianCrossBars})` : ''}.`);
  }
  if (isNum(c.avgDip) || isNum(a.avgDip)) {
    facts.push(`Average worst dip below the entry price within ${bt.dipWindow} candles: ${fmtRet(c.avgDip)} after Early Curls, ${fmtRet(a.avgDip)} after Approaching. Useful when thinking about stop distance.`);
  }
  if (c.count < 30) facts.push(`Only ${c.count} Early Curl signal${c.count === 1 ? '' : 's'} in this sample, which is too few to draw conclusions from.`);

  els.btBody.innerHTML = `
    <p class="bt-scope">${scope} ${escapeHtml(btScopeNote(bt, state.mode))} Each signal is entered at the next candle’s open and measured to the close ${H.join(', ')} candles later. A repeat signal within ${bt.cooldown} candles counts once.</p>
    <div class="bt-scroll"><table class="bt-table">
      <thead><tr><th>Held for</th><th>🟢 Early Curl</th><th>🟡 Approaching</th><th>All candles</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${facts.length ? `<ul class="bt-facts">${facts.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}
    <p class="bt-caveats">Read with care. ${state.mode === 'market' ? 'Only stocks that are listed and liquid today are included, so stocks that later collapsed or were delisted are missing, which flatters the results. ' : ''}This covers a single stretch of market history. Commissions, slippage and taxes are ignored. Many signals happen on the same days, so they are not independent. Compare with the “All candles” column: a signal only adds something if it beats that. Past results do not predict future results.</p>`;
}

function stockBacktestHtml(ticker, signals, scopeNote) {
  const t = escapeHtml(ticker);
  if (!signals.length) {
    return `<h3>Past signals on ${t}</h3><p class="hint">No Early Bullish Curl or Approaching signals in the tested history. ${escapeHtml(scopeNote)}</p>`;
  }
  const hMid = BT.HORIZONS[1];
  const line = (type, label) => {
    const sum = summarizeSignals(signals, type);
    if (!sum.count) return '';
    const hs = sum.horizons[hMid];
    const after = hs.n
      ? `${hMid} candles later, price was higher after ${Math.round((hs.winRate / 100) * hs.n)} of ${hs.n} (average ${fmtRet(hs.avg)}).`
      : `None has ${hMid} candles of follow-up yet.`;
    const cross = sum.crossDecided ? ` MACD crossed Signal within ${BT.CROSS_WINDOW} candles after ${sum.crossed} of ${sum.crossDecided}.` : '';
    return `<p><b>${label}</b>: ${sum.count} signal${sum.count === 1 ? '' : 's'}. ${after}${cross}</p>`;
  };
  const recent = [...signals].sort((x, y) => (x.t < y.t ? 1 : -1)).slice(0, 15);
  const rows = recent.map(x => `<tr>
      <td>${escapeHtml(x.t)}</td>
      <td>${x.type === 'curl' ? '🟢 Curl' : '🟡 Appr.'}</td>
      ${BT.HORIZONS.map(h => `<td class="num">${retHtml(x.r[h])}</td>`).join('')}
      <td class="num">${x.crossBars === null ? '<span class="muted">—</span>' : x.crossBars > 0 ? `in ${x.crossBars}` : 'no'}</td>
    </tr>`).join('');
  return `<h3>Past signals on ${t}</h3>
    ${line('curl', '🟢 Early Bullish Curl')}${line('approaching', '🟡 Approaching')}
    <div class="bt-scroll"><table class="bt-list">
      <thead><tr><th>Signal candle</th><th>Type</th>${BT.HORIZONS.map(h => `<th class="num">+${h}</th>`).join('')}<th class="num">Crossed</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="hint">Returns from the next candle’s open to the close ${BT.HORIZONS.join(', ')} candles later; “—” means not enough candles yet. ${escapeHtml(scopeNote)} A handful of signals on one stock says very little; the all-stocks backtest above the results is more meaningful.</p>`;
}

/* ---------- Detail view ---------- */
function openDetail(ticker) {
  const row = currentRows().get(ticker);
  if (!row || !row.result) { closeDetail(); return; }
  state.openTicker = ticker;
  const r = row.result;
  const s = r.settings;
  const t = escapeHtml(ticker);
  const isMarket = state.mode === 'market';
  const name = companyName(ticker);
  const info = tagInfo(ticker);

  const metric = (label, value) => `<div class="metric"><span>${label}</span><b>${value}</b></div>`;
  const checks = r.checks.map(c => {
    const mark = c.state === 'ok' ? '✓' : c.state === 'fail' ? '✗' : '•';
    return `<li class="${c.state}"><span class="mark">${mark}</span><span>${escapeHtml(c.text)}</span></li>`;
  }).join('');
  const warnings = r.warnings.length
    ? `<div class="detail-section warnings">${r.warnings.map(w => `<p>⚠ ${escapeHtml(w)}</p>`).join('')}</div>` : '';

  const tags = [
    statusPill(row),
    info.sector ? `<span class="tag">${escapeHtml(info.sector)}</span>` : '',
    ...info.indexes.map(x => `<span class="tag idx">${escapeHtml(x)}</span>`),
    ...info.themes.map(x => `<span class="tag">${escapeHtml(x)}</span>`),
  ].join('');

  let meta;
  if (isMarket && state.marketFile) {
    const f = state.marketFile;
    meta = `${escapeHtml(s.timeframe)} candles from the scheduled scan (${escapeHtml(f.source || 'scheduled scan')}), completed candles only.
      Latest candle: ${escapeHtml(r.time)}${s.timeframe !== '1D' ? ' ET' : ''}. Scan run: ${escapeHtml(fmtDateTime(f.generatedAt))}.
      MACD(${s.fast}, ${s.slow}, ${s.signal}), RSI(${s.rsiLen}), ${r.candleCount} candles.`;
  } else {
    meta = `${escapeHtml(s.timeframe)} candles, latest: ${escapeHtml(r.time)}${row.fromCache ? ' (from cache)' : ''}.
      MACD(${s.fast}, ${s.slow}, ${s.signal}), RSI(${s.rsiLen}), ${r.candleCount} candles loaded.
      During market hours the latest candle may still be forming.`;
  }

  const chartSection = r.series
    ? `<div class="detail-section">
        <h3>Chart (last ${r.series.close.length} candles)</h3>
        <div class="chart-box"><canvas id="detailChart" role="img" aria-label="Price, MACD, Signal, histogram and RSI chart for ${t}"></canvas></div>
        <div class="legend">
          <span><i style="background:var(--c-price)"></i>Price</span>
          <span><i style="background:var(--c-macd)"></i>MACD</span>
          <span><i style="background:var(--c-signal)"></i>Signal</span>
          <span><i style="background:var(--c-up)"></i><i style="background:var(--c-down)"></i>Histogram</span>
          <span><i style="background:var(--c-rsi)"></i>RSI (shaded: ${s.rsiMin}–${s.rsiMax})</span>
          <span><i style="background:var(--c-current)"></i>Current candle</span>
          <span><b class="mk mk-curl">▲</b>Past Early Curl</span>
          <span><b class="mk mk-appr">▲</b>Past Approaching</span>
        </div>
      </div>`
    : `<div class="detail-section note">
        <p>The scheduled scan only publishes charts for stocks where MACD is below Signal, rising, and closing the gap. To see this stock’s chart, scan it live from your watchlist.</p>
        <button type="button" class="btn" data-add-watch="${t}">Add ${t} to my watchlist</button>
      </div>`;

  els.detailBody.innerHTML = `
    <div class="d-head">
      <div><h2 id="detailTitle">${t}</h2>${name ? `<p class="d-name">${escapeHtml(name)}</p>` : ''}</div>
      <div class="d-price">${fmtPrice(r.price)}</div>
    </div>
    <div class="d-tags">${tags}</div>
    <p class="detail-meta">${meta}</p>

    <div class="verdict verdict-${r.status}">
      <p class="verdict-title">Signal: ${SIGNAL_TEXT[r.status]}</p>
      ${scoreHtml(r)}
      <p class="score-note">Setup Strength ${r.score}/100${r.scoreNoVolume ? ' (without volume confirmation)' : ''}. This measures how closely current conditions match your criteria. It is not a probability or a price forecast.</p>
    </div>

    <div class="detail-section">
      <h3>${r.status === 'curl' ? 'Why this triggered' : 'Condition check'}</h3>
      <ul class="checks">${checks}</ul>
    </div>

    <div class="metrics">
      ${metric('Price', fmtPrice(r.price))}
      ${metric('MACD', fmtNum(r.macd))}
      ${metric('Signal', fmtNum(r.signal))}
      ${metric('Histogram', fmtSigned(r.histogram))}
      ${metric('MACD Gap (MACD − Signal)', fmtSigned(r.gap))}
      ${metric('Normalized Gap', fmtPct(r.normalizedGap))}
      ${metric('Gap Velocity', fmtSigned(r.gapVelocity))}
      ${metric('MACD slope', fmtSigned(r.slope))}
      ${metric('MACD acceleration', fmtSigned(r.accel))}
      ${metric('Est. Bars To Cross', r.barsToCross === null ? '—' : r.barsToCross.toFixed(1))}
      ${metric('RSI', rsiHtml(r))}
      ${metric('Relative Volume', r.relVol === null ? '—' : r.relVol.toFixed(2) + 'x')}
    </div>

    ${warnings}
    ${chartSection}

    <div class="detail-section" id="btDetail"></div>

    <p class="disclaimer">Technical screening only, not financial advice. Estimated Bars To Cross is a straight-line extrapolation of the current gap velocity and can change with every new candle.</p>
  `;

  const wasHidden = els.detail.hidden;
  els.detail.hidden = false;
  document.body.classList.add('no-scroll');
  state.detailMarkers = [];

  const showSignals = (signals, scopeNote) => {
    const box = $('btDetail');
    if (!box || state.openTicker !== ticker) return;
    box.innerHTML = stockBacktestHtml(ticker, signals, scopeNote);
    state.detailMarkers = signals.map(x => ({ t: x.t, type: x.type }));
    if (r.series) drawChart($('detailChart'), r, state.detailMarkers);
  };

  if (r.series) requestAnimationFrame(() => drawChart($('detailChart'), r, state.detailMarkers));

  if (isMarket && state.marketFile) {
    const tf = state.marketFile.timeframe;
    const btSummary = state.marketFile.backtest;
    $('btDetail').innerHTML = `<h3>Past signals on ${t}</h3><p class="hint">Loading…</p>`;
    loadBacktestFile(tf).then(file => {
      if (state.openTicker !== ticker || state.mode !== 'market') return;
      if (!file || !file.signals) {
        const box = $('btDetail');
        if (box) box.innerHTML = `<h3>Past signals on ${t}</h3><p class="hint">Backtest data will appear after the next scheduled scan.</p>`;
        return;
      }
      const signals = (file.signals[ticker] || []).map(unpackSignal);
      showSignals(signals, btScopeNote(btSummary || file, 'market'));
    });
  } else if (row.candles) {
    if (!row.bt) row.bt = backtestCandles(row.candles, s);
    showSignals(row.bt.signals, btScopeNote({ thresholds: thresholdsOf(s), from: row.bt.from, to: row.bt.to }, 'watchlist'));
  }

  if (wasHidden) {
    els.detail.querySelector('.sheet').scrollTop = 0;
    els.detailClose.focus({ preventScroll: true });
  }
}

function closeDetail() {
  if (!els.detail || els.detail.hidden) { state.openTicker = null; return; }
  const ticker = state.openTicker;
  els.detail.hidden = true;
  if (els.settingsSheet.hidden) document.body.classList.remove('no-scroll');
  state.openTicker = null;
  if (ticker) {
    const el = document.querySelector(`[data-ticker="${CSS.escape(ticker)}"]`);
    if (el && el.offsetParent !== null) el.focus({ preventScroll: true });
  }
}

/* ---------- Canvas chart ---------- */
function drawChart(canvas, r, markers = []) {
  if (!canvas || !r.series) return;
  const s = r.settings;
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(280, rect.width);
  const H = Math.max(260, rect.height);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const cs = getComputedStyle(document.documentElement);
  const C = name => cs.getPropertyValue(name).trim() || '#888';
  const col = {
    text: C('--muted'), grid: C('--grid'), price: C('--c-price'), macd: C('--c-macd'),
    signal: C('--c-signal'), up: C('--c-up'), down: C('--c-down'), rsi: C('--c-rsi'),
    band: C('--c-band'), current: C('--c-current'), surface: C('--surface'), approach: C('--approach'),
  };

  // Scan files store null for missing values; treat them as gaps.
  const clean = arr => (arr || []).map(v => (isNum(v) ? v : NaN));
  const ser = {
    time: r.series.time || [],
    close: clean(r.series.close), macd: clean(r.series.macd), signal: clean(r.series.signal),
    hist: clean(r.series.hist), rsi: clean(r.series.rsi),
  };
  const n = ser.close.length;
  if (n === 0) return;
  const padL = 6, padR = 62, top = 4, bottom = 22, gapY = 14;
  const plotW = W - padL - padR;
  const avail = H - top - bottom - gapY * 2;
  const heights = [avail * 0.42, avail * 0.33, avail * 0.25];
  const panes = [];
  let y = top;
  for (const h of heights) { panes.push({ y0: y, y1: y + h }); y += h + gapY; }
  const xAt = i => padL + (n <= 1 ? plotW : (i / (n - 1)) * plotW);

  ctx.font = '11px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  const range = (arrays, include = []) => {
    let lo = Infinity, hi = -Infinity;
    for (const a of arrays) for (const v of a) if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    for (const v of include) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isNum(lo) || !isNum(hi)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-12) { const d = Math.abs(hi) * 0.01 || 1; lo -= d; hi += d; }
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  };
  const yMapper = (pane, [lo, hi]) => v => pane.y1 - ((v - lo) / (hi - lo)) * (pane.y1 - pane.y0);

  const frame = (pane, title) => {
    ctx.strokeStyle = col.grid; ctx.lineWidth = 1;
    ctx.strokeRect(padL + 0.5, pane.y0 + 0.5, plotW, pane.y1 - pane.y0);
    ctx.fillStyle = col.text; ctx.textAlign = 'left';
    ctx.fillText(title, padL + 6, pane.y0 + 10);
  };
  const clip = (pane, fn) => {
    ctx.save(); ctx.beginPath(); ctx.rect(padL, pane.y0, plotW, pane.y1 - pane.y0); ctx.clip(); fn(); ctx.restore();
  };
  const line = (vals, ym, color, width = 1.6) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash([]);
    ctx.beginPath();
    let pen = false;
    vals.forEach((v, i) => {
      if (!isNum(v)) { pen = false; return; }
      const X = xAt(i), Y = ym(v);
      if (!pen) { ctx.moveTo(X, Y); pen = true; } else ctx.lineTo(X, Y);
    });
    ctx.stroke();
  };
  const hline = (ym, v, color, dash = [4, 4]) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(padL, ym(v)); ctx.lineTo(padL + plotW, ym(v)); ctx.stroke();
    ctx.setLineDash([]);
  };
  const usedLabelYs = [];
  const valueLabel = (v, ym, color, fmt, pane) => {
    if (!isNum(v)) return;
    let Y = Math.max(pane.y0 + 8, Math.min(pane.y1 - 8, ym(v)));
    for (const u of usedLabelYs) if (Math.abs(u - Y) < 16) Y = u + (Y >= u ? 16 : -16);
    usedLabelYs.push(Y);
    ctx.fillStyle = color;
    ctx.fillRect(padL + plotW + 3, Y - 8, padR - 5, 16);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    ctx.fillText(fmt(v), padL + plotW + 6, Y);
  };

  // Pane 1: price
  const pPrice = panes[0];
  const yPrice = yMapper(pPrice, range([ser.close]));
  frame(pPrice, 'Price');
  clip(pPrice, () => line(ser.close, yPrice, col.price, 1.6));

  // Past signals from the backtest: small triangles along the bottom of the price pane
  if (markers && markers.length) {
    const indexOf = new Map(ser.time.map((tm, i) => [String(tm), i]));
    for (const mk of markers) {
      const i = indexOf.get(String(mk.t));
      if (i === undefined) continue;
      const X = xAt(i), Y = pPrice.y1 - 3;
      ctx.fillStyle = mk.type === 'curl' ? col.up : col.approach;
      ctx.beginPath(); ctx.moveTo(X, Y - 8); ctx.lineTo(X - 5, Y); ctx.lineTo(X + 5, Y); ctx.closePath(); ctx.fill();
    }
  }

  // Pane 2: MACD / Signal / Histogram
  const pMacd = panes[1];
  const yMacd = yMapper(pMacd, range([ser.macd, ser.signal, ser.hist], [0]));
  frame(pMacd, 'MACD');
  clip(pMacd, () => {
    const bw = Math.max(1, (plotW / n) * 0.65);
    const y0 = yMacd(0);
    ser.hist.forEach((v, i) => {
      if (!isNum(v)) return;
      const prev = ser.hist[i - 1];
      const growing = isNum(prev) ? Math.abs(v) > Math.abs(prev) : true;
      ctx.globalAlpha = growing ? 0.75 : 0.4;
      ctx.fillStyle = v >= 0 ? col.up : col.down;
      const yv = yMacd(v);
      ctx.fillRect(xAt(i) - bw / 2, Math.min(y0, yv), bw, Math.max(1, Math.abs(yv - y0)));
    });
    ctx.globalAlpha = 1;
    hline(yMacd, 0, col.grid, [2, 3]);
    line(ser.signal, yMacd, col.signal, 1.6);
    line(ser.macd, yMacd, col.macd, 1.8);
  });

  // Pane 3: RSI
  const pRsi = panes[2];
  const yRsi = yMapper(pRsi, [0, 100]);
  frame(pRsi, `RSI(${s.rsiLen})`);
  clip(pRsi, () => {
    ctx.fillStyle = col.band;
    ctx.fillRect(padL, yRsi(s.rsiMax), plotW, yRsi(s.rsiMin) - yRsi(s.rsiMax));
    hline(yRsi, 70, col.grid);
    hline(yRsi, 30, col.grid);
    line(ser.rsi, yRsi, col.rsi, 1.6);
  });

  // Current candle marker
  const xc = xAt(n - 1);
  ctx.strokeStyle = col.current; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(xc, top); ctx.lineTo(xc, pRsi.y1); ctx.stroke();
  ctx.setLineDash([]);
  const dot = (v, ym, color) => {
    if (!isNum(v)) return;
    ctx.fillStyle = color; ctx.strokeStyle = col.surface; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(xc, ym(v), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  };
  dot(ser.close[n - 1], yPrice, col.price);
  dot(ser.signal[n - 1], yMacd, col.signal);
  dot(ser.macd[n - 1], yMacd, col.macd);
  dot(ser.rsi[n - 1], yRsi, col.rsi);

  // Right-hand value labels for the current candle
  valueLabel(ser.close[n - 1], yPrice, col.price, fmtPrice, pPrice);
  valueLabel(ser.macd[n - 1], yMacd, col.macd, fmtNum, pMacd);
  valueLabel(ser.signal[n - 1], yMacd, col.signal, fmtNum, pMacd);
  valueLabel(ser.rsi[n - 1], yRsi, col.rsi, v => v.toFixed(1), pRsi);

  // Dates
  ctx.fillStyle = col.text;
  ctx.textAlign = 'left';
  ctx.fillText(String(ser.time[0] ?? ''), padL, H - 9);
  ctx.textAlign = 'right';
  ctx.fillText(`Current: ${ser.time[n - 1] ?? ''}`, xc, H - 9);
}

/* ---------- Boot ---------- */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

// Lets scanner/scan.js (Node) reuse exactly the same maths. Ignored in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG, DEFAULT_SETTINGS, ScreenerError,
    ema, computeMACD, rsiWilder, sma, cleanCandles,
    computeMetrics, classify, evaluate, analyze, parseTickers,
    BT, backtestCandles, summarizeSignals, summarizeBacktest, packSignal, unpackSignal,
    SETUP, addSessions, setupIndicators, setupFlags, setupLevels, trackSetup, describeSetup, scanSetups,
  };
}
