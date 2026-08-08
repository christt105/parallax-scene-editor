// Matching a scene's sprite paths against the files actually loaded.
//
// A scene written next to `sprites/x1/` and a folder opened at the project root
// disagree about where everything is, and re-picking twenty images by hand is
// nobody's idea of an afternoon. Every path in a scene is relative to the same
// place, so the usual fix is one missing prefix — find it and the whole scene
// snaps back at once.
//
// Pure functions over plain data: no DOM, no library object.

export const joinRoot = (root, sprite) =>
  (root ? `${String(root).replace(/\/+$/, '')}/${sprite}` : sprite);

const basename = p => p.slice(p.lastIndexOf('/') + 1);

/** Every layer and actor that points at an image, in document order. */
export function spriteRefs(scene) {
  return [
    ...scene.layers.map((el, i) => ({ el, kind: 'layer', index: i })),
    ...scene.actors.map((el, i) => ({ el, kind: 'actor', index: i })),
  ].filter(r => r.el.sprite);
}

/**
 * Work out how to make a scene's paths resolve against `paths`.
 *
 * Returns either `{ kind: 'prefix' }` — one shared folder is missing from
 * `sprite_root`, the tidy case — or `{ kind: 'each' }` with a path per element,
 * or `{ kind: 'none' }` when there is nothing to do or nothing to go on.
 */
export function planRelink(scene, paths) {
  const have = new Set(paths);
  const byName = new Map();
  for (const p of paths) {
    const name = basename(p);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(p);
  }

  const refs = spriteRefs(scene);
  const missing = refs.filter(r => !have.has(joinRoot(scene.sprite_root, r.el.sprite)));
  if (!missing.length) return { kind: 'none', missing: 0, fixes: [] };

  const fixes = [];
  const stuck = [];
  for (const ref of missing) {
    const sprite = ref.el.sprite;
    // a path ending in the whole relative sprite is a far stronger match than
    // one that merely shares a file name
    let candidates = paths.filter(p => p === sprite || p.endsWith(`/${sprite}`));
    if (candidates.length !== 1) {
      const named = byName.get(basename(sprite)) || [];
      candidates = named.length === 1 ? named : [];
    }
    if (candidates.length === 1) fixes.push({ ...ref, from: sprite, to: candidates[0] });
    else stuck.push(ref);
  }

  if (!fixes.length) return { kind: 'none', missing: missing.length, fixes: [], stuck };

  // Does one prefix explain every fix?
  const prefixes = new Set(fixes.map(f => {
    const cut = f.to.length - f.from.length;
    return cut > 0 && f.to.endsWith(`/${f.from}`) ? f.to.slice(0, cut - 1) : null;
  }));
  if (prefixes.size === 1 && !prefixes.has(null) && !stuck.length) {
    return { kind: 'prefix', prefix: [...prefixes][0], missing: missing.length, fixes, stuck };
  }
  return { kind: 'each', missing: missing.length, fixes, stuck };
}

/** Apply a plan to a scene, in place. */
export function applyRelink(scene, plan) {
  if (plan.kind === 'prefix') {
    scene.sprite_root = plan.prefix;
    return plan.fixes.length;
  }
  if (plan.kind === 'each') {
    // paths become absolute within the library, so the root has nothing to add
    for (const ref of spriteRefs(scene)) {
      const full = joinRoot(scene.sprite_root, ref.el.sprite);
      const fix = plan.fixes.find(f => f.el === ref.el);
      ref.el.sprite = fix ? fix.to : full;
    }
    scene.sprite_root = '';
    return plan.fixes.length;
  }
  return 0;
}

/** Which references still do not resolve, for showing in the UI. */
export function missingRefs(scene, paths) {
  const have = new Set(paths);
  return spriteRefs(scene).filter(r => !have.has(joinRoot(scene.sprite_root, r.el.sprite)));
}
