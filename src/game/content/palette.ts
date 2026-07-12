import { Palette } from '@engine/index';

/**
 * Shared color palette (based on Sweetie-16-ish tones from the POC).
 * Named exports for use in code; the char->color map for sprite art.
 */
export const COLORS = {
  bgDark: '#07070d',
  outline: '#171a2b',
  steel: '#94b0c2',
  steelDark: '#566c86',
  plume: '#b13e53',
  white: '#f4f4f4',
  gold: '#ffcd75',
  blue: '#3b5dc9',
  green: '#38b764',
  greenDark: '#257953',
  greenLight: '#a7f070',
  purple: '#5d275d',
  purpleLight: '#7f2e7f',
  red: '#b13e53',
  redDark: '#73172d',
  navy: '#29366f',
  navyDark: '#1f2a57',
  navyLight: '#33447f',
} as const;

export const PAL: Palette = {
  '.': null,
  O: COLORS.outline,
  S: COLORS.steel,
  D: COLORS.steelDark,
  P: COLORS.plume,
  W: COLORS.white,
  Y: COLORS.gold,
  B: COLORS.blue,
  G: COLORS.green,
  g: COLORS.greenDark,
  V: COLORS.purple,
  v: COLORS.purpleLight,
  R: COLORS.red,
  r: COLORS.redDark,
  E: COLORS.navy,
};
