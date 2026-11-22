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


const weekday = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
function nextSessionName(iso) { const d = new Date(`${iso}T12:00:00Z`); do { d.setUTCDate(d.getUTCDate() + 1); } while ([0, 6].includes(d.getUTCDay())); return d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }); }
const sentences = t => (String(t).match(/[^.!?]+[.!?]+(\s|$)/g) || [String(t)]).map(x => x.trim()).filter(Boolean);
function weekLine(m) {
  if (!m) return '';
  const parts = [];
  if (isNum(m.chg5d)) parts.push(`${m.chg5d >= 0 ? 'rose' : 'fell'} ${say(m.chg5d)} over the last five sessions`);
  if (isNum(m.chg20d)) parts.push(`is ${m.chg20d >= 0 ? 'up' : 'down'} ${say(m.chg20d)} over the last 20`);
  return parts.length ? `The S&P 500 ${parts.join(' and ')}.` : '';
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


function buildWelcome({ setups, config }) {
  const cfg = config, asOf = setups.asOf, scenes = [], m = setups.market || {};
  const wd = weekday(asOf), nx = nextSessionName(asOf);
  const dipSp = (setups.dip || []).filter(x => x.sessionsAgo === 0 && x.sp500).sort(sortLive);
  const tick = dipSp.slice(0, 6).map(x => x.ticker);
  const list = tick.length > 1 ? `${tick.slice(0, -1).join(', ')} and ${tick[tick.length - 1]}` : tick.join('');
  const add = (id, type, heading, narration, points, data = {}) => scenes.push({ id, type, heading, narration, points, data, dur: Math.max(6, Math.round((words(narration) / cfg.speakingWordsPerSecond + 1.5) * 10) / 10) });

  add('intro', 'intro', 'Welcome to Trade With BK',
    `Hi everyone, I'm Bharat, and welcome to ${cfg.channelName}. This is episode one, so I'll keep it simple. I'll tell you who I am, what this channel is for, how to use the signals, and what the screen found for ${nx}.`,
    ["Hi, I'm Bharat", `Welcome to ${cfg.channelName}: episode one`, `Today: what this channel is, how to use the signals, ${nx}'s list`],
    { date: `Episode 1 · ${dayShort(asOf)}`, kicker: 'Episode 1', chips: ['Hosted by Bharat', 'S&P 500 signals every weekday', 'Weekly review on Fridays'], market: m });

  add('channel', 'bullets', 'WHAT THIS CHANNEL IS FOR',
    `Here is the objective. Every weekday after the US market closes, I run one screen across the S&P 500 and show you what it found, with the reasons behind every signal. On Fridays I add a weekly review of how the market moved and what I'm watching next week. Everything here is educational. I won't hype anything and I won't predict prices. I'll show you a clear, tested process, and you decide what to do with it.`,
    ['Objective: one clear screen, every weekday after the close', 'Every signal comes with its reasons', 'Fridays: weekly review and what to watch', 'Education only: no hype, no price predictions'],
    { kick: 'THE CHANNEL', title: 'What you get here', items: ['One screen of S&P 500 stocks, every weekday after the close', 'The reasons behind every signal', 'A weekly review and a watch list on Fridays', 'Education only: no hype, no price predictions'] });

  add('rules', 'rules', 'HOW THE SCREEN WORKS', RULES_TEXT,
    ['1. Uptrend: price above the 200-day average', '2. Sharp drop: down 10% or more in five sessions', '3. Capitulation: closes near the low, new 20-day low, or 3 down days', 'Idea: strong stocks sold hard often bounce within days'], {});

  add('skips', 'bullets', 'WHAT THE SCREEN SKIPS',
    `One thing I want to be really clear about. This screen only picks stocks that are in an uptrend and have dipped. It does not pick stocks in a downtrend, because a stock that keeps falling inside a downtrend isn't a dip, it's just a falling stock. That's why you won't see the big AI names on this list right now. They're in a deep correction, so the screen leaves them alone, however tempting they look. The idea is strong stocks that got sold, not weak stocks that keep falling.`,
    ['Only uptrend stocks that dipped', "Skips downtrends: a falling stock isn't a dip", 'Example: no AI names on the list, they are in deep corrections', 'Strength that got sold, not weakness that keeps falling'],
    { kick: 'THE FILTER', title: 'What the screen skips', items: ['Stocks below their 200-day average: downtrends', 'Falling stocks with no uptrend behind them', 'Example right now: the big AI names, still in deep corrections', 'It only wants strong stocks that got sold hard'] });

  add('steps', 'steps', 'HOW TO USE A SIGNAL',
    `Now, how to use a signal. The screen prints after the close, so a ${wd} signal is for ${nx}. Step one, don't rush the open. Wait three to five minutes after the market opens and let the first chaos settle. Step two, only enter if the price is still within 2 percent of ${wd}'s close. If it has jumped further than that, skip it. Step three, the tested plan has a target 4 percent from the entry and a stop 3 ATR below, which is about three times the stock's normal daily range. Step four, don't hold on forever. Exit at the close of the third trading day at the latest, whatever the result. Keep every position small, because several signals can lose together in a sell-off. And remember, this is the tested plan, not personal advice.`,
    [`Signal prints after the close: ${wd}'s list is for ${nx}`, 'Wait 3 to 5 minutes after the open', 'Enter only if within 2% of the signal close, otherwise skip', 'Target +4%, stop 3 ATR below', 'Exit by the close of day 3, whatever happens', 'Keep every position small'],
    { items: [{ t: 'The signal prints after the close', s: `${wd}'s list is for ${nx}'s open` }, { t: 'Wait 3 to 5 minutes after the open', s: 'Let the opening chaos settle first' }, { t: 'Enter only within 2% of the signal close', s: 'Gapped up further than that? Skip it' }, { t: 'Target +4%, stop 3 ATR below', s: "ATR is the stock's typical daily range" }, { t: 'Exit at the close of day 3', s: 'Whatever the result' }] });

  if (isNum(m.chg5d) || isNum(m.chg20d)) {
    add('market', 'market', 'THIS WEEK IN THE MARKET',
      `Quick look at the market. ${weekLine(m)} Sharp sell-offs are when this screen finds the most signals, because the drop and capitulation tests need real selling. A quiet, rising market often gives us very few.`,
      [isNum(m.chg5d) ? `S&P 500 this week: ${m.chg5d >= 0 ? '+' : '−'}${Math.abs(m.chg5d).toFixed(1)}%` : null, isNum(m.chg20d) ? `Last 20 sessions: ${m.chg20d >= 0 ? '+' : '−'}${Math.abs(m.chg20d).toFixed(1)}%` : null, 'Sell-offs are when the screen finds the most signals'].filter(Boolean), { market: m });
  }

  if (dipSp.length) {
    const rows = dipSp.slice(0, 10).map(x => ({ ticker: x.ticker, kind: x.kind, chg5d: x.chg5d, vs200: x.vs200, close: x.close }));
    add('monday', 'summary', `${nx.toUpperCase()}'S SIGNALS`,
      `So what did the screen find for ${nx}? From ${wd}'s close, ${dipSp.length} S&P 500 ${dipSp.length === 1 ? 'stock' : 'stocks'} passed: ${list}. I'm only mentioning them today. From the next video, each one gets its own chart and reasons, so you can see exactly why it made the list.`,
      [`${wd}'s close: ${dipSp.length} S&P 500 signal${dipSp.length === 1 ? '' : 's'} for ${nx}`, list, 'Full breakdowns with charts start next video', `Remember: wait 3 to 5 minutes, within 2% of the close`],
      { rows, kick: `FOR ${nx.toUpperCase()}`, title: `${wd}'s signals, S&P 500` });
  } else {
    add('monday', 'text', 'NO SIGNALS FOR ' + nx.toUpperCase(), `The screen did not find any S&P 500 signals at ${wd}'s close, which is a perfectly normal outcome. No signal means no trade.`, ['No S&P 500 signals today', 'No signal means no trade'], {});
  }

  add('expect', 'bullets', 'WHAT TO EXPECT',
    `So what can you expect from this channel? A new video every weekday after the close, and a weekly review on Fridays. I'll always show the reasons and the tested levels. And I'll be honest about the numbers. Over the last ten years of S&P 500 backtests, roughly ${cfg.backtest.winRate} percent of these trades finished as winners, averaging about ${cfg.backtest.avgPct} percent per trade, before costs and slippage. That also means about one in three loses, and in a sharp sell-off several can lose together. This is not a get-rich-quick channel. It's a process, shown consistently. Nothing here is financial advice, so do your own research and keep your size small.`,
    ['A new video every weekday after the close', 'Friday: weekly review and what to watch', `History: about ${cfg.backtest.winRate}% winners, ${cfg.backtest.avgPct}% average per trade, before costs`, 'About 1 in 3 loses, and losses can cluster', 'Not financial advice: do your own research, keep size small'],
    { kick: 'SETTING EXPECTATIONS', title: 'What to expect', items: ['A video every weekday after the close', 'A weekly review and watch list on Fridays', `Backtest: about ${cfg.backtest.winRate}% winners, before costs`, 'Losses happen, and they can cluster', 'Education only, never personal advice'] });

  add('outro', 'outro', 'THANKS FOR WATCHING', `Thanks for watching. ${cfg.disclaimer} If this sounds useful, subscribe to ${cfg.channelName} so you catch the next one after the close. See you then.`, ['Thanks for watching', 'Subscribe so you catch the next one', 'See you after the next close'], { disclaimer: cfg.disclaimer });

  return { mode: 'welcome', title: `Welcome to ${cfg.channelName}: how the daily S&P 500 dip signals work (Episode 1)`, date: dayShort(asOf), asOf, scenes, tickers: tick.slice(0, 3), cfg };
}

function buildEpisode({ mode, setups, config }) {
  if (mode === 'welcome') return buildWelcome({ setups, config });
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
  return `TITLE\n${ep.title}\n\nDESCRIPTION\n${ep.mode === 'welcome' ? `Episode 1 of ${ep.cfg.channelName}. Hi, I'm Bharat. In this video: what the channel is for, how the Uptrend Dip screen picks S&P 500 stocks (and what it skips), how to use a signal (wait 3 to 5 minutes after the open, only within 2% of the signal close, 4% target, 3 ATR stop, exit by the close of day 3), this week's market and the first list of signals.` : ep.mode === 'weekly' ? 'Weekly review of how the screen signals played out under the tested rules, plus a watch list for next week.' : `Today's results from the Uptrend Dip screen on S&P 500 stocks: what triggered, why, and the tested plan levels.`}\n\nChapters (approximate, adjust after you edit):\n${chapters}\n\n${ep.cfg.disclaimer}\n\nAI note: the charts and graphics in this video are generated automatically from market data. The voice and presenter are real.\n\nTAGS\n${tags.join(', ')}\n`;
}

function pointsOf(sc) { return (sc.points && sc.points.length) ? sc.points : sentences(sc.narration).slice(0, 7); }
module.exports = { pointsOf, buildEpisode, metadata, spell, money, pct, nearTrigger };
