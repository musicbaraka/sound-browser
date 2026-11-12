// Converter worker: writes WAV, AIFF, FLAC or MP3 away from the window so it stays responsive.
import { encodeWav, encodeAiff, encodeFlac, encodeMp3, estimateFlac } from './encode.mjs';

self.onmessage = e => {
  const { id, cmd, fmt, bits, kbps, sampleRate, channels, srcBits } = e.data;
  try {
    if (cmd === 'estimate') {
      self.postMessage({ id, size: estimateFlac(channels, sampleRate, bits) });
      return;
    }
    let last = 0;
    const progress = p => { const now = Date.now(); if (now - last > 120) { last = now; self.postMessage({ id, progress: p }); } };
    let data;
    if (fmt === 'mp3') data = encodeMp3(channels, sampleRate, kbps, progress);
    else if (fmt === 'flac') data = encodeFlac(channels, sampleRate, bits, progress, srcBits);
    else if (fmt === 'aiff') data = encodeAiff(channels, sampleRate, bits, srcBits);
    else data = encodeWav(channels, sampleRate, bits, srcBits);
    self.postMessage({ id, data }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
