import { describe, expect, it } from 'vitest';
import {
  CanvasGestureModel, HOLD_MS, IDENTITY_VIEWPORT, applyPinch, stageToArtboard,
} from '@/lib/paint/canvasGestureModel';
import {
  addBrush, addSet, defaultBrushLibrary, deleteBrushPreset, deleteSet, duplicateBrushPreset, duplicateSet,
  normalizeBrushLibrary, renameSet,
} from '@/lib/paint/brushLibrary';

function recorder() {
  const log: string[] = [];
  const model = new CanvasGestureModel({
    strokeBegin: () => log.push('begin'),
    strokeMove: () => log.push('move'),
    strokeEnd: () => log.push('end'),
    strokeCancel: () => log.push('cancel'),
    undo: () => log.push('undo'),
    redo: () => log.push('redo'),
    viewport: v => log.push(`viewport:${v.phase}`),
    hold: (_p, phase) => log.push(`hold:${phase}`),
  });
  return { log, model };
}

describe('CanvasGestureModel (Procreate gestures)', () => {
  it('one finger paints: begin → move → end', () => {
    const { log, model } = recorder();
    model.down(1, 10, 10, -1, 0);
    model.move(1, 30, 12, -1, 16);
    model.up(1, 32);
    expect(log).toEqual(['begin', 'move', 'end']);
  });

  it('two-finger tap undoes and leaves no stroke behind', () => {
    const { log, model } = recorder();
    model.down(1, 10, 10, -1, 0);
    model.down(2, 60, 10, -1, 40);
    model.up(1, 120);
    model.up(2, 130);
    expect(log).toEqual(['begin', 'cancel', 'undo']);
  });

  it('three-finger tap redoes', () => {
    const { log, model } = recorder();
    model.down(1, 10, 10, -1, 0);
    model.down(2, 60, 10, -1, 20);
    model.down(3, 110, 10, -1, 30);
    [1, 2, 3].forEach(id => model.up(id, 150));
    expect(log).toEqual(['begin', 'cancel', 'redo']);
  });

  it('two fingers that move become a pinch, never an undo', () => {
    const { log, model } = recorder();
    model.down(1, 100, 100, -1, 0);
    model.down(2, 200, 100, -1, 30);
    model.move(2, 260, 100, -1, 60);
    model.move(2, 300, 100, -1, 90);
    model.up(1, 200);
    model.up(2, 210);
    expect(log).toEqual(['begin', 'cancel', 'viewport:start', 'viewport:move', 'viewport:end']);
  });

  it('touch-and-hold without moving becomes the eyedropper', () => {
    const { log, model } = recorder();
    model.down(1, 50, 50, -1, 0);
    model.tick(HOLD_MS - 10);
    expect(log).toEqual(['begin']);
    model.tick(HOLD_MS + 5);
    model.move(1, 52, 51, -1, HOLD_MS + 40);
    model.up(1, HOLD_MS + 80);
    expect(log).toEqual(['begin', 'cancel', 'hold:start', 'hold:move', 'hold:end']);
  });

  it('a resting second finger mid-stroke does not cancel real painting', () => {
    const { log, model } = recorder();
    model.down(1, 0, 0, -1, 0);
    for (let i = 1; i <= 10; i++) model.move(1, i * 10, 0, -1, i * 16);
    model.down(2, 300, 300, -1, 400);
    model.up(2, 450);
    model.up(1, 500);
    expect(log.filter(l => l !== 'move')).toEqual(['begin', 'end']);
  });
});

describe('viewport math', () => {
  const art = { x: 50, y: 100, w: 300, h: 300 };
  it('maps stage → artboard through zoom + rotation', () => {
    expect(stageToArtboard(IDENTITY_VIEWPORT, { x: 50, y: 100 }, art)).toEqual({ x: 0, y: 0 });
    const v = { scale: 2, rotation: 0, tx: 0, ty: 0 };
    const c = stageToArtboard(v, { x: 200, y: 250 }, art);
    expect(c.x).toBeCloseTo(150); expect(c.y).toBeCloseTo(150);
    const q = stageToArtboard({ scale: 1, rotation: Math.PI / 2, tx: 0, ty: 0 }, { x: 200, y: 400 }, art);
    expect(q.x).toBeCloseTo(300); expect(q.y).toBeCloseTo(150);
  });
  it('pinching keeps the point under the fingers fixed', () => {
    const center = { x: 200, y: 250 };
    const v = applyPinch(IDENTITY_VIEWPORT, { scale: 2, rotation: 0, dx: 0, dy: 0, cx: 100, cy: 150 }, center);
    // The artboard point that was under (100,150) is still under it.
    const before = stageToArtboard(IDENTITY_VIEWPORT, { x: 100, y: 150 }, art);
    const after = stageToArtboard(v, { x: 100, y: 150 }, art);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe('brush library operations', () => {
  it('new set appears first as "Untitled Set"; rename moves its brushes', () => {
    const lib = defaultBrushLibrary();
    const { state, set } = addSet(lib);
    expect(state.sets[0]).toBe('Untitled Set');
    const withBrush = addBrush(state, set, lib.brushes[0]).state;
    const renamed = renameSet(withBrush, set, 'Lettering');
    expect(renamed.sets[0]).toBe('Lettering');
    expect(renamed.brushes.filter(b => b.category === 'Lettering')).toHaveLength(1);
  });

  it('duplicate set copies every brush with new ids; delete set removes them', () => {
    const lib = defaultBrushLibrary();
    const inking = lib.brushes.filter(b => b.category === 'Inking').length;
    const { state, set } = duplicateSet(lib, 'Inking');
    expect(set).toBe('Inking Copy');
    const copies = state.brushes.filter(b => b.category === 'Inking Copy');
    expect(copies).toHaveLength(inking);
    expect(new Set(state.brushes.map(b => b.id)).size).toBe(state.brushes.length);
    const deleted = deleteSet(state, 'Inking Copy');
    expect(deleted.sets).not.toContain('Inking Copy');
    expect(deleted.brushes).toHaveLength(lib.brushes.length);
  });

  it('duplicate / delete brush; never deletes the last brush', () => {
    const lib = defaultBrushLibrary();
    const { state, id } = duplicateBrushPreset(lib, 'studio-pen');
    expect(state.brushes.find(b => b.id === id)?.name).toBe('Studio Pen Copy');
    expect(deleteBrushPreset(state, id!).brushes).toHaveLength(lib.brushes.length);
    const one = { sets: ['A'], brushes: [lib.brushes[0]] };
    expect(deleteBrushPreset(one, lib.brushes[0].id)).toBe(one);
  });

  it('normalises corrupt persisted data back to defaults', () => {
    expect(normalizeBrushLibrary(null).brushes.length).toBe(defaultBrushLibrary().brushes.length);
    expect(normalizeBrushLibrary({ sets: [], brushes: [{ id: 'x' }] }).brushes.length).toBe(defaultBrushLibrary().brushes.length);
  });
});
