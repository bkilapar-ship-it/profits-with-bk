'use strict';
/* One self-contained HTML page: the script as a teleprompter, with an optional front-camera recorder (works offline, nothing is uploaded). */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function teleprompterHtml(ep) {
  const total = ep.scenes.reduce((s, x) => s + x.dur, 0);
  const blocks = ep.scenes.map((s, i) => `<section class="blk" data-i="${i}"><div class="cue">SCENE ${i + 1} OF ${ep.scenes.length} · ${esc(s.heading)} · ~${Math.round(s.dur)}s on screen</div><p>${esc(s.narration)}</p></section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Teleprompter: ${esc(ep.title)}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}html,body{margin:0;height:100%;background:#05080F;color:#F2F6FF;font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif}
#cam{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;opacity:.0;transform:scaleX(-1);pointer-events:none}
body.camon #cam{opacity:.38}
#stage{position:fixed;inset:0;overflow:hidden}
#scroller{position:absolute;left:0;right:0;top:0;padding:46vh 7vw 80vh;will-change:transform}
body.mirror #scroller{transform-origin:center;}
.blk{margin:0 0 5.5vh}.cue{font-size:max(14px,2.2vw);letter-spacing:.14em;font-weight:700;color:#6F94FF;margin-bottom:1.2vh}
p{margin:0;font-weight:700;line-height:1.36;font-size:var(--fs,34px)}
.blk.now p{color:#fff}.blk:not(.now) p{color:#9FB1D4}
#line{position:fixed;left:0;right:0;top:46vh;height:0;border-top:2px dashed rgba(91,140,255,.45);pointer-events:none}
#bar{position:fixed;left:0;right:0;bottom:0;padding:12px 14px calc(12px + env(safe-area-inset-bottom));background:rgba(5,8,15,.92);border-top:1px solid #1E2A44;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;align-items:center;z-index:5}
button{font:inherit;font-weight:700;padding:14px 10px;border-radius:14px;border:1px solid #2A3B61;background:#121C33;color:#fff}
button.go{background:#2563EB;border-color:#2563EB}button.rec{background:#C0213A;border-color:#C0213A}button.on{outline:2px solid #5B8CFF}
label{font-size:12px;color:#8FA3C7;display:flex;flex-direction:column;gap:6px;font-weight:700;letter-spacing:.06em}input[type=range]{width:100%}
#hud{position:fixed;top:calc(8px + env(safe-area-inset-top));left:12px;right:12px;display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:#8FA3C7;z-index:4}
#msg{position:fixed;left:12px;right:12px;top:44px;font-size:13px;color:#F5B945;z-index:4}
</style></head><body>
<video id="cam" playsinline muted autoplay></video>
<div id="hud"><span id="clock">00:00</span><span>${esc(ep.title)} · aim for about ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}</span></div><div id="msg"></div>
<div id="stage"><div id="scroller">${blocks}</div></div><div id="line"></div>
<div id="bar">
  <button id="play" class="go">Start scroll</button>
  <label>SPEED<input id="spd" type="range" min="10" max="140" value="48"></label>
  <label>TEXT SIZE<input id="fs" type="range" min="22" max="64" value="34"></label>
  <button id="mir">Mirror</button>
  <button id="cambtn">Camera</button>
  <button id="rec">● Record</button>
</div>
<script>
const $=id=>document.getElementById(id);let y=0,run=false,last=0,stream=null,mr=null,chunks=[],t0=0,mime='';
const sc=$('scroller');
function apply(){sc.style.transform='translateY('+(-y)+'px)'+(document.body.classList.contains('mirror')?' scaleX(-1)':'');
  const mid=innerHeight*.46;let cur=0;document.querySelectorAll('.blk').forEach((b,i)=>{const r=b.getBoundingClientRect();if(r.top<=mid+10)cur=i;});
  document.querySelectorAll('.blk').forEach((b,i)=>b.classList.toggle('now',i===cur));}
function tick(ts){if(run){const dt=(ts-last)/1000;y+=parseFloat($('spd').value)*dt;const max=sc.scrollHeight-innerHeight*.9;if(y>=max){y=max;run=false;$('play').textContent='Start scroll';}apply();}last=ts;if(t0)$('clock').textContent=fmt((Date.now()-t0)/1000);requestAnimationFrame(tick);}
const fmt=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0');
$('play').onclick=()=>{run=!run;$('play').textContent=run?'Pause':'Start scroll';};
$('fs').oninput=e=>{document.documentElement.style.setProperty('--fs',e.target.value+'px');apply();};
$('mir').onclick=()=>{document.body.classList.toggle('mirror');$('mir').classList.toggle('on');apply();};
addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();$('play').click();}});
let touchY=null;addEventListener('touchstart',e=>{touchY=e.touches[0].clientY;},{passive:true});
addEventListener('touchmove',e=>{if(touchY===null||e.target.closest('#bar'))return;const d=touchY-e.touches[0].clientY;touchY=e.touches[0].clientY;y=Math.max(0,y+d);apply();},{passive:true});
async function cam(){if(stream)return true;try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1920},height:{ideal:1080}},audio:{echoCancellation:true,noiseSuppression:true}});$('cam').srcObject=stream;document.body.classList.add('camon');$('cambtn').classList.add('on');return true;}catch(e){$('msg').textContent='Camera or microphone blocked: allow access in Safari settings for this page. ('+e.name+')';return false;}}
$('cambtn').onclick=async()=>{if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;document.body.classList.remove('camon');$('cambtn').classList.remove('on');}else await cam();};
$('rec').onclick=async()=>{
  if(mr&&mr.state==='recording'){mr.stop();return;}
  if(!(await cam()))return;
  const opts=['video/mp4;codecs=avc1,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm'];mime=opts.find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t))||'';
  if(!window.MediaRecorder){$('msg').textContent='This browser cannot record in the page. Use your Camera app and read from this page on another screen.';return;}
  chunks=[];mr=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:8e6}:undefined);
  mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
  mr.onstop=()=>{t0=0;$('rec').textContent='● Record';$('rec').classList.remove('on');const type=mr.mimeType||mime||'video/mp4';const blob=new Blob(chunks,{type});const ext=/mp4/.test(type)?'mp4':'webm';const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='recording-${esc(ep.asOf)}.'+ext;document.body.appendChild(a);a.click();a.remove();$('msg').textContent='Saved. If nothing downloaded, long-press the video that opened and choose Save.';};
  mr.start(1000);t0=Date.now();$('rec').textContent='■ Stop and save';$('rec').classList.add('on');y=0;apply();
};
requestAnimationFrame(tick);apply();
</script></body></html>`;
}
module.exports = { teleprompterHtml };
