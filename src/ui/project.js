// The folder and the file in it: opening one, reading a scene out of it,
// writing the scene back, and saying where the next keystroke will land.

import { compact } from '../scene.js';
import * as storage from '../storage.js';
import { SAVING, PENDING, ERROR } from '../autosave.js';
import { download } from '../export/index.js';
import { h, $ } from './dom.js';
import { say } from './status.js';
import { openModal, closeModal } from './modal.js';
import { renderAssets } from './assets.js';
import { folderSupportTitle } from '../browser-support.js';

// -------------------------------------------------------- disk autosave --

const sceneText = app => JSON.stringify(compact(app.store.scene), null, 2);

/**
 * Mirror the edit onto the disk, when there is a disk to mirror it onto.
 *
 * Deliberately only ever writes a file the user already pointed at — one they
 * opened from the folder, or one an explicit *Save* created. Inventing
 * `scene.json` inside somebody's art folder because they nudged a sprite is a
 * surprise, and a folder picked for reading is not consent to be written into.
 */
export function requestDiskSave(app) {
  if (app.disk.enabled && app.assets.canWrite && app.scenePath && app.store.dirty) {
    // An edit that lands back on the bytes already written — undo, a value typed
    // and retyped — is nothing to write, and nothing to warn about on the way out.
    if (!app.disk.request(app.scenePath, sceneText(app)) && app.disk.clean) {
      app.store.dirty = false;
    }
  }
  syncSaveState(app);
}

export function syncSaveState(app) {
  const pill = $('#save-state');
  const chk = $('#chk-autosave');
  const disk = app.disk;
  chk.checked = disk.enabled;
  chk.disabled = !app.assets.canWrite;

  let text, cls = 'pill save-state', title = '';
  if (!app.assets.canWrite) {
    text = 'browser only';
    cls += ' muted';
    if (app.folderSupport && app.folderSupport !== 'ok') {
      title = folderSupportTitle(app.folderSupport);
    } else {
      title = app.assets.count
        ? 'these files are a read-only snapshot; open a folder to write to disk'
        : 'open a folder and the scene will save itself to disk';
    }
  } else if (disk.state === ERROR) {
    text = `autosave stopped: ${disk.error?.message || 'the write failed'}`;
    title = 'tick “auto” again to retry';
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

// ------------------------------------------------------------- project ---

export async function openFolder(app, handle = null) {
  try {
    await app.assets.openFolder(handle);
    await storage.set('dir', app.assets.dirHandle);
    syncProjectLabel(app);
    say(`folder “${app.assets.label}”: ${app.assets.count} files` +
        (app.assets.truncated ? ' (cap reached: there are more unread)' : ''), 'ok');
    if (app.missingCount()) app.relink();
    const scenes = app.assets.sceneFiles();
    if (scenes.length && !app.scenePath) offerScenes(app, scenes);
    else if (app.scenePath) {
      // Reconnecting to the folder the session came from: the scene in the tab
      // is the newer of the two, so let it flow back down to its file.
      requestDiskSave(app);
    }
  } catch (e) {
    say(e.message || 'the folder could not be opened', 'err');
  }
}

export function syncProjectLabel(app) {
  const label = $('#project-label');
  label.hidden = !app.assets.label;
  label.textContent = app.assets.label
    ? `${app.assets.label} · ${app.assets.count} files${app.assets.canWrite ? '' : ' (read-only snapshot)'}`
    : '';
  $('#btn-save').textContent = app.assets.canWrite ? 'Save' : 'Download';
  syncSaveState(app);
}

export function offerScenes(app, scenes) {
  const body = openModal('Scenes found in the folder');
  body.append(
    h('p.note', { text: 'Open one to carry on working on it.' }),
    h('ul.scene-list', {}, scenes.map(p =>
      h('li', { text: p, onclick: () => { closeModal(); loadScene(app, p); } }))),
  );
}

async function loadScene(app, path) {
  const text = await app.assets.readText(path);
  if (!text) return say(`could not read ${path}`, 'err');
  try {
    const data = JSON.parse(text);
    app.store.replace(data);
    app.scenePath = path;
    app.store.dirty = false;
    // What we would write for this scene is now what the file holds, near
    // enough: no edit yet, so nothing goes back to disk until there is one.
    app.disk.seed(path, sceneText(app));
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

export async function saveScene(app) {
  const name = ($('#scene-name').value || 'scene').replace(/[^A-Za-z0-9_-]/g, '');
  app.store.commit(null, s => { s.name = name; });
  const text = sceneText(app);
  if (app.assets.canWrite) {
    const dir = app.scenePath && app.scenePath.includes('/')
      ? app.scenePath.slice(0, app.scenePath.lastIndexOf('/') + 1) : '';
    const path = `${dir}${name}.json`;
    try {
      await app.assets.writeText(path, text);
      app.scenePath = path;
      app.store.dirty = false;
      app.disk.seed(path, text);      // and from here on it keeps itself up to date
      renderAssets(app);
      say(`saved to ${app.assets.label}/${path}` +
          (app.disk.enabled ? ' · every change after this one saves itself' : ''), 'ok');
      return;
    } catch (e) {
      return say(`the write failed: ${e.message}`, 'err');
    }
  }
  download(new Blob([text], { type: 'application/json' }), `${name}.json`);
  app.store.dirty = false;
  syncSaveState(app);
  say('downloaded (open a folder to save to disk)', 'ok');
}
