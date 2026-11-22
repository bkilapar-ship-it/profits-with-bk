#!/usr/bin/env node
/* Writes the phone-friendly landing page for the studio folder: node publish-index.js <dir> (dir holds daily/ and weekly/, each with meta.json) */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const LABEL = { welcome: 'Welcome video', daily: 'Daily video', weekly: 'Weekly review' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sections = ['welcome', 'daily', 'weekly'].map(m => {
  const f = path.join(dir, m, 'meta.json');
  if (!fs.existsSync(f)) return m === 'welcome' ? '' :  `<section><h2>${LABEL[m]}</h2><p class="mut">None generated yet.</p></section>`;
  const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
  const md = fs.readFileSync(path.join(dir, m, 'metadata.txt'), 'utf8');
  return `<section><h2>${LABEL[m]}</h2><p class="t">${esc(meta.title)}</p><p class="mut">${esc(meta.asOf)} · ${meta.scenes} scenes · about ${Math.floor(meta.seconds / 60)}:${String(Math.round(meta.seconds % 60)).padStart(2, '0')}</p>
  <div class="btns"><a class="b" href="${m}/teleprompter.html#review">Review script and scenes</a><a class="b go" href="${m}/teleprompter.html">1. Open teleprompter and record</a><a class="b" href="${m}/visuals.mp4" download>2. Download visuals video</a><a class="b" href="${m}/thumbnail.png">3. Thumbnail</a><a class="b" href="${m}/script.txt">Script (text)</a></div>
  <details><summary>Title, description and tags (tap to copy)</summary><pre id="md-${m}">${esc(md)}</pre><button class="b" onclick="navigator.clipboard.writeText(document.getElementById('md-${m}').innerText).then(()=>this.textContent='Copied')">Copy</button></details></section>`;
}).join('');
fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trade With BK Studio</title>
<style>:root{color-scheme:dark}body{margin:0;background:#0A0F1C;color:#EAF0FB;font-family:-apple-system,system-ui,'Inter',sans-serif;padding:20px 18px 60px;max-width:640px;margin:auto}h1{font-size:26px;margin:8px 0 4px}h2{font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:#6F94FF;margin:30px 0 6px}section{border-top:1px solid #22304D;padding-top:4px}.t{font-size:19px;font-weight:700;margin:4px 0}.mut{color:#8FA3C7;font-size:14px;margin:4px 0}.btns{display:grid;gap:10px;margin:14px 0}.b{display:block;text-align:center;padding:15px;border-radius:14px;border:1px solid #2A3B61;background:#121C33;color:#fff;font-weight:700;text-decoration:none;font:inherit;font-weight:700}.go{background:#2563EB;border-color:#2563EB}pre{white-space:pre-wrap;background:#101A30;border:1px solid #22304D;border-radius:12px;padding:12px;font-size:13px}summary{padding:10px 0;color:#9DB8FF;font-weight:700}ol{color:#9FB1D4;font-size:14px;line-height:1.5;padding-left:20px}</style></head><body>
<h1>Trade With BK Studio</h1><p class="mut">Built automatically after each market close. Educational content only.</p>
<ol><li>Review the script and scenes. Edit, reorder or skip anything you don't like.</li><li>Open the teleprompter and record yourself talking through the points.</li><li>Tap <b>Combine my video</b> below: it puts your face and voice together with the visuals, right on your phone.</li><li>Save the finished video, paste the title and description, add the thumbnail, publish.</li></ol><a class="b go" href="combine.html" style="margin-bottom:6px">Combine my video</a>${sections}</body></html>`);
console.log('landing page written');
