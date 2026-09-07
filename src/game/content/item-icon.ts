import { offscreen } from '@engine/index';
import { TEXEL } from './sprites';

/** Trim any transparent equipment layer into the standard 8×8 item icon. */
export function normalizedItemIcon(image: HTMLCanvasElement): HTMLCanvasElement {
  const size = 8 * TEXEL;
  const padding = TEXEL;
  const source = image.getContext('2d')!.getImageData(0, 0, image.width, image.height);
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (source.data[(y * image.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const [icon, g] = offscreen(size, size);
  if (maxX < minX || maxY < minY) return icon;
  const sourceW = maxX - minX + 1;
  const sourceH = maxY - minY + 1;
  const scale = Math.min((size - padding * 2) / sourceW, (size - padding * 2) / sourceH);
  const drawW = Math.max(1, Math.round(sourceW * scale));
  const drawH = Math.max(1, Math.round(sourceH * scale));
  g.imageSmoothingEnabled = false;
  g.drawImage(
    image,
    minX,
    minY,
    sourceW,
    sourceH,
    Math.floor((size - drawW) / 2),
    Math.floor((size - drawH) / 2),
    drawW,
    drawH,
  );
  return icon;
}
