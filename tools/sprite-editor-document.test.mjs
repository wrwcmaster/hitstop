import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const model = await server.ssrLoadModule('/tools/src/sprite-editor-document.ts');
  const workspace = await server.ssrLoadModule('/tools/src/sprite-editor-workspace.ts');
  const renderPolicy = await server.ssrLoadModule('/src/game/actors/player-render-policy.ts');

  assert.equal(renderPolicy.shouldSuppressHeldWeapon(true, true), true);
  assert.equal(renderPolicy.shouldSuppressHeldWeapon(true, false), false);
  assert.equal(renderPolicy.shouldSuppressHeldWeapon(false, true), false);
  assert.equal(renderPolicy.shouldSuppressHeldWeapon(undefined, true), false);

  const layered = () => ({
    hd: true,
    palette: { A: '#ffffff', B: '#00000080' },
    anims: {
      idle: { fps: 4, frameCount: 2 },
      air: 'idle',
      fall: 'air',
      run: { fps: 8, frameCount: 1 },
    },
    layers: [
      {
        id: 'base', name: 'Base', tag: 'body', tracks: {
          idle: [['A.', '..'], ['.A', '..']],
          run: [['AA', '..']],
        },
      },
      {
        id: 'hand', name: 'Hand', tag: 'front', composition: 'overlay', tracks: {
          idle: [['..', 'B.'], ['..', '.B']],
          run: [['..', 'B.']],
        },
      },
    ],
    anchors: {
      grip: {
        idle: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        air: [{ x: 10, y: 10 }, { x: 11, y: 11 }],
        fall: [{ x: 20, y: 20 }, { x: 21, y: 21 }],
        run: [{ x: 1, y: 0 }],
      },
    },
    attachmentSlots: { weapon: { anchor: 'grip' } },
  });

  {
    const file = layered();
    model.validateSpriteEditorDocument(file);
    assert.equal(file.layers[1].composition, 'overlay');
    file.layers[1].composition = 'mystery';
    assert.throws(
      () => model.validateSpriteEditorDocument(file),
      /unknown composition "mystery"/,
    );
  }

  {
    const file = layered();
    const authoredAliasAnchor = file.anchors.grip.air[0];
    const source = model.materializeSpriteAnimationAlias(file, 'air');
    assert.equal(source, 'idle');
    assert.deepEqual(file.anims.air, { fps: 4, frameCount: 2 });
    assert.deepEqual(file.layers[0].tracks.air, file.layers[0].tracks.idle);
    assert.notEqual(file.layers[0].tracks.air, file.layers[0].tracks.idle);
    assert.notEqual(file.layers[0].tracks.air[0], file.layers[0].tracks.idle[0]);
    assert.deepEqual(file.anchors.grip.air, [{ x: 10, y: 10 }, { x: 11, y: 11 }]);
    assert.notEqual(file.anchors.grip.air[0], authoredAliasAnchor);
    file.layers[0].tracks.air[0][0] = 'BB';
    assert.equal(file.layers[0].tracks.idle[0][0], 'A.');
    assert.equal(file.anims.fall, 'air');
    model.validateSpriteEditorDocument(file);
  }

  {
    const file = layered();
    assert.throws(
      () => model.materializeSpriteAnimationAlias(file, 'idle'),
      /already independent/,
    );
  }

  {
    const file = {
      palette: { '.': null, A: '#ffffff' },
      anims: {
        idle: { fps: 4, frames: [['A'], ['.']], loop: false },
        air: 'idle',
      },
      anchors: { grip: { idle: [{ x: 0, y: 0 }, { x: 1, y: 0 }] } },
    };
    model.materializeSpriteAnimationAlias(file, 'air');
    assert.deepEqual(file.anims.air, { fps: 4, frames: [['A'], ['.']], loop: false });
    assert.notEqual(file.anims.air.frames, file.anims.idle.frames);
    assert.notEqual(file.anims.air.frames[0], file.anims.idle.frames[0]);
    assert.deepEqual(file.anchors.grip.air, file.anchors.grip.idle);
    assert.notEqual(file.anchors.grip.air[0], file.anchors.grip.idle[0]);
  }

  {
    const file = layered();
    model.insertSpriteFrame(file, 'air', 1, 'duplicate');
    assert.equal(file.anims.idle.frameCount, 3);
    assert.deepEqual(file.layers[0].tracks.idle[1], file.layers[0].tracks.idle[0]);
    assert.notEqual(file.layers[0].tracks.idle[1], file.layers[0].tracks.idle[0]);
    assert.deepEqual(file.layers[1].tracks.idle[1], file.layers[1].tracks.idle[0]);
    assert.deepEqual(file.anchors.grip.idle[1], { x: 0, y: 0 });
    assert.notEqual(file.anchors.grip.idle[1], file.anchors.grip.idle[0]);
    assert.deepEqual(file.anchors.grip.air.map((point) => point.x), [10, 10, 11]);
    assert.deepEqual(file.anchors.grip.fall.map((point) => point.x), [20, 20, 21]);
    model.validateSpriteEditorDocument(file);
  }

  {
    const file = layered();
    model.insertSpriteFrame(file, 'idle', 2, 'empty');
    assert.deepEqual(file.layers[0].tracks.idle[2], ['..', '..']);
    assert.deepEqual(file.layers[1].tracks.idle[2], ['..', '..']);
    assert.equal(model.removeSpriteFrame(file, 'idle', 2), 1);
    assert.equal(file.anims.idle.frameCount, 2);
    model.moveSpriteFrame(file, 'idle', 0, 1);
    assert.deepEqual(file.layers[0].tracks.idle[1], ['A.', '..']);
    assert.deepEqual(file.anchors.grip.idle[1], { x: 0, y: 0 });
    assert.deepEqual(file.anchors.grip.air.map((point) => point.x), [11, 10]);
    assert.deepEqual(file.anchors.grip.fall.map((point) => point.x), [21, 20]);
  }

  {
    const file = layered();
    const next = model.deleteSpriteAnimation(file, 'idle');
    assert.equal(next, 'run');
    assert.deepEqual(Object.keys(file.anims), ['run']);
    assert.equal('idle' in file.layers[0].tracks, false);
    assert.equal('idle' in file.anchors.grip, false);
  }

  {
    const file = layered();
    const next = model.deleteSpriteAnimation(file, 'air');
    assert.equal(next, 'idle');
    assert.equal(file.anims.idle.frameCount, 2);
    assert.equal('air' in file.anims, false);
    assert.equal('fall' in file.anims, false);
    assert.ok(file.layers[0].tracks.idle);
  }

  {
    const file = layered();
    model.resizeSpriteDocument(file, 3, 1);
    assert.deepEqual(file.layers[0].tracks.idle[0], ['A..']);
    assert.deepEqual(file.layers[1].tracks.run[0], ['...']);
  }

  {
    const file = {
      palette: { '.': null, A: '#ffffff' },
      anims: {
        small: { fps: 4, frames: [['A']] },
        wide: { fps: 4, frames: [['AAA']] },
      },
    };
    assert.doesNotThrow(() => model.validateSpriteEditorDocument(file));
    model.insertSpriteFrame(file, 'wide', 1, 'duplicate');
    assert.equal(file.anims.wide.frames.length, 2);
    assert.deepEqual(file.anims.wide.frames[1], ['AAA']);
    model.moveSpriteFrame(file, 'wide', 1, 0);
    assert.equal(model.removeSpriteFrame(file, 'wide', 0), 0);
  }

  {
    const file = layered();
    file.layers[1].tracks.idle.pop();
    assert.throws(
      () => model.validateSpriteEditorDocument(file),
      /expected 2 frames/,
    );
  }

  {
    const file = layered();
    file.anchors.grip.idle.pop();
    assert.throws(
      () => model.validateSpriteEditorDocument(file),
      /expected 2 points/,
    );
  }

  {
    const file = layered();
    file.anchors.grip.air.pop();
    assert.throws(
      () => model.validateSpriteEditorDocument(file),
      /anchor "grip.air" expected 2 points/,
    );
  }

  {
    const file = layered();
    file.anims.idle = 'fall';
    assert.throws(
      () => model.validateSpriteEditorDocument(file),
      /alias cycle/i,
    );
  }

  {
    const file = layered();
    file.attachmentSlots.weapon.anchor = 'missing';
    assert.throws(
      () => model.validateSpriteEditorDocument(file),
      /missing anchor/,
    );
  }

  {
    const file = layered();
    assert.throws(() => model.insertSpriteFrame(file, 'idle', 99, 'empty'), /out of range/);
    assert.throws(() => model.moveSpriteFrame(file, 'idle', 0, 99), /out of range/);
  }

  {
    const file = layered();
    const cursor = model.reconcileSpriteDocumentCursor(file, {
      animation: 'missing', frame: 99, layerId: 'missing',
    });
    assert.deepEqual(cursor, { animation: 'idle', frame: 1, layerId: 'base' });
  }

  {
    const trackedSprites = execFileSync('git', [
      'ls-files', '--', 'src/game/content/sprites/*.json',
    ], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
    assert.ok(trackedSprites.length > 0, 'expected tracked sprite fixtures');
    for (const path of trackedSprites) {
      const file = JSON.parse(readFileSync(path, 'utf8'));
      assert.doesNotThrow(
        () => model.validateSpriteEditorDocument(file),
        `tracked sprite ${path} must satisfy editor document invariants`,
      );
    }
  }

  {
    assert.doesNotThrow(() => workspace.validateRenderTagDefs([
      { id: 'body', label: 'Body' },
      { id: 'front-hand', label: 'Front hand' },
    ]));
    assert.throws(
      () => workspace.validateRenderTagDefs([{ id: 'body', label: 'Body' }, { id: 'body', label: 'Again' }]),
      /unique lowercase ids/,
    );
    const combat = {
      sword: {
        fps: 12,
        moves: {
          combo0: {
            frameCount: 5,
            activeFrames: [2, 4],
            hitbox: { forward: 3, y: 1, w: 8, h: 4 },
          },
        },
      },
    };
    assert.doesNotThrow(() => workspace.validateWeaponCombatTuning(combat));
    combat.sword.moves.combo0.activeFrames = [4, 6];
    assert.throws(() => workspace.validateWeaponCombatTuning(combat), /active end <= frameCount/);
  }

  console.log('sprite-editor document tests: ok');
} finally {
  await server.close();
}
