#!/usr/bin/env node
/*
 * Entry-price research for the Uptrend Dip.
 *
 * Question: when an Uptrend Dip signal has an UNMITIGATED fair value gap (FVG) or order block (OB) just below
 * the price, (1) does that predict a worse trade, and (2) would a limit order placed at that zone beat buying at the
 * next open? And the control that matters most: is a zone any better than a limit order at a random level the same
 * distance below the price? (Buying lower always gets a better price on the trades that fill, but misses the ones that
 * never come back, so only the average over ALL signals tells the truth.)
 *
 * Read-only: downloads daily bars with your Alpaca keys, never touches orders. Uses the same Dip definition as the
 * live system (../app.js setupIndicators / setupFlags), S&P 500 members at the time, $20M/day floor.
 *
 * Definitions (daily candles, using only data known at the signal close):
 *   Bullish FVG   candles k-2, k-1, k with low[k] > high[k-2]; zone = [high[k-2], low[k]]; gap at least 0.25 ATR.
 *                 Unmitigated = no later candle has traded into the zone (every later low is above the zone top).
 *   Bullish OB    the last down candle j before an up-impulse: candle j+1 closes above high[j] and the next three
 *                 candles reach at least 1.5 ATR above close[j]; zone = [low[j], high[j]].
 *                 Unmitigated = from candle j+2 on, no low has traded back to the zone top.
 *   Both are searched over the last 60 sessions, and only zones entirely below the signal close count.
 *
 * Trade plan simulated (same as live): target +4% from the fill, stop 3 ATR below the fill, exit at the close of
 * session 3 after the signal at the latest. Stop is checked before target within a day (conservative); a target is not
 * credited on a day the order filled below the open, because the high may have come before the fill.
 *
 * Usage: ALPACA_KEY_ID=... ALPACA_SECRET_KEY=... node scanner/entryresearch.js
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
  start: env.ER_START || '2015-06-01',          // download from here (warm-up for the 200-day average)
  testFrom: env.ER_TEST_FROM || '2016-06-01',   // signals counted from here
  maxSymbols: num(env.ER_MAX_SYMBOLS, 0),
  batch: num(env.ER_BATCH, 50),
  out: env.ER_OUT || 'research-out-entry',
  minDollarVol: num(env.ER_MIN_DOLLAR_VOL, 20e6),
};
const Z = { lookback: 60, minGapAtr: 0.25, obDisplacementAtr: 1.5, maxDistAtr: 2 };
const PERIODS = [['2016-06 to 2019', '2016-06-01', '2019-12-31'], ['2020 to 2022', '2020-01-01', '2022-12-31'], ['2023 to 2026', '2023-01-01', '2026-12-31']];
const DISTS = [0.5, 1, 1.5, 2];                 // placebo ladder: limit levels this many ATR below the signal close
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ zones */
/** Unmitigated bullish zones below the signal close at index i. P has o,h,l,c arrays; atr is the ATR at i. */
function findZones(P, i, atr) {
  const zones = [], close = P.c[i];
  // Fair value gaps
  for (let k = i; k >= Math.max(2, i - Z.lookback); k--) {
    const bottom = P.h[k - 2], top = P.l[k];
    if (!(top > bottom) || top - bottom < Z.minGapAtr * atr) continue;
    let untouched = true;
    for (let m = k + 1; m <= i; m++) if (P.l[m] <= top) { untouched = false; break; }
    if (untouched && top < close) zones.push({ type: 'FVG', top, bottom, formed: k });
  }
  // Order blocks
  for (let j = i - 4; j >= Math.max(1, i - Z.lookback); j--) {
    if (!(P.c[j] < P.o[j]) || !(P.c[j + 1] > P.h[j])) continue;
    const reach = Math.max(P.h[j + 1], P.h[j + 2], P.h[j + 3]) - P.c[j];
    if (reach < Z.obDisplacementAtr * atr) continue;
    const top = P.h[j], bottom = P.l[j];
    let untouched = true;
    for (let m = j + 2; m <= i; m++) if (P.l[m] <= top) { untouched = false; break; }
    if (untouched && top < close) zones.push({ type: 'OB', top, bottom, formed: j });
  }
  return zones;
}
const nearest = (zones, type) => zones.filter(z => !type || z.type === type).sort((a, b) => b.top - a.top)[0] || null;
const distAtr = (z, close, atr) => (z ? (close - z.top) / atr : null);
/** Is `level` inside (or within 0.15 ATR of) any unmitigated zone? */
const nearAnyZone = (zones, level, atr) => zones.some(z => level >= z.bottom - 0.15 * atr && level <= z.top + 0.15 * atr);

