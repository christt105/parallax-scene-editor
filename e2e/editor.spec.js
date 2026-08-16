// Smoke tests in a real browser.
//
// Every one of these covers a bug that actually shipped: a fixed overlay
// swallowing all the clicks, a panel rebuilding itself out from under the
// caret, an internal image drag being mistaken for someone loading a project.
// They are about the wiring — the maths is covered by `node --test`.

import { test, expect } from '@playwright/test';

/**
 * Wait for the demo to be on screen with its images decoded.
 *
 * *Every* image, not just the ones the scene draws: an asset thumbnail landing
 * late makes the grid redraw, which detaches whatever element a test has just
 * located and turns `boundingBox()` into null. Waiting for the last one is the
 * difference between a suite you trust and one you rerun.
 */
async function boot(page) {
  const errors = [];
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => {
    const a = window.editor;
    return a && a.store.scene.layers.length > 0 &&
      a.store.scene.layers.every(l => a.resolve(l.sprite)) &&
      a.assets.paths().every(p => p.endsWith('.json') || a.assets.get(p));
  }, null, { timeout: 15000 });
  // and let the grid's own redraw debounce run out
  await page.waitForTimeout(250);
  return errors;
}

test('the demo loads and paints something', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('.view')).toBeVisible();

  const painted = await page.evaluate(() => {
    const a = window.editor;
    a.setFrame(40);
    a.stage.draw();
    const c = document.querySelector('.view').getContext('2d');
    const { data } = c.getImageData(0, 0, c.canvas.width, c.canvas.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 97) {
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return seen.size;
  });
  expect(painted, 'the canvas should hold more than one colour').toBeGreaterThan(8);
  expect(errors).toEqual([]);
});

test('the demo loop closes: the last frame hands back to the first', async ({ page }) => {
  // The arithmetic is checked in `node --test`; this checks the pixels, with
  // the same rounding, tiling and edge extension the editor really uses.
  await boot(page);
  const diff = await page.evaluate(async () => {
    const { renderScene } = await import('/src/render.js');
    const a = window.editor;
    const s = a.store.scene;
    const [vw, vh] = [Math.ceil(s.canvas[0] / s.zoom), Math.ceil(s.canvas[1] / s.zoom)];
    const shot = f => {
      const c = document.createElement('canvas');
      c.width = vw; c.height = vh;
      renderScene(c.getContext('2d'), s, f, a.resolve);
      return c.getContext('2d').getImageData(0, 0, vw, vh).data;
    };
    const first = shot(0), wrapped = shot(s.loop_frames);
    let n = 0;
    for (let i = 0; i < first.length; i++) if (first[i] !== wrapped[i]) n++;
    return n;
  });
  expect(diff, 'frame 0 and frame loop_frames must be the same picture').toBe(0);
});

test('a loop that does not close offers the numbers that would close it', async ({ page }) => {
  await boot(page);

  // a speed that feels right and is not: 1.5 × 256 frames is a tile and a half
  await page.evaluate(() => {
    const a = window.editor;
    a.editIndex('layer', 2, null, l => { l.speed = 1.5; });
    a.select('layer', 2);
  });
  const panel = page.locator('#right');
  await expect(panel.locator('.note.warn')).toContainText('does not close');

  const fix = panel.locator('.fix button', { hasText: 'speed 2' });
  await expect(fix).toBeVisible();
  await fix.click();

  expect(await page.evaluate(() => window.editor.store.scene.layers[2].speed)).toBe(2);
  // the panel must redraw: a note still reading “does not close” after pressing the
  // button that fixes it is worse than no button at all
  await expect(panel.locator('.note.ok').first()).toContainText('closes seamlessly');
  await expect(panel.locator('.fix')).toHaveCount(0);
});

