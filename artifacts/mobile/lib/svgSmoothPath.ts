/**
 * Catmull-Rom -> cubic Bezier smoothing for an SVG line, so a trend reads as
 * a soft curve instead of jagged straight segments between data points.
 * Pure and dependency-free so it can be shared between every sparkline/area
 * chart on the seller dashboard and unit tested directly.
 */
export interface SmoothPoint {
  x: number;
  y: number;
}

export function smoothPath(points: SmoothPoint[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  }
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

/** Lays out a series of values into evenly-spaced points across `width`/`height`, with a hairline of top/bottom padding so the curve never clips. */
export function layoutSeriesPoints(values: number[], width: number, height: number): SmoothPoint[] {
  if (values.length === 0 || width <= 0) return [];
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const pad = height * 0.08;
  const usableHeight = height - pad * 2;
  return values.map((v, i) => ({
    x: values.length > 1 ? i * stepX : width / 2,
    y: pad + usableHeight - ((v - min) / range) * usableHeight,
  }));
}
