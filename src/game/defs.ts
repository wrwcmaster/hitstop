import { Game } from '@engine/index';

/** The game's input actions and default bindings. */
export type Action =
  | 'left' | 'right' | 'up' | 'down'
  | 'jump' | 'attack' | 'dash' | 'skill' | 'skill2'
  | 'interact'
  | 'confirm' | 'cancel' | 'menu';

/** A key may serve several actions (ArrowUp jumps in-game, navigates in menus). */
export const KEYMAP: Record<string, Action | Action[]> = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: ['jump', 'up'], KeyW: ['jump', 'up'],
  ArrowDown: 'down', KeyS: 'down',
  Space: 'jump',
  KeyZ: ['attack', 'confirm'], KeyJ: ['attack', 'confirm'], Enter: 'confirm',
  KeyX: ['dash', 'cancel'], KeyK: ['dash', 'cancel'], ShiftLeft: 'dash',
  KeyC: 'skill', KeyL: 'skill',
  KeyV: 'skill2',
  KeyE: 'interact', KeyF: 'interact',
  Escape: 'menu',
};

/** Game-level events (combat events come from the engine). */
export interface GameEvents extends Record<string, unknown> {
  playerHurt: { hp: number };
  playerDied: Record<string, never>;
  waveStart: { wave: number };
  waveClear: { wave: number };
  /** Something awarded points (coins, kills add via PlayScene itself). */
  score: { points: number; x: number; y: number };
  /** An item entered the player's hands (or applied instantly). */
  pickup: { id: string };
  /** A level trigger region fired. */
  trigger: { event: string; props?: Record<string, unknown> };
  /** A Devourer got you. */
  playerSwallowed: Record<string, never>;
  /** A shop transaction happened. */
  purchase: { id: string; price: number };
  /** Ding. */
  levelUp: { level: number };
}

export type ActionGame = Game<Action, GameEvents>;

export const VIEW_W = 480;
export const VIEW_H = 270;
