// Wiring: the app object every panel talks to, plus the project, file and
// export plumbing around it.

import { defaultScene, compact, loopWarnings, ACTOR_DEFAULTS, LAYER_DEFAULTS, clone } from './scene.js';
import { Store } from './store.js';
import { AssetLibrary, normPath, guessFrames } from './assets.js';
import { planRelink, applyRelink, missingRefs, joinRoot, spriteRefs } from './relink.js';
import { Stage } from './ui/stage.js';
import { Timeline } from './ui/timeline.js';
import { renderInspector } from './ui/inspector.js';
import { h, $, clear, button, place } from './ui/dom.js';
import * as storage from './storage.js';
import { DiskAutosave, SAVING, PENDING, SAVED, ERROR } from './autosave.js';
import { exportGIF, exportPNGSequence, exportWebM, exportFramePNG, download, webmSupported, frameList } from './export/index.js';
import { makeZip } from './export/zip.js';

const DEMO = 'demo';

const app = {
  store: new Store(defaultScene()),
  assets: null,
  selection: { kind: 'scene', index: -1 },
  selKey: -1,
  frame: 0,
  playing: false,
  suppressInspector: false,
  scenePath: null,
  lastTick: 0,
};

// --------------------------------------------------------------- helpers --

app.resolve = path => (path ? app.assets.get(joinRoot(app.store.scene.sprite_root, path)) : null);
app.fullPath = path => joinRoot(app.store.scene.sprite_root, path);
app.hasAsset = path => app.assets.entries.has(normPath(app.fullPath(path)));
app.missingCount = () => missingRefs(app.store.scene, [...app.assets.entries.keys()]).length;

/** A layer's tiling period when it did not name one: the image's own width. */
app.periodOf = layer => {
  const img = app.resolve(layer.sprite);
  return img ? img.naturalWidth : 0;
};

/** Point the scene's paths back at the files that are actually loaded. */
app.relink = () => {
  const paths = [...app.assets.entries.keys()];
  const plan = planRelink(app.store.scene, paths);
  if (plan.kind === 'none') {
    return say(plan.missing
      ? `cannot find ${plan.missing} of the images: load them or pick them by hand`
      : 'every image in the scene is accounted for', plan.missing ? 'err' : 'ok');
  }
  app.store.commit(null, scene => applyRelink(scene, plan));
  const left = app.missingCount();
  say(plan.kind === 'prefix'
    ? `paths repaired: the asset root is now «${plan.prefix}»`
    : `${plan.fixes.length} path(s) repaired${left ? `, ${left} still unresolved` : ''}`,
    left ? 'err' : 'ok');
  markPanels();
};

/**
 * The status line. `auto` marks messages the editor writes on its own (the
 * loop-cycle warnings), so they can be replaced freely without stepping on
 * something the user's own action just reported.
 */
let saidAt = 0;
function say(msg, kind = '', auto = false) {
  const node = $('#status');
  clear(node);
  node.className = kind;
  node.dataset.auto = auto ? '1' : '0';
  if (!auto) saidAt = performance.now();
  node.append(typeof msg === 'string' ? document.createTextNode(msg) : msg);
}

function selected() {
  const { kind, index } = app.selection;
  if (kind === 'actor') return app.store.scene.actors[index];
  if (kind === 'layer') return app.store.scene.layers[index];
  return null;
}

/**
 * Panels redraw on a timeout rather than on the animation frame: a background
 * tab stops compositing, and an editor whose inspector freezes when you switch
 * windows is an editor that loses your edits.
 */
let panelsQueued = false;
function markPanels() {
  if (panelsQueued) return;
  panelsQueued = true;
  setTimeout(() => {
    panelsQueued = false;
    syncPanels();
    autosave({
      scene: app.store.scene,
      name: $('#scene-name').value,
      path: app.scenePath,
      source: app.assets.mode,
    });
    requestDiskSave();
  }, 0);
}

// -------------------------------------------------------- disk autosave --

const sceneText = () => JSON.stringify(compact(app.store.scene), null, 2);

/**
 * Mirror the edit onto the disk, when there is a disk to mirror it onto.
 *
 * Deliberately only ever writes a file the user already pointed at — one they
 * opened from the folder, or one an explicit *Save* created. Inventing
 * `scene.json` inside somebody's art folder because they nudged a sprite is a
 * surprise, and a folder picked for reading is not consent to be written into.
 */
function requestDiskSave() {
  if (app.disk.enabled && app.assets.canWrite && app.scenePath && app.store.dirty) {
    // An edit that lands back on the bytes already written — undo, a value typed
    // and retyped — is nothing to write, and nothing to warn about on the way out.
    if (!app.disk.request(app.scenePath, sceneText()) && app.disk.clean) {
      app.store.dirty = false;
    }
  }
  syncSaveState();
}

