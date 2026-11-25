/* Like / Subscribe / bell popovers, drawn on a canvas. Shared by the Combine page, the Shorts builder and the live recorder.
   bkPopAt(narration) -> fraction of the narration at which the first "like" / "subscribe" is spoken.
   bkPop(ctx, x, y, w, h, tt) -> draws the animation inside the rectangle, tt = seconds since it was triggered (nothing drawn if tt < 0). */
(function () {
  const E = t => t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);
  const B = t => { if (t <= 0) return 0; if (t >= 1) return 1; const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const P = (s, e, t) => Math.max(0, Math.min(1, (t - s) / (e - s)));
  const LIKE = new Path2D('M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z');
  const BELL = new Path2D('M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z');
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const icon = (c, path, cx, cy, size, rot) => { c.save(); c.translate(cx, cy); if (rot) c.rotate(rot); const k = size / 24; c.scale(k, k); c.translate(-12, -12); c.fill(path); c.restore(); };
  window.bkPopAt = function (text) {
    const w = String(text || '').split(/\s+/).filter(Boolean);
    const i = w.findIndex(x => /^(like|subscribe)/i.test(x.replace(/[^a-z]/gi, '')));
    return i < 0 ? 0.8 : Math.max(0, Math.min(0.95, i / Math.max(1, w.length)));
  };
  window.bkPop = function (c, x, y, w, h, tt) {
    if (!(tt >= 0)) return;
    const u = w / 1000, cy = y + h * 0.74, rowW = 650 * u, x0 = x + (w - rowW) / 2;
    c.save();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    // soft backdrop
    const pa = E(P(0, 0.3, tt)) * 0.6;
    c.globalAlpha = pa; c.fillStyle = '#02050A'; rr(c, x0 - 40 * u, cy - 95 * u, rowW + 80 * u, 190 * u, 40 * u); c.fill(); c.globalAlpha = 1;
    // LIKE
    const lx = x0 + 52 * u, lr = 52 * u, liked = tt >= 1.5, press = Math.sin(Math.PI * P(1.5, 2.0, tt));
    const ls = B(P(0, 0.5, tt)) * (1 + 0.22 * press);
    if (ls > 0) {
      c.save(); c.translate(lx, cy); c.scale(ls, ls);
      c.shadowColor = liked ? '#26D0FF' : 'rgba(0,0,0,.6)'; c.shadowBlur = (liked ? 30 : 14) * u;
      c.fillStyle = liked ? '#26D0FF' : '#2B3447'; c.beginPath(); c.arc(0, 0, lr, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
      c.fillStyle = liked ? '#fff' : '#C9D6EE'; icon(c, LIKE, 0, -2 * u, 56 * u, liked ? -0.18 * (1 - P(1.5, 2.0, tt)) : 0);
      c.restore();
    }
    if (liked) { // burst + "+1"
      for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5, d = (lr + 10 * u) + E(P(1.5, 2.3, tt)) * 70 * u, al = 1 - P(1.7, 2.3, tt); if (al <= 0) continue; c.globalAlpha = al; c.fillStyle = ['#FFC21A', '#26D0FF', '#FF3B6B'][k % 3]; c.beginPath(); c.arc(lx + Math.cos(a) * d, cy + Math.sin(a) * d, 6 * u, 0, Math.PI * 2); c.fill(); }
      const pa2 = 1 - P(2.0, 2.7, tt); if (pa2 > 0) { c.globalAlpha = pa2; c.fillStyle = '#fff'; c.font = '800 ' + Math.round(40 * u) + 'px Poppins,Arial,sans-serif'; c.fillText('+1', lx, cy - 80 * u - E(P(1.5, 2.6, tt)) * 50 * u); }
      c.globalAlpha = 1;
    }
    // SUBSCRIBE
    const sx = x0 + 130 * u, sw = 380 * u, sh = 100 * u, subbed = tt >= 2.8, sp = Math.sin(Math.PI * P(2.6, 3.1, tt));
    const ss = B(P(0.45, 0.95, tt)) * (1 - 0.07 * sp);
    if (ss > 0) {
      c.save(); c.translate(sx + sw / 2, cy); c.scale(ss, ss);
      c.shadowColor = subbed ? 'rgba(0,0,0,.5)' : 'rgba(255,23,68,.65)'; c.shadowBlur = 24 * u;
      c.fillStyle = subbed ? '#3A4256' : '#FF1744'; rr(c, -sw / 2, -sh / 2, sw, sh, sh / 2); c.fill(); c.shadowBlur = 0;
      c.fillStyle = '#fff'; c.font = '800 ' + Math.round(38 * u) + 'px Poppins,Arial,sans-serif';
      if (subbed) { c.fillText('SUBSCRIBED', -22 * u, 3 * u); const tw = c.measureText('SUBSCRIBED').width / 2 - 22 * u + 34 * u; c.strokeStyle = '#1FE5A5'; c.lineWidth = 7 * u; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(tw - 14 * u, 3 * u); c.lineTo(tw - 4 * u, 14 * u); c.lineTo(tw + 14 * u, -10 * u); c.stroke(); }
      else c.fillText('SUBSCRIBE', 0, 3 * u);
      c.restore();
    }
    // BELL
    const bx = sx + sw + 30 * u + 48 * u;
    if (tt >= 2.9) {
      const bs = B(P(2.9, 3.3, tt)), ring = tt > 3.3 ? Math.sin((tt - 3.3) * 24) * 0.5 * Math.max(0, 1 - (tt - 3.3) / 1.3) : 0;
      c.save(); c.shadowColor = 'rgba(255,194,26,.8)'; c.shadowBlur = 26 * u; c.translate(bx, cy); c.scale(bs, bs);
      c.fillStyle = '#2B3447'; c.beginPath(); c.arc(0, 0, 48 * u, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
      c.fillStyle = '#FFC21A'; c.save(); c.translate(0, -26 * u); c.rotate(ring); c.translate(0, 26 * u); icon(c, BELL, 0, 0, 54 * u, 0); c.restore();
      c.fillStyle = '#FF1744'; c.beginPath(); c.arc(26 * u, -26 * u, 11 * u, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    // touch indicator: slides in, taps LIKE, then SUBSCRIBE, then fades
    if (tt > 0.5 && tt < 3.5) {
      const a = { x: x + w * 0.92, y: y + h * 0.97 }, l = { x: lx, y: cy + 12 * u }, s = { x: sx + sw * 0.7, y: cy + 14 * u };
      let px, py;
      if (tt < 1.4) { const q = E(P(0.5, 1.4, tt)); px = a.x + (l.x - a.x) * q; py = a.y + (l.y - a.y) * q; }
      else if (tt < 1.9) { px = l.x; py = l.y; }
      else if (tt < 2.6) { const q = E(P(1.9, 2.6, tt)); px = l.x + (s.x - l.x) * q; py = l.y + (s.y - l.y) * q; }
      else { px = s.x; py = s.y; }
      const down = (tt > 1.3 && tt < 1.6) || (tt > 2.6 && tt < 2.9), al = tt < 3.0 ? 1 : 1 - P(3.0, 3.5, tt), r = (down ? 20 : 28) * u;
      c.globalAlpha = al * 0.85; c.fillStyle = 'rgba(255,255,255,.4)'; c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 3 * u; c.stroke(); c.globalAlpha = 1;
    }
    c.restore();
  };
})();
