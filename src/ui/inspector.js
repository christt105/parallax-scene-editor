// The right-hand panel. Every control is declared as data and rendered by one
// loop, so adding a property to the scene format is a one-line change here.

import { h, clear, field, select, number, toggle, button } from './dom.js';
import { ANCHORS, EASES, MOTION_TYPES, actorCycle, layerShift,
         speedOptions, delayOptions, loopOptions, loopWarnings } from '../scene.js';
import { sampleKeys } from '../anim.js';

const SCENE_FIELDS = [
  { key: 'name', label: 'Nombre', type: 'text' },
  { key: 'canvas', label: 'Lienzo', type: 'size' },
  { key: 'zoom', label: 'Zoom', type: 'int', min: 1, max: 16,
    hint: 'aumento entero, sin suavizado' },
  { key: 'loop_frames', label: 'Fotogramas', type: 'int', min: 1 },
  { key: 'fps', label: 'FPS', type: 'number', step: 0.001 },
  { key: 'world_height', label: 'Alto del mundo', type: 'int', min: 0, nullable: true,
    hint: 'alto en px al que se ancla la escena; vacío = todo el alto visible' },
  { key: 'align', label: 'Anclaje vertical', type: 'select',
    options: [['bottom', 'abajo'], ['center', 'centro'], ['top', 'arriba']] },
  { key: 'backdrop', label: 'Color de fondo', type: 'color' },
  { key: 'sprite_root', label: 'Raíz de assets', type: 'text',
    hint: 'prefijo que se antepone a cada ruta de sprite' },
];

const LAYER_FIELDS = [
  { key: 'name', label: 'Nombre', type: 'text' },
  { key: 'sprite', label: 'Imagen', type: 'asset' },
  { key: 'y', label: 'y', type: 'number' },
  { key: 'depth', label: 'Profundidad', type: 'number',
    hint: 'menor = más al fondo; puede ir delante de los actores' },
  { key: 'speed', label: 'Velocidad x', type: 'number', step: 0.125,
    hint: 'px por fotograma; positivo desplaza el decorado a la izquierda' },
  { key: 'speed_y', label: 'Velocidad y', type: 'number', step: 0.125 },
  { key: 'tile_period', label: 'Periodo', type: 'int', min: 0,
    hint: '0 = el ancho de la imagen. Debe dividir velocidad × fotogramas para cerrar el bucle' },
  { key: 'repeat', label: 'Repetir', type: 'select', options: [['x', 'en x'], ['none', 'no']] },
  { key: 'extend_up', label: 'Estirar arriba', type: 'bool' },
  { key: 'extend_down', label: 'Estirar abajo', type: 'bool' },
  { key: 'opacity', label: 'Opacidad', type: 'range', min: 0, max: 1, step: 0.05 },
];

