// Runs key and tempo detection in the background, one sound at a time.
importScripts('analysis.js');
self.onmessage = (e) => {
  const { id, channels, sampleRate } = e.data;
  try {
    let x = channels[0];
    if (channels.length > 1) { x = new Float32Array(x.length); for (const c of channels) for (let i = 0; i < x.length; i++) x[i] += c[i] / channels.length; }
    self.postMessage({ id, result: analyzeMono(x, sampleRate) });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