function syncSaveState() {
  const pill = $('#save-state');
  const chk = $('#chk-autosave');
  const disk = app.disk;
  chk.checked = disk.enabled;
  chk.disabled = !app.assets.canWrite;

  let text, cls = 'pill save-state', title = '';
  if (!app.assets.canWrite) {
    text = 'browser only';
    title = app.assets.count
      ? 'these files are read-only; open a folder to write to disk'
      : 'open a folder and the scene will save itself to disk';
    cls += ' muted';
  } else if (disk.state === ERROR) {
    text = `autosave stopped: ${disk.error?.message || 'the write failed'}`;
    title = 'tick «auto» again to retry';
    cls += ' bad';
  } else if (!disk.enabled) {
    text = app.store.dirty ? 'unsaved' : 'auto off';
    title = 'autosave to disk is off; Ctrl+S saves';
    cls += app.store.dirty ? ' bad' : ' muted';
  } else if (!app.scenePath) {
    text = 'no file yet · press Save';
    title = 'the scene has no file in the folder yet; save it once and ' +
            'every change after that goes on its own';
    cls += ' bad';
  } else if (disk.state === SAVING || disk.state === PENDING) {
    text = `saving ${app.scenePath}…`;
    cls += ' muted';
  } else {
    text = `↳ ${app.scenePath}`;
    title = `every change is written to ${app.assets.label}/${app.scenePath}`;
  }
  pill.className = cls;
  pill.textContent = text;
  pill.title = title;
}

// ------------------------------------------------------------- app verbs --

app.select = (kind, index = -1, key = -1) => {
  app.suppressInspector = false;
  app.selection = { kind, index };
  app.selKey = key;
  markPanels();
};

app.setFrame = f => {
  const loop = app.store.scene.loop_frames;
  app.frame = ((Math.round(f) % loop) + loop) % loop;
  $('#scrub').value = app.frame;
  syncFrameLabel();
  app.timeline.syncPlayhead();
  // Playback moves the frame sixty times a second. Rebuilding the panels along
  // with it would throw away the row you are reaching for and the field you are
  // typing in, so while it plays only the three things above move; the rest
  // catches up as soon as it is paused.
  if (!app.playing) markPanels();
};

app.pause = () => { app.playing = false; syncPlayButton(); };
app.togglePlay = () => { app.playing = !app.playing; app.lastTick = performance.now(); syncPlayButton(); };

/** Edit the selected layer or actor as one undo step. */
app.edit = (label, fn) => {
  const { kind, index } = app.selection;
  if (kind === 'scene') return;
  app.editIndex(kind, index, label, fn);
};

app.editIndex = (kind, index, label, fn) => {
  app.suppressInspector = false;
  app.store.commit(label ? `${kind}:${index}:${label}` : null, scene => {
    const list = kind === 'layer' ? scene.layers : scene.actors;
    if (list[index]) fn(list[index], scene);
  });
  markPanels();
};

/**
 * An edit typed into the inspector itself. Same as `edit`, except the panel is
 * left alone afterwards: rebuilding it would pull the caret out of the field
 * being typed in and drop the pointer half way through a slider drag.
 */
app.editUI = (label, fn) => {
  app.edit(label, fn);
  app.suppressInspector = true;
};

app.editScene = (key, value) => {
  app.store.commit(`scene:${key}`, scene => { scene[key] = value; });
  app.suppressInspector = true;   // typed in the panel: leave the caret alone
  if (key === 'loop_frames') {
    $('#scrub').max = Math.max(0, app.store.scene.loop_frames - 1);
    app.setFrame(Math.min(app.frame, app.store.scene.loop_frames - 1));
  }
  if (key === 'canvas' || key === 'zoom') app.stage.layout();
  markPanels();
};

app.nearestKeyIndex = actorIndex => {
  const a = app.store.scene.actors[actorIndex];
  if (!a || !a.keys || !a.keys.length) return -1;
  let best = 0, d = Infinity;
  a.keys.forEach((k, i) => {
    const dist = Math.abs(k.f - app.frame);
    if (dist < d) { d = dist; best = i; }
  });
  return best;
};

app.moveActor = (index, x, y) => {
  app.editIndex('actor', index, 'move', a => {
    if (a.keys && a.keys.length) {
      const k = app.selKey >= 0 ? app.selKey : app.nearestKeyIndex(index);
      a.keys[k].x = Math.round(x);
      a.keys[k].y = Math.round(y);
    } else {
      a.x = Math.round(x);
      a.y = Math.round(y);
    }
  });
};

