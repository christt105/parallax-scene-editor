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
        text: `«${a.name}» cycles every ${cycle} frames and ${scene.loop_frames} is not a ` +
              `multiple: it will jump at the wrap. Try a there-and-back order (0,1,2,1) or another delay.`,
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
        text: `«${l.name}» travels ${travel} px per loop over a ${period} px tile: ` +
              `it will jump ${Math.min(off, period - off)} px at the wrap. ` +
              `Its panel lists the speeds that would close it.`,
      });
    }
  }
  return out;
}

/** Everything that will make the loop visibly jump, actors and layers alike. */
export function loopWarnings(scene, periodOf) {
  return [...seamWarnings(scene, periodOf), ...cycleWarnings(scene)];
}

// ------------------------------------------------------- making it close --
//
// Knowing that a loop does not close is half a warning. The rule has an exact
// solution in both directions, so the editor can hand over the numbers instead
// of leaving you to hunt for them:
//
//   a layer closes  ⟺  speed × loop_frames is a whole number of tile periods
//   an actor closes ⟺  loop_frames is a whole number of cel cycles
//
// So the speeds that work are the multiples of `period / loop_frames` — one
// tile per loop, two tiles per loop, and so on — and for any set of speeds
// there is a shortest loop that suits all of them at once.

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const lcm = (a, b) => (!a || !b ? 0 : Math.abs(a * b) / gcd(a, b));

/** `x` as a whole fraction, for the short tidy numbers a speed really is. */
export function ratio(x, maxDen = 512) {
  const v = Math.abs(+x || 0);
  for (let q = 1; q <= maxDen; q++) {
    const p = v * q;
    if (Math.abs(p - Math.round(p)) < 1e-9) return [Math.round(p), q];
  }
  return [Math.round(v * maxDen), maxDen];
}

/** How far apart the speeds that close are: one tile per loop. */
export const speedStep = (period, loop) => (period > 0 && loop > 0 ? period / loop : 0);

/**
 * The speeds either side of this one that land back on a tile boundary.
 *
 * Two of them, because which one you want is a matter of taste — nearer layers
 * faster, farther slower — and that is the part no editor gets to decide.
 */
export function speedOptions(speed, period, loop) {
  const step = speedStep(period, loop);
  if (!step) return [];
  const k = (+speed || 0) / step;
  const below = Math.max(0, Math.floor(k + 1e-9));
  const out = [below * step, (below + 1) * step];
  return out.filter(v => Math.abs(v - (+speed || 0)) > 1e-9);
}

/**
 * Delays either side of this one whose cel cycle divides the loop.
 *
 * The other fix for an actor is `order`: a there-and-back list turns a cycle of
 * three into one of four. That one changes how the animation reads, so it stays
 * a decision rather than a button.
 */
export function delayOptions(actor, loop, span = 64) {
  const n = (actor.order && actor.order.length) ? actor.order.length
                                                : Math.max(1, actor.frames || 1);
  const now = Math.max(1, actor.delay | 0 || 1);
  const fits = [];
  for (let d = 1; d <= span; d++) if (loop % (n * d) === 0) fits.push(d);
  const below = fits.filter(d => d < now).pop();
  const above = fits.find(d => d > now);
  return [below, above].filter(d => d !== undefined);
}

/** Loops this element would be happy with: every multiple of the number given. */
function loopUnit(el, kind, periodOf) {
  if (kind === 'actor') return actorCycle(el);
  if (!el.speed || el.repeat === 'none') return 1;
  const period = Math.round(el.tile_period) || Math.round(periodOf(el)) || 0;
  if (!period) return 1;
  // speed = p/q, so speed × L is a multiple of P exactly when L is a
  // multiple of P·q / gcd(p, P·q).
  const [p, q] = ratio(el.speed);
  if (!p) return 1;
  return (period * q) / gcd(p, period * q);
}

const LOOP_CAP = 8192;   // past here the answer is "rethink the speeds"

/**
 * The shortest loop that would close everything exactly as it is now, and the
 * shortest one that is at least as long as the loop already set.
 *
 * Returns null when the numbers only meet somewhere absurd — a speed of 0.37
 * over a 256 px tile wants tens of thousands of frames, and the honest advice
 * there is to change the speed, not the loop.
 */
export function loopOptions(scene, periodOf = () => 0) {
  let unit = 1;
  const parts = [
    ...scene.layers.map(el => [el, 'layer']),
    ...scene.actors.map(el => [el, 'actor']),
  ];
  for (const [el, kind] of parts) {
    if (el.visible === false || !el.sprite) continue;
    unit = lcm(unit, loopUnit(el, kind, periodOf));
    if (!unit || unit > LOOP_CAP) return null;
  }
  const current = Math.max(1, scene.loop_frames | 0);
  return { min: unit, next: Math.max(unit, Math.ceil(current / unit) * unit) };
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
