'use strict';
const NAMES_R = require('./names');
/* Scene HTML, frame capture (Chromium) and video assembly (ffmpeg). */
const fs = require('fs');
const path = require('path');
const { cues } = require('./cues');
const { execFileSync } = require('child_process');
const { sma } = require('./data');
const { NEON, logoSvg, bgCandles } = require('./brand');
let TAPE = '';

const W = 1920, H = 1080, FPS = 30, ANIM = 2.4, FRAME_FPS = 8, FRAME_N = 4;
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
function items(){const L=[];
  document.querySelectorAll('[data-a]').forEach(el=>{const [s,e]=el.dataset.a.split(',').map(Number);L.push({el,s,e,k:'a'});});
  document.querySelectorAll('[data-w]').forEach(el=>{const [s,e]=el.dataset.w.split(',').map(Number);L.push({el,s,e,k:'w'});});
  document.querySelectorAll('[data-count]').forEach(el=>{const q=el.dataset.count.split('|');L.push({el,s:parseFloat(q[5]),e:parseFloat(q[6]),k:'c',q});});
  document.querySelectorAll('[data-d]').forEach(el=>{const [s,e]=el.dataset.d.split(',').map(Number);L.push({el,s,e,k:'d'});});
  const rv=document.getElementById('rv');if(rv)L.push({el:rv,s:0,e:0.55,k:'r'});
  return L;}
function paint(it,t){const el=it.el;
  if(it.k==='a'){el.style.opacity=t;el.style.transform='translateY('+((1-t)*26)+'px)';}
  else if(it.k==='w'){el.style.width=(t*parseFloat(el.dataset.max))+'px';}
  else if(it.k==='c'){const [from,to,d,pre,suf]=it.q;el.textContent=fmt(parseFloat(from)+(parseFloat(to)-parseFloat(from))*t,parseInt(d),pre,suf);}
  else if(it.k==='d'){const l=el.getTotalLength();el.style.strokeDasharray=l+' '+l;el.style.strokeDashoffset=l*(1-t);}
  else if(it.k==='r'){el.setAttribute('width',t*parseFloat(el.dataset.max));}}
window.setP=function(p){items().forEach(it=>paint(it,it.k==='r'?ease(p/0.55):ease((p-it.s)/(it.e-it.s))));};
/* beats: header = beat 0, then one beat per distinct start time, so items can appear one by one */
window.beatInfo=function(){const st=[...new Set(items().filter(i=>i.s>=0.12).map(i=>Math.round(i.s*100)/100))].sort((a,b)=>a-b),M=8,n=st.length,B=Math.min(M,n);
  return {B,starts:st,of:s=>1+Math.min(B-1,Math.floor(st.indexOf(Math.round(s*100)/100)*B/Math.max(1,n)))};};
