import { resolveAnim, resolveSpriteGeometry, type Palette, type SpriteFile } from '@engine/index';

export type SpriteDocument = SpriteFile & { palette: Palette; hd: boolean };

export function emptyFrame(w: number, h: number): string[] {
  return Array.from({ length: h }, () => '.'.repeat(w));
}

export function gridSize(rows: string[]): { w: number; h: number } {
  return { w: Math.max(1, ...rows.map(row => row.length)), h: Math.max(1, rows.length) };
}

export function geometryOf(file: SpriteFile, rows: string[]) {
  const grid = gridSize(rows);
  const density = file.hd === false ? 4 : 1;
  return resolveSpriteGeometry(file, grid.w / density, grid.h / density);
}

/** Current SpriteFile format only. Validate every animation before replacing editor state. */
export function parseSpriteDocument(raw: unknown, basePalette: Palette): SpriteDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('sprite: expected an object');
  const file = raw as SpriteFile;
  if (!file.anims || typeof file.anims !== 'object' || Array.isArray(file.anims) || !Object.keys(file.anims).length) {
    throw new Error('sprite: expected named animations');
  }
  if (file.hd !== undefined && typeof file.hd !== 'boolean') throw new Error('sprite: hd must be boolean');
  if (file.palette !== undefined && (!file.palette || typeof file.palette !== 'object' || Array.isArray(file.palette))) {
    throw new Error('sprite: palette must be an object');
  }
  for (const [ch, color] of Object.entries(file.palette ?? {})) {
    if (ch.length !== 1 || (color !== null && typeof color !== 'string')) throw new Error('sprite: invalid palette entry');
  }
  const document = structuredClone({ ...file, hd: file.hd ?? true, palette: { ...basePalette, ...file.palette } });
  for (const name of Object.keys(document.anims)) {
    const anim = resolveAnim(document, name);
    if (!anim || !Number.isFinite(anim.fps) || anim.fps <= 0 || !Array.isArray(anim.frames) || !anim.frames.length) {
      throw new Error(`sprite: ${name} requires positive fps and nonempty frames`);
    }
    for (const rows of anim.frames) {
      if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'string' || !rows[0].length
        || rows.some(row => typeof row !== 'string' || row.length !== rows[0].length)) {
        throw new Error(`sprite: ${name} requires rectangular nonempty frames`);
      }
      geometryOf(document, rows);
    }
  }
  return document;
}