/* ----------------------------------------------------------- trade simulation */
/** entry = { day (1..3, sessions after the signal), price, atOpen }. Returns the % return. */
function simulate(P, i, entry, atr) {
  const stop = entry.price - 3 * atr, target = entry.price * 1.04;
  for (let d = entry.day; d <= 3; d++) {
    const k = i + d, first = d === entry.day;
    if (!first) {
      if (P.o[k] >= target) return (P.o[k] / entry.price - 1) * 100;
      if (P.o[k] <= stop) return (P.o[k] / entry.price - 1) * 100;
    }
    if (P.l[k] <= stop) return (stop / entry.price - 1) * 100;
    if (!(first && !entry.atOpen) && P.h[k] >= target) return 4;
    if (d === 3) return (P.c[k] / entry.price - 1) * 100;
  }
  return null;
}
const baselineEntry = (P, i) => (P.o[i + 1] <= P.c[i] * 1.02 ? { day: 1, price: P.o[i + 1], atOpen: true } : null);
/** Limit buy at `level`, good for `days` sessions: a gap below the level fills at the open, otherwise it fills at the level. */
function limitEntry(P, i, level, days) {
  for (let d = 1; d <= days; d++) {
    const k = i + d;
    if (P.o[k] <= level) return { day: d, price: P.o[k], atOpen: true };
    if (P.l[k] <= level) return { day: d, price: level, atOpen: false };
  }
  return null;
}
const ret = (P, i, entry, atr) => (entry ? simulate(P, i, entry, atr) : null);

/** Everything we measure for one signal. */
function evaluateSignal(P, i, atr) {
  const close = P.c[i], zones = findZones(P, i, atr);
  const zAny = nearest(zones), zFvg = nearest(zones, 'FVG'), zOb = nearest(zones, 'OB');
  const near = zAny && distAtr(zAny, close, atr) <= Z.maxDistAtr ? zAny : null;       // a zone close enough to act on
  const baseEntry = baselineEntry(P, i);
  const res = { base: ret(P, i, baseEntry, atr) };
  if (near) {
    const mid = (near.top + near.bottom) / 2;
    res.zoneTop1 = ret(P, i, limitEntry(P, i, near.top, 1), atr);
    res.zoneTop3 = ret(P, i, limitEntry(P, i, near.top, 3), atr);
    res.zoneMid1 = ret(P, i, limitEntry(P, i, mid, 1), atr);
    res.hybridTop1 = res.zoneTop1;                                                       // zone close enough: wait for it
  } else {
    res.zoneTop1 = res.zoneTop3 = res.zoneMid1 = undefined;                              // not traded under the zone-only rules
    res.hybridTop1 = res.base;                                                           // no zone: buy the open as today
  }
  // Placebo ladder: a limit k ATR below the signal close, with or without a zone there
  const ladder = {};
  for (const k of DISTS) {
    const level = close - k * atr;
    ladder[k] = { nearZone: nearAnyZone(zones, level, atr), d1: ret(P, i, limitEntry(P, i, level, 1), atr), d3: ret(P, i, limitEntry(P, i, level, 3), atr) };
  }
  // Does price dip into the nearest zone within the 3 sessions, and how far does it go against us after the open?
  let touch = null, mae = null;
  if (baseEntry) {
    const lo = Math.min(P.l[i + 1], P.l[i + 2], P.l[i + 3]);
    mae = (lo / baseEntry.price - 1) * 100;
    if (zAny) touch = lo <= zAny.top;
  }
  return { zones, zAny, zFvg, zOb, dAny: distAtr(zAny, close, atr), dFvg: distAtr(zFvg, close, atr), dOb: distAtr(zOb, close, atr), res, ladder, touch, mae };
}

/* ------------------------------------------------------------------ stats */
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const f2 = x => (isNum(x) ? x.toFixed(2) : '  - ');
const pct0 = x => (isNum(x) ? `${(x * 100).toFixed(0)}%` : ' - ');
/** Date-clustered t statistic for the mean of per-signal differences. */
function clusterT(pairs) {
  const by = new Map();
  for (const p of pairs) { if (!by.has(p.date)) by.set(p.date, []); by.get(p.date).push(p.d); }
  const m = [...by.values()].map(mean), n = m.length;
  if (n < 3) return { mean: mean(pairs.map(p => p.d)), t: NaN, n };
  const mu = mean(m), sd = Math.sqrt(m.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1));
  return { mean: mean(pairs.map(p => p.d)), t: sd > 0 ? mu / (sd / Math.sqrt(n)) : NaN, n };
}
/** rets: array of numbers (a trade), null (not filled) or undefined (not traded under this rule). */
function summarize(rets) {
  const traded = rets.filter(r => r !== undefined);
  const fills = traded.filter(r => r !== null);
  return { n: traded.length, fills: fills.length, fillRate: traded.length ? fills.length / traded.length : NaN,
    perSignal: traded.length ? fills.reduce((s, x) => s + x, 0) / traded.length : NaN, perFill: mean(fills), win: fills.length ? fills.filter(x => x > 0).length / fills.length : NaN };
}
const inPeriod = (rec, [, a, b]) => rec.date >= a && rec.date <= b;

