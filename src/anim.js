// Sampling an actor at a frame: keyframes, procedural motion, anchoring.
//
// Pure functions on plain data. `compose.py` in the reference project mirrors
// these formulas exactly, which is what lets the preview and the offline render
// agree pixel for pixel.

export function ease(t, kind) {
  if (kind === 'in-out') return t * t * (3 - 2 * t);
  if (kind === 'in') return t * t;
  if (kind === 'out') return t * (2 - t);
  return t;
}

/**
 * Interpolate x/y from keyframes. The last key wraps back round to the first,
 * so a loop never has a seam at frame 0.
 */
export function sampleKeys(keys, f, loop) {
  f = ((f % loop) + loop) % loop;
  const ks = keys.slice().sort((a, b) => a.f - b.f);
  if (!ks.length) return [0, 0];
  if (ks.length === 1) return [ks[0].x || 0, ks[0].y || 0];
  const ring = ks.concat([{ ...ks[0], f: ks[0].f + loop }]);
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    if (a.f <= f && f < b.f) {
      const span = b.f - a.f;
      const t = span ? ease((f - a.f) / span, a.ease || 'linear') : 0;
      return [(a.x || 0) + ((b.x || 0) - (a.x || 0)) * t,
              (a.y || 0) + ((b.y || 0) - (a.y || 0)) * t];
    }
  }
  // before the first key: the wrapped tail segment covers it
  const a = ks[ks.length - 1], b = { ...ks[0], f: ks[0].f + loop };
  const span = b.f + loop - a.f;
  const t = span ? ease(((f + loop) - a.f) / span, a.ease || 'linear') : 0;
  return [(a.x || 0) + ((b.x || 0) - (a.x || 0)) * t,
          (a.y || 0) + ((b.y || 0) - (a.y || 0)) * t];
}

/** Offsets layered on top of the base position. */
export function applyMotion(motion, f, loop) {
  let dx = 0, dy = 0;
  for (const m of motion || []) {
    if (m.enabled === false) continue;
    const amp = +m.amp || 0;
    const period = +m.period || loop;
    let v;
    if (m.type === 'wobble') {
      // a periodic stand-in for the 1 px jitter a game would randomise
      v = amp * [0, -1, 0, 1][Math.floor(f / Math.max(1, m.hold || 8)) % 4];
    } else {
      const th = 2 * Math.PI * (f / period) + (+m.phase || 0) * Math.PI / 180;
      v = amp * (m.type === 'cosine' ? Math.cos(th) : Math.sin(th));
    }
    if ((m.axis || 'y') === 'x') dx += v; else dy += v;
  }
  return [dx, dy];
}

/** World-space position of an actor at frame `f`. */
export function actorPos(a, f, loop) {
  const [bx, by] = (a.keys && a.keys.length) ? sampleKeys(a.keys, f, loop)
                                            : [a.x || 0, a.y || 0];
  const [mx, my] = applyMotion(a.motion, f, loop);
  return [bx + mx, by + my];
}

/** Which cel of the sheet is showing at frame `f`. */
export function actorCel(a, f) {
  const n = Math.max(1, a.frames || 1);
  const order = (a.order && a.order.length) ? a.order : null;
  const step = Math.floor((f + (a.offset || 0)) / Math.max(1, a.delay || 1));
  const i = order ? order[((step % order.length) + order.length) % order.length]
                  : ((step % n) + n) % n;
  return Math.min(n - 1, Math.max(0, i | 0));
}

/** Offset from the anchor point to the frame's top-left corner. */
export function anchorOffset(anchor, w, h) {
  const [v, hz] = String(anchor || 'bottom-center').split('-');
  const ox = hz === 'left' ? 0 : hz === 'right' ? -w : -w / 2;
  const oy = v === 'top' ? 0 : v === 'bottom' ? -h : -h / 2;
  return [ox, oy];
}

/** Where cel `i` lives inside the sheet, for both strips and grids. */
export function celRect(a, imgW, imgH) {
  const n = Math.max(1, a.frames || 1);
  const cols = a.grid ? Math.max(1, a.grid[0] | 0) : n;
  const rows = a.grid ? Math.max(1, a.grid[1] | 0) : 1;
  return { fw: Math.floor(imgW / cols), fh: Math.floor(imgH / rows), cols, rows };
}
