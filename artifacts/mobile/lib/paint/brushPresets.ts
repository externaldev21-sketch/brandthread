/**
 * brushPresets.ts — the Design Studio's brush library, organised exactly
 * like Procreate's Brushes panel: twelve sets (Sketching, Inking, Drawing,
 * Painting, Artistic, Calligraphy, Airbrushing, Textures, Abstract,
 * Charcoals, Elements, Spraypaints), each a list of named brushes.
 *
 * A brush is a set of engine parameters (lib/paint/dabEmitter.ts reads them;
 * the raster backends print them): a tip shape, a paper grain, spacing,
 * pressure/velocity response, jitter/scatter and so on — the same knobs
 * Procreate's Brush Studio exposes (Stroke path / Taper / Shape / Grain /
 * Dynamics / Apple Pencil). Every stroke stores a full snapshot of these
 * params, so editing or deleting a brush never changes artwork already drawn.
 *
 * Pure data + pure helpers; no react-native imports (unit-testable).
 */

import type { GrainKind, TipShape } from './tips';

export type BrushMode = 'paint' | 'erase' | 'smudge';

export interface BrushParams {
  tip: TipShape;
  grain: GrainKind;
  /** Grain tile size in logical px on a 1080px canvas (scales with canvas). */
  grainScale: number;
  /** 0..1 — how strongly the grain carves into the stroke. */
  grainDepth: number;
  /** Dab spacing as a fraction of the dab diameter. */
  spacing: number;
  /** 0..1 StreamLine: how much the stroke lags/smooths behind the finger. */
  streamline: number;
  /** Sideways wobble per dab, fraction of diameter. */
  jitter: number;
  /** Particles per dab (spray, snow, splatter). */
  count: number;
  /** Radius (fraction of the dab radius) that particles scatter within. */
  scatter: number;
  /** Particle diameter as a fraction of the brush diameter (1 = one full dab). */
  particleSize: number;
  sizeJitter: number;
  opacityJitter: number;
  /** Per-dab alpha (Procreate "Flow"). */
  flow: number;
  rotation: 'follow' | 'random' | 'fixed';
  /** Degrees; offset for 'follow', absolute for 'fixed'. */
  angle: number;
  /** 1 = as drawn; <1 squashes the tip vertically before rotation. */
  roundness: number;
  /** 0..1 — how much pressure drives size / opacity. */
  pressureSize: number;
  pressureOpacity: number;
  /** Smallest size fraction pressure or speed can shrink a dab to. */
  minSize: number;
  /** 0..1 — faster strokes get thinner (ink flick taper). */
  velocitySize: number;
  /** Start taper length, in diameters (0 = none). */
  taperStart: number;
  /** Max diameter in logical px on a 1080px canvas at 100% size. */
  maxSize: number;
  /** Smudge: how much paint is carried forward per dab (0..1). */
  smudgeStrength?: number;
}

export interface BrushPreset {
  id: string;
  name: string;
  category: BrushCategory;
  params: BrushParams;
}

export const BRUSH_CATEGORIES = [
  'Sketching', 'Inking', 'Drawing', 'Painting', 'Artistic', 'Calligraphy',
  'Airbrushing', 'Textures', 'Abstract', 'Charcoals', 'Elements', 'Spraypaints',
] as const;
export type BrushCategory = typeof BRUSH_CATEGORIES[number] | string;

const BASE: BrushParams = {
  tip: 'hard', grain: 'none', grainScale: 220, grainDepth: 0,
  spacing: 0.08, streamline: 0.35, jitter: 0, count: 1, scatter: 0, particleSize: 1,
  sizeJitter: 0, opacityJitter: 0, flow: 1, rotation: 'follow', angle: 0, roundness: 1,
  pressureSize: 0.6, pressureOpacity: 0, minSize: 0.15, velocitySize: 0, taperStart: 0,
  maxSize: 60,
};

const p = (over: Partial<BrushParams>): BrushParams => ({ ...BASE, ...over });

