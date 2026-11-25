/* GitHub storage for recordings: keeps big video files off your phone. Files live on the "recordings" branch of this repo
   (rec/<UTC date>-<time>_<name>/000, 001, ...), are split into 20 MB parts, and are deleted automatically after 2 days. */
(function () {
  const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; };
  const BR = 'recordings', PART = 20 * 1024 * 1024;
  const token = () => (LS('bkgh-token') || '').trim();
  const repo = () => { const o = (LS('bkgh-repo') || '').trim(); if (/^[\w.-]+\/[\w.-]+$/.test(o)) { const a = o.split('/'); return { o: a[0], r: a[1] }; } const p = location.pathname.split('/').filter(Boolean); return { o: location.hostname.split('.')[0], r: p[0] || 'profits-with-bk' }; };
  const base = () => { const x = repo(); return 'https://api.github.com/repos/' + x.o + '/' + x.r + '/contents/'; };
  const hdr = (extra) => Object.assign({ Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, extra || {});
  const fail = async (r, what) => { let t = ''; try { t = (await r.text()).slice(0, 180); } catch (e) {} const hint = r.status === 401 || r.status === 403 ? ' (check the token: it needs Contents read and write on this repository)' : r.status === 404 ? ' (the token cannot see this repository or the recordings branch)' : ''; throw new Error(what + ' failed, GitHub said ' + r.status + hint + (t ? ': ' + t : '')); };
  const b64 = blob => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1] || ''); f.onerror = () => rej(new Error('Could not read the file.')); f.readAsDataURL(blob); });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + '-' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()); };
  async function put(path, blob, msg) {
    const body = JSON.stringify({ message: msg, content: await b64(blob), branch: BR });
    for (let i = 0; i < 3; i++) {
      const r = await fetch(base() + path, { method: 'PUT', headers: hdr({ 'Content-Type': 'application/json' }), body });
      if (r.ok) return; if (r.status === 409 || r.status === 422 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; } await fail(r, 'Upload');
    }
    throw new Error('Upload failed after 3 tries.');
  }
  async function listDir(path) { const r = await fetch(base() + path + '?ref=' + BR + '&_=' + Date.now(), { headers: hdr() }); if (r.status === 404) return []; if (!r.ok) await fail(r, 'Listing'); const j = await r.json(); return Array.isArray(j) ? j : []; }
  const api = {
    ok: () => !!token(),
    token, repo,
    setToken: t => LS('bkgh-token', t ? String(t).trim() : null),
    async check() { const r = await fetch('https://api.github.com/repos/' + repo().o + '/' + repo().r + '/branches/' + BR, { headers: hdr() }); if (!r.ok) await fail(r, 'Check'); return true; },
    /* upload a Blob; returns the stored name */
    async save(blob, name, onP) {
      if (!token()) throw new Error('Add your GitHub token first (Studio page, GitHub saving).');
      const dir = stamp() + '_' + String(name || 'recording.mp4').replace(/[^\w.-]/g, '-'), n = Math.max(1, Math.ceil(blob.size / PART));
      for (let i = 0; i < n; i++) { await put('rec/' + dir + '/' + String(i).padStart(3, '0'), blob.slice(i * PART, Math.min(blob.size, (i + 1) * PART)), 'recording ' + dir + ' part ' + (i + 1) + '/' + n); if (onP) onP((i + 1) / n); }
      return dir;
    },
    async list() { const ds = (await listDir('rec')).filter(x => x.type === 'dir'); const out = []; for (const d of ds) { const ps = await listDir('rec/' + d.name); out.push({ name: d.name, parts: ps.length, size: ps.reduce((a, p) => a + (p.size || 0), 0) }); } return out.sort((a, b) => a.name < b.name ? 1 : -1); },
    async load(dir, onP) {
      const ps = (await listDir('rec/' + dir)).filter(x => x.type === 'file').sort((a, b) => a.name < b.name ? -1 : 1), bufs = [];
      if (!ps.length) throw new Error('That recording has no files (it may have been deleted).');
      for (let i = 0; i < ps.length; i++) { const r = await fetch(base() + 'rec/' + dir + '/' + ps[i].name + '?ref=' + BR, { headers: hdr({ Accept: 'application/vnd.github.raw+json' }) }); if (!r.ok) await fail(r, 'Download'); bufs.push(await r.blob()); if (onP) onP((i + 1) / ps.length); }
      const ext = (dir.split('.').pop() || 'mp4').toLowerCase();
      return new Blob(bufs, { type: ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : 'video/mp4' });
    },
    async remove(dir) { const ps = await listDir('rec/' + dir); for (const p of ps) { const r = await fetch(base() + 'rec/' + dir + '/' + p.name, { method: 'DELETE', headers: hdr({ 'Content-Type': 'application/json' }), body: JSON.stringify({ message: 'delete ' + dir, sha: p.sha, branch: BR }) }); if (!r.ok && r.status !== 404) await fail(r, 'Delete'); } }
  };
  window.bkgh = api;
})();
