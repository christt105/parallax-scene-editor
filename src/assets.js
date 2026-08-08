// Where the images come from.
//
// Three ways in, in order of how pleasant they are:
//   folder  — File System Access API. Reads every image in the folder you pick
//             and writes the scene back into it. Chromium only, today.
//   drop    — files or folders dragged onto the page. Read-only, works anywhere.
//   url     — a manifest of paths fetched over HTTP; used for the bundled demo.

const IMAGE_RE = /\.(png|gif|jpe?g|webp|bmp)$/i;
const MAX_FILES = 4000;

export const normPath = p => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

export class AssetLibrary {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.mode = 'none';
    this.label = '';
    this.dirHandle = null;
    this.entries = new Map();   // path -> { handle } | { file } | { url }
    this.images = new Map();    // path -> HTMLImageElement (loaded or loading)
    this.failed = new Set();
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
    img.onload = () => this.onChange();
    img.onerror = () => { this.failed.add(key); this.images.delete(key); };
    try {
      if (entry.url) img.src = entry.url;
      else {
        const file = entry.file || await entry.handle.getFile();
        img.src = URL.createObjectURL(file);
      }
    } catch {
      this.failed.add(key);
      this.images.delete(key);
    }
  }

  /** Force a reload of everything, e.g. after editing a sprite in Aseprite. */
  refresh() {
    for (const img of this.images.values()) {
      if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    }
    this.images.clear();
    this.failed.clear();
    this.onChange();
  }

  _reset(mode, label) {
    this.refresh();
    this.mode = mode;
    this.label = label;
    this.entries.clear();
  }

  // ------------------------------------------------------------- folder --
  static get supportsFolder() { return typeof window.showDirectoryPicker === 'function'; }

  async openFolder(handle = null) {
    const dir = handle || await window.showDirectoryPicker({ id: 'pse-project', mode: 'readwrite' });
    const ok = await ensurePermission(dir, 'readwrite');
    if (!ok) throw new Error('permiso denegado sobre la carpeta');
    this._reset('folder', dir.name);
    this.dirHandle = dir;
    await this._scan(dir, '');
    this.onChange();
    return dir;
  }

  async _scan(dir, prefix, depth = 0) {
    if (depth > 8 || this.entries.size > MAX_FILES) return;
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith('.')) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') await this._scan(handle, path, depth + 1);
      else if (IMAGE_RE.test(name)) this.entries.set(path, { handle });
      else if (name.endsWith('.json')) this.entries.set(path, { handle, json: true });
      if (this.entries.size > MAX_FILES) return;
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
    if (!this.canWrite) throw new Error('no hay carpeta abierta con permiso de escritura');
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
  async adoptDrop(dataTransfer) {
    const roots = [];
    for (const item of dataTransfer.items || []) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry) roots.push(entry);
    }
    if (roots.length) {
      this._reset('drop', roots.length === 1 ? roots[0].name : `${roots.length} elementos`);
      for (const root of roots) await walkEntry(root, '', this.entries);
    } else {
      const files = [...(dataTransfer.files || [])];
      if (!files.length) return 0;
      this._reset('drop', `${files.length} archivos`);
      for (const f of files) {
        if (IMAGE_RE.test(f.name) || f.name.endsWith('.json')) {
          this.entries.set(normPath(f.name), { file: f, json: f.name.endsWith('.json') });
        }
      }
    }
    this.onChange();
    return this.entries.size;
  }

  adoptFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return 0;
    this._reset('drop', files[0].webkitRelativePath?.split('/')[0] || `${files.length} archivos`);
    for (const f of files) {
      const rel = normPath(f.webkitRelativePath || f.name).split('/').slice(1).join('/')
                  || normPath(f.name);
      if (IMAGE_RE.test(f.name) || f.name.endsWith('.json')) {
        this.entries.set(rel, { file: f, json: f.name.endsWith('.json') });
      }
    }
    this.onChange();
    return this.entries.size;
  }

  // ---------------------------------------------------------------- url --
  async loadManifest(base) {
    const res = await fetch(`${base}/project.json`);
    if (!res.ok) throw new Error(`no encuentro ${base}/project.json`);
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
