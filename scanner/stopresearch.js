#!/usr/bin/env node
/*
 * Stop-loss research for the Uptrend Dip: what if the stop is strictly limited to a fixed % below the entry price?
 *
 * Same signals and plan as the live system (../app.js): S&P 500 members at the time, $20M/day floor, buy the next open
 * (skipped if it opens more than 2% above the signal close), +4% target, exit at the close of session 3 at the latest.
 * Only the STOP changes:  3 ATR (live)  versus a fixed 3% / 4% / 5% / 6% / 8% below the entry price.
 *
 * Stop fills are realistic: if a session OPENS at or below the stop (a gap), the fill is the open, which is worse than the
 * stop. Inside a day, if both the stop and the target were touched we assume the STOP came first (conservative); a second
 * line for the 4% stop shows the optimistic case so you can see how much this assumption matters. Before costs.
 *
 * Also runs the account simulation the live system uses: 10% reserve, 15% of the sleeve per trade, ranked by priority,
 * no cap on positions, marked to market every day, so drawdowns are real daily drawdowns, not trade averages.
 *
 * Read-only: downloads daily bars with your Alpaca keys, never touches orders.
 * Usage: ALPACA_KEY_ID=... ALPACA_SECRET_KEY=... node scanner/stopresearch.js
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
  start: env.SR_START || '2015-06-01',
  testFrom: env.SR_TEST_FROM || '2016-06-01',
  maxSymbols: num(env.SR_MAX_SYMBOLS, 0),
  batch: num(env.SR_BATCH, 50),
  out: env.SR_OUT || 'research-out-stop',
  minDollarVol: num(env.SR_MIN_DOLLAR_VOL, 20e6),
  chase: 0.02, target: 0.04, hold: 3, reserve: 0.10, size: 0.15, startEquity: 100000,
};
const PERIODS = [['Oct 2016 to 2019', '2016-01-01', '2019-12-31'], ['2020 to 2022', '2020-01-01', '2022-12-31'], ['2023 to 2026', '2023-01-01', '2026-12-31']];
const VARIANTS = [
  { id: 'atr3', label: '3 ATR stop (LIVE, about 12% away)', atr: 3 },
  { id: 'p8', label: 'fixed 8% stop', pct: 0.08 },
  { id: 'p6', label: 'fixed 6% stop', pct: 0.06 },
  { id: 'p5', label: 'fixed 5% stop', pct: 0.05 },
  { id: 'p4', label: 'fixed 4% stop   <== YOUR QUESTION', pct: 0.04, focus: true },
  { id: 'p4o', label: 'fixed 4%, optimistic (target before stop if both hit)', pct: 0.04, optimistic: true },
  { id: 'p3', label: 'fixed 3% stop', pct: 0.03 },
];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ALL_DATES = new Set();

/* ------------------------------------------------------------ trade simulation */
/**
 * Long trade bought at the open of session 1. rec.bars = 3 sessions [{t,o,h,l,c}], rec.entry = the buy price.
 * Returns { pct, how, day, gap, amb } : gap = filled beyond the stop because the session opened through it,
 * amb = the stop and the target were both touched in the same session.
 */
function simulate(rec, v) {
  const entry = rec.entry, target = entry * (1 + CFG.target);
  const stop = v.atr ? entry - v.atr * rec.atr : entry * (1 - v.pct);
  for (let d = 1; d <= CFG.hold; d++) {
    const k = rec.bars[d - 1];
    if (d > 1) {
      if (k.o >= target) return { pct: (k.o / entry - 1) * 100, how: 'target', day: d };
      if (k.o <= stop) return { pct: (k.o / entry - 1) * 100, how: 'stop', day: d, gap: true };
    }
    const hitS = k.l <= stop, hitT = k.h >= target;
    if (hitS && hitT) {
      if (v.optimistic) return { pct: CFG.target * 100, how: 'target', day: d, amb: true };
      return { pct: (stop / entry - 1) * 100, how: 'stop', day: d, amb: true };
    }
    if (hitS) return { pct: (stop / entry - 1) * 100, how: 'stop', day: d };
    if (hitT) return { pct: CFG.target * 100, how: 'target', day: d };
    if (d === CFG.hold) return { pct: (k.c / entry - 1) * 100, how: 'time', day: d };
  }
  return null;
}

