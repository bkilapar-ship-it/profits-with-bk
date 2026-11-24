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
/** The calls the channel gave on earlier sessions (days 1-3 of their three-day window): the top maxSetups S&P 500 signals of each session. */
function callRows(setups, cfg) {
  // Rebuild what the channel actually featured on each earlier session, oldest first: the same repeat rule as today's picks
  // (a stock already called in the last 3 sessions is skipped unless it fell more than 4% below that call's close), and the
  // pick limit in force on that day (5 before 2026-11-24, cfg.maxSetups after).
  const by = {};
  (setups.dip || []).filter(x => x.sp500 && x.sessionsAgo >= 1 && x.sessionsAgo <= 3 && (!cfg.callsFrom || String(x.signalDate) >= cfg.callsFrom)).forEach(x => (by[x.sessionsAgo] = by[x.sessionsAgo] || []).push(x));
  const prior = new Map(), out = [];
  Object.keys(by).map(Number).sort((a, b) => b - a).forEach(k => {
    const day = by[k].sort(sortLive).filter(x => { const p = prior.get(x.ticker); return !p || (1 - x.close / p.close) * 100 > 4; }).slice(0, String(by[k][0].signalDate) < '2026-11-24' ? 5 : cfg.maxSetups);
    day.forEach(x => { prior.set(x.ticker, { close: x.close }); out.push({ ...x, day: k }); });
  });
  return out.sort((a, b) => a.day - b.day);
}

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
  return `That is today's screen. ${cfg.disclaimer} If this was useful, hit like, subscribe to ${cfg.channelName}, and tap the bell for the next one.`;
}


