// Runs key and tempo detection, and sound fingerprints, in the background, one sound at a time.
importScripts('analysis.js', 'soundcolor.js');
self.onmessage = (e) => {
  const { id, channels, sampleRate, cmd } = e.data;
  try {
    let x = channels[0];
    if (channels.length > 1) { x = new Float32Array(x.length); for (const c of channels) for (let i = 0; i < x.length; i++) x[i] += c[i] / channels.length; }
    self.postMessage({ id, result: cmd === 'fp' ? scFingerprint(x, sampleRate) : analyzeMono(x, sampleRate) });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
