/**
 * adjustmentsCatalog.ts — the Adjustments menu's structure, mirroring
 * Procreate Pocket's own (Mobbin-verified): a 2×2 category grid, each
 * category opening a list of tools.
 *
 * Dependency-free so vitest can import it directly, and so the e2e spec
 * and the UI agree on one source of truth for ids/labels.
 *
 * Deferred tools are listed in ADJ_DEFERRED with the reason, and are
 * deliberately NOT rendered as greyed-out rows — a row that can't work is a
 * stub, and this project's rule is no stubs.
 */
import type { EffectsAdjustment } from './adjustmentsModel';

export type AdjCategory = 'colour' | 'blur' | 'effects' | 'retouch';
export type AdjTool =
  | 'hsb' | 'colorBalance' | 'curves' | 'gradientMap'
  | 'gaussianBlur' | 'motionBlur'
  | 'opacity' | 'sharpen' | 'bloom' | 'chromatic'
  | 'liquify';

export interface AdjCategoryDef { key: AdjCategory; label: string; icon: string; tools: AdjTool[]; }

/** Procreate: Colour Adjustment / Blur / Effects / Retouch, in that grid order. */
export const ADJ_CATEGORIES: AdjCategoryDef[] = [
  { key: 'colour',  label: 'Colour Adjustment', icon: 'droplet',  tools: ['hsb', 'colorBalance', 'curves', 'gradientMap'] },
  { key: 'blur',    label: 'Blur',              icon: 'aperture', tools: ['gaussianBlur', 'motionBlur'] },
  { key: 'effects', label: 'Effects',           icon: 'zap',      tools: ['opacity', 'sharpen', 'bloom', 'chromatic'] },
  { key: 'retouch', label: 'Retouch',           icon: 'edit-3',   tools: ['liquify'] },
];

export const ADJ_TOOL_LABELS: Record<AdjTool, string> = {
  hsb: 'Hue, Saturation, Brightness',
  colorBalance: 'Colour Balance',
  curves: 'Curves',
  gradientMap: 'Gradient Map',
  gaussianBlur: 'Gaussian Blur',
  motionBlur: 'Motion Blur',
  opacity: 'Opacity',
  sharpen: 'Sharpen',
  bloom: 'Bloom',
  chromatic: 'Chromatic Aberration',
  liquify: 'Liquify',
};

/** Procreate tools intentionally absent, with the reason each would be a stub today. */
export const ADJ_DEFERRED: { category: AdjCategory; label: string; reason: string }[] = [
  { category: 'blur',    label: 'Perspective Blur',  reason: 'needs a per-pixel radial/vanishing-point blur; no SVG primitive expresses it' },
  { category: 'effects', label: 'Noise',             reason: 'needs a noise source (feTurbulence), which react-native-svg 15 renders as null (unimplemented); no other primitive generates grain' },
  { category: 'effects', label: 'Glitch',            reason: 'an open-ended stylistic effect with no single real definition to implement' },
  { category: 'effects', label: 'Halftone',          reason: 'needs tiled dot patterns (feTile/pattern per cell); not expressible as a single live filter here' },
  { category: 'retouch', label: 'Clone',             reason: 'needs a sampling brush that reads pixels from another canvas region; no raster read path exists' },
];

export function categoryOfTool(tool: AdjTool): AdjCategory {
  return ADJ_CATEGORIES.find(c => c.tools.includes(tool))!.key;
}

// ─── Slider specs for the effect tools ────────────────────────────────────────

export interface SliderSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signedPct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
const px = (v: number) => `${Math.round(v)} px`;
const deg = (v: number) => `${Math.round(v)}°`;

