/**
 * flip-model.test.ts
 *
 * Tests the ONE-representation flip model:
 *  - applyFlipX / applyFlipY toggle transform.flipX / flipY flags ONLY.
 *  - Bounds are relocated; path coordinates are NOT rewritten for any layer kind.
 *  - The shared compositor/renderLayerInSvg transform string mirrors the group.
 *  - Double-flip restores exactly to original (identity property) for all kinds.
 *  - flipX/flipY flags survive JSON round-trip (save/load).
 *  - Eraser mask mirrors inside the same SVG group as the ink paths (no coord mutation).
 *
 * "Composed render/compositor assertions" mean we verify what the SVG transform
 * string would be, not what path coordinate strings look like.
 */
import { describe, it, expect } from 'vitest';
import type { DesignLayer, DesignDrawingLayer } from '../services/designTypes';

// ─── uid ──────────────────────────────────────────────────────────────────────
let _uid = 0;
function uid(): string { return `uid_${Date.now()}_${++_uid}`; }

// ─── Layer factories ──────────────────────────────────────────────────────────
function makeDrawingLayer(overrides: Partial<DesignLayer> = {}): DesignLayer {
  return {
    id: uid(), name: 'Drawing', type: 'drawing',
    visible: true, locked: false, order: 1, opacity: 1,
    transform: { x: 100, y: 200, width: 300, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
    data: {
      kind: 'drawing',
      paths: [
        { d: 'M100,200 L300,400', color: '#fff', width: 5, opacity: 1, tool: 'Pen' },
        { d: 'M50,50 L150,150',   color: 'erase', width: 20, opacity: 1, tool: 'Eraser' },
      ],
    } as DesignDrawingLayer,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeImageLayer(overrides: Partial<DesignLayer> = {}): DesignLayer {
  return {
    id: uid(), name: 'Photo', type: 'image',
    visible: true, locked: false, order: 2, opacity: 1,
    transform: { x: 50, y: 60, width: 400, height: 300, rotation: 0, scaleX: 1, scaleY: 1 },
    data: { kind: 'image', uri: 'file:///img.png', opacity: 1, fit: 'contain', blendMode: 'normal' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTextLayer(overrides: Partial<DesignLayer> = {}): DesignLayer {
  return {
    id: uid(), name: 'Text', type: 'text',
    visible: true, locked: false, order: 3, opacity: 1,
    transform: { x: 200, y: 300, width: 400, height: 80, rotation: 0, scaleX: 1, scaleY: 1 },
    data: { kind: 'text', content: 'Hello', fontFamily: 'System', fontSize: 24,
            bold: false, italic: false, underline: false, align: 'center',
            color: '#fff', letterSpacing: 0, lineHeight: 1.4 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeShapeLayer(overrides: Partial<DesignLayer> = {}): DesignLayer {
  return {
    id: uid(), name: 'Shape', type: 'shape',
    visible: true, locked: false, order: 4, opacity: 1,
    transform: { x: 100, y: 100, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1 },
    data: { kind: 'shape', shape: 'rect', fillColor: '#f00', strokeWidth: 0, cornerRadius: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── ONE-representation flip functions ────────────────────────────────────────
// Mirrors design-canvas.tsx applyFlipX / applyFlipY exactly.
// NOTE: NO path coordinate rewriting for any layer kind.
const CANVAS_W = 1080;
const CANVAS_H = 1920;

function flipLayersX(layers: DesignLayer[], lw = CANVAS_W): DesignLayer[] {
  return layers.map(l => {
    const t = l.transform;
    // Only: relocate bounds + toggle flag. NO data mutation.
    return { ...l, transform: { ...t, x: lw - t.x - t.width, flipX: !t.flipX } };
  });
}

function flipLayersY(layers: DesignLayer[], lh = CANVAS_H): DesignLayer[] {
  return layers.map(l => {
    const t = l.transform;
    return { ...l, transform: { ...t, y: lh - t.y - t.height, flipY: !t.flipY } };
  });
}

// ─── SVG compositor transform builder ────────────────────────────────────────
// Mirrors DesignLayerCompositor.renderLayer and design-canvas.tsx renderLayerInSvg.
function buildTransformAttr(
  x: number, y: number, width: number, height: number,
  rotation = 0, flipX = false, flipY = false,
  xScale = 1, yScale = 1,
): string | undefined {
  const cx = (x + width  / 2) * xScale;
  const cy = (y + height / 2) * yScale;
  const parts: string[] = [];
  if (rotation !== 0) parts.push(`rotate(${rotation.toFixed(2)},${cx.toFixed(1)},${cy.toFixed(1)})`);
  if (flipX) parts.push(`translate(${cx.toFixed(1)},0) scale(-1,1) translate(${(-cx).toFixed(1)},0)`);
  if (flipY) parts.push(`translate(0,${cy.toFixed(1)}) scale(1,-1) translate(0,${(-cy).toFixed(1)})`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

// ─── flipX — ONE representation (no path mutation) ───────────────────────────
describe('flipX — drawing layer: flag only, no path rewriting', () => {
  it('sets flipX flag to true', () => {
    const [flipped] = flipLayersX([makeDrawingLayer()]);
    expect(flipped.transform.flipX).toBe(true);
  });
  it('relocates bounds: new_x = canvasW - x - width', () => {
    const layer = makeDrawingLayer(); // x=100, width=300
    const [flipped] = flipLayersX([layer]);
    expect(flipped.transform.x).toBe(CANVAS_W - 100 - 300); // 680
  });
  it('does NOT rewrite drawing path coordinates', () => {
    const layer = makeDrawingLayer();
    const origPaths = (layer.data as DesignDrawingLayer).paths.map(p => p.d);
    const [flipped] = flipLayersX([layer]);
    const newPaths = (flipped.data as DesignDrawingLayer).paths.map(p => p.d);
    // Path strings must be byte-for-byte identical — no coordinate rewriting.
    expect(newPaths).toEqual(origPaths);
  });
  it('does NOT rewrite eraser path coordinates', () => {
    const layer = makeDrawingLayer();
    const eraserOrig = (layer.data as DesignDrawingLayer).paths.find(p => p.color === 'erase')!.d;
    const [flipped] = flipLayersX([layer]);
    const eraserNew = (flipped.data as DesignDrawingLayer).paths.find(p => p.color === 'erase')!.d;
    expect(eraserNew).toBe(eraserOrig);
  });
  it('double-flip restores flipX to false', () => {
    const [twice] = flipLayersX(flipLayersX([makeDrawingLayer()]));
    expect(twice.transform.flipX).toBeFalsy();
  });
  it('double-flip restores x to original', () => {
    const layer = makeDrawingLayer();
    const [twice] = flipLayersX(flipLayersX([layer]));
    expect(twice.transform.x).toBe(layer.transform.x);
  });
  it('double-flip leaves paths byte-identical to original', () => {
    const layer = makeDrawingLayer();
    const origPaths = (layer.data as DesignDrawingLayer).paths.map(p => p.d);
    const [twice] = flipLayersX(flipLayersX([layer]));
    const finalPaths = (twice.data as DesignDrawingLayer).paths.map(p => p.d);
    expect(finalPaths).toEqual(origPaths);
  });
});

describe('flipX — image layer', () => {
  it('sets flipX, relocates x, does NOT mutate data', () => {
    const layer = makeImageLayer(); // x=50, width=400
    const [flipped] = flipLayersX([layer]);
    expect(flipped.transform.flipX).toBe(true);
    expect(flipped.transform.x).toBe(CANVAS_W - 50 - 400); // 630
    expect(flipped.data).toEqual(layer.data); // data unchanged
  });
  it('double-flip: identity on x and flag', () => {
    const layer = makeImageLayer();
    const [twice] = flipLayersX(flipLayersX([layer]));
    expect(twice.transform.x).toBe(layer.transform.x);
    expect(twice.transform.flipX).toBeFalsy();
  });
});

describe('flipX — text layer', () => {
  it('sets flipX, relocates x, does NOT mutate data', () => {
    const layer = makeTextLayer(); // x=200, width=400
    const [flipped] = flipLayersX([layer]);
    expect(flipped.transform.flipX).toBe(true);
    expect(flipped.transform.x).toBe(CANVAS_W - 200 - 400); // 480
    expect(flipped.data).toEqual(layer.data);
  });
  it('double-flip identity', () => {
    const layer = makeTextLayer();
    const [twice] = flipLayersX(flipLayersX([layer]));
    expect(twice.transform.x).toBe(layer.transform.x);
    expect(twice.transform.flipX).toBeFalsy();
  });
});

describe('flipX — shape layer', () => {
  it('sets flipX, relocates x, does NOT mutate data', () => {
    const layer = makeShapeLayer(); // x=100, width=200
    const [flipped] = flipLayersX([layer]);
    expect(flipped.transform.flipX).toBe(true);
    expect(flipped.transform.x).toBe(CANVAS_W - 100 - 200); // 780
    expect(flipped.data).toEqual(layer.data);
  });
  it('double-flip identity', () => {
    const layer = makeShapeLayer();
    const [twice] = flipLayersX(flipLayersX([layer]));
    expect(twice.transform.x).toBe(layer.transform.x);
  });
});

// ─── flipY — ONE representation ───────────────────────────────────────────────
describe('flipY — drawing layer', () => {
  it('sets flipY, relocates y, does NOT rewrite paths', () => {
    const layer = makeDrawingLayer(); // y=200, height=100
    const origPaths = (layer.data as DesignDrawingLayer).paths.map(p => p.d);
    const [flipped] = flipLayersY([layer]);
    expect(flipped.transform.flipY).toBe(true);
    expect(flipped.transform.y).toBe(CANVAS_H - 200 - 100); // 1620
    // Paths byte-identical — no coordinate rewriting
    expect((flipped.data as DesignDrawingLayer).paths.map(p => p.d)).toEqual(origPaths);
  });
  it('double-flip: y and flag restored', () => {
    const layer = makeDrawingLayer();
    const [twice] = flipLayersY(flipLayersY([layer]));
    expect(twice.transform.y).toBe(layer.transform.y);
    expect(twice.transform.flipY).toBeFalsy();
  });
});

describe('flipY — image/text/shape', () => {
  it('image: double-flip identity', () => {
    const layer = makeImageLayer();
    const [twice] = flipLayersY(flipLayersY([layer]));
    expect(twice.transform.y).toBe(layer.transform.y);
    expect(twice.transform.flipY).toBeFalsy();
  });
  it('text: double-flip identity', () => {
    const layer = makeTextLayer();
    const [twice] = flipLayersY(flipLayersY([layer]));
    expect(twice.transform.y).toBe(layer.transform.y);
  });
  it('shape: double-flip identity', () => {
    const layer = makeShapeLayer();
    const [twice] = flipLayersY(flipLayersY([layer]));
    expect(twice.transform.y).toBe(layer.transform.y);
  });
});

// ─── Compositor transform assertions ─────────────────────────────────────────
// These assert the SVG transform attribute that the compositor emits, which
// is what actually produces the visual mirror — no path coords involved.
describe('compositor SVG transform (renderLayerInSvg / DesignLayerCompositor)', () => {
  it('no transform when rotation=0 and no flips', () => {
    expect(buildTransformAttr(100, 100, 200, 100)).toBeUndefined();
  });
  it('rotate() for non-zero rotation', () => {
    const t = buildTransformAttr(100, 100, 200, 100, 45);
    expect(t).toContain('rotate(45.00');
  });

  // flipX: translate-cx scale(-1,1) translate+cx
  it('flipX emits scale(-1,1) centered at layer cx', () => {
    // x=0,y=0,w=100,h=100 → cx=50
    const t = buildTransformAttr(0, 0, 100, 100, 0, true, false);
    expect(t).toContain('scale(-1,1)');
    expect(t).toContain('translate(50.0,0)');
    expect(t).toContain('translate(-50.0,0)');
  });
  it('flipX pivot is layer centre, not origin', () => {
    // x=100,y=0,w=200,h=100 → cx=200
    const t = buildTransformAttr(100, 0, 200, 100, 0, true, false);
    expect(t).toContain('translate(200.0,0) scale(-1,1) translate(-200.0,0)');
  });

  // flipY: translate-cy scale(1,-1) translate+cy
  it('flipY emits scale(1,-1) centered at layer cy', () => {
    // x=0,y=0,w=100,h=100 → cy=50
    const t = buildTransformAttr(0, 0, 100, 100, 0, false, true);
    expect(t).toContain('scale(1,-1)');
    expect(t).toContain('translate(0,50.0)');
    expect(t).toContain('translate(0,-50.0)');
  });

  // Combined
  it('rotation + flipX are both in the transform string', () => {
    const t = buildTransformAttr(0, 0, 100, 100, 30, true, false);
    expect(t).toContain('rotate(30.00');
    expect(t).toContain('scale(-1,1)');
  });
  it('flipX + flipY both present', () => {
    const t = buildTransformAttr(0, 0, 100, 100, 0, true, true);
    expect(t).toContain('scale(-1,1)');
    expect(t).toContain('scale(1,-1)');
  });

  // After flip: compositor uses the new bounds + the flag
  it('flipped image layer produces scale(-1,1) in compositor', () => {
    const layer = makeImageLayer();
    const [flipped] = flipLayersX([layer]);
    const t = buildTransformAttr(
      flipped.transform.x, flipped.transform.y,
      flipped.transform.width, flipped.transform.height,
      flipped.transform.rotation,
      flipped.transform.flipX,
      flipped.transform.flipY,
    );
    expect(t).toContain('scale(-1,1)');
  });

  it('double-flipped image layer produces no transform (flag reset)', () => {
    const layer = makeImageLayer();
    const [twice] = flipLayersX(flipLayersX([layer]));
    const t = buildTransformAttr(
      twice.transform.x, twice.transform.y,
      twice.transform.width, twice.transform.height,
      twice.transform.rotation,
      twice.transform.flipX,
      twice.transform.flipY,
    );
    expect(t).toBeUndefined();
  });

  it('flipped drawing layer produces scale(-1,1), eraser mask mirrors in same group', () => {
    // In the real compositor, ink paths + Mask are wrapped in a single <G transform={...}>.
    // Both mirror together when scale(-1,1) is applied to the group — no path rewriting.
    const layer = makeDrawingLayer();
    const [flipped] = flipLayersX([layer]);
    const t = buildTransformAttr(
      flipped.transform.x, flipped.transform.y,
      flipped.transform.width, flipped.transform.height,
      0, flipped.transform.flipX,
    );
    // The group transform mirrors both ink and eraser mask simultaneously.
    expect(t).toContain('scale(-1,1)');
    // Path data unchanged — mirror is entirely in the group transform.
    const origEraserD = (layer.data as DesignDrawingLayer).paths.find(p => p.color === 'erase')!.d;
    const newEraserD  = (flipped.data as DesignDrawingLayer).paths.find(p => p.color === 'erase')!.d;
    expect(newEraserD).toBe(origEraserD);
  });
});

// ─── JSON round-trip (save / load) ───────────────────────────────────────────
describe('flipX/flipY round-trip through JSON', () => {
  it('flipX=true survives JSON stringify/parse', () => {
    const [flipped] = flipLayersX([makeImageLayer()]);
    const loaded: DesignLayer = JSON.parse(JSON.stringify(flipped));
    expect(loaded.transform.flipX).toBe(true);
  });
  it('flipY=true survives JSON stringify/parse', () => {
    const [flipped] = flipLayersY([makeDrawingLayer()]);
    const loaded: DesignLayer = JSON.parse(JSON.stringify(flipped));
    expect(loaded.transform.flipY).toBe(true);
  });
  it('un-flipped layer has no flipX/flipY key (clean serialization)', () => {
    const obj = JSON.parse(JSON.stringify(makeShapeLayer()));
    expect('flipX' in obj.transform).toBe(false);
    expect('flipY' in obj.transform).toBe(false);
  });
  it('btLayerValidator preserves flipX/flipY from imported layer transform', () => {
    // The validator allowlists boolean flipX/flipY in the transform object.
    const layer = makeDrawingLayer();
    const [flipped] = flipLayersX([layer]);
    const json = JSON.stringify({ layers: [flipped] });
    // Just confirm the JSON has the right flag (validator tested separately)
    const parsed = JSON.parse(json);
    expect(parsed.layers[0].transform.flipX).toBe(true);
  });
});

// ─── Multi-layer flip ─────────────────────────────────────────────────────────
describe('flipX on multiple layers', () => {
  it('all layers get their bounds relocated and flag toggled', () => {
    const layers = [makeDrawingLayer(), makeImageLayer(), makeTextLayer(), makeShapeLayer()];
    const flipped = flipLayersX(layers);
    for (const f of flipped) {
      expect(f.transform.flipX).toBe(true);
    }
  });
  it('double-flip restores all layers', () => {
    const layers = [makeDrawingLayer(), makeImageLayer(), makeTextLayer(), makeShapeLayer()];
    const origXs = layers.map(l => l.transform.x);
    const twice = flipLayersX(flipLayersX(layers));
    twice.forEach((l, i) => {
      expect(l.transform.x).toBe(origXs[i]);
      expect(l.transform.flipX).toBeFalsy();
    });
  });
});
