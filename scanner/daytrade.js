#!/usr/bin/env node
/*
 * Trade With BK — one-off DAY-TRADING research. Runs in GitHub Actions with your Alpaca keys;
 * read-only (it only downloads market data, never touches orders).
 *
 * Downloads 15-minute bars (2016 onward) for stocks that were S&P 500 members on each date, plus
 * SPY, and tests three ideas with the same three-period discipline as the rest of this project:
 *
 *  1. Opening-range breakout (ORB) on "stocks in play". Each morning, rank members by the volume
 *     of their first 15-minute bar versus its 14-day average; take the top 20 (price >= $5,
 *     average volume >= 1M shares, daily ATR >= $0.50). Trade in the direction of that first bar:
 *     buy a break above its high (short a break below its low), exit at the close. Two stops are
 *     tested: the other side of the opening range, and 10% of the daily ATR from entry.
 *     The published version of this idea uses 5-minute bars; 15-minute bars keep the download
 *     practical. Inside one bar we can't see the order of moves, so if the entry bar also touches
 *     the stop we count it as stopped out (conservative).
 *  2. SPY intraday momentum: the move from yesterday's close to 10:00 predicts the last half hour.
 *     Long or short SPY from 15:30 to the close in that direction.
 *  3. Overnight Dip execution check: at 15:45, using that moment's price, does the Uptrend Dip /
 *     Downtrend Rip signal already show? Compares with the final close, and measures the result of
 *     buying (shorting) at the close whenever the 15:45 check fires.
 *
 * Writes a summary (also to the run's Summary page) and CSVs to research-out-daytrade/.
 * Not financial advice.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const env = process.env;
const CFG = {
  keyId: env.ALPACA_KEY_ID || '', secret: env.ALPACA_SECRET_KEY || '',
  dataBase: (env.ALPACA_DATA_BASE || 'https://data.alpaca.markets').replace(/\/+$/, ''),
  feed: (env.ALPACA_FEED || 'sip').toLowerCase(),
  start: env.DT_START || '2015-06-01',          // 200+ trading days of warm-up before the test period
  testFrom: env.DT_TEST_FROM || '2016-01-01',
  batch: Number(env.DT_BATCH || 8),
  rpm: Number(env.ALPACA_RPM || 180),
  maxSymbols: Number(env.DT_MAX_SYMBOLS || 0),
  topN: Number(env.DT_TOP_N || 20),
  outDir: env.DT_OUT || 'research-out-daytrade',
  costs: [0, 0.05, 0.10],                        // % round trip per trade
};
const ERAS = [['2016-2020', '2016-01-01', '2020-12-31'], ['2021-2023', '2021-01-01', '2023-12-31'], ['2024-2026', '2024-01-01', '2099-12-31']];
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------ time (US Eastern, DST-aware) */
const dstCache = {};
function dstBounds(y) {
  if (dstCache[y]) return dstCache[y];
  const mar1 = new Date(Date.UTC(y, 2, 1)).getUTCDay(), nov1 = new Date(Date.UTC(y, 10, 1)).getUTCDay();
  const secondSunMar = 1 + ((7 - mar1) % 7) + 7, firstSunNov = 1 + ((7 - nov1) % 7);
  return (dstCache[y] = [Date.UTC(y, 2, secondSunMar, 7), Date.UTC(y, 10, firstSunNov, 6)]);
}
/** UTC ISO timestamp -> { d: 'YYYY-MM-DD' Eastern date, m: minutes after midnight Eastern } */
function toET(iso) {
  const ms = Date.parse(iso), y = new Date(ms).getUTCFullYear(), [a, b] = dstBounds(y);
  const L = new Date(ms - (ms >= a && ms < b ? 4 : 5) * 3600e3);
  return { d: L.toISOString().slice(0, 10), m: L.getUTCHours() * 60 + L.getUTCMinutes() };
}