test('an actor whose cels will never divide the loop is offered the order trick', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const a = window.editor;
    a.editIndex('actor', 0, null, x => { x.frames = 3; x.delay = 5; });
    a.select('actor', 0);
  });
  const panel = page.locator('#right');
  const fix = panel.locator('.fix button', { hasText: 'order 0,1,2,1' });
  await expect(fix).toBeVisible();
  await fix.click();

  const after = await page.evaluate(() => {
    const a = window.editor.store.scene.actors[0];
    return { order: a.order, delay: a.delay, loop: window.editor.store.scene.loop_frames };
  });
  expect(after.order).toEqual([0, 1, 2, 1]);
  // the order alone would still not divide the loop; the delay has to come too
  expect(after.loop % (after.order.length * after.delay)).toBe(0);
  await expect(panel.locator('.note.ok').first()).toContainText('fits');
});

test('typing a layer speed straight into the field updates the loop warning live', async ({ page }) => {
  // The panel is deliberately not rebuilt while a field is being typed into
  // (that would throw the caret out), but the loop-closing verdict has to
  // catch up anyway — it used to only refresh on reselecting the layer.
  await boot(page);
  await page.evaluate(() => window.editor.select('layer', 2));

  const panel = page.locator('#right');
  await expect(panel.locator('.note.ok').first()).toContainText('closes seamlessly');

  const speed = panel.locator('[data-field=speed] input');
  await speed.fill('1.5');
  await expect(panel.locator('.note.warn')).toContainText('does not close');
  await expect(panel.locator('.fix button', { hasText: 'speed 2' })).toBeVisible();

  await speed.fill('2');
  await expect(panel.locator('.note.ok').first()).toContainText('closes seamlessly');
  await expect(panel.locator('.fix')).toHaveCount(0);
});

test('typing an actor frame count straight into the field updates the loop warning live', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.editor.select('actor', 0));

  const panel = page.locator('#right');
  await expect(panel.locator('.note.ok').first()).toContainText('fits');

  const frames = panel.locator('[data-field=frames] input');
  await frames.fill('3');
  await expect(panel.locator('.note.warn')).toContainText('does not divide');

  await frames.fill('4');
  await expect(panel.locator('.note.ok').first()).toContainText('fits');
  await expect(panel.locator('.fix')).toHaveCount(0);
});

test('nothing invisible is sitting on top of the page', async ({ page }) => {
  await boot(page);
  // the bug: #drop-veil kept display:flex over the whole viewport, so every
  // click in the editor landed on it instead of on the control underneath
  for (const target of ['#btn-export', '#btn-play', '.view', '#asset-filter']) {
    const onTop = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return el.contains(hit) || hit === el;
    }, target);
    expect(onTop, `${target} should receive its own clicks`).toBe(true);
  }
  await expect(page.locator('#drop-veil')).toBeHidden();
});

test('the export dialog opens by clicking it, not just by script', async ({ page }) => {
  await boot(page);
  await page.click('#btn-export');
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#modal-title')).toHaveText('Export');
  await page.click('#modal-close');
  await expect(page.locator('#modal')).toBeHidden();
});

test('typing in the inspector keeps the caret where it is', async ({ page }) => {
  await boot(page);
  await page.click('#outliner-actors li:first-child');

  const name = page.locator('#right [data-field=name] input');
  await name.click();
  await name.fill('');
  await page.keyboard.type('quick runner');
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('quick runner');

  // a number field, typed digit by digit, must not lose focus either
  const delay = page.locator('#right [data-field=delay] input');
  await delay.click();
  await delay.fill('');
  await page.keyboard.type('12');
  await expect(delay).toBeFocused();
  await expect(delay).toHaveValue('12');
  expect(await page.evaluate(() => window.editor.store.scene.actors[0].delay)).toBe(12);
});

test('a paired field does not put the other half back', async ({ page }) => {
  await boot(page);
  await page.click('#btn-scene-props');

  const canvas = page.locator('#right [data-field=canvas]');
  const w = canvas.locator('input').first();
  const h = canvas.locator('input').nth(1);
  await w.fill('800');
  await h.fill('600');
  expect(await page.evaluate(() => window.editor.store.scene.canvas)).toEqual([800, 600]);
});

