#!/usr/bin/env node
/*
 * Gap research for the Uptrend Dip: what happened when the open was about 1-2% lower than the previous close?
 *
 * "Setup day" can mean two things, so both are measured from the same signals:
 *   A) ENTRY DAY  - the open on the day we would buy (the session after the signal) versus the signal day's close.
 *                   This is the gap the live system actually faces at 9:30.
 *   B) SIGNAL DAY - the open on the signal day itself versus the close the day before.
 *
 * Every Dip signal is then traded exactly as the live plan does: buy at the next session's open (skipped if it opens more
 * than 2% above the signal close), +4% target, 3 ATR stop, exit at the close of session 3 at the latest. Stop is checked
 * before target inside a day (conservative). Before costs.
 *
 * Same signal definition as the live system (../app.js), S&P 500 members at the time, $20M/day floor.
 * Read-only: downloads daily bars with your Alpaca keys, never touches orders.
 *
 * Usage: ALPACA_KEY_ID=... ALPACA_SECRET_KEY=... node scanner/gapresearch.js
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
  start: env.GR_START || '2015-06-01',
  testFrom: env.GR_TEST_FROM || '2016-06-01',
  maxSymbols: num(env.GR_MAX_SYMBOLS, 0),
  batch: num(env.GR_BATCH, 50),
  out: env.GR_OUT || 'research-out-gap',
  minDollarVol: num(env.GR_MIN_DOLLAR_VOL, 20e6),
};
// Alpaca's daily history starts in January 2016, so with the 200-day warm-up the first signals appear in October 2016.
const PERIODS = [['Oct 2016 to 2019', '2016-01-01', '2019-12-31'], ['2020 to 2022', '2020-01-01', '2022-12-31'], ['2023 to 2026', '2023-01-01', '2026-12-31']];
const BUCKETS = [
  { id: 'lt-2', label: 'more than 2% lower', test: g => g < -2 },
  { id: 'm2_m1', label: '1% to 2% lower   <== YOUR QUESTION', test: g => g >= -2 && g < -1, focus: true },
  { id: 'm1_0', label: 'less than 1% lower', test: g => g >= -1 && g < 0 },
  { id: '0_1', label: 'flat to 1% higher', test: g => g >= 0 && g < 1 },
  { id: '1_2', label: '1% to 2% higher', test: g => g >= 1 && g <= 2 },
  { id: 'gt2', label: 'more than 2% higher', test: g => g > 2 },
];
const bucketOf = g => BUCKETS.find(b => b.test(g)).id;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------ trade simulation */
/** Long trade bought at the open of session 1 after signal index i. Returns { pct, how, day }. */
function simulate(P, i, entry, atr) {
  const stop = entry - 3 * atr, target = entry * 1.04;
  for (let d = 1; d <= 3; d++) {
    const k = i + d;
    if (d > 1) {
      if (P.o[k] >= target) return { pct: (P.o[k] / entry - 1) * 100, how: 'target', day: d };
      if (P.o[k] <= stop) return { pct: (P.o[k] / entry - 1) * 100, how: 'stop', day: d };
    }
    if (P.l[k] <= stop) return { pct: (stop / entry - 1) * 100, how: 'stop', day: d };
    if (P.h[k] >= target) return { pct: 4, how: 'target', day: d };
    if (d === 3) return { pct: (P.c[k] / entry - 1) * 100, how: 'time', day: d };
  }
  return null;
}

/** Everything measured for one signal at index i. */
function measure(P, i, atr) {
  const prevClose = P.c[i - 1], close = P.c[i], openNext = P.o[i + 1];
  const g0 = (P.o[i] / prevClose - 1) * 100;          // B: signal-day open vs the day before
  const g1 = (openNext / close - 1) * 100;            // A: entry-day open vs the signal close
  const filled = openNext <= close * 1.02;            // the live 2% entry cap
  const rec = { g0, g1, filled, prevClose, openSignal: P.o[i], close, openNext };
  if (filled) {
    const s = simulate(P, i, openNext, atr);
    const lo = Math.min(P.l[i + 1], P.l[i + 2], P.l[i + 3]), hi = Math.max(P.h[i + 1], P.h[i + 2], P.h[i + 3]);
    Object.assign(rec, { plan: s.pct, how: s.how, exitDay: s.day, plain3: (P.c[i + 3] / openNext - 1) * 100, day1: (P.c[i + 1] / openNext - 1) * 100,
      mae: (lo / openNext - 1) * 100, mfe: (hi / openNext - 1) * 100 });
  }
  return rec;
}

