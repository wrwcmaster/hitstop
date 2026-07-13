/**
 * Built-in 3x5 pixel font. Zero assets, crisp at 1x, good enough for HUD,
 * damage numbers and debug text. Real games can layer a nicer bitmap font
 * on top later; the API (drawText/textWidth) is the stable part.
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
  const text = String(str).toUpperCase();
  if (align === 'center') x -= textWidth(text, s) / 2;
  if (align === 'right') x -= textWidth(text, s);
  x = Math.round(x);
  y = Math.round(y);
  g.fillStyle = color;
  for (const ch of text) {
    const gl = GLYPHS[ch];
    if (gl) {
      for (let i = 0; i < 15; i++) {
        if (gl[i] === '1') g.fillRect(x + (i % 3) * s, y + Math.floor(i / 3) * s, s, s);
      }
    }
    x += 4 * s;
  }
}
