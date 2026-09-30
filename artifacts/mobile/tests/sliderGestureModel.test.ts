/**
 * Unit tests for lib/sliderGestureModel.ts — the pure math behind the
 * Design Studio size/opacity sliders' Reanimated + Gesture Handler drag.
 *
 * These specifically cover the regression that caused Dev's "the slider
 * keeps messing up/glitching" report: the original implementation
 * recomputed the percentage from a fixed 0.5 baseline plus only the delta
 * since the PREVIOUS move event, instead of the cumulative delta since the
 * gesture started. dragPct() is the fixed formula; the tests below assert
 * it tracks a smooth, continuous, delta-from-start value, not a
 * per-event-reset one.
 */
import { describe, it, expect } from 'vitest';
import { rubberband, dragPct, toStepPercent, clampToRange } from '../lib/sliderGestureModel';

describe('dragPct', () => {
  it('returns the start value untouched when translationY is 0', () => {
    expect(dragPct(0.5, 0, 200)).toBe(0.5);
  });

  it('moving the finger/pointer UP (negative translationY) increases pct', () => {
    // 100px up on a 200px rail = +50%
    expect(dragPct(0.2, -100, 200)).toBeCloseTo(0.7, 10);
  });

  it('moving the finger/pointer DOWN (positive translationY) decreases pct', () => {
    expect(dragPct(0.8, 100, 200)).toBeCloseTo(0.3, 10);
  });

  it('tracks smoothly and continuously across a sequence of cumulative deltas — the "keeps messing up" regression guard', () => {
    // Simulates one continuous drag: Gesture Handler reports translationY as
    // CUMULATIVE since the gesture began, not per-event. A correct
    // implementation must produce a smooth, monotonic ramp here — the bug
    // this fixes produced a value that jumped around a fixed 0.5 baseline
    // on every single event instead.
    const start = 0.3;
    const railHeight = 200;
    // Drag steadily upward: translationY goes from 0 to -160 (80% of rail).
    const cumulativeTranslations = [0, -20, -40, -60, -80, -100, -120, -140, -160];
    const pcts = cumulativeTranslations.map(dy => dragPct(start, dy, railHeight));

    // Monotonically increasing (steady upward drag -> steadily increasing pct).
    for (let i = 1; i < pcts.length; i++) {
      expect(pcts[i]).toBeGreaterThan(pcts[i - 1]);
    }
    // Final position: start (0.3) + 160/200 = 1.1 (clamping happens in the
    // caller via rubberband/clamp, not in dragPct itself).
    expect(pcts[pcts.length - 1]).toBeCloseTo(1.1, 10);
    // No value overshoots what a linear ramp from start would predict —
    // i.e. no jump/reset mid-drag.
    cumulativeTranslations.forEach((dy, i) => {
      expect(pcts[i]).toBeCloseTo(start - dy / railHeight, 10);
    });
  });

  it('a drag that returns to its starting point returns pct to the exact starting value (no drift)', () => {
    const start = 0.42;
    const outAndBack = [0, -30, -60, -90, -60, -30, 0];
    const pcts = outAndBack.map(dy => dragPct(start, dy, 200));
    expect(pcts[0]).toBeCloseTo(start, 10);
    expect(pcts[pcts.length - 1]).toBeCloseTo(start, 10);
  });

  it('returns startPct unchanged for a degenerate (zero/negative) rail height instead of dividing by zero', () => {
    expect(dragPct(0.5, -50, 0)).toBe(0.5);
    expect(dragPct(0.5, -50, -10)).toBe(0.5);
  });
});

describe('rubberband', () => {
  it('passes values inside [min, max] through unchanged', () => {
    expect(rubberband(0.5, 0, 1)).toBe(0.5);
    expect(rubberband(0, 0, 1)).toBe(0);
    expect(rubberband(1, 0, 1)).toBe(1);
  });

  it('dampens overshoot below min instead of clamping hard to min', () => {
    const past = rubberband(-0.5, 0, 1);
    expect(past).toBeLessThan(0);      // still gives some visible "pull"
    expect(past).toBeGreaterThan(-0.5); // but less than the raw overshoot
  });

  it('dampens overshoot above max instead of clamping hard to max', () => {
    const past = rubberband(1.5, 0, 1);
    expect(past).toBeGreaterThan(1);
    expect(past).toBeLessThan(1.5);
  });

  it('damping increases (diminishing returns) the further past the edge the raw value is', () => {
    const near = rubberband(1.1, 0, 1) - 1;   // "give" for 0.1 overshoot
    const far = rubberband(2.0, 0, 1) - 1;    // "give" for 1.0 overshoot
    // The far drag's give is less than 10x the near drag's, even though the
    // raw overshoot is 10x — i.e. genuinely asymptotic, not linear.
    expect(far).toBeLessThan(near * 10);
  });

  it('higher resistance produces less overshoot for the same raw value', () => {
    const loose = rubberband(1.5, 0, 1, 2);
    const tight = rubberband(1.5, 0, 1, 20);
    expect(tight - 1).toBeLessThan(loose - 1);
  });
});

describe('toStepPercent', () => {
  it('rounds to the nearest integer percent', () => {
    expect(toStepPercent(0)).toBe(0);
    expect(toStepPercent(1)).toBe(100);
    expect(toStepPercent(0.5)).toBe(50);
    expect(toStepPercent(0.567)).toBe(57);
    expect(toStepPercent(0.564)).toBe(56);
  });

  it('clamps out-of-range input to 0–100 (guards against rubber-band overshoot leaking through)', () => {
    expect(toStepPercent(-0.3)).toBe(0);
    expect(toStepPercent(1.3)).toBe(100);
  });
});

describe('clampToRange', () => {
  it('clamps below min up to min', () => {
    expect(clampToRange(-5, 0, 100)).toBe(0);
  });
  it('clamps above max down to max', () => {
    expect(clampToRange(150, 0, 100)).toBe(100);
  });
  it('passes values inside the range through unchanged', () => {
    expect(clampToRange(42, 0, 100)).toBe(42);
  });
});

describe('end-to-end drag simulation (the exact regression scenario Dev reported)', () => {
  it('a single continuous drag from 20% to 100% never jumps backward mid-drag', () => {
    // Reproduces the real gesture sequence a user's touch/mouse produces:
    // 60 small incremental move events during one continuous upward drag on
    // a 240px-tall rail, starting from 20%.
    const start = 0.2;
    const railHeight = 240;
    let cumulativeDy = 0;
    const perEventDy = -4; // 4px per move event, upward
    const results: number[] = [];
    for (let i = 0; i < 60; i++) {
      cumulativeDy += perEventDy;
      const raw = dragPct(start, cumulativeDy, railHeight);
      results.push(rubberband(raw, 0, 1));
    }
    // Strictly non-decreasing throughout — this is the property the old,
    // buggy per-event-delta-from-0.5-baseline implementation violated.
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBeGreaterThanOrEqual(results[i - 1]);
    }
    // Ends at (start + 240/240) = 1.2 raw, rubber-banded down toward ~1.
    expect(results[results.length - 1]).toBeGreaterThan(0.95);
    expect(toStepPercent(clampToRange(results[results.length - 1], 0, 1))).toBeLessThanOrEqual(100);
  });
});
