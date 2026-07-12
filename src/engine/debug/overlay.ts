import { Game } from '../core/game';
import { Actor } from '../world/entity';
import { drawText } from '../gfx/font';

/**
 * In-game debug overlay (toggle with backquote `). Shows hurtboxes,
 * entity/particle counts, time scale — the fastest feedback loop for
 * tuning content. Render it inside the camera transform for boxes and
 * after for the text HUD.
 */
export class DebugOverlay {
  enabled = false;

  constructor(private game: Game<never, Record<string, unknown>>) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') this.enabled = !this.enabled;
    });
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
    }
  }

  /** Screen-space stats. Call after camera.end. */
  renderScreen(g: CanvasRenderingContext2D): void {
    if (!this.enabled) return;
    const gm = this.game;
    const lines = [
      `ENTITIES: ${gm.world.count()}`,
      `PARTICLES: ${gm.feel.particles.count}`,
      `TIMESCALE: ${gm.loop.timeScale.toFixed(2)}`,
      `TRAUMA: ${gm.camera.trauma.toFixed(2)}`,
    ];
    lines.forEach((l, i) => drawText(g, l, 4, gm.height - 6 - (lines.length - i) * 8, '#38b764'));
  }
}
