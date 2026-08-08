// The sampling maths: no DOM, no canvas, so `node --test` runs it as is.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ease, sampleKeys, applyMotion, actorCel, anchorOffset, celRect } from '../src/anim.js';

test('ease curves stay pinned at both ends', () => {
  for (const kind of ['linear', 'in', 'out', 'in-out']) {
    assert.equal(ease(0, kind), 0, kind);
    assert.equal(ease(1, kind), 1, kind);
  }
  assert.ok(ease(0.25, 'in') < 0.25, 'ease-in starts slow');
  assert.ok(ease(0.25, 'out') > 0.25, 'ease-out starts fast');
});

test('sampleKeys interpolates between keys', () => {
  const keys = [{ f: 0, x: 0, y: 0 }, { f: 10, x: 100, y: 50 }];
  assert.deepEqual(sampleKeys(keys, 0, 20), [0, 0]);
  assert.deepEqual(sampleKeys(keys, 5, 20), [50, 25]);
});

test('sampleKeys closes the ring, so the loop has no seam', () => {
  const keys = [{ f: 0, x: 0, y: 0 }, { f: 8, x: 80, y: 0 }];
  // the tail segment runs 8 -> 16(=0), so half way back is x = 40
  assert.deepEqual(sampleKeys(keys, 12, 16), [40, 0]);
  // and one full loop later lands on the same place as frame 0
  assert.deepEqual(sampleKeys(keys, 16, 16), sampleKeys(keys, 0, 16));
});

test('sampleKeys handles a lone key and unsorted input', () => {
  assert.deepEqual(sampleKeys([{ f: 4, x: 7, y: 9 }], 0, 16), [7, 9]);
  const messy = [{ f: 10, x: 100, y: 0 }, { f: 0, x: 0, y: 0 }];
  assert.deepEqual(sampleKeys(messy, 5, 20), [50, 0]);
});

test('sampleKeys covers frames before the first key', () => {
  const keys = [{ f: 4, x: 0, y: 0 }, { f: 12, x: 80, y: 0 }];
  const [x] = sampleKeys(keys, 0, 16);
  assert.ok(x > 0 && x < 80, `expected a point on the wrapped tail, got ${x}`);
});

test('applyMotion sums every enabled entry onto the right axis', () => {
  const motion = [
    { type: 'sine', axis: 'y', amp: 10, period: 4 },
    { type: 'cosine', axis: 'x', amp: 10, period: 4 },
    { type: 'sine', axis: 'y', amp: 99, period: 4, enabled: false },
  ];
  const [dx, dy] = applyMotion(motion, 1, 64);
  assert.ok(Math.abs(dy - 10) < 1e-9, `sine peaks at a quarter period: ${dy}`);
  assert.ok(Math.abs(dx) < 1e-9, `cosine crosses zero there: ${dx}`);
});

test('applyMotion phase shifts a sine into a cosine', () => {
  const a = applyMotion([{ type: 'sine', axis: 'y', amp: 5, period: 8, phase: 90 }], 0, 8);
  const b = applyMotion([{ type: 'cosine', axis: 'y', amp: 5, period: 8 }], 0, 8);
  assert.ok(Math.abs(a[1] - b[1]) < 1e-9);
});

test('wobble is a four-step square wave held N frames per step', () => {
  const m = [{ type: 'wobble', axis: 'y', amp: 1, hold: 2 }];
  const seen = [0, 2, 4, 6, 8].map(f => applyMotion(m, f, 32)[1]);
  assert.deepEqual(seen, [0, -1, 0, 1, 0]);
});

test('actorCel walks the sheet, then the order, then the offset', () => {
  const plain = { frames: 4, delay: 2 };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(f => actorCel(plain, f)),
                   [0, 0, 1, 1, 2, 2, 3, 3, 0]);

  const pingpong = { frames: 3, delay: 1, order: [0, 1, 2, 1] };
  assert.deepEqual([0, 1, 2, 3, 4].map(f => actorCel(pingpong, f)), [0, 1, 2, 1, 0]);

  assert.equal(actorCel({ frames: 4, delay: 2, offset: 2 }, 0), 1);
});

test('actorCel never points outside the sheet', () => {
  // an order left behind after the sprite was swapped for a shorter one
  assert.equal(actorCel({ frames: 2, delay: 1, order: [0, 5] }, 1), 1);
});

test('anchorOffset covers all nine anchors', () => {
  assert.deepEqual(anchorOffset('top-left', 10, 20), [0, 0]);
  assert.deepEqual(anchorOffset('center', 10, 20), [-5, -10]);
  assert.deepEqual(anchorOffset('bottom-center', 10, 20), [-5, -20]);
  assert.deepEqual(anchorOffset('bottom-right', 10, 20), [-10, -20]);
  assert.deepEqual(anchorOffset('top-right', 10, 20), [-10, 0]);
  assert.deepEqual(anchorOffset('center-left', 10, 20), [0, -10]);
  assert.deepEqual(anchorOffset(undefined, 10, 20), [-5, -20], 'defaults to the feet');
});

test('celRect splits strips and grids', () => {
  assert.deepEqual(celRect({ frames: 4 }, 96, 24), { fw: 24, fh: 24, cols: 4, rows: 1 });
  assert.deepEqual(celRect({ frames: 6, grid: [3, 2] }, 48, 32), { fw: 16, fh: 16, cols: 3, rows: 2 });
});
