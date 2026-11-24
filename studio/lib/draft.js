'use strict';
/*
 * DRAFT mode: a provisional version of tonight's scan, run on the S&P 500 BEFORE the US close with today's unfinished
 * daily bar as the last candle. The real scan only uses completed candles, so until it runs after the close its
 * setups.json is a day behind. This gives the early review a realistic list of picks. Every figure is intraday
 * and will change by the close; the final video is built from the real scan after the close.
 */
const core = require('../../app.js');
const { loadJson, fetchBars } = require('./data');

const etDate = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
const r2 = x => (typeof x === 'number' && isFinite(x) ? Math.round(x * 100) / 100 : null);
const roundAll = obj => JSON.parse(JSON.stringify(obj, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v)));

async function draftSetups(setups, { src, keys }) {
  const today = etDate();
  const uni = await loadJson(String(src).replace(/setups\.json(\?.*)?$/, 'universe.json'));
  const tickers = [...new Set(((uni.indexes && uni.indexes.sp500 && uni.indexes.sp500.tickers) || []).concat(['SPY']))];
  if (tickers.length < 300) throw new Error('S&P 500 list missing from universe.json (' + tickers.length + ' tickers)');
  const end = new Date(Date.now() - 16 * 60 * 1000).toISOString(); // the free data plan cannot read the latest 15 minutes
  const bars = await fetchBars(tickers, { ...keys, days: 460, end });
  const sp = new Set(tickers.filter(t => t !== 'SPY' || (uni.indexes.sp500.tickers || []).includes('SPY')));
  const items = [], status = {}; let withToday = 0, used = 0;
  for (const t of tickers) {
    const c = core.cleanCandles(bars[t] || []);
    if (!c.length) continue;
    if (c[c.length - 1].t === today) withToday++;
    if (c[c.length - 1].t !== today) continue; // halted or no trades yet today
    used++;
    for (const sig of core.scanSetups(c)) items.push({ ticker: t, sp500: sp.has(t), ...sig });
    const f = c.length >= 206 ? core.setupFlags(core.setupIndicators(c), c.length - 1) : null;
    if (f) status[t] = [r2(c[c.length - 1].c), r2(f.r5 * 100), r2(f.vs200 * 100), r2(f.rsi)];
  }
  if (used < 300) throw new Error(`Only ${used} S&P 500 stocks have a bar for ${today}: is the market open today?`);
  const clean = roundAll(items);
  const out = { ...setups, draft: true, generatedAt: new Date().toISOString(), asOf: today, nextSession: core.addSessions(today, 1), dip: clean.filter(x => x.kind === 'dip'), rip: clean.filter(x => x.kind === 'rip'), status };
  console.log(`DRAFT scan: ${used} S&P 500 stocks with today's partial bar, ${out.dip.filter(x => x.sessionsAgo === 0).length} provisional dip signals today (as of ${today}).`);
  return out;
}
module.exports = { draftSetups, etDate };
