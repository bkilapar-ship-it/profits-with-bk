'use strict';
/* Loads the published setups file and daily bars. Read-only. */
const fs = require('fs');

async function loadJson(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Could not download ${src} (HTTP ${res.status})`);
    return res.json();
  }
  return JSON.parse(fs.readFileSync(src, 'utf8'));
}

/** Daily bars for symbols from Alpaca: { SYM: [{t,o,h,l,c,v}] }, oldest first. */
async function fetchBars(symbols, { keyId, secret, base = 'https://data.alpaca.markets', feed = 'sip', days = 420 } = {}) {
  if (!keyId || !secret) throw new Error('ALPACA_KEY_ID and ALPACA_SECRET_KEY are required to draw charts.');
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const out = {};
  for (let i = 0; i < symbols.length; i += 20) {
    const chunk = symbols.slice(i, i + 20);
    let token = null;
    do {
      const q = new URLSearchParams({ symbols: chunk.join(','), timeframe: '1Day', start, adjustment: 'split', feed, limit: '10000', sort: 'asc' });
      if (token) q.set('page_token', token);
      let res;
      for (let a = 0; a < 4; a++) {
        res = await fetch(`${base}/v2/stocks/bars?${q}`, { headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret }, signal: AbortSignal.timeout(60000) });
        if (res.status !== 429 && res.status < 500) break;
        await new Promise(r => setTimeout(r, 2000 * 2 ** a));
      }
      if (!res.ok) throw new Error(`Alpaca HTTP ${res.status}`);
      const j = await res.json();
      for (const [s, list] of Object.entries(j.bars || {})) (out[s] = out[s] || []).push(...list.map(b => ({ t: String(b.t).slice(0, 10), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })));
      token = j.next_page_token || null;
    } while (token);
  }
  return out;
}

const sma = (vals, n) => vals.map((_, i) => (i + 1 >= n ? vals.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n : null));

module.exports = { loadJson, fetchBars, sma };
