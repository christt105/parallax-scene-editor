// Smoke tests in a real browser.
//
// Every one of these covers a bug that actually shipped: a fixed overlay
// swallowing all the clicks, a panel rebuilding itself out from under the
// caret, an internal image drag being mistaken for someone loading a project.
// They are about the wiring — the maths is covered by `node --test`.

import { test, expect } from '@playwright/test';

/** Wait for the demo to be on screen with its images decoded. */
async function boot(page) {
  const errors = [];
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => {
    const a = window.editor;
    return a && a.store.scene.layers.length > 0 &&
      a.store.scene.layers.every(l => a.resolve(l.sprite));
  }, null, { timeout: 15000 });
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
  await expect(page.locator('#modal-title')).toHaveText('Exportar');
  await page.click('#modal-close');
  await expect(page.locator('#modal')).toBeHidden();
});

test('typing in the inspector keeps the caret where it is', async ({ page }) => {
  await boot(page);
  await page.click('#outliner-actors li:first-child');

  const name = page.locator('#right [data-field=name] input');
  await name.click();
  await name.fill('');
  await page.keyboard.type('corredor veloz');
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('corredor veloz');

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
    a.assets.label = 'proyecto';
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
  await name.fill('guardado solo');
  await name.blur();

  await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 4000 });
  await page.waitForTimeout(300);
  const writes = await page.evaluate(() => window.__writes);
  expect(writes.length, 'a burst of typing is one write, not one per keystroke')
    .toBeLessThanOrEqual(2);
  expect(writes.at(-1).path).toBe('scene.json');
  expect(JSON.parse(writes.at(-1).text).actors[0].name).toBe('guardado solo');

  await expect(page.locator('#save-state')).toContainText('scene.json');
  expect(await page.evaluate(() => window.editor.store.dirty)).toBe(false);
});

test('unticking auto stops the writes, ticking it back sends them', async ({ page }) => {
  await boot(page);
  await fakeFolder(page);

  await page.uncheck('#chk-autosave');
  await page.evaluate(() => window.editor.editIndex('actor', 0, null, a => { a.name = 'a solas'; }));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__writes.length)).toBe(0);
  await expect(page.locator('#save-state')).toContainText('sin guardar');

  await page.check('#chk-autosave');
  await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 4000 });
  expect(await page.evaluate(() => JSON.parse(window.__writes.at(-1).text).actors[0].name))
    .toBe('a solas');
});

test('a folder that refuses the write says so and gives up', async ({ page }) => {
  await boot(page);
  await fakeFolder(page);
  await page.evaluate(() => {
    window.editor.assets.writeText = async () => { throw new Error('permiso denegado'); };
  });

  await page.evaluate(() => window.editor.editIndex('actor', 0, null, a => { a.name = 'sin permiso'; }));
  await expect(page.locator('#save-state')).toContainText('autoguardado detenido', { timeout: 4000 });
  await expect(page.locator('#status')).toContainText('no se pudo guardar');
  expect(await page.evaluate(() => window.editor.disk.enabled)).toBe(false);
});

test('without a folder nothing is written to a disk that is not there', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#save-state')).toContainText('solo en el navegador');
  await page.click('#outliner-actors li:first-child');
  await page.locator('#right [data-field=name] input').fill('sin carpeta');
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
    a.assets.entries.set('vigilado.png', {
      handle: {
        getFile: async () =>
          new File([state.blob], 'vigilado.png', { lastModified: state.stamp }),
      },
    });
    window.__reloaded = [];
    const chain = a.assets.onReload;
    a.assets.onReload = keys => { window.__reloaded.push(...keys); chain(keys); };

    a.assets.get('vigilado.png');                       // asking for it loads it
    await new Promise(r => setTimeout(r, 400));
    return a.assets.images.get('vigilado.png').src;
  });
  expect(before).toMatch(/^blob:/);

  await page.evaluate(() => window.__repaint());        // "saved from Aseprite"
  await page.waitForFunction(() => window.__reloaded.includes('vigilado.png'),
                             null, { timeout: 8000 });

  const after = await page.evaluate(() => window.editor.assets.images.get('vigilado.png').src);
  expect(after, 'the stale blob must not be reused').not.toBe(before);
  await expect(page.locator('#status')).toContainText('actualizado desde el disco');
});

test('the scene survives a reload', async ({ page }) => {
  await boot(page);
  await page.click('#outliner-actors li:first-child');
  const name = page.locator('#right [data-field=name] input');
  await name.fill('sobreviviente');
  await name.blur();
  await page.waitForTimeout(600);   // let the autosave debounce run

  await page.reload();
  await page.waitForFunction(() => !!window.editor, null, { timeout: 15000 });
  expect(await page.evaluate(() => window.editor.store.scene.actors[0].name))
    .toBe('sobreviviente');
});
