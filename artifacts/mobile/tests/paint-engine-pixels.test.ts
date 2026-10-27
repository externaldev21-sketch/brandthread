/**
 * Runs the real PaintEngine on the CPU SoftwareBackend and asserts on
 * pixels: the behaviours the Procreate-grade canvas promises.
 */
import { describe, expect, it } from 'vitest';
import { PaintEngine } from '@/lib/paint/engine';
import { SoftwareBackend } from '@/lib/paint/softwareBackend';
import { DEFAULT_BRUSH_PRESETS, findPreset, type BrushMode } from '@/lib/paint/brushPresets';
import { drawPathFromRecord, fillRecord, mergeRecord, type StrokeRecord } from '@/lib/paint/strokeRecord';
import type { StrokeSample } from '@/lib/paint/dabEmitter';
import type { DrawPath } from '@/services/designTypes';

const B = new SoftwareBackend();
const params = (id: string) => findPreset(DEFAULT_BRUSH_PRESETS, id).params;

function hline(y: number, x0: number, x1: number, step = 2): StrokeSample[] {
  const out: StrokeSample[] = [];
  for (let x = x0, t = 0; x <= x1; x += step, t += 16) out.push({ x, y, p: 1, t });
  return out;
}

function draw(engine: PaintEngine<any>, layer: string, mode: BrushMode, samples: StrokeSample[], over: Partial<StrokeRecord> = {}): StrokeRecord {
  const base = {
    v: 1 as const, mode, brushId: 'technical-pen', brushName: 'Technical Pen',
    params: { ...params('technical-pen'), streamline: 0 }, color: '#FF0000', diameter: 10, opacity: 1, seed: 11,
    ...over,
  };
  engine.beginStroke(layer, base, samples[0]);
  engine.addSamples(samples.slice(1));
  return engine.endStroke()!;
}

const alphaAt = (e: PaintEngine<any>, id: string, x: number, y: number) => B.readPixel(e.content(id), x, y)[3];

