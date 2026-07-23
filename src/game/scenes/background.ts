import { offscreen } from '@engine/index';
import { backdrops, type BackdropDef, type BackdropLayer } from '../content/backdrops';

/** Sky/vignette bake density — matches the game's ZOOM. */
const D = 4;

/**
 * Parallax night-sky backdrop, baked at device density: a smooth
 * banded gradient, a two-size star field, a glowing moon, and three
 * procedural hill layers scrolling at different rates. A baked radial
 * vignette (drawn over everything) pulls the eye to the center.
 */
export class Background {
  private skies = new Map<string, HTMLCanvasElement>();
  private vignette: HTMLCanvasElement;

  constructor(
    private viewW: number,
    private viewH: number,
  ) {
    const w = viewW * D;
    const h = viewH * D;
    // ---- vignette: subtle dark corners, baked once ----
    const [vc, vg] = offscreen(w, h);
    const rad = vg.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 1.05);
    rad.addColorStop(0, 'rgba(7,7,13,0)');
    rad.addColorStop(1, 'rgba(7,7,13,0.42)');
    vg.fillStyle = rad;
    vg.fillRect(0, 0, w, h);
    this.vignette = vc;
  }

  /** Stable pseudo-random fraction: backdrops do not shimmer between runs. */
  private noise(i: number, salt: number): number {
    const n = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  private skyFor(id: string, def: BackdropDef): HTMLCanvasElement {
    const cached = this.skies.get(id);
    if (cached) return cached;
    const w = this.viewW * D;
    const h = this.viewH * D;
    const [c, g] = offscreen(w, h);
    const bandH = Math.ceil(h / def.bands.length);
    def.bands.forEach((color, i) => {
      g.fillStyle = color;
      g.fillRect(0, i * bandH, w, bandH);
    });
    const starTier = (count: number, size: number, minA: number, maxA: number, salt: number, height: number) => {
      g.fillStyle = '#f4f4f4';
      for (let i = 0; i < count; i++) {
        g.globalAlpha = minA + this.noise(i, salt + 2) * (maxA - minA);
        g.fillRect(
          Math.floor(this.noise(i, salt) * w),
          Math.floor(this.noise(i, salt + 1) * h * height),
          size,
          size,
        );
      }
    };
    starTier(def.stars.dust, 1, 0.12, 0.57, 1, 0.72);
    starTier(def.stars.near, 2, 0.45, 0.9, 5, 0.6);
    starTier(def.stars.bright, 3, 0.7, 1, 9, 0.5);
    g.globalAlpha = 1;

    if (def.moon) {
      const moon = def.moon;
      const mx = w * moon.x;
      const my = h * moon.y;
      const r = moon.radius * D;
      const glow = g.createRadialGradient(mx, my, r * 0.55, mx, my, r * 2.7);
      glow.addColorStop(0, moon.glow);
      glow.addColorStop(1, 'rgba(232,224,200,0)');
      g.fillStyle = glow;
      g.fillRect(mx - r * 2.7, my - r * 2.7, r * 5.4, r * 5.4);
      g.fillStyle = moon.color;
      g.beginPath();
      g.arc(mx, my, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = moon.crater;
      for (const [x, y, size] of [[-0.3, -0.24, 0.2], [0.28, 0.34, 0.23], [0.06, -0.53, 0.14]]) {
        g.beginPath();
        g.arc(mx + x * r, my + y * r, size * r, 0, Math.PI * 2);
        g.fill();
      }
    }
    this.skies.set(id, c);
    return c;
  }

  private hills(
    g: CanvasRenderingContext2D,
    layer: BackdropLayer,
    camX: number,
    camY: number,
  ): void {
    g.fillStyle = layer.color;
    g.beginPath();
    g.moveTo(0, this.viewH);
    const off = camX * layer.parallaxX;
    const base = layer.base - camY * layer.parallaxY;
    // 2px steps: finer silhouettes at the higher density.
    for (let x = 0; x <= this.viewW; x += 2) {
      const wx = x + off;
      const y = base - Math.abs(((wx / layer.step) % 2) - 1) * layer.amp;
      g.lineTo(x, Math.round(y * D) / D);
    }
    g.lineTo(this.viewW, this.viewH);
    g.closePath();
    g.fill();
  }

  render(g: CanvasRenderingContext2D, camX: number, camY = 0, id = 'night', time = 0): void {
    const backdrop = backdrops.has(id) ? backdrops.get(id) : backdrops.get('night');
    g.drawImage(this.skyFor(id, backdrop), 0, 0, this.viewW, this.viewH);
    for (const layer of backdrop.layers) this.hills(g, layer, camX, camY);
    if (backdrop.drift) {
      const drift = backdrop.drift;
      g.fillStyle = drift.color;
      for (let i = 0; i < drift.count; i++) {
        const phase = this.noise(i, 21);
        const x = ((phase * (this.viewW + 32) + time * drift.speed + camX * 0.04) % (this.viewW + 32)) - 16;
        const y = ((this.noise(i, 22) * (this.viewH + 12) + time * drift.fall + camY * 0.025) % (this.viewH + 12)) - 6;
        const len = 2 + Math.floor(this.noise(i, 23) * 5);
        g.fillRect(Math.round(x), Math.round(y), len, 1);
      }
    }
  }

  /** Draw after the world (screen space) — subtle corner darkening. */
  renderVignette(g: CanvasRenderingContext2D): void {
    g.drawImage(this.vignette, 0, 0, this.viewW, this.viewH);
  }
}
