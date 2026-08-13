// The canvas: what you see, and everything you can do by pointing at it.
//
// Two stacked canvases. The lower one is the scene at world resolution, blown
// up by CSS with nearest-neighbour so a pixel stays a pixel. The upper one is
// at screen resolution, so selection outlines and motion paths stay hairlines
// instead of turning into fat blocks at high zoom.

import { viewSize, worldOffset } from '../scene.js';
import { renderScene, actorBox } from '../render.js';
import { actorPos } from '../anim.js';

export class Stage {
  constructor(host, ctx) {
    this.ctx = ctx;
    this.host = host;
    this.view = document.createElement('canvas');
    this.view.className = 'view';
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'overlay';
    this.wrap = document.createElement('div');
    this.wrap.className = 'stage-wrap';
    this.wrap.append(this.view, this.overlay);
    host.append(this.wrap);

    this.vctx = this.view.getContext('2d');
    this.octx = this.overlay.getContext('2d');
    this.scratch = document.createElement('canvas');
    this.showGrid = false;
    this.showGuides = true;
    this.onion = 0;
    this.drag = null;

    new ResizeObserver(() => this.layout()).observe(host);
    this.bindPointer();
  }

  // ------------------------------------------------------------- layout --
  layout() {
    const scene = this.ctx.store.scene;
    const [vw, vh] = viewSize(scene);
    if (this.view.width !== vw || this.view.height !== vh) {
      this.view.width = vw;
      this.view.height = vh;
    }
    const box = this.host.getBoundingClientRect();
    const pad = 24;
    const fit = Math.min((box.width - pad) / scene.canvas[0], (box.height - pad) / scene.canvas[1]);
    const w = Math.max(32, Math.floor(scene.canvas[0] * fit));
    const h = Math.max(18, Math.floor(scene.canvas[1] * fit));
    for (const el of [this.wrap, this.view, this.overlay]) {
      el.style.width = w + 'px';
      el.style.height = h + 'px';
    }
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.overlay.width = Math.round(w * dpr);
    this.overlay.height = Math.round(h * dpr);
    this.scale = w / vw;          // screen px per world px
    this.dpr = dpr;
  }

  /** Client coordinates to world coordinates. */
  toWorld(clientX, clientY) {
    const r = this.view.getBoundingClientRect();
    const scene = this.ctx.store.scene;
    const [vw, vh] = viewSize(scene);
    return [
      (clientX - r.left) * vw / r.width,
      (clientY - r.top) * vh / r.height - worldOffset(scene),
    ];
  }

  // -------------------------------------------------------------- paint --
  draw() {
    const { store, frame } = this.ctx;
    const scene = store.scene;
    const resolve = this.ctx.resolve;
    if (this.view.width !== viewSize(scene)[0] || this.view.height !== viewSize(scene)[1]) {
      this.layout();
    }
    renderScene(this.vctx, scene, frame, resolve);

    if (this.onion) {
      const [vw, vh] = viewSize(scene);
      if (this.scratch.width !== vw || this.scratch.height !== vh) {
        this.scratch.width = vw; this.scratch.height = vh;
      }
      const sctx = this.scratch.getContext('2d');
      for (let d = this.onion; d >= 1; d--) {
        for (const sign of [-1, 1]) {
          const f = ((frame + sign * d) % scene.loop_frames + scene.loop_frames) % scene.loop_frames;
          renderScene(sctx, scene, f, resolve,
                      { skipBackdrop: true, only: it => it.kind === 'actor' });
          this.vctx.globalAlpha = 0.22 / d;
          this.vctx.drawImage(this.scratch, 0, 0);
        }
      }
      this.vctx.globalAlpha = 1;
    }
    this.drawOverlay();
  }

  drawOverlay() {
    const { store, selection, frame } = this.ctx;
    const scene = store.scene;
    const g = this.octx;
    const s = this.scale * this.dpr;
    const dy = worldOffset(scene);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.overlay.width, this.overlay.height);
    g.setTransform(s, 0, 0, s, 0, 0);
    g.lineWidth = 1 / s;

    const [vw, vh] = viewSize(scene);

    if (this.showGrid) {
      const step = 8;
      g.strokeStyle = 'rgba(255,255,255,.10)';
      g.beginPath();
      for (let x = 0; x <= vw; x += step) { g.moveTo(x, 0); g.lineTo(x, vh); }
      for (let y = dy % step; y <= vh; y += step) { g.moveTo(0, y); g.lineTo(vw, y); }
      g.stroke();
    }

