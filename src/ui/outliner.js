// The list of what the scene is made of: layers, then actors, in draw order.

import { h, $, clear, button } from './dom.js';
import { pickAsset, insertFromAsset } from './assets.js';

function outlinerRow(app, kind, index, item) {
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

export function renderOutliner(app) {
  const scene = app.store.scene;
  const layers = $('#outliner-layers');
  const actors = $('#outliner-actors');
  clear(layers); clear(actors);
  scene.layers.forEach((l, i) => layers.append(outlinerRow(app, 'layer', i, l)));
  scene.actors.forEach((a, i) => actors.append(outlinerRow(app, 'actor', i, a)));
  layers.append(h('li.add-row', {}, [
    button('+ layer', () => addFromAsset(app, 'layer'), 'slim'),
  ]));
  actors.append(h('li.add-row', {}, [
    button('+ actor', () => addFromAsset(app, 'actor'), 'slim'),
  ]));
}

function addFromAsset(app, kind) {
  pickAsset(app, null, path => insertFromAsset(app, kind, path));
}