const ACTOR_FIELDS = [
  { key: 'name', label: 'Nombre', type: 'text' },
  { key: 'sprite', label: 'Sprite', type: 'asset' },
  { key: 'frames', label: 'Fotogramas', type: 'int', min: 1, detect: true },
  { key: 'grid', label: 'Rejilla', type: 'grid',
    hint: 'columnas × filas si la hoja no es una tira horizontal' },
  { key: 'delay', label: 'Retardo', type: 'int', min: 1, hint: 'fotogramas por cel' },
  { key: 'order', label: 'Orden', type: 'order', hint: 'ej. 0,1,2,1 para ida y vuelta' },
  { key: 'offset', label: 'Desfase', type: 'int', hint: 'desplaza el ciclo dentro del bucle' },
  { key: 'anchor', label: 'Anclaje', type: 'select', options: ANCHORS },
  { key: 'depth', label: 'Profundidad', type: 'number' },
  { key: 'scale', label: 'Escala', type: 'int', min: 1, max: 8 },
  { key: 'flip_x', label: 'Voltear x', type: 'bool' },
  { key: 'flip_y', label: 'Voltear y', type: 'bool' },
  { key: 'opacity', label: 'Opacidad', type: 'range', min: 0, max: 1, step: 0.05 },
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
               { min: 1, placeholder: 'filas' }),
      ]);

    case 'order':
      return h('input', {
        type: 'text', value: (v || []).join(','), placeholder: 'automático', class: 'mono',
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
        button('detectar', () => ctx.detectFrames(), 'link'));
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
    rows.push(h('p.note', { text: `interpolado en el fotograma ${frame}: al editar se mueve la clave más cercana` }));
  }
  if (key) {
    rows.push(field('Suavizado', select(EASES, key.ease || 'linear',
      v => ctx.editUI('ease', a => { a.keys[ctx.selKey].ease = v; }))));
    rows.push(field('Fotograma', number(key.f, v => ctx.editUI('keyframe', a => {
      a.keys[ctx.selKey].f = Math.max(0, Math.min(loop - 1, Math.round(v)));
      a.keys.sort((p, q) => p.f - q.f);
      ctx.selKey = a.keys.findIndex(k => k.f === Math.round(v));
    }), { min: 0, max: loop - 1 })));
  }

  rows.push(h('div.row.gap', {}, [
    button(hasKeys ? '+ Clave aquí' : 'Convertir en animado', () => ctx.addKey()),
    hasKeys && key ? button('− Borrar clave', () => ctx.deleteKey(), 'danger') : null,
  ]));

  return h('section.block', {}, [h('h3', { text: 'Posición' }), ...rows]);
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
      select(MOTION_TYPES.map(t => [t, { sine: 'seno', cosine: 'coseno', wobble: 'temblor' }[t]]),
             m.type || 'sine', v => ctx.editUI('motion', a => { a.motion[i].type = v; })),
      select([['y', 'eje y'], ['x', 'eje x']], m.axis || 'y',
             v => ctx.editUI('motion', a => { a.motion[i].axis = v; })),
      button('×', () => ctx.edit(null, a => {
        a.motion.splice(i, 1);
        if (!a.motion.length) a.motion = null;
      }), 'slim danger'),
    ]),
    h('div.row', {}, [
      field('Amplitud', number(m.amp ?? 0, v => ctx.editUI('motion', a => { a.motion[i].amp = v; }), { step: 0.5 })),
      m.type === 'wobble'
        ? field('Sostener', number(m.hold ?? 8, v => ctx.editUI('motion', a => { a.motion[i].hold = Math.max(1, v | 0); }), { min: 1 }))
        : field('Periodo', number(m.period ?? 64, v => ctx.editUI('motion', a => { a.motion[i].period = v; }), { step: 1 })),
      m.type === 'wobble' ? null
        : field('Fase', number(m.phase ?? 0, v => ctx.editUI('motion', a => { a.motion[i].phase = v; }), { step: 15 })),
    ]),
  ]));

  return h('section.block', {}, [
    h('h3', { text: 'Vaivén' }),
    ...rows,
    button('+ Añadir vaivén', () => ctx.edit(null, a => {
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
 * panel still showing «no cierra» after you pressed the thing that fixes it is
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
 * sends it to five figures — «arréglalo con 2560 fotogramas» is arithmetic, not
 * advice. Past four times what is set, it says the number and stops there.
 */
function loopSuggestion(scene, ctx, lead, cls = 'slim') {
  const loop = loopOptions(scene, ctx.periodOf || (() => 0));
  if (!loop || loop.next === scene.loop_frames) return [];
  const seconds = (loop.next / scene.fps).toFixed(2);
  if (loop.next > Math.max(4 * scene.loop_frames, 512)) {
    return [h('p.note', {
      text: `alargar el bucle no compensa: harían falta ${loop.next} fotogramas ` +
            `(${seconds} s) para que encaje todo a la vez.`,
    })];
  }
  return [
    h('p.note', { text: lead }),
    h('div.row.gap.wrap', {}, [button(
      `bucle de ${loop.next} fotogramas · ${seconds} s`,
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
    return h('p.note.ok', { text: `el bucle cierra: las ${scene.layers.length} capa(s) ` +
      `vuelven a su sitio y los ${scene.actors.length} actor(es) a su primer cel` });
  }
  return h('div.fix', {}, [
    h('p.note.warn', {
      text: `no cierran: ${bad.map(w => (w.layer || w.actor).name).join(', ')}. ` +
            'Selecciónalos para ver qué valores sí valen.',
    }),
    ...loopSuggestion(scene, ctx,
      'sin tocar ninguna velocidad, el bucle más corto en el que encaja todo:',
      'slim accent'),
  ]);
}

/**
 * The part that was missing: not «esto no cierra» but «pon esto».
 *
 * Both ways out are offered because they are different decisions. Changing the
 * speed moves one layer and leaves the rest of the scene alone; changing
 * `loop_frames` keeps every speed exactly as chosen and makes the loop longer.
 */
function fixBlock(layer, scene, period, ctx) {
  const step = period / scene.loop_frames;
  const options = speedOptions(layer.speed, period, scene.loop_frames);

  const kids = [h('p.note', {
    text: `en ${scene.loop_frames} fotogramas la capa tiene que recorrer un número ` +
          `entero de baldosas de ${period} px, así que la velocidad va de ` +
          `${num(step)} en ${num(step)}:`,
  })];

  if (options.length) {
    kids.push(h('div.row.gap.wrap', {}, options.map(v => button(
      v ? `velocidad ${num(v)} · ${num(v / step)} baldosa(s)` : 'velocidad 0 · quieta',
      () => ctx.edit('speed', o => { o.speed = v; }),
      'slim'))));
  }
  kids.push(...loopSuggestion(scene, ctx,
    'o, dejando todas las velocidades como están, alargar el bucle:'));

  return h('div.fix', {}, kids);
}

function cycleNote(actor, scene, ctx) {
  const cycle = actorCycle(actor);
  const ok = scene.loop_frames % cycle === 0;
  const note = h('p.note' + (ok ? '.ok' : '.warn'), {
    text: ok
      ? `ciclo de ${cycle} fotogramas · encaja ${scene.loop_frames / cycle} veces en el bucle`
      : `ciclo de ${cycle} fotogramas · no divide ${scene.loop_frames}: saltará al reiniciar`,
  });
  if (ok) return note;

  const cels = (actor.order && actor.order.length) || Math.max(1, actor.frames || 1);
  const delays = delayOptions(actor, scene.loop_frames);
  const kids = [note, h('p.note', {
    text: `${cels} cels × retardo tiene que dividir ${scene.loop_frames}:`,
  })];
  if (delays.length) {
    kids.push(h('div.row.gap.wrap', {}, delays.map(d => button(
      `retardo ${d} · ciclo de ${cels * d}`,
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
      text: `con ${cels} cels no hay retardo que valga: ${cels} no divide ` +
            `${scene.loop_frames}. Un orden de ida y vuelta los convierte en ` +
            `${back.length}, que sí:`,
    }));
    if (d) {
      kids.push(h('div.row.gap.wrap', {}, [button(
        `orden ${back.join(',')}` + (d === now ? '' : ` · retardo ${d}`),
        () => ctx.edit('order', o => { o.order = back; o.delay = d; }),
        'slim')]));
    }
  }
  kids.push(...loopSuggestion(scene, ctx, 'o alargar el bucle:'));
  return h('div.fix', {}, kids);
}

// ------------------------------------------------------------------- entry --

export function renderInspector(container, ctx) {
  clear(container);
  const { store, selection } = ctx;
  const scene = store.scene;

  if (selection.kind === 'scene') {
    const missing = ctx.missingCount();
    container.append(h('h2', { text: 'Escena' }));
    if (missing) {
      container.append(h('p.note.warn', {}, [
        `${missing} imagen(es) de la escena no están entre los archivos cargados. `,
        button('Reparar rutas', () => ctx.relink(), 'slim'),
      ]));
    }
    container.append(
      ...fieldsFor(SCENE_FIELDS, scene, ctx, (k, v) => ctx.editScene(k, v)),
      h('p.note', { text: `vista: ${Math.ceil(scene.canvas[0] / scene.zoom)}×${Math.ceil(scene.canvas[1] / scene.zoom)} px · salida ${scene.canvas[0]}×${scene.canvas[1]} · ${(scene.loop_frames / scene.fps).toFixed(2)} s` }),
      loopBlock(scene, ctx),
    );
    return;
  }

  const isLayer = selection.kind === 'layer';
  const list = isLayer ? scene.layers : scene.actors;
  const obj = list[selection.index];
  if (!obj) {
    container.append(h('p.note', { text: 'nada seleccionado' }));
    return;
  }

  const onSet = (key, value) => ctx.editUI(key, o => { o[key] = value; });
  const specs = isLayer ? LAYER_FIELDS : ACTOR_FIELDS;

  container.append(
    h('div.row.between', {}, [
      h('h2', { text: isLayer ? 'Capa' : 'Actor' }),
      h('div.row.gap', {}, [
        button('Duplicar', () => ctx.duplicate(), 'slim'),
        button('Eliminar', () => ctx.remove(), 'slim danger'),
      ]),
    ]),
  );

  if (obj.sprite && !ctx.hasAsset(obj.sprite)) {
    container.append(h('p.note.warn', {}, [
      `no encuentro «${ctx.fullPath(obj.sprite)}» entre los archivos cargados. `,
      button('Reparar rutas', () => ctx.relink(), 'slim'),
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
        ? `recorre ${travel} px en el bucle sobre un periodo de ${period} px` +
          (ok ? ` · cierra sin costura, ${travel / period} baldosa(s) por bucle`
              : ` · no cierra: saltará ${Math.min(off, period - off)} px`)
        : 'esperando a que cargue la imagen para saber su periodo',
    }));
    if (!ok) container.append(fixBlock(obj, scene, period, ctx));
  }
}