app.moveKey = (actorIndex, keyIndex, f) => {
  app.editIndex('actor', actorIndex, 'keyframe', a => {
    a.keys[keyIndex].f = f;
    const moved = a.keys[keyIndex];
    a.keys.sort((p, q) => p.f - q.f);
    app.selKey = a.keys.indexOf(moved);
  });
  app.setFrame(f);
};

app.addKey = () => {
  if (app.selection.kind !== 'actor') return say('pick an actor first', 'err');
  const index = app.selection.index;
  const f = app.frame;
  app.editIndex('actor', index, null, (a, scene) => {
    const from = a.keys && a.keys.length
      ? sampleAt(a, f, scene.loop_frames)
      : [a.x || 0, a.y || 0];
    a.keys = (a.keys || []).filter(k => k.f !== f)
      .concat([{ f, x: Math.round(from[0]), y: Math.round(from[1]), ease: 'in-out' }])
      .sort((p, q) => p.f - q.f);
    delete a.x; delete a.y;
  });
  const a = app.store.scene.actors[index];
  app.selKey = a.keys.findIndex(k => k.f === f);
  say(`key at frame ${f}`, 'ok');
};

app.deleteKey = () => {
  if (app.selection.kind !== 'actor' || app.selKey < 0) return;
  const index = app.selection.index;
  const at = app.selKey;
  app.editIndex('actor', index, null, a => {
    if (!a.keys) return;
    const last = a.keys[at];
    a.keys.splice(at, 1);
    if (!a.keys.length) { a.keys = null; a.x = last.x; a.y = last.y; }
  });
  app.selKey = -1;
};

app.duplicate = () => {
  const { kind, index } = app.selection;
  if (kind === 'scene') return;
  app.store.commit(null, scene => {
    const list = kind === 'layer' ? scene.layers : scene.actors;
    const copy = clone(list[index]);
    copy.name = `${copy.name} copy`;
    list.splice(index + 1, 0, copy);
  });
  app.select(kind, index + 1);
};

app.remove = () => {
  const { kind, index } = app.selection;
  if (kind === 'scene') return;
  app.store.commit(null, scene => {
    (kind === 'layer' ? scene.layers : scene.actors).splice(index, 1);
  });
  app.select('scene');
};

app.refresh = markPanels;

app.detectFrames = async () => {
  const a = selected();
  if (!a) return;
  const img = app.resolve(a.sprite);
  if (!img) return say('the image has not loaded yet', 'err');
  const n = await guessFrames(img);
  app.edit('frames', o => { o.frames = n; });
  say(`${n} frame(s) detected in ${a.sprite}`, 'ok');
};

function sampleAt(actor, f, loop) {
  const ks = actor.keys.slice().sort((p, q) => p.f - q.f);
  if (ks.length === 1) return [ks[0].x, ks[0].y];
  const ring = ks.concat([{ ...ks[0], f: ks[0].f + loop }]);
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    if (a.f <= f && f < b.f) {
      const t = (f - a.f) / (b.f - a.f || 1);
      return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
    }
  }
  return [ks[0].x, ks[0].y];
}

// -------------------------------------------------------------- outliner --

function outlinerRow(kind, index, item) {
  const selectedRow = app.selection.kind === kind && app.selection.index === index;
  const img = app.resolve(item.sprite);
  const thumb = h('canvas.thumb', { width: 22, height: 16 });
  if (img) {
    const c = thumb.getContext('2d');
    c.imageSmoothingEnabled = false;
    const s = Math.min(22 / img.naturalWidth, 16 / img.naturalHeight);
    c.drawImage(img, 0, 0, img.naturalWidth * s, img.naturalHeight * s);
  }
  return h(`li.${kind}` + (selectedRow ? '.sel' : '') + (item.visible === false ? '.hidden' : ''), {
    onclick: () => { app.select(kind, index, kind === 'actor' ? app.nearestKeyIndex(index) : -1); },
    draggable: true,
    ondragstart: e => e.dataTransfer.setData('text/plain', `${kind}:${index}`),
    ondragover: e => e.preventDefault(),
    ondrop: e => {
      e.preventDefault();
      const [k, from] = e.dataTransfer.getData('text/plain').split(':');
      if (k !== kind) return;
      app.store.commit(null, scene => {
        const list = kind === 'layer' ? scene.layers : scene.actors;
        const [moved] = list.splice(+from, 1);
        list.splice(index, 0, moved);
      });
      app.select(kind, index);
    },
  }, [
    thumb,
    h('span.nm', { text: item.name || item.sprite || '(unnamed)' }),
    h('span.tag', { text: kind === 'layer' ? `v${item.speed}` : (item.keys ? `${item.keys.length}k` : 'fixed') }),
    h('button.eye', {
      title: 'show / hide',
      text: item.visible === false ? '○' : '●',
      onclick: e => {
        e.stopPropagation();
        app.editIndex(kind, index, null, o => { o.visible = o.visible === false; });
      },
    }),
  ]);
}

