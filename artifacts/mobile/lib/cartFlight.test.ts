import { describe, expect, it, vi } from 'vitest';
import {
  getCartFlightVector,
  getSuccessfulCartCount,
  flightSourceFromRect,
  measureWindowRect,
  measureCartTarget,
  shouldAnimateCartSuccess,
} from './cartFlight';

describe('cart flight', () => {
  it('waits for and uses the measured native cart center', async () => {
    const measure = vi.fn((callback: (x: number, y: number, width: number, height: number) => void) => {
      setTimeout(() => callback(320, 54, 44, 44), 5);
    });
    await expect(measureCartTarget(measure, { x: 340, y: 80 }, 50)).resolves.toEqual({
      x: 342,
      y: 76,
    });
  });

  it('uses a stable safe-area fallback when native measurement times out', async () => {
    vi.useFakeTimers();
    const promise = measureCartTarget(() => {}, { x: 340, y: 85 }, 120);
    await vi.advanceTimersByTimeAsync(120);
    await expect(promise).resolves.toEqual({ x: 340, y: 85 });
    vi.useRealTimers();
  });

  it('lands the thumbnail center on the measured cart center', () => {
    expect(getCartFlightVector(176, 500, { x: 342, y: 76 })).toEqual({
      x: 142,
      y: -448,
    });
  });

  it('only returns a badge count after a successful cart write', () => {
    expect(getSuccessfulCartCount({ success: false, cart: { items: [{ quantity: 9 }] } })).toBeNull();
    expect(getSuccessfulCartCount({
      success: true,
      cart: { items: [{ quantity: 2 }, { quantity: 3 }] },
    })).toBe(5);
  });

  it('disables success motion while preference is unresolved or reduced motion is on', () => {
    expect(shouldAnimateCartSuccess(null)).toBe(false);
    expect(shouldAnimateCartSuccess(true)).toBe(false);
    expect(shouldAnimateCartSuccess(false)).toBe(true);
  });

  it('lands a larger flying copy centre on the cart centre too', () => {
    // 220px copy lifting off the photo: left 85, top 72 → centre (195, 182).
    expect(getCartFlightVector(85, 72, { x: 368, y: 76 }, 220)).toEqual({ x: 173, y: -106 });
  });
});

describe('flight source (the flight lifts off the product image)', () => {
  it('centres on the part of the photo visible inside its scroll viewport, capped at 220', () => {
    expect(flightSourceFromRect({ x: 0, y: -26, width: 390, height: 390 }, { top: 0, bottom: 844 }))
      .toEqual({ x: 195, y: 182, size: 220 });
    expect(flightSourceFromRect({ x: 0, y: 300, width: 390, height: 390 }, { top: 400, bottom: 844 }))
      .toEqual({ x: 195, y: 545, size: 220 });
  });

  it('returns null when the photo is scrolled (almost) out of its viewport', () => {
    expect(flightSourceFromRect({ x: 0, y: -26, width: 390, height: 390 }, { top: 400, bottom: 844 })).toBeNull();
    expect(flightSourceFromRect(null, { top: 0, bottom: 844 })).toBeNull();
  });

  it('uses a small thumbnail at its own size', () => {
    expect(flightSourceFromRect({ x: 26, y: 233, width: 92, height: 92 }, { top: 0, bottom: 844 }))
      .toEqual({ x: 72, y: 279, size: 92 });
  });

  it('measures a window rect, or null without a measurable view, a zero box, or no answer', async () => {
    await expect(measureWindowRect((cb) => cb(1, 2, 3, 4))).resolves.toEqual({ x: 1, y: 2, width: 3, height: 4 });
    await expect(measureWindowRect(undefined)).resolves.toBeNull();
    await expect(measureWindowRect((cb) => cb(0, 0, 0, 0))).resolves.toBeNull();
    await expect(measureWindowRect(() => {}, 20)).resolves.toBeNull();
  });
});
