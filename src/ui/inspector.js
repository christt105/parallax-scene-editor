// The right-hand panel. Every control is declared as data and rendered by one
// loop, so adding a property to the scene format is a one-line change here.

import { h, clear, field, select, number, toggle, button } from './dom.js';
import { ANCHORS, EASES, MOTION_TYPES, actorCycle, layerShift,
         speedOptions, delayOptions, loopOptions, loopWarnings } from '../scene.js';
import { sampleKeys } from '../anim.js';

const SCENE_FIELDS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'canvas', label: 'Canvas', type: 'size' },
  { key: 'zoom', label: 'Zoom', type: 'int', min: 1, max: 16,
    hint: 'integer magnification, no smoothing' },
  { key: 'loop_frames', label: 'Frames', type: 'int', min: 1 },
  { key: 'fps', label: 'FPS', type: 'number', step: 0.001 },
  { key: 'world_height', label: 'World height', type: 'int', min: 0, nullable: true,
    hint: 'height in px the scene anchors to; empty = the whole visible height' },
  { key: 'align', label: 'Vertical anchor', type: 'select',
    options: [['bottom', 'bottom'], ['center', 'centre'], ['top', 'top']] },
  { key: 'backdrop', label: 'Backdrop', type: 'color' },
  { key: 'sprite_root', label: 'Asset root', type: 'text',
    hint: 'prefix put in front of every sprite path' },
];

const LAYER_FIELDS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'sprite', label: 'Image', type: 'asset' },
  { key: 'y', label: 'y', type: 'number' },
  { key: 'depth', label: 'Depth', type: 'number',
    hint: 'lower = further back; can sit in front of the actors' },
  { key: 'speed', label: 'Speed x', type: 'number', step: 0.125,
    hint: 'px per frame; positive scrolls the artwork leftwards' },
  { key: 'speed_y', label: 'Speed y', type: 'number', step: 0.125 },
  { key: 'tile_period', label: 'Tile period', type: 'int', min: 0,
    hint: "0 = the image's own width. Must divide speed × frames for the loop to close" },
  { key: 'repeat', label: 'Repeat', type: 'select', options: [['x', 'in x'], ['none', 'no']] },
  { key: 'extend_up', label: 'Extend up', type: 'bool' },
  { key: 'extend_down', label: 'Extend down', type: 'bool' },
  { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 1, step: 0.05 },
];

const ACTOR_FIELDS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'sprite', label: 'Sprite', type: 'asset' },
  { key: 'frames', label: 'Frames', type: 'int', min: 1, detect: true },
  { key: 'grid', label: 'Grid', type: 'grid',
    hint: 'columns × rows if the sheet is not a horizontal strip' },
  { key: 'delay', label: 'Delay', type: 'int', min: 1, hint: 'frames each cel is held' },
  { key: 'order', label: 'Order', type: 'order', hint: 'e.g. 0,1,2,1 for there and back' },
  { key: 'offset', label: 'Offset', type: 'int', hint: "shifts this actor's cycle within the loop" },
  { key: 'anchor', label: 'Anchor', type: 'select', options: ANCHORS },
  { key: 'depth', label: 'Depth', type: 'number' },
  { key: 'scale', label: 'Scale', type: 'int', min: 1, max: 8 },
  { key: 'flip_x', label: 'Flip x', type: 'bool' },
  { key: 'flip_y', label: 'Flip y', type: 'bool' },
  { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 1, step: 0.05 },
];

