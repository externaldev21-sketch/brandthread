/**
 * Per-slide look for POST carousels — Instagram's Filter / Edit tools.
 * The same seven tools the server renders (api-server lib/carouselAdjust.ts),
 * so what you pick is what gets published. Values are -100..100 (fade and
 * vignette 0..100); 0 = unchanged.
 */
export const ADJUST_KEYS = ['brightness', 'contrast', 'saturation', 'warmth', 'structure', 'fade', 'vignette'] as const;
export type AdjustKey = (typeof ADJUST_KEYS)[number];
export type Adjust = Record<AdjustKey, number>;

export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, structure: 0, fade: 0, vignette: 0 };

export const ADJUST_TOOLS: Array<{ key: AdjustKey; label: string; icon: string; min: number }> = [
  { key: 'brightness', label: 'Brightness', icon: 'sun', min: -100 },
  { key: 'contrast', label: 'Contrast', icon: 'circle', min: -100 },
  { key: 'structure', label: 'Structure', icon: 'triangle', min: -100 },
  { key: 'warmth', label: 'Warmth', icon: 'thermometer', min: -100 },
  { key: 'saturation', label: 'Saturation', icon: 'droplet', min: -100 },
  { key: 'fade', label: 'Fade', icon: 'cloud', min: 0 },
  { key: 'vignette', label: 'Vignette', icon: 'aperture', min: 0 },
];

export interface FilterPreset { id: string; label: string; adjust: Adjust }
/** Looks, expressed in the same seven tools (so a filter is just a starting point you can refine). */
export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'original', label: 'Original', adjust: NO_ADJUST },
  { id: 'mono', label: 'Mono', adjust: { ...NO_ADJUST, saturation: -100, contrast: 15 } },
  { id: 'noir', label: 'Noir', adjust: { ...NO_ADJUST, saturation: -100, contrast: 40, brightness: -8, vignette: 45 } },
  { id: 'warm', label: 'Warm', adjust: { ...NO_ADJUST, warmth: 45, saturation: 10 } },
  { id: 'cool', label: 'Cool', adjust: { ...NO_ADJUST, warmth: -45, contrast: 8 } },
  { id: 'fade', label: 'Fade', adjust: { ...NO_ADJUST, fade: 45, contrast: -10, saturation: -15 } },
  { id: 'vivid', label: 'Vivid', adjust: { ...NO_ADJUST, saturation: 45, contrast: 15, structure: 20 } },
  { id: 'soft', label: 'Soft', adjust: { ...NO_ADJUST, brightness: 8, contrast: -15, structure: -25, fade: 12 } },
];

export function isNeutral(a: Adjust): boolean {
  return ADJUST_KEYS.every((k) => a[k] === 0);
}

export function matchingPreset(a: Adjust): string | null {
  const hit = FILTER_PRESETS.find((p) => ADJUST_KEYS.every((k) => p.adjust[k] === a[k]));
  return hit ? hit.id : null;
}

/** CSS/RN `filter` approximation for live preview (brightness, contrast, saturation, warmth). */
export function previewFilter(a: Adjust): string | undefined {
  const parts: string[] = [];
  if (a.brightness) parts.push(`brightness(${(1 + a.brightness / 200).toFixed(3)})`);
  if (a.contrast || a.fade) parts.push(`contrast(${(1 + a.contrast / 200 - a.fade / 400).toFixed(3)})`);
  if (a.saturation) parts.push(`saturate(${(1 + a.saturation / 100).toFixed(3)})`);
  if (a.warmth > 0) parts.push(`sepia(${(a.warmth / 220).toFixed(3)})`);
  if (a.warmth < 0) parts.push(`hue-rotate(${Math.round(a.warmth * 0.25)}deg)`);
  return parts.length ? parts.join(' ') : undefined;
}