/* ----------------------------------------------------------------------- stats */
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const f2 = x => (isNum(x) ? x.toFixed(2) : '   - ');
const p0 = x => (isNum(x) ? `${(x * 100).toFixed(0)}%` : ' - ');
/** Standard error of the mean of f over rows, clustering rows that share a date (many signals fire on the same day). */
function seMean(rows, f) {
  const by = new Map();
  for (const r of rows) { const v = f(r); if (!isNum(v)) continue; if (!by.has(r.date)) by.set(r.date, []); by.get(r.date).push(v); }
  const m = [...by.values()].map(mean), n = m.length;
  if (n < 3) return NaN;
  const mu = mean(m);
  return Math.sqrt(m.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1)) / Math.sqrt(n);
}
function statsFor(rows) {
  const t = rows.filter(r => r.filled);
  const share = (f) => (t.length ? t.filter(f).length / t.length : NaN);
  return { n: rows.length, traded: t.length, plan: mean(t.map(r => r.plan)), se: seMean(t, r => r.plan), win: share(r => r.plan > 0), hit: share(r => r.how === 'target'),
    stop: share(r => r.how === 'stop'), day1: mean(t.map(r => r.day1)), mae: mean(t.map(r => r.mae)), mfe: mean(t.map(r => r.mfe)), plain3: mean(t.map(r => r.plain3)) };
}

/* ---------------------------------------------------------------------- report */
function table(rows, key, labelFn) {
  const L = [];
  const head = '  open vs previous close                       signals  share | bought | avg trade (live plan) | win  | hit +4% | stopped | day-1 open>close | worst dip | best high | plain 3-day hold';
  L.push(head);
  for (const b of BUCKETS) {
    const sel = rows.filter(r => bucketOf(r[key]) === b.id), s = statsFor(sel);
    if (!sel.length) { L.push(`  ${labelFn(b).padEnd(44)}       0`); continue; }
    const pm = isNum(s.plan) ? `${f2(s.plan).padStart(6)}% ±${f2(1.96 * s.se)}` : '      -        ';
    L.push(`  ${labelFn(b).padEnd(44)} ${String(s.n).padStart(6)}  ${p0(s.n / rows.length).padStart(4)} | ${String(s.traded).padStart(6)} | ${pm.padEnd(21)} | ${p0(s.win).padStart(4)} | ${p0(s.hit).padStart(6)}  | ${p0(s.stop).padStart(6)}  | ${f2(s.day1).padStart(8)}%        | ${f2(s.mae).padStart(7)}%  | ${f2(s.mfe).padStart(7)}%  | ${f2(s.plain3).padStart(6)}%`);
  }
  const all = statsFor(rows);
  L.push(`  ${'ALL signals in this period'.padEnd(44)} ${String(all.n).padStart(6)}  100% | ${String(all.traded).padStart(6)} | ${(`${f2(all.plan).padStart(6)}% ±${f2(1.96 * all.se)}`).padEnd(21)} | ${p0(all.win).padStart(4)} | ${p0(all.hit).padStart(6)}  | ${p0(all.stop).padStart(6)}  | ${f2(all.day1).padStart(8)}%        | ${f2(all.mae).padStart(7)}%  | ${f2(all.mfe).padStart(7)}%  | ${f2(all.plain3).padStart(6)}%`);
  const focus = rows.filter(r => bucketOf(r[key]) === 'm2_m1' && r.filled), rest = rows.filter(r => bucketOf(r[key]) !== 'm2_m1' && r.filled);
  if (focus.length >= 5) {
    const a = mean(focus.map(r => r.plan)), b2 = mean(rest.map(r => r.plan)), se = Math.sqrt(seMean(focus, r => r.plan) ** 2 + seMean(rest, r => r.plan) ** 2);
    L.push(`  => 1-2% lower: ${f2(a)}% per trade vs ${f2(b2)}% for every other signal: difference ${f2(a - b2)}% (t = ${f2((a - b2) / se)}; |t| of 2 or more is the usual bar)`);
  } else L.push('  => too few 1-2% lower signals in this period to compare');
  return L;
}

