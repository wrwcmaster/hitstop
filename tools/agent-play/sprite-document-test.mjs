import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, close } from './headless.mjs';

try {
  const { server } = await loadEngine();
  const { parseSpriteDocument: parse } = await server.ssrLoadModule('/tools/src/sprite-editor/document.ts');
  const { PAL } = await server.ssrLoadModule('/src/game/content/palette.ts');
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const files = walk('src/game/content/sprites').filter(p => p.endsWith('.json'));
  for (const file of files) parse(JSON.parse(fs.readFileSync(file, 'utf8')), PAL);
  const valid = { anims: { idle: { fps: 8, frames: [['..', '..']] }, air: 'idle' } };
  assert.equal(parse(valid, PAL).anims.air, 'idle');
  assert.throws(() => parse({ frames: [['..']], fps: 8 }, PAL), /named animations/);
  assert.throws(() => parse({ anims: { idle: 'air', air: 'idle' } }, PAL), /cycle/);
  assert.throws(() => parse({ anims: { idle: 'missing' } }, PAL), /nowhere/);
  assert.throws(() => parse({ anims: { ...valid.anims, bad: { fps: 8, frames: [] } } }, PAL), /nonempty/);
  assert.throws(() => parse({ anims: { idle: { fps: 8, frames: [['..', '.']] } } }, PAL), /rectangular/);
  const parsed = parse(valid, PAL);
  parsed.anims.idle.frames[0][0] = 'SS';
  assert.equal(valid.anims.idle.frames[0][0], '..', 'document owns its data');
  const { SpriteHistory } = await server.ssrLoadModule('/tools/src/sprite-editor/history.ts');
  const history = new SpriteHistory(2);
  const a = parse(valid, PAL);
  const b = structuredClone(a); b.anims.idle.frames[0][0] = 'SS';
  const c = structuredClone(a); c.anims.idle.frames[0][0] = 'S.';
  assert.equal(history.undo(a), null);
  history.checkpoint(a);
  assert.deepEqual(history.undo(b), a);
  assert.deepEqual(history.redo(a), b);
  assert.deepEqual(history.undo(b), a);
  history.checkpoint(a);
  assert.equal(history.canRedo, false, 'editing after undo discards the old branch');
  history.checkpoint(b);
  history.checkpoint(c);
  assert.deepEqual(history.undo(a), c);
  assert.deepEqual(history.undo(c), b);
  assert.equal(history.undo(b), null, 'history obeys its capacity');
  history.clear();
  history.checkpoint(a);
  a.anims.idle.frames[0][0] = 'SS';
  assert.equal(history.undo(a).anims.idle.frames[0][0], '..', 'snapshots are isolated from edits');
  history.clear();
  assert.equal(history.canUndo || history.canRedo, false);
  assert.throws(() => new SpriteHistory(0), /positive integer/);
  console.log(`sprite document: ${files.length} repository files and invalid-input checks passed`);
} finally { await close(); }
