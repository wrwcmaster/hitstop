import type { Actor, CollisionSource, Projectile } from '@engine/index';
import { COLORS } from './palette';
import type { ActionGame } from '../defs';

/**
 * Ballistic shots — arrows and bullets as one shared vocabulary that
 * players' ranged weapons AND monsters fire through. Both are engine
 * Projectiles carrying a Strike; the difference is data: arrows arc
 * under gravity and read as rotating shafts, bullets fly nearly flat
 * with a tracer. `snapKind` tags each shot so co-op snapshots can
 * render the same silhouette on the guest.
 */

export const ARROW_GRAVITY = 420;
export const BULLET_GRAVITY = 30; // a hint of drop keeps long shots honest

export interface ShotOptions {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  targets: 'player' | 'enemy';
  attacker: Actor;
  /** Override the kind's default gravity. */
  gravity?: number;
  pierce?: number;
  life?: number;
}

/** A projectile tagged for co-op snapshots. */
export type TaggedProjectile = Projectile & { snapKind?: 'arrow' | 'bullet' };

/** The rotate-to-velocity arrow: shaft, steel head, fletching. */
/**
 * THE arrow, drawn at the origin pointing +x (fletching at -5.5, head
 * tip at +6.5). Flying shots and the arrow nocked on a drawn bow both
 * render through here, so they are pixel-identical. `tint` overrides
 * every color (hit-flash white).
 */
export function drawArrowSprite(g: CanvasRenderingContext2D, tint?: string): void {
  g.fillStyle = tint ?? '#8a6b3f'; // shaft
  g.fillRect(-5, -0.5, 8, 1);
  g.fillStyle = tint ?? COLORS.steel; // head
  g.fillRect(3, -1, 3, 2);
  g.fillStyle = tint ?? COLORS.white;
  g.fillRect(5, -0.5, 1.5, 1);
  g.fillStyle = tint ?? COLORS.red; // fletching
  g.fillRect(-5.5, -1.5, 2, 3);
}

export function drawArrow(g: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(Math.atan2(vy, vx));
  drawArrowSprite(g);
  g.restore();
}

/** The bullet tracer: a hot core with a fading tail along the velocity. */
export function drawBullet(g: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number): void {
  const d = Math.hypot(vx, vy) || 1;
  const nx = vx / d;
  const ny = vy / d;
  g.save();
  g.globalAlpha = 0.45;
  g.fillStyle = COLORS.gold;
  g.fillRect(x - nx * 8 - 1, y - ny * 8 - 1, 2, 2);
  g.globalAlpha = 0.75;
  g.fillRect(x - nx * 4 - 1, y - ny * 4 - 1, 2, 2);
  g.globalAlpha = 1;
  g.fillStyle = COLORS.white;
  g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
  g.restore();
}

/** Loose an arrow: arcs under gravity, sticks a puff of shards on walls. */
export function shootArrow(game: ActionGame, collision: CollisionSource, o: ShotOptions): TaggedProjectile {
  const pr = game.combat.shoot(
    {
      x: o.x, y: o.y, vx: o.vx, vy: o.vy,
      w: 5, h: 5,
      life: o.life ?? 2.5,
      gravity: o.gravity ?? ARROW_GRAVITY,
      pierce: o.pierce,
      strike: {
        damage: o.damage,
        targets: o.targets,
        attacker: o.attacker,
        strength: 0.45,
        knockback: 90,
        colors: ['#8a6b3f', COLORS.steel],
      },
      draw(g, p) {
        drawArrow(g, p.x, p.y, p.vx, p.vy);
      },
      onExpire(p) {
        game.feel.burst(p.x, p.y, 4, {
          color: ['#8a6b3f', COLORS.steel], speed: 55, life: 0.25, drag: 4,
        });
      },
    },
    collision,
  ) as TaggedProjectile;
  pr.snapKind = 'arrow';
  return pr;
}

/** Crack off a bullet: fast, nearly flat, sparks where it lands. */
export function shootBullet(game: ActionGame, collision: CollisionSource, o: ShotOptions): TaggedProjectile {
  const pr = game.combat.shoot(
    {
      x: o.x, y: o.y, vx: o.vx, vy: o.vy,
      w: 4, h: 4,
      life: o.life ?? 1.2,
      gravity: o.gravity ?? BULLET_GRAVITY,
      pierce: o.pierce,
      strike: {
        damage: o.damage,
        targets: o.targets,
        attacker: o.attacker,
        strength: 0.6,
        knockback: 120,
        colors: [COLORS.gold, COLORS.white],
      },
      draw(g, p) {
        drawBullet(g, p.x, p.y, p.vx, p.vy);
      },
      onExpire(p) {
        game.feel.burst(p.x, p.y, 6, {
          color: [COLORS.gold, COLORS.steel], speed: 90, life: 0.2, drag: 5,
        });
      },
    },
    collision,
  ) as TaggedProjectile;
  pr.snapKind = 'bullet';
  return pr;
}

/** Muzzle feedback shared by every shooter: flash, kick particles, sound. */
export function muzzleFlash(game: ActionGame, x: number, y: number, dir: number, kind: 'arrow' | 'bullet'): void {
  if (kind === 'bullet') {
    game.feel.sfx.play('gun');
    game.feel.burst(x, y, 7, {
      color: [COLORS.gold, COLORS.white], speed: 110, life: 0.14,
      angle: dir > 0 ? 0 : Math.PI, spread: 0.9, drag: 6,
    });
  } else {
    game.feel.sfx.play('bow');
  }
}
