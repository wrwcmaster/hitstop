import { epx } from './sprite';
import { offscreen } from './canvas';

/**
 * Built-in pixel font — mixed case.
 *
 * Uppercase, digits and symbols are authored on the classic 3×5 grid
 * and RENDERED as 6×10 bitmaps at half-logical scale — each glyph pixel
 * is 2×2 device pixels on the 4× canvas instead of 4×4, so text is
 * twice as sharp while every metric (textWidth, advance, line height)
 * is unchanged. The 6×10 bitmaps come from EPX (Scale2x) smoothing of
 * the 3×5 masters, with hand-tuned overrides where the algorithm's
 * rounding hurts a letterform.
 *
 * Lowercase is hand-authored directly on the finer grid in a 6×12 cell:
 * cap-height rows 0–8, x-height rows 3–8, descenders in rows 9–11
 * (one logical pixel below the uppercase baseline). Nothing is
 * force-uppercased anymore — strings render in the case they're written.
 *
 * Rendering bakes each (glyph, color) pair to a tiny offscreen canvas
 * once, so drawing is one drawImage per character.
 */
const GLYPHS: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101011', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  '0': '010101101101010', '1': '010110010010111', '2': '110001010100111', '3': '111001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100110101010', '7': '111001010010010',
  '8': '010101010101010', '9': '010101011001110',
  '-': '000000111000000', '.': '000000000000010', '!': '010010010000010', ':': '000010000010000',
  '/': '001001010100100', ' ': '000000000000000', '+': '000010111010000', '%': '101001010100101',
  '?': '111001011000010', ',': '000000000010100', "'": '010010000000000',
};

/**
 * Hand-tuned 6×10 bitmaps ('#' = pixel) for glyphs where pure EPX
 * rounding reads poorly at this size.
 */
const HD_OVERRIDES: Record<string, string[]> = {
  S: [
    '.####.',
    '##..##',
    '##....',
    '.##...',
    '..##..',
    '...##.',
    '....##',
    '##..##',
    '.####.',
    '......',
  ],
  '8': [
    '.####.',
    '##..##',
    '##..##',
    '.####.',
    '.####.',
    '##..##',
    '##..##',
    '##..##',
    '.####.',
    '......',
  ],
  '%': [
    '##...#',
    '##..##',
    '...##.',
    '...##.',
    '..##..',
    '.##...',
    '.##...',
    '##..##',
    '#...##',
    '......',
  ],
  '?': [
    '.####.',
    '##..##',
    '....##',
    '...##.',
    '..##..',
    '..##..',
    '......',
    '..##..',
    '..##..',
    '......',
  ],
};

/** Pad a lowercase glyph down to its row offset inside the 6×12 cell. */
function lc(top: number, rows: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < top; i++) out.push('......');
  return out.concat(rows);
}

/**
 * Hand-authored lowercase, 6 wide in a 12-row cell. x-height spans
 * rows 3–8, ascenders (b d f h k l, and t a step lower) reach the cap
 * line, descenders (g j p q y) drop into rows 9–11.
 */
