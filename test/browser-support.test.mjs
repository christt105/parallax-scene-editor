import test from 'node:test';
import assert from 'node:assert/strict';

import { folderSupportTitle } from '../src/browser-support.js';

test('brave gets pointed at the flag, not told it lacks the API', () => {
  const title = folderSupportTitle('brave');
  assert.match(title, /brave:\/\/flags/);
  assert.match(title, /File System/);
});

test('an unsupported browser is told the ceiling is permanent', () => {
  const title = folderSupportTitle('none');
  assert.match(title, /cannot write to disk/);
  assert.match(title, /Download/);
});

test('full support needs no explanation', () => {
  assert.equal(folderSupportTitle('ok'), '');
});