function buildReport(recs) {
  const L = [];
  L.push('GAP RESEARCH: Uptrend Dip signals, grouped by how the open compares with the previous close');
  L.push(`S&P 500 members at the time, $${(CFG.minDollarVol / 1e6).toFixed(0)}M/day floor, ${recs.length} Dip signals. Live plan: buy the next open (skip if more than 2% above the signal close), +4% target, 3 ATR stop, exit at the close of session 3. Before costs.`);
  L.push('"avg trade" is per trade bought, with a +/- 95% margin (signals on the same day are treated as one observation). "worst dip"/"best high" are measured from the entry open within the 3 sessions. "plain 3-day hold" ignores target and stop.');
  const defs = [
    ['A', 'g1', 'A) ENTRY-DAY GAP: the open on the day we buy, versus the signal day\'s close', b => (b.id === 'gt2' ? 'more than 2% higher (skipped by the 2% cap)' : b.label)],
    ['B', 'g0', 'B) SIGNAL-DAY GAP: the open on the signal day itself, versus the close the day before', b => b.label],
  ];
  for (const [id, key, title, labelFn] of defs) {
    L.push('');
    L.push('='.repeat(150));
    L.push(title);
    L.push('='.repeat(150));
    for (const [name, a, b] of [['ALL PERIODS', '0000', '9999'], ...PERIODS]) {
      const rows = recs.filter(r => r.date >= a && r.date <= b);
      L.push('');
      L.push(` ${name}  (${rows.length} signals)`);
      L.push(...table(rows, key, labelFn));
    }
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

function signalsFor(sym, candles, isSp) {
  const clean = core.cleanCandles(candles);
  if (clean.length < 260) return [];
  const ind = core.setupIndicators(clean);
  const P = { o: ind.o, h: ind.h, l: ind.l, c: ind.c };
  const out = [];
  for (let i = 200; i < clean.length - 3; i++) {
    const date = clean[i].t;
    if (date < CFG.testFrom || !isSp(sym, date)) continue;
    const f = core.setupFlags(ind, i);
    if (!f || !f.dip || !isNum(f.atr) || f.atr <= 0 || !(f.dollarVol >= CFG.minDollarVol)) continue;
    out.push({ date, sym, atr: f.atr, ...measure(P, i, f.atr) });
  }
  return out;
}

async function main() {
  if (!CFG.keyId || !CFG.secret) throw new Error('ALPACA_KEY_ID and ALPACA_SECRET_KEY are required.');
  const hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'sp500_history.json'), 'utf8')).members;
  const isSp = (sym, d) => (hist[sym] || []).some(([a, b]) => d >= a && (b === null || d < b));
  let symbols = Object.keys(hist).filter(s => /^[A-Z.]{1,6}$/.test(s) && hist[s].some(([, b]) => b === null || b >= CFG.testFrom)).sort();
  if (CFG.maxSymbols) symbols = symbols.slice(0, CFG.maxSymbols);
  log(`Symbols: ${symbols.length} (S&P 500 members at any point since ${CFG.testFrom})`);
  const recs = []; let withData = 0, skipped = 0;
  for (let b = 0; b < symbols.length; b += CFG.batch) {
    const chunk = symbols.slice(b, b + CFG.batch);
    let bars = null;
    try { bars = await fetchDaily(chunk); } catch (e) { skipped++; log(`  BATCH SKIPPED (${chunk[0]}..${chunk[chunk.length - 1]}): ${e.message}`); }
    if (bars) for (const [sym, list] of bars) { if (list.length < 260) continue; withData++; for (const r of signalsFor(sym, list, isSp)) recs.push(r); }
    log(`  ${Math.min(b + CFG.batch, symbols.length)}/${symbols.length} symbols, ${withData} with data, ${recs.length} Dip signals so far`);
  }
  recs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sym < b.sym ? -1 : 1));
  fs.mkdirSync(CFG.out, { recursive: true });
  const header = `RUN CHECK: ${symbols.length} symbols requested, ${withData} had enough data, ${skipped} download batches skipped, ${recs.length} signals.\n\n`;
  const report = header + (recs.length ? buildReport(recs) : 'No Dip signals were found. Check the data download above.');
  fs.writeFileSync(path.join(CFG.out, 'summary.txt'), report + '\n');
  const csv = ['date,sym,atr,prevClose,openSignalDay,closeSignalDay,openNextDay,gapSignalDayPct,gapEntryDayPct,filled,planPct,how,exitDay,plain3Pct,day1Pct,worstDipPct,bestHighPct']
    .concat(recs.map(r => [r.date, r.sym, r.atr.toFixed(4), r.prevClose, r.openSignal, r.close, r.openNext, r.g0.toFixed(3), r.g1.toFixed(3), r.filled ? 1 : 0,
      ...['plan', 'how', 'exitDay', 'plain3', 'day1', 'mae', 'mfe'].map(k => (isNum(r[k]) ? r[k].toFixed(3) : r[k] === undefined ? '' : r[k]))].join(',')));
  fs.writeFileSync(path.join(CFG.out, 'signals.csv'), csv.join('\n') + '\n');
  console.log('\n' + report);
  log(`Done: ${recs.length} signals; results in ${CFG.out}/`);
}

if (require.main === module) main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
module.exports = { simulate, measure, bucketOf, statsFor, seMean, buildReport, signalsFor, BUCKETS };
