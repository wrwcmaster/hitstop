import { sprite, epx, withFacing, type AnimSet } from '@engine/index';
import { PAL } from './palette';

/**
 * All pixel art, authored as 1x text grids (see docs/adding-content.md,
 * or paint in tools/sprite-editor.html), then EPX-upscaled TWICE to 4x
 * texel density — iterated Scale2x rounds silhouettes progressively —
 * and blitted at quarter size onto the zoomed canvas: same on-screen
 * size, 4x the detail.
 */
export const TEXEL = 4;

/** Draw a TEXEL-density sprite at its logical (world) size, quantized to
 * the art's texel grid so motion steps are texel-fine, not world-pixel. */
export function blit(g: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number): void {
  const q = (v: number) => Math.round(v * TEXEL) / TEXEL;
  g.drawImage(img, q(x), q(y), img.width / TEXEL, img.height / TEXEL);
}

const hd = (rows: string[]) => sprite(epx(epx(rows)), PAL);

const KNIGHT_IDLE = hd([
  '....PP......',
  '...OPPO.....',
  '..OSSSSO....',
  '..OSWWSO....',
  '..OSSSSO....',
  '...OOOO.....',
  '..ODSSDO....',
  '.OYDSSDYO...',
  '.O.DSSD.O...',
  '...DSSD.....',
  '...ODDO.....',
  '...OBBO.....',
  '...OB.BO....',
  '...DD.DD....',
]);

const KNIGHT_RUN1 = hd([
  '....PP......',
  '...OPPO.....',
  '..OSSSSO....',
  '..OSWWSO....',
  '..OSSSSO....',
  '...OOOO.....',
  '..ODSSDO....',
  '.OYDSSDYO...',
  '.O.DSSD.O...',
  '...DSSD.....',
  '...ODDO.....',
  '..OB..BO....',
  '.OB....BO...',
  '.DD....DD...',
]);

const KNIGHT_RUN2 = hd([
  '....PP......',
  '...OPPO.....',
  '..OSSSSO....',
  '..OSWWSO....',
  '..OSSSSO....',
  '...OOOO.....',
  '..ODSSDO....',
  '.OYDSSDYO...',
  '.O.DSSD.O...',
  '...DSSD.....',
  '...ODDO.....',
  '...OBBO.....',
  '...OBBO.....',
  '...DDDD....',
]);

export const KNIGHT_ANIMS = withFacing({
  idle: { frames: [KNIGHT_IDLE, KNIGHT_RUN2], fps: 2 },
  run: { frames: [KNIGHT_RUN1, KNIGHT_RUN2], fps: 10 },
  air: { frames: [KNIGHT_RUN1], fps: 1 },
} satisfies AnimSet);

export const KNIGHT_IDLE_SPRITE = KNIGHT_IDLE;

export const SLIME1 = hd([
  '...GGGGGG...',
  '..GGGGGGGG..',
  '.GGWGGGGWGG.',
  '.GGOGGGGOGG.',
  'GGGGGGGGGGGG',
  'gGGGGGGGGGGg',
  '.gggggggggg.',
]);

export const SLIME2 = hd([
  '............',
  '..GGGGGGGG..',
  '.GGWGGGGWGG.',
  'GGGOGGGGOGGG',
  'GGGGGGGGGGGG',
  'gGgggggggGgg',
  '.gggggggggg.',
]);

export const BAT1 = hd([
  'V..........V',
  'VV...VV...VV',
  '.VVVvVVvVVV.',
  '..VvWVVWvV..',
  '...VVVVVV...',
  '....V..V....',
]);

export const BAT2 = hd([
  '............',
  '....vVVv....',
  '.VVVvVVvVVV.',
  'VVVvWVVWvVVV',
  'V..VVVVVV..V',
  '....V..V....',
]);

export const HEART = hd([
  '.RR.RR.',
  'RWRRRRR',
  'RRRRRRR',
  '.RRRRR.',
  '..RRR..',
  '...R...',
]);

export const HEART_EMPTY = hd([
  '.EE.EE.',
  'EEEEEEE',
  'EEEEEEE',
  '.EEEEE.',
  '..EEE..',
  '...E...',
]);

export const MANA_PIP = hd([
  '..B..',
  '.BBB.',
  'BBWBB',
  '.BBB.',
  '..B..',
]);

export const MANA_PIP_EMPTY = hd([
  '..E..',
  '.EEE.',
  'EEEEE',
  '.EEE.',
  '..E..',
]);

/* ---------------- item icons ---------------- */

export const ICON_SWORD = hd([
  '......W.',
  '.....WS.',
  '....WS..',
  '...WS...',
  'O.WS....',
  '.OS.....',
  '.YO.....',
  'Y..O....',
]);

export const ICON_GREATSWORD = hd([
  '......WW',
  '.....WWS',
  '....WWS.',
  '...WWS..',
  'O.WWS...',
  '.OWS....',
  '.YO.....',
  'YY.OO...',
]);

export const ICON_POTION = hd([
  '..OO..',
  '..OO..',
  '.ORRO.',
  'ORRRRO',
  'ORWRRO',
  '.OOOO.',
]);

export const ICON_ORB = hd([
  '.BBB.',
  'BBWBB',
  'BWWBB',
  'BBBBB',
  '.BBB.',
]);

export const ICON_CHARM = hd([
  '.YYY.',
  'Y.O.Y',
  'Y.G.Y',
  'Y...Y',
  '.YYY.',
]);

export const ICON_COIN = hd([
  '.YYY.',
  'YYWYY',
  'YWYYY',
  'YYYYY',
  '.YYY.',
]);

export const ICON_HASTE = hd([
  '..OO..',
  '..OO..',
  '.OYYO.',
  'OYYWYO',
  'OYWYYO',
  '.OOOO.',
]);

/* ---------------- NPCs ---------------- */

export const MERCHANT = hd([
  '...VVVV....',
  '..VVVVVV...',
  '..VVvvVV...',
  '..Vv..vV...',
  '..V.WW.V...',
  '..VVVVVV...',
  '.VVDYYDVV..',
  '.VV.YY.VV..',
  'OV..YY..VO.',
  '.V.DDDD.V..',
  '.VVVVVVVV..',
  '..DD..DD...',
]);
