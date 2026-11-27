/*
 * "Oh, I Get It" explainer engine.
 * Turns an episode file (episodes/*.json) into an animated 1920x1080 SVG for one language.
 * Used by the editor (live preview), player.html (rendering) and render.js (video files).
 *
 * Episode shape (see episodes/inflation.json):
 *   { id, title:{lang:..}, languages:{ en:{name,currency,locale,decimals}, te:{...} },
 *     scenes:[ { type, duration, data:{...same in every language}, lang:{ en:{lines:[..], ...}, te:{...} } } ] }
 *
 * Recordings: scene.lang.<lang>.take = { file, kind:'video'|'voice', dur, in, out, store:'device' }
 *   (in/out = where the voice starts and ends, in seconds). That language's scene then follows the voice length.
 *   store 'device': the recording itself stays in the browser that made it; only these timings are in the file.
 *
 * Each scene type below lists its editable fields, so the editor can build its form automatically.
 * Adding a new kind of scene = adding one entry to SCENES. Changing words, prices, order or timing = editing the episode file only.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg', W = 1920, H = 1080, FADE = 0.45;
  // Recordings ("takes"): a scene with a recording in a language lasts as long as the voice, plus a short
  // lead-in before the voice starts and a pause after it ends. The animation stretches to fit.
  const LEAD = 0.3, TAIL = 0.5;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, u) => a + (b - a) * u;
  const ease = u => (u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  const bounce = u => { const n = 7.5625, d = 2.75; if (u < 1 / d) return n * u * u; if (u < 2 / d) return n * (u -= 1.5 / d) * u + .75; if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + .9375; return n * (u -= 2.625 / d) * u + .984375; };
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  function el(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  /** Shrinks a text element's font until it fits maxW pixels. */
  function fit(e, maxW) {
    if (!e.dataset.fs) e.dataset.fs = e.getAttribute('font-size');
    let f = +e.dataset.fs; e.setAttribute('font-size', f);
    try { while (e.getComputedTextLength() > maxW && f > 12) { f -= 1; e.setAttribute('font-size', f); } } catch (err) { /* not in the DOM yet */ }
  }
  function txt(parent, x, y, s, size, weight, fill, opts = {}) {
    const e = el('text', Object.assign({ x, y, 'font-size': size, 'font-weight': weight, fill, 'text-anchor': opts.anchor || 'middle' }, opts.attrs || {}), parent, s);
    if (opts.max) { e.dataset.max = opts.max; }
    return e;
  }
  const fitAll = g => g.querySelectorAll('text[data-max]').forEach(e => fit(e, +e.dataset.max));
  const fill = (s, vars) => String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));

  // ---------------------------------------------------------------- characters
  function makePerson(parent, c = {}) {
    const C = Object.assign({ shirt: '#f4a261', shirtB: '#e09f3e', pants: '#264d7a', pantsB: '#1d3557', skin: '#b5835a', hair: '#2b2118' }, c);
    const root = el('g', {}, parent), P = { root };
    el('ellipse', { cx: 0, cy: 0, rx: 60, ry: 10, fill: '#000', opacity: .15 }, root);
    P.body = el('g', {}, root);
    const limb = (color, len, w) => { const g = el('g', {}, P.body); el('rect', { x: -w / 2, y: 0, width: w, height: len, rx: w / 2, fill: color }, g); return g; };
    P.legB = limb(C.pantsB, 145, 30); P.armB = limb(C.shirtB, 118, 24);
    el('rect', { x: -40, y: -270, width: 80, height: 140, rx: 28, fill: C.shirt }, P.body);
    P.legF = limb(C.pants, 145, 30);
    P.head = el('g', {}, P.body);
    el('circle', { cx: 0, cy: -312, r: 38, fill: C.skin }, P.head);
    el('path', { d: 'M-38 -318 a38 38 0 0 1 76 -6 q-30 -18 -76 6z', fill: C.hair }, P.head);
    el('circle', { cx: 18, cy: -314, r: 4.5, fill: '#2b2118' }, P.head);
    P.mouth = el('path', { d: 'M14 -296 q8 6 16 0', stroke: '#2b2118', 'stroke-width': 3.5, fill: 'none', 'stroke-linecap': 'round' }, P.head);
    P.armF = el('g', {}, P.body);
    el('rect', { x: -12, y: 0, width: 24, height: 118, rx: 12, fill: C.shirt }, P.armF);
    P.hold = el('g', {}, P.armF);
    el('circle', { cx: 0, cy: 118, r: 14, fill: C.skin }, P.armF);
    P.set = (x, y, s, o = {}) => {
      root.setAttribute('transform', `translate(${x},${y}) scale(${s})`);
      root.setAttribute('opacity', o.op == null ? 1 : o.op);
      P.body.setAttribute('transform', `translate(0,${-(o.bob || 0)})`);
      P.legB.setAttribute('transform', `translate(0,-140) rotate(${o.legB || 0})`);
      P.legF.setAttribute('transform', `translate(0,-140) rotate(${o.legF || 0})`);
      P.armB.setAttribute('transform', `translate(0,-250) rotate(${o.armB || 0})`);
      P.armF.setAttribute('transform', `translate(0,-250) rotate(${o.armF || 0})`);
      const m = o.mood == null ? 1 : o.mood;
      P.mouth.setAttribute('d', `M14 ${-296 - (m < 0 ? 3 : 0)} q8 ${6 * m} 16 0`);
      P.head.setAttribute('transform', `rotate(${o.tilt || 0} 0 -300)`);
    };
    return P;
  }
  const walk = (t, speed = 1.7) => { const ph = t * 2 * Math.PI * speed, s = Math.sin(ph); return { legF: 26 * s, legB: -26 * s, armF: -22 * s, armB: 22 * s, bob: Math.abs(Math.cos(ph)) * 7 }; };

  // ---------------------------------------------------------------- props
  const ITEM_KINDS = ['bread', 'milk', 'eggs', 'apple', 'cheese', 'rice', 'tea', 'banana'];
  function item(kind, parent) {
    const g = el('g', {}, parent);
    switch (kind) {
      case 'bread': el('rect', { x: -55, y: -62, width: 110, height: 62, rx: 30, fill: '#d4a373' }, g); [-25, 0, 25].forEach(x => el('path', { d: `M${x - 8} -48 l14 26`, stroke: '#a9743f', 'stroke-width': 5, 'stroke-linecap': 'round' }, g)); break;
      case 'milk': el('rect', { x: -34, y: -120, width: 68, height: 120, rx: 6, fill: '#fff', stroke: '#8ecae6', 'stroke-width': 4 }, g); el('path', { d: 'M-34 -120 L0 -150 L34 -120 Z', fill: '#e9f5fb', stroke: '#8ecae6', 'stroke-width': 4 }, g); el('rect', { x: -34, y: -80, width: 68, height: 34, fill: '#219ebc' }, g); break;
      case 'eggs': [-30, 0, 30].forEach(x => el('ellipse', { cx: x, cy: -50, rx: 18, ry: 24, fill: '#fff6e5', stroke: '#e0c9a6', 'stroke-width': 3 }, g)); el('rect', { x: -56, y: -44, width: 112, height: 44, rx: 8, fill: '#c9ada7' }, g); break;
      case 'apple': el('circle', { cx: 0, cy: -44, r: 44, fill: '#e63946' }, g); el('path', { d: 'M0 -88 q4 -18 18 -22', stroke: '#6b4226', 'stroke-width': 6, fill: 'none' }, g); el('ellipse', { cx: 16, cy: -100, rx: 14, ry: 7, fill: '#2a9d8f', transform: 'rotate(-30 16 -100)' }, g); break;
      case 'cheese': el('path', { d: 'M-60 0 L60 0 L60 -70 Z', fill: '#ffd166' }, g); el('path', { d: 'M-60 0 L60 -70 L60 -82 L-60 -6 Z', fill: '#f4b400' }, g); [[20, -20, 8], [40, -40, 6], [0, -8, 5]].forEach(([x, y, r]) => el('circle', { cx: x, cy: y, r, fill: '#f4b400' }, g)); break;
      case 'rice': el('path', { d: 'M-46 0 L-52 -96 Q0 -116 52 -96 L46 0 Z', fill: '#f1e3c6', stroke: '#c9a77a', 'stroke-width': 4 }, g); el('rect', { x: -40, y: -66, width: 80, height: 34, rx: 6, fill: '#2a9d8f' }, g); break;
      case 'tea': el('rect', { x: -44, y: -100, width: 88, height: 100, rx: 8, fill: '#9c2f2f' }, g); el('rect', { x: -44, y: -70, width: 88, height: 30, fill: '#ffd166' }, g); el('path', { d: 'M-10 -90 q10 -16 20 0', stroke: '#ffd166', 'stroke-width': 5, fill: 'none' }, g); break;
      case 'banana': el('path', { d: 'M-58 -30 Q0 30 58 -60 Q40 -10 -50 -14 Z', fill: '#ffd166', stroke: '#e9b200', 'stroke-width': 4 }, g); break;
      default: el('rect', { x: -45, y: -90, width: 90, height: 90, rx: 12, fill: '#8ecae6' }, g);
    }
    return g;
  }
  function coin(parent, x, y, s) { const g = el('g', { transform: `translate(${x},${y}) scale(${s})` }, parent); el('ellipse', { rx: 34, ry: 12, cy: 6, fill: '#c99700' }, g); el('ellipse', { rx: 34, ry: 12, fill: '#ffd166', stroke: '#c99700', 'stroke-width': 3 }, g); return g; }
  function priceCard(parent, x, y, label, stroke) {
    const g = el('g', { transform: `translate(${x},${y})` }, parent);
    el('rect', { x: -160, y: -74, width: 320, height: 148, rx: 22, fill: '#fff', stroke, 'stroke-width': 6 }, g);
    txt(g, 0, -20, label, 30, 700, '#6b7f8e', { max: 290 });
    return { g, v: txt(g, 0, 46, '', 64, 800, stroke) };
  }
  function bulb(parent, x, y, s, glow) { // the channel logo: glass bulb with a tangled line that becomes straight, sparkle and rays
    const g = el('g', { transform: `translate(${x},${y}) scale(${s})` }, parent);
    if (glow) el('circle', { cx: 0, cy: -10, r: 70, fill: '#ffd166', opacity: .12 }, g);
    const svg = parent.ownerSVGElement || (parent.tagName === 'svg' ? parent : null);
    let fillG = '#ffd166';
    if (svg) {
      const defs = svg.querySelector('defs') || el('defs', {}, svg);
      if (!defs.querySelector('#bulbGlass')) {
        const rg = el('radialGradient', { id: 'bulbGlass', cx: .4, cy: .3, r: .8 }, defs);
        el('stop', { offset: 0, 'stop-color': '#fff0b3' }, rg); el('stop', { offset: .55, 'stop-color': '#ffd166' }, rg); el('stop', { offset: 1, 'stop-color': '#f0a93a' }, rg);
      }
      fillG = 'url(#bulbGlass)';
    }
    const l = el('g', { transform: 'translate(0,-10) scale(.42) translate(-100,-108)' }, g);
    const rays = el('g', { stroke: '#ffd166', 'stroke-width': 11, 'stroke-linecap': 'round' }, l);
    [[100, -8, 100, -34], [154, 6.5, 167, -16], [46, 6.5, 33, -16], [193.5, 46, 216, 33], [6.5, 46, -16, 33]].forEach(([a, b, c, d]) => el('line', { x1: a, y1: b, x2: c, y2: d }, rays));
    el('path', { d: 'M100 12 C48 12 14 52 14 100 C14 134 34 156 52 176 C60 186 62 194 62 204 L138 204 C138 194 140 186 148 176 C166 156 186 134 186 100 C186 52 152 12 100 12Z', fill: fillG }, l);
    el('rect', { x: 60, y: 212, width: 80, height: 16, rx: 8, fill: '#9aa7bb' }, l);
    el('rect', { x: 74, y: 232, width: 52, height: 13, rx: 6.5, fill: '#66758c' }, l);
    el('path', { d: 'M34 132 C50 76 92 150 84 104 C78 74 44 104 70 128 C94 150 112 98 120 100 L166 100', fill: 'none', stroke: '#0d1b2a', 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, l);
    el('path', { d: 'M150 50 l4 12 l12 4 l-12 4 l-4 12 l-4 -12 l-12 -4 l12 -4z', fill: '#fffdf3' }, l);
    return g;
  }

  // ---------------------------------------------------------------- scene library
  // base: the length the scene was designed for (seconds). The animation stretches to whatever duration the episode gives it.
  // cues: where each voiceover line starts, in base seconds (used when the number of lines matches).
  // fields: what the editor shows. per:'lang' = different in each language, per:'data' = same for every language.
  const SCENES = {};
  /** Start of each spoken line, in seconds after the voice starts: matched to the pauses found in your recording (take.marks) when there are some, otherwise spread by line length. */
  function relStarts(lines, tk, span) {
    if (tk && Array.isArray(tk.marks) && tk.marks.length === lines.length) return tk.marks.map((m, j) => j === 0 ? 0 : clamp(m - tk.in, 0, Math.max(0, span - .3)));
    const tot = lines.reduce((a, q) => a + Math.max(12, String(q).length), 0); let acc = 0; return lines.map(q => { const x = acc; acc += span * Math.max(12, String(q).length) / tot; return x; });
  }
  /** When each spoken line starts and ends inside a scene (same split of the recording as the captions use). */
  function lineTimesOf(S, ctx) {
    const lines = (S.L.lines || []).filter(x => String(x).trim()), tk = S.L.take, spanT = tk ? tk.out - tk.in : ctx.dur, offT = tk ? LEAD - .15 : 0;
    const st = relStarts(lines, tk, spanT).map(x => offT + x);
    return { n: lines.length, st, en: st.map((x, j) => j + 1 < st.length ? st[j + 1] : offT + spanT + .35) };
  }

  const CARD_ICONS = ['card', 'phone', 'fingerprint', 'list', 'shop', 'basket', 'lock', 'tick', 'stop', 'bank', 'question', 'pound', 'agent', 'network', 'shield', 'id', 'alert', 'scales', 'bulb', 'detergent', 'soap', 'milk', 'cheese'];
  // Layouts for the presenter scene, like the ones common on YouTube. Your camera picture always sits in the "slot" box.
  const PRES_LAYOUTS = {
    talking: { label: 'Talking head: big and centred, title across the top', slot: { x: 480, y: 200, w: 960, h: 720, r: 36 } },
    cut: { label: 'Standing in front of the banner: only you, no box (cut-out)', slot: { x: 260, y: 150, w: 1400, h: 788, r: 0, mode: 'cut' } },
    soft: { label: 'Soft edges: your whole picture, no box, edges fade into the banner', slot: { x: 302, y: 190, w: 1316, h: 740, r: 0, mode: 'soft' } },
    side: { label: 'Side by side: you on one side, title on the other' },
    circle: { label: 'Circle: you in a round frame, big title beside you' },
    wide: { label: 'Wide: large centred picture under the title', slot: { x: 400, y: 245, w: 1120, h: 630, r: 32 } },
    full: { label: 'Full width: picture fills the top, captions underneath', slot: { x: 0, y: 0, w: 1920, h: 925, r: 0 } },
  };
  // "My video" in any scene: a round bubble in a corner, or the scene shrunk to one side with your video beside it
  const CAM_LAYOUTS = {
    'bubble-right': { label: 'Round bubble, bottom right', slot: { x: 1560, y: 600, w: 330, h: 330, r: 165 } },
    'bubble-left': { label: 'Round bubble, bottom left', slot: { x: 30, y: 600, w: 330, h: 330, r: 165 } },
    'side-right': { label: 'Scene on the left, my video on the right', slot: { x: 1250, y: 150, w: 620, h: 760, r: 36 }, panel: { x: 50, y: 190, s: .6 } },
    'side-left': { label: 'My video on the left, scene on the right', slot: { x: 50, y: 150, w: 620, h: 760, r: 36 }, panel: { x: 718, y: 190, s: .6 } },
  };
  const camSlot = scene => { const T = SCENES[scene.type]; if (!T) return null; if (T.camera) return T.slot(sceneData(scene)); const c = CAM_LAYOUTS[sceneData(scene).cam]; return c ? c.slot : null; };
  const presLayout = d => { d = d || {}; return d.layout && PRES_LAYOUTS[d.layout] ? d.layout : (d.side === 'wide' ? 'wide' : 'side'); };
  /** Chart-style decoration for the talking-head background: candles and a rising line on each side (drawn from scratch, no logos). */
  /** Background of the channel banner: soft glow, golden dots, and the line that starts tangled and becomes straight, ending in a sparkle. */
  function bannerDecor(parent, uid) {
    const g = el('g', {}, parent), svg = parent.ownerSVGElement, defs = svg.querySelector('defs');
    const halo = el('radialGradient', { id: 'bh' + uid, cx: .5, cy: .5, r: .5 }, defs);
    el('stop', { offset: 0, 'stop-color': '#ffd166', 'stop-opacity': .2 }, halo); el('stop', { offset: 1, 'stop-color': '#ffd166', 'stop-opacity': 0 }, halo);
    el('ellipse', { cx: 960, cy: 500, rx: 800, ry: 380, fill: `url(#bh${uid})` }, g);
    const tr = el('linearGradient', { id: 'bt' + uid, x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
    el('stop', { offset: 0, 'stop-color': '#e09f3e', 'stop-opacity': .25 }, tr); el('stop', { offset: .4, 'stop-color': '#ffd166', 'stop-opacity': .8 }, tr); el('stop', { offset: 1, 'stop-color': '#ffd166' }, tr);
    const t = el('g', { transform: 'translate(0,-35) scale(.75)' }, g), d = 'M-40 1130 C 50 1040 140 1250 240 1130 S 380 1040 450 1170 S 570 1250 650 1120 S 790 1090 860 1170 C 920 1236 980 1178 1040 1180 L 2430 1180';
    el('path', { d, fill: 'none', stroke: `url(#bt${uid})`, 'stroke-width': 14, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, t);
    el('path', { d, fill: 'none', stroke: '#ffd166', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: .35, transform: 'translate(0,34)' }, t);
    el('path', { d: 'M2470 1120 l12 40 l40 12 l-40 12 l-12 40 l-12 -40 l-40 -12 l40 -12z', fill: '#fff6dc' }, t);
    [[1750, 180, 5, .5], [285, 190, 6, .4], [1600, 830, 5, .6]].forEach(([x, y, r, o]) => el('circle', { cx: x, cy: y, r, fill: '#ffd166', opacity: o }, g));
    return g;
  }
  function chartDecor(parent, uid) {
    const g = el('g', {}, parent);
    [[0, '#3aa0ff', 1], [1, '#ff7a45', -1]].forEach(([k, col, dir]) => {
      const x0 = k ? 1500 : 60;
      for (let i = 0; i < 9; i++) {
        const h = 120 + ((i * 97 + k * 53) % 220), x = x0 + i * 40, yb = 930 - ((i * 61 + k * 29) % 140), up = (i + k) % 3 !== 0;
        el('line', { x1: x + 11, x2: x + 11, y1: yb - h - 30, y2: yb + 22, stroke: col, 'stroke-width': 3, opacity: .45 }, g);
        el('rect', { x, y: yb - h, width: 22, height: h * .62, rx: 3, fill: up ? col : 'none', stroke: col, 'stroke-width': 3, opacity: .5 }, g);
      }
      const pts = []; for (let i = 0; i < 9; i++) pts.push(`${x0 + i * 40 + 11},${700 - i * 38 * dir - ((i * 53) % 50)}`);
      el('polyline', { points: pts.join(' '), fill: 'none', stroke: k ? '#ffb347' : '#7fd1ff', 'stroke-width': 5, 'stroke-linejoin': 'round', opacity: .7 }, g);
      for (let i = 0; i < 5; i++) txt(g, x0 + 20 + (i % 3) * 110, 330 + i * 120, ((i * 37 + k * 11) % 90 / 10 + 0.2).toFixed(3), 30, 700, col, { anchor: 'start', attrs: { opacity: .28 } });
    });
    const rg = el('radialGradient', { id: 'pgl' + uid, cx: .5, cy: .55, r: .5 }, parent.ownerSVGElement ? parent.ownerSVGElement.querySelector('defs') || parent : parent);
    el('stop', { offset: 0, 'stop-color': '#3a6ea5', 'stop-opacity': .55 }, rg); el('stop', { offset: 1, 'stop-color': '#3a6ea5', 'stop-opacity': 0 }, rg);
    el('rect', { x: 360, y: 80, width: 1200, height: 1000, fill: `url(#pgl${uid})` }, g);
    return g;
  }

  SCENES.presenter = {
    label: 'Presenter (you on camera)', base: 5, captions: true, camera: true,
    /** Where your camera picture sits on screen (it is cropped to fill this box). */
    slot(data) {
      const lay = presLayout(data), side = (data || {}).side;
      if (PRES_LAYOUTS[lay].slot) return PRES_LAYOUTS[lay].slot;
      if (lay === 'circle') return { x: side === 'left' ? 150 : 1170, y: 230, w: 600, h: 600, r: 300 };
      return side === 'center' ? { x: 610, y: 150, w: 700, h: 600, r: 36 } : { x: side === 'left' ? 110 : 1110, y: 150, w: 700, h: 760, r: 36 };
    },
    fields: [
      { k: 'title', per: 'lang', kind: 'text', label: 'Title (shown on screen)' },
      { k: 'lines', per: 'lang', kind: 'lines', label: 'What you say (one line per caption)' },
      { k: 'layout', per: 'data', kind: 'select', options: Object.keys(PRES_LAYOUTS).map(k => [k, PRES_LAYOUTS[k].label]), label: 'Layout' },
      { k: 'side', per: 'data', kind: 'select', options: ['left', 'right', 'center'], label: 'Which side (for Side by side and Circle)' },
      { k: 'story', per: 'data', kind: 'select', options: [['', 'None'], ['shops', 'Animated story on the empty half: two shops and the agent (Side by side or Circle)']], label: 'Animated story beside you' },
      { k: 'popups', per: 'lang', kind: 'lines', label: 'Popups behind you while you speak, one per line, as: line number | picture | word. The picture appears when that spoken line starts and goes away again. Pictures: ' + CARD_ICONS.join(', ') },
    ],
    defaults: { data: { layout: 'talking', side: 'right' }, lang: { title: 'Topic title', lines: ['Say hello and introduce the topic.'] } },
    build(g, S, ctx) {
      const lay = presLayout(S.data), side = S.data.side || 'right', r = this.slot(S.data), banner = lay === 'talking' || lay === 'cut' || lay === 'soft';
      const bg = el('g', {}, g);
      const grd = el('linearGradient', { id: 'pg' + ctx.uid, x1: 0, y1: 0, x2: 1, y2: 1 }, ctx.defs);
      el('stop', { offset: 0, 'stop-color': '#0d1b2a' }, grd); el('stop', { offset: 1, 'stop-color': banner ? '#10294a' : '#1b3a5c' }, grd);
      el('rect', { width: W, height: H, fill: `url(#pg${ctx.uid})` }, bg);
      const dots = el('g', { opacity: .18 }, bg);
      for (let i = 0; i < 26; i++) { const x = (i * 337) % W, y = (i * 211) % H; el('circle', { cx: x, cy: y, r: 3 + (i % 4) * 2, fill: '#ffd166' }, dots); }
      if (banner) bannerDecor(bg, ctx.uid);
      else { const big = bulb(bg, side === 'left' ? 1500 : 420, 560, 6.5, false); big.setAttribute('opacity', .07); }
      // popups that come and go behind you, each tied to a spoken line (the camera picture is drawn on top of them)
      const popSpec = (S.L.popups || []).map(x => String(x).split('|').map(q => q.trim())).filter(a => a.length >= 2 && +a[0] > 0 && a[1]).map(a => ({ line: +a[0] - 1, icon: a[1].toLowerCase(), label: a[2] || '' })), popLines = (S.L.lines || []).filter(x => String(x).trim());
      const pops = []; let storyFn = null;
      if (popSpec.length && popLines.length) {
        const tk = S.L.take, spanT = tk ? tk.out - tk.in : ctx.dur, offT = tk ? LEAD - .15 : 0;
        const st = relStarts(popLines, tk, spanT).map(x => offT + x), en = st.map((x, j) => (j + 1 < st.length ? st[j + 1] : offT + spanT + .35));
        // popups sit right beside you (just outside the camera picture, or just outside your shoulders for cut-out layouts), nearest column first
        const half = r.mode ? 520 : null, lx = half ? 960 - half : r.x, rx = half ? 960 + half : r.x + r.w, sides = [];
        const room = (a2, b2) => b2 - a2; // free width on that side
        if (room(0, lx) >= 240) sides.push({ dir: -1, edge: lx, free: lx }); if (room(rx, W) >= 240) sides.push({ dir: 1, edge: rx, free: W - rx });
        if (sides.length === 2 && Math.max(sides[0].free, sides[1].free) >= 700) sides.splice(sides[0].free >= sides[1].free ? 1 : 0, 1);
        const slots = [], rows = [340, 520, 700];
        rows.forEach((yy, ri) => [0, 1].forEach(ci => sides.forEach((sd, si) => { if (sd.free < 240 + ci * 260) return; slots.push([Math.round(sd.edge + sd.dir * (125 + ci * 250)), yy + ((ri + ci + si) % 2) * 25]); })));
        if (!slots.length) slots.push([960, 330]);
        // side by side (or circle): the whole empty half becomes a stage where each spoken line's picture pops up BIG, one line at a time
        const bigSd = sides.length === 1 && sides[0].free >= 700 ? sides[0] : null, bigCx = bigSd ? (bigSd.dir < 0 ? bigSd.edge / 2 : bigSd.edge + bigSd.free / 2) : 0;
        const per = {};
        const storyOn = !!bigSd && (S.data.story === 'shops' || (S.data.story == null && popSpec.some(p => p.icon === 'shop'))), SA = Math.max(0, (+S.data.storyFrom || 3) - 1);
        popSpec.forEach(p => { if (st[p.line] != null && !(storyOn && p.line >= SA)) (per[p.line] = per[p.line] || []).push(p); });
        const popG = el('g', {}, g); let k = 0;
        Object.keys(per).forEach(j => { const arr = per[j], len = en[j] - st[j]; arr.forEach((p, i) => {
          const [px, py] = slots[k % slots.length], gg = el('g', { opacity: 0 }, popG);
          const ring = el('circle', { r: 78, fill: 'none', stroke: '#ffd166', 'stroke-width': 5 }, gg);
          el('circle', { r: 78, fill: '#0b1522', opacity: .9, stroke: '#ffd166', 'stroke-width': 5 }, gg);
          const ic = el('g', { transform: 'scale(.74)' }, gg); cardIcon(ic, p.icon);
          if (p.label) { const t = txt(gg, 0, 134, p.label, 32, 800, '#fff', { max: 236, attrs: { stroke: '#05101c', 'stroke-width': 7, 'paint-order': 'stroke' } }); void t; }
          const Bz = bigSd ? (arr.length > 2 ? 1.1 : arr.length > 1 ? 1.45 : 1.9) : 1, bx = bigSd ? bigCx + (i - (arr.length - 1) / 2) * (arr.length > 2 ? 300 : 380) : px, by = bigSd ? 470 : py;
          pops.push({ gg, ring, B: Bz, px: bx, py: by, k, t0: st[j] + .12 + (len * .78) * (i / arr.length), life: (bigSd ? (l0 => Math.max(1, Math.min(l0, en[j] - (st[j] + .12 + (len * .78) * (i / arr.length)) - .05)))(Math.min(4.4, Math.max(2.6, len / arr.length * 1.5 + 1))) : Math.min(4.4, Math.max(2.6, len / arr.length * 1.5 + 1))) }); k++; }); });
        if (storyOn) { // the animated story on the empty half, timed to the spoken lines
          const sc0 = Math.min(1, (bigSd.free - 40) / 940), sg = el('g', { transform: `translate(${Math.round(bigCx - 450 * sc0)},${Math.round(150 + (1 - sc0) * 40)}) scale(${sc0})` }, g);
          const L1 = (i2, f) => i2 < st.length ? (f ? en[i2] : st[i2]) : (f ? offT + spanT : offT + spanT * .9), tA = L1(SA), tB = L1(SA + 1), tC = L1(SA + 2), tD = L1(SA + 3), tE = L1(SA + 3, 1), tAe = L1(SA, 1), tBe = L1(SA + 1, 1), tCe = L1(SA + 2, 1);
          const ico = (par, name, k2) => { const q = el('g', {}, par), w2 = el('g', { transform: `scale(${k2})` }, q); cardIcon(w2, name); return q; };
          const pill = (par, cx, cy, w2, text, fill, col) => { const q = el('g', {}, par); el('rect', { x: cx - w2 / 2, y: cy - 26, width: w2, height: 52, rx: 26, fill, stroke: '#05101c', 'stroke-width': 3 }, q); txt(q, cx, cy + 9, text, 26, 800, col, { max: w2 - 24 }); return q; };
          const shop = (x0, col, name, items) => { const q = el('g', {}, sg);
            el('rect', { x: x0, y: 250, width: 280, height: 310, fill: '#e9edf2' }, q); el('rect', { x: x0, y: 232, width: 280, height: 30, fill: '#c9d2dc' }, q);
            el('rect', { x: x0 + 20, y: 170, width: 240, height: 52, rx: 10, fill: '#264653' }, q); txt(q, x0 + 140, 207, name, 32, 800, '#ffd166', { max: 210 });
            for (let i = 0; i < 7; i++) el('path', { d: `M${x0 + i * 40} 262 h40 v34 q-20 18 -40 0 z`, fill: i % 2 ? '#fff' : col }, q);
            el('rect', { x: x0 + 20, y: 330, width: 160, height: 140, rx: 8, fill: '#bde0fe', stroke: '#264653', 'stroke-width': 6 }, q);
            items.forEach((n, i) => { const it = ico(q, n, .5); it.setAttribute('transform', `translate(${x0 + 62 + i * 76},${420}) scale(.62)`); });
            el('rect', { x: x0 + 196, y: 380, width: 66, height: 180, fill: '#264653' }, q); return q; };
          const s1 = shop(20, '#2a9d8f', 'SHOP 1', ['detergent', 'soap']), s2 = shop(600, '#e76f51', 'SHOP 2', ['milk', 'cheese']);
          el('rect', { x: -10, y: 560, width: 920, height: 14, rx: 7, fill: '#3a4a60', opacity: .9 }, sg);
          const tg1 = pill(sg, 160, 118, 330, 'Cheapest: detergent, soap', '#2a9d8f', '#fff'), tg2 = pill(sg, 740, 118, 330, 'Best quality: milk, cheese', '#ffd166', '#1b2433');
          const pw = el('g', {}, sg), PP = makePerson(pw, { shirt: '#4cc9f0', shirtB: '#3a9bbd' });
          const bub = el('g', {}, sg); el('rect', { x: 280, y: 255, width: 340, height: 120, rx: 30, fill: '#fff', stroke: '#05101c', 'stroke-width': 4 }, bub); txt(bub, 450, 305, 'Two shops?', 36, 800, '#1b2433', { max: 300 }); txt(bub, 450, 350, 'Such a hassle…', 34, 800, '#1b2433', { max: 300 });
          const ag = el('g', {}, sg); el('circle', { r: 62, fill: '#0b1522', stroke: '#ffd166', 'stroke-width': 6 }, ag); ico(ag, 'agent', .85);
          const t1 = pill(sg, 160, 56, 110, '✓', '#16a34a', '#fff'), t2 = pill(sg, 740, 56, 110, '✓', '#16a34a', '#fff');
          const bas = el('g', {}, sg); el('circle', { r: 100, fill: '#0b1522', opacity: .92, stroke: '#ffd166', 'stroke-width': 6 }, bas); ico(bas, 'basket', 1.1);
          const flyN = ['detergent', 'soap', 'milk', 'cheese'], fly = flyN.map((n, i) => { const q = el('g', {}, sg); const w3 = el('g', { transform: 'scale(.6)' }, q); cardIcon(w3, n); return q; });
          const paid = pill(sg, 450, 600, 420, 'Paid for you ✓', '#2a9d8f', '#fff');
          storyFn = t => {
            const pop = (q, t0, x, y, k2 = 1) => { const a = prog(t, t0, t0 + .45), bnc = bounce(a); q.setAttribute('opacity', Math.min(1, a * 3)); q.setAttribute('transform', `translate(${x},${y}) scale(${lerp(.3, 1, bnc) * k2})`); };
            const inA = ease(prog(t, tA, tA + .6));
            s1.setAttribute('transform', `translate(${(1 - inA) * -400},0)`); s2.setAttribute('transform', `translate(${(1 - inA) * 400},0)`); s1.setAttribute('opacity', inA); s2.setAttribute('opacity', inA);
            pop(tg1, tA + .9, 0, 0); pop(tg2, tA + (tAe - tA) * .55, 0, 0);
            // the person (lazy walking back and forth), then relaxing while the agent works
            const walkOn = t >= tB - .2 && t < tC + .3, fade = t >= tC ? 1 - ease(prog(t, tC, tC + .6)) * .65 : ease(prog(t, tB - .2, tB + .3));
            const wt = Math.max(0, t - tB), ph = Math.sin(wt * .8), moving = t < tCe && t >= tB && t < tC, x = 450 + 170 * ph, dir = Math.cos(wt * .8) >= 0 ? 1 : -1;
            pw.setAttribute('transform', `translate(${moving ? x : 450},560) scale(${moving ? dir : 1},1)`);
            PP.set(0, 0, .62, Object.assign({ op: Math.max(0, fade), mood: t > (tB + tBe) / 2 && t < tC ? -1 : 1 }, moving ? walk(wt, 1.6) : {}));
            const bq = prog(t, tB + (tBe - tB) * .5, tB + (tBe - tB) * .5 + .4) * (1 - prog(t, tBe, tBe + .4)); bub.setAttribute('opacity', bq); bub.setAttribute('transform', `translate(0,${(1 - bq) * 20})`);
            // the agent visits both shops, then everything goes into the basket and is paid
            const ak = prog(t, tC + .3, tD - .1), ax = ak < .25 ? lerp(450, 160, ease(ak / .25)) : ak < .6 ? lerp(160, 740, ease((ak - .25) / .35)) : lerp(740, 450, ease((ak - .6) / .4)), ay = 330 + Math.sin(ak * 12) * 10 - (ak > .25 ? 0 : 0);
            const agOn = t >= tC + .2 && t < tD + .3; ag.setAttribute('opacity', agOn ? ease(prog(t, tC + .2, tC + .6)) * (1 - ease(prog(t, tD, tD + .3))) : 0); ag.setAttribute('transform', `translate(${ax},${ay - 40}) scale(${.8 + Math.sin(t * 6) * .03})`);
            pop(t1, tC + .3 + (tD - tC) * .25 * .9, 0, 0); pop(t2, tC + .3 + (tD - tC) * .6 * .9, 0, 0);
            const ba = prog(t, tD, tD + .5); bas.setAttribute('opacity', Math.min(1, ba * 3)); bas.setAttribute('transform', `translate(450,430) scale(${lerp(.3, 1, bounce(ba))})`);
            fly.forEach((q, i) => { const f = prog(t, tD + .4 + i * .35, tD + 1.1 + i * .35), sx = [160, 220, 740, 690][i], sy = 440; q.setAttribute('opacity', f > 0 && f < 1 ? 1 : 0); q.setAttribute('transform', `translate(${lerp(sx, 450, ease(f))},${lerp(sy, 430, ease(f)) - Math.sin(f * Math.PI) * 120}) scale(${1 - f * .3})`); });
            const pa = prog(t, tD + 2.0, tD + 2.5); paid.setAttribute('opacity', Math.min(1, pa * 3)); paid.setAttribute('transform', `translate(0,${(1 - bounce(pa)) * 30})`);
          };
        }
      }
      const brand = el('g', {}, g), third = el('g', {}, g);
      const cam = S.L.take && S.L.take.kind === 'video' ? S.L.take : null;
      if (banner) { // channel name big in gold across the top, topic title under it
        const gold = el('linearGradient', { id: 'gd' + ctx.uid, x1: 0, y1: 0, x2: 0, y2: 1 }, ctx.defs);
        el('stop', { offset: 0, 'stop-color': '#fff3c4' }, gold); el('stop', { offset: .55, 'stop-color': '#e8c15a' }, gold); el('stop', { offset: 1, 'stop-color': '#b88a1f' }, gold);
        txt(brand, 960, 122, ctx.channelName.toUpperCase(), 100, 800, `url(#gd${ctx.uid})`, { max: 1600, attrs: { stroke: '#0b1522', 'stroke-width': 3, 'paint-order': 'stroke' } });
        txt(third, 960, 176, S.L.title || '', 40, 700, '#cfe3ff', { max: 1400 });
      } else {
        brand.setAttribute('transform', lay === 'wide' ? 'translate(70,22)' : lay === 'full' ? 'translate(70,978)' : 'translate(70,70)');
        bulb(brand, 40, 46, .9, true);
        txt(brand, 100, 70, ctx.channelName, 44, 800, '#fff', { anchor: 'start', max: 900 });
        if (lay === 'wide') {
          txt(third, 960, 205, S.L.title || '', 72, 800, '#fff', { anchor: 'middle', max: 1700 });
          el('rect', { x: 760, y: 222, width: 400, height: 8, rx: 4, fill: '#ffd166' }, third);
        } else if (lay === 'circle') {
          const left = side === 'left', tx = left ? 1000 : 120;
          el('rect', { x: tx - 20, y: 380, width: 10, height: 190, rx: 5, fill: '#ffd166' }, third);
          txt(third, tx, 470, S.L.title || '', 84, 800, '#fff', { anchor: 'start', max: 760 });
          txt(third, tx, 548, ctx.channelName, 36, 700, '#ffd166', { anchor: 'start', max: 760 });
        } else if (lay === 'side') {
          el('rect', { x: side === 'left' ? 1810 : 110, y: 790, width: 10, height: 90, rx: 5, fill: '#ffd166' }, third);
          txt(third, side === 'left' ? 1785 : 145, 856, S.L.title || '', 60, 800, '#fff', { anchor: side === 'left' ? 'end' : 'start', max: cam ? 900 : 1150 });
        }
      }
      let ph = null, img = null, camG = null;
      const border = lay !== 'full' && !r.mode;
      if (cam) { // your recorded video, in a frame. In the editor the video plays on top of this box.
        camG = el('g', {}, g);
        const clip = el('clipPath', { id: 'pc' + ctx.uid }, ctx.defs);
        el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: r.r }, clip);
        if (border) el('rect', { x: r.x - 10, y: r.y - 10, width: r.w + 20, height: r.h + 20, rx: r.r + 10, fill: '#ffd166', opacity: .9 }, camG);
        if (!r.mode) el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: r.r, fill: '#13263b' }, camG);
        if (cam.frames) {
          img = el('image', { x: r.x, y: r.y, width: r.w, height: r.h, preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#pc${ctx.uid})` }, camG);
          img.addEventListener('load', () => img.removeAttribute('data-pending'));
          img.addEventListener('error', () => img.removeAttribute('data-pending'));
        }
      } else if (ctx.preview) { // where your camera picture goes (preview only, never rendered into the video)
        ph = el('g', { opacity: .4 }, g);
        el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: r.r, fill: 'rgba(255,255,255,.04)', stroke: '#fff', 'stroke-width': 4, 'stroke-dasharray': '14 10' }, ph);
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        el('circle', { cx, cy: cy - r.h * .1, r: Math.min(r.w, r.h) * .13, fill: 'none', stroke: '#fff', 'stroke-width': 4, 'stroke-dasharray': '14 10' }, ph);
        txt(ph, cx, cy + r.h * .2, 'YOUR CAMERA', 30, 700, '#fff');
      }
      return u => {
        const ts = u * this.base, a = ease(prog(ts, .2, .9));
        const dx = lay === 'side' ? (side === 'left' ? 1 : -1) * (1 - a) * 60 : 0, dy = lay === 'side' || lay === 'circle' ? 0 : -(1 - a) * 30;
        third.setAttribute('transform', `translate(${dx},${dy})`); third.setAttribute('opacity', a);
        brand.setAttribute('opacity', ease(prog(ts, 0, .5)));
        dots.setAttribute('transform', `translate(0,${-ts * 6})`);
        if (camG) camG.setAttribute('opacity', ease(prog(u * ctx.dur, 0, .35)));
        if (storyFn) storyFn(u * ctx.dur);
        pops.forEach(p => { const t = u * ctx.dur - p.t0; if (t < 0 || t > p.life) { p.gg.setAttribute('opacity', 0); return; }
          const inn = bounce(prog(t, 0, .5)), out = 1 - ease(prog(t, p.life - .35, p.life)), sc = lerp(.3, 1, inn) * lerp(.7, 1, out) * (p.B || 1), bob = Math.sin(t * 3 + p.k) * 9, rot = Math.sin(t * 2.2 + p.k * 1.7) * 4, rg = prog(t, 0, .7);
          p.gg.setAttribute('opacity', Math.min(1, t / .15) * out); p.gg.setAttribute('transform', `translate(${p.px},${p.py + bob}) rotate(${rot}) scale(${sc})`);
          p.ring.setAttribute('r', lerp(105, 190, rg)); p.ring.setAttribute('opacity', 1 - rg); });
        if (img) { // video frames prepared by render.js: frame number = time since the voice started
          const f = cam.frames, n = clamp(Math.floor((u * ctx.dur - LEAD) * f.fps), 0, f.count - 1) + 1;
          const href = `${f.url}/${String(n).padStart(5, '0')}.jpg`;
          if (img.getAttribute('href') !== href) { img.setAttribute('data-pending', '1'); img.setAttribute('href', href); }
        }
      };
    },
  };

  SCENES.walkToShop = {
    label: 'Person walks into a shop', base: 6, captions: true,
    fields: [
      { k: 'shopName', per: 'lang', kind: 'text', label: 'Shop sign' },
      { k: 'lines', per: 'lang', kind: 'lines', label: 'Voiceover lines' },
    ],
    defaults: { data: {}, lang: { shopName: 'CORNER SHOP', lines: ['You pop into the shop.'] } },
    build(g, S, ctx) {
      const sky = el('linearGradient', { id: 'sky' + ctx.uid, x1: 0, y1: 0, x2: 0, y2: 1 }, ctx.defs);
      el('stop', { offset: 0, 'stop-color': '#8ecae6' }, sky); el('stop', { offset: 1, 'stop-color': '#d6f0fa' }, sky);
      el('rect', { width: W, height: H, fill: `url(#sky${ctx.uid})` }, g);
      el('circle', { cx: 300, cy: 170, r: 70, fill: '#ffe8a3' }, g);
      const cl = el('g', { fill: '#fff', opacity: .9 }, g);
      el('ellipse', { cx: 700, cy: 160, rx: 110, ry: 34 }, cl); el('ellipse', { cx: 770, cy: 135, rx: 70, ry: 40 }, cl); el('ellipse', { cx: 1500, cy: 120, rx: 120, ry: 30 }, cl);
      [[40, 420, 260, 440], [330, 350, 200, 510], [560, 460, 300, 400], [890, 390, 210, 470]].forEach(([x, y, w, h]) => {
        el('rect', { x, y, width: w, height: h, fill: '#a9c6d9' }, g);
        for (let yy = y + 40; yy < y + h - 60; yy += 80) for (let xx = x + 30; xx < x + w - 40; xx += 70) el('rect', { x: xx, y: yy, width: 36, height: 46, fill: '#d8e8f2' }, g);
      });
      el('rect', { x: 1150, y: 360, width: 640, height: 500, fill: '#e76f51' }, g);
      el('rect', { x: 1150, y: 340, width: 640, height: 40, fill: '#c0563b' }, g);
      el('rect', { x: 1230, y: 370, width: 480, height: 80, rx: 10, fill: '#264653' }, g);
      txt(g, 1470, 425, S.L.shopName || '', 46, 800, '#ffd166', { max: 440, attrs: { 'letter-spacing': 3 } });
      for (let i = 0; i < 8; i++) el('path', { d: `M${1150 + i * 80} 470 h80 v60 q-40 30 -80 0 z`, fill: i % 2 ? '#fff' : '#2a9d8f' }, g);
      el('rect', { x: 1520, y: 560, width: 230, height: 200, fill: '#bde0fe', stroke: '#264653', 'stroke-width': 8 }, g);
      [['#2a9d8f', 1545, 690, 60], ['#f4a261', 1595, 670, 80], ['#e9c46a', 1645, 700, 50], ['#2a9d8f', 1695, 680, 70]].forEach(([c, x, y, h]) => el('rect', { x, y, width: 40, height: h, fill: c }, g));
      el('rect', { x: 1290, y: 560, width: 160, height: 300, fill: '#264653' }, g);
      const doorIn = el('rect', { x: 1290, y: 560, width: 160, height: 300, fill: '#ffd9a0', opacity: 0 }, g);
      el('circle', { cx: 1430, cy: 715, r: 8, fill: '#ffd166' }, g);
      el('rect', { y: 860, width: W, height: 220, fill: '#adb5bd' }, g);
      el('rect', { y: 860, width: W, height: 14, fill: '#8d959c' }, g);
      for (let x = 0; x < W; x += 160) el('rect', { x, y: 874, width: 4, height: 206, fill: '#9aa2a9' }, g);
      const P = makePerson(el('g', {}, g));
      return u => {
        const ts = u * this.base, k = prog(ts, 0, 5.0), x = lerp(-120, 1370, k), enter = prog(ts, 5.0, 5.5);
        doorIn.setAttribute('opacity', prog(ts, 4.4, 4.9));
        const wk = ts < 5.0 ? walk(ts) : {};
        P.set(x + enter * 30, 860, 1 - enter * .15, Object.assign({}, wk, { op: 1 - enter }));
      };
    },
  };

  SCENES.tapToPay = {
    label: 'Tap to pay at the till', base: 4.8, captions: true,
    fields: [
      { k: 'amount', per: 'lang', kind: 'money', label: 'Amount on the card machine' },
      { k: 'paid', per: 'lang', kind: 'text', label: 'Screen text after paying' },
      { k: 'lines', per: 'lang', kind: 'lines', label: 'Voiceover lines' },
      { k: 'zoom', per: 'data', kind: 'select', options: ['yes', 'no'], label: 'Zoom into the machine at the end' },
    ],
    defaults: { data: { zoom: 'yes' }, lang: { amount: 4.5, paid: '✓ Paid', lines: ['You tap your phone. Beep. Done.'] } },
    cues: [{ at: 3.2, sound: 'beep' }],
    build(g, S, ctx) {
      const z = el('g', {}, g);
      const wall = el('linearGradient', { id: 'wl' + ctx.uid, x1: 0, y1: 0, x2: 0, y2: 1 }, ctx.defs);
      el('stop', { offset: 0, 'stop-color': '#fdf0d5' }, wall); el('stop', { offset: 1, 'stop-color': '#f6dfb4' }, wall);
      el('rect', { width: W, height: H, fill: `url(#wl${ctx.uid})` }, z);
      [260, 470, 680].forEach(y => { el('rect', { x: 60, y: y + 120, width: 880, height: 18, fill: '#a86f4a' }, z); for (let i = 0, x = 80; x < 900; i++) { const w = 50 + ((i * 37) % 40), h = 70 + ((i * 53) % 50); el('rect', { x, y: y + 120 - h, width: w, height: h, rx: 6, fill: ['#e76f51', '#2a9d8f', '#e9c46a', '#f4a261', '#264653', '#8ecae6'][i % 6] }, z); x += w + 14; } });
      [300, 500].forEach(y => { el('rect', { x: 1300, y: y + 120, width: 560, height: 18, fill: '#a86f4a' }, z); for (let i = 0, x = 1320; x < 1840; i++) { const w = 46 + ((i * 29) % 30), h = 60 + ((i * 41) % 50); el('rect', { x, y: y + 120 - h, width: w, height: h, rx: 6, fill: ['#bde0fe', '#ffafcc', '#cdb4db', '#a2d2ff'][i % 4] }, z); x += w + 12; } });
      el('rect', { y: 1000, width: W, height: 80, fill: '#c9a77a' }, z);
      const P = makePerson(el('g', {}, z));
      const phone = el('rect', { x: -9, y: 110, width: 32, height: 52, rx: 6, fill: '#0d1b2a', stroke: '#adb5bd', 'stroke-width': 3 }, P.hold);
      el('rect', { x: 1000, y: 790, width: 920, height: 290, fill: '#8d5a3b' }, z);
      el('rect', { x: 980, y: 770, width: 960, height: 34, rx: 6, fill: '#a86f4a' }, z);
      const term = el('g', { transform: 'translate(1035,560)' }, z);
      el('rect', { width: 150, height: 215, rx: 20, fill: '#2b2d42' }, term);
      const scr = el('rect', { x: 16, y: 18, width: 118, height: 86, rx: 8, fill: '#8ecae6' }, term);
      const st = txt(term, 75, 72, '', 26, 800, '#0d1b2a', { max: 108 });
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) el('rect', { x: 22 + c * 38, y: 122 + r * 28, width: 30, height: 20, rx: 4, fill: r && c === 2 ? '#2a9d8f' : '#555b6e' }, term);
      el('path', { d: 'M58 188 q17 -12 34 0 M64 196 q11 -7 22 0', stroke: '#8d99ae', 'stroke-width': 4, fill: 'none' }, term);
      const rp = el('g', { fill: 'none', stroke: '#2a9d8f', 'stroke-width': 6 }, z);
      const glow = el('radialGradient', { id: 'gl' + ctx.uid }, ctx.defs); el('stop', { offset: 0, 'stop-color': '#ffd166' }, glow); el('stop', { offset: 1, 'stop-color': '#ffd166', 'stop-opacity': 0 }, glow);
      const flash = el('circle', { cx: 1110, cy: 620, r: 160, fill: `url(#gl${ctx.uid})`, opacity: 0 }, z);
      const amount = ctx.money(S.L.amount, true);
      return u => {
        const ts = u * this.base, reach = ease(prog(ts, .8, 1.8)), armF = lerp(8, -78, reach);
        phone.setAttribute('opacity', prog(ts, .3, .7));
        P.set(820, 1010, 1.45, { armF, armB: 4 + Math.sin(ts * 2.2) * 1.2, legF: 2, legB: -2 });
        rp.innerHTML = '';
        const hx = 820 + Math.sin(-armF * Math.PI / 180) * 1.45 * 125, hy = 1010 - 1.45 * 250 + Math.cos(armF * Math.PI / 180) * 1.45 * 125;
        for (let k = 0; k < 3; k++) { const v = prog(ts, 1.8 + k * .22, 2.7 + k * .22); if (v > 0 && v < 1) el('circle', { cx: hx + 20, cy: hy, r: 20 + v * 90, opacity: 1 - v }, rp); }
        if (ts < 2.0) { scr.setAttribute('fill', '#8ecae6'); st.textContent = amount; }
        else if (ts < 3.0) { scr.setAttribute('fill', '#ffd166'); st.textContent = '•'.repeat((Math.floor((ts - 2) * 4) % 4) + 1); }
        else { scr.setAttribute('fill', '#06d6a0'); st.textContent = S.L.paid || '✓'; }
        fit(st, 108);
        flash.setAttribute('opacity', (1 - prog(ts, 3.0, 3.7)) * prog(ts, 2.95, 3.05));
        const zz = S.data.zoom === 'no' ? 0 : ease(prog(ts, 3.8, 4.8)), s = lerp(1, 5, zz);
        z.setAttribute('transform', `translate(1110,640) scale(${s}) translate(-1110,-640)`);
      };
    },
  };

  SCENES.paymentJourney = {
    label: 'Payment journey (4 stops and back)', base: 6, captions: true,
    fields: [
      { k: 'heading', per: 'lang', kind: 'text', label: 'Heading' },
      { k: 'stops', per: 'lang', kind: 'lines', label: 'The 4 stops (one per line)' },
      { k: 'notes', per: 'lang', kind: 'lines', label: 'Small text under each stop (one per line)' },
      { k: 'approved', per: 'lang', kind: 'text', label: 'Final word' },
      { k: 'seconds', per: 'data', kind: 'number', label: 'Timer counts up to (seconds)' },
      { k: 'lines', per: 'lang', kind: 'lines', label: 'Voiceover lines' },
    ],
    defaults: { data: { seconds: 2 }, lang: { heading: 'What happens in those 2 seconds', stops: ['Card terminal', "Shop's bank", 'Card network', 'Your bank'], notes: ['reads your card', 'passes the request on', 'routes it to your bank', 'checks money & fraud'], approved: '✓ Approved', lines: ['But your payment just went on a journey.', "Your bank checks it's really you, and says yes."] } },
    cues: [{ line: 0, at: 0 }, { line: 1, at: 3.0 }],
    build(g, S, ctx) {
      el('rect', { width: W, height: H, fill: '#0d1b2a' }, g);
      const grid = el('g', { stroke: '#1b2f45', 'stroke-width': 2 }, g);
      for (let x = 0; x <= W; x += 80) el('line', { x1: x, y1: 0, x2: x, y2: H }, grid);
      for (let y = 0; y <= H; y += 80) el('line', { x1: 0, y1: y, x2: W, y2: y }, grid);
      txt(g, 960, 130, S.L.heading || '', 58, 800, '#fff', { max: 1450 });
      const timer = txt(g, 1800, 130, '0.0s', 52, 800, '#ffd166', { anchor: 'end' });
      const fp = 'M260 470 L1660 470', bp = 'M1660 600 C1400 880 520 880 260 600';
      el('path', { d: fp, stroke: '#2c4a6b', 'stroke-width': 10, fill: 'none', 'stroke-linecap': 'round' }, g);
      el('path', { d: bp, stroke: '#2c4a6b', 'stroke-width': 10, fill: 'none', 'stroke-dasharray': '4 22', 'stroke-linecap': 'round' }, g);
      const fl = el('path', { d: fp, stroke: '#ffd166', 'stroke-width': 10, fill: 'none', 'stroke-linecap': 'round' }, g);
      const bl = el('path', { d: bp, stroke: '#06d6a0', 'stroke-width': 10, fill: 'none', 'stroke-linecap': 'round' }, g);
      const stops = (S.L.stops || []).slice(0, 4), notes = S.L.notes || [];
      const N = [260, 727, 1193, 1660].map((x, i) => {
        const ng = el('g', { transform: `translate(${x},515)` }, g);
        const ring = el('circle', { r: 78, fill: '#13263b', stroke: '#2c4a6b', 'stroke-width': 8 }, ng);
        txt(ng, 0, 20, ['💳', '🏛️', '🌐', '🏛️'][i], 56, 400, '#fff');
        const lab = txt(ng, 0, -150, stops[i] || '', 36, 800, '#fff', { max: 440 });
        const sub = txt(ng, 0, -106, notes[i] || '', 28, 400, '#8ecae6', { max: 440 });
        return { x, ng, ring, lab, sub };
      });
      const glow = el('radialGradient', { id: 'pj' + ctx.uid }, ctx.defs); el('stop', { offset: 0, 'stop-color': '#ffd166' }, glow); el('stop', { offset: 1, 'stop-color': '#ffd166', 'stop-opacity': 0 }, glow);
      const dg = el('circle', { r: 40, fill: `url(#pj${ctx.uid})` }, g), dot = el('circle', { r: 16, fill: '#fff' }, g);
      const ap = txt(g, 960, 740, S.L.approved || '', 64, 800, '#06d6a0', { max: 900 });
      const secs = +S.data.seconds || 2;
      return u => {
        const ts = u * this.base, A = .7, B = 3.2, C = 3.5, D = 5.4;
        const flen = fl.getTotalLength(), blen = bl.getTotalLength(), uf = ease(prog(ts, A, B)), ub = ease(prog(ts, C, D));
        fl.setAttribute('stroke-dasharray', `${flen} ${flen}`); fl.setAttribute('stroke-dashoffset', flen * (1 - uf));
        bl.setAttribute('stroke-dasharray', `${blen} ${blen}`); bl.setAttribute('stroke-dashoffset', blen * (1 - ub));
        const pt = ts < C ? fl.getPointAtLength(flen * uf) : bl.getPointAtLength(blen * ub), on = ts >= A - .1 && ts < D + .3;
        [dot, dg].forEach(d => { d.setAttribute('cx', pt.x); d.setAttribute('cy', pt.y); d.setAttribute('opacity', on ? 1 : 0); });
        N.forEach((n, i) => {
          const at = A + (B - A) * (i / 3) * .98, lit = ts >= at - .05, pulse = lit ? Math.max(0, 1 - (ts - at) / .5) : 0;
          const decide = i === 3 && ts >= B && ts < C + .6;
          n.ring.setAttribute('stroke', (i === 0 && ts >= D) || decide ? '#06d6a0' : lit ? '#ffd166' : '#2c4a6b');
          n.ring.setAttribute('fill', lit ? '#1d3a57' : '#13263b');
          n.ng.setAttribute('transform', `translate(${n.x},515) scale(${1 + pulse * .18})`);
          n.sub.setAttribute('opacity', lit ? 1 : .25); n.lab.setAttribute('opacity', lit ? 1 : .4);
        });
        timer.textContent = (ts < A ? 0 : ts < D ? secs * prog(ts, A, D) : secs).toFixed(1) + 's';
        ap.setAttribute('opacity', prog(ts, D, D + .3));
      };
    },
  };

  SCENES.basket = {
    label: 'Shopping basket: same money buys less', base: 11, captions: true,
    fields: [
      { k: 'items', per: 'data', kind: 'items', label: 'Items in the basket' },
      { k: 'priceStart', per: 'lang', kind: 'money', label: 'Price of each item at the start' },
      { k: 'priceEnd', per: 'lang', kind: 'money', label: 'Price of each item later' },
      { k: 'yearStart', per: 'data', kind: 'number', label: 'Start year number' },
      { k: 'yearEnd', per: 'data', kind: 'number', label: 'Later year number' },
      { k: 'yearLabel', per: 'lang', kind: 'text', label: 'Year label ({n} = the number)' },
      { k: 'totalLabel', per: 'lang', kind: 'text', label: 'Total label' },
      { k: 'note', per: 'lang', kind: 'text', label: 'Small note (top right)' },
      { k: 'lines', per: 'lang', kind: 'lines', label: 'Voiceover lines (1: basket fills, 2: prices rise, 3: item removed)' },
    ],
    defaults: { data: { items: ['bread', 'milk', 'eggs', 'apple', 'cheese'], yearStart: 1, yearEnd: 5 }, lang: { priceStart: 2, priceEnd: 2.5, yearLabel: 'YEAR {n}', totalLabel: 'Basket total', note: 'Illustrative prices', lines: ['Imagine this money buys you this basket.', 'A few years later, the same money buys less.', "That's inflation."] } },
    cues: [{ line: 0, at: 0 }, { line: 1, at: 6.0 }, { line: 2, at: 8.9 }],
    build(g, S, ctx) {
      const wall = el('linearGradient', { id: 'bw' + ctx.uid, x1: 0, y1: 0, x2: 0, y2: 1 }, ctx.defs);
      el('stop', { offset: 0, 'stop-color': '#fdf0d5' }, wall); el('stop', { offset: 1, 'stop-color': '#f6dfb4' }, wall);
      el('rect', { width: W, height: H, fill: `url(#bw${ctx.uid})` }, g);
      [220, 440].forEach(y => { el('rect', { x: 40, y: y + 120, width: 640, height: 18, fill: '#a86f4a' }, g); for (let i = 0, x = 60; x < 640; i++) { const w = 50 + ((i * 37) % 40), h = 70 + ((i * 53) % 50); el('rect', { x, y: y + 120 - h, width: w, height: h, rx: 6, fill: ['#e76f51', '#2a9d8f', '#e9c46a', '#f4a261', '#264653', '#8ecae6'][i % 6] }, g); x += w + 14; } });
      el('rect', { y: 1000, width: W, height: 80, fill: '#c9a77a' }, g);
      const P = makePerson(el('g', {}, g));
      const budgetV = (S.data.items || []).length * (+S.L.priceStart || 0);
      const note = el('g', {}, P.hold);
      el('rect', { x: -6, y: 112, width: 120, height: 56, rx: 6, fill: '#52b788', stroke: '#2d6a4f', 'stroke-width': 3 }, note);
      const nt = txt(note, 54, 149, ctx.money(budgetV, false), 26, 800, '#1b4332', { max: 108 });
      el('rect', { x: 760, y: 800, width: 1160, height: 280, fill: '#8d5a3b' }, g);
      el('rect', { x: 740, y: 780, width: 1200, height: 34, rx: 6, fill: '#a86f4a' }, g);
      const items = (S.data.items || []).slice(0, 7), n = items.length || 1, span = Math.min(110, 500 / Math.max(1, n - 1 || 1));
      const xs = items.map((_, i) => 1250 + (i - (n - 1) / 2) * (n > 1 ? span : 0));
      const ig = el('g', {}, g), IT = items.map(k => item(k, ig));
      el('path', { d: 'M960 660 L1540 660 L1500 785 L1000 785 Z', fill: '#bc6c25' }, g);
      el('line', { x1: 980, y1: 700, x2: 1520, y2: 700, stroke: '#9c5418', 'stroke-width': 6 }, g);
      el('line', { x1: 992, y1: 740, x2: 1510, y2: 740, stroke: '#9c5418', 'stroke-width': 6 }, g);
      el('rect', { x: 945, y: 648, width: 610, height: 22, rx: 11, fill: '#9c5418' }, g);
      const TG = xs.map(x => { const t = el('g', {}, g); el('rect', { x: -52, y: -30, width: 104, height: 52, rx: 12, fill: '#fff', stroke: '#264653', 'stroke-width': 4 }, t); return { g: t, v: txt(t, 0, 8, '', 26, 800, '#264653', { max: 96 }), x }; });
      const yp = el('g', {}, g); el('rect', { x: 60, y: 50, width: 270, height: 78, rx: 39, fill: '#264653' }, yp);
      const yt = txt(yp, 195, 104, '', 40, 800, '#ffd166', { max: 240 });
      txt(g, 1250, 340, S.L.totalLabel || '', 34, 700, '#6b4f3a', { max: 600 });
      const tot = txt(g, 1250, 408, '', 64, 800, '#264653');
      txt(g, 1880, 60, S.L.note || '', 24, 400, '#8a6f5a', { anchor: 'end', max: 520 });
      const p0 = +S.L.priceStart || 0, p1 = +S.L.priceEnd || 0;
      const keep = p1 > 0 ? Math.min(n, Math.floor(budgetV / p1 + 1e-9)) : n; // how many items the same money still buys
      let lastYear = null;
      return u => {
        const ts = u * this.base, rise = ease(prog(ts, 6.6, 7.4)), price = lerp(p0, p1, rise);
        let total = 0;
        IT.forEach((g2, i) => {
          const d = prog(ts, 1 + i * (3 / n), 1.6 + i * (3 / n)), y = lerp(-700, 0, bounce(d));
          const leaveIdx = n - 1 - i, leaving = i >= keep, out = leaving ? ease(prog(ts, 7.9 + (n - 1 - i) * .25, 8.8 + (n - 1 - i) * .25)) : 0;
          let x = xs[i], yy = 672 + y, op = d > 0 ? 1 : 0, rot = 0;
          if (out > 0) { yy = 672 - out * 260; x = xs[i] + out * 140; op = 1 - prog(out, .5, 1); rot = out * 25; }
          g2.setAttribute('transform', `translate(${x},${yy}) rotate(${rot})`); g2.setAttribute('opacity', op);
          const tg = TG[i], on = prog(ts, 1.4 + i * (3 / n), 1.7 + i * (3 / n)) * (leaving ? 1 - prog(ts, 7.9, 8.3) : 1);
          const pulse = ts > 6.6 && ts < 7.6 ? 1 + .12 * Math.sin(prog(ts, 6.6, 7.6) * Math.PI) : 1;
          tg.g.setAttribute('transform', `translate(${tg.x},492) scale(${pulse})`); tg.g.setAttribute('opacity', on);
          tg.v.textContent = ctx.money(price, false); tg.v.setAttribute('fill', rise > .05 ? '#d62828' : '#264653'); fit(tg.v, 96);
          if (d >= 1 && !(leaving && out >= .5)) total += price;
          void leaveIdx;
        });
        tot.textContent = ctx.money(total, true); tot.setAttribute('fill', total > budgetV + 1e-6 ? '#d62828' : '#264653');
        const yr = ts < 6 ? S.data.yearStart : S.data.yearEnd;
        if (yr !== lastYear) { yt.textContent = fill(S.L.yearLabel || '{n}', { n: yr }); fit(yt, 240); lastYear = yr; }
        const flip = ts >= 6 && ts < 6.4 ? Math.sin(prog(ts, 6, 6.4) * Math.PI) * .15 : 0;
        yp.setAttribute('transform', `translate(195,89) scale(${1 + flip}) translate(-195,-89)`);
        const mood = ts < 7 ? 1 : lerp(1, -1, ease(prog(ts, 7, 7.6)));
        P.set(470, 1040, 1.4, { armF: -58 + Math.sin(ts * 2.2) * 1.2, armB: 6, legF: 2, legB: -2, mood, tilt: ts > 8 && ts < 9.5 ? Math.sin((ts - 8) * 6) * 3 : 0 });
        void nt;
      };
    },
  };

  SCENES.moreMoney = {
    label: 'More money chasing the same goods', base: 5.3, captions: true,
    fields: [
      { k: 'heading', per: 'lang', kind: 'text', label: 'Heading' },
      { k: 'unit', per: 'lang', kind: 'text', label: 'Price card label' },
      { k: 'priceFrom', per: 'lang', kind: 'money', label: 'Price before' },
      { k: 'priceTo', per: 'lang', kind: 'money', label: 'Price after' },
      { k: 'product', per: 'data', kind: 'item', label: 'What is on the stall' },
      { k: 'lines', per: 'lang', kind: 'lines', label: 'Voiceover lines' },
    ],
    defaults: { data: { product: 'bread' }, lang: { heading: 'Cause 1: more money, same stuff', unit: 'per loaf', priceFrom: 1, priceTo: 2, lines: ['More money chasing the same bread pushes prices up.'] } },
    build(g, S, ctx) {
      const wall = el('linearGradient', { id: 'mw' + ctx.uid, x1: 0, y1: 0, x2: 0, y2: 1 }, ctx.defs);
      el('stop', { offset: 0, 'stop-color': '#e0f1f7' }, wall); el('stop', { offset: 1, 'stop-color': '#c6e4ef' }, wall);
      el('rect', { width: W, height: H, fill: `url(#mw${ctx.uid})` }, g);
      txt(g, 960, 110, S.L.heading || '', 54, 800, '#264653', { max: 1750 });
      for (let i = 0; i < 10; i++) el('path', { d: `M${560 + i * 80} 180 h80 v70 q-40 34 -80 0 z`, fill: i % 2 ? '#fff' : '#e76f51' }, g);
      el('rect', { x: 550, y: 160, width: 820, height: 26, rx: 8, fill: '#c0563b' }, g);
      el('rect', { x: 560, y: 560, width: 800, height: 110, rx: 10, fill: '#8d5a3b' }, g);
      el('rect', { x: 540, y: 545, width: 840, height: 28, rx: 8, fill: '#a86f4a' }, g);
      [760, 960, 1160].forEach(x => { const it = item(S.data.product || 'bread', g); it.setAttribute('transform', `translate(${x},548) scale(1.5)`); });
      const pc = priceCard(g, 1500, 330, S.L.unit || '', '#264653');
      const cols = [{ shirt: '#e76f51', shirtB: '#c0563b' }, { shirt: '#2a9d8f', shirtB: '#21867a', skin: '#8d5524' }, { shirt: '#7b2cbf', shirtB: '#5a189a', skin: '#e0ac69', hair: '#6f4518' }];
      const B = [640, 960, 1280].map((x, i) => ({ x, P: makePerson(el('g', {}, g), cols[i]) }));
      const cg = el('g', {}, g), sym = ctx.L.currency || '';
      return u => {
        const ts = u * this.base, extra = prog(ts, 1.6, 2.8), pr = ease(prog(ts, 3.0, 4.6));
        pc.v.textContent = ctx.money(lerp(+S.L.priceFrom || 0, +S.L.priceTo || 0, pr), true); pc.v.setAttribute('fill', pr > .05 ? '#d62828' : '#264653'); fit(pc.v, 290);
        cg.innerHTML = '';
        B.forEach((b, bi) => {
          const n = 2 + Math.floor(extra * 3), wave = Math.max(0, Math.sin(prog(ts, 3.0, 4.6) * Math.PI * 3 + bi)) * 8;
          b.P.set(b.x, 1040, .95, { armF: -30 - wave, armB: 8, mood: pr > .4 ? -.3 : 1 });
          for (let k = 0; k < n; k++) { const pop = k >= 2 ? prog(ts, 1.6 + (k - 2) * .35 + bi * .08, 1.9 + (k - 2) * .35 + bi * .08) : 1; if (pop > 0) coin(cg, b.x + 110, 860 - k * 22, .6 + .4 * bounce(pop)); }
          if (n > 2) { const tg = el('g', { transform: `translate(${b.x + 110},${860 - n * 22 - 30})`, opacity: prog(ts, 1.8, 2.2) * (1 - prog(ts, 4.8, 5.2)) }, cg); txt(tg, 0, 0, '+' + sym, 30, 800, '#2a9d8f'); }
        });
      };
    },
  };

  SCENES.costPush = {
    label: 'Making it costs more (rising costs)', base: 4.6, captions: true,
    fields: [
      { k: 'heading', per: 'lang', kind: 'text', label: 'Heading' },
      { k: 'meter', per: 'lang', kind: 'text', label: 'Cost bar label' },
      { k: 'unit', per: 'lang', kind: 'text', label: 'Price card label' },
      { k: 'priceFrom', per: 'lang', kind: 'money', label: 'Price before' },
      { k: 'priceTo', per: 'lang', kind: 'money', label: 'Price after' },
      { k: 'product', per: 'data', kind: 'item', label: 'Product' },
      { k: 'lines', per: 'lang', kind: 'lines', label: 'Voiceover lines' },
    ],
    defaults: { data: { product: 'bread' }, lang: { heading: 'Cause 2: making it costs more', meter: '⚡ Energy & ingredients cost', unit: 'per loaf', priceFrom: 2, priceTo: 2.4, lines: ['And when making things costs more, prices rise too.'] } },
    build(g, S, ctx) {
      const wall = el('linearGradient', { id: 'cw' + ctx.uid, x1: 0, y1: 0, x2: 0, y2: 1 }, ctx.defs);
      el('stop', { offset: 0, 'stop-color': '#f3e5f5' }, wall); el('stop', { offset: 1, 'stop-color': '#e3cfe8' }, wall);
      el('rect', { width: W, height: H, fill: `url(#cw${ctx.uid})` }, g);
      txt(g, 960, 110, S.L.heading || '', 54, 800, '#4a2c5a', { max: 1750 });
      const ov = el('g', { transform: 'translate(330,330)' }, g);
      el('rect', { width: 460, height: 520, rx: 30, fill: '#6c757d' }, ov);
      el('rect', { x: 40, y: 60, width: 380, height: 250, rx: 18, fill: '#2b2d42' }, ov);
      const og = el('radialGradient', { id: 'og' + ctx.uid }, ctx.defs); el('stop', { offset: 0, 'stop-color': '#ffb703' }, og); el('stop', { offset: 1, 'stop-color': '#ffb703', 'stop-opacity': 0 }, og);
      const glow = el('circle', { cx: 230, cy: 185, r: 170, fill: `url(#og${ctx.uid})` }, ov);
      const fl = el('g', {}, ov);
      el('rect', { x: 40, y: 340, width: 380, height: 20, rx: 10, fill: '#495057' }, ov);
      [110, 230, 350].forEach(x => el('circle', { cx: x, cy: 430, r: 26, fill: '#adb5bd' }, ov));
      el('rect', { y: 520, width: 460, height: 40, fill: '#495057' }, ov);
      txt(g, 1000, 300, S.L.meter || '', 38, 800, '#4a2c5a', { anchor: 'start', max: 760 });
      el('rect', { x: 1000, y: 330, width: 700, height: 70, rx: 35, fill: '#fff', stroke: '#4a2c5a', 'stroke-width': 5 }, g);
      const meter = el('rect', { x: 1008, y: 338, width: 200, height: 54, rx: 27, fill: '#2a9d8f' }, g);
      const lf = item(S.data.product || 'bread', g); lf.setAttribute('transform', 'translate(1210,720) scale(2)');
      const pc = priceCard(g, 1500, 650, S.L.unit || '', '#4a2c5a');
      el('rect', { y: 890, width: W, height: 190, fill: '#cdb4db' }, g);
      return u => {
        const ts = u * this.base, up = ease(prog(ts, 1.0, 2.7)), pr = ease(prog(ts, 2.1, 3.5));
        meter.setAttribute('width', lerp(180, 620, up)); meter.setAttribute('fill', up > .5 ? '#e63946' : up > .2 ? '#f4a261' : '#2a9d8f');
        pc.v.textContent = ctx.money(lerp(+S.L.priceFrom || 0, +S.L.priceTo || 0, pr), true); pc.v.setAttribute('fill', pr > .05 ? '#d62828' : '#4a2c5a'); fit(pc.v, 290);
        glow.setAttribute('opacity', .45 + .35 * up + .08 * Math.sin(ts * 9));
        fl.innerHTML = '';
        for (let i = 0; i < 5; i++) { const x = 130 + i * 50, h = (30 + up * 40) * (.8 + .3 * Math.sin(ts * 10 + i * 1.7)); el('path', { d: `M${x - 14} 300 Q${x} ${300 - h * 2} ${x + 14} 300 Z`, fill: i % 2 ? '#ffb703' : '#fb8500' }, fl); }
      };
    },
  };

  SCENES.endCard = {
    label: 'End card (topic, key message, channel)', base: 3, captions: false,
    fields: [
      { k: 'kicker', per: 'lang', kind: 'text', label: 'Small word on top' },
      { k: 'main', per: 'lang', kind: 'text', label: 'Main message' },
      { k: 'small', per: 'lang', kind: 'text', label: 'Small print at the bottom' },
      { k: 'lines', per: 'lang', kind: 'lines', label: 'What you say' },
    ],
    defaults: { data: {}, lang: { kicker: 'TOPIC', main: 'The one thing to remember.', small: 'Simplified illustration.', lines: ['The one thing to remember.'] } },
    build(g, S, ctx) {
      el('rect', { width: W, height: H, fill: '#0d1b2a' }, g);
      const k = txt(g, 960, 430, S.L.kicker || '', 40, 700, '#ffd166', { max: 1700, attrs: { 'letter-spacing': 6 } });
      const m = txt(g, 960, 540, S.L.main || '', 88, 800, '#fff', { max: 1760 });
      const brand = el('g', {}, g);
      bulb(brand, 960, 668, 1.05, true);
      txt(brand, 960, 770, ctx.channelName, 44, 800, '#fff', { max: 1400 });
      txt(brand, 960, 825, ctx.tagline, 32, 400, '#8ecae6', { max: 1600 });
      txt(g, 960, 1010, S.L.small || '', 26, 400, '#6c7f93', { max: 1700 });
      return u => { const ts = u * this.base; m.setAttribute('opacity', ease(prog(ts, 0, .5))); k.setAttribute('opacity', ease(prog(ts, 0, .4))); brand.setAttribute('opacity', ease(prog(ts, .5, 1.1))); };
    },
  };

  // ---------------------------------------------------------------- step cards (icons + short words, appearing one by one)
  function cardIcon(parent, name) { // simple flat pictures, no brand logos; drawn inside about -70..70
    const g = el('g', {}, parent), gold = '#ffd166', ink = '#0d1b2a', blue = '#8ecae6';
    switch (name) {
      case 'card': el('rect', { x: -66, y: -42, width: 132, height: 84, rx: 12, fill: gold }, g); el('rect', { x: -66, y: -22, width: 132, height: 16, fill: ink, opacity: .75 }, g); el('rect', { x: -50, y: 12, width: 34, height: 12, rx: 4, fill: ink, opacity: .6 }, g); break;
      case 'phone': el('rect', { x: -38, y: -66, width: 76, height: 132, rx: 14, fill: '#1b3a5c', stroke: gold, 'stroke-width': 6 }, g); el('rect', { x: -24, y: -30, width: 48, height: 32, rx: 6, fill: gold }, g); el('rect', { x: -24, y: 10, width: 48, height: 10, rx: 5, fill: blue }, g); el('circle', { cx: 0, cy: 48, r: 5, fill: gold }, g); break;
      case 'fingerprint': [60, 46, 32, 18].forEach((r, i) => el('path', { d: `M${-r} ${14 - i * 3} a${r} ${r} 0 0 1 ${2 * r} 0`, fill: 'none', stroke: i % 2 ? blue : gold, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-dasharray': i === 1 ? '70 14' : i === 2 ? '50 12' : '' }, g)); el('path', { d: 'M0 14 v40', stroke: gold, 'stroke-width': 7, 'stroke-linecap': 'round' }, g); el('path', { d: 'M-18 24 v30 M18 24 v26', stroke: blue, 'stroke-width': 7, 'stroke-linecap': 'round' }, g); break;
      case 'list': el('rect', { x: -48, y: -64, width: 96, height: 128, rx: 12, fill: '#fff' }, g); el('rect', { x: -22, y: -72, width: 44, height: 18, rx: 6, fill: gold }, g); [-30, 0, 30].forEach(y => { el('path', { d: `M-34 ${y} l7 8 l13 -16`, stroke: '#2a9d8f', 'stroke-width': 6, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g); el('rect', { x: -8, y: y - 5, width: 36, height: 9, rx: 4, fill: '#9fb3c8' }, g); }); break;
      case 'shop': el('rect', { x: -56, y: -6, width: 112, height: 66, fill: '#e9f5fb' }, g); el('rect', { x: -14, y: 18, width: 28, height: 42, fill: '#1b3a5c' }, g); for (let i = 0; i < 6; i++) el('path', { d: `M${-60 + i * 20} -54 h20 l-4 46 h-20 z`, fill: i % 2 ? '#fff' : '#e76f51' }, g); el('path', { d: 'M-60 -54 h120 l8 -8 h-136 z', fill: '#bf4b30' }, g); break;
      case 'basket': el('path', { d: 'M-62 -14 h124 l-16 66 h-92 z', fill: '#bc6c25' }, g); el('path', { d: 'M-34 -14 q34 -64 68 0', fill: 'none', stroke: '#9c5418', 'stroke-width': 8 }, g); el('line', { x1: -40, y1: 10, x2: 40, y2: 10, stroke: '#9c5418', 'stroke-width': 5 }, g); el('line', { x1: -36, y1: 32, x2: 36, y2: 32, stroke: '#9c5418', 'stroke-width': 5 }, g); break;
      case 'lock': el('path', { d: 'M-28 -10 v-22 a28 28 0 0 1 56 0 v22', fill: 'none', stroke: '#c9d3df', 'stroke-width': 12 }, g); el('rect', { x: -48, y: -12, width: 96, height: 74, rx: 12, fill: gold }, g); el('circle', { cx: 0, cy: 22, r: 9, fill: ink }, g); el('rect', { x: -4, y: 24, width: 8, height: 22, rx: 4, fill: ink }, g); break;
      case 'tick': el('circle', { r: 58, fill: '#2a9d8f' }, g); el('path', { d: 'M-28 2 l20 22 l38 -44', stroke: '#fff', 'stroke-width': 14, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g); break;
      case 'stop': el('path', { d: 'M-24 -64 h48 l40 40 v48 l-40 40 h-48 l-40 -40 v-48 z', fill: '#d62828' }, g); el('rect', { x: -36, y: -9, width: 72, height: 18, rx: 6, fill: '#fff' }, g); break;
      case 'bank': el('path', { d: 'M-66 -20 L0 -64 L66 -20 z', fill: gold }, g); [-44, -15, 15, 44].forEach(x => el('rect', { x: x - 8, y: -14, width: 16, height: 56, fill: '#e9f5fb' }, g)); el('rect', { x: -66, y: 46, width: 132, height: 14, rx: 4, fill: '#9fb3c8' }, g); break;
      case 'question': el('circle', { r: 58, fill: gold }, g); txt(g, 0, 32, '?', 100, 800, ink); break;
      case 'pound': el('circle', { r: 58, fill: gold }, g); txt(g, 0, 28, '£', 84, 800, ink); break;
      case 'agent': el('line', { x1: 0, y1: -64, x2: 0, y2: -44, stroke: gold, 'stroke-width': 6 }, g); el('circle', { cx: 0, cy: -68, r: 8, fill: gold }, g); el('rect', { x: -54, y: -44, width: 108, height: 92, rx: 24, fill: '#c9d3df' }, g); [-22, 22].forEach(x => el('circle', { cx: x, cy: -8, r: 12, fill: ink }, g)); el('path', { d: 'M-22 22 q22 16 44 0', stroke: ink, 'stroke-width': 6, fill: 'none', 'stroke-linecap': 'round' }, g); break;
      case 'network': [[-46, 30], [46, 30], [0, -44]].forEach(([x, y], i, a) => { const q = a[(i + 1) % 3]; el('line', { x1: x, y1: y, x2: q[0], y2: q[1], stroke: blue, 'stroke-width': 6 }, g); }); [[-46, 30], [46, 30], [0, -44]].forEach(([x, y]) => el('circle', { cx: x, cy: y, r: 18, fill: gold }, g)); break;
      case 'shield': el('path', { d: 'M0 -64 L52 -42 v36 q0 46 -52 70 q-52 -24 -52 -70 v-36 z', fill: '#2a9d8f' }, g); el('path', { d: 'M-22 -2 l16 18 l30 -34', stroke: '#fff', 'stroke-width': 11, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g); break;
      case 'id': el('rect', { x: -64, y: -44, width: 128, height: 88, rx: 12, fill: '#e9f5fb' }, g); el('circle', { cx: -30, cy: -8, r: 14, fill: '#6b7f8e' }, g); el('path', { d: 'M-52 34 q22 -34 44 0 z', fill: '#6b7f8e' }, g); [-14, 8, 30].forEach(y => el('rect', { x: 0, y: y - 12, width: 52, height: 9, rx: 4, fill: '#9fb3c8' }, g)); break;
      case 'alert': el('rect', { x: -38, y: -66, width: 76, height: 132, rx: 14, fill: '#1b3a5c', stroke: gold, 'stroke-width': 6 }, g); el('circle', { cx: 0, cy: -4, r: 24, fill: '#d62828' }, g); el('rect', { x: -4, y: -18, width: 8, height: 20, rx: 3, fill: '#fff' }, g); el('circle', { cx: 0, cy: 10, r: 4.5, fill: '#fff' }, g); break;
      case 'scales': el('rect', { x: -4, y: -56, width: 8, height: 104, fill: '#c9d3df' }, g); el('rect', { x: -40, y: 44, width: 80, height: 12, rx: 5, fill: '#c9d3df' }, g); el('rect', { x: -62, y: -50, width: 124, height: 8, rx: 4, fill: gold }, g); [-52, 52].forEach(x => { el('path', { d: `M${x} -42 l-24 52 h48 z`, fill: 'none', stroke: gold, 'stroke-width': 4 }, g); el('path', { d: `M${x - 30} 10 h60 a30 22 0 0 1 -60 0 z`, fill: blue }, g); }); break;
      case 'bulb': bulb(g, 0, 10, 1.7, false); break;
      case 'detergent': el('rect', { x: -14, y: -66, width: 28, height: 22, rx: 5, fill: gold }, g); el('rect', { x: -38, y: -48, width: 76, height: 112, rx: 20, fill: '#4cc9f0' }, g); el('rect', { x: -38, y: -4, width: 76, height: 44, fill: '#fff' }, g); el('path', { d: 'M-38 18 q19 -16 38 0 t38 0', fill: 'none', stroke: '#4cc9f0', 'stroke-width': 6 }, g); break;
      case 'soap': el('g', { transform: 'rotate(-14)' }, g).appendChild(el('rect', { x: -58, y: -28, width: 116, height: 62, rx: 26, fill: '#f7a8d8' })); [[40, -46, 16], [58, -20, 10], [24, -66, 9]].forEach(([x, y, r]) => el('circle', { cx: x, cy: y, r, fill: 'none', stroke: blue, 'stroke-width': 5 }, g)); el('rect', { x: -34, y: -6, width: 62, height: 10, rx: 5, fill: '#fff', opacity: .6, transform: 'rotate(-14)' }, g); break;
      case 'milk': item('milk', g).setAttribute('transform', 'translate(0,64) scale(.62)'); break;
      case 'cheese': item('cheese', g).setAttribute('transform', 'translate(0,46) scale(1)'); break;
      default: el('circle', { r: 46, fill: gold }, g);
    }
    return g;
  }
  function wrapWords(s, size, maxW) { // rough line breaking for SVG text; "/" in the words forces a new line
    const per = size * 0.54, maxC = Math.max(6, Math.floor(maxW / per)), out = [];
    String(s || '').split('/').forEach(part => { let line = ''; part.trim().split(/\s+/).filter(Boolean).forEach(w => { if ((line + ' ' + w).trim().length > maxC && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); }); if (line) out.push(line); });
    return out;
  }
  SCENES.cards = {
    label: 'Step cards (pictures with short words, shown one by one)', base: 10, captions: true,
    fields: [
      { k: 'heading', per: 'lang', kind: 'text', label: 'Heading on top (for example Step 1: Set up once)' },
      { k: 'items', per: 'lang', kind: 'lines', label: 'Cards, one per line, as: picture | title | small words (use / for a new line). Pictures: ' + CARD_ICONS.join(', ') + '. Add ! after the picture to highlight a card. Optional 4th part: the number of the spoken line the card appears with, for example: phone | Add your card | Like a wallet | 2. Without it the cards share the last lines in order.' },
      { k: 'arrows', per: 'data', kind: 'select', options: [['yes', 'Arrows between the cards'], ['no', 'No arrows']], label: 'Arrows' },
      { k: 'note', per: 'lang', kind: 'text', label: 'Small note at the bottom (for example Example prices)' },
      { k: 'lines', per: 'lang', kind: 'lines', label: 'What you say (one line per caption)' },
    ],
    defaults: { data: { arrows: 'yes' }, lang: { heading: 'Step 1', items: ['card | First card | A few small words', 'tick | Second card | A few small words'], note: '', lines: ['Say what these cards show.'] } },
    build(g, S, ctx) {
      const grd = el('linearGradient', { id: 'cg' + ctx.uid, x1: 0, y1: 0, x2: 1, y2: 1 }, ctx.defs);
      el('stop', { offset: 0, 'stop-color': '#0d1b2a' }, grd); el('stop', { offset: 1, 'stop-color': '#10294a' }, grd);
      el('rect', { width: W, height: H, fill: `url(#cg${ctx.uid})` }, g);
      const dots = el('g', { opacity: .14 }, g); for (let i = 0; i < 24; i++) el('circle', { cx: (i * 337) % W, cy: (i * 211) % H, r: 3 + (i % 4) * 2, fill: '#ffd166' }, dots);
      const gold = el('linearGradient', { id: 'cgd' + ctx.uid, x1: 0, y1: 0, x2: 0, y2: 1 }, ctx.defs);
      el('stop', { offset: 0, 'stop-color': '#fff3c4' }, gold); el('stop', { offset: 1, 'stop-color': '#e8c15a' }, gold);
      const head = txt(g, 960, 170, S.L.heading || '', 84, 800, `url(#cgd${ctx.uid})`, { max: 1700, attrs: { stroke: '#0b1522', 'stroke-width': 3, 'paint-order': 'stroke' } });
      const items = (S.L.items || []).map(x => String(x).split('|').map(p => p.trim())).filter(a => a[0]).slice(0, 4), n = Math.max(1, items.length), gap = 70;
      const cw = Math.min(520, (1740 - gap * (n - 1)) / n), x0 = 960 - (cw * n + gap * (n - 1)) / 2, top = 250, ch = 625;
      const cards = items.map(([ic, title, detail], i) => {
        const hi = /!$/.test(ic), icon = ic.replace(/!$/, '').toLowerCase(), cx = x0 + i * (cw + gap);
        const root = el('g', {}, g), box = el('g', {}, root);
        el('rect', { x: cx, y: top, width: cw, height: ch, rx: 34, fill: hi ? '#1c3b2e' : '#13263b', stroke: hi ? '#52b788' : '#ffd166', 'stroke-width': hi ? 9 : 5 }, box);
        const pic = el('g', { transform: `translate(${cx + cw / 2},${top + 170}) scale(1.35)` }, box); cardIcon(pic, icon);
        txt(box, cx + cw / 2, top + 366, title || '', 50, 800, '#fff', { max: cw - 50 });
        const size = n > 3 ? 32 : 36; wrapWords(detail || '', size, cw - 60).slice(0, 5).forEach((ln, j) => txt(box, cx + cw / 2, top + 424 + j * (size + 9), ln, size, 500, '#cfe3ff', { max: cw - 40 }));
        if (hi) { const tk = el('g', { transform: `translate(${cx + cw - 46},${top + 46}) scale(.5)` }, box); cardIcon(tk, 'tick'); }
        return { root, cx };
      });
      const arrows = S.data.arrows !== 'no' ? cards.slice(1).map(c => { const a = el('g', {}, g); el('path', { d: `M${c.cx - gap + 18} ${top + ch / 2 - 24} l${gap - 36} 24 l-${gap - 36} 24`, fill: 'none', stroke: '#ffd166', 'stroke-width': 10, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, a); return a; }) : [];
      txt(g, 960, 912, S.L.note || '', 30, 500, '#8fa6bd', { max: 1700, attrs: { 'font-style': 'italic' } });
      const br = el('g', {}, g); // the channel logo at the top of every middle scene
      el('rect', { x: 40, y: 24, width: 440, height: 80, rx: 40, fill: '#0b1522', opacity: .88, stroke: '#ffd166', 'stroke-width': 2 }, br);
      bulb(br, 92, 68, .85, false); txt(br, 138, 81, ctx.channelName, 40, 800, '#fff6dc', { anchor: 'start', max: 320 });
      // each card comes in when the line it belongs to starts being spoken
      const LT = lineTimesOf(S, ctx), PHZ = LT.n > 0, idxOf = items.map((a, i) => { const e = parseInt(a[3], 10); return e >= 1 && e <= LT.n ? e - 1 : (LT.n > n ? LT.n - n + i : Math.min(LT.n - 1, Math.floor(i * LT.n / n))); });
      const at = idxOf.map((li, i) => { const grp = idxOf.map((x, j) => x === li ? j : -1).filter(j => j >= 0), k = grp.indexOf(i), m = grp.length; return PHZ ? LT.st[li] + .15 + k * ((LT.en[li] - LT.st[li]) * .7 / m) : 0; });
      return u => {
        const ts = u * this.base, tt = u * ctx.dur; head.setAttribute('opacity', ease(prog(PHZ ? tt : ts, 0, .5)));
        cards.forEach((c, i) => {
          const a = PHZ ? at[i] : .7 + i * (5.2 / n), ts = PHZ ? tt : u * this.base, d = prog(ts, a, a + .55), k = lerp(.8, 1, bounce(d)), cxm = c.cx + cw / 2, cym = top + ch / 2;
          c.root.setAttribute('opacity', ease(prog(ts, a, a + .3)));
          c.root.setAttribute('transform', `translate(${cxm},${cym}) scale(${k}) translate(${-cxm},${-cym})`);
          if (arrows[i - 1]) arrows[i - 1].setAttribute('opacity', ease(prog(ts, a - .1, a + .3)));
        });
      };
    },
  };

  // ---------------------------------------------------------------- animated like / share / subscribe end scene
  SCENES.outro = {
    label: 'Like, share, subscribe (animated end scene)', base: 10, captions: true,
    fields: [
      { k: 'head1', per: 'lang', kind: 'text', label: 'Heading while the first line is spoken (robot shopping)' },
      { k: 'head2', per: 'lang', kind: 'text', label: 'Heading while the second line is spoken (comments)' },
      { k: 'heading', per: 'lang', kind: 'text', label: 'Heading for the like, share and subscribe part' },
      { k: 'likeLabel', per: 'lang', kind: 'text', label: 'Word under the like button' },
      { k: 'shareLabel', per: 'lang', kind: 'text', label: 'Word under the share button' },
      { k: 'subLabel', per: 'lang', kind: 'text', label: 'Subscribe button word' },
      { k: 'subbedLabel', per: 'lang', kind: 'text', label: 'Word after it is tapped' },
      { k: 'small', per: 'lang', kind: 'text', label: 'Small print at the bottom' },
      { k: 'lines', per: 'lang', kind: 'lines', label: 'What you say' },
    ],
    defaults: { data: {}, lang: { heading: 'Want complex things in simple language?', likeLabel: 'Like', shareLabel: 'Share', subLabel: 'Subscribe', subbedLabel: 'Subscribed', small: '', lines: ['Please like, share and subscribe.'] } },
    build(g, S, ctx) {
      const grd = el('linearGradient', { id: 'og' + ctx.uid, x1: 0, y1: 0, x2: 1, y2: 1 }, ctx.defs);
      el('stop', { offset: 0, 'stop-color': '#0d1b2a' }, grd); el('stop', { offset: 1, 'stop-color': '#10294a' }, grd);
      el('rect', { width: W, height: H, fill: `url(#og${ctx.uid})` }, g);
      const dots = el('g', { opacity: .14 }, g); for (let i = 0; i < 26; i++) el('circle', { cx: (i * 337) % W, cy: (i * 211) % H, r: 3 + (i % 4) * 2, fill: '#ffd166' }, dots);
      const brand = el('g', {}, g);
      const lg = bulb(brand, 760, 150, 1.5, true);
      txt(brand, 840, 178, ctx.channelName, 96, 800, '#fff6dc', { anchor: 'start', max: 960 });
      const head = txt(g, 960, 330, S.L.heading || '', 62, 700, '#cfe3ff', { max: 1700 });
      const gold = '#ffd166', ink = '#0d1b2a', cy = 600;
      // like
      const like = el('g', {}, g), likeIn = el('g', {}, like);
      el('circle', { r: 112, fill: '#13263b', stroke: gold, 'stroke-width': 7 }, likeIn);
      const thumb = el('g', { transform: 'scale(1.55)' }, likeIn);
      el('rect', { x: -60, y: -8, width: 28, height: 62, rx: 7, fill: gold }, thumb);
      el('path', { d: 'M-24 54 V-4 L6 -52 Q20 -62 28 -46 L20 -12 H54 Q66 -10 62 4 L52 44 Q48 56 36 56 H-24 Z', fill: gold }, thumb);
      txt(like, 0, 186, S.L.likeLabel || '', 46, 800, '#fff', { max: 260 });
      const burst = el('g', {}, like), rays = []; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; rays.push(el('line', { x1: 0, y1: 0, x2: 0, y2: 0, stroke: gold, 'stroke-width': 8, 'stroke-linecap': 'round', 'data-a': a }, burst)); }
      const plus = txt(like, 80, -90, '+1', 52, 800, '#52b788');
      // share
      const share = el('g', {}, g), shareIn = el('g', {}, share);
      el('circle', { r: 112, fill: '#13263b', stroke: gold, 'stroke-width': 7 }, shareIn);
      const nodes = [[-46, 0], [40, -50], [40, 50]];
      nodes.slice(1).forEach(([x, y]) => el('line', { x1: nodes[0][0], y1: nodes[0][1], x2: x, y2: y, stroke: '#8ecae6', 'stroke-width': 8 }, shareIn));
      nodes.forEach(([x, y]) => el('circle', { cx: x, cy: y, r: 20, fill: gold }, shareIn));
      const travel = nodes.slice(1).map(() => el('circle', { r: 9, fill: '#fff' }, shareIn));
      txt(share, 0, 186, S.L.shareLabel || '', 46, 800, '#fff', { max: 260 });
      // subscribe button and bell
      const sub = el('g', {}, g), subBtn = el('rect', { x: -220, y: -64, width: 440, height: 128, rx: 64, fill: '#e62117' }, sub);
      const subTxt = txt(sub, 0, 22, S.L.subLabel || '', 62, 800, '#fff', { max: 380 });
      const bell = el('g', {}, g);
      el('circle', { r: 112, fill: '#13263b', stroke: gold, 'stroke-width': 7 }, bell);
      const bellIn = el('g', {}, bell);
      const bb = el('g', { transform: 'translate(0,6) scale(1.5)' }, bellIn);
      el('path', { d: 'M0 -50 q-34 0 -34 40 v22 l-12 16 h92 l-12 -16 v-22 q0 -40 -34 -40 z', fill: gold, transform: 'translate(-0,0)' }, bb);
      el('circle', { cx: 0, cy: 36, r: 9, fill: gold, transform: 'translate(0,12)' }, bb);
      const arcs = [0, 1].map(i => [el('path', { d: `M${-50 - i * 14} -22 q-${8 + i * 6} 22 0 44`, fill: 'none', stroke: '#fff', 'stroke-width': 6, 'stroke-linecap': 'round' }, bell), el('path', { d: `M${50 + i * 14} -22 q${8 + i * 6} 22 0 44`, fill: 'none', stroke: '#fff', 'stroke-width': 6, 'stroke-linecap': 'round' }, bell)]);
      const cur = el('g', {}, g); el('path', { d: 'M0 0 L0 44 L12 34 L21 54 L31 49 L22 30 L38 30 Z', fill: '#fff', stroke: '#05101c', 'stroke-width': 3, 'stroke-linejoin': 'round' }, cur);
      const spark = el('g', {}, g), sp = []; for (let i = 0; i < 6; i++) sp.push(el('path', { d: 'M0 -16 l4 12 l12 4 l-12 4 l-4 12 l-4 -12 l-12 -4 l12 -4z', fill: '#fff6dc' }, spark));
      txt(g, 960, 880, S.L.small || '', 28, 500, '#8fa6bd', { max: 1700 });
      // three spoken lines -> three scenes of animation: a robot shopping, comments, then like / share / subscribe
      const lt = (() => { let lines = (S.L.lines || []).filter(x => String(x).trim()); if (lines.length < 3) { const se = lines.join(' ').match(/[^.!?]+[.!?]+/g); if (se && se.length >= 3) lines = se.map(x => x.trim()); } const tk = S.L.take, spanT = tk ? tk.out - tk.in : ctx.dur, offT = tk ? LEAD - .15 : 0; const st = relStarts(lines, tk, spanT).map(x => offT + x); return { n: lines.length, st, en: st.map((x, j) => j + 1 < st.length ? st[j + 1] : offT + spanT + .35) }; })();
      const PH = lt.n >= 3, ic = (par, name, k) => { const q = el('g', {}, par); cardIcon(el('g', { transform: `scale(${k})` }, q), name); return q; };
      const rob = el('g', { opacity: 0 }, g), cmt = el('g', { opacity: 0 }, g);
      el('rect', { x: 150, y: 770, width: 1620, height: 12, rx: 6, fill: '#3a4a60' }, rob);
      { const sx = 1280; el('rect', { x: sx, y: 480, width: 300, height: 290, fill: '#e9edf2' }, rob); el('rect', { x: sx, y: 462, width: 300, height: 30, fill: '#c9d2dc' }, rob);
        for (let i = 0; i < 6; i++) el('path', { d: `M${sx + i * 50} 492 h50 v36 q-25 20 -50 0 z`, fill: i % 2 ? '#fff' : '#2a9d8f' }, rob);
        el('rect', { x: sx + 20, y: 405, width: 260, height: 50, rx: 10, fill: '#264653' }, rob); txt(rob, sx + 150, 441, 'SHOP', 34, 800, '#ffd166', { max: 220 });
        el('rect', { x: sx + 30, y: 560, width: 150, height: 120, rx: 8, fill: '#bde0fe', stroke: '#264653', 'stroke-width': 6 }, rob); el('rect', { x: sx + 210, y: 600, width: 70, height: 170, fill: '#264653' }, rob); }
      const rbt = el('g', {}, rob); el('circle', { r: 80, fill: '#0b1522', stroke: '#ffd166', 'stroke-width': 6 }, rbt); ic(rbt, 'agent', .95);
      const bkt = el('g', {}, rob); el('circle', { r: 58, fill: '#0b1522', stroke: '#ffd166', 'stroke-width': 5 }, bkt); ic(bkt, 'basket', .75);
      const paidTag = el('g', {}, rob); el('rect', { x: -150, y: -34, width: 300, height: 68, rx: 34, fill: '#2a9d8f', stroke: '#05101c', 'stroke-width': 3 }, paidTag); txt(paidTag, 0, 12, 'Paid ✓', 38, 800, '#fff', { max: 260 });
      el('rect', { x: 360, y: 650, width: 1200, height: 110, rx: 55, fill: '#f1f5fb' }, cmt);
      el('circle', { cx: 432, cy: 705, r: 36, fill: '#ffd166' }, cmt); el('circle', { cx: 432, cy: 695, r: 12, fill: '#0d1b2a' }, cmt); el('path', { d: 'M410 726 q22 -22 44 0', fill: '#0d1b2a' }, cmt);
      const ph = txt(cmt, 496, 718, 'Add a comment…', 38, 600, '#7d8aa0', { anchor: 'start', max: 600 });
      const typed = [0, 1, 2].map(i => el('rect', { x: 496 + i * 250, y: 695, width: 0, height: 20, rx: 10, fill: '#52617a' }, cmt)), caret = el('rect', { x: 496, y: 684, width: 4, height: 42, fill: '#0d1b2a' }, cmt);
      const bub = [[540, 480], [1100, 520], [820, 405]].map(([bx, by], i) => { const q = el('g', {}, cmt); el('rect', { x: 0, y: 0, width: 520, height: 120, rx: 30, fill: '#13263b', stroke: '#ffd166', 'stroke-width': 5 }, q); el('circle', { cx: 62, cy: 60, r: 34, fill: ['#2a9d8f', '#f4a261', '#8ecae6'][i] }, q); el('rect', { x: 120, y: 34, width: 300, height: 18, rx: 9, fill: '#8fa6bd' }, q); el('rect', { x: 120, y: 66, width: 220 - i * 30, height: 18, rx: 9, fill: '#5d7188' }, q); return { q, bx, by }; });
      const dn = el('g', {}, cmt); el('path', { d: 'M-34 -30 h68 v34 h34 l-68 66 l-68 -66 h34 z', fill: '#ffd166', stroke: '#05101c', 'stroke-width': 4, 'stroke-linejoin': 'round' }, dn);
      const LX = 330, SX = 640, BX = 1190, BLX = 1560;
      return u => {
        const tt = u * ctx.dur, p3 = PH ? lt.st[2] + (lt.en[2] - lt.st[2]) * .36 : 0;
        const ts = PH ? (tt < p3 ? 3.0 : 3.9 + clamp((tt - p3) / Math.max(1.5, lt.en[2] + .3 - p3)) * 5.9) : u * this.base, ez = ease, b = bounce;
        if (PH) { // robot shopping while line 1 is spoken, comments for line 2
          const ph1 = tt < lt.st[1], ph2 = tt >= lt.st[1] && tt < lt.st[2], hs = ph1 ? 0 : ph2 ? 1 : 2, h0 = lt.st[hs], want = hs === 0 ? (S.L.head1 || '') : hs === 1 ? (S.L.head2 || '') : (S.L.heading || '');
          if (head.textContent !== want) { head.textContent = want; fit(head, 1700); }
          head.setAttribute('opacity', ez(prog(tt, h0 - .05, h0 + .45))); brand.setAttribute('opacity', 1);
          const a1 = prog(tt, lt.st[0], lt.st[0] + .5) * (1 - prog(tt, lt.st[1] - .3, lt.st[1] + .1)); rob.setAttribute('opacity', a1);
          const w1 = clamp((tt - lt.st[0]) / Math.max(1.5, lt.en[0] - lt.st[0] - .2)), go = clamp(w1 / .55), back = clamp((w1 - .62) / .38), rx = w1 < .55 ? lerp(240, 1190, ez(go)) : lerp(1190, 700, ez(back));
          rbt.setAttribute('transform', `translate(${rx},${690 - Math.abs(Math.sin(tt * 7)) * (w1 < .55 || w1 > .62 ? 14 : 0)})`);
          const bp = prog(tt, lt.st[0] + (lt.en[0] - lt.st[0]) * .55, lt.st[0] + (lt.en[0] - lt.st[0]) * .55 + .4); bkt.setAttribute('opacity', Math.min(1, bp * 3)); bkt.setAttribute('transform', `translate(${w1 < .62 ? 1430 : rx + 120},${w1 < .62 ? 570 - (1 - bounce(bp)) * 40 : 640}) scale(${lerp(.3, 1, bounce(bp))})`);
          const pp = prog(tt, lt.st[0] + (lt.en[0] - lt.st[0]) * .78, lt.st[0] + (lt.en[0] - lt.st[0]) * .78 + .4); paidTag.setAttribute('opacity', Math.min(1, pp * 3)); paidTag.setAttribute('transform', `translate(960,${520 - (1 - bounce(pp)) * 30}) scale(${lerp(.4, 1, bounce(pp))})`);
          const c1 = prog(tt, lt.st[1] + .1, lt.st[1] + .6) * (1 - prog(tt, lt.st[2] - .3, lt.st[2] + .05)); cmt.setAttribute('opacity', c1);
          const L2 = Math.max(1.5, lt.en[1] - lt.st[1]), tq = (tt - lt.st[1]) / L2;
          bub.forEach((o, i) => { const k = prog(tq, .1 + i * .18, .3 + i * .18); o.q.setAttribute('opacity', Math.min(1, k * 3)); o.q.setAttribute('transform', `translate(${o.bx},${o.by + (1 - bounce(k)) * 30}) scale(${lerp(.6, 1, bounce(k))})`); });
          const ty = clamp((tq - .35) / .45); typed.forEach((r, i) => r.setAttribute('width', 200 * clamp(ty * 3 - i))); ph.setAttribute('opacity', ty > 0 ? 0 : 1); caret.setAttribute('x', 496 + (ty > 0 ? Math.min(3, ty * 3) * 200 + Math.floor(Math.min(2, ty * 3)) * 50 : 0)); caret.setAttribute('opacity', Math.sin(tt * 9) > 0 ? 1 : .2);
          dn.setAttribute('transform', `translate(960,${822 + Math.sin(tt * 6) * 12})`); dn.setAttribute('opacity', prog(tq, .5, .7));
        } else brand.setAttribute('opacity', ez(prog(ts, 0, .6))); lg.setAttribute('transform', `translate(760,${150 + Math.sin(ts * 3) * 5}) scale(${1.5 + .04 * Math.sin(ts * 3)})`);
        if (!PH) head.setAttribute('opacity', ez(prog(ts, .4, 1.2)));
        // like: pops in, thumb tilts, rays burst, +1 floats up
        const lp = prog(ts, 3.9, 4.5); like.setAttribute('opacity', ez(lp)); like.setAttribute('transform', `translate(${LX},${cy}) scale(${lerp(.3, 1, b(lp))})`);
        const tilt = ts > 4.3 && ts < 5.2 ? -22 * Math.sin(prog(ts, 4.3, 5.2) * Math.PI) : 0; thumb.setAttribute('transform', `scale(1.55) rotate(${tilt})`);
        const bu = prog(ts, 4.4, 5.3); rays.forEach(r => { const a = +r.getAttribute('data-a'), r0 = 130 + bu * 20, r1 = r0 + 36 * Math.sin(bu * Math.PI); r.setAttribute('x1', Math.cos(a) * r0); r.setAttribute('y1', Math.sin(a) * r0); r.setAttribute('x2', Math.cos(a) * (r0 + r1 - r0)); r.setAttribute('y2', Math.sin(a) * (r0 + r1 - r0)); r.setAttribute('opacity', bu > 0 && bu < 1 ? 1 - bu * .6 : 0); });
        const pl = prog(ts, 4.5, 5.6); plus.setAttribute('opacity', pl > 0 && pl < 1 ? Math.sin(pl * Math.PI) : 0); plus.setAttribute('transform', `translate(0,${-pl * 60})`);
        // share: pops in, dots travel from the left node to the two others
        const sp0 = prog(ts, 4.8, 5.4); share.setAttribute('opacity', ez(sp0)); share.setAttribute('transform', `translate(${SX},${cy}) scale(${lerp(.3, 1, b(sp0))})`);
        travel.forEach((d, i) => { const q = prog((ts - i * .25) % 1.1, 0, .8), on = ts > 5.4 && ts < 8.6; d.setAttribute('cx', lerp(nodes[0][0], nodes[i + 1][0], q)); d.setAttribute('cy', lerp(nodes[0][1], nodes[i + 1][1], q)); d.setAttribute('opacity', on ? 1 : 0); });
        // subscribe: slides up, a cursor taps it, it turns grey, then the bell pops and rings
        const bp = prog(ts, 5.6, 6.3); sub.setAttribute('opacity', ez(bp));
        const tap = prog(ts, 7.05, 7.3), pressed = ts >= 7.15, sc = ts > 7.05 && ts < 7.4 ? 1 - .06 * Math.sin(prog(ts, 7.05, 7.4) * Math.PI) : 1;
        sub.setAttribute('transform', `translate(${BX},${cy + lerp(60, 0, b(bp))}) scale(${sc})`);
        subBtn.setAttribute('fill', pressed ? '#33475f' : '#e62117'); const want = pressed ? (S.L.subbedLabel || '') : (S.L.subLabel || ''); if (subTxt.textContent !== want) { subTxt.textContent = want; fit(subTxt, 380); }
        const cp = prog(ts, 6.35, 7.05); cur.setAttribute('opacity', ez(prog(ts, 6.35, 6.6)) * (1 - ez(prog(ts, 7.6, 8.0))));
        cur.setAttribute('transform', `translate(${lerp(BX + 520, BX + 60, ez(cp))},${lerp(cy + 330, cy + 30, ez(cp)) + (tap > 0 && tap < 1 ? 6 : 0)})`);
        const bl = prog(ts, 7.25, 7.8); bell.setAttribute('opacity', ez(bl)); bell.setAttribute('transform', `translate(${BLX},${cy}) scale(${lerp(.3, 1, b(bl))})`);
        const ring = ts > 7.5 ? 24 * Math.exp(-(ts - 7.5) * 1.1) * Math.sin((ts - 7.5) * 16) : 0; bellIn.setAttribute('transform', `rotate(${ring} 0 -50)`);
        arcs.forEach((pair, i) => pair.forEach(a => a.setAttribute('opacity', ts > 7.5 && ts < 9.8 ? .5 + .5 * Math.sin((ts - 7.5) * 16 - i) : 0)));
        sp.forEach((e, i) => { const a = i * 1.05 + 1, q = prog(ts, 7.2 + i * .06, 8.4 + i * .06), r = 150 + q * 90; e.setAttribute('opacity', q > 0 && q < 1 ? Math.sin(q * Math.PI) : 0); e.setAttribute('transform', `translate(${BX + Math.cos(a) * r * 1.6},${cy + Math.sin(a) * r * .8}) scale(${.5 + .5 * Math.sin(q * Math.PI)})`); });
      };
    },
  };

  // ---------------------------------------------------------------- episode helpers
  function langOf(ep, lang) {
    const L = Object.assign({ name: lang, currency: '', locale: 'en-GB', decimals: 2 }, (ep.languages || {})[lang] || {});
    return L;
  }
  function moneyFn(L) {
    return (v, full) => {
      v = +v || 0;
      const d = full ? (+L.decimals || 0) : (Math.abs(v - Math.round(v)) > 1e-6 ? (+L.decimals || 0) : 0);
      let s;
      try { s = v.toLocaleString(L.locale || 'en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }); } catch (e) { s = v.toFixed(d); }
      return (L.currency || '') + s;
    };
  }
  /** Scene text for one language: that language's block, falling back to English, then to the scene defaults. */
  function sceneLang(scene, lang) {
    const def = (SCENES[scene.type] || {}).defaults || { lang: {} };
    const l = scene.lang || {};
    const out = Object.assign({}, def.lang, l.en || {}, l[lang] || {});
    out.take = takeOf(scene, lang); // a recording belongs to one language only: never borrowed from English
    if (!out.take) delete out.take;
    return out;
  }
  /** This language's recording for a scene, if it has a usable one. */
  function takeOf(scene, lang) {
    const t = ((scene.lang || {})[lang] || {}).take;
    if (!t || !t.file) return null;
    const dur = +t.dur || 0, a = Math.max(0, +t.in || 0), b = Math.min(dur || Infinity, t.out == null ? dur : +t.out);
    return b - a > 0.2 ? Object.assign({}, t, { in: a, out: b }) : null;
  }
  /** A short fingerprint of one language's recording timings: "Make video" checks the build used the same ones. */
  function takeSig(ep, lang) {
    const tl = timeline(ep, lang);
    return tl.scenes.filter(o => o.take).map(o => `${o.i}:${o.take.file}:${o.take.in.toFixed(2)}-${o.take.out.toFixed(2)}`).join('|') + `#${tl.duration.toFixed(2)}`;
  }
  /** Scene length when it follows a recording. */
  const takeLength = t => (t.out - t.in) + LEAD + TAIL;
  function sceneData(scene) { const def = (SCENES[scene.type] || {}).defaults || { data: {} }; return Object.assign({}, def.data, scene.data || {}); }

  /** Start/end of every scene, and caption timings. */
  /** Seconds needed to read a scene's lines aloud at a relaxed pace (about 150 words a minute) plus the lead-in and tail. */
  function speechNeed(s, lang) {
    const lines = (sceneLang(s, lang).lines || []).filter(x => String(x).trim());
    const words = lines.reduce((a, x) => a + String(x).trim().split(/\s+/).length, 0);
    return words ? Math.ceil((words * .4 + LEAD + TAIL + .4) * 2) / 2 : 0;
  }
  function timeline(ep, lang) {
    let t = 0;
    const scenes = (ep.scenes || []).map((s, i) => ({ s, i })).filter(x => SCENES[x.s.type]).map(({ s, i }) => {
      const take = takeOf(s, lang);
      const dur = take ? takeLength(take) : Math.max(.5, +s.duration || Math.max(SCENES[s.type].base, speechNeed(s, lang)));
      const o = { i, scene: s, start: t, end: t + dur, dur, take };
      t += dur; return o;
    });
    const caps = [], cues = [];
    scenes.forEach(o => {
      const T = SCENES[o.scene.type], L = sceneLang(o.scene, lang), lines = (L.lines || []).filter(x => String(x).trim());
      const k = o.dur / T.base;
      (T.cues || []).forEach(c => { if (c.sound) cues.push({ t: o.start + c.at * k, sound: c.sound }); });
      if (!lines.length) return;
      const lc = (T.cues || []).filter(c => c.line != null);
      // with a recording, the lines are spread over the time you are speaking (longer lines get more time)
      const from = o.take ? o.start + LEAD - .15 : o.start, span = o.take ? o.take.out - o.take.in : o.dur, endAt = o.take ? from + span + .35 : o.end;
      let starts;
      if (!o.take && lc.length === lines.length) starts = lc.map(c => o.start + c.at * k);
      else starts = relStarts(lines, o.take, span).map(x => from + x);
      lines.forEach((s, j) => caps.push({ start: starts[j] + .15, end: (j + 1 < lines.length ? starts[j + 1] : endAt) - .1, text: s, show: T.captions !== false && o.scene.captions !== false }));
    });
    return { scenes, captions: caps, cues, duration: t };
  }

  /** Builds the animation into an <svg> and returns { duration, render(t) }. */
  function mount(svg, ep, lang, opts = {}) {
    const channel = opts.channel || {};
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.fontFamily = 'var(--ex-font, sans-serif)';
    const defs = el('defs', {}, svg);
    const L = langOf(ep, lang), money = moneyFn(L);
    const channelName = (channel.names || {})[lang] || channel.name || 'Oh, I Get It!!';
    const tagline = (channel.taglines || {})[lang] || (channel.taglines || {}).en || '';
    const tl = timeline(ep, lang);
    const built = tl.scenes.map((o, idx) => {
      const g = el('g', { opacity: 0 }, svg), cl = (SCENES[o.scene.type] || {}).camera ? null : CAM_LAYOUTS[sceneData(o.scene).cam];
      let body = g, camG = null;
      if (cl) { // the scene is drawn inside a smaller panel (or in full under a corner bubble), with a gold frame where your video goes
        if (cl.panel) { const bgG = el('linearGradient', { id: 'cb' + idx, x1: 0, y1: 0, x2: 1, y2: 1 }, defs); el('stop', { offset: 0, 'stop-color': '#0d1b2a' }, bgG); el('stop', { offset: 1, 'stop-color': '#10294a' }, bgG); el('rect', { width: W, height: H, fill: `url(#cb${idx})` }, g);
          const cp = el('clipPath', { id: 'cc' + idx }, defs); el('rect', { x: cl.panel.x, y: cl.panel.y, width: W * cl.panel.s, height: H * cl.panel.s, rx: 28 }, cp);
          const clipG = el('g', { 'clip-path': `url(#cc${idx})` }, g); body = el('g', { transform: `translate(${cl.panel.x},${cl.panel.y}) scale(${cl.panel.s})` }, clipG);
          el('rect', { x: cl.panel.x, y: cl.panel.y, width: W * cl.panel.s, height: H * cl.panel.s, rx: 28, fill: 'none', stroke: '#ffd166', 'stroke-width': 5 }, g); }
        camG = cl; }
      const S = { data: sceneData(o.scene), L: sceneLang(o.scene, lang) };
      const ctx = { uid: 's' + idx, defs, L, lang, money, preview: !!opts.preview, channelName, tagline, dur: o.dur };
      let draw = () => {};
      try { draw = SCENES[o.scene.type].build.call(SCENES[o.scene.type], body, S, ctx); } catch (e) { console.error('Scene', idx, o.scene.type, e); txt(g, 960, 540, 'Scene error: ' + e.message, 40, 700, '#d62828'); }
      if (camG) { const r = camG.slot, fr = el('g', {}, g); el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: r.r, fill: '#0b1522', opacity: o.take ? 0 : .55 }, fr); el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: r.r, fill: 'none', stroke: '#ffd166', 'stroke-width': 6 }, fr); if (!o.take) txt(fr, r.x + r.w / 2, r.y + r.h / 2 + 8, 'YOUR CAMERA', 30, 800, '#ffd166', { max: r.w - 40 }); }
      fitAll(g);
      return { o, g, draw };
    });
    const capG = el('g', { opacity: 0 }, svg);
    const capR = el('rect', { x: 260, y: 935, width: 1400, height: 92, rx: 46, fill: '#000', opacity: .62 }, capG);
    const capT = txt(capG, 960, 996, '', 44, 700, '#fff');
    let lastCap = null;
    function render(t) {
      t = clamp(t, 0, Math.max(0, tl.duration - 1e-3));
      built.forEach((b, i) => {
        const { start, end } = b.o, next = built[i + 1];
        const fadeIn = i === 0 ? 1 : ease(prog(t, start - FADE / 2, start + FADE / 2));
        const visible = t >= start - FADE / 2 && (!next || t < end + FADE / 2);
        b.g.setAttribute('opacity', visible ? fadeIn : 0);
        b.g.style.display = visible ? '' : 'none';
        if (visible) { try { b.draw(clamp((t - start) / (end - start))); } catch (e) { /* keep playing */ } }
      });
      const c = opts.noCaptions ? null : tl.captions.find(c => c.show && t >= c.start && t < c.end);
      if (!c) { capG.setAttribute('opacity', 0); return; }
      capG.setAttribute('opacity', Math.min(prog(t, c.start, c.start + .2), 1 - prog(t, c.end - .2, c.end)));
      if (lastCap !== c) {
        lastCap = c; capT.textContent = c.text; capT.setAttribute('font-size', 44);
        let f = 44; try { while (capT.getComputedTextLength() > 1700 && f > 24) { f -= 1; capT.setAttribute('font-size', f); } } catch (e) {}
        let w = 600; try { w = Math.min(1860, Math.max(600, capT.getComputedTextLength() + 120)); } catch (e) {}
        capR.setAttribute('width', w); capR.setAttribute('x', 960 - w / 2);
      }
    }
    render(0);
    return { duration: tl.duration, render, timeline: tl, refit() { built.forEach(b => fitAll(b.g)); lastCap = null; } };
  }

  const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');
  const srtTime = s => `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)},${pad((s % 1) * 1000, 3)}`;
  /** Subtitle file (SRT) for YouTube. Includes every voiceover line, also ones not shown on screen. */
  function srt(ep, lang) { return timeline(ep, lang).captions.map((c, i) => `${i + 1}\n${srtTime(Math.max(0, c.start))} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n'); }
  /** Plain teleprompter script for one language. */
  function script(ep, lang) {
    const tl = timeline(ep, lang), out = [`${(ep.title || {})[lang] || (ep.title || {}).en || ep.id}  (${langOf(ep, lang).name})`, ''];
    tl.scenes.forEach((o, i) => {
      const L = sceneLang(o.scene, lang);
      out.push(`[Scene ${i + 1}: ${SCENES[o.scene.type].label}, ${o.start.toFixed(1)}s to ${o.end.toFixed(1)}s${o.take ? ', follows your recording' : ''}]`);
      (L.lines || []).forEach(l => out.push(l));
      out.push('');
    });
    return out.join('\n');
  }
  /** Makes a new scene from a library type, with default content copied into every language. */
  function newScene(type, langs) {
    const T = SCENES[type], s = { type, data: JSON.parse(JSON.stringify(T.defaults.data || {})), lang: {} };
    (langs || ['en']).forEach(l => { s.lang[l] = JSON.parse(JSON.stringify(T.defaults.lang || {})); });
    return s;
  }

  Object.keys(SCENES).forEach(k => { const T = SCENES[k]; if (!T.camera && T.fields && !T.fields.some(f => f.k === 'cam')) T.fields.push({ k: 'cam', per: 'data', kind: 'select', options: [['', 'No video of me in this scene']].concat(Object.keys(CAM_LAYOUTS).map(c => [c, CAM_LAYOUTS[c].label])), label: 'My video in this scene (record yourself for it)' }); });
  root.Explainer = { CAM_LAYOUTS, camSlot, SCENES, ITEM_KINDS, mount, timeline, speechNeed, srt, script, newScene, sceneLang, sceneData, langOf, takeOf, takeSig, W, H, LEAD, TAIL, FADE };
})(typeof window !== 'undefined' ? window : globalThis);
