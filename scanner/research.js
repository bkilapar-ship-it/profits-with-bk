#!/usr/bin/env node
/*
 * Trade With BK — one-off research: do Uptrend Dip / Downtrend Rip work on liquid
 * stocks OUTSIDE the S&P 500 (the SOFI / MSTR kind)?
 *
 * Runs in GitHub Actions with the same Alpaca keys as the scanner. Read-only: it
 * only downloads market data and never touches the trading API's order endpoints.
 *
 * 1. Lists US-listed common stocks from Alpaca, active AND inactive (delisted), so
 *    companies that later collapsed are included (avoids survivorship bias).
 * 2. Downloads split/dividend-adjusted daily bars from 2015 (2016 onward is tested;
 *    2015 is warm-up for the 200-day average), a batch of symbols at a time.
 * 3. On each signal day, classifies the stock point-in-time:
 *      "S&P 500"      member of the index on that date (the control group)
 *      "Outside, $20-100M" / "$100-500M" / "$500M+"  not a member, by median daily
 *                     dollar volume over the prior 60 sessions
 *    Stocks below $5 or trading under $20M a day are ignored.
 * 4. Uses the exact Uptrend Dip / Downtrend Rip rules from app.js, entry at the next
 *    open, 1.5 x ATR target, 3 x ATR stop, exit at the close of the 3rd session.
 * 5. Prints a summary table by group and era, and writes every signal to
 *    research-out/signals.csv (uploaded by the workflow as a downloadable artifact).
 *
 * Not financial advice.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../app.js');

const env = process.env;
const CFG = {
  keyId: env.ALPACA_KEY_ID || '',
  secret: env.ALPACA_SECRET_KEY || '',
  tradingBase: (env.ALPACA_TRADING_BASE || 'https://paper-api.alpaca.markets').replace(/\/+$/, ''),
  dataBase: (env.ALPACA_DATA_BASE || 'https://data.alpaca.markets').replace(/\/+$/, ''),
  feed: (env.ALPACA_FEED || 'sip').toLowerCase(),
  start: env.RESEARCH_START || '2015-01-01',
  testFrom: env.RESEARCH_TEST_FROM || '2016-01-01',
  minPrice: Number(env.RESEARCH_MIN_PRICE || 5),
  minDollarVol: Number(env.RESEARCH_MIN_DOLLAR_VOL || 20e6),
  batch: Number(env.RESEARCH_BATCH || 50),
  rpm: Number(env.ALPACA_RPM || 180),
  maxSymbols: Number(env.RESEARCH_MAX_SYMBOLS || 0),   // 0 = no limit (useful for a quick trial run)
  outDir: env.RESEARCH_OUT || 'research-out',
  costRoundTrip: Number(env.RESEARCH_COST || 0.2),      // % per round trip, shown alongside gross results
};
const HOLD = 3, FWD = 5;
const ERAS = [['2016–2020', '2016-01-01', '2020-12-31'], ['2021–2026', '2021-01-01', '2099-12-31']];
const GROUPS = ['S&P 500 (control)', 'Outside $20-100M/day', 'Outside $100-500M/day', 'Outside $500M+/day'];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/* ---------------------------------------------------------------- HTTP */
const stamps = [];
async function limit() {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > 60000) stamps.shift();
    if (stamps.length < CFG.rpm) { stamps.push(now); return; }
    await sleep(60000 - (now - stamps[0]) + 50);
  }
}
let requests = 0;
async function get(url, attempt = 0) {
  await limit(); requests++;
  let res;
  try {
    res = await fetch(url, { headers: { 'APCA-API-KEY-ID': CFG.keyId, 'APCA-API-SECRET-KEY': CFG.secret, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  } catch (e) {
    if (attempt < 5) { await sleep(2000 * 2 ** attempt); return get(url, attempt + 1); }
    throw new Error(`Network error: ${e.message}`);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 6) { await sleep(Math.min(3000 * 2 ** attempt, 60000)); return get(url, attempt + 1); }
  if (!res.ok) throw new Error(`Alpaca HTTP ${res.status} for ${url.split('?')[0]}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/* ------------------------------------------------------------ universe */
const EXCLUDE_NAME = /\b(ETF|ETN|FUND|WARRANTS?|RIGHTS?|UNITS?|PREFERRED|NOTES|ISHARES|SPDR|PROSHARES|DIREXION|LEVERAGED|INVERSE|2X|3X)\b/i;
const EXCHANGES = new Set(['NYSE', 'NASDAQ', 'AMEX', 'ARCA', 'BATS']);

async function listAssets() {
  const out = new Map(); const counts = {};
  for (const status of ['active', 'inactive']) {
    const list = await get(`${CFG.tradingBase}/v2/assets?asset_class=us_equity&status=${status}`);
    let kept = 0;
    for (const a of list) {
      if (!/^[A-Z]{1,5}$/.test(a.symbol) || !EXCHANGES.has(a.exchange) || EXCLUDE_NAME.test(a.name || '')) continue;
      if (out.has(a.symbol)) continue;          // a reused ticker: keep the first (active) listing
      out.set(a.symbol, status); kept++;
    }
    counts[status] = kept;
  }
  return { symbols: [...out.keys()], status: out, counts };
}

function loadSp500() {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'sp500_history.json'), 'utf8'));
  return (sym, date) => (j.members[sym] || []).some(([a, b]) => date >= a && (b === null || date < b));
}

/* ---------------------------------------------------------------- bars */
async function fetchBars(symbols) {
  const bars = new Map(symbols.map(s => [s, []]));
  let token = null;
  do {
    const q = new URLSearchParams({ symbols: symbols.join(','), timeframe: '1Day', start: CFG.start, adjustment: 'all', feed: CFG.feed, limit: '10000', sort: 'asc' });
    if (token) q.set('page_token', token);
    const j = await get(`${CFG.dataBase}/v2/stocks/bars?${q}`);
    for (const [sym, list] of Object.entries(j.bars || {})) {
      const arr = bars.get(sym);
      if (arr) for (const b of list) arr.push({ t: b.t.slice(0, 10), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    }
    token = j.next_page_token || null;
  } while (token);
  return bars;
}

/* ------------------------------------------------------------ analysis */
function median(a) { const s = a.filter(isNum).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; }

function wilderRsi(c, n) {
  const out = new Array(c.length).fill(NaN); let up = 0, dn = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= n) { up += u / n; dn += w / n; if (i === n) out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn); }
    else { up = (up * (n - 1) + u) / n; dn = (dn * (n - 1) + w) / n; out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn); }
  }
  return out;
}

/** 1.5 ATR target, 3 ATR stop, entry at the day-1 open, exit at the day-3 close (stop first on same-day ambiguity). */
function simulate(candles, i, atr, long) {
  const E = candles[i + 1].o, s = long ? 1 : -1;
  const tg = E + s * 1.5 * atr, sp = E - s * 3 * atr;
  const ret = px => s * (px / E - 1) * 100;
  for (let j = 1; j <= HOLD; j++) {
    const k = candles[i + j];
    if (j > 1) {
      if (long ? k.o >= tg : k.o <= tg) return ret(k.o);
      if (long ? k.o <= sp : k.o >= sp) return ret(k.o);
    }
    if (long ? k.l <= sp : k.h >= sp) return ret(sp);
    if (long ? k.h >= tg : k.l <= tg) return ret(tg);
    if (j === HOLD) return ret(k.c);
  }
  return NaN;
}

function spy20Map(spy) {
  const m = new Map();
  for (let i = 20; i < spy.length; i++) m.set(spy[i].t, spy[i].c / spy[i - 20].c - 1);
  return m;
}

function analyse(sym, candles, isSp, spy20, rows, delisted) {
  if (candles.length < 230) return;
  const ind = core.setupIndicators(candles);
  const c = candles.map(x => x.c);
  const rsi5 = wilderRsi(c, 5);
  const dv = candles.map(x => x.c * x.v);
  for (let i = 205; i < candles.length - FWD; i++) {
    const date = candles[i].t;
    if (date < CFG.testFrom) continue;
    const f = core.setupFlags(ind, i);
    if (!f || !(f.dip || f.rip)) continue;
    if (candles[i].c < CFG.minPrice) continue;
    const dv60 = median(dv.slice(i - 60, i));
    if (!(dv60 >= CFG.minDollarVol)) continue;
    const sp = isSp(sym, date);
    const group = sp ? GROUPS[0] : dv60 < 100e6 ? GROUPS[1] : dv60 < 500e6 ? GROUPS[2] : GROUPS[3];
    const prev = candles[i - 1], cur = candles[i];
    const bearEng = prev.c > prev.o && cur.c < cur.o && cur.o >= prev.c && cur.c <= prev.o;
    for (const kind of ['dip', 'rip']) {
      if (!f[kind]) continue;
      const res = simulate(candles, i, f.atr, kind === 'dip');
      if (!isNum(res)) continue;
      rows.push({ date, sym, kind, group, delisted: delisted ? 1 : 0, close: cur.c, dv60: Math.round(dv60),
        vs200: f.vs200 * 100, chg5d: f.r5 * 100, rsi14: f.rsi, rsi5: rsi5[i], bearEng: bearEng ? 1 : 0,
        green: cur.c > cur.o ? 1 : 0, spy20: spy20.get(date), res });
    }
  }
}

/* ------------------------------------------------------------- report */
function stats(rs) {
  if (!rs.length) return null;
  const s = [...rs].sort((a, b) => a - b);
  const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
  return { n: rs.length, avg, win: rs.filter(x => x > 0).length / rs.length * 100,
    lost5: rs.filter(x => x < -5).length / rs.length * 100, worst5: s[Math.floor(s.length * 0.05)] };
}
const f2 = x => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;

function report(rows) {
  const lines = [];
  const say = t => { lines.push(t); console.log(t); };
  say('\n==================== RESULTS ====================');
  say(`Entry at the next open; 1.5 x ATR target; 3 x ATR stop; exit at the close of session 3. "net" = after ${CFG.costRoundTrip}% round-trip cost.`);
  for (const [kind, title] of [['dip', 'UPTREND DIP (long)'], ['rip', 'DOWNTREND RIP (short)']]) {
    say(`\n${title}`);
    for (const g of GROUPS) {
      const cells = ERAS.map(([e, lo, hi]) => {
        const st = stats(rows.filter(r => r.kind === kind && r.group === g && r.date >= lo && r.date <= hi).map(r => r.res));
        return st ? `${e}: n=${st.n} avg ${f2(st.avg)} (net ${f2(st.avg - CFG.costRoundTrip)}) win ${st.win.toFixed(0)}% lost>5% ${st.lost5.toFixed(0)}% worst5% ${st.worst5.toFixed(1)}%` : `${e}: no signals`;
      });
      say(`  ${g}\n    ${cells.join('\n    ')}`);
    }
  }
  say('\nOVERLAYS on stocks OUTSIDE the S&P 500 (all liquidity groups together, both eras)');
  const out = rows.filter(r => r.group !== GROUPS[0]);
  const line = (label, rs) => { const st = stats(rs.map(r => r.res)); say(`  ${label.padEnd(44)} ${st ? `n=${st.n} avg ${f2(st.avg)} win ${st.win.toFixed(0)}%` : 'no signals'}`); };
  const dip = out.filter(r => r.kind === 'dip'), rip = out.filter(r => r.kind === 'rip');
  line('Dip, all', dip);
  line('Dip, bearish engulfing on signal day', dip.filter(r => r.bearEng));
  line('Dip, green signal day', dip.filter(r => r.green));
  line('Dip, market down over 20 days', dip.filter(r => r.spy20 <= 0));
  line('Dip, market up over 20 days', dip.filter(r => r.spy20 > 0));
  line('Rip, all', rip);
  line('Rip, RSI(5) >= 90', rip.filter(r => r.rsi5 >= 90));
  line('Rip, RSI(5) < 90', rip.filter(r => r.rsi5 < 90));
  line('Rip, market up over 20 days', rip.filter(r => r.spy20 > 0));
  line('Rip, market down over 20 days', rip.filter(r => r.spy20 <= 0));
  const delistedOut = out.filter(r => r.delisted).length;
  say(`\nSignals from later-delisted stocks outside the S&P 500: ${delistedOut} of ${out.length} (${(delistedOut / Math.max(out.length, 1) * 100).toFixed(1)}%).`);
  say('If this is near 0%, Alpaca returned little history for delisted stocks and results may be too optimistic.');
  const topNames = {};
  for (const r of out) topNames[r.sym] = (topNames[r.sym] || 0) + 1;
  say(`Most frequent names outside the S&P 500: ${Object.entries(topNames).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([s, n]) => `${s} (${n})`).join(', ')}`);
  return lines.join('\n');
}

/* --------------------------------------------------------------- main */
async function main() {
  if (!CFG.keyId || !CFG.secret) throw new Error('ALPACA_KEY_ID / ALPACA_SECRET_KEY are not set.');
  const t0 = Date.now();
  const isSp = loadSp500();
  const { symbols: all, status, counts } = await listAssets();
  const symbols = CFG.maxSymbols ? all.slice(0, CFG.maxSymbols) : all;
  log(`Universe: ${counts.active} active + ${counts.inactive} delisted stocks after filters; testing ${symbols.length}.`);
  const spyBars = (await fetchBars(['SPY'])).get('SPY');
  const spy20 = spy20Map(spyBars);
  log(`SPY: ${spyBars.length} daily bars.`);
  const rows = []; let withData = 0, delistedWithData = 0;
  for (let b = 0; b < symbols.length; b += CFG.batch) {
    const chunk = symbols.slice(b, b + CFG.batch);
    let bars;
    try { bars = await fetchBars(chunk); } catch (e) { log(`  batch ${b / CFG.batch + 1} skipped: ${e.message}`); continue; }
    for (const [sym, candles] of bars) {
      if (candles.length >= 230) { withData++; if (status.get(sym) === 'inactive') delistedWithData++; }
      analyse(sym, candles, isSp, spy20, rows, status.get(sym) === 'inactive');
    }
    if ((b / CFG.batch) % 10 === 0) log(`  ${Math.min(b + CFG.batch, symbols.length)}/${symbols.length} symbols, ${rows.length} signals so far, ${requests} requests`);
  }
  log(`Stocks with enough history: ${withData} (of which delisted: ${delistedWithData}). Signals: ${rows.length}. ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
  fs.mkdirSync(CFG.outDir, { recursive: true });
  const cols = ['date', 'sym', 'kind', 'group', 'delisted', 'close', 'dv60', 'vs200', 'chg5d', 'rsi14', 'rsi5', 'bearEng', 'green', 'spy20', 'res'];
  fs.writeFileSync(path.join(CFG.outDir, 'signals.csv'),
    [cols.join(',')].concat(rows.map(r => cols.map(k => (isNum(r[k]) ? Math.round(r[k] * 1e4) / 1e4 : JSON.stringify(r[k] ?? ''))).join(','))).join('\n'));
  const summary = report(rows);
  fs.writeFileSync(path.join(CFG.outDir, 'summary.txt'), summary);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, '```\n' + summary + '\n```\n');
}

if (require.main === module) main().catch(e => { console.error(`Research error: ${e.message}`); process.exitCode = 1; });
module.exports = { main, simulate, analyse, stats, wilderRsi, EXCLUDE_NAME };
