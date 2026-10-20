#!/usr/bin/env node

/**
 * Headless CLI for the 3D-to-2D Toon/Pixel Sprite Baker & Self-Check Critic Loop.
 *
 * Commands:
 *   node tools/sprite-baker.mjs list
 *   node tools/sprite-baker.mjs bake <rig-id> [--out <file.json>] [--preview <file.png>] [--scale <n>] [--no-overlays] [--strict]
 *   node tools/sprite-baker.mjs critique <sprite.json>
 *   node tools/sprite-baker.mjs audit [--preview-dir <dir>]
 *   node tools/sprite-baker.mjs sheet <sprite.json> [--preview <file.png>] [--scale <n>] [--no-overlays]
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { createServer } from 'vite';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(chunk, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  chunk.writeUInt32BE(crc, 8 + data.length);
  return chunk;
}

export function encodeRgbaPng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
  }
  const compressed = deflateSync(raw);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

const [command = 'help', ...args] = process.argv.slice(2);

function flagValue(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
}

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const baker = await server.ssrLoadModule('/tools/src/sprite-baker.ts');
  const critic = await server.ssrLoadModule('/tools/src/sprite-critic.ts');
  const rigsModule = await server.ssrLoadModule('/tools/src/sprite-rigs.ts');
  const rigs = rigsModule.BUILTIN_SPRITE_RIGS;

  switch (command) {
    case 'list': {
      console.log(JSON.stringify(Object.keys(rigs), null, 2));
      break;
    }

    case 'bake': {
      const rigId = args.find((a) => !a.startsWith('--'));
      if (!rigId) {
        throw new Error('usage: node tools/sprite-baker.mjs bake <rig-id> [--out <file.json>] [--preview <file.png>] [--scale <n>] [--no-overlays] [--strict]');
      }
      const rig = rigs[rigId];
      if (!rig) {
        throw new Error(`unknown rig "${rigId}". Available: ${Object.keys(rigs).join(', ')}`);
      }

      const t0 = performance.now();
      const spriteFile = baker.bakeSpriteRig(rig);
      const report = critic.critiqueSpriteFile(spriteFile, rig.critic ?? {});
      const bakeMs = Math.round((performance.now() - t0) * 10) / 10;

      const outJson = flagValue('--out', null);
      if (outJson) {
        const outPath = path.resolve(outJson);
        writeFileSync(outPath, `${JSON.stringify(spriteFile, null, 2)}\n`, 'utf8');
      }

      const previewPng = flagValue('--preview', null);
      if (previewPng) {
        const scale = Number(flagValue('--scale', '3')) || 3;
        const showOverlays = !args.includes('--no-overlays');
        const sheet = baker.renderSpriteContactSheetRgba(spriteFile, { scale, showOverlays });
        writeFileSync(path.resolve(previewPng), encodeRgbaPng(sheet.width, sheet.height, sheet.rgba));
      }

      const refPath = flagValue('--ref', null);
      let parity = undefined;
      if (refPath) {
        const refFile = JSON.parse(readFileSync(path.resolve(refPath), 'utf8'));
        parity = critic.compareSpriteToReference(spriteFile, refFile);
      }

      console.log(JSON.stringify({
        rig: rig.name,
        w: spriteFile.w,
        h: spriteFile.h,
        hd: spriteFile.hd,
        paletteSize: Object.keys(spriteFile.palette ?? {}).length,
        animations: Object.fromEntries(
          Object.entries(spriteFile.anims).map(([k, v]) => [
            k,
            typeof v === 'string' ? `-> ${v}` : v.frames?.length ?? v.frameCount,
          ]),
        ),
        anchors: spriteFile.anchors ? Object.keys(spriteFile.anchors) : [],
        bakeMs,
        critic: {
          passed: report.passed,
          score: report.score,
          errorCount: report.errorCount,
          warnCount: report.warnCount,
          issues: report.issues,
        },
        ...(parity ? { parity } : {}),
        ...(outJson ? { outJson: path.resolve(outJson) } : {}),
        ...(previewPng ? { previewPng: path.resolve(previewPng) } : {}),
      }, null, 2));

      if (args.includes('--strict') && !report.passed) {
        process.exitCode = 1;
      }
      break;
    }

    case 'critique': {
      const jsonPath = args.find((a) => !a.startsWith('--'));
      if (!jsonPath) {
        throw new Error('usage: node tools/sprite-baker.mjs critique <sprite.json>');
      }
      const file = JSON.parse(readFileSync(path.resolve(jsonPath), 'utf8'));
      const report = critic.critiqueSpriteFile(file);
      console.log(JSON.stringify({
        path: jsonPath,
        passed: report.passed,
        score: report.score,
        errorCount: report.errorCount,
        warnCount: report.warnCount,
        dimensions: report.dimensions,
        paletteCount: report.paletteCount,
        nearDuplicateCount: report.nearDuplicateColors.length,
        issues: report.issues,
      }, null, 2));
      if (args.includes('--strict') && !report.passed) {
        process.exitCode = 1;
      }
      break;
    }

    case 'audit': {
      const previewDir = flagValue('--preview-dir', null);
      const writeGameSprites = args.includes('--write-game-sprites');
      if (previewDir) {
        mkdirSync(path.resolve(previewDir), { recursive: true });
      }
      const rigResults = [];
      for (const [id, rig] of Object.entries(rigs)) {
        const t0 = performance.now();
        const file = baker.bakeSpriteRig(rig);
        const report = critic.critiqueSpriteFile(file, rig.critic ?? {});
        const bakeMs = Math.round((performance.now() - t0) * 10) / 10;
        let previewPath = undefined;
        if (previewDir) {
          previewPath = path.resolve(previewDir, `${id}-sheet.png`);
          const sheet = baker.renderSpriteContactSheetRgba(file, { scale: 3, showOverlays: true });
          writeFileSync(previewPath, encodeRgbaPng(sheet.width, sheet.height, sheet.rgba));
        }
        let gameSpritePath = undefined;
        if (writeGameSprites && !id.endsWith('-poc')) {
          if (!report.passed) {
            throw new Error(`refusing to write game sprite for "${id}" because critic failed (score ${report.score})`);
          }
          gameSpritePath = path.resolve('src/game/content/sprites', `${id}.json`);
          writeFileSync(gameSpritePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
        }
        rigResults.push({
          rig: id,
          w: file.w,
          h: file.h,
          paletteSize: report.paletteCount,
          bakeMs,
          passed: report.passed,
          score: report.score,
          errorCount: report.errorCount,
          warnCount: report.warnCount,
          issues: report.issues,
          ...(previewPath ? { previewPath } : {}),
          ...(gameSpritePath ? { gameSpritePath } : {}),
        });
      }

      // Scan enemies.ts and boss.ts for fillRect placeholder draw() blocks
      const placeholderActors = [];
      for (const relFile of ['src/game/actors/enemies.ts', 'src/game/actors/boss.ts']) {
        const src = readFileSync(path.resolve(relFile), 'utf8');
        const regex = /defineMonster\('([^']+)',\s*\{[\s\S]*?\n\}\);/g;
        let match;
        while ((match = regex.exec(src)) !== null) {
          const id = match[1];
          const block = match[0];
          const usesFillRect = block.includes('g.fillRect(');
          const usesSprite =
            block.includes('blit(') ||
            block.includes('drawImage(') ||
            block.includes('Sprite');
          if (usesFillRect && !usesSprite) {
            placeholderActors.push({ id, source: relFile, hasRig: id in rigs });
          }
        }
      }

      console.log(JSON.stringify({
        rigs: rigResults,
        placeholderActorsInGame: placeholderActors,
      }, null, 2));
      break;
    }

    case 'sheet': {
      const jsonPath = args.find((a) => !a.startsWith('--'));
      const previewPng = flagValue('--preview', 'sprite-sheet.png');
      if (!jsonPath) {
        throw new Error('usage: node tools/sprite-baker.mjs sheet <sprite.json> [--preview <out.png>] [--scale <n>] [--no-overlays]');
      }
      const file = JSON.parse(readFileSync(path.resolve(jsonPath), 'utf8'));
      const scale = Number(flagValue('--scale', '3')) || 3;
      const showOverlays = !args.includes('--no-overlays');
      const sheet = baker.renderSpriteContactSheetRgba(file, { scale, showOverlays });
      const resolvedOut = path.resolve(previewPng);
      writeFileSync(resolvedOut, encodeRgbaPng(sheet.width, sheet.height, sheet.rgba));
      console.log(resolvedOut);
      break;
    }

    default:
      console.log(`hitstop 3D-to-2D sprite baker & self-check loop

usage:
  node tools/sprite-baker.mjs list
  node tools/sprite-baker.mjs bake <rig-id> [--out <sprite.json>] [--preview <sheet.png>] [--scale <n>] [--no-overlays] [--strict]
  node tools/sprite-baker.mjs critique <existing-sprite.json> [--strict]
  node tools/sprite-baker.mjs audit [--preview-dir <dir>]
  node tools/sprite-baker.mjs sheet <existing-sprite.json> [--preview <sheet.png>] [--scale <n>] [--no-overlays]`);
  }
} finally {
  await server.close();
}
