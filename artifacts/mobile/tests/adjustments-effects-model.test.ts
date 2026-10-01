/**
 * adjustments-effects-model.test.ts — the Effects adjustments model, the
 * SVG-primitive builders behind them, and the Adjustments menu catalog.
 */
import { describe, it, expect } from 'vitest';
import { defaultEffects, isIdentityEffects, clampEffects, type EffectsAdjustment } from '../lib/adjustmentsModel';
import {
  motionBlurKernel, sharpenKernel, colorBalanceMatrixValues, gradientMapTables, hexToUnitRgb,
  bloomStdDeviation, MAX_CONVOLVE_ORDER,
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
    expect(isIdentityEffects({ gaussianBlur: 0, sharpen: 0, noise: 0 })).toBe(true);
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
      gaussianBlur: 999, sharpen: 5, noise: -1, bloom: 2, chromatic: 100,
      motionBlur: { amount: 500, angle: 400 },
      colorBalance: { cyanRed: 9, magentaGreen: -9, yellowBlue: 0.3 },
      gradientMap: { from: '#000000', to: '#ffffff', mix: 3 },
    };
    const snapshot = JSON.stringify(input);
    const c = clampEffects(input);
    expect(c.gaussianBlur).toBe(40);
    expect(c.sharpen).toBe(1);
    expect(c.noise).toBe(0);
    expect(c.bloom).toBe(1);
    expect(c.chromatic).toBe(24);
    expect(c.motionBlur).toEqual({ amount: 40, angle: 180 });
    expect(c.colorBalance).toEqual({ cyanRed: 1, magentaGreen: -1, yellowBlue: 0.3 });
    expect(c.gradientMap!.mix).toBe(1);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('motionBlurKernel', () => {
  it('amount 0 degenerates to a 1×1 identity kernel', () => {
    const k = motionBlurKernel(0, 0);
    expect(k.order).toBe(1);
    expect(k.kernel).toEqual([1]);
    expect(k.divisor).toBe(1);
  });

  it('is always an odd order and never exceeds the convolve ceiling', () => {
    expect(motionBlurKernel(6, 0).order).toBe(7);
    expect(motionBlurKernel(40, 0).order).toBe(MAX_CONVOLVE_ORDER);
    expect(MAX_CONVOLVE_ORDER % 2).toBe(1);
  });

  it('a horizontal (0°) kernel lights exactly the centre row; vertical (90°) exactly the centre column', () => {
    const h = motionBlurKernel(5, 0);
    const n = h.order, c = (n - 1) / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      expect(h.kernel[y * n + x]).toBe(y === c ? 1 : 0);
    }
    expect(h.divisor).toBe(n);
    const v = motionBlurKernel(5, 90);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      expect(v.kernel[y * n + x]).toBe(x === c ? 1 : 0);
    }
  });

  it('divisor equals the number of lit cells (brightness-preserving)', () => {
    const k = motionBlurKernel(9, 45);
    expect(k.divisor).toBe(k.kernel.filter(v => v === 1).length);
    expect(k.divisor).toBeGreaterThan(1);
  });
});

describe('sharpenKernel', () => {
  it('strength 0 is the identity kernel', () => {
    expect(sharpenKernel(0)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  });

  it('coefficients always sum to 1 (no brightness drift) and clamp strength to 0..1', () => {
    for (const st of [0.25, 0.5, 1, 7]) {
      const k = sharpenKernel(st);
      expect(k.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
    expect(sharpenKernel(7)).toEqual(sharpenKernel(1));
    expect(sharpenKernel(1)[4]).toBe(9);
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

describe('gradientMapTables / hexToUnitRgb', () => {
  it('parses hex to 0..1 and rejects malformed input', () => {
    expect(hexToUnitRgb('#FF0000')).toEqual([1, 0, 0]);
    expect(hexToUnitRgb('00ff00')).toEqual([0, 1, 0]);
    expect(hexToUnitRgb('#12')).toBeNull();
    expect(hexToUnitRgb('not a colour')).toBeNull();
  });

  it('black→white is the identity ramp per channel', () => {
    expect(gradientMapTables('#000000', '#FFFFFF')).toEqual({ r: '0.0000 1.0000', g: '0.0000 1.0000', b: '0.0000 1.0000' });
  });

  it('maps black to `from` and white to `to` per channel, null on bad hex', () => {
    const t = gradientMapTables('#FF0000', '#0000FF')!;
    expect(t.r).toBe('1.0000 0.0000');
    expect(t.g).toBe('0.0000 0.0000');
    expect(t.b).toBe('0.0000 1.0000');
    expect(gradientMapTables('#zz', '#000000')).toBeNull();
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
    for (const t of ['colorBalance', 'gradientMap', 'gaussianBlur', 'motionBlur', 'opacity', 'noise', 'sharpen', 'bloom', 'chromatic'] as const) {
      expect(EFFECT_SLIDERS[t]!.length).toBeGreaterThan(0);
    }
    expect(EFFECT_SLIDERS.hsb).toBeUndefined();
    expect(EFFECT_SLIDERS.curves).toBeUndefined();
    expect(EFFECT_SLIDERS.liquify).toBeUndefined();
  });

  it('deferred Procreate tools are documented with a reason and are NOT in any category list', () => {
    expect(ADJ_DEFERRED.map(d => d.label).sort()).toEqual(['Clone', 'Glitch', 'Halftone', 'Perspective Blur']);
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
