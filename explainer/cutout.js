/* Cut-out of the person in a video frame (MediaPipe selfie segmentation, runs on the device, nothing is uploaded).
 * Cutout.ready() -> Promise (rejects if this browser cannot run it)
 * Cutout.cut(videoEl, canvas) -> Promise: canvas holds only the person (transparent background), at most 960 px wide. */
(function (root) {
  let seg = null, loading = null, last = null, busy = Promise.resolve();
  const base = (() => { const s = document.currentScript; return s && s.src ? s.src.replace(/[^/]*$/, '') : ''; })();
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the cut-out tool.')); document.head.appendChild(s); }); }
  function ready() {
    if (loading) return loading;
    return (loading = (async () => {
      await loadScript(base + 'vendor/selfie/selfie_segmentation.js');
      if (!root.SelfieSegmentation) throw new Error('The cut-out tool did not start.');
      const s = new root.SelfieSegmentation({ locateFile: f => base + 'vendor/selfie/' + f });
      s.setOptions({ modelSelection: 1, selfieMode: false });
      s.onResults(r => { last = r; });
      await s.initialize();
      seg = s;
    })().catch(e => { loading = null; throw e; }));
  }
  const mcv = document.createElement('canvas');
  /** The mask comes back as alpha on some browsers and as a red-on-opaque picture on others (iPhone). Returns a small canvas where alpha = person. */
  function maskAlpha(m) {
    const mw = m.width || 256, mh = m.height || 144; mcv.width = mw; mcv.height = mh;
    const x = mcv.getContext('2d', { willReadFrequently: true }); x.clearRect(0, 0, mw, mh); x.globalCompositeOperation = 'source-over'; x.drawImage(m, 0, 0, mw, mh);
    const id = x.getImageData(0, 0, mw, mh), d = id.data; let amin = 255;
    for (let i = 3; i < d.length; i += 4) if (d[i] < amin) amin = d[i];
    api.maskMode = amin > 200 ? 'red' : 'alpha';
    if (amin > 200) { for (let i = 0; i < d.length; i += 4) { d[i + 3] = d[i]; d[i] = d[i + 1] = d[i + 2] = 255; } x.putImageData(id, 0, 0); }
    return mcv;
  }
  function cut(video, out, dims) {
    const job = busy.then(async () => {
      await ready();
      if (!video.videoWidth) throw new Error('No picture to cut out.');
      const vw = dims ? dims.w : video.videoWidth, vh = dims ? dims.h : video.videoHeight, w = Math.min(960, vw), h = Math.round(w * vh / vw);
      if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
      last = null; await seg.send({ image: video });
      const c = out.getContext('2d'); c.clearRect(0, 0, w, h);
      if (!last || !last.segmentationMask) return out;
      c.globalCompositeOperation = 'source-over'; c.drawImage(maskAlpha(last.segmentationMask), 0, 0, w, h);
      c.globalCompositeOperation = 'source-in'; c.drawImage(video, 0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
      return out;
    });
    busy = job.catch(() => {});
    return job;
  }
  const api = { ready, cut, maskMode: '', _maskAlpha: maskAlpha };
  root.Cutout = api;
})(window);
