#!/usr/bin/env node
/*
 * Trade With BK — optional WhatsApp alerts, sent through CallMeBot (https://www.callmebot.com).
 *
 * CallMeBot is a free, unofficial gateway that messages YOUR OWN WhatsApp number. It is for
 * personal use only, so treat alerts as a convenience, never as something to rely on. It sends
 * plain text only -- there is no way to send an image through it, so "*bold*" is WhatsApp's own
 * text formatting, the only styling available here.
 *
 * Nothing here can break a run: with no CALLMEBOT_PHONE / CALLMEBOT_APIKEY secrets set,
 * every function quietly does nothing, and any send error is logged and swallowed.
 *
 * What gets sent (each only when something actually happened):
 *   - New setups, once per new signal date, after the close (also a daily "no setups" heartbeat)
 *   - Paper entries placed, time exits sent, and trades that closed (target / stop / time)
 *   - A failed paper-trading run or a failed market scan
 *
 * Usage from a workflow:  node scanner/notify.js test | failure "Name" | scanfail
 * Not financial advice.
 */
'use strict';

const env = process.env;
const CFG = {
  phone: (env.CALLMEBOT_PHONE || '').replace(/[^\d+]/g, ''),   // international format, e.g. +14155551234
  apikey: (env.CALLMEBOT_APIKEY || '').trim(),
  endpoint: env.CALLMEBOT_URL || 'https://api.callmebot.com/whatsapp.php',
  maxLen: Number(env.ALERT_MAX_LEN || 900),
};
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const enabled = () => !!(CFG.phone && CFG.apikey);
const log = (...a) => console.log('[alerts]', ...a);