    if (this.showGuides && dy > 0) {
      g.strokeStyle = 'rgba(127,212,160,.45)';
      g.setLineDash([4 / s, 3 / s]);
      g.beginPath();
      g.moveTo(0, dy + 0.5); g.lineTo(vw, dy + 0.5);
      g.stroke();
      g.setLineDash([]);
    }

    if (selection.kind === 'actor') {
      const actor = scene.actors[selection.index];
      if (actor) this.drawActorGizmo(g, actor, scene, frame, dy);
    }
    if (selection.kind === 'layer') {
      const layer = scene.layers[selection.index];
      const img = layer && this.ctx.resolve(layer.sprite);
      if (img) {
        const y = (layer.y || 0) + dy - (layer.speed_y || 0) * frame;
        g.strokeStyle = '#f0b45e';
        g.strokeRect(0.5, y + 0.5, vw - 1, (img.naturalHeight || img.height) - 1);
      }
    }
  }

  drawActorGizmo(g, actor, scene, frame, dy) {
    const img = this.ctx.resolve(actor.sprite);
    const box = img && actorBox(actor, img, frame, scene.loop_frames, dy);
    if (box) {
      g.strokeStyle = '#7fd4a0';
      g.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    }
    const [px, py] = actorPos(actor, frame, scene.loop_frames);
    g.fillStyle = '#7fd4a0';
    g.fillRect(px - 1.5, py + dy - 1.5, 3, 3);

    if (actor.keys && actor.keys.length > 1) {
      g.strokeStyle = 'rgba(240,180,94,.85)';
      g.beginPath();
      for (let f = 0; f <= scene.loop_frames; f += 1) {
        const [x, y] = actorPos(actor, f % scene.loop_frames, scene.loop_frames);
        if (f === 0) g.moveTo(x, y + dy); else g.lineTo(x, y + dy);
      }
      g.stroke();
      g.fillStyle = '#f0b45e';
      actor.keys.forEach((k, i) => {
        g.beginPath();
        g.arc(k.x, k.y + dy, i === this.ctx.selKey ? 3 : 2, 0, 7);
        g.fill();
      });
    }
  }

  // ------------------------------------------------------------ pointer --
  hitTest(wx, wy) {
    const { store, frame } = this.ctx;
    const scene = store.scene;
    const dy = worldOffset(scene);
    const ordered = scene.actors.map((a, i) => ({ a, i }))
      .sort((p, q) => (q.a.depth || 0) - (p.a.depth || 0));
    for (const { a, i } of ordered) {
      if (a.visible === false) continue;
      const img = this.ctx.resolve(a.sprite);
      const box = img && actorBox(a, img, frame, scene.loop_frames, dy);
      if (!box) continue;
      if (wx >= box.x && wx <= box.x + box.w && wy + dy >= box.y && wy + dy <= box.y + box.h) return i;
    }
    return -1;
  }

  bindPointer() {
    this.view.addEventListener('pointerdown', ev => {
      const [wx, wy] = this.toWorld(ev.clientX, ev.clientY);
      const hit = this.hitTest(wx, wy);
      const sel = this.ctx.selection;

      if (hit < 0) {
        if (sel.kind === 'layer') {
          this.drag = { kind: 'layer', index: sel.index, wy,
                        start: this.ctx.store.scene.layers[sel.index].y };
          this.view.setPointerCapture(ev.pointerId);
        } else {
          this.ctx.select('scene');
        }
        return;
      }
      this.ctx.select('actor', hit, this.ctx.nearestKeyIndex(hit));
      const actor = this.ctx.store.scene.actors[hit];
      const [px, py] = actorPos(actor, this.ctx.frame, this.ctx.store.scene.loop_frames);
      this.drag = { kind: 'actor', index: hit, dx: wx - px, dy: wy - py };
      this.view.setPointerCapture(ev.pointerId);
      this.wrap.classList.add('dragging');
    });

    this.view.addEventListener('pointermove', ev => {
      if (!this.drag) return;
      const [wx, wy] = this.toWorld(ev.clientX, ev.clientY);
      if (this.drag.kind === 'layer') {
        const delta = Math.round(wy - this.drag.wy);
        this.ctx.editIndex('layer', this.drag.index, 'drag-layer',
                           l => { l.y = this.drag.start + delta; });
        return;
      }
      const snap = ev.shiftKey ? 8 : 1;
      const round = v => Math.round(v / snap) * snap;
      this.ctx.moveActor(this.drag.index, round(wx - this.drag.dx), round(wy - this.drag.dy));
    });

    const end = () => {
      this.drag = null;
      this.wrap.classList.remove('dragging');
    };
    this.view.addEventListener('pointerup', end);
    this.view.addEventListener('pointercancel', end);
  }
}
