'use strict';
/* Original channel branding: logo emblem and a faint falling-candles background. Neon-on-black look. */

const NEON = { cyan: '#26D0FF', green: '#1FE5A5', red: '#FF3B6B', yellow: '#FFC21A' };

/** The emblem: three rising candles inside a glowing rounded square. */
function logoSvg(size = 120, { glow = true, id = 'lg' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 120">
  <defs>
    <filter id="${id}-g" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <linearGradient id="${id}-f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06222E"/><stop offset="1" stop-color="#02070C"/></linearGradient>
  </defs>
  <g ${glow ? `filter="url(#${id}-g)"` : ''}>
    <rect x="6" y="6" width="108" height="108" rx="30" fill="url(#${id}-f)" stroke="${NEON.cyan}" stroke-width="4.5"/>
    <g stroke-linecap="round">
      <line x1="34" y1="62" x2="34" y2="94" stroke="${NEON.red}" stroke-width="4"/><rect x="26" y="70" width="16" height="18" rx="3.5" fill="${NEON.red}"/>
      <line x1="60" y1="44" x2="60" y2="86" stroke="${NEON.green}" stroke-width="4"/><rect x="52" y="52" width="16" height="26" rx="3.5" fill="${NEON.green}"/>
      <line x1="86" y1="24" x2="86" y2="76" stroke="${NEON.green}" stroke-width="4"/><rect x="78" y="32" width="16" height="36" rx="3.5" fill="${NEON.green}"/>
    </g>
    <path d="M24 100 L96 100" stroke="${NEON.yellow}" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 8"/>
  </g></svg>`;
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
