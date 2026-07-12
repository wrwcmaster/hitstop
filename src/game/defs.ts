import { Game } from '@engine/index';

/** The game's input actions and default bindings. */
export type Action = 'left' | 'right' | 'jump' | 'attack' | 'dash';

export const KEYMAP: Record<string, Action> = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'jump', ArrowUp: 'jump', KeyW: 'jump',
  KeyZ: 'attack', KeyJ: 'attack',
  KeyX: 'dash', KeyK: 'dash', ShiftLeft: 'dash',
};

/** Game-level events (combat events come from the engine). */
export interface GameEvents extends Record<string, unknown> {
  playerHurt: { hp: number };
  playerDied: Record<string, never>;
  waveStart: { wave: number };
  waveClear: { wave: number };
}

export type ActionGame = Game<Action, GameEvents>;

export const VIEW_W = 480;
export const VIEW_H = 270;
