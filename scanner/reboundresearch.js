#!/usr/bin/env node
/*
 * Bottom-and-rebound research.
 *
 * The rule being tested (three conditions):
 *   1. Normal or low volume on a down day: the heavy panic selling has subsided.
 *   2. Strong finish: the close is closer to the day's high than to its low.
 *   3. Technical recovery: the close is back above the 20-day moving average.
 *
 * Taken literally on ONE day, conditions 1 and 3 almost contradict each other: a stock that closes DOWN and is still above its
 * 20-day average was already above it yesterday, so it did not "close back above" anything. So three readings are tested,
 * all written down here before any result was seen:
 *   V1  LITERAL, same day: down day, calm volume, close in the upper half of the range, close above the 20-day average.
 *       (In practice a shallow dip inside a short-term uptrend, not a bottom.)
 *   V2  SEQUENCE: a "settle day" (down day, calm volume, close in the upper half of the range, close still BELOW the 20-day
 *       average) followed within 1 to 5 sessions by the first close back ABOVE the 20-day average. Signal day = that close.
 *   V3  V2 plus the panic that "has subsided": a heavy-volume down day (volume at least 2x the average) in the 10 sessions before
 *       the settle day.
 * Calm volume, as the source of the rule defines it: "back around one times the average ... like 1 to 1.1 times, where it's not
 * panicked selling anymore but it's not dead quiet either". So the main test (band A) uses 1.0x to 1.1x. Band B (1.1x or lower, quiet
 * days allowed, the original "normal or below-average" wording) is run as a sensitivity check on whether excluding quiet days matters.
 * "Volume average" = the average of the previous 20 sessions (today excluded). Close in the upper half = (close-low)/(high-low) > 0.5.
 *
 * How it is judged. Every signal is bought at the next session's open (skipped if that is more than 2% above the signal close,
 * as in the live system), and measured by the return to the close of day 1, 3, 5 and 10, and by the live plan (+4% target, 3 ATR
 * stop, exit at the close of day 3). The fair comparison is the AVERAGE STOCK ON THE SAME DAY (this removes market-wide moves),
 * so the headline number is the 5-day "excess" over that. Pass bar for V1/V2/V3, fixed in advance: positive excess in ALL THREE
 * periods and an overall date-clustered t-statistic of at least 2. The live Uptrend Dip is shown as a reference.
 *
 * Universe: S&P 500 members at the time, $20M/day and $5 floors (same as the live system). Before costs. Read-only.
 *
 * Usage: ALPACA_KEY_ID=... ALPACA_SECRET_KEY=... node scanner/reboundresearch.js
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
  start: env.RB_START || '2015-06-01',
  testFrom: env.RB_TEST_FROM || '2016-06-01',
  maxSymbols: num(env.RB_MAX_SYMBOLS, 0),
  batch: num(env.RB_BATCH, 50),
  out: env.RB_OUT || 'research-out-rebound',
};
const PERIODS = [['Oct 2016 to 2019', '2016-01-01', '2019-12-31'], ['2020 to 2022', '2020-01-01', '2022-12-31'], ['2023 to 2026', '2023-01-01', '2026-12-31']];
const H = ['r1', 'r3', 'r5', 'r10', 'plan'];            // measured outcomes; plan = the live +4% / 3 ATR / day-3 plan
const HN = { r1: 1, r3: 3, r5: 5, r10: 10 };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const f2 = x => (isNum(x) ? x.toFixed(2) : '  - ');
const p0 = x => (isNum(x) ? `${(x * 100).toFixed(0)}%` : ' - ');

/* ------------------------------------------------------------------- the rule */
/** Volume bands, as multiples of the previous-20-session average volume. A is the main test; B also lets quiet days count. */
const BANDS = { A: { lo: 1.0, hi: 1.1 }, B: { lo: 0, hi: 1.1 } };
/** Flags for every index: v1 (literal), v2 (settle day then reclaim), v3 (v2 after a panic). ind from core.setupIndicators; s20 = 20-day SMA of closes. */
function detect(ind, s20, band = BANDS.A) {
  const { h, l, c, v, vsma } = ind, n = c.length;
  const ratio = i => (i >= 1 && isNum(v[i]) && isNum(vsma[i - 1]) && vsma[i - 1] > 0 ? v[i] / vsma[i - 1] : null);   // today vs the previous 20 sessions
  const clv = i => (h[i] > l[i] ? (c[i] - l[i]) / (h[i] - l[i]) : 0.5);
  const down = i => i >= 1 && c[i] < c[i - 1];
  const calm = i => { const r = ratio(i); return r !== null && r >= band.lo && r <= band.hi; };
  const settle = i => down(i) && calm(i) && clv(i) > 0.5 && isNum(s20[i]) && c[i] < s20[i];
  const panic = i => { const r = ratio(i); return down(i) && r !== null && r >= 2; };
  const v1 = new Array(n).fill(false), v2 = new Array(n).fill(false), v3 = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    v1[i] = down(i) && calm(i) && clv(i) > 0.5 && isNum(s20[i]) && c[i] > s20[i];
    if (i >= 6 && isNum(s20[i]) && isNum(s20[i - 1]) && c[i] > s20[i] && c[i - 1] <= s20[i - 1]) {
      for (let d = i - 1; d >= i - 5; d--) {
        if (!settle(d)) continue;
        v2[i] = true;                            // any settle day in the 5-session window qualifies
        for (let k = d - 1; k >= Math.max(1, d - 10); k--) if (panic(k)) { v3[i] = true; break; }
        if (v3[i]) break;                        // V3 if ANY of those settle days followed a panic (so a wider volume band can only add signals)
      }
    }
  }
  return { v1, v2, v3 };
}

