import { drawText } from '../gfx/font';

/** Floating combat text: damage numbers, score popups, combo callouts. */
interface Floater {
  x: number;
  y: number;
  str: string;
  color: string;
  scale: number;
  t: number;
  life: number;
}

export class Floaters {
  private items: Floater[] = [];

  add(x: number, y: number, str: string | number, color = '#fff', scale = 1, life = 0.8): void {
    this.items.push({ x, y, str: String(str), color, scale, t: 0, life });
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      f.t += dt;
      f.y -= 22 * dt * Math.max(0.2, 1 - f.t / f.life);
      if (f.t >= f.life) this.items.splice(i, 1);
    }
  }

  render(g: CanvasRenderingContext2D): void {
    for (const f of this.items) {
      // Blink during the final 30% of life as a "fading out" cue.
      if (f.t > f.life * 0.7 && Math.floor(f.t * 30) % 2) continue;
      drawText(g, f.str, f.x, f.y, f.color, f.scale, 'center');
    }
  }

  clear(): void {
    this.items.length = 0;
  }
}
