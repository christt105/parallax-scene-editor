// Drawing a scene into a 2D context, at world resolution (before zoom).

import { viewSize, worldOffset } from './scene.js';
import { actorPos, actorCel, anchorOffset, celRect } from './anim.js';

/** Layers and actors interleaved by depth, so a layer can sit in front. */
export function drawOrder(scene) {
  const items = [
    ...scene.layers.map((el, i) => ({ kind: 'layer', el, i })),
    ...scene.actors.map((el, i) => ({ kind: 'actor', el, i })),
  ];
  return items
    .map((it, n) => ({ ...it, n }))
    .sort((a, b) => (a.el.depth || 0) - (b.el.depth || 0) || a.n - b.n);
}

function drawLayer(ctx, layer, img, frame, view, dy) {
  const [vw, vh] = view;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;

  const y0 = Math.round((layer.y || 0) + dy - (layer.speed_y || 0) * frame);
  const period = Math.max(1, Math.round(layer.tile_period) || iw);
  const shift = Math.round((layer.speed || 0) * frame);

  ctx.globalAlpha = layer.opacity ?? 1;

  if (layer.repeat === 'none') {
    ctx.drawImage(img, -shift, y0);
  } else {
    // Start one period to the left so the seam is always off-screen.
    let x = -period + (((-shift % period) + period) % period);
    for (; x < vw; x += period) ctx.drawImage(img, x, y0);
  }

  // The rows above and below a layer are usually meant to keep going: sky
  // above a backdrop layer, dirt below a ground layer. Repeating the edge row
  // is cheaper than authoring art nobody will look at.
  if (layer.extend_up && y0 > 0) {
    let x = -period + (((-shift % period) + period) % period);
    for (; x < vw; x += period) ctx.drawImage(img, 0, 0, iw, 1, x, 0, iw, y0);
  }
  if (layer.extend_down && y0 + ih < vh) {
    let x = -period + (((-shift % period) + period) % period);
    for (; x < vw; x += period)
      ctx.drawImage(img, 0, ih - 1, iw, 1, x, y0 + ih, iw, vh - y0 - ih);
  }
  ctx.globalAlpha = 1;
}

/** Screen-space box of an actor at a frame, in world coordinates. */
export function actorBox(actor, img, frame, loop, dy) {
  const iw = img ? (img.naturalWidth || img.width) : 0;
  const ih = img ? (img.naturalHeight || img.height) : 0;
  if (!iw || !ih) return null;
  const { fw, fh } = celRect(actor, iw, ih);
  const scale = Math.max(1, actor.scale || 1);
  const w = fw * scale, h = fh * scale;
  const [px, py] = actorPos(actor, frame, loop);
  const [ax, ay] = anchorOffset(actor.anchor, w, h);
  return { x: Math.round(px + ax), y: Math.round(py + ay) + dy, w, h, fw, fh };
}

function drawActor(ctx, actor, img, frame, loop, dy) {
  const box = actorBox(actor, img, frame, loop, dy);
  if (!box) return;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const { fw, fh, cols } = celRect(actor, iw, ih);
  const cel = actorCel(actor, frame);
  const sx = (cel % cols) * fw, sy = Math.floor(cel / cols) * fh;

  ctx.save();
  ctx.globalAlpha = actor.opacity ?? 1;
  const fx = actor.flip_x ? -1 : 1, fy = actor.flip_y ? -1 : 1;
  ctx.translate(box.x + (actor.flip_x ? box.w : 0), box.y + (actor.flip_y ? box.h : 0));
  if (fx < 0 || fy < 0) ctx.scale(fx, fy);
  ctx.drawImage(img, sx, sy, fw, fh, 0, 0, box.w, box.h);
  ctx.restore();
}

/**
 * Paint one frame at world resolution. `resolve(path)` returns a drawable
 * image or null; anything missing is skipped rather than throwing, because a
 * half-loaded project should still be editable.
 */
export function renderScene(ctx, scene, frame, resolve, opts = {}) {
  const view = viewSize(scene);
  const dy = worldOffset(scene);
  const loop = scene.loop_frames;

  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  if (opts.skipBackdrop) {
    ctx.clearRect(0, 0, view[0], view[1]);
  } else {
    ctx.fillStyle = scene.backdrop || '#000';
    ctx.fillRect(0, 0, view[0], view[1]);
  }

  for (const item of drawOrder(scene)) {
    const el = item.el;
    if (el.visible === false || !el.sprite) continue;
    if (opts.only && !opts.only(item)) continue;
    const img = resolve(el.sprite);
    if (!img) continue;
    if (item.kind === 'layer') drawLayer(ctx, el, img, frame, view, dy);
    else drawActor(ctx, el, img, frame, loop, dy);
  }
  ctx.globalAlpha = 1;
}

/** Full-size output frame: render small, magnify with nearest neighbour, crop. */
export function renderFrameTo(canvas, scene, frame, resolve, scratch) {
  const [vw, vh] = viewSize(scene);
  const buf = scratch || document.createElement('canvas');
  if (buf.width !== vw || buf.height !== vh) { buf.width = vw; buf.height = vh; }
  renderScene(buf.getContext('2d'), scene, frame, resolve);

  const [cw, ch] = scene.canvas;
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(buf, 0, 0, vw, vh, 0, 0, vw * scene.zoom, vh * scene.zoom);
  return canvas;
}