/* -------------------------------------------------------------- trade outcomes */
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
/** Outcomes of buying the open after signal index i. Null if the live 2% entry cap would skip it. */
function outcomes(P, i, atr) {
  const entry = P.o[i + 1];
  if (!(entry <= P.c[i] * 1.02)) return null;
  const s = simulate(P, i, entry, atr), out = { entry, plan: s.pct, how: s.how };
  for (const [k, nd] of Object.entries(HN)) out[k] = (P.c[i + nd] / entry - 1) * 100;
  return out;
}

/* ----------------------------------------------------------------------- stats */
function seMean(rows, f) {
  const by = new Map();
  for (const r of rows) { const v = f(r); if (!isNum(v)) continue; if (!by.has(r.date)) by.set(r.date, []); by.get(r.date).push(v); }
  const m = [...by.values()].map(mean), n = m.length;
  if (n < 3) return NaN;
  const mu = mean(m);
  return Math.sqrt(m.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1)) / Math.sqrt(n);
}
/** Stats for a group of signal rows: bought count, mean outcomes, 5-day win rate, and the excess over the same-day average stock. */
function groupStats(rows) {
  const b = rows.filter(r => r.filled), s = { n: rows.length, bought: b.length };
  for (const k of H) { s[k] = mean(b.map(r => r[k])); s['ex_' + k] = mean(b.map(r => r['ex_' + k])); }
  s.win5 = b.length ? b.filter(r => r.r5 > 0).length / b.length : NaN;
  s.exSe5 = seMean(b, r => r.ex_r5); s.exT5 = s.ex_r5 / s.exSe5; s.exPm5 = 1.96 * s.exSe5;
  return s;
}

