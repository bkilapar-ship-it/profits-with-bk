'use strict';
/* Turns the published signals into an episode: scenes, narration, metadata. Deterministic: every number comes from the data. */

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const money = x => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x, d = 1) => `${Math.abs(x).toFixed(d)}%`;
const say = (x, d = 1) => `${Math.abs(x).toFixed(d)} percent`;
const dayName = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayShort = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const words = s => s.trim().split(/\s+/).length;
const spell = t => String(t);

const REASON_TEXT = { 'closed near the day’s low': 'it closed near the low of the day', 'new 20-day low': 'it made a new 20-day closing low', '3 down days in a row': 'it fell three days in a row' };
const sortLive = (a, b) => (a.priority - b.priority) || (b.vs200 - a.vs200);

function plan(x) {
  const lv = x.levels || {};
  return { entryCap: lv.entryLimit, target: lv.target, stop: lv.stop, ref: lv.ref };
}

function setupNarration(x, i, cfg) {
  const p = plan(x), L = [];
  const lead = ['First up', 'Next', 'Third'][i] || 'Next';
  L.push(`${lead}, ${spell(x.ticker)}. It closed at ${money(x.close)}, down ${say(x.chg5d)} over five sessions, yet still ${say(x.vs200)} above its 200-day average.`);
  const rs = (x.reasons || []).map(r => REASON_TEXT[r] || r);
  if (rs.length) L.push(`The capitulation signal: ${rs.join(', and ')}.`);
  if (x.priority === 0) L.push('It also printed a bearish engulfing candle, the pattern the backtests ranked highest.');
  if (x.priority === 2) L.push('It closed green or swept an earlier low, which the backtests ranked lower.');
  if (isNum(x.relVol) && x.relVol >= 1.5) L.push(`Volume was ${x.relVol.toFixed(1)} times its average.`);
  if (isNum(x.rsi)) L.push(`The 14-day RSI reads ${Math.round(x.rsi)}.`);
  L.push(`The tested plan, which is not a recommendation: buy at the next open only if it is within 2 percent of this close, a target 4 percent higher near ${money(p.target)}, a stop 3 ATR lower near ${money(p.stop)}, and exit at the close of the third session whatever happens.`);
  return L.join(' ');
}

function ripNarration(x) {
  const p = plan(x);
  return `On the short side, ${spell(x.ticker)} closed at ${money(x.close)}, up ${say(x.chg5d)} over five sessions and ${say(Math.abs(x.vs200))} below its 200-day average, with an RSI of ${Math.round(x.rsi5 || x.rsi)} on the 5-day measure. The tested plan: a target 4 percent lower near ${money(p.target)}, a stop 3 ATR higher near ${money(p.stop)}, exit at the third close. Shorts carry unlimited risk and are only for experienced traders.`;
}

const RULES_TEXT = 'The screen looks for three things in the same stock. One: an uptrend, meaning the price is above its 200-day average. Two: a sharp drop, at least 10 percent over five sessions. Three: capitulation, meaning it closed near the low of the day, made a new 20-day low, or fell three days in a row. The idea is that strong stocks that get sold hard often bounce within a few sessions.';

function statsText(cfg) {
  return `What does history say? Across 10 years of S&P 500 backtests, this screen produced about ${cfg.backtest.winRate} percent winning trades and an average of ${cfg.backtest.avgPct} percent per trade, before costs and slippage. Losses happen, and in sharp sell-offs several signals can lose together, so position size matters more than any single pick.`;
}

function outroText(cfg) {
  return `That is today's screen. ${cfg.disclaimer} If this was useful, subscribe to ${cfg.channelName} for the next one.`;
}

function nearTrigger(status, exclude) {
  return Object.entries(status || {}).map(([t, v]) => ({ ticker: t, close: v[0], r5: v[1], vs200: v[2], rsi: v[3] }))
    .filter(x => isNum(x.r5) && isNum(x.vs200) && x.vs200 > 0 && x.r5 <= -6.5 && x.r5 > -10 && !exclude.has(x.ticker))
    .sort((a, b) => a.r5 - b.r5).slice(0, 6);
}

