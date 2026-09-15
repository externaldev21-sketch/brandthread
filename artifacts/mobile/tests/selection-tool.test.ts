/**
 * selection-tool.test.ts — Tests for the selectionModel and selection tool geometry.
 *
 * Tests cover:
 *   - rectFromPoints normalisation
 *   - pointInRect, pointInEllipse, pointInPolygon
 *   - polygonBounds
 *   - hitTestLayers / automaticSelection
 *   - marchingAntsOffset (deterministic timing; excluded from export via offset)
 *   - lassoPathD (freehand path generation)
 *   - drawingLayerPathsInSelection
 */
import { describe, it, expect } from 'vitest';
import {
  rectFromPoints,
  pointInRect,
  pointInEllipse,
  pointInPolygon,
  polygonBounds,
  automaticSelection,
  hitTestLayers,
  marchingAntsOffset,
  lassoPathD,
  pointInSelection,
  ANTS_DASH_PATTERN,
  drawingLayerPathsInSelection,
} from '../lib/selectionModel';
import type { DesignLayer } from '../services/designTypes';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeLayer(overrides: Partial<DesignLayer> = {}): DesignLayer {
  return {
    id: 'l1',
    name: 'Layer',
    type: 'drawing',
    visible: true,
    locked: false,
    order: 0,
    transform: { x: 100, y: 100, width: 200, height: 150, rotation: 0, scaleX: 1, scaleY: 1 },
    data: { kind: 'drawing', paths: [], blendMode: 'normal' } as any,
    opacity: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── rectFromPoints ───────────────────────────────────────────────────────────

describe('rectFromPoints', () => {
  it('normalises when p2 > p1', () => {
    const r = rectFromPoints({ x: 10, y: 20 }, { x: 60, y: 80 });
    expect(r).toEqual({ x: 10, y: 20, w: 50, h: 60 });
  });

  it('normalises when p2 < p1 (drag up-left)', () => {
    const r = rectFromPoints({ x: 60, y: 80 }, { x: 10, y: 20 });
    expect(r).toEqual({ x: 10, y: 20, w: 50, h: 60 });
  });

  it('handles zero area', () => {
    const r = rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 });
    expect(r).toEqual({ x: 5, y: 5, w: 0, h: 0 });
  });
});

// ─── pointInRect ─────────────────────────────────────────────────────────────

describe('pointInRect', () => {
  const rect = { x: 0, y: 0, w: 100, h: 100 };

  it('contains interior point', () => {
    expect(pointInRect({ x: 50, y: 50 }, rect)).toBe(true);
  });

  it('contains boundary point', () => {
    expect(pointInRect({ x: 0, y: 0 }, rect)).toBe(true);
    expect(pointInRect({ x: 100, y: 100 }, rect)).toBe(true);
  });

  it('rejects point outside', () => {
    expect(pointInRect({ x: 101, y: 50 }, rect)).toBe(false);
    expect(pointInRect({ x: -1, y: 50 }, rect)).toBe(false);
  });
});

// ─── pointInEllipse ──────────────────────────────────────────────────────────

describe('pointInEllipse', () => {
  const rect = { x: 0, y: 0, w: 100, h: 100 };

  it('contains centre', () => {
    expect(pointInEllipse({ x: 50, y: 50 }, rect)).toBe(true);
  });

  it('rejects corner (outside ellipse but inside bounding box)', () => {
    expect(pointInEllipse({ x: 1, y: 1 }, rect)).toBe(false);
  });

  it('rejects point outside bounding box', () => {
    expect(pointInEllipse({ x: 200, y: 50 }, rect)).toBe(false);
  });
});

// ─── pointInPolygon ──────────────────────────────────────────────────────────

describe('pointInPolygon', () => {
  // Triangle
  const tri = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];

  it('contains interior point', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, tri)).toBe(true);
  });

  it('rejects exterior point', () => {
    expect(pointInPolygon({ x: 0, y: 100 }, tri)).toBe(false);
  });

  it('returns false for degenerate polygon', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 1, y: 1 }])).toBe(false);
  });
});

// ─── polygonBounds ────────────────────────────────────────────────────────────

