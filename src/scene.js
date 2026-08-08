// The scene document: defaults, normalisation and small pure helpers.
//
// A scene is plain JSON. Nothing in here touches the DOM, so the same file can
// be imported by a renderer, a test or a command-line tool.

export const FORMAT = 'parallax-scene/1';

export const DEFAULTS = {
  format: FORMAT,
  name: 'scene',
  canvas: [640, 360],       // output size in pixels
  zoom: 2,                  // integer nearest-neighbour magnification
  world_height: null,       // null = canvas_h / zoom (no letterboxing)
  align: 'bottom',          // where the world sits inside the view
  loop_frames: 128,
  fps: 60,
  backdrop: '#000000',
  sprite_root: '',          // asset paths are relative to this
  layers: [],
  actors: [],
};

export const LAYER_DEFAULTS = {
  name: 'layer',
  sprite: '',
  y: 0,
  speed: 0,                 // px per frame, positive scrolls the art leftwards
  speed_y: 0,
  tile_period: 0,           // 0 = the image's own width
  repeat: 'x',              // 'x' | 'none'
  extend_up: false,
  extend_down: false,
  opacity: 1,
  visible: true,
  depth: -100,
};

export const ACTOR_DEFAULTS = {
  name: 'actor',
  sprite: '',
  frames: 1,
  grid: null,               // [cols, rows]; null = single horizontal strip
  order: null,              // frame playback order, e.g. [0,1,2,1]
  delay: 4,                 // frames each cel is held
  offset: 0,                // shifts this actor's cycle within the loop
  x: 0,
  y: 0,
  keys: null,
  motion: null,
  anchor: 'bottom-center',
  flip_x: false,
  flip_y: false,
  scale: 1,
  opacity: 1,
  depth: 0,
  visible: true,
};

export const ANCHORS = [
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

export const EASES = ['linear', 'in', 'out', 'in-out'];
export const MOTION_TYPES = ['sine', 'cosine', 'wobble'];

const clone = v => JSON.parse(JSON.stringify(v));

export function defaultScene() {
  return clone(DEFAULTS);
}

/** Fill in everything the renderer relies on, without mutating the input. */
export function normalize(input) {
  const s = Object.assign(clone(DEFAULTS), clone(input || {}));
  s.format = FORMAT;
  s.canvas = [Math.max(1, s.canvas?.[0] | 0 || 640), Math.max(1, s.canvas?.[1] | 0 || 360)];
  s.zoom = Math.max(1, Math.round(s.zoom) || 1);
  s.loop_frames = Math.max(1, Math.round(s.loop_frames) || 1);
  s.fps = +s.fps > 0 ? +s.fps : 60;
  s.layers = (s.layers || []).map(l => Object.assign(clone(LAYER_DEFAULTS), l));
  s.actors = (s.actors || []).map(a => {
    const actor = Object.assign(clone(ACTOR_DEFAULTS), a);
    actor.frames = Math.max(1, actor.frames | 0 || 1);
    actor.delay = Math.max(1, actor.delay | 0 || 1);
    if (Array.isArray(actor.keys) && !actor.keys.length) actor.keys = null;
    if (Array.isArray(actor.motion) && !actor.motion.length) actor.motion = null;
    if (actor.keys) actor.keys = actor.keys.slice().sort((p, q) => p.f - q.f);
    return actor;
  });
  return s;
}

/** Size of the pixel view before magnification. */
export function viewSize(scene) {
  return [Math.ceil(scene.canvas[0] / scene.zoom), Math.ceil(scene.canvas[1] / scene.zoom)];
}

/** Vertical offset from view space to world space. */
export function worldOffset(scene) {
  const vh = viewSize(scene)[1];
  const wh = scene.world_height || vh;
  if (scene.align === 'top') return 0;
  if (scene.align === 'center') return Math.round((vh - wh) / 2);
  return vh - wh;
}

/** How many frames an actor's cel cycle lasts. */
export function actorCycle(a) {
  const n = (a.order && a.order.length) ? a.order.length : Math.max(1, a.frames || 1);
  return n * Math.max(1, a.delay || 1);
}

/**
 * Actors whose cycle does not divide the loop jump when the loop wraps. It is
 * the easiest mistake to make and the hardest to see, so it gets its own check.
 */
export function cycleWarnings(scene) {
  const out = [];
  for (const a of scene.actors) {
    if (!a.visible || !a.sprite) continue;
    const cycle = actorCycle(a);
    if (scene.loop_frames % cycle) {
      out.push({
        actor: a,
        cycle,
        text: `«${a.name}» cicla cada ${cycle} fotogramas y ${scene.loop_frames} no es múltiplo: ` +
              `saltará al reiniciar. Prueba un orden de ida y vuelta (0,1,2,1) o cambia el retardo.`,
      });
    }
  }
  return out;
}

/** Strip values equal to the defaults so saved JSON stays readable. */
export function compact(scene) {
  const trim = (obj, defs) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k in defs && JSON.stringify(defs[k]) === JSON.stringify(v)) continue;
      if (v === null || v === undefined) continue;
      out[k] = v;
    }
    return out;
  };
  const s = trim(scene, { ...DEFAULTS, layers: undefined, actors: undefined });
  s.format = FORMAT;
  s.canvas = scene.canvas;
  s.zoom = scene.zoom;
  s.loop_frames = scene.loop_frames;
  s.fps = scene.fps;
  s.layers = scene.layers.map(l => ({ ...trim(l, LAYER_DEFAULTS), name: l.name, sprite: l.sprite }));
  s.actors = scene.actors.map(a => ({ ...trim(a, ACTOR_DEFAULTS), name: a.name, sprite: a.sprite }));
  return s;
}

export { clone };