window.beatTexts=function(){const isIt=n=>n.hasAttribute&&(n.hasAttribute('data-a')||n.hasAttribute('data-w')||n.hasAttribute('data-d')||n.hasAttribute('data-count')),own=el=>{let s='';(function walk(n){n.childNodes.forEach(c=>{if(c.nodeType===3)s+=c.nodeValue+' ';else if(c.nodeType===1&&!isIt(c))walk(c);});})(el);return s.replace(/\\s+/g,' ').trim();};const info=window.beatInfo(),o=Array.from({length:info.B},()=>[]);items().forEach(it=>{if(it.s<0.12)return;const g=info.of(it.s);if(g>=1&&o[g-1])o[g-1].push(own(it.el));});return o.map(a=>a.join(' '));};
window.setB=function(k,q){const info=window.beatInfo();items().forEach(it=>{const g=it.s<0.12?0:info.of(it.s);
  const t=g===0?(k===0?ease(q):1):(g<k?1:(g===k?ease(q):0));paint(it,t);});};
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
function pctLinesSvg(acct, spyS, cw, ch) {
  const all = acct.concat(spyS.filter(v => typeof v === 'number')).concat([0]), lo0 = Math.min(...all), hi0 = Math.max(...all), pad = (hi0 - lo0) * 0.15 || 1, lo = lo0 - pad, hi = hi0 + pad, n = acct.length;
  const x = i => 10 + i * ((cw - 20) / Math.max(1, n - 1)), y = v => 10 + (hi - v) / (hi - lo) * (ch - 20);
  const path = (arr, col, w, dash) => { let d = '', on = false; arr.forEach((v, i) => { if (typeof v !== 'number') { on = false; return; } d += `${on ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; on = true; }); return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" ${dash ? 'stroke-dasharray="14 10"' : ''}/>`; };
  const lastA = acct[n - 1];
  return `<svg width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><defs><clipPath id="rvc"><rect id="rv" x="0" y="0" width="0" height="${ch}" data-max="${cw}"/></clipPath></defs><line x1="10" x2="${cw - 10}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="rgba(255,255,255,.25)" stroke-width="2" stroke-dasharray="6 8"/><g clip-path="url(#rvc)">${path(spyS, '#FFC21A', 4, true)}${path(acct, '#26D0FF', 6, false)}</g><circle cx="${x(n - 1).toFixed(1)}" cy="${y(lastA).toFixed(1)}" r="9" fill="#26D0FF"/></svg>
    <div style="position:absolute;right:20px;top:-44px;font-size:22px;font-weight:700;display:flex;gap:26px"><span style="color:#26D0FF">● Paper account</span><span style="color:#FFC21A">┅ S&amp;P 500</span></div>`;
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
      <div class="abs" data-a="0,0.25" style="left:80px;top:100px;display:flex;align-items:center;gap:22px"><div class="h2" style="font-size:70px;color:#7FE3FF;text-shadow:0 0 28px rgba(38,208,255,.6)">${rank ? '#' + rank + ' ' : ''}${esc(x.ticker)}</div>${NAMES_R[x.ticker] ? `<div class="mut" style="font-size:34px;font-weight:700;white-space:nowrap">${esc(NAMES_R[x.ticker])}</div>` : ''}<span class="chip ${short ? 'r' : 'g'}">${short ? 'SHORT SETUP' : 'STRONG STOCK, SHORT DIP'}</span>${tag}${total ? `<span class="chip">${rank} of ${total} signals</span>` : ''}</div>
      <div class="card abs" data-a="0,0.2" style="left:80px;top:196px;width:1250px;height:650px;padding:8px 10px">${s.chart}</div>
      ${st2('5-DAY DROP', cnt(x.chg5d, 1, x.chg5d > 0 ? '+' : '', '%', 0.25, 0.65, cls(x.chg5d)), 1360, 196, '0.2,0.45')}
      ${st2('ABOVE TREND', cnt(x.vs200, 1, x.vs200 > 0 ? '+' : '', '%', 0.3, 0.7, x.vs200 >= 0 ? 'up' : 'down'), 1609, 196, '0.25,0.5')}
      ${st2('OVERSOLD (RSI)', cnt(x.rsi || 0, 0, '', '', 0.35, 0.75), 1360, 328, '0.3,0.55')}
      ${st2('VOLUME VS USUAL', isNum(x.relVol) ? cnt(x.relVol, 1, '', '×', 0.4, 0.8) : '–', 1609, 328, '0.35,0.6')}
      ${st2('USUAL DAILY SWING', isNum(x.atrPct) ? cnt(x.atrPct, 1, '', '%', 0.4, 0.8) : '–', 1360, 460, '0.4,0.65')}
      ${st2('SAFETY EXIT', stopDist !== null ? cnt(Math.abs(stopDist), 0, short ? '+' : '−', '%', 0.45, 0.85, 'down') : '–', 1609, 460, '0.45,0.7')}
      <div class="card y abs" data-a="0.5,0.75" style="left:1360px;top:594px;width:484px;height:252px;padding:16px 22px"><div class="lab" style="color:var(--amb)">WHY IT MADE THE LIST</div>
        ${row('Strong stock', `${sgn(x.vs200)} ${x.vs200 >= 0 ? 'above' : 'below'} its long-term average`, '0.55,0.8')}${row('Sold off fast', `${sgn(x.chg5d)} over five days`, '0.62,0.87')}${row('Sellers look tired', esc(cap), '0.69,0.94')}</div>
      ${[['ENTRY', '3–5 min after the open, only if within 2% of ' + money(x.close), 'b'], ['TARGET', sgnLevel(short, p.target, 4), short ? 'r' : 'g'], ['SAFETY EXIT (IF IT KEEPS FALLING)', money(p.stop), short ? 'g' : 'r'], ['SELL BY', 'Close of day 3', 'a']].map((b, i) => `<div class="card ${b[2] === 'g' ? 'g' : b[2] === 'r' ? 'r' : b[2] === 'a' ? 'y' : ''} abs" data-a="${0.5 + i * 0.07},${0.75 + i * 0.07}" style="left:${80 + i * 456}px;top:862px;width:432px;height:112px;padding:14px 26px"><div class="lab" style="font-size:16px">${b[0]}</div><div style="font-size:${b[0] === 'ENTRY' ? 21 : 29}px;font-weight:700;margin-top:4px;line-height:1.2" class="${b[2] === 'g' ? 'up' : b[2] === 'r' ? 'down' : ''}">${esc(b[1])}</div></div>`).join('')}`, ep.date);
  },
  summary: (s, ep) => {
    const rows = s.data.rows || [];
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:120px"><div class="kick">${esc(s.data.kick || "TODAY'S SCREEN")}</div><div class="h2" style="margin-top:10px">${esc(s.data.title || 'All S&P 500 setups')}</div></div>
      ${s.data.note ? `<div class="abs" data-a="0.1,0.4" style="left:80px;top:290px"><span class="chip b" style="font-size:24px">${esc(s.data.note)}</span></div>` : ''}
      <div class="card abs" data-a="0.15,0.5" style="left:80px;top:${s.data.note ? 360 : 300}px;width:1760px;padding:30px 40px"><table><thead><tr><th>#</th><th>TICKER</th><th>5-DAY MOVE</th><th>VS 200-DAY</th><th>RSI</th><th>SIGNAL CLOSE</th><th>STOP</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="mut">${i + 1}</td><td style="font-weight:800;color:#7FE3FF;text-align:left">${esc(r.ticker)}</td><td class="${cls(r.chg5d)}">${sgn(r.chg5d)}</td><td>${sgn(r.vs200)}</td><td>${isNum(r.rsi) ? r.rsi.toFixed(0) : '–'}</td><td>${money(r.close)}</td><td class="down">${isNum(r.stopDist) ? '−' + Math.abs(r.stopDist).toFixed(0) + '%' : '–'}</td></tr>`).join('')}</tbody></table></div>`, ep.date);
  },
  chartnote: (s, ep) => {
    const d = s.data, c = d.c, n = c.length, cw = 1700, H1 = 470, ph = d.vol ? H1 - 120 : H1, col = d.col || '#26D0FF';
    const hl = d.hl || d.hlines || [];
    const vals = c.concat(hl.map(h => h.v), d.ma20 ? d.ma20.filter(v => v) : [], d.ma50 ? d.ma50.filter(v => v) : []);
    const lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = (hi0 - lo0) * 0.14 || 1, lo = lo0 - pad, hi = hi0 + pad;
    const x = i => 24 + i * ((cw - 48) / Math.max(1, n - 1)), y = v => 18 + (hi - v) / (hi - lo) * (ph - 36);
    const path = (arr, w, stroke, dash) => { let p = '', on = false; arr.forEach((v, i) => { if (typeof v !== 'number') { on = false; return; } p += `${on ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; on = true; }); return `<path d="${p}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" ${dash ? 'stroke-dasharray="12 9"' : ''}/>`; };
    const area = `<path d="${c.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')}L${x(n - 1).toFixed(1)} ${ph}L${x(0).toFixed(1)} ${ph}Z" fill="url(#cg)"/>`;
    let vb = '';
    if (d.vol) { const vm = Math.max(...d.vol), bw = Math.max(2, (cw - 48) / n * 0.62); d.vol.forEach((v, i) => { const h = Math.max(2, v / vm * 96), hot = i === d.volMark; vb += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(H1 - 8 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${hot ? '#FFC21A' : col}" opacity="${hot ? 1 : 0.38}"/>`; }); vb += `<text x="26" y="${ph + 14}" fill="#7F93B8" font-size="18" font-weight="700" letter-spacing="2">TRADING VOLUME</text>`; }
    const hls = hl.map(h => `<line x1="24" x2="${cw - 24}" y1="${y(h.v).toFixed(1)}" y2="${y(h.v).toFixed(1)}" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-dasharray="10 8"/><text x="${cw - 30}" y="${(y(h.v) - 10).toFixed(1)}" text-anchor="end" fill="#B8C6E0" font-size="20" font-weight="800" letter-spacing="2">${esc(h.label)}</text>`).join('');
    const svg = `<svg width="${cw}" height="${H1}" viewBox="0 0 ${cw} ${H1}"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".30"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient><clipPath id="rvc"><rect id="rv" x="0" y="0" width="0" height="${H1}" data-max="${cw}"/></clipPath></defs>${hls}<g clip-path="url(#rvc)">${area}${d.ma20 ? path(d.ma20, 4, '#FFC21A') : ''}${d.ma50 ? path(d.ma50, 4, '#B36BFF') : ''}${path(c, 6, col)}${vb}</g></svg>`;
    const colOf = { warn: '#FF3B6B', good: '#1FE5A5', info: '#26D0FF', key: '#FFC21A' };
    const marks = (d.marks || []).slice().sort((a, b) => a.i - b.i);
    const placed = [];
    const mk = marks.map((m, j) => {
      const st = (0.2 + j * (0.5 / Math.max(1, marks.length))).toFixed(2), en = (parseFloat(st) + 0.2).toFixed(2), cl = colOf[m.kind] || col;
      const px = 30 + x(m.i), py = 64 + y(c[m.i]), lw = Math.round(Math.max(String(m.label).length * 15, String(m.sub || '').length * 12.5) + 44), lh = m.sub ? 84 : 54;
      const cx = Math.max(20, Math.min(1760 - lw, px - lw / 2));
      const upper = y(c[m.i]) < ph * 0.5;
      const cands = (upper ? [[cx, py + 30], [cx, py - 30 - lh]] : [[cx, py - 30 - lh], [cx, py + 30]])
        .concat([[px + 34, py - lh / 2], [px - 34 - lw, py - lh / 2], [px + 34, py + 40], [px + 34, py - 40 - lh], [px - 34 - lw, py + 40], [px - 34 - lw, py - 40 - lh], [cx, py - 30 - lh - 100], [cx, py + 130]]).concat([40, 140, 240, 340, 440].map(t => [Math.min(1766 - lw, Math.max(px + 80, 900)), t]));
      const dots = marks.map((q, k2) => ({ k2, x: 30 + x(q.i) - 20, y: 64 + y(c[q.i]) - 20 }));
      const ok = (X, t) => X >= 14 && X + lw <= 1766 && t >= 14 && t + lh <= 566 && !dots.some(q => q.k2 !== j && X < q.x + 40 && X + lw > q.x && t < q.y + 40 && t + lh > q.y) && !placed.some(p => X < p.x + p.w + 10 && X + lw + 10 > p.x && t < p.y + p.h + 8 && t + lh + 8 > p.y);
      const pick = cands.find(q => ok(q[0], q[1])) || cands[0], lx = pick[0], ly = pick[1];
      placed.push({ x: lx, y: ly, w: lw, h: lh });
      const beside = lx >= px + 20 || lx + lw <= px - 20;
      const lineEl = beside ? `<div class="abs" data-a="${st},${en}" style="left:${lx > px ? px : lx + lw}px;top:${py - 1}px;width:${Math.abs((lx > px ? lx : px) - (lx > px ? px : lx + lw))}px;height:2px;background:${cl};opacity:.8"></div>` : `<div class="abs" data-a="${st},${en}" style="left:${px - 1}px;top:${ly > py ? py : ly + lh}px;width:2px;height:${Math.max(0, ly > py ? ly - py : py - (ly + lh))}px;background:${cl};opacity:.8"></div>`;
      return `${lineEl}
      <div class="abs" data-a="${st},${en}" style="left:${px - 12}px;top:${py - 12}px;width:24px;height:24px;border-radius:50%;background:${cl};box-shadow:0 0 26px ${cl},0 0 6px #fff inset"></div>
      <div class="abs" data-a="${st},${en}" style="left:${lx}px;top:${ly}px;width:${lw}px;line-height:1.2"><div style="background:rgba(6,12,24,.94);border:2px solid ${cl};border-radius:14px;padding:8px 16px;box-shadow:0 0 22px ${cl}55;text-align:center"><div style="font-weight:800;font-size:25px;color:${cl};white-space:nowrap">${esc(m.label)}</div>${m.sub ? `<div style="font-size:21px;font-weight:600;color:#C9D6EE;white-space:nowrap">${esc(m.sub)}</div>` : ''}</div></div>`;
    }).join('');
    const nM = (d.marks || []).length, pair = !!d.pair && nM >= 1;
    const cards = (d.cards || []).map((q, j) => { const st = pair ? (0.2 + Math.max(0, nM - (d.cards || []).length + j) * (0.5 / Math.max(1, nM))).toFixed(2) : (0.72 + j * 0.07).toFixed(2); return `<div class="card abs" data-a="${st},${(parseFloat(st) + 0.2).toFixed(2)}" style="left:${80 + j * 600}px;top:878px;width:560px;height:104px;padding:14px 26px;display:flex;align-items:center;justify-content:space-between"><div class="lab" style="white-space:nowrap">${esc(q.lab)}</div><div class="num ${q.c || ''}" style="font-size:46px;white-space:nowrap">${esc(q.val)}</div></div>`; }).join('');
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:130px"><div class="kick">${esc(d.kick || '')}</div><div class="h2" style="margin-top:10px;font-size:68px">${esc(d.title || '')}</div></div>
      <div class="card abs" data-a="0.02,0.3" style="left:80px;top:270px;width:1760px;height:580px;padding:0"><div class="abs" style="left:30px;top:64px">${svg}</div>${d.ma20 ? '<div class="abs" style="left:34px;top:12px;font-size:21px;font-weight:700;display:flex;gap:26px"><span style="color:#FFC21A">━ 20-day average</span><span style="color:#B36BFF">━ 50-day average</span></div>' : ''}${mk}</div>
      ${cards}`, ep.date);
  },
  search: (s, ep) => {
    const d = s.data, q = d.query || 'VIX index today';
    const band = (x, w, col, t1, t2, st) => `<div class="abs" data-a="${st},${(st + 0.2).toFixed(2)}" style="left:${x}px;top:0;width:${w}px"><div style="height:34px;border-radius:10px;background:${col};box-shadow:0 0 24px ${col}88"></div><div style="margin-top:14px;font-weight:800;font-size:30px;color:${col}">${t1}</div><div style="font-weight:600;font-size:22px;color:var(--mut)">${t2}</div></div>`;
    const step = (n, t, st, col) => `<div class="abs" data-a="${st},${(st + 0.2).toFixed(2)}" style="left:0;top:${(n - 1) * 128}px;width:740px;display:flex;align-items:center;gap:24px"><div style="flex:none;width:62px;height:62px;border-radius:50%;border:3px solid ${col};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:32px;color:${col}">${n}</div><div style="font-weight:700;font-size:31px;line-height:1.25">${t}</div></div>`;
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:130px"><div class="kick">${esc(d.kick || '')}</div><div class="h2" style="margin-top:10px;font-size:68px">${esc(d.title || '')}</div></div>
      <div class="abs" data-a="0.1,0.3" style="left:80px;top:318px;width:1280px;height:116px;border-radius:58px;background:#F4F8FF;box-shadow:0 0 60px rgba(38,208,255,.35)"></div>
      <svg class="abs" data-a="0.1,0.3" style="left:122px;top:350px" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#5B6B86" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>
      <div class="abs" style="left:206px;top:338px;height:76px;overflow:hidden;white-space:nowrap" data-w="0.3,0.6" data-max="1100"><div style="font-weight:600;font-size:54px;line-height:76px;color:#14213B">${esc(q)}</div></div>
      <div class="abs" data-a="0.3,0.5" style="left:1390px;top:352px"><span class="chip" style="font-size:22px;padding:8px 20px">ANY SEARCH ENGINE OR APP</span></div>
      <div class="card abs" data-a="0.5,0.7" style="left:80px;top:480px;width:960px;height:480px;padding:34px 40px"><div class="lab">ROUGH RULE OF THUMB</div>
        <div class="abs" style="left:40px;top:110px;width:880px">${band(0, 270, '#1FE5A5', 'CALM', 'under about 20', 0.5)}${band(300, 270, '#FFC21A', 'NERVOUS', 'about 20 to 30', 0.5)}${band(600, 280, '#FF3B6B', 'FEAR', '30 or more', 0.5)}</div>
        <div class="abs" data-a="0.62,0.82" style="left:40px;top:300px;width:880px;font-weight:600;font-size:30px;line-height:1.35;color:var(--text)">The exact number matters less than the <span style="color:var(--amb)">direction</span>.</div>
        <div class="abs" data-a="0.95,1" style="left:40px;top:400px"><span class="chip" style="font-size:18px;padding:5px 16px">GENERAL GUIDE, NOT A SIGNAL</span></div></div>
      <div class="abs" style="left:1100px;top:500px;width:740px;height:440px">${step(1, 'Search <span style="color:var(--acc)">' + esc(q) + '</span>', 0.3, '#26D0FF')}${step(2, 'Line spiking up? <span style="color:#FF3B6B">Not calm yet</span>', 0.74, '#FF3B6B')}${step(3, 'Peaked, now falling? <span style="color:#1FE5A5">Fear is easing</span>', 0.86, '#1FE5A5')}</div>`, ep.date);
  },
  compare: (s, ep) => {
    const d = s.data, rows = d.rows || [];
    const ico = (ok, st) => ok === true ? `<div data-a="${st},${(st + 0.15).toFixed(2)}" style="flex:none;width:76px;height:76px;border-radius:50%;background:#062A1F;border:4px solid #1FE5A5;box-shadow:0 0 26px rgba(31,229,165,.7);display:flex;align-items:center;justify-content:center"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#1FE5A5" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></div>`
      : ok === false ? `<div data-a="${st},${(st + 0.15).toFixed(2)}" style="flex:none;width:76px;height:76px;border-radius:50%;background:#2A0A14;border:4px solid #FF3B6B;box-shadow:0 0 26px rgba(255,59,107,.7);display:flex;align-items:center;justify-content:center"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#FF3B6B" stroke-width="3.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></div>`
      : `<div data-a="${st},${(st + 0.15).toFixed(2)}" style="flex:none;width:76px;height:76px;border-radius:50%;background:#2A2208;border:4px solid #FFC21A;box-shadow:0 0 26px rgba(255,194,26,.6);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:44px;color:#FFC21A">?</div>`;
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:128px"><div class="kick">${esc(d.kick || '')}</div><div class="h2" style="margin-top:8px;font-size:64px">${esc(d.title || '')}</div></div>
      <div class="abs" data-a="0.05,0.3" style="left:1180px;top:196px"><span class="chip g" style="font-size:26px;padding:8px 22px">${esc(d.summary || '')}</span></div>
      <div class="abs" style="left:80px;top:284px;width:1760px;display:grid;gap:10px">${rows.map((o, i) => { const st = 0.14 + i * 0.12; return `<div class="card" data-a="${st.toFixed(2)},${(st + 0.2).toFixed(2)}" style="display:flex;align-items:center;gap:30px;padding:6px 36px;height:100px;border-color:${o.ok === true ? '#1FE5A5aa' : o.ok === false ? '#FF3B6Baa' : '#FFC21Aaa'}">${ico(o.ok, st)}<div style="flex:1"><div style="font-weight:700;font-size:33px;line-height:1.15">${esc(o.label)}</div><div style="font-weight:600;font-size:24px;color:var(--mut);margin-top:2px">${esc(o.note)}</div></div><div style="font-weight:800;font-size:26px;letter-spacing:.12em;color:${o.ok === true ? '#1FE5A5' : o.ok === false ? '#FF3B6B' : '#FFC21A'}">${o.ok === true ? 'TICK' : o.ok === false ? 'NOT YET' : 'YOUR CALL'}</div></div>`; }).join('')}</div>`, ep.date);
  },
  newstest: (s, ep) => {
    const P = { fg: 'M10 90 L40 90 L64 34 L120 30 L190 52 L260 84 L330 112 L390 126', fb: 'M10 70 L50 70 L80 112 L150 124 L230 138 L310 142 L390 148', bb: 'M10 70 L50 70 L80 112 L120 126 L190 108 L270 84 L340 74 L390 68', bg: 'M10 92 L40 92 L64 38 L120 34 L190 30 L260 30 L330 24 L390 22' };
    const cell = (k, x0, y0, head, cap, col, st, tag) => `<div class="card abs" data-a="${st},${(st + 0.2).toFixed(2)}" style="left:${x0}px;top:${y0}px;width:830px;height:300px;padding:18px 26px;border-color:${col}88"><div style="display:flex;justify-content:space-between;align-items:center"><div style="font-weight:800;font-size:30px">${head}</div><span class="chip" style="font-size:16px;opacity:.7">ILLUSTRATION</span></div><div class="abs" style="left:26px;top:62px"><svg width="780" height="190" viewBox="0 0 400 160" preserveAspectRatio="none"><line x1="10" x2="390" y1="${k === 'fg' || k === 'bg' ? 90 : 70}" y2="${k === 'fg' || k === 'bg' ? 90 : 70}" stroke="rgba(255,255,255,.3)" stroke-width="1.4" stroke-dasharray="5 5"/><path data-d="${st},${(st + 0.28).toFixed(2)}" d="${P[k]}" fill="none" stroke="${col}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round" style="filter:drop-shadow(0 0 8px ${col})"/></svg></div><div class="abs" style="left:26px;bottom:14px;font-size:26px;font-weight:700;color:${col}">${cap}</div></div>`;
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:130px"><div class="kick">${esc(s.data.kick || '')}</div><div class="h2" style="margin-top:10px;font-size:68px">${esc(s.data.title || '')}</div></div>
      <div class="abs" data-a="0.05,0.3" style="left:80px;top:268px;font-weight:800;font-size:26px;letter-spacing:.12em;color:#FF3B6B">STILL FALLING</div><div class="abs" data-a="0.05,0.3" style="left:1010px;top:262px;font-weight:800;font-size:26px;letter-spacing:.12em;color:#1FE5A5">BOTTOM FORMING</div>
      ${cell('fg', 80, 305, 'Good news', 'Pops early, fades by the close', '#FF3B6B', 0.2)}
      ${cell('fb', 80, 625, 'Bad news', 'Drops, and keeps dropping', '#FF3B6B', 0.35)}
      ${cell('bb', 1010, 625, 'Bad news', 'Dips, then shrugged off', '#1FE5A5', 0.5)}
      ${cell('bg', 1010, 305, 'Good news', 'Pops, and holds into the close', '#1FE5A5', 0.65)}`, ep.date);
  },
  paper: (s, ep) => {
    const d = s.data, st = (label, val, py, a2) => `<div class="card abs" data-a="${a2}" style="left:80px;top:${py}px;width:420px;height:200px;padding:26px 30px"><div class="lab">${label}</div><div class="num" style="font-size:84px;line-height:1.1;margin-top:10px">${val}</div></div>`;
    const rows = (d.recent || []).map((t, i) => `<div data-a="${0.25 + i * 0.06},${0.55 + i * 0.06}" style="display:flex;align-items:center;gap:20px;height:62px;border-bottom:1px solid rgba(255,255,255,.08)"><div class="mut" style="width:100px;font-size:22px">${esc(t.d)}</div><div style="width:150px;font-weight:800;font-size:34px">${esc(t.ticker)}</div><div class="${cls(t.pct)}" style="width:160px;font-weight:800;font-size:34px">${sgn(t.pct)}</div><div class="mut" style="font-size:24px">${t.how === 'target' ? 'reached the 4% target' : t.how === 'stop' ? 'hit the safety exit' : 'closed on day 3'}</div></div>`).join('');
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:130px"><div class="kick">THE PAPER ACCOUNT</div><div class="h2" style="margin-top:10px">Recent trades, wins and losses</div></div>
      <div class="abs" data-a="0.05,0.4" style="left:80px;top:262px"><span class="chip a" style="font-size:24px">PAPER TRADING · SIMULATED MONEY · NOT A PROMISE OF FUTURE RESULTS</span></div>
      ${st('TRADES CLOSED SO FAR', cnt(d.n, 0, '', '', 0.15, 0.6), 340, '0.1,0.4')}
      ${st('FINISHED IN PROFIT', cnt(d.win, 0, '', '', 0.2, 0.65, 'up') + `<span class="mut" style="font-size:40px"> of ${d.n}</span>`, 570, '0.15,0.45')}
      <div class="card abs" data-a="0.1,0.5" style="left:540px;top:340px;width:1300px;height:650px;padding:20px 40px"><div class="lab" style="margin-bottom:6px">MOST RECENT CLOSED TRADES</div>${rows}</div>`, ep.date);
  },
  outcomes: (s, ep) => {
    const d = s.data, rows = d.rows || [], mx = Math.max(5, ...rows.map(r => Math.abs(r.pct)));
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:150px"><div class="kick">${esc(d.kick || 'TESTED RULES, EVERY SIGNAL')}</div><div class="h2" style="margin-top:12px">${esc(d.title || 'How the signals played out')}</div></div>
      ${stat('COMPLETED', cnt(d.n, 0, '', '', 0.1, 0.5), 'signals', 80, 330, 360, '0.1,0.4')}${stat('HIT TARGET', cnt(d.hit, 0, '', '', 0.15, 0.55, 'up'), '', 80, 500, 360, '0.15,0.45')}${stat('SAFETY EXIT', cnt(d.stop, 0, '', '', 0.2, 0.6, 'down'), '', 80, 670, 360, '0.2,0.5')}${stat('AVERAGE', cnt(d.avg, 2, d.avg > 0 ? '+' : '', '%', 0.25, 0.65, cls(d.avg)), '', 80, 840, 360, '0.25,0.55')}
      <div class="card abs" data-a="0.1,0.4" style="left:480px;top:330px;width:1360px;height:660px;padding:30px 40px">${rows.map((r, i) => { const w = Math.abs(r.pct) / mx * 520; return `<div style="display:flex;align-items:center;height:${Math.min(50, 600 / Math.max(rows.length, 1))}px"><div style="width:150px;font-weight:800;font-size:30px;line-height:1">${esc(r.ticker)}${r.sub ? `<div class="mut" style="font-size:15px;font-weight:600">${esc(r.sub)}</div>` : ''}</div><div style="width:540px;position:relative;height:100%"><div data-w="${0.2 + i * 0.03},${0.6 + i * 0.03}" data-max="${w.toFixed(1)}" style="position:absolute;top:8px;bottom:8px;${r.pct >= 0 ? 'left:0' : 'right:0'};width:0;border-radius:8px;background:${r.pct >= 0 ? 'var(--up)' : 'var(--down)'}"></div></div><div style="width:150px;text-align:right;font-weight:700;font-size:30px" class="${cls(r.pct)}">${sgn(r.pct)}</div><div class="mut" style="margin-left:24px;font-size:24px">${r.state === 'target' ? 'target' : r.state === 'stop' ? 'stop' : 'day 3 close'}</div></div>`; }).join('')}</div>`, ep.date);
  },
  calls: (s, ep) => {
    const d = s.data, rows = (d.rows || []).slice(0, 8), n = rows.length, rh = Math.min(104, Math.floor(640 / Math.max(1, n)));
    const chip = r => r.state === 'target' ? '<span class="chip g">TARGET HIT</span>' : r.state === 'stop' ? '<span class="chip r">SAFETY EXIT</span>' : r.state === 'closed' ? '<span class="chip b">CLOSED, DAY 3</span>' : r.state === 'skip' ? '<span class="chip">SKIPPED: GAPPED UP</span>' : `<span class="chip b">HOLDING, DAY ${r.day || 1} OF 3</span>`;
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:150px"><div class="kick">${esc(d.kick || 'IF YOU FOLLOWED THE PLAN')}</div><div class="h2" style="margin-top:12px">${esc(d.title || 'What happened to our calls')}</div></div>
      <div class="abs lab" data-a="0.08,0.35" style="left:80px;top:300px;width:1760px;display:flex;padding:0 40px"><div style="width:520px">STOCK</div><div style="width:270px;text-align:right">BOUGHT AT</div><div style="width:270px;text-align:right">LAST CLOSE</div><div style="width:240px;text-align:right">RESULT</div><div style="flex:1;text-align:right">STATUS</div></div>
      <div class="abs" style="left:80px;top:340px;width:1760px">${rows.map((r, i) => `<div class="card" data-a="${0.14 + i * 0.07},${0.4 + i * 0.07}" style="display:flex;align-items:center;height:${rh - 10}px;margin-bottom:10px;padding:0 40px"><div style="width:520px;font-weight:800;font-size:38px;line-height:1">${esc(r.ticker)}${r.name ? `<span class="mut" style="font-size:24px;font-weight:600;margin-left:14px">${esc(r.name)}</span>` : ''}</div><div style="width:270px;text-align:right;font-size:32px;font-weight:700">${r.entry != null ? '$' + r.entry.toFixed(2) : '<span class="mut">no entry</span>'}</div><div style="width:270px;text-align:right;font-size:32px;font-weight:700">${typeof r.close === 'number' ? '$' + r.close.toFixed(2) : ''}</div><div style="width:240px;text-align:right;font-size:34px;font-weight:800" class="${r.entry != null ? cls(r.pct) : 'mut'}">${r.entry != null && typeof r.pct === 'number' ? sgn(r.pct) : (typeof r.pct === 'number' ? sgn(r.pct) + ' since' : '')}</div><div style="flex:1;text-align:right">${chip(r)}</div></div>`).join('')}</div>
      <div class="abs mut" data-a="0.7,0.95" style="left:80px;top:${Math.min(1000, 340 + n * rh + 6)}px;font-size:22px">Based on the plan's rules and the first minutes after the open. It is not a record of real trades, and each stock gets until day 3.</div>`, ep.date);
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
      <div class="abs" style="left:80px;top:310px;width:1760px;display:grid;gap:${items.length > 4 ? 12 : 22}px">${items.map((t, i) => `<div class="card" data-a="${0.15 + i * 0.1},${0.45 + i * 0.1}" style="display:flex;align-items:center;gap:34px;padding:${items.length > 4 ? 16 : 34}px 44px"><div style="flex:none;width:64px;height:64px;border-radius:20px;background:rgba(38,208,255,.16);border:1px solid rgba(38,208,255,.5);display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:800;color:#7FE3FF">${i + 1}</div><div style="font-size:${items.length > 4 ? 38 : 42}px;font-weight:700;line-height:1.25">${esc(t)}</div></div>`).join('')}</div>${d.note ? `<div class="abs mut" data-a="0.8,0.95" style="left:80px;top:${items.length > 4 ? 948 : 936}px;font-size:22px;font-weight:600">${esc(d.note)}</div>` : ''}`, ep.date);
  },
  steps: (s, ep) => {
    const items = s.data.items || [];
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:130px"><div class="kick">THE TESTED PLAN</div><div class="h2" style="margin-top:12px">How to use a signal</div></div>
      <div class="abs" style="left:80px;top:262px;width:1760px;display:grid;gap:10px">${items.map((it, i) => `<div class="card" data-a="${0.12 + i * 0.09},${0.4 + i * 0.09}" style="display:flex;align-items:center;gap:36px;padding:10px 44px"><div class="num" style="flex:none;width:70px;font-size:64px;color:var(--acc)">${i + 1}</div><div><div style="font-size:42px;font-weight:800;line-height:1.15">${esc(it.t)}</div><div class="mut" style="font-size:28px;margin-top:4px">${esc(it.s)}</div></div></div>`).join('')}</div>`, ep.date);
  },
  market: (s, ep) => {
    const d = s.data, m = d.market || {};
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:140px"><div class="kick">${isNum(m.chg1d) ? 'PLAIN ENGLISH' : 'THE BACKDROP'}</div><div class="h2" style="margin-top:12px">${isNum(m.chg1d) ? 'The S&amp;P 500 today' : 'S&amp;P 500, this week'}</div></div>
      ${isNum(m.chg1d) ? `<div class="card abs" data-a="0.1,0.4" style="left:80px;top:320px;width:560px;height:300px;padding:40px"><div class="lab">TODAY</div><div class="num ${cls(m.chg1d)}" style="font-size:120px;line-height:1.15;margin-top:10px">${cnt(m.chg1d, 1, m.chg1d > 0 ? '+' : '', '%', 0.15, 0.6, cls(m.chg1d))}</div></div>` : ''}
      ${isNum(m.chg5d) ? `<div class="card abs" data-a="0.1,0.4" style="left:80px;top:${isNum(m.chg1d) ? 650 : 320}px;width:560px;height:300px;padding:40px"><div class="lab">LAST 5 DAYS</div><div class="num ${cls(m.chg5d)}" style="font-size:120px;line-height:1.15;margin-top:10px">${cnt(m.chg5d, 1, m.chg5d > 0 ? '+' : '', '%', 0.15, 0.6, cls(m.chg5d))}</div></div>` : ''}
      ${(isNum(m.chg20d) && !isNum(m.chg1d)) ? `<div class="card abs" data-a="0.2,0.5" style="left:80px;top:650px;width:560px;height:300px;padding:40px"><div class="lab">LAST 20 SESSIONS</div><div class="num" style="font-size:120px;line-height:1.15;margin-top:10px">${cnt(m.chg20d, 1, m.chg20d > 0 ? '+' : '', '%', 0.2, 0.65, cls(m.chg20d))}</div></div>` : ''}
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
    // beat image sequences for live recording: beat 0 = header, then one beat per group of items (items appear while you talk)
    const ctx2 = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 0.5 }), pg = await ctx2.newPage(), beats = {}, cueMap = {}, btMap = {};
    for (let i = 0; i < ep.scenes.length; i++) {
      const dir = path.join(work, `s${i}`), html = path.join(dir, 'scene.html'), fd = path.join(outDir, 'frames', `s${i}`); fs.mkdirSync(fd, { recursive: true });
      await pg.goto('file://' + html); await pg.evaluate(() => document.fonts.ready);
      const B = (await pg.evaluate(() => window.beatInfo())).B; beats[i] = B;
      const bt = await pg.evaluate(() => window.beatTexts()); cueMap[i] = cues(ep.scenes[i].narration, bt); btMap[i] = bt;
      if (process.env.CUEDBG) console.log('CUE', i, ep.scenes[i].id, JSON.stringify(bt));
      for (let k = 0; k <= B; k++) for (let j = 0; j < FRAME_N; j++) { await pg.evaluate(([kk, q]) => window.setB(kk, q), [k, j / (FRAME_N - 1)]); await pg.screenshot({ path: path.join(fd, `${k}-${j}.jpg`), type: 'jpeg', quality: 52 }); }
    }
    fs.writeFileSync(path.join(outDir, 'frames', 'beats.json'), JSON.stringify(beats));
    fs.writeFileSync(path.join(outDir, 'frames', 'cues.json'), JSON.stringify(cueMap));
    if (process.env.CUEDBG) fs.writeFileSync(path.join(outDir, 'frames', 'beattexts.json'), JSON.stringify(btMap));
    await ctx2.close();
  } finally { await browser.close(); fs.rmSync(work, { recursive: true, force: true }); }
}

