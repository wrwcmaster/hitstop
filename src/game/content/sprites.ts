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
