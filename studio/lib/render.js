'use strict';
/* Scene HTML, frame capture (Chromium) and video assembly (ffmpeg). */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { sma } = require('./data');

const W = 1920, H = 1080, FPS = 30, ANIM = 2.4;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = x => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sgn = (x, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}%`;
const cls = x => (x > 0 ? 'up' : x < 0 ? 'down' : '');

function fontCss(dir) {
  const base = path.relative(dir, path.join(__dirname, '..', 'node_modules', '@fontsource', 'inter', 'files')).split(path.sep).join('/');
  return [400, 600, 700, 800].map(w => `@font-face{font-family:'Inter';font-weight:${w};src:url('${base}/inter-latin-${w}-normal.woff2') format('woff2')}`).join('');
}

const CSS = `
:root{--bg:#0A0F1C;--card:#101A30;--line:#22304D;--text:#EAF0FB;--mut:#8FA3C7;--up:#2FD17A;--down:#F0506E;--acc:#5B8CFF;--amb:#F5B945}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-variant-numeric:tabular-nums}
body{position:relative;background:radial-gradient(1200px 700px at 85% -10%,rgba(91,140,255,.18),transparent 60%),radial-gradient(900px 600px at -5% 105%,rgba(47,209,122,.10),transparent 60%),var(--bg)}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:60px 60px}
.top{position:absolute;left:80px;right:80px;top:44px;display:flex;justify-content:space-between;align-items:center;font-weight:700;letter-spacing:.14em;font-size:22px;color:var(--mut)}
.brand{display:flex;align-items:center;gap:14px;color:var(--text)}.brand i{width:14px;height:14px;border-radius:4px;background:var(--acc);box-shadow:0 0 18px var(--acc)}
.foot{position:absolute;left:80px;right:80px;bottom:34px;font-size:19px;color:#6F84AB;display:flex;justify-content:space-between}
.card{background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.01)),var(--card);border:1px solid var(--line);border-radius:26px}
.up{color:var(--up)}.down{color:var(--down)}.mut{color:var(--mut)}
.kick{font-size:26px;font-weight:700;letter-spacing:.2em;color:var(--acc)}
.h1{font-size:112px;font-weight:800;letter-spacing:-.02em;line-height:1.02}
.h2{font-size:64px;font-weight:800;letter-spacing:-.015em}
.chip{display:inline-flex;align-items:center;gap:10px;padding:10px 20px;border-radius:999px;font-weight:700;font-size:24px;border:1px solid var(--line);background:rgba(255,255,255,.04)}
.chip.g{color:var(--up);border-color:rgba(47,209,122,.45);background:rgba(47,209,122,.10)}.chip.r{color:var(--down);border-color:rgba(240,80,110,.45);background:rgba(240,80,110,.10)}.chip.b{color:#9DB8FF;border-color:rgba(91,140,255,.5);background:rgba(91,140,255,.12)}.chip.a{color:var(--amb);border-color:rgba(245,185,69,.45);background:rgba(245,185,69,.10)}
.lab{font-size:20px;letter-spacing:.14em;font-weight:700;color:var(--mut)}
.num{font-weight:800;letter-spacing:-.02em}
[data-a]{opacity:0}
.abs{position:absolute}
table{border-collapse:collapse;width:100%}th{font-size:20px;letter-spacing:.12em;color:var(--mut);text-align:right;padding:0 18px 16px;font-weight:700}th:first-child,td:first-child{text-align:left}td{font-size:34px;font-weight:600;padding:16px 18px;border-top:1px solid var(--line);text-align:right}
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
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) g += `<line x1="${padL}" x2="${cw - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#22304D" stroke-width="1"/><text x="${cw - padR + 14}" y="${(y(v) + 7).toFixed(1)}" fill="#8FA3C7" font-size="21" font-weight="600">${v.toFixed(v >= 100 ? 0 : 2)}</text>`;
  let candles = '';
  bars.forEach((b, i) => {
    const up = b.c >= b.o, col = up ? '#2FD17A' : '#F0506E', top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c));
    candles += `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${y(b.h).toFixed(1)}" y2="${y(b.l).toFixed(1)}" stroke="${col}" stroke-width="2.4"/><rect x="${(x(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, bot - top).toFixed(1)}" rx="1.5" fill="${col}"/>`;
  });
  let smaPath = '';
  bars.forEach((b, i) => { if (isNum(b.sma)) smaPath += `${smaPath ? 'L' : 'M'}${x(i).toFixed(1)} ${y(b.sma).toFixed(1)}`; });
  const last = bars[n - 1], lx = x(n - 1), ly = y(last.c);
  const lvl = (v, col, label, id) => (isNum(v) && v > lo && v < hi ? `<g data-a="0.55,0.8" id="${id}"><line x1="${padL}" x2="${cw - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${col}" stroke-width="2.5" stroke-dasharray="10 8"/><rect x="${cw - padR - 168}" y="${(y(v) - 17).toFixed(1)}" width="164" height="34" rx="17" fill="#0A0F1C" stroke="${col}"/><text x="${cw - padR - 86}" y="${(y(v) + 8).toFixed(1)}" fill="${col}" font-size="21" font-weight="700" text-anchor="middle">${label}</text></g>` : '');
  const dates = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].map(i => `<text x="${x(i).toFixed(1)}" y="${ch - 12}" fill="#8FA3C7" font-size="20" font-weight="600" text-anchor="middle">${esc(bars[i].t.slice(5).replace('-', '/'))}</text>`).join('');
  return `<svg width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><defs><clipPath id="rvc"><rect id="rv" x="0" y="0" width="0" height="${ch}" data-max="${cw}"/></clipPath></defs>${g}
    <g clip-path="url(#rvc)">${candles}${smaPath ? `<path d="${smaPath}" fill="none" stroke="#F5B945" stroke-width="3" stroke-dasharray="3 7" stroke-linecap="round"/>` : ''}</g>
    ${smaPath ? `<text data-a="0.4,0.6" x="${padL + 8}" y="${padT + 16}" fill="#F5B945" font-size="21" font-weight="700">··· 200-day average</text>` : ''}
    <g data-a="0.5,0.75"><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="16" fill="none" stroke="#5B8CFF" stroke-width="3"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="6" fill="#5B8CFF"/></g>
    <g data-a="0.5,0.75"><circle cx="${padL + (smaPath ? 330 : 20)}" cy="${padT + 8}" r="8" fill="none" stroke="#5B8CFF" stroke-width="3"/><text x="${padL + (smaPath ? 350 : 40)}" y="${padT + 16}" fill="#9DB8FF" font-size="21" font-weight="700">signal day close ${last.c.toFixed(2)}</text></g>
    ${lvl(plan && plan.target, '#2FD17A', `target ${plan && isNum(plan.target) ? plan.target.toFixed(2) : ''}`, 'tg')}
    ${lvl(plan && plan.stop, '#F0506E', `stop ${plan && isNum(plan.stop) ? plan.stop.toFixed(2) : ''}`, 'st')}
    ${dates}</svg>`;
}
function areaSvg(closes, cw, ch, up) {
  const n = closes.length, lo0 = Math.min(...closes), hi0 = Math.max(...closes), pad = (hi0 - lo0) * 0.12 || 1, lo = lo0 - pad, hi = hi0 + pad;
  const x = i => 10 + i * ((cw - 20) / (n - 1)), y = v => 14 + (hi - v) / (hi - lo) * (ch - 28);
  const col = up ? '#2FD17A' : '#F0506E';
  const line = closes.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  return `<svg width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".38"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient><clipPath id="rvc"><rect id="rv" x="0" y="0" width="0" height="${ch}" data-max="${cw}"/></clipPath></defs>
    <g clip-path="url(#rvc)"><path d="${line}L${x(n - 1).toFixed(1)} ${ch}L${x(0).toFixed(1)} ${ch}Z" fill="url(#ag)"/><path d="${line}" fill="none" stroke="${col}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></g>
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(closes[n - 1]).toFixed(1)}" r="9" fill="${col}"/></svg>`;
}
function miniCandles(view, cw, ch) {
  const n = view.length, lo = Math.min(...view.map(b => b.l)), hi = Math.max(...view.map(b => b.h)), x = i => 6 + (i + 0.5) * ((cw - 12) / n), y = v => 8 + (hi - v) / (hi - lo) * (ch - 16), bw = ((cw - 12) / n) * 0.64;
  return `<svg width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}">${view.map((b, i) => { const c = b.c >= b.o ? '#2FD17A' : '#F0506E'; const t = y(Math.max(b.o, b.c)), bt = y(Math.min(b.o, b.c)); return `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${y(b.h).toFixed(1)}" y2="${y(b.l).toFixed(1)}" stroke="${c}" stroke-width="3"/><rect x="${(x(i) - bw / 2).toFixed(1)}" y="${t.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(3, bt - t).toFixed(1)}" rx="2" fill="${c}"/>`; }).join('')}</svg>`;
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }

