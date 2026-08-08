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
