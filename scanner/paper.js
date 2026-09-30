#!/usr/bin/env node
/*
 * Trade With BK — automated paper trading
 *
 * Runs in GitHub Actions (Node 22+, built-in fetch, no npm dependencies).
 * Trades the Uptrend Dip (long) and Downtrend Rip (short) setups on a real
 * Alpaca PAPER account, using simulated money only. It never runs against a
 * live brokerage account: the base URL always points at paper-api.alpaca.markets
 * unless explicitly overridden.
 *
 * Capital structure: 10% of the account is held in permanent reserve, never
 * spent. Each trade (Dip and Rip share one pool) is sized at 15% of the
 * *sleeve's* current value (the other 90%) -- not a fixed dollar amount, so
 * winnings compound. There is no cap on how many positions can be open, or
 * how many new trades happen in a day: the only limit is whether the sleeve
 * still has spendable cash left once the reserve is set aside.
 *
 * Order mechanics (see README section "Paper trading" for the reasoning):
 *   Entry — a plain LIMIT day order, capped at 2% past the signal close
 *           (above it for a long, below it for a short). It cancels itself
 *           if the market never reaches that price by the close, so a
 *           gapped-away open is skipped rather than chased. Tested against
 *           no cap across 2000-2026: helps Dip, costs Rip a little, kept on
 *           both for one simple rule.
 *   Exit  — once an entry fills, a separate OCO order (time_in_force "gtc") is
 *           attached: a take-profit limit and a stop order. Using a GTC OCO,
 *           rather than folding the stop into the entry as a "bracket" order,
 *           avoids any ambiguity about whether a "day" bracket could let the
 *           protective stop itself expire at the end of the entry day.
 *   Time exit — a position that reaches its held-for-N-sessions limit has its
 *           OCO cancelled and is flattened with Alpaca's position-close
 *           endpoint (a market order), regardless of price.
 *
 * Ranking (when several signals compete for the sleeve's spendable cash on
 * one day): Dip and Rip candidates carry a "priority" tier computed once in
 * app.js (bearish engulfing first for Dip, RSI(5) >= 90 first for Rip; green
 * closes and 10-day-low sweeps last for Dip) and serialized into setups.json,
 * so the app's own display order and this script's fill order always agree.
 * Each placed trade is tagged with which tier it came from, so live results
 * can be checked against the research that motivated the rule.
 *
 * State (open positions, pending orders, trade history, pause/resume) is kept
 * in state.json on the orphan "paper-state" branch of this repository, read
 * and written by this script, committed by the calling workflow. This script
 * never touches git itself.
 *
 * Modes (env MODE, or --mode):
 *   entry     — reconcile, then place today's new entries (once per day)
 *   exit      — reconcile, then flatten positions due for their time exit
 *   reconcile — just reconcile fills/closures and refresh state (no new orders)
 *   render    — read-only: turn state.json into the public data/paper.json
 *               (called as a function from scan.js, not from the command line)
 *
 * Pause/resume (env ACTION, or --action): "pause" or "resume" flips
 * state.status; it always runs before whatever MODE does.
 *
 * Usage: MODE=entry ACTION=none ALPACA_KEY_ID=... ALPACA_SECRET_KEY=... \
 *        node scanner/paper.js --state-dir paper-state
 *
 * Not financial advice. Paper trading only: this script refuses to run
 * against any base URL that doesn't contain "paper-api" unless
 * ALPACA_I_UNDERSTAND_THIS_IS_LIVE=true is explicitly set.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../app.js');
const notify = require('./notify.js');

/* ------------------------------------------------------------------ config */
const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const CFG = {
  keyId: env.ALPACA_KEY_ID || '',
  secret: env.ALPACA_SECRET_KEY || '',
  tradingBase: (env.ALPACA_TRADING_BASE || 'https://paper-api.alpaca.markets').replace(/\/+$/, ''),
  dataBase: (env.ALPACA_DATA_BASE || 'https://data.alpaca.markets').replace(/\/+$/, ''),
  feed: (env.ALPACA_FEED || 'sip').toLowerCase(),

  reservePct: num(env.PAPER_RESERVE_PCT, 0.10),     // held back, never spent
  sizePct: num(env.PAPER_SIZE_PCT, 0.15),           // per trade, as a share of the sleeve's current value
  chase: num(env.PAPER_CHASE, core.SETUP.CHASE),    // entry price cap: skip if the market has already moved further than this
  targetAtr: num(env.PAPER_TARGET_ATR, 1.5),
  stopAtr: num(env.PAPER_STOP_ATR, 3),
  holdSessions: num(env.PAPER_HOLD_SESSIONS, core.SETUP.HOLD),
  tradeDip: bool(env.PAPER_TRADE_DIP, true),
  tradeRip: bool(env.PAPER_TRADE_RIP, true),
  sp500Only: bool(env.PAPER_SP500_ONLY, true),
  reviewAfter: num(env.PAPER_REVIEW_AFTER, 100),
  successAvgPct: num(env.PAPER_SUCCESS_AVG_PCT, 0.3),
  startCapital: num(env.PAPER_START_CAPITAL, 100000),
  defaultStatus: (env.PAPER_DEFAULT_STATUS || 'paused').toLowerCase(),   // first run only

  setupsUrl: env.PAPER_SETUPS_URL || '',   // required for entry mode; the live setups.json
  stateDir: argValue('--state-dir', env.PAPER_STATE_DIR || 'paper-state'),
  outDir: argValue('--out', env.PAPER_OUT_DIR || 'data'),

  mode: (env.MODE || argValue('--mode', 'reconcile')).toLowerCase(),
  action: (env.ACTION || argValue('--action', 'none')).toLowerCase(),
  force: bool(env.FORCE, false),   // bypass the once-per-day guard, for manual testing

  rpm: num(env.ALPACA_RPM, 150),
  cancelTries: num(env.PAPER_CANCEL_TRIES, 12),     // how long to wait for Alpaca to finish cancelling the stop/target orders
  cancelDelayMs: num(env.PAPER_CANCEL_DELAY_MS, 1500),
  closeTries: num(env.PAPER_CLOSE_TRIES, 6),        // retries if Alpaca still says the shares are held by an order
  pollTries: num(env.PAPER_POLL_TRIES, 8),
  pollDelayMs: num(env.PAPER_POLL_DELAY_MS, 20000),
};