function renderOutliner() {
  const scene = app.store.scene;
  const layers = $('#outliner-layers');
  const actors = $('#outliner-actors');
  clear(layers); clear(actors);
  scene.layers.forEach((l, i) => layers.append(outlinerRow('layer', i, l)));
  scene.actors.forEach((a, i) => actors.append(outlinerRow('actor', i, a)));
  layers.append(h('li.add-row', {}, [
    button('+ layer', () => addFromAsset('layer'), 'slim'),
  ]));
  actors.append(h('li.add-row', {}, [
    button('+ actor', () => addFromAsset('actor'), 'slim'),
  ]));
}

function addFromAsset(kind) {
  pickAsset(null, path => insertFromAsset(kind, path));
}

async function insertFromAsset(kind, path) {
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

// ---------------------------------------------------------- asset browser --

function assetCard(path, onclick) {
  // Asking for the image also starts loading it; when it lands the library
  // fires onChange and the grid is drawn again with the thumbnail in place.
  const img = app.assets.get(path);
  return h('div.asset', {
    onclick: () => onclick(path),
    title: path,
    onpointerenter: e => showPreview(path, e),
    onpointerleave: hidePreview,
  }, [
    // draggable images would start a native file drag that the window's own
    // drop handler then treats as somebody loading a new project
    h('img', { src: img ? img.src : '', alt: '', draggable: false }),
    h('span', { text: path }),
  ]);
}

// -------------------------------------------------------- hover preview --

let previewFor = null;

function showPreview(path, ev) {
  const img = app.assets.get(path);
  const box = $('#asset-preview');
  previewFor = path;
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
  previewFor = null;
  $('#asset-preview').hidden = true;
}

let assetRenderQueued = false;
function scheduleAssetRender() {
  if (assetRenderQueued) return;
  assetRenderQueued = true;
  setTimeout(() => { assetRenderQueued = false; renderAssets(); }, 180);
}

const ASSET_PAGE = 200;

function renderAssets() {
  const list = $('#asset-list');
  const filter = $('#asset-filter').value.trim();
  clear(list);
  const paths = app.assets.paths(filter).filter(p => !p.endsWith('.json'));
  $('#asset-empty').hidden = paths.length > 0;
  const note = $('#asset-count');
  note.hidden = paths.length <= ASSET_PAGE;
  note.textContent = `showing ${ASSET_PAGE} of ${paths.length} · type above to narrow it down`;
  for (const path of paths.slice(0, ASSET_PAGE)) {
    list.append(assetCard(path, p => {
      if (app.selection.kind !== 'scene') {
        const root = app.store.scene.sprite_root
          ? app.store.scene.sprite_root.replace(/\/+$/, '') + '/' : '';
        app.edit('sprite', o => { o.sprite = p.startsWith(root) ? p.slice(root.length) : p; });
        say('sprite assigned', 'ok');
      } else {
        insertFromAsset('actor', p);
      }
    }));
  }
}

function pickAsset(current, onPick) {
  const body = openModal('Pick an image');
  const grid = h('div.assets', { style: { maxHeight: '52vh' } });
  const filter = h('input', { type: 'search', placeholder: 'filter…' });
  const fill = () => {
    clear(grid);
    for (const path of app.assets.paths(filter.value).filter(p => !p.endsWith('.json')).slice(0, 400)) {
      grid.append(assetCard(path, p => { onPick(p); closeModal(); }));
    }
    if (!grid.children.length) grid.append(h('p.note', { text: 'no images loaded' }));
  };
  filter.addEventListener('input', fill);
  fill();
  body.append(filter, grid);
}
app.pickAsset = pickAsset;

// ---------------------------------------------------------------- modals --

function openModal(title) {
  const dlg = $('#modal');
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  clear(body);
  if (!dlg.open) dlg.showModal();
  return body;
}
function closeModal() { $('#modal').close(); }

// ------------------------------------------------------------- project ---

async function openFolder(handle = null) {
  try {
    await app.assets.openFolder(handle);
    await storage.set('dir', app.assets.dirHandle);
    syncProjectLabel();
    say(`folder «${app.assets.label}»: ${app.assets.count} files` +
        (app.assets.truncated ? ' (cap reached: there are more unread)' : ''), 'ok');
    if (app.missingCount()) app.relink();
    const scenes = app.assets.sceneFiles();
    if (scenes.length && !app.scenePath) offerScenes(scenes);
    else if (app.scenePath) {
      // Reconnecting to the folder the session came from: the scene in the tab
      // is the newer of the two, so let it flow back down to its file.
      requestDiskSave();
    }
  } catch (e) {
    say(e.message || 'the folder could not be opened', 'err');
  }
}

function syncProjectLabel() {
  const label = $('#project-label');
  label.hidden = !app.assets.label;
  label.textContent = app.assets.label
    ? `${app.assets.label} · ${app.assets.count} files${app.assets.canWrite ? '' : ' (read-only)'}`
    : '';
  $('#btn-save').textContent = app.assets.canWrite ? 'Save' : 'Download';
  syncSaveState();
}

function offerScenes(scenes) {
  const body = openModal('Scenes found in the folder');
  body.append(
    h('p.note', { text: 'Open one to carry on working on it.' }),
    h('ul.scene-list', {}, scenes.map(p =>
      h('li', { text: p, onclick: () => { closeModal(); loadScene(p); } }))),
  );
}

async function loadScene(path) {
  const text = await app.assets.readText(path);
  if (!text) return say(`could not read ${path}`, 'err');
  try {
    const data = JSON.parse(text);
    app.store.replace(data);
    app.scenePath = path;
    app.store.dirty = false;
    // What we would write for this scene is now what the file holds, near
    // enough: no edit yet, so nothing goes back to disk until there is one.
    app.disk.seed(path, sceneText());
    $('#scene-name').value = (data.name || path.split('/').pop().replace(/\.json$/, ''));
    app.select('scene');
    app.setFrame(0);
    app.stage.layout();
    say(`opened ${path}`, 'ok');
    // a scene saved next to its sprites and a folder opened higher up disagree
    // about where everything is; this is the moment to reconcile them
    if (app.missingCount()) app.relink();
  } catch (e) {
    say(`invalid JSON in ${path}: ${e.message}`, 'err');
  }
}

async function saveScene() {
  const name = ($('#scene-name').value || 'scene').replace(/[^A-Za-z0-9_-]/g, '');
  app.store.commit(null, s => { s.name = name; });
  const text = sceneText();
  if (app.assets.canWrite) {
    const dir = app.scenePath && app.scenePath.includes('/')
      ? app.scenePath.slice(0, app.scenePath.lastIndexOf('/') + 1) : '';
    const path = `${dir}${name}.json`;
    try {
      await app.assets.writeText(path, text);
      app.scenePath = path;
      app.store.dirty = false;
      app.disk.seed(path, text);      // and from here on it keeps itself up to date
      renderAssets();
      say(`saved to ${app.assets.label}/${path}` +
          (app.disk.enabled ? ' · every change after this one saves itself' : ''), 'ok');
      return;
    } catch (e) {
      return say(`the write failed: ${e.message}`, 'err');
    }
  }
  download(new Blob([text], { type: 'application/json' }), `${name}.json`);
  app.store.dirty = false;
  syncSaveState();
  say('downloaded (open a folder to save to disk)', 'ok');
}

/**
 * Everything the scene needs, and nothing else, in one zip: the JSON plus the
 * images it actually points at, under a fixed `assets/` root. Unzip it anywhere
 * and the paths resolve — which is also the shape to hand to someone else.
 */
async function packageScene(onProgress = () => {}) {
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
  onProgress(1, 'comprimiendo');
  return { blob: makeZip(files), count: files.length - 1, missing };
}

// ---------------------------------------------------------------- export --

function exportModal() {
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
          const res = await packageScene(o.onProgress);
          if (res.missing.length) {
            say(`packaged without ${res.missing.length} image(s) that cannot be found: ` +
                res.missing.slice(0, 3).join(', '), 'err');
          }
          return res;
        }, `${name}_proyecto.zip`)),
      ]),
    ]),
    h('div.modal-actions', {}, [
      h('label.field', {}, [h('span.field-label', { text: 'Keep 1 frame in every' }), step]),
    ]),
    info, bar,
  );
  if (!webmSupported()) body.querySelectorAll('.export-card button')[1].disabled = true;
}

