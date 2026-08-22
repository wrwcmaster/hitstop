import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  const agent = await server.ssrLoadModule('/tools/src/sprite-editor-agent.ts');
  const workspace = await server.ssrLoadModule('/tools/src/sprite-editor-workspace.ts');
  const selectionGeometry = await server.ssrLoadModule('/tools/src/sprite-editor-selection.ts');
  const renderPolicy = await server.ssrLoadModule('/src/game/actors/player-render-policy.ts');
  const spritefile = await server.ssrLoadModule('/src/engine/gfx/spritefile.ts');

  assert.equal(renderPolicy.shouldSuppressHeldWeapon(true, true), true);
  assert.equal(renderPolicy.shouldSuppressHeldWeapon(true, false), false);
  assert.equal(renderPolicy.shouldSuppressHeldWeapon(false, true), false);
  assert.equal(renderPolicy.shouldSuppressHeldWeapon(undefined, true), false);

  assert.deepEqual(selectionGeometry.analyzeSelectionGeometry({
    x: 10, y: 20, w: 5, h: 3,
    mask: ['1....', '.111.', '....1'],
  }), {
    pixelCount: 5,
    centroid: { x: 12.5, y: 21.5 },
    principalAxis: {
      angleDegrees: 22.5,
      start: { x: 10.4393, y: 20.6464 },
      end: { x: 14.5607, y: 22.3536 },
      length: 4.4609,
      orthogonalRms: 0.262,
      elongation: 33.9706,
    },
  });

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
    file.hitbox = { x: 5, y: 9.5, w: 10, h: 18 };
    file.animationHitboxOffsets = { idle: { x: 4, y: 8 } };
    const base = spritefile.resolveSpriteGeometry(file, 20, 24).hitbox;
    assert.deepEqual(spritefile.resolveSpriteHitbox(file, 'idle', base), { x: 4, y: 8, w: 10, h: 18 });
    assert.deepEqual(spritefile.resolveSpriteHitbox(file, 'air', base), { x: 4, y: 8, w: 10, h: 18 });
    assert.deepEqual(spritefile.resolveSpriteHitbox(file, 'run', base), { x: 5, y: 9.5, w: 10, h: 18 });

    model.materializeSpriteAnimationAlias(file, 'air');
    assert.deepEqual(file.animationHitboxOffsets.air, { x: 4, y: 8 });
    file.animationHitboxOffsets.air.x = 3;
    assert.equal(file.animationHitboxOffsets.idle.x, 4);
    model.validateSpriteEditorDocument(file);
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
    file.animationHitboxOffsets = {
      idle: { x: 2, y: 3 },
      air: { x: 4, y: 5 },
      fall: { x: 6, y: 7 },
      run: { x: 8, y: 9 },
    };
    const next = model.deleteSpriteAnimation(file, 'idle');
    assert.equal(next, 'run');
    assert.deepEqual(Object.keys(file.anims), ['run']);
    assert.equal('idle' in file.layers[0].tracks, false);
    assert.equal('idle' in file.anchors.grip, false);
    assert.deepEqual(file.animationHitboxOffsets, { run: { x: 8, y: 9 } });
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
    ], { encoding: 'utf8' }).trim().split(/\r?\n/).filter((path) => path && existsSync(path));
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

  {
    // Exercise the production frame-patching workflow on displayed frames
    // 3-5: pristine source copy, one-pass transforms, exact color transfer,
    // per-frame anchors, structured inspection, and transactional assertions.
    const empty = () => Array.from({ length: 6 }, () => '........');
    const target = {
      hd: false,
      palette: { '.': null, A: '#ffffff' },
      anims: { attack: { fps: 12, frameCount: 5 } },
      layers: [
        { id: 'sword', name: 'Sword', tag: 'held', tracks: { attack: Array.from({ length: 5 }, empty) } },
        { id: 'slash', name: 'Slash', tag: 'effect', composition: 'overlay', tracks: { attack: Array.from({ length: 5 }, empty) } },
      ],
      anchors: { grip: { attack: Array.from({ length: 5 }, () => ({ x: 0, y: 0 })) } },
      attachmentSlots: { grip: { anchor: 'grip' } },
    };
    const sourceRows = empty();
    sourceRows[1] = '.ZZ.....';
    sourceRows[2] = '.ZZZ....';
    sourceRows[5] = '.......Z';
    const source = {
      hd: false,
      palette: { '.': null, Z: '#123456' },
      anims: { attack2: { fps: 12, frameCount: 1 } },
      layers: [{ id: 'sword', name: 'Sword', tag: 'held', tracks: { attack2: [sourceRows] } }],
    };
    const transaction = {
      commands: [
        {
          op: 'frame.copy',
          from: {
            path: 'approved.json', animation: 'attack2', frame: 0, layerId: 'sword',
          },
          to: { animation: 'attack', frame: 2, layerId: 'sword', x: 1, y: 1 },
          region: { componentAt: { x: 1, y: 1, connectivity: 8 } },
        },
        { op: 'anchor.set', anchor: 'grip', animation: 'attack', frame: 2, point: { x: 2.5, y: 2 } },
        {
          op: 'frame.copy',
          from: {
            path: 'approved.json', animation: 'attack2', frame: 0, layerId: 'sword',
          },
          to: { animation: 'attack', frame: 3, layerId: 'sword', x: 3, y: 1 },
          region: { componentAt: { x: 1, y: 1 } },
          transform: { rotate: 90 },
        },
        { op: 'anchor.set', anchor: 'grip', animation: 'attack', frame: 3, point: { x: 4, y: 2.5, angle: 90 } },
        {
          op: 'frame.copy',
          from: {
            path: 'approved.json', animation: 'attack2', frame: 0, layerId: 'sword',
          },
          to: { animation: 'attack', frame: 4, layerId: 'sword', x: 1, y: 1 },
          region: { componentAt: { x: 1, y: 1 } },
          transform: { scaleX: 2, scaleY: 2 },
        },
        {
          op: 'frame.remapColors',
          target: { animation: 'attack', frame: 4, layerId: 'sword' },
          colors: { '#123456': '#654321' },
        },
        { op: 'anchor.set', anchor: 'grip', animation: 'attack', frame: 4, point: { x: 3, y: 3 } },
        {
          op: 'assert.frame', target: { animation: 'attack', frame: 2, layerId: 'sword' },
          expected: { pixelCount: 5, bounds: { x: 1, y: 1, w: 3, h: 2 }, componentCount: 1 },
        },
        {
          op: 'assert.frame', target: { animation: 'attack', frame: 3, layerId: 'sword' },
          expected: { pixelCount: 5, bounds: { x: 3, y: 1, w: 2, h: 3 }, componentCount: 1 },
        },
        { op: 'assert.anchor', anchor: 'grip', animation: 'attack', frame: 4, expected: { x: 3, y: 3 } },
      ],
      inspect: [2, 3, 4].map((frame) => ({ animation: 'attack', frame, layerId: 'sword', components: true })),
    };
    const result = agent.applySpriteAgentTransaction({
      activePath: 'target.json',
      active: target,
      documents: new Map([['approved.json', source]]),
    }, transaction);
    assert.equal(result.changed, true);
    assert.deepEqual(result.cursor, { animation: 'attack', frame: 4 });
    assert.deepEqual(result.inspection.frames.map((frame) => frame.pixelCount), [5, 5, 20]);
    assert.deepEqual(result.inspection.frames.map((frame) => frame.bounds), [
      { x: 1, y: 1, w: 3, h: 2 },
      { x: 3, y: 1, w: 2, h: 3 },
      { x: 1, y: 1, w: 6, h: 4 },
    ]);
    assert.equal(result.inspection.frames[2].colors[0].color, '#654321');
    assert.equal(result.file.anchors.grip.attack[2].x, 2.5);
    assert.equal(source.layers[0].tracks.attack2[0][1], '.ZZ.....', 'source document must stay untouched');
    assert.equal(target.layers[0].tracks.attack[2][1], '........', 'active input must stay untouched');

    const aligned = agent.applySpriteAgentTransaction({
      activePath: 'target.json',
      active: target,
      documents: new Map([['approved.json', source]]),
    }, {
      commands: [{
        op: 'frame.copyAligned',
        from: { path: 'approved.json', animation: 'attack2', frame: 0, layerId: 'sword' },
        to: { animation: 'attack', frame: 2, layerId: 'sword' },
        region: { componentAt: { x: 1, y: 1, connectivity: 8 } },
        sourceAxis: { start: { x: 1, y: 1.5 }, end: { x: 3, y: 1.5 } },
        targetAxis: { start: { x: 4, y: 0 }, end: { x: 4, y: 4 } },
      }],
      inspect: [{ animation: 'attack', frame: 2, layerId: 'sword', components: true }],
    });
    const alignedDetail = aligned.results[0].detail;
    assert.equal(alignedDetail.transform.rotate, 90);
    assert.equal(alignedDetail.transform.scaleX, 2);
    assert.deepEqual(alignedDetail.placement, { x: 1, y: 0, idealX: 1, idealY: 0 });
    assert.deepEqual(alignedDetail.mappedAxis, alignedDetail.targetAxis);
    assert.equal(alignedDetail.endpointError.max, 0);
    assert.equal(aligned.inspection.frames[0].pixelCount, 20);
    assert.deepEqual(agent.spriteAgentSourcePaths([{
      op: 'frame.copyAligned',
      from: { path: 'approved.json' },
    }]), ['approved.json']);

    assert.throws(() => agent.applySpriteAgentTransaction({
      activePath: 'target.json', active: target,
      documents: new Map([['approved.json', source]]),
    }, {
      commands: [{
        op: 'frame.copyAligned',
        from: { path: 'approved.json', animation: 'attack2', frame: 0, layerId: 'sword' },
        to: { animation: 'attack', frame: 2, layerId: 'sword' },
        sourceAxis: { start: { x: 1, y: 1 }, end: { x: 1, y: 1 } },
        targetAxis: { start: { x: 2, y: 2 }, end: { x: 3, y: 2 } },
      }],
    }), /sourceAxis endpoints must be distinct/);

    assert.throws(() => agent.applySpriteAgentTransaction({
      activePath: 'target.json', active: target,
      documents: new Map([['approved.json', source]]),
    }, {
      commands: [{
        op: 'frame.copyAligned',
        from: { path: 'approved.json', animation: 'attack2', frame: 0, layerId: 'sword' },
        to: { animation: 'attack', frame: 2, layerId: 'sword' },
        region: { componentAt: { x: 1, y: 1 } },
        sourceAxis: { start: { x: 1, y: 1.5 }, end: { x: 3, y: 1.5 } },
        targetAxis: { start: { x: 4.5, y: 0.5 }, end: { x: 4.5, y: 4.5 } },
        maxEndpointError: 0.1,
      }],
    }), /aligned endpoint error .* exceeds 0.1px/);

    const beforeFailure = JSON.stringify(result.file);
    assert.throws(() => agent.applySpriteAgentTransaction({
      activePath: 'target.json', active: result.file,
    }, {
      commands: [
        {
          op: 'pixel.set', target: { animation: 'attack', frame: 2, layerId: 'sword' },
          pixels: [{ x: 0, y: 0, color: '#abcdef' }],
        },
        {
          op: 'assert.frame', target: { animation: 'attack', frame: 2, layerId: 'sword' },
          expected: { pixelCount: 999 },
        },
      ],
    }), /command 2 \(assert\.frame\)/);
    assert.equal(JSON.stringify(result.file), beforeFailure, 'failed transaction must be atomic');

    assert.throws(() => agent.applySpriteAgentTransaction({
      activePath: 'target.json', active: result.file,
    }, {
      protocolVersion: 999,
      commands: [{ op: 'assert.frame', target: { animation: 'attack', frame: 2, layerId: 'sword' }, expected: {} }],
    }), /unsupported protocolVersion 999/);
    assert.throws(() => agent.applySpriteAgentTransaction({
      activePath: 'target.json', active: result.file,
    }, {
      commands: [{ op: 'invented.operation' }],
    }), /command 1 \(invented\.operation\): unsupported command operation/);
    assert.throws(() => agent.applySpriteAgentTransaction({
      activePath: 'target.json', active: result.file,
    }, {
      commands: [null],
    }), /command 1 \(undefined\): command must be an object/);
  }

  console.log('sprite-editor document tests: ok');
} finally {
  await server.close();
}
