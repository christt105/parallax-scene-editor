// The asset panel: the grid of images that are loaded, the preview that follows
// the pointer over it, and the picker the outliner and the inspector open.

import { h, $, clear, place } from './dom.js';
import { guessFrames } from '../assets.js';
import { ACTOR_DEFAULTS, LAYER_DEFAULTS, clone } from '../scene.js';
import { say } from './status.js';
import { openModal, closeModal } from './modal.js';

function assetCard(app, path, onclick) {
  // Asking for the image also starts loading it; when it lands the library
  // fires onChange and the grid is drawn again with the thumbnail in place.
  const img = app.assets.get(path);
  return h('div.asset', {
    onclick: () => onclick(path),
    title: path,
    onpointerenter: e => showPreview(app, path, e),
    onpointerleave: hidePreview,
  }, [
    // draggable images would start a native file drag that the window's own
    // drop handler then treats as somebody loading a new project
    h('img', { src: img ? img.src : '', alt: '', draggable: false }),
    h('span', { text: path }),
  ]);
}

// -------------------------------------------------------- hover preview --

function showPreview(app, path, ev) {
  const img = app.assets.get(path);
  const box = $('#asset-preview');
  if (!img) { box.hidden = true; return; }   // still loading; the next hover shows it

  const w = img.naturalWidth, hgt = img.naturalHeight;
  // blow small sprites up by a whole number so the pixels stay square
  const scale = Math.max(1, Math.floor(Math.min(360 / w, 300 / hgt)));
  clear(box);
  box.append(
    h('img', { src: img.src, draggable: false,
               style: { width: `${Math.min(360, w * scale)}px` } }),
    h('span.preview-name', { text: path }),
    h('span.preview-size', { text: `${w} × ${hgt} px` }),
  );
  box.hidden = false;
  place(box, ev.clientX + 18, ev.clientY + 18);
}

function hidePreview() {
  $('#asset-preview').hidden = true;
}

// ----------------------------------------------------------------- grid --

let assetRenderQueued = false;
export function scheduleAssetRender(app) {
  if (assetRenderQueued) return;
  assetRenderQueued = true;
  setTimeout(() => { assetRenderQueued = false; renderAssets(app); }, 180);
}

const ASSET_PAGE = 200;

export function renderAssets(app) {
  const list = $('#asset-list');
  const filter = $('#asset-filter').value.trim();
  clear(list);
  const paths = app.assets.paths(filter).filter(p => !p.endsWith('.json'));
  $('#asset-empty').hidden = paths.length > 0;
  const note = $('#asset-count');
  note.hidden = paths.length <= ASSET_PAGE;
  note.textContent = `showing ${ASSET_PAGE} of ${paths.length} · type above to narrow it down`;
  for (const path of paths.slice(0, ASSET_PAGE)) {
    list.append(assetCard(app, path, p => {
      if (app.selection.kind !== 'scene') {
        const root = app.store.scene.sprite_root
          ? app.store.scene.sprite_root.replace(/\/+$/, '') + '/' : '';
        app.edit('sprite', o => { o.sprite = p.startsWith(root) ? p.slice(root.length) : p; });
        say('sprite assigned', 'ok');
      } else {
        insertFromAsset(app, 'actor', p);
      }
    }));
  }
}

export function pickAsset(app, current, onPick) {
  const body = openModal('Pick an image');
  const grid = h('div.assets', { style: { maxHeight: '52vh' } });
  const filter = h('input', { type: 'search', placeholder: 'filter…' });
  const fill = () => {
    clear(grid);
    for (const path of app.assets.paths(filter.value).filter(p => !p.endsWith('.json')).slice(0, 400)) {
      grid.append(assetCard(app, path, p => { onPick(p); closeModal(); }));
    }
    if (!grid.children.length) grid.append(h('p.note', { text: 'no images loaded' }));
  };
  filter.addEventListener('input', fill);
  fill();
  body.append(filter, grid);
}

export async function insertFromAsset(app, kind, path) {
  const scene = app.store.scene;
  const root = scene.sprite_root ? scene.sprite_root.replace(/\/+$/, '') + '/' : '';
  const rel = path.startsWith(root) ? path.slice(root.length) : path;
  const name = rel.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  const img = app.assets.get(path);
  let index;
  if (kind === 'layer') {
    const depth = Math.min(-100, ...scene.layers.map(l => l.depth)) - 10;
    app.store.commit(null, s => {
      s.layers.push({ ...clone(LAYER_DEFAULTS), name, sprite: rel, depth,
                      y: 0, speed: 0, repeat: 'x' });
    });
    index = app.store.scene.layers.length - 1;
  } else {
    const frames = img ? await guessFrames(img) : 1;
    const depth = Math.max(0, ...scene.actors.map(a => a.depth)) + 10;
    app.store.commit(null, s => {
      const [vw, vh] = [Math.ceil(s.canvas[0] / s.zoom), Math.ceil(s.canvas[1] / s.zoom)];
      s.actors.push({ ...clone(ACTOR_DEFAULTS), name, sprite: rel, frames, depth,
                      x: Math.round(vw / 2), y: (s.world_height || vh) - 8 });
    });
    index = app.store.scene.actors.length - 1;
  }
  app.select(kind, index);
  say(`added ${rel}`, 'ok');
}
