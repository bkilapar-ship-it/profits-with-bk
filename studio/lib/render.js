'use strict';
/* Scene HTML, frame capture (Chromium) and video assembly (ffmpeg). */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { sma } = require('./data');
const { NEON, logoSvg, bgCandles } = require('./brand');
let TAPE = '';

const W = 1920, H = 1080, FPS = 30, ANIM = 2.4;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = x => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sgn = (x, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}%`;
const cls = x => (x > 0 ? 'up' : x < 0 ? 'down' : '');

function fontCss(dir) {
  const base = path.relative(dir, path.join(__dirname, '..', 'node_modules', '@fontsource', 'poppins', 'files')).split(path.sep).join('/');
  return [500, 600, 700, 800].map(w => `@font-face{font-family:'Poppins';font-weight:${w};src:url('${base}/poppins-latin-${w}-normal.woff2') format('woff2')}`).join('');
}

const CSS = `
:root{--bg:#000;--card:#04080D;--line:#12384A;--text:#F4F8FF;--mut:#9FB3C8;--up:#1FE5A5;--down:#FF3B6B;--acc:#26D0FF;--amb:#FFC21A}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#000;color:var(--text);font-family:'Poppins',system-ui,sans-serif;font-variant-numeric:tabular-nums}
body{position:relative;background:radial-gradient(900px 600px at 92% -5%,rgba(38,208,255,.11),transparent 60%),radial-gradient(800px 500px at -5% 105%,rgba(255,59,107,.08),transparent 60%),#000}
.grid{display:none}
.top{position:absolute;left:80px;right:80px;top:36px;display:flex;justify-content:space-between;align-items:center;font-weight:700;letter-spacing:.16em;font-size:21px;color:var(--mut)}
.brand{display:flex;align-items:center;gap:14px;color:var(--text);font-weight:800}
.foot{position:absolute;left:80px;right:80px;bottom:68px;font-size:17px;color:#6F8499;display:flex;justify-content:space-between}
.tape{position:absolute;left:0;right:0;bottom:0;height:54px;border-top:2px solid rgba(38,208,255,.55);background:linear-gradient(90deg,rgba(38,208,255,.14),rgba(38,208,255,.03));display:flex;align-items:center;padding:0 40px;font-size:22px;font-weight:700;letter-spacing:.06em;color:#7FE3FF;text-shadow:0 0 14px rgba(38,208,255,.55);white-space:nowrap;overflow:hidden;text-transform:uppercase}
.card{background:linear-gradient(180deg,rgba(38,208,255,.05),rgba(38,208,255,.012)),var(--card);border:2px solid rgba(38,208,255,.55);border-radius:22px;box-shadow:0 0 26px rgba(38,208,255,.22),inset 0 0 22px rgba(38,208,255,.05)}
.card.g{border-color:rgba(31,229,165,.7);box-shadow:0 0 26px rgba(31,229,165,.24),inset 0 0 22px rgba(31,229,165,.05)}
.card.r{border-color:rgba(255,59,107,.75);background:linear-gradient(180deg,rgba(255,59,107,.07),rgba(255,59,107,.015)),#0A0409;box-shadow:0 0 26px rgba(255,59,107,.26),inset 0 0 22px rgba(255,59,107,.06)}
.card.y{border-color:rgba(255,194,26,.7);box-shadow:0 0 26px rgba(255,194,26,.22),inset 0 0 22px rgba(255,194,26,.05)}
.up{color:var(--up);text-shadow:0 0 18px rgba(31,229,165,.45)}.down{color:var(--down);text-shadow:0 0 18px rgba(255,59,107,.5)}.mut{color:var(--mut)}
.kick{font-size:25px;font-weight:700;letter-spacing:.2em;color:var(--acc);text-shadow:0 0 18px rgba(38,208,255,.65);text-transform:uppercase}
.h1{font-size:104px;font-weight:800;letter-spacing:-.01em;line-height:1.04;text-transform:uppercase;text-shadow:0 0 26px rgba(255,255,255,.16)}
.h1 span{text-shadow:0 0 30px rgba(38,208,255,.65)}
.h2{font-size:58px;font-weight:800;letter-spacing:-.005em;text-transform:uppercase;color:var(--amb);text-shadow:0 0 26px rgba(255,194,26,.55)}
.chip{display:inline-flex;align-items:center;gap:10px;padding:9px 20px;border-radius:999px;font-weight:700;font-size:22px;border:2px solid rgba(255,255,255,.25);background:rgba(255,255,255,.04);text-transform:uppercase;letter-spacing:.02em}
.chip.g{color:var(--up);border-color:rgba(31,229,165,.7);background:rgba(31,229,165,.10);box-shadow:0 0 16px rgba(31,229,165,.25)}.chip.r{color:var(--down);border-color:rgba(255,59,107,.75);background:rgba(255,59,107,.10);box-shadow:0 0 16px rgba(255,59,107,.28)}.chip.b{color:#7FE3FF;border-color:rgba(38,208,255,.7);background:rgba(38,208,255,.10);box-shadow:0 0 16px rgba(38,208,255,.25)}.chip.a{color:var(--amb);border-color:rgba(255,194,26,.7);background:rgba(255,194,26,.10);box-shadow:0 0 16px rgba(255,194,26,.25)}
.lab{font-size:18px;letter-spacing:.14em;font-weight:700;color:var(--mut);text-transform:uppercase}
.num{font-weight:800;letter-spacing:-.01em}
[data-a]{opacity:0}
.abs{position:absolute}
table{border-collapse:collapse;width:100%}th{font-size:19px;letter-spacing:.12em;color:var(--mut);text-align:right;padding:0 16px 14px;font-weight:700}th:first-child,td:first-child{text-align:left}td{font-size:33px;font-weight:600;padding:15px 16px;border-top:1px solid rgba(38,208,255,.25);text-align:right}
`;

const ANIM_JS = `
const ease=t=>t<=0?0:t>=1?1:1-Math.pow(1-t,3);
const fmt=(v,d,pre,suf)=>pre+(v<0?'−':'')+Math.abs(v).toFixed(d)+suf;
window.setP=function(p){
  document.querySelectorAll('[data-a]').forEach(el=>{const [s,e]=el.dataset.a.split(',').map(Number);const t=ease((p-s)/(e-s));el.style.opacity=t;el.style.transform='translateY('+((1-t)*26)+'px)';});
  document.querySelectorAll('[data-w]').forEach(el=>{const [s,e]=el.dataset.w.split(',').map(Number);const t=ease((p-s)/(e-s));el.style.width=(t*parseFloat(el.dataset.max))+'px';});
  document.querySelectorAll('[data-count]').forEach(el=>{const [from,to,d,pre,suf,s,e]=el.dataset.count.split('|');const t=ease((p-parseFloat(s))/(parseFloat(e)-parseFloat(s)));el.textContent=fmt(parseFloat(from)+(parseFloat(to)-parseFloat(from))*t,parseInt(d),pre,suf);});
  const rv=document.getElementById('rv');if(rv){rv.setAttribute('width',ease(p/0.55)*parseFloat(rv.dataset.max));}
};
`;

/* ------------------------------------------------------------------ chart */
function chartSvg(bars, plan, cw, ch) {
  const n = bars.length, padL = 24, padR = 96, padT = 28, padB = 44;
  const all = bars.map(b => b.sma).filter(isNum);
  let lo = Math.min(...bars.map(b => b.l)), hi = Math.max(...bars.map(b => b.h));
  if (plan && isNum(plan.target)) hi = Math.max(hi, plan.target);
  const smaInRange = all.length && Math.min(...all) > lo * 0.7 && Math.max(...all) < hi * 1.3;
  if (smaInRange) { lo = Math.min(lo, ...all); hi = Math.max(hi, ...all); }
  const span = hi - lo || 1; lo -= span * 0.06; hi += span * 0.08;
  const x = i => padL + (i + 0.5) * ((cw - padL - padR) / n), y = v => padT + (hi - v) / (hi - lo) * (ch - padT - padB);
  const bw = ((cw - padL - padR) / n) * 0.62;
  let g = '';
  const step = niceStep((hi - lo) / 5);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) g += `<line x1="${padL}" x2="${cw - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#12384A" stroke-width="1"/><text x="${cw - padR + 14}" y="${(y(v) + 7).toFixed(1)}" fill="#8FA3C7" font-size="21" font-weight="600">${v.toFixed(v >= 100 ? 0 : 2)}</text>`;
  let candles = '';
  bars.forEach((b, i) => {
    const up = b.c >= b.o, col = up ? '#1FE5A5' : '#FF3B6B', top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c));
    candles += `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${y(b.h).toFixed(1)}" y2="${y(b.l).toFixed(1)}" stroke="${col}" stroke-width="2.4"/><rect x="${(x(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, bot - top).toFixed(1)}" rx="1.5" fill="${col}"/>`;
  });
  let smaPath = '';
  bars.forEach((b, i) => { if (isNum(b.sma)) smaPath += `${smaPath ? 'L' : 'M'}${x(i).toFixed(1)} ${y(b.sma).toFixed(1)}`; });
  const last = bars[n - 1], lx = x(n - 1), ly = y(last.c);
  const lvl = (v, col, label, id) => (isNum(v) && v > lo && v < hi ? `<g data-a="0.55,0.8" id="${id}"><line x1="${padL}" x2="${cw - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${col}" stroke-width="2.5" stroke-dasharray="10 8"/><rect x="${cw - padR - 168}" y="${(y(v) - 17).toFixed(1)}" width="164" height="34" rx="17" fill="#000" stroke="${col}"/><text x="${cw - padR - 86}" y="${(y(v) + 8).toFixed(1)}" fill="${col}" font-size="21" font-weight="700" text-anchor="middle">${label}</text></g>` : '');
  const dates = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].map(i => `<text x="${x(i).toFixed(1)}" y="${ch - 12}" fill="#8FA3C7" font-size="20" font-weight="600" text-anchor="middle">${esc(bars[i].t.slice(5).replace('-', '/'))}</text>`).join('');
  return `<svg width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><defs><clipPath id="rvc"><rect id="rv" x="0" y="0" width="0" height="${ch}" data-max="${cw}"/></clipPath></defs>${g}
    <g clip-path="url(#rvc)">${candles}${smaPath ? `<path d="${smaPath}" fill="none" stroke="#FFC21A" stroke-width="3" stroke-dasharray="3 7" stroke-linecap="round"/>` : ''}</g>
    ${smaPath ? `<text data-a="0.4,0.6" x="${padL + 8}" y="${padT + 16}" fill="#FFC21A" font-size="21" font-weight="700">··· 200-day average</text>` : ''}
    <g data-a="0.5,0.75"><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="16" fill="none" stroke="#26D0FF" stroke-width="3"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="6" fill="#26D0FF"/></g>
    <g data-a="0.5,0.75"><circle cx="${padL + (smaPath ? 330 : 20)}" cy="${padT + 8}" r="8" fill="none" stroke="#26D0FF" stroke-width="3"/><text x="${padL + (smaPath ? 350 : 40)}" y="${padT + 16}" fill="#7FE3FF" font-size="21" font-weight="700">signal day close ${last.c.toFixed(2)}</text></g>
    ${lvl(plan && plan.target, '#1FE5A5', `target ${plan && isNum(plan.target) ? plan.target.toFixed(2) : ''}`, 'tg')}
    ${lvl(plan && plan.stop, '#FF3B6B', `stop ${plan && isNum(plan.stop) ? plan.stop.toFixed(2) : ''}`, 'st')}
    ${dates}</svg>`;
}

/* Full analysis chart: candles + 20/200-day averages + volume + RSI, with the plan's target and stop. */
function chartSvg2(view, plan, cw, ch, note) {
  const n = view.length, padL = 14, padR = 100, step = (cw - padL - padR) / n, bw = step * 0.62;
  const priceH = Math.round(ch * 0.60), volTop = priceH + 22, volH = Math.round(ch * 0.115), rsiTop = volTop + volH + 40, rsiH = ch - rsiTop - 34;
  const x = i => padL + (i + 0.5) * step;
  let lo = Math.min(...view.map(b => b.l)), hi = Math.max(...view.map(b => b.h));
  const m20 = view.map(b => b.ma20).filter(isNum), s200 = view.map(b => b.sma).filter(isNum);
  if (m20.length) { lo = Math.min(lo, ...m20); hi = Math.max(hi, ...m20); }
  if (plan && isNum(plan.target)) hi = Math.max(hi, plan.target);
  if (plan && isNum(plan.stop) && plan.stop > lo * 0.80) lo = Math.min(lo, plan.stop);
  const inRange = s200.length && Math.min(...s200) > lo * 0.72 && Math.max(...s200) < hi * 1.28;
  if (inRange) { lo = Math.min(lo, ...s200); hi = Math.max(hi, ...s200); }
  const span = hi - lo || 1; lo -= span * 0.05; hi += span * 0.07;
  const y = v => 12 + (hi - v) / (hi - lo) * (priceH - 24);
  let g = ''; const st = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) g += `<line x1="${padL}" x2="${cw - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="rgba(38,208,255,.14)"/><text x="${cw - padR + 12}" y="${(y(v) + 7).toFixed(1)}" fill="#9FB3C8" font-size="19" font-weight="600">${v.toFixed(v >= 100 ? 0 : 2)}</text>`;
  const x5a = x(n - 5) - step / 2, x5b = x(n - 1) + step / 2;
  const hl = `<rect x="${x5a.toFixed(1)}" y="2" width="${(x5b - x5a).toFixed(1)}" height="${(priceH - 4)}" rx="10" fill="rgba(255,59,107,.09)" stroke="rgba(255,59,107,.35)"/>`;
  let candles = '', vols = '';
  const vmax = Math.max(...view.map(b => b.v || 0), 1), vy = v => volTop + volH - (v / vmax) * (volH - 4);
  view.forEach((b, i) => {
    const up = b.c >= b.o, col = up ? '#1FE5A5' : '#FF3B6B', top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c));
    candles += `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${y(b.h).toFixed(1)}" y2="${y(b.l).toFixed(1)}" stroke="${col}" stroke-width="2.2"/><rect x="${(x(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, bot - top).toFixed(1)}" rx="1.5" fill="${col}"/>`;
    if (b.v) vols += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${vy(b.v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(volTop + volH - vy(b.v)).toFixed(1)}" fill="${col}" opacity=".75"/>`;
  });
  const path = key => { let d = ''; view.forEach((b, i) => { if (isNum(b[key])) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)} ${y(b[key]).toFixed(1)}`; }); return d; };
  const m20p = path('ma20'), s200p = inRange ? path('sma') : '';
  let vavg = ''; view.forEach((b, i) => { if (isNum(b.vavg)) vavg += `${vavg ? 'L' : 'M'}${x(i).toFixed(1)} ${vy(b.vavg).toFixed(1)}`; });
  // RSI
  const ry = v => rsiTop + (100 - v) / 100 * rsiH;
  let rsiP = ''; view.forEach((b, i) => { if (isNum(b.rsi)) rsiP += `${rsiP ? 'L' : 'M'}${x(i).toFixed(1)} ${ry(b.rsi).toFixed(1)}`; });
  const last = view[n - 1], lx = x(n - 1), ly = y(last.c);
  const lvl = (v, col, label, id) => (isNum(v) && v > lo && v < hi ? `<g data-a="0.55,0.8"><line x1="${padL}" x2="${cw - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${col}" stroke-width="2.6" stroke-dasharray="10 8"/><rect x="${cw - padR - 200}" y="${(y(v) - 17).toFixed(1)}" width="196" height="34" rx="17" fill="#000" stroke="${col}" stroke-width="2"/><text x="${cw - padR - 102}" y="${(y(v) + 8).toFixed(1)}" fill="${col}" font-size="20" font-weight="700" text-anchor="middle">${label}</text></g>` : '');
  const dates = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].map(i => `<text x="${x(i).toFixed(1)}" y="${ch - 6}" fill="#9FB3C8" font-size="19" font-weight="600" text-anchor="middle">${esc(view[i].t.slice(5).replace('-', '/'))}</text>`).join('');
  const lastRsi = isNum(last.rsi) ? last.rsi : null;
  const legend = `<g data-a="0.35,0.6"><line x1="${padL + 8}" x2="${padL + 44}" y1="${26}" y2="${26}" stroke="#26D0FF" stroke-width="4"/><text x="${padL + 52}" y="33" fill="#7FE3FF" font-size="19" font-weight="700">20-day</text>
    ${s200p ? `<line x1="${padL + 150}" x2="${padL + 186}" y1="26" y2="26" stroke="#FFC21A" stroke-width="4" stroke-dasharray="3 6"/><text x="${padL + 194}" y="33" fill="#FFC21A" font-size="19" font-weight="700">200-day</text>` : ''}
    <circle cx="${padL + (s200p ? 336 : 168)}" cy="26" r="8" fill="none" stroke="#26D0FF" stroke-width="3"/><text x="${padL + (s200p ? 352 : 184)}" y="33" fill="#7FE3FF" font-size="19" font-weight="700">signal close ${last.c.toFixed(2)}</text></g>`;
  const outNote = !inRange && note ? `<text data-a="0.4,0.6" x="${cw - padR - 8}" y="${priceH - 8}" fill="#FFC21A" font-size="19" font-weight="700" text-anchor="end">200-day average ${note} (below this chart)</text>` : '';
  return `<svg width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><defs><clipPath id="rvc"><rect id="rv" x="0" y="0" width="0" height="${ch}" data-max="${cw}"/></clipPath></defs>
    ${hl}${g}
    <g clip-path="url(#rvc)">${candles}${m20p ? `<path d="${m20p}" fill="none" stroke="#26D0FF" stroke-width="3.2" stroke-linejoin="round" opacity=".95"/>` : ''}${s200p ? `<path d="${s200p}" fill="none" stroke="#FFC21A" stroke-width="3.4" stroke-dasharray="3 7" stroke-linecap="round"/>` : ''}
      <text x="${padL + 4}" y="${volTop - 6}" fill="#9FB3C8" font-size="18" font-weight="700">VOLUME</text>${vols}${vavg ? `<path d="${vavg}" fill="none" stroke="#F4F8FF" stroke-width="2.2" stroke-dasharray="6 6" opacity=".8"/>` : ''}
      <rect x="${padL}" y="${ry(30).toFixed(1)}" width="${cw - padL - padR}" height="${(ry(0) - ry(30)).toFixed(1)}" fill="rgba(255,59,107,.08)"/>
      <line x1="${padL}" x2="${cw - padR}" y1="${ry(70).toFixed(1)}" y2="${ry(70).toFixed(1)}" stroke="rgba(255,255,255,.25)" stroke-dasharray="6 6"/><line x1="${padL}" x2="${cw - padR}" y1="${ry(30).toFixed(1)}" y2="${ry(30).toFixed(1)}" stroke="rgba(255,255,255,.25)" stroke-dasharray="6 6"/>
      <text x="${padL + 4}" y="${rsiTop - 8}" fill="#9FB3C8" font-size="18" font-weight="700">RSI 14</text><text x="${cw - padR + 12}" y="${(ry(70) + 6).toFixed(1)}" fill="#9FB3C8" font-size="17">70</text><text x="${cw - padR + 12}" y="${(ry(30) + 6).toFixed(1)}" fill="#9FB3C8" font-size="17">30</text>
      ${rsiP ? `<path d="${rsiP}" fill="none" stroke="#26D0FF" stroke-width="3.4" stroke-linejoin="round"/>` : ''}</g>
    ${lastRsi !== null ? `<g data-a="0.5,0.75"><circle cx="${lx.toFixed(1)}" cy="${ry(lastRsi).toFixed(1)}" r="7" fill="#26D0FF"/><text x="${(cw - padR + 12)}" y="${(ry(lastRsi) + 7).toFixed(1)}" fill="#7FE3FF" font-size="20" font-weight="800">${lastRsi.toFixed(0)}</text></g>` : ''}
    <g data-a="0.5,0.75"><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="15" fill="none" stroke="#26D0FF" stroke-width="3"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="5.5" fill="#26D0FF"/></g>
    ${legend}${outNote}
    <text data-a="0.45,0.7" x="${((x5a + x5b) / 2).toFixed(1)}" y="${priceH - 10}" fill="#FF3B6B" font-size="19" font-weight="700" text-anchor="middle">5-DAY DROP</text>
    ${lvl(plan && plan.target, '#1FE5A5', `target ${plan && isNum(plan.target) ? plan.target.toFixed(2) : ''}`)}
    ${lvl(plan && plan.stop, '#FF3B6B', `stop ${plan && isNum(plan.stop) ? plan.stop.toFixed(2) : ''}`)}
    ${dates}</svg>`;
}
function areaSvg(closes, cw, ch, up) {
  const n = closes.length, lo0 = Math.min(...closes), hi0 = Math.max(...closes), pad = (hi0 - lo0) * 0.12 || 1, lo = lo0 - pad, hi = hi0 + pad;
  const x = i => 10 + i * ((cw - 20) / (n - 1)), y = v => 14 + (hi - v) / (hi - lo) * (ch - 28);
  const col = up ? '#1FE5A5' : '#FF3B6B';
  const line = closes.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  return `<svg width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".38"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient><clipPath id="rvc"><rect id="rv" x="0" y="0" width="0" height="${ch}" data-max="${cw}"/></clipPath></defs>
    <g clip-path="url(#rvc)"><path d="${line}L${x(n - 1).toFixed(1)} ${ch}L${x(0).toFixed(1)} ${ch}Z" fill="url(#ag)"/><path d="${line}" fill="none" stroke="${col}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></g>
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(closes[n - 1]).toFixed(1)}" r="9" fill="${col}"/></svg>`;
}
function miniCandles(view, cw, ch) {
  const n = view.length, lo = Math.min(...view.map(b => b.l)), hi = Math.max(...view.map(b => b.h)), x = i => 6 + (i + 0.5) * ((cw - 12) / n), y = v => 8 + (hi - v) / (hi - lo) * (ch - 16), bw = ((cw - 12) / n) * 0.64;
  return `<svg width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}">${view.map((b, i) => { const c = b.c >= b.o ? '#1FE5A5' : '#FF3B6B'; const t = y(Math.max(b.o, b.c)), bt = y(Math.min(b.o, b.c)); return `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${y(b.h).toFixed(1)}" y2="${y(b.l).toFixed(1)}" stroke="${c}" stroke-width="3"/><rect x="${(x(i) - bw / 2).toFixed(1)}" y="${t.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(3, bt - t).toFixed(1)}" rx="2" fill="${c}"/>`; }).join('')}</svg>`;
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }

/* ----------------------------------------------------------------- scenes */
const frame = (inner, date) => `${bgCandles(W, H)}<div class="top"><div class="brand">${logoSvg(46, { glow: false, id: 'tp' })}<span>TRADE WITH BK</span></div><div>${esc(date || '')}</div></div>${inner}<div class="foot"><span>Educational only. Not financial advice or a personal recommendation.</span><span>Backtested results are not a guide to future performance.</span></div><div class="tape"><span>${esc(TAPE)}</span></div>`;
const stat = (label, valueHtml, sub, x, y, w, a) => `<div class="card abs" data-a="${a}" style="left:${x}px;top:${y}px;width:${w}px;height:148px;padding:22px 26px"><div class="lab" style="white-space:nowrap">${label}</div><div class="num" style="font-size:56px;margin-top:6px;white-space:nowrap">${valueHtml}</div>${sub ? `<div class="mut" style="font-size:20px;margin-top:-2px">${sub}</div>` : ''}</div>`;
const cnt = (to, d, pre, suf, s, e, c = '') => `<span class="${c}" data-count="0|${to}|${d}|${pre}|${suf}|${s}|${e}">${pre}${to.toFixed(d)}${suf}</span>`;

const SCENES = {
  intro: (s, ep) => {
    const d = s.data, m = d.market, k = d.counts || {};
    return frame(`
      <div class="abs" data-a="0,0.35" style="left:80px;top:250px"><div class="kick">${esc((d.kicker || '').toUpperCase())}</div></div>
      <div class="abs" data-a="0.1,0.5" style="left:80px;top:310px;width:1500px"><div class="h1" style="font-size:86px">${esc(s.heading.split(' ').slice(0, 1).join(' '))}<br><span style="color:var(--acc)">${esc(s.heading.split(' ').slice(1).join(' '))}</span></div></div>
      <div class="abs" data-a="0.3,0.7" style="left:80px;top:640px"><div class="h2" style="font-weight:600;color:var(--mut);font-size:46px">${esc(d.date || '')}</div></div>
      <div class="abs" data-a="0.45,0.85" style="left:80px;top:760px;display:flex;gap:18px">
        ${d.chips ? d.chips.map((c, i) => `<span class="chip ${['g', 'b', ''][i % 3]}">${esc(c)}</span>`).join('') : `<span class="chip g">${k.dip || 0} S&amp;P long setups</span><span class="chip r">${k.rip || 0} short</span><span class="chip">${k.other || 0} outside the index</span>
        ${m && isNum(m.chg20d) ? `<span class="chip ${m.chg20d <= 0 ? 'a' : 'b'}">S&amp;P 500 20-day ${sgn(m.chg20d)}</span>` : ''}`}</div>
      ${s.spy ? `<div class="card abs" data-a="0.2,0.6" style="left:1000px;top:230px;width:840px;height:520px;padding:34px 40px"><div class="lab">S&amp;P 500, LAST 60 SESSIONS</div><div class="abs" style="left:40px;top:96px">${s.spy}</div></div>` : ''}`, d.date);
  },
  rules: (s, ep) => {
    const item = (i, t, sub, a) => `<div class="card abs" data-a="${a}" style="left:${80 + i * 580}px;top:330px;width:540px;height:520px;padding:44px"><div class="num" style="font-size:120px;color:var(--acc)">${i + 1}</div><div style="font-size:46px;font-weight:800;margin-top:6px">${t}</div><div class="mut" style="font-size:30px;line-height:1.35;margin-top:18px">${sub}</div></div>`;
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:160px"><div class="kick">THE SCREEN</div><div class="h2" style="margin-top:12px">Three things, in the same stock</div></div>
      ${item(0, 'Uptrend', 'Price is above its 200-day average.', '0.15,0.45')}${item(1, 'Sharp drop', 'Down at least 10% over five sessions.', '0.3,0.6')}${item(2, 'Capitulation', 'Closed near the day’s low, made a new 20-day low, or fell three days in a row.', '0.45,0.75')}`, ep.date);
  },
  setup: (s, ep) => {
    const x = s.data.setup, p = s.data.plan || {}, short = !!s.data.short, rank = s.data.rank, total = s.data.total;
    const stopDist = isNum(p.stop) && isNum(x.close) ? (p.stop / x.close - 1) * 100 : null;
    const tag = x.priority === 0 ? `<span class="chip g">${short ? 'EXHAUSTED RALLY' : 'SELLING FLUSH'}</span>` : '';
    const st2 = (label, val, px, py, a) => `<div class="card abs" data-a="${a}" style="left:${px}px;top:${py}px;width:235px;height:118px;padding:16px 20px"><div class="lab" style="font-size:16px;white-space:nowrap">${label}</div><div class="num" style="font-size:44px;margin-top:2px;white-space:nowrap">${val}</div></div>`;
    const cap = (x.reasons || []).map(t => t.replace(/^./, c => c.toUpperCase()).replace('day’s low', 'day’s low')).slice(0, 1).join(' · ') || 'Washed-out short-term RSI';
    const row = (t, sub, a) => `<div data-a="${a}" style="display:flex;gap:14px;align-items:flex-start;margin-top:10px"><div style="flex:none;color:var(--up);font-size:30px;font-weight:800;line-height:1.1;text-shadow:0 0 14px rgba(31,229,165,.6)">✓</div><div><div style="font-size:23px;font-weight:800;line-height:1.1">${t}</div><div class="mut" style="font-size:19px;line-height:1.25;margin-top:2px">${sub}</div></div></div>`;
    return frame(`
      <div class="abs" data-a="0,0.25" style="left:80px;top:100px;display:flex;align-items:center;gap:22px"><div class="h2" style="font-size:70px;color:#7FE3FF;text-shadow:0 0 28px rgba(38,208,255,.6)">${rank ? '#' + rank + ' ' : ''}${esc(x.ticker)}</div><span class="chip ${short ? 'r' : 'g'}">${short ? 'SHORT SETUP' : 'UPTREND DIP'}</span>${tag}${total ? `<span class="chip">${rank} of ${total} signals</span>` : ''}</div>
      <div class="card abs" data-a="0,0.2" style="left:80px;top:196px;width:1250px;height:650px;padding:8px 10px">${s.chart}</div>
      ${st2('5-DAY MOVE', cnt(x.chg5d, 1, x.chg5d > 0 ? '+' : '', '%', 0.25, 0.65, cls(x.chg5d)), 1360, 196, '0.2,0.45')}
      ${st2('VS 200-DAY', cnt(x.vs200, 1, x.vs200 > 0 ? '+' : '', '%', 0.3, 0.7, x.vs200 >= 0 ? 'up' : 'down'), 1609, 196, '0.25,0.5')}
      ${st2('RSI (14)', cnt(x.rsi || 0, 0, '', '', 0.35, 0.75), 1360, 328, '0.3,0.55')}
      ${st2('REL. VOLUME', isNum(x.relVol) ? cnt(x.relVol, 1, '', '×', 0.4, 0.8) : '–', 1609, 328, '0.35,0.6')}
      ${st2('DAILY RANGE', isNum(x.atrPct) ? cnt(x.atrPct, 1, '', '%', 0.4, 0.8) : '–', 1360, 460, '0.4,0.65')}
      ${st2('STOP DISTANCE', stopDist !== null ? cnt(Math.abs(stopDist), 0, short ? '+' : '−', '%', 0.45, 0.85, 'down') : '–', 1609, 460, '0.45,0.7')}
      <div class="card y abs" data-a="0.5,0.75" style="left:1360px;top:594px;width:484px;height:252px;padding:16px 22px"><div class="lab" style="color:var(--amb)">WHY IT MADE THE LIST</div>
        ${row('Uptrend', `${sgn(x.vs200)} ${x.vs200 >= 0 ? 'above' : 'below'} its 200-day average`, '0.55,0.8')}${row('Sharp drop', `${sgn(x.chg5d)} over five sessions`, '0.62,0.87')}${row('Capitulation', esc(cap), '0.69,0.94')}</div>
      ${[['ENTRY', '3–5 min after the open, only if within 2% of ' + money(x.close), 'b'], ['TARGET', sgnLevel(short, p.target, 4), short ? 'r' : 'g'], ['STOP', '3 ATR · ' + money(p.stop), short ? 'g' : 'r'], ['EXIT', 'Close of day 3', 'a']].map((b, i) => `<div class="card ${b[2] === 'g' ? 'g' : b[2] === 'r' ? 'r' : b[2] === 'a' ? 'y' : ''} abs" data-a="${0.5 + i * 0.07},${0.75 + i * 0.07}" style="left:${80 + i * 456}px;top:862px;width:432px;height:112px;padding:14px 26px"><div class="lab" style="font-size:16px">${b[0]}</div><div style="font-size:${b[0] === 'ENTRY' ? 21 : 29}px;font-weight:700;margin-top:4px;line-height:1.2" class="${b[2] === 'g' ? 'up' : b[2] === 'r' ? 'down' : ''}">${esc(b[1])}</div></div>`).join('')}`, ep.date);
  },
  summary: (s, ep) => {
    const rows = s.data.rows || [];
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:120px"><div class="kick">${esc(s.data.kick || "TODAY'S SCREEN")}</div><div class="h2" style="margin-top:10px">${esc(s.data.title || 'All S&P 500 setups')}</div></div>
      ${s.data.note ? `<div class="abs" data-a="0.1,0.4" style="left:80px;top:290px"><span class="chip b" style="font-size:24px">${esc(s.data.note)}</span></div>` : ''}
      <div class="card abs" data-a="0.15,0.5" style="left:80px;top:${s.data.note ? 360 : 300}px;width:1760px;padding:30px 40px"><table><thead><tr><th>#</th><th>TICKER</th><th>5-DAY MOVE</th><th>VS 200-DAY</th><th>RSI</th><th>SIGNAL CLOSE</th><th>STOP</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="mut">${i + 1}</td><td style="font-weight:800;color:#7FE3FF;text-align:left">${esc(r.ticker)}</td><td class="${cls(r.chg5d)}">${sgn(r.chg5d)}</td><td>${sgn(r.vs200)}</td><td>${isNum(r.rsi) ? r.rsi.toFixed(0) : '–'}</td><td>${money(r.close)}</td><td class="down">${isNum(r.stopDist) ? '−' + Math.abs(r.stopDist).toFixed(0) + '%' : '–'}</td></tr>`).join('')}</tbody></table></div>`, ep.date);
  },
  outcomes: (s, ep) => {
    const d = s.data, rows = d.rows || [], mx = Math.max(5, ...rows.map(r => Math.abs(r.pct)));
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:150px"><div class="kick">TESTED RULES, EVERY SIGNAL</div><div class="h2" style="margin-top:12px">How the signals played out</div></div>
      ${stat('COMPLETED', cnt(d.n, 0, '', '', 0.1, 0.5), 'signals', 80, 330, 360, '0.1,0.4')}${stat('HIT TARGET', cnt(d.hit, 0, '', '', 0.15, 0.55, 'up'), '', 80, 500, 360, '0.15,0.45')}${stat('HIT STOP', cnt(d.stop, 0, '', '', 0.2, 0.6, 'down'), '', 80, 670, 360, '0.2,0.5')}${stat('AVERAGE', cnt(d.avg, 2, d.avg > 0 ? '+' : '', '%', 0.25, 0.65, cls(d.avg)), 'per trade', 80, 840, 360, '0.25,0.55')}
      <div class="card abs" data-a="0.1,0.4" style="left:480px;top:330px;width:1360px;height:660px;padding:30px 40px">${rows.map((r, i) => { const w = Math.abs(r.pct) / mx * 520; return `<div style="display:flex;align-items:center;height:${Math.min(50, 600 / Math.max(rows.length, 1))}px"><div style="width:150px;font-weight:800;font-size:30px">${esc(r.ticker)}</div><div style="width:540px;position:relative;height:100%"><div data-w="${0.2 + i * 0.03},${0.6 + i * 0.03}" data-max="${w.toFixed(1)}" style="position:absolute;top:8px;bottom:8px;${r.pct >= 0 ? 'left:0' : 'right:0'};width:0;border-radius:8px;background:${r.pct >= 0 ? 'var(--up)' : 'var(--down)'}"></div></div><div style="width:150px;text-align:right;font-weight:700;font-size:30px" class="${cls(r.pct)}">${sgn(r.pct)}</div><div class="mut" style="margin-left:24px;font-size:24px">${r.state === 'target' ? 'target' : r.state === 'stop' ? 'stop' : 'day 3 close'}</div></div>`; }).join('')}</div>`, ep.date);
  },
  watch: (s, ep) => {
    const w = s.data.watch || [], m = s.data.market;
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:150px"><div class="kick">NOT A FORECAST</div><div class="h2" style="margin-top:12px">What to watch</div></div>
      ${m && isNum(m.chg20d) ? `<div class="abs" data-a="0.1,0.4" style="left:80px;top:300px"><span class="chip ${m.chg20d <= 0 ? 'a' : 'b'}" style="font-size:30px;padding:14px 26px">S&amp;P 500 over 20 sessions ${sgn(m.chg20d)}</span></div>` : ''}
      <div class="abs" style="left:80px;top:410px;width:1760px;display:grid;grid-template-columns:repeat(3,1fr);gap:24px">${w.length ? w.map((x, i) => `<div class="card" data-a="${0.2 + i * 0.07},${0.5 + i * 0.07}" style="padding:30px 34px"><div class="num" style="font-size:54px">${esc(x.ticker)}</div><div style="font-size:30px;margin-top:6px"><span class="down">${sgn(x.r5)}</span> <span class="mut">5-day</span></div><div style="font-size:26px" class="mut">${sgn(x.vs200)} vs 200-day</div></div>`).join('') : '<div class="card" data-a="0.2,0.5" style="padding:40px;grid-column:1/-1;font-size:36px">No stocks are close to triggering the screen right now.</div>'}</div>
      <div class="abs mut" data-a="0.6,0.9" style="left:80px;top:900px;font-size:26px;width:1700px">Still above the 200-day line and down 6.5–10% over five sessions: one more down day could trigger the screen. Nothing here is a signal until it prints after the close.</div>`, ep.date);
  },
  stats: (s, ep) => {
    const d = s.data;
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:150px"><div class="kick">BACKTEST</div><div class="h2" style="margin-top:12px">What history says</div></div>
      <div class="card abs" data-a="0.15,0.45" style="left:80px;top:330px;width:860px;height:420px;padding:50px"><div class="lab">WINNING TRADES</div><div class="num up" style="font-size:190px;line-height:1.1">${cnt(d.winRate, 0, '', '%', 0.2, 0.7)}</div></div>
      <div class="card abs" data-a="0.3,0.6" style="left:980px;top:330px;width:860px;height:420px;padding:50px"><div class="lab">AVERAGE PER TRADE</div><div class="num" style="font-size:190px;line-height:1.1">${cnt(d.avgPct, 1, '+', '%', 0.3, 0.8)}</div></div>
      <div class="abs mut" data-a="0.55,0.85" style="left:80px;top:790px;width:1740px;font-size:28px;line-height:1.4">${esc(d.period)}. Losses happen, and in sharp sell-offs several signals can lose together, so position size matters more than any single pick.</div>`, ep.date);
  },
  outro: (s, ep) => frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:230px"><div class="kick">THANKS FOR WATCHING</div><div class="h1" style="font-size:96px;margin-top:16px">${esc(ep.cfg.channelName)}</div></div>
      <div class="card abs" data-a="0.2,0.55" style="left:80px;top:520px;width:1760px;padding:44px 50px;font-size:34px;line-height:1.45;color:#C9D6EE">${esc(s.data.disclaimer || '')}</div>`, ep.date),
  bullets: (s, ep) => {
    const d = s.data, items = d.items || [];
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:140px"><div class="kick">${esc(d.kick || '')}</div><div class="h2" style="margin-top:12px">${esc(d.title || s.heading)}</div></div>
      <div class="abs" style="left:80px;top:310px;width:1760px;display:grid;gap:${items.length > 4 ? 12 : 22}px">${items.map((t, i) => `<div class="card" data-a="${0.15 + i * 0.1},${0.45 + i * 0.1}" style="display:flex;align-items:center;gap:34px;padding:${items.length > 4 ? 16 : 34}px 44px"><div style="flex:none;width:64px;height:64px;border-radius:20px;background:rgba(38,208,255,.16);border:1px solid rgba(38,208,255,.5);display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:800;color:#7FE3FF">${i + 1}</div><div style="font-size:${items.length > 4 ? 38 : 42}px;font-weight:700;line-height:1.25">${esc(t)}</div></div>`).join('')}</div>`, ep.date);
  },
  steps: (s, ep) => {
    const items = s.data.items || [];
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:130px"><div class="kick">THE TESTED PLAN</div><div class="h2" style="margin-top:12px">How to use a signal</div></div>
      <div class="abs" style="left:80px;top:262px;width:1760px;display:grid;gap:10px">${items.map((it, i) => `<div class="card" data-a="${0.12 + i * 0.09},${0.4 + i * 0.09}" style="display:flex;align-items:center;gap:36px;padding:10px 44px"><div class="num" style="flex:none;width:70px;font-size:64px;color:var(--acc)">${i + 1}</div><div><div style="font-size:42px;font-weight:800;line-height:1.15">${esc(it.t)}</div><div class="mut" style="font-size:28px;margin-top:4px">${esc(it.s)}</div></div></div>`).join('')}</div>`, ep.date);
  },
  market: (s, ep) => {
    const d = s.data, m = d.market || {};
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:140px"><div class="kick">THE BACKDROP</div><div class="h2" style="margin-top:12px">S&amp;P 500, this week</div></div>
      ${isNum(m.chg5d) ? `<div class="card abs" data-a="0.1,0.4" style="left:80px;top:320px;width:560px;height:300px;padding:40px"><div class="lab">LAST 5 SESSIONS</div><div class="num ${cls(m.chg5d)}" style="font-size:120px;line-height:1.15;margin-top:10px">${cnt(m.chg5d, 1, m.chg5d > 0 ? '+' : '', '%', 0.15, 0.6, cls(m.chg5d))}</div></div>` : ''}
      ${isNum(m.chg20d) ? `<div class="card abs" data-a="0.2,0.5" style="left:80px;top:650px;width:560px;height:300px;padding:40px"><div class="lab">LAST 20 SESSIONS</div><div class="num" style="font-size:120px;line-height:1.15;margin-top:10px">${cnt(m.chg20d, 1, m.chg20d > 0 ? '+' : '', '%', 0.2, 0.65, cls(m.chg20d))}</div></div>` : ''}
      ${s.spy ? `<div class="card abs" data-a="0.15,0.55" style="left:680px;top:320px;width:1160px;height:630px;padding:34px 40px"><div class="lab">LAST 60 SESSIONS</div><div class="abs" style="left:100px;top:110px">${s.spy}</div></div>` : ''}`, ep.date);
  },
  proof: (s, ep) => {
    const d = s.data;
    const card = (cls2, lab, big, sub, i) => `<div class="card ${cls2} abs" data-a="${0.12 + i * 0.1},${0.45 + i * 0.1}" style="left:${80 + i * 448}px;top:330px;width:416px;height:420px;padding:36px"><div class="lab">${lab}</div><div class="num" style="font-size:112px;line-height:1.1;margin-top:18px;${cls2 === 'g' ? 'color:var(--up);text-shadow:0 0 28px rgba(31,229,165,.55)' : cls2 === 'y' ? 'color:var(--amb);text-shadow:0 0 28px rgba(255,194,26,.55)' : 'color:#7FE3FF;text-shadow:0 0 28px rgba(38,208,255,.55)'}">${big}</div><div class="mut" style="font-size:25px;line-height:1.3;margin-top:14px">${sub}</div></div>`;
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:120px"><div class="kick">THE EVIDENCE</div><div class="h2" style="margin-top:10px">How strongly it is tested</div></div>
      ${card('', 'HISTORY', '10<span style="font-size:52px"> YRS</span>', 'S&amp;P 500 stocks, Oct 2016 to Nov 2026', 0)}
      ${card('', 'SIGNALS TESTED', '2,600+', 'Every signal, same rules, no cherry-picking', 1)}
      ${card('g', 'WINNING TRADES', `${d.winRate}%`, `Average ${d.avgPct}% per trade, before costs and slippage`, 2)}
      ${card('y', 'IDEAS THAT SURVIVED', '1<span style="font-size:52px"> OF 45+</span>', 'Everything else failed the pre-set pass mark and was thrown out', 3)}
      <div class="abs" data-a="0.6,0.9" style="left:80px;top:800px;display:flex;gap:16px;flex-wrap:wrap"><span class="chip b">Final exam: latest 3 years, untouched while tuning</span><span class="chip a">Not a guarantee: about 1 in 3 trades loses</span></div>`, ep.date);
  },
  ai: (s, ep) => {
    const d = s.data, list = (d.ai || []).slice(0, 28), cols = 7;
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:110px"><div class="kick">THE HEALTH CHECK</div><div class="h2" style="margin-top:10px">AI and chip leaders vs their 200-day average</div></div>
      <div class="card r abs" data-a="0.1,0.4" style="left:80px;top:300px;width:1760px;height:130px;display:flex;align-items:center;gap:40px;padding:0 44px"><div class="num down" style="font-size:80px;white-space:nowrap">${d.below} OF ${d.total}</div><div style="font-size:30px;font-weight:700;line-height:1.25">closed Friday <span class="down">below</span> their 200-day average. That's a downtrend, and the screen skips downtrends.</div></div>
      <div class="abs" style="left:80px;top:452px;width:1760px;display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px">${list.map((a, i) => `<div class="card ${a.vs200 >= 0 ? 'g' : 'r'}" data-a="${0.2 + i * 0.015},${0.5 + i * 0.015}" style="padding:10px 14px;border-radius:16px;text-align:center"><div style="font-size:24px;font-weight:800">${esc(a.ticker)}</div><div class="${a.vs200 >= 0 ? 'up' : 'down'}" style="font-size:25px;font-weight:700">${sgn(a.vs200, 0)}</div></div>`).join('')}</div>
      <div class="abs mut" data-a="0.7,0.95" style="left:80px;top:${452 + Math.ceil(list.length / cols) * 100 + 14}px;font-size:22px">Each tile: close vs its own 200-day average. Source: your screener's own price data.</div>`, ep.date);
  },
  warn: (s, ep) => {
    const d = s.data;
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:130px;width:1760px;text-align:center"><div class="kick" style="color:var(--down);text-shadow:0 0 18px rgba(255,59,107,.65)">THE MOST IMPORTANT RULE</div><div class="h1" style="color:var(--down);text-shadow:0 0 40px rgba(255,59,107,.7);margin-top:14px;font-size:118px">NEVER USE LEVERAGE</div></div>
      ${['NO MARGIN', 'NO LEVERAGED ETFS', 'NO OPTIONS'].map((t, i) => `<div class="card r abs" data-a="${0.2 + i * 0.1},${0.5 + i * 0.1}" style="left:${80 + i * 600}px;top:440px;width:560px;height:160px;display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:800;color:#fff">${t}</div>`).join('')}
      <div class="card y abs" data-a="0.55,0.85" style="left:80px;top:650px;width:1760px;padding:34px 44px;font-size:33px;line-height:1.4"><b style="color:var(--amb)">Why:</b> the stop is far away on purpose, much wider than in most strategies. ${d.minStop ? `On ${esc(d.nx)}'s top five it is <b>${d.minStop}% to ${d.maxStop}%</b> below the price.` : ''} Leverage turns a normal stop-out into a loss that can wipe out your account.</div>`, ep.date);
  },
  text: (s, ep) => frame(`<div class="abs" data-a="0,0.4" style="left:80px;top:300px;width:1700px"><div class="h2">${esc(s.heading)}</div><div class="mut" style="font-size:40px;margin-top:24px;line-height:1.4">${esc(s.narration)}</div></div>`, ep.date),
};
function sgnLevel(short, v, p) { return `${short ? '−' : '+'}${p}% · ${money(v)}`; }

function sceneHtml(scene, ep, dir) {
  TAPE = ep.tape || '';
  const body = (SCENES[scene.type] || SCENES.text)(scene, ep);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss(dir)}${CSS}</style></head><body>${body}<script>${ANIM_JS}</script></body></html>`;
}

