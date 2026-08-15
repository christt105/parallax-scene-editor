// The export dialog: one card per format, plus the packager that puts a scene
// and the images it uses into a single zip.

import { compact, clone } from '../scene.js';
import { normPath } from '../assets.js';
import { spriteRefs } from '../relink.js';
import { exportGIF, exportPNGSequence, exportWebM, exportFramePNG, download,
         webmSupported, frameList } from '../export/index.js';
import { makeZip } from '../export/zip.js';
import { h, button } from './dom.js';
import { say } from './status.js';
import { openModal } from './modal.js';

/**
 * Everything the scene needs, and nothing else, in one zip: the JSON plus the
 * images it actually points at, under a fixed `assets/` root. Unzip it anywhere
 * and the paths resolve — which is also the shape to hand to someone else.
 */
async function packageScene(app, onProgress = () => {}) {
  const scene = clone(compact(app.store.scene));
  const refs = spriteRefs(app.store.scene);
  const wanted = [...new Set(refs.map(r => r.el.sprite))];
  const files = [];
  const missing = [];

  for (let i = 0; i < wanted.length; i++) {
    const rel = wanted[i];
    onProgress(i / (wanted.length + 1), `${i + 1}/${wanted.length}`);
    const data = await app.assets.readBytes(app.fullPath(rel));
    if (data) files.push({ name: `assets/${normPath(rel)}`, data });
    else missing.push(rel);
  }

  scene.sprite_root = 'assets';
  files.push({
    name: 'scene.json',
    data: new TextEncoder().encode(JSON.stringify(scene, null, 2)),
  });
  onProgress(1, 'compressing');
  return { blob: makeZip(files), missing };
}

export function exportModal(app) {
  const scene = app.store.scene;
  const body = openModal('Export');
  const step = h('input', { type: 'number', min: 1, max: 16, value: 1 });
  const info = h('p.note');
  const bar = h('progress', { value: 0, max: 1, hidden: true });
  const sync = () => {
    const n = frameList(scene, +step.value || 1).length;
    info.textContent = `${n} frames · ${scene.canvas[0]}×${scene.canvas[1]} · ` +
      `${(n / (scene.fps / (+step.value || 1))).toFixed(2)} s`;
  };
  step.addEventListener('input', sync);
  sync();

  const run = async (label, fn, filename) => {
    bar.hidden = false;
    body.querySelectorAll('button').forEach(b => (b.disabled = true));
    try {
      const res = await fn({
        step: +step.value || 1,
        onProgress: (p, text) => { bar.value = p; info.textContent = `${label}: ${text}`; },
      });
      download(res.blob, filename);
      info.textContent = `done · ${(res.blob.size / 1048576).toFixed(1)} MB` +
        (res.exact === false ? ' · palette reduced to 256 colours' : '');
      say(`exported ${filename}`, 'ok');
    } catch (e) {
      info.textContent = `failed: ${e.message}`;
    } finally {
      bar.hidden = true;
      body.querySelectorAll('button').forEach(b => (b.disabled = false));
    }
  };

  const name = scene.name || 'scene';
  body.append(
    h('div.export-grid', {}, [
      h('div.export-card', {}, [
        h('h3', { text: 'GIF' }),
        h('p', { text: 'A loop ready to share. Exact palette if the scene fits in 256 colours.' }),
        button('Export GIF', () => run('GIF',
          o => exportGIF(scene, app.resolve, o), `${name}.gif`), 'accent'),
      ]),
      h('div.export-card', {}, [
        h('h3', { text: 'WebM' }),
        h('p', { text: webmSupported()
          ? 'Video with no colour limit. Recorded in real time, so it takes as long as the loop.'
          : 'This browser does not support it.' }),
        button('Export WebM', () => run('WebM',
          o => exportWebM(scene, app.resolve, o), `${name}.webm`), webmSupported() ? '' : 'ghost'),
      ]),
      h('div.export-card', {}, [
        h('h3', { text: 'PNG (zip)' }),
        h('p', { text: 'One file per frame, to assemble with ffmpeg or open in Aseprite.' }),
        button('Export PNG', () => run('PNG',
          o => exportPNGSequence(scene, app.resolve, o), `${name}_frames.zip`)),
      ]),
      h('div.export-card', {}, [
        h('h3', { text: 'Current frame' }),
        h('p', { text: `A single PNG of frame ${app.frame}.` }),
        button('Save PNG', async () => {
          const blob = await exportFramePNG(scene, app.resolve, app.frame);
          download(blob, `${name}_f${app.frame}.png`);
        }),
      ]),
      h('div.export-card', {}, [
        h('h3', { text: 'Package scene' }),
        h('p', { text: 'The JSON with the images it uses, and only those, under assets/. ' +
                       'Unzip it anywhere and the paths still resolve.' }),
        button('Package (zip)', () => run('Packaging', async o => {
          const res = await packageScene(app, o.onProgress);
          if (res.missing.length) {
            say(`packaged without ${res.missing.length} image(s) that cannot be found: ` +
                res.missing.slice(0, 3).join(', '), 'err');
          }
          return res;
        }, `${name}_project.zip`)),
      ]),
    ]),
    h('div.modal-actions', {}, [
      h('label.field', {}, [h('span.field-label', { text: 'Keep 1 frame in every' }), step]),
    ]),
    info, bar,
  );
  if (!webmSupported()) body.querySelectorAll('.export-card button')[1].disabled = true;
}