/** The default library, in panel order. Ids are stable (persisted as the active brush). */
export const DEFAULT_BRUSH_PRESETS: BrushPreset[] = [
  // ── Sketching: graphite — grainy tip on paper tooth, pressure → opacity ──
  { id: 'hb-pencil', name: 'HB Pencil', category: 'Sketching', params: p({ tip: 'pencil', grain: 'paper', grainScale: 180, grainDepth: 0.75, spacing: 0.06, pressureSize: 0.35, pressureOpacity: 0.7, flow: 0.6, rotation: 'random', maxSize: 14, streamline: 0.2 }) },
  { id: '6b-pencil', name: '6B Pencil', category: 'Sketching', params: p({ tip: 'pencil', grain: 'paper', grainScale: 220, grainDepth: 0.85, spacing: 0.06, pressureSize: 0.5, pressureOpacity: 0.6, flow: 0.85, rotation: 'random', maxSize: 26, streamline: 0.2 }) },
  { id: 'technical-pencil', name: 'Technical Pencil', category: 'Sketching', params: p({ tip: 'medium', grain: 'paper', grainScale: 160, grainDepth: 0.45, spacing: 0.05, pressureSize: 0.15, pressureOpacity: 0.5, flow: 0.9, maxSize: 8, streamline: 0.3 }) },
  { id: 'peppermint', name: 'Peppermint', category: 'Sketching', params: p({ tip: 'chalk', grain: 'paper', grainScale: 260, grainDepth: 0.6, spacing: 0.08, pressureSize: 0.6, pressureOpacity: 0.5, flow: 0.7, rotation: 'random', maxSize: 30 }) },

  // ── Inking: crisp hard edges, pressure + speed taper ──
  { id: 'studio-pen', name: 'Studio Pen', category: 'Inking', params: p({ tip: 'hard', spacing: 0.04, pressureSize: 0.85, velocitySize: 0.55, minSize: 0.08, taperStart: 2.5, streamline: 0.55, maxSize: 34 }) },
  { id: 'technical-pen', name: 'Technical Pen', category: 'Inking', params: p({ tip: 'hard', spacing: 0.04, pressureSize: 0.1, streamline: 0.6, maxSize: 18 }) },
  { id: 'dry-ink', name: 'Dry Ink', category: 'Inking', params: p({ tip: 'charcoal', grain: 'paper', grainScale: 300, grainDepth: 0.35, spacing: 0.05, pressureSize: 0.7, velocitySize: 0.3, rotation: 'random', maxSize: 30, streamline: 0.4 }) },
  { id: 'syrup', name: 'Syrup', category: 'Inking', params: p({ tip: 'hard', spacing: 0.03, pressureSize: 0.95, velocitySize: 0.75, minSize: 0.05, taperStart: 4, streamline: 0.7, maxSize: 60 }) },
  { id: 'ink-bleed', name: 'Ink Bleed', category: 'Inking', params: p({ tip: 'medium', spacing: 0.05, pressureSize: 0.7, flow: 0.9, jitter: 0.03, sizeJitter: 0.12, maxSize: 40, streamline: 0.45 }) },

  // ── Drawing: pastel/crayon — textured, medium grain ──
  { id: 'oil-pastel', name: 'Oil Pastel', category: 'Drawing', params: p({ tip: 'chalk', grain: 'canvas', grainScale: 240, grainDepth: 0.55, spacing: 0.07, pressureSize: 0.4, pressureOpacity: 0.35, rotation: 'random', maxSize: 46 }) },
  { id: 'crayon', name: 'Crayon', category: 'Drawing', params: p({ tip: 'pencil', grain: 'concrete', grainScale: 200, grainDepth: 0.7, spacing: 0.06, pressureSize: 0.3, pressureOpacity: 0.55, flow: 0.9, rotation: 'random', maxSize: 30 }) },
  { id: 'blackburn', name: 'Blackburn', category: 'Drawing', params: p({ tip: 'medium', grain: 'paper', grainScale: 260, grainDepth: 0.4, spacing: 0.05, pressureSize: 0.75, velocitySize: 0.3, taperStart: 2, maxSize: 26 }) },

  // ── Painting: wet bristle / gouache / flat ──
  { id: 'round-brush', name: 'Round Brush', category: 'Painting', params: p({ tip: 'medium', spacing: 0.05, pressureSize: 0.7, pressureOpacity: 0.3, flow: 0.85, taperStart: 1.5, maxSize: 70 }) },
  { id: 'gouache', name: 'Gouache', category: 'Painting', params: p({ tip: 'bristle', grain: 'canvas', grainScale: 280, grainDepth: 0.3, spacing: 0.04, pressureSize: 0.55, flow: 0.9, rotation: 'follow', angle: 90, maxSize: 80 }) },
  { id: 'flat-brush', name: 'Flat Brush', category: 'Painting', params: p({ tip: 'bristle', spacing: 0.03, pressureSize: 0.35, flow: 0.75, rotation: 'follow', angle: 90, maxSize: 90 }) },
  { id: 'wet-acrylic', name: 'Wet Acrylic', category: 'Painting', params: p({ tip: 'cloud', grain: 'canvas', grainScale: 300, grainDepth: 0.25, spacing: 0.06, pressureSize: 0.6, pressureOpacity: 0.5, flow: 0.55, rotation: 'random', maxSize: 90 }) },

  // ── Artistic: expressive, broken edges ──
  { id: 'tarraleah', name: 'Tarraleah', category: 'Artistic', params: p({ tip: 'charcoal', grain: 'canvas', grainScale: 320, grainDepth: 0.5, spacing: 0.08, pressureSize: 0.5, pressureOpacity: 0.4, rotation: 'random', sizeJitter: 0.2, maxSize: 90 }) },
  { id: 'spray-wax', name: 'Spray Wax', category: 'Artistic', params: p({ tip: 'splatter', spacing: 0.35, rotation: 'random', sizeJitter: 0.3, opacityJitter: 0.3, flow: 0.8, maxSize: 80 }) },
  { id: 'quoll', name: 'Quoll', category: 'Artistic', params: p({ tip: 'bristle', grain: 'paper', grainScale: 240, grainDepth: 0.4, spacing: 0.04, rotation: 'follow', angle: 90, jitter: 0.05, pressureSize: 0.6, maxSize: 60 }) },

  // ── Calligraphy: fixed-angle nib, monoline, brush pen ──
  { id: 'calligraphy', name: 'Calligraphy', category: 'Calligraphy', params: p({ tip: 'flat', spacing: 0.02, rotation: 'fixed', angle: -40, pressureSize: 0.35, streamline: 0.65, maxSize: 46 }) },
  { id: 'monoline', name: 'Monoline', category: 'Calligraphy', params: p({ tip: 'hard', spacing: 0.04, pressureSize: 0, streamline: 0.75, maxSize: 24 }) },
  { id: 'brush-pen', name: 'Brush Pen', category: 'Calligraphy', params: p({ tip: 'hard', spacing: 0.03, pressureSize: 0.95, velocitySize: 0.65, minSize: 0.12, taperStart: 3, streamline: 0.7, maxSize: 40 }) },
  { id: 'script', name: 'Script', category: 'Calligraphy', params: p({ tip: 'hard', spacing: 0.035, pressureSize: 0.6, velocitySize: 0.35, taperStart: 1.5, streamline: 0.8, maxSize: 22 }) },
  { id: 'chalk-lettering', name: 'Chalk', category: 'Calligraphy', params: p({ tip: 'chalk', grain: 'concrete', grainScale: 200, grainDepth: 0.6, spacing: 0.06, pressureSize: 0.4, rotation: 'random', maxSize: 30 }) },

  // ── Airbrushing: soft falloff, light flow that builds up ──
  { id: 'soft-airbrush', name: 'Soft Airbrush', category: 'Airbrushing', params: p({ tip: 'soft', spacing: 0.08, flow: 0.12, pressureSize: 0.3, pressureOpacity: 0.6, maxSize: 260, streamline: 0.2 }) },
  { id: 'medium-airbrush', name: 'Medium Airbrush', category: 'Airbrushing', params: p({ tip: 'soft', spacing: 0.06, flow: 0.25, pressureSize: 0.3, pressureOpacity: 0.5, maxSize: 160, streamline: 0.2 }) },
  { id: 'hard-airbrush', name: 'Hard Airbrush', category: 'Airbrushing', params: p({ tip: 'medium', spacing: 0.05, flow: 0.4, pressureSize: 0.3, pressureOpacity: 0.4, maxSize: 120, streamline: 0.2 }) },
  { id: 'soft-brush', name: 'Soft Brush', category: 'Airbrushing', params: p({ tip: 'soft', spacing: 0.07, flow: 0.35, pressureSize: 0.6, pressureOpacity: 0.3, maxSize: 200, streamline: 0.25 }) },

  // ── Textures: print a texture pattern ──
  { id: 'grunge', name: 'Grunge', category: 'Textures', params: p({ tip: 'soft', grain: 'concrete', grainScale: 340, grainDepth: 1, spacing: 0.1, flow: 0.7, pressureSize: 0.3, maxSize: 220 }) },
  { id: 'canvas-weave', name: 'Canvas Weave', category: 'Textures', params: p({ tip: 'soft', grain: 'canvas', grainScale: 260, grainDepth: 1, spacing: 0.1, flow: 0.7, pressureSize: 0.3, maxSize: 220 }) },
  { id: 'halftone', name: 'Halftone', category: 'Textures', params: p({ tip: 'hard', spacing: 1.6, count: 1, sizeJitter: 0.5, rotation: 'fixed', pressureSize: 0.5, maxSize: 20, streamline: 0.1 }) },

  // ── Abstract ──
  { id: 'pixel', name: 'Pixel', category: 'Abstract', params: p({ tip: 'square', spacing: 0.9, rotation: 'fixed', pressureSize: 0, maxSize: 36, streamline: 0 }) },
  { id: 'shatter', name: 'Shatter', category: 'Abstract', params: p({ tip: 'square', spacing: 0.5, rotation: 'random', count: 3, scatter: 1.4, particleSize: 0.35, sizeJitter: 0.6, opacityJitter: 0.5, maxSize: 80 }) },
  { id: 'ribbon', name: 'Ribbon', category: 'Abstract', params: p({ tip: 'flat', spacing: 0.02, rotation: 'follow', angle: 90, flow: 0.6, pressureSize: 0.2, maxSize: 70 }) },

  // ── Charcoals: rough, broken, grain heavy ──
  { id: 'vine-charcoal', name: 'Vine Charcoal', category: 'Charcoals', params: p({ tip: 'charcoal', grain: 'charcoal', grainScale: 220, grainDepth: 0.8, spacing: 0.06, pressureSize: 0.4, pressureOpacity: 0.6, flow: 0.8, rotation: 'random', maxSize: 34, streamline: 0.15 }) },
  { id: 'charcoal-block', name: 'Charcoal Block', category: 'Charcoals', params: p({ tip: 'chalk', grain: 'charcoal', grainScale: 260, grainDepth: 0.85, spacing: 0.05, pressureSize: 0.3, pressureOpacity: 0.5, rotation: 'follow', angle: 90, roundness: 0.45, maxSize: 70 }) },
  { id: 'burnt-tree', name: 'Burnt Tree', category: 'Charcoals', params: p({ tip: 'charcoal', grain: 'concrete', grainScale: 240, grainDepth: 0.65, spacing: 0.05, pressureSize: 0.6, velocitySize: 0.25, rotation: 'random', maxSize: 44 }) },

  // ── Elements ──
  { id: 'clouds', name: 'Clouds', category: 'Elements', params: p({ tip: 'cloud', spacing: 0.18, rotation: 'random', flow: 0.35, sizeJitter: 0.35, jitter: 0.15, pressureSize: 0.3, maxSize: 300 }) },
  { id: 'snowfall', name: 'Snowfall', category: 'Elements', params: p({ tip: 'soft', spacing: 0.5, count: 6, scatter: 1.6, particleSize: 0.12, sizeJitter: 0.7, opacityJitter: 0.5, pressureSize: 0.2, maxSize: 160 }) },
  { id: 'bokeh', name: 'Bokeh Lights', category: 'Elements', params: p({ tip: 'ring', spacing: 0.9, count: 1, scatter: 1, particleSize: 0.7, sizeJitter: 0.6, opacityJitter: 0.4, flow: 0.7, rotation: 'random', maxSize: 120 }) },
  { id: 'sparkle', name: 'Sparkle', category: 'Elements', params: p({ tip: 'star', spacing: 1.4, rotation: 'random', sizeJitter: 0.6, scatter: 1.2, particleSize: 0.8, maxSize: 80 }) },

  // ── Spraypaints: speckled nozzle, splatter, flicks ──
  { id: 'medium-nozzle', name: 'Medium Nozzle', category: 'Spraypaints', params: p({ tip: 'nozzle', spacing: 0.12, rotation: 'random', flow: 0.55, pressureOpacity: 0.4, pressureSize: 0.3, maxSize: 120, streamline: 0.1 }) },
  { id: 'fat-nozzle', name: 'Fat Nozzle', category: 'Spraypaints', params: p({ tip: 'hard', spacing: 0.25, count: 22, scatter: 1, particleSize: 0.035, sizeJitter: 0.6, opacityJitter: 0.4, flow: 0.9, pressureSize: 0.3, maxSize: 200, streamline: 0.1 }) },
  { id: 'splatter', name: 'Splatter', category: 'Spraypaints', params: p({ tip: 'splatter', spacing: 0.7, rotation: 'random', sizeJitter: 0.5, scatter: 0.6, particleSize: 1, maxSize: 160 }) },
  { id: 'flicks', name: 'Flicks', category: 'Spraypaints', params: p({ tip: 'hard', spacing: 0.4, count: 4, scatter: 1.8, particleSize: 0.08, sizeJitter: 0.8, velocitySize: 0.4, maxSize: 160 }) },
];

