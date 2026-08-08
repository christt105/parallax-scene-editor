// The two file formats written by hand. Both are checked by taking the bytes
// back apart, not by trusting that they looked right once.

import test from 'node:test';
import assert from 'node:assert/strict';

import { GifWriter, PaletteBuilder } from '../src/export/gif.js';
import { makeZip } from '../src/export/zip.js';

const bytes = async blob => new Uint8Array(await blob.arrayBuffer());

/** Paint `colors` (as [r,g,b] triples) into an RGBA buffer. */
function rgba(colors) {
  const out = new Uint8ClampedArray(colors.length * 4);
  colors.forEach((c, i) => {
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
  });
  return out;
}

test('PaletteBuilder keeps an exact palette while it fits', () => {
  const b = new PaletteBuilder();
  b.add(rgba([[1, 2, 3], [4, 5, 6], [1, 2, 3]]));
  const { palette, map, exact } = b.finish();
  assert.equal(exact, true);
  assert.equal(palette.length, 2);
  const idx = map(rgba([[4, 5, 6], [1, 2, 3]]));
  assert.deepEqual(palette[idx[0]], [4, 5, 6]);
  assert.deepEqual(palette[idx[1]], [1, 2, 3]);
});

test('PaletteBuilder falls back to median cut past 256 colours', () => {
  const b = new PaletteBuilder();
  const many = [];
  // split the counter across two channels so all 300 really are distinct
  for (let i = 0; i < 300; i++) many.push([i & 0xff, i >> 8, (i * 13) & 0xff]);
  b.add(rgba(many));
  const { palette, map, exact } = b.finish();
  assert.equal(exact, false);
  assert.ok(palette.length <= 256 && palette.length > 1);
  const idx = map(rgba(many));
  assert.equal(idx.length, many.length);
  assert.ok(idx.every(v => v < palette.length), 'every index is inside the table');
});

// -------------------------------------------------------------- GIF bytes --

/** Pull the LZW payload of the first frame back out of a GIF. */
function firstFrameData(gif) {
  let p = 13 + 3 * (1 << ((gif[10] & 7) + 1));   // header + global colour table
  while (p < gif.length) {
    if (gif[p] === 0x21) {                       // extension: skip its sub-blocks
      p += 2;
      while (gif[p]) p += gif[p] + 1;
      p++;
    } else if (gif[p] === 0x2c) {                // image descriptor
      p += 10;
      const minCodeSize = gif[p++];
      const parts = [];
      while (gif[p]) { parts.push(gif.subarray(p + 1, p + 1 + gif[p])); p += gif[p] + 1; }
      return { minCodeSize, data: Uint8Array.from(parts.flatMap(a => [...a])) };
    } else {
      break;
    }
  }
  throw new Error('no image descriptor found');
}

/**
 * A plain GIF LZW decoder, written from the spec rather than from the encoder,
 * so the two have to agree on something outside themselves.
 *
 * The decoder defines each dictionary entry one code later than the encoder
 * does, which is why its code-size step is `=== 1 << codeSize` where the
 * encoder's is `> 1 << codeSize`. Get that wrong and it desynchronises a few
 * hundred codes in, so `limit` stops a runaway before it eats the heap.
 */
function lzwDecode(data, minCodeSize, limit = 1 << 22) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let dict = [], codeSize = minCodeSize + 1, prev = null;
  const out = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push([], []);                    // placeholders for clear and eoi
    codeSize = minCodeSize + 1;
    prev = null;
  };
  reset();

  let bit = 0;
  const read = () => {
    let v = 0;
    for (let i = 0; i < codeSize; i++, bit++) {
      v |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    }
    return v;
  };

  for (;;) {
    if ((bit >> 3) > data.length) throw new Error('ran off the end of the stream');
    if (out.length > limit) throw new Error('decoder ran away');
    const code = read();
    if (code === eoi) break;
    if (code === clear) { reset(); continue; }
    let entry;
    if (code < dict.length && dict[code].length) entry = dict[code];
    else if (prev) entry = prev.concat(prev[0]);
    else throw new Error(`undefined code ${code}`);
    out.push(...entry);
    if (prev) {
      dict.push(prev.concat(entry[0]));
      if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return out;
}

test('a GIF decodes back to the exact indices it was given', async () => {
  const palette = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]];
  const pixels = new Uint8Array(64);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7 + (i >> 3)) % 4;

  const w = new GifWriter({ width: 8, height: 8, palette, delayCs: 5 });
  w.addFrame(pixels);
  w.addFrame(pixels.map(v => (v + 1) % 4));
  const gif = await bytes(w.blob());

  assert.equal(String.fromCharCode(...gif.subarray(0, 6)), 'GIF89a');
  assert.equal(gif[gif.length - 1], 0x3b, 'trailer');
  assert.equal(gif[6] | (gif[7] << 8), 8, 'width');
  assert.equal(gif[8] | (gif[9] << 8), 8, 'height');

  const { minCodeSize, data } = firstFrameData(gif);
  assert.deepEqual(lzwDecode(data, minCodeSize), [...pixels]);
});

