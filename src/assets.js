// Where the images come from.
//
// Three ways in, in order of how pleasant they are:
//   folder  — File System Access API. Reads every image in the folder you pick
//             and writes the scene back into it. Chromium only, today.
//   drop    — files or folders dragged onto the page. Read-only, works anywhere.
//   url     — a manifest of paths fetched over HTTP; used for the bundled demo.

import { FileWatcher } from './watch.js';

const IMAGE_RE = /\.(png|gif|jpe?g|webp|bmp)$/i;
const MAX_FILES = 30000;

// Folders that are never someone's artwork and are often enormous.
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'venv', '.venv', 'target']);

export const normPath = p => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

export class AssetLibrary {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.onReload = () => {};
    this.mode = 'none';
    this.label = '';
    this.dirHandle = null;
    this.entries = new Map();   // path -> { handle } | { file } | { url }
    this.images = new Map();    // path -> HTMLImageElement (loaded or loading)
    this.failed = new Set();

    // Only what is on screen is watched. Dropped files are snapshots the
    // browser took at drop time and the demo lives on a web server, so in both
    // cases there is nothing on disk left to notice.
    this.watcher = new FileWatcher({
      list: () => [...this.images.keys()].filter(k => this.entries.get(k)?.handle),
      stamp: key => this._stamp(key),
      onChanged: keys => this._reloadAll(keys),
      paused: () => typeof document !== 'undefined' && document.hidden,
    });
  }

  get canWrite() { return this.mode === 'folder' && !!this.dirHandle; }
  get count() { return this.entries.size; }

  paths(filter) {
    const all = [...this.entries.keys()].sort((a, b) => a.localeCompare(b));
    return filter ? all.filter(p => p.toLowerCase().includes(filter.toLowerCase())) : all;
  }

  /** A drawable image, or null while it loads or if it is missing. */
  get(path) {
    const key = normPath(path);
    const img = this.images.get(key);
    if (img) return img.complete && img.naturalWidth ? img : null;
    if (!this.entries.has(key) || this.failed.has(key)) return null;
    this._load(key);
    return null;
  }

  async _load(key) {
    const entry = this.entries.get(key);
    const img = new Image();
    this.images.set(key, img);
    img.onerror = () => { this.failed.add(key); this.images.delete(key); };
    try {
      if (entry.url) {
        img.onload = () => this.onChange();
        img.src = entry.url;
        return;
      }
      const file = entry.file || await entry.handle.getFile();
      // Stamped only once the bytes decoded, so a sprite read mid-save stays
      // "changed" for the watcher and comes back on the next round.
      img.onload = () => {
        if (entry.handle) this.watcher.mark(key, file.lastModified);
        this.onChange();
      };
      img.src = URL.createObjectURL(file);
    } catch {
      this.failed.add(key);
      this.images.delete(key);
    }
  }

  _drop(key) {
    const img = this.images.get(key);
    if (img && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    this.images.delete(key);
    this.failed.delete(key);
  }

  async _stamp(key) {
    const entry = this.entries.get(key);
    if (!entry?.handle) return null;
    try { return (await entry.handle.getFile()).lastModified; } catch { return null; }
  }

  async _reloadAll(keys) {
    for (const key of keys) {
      this._drop(key);
      await this._load(key);
    }
    this.onChange();
    this.onReload(keys);
  }

  /** Watch the loaded images for edits made outside the editor. */
  watch(on = true) { on ? this.watcher.start() : this.watcher.stop(); }

  /** Force a reload of everything, e.g. after editing a sprite in Aseprite. */
  refresh() {
    for (const img of this.images.values()) {
      if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    }
    this.images.clear();
    this.failed.clear();
    this.watcher.clear();
    this.onChange();
  }

  _reset(mode, label) {
    this.refresh();
    this.mode = mode;
    this.label = label;
    this.truncated = false;
    this.entries.clear();
  }

  // ------------------------------------------------------------- folder --
  static get supportsFolder() { return typeof window.showDirectoryPicker === 'function'; }

  async openFolder(handle = null) {
    const dir = handle || await window.showDirectoryPicker({ id: 'pse-project', mode: 'readwrite' });
    const ok = await ensurePermission(dir, 'readwrite');
    if (!ok) throw new Error('permission denied on the folder');
    this._reset('folder', dir.name);
    this.dirHandle = dir;
    await this._scan(dir);
    this.onChange();
    return dir;
  }

  /**
   * Breadth first, on purpose.
   *
   * A depth-first walk spends its whole budget on whichever subtree happens to
   * sort first — one vendored dependency with a few thousand images and the
   * sprites you actually came for are never reached. Level by level, the files
   * next to the scene arrive first and the cap only ever bites the deep end.
   */
  async _scan(root) {
    let level = [[root, '']];
    for (let depth = 0; depth <= 10 && level.length; depth++) {
      const next = [];
      for (const [dir, prefix] of level) {
        for await (const [name, handle] of dir.entries()) {
          if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
          const path = prefix ? `${prefix}/${name}` : name;
          if (handle.kind === 'directory') next.push([handle, path]);
          else if (IMAGE_RE.test(name)) this.entries.set(path, { handle });
          else if (name.endsWith('.json')) this.entries.set(path, { handle, json: true });
          if (this.entries.size >= MAX_FILES) { this.truncated = true; return; }
        }
      }
      level = next;
    }
  }

  async readText(path) {
    const entry = this.entries.get(normPath(path));
    if (!entry) return null;
    const file = entry.file || (entry.handle ? await entry.handle.getFile() : null);
    if (file) return file.text();
    if (entry.url) return fetch(entry.url).then(r => (r.ok ? r.text() : null));
    return null;
  }

  /** Write a text file into the opened folder, creating parent folders. */
  async writeText(path, text) {
    if (!this.canWrite) throw new Error('no folder open with write permission');
    const parts = normPath(path).split('/');
    let dir = this.dirHandle;
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    if (!this.entries.has(normPath(path))) this.entries.set(normPath(path), { handle: fh, json: true });
    return normPath(path);
  }

  /** Scene files sitting in the project, so they can be listed and reopened. */
  sceneFiles() {
    return [...this.entries.entries()]
      .filter(([p, e]) => e.json && !p.endsWith('/assets.json'))
      .map(([p]) => p)
      .sort();
  }

  // --------------------------------------------------------------- drop --
  /**
   * Dropping files *adds* to what is loaded rather than replacing it. Throwing
   * away an open project because one PNG landed on the window is not a trade
   * anyone would take, and the same drop handler sees stray drags from inside
   * the page.
   */
  async adoptDrop(dataTransfer) {
    const before = this.entries.size;
    const roots = [];
    for (const item of dataTransfer.items || []) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry) roots.push(entry);
    }

    if (roots.length) {
      if (!before) this._reset('drop', roots.length === 1 ? roots[0].name : `${roots.length} items`);
      for (const root of roots) await walkEntry(root, '', this.entries);
    } else {
      const files = [...(dataTransfer.files || [])];
      if (!files.length) return 0;
      if (!before) this._reset('drop', `${files.length} files`);
      for (const f of files) {
        if (IMAGE_RE.test(f.name) || f.name.endsWith('.json')) {
          this.entries.set(normPath(f.name), { file: f, json: f.name.endsWith('.json') });
        }
      }
    }
    this.onChange();
    return this.entries.size - before;
  }

  adoptFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return 0;
    const before = this.entries.size;
    const folder = files[0].webkitRelativePath?.split('/')[0];
    if (!before || folder) {
      this._reset('drop', folder || `${files.length} files`);
    }
    for (const f of files) {
      const rel = folder
        ? normPath(f.webkitRelativePath).split('/').slice(1).join('/')
        : normPath(f.name);
      if (IMAGE_RE.test(f.name) || f.name.endsWith('.json')) {
        this.entries.set(rel, { file: f, json: f.name.endsWith('.json') });
      }
    }
    this.onChange();
    return this.entries.size - (folder ? 0 : before);
  }

  /** Raw bytes of one asset, for packaging a scene up. */
  async readBytes(path) {
    const entry = this.entries.get(normPath(path));
    if (!entry) return null;
    if (entry.url) {
      const res = await fetch(entry.url);
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    }
    const file = entry.file || await entry.handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  // ---------------------------------------------------------------- url --
  async loadManifest(base) {
    const res = await fetch(`${base}/project.json`);
    if (!res.ok) throw new Error(`cannot find ${base}/project.json`);
    const manifest = await res.json();
    this._reset('url', manifest.name || base);
    for (const path of manifest.files || []) {
      this.entries.set(normPath(path), { url: `${base}/${path}` });
    }
    this.onChange();
    return manifest;
  }
}

