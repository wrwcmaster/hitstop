import { offscreen } from '@engine/index';
import { COLORS } from '../content/palette';

/**
 * Parallax night-sky backdrop: baked gradient + stars + moon, plus two
 * procedural hill layers that scroll at different rates against the camera.
 */
export class Background {
  private sky: HTMLCanvasElement;

  constructor(
    private viewW: number,
    private viewH: number,
  ) {
    const [c, g] = offscreen(viewW, viewH);
    const bands = ['#0a0c1c', '#0d1026', '#101430', '#12173a'];
    bands.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(0, i * Math.ceil(viewH / bands.length), viewW, Math.ceil(viewH / bands.length));
    });
    g.fillStyle = COLORS.white;
    for (let i = 0; i < 70; i++) {
      g.globalAlpha = 0.25 + Math.random() * 0.7;
      g.fillRect(Math.floor(Math.random() * viewW), Math.floor(Math.random() * (viewH * 0.7)), 1, 1);
    }
    g.globalAlpha = 1;
    // Moon with craters.
    g.fillStyle = '#e8e0c8';
    g.beginPath();
    g.arc(viewW * 0.82, viewH * 0.18, 17, 0, 7);
    g.fill();
    g.fillStyle = '#cbc2a6';
    g.fillRect(viewW * 0.82 - 7, viewH * 0.18 - 6, 4, 4);
    g.fillRect(viewW * 0.82 + 4, viewH * 0.18 + 6, 5, 3);
    g.fillRect(viewW * 0.82 - 1, viewH * 0.18 - 10, 3, 3);
    this.sky = c;
  }

  private hills(g: CanvasRenderingContext2D, color: string, base: number, amp: number, step: number, parallax: number, camX: number): void {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, this.viewH);
    const off = camX * parallax;
    for (let x = 0; x <= this.viewW; x += 4) {
      const wx = x + off;
      const y = base - Math.abs(((wx / step) % 2) - 1) * amp;
      g.lineTo(x, Math.round(y));
    }
    g.lineTo(this.viewW, this.viewH);
    g.closePath();
    g.fill();
  }

  render(g: CanvasRenderingContext2D, camX: number): void {
    g.drawImage(this.sky, 0, 0);
    this.hills(g, '#12173a', 235, 70, 200, 0.15, camX);
    this.hills(g, '#181e49', 245, 55, 130, 0.35, camX);
  }
}
