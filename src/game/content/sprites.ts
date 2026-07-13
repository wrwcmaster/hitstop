import { sprite, withFacing, type AnimSet } from '@engine/index';
import { PAL } from './palette';

/**
 * All pixel art, authored as text grids (see docs/adding-content.md, or
 * use tools/sprite-editor.html to paint these visually and export).
 */

const KNIGHT_IDLE = sprite([
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
], PAL);

const KNIGHT_RUN1 = sprite([
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
], PAL);

const KNIGHT_RUN2 = sprite([
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
], PAL);

export const KNIGHT_ANIMS = withFacing({
  idle: { frames: [KNIGHT_IDLE, KNIGHT_RUN2], fps: 2 },
  run: { frames: [KNIGHT_RUN1, KNIGHT_RUN2], fps: 10 },
  air: { frames: [KNIGHT_RUN1], fps: 1 },
} satisfies AnimSet);

export const KNIGHT_IDLE_SPRITE = KNIGHT_IDLE;

export const SLIME1 = sprite([
  '...GGGGGG...',
  '..GGGGGGGG..',
  '.GGWGGGGWGG.',
  '.GGOGGGGOGG.',
  'GGGGGGGGGGGG',
  'gGGGGGGGGGGg',
  '.gggggggggg.',
], PAL);

export const SLIME2 = sprite([
  '............',
  '..GGGGGGGG..',
  '.GGWGGGGWGG.',
  'GGGOGGGGOGGG',
  'GGGGGGGGGGGG',
  'gGgggggggGgg',
  '.gggggggggg.',
], PAL);

export const BAT1 = sprite([
  'V..........V',
  'VV...VV...VV',
  '.VVVvVVvVVV.',
  '..VvWVVWvV..',
  '...VVVVVV...',
  '....V..V....',
], PAL);

export const BAT2 = sprite([
  '............',
  '....vVVv....',
  '.VVVvVVvVVV.',
  'VVVvWVVWvVVV',
  'V..VVVVVV..V',
  '....V..V....',
], PAL);

export const HEART = sprite([
  '.RR.RR.',
  'RWRRRRR',
  'RRRRRRR',
  '.RRRRR.',
  '..RRR..',
  '...R...',
], PAL);

export const HEART_EMPTY = sprite([
  '.EE.EE.',
  'EEEEEEE',
  'EEEEEEE',
  '.EEEEE.',
  '..EEE..',
  '...E...',
], PAL);

export const MANA_PIP = sprite([
  '..B..',
  '.BBB.',
  'BBWBB',
  '.BBB.',
  '..B..',
], PAL);

export const MANA_PIP_EMPTY = sprite([
  '..E..',
  '.EEE.',
  'EEEEE',
  '.EEE.',
  '..E..',
], PAL);

/* ---------------- item icons ---------------- */

export const ICON_SWORD = sprite([
  '......W.',
  '.....WS.',
  '....WS..',
  '...WS...',
  'O.WS....',
  '.OS.....',
  '.YO.....',
  'Y..O....',
], PAL);

export const ICON_GREATSWORD = sprite([
  '......WW',
  '.....WWS',
  '....WWS.',
  '...WWS..',
  'O.WWS...',
  '.OWS....',
  '.YO.....',
  'YY.OO...',
], PAL);

export const ICON_POTION = sprite([
  '..OO..',
  '..OO..',
  '.ORRO.',
  'ORRRRO',
  'ORWRRO',
  '.OOOO.',
], PAL);

export const ICON_ORB = sprite([
  '.BBB.',
  'BBWBB',
  'BWWBB',
  'BBBBB',
  '.BBB.',
], PAL);

export const ICON_CHARM = sprite([
  '.YYY.',
  'Y.O.Y',
  'Y.G.Y',
  'Y...Y',
  '.YYY.',
], PAL);

export const ICON_COIN = sprite([
  '.YYY.',
  'YYWYY',
  'YWYYY',
  'YYYYY',
  '.YYY.',
], PAL);

export const ICON_HASTE = sprite([
  '..OO..',
  '..OO..',
  '.OYYO.',
  'OYYWYO',
  'OYWYYO',
  '.OOOO.',
], PAL);

/* ---------------- NPCs ---------------- */

export const MERCHANT = sprite([
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
], PAL);
