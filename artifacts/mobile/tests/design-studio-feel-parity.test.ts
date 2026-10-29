/**
 * Procreate feel-parity logic for the Design Studio: the gestures added in
 * parity pass 2 (three-finger Copy & Paste swipe, four-finger full-screen
 * tap), pinch momentum + quick-pinch fit, the stroke's lift (no blob), and
 * the Transform Width/Height readout.
 */
import { describe, expect, it } from 'vitest';
import {
  CanvasGestureModel, IDENTITY_VIEWPORT, GLIDE_SECONDS, isQuickPinch, lerpViewport, projectGlide, viewportVelocity,
} from '@/lib/paint/canvasGestureModel';
import { emitAll } from '@/lib/paint/dabEmitter';
import { DEFAULT_BRUSH_PRESETS } from '@/lib/paint/brushPresets';
import { transformReadout, transformToQuad, defaultWarpMesh } from '@/lib/transformModel';

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
    copyPasteMenu: () => log.push('copyPaste'),
    fullScreen: () => log.push('fullScreen'),
  });
  return { log, model };
}

describe('multi-finger gestures', () => {
  it('three-finger swipe down opens Copy & Paste (and never pinches or redoes)', () => {
    const { log, model } = recorder();
    model.down(1, 100, 100, -1, 0);
    model.down(2, 150, 100, -1, 10);
    model.down(3, 200, 100, -1, 20);
    for (let k = 1; k <= 6; k++) [1, 2, 3].forEach((id, i) => model.move(id, 100 + i * 50, 100 + k * 12, -1, 20 + k * 16));
    [1, 2, 3].forEach(id => model.up(id, 200));
    expect(log).toEqual(['begin', 'cancel', 'copyPaste']);
  });

  it('four-finger tap toggles full-screen', () => {
    const { log, model } = recorder();
    [1, 2, 3, 4].forEach((id, i) => model.down(id, 50 + i * 40, 100, -1, i * 10));
    [1, 2, 3, 4].forEach(id => model.up(id, 160));
    expect(log).toEqual(['begin', 'cancel', 'fullScreen']);
  });

  it('three-finger tap is still redo', () => {
    const { log, model } = recorder();
    [1, 2, 3].forEach((id, i) => model.down(id, 50 + i * 40, 100, -1, i * 10));
    [1, 2, 3].forEach(id => model.up(id, 160));
    expect(log).toEqual(['begin', 'cancel', 'redo']);
  });
});

describe('pinch momentum + quick pinch', () => {
  it('a fast pinch-in fits the canvas; a slow or opening pinch does not', () => {
    expect(isQuickPinch(220, 0.6)).toBe(true);
    expect(isQuickPinch(900, 0.6)).toBe(false);
    expect(isQuickPinch(200, 1.4)).toBe(false);
  });

  it('release velocity carries the canvas on, then settles', () => {
    const samples = [0, 16, 32, 48].map(t => ({ t, v: { scale: 2, rotation: 0.5, tx: t * 2, ty: 0 } }));
    const vel = viewportVelocity(samples);
    expect(vel.tx).toBeCloseTo(2000, 0); // 2px/ms
    const rest = projectGlide(samples[3].v, vel);
    expect(rest.tx).toBeCloseTo(96 + 2000 * GLIDE_SECONDS, 3);
    expect(rest.scale).toBe(2);
  });

  it('a still release does not drift, and near-upright snaps to 0°', () => {
    const v = { scale: 1.5, rotation: 0.05, tx: 10, ty: 20 };
    const rest = projectGlide(v, viewportVelocity([{ t: 0, v }, { t: 16, v }]));
    expect(rest).toEqual({ scale: 1.5, rotation: 0, tx: 10, ty: 20 });
  });

  it('the glide eases out and lands exactly on the target', () => {
    const to = { scale: 2, rotation: 1, tx: 100, ty: -50 };
    expect(lerpViewport(IDENTITY_VIEWPORT, to, 1)).toEqual(to);
    const mid = lerpViewport(IDENTITY_VIEWPORT, to, 0.5);
    expect(mid.tx).toBeGreaterThan(50); // ease-out: past halfway at half time
  });
});

