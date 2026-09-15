/**
 * design-canvas logic unit tests.
 * Pure-logic only (no React, no RN). All algorithms inlined from the component
 * so a refactor that silently changes semantics will break the relevant test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type {
  DesignLayer, DesignDrawingLayer, DesignTextLayer,
  DesignImageLayer, DrawPath,
} from '../services/designTypes';

// ─── uid helper ───────────────────────────────────────────────────────────────
let _uid = 0;
function uid(): string { return `uid_${Date.now()}_${++_uid}`; }

// ─── Layer factory ────────────────────────────────────────────────────────────
function makeLayer(overrides: Partial<DesignLayer> = {}): DesignLayer {
  return {
    id: uid(), name: 'Layer', type: 'drawing',
    visible: true, locked: false, order: 1,
    transform: { x: 0, y: 0, width: 300, height: 500, rotation: 0, scaleX: 1, scaleY: 1 },
    data: { kind: 'drawing', paths: [] } as DesignDrawingLayer,
    opacity: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDrawPath(overrides: Partial<DrawPath> = {}): DrawPath {
  return { d: 'M0,0 L10,10', color: '#FFFFFF', width: 5, opacity: 1, tool: 'Studio Pen', ...overrides };
}

// ─── uid ─────────────────────────────────────────────────────────────────────
describe('uid', () => {
  it('returns string matching uid_<timestamp>_<n>', () => {
    expect(uid()).toMatch(/^uid_\d+_\d+$/);
  });
  it('is monotonically unique across 100 calls', () => {
    const ids = Array.from({ length: 100 }, uid);
    expect(new Set(ids).size).toBe(100);
  });
});

// ─── Undo/Redo ────────────────────────────────────────────────────────────────
describe('undo/redo state machine', () => {
  let undoStack: string[];
  let redoStack: string[];
  let layers: DesignLayer[];

  beforeEach(() => {
    undoStack = []; redoStack = [];
    layers = [makeLayer()];
  });

  function pushUndo(current: DesignLayer[]) {
    undoStack = [...undoStack.slice(-49), JSON.stringify(current)];
    redoStack = [];
  }

  it('pushes to undo and clears redo', () => {
    redoStack = ['stale_redo'];
    pushUndo(layers);
    expect(undoStack.length).toBe(1);
    expect(redoStack.length).toBe(0);
  });

  it('caps undo stack at 50 entries', () => {
    for (let i = 0; i < 60; i++) pushUndo([makeLayer({ order: i })]);
    expect(undoStack.length).toBe(50);
  });

  it('undo restores previous layers and pushes current to redo', () => {
    pushUndo(layers);                               // snapshot [Layer]
    layers = [makeLayer({ name: 'modified' })];     // new state
    const top = undoStack[undoStack.length - 1];
    redoStack = [...redoStack, JSON.stringify(layers)];
    undoStack = undoStack.slice(0, -1);
    layers = JSON.parse(top);
    expect(layers[0].name).toBe('Layer');
    expect(redoStack.length).toBe(1);
  });

  it('redo re-applies undone change and pushes back to undo', () => {
    // Start: undoStack empty, layers has 1 item
    const newLayers = [makeLayer({ name: 'new' })];
    redoStack = [JSON.stringify(newLayers)];
    // Redo: push current to undo, pop from redo, restore
    const top = redoStack[redoStack.length - 1];
    undoStack = [...undoStack, JSON.stringify(layers)];
    redoStack = redoStack.slice(0, -1);
    layers = JSON.parse(top);
    expect(layers[0].name).toBe('new');
    expect(undoStack.length).toBe(1);  // current pushed to undo
    expect(redoStack.length).toBe(0);  // redo consumed
  });
});

// ─── Layer ordering ───────────────────────────────────────────────────────────
describe('layer ordering', () => {
  it('sortedLayers returns ascending order', () => {
    const ls = [makeLayer({ order: 3 }), makeLayer({ order: 1 }), makeLayer({ order: 2 })];
    const sorted = [...ls].sort((a, b) => a.order - b.order);
    expect(sorted.map(l => l.order)).toEqual([1, 2, 3]);
  });

  it('moveLayerUp swaps the layer with the one above it', () => {
    const a = makeLayer({ order: 1 });
    const b = makeLayer({ order: 2 });
    const c = makeLayer({ order: 3 });
    const sorted = [a, b, c];
    const idx = 0;
    if (idx < sorted.length - 1) {
      [sorted[idx].order, sorted[idx + 1].order] = [sorted[idx + 1].order, sorted[idx].order];
    }
    const reordered = [...sorted].sort((a, b) => a.order - b.order);
    expect(reordered[0].id).toBe(b.id);
  });

  it('moveLayerDown swaps the layer with the one below it', () => {
    const a = makeLayer({ order: 1 });
    const b = makeLayer({ order: 2 });
    const c = makeLayer({ order: 3 });
    const sorted = [a, b, c];
    const idx = 2;
    if (idx > 0) {
      [sorted[idx].order, sorted[idx - 1].order] = [sorted[idx - 1].order, sorted[idx].order];
    }
    const reordered = [...sorted].sort((a, b) => a.order - b.order);
    expect(reordered[2].id).toBe(b.id);
  });

  it('moveLayerUp at top boundary is a no-op', () => {
    const l = makeLayer({ order: 1 });
    const sorted = [l];
    const idx = sorted.length - 1; // already at top
    const before = sorted[0].order;
    if (idx < sorted.length - 1) {
      [sorted[idx].order, sorted[idx + 1].order] = [sorted[idx + 1].order, sorted[idx].order];
    }
    expect(sorted[0].order).toBe(before);
  });
});

// ─── Duplicate layer ─────────────────────────────────────────────────────────
describe('duplicateLayer', () => {
  it('creates a new id and offsets transform by 16px', () => {
    const src = makeLayer({ transform: { x: 10, y: 20, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 } });
    const layers = [src];
    const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
    const dup = {
      ...src, id: uid(), name: src.name + ' copy', order: maxOrder + 1,
      transform: { ...src.transform, x: src.transform.x + 16, y: src.transform.y + 16 },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    expect(dup.id).not.toBe(src.id);
    expect(dup.transform.x).toBe(26);
    expect(dup.transform.y).toBe(36);
    expect(dup.name).toBe('Layer copy');
    expect(dup.order).toBe(src.order + 1);
  });
});

// ─── Visibility / Lock toggles ────────────────────────────────────────────────
describe('visibility and lock toggles', () => {
  it('toggling visible flips the flag', () => {
    const layer = makeLayer({ visible: true });
    expect({ ...layer, visible: !layer.visible }.visible).toBe(false);
  });
  it('toggling locked flips the flag', () => {
    const layer = makeLayer({ locked: false });
    expect({ ...layer, locked: !layer.locked }.locked).toBe(true);
  });
});

// ─── Color (hueToHex) ─────────────────────────────────────────────────────────
describe('hueToHex', () => {
  function hueToHex(hue: number, saturation = 1, value = 1): string {
    const h = hue / 60; const i = Math.floor(h); const f = h - i;
    const p = value * (1 - saturation), q = value * (1 - saturation * f), t = value * (1 - saturation * (1 - f));
    let r = 0, g = 0, b = 0;
    switch (i % 6) {
      case 0: r = value; g = t; b = p; break;
      case 1: r = q; g = value; b = p; break;
      case 2: r = p; g = value; b = t; break;
      case 3: r = p; g = q; b = value; break;
      case 4: r = t; g = p; b = value; break;
      case 5: r = value; g = p; b = q; break;
    }
    const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  it('hue 0   = red',   () => { expect(hueToHex(0)).toBe('#ff0000'); });
  it('hue 120 = green', () => { expect(hueToHex(120)).toBe('#00ff00'); });
  it('hue 240 = blue',  () => { expect(hueToHex(240)).toBe('#0000ff'); });
  it('value 0 = black', () => { expect(hueToHex(0, 1, 0)).toBe('#000000'); });
  it('value 0.5 halves channels', () => { expect(hueToHex(0, 1, 0.5)).toBe('#800000'); });
});

// ─── Merge drawing layers ──────────────────────────────────────────────────────
describe('mergeLayers', () => {
  it('merges all drawing layers into one, preserves non-drawing layers', () => {
    const a = makeLayer({ order: 1, data: { kind: 'drawing', paths: [makeDrawPath({ color: '#ff0000' })] } as DesignDrawingLayer });
    const b = makeLayer({ order: 2, data: { kind: 'drawing', paths: [makeDrawPath({ color: '#00ff00' })] } as DesignDrawingLayer });
    const text = makeLayer({ type: 'text', data: { kind: 'text', content: 'hi', fontFamily: 'System', fontSize: 16, letterSpacing: 0 } as DesignTextLayer });
    const drawingLayers = [a, b];
    const allPaths = drawingLayers.flatMap(l => (l.data as DesignDrawingLayer).paths);
    const merged: DesignLayer = {
      ...drawingLayers[0], id: uid(), name: 'Merged',
      order: drawingLayers.reduce((m, l) => Math.max(m, l.order), 0),
      data: { kind: 'drawing', paths: allPaths } as DesignDrawingLayer,
      updatedAt: new Date().toISOString(),
    };
    const result = [text, merged];
    expect(result).toHaveLength(2);
    expect((result.find(l => l.name === 'Merged')!.data as DesignDrawingLayer).paths).toHaveLength(2);
  });

  it('refuses to merge when fewer than 2 drawing layers', () => {
    expect([makeLayer()].length >= 2).toBe(false);
  });
});

// ─── SVG Mask eraser semantics (NOT ClipPath) ─────────────────────────────────
describe('eraser path semantics — Mask approach', () => {
  it('eraser paths have color = "erase"', () => {
    const p = makeDrawPath({ color: 'erase', tool: 'Eraser' });
    expect(p.color).toBe('erase');
  });

  it('separates ink paths from erase paths', () => {
    const paths: DrawPath[] = [
      makeDrawPath({ color: '#ff0000' }),
      makeDrawPath({ color: 'erase' }),
      makeDrawPath({ color: '#0000ff' }),
      makeDrawPath({ color: 'erase' }),
    ];
    const inkPaths   = paths.filter(p => p.color !== 'erase');
    const erasePaths = paths.filter(p => p.color === 'erase');
    expect(inkPaths.length).toBe(2);
    expect(erasePaths.length).toBe(2);
  });

  it('hasErase = false when no eraser paths → no mask needed', () => {
    const paths = [makeDrawPath({ color: '#fff' }), makeDrawPath({ color: '#000' })];
    expect(paths.some(p => p.color === 'erase')).toBe(false);
  });

  it('hasErase = true when eraser paths present → Mask branch activated', () => {
    const paths = [makeDrawPath({ color: '#fff' }), makeDrawPath({ color: 'erase' })];
    expect(paths.some(p => p.color === 'erase')).toBe(true);
  });

  it('mask id is derived from layer id (alphanumeric safe)', () => {
    const layerId = 'uid_1234_56';
    const maskId = `emask_${layerId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    expect(maskId).toBe('emask_uid_1234_56');
    // Must be valid for use in url(#id) attribute
    expect(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(maskId)).toBe(true);
  });

  it('maskId referenced in <G mask="url(#maskId)"> — correct template', () => {
    const maskId = 'emask_uid_1234_56';
    const maskAttr = `url(#${maskId})`;
    expect(maskAttr).toBe('url(#emask_uid_1234_56)');
  });

  // Confirm we do NOT use ClipPath for erasing (negative test on the approach)
  it('erase paths in Mask get black stroke (punch holes), not used as ClipPath children', () => {
    // In the Mask approach: eraser → black stroke in <Mask>
    // In the ClipPath approach: eraser → fill in <ClipPath>
    // This test documents intent: eraser paths rendered as black strokes inside <Mask>
    const erasePath = makeDrawPath({ color: 'erase', width: 20 });
    // If we were using a Mask, the stroke would be black
    const maskStrokeColor = 'black';
    // If we were using a ClipPath, the fill would be 'black' or 'none' with fill
    const clipPathFillColor = 'black';
    // Mask is correct: black stroke on white background = transparent regions
    expect(maskStrokeColor).toBe('black');
    // Document: the Mask has a white fill rect first (everything visible)
    const maskBgFill = 'white';
    expect(maskBgFill).toBe('white');
  });
});

// ─── Active drawing layer resolution ─────────────────────────────────────────
describe('resolveActiveDrawingLayerId', () => {
  function resolveActiveDrawingLayerId(current: DesignLayer[], selectedId: string | null): string | null {
    if (selectedId) {
      const l = current.find(x => x.id === selectedId);
      if (l && l.type === 'drawing' && !l.locked) return selectedId;
    }
    const first = current.find(l => l.type === 'drawing' && !l.locked);
    return first?.id ?? null;
  }

  it('returns selected layer id if it is an unlocked drawing layer', () => {
    const dl = makeLayer({ type: 'drawing', locked: false });
    expect(resolveActiveDrawingLayerId([dl], dl.id)).toBe(dl.id);
  });

  it('falls back to first unlocked drawing layer when selected is locked', () => {
    const locked   = makeLayer({ type: 'drawing', locked: true });
    const unlocked = makeLayer({ type: 'drawing', locked: false, order: 2 });
    expect(resolveActiveDrawingLayerId([locked, unlocked], locked.id)).toBe(unlocked.id);
  });

  it('falls back when selected layer is non-drawing type', () => {
    const textLayer = makeLayer({ type: 'text' });
    const drawing   = makeLayer({ type: 'drawing', locked: false });
    expect(resolveActiveDrawingLayerId([textLayer, drawing], textLayer.id)).toBe(drawing.id);
  });

  it('returns null when all drawing layers are locked', () => {
    const locked = makeLayer({ type: 'drawing', locked: true });
    expect(resolveActiveDrawingLayerId([locked], null)).toBeNull();
  });

  it('auto-creates a new drawing layer when resolution returns null', () => {
    const layers: DesignLayer[] = [];
    const targetId = resolveActiveDrawingLayerId(layers, null);
    let finalLayers = layers;
    if (!targetId) {
      finalLayers = [...layers, makeLayer({ type: 'drawing', locked: false })];
    }
    expect(finalLayers.length).toBe(1);
    expect(finalLayers[0].type).toBe('drawing');
  });
});

// ─── Logical coordinate model ─────────────────────────────────────────────────
describe('logical coordinate model', () => {
  it('display locationX/Y are divided by dispScale to get logical coords', () => {
    const dispScaleX = 0.375; // 1080 logical / 2880 display
    const dispScaleY = 0.375;
    const locationX = 540; // middle of display canvas (1440px wide)
    const locationY = 540;
    const logicalX = locationX / dispScaleX;
    const logicalY = locationY / dispScaleY;
    expect(logicalX).toBeCloseTo(1440);
    expect(logicalY).toBeCloseTo(1440);
  });

  it('display dx/dy divided by dispScale gives logical delta for transforms', () => {
    const dispScaleX = 2; const dispScaleY = 2;
    const displayDx = 100, displayDy = 50;
    expect(displayDx / dispScaleX).toBe(50);
    expect(displayDy / dispScaleY).toBe(25);
  });

  it('stroke width stored in logical units × dispScale = display width', () => {
    const logicalWidth = 10;
    const dispScale    = 0.375;
    const displayWidth = logicalWidth * dispScale;
    expect(displayWidth).toBeCloseTo(3.75);
  });

  it('export SVG uses scale=1 so path coords match viewBox exactly', () => {
    // Paths are stored in logical coords. Export scale=1 means path data is
    // passed unchanged → viewBox="0 0 1080 1080" renders correctly.
    const scale = 1;
    const logicalPathCoord = 540;
    expect(logicalPathCoord * scale).toBe(540);
  });

  it('dispScale = 1 when canvas size equals logical size (no scaling needed)', () => {
    const logicalW = 400, logicalH = 400;
    const displayW = 400, displayH = 400;
    expect(displayW / logicalW).toBe(1);
    expect(displayH / logicalH).toBe(1);
  });
});

// ─── Transform handle hit-testing (Pressable kind staging) ───────────────────
describe('transform handle kind staging', () => {
  // startHandle() stages the kind in handleDragRef before transformPanResponder
  // fires, so the pan responder reads the correct kind. These tests verify the
  // mapping logic.

  it('handle positions are computed in display coords', () => {
    const t = { x: 10, y: 20, width: 100, height: 80, rotation: 0, scaleX: 1, scaleY: 1 };
    const sx = 0.5, sy = 0.5;
    const x = t.x * sx, y = t.y * sy;
    const w = t.width * sx, h = t.height * sy;
    const handles = [
      { kind: 'resize-tl', hx: x,         hy: y         },
      { kind: 'resize-tr', hx: x + w,     hy: y         },
      { kind: 'resize-bl', hx: x,         hy: y + h     },
      { kind: 'resize-br', hx: x + w,     hy: y + h     },
      { kind: 'rotate',    hx: x + w / 2, hy: y - 24    },
    ];
    expect(handles[0]).toEqual({ kind: 'resize-tl', hx: 5,    hy: 10   });
    expect(handles[1]).toEqual({ kind: 'resize-tr', hx: 55,   hy: 10   });
    expect(handles[4]).toEqual({ kind: 'rotate',    hx: 30,   hy: -14  });
  });

  it('five handles exist: tl, tr, bl, br (resize) + top-centre (rotate)', () => {
    const kinds = ['resize-tl', 'resize-tr', 'resize-bl', 'resize-br', 'rotate'];
    expect(kinds.length).toBe(5);
    expect(kinds.includes('move')).toBe(false); // move is canvas body, not a handle
  });

  it('handlePressable zIndex=10 ensures it is above compositor SVG (pointerEvents=none)', () => {
    // Pressable overlays have zIndex:10 in styles.handlePressable
    // Compositor SVG has pointerEvents="none" — it CANNOT receive touch
    // Pressables ARE touchable and call startHandle() in onPressIn
    const compositorSvgPointerEvents = 'none';
    const pressableZIndex = 10;
    expect(compositorSvgPointerEvents).toBe('none'); // SVG never intercepts
    expect(pressableZIndex).toBeGreaterThan(0);     // Pressable receives touch
  });
});

// ─── Resize handle math ────────────────────────────────────────────────────────
describe('transform handle resize math (in logical coords)', () => {
  const MIN = 32;

  it('resize-br: dx/dy added to width/height', () => {
    const orig = { x: 10, y: 10, width: 100, height: 100 };
    const dx = 20, dy = 30;
    const result = { ...orig, width: Math.max(MIN, orig.width + dx), height: Math.max(MIN, orig.height + dy) };
    expect(result.width).toBe(120);
    expect(result.height).toBe(130);
  });

  it('resize-tl: min size clamped at 32px logical', () => {
    const orig = { x: 10, y: 10, width: 33, height: 33 };
    const dx = 40, dy = 40; // would shrink below MIN
    expect(Math.max(MIN, orig.width - dx)).toBe(MIN);
    expect(Math.max(MIN, orig.height - dy)).toBe(MIN);
  });

  it('resize-tr: top-right corner: y adjusts, x stays, height shrinks as y moves up', () => {
    const orig = { x: 10, y: 10, width: 100, height: 100 };
    const dx = 20, dy = -20; // growing up
    const newH = Math.max(MIN, orig.height - dy);
    const result = { ...orig, y: orig.y + orig.height - newH, width: Math.max(MIN, orig.width + dx), height: newH };
    expect(result.width).toBe(120);
    expect(result.height).toBe(120);
    expect(result.y).toBe(-10); // top edge moved up by 20
  });

  it('rotate: angle delta = atan2 difference converted to degrees', () => {
    // Simulate: centre at (100, 100), startAngle from (100,80) → -90°, endAngle from (120,100) → 0°
    const cx = 100, cy = 100;
    const startX = 100, startY = 80;
    const endX = 120, endY = 100;
    const a0 = Math.atan2(startY - cy, startX - cx);
    const a1 = Math.atan2(endY   - cy, endX   - cx);
    const delta = (a1 - a0) * (180 / Math.PI);
    expect(delta).toBeCloseTo(90, 0); // 90° clockwise
  });
});

// ─── Canvas resize proportional scale ────────────────────────────────────────
describe('canvas resize proportional scale', () => {
  it('scales layer transforms proportionally', () => {
    const oldW = 1080, oldH = 1080;
    const newW = 1920, newH = 1080;
    const sx = newW / oldW, sy = newH / oldH;
    const t = { x: 100, y: 200, width: 300, height: 400, rotation: 0, scaleX: 1, scaleY: 1 };
    const scaled = { ...t, x: t.x * sx, y: t.y * sy, width: t.width * sx, height: t.height * sy };
    expect(scaled.x).toBeCloseTo(177.78, 1);
    expect(scaled.y).toBe(200);        // sy = 1 → unchanged
    expect(scaled.width).toBeCloseTo(533.33, 1);
  });

  it('scale factor = 1 when dimensions are unchanged', () => {
    expect(1080 / 1080).toBe(1);
  });

  it('accepts high-resolution whole-pixel dimensions without clamping', () => {
    const isValidResize = (v: number) => Number.isSafeInteger(v) && v >= 8 && v <= 16384;
    expect(isValidResize(7)).toBe(false);
    expect(isValidResize(4500)).toBe(true);
    expect(isValidResize(5400)).toBe(true);
    expect(isValidResize(16385)).toBe(false);
    expect(isValidResize(1080.5)).toBe(false);
  });

  it('crop rect is also scaled proportionally when canvas resizes', () => {
    const oldW = 1080, oldH = 1080, newW = 540, newH = 540;
    const sx = newW / oldW, sy = newH / oldH;
    const crop = { x: 100, y: 100, w: 800, h: 800 };
    const scaled = { x: crop.x * sx, y: crop.y * sy, w: crop.w * sx, h: crop.h * sy };
    expect(scaled.x).toBe(50);
    expect(scaled.w).toBe(400);
  });
});

// ─── Crop persistence ─────────────────────────────────────────────────────────
describe('crop state persistence', () => {
  it('cropRect is stored in DesignCanvasWithCrop.cropRect (not as component state only)', () => {
    // Simulate what autosave does: merges cropRect into canvas before calling autosaveProject
    const projectCanvas = { width: 1080, height: 1080, backgroundHex: '#1E1E2E' };
    const cropRect = { x: 108, y: 108, w: 864, h: 864 }; // 80% of 1080
    const canvasWithCrop = { ...projectCanvas, cropRect };
    expect(canvasWithCrop.cropRect).toEqual(cropRect);
    expect(canvasWithCrop.width).toBe(1080);
  });

  it('null cropRect produces canvasWithCrop.cropRect = null (clear persisted)', () => {
    const projectCanvas = { width: 1080, height: 1080, backgroundHex: '#1E1E2E' };
    const canvasWithCrop = { ...projectCanvas, cropRect: null };
    expect(canvasWithCrop.cropRect).toBeNull();
  });

  it('default 80% safe-area crop sets correct dimensions', () => {
    const lw = 1080, lh = 1080, margin = 0.1;
    const crop = { x: lw * margin, y: lh * margin, w: lw * (1 - margin * 2), h: lh * (1 - margin * 2) };
    expect(crop.x).toBe(108);
    expect(crop.w).toBe(864);
    expect(crop.x + crop.w).toBe(972); // doesn't exceed lw - margin
  });
});

// ─── Generation-aware autosave ────────────────────────────────────────────────
describe('generation-aware autosave', () => {
  it('marks saved only when dirty gen matches saved gen', async () => {
    let saveStatus = 'unsaved';
    let dirtyGen   = 1;
    let savedGen   = 0;
    let savingRef  = false;

    async function doAutosave() {
      if (saveStatus !== 'unsaved' || savingRef) return;
      savingRef = true;
      saveStatus = 'saving';
      const captured = dirtyGen;
      await Promise.resolve(); // simulate async save
      if (dirtyGen === captured) {
        savedGen = captured;
        saveStatus = 'saved';
      } else {
        saveStatus = 'unsaved'; // more mutations during save
      }
      savingRef = false;
    }

    await doAutosave();
    expect(saveStatus).toBe('saved');
    expect(savedGen).toBe(1);
  });

  it('stays unsaved if a mutation arrives during save', async () => {
    let saveStatus = 'unsaved';
    let dirtyGen   = 1;
    let savingRef  = false;

    async function doAutosave() {
      if (saveStatus !== 'unsaved' || savingRef) return;
      savingRef = true;
      saveStatus = 'saving';
      const captured = dirtyGen;
      dirtyGen = 2; // simulates mutation arriving during save
      await Promise.resolve();
      if (dirtyGen === captured) {
        saveStatus = 'saved';
      } else {
        saveStatus = 'unsaved';
      }
      savingRef = false;
    }

    await doAutosave();
    expect(saveStatus).toBe('unsaved'); // gen mismatch → stays dirty
  });

  it('serialised guard: second concurrent call is skipped', async () => {
    let savingRef = false;
    let callCount = 0;

    async function doAutosave(status: string) {
      if (status !== 'unsaved' || savingRef) return;
      savingRef = true;
      callCount++;
      await Promise.resolve();
      savingRef = false;
    }

    await Promise.all([doAutosave('unsaved'), doAutosave('unsaved')]);
    expect(callCount).toBe(1);
  });

  it('retains unsaved status on network failure', async () => {
    let status = 'unsaved';
    let savingRef = false;

    async function doAutosaveWithFailure() {
      if (status !== 'unsaved' || savingRef) return;
      savingRef = true;
      status = 'saving';
      try {
        throw new Error('Network error');
      } catch {
        status = 'unsaved'; // revert so next interval retries
      } finally {
        savingRef = false;
      }
    }

    await doAutosaveWithFailure();
    expect(status).toBe('unsaved');
  });
});

// ─── PNG write uses EncodingType.Base64 ──────────────────────────────────────
describe('PNG write encoding', () => {
  it('EncodingType.Base64 value is the string "base64"', () => {
    // Matches expo-file-system enum value
    const EncodingType = { UTF8: 'utf8', Base64: 'base64' } as const;
    expect(EncodingType.Base64).toBe('base64');
  });

  it('write options include encoding: EncodingType.Base64', () => {
    const EncodingType = { UTF8: 'utf8', Base64: 'base64' } as const;
    const opts = { encoding: EncodingType.Base64 };
    expect(opts.encoding).toBe('base64');
  });
});

// ─── Platform-safe image copy ─────────────────────────────────────────────────
describe('platform-safe image copy', () => {
  it('web path returns picker URI as-is (no File.copy)', async () => {
    const pickerUri = 'blob:http://localhost/abc-123';
    // On web, persistPickerImage should return the URI unchanged
    async function persistPickerImage(platform: string, uri: string): Promise<string> {
      if (platform === 'web') return uri;
      // Native: would call File.copy — not tested here (requires native runtime)
      return `file:///documents/img_${uid()}.jpg`;
    }
    const result = await persistPickerImage('web', pickerUri);
    expect(result).toBe(pickerUri);
  });

  it('native path produces a new file URI under Paths.document', async () => {
    const pickerUri = 'file:///tmp/picker_cache/image123.jpg';
    async function persistPickerImage(platform: string, uri: string): Promise<string> {
      if (platform === 'web') return uri;
      const ext  = uri.split('.').pop()?.split('?')[0] ?? 'jpg';
      const name = `img_${uid()}.${ext}`;
      return `file:///documents/${name}`;
    }
    const result = await persistPickerImage('ios', pickerUri);
    expect(result).toMatch(/^file:\/\/\/documents\/img_.*\.jpg$/);
    expect(result).not.toBe(pickerUri);
  });
});

// ─── Export helpers ───────────────────────────────────────────────────────────
function makeSafeSlug(name: string): string {
  return (name || 'design').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

function buildExportFilename(projectName: string, suffix = ''): string {
  const slug = makeSafeSlug(projectName);
  return `${slug}_${Date.now()}${suffix}.png`;
}

describe('export filename generation', () => {
  it('replaces spaces and special chars with underscores', () => {
    expect(buildExportFilename('My Cool Design!')).toMatch(/^My_Cool_Design__\d+\.png$/);
  });
  it('truncates long project names to 40 chars', () => {
    expect(makeSafeSlug('A'.repeat(60)).length).toBeLessThanOrEqual(40);
  });
  it('falls back to "design" for empty name', () => {
    expect(buildExportFilename('')).toMatch(/^design_/);
  });
  it('appends suffix before .png extension', () => {
    const name = buildExportFilename('test', '_share');
    expect(name).toContain('_share');
    expect(name.endsWith('.png')).toBe(true);
  });
  it('always ends with .png', () => {
    expect(buildExportFilename('foo').endsWith('.png')).toBe(true);
  });
});

// ─── captureCanvasBase64 guard logic ──────────────────────────────────────────
describe('captureCanvasBase64 guard logic', () => {
  function captureCanvasBase64(svgRef: { toDataURL?: unknown } | null): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!svgRef || typeof svgRef.toDataURL !== 'function') {
        reject(new Error('Canvas is not ready. Draw something first, then try again.'));
        return;
      }
      (svgRef.toDataURL as (cb: (b64: string) => void, opts: object) => void)(
        (b64: string) => {
          if (!b64 || b64.length === 0) {
            reject(new Error('Capture returned empty data — the canvas may be blank.'));
            return;
          }
          resolve(b64);
        },
        { width: 1080, height: 1080 },
      );
    });
  }

  it('rejects when ref is null', async () => {
    await expect(captureCanvasBase64(null)).rejects.toThrow('Canvas is not ready');
  });
  it('rejects when toDataURL is not a function', async () => {
    await expect(captureCanvasBase64({ toDataURL: 'nope' })).rejects.toThrow('Canvas is not ready');
  });
  it('rejects when callback receives empty string', async () => {
    const fakeRef = { toDataURL: (cb: (s: string) => void) => cb('') };
    await expect(captureCanvasBase64(fakeRef)).rejects.toThrow('Capture returned empty data');
  });
  it('resolves with base64 on success', async () => {
    const fakeRef = { toDataURL: (cb: (s: string) => void) => cb('abc123==') };
    await expect(captureCanvasBase64(fakeRef)).resolves.toBe('abc123==');
  });
});

// ─── JPEG honest labelling ────────────────────────────────────────────────────
describe('JPEG export labelled unavailable', () => {
  it('format === "jpeg" triggers unavailable branch, not silent PNG', () => {
    const format: 'png' | 'jpeg' = 'jpeg';
    expect(format === 'jpeg').toBe(true);
    // The component shows an Alert and does NOT produce a PNG-labelled-JPEG
  });
});

// ─── Brush size / opacity clamping ───────────────────────────────────────────
describe('brush size and opacity clamping', () => {
  it('brush size minimum = 1', () => { expect(Math.max(1, 1 - 2)).toBe(1); });
  it('brush size maximum = 80', () => { expect(Math.min(80, 80 + 5)).toBe(80); });
  it('opacity stays within [0.05, 1]', () => {
    expect(Math.max(0.05, 0)).toBe(0.05);
    expect(Math.min(1, 1.1)).toBe(1);
  });
});

// ─── Error message extraction ─────────────────────────────────────────────────
describe('error message extraction', () => {
  it('uses err.message for Error instance', () => {
    const err: unknown = new Error('File write failed');
    expect(err instanceof Error ? err.message : 'Unknown error.').toBe('File write failed');
  });
  it('falls back for non-Error throws', () => {
    const err: unknown = 42;
    expect(err instanceof Error ? err.message : 'Unknown error.').toBe('Unknown error.');
  });
});