export const EFFECT_SLIDERS: Partial<Record<AdjTool, SliderSpec[]>> = {
  colorBalance: [
    { key: 'cyanRed',      label: 'Cyan — Red',      min: -1, max: 1, step: 0.1, format: signedPct },
    { key: 'magentaGreen', label: 'Magenta — Green', min: -1, max: 1, step: 0.1, format: signedPct },
    { key: 'yellowBlue',   label: 'Yellow — Blue',   min: -1, max: 1, step: 0.1, format: signedPct },
  ],
  gradientMap:  [{ key: 'mix',    label: 'Mix',       min: 0, max: 1,   step: 0.1, format: pct }],
  gaussianBlur: [{ key: 'value',  label: 'Amount',    min: 0, max: 40,  step: 2,   format: px }],
  motionBlur: [
    { key: 'amount', label: 'Amount', min: 0, max: 40,  step: 2,  format: px },
    { key: 'angle',  label: 'Angle',  min: 0, max: 180, step: 15, format: deg },
  ],
  opacity:   [{ key: 'value', label: 'Opacity',  min: 0, max: 1,  step: 0.1, format: pct }],
  sharpen:   [{ key: 'value', label: 'Amount',   min: 0, max: 1,  step: 0.1, format: pct }],
  bloom:     [{ key: 'value', label: 'Amount',   min: 0, max: 1,  step: 0.1, format: pct }],
  chromatic: [{ key: 'value', label: 'Amount',   min: 0, max: 24, step: 2,   format: px }],
};

/** Gradient-map presets the user picks from (real two-stop ramps, not placeholders). */
export const GRADIENT_MAP_PRESETS: { label: string; from: string; to: string }[] = [
  { label: 'Mono',   from: '#000000', to: '#FFFFFF' },
  { label: 'Sepia',  from: '#2B1D0E', to: '#F2E2C4' },
  { label: 'Cyan',   from: '#001B2E', to: '#9EF0FF' },
  { label: 'Ember',  from: '#1A0000', to: '#FFB347' },
  { label: 'Violet', from: '#12002B', to: '#E6B3FF' },
];

/** Read the slider's current value out of the effects record (0 / sensible default when unset). */
export function readEffectValue(effects: EffectsAdjustment | undefined, tool: AdjTool, key: string): number {
  const e = effects ?? {};
  switch (tool) {
    case 'colorBalance': return (e.colorBalance as any)?.[key] ?? 0;
    case 'gradientMap':  return e.gradientMap?.mix ?? 0;
    case 'gaussianBlur': return e.gaussianBlur ?? 0;
    case 'motionBlur':   return (e.motionBlur as any)?.[key] ?? 0;
    case 'sharpen':      return e.sharpen ?? 0;
    case 'bloom':        return e.bloom ?? 0;
    case 'chromatic':    return e.chromatic ?? 0;
    default:             return 0;
  }
}

/** Return a NEW effects record with one slider value written (never mutates). */
export function writeEffectValue(effects: EffectsAdjustment | undefined, tool: AdjTool, key: string, value: number): EffectsAdjustment {
  const e: EffectsAdjustment = { ...(effects ?? {}) };
  switch (tool) {
    case 'colorBalance':
      e.colorBalance = { cyanRed: 0, magentaGreen: 0, yellowBlue: 0, ...(e.colorBalance ?? {}), [key]: value };
      break;
    case 'gradientMap':
      e.gradientMap = { from: GRADIENT_MAP_PRESETS[0].from, to: GRADIENT_MAP_PRESETS[0].to, ...(e.gradientMap ?? {}), mix: value };
      break;
    case 'gaussianBlur': e.gaussianBlur = value; break;
    case 'motionBlur':
      e.motionBlur = { amount: 0, angle: 0, ...(e.motionBlur ?? {}), [key]: value };
      break;
    case 'sharpen':   e.sharpen = value; break;
    case 'bloom':     e.bloom = value; break;
    case 'chromatic': e.chromatic = value; break;
    default: break;
  }
  return e;
}

/** Set the gradient map's two stops (keeps mix; starts mix at 1 if it was unset so the pick is visible). */
export function writeGradientMapStops(effects: EffectsAdjustment | undefined, from: string, to: string): EffectsAdjustment {
  const e: EffectsAdjustment = { ...(effects ?? {}) };
  e.gradientMap = { from, to, mix: e.gradientMap?.mix ?? 1 };
  return e;
}
