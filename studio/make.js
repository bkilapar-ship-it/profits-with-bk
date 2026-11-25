#!/usr/bin/env node
/*
 * Builds one episode: visuals.mp4, script.txt, teleprompter.html, metadata.txt, thumbnail.png, scenes.json
 *   node studio/make.js --mode daily|weekly|welcome [--setups <file|url>] [--bars <file>] [--out <dir>] [--no-video]
 * Env: ALPACA_KEY_ID, ALPACA_SECRET_KEY (price history for the charts), STUDIO_SETUPS_URL (default: your GitHub Pages setups.json)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadJson, fetchBars, fetchVix } = require('./lib/data');
const { buildEpisode, metadata, pointsOf, callRows } = require('./lib/script');
const { prepareCharts, renderEpisode, renderStills, renderBrandAssets } = require('./lib/render');
const { analyze } = require('./lib/bottom');
const { draftSetups } = require('./lib/draft');

/** Today's daily bar is unfinished until the US close, so it must never be read as a closing price. Drops it unless the market closed (after 16:30 Eastern). */
let DRAFT = false; // draft mode: keep today's unfinished bar (intraday numbers) instead of waiting for the close
function dropUnfinishedToday(arr) {
  if (DRAFT || !Array.isArray(arr) || !arr.length) return arr;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const today = `${p.year}-${p.month}-${p.day}`, mins = Number(p.hour) * 60 + Number(p.minute);
  const last = String(arr[arr.length - 1].t).slice(0, 10);
  return last === today && mins < 16 * 60 + 30 ? arr.slice(0, -1) : arr;
}
const { teleprompterHtml, animOf } = require('./lib/teleprompter');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };

async function main() {
  const mode = arg('mode', 'daily');
  DRAFT = !!arg('draft', false);
  if (DRAFT) console.log('DRAFT MODE: today\'s unfinished bar is included, every figure is intraday and will change by the close.');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const repo = process.env.GITHUB_REPOSITORY || 'bkilapar-ship-it/profits-with-bk';
  const src = arg('setups', process.env.STUDIO_SETUPS_URL || `https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}/data/setups.json`);
  let setups = await loadJson(src);
  if (DRAFT && mode === 'daily') setups = { ...(await draftSetups(setups, { src, keys: { keyId: process.env.ALPACA_KEY_ID, secret: process.env.ALPACA_SECRET_KEY } })) };
  try { // the paper account's public history (simulated money), published by the scanner next to setups.json
    const pu = process.env.STUDIO_PAPER_URL || arg('paper', null) || (String(src).replace(/setups\.json(\?.*)?$/, 'paper.json'));
    if (pu && pu !== src) { const pj = await loadJson(pu); if (pj && Array.isArray(pj.trades)) setups.__paper = pj; }
  } catch (e) { console.log('Note: no paper account history for the video:', e.message); }
  if (setups.stale) console.log('Note: setups.json is marked stale (the last scan failed); the episode uses the previous data.');
  if (!setups.asOf) throw new Error('setups.json has no asOf date.');
  // S&P 500 history first, so the script can quote this week's move
  let bars = {};
  const barsFile = arg('bars', null);
  try {
    bars = barsFile ? await loadJson(barsFile) : (arg('no-video', false) ? {} : await fetchBars(['SPY'], { keyId: process.env.ALPACA_KEY_ID, secret: process.env.ALPACA_SECRET_KEY }));
  } catch (e) { console.log('Note: could not load S&P 500 history early:', e.message); }
  if (mode === 'bottom' || mode === 'daily') { // long S&P 500 history (and the VIX): the market-bottom episode, and the daily video's 'is this the bottom?' check
    try {
      const hf = arg('history', null), env = { keyId: process.env.ALPACA_KEY_ID, secret: process.env.ALPACA_SECRET_KEY };
      const long = hf ? (await loadJson(hf)).SPY : (await fetchBars(['SPY'], { ...env, days: 3800 })).SPY;
      let vix = null; const vf = arg('vix', null);
      try { vix = vf ? await loadJson(vf) : await fetchVix(); } catch (e) { console.log('Note: VIX history unavailable, the fear-gauge slide is left out:', e.message); }
      setups.__bottom = analyze(dropUnfinishedToday(long), vix);
      console.log('VIX data: ' + (vix && vix.length ? `last date ${vix[vix.length - 1].t}, close ${vix[vix.length - 1].c}` : 'none'));
      if (setups.__bottom && setups.__bottom.cur) console.log('Bottom checklist now: ' + setups.__bottom.cur.items.map((x, i) => `${i + 1}:${x.ok === null ? 'n/a' : x.ok ? 'tick' : 'no'} (${x.note})`).join(' | '));
      if (!bars.SPY && long) bars.SPY = dropUnfinishedToday(long).slice(-300);
    } catch (e) { console.log('Note: could not load long S&P 500 history, the data slides are left out:', e.message); }
  }
  if (bars.SPY) bars.SPY = dropUnfinishedToday(bars.SPY);
  if (bars.SPY && bars.SPY.length > 21) {
    const c = bars.SPY.map(b => b.c), n = c.length - 1;
    setups.market = { ...(setups.market || {}), chg1d: (c[n] / c[n - 1] - 1) * 100, close: c[n], chg5d: (c[n] / c[n - 5] - 1) * 100, range1d: (bars.SPY[n].h - bars.SPY[n].l) / c[n - 1] * 100, chg20d: (setups.market && typeof setups.market.chg20d === 'number') ? setups.market.chg20d : (c[n] / c[n - 20] - 1) * 100 };
  }
  // the S&P 500 members, so the 'closest to qualifying' list only ever shows S&P 500 stocks
  if (!setups.__sp500) { try { const u = await loadJson(String(src).replace(/setups\.json(\?.*)?$/, 'universe.json')); const L = u && u.indexes && u.indexes.sp500 && u.indexes.sp500.tickers; if (Array.isArray(L) && L.length > 300) setups.__sp500 = L; } catch (e) { console.log('Note: no S&P 500 list for the near-trigger filter:', e.message); } }
  // Episode 1 extras: market news facts file (if present) and the AI/chip health check from real prices
  { const nf = path.join(__dirname, 'content', `news-${setups.asOf}.json`);
    if (fs.existsSync(nf)) setups.__news = JSON.parse(fs.readFileSync(nf, 'utf8'));
    // a hand-checked highlight of the day (content/highlight-<date>.json) goes first and survives the daily research task rewriting the news file
    const hf = path.join(__dirname, 'content', `highlight-${setups.asOf}.json`);
    if (fs.existsSync(hf)) { const h = JSON.parse(fs.readFileSync(hf, 'utf8')), n0 = setups.__news && setups.__news.asOf === setups.asOf ? setups.__news : { asOf: setups.asOf, headlines: [], sources: [] };
      const have = new Set((n0.headlines || []).map(x => String(x).toLowerCase()));
      setups.__news = { ...n0, asOf: setups.asOf, highlight: h.headline, hook: h.hook, closeNote: h.closeNote, thumbHead: h.thumbHead, tags: h.tags, introNote: h.introNote, bottomNote: h.bottomNote, badNews: h.badNews, survive: h.survive, headlines: [...(h.points || []), ...(n0.headlines || []).filter(x => !(h.points || []).some(p => String(p).toLowerCase() === String(x).toLowerCase()))], sources: [...(h.sources || []), ...(n0.sources || [])] }; }
    const ef = path.join(__dirname, 'content', 'events.json');
    if (fs.existsSync(ef)) setups.__events = JSON.parse(fs.readFileSync(ef, 'utf8')); }
  if (mode === 'daily') { // (a) how the AI/chip names did today, (b) what happened to the calls given on earlier sessions
    const AI = ['NVDA', 'AMD', 'AVGO', 'MU', 'SMCI', 'PLTR', 'TSM', 'ARM', 'ANET', 'LRCX', 'AMAT', 'KLAC', 'QCOM', 'INTC'];
    const keys = { keyId: process.env.ALPACA_KEY_ID, secret: process.env.ALPACA_SECRET_KEY };
    try {
      const rows = callRows(setups, config), tk = [...new Set(rows.map(r => r.ticker))];
      const ab = barsFile ? bars : await fetchBars(AI.concat(tk), keys);
      const ch = AI.map(t => ab[t] && dropUnfinishedToday(ab[t])).filter(b => b && b.length > 2).map(b => b[b.length - 1].c / b[b.length - 2].c - 1);
      if (ch.length >= 6) { setups.__aiDay = ch.reduce((a, b) => a + b, 0) / ch.length * 100; console.log(`AI/chip names: average ${setups.__aiDay.toFixed(2)}% today (${ch.length} names)`); }
      const repo2 = process.env.GITHUB_REPOSITORY || 'bkilapar-ship-it/profits-with-bk', ob = {};
      const calls = [];
      for (const r of rows) {
        const b = ab[r.ticker] ? dropUnfinishedToday(ab[r.ticker]).filter(x => x.t <= setups.asOf) : [];
        const si = b.findIndex(x => x.t === r.signalDate); if (si < 0 || si + 1 >= b.length) continue;
        const ed = b[si + 1].t; if (!(ed in ob)) { try { ob[ed] = await loadJson(`https://raw.githubusercontent.com/${repo2}/open-bars/${ed}.json`); } catch (e) { ob[ed] = null; } }
        const rec = ob[ed] && (ob[ed].setups || ob[ed]).find && (ob[ed].setups || ob[ed]).find(x => x.ticker === r.ticker && x.strategy === 'dip');
        const lv0 = r.levels || {}, cap = lv0.entryLimit, openPx = rec && typeof rec.open === 'number' ? rec.open : b[si + 1].o;
        const past = rec ? rec.openedPastCap === true : (cap != null && openPx > cap);
        const entry = past ? null : (rec && typeof rec.simulatedFill === 'number' ? rec.simulatedFill : openPx);
        // the plan's exits are measured from the FILL: target = fill +4%, safety exit = fill -3 ATR (the levels in setups.json are from the signal close)
        const lv = entry != null ? { target: entry * 1.04, stop: typeof r.atr === 'number' ? entry - 3 * r.atr : lv0.stop } : lv0;
        let state = 'open', pct = null, exitIdx = null;
        if (entry != null) {
          for (let j = si + 1; j < b.length && j <= si + 3; j++) {
            if (lv.stop != null && b[j].l <= lv.stop) { state = 'stop'; pct = (lv.stop / entry - 1) * 100; exitIdx = j; break; }
            if (lv.target != null && b[j].h >= lv.target) { state = 'target'; pct = (lv.target / entry - 1) * 100; exitIdx = j; break; }
          }
          const last = b[b.length - 1];
          if (state === 'open') { pct = (last.c / entry - 1) * 100; if (b.length - 1 - si >= 3) state = 'closed'; }
        }
        const last = b[b.length - 1];
        // only calls that were still holding at the previous close are reviewed: skipped calls (no entry) and calls that already hit
        // their target, safety exit or day-3 close before today were covered in an earlier video and are not mentioned again
        if (entry == null || (exitIdx != null && exitIdx < b.length - 1)) continue;
        calls.push({ ticker: r.ticker, signalDate: r.signalDate, day: Math.min(3, b.length - 1 - si), entry, open: openPx, close: last.c, pct: entry == null ? (last.c / openPx - 1) * 100 : pct, state });
      }
      if (calls.length) { setups.__calls = calls; console.log('Calls: ' + calls.map(c => `${c.ticker} ${c.entry == null ? 'skipped' : c.state + ' ' + c.pct.toFixed(1) + '%'}`).join(', ')); }
    } catch (e) { console.log('Note: could not work out the earlier calls:', e.message); }
  }
  if (mode === 'welcome') {
    const AI = ['NVDA', 'AMD', 'AVGO', 'MU', 'SMCI', 'PLTR', 'MSFT', 'GOOGL', 'META', 'AMZN', 'ORCL', 'TSM', 'ARM', 'ANET', 'VRT', 'DELL', 'CRWV', 'COHR', 'LRCX', 'AMAT', 'KLAC', 'INTC', 'QCOM', 'NOW', 'CEG', 'VST'];
    try {
      const ab = barsFile ? bars : await fetchBars(AI, { keyId: process.env.ALPACA_KEY_ID, secret: process.env.ALPACA_SECRET_KEY });
      setups.aiHealth = AI.filter(t => ab[t] && ab[t].length >= 205).map(t => { const c = ab[t].map(b => b.c), n = c.length - 1, ma = c.slice(-200).reduce((a, b) => a + b, 0) / 200; return { ticker: t, vs200: (c[n] / ma - 1) * 100, chg5d: (c[n] / c[n - 5] - 1) * 100 }; });
      console.log(`AI health: ${setups.aiHealth.length} names, ${setups.aiHealth.filter(a => a.vs200 < 0).length} below the 200-day`);
    } catch (e) { console.log('Note: AI health check skipped:', e.message); }
  }
  if (DRAFT) setups.__draft = true;
  const ep = buildEpisode({ mode, setups, config });
  if (DRAFT) ep.title = 'DRAFT: ' + ep.title;
  const out = path.resolve(arg('out', path.join(__dirname, 'out', `${mode}-${setups.asOf}`)));
  fs.mkdirSync(out, { recursive: true });

  const DN = DRAFT ? 'DRAFT: built before the US close, so every price and percentage below is intraday and WILL change by the close. Wording and structure are what to review.\n\n' : '';
  fs.writeFileSync(path.join(out, 'script.txt'), DN + `${ep.title}\n\n` + ep.scenes.map((s, i) => `[${i + 1}. ${s.heading}]\nTALKING POINTS\n${pointsOf(s).map(x => '- ' + x).join('\n')}\n\nFULL SCRIPT (optional)\n${s.narration}`).join('\n\n---\n\n') + '\n');
  fs.writeFileSync(path.join(out, 'metadata.txt'), metadata(ep));
  fs.writeFileSync(path.join(out, 'teleprompter.html'), teleprompterHtml(ep));
  fs.writeFileSync(path.join(out, 'scenes.json'), JSON.stringify({ title: ep.title, asOf: ep.asOf, mode: ep.mode, video: 'visuals.mp4', scenes: ep.scenes.map(s => ({ id: s.id, type: s.type, heading: s.heading, dur: s.dur, narration: s.narration, ...(s.openFrac ? { openFrac: Math.round(s.openFrac * 1000) / 1000 } : {}), ...(s.pop ? { pop: true, popAt: s.popAt } : {}) })) }, null, 2));
  console.log(`Episode: ${ep.title} (${ep.scenes.length} scenes, ~${Math.round(ep.scenes.reduce((a, s) => a + s.dur, 0))}s)`);
  if (arg('no-video', false) && !arg('stills', false)) return;

  const tickers = ep.scenes.filter(s => s.type === 'setup').map(s => s.data.setup.ticker);
  if (!barsFile && tickers.length) bars = { ...bars, ...(await fetchBars(tickers, { keyId: process.env.ALPACA_KEY_ID, secret: process.env.ALPACA_SECRET_KEY })) };
  prepareCharts(ep, bars);
  { const sj = JSON.parse(fs.readFileSync(path.join(out, 'scenes.json'), 'utf8')), an = animOf(ep); sj.scenes.forEach((x, i) => { if (an[i]) x.an = an[i]; }); fs.writeFileSync(path.join(out, 'scenes.json'), JSON.stringify(sj, null, 2)); } // real numbers for the beta animated visuals (Shorts)
  fs.writeFileSync(path.join(out, 'teleprompter.html'), teleprompterHtml(ep)); // again, now that the charts' real closes are known (for the beta animated visuals)
  let chromium; try { ({ chromium } = require('playwright')); } catch (e) { throw new Error('playwright is not installed (run: npm install && npx playwright install chromium)'); }
  await renderStills(ep, out, { chromium });
  await renderBrandAssets(ep, out, { chromium });
  console.log('Scene previews done');
  if (arg('no-video', false)) return;
  const video = await renderEpisode(ep, out, { chromium });
  fs.rmSync(path.join(out, '_work'), { recursive: true, force: true });
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ draft: DRAFT || undefined, title: ep.title, asOf: ep.asOf, mode: ep.mode, scenes: ep.scenes.length, seconds: ep.scenes.reduce((a, s) => a + s.dur, 0), tickers: ep.tickers }, null, 2));
  console.log(`Done: ${video}`);
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