const weekday = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
// NYSE closures (update each year). Early close = 1pm ET.
const HOLIDAYS = { '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Presidents' Day", '2026-04-03': 'Good Friday', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day', '2026-11-26': 'Thanksgiving', '2026-12-25': 'Christmas Day' };
const EARLY = { '2026-11-27': 'the day after Thanksgiving', '2026-12-24': 'Christmas Eve' };
// Fed rate decisions (second day of each meeting), 2026 schedule
const FOMC = { '2026-01-28': 1, '2026-03-18': 1, '2026-04-29': 1, '2026-06-17': 1, '2026-07-29': 1, '2026-09-16': 1, '2026-10-28': 1, '2026-12-09': 1 };
const isoOf = d => d.toISOString().slice(0, 10);
function nextSessionIso(iso) { const d = new Date(`${iso}T12:00:00Z`); do { d.setUTCDate(d.getUTCDate() + 1); } while ([0, 6].includes(d.getUTCDay()) || HOLIDAYS[isoOf(d)]); return isoOf(d); }
const fullDay = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).replace(/^(\w+),? /, '$1 ');
function nextSessionFull(iso) { return fullDay(nextSessionIso(iso)); }
function nextSessionName(iso) { return weekday(nextSessionIso(iso)); }
/** Verified calendar facts for the next session: built-in closures/Fed days plus anything in content/events.json */
function eventsFor(asOf, file) {
  const nx = nextSessionIso(asOf), out = [];
  const d = new Date(`${asOf}T12:00:00Z`);
  for (;;) { d.setUTCDate(d.getUTCDate() + 1); const k = isoOf(d); if (k >= nx) break; if (HOLIDAYS[k]) out.push(`US markets are closed on ${fullDay(k)} (${HOLIDAYS[k]})`); }
  if (EARLY[nx]) out.push(`${fullDay(nx)}: the market closes early, at 1pm New York time (${EARLY[nx]})`);
  if (FOMC[nx]) out.push(`${fullDay(nx)}: the US central bank announces its interest-rate decision`);
  const extra = file && file[nx];
  if (extra && Array.isArray(extra.items)) extra.items.forEach(t => out.push(String(t)));
  return { nx, items: out, source: (extra && extra.source) || '', headsUp: (extra && extra.headsUp) || '' };
}
const sentences = t => String(t).split(/(?<=[.!?])\s+(?=[A-Z0-9'"“$])/).map(x => x.trim()).filter(Boolean);
function weekLine(m) {
  if (!m) return '';
  const parts = [];
  if (isNum(m.chg5d)) parts.push(`${m.chg5d >= 0 ? 'rose' : 'fell'} ${say(m.chg5d)} over the last five sessions`);
  if (isNum(m.chg20d)) parts.push(`is ${m.chg20d >= 0 ? 'up' : 'down'} ${say(m.chg20d)} over the last 20`);
  return parts.length ? `The S&P 500 ${parts.join(' and ')}.` : '';
}

function nearTrigger(status, exclude, members) {
  const mem = Array.isArray(members) ? new Set(members) : null;
  return Object.entries(status || {}).filter(([t]) => !mem || mem.has(t)).map(([t, v]) => ({ ticker: t, close: v[0], r5: v[1], vs200: v[2], rsi: v[3] }))
    .filter(x => isNum(x.r5) && isNum(x.vs200) && x.vs200 > 0 && x.r5 <= -6.5 && x.r5 > -10 && !exclude.has(x.ticker))
    .sort((a, b) => a.r5 - b.r5).slice(0, 6);
}

function marketLine(market) {
  if (!market || !isNum(market.chg20d)) return '';
  const d = market.chg20d;
  return d <= 0 ? `The S&P 500 is down ${say(d)} over the past 20 sessions, the kind of backdrop where dips have been more common.` : `The S&P 500 is up ${say(d)} over the past 20 sessions.`;
}


const NAMES = require('./names');
const ORD = ['one', 'two', 'three', 'four', 'five'];
const AI_NAMES = ['NVDA', 'AMD', 'AVGO', 'MU', 'SMCI', 'PLTR', 'MSFT', 'GOOGL', 'META', 'AMZN', 'ORCL', 'TSM', 'ARM', 'ANET', 'VRT', 'DELL', 'CRWV', 'COHR', 'LRCX', 'AMAT', 'KLAC', 'INTC', 'QCOM', 'NOW', 'CEG', 'VST'];

function pickNarration(x, i, wd, nx) {
  const p = plan(x), nm = NAMES[x.ticker] ? `${NAMES[x.ticker]}, ticker ${x.ticker}` : x.ticker;
  const stopDist = Math.abs((p.stop / x.close - 1) * 100);
  const rs = x.reasons || [];
  const rsent = [rs.includes('closed near the day’s low') ? `it closed right near the low of the day` : null, rs.includes('new 20-day low') ? 'it made a fresh 20-day low' : null, rs.includes('3 down days in a row') ? 'it has now fallen three days in a row' : null].filter(Boolean);
  const cap = rsent.length ? `And the selling looks exhausted, because ${rsent.join(', and ')}.` : 'And the short-term selling looks stretched.';
  const bear = x.priority === 0 ? ' It also printed a bearish engulfing candle, which is the pattern our testing ranked highest.' : '';
  const rsi5 = isNum(x.rsi5) ? ` The 5-day RSI is down at ${Math.round(x.rsi5)}, which tells us the selling is stretched.` : '';
  const vol = isNum(x.relVol) && x.relVol >= 1.2 ? ` Volume was ${x.relVol.toFixed(1)} times its average.` : '';
  const wide = i === 0 ? ` Look at that stop. It's ${Math.round(stopDist)} percent below ${wd}'s close. That's because this stock moves about ${x.atrPct.toFixed(0)} percent on a normal day, and the stop sits three times that range away. It's exactly why we keep positions small and never use leverage.` : ` The stop is ${Math.round(stopDist)} percent below the close, so again, small size.`;
  return `${i === 0 ? 'Number one' : `Number ${ORD[i]}`}: ${nm}. It closed ${wd} at ${money(x.close)}, down ${say(x.chg5d)} over five sessions. But it's still ${say(x.vs200)} above its 200-day average, so the bigger trend is intact. ${cap}${bear}${rsi5}${vol} The plan: wait three to five minutes after the ${nx} open, and only enter if it's within 2 percent of ${money(x.close)}. The target is ${money(p.target)}, the stop is ${money(p.stop)}, and the latest exit is the close of day three.${wide}`;
}

function buildWelcome({ setups, config, news }) {
  const cfg = config, asOf = setups.asOf, scenes = [], m = setups.market || {};
  const wd = weekday(asOf), nx = nextSessionName(asOf), nxd = nextSessionFull(asOf);
  const dipSp = (setups.dip || []).filter(x => x.sessionsAgo === 0 && x.sp500).sort(sortLive);
  const top = dipSp.slice(0, 5);
  const add = (id, type, heading, narration, points, data = {}) => scenes.push({ id, type, heading, narration, points, data, dur: Math.max(7, Math.round((words(narration) / cfg.speakingWordsPerSecond + 1.5) * 10) / 10) });
  const ch = cfg.channelName;
  const rows = top.map(x => ({ ticker: x.ticker, kind: x.kind, chg5d: x.chg5d, vs200: x.vs200, rsi: x.rsi, close: x.close, stopDist: (plan(x).stop / x.close - 1) * 100 }));
  const minStop = rows.length ? Math.floor(Math.min(...rows.map(r => Math.abs(r.stopDist)))) : null;
  const maxStop = rows.length ? Math.round(Math.max(...rows.map(r => Math.abs(r.stopDist)))) : null;

  add('intro', 'intro', 'Welcome to The 4% Swing Trades',
    `Hi everyone, I'm Bharat, and welcome to ${ch}. This is our very first video, so let me tell you what we're doing here, how the strategy works, and how to use it safely. Then we'll look at what the market did this week, and the five best signals the screener found for ${nx}.`,
    ["Hi, I'm Bharat", `Welcome to ${ch}: signals for ${nxd}`, 'What the channel is, how it works, how to use it safely', `This week's market, and ${nx}'s top five`],
    { date: `Based on the ${dayShort(asOf)} close`, kicker: `Signals for ${nxd}`, chips: ['S&P 500 signals every weekday', 'Weekly review on Fridays'], market: m });

  add('channel', 'bullets', 'WHAT THIS CHANNEL IS FOR',
    `So, what is this channel? Every weekday after the US market closes, I run one screen across the S&P 500, and I show you exactly what it found, with the reasons behind every pick. On Fridays, I'll also do a weekly review: what the market did, and what I'm watching next. It's one strategy, one process, the same every day. I won't hype stocks, and I won't predict prices. The goal is simple: show you a clear, tested way to look at pullbacks in strong stocks, and let you decide what to do with it.`,
    ['One screen of S&P 500 stocks, every weekday after the close', 'Every pick comes with its reasons', 'Fridays: weekly review and what to watch', 'No hype, no price predictions'],
    { kick: 'THE CHANNEL', title: 'What you get here', items: ['One screen of S&P 500 stocks, every weekday after the close', 'The reasons and the chart behind every pick', 'A weekly review and watch list on Fridays', 'Education only: no hype, no price predictions'] });

  add('proof', 'proof', 'HOW STRONGLY IT IS TESTED',
    `Now, you might ask: why should you trust it? Because it has been tested properly. It was run over ten years of S&P 500 history, from October 2016 to November 2026. That's more than 2,600 signals. About ${cfg.backtest.winRate} percent of them finished as winners, with an average of ${cfg.backtest.avgPct} percent per trade, before costs. But here's the part I'm proudest of. I tried more than 45 ways to improve it: different stops, different position sizes, different ranking rules. I set the pass mark before looking at any results, and I kept the most recent three years as a final exam that I didn't touch while tuning. Only one change survived: smaller position sizes. Everything else failed, so I threw it out. That's what an honestly tested strategy looks like. It still isn't a guarantee, past results never are, and about one in three trades loses. But you're getting a process, not a lucky story.`,
    ['10 years of S&P 500 history, Oct 2016 to Nov 2026', '2,600+ signals tested', `${cfg.backtest.winRate}% winners, ${cfg.backtest.avgPct}% average per trade, before costs`, '45+ ideas tried: only one survived (smaller size)', 'Final exam on the latest 3 years, untouched while tuning', 'Not a guarantee: about 1 in 3 trades loses'],
    { winRate: cfg.backtest.winRate, avgPct: cfg.backtest.avgPct });

  add('rules', 'rules', 'HOW THE SCREEN WORKS',
    `Here's how the screen works. It looks for three things in the same stock. One: the stock is in an uptrend, meaning the price is above its 200-day average. Two: it has dropped sharply, down at least 10 percent over five sessions. And three: the selling looks exhausted. That means it closed near the low of the day, or it hit a new 20-day low, or it has fallen three days in a row. Strong stocks that get sold hard often bounce within a few days. That's the whole idea.`,
    ['1. Uptrend: price above the 200-day average', '2. Sharp drop: down 10%+ over five sessions', '3. Exhausted selling: closed near the low, new 20-day low, or 3 down days', 'Idea: strong stocks sold hard often bounce within days'], {});

  const ai = (setups.aiHealth || []).slice().sort((a, b) => a.vs200 - b.vs200);
  const aiPicked = ai.filter(a => top.concat(dipSp).some(x => x.ticker === a.ticker));
  const below = ai.filter(a => a.vs200 < 0).length, nv = ai.find(a => a.ticker === 'NVDA');
  const above = ai.filter(a => a.vs200 >= 0).map(a => NAMES[a.ticker] || a.ticker);
  if (ai.length >= 10 && !aiPicked.length) {
    add('ai', 'ai', 'WHY NO AI STOCKS',
      `One thing I want to be very clear about. This screen only picks stocks that are in an uptrend and have dipped. It does not pick stocks that are already in a downtrend, because a stock that keeps falling inside a downtrend isn't a dip. It's a falling stock. That's why this week, our screener didn't pick a single AI stock. And that isn't because they're AI. It's because they're not healthy. I checked ${ai.length} of the biggest AI and chip names, and ${below} of them closed ${wd} below their 200-day average, many by thirty or forty percent. ${nv ? `${NAMES.NVDA}, for example, is ${Math.round(Math.abs(nv.vs200))} percent below it.` : ''} ${above.length ? `The ${above.length === 1 ? 'one' : 'ones'} still above it, ${above.join(' and ')}, simply haven't dropped enough to trigger.` : ''} The screen isn't against AI. It just wants strength that got sold, not weakness that keeps falling.`,
      [`Only uptrend stocks that dipped`, `This week: no AI stock was picked, not because it's AI, but because they're not healthy`, `${below} of ${ai.length} big AI and chip names are below their 200-day average`, 'Strength that got sold, not weakness that keeps falling'],
      { ai, below, total: ai.length });
  } else {
    add('skips', 'bullets', 'WHAT THE SCREEN SKIPS',
      `One thing I want to be very clear about. This screen only picks stocks that are in an uptrend and have dipped. It does not pick stocks that are already in a downtrend, because a stock that keeps falling inside a downtrend isn't a dip. It's a falling stock. The screen wants strength that got sold, not weakness that keeps falling.`,
      ['Only uptrend stocks that dipped', 'Skips downtrends: a falling stock is not a dip'], { kick: 'THE FILTER', title: 'What the screen skips', items: ['Stocks below their 200-day average: downtrends', 'Falling stocks with no uptrend behind them', 'It only wants strong stocks that got sold hard'] });
  }

  add('steps', 'steps', 'HOW TO USE A SIGNAL',
    `Now, the rules for using a signal. The screen prints after the close, so a ${wd} signal is for ${nx}. Step one: don't rush the open. Wait three to five minutes after the market opens, so the first chaos settles. Step two: only enter if the price is still within 2 percent of ${wd}'s close. If it gapped higher than that, skip it. Step three: the tested target is 4 percent above ${wd}'s close, and the stop is three ATR below, which is about three times the stock's normal daily range. Step four: don't hold forever. Exit at the close of the third trading day at the latest, whatever happens. And keep every position small.`,
    [`Signal prints after the close: ${wd}'s list is for ${nx}`, 'Wait 3 to 5 minutes after the open', `Enter only if within 2% of ${wd}'s close, otherwise skip`, `Target +4% above ${wd}'s close, stop 3 ATR below`, 'Exit by the close of day 3, whatever happens', 'Keep every position small'],
    { items: [{ t: 'The signal prints after the close', s: `${wd}'s list is for ${nx}'s open` }, { t: 'Wait 3 to 5 minutes after the open', s: 'Let the opening chaos settle first' }, { t: `Enter only within 2% of ${wd}'s close`, s: 'Gapped up further than that? Skip it' }, { t: `Target +4% above ${wd}'s close, stop 3 ATR below`, s: "ATR is the stock's typical daily range" }, { t: 'Exit at the close of day 3', s: 'Whatever the result' }] });

  add('warn', 'warn', 'NEVER USE LEVERAGE',
    `And now, the most important rule. Never, ever use leverage with these signals. No margin, no leveraged ETFs, no options, nothing that multiplies your losses. Here's why. In this strategy, the stop is far away, much farther than in most trading strategies, because we give a strong stock room to bounce. ${minStop ? `On every one of ${nx}'s top five, the stop is at least ${minStop} percent below the price, and on one of them it's about ${maxStop} percent.` : ''} With leverage, a normal stop-out could wipe out a big part of your account, or all of it. Without leverage, it's a manageable loss. So: no leverage, small position sizes, and only money you can afford to lose.`,
    ['Never use leverage: no margin, no leveraged ETFs, no options', 'The stop is far away on purpose, to give a strong stock room to bounce', minStop ? `${nx}'s top five: stops are ${minStop}% to ${maxStop}% below the price` : 'Stops are much wider than in most strategies', 'Small size, and only money you can afford to lose'],
    { minStop, maxStop, nx });

  if (isNum(m.chg5d) || isNum(m.chg20d)) {
    const w5 = isNum(m.chg5d) ? `The S&P 500 ${m.chg5d >= 0 ? 'rose' : 'fell'} ${say(m.chg5d)} over the last five sessions` : '';
    const w20 = isNum(m.chg20d) ? `${w5 ? ', and it is' : 'The S&P 500 is'} ${m.chg20d >= 0 ? 'up' : 'down'} ${say(m.chg20d)} over the last twenty` : '';
    const f = news && news.asOf === asOf ? news : null;
    add('market', 'market', 'THIS WEEK IN THE MARKET',
      `Let's look at the market this week, and honestly, it was rough. ${w5}${w20}.${f ? ` On Friday alone, it dropped ${say(f.spxFridayPct)}, closing near ${f.spxClose}, and it's now officially in a correction, more than 10 percent below the record it set on ${f.recordDate}. It was the ${f.losingStreak === 7 ? 'seventh' : f.losingStreak + 'th'} straight losing session, and the worst week in more than eighteen months. The Nasdaq did even worse.` : ''}`,
      [isNum(m.chg5d) ? `S&P 500, 5 sessions: ${m.chg5d >= 0 ? '+' : '−'}${Math.abs(m.chg5d).toFixed(1)}%` : null, isNum(m.chg20d) ? `20 sessions: ${m.chg20d >= 0 ? '+' : '−'}${Math.abs(m.chg20d).toFixed(1)}%` : null, f ? `Friday: ${f.spxFridayPct}%, officially a correction` : null, f ? `${f.losingStreak} straight losing sessions` : null].filter(Boolean), { market: m });
    if (f) {
      add('why', 'bullets', 'WHY THE MARKET SOLD OFF',
        `So what happened? Mainly one thing: AI. Investors started doubting whether the huge spending on AI can ever pay off, and the bubble fears took over. On Friday, Nvidia fell about ${f.nvdaFridayPct} percent, AMD, Micron and Broadcom each fell more than twelve percent, and the semiconductor index lost nearly eleven percent in a single day. The Nasdaq fell ${say(f.nasdaqFridayPct)} and is now negative for the year. After this month's midterm elections, there's also worry that politics could slow data center building. Here's an interesting detail, though: outside tech, most stocks actually rose on Friday. This was an AI sell-off, more than a market-wide panic.`,
        ['The cause: AI bubble fears. Will the huge AI spending pay off?', `Friday: Nvidia −${f.nvdaFridayPct}%, chip index −${f.chipIndexFridayPct}%`, `Nasdaq −${Math.abs(f.nasdaqFridayPct)}%, negative for 2026`, 'Midterm results: worry that politics could slow data center building', 'Outside tech, most stocks rose on Friday'],
        { kick: 'THE REASONS', title: 'Why the market sold off', items: ['AI bubble fears: will the huge spending pay off?', `Friday: Nvidia −${f.nvdaFridayPct}%, chip index −${f.chipIndexFridayPct}%`, `Nasdaq −${Math.abs(f.nasdaqFridayPct)}% and negative for 2026`, 'Midterm results: worry about slower data center building', 'Outside tech, most stocks actually rose'] });
    }
  }

  if (top.length) {
    const names = top.map(x => NAMES[x.ticker] || x.ticker); const lst = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    add('monday', 'summary', `${nx.toUpperCase()}'S TOP ${top.length}`,
      `So here's what the screener found for ${nx}. ${dipSp.length} S&P 500 stocks passed the screen, which is a lot, and honestly too many to trade well. So I'm only going to show you the top ${top.length}, using the same ranking we tested: the strongest setups first, then the ones sitting furthest above their 200-day average. Those ${top.length} are ${lst}. Let's go through them one by one, with the chart and the reasons.`,
      [`${dipSp.length} S&P 500 stocks passed ${wd}'s screen`, `Too many to trade well: showing the top ${top.length}`, lst, 'Same ranking we tested'],
      { rows, kick: `FOR THE OPEN ON ${nxd.toUpperCase()}`, title: `Top ${top.length} of ${dipSp.length} signals`, note: `${dipSp.length} passed the screen. These are the top ${top.length} by our tested ranking.` });
    top.forEach((x, i) => add(`setup-${x.ticker}`, 'setup', x.ticker, pickNarration(x, i, wd, nx),
      [`#${i + 1}: ${NAMES[x.ticker] || x.ticker} (${x.ticker})`, `${wd}'s close ${money(x.close)}, ${x.chg5d.toFixed(1)}% in 5 days, still ${x.vs200.toFixed(0)}% above the 200-day`, (x.reasons || []).join(', ') || 'selling looks stretched', `Target ${money(plan(x).target)}, stop ${money(plan(x).stop)} (${Math.abs((plan(x).stop / x.close - 1) * 100).toFixed(0)}% below)`, 'Wait 3 to 5 minutes after the open, within 2% of the close'],
      { setup: x, plan: plan(x), rank: i + 1, total: dipSp.length }));
  } else {
    add('monday', 'text', 'NO SIGNALS FOR ' + nx.toUpperCase(), `The screen did not find any S&P 500 signals at ${wd}'s close, which is a perfectly normal outcome. No signal means no trade.`, ['No S&P 500 signals today', 'No signal means no trade'], {});
  }

  add('expect', 'bullets', 'WHAT TO EXPECT',
    `So, what can you expect from this channel? A new video every weekday after the close, and a weekly review on Fridays. I'll always show the reasons, the chart and the levels. I'll always be honest about the numbers, and losses will happen. Some weeks will look great, and some will hurt, like this one. Nothing here is financial advice. I'm sharing a tested process for education, so please do your own research, keep your position sizes small, and remember: no leverage. If that sounds useful, subscribe, so you don't miss the next signals, and I'll see you after the next close.`,
    ['A new video every weekday after the close', 'Friday: weekly review and what to watch', 'Reasons, charts and levels every time', 'Honest numbers: losses happen and can cluster', 'Not advice: do your own research, small size, no leverage'],
    { kick: 'SETTING EXPECTATIONS', title: 'What to expect', items: ['A video every weekday after the close', 'A weekly review and watch list on Fridays', 'Reasons, charts and levels every time', 'Honest numbers: losses happen, and they can cluster', 'Education only. Never leverage.'] });

  add('outro', 'outro', 'THANKS FOR WATCHING', `Thanks for watching. ${cfg.disclaimer} Hit like, subscribe to ${ch}, and tap the bell. See you after the next close.`, ['Thanks for watching', 'Subscribe so you catch the next one', 'See you after the next close'], { disclaimer: cfg.disclaimer });

  return { mode: 'welcome', title: ((setups.market && setups.market.chg5d <= -3 && top.length) ? `${top.length} S&P 500 Survivors: 4% Swing Trade Signals for ${nxd}` : `S&P 500 Dip Signals for ${nxd}: ${top.length || ''} Swing Trade Picks`).replace('  ', ' '), nxd, date: dayShort(asOf), asOf, scenes, tickers: top.map(x => x.ticker).slice(0, 3), cfg, news };
}

function buildEpisodeInner({ mode, setups, config }) {
  if (mode === 'bottom') return buildBottom({ setups, config });
  if (mode === 'welcome') return buildWelcome({ setups, config, news: setups.__news });
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
    const watch = nearTrigger(setups.status, new Set(live.map(x => x.ticker)), setups.__sp500);
    add('watch', 'watch', 'WHAT TO WATCH NEXT WEEK', `Not a forecast, just a watch list. ${marketLine(setups.market)} ${watch.length ? `These stocks are still above their 200-day average and have fallen between six and a half and 10 percent over five sessions, so one more down day could trigger the screen: ${watch.map(x => spell(x.ticker)).join(', ')}.` : 'No stocks are currently close to triggering the screen.'} The screen only fires after the close, so nothing here is a signal until it prints.`, { watch, market: setups.market });
    add('stats', 'stats', 'WHAT HISTORY SAYS', statsText(cfg), { winRate: cfg.backtest.winRate, avgPct: cfg.backtest.avgPct, period: cfg.backtest.period });
    add('outro', 'outro', 'THANKS FOR WATCHING', outroText(cfg), { disclaimer: cfg.disclaimer });
    return { mode, title, date: dayShort(asOf), asOf, scenes, tickers: [], cfg };
  }

  // ---------------- daily (plain-English briefing) ----------------
  // a stock that was already one of the channel's calls (last 3 sessions) is not suggested again, unless it has since fallen more than 4% below that earlier call's close
  { const prior = new Map(); callRows(setups, cfg).forEach(r => { if (!prior.has(r.ticker)) prior.set(r.ticker, { close: r.close, date: r.signalDate }); });
    featured = dipSp.filter(x => { const p = prior.get(x.ticker); if (!p) return true; const fall = (1 - x.close / p.close) * 100; if (fall > 4) { x._rep = { fall, date: p.date }; return true; } return false; }).slice(0, cfg.maxSetups); }
  const m = setups.market || {}, wd = weekday(asOf), nx = nextSessionName(asOf), nxd = nextSessionFull(asOf), ch = cfg.channelName;
  const news = setups.__news && setups.__news.asOf === asOf ? setups.__news : null;
  const ev = eventsFor(asOf, setups.__events);
  const n = featured.length;
  // fewer than 3 long calls: borrow S&P 500 'rip' signals (short side) to fill up to 3, educational and for experienced traders only
  const shorts = n < 3 ? ripSp.slice(0, 3 - n) : [], nAll = n + shorts.length;
  const dayWord = isNum(m.chg1d) ? (m.chg1d >= 0 ? 'rose' : 'fell') : '';
  const hookT = news && news.hook ? String(news.hook) : '';
  title = n
    ? (hookT && isNum(m.chg1d) && m.chg1d >= 0.5 ? `${hookT} + S&P 500 ${dayWord} ${pct(m.chg1d)}: ${n} Stock${n === 1 ? '' : 's'} to Watch for ${nxd}`.slice(0, 100) : isNum(m.chg1d) && Math.abs(m.chg1d) >= 0.5 ? `S&P 500 ${dayWord} ${pct(m.chg1d)} Today: ${n} Stock${n === 1 ? '' : 's'} to Watch for ${nxd}` : `${n} Stock${n === 1 ? '' : 's'} to Watch for ${nxd}: S&P 500 Daily Briefing`)
    : shorts.length ? `S&P 500 Daily Briefing for ${nxd}: ${shorts.length} Short-Side Idea${shorts.length === 1 ? '' : 's'}, No Long Signals` : `S&P 500 Daily Briefing for ${nxd}: no signals today`;
  const hl = news && news.highlight ? String(news.highlight).replace(/[.]$/, '') : '';
  const big = isNum(m.chg1d) && m.chg1d >= 1.5;
  const hookState = isNum(m.chg1d) ? `The S&P 500 ${dayWord} ${say(m.chg1d)} today, and ` : '';
  const found = (n ? `${n} stock${n === 1 ? '' : 's'} made it through my screen for ${nx}.` : 'nothing made it through my screen on the long side for ' + nx + '.') + (shorts.length ? ` ${n ? 'Plus' : 'But there are'} ${shorts.length} short-side idea${shorts.length === 1 ? '' : 's'}, which I'll explain.` : '');
  const note = news && news.introNote ? ' ' + String(news.introNote).trim() : '';
  const introNarr = big
    ? `Hey everyone, welcome back to ${ch}! It's ${date}.${note} Guys, what a day today. What a day! Fantastic. ${hl ? `The big news of the day, and maybe of the last few months, has really pushed the S&P 500: it ${dayWord} ${say(m.chg1d)}.` : `The S&P 500 ${dayWord} ${say(m.chg1d)}.`} ${n ? `And ${found}` : `But ${found}`} Let's get into it.`
    : `Hey everyone, welcome back to ${ch}! It's ${date}.${note} Here's the quick version: ${hookState}${found} Over the next few minutes we'll look at what the market did today in plain English, check how my earlier picks have done, ${n ? `go through each pick and the plan for it, ` : ''}and see what's coming up tomorrow.`;
  add('intro', 'intro', 'DAILY BRIEFING', introNarr,
    { date: dayShort(asOf), kicker: `Briefing for ${nxd}`, chips: [isNum(m.chg1d) ? `S&P 500 ${m.chg1d >= 0 ? '+' : '−'}${Math.abs(m.chg1d).toFixed(1)}% today` : 'Daily briefing', `${n} stock${n === 1 ? '' : 's'} for ${nx}`, 'Scorecard included'], market: m });

  // 1) the market today
  const mkt = [];
  const aiLed = isNum(m.chg1d) && isNum(setups.__aiDay) && setups.__aiDay >= Math.max(1.5, m.chg1d + 0.5);
  if (isNum(m.chg1d)) mkt.push(`So, what did the market do today? The S&P 500 ${dayWord} ${say(m.chg1d)}.${isNum(m.range1d) && m.range1d >= 1 ? ` And it was a big swing: from the low of the day to the high, the index moved about ${say(m.range1d)}, so a lot of people got shaken out.` : ''}`);
  if (hl && isNum(m.chg1d) && m.chg1d >= 1) mkt.push(`And this wasn't just a relief bounce after last week's sell-off. ${aiLed ? 'It came with real news, and the AI chip stocks led the way' : 'Real news was a big part of it'}: ${hl}.`);
  else if (hl) mkt.push(`And the big story today: ${hl}.`);
  if (isNum(m.chg5d)) mkt.push(`Zoom out to the last five trading days, and it's ${m.chg5d >= 0 ? 'up' : 'down'} ${say(m.chg5d)}.`);
  const heads = news && Array.isArray(news.headlines) ? news.headlines.filter(Boolean).slice(0, 4) : [];
  mkt.push((isNum(m.chg5d) && m.chg5d <= -3) || (isNum(m.chg1d) && m.chg1d >= 1 && isNum(m.chg5d) && m.chg5d < 0) ? (isNum(m.chg1d) && m.chg1d > 0 ? "Last week's sell-off dragged even good companies down along with the weak ones, and that is exactly where my screen goes hunting." : "When the market drops like this, even good companies get dragged down along with the weak ones. And that is exactly where my screen goes hunting.") : "My screen looks for strong companies, stocks that are still in long-term uptrends, that have just had a short, sharp sell-off. So on a day like this, the question is whether the sell-off pushed any of them into that zone.");
  add('market', 'market', "TODAY'S MARKET", mkt.join(' '), { market: m });
  if (heads.length) add('news', 'bullets', 'WHAT MOVED THE MARKET', `So what was going on behind the scenes? ${heads.map(h => h.replace(/[.]$/, '') + '.').join(' ')}`, { kick: 'WHAT WAS BEHIND IT', title: 'What moved the market', items: heads });

  // 1b) when the market has been hit: is this the bottom? the six-sign checklist from the market-bottom video, applied to today's close
  { const A = setups.__bottom, cur = A && A.cur, dd = A && A.now ? A.now.dd : 0;
    if (cur && (dd <= -0.05 || (news && news.badNews)) && cur.date === asOf) {
      const badDay = !!(news && news.badNews && isNum(m.chg1d) && m.chg1d < 0 && cur.items && cur.items[5]);
      if (badDay) cur.items[5] = { ...cur.items[5], ok: false, note: 'Bad news pushed stocks back down' };
      if (hl && news && news.closeNote && isNum(m.chg1d) && m.chg1d >= 1 && cur.items && cur.items[5]) cur.items[5] = { ...cur.items[5], ok: true, note: 'Good news held into the close' };
      const labs = BOTTOM_LABS, meas = cur.items.filter(x => x.ok !== null), nOk = meas.filter(x => x.ok).length, sp = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
      const line = (l, i) => `${sp[i]}: ${l.charAt(0).toLowerCase() + l.slice(1).replace('(VIX)', 'V I X')}. ${cur.items[i].ok === null ? (i === 2 ? "I can't measure this one from here, so look it up yourself." : "No big move to judge today, so watch the headlines.") : cur.items[i].ok ? 'Tick.' : 'Not yet.'}`;
      add('bottomcheck', 'compare', 'IS THIS THE BOTTOM? THE CHECKLIST, UPDATED',
        `Now, a question I keep getting: is this the bottom? Nobody can call it exactly, but I have a six-sign checklist from my market-bottom video, so let's hold today's close up against it. The S&P 500 is ${Math.abs(dd * 100).toFixed(0)} percent below its recent high. ${labs.map(line).join(' ')} That's ${nOk} of the ${meas.length} boxes I can measure ticked. ${badDay ? `The last box is the one I'm watching today. Good news did come, but then fresh bad news, ${news.badNews}, pushed stocks right back down. A real bottom is when bad news stops hurting. ${news.bottomNote || 'A bottom is not confirmed yet.'} That's why we stick to the process and keep our size small.` : hl && isNum(m.chg1d) && m.chg1d >= 1 && nOk < meas.length ? `${nOk <= 2 ? 'Most boxes are still empty. ' : 'Not every box is ticked. '}But a major catalyst has now arrived, and that is what a bottom usually needs. So my read is that this is starting to look like a possible bottom, but it is early. Nobody calls the exact low, though, so keep your size small.` : 'One day never makes a bottom, so treat this as a snapshot, not a prediction.'}`,
        { kick: `IS THIS THE BOTTOM? ${fdateShort(cur.date).toUpperCase()}`, title: 'The bottom checklist, updated', rows: labs.map((l, i) => ({ label: l, ok: cur.items[i].ok, note: cur.items[i].note })), summary: `${nOk} of ${meas.length} measurable boxes ticked` });
    } }

  // 2a) what happened to the calls we gave on earlier sessions (days 1-3), projected with the plan's rules
  const calls = Array.isArray(setups.__calls) ? setups.__calls : [];
  let survived = null, tailP = '';
  if (calls.length) {
    const nm = t => NAMES[t] || t, wdOf = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    const taken = calls.filter(c => c.entry != null);
    const groups = [...new Set(calls.map(c => c.signalDate))];
    const callsS = [...calls].sort((a, b) => b.day - a.day); // oldest calls first, then the newer ones
    let lastG = null;
    const lines = callsS.map(c => {
      const gh = groups.length > 1 && c.signalDate !== lastG ? (lastG = c.signalDate, `From ${wdOf(c.signalDate)}'s calls. `) : (lastG = c.signalDate, '');
      if (c.entry == null) return `${nm(c.ticker)} opened at ${money(c.open)}, more than 2 percent above ${wdOf(c.signalDate)}'s close, so the plan says skip it. No chasing.${isNum(c.pct) && c.pct > 0 ? ` It's up ${say(c.pct)} since, so this was the one the rules kept us out of. That's the trade-off of the 2 percent rule.` : ''}`;
      const st = c.state === 'target' ? `It hit the 4 percent target on day ${c.day}, a win.` : c.state === 'stop' ? `It hit the safety exit on day ${c.day}.` : c.state === 'closed' ? `It reached day three and was closed out ${c.pct >= 0 ? 'up' : 'down'} ${say(c.pct)}.` : `It finished at ${money(c.close)}, ${c.pct >= 0 ? 'up' : 'down'} ${say(c.pct)} from there, so we're still holding${c.day < 3 ? ` (day ${c.day} of 3)` : ''}.`;
      return `${gh}${nm(c.ticker)}: you'd have bought at about ${money(c.entry)}. ${st}`;
    });
    const down = taken.filter(c => c.pct < 0).length;
    const rot = hl && aiLed && taken.length >= 2 && down >= taken.length / 2;
    const tail2 = rot ? `So far most of these haven't moved up yet. My read is that money rushed into AI chips, because they finally got a catalyst after a long time. When that happens, other uptrends tend to take a pause. That's normal, and it's why each pick has until day three.` : (taken.length >= 2 && down >= taken.length / 2 ? `So far most of these haven't bounced yet. That's normal: the plan gives each stock until day three.` : '');
    const upN = taken.filter(c => c.pct > 0).length, avgT = taken.length ? taken.reduce((a, c) => a + c.pct, 0) / taken.length : 0;
    const proud = news && news.survive && isNum(m.chg1d) && m.chg1d < 0 && taken.length && upN >= Math.ceil(taken.length / 2) && avgT > 0;
    if (proud) { survived = { up: upN, n: taken.length, avg: avgT };
      const aiD = isNum(setups.__aiDay) && setups.__aiDay < -0.3 ? `, and the AI stocks are down ${say(Math.abs(setups.__aiDay))} too` : '';
      tailP = `Guys, you're going to love this! The S&P 500 is down ${say(Math.abs(m.chg1d))} today${aiD}, and yet look at how our screen's calls are doing: ${upN === taken.length ? 'every single one' : upN + ' of the ' + taken.length} up, on average ${say(avgT)} in the green! That's exactly why we follow a tested, rules-based process, and it's why we survived a big dip day, and even made profits. One day doesn't prove anything, and losses will come, but this is what the process is built for. Let's go through them. `; }
    const when = groups.length === 1 ? `On ${wdOf(groups[0])} I gave you ${calls.length} stock${calls.length === 1 ? '' : 's'}.` : `Let's check the calls I gave you earlier.`;
    const callsNarr = `${tailP}Before today's new picks, let's check what happened to the old ones. ${when} Here's what would have happened if you'd followed the plan. ${lines.join(' ')} ${tailP ? '' : tail2} I'll keep updating these until each one is closed out.`.replace(/\s+/g, ' ');
    add('calls', 'calls', 'WHAT HAPPENED TO OUR CALLS', `${tailP}Before today's new picks, let's check what happened to the old ones. ${when} Here's what would have happened if you'd followed the plan. ${lines.join(' ')} ${tailP ? '' : tail2} I'll keep updating these until each one is closed out.`.replace(/\s+/g, ' '),
      { kick: 'IF YOU FOLLOWED THE PLAN', title: 'What happened to our calls', rows: callsS.map(c => ({ ticker: c.ticker, name: nm(c.ticker) === c.ticker ? '' : nm(c.ticker), entry: c.entry, open: c.open, close: c.close, pct: c.pct, state: c.entry == null ? 'skip' : c.state, day: c.day })) });
    { const wc = t => String(t).split(/\s+/).filter(Boolean).length; scenes[scenes.length - 1].openFrac = tailP ? wc(tailP) / Math.max(1, wc(callsNarr)) : 0; }
    // (the 'full list is in the video' teaser and the 'how we performed' like/subscribe lines are Shorts-only add-on clips, recorded once in the Publish page, not scenes)
  }
  // 2b) a small-channel ask, right BEFORE tonight's calls (the like / subscribe popover fires while it is spoken)
  { const ask = `Before I reveal tonight's calls, a quick word. We're a small channel, and every like and subscribe really helps more people find these videos. So if these calls are genuinely helping you, please tap like and subscribe. It's free, and it keeps the daily briefings coming.`;
    const aw = ask.split(/\s+/), ai = aw.findIndex(x => /^(like|subscribe)/i.test(x.replace(/[^a-z]/gi, '')));
    add('ask', 'bullets', "BEFORE TONIGHT'S CALLS", ask, { kick: 'A SMALL ASK', title: "We're a small channel", items: ['Are these calls helping you?', 'Tap LIKE and SUBSCRIBE: it is free', 'It helps more people find the channel'] });
    const sc = scenes[scenes.length - 1]; sc.pop = true; sc.popAt = ai < 0 ? 0.5 : Math.max(0, Math.min(0.95, ai / aw.length)); }

  if (nAll) {
    // 3) the plan in four steps, once
    if (n) add('plan', 'bullets', 'THE PLAN IN FOUR STEPS',
      `Quick reminder of how every pick works, so I don't repeat myself on each stock. One: after the market opens ${nx}, give it three to five minutes. Two: only buy if the price is still within 2 percent of ${wd}'s closing price. Three: aim to sell at 4 percent above that close, and set a safety exit below, just in case the stock keeps falling. Four: whatever happens, be out by the close of day three. Simple as that. And one more rule: if a stock is already on my list from an earlier day, I won't suggest it again, unless it has fallen more than 4 percent since.`,
      { kick: 'EVERY PICK, SAME PLAN', title: 'The plan in four steps', items: [`Wait 3–5 minutes after the ${nx} open`, `Buy only if the price is within 2% of ${wd}'s close`, 'Aim to sell at +4%. Set a safety exit below', 'Be out by the close of day 3, whatever happens', 'Already on my list? Not repeated, unless it fell 4%+ since'] });
    // 4) the picks
    featured.forEach((x, i) => add(`setup-${x.ticker}`, 'setup', x.ticker, dailyPick(x, i, wd, nx), { setup: x, plan: plan(x), rank: i + 1, total: dipSp.length }));
    shorts.forEach((x, i) => add(`short-${x.ticker}`, 'setup', x.ticker, ripNarration(x), { setup: x, plan: plan(x), rank: n + i + 1, total: nAll }));
    if (nAll < 3) { // fewer than three in total: show the stocks closest to qualifying (only then)
      const near = nearTrigger(setups.status, new Set(featured.map(x => x.ticker)), setups.__sp500).slice(0, 3 - nAll);
      if (near.length) add('closest', 'watch', 'CLOSEST TO QUALIFYING', `Only ${nAll} idea${nAll === 1 ? '' : 's'} made it through tonight, so here are the ones that came closest. ${near.map(x => spell(x.ticker)).join(', ')} are still above their 200-day average and have fallen between six and a half and 10 percent over five sessions. One more down day could trigger the screen, but nothing here is a signal until it prints.`, { watch: near, market: setups.market });
    }
  } else {
    const watch = nearTrigger(setups.status, new Set(), setups.__sp500);
    add('watch', 'watch', 'NOTHING TRIGGERED, WHAT TO WATCH', `Nothing passed my screen today. ${watch.length ? `The stocks closest to qualifying are ${watch.map(x => spell(x.ticker)).join(', ')}.` : ''} No signal means no trade, and that is a perfectly normal day.`, { watch, market: setups.market });
  }

  // 5) tomorrow's calendar (only verified items). Said as "tomorrow", once, with no dates.
  if (ev.items.length) {
    const strip = t => String(t).replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(\s+\d{1,2}\s+[A-Za-z]+)?:\s*/i, '').replace(/\btomorrow\b[:,]?\s*/ig, '').replace(/[.]$/, '').trim();
    const items = ev.items.map(strip).filter(Boolean), up = t => t.charAt(0).toUpperCase() + t.slice(1);
    add('calendar', 'bullets', "TOMORROW'S CALENDAR",
      `Last thing, what's coming up tomorrow. ${items.map(t => up(t) + '.').join(' ')}${ev.headsUp ? ' And a heads-up: ' + String(ev.headsUp).replace(/[.]$/, '') + '.' : ''} Big scheduled events can move the whole market, so it's good to know about them before you trade.`,
      { kick: 'COMING UP TOMORROW', title: 'On the calendar tomorrow', items: items.slice(0, 5).map(up) });
  }
  add('outro', 'outro', 'THANKS FOR WATCHING', `Thanks for watching!${survived ? ' Stick to the process, keep your size small, and we go again.' : ''} If this was useful, hit like, subscribe to ${ch}, and tap the bell icon. See you after the next close.`, { disclaimer: cfg.disclaimer });
  return { mode, title, date: dayShort(asOf), asOf, nxd, scenes, tickers: featured.map(x => x.ticker), cfg, calSource: ev.source, chg1d: m.chg1d, thumbHead: news && news.thumbHead, proud: survived ? `OUR PICKS ARE GREEN` : '', extraTags: [...((news && news.tags) || []), ...(isNum(m.chg1d) && m.chg1d >= 1 ? ['S&P 500 rally'] : [])] };
}

function dailyPick(x, i, wd, nx) {
  const p = plan(x), nm = NAMES[x.ticker] ? `${NAMES[x.ticker]}, ticker ${x.ticker}` : x.ticker;
  const stopDist = Math.abs((p.stop / x.close - 1) * 100), rs = x.reasons || [];
  const tired = [rs.includes('closed near the day’s low') ? 'it closed near the low of the day' : null, rs.includes('new 20-day low') ? 'it hit a fresh 20-day low' : null, rs.includes('3 down days in a row') ? 'it fell three days in a row' : null].filter(Boolean);
  const lead = ['First up', 'Next up', 'Third', 'Number four', 'And last but not least'][i] || `Number ${i + 1}`;
  const rep = x._rep ? ` This one was on my list on ${new Date(`${x._rep.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}, and it has fallen another ${x._rep.fall.toFixed(0)} percent since. That's the only case where I'd even consider adding to it, and only with a small size.` : '';
  return `${lead}: ${nm}. It closed ${wd} at ${money(x.close)}, after dropping ${say(x.chg5d)} in five days. But it's still trading ${say(x.vs200)} above its long-term average, so the bigger picture is still healthy. ${tired.length ? `And the sell-off is starting to look tired: ${tired.join(', and ')}.` : ''}${rep}${i === 0 ? ` One thing to know: its safety exit sits ${Math.round(stopDist)} percent below, because this stock normally swings about ${x.atrPct.toFixed(0)} percent in a day. That's why you keep the size small, and please, never borrow money to trade it.` : ''}`;
}


const BOTTOM_LABS = ['Down 10–20% or more from the high', 'A panic day: heavy volume, then calm', 'Fear gauge (VIX) peaks and starts to fall', 'No new lows: a higher low holds', 'Price back above its 20-day average', 'Bad news ignored, good news holds into the close'];
const fdateShort = t => require('./bottom').fdate(t);
function buildBottom({ setups, config }) {
  const cfg = config, scenes = [], asOf = setups.asOf, ch = cfg.channelName, A = setups.__bottom || null, m = setups.market || {};
  const add = (id, type, heading, narration, data = {}) => scenes.push({ id, type, heading, narration, data, dur: Math.max(6, Math.round((words(narration) / cfg.speakingWordsPerSecond + 1.5) * 10) / 10) });
  const { fdate } = require('./bottom');
  let hl = null; try { const fs = require('fs'), pa = require('path'), dd = pa.join(__dirname, '..', 'content'), f = fs.readdirSync(dd).filter(x => /^highlight-\d{4}-\d\d-\d\d\.json$/.test(x)).sort().pop(); if (f) { const h = JSON.parse(fs.readFileSync(pa.join(dd, f), 'utf8')); if (h.asOf >= asOf && h.headline) hl = h; } } catch (e) { /* no highlight file */ }
  const w = A && A.worst, c = A && A.c, dts = A && A.dates;
  const win = w ? { a: w.win.a, b: w.win.b } : null;
  const fd = i => fdate(dts[i]);
  const sl = (arr, a, b) => arr.slice(a, b + 1);
  const baseWin = () => ({ dates: sl(dts, win.a, win.b), c: sl(c, win.a, win.b) });
  const ix = i => i - win.a;
  const pc = x => `${Math.abs(x * 100).toFixed(0)}`;
  const title = 'How to Spot a Market Bottom: 6 Signs Anyone Can Check (No Jargon)';

  add('intro', 'intro', 'FINDING MARKET BOTTOMS',
    `Hey everyone, welcome back to ${ch}! Today's question is the one everybody asks when the market falls: where is the bottom? Here's the honest answer up front: nobody can call it exactly, and anyone who says they can is guessing. But there are clues that the selling may be running out of steam, and you don't need fancy technical analysis to spot them. I'll show you six of them, with real market history. And if you have very little knowledge about technicals, don't miss the last clue of this video. It's just a common sense prediction, with no complex technicals at all. Let's go.`,
    { date: dayShort(asOf), kicker: "A beginner's guide, no jargon", chips: ['6 simple signs', 'Real market history', 'No predictions'], market: m });

  if (w) {
    const k10 = w.cross[0.10], k20 = w.cross[0.20], k30 = w.cross[0.30];
    const f = (k) => c[w.low] / c[k] - 1;
    const marks = [];
    if (k10) marks.push({ i: ix(k10), label: '−10%: "looks cheap"', sub: `then fell ${pc(f(k10))}% more`, kind: 'warn' });
    if (k20) marks.push({ i: ix(k20), label: '−20%: "even cheaper?"', sub: `then fell ${pc(f(k20))}% more`, kind: 'warn' });
    if (k30) marks.push({ i: ix(k30), label: '−30%: "surely now?"', sub: `then fell ${pc(f(k30))}% more`, kind: 'warn' });
    marks.push({ i: ix(w.low), label: `The real bottom: ${fd(w.low)}`, sub: 'obvious only afterwards', kind: 'good' });
    const bw = baseWin();
    add('myth', 'chartnote', 'THE EXACT BOTTOM IS A MYTH',
      `Let's start with a reality check. This is the S&P 500 in the biggest fall of the last ten years, from ${fd(w.p)} to ${fd(w.low)}. It dropped ${pc(w.depth)} percent in total. Now look at every step down. At minus 10 percent it looked cheap${k10 ? `, and then it fell another ${pc(f(k10))} percent` : ''}. ${k20 ? `At minus 20 it looked even cheaper, and it still fell another ${pc(f(k20))} percent. ` : ''}The real bottom was ${fd(w.low)}, and the only way to know for sure was to wait until it was over. So we don't try to catch the exact bottom. We look for clues that the odds are getting better.`,
      { kick: 'A REAL FALL, STEP BY STEP', title: 'Every step down looked like the bottom', ...bw, marks, col: '#26D0FF', cards: [{ lab: 'TOTAL FALL', val: `−${pc(w.depth)}%`, c: 'down' }, { lab: 'SESSIONS, HIGH TO LOW', val: String(w.low - w.p), c: '' }, ...(k10 ? [{ lab: 'FURTHER FALL AFTER −10%', val: `−${pc(f(k10))}%`, c: 'down' }] : [])] });
  }

  // sign 1: how far has it fallen
  if (A) {
    const n = c.length, a = Math.max(0, n - 130), pk = A.peakIdx[n - 1], now = A.now;
    const start = Math.min(a, Math.max(0, pk - 8));
    const ser = sl(c, start, n - 1), top = c[pk];
    const marks = [{ i: pk - start, label: `Recent high: ${fd(pk)}`, sub: '', kind: 'info' }, { i: n - 1 - start, label: `Now: ${(now.dd * 100).toFixed(1).replace('-', '−')}% from the high`, sub: '', kind: now.dd <= -0.1 ? 'warn' : 'key' }];
    const hl = [{ v: top * 0.9, label: '−10%  CORRECTION' }, { v: top * 0.8, label: '−20%  BEAR MARKET' }].filter(h => h.v >= Math.min(...ser) * 0.96);
    const st = A.stats;
    add('sign1', 'chartnote', 'SIGN 1: HOW FAR HAS IT FALLEN?',
      `Sign one: how far has it fallen? As of the close on ${fdate(now.date)}, the S&P 500 is ${pc(now.dd)} percent below its recent high. Traders call a fall of 10 percent a correction. And a fall of 20 percent is a bear market. ${st ? `Since 2016, there have been ${st.n} falls of 10 percent or more. After the first hit of minus 10, the typical extra fall before the low was about ${pc(st.medFurther)} percent, and three months later the market was higher in ${st.fwdUp} of ${st.fwdN} cases. ` : ''}So a bigger fall means the odds of a bottom getting closer go up. But it's only one clue, never a signal on its own. Down 10 percent, surely that's the bottom, right? Down 20 percent, okay, surely now? Still falling? Maybe 30 percent is the magic number? Plenty of people have burnt their hands thinking every step down was the bottom. Cheap can always get cheaper.`,
      { kick: 'SIGN 1', title: 'How far has it fallen?', dates: sl(dts, start, n - 1), c: ser, marks, hl, col: '#26D0FF', cards: [{ lab: 'NOW, FROM THE HIGH', val: `${(now.dd * 100).toFixed(1).replace('-', '−')}%`, c: now.dd < 0 ? 'down' : '' }, { lab: 'CORRECTION STARTS AT', val: '−10%', c: '' }, { lab: 'BEAR MARKET STARTS AT', val: '−20%', c: '' }] });
  }

  if (w && w.panic > 0) {
    const bw = baseWin(), vol = sl(A.v, win.a, win.b);
    add('sign2', 'chartnote', 'SIGN 2: A PANIC DAY',
      `Sign two: a panic day. Close to a bottom, there's often one day when everybody rushes for the exit: a big drop, on heavy trading volume. In this fall, that was ${fd(w.panic)}, with about ${w.panicRatio.toFixed(1)} times the usual volume. And soon after, the selling dried up, and the low came on ${fd(w.low)}. That was ${Math.max(0, w.low - w.panic)} ${Math.max(0, w.low - w.panic) === 1 ? 'session' : 'sessions'} after the panic day. A panic day isn't the bottom itself, but it's often a washout, where the last nervous sellers give up.`,
      { pair: true, kick: 'SIGN 2', title: 'A panic day: heavy volume, then calm', ...bw, vol, volMark: ix(w.panic), marks: [{ i: ix(w.panic), label: `Panic day: ${fd(w.panic)}`, sub: `${w.panicRatio.toFixed(1)}× the usual volume`, kind: 'key' }, { i: ix(w.low), label: 'The low', sub: fd(w.low), kind: 'good' }], col: '#26D0FF', cards: [{ lab: 'PANIC-DAY VOLUME', val: `${w.panicRatio.toFixed(1)}×`, c: 'up' }, { lab: 'SESSIONS BEFORE THE LOW', val: String(Math.max(0, w.low - w.panic)), c: '' }] });
  }

  if (w && w.vixW) {
    const vv = w.vixW.map(x => (x === null ? undefined : x)), clean = []; let last = vv.find(x => x !== undefined);
    vv.forEach(x => { if (x !== undefined) last = x; clean.push(last); });
    const pk = w.vixPeak, diff = w.low - (win.a + pk), vp = clean[pk];
    add('sign3', 'chartnote', 'SIGN 3: THE FEAR GAUGE',
      `Sign three: the fear gauge. It's called the VIX, and it measures how nervous investors are. When fear peaks and then starts to fall, that's often at, or just before, the market's low. In this fall the VIX peaked at ${vp.toFixed(0)} on ${fd(win.a + pk)}. ${diff > 0 ? `Then the S&P 500 made its low. That came ${diff} ${diff === 1 ? 'session' : 'sessions'} later` : diff < 0 ? `The S&P 500 had already made its low. That came ${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'session' : 'sessions'} before` : 'And the very same day, the S&P 500 made its low'}. Falling fear doesn't prove a bottom, but rising fear definitely says it's not calm yet.`,
      { pair: true, kick: 'SIGN 3', title: 'Fear peaks, then falls', dates: sl(dts, win.a, win.b), c: clean, marks: [{ i: pk, label: `Fear peaks: VIX ${vp.toFixed(0)}`, sub: fd(win.a + pk), kind: 'warn' }, { i: ix(w.low), label: 'S&P 500 low', sub: fd(w.low), kind: 'good' }], col: '#FF3B6B', cards: [{ lab: 'VIX AT ITS PEAK', val: vp.toFixed(0), c: 'down' }, { lab: 'S&P LOW CAME', val: diff === 0 ? 'same day' : `${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'day' : 'days'} ${diff > 0 ? 'later' : 'earlier'}`, c: '' }] });
  }

  add('vixfind', 'search', 'WHERE TO FIND THE VIX',
    `Quick tip, because people always ask: where do you actually find the VIX? It's easy. Open any search engine or finance app, and type: VIX index today. You'll see a number and a little chart. Don't worry about the exact number. As a rough rule of thumb, under about 15 or 20 means things are calm, and 30 or more means investors are properly scared. What matters is the direction. Is the line spiking up, or has it peaked and started to fall? Look at the last few months and compare today with the recent high.`,
    { kick: 'DO IT YOURSELF IN 10 SECONDS', title: 'How to check the fear gauge', query: 'VIX index today' });

  if (w && w.hl > 0) {
    const bw = baseWin();
    add('sign4', 'chartnote', 'SIGN 4: A HIGHER LOW',
      `Sign four: the market stops making new lows. After the bottom, price bounces, then pulls back again, and this time it holds above the old low. Traders call that a higher low. Here, the low was ${fd(w.low)}. Then came a bounce. And then a pullback on ${fd(w.hl)} that stayed above it, which is the higher low. It means sellers are losing their power, because they can't push it down to a new low any more.`,
      { kick: 'SIGN 4', title: 'A higher low: sellers lose their power', ...bw, hlines: [{ v: c[w.low], label: 'THE OLD LOW' }], marks: [{ i: ix(w.low), label: 'The low', sub: fd(w.low), kind: 'warn' }, { i: ix(w.bounce), label: 'The bounce', sub: '', kind: 'info' }, { i: ix(w.hl), label: 'Higher low', sub: `${fd(w.hl)}: it holds`, kind: 'good' }], col: '#26D0FF', cards: [{ lab: 'HIGHER LOW VS OLD LOW', val: `+${((c[w.hl] / c[w.low] - 1) * 100).toFixed(1)}%`, c: 'up' }] });
  }

  if (w && (w.r20 > 0 || w.r50 > 0)) {
    const bw = baseWin(), marks = [{ i: ix(w.low), label: 'The low', sub: fd(w.low), kind: 'warn' }];
    if (w.r20 > 0) marks.push({ i: ix(w.r20), label: 'Back above the 20-day average', sub: `${w.r20 - w.low} sessions after the low`, kind: 'info' });
    if (w.r50 > 0) marks.push({ i: ix(w.r50), label: 'Back above the 50-day average', sub: `${w.r50 - w.low} sessions after the low`, kind: 'good' });
    add('sign5', 'chartnote', 'SIGN 5: BACK ABOVE THE AVERAGE',
      `Sign five: price climbs back above its short-term average, and stays there. The 20-day average is simply the average price of the last 20 days, and the 50-day is the same over 50 days. ${w.r20 > 0 ? `Here is the low, on ${fd(w.low)}. The market got back above its 20-day average ${w.r20 - w.low} ${w.r20 - w.low === 1 ? 'session' : 'sessions'} after the low.` : ''}${w.r50 > 0 ? ` And it got back above its 50-day average after ${w.r50 - w.low} ${w.r50 - w.low === 1 ? 'session' : 'sessions'}.` : ''} Notice that this sign is late. You won't catch the exact bottom with it. But it filters out a lot of false alarms.`,
      { pair: true, kick: 'SIGN 5', title: 'Price takes back its averages', ...bw, ma20: sl(A.s20, win.a, win.b), ma50: sl(A.s50, win.a, win.b), marks, col: '#26D0FF', cards: [...(w.r20 > 0 ? [{ lab: 'TO RETAKE THE 20-DAY', val: `${w.r20 - w.low} sessions`, c: 'up' }] : []), ...(w.r50 > 0 ? [{ lab: 'TO RETAKE THE 50-DAY', val: `${w.r50 - w.low} sessions`, c: 'up' }] : [])] });
  }

  add('sign6', 'newstest', 'SIGN 6: THE NEWS TEST',
    `Sign six is the one I think matters most, and it's about how the market reacts to news. While the market is still falling, good news doesn't work. A stock pops before the open, and by the close it has faded. And bad news makes things worse. Near a bottom, it flips. Bad news gets shrugged off: stocks dip, then recover. And good news sticks: it pops, and holds all the way to the close, instead of fading. So don't just read the headline. Watch whether the close agrees with it.`,
    { kick: 'SIGN 6', title: 'The news test' });

  add('example', 'bullets', 'REAL EXAMPLE: NVIDIA, 17 NOVEMBER 2026',
    `Here's a real example from last week. On November 17, Nvidia said it expected sales well above what Wall Street was forecasting. The shares jumped nearly 5 percent after the close. But, according to Reuters, the rally soon wavered, because investors were worried about who will be the next CEO. That's great news that did not hold. It doesn't tell us where the bottom is. It tells us the market isn't ready to look past its worries yet. And the opposite is what you watch for: bad headlines that no longer push prices down.${hl ? ` And here's the twist: on ${fdate(hl.asOf)}, ${String(hl.headline).replace(/[.]$/, '')}. ${hl.closeNote ? `So did it pass the news test? It did. ${String(hl.closeNote).replace(/[.]$/, '')}. Good news that holds is one of the signs to look for, but one day still doesn't make a bottom.` : 'Now the same test applies: does that jump hold into the close, or fade?'}` : ''}`,
    { kick: 'REAL EXAMPLE, 17 NOV 2026', title: 'Nvidia: good news that did not hold', items: ['Nvidia forecast sales well above Wall Street estimates', 'Shares jumped nearly 5% after the close', 'The rally soon wavered: investors worried about who will be the next CEO', 'Good news that fades says the market is not ready yet'].concat(hl ? [`Update, ${fdate(hl.asOf)}: ${hl.headline}.${hl.closeNote ? ' ' + String(hl.closeNote).replace(/[.]$/, '') + '. It held.' : ' Same test: does it hold into the close?'}`] : []), note: 'Source: Reuters analysis, 20 Nov 2026. An example of the news test, not a prediction.' });

  const labs = BOTTOM_LABS;
  const cur = A && A.cur ? A.cur : null;
  if (cur) {
    const meas = cur.items.filter(x => x.ok !== null), nOk = meas.filter(x => x.ok).length, asd = fdate(cur.date);
    const sp = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
    const verdict = x => (x.ok === true ? 'ticked' : x.ok === false ? 'not yet' : 'for you to judge');
    add('checklist', 'compare', 'THE BOTTOM CHECKLIST: NOW VS THE CHECKLIST',
      `So here's your checklist, and let's hold today's market up against it, using prices up to ${asd}. ${labs.map((l, i) => `${sp[i]}: ${l.charAt(0).toLowerCase() + l.slice(1).replace('(VIX)', 'V I X')}. ${cur.items[i].ok === null ? (i === 2 ? "I can't measure this one from here, so look it up yourself." : 'This one is for you to judge from the headlines.') : cur.items[i].ok ? 'Tick.' : 'Not yet.'}`).join(' ')} That's ${nOk} of the ${meas.length} boxes I can measure ticked. Ticking one box means very little. Ticking four or five means the odds are improving. It never means certainty, and this is a snapshot, not a prediction.`,
      { kick: `THE MARKET AS OF ${asd.toUpperCase()}`, title: 'Ticking the boxes today', rows: labs.map((l, i) => ({ label: l, ok: cur.items[i].ok, note: cur.items[i].note })), summary: `${nOk} of ${meas.length} measurable boxes ticked` });
  } else {
    add('checklist', 'bullets', 'THE BOTTOM CHECKLIST',
      `So here's your checklist. One: down 10 to 20 percent or more from the high. Two: a panic day with huge volume, then calm. Three: the fear gauge peaks and starts to fall. Four: no new lows, with a higher low that holds. Five: price back above its 20-day average. Six: bad news ignored, and good news holding into the close. Ticking one box means very little. Ticking four or five means the odds are improving. It never means certainty.`,
      { kick: 'TICK THE BOXES', title: 'The bottom checklist', items: labs });
  }

  add('safe', 'bullets', 'HOW TO STAY SAFE',
    `Now, how to stay safe while you wait for the clues. Never go all in at once. If you buy, build the position in small steps. Never use borrowed money. Decide where you'll get out before you buy, not after. And if you're wrong, get out, don't just keep buying more. This is also why my daily screen doesn't try to call the bottom of the whole market. It looks for strong stocks that fell hard, with a 4 percent target and a safety exit, and that's it.`,
    { kick: 'SURVIVE FIRST', title: 'How to stay safe', items: ['Never go all in: build in small steps', 'Never use borrowed money', 'Decide your exit before you buy', 'Wrong? Get out. Do not just buy more'] });

  add('outro', 'outro', 'THANKS FOR WATCHING', `And that's it! Six clues, no certainty, and a lot of patience. ${cfg.disclaimer} If this helped, hit like, subscribe to ${ch}, tap the bell, and tell me in the comments which of these six signs you watch. See you in the next one. Take care!`, { disclaimer: cfg.disclaimer });
  return { mode: 'bottom', title, date: dayShort(asOf), asOf, scenes, tickers: [], cfg, sources: ['Nvidia example: Reuters analysis (via The Star), 20 Nov 2026: https://www.thestar.com.my/business/business-news/2026/11/20/nvidias-numbers-impress-but-investors-fret-over-ceo-succession'] };
}

