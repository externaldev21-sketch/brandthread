/**
 * adjustments-effects-model.test.ts — the Effects adjustments model, the
 * SVG-primitive builders behind them, and the Adjustments menu catalog.
 */
import { describe, it, expect } from 'vitest';
import { defaultEffects, isIdentityEffects, clampEffects, type EffectsAdjustment } from '../lib/adjustmentsModel';
import {
  motionBlurTaps, unsharpParams, colorBalanceMatrixValues, gradientMapMatrixValues, hexToUnitRgb,
  bloomStdDeviation, MOTION_BLUR_TAPS,
} from '../lib/layerRenderer';
import {
  ADJ_CATEGORIES, ADJ_TOOL_LABELS, ADJ_DEFERRED, EFFECT_SLIDERS, categoryOfTool,
  readEffectValue, writeEffectValue, writeGradientMapStops, GRADIENT_MAP_PRESETS,
} from '../lib/adjustmentsCatalog';

describe('EffectsAdjustment identity / clamp', () => {
  it('default is identity', () => {
    expect(isIdentityEffects(defaultEffects())).toBe(true);
    expect(isIdentityEffects(undefined)).toBe(true);
  });

  it('any live value makes it non-identity, zeros do not', () => {
    expect(isIdentityEffects({ gaussianBlur: 0, sharpen: 0, bloom: 0 })).toBe(true);
    expect(isIdentityEffects({ gaussianBlur: 3 })).toBe(false);
    expect(isIdentityEffects({ motionBlur: { amount: 0, angle: 90 } })).toBe(true);
    expect(isIdentityEffects({ motionBlur: { amount: 6, angle: 90 } })).toBe(false);
    expect(isIdentityEffects({ gradientMap: { from: '#000000', to: '#ffffff', mix: 0 } })).toBe(true);
    expect(isIdentityEffects({ gradientMap: { from: '#000000', to: '#ffffff', mix: 0.5 } })).toBe(false);
    expect(isIdentityEffects({ colorBalance: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 } })).toBe(true);
    expect(isIdentityEffects({ colorBalance: { cyanRed: 0.2, magentaGreen: 0, yellowBlue: 0 } })).toBe(false);
  });

  it('clamps every field to its range and never mutates the input', () => {
    const input: EffectsAdjustment = {
      gaussianBlur: 999, sharpen: 5, bloom: 2, chromatic: 100,
      motionBlur: { amount: 500, angle: 400 },
      colorBalance: { cyanRed: 9, magentaGreen: -9, yellowBlue: 0.3 },
      gradientMap: { from: '#000000', to: '#ffffff', mix: 3 },
    };
    const snapshot = JSON.stringify(input);
    const c = clampEffects(input);
    expect(c.gaussianBlur).toBe(40);
    expect(c.sharpen).toBe(1);
    expect(c.bloom).toBe(1);
    expect(c.chromatic).toBe(24);
    expect(c.motionBlur).toEqual({ amount: 40, angle: 180 });
    expect(c.colorBalance).toEqual({ cyanRed: 1, magentaGreen: -1, yellowBlue: 0.3 });
    expect(c.gradientMap!.mix).toBe(1);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('motionBlurTaps', () => {
  it('amount 0 degenerates to a single zero tap (the source itself)', () => {
    expect(motionBlurTaps(0, 0)).toEqual([{ dx: 0, dy: 0 }]);
    expect(motionBlurTaps(-3, 45)).toEqual([{ dx: 0, dy: 0 }]);
  });

  it('emits MOTION_BLUR_TAPS symmetric taps spanning ±amount/2, centred on zero', () => {
    expect(MOTION_BLUR_TAPS % 2).toBe(1);
    const taps = motionBlurTaps(12, 0);
    expect(taps).toHaveLength(MOTION_BLUR_TAPS);
    expect(taps[0]).toEqual({ dx: -6, dy: 0 });
    expect(taps[taps.length - 1]).toEqual({ dx: 6, dy: 0 });
    expect(taps[(MOTION_BLUR_TAPS - 1) / 2]).toEqual({ dx: 0, dy: 0 });
    expect(taps.reduce((s, t) => s + t.dx, 0)).toBeCloseTo(0, 9);
  });

  it('0° taps lie on the x axis; 90° taps lie on the y axis', () => {
    for (const t of motionBlurTaps(10, 0)) expect(t.dy).toBe(0);
    const v = motionBlurTaps(10, 90);
    for (const t of v) expect(Math.abs(t.dx)).toBeLessThan(1e-9);
    expect(v[0].dy).toBe(-5);
    expect(v[v.length - 1].dy).toBe(5);
  });
});

describe('unsharpParams', () => {
  it('strength 0 is a no-op mask (k = 0)', () => {
    expect(unsharpParams(0).k).toBe(0);
  });

  it('k scales linearly to 1.5 and clamps strength to 0..1; blur radius is positive', () => {
    expect(unsharpParams(0.5).k).toBe(0.75);
    expect(unsharpParams(1).k).toBe(1.5);
    expect(unsharpParams(7).k).toBe(1.5);
    expect(unsharpParams(0.3).stdDeviation).toBeGreaterThan(0);
  });
});

describe('colorBalanceMatrixValues', () => {
  it('all-zero balance is the identity matrix', () => {
    expect(colorBalanceMatrixValues({ cyanRed: 0, magentaGreen: 0, yellowBlue: 0 })).toEqual([
      1, 0, 0, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 1, 0,
    ]);
  });

  it('each axis biases only its own channel, by half of full scale at the extreme', () => {
    const m = colorBalanceMatrixValues({ cyanRed: 1, magentaGreen: -1, yellowBlue: 0.5 });
    expect(m[4]).toBe(0.5);    // R bias
    expect(m[9]).toBe(-0.5);   // G bias
    expect(m[14]).toBe(0.25);  // B bias
    expect(m[0]).toBe(1); expect(m[6]).toBe(1); expect(m[12]).toBe(1); // gains untouched
  });
});

describe('gradientMapMatrixValues / hexToUnitRgb', () => {
  /** Apply a 20-value feColorMatrix to an opaque RGB pixel, returning RGB. */
  const apply = (m: number[], [r, g, b]: number[]) => [0, 1, 2].map(row => {
    const o = row * 5;
    return m[o] * r + m[o + 1] * g + m[o + 2] * b + m[o + 3] * 1 + m[o + 4];
  });

  it('parses hex to 0..1 and rejects malformed input', () => {
    expect(hexToUnitRgb('#FF0000')).toEqual([1, 0, 0]);
    expect(hexToUnitRgb('00ff00')).toEqual([0, 1, 0]);
    expect(hexToUnitRgb('#12')).toBeNull();
    expect(hexToUnitRgb('not a colour')).toBeNull();
  });

  it('black→white is a luminance ramp: pure red becomes Rec.709 grey, alpha untouched', () => {
    const m = gradientMapMatrixValues('#000000', '#FFFFFF')!;
    expect(m).toHaveLength(20);
    const out = apply(m, [1, 0, 0]);
    for (const c of out) expect(c).toBeCloseTo(0.2126, 6);
    expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]);
  });

  it('maps black to `from`, white to `to`, mid-grey to the midpoint; null on bad hex', () => {
    const m = gradientMapMatrixValues('#FF0000', '#0000FF')!;
    expect(apply(m, [0, 0, 0]).map(v => +v.toFixed(6))).toEqual([1, 0, 0]);
    expect(apply(m, [1, 1, 1]).map(v => +v.toFixed(6))).toEqual([0, 0, 1]);
    expect(apply(m, [0.5, 0.5, 0.5]).map(v => +v.toFixed(6))).toEqual([0.5, 0, 0.5]);
    expect(gradientMapMatrixValues('#zz', '#000000')).toBeNull();
  });
});

describe('bloomStdDeviation', () => {
  it('scales linearly with strength and clamps', () => {
    expect(bloomStdDeviation(0)).toBe(0);
    expect(bloomStdDeviation(0.5)).toBe(6);
    expect(bloomStdDeviation(1)).toBe(12);
    expect(bloomStdDeviation(3)).toBe(12);
  });
});

describe('adjustments catalog', () => {
  it('mirrors Procreate: four categories in grid order, every tool labelled, every tool in exactly one category', () => {
    expect(ADJ_CATEGORIES.map(c => c.key)).toEqual(['colour', 'blur', 'effects', 'retouch']);
    const all = ADJ_CATEGORIES.flatMap(c => c.tools);
    expect(new Set(all).size).toBe(all.length);
    for (const t of all) {
      expect(ADJ_TOOL_LABELS[t]).toBeTruthy();
      expect(categoryOfTool(t)).toBe(ADJ_CATEGORIES.find(c => c.tools.includes(t))!.key);
    }
  });

  it('every slider-driven tool has a slider spec; HSB/Curves/Liquify have their own panels', () => {
    for (const t of ['colorBalance', 'gradientMap', 'gaussianBlur', 'motionBlur', 'opacity', 'sharpen', 'bloom', 'chromatic'] as const) {
      expect(EFFECT_SLIDERS[t]!.length).toBeGreaterThan(0);
    }
    expect(EFFECT_SLIDERS.hsb).toBeUndefined();
    expect(EFFECT_SLIDERS.curves).toBeUndefined();
    expect(EFFECT_SLIDERS.liquify).toBeUndefined();
  });

  it('deferred Procreate tools are documented with a reason and are NOT in any category list', () => {
    expect(ADJ_DEFERRED.map(d => d.label).sort()).toEqual(['Clone', 'Glitch', 'Halftone', 'Noise', 'Perspective Blur']);
    for (const d of ADJ_DEFERRED) expect(d.reason.length).toBeGreaterThan(10);
    const labels = Object.values(ADJ_TOOL_LABELS);
    for (const d of ADJ_DEFERRED) expect(labels).not.toContain(d.label);
  });

  it('read/write round-trip for every slider, never mutating the previous record', () => {
    let e: EffectsAdjustment | undefined = undefined;
    for (const [tool, specs] of Object.entries(EFFECT_SLIDERS)) {
      if (tool === 'opacity') continue; // layer opacity lives on the layer, not in effects
      for (const spec of specs!) {
        const before = JSON.stringify(e ?? null);
        const next = writeEffectValue(e, tool as any, spec.key, spec.max);
        expect(readEffectValue(next, tool as any, spec.key)).toBe(spec.max);
        expect(JSON.stringify(e ?? null)).toBe(before);
        e = next;
      }
    }
  });

  it('gradient map stops: picking a preset keeps mix, and starts mix at 1 when unset', () => {
    const p = GRADIENT_MAP_PRESETS[1];
    const fresh = writeGradientMapStops(undefined, p.from, p.to);
    expect(fresh.gradientMap).toEqual({ from: p.from, to: p.to, mix: 1 });
    const kept = writeGradientMapStops({ gradientMap: { from: '#000000', to: '#ffffff', mix: 0.3 } }, p.from, p.to);
    expect(kept.gradientMap!.mix).toBe(0.3);
  });
});