describe('stroke lift', () => {
  it('a finger stroke does not end in a fat blob (dynamics hold through the lift)', () => {
    const pen = DEFAULT_BRUSH_PRESETS.find(b => b.id === 'studio-pen')!;
    // A quick finger stroke: 2px/ms, no stylus pressure.
    const samples = Array.from({ length: 40 }, (_, i) => ({ x: 20 + i * 8, y: 100, p: -1, t: i * 4 }));
    const dabs = emitAll(samples, { params: pen.params, diameter: 40, seed: 1, unitScale: 1 });
    const body = dabs.slice(Math.floor(dabs.length * 0.4), Math.floor(dabs.length * 0.8));
    const bodyMax = Math.max(...body.map(d => d.size));
    const tailMax = Math.max(...dabs.slice(-6).map(d => d.size));
    expect(tailMax).toBeLessThanOrEqual(bodyMax * 1.15);
  });
});

describe('transform readout', () => {
  const t = { x: 10, y: 20, width: 400, height: 300, rotation: 0, scaleX: 1, scaleY: 1 };
  it('freeform/uniform report the box in px', () => {
    expect(transformReadout(t, 'freeform', null, null)).toMatchObject({ width: 400, height: 300 });
  });
  it('distort reports the corner bounds', () => {
    const q = transformToQuad(t);
    q.br = { x: 500, y: 400 };
    expect(transformReadout(t, 'distort', q, null)).toMatchObject({ width: 490, height: 380 });
  });
  it('warp reports the mesh bounds', () => {
    const m = defaultWarpMesh(t);
    m[0] = { ...m[0], x: -40 };
    expect(transformReadout(t, 'warp', null, m)).toMatchObject({ width: 450, height: 300 });
  });
});

describe('flipped layers export mirrored', () => {
  it('composeExport mirrors a flipped layer within its box (Actions → Canvas → Flip)', async () => {
    const { SoftwareBackend } = await import('@/lib/paint/softwareBackend');
    const { composeExport } = await import('@/lib/paint/composeExport');
    const { PaintEngine } = await import('@/lib/paint/engine');
    const B = new SoftwareBackend();
    // One hard dab near the LEFT edge of a 40×20 canvas.
    const pen = { ...DEFAULT_BRUSH_PRESETS.find(b => b.id === 'technical-pen')!.params, streamline: 0, taperStart: 0, pressureSize: 0 };
    const eng = new PaintEngine(B, 40, 20, { scale: 1, headless: true });
    eng.beginStroke('l', { v: 1, mode: 'paint', brushId: 'p', brushName: 'p', params: pen, color: '#000000', diameter: 6, opacity: 1, seed: 1 }, { x: 6, y: 10, p: 1, t: 0 });
    const rec = eng.endStroke()!;
    const { drawPathFromRecord } = await import('@/lib/paint/strokeRecord');
    const paths = [drawPathFromRecord(rec)];
    const base = { kind: 'raster' as const, id: 'l', paths, opacity: 1, box: { x: 0, y: 0, w: 40, h: 20 } };
    const plain = await composeExport(B, { logicalWidth: 40, logicalHeight: 20, background: null, items: [base] });
    const flipped = await composeExport(B, { logicalWidth: 40, logicalHeight: 20, background: null, items: [{ ...base, flipX: true }] });
    expect(B.readPixel(plain, 6, 10)[3]).toBeGreaterThan(200);
    expect(B.readPixel(plain, 33, 10)[3]).toBe(0);
    expect(B.readPixel(flipped, 33, 10)[3]).toBeGreaterThan(200);
    expect(B.readPixel(flipped, 6, 10)[3]).toBe(0);
  });
});
