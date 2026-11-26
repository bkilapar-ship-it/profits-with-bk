#!/usr/bin/env node
/*
 * Renders an episode to video, one file per language.
 *   node explainer/render.js explainer/episodes/inflation.json [--lang te] [--out explainer-out] [--fps 30] [--stills 2,8.5]
 * Output: <out>/<episode id>/<lang>/video.mp4, captions.srt (for YouTube subtitles) and script.txt (teleprompter).
 * Needs Playwright (Chromium) and ffmpeg. Free: no paid services.
 *
 * Recordings: a scene with a take (scene.lang.<lang>.take, see engine.js) gets that voice in the soundtrack, and a
 * presenter scene with a video take shows the video in its camera frame. The scene follows the voice length.
 * Takes live in explainer/takes/ (uploaded by the editor). The voice is evened out in loudness; silence at the
 * start and end is cut using the editor's in/out marks, or found automatically when those are missing.
 */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), { spawn } = require('child_process');
const os = require('os'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
require('./engine.js'); const Explainer = globalThis.Explainer;

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i > -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const epFile = args.find(a => a.endsWith('.json'));
if (!epFile) { console.error('Usage: node explainer/render.js explainer/episodes/<name>.json [--lang te] [--out dir]'); process.exit(1); }
const ROOT = __dirname, FPS = +opt('fps', 30), OUT = opt('out', 'explainer-out');
const ep = JSON.parse(fs.readFileSync(epFile, 'utf8'));
const langs = opt('lang', null) ? opt('lang').split(',') : Object.keys(ep.languages || { en: {} });
const stills = opt('stills', null);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-'));
const epByLang = {};   // the episode as each language sees it, with recordings measured and prepared

const run = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
const ffErr = a => String(require('child_process').spawnSync('ffmpeg', a, { encoding: 'utf8', maxBuffer: 64 << 20 }).stderr || '');
const probeDur = f => +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).trim() || 0;
const hasVideo = f => { try { return run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=index', '-of', 'csv=p=0', f]).trim() !== ''; } catch (e) { return false; } };

/** Finds where the voice starts and ends in a wav file (seconds), ignoring quiet room noise. */
function voiceSpan(wav, dur) {
  const log = ffErr(['-hide_banner', '-i', wav, '-af', 'silencedetect=noise=-38dB:d=0.25', '-f', 'null', '-']);
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1]), ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]);
  let a = 0, b = dur;
  if (starts.length && starts[0] < 0.05 && ends.length) a = ends[0];                 // quiet at the start
  const ls = starts[starts.length - 1], le = ends.length === starts.length ? ends[ends.length - 1] : dur;
  if (starts.length && ls > a && le >= dur - 0.05) b = ls;                             // quiet at the end
  return b - a > 0.3 ? { in: Math.max(0, a - 0.1), out: Math.min(dur, b + 0.15) } : { in: 0, out: dur };
}

/** Measures and prepares every recording for one language: a clean voice track, and video frames for presenter scenes. */
function prepareTakes(lang) {
  const e = JSON.parse(JSON.stringify(ep)), sounds = [];
  (e.scenes || []).forEach((s, i) => {
    const t = ((s.lang || {})[lang] || {}).take;
    if (!t || !t.file) return;
    const src = path.resolve(ROOT, t.file);
    if (!src.startsWith(ROOT + path.sep) || !fs.existsSync(src)) { console.log(`[${lang}] scene ${i + 1}: recording ${t.file} not found, using the fixed length instead`); delete s.lang[lang].take; return; }
    const full = path.join(TMP, `${lang}-${i}-full.wav`), wav = path.join(TMP, `${lang}-${i}.wav`);
    // decode the whole sound first: phone recordings often have no reliable length in the file
    run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '48000', full]);
    const dur = probeDur(full);
    let span = (t.in != null && t.out != null) ? { in: +t.in, out: +t.out } : voiceSpan(full, dur);
    span = { in: Math.max(0, Math.min(span.in, dur)), out: Math.max(0, Math.min(span.out, dur)) };
    if (span.out - span.in < 0.3) span = { in: 0, out: dur };
    Object.assign(t, { dur, in: span.in, out: span.out });
    const len = span.out - span.in;
    run('ffmpeg', ['-y', '-v', 'error', '-i', full, '-af', `atrim=start=${span.in}:duration=${len},asetpts=PTS-STARTPTS,highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.05,afade=t=out:st=${Math.max(0, len - 0.08)}:d=0.08`, '-ar', '48000', '-ac', '2', wav]);
    const T = Explainer.SCENES[s.type];
    if (T && T.camera && t.kind === 'video' && hasVideo(src)) {
      const r = T.slot(Explainer.sceneData(s)), key = `${lang}-${i}`, dir = path.join(TMP, 'frames', key);
      fs.mkdirSync(dir, { recursive: true });
      run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-an', '-vf', `trim=start=${span.in}:duration=${len},setpts=PTS-STARTPTS,fps=${FPS},scale=${r.w}:${r.h}:force_original_aspect_ratio=increase,crop=${r.w}:${r.h}`, '-q:v', '3', path.join(dir, '%05d.jpg')]);
      const count = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).length;
      if (count) t.frames = { url: `/__frames/${key}`, fps: FPS, count };
    }
    sounds.push({ scene: i, wav });
    console.log(`[${lang}] scene ${i + 1}: recording ${len.toFixed(1)}s of voice${t.frames ? ' with video' : ''} (cut ${span.in.toFixed(1)}s at the start)`);
  });
  epByLang[lang] = e;
  return sounds;
}

