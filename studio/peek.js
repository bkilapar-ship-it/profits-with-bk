#!/usr/bin/env node
/* One-off read-only look at the live data: node studio/peek.js <outdir>. Writes peek.txt (+ a copy of setups.json). */
'use strict';
const fs = require('fs'); const path = require('path');
const { loadJson, fetchBars } = require('./lib/data');
const out = process.argv[2] || 'peek-out'; fs.mkdirSync(out, { recursive: true });
const lines = []; const log = s => { lines.push(s); console.log(s); };
const base = process.env.PAGES_BASE_URL || `https://${(process.env.GITHUB_REPOSITORY || 'bkilapar-ship-it/profits-with-bk').split('/')[0]}.github.io/${(process.env.GITHUB_REPOSITORY || 'x/profits-with-bk').split('/')[1]}`;
const rsi = (c, n = 14) => { if (c.length < n + 1) return null; let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; } g /= n; l /= n; for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
const smaLast = (c, n) => c.length >= n ? c.slice(-n).reduce((a, b) => a + b, 0) / n : null;
(async () => {
  const setups = await loadJson(`${base}/data/setups.json`);
  fs.writeFileSync(path.join(out, 'setups.json'), JSON.stringify(setups));
  log(`asOf ${setups.asOf}; keys: ${Object.keys(setups).join(', ')}`);
  for (const k of ['dip', 'rip']) log(`${k}: ${(setups[k] || []).length} rows (S&P: ${(setups[k] || []).filter(x => x.sp500).length}, live today: ${(setups[k] || []).filter(x => x.sessionsAgo === 0 && x.sp500).length})`);
  log('\nS&P long setups, sessionsAgo 0 (all fields):');
  for (const x of (setups.dip || []).filter(x => x.sessionsAgo === 0 && x.sp500)) log(JSON.stringify(x));
  log('\nmarket: ' + JSON.stringify(setups.market));
  const AI = 'NVDA AMD AVGO MU SMCI PLTR MSFT GOOGL META AMZN ORCL TSM ARM ANET VRT DELL CRWV COHR LRCX AMAT KLAC INTC QCOM NOW AAPL TSLA CEG VST'.split(' ');
  const inSetups = new Set([...(setups.dip || []), ...(setups.rip || [])].map(x => x.ticker + ':' + x.kind + ':' + x.sessionsAgo));
  log('\nAI/megacap names appearing in any setup list: ' + [...inSetups].filter(s => AI.includes(s.split(':')[0])).join(', '));
  const bars = await fetchBars(AI.concat(['SPY']), { keyId: process.env.ALPACA_KEY_ID, secret: process.env.ALPACA_SECRET_KEY });
  log('\nAI/megacap health (last bar, 5-day %, vs 200-day %, vs 50-day %, RSI14, drop from 60-day high %):');
  for (const s of AI.concat(['SPY'])) {
    const b = bars[s]; if (!b || b.length < 210) { log(`${s}: no data`); continue; }
    const c = b.map(x => x.c), n = c.length - 1, hi = Math.max(...b.slice(-60).map(x => x.h));
    log(`${s}: ${b[n].t} close ${c[n].toFixed(2)} | 5d ${((c[n] / c[n - 5] - 1) * 100).toFixed(1)}% | vs200 ${((c[n] / smaLast(c, 200) - 1) * 100).toFixed(1)}% | vs50 ${((c[n] / smaLast(c, 50) - 1) * 100).toFixed(1)}% | RSI ${rsi(c).toFixed(0)} | from 60d high ${((c[n] / hi - 1) * 100).toFixed(1)}%`);
  }
  for (const f of ['bt-1D.json']) {
    try { const j = await loadJson(`${base}/data/${f}`); log(`\n${f}: keys ${Object.keys(j).join(', ')}`); const sg = j.signals; if (sg) { log(`signals: ${Array.isArray(sg) ? sg.length + ' (first: ' + JSON.stringify(sg[0]).slice(0, 300) + ')' : JSON.stringify(Object.keys(sg)).slice(0, 300)}`); } for (const k of Object.keys(j)) if (!['signals', 'series'].includes(k)) log(`  ${k}: ${JSON.stringify(j[k]).slice(0, 300)}`); } catch (e) { log(`${f}: ${e.message}`); }
  }
  fs.writeFileSync(path.join(out, 'peek.txt'), lines.join('\n'));
})().catch(e => { console.error('FAILED', e); fs.writeFileSync(path.join(out, 'peek.txt'), lines.join('\n') + '\nFAILED: ' + e.message); process.exit(1); });
