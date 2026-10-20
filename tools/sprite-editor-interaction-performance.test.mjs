import assert from 'node:assert/strict';
import { existsSync, readFile, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('dist');
const contentTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filename = resolve(root, relative);
  if (!filename.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  readFile(filename, (error, data) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', contentTypes[extname(filename)] ?? 'application/octet-stream');
    response.end(data);
  });
});
await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('static test server did not bind');

const installedChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ?? (existsSync(installedChrome) ? installedChrome : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

const fixture = {
  hd: true,
  palette: { '.': null, A: '#f4f4f4', B: '#171a2b', C: '#b13e53' },
  anims: {
    idle: {
      fps: 8,
      frames: [Array.from({ length: 110 }, (_, y) =>
        Array.from({ length: 160 }, (_, x) => (
          x >= 24 && x < 136 && y >= 20 && y < 90 ? ((x + y) % 3 ? 'A' : 'B') : '.'
        )).join(''))],
    },
  },
};

const layeredAlphaFixture = {
  hd: true,
  palette: { '.': null, A: '#ff000080', B: '#0000ff' },
  anims: { idle: { fps: 8, frameCount: 1 } },
  layers: [
    { id: 'base', name: 'Base', tag: 'body', tracks: { idle: [['B.']] } },
    { id: 'overlay', name: 'Overlay', tag: 'body', tracks: { idle: [['A.']] } },
  ],
};
const fullPaletteFixture = JSON.parse(readFileSync(
  resolve('src/game/content/sprites/equipment/rusty-sword.json'),
  'utf8',
));

const average = (total, count) => count ? total / count : 0;

try {
  await page.goto(`http://127.0.0.1:${address.port}/tools/sprite-editor.html?v=interaction-performance`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForFunction(() => Boolean(window.__editor), undefined, { timeout: 30_000 });
  await page.evaluate((next) => window.__editor.replace(next, null), layeredAlphaFixture);
  await page.locator('#gridZoomPercent').fill('400');
  await page.locator('#gridZoomPercent').press('Tab');
  await page.waitForTimeout(40);
  const blendedPixel = await page.locator('#grid').evaluate((canvas) => (
    [...canvas.getContext('2d').getImageData(2, 2, 1, 1).data]
  ));
  assert.deepEqual(blendedPixel, [128, 0, 127, 255],
    'fast editor rasterization must preserve source-over layer alpha');

  await page.evaluate((next) => window.__editor.replace(next, null), fixture);
  await page.locator('#previewPlay').uncheck();
  await page.locator('#gridZoomPercent').fill('400');
  await page.locator('#gridZoomPercent').press('Tab');
  await page.locator('#btnToolBrush').click();
  await page.locator('#brushSize').fill('16');
  const canvas = page.locator('#grid');
  let bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('sprite canvas is not visible');
  const cell = bounds.width / 160;

  await page.evaluate(() => window.__editor.performance.reset());
  await page.mouse.move(bounds.x + 30 * cell, bounds.y + 30 * cell);
  await page.mouse.down();
  const drawingMoves = 32;
  for (let index = 0; index < drawingMoves; index++) {
    await page.mouse.move(
      bounds.x + (30 + index * 3) * cell,
      bounds.y + (30 + Math.floor(index / 4)) * cell,
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(80);
  const drawing = await page.evaluate(() => window.__editor.performance.snapshot);
  // Chromium may coalesce protocol mouse moves before they reach the page;
  // several distinct paint samples are sufficient to exercise interpolation.
  assert.ok(drawing.paintEvents > 2, `expected drawing events, got ${drawing.paintEvents}`);
  assert.ok(average(drawing.paintTotalMs, drawing.paintEvents) < 4,
    `paint handler averaged ${average(drawing.paintTotalMs, drawing.paintEvents).toFixed(2)} ms`);
  assert.ok(drawing.paintMaxMs < 20, `paint handler blocked ${drawing.paintMaxMs.toFixed(2)} ms`);
  assert.ok(drawing.redrawMaxMs < 25, `drawing redraw blocked ${drawing.redrawMaxMs.toFixed(2)} ms`);
  assert.ok(drawing.previewHeavyRenders <= 2,
    `preview rebuilt ${drawing.previewHeavyRenders} times during one drawing gesture`);

  // The production rusty-sword document fills the complete 345-character
  // palette. Feathering a new color must not rescan all 29 160x128 frames for
  // every blend generated by one pointer event.
  await page.evaluate((next) => window.__editor.replace(next, 'equipment/rusty-sword.json'), fullPaletteFixture);
  await page.locator('#previewPlay').uncheck();
  await page.locator('#gridZoomPercent').fill('400');
  await page.locator('#gridZoomPercent').press('Tab');
  await page.locator('#btnToolBrush').click();
  await page.locator('#brushSize').fill('16');
  bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('full-palette sprite canvas is not visible');
  const fullPaletteCell = bounds.width / 160;
  await page.evaluate(() => window.__editor.performance.reset());
  await page.mouse.move(bounds.x + 75 * fullPaletteCell, bounds.y + 64 * fullPaletteCell);
  await page.mouse.down();
  for (let index = 0; index < 12; index++) {
    await page.mouse.move(
      bounds.x + (75 + index * 2) * fullPaletteCell,
      bounds.y + (64 + Math.floor(index / 3)) * fullPaletteCell,
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(360);
  const fullPaletteDrawing = await page.evaluate(() => window.__editor.performance.snapshot);
  assert.ok(fullPaletteDrawing.paintEvents > 2,
    `expected full-palette drawing events, got ${fullPaletteDrawing.paintEvents}`);
  assert.ok(average(fullPaletteDrawing.paintTotalMs, fullPaletteDrawing.paintEvents) < 6,
    `full-palette brush averaged ${average(fullPaletteDrawing.paintTotalMs, fullPaletteDrawing.paintEvents).toFixed(2)} ms`);
  assert.ok(fullPaletteDrawing.paintMaxMs < 25,
    `full-palette brush blocked ${fullPaletteDrawing.paintMaxMs.toFixed(2)} ms`);
  assert.ok(fullPaletteDrawing.gestureFinishes >= 1, 'full-palette stroke did not finalize');
  assert.ok(fullPaletteDrawing.gestureFinishMaxMs < 16.7,
    `full-palette mouse-up blocked ${fullPaletteDrawing.gestureFinishMaxMs.toFixed(2)} ms`);
  assert.ok(fullPaletteDrawing.gestureSideEffectMaxMs < 16.7,
    `full-palette deferred finalization blocked ${fullPaletteDrawing.gestureSideEffectMaxMs.toFixed(2)} ms`);
  assert.ok(fullPaletteDrawing.draftPersistMaxMs < 16.7,
    `full-palette draft persistence blocked ${fullPaletteDrawing.draftPersistMaxMs.toFixed(2)} ms`);
  assert.ok(fullPaletteDrawing.bridgePublishDispatchMaxMs < 16.7,
    `full-palette bridge dispatch blocked ${fullPaletteDrawing.bridgePublishDispatchMaxMs.toFixed(2)} ms`);

  await page.evaluate((next) => window.__editor.replace(next, null), fixture);
  await page.locator('#btnToolSelect').click();
  bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('sprite canvas disappeared after selecting the rectangle tool');
  await page.mouse.move(bounds.x + 45 * cell, bounds.y + 35 * cell);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 105 * cell, bounds.y + 75 * cell);
  await page.mouse.up();
  await page.waitForTimeout(40);
  let selection = await page.evaluate(() => window.__editor.selection);
  if (!selection) {
    const diagnostic = await page.evaluate(({ startX, startY, endX, endY }) => ({
      active: document.querySelector('#btnToolSelect')?.className,
      startTarget: document.elementFromPoint(startX, startY)?.id,
      endTarget: document.elementFromPoint(endX, endY)?.id,
      canvas: (() => {
        const rect = document.querySelector('#grid')?.getBoundingClientRect();
        return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })(),
    }), {
      startX: bounds.x + 45 * cell,
      startY: bounds.y + 35 * cell,
      endX: bounds.x + 105 * cell,
      endY: bounds.y + 75 * cell,
    });
    throw new Error(`rectangular selection diagnostic: ${JSON.stringify(diagnostic)}`);
  }
  assert.ok(selection?.w > 40 && selection?.h > 20, 'rectangular selection was not created');

  await page.evaluate(() => window.__editor.performance.reset());
  let handleX = bounds.x + (selection.x + selection.w) * cell;
  let handleY = bounds.y + (selection.y + selection.h) * cell;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  const resizeMoves = 12;
  for (let index = 0; index < resizeMoves; index++) {
    await page.mouse.move(handleX + (index % 18) * cell / 3, handleY + (index % 12) * cell / 3);
  }
  await page.mouse.up();
  await page.waitForTimeout(80);

  selection = await page.evaluate(() => window.__editor.selection);
  const middleX = selection.x + selection.w / 2;
  const rotateAbove = selection.y * cell >= 32;
  const rotationY = rotateAbove ? selection.y - 24 / cell : selection.y + selection.h + 24 / cell;
  handleX = bounds.x + middleX * cell;
  handleY = bounds.y + rotationY * cell;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  const rotationMoves = 12;
  for (let index = 0; index < rotationMoves; index++) {
    const radians = -Math.PI / 2 + index / (rotationMoves - 1) * Math.PI / 2.5;
    await page.mouse.move(
      bounds.x + middleX * cell + Math.cos(radians) * 42,
      bounds.y + (selection.y + selection.h / 2) * cell + Math.sin(radians) * 42,
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(80);
  const transform = await page.evaluate(() => window.__editor.performance.snapshot);

  assert.ok(transform.selectionTransforms > 5, 'live resize/rotation did not reach the transform kernel');
  assert.ok(transform.selectionTransformMaxMs < 16.7,
    `selection transform blocked ${transform.selectionTransformMaxMs.toFixed(2)} ms`);
  assert.ok(transform.redrawMaxMs < 25, `transform redraw blocked ${transform.redrawMaxMs.toFixed(2)} ms`);
  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({
    drawing: {
      events: drawing.paintEvents,
      averageHandlerMs: Number(average(drawing.paintTotalMs, drawing.paintEvents).toFixed(3)),
      maxHandlerMs: Number(drawing.paintMaxMs.toFixed(3)),
      redraws: drawing.redraws,
      maxRedrawMs: Number(drawing.redrawMaxMs.toFixed(3)),
    },
    fullPaletteDrawing: {
      events: fullPaletteDrawing.paintEvents,
      averageHandlerMs: Number(average(
        fullPaletteDrawing.paintTotalMs,
        fullPaletteDrawing.paintEvents,
      ).toFixed(3)),
      maxHandlerMs: Number(fullPaletteDrawing.paintMaxMs.toFixed(3)),
      redraws: fullPaletteDrawing.redraws,
      maxRedrawMs: Number(fullPaletteDrawing.redrawMaxMs.toFixed(3)),
      mouseUpMs: Number(fullPaletteDrawing.gestureFinishMaxMs.toFixed(3)),
      deferredFinalizeMs: Number(fullPaletteDrawing.gestureSideEffectMaxMs.toFixed(3)),
      draftPersistMs: Number(fullPaletteDrawing.draftPersistMaxMs.toFixed(3)),
      bridgeDispatchMs: Number(fullPaletteDrawing.bridgePublishDispatchMaxMs.toFixed(3)),
    },
    transform: {
      rawMoves: resizeMoves + rotationMoves,
      operations: transform.selectionTransforms,
      averageKernelMs: Number(average(
        transform.selectionTransformTotalMs,
        transform.selectionTransforms,
      ).toFixed(3)),
      maxKernelMs: Number(transform.selectionTransformMaxMs.toFixed(3)),
      redraws: transform.redraws,
      maxRedrawMs: Number(transform.redrawMaxMs.toFixed(3)),
    },
  }));
} finally {
  await browser.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