/* ------------------------------------------------------------ HTTP */
const stamps = []; let requests = 0;
async function limit() {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > 60000) stamps.shift();
    if (stamps.length < CFG.rpm) { stamps.push(now); return; }
    await sleep(60000 - (now - stamps[0]) + 50);
  }
}
async function get(url, attempt = 0) {
  await limit(); requests++;
  let res;
  try { res = await fetch(url, { headers: { 'APCA-API-KEY-ID': CFG.keyId, 'APCA-API-SECRET-KEY': CFG.secret, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) }); }
  catch (e) { if (attempt < 5) { await sleep(2000 * 2 ** attempt); return get(url, attempt + 1); } throw new Error(`Network error: ${e.message}`); }
  if ((res.status === 429 || res.status >= 500) && attempt < 6) { await sleep(Math.min(3000 * 2 ** attempt, 60000)); return get(url, attempt + 1); }
  if (!res.ok) throw new Error(`Alpaca HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function fetchBars(symbols) {
  const out = new Map(symbols.map(s => [s, []]));
  let token = null;
  do {
    const q = new URLSearchParams({ symbols: symbols.join(','), timeframe: '15Min', start: CFG.start, adjustment: 'all', feed: CFG.feed, limit: '10000', sort: 'asc' });
    if (token) q.set('page_token', token);
    const j = await get(`${CFG.dataBase}/v2/stocks/bars?${q}`);
    for (const [sym, list] of Object.entries(j.bars || {})) {
      const arr = out.get(sym);
      if (!arr) continue;
      for (const b of list) { const t = toET(b.t); if (t.m >= 570 && t.m < 960) arr.push({ d: t.d, m: t.m, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }); }
    }
    token = j.next_page_token || null;
  } while (token);
  return out;
}

/* ------------------------------------------------------------ per-symbol preparation */
/** Group regular-session bars into days, and build daily candles + the indicators the tests need. */
function prepare(bars) {
  const days = [];
  for (const b of bars) {
    const last = days[days.length - 1];
    if (!last || last.d !== b.d) days.push({ d: b.d, bars: [b] }); else last.bars.push(b);
  }
  const n = days.length, D = days.map(x => {
    const bs = x.bars;
    return { d: x.d, bars: bs, o: bs[0].o, h: Math.max(...bs.map(b => b.h)), l: Math.min(...bs.map(b => b.l)), c: bs[bs.length - 1].c, v: bs.reduce((s, b) => s + b.v, 0),
      orv: bs[0].m === 570 ? bs[0].v : null };
  });
  const tr = D.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - D[i - 1].c), Math.abs(x.l - D[i - 1].c))));
  const atr = new Array(n).fill(NaN), s200 = new Array(n).fill(NaN), avgU = new Array(n).fill(NaN), avgD = new Array(n).fill(NaN);
  for (let i = 13; i < n; i++) { let s = 0; for (let k = i - 13; k <= i; k++) s += tr[k]; atr[i] = s / 14; }
  let run = 0;
  for (let i = 0; i < n; i++) { run += D[i].c; if (i >= 200) run -= D[i - 200].c; if (i >= 199) s200[i] = run / 200; }
  for (let i = 1; i < n; i++) {               // Wilder RSI(14) state, seeded with a simple average
    const ch = D[i].c - D[i - 1].c, u = Math.max(ch, 0), d = Math.max(-ch, 0);
    if (i < 14) { avgU[i] = (i === 1 ? 0 : avgU[i - 1]) + u / 14; avgD[i] = (i === 1 ? 0 : avgD[i - 1]) + d / 14; }
    else { avgU[i] = (avgU[i - 1] * 13 + u) / 14; avgD[i] = (avgD[i - 1] * 13 + d) / 14; }
  }
  return { D, atr, s200, avgU, avgD };
}
const rsiFrom = (u, d) => (d === 0 ? 100 : 100 - 100 / (1 + u / d));

/* ------------------------------------------------------------ test 1: ORB candidates */
function orbCandidates(sym, P, isSp, out) {
  const { D, atr } = P;
  for (let i = 15; i < D.length; i++) {
    const day = D[i];
    if (day.d < CFG.testFrom || !isSp(sym, day.d)) continue;
    const orb = day.bars[0];
    if (orb.m !== 570 || day.bars.length < 3 || orb.c === orb.o) continue;
    let vs = 0, os = 0, on = 0;
    for (let k = i - 14; k < i; k++) { vs += D[k].v; if (D[k].orv !== null) { os += D[k].orv; on++; } }
    const prevC = D[i - 1].c, a = atr[i - 1], avgVol = vs / 14, avgOr = on >= 10 ? os / on : NaN;
    if (!(prevC >= 5 && avgVol >= 1e6 && a >= 0.5 && isNum(avgOr) && avgOr > 0)) continue;
    const relvol = orb.v / avgOr;
    if (relvol < 1) continue;
    const dir = orb.c > orb.o ? 1 : -1, level = dir > 0 ? orb.h : orb.l, closePx = day.c;
    const sim = stopFor => {
      for (let k = 1; k < day.bars.length; k++) {
        const b = day.bars[k];
        if (dir > 0 ? b.h < level : b.l > level) continue;
        const entry = dir > 0 ? Math.max(level, b.o) : Math.min(level, b.o), stop = stopFor(entry);
        const risk = Math.abs(entry - stop);
        if (!(risk > 0)) return null;
        let exit = null;
        if (dir > 0 ? b.l <= stop : b.h >= stop) exit = stop;             // entry bar also touched the stop: count it as stopped
        for (let j = k + 1; exit === null && j < day.bars.length; j++) {
          const x = day.bars[j];
          if (dir > 0 ? x.o <= stop : x.o >= stop) exit = x.o;
          else if (dir > 0 ? x.l <= stop : x.h >= stop) exit = stop;
        }
        if (exit === null) exit = closePx;
        return { pct: dir * (exit / entry - 1) * 100, R: dir * (exit - entry) / risk };
      }
      return null;                                                         // never broke out: no trade
    };
    const rng = sim(() => (dir > 0 ? orb.l : orb.h));
    const atrStop = sim(entry => entry - dir * 0.1 * a);
    const gap = day.o / prevC - 1;
    out.push({ d: day.d, sym, relvol, dir, gap,
      rngPct: rng && rng.pct, rngR: rng && rng.R, atrPct: atrStop && atrStop.pct, atrR: atrStop && atrStop.R,
      goPct: Math.abs(gap) >= 0.04 ? Math.sign(gap) * (closePx / orb.c - 1) * 100 : null });   // gap-and-go from 9:45 to the close
  }
}

/* ------------------------------------------------------------ test 3: Dip / Rip checked at 15:45 */
function dip345(sym, P, isSp, out) {
  const { D, atr, s200, avgU, avgD } = P;
  const plan = (i, long) => {                     // enter at day i's close, 1.5/3 ATR, exit at the close of the 3rd session after
    if (i + 3 >= D.length) return null;
    const E = D[i].c, a = atr[i], s = long ? 1 : -1, tg = E + s * 1.5 * a, sp = E - s * 3 * a;
    for (let j = 1; j <= 3; j++) {
      const x = D[i + j];
      if (long ? x.o >= tg : x.o <= tg) return s * (x.o / E - 1) * 100;
      if (long ? x.o <= sp : x.o >= sp) return s * (x.o / E - 1) * 100;
      if (long ? x.l <= sp : x.h >= sp) return s * (sp / E - 1) * 100;
      if (long ? x.h >= tg : x.l <= tg) return s * (tg / E - 1) * 100;
      if (j === 3) return s * (x.c / E - 1) * 100;
    }
    return null;
  };
  for (let i = 205; i < D.length; i++) {
    const day = D[i];
    if (day.d < CFG.testFrom || !isSp(sym, day.d) || !isNum(s200[i]) || !isNum(atr[i])) continue;
    const upto = day.bars.filter(b => b.m <= 930);
    if (!upto.length || upto[upto.length - 1].m !== 930) continue;                  // need the 15:30-15:45 bar
    let min20 = Infinity; for (let k = i - 20; k < i; k++) min20 = Math.min(min20, D[k].c);
    const check = (c, h, l, s2) => {
      const r5 = c / D[i - 5].c - 1, rng = h - l, clv = rng > 0 ? (c - l) / rng : 0.5;
      const down3 = c < D[i - 1].c && D[i - 1].c < D[i - 2].c && D[i - 2].c < D[i - 3].c;
      const ch = c - D[i - 1].c, u = (avgU[i - 1] * 13 + Math.max(ch, 0)) / 14, dn = (avgD[i - 1] * 13 + Math.max(-ch, 0)) / 14;
      return { dip: c >= 5 && c > s2 && r5 <= -0.10 && (clv <= 0.2 || c < min20 || down3), rip: c >= 5 && c < s2 && r5 >= 0.10 && rsiFrom(u, dn) >= 70 };
    };
    const c45 = upto[upto.length - 1].c, h45 = Math.max(...upto.map(b => b.h)), l45 = Math.min(...upto.map(b => b.l));
    const at = check(c45, h45, l45, s200[i] + (c45 - day.c) / 200), fin = check(day.c, day.h, day.l, s200[i]);
    for (const kind of ['dip', 'rip']) {
      if (!at[kind] && !fin[kind]) continue;
      out.push({ d: day.d, sym, kind, at345: at[kind] ? 1 : 0, final: fin[kind] ? 1 : 0, res: plan(i, kind === 'dip') });
    }
  }
}

/* ------------------------------------------------------------ test 2: SPY intraday momentum */
function spyMomentum(P) {
  const rows = [];
  for (let i = 1; i < P.D.length; i++) {
    const day = P.D[i], bs = day.bars, n = bs.length;
    if (day.d < CFG.testFrom || n < 6) continue;
    const b10 = bs.find(b => b.m === 585), last = bs[n - 1], entry = bs[n - 3], prevHalf = bs[n - 5];
    if (!b10 || last.m - entry.m !== 30) continue;                 // skip days without clean last-30-minute bars
    const r1 = b10.c / P.D[i - 1].c - 1, r12 = entry.c / prevHalf.c - 1, lastHalf = (last.c / entry.c - 1) * 100;
    rows.push({ d: day.d, r1: r1 * 100, r12: r12 * 100, lastHalf,
      mom: Math.sign(r1) * lastHalf, both: Math.sign(r1) === Math.sign(r12) ? Math.sign(r1) * lastHalf : 0 });
  }
  return rows;
}

/* ------------------------------------------------------------ reporting */
const f2 = x => (isNum(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(2)}` : '—');
function perEra(rows, val, filt = () => true) {
  return ERAS.map(([e, lo, hi]) => {
    const r = rows.filter(x => x.d >= lo && x.d <= hi && filt(x)).map(val).filter(isNum);
    return r.length ? `${e}: n=${r.length} avg ${f2(r.reduce((a, b) => a + b, 0) / r.length)}% win ${(r.filter(x => x > 0).length / r.length * 100).toFixed(0)}%` : `${e}: n=0`;
  }).join(' | ');
}
function portfolio(dailyRets) {
  const ds = [...dailyRets.keys()].sort(); let eq = 1, peak = 1, dd = 0; const r = [];
  const yearly = {};
  for (const d of ds) { const x = dailyRets.get(d); eq *= 1 + x; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); r.push(x); const y = d.slice(0, 4); yearly[y] = (yearly[y] || 1) * (1 + x); }
  const yrs = ds.length / 252, mean = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length);
  return { cagr: (eq ** (1 / yrs) - 1) * 100, dd: dd * 100, sharpe: sd > 0 ? mean / sd * Math.sqrt(252) : NaN, yearly: Object.entries(yearly).map(([y, v]) => `${y} ${f2((v - 1) * 100)}%`).join(', ') };
}