/* ------------------------------------------------------------- account simulation */
/** Daily marked-to-market account. Returns { dates, eq[], opened, skipped, maxOpen }. */
function account(recs, results, dates) {
  const byEntry = new Map();
  recs.forEach((r, i) => { const res = results[i]; if (!res) return; const e = r.bars[0].t; if (!byEntry.has(e)) byEntry.set(e, []); byEntry.get(e).push({ r, res }); });
  for (const list of byEntry.values()) list.sort((a, b) => (a.r.prio - b.r.prio) || (b.r.vs200 - a.r.vs200));
  let cash = CFG.startEquity, eqPrev = CFG.startEquity, open = [], opened = 0, skipped = 0, maxOpen = 0;
  const eq = [];
  for (const date of dates) {
    for (const x of byEntry.get(date) || []) {
      const sleeve = (1 - CFG.reserve) * eqPrev, size = CFG.size * sleeve, spendable = cash - CFG.reserve * eqPrev;
      if (size > spendable) { skipped++; continue; }
      cash -= size; opened++;
      open.push({ size, x, mtm: 0 });
    }
    maxOpen = Math.max(maxOpen, open.length);
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
  }
  return { dates, eq, opened, skipped, maxOpen };
}

function curveStats(acc, a, b) {
  const idx = []; acc.dates.forEach((d, i) => { if (d >= a && d <= b) idx.push(i); });
  if (idx.length < 5) return null;
  const first = idx[0], last = idx[idx.length - 1];
  const base = first > 0 ? acc.eq[first - 1] : CFG.startEquity;
  let peak = base, dd = 0, ddDate = '';
  const rets = [];
  for (const i of idx) {
    const prev = i > 0 ? acc.eq[i - 1] : CFG.startEquity;
    rets.push(acc.eq[i] / prev - 1);
    if (acc.eq[i] > peak) peak = acc.eq[i];
    const d = acc.eq[i] / peak - 1; if (d < dd) { dd = d; ddDate = acc.dates[i]; }
  }
  const years = (Date.parse(acc.dates[last]) - Date.parse(acc.dates[first])) / (365.25 * 864e5);
  const total = acc.eq[last] / base - 1;
  const mu = mean(rets), sd = Math.sqrt(rets.reduce((s, x) => s + (x - mu) ** 2, 0) / (rets.length - 1));
  return { total, cagr: years > 0.5 ? (1 + total) ** (1 / years) - 1 : NaN, dd, ddDate, sharpe: sd > 0 ? (mu / sd) * Math.sqrt(252) : NaN, years };
}

/* ----------------------------------------------------------------------- stats */
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const f1 = x => (isNum(x) ? x.toFixed(1) : '  - ');
const f2 = x => (isNum(x) ? x.toFixed(2) : '  - ');
const pc = x => (isNum(x) ? `${(x * 100).toFixed(0)}%` : ' - ');
const pf = x => (isNum(x) ? `${(x * 100).toFixed(1)}%` : '  - ');
function seMean(rows, f) {
  const by = new Map();
  for (const r of rows) { const v = f(r); if (!isNum(v)) continue; if (!by.has(r.date)) by.set(r.date, []); by.get(r.date).push(v); }
  const m = [...by.values()].map(mean), n = m.length;
  if (n < 3) return NaN;
  const mu = mean(m);
  return Math.sqrt(m.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1)) / Math.sqrt(n);
}
function tradeStats(rows) {  // rows: [{date, res}]
  const n = rows.length, share = f => (n ? rows.filter(f).length / n : NaN);
  const stopped = rows.filter(r => r.res.how === 'stop');
  return { n, avg: mean(rows.map(r => r.res.pct)), se: seMean(rows, r => r.res.pct), win: share(r => r.res.pct > 0), hit: share(r => r.res.how === 'target'),
    stop: share(r => r.res.how === 'stop'), avgStop: mean(stopped.map(r => r.res.pct)), gapShare: stopped.length ? stopped.filter(r => r.res.gap).length / stopped.length : NaN,
    amb: share(r => r.res.amb), worst: n ? Math.min(...rows.map(r => r.res.pct)) : NaN };
}

