import { Game } from '../core/game';
import { Actor } from '../world/entity';
import { drawText } from '../gfx/font';
import type { CollisionContact, CollisionResult } from '../physics/body';

/**
 * In-game debug overlay (toggle with backquote `). Shows hurtboxes,
 * entity/particle counts, time scale — the fastest feedback loop for
 * tuning content. Render it inside the camera transform for boxes and
 * after for the text HUD.
 */
export class DebugOverlay {
  enabled = false;
  /** Contacts can last one simulation step (especially ceilings). Keep their
   * debug presentation around long enough for a human eye or screenshot. */
  private recentContacts = new WeakMap<Actor, { result: CollisionResult; until: number }>();

  constructor(private game: Game<never, Record<string, unknown>>) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') this.enabled = !this.enabled;
    });
  }

  private contactsFor(actor: Actor): CollisionResult | undefined {
    const now = performance.now();
    if (actor.lastCollision?.contacts.length) {
      this.recentContacts.set(actor, { result: actor.lastCollision, until: now + 300 });
      return actor.lastCollision;
    }
    const recent = this.recentContacts.get(actor);
    return recent && recent.until >= now ? recent.result : undefined;
  }

  /** World-space: hurtboxes and velocities. Call inside camera.begin/end. */
  renderWorld(g: CanvasRenderingContext2D): void {
    if (!this.enabled) return;
    for (const e of this.game.world.all()) {
      if (!(e instanceof Actor) || e.dead) continue;
      g.strokeStyle = e.team === 'player' ? '#38b764' : '#b13e53';
      g.lineWidth = 1;
      const hb = e.hurtbox;
      g.strokeRect(Math.round(hb.x) + 0.5, Math.round(hb.y) + 0.5, hb.w, hb.h);
      g.strokeStyle = '#ffcd75';
      g.beginPath();
      g.moveTo(e.cx, e.cy);
      g.lineTo(e.cx + e.vx * 0.1, e.cy + e.vy * 0.1);
      g.stroke();

      // Collision contacts: draw a compact marker at the actor's blocked edge
      // instead of outlining the entire solid. Tile contacts often resolve
      // against the first overlapped tile, so outlining that tile looked like
      // a stray block beside the actor rather than a useful contact readout.
      // Dynamic solids are cyan, one-way platforms green, level bounds
      // magenta, and ordinary solids gold.
      for (const c of this.contactsFor(e)?.contacts ?? []) {
        g.strokeStyle = c.boundary ? '#b55088' : c.dynamic ? '#73eff7' : c.oneWay ? '#a7f070' : '#ffcd75';
        const px = c.normal.x < 0 ? e.x + e.w : c.normal.x > 0 ? e.x : e.cx;
        const py = c.normal.y < 0 ? e.y + e.h : c.normal.y > 0 ? e.y : e.cy;
        g.beginPath();
        if (c.normal.x !== 0) {
          g.moveTo(Math.round(px) + 0.5, Math.round(py - 3) + 0.5);
          g.lineTo(Math.round(px) + 0.5, Math.round(py + 3) + 0.5);
        } else {
          g.moveTo(Math.round(px - 3) + 0.5, Math.round(py) + 0.5);
          g.lineTo(Math.round(px + 3) + 0.5, Math.round(py) + 0.5);
        }
        g.moveTo(Math.round(px) + 0.5, Math.round(py) + 0.5);
        g.lineTo(
          Math.round(px + c.normal.x * 6) + 0.5,
          Math.round(py + c.normal.y * 6) + 0.5,
        );
        g.stroke();
      }
    }
  }

  /** Screen-space stats. Call after camera.end. */
  renderScreen(g: CanvasRenderingContext2D): void {
    if (!this.enabled) return;
    const gm = this.game;
    const player = [...gm.world.actors('player')][0];
    const hit = player ? this.contactsFor(player) : undefined;
    const side = (contact: CollisionContact | null | undefined): string => {
      if (!contact) return '-';
      const kind = contact.boundary ? 'B' : contact.dynamic ? 'D' : contact.oneWay ? '1' : 'S';
      return `${kind}${Math.round(Math.abs(contact.impactVelocity))}`;
    };
    const lines = [
      `ENTITIES: ${gm.world.count()}`,
      `PARTICLES: ${gm.feel.particles.count}`,
      `TIMESCALE: ${gm.loop.timeScale.toFixed(2)}`,
      `TRAUMA: ${gm.camera.trauma.toFixed(2)}`,
      `CONTACT L:${side(hit?.left ?? null)} R:${side(hit?.right ?? null)} U:${side(hit?.ceiling ?? null)} D:${side(hit?.ground ?? null)}`,
      'CONTACT KEY S:SOLID 1:ONE-WAY D:DYNAMIC B:BOUNDS',
    ];
    lines.forEach((l, i) => drawText(g, l, 4, gm.height - 6 - (lines.length - i) * 8, '#38b764'));
  }
}
