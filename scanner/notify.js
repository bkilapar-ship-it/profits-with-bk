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

/** One numbered, crisp block per ticker: side implied by its section, entry, target, stop, exit date. */
function setupCard(n, x) {
  const lv = x.levels || {};
  return `${n}. ${x.ticker}\nEntry ${money2(lv.entryLimit)} | Target ${money2(lv.target)} | Stop ${money2(lv.stop)}\nExit by ${exitDay(x.exitDate)}`;
}

function setupsMessage(setups) {
  const tested = x => !setups.sp500Listed || x.sp500;
  const dip = rankFresh((setups.dip || []).filter(tested), 'dip');
  const rip = rankFresh((setups.rip || []).filter(tested), 'rip');
  const header = `📊 *Trade With BK*: setups for the ${dayLabel(setups.nextSession || setups.asOf)} open`;
  if (!dip.length && !rip.length) return `${header}\n\nNo new setups.`;
  const parts = [header];
  if (dip.length) parts.push(`*Long Setups:*\n${dip.map((x, i) => setupCard(i + 1, x)).join('\n\n')}`);
  if (rip.length) parts.push(`*Short Setups:*\n${rip.map((x, i) => setupCard(i + 1, x)).join('\n\n')}`);
  return parts.join('\n\n');
}

function entriesMessage(o) {
  const e = (o && o.entries) || [], s = (o && o.skipped) || [];
  if (!e.length && !s.length) return null;
  const lines = [`✅ Paper entries for the ${dayLabel(o.forDate)} open: ${e.length} placed`];
  for (const x of e.slice(0, 10)) lines.push(`${x.ticker} ${x.strategy === 'dip' ? 'long' : 'short'} ~$${Math.round(x.size).toLocaleString('en-US')}${TAGS[x.tag] ? ' · ' + TAGS[x.tag] : ''}`);
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
  return send(setupsMessage(setups));
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

module.exports = { send, enabled, setupsMessage, entriesMessage, closedMessage, exitsMessage, failureMessage,
  setupsAlert, entriesAlert, closedAlert, exitsAlert, scanFailAlert };
