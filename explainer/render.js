#!/usr/bin/env node
/*
 * Renders an episode to video, one file per language.
 *   node explainer/render.js explainer/episodes/inflation.json [--lang te] [--out explainer-out] [--fps 30] [--stills 2,8.5]
 * Output: <out>/<episode id>/<lang>/video.mp4, captions.srt (for YouTube subtitles) and script.txt (teleprompter).
 * Needs Playwright (Chromium) and ffmpeg. Free: no paid services.
 */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), { spawn } = require('child_process');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i > -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const epFile = args.find(a => a.endsWith('.json'));
if (!epFile) { console.error('Usage: node explainer/render.js explainer/episodes/<name>.json [--lang te] [--out dir]'); process.exit(1); }
const ROOT = __dirname, FPS = +opt('fps', 30), OUT = opt('out', 'explainer-out');
const ep = JSON.parse(fs.readFileSync(epFile, 'utf8'));
const langs = opt('lang', null) ? opt('lang').split(',') : Object.keys(ep.languages || { en: {} });
const stills = opt('stills', null);

// tiny static file server, because browsers will not load local files with fetch()
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, r) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      let f = path.normalize(path.join(ROOT, u));
      if (u.startsWith('/__ep/')) f = path.resolve(epFile);
      if (!f.startsWith(ROOT) && f !== path.resolve(epFile)) { r.writeHead(403); return r.end(); }
      fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(b); });
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

async function renderLang(browser, port, lang) {
  const dir = path.join(OUT, ep.id || path.basename(epFile, '.json'), lang);
  fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log(`[${lang}] page error:`, e.message));
  await page.goto(`http://127.0.0.1:${port}/player.html?ep=/__ep/episode.json&lang=${encodeURIComponent(lang)}`);
  await page.waitForFunction(() => window.READY || window.ERROR, null, { timeout: 30000 });
  const err = await page.evaluate(() => window.ERROR);
  if (err) throw new Error(`[${lang}] ${err}`);
  const { DUR, CUES, SRT, SCRIPT } = await page.evaluate(() => ({ DUR: window.DUR, CUES: window.CUES, SRT: window.SRT, SCRIPT: window.SCRIPT }));
  fs.writeFileSync(path.join(dir, 'captions.srt'), SRT);
  fs.writeFileSync(path.join(dir, 'script.txt'), SCRIPT);
  if (stills) {
    for (const t of stills.split(',')) { await page.evaluate(t => window.render(t), +t); await page.screenshot({ path: path.join(dir, `still-${t}.png`) }); }
    console.log(`[${lang}] stills written to ${dir}`);
    await page.close(); return;
  }
  const N = Math.round(DUR * FPS), beeps = (CUES || []).filter(c => c.sound === 'beep');
  const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
  let filter = null;
  if (beeps.length) {
    beeps.forEach(() => ffArgs.push('-f', 'lavfi', '-i', 'sine=frequency=1800:duration=0.16'));
    filter = beeps.map((b, i) => `[${i + 1}:a]adelay=${Math.round(b.t * 1000)}|${Math.round(b.t * 1000)},volume=0.35[b${i}]`).join(';') +
      ';' + beeps.map((_, i) => `[b${i}]`).join('') + `amix=inputs=${beeps.length}:normalize=0,apad[a]`;
    ffArgs.push('-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-shortest', '-c:a', 'aac');
  }
  ffArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'video.mp4'));
  const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg exited with ' + c)))));
  for (let f = 0; f < N; f++) {
    await page.evaluate(t => window.render(t), f / FPS);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % (FPS * 5) === 0) console.log(`[${lang}] ${(f / FPS).toFixed(0)}s of ${DUR.toFixed(1)}s`);
  }
  ff.stdin.end(); await done; await page.close();
  console.log(`[${lang}] done: ${path.join(dir, 'video.mp4')} (${DUR.toFixed(1)}s)`);
}

(async () => {
  const srv = await serve(), port = srv.address().port, browser = await chromium.launch();
  try { for (const l of langs) await renderLang(browser, port, l); }
  finally { await browser.close(); srv.close(); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
