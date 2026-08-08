import test from 'node:test';
import assert from 'node:assert/strict';
import { DiskAutosave, IDLE, PENDING, SAVING, SAVED, ERROR } from '../src/autosave.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

/** A disk that records what it was told, and can be made slow or broken. */
function fakeDisk({ delay = 0, fail = null } = {}) {
  const writes = [];
  let inFlight = 0, overlapped = false;
  const write = async (path, text) => {
    if (++inFlight > 1) overlapped = true;
    try {
      if (delay) await wait(delay);
      if (fail) throw fail;
      writes.push([path, text]);
    } finally { inFlight--; }
  };
  return { write, writes, get overlapped() { return overlapped; } };
}

test('a burst of edits becomes one write', async () => {
  const disk = fakeDisk();
  const a = new DiskAutosave({ write: disk.write, delay: 5 });
  for (let i = 0; i < 20; i++) a.request('scene.json', `v${i}`);
  await wait(40);
  assert.deepEqual(disk.writes, [['scene.json', 'v19']]);
  assert.equal(a.state, SAVED);
});

test('writing the same text again writes nothing', async () => {
  const disk = fakeDisk();
  const a = new DiskAutosave({ write: disk.write, delay: 1 });
  a.request('scene.json', 'same');
  await wait(20);
  assert.equal(a.request('scene.json', 'same'), false);
  await wait(20);
  assert.equal(disk.writes.length, 1);
});

test('seed makes the first identical edit a no-op, a different one a write', async () => {
  const disk = fakeDisk();
  const a = new DiskAutosave({ write: disk.write, delay: 1 });
  a.seed('scene.json', 'onDisk');
  assert.equal(a.state, SAVED);
  assert.equal(a.request('scene.json', 'onDisk'), false);
  assert.equal(a.request('scene.json', 'edited'), true);
  await wait(20);
  assert.deepEqual(disk.writes, [['scene.json', 'edited']]);
});

test('edits landing mid-write are not lost, and never overlap', async () => {
  const disk = fakeDisk({ delay: 20 });
  const a = new DiskAutosave({ write: disk.write, delay: 1 });
  a.request('scene.json', 'first');
  await wait(10);                       // the write is in flight
  assert.equal(a.state, SAVING);
  a.request('scene.json', 'second');    // …and here comes another edit
  await a.flush();
  assert.equal(disk.overlapped, false, 'two writes must never be open at once');
  assert.deepEqual(disk.writes, [['scene.json', 'first'], ['scene.json', 'second']]);
  assert.equal(a.state, SAVED);
});

test('flush writes now instead of waiting out the debounce', async () => {
  const disk = fakeDisk();
  const a = new DiskAutosave({ write: disk.write, delay: 10000 });
  a.request('scene.json', 'urgent');
  await a.flush();
  assert.deepEqual(disk.writes, [['scene.json', 'urgent']]);
});

test('flush with nothing queued does nothing and still resolves', async () => {
  const disk = fakeDisk();
  const a = new DiskAutosave({ write: disk.write, delay: 1 });
  await a.flush();
  assert.equal(disk.writes.length, 0);
});

test('a failed write stops the autosave instead of retrying forever', async () => {
  const disk = fakeDisk({ fail: new Error('permiso denegado') });
  const states = [];
  const a = new DiskAutosave({ write: disk.write, delay: 1, onState: s => states.push(s) });
  a.request('scene.json', 'x');
  await wait(20);
  assert.equal(a.state, ERROR);
  assert.equal(a.error.message, 'permiso denegado');
  assert.equal(a.enabled, false);
  assert.equal(a.request('scene.json', 'y'), false, 'a stopped autosave queues nothing');
  await wait(20);
  assert.ok(states.includes(PENDING) && states.includes(SAVING) && states.includes(ERROR));
});

test('re-enabling after an error clears it and works again', async () => {
  let broken = true;
  const writes = [];
  const a = new DiskAutosave({
    delay: 1,
    write: async (p, t) => { if (broken) throw new Error('nope'); writes.push([p, t]); },
  });
  a.request('scene.json', 'x');
  await wait(20);
  assert.equal(a.state, ERROR);

  broken = false;
  a.enable(true);
  assert.equal(a.state, IDLE);
  assert.equal(a.error, null);
  a.request('scene.json', 'x');
  await wait(20);
  assert.deepEqual(writes, [['scene.json', 'x']]);
});

test('disabled means nothing reaches the disk', async () => {
  const disk = fakeDisk();
  const a = new DiskAutosave({ write: disk.write, delay: 1 });
  a.request('scene.json', 'queued');
  a.enable(false);
  await wait(20);
  await a.flush();
  assert.equal(disk.writes.length, 0);
  assert.equal(a.state, IDLE);
});

test('reset forgets the target so no edit reaches the old file', async () => {
  const disk = fakeDisk();
  const a = new DiskAutosave({ write: disk.write, delay: 1 });
  a.seed('old.json', 'v1');
  a.request('old.json', 'v2');
  a.reset();
  await wait(20);
  assert.equal(disk.writes.length, 0);
  // and the seed is gone: the same text is new again for the next file
  assert.equal(a.request('new.json', 'v1'), true);
});

test('a rename moves the writes to the new path', async () => {
  const disk = fakeDisk();
  const a = new DiskAutosave({ write: disk.write, delay: 1 });
  a.seed('a.json', 'body');
  assert.equal(a.request('b.json', 'body'), true, 'same body, different file, still a write');
  await wait(20);
  assert.deepEqual(disk.writes, [['b.json', 'body']]);
});

test('clean reports whether the disk is caught up', async () => {
  const disk = fakeDisk({ delay: 20 });
  const a = new DiskAutosave({ write: disk.write, delay: 1 });
  assert.equal(a.clean, true);
  a.request('scene.json', 'x');
  assert.equal(a.clean, false);
  await a.flush();
  assert.equal(a.clean, true);
});
