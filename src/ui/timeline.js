// One row per actor, a diamond per keyframe, a playhead over the lot.
//
// Built from DOM nodes rather than a canvas: the counts are small, and it means
// dragging, hover titles and focus rings come for free.

import { h, clear } from './dom.js';

export class Timeline {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.tracks = h('div.tracks');
    this.ruler = h('div.ruler');
    this.playhead = h('div.playhead');
    this.body = h('div.tl-body', {}, [this.tracks, this.playhead]);
    root.append(h('div.tl-head', {}, [h('div.tl-gutter', { text: 'actores' }), this.ruler]), this.body);

    const scrub = ev => {
      const lane = ev.target.closest('.lane') || this.ruler;
      const r = lane.getBoundingClientRect();
      const loop = this.ctx.store.scene.loop_frames;
      const f = Math.round((ev.clientX - r.left) / r.width * loop);
      this.ctx.setFrame(Math.max(0, Math.min(loop - 1, f)));
    };
    for (const node of [this.ruler, this.tracks]) {
      node.addEventListener('pointerdown', ev => {
        if (ev.target.classList.contains('kf')) return;
        this.ctx.pause();
        scrub(ev);
        const move = e => scrub(e);
        const up = () => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
      });
    }
  }

  /** Nice tick spacing: powers of two feel right for loop lengths. */
  static ticks(loop) {
    let step = 1;
    while (loop / step > 16) step *= 2;
    const out = [];
    for (let f = 0; f < loop; f += step) out.push(f);
    return out;
  }

  render() {
    const { store, selection, selKey } = this.ctx;
    const scene = store.scene;
    const loop = scene.loop_frames;

    clear(this.ruler);
    for (const f of Timeline.ticks(loop)) {
      this.ruler.append(h('span.tick', { text: f, style: { left: (f / loop * 100) + '%' } }));
    }

    clear(this.tracks);
    scene.actors.forEach((actor, i) => {
      const selected = selection.kind === 'actor' && selection.index === i;
      const lane = h('div.lane', { title: 'doble clic para añadir una clave' });
      const row = h('div.track' + (selected ? '.sel' : ''), {}, [
        h('div.tl-gutter', {
          text: actor.name,
          onclick: () => this.ctx.select('actor', i),
        }),
        lane,
      ]);

      lane.addEventListener('dblclick', ev => {
        const r = lane.getBoundingClientRect();
        const f = Math.round((ev.clientX - r.left) / r.width * loop);
        this.ctx.select('actor', i);
        this.ctx.setFrame(Math.max(0, Math.min(loop - 1, f)));
        this.ctx.addKey();
      });

      (actor.keys || []).forEach((k, ki) => {
        const node = h('div.kf' + (selected && ki === selKey ? '.sel' : ''), {
          style: { left: (k.f / loop * 100) + '%' },
          title: `f=${k.f}  x=${k.x}  y=${k.y}  ${k.ease || 'linear'}`,
        });
        node.addEventListener('pointerdown', ev => {
          ev.stopPropagation();
          this.ctx.pause();
          this.ctx.select('actor', i, ki);
          this.ctx.setFrame(k.f);
          const r = lane.getBoundingClientRect();
          let moved = false;
          const move = e => {
            const f = Math.max(0, Math.min(loop - 1,
              Math.round((e.clientX - r.left) / r.width * loop)));
            if (f === k.f) return;
            moved = true;
            this.ctx.moveKey(i, ki, f);
          };
          const up = () => {
            removeEventListener('pointermove', move);
            removeEventListener('pointerup', up);
            if (!moved) this.ctx.setFrame(k.f);
          };
          addEventListener('pointermove', move);
          addEventListener('pointerup', up);
        });
        lane.append(node);
      });

      // a hairline showing where this actor's cel cycle restarts
      const cycle = ((actor.order && actor.order.length) || actor.frames) * Math.max(1, actor.delay);
      if (cycle < loop) {
        for (let f = cycle; f < loop; f += cycle) {
          lane.append(h('div.cycle', { style: { left: (f / loop * 100) + '%' } }));
        }
      }
      this.tracks.append(row);
    });

    if (!scene.actors.length) {
      this.tracks.append(h('p.note', { text: 'sin actores todavía' }));
    }
    this.syncPlayhead();
  }

  syncPlayhead() {
    const loop = this.ctx.store.scene.loop_frames;
    const t = this.ctx.frame / loop;
    this.playhead.style.left = `calc(var(--gutter) + (100% - var(--gutter)) * ${t})`;
  }
}
