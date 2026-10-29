import { describe, expect, it } from 'vitest';
import { DabEmitter, emitAll, type StrokeSample } from '@/lib/paint/dabEmitter';
import { BRUSH_CATEGORIES, DEFAULT_BRUSH_PRESETS, brushDiameter, findPreset, groupPresets } from '@/lib/paint/brushPresets';
import { buildTipMask, getGrainMask, maskCoverage } from '@/lib/paint/tips';
import { drawPathFromRecord, ptsToSamples, recordFromDrawPath, samplesToPts, type StrokeRecord } from '@/lib/paint/strokeRecord';

function line(n: number, dx = 4, dt = 16, p = -1): StrokeSample[] {
  return Array.from({ length: n }, (_, i) => ({ x: 100 + i * dx, y: 100, p, t: i * dt }));
}

const preset = (id: string) => findPreset(DEFAULT_BRUSH_PRESETS, id).params;

describe('brush library', () => {
  it('ships every Procreate brush set, each with brushes, with unique ids', () => {
    const groups = groupPresets(DEFAULT_BRUSH_PRESETS, [...BRUSH_CATEGORIES]);
    expect(groups.map(g => g.category)).toEqual([
      'Sketching', 'Inking', 'Drawing', 'Painting', 'Artistic', 'Calligraphy',
      'Airbrushing', 'Textures', 'Abstract', 'Charcoals', 'Elements', 'Spraypaints',
    ]);
    for (const g of groups) expect(g.brushes.length).toBeGreaterThanOrEqual(3);
    const ids = DEFAULT_BRUSH_PRESETS.map(b => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('scales brush diameter with canvas resolution', () => {
    const ink = preset('studio-pen');
    expect(brushDiameter(ink, 0.5, 4500 * 1.2)).toBeCloseTo(brushDiameter(ink, 0.5, 1080) * 5, 3);
  });

  it('size slider is exponential and extreme, like Procreate (pin-prick at 1%, massive at 100%)', () => {
    for (const b of DEFAULT_BRUSH_PRESETS) {
      const lo = brushDiameter(b.params, 0.01, 1080);
      const hi = brushDiameter(b.params, 1, 1080);
      expect(hi / lo).toBeGreaterThan(25); // finest pencils bottom out at a 1px dab
      expect(hi).toBeGreaterThanOrEqual(b.params.maxSize * 2);
    }
    const ink = preset('studio-pen');
    // Equal slider steps give equal size ratios (every pixel of travel visibly changes the stroke).
    const r1 = brushDiameter(ink, 0.3, 1080) / brushDiameter(ink, 0.2, 1080);
    const r2 = brushDiameter(ink, 0.9, 1080) / brushDiameter(ink, 0.8, 1080);
    expect(r1).toBeCloseTo(r2, 5);
    expect(brushDiameter(ink, 0.99, 1080) / brushDiameter(ink, 0.11, 1080)).toBeGreaterThan(20);
  });
});

describe('tips and grain', () => {
  it('hard tips are solid in the middle and clear at the corners; soft tips fall off', () => {
    const hard = buildTipMask('hard', 64);
    const soft = buildTipMask('soft', 64);
    expect(hard.alpha[32 * 64 + 32]).toBe(255);
    expect(hard.alpha[0]).toBe(0);
    expect(soft.alpha[32 * 64 + 32]).toBeGreaterThan(240);
    // soft tip at half radius is well below full, hard tip is still full
    expect(soft.alpha[32 * 64 + 48]).toBeLessThan(200);
    expect(hard.alpha[32 * 64 + 48]).toBe(255);
    expect(maskCoverage(soft)).toBeLessThan(maskCoverage(hard));
  });

  it('pencil and charcoal tips are textured (have holes), nozzle is speckled', () => {
    for (const shape of ['pencil', 'charcoal'] as const) {
      const m = buildTipMask(shape, 96);
      const center = Array.from(m.alpha.slice(40 * 96 + 30, 40 * 96 + 66));
      expect(Math.max(...center) - Math.min(...center)).toBeGreaterThan(80);
    }
    const nozzle = buildTipMask('nozzle', 96);
    expect(maskCoverage(nozzle)).toBeGreaterThan(0.05);
    expect(maskCoverage(nozzle)).toBeLessThan(maskCoverage(buildTipMask('hard', 96)) * 0.8);
  });

  it('grain is deterministic and textured', () => {
    const a = getGrainMask('paper');
    expect(maskCoverage(a)).toBeGreaterThan(0.2);
    expect(maskCoverage(a)).toBeLessThan(0.9);
    expect(maskCoverage(getGrainMask('none'))).toBe(1);
  });
});

describe('DabEmitter', () => {
  it('prints a dot on tap', () => {
    const dabs = emitAll([{ x: 10, y: 10, p: -1, t: 0 }], { params: preset('studio-pen'), diameter: 20, seed: 3, unitScale: 1 });
    expect(dabs.length).toBeGreaterThanOrEqual(1);
    expect(dabs[0].x).toBe(10);
  });

  it('spaces dabs along the path by the brush spacing', () => {
    const params = { ...preset('technical-pen'), streamline: 0, spacing: 0.5 };
    const dabs = emitAll(line(26, 4), { params, diameter: 20, seed: 1, unitScale: 1 });
    // 100px path / (0.5 * 20px) = ~10 steps + the landing dab
    expect(dabs.length).toBeGreaterThanOrEqual(10);
    expect(dabs.length).toBeLessThanOrEqual(13);
    for (let i = 1; i < dabs.length - 1; i++) expect(dabs[i].x - dabs[i - 1].x).toBeCloseTo(10, 0);
  });

  it('is deterministic for the same seed (replay = identical pixels)', () => {
    const params = preset('fat-nozzle');
    const a = emitAll(line(30), { params, diameter: 80, seed: 42, unitScale: 1 });
    const b = emitAll(line(30), { params, diameter: 80, seed: 42, unitScale: 1 });
    const c = emitAll(line(30), { params, diameter: 80, seed: 43, unitScale: 1 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('stylus pressure drives size for pressure-sensitive brushes', () => {
    const params = { ...preset('studio-pen'), taperStart: 0, velocitySize: 0, streamline: 0 };
    const light = emitAll(line(20, 4, 16, 0.1), { params, diameter: 40, seed: 1, unitScale: 1 });
    const heavy = emitAll(line(20, 4, 16, 1), { params, diameter: 40, seed: 1, unitScale: 1 });
    const avg = (d: typeof light) => d.reduce((s, x) => s + x.size, 0) / d.length;
    expect(avg(heavy)).toBeGreaterThan(avg(light) * 2);
  });

  it('fast flicks taper velocity-sensitive ink', () => {
    const params = { ...preset('syrup'), taperStart: 0, streamline: 0 };
    const slow = emitAll(line(40, 2, 16, 1), { params, diameter: 40, seed: 1, unitScale: 1 });
    const fast = emitAll(line(40, 30, 4, 1), { params, diameter: 40, seed: 1, unitScale: 1 });
    const tail = (d: typeof slow) => d.slice(-5).reduce((s, x) => s + x.size, 0) / 5;
    expect(tail(fast)).toBeLessThan(tail(slow) * 0.6);
  });

  it('spray brushes emit scattered particles', () => {
    const dabs = emitAll(line(30), { params: preset('fat-nozzle'), diameter: 100, seed: 9, unitScale: 1 });
    expect(dabs.length).toBeGreaterThan(50);
    const ys = dabs.map(d => d.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(30);
    expect(Math.max(...dabs.map(d => d.size))).toBeLessThan(20);
  });

  it('streams incrementally: live push() + finish() equals a one-shot replay', () => {
    const params = preset('6b-pencil');
    const samples = line(25, 3, 12, 0.6);
    const em = new DabEmitter({ params, diameter: 18, seed: 5, unitScale: 1 });
    const live = samples.flatMap(s => em.push(s)).concat(em.finish());
    expect(live).toEqual(emitAll(samples, { params, diameter: 18, seed: 5, unitScale: 1 }));
  });
});

describe('stroke records', () => {
  it('round-trips samples (rounded to 0.1px)', () => {
    const s = [{ x: 1.234, y: 5.678, p: 0.5, t: 1000 }, { x: 2, y: 3, p: -1, t: 1016 }];
    expect(ptsToSamples(samplesToPts(s))).toEqual([{ x: 1.2, y: 5.7, p: 0.5, t: 0 }, { x: 2, y: 3, p: -1, t: 16 }]);
  });

  it('upgrades legacy vector paths, including erase strokes', () => {
    const rec = recordFromDrawPath({ d: 'M10,20 L30,40 L50,60', color: 'erase', width: 12, opacity: 1, tool: 'Eraser' })!;
    expect(rec.mode).toBe('erase');
    expect(rec.pts).toEqual([10, 20, -1, 0, 30, 40, -1, 16, 50, 60, -1, 32]);
    expect(rec.diameter).toBe(12);
  });

  it('wraps a record in a DrawPath that the record round-trips through', () => {
    const rec: StrokeRecord = {
      v: 1, mode: 'paint', brushId: 'studio-pen', brushName: 'Studio Pen', params: preset('studio-pen'),
      color: '#112233', diameter: 10, opacity: 0.8, seed: 7, unitScale: 1, pts: [0, 0, -1, 0],
    };
    const dp = drawPathFromRecord(rec);
    expect(dp.color).toBe('#112233');
    expect(recordFromDrawPath(dp)).toBe(rec);
  });
});