function report(orb, spy, dips, meta) {
  const L = []; const say = t => { L.push(t); console.log(t); };
  say('==================== DAY-TRADING RESEARCH ====================');
  say(`Data: 15-minute bars from ${CFG.testFrom}; point-in-time S&P 500 members plus SPY. ${meta}`);
  // ORB: top N by relative volume each day
  const byDay = new Map();
  for (const x of orb) { if (!byDay.has(x.d)) byDay.set(x.d, []); byDay.get(x.d).push(x); }
  const top = [];
  for (const [, list] of byDay) top.push(...list.sort((a, b) => b.relvol - a.relvol).slice(0, CFG.topN));
  say(`\n1) OPENING-RANGE BREAKOUT, top ${CFG.topN} "stocks in play" a day (15-minute opening range; exit at the close)`);
  for (const [lab, key] of [['stop at the other side of the range', 'rng'], ['stop 10% of daily ATR from entry', 'atr']]) {
    say(`  ${lab}:`);
    say(`    % per trade   ${perEra(top, x => x[key + 'Pct'])}`);
    say(`    R per trade   ${perEra(top, x => x[key + 'R'])}`);
    for (const cost of CFG.costs) {
      const daily = new Map();
      for (const [d, list] of byDay) {
        const t = list.sort((a, b) => b.relvol - a.relvol).slice(0, CFG.topN).filter(x => isNum(x[key + 'Pct']));
        daily.set(d, t.reduce((s, x) => s + (x[key + 'Pct'] - cost) / 100, 0) / CFG.topN);   // equal slices, untriggered slots sit in cash
      }
      const p = portfolio(daily);
      say(`    portfolio, cost ${cost.toFixed(2)}% round trip: CAGR ${f2(p.cagr)}% | worst drop ${f2(p.dd)}% | Sharpe ${f2(p.sharpe)}${cost === 0.05 ? `\n      by year: ${p.yearly}` : ''}`);
    }
  }
  say(`  gap-and-go (in play, gap >= 4%, from 9:45 to the close): ${perEra(top, x => x.goPct, x => isNum(x.goPct))}`);
  say(`\n2) SPY INTRADAY MOMENTUM (last 30 minutes, in the direction of yesterday's close -> 10:00)`);
  say(`  always long the last 30 min: ${perEra(spy, x => x.lastHalf)}`);
  say(`  momentum rule:               ${perEra(spy, x => x.mom)}`);
  say(`  only when 15:00-15:30 agrees: ${perEra(spy, x => x.both, x => x.both !== 0)}`);
  for (const cost of [0, 0.01, 0.02]) {
    const daily = new Map(spy.map(x => [x.d, (x.mom - (x.mom !== 0 ? cost : 0)) / 100])); const p = portfolio(daily);
    say(`  portfolio, momentum rule, cost ${cost.toFixed(2)}%: CAGR ${f2(p.cagr)}% | worst drop ${f2(p.dd)}% | Sharpe ${f2(p.sharpe)}${cost === 0.01 ? `\n    by year: ${p.yearly}` : ''}`);
  }
  say(`\n3) OVERNIGHT DIP / RIP: signal checked at 15:45, bought (shorted) at the close, 1.5/3 ATR, exit at the 3rd close`);
  for (const kind of ['dip', 'rip']) {
    const r = dips.filter(x => x.kind === kind), both = r.filter(x => x.at345 && x.final), only345 = r.filter(x => x.at345 && !x.final), onlyFin = r.filter(x => !x.at345 && x.final);
    const fin = r.filter(x => x.final).length;
    say(`  ${kind === 'dip' ? 'Uptrend Dip' : 'Downtrend Rip'}: final-close signals ${fin}; already showing at 15:45: ${both.length} (${(both.length / Math.max(fin, 1) * 100).toFixed(0)}%); false alarms at 15:45: ${only345.length}; missed by 15:45: ${onlyFin.length}`);
    say(`    trade every 15:45 signal: ${perEra(r.filter(x => x.at345), x => x.res)}`);
    say(`    trade final-close signals (ideal, can't be done): ${perEra(r.filter(x => x.final), x => x.res)}`);
  }
  return L.join('\n');
}