// ------------------------------------------------------------ json panel --

function jsonModal() {
  const body = openModal('Scene JSON');
  const area = h('textarea', { spellcheck: false, class: 'mono',
                               value: JSON.stringify(compact(app.store.scene), null, 2) });
  const note = h('p.note');
  body.append(area, h('div.modal-actions', {}, [
    button('Apply', () => {
      try {
        const next = JSON.parse(area.value);
        app.store.replace(next);
        app.select('scene');
        app.stage.layout();
        note.textContent = 'applied';
        note.className = 'note ok';
        markPanels();
      } catch (e) {
        note.textContent = `invalid JSON: ${e.message}`;
        note.className = 'note warn';
      }
    }, 'accent'),
    button('Copy', async () => {
      try { await navigator.clipboard.writeText(area.value); note.textContent = 'copied'; }
      catch { note.textContent = 'copy it by hand: the browser would not allow it'; }
    }),
    button('Download', () => download(new Blob([area.value], { type: 'application/json' }),
                                       `${app.store.scene.name || 'scene'}.json`)),
    button('Load file…', () => {
      const input = h('input', { type: 'file', accept: '.json' });
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        area.value = await file.text();
      };
      input.click();
    }),
  ]), note);
}

function helpModal() {
  const body = openModal('Shortcuts');
  const rows = [
    ['Space', 'play / pause'],
    ['← →', 'previous / next frame (with Shift, ten at a time)'],
    ['Alt + arrows', 'move the selected actor 1 px (with Shift, 8 px)'],
    ['K', 'add a key at the current frame'],
    ['Del', 'delete the selected key'],
    ['D', 'duplicate the selection'],
    ['G / O', 'grid / onion skin'],
    ['Ctrl+Z · Ctrl+Shift+Z', 'undo / redo'],
    ['Ctrl+S', 'save the scene'],
    ['Drag on the canvas', 'place the actor (Shift snaps to 8 px)'],
    ['Double click on the timeline', 'create a key there'],
  ];
  body.append(
    h('div.help-grid', {}, rows.flatMap(([k, v]) => [h('span.kbd', { text: k }), h('span', { text: v })])),
    h('p.note', { html: 'The scene format and the workflow are in the ' +
      '<a href="https://github.com/christt105/parallax-scene-editor#readme" target="_blank" rel="noopener">README</a>.' }),
  );
}