function control(spec, obj, ctx, onSet) {
  const v = obj[spec.key];
  const set = value => onSet(spec.key, value);
  // Controls made of two inputs have to read their sibling's value at the
  // moment they are used, not at the moment they were drawn: the panel is
  // deliberately not rebuilt between keystrokes, so a captured copy would go
  // stale and typing a height would put the old width back.
  const now = () => obj[spec.key];

  switch (spec.type) {
    case 'text':
      return h('input', { type: 'text', value: v ?? '', oninput: e => set(e.target.value) });

    case 'color':
      return h('div.row', {}, [
        h('input', { type: 'color', value: v || '#000000', oninput: e => set(e.target.value) }),
        h('input', { type: 'text', value: v || '', class: 'mono',
                     oninput: e => set(e.target.value) }),
      ]);

    case 'bool':
      return toggle(v, set);

    case 'select':
      return select(spec.options, v, set);

    case 'range': {
      const out = h('span.range-value', { text: (+v).toFixed(2) });
      return h('div.row', {}, [
        h('input', { type: 'range', min: spec.min, max: spec.max, step: spec.step, value: v,
                     oninput: e => { out.textContent = (+e.target.value).toFixed(2); set(+e.target.value); } }),
        out,
      ]);
    }

    case 'int':
    case 'number':
      return h('input', {
        type: 'number', value: v ?? '', min: spec.min, max: spec.max,
        step: spec.step ?? (spec.type === 'int' ? 1 : 0.5),
        oninput: e => {
          if (e.target.value === '') return set(spec.nullable ? null : 0);
          set(spec.type === 'int' ? Math.round(+e.target.value) : +e.target.value);
        },
      });

    case 'size':
      return h('div.row', {}, [
        number(v[0], n => set([Math.max(1, n | 0), now()[1]]), { min: 1 }),
        h('span.times', { text: '×' }),
        number(v[1], n => set([now()[0], Math.max(1, n | 0)]), { min: 1 }),
      ]);

    case 'grid':
      return h('div.row', {}, [
        number(v ? v[0] : '', n => set(n > 0 ? [n, (now() && now()[1]) || 1] : null),
               { min: 1, placeholder: 'cols' }),
        h('span.times', { text: '×' }),
        number(v ? v[1] : '', n => set(n > 0 ? [(now() && now()[0]) || 1, n] : null),
               { min: 1, placeholder: 'rows' }),
      ]);

    case 'order':
      return h('input', {
        type: 'text', value: (v || []).join(','), placeholder: 'automatic', class: 'mono',
        oninput: e => {
          const list = e.target.value.split(',').map(s => parseInt(s, 10))
            .filter(n => Number.isInteger(n) && n >= 0);
          set(list.length ? list : null);
        },
      });

    case 'asset': {
      const found = !v || ctx.resolve(v) || ctx.hasAsset(v);
      const input = h('input', {
        type: 'text', value: v || '', class: 'mono grow' + (found ? '' : ' missing'),
        oninput: e => set(e.target.value),
      });
      return h('div.row', {}, [
        input,
        button('…', () => ctx.pickAsset(now(), path => { set(path); ctx.refresh(); }), 'slim'),
      ]);
    }

    default:
      return h('span', { text: String(v) });
  }
}

function fieldsFor(specs, obj, ctx, onSet) {
  return specs.map(spec => {
    const node = control(spec, obj, ctx, onSet);
    const row = field(spec.label, node, spec.hint);
    // a stable hook, so tests and scripts name the field they mean instead of
    // counting inputs and quietly landing on the wrong one
    row.dataset.field = spec.key;
    if (spec.detect) {
      row.querySelector('.field-label').append(
        button('detect', () => ctx.detectFrames(), 'link'));
    }
    return row;
  });
}

// ------------------------------------------------------------------ blocks --

