import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultScene, normalize, compact, viewSize, worldOffset, actorCycle, cycleWarnings,
  seamWarnings, loopWarnings,
} from '../src/scene.js';

test('normalize fills the gaps without touching the input', () => {
  const input = { actors: [{ sprite: 'a.png' }] };
  const s = normalize(input);
  assert.equal(s.actors[0].anchor, 'bottom-center');
  assert.equal(s.actors[0].delay, 4);
  assert.deepEqual(input, { actors: [{ sprite: 'a.png' }] }, 'input untouched');
});

test('normalize refuses degenerate numbers', () => {
  const s = normalize({ zoom: 0, loop_frames: 0, fps: -3, canvas: [0, 0] });
  assert.equal(s.zoom, 1);
  assert.equal(s.loop_frames, 1);
  assert.equal(s.fps, 60);
  assert.deepEqual(s.canvas, [640, 360]);
});

test('normalize sorts keyframes and drops empty lists', () => {
  const s = normalize({ actors: [{ sprite: 'a.png', keys: [{ f: 9 }, { f: 2 }], motion: [] }] });
  assert.deepEqual(s.actors[0].keys.map(k => k.f), [2, 9]);
  assert.equal(s.actors[0].motion, null);
});

test('viewSize is the canvas divided by the zoom, rounded up', () => {
  assert.deepEqual(viewSize(normalize({ canvas: [1280, 640], zoom: 3 })), [427, 214]);
  assert.deepEqual(viewSize(normalize({ canvas: [640, 360], zoom: 2 })), [320, 180]);
});

test('worldOffset pins the world where align says', () => {
  const base = { canvas: [640, 360], zoom: 2, world_height: 160 };  // view is 320x180
  assert.equal(worldOffset(normalize({ ...base, align: 'bottom' })), 20);
  assert.equal(worldOffset(normalize({ ...base, align: 'top' })), 0);
  assert.equal(worldOffset(normalize({ ...base, align: 'center' })), 10);
  assert.equal(worldOffset(normalize({ ...base, world_height: null })), 0,
               'no world height means no letterboxing');
});

test('actorCycle counts the order when there is one', () => {
  assert.equal(actorCycle({ frames: 4, delay: 4 }), 16);
  assert.equal(actorCycle({ frames: 3, delay: 4, order: [0, 1, 2, 1] }), 16);
});

test('cycleWarnings catches the loop that will not close', () => {
  const scene = normalize({
    loop_frames: 256,
    actors: [
      { name: 'ok', sprite: 'a.png', frames: 4, delay: 4 },      // 16, divides 256
      { name: 'jumps', sprite: 'b.png', frames: 3, delay: 4 },   // 12, does not
      { name: 'muted', sprite: 'c.png', frames: 3, delay: 4, visible: false },
    ],
  });
  const warned = cycleWarnings(scene);
  assert.equal(warned.length, 1);
  assert.equal(warned[0].actor.name, 'jumps');
  assert.equal(warned[0].cycle, 12);
});

test('compact drops defaults but survives a round trip', () => {
  const full = normalize({
    canvas: [640, 360], zoom: 2, loop_frames: 64, fps: 60,
    layers: [{ name: 'sky', sprite: 'sky.png', speed: 1, y: 4 }],
    actors: [{ name: 'a', sprite: 'a.png', frames: 2, delay: 8, x: 3, y: 5 }],
  });
  const small = compact(full);
  assert.ok(!('flip_x' in small.actors[0]), 'defaults are not written out');
  assert.ok(!('align' in small), 'and neither are scene-level ones');
  assert.deepEqual(normalize(small), full, 'but nothing is lost');
});

test('an empty scene is a valid scene', () => {
  const s = normalize(defaultScene());
  assert.deepEqual(s.actors, []);
  assert.deepEqual(cycleWarnings(s), []);
  assert.deepEqual(normalize(compact(s)), s);
});

// -------------------------------------------------------------- seams --

const withLayers = layers => normalize({ loop_frames: 128, layers });

test('a layer that lands back on a tile boundary is fine', () => {
  const s = withLayers([{ name: 'ground', sprite: 'g.png', speed: 2, tile_period: 256 }]);
  assert.deepEqual(seamWarnings(s), []);
});

test('a layer that stops half a tile short is caught, with the size of the jump', () => {
  const s = withLayers([{ name: 'hills', sprite: 'h.png', speed: 1, tile_period: 256 }]);
  const [w] = seamWarnings(s);
  assert.equal(w.layer.name, 'hills');
  assert.equal(w.travel, 128);
  assert.equal(w.off, 128);
});

test('the jump reported is the shorter way round', () => {
  // 128 px into a 130 px tile is a 2 px hop back, not a 128 px lurch forward
  const s = withLayers([{ name: 'trees', sprite: 't.png', speed: 1, tile_period: 130 }]);
  const [w] = seamWarnings(s);
  assert.equal(w.travel, 128);
  assert.equal(w.off, 2);
});

test('a still, hidden or unrepeated layer has no seam to speak of', () => {
  const s = withLayers([
    { name: 'still', sprite: 'a.png', speed: 0, tile_period: 320 },
    { name: 'hidden', sprite: 'b.png', speed: 1, tile_period: 256, visible: false },
    { name: 'once', sprite: 'c.png', speed: 1, tile_period: 256, repeat: 'none' },
  ]);
  assert.deepEqual(seamWarnings(s), []);
});

test('a fractional speed is judged where the renderer actually draws it', () => {
  // round(0.3 * 128) = 38, and 38 is not a whole number of 19 px tiles… it is
  const s = withLayers([{ name: 'sky', sprite: 's.png', speed: 0.3, tile_period: 19 }]);
  assert.deepEqual(seamWarnings(s), []);
  const off = withLayers([{ name: 'sky', sprite: 's.png', speed: 0.3, tile_period: 20 }]);
  assert.equal(seamWarnings(off)[0].travel, 38);
});

test('a layer with no period of its own borrows the image width', () => {
  const s = withLayers([{ name: 'ground', sprite: 'g.png', speed: 1 }]);
  assert.deepEqual(seamWarnings(s), [], 'unknown width: nothing to claim');
  assert.equal(seamWarnings(s, () => 256).length, 1, 'a 128 px scroll over a 256 px image jumps');
  assert.deepEqual(seamWarnings(s, () => 128), [], 'over a 128 px image it closes');
});

test('loopWarnings gathers both halves of the same mistake', () => {
  const s = normalize({
    loop_frames: 128,
    layers: [{ name: 'hills', sprite: 'h.png', speed: 1, tile_period: 256 }],
    actors: [{ name: 'walker', sprite: 'w.png', frames: 3, delay: 5 }],
  });
  assert.deepEqual(loopWarnings(s).map(w => (w.layer || w.actor).name), ['hills', 'walker']);
});