/* ----------------------------------------------------------------- scenes */
const frame = (inner, date) => `<div class="grid"></div><div class="top"><div class="brand"><i></i>TRADE WITH BK</div><div>${esc(date || '')}</div></div>${inner}<div class="foot"><span>Educational only. Not financial advice or a personal recommendation.</span><span>Backtested results are not a guide to future performance.</span></div>`;
const stat = (label, valueHtml, sub, x, y, w, a) => `<div class="card abs" data-a="${a}" style="left:${x}px;top:${y}px;width:${w}px;height:148px;padding:22px 26px"><div class="lab" style="white-space:nowrap">${label}</div><div class="num" style="font-size:56px;margin-top:6px;white-space:nowrap">${valueHtml}</div>${sub ? `<div class="mut" style="font-size:20px;margin-top:-2px">${sub}</div>` : ''}</div>`;
const cnt = (to, d, pre, suf, s, e, c = '') => `<span class="${c}" data-count="0|${to}|${d}|${pre}|${suf}|${s}|${e}">${pre}${to.toFixed(d)}${suf}</span>`;

const SCENES = {
  intro: (s, ep) => {
    const d = s.data, m = d.market, k = d.counts || {};
    return frame(`
      <div class="abs" data-a="0,0.35" style="left:80px;top:250px"><div class="kick">${esc((d.kicker || '').toUpperCase())}</div></div>
      <div class="abs" data-a="0.1,0.5" style="left:80px;top:310px;width:1500px"><div class="h1">${esc(s.heading.split(' ').slice(0, 1).join(' '))}<br><span style="color:var(--acc)">${esc(s.heading.split(' ').slice(1).join(' '))}</span></div></div>
      <div class="abs" data-a="0.3,0.7" style="left:80px;top:640px"><div class="h2" style="font-weight:600;color:var(--mut);font-size:46px">${esc(d.date || '')}</div></div>
      <div class="abs" data-a="0.45,0.85" style="left:80px;top:760px;display:flex;gap:18px">
        <span class="chip g">${k.dip || 0} S&amp;P long setups</span><span class="chip r">${k.rip || 0} short</span><span class="chip">${k.other || 0} outside the index</span>
        ${m && isNum(m.chg20d) ? `<span class="chip ${m.chg20d <= 0 ? 'a' : 'b'}">S&amp;P 500 20-day ${sgn(m.chg20d)}</span>` : ''}</div>
      ${s.spy ? `<div class="card abs" data-a="0.2,0.6" style="left:1000px;top:230px;width:840px;height:520px;padding:34px 40px"><div class="lab">S&amp;P 500, LAST 60 SESSIONS</div><div class="abs" style="left:40px;top:96px">${s.spy}</div></div>` : ''}`, d.date);
  },
  rules: (s, ep) => {
    const item = (i, t, sub, a) => `<div class="card abs" data-a="${a}" style="left:${80 + i * 580}px;top:330px;width:540px;height:520px;padding:44px"><div class="num" style="font-size:120px;color:var(--acc)">${i + 1}</div><div style="font-size:46px;font-weight:800;margin-top:6px">${t}</div><div class="mut" style="font-size:30px;line-height:1.35;margin-top:18px">${sub}</div></div>`;
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:160px"><div class="kick">THE SCREEN</div><div class="h2" style="margin-top:12px">Three things, in the same stock</div></div>
      ${item(0, 'Uptrend', 'Price is above its 200-day average.', '0.15,0.45')}${item(1, 'Sharp drop', 'Down at least 10% over five sessions.', '0.3,0.6')}${item(2, 'Capitulation', 'Closed near the day’s low, made a new 20-day low, or fell three days in a row.', '0.45,0.75')}`, ep.date);
  },
  setup: (s, ep) => {
    const x = s.data.setup, p = s.data.plan || {}, short = !!s.data.short;
    const reasons = (x.reasons || []).map(r => `<span class="chip b">${esc(r.replace(/^./, c => c.toUpperCase()))}</span>`).join('');
    const tag = x.priority === 0 ? `<span class="chip g">${short ? 'EXHAUSTED RALLY' : 'SELLING FLUSH'}</span>` : x.priority === 2 ? '<span class="chip a">LOWER PRIORITY</span>' : '';
    return frame(`
      <div class="abs" data-a="0,0.25" style="left:80px;top:118px;display:flex;align-items:center;gap:22px"><div class="h2" style="font-size:78px">${esc(x.ticker)}</div><span class="chip ${short ? 'r' : 'g'}">${short ? 'SHORT SETUP' : 'UPTREND DIP'}</span>${tag}</div>
      <div class="card abs" data-a="0,0.2" style="left:80px;top:230px;width:1190px;height:560px;padding:8px 10px">${s.chart}</div>
      ${stat(short ? '5-DAY RALLY' : '5-DAY MOVE', cnt(x.chg5d, 1, x.chg5d > 0 ? '+' : '', '%', 0.25, 0.65, cls(x.chg5d)), '', 1310, 230, 255, '0.2,0.45')}
      ${stat('VS 200-DAY', cnt(x.vs200, 1, x.vs200 > 0 ? '+' : '', '%', 0.3, 0.7), '', 1310 + 275, 230, 255, '0.25,0.5')}
      ${stat('RSI (14)', cnt(x.rsi || 0, 0, '', '', 0.35, 0.75), '', 1310, 398, 255, '0.3,0.55')}
      ${stat('REL. VOLUME', isNum(x.relVol) ? cnt(x.relVol, 1, '', '×', 0.4, 0.8) : '–', '', 1310 + 275, 398, 255, '0.35,0.6')}
      <div class="abs" data-a="0.45,0.7" style="left:1310px;top:566px;width:530px;display:flex;flex-wrap:wrap;gap:12px">${reasons}</div>
      <div class="abs" data-a="0.55,0.8" style="left:1310px;top:700px;width:530px"><div class="lab">DAILY RANGE (ATR)</div><div class="num" style="font-size:42px">${isNum(x.atrPct) ? x.atrPct.toFixed(1) + '% of price' : ''}</div></div>
      ${[['ENTRY', 'next open, only if within 2% of ' + money(x.close), 'b'], ['TARGET', sgnLevel(short, p.target, 4), short ? 'r' : 'g'], ['STOP', '3 ATR · ' + money(p.stop), short ? 'g' : 'r'], ['EXIT', 'close of day 3 at the latest', 'a']].map((b, i) => `<div class="card abs" data-a="${0.5 + i * 0.07},${0.75 + i * 0.07}" style="left:${80 + i * 456}px;top:820px;width:432px;height:150px;padding:24px 30px"><div class="lab">${b[0]}</div><div style="font-size:${b[0] === 'ENTRY' ? 27 : 34}px;font-weight:700;margin-top:8px;line-height:1.2" class="${b[2] === 'g' ? 'up' : b[2] === 'r' ? 'down' : ''}">${esc(b[1])}</div></div>`).join('')}`, ep.date);
  },
  summary: (s, ep) => {
    const rows = s.data.rows || [];
    return frame(`<div class="abs" data-a="0,0.3" style="left:80px;top:150px"><div class="kick">TODAY'S SCREEN</div><div class="h2" style="margin-top:12px">All S&amp;P 500 setups</div></div>
      <div class="card abs" data-a="0.15,0.5" style="left:80px;top:290px;width:1760px;padding:34px 40px"><table><thead><tr><th>TICKER</th><th>SIDE</th><th>5-DAY MOVE</th><th>VS 200-DAY</th><th>CLOSE</th></tr></thead><tbody>${rows.map(r => `<tr><td style="font-weight:800">${esc(r.ticker)}</td><td class="${r.kind === 'dip' ? 'up' : 'down'}">${r.kind === 'dip' ? 'Long' : 'Short'}</td><td class="${cls(r.chg5d)}">${sgn(r.chg5d)}</td><td>${sgn(r.vs200)}</td><td>${money(r.close)}</td></tr>`).join('')}</tbody></table></div>`, ep.date);
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
  text: (s, ep) => frame(`<div class="abs" data-a="0,0.4" style="left:80px;top:300px;width:1700px"><div class="h2">${esc(s.heading)}</div><div class="mut" style="font-size:40px;margin-top:24px;line-height:1.4">${esc(s.narration)}</div></div>`, ep.date),
};
function sgnLevel(short, v, p) { return `${short ? '−' : '+'}${p}% · ${money(v)}`; }

function sceneHtml(scene, ep, dir) {
  const body = (SCENES[scene.type] || SCENES.text)(scene, ep);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss(dir)}${CSS}</style></head><body>${body}<script>${ANIM_JS}</script></body></html>`;
}

/** Attach chart svg to setup scenes: last 50 bars + 200-day average computed from the full series. */
function prepareCharts(ep, barsBySym) {
  for (const s of ep.scenes) {
    if (s.type !== 'setup') continue;
    const bars = barsBySym[s.data.setup.ticker];
    if (!bars || bars.length < 60) throw new Error(`Not enough price history to chart ${s.data.setup.ticker}`);
    const ma = sma(bars.map(b => b.c), 200);
    const view = bars.map((b, i) => ({ ...b, sma: ma[i] })).slice(-50);
    s.chart = chartSvg(view, s.data.plan, 1170, 544);
    s.view = view;
  }
  const spyBars = barsBySym.SPY;
  if (spyBars && spyBars.length >= 30) {
    const closes = spyBars.slice(-60).map(b => b.c);
    ep.spyCloses = closes;
    for (const s of ep.scenes) if (s.type === 'intro') s.spy = areaSvg(closes, 760, 370, closes[closes.length - 1] >= closes[0]);
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

function thumbHtml(ep, dir) {
  const t = ep.tickers.slice(0, 3);
  const first = ep.scenes.find(x => x.view), art = first ? miniCandles(first.view.slice(-34), 600, 520) : (ep.spyCloses ? areaSvg(ep.spyCloses, 600, 400, ep.spyCloses[ep.spyCloses.length - 1] >= ep.spyCloses[0]) : '');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss(dir)}${CSS.replace(/html,body\{width:1920px;height:1080px/, 'html,body{width:1280px;height:720px')}</style></head><body>
    <div class="grid"></div>
    <div class="abs" style="left:64px;top:70px"><div class="kick" style="font-size:30px">${esc(ep.mode === 'weekly' ? 'WEEKLY REVIEW' : 'DAILY SCREEN')}</div></div>
    <div class="abs" style="left:64px;top:130px;width:1150px"><div class="h1" style="font-size:150px;width:620px">${ep.mode === 'weekly' ? 'WEEK IN<br><span style="color:var(--acc)">REVIEW</span>' : 'DIP<br><span style="color:var(--acc)">SIGNALS</span>'}</div></div>
    <div class="abs" style="left:64px;top:520px;display:flex;gap:16px">${t.map(x => `<span class="chip g" style="font-size:44px;padding:16px 30px">${esc(x)}</span>`).join('')}</div>
    <div class="abs" style="left:64px;bottom:44px;font-size:34px;font-weight:700;color:var(--mut)">${esc(ep.date)}</div>
    ${art ? `<div class="abs" style="left:640px;top:70px;width:600px;height:560px;opacity:.95">${art}</div>` : ''}</body></html>`;
}

module.exports = { prepareCharts, renderEpisode, sceneHtml, chartSvg, FPS, ANIM };