describe('polygonBounds', () => {
  it('returns tight bounding box', () => {
    const pts = [{ x: 10, y: 5 }, { x: 40, y: 80 }, { x: 25, y: 30 }];
    const b = polygonBounds(pts);
    expect(b.x).toBe(10);
    expect(b.y).toBe(5);
    expect(b.w).toBe(30);
    expect(b.h).toBe(75);
  });

  it('returns zero rect for single point', () => {
    const b = polygonBounds([{ x: 7, y: 7 }]);
    expect(b.w).toBe(0);
    expect(b.h).toBe(0);
  });
});

// ─── hitTestLayers ────────────────────────────────────────────────────────────

describe('hitTestLayers', () => {
  it('returns topmost visible layer whose bounds contain the point', () => {
    const layers: DesignLayer[] = [
      makeLayer({ id: 'a', order: 0, transform: { x: 0, y: 0, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1 } }),
      makeLayer({ id: 'b', order: 1, transform: { x: 50, y: 50, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 } }),
    ];
    // point at (75, 75) is inside both; should pick 'b' (higher order)
    const result = hitTestLayers({ x: 75, y: 75 }, layers);
    expect(result?.id).toBe('b');
  });

  it('skips invisible layers', () => {
    const layers: DesignLayer[] = [
      makeLayer({ id: 'a', order: 1, visible: true,  transform: { x: 0, y: 0, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1 } }),
      makeLayer({ id: 'b', order: 2, visible: false, transform: { x: 0, y: 0, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1 } }),
    ];
    const result = hitTestLayers({ x: 50, y: 50 }, layers);
    expect(result?.id).toBe('a');
  });

  it('returns null when no layer contains the point', () => {
    const layers = [makeLayer({ transform: { x: 200, y: 200, width: 50, height: 50, rotation: 0, scaleX: 1, scaleY: 1 } })];
    const result = hitTestLayers({ x: 10, y: 10 }, layers);
    expect(result).toBeNull();
  });
});

// ─── automaticSelection ───────────────────────────────────────────────────────

describe('automaticSelection', () => {
  it('returns a region for a hit layer', () => {
    const layers = [makeLayer({ id: 'l1', transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 } })];
    const region = automaticSelection({ x: 50, y: 50 }, layers, 0);
    expect(region).not.toBeNull();
    expect(region?.kind).toBe('automatic');
    expect((region as any)?.layerId).toBe('l1');
  });

  it('returns null for a miss', () => {
    const layers = [makeLayer({ transform: { x: 200, y: 200, width: 50, height: 50, rotation: 0, scaleX: 1, scaleY: 1 } })];
    const region = automaticSelection({ x: 10, y: 10 }, layers, 0);
    expect(region).toBeNull();
  });
});

// ─── marchingAntsOffset ───────────────────────────────────────────────────────

describe('marchingAntsOffset', () => {
  it('returns 0 at tick 0', () => {
    expect(marchingAntsOffset(0)).toBe(0);
  });

  it('advances monotonically with time', () => {
    const a = marchingAntsOffset(100);
    const b = marchingAntsOffset(200);
    expect(b).toBeGreaterThan(a);
  });

  it('wraps within ANTS_DASH_PATTERN period', () => {
    const period = ANTS_DASH_PATTERN[0] + ANTS_DASH_PATTERN[1]; // 10
    const offset = marchingAntsOffset(10_000_000); // very large tick
    expect(offset).toBeLessThan(period + 1);
  });
});

// ─── lassoPathD ───────────────────────────────────────────────────────────────

describe('lassoPathD', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }];

  it('generates a valid SVG path string', () => {
    const d = lassoPathD(pts, 1, 1, false);
    expect(d).toBeTruthy();
    expect(d).toContain('M');
    expect(d).toContain('L');
  });

  it('closes path when closed=true', () => {
    const d = lassoPathD(pts, 1, 1, true);
    expect(d).toContain('Z');
  });

  it('does not close when closed=false', () => {
    const d = lassoPathD(pts, 1, 1, false);
    expect(d).not.toContain('Z');
  });

  it('returns empty/no-L-segments for fewer than 2 points', () => {
    expect(lassoPathD([], 1, 1, false)).toBeFalsy();
    // Single point: no L commands
    const d = lassoPathD([{ x: 0, y: 0 }], 1, 1, false);
    expect(d).not.toContain('L');
  });

  it('applies display scale', () => {
    const d1 = lassoPathD(pts, 1, 1, false);
    const d2 = lassoPathD(pts, 2, 2, false);
    expect(d2).not.toBe(d1);
    // With scale 2, coordinates should be doubled
    expect(d2).toContain('200');
  });
});

