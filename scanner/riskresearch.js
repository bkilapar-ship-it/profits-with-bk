#!/usr/bin/env node
/*
 * Risk-limit research for the Uptrend Dip: can we cut the crash drawdowns without giving up the profits?
 *
 * Same signals and live plan as the other research (../app.js): S&P 500 members at the time, $20M/day floor, buy the next open
 * (skipped if more than 2% above the signal close), +4% target, 3 ATR stop, exit at the close of session 3. The stop is NOT
 * changed here. Only the PORTFOLIO rules change, tested through the same daily marked-to-market account
 * (10% reserve, 15% of the rest per trade, ranked like the live system):
 *   - cap on new entries per day, cap on total exposure per day, cap on open positions
 *   - smaller position size
 *   - pause new entries when the S&P 500 (SPY) is in trouble: big one-day drop, big 5-day drop, 10% below its high, below its 200-day average
 *   - an account circuit breaker: after an 8% drawdown, pause 5 trading days
 *
 * Pre-registered pass bar (written before the run): a rule is only worth adopting if, over ALL periods, it keeps at least 70%
 * of the live CAGR AND cuts the worst drawdown by at least 25%, AND it does not lose money-per-risk (CAGR / worst drawdown) in either later period.
 * Thirteen rules are tested, so one passing by luck is possible; anything that passes should still be read for plausibility.
 *
 * Read-only: downloads daily bars with your Alpaca keys, never touches orders.
 * Usage: ALPACA_KEY_ID=... ALPACA_SECRET_KEY=... node scanner/riskresearch.js
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
  start: env.RR_START || '2015-06-01',
  testFrom: env.RR_TEST_FROM || '2016-06-01',
  maxSymbols: num(env.RR_MAX_SYMBOLS, 0),
  batch: num(env.RR_BATCH, 50),
  out: env.RR_OUT || 'research-out-risk',
  minDollarVol: num(env.RR_MIN_DOLLAR_VOL, 20e6),
  chase: 0.02, target: 0.04, hold: 3, stopAtr: 3, reserve: 0.10, size: 0.15, startEquity: 100000,
};
const PERIODS = [['Oct 2016 to 2019', '2016-01-01', '2019-12-31'], ['2020 to 2022', '2020-01-01', '2022-12-31'], ['2023 to 2026', '2023-01-01', '2026-12-31']];
const SCENARIOS = [
  { id: 'live', label: 'LIVE rules (no limits)', rule: {} },
  { id: 'd2', label: 'max 2 new entries per day', rule: { maxPerDay: 2 } },
  { id: 'd3', label: 'max 3 new entries per day', rule: { maxPerDay: 3 } },
  { id: 'cap30', label: 'a day\'s new entries share 30% of the sleeve (each trade shrinks)', rule: { dayCap: 0.30 } },
  { id: 'open4', label: 'max 4 positions open at once', rule: { maxOpen: 4 } },
  { id: 's10', label: 'smaller size: 10% per trade', rule: { size: 0.10 } },
  { id: 's75', label: 'smaller size: 7.5% per trade', rule: { size: 0.075 } },
  { id: 'spy1', label: 'pause when SPY fell 2%+ on the signal day', rule: { pause: st => st.ret1 <= -0.02 } },
  { id: 'spy5', label: 'pause when SPY fell 4%+ over 5 days', rule: { pause: st => st.ret5 <= -0.04 } },
  { id: 'spyhi', label: 'pause when SPY is 10%+ below its 1-year high', rule: { pause: st => st.dd <= -0.10 } },
  { id: 'spy200', label: 'pause when SPY is below its 200-day average', rule: { pause: st => st.below200 === true } },
  { id: 'brk', label: 'circuit breaker: 8% account drawdown pauses entries 5 days', rule: { breaker: { dd: 0.08, days: 5 } } },
  { id: 'combo', label: 'COMBO: max 2 per day + pause when SPY fell 4%+ over 5 days', rule: { maxPerDay: 2, pause: st => st.ret5 <= -0.04 } },
];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ALL_DATES = new Set();

/* ------------------------------------------------------------ trade simulation (live plan) */
function simulate(rec) {
  const entry = rec.entry, target = entry * (1 + CFG.target), stop = entry - CFG.stopAtr * rec.atr;
  for (let d = 1; d <= CFG.hold; d++) {
    const k = rec.bars[d - 1];
    if (d > 1) {
      if (k.o >= target) return { pct: (k.o / entry - 1) * 100, how: 'target', day: d };
      if (k.o <= stop) return { pct: (k.o / entry - 1) * 100, how: 'stop', day: d };
    }
    const hitS = k.l <= stop, hitT = k.h >= target;
    if (hitS) return { pct: (stop / entry - 1) * 100, how: 'stop', day: d };
    if (hitT) return { pct: CFG.target * 100, how: 'target', day: d };
    if (d === CFG.hold) return { pct: (k.c / entry - 1) * 100, how: 'time', day: d };
  }
  return null;
}

