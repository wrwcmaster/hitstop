import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

function measure(iterations, operation) {
  const started = performance.now();
  for (let i = 0; i < iterations; i++) operation(i);
  return (performance.now() - started) / iterations;
}

try {
  const kernels = await server.ssrLoadModule('/tools/src/sprite-editor-pixel-kernels.ts');
  const {
    brushStrength,
    commitPixelBatchRows,
    createPixelBatch,
    pastePixels,
    rotateSelectionRows,
    scaleSelectionRows,
    setBatchPixel,
  } = kernels;

  assert.equal(brushStrength(0, 0, 8), 1);
  assert.equal(brushStrength(5, 0, 8), 0);

  const batchedRows = ['....', '....'];
  const batch = createPixelBatch(batchedRows);
  setBatchPixel(batch, 1, 0, 'a');
  setBatchPixel(batch, 3, 1, 'b');
  assert.deepEqual(batchedRows, ['....', '....'], 'a batch must not mutate rows before commit');
  assert.equal(commitPixelBatchRows(batch), true);
  assert.deepEqual(batchedRows, ['.a..', '...b']);
  assert.equal(commitPixelBatchRows(createPixelBatch(batchedRows)), false);

  const quarter = rotateSelectionRows({ w: 3, h: 2, rows: ['abc', 'def'] }, 90);
  assert.deepEqual(quarter, { w: 2, h: 3, rows: ['da', 'eb', 'fc'], mask: undefined });

  const masked = { w: 2, h: 2, rows: ['ab', 'cd'], mask: ['10', '11'] };
  assert.deepEqual(scaleSelectionRows(masked, 4, 2, true), {
    w: 4,
    h: 2,
    rows: ['bbaa', 'ddcc'],
    mask: ['0011', '1111'],
  });
  const pasted = ['....', '....'];
  pastePixels(pasted, masked, 1, 0, true);
  assert.deepEqual(pasted, ['.a..', '.cd.']);

  const canvasSize = 160;
  const source = {
    w: 96,
    h: 56,
    rows: Array.from({ length: 56 }, (_, y) =>
      Array.from({ length: 96 }, (_, x) => ((x + y) % 5 ? 'a' : 'b')).join('')),
    mask: Array.from({ length: 56 }, () => '1'.repeat(96)),
  };

  const brushStampMs = measure(240, (iteration) => {
    const rows = Array.from({ length: canvasSize }, () => '.'.repeat(canvasSize));
    const stamp = createPixelBatch(rows);
    const size = 16;
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        if (brushStrength(dx, dy, size) > 0) {
          setBatchPixel(stamp, 80 + dx, 80 + dy, iteration % 2 ? 'a' : 'b');
        }
      }
    }
    commitPixelBatchRows(stamp);
  });
  const rotateMs = measure(120, (iteration) => {
    const result = rotateSelectionRows(source, 7 + (iteration % 37));
    assert.equal(result.rows.length, result.h);
    assert.equal(result.mask.length, result.h);
  });
  const scaleAndPasteMs = measure(180, (iteration) => {
    const scaled = scaleSelectionRows(source, 72 + (iteration % 16), 44 + (iteration % 8), iteration % 2 === 0);
    const rows = Array.from({ length: canvasSize }, () => '.'.repeat(canvasSize));
    pastePixels(rows, scaled, 20, 30, true);
  });

  // These are per-operation budgets, not broad test time. Each exact
  // production kernel must leave most of a 16.7 ms interaction frame free
  // for canvas drawing and DOM work.
  assert.ok(brushStampMs < 4, `brush stamp ${brushStampMs.toFixed(3)} ms exceeded 4 ms`);
  assert.ok(rotateMs < 12, `rotation ${rotateMs.toFixed(3)} ms exceeded 12 ms`);
  assert.ok(scaleAndPasteMs < 12, `scale/paste ${scaleAndPasteMs.toFixed(3)} ms exceeded 12 ms`);

  console.log(JSON.stringify({
    brushStampMs: Number(brushStampMs.toFixed(3)),
    rotateMs: Number(rotateMs.toFixed(3)),
    scaleAndPasteMs: Number(scaleAndPasteMs.toFixed(3)),
  }));
} finally {
  await server.close();
}
