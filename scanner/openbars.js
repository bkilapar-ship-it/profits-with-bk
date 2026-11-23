'use strict';
/*
 * Opening-minutes record for the day's setups. READ-ONLY: it only reads market data (and the saved paper-trading state);
 * it never places, changes or cancels an order and never touches any trading setting.
 *
 * Why: Alpaca's PAPER fills are simulated, and a busy open can mean an order fills late, at another price, or not at all.
 * This job keeps the real one-minute candles for every setup from the open to a few minutes after it, so we can see what
 * a 3-5 minute entry would really have looked like, whether the 2% cap was already broken, and compare that with the
 * price Alpaca actually filled at.
 *
 * Runs once per trading day after the first 15 minutes of trading. Output: <OUT_DIR>/<date>.json and <OUT_DIR>/index.json.
 *
 * Env: ALPACA_KEY_ID, ALPACA_SECRET_KEY, PAPER_SETUPS_URL (live setups.json), OUT_DIR (default open-bars),
 *      PAPER_STATE_DIR (optional, paper-state checkout, to attach Alpaca's actual fill), FORCE=true to overwrite, DATE=YYYY-MM-DD (testing)
 */
const fs = require('fs');
const path = require('path');
const env = process.env;
const CFG = {
  keyId: env.ALPACA_KEY_ID, secret: env.ALPACA_SECRET_KEY,
  dataBase: (env.ALPACA_DATA_BASE || 'https://data.alpaca.markets').replace(/\/+$/, ''),
  feed: (env.OPEN_BARS_FEED || 'iex').toLowerCase(),
  setupsUrl: env.PAPER_SETUPS_URL || '', out: env.OUT_DIR || 'open-bars', stateDir: env.PAPER_STATE_DIR || '',
  cap: Number(env.PAPER_CHASE || 0.02), force: /^(1|true|yes)$/i.test(env.FORCE || ''),
  windowMin: Number(env.OPEN_BARS_MINUTES || 15), orderMin: Number(env.OPEN_BARS_ORDER_MIN || 5),   // candles kept: 9:30 to 9:45; the paper order goes in about 5 minutes after the open
};
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const r2 = x => (isNum(x) ? Math.round(x * 100) / 100 : null);
const log = m => console.log(m);

const etParts = d => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map(p => [p.type, p.value]));
const todayEastern = () => { const p = etParts(new Date()); return `${p.year}-${p.month}-${p.day}`; };
const etMinutesNow = () => { const p = etParts(new Date()); return Number(p.hour) * 60 + Number(p.minute); };
/** UTC ISO time for a clock time (US Eastern) on a date: tries both offsets and keeps the one that reads back correctly. */
function etToIso(date, h, m) {
  for (const off of [4, 5]) {
    const d = new Date(`${date}T${String(h + off).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`), p = etParts(d);
    if (`${p.year}-${p.month}-${p.day}` === date && Number(p.hour) === h && Number(p.minute) === m) return d.toISOString();
  }
  return new Date(`${date}T${String(h + 5).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`).toISOString();
}

async function getJson(url, attempt = 0) {
  let res;
  try { res = await fetch(url, { headers: { 'APCA-API-KEY-ID': CFG.keyId, 'APCA-API-SECRET-KEY': CFG.secret, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) }); }
  catch (e) { if (attempt < 3) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); return getJson(url, attempt + 1); } throw e; }
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); return getJson(url, attempt + 1); }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url.split('?')[0]}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

async function fetchMinuteBars(symbols, startIso, endIso) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100);
    let token = null;
    do {
      const q = new URLSearchParams({ symbols: chunk.join(','), timeframe: '1Min', start: startIso, end: endIso, feed: CFG.feed, limit: '10000', adjustment: 'raw' });
      if (token) q.set('page_token', token);
      const j = await getJson(`${CFG.dataBase}/v2/stocks/bars?${q}`);
      for (const [s, arr] of Object.entries(j.bars || {})) (out[s] = out[s] || []).push(...arr);
      token = j.next_page_token || null;
    } while (token);
  }
  return out;
}

/** What a limit order placed `orderMin` minutes after the open (capped CAP past the signal close) would have done, from the candles alone. */
function shadow(side, signalClose, bars, openIso, orderMin) {
  const long = side === 'long', cap = r2(signalClose * (long ? 1 + CFG.cap : 1 - CFG.cap));
  const t0 = Date.parse(openIso), minute = b => Math.round((Date.parse(b.t) - t0) / 60000);
  const o = bars[0] ? bars[0].o : null, past = isNum(o) ? (long ? o > cap : o < cap) : null;
  const at = n => { const b = bars.find(x => minute(x) === n); return b ? r2(b.o) : null; };
  let fill = null, fillMinute = null;
  for (const b of bars) {   // from the minute the order would be live: first candle that trades at or inside the cap
    if (minute(b) < orderMin) continue;
    const inside = long ? b.l <= cap : b.h >= cap;
    if (inside) { fill = r2(long ? Math.min(b.o, cap) : Math.max(b.o, cap)); fillMinute = minute(b); break; }
  }
  return { cap, open: r2(o), openedPastCap: past, priceAt3: at(3), priceAt4: at(4), priceAt5: at(5), simulatedFill: fill, simulatedFillMinuteAfterOpen: fillMinute,
    simulatedVsSignalClosePct: isNum(fill) && signalClose ? r2((fill / signalClose - 1) * 100) : null };
}

