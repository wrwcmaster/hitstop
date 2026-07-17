import { Game, type GamepadMapping, type GamepadInput } from '@engine/index';

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

/**
 * Standard-layout gamepad mapping (A=0 B=1 X=2 Y=3, LB/RB=4/5,
 * Select/Start=8/9, dpad=12-15, left stick axes 0/1). Menus, dialogue,
 * and the shop consume the same actions, so a pad drives everything.
 */
export const GAMEPAD: GamepadMapping<Action> = {
  buttons: {
    0: ['jump', 'confirm'],   // A
    1: ['dash', 'cancel'],    // B
    2: 'attack',              // X
    3: 'interact',            // Y
    4: 'skill',               // LB — fireball
    5: 'skill2',              // RB — nova
    6: 'skill',               // LT
    7: 'skill2',              // RT
    8: 'menu',                // Select
    9: 'menu',                // Start
    12: 'up',                 // dpad
    13: 'down',
    14: 'left',
    15: 'right',
  },
  axes: [
    { index: 0, neg: 'left', pos: 'right' },
    // Stick-up is menu-up only — accidental jumps from stick flicks feel bad.
    { index: 1, neg: 'up', pos: 'down' },
  ],
};

/** Actions the CONTROLS page lets players rebind, with menu aliases the
 * new key inherits (so a rebound jump still navigates menus up, etc). */
export const REBINDABLE: { action: Action; label: string; aliases: Action[] }[] = [
  { action: 'jump', label: 'JUMP', aliases: ['up'] },
  { action: 'attack', label: 'ATTACK', aliases: ['confirm'] },
  { action: 'dash', label: 'DASH', aliases: ['cancel'] },
  { action: 'skill', label: 'FIREBALL', aliases: [] },
  { action: 'skill2', label: 'NOVA', aliases: [] },
  { action: 'interact', label: 'INTERACT', aliases: [] },
  { action: 'left', label: 'MOVE LEFT', aliases: [] },
  { action: 'right', label: 'MOVE RIGHT', aliases: [] },
];

/** Human-readable key name for a KeyboardEvent.code. */
export function prettyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  const named: Record<string, string> = {
    Space: 'SPACE', ShiftLeft: 'LSHIFT', ShiftRight: 'RSHIFT',
    ControlLeft: 'LCTRL', ControlRight: 'RCTRL', AltLeft: 'LALT', AltRight: 'RALT',
    Enter: 'ENTER', Escape: 'ESC', Tab: 'TAB', Backspace: 'BKSP',
  };
  return named[code] ?? code.toUpperCase();
}

/** Human-readable name for a standard-layout gamepad button index. */
export function prettyButton(index: number): string {
  const named: Record<number, string> = {
    0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
    8: 'SELECT', 9: 'START', 10: 'L3', 11: 'R3',
    12: 'UP', 13: 'DOWN', 14: 'LEFT', 15: 'RIGHT', 16: 'HOME',
  };
  return named[index] ?? `B${index}`;
}

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

/** The game plus its polled gamepad (attached in main.ts, used by the
 * controls UI for button rebinding). */
export type ActionGame = Game<Action, GameEvents> & { pad?: GamepadInput<Action> };

/** Build version, injected from package.json at build time (see vite configs). */
declare const __APP_VERSION__: string;
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

/**
 * Coarse-pointer (touch) device. Menus scale their row spacing up with
 * `menuLine` so thumb-sized taps land — at 480 logical px across a phone
 * screen, a 13px row is only ~10 CSS px tall otherwise.
 */
export const COARSE_POINTER =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  !window.matchMedia('(pointer: fine)').matches;

/** Menu row height: the desktop baseline, opened up ~1.5x on touch. */
export const menuLine = (base: number): number => (COARSE_POINTER ? Math.round(base * 1.5) : base);

export const VIEW_W = 480;
export const VIEW_H = 270;
/** Device pixels per logical pixel: 1920×1080 backing store — native
 * 1080p, CSS-scaled 1:1 on full-HD screens and 2:1 on 4K. */
export const ZOOM = 4;
/**
 * World zoom: the camera renders the world this much larger (a 240×135
 * window), putting characters at Hollow Knight-ish scale (~10% of screen
 * height) while HUD/menus keep the full 480×270 screen space.
 */
export const WORLD_ZOOM = 2;