// ------------------------------------------------------------- shortcuts --

function bindKeys() {
  addEventListener('keydown', ev => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const mod = ev.ctrlKey || ev.metaKey;

    if (mod && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      return saveScene();
    }
    if (mod && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      const ok = ev.shiftKey ? app.store.redo() : app.store.undo();
      if (ok) { app.selKey = -1; markPanels(); }
      return;
    }
    if (typing) return;

    const bump = ev.shiftKey ? 10 : 1;
    switch (ev.key) {
      case ' ': ev.preventDefault(); app.togglePlay(); break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        ev.preventDefault();
        const dir = ev.key === 'ArrowRight' ? 1 : -1;
        if (ev.altKey) nudge(dir * (ev.shiftKey ? 8 : 1), 0);
        else { app.pause(); app.setFrame(app.frame + dir * bump); }
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown':
        if (ev.altKey) { ev.preventDefault(); nudge(0, (ev.key === 'ArrowDown' ? 1 : -1) * (ev.shiftKey ? 8 : 1)); }
        break;
      case 'k': case 'K': app.addKey(); break;
      case 'Delete': case 'Backspace': app.deleteKey(); break;
      case 'd': case 'D': app.duplicate(); break;
      case 'g': case 'G': $('#chk-grid').click(); break;
      case 'o': case 'O': $('#chk-onion').click(); break;
    }
  });
}

function nudge(dx, dy) {
  const { kind, index } = app.selection;
  if (kind === 'actor') {
    const a = app.store.scene.actors[index];
    const k = a.keys && a.keys.length ? (app.selKey >= 0 ? app.selKey : app.nearestKeyIndex(index)) : -1;
    const base = k >= 0 ? [a.keys[k].x, a.keys[k].y] : [a.x, a.y];
    app.moveActor(index, base[0] + dx, base[1] + dy);
  } else if (kind === 'layer') {
    app.editIndex('layer', index, 'nudge', l => { l.y += dy; });
  }
}

// ------------------------------------------------------------ drag & drop --

