/**
 * canvasPresets.ts — canvas creation preset helpers.
 *
 * Concrete pixel/DPI definitions live in designTypes.ts (CANVAS_PRESETS) so the
 * canonical preset list stays in one place. This module adds:
 *   - grouping metadata (category) for the "new project" UI
 *   - custom-size validation/clamping (up to 4000px print resolution)
 *   - DPI <-> physical inches helpers
 */

import { CANVAS_PRESETS, CanvasPresetId, DesignCanvas } from '../services/designTypes';

export type CanvasPresetCategory = 'social' | 'print' | 'garment' | 'label' | 'custom';

export const PRESET_CATEGORY: Record<CanvasPresetId, CanvasPresetCategory> = {
  square: 'social',
  portrait: 'social',
  landscape: 'social',
  story: 'social',
  post: 'social',
  product: 'social',
  print: 'print',
  a4: 'print',
  tee_front: 'garment',
  tee_back: 'garment',
  hoodie_front: 'garment',
  hoodie_back: 'garment',
  label: 'label',
  custom: 'custom',
};

/** Maximum edge (px) allowed for a custom canvas — matches the print-resolution ceiling. */
export const MAX_CUSTOM_CANVAS_PX = 4000;
export const MIN_CUSTOM_CANVAS_PX = 32;

export function clampCustomCanvasSize(w: number, h: number): { width: number; height: number } {
  const clamp = (v: number) => Math.round(Math.min(MAX_CUSTOM_CANVAS_PX, Math.max(MIN_CUSTOM_CANVAS_PX, v)));
  return { width: clamp(w), height: clamp(h) };
}

/** Convert a pixel dimension + DPI to physical inches (rounded to 2dp). */
export function pxToInches(px: number, dpi: number): number {
  if (!dpi || dpi <= 0) return 0;
  return Math.round((px / dpi) * 100) / 100;
}

/** Convert physical inches + DPI to a pixel dimension. */
export function inchesToPx(inches: number, dpi: number): number {
  return Math.round(inches * dpi);
}

export function getPreset(id: CanvasPresetId) {
  return CANVAS_PRESETS.find(p => p.id === id) ?? CANVAS_PRESETS[0];
}

/** Build a DesignCanvas from a preset id, optionally overriding dimensions (custom). */
export function canvasFromPreset(
  id: CanvasPresetId,
  overrides?: { width?: number; height?: number; dpi?: number; backgroundHex?: string },
): DesignCanvas {
  const preset = getPreset(id);
  const width = overrides?.width ?? preset.width;
  const height = overrides?.height ?? preset.height;
  const { width: clampedW, height: clampedH } = id === 'custom'
    ? clampCustomCanvasSize(width, height)
    : { width, height };
  return {
    width: clampedW,
    height: clampedH,
    backgroundHex: overrides?.backgroundHex ?? '#FFFFFF',
    dpi: overrides?.dpi ?? preset.dpi ?? 72,
    presetId: id,
  };
}

export function presetsByCategory(category: CanvasPresetCategory) {
  return CANVAS_PRESETS.filter(p => PRESET_CATEGORY[p.id] === category);
}
