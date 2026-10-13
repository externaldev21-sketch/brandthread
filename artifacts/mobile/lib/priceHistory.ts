/**
 * Product page price history (GET /api/public/products/:id/price-history).
 * Prices change in steps, so the line is drawn as a step chart: flat until
 * the day it changed, then straight down (or up) to the new price.
 */
export interface PricePoint { priceCents: number; at: string }
export interface PriceHistory { changed: boolean; points: PricePoint[] }

/** Pure: SVG path for a step line across `width`×`height`, from the first point to `now`. */
export function priceStepPath(points: PricePoint[], width: number, height: number, now = new Date(), pad = 2): string {
  if (points.length < 2 || width <= 0 || height <= 0) return '';
  const t0 = new Date(points[0].at).getTime();
  const t1 = Math.max(now.getTime(), new Date(points[points.length - 1].at).getTime());
  const span = Math.max(1, t1 - t0);
  const prices = points.map((p) => p.priceCents);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const range = Math.max(1, hi - lo);
  const x = (at: string) => ((new Date(at).getTime() - t0) / span) * width;
  const y = (cents: number) => pad + (1 - (cents - lo) / range) * (height - pad * 2);
  const round = (n: number) => Math.round(n * 10) / 10;
  let d = `M0 ${round(y(points[0].priceCents))}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H${round(x(points[i].at))} V${round(y(points[i].priceCents))}`;
  }
  return `${d} H${width}`;
}

/** Highest and lowest price in the window, for the two right-hand labels. */
export function priceRange(points: PricePoint[]): { hi: number; lo: number } | null {
  if (points.length === 0) return null;
  const prices = points.map((p) => p.priceCents);
  return { hi: Math.max(...prices), lo: Math.min(...prices) };
}
