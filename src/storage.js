// Nothing here is the source of truth — it is the safety net.
//
// The scene is autosaved to IndexedDB on every change, and the handle of the
// folder you opened is stored next to it, so closing the tab by accident costs
// nothing: reopening restores the scene and offers the folder back with one
// click (the browser still requires a gesture to re-grant write permission).

const DB = 'parallax-scene-editor';
const STORE = 'kv';

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  try {
    const db = await open();
    return await new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  } catch {
    return null;   // private mode, blocked storage: the editor still works
  }
}

export const get = key => tx('readonly', s => s.get(key));
export const set = (key, value) => tx('readwrite', s => s.put(value, key));
export const del = key => tx('readwrite', s => s.delete(key));

/** Coalesce bursts of edits into one write. */
export function debounced(key, ms = 400) {
  let timer = null, pending = null;
  return value => {
    pending = value;
    if (timer) return;
    timer = setTimeout(() => { timer = null; set(key, pending); }, ms);
  };
}