function positionBlock(actor, ctx) {
  const { store, frame } = ctx;
  const loop = store.scene.loop_frames;
  const hasKeys = !!(actor.keys && actor.keys.length);
  const key = hasKeys && ctx.selKey >= 0 ? actor.keys[ctx.selKey] : null;
  const [x, y] = hasKeys ? (key ? [key.x, key.y] : sampleKeys(actor.keys, frame, loop))
                         : [actor.x, actor.y];

  const setPos = (axis, value) => ctx.editUI('pos', a => {
    if (hasKeys) {
      const target = key || a.keys[nearestKey(a.keys, frame)];
      target[axis] = Math.round(value);
    } else {
      a[axis] = Math.round(value);
    }
  });

  const rows = [
    field('x', number(Math.round(x), v => setPos('x', v))),
    field('y', number(Math.round(y), v => setPos('y', v))),
  ];

  if (hasKeys && !key) {
    rows.push(h('p.note', { text: `interpolated at frame ${frame}: editing moves the nearest key` }));
  }
  if (key) {
    rows.push(field('Easing', select(EASES, key.ease || 'linear',
      v => ctx.editUI('ease', a => { a.keys[ctx.selKey].ease = v; }))));
    rows.push(field('Frame', number(key.f, v => ctx.editUI('keyframe', a => {
      a.keys[ctx.selKey].f = Math.max(0, Math.min(loop - 1, Math.round(v)));
      a.keys.sort((p, q) => p.f - q.f);
      ctx.selKey = a.keys.findIndex(k => k.f === Math.round(v));
    }), { min: 0, max: loop - 1 })));
  }

  rows.push(h('div.row.gap', {}, [
    button(hasKeys ? '+ Key here' : 'Make it animated', () => ctx.addKey()),
    hasKeys && key ? button('− Delete key', () => ctx.deleteKey(), 'danger') : null,
  ]));

  return h('section.block', {}, [h('h3', { text: 'Position' }), ...rows]);
}