describe('PaintEngine (pixels)', () => {
  it('paints the stroke colour along the path and nothing elsewhere', () => {
    const e = new PaintEngine(B, 64, 64);
    draw(e, 'L', 'paint', hline(32, 8, 56));
    expect(B.readPixel(e.content('L'), 32, 32)).toEqual([255, 0, 0, 255]);
    expect(alphaAt(e, 'L', 32, 8)).toBe(0);
    // display mirrors content after lift
    expect(B.readPixel(e.display('L'), 32, 32)).toEqual([255, 0, 0, 255]);
  });

  it('caps a self-overlapping stroke at the stroke opacity (Procreate glazing)', () => {
    const e = new PaintEngine(B, 64, 64);
    const there = hline(32, 8, 56), back = hline(32, 8, 56).reverse().map((s, i) => ({ ...s, t: 1000 + i * 16 }));
    draw(e, 'L', 'paint', [...there, ...back], { opacity: 0.5 });
    expect(alphaAt(e, 'L', 32, 32)).toBeGreaterThanOrEqual(126);
    expect(alphaAt(e, 'L', 32, 32)).toBeLessThanOrEqual(129);
  });

  it('the eraser erases to real transparency (alpha 0), not to white', () => {
    const e = new PaintEngine(B, 64, 64);
    draw(e, 'L', 'paint', hline(32, 8, 56), { diameter: 20 });
    draw(e, 'L', 'erase', hline(32, 8, 56), { diameter: 24 });
    expect(B.readPixel(e.content('L'), 32, 32)).toEqual([0, 0, 0, 0]);
  });

  it('alpha lock only paints over existing pixels', () => {
    const e = new PaintEngine(B, 64, 64);
    draw(e, 'L', 'paint', hline(32, 8, 56), { diameter: 8, color: '#000000' });
    // A wide blue stroke across with alpha lock on: the line turns blue, empty pixels stay empty.
    draw(e, 'L', 'paint', hline(32, 8, 56), { diameter: 40, color: '#0000FF', alphaLock: true });
    expect(B.readPixel(e.content('L'), 32, 32)).toEqual([0, 0, 255, 255]);
    expect(alphaAt(e, 'L', 32, 20)).toBe(0);
  });

  it('smudge drags existing paint into the stroke direction', () => {
    const e = new PaintEngine(B, 96, 64);
    // Solid red block on the left half.
    draw(e, 'L', 'paint', [16, 22, 28, 34, 40, 46].flatMap((y, i) => hline(y, 4, 40).map(s => ({ ...s, t: s.t + i * 1000 }))), { diameter: 12 });
    expect(alphaAt(e, 'L', 70, 32)).toBe(0);
    draw(e, 'L', 'smudge', hline(32, 20, 80, 2), { diameter: 16, params: { ...params('soft-brush'), streamline: 0, pressureSize: 0 } });
    // Paint now exists where there was none, and it is red-ish.
    expect(alphaAt(e, 'L', 60, 32)).toBeGreaterThan(20);
    const [r, , b] = B.readPixel(e.content('L'), 60, 32);
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(40);
  });

  it('replay (undo / reload / export) reproduces the live pixels exactly', () => {
    const live = new PaintEngine(B, 80, 80);
    const recs = [
      draw(live, 'L', 'paint', hline(30, 10, 70), { params: { ...params('6b-pencil'), streamline: 0 }, diameter: 14, seed: 3 }),
      draw(live, 'L', 'paint', hline(44, 10, 70), { params: { ...params('fat-nozzle'), streamline: 0 }, diameter: 30, seed: 4, color: '#00AA00' }),
      draw(live, 'L', 'erase', hline(36, 30, 50), { diameter: 12, seed: 5 }),
    ];
    const replay = new PaintEngine(B, 80, 80);
    replay.sync('L', recs.map(drawPathFromRecord));
    expect(Array.from((replay.content('L') as any).px)).toEqual(Array.from((live.content('L') as any).px));
  });

  it('replay matches live exactly even for fractional, irregular input (real touch data)', () => {
    const samples: StrokeSample[] = Array.from({ length: 40 }, (_, i) => ({
      x: 10.37 + i * 1.913, y: 30 + Math.sin(i / 3) * 9.271, p: -1, t: 1000.4 + i * 7.31,
    }));
    const live = new PaintEngine(B, 96, 64);
    const rec = draw(live, 'L', 'paint', samples, { params: { ...params('6b-pencil') }, diameter: 9, seed: 21 });
    const replay = new PaintEngine(B, 96, 64);
    replay.sync('L', [drawPathFromRecord(rec)]);
    expect(Array.from((replay.content('L') as any).px)).toEqual(Array.from((live.content('L') as any).px));
  });

  it('merge-down record keeps the top layer\'s eraser off the layer below', () => {
    const e = new PaintEngine(B, 64, 64);
    const below = draw(e, 'below', 'paint', hline(32, 8, 56), { diameter: 12, color: '#0000FF' });
    const topPaint = draw(e, 'top', 'paint', hline(20, 8, 56), { diameter: 8 });
    const topErase = draw(e, 'top', 'erase', [{ x: 32, y: 10, p: 1, t: 0 }, { x: 32, y: 40, p: 1, t: 16 }], { diameter: 10 });
    const merged = new PaintEngine(B, 64, 64);
    merged.sync('M', [drawPathFromRecord(below), drawPathFromRecord(mergeRecord([topPaint, topErase].map(drawPathFromRecord), 1))]);
    // The top layer's eraser crossed the blue line at x=32 but must not have erased it.
    expect(B.readPixel(merged.content('M'), 32, 32)).toEqual([0, 0, 255, 255]);
    // …while it did cut the top layer's own red line.
    expect(B.readPixel(merged.content('M'), 32, 20)[3]).toBe(0);
    expect(B.readPixel(merged.content('M'), 16, 20)).toEqual([255, 0, 0, 255]);
  });

  it('fill layer honours alpha lock', () => {
    const e = new PaintEngine(B, 64, 64);
    const line = draw(e, 'L', 'paint', hline(32, 8, 56), { diameter: 8, color: '#000000' });
    e.sync('L', [drawPathFromRecord(line), drawPathFromRecord(fillRecord('#00FF00', true))]);
    expect(B.readPixel(e.content('L'), 32, 32)).toEqual([0, 255, 0, 255]);
    expect(B.readPixel(e.content('L'), 32, 10)[3]).toBe(0);
    e.sync('L', [drawPathFromRecord(line), drawPathFromRecord(fillRecord('#00FF00', false))]);
    expect(B.readPixel(e.content('L'), 32, 10)).toEqual([0, 255, 0, 255]);
  });

  it('sync is incremental for appends and replays on undo', () => {
    const e = new PaintEngine(B, 64, 64);
    const r1 = draw(e, 'L', 'paint', hline(20, 8, 56));
    const r2 = draw(e, 'L', 'paint', hline(40, 8, 56));
    const paths: DrawPath[] = [r1, r2].map(drawPathFromRecord);
    expect(e.sync('L', paths)).toBe(false); // already drawn live
    expect(e.sync('L', paths.slice(0, 1))).toBe(true); // undo
    expect(alphaAt(e, 'L', 32, 40)).toBe(0);
    expect(alphaAt(e, 'L', 32, 20)).toBe(255);
    expect(e.sync('L', paths)).toBe(true); // redo
    expect(alphaAt(e, 'L', 32, 40)).toBe(255);
  });

  it('renders legacy vector paths', () => {
    const e = new PaintEngine(B, 64, 64);
    e.sync('L', [{ d: 'M8,32 L56,32', color: '#00FF00', width: 6, opacity: 1, tool: 'Pen' }]);
    expect(B.readPixel(e.content('L'), 32, 32)).toEqual([0, 255, 0, 255]);
  });

  it('full-resolution export replays at a different scale with the same shape', () => {
    const work = new PaintEngine(B, 200, 200, { scale: 0.5 });
    const rec = draw(work, 'L', 'paint', hline(100, 20, 180, 4), { diameter: 20 });
    const full = new PaintEngine(B, 200, 200, { scale: 1 });
    full.sync('L', [drawPathFromRecord(rec)]);
    expect(work.width).toBe(100);
    expect(full.width).toBe(200);
    expect(B.readPixel(work.content('L'), 50, 50)[3]).toBe(255);
    expect(B.readPixel(full.content('L'), 100, 100)[3]).toBe(255);
    expect(B.readPixel(full.content('L'), 100, 85)[3]).toBe(0);
  });
});