const RULES = () => ({
  reservePct: CFG.reservePct, sizePct: CFG.sizePct, chase: CFG.chase,
  targetAtr: CFG.targetAtr, stopAtr: CFG.stopAtr, holdSessions: CFG.holdSessions,
  minLiquidity: core.SETUP.MIN_LIQUIDITY,
  strategies: { dip: CFG.tradeDip, rip: CFG.tradeRip, macd: false },
  sp500Only: CFG.sp500Only,
  ranking: 'Bearish engulfing first for Dip / RSI(5) ≥ 90 first for Rip, then the usual strength measure',
  reviewAfter: CFG.reviewAfter, successAvgPct: CFG.successAvgPct,
});

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const r2 = x => (isNum(x) ? Math.round(x * 100) / 100 : null);

/* Guards against ever accidentally pointing this at a live trading account. */
function assertPaperOnly() {
  const live = env.ALPACA_I_UNDERSTAND_THIS_IS_LIVE === 'true';
  if (!CFG.tradingBase.includes('paper-api') && !live) {
    throw new Error(`ALPACA_TRADING_BASE ("${CFG.tradingBase}") doesn't look like a paper account. ` +
      `Refusing to place orders. Set ALPACA_I_UNDERSTAND_THIS_IS_LIVE=true to override (not recommended).`);
  }
}

/* ------------------------------------------------------------------- HTTP */
const limiter = {
  stamps: [],
  async acquire() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter(t => now - t < 60000);
      if (this.stamps.length < CFG.rpm) { this.stamps.push(now); return; }
      await sleep(60000 - (now - this.stamps[0]) + 50);
    }
  },
};

/** One call to the Alpaca Trading API. Retries on 429/5xx; throws a clear error otherwise. */
async function alpaca(method, urlPath, body, attempt = 0) {
  await limiter.acquire();
  const url = urlPath.startsWith('http') ? urlPath : `${CFG.tradingBase}${urlPath}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'APCA-API-KEY-ID': CFG.keyId, 'APCA-API-SECRET-KEY': CFG.secret,
        Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    if (attempt < 4) { await sleep(1500 * 2 ** attempt); return alpaca(method, urlPath, body, attempt + 1); }
    throw new Error(`Network error calling Alpaca (${method} ${urlPath}): ${e.message}`);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(Math.min(2000 * 2 ** attempt, 30000));
    return alpaca(method, urlPath, body, attempt + 1);
  }
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = (json && json.message) || text || `HTTP ${res.status}`;
    const err = new Error(`Alpaca ${method} ${urlPath} failed: ${res.status} ${msg}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return json;
}