/* ----------------------------------------------------------------- report */
function buildReport(recs) {
  const L = [];
  const row = (label, s) => `  ${label.padEnd(44)} signals ${String(s.n).padStart(5)} | fill ${pct0(s.fillRate).padStart(4)} | avg per signal ${f2(s.perSignal).padStart(6)}% | avg per fill ${f2(s.perFill).padStart(6)}% | win ${pct0(s.win).padStart(4)}`;
  L.push('ENTRY-PRICE RESEARCH: unmitigated fair value gaps / order blocks below an Uptrend Dip');
  L.push(`S&P 500 members at the time, $${(CFG.minDollarVol / 1e6).toFixed(0)}M/day floor, ${recs.length} Dip signals from ${CFG.testFrom}. Plan: +4% target, 3 ATR stop, exit at the close of session 3. Before costs.`);
  L.push('A variant is only worth building if it beats "today" on average per signal in ALL three periods AND the date-clustered t-statistic is at least 2.');
  L.push('');
  L.push('1. HOW COMMON ARE ZONES JUST BELOW A DIP SIGNAL? (share of signals with an unmitigated zone within D ATR below the close)');
  for (const [name, key] of [['fair value gap', 'dFvg'], ['order block', 'dOb'], ['either', 'dAny']]) {
    L.push(`  ${name.padEnd(15)} ` + [0.5, 1, 2, 3].map(D => `within ${D} ATR: ${pct0(recs.filter(r => isNum(r[key]) && r[key] <= D).length / recs.length).padStart(4)}`).join('  |  '));
  }
  L.push('');
  L.push('2. DOES A ZONE BELOW PREDICT A WORSE TRADE? (trades taken today, grouped by the distance of the nearest zone below)');
  const buckets = [['zone within 0.5 ATR', r => r.dAny !== null && r.dAny <= 0.5], ['zone 0.5-1 ATR below', r => r.dAny > 0.5 && r.dAny <= 1], ['zone 1-2 ATR below', r => r.dAny > 1 && r.dAny <= 2],
    ['zone 2-3 ATR below', r => r.dAny > 2 && r.dAny <= 3], ['no zone within 3 ATR', r => r.dAny === null || r.dAny > 3]];
  for (const [name, test] of [['ALL PERIODS', () => true], ...PERIODS.map(p => [p[0], r => inPeriod(r, p)])]) {
    L.push(` ${name}`);
    for (const [label, bt] of buckets) {
      const sel = recs.filter(r => test(r) && bt(r) && isNum(r.res.base));
      if (!sel.length) continue;
      const tch = sel.filter(r => r.touch !== null);
      L.push(`  ${label.padEnd(26)} trades ${String(sel.length).padStart(5)} | avg ${f2(mean(sel.map(r => r.res.base))).padStart(6)}% | win ${pct0(sel.filter(r => r.res.base > 0).length / sel.length).padStart(4)} | price dips into the zone within 3 sessions ${pct0(tch.length ? tch.filter(r => r.touch).length / tch.length : NaN).padStart(4)} | avg worst dip after the open ${f2(mean(sel.map(r => r.mae))).padStart(6)}%`);
    }
  }
  L.push('');
  L.push(`3. WOULD A LIMIT ORDER AT THE ZONE BEAT THE NEXT OPEN? (zones within ${Z.maxDistAtr} ATR; "avg per signal" counts a missed fill as 0, which is what the account actually experiences)`);
  const variants = [['base', 'TODAY: next open (2% cap)'], ['zoneTop1', 'Limit at zone top, today only (zone signals only)'], ['zoneTop3', 'Limit at zone top, 3 sessions (zone signals only)'],
    ['zoneMid1', 'Limit at zone middle, today only (zone signals only)'], ['hybridTop1', 'HYBRID: zone top if a zone is close, else next open (all signals)']];
  for (const [name, test] of [['ALL PERIODS', () => true], ...PERIODS.map(p => [p[0], r => inPeriod(r, p)])]) {
    L.push(` ${name}`);
    const sub = recs.filter(test);
    const zoneSignals = sub.filter(r => r.res.zoneTop1 !== undefined);
    L.push(`  (${zoneSignals.length} of ${sub.length} signals have a zone close enough to act on)`);
    for (const [key, label] of variants) {
      const pool = key === 'zoneTop1' || key === 'zoneTop3' || key === 'zoneMid1' ? zoneSignals : sub;
      L.push(row(label, summarize(pool.map(r => r.res[key]))));
      if (key !== 'base') {
        const pairs = pool.map(r => ({ date: r.date, d: (r.res[key] ?? 0) - (r.res.base ?? 0) }));
        const ct = clusterT(pairs);
        L.push(`${' '.repeat(46)}difference vs today on the same signals: ${f2(ct.mean).padStart(6)}% per signal, t = ${f2(ct.t)} (${ct.n} dates)`);
      }
    }
  }
  L.push('');
  L.push('4. THE CONTROL: is a zone special, or does any lower limit price do the same? (limit k ATR below the signal close, today only / 3 sessions)');
  for (const k of DISTS) {
    for (const nz of [true, false]) {
      const sel = recs.filter(r => r.ladder[k].nearZone === nz);
      if (!sel.length) continue;
      L.push(row(`${k} ATR below, ${nz ? 'a zone is there' : 'NO zone there'}, today only`, summarize(sel.map(r => r.ladder[k].d1))));
      L.push(row(`${k} ATR below, ${nz ? 'a zone is there' : 'NO zone there'}, 3 sessions`, summarize(sel.map(r => r.ladder[k].d3))));
    }
    const all = recs;
    L.push(`${' '.repeat(2)}(for reference, today's rule on the same ${all.length} signals: avg per signal ${f2(summarize(all.map(r => r.res.base)).perSignal)}%)`);
  }
  L.push('');
  L.push('HOW TO READ THIS: "avg per fill" will almost always look better for lower limits (you only trade the ones that dip), but it ignores the signals that never fill. Judge by "avg per signal" and by whether the zone rows beat the NO-zone rows at the same distance.');
  return L.join('\n');
}