/** Attach chart svg to setup scenes: last 50 bars + 200-day average computed from the full series. */
const rsiSeries = (c, n = 14) => { const out = c.map(() => null); if (c.length <= n) return out; let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; } g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l); for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return out; };
function prepareCharts(ep, barsBySym) {
  for (const s of ep.scenes) {
    if (s.type !== 'setup') continue;
    const bars = barsBySym[s.data.setup.ticker];
    if (!bars || bars.length < 60) throw new Error(`Not enough price history to chart ${s.data.setup.ticker}`);
    const c = bars.map(b => b.c), ma = sma(c, 200), m20 = sma(c, 20), rs = rsiSeries(c), va = sma(bars.map(b => b.v || 0), 20);
    const view = bars.map((b, i) => ({ ...b, sma: ma[i], ma20: m20[i], rsi: rs[i], vavg: va[i] })).slice(-70);
    const m = ma[ma.length - 1];
    s.chart = chartSvg2(view, s.data.plan, 1230, 630, isNum(m) ? m.toFixed(m >= 100 ? 0 : 2) : '');
    s.view = view;
  }
  const spyBars = barsBySym.SPY;
  if (spyBars && spyBars.length >= 30) {
    const closes = spyBars.slice(-60).map(b => b.c);
    ep.spyCloses = closes;
    for (const s of ep.scenes) { if (s.type === 'intro') s.spy = areaSvg(closes, 760, 370, closes[closes.length - 1] >= closes[0]); if (s.type === 'market') s.spy = areaSvg(closes, 960, 440, closes[closes.length - 1] >= closes[0]); }
  }
}