test('dragging an asset thumbnail does not reload the project', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => window.editor.assets.count);
  expect(before).toBeGreaterThan(1);

  const card = page.locator('.asset').first();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 60, { steps: 12 });
  await page.mouse.up();

  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.editor.assets.count)).toBe(before);
  await expect(page.locator('#drop-veil')).toBeHidden();
});

test('hovering an asset shows it larger', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#asset-preview')).toBeHidden();

  await page.locator('.asset').first().hover();
  const preview = page.locator('#asset-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('img')).toBeVisible();
  await expect(preview.locator('.preview-size')).toContainText('px');

  const [thumb, big] = await Promise.all([
    page.locator('.asset').first().locator('img').boundingBox(),
    preview.locator('img').boundingBox(),
  ]);
  expect(big.width).toBeGreaterThan(thumb.width);

  await page.locator('#btn-play').hover();
  await expect(preview).toBeHidden();
});

test('the preview clears the "Pick an image" modal instead of hiding behind it', async ({ page }) => {
  // an open <dialog> paints in the browser's top layer, above any z-index in
  // the document — the preview has to move into the dialog to draw over it
  await boot(page);
  await page.locator('#outliner-actors .add-row button').click();
  await expect(page.locator('#modal')).toBeVisible();

  const card = page.locator('#modal .asset').first();
  await card.hover();

  const preview = page.locator('#asset-preview');
  await expect(preview).toBeVisible();
  // the fix: while the dialog owns the top layer, the preview has to live
  // inside it too, or it paints underneath regardless of its own z-index
  expect(await preview.evaluate(el => el.parentElement.id)).toBe('modal');

  await page.locator('#modal-close').click();
  await expect(preview).toBeHidden();

  // and the plain asset panel still gets its own preview once the modal is gone
  await page.locator('.asset').first().hover();
  await expect(preview).toBeVisible();
  expect(await preview.evaluate(el => el.parentElement)).not.toBeNull();
  expect(await preview.evaluate(el => el.parentElement.id)).not.toBe('modal');
});

test('the playhead advances and the scrubber follows', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() => window.editor.frame > 3, null, { timeout: 5000 });
  await page.click('#btn-play');                       // pause
  const stopped = await page.evaluate(() => window.editor.frame);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.editor.frame)).toBe(stopped);

  await page.click('#btn-next');
  expect(await page.evaluate(() => window.editor.frame)).toBe(stopped + 1);
  await expect(page.locator('#scrub')).toHaveValue(String(stopped + 1));
});

test('coming back from a minimized window does not fast-forward the playback', async ({ page }) => {
  await boot(page);

  // Minimizing stops the animation frames but not the clock, so we come back
  // owing thousands of milliseconds. That is what an old `lastTick` stands in
  // for here — the frames used to be paid back several per tick, and the scene
  // sprinted until the debt cleared.
  const run = await page.evaluate(async () => {
    const a = window.editor;
    a.pause();
    a.setFrame(0);
    a.togglePlay();
    a.lastTick = performance.now() - 5000;

    const loop = a.store.scene.loop_frames;
    const start = performance.now();
    let last = a.frame, advanced = 0;
    await new Promise(done => {
      const step = () => {
        advanced += ((a.frame - last) % loop + loop) % loop;
        last = a.frame;
        if (performance.now() - start < 500) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    a.pause();
    return { advanced, elapsed: performance.now() - start, fps: a.store.scene.fps };
  });

  const expected = run.elapsed * run.fps / 1000;
  expect(run.advanced, 'playback should resume at its own speed, not race')
    .toBeLessThan(expected * 2);
  expect(run.advanced, 'and it should still be playing').toBeGreaterThan(1);
});

test('an actor can be dragged around the canvas', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.editor.pause(); window.editor.setFrame(0); });

  const start = await page.evaluate(() => {
    const a = window.editor;
    const actor = a.store.scene.actors[0];
    const img = a.resolve(actor.sprite);
    const box = a.stage.view.getBoundingClientRect();
    const scale = box.width / a.stage.view.width;
    const dy = a.store.scene.world_height
      ? a.stage.view.height - a.store.scene.world_height : 0;
    return {
      x: box.x + actor.x * scale,
      y: box.y + (actor.y + dy - (img.naturalHeight / 2)) * scale,
      before: actor.x,
    };
  });

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 90, start.y, { steps: 10 });
  await page.mouse.up();

  const after = await page.evaluate(() => window.editor.store.scene.actors[0].x);
  expect(after).toBeGreaterThan(start.before);
  expect(await page.evaluate(() => window.editor.selection.kind)).toBe('actor');
});