// ─── pointInSelection ────────────────────────────────────────────────────────

describe('pointInSelection', () => {
  it('rectangle region contains interior', () => {
    const region = { kind: 'rectangle' as const, rect: { x: 0, y: 0, w: 100, h: 100 }, feather: 0 };
    expect(pointInSelection({ x: 50, y: 50 }, region)).toBe(true);
  });

  it('ellipse region excludes corner', () => {
    const region = { kind: 'ellipse' as const, rect: { x: 0, y: 0, w: 100, h: 100 }, feather: 0 };
    expect(pointInSelection({ x: 2, y: 2 }, region)).toBe(false);
  });

  it('freehand closed region uses polygon test', () => {
    const region = {
      kind: 'freehand' as const,
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }],
      closed: true,
      feather: 0,
    };
    expect(pointInSelection({ x: 50, y: 40 }, region)).toBe(true);
    expect(pointInSelection({ x: 0, y: 99 }, region)).toBe(false);
  });
});

// ─── drawingLayerPathsInSelection ─────────────────────────────────────────────

describe('drawingLayerPathsInSelection', () => {
  it('returns empty for non-drawing layer', () => {
    const layer = makeLayer({ type: 'image', data: { kind: 'image', uri: '', opacity: 1, fit: 'contain', blendMode: 'normal' } as any });
    const region = { kind: 'rectangle' as const, rect: { x: 0, y: 0, w: 500, h: 500 }, feather: 0 };
    expect(drawingLayerPathsInSelection(layer, region)).toHaveLength(0);
  });

  it('returns paths whose points overlap with the region', () => {
    const layer = makeLayer({
      type: 'drawing',
      data: {
        kind: 'drawing',
        blendMode: 'normal',
        paths: [
          { d: 'M 10 10 L 20 20', color: '#000', width: 2, opacity: 1, linecap: 'round', blendMode: 'normal' },
          { d: 'M 500 500 L 600 600', color: '#fff', width: 2, opacity: 1, linecap: 'round', blendMode: 'normal' },
        ],
      } as any,
    });
    const region = { kind: 'rectangle' as const, rect: { x: 0, y: 0, w: 100, h: 100 }, feather: 0 };
    const result = drawingLayerPathsInSelection(layer, region);
    expect(result).toHaveLength(1);
    expect(result[0].color).toBe('#000');
  });
});

// ─── Composed interaction: lasso close sequence ───────────────────────────────

describe('composed interaction: lasso path close', () => {
  // lassoPathD(points, scaleX, scaleY, closed) — use scale=1 for logical coords
  function simulateLassoStroke(points: Array<{ x: number; y: number }>, close = true): string {
    // Simulate: onPanResponderGrant sets first point; onPanResponderMove appends;
    // onPanResponderRelease closes lasso by setting closed=true.
    if (points.length < 3) return ''; // not viable
    return lassoPathD(points, 1, 1, close);
  }

  it('fewer than 3 points returns empty string (lasso not viable)', () => {
    expect(simulateLassoStroke([])).toBe('');
    expect(simulateLassoStroke([{ x: 0, y: 0 }])).toBe('');
    expect(simulateLassoStroke([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe('');
  });

  it('triangle lasso forms valid closed M…L…L…Z path', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    const d = simulateLassoStroke(pts);
    expect(d).toContain('M');
    expect(d).toContain('L');
    expect(d.endsWith('Z')).toBe(true);
  });

  it('lasso path starts at first point (in logical coords with scale=1)', () => {
    const pts = [{ x: 10, y: 20 }, { x: 50, y: 70 }, { x: 80, y: 30 }];
    const d = simulateLassoStroke(pts);
    // lassoPathD emits "M10.0,20.0" format
    expect(d).toMatch(/^M10\.0,20\.0/);
  });

  it('open lasso does not end with Z', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    const d = lassoPathD(pts, 1, 1, false);
    expect(d.endsWith('Z')).toBe(false);
    expect(d).toContain('M');
    expect(d).toContain('L');
  });

  it('polygon bounds of lasso points cover all corners', () => {
    const pts = [{ x: 5, y: 10 }, { x: 95, y: 10 }, { x: 95, y: 90 }, { x: 5, y: 90 }];
    const bounds = polygonBounds(pts);
    expect(bounds.x).toBe(5);
    expect(bounds.y).toBe(10);
    expect(bounds.w).toBe(90);
    expect(bounds.h).toBe(80);
  });
});