function nearestKey(keys, frame) {
  let best = 0, bestD = Infinity;
  keys.forEach((k, i) => {
    const d = Math.abs(k.f - frame);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function motionBlock(actor, ctx) {
  const list = actor.motion || [];
  const rows = list.map((m, i) => h('div.motion', {}, [
    h('div.row', {}, [
      select(MOTION_TYPES.map(t => [t, { sine: 'sine', cosine: 'cosine', wobble: 'wobble' }[t]]),
             m.type || 'sine', v => ctx.editUI('motion', a => { a.motion[i].type = v; })),
      select([['y', 'y axis'], ['x', 'x axis']], m.axis || 'y',
             v => ctx.editUI('motion', a => { a.motion[i].axis = v; })),
      button('×', () => ctx.edit(null, a => {
        a.motion.splice(i, 1);
        if (!a.motion.length) a.motion = null;
      }), 'slim danger'),
    ]),
    h('div.row', {}, [
      field('Amplitude', number(m.amp ?? 0, v => ctx.editUI('motion', a => { a.motion[i].amp = v; }), { step: 0.5 })),
      m.type === 'wobble'
        ? field('Hold', number(m.hold ?? 8, v => ctx.editUI('motion', a => { a.motion[i].hold = Math.max(1, v | 0); }), { min: 1 }))
        : field('Period', number(m.period ?? 64, v => ctx.editUI('motion', a => { a.motion[i].period = v; }), { step: 1 })),
      m.type === 'wobble' ? null
        : field('Phase', number(m.phase ?? 0, v => ctx.editUI('motion', a => { a.motion[i].phase = v; }), { step: 15 })),
    ]),
  ]));

  return h('section.block', {}, [
    h('h3', { text: 'Motion' }),
    ...rows,
    button('+ Add motion', () => ctx.edit(null, a => {
      a.motion = (a.motion || []).concat([{ type: 'sine', axis: 'y', amp: 2, period: 64 }]);
    })),
  ]);
}

/** Short enough to read, exact enough to type back in. */
const num = v => String(Math.round(v * 10000) / 10000);

/**
 * A scene edit made by pressing a button rather than typing.
 *
 * `editScene` leaves the panel alone on purpose — rebuilding it mid-keystroke
 * pulls the caret out of the field. A button has no caret to protect, and a
 * panel still showing “does not close” after you pressed the thing that fixes it is
 * the worst of both.
 */
const applyScene = (ctx, key, value) => () => {
  ctx.editScene(key, value);
  ctx.suppressInspector = false;
};

/**
 * The other way out: leave every speed alone and make the loop longer.
 *
 * Offered only while it is still a loop. The shortest length that suits
 * everything is a least common multiple, and one awkward number in the scene
 * sends it to five figures — “fix it with 2560 frames” is arithmetic, not
 * advice. Past four times what is set, it says the number and stops there.
 */
function loopSuggestion(scene, ctx, lead, cls = 'slim') {
  const loop = loopOptions(scene, ctx.periodOf || (() => 0));
  if (!loop || loop.next === scene.loop_frames) return [];
  const seconds = (loop.next / scene.fps).toFixed(2);
  if (loop.next > Math.max(4 * scene.loop_frames, 512)) {
    return [h('p.note', {
      text: `lengthening the loop is not worth it: it would take ${loop.next} frames ` +
            `(${seconds} s) for everything to fit at once.`,
    })];
  }
  return [
    h('p.note', { text: lead }),
    h('div.row.gap.wrap', {}, [button(
      `loop of ${loop.next} frames · ${seconds} s`,
      applyScene(ctx, 'loop_frames', loop.next), cls)]),
  ];
}

/**
 * The whole loop, from the scene panel: what does not close, and the one
 * number that would fix all of it at once without touching any speed.
 */
function loopBlock(scene, ctx) {
  const bad = loopWarnings(scene, ctx.periodOf || (() => 0));
  if (!bad.length) {
    return h('p.note.ok', { text: `the loop closes: the ${scene.layers.length} layer(s) ` +
      `land back where they started and the ${scene.actors.length} actor(s) on their first cel` });
  }
  return h('div.fix', {}, [
    h('p.note.warn', {
      text: `not closing: ${bad.map(w => (w.layer || w.actor).name).join(', ')}. ` +
            'Select them to see which values would work.',
    }),
    ...loopSuggestion(scene, ctx,
      'without touching a single speed, the shortest loop everything fits into:',
      'slim accent'),
  ]);
}

/**
 * The part that was missing: not “this does not close” but “put this”.
 *
 * Both ways out are offered because they are different decisions. Changing the
 * speed moves one layer and leaves the rest of the scene alone; changing
 * `loop_frames` keeps every speed exactly as chosen and makes the loop longer.
 */
function fixBlock(layer, scene, period, ctx) {
  const step = period / scene.loop_frames;
  const options = speedOptions(layer.speed, period, scene.loop_frames);

  const kids = [h('p.note', {
    text: `over ${scene.loop_frames} frames the layer has to travel a whole number ` +
          `of ${period} px tiles, so the speed goes up in steps of ${num(step)}:`,
  })];

  if (options.length) {
    kids.push(h('div.row.gap.wrap', {}, options.map(v => button(
      v ? `speed ${num(v)} · ${num(v / step)} tile(s)` : 'speed 0 · still',
      () => ctx.edit('speed', o => { o.speed = v; }),
      'slim'))));
  }
  kids.push(...loopSuggestion(scene, ctx,
    'or, leaving every speed exactly as it is, lengthen the loop:'));

  return h('div.fix', {}, kids);
}

function cycleNote(actor, scene, ctx) {
  const cycle = actorCycle(actor);
  const ok = scene.loop_frames % cycle === 0;
  const note = h('p.note' + (ok ? '.ok' : '.warn'), {
    text: ok
      ? `cycle of ${cycle} frames · fits ${scene.loop_frames / cycle} times into the loop`
      : `cycle of ${cycle} frames · does not divide ${scene.loop_frames}: it will jump at the wrap`,
  });
  if (ok) return note;

  const cels = (actor.order && actor.order.length) || Math.max(1, actor.frames || 1);
  const delays = delayOptions(actor, scene.loop_frames);
  const kids = [note, h('p.note', {
    text: `${cels} cels × delay has to divide ${scene.loop_frames}:`,
  })];
  if (delays.length) {
    kids.push(h('div.row.gap.wrap', {}, delays.map(d => button(
      `delay ${d} · cycle of ${cels * d}`,
      () => ctx.edit('delay', o => { o.delay = d; }),
      'slim'))));
  } else {
    // No delay works because the cel count itself does not divide the loop.
    // A there-and-back order turns three cels into four, and four divides most
    // loops anyone picks — but only alongside a delay that suits the new count,
    // or the button would hand back the same warning it was pressed to clear.
    const back = [...Array(cels).keys()].concat(
      [...Array(Math.max(0, cels - 2)).keys()].map(i => cels - 2 - i));
    const now = Math.max(1, actor.delay | 0 || 1);
    const fits = scene.loop_frames % (back.length * now) === 0;
    const d = fits ? now
      : (delayOptions({ order: back, delay: now }, scene.loop_frames)
          .sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0]);
    kids.push(h('p.note', {
      text: `with ${cels} cels no delay will do: ${cels} does not divide ` +
            `${scene.loop_frames}. A there-and-back order turns them into ` +
            `${back.length}, which does:`,
    }));
    if (d) {
      kids.push(h('div.row.gap.wrap', {}, [button(
        `order ${back.join(',')}` + (d === now ? '' : ` · delay ${d}`),
        () => ctx.edit('order', o => { o.order = back; o.delay = d; }),
        'slim')]));
    }
  }
  kids.push(...loopSuggestion(scene, ctx, 'or lengthen the loop:'));
  return h('div.fix', {}, kids);
}

// ------------------------------------------------------------------- entry --

export function renderInspector(container, ctx) {
  clear(container);
  const { store, selection } = ctx;
  const scene = store.scene;

  if (selection.kind === 'scene') {
    const missing = ctx.missingCount();
    container.append(h('h2', { text: 'Scene' }));
    if (missing) {
      container.append(h('p.note.warn', {}, [
        `${missing} image(s) in the scene are not among the loaded files. `,
        button('Repair paths', () => ctx.relink(), 'slim'),
      ]));
    }
    container.append(
      ...fieldsFor(SCENE_FIELDS, scene, ctx, (k, v) => ctx.editScene(k, v)),
      h('p.note', { text: `view: ${Math.ceil(scene.canvas[0] / scene.zoom)}×${Math.ceil(scene.canvas[1] / scene.zoom)} px · output ${scene.canvas[0]}×${scene.canvas[1]} · ${(scene.loop_frames / scene.fps).toFixed(2)} s` }),
      loopBlock(scene, ctx),
    );
    return;
  }

  const isLayer = selection.kind === 'layer';
  const list = isLayer ? scene.layers : scene.actors;
  const obj = list[selection.index];
  if (!obj) {
    container.append(h('p.note', { text: 'nothing selected' }));
    return;
  }

  const onSet = (key, value) => ctx.editUI(key, o => { o[key] = value; });
  const specs = isLayer ? LAYER_FIELDS : ACTOR_FIELDS;

  container.append(
    h('div.row.between', {}, [
      h('h2', { text: isLayer ? 'Layer' : 'Actor' }),
      h('div.row.gap', {}, [
        button('Duplicate', () => ctx.duplicate(), 'slim'),
        button('Delete', () => ctx.remove(), 'slim danger'),
      ]),
    ]),
  );

  if (obj.sprite && !ctx.hasAsset(obj.sprite)) {
    container.append(h('p.note.warn', {}, [
      `cannot find “${ctx.fullPath(obj.sprite)}” among the loaded files. `,
      button('Repair paths', () => ctx.relink(), 'slim'),
    ]));
  }

  container.append(...fieldsFor(specs, obj, ctx, onSet));

  if (!isLayer) {
    container.append(cycleNote(obj, scene, ctx), positionBlock(obj, ctx), motionBlock(obj, ctx));
  } else {
    const img = ctx.resolve(obj.sprite);
    const period = Math.round(obj.tile_period) || (img ? img.naturalWidth : 0);
    // Same rounding the renderer uses, so the note and the pixels agree.
    const travel = layerShift(obj, scene.loop_frames);
    const off = period ? ((travel % period) + period) % period : 0;
    const ok = !period || !off;
    container.append(h('p.note' + (ok ? '.ok' : '.warn'), {
      text: period
        ? `travels ${travel} px per loop over a ${period} px period` +
          (ok ? ` · closes seamlessly, ${travel / period} tile(s) per loop`
              : ` · does not close: it will jump ${Math.min(off, period - off)} px`)
        : 'waiting for the image to load to know its period',
    }));
    if (!ok) container.append(fixBlock(obj, scene, period, ctx));
  }
}
