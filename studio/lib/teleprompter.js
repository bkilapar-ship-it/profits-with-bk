'use strict';
/* One self-contained HTML page: the script as a teleprompter, with an optional front-camera recorder (works offline, nothing is uploaded). */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const { pointsOf } = require('./script');
function teleprompterHtml(ep) {
  const total = ep.scenes.reduce((s, x) => s + x.dur, 0);
  const blocks = ep.scenes.map((s, i) => `<section class="blk" data-id="${esc(s.id)}" data-i="${i}"><img class="thumb" src="stills/scene-${i}.jpg" alt="" loading="lazy" onerror="this.style.display='none'"><div class="rvc"><button data-a="up">▲ Up</button><button data-a="down">▼ Down</button><button data-a="skip" class="skipbtn">Skip this scene</button></div><div class="cue"></div><ul class="pts">${pointsOf(s).map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="full">${esc(s.narration)}</p></section>`).join('');
  const heads = JSON.stringify(ep.scenes.map(s => ({ id: s.id, h: s.heading, d: Math.round(s.dur) })));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Teleprompter: ${esc(ep.title)}</title>
<style>
:root{color-scheme:dark;--bar:128px}*{box-sizing:border-box}html,body{margin:0;height:100%;background:#05080F;color:#F2F6FF;font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif;-webkit-text-size-adjust:100%}
#cam{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transform:scaleX(-1);pointer-events:none}
body.camon #cam{opacity:.38}
#hud{position:fixed;top:0;left:0;right:0;padding:calc(8px + env(safe-area-inset-top)) 14px 8px;display:flex;gap:12px;align-items:center;font-size:13px;font-weight:700;color:#8FA3C7;z-index:4;background:linear-gradient(#05080F 70%,transparent)}
#hud a{flex:none;color:#9DB8FF;text-decoration:none;padding:6px 10px;border:1px solid #2A3B61;border-radius:10px;background:#121C33}#clock{flex:none;font-variant-numeric:tabular-nums;color:#fff;font-size:15px}#ttl{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
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
#row0{margin-bottom:8px}#row0 button{width:100%;background:#0E7A4B;border-color:#0E7A4B;font-size:17px;padding:15px}#row1,#row2{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}#row2{margin-top:8px}
button{font:inherit;font-size:15px;font-weight:700;padding:13px 6px;border-radius:13px;border:1px solid #2A3B61;background:#121C33;color:#fff;touch-action:manipulation}
button.go{background:#2563EB;border-color:#2563EB}button.rec{background:#C0213A;border-color:#C0213A}button.on{outline:2px solid #5B8CFF}
#set{display:none;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px}#set.open{display:grid}
body:not(.review) .blk.skip{display:none}
.thumb,.rvc,#rvbar,#rvnote{display:none}
body.review #stage{overflow-y:auto;-webkit-overflow-scrolling:touch}body.review #scroller{position:static;transform:none!important;padding:8px 14px 40px}body.review #line,body.review #row3,body.review #row0,body.review #row1,body.review #row2,body.review #set,body.review #cam{display:none}
body.review .thumb{display:block;width:100%;border-radius:12px;border:1px solid #22304D;margin-bottom:10px}
body.review .rvc{display:flex;gap:8px;margin-bottom:8px}body.review .rvc button{flex:1;padding:9px 6px;font-size:13px}
body.review .blk{background:#0B1222;border:1px solid #1E2A44;border-radius:16px;padding:12px;margin:0 0 14px}
body.review .blk.skip{opacity:.45}body.review .blk .pts li,body.review .blk p.full{color:#fff}
body.review .pts{outline:none;border-radius:10px;padding:6px 4px;border:1px dashed #2A3B61;min-height:2em}
body.review .pts li{font-size:18px;font-weight:700}
body.review #rvbar{display:grid;grid-template-columns:2fr 1fr;gap:8px}body.review #rvnote{display:block;position:fixed;left:14px;right:14px;top:calc(46px + env(safe-area-inset-top));font-size:12px;color:#9DB8FF;z-index:4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.review #stage{top:calc(74px + env(safe-area-inset-top))}
label{font-size:11px;color:#8FA3C7;display:flex;flex-direction:column;gap:4px;font-weight:700;letter-spacing:.08em}input[type=range]{width:100%}
</style></head><body>
<video id="cam" playsinline muted autoplay></video>
<div id="hud"><a href="../" class="nav">‹ Studio</a><a href="../combine.html" class="nav">Combine ›</a><span id="clock">00:00</span><span id="ttl">${esc(ep.title)} · aim for ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}</span></div><div id="msg"></div><div id="rvnote">Tap text to edit · move or skip scenes · saved on this phone</div>
<div id="stage"><div id="scroller">${blocks}</div></div><div id="line"></div>
<div id="bar">
  <div id="row1"><button id="play" class="go">▶ Start</button><button id="cambtn">Camera</button><button id="rec">● Record</button></div>
  <div id="row0"><button id="next" class="go2">Next visual ▶</button></div>
  <div id="row2"><button id="mode">Full script</button><button id="mir">Mirror</button><button id="gear">Settings</button></div>
  <div id="row3" style="margin-top:8px"><button id="review" style="width:100%">Review scenes and edit</button></div>
  <div id="rvbar"><button id="rvdone" class="go">▶ Done: back to the teleprompter</button><button id="rvreset">Reset</button></div>
  <div id="set"><label>SPEED<input id="spd" type="range" min="8" max="140" value="40"></label><label>TEXT SIZE<input id="fs" type="range" min="20" max="60" value="26"></label></div>
</div>
<script>
const HEADS=${heads},KEY='${ep.mode}-${ep.asOf}';
const $=id=>document.getElementById(id);let rt={},lastMark=0;let y=0,run=false,last=0,stream=null,mr=null,chunks=[],t0=0,mime='';
const sc=$('scroller');
const store={get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const blks=()=>[...document.querySelectorAll('.blk')];
const vis=()=>blks().filter(b=>!b.classList.contains('skip'));
const H=id=>HEADS.find(x=>x.id===id);
/* ---- plan: order, skipped scenes, edited points (shared with the combiner) ---- */
function savePlan(){const order=blks().map(b=>b.dataset.id),skip=blks().filter(b=>b.classList.contains('skip')).map(b=>b.dataset.id),pts={};
  blks().forEach(b=>{if(b.dataset.edited){pts[b.dataset.id]=b.dataset.edited==="1"?readPts(b):JSON.parse(b.dataset.edited);}});store.set('bkstudio-plan-'+KEY,{order,skip,pts});}
function readPts(b){return b.querySelector('.pts').innerText.split('\\n').map(s=>s.trim()).filter(Boolean);}
function drawPts(b,list){b.querySelector('.pts').innerHTML=list.map(x=>'<li>'+x.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</li>').join('');}
function renumber(){const v=vis();blks().forEach(b=>{const h=H(b.dataset.id),k=v.indexOf(b);b.querySelector('.cue').textContent=(k>=0?'SCENE '+(k+1)+' OF '+v.length:'SKIPPED')+' · '+h.h+' · ~'+h.d+'s on screen';const sb=b.querySelector('.skipbtn');sb.textContent=b.classList.contains('skip')?'Add it back':'Skip this scene';});}
function loadPlan(){const p=store.get('bkstudio-plan-'+KEY);if(p){if(p.order){const m=Object.fromEntries(blks().map(b=>[b.dataset.id,b]));p.order.forEach(id=>{if(m[id])sc.appendChild(m[id]);});}
  (p.skip||[]).forEach(id=>{const b=sc.querySelector('[data-id="'+id+'"]');if(b)b.classList.add('skip');});
  Object.entries(p.pts||{}).forEach(([id,l])=>{const b=sc.querySelector('[data-id="'+id+'"]');if(b){drawPts(b,l);b.dataset.edited=JSON.stringify(l);}});}renumber();}
sc.addEventListener('click',e=>{const bt=e.target.closest('.rvc button');if(!bt)return;const b=bt.closest('.blk'),a=bt.dataset.a;
  if(a==='up'&&b.previousElementSibling)sc.insertBefore(b,b.previousElementSibling);
  else if(a==='down'&&b.nextElementSibling)sc.insertBefore(b.nextElementSibling,b);
  else if(a==='skip')b.classList.toggle('skip');
  renumber();savePlan();});
sc.addEventListener('input',e=>{const b=e.target.closest('.blk');if(b){b.dataset.edited='1';}});
sc.addEventListener('focusout',e=>{const b=e.target.closest&&e.target.closest('.blk');if(b&&b.dataset.edited==='1'){b.dataset.edited=JSON.stringify(readPts(b));savePlan();}});
$('review').onclick=()=>{if(mr&&mr.state==='recording')return;run=false;$('play').textContent='▶ Start';document.body.classList.add('review');document.querySelectorAll('.pts').forEach(u=>u.setAttribute('contenteditable','true'));$('stage').scrollTop=0;fit();};
$('rvdone').onclick=()=>{document.activeElement&&document.activeElement.blur();document.body.classList.remove('review');document.querySelectorAll('.pts').forEach(u=>u.removeAttribute('contenteditable'));blks().forEach(b=>{if(b.dataset.edited&&b.dataset.edited!=='1')drawPts(b,JSON.parse(b.dataset.edited));});renumber();y=0;fit();};
$('rvreset').onclick=()=>{if(!confirm('Undo all your edits to this episode?'))return;try{localStorage.removeItem('bkstudio-plan-'+KEY);}catch(e){}location.reload();};
function apply(){if(document.body.classList.contains('review'))return;sc.style.transform='translateY('+(-y)+'px)'+(document.body.classList.contains('mirror')?' scaleX(-1)':'');
  const mid=$('line').getBoundingClientRect().top;let cur=0;const v=vis();v.forEach((b,i)=>{const r=b.getBoundingClientRect();if(r.top<=mid+10)cur=i;});
  blks().forEach(b=>b.classList.remove('now'));if(v[cur])v[cur].classList.add('now');
  if(t0&&cur>lastMark){for(let j=lastMark+1;j<=cur;j++)rt[v[j].dataset.id]=(Date.now()-t0)/1000;lastMark=cur;}}
function tick(ts){if(run){const dt=(ts-last)/1000;y+=parseFloat($('spd').value)*dt;const max=sc.scrollHeight-$('stage').clientHeight*.8;if(y>=max){y=max;run=false;$('play').textContent='▶ Start';}apply();}last=ts;if(t0)$('clock').textContent=fmt((Date.now()-t0)/1000);requestAnimationFrame(tick);}
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
addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();$('play').click();}});
let touchY=null;addEventListener('touchstart',e=>{touchY=e.touches[0].clientY;},{passive:true});
addEventListener('touchmove',e=>{if(document.body.classList.contains('review'))return;if(touchY===null||e.target.closest('#bar'))return;const d=touchY-e.touches[0].clientY;touchY=e.touches[0].clientY;y=Math.max(0,y+d);apply();},{passive:true});
async function cam(){if(stream)return true;try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1920},height:{ideal:1080}},audio:{echoCancellation:true,noiseSuppression:true}});$('cam').srcObject=stream;document.body.classList.add('camon');$('cambtn').classList.add('on');return true;}catch(e){$('msg').textContent='Camera or microphone blocked: allow access in Safari settings for this page. ('+e.name+')';return false;}}
$('cambtn').onclick=async()=>{if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;document.body.classList.remove('camon');$('cambtn').classList.remove('on');}else await cam();};
$('rec').onclick=async()=>{
  if(mr&&mr.state==='recording'){mr.stop();return;}
  if(!(await cam()))return;
  const opts=['video/mp4;codecs=avc1,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm'];mime=opts.find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t))||'';
  if(!window.MediaRecorder){$('msg').textContent='This browser cannot record in the page. Use your Camera app and read from this page on another screen.';return;}
  chunks=[];mr=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:8e6}:undefined);
  mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
  mr.onstop=()=>{t0=0;store.set('bkstudio-marks2-'+KEY,{order:vis().map(b=>b.dataset.id),t:rt});$('rec').textContent='● Record';$('rec').classList.remove('on');const type=mr.mimeType||mime||'video/mp4';const blob=new Blob(chunks,{type});const ext=/mp4/.test(type)?'mp4':'webm';const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='recording-${esc(ep.asOf)}.'+ext;document.body.appendChild(a);a.click();a.remove();$('msg').textContent='Saved. If nothing downloaded, long-press the video that opened and choose Save.';};
  rt={};{const v0=vis();if(v0[0])rt[v0[0].dataset.id]=0;}lastMark=0;mr.start(1000);t0=Date.now();$('rec').textContent='■ Stop and save';$('rec').classList.add('on');y=0;apply();
};
loadPlan();requestAnimationFrame(tick);fit();if(location.hash==='#review')$('review').click();
</script></body></html>`;
}
module.exports = { teleprompterHtml };