test('a GIF survives a palette that fills the table', async () => {
  const palette = Array.from({ length: 256 }, (_, i) => [i, i, i]);
  const pixels = new Uint8Array(256);
  for (let i = 0; i < 256; i++) pixels[i] = i;          // every code used once
  const w = new GifWriter({ width: 16, height: 16, palette, delayCs: 3 });
  w.addFrame(pixels);
  const gif = await bytes(w.blob());
  const { minCodeSize, data } = firstFrameData(gif);
  assert.equal(minCodeSize, 8);
  assert.deepEqual(lzwDecode(data, minCodeSize), [...pixels]);
});

test('the dictionary can fill up and start over mid-frame', async () => {
  // high-entropy data adds a dictionary entry per code, so 60k pixels run past
  // the 4096-entry ceiling and exercise the encoder's reset
  const palette = Array.from({ length: 256 }, (_, i) => [i, (i * 3) & 0xff, (i * 7) & 0xff]);
  const pixels = new Uint8Array(60000);
  let seed = 12345;
  for (let i = 0; i < pixels.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = (seed >> 16) & 0xff;
  }
  const w = new GifWriter({ width: 300, height: 200, palette, delayCs: 4 });
  w.addFrame(pixels);
  const gif = await bytes(w.blob());
  const { minCodeSize, data } = firstFrameData(gif);
  assert.deepEqual(lzwDecode(data, minCodeSize), [...pixels]);
});

test('a long run compresses rather than growing', async () => {
  const palette = [[0, 0, 0], [255, 255, 255]];
  const flat = new Uint8Array(20000);                    // one colour, 20k pixels
  const w = new GifWriter({ width: 200, height: 100, palette, delayCs: 4 });
  w.addFrame(flat);
  const gif = await bytes(w.blob());
  assert.ok(gif.length < 2000, `expected LZW to squash it, got ${gif.length} bytes`);
  const { minCodeSize, data } = firstFrameData(gif);
  assert.deepEqual(lzwDecode(data, minCodeSize), [...flat]);
});

// -------------------------------------------------------------- ZIP bytes --

const u32 = (b, p) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24) >>> 0;

test('the zip has the headers and offsets an unzipper looks for', async () => {
  const enc = new TextEncoder();
  const files = [
    { name: '0000.png', data: enc.encode('hello') },
    { name: '0001.png', data: enc.encode('a longer body, still stored') },
  ];
  const zip = await bytes(makeZip(files));

  assert.equal(u32(zip, 0) >>> 0, 0x04034b50, 'local header');
  assert.equal(zip[8] | (zip[9] << 8), 0, 'stored, not deflated');
  // CRC-32 of "hello" is a published value: proves the table, not just itself
  assert.equal(u32(zip, 14) >>> 0, 0x3610a686);

  const end = zip.length - 22;
  assert.equal(u32(zip, end) >>> 0, 0x06054b50, 'end of central directory');
  assert.equal(zip[end + 10] | (zip[end + 11] << 8), 2, 'two entries');

  const cdOffset = u32(zip, end + 16) >>> 0;
  assert.equal(u32(zip, cdOffset) >>> 0, 0x02014b50, 'central directory sits where it says');

  const firstLocal = u32(zip, cdOffset + 42) >>> 0;
  assert.equal(u32(zip, firstLocal) >>> 0, 0x04034b50, 'and points back at a local header');

  const nameLen = zip[26] | (zip[27] << 8);
  const body = new TextDecoder().decode(zip.subarray(30 + nameLen, 30 + nameLen + 5));
  assert.equal(body, 'hello', 'the bytes are in there verbatim');
});

test('an empty zip is still a zip', async () => {
  const zip = await bytes(makeZip([]));
  assert.equal(zip.length, 22);
  assert.equal(u32(zip, 0) >>> 0, 0x06054b50);
});