/* ------------------------------------------------------------------ video */
async function renderEpisode(ep, outDir, { chromium, keepFrames = false } = {}) {
  const work = path.join(outDir, '_work'); fs.mkdirSync(work, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const clips = [];
  try {
    for (let i = 0; i < ep.scenes.length; i++) {
      const sc = ep.scenes[i], dir = path.join(work, `s${String(i).padStart(2, '0')}`); fs.mkdirSync(dir, { recursive: true });
      const html = path.join(dir, 'scene.html'); fs.writeFileSync(html, sceneHtml(sc, ep, dir));
      await page.goto('file://' + html); await page.evaluate(() => document.fonts.ready);
      const n = Math.round(ANIM * FPS);
      for (let f = 0; f <= n; f++) { await page.evaluate(p => window.setP(p), f / n); await page.screenshot({ path: path.join(dir, `f${String(f).padStart(4, '0')}.png`) }); }
      const dur = sc.dur, hold = Math.max(0, dur - ANIM), clip = path.join(work, `clip${String(i).padStart(2, '0')}.mp4`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'), '-vf', `tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)},fade=t=in:st=0:d=0.3,fade=t=out:st=${(dur - 0.3).toFixed(3)}:d=0.3,format=yuv420p`, '-t', dur.toFixed(3), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', clip]);
      clips.push(clip);
      if (!keepFrames) for (const f of fs.readdirSync(dir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(dir, f));
    }
    // thumbnail (1280x720)
    const th = path.join(work, 'thumb.html'); fs.writeFileSync(th, thumbHtml(ep, work));
    await page.setViewportSize({ width: 1280, height: 720 }); await page.goto('file://' + th); await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(outDir, 'thumbnail.png') });
  } finally { await browser.close(); }
  const list = path.join(work, 'list.txt'); fs.writeFileSync(list, clips.map(c => `file '${c}'`).join('\n'));
  const out = path.join(outDir, 'visuals.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', out]);
  return out;
}


