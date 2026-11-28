/*
 * Brand kit for the service studio: the client's name, words, colours and logo.
 * Everything is checked here, so the rest of the studio can trust what it gets:
 * text is trimmed and length-limited, colours are real hex colours that stay readable,
 * and a logo is always re-drawn into a small PNG on the device (no scripts, no hidden data, never uploaded).
 */
(function (root) {
  'use strict';
  const DEF = Object.freeze({
    v: 1, name: '', tagline: '', cta: 'Like · Share · Follow', website: '',
    colors: Object.freeze({ background: '#0d1b2a', accent: '#ffd166', text: '#8ecae6' }),
    logo: '', logoOk: false
  });
  // Ready-made colour sets that are known to read well with the white writing in the scenes.
  const PRESETS = [
    { label: 'Navy and gold', colors: { background: '#0d1b2a', accent: '#ffd166', text: '#8ecae6' } },
    { label: 'Forest and mint', colors: { background: '#0f2a22', accent: '#6ee7b7', text: '#a7f3d0' } },
    { label: 'Plum and peach', colors: { background: '#2a1033', accent: '#ffb38a', text: '#e9c6ff' } },
    { label: 'Charcoal and coral', colors: { background: '#1c1c22', accent: '#ff6b6b', text: '#c9d1d9' } },
    { label: 'Ocean and sky', colors: { background: '#062b3f', accent: '#4cc9f0', text: '#bde0fe' } },
    { label: 'Black and lime', colors: { background: '#111111', accent: '#c6f432', text: '#e5e5e5' } }
  ];
  const LIM = { name: 40, tagline: 90, cta: 40, website: 60 };
  const MAX_LOGO_CHARS = 600000; // a 512px PNG data URL is far smaller; anything bigger is refused
  const MAX_UPLOAD = 8 * 1048576;

  const cleanText = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  function hex(v) {
    let s = String(v || '').trim().toLowerCase(); if (s[0] !== '#') s = '#' + s;
    if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s.slice(1).split('').map(c => c + c).join('');
    return /^#[0-9a-f]{6}$/.test(s) ? s : null;
  }
  const rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const toHex = a => '#' + a.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  function lum(h) { return rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0); }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  const darken = (h, u) => toHex(rgb(h).map(v => v * (1 - u)));
  const lighten = (h, u) => toHex(rgb(h).map(v => v + (255 - v) * u));

  /** Returns { brand, warnings }. Never throws: bad parts fall back to safe defaults and say why. */
  function clean(raw) {
    const r = raw && typeof raw === 'object' ? raw : {}, w = [], c = r.colors && typeof r.colors === 'object' ? r.colors : {};
    const b = { v: 1, name: cleanText(r.name, LIM.name), tagline: cleanText(r.tagline, LIM.tagline), cta: cleanText(r.cta == null ? DEF.cta : r.cta, LIM.cta), website: cleanText(r.website, LIM.website), colors: {}, logo: '', logoOk: !!r.logoOk };
    ['background', 'accent', 'text'].forEach(k => { const h = hex(c[k]); if (c[k] != null && c[k] !== '' && !h) w.push(`The ${k} colour "${cleanText(c[k], 12)}" is not a colour code, so the default is used.`); b.colors[k] = h || DEF.colors[k]; });
    // the scenes use white writing, so the background must stay dark enough to read it
    let bg = b.colors.background, k = 0; while (contrast(bg, '#ffffff') < 7 && k++ < 40) bg = darken(bg, .08);
    if (bg !== b.colors.background) { w.push('The background was darkened a little so white writing stays easy to read.'); b.colors.background = bg; }
    let ac = b.colors.accent; k = 0; while (contrast(ac, bg) < 3 && k++ < 40) ac = lighten(ac, .1);
    if (ac !== b.colors.accent) { w.push('The main brand colour was lightened so it stands out from the background.'); b.colors.accent = ac; }
    let tx = b.colors.text; k = 0; while (contrast(tx, bg) < 4.5 && k++ < 40) tx = lighten(tx, .1);
    if (tx !== b.colors.text) { w.push('The second colour was lightened so small words stay readable.'); b.colors.text = tx; }
    if (typeof r.logo === 'string' && r.logo) {
      if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(r.logo) && r.logo.length <= MAX_LOGO_CHARS) b.logo = r.logo;
      else w.push('The saved logo could not be used. Please add it again.');
    }
    if (b.logo && !b.logoOk) { b.logo = ''; w.push('The logo was left out because the permission box was not ticked.'); }
    return { brand: b, warnings: w };
  }

  /** Turns an uploaded picture into a small transparent PNG (max 512px). Rejects anything that is not a picture. */
  async function logoFromFile(file) {
    if (!file) throw new Error('No file was chosen.');
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type || '')) throw new Error('Please choose a PNG, JPG, WEBP or SVG picture.');
    if (file.size > MAX_UPLOAD) throw new Error('That picture is over 8 MB. Please use a smaller logo file.');
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That picture could not be opened. Try saving it as a PNG.')); i.src = url; });
      const w0 = im.naturalWidth || 512, h0 = im.naturalHeight || 512;
      for (const side of [512, 384, 256, 192]) { // detailed pictures are stored smaller, so they still fit on the device
        const s = Math.min(1, side / Math.max(w0, h0)), cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w0 * s)); cv.height = Math.max(1, Math.round(h0 * s));
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        const out = cv.toDataURL('image/png');
        if (out.length <= MAX_LOGO_CHARS) return out;
      }
      throw new Error('That logo is too detailed to store. Try a simpler version, such as a PNG with a plain or see-through background.');
    } finally { URL.revokeObjectURL(url); }
  }

  root.Brand = { DEF, PRESETS, LIM, clean, contrast, hex, logoFromFile };
})(typeof window !== 'undefined' ? window : globalThis);