/** Send one WhatsApp message. Returns true if CallMeBot accepted it. Never throws. */
async function send(text) {
  if (!enabled()) { log('not configured (CALLMEBOT_PHONE / CALLMEBOT_APIKEY); skipping.'); return false; }
  const msg = String(text).slice(0, CFG.maxLen);
  const url = `${CFG.endpoint}?phone=${encodeURIComponent(CFG.phone)}&text=${encodeURIComponent(msg)}&apikey=${encodeURIComponent(CFG.apikey)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 160);
    if (!res.ok) { log(`CallMeBot answered HTTP ${res.status}: ${body}`); return false; }
    log(`sent (${msg.length} chars). CallMeBot said: ${body}`);
    return true;
  } catch (e) {
    log(`send failed: ${e.message}`);
    return false;
  }
}

/* ------------------------------------------------------------------ formatting */
const dayLabel = iso => {
  try { return new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  catch { return String(iso); }
};
const exitDay = iso => {
  try { return new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  catch { return String(iso); }
};
const usd = n => `${n < 0 ? '-' : '+'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const pct = n => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
const money2 = n => (isNum(n) ? n.toFixed(2) : '—');
const TAGS = { bearEngulf: 'selling flush', rsi5_90: 'blow-off rally', green_or_sweep: 'lower priority' };
const HOW = { target: 'hit target', stop: 'hit stop', time: 'time exit', manual: 'closed manually' };
const shortReason = r => /liquidity/i.test(r) ? 'thin volume' : /no spare cash/i.test(r) ? 'no cash' : /short/i.test(r) ? 'not shortable' : /failed/i.test(r) ? 'order failed' : String(r).slice(0, 22);
const runUrl = () => (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID) ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '';

function rankFresh(list, kind) {
  return (list || []).filter(x => x.sessionsAgo === 0)
    .sort((a, b) => ((a.priority ?? 1) - (b.priority ?? 1)) || (kind === 'dip' ? b.vs200 - a.vs200 : b.chg5d - a.chg5d));
}

/** One numbered, crisp block per ticker: entry, target, stop, exit date. */
function setupCard(n, x) {
  const lv = x.levels || {};
  return `${n}. ${x.ticker}\nEntry ${money2(lv.entryLimit)} | Target ${money2(lv.target)} | Stop ${money2(lv.stop)}\nExit by ${exitDay(x.exitDate)}`;
}

// Stocks outside the S&P 500 follow the same conditions as the app's Non-S&P 500 tab and paper trading:
// Uptrend Dip only, $100M+ traded a day, and only while the S&P 500 is flat or down over 20 sessions.
const NONSP = {
  minLiquidity: Number(env.ALERT_NONSP_MIN_LIQUIDITY || 100e6),
  marketGate: String(env.ALERT_NONSP_MARKET_GATE || 'true').toLowerCase() !== 'false',
};

/** What the alert lists, in order: S&P 500 long, S&P 500 short, then (when allowed) Non-S&P 500 long. */
function setupSections(setups) {
  const listed = !!setups.sp500Listed;                       // if membership is unknown, everything counts as S&P 500
  const inSp = x => !listed || x.sp500;
  const cards = list => list.map((x, i) => setupCard(i + 1, x));
  const sections = [], notes = [];
  const dipSp = rankFresh((setups.dip || []).filter(inSp), 'dip'), ripSp = rankFresh((setups.rip || []).filter(inSp), 'rip');
  if (dipSp.length) sections.push({ base: 'S&P 500 — Long Setups', cards: cards(dipSp) });
  if (ripSp.length) sections.push({ base: 'S&P 500 — Short Setups', cards: cards(ripSp) });
  if (listed) {
    const ns = rankFresh((setups.dip || []).filter(x => !x.sp500 && isNum(x.dollarVol) && x.dollarVol >= NONSP.minLiquidity), 'dip');
    const m = setups.market;
    const gateOpen = !NONSP.marketGate || (m && isNum(m.chg20d) && m.chg20d <= 0);
    if (ns.length && gateOpen) sections.push({ base: 'Non-S&P 500 — Long Setups', cards: cards(ns) });
    else if (ns.length) notes.push(`Non-S&P 500: ${ns.length} signal${ns.length === 1 ? '' : 's'} not shown (${m && isNum(m.chg20d) ? `the S&P 500 is up ${m.chg20d.toFixed(1)}% over 20 sessions` : 'no market-trend reading'}).`);
  }
  return { sections, notes };
}

/** The alert as one or more messages, each at most `limit` characters. A section that runs over starts the
 *  next message with its own heading, marked "(cont.)", so every message makes sense on its own. */
function setupsMessages(setups, limit = Infinity) {
  const header = `📊 *Trade With BK*: setups for the ${dayLabel(setups.nextSession || setups.asOf)} open`;
  const { sections, notes } = setupSections(setups);
  const msgs = []; let cur = header;
  const place = (text, alt) => {
    if ((cur + '\n\n' + text).length > limit) { msgs.push(cur); cur = alt || text; } else cur += '\n\n' + text;
  };
  if (!sections.length) place(notes.length ? 'No new S&P 500 setups.' : 'No new setups.');
  else if (!sections.some(sec => sec.base.startsWith('S&P'))) place('*S&P 500:* no new setups.');
  for (const sec of sections) {
    let started = false;
    for (const card of sec.cards) {
      place(started ? card : `*${sec.base}:*\n${card}`, `*${sec.base}${started ? ' (cont.)' : ''}:*\n${card}`);
      started = true;
    }
  }
  for (const n of notes) place(n);
  msgs.push(cur);
  return msgs;
}
const setupsMessage = setups => setupsMessages(setups).join('\n\n');          // everything as one text (previews and tests)

function entriesMessage(o) {
  const e = (o && o.entries) || [], s = (o && o.skipped) || [];
  if (!e.length && !s.length) return null;
  const lines = [o.queued ? `🕘 Paper orders queued for the ${dayLabel(o.forDate)} open: ${e.length}` : `✅ Paper entries for the ${dayLabel(o.forDate)} open: ${e.length} placed`];
  for (const x of e.slice(0, 10)) lines.push(`${x.ticker} ${x.strategy === 'dip' ? 'long' : 'short'} ~$${Math.round(x.size).toLocaleString('en-US')}${TAGS[x.tag] ? ' · ' + TAGS[x.tag] : ''}${x.pool === 'nonsp' ? ' · non-S&P' : ''}`);
  if (e.length > 10) lines.push(`+${e.length - 10} more`);
  if (s.length) lines.push(`Skipped ${s.length}: ${s.slice(0, 4).map(x => `${x.ticker} (${shortReason(x.reason)})`).join(', ')}${s.length > 4 ? '…' : ''}`);
  return lines.join('\n');
}

function closedMessage(trades) {
  if (!trades || !trades.length) return null;
  const lines = [`🔔 Paper trade${trades.length > 1 ? 's' : ''} closed`];
  for (const t of trades.slice(0, 10)) lines.push(`${t.ticker} ${t.side} ${pct(t.pct)} (${usd(t.usd)}) ${HOW[t.how] || t.how}`);
  if (trades.length > 10) lines.push(`+${trades.length - 10} more`);
  return lines.join('\n');
}

function exitsMessage(x) {
  const exits = (x && x.exits) || [];
  if (!exits.length) return null;
  return `⏰ Time exits sent for the close: ${exits.map(e => e.ticker).join(', ')}`;
}

const failureMessage = name => `⚠️ ${name || 'A workflow'} failed.${runUrl() ? '\n' + runUrl() : ''}`;

/* ------------------------------------------------------------------ alerts */
/** After-close signals, once per new signal date. If the previously published file can't be
 *  read we stay quiet (rather than risk repeating the same alert every hour). */
async function setupsAlert(setups, previous) {
  if (!setups || !previous || !previous.asOf || previous.asOf === setups.asOf) return false;
  const msgs = setupsMessages(setups, CFG.maxLen - 30);       // leave room so send() never has to cut a message
  let ok = true;
  for (let i = 0; i < msgs.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1500));   // a short pause keeps the messages in order
    ok = (await send(msgs[i])) && ok;
  }
  return ok;
}
async function entriesAlert(orders) { const m = entriesMessage(orders); return m ? send(m) : false; }
async function closedAlert(trades) { const m = closedMessage(trades); return m ? send(m) : false; }
async function exitsAlert(lastExits) { const m = exitsMessage(lastExits); return m ? send(m) : false; }
/** A failed scan republishes the previous results flagged stale; alert only on the first failure. */
async function scanFailAlert(previous) {
  if (previous && previous.stale) return false;
  return send(`⚠️ The market scan failed. The site is still showing the previous results.${runUrl() ? '\n' + runUrl() : ''}`);
}

async function fetchJson(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); return r.ok ? await r.json() : null; } catch { return null; }
}

if (require.main === module) {
  (async () => {
    const [cmd, ...rest] = process.argv.slice(2);
    if (cmd === 'test') {
      const ok = await send('✅ Trade With BK alerts are working. You will get: new setups after the close, paper entries, exits and closed trades, and failures.');
      process.exitCode = ok ? 0 : 1;   // red on purpose, so a bad setup is visible in the test run
    } else if (cmd === 'failure') {
      await send(failureMessage(rest.join(' ')));
    } else if (cmd === 'scanfail') {
      const base = (env.PREVIOUS_BASE_URL || '').replace(/\/+$/, '');
      await scanFailAlert(base ? await fetchJson(`${base}/data/setups.json`) : null);
    } else {
      console.log('Usage: node scanner/notify.js test | failure "Name" | scanfail');
    }
  })();
}

module.exports = { send, enabled, setupsMessage, setupsMessages, entriesMessage, closedMessage, exitsMessage, failureMessage,
  setupsAlert, entriesAlert, closedAlert, exitsAlert, scanFailAlert };
