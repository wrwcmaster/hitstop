export interface SelectionGeometryInput {
  x: number;
  y: number;
  w: number;
  h: number;
  mask?: string[];
}

export interface SelectionPoint {
  x: number;
  y: number;
}

export interface SelectionGeometry {
  pixelCount: number;
  centroid: SelectionPoint;
  principalAxis: {
    /** Clockwise degrees in canvas coordinates, canonicalized left-to-right. */
    angleDegrees: number;
    start: SelectionPoint;
    end: SelectionPoint;
    length: number;
    /** Root-mean-square distance of selected pixel centers from the axis. */
    orthogonalRms: number;
    /** Major/minor variance ratio. Higher values indicate a reliable long axis. */
    elongation: number | null;
  };
}

const rounded = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * Describe a pixel mask without interpreting its semantics. The axis has no
 * built-in notion of grip or tip: callers orient it using authoritative art or
 * anchor data. Pixel centers are used so the result is stable for sparse masks.
 */
export function analyzeSelectionGeometry(selection: SelectionGeometryInput): SelectionGeometry {
  const points: SelectionPoint[] = [];
  for (let row = 0; row < selection.h; row++) {
    const maskRow = selection.mask?.[row];
    for (let column = 0; column < selection.w; column++) {
      if (maskRow && maskRow[column] !== '1') continue;
      points.push({ x: selection.x + column + 0.5, y: selection.y + row + 0.5 });
    }
  }
  if (!points.length) throw new Error('selection mask contains no selected pixels');

  const centroid = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  centroid.x /= points.length;
  centroid.y /= points.length;

  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  xx /= points.length;
  xy /= points.length;
  yy /= points.length;

  let angle = points.length === 1 ? 0 : 0.5 * Math.atan2(2 * xy, xx - yy);
  let axisX = Math.cos(angle);
  let axisY = Math.sin(angle);
  if (axisX < 0 || (Math.abs(axisX) < 1e-12 && axisY < 0)) {
    axisX = -axisX;
    axisY = -axisY;
    angle += Math.PI;
  }

  let minProjection = Infinity;
  let maxProjection = -Infinity;
  let orthogonalSquared = 0;
  for (const point of points) {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    const projection = dx * axisX + dy * axisY;
    minProjection = Math.min(minProjection, projection);
    maxProjection = Math.max(maxProjection, projection);
    const orthogonal = -dx * axisY + dy * axisX;
    orthogonalSquared += orthogonal * orthogonal;
  }

  const trace = xx + yy;
  const discriminant = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy ** 2));
  const majorVariance = (trace + discriminant) / 2;
  const minorVariance = (trace - discriminant) / 2;
  const elongation = minorVariance <= 1e-12 ? null : majorVariance / minorVariance;

  return {
    pixelCount: points.length,
    centroid: { x: rounded(centroid.x), y: rounded(centroid.y) },
    principalAxis: {
      angleDegrees: rounded(angle * 180 / Math.PI),
      start: {
        x: rounded(centroid.x + axisX * minProjection),
        y: rounded(centroid.y + axisY * minProjection),
      },
      end: {
        x: rounded(centroid.x + axisX * maxProjection),
        y: rounded(centroid.y + axisY * maxProjection),
      },
      length: rounded(maxProjection - minProjection),
      orthogonalRms: rounded(Math.sqrt(orthogonalSquared / points.length)),
      elongation: elongation == null ? null : rounded(elongation),
    },
  };
}
