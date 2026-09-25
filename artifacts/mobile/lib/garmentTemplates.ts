/**
 * garmentTemplates.ts — flat-sketch garment outline artwork.
 *
 * Each template is a simple, clean line-art path (SVG path data) drawn in a
 * normalized 0..1000 x 0..1000 coordinate box, meant to be scaled to fill the
 * canvas and rendered on a LOCKED, non-exportable guide layer beneath the
 * user's design layers (see buildGarmentTemplateLayer below).
 *
 * These are original, minimal single-stroke outlines (not traced from any
 * source), intended purely as placement guides — not as final artwork.
 */

import type { DesignLayer, GarmentType, GarmentView } from '../services/designTypes';

export interface GarmentTemplateDef {
  id: string;
  garmentType: GarmentType;
  view: GarmentView;
  label: string;
  /** SVG path `d` string in a 0..1000 viewBox, stroke-only line art. */
  path: string;
  /** Suggested print-safe placement rect (fraction of canvas, 0..1). */
  printArea: { x: number; y: number; w: number; h: number };
}

// Coordinates are hand-authored simple outlines in a 1000x1000 box.
export const GARMENT_TEMPLATES: GarmentTemplateDef[] = [
  {
    id: 'tshirt_front',
    garmentType: 'tshirt',
    view: 'front',
    label: 'T-Shirt — Front',
    path:
      'M 350 60 L 650 60 L 700 130 L 860 190 L 800 340 L 700 300 L 700 940 L 300 940 L 300 300 ' +
      'L 200 340 L 140 190 L 300 130 Z M 400 60 Q 500 150 600 60',
    printArea: { x: 0.3, y: 0.3, w: 0.4, h: 0.45 },
  },
  {
    id: 'tshirt_back',
    garmentType: 'tshirt',
    view: 'back',
    label: 'T-Shirt — Back',
    path:
      'M 350 60 L 650 60 L 700 130 L 860 190 L 800 340 L 700 300 L 700 940 L 300 940 L 300 300 ' +
      'L 200 340 L 140 190 L 300 130 Z M 380 60 Q 500 110 620 60',
    printArea: { x: 0.25, y: 0.22, w: 0.5, h: 0.55 },
  },
  {
    id: 'hoodie_front',
    garmentType: 'hoodie',
    view: 'front',
    label: 'Hoodie — Front',
    path:
      'M 330 120 L 380 60 L 620 60 L 670 120 L 720 150 L 880 220 L 820 380 L 720 330 L 720 940 ' +
      'L 280 940 L 280 330 L 180 380 L 120 220 L 280 150 Z ' +
      'M 420 120 Q 500 220 580 120 ' +
      'M 470 940 L 470 760 L 530 760 L 530 940 M 400 500 L 600 500',
    printArea: { x: 0.32, y: 0.32, w: 0.36, h: 0.4 },
  },
  {
    id: 'hoodie_back',
    garmentType: 'hoodie',
    view: 'back',
    label: 'Hoodie — Back',
    path:
      'M 330 120 L 380 60 L 620 60 L 670 120 L 720 150 L 880 220 L 820 380 L 720 330 L 720 940 ' +
      'L 280 940 L 280 330 L 180 380 L 120 220 L 280 150 Z ' +
      'M 350 130 Q 500 60 650 130',
    printArea: { x: 0.22, y: 0.24, w: 0.56, h: 0.55 },
  },
  {
    id: 'crewneck_front',
    garmentType: 'sweatshirt',
    view: 'front',
    label: 'Crewneck — Front',
    path:
      'M 340 90 L 660 90 L 710 150 L 860 210 L 800 360 L 710 320 L 710 940 L 290 940 L 290 320 ' +
      'L 200 360 L 140 210 L 290 150 Z M 400 90 Q 500 170 600 90 M 300 940 L 300 900 M 700 940 L 700 900',
    printArea: { x: 0.3, y: 0.32, w: 0.4, h: 0.42 },
  },
  {
    id: 'crewneck_back',
    garmentType: 'sweatshirt',
    view: 'back',
    label: 'Crewneck — Back',
    path:
      'M 340 90 L 660 90 L 710 150 L 860 210 L 800 360 L 710 320 L 710 940 L 290 940 L 290 320 ' +
      'L 200 360 L 140 210 L 290 150 Z M 380 90 Q 500 130 620 90',
    printArea: { x: 0.24, y: 0.24, w: 0.52, h: 0.55 },
  },
  {
    id: 'jacket_front',
    garmentType: 'jacket',
    view: 'front',
    label: 'Jacket — Front',
    path:
      'M 320 110 L 480 70 L 500 100 L 520 70 L 680 110 L 730 160 L 880 230 L 810 390 L 720 340 ' +
      'L 720 940 L 500 940 L 500 500 L 280 940 L 280 340 L 190 390 L 120 230 L 270 160 Z ' +
      'M 500 100 L 500 940',
    printArea: { x: 0.55, y: 0.34, w: 0.22, h: 0.3 },
  },
  {
    id: 'jacket_back',
    garmentType: 'jacket',
    view: 'back',
    label: 'Jacket — Back',
    path:
      'M 320 110 L 480 70 L 500 100 L 520 70 L 680 110 L 730 160 L 880 230 L 810 390 L 720 340 ' +
      'L 720 940 L 280 940 L 280 340 L 190 390 L 120 230 L 270 160 Z',
    printArea: { x: 0.24, y: 0.26, w: 0.52, h: 0.5 },
  },
  {
    id: 'pants_front',
    garmentType: 'sweatpants',
    view: 'front',
    label: 'Sweatpants — Front',
    path:
      'M 320 60 L 680 60 L 700 300 L 780 920 L 600 920 L 520 420 L 500 420 L 480 920 L 300 920 L 380 300 Z ' +
      'M 320 60 L 320 160 L 680 160 L 680 60',
    printArea: { x: 0.35, y: 0.08, w: 0.3, h: 0.16 },
  },
  {
    id: 'pants_back',
    garmentType: 'sweatpants',
    view: 'back',
    label: 'Sweatpants — Back',
    path:
      'M 320 60 L 680 60 L 700 300 L 780 920 L 600 920 L 520 420 L 500 420 L 480 920 L 300 920 L 380 300 Z',
    printArea: { x: 0.3, y: 0.2, w: 0.4, h: 0.3 },
  },
];