test('exporting produces a real GIF', async ({ page }) => {
  await boot(page);
  const head = await page.evaluate(async () => {
    const { exportGIF } = await import('/src/export/index.js');
    const a = window.editor;
    const { blob } = await exportGIF(a.store.scene, a.resolve, { step: 32 });
    const bytes = new Uint8Array(await blob.slice(0, 6).arrayBuffer());
    return { magic: String.fromCharCode(...bytes), size: blob.size };
  });
  expect(head.magic).toBe('GIF89a');
  expect(head.size).toBeGreaterThan(1000);
});

/**
 * Stand in for an opened folder. Playwright cannot drive the directory picker,
 * so the handle is faked at the only place that matters: the write.
 */
async function fakeFolder(page, scenePath = 'scene.json') {
  await page.evaluate(path => {
    const a = window.editor;
    window.__writes = [];
    Object.defineProperty(a.assets, 'canWrite', { value: true, configurable: true });
    a.assets.label = 'project';
    a.assets.writeText = async (p, text) => { window.__writes.push({ path: p, text }); return p; };
    a.scenePath = path;
    a.disk.seed(path, '');       // as if this file were already on disk
    a.refresh();
  }, scenePath);
}

test('with a folder open, an edit reaches the file by itself', async ({ page }) => {
  await boot(page);
  await fakeFolder(page);
  expect(await page.evaluate(() => window.__writes.length))
    .toBe(0);                                    // opening a folder writes nothing

  await page.click('#outliner-actors li:first-child');
  const name = page.locator('#right [data-field=name] input');
  await name.fill('saved by itself');
  await name.blur();

  await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 4000 });
  await page.waitForTimeout(300);
  const writes = await page.evaluate(() => window.__writes);
  expect(writes.length, 'a burst of typing is one write, not one per keystroke')
    .toBeLessThanOrEqual(2);
  expect(writes.at(-1).path).toBe('scene.json');
  expect(JSON.parse(writes.at(-1).text).actors[0].name).toBe('saved by itself');

  await expect(page.locator('#save-state')).toContainText('scene.json');
  expect(await page.evaluate(() => window.editor.store.dirty)).toBe(false);
});

test('unticking auto stops the writes, ticking it back sends them', async ({ page }) => {
  await boot(page);
  await fakeFolder(page);

  await page.uncheck('#chk-autosave');
  await page.evaluate(() => window.editor.editIndex('actor', 0, null, a => { a.name = 'on its own'; }));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__writes.length)).toBe(0);
  await expect(page.locator('#save-state')).toContainText('unsaved');

  await page.check('#chk-autosave');
  await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 4000 });
  expect(await page.evaluate(() => JSON.parse(window.__writes.at(-1).text).actors[0].name))
    .toBe('on its own');
});

test('a folder that refuses the write says so and gives up', async ({ page }) => {
  await boot(page);
  await fakeFolder(page);
  await page.evaluate(() => {
    window.editor.assets.writeText = async () => { throw new Error('permiso denegado'); };
  });

  await page.evaluate(() => window.editor.editIndex('actor', 0, null, a => { a.name = 'no permission'; }));
  await expect(page.locator('#save-state')).toContainText('autosave stopped', { timeout: 4000 });
  await expect(page.locator('#status')).toContainText('could not save');
  expect(await page.evaluate(() => window.editor.disk.enabled)).toBe(false);
});