async function renderStills(ep, outDir, { chromium }) {
  const work = path.join(outDir, '_work_stills'), dirOut = path.join(outDir, 'stills'); fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(dirOut, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    for (let i = 0; i < ep.scenes.length; i++) {
      const dir = path.join(work, `s${i}`); fs.mkdirSync(dir, { recursive: true });
      const html = path.join(dir, 'scene.html'); fs.writeFileSync(html, sceneHtml(ep.scenes[i], ep, dir));
      await page.goto('file://' + html); await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.setP(1)); await page.waitForTimeout(60);
      await page.screenshot({ path: path.join(dirOut, `scene-${i}.jpg`), type: 'jpeg', quality: 72 });
    }
  } finally { await browser.close(); fs.rmSync(work, { recursive: true, force: true }); }
}

function thumbHtml(ep, dir) {
  const t = ep.tickers.slice(0, 3);
  const first = ep.scenes.find(x => x.view), art = first ? miniCandles(first.view.slice(-34), 600, 520) : (ep.spyCloses ? areaSvg(ep.spyCloses, 600, 400, ep.spyCloses[ep.spyCloses.length - 1] >= ep.spyCloses[0]) : '');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss(dir)}${CSS.replace(/html,body\{width:1920px;height:1080px/, 'html,body{width:1280px;height:720px')}</style></head><body>
    <div class="grid"></div>
    <div class="abs" style="left:64px;top:70px"><div class="kick" style="font-size:30px">${esc(ep.mode === 'weekly' ? 'WEEKLY REVIEW' : ep.mode === 'welcome' ? 'START HERE' : 'DAILY SCREEN')}</div></div>
    <div class="abs" style="left:64px;top:130px;width:1150px"><div class="h1" style="font-size:150px;width:620px">${ep.mode === 'weekly' ? 'WEEK IN<br><span style="color:var(--acc)">REVIEW</span>' : ep.mode === 'welcome' ? 'TRADE<br><span style="color:var(--acc)">WITH BK</span>' : 'DIP<br><span style="color:var(--acc)">SIGNALS</span>'}</div></div>
    <div class="abs" style="left:64px;top:520px;display:flex;gap:16px">${t.map(x => `<span class="chip g" style="font-size:44px;padding:16px 30px">${esc(x)}</span>`).join('')}</div>
    <div class="abs" style="left:64px;bottom:44px;font-size:34px;font-weight:700;color:var(--mut)">${esc(ep.date)}</div>
    ${art ? `<div class="abs" style="left:640px;top:70px;width:600px;height:560px;opacity:.95">${art}</div>` : ''}</body></html>`;
}

module.exports = { chartSvg2, renderStills, prepareCharts, renderEpisode, sceneHtml, chartSvg, FPS, ANIM };
