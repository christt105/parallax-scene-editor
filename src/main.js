// Wiring: the app object every panel talks to, plus the boot that puts the
// panels, the folder and the loop together.

import { defaultScene, loopWarnings, clone } from './scene.js';
import { Store } from './store.js';
import { AssetLibrary, normPath, guessFrames } from './assets.js';
import { planRelink, applyRelink, missingRefs, joinRoot } from './relink.js';
import { Stage } from './ui/stage.js';
import { Timeline } from './ui/timeline.js';
import { renderInspector } from './ui/inspector.js';
import { h, $, button } from './ui/dom.js';
import { say, saidAgo } from './ui/status.js';
import { closeModal } from './ui/modal.js';
import { renderOutliner } from './ui/outliner.js';
import { renderAssets, scheduleAssetRender, pickAsset } from './ui/assets.js';
import { openFolder, syncProjectLabel, syncSaveState, requestDiskSave,
         offerScenes, saveScene } from './ui/project.js';
import { exportModal } from './ui/export.js';
import { jsonModal } from './ui/json.js';
import { bindKeys, helpModal } from './ui/shortcuts.js';
import { bindDrop } from './ui/dropzone.js';
import * as storage from './storage.js';
import { DiskAutosave, SAVED, ERROR } from './autosave.js';
import { detectFolderSupport, folderSupportTitle } from './browser-support.js';

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
  folderSupport: null,
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
    ? `paths repaired: the asset root is now “${plan.prefix}”`
    : `${plan.fixes.length} path(s) repaired${left ? `, ${left} still unresolved` : ''}`,
    left ? 'err' : 'ok');
  markPanels();
};

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
    requestDiskSave(app);
  }, 0);
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
app.pickAsset = (current, onPick) => pickAsset(app, current, onPick);

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

// ------------------------------------------------------------------ loop --

function syncPlayButton() { $('#btn-play').textContent = app.playing ? '⏸' : '⏵'; }
function syncFrameLabel() {
  $('#frame-label').textContent = `${app.frame} / ${app.store.scene.loop_frames - 1}`;
}

function syncPanels() {
  renderOutliner(app);
  const skipInspector = app.suppressInspector;
  app.suppressInspector = false;
  if (!skipInspector) renderInspector($('#right'), app);
  // Typing into a field skips the rebuild above to keep the caret in place,
  // but the loop-closing verdict shown in the panel still has to catch up.
  else app.refreshWarnings?.();
  app.timeline.render();
  $('#btn-undo').disabled = !app.store.canUndo;
  $('#btn-redo').disabled = !app.store.canRedo;

  const node = $('#status');
  const mine = node.dataset.auto === '1';
  const warnings = loopWarnings(app.store.scene, app.periodOf);
  // A reply to something the user just did gets a few seconds of the line to
  // itself; after that a loop that will not close is the more useful news, and
  // it used to sit behind the greeting for as long as the tab stayed open.
  const free = mine || !node.textContent || saidAgo() > 4000;
  if (warnings.length && free) say(warnings[0].text, 'err', true);
  else if (!warnings.length && mine) say('');
}

const autosave = storage.debounced('autosave');

// A display slower than the scene, or a stutter, leaves us a frame or three
// behind; taking those in one tick keeps playback on time. Past that we are not
// late, we were away.
const MAX_CATCHUP = 4;

function tick(t) {
  if (app.playing) {
    const interval = 1000 / app.store.scene.fps;
    const behind = Math.floor((t - app.lastTick) / interval);
    if (behind > MAX_CATCHUP) {
      // Minimizing the window stops the frames coming, so we return owing
      // hundreds of them, and paying that back four at a time ran the scene
      // several times too fast until the debt cleared. Nobody was watching the
      // frames we missed: write them off and start the clock again from now.
      app.lastTick = t;
      app.setFrame(app.frame + 1);
    } else if (behind > 0) {
      app.lastTick += behind * interval;
      app.setFrame(app.frame + behind);
    }
  }
  app.stage.draw();
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ boot --

function bindToolbar() {
  $('#btn-project').onclick = () => {
    if (AssetLibrary.supportsFolder) return openFolder(app);
    $('#file-input').webkitdirectory = true;
    $('#file-input').click();
  };
  $('#btn-drop').onclick = () => {
    $('#file-input').webkitdirectory = false;
    $('#file-input').click();
  };
  $('#file-input').onchange = e => {
    const n = app.assets.adoptFiles(e.target.files);
    syncProjectLabel(app);
    say(n ? `${n} files loaded (read-only snapshot)` : 'no images found', n ? 'ok' : 'err');
    e.target.value = '';
  };
  $('#btn-save').onclick = () => saveScene(app);
  $('#btn-open-scene').onclick = () => {
    const scenes = app.assets.sceneFiles();
    if (!scenes.length) return say('no .json files in the loaded folder', 'err');
    offerScenes(app, scenes);
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
  $('#btn-json').onclick = () => jsonModal(app);
  $('#btn-export').onclick = () => exportModal(app);
  $('#btn-help').onclick = helpModal;
  $('#btn-scene-props').onclick = () => app.select('scene');
  $('#btn-refresh-assets').onclick = () => { app.assets.refresh(); renderAssets(app); say('images reloaded', 'ok'); };
  $('#asset-filter').addEventListener('input', () => renderAssets(app));
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
      requestDiskSave(app);
      app.disk.flush();
      say(app.scenePath
        ? `autosaving to ${app.assets.label}/${app.scenePath}`
        : 'autosave on · save once to choose the file', 'ok');
    } else {
      syncSaveState(app);
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
  // was alt-tabbing back to press “recargar” after every single save.
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
            'tick “auto” again or use Save', 'err');
      }
      syncSaveState(app);
    },
  });
  app.stage = new Stage($('#stage'), app);
  app.timeline = new Timeline($('#timeline'), app);
  app.store.subscribe(markPanels);

  bindToolbar();
  bindKeys(app);
  bindDrop(app);

  app.folderSupport = await detectFolderSupport();
  if (app.folderSupport !== 'ok') {
    $('#btn-project').title = folderSupportTitle(app.folderSupport);
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
        button(`reconnect “${dir.name}”`, () => openFolder(app, dir), 'slim'),
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
  syncProjectLabel(app);
  syncSaveState(app);

  $('#scrub').max = Math.max(0, app.store.scene.loop_frames - 1);
  app.stage.layout();
  app.select('scene');
  app.setFrame(0);
  app.playing = true;
  syncPlayButton();
  markPanels();
  // a handle for the browser console: poke at the scene, jump to a frame
  window.editor = app;
  renderAssets(app);
  app.assets.onChange = () => { markPanels(); scheduleAssetRender(app); };
  requestAnimationFrame(t => { app.lastTick = t; tick(t); });
}

boot();
