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
  function cut(video, out) {
    const job = busy.then(async () => {
      await ready();
      if (!video.videoWidth) throw new Error('No picture to cut out.');
      const w = Math.min(960, video.videoWidth), h = Math.round(w * video.videoHeight / video.videoWidth);
      if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
      last = null; await seg.send({ image: video });
      const c = out.getContext('2d'); c.clearRect(0, 0, w, h);
      if (!last || !last.segmentationMask) return out;
      c.globalCompositeOperation = 'source-over'; c.drawImage(last.segmentationMask, 0, 0, w, h);
      c.globalCompositeOperation = 'source-in'; c.drawImage(video, 0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
      return out;
    });
    busy = job.catch(() => {});
    return job;
  }
  root.Cutout = { ready, cut };
})(window);