/* ----------------------------------------------------------- data download */
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

/** All Dip signals of one symbol, evaluated. */
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
    out.push({ date, sym, close: P.c[i], atr: f.atr, vs200: f.vs200, ...evaluateSignal(P, i, f.atr) });
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
  const recs = []; let withData = 0;
  for (let b = 0; b < symbols.length; b += CFG.batch) {
    const chunk = symbols.slice(b, b + CFG.batch);
    let bars = null;
    try { bars = await fetchDaily(chunk); } catch (e) { log(`  batch skipped: ${e.message}`); }
    if (bars) for (const [sym, list] of bars) { if (list.length < 260) continue; withData++; for (const r of signalsFor(sym, list, isSp)) recs.push(r); }
    log(`  ${Math.min(b + CFG.batch, symbols.length)}/${symbols.length} symbols, ${withData} with data, ${recs.length} Dip signals so far`);
  }
  recs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sym < b.sym ? -1 : 1));
  fs.mkdirSync(CFG.out, { recursive: true });
  const report = recs.length ? buildReport(recs) : 'No Dip signals were found. Check the data download above.';
  fs.writeFileSync(path.join(CFG.out, 'summary.txt'), report + '\n');
  const csv = ['date,sym,close,atr,vs200,zoneType,zoneTop,zoneBottom,zoneDistAtr,fvgDistAtr,obDistAtr,touch,mae,base,zoneTop1,zoneTop3,zoneMid1,hybridTop1']
    .concat(recs.map(r => [r.date, r.sym, r.close, r.atr.toFixed(4), r.vs200.toFixed(4), r.zAny ? r.zAny.type : '', r.zAny ? r.zAny.top : '', r.zAny ? r.zAny.bottom : '',
      isNum(r.dAny) ? r.dAny.toFixed(3) : '', isNum(r.dFvg) ? r.dFvg.toFixed(3) : '', isNum(r.dOb) ? r.dOb.toFixed(3) : '', r.touch === null ? '' : r.touch ? 1 : 0, isNum(r.mae) ? r.mae.toFixed(3) : '',
      ...['base', 'zoneTop1', 'zoneTop3', 'zoneMid1', 'hybridTop1'].map(k => (isNum(r.res[k]) ? r.res[k].toFixed(3) : r.res[k] === null ? 'nofill' : ''))].join(',')));
  fs.writeFileSync(path.join(CFG.out, 'signals.csv'), csv.join('\n') + '\n');
  console.log('\n' + report);
  log(`Done: ${recs.length} signals; results in ${CFG.out}/`);
}

if (require.main === module) main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
module.exports = { findZones, simulate, baselineEntry, limitEntry, evaluateSignal, clusterT, summarize, buildReport, signalsFor, Z };
