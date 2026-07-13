import {
  Entity,
  itemDef,
  applyGravity,
  moveAndCollide,
  overlaps,
  rand,
  chance,
  type Body,
  type CollisionSource,
} from '@engine/index';
import { COLORS } from '../content/palette';
import { TEXEL, blit } from '../content/sprites';
import type { ItemCtx } from '../content/items';
import type { ActionGame } from '../defs';
import { Player } from './player';

/**
 * A dropped item in the world: pops out with a hop, settles and bobs,
 * homes toward the player when close, and applies on touch —
 * 'instant' items fire their effect; everything else goes to the
 * inventory (with a name toast so the player knows what they got).
 */
export class Pickup extends Entity implements Body {
  x: number;
  y: number;
  w = 6;
  h = 6;
  vx: number;
  vy: number;
  onGround = false;
  flies = false;

  private age = 0;
  /** Despawn after this long (blinks near the end). */
  private ttl = 12;

  constructor(
    public readonly itemId: string,
    private game: ActionGame,
    private collision: CollisionSource,
    x: number,
    y: number,
  ) {
    super();
    const icon = itemDef(itemId).icon;
    if (icon) {
      this.w = icon.width / TEXEL;
      this.h = icon.height / TEXEL;
    }
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    // Pop out of the kill with a random hop.
    this.vx = rand(-60, 60);
    this.vy = rand(-160, -100);
    this.layer = 3;
  }

  update(dt: number): void {
    this.age += dt;
    if (this.age > this.ttl) {
      this.dead = true;
      return;
    }

    const player = this.world.first(Player);

    // Magnet: after the initial hop, drift toward a nearby living player.
    if (player && player.hp > 0 && this.age > 0.4) {
      const dx = player.cx - (this.x + this.w / 2);
      const dy = player.cy - (this.y + this.h / 2);
      const d = Math.hypot(dx, dy);
      if (d < 42) {
        this.flies = true;
        const pull = 500 * (1 - d / 42);
        this.vx += (dx / d) * pull * dt * 8;
        this.vy += (dy / d) * pull * dt * 8;
      } else {
        this.flies = false;
      }
    }

    if (!this.flies) {
      applyGravity(this, dt);
      this.vx *= Math.pow(0.05, dt);
      if (this.onGround && this.vy >= 0) {
        // Gentle bob while resting.
        this.y += Math.sin(this.age * 4) * 0.15;
      }
    }
    moveAndCollide(this, dt, this.collision, { ignoreOneWay: this.flies });

    // Occasional sparkle so drops read at a glance.
    if (chance(dt * 2)) {
      this.game.feel.particles.spawn({
        x: this.x + rand(0, this.w), y: this.y + rand(0, this.h),
        vy: -8, life: 0.4, size: 1, color: COLORS.white, drag: 1,
      });
    }

    if (player && player.hp > 0 && overlaps(this, player)) this.collect(player);
  }

  private collect(player: Player): void {
    this.dead = true;
    const def = itemDef<ItemCtx>(this.itemId);
    const ctx: ItemCtx = { game: this.game, player };
    if (def.kind === 'instant') {
      def.onPickup?.(ctx);
    } else {
      player.inventory.add(this.itemId);
      def.onPickup?.(ctx);
      this.game.feel.sfx.play('pickup');
      this.game.feel.text(player.cx, this.y - 6, def.name, COLORS.gold);
    }
    this.game.events.emit('pickup', { id: this.itemId });
    this.game.feel.burst(this.x + this.w / 2, this.y + this.h / 2, 6, {
      color: [COLORS.white, COLORS.gold], speed: 50, life: 0.25, drag: 4,
    });
  }

  render(g: CanvasRenderingContext2D): void {
    // Blink during the final 2 seconds before despawn.
    if (this.ttl - this.age < 2 && Math.floor(this.age * 8) % 2) return;
    const icon = itemDef(this.itemId).icon;
    if (icon) {
      blit(g, icon, this.x, this.y);
    } else {
      g.fillStyle = COLORS.gold;
      g.fillRect(Math.round(this.x), Math.round(this.y), this.w, this.h);
    }
  }
}
