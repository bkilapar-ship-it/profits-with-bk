'use strict';
/* Market-bottom analysis from daily SPY bars (and optionally VIX closes). Pure functions, no network. */
const sma = (vals, n) => vals.map((_, i) => (i + 1 >= n ? vals.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n : null));
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const fdate = t => new Date(`${t}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function analyze(spy, vix) {
  if (!Array.isArray(spy) || spy.length < 400) return null;
  const c = spy.map(b => b.c), n = c.length, dates = spy.map(b => b.t);
  const s20 = sma(c, 20), s50 = sma(c, 50);
  // running peak and drawdown from it
  const peakIdx = [], dd = [];
  let pk = 0;
  for (let i = 0; i < n; i++) { if (c[i] >= c[pk]) pk = i; peakIdx.push(pk); dd.push(c[i] / c[pk] - 1); }
  // episodes: a peak followed by a fall of 10% or more before a new high
  const eps = [];
  let i = 0;
  while (i < n) {
    const p = peakIdx[i];
    if (dd[i] <= -0.10) {
      let end = i; while (end + 1 < n && peakIdx[end + 1] === p) end++;
      const recovered = end + 1 < n; // a new high came later
      let low = i; for (let j = p; j <= end; j++) if (c[j] < c[low]) low = j;
      const cross = {}; [0.10, 0.15, 0.20, 0.25, 0.30].forEach(th => { for (let j = p; j <= end; j++) if (c[j] / c[p] - 1 <= -th) { cross[th] = j; break; } });
      const first = cross[0.10], fwd = first + 63 < n ? c[first + 63] / c[first] - 1 : null;
      eps.push({ p, low, end, recovered, depth: c[low] / c[p] - 1, cross, first, further: c[low] / c[first] - 1, fwd63: fwd });
      i = end + 1;
    } else i++;
  }
  const done = eps.filter(e => e.recovered);
  const worst = (done.length ? done : eps).slice().sort((a, b) => a.depth - b.depth)[0] || null;
  const stats = done.length >= 3 ? {
    n: done.length,
    medFurther: median(done.map(e => e.further)),
    medDepth: median(done.map(e => e.depth)),
    fwdUp: done.filter(e => e.fwd63 !== null && e.fwd63 > 0).length, fwdN: done.filter(e => e.fwd63 !== null).length,
    furtherOver5: done.filter(e => e.further < -0.05).length,
  } : null;
  let ep = null;
  if (worst) {
    const L = worst.low, a = Math.max(0, worst.p - 6), b = Math.min(n - 1, L + 70);
    // panic day: heaviest volume on a down day near the low
    let panic = -1, best = 0;
    for (let j = Math.max(worst.p + 1, L - 15); j <= Math.min(n - 1, L + 5); j++) {
      if (c[j] >= c[j - 1]) continue;
      const base = spy.slice(Math.max(0, j - 20), j).reduce((s, x) => s + x.v, 0) / Math.max(1, Math.min(20, j));
      const r = spy[j].v / base; if (r > best) { best = r; panic = j; }
    }
    // higher low: after the first bounce, a pullback that holds above the low
    let bounce = -1, hl = -1;
    for (let j = L + 1; j <= Math.min(n - 1, L + 30); j++) if (bounce < 0 || c[j] > c[bounce]) bounce = j;
    if (bounce > L) { for (let j = bounce + 3; j <= Math.min(n - 1, bounce + 30); j++) if (hl < 0 || c[j] < c[hl]) hl = j; if (hl > bounce && c[hl] <= c[L]) hl = -1; if (hl > 0) { for (let j = hl + 1; j <= Math.min(n - 1, hl + 10); j++) if (c[j] < c[hl]) { hl = -1; break; } } }
    // reclaim: first sustained (3 closes) move above a moving average after the low
    const reclaim = ma => { for (let j = L + 1; j < b - 2; j++) if (ma[j] && c[j] > ma[j] && c[j + 1] > ma[j + 1] && c[j + 2] > ma[j + 2] && c[j - 1] <= ma[j - 1]) return j; return -1; };
    const r20 = reclaim(s20), r50 = reclaim(s50);
    const win = { a, b };
    const vixW = vix && vix.length ? dates.slice(a, b + 1).map(d => { const v = vix.find(x => x.t === d); return v ? v.c : null; }) : null;
    let vixPeak = -1;
    if (vixW) vixW.forEach((v, k) => { if (v !== null && (vixPeak < 0 || v > vixW[vixPeak])) vixPeak = k; });
    ep = { ...worst, win, panic, panicRatio: best, bounce, hl, r20, r50, vixW: vixW && vixW.filter(v => v !== null).length > 20 ? vixW : null, vixPeak };
  }
  // where the market is now
  const now = { dd: dd[n - 1], peak: peakIdx[n - 1], close: c[n - 1], date: dates[n - 1], chg5: n > 5 ? c[n - 1] / c[n - 6] - 1 : null };
  return { c, v: spy.map(b => b.v), dates, s20, s50, dd, peakIdx, eps, done, worst: ep, stats, now };
}

module.exports = { analyze, sma, fdate };