test('without a folder nothing is written to a disk that is not there', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#save-state')).toContainText('browser only');
  await page.click('#outliner-actors li:first-child');
  await page.locator('#right [data-field=name] input').fill('no folder');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.editor.disk.writes)).toBe(0);
});

test('a sprite repainted outside the editor comes back on its own', async ({ page }) => {
  await boot(page);

  // A file handle whose bytes and stamp we control: the browser will not let a
  // test hand the page a real folder, and this is the only part that matters.
  const before = await page.evaluate(async () => {
    const a = window.editor;
    const square = async colour => {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      const g = c.getContext('2d');
      g.fillStyle = colour;
      g.fillRect(0, 0, 4, 4);
      return new Promise(r => c.toBlob(r, 'image/png'));
    };
    const state = { blob: await square('#ff0000'), stamp: 1000 };
    window.__repaint = async () => {
      state.blob = await square('#00ff00');
      state.stamp = 2000;
    };
    a.assets.entries.set('watched.png', {
      handle: {
        getFile: async () =>
          new File([state.blob], 'watched.png', { lastModified: state.stamp }),
      },
    });
    window.__reloaded = [];
    const chain = a.assets.onReload;
    a.assets.onReload = keys => { window.__reloaded.push(...keys); chain(keys); };

    a.assets.get('watched.png');                       // asking for it loads it
    await new Promise(r => setTimeout(r, 400));
    return a.assets.images.get('watched.png').src;
  });
  expect(before).toMatch(/^blob:/);

  await page.evaluate(() => window.__repaint());        // "saved from Aseprite"
  await page.waitForFunction(() => window.__reloaded.includes('watched.png'),
                             null, { timeout: 8000 });

  const after = await page.evaluate(() => window.editor.assets.images.get('watched.png').src);
  expect(after, 'the stale blob must not be reused').not.toBe(before);
  await expect(page.locator('#status')).toContainText('updated from disk');
});

test('the scene survives a reload', async ({ page }) => {
  await boot(page);
  await page.click('#outliner-actors li:first-child');
  const name = page.locator('#right [data-field=name] input');
  await name.fill('survivor');
  await name.blur();
  await page.waitForTimeout(600);   // let the autosave debounce run

  await page.reload();
  await page.waitForFunction(() => !!window.editor, null, { timeout: 15000 });
  expect(await page.evaluate(() => window.editor.store.scene.actors[0].name))
    .toBe('survivor');
});

/**
 * The File System Access API is Chromium-only to start with, so there is no
 * way to make Playwright's own browser lack it or pretend to be Brave — these
 * stub the two globals `browser-support.js` reads, which is the only part of
 * the Brave/Firefox/Safari messaging that runs as ordinary JS.
 */
async function bootWithoutFolderAccess(page, { brave } = {}) {
  await page.addInitScript(brave => {
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
    if (brave) {
      Object.defineProperty(navigator, 'brave', {
        value: { isBrave: () => Promise.resolve(true) },
        configurable: true,
      });
    }
  }, brave);
  await page.goto('/');
  await page.waitForFunction(() => !!window.editor?.folderSupport, null, { timeout: 15000 });
}

test('Brave is told about the flag, not that it lacks the API', async ({ page }) => {
  await bootWithoutFolderAccess(page, { brave: true });
  expect(await page.evaluate(() => window.editor.folderSupport)).toBe('brave');
  await expect(page.locator('#btn-project')).toHaveAttribute('title', /brave:\/\/flags/);
});

test('a browser without the API and without Brave is told read-only is permanent', async ({ page }) => {
  await bootWithoutFolderAccess(page, { brave: false });
  expect(await page.evaluate(() => window.editor.folderSupport)).toBe('none');
  await expect(page.locator('#btn-project')).toHaveAttribute('title', /Download/);
});