/* ------------------------------------------------------------- account simulation */
/** Daily marked-to-market account with portfolio rules. spy = Map(signalDate -> {ret1, ret5, dd, below200}). */
function account(recs, results, dates, rule, spy) {
  rule = rule || {};
  const byEntry = new Map();
  recs.forEach((r, i) => { const res = results[i]; if (!res) return; const e = r.bars[0].t; if (!byEntry.has(e)) byEntry.set(e, []); byEntry.get(e).push({ r, res }); });
  for (const list of byEntry.values()) list.sort((a, b) => (a.r.prio - b.r.prio) || (b.r.vs200 - a.r.vs200));
  const sizePct = rule.size || CFG.size;
  let cash = CFG.startEquity, eqPrev = CFG.startEquity, open = [], opened = 0, skippedCash = 0, blocked = 0, peak = CFG.startEquity, pausedUntil = -1;
  const eq = [];
  for (let di = 0; di < dates.length; di++) {
    const date = dates[di];
    let list = byEntry.get(date) || [];
    if (list.length) {
      const before = list.length;
      if (rule.pause) list = list.filter(x => !rule.pause(spy.get(x.r.date) || {}));
      if (rule.breaker && di <= pausedUntil) list = [];
      if (rule.maxPerDay) list = list.slice(0, rule.maxPerDay);
      blocked += before - list.length;
    }
    const per = rule.dayCap && list.length ? Math.min(sizePct, rule.dayCap / list.length) : sizePct;
    for (const x of list) {
      if (rule.maxOpen && open.length >= rule.maxOpen) { blocked++; continue; }
      const size = per * (1 - CFG.reserve) * eqPrev, spendable = cash - CFG.reserve * eqPrev;
      if (size > spendable) { skippedCash++; continue; }
      cash -= size; opened++;
      open.push({ size, x, mtm: 0 });
    }
    const keep = [];
    for (const p of open) {
      const { r, res } = p.x, exitDate = r.bars[res.day - 1].t;
      if (date === exitDate) { cash += p.size * (1 + res.pct / 100); continue; }
      const bar = r.bars.find(b => b.t === date);
      if (bar) p.mtm = bar.c / r.entry - 1;
      keep.push(p);
    }
    open = keep;
    eqPrev = cash + open.reduce((s, p) => s + p.size * (1 + p.mtm), 0);
    eq.push(eqPrev);
    if (eqPrev > peak) peak = eqPrev;
    if (rule.breaker) {
      if (di === pausedUntil) peak = eqPrev;            // pause just ended: re-base so we can trade again
      else if (di > pausedUntil && eqPrev <= peak * (1 - rule.breaker.dd)) pausedUntil = di + rule.breaker.days;
    }
  }
  return { dates, eq, opened, skippedCash, blocked };
}

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
function curveStats(acc, a, b) {
  const idx = []; acc.dates.forEach((d, i) => { if (d >= a && d <= b) idx.push(i); });
  if (idx.length < 5) return null;
  const first = idx[0], last = idx[idx.length - 1];
  const base = first > 0 ? acc.eq[first - 1] : CFG.startEquity;
  let peak = base, dd = 0, ddDate = '', worstDay = 0, worst5 = 0;
  const rets = [];
  for (const i of idx) {
    const prev = i > 0 ? acc.eq[i - 1] : CFG.startEquity;
    const r = acc.eq[i] / prev - 1; rets.push(r); if (r < worstDay) worstDay = r;
    if (i >= 5) { const r5 = acc.eq[i] / acc.eq[i - 5] - 1; if (r5 < worst5) worst5 = r5; }
    if (acc.eq[i] > peak) peak = acc.eq[i];
    const d = acc.eq[i] / peak - 1; if (d < dd) { dd = d; ddDate = acc.dates[i]; }
  }
  // worst calendar month
  const months = new Map(); for (const i of idx) { const m = acc.dates[i].slice(0, 7); if (!months.has(m)) months.set(m, { a: i > 0 ? acc.eq[i - 1] : CFG.startEquity, b: 0 }); months.get(m).b = acc.eq[i]; }
  let worstMonth = 0, worstMonthName = ''; for (const [m, v] of months) { const r = v.b / v.a - 1; if (r < worstMonth) { worstMonth = r; worstMonthName = m; } }
  const years = (Date.parse(acc.dates[last]) - Date.parse(acc.dates[first])) / (365.25 * 864e5);
  const total = acc.eq[last] / base - 1;
  const mu = mean(rets), sd = Math.sqrt(rets.reduce((s, x) => s + (x - mu) ** 2, 0) / (rets.length - 1));
  const cagr = years > 0.5 ? (1 + total) ** (1 / years) - 1 : NaN;
  return { total, cagr, dd, ddDate, sharpe: sd > 0 ? (mu / sd) * Math.sqrt(252) : NaN, worstDay, worst5, worstMonth, worstMonthName, calmar: dd < 0 ? cagr / -dd : NaN };
}