function alpacaFills(date) {   // what the paper account actually did, from the saved paper-trading state
  const m = {};
  if (!CFG.stateDir) return m;
  try {
    const st = JSON.parse(fs.readFileSync(path.join(CFG.stateDir, 'state.json'), 'utf8'));
    for (const [t, p] of Object.entries(st.positions || {})) if (p.entryDate === date) m[t] = { filledAt: date, price: p.entry, shares: p.shares, status: 'open position' };
    for (const x of st.trades || []) if (x.entryDate === date && !m[x.ticker]) m[x.ticker] = { filledAt: date, price: x.entry, shares: x.shares, status: 'closed trade' };
    for (const [t, p] of Object.entries(st.pendingEntries || {})) if (!m[t]) m[t] = { price: null, status: 'order still waiting', limit: p.limit };
  } catch (e) { log(`  (no paper-trading state to compare with: ${String(e.message).slice(0, 80)})`); }
  return m;
}

async function main() {
  if (!CFG.keyId || !CFG.secret) throw new Error('Alpaca keys are not set.');
  if (!CFG.setupsUrl) throw new Error('PAPER_SETUPS_URL is not set.');
  const today = env.DATE || todayEastern();
  if (!env.DATE && etMinutesNow() < 9 * 60 + 30 + CFG.windowMin + 1) { log(`Too early (Eastern ${Math.floor(etMinutesNow() / 60)}:${String(etMinutesNow() % 60).padStart(2, '0')}): the first ${CFG.windowMin} minutes of trading are not finished. Nothing recorded.`); return; }
  fs.mkdirSync(CFG.out, { recursive: true });
  const file = path.join(CFG.out, `${today}.json`);
  if (fs.existsSync(file) && !CFG.force) { log(`${today} is already recorded. Nothing to do.`); return; }
  const res = await fetch(CFG.setupsUrl, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Could not fetch the setups: HTTP ${res.status}`);
  const setups = await res.json();
  if (setups.nextSession !== today) { log(`The latest setups (as of ${setups.asOf}) are for ${setups.nextSession}, not today (${today}). Nothing to record.`); return; }
  const cands = [...(setups.dip || []).map(x => ({ ...x, kind: 'dip', side: 'long' })), ...(setups.rip || []).map(x => ({ ...x, kind: 'rip', side: 'short' }))].filter(x => x.sessionsAgo === 0 && isNum(x.close));
  log(`Setups as of ${setups.asOf}: ${cands.length} for today's open.`);
  const startIso = etToIso(today, 9, 30), endIso = etToIso(today, 9, 30 + CFG.windowMin);
  const bars = cands.length ? await fetchMinuteBars([...new Set(cands.map(x => x.ticker))], startIso, endIso) : {};
  const fills = alpacaFills(today);
  const rows = cands.map(c => {
    const b = (bars[c.ticker] || []).filter(x => Date.parse(x.t) >= Date.parse(startIso) && Date.parse(x.t) < Date.parse(endIso)).sort((a, z) => Date.parse(a.t) - Date.parse(z.t));
    const s = b.length ? shadow(c.side, c.close, b, startIso, CFG.orderMin) : null, a = fills[c.ticker] || null;
    return { ticker: c.ticker, strategy: c.kind, side: c.side, sp500: !!c.sp500, signalClose: r2(c.close), minuteCandles: b.length,
      ...(s || { note: 'no candles returned for this ticker (the free IEX feed skips thinly traded minutes)' }),
      alpaca: a, alpacaVsSimulatedPct: a && isNum(a.price) && s && isNum(s.simulatedFill) ? r2((a.price / s.simulatedFill - 1) * 100) : null,
      bars: b.map(x => ({ t: x.t, o: r2(x.o), h: r2(x.h), l: r2(x.l), c: r2(x.c), v: x.v })) };
  });
  const doc = { version: 1, date: today, setupsAsOf: setups.asOf, feed: CFG.feed, windowMinutes: CFG.windowMin, orderMinutesAfterOpen: CFG.orderMin, capPct: CFG.cap * 100,
    note: 'Candles come from the free IEX feed, so thin minutes can be missing. "simulated" = what a capped limit order placed at the stated minute would have done on these candles. Alpaca paper fills are simulated by Alpaca.', setups: rows };
  fs.writeFileSync(file, JSON.stringify(doc));
  const idxFile = path.join(CFG.out, 'index.json');
  let idx = []; try { idx = JSON.parse(fs.readFileSync(idxFile, 'utf8')); } catch (e) { /* first run */ }
  idx = idx.filter(x => x.date !== today).concat([{ date: today, setups: rows.length, withCandles: rows.filter(r => r.minuteCandles > 0).length, openedPastCap: rows.filter(r => r.openedPastCap).length,
    noSimulatedFill: rows.filter(r => r.minuteCandles > 0 && !isNum(r.simulatedFill)).length }]).sort((a, z) => a.date.localeCompare(z.date));
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 1));
  log(`Recorded ${rows.length} setups for ${today}: ${rows.filter(r => r.minuteCandles > 0).length} with candles, ${rows.filter(r => r.openedPastCap).length} opened past the cap.`);
}

if (require.main === module) main().catch(e => { console.error('::error::' + e.message); process.exit(1); });
module.exports = { shadow, etToIso };
