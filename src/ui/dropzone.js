// Files dragged onto the window, and the veil that says they will be taken.

import { $ } from './dom.js';
import { say } from './status.js';
import { syncProjectLabel, offerScenes } from './project.js';

export function bindDrop(app) {
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
    syncProjectLabel(app);
    if (!n) return say('no images in what you dropped', 'err');
    say(had ? `${n} file(s) added to the ${had} already loaded`
            : `${n} files loaded (read-only)`, 'ok');
    if (app.missingCount()) app.relink();
    const scenes = app.assets.sceneFiles();
    if (!had && scenes.length) offerScenes(app, scenes);
  });
}