function photoHtml(dir, plain) {
  const src = path.join(__dirname, '..', 'assets', 'bk.png');
  if (!fs.existsSync(src)) return '';
  fs.copyFileSync(src, path.join(dir, 'bk.png'));
  return `<div class="abs" style="left:760px;top:70px;width:500px;height:500px;border-radius:50%;box-shadow:0 0 0 7px #26D0FF,0 0 60px 10px rgba(38,208,255,.55),0 0 140px rgba(38,208,255,.25)"><img src="bk.png" style="width:500px;height:500px;border-radius:50%;display:block"></div>
    ${plain ? '' : `    <div class="abs" style="left:730px;top:455px;width:220px;height:220px;border-radius:50%;background:#031A12;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 6px #1FE5A5,0 0 50px rgba(31,229,165,.7);font-weight:800;font-size:80px;color:#1FE5A5;text-shadow:0 0 24px rgba(31,229,165,.8)">+4%</div>
    <div class="abs" style="left:900px;top:640px;width:370px;text-align:center;font-weight:800;font-size:24px;letter-spacing:.1em;color:var(--amb);text-shadow:0 0 16px rgba(255,194,26,.6)">TARGET, NOT A PROMISE</div>`}`;
}

function thumbHtml(ep, dir, art) {
  const setupsSc = ep.scenes.filter(x => x.type === 'setup'), n = setupsSc.length, t = setupsSc.map(x => x.heading).slice(0, 5);
  if (ep.mode === 'bottom') {
    // a falling run of red candles on the left, a rising run of green on the right, with the low circled
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const N = 38, cw = 1280 / N; let cs = '';
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), mid = 0.5, base = t < mid ? 80 + (t / mid) * 540 : 620 - ((t - mid) / (1 - mid)) * 520, o = base + (rnd() - 0.5) * 50, cl = base + (rnd() - 0.5) * 50;
      const down = t < mid ? true : rnd() < 0.2, col = down ? '#FF3B2F' : '#1FE55A', x = i * cw + cw / 2, hi = Math.min(o, cl) - 14 - rnd() * 22, lo = Math.max(o, cl) + 14 + rnd() * 22;
      cs += `<line x1="${x}" x2="${x}" y1="${hi}" y2="${lo}" stroke="${col}" stroke-width="3"/><rect x="${x - cw * 0.3}" y="${Math.min(o, cl)}" width="${cw * 0.6}" height="${Math.max(10, Math.abs(o - cl))}" fill="${col}"/>`;
    }
    const brush = (x, y, w, h, col, id) => `<svg class="abs" style="left:${x - 30}px;top:${y - 30}px" width="${w + 60}" height="${h + 60}"><defs><filter id="${id}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.035 0.09" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="26"/></filter></defs><rect x="30" y="30" width="${w}" height="${h}" fill="${col}" filter="url(#${id})" transform="skewX(-6) translate(${h * 0.1},0)"/></svg>`;
    const fat = (t, sz, col, extra) => `<div style="font-weight:800;font-style:italic;font-size:${sz}px;line-height:1;color:${col};-webkit-text-stroke:${Math.round(sz / 22)}px ${col};letter-spacing:-.01em;${extra || ''}">${t}</div>`;
    const cut = path.join(__dirname, '..', 'assets', 'bk-cutout.png');
    let face = '';
    if (art) {
      if (fs.existsSync(cut)) { fs.copyFileSync(cut, path.join(dir, 'bk-cutout.png')); face = `<img class="abs" src="bk-cutout.png" style="right:0;bottom:0;height:640px;filter:drop-shadow(0 0 30px rgba(38,208,255,.45))">`; }
      else { const src = path.join(__dirname, '..', 'assets', 'bk.png'); if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(dir, 'bk.png')); face = `<div class="abs" style="left:770px;top:70px;width:480px;height:480px;border-radius:50%;box-shadow:0 0 0 8px #FFC21A,0 0 70px 12px rgba(255,194,26,.55),0 0 140px rgba(31,229,90,.35);overflow:hidden"><img src="bk.png" style="width:480px;height:480px;object-fit:cover"></div>`; } }
    }
    const tick = t => `<div style="display:flex;align-items:center;gap:14px"><svg width="46" height="46" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#0E2A12" stroke="#1FE55A" stroke-width="1.6"/><path d="M6.5 12.5l4 4 7-8" fill="none" stroke="#1FE55A" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg><div style="font-weight:800;font-style:italic;font-size:32px;color:#fff;text-shadow:0 2px 6px #000">${t}</div></div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss(dir)}${CSS.replace(/html,body\{width:1920px;height:1080px/, 'html,body{width:1280px;height:720px')}</style></head><body>
    <div class="abs" style="inset:0;background:radial-gradient(ellipse at 12% 85%,rgba(255,40,30,.35),transparent 55%),radial-gradient(ellipse at 90% 15%,rgba(31,229,90,.38),transparent 55%),#05080C"></div>
    <svg class="abs" style="left:0;top:0" width="1280" height="720"><g stroke="rgba(255,255,255,.07)" stroke-width="1">${Array.from({ length: 12 }, (_, i) => `<line x1="${i * 110}" x2="${i * 110}" y1="0" y2="720"/>`).join('')}${Array.from({ length: 8 }, (_, i) => `<line y1="${i * 100}" y2="${i * 100}" x1="0" x2="1280"/>`).join('')}</g><g opacity=".95" style="filter:drop-shadow(0 0 8px rgba(255,255,255,.3))">${cs}</g>
      <circle cx="640" cy="652" r="50" fill="none" stroke="#FFC21A" stroke-width="8" style="filter:drop-shadow(0 0 14px #FFC21A)"/>
      <path d="M690 626 C 740 600 800 560 860 500" fill="none" stroke="#1FE55A" stroke-width="12" stroke-linecap="round" style="filter:drop-shadow(0 0 12px #1FE55A)"/><path d="M812 506 L866 494 L856 548" fill="none" stroke="#1FE55A" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 12px #1FE55A)"/></svg>
    <div class="abs" style="inset:0;background:linear-gradient(90deg,rgba(0,0,0,.5) 0%,rgba(0,0,0,.22) 52%,transparent 70%)"></div>
    ${face}
    <div class="abs" style="left:40px;top:34px;display:flex;align-items:center;gap:14px">${logoSvg(52, { id: 'th' })}<span style="font-weight:800;letter-spacing:.14em;font-size:21px">TRADE WITH BK</span></div>
    <div class="abs" style="left:44px;top:112px">${fat('HOW TO SPOT A', 76, '#fff', 'text-shadow:0 5px 0 #000,0 0 24px rgba(0,0,0,.8)')}</div>
    ${brush(34, 198, 700, 150, '#FFD21A', 'bk1')}
    <div class="abs" style="left:58px;top:206px">${fat('MARKET', 148, '#050505')}</div>
    ${brush(34, 376, 800, 150, '#E21B1B', 'bk2')}
    <div class="abs" style="left:58px;top:384px">${fat('BOTTOM?', 148, '#fff', 'text-shadow:0 6px 0 rgba(0,0,0,.45)')}</div>
    <div class="abs" style="left:44px;top:556px;display:grid;gap:8px">${tick('6 SIMPLE SIGNS')}${tick('NO JARGON')}${tick('REAL MARKET HISTORY')}</div>
    </body></html>`;
  }
  if (ep.mode === 'daily' && ep.thumbHead) { // news-led daily thumbnail: the day's headline, the market move, and the picks hook
    const words = String(ep.thumbHead).toUpperCase().split(/\s+/), lines = []; let cur = '';
    words.forEach(w => { if ((cur + ' ' + w).trim().length > 12 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }); if (cur) lines.push(cur);
    const nl = lines.length, fz = nl <= 2 ? 120 : nl === 3 ? 100 : 82, wdn = String(ep.nxd || '').split(' ')[0].toUpperCase();
    const up = typeof ep.chg1d === 'number' && ep.chg1d >= 1, top0 = 118, ty = top0 + nl * fz * 1.02 + 24;
    return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss(dir)}${CSS.replace(/html,body\{width:1920px;height:1080px/, 'html,body{width:1280px;height:720px')}</style></head><body>
    ${bgCandles(1280, 720, 9)}
    <div class="abs" style="inset:0;background:radial-gradient(ellipse at 85% 80%,rgba(31,229,90,.38),transparent 55%),linear-gradient(90deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.2) 55%,transparent 75%)"></div>
    <svg class="abs" style="left:620px;top:210px" width="660" height="500" viewBox="0 0 660 500"><path d="M20 460 L170 330 L250 380 L420 190 L520 240 L620 90" fill="none" stroke="#1FE55A" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 18px #1FE55A)" opacity=".9"/><path d="M540 80 L632 78 L624 172" fill="none" stroke="#1FE55A" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 18px #1FE55A)" opacity=".9"/></svg>
    ${art ? (() => { const src = path.join(__dirname, '..', 'assets', 'bk.png'); if (!fs.existsSync(src)) return ''; fs.copyFileSync(src, path.join(dir, 'bk.png')); return `<div class="abs" style="left:790px;top:70px;width:440px;height:440px;border-radius:50%;box-shadow:0 0 0 8px #1FE55A,0 0 70px 12px rgba(31,229,90,.55),0 0 140px rgba(38,208,255,.3);overflow:hidden"><img src="bk.png" style="width:440px;height:440px;object-fit:cover"></div>`; })() : ''}
    <div class="abs" style="left:56px;top:34px;display:flex;align-items:center;gap:14px">${logoSvg(56, { id: 'th' })}<span style="font-weight:800;letter-spacing:.14em;font-size:22px">TRADE WITH BK</span></div>
    <div class="abs" style="left:56px;top:${top0}px;width:760px">${lines.map((l, i) => `<div class="h1" style="font-size:${fz}px;line-height:1.02;${i === nl - 1 ? 'color:var(--acc);text-shadow:0 0 36px rgba(38,208,255,.7)' : 'text-shadow:0 5px 0 #000,0 0 24px rgba(0,0,0,.8)'}">${esc(l)}</div>`).join('')}</div>
    ${up ? `<div class="abs" style="left:56px;top:${ty}px"><span class="chip g" style="font-size:34px;padding:10px 24px;border-width:3px;box-shadow:0 0 28px rgba(31,229,165,.55)">S&amp;P 500 +${ep.chg1d.toFixed(1)}% TODAY</span></div>` : ''}
    ${n ? `<div class="abs" style="left:56px;top:${ty + (up ? 74 : 0)}px"><div class="kick" style="font-size:30px;letter-spacing:.06em;color:var(--amb);text-shadow:0 0 18px rgba(255,194,26,.6)">TOP ${n} STOCKS FOR ${esc(wdn)}</div></div>` : ''}
    ${t.length ? `<div class="abs" style="left:56px;top:650px;display:flex;gap:10px">${t.map(x => `<span class="chip" style="font-size:22px;padding:5px 14px;opacity:.9">${esc(x)}</span>`).join('')}</div>` : ''}
    </body></html>`;
  }
  const weekly = ep.mode === 'weekly', surv = typeof ep.chg5d === 'number' && ep.chg5d <= -3 && n > 0;
  const kick = weekly ? 'WEEKLY REVIEW' : ep.nxd ? 'SIGNALS FOR ' + ep.nxd.toUpperCase() : 'DAILY SCREEN';
  const head = weekly ? 'WEEK IN<br><span style="color:var(--acc)">REVIEW</span>' : surv ? `TOP ${n}<br><span style="color:var(--acc)">SURVIVORS</span>` : n ? `TOP ${n}<br><span style="color:var(--acc)">SIGNALS</span>` : 'DIP<br><span style="color:var(--acc)">SIGNALS</span>';
  const sub = weekly ? '' : '4% TARGET SWING TRADES';
  const mk = surv ? `<div class="abs" style="left:56px;top:150px"><span class="chip r" style="font-size:26px;padding:8px 20px">S&amp;P 500 −${Math.abs(ep.chg5d).toFixed(1)}% THIS WEEK</span></div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss(dir)}${CSS.replace(/html,body\{width:1920px;height:1080px/, 'html,body{width:1280px;height:720px')}</style></head><body>
    ${bgCandles(1280, 720, 9)}
    <div class="abs" style="left:56px;top:40px;display:flex;align-items:center;gap:14px">${logoSvg(60, { id: 'th' })}<span style="font-weight:800;letter-spacing:.14em;font-size:24px">TRADE WITH BK</span></div>
    ${mk}
    <div class="abs" style="left:56px;top:${surv ? 214 : 160}px"><div class="kick" style="font-size:26px;color:var(--amb);text-shadow:0 0 18px rgba(255,194,26,.6)">${esc(kick)}</div></div>
    <div class="abs" style="left:56px;top:${surv ? 258 : 205}px;width:740px"><div class="h1" style="font-size:112px;line-height:1.04">${head}</div></div>
    ${sub ? `<div class="abs" style="left:56px;top:${surv ? 520 : 480}px"><span class="chip g" style="font-size:36px;padding:12px 28px;border-width:3px;box-shadow:0 0 28px rgba(31,229,165,.55)">${esc(sub)}</span></div>` : ''}
    ${t.length ? `<div class="abs" style="left:56px;top:625px;display:flex;gap:10px">${t.map(x => `<span class="chip" style="font-size:22px;padding:5px 14px;opacity:.85">${esc(x)}</span>`).join('')}</div>` : ''}
    ${art ? photoHtml(dir) : ''}</body></html>`;
}

function studioBgHtml(ep, dir) {
  const kick = ep.mode === 'bottom' ? 'FINDING MARKET BOTTOMS' : ep.nxd ? 'SIGNALS FOR ' + ep.nxd.toUpperCase() : ep.mode === 'weekly' ? 'WEEKLY REVIEW' : 'DAILY SIGNALS';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss(dir)}${CSS}</style></head><body>
    <div class="abs" style="inset:0;background:radial-gradient(ellipse at 18% 45%,#10213D 0%,#07101E 55%,#02050A 100%)"></div>
    <div class="abs" style="left:-100px;top:600px;width:700px;height:600px;background:radial-gradient(circle,rgba(255,59,107,.22),transparent 65%)"></div>
    <div class="abs" style="left:60px;top:-120px;width:600px;height:500px;background:radial-gradient(circle,rgba(38,208,255,.22),transparent 65%)"></div>
    <div class="abs" style="left:1400px;top:760px;width:700px;height:500px;background:radial-gradient(circle,rgba(31,229,165,.14),transparent 65%)"></div>
    ${bgCandles(1920, 1080, 4).replace('opacity:.075', 'opacity:.16')}
    <div class="abs" style="left:23px;width:469px;top:44px;display:flex;justify-content:center">${logoSvg(128, { id: 'sb' })}</div>
    <div class="abs" style="left:23px;width:469px;top:186px;text-align:center;font-weight:800;font-size:38px;letter-spacing:.06em;text-shadow:0 0 22px rgba(38,208,255,.8)">TRADE <span style="color:var(--acc)">WITH BK</span></div>
    <div class="abs" style="left:23px;width:469px;top:868px;text-align:center;font-weight:700;font-size:24px;letter-spacing:.16em;color:var(--amb);text-shadow:0 0 16px rgba(255,194,26,.6)">S&amp;P 500 DIP SIGNALS</div>
    <div class="abs" style="left:23px;width:469px;top:910px;text-align:center;font-weight:600;font-size:19px;letter-spacing:.1em;color:var(--mut)">EVERY WEEKDAY AFTER THE CLOSE</div>
    <div class="abs" style="left:515px;width:1382px;top:52px;font-weight:800;font-size:44px;letter-spacing:.08em;color:var(--amb);text-shadow:0 0 24px rgba(255,194,26,.65)">${esc(kick)}</div>
    <div class="abs" style="left:515px;width:1382px;top:1004px;font-weight:600;font-size:20px;color:var(--mut)">Educational only. Not financial advice or a personal recommendation. Backtested results are not a guide to future performance.</div>
    <div class="abs" style="left:23px;top:1044px;width:469px;height:5px;border-radius:4px;background:var(--acc);box-shadow:0 0 18px var(--acc)"></div>
    </body></html>`;
}


/** A thumbnail for ONE scene, with no photo: brand, big headline, and the scene's own visual as a framed card. */
function sceneThumbHtml(ep, i, dir, stillFile) {
  const sc = ep.scenes[i], raw = String(sc.heading || '').trim().toUpperCase(), words = raw.split(/\s+/);
  const last = words.length > 1 ? words.pop() : '', first = words.join(' ');
  const len = raw.length, fs0 = len <= 12 ? 128 : len <= 20 ? 100 : len <= 30 ? 80 : 64;
  const kick = ep.mode === 'weekly' ? 'WEEKLY REVIEW' : ep.mode === 'bottom' ? 'MARKET BOTTOMS' : ep.mode === 'welcome' ? 'START HERE' : 'S&P 500 DIP SIGNALS';
  const st = sc.type === 'setup' && sc.data && sc.data.setup, nm = st ? (NAMES_R[st.ticker] || '') : '';
  const chips = st ? `<div class="abs" style="left:56px;top:${fs0 >= 100 ? 330 : 300}px;display:flex;flex-direction:column;gap:12px;align-items:flex-start">${nm ? `<div style="font-weight:700;font-size:38px;color:#C9D6EE">${esc(nm)}</div>` : ''}${typeof st.chg5d === 'number' ? `<span class="chip r" style="font-size:30px;padding:8px 20px">${st.chg5d < 0 ? '−' : '+'}${Math.abs(st.chg5d).toFixed(1)}% IN 5 DAYS</span>` : ''}${typeof st.vs200 === 'number' ? `<span class="chip g" style="font-size:26px;padding:6px 18px">${st.vs200 >= 0 ? '+' : '−'}${Math.abs(st.vs200).toFixed(1)}% vs 200-DAY AVERAGE</span>` : ''}</div>` : '';
  const img = stillFile ? `<div class="abs" style="left:610px;top:150px;width:630px;height:354px;transform:rotate(-2.5deg);border-radius:18px;overflow:hidden;border:4px solid #26D0FF;box-shadow:0 0 50px rgba(38,208,255,.45),0 18px 40px rgba(0,0,0,.6)"><img src="${stillFile}" style="width:100%;height:100%;object-fit:cover"></div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss(dir)}${CSS.replace(/html,body\{width:1920px;height:1080px/, 'html,body{width:1280px;height:720px')}</style></head><body>
    ${bgCandles(1280, 720, 11 + i)}
    <div class="abs" style="inset:0;background:linear-gradient(90deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.2) 55%,transparent 75%)"></div>
    <div class="abs" style="left:56px;top:40px;display:flex;align-items:center;gap:14px">${logoSvg(60, { id: 'sth' })}<span style="font-weight:800;letter-spacing:.14em;font-size:24px">TRADE WITH BK</span></div>
    <div class="abs" style="left:56px;top:136px"><div class="kick" style="font-size:26px;color:var(--amb);text-shadow:0 0 18px rgba(255,194,26,.6)">${esc(kick)}</div></div>
    <div class="abs" style="left:56px;top:188px;width:560px"><div class="h1" style="font-size:${fs0}px;line-height:1.02">${esc(first)}${last ? ` <span style="color:var(--acc)">${esc(last)}</span>` : ''}</div></div>
    ${chips}${img}
    <div class="abs" style="left:56px;bottom:34px"><span class="chip" style="font-size:20px;padding:6px 16px;opacity:.85">EDUCATIONAL ONLY · NOT FINANCIAL ADVICE</span></div>
    </body></html>`;
}

async function renderBrandAssets(ep, outDir, { chromium }) {
  fs.mkdirSync(outDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(outDir, '_brand')), browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const shot = async (html, w, h, file) => { const f = path.join(work, file + '.html'); fs.writeFileSync(f, html); await page.setViewportSize({ width: w, height: h }); await page.goto('file://' + f); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(80); await page.screenshot({ path: path.join(outDir, file + '.png') }); };
    await shot(thumbHtml(ep, work, true), 1280, 720, 'thumbnail');
    await shot(thumbHtml(ep, work, false), 1280, 720, 'thumbnail-bg');
    await shot(studioBgHtml(ep, work), 1920, 1080, 'studio-bg');
    // one photo-free thumbnail per scene (thumbs/scene-N.png), built from that scene's still
    const td = path.join(outDir, 'thumbs'); fs.mkdirSync(td, { recursive: true });
    for (let i = 0; i < ep.scenes.length; i++) {
      const stl = path.join(outDir, 'stills', `scene-${i}.jpg`); let rel = '';
      if (fs.existsSync(stl)) { fs.copyFileSync(stl, path.join(work, `still-${i}.jpg`)); rel = `still-${i}.jpg`; }
      const f = path.join(work, `sceneth-${i}.html`); fs.writeFileSync(f, sceneThumbHtml(ep, i, work, rel));
      await page.setViewportSize({ width: 1280, height: 720 }); await page.goto('file://' + f); await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(td, `scene-${i}.png`) });
    }
  } finally { await browser.close(); fs.rmSync(work, { recursive: true, force: true }); }
}

module.exports = { FRAME_N, FRAME_FPS, renderBrandAssets, chartSvg2, renderStills, prepareCharts, renderEpisode, sceneHtml, chartSvg, FPS, ANIM };