const getClock = () => alpaca('GET', '/v2/clock');
const getAccount = () => alpaca('GET', '/v2/account');
const getPositions = () => alpaca('GET', '/v2/positions');
const getOpenOrders = () => alpaca('GET', '/v2/orders?status=open&limit=200&nested=true');
const getOrder = id => alpaca('GET', `/v2/orders/${id}?nested=true`);
const cancelOrder = id => alpaca('DELETE', `/v2/orders/${id}`).catch(e => {
  if (e.status === 404 || e.status === 422) return null;   // already filled/cancelled: fine
  throw e;
});
const closePositionMarket = symbol => alpaca('DELETE', `/v2/positions/${symbol}`);

const TERMINAL = new Set(['canceled', 'filled', 'expired', 'rejected', 'replaced', 'done_for_day']);
/** Alpaca cancels asynchronously: the order goes "pending_cancel" first, and until it is truly
 *  cancelled its shares are still "held", so closing the position is refused ("available: 0").
 *  Cancel, then wait until the order and both its legs are really done. */
async function cancelAndWait(orderId, label) {
  await cancelOrder(orderId).catch(e => log(`  ${label}: could not cancel its OCO (${e.message})`));
  for (let i = 0; i < CFG.cancelTries; i++) {
    const o = await getOrder(orderId).catch(() => null);
    if (!o || (TERMINAL.has(o.status) && (o.legs || []).every(l => TERMINAL.has(l.status)))) return true;
    await sleep(CFG.cancelDelayMs);
  }
  log(`  ${label}: its stop/target order is still not cancelled after waiting; will try to close anyway.`);
  return false;
}
/** Close at market, retrying while Alpaca still reports the shares as held by an order. */
async function closeWithRetry(symbol) {
  let last;
  for (let i = 0; i < CFG.closeTries; i++) {
    try { return await closePositionMarket(symbol); }
    catch (e) {
      last = e;
      if (!/insufficient qty|held_for_orders|403/i.test(e.message)) throw e;   // a different problem: don't keep hammering
      await sleep(CFG.cancelDelayMs);
    }
  }
  throw last;
}
/** Put a take-profit / stop pair back on a position, using the levels recorded at entry. */
async function reprotect(ticker, p) {
  const long = p.side === 'long';
  const oco = await alpaca('POST', '/v2/orders', {
    symbol: ticker, qty: String(p.shares), side: long ? 'sell' : 'buy', type: 'limit', time_in_force: 'gtc',
    order_class: 'oco', take_profit: { limit_price: String(p.target) }, stop_loss: { stop_price: String(p.stop) },
  });
  return oco.id;
}

async function getAsset(symbol) {
  try { return await alpaca('GET', `/v2/assets/${symbol}`); } catch { return null; }
}

/** Latest completed daily close for one symbol, via the market-data API (same keys as trading). */
async function getLatestDailyClose(symbol) {
  const q = new URLSearchParams({ symbols: symbol, timeframe: '1Day', limit: '1', adjustment: 'split', feed: CFG.feed, sort: 'desc' });
  const json = await alpaca('GET', `${CFG.dataBase}/v2/stocks/bars?${q.toString()}`);
  const bars = json && json.bars && json.bars[symbol];
  return bars && bars.length ? Number(bars[0].c) : null;
}

async function getRecentClosedOrders(symbol, afterIso, limit = 10) {
  const q = new URLSearchParams({ status: 'closed', symbols: symbol, direction: 'desc', limit: String(limit), nested: 'true' });
  if (afterIso) q.set('after', afterIso);
  return alpaca('GET', `/v2/orders?${q.toString()}`);
}

/* ------------------------------------------------------------------- state */
function statePath() { return path.join(CFG.stateDir, 'state.json'); }

function defaultState() {
  return {
    version: 1,
    status: CFG.defaultStatus === 'running' ? 'running' : 'paused',
    startedAt: null,                 // set the first time status becomes "running"
    lastEntryRunDate: null,
    lastExitRunDate: null,
    spyBaseline: null,               // SPY's close on the first day of trading, for the benchmark line
    positions: {},                   // ticker -> { strategy, side, signalDate, signalClose, entryDate, entryOrderId, entry, shares, target, stop, ocoOrderId }
    pendingEntries: {},              // ticker -> { orderId, strategy, side, limit, shares, signalDate, signalClose, atr, placedAt }
    pendingCloses: {},                // ticker -> { reason: 'time' } — set right before an intentional time-exit close
    trades: [],                      // closed trades, newest last
    equity: [],                      // { d, value, pct, spy }
    lastOrders: { forDate: null, entries: [], skipped: [] },
    lastExits: { forDate: null, exits: [] },
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object' || !s.positions) throw new Error('malformed');
    return { ...defaultState(), ...s };
  } catch {
    log('No existing state found (or unreadable); starting fresh.');
    return defaultState();
  }
}