/* --------------------------------------------------------------------- report */
const GROUPS = [
  ['V1  literal, all on one day', r => r.v1],
  ['V2  settle day, then back above the 20-day average', r => r.v2],
  ['      ...and above its 200-day average', r => r.v2 && r.above200],
  ['      ...and below its 200-day average', r => r.v2 && !r.above200],
  ['V3  V2 after a heavy-volume panic day', r => r.v3],
  ['      ...and above its 200-day average', r => r.v3 && r.above200],
  ['      ...and below its 200-day average', r => r.v3 && !r.above200],
  ['REFERENCE: the live Uptrend Dip', r => r.dip],
  ['SENSITIVITY, quiet days allowed (volume up to 1.1x): V1', r => r.w1],
  ['SENSITIVITY, quiet days allowed (volume up to 1.1x): V2', r => r.w2],
  ['SENSITIVITY, quiet days allowed (volume up to 1.1x): V3', r => r.w3],
];
function line(label, s) {
  if (!s.n) return `  ${label.padEnd(52)}      0`;
  return `  ${label.padEnd(52)} ${String(s.n).padStart(6)} ${String(s.bought).padStart(6)} | ${f2(s.r1).padStart(6)} ${f2(s.r3).padStart(6)} ${f2(s.r5).padStart(6)} ${f2(s.r10).padStart(6)} | ${p0(s.win5).padStart(4)} | ${f2(s.ex_r5).padStart(6)} ±${f2(s.exPm5).padStart(5)} (t ${f2(s.exT5).padStart(5)}) | ${f2(s.plan).padStart(6)} ${f2(s.ex_plan).padStart(6)}`;
}
function buildReport(rows, base, meta, spyRows) {
  const L = [], pr = [['ALL PERIODS', '0000', '9999'], ...PERIODS];
  L.push(`RUN CHECK: ${meta.symbols} stocks with data, ${meta.skipped} download batches skipped, ${meta.stockDays} eligible stock-days, ${meta.dipAll} Dip signals found (the earlier research found 2,963 through mid-Oct 2026; a few more are expected if the data is newer).`);
  L.push(`Signals found with calm volume 1.0-1.1x (main test): V1 ${meta.v1}, V2 ${meta.v2}, V3 ${meta.v3}; with volume up to 1.1x (sensitivity): V1 ${meta.w1}, V2 ${meta.w2}, V3 ${meta.w3}. Rows below count only trades that the 2% entry cap allows ("bought").`);
  L.push('');
  L.push('BOTTOM-AND-REBOUND RULE: selling settles to normal volume (1.0-1.1x the average) on a down day, strong finish, close back above the 20-day average');
  L.push('Buy the next open (skipped if more than 2% above the signal close). Columns: avg % from that open to the close of day 1 / 3 / 5 / 10 | share of trades up after 5 days | 5-day EXCESS over the average S&P 500 stock on the same day, with a 95% margin and a date-clustered t | the live plan (+4% target, 3 ATR stop, exit day 3): average and excess.');
  L.push('Pass bar, fixed in advance (V1, V2, V3): positive 5-day excess in ALL THREE periods and an overall t of at least 2.');
  for (const [name, a, b] of pr) {
    L.push('');
    L.push('='.repeat(150));
    L.push(` ${name}`);
    L.push('='.repeat(150));
    L.push(`  ${'group'.padEnd(52)} signals bought |  day1   day3   day5  day10 | up5  | 5-day excess over the average stock same day  |  plan  plan-ex`);
    const sub = rows.filter(r => r.date >= a && r.date <= b);
    for (const [label, test] of GROUPS) L.push(line(label, groupStats(sub.filter(test))));
    const bs = base(a, b);
    L.push(`  ${'ALL stock-days (the baseline, bought the same way)'.padEnd(52)} ${String(bs.n).padStart(6)} ${String(bs.n).padStart(6)} | ${f2(bs.r1).padStart(6)} ${f2(bs.r3).padStart(6)} ${f2(bs.r5).padStart(6)} ${f2(bs.r10).padStart(6)} |      |        0.00                                   | ${f2(bs.plan).padStart(6)}   0.00`);
  }
  L.push('');
  L.push('='.repeat(150));
  L.push(' VERDICTS against the pre-set bar (5-day excess over the average stock on the same day)');
  L.push('='.repeat(150));
  for (const [label, test] of [GROUPS[0], GROUPS[1], GROUPS[4], GROUPS[7], GROUPS[8], GROUPS[9], GROUPS[10]]) {
    const per = PERIODS.map(p => groupStats(rows.filter(r => r.date >= p[1] && r.date <= p[2] && test(r))));
    const all = groupStats(rows.filter(test)), pos = per.every(s => s.bought >= 10 && isNum(s.ex_r5) && s.ex_r5 > 0);
    const ok = pos && isNum(all.exT5) && all.exT5 >= 2;
    L.push(` ${label.trim().padEnd(52)} periods: ${per.map(s => (s.bought >= 10 ? `${f2(s.ex_r5)} (n ${s.bought})` : `too few (n ${s.bought})`)).join(' | ')} | overall ${f2(all.ex_r5)} (t ${f2(all.exT5)}) -> ${ok ? 'PASSES' : per.some(s => s.bought < 10) ? 'does NOT pass (too few trades in a period)' : pos ? 'does NOT pass (consistent sign, overall t below 2)' : 'does NOT pass (sign not consistent across periods)'}`);
  }
  L.push('');
  L.push('='.repeat(150));
  L.push(' EXPLORATORY: THE SAME RULE ON THE INDEX (SPY), bought at the next open; few events, read as colour only');
  L.push('='.repeat(150));
  for (const r of spyRows) L.push(`  ${r.label.padEnd(40)} ${r.period.padEnd(18)} events ${String(r.n).padStart(3)} | avg SPY return after 5 / 10 / 20 days: ${[5, 10, 20].map(d => `${f2(r.avg[d]).padStart(6)}%`).join(' ')} | all days: ${[5, 10, 20].map(d => `${f2(r.base[d]).padStart(5)}%`).join(' ')} | up after 10 days ${p0(r.win10).padStart(4)}`);
  return L.join('\n');
}

