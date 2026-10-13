import { describe, expect, it } from 'vitest';

import {
  captureGlideStart, offsetAt, pillCorrection, scaleAt, type BarGeometry,
} from '@/components/buyer-nav/barModePill';
import { currentStretch, planGlide } from '@/components/tab-bar/pillGlide';

// Regular buyer capsule as measured on the web preview at 390x844.
const g: BarGeometry = { capsuleWidth: 290, capsulePadding: 4, itemWidth: 70.5, compactScaleX: 241.7 / 290 };

/** Critically damped 1200/70 spring (the pill's INDICATOR_SPRING), 60fps. */
function spring(from: number, to: number) {
  const k = 1200; const w0 = Math.sqrt(k); const dt = 1 / 60;
  let x = from - to; let v = 0; const e0 = 0.5 * k * x * x; const out: number[] = [];
  for (let i = 0; i < 60; i++) {
    const e = Math.exp(-w0 * dt);
    const nx = e * (x + (v + w0 * x) * dt);
    v = e * (v - w0 * (v + w0 * x) * dt);
    x = nx;
    if (0.5 * k * x * x + 0.5 * v * v <= 1e-4 * e0) { out.push(to); break; }
    out.push(to + x);
  }
  return out;
}

const lead = (x: number, origin: number, target: number, peak: number) =>
  ((target >= origin ? 1 : -1) * currentStretch(x, origin, target, peak) * g.itemWidth) / 2;

/** On-screen progress (0..1) of the pill's displayed centre, frame by frame,
 *  with or without the buyer bar's correction. */
function pillCentre(fromSlot: number, toSlot: number, corrected: boolean) {
  const mFrom = fromSlot === 0 ? 1 : 0;
  const mTo = toSlot === 0 ? 1 : 0;
  const { origin, peak } = planGlide(fromSlot, toSlot, { origin: fromSlot, target: fromSlot, peak: 0 });
  const xs = spring(fromSlot, toSlot);
  const ms = spring(mFrom, mTo);
  const start = captureGlideStart(fromSlot, mFrom, mTo, scaleAt(mFrom, g) * offsetAt(fromSlot, g), 0, g);
  const displayed = (x: number, m: number) => {
    const l = lead(x, origin, toSlot, peak);
    const c = corrected ? pillCorrection(x, toSlot, m, mTo, start, g, l) : 0;
    return scaleAt(m, g) * (offsetAt(x, g) + l + c);
  };
  const s0 = displayed(fromSlot, mFrom);
  const s1 = displayed(toSlot, mTo);
  const n = Math.max(xs.length, ms.length);
  return Array.from({ length: n }, (_, i) =>
    (displayed(xs[Math.min(i, xs.length - 1)], ms[Math.min(i, ms.length - 1)]) - s0) / (s1 - s0));
}

describe('buyer bar pill during the compact <-> regular resize', () => {
  it('is an exact mirror image: shrinking toward Home and growing away from it follow the same curve', () => {
    for (const slot of [1, 2, 3]) {
      const shrink = pillCentre(slot, 0, true);
      const grow = pillCentre(0, slot, true);
      expect(shrink.length).toBe(grow.length);
      shrink.forEach((p, i) => expect(p).toBeCloseTo(grow[i], 6));
    }
  });

  it('was not a mirror image before the correction (the bug this fixes)', () => {
    const shrink = pillCentre(1, 0, false);
    const grow = pillCentre(0, 1, false);
    const gap = Math.max(...shrink.map((p, i) => Math.abs(p - grow[i])));
    expect(gap).toBeGreaterThan(0.1);
  });

  it('leaves glides between regular tabs exactly as they were, stretch included', () => {
    const { origin, peak } = planGlide(1, 3, { origin: 1, target: 1, peak: 0 });
    const start = captureGlideStart(1, 0, 0, offsetAt(1, g), 0, g);
    for (const x of [1, 1.2, 1.6, 2.1, 2.7, 3]) {
      expect(pillCorrection(x, 3, 0, 0, start, g, lead(x, origin, 3, peak))).toBeCloseTo(0, 9);
    }
  });

  it('adds nothing at either end of a resize glide', () => {
    const start = captureGlideStart(1, 0, 1, offsetAt(1, g), 0, g);
    expect(pillCorrection(1, 0, 0, 1, start, g, 0)).toBeCloseTo(0, 9);
    expect(pillCorrection(0, 0, 1, 1, start, g, 0)).toBeCloseTo(0, 9);
  });

  it('does not move the pill on the frame a redirect is captured', () => {
    // Mid-way through Discover -> Home, the user taps Inbox.
    const first = captureGlideStart(1, 0, 1, offsetAt(1, g), 0, g);
    const x = 0.55; const m = 0.6;
    const l = 3;
    const before = scaleAt(m, g) * (offsetAt(x, g) + l + pillCorrection(x, 0, m, 1, first, g, l));
    const next = captureGlideStart(x, m, 0, before, l, g);
    const after = scaleAt(m, g) * (offsetAt(x, g) + l + pillCorrection(x, 2, m, 0, next, g, l));
    expect(after).toBeCloseTo(before, 9);
  });
});
