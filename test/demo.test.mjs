// The scene the editor opens with is the first thing anybody sees, and it
// shipped for three commits with three layers that jumped, a bird that flew
// backwards and a cloud that popped into frame. None of that was visible from
// the code — only from the numbers — so here are the numbers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalize, loopWarnings, viewSize } from '../src/scene.js';
import { actorPos, anchorOffset, celRect } from '../src/anim.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = join(ROOT, 'demo');

const scene = normalize(JSON.parse(readFileSync(join(DEMO, 'scene.json'), 'utf8')));
const assetPath = sprite => join(DEMO, scene.sprite_root, sprite);

/** Width and height straight out of a PNG's IHDR — cheaper than a decoder. */
function pngSize(file) {
  const b = readFileSync(file);
  assert.equal(b.toString('ascii', 1, 4), 'PNG', `${file} is not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('every sprite the demo names is actually in the folder', () => {
  for (const el of [...scene.layers, ...scene.actors]) {
    assert.doesNotThrow(() => pngSize(assetPath(el.sprite)), `missing ${el.sprite}`);
  }
});

test('the demo loop closes: no layer seam, no actor cel jump', () => {
  const periodOf = l => pngSize(assetPath(l.sprite))[0];
  const warnings = loopWarnings(scene, periodOf);
  assert.deepEqual(warnings.map(w => w.text), []);
});

test('the layers are ordered back to front by how fast they scroll', () => {
  const byDepth = scene.layers.slice().sort((a, b) => a.depth - b.depth);
  const speeds = byDepth.map(l => l.speed);
  for (let i = 1; i < speeds.length; i++) {
    assert.ok(speeds[i] > speeds[i - 1],
      `“${byDepth[i].name}” is nearer than “${byDepth[i - 1].name}” but not faster ` +
      `(${speeds[i - 1]} → ${speeds[i]})`);
  }
});

/** Where an actor's cel sits, in view pixels, at a frame. */
function box(actor, f) {
  const [iw, ih] = pngSize(assetPath(actor.sprite));
  const { fw, fh } = celRect(actor, iw, ih);
  const scale = Math.max(1, actor.scale || 1);
  const w = fw * scale, h = fh * scale;
  const [px] = actorPos(actor, f, scene.loop_frames);
  const [ax] = anchorOffset(actor.anchor, w, h);
  return { left: Math.round(px + ax), right: Math.round(px + ax) + w };
}

test('nothing pops: an actor that jumps at the wrap does it off screen', () => {
  const [vw] = viewSize(scene);
  const last = scene.loop_frames - 1;
  for (const a of scene.actors) {
    if (!a.keys) continue;
    const end = box(a, last), start = box(a, 0);
    const moved = Math.abs(start.left - end.left);
    if (moved <= 2) continue;                       // it barely moves: no pop to hide
    for (const [label, b] of [[`f${last}`, end], ['f0', start]]) {
      assert.ok(b.right <= 0 || b.left >= vw,
        `“${a.name}” jumps ${moved} px at the wrap while visible at ${label} ` +
        `(${b.left}…${b.right} inside 0…${vw})`);
    }
  }
});

test('an actor with keys never lurches in the middle of the loop either', () => {
  for (const a of scene.actors) {
    if (!a.keys) continue;
    for (let f = 0; f < scene.loop_frames - 1; f++) {
      const [x0, y0] = actorPos(a, f, scene.loop_frames);
      const [x1, y1] = actorPos(a, f + 1, scene.loop_frames);
      const step = Math.hypot(x1 - x0, y1 - y0);
      assert.ok(step < 16, `“${a.name}” moves ${step.toFixed(1)} px between f${f} and f${f + 1}`);
    }
  }
});

test('the demo runs at a pace you can actually look at', () => {
  const seconds = scene.loop_frames / scene.fps;
  assert.ok(seconds >= 4 && seconds <= 15, `a ${seconds.toFixed(1)} s loop is not a demo`);
  const [vw] = viewSize(scene);
  const ground = scene.layers.find(l => l.name === 'ground');
  const crossing = vw / (ground.speed * scene.fps);
  assert.ok(crossing >= 2.5, `the ground crosses the view in ${crossing.toFixed(1)} s`);
});
