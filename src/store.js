// The scene plus an undo history.
//
// History is snapshot based: the scene is a small JSON document, so cloning it
// on every committed edit is cheaper than tracking deltas and impossible to get
// subtly wrong. Consecutive edits with the same `label` coalesce, which is what
// makes dragging a sprite one undo step instead of two hundred.

import { normalize, clone } from './scene.js';

const LIMIT = 200;

export class Store {
  constructor(scene) {
    this.scene = normalize(scene);
    this.past = [];
    this.future = [];
    this.lastLabel = null;
    this.lastTime = 0;
    this.listeners = new Set();
    this.dirty = false;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(reason = 'change') { for (const fn of this.listeners) fn(this.scene, reason); }

  /** Run `fn(scene)` as one undoable step. */
  commit(label, fn) {
    const now = Date.now();
    const merge = label && label === this.lastLabel && now - this.lastTime < 700;
    if (!merge) {
      this.past.push(JSON.stringify(this.scene));
      if (this.past.length > LIMIT) this.past.shift();
      this.future.length = 0;
    }
    this.lastLabel = label;
    this.lastTime = now;
    const out = fn(this.scene);
    this.scene = normalize(this.scene);
    this.dirty = true;
    this.emit(label || 'change');
    return out;
  }

  /** Replace the whole document, e.g. loading a file. */
  replace(scene, { history = true } = {}) {
    if (history) {
      this.past.push(JSON.stringify(this.scene));
      this.future.length = 0;
    }
    this.scene = normalize(scene);
    this.lastLabel = null;
    this.emit('replace');
  }

  undo() {
    if (!this.past.length) return false;
    this.future.push(JSON.stringify(this.scene));
    this.scene = normalize(JSON.parse(this.past.pop()));
    this.lastLabel = null;
    this.dirty = true;
    this.emit('undo');
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.past.push(JSON.stringify(this.scene));
    this.scene = normalize(JSON.parse(this.future.pop()));
    this.lastLabel = null;
    this.dirty = true;
    this.emit('redo');
    return true;
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  snapshot() { return clone(this.scene); }
}
