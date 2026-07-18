import type { Action } from '../defs';

/**
 * The co-op wire protocol (host-authoritative). The host runs the only
 * real simulation; the guest streams held actions up and renders the
 * snapshots that come back. Everything is small JSON over one ordered
 * DataChannel — rooms hold tens of actors, so a 20 Hz snapshot is tiny.
 */

/** Gameplay actions a guest may drive remotely. Menu/interact stay local:
 * dialogue, shops, and pause live on the host's screen only. */
export const NET_ACTIONS: readonly Action[] = [
  'left', 'right', 'up', 'down', 'jump', 'attack', 'dash', 'skill', 'skill2', 'skill3',
];

/** Snapshots per second (every 3rd fixed step). */
export const SNAP_HZ = 20;

/** guest → host: the full set of currently-held actions. */
export interface InMsg {
  t: 'in';
  held: Action[];
}

/** A knight in a snapshot: enough to puppet a real Player's render. */
export interface KnightSnap {
  id: number;
  x: number;
  y: number;
  facing: number;
  /** FSM state name + time-in-state, so poses match. */
  state: string;
  st: number;
  animT: number;
  hp: number;
  maxHp: number;
}

export interface MobSnap {
  id: number;
  type: string;
  x: number;
  y: number;
  facing: number;
  animT: number;
  hp: number;
  maxHp: number;
}

export interface PickSnap {
  id: number;
  item: string;
  x: number;
  y: number;
}

/** Projectiles draw via game closures the guest can't rebuild, so they
 * cross the wire as plain rects and render as generic glow dots. */
export interface ShotSnap {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** host → guest: the world as of this instant. */
export interface SnapMsg {
  t: 'snap';
  room: string;
  /** The guest's own knight id (camera + HUD follow it). */
  you: number;
  knights: KnightSnap[];
  mobs: MobSnap[];
  picks: PickSnap[];
  shots: ShotSnap[];
  /** The guest knight's HUD numbers (host-authoritative). */
  hud: { hp: number; maxHp: number; mp: number; maxMp: number; gold: number; level: number; score: number };
  banner: string | null;
}

/** Either side: clean goodbye (the other returns to its title). */
export interface ByeMsg {
  t: 'bye';
}

export type NetMsg = InMsg | SnapMsg | ByeMsg;

export function parseMsg(raw: string): NetMsg | null {
  try {
    const m = JSON.parse(raw) as NetMsg;
    return m && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}