/* ---------------------------------------------------------------------- report */
const f2 = x => (isNum(x) ? x.toFixed(2) : '  - ');
const pf = x => (isNum(x) ? `${(x * 100).toFixed(1)}%` : '  - ');
function spyStates(bars) {
  const m = new Map(); const c = bars.map(b => b.c), t = bars.map(b => String(b.t).slice(0, 10));
  for (let i = 1; i < c.length; i++) {
    let hi = c[i]; for (let k = Math.max(0, i - 251); k <= i; k++) if (c[k] > hi) hi = c[k];
    let s200 = null; if (i >= 199) { s200 = 0; for (let k = i - 199; k <= i; k++) s200 += c[k]; s200 /= 200; }
    m.set(t[i], { ret1: c[i] / c[i - 1] - 1, ret5: i >= 5 ? c[i] / c[i - 5] - 1 : 0, dd: c[i] / hi - 1, below200: s200 === null ? false : c[i] < s200 });
  }
  return m;
}
function buildReport(recs, dates, spy) {
  const L = [];
  const results = recs.map(r => simulate(r));
  const runs = SCENARIOS.map(sc => ({ sc, acc: account(recs, results, dates, sc.rule, spy) }));
  L.push('RISK-LIMIT RESEARCH: the live Dip plan (3 ATR stop unchanged) with portfolio rules added');
  L.push(`S&P 500 members at the time, $${(CFG.minDollarVol / 1e6).toFixed(0)}M/day floor, ${recs.length} Dip signals bought at the next open (skipped above +2%), +4% target, exit at the close of session 3. Before costs.`);
  L.push('Account: $100,000 start, 10% reserve, 15% of the rest per trade unless the rule changes it, ranked like the live system, marked to market daily.');
  L.push('Pre-registered pass bar: keeps 70%+ of live CAGR, cuts worst drawdown by 25%+, and CAGR/worst-drawdown is not lower than live in BOTH later periods.');
  const live = runs[0];
  const stats = runs.map(r => ({ r, all: curveStats(r.acc, '0000', '9999'), per: PERIODS.map(p => curveStats(r.acc, p[1], p[2])) }));
  const base = stats[0];
  L.push(''); L.push('='.repeat(175));
  L.push(' ALL PERIODS');
  L.push('  rule                                                                | CAGR   | worst drawdown (date)   | return/risk | Sharpe | worst day | worst 5 days | worst month        | entries taken | blocked by rule | skipped (no cash)');
  for (const s of stats) {
    const a = s.all;
    L.push(`  ${s.r.sc.label.padEnd(67)} | ${pf(a.cagr).padStart(6)} | ${(`${pf(a.dd)} (${a.ddDate})`).padEnd(23)} | ${f2(a.calmar).padStart(11)} | ${f2(a.sharpe).padStart(6)} | ${pf(a.worstDay).padStart(9)} | ${pf(a.worst5).padStart(12)} | ${(`${pf(a.worstMonth)} (${a.worstMonthName})`).padEnd(18)} | ${String(s.r.acc.opened).padStart(13)} | ${String(s.r.acc.blocked).padStart(15)} | ${String(s.r.acc.skippedCash).padStart(17)}`);
  }
  for (let p = 0; p < PERIODS.length; p++) {
    L.push(''); L.push('='.repeat(175)); L.push(` ${PERIODS[p][0]}`);
    L.push('  rule                                                                | CAGR   | worst drawdown (date)   | return/risk | worst day | worst 5 days | worst month');
    for (const s of stats) { const a = s.per[p]; if (!a) { L.push(`  ${s.r.sc.label.padEnd(67)} | not enough days`); continue; }
      L.push(`  ${s.r.sc.label.padEnd(67)} | ${pf(a.cagr).padStart(6)} | ${(`${pf(a.dd)} (${a.ddDate})`).padEnd(23)} | ${f2(a.calmar).padStart(11)} | ${pf(a.worstDay).padStart(9)} | ${pf(a.worst5).padStart(12)} | ${pf(a.worstMonth)} (${a.worstMonthName})`); }
  }
  L.push(''); L.push('='.repeat(175)); L.push(' CRASH WINDOWS: account return / worst drawdown inside the window');
  const wins = [['Feb-Mar 2020 (COVID crash)', '2020-02-15', '2020-04-15'], ['2022 bear market', '2022-01-01', '2022-10-31'], ['Nov 2026 (post-midterm AI sell-off)', '2026-10-25', '2026-11-30'], ['Last 2 months (Sep 21-Nov 20 2026)', '2026-09-21', '2026-11-20']];
  for (const [name, a, b] of wins) {
    L.push(`  ${name}   ${a} to ${b}`);
    for (const s of stats) { const cs = curveStats(s.r.acc, a, b); L.push(`      ${s.r.sc.label.padEnd(67)} ${cs ? `return ${pf(cs.total).padStart(7)}   worst drawdown ${pf(cs.dd).padStart(7)}` : 'no data'}`); }
  }
  L.push(''); L.push('='.repeat(175)); L.push(' PASS / FAIL against the pre-registered bar');
  for (const s of stats.slice(1)) {
    const keep = s.all.cagr / base.all.cagr, cut = 1 - s.all.dd / base.all.dd;
    const later = [1, 2].every(p => s.per[p] && base.per[p] && s.per[p].calmar >= base.per[p].calmar);
    const pass = keep >= 0.7 && cut >= 0.25 && later;
    L.push(`  ${pass ? 'PASS' : 'fail'}  ${s.r.sc.label.padEnd(67)} keeps ${(keep * 100).toFixed(0)}% of CAGR | drawdown cut ${(cut * 100).toFixed(0)}% | return/risk not lower in both later periods: ${later ? 'yes' : 'no'}`);
  }
  L.push(''); L.push('How to read: "return/risk" is CAGR divided by the worst drawdown. A good rule raises it. Smaller size always shrinks drawdown AND profit together; it only counts as an improvement if return/risk goes UP.');
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
  for (const c of clean) if (c.t >= CFG.testFrom) ALL_DATES.add(String(c.t).slice(0, 10));
  const ind = core.setupIndicators(clean);
  const out = [];
  for (let i = 200; i < clean.length - 3; i++) {
    const date = clean[i].t;
    if (date < CFG.testFrom || !isSp(sym, date)) continue;
    const f = core.setupFlags(ind, i);
    if (!f || !f.dip || !isNum(f.atr) || f.atr <= 0 || !(f.dollarVol >= CFG.minDollarVol)) continue;
    const entry = clean[i + 1].o;
    if (!(entry <= clean[i].c * (1 + CFG.chase))) continue;
    out.push({ date: String(date).slice(0, 10), sym, atr: f.atr, entry, vs200: f.vs200, prio: f.bearEngulf ? 0 : (f.green || f.sweep10) ? 2 : 1,
      bars: [1, 2, 3].map(d => { const b = clean[i + d]; return { t: String(b.t).slice(0, 10), o: b.o, h: b.h, l: b.l, c: b.c }; }) });
  }
  return out;
}