/* ------------------------------------------------------------------- processing */
/** Evaluates one symbol: updates the per-day aggregates (the baseline) and returns its signal rows. */
function processSymbol(sym, candles, isSp, dayAgg) {
  const clean = core.cleanCandles(candles);
  if (clean.length < 260) return null;
  const ind = core.setupIndicators(clean), n = clean.length, { o, h, l, c, s200, atr, dollarVol } = ind, P = { o, h, l, c };
  const s20 = core.sma(c, 20), fl = detect(ind, s20, BANDS.A), fb = detect(ind, s20, BANDS.B), rows = []; let days = 0;
  for (let i = 200; i < n - 10; i++) {
    const date = clean[i].t;
    if (date < CFG.testFrom || !isSp(sym, date)) continue;
    if (!(c[i] >= core.SETUP.MIN_PRICE) || !(dollarVol[i] >= core.SETUP.MIN_LIQUIDITY) || !isNum(atr[i]) || !(atr[i] > 0) || !isNum(s20[i])) continue;
    const f = core.setupFlags(ind, i), oc = outcomes(P, i, atr[i]);
    if (oc) {
      let d = dayAgg.get(date); if (!d) { d = { n: 0, s: { r1: 0, r3: 0, r5: 0, r10: 0, plan: 0 } }; dayAgg.set(date, d); }
      d.n++; for (const k of H) d.s[k] += oc[k]; days++;
    }
    const dip = !!(f && f.dip);
    if (fl.v1[i] || fl.v2[i] || fl.v3[i] || fb.v1[i] || fb.v2[i] || fb.v3[i] || dip) rows.push({ date, sym, v1: fl.v1[i], v2: fl.v2[i], v3: fl.v3[i], w1: fb.v1[i], w2: fb.v2[i], w3: fb.v3[i], dip, above200: c[i] > s200[i], atr: atr[i], filled: !!oc, ...(oc || {}) });
  }
  return { rows, days };
}