function bindDrop() {
  const veil = $('#drop-veil');
  let hideTimer = null;

  // A drag that started inside the page — an asset thumbnail, an outliner row —
  // can still arrive at the window's drop handler carrying a File, and loading
  // that one image as if it were a new project is not what anybody meant.
  let internal = false;
  addEventListener('dragstart', () => { internal = true; }, true);
  addEventListener('dragend', () => { internal = false; }, true);

  // dragenter/dragleave fire once per element the pointer crosses, so counting
  // them drifts out of balance the moment one of them is missed. `dragover`
  // repeats for as long as the drag is over the window, so a short watchdog
  // says exactly when it stopped.
  const hide = () => { clearTimeout(hideTimer); hideTimer = null; veil.hidden = true; };
  addEventListener('dragover', e => {
    if (internal || ![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    veil.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 220);
  });
  addEventListener('dragend', hide);

  addEventListener('drop', async e => {
    hide();
    if (internal) { internal = false; return; }
    e.preventDefault();
    const had = app.assets.count;
    const n = await app.assets.adoptDrop(e.dataTransfer);
    syncProjectLabel();
    if (!n) return say('no images in what you dropped', 'err');
    say(had ? `${n} file(s) added to the ${had} already loaded`
            : `${n} files loaded (read-only)`, 'ok');
    if (app.missingCount()) app.relink();
    const scenes = app.assets.sceneFiles();
    if (!had && scenes.length) offerScenes(scenes);
  });
}

// ------------------------------------------------------------------ loop --

function syncPlayButton() { $('#btn-play').textContent = app.playing ? '⏸' : '⏵'; }
function syncFrameLabel() {
  $('#frame-label').textContent = `${app.frame} / ${app.store.scene.loop_frames - 1}`;
}

function syncPanels() {
  renderOutliner();
  const skipInspector = app.suppressInspector;
  app.suppressInspector = false;
  if (!skipInspector) renderInspector($('#right'), app);
  app.timeline.render();
  $('#btn-undo').disabled = !app.store.canUndo;
  $('#btn-redo').disabled = !app.store.canRedo;

  const node = $('#status');
  const mine = node.dataset.auto === '1';
  const warnings = loopWarnings(app.store.scene, app.periodOf);
  // A reply to something the user just did gets a few seconds of the line to
  // itself; after that a loop that will not close is the more useful news, and
  // it used to sit behind the greeting for as long as the tab stayed open.
  const free = mine || !node.textContent || performance.now() - saidAt > 4000;
  if (warnings.length && free) say(warnings[0].text, 'err', true);
  else if (!warnings.length && mine) say('');
}

const autosave = storage.debounced('autosave');

function tick(t) {
  if (app.playing) {
    const interval = 1000 / app.store.scene.fps;
    if (t - app.lastTick >= interval) {
      const steps = Math.min(4, Math.floor((t - app.lastTick) / interval));
      app.lastTick += steps * interval;
      app.setFrame(app.frame + steps);
    }
  }
  app.stage.draw();
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ boot --

function bindToolbar() {
  $('#btn-project').onclick = () => {
    if (AssetLibrary.supportsFolder) return openFolder();
    $('#file-input').webkitdirectory = true;
    $('#file-input').click();
  };
  $('#btn-drop').onclick = () => {
    $('#file-input').webkitdirectory = false;
    $('#file-input').click();
  };
  $('#file-input').onchange = e => {
    const n = app.assets.adoptFiles(e.target.files);
    syncProjectLabel();
    say(n ? `${n} files loaded (read-only)` : 'no images found', n ? 'ok' : 'err');
    e.target.value = '';
  };
  $('#btn-save').onclick = saveScene;
  $('#btn-open-scene').onclick = () => {
    const scenes = app.assets.sceneFiles();
    if (!scenes.length) return say('no .json files in the loaded folder', 'err');
    offerScenes(scenes);
  };
  $('#btn-new').onclick = () => {
    if (app.store.dirty && !confirm('There are unsaved changes. Start a new scene?')) return;
    app.store.replace(defaultScene());
    app.scenePath = null;
    app.store.dirty = false;
    app.disk.reset();
    app.select('scene');
    app.setFrame(0);
    app.stage.layout();
  };
  $('#btn-undo').onclick = () => { app.store.undo(); app.selKey = -1; markPanels(); };
  $('#btn-redo').onclick = () => { app.store.redo(); app.selKey = -1; markPanels(); };
  $('#btn-json').onclick = jsonModal;
  $('#btn-export').onclick = exportModal;
  $('#btn-help').onclick = helpModal;
  $('#btn-scene-props').onclick = () => app.select('scene');
  $('#btn-refresh-assets').onclick = () => { app.assets.refresh(); renderAssets(); say('images reloaded', 'ok'); };
  $('#asset-filter').addEventListener('input', renderAssets);
  $('#modal-close').onclick = closeModal;

  $('#btn-play').onclick = app.togglePlay;
  $('#btn-prev').onclick = () => { app.pause(); app.setFrame(app.frame - 1); };
  $('#btn-next').onclick = () => { app.pause(); app.setFrame(app.frame + 1); };
  $('#scrub').addEventListener('input', e => { app.pause(); app.setFrame(+e.target.value); });
  $('#chk-grid').onchange = e => { app.stage.showGrid = e.target.checked; };
  $('#chk-onion').onchange = e => { app.stage.onion = e.target.checked ? 2 : 0; };
  $('#chk-guides').onchange = e => { app.stage.showGuides = e.target.checked; };

  $('#scene-name').addEventListener('change', () => {
    app.store.commit(null, s => { s.name = $('#scene-name').value; });
  });

  $('#chk-autosave').onchange = e => {
    app.disk.enable(e.target.checked);
    storage.set('autosave-disk', e.target.checked);
    if (e.target.checked) {
      requestDiskSave();
      app.disk.flush();
      say(app.scenePath
        ? `autosaving to ${app.assets.label}/${app.scenePath}`
        : 'autosave on · save once to choose the file', 'ok');
    } else {
      syncSaveState();
      say('autosave to disk is off · Ctrl+S to save', 'ok');
    }
  };

  // A tab going away — closed, hidden, switched — is the last chance to get the
  // queued write out; `beforeunload` is too late to await anything.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') app.disk.flush();
  });

  addEventListener('beforeunload', e => {
    app.disk.flush();
    // `dirty` is cleared the moment the disk catches up, so with autosave on
    // and nothing in flight this stops asking at all — which is the point.
    if (app.store.dirty && app.assets.canWrite) { e.preventDefault(); e.returnValue = ''; }
  });
}

