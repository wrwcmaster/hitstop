import { offscreen } from '@engine/index';
import { COLORS } from '../content/palette';

/** Sky/vignette bake density — matches the game's ZOOM. */
const D = 4;

/**
 * Parallax night-sky backdrop, baked at device density: a smooth
 * banded gradient, a two-size star field, a glowing moon, and three
 * procedural hill layers scrolling at different rates. A baked radial
 * vignette (drawn over everything) pulls the eye to the center.
 */
export class Background {
  private sky: HTMLCanvasElement;
  private vignette: HTMLCanvasElement;

  constructor(
    private viewW: number,
    private viewH: number,
  ) {
    // ---- sky at 2x density: finer gradient banding + pixel stars ----
    const w = viewW * D;
    const h = viewH * D;
    const [c, g] = offscreen(w, h);
    const bands = ['#080a18', '#0a0c1e', '#0c0f26', '#0e122c', '#101532', '#121838', '#141b3e'];
    const bandH = Math.ceil(h / bands.length);
    bands.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(0, i * bandH, w, bandH);
    });
    // Three star tiers: distant dust, near stars, and a few bright ones.
    g.fillStyle = COLORS.white;
    for (let i = 0; i < 340; i++) {
      g.globalAlpha = 0.12 + Math.random() * 0.45;
      g.fillRect(Math.floor(Math.random() * w), Math.floor(Math.random() * (h * 0.72)), 1, 1);
    }
    for (let i = 0; i < 80; i++) {
      g.globalAlpha = 0.45 + Math.random() * 0.45;
      g.fillRect(Math.floor(Math.random() * w), Math.floor(Math.random() * (h * 0.6)), 2, 2);
    }
    for (let i = 0; i < 16; i++) {
      g.globalAlpha = 0.7 + Math.random() * 0.3;
      g.fillRect(Math.floor(Math.random() * w), Math.floor(Math.random() * (h * 0.5)), 3, 3);
    }
    g.globalAlpha = 1;
    // Moon with a soft glow halo and craters.
    const mx = w * 0.82;
    const my = h * 0.18;
    const R = D; // radii below are in logical px; scale to bake density
    const glow = g.createRadialGradient(mx, my, 10 * R, mx, my, 45 * R);
    glow.addColorStop(0, 'rgba(232,224,200,0.28)');
    glow.addColorStop(1, 'rgba(232,224,200,0)');
    g.fillStyle = glow;
    g.fillRect(mx - 45 * R, my - 45 * R, 90 * R, 90 * R);
    g.fillStyle = '#e8e0c8';
    g.beginPath();
    g.arc(mx, my, 17 * R, 0, 7);
    g.fill();
    g.fillStyle = '#d5cbae';
    g.beginPath();
    g.arc(mx - 5 * R, my - 4 * R, 3.5 * R, 0, 7);
    g.fill();
    g.beginPath();
    g.arc(mx + 4.5 * R, my + 6 * R, 4 * R, 0, 7);
    g.fill();
    g.beginPath();
    g.arc(mx + R, my - 9 * R, 2.5 * R, 0, 7);
    g.fill();
    this.sky = c;

    // ---- vignette: subtle dark corners, baked once ----
    const [vc, vg] = offscreen(w, h);
    const rad = vg.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 1.05);
    rad.addColorStop(0, 'rgba(7,7,13,0)');
    rad.addColorStop(1, 'rgba(7,7,13,0.42)');
    vg.fillStyle = rad;
    vg.fillRect(0, 0, w, h);
    this.vignette = vc;
  }

  private hills(
    g: CanvasRenderingContext2D,
    color: string,
    base: number,
    amp: number,
    step: number,
    parallax: number,
    camX: number,
  ): void {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, this.viewH);
    const off = camX * parallax;
    // 2px steps: finer silhouettes at the higher density.
    for (let x = 0; x <= this.viewW; x += 2) {
      const wx = x + off;
      const y = base - Math.abs(((wx / step) % 2) - 1) * amp;
      g.lineTo(x, Math.round(y * D) / D);
    }
    g.lineTo(this.viewW, this.viewH);
    g.closePath();
    g.fill();
  }

  render(g: CanvasRenderingContext2D, camX: number): void {
    g.drawImage(this.sky, 0, 0, this.viewW, this.viewH);
    this.hills(g, '#101430', 228, 82, 260, 0.08, camX);
    this.hills(g, '#12173a', 236, 68, 190, 0.16, camX);
    this.hills(g, '#181e49', 246, 52, 125, 0.35, camX);
  }

  /** Draw after the world (screen space) — subtle corner darkening. */
  renderVignette(g: CanvasRenderingContext2D): void {
    g.drawImage(this.vignette, 0, 0, this.viewW, this.viewH);
  }
}
