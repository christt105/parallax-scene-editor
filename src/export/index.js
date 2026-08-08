// Turning a scene into a file the browser can hand you.
//
// GIF and the PNG sequence are produced here, frame by frame, yielding to the
// event loop often enough that the page keeps repainting its progress bar.
// WebM goes through MediaRecorder, which records in real time.

import { renderFrameTo } from '../render.js';
import { GifWriter, PaletteBuilder } from './gif.js';
import { makeZip } from './zip.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Yielding through a MessageChannel rather than requestAnimationFrame or a
// timer: rAF stops firing in a hidden tab and timers get clamped to one a
// second, either of which would leave a long export apparently hung. A message
// task still lets the browser repaint between chunks.
const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
const yieldUI = () => (channel
  ? new Promise(r => { channel.port1.onmessage = () => r(); channel.port2.postMessage(0); })
  : new Promise(r => setTimeout(r, 0)));

export function frameList(scene, step) {
  const out = [];
  for (let f = 0; f < scene.loop_frames; f += Math.max(1, step)) out.push(f);
  return out;
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function makeCanvas(scene) {
  const c = document.createElement('canvas');
  c.width = scene.canvas[0];
  c.height = scene.canvas[1];
  return c;
}

export async function exportGIF(scene, resolve, { step = 1, onProgress = () => {} } = {}) {
  const frames = frameList(scene, step);
  const out = makeCanvas(scene);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const scratch = document.createElement('canvas');
  const [w, h] = scene.canvas;

  // Pass one: what colours are in play.
  const builder = new PaletteBuilder();
  for (let i = 0; i < frames.length; i++) {
    renderFrameTo(out, scene, frames[i], resolve, scratch);
    builder.add(ctx.getImageData(0, 0, w, h).data);
    onProgress(i / frames.length * 0.45, `analizando ${i + 1}/${frames.length}`);
    if (i % 4 === 3) await yieldUI();
  }
  const { palette, map, exact } = builder.finish();

  // Pass two: index and compress each frame as it is drawn.
  const delayCs = Math.max(2, Math.round(100 * step / scene.fps));
  const gif = new GifWriter({ width: w, height: h, palette, delayCs });
  for (let i = 0; i < frames.length; i++) {
    renderFrameTo(out, scene, frames[i], resolve, scratch);
    gif.addFrame(map(ctx.getImageData(0, 0, w, h).data));
    onProgress(0.45 + i / frames.length * 0.55, `codificando ${i + 1}/${frames.length}`);
    if (i % 4 === 3) await yieldUI();
  }
  return { blob: gif.blob(), exact, colors: palette.length, frames: frames.length };
}

export async function exportPNGSequence(scene, resolve, { step = 1, onProgress = () => {} } = {}) {
  const frames = frameList(scene, step);
  const out = makeCanvas(scene);
  const scratch = document.createElement('canvas');
  const files = [];
  for (let i = 0; i < frames.length; i++) {
    renderFrameTo(out, scene, frames[i], resolve, scratch);
    const blob = await new Promise(r => out.toBlob(r, 'image/png'));
    files.push({ name: `${String(i).padStart(4, '0')}.png`,
                 data: new Uint8Array(await blob.arrayBuffer()) });
    onProgress((i + 1) / frames.length, `${i + 1}/${frames.length}`);
    if (i % 4 === 3) await yieldUI();
  }
  return { blob: makeZip(files), frames: files.length };
}

export async function exportFramePNG(scene, resolve, frame) {
  const out = makeCanvas(scene);
  renderFrameTo(out, scene, frame, resolve);
  return new Promise(r => out.toBlob(r, 'image/png'));
}

export function webmSupported() {
  return typeof MediaRecorder !== 'undefined' &&
    (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ||
     MediaRecorder.isTypeSupported('video/webm;codecs=vp8'));
}

/**
 * MediaRecorder timestamps by wall clock, so the loop is played out at its real
 * speed while recording. A 256-frame loop at 60 fps therefore takes 4.3 s.
 */
export async function exportWebM(scene, resolve, { step = 1, onProgress = () => {} } = {}) {
  const frames = frameList(scene, step);
  const out = makeCanvas(scene);
  const scratch = document.createElement('canvas');
  const stream = out.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8';
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12e6 });
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => { rec.onstop = r; });
  rec.start();

  const interval = 1000 * step / scene.fps;
  const t0 = performance.now();
  for (let i = 0; i < frames.length; i++) {
    renderFrameTo(out, scene, frames[i], resolve, scratch);
    track.requestFrame();
    onProgress((i + 1) / frames.length, `grabando ${i + 1}/${frames.length}`);
    const wait = t0 + (i + 1) * interval - performance.now();
    if (wait > 0) await sleep(wait);
  }
  await sleep(120);
  rec.stop();
  await done;
  track.stop();
  return { blob: new Blob(chunks, { type: 'video/webm' }), frames: frames.length };
}
