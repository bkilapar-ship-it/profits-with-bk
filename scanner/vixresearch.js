#!/usr/bin/env node
/*
 * VIX research for the Uptrend Dip.
 *
 * Question 1 (the main one): does the VIX on the signal day tell us anything about how the Dip trade turns out? Every Dip
 *   signal is traded exactly as the live plan does (buy the next open, skipped above the 2% cap; +4% target; 3 ATR stop; exit
 *   at the close of session 3) and then grouped by what the VIX was doing at the signal close: its level, its spike against the
 *   10-day average, whether it is falling from its 5-day high (fear peaking), where it sits in the past year's range, and the
 *   term structure (VIX against the 3-month VIX).
 * Question 2: four rules written down BEFORE looking at any result are scored against all other signals, per period.
 * Question 3 (exploratory, thin sample): what did SPY do after VIX fear spikes?
 *
 * The VIX is used only as a signal. VXX and other VIX ETPs lose value by design and can collapse, so nothing here trades them.
 *
 * Data: VIX and VIX3M daily history from Cboe (FRED as a fallback), daily bars for SPY and for S&P 500 members from Alpaca.
 * Same Dip definition as the live system (../app.js), S&P 500 members at the time, $20M/day floor. Read-only.
 *
 * Usage: ALPACA_KEY_ID=... ALPACA_SECRET_KEY=... node scanner/vixresearch.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../app.js');

const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const CFG = {
  keyId: env.ALPACA_KEY_ID || '', secret: env.ALPACA_SECRET_KEY || '',
  dataBase: (env.ALPACA_DATA_BASE || 'https://data.alpaca.markets').replace(/\/+$/, ''),
  feed: (env.ALPACA_FEED || 'sip').toLowerCase(),
  rpm: num(env.ALPACA_RPM, 190),
  start: env.VR_START || '2015-06-01',
  testFrom: env.VR_TEST_FROM || '2016-06-01',
  maxSymbols: num(env.VR_MAX_SYMBOLS, 0),
  batch: num(env.VR_BATCH, 50),
  out: env.VR_OUT || 'research-out-vix',
  minDollarVol: num(env.VR_MIN_DOLLAR_VOL, 20e6),
  vixUrls: [env.VR_VIX_URL || 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS'],
  vix3mUrls: [env.VR_VIX3M_URL || 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=VXVCLS'],
};
const PERIODS = [['Oct 2016 to 2019', '2016-01-01', '2019-12-31'], ['2020 to 2022', '2020-01-01', '2022-12-31'], ['2023 to 2026', '2023-01-01', '2026-12-31']];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const f2 = x => (isNum(x) ? x.toFixed(2) : '  - ');
const p0 = x => (isNum(x) ? `${(x * 100).toFixed(0)}%` : ' - ');

/* ------------------------------------------------------------------ VIX data */
/** Parses a Cboe or FRED daily CSV into [{ date: 'YYYY-MM-DD', close }] sorted by date. */
function parseSeries(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map(s => s.trim().toLowerCase());
  const closeIdx = head.includes('close') ? head.indexOf('close') : 1;       // Cboe has a CLOSE column, FRED has one value column
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    let d = (cells[0] || '').trim();
    const us = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (us) d = `${us[3]}-${us[1]}-${us[2]}`; else if (/^\d{4}-\d{2}-\d{2}/.test(d)) d = d.slice(0, 10); else continue;
    const v = parseFloat(cells[closeIdx]);
    if (Number.isFinite(v) && v > 0) out.push({ date: d, close: v });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
async function fetchText(url) {
  let last = '';
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (research script)', Accept: 'text/csv,*/*' }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return res.text();
      last = `HTTP ${res.status}`;
    } catch (e) { last = e.message; }
    await sleep(1500 * (a + 1));
  }
  throw new Error(last);
}
async function loadSeries(urls, label) {
  for (const url of urls) {
    try {
      const s = parseSeries(await fetchText(url));
      if (s.length > 500) { log(`${label}: ${s.length} days from ${url.includes('cboe') ? 'Cboe' : 'FRED'} (${s[0].date} to ${s[s.length - 1].date})`); return { series: s, source: url.includes('cboe') ? 'Cboe' : 'FRED' }; }
      log(`${label}: ${url} returned only ${s.length} usable rows; trying the next source`);
    } catch (e) { log(`${label}: ${url} failed (${e.message}); trying the next source`); }
  }
  return null;
}

/** Features for every VIX date, using only data up to and including that day's close. */
function vixFeatures(series, series3m) {
  const c = series.map(s => s.close), m3 = new Map((series3m || []).map(s => [s.date, s.close])), out = new Map();
  for (let i = 0; i < series.length; i++) {
    if (i < 9) continue;
    const win252 = c.slice(Math.max(0, i - 251), i + 1);
    const sma10 = mean(c.slice(i - 9, i + 1)), high5 = Math.max(...c.slice(i - 4, i + 1));
    out.set(series[i].date, {
      vix: c[i], chg1: (c[i] / c[i - 1] - 1) * 100, spike: (c[i] / sma10 - 1) * 100, offPeak: (c[i] / high5 - 1) * 100,
      pct: win252.length >= 126 ? (win252.filter(x => x <= c[i]).length / win252.length) * 100 : null,
      ratio: m3.has(series[i].date) ? c[i] / m3.get(series[i].date) : null,
    });
  }
  return out;
}

/* ---------------------------------------------------------- trade simulation */
function simulate(P, i, entry, atr) {
  const stop = entry - 3 * atr, target = entry * 1.04;
  for (let d = 1; d <= 3; d++) {
    const k = i + d;
    if (d > 1) {
      if (P.o[k] >= target) return { pct: (P.o[k] / entry - 1) * 100, how: 'target' };
      if (P.o[k] <= stop) return { pct: (P.o[k] / entry - 1) * 100, how: 'stop' };
    }
    if (P.l[k] <= stop) return { pct: (stop / entry - 1) * 100, how: 'stop' };
    if (P.h[k] >= target) return { pct: 4, how: 'target' };
    if (d === 3) return { pct: (P.c[k] / entry - 1) * 100, how: 'time' };
  }
  return null;
}
function measure(P, i, atr) {
  const close = P.c[i], openNext = P.o[i + 1];
  if (!(openNext <= close * 1.02)) return { filled: false };      // the live 2% entry cap
  const s = simulate(P, i, openNext, atr);
  return { filled: true, plan: s.pct, how: s.how };
}

/* --------------------------------------------------------------------- stats */
function seMean(rows, f) {
  const by = new Map();
  for (const r of rows) { const v = f(r); if (!isNum(v)) continue; if (!by.has(r.date)) by.set(r.date, []); by.get(r.date).push(v); }
  const m = [...by.values()].map(mean), n = m.length;
  if (n < 3) return NaN;
  const mu = mean(m);
  return Math.sqrt(m.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1)) / Math.sqrt(n);
}
/** OLS slope of y on x with a standard error that clusters signals sharing a date. */
function slope(rows, xf, yf) {
  const pts = rows.filter(r => isNum(xf(r)) && isNum(yf(r)));
  if (pts.length < 30) return { b: NaN, t: NaN };
  const mx = mean(pts.map(xf)), my = mean(pts.map(yf));
  let sxx = 0; for (const r of pts) sxx += (xf(r) - mx) ** 2;
  if (!(sxx > 0)) return { b: NaN, t: NaN };
  const b = pts.reduce((s, r) => s + (xf(r) - mx) * (yf(r) - my), 0) / sxx, by = new Map();
  for (const r of pts) { const e = (yf(r) - my) - b * (xf(r) - mx); by.set(r.date, (by.get(r.date) || 0) + (xf(r) - mx) * e); }
  const se = Math.sqrt([...by.values()].reduce((s, u) => s + u * u, 0)) / sxx;
  if (by.size < 3 || !(se > 0)) return { b, t: NaN };          // fewer than 3 distinct dates cannot measure variance
  return { b, t: b / se };
}
function statsFor(rows) {
  const t = rows.filter(r => r.filled), share = f => (t.length ? t.filter(f).length / t.length : NaN);
  return { n: rows.length, bought: t.length, avg: mean(t.map(r => r.plan)), pm: 1.96 * seMean(t, r => r.plan), win: share(r => r.plan > 0), hit: share(r => r.how === 'target'), stop: share(r => r.how === 'stop') };
}
function compare(rows, test) {
  const b = rows.filter(r => r.filled), g = b.filter(test), r = b.filter(x => !test(x));
  if (g.length < 8 || r.length < 8) return { n: g.length, mean: NaN, rest: NaN, diff: NaN, t: NaN };
  const diff = mean(g.map(x => x.plan)) - mean(r.map(x => x.plan)), se = Math.sqrt(seMean(g, x => x.plan) ** 2 + seMean(r, x => x.plan) ** 2);
  return { n: g.length, mean: mean(g.map(x => x.plan)), rest: mean(r.map(x => x.plan)), diff, t: diff / se };
}

/* ---------------------------------------------------------- families and rules */
const FAMILIES = [
  { title: 'VIX LEVEL on the signal day', key: 'vix', unit: 10, unitLabel: 'per +10 VIX points', buckets: [['below 15 (calm)', v => v < 15], ['15 to 20', v => v >= 15 && v < 20], ['20 to 25', v => v >= 20 && v < 25], ['25 to 30', v => v >= 25 && v < 30], ['30 or more (panic)', v => v >= 30]] },
  { title: 'VIX SPIKE: the VIX against its own 10-day average', key: 'spike', unit: 10, unitLabel: 'per +10 points of spike', buckets: [['below its average', v => v < 0], ['0 to 10% above', v => v >= 0 && v < 10], ['10 to 25% above', v => v >= 10 && v < 25], ['25% or more above', v => v >= 25]] },
  { title: 'IS FEAR PEAKING? the VIX against its 5-day high', key: 'offPeak', buckets: [['at its 5-day high (within 1%)', v => v >= -1], ['1% to 5% below the high', v => v >= -5 && v < -1], ['more than 5% below the high', v => v < -5]] },
  { title: 'VIX PERCENTILE of the past year', key: 'pct', unit: 10, unitLabel: 'per +10 percentile points', buckets: [['bottom 20% (calm)', v => v < 20], ['20% to 50%', v => v >= 20 && v < 50], ['50% to 80%', v => v >= 50 && v < 80], ['top 20% (fearful)', v => v >= 80]] },
  { title: 'TERM STRUCTURE: VIX against the 3-month VIX', key: 'ratio', buckets: [['contango (below 0.95)', v => v < 0.95], ['flat (0.95 to 1.00)', v => v >= 0.95 && v < 1], ['backwardation (1.00 or more)', v => v >= 1]] },
];
// Written down before any result was looked at. "boost" rules should help; the "calm" rule should hurt.
const RULES = [
  { id: 'R1', label: 'Fear: VIX 25 or more', expect: 'boost', test: r => r.vix >= 25 },
  { id: 'R2', label: 'Fear peaking: VIX 25+ and at least 3% below its 5-day high', expect: 'boost', test: r => r.vix >= 25 && r.offPeak <= -3 },
  { id: 'R3', label: 'Calm: VIX below 15', expect: 'weak', test: r => r.vix < 15 },
  { id: 'R4', label: 'Spike: VIX at least 20% above its 10-day average', expect: 'boost', test: r => r.spike >= 20 },
];
const inP = (r, [, a, b]) => r.date >= a && r.date <= b;

/* ------------------------------------------------------------------- SPY events */
/** Keeps the first event day of each cluster (events within `gap` trading days of the last kept one are dropped). */
function episodes(idxs, gap = 10) { const out = []; for (const i of idxs) if (!out.length || i - out[out.length - 1] > gap) out.push(i); return out; }
const EVENTS = [
  ['VIX closes at 30 or more', f => f.vix >= 30],
  ['VIX 25+ and 20%+ above its 10-day average', f => f.vix >= 25 && f.spike >= 20],
  ['VIX 25+ and 3%+ below its 5-day high (fear peaking)', f => f.vix >= 25 && f.offPeak <= -3],
];
function eventStudy(spy, feats) {
  const H = [1, 3, 5, 10], n = spy.length, out = [];
  const fwd = (t, h) => (t + h < n ? (spy[t + h].c / spy[t].c - 1) * 100 : null);
  for (const [name, test] of EVENTS) {
    const idxs = []; for (let t = 0; t < n; t++) { const f = feats.get(spy[t].date); if (f && test(f)) idxs.push(t); }
    const eps = episodes(idxs);
    for (const p of [['ALL PERIODS', '0000', '9999'], ...PERIODS]) {
      const ev = eps.filter(t => spy[t].date >= p[1] && spy[t].date <= p[2]);
      const base = []; for (let t = 0; t < n; t++) if (spy[t].date >= p[1] && spy[t].date <= p[2]) base.push(t);
      const row = { name, period: p[0], episodes: ev.length, days: idxs.filter(t => spy[t].date >= p[1] && spy[t].date <= p[2]).length, avg: {}, base: {}, win5: NaN, worst5: NaN };
      for (const h of H) { row.avg[h] = mean(ev.map(t => fwd(t, h)).filter(isNum)); row.base[h] = mean(base.map(t => fwd(t, h)).filter(isNum)); }
      const f5 = ev.map(t => fwd(t, 5)).filter(isNum); row.win5 = f5.length ? f5.filter(x => x > 0).length / f5.length : NaN; row.worst5 = f5.length ? Math.min(...f5) : NaN;
      out.push(row);
    }
  }
  return out;
}

/* --------------------------------------------------------------------- report */
function buildReport(recs, spyRows, meta) {
  const L = [];
  L.push(`RUN CHECK: VIX ${meta.vixRows} days (${meta.vixRange}, ${meta.vixSource}); 3-month VIX ${meta.v3mRows ? `${meta.v3mRows} days (${meta.v3mSource})` : 'NOT AVAILABLE (term-structure table skipped)'}; ${meta.symbols} stocks with data, ${meta.skipped} download batches skipped; ${meta.total} Dip signals, ${recs.length} with a VIX reading.`);
  L.push('');
  L.push('VIX RESEARCH: does the VIX on the signal day predict how an Uptrend Dip trade turns out?');
  L.push('Live plan: buy the next open (skip if above the 2% cap), +4% target, 3 ATR stop, exit at the close of session 3. S&P 500 members at the time, before costs. "avg" is per trade bought, with a 95% margin that treats signals on the same day as one observation.');
  L.push('A VIX rule is only worth building if it beats (or, for a skip rule, trails) all other signals in ALL THREE periods and the overall t-statistic is at least 2 (or at most -2).');
  const pr = [['ALL PERIODS', '0000', '9999'], ...PERIODS];
  L.push('');
  L.push('='.repeat(130));
  L.push('1. THE FOUR RULES WRITTEN DOWN IN ADVANCE (vs every other signal)');
  L.push('='.repeat(130));
  for (const rule of RULES) {
    L.push('');
    L.push(` ${rule.id}: ${rule.label}   [expected to ${rule.expect === 'boost' ? 'HELP' : 'HURT'}]`);
    const res = pr.map(p => ({ p, c: compare(recs.filter(r => r.date >= p[1] && r.date <= p[2]), rule.test) }));
    for (const { p, c } of res) L.push(`   ${p[0].padEnd(18)} trades ${String(c.n).padStart(4)} | ${f2(c.mean).padStart(6)}% vs ${f2(c.rest).padStart(6)}% for the rest | difference ${f2(c.diff).padStart(6)}% (t = ${f2(c.t)})`);
    const per = res.slice(1), all = res[0].c, sign = rule.expect === 'boost' ? 1 : -1;
    const ok = per.every(x => isNum(x.c.diff) && sign * x.c.diff > 0) && isNum(all.t) && sign * all.t >= 2;
    L.push(`   VERDICT: ${ok ? 'PASSES the rule (right direction in all three periods and |t| >= 2)' : 'does NOT pass (' + (per.some(x => !isNum(x.c.diff)) ? 'too few trades in a period' : per.every(x => sign * x.c.diff > 0) ? 'consistent direction but overall |t| below 2' : 'direction not consistent across the periods') + ')'}`);
  }
  L.push('');
  L.push('='.repeat(130));
  L.push('2. EVERY GROUPING, PER PERIOD');
  L.push('='.repeat(130));
  for (const fam of FAMILIES) {
    if (fam.key === 'ratio' && !meta.v3mRows) continue;
    L.push('');
    L.push(` ${fam.title}`);
    for (const p of pr) {
      const rows = recs.filter(r => r.date >= p[1] && r.date <= p[2] && isNum(r[fam.key]));
      L.push(`  ${p[0]}  (${rows.length} signals)`);
      for (const [label, test] of fam.buckets) {
        const s = statsFor(rows.filter(r => test(r[fam.key])));
        L.push(s.n ? `    ${label.padEnd(32)} signals ${String(s.n).padStart(4)} | bought ${String(s.bought).padStart(4)} | avg ${f2(s.avg).padStart(6)}% ±${f2(s.pm).padStart(5)} | win ${p0(s.win).padStart(4)} | hit +4% ${p0(s.hit).padStart(4)} | stopped ${p0(s.stop).padStart(3)}` : `    ${label.padEnd(32)} signals    0`);
      }
      if (fam.unit) { const sl = slope(rows.filter(r => r.filled), r => r[fam.key] / fam.unit, r => r.plan); L.push(`    trend: ${f2(sl.b)}% ${fam.unitLabel} (t = ${f2(sl.t)})`); }
    }
  }
  L.push('');
  L.push('='.repeat(130));
  L.push('3. EXPLORATORY: SPY AFTER VIX FEAR SPIKES (first day of each episode; entry at that day\'s close; few episodes, so read as colour only)');
  L.push('='.repeat(130));
  let last = '';
  for (const r of spyRows) {
    if (r.name !== last) { L.push(''); L.push(` ${r.name}`); last = r.name; }
    L.push(`   ${r.period.padEnd(18)} episodes ${String(r.episodes).padStart(3)} (${String(r.days).padStart(3)} qualifying days) | avg SPY return after 1/3/5/10 days: ${[1, 3, 5, 10].map(h => `${f2(r.avg[h]).padStart(6)}%`).join(' ')} | all days: ${[1, 3, 5, 10].map(h => `${f2(r.base[h]).padStart(5)}%`).join(' ')} | up after 5 days ${p0(r.win5).padStart(4)} | worst 5-day ${f2(r.worst5).padStart(6)}%`);
  }
  return L.join('\n');
}

/* ------------------------------------------------------------------- download */
const limiter = { stamps: [], async acquire() { for (;;) { const now = Date.now(); this.stamps = this.stamps.filter(t => now - t < 60000); if (this.stamps.length < CFG.rpm) { this.stamps.push(now); return; } await sleep(60000 - (now - this.stamps[0]) + 50); } } };
async function get(url, attempt = 0) {
  await limiter.acquire();
  let res;
  try { res = await fetch(url, { headers: { 'APCA-API-KEY-ID': CFG.keyId, 'APCA-API-SECRET-KEY': CFG.secret, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) }); }
  catch (e) { if (attempt < 4) { await sleep(2000 * 2 ** attempt); return get(url, attempt + 1); } throw new Error(`Network error: ${e.message}`); }
  if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(Math.min(3000 * 2 ** attempt, 60000)); return get(url, attempt + 1); }
  if (!res.ok) throw new Error(`Alpaca HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}
async function fetchDaily(symbols) {
  const out = new Map(symbols.map(s => [s, []]));
  let token = null;
  do {
    const q = new URLSearchParams({ symbols: symbols.join(','), timeframe: '1Day', start: CFG.start, adjustment: 'split', feed: CFG.feed, limit: '10000', sort: 'asc' });
    if (token) q.set('page_token', token);
    const j = await get(`${CFG.dataBase}/v2/stocks/bars?${q.toString()}`);
    for (const [sym, list] of Object.entries(j.bars || {})) { const arr = out.get(sym); if (arr) for (const b of list) arr.push({ t: String(b.t).slice(0, 10), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }); }
    token = j.next_page_token || null;
  } while (token);
  return out;
}
function signalsFor(sym, candles, isSp, feats) {
  const clean = core.cleanCandles(candles);
  if (clean.length < 260) return [];
  const ind = core.setupIndicators(clean), P = { o: ind.o, h: ind.h, l: ind.l, c: ind.c }, out = [];
  for (let i = 200; i < clean.length - 3; i++) {
    const date = clean[i].t;
    if (date < CFG.testFrom || !isSp(sym, date)) continue;
    const f = core.setupFlags(ind, i);
    if (!f || !f.dip || !isNum(f.atr) || f.atr <= 0 || !(f.dollarVol >= CFG.minDollarVol)) continue;
    out.push({ date, sym, vixKnown: feats.has(date), ...(feats.get(date) || {}), ...measure(P, i, f.atr) });
  }
  return out;
}

async function main() {
  if (!CFG.keyId || !CFG.secret) throw new Error('ALPACA_KEY_ID and ALPACA_SECRET_KEY are required.');
  const vix = await loadSeries(CFG.vixUrls, 'VIX');
  if (!vix) throw new Error('Could not download VIX history from Cboe or FRED. Nothing to analyse; check the run log above.');
  const v3m = await loadSeries(CFG.vix3mUrls, 'VIX3M');
  const feats = vixFeatures(vix.series, v3m ? v3m.series : null);
  const hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'sp500_history.json'), 'utf8')).members;
  const isSp = (sym, d) => (hist[sym] || []).some(([a, b]) => d >= a && (b === null || d < b));
  let symbols = Object.keys(hist).filter(s => /^[A-Z.]{1,6}$/.test(s) && hist[s].some(([, b]) => b === null || b >= CFG.testFrom)).sort();
  if (CFG.maxSymbols) symbols = symbols.slice(0, CFG.maxSymbols);
  log(`Symbols: ${symbols.length}`);
  const spyBars = (await fetchDaily(['SPY'])).get('SPY').map(b => ({ date: b.t, c: b.c }));
  log(`SPY: ${spyBars.length} days`);
  const all = []; let withData = 0, skipped = 0;
  for (let b = 0; b < symbols.length; b += CFG.batch) {
    const chunk = symbols.slice(b, b + CFG.batch); let bars = null;
    try { bars = await fetchDaily(chunk); } catch (e) { skipped++; log(`  BATCH SKIPPED (${chunk[0]}..${chunk[chunk.length - 1]}): ${e.message}`); }
    if (bars) for (const [sym, list] of bars) { if (list.length < 260) continue; withData++; for (const r of signalsFor(sym, list, isSp, feats)) all.push(r); }
    log(`  ${Math.min(b + CFG.batch, symbols.length)}/${symbols.length} symbols, ${withData} with data, ${all.length} Dip signals so far`);
  }
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sym < b.sym ? -1 : 1));
  const recs = all.filter(r => r.vixKnown);
  const meta = { vixRows: vix.series.length, vixRange: `${vix.series[0].date} to ${vix.series[vix.series.length - 1].date}`, vixSource: vix.source, v3mRows: v3m ? v3m.series.length : 0, v3mSource: v3m ? v3m.source : '', symbols: withData, skipped, total: all.length };
  fs.mkdirSync(CFG.out, { recursive: true });
  const report = recs.length ? buildReport(recs, eventStudy(spyBars, feats), meta) : `RUN CHECK: ${all.length} Dip signals but none matched a VIX date. Check the data download above.`;
  fs.writeFileSync(path.join(CFG.out, 'summary.txt'), report + '\n');
  const csv = ['date,sym,vix,chg1Pct,spikePct,offPeakPct,pctRank,vixOver3m,filled,planPct,how']
    .concat(recs.map(r => [r.date, r.sym, r.vix, r.chg1.toFixed(2), r.spike.toFixed(2), r.offPeak.toFixed(2), isNum(r.pct) ? r.pct.toFixed(1) : '', isNum(r.ratio) ? r.ratio.toFixed(3) : '', r.filled ? 1 : 0, isNum(r.plan) ? r.plan.toFixed(3) : '', r.how || ''].join(',')));
  fs.writeFileSync(path.join(CFG.out, 'signals.csv'), csv.join('\n') + '\n');
  console.log('\n' + report);
  log(`Done: ${recs.length} signals with a VIX reading; results in ${CFG.out}/`);
}

if (require.main === module) main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
module.exports = { parseSeries, vixFeatures, simulate, measure, slope, seMean, statsFor, compare, episodes, eventStudy, buildReport, signalsFor, FAMILIES, RULES };