/** The eraser and smudge tools use their own (selectable) brush; these are the defaults. */
export const DEFAULT_ERASER_BRUSH_ID = 'soft-brush';
export const DEFAULT_SMUDGE_BRUSH_ID = 'soft-brush';
export const DEFAULT_PAINT_BRUSH_ID = 'studio-pen';

export function findPreset(presets: BrushPreset[], id: string): BrushPreset {
  return presets.find(b => b.id === id) ?? presets[0] ?? DEFAULT_BRUSH_PRESETS[0];
}

/**
 * Logical diameter (px) for a brush at a size-slider fraction (0..1), on a
 * canvas whose long side is `canvasLong` px. Brushes are sized relative to a
 * 1080px canvas so the same "Size 40%" looks the same on a 1080 square and a
 * 4500×5400 print canvas — matching Procreate, where brush size scales with
 * canvas resolution.
 */
export function brushDiameter(params: BrushParams, sizeFraction: number, canvasLong: number): number {
  const f = Math.max(0.01, Math.min(1, sizeFraction));
  // Perceptual curve: the bottom of the slider gives fine control.
  const curved = 0.02 + 0.98 * f * f;
  return Math.max(1, params.maxSize * curved * (canvasLong / 1080));
}

/** Groups presets by category in library order (categories with no brushes are kept, so empty sets show). */
export function groupPresets(presets: BrushPreset[], categories: string[]): { category: string; brushes: BrushPreset[] }[] {
  return categories.map(category => ({ category, brushes: presets.filter(b => b.category === category) }));
}
