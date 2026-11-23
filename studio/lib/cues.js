'use strict';
/* Ties every visual step (beat) to the sentence that talks about it.
   Input: the narration and, for each beat, the text shown by the items that appear in it.
   Output: one threshold per beat = where in the narration (0..1, by words) its sentence starts. */
const STOP = new Set('jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december a an the and or of to in on at is are was were be been it its this that these those for from with as by we you your i my me our they them their he she his her not no but so if then than too very just can will would could should do does did have has had about into over under up down out what when where which who how why all any each more most some such only own same both few other there here also still even ever one two three four five six seven eight nine ten'.split(' '));
const norm = t => String(t || '').toLowerCase().replace(/%/g, ' percent ').replace(/[–—−]/g, ' ').replace(/(\d),(\d)/g, '$1$2').replace(/&/g, ' and ').replace(/[^a-z0-9. ]+/g, ' ').replace(/\.+(?=\s|$)/g, ' ').replace(/\s\.+/g, ' ');
const stem = w => w.length > 4 ? w.replace(/(ing|ed|es|s|ly)$/, '') : w;
const toks = t => norm(t).split(/\s+/).filter(w => w && !STOP.has(w) && !/^(19|20)\d\d$/.test(w)).map(stem);
const wt = t => (/^\d+$/.test(t) ? 2 : 1);
const sentences = t => String(t || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9'"“$])/).filter(Boolean);

/* the visual should be on screen a moment BEFORE it is spoken, in case reading lags: about 1.5 seconds of speech (4 words at 150 wpm) */
const LEAD = 4;

function cues(narration, beatTexts) {
  const B = beatTexts.length, ss = sentences(narration);
  if (!B) return [];
  if (!ss.length) return beatTexts.map((_, k) => Math.min(0.97, (k + 1) / (B + 1)));
  const w = ss.map(x => x.split(' ').length), tot = w.reduce((a, b) => a + b, 0), st = [];
  let c = 0; w.forEach(x => { st.push(c / tot); c += x; });
  const S = ss.length, sT = ss.map(x => new Set(toks(x)));
  const bT = beatTexts.map(x => [...new Set(toks(x))]);
  const df = {}; bT.forEach(a => a.forEach(t => { df[t] = (df[t] || 0) + 1; }));
  const sdf = {}; sT.forEach(s => s.forEach(t => { sdf[t] = (sdf[t] || 0) + 1; }));
  // score[k][j]: how strongly the words shown in beat k appear in sentence j (rarer words count more)
  const score = bT.map(a => { const den = a.reduce((s, t) => s + wt(t) / (df[t] || 1), 0) || 1; return ss.map((_, j) => a.reduce((s, t) => s + (sT[j].has(t) ? (wt(t) / (df[t] || 1)) / Math.max(1, Math.sqrt(sdf[t] || 1)) : 0), 0) / den); });
  const prior = k => (k + 0.5) * S / B - 0.5; // even spread, used only as a gentle tie-break
  const NEG = -1e9, best = [], from = [];
  for (let k = 0; k < B; k++) {
    best.push(new Array(S).fill(NEG)); from.push(new Array(S).fill(-1));
    for (let j = 0; j < S; j++) {
      const own = 2.2 * score[k][j] - 0.06 * Math.abs(j - prior(k));
      if (k === 0) { best[k][j] = own; continue; }
      let bv = NEG, bj = -1;
      for (let q = 0; q <= j; q++) { const v = best[k - 1][q] - (q === j ? 0.12 : 0); if (v > bv) { bv = v; bj = q; } }
      best[k][j] = bv + own; from[k][j] = bj;
    }
  }
  let j = 0; for (let q = 1; q < S; q++) if (best[B - 1][q] > best[B - 1][j]) j = q;
  const pick = new Array(B); for (let k = B - 1; k >= 0; k--) { pick[k] = j; j = from[k][j]; }
  // beats sharing one sentence are spread through it, so they still appear one by one
  const out = new Array(B); let k = 0;
  while (k < B) { let e = k; while (e + 1 < B && pick[e + 1] === pick[k]) e++; const n = e - k + 1, sj = pick[k]; for (let m = 0; m < n; m++) out[k + m] = Math.max(0, Math.min(0.97, st[sj] + (m / n) * (w[sj] / tot) - LEAD / tot)); k = e + 1; }
  return out;
}

module.exports = { cues, sentences };