function saveState(state) {
  fs.mkdirSync(CFG.stateDir, { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 1));
}

/* --------------------------------------------------------------- calendar */
function todayEastern() {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/* ------------------------------------------------------------- reconcile */
/**
 * Compares our tracked open positions against Alpaca's actual positions.
 * Anything we thought was open but Alpaca no longer shows has closed since
 * the last run — find how (time exit we initiated, target, stop, or a manual
 * change on the dashboard) and record it as a finished trade.
 */
async function reconcileClosedPositions(state, livePositions) {
  const liveSymbols = new Set(livePositions.map(p => p.symbol));
  for (const ticker of Object.keys(state.positions)) {
    if (liveSymbols.has(ticker)) continue;
    const pos = state.positions[ticker];
    let how = 'manual', exit = pos.now ?? pos.entry, exitAt = new Date().toISOString(), shares = pos.shares;

    if (state.pendingCloses[ticker]) {
      how = state.pendingCloses[ticker].reason || 'time';
      const closed = await getRecentClosedOrders(ticker, pos.entryDate).catch(() => []);
      const fill = (closed || []).find(o => o.filled_avg_price && (o.side === (pos.side === 'long' ? 'sell' : 'buy')));
      if (fill) { exit = Number(fill.filled_avg_price); exitAt = fill.filled_at || exitAt; shares = Number(fill.filled_qty) || shares; }
    } else if (pos.ocoOrderId) {
      try {
        const oco = await getOrder(pos.ocoOrderId);
        const legs = oco.legs && oco.legs.length ? oco.legs : (oco.status === 'filled' ? [oco] : []);
        const filledLeg = legs.find(l => l.status === 'filled') || (oco.status === 'filled' ? oco : null);
        if (filledLeg) {
          exit = Number(filledLeg.filled_avg_price ?? filledLeg.limit_price ?? filledLeg.stop_price ?? exit);
          exitAt = filledLeg.filled_at || exitAt;
          shares = Number(filledLeg.filled_qty) || shares;
          const legLimit = filledLeg.limit_price !== undefined && filledLeg.limit_price !== null ? Number(filledLeg.limit_price) : NaN;
          const isTarget = isNum(legLimit) && Math.abs(legLimit - pos.target) < Math.abs(legLimit - pos.stop);
          how = isTarget ? 'target' : 'stop';
        }
      } catch (e) { log(`  ${ticker}: could not read its exit order (${e.message}); recording as manual.`); }
    }

    const long = pos.side === 'long';
    const usd = (long ? exit - pos.entry : pos.entry - exit) * shares;
    const pct = (long ? exit / pos.entry - 1 : 1 - exit / pos.entry) * 100;
    state.trades.push({
      ticker, strategy: pos.strategy, side: pos.side, tag: pos.tag, signalDate: pos.signalDate, signalClose: pos.signalClose,
      entryDate: pos.entryDate, exitDate: exitAt.slice(0, 10), entry: r2(pos.entry), exit: r2(exit), shares,
      how, usd: r2(usd), pct: r2(pct),
    });
    log(`  ${ticker}: closed (${how}), ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
    delete state.positions[ticker];
    delete state.pendingCloses[ticker];
  }
}

/** Checks each pending entry order: filled -> open a position and attach its OCO exit; expired/cancelled -> log a skip. */
async function reconcilePendingEntries(state) {
  for (const ticker of Object.keys(state.pendingEntries)) {
    const p = state.pendingEntries[ticker];
    let order;
    try { order = await getOrder(p.orderId); } catch (e) { log(`  ${ticker}: could not check its order (${e.message}).`); continue; }
    if (order.status === 'filled') {
      const entry = Number(order.filled_avg_price);
      const shares = Number(order.filled_qty);
      const long = p.side === 'long';
      const target = r2(long ? entry + CFG.targetAtr * p.atr : entry - CFG.targetAtr * p.atr);
      const stop = r2(long ? entry - CFG.stopAtr * p.atr : entry + CFG.stopAtr * p.atr);
      let ocoId = null;
      try {
        const oco = await alpaca('POST', '/v2/orders', {
          symbol: ticker, qty: String(shares), side: long ? 'sell' : 'buy', type: 'limit', time_in_force: 'gtc',
          order_class: 'oco', take_profit: { limit_price: String(target) }, stop_loss: { stop_price: String(stop) },
        });
        ocoId = oco.id;
      } catch (e) {
        log(`  ${ticker}: FILLED at ${entry} but the protective OCO order failed (${e.message}). ` +
          `This position has NO automatic stop — check the Alpaca dashboard.`);
      }
      state.positions[ticker] = { strategy: p.strategy, side: p.side, tag: p.tag, signalDate: p.signalDate, signalClose: p.signalClose,
        entryDate: order.filled_at ? order.filled_at.slice(0, 10) : todayEastern(), entry: r2(entry), shares, target, stop, ocoOrderId: ocoId };
      log(`  ${ticker}: entry filled at ${entry} (${shares} shares), OCO target ${target} / stop ${stop}${ocoId ? '' : ' — OCO FAILED'}`);
      delete state.pendingEntries[ticker];
    } else if (['canceled', 'expired', 'rejected'].includes(order.status)) {
      log(`  ${ticker}: entry did not fill (${order.status}) — skipped.`);
      delete state.pendingEntries[ticker];
    } // else still open/pending_new: leave it, check again next run
  }
}

async function reconcile(state) {
  const [livePositions] = await Promise.all([getPositions()]);
  await reconcileClosedPositions(state, livePositions);
  await reconcilePendingEntries(state);
  // absorb the broker's own view of price/shares for anything still open
  const byTicker = Object.fromEntries(livePositions.map(p => [p.symbol, p]));
  for (const [ticker, pos] of Object.entries(state.positions)) {
    const live = byTicker[ticker];
    if (live) pos.now = r2(Number(live.current_price || live.lastday_price || pos.entry));
  }
}

/* ----------------------------------------------------------------- entry */
async function fetchSetups() {
  if (!CFG.setupsUrl) throw new Error('PAPER_SETUPS_URL is not set: entry mode needs the live setups.json URL.');
  const res = await fetch(CFG.setupsUrl, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Could not fetch ${CFG.setupsUrl}: HTTP ${res.status}`);
  const j = await res.json();
  if (!j || !Array.isArray(j.dip) || !Array.isArray(j.rip)) throw new Error('setups.json looks malformed');
  return j;
}

/** Tags WHY a candidate ranked where it did, so live results can be checked against the research
 *  that motivated the rule (paper trading data is filterable/inspectable by this tag). */
function candidateTag(kind, c) {
  if (kind === 'dip') return c.bearEngulf ? 'bearEngulf' : (c.green || c.sweep10) ? 'green_or_sweep' : 'normal';
  return (isNum(c.rsi5) && c.rsi5 >= 90) ? 'rsi5_90' : 'normal';
}

/** Same priority-tiered ranking as the app's own default sort (see app.js's setupPriority):
 *  bearish engulfing first for Dip, RSI(5) >= 90 first for Rip; each tier then by the usual
 *  strength measure. The "priority" field is computed once in app.js and carried through
 *  setups.json, so both places always agree on the order. */
function rankCandidates(setups, state) {
  const held = new Set([...Object.keys(state.positions), ...Object.keys(state.pendingEntries)]);
  const pick = (kind, enabled) => {
    if (!enabled) return [];
    return (setups[kind] || [])
      .filter(x => x.sessionsAgo === 0 && !held.has(x.ticker) && (!CFG.sp500Only || x.sp500))
      .sort((a, b) => (a.priority - b.priority) || (kind === 'dip' ? b.vs200 - a.vs200 : b.chg5d - a.chg5d));
  };
  return [...pick('dip', CFG.tradeDip), ...pick('rip', CFG.tradeRip)];
}

/** Current sleeve value: total account equity minus the untouched reserve. Trades are sized as
 *  a share of THIS, not of the whole account -- so the reserve genuinely never gets spent. */
function sleeveEquity(totalEquity) { return totalEquity * (1 - CFG.reservePct); }

async function runEntries(state, setups) {
  const today = todayEastern();
  if (!CFG.force && state.lastEntryRunDate === today) { log('Entries already handled today; skipping.'); return; }
  if (setups.nextSession !== today) {
    log(`Skipping entries: the latest setups (as of ${setups.asOf}) are for ${setups.nextSession}'s open, not today (${today}). ` +
      `The scheduled scan may not have finished yet, or today's a holiday.`);
    return;
  }
  const clock = await getClock().catch(() => null);
  if (clock && !clock.is_open && !CFG.force) { log('Market is not open right now; skipping entries.'); return; }

  const account = await getAccount().catch(e => { log(`Could not read the account (${e.message}); skipping entries.`); return null; });
  if (!account) return;
  const totalEquity = Number(account.equity);
  const sleeve = sleeveEquity(totalEquity);
  const reserveFloor = totalEquity * CFG.reservePct;
  let spendable = Number(account.cash) - reserveFloor;   // never dip into the reserve to fund a new trade
  log(`  account equity $${totalEquity.toFixed(0)} | sleeve (90%) $${sleeve.toFixed(0)} | reserve floor $${reserveFloor.toFixed(0)} | spendable now $${spendable.toFixed(0)}`);

  const candidates = rankCandidates(setups, state);
  const entries = [], skipped = [];
  const shortableCache = new Map();

  for (let rank = 0; rank < candidates.length; rank++) {
    const c = candidates[rank];
    const long = c.kind === 'dip';
    if (isNum(c.dollarVol) && c.dollarVol < core.SETUP.MIN_LIQUIDITY) {
      skipped.push({ ticker: c.ticker, strategy: c.kind, reason: `Below the $${(core.SETUP.MIN_LIQUIDITY / 1e6).toFixed(0)}M/day liquidity floor` });
      continue;
    }
    const size = CFG.sizePct * sleeve;
    if (size > spendable) {
      skipped.push({ ticker: c.ticker, strategy: c.kind, reason: 'The sleeve has no spare cash left today' });
      continue;
    }
    if (!long) {
      if (!shortableCache.has(c.ticker)) shortableCache.set(c.ticker, await getAsset(c.ticker));
      const asset = shortableCache.get(c.ticker);
      if (!asset || asset.shortable === false || asset.easy_to_borrow === false) {
        skipped.push({ ticker: c.ticker, strategy: c.kind, reason: 'Not available to short on this account' });
        continue;
      }
    }
    const limit = r2(long ? c.close * (1 + CFG.chase) : c.close * (1 - CFG.chase));
    const shares = Math.max(1, Math.floor(size / limit));
    const tag = candidateTag(c.kind, c);
    try {
      // A plain LIMIT day order: it fills only within 2% of the signal close, and cancels itself if
      // the market never reaches that price by the close, so a gapped-away open is simply skipped
      // rather than chased. Tested against no cap across 2000-2026: helps Dip, costs Rip a little,
      // kept on both for one simple rule.
      const order = await alpaca('POST', '/v2/orders', { symbol: c.ticker, qty: String(shares), side: long ? 'buy' : 'sell', type: 'limit', time_in_force: 'day', limit_price: String(limit) });
      state.pendingEntries[c.ticker] = { orderId: order.id, strategy: c.kind, side: long ? 'long' : 'short', tag,
        size, shares, limit, signalDate: c.signalDate, signalClose: c.close, atr: c.atr, placedAt: new Date().toISOString() };
      entries.push({ rank: rank + 1, ticker: c.ticker, strategy: c.kind, tag, size: r2(size), shares, limit, vs200: r2(c.vs200), chg5d: r2(c.chg5d) });
      spendable -= size;
      log(`  placed entry: ${c.ticker} (${c.kind}, ${tag}) ${shares} shares, limit ${limit}`);
    } catch (e) {
      skipped.push({ ticker: c.ticker, strategy: c.kind, reason: `Order failed: ${e.message.slice(0, 120)}` });
      log(`  ${c.ticker}: order failed — ${e.message}`);
    }
  }
  state.lastOrders = { forDate: today, entries, skipped };
  state.lastEntryRunDate = today;

  // Give same-morning fills a chance to get their protective OCO attached right away,
  // rather than leaving a filled, unprotected position until the next scheduled run.
  if (Object.keys(state.pendingEntries).length) {
    for (let i = 0; i < CFG.pollTries; i++) {
      await sleep(CFG.pollDelayMs);
      await reconcilePendingEntries(state);
      if (!Object.keys(state.pendingEntries).length) break;
    }
  }
}

/* ------------------------------------------------------------------ exit */
async function runExits(state) {
  const today = todayEastern();
  if (!CFG.force && state.lastExitRunDate === today) { log('Time exits already handled today; skipping.'); return; }
  const clock = await getClock().catch(() => null);
  if (clock && !clock.is_open && !CFG.force) { log('Market is not open right now; skipping time exits.'); return; }

  const due = Object.entries(state.positions).filter(([, p]) => core.addSessions(p.entryDate, CFG.holdSessions - 1) <= today);
  const exits = []; let failed = 0;
  for (const [ticker, p] of due) {
    if (state.pendingCloses[ticker]) { log(`  ${ticker}: a close is already in progress; leaving it.`); continue; }
    log(`  time exit due: ${ticker} (entered ${p.entryDate})`);
    if (p.ocoOrderId) await cancelAndWait(p.ocoOrderId, ticker);
    state.pendingCloses[ticker] = { reason: 'time' };
    try {
      await closeWithRetry(ticker);
      exits.push({ ticker, note: `${p.side === 'long' ? 'Sold' : 'Bought back'} at the market (3rd session)` });
    } catch (e) {
      failed++;
      log(`  ${ticker}: could not close it (${e.message}).`);
      delete state.pendingCloses[ticker];
      if (p.ocoOrderId) {   // the stop/target were cancelled to make way for the close: never leave a position bare
        try { p.ocoOrderId = await reprotect(ticker, p); log(`  ${ticker}: stop and target restored (${p.ocoOrderId}); run the exit again to retry.`); }
        catch (e2) { log(`  ${ticker}: COULD NOT restore its stop/target (${e2.message}). This position has NO automatic stop — check the Alpaca dashboard.`); p.ocoOrderId = null; }
      }
    }
  }
  state.lastExits = { forDate: today, exits };
  if (!failed) state.lastExitRunDate = today;   // a failed close must not use up the day: a plain re-run can retry it
  else log(`  ${failed} position(s) could not be closed; running the exit again today will retry them.`);
  if (exits.length) { await sleep(CFG.pollDelayMs); await reconcileClosedPositions(state, await getPositions()); }
}

/** Appends/updates today's account-equity snapshot, using Alpaca's own account equity as
 *  the source of truth (it reflects actual cash + marked positions precisely). Only starts
 *  once trading has actually begun (state.startedAt set), so there's no baseline recorded
 *  for days before the account was first resumed. */
async function updateEquitySnapshot(state) {
  if (!state.startedAt) return;
  const today = todayEastern();
  let account, spyClose;
  try { [account, spyClose] = await Promise.all([getAccount(), getLatestDailyClose('SPY')]); }
  catch (e) { log(`Could not refresh the equity snapshot (${e.message}); leaving it as-is.`); return; }
  if (!account || !isNum(Number(account.equity))) return;
  if (!isNum(state.spyBaseline) && isNum(spyClose)) state.spyBaseline = spyClose;
  const value = Math.round(Number(account.equity));
  const pct = r2((value / CFG.startCapital - 1) * 100);
  const spy = isNum(spyClose) && isNum(state.spyBaseline) ? r2((spyClose / state.spyBaseline - 1) * 100) : null;
  const row = { d: today, value, pct, spy };
  const last = state.equity[state.equity.length - 1];
  if (last && last.d === today) state.equity[state.equity.length - 1] = row; else state.equity.push(row);
}

/* ---------------------------------------------------------------- render */
/**
 * Turns state.json into the public data/paper.json the website reads.
 * Pure and read-only: takes already-fetched candles (from the calling scan,
 * or fetched here in standalone mode) rather than hitting Alpaca itself,
 * so publishing the page never risks placing or touching an order.
 */
function renderPublicJson(state, getCandles) {
  const closeOf = ticker => {
    const c = getCandles && getCandles(ticker);
    return c && c.length ? c[c.length - 1].c : null;
  };
  const positions = Object.entries(state.positions).map(([ticker, p]) => {
    const now = closeOf(ticker) ?? p.now ?? p.entry;
    return { ticker, strategy: p.strategy, side: p.side, tag: p.tag, shares: p.shares, entry: p.entry, entryDate: p.entryDate,
      signalDate: p.signalDate, signalClose: p.signalClose, now: r2(now), target: p.target, stop: p.stop,
      day: Math.min(CFG.holdSessions, dayCount(p.entryDate)), exitDate: core.addSessions(p.entryDate, CFG.holdSessions - 1) };
  });
  const inTrades = Math.round(positions.reduce((s, p) => s + p.shares * p.entry, 0));
  const today = todayEastern();
  const lastRecorded = state.equity[state.equity.length - 1];
  const needsFreshRow = !lastRecorded || lastRecorded.d !== today;

  // Between paper.yml runs (which record the authoritative Alpaca account equity), estimate
  // today's value locally by marking open positions to the candles this render call was given.
  // The dollar figure and the percentage shown alongside it must always agree with each other,
  // so when today's row isn't recorded yet, both are (re)derived from the same fresh value here
  // rather than mixing a fresh dollar total with a stale, previously-recorded percentage.
  const openPnl = positions.reduce((s, p) => s + (p.side === 'long' ? p.now - p.entry : p.entry - p.now) * p.shares, 0);
  const value = needsFreshRow
    ? Math.round(CFG.startCapital + state.trades.reduce((s, t) => s + t.usd, 0) + openPnl)
    : lastRecorded.value;
  const pct = needsFreshRow ? r2((value / CFG.startCapital - 1) * 100) : lastRecorded.pct;
  // The S&P benchmark itself is left as of paper.js's last snapshot (it isn't refetched here,
  // to keep this render step free of any live network calls); it catches up next time paper.yml runs.
  const equity = needsFreshRow ? [...state.equity, { d: today, value, pct, spy: lastRecorded ? lastRecorded.spy : null }] : state.equity;

  const reserve = Math.round(value * CFG.reservePct);
  return {
    version: 1, simulated: false, generatedAt: new Date().toISOString(), asOf: today,
    status: state.status, startedAt: state.startedAt, broker: 'Alpaca paper account',
    rules: RULES(), account: { start: CFG.startCapital, value, inTrades, reserve, sleeve: value - reserve },
    backtest: { profitable: 60, avgPct: 0.99, hitTarget: 18, stopped: 2, period: '2019–2026, S&P 500' },
    equity,
    positions,
    orders: { forDate: state.lastOrders.forDate, entries: state.lastOrders.entries, skipped: state.lastOrders.skipped, exits: state.lastExits.exits },
    trades: state.trades,
  };
}

function dayCount(entryDate) {
  let d = entryDate, n = 1;
  const today = todayEastern();
  while (d < today) { d = core.addSessions(d, 1); n++; }
  return n;
}

/* ------------------------------------------------------------------ main */
/** Alerts must never break trading: run them, log any error, carry on. */
async function alertSafely(fn) { try { await fn(); } catch (e) { log(`Alert skipped: ${e.message}`); } }

async function main() {
  assertPaperOnly();
  if (!CFG.keyId || !CFG.secret) throw new Error('ALPACA_KEY_ID and ALPACA_SECRET_KEY are not set.');
  const state = loadState();

  if (CFG.action === 'pause' && state.status !== 'paused') { state.status = 'paused'; log('Paused. New entries will stop; open positions still exit on schedule.'); }
  if (CFG.action === 'resume' && state.status !== 'running') {
    state.status = 'running';
    if (!state.startedAt) state.startedAt = todayEastern();
    log('Resumed.');
  }

  log(`Mode: ${CFG.mode} | status: ${state.status}`);
  // Reconciliation and the equity snapshot are saved unconditionally (via the finally block
  // below), even if the mode-specific step that follows fails partway through — e.g. a
  // transient network error fetching setups.json shouldn't discard fills/closures that were
  // already detected earlier in this same run.
  const tradesBefore = state.trades.length, entryRunBefore = state.lastEntryRunDate;
  try {
    log('Reconciling fills and closures…');
    await reconcile(state);
    await updateEquitySnapshot(state);
    await alertSafely(() => notify.closedAlert(state.trades.slice(tradesBefore)));

    if (CFG.mode === 'entry') {
      if (state.status !== 'running') { log('Paused: not placing new entries.'); }
      else {
        const setups = await fetchSetups();
        log(`Setups as of ${setups.asOf} (next session ${setups.nextSession}); placing entries…`);
        await runEntries(state, setups);
        if (state.lastEntryRunDate !== entryRunBefore) await alertSafely(() => notify.entriesAlert(state.lastOrders));
      }
    } else if (CFG.mode === 'exit') {
      log('Checking for positions due their time exit…');
      await runExits(state);
      await alertSafely(() => notify.exitsAlert(state.lastExits));
    } else if (CFG.mode === 'reconcile') {
      log('Reconcile-only run; no new orders.');
    } else {
      throw new Error(`Unknown MODE "${CFG.mode}" (expected entry, exit or reconcile).`);
    }
  } finally {
    saveState(state);
    log(`Open positions: ${Object.keys(state.positions).length}, pending entries: ${Object.keys(state.pendingEntries).length}, trades recorded: ${state.trades.length}.`);
  }
  log('Done.');
}

if (require.main === module) {
  main().catch(e => { console.error(`Paper trading error: ${e.message}`); console.log(`::error::${e.message}`); process.exitCode = 1; });
}

module.exports = {
  CFG, RULES, defaultState, loadState, saveState, todayEastern, dayCount, main,
  reconcile, reconcileClosedPositions, reconcilePendingEntries, runEntries, runExits, rankCandidates,
  updateEquitySnapshot, renderPublicJson, fetchSetups, assertPaperOnly,
  alpaca, getClock, getAccount, getPositions, getOpenOrders, getOrder, getAsset, getLatestDailyClose, cancelOrder, closePositionMarket,
};
