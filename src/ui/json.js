// The scene as text: read it, paste one over it, take it away.

import { compact } from '../scene.js';
import { download } from '../export/index.js';
import { h, button } from './dom.js';
import { openModal } from './modal.js';

export function jsonModal(app) {
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
        app.refresh();
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
