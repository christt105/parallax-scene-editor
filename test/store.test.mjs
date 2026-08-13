import test from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../src/store.js';

const LIMIT = 200;   // mirrors the LIMIT in src/store.js, which is not exported

const oneActor = () => ({ actors: [{ sprite: 'a.png' }] });
const setX = x => s => { s.actors[0].x = x; };

test('a fresh store starts with empty history', () => {
  const store = new Store(oneActor());
  assert.equal(store.canUndo, false);
  assert.equal(store.canRedo, false);
});

test('commit applies the mutation and pushes one history entry', () => {
  const store = new Store(oneActor());
  store.commit(null, setX(5));
  assert.equal(store.scene.actors[0].x, 5);
  assert.equal(store.past.length, 1);
  assert.equal(store.canUndo, true);
});

test('a null label never merges, even back to back', () => {
  const store = new Store(oneActor());
  store.commit(null, setX(1));
  store.commit(null, setX(2));
  assert.equal(store.past.length, 2);
});

test('two different labels never merge', () => {
  const store = new Store(oneActor());
  store.commit('move', setX(1));
  store.commit('resize', setX(2));
  assert.equal(store.past.length, 2);
});

test('consecutive commits with the same label within 700ms coalesce into one step', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const store = new Store(oneActor());
  store.commit('drag', setX(1));
  t.mock.timers.tick(699);
  store.commit('drag', setX(2));
  t.mock.timers.tick(699);
  store.commit('drag', setX(3));
  assert.equal(store.past.length, 1, 'the whole drag is one undo step');
  assert.equal(store.scene.actors[0].x, 3);
  store.undo();
  assert.equal(store.scene.actors[0].x, 0, 'undoing the merged step goes all the way back');
});

test('700ms exactly is already too late to merge', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const store = new Store(oneActor());
  store.commit('drag', setX(1));
  t.mock.timers.tick(700);
  store.commit('drag', setX(2));
  assert.equal(store.past.length, 2);
});

test('a gap past 700ms starts a fresh step under the same label', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const store = new Store(oneActor());
  store.commit('drag', setX(1));
  t.mock.timers.tick(701);
  store.commit('drag', setX(2));
  assert.equal(store.past.length, 2);
  store.undo();
  assert.equal(store.scene.actors[0].x, 1, 'only the second drag is undone');
});

test('undo and redo walk the history back and forth', () => {
  const store = new Store(oneActor());
  store.commit(null, setX(1));
  store.commit(null, setX(2));
  assert.equal(store.undo(), true);
  assert.equal(store.scene.actors[0].x, 1);
  assert.equal(store.undo(), true);
  assert.equal(store.scene.actors[0].x, 0);
  assert.equal(store.undo(), false, 'nothing left to undo');

  assert.equal(store.redo(), true);
  assert.equal(store.scene.actors[0].x, 1);
  assert.equal(store.redo(), true);
  assert.equal(store.scene.actors[0].x, 2);
  assert.equal(store.redo(), false, 'nothing left to redo');
});

test('a commit after an undo discards the pending redo stack', () => {
  const store = new Store(oneActor());
  store.commit(null, setX(1));
  store.commit(null, setX(2));
  store.undo();
  assert.equal(store.canRedo, true);
  store.commit(null, setX(9));
  assert.equal(store.canRedo, false, 'the branch taken after undo replaces the old future');
  assert.equal(store.redo(), false);
});

test('history is capped at LIMIT steps, oldest first to go', () => {
  const store = new Store(oneActor());
  for (let i = 1; i <= LIMIT + 5; i++) store.commit(null, setX(i));
  assert.equal(store.past.length, LIMIT);

  let undone = 0;
  while (store.undo()) undone++;
  assert.equal(undone, LIMIT);
  assert.equal(store.scene.actors[0].x, 5, 'the five oldest steps fell off the end');
});

test('replace pushes one history entry and resets the merge label', () => {
  const store = new Store(oneActor());
  store.commit('drag', setX(1));
  store.replace({ actors: [{ sprite: 'b.png' }] });
  assert.equal(store.past.length, 2);
  assert.equal(store.scene.actors[0].sprite, 'b.png');
  assert.equal(store.lastLabel, null);
  assert.equal(store.canRedo, false);
});

test('replace with history:false does not touch the undo stack', () => {
  const store = new Store(oneActor());
  store.commit(null, setX(1));
  const before = store.past.length;
  store.replace({ actors: [{ sprite: 'b.png' }] }, { history: false });
  assert.equal(store.past.length, before);
});

test('subscribe hears every commit, with its label as the reason', () => {
  const store = new Store(oneActor());
  const seen = [];
  const unsubscribe = store.subscribe((scene, reason) => seen.push(reason));
  store.commit('drag', setX(1));
  store.commit(null, setX(2));
  assert.deepEqual(seen, ['drag', 'change']);

  unsubscribe();
  store.commit(null, setX(3));
  assert.equal(seen.length, 2, 'no more events after unsubscribing');
});

test('undo and redo emit their own reasons', () => {
  const store = new Store(oneActor());
  const seen = [];
  store.subscribe((scene, reason) => seen.push(reason));
  store.commit(null, setX(1));
  store.undo();
  store.redo();
  assert.deepEqual(seen, ['change', 'undo', 'redo']);
});