async function boot() {
  app.assets = new AssetLibrary(() => { markPanels(); });
  // Repaint a sprite in Aseprite and it lands here on its own; the alternative
  // was alt-tabbing back to press «recargar» after every single save.
  app.assets.onReload = paths => {
    const names = paths.map(p => p.split('/').pop());
    say(`updated from disk: ${names.slice(0, 3).join(', ')}` +
        (names.length > 3 ? ` and ${names.length - 3} more` : ''), 'ok');
  };
  app.assets.watch(true);
  app.disk = new DiskAutosave({
    write: (path, text) => app.assets.writeText(path, text),
    onState: state => {
      // The disk is now the authority again, so nothing is pending anywhere.
      if (state === SAVED) app.store.dirty = false;
      if (state === ERROR) {
        say(`could not save to ${app.scenePath}: ${app.disk.error?.message || ''} · ` +
            'tick «auto» again or use Save', 'err');
      }
      syncSaveState();
    },
  });
  app.stage = new Stage($('#stage'), app);
  app.timeline = new Timeline($('#timeline'), app);
  app.store.subscribe(markPanels);

  bindToolbar();
  bindKeys();
  bindDrop();

  if (!AssetLibrary.supportsFolder) {
    $('#btn-project').textContent = 'Open folder…';
    $('#btn-project').title = 'This browser cannot write to disk: it will load read-only';
  }

  const saved = await storage.get('autosave');
  const dir = await storage.get('dir');
  app.disk.enable((await storage.get('autosave-disk')) !== false);   // on unless turned off

  if (saved?.scene) {
    app.store.replace(saved.scene, { history: false });
    app.store.dirty = false;
    app.scenePath = saved.path || null;
    $('#scene-name').value = saved.name || saved.scene.name || 'scene';

    // The scene came back; the images have to be found again. Only the bundled
    // demo can do that unattended — a folder needs a click to regain write
    // permission, and dropped files are gone for good.
    if (saved.source === 'url') {
      await app.assets.loadManifest(DEMO).catch(() => {});
      say('session restored · example scene');
    } else if (dir) {
      say(h('span', {}, [
        'session restored · ',
        button(`reconnect «${dir.name}»`, () => openFolder(dir), 'slim'),
      ]));
    } else {
      say('session restored · reopen the folder to see the sprites');
    }
  } else {
    try {
      await app.assets.loadManifest(DEMO);
      const text = await app.assets.readText('scene.json');
      app.store.replace(JSON.parse(text), { history: false });
      app.store.dirty = false;
      $('#scene-name').value = app.store.scene.name;
      say('example scene · open a folder of your own to work with your sprites');
    } catch {
      app.store.replace(defaultScene(), { history: false });
      say('start by opening a folder with your sprites');
    }
  }
  syncProjectLabel();
  syncSaveState();

  $('#scrub').max = Math.max(0, app.store.scene.loop_frames - 1);
  app.stage.layout();
  app.select('scene');
  app.setFrame(0);
  app.playing = true;
  syncPlayButton();
  markPanels();
  // a handle for the browser console: poke at the scene, jump to a frame
  window.editor = app;
  renderAssets();
  app.assets.onChange = () => { markPanels(); scheduleAssetRender(); };
  requestAnimationFrame(t => { app.lastTick = t; tick(t); });
}

boot();
