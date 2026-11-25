/* BETA animated visuals for the live recorder (and the Shorts builder), drawn on a canvas from the day's REAL numbers.
   Same idea as popover.js: bkAnim(ctx, x, y, w, h, an, t, rows) draws inside the rectangle (the visual area), nothing is drawn if t < 0.
     an   = the scene's data (made by studio/lib/teleprompter.js from the episode: nothing is invented)
              {k:'m', bars:[[label, pct], ...], line:[closes]}                                   market scene
              {k:'s', tk, kind:'dip'|'rip', c:[closes], ma:[200-day average or null], d5, v200}  stock pick scene
              {k:'c', rows:[{tk, nm, e, cl, p, st, d}]}                                            calls review scene
     t    = seconds since the scene's animation was triggered (cue based, like bkPop)
     rows = calls scene only: seconds since each row's name was spoken (-1 = not yet), one entry per row
   Everything is laid out on a 1920 x 1080 page and scaled into the rectangle. No per-frame allocation to speak of. */
(function () {
  const E = t => t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);
  const B = t => { if (t <= 0) return 0; if (t >= 1) return 1; const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const P = (s, e, t) => Math.max(0, Math.min(1, (t - s) / (e - s)));
  const GREEN = '#1FE5A5', RED = '#FF3B6B', CYAN = '#26D0FF', YEL = '#FFC21A', INK = '#F2F6FF', MUT = '#9AA7BD', BG = '#03070D', CARD = '#060F1B', EDGE = 'rgba(38,208,255,.45)';
  const FONT = s => '800 ' + s + 'px Poppins,Arial,sans-serif', FONT5 = s => '600 ' + s + 'px Poppins,Arial,sans-serif';
  const DASH = [10, 10], NODASH = [];
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%';
  const col = v => v >= 0 ? GREEN : RED;
  const card = (c, x, y, w, h) => { c.fillStyle = CARD; rr(c, x, y, w, h, 28); c.fill(); c.strokeStyle = EDGE; c.lineWidth = 2.5; c.stroke(); };
  const label = (c, s, x, y, align) => { c.fillStyle = MUT; c.font = FONT5(26); c.textAlign = align || 'left'; c.textBaseline = 'middle'; try { c.letterSpacing = '4px'; } catch (e) {} c.fillText(s, x, y); try { c.letterSpacing = '0px'; } catch (e) {} };
  // confetti: a fixed table, so nothing is allocated per frame
  const CF = []; (function () { let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; const cs = [GREEN, CYAN, YEL, '#FF3B6B', '#fff']; for (let i = 0; i < 22; i++) CF.push({ a: -Math.PI * (0.1 + 0.8 * r()), v: 260 + 420 * r(), z: 7 + 8 * r(), c: cs[i % 5] }); })();
  function confetti(c, cx, cy, tt) {
    if (tt <= 0 || tt > 1.3) return;
    const al = 1 - P(0.7, 1.3, tt); c.save(); c.globalAlpha = al;
    for (let i = 0; i < CF.length; i++) { const p = CF[i]; c.fillStyle = p.c; c.fillRect(cx + Math.cos(p.a) * p.v * tt, cy + Math.sin(p.a) * p.v * tt + 900 * tt * tt * 0.5, p.z, p.z * 0.6); }
    c.restore();
  }

  function line(c, arr, x0, y0, w, h, lo, hi, prog) { // draws the first part (prog 0..1) of the series; returns the head point in H
    const n = arr.length, last = prog * (n - 1), k = Math.floor(last), f = last - k, rng = (hi - lo) || 1;
    c.beginPath();
    for (let i = 0; i <= k && i < n; i++) { const px = x0 + w * i / (n - 1), py = y0 + h * (1 - (arr[i] - lo) / rng); if (i) c.lineTo(px, py); else c.moveTo(px, py); }
    let hx = x0 + w * k / (n - 1), hy = y0 + h * (1 - (arr[Math.min(k, n - 1)] - lo) / rng);
    if (k < n - 1 && f > 0) { const nx = x0 + w * (k + 1) / (n - 1), ny = y0 + h * (1 - (arr[k + 1] - lo) / rng); hx += (nx - hx) * f; hy += (ny - hy) * f; c.lineTo(hx, hy); }
    return { x: hx, y: hy };
  }
  function area(c, hd, x0, base, color) { c.save(); c.lineTo(hd.x, base); c.lineTo(x0, base); c.closePath(); c.globalAlpha *= 0.16; c.fillStyle = color; c.fill(); c.restore(); }
  function dot(c, p, color, tt) { c.save(); c.shadowColor = color; c.shadowBlur = 22; c.fillStyle = color; c.beginPath(); c.arc(p.x, p.y, 11, 0, 6.2832); c.fill(); c.restore(); const r = 14 + 28 * (tt % 1.4) / 1.4; c.save(); c.globalAlpha *= 0.5 * (1 - (tt % 1.4) / 1.4); c.strokeStyle = color; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y, r, 0, 6.2832); c.stroke(); c.restore(); }

  /* (a) market: bars growing to the real % moves with a counting number, and the S&P 500 line drawing in */
  function market(c, an, t) {
    c.fillStyle = BG; c.fillRect(70, 310, 1780, 650);
    card(c, 80, 320, 720, 630); card(c, 830, 320, 1010, 630);
    label(c, 'S&P 500 MOVE', 120, 372);
    const bars = an.bars || [], n = bars.length; if (n) {
      let lo = 0, hi = 0; for (let i = 0; i < n; i++) { lo = Math.min(lo, bars[i][1]); hi = Math.max(hi, bars[i][1]); }
      const top = 520, bot = 840, rng = (hi - lo) || 1, zy = top + (bot - top) * hi / rng, cw = 640 / n;
      c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 2; c.beginPath(); c.moveTo(110, zy); c.lineTo(770, zy); c.stroke();
      for (let i = 0; i < n; i++) {
        const v = bars[i][1], g = E(P(0.2 + 0.35 * i, 1.5 + 0.35 * i, t)), cx = 110 + cw * (i + 0.5), bh = (bot - top) * Math.abs(v) / rng * g, bw = Math.min(150, cw * 0.62), cl = col(v);
        c.save(); c.shadowColor = cl; c.shadowBlur = 18 * g; c.fillStyle = cl;
        if (bh > 1) { if (v >= 0) { rr(c, cx - bw / 2, zy - bh, bw, bh, 12); } else { rr(c, cx - bw / 2, zy, bw, bh, 12); } c.fill(); }
        c.restore();
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = cl; c.font = FONT(n > 2 ? 50 : 66); c.fillText(sgn(v * g), cx, 450);
        c.fillStyle = MUT; c.font = FONT5(24); try { c.letterSpacing = '3px'; } catch (e) {} c.fillText(bars[i][0], cx, 905); try { c.letterSpacing = '0px'; } catch (e) {}
      }
    }
    const ln = an.line; if (ln && ln.length > 2) {
      label(c, 'LAST ' + ln.length + ' SESSIONS', 870, 372);
      let lo = Infinity, hi = -Infinity; for (let i = 0; i < ln.length; i++) { if (ln[i] < lo) lo = ln[i]; if (ln[i] > hi) hi = ln[i]; }
      const up = ln[ln.length - 1] >= ln[0], cl = up ? GREEN : RED, pr = E(P(0.5, 2.8, t)), x0 = 880, w = 900, y0 = 430, h = 430;
      c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 2; for (let g = 0; g < 4; g++) { c.beginPath(); c.moveTo(x0, y0 + h * g / 3); c.lineTo(x0 + w, y0 + h * g / 3); c.stroke(); }
      if (pr > 0) {
        c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = cl; c.lineWidth = 6;
        const hd = line(c, ln, x0, y0, w, h, lo, hi, pr); c.save(); c.shadowColor = cl; c.shadowBlur = 14; c.stroke(); c.restore();
        area(c, hd, x0, y0 + h, cl); if (pr < 1) dot(c, hd, cl, t); else dot(c, hd, cl, t);
      }
    }
  }

  /* (b) a stock pick: the recent closes drawing in left to right, the move counting, the 200-day average fading in */
  function setup(c, an, t) {
    c.fillStyle = BG; c.fillRect(70, 190, 1270, 665);
    card(c, 80, 197, 1250, 648);
    const c0 = an.c || [], n = c0.length; if (n < 3) return;
    const ma = an.ma || [], up = c0[n - 1] >= c0[0], cl = up ? GREEN : RED, short = an.kind === 'rip';
    label(c, 'LAST ' + n + ' SESSIONS', 120, 240);
    // the move counting up/down in the corner
    const d5 = typeof an.d5 === 'number' ? an.d5 : null;
    if (d5 != null) { const g = E(P(0.4, 2.4, t)); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillStyle = MUT; c.font = FONT5(24); try { c.letterSpacing = '3px'; } catch (e) {} c.fillText(short ? '5-DAY RISE' : '5-DAY DROP', 1290, 240); try { c.letterSpacing = '0px'; } catch (e) {} c.fillStyle = col(d5); c.font = FONT(74); c.fillText(sgn(d5 * g), 1290, 305); }
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { if (c0[i] < lo) lo = c0[i]; if (c0[i] > hi) hi = c0[i]; }
    for (let i = 0; i < n; i++) { const m = ma[i]; if (typeof m === 'number' && m > 0) { if (m < lo) lo = m; if (m > hi) hi = m; } }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const x0 = 140, w = 1020, y0 = 370, h = 400;
    c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 2; for (let g = 0; g < 4; g++) { c.beginPath(); c.moveTo(x0, y0 + h * g / 3); c.lineTo(x0 + w, y0 + h * g / 3); c.stroke(); }
    // 200-day average, fading in after the price line has drawn
    const ma0 = E(P(2.3, 3.3, t)); if (ma0 > 0) {
      let first = -1; for (let i = 0; i < n; i++) if (typeof ma[i] === 'number' && ma[i] > 0) { first = i; break; }
      if (first >= 0) { c.save(); c.globalAlpha = ma0; c.strokeStyle = YEL; c.lineWidth = 4; c.setLineDash(DASH); c.beginPath();
        for (let i = first; i < n; i++) { if (!(typeof ma[i] === 'number' && ma[i] > 0)) continue; const px = x0 + w * i / (n - 1), py = y0 + h * (1 - (ma[i] - lo) / (hi - lo)); if (i === first) c.moveTo(px, py); else c.lineTo(px, py); }
        c.stroke(); c.setLineDash(NODASH); c.restore();
        c.save(); c.globalAlpha = ma0; c.fillStyle = YEL; c.font = FONT5(26); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('200-day average', 140, 810); c.restore(); }
    }
    const pr = E(P(0.3, 2.5, t));
    if (pr > 0) {
      c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = cl; c.lineWidth = 6;
      const hd = line(c, c0, x0, y0, w, h, lo, hi, pr); c.save(); c.shadowColor = cl; c.shadowBlur = 14; c.stroke(); c.restore();
      area(c, hd, x0, y0 + h, cl); dot(c, hd, cl, t);
      // price tag on the head of the line
      const tx = hd.x > x0 + w - 150 ? hd.x - 150 : hd.x + 24, ty = Math.max(y0 + 20, Math.min(y0 + h - 20, hd.y - 36));
      if (pr >= 1) { c.fillStyle = INK; c.font = FONT(32); c.textAlign = 'left'; c.textBaseline = 'middle'; c.save(); c.globalAlpha = E(P(2.5, 3.0, t)); c.fillText('$' + c0[n - 1].toFixed(2), tx, ty); c.restore(); }
    }
    // above / below the 200-day chip
    if (typeof an.v200 === 'number') { const a = B(P(3.2, 3.8, t)); if (a > 0) { const above = an.v200 >= 0, txt = (above ? 'ABOVE' : 'BELOW') + ' 200-DAY ' + sgn(Math.abs(an.v200) * E(P(3.2, 4.2, t))); c.save(); c.translate(1190, 810); c.scale(a, a); c.font = FONT(26); const tw = c.measureText(txt).width + 44; c.fillStyle = 'rgba(255,194,26,.12)'; rr(c, -tw, -28, tw, 56, 28); c.fill(); c.strokeStyle = YEL; c.lineWidth = 2.5; c.stroke(); c.fillStyle = YEL; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(txt, -22, 2); c.restore(); } }
  }

  /* (c) the calls review: every call's result chip pops in when its name is spoken, the % counts up, target hits throw confetti */
  const CHIP = { target: ['TARGET HIT', GREEN], stop: ['SAFETY EXIT', RED], closed: ['CLOSED', CYAN], open: ['HOLDING', CYAN], skip: ['SKIPPED', MUT] };
  function calls(c, an, t, rs) {
    c.fillStyle = BG; c.fillRect(60, 295, 1800, 665);
    const rows = an.rows || [], n = Math.min(rows.length, 8); if (!n) return;
    const rh = Math.min(92, (600 - (n - 1) * 12) / n), gap = Math.min(12, (610 - n * rh) / Math.max(1, n - 1)), y0 = 341;
    c.textBaseline = 'middle';
    c.fillStyle = MUT; c.font = FONT5(22); try { c.letterSpacing = '4px'; } catch (e) {}
    c.textAlign = 'left'; c.fillText('STOCK', 120, 314); c.textAlign = 'right'; c.fillText('BOUGHT AT', 912, 314); c.fillText('LAST CLOSE', 1182, 314); c.fillText('RESULT', 1418, 314); c.textAlign = 'center'; c.fillText('STATUS', 1672, 314);
    try { c.letterSpacing = '0px'; } catch (e) {}
    for (let i = 0; i < n; i++) {
      const r = rows[i], y = y0 + i * (rh + gap), ra = E(P(0.05 * i, 0.05 * i + 0.4, t)), tt = rs && rs[i] != null ? rs[i] : -1;
      c.save(); c.globalAlpha = ra; c.fillStyle = CARD; rr(c, 80, y, 1760, rh, 26); c.fill(); c.strokeStyle = EDGE; c.lineWidth = 2.5; c.stroke();
      const my = y + rh / 2;
      c.textAlign = 'left'; c.fillStyle = INK; c.font = FONT(Math.round(rh * 0.43)); c.fillText(r.tk, 122, my);
      const tw = c.measureText(r.tk).width; if (r.nm) { c.fillStyle = MUT; c.font = FONT5(Math.round(rh * 0.28)); c.fillText(r.nm, 122 + tw + 16, my + 4); }
      c.textAlign = 'right'; c.fillStyle = INK; c.font = FONT(Math.round(rh * 0.38));
      c.fillText(r.e == null ? '—' : '$' + r.e.toFixed(2), 912, my); c.fillText('$' + r.cl.toFixed(2), 1182, my);
      c.restore();
      if (tt >= 0) {
        const g = E(P(0, 0.9, tt)), pc = r.p == null ? 0 : r.p, cs = CHIP[r.st] || CHIP.open, ch = rh * 0.62, label = cs[0] + (r.st === 'target' || r.st === 'stop' ? ', DAY ' + r.d : r.st === 'open' ? ', DAY ' + r.d + ' OF 3' : '');
        c.textAlign = 'right'; c.fillStyle = r.st === 'skip' ? MUT : col(pc); c.font = FONT(Math.round(rh * 0.42)); c.fillText(sgn(pc * g), 1418, my);
        const s = B(P(0.15, 0.65, tt)); if (s > 0) { c.font = FONT(Math.round(rh * 0.28)); const cw = Math.max(250, c.measureText(label).width + 52), ccx = Math.min(1672, 1812 - cw / 2); c.save(); c.translate(ccx, my); c.scale(s, s);
          c.fillStyle = 'rgba(255,255,255,.04)'; if (r.st === 'target') { c.shadowColor = GREEN; c.shadowBlur = 22 * (1 - P(0.6, 1.4, tt)) + 4; }
          rr(c, -cw / 2, -ch / 2, cw, ch, ch / 2); c.fillStyle = cs[1] === GREEN ? 'rgba(31,229,165,.14)' : cs[1] === RED ? 'rgba(255,59,107,.14)' : cs[1] === CYAN ? 'rgba(38,208,255,.12)' : 'rgba(154,167,189,.12)'; c.fill(); c.shadowBlur = 0; c.strokeStyle = cs[1]; c.lineWidth = 2.5; c.stroke();
          c.fillStyle = cs[1]; c.textAlign = 'center'; c.fillText(label, 0, 2); c.restore(); }
        if (r.st === 'target') confetti(c, 1672, my, tt - 0.25);
      }
    }
  }

  window.bkAnimOk = function (an) { return !!(an && (an.k === 'm' || an.k === 's' || an.k === 'c')); };
  window.bkAnim = function (c, x, y, w, h, an, t, rs) {
    if (!(t >= 0) || !an) return;
    const k = w / 1920;
    c.save(); c.translate(x, y + (h - 1080 * k) / 2); c.scale(k, k);
    c.beginPath(); c.rect(0, 0, 1920, 1080); c.clip();
    c.globalAlpha = E(P(0, 0.35, t));
    if (an.k === 'm') market(c, an, t); else if (an.k === 's') setup(c, an, t); else if (an.k === 'c') calls(c, an, t, rs);
    c.restore();
  };
})();