async function main() {
  if (!CFG.keyId || !CFG.secret) throw new Error('ALPACA_KEY_ID and ALPACA_SECRET_KEY are required.');
  const hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'sp500_history.json'), 'utf8')).members;
  const isSp = (sym, d) => (hist[sym] || []).some(([a, b]) => d >= a && (b === null || d < b));
  let symbols = Object.keys(hist).filter(s => /^[A-Z.]{1,6}$/.test(s) && hist[s].some(([, b]) => b === null || b >= CFG.testFrom)).sort();
  if (CFG.maxSymbols) symbols = symbols.slice(0, CFG.maxSymbols);
  log(`Symbols: ${symbols.length}`);
  const spyBars = (await fetchDaily(['SPY'])).get('SPY') || [];
  if (spyBars.length < 400) throw new Error(`SPY history too short (${spyBars.length} bars); the market-stress rules cannot run.`);
  const spy = spyStates(spyBars);
  log(`SPY bars: ${spyBars.length}`);
  const recs = []; let withData = 0, skipped = 0;
  for (let b = 0; b < symbols.length; b += CFG.batch) {
    const chunk = symbols.slice(b, b + CFG.batch);
    let bars = null;
    try { bars = await fetchDaily(chunk); } catch (e) { skipped++; log(`  BATCH SKIPPED (${chunk[0]}..${chunk[chunk.length - 1]}): ${e.message}`); }
    if (bars) for (const [sym, list] of bars) { if (list.length < 260) continue; withData++; for (const r of signalsFor(sym, list, isSp)) recs.push(r); }
    log(`  ${Math.min(b + CFG.batch, symbols.length)}/${symbols.length} symbols, ${withData} with data, ${recs.length} bought Dip signals so far`);
  }
  recs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sym < b.sym ? -1 : 1));
  const dates = [...ALL_DATES].sort();
  fs.mkdirSync(CFG.out, { recursive: true });
  const header = `RUN CHECK: ${symbols.length} symbols requested, ${withData} had enough data, ${skipped} download batches skipped, ${recs.length} bought signals, ${dates.length} trading days, ${spyBars.length} SPY bars.\n\n`;
  const report = header + (recs.length ? buildReport(recs, dates, spy) : 'No Dip signals were found. Check the download above.');
  fs.writeFileSync(path.join(CFG.out, 'summary.txt'), report + '\n');
  console.log('\n' + report);
  log(`Done; results in ${CFG.out}/`);
}

if (require.main === module) main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
module.exports = { simulate, account, curveStats, spyStates, buildReport, signalsFor, SCENARIOS, CFG };
