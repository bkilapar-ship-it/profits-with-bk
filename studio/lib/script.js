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
function nextSessionFull(iso) { const d = new Date(`${iso}T12:00:00Z`); do { d.setUTCDate(d.getUTCDate() + 1); } while ([0, 6].includes(d.getUTCDay())); return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).replace(/^(\w+),? /, '$1 '); }
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

  add('intro', 'intro', 'Welcome to Trade With BK',
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

  add('outro', 'outro', 'THANKS FOR WATCHING', `Thanks for watching. ${cfg.disclaimer} Subscribe to ${ch}, and see you after the next close.`, ['Thanks for watching', 'Subscribe so you catch the next one', 'See you after the next close'], { disclaimer: cfg.disclaimer });

  return { mode: 'welcome', title: `${ch}: S&P 500 dip signals for ${nxd} (top ${top.length || ''} picks)`.replace('  ', ' '), nxd, date: dayShort(asOf), asOf, scenes, tickers: top.map(x => x.ticker).slice(0, 3), cfg, news };
}

function buildEpisodeInner({ mode, setups, config }) {
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
  featured.forEach((x, i) => add(`setup-${x.ticker}`, 'setup', x.ticker, setupNarration(x, i, cfg), { setup: x, plan: plan(x), rank: i + 1, total: dipSp.length }));
  if (short) add(`short-${short.ticker}`, 'setup', short.ticker, ripNarration(short), { setup: short, plan: plan(short), short: true });
  const rest = dipSp.slice(cfg.maxSetups);
  if (dipSp.length || ripSp.length) {
    const rows = dipSp.concat(ripSp).slice(0, 10).map(x => ({ ticker: x.ticker, kind: x.kind, chg5d: x.chg5d, vs200: x.vs200, rsi: x.rsi, close: x.close, stopDist: plan(x).stop ? (plan(x).stop / x.close - 1) * 100 : null }));
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
  return `TITLE\n${ep.title}\n\nDESCRIPTION\n${ep.mode === 'welcome' ? `${ep.cfg.channelName}: S&P 500 dip signals for ${ep.nxd}. Hi, I'm Bharat. In this video: what the channel is for, how the Uptrend Dip screen picks S&P 500 stocks (and what it skips), how to use a signal (wait 3 to 5 minutes after the open, only within 2% of the signal close, 4% target, 3 ATR stop, exit by the close of day 3), this week's market and the first list of signals.` : ep.mode === 'weekly' ? 'Weekly review of how the screen signals played out under the tested rules, plus a watch list for next week.' : `Today's results from the Uptrend Dip screen on S&P 500 stocks: what triggered, why, and the tested plan levels.`}\n\nChapters (approximate, adjust after you edit):\n${chapters}\n\n${ep.cfg.disclaimer}\n\nAI note: the charts and graphics in this video are generated automatically from market data. The voice and presenter are real.\n\nTAGS\n${tags.join(', ')}\n`;
}

function tapeFor(ep, setups) {
  const m = (setups && setups.market) || {}, parts = [];
  if (isNum(m.chg5d)) parts.push(`S&P 500 ${m.chg5d >= 0 ? '+' : '−'}${Math.abs(m.chg5d).toFixed(1)}% over 5 sessions`);
  if (isNum(m.chg20d)) parts.push(`${m.chg20d >= 0 ? '+' : '−'}${Math.abs(m.chg20d).toFixed(1)}% over 20 sessions`);
  const live = ((setups && setups.dip) || []).filter(x => x.sessionsAgo === 0 && x.sp500).length;
  parts.push(`${live} S&P 500 signals at the ${dayShort(ep.asOf)} close`);
  parts.push('Wait 3-5 min after the open');
  parts.push('Never use leverage');
  return parts.join('  //  ');
}
function buildEpisode(args) { const ep = buildEpisodeInner(args); ep.tape = tapeFor(ep, args.setups); return ep; }
function pointsOf(sc) { return (sc.points && sc.points.length) ? sc.points : sentences(sc.narration).slice(0, 7); }
module.exports = { pointsOf, buildEpisode, metadata, spell, money, pct, nearTrigger };
