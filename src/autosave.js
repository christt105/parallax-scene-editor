// Write-through autosave: the scene file on disk follows the editor.
//
// The browser hands out one writable handle and no transactions, so the rules
// are the boring ones: coalesce a burst of edits into one write, never two
// writes at a time, never write bytes that are already on disk, and stop after
// a failure instead of hammering a folder whose permission was revoked.
//
// It knows nothing about scenes — a path and a string — which is what makes it
// testable without a browser.

export const IDLE = 'idle';
export const PENDING = 'pending';
export const SAVING = 'saving';
export const SAVED = 'saved';
export const ERROR = 'error';

export class DiskAutosave {
  constructor({ write, delay = 600, onState = () => {} }) {
    this.write = write;
    this.delay = delay;
    this.onState = onState;
    this.enabled = true;
    this.state = IDLE;
    this.error = null;
    this.path = null;       // what was last written, and where
    this.text = null;
    this.pending = null;
    this.timer = null;
    this.writing = null;
    this.writes = 0;        // for the tests, and for anyone watching in the console
  }

  /** Nothing queued and the disk holds the last thing we were given. */
  get clean() { return !this.pending && !this.writing && this.state !== ERROR; }

  _set(state, error = null) {
    this.state = state;
    this.error = error;
    this.onState(state, error);
  }

  /**
   * Declare what is already on disk — after an explicit save, or after opening
   * a scene — so the next identical edit writes nothing.
   */
  seed(path, text) {
    clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.path = path;
    this.text = text;
    this.error = null;
    this._set(SAVED);
  }

  /** Queue a write. Returns false when there is nothing new to say. */
  request(path, text) {
    if (!this.enabled || !path) return false;
    if (path === this.path && text === this.text) return false;
    if (this.pending && this.pending.path === path && this.pending.text === text) return false;
    this.pending = { path, text };
    if (this.state !== SAVING) this._set(PENDING);
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.delay);
    }
    return true;
  }

  /** Write now. Resolves once the disk has caught up with everything queued. */
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.writing) return this.writing;      // the run in flight drains the queue
    if (!this.pending) return Promise.resolve();
    this.writing = this._drain().finally(() => { this.writing = null; });
    return this.writing;
  }

  async _drain() {
    try {
      // Re-checked every lap: an edit landing mid-write leaves a new `pending`
      // behind, and it has to go out before we can claim to be saved.
      while (this.pending) {
        const { path, text } = this.pending;
        this.pending = null;
        this._set(SAVING);
        await this.write(path, text);
        this.writes++;
        this.path = path;
        this.text = text;
      }
      this._set(SAVED);
    } catch (e) {
      // A folder that refuses one write refuses the next one too; going quiet
      // and saying so beats a retry loop behind a dialog nobody can see.
      this.enabled = false;
      this.pending = null;
      this._set(ERROR, e);
    }
  }

  /** Turn it back on after an error, or after the user unticked the box. */
  enable(on) {
    this.enabled = !!on;
    if (!on) {
      clearTimeout(this.timer);
      this.timer = null;
      this.pending = null;
      this._set(IDLE);
    } else if (this.state === ERROR) {
      this._set(IDLE);
    }
  }

  /** Forget the target, e.g. on a new scene: nothing should reach the old file. */
  reset() {
    clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.path = null;
    this.text = null;
    this._set(IDLE);
  }
}
