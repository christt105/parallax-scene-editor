// The keyboard: every binding in one place, and the dialog that lists them.

import { h, $ } from './dom.js';
import { openModal } from './modal.js';
import { saveScene } from './project.js';

export function bindKeys(app) {
  addEventListener('keydown', ev => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const mod = ev.ctrlKey || ev.metaKey;

    if (mod && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      return saveScene(app);
    }
    if (mod && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      const ok = ev.shiftKey ? app.store.redo() : app.store.undo();
      if (ok) { app.selKey = -1; app.refresh(); }
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
        if (ev.altKey) nudge(app, dir * (ev.shiftKey ? 8 : 1), 0);
        else { app.pause(); app.setFrame(app.frame + dir * bump); }
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown':
        if (ev.altKey) { ev.preventDefault(); nudge(app, 0, (ev.key === 'ArrowDown' ? 1 : -1) * (ev.shiftKey ? 8 : 1)); }
        break;
      case 'k': case 'K': app.addKey(); break;
      case 'Delete': case 'Backspace': app.deleteKey(); break;
      case 'd': case 'D': app.duplicate(); break;
      case 'g': case 'G': $('#chk-grid').click(); break;
      case 'o': case 'O': $('#chk-onion').click(); break;
    }
  });
}

function nudge(app, dx, dy) {
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

export function helpModal() {
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