const LOWERCASE: Record<string, string[]> = {
  a: lc(3, ['.####.', '....##', '.#####', '##..##', '##..##', '.#####']),
  b: lc(0, ['##....', '##....', '##....', '#####.', '##..##', '##..##', '##..##', '##..##', '#####.']),
  c: lc(3, ['.####.', '##..##', '##....', '##....', '##..##', '.####.']),
  d: lc(0, ['....##', '....##', '....##', '.#####', '##..##', '##..##', '##..##', '##..##', '.#####']),
  e: lc(3, ['.####.', '##..##', '######', '##....', '##..##', '.####.']),
  f: lc(0, ['..###.', '.##...', '.##...', '####..', '.##...', '.##...', '.##...', '.##...', '.##...']),
  g: lc(3, ['.#####', '##..##', '##..##', '##..##', '##..##', '.#####', '....##', '.####.']),
  h: lc(0, ['##....', '##....', '##....', '#####.', '##..##', '##..##', '##..##', '##..##', '##..##']),
  i: lc(0, ['..##..', '..##..', '......', '.###..', '..##..', '..##..', '..##..', '..##..', '.####.']),
  j: lc(0, ['...##.', '...##.', '......', '..###.', '...##.', '...##.', '...##.', '...##.', '...##.', '...##.', '####..']),
  k: lc(0, ['##....', '##....', '##....', '##..##', '##.##.', '####..', '##.##.', '##..##', '##..##']),
  l: lc(0, ['.##...', '.##...', '.##...', '.##...', '.##...', '.##...', '.##...', '.##...', '..###.']),
  m: lc(3, ['######', '##.#.#', '##.#.#', '##.#.#', '##.#.#', '##.#.#']),
  n: lc(3, ['#####.', '##..##', '##..##', '##..##', '##..##', '##..##']),
  o: lc(3, ['.####.', '##..##', '##..##', '##..##', '##..##', '.####.']),
  p: lc(3, ['#####.', '##..##', '##..##', '##..##', '##..##', '#####.', '##....', '##....']),
  q: lc(3, ['.#####', '##..##', '##..##', '##..##', '##..##', '.#####', '....##', '....##']),
  r: lc(3, ['#####.', '##..##', '##....', '##....', '##....', '##....']),
  s: lc(3, ['.####.', '##....', '.####.', '....##', '....##', '#####.']),
  t: lc(1, ['.##...', '.##...', '####..', '.##...', '.##...', '.##...', '.##...', '..###.']),
  u: lc(3, ['##..##', '##..##', '##..##', '##..##', '##..##', '.#####']),
  v: lc(3, ['##..##', '##..##', '##..##', '##..##', '.####.', '..##..']),
  w: lc(3, ['#.#.##', '#.#.##', '#.#.##', '#.#.##', '#.#.##', '######']),
  x: lc(3, ['##..##', '.####.', '..##..', '..##..', '.####.', '##..##']),
  y: lc(3, ['##..##', '##..##', '##..##', '##..##', '##..##', '.#####', '....##', '.####.']),
  z: lc(3, ['######', '...##.', '..##..', '.##...', '##....', '######']),
};

/**
 * Resolve a glyph to '#'-rows on the fine grid: lowercase from the
 * hand-authored set, everything else from overrides or EPX-smoothed
 * 3×5 masters. Unknown lowercase falls back to its uppercase form.
 */
function buildHd(ch: string): string[] | undefined {
  const lower = LOWERCASE[ch];
  if (lower) return lower;
  const override = HD_OVERRIDES[ch];
  if (override) return override;
  const bits = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()];
  if (!bits) return undefined;
  const rows: string[] = [];
  for (let r = 0; r < 5; r++) {
    let row = '';
    for (let c = 0; c < 3; c++) row += bits[r * 3 + c] === '1' ? '#' : '.';
    rows.push(row);
  }
  return epx(rows);
}

const hdCache = new Map<string, string[] | undefined>();

function hdGlyph(ch: string): string[] | undefined {
  if (!hdCache.has(ch)) hdCache.set(ch, buildHd(ch));
  return hdCache.get(ch);
}

/** Baked (glyph, color) canvases: rendering is one drawImage per char. */
const baked = new Map<string, HTMLCanvasElement>();

function glyphCanvas(ch: string, color: string): HTMLCanvasElement | undefined {
  const key = `${ch}:${color}`;
  const hit = baked.get(key);
  if (hit) return hit;
  const rows = hdGlyph(ch);
  if (!rows) return undefined;
  const [c, g] = offscreen(6, 12);
  g.fillStyle = color;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') g.fillRect(x, y, 1, 1);
    }
  });
  baked.set(key, c);
  return c;
}

export type TextAlign = 'left' | 'center' | 'right';

export function textWidth(str: string, scale = 1): number {
  return str.length * 4 * scale - scale;
}

export function drawText(
  g: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
  align: TextAlign = 'left',
): void {
  const s = scale;
  const text = String(str);
  if (align === 'center') x -= textWidth(text, s) / 2;
  if (align === 'right') x -= textWidth(text, s);
  // Glyph pixels are half-logical: keep positions on that grid.
  x = Math.round(x * 2) / 2;
  y = Math.round(y * 2) / 2;
  for (const ch of text) {
    const img = glyphCanvas(ch, color);
    // The 12-row cell adds one logical pixel of descender room below
    // the 5px cap box; metrics and line layout are unchanged.
    if (img) g.drawImage(img, x, y, 3 * s, 6 * s);
    x += 4 * s;
  }
}