/* ---------------------------------------------------------------------- report */
function buildReport(recs, dates) {
  const L = [];
  const res = new Map(VARIANTS.map(v => [v.id, recs.map(r => simulate(r, v))]));
  const accs = new Map(VARIANTS.map(v => [v.id, account(recs, res.get(v.id), dates)]));
  L.push('STOP-LOSS RESEARCH: the live Dip plan with different stops');
  L.push(`S&P 500 members at the time, $${(CFG.minDollarVol / 1e6).toFixed(0)}M/day floor, ${recs.length} Dip signals bought at the next open (skipped above +2%), +4% target, exit at the close of session 3.`);
  L.push('Stops that gap: if a session opens through the stop, the fill is the open (worse than the stop). If stop and target both trade in one session the stop is assumed first, except the "optimistic" line.');
  L.push('Account: $100,000 start, 10% reserve, 15% of the rest per trade, ranked like the live system, no position cap, marked to market daily. Before costs.');
  const ranges = [['ALL PERIODS', '0000', '9999'], ...PERIODS];
  for (const [name, a, b] of ranges) {
    const idxs = recs.map((r, i) => i).filter(i => recs[i].date >= a && recs[i].date <= b);
    L.push(''); L.push('='.repeat(160));
    L.push(` ${name}  (${idxs.length} signals)  TRADE LEVEL (per trade, equal weight)`);
    L.push('  stop rule                                              | avg trade (95% margin) | win  | hit +4% | stopped | avg loss when stopped | stops that gapped | both hit same day | worst trade');
    for (const v of VARIANTS) {
      const rows = idxs.map(i => ({ date: recs[i].date, res: res.get(v.id)[i] })).filter(r => r.res);
      const s = tradeStats(rows);
      L.push(`  ${v.label.padEnd(54)} | ${(`${f2(s.avg).padStart(6)}% ±${f2(1.96 * s.se)}`).padEnd(22)} | ${pc(s.win).padStart(4)} | ${pc(s.hit).padStart(7)} | ${pc(s.stop).padStart(7)} | ${(`${f2(s.avgStop)}%`).padStart(21)} | ${pc(s.gapShare).padStart(17)} | ${pc(s.amb).padStart(17)} | ${f1(s.worst)}%`);
    }
    L.push(`  ACCOUNT LEVEL (same period)`);
    L.push('  stop rule                                              | total return | CAGR   | worst drawdown (date)   | Sharpe | trades opened | skipped (no cash) | max open at once');
    for (const v of VARIANTS) {
      const acc = accs.get(v.id), cs = curveStats(acc, a, b);
      if (!cs) { L.push(`  ${v.label.padEnd(54)} | not enough days`); continue; }
      L.push(`  ${v.label.padEnd(54)} | ${pf(cs.total).padStart(12)} | ${pf(cs.cagr).padStart(6)} | ${(`${pf(cs.dd)} (${cs.ddDate})`).padEnd(23)} | ${f2(cs.sharpe).padStart(6)} | ${name === 'ALL PERIODS' ? String(acc.opened).padStart(13) : '            -'} | ${name === 'ALL PERIODS' ? String(acc.skipped).padStart(17) : '                -'} | ${name === 'ALL PERIODS' ? String(acc.maxOpen).padStart(16) : '               -'}`);
    }
  }
  // calendar years
  L.push(''); L.push('='.repeat(160)); L.push(' ACCOUNT RETURN BY CALENDAR YEAR');
  const years = [...new Set(dates.map(d => d.slice(0, 4)))];
  L.push('  stop rule                                              | ' + years.join(' | '));
  for (const v of VARIANTS) {
    const acc = accs.get(v.id);
    L.push(`  ${v.label.padEnd(54)} | ` + years.map(y => { const cs = curveStats(acc, `${y}-01-01`, `${y}-12-31`); return (cs ? pf(cs.total) : '  -').padStart(5); }).join(' | '));
  }
  // crash windows
  L.push(''); L.push('='.repeat(160)); L.push(' CRASH WINDOWS: account return and worst drawdown inside the window (signals bought during it)');
  const wins = [['Feb-Mar 2020 (COVID crash)', '2020-02-15', '2020-04-15'], ['2022 bear market', '2022-01-01', '2022-10-31'], ['Aug 2024 and Apr 2025 shocks', '2024-07-25', '2024-08-31'], ['Nov 2026 (post-midterm AI sell-off)', '2026-10-25', '2026-11-30']];
  for (const [name, a, b] of wins) {
    L.push(`  ${name}   ${a} to ${b}`);
    for (const v of VARIANTS) { const cs = curveStats(accs.get(v.id), a, b); L.push(`      ${v.label.padEnd(54)} ${cs ? `return ${pf(cs.total).padStart(7)}  worst drawdown ${pf(cs.dd).padStart(7)} (${cs.ddDate})` : 'no data in window'}`); }
  }
  // worst crowded days
  L.push(''); L.push('='.repeat(160)); L.push(' THE 8 WORST SIGNAL DAYS UNDER THE LIVE 3 ATR STOP (days with 8+ signals): average trade for each stop rule');
  const byDate = new Map(); recs.forEach((r, i) => { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(i); });
  const dayAvg = (id, idxs) => mean(idxs.filter(i => res.get(id)[i]).map(i => res.get(id)[i].pct));
  const crowded = [...byDate.entries()].filter(([, ix]) => ix.length >= 8).map(([d, ix]) => ({ d, ix, base: dayAvg('atr3', ix) })).sort((a, b) => a.base - b.base).slice(0, 8);
  L.push('  signal day  | signals | ' + VARIANTS.map(v => v.id.padStart(6)).join(' | '));
  for (const c of crowded) L.push(`  ${c.d}  | ${String(c.ix.length).padStart(7)} | ` + VARIANTS.map(v => `${f2(dayAvg(v.id, c.ix))}`.padStart(6)).join(' | '));
  L.push(''); L.push('How to read: a tighter stop cuts the size of each loss but gets hit far more often. The question is whether the account ends better, with a smaller worst drawdown, not whether single losses look smaller.');
  return { text: L.join('\n'), res };
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
    out.push({ date, sym, atr: f.atr, entry, vs200: f.vs200, prio: f.bearEngulf ? 0 : (f.green || f.sweep10) ? 2 : 1,
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
  const header = `RUN CHECK: ${symbols.length} symbols requested, ${withData} had enough data, ${skipped} download batches skipped, ${recs.length} bought signals, ${dates.length} trading days.\n\n`;
  let report = header + 'No Dip signals were found. Check the download above.';
  if (recs.length) {
    const out = buildReport(recs, dates); report = header + out.text;
    const csv = ['date,sym,atr,entry,prio,' + VARIANTS.map(v => `${v.id}_pct,${v.id}_how,${v.id}_day`).join(',')]
      .concat(recs.map((r, i) => [r.date, r.sym, r.atr.toFixed(4), r.entry, r.prio, ...VARIANTS.flatMap(v => { const x = out.res.get(v.id)[i]; return [x.pct.toFixed(3), x.how, x.day]; })].join(',')));
    fs.writeFileSync(path.join(CFG.out, 'trades.csv'), csv.join('\n') + '\n');
  }
  fs.writeFileSync(path.join(CFG.out, 'summary.txt'), report + '\n');
  console.log('\n' + report);
  log(`Done; results in ${CFG.out}/`);
}

if (require.main === module) main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
module.exports = { simulate, account, curveStats, tradeStats, buildReport, signalsFor, VARIANTS, CFG };