function chapName(s) {
  if (s.type === 'setup') { const t = s.heading; return NAMES[t] ? `${NAMES[t]} (${t}) setup` : `${t} setup`; }
  let h = s.heading.charAt(0) + s.heading.slice(1).toLowerCase();
  h = h.replace(/\b(ai|bk|spy|etf|atr|s&p|rsi)\b/gi, m => m.toUpperCase()).replace(/\b(\d+)\s*pct\b/gi, '$1%');
  return h.replace(/\bmonday's\b/i, m => m.charAt(0).toUpperCase() + m.slice(1));
}
/** Structured YouTube details. {{CHAPTERS}} is replaced by real timestamps. */
function metaParts(ep) {
  const t0 = []; let t = 0;
  for (const s of ep.scenes) { t0.push(t); t += s.dur; }
  const mmss = sec => { const t = Math.round(sec); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
  const chap = ep.scenes.map((s, i) => ({ id: s.id, name: chapName(s), planned: mmss(t0[i]) }));
  const setupsSc = ep.scenes.filter(x => x.type === 'setup'), tick = setupsSc.map(x => x.heading);
  const named = tick.map(x => NAMES[x] ? `${x} (${NAMES[x]})` : x).join(', ');
  const surv = typeof ep.chg5d === 'number' && ep.chg5d <= -3 && tick.length > 0;
  const drop = typeof ep.chg5d === 'number' ? `${ep.chg5d >= 0 ? '+' : '−'}${Math.abs(ep.chg5d).toFixed(1)}%` : '';
  const sources = (ep.sources || []).map(x => `• ${x}`).join('\n');
  let hook, rules = '';
  if (ep.mode === 'welcome') {
    hook = `${surv ? `The S&P 500 fell ${drop.replace('−', '')} in five sessions. ` : ''}Here are the ${tick.length} S&P 500 stocks the Uptrend Dip screen still flagged for ${ep.nxd}, how to treat them as 4% target swing trades, and the rules that keep the risk sane. Signals are from the ${dayShort(ep.asOf)} close.`;
    rules = `THE RULES\n• Wait 3-5 minutes after the open on ${ep.nxd}\n• Only if the price is within 2% of the signal-day close\n• Target: 4% above the signal-day close (a target, not a promise)\n• Stop: 3x ATR below. It is far away, so NEVER use leverage, margin, leveraged ETFs or options\n• Exit by the close of day 3 at the latest`;
  } else if (ep.mode === 'bottom') {
    hook = `Can you spot a market bottom? Nobody can call it exactly, but there are six simple clues that the selling may be running out of steam: how far it has fallen, a panic day, the fear gauge (VIX), a higher low, price taking back its averages, and the news test (bad news stops working, good news holds into the close). Real market history, plain English, no predictions.`;
    rules = 'THE 6 CLUES\n• 1. How far has it fallen from its high?\n• 2. A panic day: heavy volume, then calm\n• 3. The fear gauge (VIX) peaks and falls\n• 4. A higher low that holds\n• 5. Price back above its 20-day average\n• 6. The news test: bad news ignored, good news holds into the close';
  } else if (ep.mode === 'weekly') hook = 'Weekly review of how the screen signals played out under the tested rules, plus a watch list for next week.';
  else {
    const d1 = typeof ep.chg1d === 'number' ? `The S&P 500 ${ep.chg1d >= 0 ? 'rose' : 'fell'} ${Math.abs(ep.chg1d).toFixed(1)}% today. ` : '';
    hook = `${d1}Today's market in plain English, a scorecard of how my earlier picks did, and the ${tick.length} S&P 500 stocks my screen flagged for ${ep.nxd || 'the next session'}, each with a simple plan: when to buy, the +4% target, and a safety exit.${ep.calSource ? '' : ''}`;
    rules = `THE PLAN FOR EACH PICK\n• Wait 3-5 minutes after the open on ${ep.nxd}\n• Only buy if the price is within 2% of the signal-day close\n• Target: 4% above that close (a target, not a promise)\n• Safety exit: far below, so keep size small and NEVER use leverage or borrowed money\n• Be out by the close of day 3 at the latest`;
  }
  const head = [hook, tick.length ? `SIGNALS: ${named}` : '', rules].filter(Boolean).join('\n\n');
  const tail = [sources ? `MARKET SOURCES (checked by me, double-check before relying on them)\n${sources}` : '', ep.cfg.disclaimer, 'AI note: the charts and graphics in this video are generated automatically from market data. The voice and presenter are real.', `#4PercentSwingTrades #SwingTrading #SP500 #StockMarket`].filter(Boolean).join('\n\n');
  const tags0 = ep.mode === 'bottom' ? ['market bottom', 'how to find a market bottom', 'stock market bottom', 'stock market correction', 'stock market crash', 'technical analysis for beginners', 'VIX', 'buy the dip', 'investing for beginners', 'S&P 500', 'trade with bk'] : null;
  const tags1 = tags0 || ['S&P 500', 'S&P 500 stocks', 'swing trading', 'swing trading strategy', '4% swing trade', 'stock screener', 'dip buying', 'uptrend pullback', 'stock market correction', 'stock market today', 'trading signals', 'technical analysis', 'stocks to watch', 'trade with bk', ...tick, ...tick.map(x => NAMES[x]).filter(Boolean)];
  const tags = [...new Set([...(ep.extraTags || []), ...tags1])].slice(0, 30);
  const pinned = ep.mode === 'bottom' ? "Which of the 6 signs do you watch most? And has the 'news test' (bad news ignored, good news holding into the close) worked for you? Tell me below, and I'll reply to every comment. 👇\n\nReminder: nobody can call the exact bottom. This is education, not financial advice. Never use leverage." : ep.mode === 'weekly' ? 'Which setup did you follow this week, and how did it go? Educational only, not financial advice.' : `Which of these ${tick.length} would you have picked: ${tick.join(', ')}? Tell me below, and I'll reply to every comment. 👇\n\nReminder: these are signals from a screen, not recommendations. 4% is a target, not a promise, and the safety exit is far away, so never use leverage. Educational only, not financial advice.`;
  return { title: ep.title, head, tail, chap, tags, pinned };
}
function metadata(ep) {
  const m = metaParts(ep);
  const chapters = m.chap.map(c => `${c.planned} ${c.name}`).join('\n');
  return `TITLE\n${m.title}\n\nDESCRIPTION\n${m.head}\n\nCHAPTERS (planned times; after you record, the take-ready screen gives the real ones)\n${chapters}\n\n${m.tail}\n\nTAGS\n${m.tags.join(', ')}\n\nPINNED COMMENT\n${m.pinned}\n`;
}

function tapeFor(ep, setups) {
  if (ep.mode === 'bottom') return 'FINDING MARKET BOTTOMS  //  6 SIMPLE SIGNS  //  NOBODY CALLS THE EXACT BOTTOM  //  NEVER USE LEVERAGE  //  EDUCATIONAL ONLY';
  const m = (setups && setups.market) || {}, parts = [];
  if (isNum(m.chg5d)) parts.push(`S&P 500 ${m.chg5d >= 0 ? '+' : '−'}${Math.abs(m.chg5d).toFixed(1)}% over 5 sessions`);
  if (isNum(m.chg20d)) parts.push(`${m.chg20d >= 0 ? '+' : '−'}${Math.abs(m.chg20d).toFixed(1)}% over 20 sessions`);
  const live = ((setups && setups.dip) || []).filter(x => x.sessionsAgo === 0 && x.sp500).length;
  parts.push(`${live} S&P 500 signals at the ${dayShort(ep.asOf)} close`);
  parts.push('Wait 3-5 min after the open');
  parts.push('Never use leverage');
  return parts.join('  //  ');
}
function buildEpisode(args) { const ep = buildEpisodeInner(args); if (args.setups && args.setups.__news && args.setups.__news.asOf === args.setups.asOf) ep.sources = args.setups.__news.sources || []; if (args.setups && args.setups.market && typeof args.setups.market.chg5d === 'number') ep.chg5d = args.setups.market.chg5d; if (args.setups && args.setups.market && typeof args.setups.market.chg1d === 'number') ep.chg1d = args.setups.market.chg1d; if (!ep.nxd && ep.mode !== 'weekly' && args.setups && args.setups.asOf) ep.nxd = nextSessionFull(args.setups.asOf); ep.tape = tapeFor(ep, args.setups); return ep; }
function pointsOf(sc) { return (sc.points && sc.points.length) ? sc.points : sentences(sc.narration).slice(0, 7); }
module.exports = { callRows, metaParts, pointsOf, buildEpisode, metadata, spell, money, pct, nearTrigger };
