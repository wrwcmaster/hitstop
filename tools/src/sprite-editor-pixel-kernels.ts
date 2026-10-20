/** Pure pixel kernels shared by the interactive editor and its performance tests. */

export interface PixelClipboard {
  w: number;
  h: number;
  rows: string[];
  mask?: string[];
  palette?: Record<string, string | null>;
}

export interface PixelBatch {
  frame: string[];
  width: number;
  height: number;
  rows: Map<number, string[]>;
  changed: boolean;
}

export function createPixelBatch(frame: string[]): PixelBatch {
  return {
    frame,
    width: frame[0]?.length ?? 0,
    height: frame.length,
    rows: new Map(),
    changed: false,
  };
}

export function batchPixel(batch: PixelBatch, x: number, y: number): string {
  return batch.rows.get(y)?.[x] ?? batch.frame[y][x];
}

export function setBatchPixel(batch: PixelBatch, x: number, y: number, ch: string): void {
  if (x < 0 || y < 0 || x >= batch.width || y >= batch.height || batchPixel(batch, x, y) === ch) return;
  let row = batch.rows.get(y);
  if (!row) {
    row = [...batch.frame[y]];
    batch.rows.set(y, row);
  }
  row[x] = ch;
  batch.changed = true;
}

export function commitPixelBatchRows(batch: PixelBatch): boolean {
  if (!batch.changed) return false;
  for (const [y, row] of batch.rows) batch.frame[y] = row.join('');
  return true;
}

export function brushStrength(dx: number, dy: number, size: number): number {
  const distance = Math.hypot(dx, dy);
  const outer = (size + 1) / 2;
  if (distance >= outer) return 0;
  const core = Math.max(0.55, outer * 0.55);
  if (distance <= core) return 1;
  return (outer - distance) / Math.max(0.001, outer - core);
}

export function pastePixels(
  rows: string[],
  clip: PixelClipboard,
  x: number,
  y: number,
  ignoreTransparent = false,
): void {
  const pastedW = Math.min(clip.w, rows[0].length - x);
  const pastedH = Math.min(clip.h, rows.length - y);
  for (let dy = 0; dy < pastedH; dy++) {
    if (!ignoreTransparent) {
      rows[y + dy] = rows[y + dy].slice(0, x)
        + clip.rows[dy].slice(0, pastedW)
        + rows[y + dy].slice(x + pastedW);
      continue;
    }
    const destination = [...rows[y + dy]];
    for (let dx = 0; dx < pastedW; dx++) {
      if (clip.mask && clip.mask[dy]?.[dx] !== '1') continue;
      const pixel = clip.rows[dy][dx];
      if (pixel !== '.') destination[x + dx] = pixel;
    }
    rows[y + dy] = destination.join('');
  }
}

export function scaleSelectionRows(
  source: PixelClipboard,
  w: number,
  h: number,
  flipX = false,
  flipY = false,
): PixelClipboard {
  return {
    w,
    h,
    rows: Array.from({ length: h }, (_, y) => {
      const scaledY = Math.min(source.h - 1, Math.floor(y * source.h / h));
      const sourceY = flipY ? source.h - 1 - scaledY : scaledY;
      return Array.from({ length: w }, (_, x) => {
        const scaledX = Math.min(source.w - 1, Math.floor(x * source.w / w));
        const sourceX = flipX ? source.w - 1 - scaledX : scaledX;
        return source.rows[sourceY][sourceX];
      }).join('');
    }),
    mask: source.mask && Array.from({ length: h }, (_, y) => {
      const scaledY = Math.min(source.h - 1, Math.floor(y * source.h / h));
      const sourceY = flipY ? source.h - 1 - scaledY : scaledY;
      return Array.from({ length: w }, (_, x) => {
        const scaledX = Math.min(source.w - 1, Math.floor(x * source.w / w));
        const sourceX = flipX ? source.w - 1 - scaledX : scaledX;
        return source.mask![sourceY][sourceX];
      }).join('');
    }),
  };
}

export function rotateSelectionQuarter(source: PixelClipboard, clockwise: boolean): PixelClipboard {
  return {
    w: source.h,
    h: source.w,
    rows: Array.from({ length: source.w }, (_, y) =>
      Array.from({ length: source.h }, (_, x) => clockwise
        ? source.rows[source.h - 1 - x][y]
        : source.rows[x][source.w - 1 - y],
      ).join(''),
    ),
    mask: source.mask && Array.from({ length: source.w }, (_, y) =>
      Array.from({ length: source.h }, (_, x) => clockwise
        ? source.mask![source.h - 1 - x][y]
        : source.mask![x][source.w - 1 - y],
      ).join(''),
    ),
  };
}

/**
 * Rotate indexed pixels with one nearest-neighbour destination-to-source pass.
 * Rows and masks are sampled together so live rotation does not duplicate the
 * trigonometry and bounds work.
 */
export function rotateSelectionRows(source: PixelClipboard, degrees: number): PixelClipboard {
  const normalized = ((degrees % 360) + 360) % 360;
  const quarterTurns = Math.round(normalized / 90) % 4;
  const quarterAngle = quarterTurns * 90;
  if (Math.abs(normalized - quarterAngle) < 0.0001 || Math.abs(normalized - 360) < 0.0001) {
    let result = source;
    for (let turn = 0; turn < quarterTurns; turn++) result = rotateSelectionQuarter(result, true);
    return result;
  }

  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const width = Math.max(1, Math.ceil(
    Math.abs(source.w * cosine) + Math.abs(source.h * sine) - 1e-9,
  ));
  const height = Math.max(1, Math.ceil(
    Math.abs(source.w * sine) + Math.abs(source.h * cosine) - 1e-9,
  ));
  const rows: string[] = [];
  const mask: string[] | undefined = source.mask ? [] : undefined;
  for (let y = 0; y < height; y++) {
    const destinationY = y + 0.5 - height / 2;
    const row: string[] = [];
    const maskRow: string[] | undefined = mask ? [] : undefined;
    for (let x = 0; x < width; x++) {
      const destinationX = x + 0.5 - width / 2;
      const sampleX = Math.floor(cosine * destinationX + sine * destinationY + source.w / 2);
      const sampleY = Math.floor(-sine * destinationX + cosine * destinationY + source.h / 2);
      const inside = sampleX >= 0 && sampleX < source.w && sampleY >= 0 && sampleY < source.h;
      row.push(inside ? source.rows[sampleY][sampleX] : '.');
      if (maskRow) maskRow.push(inside ? source.mask![sampleY][sampleX] : '.');
    }
    rows.push(row.join(''));
    if (maskRow) mask!.push(maskRow.join(''));
  }
  return { w: width, h: height, rows, mask };
}
