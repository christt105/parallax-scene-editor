// Noticing that a file changed under you.
//
// The File System Access API has no change events, so this polls. Polling gets
// expensive the naive way — a folder with two thousand sprites, every second,
// forever — so it only ever asks about a slice per round and walks the list in
// a ring. A pass over everything on screen takes a few seconds; repainting a
// sprite in Aseprite takes longer than that.
//
// It knows nothing about images or handles: a list of keys, something that
// stamps a key, and something to call when a stamp moves.

export class FileWatcher {
  constructor({ list, stamp, onChanged, interval = 1200, batch = 32, paused = () => false }) {
    this.list = list;
    this.stamp = stamp;
    this.onChanged = onChanged;
    this.interval = interval;
    this.batch = batch;
    this.paused = paused;
    this.stamps = new Map();
    this.cursor = 0;
    this.timer = null;
    this.running = false;
    this.sweeps = 0;
  }

  /** Record what a key looked like when we last read it for real. */
  mark(key, value) { this.stamps.set(key, value); }
  forget(key) { this.stamps.delete(key); }
  clear() { this.stamps.clear(); this.cursor = 0; }

  /**
   * One round. Returns the keys that moved.
   *
   * A key that changed is reported but *not* re-stamped: only whoever reloads
   * it successfully gets to say what it looks like now. So a sprite caught half
   * written — the load fails, nobody marks it — is still "changed" next round,
   * and comes back on its own once the file is whole.
   */
  async sweep(n = this.batch) {
    const keys = this.list();
    if (!keys.length) { this.cursor = 0; return []; }
    const count = Math.min(n, keys.length);
    const changed = [];
    for (let i = 0; i < count; i++) {
      const key = keys[(this.cursor + i) % keys.length];
      const now = await this.stamp(key);
      if (now == null) continue;                 // unreadable: gone, or not ours
      const before = this.stamps.get(key);
      if (before === undefined) this.stamps.set(key, now);
      else if (before !== now) changed.push(key);
    }
    this.cursor = (this.cursor + count) % keys.length;
    this.sweeps++;
    if (changed.length) await this.onChanged(changed);
    return changed;
  }

  /** Chained timeouts, not an interval: a slow round must not stack on itself. */
  start() {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      this.timer = null;
      if (!this.running) return;
      // A hidden tab is not watching anything, and neither should we be.
      if (!this.paused()) {
        try { await this.sweep(); } catch { /* one bad round is not fatal */ }
      }
      if (this.running) this.timer = setTimeout(tick, this.interval);
    };
    this.timer = setTimeout(tick, this.interval);
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