// tiny static file server, because browsers will not load local files with fetch()
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, r) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const m = u.match(/^\/__ep\/([\w-]+)\.json$/);
      if (m) { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify(epByLang[m[1]] || ep)); }
      let f = path.normalize(path.join(ROOT, u)), base = ROOT;
      if (u.startsWith('/__frames/')) { base = path.join(TMP, 'frames'); f = path.normalize(path.join(base, u.slice(10))); }
      if (!f.startsWith(base + path.sep)) { r.writeHead(403); return r.end(); }
      fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(b); });
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

async function renderLang(browser, port, lang) {
  const dir = path.join(OUT, ep.id || path.basename(epFile, '.json'), lang);
  fs.mkdirSync(dir, { recursive: true });
  const sounds = prepareTakes(lang);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log(`[${lang}] page error:`, e.message));
  await page.goto(`http://127.0.0.1:${port}/player.html?ep=/__ep/${encodeURIComponent(lang)}.json&lang=${encodeURIComponent(lang)}`);
  await page.waitForFunction(() => window.READY || window.ERROR, null, { timeout: 30000 });
  const err = await page.evaluate(() => window.ERROR);
  if (err) throw new Error(`[${lang}] ${err}`);
  const { DUR, CUES, SRT, SCRIPT, TAKES } = await page.evaluate(() => ({ DUR: window.DUR, CUES: window.CUES, SRT: window.SRT, SCRIPT: window.SCRIPT, TAKES: window.TAKES }));
  fs.writeFileSync(path.join(dir, 'captions.srt'), SRT);
  fs.writeFileSync(path.join(dir, 'script.txt'), SCRIPT);
  if (stills) {
    for (const t of stills.split(',')) { await page.evaluate(t => window.renderAsync(t), +t); await page.screenshot({ path: path.join(dir, `still-${t}.png`) }); }
    console.log(`[${lang}] stills written to ${dir}`);
    await page.close(); return;
  }
  const N = Math.round(DUR * FPS), beeps = (CUES || []).filter(c => c.sound === 'beep');
  const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
  // soundtrack: your recorded voice for each scene, plus sound effects such as the card-machine beep
  const mix = [];
  beeps.forEach(b => { ffArgs.push('-f', 'lavfi', '-i', 'sine=frequency=1800:duration=0.16'); mix.push({ t: b.t, vol: 0.35 }); });
  (TAKES || []).forEach(k => { const sd = sounds.find(x => x.scene === k.i); if (sd) { ffArgs.push('-i', sd.wav); mix.push({ t: k.at, vol: 1 }); } });
  if (mix.length) {
    const filter = mix.map((m, i) => `[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(m.t * 1000)}:all=1,volume=${m.vol}[s${i}]`).join(';') +
      ';' + mix.map((_, i) => `[s${i}]`).join('') + `amix=inputs=${mix.length}:normalize=0,apad[a]`;
    ffArgs.push('-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-shortest', '-c:a', 'aac', '-b:a', '192k');
  }
  ffArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'video.mp4'));
  const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg exited with ' + c)))));
  for (let f = 0; f < N; f++) {
    await page.evaluate(t => window.renderAsync(t), f / FPS);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % (FPS * 5) === 0) console.log(`[${lang}] ${(f / FPS).toFixed(0)}s of ${DUR.toFixed(1)}s`);
  }
  ff.stdin.end(); await done; await page.close();
  console.log(`[${lang}] done: ${path.join(dir, 'video.mp4')} (${DUR.toFixed(1)}s)`);
}

(async () => {
  const srv = await serve(), port = srv.address().port, browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try { for (const l of langs) await renderLang(browser, port, l); }
  finally { await browser.close(); srv.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
