import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.SPRITE_EDITOR_URL ?? 'http://127.0.0.1:5175';
const installedChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ?? (existsSync(installedChrome) ? installedChrome : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const productionTransaction = JSON.parse(readFileSync(
  new URL('./examples/rusty-sword-agent-frame3-5.json', import.meta.url),
  'utf8',
));
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', (response) => {
  if (response.status() >= 400) errors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
});
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text());
});

const fixture = () => ({
  hd: true,
  palette: { '.': null, A: '#ffffff', B: '#111111' },
  anims: { idle: { fps: 4, frameCount: 2 }, air: 'idle' },
  layers: [
    {
      id: 'base', name: 'Base', tag: 'body', tracks: {
        idle: [['A.'], ['.A']],
      },
    },
    {
      id: 'hand', name: 'Hand', tag: 'front-hand', composition: 'overlay', tracks: {
        idle: [['.B'], ['B.']],
      },
    },
  ],
  anchors: {
    grip: {
      idle: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      air: [{ x: 10, y: 0 }, { x: 11, y: 0 }],
    },
  },
  attachmentSlots: { weapon: { anchor: 'grip' } },
});

try {
  await page.goto(`${baseUrl}/tools/sprite-editor.html?sprite=knight-v2.json`, {
    // The editor intentionally keeps its bridge EventSource open, so the
    // page never reaches Playwright's network-idle state.
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => Boolean(window.__editor));

  // A malformed inactive draft used to crash module initialization while
  // rebuilding the cross-sprite workspace. It must be ignored without
  // deleting it (the author may still recover its raw JSON manually).
  await page.evaluate(() => localStorage.setItem(
    `hitstop.sprite-editor.draft:${encodeURIComponent('broken.json')}`,
    JSON.stringify({
      v: 1,
      path: 'broken.json',
      baseFile: '',
      updatedAt: Date.now(),
      file: { anims: { idle: { fps: 4, frames: [['A'], ['AA']] } } },
    }),
  ));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__editor));
  assert.ok(await page.evaluate(() => localStorage.getItem(
    `hitstop.sprite-editor.draft:${encodeURIComponent('broken.json')}`,
  )));
  await page.evaluate(() => localStorage.removeItem(
    `hitstop.sprite-editor.draft:${encodeURIComponent('broken.json')}`,
  ));

  assert.equal(await page.locator('#workspaceStatusbar').isVisible(), true);
  assert.equal(await page.locator('#documentIdentity > .document-subline > #bridgeStatus').count(), 1);
  assert.doesNotMatch((await page.locator('#bridgeStatus').textContent()) ?? '', /bridge:|\.json|\//);
  await page.click('#previewZoomFit');
  const previewFit = await page.evaluate(() => {
    const canvas = document.querySelector('#preview');
    const viewport = document.querySelector('#previewViewport');
    const actual = parseFloat(canvas.style.width) / canvas.width;
    const expected = Math.max(0.1, Math.min(8, Math.min(
      (viewport.clientWidth - 2) / canvas.width,
      (viewport.clientHeight - 2) / canvas.height,
    )));
    return {
      actual,
      expected,
      fitsWidth: canvas.getBoundingClientRect().width <= viewport.clientWidth,
      fitsHeight: canvas.getBoundingClientRect().height <= viewport.clientHeight,
    };
  });
  assert.ok(
    Math.abs(previewFit.actual - previewFit.expected) < 0.02,
    `preview fit mismatch: ${JSON.stringify(previewFit)}`,
  );
  assert.equal(previewFit.fitsWidth, true);
  assert.equal(previewFit.fitsHeight, true);
  assert.equal(await page.locator('#previewZoomFit').getAttribute('aria-pressed'), null);
  const firstPreviewFit = await page.locator('#previewZoomPercent').inputValue();
  await page.click('#previewZoomFit');
  await page.click('#previewZoomFit');
  assert.equal(
    await page.locator('#previewZoomPercent').inputValue(),
    firstPreviewFit,
    'repeated preview Fit commands must be idempotent',
  );
  assert.deepEqual(await page.locator('#activeToolContext').evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { position: style.position, width: rect.width, height: rect.height };
  }), { position: 'absolute', width: 1, height: 1 });
  assert.equal(await page.locator('#activeToolName').textContent(), 'Pencil');
  const toolStripX = (await page.locator('#btnToolDraw').boundingBox())?.x;
  await page.click('#btnToolBrush');
  assert.equal(await page.locator('#activeToolName').textContent(), 'Soft brush');
  assert.equal((await page.locator('#btnToolDraw').boundingBox())?.x, toolStripX);
  assert.equal(await page.locator('#brushSizeConfig').isVisible(), true);
  await page.locator('[data-panel-target="left-tool"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-panel-target="left-reference"]').getAttribute('aria-selected'), 'true');
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', {
    key: '?', shiftKey: true, bubbles: true, cancelable: true,
  })));
  assert.equal(await page.locator('#shortcutsDialog').getAttribute('open'), '');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#shortcutsDialog').getAttribute('open'), null);

  await page.locator('#grid').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#side-left').isVisible(), false);
  assert.equal(await page.locator('#side-right').isVisible(), false);
  await page.locator('#grid').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#side-left').isVisible(), true);
  assert.equal(await page.locator('#side-right').isVisible(), true);
  await page.keyboard.down('Space');
  assert.equal(await page.locator('body').evaluate((body) => body.classList.contains('space-pan')), true);
  await page.keyboard.up('Space');
  assert.equal(await page.locator('body').evaluate((body) => body.classList.contains('space-pan')), false);

  await page.locator('#gridZoomPercent').evaluate((input) => {
    input.value = '6400';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#btnFitGrid').focus();
  await page.locator('#center').evaluate((center) => {
    center.scrollLeft = 0;
    center.scrollTop = 0;
  });
  const centerBox = await page.locator('#center').boundingBox();
  assert.ok(centerBox);
  await page.keyboard.down('Space');
  await page.mouse.move(centerBox.x + centerBox.width / 2, centerBox.y + centerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(centerBox.x + centerBox.width / 2 - 120, centerBox.y + centerBox.height / 2 - 80);
  await page.mouse.up();
  await page.keyboard.up('Space');
  assert.ok(await page.locator('#center').evaluate((center) => center.scrollLeft > 0 && center.scrollTop > 0));
  await page.click('#btnFitGrid');

  if (process.env.SPRITE_EDITOR_SCREENSHOT) {
    await page.screenshot({ path: process.env.SPRITE_EDITOR_SCREENSHOT, fullPage: true });
  }

  await page.evaluate((file) => window.__editor.replace(file, null), fixture());
  assert.deepEqual(
    await page.locator('.layer-composition').evaluateAll((selects) => (
      selects.map((select) => select.value)
    )),
    ['overlay', 'base'],
    'layer composition roles must be visible and survive document loading',
  );
  await page.locator('.layer-composition').first().evaluate((select) => {
    select.value = 'base';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => window.__editor.file.layers[1].composition), 'base');
  await page.keyboard.press('Control+Z');
  assert.equal(await page.evaluate(() => window.__editor.file.layers[1].composition), 'overlay');
  await page.keyboard.press('Control+A');
  assert.deepEqual(await page.evaluate(() => {
    const { x, y, w, h } = window.__editor.selection;
    return { x, y, w, h };
  }), { x: 0, y: 0, w: 2, h: 1 });
  await page.keyboard.press('Control+D');
  assert.equal(await page.evaluate(() => window.__editor.selection), null);
  await page.click('#btnToolDraw');
  const gridBox = await page.locator('#grid').boundingBox();
  assert.ok(gridBox);
  await page.mouse.move(gridBox.x + 2, gridBox.y + 2);
  await page.mouse.down({ button: 'right' });
  assert.equal(await page.evaluate(() => window.__editor.file.layers[0].tracks.idle[0][0]), '..');
  await page.keyboard.press('Control+Z');
  await page.mouse.up({ button: 'right' });
  assert.equal(
    await page.evaluate(() => window.__editor.file.layers[0].tracks.idle[0][0]),
    'A.',
    'undo during a live stroke must commit then undo exactly that gesture',
  );
  await page.click('#btnDupFrame');
  let state = await page.evaluate(() => ({
    file: structuredClone(window.__editor.file),
    frameIdx: window.__editor.frameIdx,
  }));
  assert.equal(state.file.anims.idle.frameCount, 3);
  assert.equal(state.file.layers[0].tracks.idle.length, 3);
  assert.equal(state.file.layers[1].tracks.idle.length, 3);
  assert.equal(state.file.anchors.grip.idle.length, 3);
  assert.equal(state.file.anchors.grip.air.length, 3);
  assert.equal(state.frameIdx, 1);

  await page.click('#btnFrameRight');
  state = await page.evaluate(() => ({
    file: structuredClone(window.__editor.file),
    frameIdx: window.__editor.frameIdx,
  }));
  assert.equal(state.frameIdx, 2);
  assert.deepEqual(state.file.anchors.grip.idle.map((point) => point.x), [0, 1, 0]);

  await page.click('#btnDelFrame');
  state = await page.evaluate(() => ({
    file: structuredClone(window.__editor.file),
    frameIdx: window.__editor.frameIdx,
  }));
  assert.equal(state.file.anims.idle.frameCount, 2);
  assert.equal(state.file.layers[0].tracks.idle.length, 2);
  assert.equal(state.file.anchors.grip.idle.length, 2);
  assert.equal(state.frameIdx, 1);

  await page.evaluate(() => window.__editor.setPixels({
    anim: 'idle', frame: 0, layerId: 'base', pixels: [{ x: 0, y: 0, char: 'B' }],
  }));
  assert.equal(await page.evaluate(() => window.__editor.file.layers[0].tracks.idle[0][0]), 'B.');
  await page.keyboard.press('Control+Z');
  assert.equal(await page.evaluate(() => window.__editor.file.layers[0].tracks.idle[0][0]), 'A.');

  const beforeInvalidReplace = await page.evaluate(() => JSON.stringify(window.__editor.file));
  const invalidError = await page.evaluate((file) => {
    file.layers[1].tracks.idle.pop();
    try {
      window.__editor.replace(file, null);
      return '';
    } catch (error) {
      return String(error);
    }
  }, fixture());
  assert.match(invalidError, /expected 2 frames/);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__editor.file)), beforeInvalidReplace);

  await page.evaluate((file) => window.__editor.replace(file, 'first.json'), fixture());
  await page.evaluate(() => window.__editor.setPixels({
    anim: 'idle', frame: 0, layerId: 'base', pixels: [{ x: 0, y: 0, char: 'B' }],
  }));
  assert.equal(await page.locator('#btnUndo').isDisabled(), false);
  await page.evaluate((file) => window.__editor.replace(file, 'second.json'), fixture());
  assert.equal(await page.locator('#btnUndo').isDisabled(), true, 'history must not cross sprite paths');

  // Run alias materialization last: the bridge may asynchronously echo an
  // earlier document revision, and no later smoke assertion should depend on
  // this deliberately transient undo state.
  await page.evaluate((file) => window.__editor.replace(file, null), fixture());
  await page.locator('#anims button').filter({ hasText: 'air' }).click();
  assert.equal(await page.locator('#btnMaterializeAnim').isEnabled(), true);
  assert.match((await page.locator('#btnMaterializeAnim').getAttribute('title')) ?? '', /independent from "idle"/);
  await page.click('#btnMaterializeAnim');
  assert.deepEqual(await page.evaluate(() => ({
    animation: window.__editor.animName,
    air: structuredClone(window.__editor.file.anims.air),
    baseAir: structuredClone(window.__editor.file.layers[0].tracks.air),
    baseIdle: structuredClone(window.__editor.file.layers[0].tracks.idle),
    anchor: structuredClone(window.__editor.file.anchors.grip.air),
  })), {
    animation: 'air',
    air: { fps: 4, frameCount: 2 },
    baseAir: [['A.'], ['.A']],
    baseIdle: [['A.'], ['.A']],
    anchor: [{ x: 10, y: 0 }, { x: 11, y: 0 }],
  });
  assert.equal(await page.locator('#btnMaterializeAnim').isDisabled(), true);
  await page.keyboard.press('Control+Z');
  assert.equal(await page.evaluate(() => window.__editor.file.anims.air), 'idle');

  // Agent commands use the same revisioned live document as the canvas. A
  // semantic command must update pixels atomically, focus its target frame and
  // layer, and publish a preview for the accepted revision without browser
  // coordinate automation.
  await page.evaluate((file) => window.__editor.replace(file, null), fixture());
  await page.waitForFunction(() => window.__editor.bridge.connected && window.__editor.bridge.revision > 0);
  await page.waitForTimeout(250);
  const agentResult = await page.evaluate(async () => {
    const current = await fetch('/__sprite-editor/state').then((response) => response.json());
    const response = await fetch('/__sprite-editor/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: current.revision,
        source: 'sprite-editor-smoke-agent',
        commands: [
          {
            op: 'pixel.set',
            target: { animation: 'idle', frame: 1, layerId: 'hand' },
            pixels: [{ x: 1, y: 0, color: '#ffffff' }],
          },
          {
            op: 'assert.frame',
            target: { animation: 'idle', frame: 1, layerId: 'hand' },
            expected: { pixelCount: 2, bounds: { x: 0, y: 0, w: 2, h: 1 } },
          },
        ],
        inspect: [{ animation: 'idle', frame: 1, layerId: 'hand', components: true }],
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(agentResult.status, 200, JSON.stringify(agentResult.body));
  assert.equal(agentResult.body.inspection.frames[0].pixelCount, 2);
  await page.waitForFunction(() => (
    window.__editor.frameIdx === 1
    && window.__editor.file.layers[1].tracks.idle[1][0][1] === 'A'
  ));
  assert.equal(await page.evaluate(() => window.__editor.animName), 'idle');
  assert.equal(await page.evaluate(() => window.__editor.activeLayerId), 'hand');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(async () => (await fetch('/__sprite-editor/preview.png')).status), 200);

  const protocolChecks = await page.evaluate(async () => {
    const capabilities = await fetch('/__sprite-editor/capabilities').then((response) => response.json());
    const before = await fetch('/__sprite-editor/state').then((response) => response.json());
    const noOpResponse = await fetch('/__sprite-editor/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocolVersion: capabilities.protocolVersion,
        baseRevision: before.revision,
        commands: [{
          op: 'assert.frame',
          target: { animation: 'idle', frame: 1, layerId: 'hand' },
          expected: { pixelCount: 2 },
        }],
      }),
    });
    const noOp = await noOpResponse.json();
    const after = await fetch('/__sprite-editor/state').then((response) => response.json());
    return {
      capabilities,
      beforeRevision: before.revision,
      noOpStatus: noOpResponse.status,
      noOp,
      afterRevision: after.revision,
    };
  });
  assert.equal(protocolChecks.capabilities.protocolVersion, 1);
  assert.equal(protocolChecks.capabilities.transaction.atomic, true);
  assert.ok(protocolChecks.capabilities.operations.includes('frame.copy'));
  assert.equal(protocolChecks.noOpStatus, 200);
  assert.equal(protocolChecks.noOp.changed, false);
  assert.equal(protocolChecks.noOp.state.file, undefined, 'command responses are compact by default');
  assert.equal(protocolChecks.afterRevision, protocolChecks.beforeRevision, 'assertion-only batches do not advance revisions');
  assert.equal(await page.evaluate(async () => (await fetch('/__sprite-editor/preview.png')).status), 200);

  // Exercise the same protocol on the real 160x128 rusty-sword document and
  // displayed frames 3-5. Publish only to this temporary bridge, wait for the
  // browser to render the semantic cursor, then reopen the repository copy;
  // this proves the live path without writing art to disk.
  const realOpen = await page.evaluate(() => window.__editor.open('equipment/rusty-sword.json'));
  assert.equal(realOpen, true);
  await page.waitForFunction(() => {
    const frame = window.__editor.file.layers?.[0]?.tracks?.attack?.[0];
    return frame?.length === 128 && frame[0]?.length === 160;
  });
  const realAgentResult = await page.evaluate(async (transaction) => {
    const before = await fetch('/__sprite-editor/state').then((response) => response.json());
    const dryRunResponse = await fetch('/__sprite-editor/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...transaction, baseRevision: before.revision, source: 'sprite-editor-production-smoke' }),
    });
    const dryRun = await dryRunResponse.json();
    const afterDryRun = await fetch('/__sprite-editor/state').then((response) => response.json());
    const applyResponse = await fetch('/__sprite-editor/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...transaction,
        dryRun: false,
        baseRevision: afterDryRun.revision,
        source: 'sprite-editor-production-smoke',
      }),
    });
    return {
      beforeRevision: before.revision,
      dryRunStatus: dryRunResponse.status,
      dryRun,
      afterDryRunRevision: afterDryRun.revision,
      applyStatus: applyResponse.status,
      applied: await applyResponse.json(),
    };
  }, productionTransaction);
  assert.equal(realAgentResult.dryRunStatus, 200, JSON.stringify(realAgentResult.dryRun));
  assert.equal(realAgentResult.afterDryRunRevision, realAgentResult.beforeRevision);
  assert.deepEqual(realAgentResult.dryRun.inspection.frames.slice(0, 3).map((frame) => frame.pixelCount), [272, 272, 174]);
  assert.equal(realAgentResult.applyStatus, 200, JSON.stringify(realAgentResult.applied));
  assert.equal(realAgentResult.applied.state.revision, realAgentResult.beforeRevision + 1);
  await page.waitForFunction(() => (
    window.__editor.frameIdx === 4
    && window.__editor.activeLayerId === 'base'
    && window.__editor.file.layers[0].tracks.attack[4][14][28] !== '.'
  ));
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(async () => (await fetch('/__sprite-editor/preview.png')).status), 200);
  const cleanup = await page.evaluate(async () => {
    const response = await fetch('/__sprite-editor/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'equipment/rusty-sword.json', source: 'sprite-editor-production-smoke-cleanup', force: true }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(cleanup.status, 200, JSON.stringify(cleanup.body));
  assert.equal(cleanup.body.dirty, false);

  assert.deepEqual(errors, []);
  console.log('sprite-editor UI smoke tests: ok');
} finally {
  await browser.close();
}
