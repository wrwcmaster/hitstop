import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launchBrowser } from './lib.mjs';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
await server.listen();
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => {
    window.previewFailures = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (/failed|unavailable/.test(String(text))) window.previewFailures.push(String(text));
      return fill.call(this, text, ...args);
    };
  });
  await page.goto(server.resolvedUrls.local[0] + 'tools/sprite-editor.html');
  await page.waitForFunction(() => !!window.__editor);
  const document = () => page.locator('#io').inputValue().then(JSON.parse);
  const original = await document();
  const sample = { hd: true, palette: { S: '#ffffff' }, anims: { idle: { fps: 8, frames: [['SS', '..']] }, air: 'idle' } };
  await page.locator('#io').fill(JSON.stringify(sample));
  await page.locator('#btnImport').click();
  assert.deepEqual((await document()).anims, sample.anims);
  await page.locator('#btnUndo').click();
  assert.deepEqual(await document(), original);
  await page.locator('#btnRedo').click();
  assert.deepEqual((await document()).anims, sample.anims);
  await page.locator('#io').fill(JSON.stringify({ frames: [['SS']] }));
  await page.locator('#btnImport').click();
  assert.match(await page.locator('#status').textContent(), /import failed/);
  await page.locator('#btnUndo').click();
  assert.deepEqual(await document(), original, 'failed import leaves history unchanged');

  const sprites = await page.locator('#selectSprite option').evaluateAll(options => options.map(o => o.value).filter(Boolean));
  const weapon = sprites.find(name => name.endsWith('rusty-sword.json'));
  assert.ok(weapon);
  await page.locator('#selectSprite').selectOption(weapon);
  await page.waitForFunction(() => window.__editor.rebuiltVersion === window.__editor.editVersion);
  const bodies = await page.locator('#compBody option').evaluateAll(options => options.map(o => o.value));
  assert.equal(bodies.length, 3);
  for (const body of bodies) {
    await page.locator('#compBody').selectOption(body);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  assert.deepEqual(await page.evaluate(() => window.previewFailures), []);
  await page.evaluate(async () => {
    const { CompositePreview } = await import('/tools/src/sprite-editor/composite-preview.ts');
    const canvas = document.createElement('canvas');
    new CompositePreview().render(canvas.getContext('2d'), canvas, 0,
      { file: window.__editor.file, animName: 'idle', fileName: 'test.json', version: 0 },
      { weapon: 'nonexistent-weapon', move: '', body: 'player', gear: false, trail: false, hitbox: false });
  });
  assert.ok((await page.evaluate(() => window.previewFailures)).some(text => text.startsWith('preview failed:')));
  assert.deepEqual(errors, []);
  console.log('sprite editor browser: import/history, composite bodies, live rebake, and visible preview errors passed');
} finally {
  await browser?.close();
  await server.close();
}