/** The same rule applied to the index. Returns event rows by period and volume band. */
function spyStudy(candles) {
  const clean = core.cleanCandles(candles);
  if (clean.length < 60) return [];
  const ind = core.setupIndicators(clean), s20 = core.sma(ind.c, 20), { c, o } = ind, n = clean.length, out = [];
  const spyRet = (i, d) => (i + d <= n - 1 ? (c[i + d] / o[i + 1] - 1) * 100 : null);   // next open to the close d sessions after the signal day
  for (const [bname, band] of [['band A', BANDS.A], ['band B', BANDS.B]]) {
    const fl = detect(ind, s20, band);
    for (const [label, flags] of [['V1 literal', fl.v1], ['V2 settle day then reclaim', fl.v2], ['V3 V2 after a panic', fl.v3]]) {
      for (const p of [['ALL PERIODS', '0000', '9999'], ...PERIODS]) {
        const idx = []; for (let i = 25; i < n - 21; i++) if (clean[i].t >= p[1] && clean[i].t <= p[2]) idx.push(i);
        const ev = idx.filter(i => flags[i]), row = { label: `${label} (${bname})`, period: p[0], n: ev.length, avg: {}, base: {}, win10: NaN };
        for (const d of [5, 10, 20]) { row.avg[d] = mean(ev.map(i => spyRet(i, d)).filter(isNum)); row.base[d] = mean(idx.map(i => spyRet(i, d)).filter(isNum)); }
        const w = ev.map(i => spyRet(i, 10)).filter(isNum); row.win10 = w.length ? w.filter(x => x > 0).length / w.length : NaN;
        out.push(row);
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------- download */
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

/** Fills ex_* (return minus the same-day average stock) on every bought signal row. */
function addExcess(rows, dayAgg) {
  for (const r of rows) {
    if (!r.filled) continue;
    const d = dayAgg.get(r.date);
    for (const k of H) r['ex_' + k] = d && d.n ? r[k] - d.s[k] / d.n : NaN;
  }
}
function baselineFn(dayAgg) {
  return (a, b) => {
    const s = { n: 0, r1: 0, r3: 0, r5: 0, r10: 0, plan: 0 };
    for (const [date, d] of dayAgg) if (date >= a && date <= b) { s.n += d.n; for (const k of H) s[k] += d.s[k]; }
    for (const k of H) s[k] = s.n ? s[k] / s.n : NaN;
    return s;
  };
}

async function main() {
  if (!CFG.keyId || !CFG.secret) throw new Error('ALPACA_KEY_ID and ALPACA_SECRET_KEY are required.');
  const hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'sp500_history.json'), 'utf8')).members;
  const isSp = (sym, d) => (hist[sym] || []).some(([a, b]) => d >= a && (b === null || d < b));
  let symbols = Object.keys(hist).filter(s => /^[A-Z.]{1,6}$/.test(s) && hist[s].some(([, b]) => b === null || b >= CFG.testFrom)).sort();
  if (CFG.maxSymbols) symbols = symbols.slice(0, CFG.maxSymbols);
  log(`Symbols: ${symbols.length}`);
  const dayAgg = new Map(), rows = []; let withData = 0, skipped = 0, stockDays = 0;
  for (let b = 0; b < symbols.length; b += CFG.batch) {
    const chunk = symbols.slice(b, b + CFG.batch); let bars = null;
    try { bars = await fetchDaily(chunk); } catch (e) { skipped++; log(`  BATCH SKIPPED (${chunk[0]}..${chunk[chunk.length - 1]}): ${e.message}`); }
    if (bars) for (const [sym, list] of bars) { const r = processSymbol(sym, list, isSp, dayAgg); if (!r) continue; withData++; stockDays += r.days; for (const x of r.rows) rows.push(x); }
    log(`  ${Math.min(b + CFG.batch, symbols.length)}/${symbols.length} symbols, ${withData} with data, ${rows.length} flagged days so far`);
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sym < b.sym ? -1 : 1));
  addExcess(rows, dayAgg);
  const spy = (await fetchDaily(['SPY'])).get('SPY');
  const meta = { symbols: withData, skipped, stockDays, v1: rows.filter(r => r.v1).length, v2: rows.filter(r => r.v2).length, v3: rows.filter(r => r.v3).length, w1: rows.filter(r => r.w1).length, w2: rows.filter(r => r.w2).length, w3: rows.filter(r => r.w3).length, dipAll: rows.filter(r => r.dip).length };
  fs.mkdirSync(CFG.out, { recursive: true });
  const report = rows.length ? buildReport(rows, baselineFn(dayAgg), meta, spyStudy(spy)) : 'No signals were found. Check the data download above.';
  fs.writeFileSync(path.join(CFG.out, 'summary.txt'), report + '\n');
  const cell = x => (isNum(x) ? x.toFixed(3) : '');
  fs.writeFileSync(path.join(CFG.out, 'signals.csv'), ['date,sym,v1,v2,v3,w1,w2,w3,dip,above200,filled,entryOpen,atr,r1,r3,r5,r10,plan,how,ex_r5']
    .concat(rows.map(r => [r.date, r.sym, +r.v1, +r.v2, +r.v3, +r.w1, +r.w2, +r.w3, +r.dip, +r.above200, +r.filled, cell(r.entry), r.atr.toFixed(4), cell(r.r1), cell(r.r3), cell(r.r5), cell(r.r10), cell(r.plan), r.how || '', cell(r.ex_r5)].join(','))).join('\n') + '\n');
  fs.writeFileSync(path.join(CFG.out, 'daymean.csv'), ['date,stocks,mean1,mean3,mean5,mean10,meanPlan'].concat([...dayAgg].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, x]) => [d, x.n, ...H.map(k => (x.s[k] / x.n).toFixed(4))].join(','))).join('\n') + '\n');
  console.log('\n' + report);
  log(`Done: ${rows.length} flagged stock-days; results in ${CFG.out}/`);
}

if (require.main === module) main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
module.exports = { BANDS, detect, outcomes, simulate, groupStats, seMean, addExcess, baselineFn, processSymbol, spyStudy, buildReport, GROUPS };
