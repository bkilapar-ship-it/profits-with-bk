'use strict';
const sigOf=(sc)=>{let h=5381;const t=sc.map(x=>x.id).join('|');for(let i=0;i<t.length;i++)h=((h<<5)+h+t.charCodeAt(i))>>>0;return h.toString(36);};
/* One self-contained HTML page: the script as a teleprompter, with an optional front-camera recorder (works offline, nothing is uploaded). */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const { pointsOf, metaParts } = require('./script');
const { FRAME_N } = require('./render');
function teleprompterHtml(ep) {
  const total = ep.scenes.reduce((s, x) => s + x.dur, 0);
  const blocks = ep.scenes.map((s, i) => `<section class="blk" data-id="${esc(s.id)}" data-i="${i}"><img class="thumb" src="stills/scene-${i}.jpg" alt="" loading="lazy" onerror="this.style.display='none'"><div class="rvc"><button data-a="up">▲ Up</button><button data-a="down">▼ Down</button><button data-a="skip" class="skipbtn">Skip this scene</button></div><div class="cue"></div><ul class="pts">${pointsOf(s).map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="full">${esc(s.narration)}</p></section>`).join('');
  let acc = 0; const heads = JSON.stringify(ep.scenes.map(s => { const o = { id: s.id, h: s.heading, d: Math.round(s.dur), st: acc, du: s.dur }; acc += s.dur; return o; }));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Teleprompter: ${esc(ep.title)}</title>
<style>
:root{color-scheme:dark;--bar:128px}*{box-sizing:border-box}html,body{margin:0;height:100%;background:#05080F;color:#F2F6FF;font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif;-webkit-text-size-adjust:100%}
#cam{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transform:scaleX(-1);pointer-events:none}
body.camon #cam{opacity:.95;inset:auto;top:8px;right:8px;width:84px;height:112px;border-radius:12px;border:2px solid #26D0FF;z-index:20;pointer-events:auto}body.camon #cam.hid{opacity:0;pointer-events:none}
#hud{position:fixed;top:0;left:0;right:0;padding:calc(8px + env(safe-area-inset-top)) 14px 8px;display:flex;gap:12px;align-items:center;font-size:13px;font-weight:700;color:#8FA3C7;z-index:4;background:linear-gradient(#05080F 70%,transparent)}
#hud a{flex:none;color:#9DB8FF;text-decoration:none;padding:6px 10px;border:1px solid #2A3B61;border-radius:10px;background:#121C33}#clock{flex:none;font-variant-numeric:tabular-nums;color:#fff;font-size:15px}#ttl{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
#res{display:none;position:fixed;inset:0;z-index:60;background:#050912;overflow:auto;padding:calc(16px + env(safe-area-inset-top)) 16px 30px}#res.on{display:block}#res h2{margin:0 0 8px;font-size:18px}#res p{color:#9DB0D6;font-size:14px;line-height:1.5}#res video{width:100%;border-radius:12px;background:#000;margin:8px 0}#res a.btn{display:block;text-align:center;padding:14px;margin:8px 0;border-radius:12px;background:#2563EB;color:#fff;font-weight:700;text-decoration:none}#res a.alt{background:#1B2540}
#msg{position:fixed;left:14px;right:14px;top:calc(36px + env(safe-area-inset-top));font-size:13px;color:#F5B945;z-index:4}
#stage{position:fixed;left:0;right:0;top:calc(40px + env(safe-area-inset-top));bottom:calc(var(--bar) + env(safe-area-inset-bottom));overflow:hidden}
#scroller{position:absolute;left:0;right:0;top:0;padding:6vh 6vw 70vh;will-change:transform}
.blk{margin:0 0 5vh}.cue{font-size:13px;letter-spacing:.12em;font-weight:800;color:#6F94FF;margin-bottom:10px}
.pts{margin:0;padding:0;list-style:none}.pts li{font-weight:800;line-height:1.28;font-size:var(--fs,26px);margin:0 0 .55em;padding-left:1.05em;position:relative}
.pts li::before{content:'';position:absolute;left:0;top:.5em;width:.42em;height:.42em;border-radius:50%;background:#5B8CFF}
p.full{display:none;margin:0;font-weight:700;line-height:1.36;font-size:var(--fs,26px)}
body.full .pts{display:none}body.full p.full{display:block}
.blk.now .pts li,.blk.now p.full{color:#fff}.blk:not(.now) .pts li,.blk:not(.now) p.full{color:#8394B8}
#line{position:fixed;left:0;right:0;top:calc(40px + env(safe-area-inset-top) + var(--ln,22vh));height:0;border-top:2px dashed rgba(91,140,255,.55);pointer-events:none;z-index:3}
#bar{position:fixed;left:0;right:0;bottom:0;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:#080D18;border-top:1px solid #1E2A44;z-index:5}
#row0{margin-bottom:8px}#row0 button{width:100%;background:#0E7A4B;border-color:#0E7A4B;font-size:17px;padding:15px}#row1,#row2{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}#row1{grid-template-columns:1.1fr 1fr 1fr 1fr}#row1 button{padding-left:4px;padding-right:4px}#row2{margin-top:8px}
button{font:inherit;font-size:15px;font-weight:700;padding:13px 6px;border-radius:13px;border:1px solid #2A3B61;background:#121C33;color:#fff;touch-action:manipulation}
button.go{background:#2563EB;border-color:#2563EB}button.rec{background:#C0213A;border-color:#C0213A}button.on{outline:2px solid #5B8CFF}
select{background:#0E1626;color:#fff;border:1px solid #2A3B61;border-radius:10px;padding:10px;font-size:14px}#set{display:none;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px}#set.open{display:grid}
body:not(.review) .blk.skip{display:none}
.thumb,.rvc,#rvbar,#rvnote{display:none}
body.review #stage{overflow-y:auto;-webkit-overflow-scrolling:touch}body.review #scroller{position:static;transform:none!important;padding:8px 14px 40px}body.review #line,body.review #row3,body.review #row0,body.review #row1,body.review #row2,body.review #set,body.review #cam{display:none}
body.review .thumb{display:block;width:100%;border-radius:12px;border:1px solid #22304D;margin-bottom:10px}
body.review .rvc{display:flex;gap:8px;margin-bottom:8px}body.review .rvc button{flex:1;padding:9px 6px;font-size:13px}
body.review .blk{background:#0B1222;border:1px solid #1E2A44;border-radius:16px;padding:12px;margin:0 0 14px}
body.review .blk.skip{opacity:.45}body.review .blk .pts li,body.review .blk p.full{color:#fff}
body.review p.full[contenteditable]{outline:1px dashed #3D5A99;border-radius:8px;padding:10px;color:#fff;background:#0E1626}
body.review p.full{display:block;font-size:17px;font-weight:500;line-height:1.5;color:#B8C6E0;margin-top:10px;border-top:1px solid #243049;padding-top:8px}body.review p.full::before{content:'FULL SCRIPT';display:block;font-size:11px;letter-spacing:.14em;color:#6F86B3;margin-bottom:4px}
body.review .pts{outline:none;border-radius:10px;padding:6px 4px;border:1px dashed #2A3B61;min-height:2em}
body.review .pts li{font-size:18px;font-weight:700}
body.review #rvbar{display:grid;grid-template-columns:2fr 1fr;gap:8px}body.review #rvnote{display:block;position:fixed;left:14px;right:14px;top:calc(46px + env(safe-area-inset-top));font-size:12px;color:#9DB8FF;z-index:4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#rowm{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}#rowm button{padding:9px 6px;font-size:13px;opacity:.65}#rowm button.on{opacity:1;outline:2px solid #26D0FF;background:#0E2A3A}body.review #rowm{display:none}
body.review #stage{top:calc(74px + env(safe-area-inset-top))}
label{font-size:11px;color:#8FA3C7;display:flex;flex-direction:column;gap:4px;font-weight:700;letter-spacing:.08em}input[type=range]{width:100%}
</style></head><body>
<video id="cam" playsinline muted autoplay></video>
<video id="lvis" playsinline muted preload="auto" style="position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:.01;pointer-events:none"></video><canvas id="lcv" style="position:fixed;left:-9999px;top:0"></canvas>
<div id="hud"><a href="../" class="nav">‹ Studio</a><a href="../combine.html" class="nav">Combine ›</a><span id="clock">00:00</span><span id="ttl">${esc(ep.title)} · aim for ${Math.floor(total / 60)}:${String(Math.round(total) % 60).padStart(2, '0')}</span></div><div id="msg"></div><div id="rvnote">Tap text to edit · move or skip scenes · saved on this phone</div>
<div id="res"></div>
<div id="stage"><div id="scroller">${blocks}</div></div><div id="line"></div>
<div id="bar">
  <div id="row1"><button id="play" class="go">▶ Start</button><button id="cambtn">Camera</button><button id="rec">● Record</button><button id="rst">↺ Restart</button></div>
  <div id="rowm"><button id="mLive">Live: visuals in the video</button><button id="mCam">Camera only</button></div>
  <div id="row0"><button id="next" class="go2">Next visual ▶</button></div>
  <div id="row2"><button id="mode">Full script</button><button id="mir">Mirror</button><button id="gear">Settings</button></div>
  <div id="row3" style="margin-top:8px"><button id="review" style="width:100%">Review scenes and edit</button></div>
  <div id="rvbar"><button id="rvdone" class="go">▶ Done: back to the teleprompter</button><button id="rvreset">Reset</button></div>
  <div id="set"><label>SPEED <b id="wpmv">160</b> words/min<input id="spd" type="range" min="50" max="200" step="5" value="160"></label><label>TEXT SIZE<input id="fs" type="range" min="20" max="60" value="26"></label><label>LIVE VIDEO<select id="lv"><option value="side">Combine live: side by side</option><option value="pip">Combine live: face in a corner</option><option value="off">Camera only (combine later)</option></select></label><label>BACKUP COPY<select id="lb"><option value="off">No backup (default)</option><option value="on">Also save a plain camera file</option></select></label><label>QUALITY<select id="lq"><option value="720">720p</option><option value="1080">1080p</option></select></label></div>
</div>
<script>
const MD=${JSON.stringify(metaParts(ep)).replace(/</g, '\\u003c')},HEADS=${heads},KEY='${ep.mode}-${ep.asOf}-${sigOf(ep.scenes)}';
const $=id=>document.getElementById(id);let rt={},lastMark=0;let y=0,run=false,last=0,stream=null,mr=null,chunks=[],t0=0,mime='';
const sc=$('scroller');
const store={get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const blks=()=>[...document.querySelectorAll('.blk')];
const vis=()=>blks().filter(b=>!b.classList.contains('skip'));
const H=id=>HEADS.find(x=>x.id===id);
/* ---- plan: order, skipped scenes, edited points (shared with the combiner) ---- */
function savePlan(){const full={};blks().forEach(b=>{if(b.dataset.fed)full[b.dataset.id]=JSON.parse(b.dataset.fed);});const order=blks().map(b=>b.dataset.id),skip=blks().filter(b=>b.classList.contains('skip')).map(b=>b.dataset.id),pts={};
  blks().forEach(b=>{if(b.dataset.edited){pts[b.dataset.id]=b.dataset.edited==="1"?readPts(b):JSON.parse(b.dataset.edited);}});store.set('bkstudio-plan-'+KEY,{order,skip,pts,full});}
function readPts(b){return b.querySelector('.pts').innerText.split('\\n').map(s=>s.trim()).filter(Boolean);}
function drawPts(b,list){b.querySelector('.pts').innerHTML=list.map(x=>'<li>'+x.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</li>').join('');}
function renumber(){const v=vis();blks().forEach(b=>{const h=H(b.dataset.id),k=v.indexOf(b);b.querySelector('.cue').textContent=(k>=0?'SCENE '+(k+1)+' OF '+v.length:'SKIPPED')+' · '+h.h+' · ~'+h.d+'s on screen';const sb=b.querySelector('.skipbtn');sb.textContent=b.classList.contains('skip')?'Add it back':'Skip this scene';});}
function loadPlan(){const p=store.get('bkstudio-plan-'+KEY);if(p){if(p.order){const m=Object.fromEntries(blks().map(b=>[b.dataset.id,b]));p.order.forEach(id=>{if(m[id])sc.appendChild(m[id]);});}
  (p.skip||[]).forEach(id=>{const b=sc.querySelector('[data-id="'+id+'"]');if(b)b.classList.add('skip');});
  Object.entries(p.full||{}).forEach(([id,t])=>{const b=sc.querySelector('[data-id="'+id+'"]');if(b){b.querySelector('.full').textContent=t;b.dataset.fed=JSON.stringify(t);}});}renumber();}
sc.addEventListener('click',e=>{const bt=e.target.closest('.rvc button');if(!bt)return;const b=bt.closest('.blk'),a=bt.dataset.a;
  if(a==='up'&&b.previousElementSibling)sc.insertBefore(b,b.previousElementSibling);
  else if(a==='down'&&b.nextElementSibling)sc.insertBefore(b.nextElementSibling,b);
  else if(a==='skip')b.classList.toggle('skip');
  renumber();savePlan();});
sc.addEventListener('input',e=>{const b=e.target.closest('.blk');if(b&&e.target.closest('.full')){b.dataset.fed=JSON.stringify(e.target.closest('.full').innerText.replace(/\\n{2,}/g,'\\n').trim());clearTimeout(window._sv);window._sv=setTimeout(savePlan,400);}});
sc.addEventListener('focusout',e=>{const b=e.target.closest&&e.target.closest('.blk');if(b&&b.dataset.fedit==='1'){b.dataset.fedit='';b.dataset.fed=JSON.stringify(b.querySelector('.full').innerText.replace(/\\n{2,}/g,'\\n').trim());savePlan();}});
$('review').onclick=()=>{if(mr&&mr.state==='recording')return;run=false;$('play').textContent='▶ Start';document.body.classList.add('review');document.querySelectorAll('.full').forEach(u=>u.setAttribute('contenteditable','true'));$('stage').scrollTop=0;fit();};
$('rvdone').onclick=()=>{document.activeElement&&document.activeElement.blur();document.body.classList.remove('review');document.querySelectorAll('.full').forEach(u=>u.removeAttribute('contenteditable'));renumber();y=0;fit();};
$('rvreset').onclick=()=>{if(!confirm('Undo all your edits to this episode?'))return;try{localStorage.removeItem('bkstudio-plan-'+KEY);}catch(e){}location.reload();};
function apply(){if(document.body.classList.contains('review'))return;sc.style.transform='translateY('+(-y)+'px)'+(document.body.classList.contains('mirror')?' scaleX(-1)':'');
  const mid=$('line').getBoundingClientRect().top;let cur=0;const v=vis();v.forEach((b,i)=>{const r=b.getBoundingClientRect();if(r.top<=mid+10)cur=i;});
  blks().forEach(b=>b.classList.remove('now'));if(v[cur])v[cur].classList.add('now');
  if(live&&v[cur]&&liveId!==v[cur].dataset.id)showScene(v[cur].dataset.id);
  if(live)setTarget(cur,v,mid);
  if(t0&&cur>lastMark){for(let j=lastMark+1;j<=cur;j++)rt[v[j].dataset.id]=(Date.now()-t0)/1000;lastMark=cur;}}
let ppw=14;function calcPpw(){try{const w=sc.innerText.trim().split(/\\s+/).length;if(w>20)ppw=sc.scrollHeight/w;}catch(e){}}setInterval(calcPpw,1500);
function tick(ts){if(run){const dt=(ts-last)/1000;y+=parseFloat($('spd').value)/60*ppw*dt;const max=sc.scrollHeight-$('stage').clientHeight*.8;if(y>=max){y=max;run=false;$('play').textContent='▶ Start';}apply();}last=ts;if(t0)$('clock').textContent=fmt((Date.now()-t0)/1000);requestAnimationFrame(tick);}
const fmt=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0');
$('play').onclick=()=>{run=!run;$('play').textContent=run?'❚❚ Pause':'▶ Start';};
$('next').onclick=()=>{const bl=vis();let cur=0;bl.forEach((b,i)=>{if(b.classList.contains('now'))cur=i;});const j=Math.min(bl.length-1,cur+1);if(j===cur)return;const lineRel=$('line').getBoundingClientRect().top-$('stage').getBoundingClientRect().top;y=Math.max(0,bl[j].offsetTop-lineRel+4);apply();};
document.querySelectorAll('a.nav').forEach(a=>a.addEventListener('click',e=>{if(typeof mr!=='undefined'&&mr&&mr.state==='recording'&&!confirm('Your recording is still running. Leave this page and lose it?'))e.preventDefault();}));
$('gear').onclick=()=>{$('set').classList.toggle('open');$('gear').classList.toggle('on');fit();};
$('mode').onclick=()=>{document.body.classList.toggle('full');$('mode').textContent=document.body.classList.contains('full')?'Talking points':'Full script';apply();};
function fit(){document.documentElement.style.setProperty('--bar',($('bar').offsetHeight)+'px');apply();}
addEventListener('resize',fit);
$('fs').oninput=e=>{document.documentElement.style.setProperty('--fs',e.target.value+'px');apply();};
$('mir').onclick=()=>{document.body.classList.toggle('mirror');$('mir').classList.toggle('on');apply();};
addEventListener('keydown',e=>{if(e.target&&(e.target.isContentEditable||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)))return;if(e.code==='Space'){e.preventDefault();$('play').click();}});
let touchY=null;addEventListener('touchstart',e=>{touchY=e.touches[0].clientY;},{passive:true});
addEventListener('touchmove',e=>{if(document.body.classList.contains('review'))return;if(touchY===null||e.target.closest('#bar'))return;const d=touchY-e.touches[0].clientY;touchY=e.touches[0].clientY;y=Math.max(0,y+d);apply();},{passive:true});
async function cam(){if(stream)return true;try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1920},height:{ideal:1080}},audio:{echoCancellation:true,noiseSuppression:true}});$('cam').srcObject=stream;document.body.classList.add('camon');$('cambtn').classList.add('on');return true;}catch(e){$('msg').textContent='Camera or microphone blocked: allow access in Safari settings for this page. ('+e.name+')';return false;}}
$('cam').onclick=()=>{if(live)return;$('cam').classList.toggle('hid');};
$('cambtn').onclick=async()=>{if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;document.body.classList.remove('camon');$('cambtn').classList.remove('on');}else await cam();};



function mm(sec){const t=Math.round(sec);return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');}
function ytDetails(){
  const order=vis().map(b=>b.dataset.id),have=order.filter(id=>rt[id]!==undefined);let last=-99;const lines=[];
  (have.length?have:order).forEach(id=>{const c=MD.chap.find(x=>x.id===id);if(!c)return;const sec=have.length?rt[id]:0;if(!lines.length||sec-last>=10){lines.push((lines.length?mm(sec):'00:00')+' '+c.name);last=sec;}});
  const desc=MD.head+'\\n\\nCHAPTERS\\n'+lines.join('\\n')+'\\n\\n'+MD.tail,tags=MD.tags.join(', ');
  window._yt={title:MD.title,desc:desc,tags:tags,pin:MD.pinned};
  const row=(k,l)=>'<a class="btn alt" href="#" data-yt="'+k+'">Copy '+l+'</a>';
  return '<h2 style="margin-top:18px">YouTube details</h2><p>Chapter times come from when you actually moved to each scene in this take. Paste them into YouTube Studio.</p><pre style="white-space:pre-wrap;font-size:12px;color:#B8C6E0;background:#0E1626;border-radius:10px;padding:10px;max-height:180px;overflow:auto">'+MD.title.replace(/&/g,'&amp;')+'\\n\\n'+lines.join('\\n').replace(/&/g,'&amp;')+'</pre>'+row('title','title')+row('desc','description (with chapters)')+row('tags','tags')+row('pin','pinned comment');
}
document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('[data-yt]');if(!a||!window._yt)return;e.preventDefault();const k=a.dataset.yt,v=String(({title:window._yt.title,desc:window._yt.desc,tags:window._yt.tags,pin:window._yt.pin})[k]||''),lab=a.dataset.l||(a.dataset.l=a.textContent);
  const ok=()=>{a.textContent='Copied ✓ now paste it in YouTube';setTimeout(()=>{a.textContent=lab;},2500);};
  const old=()=>{let done=false;try{const t=document.createElement('textarea');t.value=v;t.setAttribute('readonly','');t.style.cssText='position:fixed;top:0;left:0;width:2em;height:2em;opacity:0;font-size:16px';document.body.appendChild(t);t.focus();t.select();t.setSelectionRange(0,v.length);done=document.execCommand('copy');document.body.removeChild(t);}catch(x){}return done;};
  const manual=()=>{let box=document.getElementById('ytbox');if(!box){box=document.createElement('textarea');box.id='ytbox';box.readOnly=true;box.style.cssText='width:100%;height:180px;margin:8px 0;background:#0B1220;color:#EAF0FB;border:1px solid #26D0FF;border-radius:10px;padding:10px;font-size:14px';a.parentNode.insertBefore(box,a.nextSibling);}box.value=v;box.focus();box.select();a.textContent='Press and hold the text below, then tap Copy';};
  if(old()){ok();return;}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(v).then(ok).catch(()=>{if(old())ok();else manual();});}else manual();});
/* ---- crash-safe storage: every recorded piece is also kept in the browser database ---- */
let _db=null;function idb(){return _db||(_db=new Promise((res,rej)=>{const q=indexedDB.open('bkstudio-rec',1);q.onupgradeneeded=()=>{const d=q.result;d.createObjectStore('chunks',{autoIncrement:true});d.createObjectStore('meta');};q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);}));}
async function idbStart(id){try{const d=await idb();await new Promise(r=>{const t=d.transaction(['chunks','meta'],'readwrite');t.objectStore('chunks').clear();t.objectStore('meta').clear();t.objectStore('meta').put({id,at:Date.now(),mime:(typeof mime!=='undefined'?mime:'')||'',asOf:'${esc(ep.asOf)}'},'cur');t.oncomplete=r;t.onerror=r;});}catch(e){}}
function idbPut(id,i,blob){idb().then(d=>{const t=d.transaction('chunks','readwrite');t.objectStore('chunks').put({id,i,blob});}).catch(()=>{});}
async function idbLoad(){try{const d=await idb();return await new Promise(r=>{const t=d.transaction(['chunks','meta'],'readonly');const m=t.objectStore('meta').get('cur'),c=t.objectStore('chunks').getAll();t.oncomplete=()=>r({meta:m.result,chunks:(c.result||[]).sort((a,b)=>a.i-b.i).map(x=>x.blob)});t.onerror=()=>r(null);});}catch(e){return null;}}
async function recoverCheck(){const r=await idbLoad();if(!r||!r.meta||!r.chunks.length)return;const size=r.chunks.reduce((a,b)=>a+b.size,0);if(size<2e5)return;
  const type=r.meta.mime||r.chunks[0].type||'video/mp4';const ext=/mp4/.test(type)?'mp4':'webm';const blob=new Blob(r.chunks,{type});const url=URL.createObjectURL(blob);
  $('res').innerHTML='<h2>Found an unsaved recording</h2><p>A take of about '+(size/1048576).toFixed(0)+' MB (recorded '+new Date(r.meta.at).toLocaleString()+') was still in this browser, probably from a recording that did not finish. Save it now before you start a new one.</p><a class="btn" href="'+url+'" download="recovered-take-'+r.meta.asOf+'.'+ext+'">Save the recovered recording</a><a class="btn alt" href="#" id="resx">Not now (it will be replaced when you record again)</a>';$('res').classList.add('on');$('resx').onclick=e=>{e.preventDefault();$('res').classList.remove('on');$('res').innerHTML='';};}
setTimeout(recoverCheck,800);
/* ---- live combine: camera + visuals composed while recording ---- */
let bmr=null,bchunks=[];let live=false,liveId=null,liveEnd=0,liveRaf=0,lvBlob=null,lvPre=null,studioImg=null;
const lvis=$('lvis'),lcv=$('lcv');
function lvMode(){return ($('lv')&&$('lv').value)||'side';}
function lvPrefetch(){if(lvMode()==='off'||lvPre)return lvPre;$('msg').textContent='Loading the visuals for live recording…';
  lvPre=Promise.all(HEADS.map((h,i)=>new Promise((res,rej)=>{const im=new Image();im.onload=()=>{(window.createImageBitmap?createImageBitmap(im).catch(()=>im):Promise.resolve(im)).then(res);};im.onerror=()=>rej(new Error('img'));im.src='stills/scene-'+i+'.jpg';})).concat([fetch('frames/beats.json').then(r=>r.ok?r.json():{}).catch(()=>({}))])).then(a=>{lvB=a.pop();lvImgs=a;$('msg').textContent='Visuals ready. Live recording is on.';return true;}).catch(()=>{lvPre=null;$('msg').textContent='Could not load the visuals, so this take will be camera only.';return false;});return lvPre;}
const FN=${FRAME_N},ANIMMS=600;let lvImgs=[],lvB={},lvIdx=-1,lvBs=-1,lvAnimK=-1,lvAnimT=0,lvTgt=0,lvFr={},lvLast=null,lvPrevScene=null,lvSceneT=0,lvBase=null;
function frLoad(i,k){if(i<0||i>=HEADS.length||k<0||k>(lvB[i]||0))return;lvFr[i]=lvFr[i]||{};if(lvFr[i][k])return;const a=new Array(FN).fill(null);lvFr[i][k]=a;const im=new Image();im.onload=()=>{a[FN-1]=im;};im.src='frames/s'+i+'/'+k+'-'+(FN-1)+'.jpg';}
function frDrop(i,below){const o=lvFr[i];if(!o)return;Object.keys(o).forEach(k=>{if(+k<below)delete o[k];});}
function frOk(a){return !!(a&&a[FN-1]);}
function showScene(id){liveId=id;const i=HEADS.findIndex(x=>x.id===id);if(i<0||!lvImgs[i])return;lvPrevScene=lvLast;lvSceneT=performance.now();lvIdx=i;lvBase=null;lvBs=-1;lvAnimK=0;lvAnimT=lvSceneT;lvTgt=0;Object.keys(lvFr).forEach(k=>{if(+k!==i)delete lvFr[k];});frLoad(i,0);frLoad(i,1);}
function drawVis(ctx,x,y,w,h){const now=performance.now(),i=lvIdx;if(i<0){return;}
  const B=lvB[i];
  if(B===undefined){const k=Math.min(1,(now-lvSceneT)/300);if(lvPrevScene&&k<1){ctx.drawImage(lvPrevScene,x,y,w,h);ctx.globalAlpha=k;ctx.drawImage(lvImgs[i],x,y,w,h);ctx.globalAlpha=1;}else ctx.drawImage(lvImgs[i],x,y,w,h);lvLast=lvImgs[i];return;}
  if(lvAnimK>=0&&(now-lvAnimT)/ANIMMS>=1){lvBs=lvAnimK;lvAnimK=-1;frDrop(i,lvBs-0);}
  if(lvAnimK<0&&lvBs<Math.min(lvTgt,B)){if(lvTgt-lvBs>2)lvBs=lvTgt-2;lvAnimK=lvBs+1;lvAnimT=now;frLoad(i,lvAnimK+1);}
  let img=null,img2=null,fa=0;
  if(lvAnimK>=0){const a=lvFr[i]&&lvFr[i][lvAnimK];if(frOk(a)){const q=Math.min(1,(now-lvAnimT)/ANIMMS);img=lvBase;img2=a[FN-1];fa=q*q*(3-2*q);if(q>=1)lvBase=img2;}else lvAnimT=now;}
  else{const a=lvFr[i]&&lvFr[i][lvBs];if(frOk(a))img=a[FN-1];else if(lvBs>=B)img=lvImgs[i];else img=lvBase;}
  if(!img&&!img2)img=lvBase||lvLast;
  const k=Math.min(1,(now-lvSceneT)/250),pv=lvPrevScene&&k<1;
  if(pv){ctx.drawImage(lvPrevScene,x,y,w,h);ctx.globalAlpha=k;}
  if(img)ctx.drawImage(img,x,y,w,h);
  if(img2&&fa>0.02){ctx.globalAlpha=(pv?k:1)*fa;ctx.drawImage(img2,x,y,w,h);}ctx.globalAlpha=1;lvLast=(img2&&fa>0.5)?img2:(img||lvLast);}
function beatThr(text,B){const t=String(text||'').replace(/\s+/g,' ').trim();if(!t||B<1)return Array.from({length:B},(_,k)=>(k+1)/(B+1));
  const ss=t.split(/(?<=[.!?])\s+(?=[A-Z0-9'"“$])/).filter(Boolean),w=ss.map(x=>x.split(' ').length),tot=w.reduce((a,b)=>a+b,0),st=[];let c=0;w.forEach(x=>{st.push(c/tot);c+=x;});
  const S=ss.length;return Array.from({length:B},(_,k)=>{const u=(k+1)*S/(B+1),j=Math.min(S-1,Math.floor(u));return Math.min(0.97,st[j]+(u-j)*(w[j]/tot));});}
function setTarget(cur,v,mid){if(!live||lvIdx<0)return;const b=v[cur];if(!b||b.dataset.id!==liveId)return;const r=b.getBoundingClientRect(),f=Math.max(0,Math.min(1,(mid-r.top)/Math.max(1,r.height))),B=lvB[lvIdx]||0;const fe=b.querySelector('p.full'),txt=fe?fe.textContent:b.textContent;const th=beatThr(txt,B);let t=0;th.forEach(x=>{if(f>=x)t++;});t=Math.min(B,t);if(t>lvTgt)lvTgt=t;}
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function cover(c,v,x,y,w,h){const vw=v.videoWidth,vh=v.videoHeight;if(!vw)return;const k=Math.max(w/vw,h/vh),sw=w/k,sh=h/k;c.drawImage(v,(vw-sw)/2,(vh-sh)/2,sw,sh,x,y,w,h);}
function liveDraw(W,H2,ctx,mode){
  if(!live)return;
  const cam=$('cam');watch(cam);ctx.fillStyle='#02050A';ctx.fillRect(0,0,W,H2);
  if(mode==='side'){
    if(studioImg&&studioImg.complete&&studioImg.naturalWidth)ctx.drawImage(studioImg,0,0,W,H2);else{const q=ctx.createLinearGradient(0,0,W,H2);q.addColorStop(0,'#0A1426');q.addColorStop(1,'#02050A');ctx.fillStyle=q;ctx.fillRect(0,0,W,H2);}
    const m=Math.round(W*.012),vw=Math.round(W*.72),vh=Math.round(vw*9/16),vy=Math.round((H2-vh)/2),vx=W-vw-m;
    ctx.save();ctx.shadowColor='rgba(38,208,255,.35)';ctx.shadowBlur=H2*.02;rr(ctx,vx,vy,vw,vh,H2*.012);ctx.fillStyle='#000';ctx.fill();ctx.restore();
    ctx.save();rr(ctx,vx,vy,vw,vh,H2*.012);ctx.clip();drawVis(ctx,vx,vy,vw,vh);ctx.restore();
    const fx=m,fw=vx-m*2,fh=Math.min(Math.round(fw*1.25),vh),fy=Math.round((H2-fh)/2);
    ctx.save();ctx.shadowColor='rgba(38,208,255,.55)';ctx.shadowBlur=H2*.025;rr(ctx,fx,fy,fw,fh,H2*.02);ctx.fillStyle='#000';ctx.fill();ctx.restore();
    ctx.save();rr(ctx,fx,fy,fw,fh,H2*.02);ctx.clip();cover(ctx,cam,fx,fy,fw,fh);ctx.restore();
    ctx.strokeStyle='#26D0FF';ctx.lineWidth=Math.max(2,H2*.003);rr(ctx,fx,fy,fw,fh,H2*.02);ctx.stroke();
  }else{
    drawVis(ctx,0,0,W,H2);
    const d=Math.round(H2*.30),m=Math.round(H2*.05),x=W-d-m,y=H2-d-Math.round(H2*.1);
    ctx.save();ctx.beginPath();ctx.arc(x+d/2,y+d/2,d/2,0,Math.PI*2);ctx.clip();cover(ctx,cam,x,y,d,d);ctx.restore();
    ctx.strokeStyle='#5B8CFF';ctx.lineWidth=Math.max(3,H2*.006);ctx.beginPath();ctx.arc(x+d/2,y+d/2,d/2,0,Math.PI*2);ctx.stroke();
  }
  liveRaf=requestAnimationFrame(()=>liveDraw(W,H2,ctx,mode));
}
let wCt=-1,wAt=0,wFix=0,hiccups=0,wl=null,dgMax=0,dgSlow=0,dgLast=0,dgRe=0,dgMsg=0;
let pfN=0,pfBound=null;function pfBind(cam){if(!cam.requestVideoFrameCallback||pfBound===cam.srcObject)return;pfBound=cam.srcObject;const f=()=>{pfN++;cam.requestVideoFrameCallback(f);};cam.requestVideoFrameCallback(f);}
function camFrames(cam){if(cam.requestVideoFrameCallback){return pfN;}try{const q=cam.getVideoPlaybackQuality&&cam.getVideoPlaybackQuality();if(q&&q.totalVideoFrames!=null)return q.totalVideoFrames;}catch(e){}return cam.currentTime;}
function watch(cam){const now=performance.now();pfBind(cam);if(dgLast){const g=now-dgLast;if(g>dgMax)dgMax=g;if(g>400)dgSlow++;}dgLast=now;
  const f=camFrames(cam);if(f!==wCt){wCt=f;wAt=now;}else{
  if(now-wAt>1000&&now-wFix>1000){wFix=now;cam.play().catch(()=>{});}
  if(now-wAt>1800){hiccups++;dgRe++;$('msg').textContent='Camera froze for a moment, recovering…';try{const ts=stream.getVideoTracks()[0];cam.srcObject=null;cam.srcObject=stream;pfBound=null;cam.play().catch(()=>{});}catch(e){}wAt=now;}}
  if(now-dgMsg>3000&&mr&&mr.state==='recording'){dgMsg=now;window._diag='slowest draw '+Math.round(dgMax)+' ms, slow draws '+dgSlow+', camera restarts '+dgRe+', camera frames '+f;try{$('clock').title=window._diag;}catch(e){}}}
async function getWake(){try{if(navigator.wakeLock)wl=await navigator.wakeLock.request('screen');}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&mr&&mr.state==='recording')getWake();});
function stopLive(){try{if(wl){wl.release();wl=null;}}catch(e){}live=false;cancelAnimationFrame(liveRaf);try{lvis.pause();}catch(e){}}
try{const sv=store.get('bkstudio-live');if(sv){if(sv.m)$('lv').value=sv.m;if(sv.q)$('lq').value=sv.q;if(sv.b)$('lb').value=sv.b;}}catch(e){}
$('lv').onchange=$('lq').onchange=$('lb').onchange=()=>{store.set('bkstudio-live',{m:$('lv').value,q:$('lq').value,b:$('lb').value});if(lvMode()!=='off')lvPrefetch();else $('msg').textContent='Camera only: you will combine the video later on the Combine page.';};
function syncM(){const off=lvMode()==='off';$('mCam').classList.toggle('on',off);$('mLive').classList.toggle('on',!off);}
$('mLive').onclick=()=>{if(mr&&mr.state==='recording')return;if($('lv').value==='off')$('lv').value='side';$('lv').onchange();syncM();};
$('mCam').onclick=()=>{if(mr&&mr.state==='recording')return;$('lv').value='off';$('lv').onchange();syncM();};syncM();
if(lvMode()!=='off')setTimeout(lvPrefetch,1500);
$('rst').onclick=()=>{
  const recording=mr&&mr.state==='recording';
  if(!confirm(recording?'Restart? This throws away the take so far (nothing is saved) and takes you back to the first page of the script.':'Go back to the first page of the script?'))return;
  if(recording){stopLive();if(bmr){try{bmr.onstop=null;bmr.ondataavailable=null;bmr.stop();}catch(e){}bmr=null;}mr.onstop=null;mr.ondataavailable=null;try{mr.stop();}catch(e){}chunks=[];rt={};lastMark=0;t0=0;$('rec').textContent='● Record';$('rec').classList.remove('on');}
  run=false;$('play').textContent='▶ Start';y=0;apply();$('msg').textContent=recording?'Take discarded. Press Record when you are ready to go again.':'';
};
$('rec').onclick=async()=>{
  if(mr&&mr.state==='recording'){stopLive();$('msg').textContent='Finishing your video… please wait, keep this page open.';const f=window._fin;try{mr.requestData();}catch(e){}try{mr.stop();}catch(e){}setTimeout(()=>{if(f)f();},5000);return;}
  const wantLive=lvMode()!=='off';
  if(!(await cam()))return;
  let useLive=false;if(wantLive){$('msg').textContent='Getting ready…';useLive=!!(await lvPrefetch());if(useLive){studioImg=new Image();studioImg.src='studio-bg.png?'+Date.now();await new Promise(r=>{studioImg.onload=studioImg.onerror=r;setTimeout(r,2500);});}}
  const opts=['video/mp4;codecs=avc1,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm'];mime=opts.find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t))||'';
  if(!window.MediaRecorder){$('msg').textContent='This browser cannot record in the page. Use your Camera app and read from this page on another screen.';return;}
  let rstream=stream,lH=parseInt($('lq').value,10)||720;
  if(useLive){const LW=Math.round(lH*16/9);lcv.width=LW;lcv.height=lH;const lc=lcv.getContext('2d');rstream=lcv.captureStream(30);stream.getAudioTracks().forEach(t=>rstream.addTrack(t));window._lg={W:LW,H:lH,c:lc,used:true};}else window._lg=null;
  chunks=[];mr=new MediaRecorder(rstream,mime?{mimeType:mime,videoBitsPerSecond:useLive?(lH>=1080?6e6:2.5e6):8e6,audioBitsPerSecond:128e3}:undefined);
  const takeId=Date.now();let ci=0;idbStart(takeId);
  mr.ondataavailable=e=>{if(e.data&&e.data.size){chunks.push(e.data);idbPut(takeId,ci++,e.data);}};
  bmr=null;bchunks=[];if(useLive&&$('lb').value==='on'){try{bmr=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:3e6,audioBitsPerSecond:96e3}:undefined);bmr.ondataavailable=e=>{if(e.data&&e.data.size)bchunks.push(e.data);};}catch(e){bmr=null;}}
  const fin=()=>{if(fin.done)return;fin.done=true;t0=0;store.set('bkstudio-marks2-'+KEY,{order:vis().map(b=>b.dataset.id),t:rt});$('rec').textContent='● Record';$('rec').classList.remove('on');const type=mr.mimeType||mime||'video/mp4';const blob=new Blob(chunks,{type});const ext=/mp4/.test(type)?'mp4':'webm';const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(window._lg&&window._lg.used?'trade-with-bk-':'recording-')+'${esc(ep.asOf)}.'+ext;document.body.appendChild(a);a.click();a.remove();const mainUrl=a.href,mainName=a.download;let bkUrl='',bkName='';
  const showRes=()=>{$('res').innerHTML='<h2>Your take is ready</h2><p>Check the preview below. '+(window._lg&&window._lg.used?'The charts should be on the right and you on the left.':'This one is camera only.')+(hiccups?' The camera stalled '+hiccups+' time(s), so watch the whole preview.':'')+(window._diag?' <small style="opacity:.7">['+window._diag+']</small>':'')+'</p>'+(blob.size<120e6?'<video src="'+mainUrl+'" controls playsinline></video>':'<p>This video is large, so it is not previewed here. Save it, then open it from Files or Photos to check it.</p>')+'<a class="btn" href="'+mainUrl+'" download="'+mainName+'">Save the finished video</a>'+(bkUrl?'<a class="btn alt" href="'+bkUrl+'" download="'+bkName+'">Save the camera-only backup (no visuals)</a>':'')+ytDetails()+'<a class="btn alt" href="#" id="resx">Close and record again</a>';$('res').classList.add('on');const x=$('resx');if(x)x.onclick=e=>{e.preventDefault();$('res').classList.remove('on');$('res').innerHTML='';};};
  if(bmr&&bmr.state!=='inactive'){const bm=bmr;bm.onstop=()=>{const bb=new Blob(bchunks,{type:bm.mimeType||type});bkUrl=URL.createObjectURL(bb);bkName='camera-backup-${esc(ep.asOf)}.'+ext;showRes();};try{bm.stop();}catch(e){showRes();}}else showRes();
  stopLive();$('msg').textContent=(hiccups?'The camera stalled '+hiccups+' time(s) during this take, so check your video. ':'')+(window._lg&&window._lg.used?'Your finished video is saved (camera and visuals together). ':'Saved. ')+'If nothing downloaded, long-press the video that opened and choose Save.';};
  window._fin=fin;mr.onstop=fin;
  rt={};{const v0=vis();if(v0[0])rt[v0[0].dataset.id]=0;}lastMark=0;mr.start(1000);if(bmr)try{bmr.start(2000);}catch(e){}t0=Date.now();hiccups=0;getWake();wCt=-1;wAt=performance.now();if(useLive){live=true;liveId=null;const v1=vis();if(v1[0])showScene(v1[0].dataset.id);liveDraw(window._lg.W,window._lg.H,window._lg.c,lvMode());}$('rec').textContent='■ Stop and save';$('rec').classList.add('on');y=0;apply();
};
try{const sv=store.get('bkstudio-wpm');if(sv)$('spd').value=sv;}catch(e){}
$('wpmv').textContent=$('spd').value;$('spd').addEventListener('input',()=>{$('wpmv').textContent=$('spd').value;try{store.set('bkstudio-wpm',$('spd').value);}catch(e){}});
loadPlan();calcPpw();requestAnimationFrame(tick);fit();if(location.hash==='#review')$('review').click();
</script></body></html>`;
}
module.exports = { teleprompterHtml };