async function ensurePermission(handle, mode) {
  const opts = { mode };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  return (await handle.requestPermission?.(opts)) === 'granted';
}

function walkEntry(entry, prefix, out, depth = 0) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    if (!IMAGE_RE.test(entry.name) && !entry.name.endsWith('.json')) return Promise.resolve();
    return new Promise(res => entry.file(f => {
      // drop the dragged folder's own name so paths match what's in the scene
      const rel = prefix ? path.split('/').slice(1).join('/') : path;
      out.set(normPath(rel), { file: f, json: entry.name.endsWith('.json') });
      res();
    }, res));
  }
  if (!entry.isDirectory || depth > 8) return Promise.resolve();
  const reader = entry.createReader();
  return new Promise(res => {
    const batch = () => reader.readEntries(async list => {
      if (!list.length) return res();
      for (const child of list) await walkEntry(child, path, out, depth + 1);
      batch();
    }, res);
    batch();
  });
}

/**
 * How many cels a sheet probably holds. Square frames are the overwhelming
 * default in pixel art, so a width that is a multiple of the height is the
 * strongest signal; failing that, look for fully transparent gutters.
 */
export async function guessFrames(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return 1;
  if (w > h && w % h === 0) return w / h;
  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    const empty = new Set();
    for (let x = 0; x < w; x++) {
      let blank = true;
      for (let y = 0; y < h && blank; y++) if (data[(y * w + x) * 4 + 3]) blank = false;
      if (blank) empty.add(x);
    }
    if (!empty.size) return 1;
    // count runs of content between gutters
    let runs = 0, inRun = false;
    for (let x = 0; x < w; x++) {
      const blank = empty.has(x);
      if (!blank && !inRun) { runs++; inRun = true; }
      if (blank) inRun = false;
    }
    return Math.max(1, runs);
  } catch {
    return 1;
  }
}
