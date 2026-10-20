import { clamp } from '@engine/index';

export const TRANSITION_TIME = 0.6;
export const DOOR_OPEN_TIME = 0.35;
const WALK_IN_MAX = 8;

export interface DoorOpening {
  left: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Transition {
  t: number;
  roomId: string;
  x: number;
  y: number;
  open?: DoorOpening;
  walk?: { out: -1 | 1; into: -1 | 1 };
  walked: number;
  /** Continue the source floor past its boundary only for grounded crossings. */
  thresholdY?: number;
}

interface TransitionEffects {
  /** Move using live collision; return actual horizontal distance travelled. */
  walk(direction: -1 | 1, dt: number): number;
  /** Resolve the current arrival geometry and swap the world at black. */
  swap(): void;
  stop(): void;
}

/** Sequences a crossing without owning the scene, actor, collision, or renderer. */
export function advanceTransition(tr: Transition, dt: number, effects: TransitionEffects): boolean {
  if (tr.open && tr.open.left > 0) {
    tr.open.left -= dt;
    return false;
  }
  const half = TRANSITION_TIME / 2;
  const before = tr.t;
  const after = Math.min(TRANSITION_TIME, before + dt);
  const outDt = Math.max(0, Math.min(after, half) - Math.min(before, half));
  if (tr.walk) effects.walk(tr.walk.out, outDt);
  tr.t = after;
  if (before < half && after >= half) effects.swap();
  const inDt = Math.max(0, after - half) - Math.max(0, before - half);
  if (tr.walk) {
    if (tr.walked < WALK_IN_MAX) tr.walked += effects.walk(tr.walk.into, inDt);
    if (tr.walked >= WALK_IN_MAX) effects.stop();
  }
  const complete = tr.t >= TRANSITION_TIME;
  if (complete && tr.walk) effects.stop();
  return complete;
}

export function transitionOpacity(tr: Transition): number {
  const half = TRANSITION_TIME / 2;
  return clamp(tr.t < half ? tr.t / half : (TRANSITION_TIME - tr.t) / half, 0, 1);
}
