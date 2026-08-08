import test from 'node:test';
import assert from 'node:assert/strict';

import { normalize } from '../src/scene.js';
import { planRelink, applyRelink, missingRefs, joinRoot } from '../src/relink.js';

const scene = (over = {}) => normalize({
  sprite_root: '',
  layers: [{ name: 'far', sprite: 'backgrounds/day/far.png' }],
  actors: [{ name: 'rider', sprite: 'characters/brendan.png' }],
  ...over,
});

test('joinRoot tolerates a trailing slash and an empty root', () => {
  assert.equal(joinRoot('sprites/x1', 'a.png'), 'sprites/x1/a.png');
  assert.equal(joinRoot('sprites/x1/', 'a.png'), 'sprites/x1/a.png');
  assert.equal(joinRoot('', 'a.png'), 'a.png');
});

test('a scene whose paths already resolve is left alone', () => {
  const s = scene({ sprite_root: 'sprites/x1' });
  const paths = ['sprites/x1/backgrounds/day/far.png', 'sprites/x1/characters/brendan.png'];
  const plan = planRelink(s, paths);
  assert.equal(plan.kind, 'none');
  assert.equal(plan.missing, 0);
});

test('one missing folder is found as a shared prefix', () => {
  // the very case that broke: scene written for sprites/x1, folder opened at
  // the project root, so every path is short by the same two segments
  const s = scene();
  const paths = [
    'sprites/x1/backgrounds/day/far.png',
    'sprites/x1/characters/brendan.png',
    'decomp/graphics/unrelated.png',
  ];
  const plan = planRelink(s, paths);
  assert.equal(plan.kind, 'prefix');
  assert.equal(plan.prefix, 'sprites/x1');

  applyRelink(s, plan);
  assert.equal(s.sprite_root, 'sprites/x1');
  assert.deepEqual(missingRefs(s, paths), [], 'everything resolves afterwards');
});

test('scattered files fall back to fixing each path', () => {
  const s = scene();
  const paths = ['art/backgrounds/day/far.png', 'somewhere/else/brendan.png'];
  const plan = planRelink(s, paths);
  assert.equal(plan.kind, 'each');

  applyRelink(s, plan);
  assert.equal(s.sprite_root, '');
  assert.equal(s.layers[0].sprite, 'art/backgrounds/day/far.png');
  assert.equal(s.actors[0].sprite, 'somewhere/else/brendan.png');
  assert.deepEqual(missingRefs(s, paths), []);
});

test('the full relative path wins over a bare file name', () => {
  const s = scene();
  const paths = [
    'other/far.png',                          // same name, wrong place
    'sprites/x1/backgrounds/day/far.png',     // the real one
    'sprites/x1/characters/brendan.png',
  ];
  const plan = planRelink(s, paths);
  const fix = plan.fixes.find(f => f.from === 'backgrounds/day/far.png');
  assert.equal(fix.to, 'sprites/x1/backgrounds/day/far.png');
});

test('an ambiguous file name is left for a human', () => {
  const s = scene({ layers: [{ name: 'far', sprite: 'far.png' }], actors: [] });
  const paths = ['a/far.png', 'b/far.png'];
  const plan = planRelink(s, paths);
  assert.equal(plan.kind, 'none');
  assert.equal(plan.missing, 1);
  assert.equal(plan.stuck.length, 1);
});

test('a partial fix stays per-element rather than moving the root', () => {
  const s = scene();
  const paths = ['sprites/x1/backgrounds/day/far.png'];   // the rider is nowhere
  const plan = planRelink(s, paths);
  assert.equal(plan.kind, 'each', 'one unresolved ref rules out a clean prefix');

  applyRelink(s, plan);
  assert.equal(s.layers[0].sprite, 'sprites/x1/backgrounds/day/far.png');
  assert.equal(missingRefs(s, paths).length, 1, 'and the rider is still reported');
});

test('applying a per-element plan keeps the untouched refs pointing somewhere', () => {
  const s = scene({ sprite_root: 'root' });
  const paths = ['root/characters/brendan.png', 'art/far.png'];
  const plan = planRelink(s, paths);
  applyRelink(s, plan);
  // the actor already resolved under the old root; it must survive the root going away
  assert.equal(s.actors[0].sprite, 'root/characters/brendan.png');
  assert.deepEqual(missingRefs(s, paths), []);
});
