'use strict';
/* Original channel branding: logo emblem and a faint falling-candles background. Neon-on-black look. */

const NEON = { cyan: '#26D0FF', green: '#1FE5A5', red: '#FF3B6B', yellow: '#FFC21A' };

/** The channel logo (assets/logo.png), inlined so every rendered page is self-contained. */
const LOGO_B64 = (() => { try { return require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'logo.png')).toString('base64'); } catch (e) { return ''; } })();
function logoSvg(size = 120) {
  return `<img src="data:image/png;base64,${LOGO_B64}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;display:block;border-radius:20%;object-fit:contain" alt="The 4% Swing Trades">`;
}

/** Deterministic faint candlesticks for the background. */
function bgCandles(w, h, seed = 7) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const n = 46; let out = '';
  for (let i = 0; i < n; i++) {
    const x = 20 + i * ((w - 40) / (n - 1)), ht = 40 + rnd() * 150, y = 40 + rnd() * (h - 240), up = rnd() > 0.5, col = up ? NEON.green : NEON.red, bw = 10 + rnd() * 5;
    out += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${(y - 14).toFixed(1)}" y2="${(y + ht + 14).toFixed(1)}" stroke="${col}" stroke-width="2"/><rect x="${(x - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${ht.toFixed(1)}" rx="2" fill="${col}"/>`;
  }
  return `<svg class="bgc" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="position:absolute;inset:0;opacity:.075">${out}</svg>`;
}

module.exports = { NEON, logoSvg, bgCandles };
