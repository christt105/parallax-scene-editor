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
  return normalizeInPlace(clone(input || {}));
}

const fillDefaults = (obj, defs) => {
  for (const [k, v] of Object.entries(defs)) {
    if (!(k in obj) || obj[k] === undefined) obj[k] = clone(v);
  }
  return obj;
};

/**
 * The same rules, applied to the object you already have.
 *
 * Editing goes through here rather than through `normalize` so that a layer or
 * an actor keeps its identity across an edit: the inspector holds a reference
 * to the thing it is editing, and swapping it for a fresh clone on every
 * keystroke is how a panel ends up writing into an object nobody is showing.
 */
export function normalizeInPlace(s) {
  fillDefaults(s, DEFAULTS);
  s.format = FORMAT;
  s.canvas = [Math.max(1, s.canvas?.[0] | 0 || 640), Math.max(1, s.canvas?.[1] | 0 || 360)];
  s.zoom = Math.max(1, Math.round(s.zoom) || 1);
  s.loop_frames = Math.max(1, Math.round(s.loop_frames) || 1);
  s.fps = +s.fps > 0 ? +s.fps : 60;
  if (!Array.isArray(s.layers)) s.layers = [];
  if (!Array.isArray(s.actors)) s.actors = [];
  for (const l of s.layers) fillDefaults(l, LAYER_DEFAULTS);
  for (const a of s.actors) {
    fillDefaults(a, ACTOR_DEFAULTS);
    a.frames = Math.max(1, a.frames | 0 || 1);
    a.delay = Math.max(1, a.delay | 0 || 1);
    if (Array.isArray(a.keys) && !a.keys.length) a.keys = null;
    if (Array.isArray(a.motion) && !a.motion.length) a.motion = null;
    if (a.keys) a.keys.sort((p, q) => p.f - q.f);
  }
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

/**
 * How far a layer has scrolled at frame `f`. The renderer rounds, so a speed
 * that does not land on a whole pixel is judged by where it actually draws.
 */
export const layerShift = (layer, f) => Math.round((layer.speed || 0) * f);

/**
 * Layers that do not land back on a tile boundary when the loop wraps.
 *
 * `periodOf` supplies the image width for layers that left `tile_period` at 0;
 * without it those are skipped rather than guessed at, because a wrong warning
 * about a file that has not loaded yet is worse than none.
 */
export function seamWarnings(scene, periodOf = () => 0) {
  const out = [];
  for (const l of scene.layers) {
    if (l.visible === false || !l.sprite || !l.speed || l.repeat === 'none') continue;
    const period = Math.round(l.tile_period) || Math.round(periodOf(l)) || 0;
    if (!period) continue;
    const travel = layerShift(l, scene.loop_frames);
    const off = ((travel % period) + period) % period;
    if (off) {
      out.push({
        layer: l,
        period,
        travel,
        off: Math.min(off, period - off),
        text: `«${l.name}» recorre ${travel} px en el bucle y el mosaico mide ${period}: ` +
              `dará un salto de ${Math.min(off, period - off)} px al reiniciar. ` +
              `Ajusta la velocidad, el periodo o los fotogramas del bucle.`,
      });
    }
  }
  return out;
}

/** Everything that will make the loop visibly jump, actors and layers alike. */
export function loopWarnings(scene, periodOf) {
  return [...seamWarnings(scene, periodOf), ...cycleWarnings(scene)];
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
