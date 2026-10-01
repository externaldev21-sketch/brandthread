/**
 * Per-slide look adjustments for POST carousels (Instagram's Edit tools).
 * Numeric-only input → an FFmpeg filter chain, so nothing user-supplied is
 * ever interpolated as text. Every tool runs -100..100 (fade and vignette
 * 0..100); 0 is "unchanged". The mobile client mirrors these names in
 * artifacts/mobile/lib/createPost/adjust.ts.
 */
export const ADJUST_KEYS = ["brightness", "contrast", "saturation", "warmth", "structure", "fade", "vignette"] as const;
export type AdjustKey = (typeof ADJUST_KEYS)[number];
export type Adjust = Record<AdjustKey, number>;

export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, structure: 0, fade: 0, vignette: 0 };

export function parseAdjust(raw: unknown): { ok: true; adjust: Adjust } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, adjust: { ...NO_ADJUST } };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "adjust must be an object" };
  const out: Adjust = { ...NO_ADJUST };
  for (const key of ADJUST_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const min = key === "fade" || key === "vignette" ? 0 : -100;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > 100) {
      return { ok: false, error: `adjust.${key} must be a number between ${min} and 100` };
    }
    out[key] = value;
  }
  return { ok: true, adjust: out };
}

export interface CropRect { x: number; y: number; width: number; height: number }

export function parseCrop(raw: unknown): { ok: true; crop: CropRect } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, crop: { x: 0, y: 0, width: 1, height: 1 } };
  const c = raw as Record<string, unknown>;
  const nums = ["x", "y", "width", "height"].map((k) => c?.[k]);
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) return { ok: false, error: "crop must have numeric x, y, width, height" };
  const [x, y, width, height] = nums as number[];
  const eps = 0.001;
  if (x < -eps || y < -eps || width <= 0.01 || height <= 0.01 || x + width > 1 + eps || y + height > 1 + eps) {
    return { ok: false, error: "crop must stay inside the source (normalized 0–1)" };
  }
  return { ok: true, crop: { x: Math.max(0, x), y: Math.max(0, y), width: Math.min(width, 1), height: Math.min(height, 1) } };
}

export function cropFilter(c: CropRect): string {
  const f = (n: number) => n.toFixed(5);
  return `crop=w='trunc(iw*${f(c.width)}/2)*2':h='trunc(ih*${f(c.height)}/2)*2':x='trunc(iw*${f(c.x)})':y='trunc(ih*${f(c.y)})'`;
}

/** FFmpeg filters for an adjustment, in a fixed order; empty when nothing changed. */
export function adjustFilters(a: Adjust): string[] {
  const out: string[] = [];
  const eq: string[] = [];
  if (a.brightness) eq.push(`brightness=${(a.brightness / 250).toFixed(4)}`);
  if (a.contrast) eq.push(`contrast=${(1 + a.contrast / 200).toFixed(4)}`);
  if (a.saturation) eq.push(`saturation=${(1 + a.saturation / 100).toFixed(4)}`);
  if (eq.length) out.push(`eq=${eq.join(":")}`);
  if (a.warmth) {
    const w = (a.warmth / 400).toFixed(4);
    const n = (-a.warmth / 400).toFixed(4);
    out.push(`colorbalance=rs=${w}:bs=${n}:rm=${w}:bm=${n}:rh=${w}:bh=${n}`);
  }
  if (a.structure) out.push(`unsharp=5:5:${(a.structure / 50).toFixed(3)}:5:5:0`);
  if (a.fade) out.push(`curves=all='0/${(a.fade / 250).toFixed(4)} 1/${(1 - a.fade / 600).toFixed(4)}'`);
  if (a.vignette) out.push(`vignette=a=${((a.vignette / 100) * 0.7).toFixed(4)}`);
  return out;
}
