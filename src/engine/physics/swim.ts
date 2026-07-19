import { clamp } from '../math/util';
import { GRAVITY, type Body } from './body';

/**
 * Buoyant swimming physics — the mechanism, not the feel. A body in water
 * is pulled by buoyancy (offsetting gravity), can actively ascend or dive,
 * and is steadied by heavy drag and speed caps. Tuning (how floaty, how
 * fast) and flavour (breaching out, splashes, oxygen) stay with the game.
 *
 * `buoyancy` is a multiple of gravity applied per unit submersion: < 1
 * leaves a body slightly heavy (it sinks slowly on its own), > 1 floats it
 * to the surface. Assumes gravity has ALREADY been applied this step, so
 * buoyancy simply offsets it.
 */
export interface SwimParams {
  /** Upward pull as ×gravity per submersion (0..1). <1 sinks, >1 floats. */
  buoyancy: number;
  /** Upward acceleration while ascending (px/s²). */
  ascendAccel: number;
  /** Downward acceleration while diving (px/s²). */
  diveAccel: number;
  /** Per-second velocity-keep factors (heavy water damps momentum). */
  dragX: number;
  dragY: number;
  /** Rising speed cap while ascending (px/s). */
  maxRise: number;
  /** Gentle sink cap when neither ascending nor diving (px/s). */
  driftSink: number;
  /** Faster sink cap while diving (px/s). */
  maxSink: number;
  /** Horizontal speed cap in water (px/s). */
  maxSpeedX: number;
}

/** What the swimmer is asking for this step. */
export interface SwimIntent {
  ascend: boolean;
  dive: boolean;
}

/**
 * Integrate one step of swimming onto a body's velocity. Mutates `vx`/`vy`;
 * call `moveAndCollide` afterwards to actually move it.
 */
export function swim(b: Body, dt: number, submersion: number, intent: SwimIntent, p: SwimParams): void {
  b.vy -= GRAVITY * submersion * p.buoyancy * dt;
  if (intent.ascend) b.vy -= p.ascendAccel * dt;
  if (intent.dive) b.vy += p.diveAccel * dt;
  b.vy *= Math.pow(p.dragY, dt);
  b.vx *= Math.pow(p.dragX, dt);
  b.vx = clamp(b.vx, -p.maxSpeedX, p.maxSpeedX);
  const sinkCap = intent.dive ? p.maxSink : p.driftSink;
  b.vy = clamp(b.vy, -p.maxRise, sinkCap);
}