export function getGarmentTemplates(garmentType: GarmentType): GarmentTemplateDef[] {
  return GARMENT_TEMPLATES.filter(t => t.garmentType === garmentType);
}

export function getGarmentTemplate(garmentType: GarmentType, view: GarmentView): GarmentTemplateDef | undefined {
  return GARMENT_TEMPLATES.find(t => t.garmentType === garmentType && t.view === view);
}

/**
 * scaleTemplatePath — rewrites every numeric pair in an M/L/Q/Z path string by a
 * uniform scale + offset. Drawing-layer paths in this app are stored in ABSOLUTE
 * canvas-pixel coordinates (see renderLayerInSvg in design-canvas.tsx — the layer
 * transform's x/y is NOT used as a translate for drawing layers), so template
 * paths must be baked into canvas space at build time rather than positioned via
 * the layer transform.
 */
export function scaleTemplatePath(d: string, scale: number, offsetX: number, offsetY: number): string {
  // Matches a command letter (M/L/Q/Z, case-insensitive) followed by any number
  // of numeric tokens, so we can remap coordinate pairs while preserving command
  // structure (Q has 2 coordinate pairs, M/L have 1, Z has none).
  return d.replace(/([MLQZ])([^MLQZ]*)/gi, (_match, cmd: string, nums: string) => {
    if (cmd.toUpperCase() === 'Z') return cmd;
    const values = nums.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const scaled: number[] = [];
    for (let i = 0; i < values.length; i += 2) {
      scaled.push(values[i] * scale + offsetX, values[i + 1] * scale + offsetY);
    }
    return `${cmd} ${scaled.map(v => v.toFixed(2)).join(' ')}`;
  });
}

/**
 * buildGarmentTemplateLayer — creates a locked, non-exportable guide DesignLayer
 * for the given template, scaled to fill (contain) a canvasWidth x canvasHeight box.
 * Always inserted at order 0 (bottom of stack) by the caller.
 */
export function buildGarmentTemplateLayer(
  def: GarmentTemplateDef,
  canvasWidth: number,
  canvasHeight: number,
  strokeColor = '#9AA0A6',
): DesignLayer {
  const now = new Date().toISOString();
  const scale = (Math.min(canvasWidth, canvasHeight) * 0.9) / 1000;
  const offsetX = (canvasWidth - 1000 * scale) / 2;
  const offsetY = (canvasHeight - 1000 * scale) / 2;
  const scaledPath = scaleTemplatePath(def.path, scale, offsetX, offsetY);
  return {
    id: `template_${def.id}_${Date.now()}`,
    name: def.label,
    type: 'drawing',
    visible: true,
    locked: true,
    isTemplate: true,
    order: 0,
    opacity: 0.5,
    transform: {
      x: 0, y: 0, width: canvasWidth, height: canvasHeight,
      rotation: 0, scaleX: 1, scaleY: 1,
    },
    data: {
      kind: 'drawing',
      brushType: 'guide',
      paths: [{ d: scaledPath, color: strokeColor, width: 3, opacity: 1, tool: 'guide' }],
    },
    createdAt: now,
    updatedAt: now,
  };
}
