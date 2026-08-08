// A GIF89a encoder, written here so the editor stays dependency-free and can
// be served as plain files from GitHub Pages.
//
// Pixel art is the happy case: a whole animation usually holds fewer than 256
// distinct colours, so the encoder first tries to build an exact palette and
// only falls back to median cut when that overflows. Exact means the GIF is
// bit-for-bit the frames you saw, with no dithering and no colour drift.

class ByteWriter {
  constructor() { this.buf = new Uint8Array(1 << 16); this.len = 0; }
  _room(n) {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  byte(b) { this._room(1); this.buf[this.len++] = b & 0xff; }
  bytes(arr) { this._room(arr.length); this.buf.set(arr, this.len); this.len += arr.length; }
  short(v) { this.byte(v); this.byte(v >> 8); }
  ascii(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  /** GIF data is carried in sub-blocks of at most 255 bytes. */
  blocks(data) {
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      this.byte(n);
      this.bytes(data.subarray(i, i + n));
    }
    this.byte(0);
  }
  done() { return this.buf.slice(0, this.len); }
}

function lzw(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const out = [];
  let cur = 0, curBits = 0;

  const emit = (code, size) => {
    cur |= code << curBits;
    curBits += size;
    while (curBits >= 8) { out.push(cur & 0xff); cur >>= 8; curBits -= 8; }
  };

  let codeSize = minCodeSize + 1;
  let next = eoiCode + 1;
  let dict = new Map();

  emit(clearCode, codeSize);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix, codeSize);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clearCode, codeSize);
      dict = new Map();
      next = eoiCode + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = k;
  }
  emit(prefix, codeSize);
  emit(eoiCode, codeSize);
  if (curBits > 0) out.push(cur & 0xff);
  return Uint8Array.from(out);
}

// ------------------------------------------------------------- quantising --

/** Median cut over the colours actually present, weighted by pixel count. */
function medianCut(counts, max) {
  const entries = [...counts.entries()].map(([key, n]) => ({
    r: (key >> 16) & 0xff, g: (key >> 8) & 0xff, b: key & 0xff, n,
  }));
  let boxes = [entries];
  while (boxes.length < max) {
    let pick = -1, spread = -1, axis = 'r';
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (const c of ['r', 'g', 'b']) {
        let lo = 255, hi = 0;
        for (const e of box) { if (e[c] < lo) lo = e[c]; if (e[c] > hi) hi = e[c]; }
        if (hi - lo > spread) { spread = hi - lo; pick = i; axis = c; }
      }
    });
    if (pick < 0 || spread <= 0) break;
    const box = boxes[pick].slice().sort((a, b) => a[axis] - b[axis]);
    const half = Math.max(1, Math.min(box.length - 1, Math.floor(box.length / 2)));
    boxes.splice(pick, 1, box.slice(0, half), box.slice(half));
  }
  return boxes.filter(b => b.length).map(box => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const e of box) { r += e.r * e.n; g += e.g * e.n; b += e.b * e.n; n += e.n; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

function nearest(palette, r, g, b) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

const MAX_TRACKED = 1 << 16;   // past this, sampling is plenty for median cut

/**
 * Collects the colours of every frame in one pass, then hands back the palette
 * and a mapper from RGBA bytes to palette indices.
 */
export class PaletteBuilder {
  constructor() { this.counts = new Map(); this.saturated = false; }

  add(data) {
    const counts = this.counts;
    for (let i = 0; i < data.length; i += 4) {
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      const n = counts.get(key);
      if (n !== undefined) counts.set(key, n + 1);
      else if (!this.saturated) {
        counts.set(key, 1);
        if (counts.size >= MAX_TRACKED) this.saturated = true;
      }
    }
  }

  finish() {
    const counts = this.counts;
    const exact = counts.size <= 256 && !this.saturated;
    const palette = exact
      ? [...counts.keys()].map(k => [(k >> 16) & 0xff, (k >> 8) & 0xff, k & 0xff])
      : medianCut(counts, 256);

    const lookup = new Map();
    if (exact) [...counts.keys()].forEach((k, i) => lookup.set(k, i));

    const map = data => {
      const idx = new Uint8Array(data.length >> 2);
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        let v = lookup.get(key);
        if (v === undefined) {
          v = nearest(palette, data[i], data[i + 1], data[i + 2]);
          lookup.set(key, v);
        }
        idx[p] = v;
      }
      return idx;
    };
    return { palette, map, exact };
  }
}

// --------------------------------------------------------------- encoding --

/**
 * Frames are compressed as they arrive and never held as pixels, so exporting
 * a long loop at full canvas size costs a few megabytes rather than hundreds.
 */
export class GifWriter {
  constructor({ width, height, palette, delayCs, loop = 0 }) {
    let bits = 1;
    while ((1 << bits) < palette.length) bits++;
    bits = Math.min(8, Math.max(1, bits));

    this.width = width;
    this.height = height;
    this.delayCs = delayCs;
    this.minCodeSize = Math.max(2, bits);

    const w = this.w = new ByteWriter();
    w.ascii('GIF89a');
    w.short(width); w.short(height);
    w.byte(0xf0 | (bits - 1));   // global table, 8-bit colour resolution
    w.byte(0); w.byte(0);
    for (let i = 0, n = 1 << bits; i < n; i++) {
      const c = palette[i] || [0, 0, 0];
      w.byte(c[0]); w.byte(c[1]); w.byte(c[2]);
    }

    w.byte(0x21); w.byte(0xff); w.byte(11);
    w.ascii('NETSCAPE2.0');
    w.byte(3); w.byte(1); w.short(loop); w.byte(0);
  }

  addFrame(indices) {
    const w = this.w;
    w.byte(0x21); w.byte(0xf9); w.byte(4);
    w.byte(0x04);                 // disposal: leave in place, no transparency
    w.short(this.delayCs);
    w.byte(0); w.byte(0);
    w.byte(0x2c);
    w.short(0); w.short(0); w.short(this.width); w.short(this.height);
    w.byte(0);
    w.byte(this.minCodeSize);
    w.blocks(lzw(indices, this.minCodeSize));
  }

  blob() {
    this.w.byte(0x3b);
    return new Blob([this.w.done()], { type: 'image/gif' });
  }
}
