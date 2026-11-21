#!/usr/bin/env node
/*
 * Builds one episode: visuals.mp4, script.txt, teleprompter.html, metadata.txt, thumbnail.png, scenes.json
 *   node studio/make.js --mode daily|weekly [--setups <file|url>] [--bars <file>] [--out <dir>] [--no-video]
 * Env: ALPACA_KEY_ID, ALPACA_SECRET_KEY (price history for the charts), STUDIO_SETUPS_URL (default: your GitHub Pages setups.json)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadJson, fetchBars } = require('./lib/data');
const { buildEpisode, metadata } = require('./lib/script');
const { prepareCharts, renderEpisode } = require('./lib/render');
const { teleprompterHtml } = require('./lib/teleprompter');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };

async function main() {
  const mode = arg('mode', 'daily');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const repo = process.env.GITHUB_REPOSITORY || 'bkilapar-ship-it/profits-with-bk';
  const src = arg('setups', process.env.STUDIO_SETUPS_URL || `https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}/data/setups.json`);
  const setups = await loadJson(src);
  if (setups.stale) console.log('Note: setups.json is marked stale (the last scan failed); the episode uses the previous data.');
  if (!setups.asOf) throw new Error('setups.json has no asOf date.');
  const ep = buildEpisode({ mode, setups, config });
  const out = path.resolve(arg('out', path.join(__dirname, 'out', `${mode}-${setups.asOf}`)));
  fs.mkdirSync(out, { recursive: true });

  fs.writeFileSync(path.join(out, 'script.txt'), `${ep.title}\n\n` + ep.scenes.map((s, i) => `[${i + 1}. ${s.heading}]\n${s.narration}`).join('\n\n') + '\n');
  fs.writeFileSync(path.join(out, 'metadata.txt'), metadata(ep));
  fs.writeFileSync(path.join(out, 'teleprompter.html'), teleprompterHtml(ep));
  fs.writeFileSync(path.join(out, 'scenes.json'), JSON.stringify({ title: ep.title, asOf: ep.asOf, scenes: ep.scenes.map(s => ({ id: s.id, type: s.type, heading: s.heading, dur: s.dur })) }, null, 2));
  console.log(`Episode: ${ep.title} (${ep.scenes.length} scenes, ~${Math.round(ep.scenes.reduce((a, s) => a + s.dur, 0))}s)`);
  if (arg('no-video', false)) return;

  const tickers = ep.scenes.filter(s => s.type === 'setup').map(s => s.data.setup.ticker);
  let bars = {};
  {
    const barsFile = arg('bars', null);
    bars = barsFile ? await loadJson(barsFile) : await fetchBars(tickers.concat(['SPY']), { keyId: process.env.ALPACA_KEY_ID, secret: process.env.ALPACA_SECRET_KEY });
  }
  prepareCharts(ep, bars);
  let chromium; try { ({ chromium } = require('playwright')); } catch (e) { throw new Error('playwright is not installed (run: npm install && npx playwright install chromium)'); }
  const video = await renderEpisode(ep, out, { chromium });
  fs.rmSync(path.join(out, '_work'), { recursive: true, force: true });
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ title: ep.title, asOf: ep.asOf, mode: ep.mode, scenes: ep.scenes.length, seconds: ep.scenes.reduce((a, s) => a + s.dur, 0), tickers: ep.tickers }, null, 2));
  console.log(`Done: ${video}`);
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