function writeCsv(file, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  fs.writeFileSync(file, [cols.join(',')].concat(rows.map(r => cols.map(k => (isNum(r[k]) ? Math.round(r[k] * 1e4) / 1e4 : r[k] ?? '')).join(','))).join('\n'));
}

async function main() {
  if (!CFG.keyId || !CFG.secret) throw new Error('ALPACA_KEY_ID / ALPACA_SECRET_KEY are not set.');
  const t0 = Date.now();
  const hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'sp500_history.json'), 'utf8')).members;
  const isSp = (sym, d) => (hist[sym] || []).some(([a, b]) => d >= a && (b === null || d < b));
  let symbols = Object.keys(hist).filter(s => /^[A-Z.]{1,6}$/.test(s) && hist[s].some(([, b]) => b === null || b >= CFG.testFrom)).sort();
  if (CFG.maxSymbols) symbols = symbols.slice(0, CFG.maxSymbols);
  log(`Symbols to download: ${symbols.length} (S&P 500 members at any point since ${CFG.testFrom}) + SPY`);
  const spyBars = (await fetchBars(['SPY'])).get('SPY');
  const spy = spyMomentum(prepare(spyBars));
  log(`SPY: ${spyBars.length} bars, ${spy.length} tradable days`);
  const orb = [], dips = []; let withData = 0;
  for (let b = 0; b < symbols.length; b += CFG.batch) {
    const chunk = symbols.slice(b, b + CFG.batch);
    let bars;
    try { bars = await fetchBars(chunk); } catch (e) { log(`  batch skipped: ${e.message}`); continue; }
    for (const [sym, list] of bars) {
      if (list.length < 3000) continue;
      withData++;
      const P = prepare(list);
      orbCandidates(sym, P, isSp, orb);
      dip345(sym, P, isSp, dips);
    }
    if ((b / CFG.batch) % 10 === 0) log(`  ${Math.min(b + CFG.batch, symbols.length)}/${symbols.length} symbols, ${requests} requests, ${orb.length} ORB candidates`);
  }
  const meta = `Stocks with data: ${withData} of ${symbols.length}. ${requests} requests, ${((Date.now() - t0) / 60000).toFixed(0)} min.`;
  log(meta);
  fs.mkdirSync(CFG.outDir, { recursive: true });
  const byDay = new Map(); for (const x of orb) { if (!byDay.has(x.d)) byDay.set(x.d, []); byDay.get(x.d).push(x); }
  const topRows = [...byDay.values()].flatMap(list => list.sort((a, b) => b.relvol - a.relvol).slice(0, CFG.topN));
  writeCsv(path.join(CFG.outDir, 'orb_top.csv'), topRows);   // only the stocks actually traded (top N a day), to keep the file small
  writeCsv(path.join(CFG.outDir, 'spy_momentum.csv'), spy);
  writeCsv(path.join(CFG.outDir, 'dip_345.csv'), dips);
  const summary = report(orb, spy, dips, meta);
  fs.writeFileSync(path.join(CFG.outDir, 'summary.txt'), summary);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, '```\n' + summary + '\n```\n');
}

if (require.main === module) main().catch(e => { console.error(`Research error: ${e.message}`); process.exitCode = 1; });
module.exports = { toET, prepare, orbCandidates, dip345, spyMomentum, portfolio, report, main, CFG };
