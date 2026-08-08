import test from 'node:test';
import assert from 'node:assert/strict';
import { FileWatcher } from '../src/watch.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

/** A little disk: keys with mtimes, some of them unreadable. */
function fakeFiles(initial) {
  const files = new Map(Object.entries(initial));
  const reads = [];
  return {
    files,
    reads,
    list: () => [...files.keys()],
    stamp: async key => { reads.push(key); return files.get(key) ?? null; },
    touch: (key, at) => files.set(key, at),
  };
}

function watcher(disk, opts = {}) {
  const changed = [];
  const w = new FileWatcher({
    list: disk.list,
    stamp: disk.stamp,
    onChanged: keys => { changed.push(...keys); },
    ...opts,
  });
  return { w, changed };
}

test('the first sweep only learns; it reports nothing', async () => {
  const disk = fakeFiles({ 'a.png': 1, 'b.png': 1 });
  const { w, changed } = watcher(disk);
  await w.sweep();
  assert.deepEqual(changed, []);
  assert.equal(w.stamps.get('a.png'), 1);
});

test('a file whose stamp moves is reported', async () => {
  const disk = fakeFiles({ 'a.png': 1, 'b.png': 1 });
  const { w, changed } = watcher(disk);
  await w.sweep();
  disk.touch('b.png', 2);
  await w.sweep();
  assert.deepEqual(changed, ['b.png']);
});

test('a file nobody reloaded stays changed until it is marked', async () => {
  const disk = fakeFiles({ 'a.png': 1 });
  const { w, changed } = watcher(disk);
  await w.sweep();
  disk.touch('a.png', 2);
  await w.sweep();
  await w.sweep();
  assert.deepEqual(changed, ['a.png', 'a.png'], 'a half-written sprite gets another go');

  w.mark('a.png', 2);            // the reload finally worked
  await w.sweep();
  assert.equal(changed.length, 2, 'and then it goes quiet');
});

test('an unreadable file is skipped, not remembered', async () => {
  const disk = fakeFiles({ 'gone.png': 1 });
  const { w, changed } = watcher(disk);
  disk.files.delete('gone.png');
  disk.files.set('gone.png', undefined);   // still listed, no stamp
  await w.sweep();
  assert.equal(w.stamps.has('gone.png'), false);
  assert.deepEqual(changed, []);
});

test('the batch walks the list in a ring instead of only the front', async () => {
  const disk = fakeFiles({ 'a': 1, 'b': 1, 'c': 1, 'd': 1, 'e': 1 });
  const { w } = watcher(disk, { batch: 2 });
  await w.sweep();
  await w.sweep();
  await w.sweep();
  assert.deepEqual(disk.reads, ['a', 'b', 'c', 'd', 'e', 'a']);
  assert.equal(w.stamps.size, 5, 'three rounds of two cover all five');
});

test('a batch bigger than the list does not read anything twice', async () => {
  const disk = fakeFiles({ 'a': 1, 'b': 1 });
  const { w } = watcher(disk, { batch: 10 });
  await w.sweep();
  assert.deepEqual(disk.reads, ['a', 'b']);
});

test('an empty list is free and resets the ring', async () => {
  const disk = fakeFiles({});
  const { w } = watcher(disk, { batch: 4 });
  w.cursor = 7;
  assert.deepEqual(await w.sweep(), []);
  assert.equal(w.cursor, 0);
  assert.equal(disk.reads.length, 0);
});

test('a list that shrinks does not walk off the end', async () => {
  const disk = fakeFiles({ 'a': 1, 'b': 1, 'c': 1, 'd': 1 });
  const { w } = watcher(disk, { batch: 3 });
  await w.sweep();
  disk.files.delete('c');
  disk.files.delete('d');
  const before = disk.reads.length;
  await w.sweep();
  assert.ok(disk.reads.slice(before).every(k => k === 'a' || k === 'b'));
});

test('running polls on its own and stops when told', async t => {
  const disk = fakeFiles({ 'a': 1 });
  const { w, changed } = watcher(disk, { interval: 10 });
  t.after(() => w.stop());
  w.start();
  await wait(25);                 // let it learn what is there
  disk.touch('a', 2);
  await wait(60);
  assert.ok(w.sweeps >= 2, `expected a few rounds, got ${w.sweeps}`);
  assert.ok(changed.includes('a'));

  w.stop();
  const rounds = w.sweeps;
  await wait(50);
  assert.equal(w.sweeps, rounds, 'a stopped watcher stays stopped');
});

test('a paused watcher keeps its timer but reads nothing', async t => {
  const disk = fakeFiles({ 'a': 1 });
  let hidden = true;
  const { w } = watcher(disk, { interval: 10, paused: () => hidden });
  t.after(() => w.stop());
  w.start();
  await wait(50);
  assert.equal(disk.reads.length, 0, 'a hidden tab watches nothing');

  hidden = false;
  await wait(50);
  assert.ok(disk.reads.length > 0, 'and picks straight back up');
  w.stop();
});

test('a slow round does not stack on itself', async t => {
  const disk = fakeFiles({ 'a': 1 });
  let open = 0, overlapped = false;
  const w = new FileWatcher({
    list: disk.list,
    interval: 5,
    stamp: async key => {
      if (++open > 1) overlapped = true;
      await wait(30);
      open--;
      return disk.files.get(key);
    },
    onChanged: () => {},
  });
  t.after(() => w.stop());
  w.start();
  await wait(120);
  w.stop();
  assert.equal(overlapped, false);
});

test('a throwing stamp does not kill the loop', async t => {
  let boom = true;
  const w = new FileWatcher({
    list: () => ['a'],
    interval: 10,
    stamp: async () => { if (boom) throw new Error('E/A'); return 7; },
    onChanged: () => {},
  });
  t.after(() => w.stop());
  w.start();
  await wait(40);
  boom = false;
  await wait(40);
  w.stop();
  assert.equal(w.stamps.get('a'), 7, 'it recovered once the disk did');
});

test('clear forgets everything, so the next sweep only learns again', async () => {
  const disk = fakeFiles({ 'a': 1 });
  const { w, changed } = watcher(disk);
  await w.sweep();
  disk.touch('a', 2);
  w.clear();
  await w.sweep();
  assert.deepEqual(changed, [], 'a full refresh already reloaded it');
});