function marketLine(market) {
  if (!market || !isNum(market.chg20d)) return '';
  const d = market.chg20d;
  return d <= 0 ? `The S&P 500 is down ${say(d)} over the past 20 sessions, the kind of backdrop where dips have been more common.` : `The S&P 500 is up ${say(d)} over the past 20 sessions.`;
}

function buildEpisode({ mode, setups, config }) {
  const cfg = config, scenes = [], asOf = setups.asOf;
  const live = (setups.dip || []).concat(setups.rip || []).filter(x => x.sessionsAgo === 0);
  const dipSp = (setups.dip || []).filter(x => x.sessionsAgo === 0 && x.sp500).sort(sortLive);
  const ripSp = (setups.rip || []).filter(x => x.sessionsAgo === 0 && x.sp500).sort((a, b) => (a.priority - b.priority) || (b.chg5d - a.chg5d));
  const dipOther = (setups.dip || []).filter(x => x.sessionsAgo === 0 && !x.sp500);
  const date = dayName(asOf);
  const add = (id, type, heading, narration, data = {}) => scenes.push({ id, type, heading, narration, data, dur: Math.max(5, Math.round((words(narration) / cfg.speakingWordsPerSecond + 1.5) * 10) / 10) });
  let title, featured = [];

  if (mode === 'weekly') {
    const tracked = (setups.dip || []).concat(setups.rip || []).filter(x => x.sessionsAgo >= 1 && x.track && ['target', 'stop', 'closed'].includes(x.track.state));
    const n = tracked.length, hit = tracked.filter(x => x.track.state === 'target').length, stop = tracked.filter(x => x.track.state === 'stop').length;
    const up = tracked.filter(x => x.track.pct > 0).length, avg = n ? tracked.reduce((s, x) => s + x.track.pct, 0) / n : 0;
    title = `Weekly review: how the dip signals played out | ${dayShort(asOf)}`;
    add('intro', 'intro', 'WEEKLY REVIEW', `Welcome back to ${cfg.channelName}. This is the weekly review for the week ending ${date}. We look at how the recent screen signals played out under the tested plan, then at what to watch next week. ${marketLine(setups.market)}`, { date: dayShort(asOf), kicker: 'Weekly review', market: setups.market, counts: { dip: dipSp.length, rip: ripSp.length, other: dipOther.length } });
    if (n) {
      add('outcomes', 'outcomes', 'HOW THE SIGNALS PLAYED OUT', `Of the ${n} signals that completed their three session window, ${hit} reached the 4 percent target, ${stop} hit the stop, and ${up} finished positive overall. The average result was ${avg >= 0 ? 'plus' : 'minus'} ${say(avg, 2)} per trade, before costs. Remember these are the tested rules applied to every signal, not a portfolio, and a handful of large losses can outweigh many small wins.`, { rows: tracked.sort((a, b) => b.track.pct - a.track.pct).slice(0, 12).map(x => ({ ticker: x.ticker, pct: x.track.pct, state: x.track.state, kind: x.kind })), n, hit, stop, up, avg });
    } else {
      add('outcomes', 'text', 'NO COMPLETED SIGNALS', 'There were no signals that completed their three session window in the recent data, so there is nothing to score this week.', {});
    }
    const watch = nearTrigger(setups.status, new Set(live.map(x => x.ticker)));
    add('watch', 'watch', 'WHAT TO WATCH NEXT WEEK', `Not a forecast, just a watch list. ${marketLine(setups.market)} ${watch.length ? `These stocks are still above their 200-day average and have fallen between six and a half and 10 percent over five sessions, so one more down day could trigger the screen: ${watch.map(x => spell(x.ticker)).join(', ')}.` : 'No stocks are currently close to triggering the screen.'} The screen only fires after the close, so nothing here is a signal until it prints.`, { watch, market: setups.market });
    add('stats', 'stats', 'WHAT HISTORY SAYS', statsText(cfg), { winRate: cfg.backtest.winRate, avgPct: cfg.backtest.avgPct, period: cfg.backtest.period });
    add('outro', 'outro', 'THANKS FOR WATCHING', outroText(cfg), { disclaimer: cfg.disclaimer });
    return { mode, title, date: dayShort(asOf), asOf, scenes, tickers: [], cfg };
  }

  // ---------------- daily ----------------
  featured = dipSp.slice(0, cfg.maxSetups);
  const short = ripSp[0] || null;
  title = featured.length ? `Dip signals ${dayShort(asOf)}: ${featured.map(x => x.ticker).join(', ')}` : `S&P 500 dip screen ${dayShort(asOf)}: no signals today`;
  const countLine = live.length ? `${dipSp.length} S&P 500 long setup${dipSp.length === 1 ? '' : 's'}, ${ripSp.length} short, and ${dipOther.length} outside the index passed the screen today.` : 'No stocks passed the screen today.';
  add('intro', 'intro', 'DAILY DIP SIGNALS', `Welcome back to ${cfg.channelName}. It is ${date}. Here are the results from the Uptrend Dip screen, run on the close. ${countLine} ${marketLine(setups.market)}`, { date: dayShort(asOf), kicker: 'Daily screen', market: setups.market, counts: { dip: dipSp.length, rip: ripSp.length, other: dipOther.length } });
  add('rules', 'rules', 'HOW THE SCREEN WORKS', RULES_TEXT, {});
  featured.forEach((x, i) => add(`setup-${x.ticker}`, 'setup', x.ticker, setupNarration(x, i, cfg), { setup: x, plan: plan(x) }));
  if (short) add(`short-${short.ticker}`, 'setup', short.ticker, ripNarration(short), { setup: short, plan: plan(short), short: true });
  const rest = dipSp.slice(cfg.maxSetups);
  if (dipSp.length || ripSp.length) {
    const rows = dipSp.concat(ripSp).slice(0, 10).map(x => ({ ticker: x.ticker, kind: x.kind, chg5d: x.chg5d, vs200: x.vs200, close: x.close }));
    add('summary', 'summary', 'ALL S&P 500 SETUPS TODAY', `${rest.length ? `Beyond those, the other S&P names were ${rest.slice(0, 8).map(x => spell(x.ticker)).join(', ')}. ` : ''}The table shows every S&P 500 setup from today's screen. ${dipOther.length ? `${dipOther.length} more passed outside the index, which the live rules only trade under extra conditions.` : ''}`, { rows });
  } else {
    const watch = nearTrigger(setups.status, new Set());
    add('watch', 'watch', 'NOTHING TRIGGERED, WHAT TO WATCH', `Nothing triggered today. ${watch.length ? `Stocks closest to the screen: ${watch.map(x => spell(x.ticker)).join(', ')}.` : ''} No signal means no trade, and that is a normal outcome.`, { watch, market: setups.market });
  }
  add('stats', 'stats', 'WHAT HISTORY SAYS', statsText(cfg), { winRate: cfg.backtest.winRate, avgPct: cfg.backtest.avgPct, period: cfg.backtest.period });
  add('outro', 'outro', 'THANKS FOR WATCHING', outroText(cfg), { disclaimer: cfg.disclaimer });
  return { mode, title, date: dayShort(asOf), asOf, scenes, tickers: featured.map(x => x.ticker).concat(short ? [short.ticker] : []), cfg };
}

function metadata(ep) {
  const t0 = []; let t = 0;
  for (const s of ep.scenes) { t0.push(t); t += s.dur; }
  const mmss = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const chapters = ep.scenes.map((s, i) => `${mmss(t0[i])} ${s.heading.charAt(0) + s.heading.slice(1).toLowerCase()}`).join('\n');
  const tags = ['stock screener', 'S&P 500', 'dip buying', 'swing trading', 'stock market today', 'trading signals', 'technical analysis', ...ep.tickers];
  return `TITLE\n${ep.title}\n\nDESCRIPTION\n${ep.mode === 'weekly' ? 'Weekly review of how the screen signals played out under the tested rules, plus a watch list for next week.' : `Today's results from the Uptrend Dip screen on S&P 500 stocks: what triggered, why, and the tested plan levels.`}\n\nChapters (approximate, adjust after you edit):\n${chapters}\n\n${ep.cfg.disclaimer}\n\nAI note: the charts and graphics in this video are generated automatically from market data. The voice and presenter are real.\n\nTAGS\n${tags.join(', ')}\n`;
}

module.exports = { buildEpisode, metadata, spell, money, pct, nearTrigger };
