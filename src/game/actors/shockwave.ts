import {
  Entity,
  type Strike,
  type TileRef,
  type Tilemap,
} from '@engine/index';
import { COLORS } from '../content/palette';
import type { ActorHost } from '../defs';
import type { Player } from './player';

/** How the wave behaves. Tuned as one object so playtest has one place to go. */
export const SHOCKWAVE_TUNING = {
  /** World px the wave can travel from its origin tile. */
  range: 150,
  /** Travel speed in px/s. Fast enough to be a strike, slow enough to read. */
  speed: 260,
  damage: 34,
  /** Rows the wave may climb or drop within one column, so a stair carries it. */
  stepUp: 1,
  stepDown: 2,
  /** How long a crest stays drawn after the front has passed it. */
  trail: 0.22,
};

/**
 * Shockwave: one horizontal wave of force that runs away through the
 * ground the knight is standing on.
 *
 * The route is decided ONCE, at spawn, by `Tilemap.traceSurface` — the
 * engine's generic "follow a connected surface" query. That is what
 * makes the wave's behavior at gaps, steps, corners, and room bounds a
 * property of the level rather than a pile of special cases here: the
 * trace stops on its own at a gap it cannot step down into, a wall it
 * cannot climb, the edge of the map, or its distance limit.
 *
 * Two content rules ride on generic tile traits:
 *
 * - It travels only through `resonant` surfaces. Stone carries a wave;
 *   something that doesn't say it does will swallow one.
 * - What each tile it crosses DOES about it is the surface-reaction
 *   registry's business (see content/surface-reactions.ts), reached
 *   through an event so the wave never touches level geometry itself.
 *
 * Deliberately NOT a `Projectile`: a projectile flies through space and
 * dies on the first solid thing, which is the exact opposite of what
 * this does.
 */
export class Shockwave extends Entity {
  /** Tiles the wave will cross, in order, from the trace. */
  private path: TileRef[];
  /** How far along `path` the front has travelled, in px. */
  private travelled = 0;
  /** Index of the last tile whose arrival has been handled. */
  private reached = -1;
  private strike: Strike;
  /** Seconds since the front ran out of surface, for the wake's fade. */
  private fade = 0;

  constructor(
    private game: ActorHost,
    private tilemap: Tilemap,
    owner: Player,
    /** Where it runs: the knight's facing at the moment she struck. */
    dir: 1 | -1,
  ) {
    super();
    this.layer = 2;
    const T = SHOCKWAVE_TUNING;
    // Start from the tile under her feet — the surface she just hit.
    const start = tilemap.tileAtPoint(owner.cx, owner.y + owner.h + 1);
    this.path = start
      ? tilemap.traceSurface(start, dir, {
          maxDistance: T.range,
          stepUp: T.stepUp,
          stepDown: T.stepDown,
          // A wave runs through stone that rings, not through everything
          // solid. Water is not a surface it can use either — the trace
          // asks about the tile it would travel ON, and liquid isn't one.
          canTraverse: (tile) => tile.def.traits?.includes('resonant') === true,
        }).tiles
      : [];
    // One Strike for the whole wave: its hit set is what guarantees each
    // enemy is caught at most once no matter how many frames it overlaps.
    this.strike = this.game.combat.strike({
      attacker: owner,
      targets: 'enemy',
      damage: T.damage,
      strength: 0.8,
      knockback: 190,
      colors: [COLORS.gold, COLORS.white],
    });
    if (!this.path.length) this.dead = true;
  }

  update(dt: number): void {
    const T = SHOCKWAVE_TUNING;
    this.travelled += T.speed * dt;
    const ts = this.tilemap.tileSize;

    // Everything the front has newly reached, in order — so a fast wave
    // on a slow frame still touches every tile it passed rather than
    // skipping some, which would make its reach frame-rate dependent.
    const front = Math.min(this.path.length - 1, Math.floor(this.travelled / ts));
    for (let i = this.reached + 1; i <= front; i++) {
      const tile = this.path[i];
      // Bite anything standing on this tile. A body's worth of height
      // above the surface: this is a ground wave, not an area blast.
      this.strike.apply({ x: tile.rect.x, y: tile.rect.y - 20, w: tile.rect.w, h: 22 });
      // Ask the room what this surface does about it. The wave has no
      // opinion — see content/surface-reactions.ts.
      this.game.events.emit('surfaceWave', { tx: tile.tx, ty: tile.ty });
      this.game.feel.burst(tile.rect.x + tile.rect.w / 2, tile.rect.y, 2, {
        color: [COLORS.gold, COLORS.white], speed: 55, life: 0.3,
        angle: -Math.PI / 2, spread: 1.5, drag: 3, grav: 260,
      });
      this.reached = i;
    }

    // Spent: let the wake drain off the last tile instead of vanishing
    // mid-stride, then go.
    if (this.reached >= this.path.length - 1) {
      this.fade += dt;
      if (this.fade >= T.trail) this.dead = true;
    }
  }

  /**
   * The tile cells the crest currently occupies, front first, in world
   * pixels. This IS the wire format (see `WaveSnap`): a guest that gets
   * the drawn cells reproduces a wave that climbed a stair or followed a
   * dip without knowing the route, and it is a handful of numbers.
   */
  crestCells(): [number, number][] {
    const ts = this.tilemap.tileSize;
    const front = Math.min(this.path.length - 1, Math.floor(this.travelled / ts));
    const out: [number, number][] = [];
    for (let i = front; i >= Math.max(0, front - 3); i--) {
      out.push([Math.round(this.path[i].rect.x), Math.round(this.path[i].rect.y)]);
    }
    return out;
  }

  render(g: CanvasRenderingContext2D): void {
    drawCrest(g, this.crestCells(), this.tilemap.tileSize, 1 - this.fade / SHOCKWAVE_TUNING.trail);
  }
}

/**
 * Draw a wave crest from its cells. Shared by the live wave and by the
 * co-op guest's renderer, so a remote wave is the same picture rather
 * than an approximation of one.
 */
export function drawCrest(
  g: CanvasRenderingContext2D,
  cells: readonly (readonly [number, number])[],
  tileSize: number,
  spent = 1,
): void {
  for (let i = 0; i < cells.length; i++) {
    const [x, y] = cells[i];
    const age = i / 4;
    const h = Math.round(10 * (1 - age) + 3);
    g.globalAlpha = (1 - age * 0.7) * spent;
    g.fillStyle = i === 0 ? COLORS.white : COLORS.gold;
    g.fillRect(x + 1, y - h, tileSize - 2, h);
    g.fillStyle = COLORS.gold;
    g.fillRect(x, y - 2, tileSize, 2);
  }
  g.globalAlpha = 1;
}
